// A V5 day's corridor (docs/ROUTING-V5-EVAL.md) as a polygon for the map: the detour ellipse with foci S (the day's
// start) and A (its anchor), the doors x with t(S,x) + t(x,A) ≤ t(S,A) + slack. Drawn on the straight-line estimate
// (schedule.js estimateTravel: × ROAD_FACTOR at ESTIMATE_MPH), so slack minutes become km and the sum of distances to
// the foci is |SA| + slack km: anchor at the start → a circle of radius slack/2, a far anchor → a long thin ellipse on
// the line. On road minutes the true set is not exactly an ellipse; the picture is the explanation, not the rule.
// Pure: no DOM. corridor = V5 planDays day.corridor { foci, slackMin, slackKm, anchorId, anchorRank, anchors, points }:
// points = the loop start → anchor(s); a door is in it when its cheapest insertion into that loop adds ≤ slack, the union
// of one ellipse per leg (one anchor: a single ellipse; a pair: three).
import { km } from "./core.js";
import { ROAD_FACTOR, ESTIMATE_MPH } from "./schedule.js";

const MI_PER_KM = 0.621371;
const KM_LAT = 111.32;
export const kmPerMin = () => ESTIMATE_MPH / 60 / (MI_PER_KM * ROAD_FACTOR);

const pt = ([lat, lon]) => ({ lat, lon });
const ok = (p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite);
const slackKm = (c) => (Number.isFinite(c?.slackKm) ? c.slackKm : (c?.slackMin ?? NaN) * kmPerMin());
// The corridor's loop: start → anchor(s) → start (V5 day.corridor.points), or the two foci when there are no points.
// → its legs as [[lat, lng], [lat, lng]] pairs, an out-and-back counted once.
export function corridorLegs(c) {
  const p = (Array.isArray(c?.points) && c.points.length >= 2 ? c.points : c?.foci) ?? [];
  if (p.length < 2 || !p.every(ok)) return [];
  if (p.length === 2) return [[p[0], p[1]]];
  return p.map((a, i) => [a, p[(i + 1) % p.length]]);
}

// One leg's ellipse: foci the leg's ends, sum of distances |leg| + slack km. → centre, semi-axes (km), the major
// axis's angle from east, and km per degree of longitude there; null when it can't be drawn.
export function ellipseOf([f1, f2], sKm) {
  if (!ok(f1) || !ok(f2) || !(sKm > 0)) return null;
  const [s, a] = [pt(f1), pt(f2)];
  const cKm = km(s, a) / 2;
  const aKm = cKm + sKm / 2;
  const bKm = Math.sqrt(Math.max(0, aKm * aKm - cKm * cKm));
  const centre = { lat: (s.lat + a.lat) / 2, lon: (s.lon + a.lon) / 2 };
  const kx = KM_LAT * Math.cos((centre.lat * Math.PI) / 180);
  const theta = Math.atan2((a.lat - s.lat) * KM_LAT, (a.lon - s.lon) * kx);
  return { centre, aKm, bKm, cKm, theta, kx };
}

// The first leg's ellipse (a single-anchor corridor's whole shape).
export const corridorShape = (c) => {
  const leg = corridorLegs(c)[0];
  return leg ? ellipseOf(leg, slackKm(c)) : null;
};

function ringOf(e, n) {
  const ring = [];
  for (let i = 0; i <= n; i++) {
    const t = (2 * Math.PI * (i % n)) / n;
    const x = e.aKm * Math.cos(t);
    const y = e.bKm * Math.sin(t);
    ring.push([e.centre.lon + (x * Math.cos(e.theta) - y * Math.sin(e.theta)) / e.kx, e.centre.lat + (x * Math.sin(e.theta) + y * Math.cos(e.theta)) / KM_LAT]);
  }
  return ring;
}

// → one closed ring [[lon, lat], …] per leg (GeoJSON order), or null when the corridor can't be drawn.
export function corridorRings(c, n = 72) {
  const sKm = slackKm(c);
  const es = corridorLegs(c).map((l) => ellipseOf(l, sKm)).filter(Boolean);
  return es.length ? es.map((e) => ringOf(e, n)) : null;
}
// The first ring (a single-anchor corridor's whole outline).
export const corridorRing = (c, n = 72) => corridorRings(c, n)?.[0] ?? null;

// Is a point inside the corridor (on the estimate)? Its cheapest insertion into the loop adds at most the slack.
export function inCorridor(c, { lat, lon }) {
  const sKm = slackKm(c);
  if (!(sKm >= 0)) return false;
  const x = { lat, lon };
  return corridorLegs(c).some(([a, b]) => km(pt(a), x) + km(x, pt(b)) <= km(pt(a), pt(b)) + sKm + 1e-9);
}

// The union's outline: each ring's runs that lie outside every other leg's ellipse (so no lines cross the inside).
// → [[[lon, lat], …], …] line strings.
export function corridorOutline(c, n = 120) {
  const rings = corridorRings(c, n);
  if (!rings) return [];
  if (rings.length === 1) return rings;
  const sKm = slackKm(c);
  const legs = corridorLegs(c);
  const inOther = (j, [lon, lat]) => legs.some(([a, b], i) => i !== j && km(pt(a), { lat, lon }) + km({ lat, lon }, pt(b)) < km(pt(a), pt(b)) + sKm - 1e-6);
  const out = [];
  rings.forEach((ring, j) => {
    let run = [];
    for (const p of ring) {
      if (inOther(j, p)) { if (run.length > 1) out.push(run); run = []; }
      else run.push(p);
    }
    if (run.length > 1) out.push(run);
  });
  return out;
}

// The union as one polygon ring for the fill (no darker overlaps): the outline's points by angle round the loop's
// centre. Exact when the union is star-shaped from there, which a corridor round a short loop is.
export function corridorFill(c, n = 120) {
  const rings = corridorRings(c, n);
  if (!rings) return null;
  if (rings.length === 1) return rings[0];
  const legs = corridorLegs(c);
  const cLat = legs.reduce((a, [p]) => a + p[0], 0) / legs.length;
  const cLon = legs.reduce((a, [p]) => a + p[1], 0) / legs.length;
  const kx = Math.cos((cLat * Math.PI) / 180);
  const pts = corridorOutline(c, n).flat().sort((a, b) => Math.atan2(a[1] - cLat, (a[0] - cLon) * kx) - Math.atan2(b[1] - cLat, (b[0] - cLon) * kx));
  return pts.length > 2 ? [...pts, pts[0]] : null;
}
