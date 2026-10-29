// Round 8 lane mapmenu (Jard 10-28: the map's layer toggles collapse into one small see-through Doors-logo button with a caret; a full screen map button for all versions),
// proven in headless Chromium over CDP. Seeds Maya's profile (as r8phone-cdp.mjs) and, on a day's tab: the Other days
// pill sits by Neighbourhoods on one row, covering no map control, the tools or the Agent button; on (default) the other
// days' faded pins and route layers are on the map; off → only the day on screen (no faint pin, one route layer), the
// camera and Neighbourhoods pill unmoved; All days ignores it (every route, the pill hidden); back on a day it still
// holds; a reload keeps the choice (localStorage); on again → the others return; Your list hides the pill.
// --before: the first shot only (a base build has no pill). Prints a JSON report and "problems none".
// Usage: node scripts/r8maptoggle-cdp.mjs <base-url> <out-dir> [width] [height] [--before]
import { spawn } from "node:child_process";
import fs from "node:fs";
import { demoProfile } from "../public/lib/demo-profile.js";
import { storeKey, STORE_VERSION, BRAND_KEY } from "../public/lib/store.js";
const before = process.argv.includes("--before");
const [base, out, w = "390", h = "844"] = process.argv.slice(2).filter((a) => a !== "--before");
fs.mkdirSync(out, { recursive: true });
const port = 9950 + Math.floor(Math.random() * 40);
const dir = `/tmp/claude-1000/r8mapmenu-${port}`;
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
const send = (method, params = {}) => new Promise((r, j) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => { if (pend.has(i)) { pend.delete(i); j(new Error(`CDP ${method} hung`)); } }, 60000); });
const log = (s) => process.stderr.write(`· ${s}\n`);
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result?.value; };
const shot = async (name) => { log(`shot ${name}`); const { data } = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(`${out}/${name}.png`, Buffer.from(data, "base64")); };
const centre = (sel) => ev(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.getClientRects().length); if (!e) return null; const b = e.getBoundingClientRect(); return {x: b.left + b.width/2, y: b.top + b.height/2}; })()`);
const mouse = async (type, x, y) => send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", clickCount: 1 });
const click = async (sel) => {
  await ev(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.getClientRects().length); e?.scrollIntoView({block:"center"}); })()`);
  await sleep(120);
  const r = await centre(sel);
  if (!r) throw new Error(`no visible ${sel}`);
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await mouse(type, r.x, r.y);
};
const waitFor = async (expr, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(expr)) return true; await sleep(150); } await shot("zz-timeout"); throw new Error(`timed out: ${expr}\n${problems.join("\n")}`); };
const check = (ok, what) => { if (!ok) problems.push(`check failed: ${what}`); };
const rect = (sel) => ev(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.getClientRects().length); if (!e) return null; const b = e.getBoundingClientRect(); return { l: +b.left.toFixed(1), t: +b.top.toFixed(1), r: +b.right.toFixed(1), b: +b.bottom.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) }; })()`);
const visible = (sel) => ev(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.getClientRects().length); if (!e) return false; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; })()`);
const overlap = (a, b) => !!a && !!b && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
// the map's state through the page's own module (ui/state.js is a singleton in the page)
const mapState = () => ev(`import("/ui/state.js").then((S) => { const m = S.getMap(); if (!m) return null; const c = m.getCenter(); return { routes: m.getStyle().layers.map((l) => l.id).filter((x) => /^route-d\\d+$/.test(x)).sort(), center: [+c.lng.toFixed(5), +c.lat.toFixed(5)], zoom: +m.getZoom().toFixed(3), faint: document.querySelectorAll(".mpin.faint").length, pins: document.querySelectorAll(".mpin").length, numbered: [...document.querySelectorAll(".mpin:not(.faint)")].filter((p) => /\\d/.test(p.textContent)).length }; })`);
const stored = () => ev(`(() => { try { return localStorage.getItem("doors:map-other-days"); } catch { return "n/a"; } })()`);
const report = { width: +w, height: +h, steps: [] };
const step = async (name, extra = {}) => { await sleep(600); await shot(name); const st = await mapState(); report.steps.push({ name, ...st, ...extra }); return st; };

