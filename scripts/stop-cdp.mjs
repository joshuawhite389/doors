// Prove Stop for today (GROUP3 item 9) in a real browser over CDP. A saved Tidewell plan whose first window is today
// (the page's clock pinned to 12:55 pm), Start my day, two doors logged, then: Running late: shift everything (+60 min)
// → the doors that no longer fit → Move them into the coming days; Stop for today → Move them into the coming days →
// the debrief → Resume my day (the doors back on today); Stop for today → Put them back on Your list; back on the plan
// the button says Resume my day; Why these doors → Changes you made lists the stop and the late move, each Undo works
// (newest first). Screenshots every step; prints a JSON report, exit 1 on a failed check.
// MODE=before: only the screens this changes, for a before shot on the base branch (the door, the end sheet, the late
// banner). Usage: node scripts/stop-cdp.mjs <base-url> <out-dir> [width] [height] [browser]
import { spawn } from "node:child_process";
import fs from "node:fs";
import { demoProfile } from "../public/lib/demo-profile.js";
import { storeKey, STORE_VERSION, BRAND_KEY } from "../public/lib/store.js";
import { isoDate } from "../public/lib/profile.js";

const [base, out, w = "1400", h = "900", browser = "chromium"] = process.argv.slice(2);
const before = process.env.MODE === "before";
fs.mkdirSync(out, { recursive: true });
const port = 9400 + Math.floor(Math.random() * 400);
const dir = `/tmp/claude-1000/stopcdp-${port}`;
const ch = spawn(browser, ["--headless=new", `--remote-debugging-port=${port}`, "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--hide-scrollbars", `--window-size=${w},${h}`, `--user-data-dir=${dir}`, "about:blank"], { stdio: "ignore", detached: true });
const cleanup = () => { try { process.kill(-ch.pid, "SIGKILL"); } catch {} try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };
process.on("exit", cleanup);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(1));
process.on("uncaughtException", (e) => { console.error(e); process.exit(1); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 75; i++) { try { const t = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); const p = t.find((x) => x.type === "page"); if (p) { ws = new WebSocket(p.webSocketDebuggerUrl); break; } } catch {} await sleep(200); }
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pend = new Map(); const problems = [];
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
  if (m.method === "Runtime.consoleAPICalled" && /error/.test(m.params.type)) problems.push("console.error " + m.params.args.map((a) => a.value ?? a.description).join(" ").slice(0, 300));
  if (m.method === "Runtime.exceptionThrown") problems.push("exception " + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 300));
});
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result?.value; };
let step = 0;
const shot = async (name) => { await sleep(250); const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }); fs.writeFileSync(`${out}/${before ? "before" : "after"}-${w}-${String(++step).padStart(2, "0")}-${name}.png`, Buffer.from(data, "base64")); };
const click = async (sel) => {
  const r = await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({block:"center"}); const b = e.getBoundingClientRect(); return {x: b.left + b.width/2, y: b.top + b.height/2}; })()`);
  if (!r) throw new Error(`no ${sel}\n${await ev(`(document.querySelector("#drive") ?? document.body).innerText.slice(0, 800)`)}`);
  await sleep(150);
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: r.x, y: r.y, button: "left", clickCount: 1 });
};
const waitFor = async (expr, ms = 30000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(expr)) return true; await sleep(150); } await shot("zz-timeout"); throw new Error(`timed out: ${expr}\n${problems.join("\n")}\n${await ev(`(document.querySelector("#drive") ?? document.body).innerText.slice(0, 800)`)}`); };
const checks = [];
const check = (name, ok, got) => { checks.push({ name, ok: !!ok, got }); if (!ok) console.error(`FAIL: ${name}: ${JSON.stringify(got)}`); };

const today = isoDate(new Date());
const prof = demoProfile(new Date());
// today 1-6 pm; the days ahead long and capped at 8 doors, so they have time left after their own doors (dayflow-cdp)
prof.windows = [{ date: today, from: "13:00", to: "18:00" }, ...prof.windows.slice(1).map((x) => ({ ...x, from: "11:00", to: "22:00" }))];
prof.maxPerDay = 8;
prof.known = [];
const key = storeKey(prof.brand, prof.city);
const state = { v: STORE_VERSION, brand: prof.brand, city: prof.city, profile: prof, plan: null, statuses: {}, outcomes: {}, savedAt: new Date().toISOString() };
const [y, mo, d] = today.split("-").map(Number);
const pinned = new Date(y, mo - 1, d, 12, 55).getTime();
await send("Runtime.enable"); await send("Page.enable");
await send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
  const real = Date, off = ${pinned} - real.now();
  class D extends real { constructor(...a) { if (a.length) super(...a); else super(real.now() + off); } static now() { return real.now() + off; } }
  window.Date = D;
  try { if (!localStorage.getItem("__seeded")) { localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify(state))}); localStorage.setItem(${JSON.stringify(BRAND_KEY)}, ${JSON.stringify(JSON.stringify({ v: STORE_VERSION, profile: prof, savedAt: new Date().toISOString() }))}); localStorage.setItem("doors:drive-voice", "off"); localStorage.setItem("__seeded", "1"); } } catch {}
  delete window.SpeechRecognition; delete window.webkitSpeechRecognition; window.SpeechRecognition = undefined; window.webkitSpeechRecognition = undefined;
})();` });
await send("Emulation.setDeviceMetricsOverride", { width: +w, height: +h, deviceScaleFactor: 1, mobile: +w < 700 });
await send("Page.navigate", { url: `${base}/app?ors=off#/plan?${new URLSearchParams({ brand: prof.brand, city: prof.city })}` });
await waitFor(`!!document.querySelector("#t-drive")`, 40000);
const free = (sel) => `(() => { const t = document.querySelector(${JSON.stringify(sel)}); if (!t) return false; const b = t.getBoundingClientRect(); return t.contains(document.elementFromPoint(b.left + b.width/2, b.top + b.height/2)); })()`;
await waitFor(free("#t-drive"), 90000);
await click("#t-drive");
await waitFor(`!!document.querySelector("[data-drive-door] .dv-talk")`);
const cur = () => ev(`document.querySelector("[data-drive-door]")?.dataset.id ?? null`);
const stored = () => ev(`JSON.parse(localStorage.getItem(${JSON.stringify(key)}))`);
const dayIds = async (date) => ((await stored()).plan?.days ?? []).find((x) => x?.date === date)?.stops.map((s) => s.id) ?? [];
const aheadOf = async (id) => ((await stored()).plan?.days ?? []).find((x) => x && x.date > today && x.stops.some((s) => s.id === id))?.date ?? null;
const toastText = () => ev(`(() => { const t = document.querySelector(".dv-toast"); return t && !t.hidden ? t.textContent : ""; })()`);
const hideToast = () => ev(`document.querySelector(".dv-toast") && (document.querySelector(".dv-toast").hidden = true)`);
const report = { width: +w, doors: (await dayIds(today)).length };
await shot("door");

