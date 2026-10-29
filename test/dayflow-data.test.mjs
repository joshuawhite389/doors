// The day flow through the real planner (the Austin fixture: Qloo-derived, so private only: scripts/test.mjs
// NEEDS_DATA): Remove from today and End my day take doors off the day being worked for good.
import { test } from "node:test";
import assert from "node:assert/strict";
import { dropFromDay, whereNow } from "../public/lib/day-debrief.js";
import { parseHours } from "../public/lib/core.js";
import { planDays, estimateTravel } from "../public/lib/schedule.js";
import { readJson } from "./helpers.mjs";

const AUS = readJson("test/fixtures/athletic-brewing-austin.json");
const H = (h, m = 0) => h * 60 + m;
const START = { lat: 30.2556, lon: -97.7208 };
const WED = { date: "2026-10-14", day: "wednesday", from: H(11), to: H(18), start: START };
const THU = { date: "2026-10-15", day: "thursday", from: H(11), to: H(15), start: START };
const pool = AUS.pool.slice(0, AUS.ranked).map((r) => ({ ...r, parsedHours: parseHours(r.hours) }));
const now = { date: WED.date, min: H(11, 52) };
const base = (o) => ({ pool, statuses: {}, windows: [WED, THU], visitMin: 25, travel: estimateTravel, pinned: [], now, ...o });

test("Remove from today: off the day being worked for good, the other doors kept in order (Skip only re-adds it)", () => {
  const p1 = planDays(base({ previous: planDays(base({})) }));
  const d = p1.days[0];
  const order = d.stops.map((s) => s.id);
  const id = order[0];
  const saved = dropFromDay(p1, d, [id]);
  const keep = order.slice(1);
  assert.deepEqual(saved.days[0].stops.map((s) => s.id), keep);
  const next = planDays(base({ previous: saved, frozen: { date: WED.date, from: d.from, ids: keep } }));
  assert.deepEqual(next.days[0].stops.map((s) => s.id), keep, "today: every other door, same order, and not the removed one");
  // it's a free door again: the planner may put it on a day ahead (or Not scheduled), never back on today
  const w = whereNow({ ...next, statuses: {} }, id, WED.date);
  assert.match(w.text, /^(On Thu Oct 15, stop \d+|Not on a day)$/);
  // End my day: every door left comes off, the day keeps only its visits
  const rest = dropFromDay(p1, d, order.slice(2));
  const ended = planDays(base({ previous: rest, statuses: { [order[0]]: "visited", [order[1]]: "visited" }, frozen: { date: WED.date, from: d.from, ids: order.slice(0, 2) } }));
  assert.deepEqual(ended.days[0].stops.map((s) => s.id), order.slice(0, 2));
  assert.equal(dropFromDay(p1, { date: "2030-01-01" }, [id]), null);
  assert.equal(dropFromDay(p1, d, ["nope"]), null);
  assert.deepEqual(p1.days[0].stops.map((s) => s.id), order, "the input is not changed");
});

