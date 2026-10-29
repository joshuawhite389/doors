// The day flow (Jard 10-23, items 5-9; public/lib/day-debrief.js): Day done counts every door in the logging
// answers' words (his screen: "9 doors · 2 interested · 1 follow-up · 1 passed on · 3 no" = 7 of 9), Resume my day,
// and taking doors off the day being worked for good, through the real planner.
import { test } from "node:test";
import assert from "node:assert/strict";
import { debrief, startButton, dropFromDay, patchRecord, recordOf, withRemoved, whereNow, bookDay, leftToday, BUCKETS, dayFacts, nextPlanDay, laterDays, rollPlan, rolledOnto, capsWithRolled, movedLine, rollPreview, endSheetText, bumpedBy, lateMoveInput, lateMoveFits, unhold, lateOffer, overCapText, LATE_WORDS } from "../public/lib/day-debrief.js";
import { driveQueue } from "../public/lib/drive-day.js";

const stop = (id, eta, more = {}) => ({ id, eta, legMi: 1, legMin: 6, pinned: null, ...more });
const ids = ["a", "b", "c", "d", "e", "f", "g", "h", "i"];
function jardsDay() {
  return {
    days: [
      { date: "2026-10-23", day: "friday", from: 780, to: 1080, stops: ids.map((id, k) => stop(id, 790 + k * 30)) },
      { date: "2026-10-24", day: "saturday", from: 840, to: 1020, stops: [stop("x", 850), stop("y", 890), stop("c", 930, { pinned: "followup" })] },
    ],
    venues: Object.fromEntries([...ids, "x", "y"].map((id) => [id, { id, name: `Room ${id.toUpperCase()}` }])),
    statuses: Object.fromEntries(ids.map((id) => [id, "visited"])),
    outcomes: {
      a: { result: "interested", at: "2026-10-23T13:10" },
      b: { result: "interested", followUp: "2026-10-28", at: "2026-10-23T13:40" },
      c: { result: "followup", followUp: "2026-10-24", followUpTime: "15:30", at: "2026-10-23T14:10" },
      d: { result: "someone", who: "Sam", at: "2026-10-23T14:40" },
      e: { result: "no" }, f: { result: "no" }, g: { result: "no" },
      // h and i: Just mark visited (no outcome): Jard's missing two
    },
    slots: { h: [{ slot: "S4", field: "note", value: "manager back Thursdays", by: "drive", at: "2026-10-23T17:00:00", id: "n1" }] },
    windows: [{ date: "2026-10-23" }, { date: "2026-10-24" }, { date: "2026-10-29" }],
    profile: { visitMin: 25 },
  };
}

test("Day done counts all 9 doors, each once, in the logging answers' words (no 'passed on')", () => {
  const p = jardsDay();
  const b = debrief(p, driveQueue(p, 0), recordOf({}, "2026-10-23"));
  assert.equal(b.rows.length, 9);
  assert.equal(b.counts.reduce((n, c) => n + c.n, 0), 9, "every door counted");
  assert.deepEqual(b.counts.map((c) => [c.label, c.n]), [["Interested", 2], ["Follow up", 1], ["Talked to someone else", 1], ["Not interested", 3], ["Just visited", 2]]);
  assert.equal(b.title, "9 doors visited");
  assert.equal(b.sub, "2 interested, 1 to follow up, 1 sent you to someone else and 3 not interested.");
  assert.doesNotMatch(JSON.stringify(b), /passed on/i);
  assert.ok(BUCKETS.every((x) => x.label !== "passed on"));
});

