// Doors planner (SPEC-V2 §6; H1 routing overhaul, K1 driving first and V4.1 top-heavy rank, docs/ROUTING-V3.md): turn a
// ranked pool of doors + the rep's free windows into days of stops, each day a loop home: a door is worth DOOR_MIN
// minutes of loop driving plus RANK_V × its rank value, a top-heavy curve of its place in the drinker's Qloo list
// (V4.1, the owner's choice 2026-10-22; routing "v4" keeps V4's linear RANK_MIN). Pure: no DOM,
// no I/O, no clock (the caller passes `now`). Covered by test/schedule.test.mjs, test/sweep-planner.test.mjs,
// test/sweep2.test.mjs; measured by scripts/sweep-routing.mjs.
//
// planDays({ pool, statuses, windows, visitMin, travel, pinned, frozen, locks, now, previous, routing?, v5? }) →
//   { days:[{date, day, from, to, leave, start, stops:[stop], mi, min, end, source, frozen, past}], unscheduled:[id],
//     carried:[id], notes:[{kind, text, …}], reasons:{id: {code, text, date?, mi?}} }
//   stop = {id, eta, depart, legMi, legMin, openAtArrival, hoursVerified, openUntil, source, pinned, carried, locked,
//           orderReason}
//   locked: the rep put the stop there (`locks`); it holds its day and its place (lockDay: its day only).
//   orderReason: "opens 3 pm" when the room opens after the stop before it is reached (or the day starts), so its
//     opening time set its place; else null; never on a frozen day.
//   leave: when the rep leaves the start: the window's start, or later when the day's first room opens later, or so a
//     later stop's wait stays within WAIT_MAX_MIN (F4: the window is when the rep is free, not when they must leave).
//   reasons: why each ranked door that is not on a day is not there, checked with the planner's own timing (R2 M1; H1:
//     the rules are time ones only). code "status" ("status: not a fit"), "closed" / "opens-after" / "closes-before" /
//     "brief" / "hours" (open at none of the windows: "closed Tuesday", "opens 5 pm, after your window"), "idle-hours"
//     ("opens 5 pm, after Tuesday's last stop"), "idle" ("Tuesday is free from 4:10 pm, but not long enough to get
//     there and visit"), "detour" ("adds 22 min of driving to Wednesday", K1: it fits a day as it stands, but adds more
//     than DOOR_MIN to the cheapest day's loop; `min` holds the number), "nearer" ("… has room for it only in place of a
//     stop nearer its route": in any stop's place the loop would be longer), "better" ("… only in place of a
//     better-ranked stop, for the same driving"), "kept" ("… only in place of a stop it already had": a re-plan keeps an
//     untouched day), "full" ("Tuesday had no time left for it"), "cap" ("Tuesday is at its limit of 3 doors a day": it
//     would add at most DOOR_MIN to a day at its cap, J1). With one window the day is "the day". No free door is left off
//     that adds at most DOOR_MIN to a day under its cap as the day stands (the planner's last step checks every place).
//   orderReason on a bottom-quarter stop says why it is there: "fills the time before Pinthouse Brewing, where you arrive at
//     1:36 pm" ("fills the wait until <door> opens at 4 pm" when the arrival is its opening), or "on the way:
//     adds 3 min of driving" (R2 Calacanis 2; K1).
// replanCost (with `previous`): {addedMi, droppedIds, movedIds, source} over the days after the current one (see the end).
//
// Inputs
// - pool: [{id, rank, lat, lon, parsedHours, …}] (rank 1 = best; null for a contact outside the ranked list).
//   Every pinned id must be in the pool.
// - statuses: {id: "visited" | "talked" | "notfit" | "removed"}; those doors are never scheduled (a follow-up pin
//   overrides "visited" and "talked", never "notfit" or "removed": "removed" is Remove from my plan, no reason given).
// - windows: [{date:"2026-10-13", day:"tuesday", from:840, to:960, start:{lat, lon, id?}, max?}], minutes from midnight.
//   max (J1): the most stops the day may hold, an integer from 1 (else no cap). Pins and locks count toward it and are
//   never taken off for it; a day whose pins pass it holds just those. The current (frozen) day is kept as the rep has it.
// - visitMin: minutes at each door. travel(a, b) → {min, mi, source}: estimateTravel (default) or matrixTravel(…).
// - pinned: [{id, kind:"contact" | "followup", date?}]. A contact with a date (a room added to a day, G3) is due on that
//   window only; without one, on any window.
// - frozen: {date, from?, ids:[…]}: the current day's stops in order, as the rep has them now (the caller removes
//   a removed stop). Kept as is while its visits are its first stops and its locks hold; later windows are re-planned.
//   A visit out of order (a stop marked visited or talked with unvisited stops before it): when the day hasn't
//   started (`now` before its window, or none) the day keeps its plan, the visit done in place at its planned time
//   (F9: Friday's stop logged Thursday night). Once it is under way, it re-routes the rest of the day (G4): the visits
//   first (the ones in order, then the others in the day's order), then the unvisited stops (skipped ones too)
//   re-planned from the last visit's door, around the day's locks, from the later of `now` and the last visit's end as
//   the day is timed; a "rerouted" note says so ({kind, mode: "now", id, date, at}). A stop that no longer fits comes
//   off the day and is carried (`carried`, a "carried" note), like a missed day's. A frozen id locked to another day
//   leaves it. The frozen day says whether it has begun (`begun`: false before its window opens).
// - locks: [{id, date, index}] (owner review 2, G4: drag = lock): the door is on that date's window at position
//   `index` (0-based) of the day's order. Several on a day keep their order, each at its index when the stops before
//   it allow. The other doors of the day (the previous plan's, then growth, as on other days) are ordered around them
//   by the same rules (open on arrival, inside the window, least driving: dayCost), and come off worst
//   first when they no longer fit; a locked door always stays, and where it breaks a rule it says so
//   (openAtArrival:false, or a "lock" note). A locked day is planned before the others, which plan around it. A lock
//   on a past window, on a marked door or on a door outside the pool is let go. index null locks the day only (a stop
//   dropped on a day's tab): the door is held on that day and placed where it fits best, never taken off it.
// - routing: "v4.1" (default) or "v4" (V4's linear rank weight, kept for comparison: ?routing=v4). v5: {rankV, k}
//   overrides RANK_V and RANK_K (the eval sweep's knobs, ?rankv=N in the app); the name matches the V5 branch's input.
// - now: {date, min}: windows that ended before it are past. previous: the plan being replaced (to find the doors
//   a past window missed: they go back to the pool, land in later days, and are listed in `carried`).
//
// Times on a stop are integer minutes from midnight; leg minutes are rounded up from a part minute, leg miles to one
// decimal, and the day's mi/min are the sums of the legs shown, so the list always adds up.
import { openMinutes, km, DAYS } from "./core.js";
import { niceDate } from "./profile.js";
import { crowdShare, TOD_MIN, HEAT_MIN } from "./culture.js";

export const EXCLUDED_STATUSES = new Set(["visited", "talked", "notfit", "removed"]);
const FINAL = new Set(["notfit", "removed"]); // no follow-up brings these back
export const ROAD_FACTOR = 1.35;
export const ESTIMATE_MPH = 18;
const MI_PER_KM = 0.621371;

// The objective (K1, owner's ruling 2026-10-12; docs/ROUTING-V3.md "V4: driving first"): give the rep time back. Each
// day is a loop: start → stops → back to the start. The drive home counts as driving but need not fit in the window
// (the time rules stay: open on arrival, a wait of at most WAIT_MAX_MIN, done END_SLACK_MIN before the window ends).
// A door is worth DOOR_MIN minutes of loop driving plus its rank's worth: one on the way home costs about nothing, one 15
// min further out costs about 30. V4.1 (the owner's choice 2026-10-22): rank adds RANK_V × v(r), top-heavy (below), so
// #1 is worth 45 minutes more than a door with no rank value and #1 over #50 about 35; V4 (routing "v4") added RANK_MIN
// × rankScore, linear (the owner's pick of 10 in V4's rank sweep). A plan's score is Σ worth less the loops' minutes.
// The last check still places every free door that adds at most DOOR_MIN to a day. Shape is no rule (a route may cross
// itself); the loop's minutes do the work. A cap (J1, windows[i].max) caps a day's doors; within it the same objective
// picks.
export const DOOR_MIN = 15;
// V4 (routing "v4"): the whole rank range, #1 to the last, is worth RANK_MIN minutes, linear in rank
export const RANK_MIN = 10;
// V4.1 (the owner's choice 2026-10-22, docs/ROUTING-V3.md "V4.1"): a door is worth DOOR_MIN + RANK_V × v(r) minutes,
// v(r) = 1 / (1 + (r − 1) / RANK_K) on r, its place in its drinker's raw Qloo list (pool.js rawRank; else its rank):
// #1 = 1, #2 = 0.94, #10 = 0.62, #50 = 0.23. Linear rank (V4) made #1 → #2 worth as much as #102 → #103; the curve,
// fitted to the median normalised Qloo affinity of the 36 shipped lists, makes the top of the list count.
export const RANK_V = 45;
export const RANK_K = 15;
export function rankCurve(rank, k = RANK_K) {
  return Number.isFinite(rank) ? 1 / (1 + (rank - 1) / k) : 0;
}
// a light soft pull toward each day's area centre (AREA_W per km): with it the loops are shorter and cross less (V4)
export const AREA_W = 0.5;
// travel.js asks one road matrix per window, over its start, its pins and the doors nearest its area centre (MATRIX_MAX
// 50 points): a door past the ROAD_SET nearest is timed on the estimate, so it costs OUT_PEN minutes more
export const ROAD_SET = 47;
export const OUT_PEN = 1;
const PIN_VALUE = 10000; // a contact or follow-up is placed first and never taken off for a door
const CARRY_TIE = 0.1; // a carried door wins ties
// iterated local search (Vansteenwegen et al. 2009): shake rounds for a new plan, for a re-plan, and how many rounds
// without a better plan end it
const ILS_ITERS = 12;
const ILS_ITERS_REPLAN = 6;
const ILS_STILL = 6;
const AREA_REACH_KM = 9;
const AREA_SLACK = 1.6;
const AREA_START_PULL = 2;
const LEAVE_STEP = 20;
const LEAVE_TRIES = 5;
const LOW_RANK = 0.75;
const EPS = 1e-6;
// moves between days and swaps look at the GRANULAR stops or free doors nearest a stop (Toth & Vigo 2003, granular
// neighbourhoods): far ones can't gain
const GRANULAR = 5;
// an empty day's seed looks at the SEED_NEAR free doors nearest each candidate (see seed())
const SEED_NEAR = 12;
const ROUND_SLACK = 2;
export const WAIT_MAX_MIN = 20;
// a stop reached this soon after its room opens is labelled "Just after opening: keep it short" (staff still setting up); judge
// passes 5 (#9) and 6 (#3): at 30 it was on 4 of 8 Friday stops, so 20
export const JUST_OPENED_MIN = 20;
// a gap longer than the planner lets a rep wait (WAIT_MAX_MIN) has to be filled; the reason states its length
const FILL_GAP_MIN = WAIT_MAX_MIN + 1;
// A planned day's last visit ends at least END_SLACK_MIN before its window closes: drive times vary (routed legs ran
// a couple of minutes over the matrix times in the demo bake).
export const END_SLACK_MIN = 5;
const STATUS_TEXT = { visited: "visited", talked: "already known", notfit: "not a fit", removed: "removed from the plan" };

