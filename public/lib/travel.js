// Road times for the planner (SPEC-V2 §5.2, §6): a 100-door pool does not fit one ORS matrix, so ask /api/matrix for
// one point set per day to plan (its start, its pins, then the doors nearest its area's centre, at most 50 points)
// and plan on the road times where they exist. The sets come from schedule.areasFor, which ignores statuses, so
// marking a door re-plans without asking for a new matrix (R1 Diolosa 10). A matrix that answers `source:"estimate"`
// (no key, limits, ?ors=off) is not kept: the planner uses every road matrix this tab already has, then the
// labelled estimate. Pure except planOnRoads, which takes the fetch as an argument. Covered by test/travel.test.mjs.
import { km } from "./core.js";
import { planDays, estimateTravel, matrixTravel, areasFor, ROAD_FACTOR, ESTIMATE_MPH } from "./schedule.js";

export const MATRIX_MAX = 50; // points per day: 50 × 50 = 2,500 cells, the Worker's ceiling

// Starts are keyed by where they are, not by date, so a start moved on the profile never reads an old matrix.
const keyOf = (p) => (p?.id == null || String(p.id).startsWith("start:") ? `@${(+p.lat).toFixed(5)},${(+p.lon).toFixed(5)}` : p.id);

// /api/matrix answer + the points sent (same order) → {keys, min, mi} for schedule.matrixTravel, or null when the
// answer is the estimate. Cells ORS could not route (listed in `estimated`) are left out so they fall back to the
// estimate and are labelled as one.
export function matrixData(resp, points) {
  if (!resp || resp.source !== "ors" || !Array.isArray(resp.durations) || !Array.isArray(resp.distances)) return null;
  const S = resp.sources ?? points.map((_, i) => i);
  const D = resp.destinations ?? points.map((_, i) => i);
  if (resp.durations.length !== S.length) return null;
  const n = points.length;
  const min = Array.from({ length: n }, () => Array(n).fill(null));
  const mi = Array.from({ length: n }, () => Array(n).fill(null));
  S.forEach((i, a) => D.forEach((j, b) => {
    min[i][j] = resp.durations[a]?.[b] ?? null;
    mi[i][j] = resp.distances[a]?.[b] ?? null;
  }));
  for (const [a, b] of resp.estimated ?? []) {
    const i = S[a];
    const j = D[b];
    if (i != null && j != null) (min[i][j] = null), (mi[i][j] = null);
  }
  return { keys: points.map(keyOf), min, mi };
}

// Several day matrices → one travel function: the first matrix holding both points answers, else the estimate.
export function combineTravel(datas) {
  const t = datas.filter(Boolean).reduceRight((fallback, d) => matrixTravel(d, fallback), estimateTravel);
  return (a, b) => t(keyed(a), keyed(b));
}
const keyed = (p) => (p && (p.id == null || String(p.id).startsWith("start:")) ? { ...p, id: keyOf(p) } : p);

// Each window → its matrix points: the start, the pinned doors, then the pool's doors nearest the window's area centre,
// up to `max` points. The areas are split over all the profile's windows with statuses, the current day and the
// clock ignored, and the day's current stops are not used, so a set (and its cache key) stays the same while the
// rep marks doors and the week goes by. → [{date, from, key, points:[{id, lat, lon}]}]
export function candidateSets(input, { max = MATRIX_MAX } = {}) {
  const { pool = [], windows = [], pinned = [] } = input;
  const byId = new Map(pool.map((r) => [r.id, r]));
  const pins = [...new Set(pinned.map((p) => p.id))].filter((id) => byId.has(id)).sort();
  const out = [];
  for (const a of areasFor({ ...input, statuses: {}, frozen: null, now: null })) {
    const w = windows.find((x) => x.date === a.date && (x.from == null || x.from === a.from));
    const pts = [];
    const have = new Set();
    const add = (p) => {
      const k = keyOf(p);
      if (have.has(k) || pts.length >= max) return;
      have.add(k);
      pts.push({ id: k, lat: p.lat, lon: p.lon });
    };
    if (w?.start) add(w.start);
    for (const id of pins) add(byId.get(id));
    const c = a.centre ?? w?.start;
    const rest = c ? pool.slice().sort((x, y) => km(c, x) - km(c, y) || (x.id < y.id ? -1 : 1)) : [];
    for (const r of rest) add(r);
    if (pts.length >= 2) out.push({ date: a.date, from: a.from, key: setKey(pts), points: pts });
  }
  return out;
}

// A point set's cache key: its ids sorted (starts by where they are), so the same doors are the same matrix.
const setKey = (points) => points.map((p) => p.id).sort().join("|");

// Plan on road times where /api/matrix has them.
// fetchMatrix(coords) → the /api/matrix JSON (or throws). cache: a Map kept by the caller across re-plans, so a
// status change does not ask for the same matrix twice. Only road answers stay in it: an estimate answer or an error
// is dropped (the next re-plan asks again), and meanwhile every road matrix already in the cache is used, so a
// limiter or a timeout never flips a planned day back to the estimate. Returns {plan, estimate}.
export async function planOnRoads(input, { fetchMatrix, cache = new Map() } = {}) {
  const est = planDays({ ...input, travel: estimateTravel });
  if (!fetchMatrix) return { plan: est, estimate: est };
  await Promise.all(
    candidateSets(input).map(async ({ key, points }) => {
      if (!cache.has(key)) {
        const p = Promise.resolve()
          .then(() => fetchMatrix(points.map((x) => [x.lon, x.lat])))
          .then((r) => matrixData(r, points))
          .catch(() => null);
        cache.set(key, p);
        if (!(await p)) cache.delete(key);
      }
      return cache.get(key);
    }),
  );
  const datas = (await Promise.all([...cache.values()])).filter(Boolean);
  if (!datas.length) return { plan: est, estimate: est };
  return { plan: planDays({ ...input, travel: combineTravel(datas) }), estimate: est };
}

// How every distance and time on the plan was measured (§5.2, §9.4): one line for the footer.
export function travelSource(plan) {
  const s = new Set();
  for (const d of plan.days) for (const st of d?.stops ?? []) s.add(st.source ?? "estimate");
  if (!s.size || (s.size === 1 && s.has("estimate"))) return "estimate";
  return s.size === 1 && s.has("ors") ? "ors" : "mixed";
}

// The same in plain words, for Why's last line (audit 2 #9: "straight-line distance × 1.35 at 18 mph" there read as an
// engineering note). The export keeps travelLabel's method.
export function travelWords(source) {
  if (source === "ors") return "Road miles from OpenRouteService.";
  if (source === "mixed") return "Road miles from OpenRouteService; \u201cest.\u201d means estimated.";
  return "Miles are estimated: road routing isn't available right now.";
}
export function travelLabel(source) {
  const est = `estimated: straight-line distance × ${ROAD_FACTOR} at ${ESTIMATE_MPH} mph`;
  if (source === "ors") return "Road miles and drive times from OpenRouteService.";
  if (source === "mixed") return `Road miles and drive times from OpenRouteService; legs marked “est.” are ${est}.`;
  return `Miles and times are ${est} (road routing is not available right now).`;
}