const prof = demoProfile(new Date());
prof.known = [];
const key = storeKey(prof.brand, prof.city);
await send("Runtime.enable"); await send("Page.enable");
const state = { v: STORE_VERSION, brand: prof.brand, city: prof.city, profile: prof, plan: null, statuses: {}, outcomes: {}, savedAt: new Date().toISOString() };
await send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => { try { if (!localStorage.getItem("__seeded")) { localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify(state))}); localStorage.setItem(${JSON.stringify(BRAND_KEY)}, ${JSON.stringify(JSON.stringify({ v: STORE_VERSION, profile: prof, savedAt: new Date().toISOString() }))}); localStorage.setItem("doors:drive-voice", "off"); localStorage.setItem("__seeded", "1"); } } catch {} window.SpeechRecognition = undefined; delete window.webkitSpeechRecognition; })();` });
const phone = +w <= 700;
await send("Emulation.setDeviceMetricsOverride", { width: +w, height: +h, deviceScaleFactor: 1, mobile: phone });
if (phone) await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
const q = new URLSearchParams({ brand: prof.brand, city: prof.city });
const planReady = `!!document.querySelector(".stop[data-id]") && !document.querySelector("[data-b2]")`;
await send("Page.navigate", { url: `${base}/app?ors=off&instant=1#/plan?${q}` });
await waitFor(planReady, 40000);
await sleep(2500);
await send("Page.reload"); await waitFor(planReady, 40000); await sleep(3000);
await waitFor(`document.querySelectorAll(".mpin").length > 0`, 20000);
// ---- 1. the map at rest: one small button top-left, the toggles shut ----
const s1 = await step("01-rest");
if (before) { report.problems = problems; console.log(JSON.stringify(report, null, 1)); console.log("before: first shot only"); process.exit(0); }
const mapR = await rect("#plan-map");
const lay1 = await rect("#t-layers");
check(await visible("#t-layers"), "the layers button shows");
check(!(await visible("#p-layers")), "the toggles are shut by default");
check(!(await visible("#t-hoods")) && !(await visible("#t-others")), "neither pill shows while shut");
check(lay1 && lay1.w <= 60 && lay1.h <= 40, `the button is small (${JSON.stringify(lay1)})`);
check(lay1 && lay1.l >= mapR.l && lay1.t >= mapR.t && lay1.l - mapR.l < 40 && lay1.t - mapR.t < 30, `the button sits at the map's top-left (${JSON.stringify(lay1)} in ${JSON.stringify(mapR)})`);
const bg = await ev(`getComputedStyle(document.querySelector("#t-layers")).backgroundColor`);
check(/rgba\(.*, 0\.\d+\)$/.test(bg), `the button is see-through (${bg})`);
check((await ev(`document.querySelector("#t-layers").getAttribute("aria-expanded")`)) === "false", "aria-expanded false at rest");
for (const sel of [".maplibregl-ctrl-top-right", ".maplibregl-ctrl-top-left", ".maplibregl-ctrl-bottom-right", ".maplibregl-ctrl-bottom-left", ".tools", ".btn.ask", ".runbar", "#p-weeklegend"]) {
  const r = await rect(sel);
  if (r && r.w && r.h && (await visible(sel))) check(!overlap(lay1, r), `the button does not cover ${sel} (${JSON.stringify(r)})`);
}
check(await visible(".maplibregl-ctrl-fullscreen"), "the full screen button shows by the zoom buttons");
const fsR = await rect(".maplibregl-ctrl-fullscreen"), zoomR = await rect(".maplibregl-ctrl-zoom-in");
check(fsR && zoomR && fsR.b <= zoomR.t + 1 && Math.abs(fsR.l - zoomR.l) < 2, `the full screen button sits above zoom in (${JSON.stringify(fsR)} / ${JSON.stringify(zoomR)})`);

// ---- 2. tap opens the toggles ----
await click("#t-layers");
await sleep(300);
const s2 = await step("02-open");
check(await visible("#p-layers"), "a tap opens the toggles");
check(await visible("#t-hoods") && await visible("#t-others"), "both pills show in the open menu");
check((await ev(`document.querySelector("#t-layers").getAttribute("aria-expanded")`)) === "true", "aria-expanded true when open");
const panel = await rect("#p-layers");
check(panel && panel.t >= lay1.b && panel.r <= mapR.r && panel.b <= mapR.b, `the panel hangs under the button inside the map (${JSON.stringify(panel)})`);
check(s2.center.join() === s1.center.join() && s2.zoom === s1.zoom, "opening moved no camera");

// ---- 3. the toggles still work from the menu: Other days off ----
check((await ev(`document.querySelector("#t-others")?.getAttribute("aria-pressed")`)) === "true", "Other days is on by default");
await click("#t-others");
await waitFor(`document.querySelectorAll(".mpin.faint").length === 0`, 8000);
const s3 = await step("03-others-off", { stored: await stored() });
check(s3.faint === 0 && s3.routes.length === 1, `Other days off from the menu: the day alone (${s3.faint} faint, ${s3.routes.join(",")})`);
check(await visible("#p-layers"), "the menu stays open after a toggle");
check((await stored()) === "off", "the choice is saved as off");
await click("#t-others");
await waitFor(`document.querySelectorAll(".mpin.faint").length > 0`, 8000);
const s3b = await step("03b-others-on");
check(s3b.faint === s1.faint && s3b.routes.join() === s1.routes.join(), `Other days back on from the menu (${s3b.faint} faint)`);