const IX = Symbol("ix");
const keyOf = (p) => p?.id ?? p?.key ?? `${p?.lat},${p?.lon}`;
const byRankThenId = (a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const DAY_NAME = (d) => (d ? d[0].toUpperCase() + d.slice(1) : d);

// Straight-line distance × 1.35 road factor at 18 mph: the fallback whenever road times are unavailable.
export function estimateTravel(a, b) {
  const k = km(a, b);
  if (!Number.isFinite(k)) return { min: Infinity, mi: Infinity, source: "estimate" };
  const mi = k * MI_PER_KM * ROAD_FACTOR;
  return { min: (mi / ESTIMATE_MPH) * 60, mi, source: "estimate" };
}

// Road times from an ORS matrix (as /api/matrix returns it: minutes and miles, rows/cols in `keys` order). Points
// are looked up by id (doors) or key (starts: give the start an `id`); a missing pair falls back to the estimate.
export function matrixTravel({ keys, min, mi }, fallback = estimateTravel) {
  const idx = new Map(keys.map((k, i) => [k, i]));
  return (a, b) => {
    const i = idx.get(keyOf(a));
    const j = idx.get(keyOf(b));
    const m = i == null || j == null ? null : min?.[i]?.[j];
    const d = i == null || j == null ? null : mi?.[i]?.[j];
    if (typeof m !== "number" || !Number.isFinite(m) || typeof d !== "number" || !Number.isFinite(d)) return fallback(a, b);
    return { min: m, mi: d, source: "ors" };
  };
}

// Spans open on `day` (plus yesterday's past-midnight spans), as in core.openMinutes.
function spansOn(parsed, day) {
  const i = DAYS.indexOf(day);
  const prev = DAYS[(i + 6) % 7];
  return [...(parsed.days[day]?.spans ?? []), ...(parsed.days[prev]?.spans ?? []).filter((s) => s.to > 1440).map((s) => ({ from: 0, to: s.to - 1440 }))];
}

// "10 am", "3:30 pm", "noon", "midnight" (an opening span may run past midnight).
export function clockShort(min) {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  if (m === 0) return "midnight";
  if (m === 720) return "noon";
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h % 12 || 12}${mm ? ":" + String(mm).padStart(2, "0") : ""} ${h < 12 ? "am" : "pm"}`;
}

// Windows in date order, with which one is frozen (the current day) and which are past.
function windowStates(windows, frozen, now) {
  const wins = windows.map((w, i) => ({ ...w, i })).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.from - b.from || a.i - b.i));
  const frozenIdx = frozen ? wins.findIndex((w) => w.date === frozen.date && (frozen.from == null || w.from === frozen.from)) : -1;
  const isPast = (w, k) => (frozenIdx >= 0 && k < frozenIdx) || (frozenIdx !== k && now && (w.date < now.date || (w.date === now.date && w.to <= now.min)));
  return { wins, frozenIdx, isPast };
}
const openSometime = (w, r, visitMin) => {
  if (!r.parsedHours?.ok) return true;
  const m = openMinutes(r.parsedHours, w.day, w.from, w.to);
  return m === null || m >= visitMin;
};
// Doors a window can hold, roughly: a visit plus an 8-minute leg each.
const capacity = (w, visitMin) => Math.max(1, Math.floor((w.to - w.from) / (visitMin + 8)));
const centreOf = (pts, start) => {
  const s = start && Number.isFinite(start.lat) ? start : null;
  const n = pts.length + (s ? AREA_START_PULL : 0);
  if (!n) return null;
  const sum = (f) => pts.reduce((a, p) => a + p[f], 0) + (s ? s[f] * AREA_START_PULL : 0);
  return { lat: sum("lat") / n, lon: sum("lon") / n };
};

// Split the ranked doors across the windows to plan, by area (R1 F1): a capacity-bounded k-means on the map, one
// area per window, each area's centre pulled toward that window's start, a door only in an area whose window it is
// open in. It takes the best-ranked doors within AREA_REACH_KM of a start, about 1.6 × what the days can hold, and
// ignores statuses, so marking a door never moves the areas (and the road matrices keyed on them stay valid).
// rows: ranked best first. ks: indexes into wins. → {areaOf: Map(id → k), centres: Map(k → {lat, lon})}
function partition(rows, wins, ks, visitMin, isPin, mode = "regret", reachKm = AREA_REACH_KM) {
  let areaOf = new Map();
  const centres = new Map();
  if (!ks.length) return { areaOf, centres };
  const starts = ks.map((k) => wins[k].start).filter((s) => s && Number.isFinite(s.lat));
  const reach = (r) => !starts.length || starts.some((s) => km(s, r) <= reachKm);
  const room0 = new Map(ks.map((k) => [k, Math.ceil(capacity(wins[k], visitMin) * AREA_SLACK)]));
  const total = [...room0.values()].reduce((a, b) => a + b, 0);
  const P = [];
  for (const r of rows) {
    if (P.length >= total) break;
    if (isPin(r.id) || !Number.isFinite(r.rank) || !reach(r)) continue;
    const ok = ks.filter((k) => openSometime(wins[k], r, visitMin));
    if (ok.length) P.push({ r, ok });
  }
  if (ks.length === 1) {
    for (const p of P) areaOf.set(p.r.id, ks[0]);
    centres.set(ks[0], centreOf(P.map((p) => p.r), wins[ks[0]].start));
    return { areaOf, centres };
  }
  // first centres: equal slices of the doors by bearing around the start
  const o = starts.length ? centreOf(starts, null) : centreOf(P.map((p) => p.r), null);
  const cos = Math.cos(((o?.lat ?? 0) * Math.PI) / 180);
  const ang = (r) => Math.atan2(r.lat - o.lat, (r.lon - o.lon) * cos);
  const byAng = P.slice().sort((a, b) => ang(a.r) - ang(b.r) || (a.r.id < b.r.id ? -1 : 1));
  ks.forEach((k, i) => {
    const slice = byAng.slice(Math.floor((i * P.length) / ks.length), Math.floor(((i + 1) * P.length) / ks.length));
    centres.set(k, centreOf(slice.map((p) => p.r), wins[k].start));
  });
  for (let it = 0; it < 10; it++) {
    // regret order: the doors that lose most by not getting their nearest area are placed first, each in its
    // nearest area with room. Distance order (the closest pairs first) can let a small area take every door by the
    // start and leave a larger one a ring around the town; planDays tries both.
    const room = new Map(room0);
    const got = new Map();
    if (mode === "regret") {
      const prefs = P.map((p) => {
        const ds = p.ok.map((k) => ({ k, d: km(p.r, centres.get(k)) })).sort((a, b) => a.d - b.d || a.k - b.k);
        return { p, ds, regret: ds.length > 1 ? ds[1].d - ds[0].d : Infinity };
      }).sort((a, b) => b.regret - a.regret || a.p.r.rank - b.p.r.rank);
      for (const { p, ds } of prefs) {
        const to = ds.find(({ k }) => room.get(k) > 0);
        if (!to) continue;
        got.set(p.r.id, to.k);
        room.set(to.k, room.get(to.k) - 1);
      }
    } else {
      // distance order: the closest (door, area) pairs first
      const pairs = [];
      for (const p of P) for (const k of p.ok) pairs.push({ p, k, d: km(p.r, centres.get(k)) });
      pairs.sort((a, b) => a.d - b.d || a.p.r.rank - b.p.r.rank || a.k - b.k);
      for (const { p, k } of pairs) {
        if (got.has(p.r.id) || room.get(k) <= 0) continue;
        got.set(p.r.id, k);
        room.set(k, room.get(k) - 1);
      }
    }
    const same = got.size === areaOf.size && [...got].every(([id, k]) => areaOf.get(id) === k);
    areaOf = got;
    for (const k of ks) centres.set(k, centreOf(P.filter((p) => got.get(p.r.id) === k).map((p) => p.r), wins[k].start) ?? centres.get(k));
    if (same) break;
  }
  heatFirst(P, wins, ks, visitMin, areaOf, centres);
  return { areaOf, centres };
}

// R9 deep heat (lib/culture.js): "work this part of town first". The area holding the most doors in the top hoods of
// Qloo's heatmap for the brand's fans (r.heat) takes the first day, swapped with the area that had it, only when the
// two days are interchangeable (same hours, same start) and every door of both is open on the other day. Rows with no
// r.heat (signal off, no heatmap): no change.
function heatFirst(P, wins, ks, visitMin, areaOf, centres) {
  if (ks.length < 2 || !P.some((p) => p.r.heat)) return;
  const hot = (k) => P.reduce((n, p) => n + (areaOf.get(p.r.id) === k ? p.r.heat ?? 0 : 0), 0);
  const k1 = ks[0];
  const kh = ks.reduce((b, k) => (hot(k) > hot(b) ? k : b), k1);
  if (kh === k1 || hot(kh) <= hot(k1)) return;
  const a = wins[k1], b = wins[kh];
  const same = (x, y) => (!x && !y) || (x && y && x.lat === y.lat && x.lon === y.lon);
  if (a.from !== b.from || a.to !== b.to || !same(a.start, b.start)) return;
  const ids = P.filter((p) => areaOf.get(p.r.id) === k1 || areaOf.get(p.r.id) === kh);
  // a door open on only one of the two days keeps its day
  for (const p of ids) if (p.ok.includes(k1) && p.ok.includes(kh)) areaOf.set(p.r.id, areaOf.get(p.r.id) === k1 ? kh : k1);
  const c1 = centres.get(k1);
  centres.set(k1, centres.get(kh));
  centres.set(kh, c1);
}

// fill "week": the areas week by week, each week's from the best-ranked doors the weeks before did not take (partition
// takes them by rank, as many as the week's days hold). rowsOf(ks) → the rows a week's days may take (planOnce: the
// doors the week took); else the ones no earlier week's areas hold.
function partitionWeeks(rows, wins, ks, visitMin, isPin, rowsOf = null) {
  const areaOf = new Map();
  const centres = new Map();
  const byWeek = new Map();
  for (const k of ks) byWeek.set(weekOf(wins[k].date), [...(byWeek.get(weekOf(wins[k].date)) ?? []), k]);
  for (const wk of [...byWeek.keys()].sort()) {
    const got = partition(rowsOf ? rowsOf(wk) : rows.filter((r) => !areaOf.has(r.id)), wins, byWeek.get(wk), visitMin, isPin);
    for (const [id, k] of got.areaOf) areaOf.set(id, k);
    for (const [k, c] of got.centres) centres.set(k, c);
  }
  return { areaOf, centres };
}

// Each window to plan → its area: {date, from, centre:{lat, lon}, ids} (the doors the partition gave it). The same
// split planDays uses, for callers that key road matrices on areas (travel.js).
export function areasFor({ pool = [], windows = [], visitMin = 25, pinned = [], frozen = null, now = null, fill = globalThis.DOORS_FILL ?? FILL } = {}) {
  const rows = pool.filter((r) => r && r.id != null && Number.isFinite(r.lat) && Number.isFinite(r.lon)).slice().sort(byRankThenId);
  const pinIds = new Set(pinned.filter(Boolean).map((p) => p.id));
  const { wins, frozenIdx, isPast } = windowStates(windows, frozen, now);
  const ks = wins.map((w, k) => k).filter((k) => k !== frozenIdx && !isPast(wins[k], k));
  const { areaOf, centres } = (fill === "area" ? partition : partitionWeeks)(rows, wins, ks, visitMin, (id) => pinIds.has(id));
  return ks.map((k) => ({ date: wins[k].date, from: wins[k].from, centre: centres.get(k), ids: rows.filter((r) => areaOf.get(r.id) === k).map((r) => r.id) }));
}

// Which doors a week's days may take (owner, 2026-10-23: "fill by rank, then route"). fill "week" (the default): each
// calendar week in date order takes the best-ranked free doors, as many as its days hold (WEEK_SLACK more: some of the
// top are in no area a day reaches), and its days plan as before on that set: an area a day, worth vs driving (V4.1,
// K1). A door the week took and placed is the week's; one it took but could not place stays free for the weeks after.
// Pins, locks, carried and unranked doors are never held back. A re-plan keeps each week's doors from the previous
// plan (F1b) and fills only what changed from the top. fill "area" (?fill=area): the whole plan's worth vs driving
// decides alone, as before.
export const FILL = "week";
export const WEEK_SLACK = 1.5;
const weekOf = (date) => {
  const d = new Date(date + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // its Monday
  return d.toISOString().slice(0, 10);
};
export function planDays(input = {}) {
  const fill = input.fill ?? globalThis.DOORS_FILL ?? FILL;
  const plan = planCapped(input, fill === "area" ? planOnce : planWeeks);
  return input.areas ? areaDays(input, plan) : plan;
}

// Area days (Jard 10-24: "make more strategic decisions about how we are going to tackle the city"; input.areas, the
// usual week's plans): after the plan's first week, the doors the worth rule left off (a detour: too far for one door)
// are grouped by neighbourhood, and a day with no ranked door of its own (empty, or only follow-ups and locks) becomes
// one area's day: the drive out is paid once for the group. The first week and a one-week plan are exactly as before;
// a door closed in the rep's hours stays off with its reason. A day it changes carries area: {ids} (the group's doors).
export const AREA_DOOR_MIN = 240; // a door's worth on an area day: the day goes out for its group, as many as the hours fit
export const AREA_KM = 8; // an area: the group's doors within this of its centre
export const AREA_MIN_DOORS = 2; // no day out for one door
const TIME_CODES = new Set(["status", "closed", "opens-after", "closes-before", "brief", "hours", "idle-hours", "idle"]);
export const AREA_MAX_MIN = 50; // nor for a day of more than this much driving a door (the loop's minutes ÷ its doors)
function areaDays(input, plan) {
  const { pool = [], windows = [], frozen = null, now = null, pinned = [], locks = [] } = input;
  const { wins, frozenIdx, isPast } = windowStates(windows, frozen, now);
  const ahead = wins.filter((w, k) => k !== frozenIdx && !isPast(w, k));
  const weeks = [...new Set(ahead.map((w) => weekOf(w.date)))].sort();
  if (weeks.length < 2) return plan;
  const byId = new Map(pool.filter((r) => r && r.id != null && Number.isFinite(r.lat) && Number.isFinite(r.lon)).map((r) => [r.id, r]));
  const held = new Set([...pinned.map((p) => p?.id), ...(locks ?? []).map((l) => l?.id)]);
  const days = plan.days.slice();
  // the days an area can have: after the first week, holding no ranked door of their own
  const targets = ahead
    .filter((w) => weekOf(w.date) !== weeks[0])
    .map(({ k, i, ...w }) => ({ w, n: days.findIndex((d) => d && d.date === w.date && d.from === w.from) }))
    .filter(({ n }) => n >= 0 && !days[n].past && !days[n].frozen && days[n].stops.every((s) => s.pinned || s.locked));
  // the doors left: off the plan for its driving or its room (a re-plan reads "kept" or "better" where a new plan reads
  // "detour"), never for their hours or status
  const left = Object.entries(plan.reasons ?? {})
    .filter(([id, r]) => r?.code && !TIME_CODES.has(r.code) && byId.has(id) && Number.isFinite(byId.get(id).rank) && !held.has(id))
    .map(([id]) => byId.get(id))
    .sort(byRankThenId);
  if (!targets.length || left.length < AREA_MIN_DOORS) return plan;
  // the groups: the best-ranked door left, with the others within AREA_KM of the group's centre
  const groups = [];
  const rest = left.slice();
  while (rest.length) {
    const seed = rest.shift();
    let g = [seed];
    let c = { lat: seed.lat, lon: seed.lon };
    for (let it = 0; it < 3; it++) (g = [seed, ...rest.filter((r) => km(c, r) <= AREA_KM)]), (c = centreOf(g, null));
    for (const r of g.slice(1)) rest.splice(rest.indexOf(r), 1);
    if (g.length >= AREA_MIN_DOORS) groups.push(g);
  }
  const reasons = { ...(plan.reasons ?? {}) };
  const placed = new Set();
  for (const { w, n } of targets) {
    const day = days[n];
    const own = day.stops.map((s) => byId.get(s.id)).filter(Boolean);
    for (let j = 0; j < groups.length; j++) {
      const g = groups[j];
      const sub = planOnce({ ...input, windows: [w], pool: [...own, ...g], pinned: pinned.filter((p) => p && own.some((r) => r.id === p.id)), locks: (locks ?? []).filter((l) => l?.date === w.date), frozen: null, now: null, previous: null, weekFill: null, doorMin: AREA_DOOR_MIN, reachKm: Infinity });
      const d = sub.days[0];
      const ids = (d?.stops ?? []).map((s) => s.id).filter((id) => g.some((r) => r.id === id));
      if (ids.length < AREA_MIN_DOORS || d.min > AREA_MAX_MIN * d.stops.length || own.some((r) => !d.stops.some((s) => s.id === r.id))) continue;
      days[n] = { ...d, area: { ids } };
      for (const id of ids) placed.add(id), delete reasons[id];
      groups.splice(j, 1);
      break;
    }
    if (!groups.length) break;
  }
  if (!placed.size) return plan;
  return { ...plan, days, reasons, unscheduled: (plan.unscheduled ?? []).filter((id) => !placed.has(id)) };
}

function planWeeks(input) {
  const { pool = [], statuses = {}, windows = [], pinned = [], frozen = null, locks = [], now = null, previous = null } = input;
  const visitMin = input.visitMin ?? 25;
  const rows = pool.filter((r) => r && r.id != null && Number.isFinite(r.lat) && Number.isFinite(r.lon)).slice().sort(byRankThenId);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const { wins, frozenIdx, isPast } = windowStates(windows, frozen, now);
  const ahead = wins.filter((w, k) => k !== frozenIdx && !isPast(w, k));
  const weeks = [...new Set(ahead.map((w) => weekOf(w.date)))].sort();
  const pinIds = new Set(pinned.filter((p) => p && byId.has(p.id)).map((p) => p.id));
  const followup = new Set(pinned.filter((p) => p?.kind === "followup").map((p) => p.id));
  const excluded = (id) => EXCLUDED_STATUSES.has(statuses[id]) && !(followup.has(id) && !FINAL.has(statuses[id]));
  // the locks planOnce keeps (G4): on a door in the pool, not marked, on a day not past
  const lockIds = new Set((locks ?? []).filter((l) => l && byId.has(l.id) && !excluded(l.id) && wins.some((w, k) => w.date === l.date && !isPast(w, k))).map((l) => l.id));
  const taken = new Set(frozen?.ids ?? []);
  // never held back: a pin, a lock, an unranked door (it only ever goes on as on the way), a carried door
  const exempt = (r) => pinIds.has(r.id) || lockIds.has(r.id) || !Number.isFinite(r.rank);
  const free = (r) => !taken.has(r.id) && !excluded(r.id) && !exempt(r);
  // the previous plan's doors on each week's days ahead (F1b: a re-plan keeps them there)
  const before = new Map();
  for (const d of previous?.days ?? []) if (d && !d.past && !d.frozen && d.date) for (const s of d.stops ?? []) if (!before.has(s.id)) before.set(s.id, weekOf(d.date));
  if (!ahead.length) return planOnce(input);
  const allowed = new Map(); // id → its week
  const done = new Set(); // doors a week took and placed
  // fix13: the previous plan's sets (plan.weeks), for the weeks whose days are as they were: a reopened plan re-plans on
  // the same sets (re-deriving them from its days counted the on-the-way doors as the week's: 30 doors became 32)
  const daysSig = (ws) => ws.map((w) => `${w.date} ${w.from}-${w.to} ${w.start ? `${w.start.lat},${w.start.lon}` : ""}`).join("|");
  const stored = new Set(Object.values(previous?.weeks ?? {}).flatMap((x) => x?.ids ?? []));
  const out = {}; // wk → {days, ids}: the plan's weeks
  weeks.forEach((wk, n) => {
    const ws = ahead.filter((w) => weekOf(w.date) === wk).map(({ k, i, ...w }) => w);
    const dates = new Set(ws.map((w) => w.date));
    const sub = { ...input, windows: ws, frozen: null, now: null, pinned: pinned.filter((p) => p && !done.has(p.id)), locks: (locks ?? []).filter((l) => l && dates.has(l.date)) };
    const left = rows.filter((r) => !done.has(r.id) && !taken.has(r.id) && !excluded(r.id));
    const reach = (r) => ws.some((w) => openSometime(w, r, visitMin));
    const was = previous?.weeks?.[wk];
    if (was && Array.isArray(was.ids) && was.days === daysSig(ws)) {
      // the week keeps its doors; one marked or gone since is replaced by the best-ranked free door no week holds
      const keep = left.filter((r) => free(r) && was.ids.includes(r.id) && reach(r));
      const lost = was.ids.filter((id) => !byId.has(id) || (excluded(id) && !taken.has(id)) || (!taken.has(id) && !exempt(byId.get(id)) && !reach(byId.get(id)))).length;
      const top = lost ? left.filter((r) => free(r) && !stored.has(r.id) && !allowed.has(r.id) && reach(r)).slice(0, lost) : [];
      for (const r of [...keep, ...top]) allowed.set(r.id, wk), done.add(r.id);
      if (top.length && n < weeks.length - 1) {
        const got = planOnce({ ...sub, pool: left.filter((r) => !free(r) || allowed.get(r.id) === wk), weekFill: { weekOf, allowed } });
        const on = new Set(got.days.flatMap((d) => (d?.stops ?? []).map((s) => s.id)));
        for (const r of top) if (!on.has(r.id)) allowed.delete(r.id), done.delete(r.id);
      }
      out[wk] = { days: daysSig(ws), ids: [...keep, ...top].filter((r) => allowed.get(r.id) === wk).map((r) => r.id) };
      return;
    }
    // as many as the week holds when it may take any free door
    const all = planOnce({ ...sub, pool: left, quick: true });
    const held = all.days.reduce((a, d) => a + (d?.stops ?? []).filter((s) => free(byId.get(s.id))).length, 0);
    const want = Math.ceil(held * WEEK_SLACK);
    const kept = left.filter((r) => free(r) && before.get(r.id) === wk && reach(r));
    const top = left.filter((r) => free(r) && !kept.includes(r) && reach(r)).slice(0, Math.max(0, want - kept.length));
    const set = [...kept, ...top];
    for (const r of set) allowed.set(r.id, wk);
    if (n < weeks.length - 1) {
      const got = planOnce({ ...sub, pool: left.filter((r) => !free(r) || allowed.get(r.id) === wk), weekFill: { weekOf, allowed } });
      const on = new Set(got.days.flatMap((d) => (d?.stops ?? []).map((s) => s.id)));
      for (const r of set) on.has(r.id) ? done.add(r.id) : allowed.delete(r.id);
    }
    out[wk] = { days: daysSig(ws), ids: set.filter((r) => allowed.get(r.id) === wk).map((r) => r.id) };
  });
  let plan = planOnce({ ...input, weekFill: { weekOf, allowed } });
  // a door a week took that the plan's days could not place (the week's own plan did) goes to the next week open for
  // it, ahead of that week's lower-ranked doors (fix13: Las Perlas #33 sat off the plan while week 2 held #38–#50)
  for (let n = 0; n < 2 * weeks.length; n++) {
    const on = new Set(plan.days.flatMap((d) => (d?.stops ?? []).map((s) => s.id)));
    let moved = false;
    for (const [id, wk] of allowed) {
      if (on.has(id)) continue;
      const r = byId.get(id);
      const next = weeks.slice(weeks.indexOf(wk) + 1).find((x) => ahead.some((w) => weekOf(w.date) === x && openSometime(w, r, visitMin)));
      if (next) (allowed.set(id, next), (moved = true));
    }
    if (!moved) break;
    plan = planOnce({ ...input, weekFill: { weekOf, allowed } });
  }
  for (const wk of Object.keys(out)) out[wk].ids = rows.filter((r) => allowed.get(r.id) === wk).map((r) => r.id);
  return { ...plan, weeks: out };
}

// A cap a day never reaches changes nothing for that day (J1, main's ruling on owner review 5): the week is planned
// without caps, then again holding only the caps it passed, until no free day passes its own (a held cap can push
// doors onto another day). With no cap passed this is the uncapped plan, exactly; at most windows + 1 runs.
function planCapped(input = {}, run = planOnce) {
  const windows = input.windows ?? [];
  const capped = (w) => Number.isInteger(w?.max) && w.max >= 1;
  if (!windows.some(capped)) return run(input);
  const free = (w) => {
    const { max, ...rest } = w;
    return rest;
  };
  const held = new Set();
  for (;;) {
    const plan = run({ ...input, windows: windows.map((w, i) => (held.has(i) || !capped(w) ? w : free(w))) });
    const over = windows.map((w, i) => i).filter((i) => {
      const w = windows[i];
      if (held.has(i) || !capped(w)) return false;
      const d = plan.days.find((x) => x && x.date === w.date && x.from === w.from);
      return d && !d.past && !d.frozen && d.stops.length > w.max;
    });
    if (!over.length) return plan;
    for (const i of over) held.add(i);
  }
}

// doorMin, reachKm (area days, areaDays below): a door's base worth in minutes of loop driving and how far from the start
// the day's area may reach; DOOR_MIN and AREA_REACH_KM everywhere else.
function planOnce({ pool = [], statuses = {}, windows = [], visitMin = 25, travel = estimateTravel, pinned = [], frozen = null, locks = [], now = null, previous = null, routing = "v4.1", v5 = null, weekFill = null, quick = false, doorMin = DOOR_MIN, reachKm = AREA_REACH_KM } = {}) {
  const V4 = routing === "v4";
  const rankV = Number.isFinite(v5?.rankV) ? v5.rankV : RANK_V;
  const rankK = Number.isFinite(v5?.k) && v5.k > 0 ? v5.k : RANK_K;
  // the doors, each with its index in the travel table (IX)
  const rows = pool.filter((r) => r && r.id != null && Number.isFinite(r.lat) && Number.isFinite(r.lon)).slice().sort(byRankThenId).map((r, i) => ({ ...r, [IX]: i }));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ranks = rows.map((r) => r.rank).filter(Number.isFinite);
  const maxRank = ranks.length ? Math.max(...ranks) : 1;
  const notes = [];

  // ---- travel, memoised (by point, as a table) and rounded once so every timing adds up ----
  const NO_LEG = { min: 0, mi: 0, source: null };
  const ix = new Map(); // other points (the starts) → their index, after the doors'
  const legTab = [];
  const indexOf = (p) => {
    let i = p[IX] ?? ix.get(p);
    if (i === undefined) ix.set(p, (i = rows.length + ix.size));
    return i;
  };
  const leg = (a, b) => {
    if (!a) return NO_LEG;
    const row = (legTab[a[IX] ?? indexOf(a)] ??= []);
    const j = b[IX] ?? indexOf(b);
    let v = row[j];
    if (!v) {
      const t = travel(a, b);
      const mi = Math.round(t.mi * 10) / 10;
      const min = Number.isFinite(t.min) ? (t.min > 0 ? Math.max(1, Math.round(t.min)) : 0) : Infinity;
      v = row[j] = { min, mi, source: t.source };
    }
    return v;
  };

  // the minutes alone, from a flat table (the hot paths ask for nothing else); a point past it falls back to leg()
  const NPTS = rows.length + 2 * windows.length + 16;
  const minTab = new Float64Array(NPTS * NPTS).fill(-1);
  const legMin = (a, b) => {
    if (!a) return 0;
    const i = a[IX] ?? indexOf(a);
    const j = b[IX] ?? indexOf(b);
    if (i >= NPTS || j >= NPTS) return leg(a, b).min;
    const at = i * NPTS + j;
    const m = minTab[at];
    return m >= 0 ? m : (minTab[at] = leg(a, b).min);
  };

  // ---- pins ----
  const pins = new Map();
  for (const p of pinned) {
    if (!p || p.id == null) continue;
    if (!byId.has(p.id)) {
      notes.push({ kind: "pin-missing", id: p.id, text: `A ${p.kind === "followup" ? "follow-up" : "contact"} is not in the pool, so it is not scheduled.` });
      continue;
    }
    const cur = pins.get(p.id);
    if (!cur || (p.kind === "followup" && cur.kind !== "followup")) pins.set(p.id, p);
  }
  // a contact is due on any window, or only on its date when it has one; a follow-up on or after its date
  const dueOn = (p, w) => (p.kind === "contact" ? p.date == null || p.date === w.date : p.date == null || p.date <= w.date);
  const excluded = (id) => {
    const s = statuses[id];
    if (!EXCLUDED_STATUSES.has(s)) return false;
    return !(pins.get(id)?.kind === "followup" && !FINAL.has(s));
  };
  // ---- windows: past, frozen (current), to plan ----
  const { wins, frozenIdx, isPast } = windowStates(windows, frozen, now);
  // a day's cap on its stops (J1, windows[i].max: an integer 1–20; else none). Pins and locks count toward it and are
  // never taken off for it; no free door joins a day at its cap.
  const capOf = (k) => (Number.isInteger(wins[k].max) && wins[k].max >= 1 ? wins[k].max : Infinity);
  // fill "week" (planDays): a free ranked door may go only on a day of the week that took it; pins, locks, carried and
  // unranked doors on any day
  const weekOk = (k, r) => !weekFill || !Number.isFinite(r.rank) || pins.has(r.id) || lockOf.has(r.id) || carriedSet.has(r.id) || weekFill.allowed.get(r.id) === weekFill.weekOf(wins[k].date);
  // a day ahead is a loop back to its start (K1); the current day is kept as the rep has it
  wins.forEach((w, k) => {
    if (k === frozenIdx || isPast(w, k) || !w.start || !Number.isFinite(w.start.lat)) return;
    w.home = { ...w.start };
    w.home[IX] = indexOf(w.home); // its own row in the travel table (the planner's copy; the caller's start is untouched)
  });

  // Opening spans that hold a visit, by door and day, cached (the planner asks for them thousands of times a plan).
  const spanTab = new Map(DAYS.map((d) => [d, new Map()]));
  const spansFor = (r, day) => {
    const tab = spanTab.get(day);
    let v = tab.get(r);
    if (!v) tab.set(r, (v = spansOn(r.parsedHours, day).filter((s) => s.to - s.from >= visitMin).sort((a, b) => a.from - b.from)));
    return v;
  };
  // minutes open in [a, b] (core.openMinutes), at once when one span holds it all
  const openFor = (r, day, a, b) => (spansFor(r, day).some((s) => s.from <= a && b <= s.to) ? b - a : openMinutes(r.parsedHours, day, a, b));
  // When a visit arriving at `t` can start, and until when its room stays open: {eta, until}; within `maxWait` of t
  // (Infinity: any later opening); null when it can't. Hours unknown: at once, open till whenever.
  const startAt = (r, day, t, maxWait) => {
    if (!r.parsedHours?.ok) return { eta: t, until: Infinity };
    for (const s of spansFor(r, day)) {
      if (s.to - visitMin < t) continue;
      const eta = Math.max(t, s.from);
      if (eta - t > maxWait) return null;
      return { eta, until: s.to };
    }
    return null;
  };

  // Simulate a sequence on a window: timings, or null when a door can't be visited open (a wait of at most
  // WAIT_MAX_MIN) or the day overruns (less END_SLACK_MIN).
  // strict (a day being planned): the rep may leave the start any time from the window's start: the first door may
  // set it (no wait: the rep leaves later), and when a later door would mean a wait over WAIT_MAX_MIN the departure
  // moves later by the difference (as long as every stop before stays open). A fixed departure (w.leaveMin: the
  // current day, a locked day) is kept.
  // strict false: timed as the rep drives it, without waiting. "frozen": the current day as the rep has it, from its
  // kept departure, waiting up to WAIT_MAX_MIN where a room isn't open yet, never rejecting a stop.
  const simulate = (w, seq, strict = true) => {
    const frozenMode = strict === "frozen";
    strict = strict === true;
    const fixed = (strict || frozenMode) && w.leaveMin != null;
    let leave = fixed ? w.leaveMin : w.from;
    for (let tries = 0; tries <= seq.length + 1; tries++) {
      let t = leave;
      let cur = w.start ?? null;
      const out = [];
      let later = 0;
      for (const r of seq) {
        const l = leg(cur, r);
        let eta = t + l.min;
        let waitMin = 0;
        const p = r.parsedHours;
        let open = null;
        let openUntil = null;
        let openFrom = null;
        if (p?.ok) {
          let m = openFor(r, w.day, eta, eta + visitMin);
          if ((strict || frozenMode) && m !== null && m < visitMin) {
            const first = out.length === 0 && !fixed && strict;
            const next = spansFor(r, w.day).find((s) => s.from > eta);
            if (next && (first || next.from - eta <= WAIT_MAX_MIN)) {
              if (!first) waitMin = next.from - eta;
              eta = next.from;
              m = openFor(r, w.day, eta, eta + visitMin);
            } else if (next && strict && !fixed) {
              later = next.from - eta - WAIT_MAX_MIN; // leave later by this much and the wait is WAIT_MAX_MIN
              break;
            }
          }
          if (m !== null) {
            open = m >= visitMin;
            const span = spansFor(r, w.day).find((s) => s.from <= eta && eta < s.to) ?? spansOn(p, w.day).find((s) => s.from <= eta && eta < s.to);
            openUntil = span?.to ?? null;
            openFrom = span?.from ?? null;
          }
        }
        const depart = eta + visitMin;
        if (strict && (open === false || depart > w.to - END_SLACK_MIN || !Number.isFinite(eta))) return null;
        out.push({ r, eta, depart, l, open, openUntil, openFrom, waitMin, leave: out.length ? out[0].leave : eta - waitMin - l.min });
        t = depart;
        cur = r;
      }
      if (!later) return out;
      // the first stop sets the departure: move it later from there
      leave = Math.max(leave, (out[0]?.leave ?? leave)) + later;
    }
    return null;
  };
  const fits = (w, seq) => Boolean(simulate(w, seq));
  const travelMin = (w, seq) => {
    let s = 0;
    let cur = w.start ?? null;
    for (const r of seq) (s += legMin(cur, r)), (cur = r);
    return s;
  };
  // A planned day's loop (K1): its driving and the drive home (w.home: the start; none on the current, frozen day).
  const loopMin = (w, seq) => travelMin(w, seq) + (w.home && seq.length ? legMin(seq.at(-1), w.home) : 0);
  // A day's cost: its loop's minutes (shape is no rule; crossings and doubling back cost only the time).
  const dayCost = loopMin;

  // Rank score runs from 1 (#1) to 0 (last ranked).
  const rankScore = (r) => (Number.isFinite(r.rank) ? (maxRank > 1 ? ((maxRank - r.rank) / (maxRank - 1)) : 1) : 0);
  // A door's worth in minutes of loop driving: V4.1 DOOR_MIN + RANK_V × v(raw rank); V4 DOOR_MIN + RANK_MIN × rankScore
  const worth = V4 ? (r) => doorMin + RANK_MIN * rankScore(r) : (r) => doorMin + (Number.isFinite(r.rank) ? rankV * rankCurve(Number.isFinite(r.rawRank) ? r.rawRank : r.rank, rankK) : 0);

  // ---- locks (G4): a door the rep put on a day holds its place there; the day's other doors are ordered around it ----
  const lockOf = new Map(); // id → {k, index}
  for (const l of locks ?? []) {
    if (!l || !byId.has(l.id) || excluded(l.id) || (l.index != null && !(Number.isInteger(l.index) && l.index >= 0))) continue;
    const k = wins.findIndex((w, j) => w.date === l.date && !isPast(w, j));
    if (k >= 0) lockOf.set(l.id, { k, index: l.index ?? null, n: lockOf.size });
  }
  // a day's locks by index, then in the order given
  const locksOn = (k) => [...lockOf].filter(([, l]) => l.k === k && l.index != null).sort(([, a], [, b]) => a.index - b.index || a.n - b.n).map(([id, l]) => ({ r: byId.get(id), index: l.index }));
  // a day's day-only locks (index null): held on the day, placed like its free doors, never taken off
  const dayLocksOn = (k) => [...lockOf].filter(([, l]) => l.k === k && l.index == null).map(([id]) => byId.get(id));
  const dayLocked = (r) => lockOf.get(r.id)?.index === null;
  // The day after its first h stops: the locked doors L (by index) at their indexes, the free doors U in order in the
  // places between (a lock moves up when too few doors come before it).
  const mergeLocks = (h, U, L) => {
    const out = [];
    let u = 0;
    let l = 0;
    while (u < U.length || l < L.length) out.push(l < L.length && (L[l].index <= h + out.length || u >= U.length) ? L[l++].r : U[u++]);
    return out;
  };
  // An order of U around L, timed from {at, t} (a door or the start, and a minute): `bad` counts the stops closed on
  // arrival or past the window's end (less END_SLACK_MIN), a free door's ×10 (taking it off or moving it fixes it);
  // `cost` is dayCost from `at`. Timed as the current day is (waits up to WAIT_MAX_MIN, never rejects a stop).
  const lockEval = (w, h, U, L, from) => {
    const seq = mergeLocks(h, U, L);
    const tw = { ...w, start: from.at ?? undefined, leaveMin: from.t };
    const sim = simulate(tw, seq, "frozen");
    let bad = 0;
    let lockBad = 0;
    for (const x of sim) {
      const lk = L.some((l) => l.r === x.r);
      const n = lk ? 1 : 10;
      if (x.open === false) (bad += n), (lockBad += lk);
      if (x.depart > w.to - END_SLACK_MIN) (bad += n), (lockBad += lk);
    }
    return { U, seq, sim, bad, lockBad, cost: dayCost(tw, seq) };
  };
  const lockBetter = (a, b) => a.bad < b.bad || (a.bad === b.bad && a.cost < b.cost - 1e-9);
  // The best order of U: single-door moves and reversals (as untangle), from U's own order and from nearest-next.
  const lockImprove = (w, h, U, L, from) => {
    const nn = [];
    for (let cur = from.at, left = U.slice(); left.length; ) {
      const i = cur ? left.reduce((b, r, j) => (legMin(cur, r) < legMin(cur, left[b]) ? j : b), 0) : 0;
      cur = left[i];
      nn.push(...left.splice(i, 1));
    }
    let out = null;
    for (const U0 of [U, nn]) {
      let best = lockEval(w, h, U0, L, from);
      for (let improved = true, guard = 0; improved && guard < 60; guard++) {
        improved = false;
        const cur = best.U;
        for (let i = 0; i < cur.length && !improved; i++) {
          const rest = [...cur.slice(0, i), ...cur.slice(i + 1)];
          for (let j = 0; j <= rest.length && !improved; j++) {
            if (j === i) continue;
            const e = lockEval(w, h, [...rest.slice(0, j), cur[i], ...rest.slice(j)], L, from);
            if (lockBetter(e, best)) (best = e), (improved = true);
          }
        }
        for (let i = 0; i < cur.length - 1 && !improved; i++)
          for (let k = i + 1; k < cur.length && !improved; k++) {
            const e = lockEval(w, h, [...cur.slice(0, i), ...cur.slice(i, k + 1).reverse(), ...cur.slice(k + 1)], L, from);
            if (lockBetter(e, best)) (best = e), (improved = true);
          }
      }
      if (!out || lockBetter(best, out)) out = best;
    }
    return out;
  };
  // lockImprove, then free doors come off while a stop still breaks a rule: the one whose loss costs least (its value,
  // its worth, less the driving it saves). A contact or follow-up comes off last (judge pass 3 N1: as on any day, a pin
  // goes before the free doors): while the day's pins and locks alone break fewer rules, a free door comes off even
  // when that alone doesn't mend the day yet. → {…, dropped}
  // fix12: a lock holds its index. With fewer free doors than its index needs, mergeLocks moves it up, which can make
  // it open (a 3 pm closer locked second on a 2 pm day is open first); that is no mend, so while the day has the doors
  // to keep every lock at its index, an order that moves one up still counts the locks' breaks as they were, and a
  // free door comes off for it only when that mends a free stop (else the day emptied, door by door).
  const lockNeed = (h, L) => L.reduce((m, l, j) => Math.max(m, l.index - h - j), 0);
  const lockArrange = (w, h, U, L, from) => {
    let best = lockImprove(w, h, U, L, from);
    const dropped = [];
    const kept = (r) => dayLocked(r) || pins.has(r.id);
    const need = lockNeed(h, L);
    while (best.bad > 0 && best.U.length) {
      let pick = null;
      const held = (e) => (best.U.length >= need && e.U.length < need ? e.bad - e.lockBad + best.lockBad : e.bad);
      const core = best.U.some((r) => !kept(r)) ? held(lockImprove(w, h, best.U.filter(kept), L, from)) : best.bad;
      for (const pinsToo of [false, true]) {
        for (const quick of [true, false]) {
          for (const r of best.U) {
            if (dayLocked(r) || (pins.has(r.id) && !pinsToo)) continue;
            const left = best.U.filter((x) => x !== r);
            const e0 = quick ? lockEval(w, h, left, L, from) : lockImprove(w, h, left, L, from);
            const e = { ...e0, bad: held(e0) };
            if (e.bad > best.bad || (e.bad === best.bad && (pinsToo || core >= best.bad))) continue;
            const loss = 1000 * e.bad + worth(r) + (pins.has(r.id) ? 500 : 0) - (best.cost - e.cost);
            if (!pick || loss < pick.loss) pick = { r, loss };
          }
          if (pick) break;
        }
        if (pick) break;
      }
      if (!pick) break;
      dropped.push(pick.r);
      best = lockImprove(w, h, best.U.filter((x) => x !== pick.r), L, from);
    }
    return { ...best, dropped };
  };
  // a locked stop that breaks a rule says so
  const lockNotes = (w, sim) => {
    for (const x of sim) {
      if (!lockOf.has(x.r.id)) continue;
      const where = dayLocked(x.r) ? `Locked to ${DAY_NAME(w.day)}` : "Locked here";
      if (x.open === false) notes.push({ kind: "lock", id: x.r.id, date: w.date, text: `${where}, but it isn't open when you'd arrive (${clockShort(x.eta)}).` });
      else if (x.depart > w.to - END_SLACK_MIN) notes.push({ kind: "lock", id: x.r.id, date: w.date, text: `${where}, but the visit runs past your window (to ${clockShort(x.depart)}).` });
    }
  };

  const days = [];
  const assigned = new Set(); // ids on the frozen day or a planned day
  const carriedIds = [];
  const carriedSet = new Set();
  const placedPins = new Set();
  const capOff = new Map(); // id → the locked day whose cap took it off (J1)

  // A bottom-quarter stop's reason, from the day's final timings (R2 Calacanis 2): the gap it fills before the next
  // room opens, when that is longer than a rep may wait; else the driving it adds to the day's loop (K1: it is on the
  // way, which is what put it there).
  const fillText = (w, sim, i) => {
    const x = sim[i].r;
    if (!Number.isFinite(x.rank) || x.rank <= Math.ceil(LOW_RANK * maxRank) || pins.has(x.id)) return null;
    const next = sim[i + 1];
    const from = i ? sim[i - 1].depart : sim[0].leave;
    const gap = next ? next.eta - from - legMin(i ? sim[i - 1].r : w.start ?? null, next.r) : 0;
    // judge 10 #6: "a 26-min gap before 1:36 pm openers" took three reads; judge 11 #3: "until the next door opens at
    // 1:36 pm" printed the arrival as an opening time (Pinthouse is open from 11 am), so it names the door and says
    // "opens" only when the arrival is its opening
    if (gap >= FILL_GAP_MIN) {
      const who = next.r.name ?? "the next door";
      return next.openFrom != null && next.eta === next.openFrom ? `fills the wait until ${who} opens at ${clockShort(next.eta)}` : `fills the time before ${who}, where you arrive at ${clockShort(next.eta)}`;
    }
    const seq = sim.map((y) => y.r);
    const add = Math.max(0, dayCost(w, seq) - dayCost(w, seq.filter((y) => y !== x)));
    return add ? `on the way: adds ${add} min of driving` : "on the way: adds no driving";
  };
  const dayOut = (w, sim, extra = {}) => {
    const stops = sim.map(({ r, eta, depart, l, open, openUntil, openFrom, waitMin }, i) => ({
      id: r.id,
      eta,
      depart,
      legMi: l.mi,
      legMin: l.min,
      openAtArrival: r.parsedHours?.ok && open !== null ? open : null,
      hoursVerified: Boolean(r.parsedHours?.ok) && open !== null,
      openUntil,
      source: l.source ?? "estimate",
      pinned: pins.get(r.id)?.kind ?? null,
      carried: carriedSet.has(r.id),
      locked: lockOf.has(r.id),
      lockDay: lockOf.get(r.id)?.index === null,
      // its opening time decided its place: the room opens after the stop before it is reached (or, for stop 1,
      // after the day starts), so it could not go one place earlier
      waitMin,
      // persona (founder): 15 of 51 stops arrived within 30 min of opening, 6 said so. A label only: minutes since the
      // room opened when under JUST_OPENED_MIN (a follow-up's own time is no opening), else null
      justOpened: open && openFrom != null && openFrom > 0 && eta - openFrom < JUST_OPENED_MIN && !(r.fuAt?.day === w.day && r.fuAt.min === openFrom) ? eta - openFrom : null,
      orderReason: (!extra.frozen && fillText(w, sim, i)) || (!extra.frozen && open && openFrom != null && (waitMin > 0 || openFrom > (i ? sim[i - 1].eta : w.from)) ? `${r.fuAt?.day === w.day && r.fuAt.min === openFrom ? "follow-up at" : "opens"} ${clockShort(openFrom)}${waitMin > 0 ? ` · wait ~${waitMin} min` : ""}` : null),
    }));
    const srcs = new Set(stops.map((s) => s.source));
    return {
      date: w.date,
      day: w.day,
      from: w.from,
      to: w.to,
      start: w.start ?? null,
      stops,
      mi: Math.round(stops.reduce((a, s) => a + s.legMi, 0) * 10) / 10,
      min: stops.reduce((a, s) => a + s.legMin, 0),
      end: stops.length ? stops.at(-1).depart : w.from,
      // when the rep leaves the start: the window's start, or later when the first room opens later (F4)
      leave: sim.length ? sim[0].leave : w.from,
      source: srcs.size === 0 ? null : srcs.size === 1 ? [...srcs][0] : "mixed",
      frozen: false,
      past: false,
      ...extra,
    };
  };

  // ---- past windows: keep what was done, carry what was missed ----
  wins.forEach((w, k) => {
    if (!isPast(w, k)) return;
    const prevDay = previous?.days?.find((d) => d.date === w.date && (d.from == null || d.from === w.from));
    const stops = (prevDay?.stops ?? []).filter((s) => EXCLUDED_STATUSES.has(statuses[s.id]));
    const missed = (prevDay?.stops ?? []).map((s) => s.id).filter((id) => !EXCLUDED_STATUSES.has(statuses[id]) && byId.has(id) && !carriedSet.has(id));
    for (const id of missed) (carriedSet.add(id), carriedIds.push(id));
    if (missed.length) notes.push({ kind: "carried", from: w.date, day: w.day, ids: missed, text: `${missed.length} door${missed.length === 1 ? "" : "s"} carried over from ${DAY_NAME(w.day)}` });
    days[k] = {
      date: w.date,
      day: w.day,
      from: w.from,
      to: w.to,
      start: w.start ?? null,
      stops,
      mi: Math.round(stops.reduce((a, s) => a + (s.legMi ?? 0), 0) * 10) / 10,
      min: stops.reduce((a, s) => a + (s.legMin ?? 0), 0),
      end: stops.length ? stops.at(-1).depart : w.from,
      source: prevDay?.source ?? null,
      frozen: false,
      past: true,
    };
  });

  // ---- the frozen day: kept in the rep's order, timings refreshed; a visit out of order re-routes the rest (G4) ----
  if (frozenIdx >= 0) {
    const w = wins[frozenIdx];
    const seq = [];
    const kept = new Set();
    for (const id of frozen.ids ?? []) {
      const r = byId.get(id);
      if (!r || assigned.has(id) || kept.has(id) || (lockOf.has(id) && lockOf.get(id).k !== frozenIdx)) continue;
      seq.push(r);
      kept.add(id);
      // C1: a follow-up dated after this day is the return visit: the door stays free for that later day
      const p = pins.get(id);
      if (p?.kind === "followup" && p.date && p.date > w.date) continue;
      assigned.add(id);
      if (p) placedPins.add(id);
    }
    // it leaves when it was planned to (a day that left later for a room that opens later keeps doing so)
    const was = previous?.days?.find((d) => d && d.date === w.date && d.from === w.from);
    if (Number.isFinite(was?.leave) && was.leave > w.from) w.leaveMin = was.leave;
    // done: marked visited or talked (not a return visit due by today); the visits in order lead the day
    const pend = (r) => pins.get(r.id)?.kind === "followup" && !(pins.get(r.id).date > w.date);
    const done = (r) => EXCLUDED_STATUSES.has(statuses[r.id]) && !pend(r);
    // A visit out of order (G4, main's ruling on H1; F9, live check 2):
    // - the day hasn't started (now is before its window, or no clock): it keeps its plan. A visit logged early
    //   (Friday's stop, Thursday night) is done in place at its planned time; nothing moves or is carried, and the day
    //   isn't under way (begun: false);
    // - the day is under way: the visits lead, and the rest re-routes from the last visit's door, from the later of now
    //   and that visit's end as the day is timed (where the rep is).
    // A plan that already re-routed keeps that timing (the last visit's planned departure holds).
    const started = Boolean(now) && (now.date > w.date || (now.date === w.date && now.min >= w.from));
    let h = 0;
    while (h < seq.length && done(seq[h])) h++;
    const head = started ? [...seq.slice(0, h), ...seq.slice(h).filter(done)] : seq.slice(0, h);
    const L = locksOn(frozenIdx);
    const rest = [...seq.filter((r) => !head.includes(r) && !L.some((l) => l.r === r)), ...dayLocksOn(frozenIdx).filter((r) => !seq.includes(r))];
    const asIs = [...head, ...mergeLocks(head.length, rest, L)];
    const keep = head.length === h && asIs.length === seq.length && asIs.every((r, i) => r === seq[i]);
    const nowMin = !keep && started && now.date === w.date ? now.min : -Infinity;
    const hs = simulate(w, head, "frozen");
    const at = hs.at(-1);
    let from = { at: w.start ?? null, t: Math.max(w.leaveMin ?? w.from, nowMin) };
    if (at) {
      const planned = keep ? was?.stops?.find((s) => s.id === at.r.id)?.depart : null;
      const t = Math.max(at.depart, Number.isFinite(planned) ? planned : -Infinity, nowMin);
      at.eta += t - at.depart;
      at.depart = t;
      from = { at: at.r, t };
      if (!keep && started) notes.push({ kind: "rerouted", mode: "now", id: at.r.id, date: w.date, at: t, text: `${DAY_NAME(w.day)} re-routed from this visit, from ${clockShort(t)}.` });
    }
    if (keep) days[frozenIdx] = dayOut(w, at ? [...hs, ...simulate({ ...w, start: from.at, leaveMin: from.t }, seq.slice(h), "frozen")] : simulate(w, seq, "frozen"), { frozen: true, begun: started });
    else {
      for (const r of [...L.map((l) => l.r), ...rest]) assigned.add(r.id);
      const got = lockArrange(w, head.length, rest, L, from);
      for (const r of got.dropped) {
        assigned.delete(r.id);
        placedPins.delete(r.id);
        if (!carriedSet.has(r.id)) (carriedSet.add(r.id), carriedIds.push(r.id));
      }
      if (got.dropped.length) notes.push({ kind: "carried", from: w.date, day: w.day, ids: got.dropped.map((r) => r.id), text: `${got.dropped.length} door${got.dropped.length === 1 ? "" : "s"} carried over from ${DAY_NAME(w.day)}` });
      lockNotes(w, got.sim);
      days[frozenIdx] = dayOut(w, [...hs, ...got.sim], { frozen: true, begun: started });
    }
  }

  // ---- locked days ahead: planned first, around their locks; the other days plan around them ----
  const lockedDays = new Map(); // k → the day's timed stops (dayOut at the end, with the other days)
  for (const k of [...new Set([...lockOf.values()].map((l) => l.k))].sort((a, b) => a - b)) {
    if (days[k]) continue;
    const w = wins[k];
    const L = locksOn(k);
    for (const l of L) assigned.add(l.r.id);
    const before = previous?.days?.find((d) => d && !d.past && d.date === w.date && d.from === w.from);
    // its free doors: the ones it had (still free and open that day), and follow-ups due that day
    const U = dayLocksOn(k);
    const take = (r) => r && !assigned.has(r.id) && !lockOf.has(r.id) && !excluded(r.id) && !U.includes(r) && openSometime(w, r, visitMin) && !(pins.get(r.id)?.kind === "followup" && pins.get(r.id).date > w.date) && U.push(r);
    for (const s of before?.stops ?? []) take(byId.get(s.id));
    for (const p of pins.values()) if (p.kind === "followup" && p.date === w.date) take(byId.get(p.id));
    // over its cap: the worst-ranked of the doors it had come off (its locks and due follow-ups stay)
    const over = U.filter((r) => !dayLocked(r) && !pins.has(r.id)).sort((a, b) => byRankThenId(b, a)).slice(0, Math.max(0, L.length + U.length - capOf(k)));
    for (const r of over) (U.splice(U.indexOf(r), 1), capOff.set(r.id, k));
    for (const r of U) assigned.add(r.id);
    // when it leaves: as before, or the window's start, or up to LEAVE_TRIES × LEAVE_STEP later, or so as to reach a
    // door locked first as it opens
    const opens = L[0]?.index === 0 && L[0].r.parsedHours?.ok && w.start ? spansOn(L[0].r.parsedHours, w.day).map((x) => x.from - legMin(w.start, L[0].r)).filter((t) => t > w.from) : [];
    // (mobile2 10-23: running late said "No later day has room" with Wed Nov 4 empty): a door locked to the day
    // only (running late's move, End my day's roll) that opens late in it is reached as it opens: leave then, it goes
    // first. Without it a 4 pm opener on a 1–6 pm day was timed shut at 1:42 pm (the leaves above reach 2:40 pm at most).
    for (const r of dayLocksOn(k)) if (r?.parsedHours?.ok && w.start) for (const x of spansOn(r.parsedHours, w.day)) { const t = x.from - legMin(w.start, r); if (t > w.from) opens.push(t); }
    const leaves = [...new Set([before?.leave ?? w.from, ...Array.from({ length: LEAVE_TRIES + 1 }, (_, i) => w.from + i * LEAVE_STEP), ...opens])].filter((t) => Number.isFinite(t) && t < w.to);
    let from = null;
    let pick = null;
    for (const t of leaves) {
      const e = lockImprove(w, 0, U, L, { at: w.start ?? null, t });
      if (!pick || lockBetter(e, pick)) (pick = e), (from = { at: w.start ?? null, t });
    }
    let got = lockArrange(w, 0, U, L, from);
    const need = lockNeed(0, L);
    // a follow-up or contact it had to drop may fit when the day leaves at another time (one due at 4 pm, say): the
    // leave that drops the fewest of them, then as before (N1)
    const pinsOff = (g) => g.dropped.filter((r) => pins.has(r.id)).length;
    for (const t of leaves) {
      if (!pinsOff(got)) break;
      const g = lockArrange(w, 0, U, L, { at: w.start ?? null, t });
      if (pinsOff(g) < pinsOff(got) || (pinsOff(g) === pinsOff(got) && lockBetter(g, got))) (got = g), (from = { at: w.start ?? null, t });
    }
    for (const r of got.dropped) assigned.delete(r.id);
    // then it grows as a day does: a free ranked door that adds at most DOOR_MIN to its loop, where it breaks no rule
    const cands = rows.filter((r) => !assigned.has(r.id) && !lockOf.has(r.id) && !excluded(r.id) && !pins.has(r.id) && Number.isFinite(r.rank) && openSometime(w, r, visitMin) && weekOk(k, r));
    for (let n = 0; n < capacity(w, visitMin) && got.seq.length < capOf(k); n++) {
      let best = null;
      for (const c of cands) {
        if (assigned.has(c.id)) continue;
        for (let pos = 0; pos <= got.U.length; pos++) {
          const e = lockEval(w, 0, [...got.U.slice(0, pos), c, ...got.U.slice(pos)], L, from);
          // fix12: a door that moves a lock back to its index isn't refused for the lock's own break there
          if (got.U.length < need ? e.bad - e.lockBad > got.bad - got.lockBad : e.bad > got.bad) continue;
          const gain = worth(c) - (e.cost - got.cost);
          if (e.cost - got.cost <= doorMin && (!best || gain > best.gain)) best = { gain, e, c };
        }
      }
      if (!best) break;
      assigned.add(best.c.id);
      const e = lockImprove(w, 0, best.e.U, L, from);
      got = { ...(lockBetter(e, best.e) ? e : best.e), dropped: [] };
    }
    for (const r of got.seq) {
      if (!pins.has(r.id) || placedPins.has(r.id)) continue;
      placedPins.add(r.id);
      if (pins.get(r.id).kind === "followup") notes.push({ kind: "followup", id: r.id, to: w.date, text: `Follow-up visit on ${niceDate(w.date)}.` });
    }
    lockNotes(w, got.sim);
    lockedDays.set(k, got.sim);
  }

  // ---- the windows to plan (K1, docs/ROUTING-V3.md V4): driving first, each door worth DOOR_MIN of loop driving ----
  // A team orienteering problem with time windows (TOPTW): each window is a route with a time budget, each door a
  // profit with opening hours, each route a loop home. Solved as Vansteenwegen et al. (2009) do: insertion by profit² /
  // time used, then iterated local search (shake: take R consecutive stops off each day from position S, re-insert),
  // plus a swap pass (a free door in place of a stop), moves between days (relocate a stop, exchange two) and a
  // within-day drive pass (or-opt, 2-opt). Shape is no rule.
  const ks = wins.map((w, k) => k).filter((k) => !days[k] && !lockedDays.has(k));
  // areas (over every window, statuses ignored: the split travel.js asks road times for): OUT_PEN more for a door
  // outside the ROAD_SET doors nearest a day's area centre (the day's road matrix holds only those: a leg beyond is an
  // estimate), and AREA_W per km from it (off since V4); never a wall
  const { centres } = weekFill
    ? partitionWeeks(rows, wins, wins.map((w, k) => k), visitMin, (id) => pins.has(id), (wk) => rows.filter((r) => Number.isFinite(r.rank) && weekFill.allowed.get(r.id) === wk))
    : partition(rows, wins, wins.map((w, k) => k), visitMin, (id) => pins.has(id), "regret", reachKm);
  const roadSet = new Map(ks.map((k) => {
    const c = centres.get(k) ?? wins[k].start;
    return [k, new Set(c ? rows.slice().sort((a, b) => km(c, a) - km(c, b) || (a.id < b.id ? -1 : 1)).slice(0, ROAD_SET).map((r) => r.id) : rows.map((r) => r.id))];
  }));
  const eligible = (r) => !assigned.has(r.id) && !excluded(r.id);
  const anyWindowOn = (date) => wins.some((w, k) => w.date === date && !isPast(w, k) && k !== frozenIdx);
  const seqs = new Map(ks.map((k) => [k, []]));
  const sims = new Map(ks.map((k) => [k, []]));
  const held = new Set(); // doors a re-planned day kept from the previous plan: the shake leaves them be
  const placedOn = new Map(); // id → k
  const value = (r) => (pins.has(r.id) ? PIN_VALUE : worth(r) + (carriedSet.has(r.id) ? CARRY_TIE : 0));
  const penTab = new Map(); // k → [pen by IX]
  const areaPen = (k, r) => {
    let t = penTab.get(k);
    if (!t) penTab.set(k, (t = []));
    return (t[r[IX]] ??= (AREA_W && centres.get(k) ? AREA_W * km(r, centres.get(k)) : 0) + (roadSet.get(k).has(r.id) ? 0 : OUT_PEN) + todPen(k, r) + heatPen(k, r));
  };
  // R9 deep (lib/culture.js): a day whose window sits more in the room's Qloo crowd times than the door's best day
  // costs up to TOD_MIN more, so a door goes to the day that catches it quiet. Relative to its best day, so it only
  // moves doors between days and never makes a door less worth a visit (one window, or the same hours every day: 0).
  // r.tod is absent when the signal is off or Qloo gives none: no change.
  const todTab = new Map();
  const todPen = (k, r) => {
    if (!r.tod) return 0;
    let sh = todTab.get(r.id);
    if (!sh) todTab.set(r.id, (sh = wins.map((w) => crowdShare(w.from, w.to, r.tod))));
    return TOD_MIN * (sh[k] - Math.min(...sh));
  };
  // R9 deep heat (lib/culture.js): with heatFirst's area swap, a door in a top hood of Qloo's heatmap for the brand's
  // fans costs HEAT_MIN on any day after the first, so the search keeps "this part of town first". r.heat absent = 0.
  const firstDate = wins.find((w, k) => !isPast(w, k))?.date ?? null;
  const heatPen = (k, r) => (r.heat && firstDate && wins[k].date !== firstDate ? HEAT_MIN * r.heat : 0);
  const optTab = new Map(); // k → the day's insertion options (options()), until the day changes
  const setDay = (k, seq, sim = simulate(wins[k], seq)) => {
    optTab.delete(k);
    for (const r of seqs.get(k)) if (placedOn.get(r.id) === k) placedOn.delete(r.id), assigned.delete(r.id);
    seqs.set(k, seq);
    sims.set(k, sim);
    for (const r of seq) placedOn.set(r.id, k), assigned.add(r.id);
  };
  // the plan's worth: Σ value − the loops' driving − the road-set and area terms
  const score = () => ks.reduce((v, k) => v + seqs.get(k).reduce((a, r) => a + value(r) - areaPen(k, r), 0) - loopMin(wins[k], seqs.get(k)), 0);
  const openOn = new Map(ks.map((k) => [k, new Set(rows.filter((r) => openSometime(wins[k], r, visitMin) && weekOk(k, r)).map((r) => r.id))]));

  // Latest start each stop can take without breaking the day: maxShift (Vansteenwegen 2009, §3), the room's span end
  // and the window's end bounding it, a later stop's wait absorbing a push.
  const shifts = (k) => {
    const w = wins[k];
    const sim = sims.get(k);
    const ms = new Array(sim.length);
    for (let i = sim.length - 1; i >= 0; i--) {
      const cap = (sim[i].openUntil ?? Infinity) - visitMin - sim[i].eta;
      ms[i] = Math.min(cap, i === sim.length - 1 ? w.to - END_SLACK_MIN - sim[i].depart : sim[i + 1].waitMin + ms[i + 1]);
    }
    return ms;
  };
  // Every cheap-to-check insertion of a free door into day k: {r, k, pos, gain, ratio}, best ratio first. A check is
  // O(1) per slot (maxShift); the chosen one is confirmed by simulate. Kept until the day changes.
  const options = (cands, k) => {
    if (optTab.has(k)) return optTab.get(k);
    const out = [];
    if (seqs.get(k).length >= capOf(k)) return optTab.set(k, out), out; // at its cap
    const w = wins[k];
    const seq = seqs.get(k);
    const sim = sims.get(k);
    const ms = shifts(k);
    const open = openOn.get(k);
    const limit = w.to - END_SLACK_MIN - visitMin;
    // per place: where the rep comes from and when, where they go next, and the leg it replaces (at the end: the drive
    // home, K1)
    const at = [];
    for (let pos = 0; pos <= seq.length; pos++) {
      const t0 = pos ? sim[pos - 1].depart : w.from;
      if (t0 > limit) break;
      const prev = pos ? seq[pos - 1] : w.start ?? null;
      at.push({ pos, t0, prev, next: seq[pos], base: seq[pos] ? legMin(prev, seq[pos]) : w.home && pos ? legMin(prev, w.home) : 0 });
    }
    for (const r of cands) {
      if (!open.has(r.id) || placedOn.get(r.id) === k) continue;
      const v = value(r) - areaPen(k, r);
      const home = w.home ? legMin(r, w.home) : 0;
      let best = null;
      for (const { pos, t0, prev, next, base } of at) {
        const a = leg(prev, r);
        const s = startAt(r, w.day, t0 + a.min, pos ? WAIT_MAX_MIN : Infinity);
        if (!s) continue;
        let eta = s.eta;
        const b = next ? leg(r, next) : null;
        // the first stop may be left for later, so the next stop's wait stays within WAIT_MAX_MIN
        if (!pos && next) eta = Math.max(eta, sim[0].eta - WAIT_MAX_MIN - b.min - visitMin);
        if (eta + visitMin > s.until || eta + visitMin > w.to - END_SLACK_MIN) continue;
        let used = eta + visitMin - t0;
        if (next) {
          const arr = eta + visitMin + b.min;
          const push = arr - sim[pos].eta;
          if (push > ms[pos] || sim[pos].eta - arr > WAIT_MAX_MIN) continue;
          used = Math.max(0, push) + (pos ? 0 : Math.max(0, sim[0].eta - eta)); // time it takes from the day
        }
        const gain = v - (a.min + (b ? b.min : home) - base);
        if (gain <= 0) continue;
        const ratio = (gain * gain) / Math.max(1, used);
        if (!best || ratio > best.ratio) best = { r, k, pos, gain, ratio };
      }
      if (best) out.push(best); // its best place on this day
    }
    out.sort((x, y) => y.ratio - x.ratio || y.gain - x.gain || x.pos - y.pos || (x.r.id < y.r.id ? -1 : 1));
    optTab.set(k, out);
    return out;
  };
  const better = (x, y) => x.ratio > y.ratio || (x.ratio === y.ratio && (x.gain > y.gain || (x.gain === y.gain && (x.k < y.k || (x.k === y.k && x.pos < y.pos)))));
  // Insert the best confirmed option over all days, again and again, until none fits. (A free door's options on a day
  // stay valid while that day is unchanged; one that fails its confirmation is dropped.)
  // An empty day's first door pays the whole drive out and back, so no single door may be worth it where a cluster of
  // them is (K1). Seed: for each free door open that day, the cluster it would start, by legs (its SEED_NEAR nearest
  // free doors, cheapest first, each adding at most DOOR_MIN, within the window's minutes and the day's cap); the best
  // cluster worth more than its loop seeds the day with its first door, and fill grows it. → whether a day was seeded
  const seed = (cands) => {
    let pick = null;
    for (const k of ks) {
      if (seqs.get(k).length || !wins[k].home) continue;
      const w = wins[k];
      const open = cands.filter((r) => !assigned.has(r.id) && openOn.get(k).has(r.id));
      const room = w.to - END_SLACK_MIN - w.from;
      for (const r of open) {
        let pts = [r];
        let cost = loopMin(w, pts);
        let best = worth(r) - cost;
        let v = best;
        const near = open.filter((c) => c !== r).sort((p, q) => legMin(r, p) - legMin(r, q) || (p.id < q.id ? -1 : 1)).slice(0, SEED_NEAR);
        while (pts.length < capOf(k)) {
          let add = null;
          for (const c of near) {
            if (pts.includes(c)) continue;
            const d = detour(w, pts, c);
            if (d <= doorMin && (!add || d < add.d)) add = { c, d };
          }
          if (!add || visitMin * (pts.length + 1) + cost + add.d > room) break;
          let at = 0;
          for (let pos = 0, lo = Infinity; pos <= pts.length; pos++) {
            const c = loopMin(w, [...pts.slice(0, pos), add.c, ...pts.slice(pos)]);
            if (c < lo) (lo = c), (at = pos);
          }
          pts = [...pts.slice(0, at), add.c, ...pts.slice(at)];
          cost = loopMin(w, pts);
          v += worth(add.c) - add.d;
          best = Math.max(best, v);
        }
        if (best > EPS && (!pick || best > pick.v + EPS)) pick = { k, r, v: best };
      }
    }
    if (!pick) return false;
    const sim = simulate(wins[pick.k], [pick.r]);
    if (sim) setDay(pick.k, [pick.r], sim);
    return Boolean(sim);
  };
  const fill = (cands) => {
    for (let guard = 0; guard < 400; guard++) {
      let o = null;
      let at = -1;
      for (const k of ks) {
        const list = options(cands, k);
        const i = list.findIndex((x) => !assigned.has(x.r.id));
        if (i >= 0 && (!o || better(list[i], o))) (o = list[i]), (at = i);
      }
      if (!o && seed(cands)) continue;
      if (!o) return;
      const next = [...seqs.get(o.k).slice(0, o.pos), o.r, ...seqs.get(o.k).slice(o.pos)];
      const sim = simulate(wins[o.k], next);
      if (sim) setDay(o.k, next, sim);
      else optTab.get(o.k).splice(at, 1);
    }
  };
  // Cheapest feasible place for r on day k (least added loop driving), or null: {seq, sim, c: the loop's minutes}.
  // room: the day's free minutes (spare), when known: a place whose visit and added driving can't fit in them is not
  // simulated.
  // Results are kept per sequence (an array is never changed once made: a day's new order is a new array), so the
  // passes that ask again about an unchanged day pay nothing. `room` only skips places that can't fit, so it never
  // changes the answer.
  const placeTab = new WeakMap(); // seq → Map(k → Map(r → best))
  const bestPlace = (k, seq, r, room = Infinity) => {
    let byK = placeTab.get(seq);
    if (!byK) placeTab.set(seq, (byK = new Map()));
    let byR = byK.get(k);
    if (!byR) byK.set(k, (byR = new Map()));
    if (byR.has(r)) return byR.get(r);
    const best = placeOf(k, seq, r, room);
    byR.set(r, best);
    return best;
  };
  const placeOf = (k, seq, r, room) => {
    let best = null;
    const w = wins[k];
    for (let pos = 0; pos <= seq.length; pos++) {
      if (room < Infinity) {
        const prev = pos ? seq[pos - 1] : w.start ?? null;
        const next = seq[pos];
        if (legMin(prev, r) + (next ? legMin(r, next) - legMin(prev, next) : 0) + visitMin > room) continue;
      }
      const next = [...seq.slice(0, pos), r, ...seq.slice(pos)];
      const sim = simulate(wins[k], next);
      if (!sim) continue;
      const c = loopMin(wins[k], next);
      if (!best || c < best.c) best = { seq: next, sim, c };
    }
    return best;
  };
  // A shorter loop within a day, every stop still open on arrival: single-stop moves (or-opt) and reversals (2-opt).
  const tighten = (k) => {
    const w = wins[k];
    let seq = seqs.get(k);
    let cost = loopMin(w, seq);
    for (let improved = true, guard = 0; improved && guard < 30; guard++) {
      improved = false;
      for (let i = 0; i < seq.length && !improved; i++) {
        const rest = [...seq.slice(0, i), ...seq.slice(i + 1)];
        for (let j = 0; j <= rest.length && !improved; j++) {
          if (j === i) continue;
          const t = [...rest.slice(0, j), seq[i], ...rest.slice(j)];
          const c = loopMin(w, t);
          if (c < cost && fits(w, t)) (seq = t), (cost = c), (improved = true);
        }
      }
      for (let i = 0; i < seq.length - 1 && !improved; i++)
        for (let j = i + 1; j < seq.length && !improved; j++) {
          const t = [...seq.slice(0, i), ...seq.slice(i, j + 1).reverse(), ...seq.slice(j + 1)];
          const c = loopMin(w, t);
          if (c < cost && fits(w, t)) (seq = t), (cost = c), (improved = true);
        }
    }
    if (seq !== seqs.get(k)) setDay(k, seq);
  };
  // A day's free minutes: its window (less END_SLACK_MIN) less its visits and driving. A door fits a place only when
  // its visit and the driving it adds there fit in them (a sound bound, checked before simulating).
  const spare = (k, seq = seqs.get(k)) => wins[k].to - END_SLACK_MIN - wins[k].from - visitMin * seq.length - travelMin(wins[k], seq);
  // The least loop minutes r adds to seq on window w at any place, by legs alone (no timing): a bound on bestPlace's.
  const detour = (w, seq, r) => {
    let best = Infinity;
    for (let pos = 0; pos <= seq.length; pos++) {
      const prev = pos ? seq[pos - 1] : w.start ?? null;
      const next = seq[pos] ?? (pos && w.home ? w.home : null);
      const d = legMin(prev, r) + (next ? legMin(r, next) - (prev ? legMin(prev, next) : 0) : 0);
      if (d < best) best = d;
    }
    return best;
  };
  // Moves between days (K1): a stop to the day whose loop passes nearest (relocate), or two stops trading days
  // (exchange), where each day still keeps its time rules and its cap and the loops' minutes fall. Pins, locks and a
  // re-plan's kept doors stay. Bounds by legs first; only a move that could gain is timed.
  const movable = (r) => !pins.has(r.id) && !lockOf.has(r.id) && !held.has(r.id);
  const nearest = (x, list) => (list.length <= GRANULAR ? list : list.slice().sort((p, q) => legMin(x, p) - legMin(x, q) || (p.id < q.id ? -1 : 1)).slice(0, GRANULAR));
  const crossPass = () => {
    const memo = new WeakMap(); // seq → Map(r → detour), for the scan's fixed sequences
    const detourOf = (k, seq, r) => {
      let m = memo.get(seq);
      if (!m) memo.set(seq, (m = new Map()));
      let d = m.get(r);
      if (d === undefined) m.set(r, (d = detour(wins[k], seq, r)));
      return d;
    };
    for (let guard = 0; guard < 60; guard++) {
      // the best move for each pair of days; the best moves on days no other move touches go in together
      const best = new Map();
      const bar = (a, b) => EPS + (best.get(a < b ? a * 1e3 + b : b * 1e3 + a)?.gain ?? 0);
      const offer = (m) => m.gain > bar(m.a, m.b) && best.set(m.a < m.b ? m.a * 1e3 + m.b : m.b * 1e3 + m.a, m);
      const cost = new Map(ks.map((k) => [k, loopMin(wins[k], seqs.get(k))]));
      // each movable stop's day without it, and the loop minutes (and area term) that saves
      const rm = new Map();
      for (const k of ks)
        for (const y of seqs.get(k)) {
          if (!movable(y)) continue;
          const without = seqs.get(k).filter((z) => z !== y);
          rm.set(y, { without, save: cost.get(k) - loopMin(wins[k], without) + areaPen(k, y) });
        }
      for (const a of ks) {
        const sa = seqs.get(a);
        for (const x of sa) {
          if (!movable(x)) continue;
          const { without: wa, save: saveA } = rm.get(x);
          for (const b of ks) {
            if (b === a || !openOn.get(b).has(x.id)) continue;
            const sb = seqs.get(b);
            // relocate x to b (a detour is never below -ROUND_SLACK: legs are whole minutes)
            if (sb.length < capOf(b) && saveA + ROUND_SLACK > bar(a, b) && saveA - areaPen(b, x) - detourOf(b, sb, x) > bar(a, b)) {
              const simA = simulate(wins[a], wa);
              const got = simA && bestPlace(b, sb, x, spare(b));
              if (got) offer({ gain: saveA - areaPen(b, x) - (got.c - cost.get(b)), a, b, A: { seq: wa, sim: simA }, B: got });
            }
            // exchange x and one of b's stops nearest it, among those whose savings could pay for the move
            const ys = sb.filter((y) => movable(y) && openOn.get(a).has(y.id) && saveA + rm.get(y).save + 2 * ROUND_SLACK > bar(a, b));
            for (const y of nearest(x, ys)) {
              const { without: wb, save: saveB } = rm.get(y);
              const half = saveA + saveB - areaPen(b, x) - areaPen(a, y) - detourOf(b, wb, x);
              if (half + ROUND_SLACK <= bar(a, b) || half - detourOf(a, wa, y) <= bar(a, b)) continue;
              const A = bestPlace(a, wa, y, spare(a, wa));
              const B = A && bestPlace(b, wb, x, spare(b, wb));
              if (B) offer({ gain: cost.get(a) + cost.get(b) - A.c - B.c + areaPen(a, x) + areaPen(b, y) - areaPen(a, y) - areaPen(b, x), a, b, A, B });
            }
          }
        }
      }
      if (!best.size) return guard > 0;
      const touched = new Set();
      for (const m of [...best.values()].sort((p, q) => q.gain - p.gain || p.a - q.a || p.b - q.b)) {
        if (touched.has(m.a) || touched.has(m.b)) continue;
        touched.add(m.a).add(m.b);
        setDay(m.a, m.A.seq, m.A.sim);
        setDay(m.b, m.B.seq, m.B.sim);
        tighten(m.a);
        tighten(m.b);
      }
    }
    return true;
  };
  // A free door in place of a stop (not a pin, a lock or a re-plan's kept door: an untouched day stays as it was), where
  // it fits and the plan's worth rises (a shorter loop, or a better rank at the same loop); the best swaps of a scan go
  // in, then the scan repeats.
  const swapPass = (cands) => {
    for (let guard = 0; guard < 8; guard++) {
      const found = [];
      for (const k of ks) {
        const seq = seqs.get(k);
        const base = loopMin(wins[k], seq);
        seq.forEach((x, at) => {
          if (pins.has(x.id) || lockOf.has(x.id) || held.has(x.id)) return;
          const vx = value(x) - areaPen(k, x);
          const without = [...seq.slice(0, at), ...seq.slice(at + 1)];
          const room = spare(k, without);
          for (const c of nearest(x, cands.filter((c) => !assigned.has(c.id) && openOn.get(k).has(c.id)))) {
            // the most it could gain: the value it adds less the cheapest detour by legs (no simulation)
            if (value(c) - areaPen(k, c) - vx - (detour(wins[k], without, c) - (base - loopMin(wins[k], without))) <= EPS) continue;
            const got = bestPlace(k, without, c, room);
            if (!got) continue;
            const gain = value(c) - areaPen(k, c) - vx - (got.c - base);
            if (gain > EPS) found.push({ k, got, gain, c, x });
          }
        });
      }
      if (!found.length) return;
      found.sort((a, b) => b.gain - a.gain || a.k - b.k || (a.c.id < b.c.id ? -1 : 1));
      const touched = new Set();
      for (const f of found) {
        if (touched.has(f.k) || assigned.has(f.c.id)) continue;
        touched.add(f.k);
        setDay(f.k, f.got.seq, f.got.sim);
      }
    }
  };

  // the doors on the current day and the locked days: never free for the days planned here
  const fixedIds = new Set(assigned);
  // 1. pins: follow-ups due by a window (their date or the next window), then dated contacts, then contacts on the
  // first window they're open in and fit
  const pinNote = (k, p) => {
    const w = wins[k];
    if (p.kind === "followup" && p.date && p.date < w.date) {
      const why = anyWindowOn(p.date) ? `it did not fit that day's window` : `no window left that day`;
      notes.push({ kind: "followup-moved", id: p.id, from: p.date, to: w.date, text: `Follow-up moved from ${niceDate(p.date)} to ${niceDate(w.date)}: ${why}.` });
    } else if (p.kind === "followup") notes.push({ kind: "followup", id: p.id, to: w.date, text: `Follow-up visit on ${niceDate(w.date)}.` }); // C1 (R1): say it
  };
  const pinOrder = [...pins.values()]
    .filter((p) => !placedPins.has(p.id) && eligible(byId.get(p.id)))
    .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "followup" ? -1 : 1) || (a.date == null) - (b.date == null) || String(a.date ?? "").localeCompare(String(b.date ?? "")) || byRankThenId(byId.get(a.id), byId.get(b.id)));
  // (J1) a pin without a date goes on a day under its cap first; it passes a cap only when no day has room. With caps,
  // the undated pins open on the fewest days go first, so one that only fits a day or two finds room there.
  const daysFor = (p) => ks.filter((k) => dueOn(p, wins[k]) && openOn.get(k).has(p.id)).length;
  if (ks.some((k) => capOf(k) < Infinity)) {
    const undated = pinOrder.filter((p) => p.date == null);
    const sorted = undated.slice().sort((a, b) => daysFor(a) - daysFor(b));
    pinOrder.forEach((p, i) => p.date == null && (pinOrder[i] = sorted.shift()));
  }
  for (const p of pinOrder) {
    const r = byId.get(p.id);
    for (const room of p.date == null ? [true, false] : [false]) {
      if (placedPins.has(p.id)) break;
      for (const k of ks) {
        if (!dueOn(p, wins[k]) || !openOn.get(k).has(r.id) || (room && seqs.get(k).length >= capOf(k))) continue;
        const got = bestPlace(k, seqs.get(k), r);
        if (!got) continue;
        setDay(k, got.seq, got.sim);
        placedPins.add(p.id);
        pinNote(k, p);
        break;
      }
    }
  }
  // fill "week": a door no week took (below every week's best-ranked set) still goes on a day it is on the way for, in
  // time the day has left: it takes no better door's place (and a re-plan takes it back where it was, fix13)
  const below = weekFill ? rows.filter((r) => Number.isFinite(r.rank) && !weekFill.allowed.has(r.id) && !pins.has(r.id) && !lockOf.has(r.id) && !excluded(r.id) && !fixedIds.has(r.id)) : [];
  const belowOn = new Map(ks.map((k) => [k, new Set(below.filter((r) => openSometime(wins[k], r, visitMin)).map((r) => r.id))]));
  // 2. re-plan stability (F1b): every day the previous plan had takes back its doors, in order, each still free and
  // still legal there (around the pins). Only doors whose status changed, carried and pinned doors, and freed time are
  // decided again.
  for (const k of ks) {
    const w = wins[k];
    const same = (d) => d && !d.past && !d.frozen && d.date === w.date && d.from === w.from && d.to === w.to && d.start?.lat === w.start?.lat && d.start?.lon === w.start?.lon;
    const before = previous?.days?.find(same);
    // judge pass 5 (#2): first the day exactly as it was, its pins where they were. Taken back one door at a time around
    // a pin with a set time (a follow-up "back Tuesday at 4"), the greedy order could lose a door, the day was decided
    // again, and every re-plan (a Friday visit logged, even a reload) flipped Tuesday between two plans
    const pinsHere = seqs.get(k);
    const asWas = (before?.stops ?? []).map((s) => byId.get(s.id)).filter((r) => r && (openOn.get(k).has(r.id) || belowOn.get(k).has(r.id)) && (pinsHere.includes(r) || (!pins.has(r.id) && eligible(r))));
    if (asWas.length && asWas.length <= capOf(k) && pinsHere.every((r) => asWas.includes(r))) {
      const sim = simulate(w, asWas);
      if (sim) {
        setDay(k, asWas, sim);
        for (const r of asWas) if (!pins.has(r.id)) held.add(r.id);
        continue;
      }
    }
    let lost = false;
    for (const s of before?.stops ?? []) {
      const r = byId.get(s.id);
      if (!r || pins.has(r.id) || !eligible(r) || !(openOn.get(k).has(r.id) || belowOn.get(k).has(r.id))) continue;
      if (seqs.get(k).length >= capOf(k)) {
        lost = true;
        break;
      }
      const app = [...seqs.get(k), r];
      const sim = simulate(w, app);
      const got = sim ? { seq: app, sim } : bestPlace(k, seqs.get(k), r);
      if (got) (setDay(k, got.seq, got.sim), held.add(r.id));
      else lost = true;
    }
    // a day that could not take all its doors back (a pin came in) is decided again: its best doors win, not its first
    if (lost) for (const r of seqs.get(k)) held.delete(r.id);
  }
  // 3. insert, then iterated local search from there
  // (a door a re-planned day took back stays a candidate: the shake may free it, and then it is placed or has a reason)
  const cands = rows.filter((r) => !pins.has(r.id) && !lockOf.has(r.id) && !excluded(r.id) && !fixedIds.has(r.id) && ks.some((k) => openOn.get(k).has(r.id)));
  const free = () => cands.filter((r) => !assigned.has(r.id));
  fill(cands);
  for (const k of ks) tighten(k);
  fill(cands);
  const snap = () => new Map(ks.map((k) => [k, seqs.get(k)]));
  let best = { v: score(), seqs: snap() };
  const iters = quick ? 0 : previous ? ILS_ITERS_REPLAN : ILS_ITERS;
  for (let it = 0, S = 0, R = 1, still = 0; it < iters && still < ILS_STILL; it++) {
    // shake: R consecutive stops off each day from position S (pins, locks and a re-plan's kept doors stay)
    let minLen = Infinity;
    for (const k of ks) {
      const seq = seqs.get(k);
      const can = seq.filter((r) => !pins.has(r.id) && !held.has(r.id));
      minLen = Math.min(minLen, can.length);
      if (!can.length) continue;
      const off = new Set(can.slice(S % can.length, (S % can.length) + R));
      const left = seq.filter((r) => !off.has(r));
      const sim = simulate(wins[k], left);
      if (sim) setDay(k, left, sim); // (taking stops off can leave a wait too long: then the day stays)
    }
    fill(cands);
    for (const k of ks) tighten(k);
    fill(cands);
    const v = score();
    if (v > best.v + 1e-6) (best = { v, seqs: snap() }), (R = 1), (still = 0);
    else still++;
    S += R;
    R++;
    if (S >= Math.max(1, minLen)) S = S - Math.max(1, minLen);
    if (R > Math.max(2, Math.floor(cands.length / (3 * Math.max(1, ks.length))))) R = 1;
  }
  for (const k of ks) setDay(k, []);
  for (const k of ks) setDay(k, best.seqs.get(k));
  // quick (planWeeks: how many doors a week holds): the first fill's days, their ids only
  if (quick) return { days: [...ks.map((k) => ({ date: wins[k].date, stops: seqs.get(k).map((r) => ({ id: r.id })) })), ...[...lockedDays].map(([k, sim]) => ({ date: wins[k].date, stops: sim.map((x) => ({ id: x.r.id })) }))] };
  swapPass(free());
  crossPass();
  fill(cands);
  for (const k of ks) tighten(k);
  // 4. no free door left off that adds at most DOOR_MIN to a day's loop as the days stand (checked at every place of
  // every day under its cap; the cheapest goes in first), so the reasons below hold; then the swaps and moves again
  const addTab = new Map(); // k → Map(r → {got, add} | null), until the day changes
  const addOn = (k, r) => {
    let t = addTab.get(k);
    if (!t || t.seq !== seqs.get(k)) addTab.set(k, (t = { seq: seqs.get(k), m: new Map() }));
    if (!t.m.has(r)) {
      const seq = seqs.get(k);
      const got = detour(wins[k], seq, r) <= doorMin ? bestPlace(k, seq, r, spare(k)) : null;
      t.m.set(r, got ? { got, add: got.c - loopMin(wins[k], seq) } : null);
    }
    return t.m.get(r);
  };
  const lastCheck = () => {
    for (;;) {
      let pick = null;
      for (const r of [...free(), ...below.filter((r) => !assigned.has(r.id))]) {
        for (const k of ks) {
          if (!(openOn.get(k).has(r.id) || belowOn.get(k).has(r.id)) || seqs.get(k).length >= capOf(k)) continue;
          const o = addOn(k, r);
          if (o && o.add <= doorMin && (!pick || o.add < pick.add)) pick = { k, r, ...o };
        }
      }
      if (!pick) return;
      setDay(pick.k, pick.got.seq, pick.got.sim);
      tighten(pick.k);
    }
  };
  // the check runs last: a swap or move that shortens a loop can bring a door within DOOR_MIN
  for (let round = 0; ; round++) {
    lastCheck();
    // fill "week": a day the on-the-way doors opened can take its week's doors now (a lone far door was not worth the
    // drive; next to one it is). A re-plan takes the on-the-way doors back first, so it would add them (fix13)
    for (let n = 0; weekFill && n < 5 && free().length; n++) {
      const had = assigned.size;
      fill(cands);
      if (assigned.size === had) break;
      lastCheck();
    }
    if (round === 5) break;
    const before = score();
    swapPass(free());
    crossPass();
    if (score() <= before + EPS) break;
    for (const k of ks) tighten(k);
  }
  // judge pass 4 (#11, N21: The Yard idled ~20 min on Thursday): a planned day that waits at a door (a follow-up's
  // time, a late opener) leaves the start later instead, when every stop before it is still open and the day still
  // ends in its window. The doors and their order stay; only the wait moves, to before the day starts.
  const waits = (sim) => sim.reduce((a, x) => a + (x.waitMin ?? 0), 0);
  const slide = (w, sim) => {
    let best = sim;
    for (let n = 0; best?.length && n < 3; n++) {
      const k = best.findIndex((x, i) => i > 0 && x.waitMin > 0);
      if (k < 0) break;
      const got = simulate({ ...w, from: best[0].leave + best[k].waitMin }, best.map((x) => x.r));
      if (!got || got.length !== best.length || waits(got) >= waits(best)) break;
      best = got;
    }
    return best;
  };
  for (const k of ks) days[k] = dayOut(wins[k], sims.has(k) && wins[k].leaveMin == null ? slide(wins[k], sims.get(k)) : sims.get(k) ?? simulate(wins[k], seqs.get(k), false));
  for (const [k, sim] of lockedDays) days[k] = dayOut(wins[k], sim);

  // ---- what did not fit, and why ----
  for (const p of pins.values()) {
    if (placedPins.has(p.id) || excluded(p.id)) continue;
    // the true reason (R2 H1): no window on or after its date, or its hours at every window it is due in
    const who = p.kind === "followup" ? "A follow-up" : "A contact";
    // the days it could go on: the planned ones and the locked ones (N1: a locked day is planned first, around its locks)
    const due = [...ks, ...lockedDays.keys()].sort((a, b) => a - b).filter((k) => dueOn(p, wins[k]));
    const r = byId.get(p.id);
    const why = !due.length
      ? `there is no window on ${p.kind === "contact" ? "" : "or after "}${niceDate(p.date)}`
      : due.every((k) => !openSometime(wins[k], r, visitMin))
        ? `it ${hoursReason(r, due.map((k) => wins[k]), visitMin).text.replace(/^(closed|open )/, "is $1")}`
        : `it could not be reached in time on ${due.filter((k) => openSometime(wins[k], r, visitMin)).map((k) => (wins.filter((w) => w.day === wins[k].day).length > 1 ? niceDate(wins[k].date) : DAY_NAME(wins[k].day))).join(" or ")}`;
    notes.push({ kind: p.kind === "followup" ? "followup-unscheduled" : "contact-unscheduled", id: p.id, text: `${who} is not on the plan: ${why}.` });
  }
  const scheduled = new Set(days.flatMap((d) => (d?.past ? [] : d?.stops.map((s) => s.id) ?? [])));
  const lostCarried = carriedIds.filter((id) => !scheduled.has(id) && !excluded(id));
  if (lostCarried.length) notes.push({ kind: "carried-unscheduled", ids: lostCarried, text: `${lostCarried.length} carried door${lostCarried.length === 1 ? "" : "s"} did not fit the days left` });
  const unscheduled = rows.filter((r) => !assigned.has(r.id) && !excluded(r.id)).map((r) => r.id);

  const several = ks.length > 1;
  // a day a reason names: its weekday, or its date when the plan has that weekday twice ("Tue Oct 20")
  const twice = new Set(wins.map((w) => w.day).filter((d, i, a) => a.indexOf(d) !== i));
  const dayName = (k) => (twice.has(wins[k].day) ? niceDate(wins[k].date) : DAY_NAME(wins[k].day));
  const reasons = {};
  // the doors on a day's week that the week took all rank above r (what "better-ranked doors fill that week" says)
  const outranked = (k, r) => {
    const wk = weekFill.weekOf(wins[k].date);
    const theirs = ks.filter((j) => weekFill.weekOf(wins[j].date) === wk).flatMap((j) => seqs.get(j)).filter((x) => weekFill.allowed.get(x.id) === wk);
    return theirs.length > 0 && theirs.every((x) => byRankThenId(x, r) < 0);
  };
  for (const r of rows) {
    if (scheduled.has(r.id) || assigned.has(r.id)) continue;
    if (excluded(r.id)) {
      reasons[r.id] = { code: "status", text: `status: ${STATUS_TEXT[statuses[r.id]]}` };
      continue;
    }
    if (capOff.has(r.id)) {
      // it was on a locked day the cap took it off: that day (a locked day is planned first, so no other took it)
      const k = capOff.get(r.id);
      reasons[r.id] = { code: "cap", text: `${wins.length > 1 ? dayName(k) : "the day"} is at its limit of ${capOf(k)} door${capOf(k) === 1 ? "" : "s"} a day`, date: wins[k].date };
      continue;
    }
    if (!ks.length) continue;
    const opened = ks.filter((k) => openSometime(wins[k], r, visitMin));
    if (!opened.length) {
      reasons[r.id] = hoursReason(r, ks.map((k) => wins[k]), visitMin);
      continue;
    }
    // fill "week" (fix13): a door a week took is told about that week's days, the only ones it could go on (it read
    // "fits Thu Nov 5, but better-ranked doors fill that week first" while that week's doors ranked below it)
    const own = opened.filter((k) => weekOk(k, r));
    const open = own.length ? own : opened;
    // K1: the plan takes every free door that adds at most DOOR_MIN to a day's loop as the days stand (step 4), so a
    // door left off on a day that is open for it meets one of these, checked with the planner's own timing:
    //   "cap": it would add at most DOOR_MIN to a day at its cap (J1)
    //   "detour": it fits a day as it stands, but adds more than DOOR_MIN to its loop ("adds 22 min of driving to
    //     Wednesday", the cheapest day)
    //   "idle-hours": the day has time after its last stop, but the room is closed then ("opens 5 pm, after Tuesday's
    //     last stop" / "closes 3 pm, before Tuesday is free")
    //   "idle": the day has time after its last stop, but not enough to get there and visit
    //   "full": no time left for it at any place in the day, and no stop it could replace
    //   "nearer": it fits only in place of a stop, and in that stop's place it would make the loop longer
    //   "better": it fits only in place of a stop, at no more driving, but that stop is better ranked (rank breaks ties)
    //   "kept": it fits only in place of stops a re-plan kept (an untouched day stays as it was)
    let fit = null;
    for (const k of open) {
      const seq = seqs.get(k);
      const got = bestPlace(k, seq, r, spare(k));
      if (!got) continue;
      const add = got.c - loopMin(wins[k], seq);
      const cap = seq.length >= capOf(k) && add <= doorMin;
      if (!fit || (cap && !fit.cap) || (cap === fit.cap && add < fit.add)) fit = { k, add, cap };
    }
    if (fit) {
      const on = several ? dayName(fit.k) : null;
      // fill "week": it would go on a day of a week whose doors are better-ranked ones (it is open there, within DOOR_MIN
      // of the loop); else the reason it would have with any day open to it, which holds as well
      reasons[r.id] = !fit.cap && fit.add <= doorMin && !weekOk(fit.k, r)
        ? outranked(fit.k, r)
          ? { code: "lower", text: `fits ${on ?? "the day"}, but better-ranked doors fill ${several ? "that week" : "it"} first`, date: wins[fit.k].date }
          : { code: "detour", text: `adds ${fit.add} min of driving to ${on ?? "the day"}`, date: wins[fit.k].date, min: fit.add }
        : fit.cap
        ? { code: "cap", text: `${on ?? "the day"} is at its limit of ${capOf(fit.k)} door${capOf(fit.k) === 1 ? "" : "s"} a day`, date: wins[fit.k].date }
        : { code: "detour", text: `adds ${fit.add} min of driving to ${on ?? "the day"}`, date: wins[fit.k].date, min: fit.add };
      if (pins.has(r.id)) reasons[r.id] = { ...reasons[r.id], pinned: true };
      continue;
    }
    let best = null;
    const ORDER = { "idle-hours": 0, idle: 0, nearer: 1, kept: 1, better: 1, full: 2 };
    for (const k of open) {
      const w = wins[k];
      const seq = seqs.get(k);
      const end = seq.length ? days[k].end : w.from;
      const freeTo = w.to - END_SLACK_MIN;
      let why;
      if (freeTo - end >= visitMin) {
        // free time after the last stop: its hours, or the way there
        const arrive = end + legMin(seq.length ? seq.at(-1) : w.start ?? null, r);
        const spans = r.parsedHours?.ok ? spansOn(r.parsedHours, w.day) : null;
        const openFree = !spans || spans.some((x) => Math.min(x.to, freeTo) - Math.max(x.from, arrive) >= visitMin || (x.from <= arrive && arrive < x.to));
        if (openFree) why = { code: "idle", at: end };
        else {
          const later = spans.filter((x) => x.from > arrive).map((x) => x.from).sort((p, q) => p - q)[0];
          why = later != null ? { code: "idle-hours", opens: later, at: end } : { code: "idle-hours", closes: Math.max(...spans.filter((x) => x.from <= arrive).map((x) => x.to)), at: end };
        }
      } else {
        // in place of a stop?
        const base = loopMin(w, seq);
        const swaps = seq.flatMap((x) => {
          if (pins.has(x.id) || lockOf.has(x.id)) return [];
          const without = seq.filter((y) => y !== x);
          const got = bestPlace(k, without, r, spare(k, without));
          return got ? [{ x, more: got.c - base }] : [];
        });
        const free = swaps.filter((o) => !held.has(o.x.id));
        why = !swaps.length ? { code: "full" } : !free.length ? { code: "kept" } : free.every((o) => o.more > 0) ? { code: "nearer" } : { code: "better" };
      }
      if (!best || ORDER[why.code] < ORDER[best.code]) best = { ...why, k };
    }
    const on = several ? dayName(best.k) : null;
    const dayS = on ? `${on}'s` : "the day's";
    const text = {
      idle: `${on ?? "the day"} is free from ${clockShort(best.at)}, but not long enough to get there and visit`,
      "idle-hours": best.opens != null ? `opens ${clockShort(best.opens)}, after ${dayS} last stop` : `closes ${clockShort(best.closes)}, before ${on ?? "the day"} is free`,
      full: `${on ?? "the day"} had no time left for it`,
      nearer: `${on ?? "the day"} has room for it only in place of a stop nearer its route`,
      better: `${on ?? "the day"} has room for it only in place of a better-ranked stop, for the same driving`,
      kept: `${on ?? "the day"} has room for it only in place of a stop it already had (a re-plan keeps a day's stops)`,
    }[best.code];
    reasons[r.id] = { code: best.code, text, date: wins[best.k].date };
    if (pins.has(r.id)) reasons[r.id] = { ...reasons[r.id], pinned: true };
  }

  // What this re-plan did to the days after the current one, against `previous` (R2 Calacanis 3; outcome.js says it
  // in the follow-up toast): replanCost = {addedMi, droppedIds, movedIds, source} or null with no previous plan.
  // addedMi: change in planned miles over those days; droppedIds: doors they had that are on no day now (not counting
  // doors the rep marked); movedIds: doors now on a different day.
  let replanCost = null;
  if (previous?.days) {
    const was = new Map();
    let miBefore = 0;
    let miNow = 0;
    for (const k of [...ks, ...lockedDays.keys()]) {
      const w = wins[k];
      const d = previous.days.find((x) => x && !x.past && !x.frozen && x.date === w.date && x.from === w.from);
      if (!d) continue;
      miBefore += d.mi ?? 0;
      miNow += days[k].mi;
      for (const st of d.stops) was.set(st.id, w.date);
    }
    const kz = [...ks, ...lockedDays.keys()];
    const now = new Map(kz.flatMap((k) => days[k].stops.map((st) => [st.id, wins[k].date])));
    const srcs = new Set(kz.flatMap((k) => days[k].stops.map((st) => st.source ?? "estimate")));
    replanCost = {
      addedMi: Math.round((miNow - miBefore) * 10) / 10,
      source: srcs.size === 1 ? [...srcs][0] : srcs.size ? "mixed" : null, // how those miles were measured
      droppedIds: [...was.keys()].filter((id) => !now.has(id) && !excluded(id) && !scheduled.has(id)),
      movedIds: [...was].filter(([id, date]) => now.has(id) && now.get(id) !== date).map(([id]) => id),
    };
  }

  return { days, unscheduled, carried: carriedIds, notes, reasons, replanCost };
}

