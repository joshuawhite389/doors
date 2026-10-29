// The usual week (Jard 10-24) and its area days (gigbot 10-25), proven in headless Chromium over CDP: the form's When you're free is a repeating week
// (Maya's example: Tue, Wed, Thu) with changes to one date (a usual date taken off, a Saturday added); the plan covers
// this week and next, the All days view groups them by week with the weeks line; a follow-up logged four weeks out
// through the stop's outcome sheet lands on that Thursday (no "not on your plan"). Screenshots every step; prints a
// JSON report and "problems none".
// Usage: node scripts/weekly-cdp.mjs <base-url> <out-dir> [width] [height] [before]   (before: shots only, no checks)
// Usage: node scripts/weekly-cdp.mjs <base-url> <out-dir> [width] [height] [before]   (before: shots only, no checks)
import { spawn } from "node:child_process";
import fs from "node:fs";
const [base, out, w = "1400", h = "900", mode = ""] = process.argv.slice(2);
const before = mode === "before";
fs.mkdirSync(out, { recursive: true });
const port = 9400 + Math.floor(Math.random() * 400);
const dir = `/tmp/claude-1000/weekly-${port}`;
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
const check = (ok, what) => { if (!ok && !before) problems.push(`check failed: ${what}`); };
const report = { width: +w, steps: [] };
const step = async (name, extra = {}) => { await sleep(500); await shot(name); report.steps.push({ name, ...extra }); };
const store = (k) => ev(`JSON.parse(localStorage.getItem(${JSON.stringify(k)}) ?? "null")`);

await send("Runtime.enable"); await send("Page.enable");
await send("Page.addScriptToEvaluateOnNewDocument", { source: `window.SpeechRecognition = undefined; delete window.webkitSpeechRecognition;` });
await send("Emulation.setDeviceMetricsOverride", { width: +w, height: +h, deviceScaleFactor: 1, mobile: +w < 700 });
await send("Page.navigate", { url: `${base}/app` });
await waitFor(`!!document.querySelector("#f-brand")`, 30000);
await sleep(1000);

// ---- the form: Maya's example fills her usual week ----
await ev(`document.querySelector("#examples details").open = true`);
await click(`[data-ex="maya"]`);
await waitFor(`document.querySelector("#f-brand").value === "Tidewell"`);
await ev(`document.querySelector("#fd-windows").scrollIntoView({ block: "start" })`);
const form = await ev(`({ hint: document.querySelector("#days-hint")?.textContent ?? null, usual: [...document.querySelectorAll('#days [aria-pressed="true"]')].map((b) => b.textContent), rows: [...document.querySelectorAll("#wins .win b")].map((b) => b.textContent), dates: document.querySelectorAll("#dates button").length, free: [...document.querySelectorAll('#dates [aria-pressed="true"]')].map((b) => b.textContent) })`);
await step("01-form-week", form);
if (before) { report.problems = problems; console.log(JSON.stringify(report, null, 1)); console.log("before: shots only"); process.exit(0); }
check(form.usual.join() === "Tue,Wed,Thu" && form.rows.join() === "Tue,Wed,Thu", `her usual week: ${JSON.stringify(form)}`);
check(form.dates === 14 && form.free.length >= 3, `14 dates, her free ones pressed: ${JSON.stringify(form)}`);

// ---- changes to one date: the first free date off, the first Saturday added ----
const off = form.free[0];
await click(`#dates [aria-pressed="true"]`);
const sat = await ev(`[...document.querySelectorAll('#dates [aria-pressed="false"]')].find((b) => /^Sat/.test(b.textContent))?.textContent ?? null`);
await ev(`[...document.querySelectorAll('#dates [aria-pressed="false"]')].find((b) => /^Sat/.test(b.textContent)).setAttribute("data-pick", "1")`);
await click(`#dates [data-pick]`);
await ev(`document.querySelector("#fd-dates").scrollIntoView({ block: "center" })`);
const chg = await ev(`[...document.querySelectorAll("#chg .win")].map((r) => r.innerText.replace(/\\s+/g, " ").trim())`);
await step("02-one-date-changes", { off, sat, chg });
check(chg.length === 2 && chg.some((t) => t.startsWith(off) && /Not free this date/.test(t)) && chg.some((t) => t.startsWith(sat) && /this date only/.test(t)), `one date off, one added: ${JSON.stringify(chg)}`);
// put the day back (Free as usual) and keep the Saturday
await click(`#chg .win.off [data-ws="usual"]`);
check((await ev(`document.querySelectorAll("#chg .win").length`)) === 1, "Free as usual takes the change off");
check(!(await ev(`document.querySelector("#build").disabled`)), "Build is on");

