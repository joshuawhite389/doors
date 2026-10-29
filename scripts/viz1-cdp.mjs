// WHY-VIZ-SPEC lane 1 (slices A, F, G, H): seeds Maya's demo profile as a saved plan, opens Why these doors and walks
// picture 1 (the controls, the preview, Apply → Changes you made → Undo), the Deep Dive's age bump and a door's
// portrait, shooting each state. Usage: node scripts/viz1-cdp.mjs <base-url> <out-dir> [width] [height] [two]
import { spawn } from "node:child_process";
import fs from "node:fs";
import { demoProfile } from "../public/lib/demo-profile.js";
import { storeKey, STORE_VERSION, BRAND_KEY } from "../public/lib/store.js";
const [base, out, w = "1400", h = "900", mode = ""] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const port = 9400 + Math.floor(Math.random() * 400);
const dir = `/tmp/claude-1000/viz1-${port}`;
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
await sleep(2500);
await ev(`[...document.querySelectorAll('[data-drawer="why"]')].find((b) => b.getClientRects().length)?.click()`);
await waitFor(`!!document.querySelector("#why .wv-explorer svg .wv-dot")`, 20000);
await sleep(1500);
await shot("a1-home");
const say = await ev(`document.querySelector("#why .wv-explorer .wv-say").textContent`);
report.say = say;
check(/is #1 of \d+ for .+ and only the \d+(st|nd|rd|th) most popular door on Your list\./.test(say), `default sentence (${say.slice(0, 120)})`);
report.dots = await ev(`(() => { const c = {}; for (const d of document.querySelectorAll("#why .wv-explorer .wv-dot")) { const f = d.getAttribute("fill") + "/" + (d.getAttribute("stroke") ?? ""); c[f] = (c[f] ?? 0) + 1; } return c; })()`);
report.rows = await ev(`[...document.querySelectorAll("#why .wv-explorer [data-wv-row]")].map((r) => r.dataset.wvRow + ":" + [...r.querySelectorAll("[aria-pressed=true]")].map((b) => b.textContent).join("|"))`);
check(report.rows.some((r) => /^rooms:Bars\|Breweries/.test(r)), `rooms row shows the profile (${report.rows.join("; ")})`);
// hover a dot: the tooltip
await ev(`(() => { const h = document.querySelector('#why .wv-explorer .wv-hit[data-id="00000000-0000-4000-8000-271655E6AA28"]'); h.scrollIntoView({block:"center"}); h.dispatchEvent(new PointerEvent("pointerenter", { clientX: 400, clientY: 300, bubbles: true })); })()`);
await sleep(300);
report.tip = await ev(`document.querySelector(".wv-tip")?.textContent ?? null`);
// round 3 decimals fix (b58dccf): the tooltip says how well known in words; no 0.912 affinity row (the rank says it)
check(/Nomadic Beerworks#1 of \d+on Your list(Well known|Known locally|Almost unknown|One of the city's most popular doors)how well known/.test(report.tip ?? "") && !/0\.\d\d/.test(report.tip ?? ""), `tooltip (${report.tip})`);
await shot("a2-hover");
await ev(`document.querySelector('#why .wv-explorer .wv-hit[data-id="00000000-0000-4000-8000-271655E6AA28"]').dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }))`);
// the age band: y becomes the band's rank at once; the planner's preview follows
await click('#why .wv-explorer [data-wv-row="band"] [data-wv-v="25_34"]');
await waitFor(`!!document.querySelector("#why .wv-explorer [data-wv-act=apply]:not([disabled])")`, 40000);
await sleep(1200);
await shot("a3-age");
const sayAge = await ev(`document.querySelector("#why .wv-explorer .wv-say").textContent`);
report.sayAge = sayAge;
check(/With these settings \d+ doors qualify for Your list \(today: \d+\)\./.test(sayAge) && /Up is now the rank Qloo gives each door for 25–34 drinkers/.test(sayAge), `age sentence (${sayAge.slice(0, 200)})`);
check(await ev(`document.querySelector("#why .wv-explorer .wv-ax text:nth-of-type(1)")?.textContent !== undefined`), "axes drawn");
// plus restaurants: a second control stacks onto the same preview
await click('#why .wv-explorer [data-wv-row="rooms"] [data-wv-v="restaurants"]');
await waitFor(`!!document.querySelector("#why .wv-explorer [data-wv-act=apply]:not([disabled])") && /restaurants/.test(document.querySelector("#why .wv-explorer .wv-hint")?.textContent ?? "")`, 40000);
await sleep(1200);
await shot("a4-age-restaurants");
report.sayBoth = await ev(`document.querySelector("#why .wv-explorer .wv-say").textContent`);
report.hint = await ev(`document.querySelector("#why .wv-explorer .wv-hint").textContent`);
check(/If you: Pitch restaurants too and rank for 25–34 drinkers first\./.test(report.hint), `set text (${report.hint})`);
// Across: distance from the day's start (the x axis only; no new preview)
await click('#why .wv-explorer [data-wv-row="x"] [data-wv-v="km"]');
await sleep(1200);
await shot("a5-distance");
report.xLabel = await ev(`[...document.querySelectorAll("#why .wv-explorer .wv-ax text")].map((t) => t.textContent).filter((t) => /miles from/.test(t))[0] ?? null`);
check(/← miles from (.+, )?the day's start, as the crow flies/.test(report.xLabel ?? ""), `distance axis (${report.xLabel})`);
await click('#why .wv-explorer [data-wv-row="x"] [data-wv-v="pop"]');
await sleep(400);
// Rating 4.5 and up: a display filter
await click('#why .wv-explorer [data-wv-row="r45"] [data-wv-v="true"]');
await sleep(900);
await shot("a6-rating");
report.sayRating = await ev(`document.querySelector("#why .wv-explorer .wv-say").textContent`);
check(/rate(s)? under 4\.5 and (is|are) greyed out/.test(report.sayRating), `rating filter words (${report.sayRating.slice(-160)})`);
await click('#why .wv-explorer [data-wv-row="r45"] [data-wv-v="false"]');
await sleep(400);
// the table twin
await ev(`document.querySelector("#why .wv-explorer .wv-tbl").open = true`);
await sleep(300);
report.tableRows = await ev(`document.querySelectorAll("#why .wv-explorer .wv-tbl tbody tr").length`);
check(report.tableRows >= 15, `table twin lists the plan doors (${report.tableRows})`);
await shot("a7-table");
await ev(`document.querySelector("#why .wv-explorer .wv-tbl").open = false`);
// Apply: the plan re-routes, Changes you made logs both, Undo puts both back
const stopsBefore = await ev(`document.querySelectorAll(".stop[data-id]").length`);
await click("#why .wv-explorer [data-wv-act=apply]");
await sleep(4500);
await shot("a8-applied");
report.flash = await ev(`(document.querySelector(".toast, .flash, [role=status].toast")?.textContent ?? "")`);
const prof2 = await ev(`JSON.parse(localStorage.getItem(${JSON.stringify(key)})).profile`);
check(prof2.rooms.includes("restaurants") && prof2.drinkers?.age === "25_34", `profile applied (${JSON.stringify({ rooms: prof2.rooms, age: prof2.drinkers?.age })})`);
check(await ev(`document.querySelectorAll("#why .wv-explorer [data-wv-act]").length === 0`), "after Apply the controls match the profile: no Apply button");
await click('#why [data-view="changes"]');
await sleep(800);
await shot("a9-changes");
const changes = await ev(`document.querySelector("#why").textContent`);
check(/Pitch restaurants too\./.test(changes) && /Rank for 25–34 drinkers first\./.test(changes), "Changes you made lists both changes");
report.undos = await ev(`document.querySelectorAll('#why .w-facts [data-fix]').length`);
await click('#why .w-facts [data-fix]');
await sleep(4000);
await click('#why .w-facts [data-fix]').catch(() => {});
await sleep(4000);
const prof3 = await ev(`JSON.parse(localStorage.getItem(${JSON.stringify(key)})).profile`);
check(prof3.rooms.join() === "bars,breweries" && !prof3.drinkers?.age, `Undo ×2 puts the profile back (${JSON.stringify({ rooms: prof3.rooms, age: prof3.drinkers?.age })})`);
await ev(`(() => { const b = document.querySelector('#why [data-w="list"]'); if (b) b.click(); })()`);
await sleep(1500);
await shot("a10-undone-home");
report.sayAfter = await ev(`document.querySelector("#why .wv-explorer .wv-say")?.textContent ?? null`);
check(report.sayAfter === say, "the home reads as before after Undo");
// a dot opens its door
await ev(`document.querySelector('#why .wv-explorer .wv-hit[data-id="00000000-0000-4000-8000-271655E6AA28"]').dispatchEvent(new MouseEvent("click", { bubbles: true }))`);
await sleep(1500);
await shot("a11-door");
check(await ev(`/Nomadic Beerworks/.test(document.querySelector("#why .w-dname")?.textContent ?? "")`), "a dot opens Why this door");
// slice G: the portrait
await waitFor(`!!document.querySelector("#why .wv-port [data-wv-fig='portrait-mini'] svg .wv-focus")`, 10000);
report.portrait = await ev(`(() => { const p = document.querySelector("#why .wv-port"); return { status: p.querySelector(".wv-pt-status")?.textContent, lines: [...p.querySelectorAll(".wv-pt-line")].map((x) => x.textContent), chips: [...p.querySelectorAll(".wv-chip")].map((x) => x.textContent), ages: [...p.querySelectorAll(".wv-age")].map((x) => x.textContent), sisters: p.querySelectorAll(".wv-sis").length, dots: p.querySelectorAll(".wv-dot").length, footer: p.querySelector(".wv-src")?.textContent }; })()`);
check(/^On your plan: \w+, stop \d+ · #1 of 55 on Your list$/.test(report.portrait.status ?? ""), `portrait status (${report.portrait.status})`);
check(/^#1 of 55 for your drinker, 17th most popular on the list\.$/.test(report.portrait.lines[0] ?? ""), `portrait match line (${report.portrait.lines[0]})`);
check(/^Open \d+ (am|pm)–\d+ (am|pm) \w+\. Qloo tags it /.test(report.portrait.lines[1] ?? ""), `portrait hours line (${report.portrait.lines[1]})`);
check(report.portrait.chips.some((c) => /^Dog owners\d+% of Austin$/.test(c)) && report.portrait.ages.length === 5 && report.portrait.sisters === 8 && report.portrait.dots > 100, `portrait chips/ages/sisters/dots (${JSON.stringify([report.portrait.chips.slice(0, 3), report.portrait.ages.length, report.portrait.sisters, report.portrait.dots])})`);
check(/over the \d{3} Austin doors Doors holds\.$/.test(report.portrait.footer ?? ""), `portrait footer counts the city base (${report.portrait.footer})`);
report.ring = await ev(`(() => { const r = document.querySelector("#why .wv-port [data-wv-fig='portrait-ring'] svg"); return r ? { state: r.dataset.state, arcs: r.querySelectorAll(".wv-pt-arc path").length, parts: r.querySelectorAll("[data-part]").length } : null; })()`);
check(report.ring && report.ring.parts === 5 && report.ring.arcs >= 1 && /open \d+ of your \d+ minutes out|not open while you're out|closed/.test(report.ring.state), `portrait ring mini (${JSON.stringify(report.ring)})`);
await shot("g1-portrait");
await ev(`document.querySelector("#why .wv-port").scrollIntoView({ block: "start" })`);
await sleep(300);
await shot("g2-portrait-top");
// a sister tapped: picture 5 with this door selected
await click("#why .wv-port .wv-sis");
await waitFor(`!!document.querySelector("#why .wv-th-panel")`, 15000);
await sleep(800);
check(await ev(`/Nomadic Beerworks/.test(document.querySelector("#why .wv-th-phead")?.textContent ?? "")`), "a sister tap opens the thread with this door selected");
await shot("g3-thread-from-portrait");
await ev(`(() => { const b = document.querySelector('#why [data-w="list"]'); if (b) b.click(); })()`);
await sleep(600);
if (two) {
  await ev(`(() => { const b = document.querySelector('#why [data-w="list"]'); if (b) b.click(); })()`);
  await sleep(1200);
  check(await ev(`document.querySelectorAll('#why .wv-weights [data-wv-row^="weight:"]').length === 2`), "a weight row per drink, below the picture");
  await click('#why .wv-weights [data-wv-row="weight:white-claw"] [data-wv-v="less"]');
  await waitFor(`!!document.querySelector("#why .wv-explorer [data-wv-act=apply]:not([disabled])")`, 40000);
  await sleep(800);
  await shot("a12-weight");
  check(/Count White Claw drinkers less/.test(await ev(`document.querySelector("#why .wv-explorer .wv-hint").textContent`)), "weight preview words");
}
// slice F: the Deep Dive's age bump shares the age control with picture 1
await ev(`(() => { const b = document.querySelector('#why [data-w="list"]'); if (b) b.click(); })()`);
await sleep(800);
await click('#why [data-view="plan"]');
await waitFor(`!!document.querySelector("#why .wv-bump svg polyline")`, 20000);
await sleep(1200);
await shot("f1-bump");
report.bumpSay = await ev(`document.querySelector("#why .wv-bump .wv-say").textContent`);
check(/^Pick an age and the list moves\. .+ is #\d+ of \d+ for /.test(report.bumpSay), `bump all-ages sentence (${report.bumpSay.slice(0, 120)})`);
report.bumpLines = await ev(`document.querySelectorAll("#why .wv-bump svg polyline").length`);
check(report.bumpLines === (+w < 700 ? 6 : 12), `bump draws ${+w < 700 ? 6 : 12} doors (${report.bumpLines})`);
await click('#why .wv-bump [data-wv-row="band"] [data-wv-v="35_44"]');
await waitFor(`!!document.querySelector("#why .wv-bump [data-wv-act=apply]:not([disabled])")`, 40000);
await sleep(900);
await shot("f2-bump-band");
report.bumpBand = await ev(`document.querySelector("#why .wv-bump .wv-say").textContent`);
check(/^For 35–44 .+ drinkers, Qloo ranks \d+ .+ doors\. Of your (twelve|six) best: .+ rank; \d+ (isn't|aren't) on that list\. Apply, and Doors ranks Your list for 35–44 drinkers first/.test(report.bumpBand), `bump band sentence (${report.bumpBand.slice(0, 200)})`);
check(await ev(`document.querySelectorAll("#why .wv-bump svg rect[opacity='1']").length === 1`), "the picked band's column is lit");
// the same state on the home: 35–44 is pressed there too
await ev(`(() => { const b = document.querySelector('#why [data-w="list"]'); if (b) b.click(); })()`);
await waitFor(`!!document.querySelector("#why .wv-explorer svg .wv-dot")`, 20000);
await sleep(600);
check(await ev(`document.querySelector('#why .wv-explorer [data-wv-row="band"] [data-wv-v="35_44"]').getAttribute("aria-pressed") === "true"`), "the home's age row shows the band picked in the Deep Dive");
await shot("f3-home-shared");
await click('#why .wv-explorer [data-wv-act=reset]');
await sleep(400);
// slice H: the other views at this width (lane 2's pictures 3 and 2, the left-off list), the overflow probe on each
await ev(`(() => { const b = document.querySelector('#why [data-w="list"]'); if (b) b.click(); })()`);
await sleep(600);
for (const [view, sel] of [["who", ".wv-lift, [data-wv-slot='lift']"], ["missing", ".w-grp"], ["map", "[data-wv-slot='areas']"]]) {
  await click(`#why [data-view="${view}"]`);
  await waitFor(`!!document.querySelector(${JSON.stringify(sel)})`, 15000);
  await sleep(1200);
  await shot(`h-${view}`);
  await ev(`(() => { const b = document.querySelector('#why [data-w="list"]'); if (b) b.click(); })()`);
  await sleep(500);
}
if (Object.keys(overflows).length) problems.push(`overflow: ${JSON.stringify(overflows)}`);
console.log(JSON.stringify({ ...report, problems: [...new Set(problems)] }, null, 1));
process.exit(problems.length ? 1 : 0);
