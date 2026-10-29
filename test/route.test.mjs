// Route builder and replan: synthetic grids plus real precomputed routes (Athletic Brewing Austin and three more).
// Contract (post M2 review): selection is groups (anchor + ranked sisters within maxKm, ≤ groupMax) inside a radius
// of door 1 that widens through `radii`; ORDER is nearest-neighbour from door 1 then 2-opt, so groups interleave and
// `stops[i].group` is only a label. No leg may exceed maxLeg (8 km): such a door goes to `route.dropped`.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRoute, replan, km, parseHours, isOpenFor, nearestNeighbour, twoOpt, legsCross } from "../public/lib/core.js";
import { route as routeFile, city as cityFile } from "./helpers.mjs";

const C = { lat: 30.27, lon: -97.74 };
const DEG_KM = 111.2; // ~km per degree of latitude
// A door dx/dy km from the centre (east, north).
const door = (id, dyKm, dxKm = 0) => ({ id, lat: C.lat + dyKm / DEG_KM, lon: C.lon + dxKm / (DEG_KM * Math.cos((C.lat * Math.PI) / 180)) });
// n doors on a small grid, all within ~3 km of the centre, ranked d0..d(n-1).
const grid = (n) => Array.from({ length: n }, (_, i) => door(`d${i}`, (i % 5) * 0.5, Math.floor(i / 5) * 0.5));
const pathLen = (pts) => pts.reduce((t, p, i) => (i ? t + km(pts[i - 1], p) : 0), 0);
function crossings(pts) {
  const out = [];
  for (let i = 0; i + 1 < pts.length; i++) for (let j = i + 2; j + 1 < pts.length; j++) if (legsCross(pts[i], pts[i + 1], pts[j], pts[j + 1])) out.push([pts[i].id, pts[i + 1].id, pts[j].id, pts[j + 1].id]);
  return out;
}
// Deterministic PRNG for the random-point tests.
const rng = (seed) => () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);

function checkInvariants(r, input, { size = 12, groupMax = 4, maxLeg = 8 } = {}) {
  const inputIds = new Set(input.map((d) => d.id));
  const byId = new Map(input.map((d) => [d.id, d]));
  assert.ok(r.stops.length <= size, `≤${size} stops`);
  assert.deepEqual(r.stops.map((s) => s.n), r.stops.map((_, i) => i + 1), "numbered 1..n");
  assert.equal(new Set(r.stops.map((s) => s.id)).size, r.stops.length, "no door twice");
  for (const s of r.stops) {
    assert.ok(inputIds.has(s.id), `${s.id} is an input door`);
    assert.ok(byId.get(s.id).lat != null, "has coordinates");
  }
  const pts = r.stops.map((s) => byId.get(s.id));
  if (r.stops.length) assert.equal(r.stops[0].id, input.find((d) => d.lat != null).id, "stop 1 is the best door with coordinates");
  // groups: size ≤ groupMax; their union is exactly the stops; each stop's label names the group holding it
  const stopIds = new Set(r.stops.map((s) => s.id));
  const groupOf = new Map();
  for (const g of r.groups) {
    assert.ok(g.ids.length >= 1 && g.ids.length <= groupMax, `group ${g.letter} size ${g.ids.length} ≤ ${groupMax}`);
    for (const id of g.ids) {
      assert.ok(stopIds.has(id), `group member ${id} is a stop`);
      assert.ok(!groupOf.has(id), `${id} in one group only`);
      groupOf.set(id, g);
    }
  }
  assert.equal(groupOf.size, r.stops.length, "every stop belongs to a group");
  for (const s of r.stops) {
    assert.equal(s.group, groupOf.get(s.id).letter, `${s.id} label`);
    assert.equal(s.anchor, groupOf.get(s.id).anchor === s.id, `${s.id} anchor flag`);
  }
  // geometry: no crossings, no long legs, km = Σ legs
  assert.deepEqual(crossings(pts), [], "no two non-adjacent legs cross");
  for (let i = 1; i < pts.length; i++) assert.ok(km(pts[i - 1], pts[i]) <= maxLeg + 1e-9, `leg ${i} ≤ ${maxLeg} km`);
  assert.ok(r.maxLegKm <= maxLeg, `maxLegKm ${r.maxLegKm} ≤ ${maxLeg}`);
  assert.equal(r.legs.length, r.stops.length);
  if (r.legs.length) assert.equal(r.legs[0], 0);
  const sum = r.legs.reduce((a, b) => a + b, 0);
  // legs and km are each rounded to 0.1 km, so the sum may drift by up to 0.05 per leg
  assert.ok(Math.abs(r.km - sum) <= 0.05 * r.legs.length + 0.05 + 1e-9, `km ${r.km} ≈ Σ legs ${sum}`);
  // km is the sum of the rounded legs shown, so it can differ from the raw path length by the rounding of each leg
  assert.ok(Math.abs(r.km - pathLen(pts)) <= 0.05 * r.legs.length + 0.05 + 1e-9, "km is the straight-line path length (within leg rounding)");
  for (const d of r.dropped ?? []) {
    assert.ok(!stopIds.has(d.id), `dropped ${d.id} is not a stop`);
    assert.equal(typeof d.reason, "string");
  }
  if (r.stops.length && r.radiusKm != null) for (const p of pts) assert.ok(km(pts[0], p) <= r.radiusKm + 1e-9, `${p.id} within ${r.radiusKm} km of door 1`);
}

