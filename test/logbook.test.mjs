// The Log book (round 4 item 10): the activity log written as the store is written, Save for later, the rows' status
// and next step, filters/search/sort, counts, the per-door timeline, CSV. Synthetic state and plan: no data files.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../public/lib/store.js";
import { makeNote } from "../public/lib/door-notes.js";
import { activityDiff, withActivity, loggingStore, withLater, logbookRows, filterRows, sortRows, logbookCounts, doorTimeline, planTimeline, logbookCSV, activityCSV, eventText, whenText, LOG_COLUMNS, ACTIVITY_CAP, STATUS_LABEL, LOGBOOK_LABEL } from "../public/lib/logbook.js";

const venues = {
  a: { id: "a", name: "Hi Hat", neighborhood: "East Austin", genre: "urn:tag:genre:place:bar", address: "1 Main St", phone: "(512) 555-0100" },
  b: { id: "b", name: "Nomadic", neighborhood: "South", genre: "urn:tag:genre:place:brewery", address: "2 Main St" },
  c: { id: "c", name: "Cosmic", neighborhood: "East Austin", genre: "urn:tag:genre:place:bar", address: "3 Main St" },
  d: { id: "d", name: "Lazarus", neighborhood: null, genre: "urn:tag:genre:place:brewery", address: "4 Main St" },
  e: { id: "e", name: "Zilker", neighborhood: "South", genre: "urn:tag:genre:place:bar", address: "5 Main St" },
};
const plan = {
  days: [
    { day: "monday", date: "2026-10-26", past: true, stops: [{ id: "a", eta: 840 }] },
    { day: "tuesday", date: "2026-10-27", past: false, stops: [{ id: "b", eta: 900 }, { id: "c", eta: 960 }] },
  ],
  venues, pool: { ids: ["a", "b", "c", "d", "e"], N: 5 }, statuses: {}, outcomes: {}, slots: {},
};
const TODAY = "2026-10-27";
let clock = 0;
const now = () => new Date(2026, 9, 27, 14, 0, clock++);

