// Round 4 items 1–3 (lane fix): the landing (footnote, the map route hero back) and the plan's day tabs (arrows, wheel,
// drag) at a width. Seeds Maya's demo profile with 7 days so the tab strip overflows the 420 px column.
// Usage: node scripts/r4fix-cdp.mjs <base-url> <out-dir> [width] [height]
import { spawn } from "node:child_process";
import fs from "node:fs";
import { demoProfile } from "../public/lib/demo-profile.js";
import { storeKey, STORE_VERSION, BRAND_KEY } from "../public/lib/store.js";
const [base, out, w = "1400", h = "900"] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const port = 9400 + Math.floor(Math.random() * 400);
const dir = `/tmp/claude-1000/r4fix-${port}`;
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
  if (m.method === "Runtime.consoleAPICalled" && /error|warn/.test(m.params.type)) problems.push(m.params.type + " " + m.params.args.map((a) => a.value ?? a.description).join(" ").slice(0, 300));
  if (m.method === "Runtime.exceptionThrown") problems.push("exception " + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 300)); });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result?.value; };
const shot = async (name) => { const { data } = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(`${out}/${name}.png`, Buffer.from(data, "base64")); };
const at = async (sel) => { const r = await ev(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.getClientRects().length); if (!e) return null; const b = e.getBoundingClientRect(); return {x: b.left + b.width/2, y: b.top + b.height/2}; })()`); if (!r) throw new Error(`no visible ${sel}`); return r; };
const click = async (sel) => { const r = await at(sel); for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: r.x, y: r.y, button: "left", clickCount: 1 }); };
const waitFor = async (expr, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(expr)) return true; await sleep(150); } await shot("zz-timeout"); throw new Error(`timed out: ${expr}\n${problems.join("\n")}`); };
const check = (ok, what) => { if (!ok) problems.push(`check failed: ${what}`); };
const report = { width: +w };
const ONLY = (process.env.ONLY ?? "landing,tabs").split(","); // ONLY=tabs: skip the landing (before shots on the base commit)
const prof = demoProfile(new Date());
prof.known = [];
// 7 days: the three demo days and four more weekdays after them
const extra = ["2026-11-06", "2026-11-09", "2026-11-10", "2026-11-11"].map((date) => ({ date, from: "14:00", to: "17:00" }));
prof.windows = [...prof.windows, ...extra];
prof.week = null; // the usual week wins over the dated windows (lib/week.js datedWindows); the dates are the days here
const key = storeKey(prof.brand, prof.city);
await send("Runtime.enable"); await send("Page.enable");
const state = { v: STORE_VERSION, brand: prof.brand, city: prof.city, profile: prof, plan: null, statuses: {}, outcomes: {}, savedAt: new Date().toISOString() };
await send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => { try { if (!localStorage.getItem("__seeded")) { localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify(state))}); localStorage.setItem(${JSON.stringify(BRAND_KEY)}, ${JSON.stringify(JSON.stringify({ v: STORE_VERSION, profile: prof, savedAt: new Date().toISOString() }))}); localStorage.setItem("doors:drive-voice", "off"); localStorage.setItem("__seeded", "1"); } } catch {} window.SpeechRecognition = undefined; delete window.webkitSpeechRecognition; })();` });
await send("Emulation.setDeviceMetricsOverride", { width: +w, height: +h, deviceScaleFactor: 1, mobile: +w < 700 });

// 1 + 2. the landing: the footnote and the map route hero (the still: ?instant=1)
if (ONLY.includes("landing")) {
await send("Page.navigate", { url: `${base}/?instant=1` });
await waitFor(`!!document.querySelector("#hero-map canvas")`, 30000);
await waitFor(`!document.querySelector("#hero-cap")?.hidden && document.querySelectorAll("#hero-map .pin, #hero-map .marker, #hero-map .maplibregl-marker").length >= 5`, 30000);
await sleep(2500);
await shot("a1-landing");
report.landing = await ev(`(() => ({ who: document.querySelector(".hero .who")?.textContent.trim(), cap: document.querySelector("#hero-cap")?.textContent.trim(), markers: document.querySelectorAll("#hero-map .maplibregl-marker").length, canvas: !!document.querySelector("#hero-map canvas"), pic1: !!document.querySelector(".hero-card.pic1, #hero-pic"), miles: document.querySelector(".hero-card .bmiles")?.textContent.trim() ?? null, card: document.querySelector(".hero-card .float")?.textContent.trim().slice(0, 80) ?? null }))()`);
check(report.landing.who === "For anyone selling a drink brand into bars and restaurants. Rankings from Qloo's taste data.", `footnote: ${report.landing.who}`);
check(report.landing.canvas && report.landing.markers >= 5 && !report.landing.pic1, `the map route hero: ${JSON.stringify(report.landing)}`);
check(/Athletic Brewing drinkers · Austin · .*doors$/.test(report.landing.cap ?? ""), `caption: ${report.landing.cap}`);
}