test("nearestNeighbour keeps the start and visits every point once, always the closest next", () => {
  const pts = [door("s", 0), door("far", 3), door("near", 0.5), door("mid", 1.5)];
  assert.deepEqual(nearestNeighbour(pts).map((p) => p.id), ["s", "near", "mid", "far"]);
  assert.deepEqual(nearestNeighbour(pts.slice(0, 2)).map((p) => p.id), ["s", "far"]);
});

test("twoOpt removes a constructed crossing and never lengthens a path", () => {
  // a(0,0) → b(1,1) → c(1,0) → d(0,1): legs a-b and c-d cross
  const crossed = [door("a", 0, 0), door("b", 1, 1), door("c", 0, 1), door("d", 1, 0)];
  assert.equal(crossings(crossed).length, 1, "the fixture does cross");
  const fixed = twoOpt(crossed);
  assert.equal(fixed[0].id, "a", "start stays fixed");
  assert.deepEqual(crossings(fixed), []);
  assert.ok(pathLen(fixed) < pathLen(crossed));
  assert.deepEqual([...fixed.map((p) => p.id)].sort(), ["a", "b", "c", "d"]);
  const rand = rng(7);
  for (let t = 0; t < 40; t++) {
    const pts = Array.from({ length: 4 + (t % 10) }, (_, i) => door(`p${i}`, rand() * 6 - 3, rand() * 6 - 3));
    const out = twoOpt(pts);
    assert.equal(out[0], pts[0]);
    assert.equal(new Set(out).size, pts.length);
    assert.ok(pathLen(out) <= pathLen(pts) + 1e-9, "never longer");
    assert.deepEqual(crossings(twoOpt(nearestNeighbour(pts))), [], `seed run ${t}: no crossings after NN + 2-opt`);
  }
});

test("legsCross: crossing, parallel and shared-endpoint legs", () => {
  assert.equal(legsCross(door("a", 0, 0), door("b", 1, 1), door("c", 0, 1), door("d", 1, 0)), true);
  assert.equal(legsCross(door("a", 0, 0), door("b", 0, 1), door("c", 1, 0), door("d", 1, 1)), false);
  assert.equal(legsCross(door("a", 0, 0), door("b", 1, 1), door("b2", 1, 1), door("d", 2, 0)), false);
});