test("the debrief's rows, follow-ups booked, suggestions and next day come only from what was logged", () => {
  const p = jardsDay();
  const b = debrief(p, driveQueue(p, 0), recordOf({}, "2026-10-23"));
  const row = (id) => b.rows.find((r) => r.id === id);
  assert.equal(row("d").detail, "Talked to Sam");
  assert.equal(row("c").detail, "Sat Oct 24, 3:30 pm", "under Follow up: the day alone");
  assert.equal(row("b").detail, "Follow up Wed Oct 28");
  assert.deepEqual(row("h").notes.map((n) => n.text), ["manager back Thursdays"]);
  // booked: c lands on Saturday as stop 3; b's Wed Oct 28 has no window
  assert.deepEqual(b.booked.map((x) => [x.id, x.text]), [["b", "Wed Oct 28: not on a day"], ["c", "Sat Oct 24, stop 3 · 3:30 pm"]]);
  // suggestions only where nothing is booked: a (interested), d (Sam), h (its note names Thursday)
  assert.deepEqual(b.suggest.map((x) => [x.id, x.kind]), [["a", "interested"], ["d", "someone"], ["h", "note"]]);
  assert.match(b.suggest[1].text, /^Ask for Sam next time/);
  assert.equal(b.suggest[2].weekday, "thursday");
  assert.equal(bookDay(b.suggest[2], p.venues.h, { windows: p.windows, from: "2026-10-23" }), "2026-10-29");
  assert.equal(bookDay(b.suggest[0], p.venues.a, { windows: p.windows, from: "2026-10-23" }), null, "no weekday: the caller's Come back day");
  assert.equal(b.next.text, "3 doors, first Room X at 2:10 pm · 1 follow-up");
});

test("End my day: the doors not visited are counted as Not visited, with where they are now", () => {
  const p = jardsDay();
  // g, h, i not visited: End my day took them off; the planner put g on Saturday
  for (const id of ["g", "h", "i"]) delete p.statuses[id], delete p.outcomes[id];
  const q0 = driveQueue(p, 0);
  assert.deepEqual(leftToday(q0), ["g", "h", "i"]);
  p.days[0].stops = p.days[0].stops.filter((s) => !["g", "h", "i"].includes(s.id));
  p.days[1].stops.push(stop("g", 960));
  p.statuses.i = "notfit";
  let r = { ...recordOf({}, "2026-10-23"), ended: "2026-10-23T16:00" };
  for (const id of ["g", "h", "i"]) r = withRemoved(r, id, "end", "2026-10-23T16:00");
  p.statuses.i = "notfit"; // the debrief's Drop it from the plan
  const b = debrief(p, driveQueue(p, 0), r);
  assert.equal(b.total, 9);
  assert.equal(b.title, "6 doors visited, 3 not");
  const nv = b.rows.filter((x) => x.bucket === "notvisited");
  assert.deepEqual(nv.map((x) => [x.id, x.detail]), [["g", "On Sat Oct 24, stop 4"], ["h", "Not on a day"], ["i", "Dropped from the plan"]]);
  assert.equal(b.counts.at(-1).label, "Not visited");
  assert.equal(b.ended, true);
});

test("Resume my day: the plan's button says so while today's drive is started, not ended, doors left", () => {
  const p = jardsDay();
  const now = { date: "2026-10-23", min: 900 };
  for (const id of ["f", "g", "h", "i"]) delete p.statuses[id];
  assert.equal(startButton(p, {}, now).label, "Start my day");
  let drive = patchRecord({}, now.date, { started: "2026-10-23T13:00" });
  drive = patchRecord(drive, now.date, (r) => ({ paused: "2026-10-23T14:55", skipped: [...r.skipped, "f"] }));
  assert.equal(recordOf(drive, now.date).started, "2026-10-23T13:00", "a patch keeps the rest");
  assert.deepEqual(startButton(p, drive, now), { label: "Resume my day", resume: true, text: "5 of 9 done · next: Room F" });
  assert.equal(startButton(p, patchRecord(drive, now.date, { ended: "x" }), now).label, "Start my day");
  assert.equal(startButton(p, drive, { date: "2026-10-24", min: 900 }).label, "Start my day", "another day: not its drive");
});