// dayflow2: End my day's doors go first on the next plan day, locked there, over its cap by them
// the roll never pushes a planned door off; the rolled doors fill the time the day has left, at its end
test("End my day through the planner: the doors left go at the end of the next day, in the time it has left; its own doors all stay", async () => {
  const { rollPlan, capsWithRolled, patchRecord } = await import("../public/lib/day-debrief.js");
  const { shutOn } = await import("../public/lib/fu-check.js");
  const cap = (w) => ({ ...w, max: 3 });
  const p1 = planDays(base({ windows: [WED, cap(THU)] }));
  const d = p1.days[0];
  const order = d.stops.map((s) => s.id);
  assert.ok(order.length >= 4, "Wednesday has doors to leave");
  const own = p1.days[1].stops.map((s) => s.id);
  assert.equal(own.length, 3, "Thursday at its cap");
  const left = order.slice(2, 5);
  const plan = { ...p1, venues: Object.fromEntries(pool.map((r) => [r.id, r])) };
  const on = rollPlan(plan, left, 1, { visitMin: 25, shut: shutOn }).ids;
  assert.ok(on.length >= 1, "Thursday has time left after its last stop");
  const ranks = on.map((id) => plan.venues[id].rank);
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), "rank order");
  const locks = on.map((id, k) => ({ id, date: THU.date, index: own.length + k })); // rollDay: after its own doors
  const drive = patchRecord({}, WED.date, { ended: "x", moved: [{ to: THU.date, ids: on }] });
  const windows = capsWithRolled([WED, cap(THU)], drive, locks);
  const saved = dropFromDay(p1, d, left);
  const visits = { [order[0]]: "visited", [order[1]]: "visited" };
  const p2 = planDays(base({ windows, previous: saved, statuses: visits, frozen: { date: WED.date, from: d.from, ids: order.slice(0, 2) }, locks }));
  const thu = p2.days[1].stops;
  assert.deepEqual(own.filter((id) => !thu.some((s) => s.id === id)), [], "no planned door pushed off");
  assert.deepEqual(thu.slice(-on.length).map((s) => s.id), on, "at the end, in rank order");
  assert.ok(thu.filter((s) => on.includes(s.id)).every((s) => s.openAtArrival !== false && s.depart <= THU.to), "open, and out by the window's end");
  assert.equal(thu.length, 3 + on.length, "over its cap by exactly the doors rolled onto it");
  assert.deepEqual(p2.days[0].stops.map((s) => s.id), order.slice(0, 2), "today keeps only its visits");
  // a day with no time left takes none: every door goes on
  const full = { ...plan, days: plan.days.map((x, k) => (k === 1 ? { ...x, stops: [...x.stops, { id: "late", eta: THU.to - 20, depart: THU.to - 2 }] } : x)) };
  assert.deepEqual(rollPlan(full, left, 1, { visitMin: 25, shut: shutOn }).ids, []);
});

// (mobile2, v2-tour 619510c: Thu took 16): running late's move never makes room on the day it goes to by
// pushing that day's own doors on to a later day. The dry run and the move hold every other door ahead on its day
// (lateMoveInput's hold); without it the planner moved a Wednesday door to Thursday and the old check (no door on no
// day) called it a fit.
test("running late through the planner: the doors go on Wednesday, every door ahead stays on its day", async () => {
  const { lateMoveInput, lateMoveFits, capsWithRolled, unhold } = await import("../public/lib/day-debrief.js");
  const { offEveryDay } = await import("../public/lib/drive-day.js");
  const W = (date, day, f, t) => ({ date, day, from: H(f), to: H(t), start: START });
  const windows = [W("2026-10-27", "tuesday", 13, 18), W("2026-10-28", "wednesday", 14, 17), W("2026-10-29", "thursday", 10, 22)];
  const small = AUS.pool.slice(0, 14).map((r) => ({ ...r, parsedHours: parseHours(r.hours) }));
  const b = (o) => base({ pool: small, windows, ...o });
  const now0 = { date: "2026-10-27", min: H(9) };
  const p0 = planDays(b({ now: now0, previous: planDays(b({ now: now0 })) }));
  const t = p0.days[0].stops.map((s) => s.id);
  const statuses = { [t[0]]: "visited", [t[1]]: "visited" };
  const now = { date: "2026-10-27", min: H(16) };
  const p1 = planDays(b({ statuses, frozen: { date: "2026-10-27", from: H(13), ids: t }, now, previous: p0 }));
  const plan = { ...p1, days: p1.days.map((d, k) => (k === 0 ? { ...d, frozen: true } : d)) };
  const late = t.slice(-3);
  const ahead = plan.days.slice(1).flatMap((d) => d.stops.map((s) => `${s.id}@${d.date}`));
  assert.ok(plan.days[1].stops.length >= 1, "Wednesday has its own doors");
  const run = (hold) => {
    const { saved, locks, drive, hold: h } = lateMoveInput(plan, p1, 0, late, 1, new Map(), {});
    const frozen = { date: "2026-10-27", from: H(13), ids: t.filter((x) => !late.includes(x)) };
    return unhold(planDays(b({ statuses, frozen, now, previous: saved, locks: [...locks, ...(hold ? h : [])], windows: capsWithRolled(windows, drive, locks) })), hold ? h : []);
  };
  const pairs = (p) => new Set(p.days.flatMap((d) => d.stops.map((s) => `${s.id}@${d.date}`)));
  // without the hold: a Wednesday door pushed on to Thursday, none on no day: the old check's blind spot, now no fit
  const loose = run(false);
  assert.ok(ahead.some((x) => !pairs(loose).has(x)), "the planner made room by moving a door of the days ahead");
  assert.deepEqual(offEveryDay(plan, loose), []);
  assert.equal(lateMoveFits(plan, loose, late, "2026-10-28"), false);
  // with it: all three on Wednesday, in its time, every door ahead on its own day, shown unlocked
  const held = run(true);
  const wed = held.days[1].stops;
  assert.ok(late.every((id) => wed.some((s) => s.id === id)));
  assert.ok(wed.every((s) => s.openAtArrival !== false && s.depart <= H(17)));
  assert.deepEqual(ahead.filter((x) => !pairs(held).has(x)), [], "no door ahead left its day");
  assert.equal(wed.length, plan.days[1].stops.length + late.length, "Wednesday: its own doors and the three, no more");
  assert.ok(wed.filter((s) => !late.includes(s.id)).every((s) => !s.locked), "the held doors are not shown locked");
  assert.equal(lateMoveFits(plan, held, late, "2026-10-28"), true);
});

