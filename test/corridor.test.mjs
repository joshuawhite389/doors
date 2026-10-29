// V5 corridor geometry (public/lib/corridor.js): the detour ellipse drawn on the map.
import { test } from "node:test";
import assert from "node:assert/strict";
import { corridorShape, corridorRing, inCorridor, kmPerMin } from "../public/lib/corridor.js";
import { km } from "../public/lib/core.js";

const S = [30.2672, -97.7431];
const A = [30.3172, -97.7431]; // ~5.6 km north

test("anchor at the start: a circle of radius slack/2", () => {
  const e = corridorShape({ foci: [S, S], slackMin: 20 });
  assert.ok(Math.abs(e.aKm - e.bKm) < 1e-9);
  assert.ok(Math.abs(e.aKm - 10 * kmPerMin()) < 1e-9);
  const ring = corridorRing({ foci: [S, S], slackMin: 20 });
  for (const [lon, lat] of ring) assert.ok(Math.abs(km({ lat: S[0], lon: S[1] }, { lat, lon }) - e.aKm) < 0.02);
});

test("far anchor: long and thin along start → anchor, every ring point on the detour bound", () => {
  const c = { foci: [S, A], slackMin: 2 };
  const e = corridorShape(c);
  assert.ok(e.aKm > 2 * e.bKm, `a ${e.aKm} b ${e.bKm}`);
  assert.ok(Math.abs(Math.abs(e.theta) - Math.PI / 2) < 0.01, "major axis north–south");
  const ring = corridorRing(c);
  assert.deepEqual(ring[0], ring.at(-1));
  const s = { lat: S[0], lon: S[1] }, a = { lat: A[0], lon: A[1] };
  const bound = km(s, a) + 2 * kmPerMin();
  for (const [lon, lat] of ring) assert.ok(Math.abs(km(s, { lat, lon }) + km({ lat, lon }, a) - bound) < 0.03);
  assert.ok(inCorridor(c, { lat: 30.29, lon: -97.7431 }));
  assert.ok(!inCorridor(c, { lat: 30.29, lon: -97.70 }));
});

test("no corridor, no shape", () => {
  for (const c of [null, {}, { foci: [S], slackMin: 5 }, { foci: [S, A], slackMin: 0 }, { foci: [S, [null, 1]], slackMin: 5 }]) assert.equal(corridorRing(c), null);
});

test("pair corridor (start → A1 → A2 → start): one ellipse per leg, the outline only outside the others", async () => {
  const { corridorRings, corridorOutline, inCorridor } = await import("../public/lib/corridor.js");
  const A2 = [30.3172, -97.70];
  const c = { foci: [A, A2], slackMin: 4, points: [S, A, A2] };
  assert.equal(corridorRings(c).length, 3);
  const out = corridorOutline(c);
  assert.ok(out.length >= 3);
  // an outline point is inside no leg's ellipse strictly
  const pts = out.flat();
  const strictlyIn = ([lon, lat]) => [[S, A], [A, A2], [A2, S]].some(([a, b]) => km({ lat: a[0], lon: a[1] }, { lat, lon }) + km({ lat, lon }, { lat: b[0], lon: b[1] }) < km({ lat: a[0], lon: a[1] }, { lat: b[0], lon: b[1] }) + 4 * kmPerMin() - 0.01);
  assert.ok(pts.every((p) => !strictlyIn(p)));
  assert.ok(inCorridor(c, { lat: 30.3172, lon: -97.72 })); // on the A1 → A2 leg
  assert.ok(!inCorridor(c, { lat: 30.20, lon: -97.60 }));
  // slackKm given wins over slackMin
  assert.ok(corridorShape({ foci: [S, S], slackMin: 20, slackKm: 1 }).aKm - 0.5 < 1e-9);
});

test("pair corridor fill: one closed ring holding the loop's points", async () => {
  const { corridorFill } = await import("../public/lib/corridor.js");
  const A2 = [30.3172, -97.70];
  const ring = corridorFill({ foci: [A, A2], slackMin: 4, points: [S, A, A2] });
  assert.deepEqual(ring[0], ring.at(-1));
  // ray-cast: the start and both anchors are inside the ring
  const inside = ([lat, lon]) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) c = !c; } return c; };
  for (const p of [S, A, A2]) assert.ok(inside(p));
});