// dayflow2 (mobile2 10-23, b): a door taken off with Remove from today isn't part of the day any more
test("Remove from today: listed apart as Removed from today, not counted (5 doors, not 6)", () => {
  const p = jardsDay();
  // a day of 6: f removed (Off today); a, b visited; c, d, e left when End my day ran
  p.days[0].stops = p.days[0].stops.filter((s) => ["a", "b", "c", "d", "e"].includes(s.id));
  for (const id of ["c", "d", "e"]) delete p.statuses[id], delete p.outcomes[id];
  const q0 = driveQueue(p, 0);
  let r = withRemoved(recordOf({}, "2026-10-23"), "f", "later", "2026-10-23T14:00");
  r = { ...r, ended: "2026-10-23T16:00" };
  for (const id of leftToday(q0)) r = withRemoved(r, id, "end", r.ended);
  p.days[0].stops = p.days[0].stops.filter((s) => ["a", "b"].includes(s.id));
  const b = debrief(p, driveQueue(p, 0), r);
  assert.equal(b.total, 5, "the day's 5");
  assert.equal(b.counts.reduce((n, c) => n + c.n, 0), 5);
  assert.equal(b.title, "2 doors visited, 3 not");
  assert.deepEqual(b.removed.map((x) => [x.id, x.label, x.detail]), [["f", "Removed from today", "Not on a day"]]);
  // a record saved before dayflow2 (End my day said "later", stamped with the day's end) still counts its doors
  const old = { ...r, removed: r.removed.map((x) => (x.how === "end" ? { ...x, how: "later" } : x)) };
  assert.equal(debrief(p, driveQueue(p, 0), old).total, 5);
});

// dayflow2 (mobile2 10-23, c): End my day rolls the doors left to the next plan day, first, rank order
test("End my day's doors: the next plan day, rank order, a shut one left out; caps raised; the debrief's line", () => {
  const p = jardsDay();
  p.venues.g.rank = 9; p.venues.h.rank = 3; p.venues.i.rank = 5;
  p.days.push({ date: "2026-10-29", day: "thursday", from: 840, to: 1020, stops: [] });
  assert.equal(nextPlanDay(p, "2026-10-23"), 1);
  assert.equal(nextPlanDay(p, "2026-10-29"), -1, "no later day");
  assert.deepEqual(laterDays(p, "2026-10-23").map((x) => x.date), ["2026-10-24", "2026-10-29"]);
  const shut = (v) => (v?.id === "i" ? "closed saturdays" : null);
  assert.deepEqual(rollPlan(p, ["g", "h", "i"], 1, { shut }), { ids: ["h", "g"], left: ["i"] });
  // the planner's caps: Saturday's 3 a day goes to 5 while h and g are locked there
  const drive = patchRecord({}, "2026-10-23", { ended: "x", moved: { to: "2026-10-24", ids: ["h", "g"] } });
  const locks = [{ id: "h", date: "2026-10-24", index: 0 }, { id: "g", date: "2026-10-24", index: 1 }];
  assert.deepEqual(rolledOnto(drive, locks), { "2026-10-24": 2 });
  const ws = capsWithRolled([{ date: "2026-10-24", max: 3 }, { date: "2026-10-29", max: 3 }, { date: "2026-10-30" }], drive, locks);
  assert.deepEqual(ws.map((w) => w.max), [5, 3, undefined]);
  assert.deepEqual(rolledOnto(drive, locks.slice(0, 1)), { "2026-10-24": 1 }, "one moved off again: only the one still there counts");
  // the debrief: Saturday holds them first, 5 doors on a 3-a-day cap
  p.days[1].stops = [stop("h", 850), stop("g", 880), ...p.days[1].stops];
  p.windows = [{ date: "2026-10-23" }, { date: "2026-10-24", max: 3 }, { date: "2026-10-29" }];
  const m = movedLine(p, recordOf(drive, "2026-10-23"), "2026-10-23");
  assert.equal(m.text, "Moved to Sat Oct 24: Room H, Room G.");
  assert.deepEqual([m.head, m.body], ["Moved to Sat Oct 24", "Room H, Room G."]);
  assert.equal(m.cap, "Sat Oct 24 now has 5 doors, 2 over your 3 a day.");
  assert.deepEqual(m.choose.map((x) => x.date), ["2026-10-29"]);
  // no later plan day: on Your list, not on a day, and the caller offers to add a day
  const last = jardsDay();
  last.days = [last.days[0]];
  let r = { ...recordOf({}, "2026-10-23"), ended: "t" };
  r = withRemoved(r, "g", "end", "t");
  last.days[0].stops = last.days[0].stops.filter((s) => s.id !== "g");
  const n = movedLine(last, r, "2026-10-23");
  assert.equal(n.none, true);
  assert.equal(n.text, "No day after this one in the plan, so Room G is not on a day.");
});