// (mobile2 10-23 on the sims: "No later day has room" on Tue Nov 3 with Wed Nov 4 empty): two causes, both in the
// dry run of the move. (1) Wednesday plans first around its day-locked doors and only tried leaving up to 2:40 pm, so
// Oddwood (opens 4 pm Wednesday) was timed shut at 1:42 pm; it is now reached as it opens. (2) Tuesday had nothing
// logged (not frozen), so Wednesday took one of Tuesday's own doors as it grew: a bump, no fit on any day; Tuesday's
// other doors are held on it now.
test("running late through the planner: an empty later day takes the doors, a 4 pm opener reached as it opens, no bump", async () => {
  const { lateMoveInput, lateMoveFits, capsWithRolled, unhold, laterDays } = await import("../public/lib/day-debrief.js");
  const { driveQueue, lateness } = await import("../public/lib/drive-day.js");
  const W = (date, day, f, t) => ({ date, day, from: H(f), to: H(t), start: START });
  const windows = [W("2026-11-03", "tuesday", 13, 18), W("2026-11-04", "wednesday", 13, 18)];
  const small = AUS.pool.slice(0, 7).map((r) => ({ ...r, parsedHours: parseHours(r.hours) }));
  const b = (o) => base({ pool: small, windows, ...o });
  const now0 = { date: "2026-11-03", min: H(9) };
  const p0 = planDays(b({ now: now0, previous: planDays(b({ now: now0 })) }));
  assert.equal(p0.days[1].stops.length, 0, "Wednesday is empty");
  const plan = { ...p0, venues: Object.fromEntries(small.map((r) => [r.id, r])), statuses: {}, outcomes: {} };
  const now = { date: "2026-11-03", min: H(16) };
  const late = lateness(driveQueue(plan, 0), now, { visitMin: 25 });
  assert.equal(late.out.length, 2, "2 doors don't fit Tuesday");
  assert.ok(late.out.some((id) => plan.venues[id].name === "Oddwood Brewing"), "one opens at 4 pm on Wednesday");
  assert.deepEqual(laterDays(plan, "2026-11-03").map((x) => x.date), ["2026-11-04"]);
  const { saved, locks, drive, hold } = lateMoveInput(plan, p0, 0, late.out, 1, new Map(), {});
  const p = unhold(planDays(b({ now, previous: saved, locks: [...locks, ...hold], windows: capsWithRolled(windows, drive, locks) })), hold);
  const wed = p.days[1].stops;
  assert.deepEqual(wed.map((s) => s.id).sort(), [...late.out].sort(), "Wednesday: the two, nothing else");
  assert.ok(wed.every((s) => s.openAtArrival !== false && s.depart <= H(18)), "open when reached, out by 6 pm");
  assert.ok(wed.find((s) => plan.venues[s.id].name === "Oddwood Brewing").eta >= H(16), "Oddwood at or after 4 pm");
  assert.deepEqual(p.days[0].stops.map((s) => s.id), p0.days[0].stops.map((s) => s.id).filter((id) => !late.out.includes(id)), "Tuesday keeps its other doors");
  assert.equal(lateMoveFits(plan, p, late.out, "2026-11-04"), true);
});

