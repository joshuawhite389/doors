// Prove drive mode's day flow in a real browser over CDP. A saved Tidewell
// plan whose first window is today (the page's clock pinned to 12:55 pm), drive mode, then: log five doors with the five
// logging answers (Interested · Follow up · Talked to someone else · Not interested · Just visited), add a note to one, Skip
// for now (the button then says Skip again), Remove from today (off the day for good), Pause → the plan says Resume my
// day, and still does after a reload → Resume → the same door, "Welcome back" → End my day → the debrief: every door
// of the day counted once in the logging words (no "passed on"), a door opens to its notes, a suggested follow-up
// booked in one tap. dayflow2 (mobile2 10-23): the door removed Off today is listed apart (Removed from today), not
// counted; End my day's doors go at the end of the next plan day, in the time it has left, never pushing its doors off
// ("Moved to …", Choose another day moves them);
// an ended day has no Day tab; a toast stays within a third of the window (run it at 700x450 for 1400x900 at 200%).
// Screenshots every step; prints a JSON report, exit 1 on a failed check.
// Usage: node scripts/dayflow-cdp.mjs <base-url> <out-dir> [width] [height] [browser]
import { spawn } from "node:child_process";
import fs from "node:fs";
import { demoProfile } from "../public/lib/demo-profile.js";
import { storeKey, STORE_VERSION, BRAND_KEY } from "../public/lib/store.js";
import { isoDate } from "../public/lib/profile.js";

const [base, out, w = "1400", h = "900", browser = "chromium"] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const port = 9400 + Math.floor(Math.random() * 400);
const dir = `/tmp/claude-1000/dayflow-${port}`;
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
const shot = async (name) => { const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }); fs.writeFileSync(`${out}/${w}-${String(++step).padStart(2, "0")}-${name}.png`, Buffer.from(data, "base64")); };
const click = async (sel) => {
  const r = await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({block:"center"}); const b = e.getBoundingClientRect(); return {x: b.left + b.width/2, y: b.top + b.height/2}; })()`);
  if (!r) throw new Error(`no ${sel}\n${await ev(`document.querySelector("#drive")?.innerText.slice(0, 800)`)}`);
  await sleep(150);
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: r.x, y: r.y, button: "left", clickCount: 1 });
};
const waitFor = async (expr, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(expr)) return true; await sleep(150); } await shot("zz-timeout"); throw new Error(`timed out: ${expr}\n${problems.join("\n")}\n${await ev(`(document.querySelector("#drive") ?? document.body).innerText.slice(0, 800)`)}`); };
const checks = [];
const check = (name, ok, got) => { checks.push({ name, ok: !!ok, got }); if (!ok) console.error(`FAIL: ${name}: ${JSON.stringify(got)}`); };

const today = isoDate(new Date());
const prof = demoProfile(new Date());
// the days ahead long and capped at 8 doors, so they have time left after their own doors: what End my day's doors
// may fill (the roll never pushes a planned door off). Most bars here open at 3-4 pm, so 8 doors run
// to ~7:30 pm: the window runs to 10 pm to leave that time on every travel source (dayflow3 10-23: to 8 pm it passed
// only on a worktree with cached road times; on the estimate the days ahead were full and the doors went on no day)
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
  delete window.SpeechRecognition; delete window.webkitSpeechRecognition; window.SpeechRecognition = undefined; window.webkitSpeechRecognition = undefined; // typed + tapped answers
})();` });
await send("Emulation.setDeviceMetricsOverride", { width: +w, height: +h, deviceScaleFactor: 1, mobile: +w < 700 });
// ?ors=off: the planner's travel times are the estimate, the same on every server (a fresh one has no road times cached)
const url = `${base}/app?ors=off#/plan?${new URLSearchParams({ brand: prof.brand, city: prof.city })}`;
await send("Page.navigate", { url });
await waitFor(`!!document.querySelector("#t-drive")`, 40000);
await sleep(800);
check("the plan says Start my day before the day starts", (await ev(`document.querySelector("#t-drive").textContent`)) === "Start my day", await ev(`document.querySelector("#t-drive").textContent`));
const free = (sel) => `(() => { const t = document.querySelector(${JSON.stringify(sel)}); if (!t) return false; const b = t.getBoundingClientRect(); return t.contains(document.elementFromPoint(b.left + b.width/2, b.top + b.height/2)); })()`;
await waitFor(free("#t-drive"), 30000); // the plan's build animation (its Skip ▸) is over
await click("#t-drive");
await waitFor(`!!document.querySelector("[data-drive-door] .dv-talk")`, 30000);
const cur = () => ev(`document.querySelector("[data-drive-door]")?.dataset.id ?? null`);
const stored = () => ev(`JSON.parse(localStorage.getItem(${JSON.stringify(key)}))`);
const todayIds = async () => ((await stored()).plan?.days ?? []).find((x) => x?.date === today)?.stops.map((s) => s.id) ?? [];
const report = { width: +w };
report.doors = (await todayIds()).length;
check("a full day to drive", report.doors >= 8, report.doors);
check("Pause is the top-left button", /Pause/.test(await ev(`document.querySelector("[data-drive-close]").textContent`)), await ev(`document.querySelector("[data-drive-close]").textContent`));
await shot("door");