// two doors logged
const logged = [];
for (const a of ["interested", "no"]) {
  const c = await cur();
  await click("[data-drive-done]");
  await waitFor(`!!document.querySelector("[data-drive-quick=${a}]")`);
  await sleep(400);
  await ev(`document.querySelector("[data-drive-quick=${a}]").click()`);
  await waitFor(`!!document.querySelector("[data-drive-save]")`);
  await click("[data-drive-save]");
  await waitFor(`document.querySelector("[data-drive-door]")?.dataset.id !== ${JSON.stringify(c)} && !document.querySelector("[data-drive-sheet]")`);
  logged.push(c);
}
await hideToast();

// Running late: +60 min (the label first)
report.lateLabel = await ev(`document.querySelector("[data-drive-latepick]").textContent`);
if (!before) check("the late button says what it does", report.lateLabel === "Running late: shift everything", report.lateLabel);
await click("[data-drive-latepick]");
await waitFor(`!!document.querySelector("[data-drive-lateby='60']")`);
await shot("late-picks");
await click("[data-drive-lateby='60']");
await waitFor(`!!document.querySelector("[data-drive-late]")`);
await sleep(600);
if (before) await waitFor(`!document.querySelector("[data-drive-late-checking]")`, 90000);
report.late = await ev(`document.querySelector("[data-drive-late]").innerText`);
await ev(`document.querySelector("#drive").scrollTo(0, 0)`);
await shot("late-banner");
const outIds = await ev(`import("/lib/drive-day.js").then((D) => import("/ui/state.js").then((S) => { const p = S.getPlan(); const k = p.days.findIndex((d) => d.date === ${JSON.stringify(today)}); return D.lateFor(D.driveQueue(p, k), { date: ${JSON.stringify(today)}, min: 775 }, 60, { visitMin: p.profile?.visitMin ?? 25 })?.out ?? []; }))`);
report.lateOut = outIds;

