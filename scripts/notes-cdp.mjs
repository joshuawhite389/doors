// Door notes + Ask Doors one tap away (Jard's iPhone test, 2026-10-23), proven in headless Chromium over CDP: a saved
// Tidewell plan with two notes on its first door → the plan (the Ask Doors button) → the stop (its Notes row → the
// Notes page: who wrote each, Edit, Delete, Add) → an edit → Ask Doors from the stop → "note that …" (Doors' rules answer on a dev server
// with no model) → the note on the stop → drive mode (its notes, its Ask Doors) → Ask over drive mode. Screenshots
// every step; prints a JSON report and "problems none" when every check passes.
// Usage: node scripts/notes-cdp.mjs <base-url> <out-dir> [width] [height] [before]   (before: shots only, no checks)
import { spawn } from "node:child_process";
import fs from "node:fs";
import { demoProfile } from "../public/lib/demo-profile.js";
import { storeKey } from "../public/lib/store.js";
import { isoDate } from "../public/lib/profile.js";
const [base, out, w = "1400", h = "900", mode = ""] = process.argv.slice(2);
const before = mode === "before";
fs.mkdirSync(out, { recursive: true });
const port = 9400 + Math.floor(Math.random() * 400);
const dir = `/tmp/claude-1000/notes-${port}`;
const ch = spawn("chromium", ["--headless=new", `--remote-debugging-port=${port}`, "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--hide-scrollbars", `--window-size=${w},${h}`, `--user-data-dir=${dir}`, "about:blank"], { stdio: "ignore", detached: true });
const cleanup = () => { try { process.kill(-ch.pid, "SIGKILL"); } catch {} try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };
process.on("exit", cleanup);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(1));
process.on("uncaughtException", (e) => { console.error(e); process.exit(1); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 50; i++) { try { const t = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); const p = t.find((x) => x.type === "page"); if (p) { ws = new WebSocket(p.webSocketDebuggerUrl); break; } } catch {} await sleep(200); }
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pend = new Map(); const problems = [];
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
  if (m.method === "Runtime.consoleAPICalled" && /error/.test(m.params.type)) problems.push("console.error " + m.params.args.map((a) => a.value ?? a.description).join(" ").slice(0, 300));
  if (m.method === "Runtime.exceptionThrown") problems.push("exception " + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 300)); });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result?.value; };
const shot = async (name) => { const { data } = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(`${out}/${name}.png`, Buffer.from(data, "base64")); };
const click = async (sel) => {
  const r = await ev(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.getClientRects().length); if (!e) return null; e.scrollIntoView({block:"center"}); const b = e.getBoundingClientRect(); return {x: b.left + b.width/2, y: b.top + b.height/2}; })()`);
  if (!r) throw new Error(`no visible ${sel}`);
  await sleep(150);
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: r.x, y: r.y, button: "left", clickCount: 1 });
};
const waitFor = async (expr, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(expr)) return true; await sleep(150); } await shot("zz-timeout"); throw new Error(`timed out: ${expr}\n${problems.join("\n")}`); };
const check = (ok, what) => { if (!ok && !before) problems.push(`check failed: ${what}`); };
// visible and inside the viewport, not covered at its centre by something else
const onScreen = (sel) => ev(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.getClientRects().length); if (!e) return false; const b = e.getBoundingClientRect(); if (b.width < 8 || b.top < 0 || b.left < 0 || b.bottom > innerHeight || b.right > innerWidth) return false; const t = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return !!t && (e === t || e.contains(t)); })()`);
// one Ask Doors per screen (Jard 2026-10-23): the buttons that read exactly "Agent", "Ask Doors" or (lane W) "Ask about this door", laid out and not visibility:hidden
const asks = () => ev(`[...document.querySelectorAll("button")].filter((b) => { if (!["Agent", "Ask Doors", "Ask about this door"].includes(b.textContent.trim()) || !b.getClientRects().length || getComputedStyle(b).visibility === "hidden") return false; const r = b.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, Math.min(Math.max(r.top + r.height / 2, 1), innerHeight - 1)); return r.bottom < 0 || r.top > innerHeight || (!!t && b.contains(t)); }).length`); // on top where it sits (scrolled-away ones count)
// the page footer's text is not under anything (the floating Ask Doors used to sit on "rankings and listings: Qloo")
const footClear = () => ev(`(() => { const f = document.querySelector(".appfoot"); if (!f) return true; for (const n of f.querySelectorAll("a, span, p")) { for (const r of n.getClientRects()) { if (r.bottom > innerHeight || r.top < 0) continue; for (const x of [r.left + 2, r.left + r.width / 2, r.right - 2]) { const t = document.elementFromPoint(x, r.top + r.height / 2); if (t && !f.contains(t)) return false; } } } return true; })()`);