// ---- 4. Neighbourhoods on from the menu → the dot on the button ----
await click("#t-hoods");
await waitFor(`document.querySelector("#t-hoods").getAttribute("aria-pressed") === "true"`);
await sleep(2500);
const s4 = await step("04-hoods-on");
check((await ev(`document.querySelector("#t-layers").dataset.on`)) === "true", "the button carries the on-dot while Neighbourhoods is on");
const dot = await ev(`getComputedStyle(document.querySelector("#t-layers"), "::before").width`);
check(dot && dot !== "0px" && dot !== "auto", `the dot is painted (${dot})`);

// ---- 5. tap again shuts; the layer stays on ----
await click("#t-layers");
await sleep(300);
const s5 = await step("05-shut-hoods-on");
check(!(await visible("#p-layers")), "a second tap shuts the toggles");
check((await ev(`document.querySelector("#t-layers").dataset.on`)) === "true", "the dot stays while shut");
check(s5.center.join() === s1.center.join() && s5.zoom === s1.zoom, "shutting moved no camera");

// ---- 6. Neighbourhoods off again (a tap on a cloud would open the Why drawer); a tap outside shuts ----
await click("#t-layers"); await sleep(200); await click("#t-hoods"); await sleep(600);
check((await ev(`document.querySelector("#t-layers").dataset.on`)) === "false", "the dot goes when Neighbourhoods is off");
check(await visible("#p-layers"), "open again");
// a spot of the map under no pin, marker or control
const spot = await ev(`(() => { const m = document.querySelector("#plan-map").getBoundingClientRect(); const boxes = [...document.querySelectorAll("#plan-map .maplibregl-marker, #plan-map .mpin, #plan-map .maplibregl-ctrl, #p-hoods, #plan-map .maplibregl-popup")].map((e) => e.getBoundingClientRect()).filter((r) => r.width && r.height); for (let fy = 0.9; fy > 0.2; fy -= 0.08) for (let fx = 0.15; fx < 0.9; fx += 0.08) { const x = m.left + m.width * fx, y = m.top + m.height * fy; if (!boxes.some((r) => x > r.left - 14 && x < r.right + 14 && y > r.top - 14 && y < r.bottom + 14)) return { x, y }; } return null; })()`);
check(!!spot, "a free spot of the map to tap");
await mouse("mouseMoved", spot.x, spot.y); await mouse("mousePressed", spot.x, spot.y); await mouse("mouseReleased", spot.x, spot.y);
await sleep(500);
const s6 = await step("06-outside-shut");
check(!(await visible("#p-layers")), "a tap on the map outside shuts the toggles");
check(s6.center.join() === s1.center.join() && s6.zoom === s1.zoom, "the outside tap moved no camera");
check(await visible("#t-layers"), "the layers button is still there (no drawer opened)");
// Escape shuts too
await click("#t-layers"); await sleep(200);
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }); await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
await sleep(300);
check(!(await visible("#p-layers")), "Escape shuts the toggles");

// ---- 7. a reload: shut again (quiet by default) ----
await send("Page.reload"); await waitFor(planReady, 40000); await sleep(3000);
await waitFor(`document.querySelectorAll(".mpin").length > 0`, 20000);
await sleep(600);
check(!(await visible("#p-layers")), "shut after a reload");

