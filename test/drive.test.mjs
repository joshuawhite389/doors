// K1: driving first (owner review 5, docs/ROUTING-V3.md "V4"). Each day is a loop back to its start; a room goes on the
// day whose loop passes nearest; a room left off for its distance says how much driving it would add.
// V4 (routing "v4", kept by flag): a door goes on a day only when it adds at most DOOR_MIN minutes to that loop; rank
// decides between near-equal options (the whole range worth RANK_MIN minutes).
// V4.1 (the default, the owner's choice 2026-10-22): a door is worth DOOR_MIN + RANK_V × v(rank) minutes of loop, v
// top-heavy (rankCurve), so a top room is worth a real detour and a low one about DOOR_MIN.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHours } from "../public/lib/core.js";
import { planDays, estimateTravel, DOOR_MIN, RANK_MIN, RANK_V, RANK_K, rankCurve } from "../public/lib/schedule.js";

const START = { lat: 30.2556, lon: -97.7208 };
const H = (h) => h * 60;
const TUE = { date: "2026-10-13", day: "tuesday", from: H(13), to: H(17), start: START };
const WED = { date: "2026-10-14", day: "wednesday", from: H(13), to: H(17), start: START };
// a room dLat/dLon degrees from the start, hours unknown (open whenever)
const room = (id, rank, dLat, dLon = 0) => ({ id, rank, lat: START.lat + dLat, lon: START.lon + dLon, parsedHours: parseHours(null) });
const min = (a, b) => (estimateTravel(a, b).min > 0 ? Math.max(1, Math.round(estimateTravel(a, b).min)) : 0); // as the planner rounds a leg
const loop = (seq) => seq.reduce((s, r, i) => s + min(i ? seq[i - 1] : START, r), 0) + (seq.length ? min(seq.at(-1), START) : 0);
const plan41 = (pool, over = {}) => planDays({ pool, windows: [TUE], visitMin: 25, travel: estimateTravel, ...over });
// V4's own rules, by its flag
const plan = (pool, over = {}) => plan41(pool, { routing: "v4", ...over });
const worth = (rank) => DOOR_MIN + RANK_V * rankCurve(rank);
const ids = (p, k = 0) => p.days[k].stops.map((s) => s.id);

test("DOOR_MIN is 15", () => assert.equal(DOOR_MIN, 15));

test("V4: a room 15 min out and back is not added; one whose loop adds 15 or less is", () => {
  // (the far room is the worse ranked: a much better one may be worth up to RANK_MIN more, see below)
  const far = room("far", 2, 0.048); // ~15 min out: 30 min there and back
  const near = room("near", 1, 0.022); // ~7 min out: 14 there and back
  assert.equal(min(START, far), 15);
  assert.ok(loop([near]) <= DOOR_MIN && loop([far]) > DOOR_MIN, `${loop([near])} / ${loop([far])}`);
  const p = plan([far, near]);
  assert.deepEqual(ids(p), ["near"]);
  assert.equal(p.reasons.far.code, "detour");
  const add = loop([near, far]) - loop([near]);
  assert.ok(add > DOOR_MIN);
  assert.match(p.reasons.far.text, /^adds \d+ min of driving to the day$/);
  assert.ok(Number(p.reasons.far.text.match(/\d+/)[0]) > DOOR_MIN, p.reasons.far.text);
});

test("V4: a room on the way home is added, though alone it would cost more than a door is worth", () => {
  const out = room("out", 5, 0.064); // the rep's own contact, ~20 min out
  const way = room("way", 9, 0.032); // half way: alone it is a 20-min loop
  assert.ok(loop([way]) > DOOR_MIN);
  assert.deepEqual(ids(plan([way])), []);
  const p = plan([out, way], { pinned: [{ id: "out", kind: "contact" }] });
  assert.deepEqual(ids(p).sort(), ["out", "way"]);
});

test("a room goes on the day whose loop passes nearest", () => {
  // Tuesday's own contact is north, Wednesday's east; the room sits by the east one
  const north = room("north", 1, 0.06);
  const east = room("east", 2, 0, 0.07);
  const byEast = room("byEast", 3, 0.008, 0.066);
  const pool = [north, east, byEast];
  const pinned = [{ id: "north", kind: "contact", date: TUE.date }, { id: "east", kind: "contact", date: WED.date }];
  const p = planDays({ pool, windows: [TUE, WED], visitMin: 25, travel: estimateTravel, pinned });
  assert.deepEqual(ids(p, 0), ["north"]);
  assert.deepEqual(ids(p, 1).sort(), ["byEast", "east"]);
});