function fakeStorage() {
  const m = new Map();
  return { get length() { return m.size; }, key: (i) => [...m.keys()][i] ?? null, getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
const names = (id) => venues[id]?.name ?? null;

test("loggingStore: every change to a door lands in activity, with a time, a name and a number", () => {
  const store = loggingStore(createStore(fakeStorage()), { nameOf: names, now });
  store.save("Brand", "austin", { profile: { brand: "Brand" } });
  let st = store.setStatus("Brand", "austin", "a", "visited");
  st = store.setOutcome("Brand", "austin", "a", { result: "followup", followUp: "2026-10-29", who: "Sam", at: "2026-10-26T14:10:00" });
  st = store.update("Brand", "austin", (s) => withLater(s, "d", true, venues.d, "2026-10-27T14:00:05"));
  st = store.setSlots("Brand", "austin", "c", [makeNote({ text: "Ask for Maria on Thursdays", by: "rep", at: "2026-10-27T14:00:06.000Z" })]);
  st = store.update("Brand", "austin", { added: [{ id: "e", name: "Zilker", date: "2026-10-27" }], whyChanges: [{ id: "w1", text: "Days: Tue and Thu" }] });
  st = store.update("Brand", "austin", { plan: { days: [] } }); // a re-plan saves the plan: no event
  const kinds = st.activity.map((e) => e.kind);
  assert.deepEqual(kinds, ["status", "outcome", "saved", "note", "added", "change"]);
  assert.equal(st.activity[0].name, "Hi Hat");
  assert.equal(st.activity[0].to, "visited");
  assert.equal(st.activity[1].at, "2026-10-26T14:10:00"); // the outcome's own stamp (a visit logged on a preview day)
  assert.equal(st.activity[2].name, "Lazarus"); // from the saved venue, not the plan
  assert.match(st.activity[3].text, /Maria/);
  assert.deepEqual(st.activity.map((e) => e.seq), [1, 2, 3, 4, 5, 6]);
  assert.ok(st.activity.every((e) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(e.at)));
  assert.equal(st.activity[5].id, undefined); // a plan change has no door
  // Undo (the status cleared) is logged too, honestly
  st = store.setStatus("Brand", "austin", "a", null);
  assert.equal(eventText(st.activity.at(-1)), "Unmarked (was Visited)");
  // the store's own reads are untouched
  assert.equal(store.load("Brand", "austin").statuses.a, undefined);
});

test("activityDiff: nothing for a state never saved (a move or an import); drive records, locks, contacts, parked", () => {
  const base = { savedAt: "x", statuses: {}, outcomes: {} };
  assert.deepEqual(activityDiff({ statuses: {} }, { ...base, statuses: { a: "visited" } }), []);
  const next = { ...base, contacts: [{ id: "k", name: "Kay's" }], parked: ["b"], locks: [{ id: "c", date: "2026-10-27" }], drive: { "2026-10-27": { started: "2026-10-27T13:00", removed: [{ id: "b", how: "later", at: "2026-10-27T13:30:00" }], skipped: ["c"], changes: [{ kind: "stop", how: "list", at: "2026-10-27T15:00:00", ids: ["c"] }] } } };
  const ev = activityDiff(base, next, { at: "2026-10-27T15:00:00" });
  assert.deepEqual(ev.map((e) => [e.kind, e.id ?? null]), [["contact", "k"], ["parked", "b"], ["locked", "c"], ["offDay", "b"], ["skipped", "c"], ["dayChange", "c"], ["dayStarted", null]]);
  assert.equal(ev.find((e) => e.kind === "contact").name, "Kay's");
  assert.equal(eventText(ev[3]), "Taken off Tue Oct 27's route, to a later day");
  assert.equal(eventText(ev[5]), "Stopped for today (Tue Oct 27): put back on Your list");
  // the same again: nothing new
  assert.deepEqual(activityDiff(next, next), []);
  // a lock gone, a change undone
  const back = { ...next, locks: [], whyChanges: [] };
  assert.deepEqual(activityDiff({ ...next, whyChanges: [{ id: "w1", text: "Days: Tue" }] }, back).map((e) => e.kind), ["unlocked", "changeUndone"]);
});

test("withActivity caps the log and keeps numbering", () => {
  const st = withActivity({ activity: Array.from({ length: ACTIVITY_CAP }, (_, i) => ({ seq: i + 1, at: "x", kind: "status" })) }, [{ at: "y", kind: "saved", id: "a" }]);
  assert.equal(st.activity.length, ACTIVITY_CAP);
  assert.equal(st.activity.at(-1).seq, ACTIVITY_CAP + 1);
  assert.equal(st.activity[0].seq, 2);
});

test("withLater: on keeps enough of the venue; off drops it", () => {
  const st = withLater({ statuses: {} }, "a", true, venues.a, "2026-10-27T14:00:00");
  assert.deepEqual(st.later.a.venue, { id: "a", name: "Hi Hat", address: "1 Main St", neighborhood: "East Austin", genre: "urn:tag:genre:place:bar", lat: undefined, lon: undefined, phone: "(512) 555-0100", website: "" });
  assert.deepEqual(withLater(st, "a", false).later, {});
});

const state = () => ({
  savedAt: "x",
  statuses: { a: "visited", d: "notfit" },
  outcomes: { a: { result: "followup", followUp: "2026-10-26", who: "Sam", at: "2026-10-26T14:10:00" } },
  later: { e: { at: "2026-10-27T09:00:00", venue: { id: "e", name: "Zilker" } }, b: { at: "2026-10-27T09:01:00", venue: null } },
  slots: { c: [makeNote({ text: "Ask for Maria", by: "rep", at: "2026-10-27T13:00:00.000Z" })] },
  activity: [
    { seq: 1, at: "2026-10-26T14:10:00", kind: "status", id: "a", to: "visited", from: null },
    { seq: 2, at: "2026-10-26T14:10:00", kind: "outcome", id: "a", result: "followup", followUp: "2026-10-26", who: "Sam" },
    { seq: 3, at: "2026-10-27T09:00:00", kind: "saved", id: "e" },
    { seq: 4, at: "2026-10-27T09:01:00", kind: "saved", id: "b" },
    { seq: 5, at: "2026-10-27T10:00:00", kind: "change", text: "Days: Tue and Thu" },
    { seq: 6, at: "2026-10-27T13:00:00", kind: "note", id: "c", text: "Ask for Maria", by: "rep" },
    { seq: 7, at: "2026-10-27T13:30:00", kind: "status", id: "d", to: "notfit", from: null },
  ],
});

test("logbookRows: one status per door, the day it's on, the last activity and the next step", () => {
  const rows = logbookRows({ state: state(), plan, today: TODAY });
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.deepEqual(Object.keys(by).sort(), ["a", "b", "c", "d", "e"]);
  assert.equal(by.a.status, "due"); // follow-up 10-26 is past today
  assert.equal(by.a.label, "Follow-up due");
  assert.equal(by.a.next, "Follow up now: it was due Mon Oct 26");
  assert.equal(by.a.who, "Sam");
  assert.equal(by.a.lastText, "Visited · Follow up Mon Oct 26 · talked to Sam"); // the visit and its outcome, one line
  assert.equal(by.b.status, "scheduled"); // saved for later but on a day: the day wins, the saved tag stays
  assert.equal(by.b.saved, true);
  assert.equal(by.b.next, "Tuesday · stop 1 · 3:00 pm");
  assert.equal(by.c.status, "scheduled");
  assert.equal(by.c.notes.length, 1);
  assert.equal(by.d.status, "notfit");
  assert.equal(by.d.next, "");
  assert.equal(by.e.status, "saved");
  assert.equal(by.e.next, "Put it on a day");
  assert.equal(by.e.hood, "South");
  assert.equal(by.e.genre, "Bar");
  assert.equal(by.a.rank, 1);
  // a door no longer anywhere keeps the name its event had
  const gone = logbookRows({ state: { statuses: { zz: "visited" }, activity: [{ seq: 1, at: "2026-10-27T10:00:00", kind: "status", id: "zz", to: "visited", name: "Old Door" }] }, plan: null, today: TODAY });
  assert.equal(gone[0].name, "Old Door");
  assert.equal(gone[0].status, "visited");
  assert.equal(gone[0].label, STATUS_LABEL.visited);
});

test("filter, search and sort", () => {
  const rows = logbookRows({ state: state(), plan, today: TODAY });
  assert.deepEqual(filterRows(rows, { status: ["saved"] }).map((r) => r.id).sort(), ["b", "e"]); // saved: the tag, not only the status
  assert.deepEqual(filterRows(rows, { status: ["due"] }).map((r) => r.id), ["a"]);
  assert.deepEqual(filterRows(rows, { status: ["visited"] }).map((r) => r.id), ["a"]); // Visited takes every outcome
  assert.deepEqual(filterRows(rows, { hood: "East Austin" }).map((r) => r.id).sort(), ["a", "c"]);
  assert.deepEqual(filterRows(rows, { q: "maria" }).map((r) => r.id), ["c"]); // notes are searched
  assert.deepEqual(filterRows(rows, { q: "sam" }).map((r) => r.id), ["a"]); // who they talked to
  assert.deepEqual(filterRows(rows, { q: "zil" }).map((r) => r.id), ["e"]);
  assert.deepEqual(sortRows(rows, "recent").map((r) => r.id), ["d", "c", "b", "e", "a"]);
  assert.deepEqual(sortRows(rows, "name").map((r) => r.id), ["c", "a", "d", "b", "e"]);
  assert.deepEqual(sortRows(rows, "day").map((r) => r.id).slice(0, 3), ["a", "b", "c"]);
  assert.deepEqual(sortRows(rows, "status").map((r) => r.id).slice(0, 3), ["a", "c", "b"]); // scheduled ties: newest activity first
  assert.deepEqual(sortRows(rows, "followUp").map((r) => r.id)[0], "a");
});

test("counts: visited this week, follow-ups due, scheduled, saved, by outcome and neighbourhood", () => {
  const rows = logbookRows({ state: state(), plan, today: TODAY });
  const c = logbookCounts(rows, { state: state(), today: TODAY });
  assert.deepEqual(c.week, { from: "2026-10-26", to: "2026-11-01" });
  assert.equal(c.doors, 5);
  assert.equal(c.visited, 1);
  assert.equal(c.visitedWeek, 1);
  assert.equal(c.due, 1);
  assert.equal(c.scheduled, 2);
  assert.equal(c.saved, 2);
  assert.equal(c.notes, 1);
  assert.deepEqual(c.byOutcome, [{ key: "followup", label: "Follow up booked", n: 1 }]);
  assert.deepEqual(c.byHood, [{ hood: "East Austin", n: 2 }, { hood: "South", n: 2 }]);
  // a visit last week doesn't count as this week's
  const old = state();
  old.outcomes.a.at = "2026-10-19T14:10:00";
  old.activity = old.activity.map((e) => (e.id === "a" ? { ...e, at: "2026-10-19T14:10:00" } : e));
  assert.equal(logbookCounts(logbookRows({ state: old, plan, today: TODAY }), { state: old, today: TODAY }).visitedWeek, 0);
});

test("timelines: a door's, newest first, and the plan's", () => {
  const tl = doorTimeline(state().activity, "a");
  assert.equal(tl.length, 1);
  assert.equal(tl[0].text, "Visited · Follow up Mon Oct 26 · talked to Sam");
  assert.equal(tl[0].when, "Mon Oct 26, 2:10 pm");
  const pt = planTimeline(state().activity);
  assert.deepEqual(pt.map((e) => e.text), ["Days: Tue and Thu"]);
  assert.equal(whenText("2026-10-27"), "Tue Oct 27");
  assert.equal(whenText(""), "");
});

test("CSV: one row per door, formula guard, quoting, a footer line; the activity as CSV", () => {
  const rows = sortRows(logbookRows({ state: state(), plan, today: TODAY }), "name");
  const csv = logbookCSV(rows, { brand: "Brand", city: "Austin", today: TODAY });
  const lines = csv.split("\r\n");
  assert.equal(lines[0], LOG_COLUMNS.join(","));
  assert.equal(lines.length, 1 + 5 + 2);
  assert.match(lines[2], /^Hi Hat,Follow-up due,Follow up now: it was due Mon Oct 26,Monday,2026-10-26,1,/);
  assert.match(lines[2], /,Follow up,2026-10-26,Sam,,,East Austin,Bar,1 Main St,\(512\) 555-0100,1,a$/);
  assert.match(lines[1], /^Cosmic,Scheduled,Tuesday · stop 2 · 4:00 pm,/);
  assert.match(lines[1], /You: Ask for Maria/);
  assert.match(lines[5], /^Zilker,Saved for later,Put it on a day,,,,Saved for later,2026-10-27T09:00:00,,,,,yes,South,Bar,5 Main St,,5,e$/);
  assert.equal(lines.at(-1), `${LOGBOOK_LABEL},Brand,Austin,2026-10-27,Saved on this device only.`);
  const guarded = logbookCSV([{ ...rows[0], name: "=HYPERLINK()", notes: [], next: "" }]);
  assert.match(guarded.split("\r\n")[1], /^'=HYPERLINK\(\)/);
  const act = activityCSV(state().activity, { nameOf: (id) => venues[id]?.name ?? null }).split("\r\n");
  assert.equal(act[0], "at,door,event,details,door_id");
  assert.equal(act[1], "2026-10-27T13:30:00,Lazarus,Status,Marked Not a fit,d");
  assert.equal(act.at(-1), "2026-10-26T14:10:00,Hi Hat,Status,Visited,a");
  assert.equal(act.find((l) => /Days: Tue/.test(l)), "2026-10-27T10:00:00,,Change,Days: Tue and Thu,");
});