// ---- 8. full screen, both ways: the Fullscreen API (desktop, Android) and the pseudo path (an iPhone: the API
// deleted from the page). Escape is checked on the pseudo path only: a synthetic Escape cannot leave browser full screen.
const FS = `document.querySelector("#plan-map").classList.contains("maplibregl-pseudo-fullscreen") || document.fullscreenElement === document.querySelector("#plan-map")`;
const fullWalk = async (mode) => {
  if (mode === "pseudo") await ev(`(() => { delete Element.prototype.requestFullscreen; delete Element.prototype.webkitRequestFullscreen; return typeof document.querySelector("#plan-map").requestFullscreen; })()`);
  const pre = await mapState();
  await click(".maplibregl-ctrl-fullscreen");
  await sleep(900);
  const s8 = await step(`08-${mode}-fullscreen`);
  const full = await ev(`(() => { const m = document.querySelector("#plan-map"); const r = m.getBoundingClientRect(); return { pseudo: m.classList.contains("maplibregl-pseudo-fullscreen"), api: document.fullscreenElement === m, mapfull: m.classList.contains("mapfull"), l: r.left, t: r.top, w: r.width, h: r.height, iw: innerWidth, ih: innerHeight }; })()`);
  check(mode === "pseudo" ? full.pseudo && !full.api : full.api && !full.pseudo, `${mode}: the map went full screen the ${mode} way (${JSON.stringify(full)})`);
  check(full.mapfull, `${mode}: the mapfull class is on`);
  check(full.l === 0 && full.t === 0 && full.w === full.iw && full.h === full.ih, `${mode}: the map fills the viewport (${JSON.stringify(full)})`);
  check(await visible(".mapfull-exit .btn"), `${mode}: an Exit full screen button shows`);
  check(await visible(".maplibregl-ctrl-shrink"), `${mode}: the button turned into shrink`);
  check(await visible("#t-layers"), `${mode}: the layers button is there in full screen`);
  check(await visible(".maplibregl-ctrl-zoom-in"), `${mode}: zoom is there in full screen`);
  check(s8.center.join() === pre.center.join(), `${mode}: the view's centre is kept (${pre.center} → ${s8.center})`);
  const exitR = await rect(".mapfull-exit .btn"), lay8 = await rect("#t-layers");
  check(exitR && lay8 && !overlap(exitR, lay8) && exitR.r <= full.w && lay8.l >= 0, `${mode}: exit top-right, layers top-left (${JSON.stringify(exitR)} / ${JSON.stringify(lay8)})`);
  await click("#t-layers"); await sleep(300);
  check(await visible("#p-layers") && await visible("#t-hoods"), `${mode}: the layer menu opens inside full screen`);
  await step(`09-${mode}-fullscreen-menu`);
  await click("#t-layers"); await sleep(200);
  await click(".maplibregl-ctrl-zoom-in"); await sleep(900);
  const z = await mapState();
  check(z.zoom > s8.zoom, `${mode}: zoom in works in full screen (${s8.zoom} → ${z.zoom})`);
  await click(".maplibregl-ctrl-zoom-out"); await sleep(900);
  if (mode === "pseudo") {
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }); await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
    await sleep(900);
    check(!(await ev(FS)), "pseudo: Escape leaves full screen");
  } else { await click(".mapfull-exit .btn"); await sleep(900); check(!(await ev(FS)), "api: the Exit button leaves full screen"); }
  const after = await ev(`(() => { const m = document.querySelector("#plan-map"); const r = m.getBoundingClientRect(); return { l: +r.left.toFixed(1), t: +r.top.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1), mapfull: m.classList.contains("mapfull") }; })()`);
  check(!after.mapfull, `${mode}: the mapfull class went`);
  check(Math.abs(after.l - mapR.l) < 1 && Math.abs(after.t - mapR.t) < 1 && Math.abs(after.w - mapR.w) < 1 && Math.abs(after.h - mapR.h) < 1, `${mode}: the map is back where it was (${JSON.stringify(after)} vs ${JSON.stringify(mapR)})`);
  check(!(await visible(".mapfull-exit .btn")), `${mode}: the Exit button went`);
  check(await visible(".maplibregl-ctrl-fullscreen"), `${mode}: the button is the expand icon again`);
  const s10 = await step(`10-${mode}-back`);
  check(s10.center.join() === pre.center.join() && Math.abs(s10.zoom - pre.zoom) < 0.01, `${mode}: the view is kept after leaving (${pre.center}@${pre.zoom} → ${s10.center}@${s10.zoom})`);
  // the other exits
  await click(".maplibregl-ctrl-fullscreen"); await sleep(800);
  check(await ev(FS), `${mode}: full screen again`);
  if (mode === "pseudo") { await click(".mapfull-exit .btn"); await sleep(800); check(!(await ev(FS)), "pseudo: the Exit button leaves full screen"); await click(".maplibregl-ctrl-fullscreen"); await sleep(800); }
  await click(".maplibregl-ctrl-shrink"); await sleep(800);
  check(!(await ev(FS)), `${mode}: the shrink button leaves full screen`);
};
const hasApi = await ev(`!!document.fullscreenEnabled && typeof Element.prototype.requestFullscreen === "function"`);
if (hasApi) await fullWalk("api"); else problems.push("no Fullscreen API in this Chromium: the api path was not walked");
await fullWalk("pseudo");

// ---- 11. All days / Your list: Other days hides inside the menu, the button stays ----
await click('.daytabs [data-tab="week"]');
await waitFor(`document.querySelector('.daytabs [data-tab="week"]').getAttribute("aria-selected") === "true"`);
await sleep(1200);
await click("#t-layers"); await sleep(300);
check(await visible("#t-hoods") && !(await visible("#t-others")), "All days: Neighbourhoods in the menu, Other days hidden");
await step("11-week-menu");
await click("#t-layers"); await sleep(200);

report.problems = problems;
console.log(JSON.stringify(report, null, 1));
console.log(problems.length ? `problems ${problems.length}` : "problems none");
process.exit(problems.length ? 2 : 0);
