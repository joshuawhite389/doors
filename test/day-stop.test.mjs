// Stop for today (GROUP3 item 9, public/lib/day-stop.js): the doors left go into the coming days (the lowest-fit back
// on Your list when the days are full, with why) or back on Your list; running late's doors that don't fit get the same
// choice; each is one entry in Changes you made with one Undo, which brings the doors back on today (Resume my day).
import { test } from "node:test";
import assert from "node:assert/strict";
import { stopSheet, stuckText, whereText, stopDoneText, dayRange, withChange, dayChanges, changeText, undoChange, undoneText, STOP_WORDS, choiceLabel, parkIds, unparkIds, withoutParked, markParked, PARKED_REASON } from "../public/lib/day-stop.js";
import { planDays, estimateTravel } from "../public/lib/schedule.js";
import { restReason, listRows } from "../public/lib/planview.js";
import { recordOf, patchRecord, withRemoved, startButton, movedLine, debrief } from "../public/lib/day-debrief.js";
import { driveQueue, lateFor } from "../public/lib/drive-day.js";

const stop = (id, eta, more = {}) => ({ id, eta, depart: eta + 25, legMi: 1, legMin: 6, pinned: null, ...more });
const FRI = "2026-10-23";
const SAT = "2026-10-24";
const THU = "2026-10-29";
// Friday under way: a and b visited, c d e left (ranks 1 2 3). Saturday is full (its window ends at 2:20 pm, its own
// door out at 2:15); Thursday has room for two doors after its own one.
function week() {
  const ids = ["a", "b", "c", "d", "e", "x", "y", "z"];
  return {
    days: [
      { date: FRI, day: "friday", from: 780, to: 1080, frozen: true, stops: ["a", "b", "c", "d", "e"].map((id, k) => stop(id, 790 + k * 40)) },
      { date: SAT, day: "saturday", from: 810, to: 860, stops: [stop("x", 810)] },
      { date: THU, day: "thursday", from: 840, to: 950, stops: [stop("z", 840)] },
    ],
    venues: Object.fromEntries(ids.map((id, k) => [id, { id, name: `Room ${id.toUpperCase()}`, rank: k + 1 }])),
    statuses: { a: "visited", b: "visited" },
    outcomes: {},
    windows: [{ date: FRI }, { date: SAT }, { date: THU }],
    profile: { visitMin: 25 },
  };
}
// the saved plan (store.js `plan`) as the planner kept it: the days and their stops
const savedOf = (p) => ({ days: p.days.map((d) => ({ ...d, stops: d.stops.map((s) => ({ ...s })) })) });

test("Stop for today's sheet: the doors left, where Move puts them, the lowest-fit back on Your list with why", () => {
  const p = week();
  const t = stopSheet(p, ["c", "d", "e"], FRI);
  assert.equal(t.head, "3 doors left: Room C, Room D and Room E.");
  // Saturday is full; Thursday (to 3:50 pm) takes all three after its own door: z 2:00, c 2:25, d 2:50, e 3:15–3:40
  assert.equal(t.days, "Doors puts them at the end of Thu Oct 29. The doors already on those days stay.");
  // a shorter Thursday: only two fit, the third (lowest rank) goes back on Your list with the reason, in plain words
  p.days[2].to = 920;
  const u = stopSheet(p, ["c", "d", "e"], FRI);
  assert.equal(u.days, "Doors puts Room C and Room D at the end of Thu Oct 29. No room left on Sat and Thu: Room E back on Your list. The doors already on those days stay.");
  assert.equal(u.list, "They come off today and wait on Your list, on no day. Add them to a day when you want.");
  assert.equal(stopSheet(p, [], FRI).head, "Every door is logged.");
  assert.deepEqual([STOP_WORDS.button, STOP_WORDS.days, STOP_WORDS.list], ["Stop for today", "Move them into the coming days", "Put them back on Your list"]);
});

test("the reasons a door finds no day, and the day range", () => {
  const p = week();
  assert.equal(dayRange([THU, SAT]), "Sat and Thu");
  assert.equal(dayRange(["2026-10-27", "2026-10-28", "2026-10-31"]), "Tue–Sat");
  assert.equal(dayRange([SAT]), "Sat");
  assert.equal(stuckText(p, [{ id: "e", why: "no time left on a later day" }, { id: "d", why: "not open during any later day's hours" }], FRI),
    "No room left on Sat and Thu: Room E back on Your list. Not open during your hours on Sat and Thu: Room D back on Your list.");
  assert.equal(stuckText(p, [{ id: "e", why: "no later day in the plan" }], FRI), "No day after this one in the plan: Room E back on Your list.");
});

