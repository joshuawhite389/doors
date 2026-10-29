// R2 (Diolosa) planner bars, F4: pins land when open (H1), reasons are true (M1), no starved days (M2), no crossings
// from a re-plan's take-back. scripts/sweep2.mjs re-derives every timing from the shipped files; the full run
// (10 marks a plan) is `node scripts/sweep2.mjs`; here 2 marks a plan keep `npm test` quick.
import test from "node:test";
import assert from "node:assert/strict";
import { sweep2 } from "../scripts/sweep2.mjs";
import { planDays } from "../public/lib/schedule.js";
import { buildPool, windowsFor } from "../public/lib/pool.js";
import { defaultRooms } from "../public/lib/profile.js";
import { readJson } from "./helpers.mjs";

const s = sweep2({ marks: 2 });

// H1 (routing overhaul): leg caps are no rule, so softLegs / firstLegs are reported, not barred
test(`R2 sweep: ${s.plans} plans, ${s.days} days, ${s.stops} stops: every timing, wait and end slack checks out (legs over the old caps: ${s.softLegs.length} between doors, ${s.firstLegs.length} first)`, () => {
  assert.deepEqual(s.problems, []);
  assert.deepEqual(s.noReason, []);
  assert.deepEqual(s.carriedLost, []);
  assert.deepEqual(s.repaired, [], "the planner's last-resort trim never fires");
});
test(`H1: 0 contacts open and reachable alone left off (${s.contactPlaced} placed, ${s.contactUnplaced} closed at every window)`, () => {
  assert.deepEqual(s.contactReachableUnplaced, []);
});
test(`H1: 0 follow-ups missed on a day their room is open (${s.fuPlacedOnDate} of ${s.fu} on their date; ${s.fuMissing.length} closed that day)`, () => {
  assert.deepEqual(s.fuMissedOpen, []);
});
// H1: "route" ("doubling back") is no longer a reason (crossing is no rule); every reason is a time one
// K1: "detour" is back, as the driving rule ("adds 22 min of driving to Wednesday"), checked below with its number
test(`H1: no reason names a shape rule (${Object.entries(s.reasonCodes).map(([k, n]) => `${k} ${n}`).join(", ")})`, () => {
  for (const code of ["route", "far", "hours-clash"]) assert.equal(s.reasonCodes[code] ?? 0, 0, code);
});
// K1 (driving first) supersedes M2's "≤ 2% of default-week days have ≤ 2 doors": a day is thin when the rooms near its
// loop are taken or too far. The goal now: no thin day leaves off a free room that fits it within DOOR_MIN of its loop.
test(`M2/K1: no thin default-week day leaves off a room that fits it within DOOR_MIN of its loop (${s.thinDays.length} of ${s.weekDays} days have ≤ 2 doors)`, () => {
  assert.deepEqual(s.thinMissed, []);
});
// L3 (≤ 1% of re-planned days cross) is retired with H1: a crossing costs only its driving minutes now.

const route = (b, c) => readJson(`public/data/routes/${b}-${c}.json`);
const index = readJson("public/data/index.json");
const profileFor = (b, c, windows) => {
  const r = route(b, c);
  const city = index.cities.find((x) => x.key === c);
  return { r, city, profile: { what: r.drinker.category, rooms: defaultRooms(r.drinker.category), drinks: [{ key: b, name: r.drinker.name, ready: true }], start: { lat: city.center[0], lon: city.center[1] }, windows, visitMin: 25, known: [] } };
};
const WEEK = ["12", "13", "14", "15", "16"].map((d) => ({ date: `2026-10-${d}`, from: "14:00", to: "18:00" }));

test("H1 repro: the Trap Room contact (opens 4 pm Wed–Fri, 1.1 km from the start) is on the plan, and the day leaves later for it if need be", () => {
  const { r, city, profile } = profileFor("casamigos", "omaha", WEEK);
  let ct = null;
  for (const b of index.brands) {
    const v = Object.entries(route(b.key, "omaha").venues).find(([, x]) => x.name === "The Trap Room");
    if (v) ct = { ...v[1], id: v[0], source: "qloo" };
    if (ct) break;
  }
  const pool = buildPool({ routes: [r], profile, contacts: [ct], cityName: city.name });
  const plan = planDays({ pool: pool.rows, statuses: pool.statuses, windows: windowsFor(profile), visitMin: 25, pinned: pool.pinned });
  const d = plan.days.find((x) => x.stops.some((st) => st.id === ct.id));
  assert.equal(d?.day, "wednesday");
  assert.ok(!plan.notes.some((n) => /contact/.test(n.kind) && n.kind.endsWith("unscheduled")));
});

