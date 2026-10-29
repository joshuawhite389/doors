// The usual week (Jard 10-24: "this is my schedule, some weeks it changes, but more or less i want a plan for the week,
// every week"): lib/week.js expands it to dated days on a rolling horizon; a follow-up or a moved door on any future
// date is on a real day; the plan reads over weeks.
import { test } from "node:test";
import assert from "node:assert/strict";
import { weekDates, horizon, hoursOn, setChange, pruneChanges, weekFromWindows, untilFor, reachWindows, weeksLine, weeksOf, setDateHours, withoutStarts, mondayOf, MAX_WEEKS } from "../public/lib/week.js";
import { windowsFor } from "../public/lib/pool.js";
import { fitFollowUp } from "../public/lib/fu-check.js";
import { demoProfile, demoWeek } from "../public/lib/demo-profile.js";
import { examples } from "../public/lib/examples.js";

const SAT = "2026-10-24"; // a Saturday
const WEEK = { days: { tuesday: { from: "14:00", to: "18:00" }, wednesday: { from: "13:00", to: "17:00" } }, changes: {}, since: SAT };
const dates = (ws) => ws.map((w) => w.date);

test("a usual week gives its days this week and next, every week, from the day it was set up", () => {
  assert.deepEqual(dates(weekDates(WEEK, { today: SAT })), ["2026-10-27", "2026-10-28"]);
  // a week later: the next two weeks roll in, the one before rolls off
  assert.deepEqual(dates(weekDates(WEEK, { today: "2026-10-27" })), ["2026-10-27", "2026-10-28", "2026-11-03", "2026-11-04"]);
  assert.deepEqual(dates(weekDates(WEEK, { today: "2026-11-09" })), ["2026-11-10", "2026-11-11", "2026-11-17", "2026-11-18"]);
  assert.deepEqual(weekDates(WEEK, { today: "2026-10-27" })[1], { date: "2026-10-28", from: "13:00", to: "17:00" });
  // the days of a week before it was set up are not planned
  assert.deepEqual(dates(weekDates({ ...WEEK, since: "2026-10-28" }, { today: "2026-10-26" })), ["2026-10-28", "2026-11-03", "2026-11-04"]);
});

test("changes to one date: a day off, a day added, other hours; the same as usual is no change", () => {
  let w = setChange(WEEK, "2026-11-03", { off: true });
  w = setChange(w, "2026-11-06", { from: "10:00", to: "12:00" });
  w = setChange(w, "2026-11-04", { from: "15:00", to: "19:00" });
  assert.deepEqual(weekDates(w, { today: "2026-11-02", weeks: 1 }), [{ date: "2026-11-04", from: "15:00", to: "19:00" }, { date: "2026-11-06", from: "10:00", to: "12:00" }]);
  assert.equal(hoursOn(w, "2026-11-03"), null);
  assert.deepEqual(hoursOn(w, "2026-11-10"), { from: "14:00", to: "18:00" }, "the next week is the usual one");
  assert.deepEqual(setChange(w, "2026-11-04", { from: "13:00", to: "17:00" }).changes["2026-11-04"], undefined, "back to the usual hours");
  assert.deepEqual(setChange(w, "2026-11-03", null).changes["2026-11-03"], undefined);
  assert.deepEqual(Object.keys(pruneChanges(w, "2026-11-05").changes), ["2026-11-06"]);
});

test("the horizon reaches a far follow-up's week and the next free day after it; never past MAX_WEEKS", () => {
  assert.equal(untilFor([{ id: "a", kind: "followup", date: "2026-11-20" }, { id: "b", kind: "contact" }], [{ id: "c", date: "2026-11-12" }]), "2026-11-20");
  // Fri Nov 20: not a free day, so the plan runs on to Tue Nov 24
  const ws = dates(weekDates(WEEK, { today: SAT, until: "2026-11-20" }));
  assert.deepEqual(ws.slice(-3), ["2026-11-18", "2026-11-24", "2026-11-25"]);
  assert.ok(ws.includes("2026-11-10"), "the weeks between are planned too: the city is worked through them");
  const h = horizon(WEEK, { today: SAT, until: "2027-06-01" });
  assert.equal(h.last, h.cap);
  assert.equal(weekDates(WEEK, { today: SAT, until: "2027-06-01" }).length, 2 * MAX_WEEKS - 2, "this week's days were before it was set up");
});