// ...and a later day with no time left still says so (mobile2's Brasa case, Chicago: Thu 4–9 pm already ends at
// 8:43 pm with its own 8 doors, so 4 more 30-minute visits can't fit: "No later day has room" is right there)
test("running late through the planner: a later day already full to its end takes none (no fit, no door pushed off)", async () => {
  const { lateMoveInput, lateMoveFits, capsWithRolled, unhold } = await import("../public/lib/day-debrief.js");
  const { driveQueue, lateness } = await import("../public/lib/drive-day.js");
  const W = (date, day, f, t) => ({ date, day, from: H(f), to: H(t), start: START });
  const windows = [W("2026-10-28", "wednesday", 13, 17), W("2026-10-29", "thursday", 13, 17)];
  const b = (o) => base({ windows, ...o });
  const now0 = { date: "2026-10-28", min: H(9) };
  const p0 = planDays(b({ now: now0, previous: planDays(b({ now: now0 })) }));
  const thu = p0.days[1].stops;
  assert.ok(thu.length >= 5 && thu.at(-1).depart > H(17) - 45, "Thursday is full to its end");
  const plan = { ...p0, venues: Object.fromEntries(pool.map((r) => [r.id, r])), statuses: {}, outcomes: {} };
  const now = { date: "2026-10-28", min: H(15, 30) };
  const late = lateness(driveQueue(plan, 0), now, { visitMin: 25 });
  assert.ok(late.out.length >= 2, "doors don't fit Wednesday");
  const { saved, locks, drive, hold } = lateMoveInput(plan, p0, 0, late.out, 1, new Map(), {});
  const p = unhold(planDays(b({ now, previous: saved, locks: [...locks, ...hold], windows: capsWithRolled(windows, drive, locks) })), hold);
  assert.equal(lateMoveFits(plan, p, late.out, "2026-10-29"), false);
});

// ease audit 3 #2 (gigbot 10-24): running late's Skip on a day ahead (a preview) used Remove's way, a lock onto the next
// day, right after the banner said no later day has room. Skip (plan.js skipDoors) keeps the day as the rep has it (the
// day under way, as a visit logged there makes it) without the doors that don't fit, and locks nothing: the doors are
// back on Your list, the day neither takes them back nor fills the gap from Your list
test("running late's Skip on a preview day: off that day's route, back on Your list, no lock, no refill", async () => {
  const { skippedText } = await import("../public/lib/day-debrief.js");
  const ahead = { date: "2026-10-13", min: H(9) }; // the day before: WED is a preview
  const pb = (o) => base({ now: ahead, ...o });
  const p1 = planDays(pb({ previous: planDays(pb({})) }));
  const d = p1.days[0];
  const order = d.stops.map((s) => s.id);
  const skip = order.slice(-2); // the last two: the ones running late leaves out
  const keep = order.slice(0, -2);
  // the old way (no freeze, no lock): the re-plan puts them straight back on their own day, so a lock was needed
  const loose = planDays(pb({ previous: dropFromDay(p1, d, skip) }));
  assert.ok(skip.some((id) => loose.days[0].stops.some((s) => s.id === id)), "unfrozen, a skipped door comes back on its day");
  // Skip: the day kept as the rep has it, no locks
  const next = planDays(pb({ previous: dropFromDay(p1, d, skip), frozen: { date: WED.date, from: d.from, ids: keep }, locks: [] }));
  assert.deepEqual(next.days[0].stops.map((s) => s.id), keep, "the preview day: its other doors, same order, none added");
  for (const id of skip) {
    assert.ok(!next.days.some((x) => x.stops.some((s) => s.id === id && s.locked)), "never locked anywhere");
    assert.match(whereNow({ ...next, statuses: {} }, id, null).text, /^(On Thu Oct 15, stop \d+|Not on a day)$/);
  }
  const free = skip.filter((id) => whereNow({ ...next, statuses: {} }, id, null).dayIndex < 0);
  const t = skippedText({ ...next, statuses: {} }, skip, next.venues ?? Object.fromEntries(pool.map((r) => [r.id, r])), false);
  if (free.length === 2) assert.match(t, / and .+ are off this day and back on Your list\.$/);
  assert.match(t, /off this day/);
});
