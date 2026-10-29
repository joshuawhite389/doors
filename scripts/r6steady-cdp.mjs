// Round 6 lane steady (Jard 10-27, ROUND6-SPEC items 1–5), measured in headless Chromium over CDP: nothing moves while
// the Market's filters and reason chips are clicked (the sentence box, the filter grid, the picture and the map's
// camera hold still); the Who view's strip keeps one height while rows are hovered; the people icon sits centred in
// its tile; the Agent is a round button at the screen's bottom right that covers no map control and no list row; the
// top bar reads Start my day · Market · My doors · Menu, with My doors out of the Menu. Seeds Maya's demo profile
// (Austin) or Jard's Cincinnati test (brand exampl, Budweiser drinkers; the route replays from data/kv-dev, no Qloo
// call). Screenshots every step; prints the numbers and any check that failed.
// Usage: node scripts/r6steady-cdp.mjs <base-url> <out-dir> [width] [height] [austin|cincinnati] [strict|measure]
//   measure: the numbers alone, no checks against the new UI (for the before shots on the base build)
import { spawn } from "node:child_process";
import fs from "node:fs";
import { demoProfile } from "../public/lib/demo-profile.js";
import { sampleProfile, citySlug } from "../public/lib/profile.js";
import { storeKey, STORE_VERSION, BRAND_KEY } from "../public/lib/store.js";
import { BASIS_BUTTON } from "../public/lib/basis.js";
import { LOGBOOK_LABEL } from "../public/lib/logbook.js";
const [base, out, w = "1400", h = "900", cityArg = "austin", modeArg = "strict"] = process.argv.slice(2);
const strict = modeArg !== "measure";
fs.mkdirSync(out, { recursive: true });
const port = 9400 + Math.floor(Math.random() * 400);
const dir = `/tmp/claude-1000/r6steady-${port}`;
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
const centre = (sel) => ev(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.getClientRects().length); if (!e) return null; const b = e.getBoundingClientRect(); return {x: b.left + b.width/2, y: b.top + b.height/2}; })()`);
const mouse = async (type, x, y) => send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", clickCount: 1 });
const click = async (sel, { scroll = true } = {}) => {
  if (scroll) await ev(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.getClientRects().length); e?.scrollIntoView({block:"center"}); })()`);
  await sleep(120);
  const r = await centre(sel);
  if (!r) throw new Error(`no visible ${sel}`);
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await mouse(type, r.x, r.y);
};
const hover = async (sel) => { const r = await centre(sel); if (!r) throw new Error(`no visible ${sel}`); await mouse("mouseMoved", r.x, r.y); };
const waitFor = async (expr, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(expr)) return true; await sleep(150); } await shot("zz-timeout"); throw new Error(`timed out: ${expr}\n${problems.join("\n")}`); };
const check = (ok, what) => { if (!ok) problems.push(`check failed: ${what}`); };
const must = (ok, what) => { if (strict) check(ok, what); };
const settle = () => waitFor(`!document.querySelector("#why .wv-busy") && !document.querySelector("#why .ws-pv.busy")`, 45000);

