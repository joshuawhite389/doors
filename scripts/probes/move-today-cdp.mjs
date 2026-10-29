// Moves and the day under way (mobile2 10-23: "Move to Friday" on the day under way re-planned it from the clock and
// took 6 of 7 doors off). A saved demo plan whose first window is today, the clock at 3:10 pm, reloaded so today is
// the day under way; then S.moveStop onto it, within it and off it: no door of today may come off or move.
// Usage: node scripts/probes/move-today-cdp.mjs <base-url> <out-dir> [width] [height]
import { spawn } from "node:child_process";
import fs from "node:fs";
import { demoProfile } from "../../public/lib/demo-profile.js";
import { storeKey } from "../../public/lib/store.js";
import { isoDate } from "../../public/lib/profile.js";

const [base, out, w = "1400", h = "900"] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const port = 9400 + Math.floor(Math.random() * 400);
const dir = `/tmp/claude-1000/daymap-${port}`;
const ch = spawn("chromium", ["--headless=new", `--remote-debugging-port=${port}`, "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--hide-scrollbars", `--window-size=${w},${h}`, `--user-data-dir=${dir}`, "about:blank"], { stdio: "ignore", detached: true });
const cleanup = () => { try { process.kill(-ch.pid, "SIGKILL"); } catch {} try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };
process.on("exit", cleanup);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(1));
process.on("uncaughtException", (e) => { console.error(e); process.exit(1); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 75; i++) { try { const t = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); const p = t.find((x) => x.type === "page"); if (p) { ws = new WebSocket(p.webSocketDebuggerUrl); break; } } catch {} await sleep(200); }
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pend = new Map(); const problems = [];
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
  if (m.method === "Runtime.consoleAPICalled" && /error/.test(m.params.type)) problems.push("console.error " + m.params.args.map((a) => a.value ?? a.description).join(" ").slice(0, 300));
  if (m.method === "Runtime.exceptionThrown") problems.push("exception " + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 300));
});
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result?.value; };
const shot = async (name) => { const { data } = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(`${out}/${w}-${name}.png`, Buffer.from(data, "base64")); };
const click = async (sel) => {
  const r = await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({block:"center"}); const b = e.getBoundingClientRect(); return {x: b.left + b.width/2, y: b.top + b.height/2}; })()`);
  if (!r) throw new Error(`no ${sel}`);
  await sleep(150);
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: r.x, y: r.y, button: "left", clickCount: 1 });
};
const waitFor = async (expr, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(expr)) return true; await sleep(150); } await shot("zz-timeout"); throw new Error(`timed out: ${expr}\n${problems.join("\n")}`); };
const checks = [];
const check = (name, ok, got) => { checks.push({ name, ok: !!ok, got }); if (!ok) console.error(`FAIL: ${name}: ${JSON.stringify(got)}`); };

const today = isoDate(new Date());
const prof = demoProfile(new Date());
prof.windows = [{ date: today, from: "13:00", to: "18:00" }, ...prof.windows.slice(1)];
prof.known = [];
const key = storeKey(prof.brand, prof.city);
const state = { v: 1, brand: prof.brand, city: prof.city, profile: prof, plan: null, statuses: {}, outcomes: {}, savedAt: new Date().toISOString() };
const [y, mo, d] = today.split("-").map(Number);
const pinned = new Date(y, mo - 1, d, 15, 10).getTime();
await send("Runtime.enable"); await send("Page.enable");
await send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
  const real = Date, off = ${pinned} - real.now();
  class D extends real { constructor(...a) { if (a.length) super(...a); else super(real.now() + off); } static now() { return real.now() + off; } }
  window.Date = D;
  try { if (!localStorage.getItem("__seeded")) { localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify(state))}); localStorage.setItem("__seeded", "1"); } } catch {}
})();` });
await send("Emulation.setDeviceMetricsOverride", { width: +w, height: +h, deviceScaleFactor: 1, mobile: +w < 700 });
await send("Page.navigate", { url: `${base}/app#/plan?${new URLSearchParams({ brand: prof.brand, city: prof.city, })}` });
await waitFor(`!!document.querySelector(".stops .stop")`, 40000);
await sleep(1500);
await send("Page.reload"); // the saved plan now has today: it is the day under way (frozen)
await sleep(1000);
await waitFor(`!!document.querySelector(".stops .stop")`, 40000);
await sleep(1500);
const r = await ev(`(async () => {
  const S = await import("/ui/state.js");
  const wait = () => new Promise((r) => setTimeout(r, 2500));
  const ids = (date) => S.getPlan().days.find((d) => d.date === date)?.stops.map((s) => s.id) ?? [];
  let p = S.getPlan();
  const k = p.days.findIndex((d) => d.frozen && !d.past);
  if (k < 0) return { error: "no day under way", days: p.days.map((d) => [d.date, d.frozen]) };
  const date = p.days[k].date;
  const out = {};
  // 1. onto today from a day ahead
  const j = p.days.findIndex((d, i) => i !== k && !d.past && d.stops.length);
  const id = p.days[j].stops[0].id;
  let before = ids(date);
  await S.moveStop(id, { day: k, index: null }); await wait();
  let after = ids(date);
  out.onto = { before: before.length, after: after.length, ok: after.includes(id) && JSON.stringify(after.filter((x) => x !== id)) === JSON.stringify(before) };
  // 2. within today: stop 4 up to stop 3
  before = ids(date);
  p = S.getPlan();
  await S.moveStop(before[3], { day: p.days.findIndex((d) => d.date === date), index: 2 }); await wait();
  after = ids(date);
  out.within = { ok: JSON.stringify(after) === JSON.stringify([...before.slice(0, 2), before[3], before[2], ...before.slice(4)]), after: after.length };
  // 3. off today to a day ahead
  before = ids(date);
  p = S.getPlan();
  const ahead = p.days.findIndex((d) => d.date !== date && !d.past);
  const off = before[before.length - 1];
  const was3 = new Set(S.getPlan().days.filter((d) => !d.past).flatMap((d) => d.stops.map((s) => s.id)));
  const went = await S.moveStop(off, { day: ahead, index: null }); await wait();
  after = ids(date);
  const now3 = new Set(S.getPlan().days.filter((d) => !d.past).flatMap((d) => d.stops.map((s) => s.id)));
  const t3 = document.querySelector(".toast")?.textContent ?? "";
  // moved with every planned door still on a day, or (a full day) refused: today as it was, the toast says why
  out.off = { went, ok: went ? JSON.stringify(after) === JSON.stringify(before.slice(0, -1)) && [...was3].every((x) => now3.has(x)) : JSON.stringify(after) === JSON.stringify(before) && /Nothing moved/.test(t3), toast: t3.slice(0, 160) };
  // 4. between two days ahead: no planned door may end up on no day; a full day says so and nothing moves
  p = S.getPlan();
  const planned = () => new Set(S.getPlan().days.filter((d) => !d.past).flatMap((d) => d.stops.map((s) => s.id)));
  const ah = p.days.map((d, i) => ({ d, i })).filter(({ d }) => !d.past && !d.frozen && d.stops.length);
  const was = planned();
  const mv = ah[0].d.stops[0].id;
  const okMove = await S.moveStop(mv, { day: ah[1].i, index: 0 }); await wait();
  const now = planned();
  out.ahead = { moved: okMove, lost: [...was].filter((x) => !now.has(x)).length, ok: [...was].every((x) => now.has(x)), toast: document.querySelector(".toast")?.textContent?.slice(0, 160) };
  out.toast = document.querySelector(".toast")?.textContent?.slice(0, 140);
  return out;
})()`);
console.log(JSON.stringify(r));
await shot("move-after");
process.exit(r.onto?.ok && r.within?.ok && r.off?.ok && r.ahead?.ok ? 0 : 1);