// mobile2 10-23 re-shot: the End sheet promised Bunny Slope "moves to Wed Oct 28" and it went on no day, unexplained
test("End sheet: promises only the doors that can move, says why one can't; Day done names it with the reason", () => {
  const p = jardsDay();
  p.days.push({ date: "2026-10-29", day: "thursday", from: 840, to: 1020, stops: [] });
  p.pool = { ids: ["g", "h", "i"] };
  // i opens at 6 pm every day: shut through Saturday's and Thursday's 2-5 pm; g shut Saturdays only
  const shut = (v, w) => (v?.id === "i" ? "not open 2–5 pm" : v?.id === "g" && w.date === "2026-10-24" ? "closed saturdays" : null);
  assert.deepEqual(rollPreview(p, ["g", "h", "i"], "2026-10-23", { shut }), { groups: [{ to: "2026-10-24", ids: ["h"] }, { to: "2026-10-29", ids: ["g"] }], stuck: [{ id: "i", why: "not open during any later day's hours" }] });
  // the real hours (fu-check shutOn): a door with no hours known is never called shut
  assert.equal(endSheetText(p, ["g", "h"], "2026-10-23"), "2 doors aren't visited yet. Room G, Room H go at the end of Sat Oct 24, or the day after if the drive runs long. The doors already on those days stay.");
  assert.equal(endSheetText(p, [], "2026-10-23"), "Every door is logged.");
  // Day done: one on no day after End my day, with why
  for (const id of ["g", "h", "i"]) delete p.statuses[id], delete p.outcomes[id];
  p.days[0].stops = p.days[0].stops.filter((s) => !["g", "h", "i"].includes(s.id));
  p.days[1].stops.push(stop("h", 960));
  p.venues.i.hours = Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((d) => [d, [{ opens: "T18:00:00", closes: "T23:00:00", closed: false }]]));
  let r = { ...recordOf({}, "2026-10-23"), ended: "t", moved: [{ to: "2026-10-24", ids: ["h"] }] };
  for (const id of ["h", "i"]) r = withRemoved(r, id, "end", "t");
  const m = movedLine(p, r, "2026-10-23");
  assert.equal(m.head, "Moved to Sat Oct 24");
  assert.equal(m.body, "Room H. Not on a day: Room I (not open during any later day's hours).");
  // none moved at all: the card still says where and why
  const r2 = { ...r, moved: null, removed: r.removed.filter((x) => x.id === "i") };
  assert.deepEqual([movedLine(p, r2, "2026-10-23").head, movedLine(p, r2, "2026-10-23").body], ["Not on a day", "Not on a day: Room I (not open during any later day's hours)."]);
});

// mobile2 10-23 re-shoot: the End sheet gave Bunny Slope "no time left on a later day" (the first door's reason) while
// Day done said "not open during any later day's hours": each door's own reason, the same in both
test("End sheet and Day done give each door on no day its own reason, the same one", () => {
  const p = jardsDay();
  p.days[1].to = 960; // Saturday full: its last door is out at 955
  p.pool = { ids: ["g", "i"] };
  p.venues.i.hours = Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((d) => [d, [{ opens: "T18:00:00", closes: "T23:00:00", closed: false }]]));
  assert.equal(endSheetText(p, ["g", "i"], "2026-10-23"), "2 doors aren't visited yet. Room G goes on Your list, not on a day: no time left on a later day. Room I goes on Your list, not on a day: not open during any later day's hours.");
  for (const id of ["g", "i"]) delete p.statuses[id], delete p.outcomes[id];
  p.days[0].stops = p.days[0].stops.filter((s) => !["g", "i"].includes(s.id));
  let r = { ...recordOf({}, "2026-10-23"), ended: "t" };
  for (const id of ["g", "i"]) r = withRemoved(r, id, "end", "t");
  assert.equal(movedLine(p, r, "2026-10-23").body, "Not on a day: Room G (no time left on a later day), Room I (not open during any later day's hours).");
});

