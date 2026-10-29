// WHY-VIZ-SPEC §4.2 (lane 2): the neighbourhood clouds on the real page. Seeds Maya's demo profile, opens Why these
// doors (the clouds and pills draw on the map at once), shoots the map, checks the pills don't overlap, hovers a cloud
// (the tooltip), opens See it on the map (the sentence, legend and rows), taps a pill (the area's doors by fate with
// Add), Adds one (the preview tray). Usage: node scripts/viz2-areas-cdp.mjs <base-url> <out-dir> [width] [height]
import { spawn } from "node:child_process";
import fs from "node:fs";
import { demoProfile } from "../public/lib/demo-profile.js";
import { storeKey, STORE_VERSION, BRAND_KEY } from "../public/lib/store.js";
const [base, out, w = "1400", h = "900"] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const port = 9400 + Math.floor(Math.random() * 400);
const dir = `/tmp/claude-1000/viz2a-${port}`;
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
const narrow = +w <= 900;
if (narrow) { await click('#why [data-view="map"]'); await sleep(400); await click('#why [data-w="peek"]'); await sleep(600); } // the phone: the map behind the sheet (See it on the map → Show the map)
await waitFor(`!!document.querySelectorAll(".wv-pill").length`, 20000);
await sleep(1500);
// the layers and the pills
report.layers = await ev(`(() => { const m = window.__doorsMap; return null; })()`);
report.pills = await ev(`[...document.querySelectorAll(".wv-pill")].map((p) => ({ text: p.textContent.trim(), shown: !p.classList.contains("hid"), box: p.dataset.box, r: (() => { const b = p.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; })() }))`);
const shown = report.pills.filter((p) => p.shown);
check(shown.length >= (narrow ? 1 : 3), `pills shown ${shown.length} of ${report.pills.length}`);
report.clashPairs = [];
const overlap = (a, b) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
let clashes = 0;
for (let i = 0; i < shown.length; i++) for (let j = i + 1; j < shown.length; j++) if (overlap(shown[i].r, shown[j].r)) { clashes++; report.clashPairs.push([shown[i], shown[j]]); }
check(clashes === 0, `pills overlap: ${clashes}`);
if (!narrow) check(shown.some((p) => /East Cesar Chavez.*live music fans/.test(p.text)), `East Cesar Chavez pill (${shown.map((p) => p.text).join(" | ")})`);
await shot("a1-map");
// hover a cloud: the tooltip (the hit fill under the pill's centre, a little below the pill)
const target = shown.find((p) => /East Cesar Chavez/.test(p.text)) ?? shown[0];
const hx = target.r[0] + target.r[2] / 2, hy = target.r[1] + target.r[3] + 22;
await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: hx, y: hy });
await sleep(400);
report.tip = await ev(`(() => { const t = document.querySelector(".wv-tip"); return t && !t.hidden ? t.textContent : null; })()`);
if (!narrow) check(report.tip && /on Qloo's heat map for your drinker/.test(report.tip) && /ranked doors here/.test(report.tip) && /on your plan · \d+ on Your list/.test(report.tip), `cloud tooltip (${report.tip})`); // the phone has no hover: a tap opens the sheet instead
await shot("a2-hover");
await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 5 });
// See it on the map: the sentence, the legend, the rows
if (narrow) { await click('#why [data-w="back"]'); await sleep(400); } else await click('#why [data-view="map"]');
await waitFor(`!!document.querySelector("#why .wv-areas .wv-say")`, 10000);
report.say = await ev(`document.querySelector("#why .wv-areas .wv-say").textContent`);
check(/^Qloo's crowd descriptions make \d+ neighbourhoods with a character of their own out of your drinker's Austin: /.test(report.say), `sentence (${report.say})`);
report.rows = await ev(`[...document.querySelectorAll("#why .wv-arow")].map((r) => r.textContent.replace(/\\s+/g, " ").trim())`);
check(report.rows.length >= 8, `rows ${report.rows.length}`);
check(report.rows.some((r) => /^East Cesar Chavez · 17 doors, 11 bars and 4 restaurants\. A music scene: live music fans ×\d\.\d the city\. \d+ on your plan\.$/.test(r)), `ECC row (${report.rows.find((r) => /East Cesar/.test(r))})`);
check(await ev(`document.querySelectorAll("#why .wv-areas .wv-legend span").length === 5`), "five legend classes");
await ev(`document.querySelector("#why .wv-areas").scrollIntoView({block:"start"})`);
await shot("a3-mapview");
// tap a row: the area's doors by fate with Add; the map fits the area (desktop)
await click('#why .wv-arow');
await sleep(1200);
report.sheet = await ev(`document.querySelector("#why .wv-asheet")?.innerText.replace(/\\s+/g, " ").trim().slice(0, 400)`);
check(report.sheet && /ranked doors/.test(report.sheet) && /On your plan · \d+|Not open|Didn't fit|Big names/i.test(report.sheet), `area sheet (${report.sheet})`);
report.sheetAdds = await ev(`document.querySelectorAll("#why .wv-asheet [data-th-add]").length`);
check(report.sheetAdds >= 1, `Add buttons in the sheet (${report.sheetAdds})`);
await shot("a4-sheet");
// tap a pill on the map (desktop: the map is beside; phone: via peek): the sheet follows
if (!narrow) {
  const pill = await ev(`(() => { const cur = document.querySelector("#why .wv-asheet h5")?.textContent; const p = [...document.querySelectorAll(".wv-pill")].find((x) => !x.classList.contains("hid") && x.querySelector("b").textContent !== cur); if (!p) return null; const b = p.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, name: p.querySelector("b").textContent }; })()`);
  if (pill) {
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: pill.x, y: pill.y, button: "left", clickCount: 1 });
    await sleep(1200);
    const h5 = await ev(`document.querySelector("#why .wv-asheet h5")?.textContent`);
    check(h5 === pill.name, `pill tap opens its sheet (${h5} vs ${pill.name})`);
    await shot("a5-pill-tap");
  } else problems.push("no pill to tap");
}
// Add from the sheet: the preview tray shows in the section
// the first Add under a group a day can hold (a door closed on every day says why instead)
await ev(`(() => { const b = [...document.querySelectorAll("#why .wv-asheet [data-th-add]")]; const pick = b.find((x) => !/Not open/i.test(x.closest("ul").previousElementSibling.textContent)) ?? b[0]; pick.scrollIntoView({block: "center"}); pick.setAttribute("data-pick", "1"); })()`);
await click('#why .wv-asheet [data-th-add][data-pick]');
await waitFor(`!!document.querySelector("#why [data-wv-slot=areas] .ws-pv") && !document.querySelector("#why [data-wv-slot=areas] .ws-pv.busy")`, 30000);
report.pv = await ev(`document.querySelector("#why [data-wv-slot=areas] .ws-pv")?.textContent.replace(/\\s+/g, " ").trim()`);
check(/^If you: Add .* to my plan/.test(report.pv) || /^Couldn't add /.test(report.pv), `sheet add preview (${report.pv})`);
await shot("a6-sheet-add");
await click('#why [data-wv-slot=areas] [data-pv="cancel"]');
// close the drawer: the layers and pills go
await ev(`document.querySelector('#why [data-w="close"]')?.click()`);
await sleep(800);
report.pillsAfterClose = await ev(`document.querySelectorAll(".wv-pill").length`);
check(report.pillsAfterClose === 0, `pills cleared on close (${report.pillsAfterClose})`);
report.problems = problems;
fs.writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ok: !problems.length, pills: report.pills.length, shown: shown.length, problems }, null, 1));
process.exit(problems.length ? 1 : 0);
