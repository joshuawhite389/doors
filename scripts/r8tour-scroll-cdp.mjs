// Round 8 (Jard 10-28, phone): a tour card scrolled with a finger kept snapping back to its top on release. This drives
// the guided demo in headless Chromium at a phone size with touch emulation; on every card that scrolls inside itself it
// (a) flicks the text up with a touch drag and (b) sets scrollTop by hand, waits 2 s each time, and expects the scroll to
// stay. Prints a line per scrolling card and "problems none" when every one kept its place.
// Usage: node scripts/r8tour-scroll-cdp.mjs <base-url> <out-dir> [width] [height]
import { spawn } from "node:child_process";
import fs from "node:fs";
import { STEPS } from "../public/lib/demo-script.js";
const [base, out, w = "390", h = "844"] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const port = 9800 + Math.floor(Math.random() * 150);
const prof = `/tmp/claude-1000/r8scroll-${port}`;
const ch = spawn("chromium", ["--headless=new", `--remote-debugging-port=${port}`, "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--hide-scrollbars", `--window-size=${w},${h}`, `--user-data-dir=${prof}`, "about:blank"], { stdio: "ignore", detached: true });
const cleanup = () => { try { process.kill(-ch.pid, "SIGKILL"); } catch {} try { fs.rmSync(prof, { recursive: true, force: true }); } catch {} };
process.on("exit", cleanup);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(1));
process.on("uncaughtException", (e) => { console.error(e); process.exit(1); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 50; i++) { try { const t = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); const p = t.find((x) => x.type === "page"); if (p) { ws = new WebSocket(p.webSocketDebuggerUrl); break; } } catch {} await sleep(200); }
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pend = new Map(); const problems = [];
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
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
await send("Runtime.enable"); await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: +w, height: +h, deviceScaleFactor: 1, mobile: true });
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
await send("Page.navigate", { url: `${base}/app#/demo` });
await sleep(2500);
const CLICK = { askwhy: '#agentPanel [data-agent="send"]', shorter: '#agentPanel [data-agent="send"]', drive: "#t-drive", done: "#drive [data-drive-done]", save: "#drive [data-drive-save]", build: "#build", week: '.daytabs [data-tab="week"]', open: '.stops .stop[data-id="00000000-0000-4000-8000-271655E6AA28"] [data-open]', visit: '.stopview:not([hidden]) [data-s="visit"]', outcome: '.osheet [data-o="save"]' };
const CARD = `document.querySelector(".ccard:not([hidden])")`;
const geom = () => ev(`(() => { const c = ${CARD}; if (!c) return null; const r = c.getBoundingClientRect(); return { sh: c.scrollHeight, ch: c.clientHeight, st: c.scrollTop, x: r.left + r.width / 2, top: r.top, bottom: r.bottom, h3: c.querySelector("h3")?.textContent }; })()`);
// a finger drag up the card's text: the text moves up (the card scrolls down), then the finger lifts
async function flick(g) {
  const x = Math.round(g.x);
  const y0 = Math.round(g.top + Math.min(90, (g.bottom - g.top) * 0.45));
  const steps = 8, dy = 160 / steps;
  await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y: y0 }] });
  for (let i = 1; i <= steps; i++) { await send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: Math.round(y0 - dy * i) }] }); await sleep(30); }
  await sleep(120); // a held finger, then a lift (no fling)
  await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}
const rows = [];
let last = null, n = 0, t0 = Date.now();
while (Date.now() - t0 < 200000) {
  const st = await ev(`(() => { const d = window.__demo; const c = ${CARD}; return { key: d?.steps.at(-1)?.key, n: d?.steps.length, card: c ? c.querySelector("h3")?.textContent : null, errors: d?.errors }; })()`);
  if (!st) { await sleep(300); continue; }
  if (st.errors?.length) { problems.push("tour errors: " + st.errors.join("; ")); break; }
  const tag = `${st.key}#${st.n}`;
  if (tag !== last && st.card) {
    last = tag;
    await sleep(st.key === "building" ? 3500 : 900);
    const g = await geom();
    if (g && g.sh > g.ch + 4) {
      await flick(g);
      await sleep(300);
      const a = (await geom())?.st ?? -1;
      await sleep(2000);
      const b = (await geom())?.st ?? -1;
      await shot(`${String(++n).padStart(2, "0")}-${st.key}-touch`);
      // and by hand: the scroll the finger left, set from code (the clamp shows even where the drag didn't take)
      const want = Math.min(80, g.sh - g.ch);
      await ev(`(() => { const c = ${CARD}; c.scrollTop = ${want}; return c.scrollTop; })()`);
      await sleep(2000);
      const c2 = (await geom())?.st ?? -1;
      const row = { key: st.key, card: g.h3, overflow: g.sh - g.ch, touchAt300: a, touchAt2s: b, set: want, setAt2s: c2 };
      rows.push(row);
      console.log(JSON.stringify(row));
      if (a <= 0) problems.push(`card ${st.key}: the touch drag didn't scroll the card (scrollTop ${a})`);
      else if (Math.abs(b - a) > 2) problems.push(`card ${st.key}: snapped from ${a} to ${b} within 2 s of the finger lifting`);
      if (Math.abs(c2 - want) > 2) problems.push(`card ${st.key}: scrollTop set to ${want} read ${c2} after 2 s`);
    } else console.log(`${st.key}: fits (${g?.sh}/${g?.ch})`);
    if (st.key === "handoff") break;
    if (st.key === "building") continue;
    if (CLICK[st.key]) { const ok = await clickAt(CLICK[st.key]); if (!ok) problems.push(`no target for the ${st.key} step`); }
    else await clickAt(".ccard .btn.primary");
  }
  await sleep(300);
}
const seen = new Set((await ev(`window.__demo?.steps.map((s) => s.key).join(",")`) ?? "").split(",").filter(Boolean));
const missing = STEPS.map((x) => x.key).filter((k) => !seen.has(k));
if (missing.length) problems.push(`tour skipped ${missing.length} steps: ${missing.join(", ")}`);
console.log(`scrolling cards ${rows.length} of ${seen.size} at ${w}x${h}`);
console.log("problems", problems.length ? problems.join("\n") : "none");
process.exit(0);