// running late never offers a move the guard would refuse; the dry run and the move share one input
test("running late: the move's input, its check, and the banner's offer (a full day marked, the next that fits)", () => {
  const p = jardsDay();
  p.days[0].frozen = true;
  p.days.push({ date: "2026-10-29", day: "thursday", from: 840, to: 1020, stops: [stop("z", 850)] });
  const saved = structuredClone({ days: p.days });
  const { saved: s2, locks, drive } = lateMoveInput(p, saved, 0, ["h", "i"], 2, new Map([["x", "place"]]), {});
  // off the day under way, day-locked at the end of Thursday; the other locks kept; Thursday's cap takes them on top
  assert.deepEqual(s2.days[0].stops.map((x) => x.id), ["a", "b", "c", "d", "e", "f", "g"]);
  assert.deepEqual(locks, [{ id: "x", date: "2026-10-24", index: 0 }, { id: "h", date: "2026-10-29", index: null }, { id: "i", date: "2026-10-29", index: null }]);
  assert.deepEqual(drive["2026-10-23"].lateMoved, [{ to: "2026-10-29", ids: ["h", "i"] }]);
  assert.deepEqual(capsWithRolled([{ date: "2026-10-29", max: 1 }], drive, locks), [{ date: "2026-10-29", max: 3 }]);
  assert.equal(saved.days[0].stops.length, 9); // the saved plan is not touched
  // the check: every door on the day, no door of the days ahead off every day
  const after = structuredClone(p);
  after.days[0].stops = after.days[0].stops.filter((x) => !["h", "i"].includes(x.id));
  after.days[2].stops.push(stop("h", 900), stop("i", 930));
  assert.equal(lateMoveFits(p, after, ["h", "i"], "2026-10-29"), true);
  const bumped = structuredClone(after);
  bumped.days[2].stops = bumped.days[2].stops.filter((x) => x.id !== "z");
  assert.equal(lateMoveFits(p, bumped, ["h", "i"], "2026-10-29"), false); // z pushed off
  const short = structuredClone(after);
  short.days[2].stops = short.days[2].stops.filter((x) => x.id !== "i");
  assert.equal(lateMoveFits(p, short, ["h", "i"], "2026-10-29"), false); // i on no day
  // (mobile2: Thu took 16): room made by pushing the day's own door on to a later day is no fit, nor a
  // door from another day piled on, nor one run past the day's end
  const cascade = structuredClone(after);
  cascade.days.push({ date: "2026-10-30", day: "friday", from: 840, to: 1020, stops: [stop("z", 850)] });
  cascade.days[2].stops = cascade.days[2].stops.filter((x) => x.id !== "z");
  const p3 = structuredClone(p);
  p3.days.push({ date: "2026-10-30", day: "friday", from: 840, to: 1020, stops: [] });
  assert.equal(lateMoveFits(p3, cascade, ["h", "i"], "2026-10-29"), false); // z: Thu → Fri, on a day all the same
  const piled = structuredClone(after);
  const y = piled.days[1].stops.pop();
  piled.days[2].stops.push(y);
  assert.equal(lateMoveFits(p, piled, ["h", "i"], "2026-10-29"), false); // Saturday's door on Thursday
  const over = structuredClone(after);
  over.days[2].stops.at(-1).depart = 1030;
  assert.equal(lateMoveFits(p, over, ["h", "i"], "2026-10-29"), false); // i done after 5 pm
  // hold: every other door ahead day-locked to its day for the run (not the moved ones, not the day under way's, not
  // one locked already); unhold shows them unlocked
  assert.deepEqual(lateMoveInput(p, saved, 0, ["h", "i"], 2, new Map(), {}).hold, [...p.days[1].stops.filter((x) => x.id !== "c").map((x) => ({ id: x.id, date: "2026-10-24", index: null })), { id: "z", date: "2026-10-29", index: null }]);
  assert.ok(!lateMoveInput(p, saved, 0, ["h", "i"], 2, new Map([["x", "place"]]), {}).hold.some((l) => l.id === "x"));
  const held = { days: [{ date: "2026-10-29", stops: [{ id: "z", locked: true, lockDay: true }, { id: "w", locked: true, lockDay: false }] }], notes: [{ kind: "lock", id: "z", text: "Locked to Thursday, but …" }, { kind: "lock", id: "w" }] };
  const shown = unhold(held, [{ id: "z", date: "2026-10-29", index: null }]);
  assert.deepEqual(shown.days[0].stops, [{ id: "z", locked: false, lockDay: false }, { id: "w", locked: true, lockDay: false }]);
  assert.deepEqual(shown.notes, [{ kind: "lock", id: "w" }]);
  assert.equal(unhold(held, []), held);
  // the offer: the first day that fits, the next day named full, Choose a day with it marked
  const o = lateOffer([{ i: 1, date: "2026-10-24", day: "saturday", ok: false }, { i: 2, date: "2026-10-29", day: "thursday", ok: true }]);
  assert.deepEqual(o, { to: { i: 2, day: "thursday" }, next: "saturday", choose: [{ i: 1, day: "saturday", date: "2026-10-24", full: true }, { i: 2, day: "thursday", date: "2026-10-29", full: false }], none: false });
  assert.deepEqual([LATE_WORDS.full(o.next), LATE_WORDS.move(2, o.to.day), LATE_WORDS.pick(o.choose[0])], ["Saturday is full.", "Move those 2 to Thursday", "Sat Oct 24 · full"]);
  assert.equal(lateOffer([{ i: 1, date: "2026-10-24", day: "saturday", ok: false }]).none, true);
  assert.equal(lateOffer([{ i: 1, date: "2026-10-24", day: "saturday", ok: true }]).next, null);
  assert.equal(LATE_WORDS.none(1), "No later day has room for it without pushing a planned door off.");
  assert.equal(LATE_WORDS.noDay(2), "No later day to move them to.");
  assert.equal(LATE_WORDS.skip(["Idle Hands"]), "Skip Idle Hands");
  assert.equal(LATE_WORDS.skip(["A", "B"]), "Skip A and B");
  assert.equal(LATE_WORDS.skip(["A", "B", "C"]), "Skip those 3");
  // the toast's cap line
  after.windows = [{ date: "2026-10-29", max: 2 }];
  assert.equal(overCapText(after, "2026-10-29"), "Thu Oct 29 now has 3 doors, 1 over your 2 a day.");
  assert.equal(overCapText(after, "2026-10-24"), "");
});