const today = isoDate(new Date());
const prof = demoProfile(new Date());
prof.windows = [{ date: today, from: "13:00", to: "18:00" }, ...prof.windows.slice(1)];
prof.known = [];
const key = storeKey(prof.brand, prof.city);
const [y, mo, d] = today.split("-").map(Number);
const pinned = new Date(y, mo - 1, d, 12, 55).getTime();
await send("Runtime.enable"); await send("Page.enable");
// the first door's notes are seeded once its id is known (after the first plan): __notes
await send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
  const real = Date, off = ${pinned} - real.now();
  class D extends real { constructor(...a) { if (a.length) super(...a); else super(real.now() + off); } static now() { return real.now() + off; } }
  window.Date = D;
  try { if (!localStorage.getItem("__seeded")) { localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify({ v: 1, brand: prof.brand, city: prof.city, profile: prof, plan: null, statuses: {}, outcomes: {}, savedAt: new Date().toISOString() }))}); localStorage.setItem("__seeded", "1"); } } catch {}
  window.SpeechRecognition = undefined; delete window.webkitSpeechRecognition;
})();` });
await send("Emulation.setDeviceMetricsOverride", { width: +w, height: +h, deviceScaleFactor: 1, mobile: +w < 700 });
const q = new URLSearchParams({ brand: prof.brand, city: prof.city });
await send("Page.navigate", { url: `${base}/app#/plan?${q}` });
const report = { width: +w, steps: [] };
const step = async (name, extra = {}) => { await sleep(500); await shot(name); report.steps.push({ name, ...extra }); };
await waitFor(`!!document.querySelector(".stop[data-id]")`, 40000);
await sleep(2500);
// seed two notes on the first door (one the rep's, one Ask Doors'), then reload so the plan reads them
const first = await ev(`document.querySelector(".stop[data-id]").dataset.id`);
await ev(`(() => { const k = ${JSON.stringify(key)}; const s = JSON.parse(localStorage.getItem(k)); s.slots = { ...(s.slots ?? {}), [${JSON.stringify(first)}]: [
  { slot: "S4", field: "note", value: "Owner is Dana; she does the ordering, not the bar staff.", source: "stated", by: "rep", words: null, at: "${today}T15:10:00.000Z", expires: null, confirmed: true, id: "nseed1" },
  { slot: "S4", field: "note", value: "They want samples of the dry one before they commit to a case.", source: "stated", by: "agent:workers-ai", words: "they want samples of the dry one before they commit to a case", at: "${today}T16:02:00.000Z", expires: null, confirmed: false, id: "nseed2" } ] };
  localStorage.setItem(k, JSON.stringify(s)); })()`);