// 3. the plan: the day tabs with 7 days
const q = new URLSearchParams({ brand: prof.brand, city: prof.city });
await send("Page.navigate", { url: `${base}/app?ors=off&instant=1#/plan?${q}` });
await waitFor(`!!document.querySelector(".stop[data-id]")`, 60000);
await sleep(2000);
await send("Page.reload");
await waitFor(`!!document.querySelector(".stop[data-id]")`, 60000);
await sleep(1500);
const tabState = () => ev(`(() => { const t = document.querySelector(".daytabs"); const d = t.querySelector(".dtdays"); const sc = d && getComputedStyle(d).display !== "contents" ? d : t; const vis = (s) => { const e = t.querySelector(s); return !!e && e.getClientRects().length > 0 && getComputedStyle(e).display !== "none"; }; return { tabs: t.querySelectorAll("[data-tab]").length, scroller: sc === d ? "dtdays" : "daytabs", overflow: sc.scrollWidth - sc.clientWidth, left: Math.round(sc.scrollLeft), moreL: t.classList.contains("more-l") || !!d?.classList.contains("more-l"), moreR: t.classList.contains("more-r") || !!d?.classList.contains("more-r"), arrL: vis(".tarr.l"), arrR: vis(".tarr.r"), selected: t.querySelector("[aria-selected=true]")?.dataset.tab, arrRight: t.querySelector(".tarr.r")?.getBoundingClientRect().right, stripRight: t.getBoundingClientRect().right }; })()`);
report.t0 = await tabState();
await shot("c1-tabs");
check(report.t0.tabs === 9 && report.t0.overflow > 0, `9 tabs overflow the column (${JSON.stringify(report.t0)})`);
const desktop = +w > 900;
if (desktop) {
  check(report.t0.arrR && !report.t0.arrL && report.t0.moreR, `right arrow shows at the start, no left (${JSON.stringify(report.t0)})`);
  check(Math.abs(report.t0.arrRight - report.t0.stripRight) < 2, `the right arrow sits at the strip's right edge (${report.t0.arrRight} vs ${report.t0.stripRight})`);
  // the wheel over the strip scrolls it sideways
  const p = await at('.daytabs [data-tab="1"]');
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y });
  await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: p.x, y: p.y, deltaX: 0, deltaY: 120 });
  await sleep(500);
  report.t1 = await tabState();
  await shot("c2-tabs-wheel");
  check(report.t1.left > 50 && report.t1.arrL, `the wheel scrolled the strip (${JSON.stringify(report.t1)})`);
  check(await ev(`document.documentElement.scrollTop === 0 && (document.querySelector(".rcol")?.scrollTop ?? 0) === 0`), "the page did not scroll with the wheel");
  // the right arrow goes further; at the end the right arrow goes away
  for (let i = 0; i < 6; i++) { if (!(await tabState()).arrR) break; await click(".daytabs .tarr.r"); await sleep(700); }
  report.t2 = await tabState();
  await shot("c3-tabs-end");
  check(report.t2.left >= report.t2.overflow - 2 && !report.t2.arrR && report.t2.arrL, `the right arrow reached the end (${JSON.stringify(report.t2)})`);
  check(report.t2.selected === report.t0.selected, "an arrow click selected nothing");
  // drag the strip back with the mouse: a drag is not a click
  const q1 = await at('.daytabs [data-tab="week"]');
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: q1.x, y: q1.y });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: q1.x, y: q1.y, button: "left", clickCount: 1 });
  for (let i = 1; i <= 10; i++) { await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: q1.x + i * 20, y: q1.y, button: "left" }); await sleep(30); }
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: q1.x + 200, y: q1.y, button: "left", clickCount: 1 });
  await sleep(500);
  report.t3 = await tabState();
  await shot("c4-tabs-dragged");
  check(report.t3.left < report.t2.left - 100, `the drag scrolled the strip back (${report.t2.left} → ${report.t3.left})`);
  check(report.t3.selected === report.t0.selected, `a drag selected nothing (${report.t3.selected})`);
  // a plain click still selects (the tab scrolled into view first, as a person would)
  await ev(`document.querySelector('.daytabs [data-tab="rest"]').scrollIntoView({ inline: "center", block: "nearest" })`);
  await sleep(300);
  await click('.daytabs [data-tab="rest"]');
  await sleep(600);
  report.t4 = await tabState();
  check(report.t4.selected === "rest", `a click still selects (${report.t4.selected})`);
  // the left arrow scrolls back to the start
  for (let i = 0; i < 5; i++) { if (!(await tabState()).arrL) break; await click(".daytabs .tarr.l"); await sleep(700); }
  report.t5 = await tabState();
  await shot("c5-tabs-start");
  check(report.t5.left === 0 && !report.t5.arrL, `the left arrow reached the start (${JSON.stringify(report.t5)})`);
} else {
  check(!report.t0.arrR && !report.t0.arrL, "no arrows at a phone width");
  await ev(`document.querySelector(".dtdays").scrollBy(200, 0)`);
  await sleep(400);
  report.t1 = await tabState();
  await shot("c2-tabs-swiped");
  check(report.t1.left > 100, `the days' row scrolls (${JSON.stringify(report.t1)})`);
}
report.problems = problems;
fs.writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exit(problems.length ? 1 : 0);
