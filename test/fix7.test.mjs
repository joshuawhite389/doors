// Fix 7 (2026-10-23, from the phone job): (3) the web outcome sheet strips a clash's offer question up to its "?", so
// an offered time with minutes ("4:40 pm instead?") goes too; (4) a follow-up the planner moved off a day that isn't a
// plan day (Sat Oct 24 → Tue Oct 27) says so on the stop, instead of a bare "follow-up visit" on Tuesday.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { route, ROOT } from "./helpers.mjs";
import { fitFollowUp, clashStem, fitDriveResult, fitReply, keptText } from "../public/lib/fu-check.js";
import { returnVisitLabel, followUpPlace } from "../public/lib/outcome.js";
import { buildPool, windowsFor } from "../public/lib/pool.js";
import { planDays } from "../public/lib/schedule.js";
import { stopModel } from "../public/lib/stopmodel.js";

const chi = route("lacroix-chicago");
const CLOSET = "00000000-0000-4000-8000-7343BA1F1580"; // opens 4 pm Tuesdays
const WRIG = "00000000-0000-4000-8000-8F642B1894ED";
const TUE = "2026-10-27";
const W = [{ date: "2026-10-23" }, { date: TUE }];
const clash = (mine, theirs) => fitFollowUp({ result: "interested", followUp: TUE, followUpTime: mine }, chi.venues[CLOSET], { windows: W, others: [{ id: WRIG, name: "Wrigleyville North", followUp: TUE, followUpTime: theirs }] });

test("(3) a clash's offer is stripped up to its '?', with or without minutes in the offered time", () => {
  const mins = clash("16:00", "16:00");
  assert.equal(mins.text, "Wrigleyville North's follow-up is at 4 pm Tuesday too: 4:40 pm instead?");
  assert.equal(clashStem(mins.text), "Wrigleyville North's follow-up is at 4 pm Tuesday too.");
  assert.equal(mins.text.replace(/: [^:]*$/, "."), mins.text, "the old strip left the question in (the repro)");
  const hour = clash("16:00", "16:20");
  assert.equal(hour.text, "Wrigleyville North's follow-up is at 4:20 pm Tuesday too: 5 pm instead?");
  assert.equal(clashStem(hour.text), "Wrigleyville North's follow-up is at 4:20 pm Tuesday too.");
  assert.equal(clashStem("X's follow-up is at 4 pm Tuesday too: pick another time?"), "X's follow-up is at 4 pm Tuesday too.");
  const ui = readFileSync(join(ROOT, "public/ui/outcome.js"), "utf8");
  assert.ok(ui.includes("clashStem(fit.text)") && !ui.includes("/: [^:]*$/"), "the web sheet uses it");
});

test("(4) a follow-up moved off a day that isn't a plan day names the day she said", () => {
  const r = route("liquid-death-boise");
  const BB = "00000000-0000-4000-8000-D7F7C61CEE04"; // Boise Brewing
  const profile = { drinks: [{ key: "liquid-death", name: "Liquid Death", ready: true }], rooms: ["bars", "breweries", "restaurants"], start: { lat: 43.615, lon: -116.2 }, windows: [{ date: "2026-10-23", from: "14:00", to: "18:00" }, { date: TUE, from: "13:00", to: "19:00" }, { date: "2026-10-28", from: "13:00", to: "19:00" }], visitMin: 25 };
  const plan = (o) => {
    const pool = buildPool({ routes: [r], profile, statuses: { [BB]: "visited" }, outcomes: { [BB]: o } });
    return { ...planDays({ pool: pool.rows, statuses: pool.statuses, windows: windowsFor(profile), visitMin: 25, pinned: pool.pinned }), venues: pool.venues, statuses: pool.statuses, outcomes: { [BB]: o }, profile, windows: profile.windows };
  };
  const sat = { result: "interested", followUp: "2026-10-24" };
  assert.equal(fitFollowUp(sat, r.venues[BB], { windows: profile.windows }).code, "offplan");
  const p = plan(sat);
  const d = p.days.find((x) => x.stops.some((s) => s.id === BB));
  assert.equal(d.date, TUE, "the planner moves it to the next plan day");
  const stop = d.stops.find((s) => s.id === BB);
  assert.equal(returnVisitLabel(stop, d, sat), "follow-up visit, moved from Sat Oct 24");
  // on its own date: plain; not the return (before the date, or no follow-up): nothing
  const tue = { result: "interested", followUp: TUE };
  const p2 = plan(tue);
  const d2 = p2.days.find((x) => x.date === TUE);
  assert.equal(returnVisitLabel(d2.stops.find((s) => s.id === BB), d2, tue), "follow-up visit");
  assert.equal(returnVisitLabel({ ...stop }, { date: "2026-10-23" }, sat), "");
  assert.equal(returnVisitLabel({ id: BB }, d, sat), "", "not pinned as a follow-up");
  // the stop's model carries the label (the web stop kicker and the phone's Stop.tsx read it)
  const m = stopModel({ plan: p, id: BB, dayIndex: p.days.indexOf(d) });
  assert.equal(m.returnLabel, "follow-up visit, moved from Sat Oct 24");
  const ui = readFileSync(join(ROOT, "public/ui/stop.js"), "utf8") + readFileSync(join(ROOT, "public/ui/drive.js"), "utf8");
  assert.ok(!ui.includes('" · follow-up visit"'), "no bare label left on the web");
});