// the Stop for today sheet
if (before) {
  await click("[data-drive-end]");
  await waitFor(`!!document.querySelector("[data-drive-endok]")`);
  await shot("end-sheet");
  console.log(JSON.stringify({ ...report, problems }, null, 1));
  process.exit(0);
}
check("running late pushes a door past the day's end (the overflow to re-home)", outIds.length > 0, report.late);
check("the late banner offers the same two choices", await ev(`!!document.querySelector("[data-drive-latedays]") && !!document.querySelector("[data-drive-latelist]")`), report.late);
const it = outIds.length === 1 ? "it" : "them";
report.lateLabels = await ev(`[document.querySelector("[data-drive-latedays]")?.textContent, document.querySelector("[data-drive-latelist]")?.textContent]`);
check("the late choices say it for one door, them for more", report.lateLabels[0] === `Move ${it} into the coming days` && report.lateLabels[1] === `Put ${it} back on Your list`, { n: outIds.length, labels: report.lateLabels });
await click("[data-drive-latedays]");
await waitFor(`/Undo/.test(document.querySelector(".dv-toast")?.textContent ?? "") && !document.querySelector(".dv-toast").hidden`, 90000);
report.lateToast = await toastText();
await shot("late-moved");
const lateWhere = Object.fromEntries(await Promise.all(outIds.map(async (x) => [x, await aheadOf(x)])));
report.lateWhere = lateWhere;
check("running late's overflow: off today, each on a day ahead or named on Your list with why", (await dayIds(today)).every((x) => !outIds.includes(x)) && outIds.every((x) => lateWhere[x] || /back on Your list/.test(report.lateToast)), { lateWhere, toast: report.lateToast });
let rec = (await stored()).drive?.[today] ?? {};
check("running late's move is one change on the record", rec.changes?.length === 1 && rec.changes[0].kind === "late" && rec.changes[0].how === "days", rec.changes);
await hideToast();

// Stop for today → Move them into the coming days
await ev(`document.querySelector("#drive").scrollTo(0, 99999)`);
await click("[data-drive-end]");
await waitFor(`!!document.querySelector("[data-drive-endok]")`);
report.sheet = await ev(`document.querySelector("[data-drive-sheet]").innerText`);
await shot("stop-sheet");
const left = (await dayIds(today)).filter((x) => !logged.includes(x));
check("the sheet names the doors left and the two choices", /\d+ doors? left: /.test(report.sheet) && /Move (it|them) into the coming days/.test(report.sheet) && /Put (it|them) back on Your list/.test(report.sheet) && /Keep going/.test(report.sheet), report.sheet);
const aheadBefore = ((await stored()).plan?.days ?? []).filter((x) => x && x.date > today).map((x) => [x.date, x.stops.map((s) => s.id).filter((i) => !left.includes(i))]);
await click("[data-drive-endok]");
await waitFor(`!!document.querySelector("[data-drive-finished]") && /Stopped for today/.test(document.querySelector(".dv-toast")?.textContent ?? "")`, 120000);
report.stopToast = await toastText();
report.debrief = await ev(`document.querySelector("[data-drive-finished]").innerText.slice(0, 600)`);
await shot("stopped-days");
const where = Object.fromEntries(await Promise.all(left.map(async (x) => [x, await aheadOf(x)])));
report.stopWhere = where;
check("Stop → Move: today keeps only its visits", (await dayIds(today)).every((x) => logged.includes(x)), await dayIds(today));
check("Stop → Move: each door left on a day ahead, or named back on Your list with why", left.every((x) => where[x] || /back on Your list/.test(report.stopToast)), { where, toast: report.stopToast });
const aheadAfter = ((await stored()).plan?.days ?? []).filter((x) => x && x.date > today);
const pushed = aheadBefore.flatMap(([dt, ids]) => ids.filter((i) => !aheadAfter.find((x) => x.date === dt)?.stops.some((s) => s.id === i)));
check("Stop → Move: no planned door on a day ahead pushed off", !pushed.length, pushed);
check("the debrief offers Resume my day", await ev(`!!document.querySelector("[data-drive-resumeday]")`), report.debrief);
await hideToast();