// RANK_MIN (the owner's pick: 10): the whole rank range, #1 to the last, is worth 10 min of loop driving
test("V4: rank decides between near-equal options only: equal loops → the better rank; more than RANK_MIN longer → the nearer", () => {
  assert.equal(RANK_MIN, 10);
  const n = room("n", 9, 0.01);
  const s = room("s", 2, -0.01);
  assert.equal(loop([n]), loop([s]));
  assert.deepEqual(ids(plan([n, s], { windows: [{ ...TUE, max: 1 }] })), ["s"]);
  const best = room("best", 1, 0.0322); // #1, ~10 min out
  const worst = room("worst", 40, -0.012); // the last, ~4 min out
  assert.ok(loop([best]) - loop([worst]) > RANK_MIN, `${loop([best])} vs ${loop([worst])}`);
  assert.deepEqual(ids(plan([best, worst], { windows: [{ ...TUE, max: 1 }] })), ["worst"]);
});

test("V4: a much better-ranked room within RANK_MIN more driving beats a nearer poor one", () => {
  const best = room("best", 1, 0.0225); // #1, ~7 min out
  const worst = room("worst", 40, -0.012); // the last, ~4 min out
  const more = loop([best]) - loop([worst]);
  assert.ok(more >= 4 && more < RANK_MIN, `${loop([best])} vs ${loop([worst])}`);
  assert.deepEqual(ids(plan([best, worst], { windows: [{ ...TUE, max: 1 }] })), ["best"]);
});

// ---------- V4.1 (the default) ----------
test("V4.1: RANK_V 45 on a top-heavy curve, k 15: #1 is worth 60 min of loop, #2 57, #10 43, #40 28", () => {
  assert.equal(RANK_V, 45);
  assert.equal(RANK_K, 15);
  assert.deepEqual([1, 2, 10, 40].map((r) => Math.round(worth(r))), [60, 57, 43, 28]);
  assert.equal(rankCurve(null), 0);
});

test("V4.1: a room goes on when its loop costs less than its worth: #2 at 30 min there and back is; #40 at 30 is not, and says why", () => {
  const top = room("top", 2, 0.048); // ~15 min out: a 30-min loop
  assert.equal(loop([top]), 30);
  assert.ok(loop([top]) < worth(2));
  assert.deepEqual(ids(plan41([top])), ["top"]);
  const low = room("low", 40, 0.048);
  assert.ok(loop([low]) > worth(40));
  const p = plan41([low]);
  assert.deepEqual(ids(p), []);
  assert.equal(p.reasons.low.code, "detour");
  assert.match(p.reasons.low.text, /^adds 30 min of driving to the day$/);
});

test("V4.1: a room on the way home is added, though alone it would cost more than it is worth", () => {
  const out = room("out", 50, 0.096); // the rep's own contact, ~30 min out
  const way = room("way", 40, 0.048); // half way: alone a 30-min loop, worth 27.5
  assert.ok(loop([way]) > worth(40));
  assert.deepEqual(ids(plan41([way])), []);
  const p = plan41([out, way], { pinned: [{ id: "out", kind: "contact" }] });
  assert.deepEqual(ids(p).sort(), ["out", "way"]);
});

test("V4.1: rank weighs as the curve says: equal loops → the better rank; #1 beats the last for up to its worth more driving, not more", () => {
  const n = room("n", 9, 0.01);
  const s = room("s", 2, -0.01);
  assert.deepEqual(ids(plan41([n, s], { windows: [{ ...TUE, max: 1 }] })), ["s"]);
  const best = room("best", 1, 0.0322); // #1, ~10 min out
  const worst = room("worst", 40, -0.012); // ~4 min out
  const more = loop([best]) - loop([worst]);
  assert.ok(more > RANK_MIN && more < worth(1) - worth(40), `${more}`); // V4 took the nearer here (above)
  assert.deepEqual(ids(plan41([best, worst], { windows: [{ ...TUE, max: 1 }] })), ["best"]);
  const far = room("far", 1, 0.0966); // #1, ~30 min out: a 60-min loop, past its edge over the last
  assert.ok(loop([far]) - loop([worst]) > worth(1) - worth(40), `${loop([far])}`);
  assert.deepEqual(ids(plan41([far, worst], { windows: [{ ...TUE, max: 1 }] })), ["worst"]);
});

test("V4.1 uses the room's place in the raw Qloo list (rawRank) when it has one", () => {
  // two rooms the same distance: the one ranked #3 after the Rooms filter but #30 raw is worth less than a raw #5
  const a = { ...room("a", 3, 0.01), rawRank: 30 };
  const b = { ...room("b", 4, -0.01), rawRank: 5 };
  assert.deepEqual(ids(plan41([a, b], { windows: [{ ...TUE, max: 1 }] })), ["b"]);
  assert.deepEqual(ids(plan([a, b], { windows: [{ ...TUE, max: 1 }] })), ["a"], "V4 reads the filtered rank");
});
