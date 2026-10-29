// Round 5 lane crowd (Jard 10-27, Cincinnati, brand "exampl", Budweiser drinkers): #1 the Who view (the drinkers icon,
// one sentence, no "0 doors Qloo describes", the Settings link not clipped); #2a real crowd groups on the neighbourhood
// map of a live city; #2b the Neighbourhoods toggle on the plan map and a pill tapped opening the drawer on that area.
// Seeds a live Cincinnati profile (the run comes from the dev server's KV cache: no Qloo call) and shoots each state.
// Usage: node scripts/r5crowd-cdp.mjs <base-url> <out-dir> [width] [height]
import { spawn } from "node:child_process";
import fs from "node:fs";
import { emptyProfile, emptyProduct, isoDate } from "../public/lib/profile.js";
import { storeKey, STORE_VERSION, BRAND_KEY } from "../public/lib/store.js";
const [base, out, w = "1400", h = "900"] = process.argv.slice(2);
const BEFORE = !!process.env.BEFORE; // the base (no toggle): shoot the Who view and the drawer's map view for the before/after pair
fs.mkdirSync(out, { recursive: true });
const port = 9400 + Math.floor(Math.random() * 400);
const dir = `/tmp/claude-1000/r5crowd-${port}`;
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
  if (!r) { await shot("zz-noclick"); throw new Error(`no visible ${sel}`); }
  await sleep(150);
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: r.x, y: r.y, button: "left", clickCount: 1 });
};
const waitFor = async (expr, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(expr)) return true; await sleep(150); } await shot("zz-timeout"); throw new Error(`timed out: ${expr}\n${problems.join("\n")}`); };
const check = (ok, what) => { if (!ok) problems.push(`check failed: ${what}`); };
const text = (sel) => ev(`document.querySelector(${JSON.stringify(sel)})?.textContent.replace(/\\s+/g, " ").trim() ?? null`);