// Resume my day: the doors back on today
await click("[data-drive-resumeday]");
await waitFor(`!!document.querySelector("[data-drive-door] .dv-talk") && /Back on today/.test(document.querySelector(".dv-toast")?.textContent ?? "")`, 90000);
report.resumeToast = await toastText();
await shot("resumed");
const back = await dayIds(today);
check("Resume my day: every stopped door back on today, off the days ahead", left.every((x) => back.includes(x)) && (await Promise.all(left.map(aheadOf))).every((x) => !x), { back, left });
rec = (await stored()).drive?.[today] ?? {};
check("Resume my day: the stop is gone from the record, the late move kept", !rec.ended && rec.changes?.length === 1 && rec.changes[0].kind === "late", rec);
await hideToast();

// Stop for today → Put them back on Your list
await ev(`document.querySelector("#drive").scrollTo(0, 99999)`);
await click("[data-drive-end]");
await waitFor(`!!document.querySelector("[data-drive-endlist]")`);
await click("[data-drive-endlist]");
await waitFor(`!!document.querySelector("[data-drive-finished]") && /Stopped for today/.test(document.querySelector(".dv-toast")?.textContent ?? "")`, 90000);
report.listToast = await toastText();
report.listDebrief = await ev(`document.querySelector("[data-db-moved]")?.innerText ?? ""`);
await shot("stopped-list");
const listWhere = Object.fromEntries(await Promise.all(left.map(async (x) => [x, await aheadOf(x)])));
check("Stop → Your list: off today and on no day ahead (held there, even with room); the toast says Back on Your list", (await dayIds(today)).every((x) => logged.includes(x)) && Object.values(listWhere).every((x) => !x) && /Back on Your list/.test(report.listToast), { listWhere, toast: report.listToast });
check("the debrief says Back on Your list", /Back on Your list/.test(report.listDebrief), report.listDebrief);
check("Your list gives each its reason", await ev(`import("/ui/state.js").then((S) => ${JSON.stringify(left)}.every((x) => S.getPlan().reasons?.[x]?.text === "you put it back on Your list"))`), null);

