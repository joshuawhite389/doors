// Prove the guided demo end to end in headless Chromium (real time, over CDP), driven like a visitor: Continue on
// each card, real mouse clicks on the app for the click steps (Build my plan, Week, the #1 stop, Mark visited, Save
// outcome). Screenshots every step, prints any console error or tour error, and window.__demo (steps, blocked /api; only Agent and voice go out).
// Usage: node scripts/demo-cdp.mjs <base-url> <out-dir> [width] [height] [normal|chaos|close]
//   chaos: clicks around mid-tour (form fields, day tabs); close: closes the tour on the form and builds by hand.
// The tour's live calls (Doors Agent, the Aura voice: ui/demo.js DEMO_LIVE) are answered here over CDP, free: the Agent
// by Doors' rules (lib/agent-rules.js) on the turn the page sent, log-visit and voice with a 503 (the page's own
// fallbacks: the rules parser, the browser's voice). LIVE=1 lets them reach the server (a paid model turn on a live site).
import { spawn } from "node:child_process";
import fs from "node:fs";
import { STEPS } from "../public/lib/demo-script.js";
import { answerByRules } from "../public/lib/agent-rules.js";
const [base, out, w = "1400", h = "900", mode = "normal"] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const port = 9400 + Math.floor(Math.random() * 400);
const ch = spawn("chromium", ["--headless=new", `--remote-debugging-port=${port}`, "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--hide-scrollbars", `--window-size=${w},${h}`, `--user-data-dir=/tmp/claude-1000/tour-${port}`, "about:blank"], { stdio: "ignore", detached: true });
// the whole browser (its renderer and GPU children too) and its profile go when this script ends, however it ends
const cleanup = () => { try { process.kill(-ch.pid, "SIGKILL"); } catch {} try { fs.rmSync(`/tmp/claude-1000/tour-${port}`, { recursive: true, force: true }); } catch {} };
process.on("exit", cleanup);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(1));
process.on("uncaughtException", (e) => { console.error(e); process.exit(1); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 50; i++) { try { const t = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); const p = t.find((x) => x.type === "page"); if (p) { ws = new WebSocket(p.webSocketDebuggerUrl); break; } } catch {} await sleep(200); }
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pend = new Map(); const problems = [];
const net = []; // every same-origin /api/ request that reached the network (the demo's fetch guard never lets one out; an <audio> or a stray module could)
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
  if (m.method === "Fetch.requestPaused") stub(m.params);
  if (m.method === "Network.requestWillBeSent") { try { const u = new URL(m.params.request.url); if (u.origin === new URL(base).origin && u.pathname.startsWith("/api/")) net.push(u.pathname); } catch {} }
  if (m.method === "Runtime.consoleAPICalled" && /error|warn/.test(m.params.type)) { const t = m.params.args.map((a) => a.value ?? a.description).join(" ").slice(0, 300); if (!/refused \/api/.test(t)) { problems.push("console." + m.params.type + " " + t); } }
  if (m.method === "Runtime.exceptionThrown") problems.push("exception " + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 300)); });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result?.value;