await send("Page.reload");
await waitFor(`!!document.querySelector(".stop[data-id]")`, 40000);
await sleep(2500);
if (!before) await waitFor(`getComputedStyle(document.querySelector('.tools [data-agent="open"]')).visibility === "visible" && !document.querySelector(".b2-building")`, 40000);
await step("01-plan");
check(!(await ev(`!!document.querySelector(".askfab")`)), "no floating Ask Doors");
check(await onScreen('.tools [data-agent="open"]'), "the toolbar's Ask Doors is on screen over the plan");
check((await asks()) === 1, "one Ask Doors on the plan");
report.tools = await ev(`(() => { const t = document.querySelector(".tools"); const bs = [...t.children].filter((b) => b.getClientRects().length); const r = t.getBoundingClientRect(); return { rows: new Set(bs.map((b) => Math.round(b.getBoundingClientRect().top))).size, box: Math.round(r.width), used: Math.round(bs.reduce((n, b) => n + b.getBoundingClientRect().width, 0) + (bs.length - 1) * parseFloat(getComputedStyle(t).columnGap)) }; })()`);
if (+w >= 1400) check(report.tools.rows === 1, "the plan's tools fit one row at 1400");
check(await footClear(), "nothing covers the footer on the plan");
await ev(`window.scrollTo(0, document.documentElement.scrollHeight)`);
await sleep(300);
if (!before) await shot("01b-plan-bottom");
check(await footClear(), "nothing covers the footer at the bottom of the plan");
await ev(`window.scrollTo(0, 0)`);
// the stop
await ev(`window.dispatchEvent(new CustomEvent("doors:open-stop", { detail: { id: ${JSON.stringify(first)}, day: 0 } }))`);
await waitFor(`!!document.querySelector(".stopview:not([hidden]) h2")`);
await sleep(1200);
await step("02-stop");
if (!before) {
  check(await onScreen(".sask") || await onScreen('.tools [data-agent="open"]'), "an Ask Doors is on screen with the stop");
  check((await asks()) === 1, "one Ask Doors with the stop");
  // today's door card (doorcard redesign): the notes are a page of the card, behind its "Notes · 2" row
  const row = await ev(`document.querySelector('.stopview .drow[data-pg="notes"]')?.innerText ?? ""`);
  report.notesRow = row;
  check(/Notes · 2/.test(row), `the card's Notes row counts two notes (${row.replace(/\s+/g, " ")})`);
  await click('.stopview .drow[data-pg="notes"]');
  await waitFor(`!!document.querySelector(".stopview .dpage .dnotes")`);
  await ev(`document.querySelector(".dnotes")?.scrollIntoView({ block: "start" })`);
  await step("03-stop-notes", { notes: await ev(`[...document.querySelectorAll(".dnotes .nlist li")].map((l) => l.innerText)`) });
  check((await ev(`document.querySelectorAll(".dnotes .nlist li").length`)) === 2, "two notes on the stop");
  check(/Doors Agent/.test(await ev(`document.querySelector('.dnotes li[data-by="agent"] .nwho')?.textContent ?? ""`)), "the agent's note says Doors Agent wrote it");
  // edit the rep's note
  await click('.dnotes li[data-nid="nseed1"] [data-s="note-edit"]');
  await waitFor(`!!document.querySelector(".dnotes textarea[data-edit]")`);
  await ev(`(() => { const t = document.querySelector(".dnotes textarea[data-edit]"); t.value = "Owner is Dana; she does the ordering. In Tue to Thu."; })()`);
  await step("04-note-editing");
  await click('.dnotes form[data-nid] button[type="submit"]');
  await waitFor(`/In Tue to Thu/.test(document.querySelector(".dnotes")?.innerText ?? "")`);
  await step("05-note-edited", { who: await ev(`document.querySelector('.dnotes li[data-nid="nseed1"] .nwho')?.textContent`) });
  // add one by hand
  await ev(`(() => { const t = document.querySelector(".dnotes form[data-new] textarea"); t.value = "Cooler is full till the spring reset."; })()`);
  await click('.dnotes form[data-new] button[type="submit"]');
  await waitFor(`/spring reset/.test(document.querySelector(".dnotes")?.innerText ?? "")`);
  await step("06-note-added");
  // Ask Doors from the stop
  await click('.sask, .dnotes .nbtns [data-s="ask"]'); // the header's (phone) or Notes' "Ask Doors about <door>"
  await waitFor(`!document.querySelector("#agentPanel").hidden`);
  await step("07-ask-open");
  await ev(`(() => { const t = document.querySelector("#agentInput"); t.value = "note that the manager is Priya, back Thursdays"; })()`);
  await click('[data-agent="send"]');
  await waitFor(`/Noted/.test(document.querySelector("#agentLog")?.innerText ?? "")`, 30000);
  await step("08-ask-noted", { reply: await ev(`[...document.querySelectorAll('#agentLog .agent-msg[data-role="agent"]')].at(-1)?.innerText`) });
  await click('[data-agent="close"]');
  await waitFor(`/Priya, back Thursdays/.test(document.querySelector(".dnotes")?.innerText ?? "")`);
  await ev(`document.querySelector(".dnotes")?.scrollIntoView({ block: "start" })`);
  await step("09-stop-with-agent-note", { notes: await ev(`[...document.querySelectorAll(".dnotes .nlist li")].map((l) => l.innerText)`) });
  const saved = await ev(`JSON.parse(localStorage.getItem(${JSON.stringify(key)})).slots[${JSON.stringify(first)}].filter((r) => r.field === "note").map((r) => [r.value, r.by])`);
  report.saved = saved;
  // by "rules" on a dev server with no model, "agent:<model>" when one answered
  check(saved.length === 4 && saved.some(([v, by]) => /Priya/.test(v) && (by === "rules" || /^agent:/.test(by))), "the agent's note is saved locally, by Doors Agent");
}
// drive mode
await send("Page.navigate", { url: `${base}/app#/plan?${new URLSearchParams({ brand: prof.brand, city: prof.city, drive: "1" })}` });
await waitFor(`!!document.querySelector("[data-drive-door] .dv-talk")`, 40000);
await step("10-drive");
if (!before) {
  check(await ev(`!!document.querySelector("[data-drive-notes]")`), "drive mode shows the door's notes");
  check((await asks()) === 1, "one Ask Doors in drive mode");
  // the page's side gutter: 24 px, 16 on a phone (Jard 2026-10-23)
  const gap = await ev(`Math.round(document.documentElement.clientWidth - document.querySelector("[data-drive-ask]").getBoundingClientRect().right)`);
  report.driveAskGap = gap;
  check(gap === (+w > 700 ? 24 : 16), `drive mode's Ask Doors sits ${+w > 700 ? 24 : 16} px from the right edge (is ${gap})`);
  // drive mode's Ask covers nothing: no other text or control of drive mode under its box
  check(await ev(`(() => { const a = document.querySelector("[data-drive-ask]").getBoundingClientRect(); const hit = [...document.querySelectorAll("#drive button, #drive a, #drive h1, #drive h2, #drive h3, #drive p, #drive span")].filter((e) => !e.matches("[data-drive-ask]") && !e.closest("[data-drive-ask]") && e.getClientRects().length && getComputedStyle(e).visibility !== "hidden").filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.height && r.left < a.right && r.right > a.left && r.top < a.bottom && r.bottom > a.top; }); return hit.length === 0 || (console.log("under drive Ask:", hit.map((e) => e.outerHTML.slice(0, 80)).join(" | ")), false); })()`), "drive mode's Ask Doors covers nothing");
  check(await onScreen("[data-drive-ask]") || (await ev(`document.querySelector("[data-drive-ask]")?.scrollIntoView({block:"center"}), true`)) && (await onScreen("[data-drive-ask]")), "drive mode's Ask Doors is reachable");
  await click("[data-drive-ask]");
  await waitFor(`!document.querySelector("#agentPanel").hidden`);
  check(await onScreen("#agentInput"), "Ask opens over drive mode");
  await step("11-drive-ask");
}
report.problems = problems;
console.log(JSON.stringify(report, null, 1));
console.log(problems.length ? `problems ${problems.length}` : "problems none");
process.exit(0);
