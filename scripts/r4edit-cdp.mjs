// Round 4 item 6 (Jard 10-27: "i don't see a way to edit my schedule, hours, etc."), proven in headless Chromium over
// CDP: Settings lists every setup field with what it holds; Edit on Days and hours opens the city's form at that field;
// Save shows the change on the plan with what it does (the tray), Apply makes it with Undo (Changes you made), Undo puts
// it back; a change that can't touch the plan (your name) applies at once; Keep the old settings drops one; a brand
// field (door types) goes the same way and reaches the saved brand. Screenshots every step; prints a JSON report and
// "problems none".
// Usage: node scripts/r4edit-cdp.mjs <base-url> <out-dir> [width] [height]
import { spawn } from "node:child_process";
import fs from "node:fs";
const [base, out, w = "1400", h = "900"] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const port = 9400 + Math.floor(Math.random() * 400);
const dir = `/tmp/claude-1000/r4edit-${port}`;
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
  await sleep(250);
  const r2 = await ev(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.getClientRects().length); const b = e.getBoundingClientRect(); return {x: b.left + b.width/2, y: b.top + b.height/2}; })()`);
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: r2.x, y: r2.y, button: "left", clickCount: 1 });
  await sleep(200);
};
const type = async (sel, text) => { await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.scrollIntoView({block:"center"}); e.focus(); e.select?.(); })()`); await send("Input.insertText", { text }); await sleep(200); };
const waitFor = async (expr, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(expr)) return true; await sleep(150); } await shot("zz-timeout"); throw new Error(`timed out: ${expr}\n${problems.join("\n")}`); };
const check = (ok, what) => { if (!ok) problems.push(`check failed: ${what}`); };
const report = { width: +w, steps: [] };
const step = async (name, extra = {}) => { await sleep(500); await shot(name); report.steps.push({ name, ...extra }); };
const store = (k) => ev(`JSON.parse(localStorage.getItem(${JSON.stringify(k)}) ?? "null")`);

await send("Runtime.enable"); await send("Page.enable");
await send("Page.addScriptToEvaluateOnNewDocument", { source: `window.SpeechRecognition = undefined; delete window.webkitSpeechRecognition;` });
await send("Emulation.setDeviceMetricsOverride", { width: +w, height: +h, deviceScaleFactor: 1, mobile: +w < 700 });
const PLAN = "doors.v2.tidewell-austin";
const BRAND = "doors.v2.__brand";
const text = (sel) => ev(`document.querySelector(${JSON.stringify(sel)})?.innerText ?? ""`);
const planReady = `location.hash.startsWith("#/plan") && !!document.querySelector(".stop[data-id]") && !document.querySelector("[data-b2]")`;

// ---- Maya's example, built ----
await send("Page.navigate", { url: `${base}/app#/new?blank=1` });
await waitFor(`!!document.querySelector("#f-brand")`, 30000);
await sleep(800);
await ev(`document.querySelector("#examples details").open = true`);
await click(`[data-ex="maya"]`);
await waitFor(`document.querySelector("#f-brand").value === "Tidewell"`);
await click("#build");
await waitFor(planReady, 90000);
await sleep(2000);
await step("01-plan", { hash: await ev("location.hash") });

// ---- Settings: every field, with its value ----
await click("#t-menu");
await click("#t-settings");
await waitFor(`!document.querySelector("#settings").hidden`);
const settings = await text("#settings");
await step("02-settings", { settings: settings.slice(0, 600) });
// round 8: one summary per part with one Edit each (scripts/r8settings-cdp.mjs walks the Back button); the ?field=
// deep links still open a form at that field, so this walk opens them by address
for (const need of ["Brand name", "Your product", "Your drinker also drinks", "Door types", "Your ask", "Days and hours", "Tue 1 pm–6 pm; Wed, Thu 2 pm–5 pm", "Time at each door", "25 min", "Most doors a day", "Edit my brand", "Edit this city", "My cities", "Navigation app"]) check(settings.includes(need), `Settings lists "${need}"`);
const edits = await ev(`[...document.querySelectorAll("#settings a.btn")].map((a) => a.getAttribute("href"))`);
check(edits.includes("#/city?city=austin") && edits.includes("#/brand") && !edits.some((h) => h.includes("field=")), `one Edit per part, none per field: ${edits.join(" ")}`);
await step("03-settings-city-rows");