test("weekFromWindows: a profile's dated days become its usual week", () => {
  const w = weekFromWindows([{ date: "2026-10-28", from: "14:00", to: "17:00" }, { date: "2026-10-27", from: "13:00", to: "18:00", start: { label: "x", lat: 1, lon: 2 } }, { date: "2026-11-03", from: "09:00", to: "10:00" }], "2026-10-27");
  assert.deepEqual(w.days, { tuesday: { from: "13:00", to: "18:00", start: { label: "x", lat: 1, lon: 2 } }, wednesday: { from: "14:00", to: "17:00" } });
  assert.deepEqual(withoutStarts(w).days.tuesday, { from: "13:00", to: "18:00" });
});

test("setDateHours (the Agent's 'end Tuesday at 5'): that date only on a usual week", () => {
  const p = { week: structuredClone(WEEK), windows: weekDates(WEEK, { today: SAT }) };
  setDateHours(p, "2026-10-27", { to: "17:00" });
  assert.deepEqual(p.week.changes["2026-10-27"], { from: "14:00", to: "17:00" });
  assert.equal(p.week.days.tuesday.to, "18:00");
  assert.equal(p.windows[0].to, "17:00");
});

test("the demo: her usual Tue/Wed/Thu, the tour plans its first week; the form's example plans two", () => {
  const today = new Date(2026, 9, 24);
  const d = demoProfile(today);
  assert.deepEqual(d.week, demoWeek(today));
  assert.deepEqual(dates(windowsFor(d, { today })), dates(d.windows), "the tour's three days");
  assert.deepEqual(windowsFor(d, { today }).map((w) => [w.from, w.to]), [[780, 1080], [840, 1020], [840, 1020]]);
  const ex = examples(today).find((x) => x.key === "maya").profile;
  assert.deepEqual(dates(windowsFor(ex, { today })), ["2026-10-27", "2026-10-28", "2026-10-29", "2026-11-03", "2026-11-04", "2026-11-05"]);
});

test("a profile without a usual week plans on its own dated days exactly as before", () => {
  const p = { windows: [{ date: "2026-10-27", from: "14:00", to: "18:00" }], start: { lat: 30.26, lon: -97.74 } };
  assert.deepEqual(windowsFor(p, { today: "2027-01-01", until: "2027-03-01" }), windowsFor(p));
  assert.deepEqual(dates(windowsFor(p)), ["2026-10-27"]);
});

test("a follow-up past the plan's last day is a plan day on the usual week, not 'not on your plan'", () => {
  const today = "2026-10-26";
  const plan = weekDates(WEEK, { today }).map((w) => ({ date: w.date, from: 840, to: 1080 }));
  const venue = { id: "v", name: "Some Bar" }; // hours unknown
  const old = fitFollowUp({ result: "followup", followUp: "2026-11-24" }, venue, { windows: plan });
  assert.equal(old.code, "offplan", "dated days alone: off the plan, as before");
  assert.equal(fitFollowUp({ result: "followup", followUp: "2026-11-24" }, venue, { windows: plan, week: WEEK }).code, null, "Tue Nov 24 is one of her usual days");
  const fri = fitFollowUp({ result: "followup", followUp: "2026-11-27" }, venue, { windows: plan, week: WEEK });
  assert.equal(fri.code, "offplan");
  assert.match(fri.text, /Doors puts the visit on Tue Dec 1, your next plan day/);
  assert.deepEqual(reachWindows(plan, null, "2026-12-01"), plan);
});