test("12 stops max, numbered, all input doors; stop 1 is the best door", () => {
  const doors = grid(30);
  const r = buildRoute(doors, {});
  assert.equal(r.stops.length, 12);
  assert.equal(r.stops[0].id, "d0");
  assert.equal(r.stops[0].group, "A");
  assert.equal(r.stops[0].anchor, true);
  checkInvariants(r, doors);
  assert.ok(Number.isFinite(r.km) && r.km > 0);
  // selection is still by rank: the 12 best doors, in route order
  assert.deepEqual(r.stops.map((s) => s.id).sort(), grid(12).map((d) => d.id).sort());
});

test("sisters join their anchor only if ranked and within maxKm", () => {
  const doors = [door("a", 0), door("b", 0.3), door("c", 0.6), door("near", 0.2, 0.2), door("far", 0, 7.5), ...grid(15).map((d) => ({ ...d, id: `g${d.id}` }))];
  const sisters = { a: ["unranked", "far", "near"] };
  const r = buildRoute(doors, sisters, { maxKm: 6 });
  const A = r.groups[0];
  assert.equal(A.letter, "A");
  assert.equal(A.anchor, "a");
  assert.deepEqual(A.ids, ["a", "near"]);
  assert.equal(A.sistersKnown, true);
  assert.equal(r.groups[1].sistersKnown, false);
  assert.ok(!r.stops.some((s) => s.id === "unranked"));
  assert.equal(r.stops.find((s) => s.id === "near").group, "A");
  checkInvariants(r, doors);
});

test("group size is capped at groupMax", () => {
  const doors = [door("a", 0), ...Array.from({ length: 8 }, (_, i) => door(`s${i}`, 0.1 * (i + 1))), ...grid(10).map((d) => ({ ...d, id: `g${d.id}` }))];
  const sisters = { a: Array.from({ length: 8 }, (_, i) => `s${i}`) };
  for (const groupMax of [2, 3, 4]) {
    const r = buildRoute(doors, sisters, { groupMax });
    assert.equal(r.groups[0].ids.length, groupMax);
    checkInvariants(r, doors, { groupMax });
  }
});

test("radius keeps the day local: far doors are left out when 12 are within 5 km", () => {
  const doors = [door("best", 0), door("far1", 30), door("far2", -25, 10), ...grid(14).map((d) => ({ ...d, id: `g${d.id}` }))];
  const r = buildRoute(doors, {});
  assert.equal(r.radiusKm, 5);
  assert.ok(!r.stops.some((s) => s.id.startsWith("far")));
  checkInvariants(r, doors);
});

test("radius widens through radii until 12 doors are eligible", () => {
  // 7 doors north within 3 km, 6 doors 9–10.5 km south: radius 12 holds all 13. The leg from the north cluster to
  // the south one is > 8 km, so the south doors are dropped and the route stays short and legal.
  const doors = [door("best", 0), ...Array.from({ length: 6 }, (_, i) => door(`n${i}`, 0.5 * (i + 1))), ...Array.from({ length: 6 }, (_, i) => door(`m${i}`, -(9 + i * 0.3)))];
  const r = buildRoute(doors, {});
  assert.equal(r.radiusKm, 12);
  assert.equal(r.eligible, 13);
  checkInvariants(r, doors);
  assert.ok(r.dropped.length > 0, "the far cluster is dropped, not reached by a 9 km leg");
  // never enough doors: radius ends at Infinity, reported as null; doors > 8 km from everything are dropped
  const few = [door("x", 0), door("y", 40), door("z", -60)];
  const r2 = buildRoute(few, {});
  assert.equal(r2.radiusKm, null);
  assert.deepEqual(r2.stops.map((s) => s.id), ["x"]);
  assert.deepEqual(r2.dropped.map((d) => d.id).sort(), ["y", "z"]);
  checkInvariants(r2, few);
  const near3 = [door("x", 0), door("y", 4), door("z", -3)];
  const r3 = buildRoute(near3, {});
  assert.equal(r3.radiusKm, null);
  assert.equal(r3.stops.length, 3);
  checkInvariants(r3, near3);
});

