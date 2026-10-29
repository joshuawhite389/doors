// Road times for the planner: /api/matrix answer → schedule.matrixTravel, per-day candidate sets, the estimate
// fallback, and the honest label.
import { test } from "node:test";
import assert from "node:assert/strict";
import { matrixData, combineTravel, candidateSets, planOnRoads, travelSource, travelLabel, MATRIX_MAX } from "../public/lib/travel.js";
import { planDays, estimateTravel } from "../public/lib/schedule.js";
import { buildPool, windowsFor } from "../public/lib/pool.js";
import { parseMatrix, estimateMatrix } from "../src/ors.js";
import { readJson, route } from "./helpers.mjs";

// The fixture's three Austin points: Nomadic Beerworks → The Yard → Pinthouse Brewing.
const raw = readJson("test/fixtures/ors/matrix.json");
const points = raw.sources.map((s, i) => ({ id: ["nomadic", "yard", "pinthouse"][i], lon: s.location[0], lat: s.location[1] }));
const coords = points.map((p) => [p.lon, p.lat]);

test("matrix → matrixTravel: road minutes and miles by id, unroutable cells fall back to the labelled estimate", () => {
  const resp = parseMatrix(raw, coords); // what /api/matrix answers
  const travel = combineTravel([matrixData(resp, points)]);
  const t = travel(points[0], points[1]);
  assert.equal(t.source, "ors");
  assert.equal(t.min, Math.round((182.6 / 60) * 10) / 10);
  assert.equal(t.mi, Math.round((1215.4 / 1609.344) * 10) / 10);
  const back = travel(points[2], points[1]); // null in the fixture
  assert.equal(back.source, "estimate");
  assert.deepEqual(back, estimateTravel(points[2], points[1]));
  const other = travel(points[0], { id: "elsewhere", lat: 30.3, lon: -97.7 });
  assert.equal(other.source, "estimate", "a point outside the matrix is estimated");
});

test("an estimate answer (no key, limits, ?ors=off) gives no matrix", () => {
  assert.equal(matrixData(estimateMatrix(coords), points), null);
  assert.equal(matrixData(null, points), null);
});

test("sources/destinations narrow the matrix: only those cells are road times", () => {
  const resp = parseMatrix({ durations: [[0, 120, 240]], distances: [[0, 1609.344, 3218.688]] }, coords, [0], [0, 1, 2]);
  const d = matrixData(resp, points);
  const travel = combineTravel([d]);
  assert.deepEqual(travel(points[0], points[2]), { min: 4, mi: 2, source: "ors" });
  assert.equal(travel(points[1], points[2]).source, "estimate");
});

const ab = route("athletic-brewing-austin");
const profile = {
  drinks: [{ key: "athletic-brewing", name: "Athletic Brewing", ready: true }],
  rooms: ["bars", "breweries", "restaurants"],
  start: { lat: 30.2556, lon: -97.7208 },
  windows: [{ date: "2026-10-13", from: "14:00", to: "18:00" }, { date: "2026-10-14", from: "13:00", to: "18:00" }],
  visitMin: 25,
};
const pool = buildPool({ routes: [ab], profile });
const windows = windowsFor(profile);
const input = { pool: pool.rows, statuses: { [pool.ids[2]]: "notfit" }, windows, visitMin: 25, pinned: [] };

test("candidate sets: one per window, ≤ 50 points, start first, no duplicates, most of each day's stops in", () => {
  const est = planDays({ ...input, travel: estimateTravel });
  const sets = candidateSets(input);
  assert.equal(sets.length, 2);
  sets.forEach((s, i) => {
    assert.ok(s.points.length <= MATRIX_MAX && s.points.length > est.days[i].stops.length);
    assert.equal(s.points[0].id, "@30.25560,-97.72080", "the start, keyed by where it is");
    assert.equal(new Set(s.points.map((p) => p.id)).size, s.points.length);
    const inSet = est.days[i].stops.filter((st) => s.points.some((p) => p.id === st.id)).length;
    // H1: the area pull is soft now, so a day may reach past its 50 nearest doors for one more door (its legs there are
    // labelled estimates): 70%, was 80%
    assert.ok(inSet >= 0.7 * est.days[i].stops.length, `${inSet} of ${est.days[i].stops.length} stops in the set`);
  });
});