test("H1 repro: a follow-up on a Thursday 10–8 whose room is open 9 h lands on Thursday; the note says so", () => {
  const MIXED = [{ date: "2026-10-13", from: "11:00", to: "14:00" }, { date: "2026-10-14", from: "17:00", to: "22:00" }, { date: "2026-10-15", from: "10:00", to: "20:00" }];
  const { r, city, profile } = profileFor("casamigos", "omaha", MIXED);
  const statuses = {};
  r.lists.all.slice(1, 30).forEach((x, i) => { if (i % 7 === 3) statuses[x[0]] = ["visited", "talked", "notfit"][i % 3]; });
  const pool = buildPool({ routes: [r], profile, statuses, cityName: city.name });
  const ws = windowsFor(profile);
  const plan = planDays({ pool: pool.rows, statuses: pool.statuses, windows: ws, visitMin: 25, pinned: [] });
  const d0 = plan.days.find((d) => d.stops.length);
  const id = d0.stops[0].id;
  const pool2 = buildPool({ routes: [r], profile, statuses: { ...pool.statuses, [id]: "visited" }, outcomes: { [id]: { result: "interested", followUp: "2026-10-15" } }, cityName: city.name });
  const p2 = planDays({ pool: pool2.rows, statuses: pool2.statuses, windows: ws, visitMin: 25, pinned: pool2.pinned, frozen: { date: d0.date, from: d0.from, ids: d0.stops.map((x) => x.id) }, previous: plan });
  assert.ok(p2.days.at(-1).stops.some((x) => x.id === id && x.pinned === "followup"));
  assert.ok(p2.notes.some((n) => n.id === id && n.text === "Follow-up visit on Thu Oct 15."));
});

test("H1: an unplaced pin's note gives the true reason (its hours at the windows it is due in), never 'open at none of them, or the days are full'", () => {
  // (any hours reason at the windows it is due in: closed that day, or opening or closing outside the window)
  for (const n of [...s.fuMissing]) assert.match(n, /is not on the plan: it (is closed \w+day|opens .+, after your windows?|closes .+, before your windows?|is open less than a visit .+)\./);
});

test("M2 repro: Diolosa's R1 Austin profile (Tidewell, Mon–Fri 2–6) has ≥ 5 doors every day", () => {
  const prof = readJson("test/fixtures/r2-austin-profile.json");
  const pool = buildPool({ routes: [route("athletic-brewing", "austin")], profile: prof, cityName: "Austin" });
  const plan = planDays({ pool: pool.rows, statuses: pool.statuses, windows: windowsFor(prof), visitMin: prof.visitMin, pinned: pool.pinned });
  for (const d of plan.days) {
    assert.ok(d.stops.length >= 5, `${d.day}: ${d.stops.length} doors`);
    assert.ok(d.leave >= d.from && d.end <= d.to - 5);
  }
});

test("M1 repro: don-julio-austin Mon–Fri: no reason names a full day when that day ends before 3 pm", () => {
  const { r, city, profile } = profileFor("don-julio", "austin", WEEK);
  const pool = buildPool({ routes: [r], profile, cityName: city.name });
  const plan = planDays({ pool: pool.rows, statuses: pool.statuses, windows: windowsFor(profile), visitMin: 25, pinned: [] });
  const ends = Object.fromEntries(plan.days.map((d) => [d.date, d.end]));
  for (const why of Object.values(plan.reasons)) if (why.code === "full") assert.ok(ends[why.date] >= 15 * 60, `${why.text} but it ends at ${ends[why.date]}`);
});

test(`R2 Calacanis 2: every bottom-quarter stop on a planned day says why it's there (${s.lowStops} stops, ${s.lowNoReason.length} without)`, () => {
  assert.deepEqual(s.lowNoReason, []);
});
// H1: "<day> had no time left for it" on a day holding lower-ranked doors says ", even in place of a lower-ranked stop"
// K1 supersedes "<day> was full … even in place of a lower-ranked stop" (rank no longer decides): the time and driving
// reasons are checked against this sweep's own timing instead
test(`K1: "<day> had no time left for it" and "adds N min of driving to <day>" are true (${s.reasonFalse.length} false)`, () => {
  assert.deepEqual(s.reasonFalse, []);
});