// 1. five doors, one per logging answer
const answers = ["interested", "followup", "someone", "no", "visited"];
const logged = [];
for (const a of answers) {
  const c = await cur();
  await click("[data-drive-done]");
  await waitFor(`!!document.querySelector("[data-drive-quick=${a}]")`);
  if (a === "someone") await shot("sheet");
  await sleep(400); // the mic's failure line lands first (no microphone here)
  await ev(`document.querySelector("[data-drive-quick=${a}]").click()`);
  await waitFor(`!!document.querySelector("[data-drive-save]")`);
  await click("[data-drive-save]");
  await waitFor(`document.querySelector("[data-drive-door]")?.dataset.id !== ${JSON.stringify(c)} && !document.querySelector("[data-drive-sheet]")`);
  logged.push(c);
}
// a note on the "visited" one with a weekday in it, through the app's own setSlot (what the stop's Notes do): the debrief suggests from it
await ev(`Promise.all([import("/ui/state.js"), import("/lib/door-notes.js")]).then(([S, N]) => S.setSlot(${JSON.stringify(logged[4])}, N.makeNote({ text: "manager back Thursdays", by: "rep", at: ${JSON.stringify(today + "T13:30:00")} })))`);

// 2. Skip for now, then the button says Skip again when it comes round
const skipped = await cur();
await click("[data-drive-skip]");
await waitFor(`document.querySelector("[data-drive-door]")?.dataset.id !== ${JSON.stringify(skipped)}`);
check("Skip keeps every door on today", (await todayIds()).length === report.doors && (await todayIds()).at(-1) === skipped, await todayIds());

// 3. Remove from today: off the day for good
const removed = await cur();
await click("[data-drive-remove]");
await waitFor(`!!document.querySelector("[data-drive-rm=later]")`);
await shot("remove-sheet");
await click("[data-drive-rm=later]");
await waitFor(`document.querySelector("[data-drive-door]")?.dataset.id !== ${JSON.stringify(removed)} && !document.querySelector("[data-drive-sheet]")`);
check("Remove from today: the door is off today", !(await todayIds()).includes(removed), await todayIds());
check("Remove from today: the toast says where it is", /is off today\. (On .*, stop \d+|Not on a day)\./.test(await ev(`document.querySelector(".dv-toast")?.textContent ?? ""`)), await ev(`document.querySelector(".dv-toast")?.textContent`));
await shot("removed");

