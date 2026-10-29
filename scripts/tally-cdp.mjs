// Visit progress on the web door card (Jard 10-24 #4): log 3 of the day's doors (1 interested, 1 follow up, 1 talked to
// someone else), open the third, shoot the after-visit block and read its words; then all doors visited.
// Usage: node scripts/tally-cdp.mjs <base-url> <out-dir> [width] [height]

// Usage: node scripts/doorcardweb-cdp.mjs <base-url> <out-dir> [width] [height] [before]   (before: shots only, no checks)
import { spawn } from "node:child_process";
import fs from "node:fs";
import { demoProfile } from "../public/lib/demo-profile.js";
import { storeKey } from "../public/lib/store.js";
import { isoDate } from "../public/lib/profile.js";
const [base, out, w = "1400", h = "900", mode = ""] = process.argv.slice(2);
const before = mode === "before";
fs.mkdirSync(out, { recursive: true });
const port = 9400 + Math.floor(Math.random() * 400);
const dir = `/tmp/claude-1000/tally-${port}`;
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
const today = isoDate(new Date());
const prof = demoProfile(new Date());
prof.windows = [{ date: today, from: "13:00", to: "18:00" }, ...prof.windows.slice(1)];
prof.known = [];
const key = storeKey(prof.brand, prof.city);
await send("Runtime.enable"); await send("Page.enable");
await send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => { try { if (!localStorage.getItem("__seeded")) { localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify({ v: 1, brand: prof.brand, city: prof.city, profile: prof, plan: null, statuses: {}, outcomes: {}, savedAt: new Date().toISOString() }))}); localStorage.setItem("__seeded", "1"); } } catch {} })();` });
await send("Emulation.setDeviceMetricsOverride", { width: +w, height: +h, deviceScaleFactor: 1, mobile: +w < 700 });
const q = new URLSearchParams({ brand: prof.brand, city: prof.city });
const open = async () => { await send("Page.navigate", { url: `${base}/app#/plan?${q}` }); await waitFor(`!!document.querySelector(".stop[data-id]")`, 40000); await sleep(2000); };
await open();
const ids = await ev(`(() => { const d = document.querySelector(".stop[data-id][data-day]").dataset.day; return [...document.querySelectorAll(\`.stop[data-id][data-day="\${d}"]\`)].map((e) => e.dataset.id); })()`);
console.log("day stops:", ids.length);
const seed = async (n) => { await ev(`(() => { const k = ${JSON.stringify(key)}; const s = JSON.parse(localStorage.getItem(k)); const ids = ${JSON.stringify(ids)}.slice(0, ${n}); const res = ["interested", "followup", "someone"];
  s.statuses = {}; s.outcomes = {}; ids.forEach((id, i) => { s.statuses[id] = "visited"; const r = res[i] ?? "no"; s.outcomes[id] = { result: r, at: "${today}T1" + (3 + i % 6) + ":10:00", ...(r === "followup" ? { followUp: "${today}" } : {}) }; });
  localStorage.setItem(k, JSON.stringify(s)); })()`); };
const read = async (n, name) => {
  await seed(n); await send("Page.navigate", { url: "about:blank" }); await sleep(300); await open(); // a fresh load (a reload kept the open stop)
  await click(`.stop[data-id="${ids[Math.min(n, ids.length) - 1]}"] [data-open]`);
  await waitFor(`!!document.querySelector(".stopview:not([hidden]) .dafter")`);
  await sleep(700);
  const r = await ev(`(() => { const t = document.querySelector(".stopview:not([hidden]) .dtally"); if (!t) return null; t.scrollIntoView({ block: "center" }); return { head: t.querySelector(".dtally-h")?.textContent, sub: t.querySelector(".dsub")?.textContent ?? "", filled: t.querySelectorAll(".dtally-bar i.v").length, segs: t.querySelectorAll(".dtally-bar i").length }; })()`);
  await sleep(300); await shot(name);
  return r;
};
const a = await read(3, "tally-3");
console.log("3 logged:", JSON.stringify(a));
check(a && a.filled === 3 && a.head === `3 of ${a.segs} doors visited today` && a.sub === `1 interested · 1 to follow up · ${a.segs - 3} to go`, "3 logged: bar and words agree");
const b = await read(ids.length, "tally-all");
console.log("all logged:", JSON.stringify(b));
check(b && b.filled === b.segs && b.head === `${b.segs} of ${b.segs} doors visited today` && b.sub === "1 interested · 1 to follow up", "all logged: bar full, no 'to go'");
console.log(`problems ${problems.length ? "\n" + problems.join("\n") : "none"}`);
process.exit(problems.length ? 1 : 0);