test("said back after the move, from the plan as it is now (never the preview)", () => {
  const p = week();
  p.days[2].to = 920;
  // after Move them into the coming days: c and d on Thursday, e on no day
  p.days[0].stops = p.days[0].stops.filter((s) => !["c", "d", "e"].includes(s.id));
  p.days[2].stops.push(stop("c", 865), stop("d", 890));
  assert.equal(stopDoneText(p, ["c", "d", "e"], FRI, "days"), "Stopped for today. Thu Oct 29: Room C and Room D. No room left on Sat and Thu: Room E back on Your list.");
  // Put them back on Your list: on no day by choice; one the planner put on a day of its own accord says where
  const q = week();
  q.days[0].stops = q.days[0].stops.filter((s) => !["c", "d", "e"].includes(s.id));
  assert.equal(stopDoneText(q, ["c", "d", "e"], FRI, "list"), "Stopped for today. Back on Your list: Room C, Room D and Room E.");
  q.days[2].stops.push(stop("e", 865));
  assert.equal(whereText(q, ["c", "d", "e"], FRI, "list"), "Thu Oct 29: Room E. Back on Your list: Room C and Room D.");
  assert.equal(stopDoneText(q, ["e"], FRI, "days", { late: true }), "Thu Oct 29: Room E.", "running late: no 'Stopped'");
});

test("Changes you made: one entry per stop, its Undo on the newest change of today only; none for a change that didn't happen", () => {
  const p = week();
  let r = { ...recordOf({}, FRI), started: "2026-10-23T13:00", ended: "2026-10-23T14:15", moved: [{ to: THU, ids: ["c", "d"] }] };
  for (const id of ["c", "d", "e"]) r = withRemoved(r, id, "end", "2026-10-23T14:15");
  r = withChange(r, { kind: "stop", how: "days", at: "2026-10-23T14:15", ids: ["c", "d", "e"] });
  const drive = { [FRI]: r, [SAT]: { changes: [{ kind: "late", how: "list", at: "2026-10-24T15:00", ids: [] }] } };
  p.drive = drive;
  p.days[0].stops = p.days[0].stops.filter((s) => !["c", "d", "e"].includes(s.id));
  p.days[2].stops.push(stop("c", 865), stop("d", 890));
  const fs = dayChanges(p, drive, FRI);
  assert.equal(fs.length, 1, "the empty entry (nothing moved) is not listed");
  assert.equal(fs[0].text, "Stopped Fri Oct 23 at 2:15 pm: 3 doors moved into the coming days.");
  assert.match(fs[0].more, /^Thu Oct 29: Room C and Room D\. /);
  assert.deepEqual(fs[0].fixes, [{ kind: "dayUndo", date: FRI, label: "Undo: resume my day" }]);
  assert.deepEqual(dayChanges(p, drive, SAT)[0].fixes, [], "a past day's stop: listed, no Undo");
  // the plan's button says Resume my day on a day stopped today (web only: the option)
  assert.deepEqual(startButton(p, drive, { date: FRI, min: 900 }, { stopped: true }), { label: "Resume my day", resume: true, stopped: true, text: "Brings back the 3 doors you stopped" });
  assert.equal(startButton(p, drive, { date: FRI, min: 900 }).label, "Start my day", "the phone's call, no option: as before");
});