// ---- the city's form, at Days and hours (the deep link) ----
await ev(`location.hash = "#/city?city=austin&field=windows"`);
await waitFor(`location.hash.includes("field=windows") && !!document.querySelector("#fd-windows")`);
await sleep(900);
const at = await ev(`({ here: !!document.querySelector("#fd-windows.here"), focusIn: !!document.activeElement?.closest("#fd-windows"), inView: (() => { const b = document.querySelector("#fd-windows").getBoundingClientRect(); return b.top < innerHeight && b.bottom > 0; })(), h2: document.querySelector(".pform h2").textContent, save: document.querySelector("#build").textContent.trim() })`);
await step("04-form-at-days", at);
check(at.here && at.inView && at.h2 === "Edit Austin", `the form opens at Days and hours, marked: ${JSON.stringify(at)}`);
check(at.save === "Save", `the saved city's button says Save: ${at.save}`);

// ---- a day added, Save → the plan shows the change first ----
await click(`#days button[aria-pressed="false"]`);
await waitFor(`!document.querySelector("#build").disabled`);
await click("#build");
await waitFor(planReady, 90000);
await waitFor(`!document.querySelector("#p-pending").hidden && /If you apply/.test(document.querySelector("#p-pending").innerText)`, 60000);
await sleep(600);
const tray = await text("#p-pending");
await step("05-tray", { tray });
check(/Your new settings/.test(tray) && /Days and hours:/.test(tray) && /\(was Tue 1 pm–6 pm; Wed, Thu 2 pm–5 pm\)/.test(tray), `the tray says what changed and what it was: ${tray}`);
check(/If you apply: .*(door|plan)/.test(tray), `the tray says what it does to the plan: ${tray}`);
check(Object.keys((await store(PLAN)).profile.week.days).length === 3, "nothing saved before Apply");
const daysBefore = await ev(`[...document.querySelectorAll('.daytabs [data-tab]')].filter((b) => /^[0-9]+$/.test(b.dataset.tab)).length`);

// ---- Apply: the plan re-plans, Changes you made holds it, the toast has Undo ----
await click(`[data-pend="apply"]`);
await waitFor(`document.querySelector("#p-pending").hidden && !document.querySelector("#p-toast").hidden`, 60000);
await sleep(800);
const applied = await ev(`({ toast: document.querySelector("#p-toast").innerText, undo: !!document.querySelector("#p-toast [data-undo]"), days: [...document.querySelectorAll('.daytabs [data-tab]')].filter((b) => /^[0-9]+$/.test(b.dataset.tab)).length })`);
const st1 = await store(PLAN);
await step("06-applied", { ...applied, weekDays: Object.keys(st1.profile.week.days), changes: (st1.whyChanges ?? []).map((e) => [e.kind, e.text]) });
check(Object.keys(st1.profile.week.days).length === 4, `the saved profile has the new day: ${Object.keys(st1.profile.week.days)}`);
check(applied.undo && /Days and hours/.test(applied.toast), `the toast says the change and has Undo: ${applied.toast}`);
check((st1.whyChanges ?? []).some((e) => e.kind === "profile" && e.change?.kind === "profile"), "Changes you made holds the settings change");
check(applied.days > daysBefore, `the plan has more days (${daysBefore} → ${applied.days})`);

// ---- Undo: the profile and the plan as they were ----
await click(`#p-toast [data-undo]`);
await waitFor(`document.querySelector("#p-toast").hidden || /Undone/.test(document.querySelector("#p-toast").innerText)`, 60000);
await sleep(1200);
const st2 = await store(PLAN);
const undone = { weekDays: Object.keys(st2.profile.week.days), changes: (st2.whyChanges ?? []).length, days: await ev(`[...document.querySelectorAll('.daytabs [data-tab]')].filter((b) => /^[0-9]+$/.test(b.dataset.tab)).length`) };
await step("07-undone", undone);
check(undone.weekDays.length === 3 && undone.changes === 0 && undone.days === daysBefore, `Undo puts the week and the plan back: ${JSON.stringify(undone)}`);