// Why a door open at none of the windows is not on the plan: "closed Tuesday", "opens 5 pm, after your window",
// "closes 1 pm, before your window" (one window), or the same per day joined with " · ".
function hoursReason(r, ws, visitMin) {
  // each weekday once (the hours are by weekday): a two-week plan's Tuesdays say the same thing
  ws = ws.filter((w, i) => ws.findIndex((x) => x.day === w.day && x.from === w.from && x.to === w.to) === i);
  const parts = ws.map((w) => {
    const spans = spansOn(r.parsedHours, w.day).filter((s) => s.to > s.from);
    if (!spans.length || r.parsedHours.days[w.day]?.closed) return { code: "closed", day: w.day };
    const after = spans.filter((s) => s.from > w.from).map((s) => s.from).sort((a, b) => a - b)[0];
    const before = spans.filter((s) => s.to <= w.from + visitMin).map((s) => s.to).sort((a, b) => b - a)[0];
    if (after != null && after >= w.to - visitMin && spans.every((s) => s.from >= w.to - visitMin || s.to <= w.from + visitMin)) return { code: "opens-after", at: after, day: w.day };
    if (before != null && spans.every((s) => s.to <= w.from + visitMin || s.from >= w.to - visitMin)) return { code: "closes-before", at: before, day: w.day };
    return { code: "brief", day: w.day };
  });
  const one = (p, named) => {
    const on = named ? ` ${DAY_NAME(p.day)}` : "";
    if (p.code === "closed") return `closed ${DAY_NAME(p.day)}`;
    if (p.code === "opens-after") return `opens ${clockShort(p.at)}${on}, after your window`;
    if (p.code === "closes-before") return `closes ${clockShort(p.at)}${on}, before your window`;
    return `open less than a visit in your window${named ? ` on ${DAY_NAME(p.day)}` : ""}`;
  };
  if (parts.length === 1) return { code: parts[0].code, text: one(parts[0], false) };
  const closed = [...new Set(parts.filter((p) => p.code === "closed").map((p) => DAY_NAME(p.day)))]; // a closed weekday once, whatever its hours (fix13)
  const rest = parts.filter((p) => p.code !== "closed");
  const same = rest.length && rest.every((p) => p.code === rest[0].code && p.at === rest[0].at);
  const texts = [];
  if (closed.length) texts.push(`closed ${closed.length > 1 ? `${closed.slice(0, -1).join(", ")} and ${closed.at(-1)}` : closed[0]}`);
  if (same && !closed.length) texts.push(one(rest[0], false).replace("your window", "your windows"));
  else for (const p of rest) texts.push(one(p, true));
  const codes = new Set(parts.map((p) => p.code));
  return { code: codes.size === 1 ? parts[0].code : "hours", text: [...new Set(texts)].join(" · ") }; // each part once (fix13)
}