test("Undo of a stop (Resume my day): the doors back at the end of today in their order, off the days ahead, the day on again", () => {
  const p = week();
  let r = { ...recordOf({}, FRI), started: "2026-10-23T13:00", ended: "2026-10-23T14:15", moved: [{ to: THU, ids: ["c", "d"] }] };
  for (const id of ["c", "d", "e"]) r = withRemoved(r, id, "end", "2026-10-23T14:15");
  r = withChange(r, { kind: "stop", how: "days", at: "2026-10-23T14:15", ids: ["c", "d", "e"] });
  const drive = { [FRI]: r };
  p.days[0].stops = p.days[0].stops.filter((s) => !["c", "d", "e"].includes(s.id));
  p.days[2].stops.push(stop("c", 865), stop("d", 890));
  const u = undoChange(savedOf(p), p, drive, FRI);
  assert.deepEqual(u.saved.days[0].stops.map((s) => s.id), ["a", "b", "c", "d", "e"]);
  assert.deepEqual(u.saved.days[2].stops.map((s) => s.id), ["z"], "off Thursday again: Thursday has only its own door");
  const r2 = recordOf(u.drive, FRI);
  assert.deepEqual([r2.ended, r2.moved, r2.removed, r2.changes], [null, null, [], []]);
  assert.equal(r2.started, "2026-10-23T13:00", "the day keeps its start");
  assert.equal(undoneText(p, u.ids), "Back on today: Room C, Room D and Room E.");
  // the day as drive mode shows it after: the next door is c, and the button is Resume my day (the pause's)
  const after = { ...p, days: u.saved.days, drive: u.drive };
  assert.equal(driveQueue(after, 0).current.id, "c");
  assert.equal(startButton(after, u.drive, { date: FRI, min: 900 }, { stopped: true }).text, "2 of 5 done · next: Room C");
  assert.equal(dayChanges(after, u.drive, FRI).length, 0, "undone: gone from Changes you made");
  // a door marked Not a fit since stays off; no change to undo: null
  const p3 = { ...p, statuses: { ...p.statuses, d: "notfit" } };
  assert.deepEqual(undoChange(savedOf(p), p3, drive, FRI).ids, ["c", "e"]);
  assert.equal(undoChange(savedOf(p), p, {}, FRI), null);
});

test("Put them back on Your list: the debrief says so (not 'no time left'), counted as Not visited", () => {
  const p = week();
  let r = { ...recordOf({}, FRI), started: "2026-10-23T13:00", ended: "2026-10-23T14:15" };
  for (const id of ["c", "d", "e"]) r = withRemoved(r, id, "endlist", "2026-10-23T14:15");
  r = withChange(r, { kind: "stop", how: "list", at: "2026-10-23T14:15", ids: ["c", "d", "e"] });
  p.days[0].stops = p.days[0].stops.filter((s) => !["c", "d", "e"].includes(s.id));
  const m = movedLine(p, r, FRI);
  assert.deepEqual([m.head, m.body], ["Back on Your list", "Room C, Room D, Room E. Add them to a day from Your list when you want."]);
  const b = debrief(p, driveQueue(p, 0), r);
  assert.equal(b.title, "2 doors visited, 3 not");
  assert.equal(changeText(p, FRI, r.changes[0]).text, "Stopped Fri Oct 23 at 2:15 pm: 3 doors put back on Your list.");
});

test("running late: the doors pushed past the day's end get the same choice; its entry and Undo", () => {
  const p = week();
  p.days[0].to = 960; // Friday ends at 4 pm
  const q = driveQueue(p, 0);
  // 30 min late at c (planned 2:10 pm): c 2:40, d (+6) 3:11, e (+6) 3:42 → out by 4:07, past 4 pm: e doesn't fit
  const late = lateFor(q, { date: FRI, min: 850 }, 30, { visitMin: 25 });
  assert.deepEqual(late.out, ["e"]);
  assert.equal(stopSheet(p, late.out, FRI).days, "Doors puts it at the end of Thu Oct 29. The doors already on those days stay.");
  // Move them into the coming days: e on Thursday, the move kept on the record (lateMoved) and in Changes you made
  let r = { ...recordOf({}, FRI), started: "2026-10-23T13:00", lateMoved: [{ to: THU, ids: ["e"] }] };
  r = withChange(r, { kind: "late", how: "days", at: "2026-10-23T14:10", by: 30, ids: ["e"] });
  const drive = patchRecord({}, FRI, r);
  p.days[0].stops = p.days[0].stops.filter((s) => s.id !== "e");
  p.days[2].stops.push(stop("e", 865));
  const f = dayChanges(p, drive, FRI)[0];
  assert.equal(f.text, "Running late on Fri Oct 23 (+30 min): Room E moved into the coming days.");
  assert.equal(f.more, "Thu Oct 29: Room E.");
  assert.deepEqual(f.fixes.map((x) => x.label), ["Undo"]);
  // Undo: back at the end of today, off Thursday; the day was never ended
  const u = undoChange(savedOf(p), p, drive, FRI);
  assert.deepEqual(u.saved.days[0].stops.map((s) => s.id), ["a", "b", "c", "d", "e"]);
  assert.deepEqual(u.saved.days[2].stops.map((s) => s.id), ["z"]);
  const r2 = recordOf(u.drive, FRI);
  assert.deepEqual([r2.lateMoved, r2.changes, r2.ended], [[], [], null]);
  // two changes on a day: only the newest has Undo
  const two = patchRecord({}, FRI, withChange(r, { kind: "stop", how: "list", at: "2026-10-23T15:00", ids: ["c", "d"] }));
  const xs = dayChanges(p, two, FRI);
  assert.deepEqual(xs.map((x) => [x.text.slice(0, 12), x.fixes.length]), [["Stopped Fri ", 1], ["Running late", 0]]);
});

