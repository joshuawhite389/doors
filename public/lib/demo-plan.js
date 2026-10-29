// The demo's plan, as the plan view computes it (ui/plan.js compute + setStatus/setOutcome), so the bake
// (scripts/bake-demo.mjs), the tests and the page agree on every state the script walks through:
//   0 · built: the demo profile, her contact, Central District Brewing already talked to
//   1 · Nomadic Beerworks (DEMO_SHOWCASE, stop 6 of Tuesday's 10) marked visited: Tuesday becomes the current day and,
//       on the tour's clock (tourNow: it is Tuesday, her day under way), the visit is out of order, so it leads the day
//       and the rest re-route from there (G4, H1)
//   2 · its outcome "Interested · follow up Thursday": the door is pinned to Thursday
// Road times come from the baked matrix (one OSRM table over the start and every door in the pool), so the demo asks
// no server for anything. Pure: no DOM, no fetch.
import { buildPool, windowsFor } from "./pool.js";
import { untilFor } from "./week.js";
import { planOnRoads } from "./travel.js";
import { isoDate } from "./profile.js";
import { DEMO_DEEP_OFF } from "./culture.js";
import { DEMO_SHOWCASE } from "./demo-profile.js";

export const DEMO_ATTRIBUTION = "Routes: OSRM, © OpenStreetMap contributors";

// ui/plan.js frozenFor, unchanged: the day being worked keeps its stops (minus talked / not a fit).
export function frozenFor(st, windows, statuses, now) {
  const cur = st.current?.date >= now.date ? st.current : windows.some((w) => w.date === now.date) ? { date: now.date } : null;
  if (!cur) return null;
  if (!windows.some((w) => w.date === cur.date)) return null;
  const prev = st.plan?.days?.find((d) => d?.date === cur.date);
  if (!prev) return null;
  const ids = prev.stops.map((s) => s.id).filter((id) => statuses[id] !== "talked" && statuses[id] !== "notfit");
  return { date: cur.date, from: prev.from, ids };
}

// The tour's clock (fix5-plan, F9): a visit logged for a day not yet started keeps that day's plan, but the tour's
// story is that Maya is out on Tuesday when she goes to Nomadic first. So once a day is being worked (st.current) and
// the real clock is before that day's window, the tour plans as if it were that day, at its window's start: the day is
// under way and the visit re-routes it (G4). Before any visit, and once the real clock is past that, the real clock.
// The web tour (ui/plan.js, via renderPlan's demo.now), the bake and the phone's guided demo all plan on it.
export function tourNow(st, windows, now) { // windows: windowsFor's (from in minutes)
  const w = st?.current && windows.find((x) => x.date === st.current.date);
  if (!w || !now) return now;
  return now.date < w.date || (now.date === w.date && now.min < w.from) ? { date: w.date, min: w.from } : now;
}

// The planner's input for a saved state, as ui/plan.js compute() builds it.
export function planInput({ routes, profile, st, now, cityName = "Austin" }) {
  const pool = buildPool({ routes, profile, statuses: st.statuses ?? {}, contacts: st.contacts ?? [], outcomes: st.outcomes ?? {}, famous: !!st.famous, cityName, deepOff: DEMO_DEEP_OFF });
  const windows = windowsFor(profile, { until: untilFor(pool.pinned, st.locks ?? []) }); // the usual week, out to every follow-up
  const input = { pool: pool.rows, statuses: pool.statuses, windows, visitMin: profile.visitMin, pinned: pool.pinned, frozen: frozenFor(st, windows, pool.statuses, now), locks: st.locks ?? [], now, previous: st.plan ?? null, areas: Boolean(profile.week) };
  return { pool, windows, input };
}

const pt = (lon, lat) => `${(+lon).toFixed(5)},${(+lat).toFixed(5)}`;

// The baked matrix ({points:[[lon, lat]], durations (min), distances (mi)}) → a fetchMatrix(coords) that answers any
// point set inside it in /api/matrix's shape, and throws for a point it doesn't hold (the planner then uses the
// labelled estimate for that set).
export function bakedMatrix(m) {
  const at = new Map(m.points.map(([lon, lat], i) => [pt(lon, lat), i]));
  return async (coords) => {
    const idx = coords.map(([lon, lat]) => at.get(pt(lon, lat)));
    if (idx.some((i) => i == null)) throw new Error("demo matrix: a point outside the baked table");
    return {
      durations: idx.map((i) => idx.map((j) => m.durations[i][j])),
      distances: idx.map((i) => idx.map((j) => m.distances[i][j])),
      source: "ors",
    };
  };
}

// The plan as ui/plan.js saves it (st.plan, the `previous` of the next re-plan).
const saved = (p) => ({ days: p.days, unscheduled: p.unscheduled, carried: p.carried, notes: p.notes });

// Walk the three states. fetchMatrix: bakedMatrix(…) (or a recorder in the bake). → {states:[{plan, pool}], stop1,
// followUp, profile, st}. `now` defaults to the real clock, as on the page.
// drive: a fourth state, the tour's drive-mode step (judge pass 3 N8): the first door of that day not yet done is logged
// Interested, back on the last day at 3 pm, as the tour types it; the bake routes its days on real roads.
export async function demoStates({ routes, profile, contact, fetchMatrix, now = nowStamp(), cityName = "Austin", drive = false }) {
  const cache = new Map();
  let st = { statuses: {}, outcomes: {}, contacts: contact ? [contact] : [], current: null, plan: null };
  const step = async () => {
    const { pool, input } = planInput({ routes, profile, st, now: tourNow(st, windowsFor(profile), now), cityName });
    const { plan } = await planOnRoads(input, { fetchMatrix, cache });
    st = { ...st, plan: saved(plan) };
    return { plan, pool, input };
  };
  const s0 = await step();
  const day0 = s0.plan.days.find((d) => !d.past && d.stops.length);
  // the showcased stop (DEMO_SHOWCASE) when it's on the first day, else that day's stop 1
  const stop1 = day0?.stops.find((s) => s.id === DEMO_SHOWCASE.id)?.id ?? day0?.stops[0]?.id ?? null;
  const followUp = s0.plan.days.at(-1)?.date ?? null; // Thursday: the last of her three days
  st = { ...st, statuses: { ...st.statuses, [stop1]: "visited" }, current: { date: day0.date, from: day0.from } };
  const s1 = await step();
  st = { ...st, outcomes: { ...st.outcomes, [stop1]: { result: "interested", followUp } } };
  const s2 = await step();
  if (!drive) return { states: [s0, s1, s2], stop1, followUp, st };
  const door = s2.plan.days.find((d) => d.date === day0.date)?.stops.find((s) => !st.statuses[s.id])?.id ?? null;
  if (!door) return { states: [s0, s1, s2], stop1, followUp, st };
  st = { ...st, statuses: { ...st.statuses, [door]: "visited" }, outcomes: { ...st.outcomes, [door]: { result: "interested", followUp, followUpTime: "15:00" } } };
  const s3 = await step();
  return { states: [s0, s1, s2, s3], stop1, followUp, st, driveDoor: door };
}

export function nowStamp(d = new Date()) {
  return { date: isoDate(d), min: d.getHours() * 60 + d.getMinutes() };
}

// A day's road key: its start and stops as [[lon, lat]] (what animate.js seedRoad / roadFor key on).
export const dayCoords = (day, venues) => [[day.start.lon, day.start.lat], ...day.stops.map((s) => [venues[s.id].lon, venues[s.id].lat])];
export const coordsKey = (coords) => coords.map(([lon, lat]) => pt(lon, lat)).join(";");