// Jard's profile (shot 151838): exampl, Cincinnati OH, Budweiser drinkers, Wed/Fri/Sat/Sun
const today = new Date();
const next = (js) => { const d = new Date(today.getFullYear(), today.getMonth(), today.getDate()); do d.setDate(d.getDate() + 1); while (d.getDay() !== js); return d; };
const windows = [3, 5, 6, 0].map((js) => ({ date: isoDate(next(js)), from: "14:00", to: "19:00" })).sort((a, b) => a.date.localeCompare(b.date));
const prof = {
  ...emptyProfile(), brand: "exampl", what: "Lager",
  drinks: [{ id: "00000000-0000-4000-8000-19D36E2DCB38", name: "Budweiser", ready: false, where: "" }],
  city: "cincinnati-oh", cityName: "Cincinnati, OH", cityLive: true, cityCenter: [39.1402, -84.5058],
  rooms: ["bars", "restaurants"], roomsTouched: true,
  start: { label: "Fountain Square, Cincinnati", lat: 39.1017, lon: -84.5125 },
  windows, visitMin: 25,
  product: { ...emptyProduct(), format: "cans", size: "12 oz", abv: "5%" }, sells: ["self"],
  pitch: { price: "$30 a case of 24", ask: "one case in the cooler", support: ["samples"], name: "Jard" },
};
const key = storeKey(prof.brand, prof.city);
const state = { v: STORE_VERSION, brand: prof.brand, city: prof.city, profile: prof, plan: null, statuses: {}, outcomes: {}, savedAt: new Date().toISOString() };
await send("Runtime.enable"); await send("Page.enable");
await send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => { try { if (!localStorage.getItem("__seeded")) { localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify(state))}); localStorage.setItem(${JSON.stringify(BRAND_KEY)}, ${JSON.stringify(JSON.stringify({ v: STORE_VERSION, profile: prof, savedAt: new Date().toISOString() }))}); localStorage.setItem("doors:drive-voice", "off"); localStorage.setItem("__seeded", "1"); } } catch {} window.SpeechRecognition = undefined; delete window.webkitSpeechRecognition; })();` });
await send("Emulation.setDeviceMetricsOverride", { width: +w, height: +h, deviceScaleFactor: 1, mobile: +w < 700 });
const q = new URLSearchParams({ brand: prof.brand, city: prof.city });
await send("Page.navigate", { url: `${base}/app?ors=off&instant=1#/plan?${q}` });
await waitFor(`!!document.querySelector(".stop[data-id]")`, 90000);
await sleep(2500);
const narrow = +w <= 900;
const report = { width: +w };
await shot("p1-plan");
// #2b the toggle on the plan map, on any tab (the first day is up, not All days)
report.toggle = await ev(`(() => { const b = document.querySelector("#t-hoods"); return b && b.getClientRects().length ? { text: b.textContent.trim(), pressed: b.getAttribute("aria-pressed") } : null; })()`);
if (!BEFORE) check(report.toggle && report.toggle.text === "Neighbourhoods" && report.toggle.pressed === "false", `the Neighbourhoods toggle on the plan map (${JSON.stringify(report.toggle)})`);
if (report.toggle) {
  await click("#t-hoods");
  await waitFor(`document.querySelectorAll(".wv-pill:not(.hid)").length >= 2 && !document.querySelector("#p-hoodleg").hidden`, 30000);
  await sleep(1200);
  report.pills = await ev(`[...document.querySelectorAll(".wv-pill:not(.hid)")].map((p) => p.textContent.replace(/\\s+/g, " ").trim())`);
  report.legend = await ev(`[...document.querySelectorAll("#p-hoodleg span")].map((s) => s.textContent.trim())`);
  report.washClasses = await ev(`(() => { const st = document.querySelector("#plan-map")?.__wvAreas ?? null; return null; })()`);
  check(report.pills.length >= 3, `pills on the plan map (${report.pills.join(" | ")})`);
  if (!narrow) check(report.legend.length >= 2 && report.legend.filter((t) => t !== "no group stands out").length >= 2, `legend with real groups, not only no-standout (${report.legend.join(", ")})`);
else check(await ev(`getComputedStyle(document.querySelector("#p-hoodleg")).display === "none"`), "the phone keeps the legend off the small map");
  await shot("p2-hoods-on");
  // a pill tapped opens the drawer on that area
  const target = await ev(`(() => { const p = [...document.querySelectorAll(".wv-pill:not(.hid)")].find((x) => /Over-the-Rhine|Oakley|Central Business/.test(x.textContent)) ?? document.querySelector(".wv-pill:not(.hid)"); if (!p) return null; const b = p.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, name: p.querySelector("b")?.textContent ?? p.textContent }; })()`);
  if (target) {
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: target.x, y: target.y, button: "left", clickCount: 1 });
    await waitFor(`!document.querySelector("#why").hidden && !!document.querySelector("#why .wv-asheet")`, 30000);
    await sleep(1000);
    report.sheet = await text("#why .wv-ashead h5");
    report.drawerTitle = await text("#why .w-head h3");
    check(report.sheet === target.name, `the drawer opens on the tapped area (${report.sheet} vs ${target.name})`);
    check(report.drawerTitle === "See it on the map", `the drawer's map view (${report.drawerTitle})`);
    check(await ev(`getComputedStyle(document.querySelector("#p-hoods")).display === "none"`), "the toggle hides while the drawer paints its own clouds");
    await shot("p3-area-from-pill");
    // #2a the city by neighbourhood: real groups, the sentence names them, a source with a base
    report.rows = await ev(`[...document.querySelectorAll("#why .wv-arows .wv-arow")].map((r) => r.textContent.replace(/\\s+/g, " ").trim())`);
    report.areasSay = await text("#why .wv-areas .wv-say, #why .wv-areas p");
    report.areasSrc = await text("#why .wv-areas .wv-src");
    const named = report.rows.filter((r) => !/No group stands out/.test(r)).length;
    check(named >= Math.ceil(report.rows.length / 2), `most neighbourhoods have a group (${named} of ${report.rows.length})`);
    check(!/over the 0 doors/.test(report.areasSrc ?? ""), `the areas source counts a base (${report.areasSrc})`);
  } else problems.push("no pill to tap");
  await ev(`document.querySelector('#why [data-w="close"]').click()`);
  await sleep(800);
  await waitFor(`document.querySelector("#t-hoods").getAttribute("aria-pressed") === "true" && document.querySelectorAll(".wv-pill:not(.hid)").length >= 2`, 8000).catch(() => problems.push("the plan's clouds come back after the drawer closes"));
  await sleep(300);
  await click("#t-hoods");
  await sleep(600);
  check(await ev(`document.querySelectorAll(".wv-pill:not(.hid)").length === 0 && document.querySelector("#p-hoodleg").hidden`), "toggle off clears the clouds and the legend");
}
// #1 the Who view
await ev(`[...document.querySelectorAll('[data-drawer="why"]')].find((b) => b.getClientRects().length)?.click()`);
await waitFor(`!!document.querySelector("#why .ws-jobs")`, 30000);
await sleep(600);
if (BEFORE) { // the base's only way to the neighbourhood map: the drawer's See it on the map
  await ev(`document.querySelector('#why [data-view="map"]').click()`);
  await waitFor(`!!document.querySelector("#why .wv-areas")`, 20000);
  await sleep(1500);
  await shot("p3-mapview");
  await ev(`document.querySelector('#why [data-w="list"]').click()`);
  await sleep(600);
}
await ev(`document.querySelector('#why [data-view="who"]').click()`);
await waitFor(`!!document.querySelector("#why .wv-lift")`, 20000);
await sleep(800);
report.who = await ev(`(() => { const w = document.querySelector("#why"); const R = w.getBoundingClientRect(); const lnk = w.querySelector(".w-setlink .lnk"); const lb = lnk?.getBoundingClientRect(); const t = w.textContent.replace(/\\s+/g, " "); return { icon: !!w.querySelector(".w-who .w-ico svg path"), iconDoorSet: w.querySelector(".w-who .w-ico svg")?.classList.contains("ic") ?? false, noneCount: (t.match(/Qloo names no crowd group/g) ?? []).length, zeroBase: /the 0 doors Qloo describes/.test(t), rows: w.querySelectorAll(".wv-lift-row").length, src: w.querySelector(".wv-lift .wv-src")?.textContent, linkLeft: lb ? Math.round(lb.left - R.left) : null, linkClipped: lb ? lb.left < R.left + 8 : null, say: w.querySelector(".wv-lift .wv-say")?.textContent }; })()`);
if (!BEFORE) {
  check(report.who.icon && report.who.iconDoorSet, "the drinkers icon from the Doors set");
  check(report.who.noneCount <= 1, `the no-group sentence at most once (${report.who.noneCount})`);
  check(!report.who.zeroBase, "no '0 doors Qloo describes'");
  check(report.who.rows >= (narrow ? 1 : 3), `lift rows for Cincinnati (${report.who.rows}; the phone keeps the far-above and far-below rows)`);
  check(report.who.linkClipped === false, `the Settings link clear of the left edge (left ${report.who.linkLeft})`);
}
await shot("p4-who");
await ev(`document.querySelector("#why").scrollTo(0, 1e6)`);
await sleep(400);
await shot("p5-who-bottom");
report.problems = problems;
fs.writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ok: !problems.length, problems }, null, 1));
process.exit(problems.length ? 1 : 0);
