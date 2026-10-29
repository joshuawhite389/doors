// Round 4 lane viz (Jard 10-27): #4 every Why view opens at its top; #5 the details strip under each picture (and the
// map's light label + the drawer's strip) in place of the floating tooltip; #9 coloured clouds; #8 the calmer explorer
// controls (two rows inline, More filters, chips); #7 the logistics filters and the remaining-doors list with Add
// selected. Seeds Maya's demo profile and walks the Why drawer at the given width, shooting each state.
// Usage: node scripts/r4viz-cdp.mjs <base-url> <out-dir> [width] [height]
import { spawn } from "node:child_process";
import fs from "node:fs";
import { demoProfile } from "../public/lib/demo-profile.js";
import { storeKey, STORE_VERSION, BRAND_KEY } from "../public/lib/store.js";
const [base, out, w = "1400", h = "900", mode = ""] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const port = 9400 + Math.floor(Math.random() * 400);
const dir = `/tmp/claude-1000/r4viz-${port}`;
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
const narrow = +w <= 900;
const NOMADIC = "00000000-0000-4000-8000-271655E6AA28";
const hover = async (sel) => { // a real pointer move onto the element (pointerenter fires as the browser would)
  const r = await ev(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.getClientRects().length); if (!e) return null; e.scrollIntoView({block:"center"}); const b = e.getBoundingClientRect(); return {x: b.left + b.width/2, y: b.top + b.height/2}; })()`);
  if (!r) throw new Error(`no visible ${sel}`);
  await sleep(150);
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: r.x, y: r.y });
  await sleep(250);
  return r;
};
const hoverPath = async (sel) => { // onto a point of the group's first drawn path (an arc's box centre is empty)
  const r = await ev(`(() => { const g = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.getClientRects().length); if (!g) return null; g.scrollIntoView({block:"center"}); const p = g.querySelector("path"); const pt = p.getPointAtLength(p.getTotalLength() / 2); const m = p.getScreenCTM(); return { x: m.a * pt.x + m.c * pt.y + m.e, y: m.b * pt.x + m.d * pt.y + m.f }; })()`);
  if (!r) throw new Error(`no visible ${sel}`);
  await sleep(150);
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: r.x, y: r.y });
  await sleep(250);
  return r;
};
const stripOf = (sel) => ev(`(() => { const s = document.querySelector(${JSON.stringify(sel)}); return s ? { text: s.textContent.replace(/\\s+/g, " ").trim(), idle: s.classList.contains("idle"), off: s.classList.contains("off") } : null; })()`);
const noTip = async (where) => check(await ev(`!document.querySelector(".wv-tip")`), `no floating tooltip (${where})`);

await ev(`[...document.querySelectorAll('[data-drawer="why"]')].find((b) => b.getClientRects().length)?.click()`);
await waitFor(`!!document.querySelector("#why .wv-explorer svg .wv-dot")`, 20000);
await sleep(1200);
await shot("r1-home");
// #5 the explorer: hover a dot → the strip under the picture fills, nothing floats; leave → the rows stay, dimmed
report.stripIdle = await stripOf("#why .wv-explorer [data-wv-strip]");
check(report.stripIdle?.idle && /Hover or tap a dot/.test(report.stripIdle.text), `explorer strip at rest (${JSON.stringify(report.stripIdle)})`);
await hover(`#why .wv-explorer .wv-hit[data-id="${NOMADIC}"]`);
report.strip = await stripOf("#why .wv-explorer [data-wv-strip]");
check(report.strip && !report.strip.idle && !report.strip.off && /^Nomadic Beerworks#1 of \d+on Your list/.test(report.strip.text) && /how well known/.test(report.strip.text) && /Qualifies with these settings$/.test(report.strip.text), `explorer strip filled (${report.strip?.text})`);
check(await ev(`document.querySelector('#why .wv-explorer .wv-hit[data-id="${NOMADIC}"]').classList.contains("wv-hot")`), "the hovered dot is hot");
await noTip("explorer hover");
await shot("r2-explorer-hover");
await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 5 });
await sleep(300);
report.stripAfter = await stripOf("#why .wv-explorer [data-wv-strip]");
check(report.stripAfter?.off && /^Nomadic Beerworks/.test(report.stripAfter.text), `the rows stay, dimmed, after the pointer leaves (${JSON.stringify(report.stripAfter)})`);
// keyboard focus fills the same strip
await ev(`document.querySelector('#why .wv-explorer .wv-hit[data-id="${NOMADIC}"]').focus()`);
await sleep(200);
check(!(await stripOf("#why .wv-explorer [data-wv-strip]")).off, "focus fills the strip");
await ev(`document.activeElement.blur()`);
// #9 + #5 the map: clouds in colour; hover a cloud → the pill goes hot, the drawer's strip (map view) fills
if (!narrow) {
  await waitFor(`document.querySelectorAll(".wv-pill:not(.hid)").length >= 3`, 20000);
  await sleep(800);
  report.pills = await ev(`[...document.querySelectorAll(".wv-pill:not(.hid)")].map((p) => p.textContent.trim())`);
  check(report.pills.some((t) => /Travis Heights.*doors/.test(t)), `a pill for the area with no standout group (${report.pills.join(" | ")})`);
  report.wash = await ev(`(() => { const m = document.querySelector("#plan-map, .mapwrap .maplibregl-map"); return m?.dataset.wvWash ?? null; })()`);
  const target = await ev(`(() => { const p = [...document.querySelectorAll(".wv-pill:not(.hid)")].find((x) => /East Cesar Chavez/.test(x.textContent)) ?? document.querySelector(".wv-pill:not(.hid)"); const b = p.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height + 22, name: p.querySelector("b").textContent }; })()`);
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: target.x, y: target.y });
  await sleep(500);
  report.hotPill = await ev(`document.querySelector(".wv-pill.hot")?.textContent.replace(/\\s+/g, " ").trim() ?? null`);
  check(report.hotPill && /\d+ doors · \d+ on your plan/.test(report.hotPill), `cloud hover lights its pill with the counts (${report.hotPill})`);
  await noTip("map hover");
  await shot("r3-map-hover");
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 5 });
  await sleep(300);
  check(await ev(`!document.querySelector(".wv-pill.hot")`), "the pill cools when the pointer leaves");
}
// #7 and #8 were redone in round 5 (Jard 10-27: all filters visible, the reasons as rows of the same grid, the
// checkbox list gone): scripts/r5filters-cdp.mjs walks them.
// #4 a view opens at its top: scroll the home down first, then open Doors Deep Dive
await ev(`document.querySelector("#why").scrollTop = 900`);
await sleep(200);
report.scrollBefore = await ev(`document.querySelector("#why").scrollTop`);
await ev(`document.querySelector('#why [data-view="plan"]').click()`);
await waitFor(`!!document.querySelector("#why .wv-ring svg")`, 20000);
await sleep(600);
report.scrollDeep = await ev(`document.querySelector("#why").scrollTop`);
check(report.scrollBefore > 300 && report.scrollDeep === 0, `Doors Deep Dive opens at the top (was ${report.scrollBefore}, now ${report.scrollDeep})`);
await shot("r4-deepdive-top");
// #5 the ring, the thread and the age bump each fill their own strip
await hoverPath("#why .wv-ring .wv-ring-door");
report.ringStrip = await stripOf("#why .wv-ring [data-wv-strip]");
check(report.ringStrip && !report.ringStrip.idle && /(open while you're out|not open while you're out|hours unverified)/.test(report.ringStrip.text), `ring strip (${report.ringStrip?.text})`);
await noTip("ring hover");
await shot("r5-ring-hover");
await hover("#why .wv-th .wv-th-node.k-plan");
report.threadStrip = await stripOf("#why .wv-th [data-wv-strip]");
check(report.threadStrip && !report.threadStrip.idle && /share(s)? its crowd/.test(report.threadStrip.text), `thread strip (${report.threadStrip?.text})`);
await shot("r6-thread-hover");
await hover("#why .wv-bump .wv-hit");
report.bumpStrip = await stripOf("#why .wv-bump [data-wv-strip]");
check(report.bumpStrip && !report.bumpStrip.idle && /#\d+ of \d+/.test(report.bumpStrip.text), `bump strip (${report.bumpStrip?.text})`);
await noTip("bump hover");
await shot("r7-bump-hover");
check(await ev(`document.querySelector("#why .wv-ring [data-wv-strip]").classList.contains("off")`), "the ring's strip dimmed once the pointer moved to another picture");
// the Who view: the lift rows; the map view: the drawer's strip fills from a cloud hover
await ev(`document.querySelector('#why [data-w="list"]').click()`);
await sleep(600);
await ev(`document.querySelector('#why [data-view="who"]').click()`);
await waitFor(`!!document.querySelector("#why .wv-lift svg")`, 20000);
await sleep(400);
check(await ev(`document.querySelector("#why").scrollTop === 0`), "Who view opens at the top");
await hover("#why .wv-lift .wv-lift-row");
report.liftStrip = await stripOf("#why .wv-lift [data-wv-strip]");
check(report.liftStrip && !report.liftStrip.idle && /plan doors/.test(report.liftStrip.text), `lift strip (${report.liftStrip?.text})`);
await shot("r8-lift-hover");
await ev(`document.querySelector('#why [data-w="list"]').click()`);
await sleep(600);
await ev(`document.querySelector('#why [data-view="map"]').click()`);
await waitFor(`!!document.querySelector("#why .wv-areas [data-wv-strip]")`, 20000);
await sleep(800);
check(await ev(`document.querySelector("#why").scrollTop === 0`), "map view opens at the top");
report.legend = await ev(`[...document.querySelectorAll("#why .wv-areas .wv-legend span")].map((s) => s.textContent)`);
check(report.legend.length === 6 && report.legend.includes("no group stands out"), `legend names the no-standout colour (${report.legend.join(", ")})`);
if (!narrow) {
  const target = await ev(`(() => { const p = [...document.querySelectorAll(".wv-pill:not(.hid)")].find((x) => /Downtown/.test(x.textContent)) ?? document.querySelector(".wv-pill:not(.hid)"); if (!p) return null; const b = p.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2, name: p.querySelector("b").textContent }; })()`);
  if (target) {
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: target.x, y: target.y });
    await sleep(500);
    report.areaStrip = await stripOf("#why .wv-areas [data-wv-strip]");
    check(report.areaStrip && !report.areaStrip.idle && report.areaStrip.text.startsWith(target.name) && /on Qloo's heat map for your drinker/.test(report.areaStrip.text) && /on your plan · \d+ on Your list/.test(report.areaStrip.text), `map view strip from a pill hover (${report.areaStrip?.text})`);
    await noTip("pill hover");
    await shot("r9-mapview-hover");
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 5 });
  } else problems.push("no pill to hover in the map view");
}
report.problems = problems;
fs.writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
if (Object.keys(overflows).length) report.overflows = overflows;
console.log(JSON.stringify({ ok: !problems.length, problems, overflows }, null, 1));
process.exit(problems.length ? 1 : 0);
