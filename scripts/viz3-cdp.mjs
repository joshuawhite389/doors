// WHY-VIZ-SPEC §6 Elsewhere: seeds Maya's demo profile as a saved plan and walks Your list (the strip per row), a stop card
// (the rarity chips), the Week tab (the clouds under the loops, kept when the Why drawer closes) and the landing hero
// (picture 1 with two labels), shooting each state. Usage: node scripts/viz3-cdp.mjs <base-url> <out-dir> [width] [height] [two]
import { spawn } from "node:child_process";
import fs from "node:fs";
import { demoProfile } from "../public/lib/demo-profile.js";
import { storeKey, STORE_VERSION, BRAND_KEY } from "../public/lib/store.js";
const [base, out, w = "1400", h = "900", mode = ""] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const port = 9400 + Math.floor(Math.random() * 400);
const dir = `/tmp/claude-1000/viz3-${port}`;
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
const two = mode === "two";
if (two) prof.drinks = [...prof.drinks, { key: "white-claw", name: "White Claw", ready: true }];
const key = storeKey(prof.brand, prof.city);
await send("Runtime.enable"); await send("Page.enable");
const state = { v: STORE_VERSION, brand: prof.brand, city: prof.city, profile: prof, plan: null, statuses: {}, outcomes: {}, savedAt: new Date().toISOString() };
await send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => { try { if (!localStorage.getItem("__seeded")) { localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify(state))}); localStorage.setItem(${JSON.stringify(BRAND_KEY)}, ${JSON.stringify(JSON.stringify({ v: STORE_VERSION, profile: prof, savedAt: new Date().toISOString() }))}); localStorage.setItem("doors:drive-voice", "off"); localStorage.setItem("__seeded", "1"); } } catch {} window.SpeechRecognition = undefined; delete window.webkitSpeechRecognition; })();` });
await send("Emulation.setDeviceMetricsOverride", { width: +w, height: +h, deviceScaleFactor: 1, mobile: +w < 700 });
const q = new URLSearchParams({ brand: prof.brand, city: prof.city });
await send("Page.navigate", { url: `${base}/app?ors=off#/plan?${q}` });
await waitFor(`!!document.querySelector(".stop[data-id]")`, 40000);
await sleep(2500);
await send("Page.reload");
await waitFor(`!!document.querySelector(".stop[data-id]")`, 40000);
const NOMADIC = "00000000-0000-4000-8000-271655E6AA28";
// 1. Your list: a strip per ranked row (hairline, the big-names tick, a dot at the door's popularity)
await click('.daytabs [data-tab="rest"]');
await waitFor(`document.querySelectorAll(".stop.rest .lstrip").length > 10`, 20000);
await sleep(800);
await shot("b1-list");
report.strips = await ev(`(() => { const rows = [...document.querySelectorAll(".stop.rest[data-id]")]; const ranked = rows.filter((r) => /^#\\d+$/.test(r.querySelector(".pin.rk")?.textContent ?? "")); return { rows: rows.length, ranked: ranked.length, strips: document.querySelectorAll(".stop.rest .lstrip").length, dots: document.querySelectorAll(".stop.rest .lstrip circle").length, ticks: document.querySelectorAll(".stop.rest .lstrip line[stroke='#CF6612']").length, overflow: ranked.filter((r) => { const s = r.querySelector(".lstrip"); return s && s.getBoundingClientRect().right > r.getBoundingClientRect().right + 1; }).length, first: [...ranked.slice(0, 3)].map((r) => r.querySelector(".lstrip")?.getAttribute("aria-label")) }; })()`);
check(report.strips.strips === report.strips.ranked && report.strips.ranked >= 50, `one strip per ranked row (${JSON.stringify(report.strips)})`);
check(report.strips.ticks === report.strips.strips && report.strips.overflow === 0, "every strip has the big-names tick and stays inside its row");
check(report.strips.first.every((t) => /^How well known: (almost unknown|known locally|well known|one of the best-known)/.test(t ?? "")), `strip words (${report.strips.first})`);
check(!/0\.\d/.test(await ev(`[...document.querySelectorAll(".stop.rest .lstrip")].map((s) => s.getAttribute("aria-label")).join(" ")`)), "no decimals in the strips' words");
// 2. the stop card: rarity chips in place of the crowd line
await click(`.stops .stop[data-id="${NOMADIC}"] [data-open]`);
await waitFor(`!!document.querySelector(".stopview:not([hidden]) .dabout .rchips")`, 30000);
await sleep(800);
await ev(`document.querySelector(".stopview:not([hidden]) .dabout")?.scrollIntoView({ block: "center" })`);
await sleep(300);
await shot("b2-stop-chips");
report.chips = await ev(`(() => { const v = document.querySelector(".stopview:not([hidden]) .dabout"); return { titles: [...v.querySelectorAll("h5")].map((h) => h.textContent), chips: [...v.querySelectorAll(".rchip")].map((c) => c.textContent), plainCrowd: [...v.querySelectorAll("div")].some((d) => d.querySelector("h5")?.textContent === "Crowd" && d.querySelector("p:not(.rline)")), line: v.querySelector(".rline")?.textContent ?? null }; })()`);
check(report.chips.chips.length >= 1 && report.chips.chips.every((c) => /% of Austin$/.test(c)), `rarity chips with the city share (${report.chips.chips.join(" | ")})`);
check(report.chips.titles[0] === "Crowd" && !report.chips.plainCrowd, `the chips sit in the Crowd slot, no crowd sentence beside them (${report.chips.titles.join(", ")})`);
check(/far more of than Austin does, each with the share of the \d+ Austin doors Doors holds/.test(report.chips.line ?? ""), `source line (${report.chips.line})`);
await ev(`window.dispatchEvent(new CustomEvent("doors:close-stop"))`);
await sleep(600);
// 3. the week view: the clouds under the week's loops, no pills; the Why drawer's own clouds replace them while it is open, and come back when it closes
await click('.daytabs [data-tab="week"]');
await waitFor(`/week$/.test(document.querySelector("#plan-map, .mapwrap .maplibregl-map")?.dataset.wvWash ?? "")`, 30000);
await sleep(2500);
await shot("b3-week-clouds");
report.week = await ev(`(() => { const c = document.querySelector("#plan-map, .mapwrap .maplibregl-map"); return { wash: c?.dataset.wvWash ?? null, pills: document.querySelectorAll(".wv-pill").length }; })()`);
check(/^\d+ week$/.test(report.week.wash ?? "") && +report.week.wash.split(" ")[0] >= 3, `the week's wash is up (${report.week.wash})`);
check(report.week.pills === 0, `no pills on the week view (${report.week.pills})`);
await ev(`[...document.querySelectorAll('[data-drawer="why"]')].find((b) => b.getClientRects().length)?.click()`);
await waitFor(`/^\\d+$/.test(document.querySelector("#plan-map, .mapwrap .maplibregl-map")?.dataset.wvWash ?? "")`, 30000);
await sleep(1500);
report.weekWhy = await ev(`document.querySelector("#plan-map, .mapwrap .maplibregl-map")?.dataset.wvWash ?? null`);
check(/^\d+$/.test(report.weekWhy ?? ""), `the drawer's own clouds while Why is open (${report.weekWhy})`);
await shot("b4-week-why-open");
await ev(`[...document.querySelectorAll('[data-drawer="why"]')].find((b) => b.getClientRects().length)?.click()`);
await waitFor(`/week$/.test(document.querySelector("#plan-map, .mapwrap .maplibregl-map")?.dataset.wvWash ?? "")`, 30000);
await sleep(1500);
report.weekBack = await ev(`(() => { const c = document.querySelector("#plan-map, .mapwrap .maplibregl-map"); return { wash: c?.dataset.wvWash ?? null, pills: document.querySelectorAll(".wv-pill").length }; })()`);
check(/week$/.test(report.weekBack.wash ?? "") && report.weekBack.pills === 0, `the week's clouds come back when Why closes (${JSON.stringify(report.weekBack)})`);
await shot("b5-week-why-closed");
// a day tab: the week's clouds go
await click('.daytabs [data-tab="0"]');
await sleep(1500);
report.dayWash = await ev(`document.querySelector("#plan-map, .mapwrap .maplibregl-map")?.dataset.wvWash ?? null`);
check(report.dayWash === null, `no clouds on a day tab (${report.dayWash})`);
await shot("b6-day");
// 4. the landing: picture 1 with two labels
await send("Page.navigate", { url: `${base}/?instant=1&home=1` });
await waitFor(`document.querySelectorAll("#hero-pic .wv-dot").length > 50`, 30000);
await sleep(1200);
await shot("b7-landing");
report.hero = await ev(`(() => { const svg = document.querySelector("#hero-pic svg"); const R = svg.getBoundingClientRect(); const labels = [...svg.querySelectorAll(".wv-labels text")].map((t) => ({ t: t.textContent, in: (() => { const b = t.getBoundingClientRect(); return b.left >= R.left - 1 && b.right <= R.right + 1 && b.top >= R.top - 1 && b.bottom <= R.bottom + 1; })() })); const boxes = [...svg.querySelectorAll(".wv-labels text")].map((t) => t.getBoundingClientRect()); let overlap = 0; for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) { const a = boxes[i], b = boxes[j]; if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) overlap++; } return { dots: svg.querySelectorAll(".wv-dot").length, plan: svg.querySelectorAll(".wv-dot.plan").length, big: svg.querySelectorAll(".wv-dot.big").length, labels, overlap, cap: document.querySelector("#hero-cap")?.textContent ?? null, side: document.documentElement.scrollWidth > innerWidth + 1 }; })()`);
check(report.hero.dots >= 100 && report.hero.plan === 21 && report.hero.big >= 20, `the hero draws the demo's picture 1 (${report.hero.dots} dots, ${report.hero.plan} plan, ${report.hero.big} big)`);
check(report.hero.labels.some((l) => /^Big names/.test(l.t)) && report.hero.labels.some((l) => /^Nomadic Beerworks$/.test(l.t)) && report.hero.labels.some((l) => /^#1 of 55 for Athletic Brewing drinkers$/.test(l.t)), `the two labels (${report.hero.labels.map((l) => l.t).join(" | ")})`);
check(report.hero.labels.every((l) => l.in) && report.hero.overlap === 0 && !report.hero.side, `labels inside the picture, none overlapping, no sideways scroll (${JSON.stringify(report.hero.labels.filter((l) => !l.in))}, overlap ${report.hero.overlap})`);
check(!/0\.\d/.test(report.hero.labels.map((l) => l.t).join(" ").replace("0.9 and up", "")), "no decimals on the hero but Doors' 0.9 line");
report.overflows = overflows;
report.problems = problems;
fs.writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (problems.length || Object.keys(overflows).length) { console.error("PROBLEMS:", problems, overflows); process.exit(1); }
process.exit(0);
