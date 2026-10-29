// The web drive Day tab's map (PARITY M5): a saved demo plan whose first window is today, drive mode → Day tab → the map
// draws the start + every door as a numbered pin and the route source chip; a pin opens its door. Screenshots.
// Usage: node scripts/probes/daymap-cdp.mjs <base-url> <out-dir> [width] [height]
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
const pinned = new Date(y, mo - 1, d, 12, 55).getTime();
await send("Runtime.enable"); await send("Page.enable");
await send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
  const real = Date, off = ${pinned} - real.now();
  class D extends real { constructor(...a) { if (a.length) super(...a); else super(real.now() + off); } static now() { return real.now() + off; } }
  window.Date = D;
  try { if (!localStorage.getItem("__seeded")) { localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify(state))}); localStorage.setItem("__seeded", "1"); } } catch {}
})();` });
await send("Emulation.setDeviceMetricsOverride", { width: +w, height: +h, deviceScaleFactor: 1, mobile: +w < 700 });
await send("Page.navigate", { url: `${base}/app#/plan?${new URLSearchParams({ brand: prof.brand, city: prof.city, drive: "1" })}` });
await waitFor(`!!document.querySelector("[data-drive-door] .dv-talk")`, 40000);
await shot("01-door");
await click('[data-drive-screen="day"]');
await waitFor(`document.querySelectorAll(".dv-mapbox .mpin").length > 0`, 30000);
await sleep(2500);
await shot("02-day-map");
const rows = await ev(`document.querySelectorAll("[data-drive-open]").length`);
const pins = await ev(`document.querySelectorAll(".dv-mapbox .mpin").length`);
check("a pin per door on the list", pins === rows && rows > 0, { pins, rows });
check("the start is on the map", await ev(`!!document.querySelector(".dv-mapbox .mstart")`), null);
const src = await ev(`document.querySelector("[data-route-source]")?.textContent ?? ""`);
check("the route source is labelled", src.length > 0, src);
check("the route is drawn", await ev(`(() => { const m = document.querySelector(".dv-mapgl"); return !!m && m.dataset.mapKind != null; })()`), null);
check("the map sits above the list", await ev(`(() => { const a = document.querySelector(".dv-mapbox").getBoundingClientRect(), b = document.querySelector(".dv-daylist ol").getBoundingClientRect(); return a.bottom <= b.top + 1 && a.height >= 200; })()`), null);
// a redraw keeps the same map (the Voice tab, a plan change): flip to the door and back
await click('[data-drive-screen="door"]');
await waitFor(`!!document.querySelector("[data-drive-door]")`);
await click('[data-drive-screen="day"]');
await waitFor(`document.querySelectorAll(".dv-mapbox .mpin").length > 0`);
check("back to Day: the map is back", (await ev(`document.querySelectorAll(".dv-mapbox .mpin").length`)) === rows, null);
// a pin (the 2nd door, not the current one) opens that door
const second = await ev(`document.querySelectorAll("[data-drive-open]")[1]?.dataset.driveOpen`);
const name2 = await ev(`document.querySelectorAll("[data-drive-open] i")[1]?.textContent`);
const pinSel = `.dv-mapbox .mpin`;
const target = await ev(`[...document.querySelectorAll(${JSON.stringify(pinSel)})].find((p) => p.textContent.trim() === "2") ? true : false`);
if (target) {
  const r = await ev(`(() => { const p = [...document.querySelectorAll(${JSON.stringify(pinSel)})].find((p) => p.textContent.trim() === "2"); const b = p.getBoundingClientRect(); return {x: b.left + b.width/2, y: b.top + b.height/2}; })()`);
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: r.x, y: r.y, button: "left", clickCount: 1 });
  await waitFor(`!!document.querySelector("[data-drive-door]")`);
  await sleep(300);
  await shot("03-pin-opened");
  const opened = await ev(`document.querySelector("[data-drive-door]")?.dataset.id`);
  check("pin 2 opens door 2", opened === second, { opened, second, name2 });
} else check("pin 2 exists", false, null);
check("no page errors", !problems.length, problems);
console.log(JSON.stringify({ width: +w, src, rows, checks }, null, 1));
process.exit(checks.every((c) => c.ok) ? 0 : 1);