const shot = async (name) => { const { data } = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(`${out}/${name}.png`, Buffer.from(data, "base64")); };
const clickAt = async (sel) => {
  const r = await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({block:"center"}); const b = e.getBoundingClientRect(); return {x: b.left + b.width/2, y: b.top + b.height/2}; })()`);
  if (!r) return false;
  await sleep(250);
  const r2 = await ev(`(() => { const b = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return {x: b.left + b.width/2, y: b.top + b.height/2}; })()`);
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: r2.x, y: r2.y, button: "left", clickCount: 1 });
  return true;
};
const b64 = (o) => Buffer.from(typeof o === "string" ? o : JSON.stringify(o)).toString("base64");
const JSONH = [{ name: "content-type", value: "application/json" }];
function stub({ requestId, request }) {
  const path = new URL(request.url).pathname;
  let body = null;
  try { body = JSON.parse(request.postData ?? "null"); } catch {}
  if (path === "/api/agent" && body?.context) {
    const r = { ...answerByRules(body.messages ?? [], body.context, { now: `${body.context.today}T${body.context.now}` }), by: "rules", stub: true };
    return send("Fetch.fulfillRequest", { requestId, responseCode: 200, responseHeaders: JSONH, body: b64(r) });
  }
  return send("Fetch.fulfillRequest", { requestId, responseCode: 503, responseHeaders: JSONH, body: b64({ error: "stubbed by demo-cdp" }) });
}
await send("Runtime.enable"); await send("Page.enable"); await send("Network.enable");
if (!process.env.LIVE) await send("Fetch.enable", { patterns: ["/api/agent", "/api/agent/log-visit", "/api/agent/debrief", "/api/voice/say", "/api/voice/listen"].map((p) => ({ urlPattern: `*${p}`, requestStage: "Request" })) });
await send("Emulation.setDeviceMetricsOverride", { width: +w, height: +h, deviceScaleFactor: 1, mobile: +w < 700 });
await send("Page.navigate", { url: `${base}/app#/demo` });
await sleep(2500);
const CLICK = { askwhy: '#agentPanel [data-agent="send"]', shorter: '#agentPanel [data-agent="send"]', drive: "#t-drive", done: "#drive [data-drive-done]", save: "#drive [data-drive-save]", build: "#build", week: '.daytabs [data-tab="week"]', open: '.stops .stop[data-id="00000000-0000-4000-8000-271655E6AA28"] [data-open]', visit: '.stopview:not([hidden]) [data-s="visit"]', outcome: '.osheet [data-o="save"]' };
// what a phone card must leave in view (the first 40 px of each; all of the Agent's log): page expressions returning elements
const COVER = {
  // card 21 (judge 10 #1, tour fit at 320): the read-back and Save & next door
  save: `() => [document.querySelector("#drive [data-drive-readback]"), document.querySelector("#drive [data-drive-save]")]`,
  answer: `() => [[...document.querySelectorAll('#agentPanel .agent-msg[data-role="agent"]')].at(-1), document.querySelector('#agentPanel .alog')]`,
  // the door's name: its big title, or (scrolled off on a short phone screen, where the sheet opens full height) the
  // name line in the sheet's header
  talk: `() => { const v = document.querySelector(".stopview:not([hidden])"); const h2 = v?.querySelector("h2"), sn = v?.querySelector(".sname:not([hidden])"); const off = h2 && v.querySelector(".sscroll") && h2.getBoundingClientRect().bottom <= v.querySelector(".sscroll").getBoundingClientRect().top; return [off && sn ? sn : h2, v?.querySelector(".atdoor .dl p.big")]; }`,
};
let last = null, n = 0, t0 = Date.now();
while (Date.now() - t0 < 180000) {
  const st = await ev(`(() => { const d = window.__demo; const c = document.querySelector(".ccard:not([hidden])"); return { key: d?.steps.at(-1)?.key, n: d?.steps.length, card: c ? c.querySelector("h3")?.textContent : null, done: d?.done, errors: d?.errors, hash: location.hash }; })()`);
  if (!st) { await sleep(300); continue; }
  if (st.errors?.length) { problems.push("tour errors: " + st.errors.join("; ")); await shot(`${String(++n).padStart(2,"0")}-offscript`); break; }
  const tag = `${st.key}#${st.n}`;
  if (tag !== last && st.card) {
    last = tag;
    await sleep(st.key === "building" ? 3500 : 700);
    await shot(`${String(++n).padStart(2, "0")}-${st.key}`);
    console.log(n, st.key, "·", st.card);
    // a phone's tour card never covers what it points at: card 9, the first lines of Doors Agent's answer; card 13, the
    // door's name and the opener (reshoot5: card 9 sat over the answer at 390)
    // tour fit (320): a door's sheet never runs under the demo banner (its "← All stops" sat under Close tour); a tour card docked over the header is the card's call
    if (+w <= 700 && ["open", "why", "talk", "visit"].includes(st.key)) {
      const top = await ev(`(() => { const e = document.querySelector(".stopview:not([hidden]) .sback"); if (!e) return "none"; const r = e.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); if (t && e.contains(t)) return "ok"; if (!t?.closest(".demo-banner")) return "ok"; const b = document.querySelector(".demo-banner")?.getBoundingClientRect(); const sv = document.querySelector(".stopview:not([hidden])").getBoundingClientRect(); return (t ? (t.className || t.tagName) + " '" + (t.textContent || "").trim().slice(0, 24) + "'" : "nothing") + " at " + Math.round(r.top) + " (banner bottom " + Math.round(b?.bottom ?? -1) + ", sheet top " + Math.round(sv.top) + ")"; })()`);
      if (top !== "ok" && top !== "none") problems.push(`card ${st.key}: the door sheet's ← All stops is under ${top}`);
    }
    if (+w <= 700 && COVER[st.key]) {
      const g = await ev(`(() => { const c = document.querySelector(".ccard:not([hidden])")?.getBoundingClientRect(); const els = (${COVER[st.key]})().filter(Boolean); return { card: c && { top: Math.round(c.top), bottom: Math.round(c.bottom) }, els: els.map((e) => { const r = e.getBoundingClientRect(); const top = Math.round(r.top), bottom = Math.round(e.classList.contains("alog") ? r.bottom : Math.min(r.bottom, r.top + 40)); return { what: e.className || e.tagName, top, bottom }; }) }; })()`);
      console.log("  cover", st.key, JSON.stringify(g));
      if (process.env.COVER_DEBUG) console.log("  geom", JSON.stringify(await ev(`(() => { const R = (e) => e && (({ top, bottom, height }) => ({ top: Math.round(top), bottom: Math.round(bottom), h: Math.round(height) }))(e.getBoundingClientRect()); const p = document.querySelector("#agentPanel"); const m = [...document.querySelectorAll('#agentPanel .agent-msg[data-role="agent"]')].at(-1); return { panel: R(p), log: R(p?.querySelector(".alog")), msg: R(m), msgText: R(m?.querySelector(".agent-text, p")), facts: R(m?.querySelector("details")), banner: R(document.querySelector(".ccard:not([hidden])")) }; })()`)));
      const vh = +h;
      for (const e of g.els) if (e.top < 0 || e.bottom > vh || (g.card && e.bottom > g.card.top && e.top < g.card.bottom)) problems.push(`card ${st.key} covers or hides ${e.what} (${e.top}-${e.bottom}; card ${g.card?.top}-${g.card?.bottom})`);
      if (!g.els.length) problems.push(`card ${st.key}: nothing to check under it`);
    }
    if (mode === "chaos" && st.key === "day") { await clickAt("#f-brand"); await clickAt('#rooms [data-k="bars"]'); await clickAt('#rooms [data-k="bars"]'); console.log("  chaos: clicked brand + toggled bars"); }
    if (mode === "chaos" && st.key === "tuesday") { await clickAt('.daytabs [data-tab="1"]'); await sleep(600); await clickAt('.daytabs [data-tab="0"]'); console.log("  chaos: flipped days"); }
    if (mode === "close" && st.key === "pitch") { await clickAt('[data-d="close"]'); await sleep(500); await shot(`${String(++n).padStart(2,"0")}-closed`); console.log("closed tour"); await clickAt("#build"); await sleep(9000); await shot(`${String(++n).padStart(2,"0")}-built-after-close`); break; }
    if (st.key === "handoff") { await sleep(800); await shot(`${String(++n).padStart(2,"0")}-handoff-final`); break; }
    if (st.key === "building") { continue; }
    if (CLICK[st.key]) { const ok = await clickAt(CLICK[st.key]); if (!ok) { console.log("  !! no target for", st.key); problems.push(`no target for the ${st.key} step`); } }
    else await clickAt(".ccard .btn.primary");
  }
  await sleep(300);
}
const fin = { ...(await ev(`({ agent: window.__demo?.agent ?? 0, blocked: window.__demo?.blocked, steps: window.__demo?.steps.map(s=>s.key).join(","), done: !!window.__demo?.done, hash: location.hash })`)), net };
console.log("final", JSON.stringify(fin));
// Jard 10-29: the tour reaches the network only for Doors Agent and the Aura voice (ui/demo.js DEMO_LIVE); the plan
// is baked, so no Qloo, ORS or plan-building call. The askwhy and shorter cards are live Agent turns.
const LIVE = new Set(["/api/agent", "/api/agent/log-visit", "/api/agent/debrief", "/api/voice/say", "/api/voice/listen"]);
const stray = (fin.net ?? []).filter((x) => !LIVE.has(x));
if (stray.length) problems.push(`the tour reached /api beyond Agent and voice: ${[...new Set(stray)].join(", ")}`);
if ((fin.blocked ?? []).some((x) => LIVE.has(x))) problems.push(`the tour refused a live call: ${fin.blocked.join(", ")}`);
if (mode === "normal" && !(fin.net ?? []).includes("/api/agent")) problems.push("the tour's Agent cards never reached /api/agent");
// a tour that skipped ahead (seen once under load: straight to the end) is a failure, not "problems none": every step of
// the script must have shown (the close mode stops at the pitch on purpose)
if (mode !== "close") {
  const seen = new Set((fin.steps ?? "").split(",").filter(Boolean));
  const missing = STEPS.map((x) => x.key).filter((k) => !seen.has(k));
  if (missing.length) problems.push(`tour skipped ${missing.length} of ${STEPS.length} steps: ${missing.join(", ")}`);
}
console.log("problems", problems.length ? problems.join("\n") : "none");
process.exit(0);