// Doors Agent spec §9: the day's facts as data, names redacted; the template renders from the same facts
test("dayFacts: every door of the day as data (status, result, follow-up, who redacted, said, notes, promises), plus not reached, tomorrow, open follow-ups", () => {
  const p = jardsDay();
  p.profile.pitch = { name: "Maya Ortiz" };
  p.outcomes.d = { result: "someone", who: "Sam (bar manager)", note: "Sam said I'll bring cans Thursday", at: "2026-10-23T14:40" };
  p.slots.d = [{ slot: "S4", field: "carry", value: "a sell sheet", by: "rep", at: "2026-10-23T14:41:00" }];
  for (const id of ["h", "i"]) delete p.statuses[id], delete p.outcomes[id];
  p.outcomes.y = { result: "followup", followUp: "2026-10-29", at: "2026-10-20T15:00" }; // an older visit's follow-up
  let r = { ...recordOf({}, "2026-10-23"), skipped: ["g"], ended: "2026-10-23T17:30" };
  r = withRemoved(r, "e", "later", "2026-10-23T15:00"); // Off today
  r = withRemoved(r, "i", "end", r.ended);
  p.days[0].stops = p.days[0].stops.filter((s) => !["e", "i"].includes(s.id));
  const q = driveQueue(p, 0);
  const f = dayFacts(p, q, r);
  assert.equal(f.v, 1);
  assert.deepEqual(f.totals, { planned: 8, visited: 6, notReached: 2, removed: 1 });
  const d = f.doors.find((x) => x.id === "d");
  assert.deepEqual([d.status, d.result, d.resultLabel, d.who, d.whoRole], ["visited", "someone", "Talked to someone else", "the contact", "bar manager"]);
  assert.equal(d.said, "the contact said I'll bring cans Thursday");
  assert.deepEqual(d.promises, [{ text: "a sell sheet", from: "remembered" }, { text: "the contact said I'll bring cans Thursday", from: "visit" }]);
  assert.doesNotMatch(JSON.stringify(f), /Sam|Maya|Ortiz/, "no contact's or rep's name");
  const c = f.doors.find((x) => x.id === "c");
  assert.deepEqual(c.followUp, { date: "2026-10-24", time: "15:30", onDay: "2026-10-24", stop: 3 });
  assert.equal(f.doors.find((x) => x.id === "g").skipped, true);
  assert.deepEqual(f.notReached.map((x) => [x.id, x.where.text]), [["h", "Not on a day"], ["i", "Not on a day"]]);
  assert.deepEqual(f.removed.map((x) => [x.id, x.reason]), [["e", "off today"]]);
  assert.deepEqual(f.tomorrow, { date: "2026-10-24", doors: 3, followUps: 1, first: [{ id: "x", name: "Room X", eta: "14:10", followUp: false }, { id: "y", name: "Room Y", eta: "14:50", followUp: false }, { id: "c", name: "Room C", eta: "15:30", followUp: true }] });
  assert.deepEqual(f.openFollowUps.map((x) => [x.id, x.date, x.fromToday]), [["c", "2026-10-24", true], ["b", "2026-10-28", true], ["y", "2026-10-29", false]]);
  assert.deepEqual(JSON.parse(JSON.stringify(f)), f, "JSON-safe");
  // the screen's model comes from the same facts, names kept
  const b = debrief(p, q, r);
  assert.equal(dayFacts(p, q, r, { redact: false }).doors.find((x) => x.id === "d").who, "Sam");
  assert.equal(b.rows.find((x) => x.id === "d").detail, "Talked to Sam (bar manager)");
  assert.equal(b.total, f.totals.planned);
  assert.deepEqual(b.removed.map((x) => x.id), ["e"]);
});

