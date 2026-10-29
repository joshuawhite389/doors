// Round 8 lane maptoggle (Jard 10-28: "an option on the map to hide the faded other routes to make the map less busy"),
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
const dir = `/tmp/claude-1000/r8maptoggle-${port}`;
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
await sleep(800);

// ---- 1. a day's tab, the default: the pill on, the other days faded ----
const days = await ev(`document.querySelectorAll('.daytabs [data-tab]:not([data-tab="rest"]):not([data-tab="week"])').length`);
check(days > 1, `the plan has several days (${days})`);
const s1 = await step("01-day-on", { stored: await stored() });
if (before) { report.problems = problems; console.log(JSON.stringify(report, null, 1)); console.log("before: first shot only"); process.exit(0); }
check(await visible("#t-others"), "the Other days pill shows on a day's tab");
check((await ev(`document.querySelector("#t-others")?.getAttribute("aria-pressed")`)) === "true", "the pill is on by default");
check((await ev(`document.querySelector("#t-others")?.textContent.trim()`)) === "Other days", "the pill reads Other days");
check(s1.faint > 0, `other days' faded pins on the map (${s1.faint})`);
check(s1.routes.length > 1, `other days' route layers on the map (${s1.routes.join(",")})`);
const hoods1 = await rect("#t-hoods"), others1 = await rect("#t-others");
check(Math.abs(hoods1.t - others1.t) < 1 && others1.l >= hoods1.r, `Neighbourhoods and Other days on one row (${JSON.stringify(hoods1)} / ${JSON.stringify(others1)})`);
const mapR = await rect("#plan-map");
check(others1.r <= mapR.r && others1.t >= mapR.t, "the pill sits inside the map");
for (const sel of [".maplibregl-ctrl-top-right", ".maplibregl-ctrl-top-left", ".maplibregl-ctrl-bottom-right", ".maplibregl-ctrl-bottom-left", ".tools", ".btn.ask", ".runbar", "#p-weeklegend"]) {
  const r = await rect(sel);
  if (r && r.w && r.h && (await visible(sel))) check(!overlap(others1, r), `the pill does not cover ${sel} (${JSON.stringify(r)})`);
}
check(others1.h >= 28, `the pill is tall enough to tap (${others1.h})`);

// ---- 2. off: the day on screen alone, the camera and the pills unmoved ----
await click("#t-others");
await waitFor(`document.querySelectorAll(".mpin.faint").length === 0`, 8000);
const s2 = await step("02-day-off", { stored: await stored() });
check(s2.faint === 0, `no faded pin when off (${s2.faint})`);
check(s2.routes.length === 1, `one route layer when off (${s2.routes.join(",")})`);
check(s2.numbered > 0 && s2.numbered === s2.pins, `only the day's numbered pins remain (${s2.numbered} of ${s2.pins})`);
check(s2.center.join() === s1.center.join() && s2.zoom === s1.zoom, `the camera did not move (${s1.center}@${s1.zoom} → ${s2.center}@${s2.zoom})`);
const hoods2 = await rect("#t-hoods"), others2 = await rect("#t-others");
check(JSON.stringify(hoods2) === JSON.stringify(hoods1) && others2.l === others1.l && others2.t === others1.t && others2.h === others1.h && Math.abs(others2.w - others1.w) < 1, `no layout shift of the pills (${JSON.stringify(hoods1)} → ${JSON.stringify(hoods2)}; ${JSON.stringify(others1)} → ${JSON.stringify(others2)})`);
check((await stored()) === "off", "the choice is saved as off");
check((await ev(`document.querySelector("#t-others")?.getAttribute("aria-pressed")`)) === "false", "aria-pressed false when off");

// ---- 3. All days ignores it: every route, the pill hidden ----
await click('.daytabs [data-tab="week"]');
await waitFor(`document.querySelector('.daytabs [data-tab="week"]').getAttribute("aria-selected") === "true"`);
await sleep(1200);
const s3 = await step("03-week-off");
check(!(await visible("#t-others")), "the pill hides on All days");
check(s3.routes.length > 1, `All days shows every route with the toggle off (${s3.routes.join(",")})`);
check(s3.faint === 0, `All days draws no faded pin (${s3.faint})`);

// ---- 4. back on a day: still off ----
await click('.daytabs [data-tab="0"]');
await waitFor(`document.querySelector('.daytabs [data-tab="0"]').getAttribute("aria-selected") === "true"`);
await sleep(1200);
const s4 = await step("04-day-off-again");
check(await visible("#t-others"), "the pill returns on a day's tab");
check(s4.faint === 0 && s4.routes.length === 1, `still only the day on screen (${s4.faint} faint, ${s4.routes.join(",")})`);

// ---- 5. a reload keeps the choice ----
await send("Page.reload"); await waitFor(planReady, 40000); await sleep(3000);
await waitFor(`document.querySelectorAll(".mpin").length > 0`, 20000);
const s5 = await step("05-reload-off", { stored: await stored() });
check((await ev(`document.querySelector("#t-others")?.getAttribute("aria-pressed")`)) === "false", "off survives a reload");
check(s5.faint === 0 && s5.routes.length === 1, `after the reload still the day alone (${s5.faint} faint, ${s5.routes.join(",")})`);

// ---- 6. on again: the other days come back ----
await click("#t-others");
await waitFor(`document.querySelectorAll(".mpin.faint").length > 0`, 8000);
const s6 = await step("06-day-on-again", { stored: await stored() });
check(s6.faint === s1.faint && s6.routes.join() === s1.routes.join(), `the other days are back as before (${s6.faint} faint, ${s6.routes.join(",")})`);
check(s6.center.join() === s5.center.join() && s6.zoom === s5.zoom, "the camera did not move on the way back");
check((await stored()) === "on", "the choice is saved as on");

// ---- 7. Your list hides the pill ----
await click('.daytabs [data-tab="rest"]');
await sleep(900);
await step("07-rest");
check(!(await visible("#t-others")), "the pill hides on Your list");

report.problems = problems;
console.log(JSON.stringify(report, null, 1));
console.log(problems.length ? `problems ${problems.length}` : "problems none");
process.exit(problems.length ? 1 : 0);
