// WHY-VIZ-SPEC §4.4 (lane 2): picture 4 on the real page. Seeds Maya's demo profile, opens Why these doors → Doors
// Deep Dive, shoots the ring (above the thread), checks the sentence, the five parts, the day's arcs and list, switches
// the day tab, hovers an arc. Usage: node scripts/viz2-ring-cdp.mjs <base-url> <out-dir> [width] [height]
import { spawn } from "node:child_process";
import fs from "node:fs";
import { demoProfile } from "../public/lib/demo-profile.js";
import { storeKey, STORE_VERSION, BRAND_KEY } from "../public/lib/store.js";
const [base, out, w = "1400", h = "900"] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const port = 9400 + Math.floor(Math.random() * 400);
const dir = `/tmp/claude-1000/viz2r-${port}`;
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
await click('#why [data-view="plan"]');
await waitFor(`!!document.querySelector("#why .wv-ring svg .wv-ring-door")`, 20000);
await sleep(400);
await ev(`document.querySelector("#why").scrollTop = 0`);
const narrow = +w <= 900;
report.say = await ev(`document.querySelector("#why .wv-ring .wv-say").textContent`);
check(/^Qloo tags \d+ of your \d+ doors with the evening and \d+ with late night; \d+ with the morning\. You're out \w+day [\d:]+ [ap]m–[\d:]+ [ap]m, (before most of them fill|as they fill|after most of them have filled)\. \d+ of \w+day's \d+ doors (is|are) already open at [\d:]+ [ap]m(; \d+ opens? later in your window)?(, and .*)?\.$/.test(report.say), `sentence (${report.say})`);
report.parts = await ev(`[...document.querySelectorAll("#why .wv-ring .wv-ring-part")].map((g) => g.getAttribute("aria-label"))`);
check(report.parts.length === 5, `five day parts (${report.parts.length})`);
check(report.parts.some((p) => /^Evening: Qloo tags \d+ of your \d+ doors$/.test(p)), `evening part (${report.parts})`);
report.tab = await ev(`document.querySelector("#why .wv-ring [data-wv-day][aria-pressed=true]")?.textContent`);
report.arcs = await ev(`document.querySelectorAll("#why .wv-ring .wv-ring-door").length`);
report.list = await ev(`[...document.querySelectorAll("#why .wv-ring .wv-ring-list li")].map((li) => li.textContent.replace(/\\s+/g, " ").trim())`);
const tabN = +(report.tab?.match(/· (\d+)/)?.[1] ?? 0);
check(report.list.length === tabN && tabN > 0, `the list holds the day's ${tabN} doors (${report.list.length})`);
check(report.arcs <= tabN, `arcs ≤ doors (${report.arcs} vs ${tabN})`);
check(report.list.some((x) => /open at [\d:]+ [ap]m$/.test(x)) && report.list.some((x) => /opens [\d:]+ [ap]m$/.test(x)), `list words (${report.list.slice(0, 3)})`);
check(await ev(`!!document.querySelector("#why .wv-ring svg text") && /You're out/.test(document.querySelector("#why .wv-ring svg").textContent)`), "the window wedge's label");
check(await ev(`document.querySelector("#why .wv-ring").compareDocumentPosition(document.querySelector("#why .wv-th")) & Node.DOCUMENT_POSITION_FOLLOWING`), "the ring sits above the thread");
await shot("r1-ring");
// hover a door arc: the tooltip
const arcPos = await ev(`(() => { const g = [...document.querySelectorAll("#why .wv-ring .wv-ring-door")][0]; g.scrollIntoView({block: "center"}); const p = [...g.querySelectorAll("path")].find((x) => x.getAttribute("stroke") !== "transparent"); const pt = p.getPointAtLength(p.getTotalLength() / 2).matrixTransform(p.getScreenCTM()); return { x: pt.x, y: pt.y }; })()`);
await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: arcPos.x, y: arcPos.y });
await sleep(300);
report.tip = await ev(`(() => { const t = document.querySelector(".wv-tip"); return t && !t.hidden ? t.textContent : null; })()`);
check(report.tip && /open while you're out|not open while you're out/.test(report.tip), `arc tooltip (${report.tip})`);
await shot("r2-hover");
await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 5 });
// the second day's tab: the ring and the list follow
const second = await ev(`[...document.querySelectorAll("#why .wv-ring [data-wv-day]")].find((b) => b.getAttribute("aria-pressed") !== "true" && !b.disabled)?.dataset.wvDay ?? null`);
if (second != null) {
  await click(`#why .wv-ring [data-wv-day="${second}"]`);
  await sleep(400);
  report.tab2 = await ev(`document.querySelector("#why .wv-ring [data-wv-day][aria-pressed=true]")?.textContent`);
  report.say2 = await ev(`document.querySelector("#why .wv-ring .wv-say").textContent`);
  check(report.tab2 !== report.tab, `the tab switched (${report.tab2})`);
  const dayWord = report.tab2?.split(" ")[0];
  check(new RegExp(`You're out ${dayWord}\\w*day`).test(report.say2), `the sentence follows the day (${report.say2})`);
  await ev(`document.querySelector("#why .wv-ring").scrollIntoView({block:"start"})`);
  await shot("r3-day2");
}
// the table twin
await click("#why .wv-ring .wv-tbl summary");
await sleep(200);
report.twin = await ev(`document.querySelectorAll("#why .wv-ring .wv-tbl tbody tr").length`);
check(report.twin > 0, "twin rows");
report.problems = problems;
fs.writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ok: !problems.length, say: report.say, problems }, null, 1));
process.exit(problems.length ? 1 : 0);
