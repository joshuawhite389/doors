// Round 5 lane filters (Jard 10-27): #3 every explorer filter visible again, calmer by layout (one label column, joined
// compact segments, three groups); #4 the reasons doors are left off as a row of the same grid, with the planner's
// codes under a picked reason; #5 the doors that remain as the drawer's own rows with a + each (no checkboxes, no Add
// selected, no chevrons), the add's preview under the list. Seeds Maya's demo profile (Austin) or Jard's Cincinnati
// test (brand exampl, Budweiser drinkers; the route replays from data/kv-dev, no Qloo call) and walks the Why drawer.
// Usage: node scripts/r5filters-cdp.mjs <base-url> <out-dir> [width] [height] [austin|cincinnati]
import { spawn } from "node:child_process";
import fs from "node:fs";
import { demoProfile } from "../public/lib/demo-profile.js";
import { sampleProfile, citySlug } from "../public/lib/profile.js";
import { storeKey, STORE_VERSION, BRAND_KEY } from "../public/lib/store.js";
const [base, out, w = "1400", h = "900", cityArg = "austin"] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const port = 9400 + Math.floor(Math.random() * 400);
const dir = `/tmp/claude-1000/r5filters-${port}`;
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
const overflows = {};
const shot = async (name) => {
  const { data } = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(`${out}/${name}.png`, Buffer.from(data, "base64"));
  // the phone pass (spec §5): nothing in the drawer may run past its right edge, and the page never scrolls sideways
  const o = await ev(`(() => { const w = document.querySelector("#why"); if (!w || w.hidden) return null; const R = w.getBoundingClientRect().right + 1; const bad = [...w.querySelectorAll("*")].filter((e) => e.getClientRects().length && getComputedStyle(e).overflowX !== "auto" && !e.closest(".wv-tblwrap") && e.getBoundingClientRect().right > R + 2).slice(0, 5).map((e) => e.tagName.toLowerCase() + (e.className && typeof e.className === "string" ? "." + e.className.split(" ")[0] : "") + "+" + Math.round(e.getBoundingClientRect().right - R)); const side = document.documentElement.scrollWidth > innerWidth + 1; return bad.length || side ? { bad, side } : null; })()`);
  if (o) overflows[name] = o;
};
const click = async (sel) => {
  const r = await ev(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.getClientRects().length); if (!e) return null; e.scrollIntoView({block:"center"}); const b = e.getBoundingClientRect(); return {x: b.left + b.width/2, y: b.top + b.height/2}; })()`);
  if (!r) throw new Error(`no visible ${sel}`);
  await sleep(150);
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: r.x, y: r.y, button: "left", clickCount: 1 });
};
const waitFor = async (expr, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(expr)) return true; await sleep(150); } await shot("zz-timeout"); throw new Error(`timed out: ${expr}\n${problems.join("\n")}`); };
const check = (ok, what) => { if (!ok) problems.push(`check failed: ${what}`); };

// Jard's Cincinnati test as he typed it (round 5 shots): a bottled beer called exampl, Budweiser drinkers, a pin downtown
function cincinnatiProfile(today = new Date()) {
  const { sample, ...base } = sampleProfile(today);
  return { ...base, brand: "exampl", what: "Bottled beer", drinks: [{ id: "00000000-0000-4000-8000-19D36E2DCB38", name: "Budweiser", ready: false }],
    city: citySlug("Cincinnati, OH"), cityName: "Cincinnati, OH", cityLive: true, cityCenter: [39.1031, -84.512],
    start: { label: "Your pin on the map", lat: 39.1031, lon: -84.512, source: "pin" }, rooms: ["bars", "restaurants"], roomsTouched: true,
    product: { ...base.product, format: "bottles", size: "12 oz", abv: "5%", na: false }, pitch: { ...base.pitch, name: "Jard" }, known: [] };
}
const prof = cityArg === "cincinnati" ? cincinnatiProfile(new Date()) : demoProfile(new Date());
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
const narrow = +w <= 900;
const report = { width: +w, city: cityArg };
const X = "#why .wv-explorer";
const rowsOf = (sel) => ev(`[...document.querySelectorAll(${JSON.stringify(sel)})].map((r) => r.dataset.wvRow)`);
const count = (sel) => ev(`document.querySelectorAll(${JSON.stringify(sel)}).length`);

await ev(`[...document.querySelectorAll('[data-drawer="why"]')].find((b) => b.getClientRects().length)?.click()`);
await waitFor(`!!document.querySelector("${X} svg .wv-dot")`, 30000);
await sleep(1200);
await shot("f1-home");
// #3 every filter row shows, none folded, no chips; the reasons row sits in the grid under a hairline
report.rows = await rowsOf(`${X} .wv-ctls [data-wv-row]`);
check(report.rows[0] === "x" && report.rows.includes("rooms") && report.rows.includes("r45") && report.rows.at(-1) === "reasons", `every row inline, Across first, the reasons last (${report.rows.join()})`);
check((await count(`${X} [data-wv-more], ${X} [data-wv-more-panel], ${X} .wv-fchip, ${X} .wv-morebtn`)) === 0, "no More filters fold, no chips");
check(await ev(`document.querySelector("${X} [data-wv-logi]").hidden`), "no list until a reason is picked");
check((await count(`${X} .wv-h`)) === 0, "no section heading inside the explorer");
report.reasons = await ev(`[...document.querySelectorAll("${X} [data-wv-fate]")].map((b) => b.textContent)`);
check(report.reasons.length >= 2 && report.reasons.every((t) => /\D\d+$/.test(t)), `reason segments with counts (${report.reasons.join(" | ")})`);
// how tall the controls are, and how many lines each row's segments wrap to (the calm claim, in numbers)
report.ctls = await ev(`(() => { const rows = [...document.querySelectorAll("${X} .wv-ctl")]; const top = rows[0].getBoundingClientRect().top, bot = rows.at(-1).getBoundingClientRect().bottom; return { height: Math.round(bot - top), lines: rows.map((r) => { const segs = r.querySelector(".wv-segs"); const b = segs.querySelector(".wv-seg"); return b ? Math.round(segs.getBoundingClientRect().height / b.getBoundingClientRect().height) : 0; }) }; })()`);
await ev(`document.querySelector("${X} .wv-ctls").scrollIntoView({block:"start"})`);
await sleep(200);
await shot("f1b-controls");
// #4 a reason: the picture keeps those doors (the rest fade), the map rings them, and #5 the rows with a + show
await click(`${X} [data-wv-fate="route"]`);
await sleep(900);
report.route = await ev(`(() => { const rows = [...document.querySelectorAll("${X} .wv-logi-rows li")]; return { n: rows.length, texts: rows.slice(0, 3).map((l) => l.textContent.replace(/\\s+/g, " ").trim()), adds: rows.filter((l) => l.querySelector(".w-addt")).length, addText: rows[0]?.querySelector(".w-addt")?.textContent.trim(), addIcon: !!rows[0]?.querySelector(".w-addt svg"), opens: rows.filter((l) => l.querySelector("button[data-door] b")).length, boxes: document.querySelectorAll("${X} input[type=checkbox]").length, chevrons: document.querySelectorAll("${X} .wv-logi-open, ${X} [data-wv-logi='add'], ${X} [data-wv-logi='all']").length, head: document.querySelector("${X} .wv-logi-head")?.textContent.replace(/\\s+/g, " ").trim(), codes: [...document.querySelectorAll("${X} [data-wv-code]")].map((b) => b.textContent), faded: [...document.querySelectorAll("${X} .wv-dot")].filter((c) => +c.getAttribute("opacity") <= 0.3).length, tray: document.querySelector("#why .w-tray")?.textContent.replace(/\\s+/g, " ").trim() ?? null, hidden: document.querySelector("${X} [data-wv-logi]").hidden }; })()`);
check(!report.route.hidden && report.route.n >= 1, `the list shows for the picked reason (${report.route.n} rows)`);
check(report.route.adds === report.route.n && report.route.opens === report.route.n, `every row: the name opens the door, a + Add adds it (${report.route.adds} +, ${report.route.opens} names of ${report.route.n})`);
check(report.route.addText === "Add" && report.route.addIcon, `the add control says Add with a plus icon (${report.route.addText})`);
check(report.route.texts.every((t) => !/re-plan|has room for it only|had no time left/.test(t)), `the rows' reasons are the short lines (${report.route.texts[0]})`);
check(report.route.boxes === 0 && report.route.chevrons === 0, "no checkboxes, no chevrons, no Add selected / Select all");
check(/^\d+ doors? left off for that reason\./.test(report.route.head ?? ""), `the list's head (${report.route.head})`);
check(report.route.texts.every((t) => /on Your list · |Most popular|Not on Your list/.test(t)), `each row says where it stands and the planner's reason (${report.route.texts[0]})`);
check(report.route.faded >= 10, `the other dots fade (${report.route.faded} faded)`);
if (!narrow) check(/Doors left off for that reason · \d+ doors? ringed on the map/.test(report.route.tray ?? ""), `the picked doors ring on the map (${report.route.tray})`);
await ev(`document.querySelector("${X} .wv-ctls").scrollIntoView({block:"start"})`);
await sleep(200);
await shot("f2-reason-route");
await ev(`document.querySelector("${X} [data-wv-logi]").scrollIntoView({block:"start"})`);
await sleep(200);
await shot("f2b-reason-list");
// the codes narrow the list, from the row under the reason
if (report.route.codes.length >= 2) {
  check(report.route.codes.every((c) => /\D\d+$/.test(c) && !/^[a-z-]+ ·/.test(c)), `the planner's codes in words, with counts (${report.route.codes.join(" | ")})`);
  const code0 = await ev(`document.querySelector("${X} [data-wv-code]").dataset.wvCode`);
  const codeN = await ev(`+/(\\d+)$/.exec(document.querySelector("${X} [data-wv-code]").textContent)[1]`);
  await click(`${X} [data-wv-code="${code0}"]`);
  await sleep(700);
  report.codeRows = await ev(`+/^(\\d+)/.exec(document.querySelector("${X} .wv-logi-head").textContent)[1]`);
  check(report.codeRows === codeN, `a code narrows the list to its count (${report.codeRows} vs ${codeN})`);
  await ev(`document.querySelector("${X} .wv-ctls").scrollIntoView({block:"start"})`);
  await sleep(200);
  await shot("f3-code");
  await click(`${X} [data-wv-code="${code0}"]`);
  await sleep(700);
}
// #5 a row's +: the preview tray shows right under the list, one tray only; Apply puts that door on a day; Undo takes it back
// the third row's + Add (not the first: the preview must open under THAT row, in view, with focus on it)
const rowN = Math.min(3, report.route.n);
const first = await ev(`document.querySelectorAll("${X} .wv-logi-rows li b")[${rowN - 1}]?.textContent`);
await ev(`document.querySelector("#why").scrollTop = 0`);
await sleep(150);
await click(`${X} .wv-logi-rows li:nth-child(${rowN}) .w-addt`);
await waitFor(`!!document.querySelector("${X} [data-wv-logi] .ws-pv") && !document.querySelector("${X} [data-wv-logi] .ws-pv.busy")`, 40000);
await sleep(500);
report.pv = await ev(`(() => { const li = document.querySelector("${X} [data-wv-logi-pv]"); const prev = li?.previousElementSibling; const r = li?.getBoundingClientRect(); const w = document.querySelector("#why").getBoundingClientRect(); return { text: li?.textContent.replace(/\\s+/g, " ").trim(), under: prev?.querySelector("b")?.textContent, focused: document.activeElement === li, inView: !!r && r.top >= w.top && r.bottom <= w.bottom + 2 }; })()`);
check(/^If you: Add /.test(report.pv.text ?? "") || /^Couldn't|^Doors couldn't/.test(report.pv.text ?? ""), `the preview opened (${report.pv.text?.slice(0, 120)})`);
check(report.pv.under === first, `the preview sits right under the row whose + Add was pressed (${report.pv.under} vs ${first})`);
check(report.pv.inView && report.pv.focused, `the preview is in view and has focus (inView ${report.pv.inView}, focused ${report.pv.focused})`);
check((await count("#why .ws-pv")) === 1, "one preview tray, under its row, not at the top too");
await shot("f4-add-preview");
if (await ev(`!!document.querySelector("${X} [data-wv-logi] [data-pv='apply']")`)) {
  const stopsBefore = await ev(`document.querySelectorAll(".stop[data-id]").length`);
  await click(`${X} [data-wv-logi] [data-pv='apply']`);
  await sleep(4500);
  report.flash = await ev(`document.querySelector(".toast, .flash, [role=status].toast")?.textContent ?? ""`);
  report.stops = [stopsBefore, await ev(`document.querySelectorAll(".stop[data-id]").length`)];
  check(report.stops[1] === report.stops[0] + 1 || /Added/.test(report.flash), `Apply adds the door (${report.stops.join("→")}; ${report.flash.slice(0, 80)})`);
  report.stillListed = await ev(`[...document.querySelectorAll("${X} .wv-logi-rows b")].map((b) => b.textContent)`);
  check(first && !report.stillListed.includes(first), `the added door leaves the list (${first})`);
  await shot("f5-added");
  const undo = await ev(`(() => { const b = [...document.querySelectorAll(".toast button, .flash button, [role=status] button")].find((x) => /undo/i.test(x.textContent)); if (b) { b.click(); return true; } return false; })()`);
  if (undo) { await sleep(4000); report.stopsUndo = await ev(`document.querySelectorAll(".stop[data-id]").length`); check(report.stopsUndo === stopsBefore, `Undo puts it back (${report.stopsUndo} vs ${stopsBefore})`); }
  else problems.push("no Undo on the flash");
} else await click(`${X} [data-wv-logi] [data-pv='cancel']`);
// unpick: the list goes, the map rings go
await click(`${X} [data-wv-fate="route"]`);
await sleep(600);
check(await ev(`document.querySelector("${X} [data-wv-logi]").hidden && !document.querySelector("#why .w-tray")`), "unpicking the reason hides the list and clears the map rings");
// the other rows still try a change and the chips are gone for good: a door type → Apply enabled, "If you:" names it
await click(`${X} [data-wv-row="rooms"] [data-wv-v]:not([aria-pressed="true"])`);
await waitFor(`!!document.querySelector("${X} [data-wv-act=apply]:not([disabled])")`, 40000);
report.ifYou = await ev(`document.querySelector("${X} [data-wv-acts] .wv-hint")?.textContent ?? ""`);
check(/^If you: /.test(report.ifYou) && (await count(`${X} .wv-fchip`)) === 0, `a changed setting previews and the hint names it, no chip (${report.ifYou.slice(0, 60)})`);
await ev(`document.querySelector("${X} .wv-ctls").scrollIntoView({block:"start"})`);
await sleep(200);
await shot("f6-setting-changed");
await click(`${X} [data-wv-act=reset]`);
await sleep(600);

report.problems = problems;
report.overflows = overflows;
fs.writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ok: !problems.length && !Object.keys(overflows).length, ctls: report.ctls, problems, overflows }, null, 2));
process.exit(problems.length || Object.keys(overflows).length ? 1 : 0);