// ---- the plan: two weeks ----
await click("#build");
await waitFor(`location.hash.startsWith("#/plan") && !!document.querySelector(".stop[data-id]") && !document.querySelector("[data-b2]")`, 90000);
await sleep(2500);
const tabs = await ev(`[...document.querySelectorAll(".daytabs .dtdays [data-tab]")].map((b) => b.getAttribute("aria-label") ?? b.textContent)`);
await step("03-plan", { tabs });
check(tabs.length === 7, `Tue/Wed/Thu twice and her Saturday: ${tabs.length} ${JSON.stringify(tabs)}`);
await click(`.daytabs [data-tab="week"]`);
await sleep(800);
const all = await ev(`({ weeks: document.querySelector(".rhead .meta.weeks")?.textContent ?? null, heads: [...document.querySelectorAll(".weekhead")].map((x) => x.textContent) })`);
await step("04-all-days-by-week", all);
check(/^Week of \w+ \d+: \d+ doors? · Week of \w+ \d+: \d+ doors? · \d+ left on Your list$/.test(all.weeks ?? "") && all.heads.length === 2, `the weeks line and two week heads: ${JSON.stringify(all)}`);
// area days (gigbot 10-25): week 2's heads name its days by area, one of them a day out to the doors left far off
const area = await ev(`({ areas: [...document.querySelectorAll(".weekhead .areas")].map((x) => x.textContent), line: document.querySelector('.dayhead button[data-tab]') && [...document.querySelectorAll(".weekhead")].at(-1)?.textContent })`);
check(area.areas.length === 2 && area.areas.every((t) => / day(,|$)/.test(t)) && /Austin day/.test(area.areas[1]), `week heads name the days by area: ${JSON.stringify(area)}`);
report.steps.at(-1).areas = area.areas;
await click(`.daytabs [data-tab="rest"]`);
await sleep(600);
await step("05-your-list", { weeks: await ev(`document.querySelector(".rhead .meta.weeks")?.textContent ?? null`) });

// ---- a follow-up four weeks out, through the stop's outcome sheet ----
await click(`.daytabs .dtdays [data-tab="0"]`);
await sleep(800);
const door = await ev(`document.querySelector(".stop[data-id]").dataset.id`);
const name = await ev(`document.querySelector(".stop[data-id] b, .stop[data-id] .nm")?.textContent ?? ""`);
const firstDate = await ev(`JSON.parse(localStorage.getItem("doors.v2.tidewell-austin")).plan.days[0].date`);
const fu = await ev(`(() => { const d = new Date(${JSON.stringify(firstDate)} + "T12:00"); d.setDate(d.getDate() + 28 + ((4 - d.getDay() + 7) % 7)); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); })()`);
await click(`.stop[data-id="${door}"] [data-open]`);
await waitFor(`!!document.querySelector('[data-s="visit"]')`);
await click(`[data-s="visit"]`);
await waitFor(`!!document.querySelector(".osheet")`);
await click(`.osheet [data-o="more"]`);
await click(`.osheet [data-r="followup"]`);
await ev(`(() => { const e = document.querySelector("#o-date"); e.value = ${JSON.stringify(fu)}; e.dispatchEvent(new Event("change", { bubbles: true })); })()`);
await step("06-follow-up-sheet", { door, fu });
await click(`.osheet [data-o="save"]`);
await sleep(1500);
const err = await ev(`(() => { const e = document.querySelector(".osheet .oerr"); return e && !e.hidden ? e.textContent : null; })()`);
check(!err, `no warning for a usual Thursday four weeks out: ${err}`);
await waitFor(`(() => { const s = JSON.parse(localStorage.getItem("doors.v2.tidewell-austin")); return s.outcomes?.[${JSON.stringify(door)}]?.followUp === ${JSON.stringify(fu)} && s.plan.days.some((d) => d.date === ${JSON.stringify(fu)}); })()`, 30000);
const saved = await ev(`(() => { const s = JSON.parse(localStorage.getItem("doors.v2.tidewell-austin")); const d = s.plan.days.find((x) => x.date === ${JSON.stringify(fu)}); return { days: s.plan.days.map((x) => x.date), on: d.stops.some((x) => x.id === ${JSON.stringify(door)} && x.pinned === "followup") }; })()`);
await ev(`document.querySelector(".osheet [data-o='cancel']")?.click(); [...document.querySelectorAll('[data-s="close"]')].find((b) => b.getClientRects().length)?.click()`);
await sleep(600);
await click(`.daytabs [data-tab="week"]`);
await sleep(1000);
await ev(`[...document.querySelectorAll(".weekhead")].at(-1)?.scrollIntoView({ block: "start" })`);
const late = await ev(`({ weeks: document.querySelector(".rhead .meta.weeks")?.textContent ?? null, heads: [...document.querySelectorAll(".weekhead")].map((x) => x.textContent), areaDays: [...document.querySelectorAll(".weekhead .areas")].length })`);
await step("07-follow-up-landed", { fu, door: name, ...saved, ...late });
check(saved.on, `the follow-up is on ${fu}: ${JSON.stringify(saved)}`);
check(late.heads.length >= 4, `the plan reaches its week: ${JSON.stringify(late.heads)}`);

fs.writeFileSync(`${out}/state.json`, JSON.stringify(await store("doors.v2.tidewell-austin"))); // the saved plan, to replay
report.problems = problems;
console.log(JSON.stringify(report, null, 1));
console.log(problems.length ? `problems ${problems.length}` : "problems none");
process.exit(problems.length ? 1 : 0);