test("one door: the choices and lines say it, not them", () => {
  const p = week();
  assert.deepEqual([choiceLabel("days", 1), choiceLabel("list", 1)], ["Move it into the coming days", "Put it back on Your list"]);
  assert.deepEqual([choiceLabel("days", 3), choiceLabel("list", 3)], ["Move them into the coming days", "Put them back on Your list"]);
  const t = stopSheet(p, ["e"], FRI);
  assert.equal(t.head, "1 door left: Room E.");
  assert.equal(t.days, "Doors puts it at the end of Thu Oct 29. The doors already on those days stay.");
  assert.equal(t.list, "It comes off today and waits on Your list, on no day. Add it to a day when you want.");
  assert.equal(changeText(p, FRI, { kind: "stop", how: "list", at: "2026-10-23T14:15", ids: ["e"] }).text, "Stopped Fri Oct 23 at 2:15 pm: 1 door put back on Your list.");
  assert.equal(stopDoneText(p, ["e"], FRI, "list"), "Stopped for today. Back on Your list: Room E.");
});

// team lead 10-24: "Put them back on Your list" means that: the planner never quietly puts them on a later day with room
test("Put them back on Your list: off every day, even a later day with room, until added back or undone", () => {
  const START = { lat: 30.255, lon: -97.72 };
  const FRIW = { date: FRI, day: "friday", from: 780, to: 900, start: START };
  const THUW = { date: THU, day: "thursday", from: 660, to: 1200, start: START }; // 9 hours: room for every door
  const rows = ["a", "b", "c", "d", "e"].map((id, k) => ({ id, name: `Room ${id.toUpperCase()}`, lat: 30.26 + k * 0.004, lon: -97.74 + k * 0.003, rank: k + 1, hours: null }));
  // Friday stopped after a and b: the day keeps its visits; c and d were put back on Your list
  const input = { pool: rows, statuses: { a: "visited", b: "visited" }, windows: [FRIW, THUW], visitMin: 25, travel: estimateTravel, pinned: [], locks: [], now: { date: FRI, min: 840 }, frozen: { date: FRI, from: 780, ids: ["a", "b"] } };
  const on = (pl) => Object.fromEntries(pl.days.map((d) => [d.date, d.stops.map((s) => s.id)]));
  assert.deepEqual(on(planDays(input))[THU].sort(), ["c", "d", "e"], "unheld, Thursday's room takes them");
  const parked = parkIds([], ["c", "d"]);
  const p = markParked(planDays(withoutParked(input, parked)), parked);
  assert.deepEqual(on(p), { [FRI]: ["a", "b"], [THU]: ["e"] }, "held: on no day");
  // Your list still lists them, with why
  const view = { ...p, pool: { ids: rows.map((r) => r.id) }, statuses: input.statuses, venues: {} };
  assert.equal(restReason(view, "c"), PARKED_REASON);
  assert.deepEqual(listRows(view).filter((r) => r.state === "rest").map((r) => r.id), ["c", "d"]);
  // added back (Add to the best day) or undone: that door is free again
  const after = unparkIds(parked, ["c"]);
  assert.deepEqual(after, ["d"]);
  assert.deepEqual(on(planDays(withoutParked(input, after)))[THU].sort(), ["c", "e"]);
  assert.equal(withoutParked(input, []), input, "none held: the input as it is");
  assert.equal(unparkIds(parked, ["x"]), parked);
});