test("doors on both sides of door 1 that a legal route can reach are not dropped", () => {
  const chain = [door("best", 0), ...Array.from({ length: 6 }, (_, i) => door(`n${i}`, 0.5 * (i + 1))), ...Array.from({ length: 6 }, (_, i) => door(`m${i}`, -(5.5 + i * 0.3)))];
  const rc = buildRoute(chain, {});
  assert.equal(rc.radiusKm, 8);
  checkInvariants(rc, chain);
  assert.deepEqual(rc.dropped, []);
  assert.equal(rc.stops.length, 12);
});

test("a door far from all others is dropped with a reason and the next eligible door fills in", () => {
  // radius widens to 12 (11 doors within 8). "far" (ranked 2nd, 10 km north) is > 8 km from every other door; e2 sits
  // 11 km east, 4 km beyond e1, so it is reachable and takes far's place.
  const cluster = Array.from({ length: 9 }, (_, i) => door(`c${i}`, 0.2 * (i % 3), 0.2 * Math.floor(i / 3)));
  const doors = [door("best", 0), door("far", 10), ...cluster, door("e1", 0, 7), door("e2", 0, 11), door("e3", 0.3, 11)];
  const r = buildRoute(doors, {});
  assert.equal(r.radiusKm, 12);
  assert.equal(r.stops.length, 12);
  assert.ok(!r.stops.some((s) => s.id === "far"));
  assert.deepEqual(r.dropped.map((d) => d.id), ["far"]);
  assert.match(r.dropped[0].reason, /8 km/);
  assert.ok(r.stops.some((s) => s.id === "e2"), "the next eligible door fills the slot");
  assert.ok(!r.stops.some((s) => s.id === "e3"), "only one slot to fill");
  checkInvariants(r, doors);
  // a tighter maxLeg is honoured too
  const tight = buildRoute(doors, {}, { maxLeg: 5 });
  checkInvariants(tight, doors, { maxLeg: 5 });
  assert.ok(tight.maxLegKm <= 5);
});

test("order is nearest-neighbour from door 1, not rank order", () => {
  // anchors ranked a(0 km), b(4 km north), c(1 km south): visit a → c → b
  const doors = [door("a", 0), door("b", 4), door("c", -1)];
  const r = buildRoute(doors, {});
  assert.deepEqual(r.stops.map((s) => s.id), ["a", "c", "b"]);
  assert.deepEqual(r.stops.map((s) => s.group), ["A", "C", "B"], "group letters follow rank; stops follow geography");
  checkInvariants(r, doors);
  // groups interleave: a sister of A that sits beside C's anchor is visited next to C, not next to A
  const il = [door("a", 0), door("b", 3), door("c", 1.5), door("sa", 3.2)];
  const ri = buildRoute(il, { a: ["sa"] });
  assert.deepEqual(ri.groups[0].ids, ["a", "sa"]);
  assert.deepEqual(ri.stops.map((s) => s.id), ["a", "c", "b", "sa"]);
  checkInvariants(ri, il);
});

test("doors without coordinates are skipped", () => {
  const doors = [{ id: "nocoord", lat: null, lon: null }, ...grid(14)];
  const r = buildRoute(doors, { d0: ["nocoord"] });
  assert.ok(!r.stops.some((s) => s.id === "nocoord"));
  assert.equal(r.stops[0].id, "d0");
  assert.equal(r.stops.length, 12);
  checkInvariants(r, doors);
});

test("no door with coordinates (or no open door at all) gives an empty route", () => {
  assert.deepEqual(buildRoute([{ id: "x", lat: null, lon: null }], {}).stops, []);
  assert.deepEqual(buildRoute([], {}).stops, []);
});