// (2026-10-23): the off-plan message said "add it to your days to route the visit", yet the planner routes it to
// the next plan day anyway. It says what happens: the real next plan day, or that none comes after it.
test("(5) an off-plan follow-up says where Doors puts the visit: the next plan day, in the sheet, drive and chat", () => {
  const r = route("liquid-death-boise");
  const BB = "00000000-0000-4000-8000-D7F7C61CEE04";
  const windows = [{ date: "2026-10-23", from: "14:00", to: "18:00" }, { date: TUE, from: "13:00", to: "19:00" }, { date: "2026-10-28", from: "13:00", to: "19:00" }];
  const sat = { result: "interested", followUp: "2026-10-24" };
  const SAID = "Sat Oct 24 isn't one of your plan days, so Doors puts the visit on Tue Oct 27, your next plan day. Add Sat Oct 24 to your days to go then.";
  const f = fitFollowUp(sat, r.venues[BB], { windows });
  assert.equal(f.code, "offplan");
  assert.equal(f.text, SAID);
  // the planner agrees (the day it names is the day the visit lands)
  const profile = { drinks: [{ key: "liquid-death", name: "Liquid Death", ready: true }], rooms: ["bars", "breweries", "restaurants"], start: { lat: 43.615, lon: -116.2 }, windows, visitMin: 25 };
  const pool = buildPool({ routes: [r], profile, statuses: { [BB]: "visited" }, outcomes: { [BB]: sat } });
  const p = planDays({ pool: pool.rows, statuses: pool.statuses, windows: windowsFor(profile), visitMin: 25, pinned: pool.pinned });
  assert.equal(followUpPlace(p, BB, sat.followUp).day?.date, TUE);
  // drive mode and the chat say the same
  const d = fitDriveResult({ ok: true, visit: { status: "visited", outcome: sat }, say: "x" }, r.venues[BB], { windows, next: "Lost Grove" });
  assert.ok(d.r.say.endsWith(`${SAID} Next: Lost Grove.`), d.r.say);
  const c = fitReply({ reply: "Logged Boise Brewing: x.", actions: [{ type: "outcome", id: BB, outcome: sat }] }, r.venues, { windows });
  assert.ok(c.reply.endsWith(SAID), c.reply);
  const ui = readFileSync(join(ROOT, "public/ui/outcome.js"), "utf8") + readFileSync(join(ROOT, "public/lib/fu-check.js"), "utf8");
  assert.ok(!ui.includes("to route the visit"), "the old wording is gone");
});

test("(5) with no plan day after it, the visit isn't on the plan, and the message says so", () => {
  const TOONS = Object.keys(chi.venues).find((id) => /^Toons/.test(chi.venues[id].name));
  const o = { result: "followup", followUp: "2026-10-30" };
  assert.equal(fitFollowUp(o, chi.venues[TOONS], { windows: W }).text, "Fri Oct 30 isn't one of your plan days, and none comes after it, so the visit isn't on your plan. Add Fri Oct 30 to your days to go then.");
  // a closed day whose next open day isn't a plan day: the offer says the same of that day
  const EASY = "00000000-0000-4000-8000-A969808BC78F";
  const e = fitFollowUp({ result: "interested", followUp: TUE, followUpTime: "15:00" }, chi.venues[EASY], { windows: W });
  assert.equal(e.text, "Easy Does It is closed Tuesdays (Qloo's hours). Thu Oct 29, 5 pm instead? It isn't one of your plan days, and none comes after it, so the visit isn't on your plan. Add Thu Oct 29 to your days to go then.");
  const e2 = fitFollowUp({ result: "interested", followUp: TUE, followUpTime: "15:00" }, chi.venues[EASY], { windows: [...W, { date: "2026-11-03" }] });
  assert.match(e2.text, /instead\? It isn't one of your plan days, so Doors puts the visit on Tue Nov 3, your next plan day\. Add Thu Oct 29 to your days to go then\.$/);
  // drive's toast after "save as said" keeps the facts, drops the whole offer (both sentences)
  assert.equal(keptText(`Logged Easy Does It: x. ${e.text}`), "Logged Easy Does It: x. Easy Does It is closed Tuesdays (Qloo's hours).");
  assert.equal(keptText("Logged X: y. Bernie's is closed Tuesdays (Qloo's hours). Fri Oct 30, 3 pm instead?"), "Logged X: y. Bernie's is closed Tuesdays (Qloo's hours).");
});