// 4. Pause → the plan says Resume my day; a reload keeps it; Resume → the same door
const before = await cur();
await click("[data-drive-close]");
await waitFor(`!document.querySelector("#drive")`);
await sleep(500);
const btn = await ev(`document.querySelector("#t-drive").textContent`);
check("Pause: the plan says Resume my day", btn === "Resume my day", btn);
check("Pause: the button says where you left off", /done · next: /.test(await ev(`document.querySelector("#t-drive").title`)), await ev(`document.querySelector("#t-drive").title`));
await shot("plan-paused");
await send("Page.reload");
await waitFor(`document.querySelector("#t-drive")?.textContent === "Resume my day"`, 40000);
check("Pause survives a reload", true, null);
await click("#t-drive");
await waitFor(`!!document.querySelector("[data-drive-door] .dv-talk")`, 30000);
check("Resume: the same door", (await cur()) === before, { before, now: await cur() });
await waitFor(`/Welcome back\\. Picking up at stop \\d+ of \\d+/.test(document.querySelector(".dv-toast")?.textContent ?? "")`);
const toastH = await ev(`(() => { const t = document.querySelector(".dv-toast"); return { h: t.getBoundingClientRect().height, win: innerHeight, fits: t.querySelector("span").scrollHeight <= t.querySelector("span").clientHeight + 1 }; })()`);
check("the toast stays within a third of the window", toastH.h <= toastH.win / 3 + 1, toastH);
// a toast never covers a control (webvoice 10-23: at desktop width Welcome back sat over Log visit and ate a tap):
// off the door's buttons, and a tap where it is goes through to what's under it
const cover = await ev(`(() => { const t = document.querySelector(".dv-toast").getBoundingClientRect(); const a = document.querySelector(".dv-door .dv-acts")?.getBoundingClientRect(); const s = document.querySelector(".dv-toast span").getBoundingClientRect(); const hit = document.elementFromPoint(s.left + s.width / 2, s.top + s.height / 2); return { t: [t.top, t.bottom], a: a && [a.top, a.bottom], bottom: document.querySelector(".dv-toast").style.bottom, overActs: !!a && a.top < t.bottom && a.bottom > t.top && a.top < innerHeight && a.bottom > 0, through: !document.querySelector(".dv-toast").contains(hit) }; })()`);
check("the toast is off the door's buttons, and taps go through its words", !cover.overActs && cover.through, cover);
await shot("resumed");