test("replan excludes declined doors and promotes their sisters", () => {
  const doors = grid(25);
  const before = buildRoute(doors, {});
  assert.ok(!before.stops.some((s) => s.id === "d20"), "d20 is too low-ranked for the first route");
  const sisters = { d3: ["d20", "d21"] };
  const r = replan(doors, sisters, ["d3"]);
  assert.ok(!r.stops.some((s) => s.id === "d3"), "declined door gone");
  assert.ok(r.stops.some((s) => s.id === "d20"), "its sister promoted");
  assert.ok(r.stops.some((s) => s.id === "d21"), "its other sister promoted");
  assert.equal(r.stops.length, 12);
  checkInvariants(r, doors.filter((d) => d.id !== "d3"));
  // declining several, including a sister of another declined door
  const r2 = replan(doors, { d0: ["d1", "d22"], d1: ["d23"] }, ["d0", "d1"]);
  const ids = r2.stops.map((s) => s.id);
  assert.ok(!ids.includes("d0") && !ids.includes("d1"));
  assert.ok(ids.includes("d22") && ids.includes("d23"));
  assert.equal(ids[0], "d2", "the best remaining door leads");
  checkInvariants(r2, doors.filter((d) => !["d0", "d1"].includes(d.id)));
});

test("km is exactly the sum of the legs shown", () => {
  const rf = routeFile("athletic-brewing-boise");
  const cf = cityFile("boise");
  const open = rf.lists.all.map(([id]) => rf.venues[id]).filter((v) => v && !v.closed && isOpenFor(parseHours(v.hours), "tuesday", "evening") !== false);
  const sisters = Object.fromEntries(Object.entries(cf.sisters).map(([k, x]) => [k, x.map((y) => (Array.isArray(y) ? y[0] : y))]));
  const r = buildRoute(open, sisters);
  assert.equal(Math.round(r.legs.reduce((a, b) => a + b, 0) * 10) / 10, r.km);
});

for (const [key, cityKey, label] of [
  ["athletic-brewing-austin", "austin", "Athletic Brewing Austin"],
  ["casamigos-chicago", "chicago", "Casamigos Chicago"],
  ["athletic-brewing-boise", "boise", "Athletic Brewing Boise"],
  ["teremana-omaha", "omaha", "Teremana Omaha"],
]) {
  test(`real data: ${label}, Tuesday evening → 12 stops, zero crossings, maxLegKm ≤ 8`, () => {
    const rf = routeFile(key);
    const cf = cityFile(cityKey);
    const open = rf.lists.all.map(([id]) => rf.venues[id]).filter((v) => v && !v.closed && isOpenFor(parseHours(v.hours), "tuesday", "evening") !== false);
    const sisters = Object.fromEntries(Object.entries(cf.sisters).map(([k, x]) => [k, x.map((y) => (Array.isArray(y) ? y[0] : y))]));
    const r = buildRoute(open, sisters);
    console.log(`${key} tuesday evening: ${open.length} open of ${rf.lists.all.length}; ${r.groups.length} groups, ${r.km} km, longest leg ${r.maxLegKm} km, radius ${r.radiusKm} km, dropped ${r.dropped.length}`);
    assert.equal(r.stops.length, 12);
    assert.equal(r.stops[0].id, open.find((v) => v.lat != null).id);
    assert.ok(Number.isFinite(r.radiusKm));
    assert.ok(r.maxLegKm <= 8);
    checkInvariants(r, open);
    const rankIds = new Set(open.map((v) => v.id));
    for (const g of r.groups) for (const id of g.ids.filter((x) => x !== g.anchor)) {
      assert.ok(rankIds.has(id), "sister is ranked and open");
      assert.ok((sisters[g.anchor] ?? []).includes(id), "non-anchor stop is a Qloo sister of its anchor");
      assert.ok(km(rf.venues[g.anchor], rf.venues[id]) <= 6, "sister within 6 km of its anchor");
    }
  });
}