// Jard's Cincinnati test as he typed it (round 5/6 shots): a bottled beer called exampl, Budweiser drinkers, a pin downtown
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
// the seed, plus a camera probe: every MapLibre map on the page is kept in window.__maps and each camera move after
// window.__camWatch is set counts in window.__moves (jumpTo is where easeTo, flyTo and fitBounds end up)
await send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => { try { if (!localStorage.getItem("__seeded")) { localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify(state))}); localStorage.setItem(${JSON.stringify(BRAND_KEY)}, ${JSON.stringify(JSON.stringify({ v: STORE_VERSION, profile: prof, savedAt: new Date().toISOString() }))}); localStorage.setItem("doors:drive-voice", "off"); localStorage.setItem("__seeded", "1"); } } catch {} window.SpeechRecognition = undefined; delete window.webkitSpeechRecognition;
  window.__maps = new Set(); window.__moves = 0; window.__camWatch = false; let lib;
  Object.defineProperty(window, "maplibregl", { configurable: true, get: () => lib, set: (v) => { lib = v; try { const P = v.Map.prototype; for (const k of ["jumpTo", "easeTo", "flyTo"]) { const o = P[k]; P[k] = function (...a) { window.__maps.add(this); if (window.__camWatch) window.__moves++; return o.apply(this, a); }; } } catch (e) { console.warn("probe", e); } } });
})();` });
await send("Emulation.setDeviceMetricsOverride", { width: +w, height: +h, deviceScaleFactor: 1, mobile: +w < 700 });
const q = new URLSearchParams({ brand: prof.brand, city: prof.city });
await send("Page.navigate", { url: `${base}/app?ors=off&instant=1#/plan?${q}` });
await waitFor(`!!document.querySelector(".stop[data-id]")`, 40000);
await sleep(2500);
await send("Page.reload");
await waitFor(`!!document.querySelector(".stop[data-id]")`, 40000);
await sleep(2500);
const narrow = +w <= 900;
const report = { width: +w, city: cityArg, mode: modeArg };
const X = "#why .wv-explorer";
const rect = (sel) => ev(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.getClientRects().length); if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; })()`);
const hit = (a, b) => a && b && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;

// ---- #4 / #5 the top bar and the Agent button ----
await shot("a1-plan");
report.bar = await ev(`[...document.querySelectorAll(".tools > .btn")].filter((b) => getComputedStyle(b).position !== "fixed" || b.closest(".tools") === b.parentElement && !b.classList.contains("ask")).map((b) => b.textContent.trim())`);
must(JSON.stringify(report.bar) === JSON.stringify(["Start my day", BASIS_BUTTON, LOGBOOK_LABEL, "Menu"]), `the top bar reads Start my day · ${BASIS_BUTTON} · ${LOGBOOK_LABEL} · Menu (${report.bar.join(" · ")})`);
report.fab = await ev(`(() => { const b = document.querySelector(".mapwrap .btn.ask"); if (!b) return null; const r = b.getBoundingClientRect(), cs = getComputedStyle(b); return { w: r.width, h: r.height, right: innerWidth - r.right, bottom: innerHeight - r.bottom, radius: cs.borderRadius, pos: cs.position, inBar: !!b.closest(".tools"), label: b.getAttribute("aria-label"), icon: b.querySelector("svg")?.getBoundingClientRect().width, text: b.textContent.trim(), textShown: [...b.querySelectorAll(".lbl")].some((l) => l.getBoundingClientRect().width > 2) }; })()`);
must(report.fab && Math.round(report.fab.w) === 56 && Math.round(report.fab.h) === 56 && report.fab.pos === "fixed" && report.fab.right >= 12 && report.fab.right <= 20 && report.fab.bottom >= 8 && report.fab.bottom <= 20 && !report.fab.inBar && report.fab.icon === 28 && !report.fab.textShown, `the Agent is a 56 px round button bottom-right, out of the bar, icon 28, no visible text (${JSON.stringify(report.fab)})`);
must(report.fab?.label === "Doors Agent", `the button's name is Doors Agent (${report.fab?.label})`);
// nothing under it: the map's zoom and attribution controls, the Neighbourhoods toggle, the week legend, the day list's last row
const fabRect = await rect(".mapwrap .btn.ask");
report.under = await ev(`(() => { const f = document.querySelector(".mapwrap .btn.ask")?.getBoundingClientRect(); if (!f) return []; const els = [...document.querySelectorAll(".maplibregl-ctrl button, .maplibregl-ctrl-attrib, .hoodkey, .weeklegend, .legend, .rfoot, #p-foot, .maptip, .daytabs" + (innerWidth > 900 ? ", .stop[data-id]" : ""))]; /* a phone's rows scroll under the button's own bar (the paper strip the page ends above), never under the button at the page's end: lastRow below */ return els.filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== "hidden").map((e) => ({ what: e.className?.baseVal ?? e.className ?? e.tagName, r: e.getBoundingClientRect().toJSON() })).filter((x) => x.r.left < f.right && f.left < x.r.right && x.r.top < f.bottom && f.top < x.r.bottom).map((x) => String(x.what).split(" ")[0]); })()`);
must(report.under.length === 0, `the Agent button covers nothing (${report.under.join(", ")})`);
if (narrow) {
  await ev(`window.scrollTo(0, document.documentElement.scrollHeight)`);
  await sleep(400);
  report.lastRow = await ev(`(() => { const rows = [...document.querySelectorAll(".stop[data-id]")]; const last = rows.at(-1)?.getBoundingClientRect(); const f = document.querySelector(".mapwrap .btn.ask")?.getBoundingClientRect(); const foot = document.querySelector("#p-foot")?.getBoundingClientRect(); return { lastBottom: last?.bottom, footBottom: foot?.bottom, fabTop: f?.top, fabLeft: f?.left, lastRight: last?.right }; })()`);
  must(report.lastRow.lastBottom <= report.lastRow.fabTop + 1 || report.lastRow.lastRight <= report.lastRow.fabLeft, `scrolled to the end, the day list's last row ends above the Agent button (${JSON.stringify(report.lastRow)})`);
  await shot("a1b-plan-end");
  await ev(`window.scrollTo(0, 0)`);
  await sleep(200);
}
await click("#t-menu");
await sleep(400);
report.menu = await ev(`[...document.querySelectorAll("#menu .mi b")].map((b) => b.textContent)`);
must(!report.menu.includes("Log book") && !report.menu.includes(LOGBOOK_LABEL), `${LOGBOOK_LABEL} is not in the Menu (${report.menu.join(", ")})`);
await shot("a2-menu");
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
await sleep(300);
if (await ev(`!!document.querySelector('.tools [data-drawer="logbook"]')`)) {
  await click('.tools [data-drawer="logbook"]');
  await waitFor(`!document.querySelector("#logbook").hidden && !!document.querySelector("#logbook h3")`, 10000);
  await sleep(500);
  report.logbook = await ev(`({ h3: document.querySelector("#logbook h3")?.textContent, aria: document.querySelector("#logbook").getAttribute("aria-label") })`);
  must(report.logbook.h3 === LOGBOOK_LABEL && report.logbook.aria === LOGBOOK_LABEL, `the pane's heading says ${LOGBOOK_LABEL} (${JSON.stringify(report.logbook)})`);
  await shot("a3-mydoors");
  await click("#logbook .lb-x");
  await sleep(400);
} else must(false, `no ${LOGBOOK_LABEL} button on the top bar`);