// 5. End my day: the rest come off; the debrief (the Welcome back toast gone first: on a short window it sits over the row)
await waitFor(`document.querySelector(".dv-toast")?.hidden !== false`, 8000);
await click("[data-drive-end]");
await waitFor(`!!document.querySelector("[data-drive-endok]")`);
await shot("end-sheet");
const leftIds = (await todayIds()).filter((x) => !logged.includes(x));
// Stop for today (GROUP3 item 9): the doors left on the first line, what Move them into the coming days does under it
const sheetText = await ev(`document.querySelector("[data-drive-sheet] .dv-sheet-in")?.innerText ?? ""`);
const sheetHead = await ev(`document.querySelector("[data-drive-left]")?.textContent ?? ""`);
const aheadBefore = ((await stored()).plan?.days ?? []).filter((x) => x && x.date > today && !x.past).map((x) => [x.date, x.stops.map((s) => s.id)]);
await click("[data-drive-endok]");
await waitFor(`!!document.querySelector("[data-drive-finished]")`);
await sleep(300);
const deb = await ev(`(() => { const m = document.querySelector("[data-drive-finished]"); return { text: m.innerText, counts: [...m.querySelectorAll(".db-counts li")].map((l) => l.textContent.trim()), rows: [...m.querySelectorAll("[data-db-doors] [data-db-row]")].map((r) => r.dataset.id), removed: [...m.querySelectorAll("[data-db-removed] [data-db-row]")].map((r) => r.dataset.id), moved: m.querySelector("[data-db-moved]")?.innerText ?? null, books: [...m.querySelectorAll("[data-db-book]")].map((b) => b.dataset.dbBook) }; })()`);
// Doors Agent ability 9 (POLISH=1, a live Anthropic call through the dev server): the Day done polish on a tap
if (process.env.POLISH === "1") {
  check("Day done offers the polish button", !!(await ev(`!!document.querySelector("[data-db-polish]")`)), null);
  await click("[data-db-polish]");
  await waitFor(`!!document.querySelector("[data-db-polished], [data-db-polish-failed]")`, 40000);
  const pol = await ev(`document.querySelector("[data-db-polished], [data-db-polish-failed]").innerText`);
  check("the polish shows Doors Agent's notes", await ev(`!!document.querySelector("[data-db-polished]")`), pol);
  report.polish = pol;
  await ev(`document.querySelector("[data-db-polished]")?.scrollIntoView({ block: "start" })`);
  await sleep(200);
  await shot("polished");
  await ev(`window.scrollTo(0, 0); document.querySelector("#drive").scrollTo(0, 0)`);
}
report.debrief = deb;
const sum = deb.counts.reduce((n, c) => n + Number(c.split(" ")[0]), 0);
check("the debrief counts every door of the day once (the removed one apart)", sum === report.doors - 1 && deb.rows.length === report.doors - 1, { sum, rows: deb.rows.length, doors: report.doors });
check("Removed from today: listed apart, not counted", deb.removed.length === 1 && deb.removed[0] === removed && !deb.rows.includes(removed) && /Removed from today \(1\)/i.test(deb.text), { removed: deb.removed, want: removed });
// End my day: the doors left go first on the next plan day, in rank order
const nextDay = async () => ((await stored()).plan?.days ?? []).filter((x) => x && x.date > today && !x.past)[0] ?? null;
const nd = await nextDay();
const ranks = await ev(`import("/ui/state.js").then((S) => Object.fromEntries(${JSON.stringify(leftIds)}.map((id) => [id, S.getPlan().pool.ids.indexOf(id) + 1])))`);
const rolled = (nd?.stops ?? []).map((x) => x.id).filter((x) => leftIds.includes(x));
report.rolledHours = await ev(`import("/ui/state.js").then((S) => { const p = S.getPlan(); const d = p.days.find((x) => x.date === ${JSON.stringify(nd?.date)}); return ${JSON.stringify(leftIds)}.map((id) => ({ name: p.venues[id]?.name, hours: p.venues[id]?.hours, eta: d?.stops.find((s) => s.id === id)?.eta ?? null, from: d?.from, to: d?.to })); })`);
report.rolled = { to: nd?.date, rolled, left: leftIds, first: nd?.stops.slice(0, rolled.length).map((x) => x.id), stops: nd?.stops.map((x) => [x.id.slice(0, 4), x.locked ? (x.lockDay ? "day" : "place") : "", x.openAtArrival]) };
const later = ((await stored()).plan?.days ?? []).filter((x) => x && x.date > today && !x.past);
report.rolled.where = Object.fromEntries(leftIds.map((id) => [id.slice(0, 4), later.find((x) => x.stops.some((s) => s.id === id))?.date ?? null]));
// a door with no later day: only one shut through every later day's hours (it can't be visited open on any)
report.rolled.shutAll = await ev(`import("/lib/fu-check.js").then((F) => import("/ui/state.js").then((S) => { const p = S.getPlan(); return Object.fromEntries(${JSON.stringify(leftIds)}.map((id) => [id.slice(0, 4), p.days.filter((d) => !d.past && d.date > ${JSON.stringify(today)}).every((d) => !!F.shutOn(p.venues[id], { date: d.date, from: d.from, to: d.to, visitMin: p.profile?.visitMin ?? 25 }))])); }))`);
check("End my day: the doors left go to the next plan day (one that can't be visited open there, to a day after)", rolled.length >= 1 && Object.entries(report.rolled.where).every(([k, v]) => v || report.rolled.shutAll[k]), report.rolled);
// at the end of the day, after its own doors, in rank order (the roll never pushes a planned door off)
const tail = (nd?.stops ?? []).slice(-rolled.length).map((x) => x.id);
check("…at the end of the day, after its own doors, in rank order", JSON.stringify(tail) === JSON.stringify([...rolled].sort((a, b) => ranks[a] - ranks[b])), { tail, ...report.rolled, ranks });
check("…and none of them reached before it opens", later.flatMap((x) => x.stops).filter((x) => leftIds.includes(x.id)).every((x) => x.openAtArrival !== false), report.rolled.stops);
check("the debrief says where: Moved to <day>, with Resume my day (the Undo) and Choose another day", /^Moved to (\w{3} \w{3} \d+|the days ahead)/.test(deb.moved ?? "") && (await ev(`!!document.querySelector("[data-drive-resumeday]") && !!document.querySelector("[data-db-choose]")`)), deb.moved);
// the sheet promised only what happened (mobile2 10-23): a door on no day is named in the sheet as going on Your list,
// and on the Day done card with why
const nameOf = await ev(`import("/ui/state.js").then((S) => Object.fromEntries(${JSON.stringify(leftIds)}.map((id) => [id, S.getPlan().venues[id]?.name])))`);
const stuckIds = leftIds.filter((id) => !report.rolled.where[id.slice(0, 4)]);
report.sheet = sheetText;
const moveText = sheetText.split(/Move them into the coming days\n+/)[1]?.split(/\n+Put them back on Your list/)[0] ?? "";
check("End sheet: no door promised a day it doesn't get; one on no day is named with why, on the sheet and the card", stuckIds.every((id) => new RegExp(`: [^.]*${nameOf[id].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^.]* back on Your list`).test(moveText) && (deb.moved ?? "").includes(`${nameOf[id]} (`)) && leftIds.filter((id) => !stuckIds.includes(id)).every((id) => !new RegExp(`${nameOf[id].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^.]* back on Your list`).test(moveText)), { sheet: moveText, moved: deb.moved, stuck: stuckIds.map((id) => nameOf[id]) });
// …and a door that went on a day was promised that day: "X goes at the end of Wed Oct 28" (mobile2 10-23: not exercised
// while the days ahead had no room)
const nice = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }).replace(",", "");
const promised = leftIds.filter((id) => report.rolled.where[id.slice(0, 4)]).map((id) => [nameOf[id], nice(report.rolled.where[id.slice(0, 4)])]);
// "Doors puts them at the end of Wed Oct 28." (all of them), "Doors puts A and B at the end of Wed Oct 28.", or "…at the
// end of the coming days: A on Wed Oct 28, B on Thu Oct 29."
const promisedOk = ([n, dt]) => new RegExp(`at the end of ${dt}\\b`).test(moveText) && (!stuckIds.length && /Doors puts (them|it) at the end of/.test(moveText) || moveText.split(/(?<=\.) /)[0].includes(n)) || moveText.includes(`${n} on ${dt}`);
check("End sheet: each door that went on a day was promised the end of that day", promised.length >= 1 && promised.every(promisedOk), { sheet: moveText, promised });
check("End sheet: the doors left named once each on its first line", leftIds.every((id) => sheetHead.split(nameOf[id]).length === 2), sheetHead);
// no door vanishes: one the rolled doors pushed off its day is named on the card with where it is now (mobile2: Wed 9 → 8)
const aheadAfter = ((await stored()).plan?.days ?? []).filter((x) => x && x.date > today && !x.past);
const pushed = aheadBefore.flatMap(([dt, ids]) => ids.filter((id) => !leftIds.includes(id) && !aheadAfter.find((x) => x.date === dt)?.stops.some((s) => s.id === id)));
const pushedNames = await ev(`import("/ui/state.js").then((S) => ${JSON.stringify(pushed)}.map((id) => S.getPlan().venues[id]?.name))`);
report.pushed = pushedNames;
check("no planned door on a day ahead is pushed off it", !pushed.length, { pushed: pushedNames, moved: deb.moved });
check("an ended day has no Day tab (it read 'Day (2)')", !(await ev(`!!document.querySelector("[data-drive-screen]")`)), await ev(`document.querySelector(".dv-tabs")?.textContent`));
check("in the logging words, no 'passed on'", !/passed on/i.test(deb.text) && ["Interested", "Follow up", "Talked to someone else", "Not interested", "Just visited", "Not visited"].every((l) => deb.counts.some((c) => c.endsWith(l))), deb.counts);
check("End my day: today keeps only its visits", (await todayIds()).every((x) => logged.includes(x)), await todayIds());
await shot("debrief");
await ev(`window.scrollTo(0, document.body.scrollHeight); document.querySelector("#drive").scrollTo(0, 99999)`);
await sleep(200);
await shot("debrief-bottom");
// Choose another day: they move to the day picked (or, with no time left there, a day after), pushing none off
const beforeChoose = ((await stored()).plan?.days ?? []).filter((x) => x && x.date > today && !x.past).map((x) => [x.date, x.stops.map((s) => s.id).filter((id) => !leftIds.includes(id))]);
await click("[data-db-choose]");
await waitFor(`!!document.querySelector("[data-db-roll]")`);
await shot("debrief-choose");
const to = await ev(`document.querySelector("[data-db-roll]").dataset.dbRoll`);
await ev(`document.querySelector(".dv-toast").hidden = true`); // an older toast's words stay in it while hidden
await click("[data-db-roll]");
await waitFor(`(() => { const t = document.querySelector(".dv-toast"); return !t.hidden && /Moved to|couldn't move|Not on a day/.test(t.textContent); })()`, 90000);
const afterChoose = ((await stored()).plan?.days ?? []).filter((x) => x && x.date > today && !x.past);
const pushed2 = beforeChoose.flatMap(([dt, ids]) => ids.filter((id) => !afterChoose.find((x) => x.date === dt)?.stops.some((s) => s.id === id)));
report.chooseDay = (() => { const x = afterChoose.find((y) => y.date === to); return x && { n: x.stops.length, lastDepart: x.stops.at(-1)?.depart, to: x.to }; })();
const onTo = (afterChoose.find((x) => x.date === to)?.stops ?? []).map((x) => x.id).filter((id) => rolled.includes(id));
check("Choose another day: they move to it (none pushed off)", !pushed2.length && (onTo.length > 0 || /couldn't move|Not on a day/.test(await ev(`document.querySelector(".dv-toast").textContent`))), { to, onTo, pushed2, moved: await ev(`document.querySelector("[data-db-moved]")?.innerText`) });
await shot("debrief-moved");
// a door opens to its notes
await click(`[data-db-row][data-id="${logged[4]}"] summary`);
await waitFor(`document.querySelector('[data-db-row][data-id="${logged[4]}"]').open`);
check("a door opens to its notes", /manager back Thursdays/.test(await ev(`document.querySelector('[data-db-row][data-id="${logged[4]}"]').innerText`)), await ev(`document.querySelector('[data-db-row][data-id="${logged[4]}"]').innerText`));
await shot("debrief-note");
// a suggested follow-up, booked in one tap
check("the note's weekday is a suggested follow-up", deb.books.includes(logged[4]), deb.books);
const day = await ev(`document.querySelector('[data-db-book="${logged[4]}"]').dataset.date`);
await click(`[data-db-book="${logged[4]}"]`);
await waitFor(`(JSON.parse(localStorage.getItem(${JSON.stringify(key)})).outcomes[${JSON.stringify(logged[4])}] || {}).followUp === ${JSON.stringify(day)}`);
check("Book: the follow-up is saved on that day", true, day);
await sleep(400);
await shot("booked");
check("no page errors", !problems.length, problems);
report.checks = checks;
console.log(JSON.stringify(report, null, 1));
process.exit(checks.every((c) => c.ok) ? 0 : 1);