// back on the plan: Resume my day; Changes you made
await hideToast();
await click("[data-drive-close]");
await waitFor(`!document.querySelector("#drive")`);
await sleep(500);
report.planBtn = await ev(`document.querySelector("#t-drive").textContent`);
check("the plan says Resume my day on a day stopped today", report.planBtn === "Resume my day", report.planBtn);
await shot("plan-stopped");
await click('[data-drawer="why"]');
await waitFor(`!!document.querySelector("[data-view=changes]")`, 30000);
await click("[data-view=changes]");
await waitFor(`!!document.querySelector(".w-facts [data-fact^=d-]")`);
report.changes = await ev(`[...document.querySelectorAll(".w-facts [data-fact^=d-]")].map((l) => l.innerText)`);
await shot("changes");
check("Changes you made lists the stop and the late move, newest first", report.changes.length === 2 && /^Stopped /.test(report.changes[0]) && /^Running late on /.test(report.changes[1]) && /put back on Your list/.test(report.changes[0]), report.changes);
check("only the newest has Undo", await ev(`(() => { const xs = [...document.querySelectorAll(".w-facts [data-fact^=d-]")]; return !!xs[0].querySelector("[data-fix]") && !xs[1].querySelector("[data-fix]"); })()`), report.changes);
await click(".w-facts [data-fact^=d-] [data-fix]");
await waitFor(`${JSON.stringify(left)}.every((x) => (JSON.parse(localStorage.getItem(${JSON.stringify(key)})).plan.days.find((d) => d.date === ${JSON.stringify(today)})?.stops ?? []).some((s) => s.id === x))`, 60000);
await sleep(800);
report.changesAfter = await ev(`[...document.querySelectorAll(".w-facts [data-fact^=d-]")].map((l) => l.innerText)`);
await shot("changes-undone-stop");
check("Undo the stop from Changes you made: the doors back on today; the late move now has Undo", report.changesAfter.length === 1 && /^Running late/.test(report.changesAfter[0]) && /Undo/.test(report.changesAfter[0]), report.changesAfter);
await click(".w-facts [data-fact^=d-] [data-fix]");
await waitFor(`${JSON.stringify(outIds)}.every((x) => (JSON.parse(localStorage.getItem(${JSON.stringify(key)})).plan.days.find((d) => d.date === ${JSON.stringify(today)})?.stops ?? []).some((s) => s.id === x))`, 60000);
await sleep(800);
report.changesAfter2 = await ev(`[...document.querySelectorAll(".w-facts [data-fact^=d-]")].map((l) => l.innerText)`);
await shot("changes-undone-late");
check("Undo the late move: its doors back on today, off the days ahead; nothing left to list", !report.changesAfter2.length && (await Promise.all(outIds.map(aheadOf))).every((x) => !x), report.changesAfter2);
report.planBtn2 = await ev(`document.querySelector("#t-drive").textContent`);
check("the day is back on: the plan says Resume my day (the pause's: doors left)", report.planBtn2 === "Resume my day", report.planBtn2);
// "Put them back on Your list" again, then one added back from Your list (Add to the best day): only that one goes on a
// day; the rest stay off (the Why drawer closed first: on a phone it covers the toolbar)
await ev(`document.querySelector('[data-drawer="why"][aria-expanded="true"]')?.click()`);
await waitFor(free("#t-drive"), 30000);
await click("#t-drive");
await waitFor(`!!document.querySelector("[data-drive-door] .dv-talk")`);
await ev(`document.querySelector("#drive").scrollTo(0, 99999)`);
await click("[data-drive-end]");
await waitFor(`!!document.querySelector("[data-drive-endlist]")`);
await click("[data-drive-endlist]");
await waitFor(`!!document.querySelector("[data-drive-finished]")`, 90000);
await hideToast();
await click("[data-drive-close]");
await waitFor(`!document.querySelector("#drive")`);
await ev(`[...document.querySelectorAll(".daytabs button, .daytabs [role=tab]")].find((b) => /^Your list/.test(b.textContent.trim()))?.click()`);
await sleep(800);
await shot("your-list-held");
report.yourList = await ev(`document.querySelector("#p-body")?.innerText.slice(0, 900)`);
check("Your list shows them with 'you put it back on Your list'", /you put it back on Your list/i.test(report.yourList ?? ""), report.yourList);
const one = left[0];
await ev(`import("/ui/state.js").then((S) => S.addDoor(S.getPlan().venues[${JSON.stringify(one)}], { date: null }))`);
await waitFor(`(JSON.parse(localStorage.getItem(${JSON.stringify(key)})).plan.days ?? []).some((d) => d.date > ${JSON.stringify(today)} && d.stops.some((s) => s.id === ${JSON.stringify(one)}))`, 90000);
await sleep(800);
await shot("added-back");
const st2 = await stored();
report.addBack = { one, parked: st2.parked, where: Object.fromEntries(await Promise.all(left.map(async (x) => [x, await aheadOf(x)]))) };
check("added back: that door is on a day and no longer held; the rest stay off every day", !(st2.parked ?? []).includes(one) && report.addBack.where[one] && left.filter((x) => x !== one).every((x) => !report.addBack.where[x] && (st2.parked ?? []).includes(x)), report.addBack);
check("no page errors", !problems.length, problems);
report.checks = checks;
console.log(JSON.stringify(report, null, 1));
process.exit(checks.every((c) => c.ok) ? 0 : 1);
