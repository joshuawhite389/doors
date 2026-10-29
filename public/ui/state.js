// The plan seam for the other UI slices (B2 route animation, C1 stop panel, C2 demo). plan.js is the only writer.
//
// Read
//   getPlan()        → the current plan, or null before one is built:
//                      schedule.planDays output {days, unscheduled, carried, notes}
//                      + {venues: id → venue, pool: {ids, N, label, drinker}, statuses: {id: status} (effective, incl. "Doors
//                        you already know"), outcomes: {id: outcome}, profile, city: {key, name}, source: "ors" |
//                        "estimate" | "mixed", windows (the planner's)}
//   getSelectedDay() → an index into plan.days, "week" or "rest" (the Not scheduled tab)
//   getMap()         → the plan view's MapLibre map, or null
//   onPlanChange(fn) → fn(plan, selectedDay) after every re-plan and tab change; returns an unsubscribe function
// Act (plan.js registers these; they save, re-plan and redraw)
//   setStatus(id, "visited" | "talked" | "notfit" | null)   null = Undo
//   setOutcome(id, {result, note?, followUp?: "YYYY-MM-DD"} | null)   a followUp pins the door to that date (§6.5)
//   selectDay(index | "week" | "rest")
//   removeDoor(id)            Jard 10-24: Remove from my plan, no reason asked (see removeDoor below)
//   addDoor(venue, {date?})   owner review 2 (G3): put a room on the plan. venue = a ranked room (plan.venues[id]) or any
//                             Qloo record (a sister room, a map pick); date = that day, or null = the planner picks the
//                             best day it fits. Saved like a contact, labelled "Added by you"; a room no day can hold
//                             is not saved at all (Jard 10-24: the toast says why).
//   setLock(id, on)           owner review 2 (G4): a locked stop keeps its day and its place in that day's order;
//                             unlocked stops re-plan around it. Dragging a stop locks it.
//   moveStop(id, {day, index}) owner review 2 (G4): drag-and-drop: move a stop to position `index` (0-based) of day
//                             `day` (an index into plan.days) and lock it there.
// Window events
//   "doors:run-route" {day, date, map}   Run the route was pressed (B2 plays it)
//   "doors:open-stop" {id, day}          a stop row was opened (C1 shows the stop)
let plan = null;
let selected = 0;
let map = null;
let actions = {};
const fns = new Set();

export const getPlan = () => plan;
export const getSelectedDay = () => selected;
export const getMap = () => map;
export function onPlanChange(fn) {
  fns.add(fn);
  return () => fns.delete(fn);
}

const emit = () => fns.forEach((fn) => { try { fn(plan, selected); } catch (e) { console.error(e); } });

// ---- writers: plan.js only ----
export function setPlan(p) {
  plan = p;
  emit();
}
export function setSelected(d) {
  selected = d;
  emit();
}
export function setMap(m) {
  map = m;
}
export function register(a) {
  actions = a ?? {};
}

export const setStatus = (id, status) => actions.setStatus?.(id, status);
export const setOutcome = (id, outcome) => actions.setOutcome?.(id, outcome);
export const selectDay = (d) => actions.selectDay?.(d);
export const addDoor = (venue, opts = {}) => actions.addDoor?.(venue, opts);
export const setLock = (id, on) => actions.setLock?.(id, on);
export const moveStop = (id, to) => actions.moveStop?.(id, to);
// skipStop(id): drive mode's "Skip for now": the door to the end of its day, nothing else taken off (plan.js)
export const skipStop = (id) => actions.skipStop?.(id);
// the day flow (Jard 10-23): the day's drive record, a door off its day for good, End my day (lib/day-debrief.js)
export const setDrive = (date, patch) => actions.setDrive?.(date, patch);
export const removeStop = (id, o) => actions.removeStop?.(id, o) ?? false;
// removeDoor(id): Remove from my plan (Jard 10-24), no reason asked: an added room un-added, a door on a day marked
// "removed" (the planner leaves it off; Undo on Your list and in Changes you made)
export const removeDoor = (id) => actions.removeDoor?.(id) ?? false;
export const endDay = (date, o) => actions.endDay?.(date, o) ?? false;
// skipDoors(date, ids, {at}): running late's Skip: off that day's route, back on Your list, no lock (plan.js)
export const skipDoors = (date, ids, o) => actions.skipDoors?.(date, ids, o) ?? false;
// rollDay(date, to): End my day's doors from `date` to plan day `to` instead ("Choose another day")
export const rollDay = (date, to) => actions.rollDay?.(date, to) ?? false;
// running late (plan.js): lateFits(k, ids) → [{i, date, day, ok}] (a dry run per later day; null when the plan changed
// under it); moveLate(k, ids, i) → true, or false when it would push a door off (undone)
export const lateFits = (k, ids) => actions.lateFits?.(k, ids) ?? null;
export const moveLate = (k, ids, i) => actions.moveLate?.(k, ids, i) ?? false;
// Stop for today (lib/day-stop.js): endDay(date, {ids, at, how: "days" | "list"}) above; lateRehome(date, ids, how, {at,
// by}) gives running late's doors the same two choices → the ids off today, or false; undoDayChange(date) undoes the
// day's newest one (Changes you made, Resume my day) → {ids, change} | false
export const lateRehome = (date, ids, how, o) => actions.lateRehome?.(date, ids, how, o) ?? false;
export const undoDayChange = (date) => actions.undoDayChange?.(date) ?? false;
// editTo(): the plan's Edit profile link (Day done's "Add a day" when no later day is on the plan)
export const editTo = () => actions.editTo?.() ?? "";
// R9 (docs/CULTURAL-SLOTS.md): setSlot(id, slotRecord) adds a slot record; setSlot(id, {clear: field}) drops one
export const setSlot = (id, rec) => actions.setSlot?.(id, rec);
// Log book (round 4 item 10): setLater(id, on) saves a door for later / takes it off; plan.later holds the set
export const setLater = (id, on) => actions.setLater?.(id, on) ?? false;
// ---- R9 chat agent: docs/CONTRACTS-R9.md §2.2 ----
//   setTalk(id, {section, op, index, text, by} | {clear: true})   a talking-point edit, kept for the door (no re-plan)
//   agentReplan({skip, endBy, maxDoors, lock, add, day})          one re-plan with one Undo → the toast text, or null
export const setTalk = (id, edit) => actions.setTalk?.(id, edit);
// drive mode's exact Undo (plan.js registers snapshot/restore): exported here so S.snapshot() reaches it
export const snapshot = () => actions.snapshot?.() ?? null;
export const restore = (b) => actions.restore?.(b);
export const agentReplan = (a, out) => actions.agentReplan?.(a, out); // out: the change chip's {undo, said} (ui/agent.js)
// whatIfFirst(id) → the day with that stop at its top, planned on a scratch copy (nothing saved): what the move costs
export const whatIfFirst = (id) => actions.whatIfFirst?.(id) ?? null;
// ---- end R9 chat agent ----
export const can = (name) => typeof actions[name] === "function"; // a slice not merged yet: hide its button