// mobile2 10-23 (dayflow2c): Wed had 9 doors, 3 rolled in, Wed showed 8: 4 of its own went somewhere, unsaid
test("End my day's roll: a door it pushes off the days ahead is said, with where it is now (never lost)", () => {
  const p = jardsDay();
  p.days.push({ date: "2026-10-29", day: "thursday", from: 840, to: 1020, stops: [stop("z", 860)] });
  p.venues.z = { id: "z", name: "Room Z" };
  // before: Sat x, y, c; g and h rolled onto Sat; x went to Thursday, y to no day
  const was = [["2026-10-24", ["x", "y", "c"]], ["2026-10-29", ["z"]]];
  p.days[1].stops = [stop("g", 850), stop("h", 880), stop("c", 930, { pinned: "followup" })];
  p.days[2].stops = [stop("z", 860), stop("x", 900)];
  const b = bumpedBy(p, was, ["g", "h"]);
  assert.deepEqual(b, [{ id: "x", from: "2026-10-24" }, { id: "y", from: "2026-10-24" }]);
  for (const id of ["g", "h"]) delete p.statuses[id], delete p.outcomes[id];
  p.days[0].stops = p.days[0].stops.filter((s) => !["g", "h"].includes(s.id));
  let r = { ...recordOf({}, "2026-10-23"), ended: "t", moved: [{ to: "2026-10-24", ids: ["h", "g"] }], bumped: b };
  for (const id of ["g", "h"]) r = withRemoved(r, id, "end", "t");
  const m = movedLine(p, r, "2026-10-23");
  assert.equal(m.body, "Room H, Room G. To make room on Sat Oct 24: Room X (now Thu Oct 29, stop 2), Room Y (not on a day).");
  const f = dayFacts(p, driveQueue(p, 0), r);
  assert.deepEqual(f.bumped.map((x) => [x.id, x.from, x.where.date]), [["x", "2026-10-24", "2026-10-29"], ["y", "2026-10-24", null]]);
  // Choose another day: the ones pushed off before stay said while still off their day; one back on it drops out
  p.days[1].stops.push(stop("y", 990));
  assert.deepEqual(bumpedBy(p, [["2026-10-29", ["z", "x"]]], ["g", "h"], b), [{ id: "x", from: "2026-10-24" }]);
});