// ---- a change that can't touch the plan (your name) applies at once ----
await click("#t-menu"); await click("#t-settings");
await waitFor(`!document.querySelector("#settings").hidden`);
await ev(`location.hash = "#/brand?field=name"`);
await waitFor(`location.hash.includes("field=name") && !!document.querySelector("#f-name")`);
await sleep(600);
check(await ev(`document.activeElement?.id === "f-name"`), "the brand's form opens with the focus in Sign your messages as");
await type("#f-name", "Maya O.");
await click("#build");
await waitFor(planReady, 90000);
await waitFor(`!document.querySelector("#p-toast").hidden`, 30000);
await sleep(500);
const name = { toast: await text("#p-toast"), tray: await ev(`document.querySelector("#p-pending").hidden`), saved: (await store(PLAN)).profile.pitch.name, brand: (await store(BRAND))?.profile?.pitch?.name };
await step("08-name-applied", name);
check(name.tray && /Sign your messages as: Maya O\./.test(name.toast) && !/\(was/.test(name.toast) && name.saved === "Maya O." && name.brand === "Maya O.", `your name applies at once, to the plan and the saved brand: ${JSON.stringify(name)}`);

// ---- Keep the old settings ----
await click("#t-menu"); await click("#t-settings");
await waitFor(`!document.querySelector("#settings").hidden`);
await ev(`location.hash = "#/city?city=austin&field=visit"`);
await waitFor(`location.hash.includes("field=visit") && !!document.querySelector("#f-visit")`);
await sleep(600);
await type("#f-visit", "40");
await click("#build");
await waitFor(planReady, 90000);
await waitFor(`!document.querySelector("#p-pending").hidden && /If you apply/.test(document.querySelector("#p-pending").innerText)`, 60000);
await step("09-tray-visit", { tray: await text("#p-pending") });
await click(`[data-pend="keep"]`);
await sleep(800);
const kept = { visit: (await store(PLAN)).profile.visitMin, toast: await text("#p-toast") };
await step("10-kept", kept);
check(kept.visit === 25 && /as they were/.test(kept.toast), `Keep the old settings changes nothing: ${JSON.stringify(kept)}`);

// ---- a brand field that moves the plan (door types): tray, Apply, the saved brand follows ----
await click("#t-menu"); await click("#t-settings");
await waitFor(`!document.querySelector("#settings").hidden`);
await ev(`location.hash = "#/brand?field=rooms"`);
await waitFor(`location.hash.includes("field=rooms") && !!document.querySelector("#rooms")`);
await sleep(600);
await click(`#rooms button[aria-pressed="false"]`);
await click("#build");
await waitFor(planReady, 90000);
await waitFor(`!document.querySelector("#p-pending").hidden && /If you apply/.test(document.querySelector("#p-pending").innerText)`, 60000);
const rtray = await text("#p-pending");
await step("11-tray-rooms", { tray: rtray });
check(/Door types:/.test(rtray), `the brand's change is tried on the plan: ${rtray}`);
await click(`[data-pend="apply"]`);
await waitFor(`document.querySelector("#p-pending").hidden && !document.querySelector("#p-toast").hidden`, 60000);
await sleep(800);
const rooms = { plan: (await store(PLAN)).profile.rooms, brand: (await store(BRAND))?.profile?.rooms, changes: ((await store(PLAN)).whyChanges ?? []).map((e) => e.text) };
await step("12-rooms-applied", rooms);
check(rooms.plan.length === 3 && rooms.brand?.length === 3, `door types applied to the plan and the saved brand: ${JSON.stringify(rooms)}`);

// ---- Changes you made lists it with Undo ----
await click(`[data-drawer="why"]`);
await waitFor(`!document.querySelector("#why").hidden`, 20000);
await sleep(1500);
const why = await text("#why");
await step("13-why", { why: why.slice(0, 400) });
check(/Door types/.test(why) || /Sign your messages/.test(why), `Why these doors shows the settings changes: ${why.slice(0, 300)}`);

report.problems = problems;
console.log(JSON.stringify(report, null, 1));
console.log(problems.length ? `problems ${problems.length}` : "problems none");
process.exit(problems.length ? 1 : 0);