// ---- #1 the Market: nothing moves on a filter or a reason chip ----
await click('[data-drawer="why"]');
await waitFor(`!!document.querySelector("${X} svg .wv-dot")`, 30000);
await sleep(1500);
report.marketTitle = await ev(`document.querySelector("#why h3")?.textContent`);
must(report.marketTitle === BASIS_BUTTON, `the pane's heading says ${BASIS_BUTTON} (${report.marketTitle})`);
await shot("b1-market");
// the places that must hold still, measured in the drawer's own content (its scroll taken out), and the map's camera
const SAY = `${X} .wv-say`;
const LAY = `(() => { const d = document.querySelector("#why"); const st = d.scrollTop; const top = (sel) => { const e = document.querySelector(sel); return e ? Math.round((e.getBoundingClientRect().top + st) * 10) / 10 : null; }; const say = document.querySelector(${JSON.stringify(SAY)}); const m = [...window.__maps][0]; const c = m?.getCenter(); return { grid: top("${X} .wv-ctls"), reasons: top("${X} [data-wv-reasons]"), fig: top('${X} [data-wv-fig]'), strip: top("${X} [data-wv-strip]"), legend: top("${X} .wv-legend"), sayH: say ? Math.round(say.getBoundingClientRect().height * 10) / 10 : null, sayLines: say ? Math.round(say.scrollHeight / (parseFloat(getComputedStyle(say).lineHeight) || 23.1) * 10) / 10 : null, more: !!document.querySelector("${X} [data-wv-saymore]:not([hidden])"), map: m ? [Math.round(c.lng * 1e5) / 1e5, Math.round(c.lat * 1e5) / 1e5, Math.round(m.getZoom() * 1000) / 1000] : null, moves: window.__moves, mapBox: document.querySelector("#plan-map")?.getBoundingClientRect().toJSON() }; })()`;
const lay = () => ev(LAY);
await ev(`window.__camWatch = true; window.__moves = 0;`);
const base0 = await lay();
report.base = base0;
check(base0.map, "the camera probe found the plan's map");
const shifts = [];
const diff = (what, a, b) => { const d = {}; for (const k of ["grid", "reasons", "fig", "strip", "legend", "sayH"]) if (a[k] != null && b[k] != null && Math.abs(a[k] - b[k]) > 0.5) d[k] = Math.round((b[k] - a[k]) * 10) / 10; if (a.map && b.map && (a.map[0] !== b.map[0] || a.map[1] !== b.map[1] || a.map[2] !== b.map[2])) d.map = b.map; if (b.moves !== a.moves) d.moves = b.moves - a.moves; if (JSON.stringify(a.mapBox) !== JSON.stringify(b.mapBox)) d.mapBox = 1; if (Object.keys(d).length) shifts.push({ what, ...d }); };
let maxLines = base0.sayLines, cut = [];
const note = (what, L) => { if (L.sayLines > maxLines) maxLines = L.sayLines; if (L.more) cut.push(`${what}: ${L.sayLines} lines`); };
// every control of every row (the one not pressed), then back
const rows = await ev(`[...document.querySelectorAll("${X} [data-wv-row]")].filter((r) => r.dataset.wvRow !== "reasons" && !r.classList.contains("wv-sub")).map((r) => ({ row: r.dataset.wvRow, vals: [...r.querySelectorAll("[data-wv-v]")].map((b) => ({ v: b.dataset.wvV, on: b.getAttribute("aria-pressed") === "true", dis: b.disabled })) }))`);
report.rows = rows.map((r) => r.row);
let shotDone = false;
for (const r of rows) {
  for (const b of r.vals) {
    if (b.on || b.dis) continue;
    const before = await lay();
    const sel = `${X} [data-wv-row="${r.row}"] [data-wv-v="${b.v}"]`;
    await click(sel, { scroll: false });
    await sleep(300);
    const mid = await lay(); // the instant after the click (the previous dots hold, dimmed)
    diff(`${r.row}=${b.v} (click)`, before, mid);
    await settle();
    await sleep(400);
    const after = await lay();
    diff(`${r.row}=${b.v}`, before, after);
    note(`${r.row}=${b.v}`, after);
    if (!shotDone && r.row === "band") { await shot("b2-filter-band"); shotDone = true; }
    // back: Reset when the change previews, else the segment that was pressed
    if (await ev(`!!document.querySelector("${X} [data-wv-act=reset]")`)) await click(`${X} [data-wv-act=reset]`, { scroll: false });
    else { const was = r.vals.find((x) => x.on); if (was) await click(`${X} [data-wv-row="${r.row}"] [data-wv-v="${was.v}"]`, { scroll: false }); }
    await sleep(300);
    await settle();
    await sleep(300);
    const back = await lay();
    diff(`${r.row}=${b.v} (back)`, before, back);
  }
}
// every reason chip, and its codes while picked
const fates = await ev(`[...document.querySelectorAll("${X} [data-wv-fate]")].map((b) => b.dataset.wvFate)`);
report.fates = fates;
for (const f of fates) {
  const before = await lay();
  await click(`${X} [data-wv-fate="${f}"]`, { scroll: false });
  await sleep(700);
  const after = await lay();
  diff(`reason ${f}`, before, after);
  if (f === fates[0]) await shot("b3-reason");
  const codes = await ev(`[...document.querySelectorAll("${X} [data-wv-code]")].map((b) => b.dataset.wvCode)`);
  for (const c of codes) {
    const b2 = await lay();
    await click(`${X} [data-wv-code="${c}"]`, { scroll: false });
    await sleep(600);
    diff(`reason ${f} code ${c}`, b2, await lay());
    await click(`${X} [data-wv-code="${c}"]`, { scroll: false });
    await sleep(600);
  }
  await click(`${X} [data-wv-fate="${f}"]`, { scroll: false });
  await sleep(600);
  diff(`reason ${f} (back)`, before, await lay());
}
// a few dots hovered: the strip fills, nothing under it moves
const dots = await ev(`[...document.querySelectorAll("${X} .wv-hit")].filter((c) => c.style.pointerEvents !== "none").slice(0, 12).map((c) => c.dataset.id)`);
await ev(`document.querySelector("${X} [data-wv-strip]").scrollIntoView({ block: "center" })`);
await sleep(200);
const b4 = await lay();
for (const d of dots) { await hover(`${X} .wv-hit[data-id="${d}"]`); await sleep(120); diff(`dot ${d.slice(0, 8)}`, b4, await lay()); }
report.explorerStrip = await ev(`(() => { const s = document.querySelector("${X} [data-wv-strip]"); return { minHeight: s?.style.minHeight, height: s?.getBoundingClientRect().height }; })()`);
await shot("b4-dot-hover");
await mouse("mouseMoved", 2, 2);
report.shifts = shifts;
report.sayLines = { base: base0.sayLines, max: maxLines, cut };
must(shifts.length === 0, `nothing moved on any filter, chip or dot: ${shifts.length} shifts ${JSON.stringify(shifts.slice(0, 8))}`);
must(!cut.length, `no sentence was cut at this width (${cut.join("; ")})`);

