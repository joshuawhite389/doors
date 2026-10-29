// WHY-VIZ-SPEC §4.3 (lane 2): picture 3 on the real page. Seeds Maya's demo profile, opens Why these doors → Who
// likes Athletic Brewing?, shoots the rows, checks the sentence, the muted rows, the tooltip and the table twin.
// Usage: node scripts/viz2-lift-cdp.mjs <base-url> <out-dir> [width] [height]
import { spawn } from "node:child_process";
import fs from "node:fs";
import { demoProfile } from "../public/lib/demo-profile.js";
import { storeKey, STORE_VERSION, BRAND_KEY } from "../public/lib/store.js";
const [base, out, w = "1400", h = "900"] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const port = 9400 + Math.floor(Math.random() * 400);
const dir = `/tmp/claude-1000/viz2l-${port}`;
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
const check = (ok, what) => { if (!ok) problems.push(`check failed: ${what}`); };
const report = { width: +w };
const prof = demoProfile(new Date());
prof.known = [];
const key = storeKey(prof.brand, prof.city);
await send("Runtime.enable"); await send("Page.enable");
const state = { v: STORE_VERSION, brand: prof.brand, city: prof.city, profile: prof, plan: null, statuses: {}, outcomes: {}, savedAt: new Date().toISOString() };
await send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => { try { if (!localStorage.getItem("__seeded")) { localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify(state))}); localStorage.setItem(${JSON.stringify(BRAND_KEY)}, ${JSON.stringify(JSON.stringify({ v: STORE_VERSION, profile: prof, savedAt: new Date().toISOString() }))}); localStorage.setItem("doors:drive-voice", "off"); localStorage.setItem("__seeded", "1"); } } catch {} window.SpeechRecognition = undefined; delete window.webkitSpeechRecognition; })();` });
await send("Emulation.setDeviceMetricsOverride", { width: +w, height: +h, deviceScaleFactor: 1, mobile: +w < 700 });
const q = new URLSearchParams({ brand: prof.brand, city: prof.city });
await send("Page.navigate", { url: `${base}/app?ors=off&instant=1#/plan?${q}` });
await waitFor(`!!document.querySelector(".stop[data-id]")`, 40000);
await sleep(2500);
await send("Page.reload");
await waitFor(`!!document.querySelector(".stop[data-id]")`, 40000);
await sleep(2500);
await ev(`[...document.querySelectorAll('[data-drawer="why"]')].find((b) => b.getClientRects().length)?.click()`);
await waitFor(`!!document.querySelector("#why .wv-explorer svg .wv-dot")`, 20000);
await click('#why [data-view="who"]');
await waitFor(`!!document.querySelector("#why .wv-lift svg .wv-lift-row")`, 20000);
await sleep(500);
await ev(`document.querySelector("#why").scrollTop = 0`);
const narrow = +w <= 900;
report.say = await ev(`document.querySelector("#why .wv-lift .wv-say").textContent`);
check(/^[A-Z][^.]+ (is|are) named at your doors .* times as often as across the \d+ Austin doors Qloo describes\. /.test(report.say), `sentence (${report.say})`);
check(/not worth saying\.$/.test(report.say), "the not-worth-saying close");
report.rows = await ev(`[...document.querySelectorAll("#why .wv-lift .wv-lift-row")].map((g) => ({ label: g.getAttribute("aria-label"), muted: g.classList.contains("muted") }))`);
check(report.rows.length >= (narrow ? 4 : 8), `rows ${report.rows.length}`);
if (!narrow) check(report.rows.some((r) => r.muted && /about the city/.test(r.label)), "a muted row reads about the city");
else check(report.rows.every((r) => !r.muted), "the phone keeps no muted rows");
check(report.rows.some((r) => /^Craft beer fans: 7 of \d+ plan doors, \d+% of Austin, ×\d\.\d$/.test(r.label)), `craft beer row (${report.rows.find((r) => /Craft beer/.test(r.label))?.label})`);
const lifts = report.rows.map((r) => +(r.label.match(/×(\d+\.\d)$/)?.[1] ?? (/about the city/.test(r.label) ? 1 : 0)));
check(lifts.every((v, i) => i === 0 || lifts[i - 1] >= v - 0.3), "rows sorted by lift");
check(await ev(`document.querySelector("#why .wv-lift .wv-say").compareDocumentPosition(document.querySelector("#why .w-who")) & Node.DOCUMENT_POSITION_FOLLOWING`), "the picture sits above the drinks card");
await shot("l1-who");
// hover a row: the tooltip
const row = await ev(`(() => { const g = document.querySelector("#why .wv-lift .wv-lift-row"); const b = g.querySelector("circle").getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; })()`);
await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: row.x, y: row.y });
await sleep(300);
report.tip = await ev(`(() => { const t = document.querySelector(".wv-tip"); return t && !t.hidden ? t.textContent : null; })()`);
check(report.tip && /of \d+ plan doors/.test(report.tip) && /of \d+ Austin doors/.test(report.tip) && /the lift/.test(report.tip), `tooltip (${report.tip})`);
await shot("l2-hover");
// the table twin holds every row, muted ones too
await click("#why .wv-lift .wv-tbl summary");
await sleep(200);
report.twin = await ev(`document.querySelectorAll("#why .wv-lift .wv-tbl tbody tr").length`);
check(report.twin >= report.rows.length, `twin rows ${report.twin} ≥ ${report.rows.length}`);
await shot("l3-twin");
report.problems = problems;
fs.writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ok: !problems.length, rows: report.rows.length, say: report.say, problems }, null, 1));
process.exit(problems.length ? 1 : 0);