test("candidate sets ignore statuses, the current day and the clock (R1 Diolosa 10)", () => {
  const a = candidateSets(input);
  const marked = { ...input, statuses: Object.fromEntries(pool.ids.slice(0, 10).map((id) => [id, "notfit"])) };
  assert.deepEqual(candidateSets(marked), a);
  assert.deepEqual(candidateSets({ ...input, frozen: { date: windows[0].date, ids: pool.ids.slice(0, 3) }, now: { date: windows[0].date, min: 900 } }), a);
});

// a "road" matrix: the estimate's numbers, labelled ors (a city with slow roads would plan differently)
const roadMatrix = (c) => ({ ...estimateMatrix(c), source: "ors", label: undefined });

test("planOnRoads: an estimate matrix keeps the estimate plan; a road matrix plans on road times, cached per set", async () => {
  let calls = 0;
  const estimateApi = async (c) => (calls++, estimateMatrix(c));
  const a = await planOnRoads(input, { fetchMatrix: estimateApi });
  assert.equal(calls, 2);
  assert.equal(travelSource(a.plan), "estimate");
  assert.deepEqual(a.plan, a.estimate);

  const roadApi = async (c) => (calls++, roadMatrix(c));
  const cache = new Map();
  calls = 0;
  const b = await planOnRoads(input, { fetchMatrix: roadApi, cache });
  assert.equal(calls, 2);
  const src = travelSource(b.plan);
  assert.ok(src === "ors" || src === "mixed", src);
  assert.ok(b.plan.days.flatMap((d) => d.stops).some((s) => s.source === "ors"));
  await planOnRoads(input, { fetchMatrix: roadApi, cache });
  assert.equal(calls, 2, "the same candidate sets are not asked for twice");

  const failing = await planOnRoads(input, { fetchMatrix: async () => { throw new Error("offline"); } });
  assert.equal(travelSource(failing.plan), "estimate");
});

test("10 status changes in a row ask for no new matrix and never flip the plan to the estimate (R1 Diolosa 10)", async () => {
  let calls = 0;
  const cache = new Map();
  const roadApi = async (c) => (calls++, roadMatrix(c));
  let st = { ...input.statuses };
  let p = (await planOnRoads({ ...input, statuses: st }, { fetchMatrix: roadApi, cache })).plan;
  const first = calls;
  for (let i = 0; i < 10; i++) {
    const id = p.days.flatMap((d) => d.stops.map((s) => s.id))[0];
    st = { ...st, [id]: "notfit" };
    p = (await planOnRoads({ ...input, statuses: st }, { fetchMatrix: roadApi, cache })).plan;
    assert.notEqual(travelSource(p), "estimate", `change ${i + 1}`);
  }
  assert.equal(calls, first, "no matrix asked for after the first plan");
});

test("a later call that falls back keeps the road matrices already had, and is asked again next time", async () => {
  const cache = new Map();
  await planOnRoads(input, { fetchMatrix: async (c) => roadMatrix(c), cache });
  // a contact pin changes the sets; the limiter answers the estimate for the new ones
  const contact = { ...pool.rows.at(-1) };
  const withPin = { ...input, pinned: [{ id: contact.id, kind: "contact" }] };
  let limited = 0;
  const b = await planOnRoads(withPin, { fetchMatrix: async (c) => (limited++, estimateMatrix(c, null, null, "too many requests")), cache });
  assert.ok(limited > 0);
  assert.notEqual(travelSource(b.plan), "estimate", "the earlier road matrices still answer");
  const keys = [...cache.keys()];
  assert.equal(keys.length, 2, "an estimate answer is not cached");
  let again = 0;
  await planOnRoads(withPin, { fetchMatrix: async (c) => (again++, roadMatrix(c)), cache });
  assert.equal(again, limited, "the fallen-back sets are asked again");
});

test("labels say road vs estimate (§9.4)", () => {
  assert.match(travelLabel("estimate"), /estimated: straight-line distance × 1\.35 at 18 mph/);
  assert.match(travelLabel("ors"), /^Road miles/);
  assert.match(travelLabel("mixed"), /est\./);
});