// ---- #2 / #3 the Who view: the strip holds, the icon is centred ----
await ev(`document.querySelector("#why").scrollTop = 0`);
await click('#why [data-view="who"]');
await waitFor(`!!document.querySelector("#why .wv-lift-row") || !!document.querySelector("#why .w-who")`, 20000);
await sleep(800);
await shot("c1-who");
report.icon = await ev(`(() => { const tile = document.querySelector("#why .w-who .w-ico"); const svg = tile?.querySelector("svg"); if (!tile || !svg) return null; const t = tile.getBoundingClientRect(), s = svg.getBoundingClientRect(); let bb = null; for (const n of svg.children) { const b = n.getBBox(); const sw = +(n.getAttribute("stroke-width") ?? 2) / 2; const o = { x: b.x - sw, y: b.y - sw, r: b.x + b.width + sw, b: b.y + b.height + sw }; bb = bb ? { x: Math.min(bb.x, o.x), y: Math.min(bb.y, o.y), r: Math.max(bb.r, o.r), b: Math.max(bb.b, o.b) } : o; } const k = s.width / 24; const gx = s.left + ((bb.x + bb.r) / 2) * k, gy = s.top + ((bb.y + bb.b) / 2) * k; return { tile: [t.width, t.height], svg: [s.width, s.height], svgOff: [Math.round((s.left + s.width / 2 - (t.left + t.width / 2)) * 10) / 10, Math.round((s.top + s.height / 2 - (t.top + t.height / 2)) * 10) / 10], glyphOff: [Math.round((gx - (t.left + t.width / 2)) * 10) / 10, Math.round((gy - (t.top + t.height / 2)) * 10) / 10], shape: [...svg.children].map((n) => n.tagName).join("+") }; })()`);
must(report.icon && Math.abs(report.icon.glyphOff[0]) <= 1 && Math.abs(report.icon.glyphOff[1]) <= 1 && Math.abs(report.icon.svgOff[0]) <= 1 && Math.abs(report.icon.svgOff[1]) <= 1, `the people icon sits centred in its tile within 1 px (${JSON.stringify(report.icon)})`);
must(report.icon?.shape === "circle+circle+path+path", `the icon is the two people (${report.icon?.shape})`);
// the other tiles' icons, the same measure
report.tiles = await ev(`[...document.querySelectorAll("#why .ws-job .w-ico, #why .w-ico")].map((tile) => { const svg = tile.querySelector("svg"); if (!svg) return null; const t = tile.getBoundingClientRect(), s = svg.getBoundingClientRect(); return [Math.round((s.left + s.width / 2 - (t.left + t.width / 2)) * 10) / 10, Math.round((s.top + s.height / 2 - (t.top + t.height / 2)) * 10) / 10]; }).filter(Boolean)`);
must(report.tiles.every(([x, y]) => Math.abs(x) <= 1 && Math.abs(y) <= 1), `every icon tile centres its icon (${JSON.stringify(report.tiles)})`);
const liftRows = await ev(`[...document.querySelectorAll("#why .wv-lift-row")].map((g) => g.dataset.key)`);
report.liftRows = liftRows.length;
if (liftRows.length) {
  const W = `(() => { const d = document.querySelector("#why"); const st = d.scrollTop; const s = document.querySelector("#why .wv-lift [data-wv-strip]"); const next = s?.nextElementSibling; const r = s?.getBoundingClientRect(); return { stripH: r ? Math.round(r.height * 10) / 10 : null, stripTop: r ? Math.round((r.top + st) * 10) / 10 : null, nextTop: next ? Math.round((next.getBoundingClientRect().top + st) * 10) / 10 : null, minH: s?.style.minHeight ?? null, lines: s ? Math.max(...[...s.querySelectorAll(".wv-sr")].map((x) => x.getBoundingClientRect().bottom), r.top) : null, text: s?.textContent.replace(/\\s+/g, " ").trim().slice(0, 80) }; })()`;
  await ev(`document.querySelector("#why .wv-lift [data-wv-strip]").scrollIntoView({ block: "center" })`);
  await sleep(200);
  const idle = await ev(W);
  const who = [];
  let tallest = null;
  for (const k of liftRows) {
    await hover(`#why .wv-lift-row[data-key="${k}"]`);
    await sleep(150);
    const L = await ev(W);
    const rowsH = await ev(`(() => { const s = document.querySelector("#why .wv-lift [data-wv-strip]"); const xs = [...s.querySelectorAll(".wv-sr")].map((x) => x.getBoundingClientRect()); const top = Math.min(...xs.map((x) => x.top)), bot = Math.max(...xs.map((x) => x.bottom)); return Math.round((bot - top) * 10) / 10; })()`);
    if (Number.isFinite(rowsH) && (!tallest || rowsH > tallest.h)) tallest = { k, h: rowsH, text: L.text };
    if (Math.abs(L.stripH - idle.stripH) > 0.5 || Math.abs(L.nextTop - idle.nextTop) > 0.5) who.push({ row: k, stripH: L.stripH, nextTop: L.nextTop });
  }
  report.who = { idle, rows: liftRows.length, moved: who, tallest };
  must(who.length === 0, `the Who strip keeps one height for every row (idle ${idle.stripH}; moved: ${JSON.stringify(who.slice(0, 4))})`);
  must(tallest && idle.minH && parseFloat(idle.minH) >= tallest.h, `the strip reserved the tallest row's content (${idle.minH} for ${JSON.stringify(tallest)})`);
  if (tallest) { await hover(`#why .wv-lift-row[data-key="${tallest.k}"]`); await sleep(150); }
  await shot("c2-who-hover");
  await mouse("mouseMoved", 2, 2);
}
// ---- the neighbourhood view: its strip reserved too ----
await ev(`document.querySelector("#why").scrollTop = 0`);
await click('#why [data-w="list"], #why .w-back, #why [data-view="home"]').catch(() => {});
await sleep(600);
if (await ev(`!!document.querySelector('#why [data-view="map"]')`)) {
  await click('#why [data-view="map"]');
  await waitFor(`!!document.querySelector("#why .wv-areas")`, 20000);
  await sleep(900);
  report.areasStrip = await ev(`(() => { const s = document.querySelector("#why .wv-areas [data-wv-strip]"); return s ? { minH: s.style.minHeight, h: s.getBoundingClientRect().height, areas: document.querySelectorAll("#why .wv-arow").length } : null; })()`);
  must(!report.areasStrip || !report.areasStrip.areas || parseFloat(report.areasStrip.minH || "0") >= 42, `the neighbourhood strip reserved its rows (${JSON.stringify(report.areasStrip)})`);
  await shot("d1-areas");
}
report.problems = problems;
fs.writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ok: !problems.length, width: +w, city: cityArg, mode: modeArg, bar: report.bar, fab: report.fab, under: report.under, shifts: report.shifts, sayLines: report.sayLines, icon: report.icon, who: report.who && { idle: report.who.idle.stripH, minH: report.who.idle.minH, moved: report.who.moved.length, tallest: report.who.tallest }, explorerStrip: report.explorerStrip, areasStrip: report.areasStrip, problems }, null, 2));
process.exit(problems.length ? 1 : 0);
