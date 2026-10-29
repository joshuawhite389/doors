// The planner (SPEC-V2 §6): every rule, capacity, area grouping vs a naive rank plan, re-plan, determinism, speed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { parseHours, openMinutes, twoOpt, legsCross } from "../public/lib/core.js";
import { planDays, estimateTravel, matrixTravel, EXCLUDED_STATUSES, WAIT_MAX_MIN, END_SLACK_MIN, areasFor, clockShort, DOOR_MIN } from "../public/lib/schedule.js";
import { readJson } from "./helpers.mjs";
import { niceDate } from "../public/lib/profile.js";
import { restReason } from "../public/lib/planview.js";

const fixture = (city) => readJson(`test/fixtures/athletic-brewing-${city}.json`);
const AUS = fixture("austin");
const CHI = fixture("chicago");
const toPool = (rows) => rows.map((r) => ({ ...r, parsedHours: parseHours(r.hours) }));
const ranked = (fx) => toPool(fx.pool.slice(0, fx.ranked));
const AUS_POOL = ranked(AUS);
const byId = new Map(toPool(AUS.pool).map((r) => [r.id, r]));

const START = { lat: 30.2556, lon: -97.7208 };
const H = (h, m = 0) => h * 60 + m;
// The demo week: Tue 2–4 pm, Wed 1–6 pm, Thu 11 am–3 pm (Oct 13–15 2026).
const TUE = { date: "2026-10-13", day: "tuesday", from: H(14), to: H(16), start: START };
const WED = { date: "2026-10-14", day: "wednesday", from: H(13), to: H(18), start: START };
const THU = { date: "2026-10-15", day: "thursday", from: H(11), to: H(15), start: START };
const WEEK = [TUE, WED, THU];
const base = (over = {}) => ({ pool: AUS_POOL, statuses: {}, windows: WEEK, visitMin: 25, travel: estimateTravel, pinned: [], ...over });

const allStops = (plan) => plan.days.flatMap((d) => d.stops);
const ids = (plan) => allStops(plan).map((s) => s.id);
const dayOf = (plan, date) => plan.days.find((d) => d.date === date);

test("estimateTravel: straight line × 1.35 at 18 mph, labelled estimate", () => {
  const a = { lat: 30.2556, lon: -97.7208 };
  const b = { lat: 30.2672, lon: -97.7431 };
  const t = estimateTravel(a, b);
  assert.equal(t.source, "estimate");
  // ~2.5 km straight → ~1.55 mi × 1.35 ≈ 2.1 mi → 7 min at 18 mph
  assert.ok(t.mi > 1.9 && t.mi < 2.3, `mi ${t.mi}`);
  assert.ok(Math.abs(t.min - (t.mi / 18) * 60) < 1e-9);
  assert.deepEqual(estimateTravel(a, a), { min: 0, mi: 0, source: "estimate" });
});

test("matrixTravel uses the ORS matrix by key and falls back to the estimate for a missing pair", () => {
  const t = matrixTravel({ keys: ["start", "x"], min: [[0, 9], [8, 0]], mi: [[0, 3.2], [3.1, 0]] });
  assert.deepEqual(t({ id: "start", lat: 1, lon: 1 }, { id: "x", lat: 1.01, lon: 1 }), { min: 9, mi: 3.2, source: "ors" });
  const f = t({ id: "x", lat: 1, lon: 1 }, { id: "y", lat: 1.01, lon: 1 });
  assert.equal(f.source, "estimate");
});

test("rule 1: excluded statuses are never scheduled, and nothing is scheduled twice", () => {
  const top = AUS_POOL.slice(0, 12).map((r) => r.id);
  const statuses = { [top[0]]: "visited", [top[1]]: "talked", [top[2]]: "notfit" };
  assert.deepEqual([...EXCLUDED_STATUSES].sort(), ["notfit", "removed", "talked", "visited"]);
  const plan = planDays(base({ statuses }));
  const got = ids(plan);
  for (const id of top.slice(0, 3)) {
    assert.ok(!got.includes(id), `excluded ${id} scheduled`);
    assert.ok(!plan.unscheduled.includes(id), "excluded doors are not 'unscheduled' either");
  }
  assert.equal(new Set(got).size, got.length, "a door appears twice");
  // every eligible door is either scheduled or unscheduled
  assert.equal(got.length + plan.unscheduled.length, AUS_POOL.length - 3);
});

test("rule 2: every stop is open on arrival for the whole visit (or flagged hours unverified)", () => {
  const plan = planDays(base());
  for (const d of plan.days) {
    for (const s of d.stops) {
      const p = byId.get(s.id).parsedHours;
      if (!p.ok) {
        assert.equal(s.hoursVerified, false);
        continue;
      }
      assert.equal(s.hoursVerified, true);
      assert.equal(s.openAtArrival, true);
      assert.ok(openMinutes(p, d.day, s.eta, s.eta + 25) >= 25, `${s.id} closed at ${s.eta} on ${d.day}`);
    }
  }
});

test("rule 2: unparseable hours are allowed and flagged", () => {
  const pool = [{ id: "u1", rank: 1, lat: 30.256, lon: -97.721, parsedHours: parseHours(null) }];
  const plan = planDays(base({ pool, windows: [TUE] }));
  assert.equal(plan.days[0].stops.length, 1);
  assert.equal(plan.days[0].stops[0].hoursVerified, false);
  assert.equal(plan.days[0].stops[0].openAtArrival, null);
});

test("rule 2: a door closed during the window is not scheduled that day", () => {
  const closedTue = parseHours({ tuesday: [{ closed: true }], wednesday: [{ opens: "T12:00:00", closes: "T22:00:00" }] });
  const pool = [{ id: "c1", rank: 1, lat: 30.256, lon: -97.721, parsedHours: closedTue }];
  const plan = planDays(base({ pool, windows: [TUE, WED] }));
  assert.equal(plan.days[0].stops.length, 0);
  assert.deepEqual(plan.days[1].stops.map((s) => s.id), ["c1"]);
});

test("rule 3 + capacity: a day fits its window; a 2-hour window gets about 3 doors at 25 min", () => {
  const plan = planDays(base());
  for (const d of plan.days) {
    let t = d.leave; // F4: the window's start, or later when the first room opens later (the rep leaves later)
    assert.ok(d.leave >= d.from);
    for (const s of d.stops) {
      assert.equal(s.eta, t + s.legMin + s.waitMin, "eta = previous depart + leg + any wait for the room to open");
      assert.ok(s.waitMin >= 0 && s.waitMin <= WAIT_MAX_MIN);
      assert.equal(s.depart, s.eta + 25);
      t = s.depart;
    }
    assert.ok(d.end <= d.to, `${d.date} ends ${d.end} after ${d.to}`);
    assert.equal(d.end, d.stops.length ? d.stops.at(-1).depart : d.from);
    assert.equal(d.mi, Math.round(d.stops.reduce((a, s) => a + s.legMi, 0) * 10) / 10);
    assert.equal(d.min, d.stops.reduce((a, s) => a + s.legMin, 0));
  }
  const tue = dayOf(plan, TUE.date).stops.length;
  assert.ok(tue >= 3 && tue <= 4, `Tue 2-hour window got ${tue}`);
  const wed = dayOf(plan, WED.date).stops.length;
  assert.ok(wed >= 7 && wed <= 10, `Wed 5-hour window got ${wed}`);
});

// K1 (driving first) supersedes "the #1 door is on the plan": rank only breaks ties now. The #1 door is on the plan when
// it is worth its driving; else its reason is a time rule or the driving it would add (more than DOOR_MIN).
test("rule 4 (K1): the best-ranked door is on the plan, or its reason says why with the planner's own numbers", () => {
  const plan = planDays(base());
  const one = AUS_POOL[0].id;
  if (ids(plan).includes(one)) return;
  const why = plan.reasons[one];
  assert.ok(why && !["status"].includes(why.code), JSON.stringify(why));
  if (why.code === "detour") assert.ok(why.min > DOOR_MIN, why.text);
});

// Naive plan: each day takes the next N doors by rank (N = the day's count in the real plan) that are open for the
// visit somewhere in the window, ordered by 2-opt from the start. Mean leg between consecutive doors.
function naiveMeanLeg(plan, pool) {
  const used = new Set();
  const legs = [];
  for (const d of plan.days) {
    const n = d.stops.length;
    const pick = [];
    for (const r of pool) {
      if (pick.length >= n) break;
      if (used.has(r.id)) continue;
      const m = openMinutes(r.parsedHours, d.day, d.from, d.to);
      if (m !== null && m < 25) continue;
      pick.push(r);
      used.add(r.id);
    }
    const seq = twoOpt([d.start, ...pick], (a, b) => estimateTravel(a, b).mi).slice(1);
    for (let i = 1; i < seq.length; i++) legs.push(estimateTravel(seq[i - 1], seq[i]).mi);
  }
  return legs.reduce((a, b) => a + b, 0) / legs.length;
}
const planMeanLeg = (plan) => {
  const legs = plan.days.flatMap((d) => d.stops.slice(1).map((s) => s.legMi));
  return legs.reduce((a, b) => a + b, 0) / legs.length;
};

test("rule 4: area grouping, mean intra-day leg ≤ 60% of the naive next-N-by-rank plan (Austin)", () => {
  const plan = planDays(base());
  const mine = planMeanLeg(plan);
  const naive = naiveMeanLeg(plan, AUS_POOL);
  assert.ok(mine <= 0.6 * naive, `mean leg ${mine.toFixed(2)} mi vs naive ${naive.toFixed(2)} mi (${((100 * mine) / naive).toFixed(0)}%)`);
});

test("rule 4: area grouping also holds on Chicago", () => {
  const pool = ranked(CHI);
  const s = { lat: 41.8925, lon: -87.6262 };
  const windows = WEEK.map((w) => ({ ...w, start: s }));
  const plan = planDays(base({ pool, windows }));
  assert.ok(planMeanLeg(plan) <= 0.6 * naiveMeanLeg(plan, pool));
});

// The planner's own timings for an order, via a frozen day (frozen days are timed but never rejected).
const timed = (w, order) => planDays(base({ windows: [w], frozen: { date: w.date, ids: order } })).days[0];
// H1: the rules are time ones only (every stop open on arrival after a wait of at most WAIT_MAX_MIN, the day over
// END_SLACK_MIN before its window closes); crossing legs and long legs are no longer rules
const keepsRules = (w, d) => d.end <= w.to - END_SLACK_MIN && d.stops.every((s) => s.openAtArrival !== false && (s.waitMin ?? 0) <= WAIT_MAX_MIN);

// K1: the drive is the loop, home included (a frozen day's min has no drive home, so it is added here as the planner
// rounds a leg)
const homeMin = (w, d) => {
  if (!d.stops.length) return 0;
  const m = estimateTravel(byId.get(d.stops.at(-1).id), w.start).min;
  return m > 0 ? Math.max(1, Math.round(m)) : 0;
};
const loopOf = (w, d) => d.min + homeMin(w, d);
test("rule 4: each day is 2-opt from its start: no reversal shortens the loop and keeps the rules", () => {
  const plan = planDays(base());
  for (const w of WEEK) {
    const order = dayOf(plan, w.date).stops.map((s) => s.id);
    const mine = timed(w, order);
    for (let i = 0; i < order.length - 1; i++) {
      for (let k = i + 1; k < order.length; k++) {
        const alt = [...order.slice(0, i), ...order.slice(i, k + 1).reverse(), ...order.slice(k + 1)];
        const d = timed(w, alt);
        assert.ok(!(keepsRules(w, d, mine) && loopOf(w, d) < loopOf(w, mine)), `${w.date}: reversing ${i}..${k} saves ${loopOf(w, mine) - loopOf(w, d)} min`);
      }
    }
  }
});

test("rule 5: a contact goes on the first window where it is open and fits", () => {
  const contact = byId.get(AUS.pool[AUS.ranked + 3].id); // a real Austin room outside the ranked 100
  const pool = [...AUS_POOL, { ...contact, rank: null }];
  const plan = planDays(base({ pool, pinned: [{ id: contact.id, kind: "contact" }] }));
  const first = plan.days.findIndex((d) => d.stops.some((s) => s.id === contact.id));
  assert.ok(first >= 0, "contact scheduled");
  const stop = plan.days[first].stops.find((s) => s.id === contact.id);
  assert.equal(stop.pinned, "contact");
  // it was not open+fitting on an earlier window: check by planning that window alone with only the contact
  for (let i = 0; i < first; i++) {
    const only = planDays(base({ pool: [{ ...contact, rank: null }], windows: [WEEK[i]], pinned: [{ id: contact.id, kind: "contact" }] }));
    assert.equal(only.days[0].stops.length, 0, `contact fit on an earlier window ${WEEK[i].date}`);
  }
});

test("rule 5: a contact closed on Tuesday lands on Wednesday", () => {
  const hours = parseHours({ tuesday: [{ closed: true }], wednesday: [{ opens: "T11:00:00", closes: "T23:00:00" }], thursday: [{ opens: "T11:00:00", closes: "T23:00:00" }] });
  const pool = [...AUS_POOL, { id: "my-contact", rank: null, lat: 30.26, lon: -97.73, parsedHours: hours }];
  const plan = planDays(base({ pool, pinned: [{ id: "my-contact", kind: "contact" }] }));
  assert.ok(dayOf(plan, WED.date).stops.some((s) => s.id === "my-contact"));
  assert.ok(!dayOf(plan, TUE.date).stops.some((s) => s.id === "my-contact"));
});

test("G3: a contact with a date (a room added to a day) lands on that day, not the first that fits", () => {
  const hours = parseHours({ tuesday: [{ opens: "T11:00:00", closes: "T23:00:00" }], wednesday: [{ opens: "T11:00:00", closes: "T23:00:00" }], thursday: [{ opens: "T11:00:00", closes: "T23:00:00" }] });
  const pool = [...AUS_POOL, { id: "added", rank: null, lat: 30.26, lon: -97.73, parsedHours: hours }];
  const free = planDays(base({ pool, pinned: [{ id: "added", kind: "contact" }] }));
  assert.ok(dayOf(free, TUE.date).stops.some((s) => s.id === "added"), "undated: the first window");
  const plan = planDays(base({ pool, pinned: [{ id: "added", kind: "contact", date: THU.date }] }));
  assert.equal(plan.days.filter((d) => d.stops.some((s) => s.id === "added")).length, 1);
  const s = dayOf(plan, THU.date).stops.find((x) => x.id === "added");
  assert.equal(s?.pinned, "contact");
});

test("G3: a dated contact closed on its date stays off the plan and says why (it never moves to another day)", () => {
  const hours = parseHours({ tuesday: [{ closed: true }], wednesday: [{ opens: "T11:00:00", closes: "T23:00:00" }], thursday: [{ opens: "T11:00:00", closes: "T23:00:00" }] });
  const pool = [...AUS_POOL, { id: "added", rank: null, lat: 30.26, lon: -97.73, parsedHours: hours }];
  const plan = planDays(base({ pool, pinned: [{ id: "added", kind: "contact", date: TUE.date }] }));
  assert.ok(!ids(plan).includes("added"));
  const n = plan.notes.find((x) => x.kind === "contact-unscheduled" && x.id === "added");
  assert.match(n?.text ?? "", /closed Tuesday/);
  const none = planDays(base({ pool, pinned: [{ id: "added", kind: "contact", date: "2026-10-20" }] }));
  assert.match(none.notes.find((x) => x.id === "added")?.text ?? "", /no window on Tue Oct 20\./);
});

test("rule 5: a follow-up lands on its date's window", () => {
  const id = AUS_POOL[0].id;
  const plan = planDays(base({ statuses: { [id]: "visited" }, pinned: [{ id, kind: "followup", date: THU.date }] }));
  const s = dayOf(plan, THU.date).stops.find((x) => x.id === id);
  assert.ok(s, "follow-up on Thursday");
  assert.equal(s.pinned, "followup");
  assert.equal(ids(plan).filter((x) => x === id).length, 1);
  assert.ok(!plan.notes.some((n) => n.kind === "followup-moved"));
});

test("rule 5: a follow-up with no window on its date goes to the next window, with a note", () => {
  const id = AUS_POOL[0].id;
  const plan = planDays(base({ windows: [TUE, THU], statuses: { [id]: "visited" }, pinned: [{ id, kind: "followup", date: WED.date }] }));
  assert.ok(dayOf(plan, THU.date).stops.some((x) => x.id === id));
  const note = plan.notes.find((n) => n.kind === "followup-moved");
  assert.ok(note, "a note says it moved");
  assert.equal(note.id, id);
  assert.equal(note.from, WED.date);
  assert.equal(note.to, THU.date);
  assert.match(note.text, /follow-up/i);
});

test("rule 5: a follow-up never overrides 'not a fit'", () => {
  const id = AUS_POOL[0].id;
  const plan = planDays(base({ statuses: { [id]: "notfit" }, pinned: [{ id, kind: "followup", date: THU.date }] }));
  assert.ok(!ids(plan).includes(id));
});

test("rule 5b (Jard 10-24): 'removed' (Remove from my plan) keeps a door off, and no follow-up brings it back", () => {
  const id = AUS_POOL[0].id;
  assert.ok(ids(planDays(base())).includes(id));
  assert.ok(!ids(planDays(base({ statuses: { [id]: "removed" } }))).includes(id));
  assert.ok(!ids(planDays(base({ statuses: { [id]: "removed" }, pinned: [{ id, kind: "followup", date: THU.date }] }))).includes(id));
});

test("rule 6: re-plan keeps the frozen day's order (minus removed stops) and re-plans later days", () => {
  const first = planDays(base());
  const tue = dayOf(first, TUE.date).stops.map((s) => s.id);
  assert.ok(tue.length >= 3);
  // during Tuesday: stop 1 visited, stop 2 removed by the rep (not passed), stop 3 marked not a fit later in the day
  const frozenIds = [tue[0], ...tue.slice(2)];
  const statuses = { [tue[0]]: "visited", [AUS_POOL[5].id]: "notfit" };
  const again = planDays(base({ statuses, frozen: { date: TUE.date, ids: frozenIds }, now: { date: TUE.date, min: H(15) }, previous: first }));
  const d = dayOf(again, TUE.date);
  assert.equal(d.frozen, true);
  assert.deepEqual(d.stops.map((s) => s.id), frozenIds, "frozen order kept, removed stop gone, nothing added");
  assert.ok(!ids(again).includes(AUS_POOL[5].id));
  const later = again.days.filter((x) => x.date > TUE.date).flatMap((x) => x.stops.map((s) => s.id));
  for (const id of frozenIds) assert.ok(!later.includes(id), "a frozen door is not scheduled again");
  // the removed (unvisited) door goes back to the pool: on a later day, or unscheduled with its reason (F1: a later
  // day only takes it when it fits that day's area)
  assert.ok(later.includes(tue[1]) || (again.unscheduled.includes(tue[1]) && again.reasons[tue[1]]?.text), "the removed door goes back to the pool");
});

test("rule 6: missed doors from a past window are carried into later days, with a notice", () => {
  const first = planDays(base());
  const tue = dayOf(first, TUE.date).stops.map((s) => s.id);
  const statuses = { [tue[0]]: "visited" };
  const again = planDays(base({ statuses, now: { date: WED.date, min: H(9) }, previous: first }));
  const past = dayOf(again, TUE.date);
  assert.equal(past.past, true);
  assert.deepEqual(past.stops.map((s) => s.id), [tue[0]], "the past day keeps what was done");
  assert.deepEqual([...again.carried].sort(), tue.slice(1).sort());
  const later = again.days.filter((x) => !x.past).flatMap((x) => x.stops);
  // F1: a carried door keeps its real rank, so it reappears only where it fits a later day's area; otherwise it is
  // named in a "carried-unscheduled" note and has a reason (never dropped silently)
  const lost = again.notes.find((n) => n.kind === "carried-unscheduled")?.ids ?? [];
  for (const id of tue.slice(1)) {
    const s = later.find((x) => x.id === id);
    if (!s) {
      assert.ok(lost.includes(id) && again.reasons[id]?.text, `carried door ${id} dropped silently`);
      continue;
    }
    assert.equal(s.carried, true);
  }
  const note = again.notes.find((n) => n.kind === "carried");
  assert.equal(note.ids.length, tue.length - 1);
  assert.match(note.text, /carried over from Tuesday/);
  const nonPast = again.days.filter((x) => !x.past).flatMap((x) => x.stops.map((s) => s.id));
  assert.equal(new Set(nonPast).size, nonPast.length);
});

test("rule 7: deterministic, and independent of pool order", () => {
  const a = planDays(base());
  const b = planDays(base());
  assert.deepEqual(a, b);
  const shuffled = AUS_POOL.slice().reverse();
  assert.deepEqual(planDays(base({ pool: shuffled })), a);
});

test("matrix-backed travel: road legs carry source ors and drive the timings", () => {
  // the six rooms nearest the start (K1: a room is worth DOOR_MIN of loop driving, so the far top six stay home)
  const pool = AUS_POOL.slice().sort((a, b) => estimateTravel(START, a).min - estimateTravel(START, b).min).slice(0, 6);
  const pts = [{ id: "start", ...START }, ...pool];
  const keys = pts.map((p) => p.id);
  const mi = pts.map((a) => pts.map((b) => Math.round(estimateTravel(a, b).mi * 1.1 * 10) / 10));
  const min = mi.map((row) => row.map((m) => (m / 15) * 60));
  const travel = matrixTravel({ keys, min, mi });
  const plan = planDays(base({ pool, windows: [{ ...WED, start: { id: "start", ...START } }], travel }));
  const d = plan.days[0];
  assert.ok(d.stops.length > 0);
  assert.equal(d.source, "ors");
  for (const s of d.stops) assert.equal(s.source, "ors");
});

test("output shape matches SPEC §6", () => {
  const plan = planDays(base());
  // weeks (fill "week", fix13): {week's Monday: {days, ids}}, the doors each week took; the store keeps it (savedPlan)
  assert.deepEqual(Object.keys(plan).sort(), ["carried", "days", "notes", "reasons", "replanCost", "unscheduled", "weeks"]);
  assert.deepEqual(Object.keys(planDays(base({ fill: "area" }))).sort(), ["carried", "days", "notes", "reasons", "replanCost", "unscheduled"]);
  assert.equal(plan.replanCost, null, "no previous plan: no re-plan cost");
  for (const d of plan.days) {
    for (const k of ["date", "stops", "mi", "min", "end"]) assert.ok(k in d, `day.${k}`);
    for (const s of d.stops) for (const k of ["id", "eta", "depart", "legMi", "legMin", "openAtArrival", "hoursVerified", "orderReason"]) assert.ok(k in s, `stop.${k}`);
  }
  // unscheduled is in rank order
  const rank = new Map(AUS_POOL.map((r) => [r.id, r.rank]));
  const u = plan.unscheduled.map((id) => rank.get(id));
  assert.deepEqual(u, u.slice().sort((x, y) => x - y));
});

// A fixed workload shaped like the planner's (objects, sorts, Maps, Math) that never touches Doors' code: timed in turns
// with the planner, it says how fast this box runs JS at that moment (see the performance test).
function refWork() {
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pts = Array.from({ length: 300 }, (_, i) => ({ id: "d" + i, x: rnd() * 10, y: rnd() * 10, open: Math.floor(rnd() * 600) }));
  let acc = 0;
  for (let r = 0; r < 8; r++) {
    const m = new Map();
    for (const p of pts) m.set(p.id, pts.map((q) => Math.hypot(p.x - q.x, p.y - q.y)).sort((a, b) => a - b).slice(0, 8));
    for (const p of pts.slice().sort((a, b) => a.open - b.open || a.x - b.x)) acc += m.get(p.id)[1];
  }
  return acc;
}

// The budget: 200 ms, or 3x the reference workload when the box is slower than that. node --test runs ~15 files in
// parallel, and under that load the same plan took 1.6-2.0 s of wall-clock and ~2.5x its quiet CPU time (freezedry3
// 10-24: 5 of 5 full runs failed), so no clock alone holds a fixed number. The planner's CPU time stayed 1.5-1.9x the
// reference's, quiet or loaded (6 full runs + 6 alone, 10-24); 10x slower planner = ~17x, and fails. CPU time
// (user + system), best of three of each, taken in turns.
test("performance: 150-door pool × 5 windows plans in under 200 ms (or 3x a reference workload on a loaded box)", () => {
  const pool = toPool(AUS.pool.slice(0, 150));
  const windows = ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"].map((date, i) => ({
    date,
    day: ["monday", "tuesday", "wednesday", "thursday", "friday"][i],
    from: H(11),
    to: H(18),
    start: START,
  }));
  planDays(base({ pool, windows })); // warm
  refWork();
  const cpu = (f) => { const c0 = process.cpuUsage(); const out = f(); const c = process.cpuUsage(c0); return [(c.user + c.system) / 1000, out]; };
  let ms = Infinity, ref = Infinity;
  let plan;
  for (let i = 0; i < 3; i++) {
    ref = Math.min(ref, cpu(refWork)[0]);
    const [t, p] = cpu(() => planDays(base({ pool, windows })));
    ms = Math.min(ms, t);
    plan = p;
  }
  assert.ok(allStops(plan).length > 20);
  const budget = Math.max(200, 3 * ref);
  assert.ok(ms < budget, `${ms.toFixed(0)} ms of CPU; budget ${budget.toFixed(0)} ms (200, or 3x the reference's ${ref.toFixed(0)} ms)`);
});

test("pins that cannot be honoured say so: missing from the pool, or open at no window", () => {
  const nightOnly = parseHours({ tuesday: [{ opens: "T21:00:00", closes: "T02:00:00" }], wednesday: [{ opens: "T21:00:00", closes: "T02:00:00" }], thursday: [{ opens: "T21:00:00", closes: "T02:00:00" }] });
  const pool = [...AUS_POOL, { id: "night", rank: null, lat: 30.26, lon: -97.73, parsedHours: nightOnly }];
  const plan = planDays(base({ pool, pinned: [{ id: "night", kind: "contact" }, { id: "ghost", kind: "followup", date: WED.date }] }));
  assert.ok(!ids(plan).includes("night"));
  assert.ok(plan.unscheduled.includes("night"));
  assert.ok(plan.notes.some((n) => n.kind === "contact-unscheduled" && n.id === "night"));
  assert.ok(plan.notes.some((n) => n.kind === "pin-missing" && n.id === "ghost"));
});

test("a window with no start: the first leg is zero and the day still plans", () => {
  const plan = planDays(base({ windows: [{ ...WED, start: null }] }));
  const d = plan.days[0];
  assert.ok(d.stops.length >= 7);
  assert.equal(d.stops[0].legMin, 0);
  // the first door is visited as the rep leaves: the window's start, or later (judge pass 4 #11) where that saves a wait
  assert.equal(d.stops[0].eta, d.leave);
  assert.ok(d.leave >= WED.from);
});

// ---- F1 (R1): area bounds, hours-aware order, reasons ----
const pt = (id, rank, dLatKm, dLonKm, hours = null, extra = {}) => ({
  id, rank, lat: START.lat + dLatKm / 110.57, lon: START.lon + dLonKm / (111.32 * Math.cos((START.lat * Math.PI) / 180)), parsedHours: parseHours(hours), ...extra,
});
const open = (from, to, days = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]) => Object.fromEntries(days.map((d) => [d, [{ opens: `T${from}:00`, closes: `T${to}:00` }]]));
const TUE26 = { ...TUE, to: H(18) }; // Tue 2–6 pm

// H1 (owner, routing overhaul): leg caps were rules (2.5 mi between doors, 5 mi from the start, 15 min to the first
// door); now a leg is as long as it needs to be, and the drive-time cost keeps them short where a nearby door would do.
test("H1: no leg caps, yet legs stay short on the Austin week (median and mean ≤ 1.5 mi, none over 5 mi)", () => {
  const plan = planDays(base());
  const legs = plan.days.flatMap((d) => d.stops.slice(1).map((s) => s.legMi)).sort((a, b) => a - b);
  assert.ok(legs[legs.length >> 1] <= 1.5, `median ${legs[legs.length >> 1]} mi`);
  assert.ok(legs.reduce((a, b) => a + b, 0) / legs.length <= 1.5);
  assert.ok(legs.at(-1) <= 5, `${legs.at(-1)} mi`);
});

// H1 put a door 8 mi away on the plan when the day had the time (one more door first). K1 (driving first) supersedes
// that: it adds far more than DOOR_MIN to the loop, so it stays off and says how much; a nearer door still wins a slot.
test("K1: a door 8 mi away stays off and its reason gives the driving it adds; a nearer one wins a slot both fit", () => {
  const pool = [pt("near1", 1, 0.5, 0, open("11:00", "23:00")), pt("near2", 2, 1, 0.5, open("11:00", "23:00")), pt("far", 3, 0, 10.5, open("11:00", "23:00"))];
  const plan = planDays(base({ pool, windows: [TUE26] }));
  assert.deepEqual(ids(plan).sort(), ["near1", "near2"], "the far door is not worth its loop");
  assert.equal(plan.reasons.far.code, "detour");
  assert.match(plan.reasons.far.text, /^adds \d+ min of driving to the day$/);
  assert.ok(plan.reasons.far.min > 2 * DOOR_MIN, plan.reasons.far.text);
  // 40 minutes hold one visit: the near door, not the far one (same count, less driving; it is also better ranked here,
  // so rank the far door first to show the drive decides)
  const tight = planDays(base({ pool: [pt("far", 1, 0, 10.5, open("11:00", "23:00")), pt("near", 2, 0.5, 0, open("11:00", "23:00"))], windows: [{ ...TUE, to: H(14, 40) }] }));
  assert.deepEqual(ids(tight), ["near"]);
  assert.equal(tight.reasons.far.code, "full");
});

test("F1: reasons for every ranked door left off: hours, status, full", () => {
  const pool = [
    pt("a", 1, 0.3, 0, open("11:00", "23:00")),
    pt("late", 2, 0.4, 0.2, open("17:00", "23:00")), // Tue 2–4 pm: opens after the window
    pt("shut", 3, 0.2, 0.3, { tuesday: [{ closed: true }], wednesday: [{ opens: "T11:00:00", closes: "T22:00:00" }] }),
    pt("gone", 4, 0.1, 0.1, open("11:00", "23:00")),
    ...Array.from({ length: 8 }, (_, i) => pt(`f${i}`, 5 + i, 0.2 * i, -0.2, open("11:00", "23:00"))),
  ];
  const plan = planDays(base({ pool, windows: [TUE], statuses: { gone: "notfit" } }));
  assert.equal(plan.reasons.late.text, "opens 5 pm, after your window");
  assert.equal(plan.reasons.shut.text, "closed Tuesday");
  assert.equal(plan.reasons.gone.text, "status: not a fit");
  const left = plan.unscheduled.filter((id) => id.startsWith("f"));
  assert.ok(left.length > 0);
  // H1: "the day was full" is said exactly: no time left at any place, or room only in place of a stop nearer the route,
  // or (K1: rank breaks ties) in place of a better-ranked stop at the same driving
  for (const id of left) assert.match(plan.reasons[id].text, /^the day (had no time left for it|has room for it only in place of a stop nearer its route|has room for it only in place of a better-ranked stop, for the same driving)$/, id);
  for (const id of plan.unscheduled) assert.ok(plan.reasons[id]?.text, `no reason for ${id}`);
  // several windows: the day is named
  const two = planDays(base({ pool, windows: [TUE, WED], statuses: { gone: "notfit" } }));
  for (const id of two.unscheduled) assert.ok(two.reasons[id]?.text, `no reason for ${id}`);
  assert.ok(!two.unscheduled.includes("shut"), "open Wednesday");
});

test("F1: reasons on the Austin week name the day and every unscheduled door has one", () => {
  const plan = planDays(base());
  for (const id of plan.unscheduled) assert.match(plan.reasons[id].text, /Tuesday|Wednesday|Thursday|after your window|before your window|status|open less/, id);
});

// Doors never wait for a room to open (A2 decision 4), so a 3 pm room needs doors open at 2 pm before it.
test("F1: a stop placed by its opening time says so (orderReason), others don't", () => {
  const pool = [pt("early", 1, 0.5, 0, open("11:00", "23:00")), pt("three", 2, 0.8, 0.4, open("15:00", "23:00")), pt("e2", 3, 0.6, 0.6, open("11:00", "23:00")), pt("e3", 4, 0.3, 0.6, open("11:00", "23:00"))];
  const plan = planDays(base({ pool, windows: [TUE26] }));
  const st = Object.fromEntries(plan.days[0].stops.map((s) => [s.id, s]));
  assert.match(st.three.orderReason, /^opens 3 pm( · wait ~\d+ min)?$/);
  assert.equal(st.early.orderReason, null);
  assert.ok(st.three.eta >= H(15));
  // a frozen day keeps the rep's order: no reason
  const fz = planDays(base({ pool, windows: [TUE26], frozen: { date: TUE.date, ids: ["three", "early", "e2"] } }));
  assert.ok(fz.days[0].stops.every((s) => s.orderReason === null));
});

// K1: a day is a loop home, so an early opener may wait for the way back (shape is no rule since H1; the old "does not
// cross itself" was an open-path rule). The late openers come at 4 pm, and the loop is no longer than sweeping out.
test("F1/K1: late openers come once open, and the loop is no longer than sweeping outward and driving home", () => {
  // rooms open at 11 near the start, rooms opening at 4 pm farther out the same way
  const pool = [
    pt("e1", 3, -0.5, 0.1, open("11:00", "22:00")), pt("e2", 4, -1.0, -0.2, open("11:00", "22:00")),
    pt("m1", 5, -1.8, 0.2, open("11:00", "22:00")), pt("m2", 6, -2.4, -0.1, open("11:00", "22:00")),
    pt("l1", 1, -3.2, 0.2, open("16:00", "02:00")), pt("l2", 2, -3.6, -0.2, open("16:00", "02:00")),
  ];
  const plan = planDays(base({ pool, windows: [TUE26] }));
  const d = plan.days[0];
  const order = d.stops.map((s) => s.id);
  const late = order.filter((id) => id.startsWith("l"));
  assert.ok(late.length >= 1, `order ${order}`);
  for (const s of d.stops) if (s.id.startsWith("l")) assert.ok(s.eta >= H(16), `${s.id} at ${s.eta}`);
  const at = new Map(pool.map((r) => [r.id, r]));
  const m = (a, b) => (estimateTravel(a, b).min > 0 ? Math.max(1, Math.round(estimateTravel(a, b).min)) : 0);
  const loop = (q) => q.reduce((a, r, i) => a + m(i ? q[i - 1] : START, r), 0) + m(q.at(-1), START);
  const outward = ["e1", "e2", "m1", "m2", "l1", "l2"].filter((id) => order.includes(id)).map((id) => at.get(id));
  assert.ok(loop(order.map((id) => at.get(id))) <= loop(outward), `order ${order}`);
  assert.match(d.stops.find((s) => s.id === late[0]).orderReason, /^opens 4 pm/);
});

test("F1: a short wait at a door that opens soon (≤ WAIT_MAX_MIN), shown on the stop", () => {
  // one room open now, one opening at 2:30 pm next to it: arrive ~2:30 after the first visit, or wait a few minutes
  const pool = [pt("now", 2, 0.5, 0, open("11:00", "22:00")), pt("soon", 1, 0.7, 0.1, open("14:45", "22:00"))];
  const plan = planDays(base({ pool, windows: [TUE26] }));
  const st = Object.fromEntries(plan.days[0].stops.map((s) => [s.id, s]));
  assert.ok(st.soon, "the 2:45 pm room is reached");
  assert.equal(st.soon.eta, H(14, 45));
  // by waiting a few minutes at it, or (F4) by leaving later when it is the day's first stop
  const d = plan.days[0];
  // judge pass 4 (#11): or by leaving later, so the wait moves to before the day starts and nobody idles at a door
  assert.ok(d.leave > d.from && st.soon.waitMin === 0, `leave ${d.leave}, wait ${st.soon.waitMin}`);
  if (d.stops[0].id !== "soon") assert.match(st.soon.orderReason, /^opens 2:45 pm$/);
  assert.equal(st.now.waitMin, 0);
  // a wait leaving later can't save (the door before closes): kept, and shown on the stop
  const shut = planDays(base({ pool: [{ ...pool[0], parsedHours: parseHours(open("11:00", "14:35")) }, pool[1]], windows: [TUE26] }));
  const sh = Object.fromEntries(shut.days[0].stops.map((s) => [s.id, s]));
  assert.ok(sh.now && sh.soon, "both rooms are reached");
  assert.ok(sh.soon.waitMin > 0 && sh.soon.waitMin <= WAIT_MAX_MIN, `wait ${sh.soon.waitMin}`);
  assert.match(sh.soon.orderReason, /^opens 2:45 pm · wait ~\d+ min$/);
  // more than WAIT_MAX_MIN away: not reached that way
  const far = planDays(base({ pool: [pool[0], { ...pool[1], parsedHours: parseHours(open("15:30", "22:00")) }], windows: [TUE26] }));
  assert.ok(!far.days[0].stops.some((s) => s.id === "soon" && s.waitMin > WAIT_MAX_MIN));
});

test("F1: carried doors keep their real rank (not #1) and are never dropped silently", () => {
  const first = planDays(base());
  const tue = dayOf(first, TUE.date).stops.map((s) => s.id);
  // a far-out door that Tuesday's plan had, now carried: it does not jump ahead of better doors near the start
  const far = pt("far-carried", 99, 0, 11, open("11:00", "23:00"));
  const prev = { ...first, days: first.days.map((d) => (d.date === TUE.date ? { ...d, stops: [...d.stops, { id: "far-carried" }] } : d)) };
  const again = planDays(base({ pool: [...AUS_POOL, { ...far, rank: 99 }], now: { date: WED.date, min: H(9) }, previous: prev }));
  assert.ok(again.carried.includes("far-carried"));
  const later = again.days.filter((d) => !d.past).flatMap((d) => d.stops.map((s) => s.id));
  assert.ok(!later.includes("far-carried"), "a carried door 11 km out does not pull a day across town");
  const note = again.notes.find((n) => n.kind === "carried-unscheduled");
  assert.ok(note?.ids.includes("far-carried"), "named in a note");
  assert.match(again.reasons["far-carried"].text, /no time left|better-ranked|in place of/); // H1: no area wall: the days are full
  // the other carried doors are back on later days
  for (const id of tue) if (!later.includes(id)) assert.ok(note?.ids.includes(id), `${id} dropped silently`);
});

test("F1: areas split the week by area and ignore statuses (marking a door never moves them)", () => {
  const input = { pool: AUS_POOL, windows: WEEK, visitMin: 25 };
  const a = areasFor(input);
  assert.equal(a.length, 3);
  const all = a.flatMap((x) => x.ids);
  assert.equal(new Set(all).size, all.length, "a door is in one area");
  const b = areasFor({ ...input, statuses: { [a[0].ids[0]]: "notfit" } });
  assert.deepEqual(b, a);
});

test("F1 (Diolosa 16): no single-door move shortens a day's drive by 5 min or more and keeps the rules", () => {
  const plan = planDays(base());
  for (const w of WEEK) {
    const order = dayOf(plan, w.date).stops.map((s) => s.id);
    const mine = timed(w, order);
    for (let i = 0; i < order.length; i++) {
      const rest = [...order.slice(0, i), ...order.slice(i + 1)];
      for (let j = 0; j <= rest.length; j++) {
        const d = timed(w, [...rest.slice(0, j), order[i], ...rest.slice(j)]);
        assert.ok(!(keepsRules(w, d, mine) && d.min <= mine.min - 5), `${w.date}: moving stop ${i + 1} to ${j + 1} saves ${mine.min - d.min} min`);
      }
    }
  }
});

test("F1: a contact that opens after the day starts is still scheduled (C2: opens 4 pm, Wed 1–6 pm)", () => {
  // the contact can't be the first door of a 1 pm day (closed, and too long a wait); once the day has doors it fits
  const contact = pt("contact", null, 0.4, 0.3, open("16:00", "23:00"));
  const pool = [...AUS_POOL, contact];
  const plan = planDays(base({ pool, windows: [WED], pinned: [{ id: "contact", kind: "contact" }] }));
  const s = plan.days[0].stops.find((x) => x.id === "contact");
  assert.ok(s, `contact not scheduled: ${JSON.stringify(plan.notes)}`);
  assert.equal(s.pinned, "contact");
  assert.ok(s.eta >= H(16));
  assert.ok(!plan.notes.some((n) => n.kind === "contact-unscheduled"));
});

test("F1 (C2 repro): the demo's 4 pm contact lands on Wednesday 1–6 pm, the first window it fits, not Thursday", async () => {
  const { buildPool, windowsFor } = await import("../public/lib/pool.js");
  const route = readJson("public/data/routes/athletic-brewing-austin.json");
  const yard = Object.entries(route.venues).find(([, v]) => v.name === "The Yard")[0];
  const id = "00000000-0000-4000-8000-78D0B9090FD4"; // Stephen F's Bar & Terrace, opens 4 pm
  const v = route.venues[id];
  const profile = {
    what: "Non-alcoholic hazy IPA", rooms: ["bars", "breweries"], drinks: [{ key: "athletic-brewing", name: "Athletic Brewing", ready: true }],
    start: START, visitMin: 25, known: [yard],
    windows: [{ date: "2026-10-13", from: "14:00", to: "16:00" }, { date: "2026-10-14", from: "13:00", to: "18:00" }, { date: "2026-10-15", from: "14:00", to: "17:00" }],
  };
  const pool = buildPool({ routes: [route], profile, contacts: [{ id, name: v.name, lat: v.lat, lon: v.lon, hours: v.hours, genre: v.genre }], cityName: "Austin" });
  const plan = planDays({ pool: pool.rows, statuses: pool.statuses, windows: windowsFor(profile), visitMin: 25, pinned: pool.pinned });
  const day = plan.days.find((d) => d.stops.some((s) => s.id === id));
  assert.equal(day?.date, "2026-10-14", `contact on ${day?.date}`);
  assert.ok(!plan.notes.some((n) => n.kind === "contact-unscheduled"));
  for (const d of plan.days) assert.ok(d.end <= d.to);
});

test("F1 (C2 report): with Tuesday frozen, Wednesday 1–6 pm is not left as a ring of late rooms (stays ≥ 7 doors)", async () => {
  // C2's demo week (Tue 2–4, Wed 1–6, Thu 2–5, The Yard known): Tuesday's stop 1 is visited, so Tuesday is frozen and
  // only Wednesday and Thursday are split by area. Distance order gave Wednesday a ring around Thursday's doors.
  const { buildPool, windowsFor } = await import("../public/lib/pool.js");
  const route = readJson("public/data/routes/athletic-brewing-austin.json");
  const yard = Object.entries(route.venues).find(([, v]) => v.name === "The Yard")[0];
  const profile = {
    what: "Non-alcoholic hazy IPA", rooms: ["bars", "breweries"], drinks: [{ key: "athletic-brewing", name: "Athletic Brewing", ready: true }],
    start: START, visitMin: 25, known: [yard],
    windows: [{ date: "2026-10-13", from: "14:00", to: "16:00" }, { date: "2026-10-14", from: "13:00", to: "18:00" }, { date: "2026-10-15", from: "14:00", to: "17:00" }],
  };
  const pool = buildPool({ routes: [route], profile, cityName: "Austin" });
  const input = { pool: pool.rows, statuses: pool.statuses, windows: windowsFor(profile), visitMin: 25, pinned: pool.pinned };
  const first = planDays(input);
  const tue = first.days[0].stops.map((s) => s.id);
  const statuses = { ...pool.statuses, [tue[0]]: "visited" };
  const again = planDays({ ...input, statuses, frozen: { date: "2026-10-13", from: 840, ids: tue }, now: { date: "2026-10-09", min: 600 }, previous: first });
  const wed = again.days.find((d) => d.date === "2026-10-14");
  assert.ok(wed.stops.length >= 7, `Wednesday ${wed.stops.length} doors, done ${wed.end}`);
});

test("F1b: a re-plan keeps later days' doors (only changed, carried and pinned doors and freed time are re-decided)", () => {
  const first = planDays(base());
  const tue = dayOf(first, TUE.date).stops.map((s) => s.id);
  // a door on Tuesday is marked not a fit: Wednesday and Thursday keep every door they had, and end no earlier
  const again = planDays(base({ statuses: { [tue[1]]: "notfit" }, previous: first }));
  for (const w of [WED, THU]) {
    const before = dayOf(first, w.date);
    const after = dayOf(again, w.date);
    const now = new Set(after.stops.map((s) => s.id));
    for (const s of before.stops) assert.ok(now.has(s.id), `${w.day} lost ${s.id}`);
    assert.ok(after.end >= before.end - 25, `${w.day} ends ${before.end - after.end} min earlier`);
  }
  // the day the door was on re-plans its freed time: no rule broken, the door gone
  assert.ok(!dayOf(again, TUE.date).stops.some((s) => s.id === tue[1]));
  // an edited window plans afresh: the previous plan is not reused for it
  const wider = planDays(base({ windows: [TUE, { ...WED, to: H(19) }, THU], previous: first }));
  assert.ok(dayOf(wider, WED.date).end <= H(19));
});

test("judge pass 5 #2: a re-plan with nothing changed keeps a later day as it was, around a follow-up with a set time", () => {
  // a Friday visit logged (or a reload) re-plans the week; with a follow-up pinned at a time on a later day, the doors
  // were taken back one at a time around it, one was lost, and the day flipped between two plans on every re-plan
  const START = { lat: 41.9088, lon: -87.6796 };
  const pool0 = ranked(CHI);
  for (const [i, k] of [[0, 1], [2, 1], [2, 2]]) {
    const w = WEEK.map((x) => ({ ...x, start: START }))[k];
    const id = pool0[i].id;
    // "back Wednesday at 2": that day the door is open to the rep from 2 pm for half an hour (pool.js, a follow-up's time)
    const pool = pool0.map((r) => (r.id !== id ? r : { ...r, parsedHours: { ...r.parsedHours, days: { ...r.parsedHours.days, [w.day]: { closed: false, spans: [{ from: H(14), to: H(14, 30) }] } } } }));
    const input = { pool, windows: WEEK.map((x) => ({ ...x, start: START })), visitMin: 25, travel: estimateTravel, now: { date: "2026-10-12", min: 600 }, statuses: { [id]: "visited" }, pinned: [{ id, kind: "followup", date: w.date }] };
    const first = planDays({ ...input, previous: planDays({ ...input, statuses: {}, pinned: [] }) });
    let cur = first;
    for (let n = 1; n <= 3; n++) {
      cur = planDays({ ...input, previous: cur });
      for (const d of first.days) assert.deepEqual(dayOf(cur, d.date).stops.map((s) => s.id), d.stops.map((s) => s.id), `#${i + 1} pinned on ${w.day}: ${d.day} changed on re-plan ${n}`);
    }
  }
});

test("F1b: never strips a later day (b): over the Austin week, ten marks in a row leave untouched days within one stop of their end", () => {
  let cur = planDays(base());
  let statuses = {};
  for (let i = 0; i < 10; i++) {
    const d = cur.days[i % cur.days.length];
    const id = d.stops[0]?.id;
    if (!id) continue;
    statuses = { ...statuses, [id]: "notfit" };
    const next = planDays(base({ statuses, previous: cur }));
    next.days.forEach((nd, k) => {
      if (cur.days[k].date === d.date) return;
      assert.ok(nd.end >= cur.days[k].end - 25 - 15, `${nd.day} ends ${cur.days[k].end - nd.end} min earlier after mark ${i + 1}`);
    });
    cur = next;
  }
});

test("F1: a planned day's last visit ends at least END_SLACK_MIN (5) before its window closes", () => {
  assert.equal(END_SLACK_MIN, 5);
  for (const plan of [planDays(base()), planDays(base({ windows: [{ ...WED, to: H(15, 7) }] }))]) {
    for (const d of plan.days) assert.ok(d.end <= d.to - END_SLACK_MIN, `${d.day} ends ${d.to - d.end} min before ${d.to}`);
  }
});

test("F4: replanCost against the previous plan: added miles, dropped and moved doors, and how the miles were measured", () => {
  const first = planDays(base());
  const id = dayOf(first, WED.date).stops[0].id;
  const again = planDays(base({ statuses: { [id]: "notfit" }, previous: first }));
  const c = again.replanCost;
  assert.ok(c && Number.isFinite(c.addedMi) && Array.isArray(c.droppedIds) && Array.isArray(c.movedIds));
  assert.equal(c.source, "estimate");
  assert.ok(!c.droppedIds.includes(id), "a door the rep marked is not counted as dropped");
});

test("F4: a day that leaves later than its window says when (day.leave), and stop 1's timing starts there", () => {
  const pool = [pt("late1", 1, 0.5, 0, open("16:00", "23:00")), pt("late2", 2, 0.8, 0.2, open("16:00", "23:00"))];
  const d = planDays(base({ pool, windows: [TUE26] })).days[0];
  assert.ok(d.leave > d.from, `leave ${d.leave}`);
  assert.equal(d.stops[0].eta, d.leave + d.stops[0].legMin + d.stops[0].waitMin);
});

test("F4: a follow-up across town costs a full day at most two doors, and the re-plan cost names them (it never rebuilds the day)", async () => {
  const { buildPool, windowsFor } = await import("../public/lib/pool.js");
  const route = readJson("public/data/routes/athletic-brewing-austin.json");
  const known = Object.keys(route.venues).find((id) => route.venues[id].name === "Central District Brewing");
  const profile = { what: "Non-alcoholic hazy IPA", rooms: ["bars", "breweries"], drinks: [{ key: "athletic-brewing", name: "Athletic Brewing", ready: true }], start: START, visitMin: 25, known: [known],
    windows: [{ date: "2026-10-13", from: "13:00", to: "18:00" }, { date: "2026-10-14", from: "14:00", to: "17:00" }, { date: "2026-10-15", from: "14:00", to: "17:00" }] };
  const pool = buildPool({ routes: [route], profile, cityName: "Austin" });
  const ws = windowsFor(profile);
  const p0 = planDays({ pool: pool.rows, statuses: pool.statuses, windows: ws, visitMin: 25, pinned: [] });
  const nomadic = p0.days[0].stops.find((s) => pool.venues[s.id].name === "Nomadic Beerworks").id;
  const pool2 = buildPool({ routes: [route], profile, statuses: { [nomadic]: "visited" }, outcomes: { [nomadic]: { result: "interested", followUp: "2026-10-15" } }, cityName: "Austin" });
  const p2 = planDays({ pool: pool2.rows, statuses: pool2.statuses, windows: ws, visitMin: 25, pinned: pool2.pinned, frozen: { date: "2026-10-13", from: 780, ids: p0.days[0].stops.map((s) => s.id) }, previous: p0 });
  const thu = p2.days[2].stops.map((s) => s.id);
  assert.ok(thu.includes(nomadic), "the return visit is on Thursday");
  const lost = p0.days[2].stops.filter((s) => !thu.includes(s.id));
  assert.ok(lost.length <= 2, `Thursday lost ${lost.length} doors`);
  assert.deepEqual(p2.replanCost.droppedIds.sort(), lost.map((s) => s.id).sort());
});

test("F4: a contact is due only on a window it's open in (it is never forced into a closed day's take-back)", () => {
  const thursOnly = parseHours({ thursday: [{ opens: "T11:00:00", closes: "T23:00:00" }], tuesday: [{ closed: true }], wednesday: [{ closed: true }] });
  const pool = [...AUS_POOL, { id: "c-thu", rank: null, lat: 30.262, lon: -97.73, parsedHours: thursOnly }];
  const first = planDays(base({ pool, pinned: [{ id: "c-thu", kind: "contact" }] }));
  const again = planDays(base({ pool, pinned: [{ id: "c-thu", kind: "contact" }], statuses: { [AUS_POOL[3].id]: "notfit" }, previous: first }));
  for (const p of [first, again]) {
    assert.equal(p.days.findIndex((d) => d.stops.some((s) => s.id === "c-thu")), 2, "on Thursday");
    assert.ok(!p.notes.some((n) => n.kind === "contact-unscheduled"));
  }
});

test("F4: the current (frozen) day keeps the departure it was planned with, and waits where it was planned to", () => {
  const pool = [pt("late1", 1, 0.5, 0, open("16:00", "23:00")), pt("late2", 2, 0.8, 0.2, open("16:00", "23:00")), pt("late3", 3, 1.0, 0.4, open("16:30", "23:00"))];
  const first = planDays(base({ pool, windows: [TUE26] }));
  const d0 = first.days[0];
  assert.ok(d0.leave > d0.from);
  const again = planDays(base({ pool, windows: [TUE26], statuses: { [d0.stops[0].id]: "visited" }, frozen: { date: TUE26.date, ids: d0.stops.map((s) => s.id) }, previous: first }));
  const d1 = again.days[0];
  assert.equal(d1.frozen, true);
  assert.equal(d1.leave, d0.leave);
  assert.deepEqual(d1.stops.map((s) => s.eta), d0.stops.map((s) => s.eta), "same times as planned");
  assert.ok(d1.stops.every((s) => s.openAtArrival !== false));
});

// ---- G4 (owner review 2): locks (drag = lock) and the current day re-routed after a visit out of order ----
const order = (d) => d.stops.map((s) => s.id);
const legalFree = (d) => d.stops.filter((s) => !s.locked).every((s) => s.openAtArrival !== false && s.depart <= d.to - END_SLACK_MIN);
const once = (plan) => assert.equal(new Set(ids(plan)).size, ids(plan).length, "a door twice");

test("G4 locks: a door dragged onto another day holds that day at its index; the day re-plans around it", () => {
  const first = planDays(base({ windows: [TUE26, WED, THU] }));
  const wed = order(dayOf(first, WED.date));
  const tue = order(dayOf(first, TUE.date));
  // a Wednesday door open all Tuesday afternoon (one that closes at 3 pm can't be second on a 2 pm day)
  const id = wed.slice(2).find((x) => byId.get(x).parsedHours.days.tuesday?.spans?.some((s) => s.from <= TUE26.from && s.to >= TUE26.to));
  const p = planDays(base({ windows: [TUE26, WED, THU], locks: [{ id, date: TUE.date, index: 1 }], previous: first }));
  const d = dayOf(p, TUE.date);
  assert.equal(order(d)[1], id, "at index 1");
  assert.equal(d.stops[1].locked, true);
  assert.ok(d.stops.filter((s) => s.id !== id).every((s) => !s.locked));
  assert.ok(!order(dayOf(p, WED.date)).includes(id), "off Wednesday");
  assert.ok(legalFree(d), "every free stop open on arrival, inside the window");
  // the day keeps the doors it had where they still fit, and the other days plan around it
  assert.ok(tue.filter((x) => order(d).includes(x)).length >= tue.length - 2, `${tue} → ${order(d)}`);
  once(p);
  // stable: the same locks again change nothing
  const again = planDays(base({ windows: [TUE26, WED, THU], locks: [{ id, date: TUE.date, index: 1 }], previous: p }));
  assert.deepEqual(again.days.map(order), p.days.map(order));
});

test("G4 locks: several on a day keep their order, each at its index; the free doors re-route between them", () => {
  const first = planDays(base());
  const wed = order(dayOf(first, WED.date));
  assert.ok(wed.length >= 6);
  // the owner's mockup: one put first, one put fourth
  const locks = [{ id: wed.at(-1), date: WED.date, index: 0 }, { id: wed[0], date: WED.date, index: 3 }];
  const p = planDays(base({ locks, previous: first }));
  const d = dayOf(p, WED.date);
  assert.equal(order(d)[0], wed.at(-1));
  assert.equal(order(d)[3], wed[0]);
  assert.deepEqual(d.stops.filter((s) => s.locked).map((s) => s.id), [wed.at(-1), wed[0]]);
  assert.ok(legalFree(d));
  once(p);
  // an index past the day's end puts it last; two locks at one index keep their order
  const q = planDays(base({ locks: [{ id: wed[1], date: WED.date, index: 40 }], previous: first }));
  assert.equal(order(dayOf(q, WED.date)).at(-1), wed[1]);
  const r = planDays(base({ locks: [{ id: wed[3], date: WED.date, index: 0 }, { id: wed[4], date: WED.date, index: 0 }], previous: first }));
  assert.deepEqual(order(dayOf(r, WED.date)).slice(0, 2), [wed[3], wed[4]]);
});

// fix12 (fill-rank's pre-existing edge): a door that closes at 3 pm, locked second on a 2 pm day, can't be open when
// reached; dropping every free door slid it to first, where it is, so the day went down to that one stop. A lock holds
// its index: it stays there, flagged, and the day keeps its doors.
test("fix12 locks: a lock that can't be open at its index keeps it, flagged; the rest of the day stays", () => {
  const first = planDays(base({ windows: [TUE26, WED, THU] }));
  const tue = order(dayOf(first, TUE.date));
  const wed = order(dayOf(first, WED.date));
  const id = wed.find((x) => byId.get(x).parsedHours.days.tuesday?.spans?.some((s) => s.from <= TUE26.from && s.to === H(15)));
  assert.ok(id, "a Wednesday door that closes at 3 pm on Tuesday");
  for (const index of [1, 2]) {
    const p = planDays(base({ windows: [TUE26, WED, THU], locks: [{ id, date: TUE.date, index }], previous: first }));
    const d = dayOf(p, TUE.date);
    assert.equal(order(d)[index], id, `at index ${index}: ${order(d)}`);
    assert.equal(d.stops[index].openAtArrival, false, "flagged honestly");
    assert.ok(p.notes.some((n) => n.kind === "lock" && n.id === id), JSON.stringify(p.notes));
    assert.ok(d.stops.length >= tue.length - 2, `${tue.length} → ${d.stops.length} stops`);
    assert.ok(legalFree(d), "every free stop open on arrival, inside the window");
    once(p);
  }
});

test("G4 locks: a locked door that can't be reached open at its slot stays, flagged, with a note", () => {
  const pool = [pt("a", 1, 0.5, 0, open("12:00", "23:00")), pt("b", 2, 0.8, 0.2, open("12:00", "23:00")), pt("late", 3, 1.0, 0.4, open("12:00", "23:00", ["monday"]))]; // closed Tuesdays
  const p = planDays(base({ pool, windows: [TUE26], locks: [{ id: "late", date: TUE.date, index: 0 }] }));
  const d = p.days[0];
  assert.equal(order(d)[0], "late");
  const s = d.stops[0];
  assert.equal(s.locked, true);
  assert.equal(s.openAtArrival, false, "flagged honestly: closed when she'd arrive");
  assert.ok(p.notes.some((n) => n.kind === "lock" && n.id === "late" && /^Locked here, but it isn't open when you'd arrive \(\d/.test(n.text)), JSON.stringify(p.notes));
});

test("G4 locks: a lock on a past day, on a marked door or on a door outside the pool is let go", () => {
  const first = planDays(base());
  const wed = order(dayOf(first, WED.date));
  const plain = planDays(base({ previous: first }));
  const p = planDays(base({ previous: first, locks: [{ id: wed[0], date: "2026-10-01", index: 0 }, { id: "nowhere", date: WED.date, index: 0 }, { id: wed[1], date: WED.date, index: 0 }], statuses: { [wed[1]]: "notfit" } }));
  const q = planDays(base({ previous: first, statuses: { [wed[1]]: "notfit" } }));
  assert.deepEqual(p.days.map(order), q.days.map(order));
  assert.ok(allStops(p).every((s) => !s.locked));
  assert.ok(allStops(plain).every((s) => s.locked === false), "no locks: every stop says locked:false");
});

// H1 (main's ruling): a visit out of order drops no door the rep can still reach; once the day is under way, the rest
// starts where the rep is (the later of now and the visit's end).
// F9 (live check 2): a visit logged for a day not yet started (Friday's stop logged Thursday night) keeps that day's
// plan: the visit is done in place at its planned time, every other stop keeps its place and time, nothing is carried,
// nothing re-routes, and the day says it hasn't begun (Your list's "under way" waits for the day itself).
test("F9 visit logged before its day starts: the day keeps its plan, the visit is done in place at its planned time", () => {
  const first = planDays(base({ windows: [TUE26, WED, THU] }));
  const d0 = dayOf(first, TUE.date);
  const tue = order(d0);
  assert.ok(tue.length >= 5, `${tue.length}`);
  const v = tue[2];
  const statuses = { [v]: "visited" };
  for (const now of [{ date: "2026-10-09", min: 1300 }, { date: TUE.date, min: TUE26.from - 5 }, null]) {
    const p = planDays(base({ windows: [TUE26, WED, THU], statuses, frozen: { date: TUE.date, from: TUE.from, ids: tue }, now, previous: first }));
    const d = dayOf(p, TUE.date);
    assert.equal(d.frozen, true);
    assert.equal(d.begun, false, "not under way before its window opens");
    assert.deepEqual(order(d), tue, "every stop keeps its place");
    assert.deepEqual(d.stops.map((s) => [s.eta, s.depart]), d0.stops.map((s) => [s.eta, s.depart]), "and its time: the visit at its planned time");
    assert.deepEqual(d.stops.map((s) => s.openAtArrival), d0.stops.map((s) => s.openAtArrival), "no 'closed when you'd arrive' from a reshuffle");
    assert.deepEqual(p.carried, []);
    assert.ok(!p.notes.some((n) => n.kind === "rerouted" || n.kind === "carried"), "nothing re-routed or carried");
    once(p);
  }
  // once the day is under way, a visit out of order re-routes the rest from where the rep is (G4, unchanged)
  const nowMin = d0.stops[0].depart + 10;
  const p = planDays(base({ windows: [TUE26, WED, THU], statuses, frozen: { date: TUE.date, from: TUE.from, ids: tue }, now: { date: TUE.date, min: nowMin }, previous: first }));
  const d = dayOf(p, TUE.date);
  assert.equal(d.begun, true);
  assert.equal(order(d)[0], v);
  assert.ok(p.notes.some((n) => n.kind === "rerouted" && n.mode === "now" && n.id === v));
});

test("G4 visit out of order during the day: the rest starts where the rep is; earlier stops re-plan, carried only if they no longer fit", () => {
  // two hours left after the visit: the skipped stops are still in reach (open till late, near), so they stay
  const pool = [pt("a", 1, 0.5, 0, open("12:00", "23:00")), pt("b", 2, 0.8, 0.2, open("12:00", "23:00")), pt("c", 3, 1.0, 0.4, open("12:00", "23:00")), pt("x", 4, 1.2, 0.1, open("12:00", "23:00"))];
  const W = { ...TUE, to: H(19) };
  const first = planDays(base({ pool, windows: [W] }));
  const day0 = first.days[0];
  const ids0 = order(day0);
  const v = ids0[2];
  const nowMin = day0.stops[0].depart + 30; // she skipped stops 1–2 and visited stop 3 first, then reopened the plan
  const p = planDays(base({ pool, windows: [W], statuses: { [v]: "visited" }, frozen: { date: W.date, from: W.from, ids: ids0 }, now: { date: W.date, min: nowMin }, previous: first }));
  const d = p.days[0];
  assert.equal(order(d)[0], v);
  assert.equal(d.stops[0].depart, nowMin, "from now: where she is");
  assert.ok(legalFree({ ...d, stops: d.stops.slice(1) }));
  assert.deepEqual(order(d).slice().sort(), ids0.slice().sort(), "the skipped stops, still in reach, stay");
  assert.deepEqual(p.carried, []);
  assert.ok(p.notes.some((n) => n.kind === "rerouted" && n.mode === "now" && n.at === nowMin && n.text === `Tuesday re-routed from this visit, from ${clockShort(nowMin)}.`));
  // on a packed day a skipped stop that closes before she can get back is carried, with the note
  const full = planDays(base({ windows: [TUE26] }));
  const t = order(full.days[0]);
  const late = planDays(base({ windows: [TUE26], statuses: { [t[1]]: "visited" }, frozen: { date: TUE.date, from: TUE.from, ids: t }, now: { date: TUE.date, min: full.days[0].stops[1].depart + 5 }, previous: full }));
  const off = t.filter((x) => !order(late.days[0]).includes(x));
  assert.deepEqual(late.carried.slice().sort(), off.slice().sort());
  if (off.length) assert.ok(late.notes.some((n) => n.kind === "carried" && n.ids.length === off.length));
  once(p);
});

test("G4 visit out of order on the day itself: the rest starts now when that is later; locks on the day hold", () => {
  const first = planDays(base({ windows: [TUE26, WED, THU] }));
  const tue = order(dayOf(first, TUE.date));
  const v = tue[1];
  const lock = { id: tue.at(-1), date: TUE.date, index: 1 };
  const nowMin = dayOf(first, TUE.date).stops[1].depart + 10;
  const p = planDays(base({ windows: [TUE26, WED, THU], statuses: { [v]: "visited" }, frozen: { date: TUE.date, from: TUE.from, ids: tue }, locks: [lock], now: { date: TUE.date, min: nowMin }, previous: first }));
  const d = dayOf(p, TUE.date);
  assert.equal(order(d)[0], v);
  assert.equal(d.stops[0].depart, nowMin, "she left it now");
  assert.equal(order(d)[1], lock.id, "the lock holds its place");
  assert.equal(d.stops[1].locked, true);
  once(p);
});

test("G4: a stop of the current day dragged to a later day leaves it; one dragged onto the current day joins it", () => {
  const first = planDays(base({ windows: [TUE26, WED, THU] }));
  const tue = order(dayOf(first, TUE.date));
  const wed = order(dayOf(first, WED.date));
  const frozen = { date: TUE.date, from: TUE.from, ids: tue };
  const out = planDays(base({ windows: [TUE26, WED, THU], frozen, locks: [{ id: tue[0], date: WED.date, index: 0 }], previous: first }));
  assert.ok(!order(dayOf(out, TUE.date)).includes(tue[0]));
  assert.equal(order(dayOf(out, WED.date))[0], tue[0]);
  once(out);
  const into = planDays(base({ windows: [TUE26, WED, THU], frozen, locks: [{ id: wed[0], date: TUE.date, index: 0 }], previous: first }));
  assert.equal(order(dayOf(into, TUE.date))[0], wed[0]);
  assert.ok(!order(dayOf(into, WED.date)).includes(wed[0]));
  once(into);
});

test("G4 locks: index null holds the door on that day only (a drop on a day's tab), placed where it fits, never taken off", () => {
  const first = planDays(base({ windows: [TUE26, WED, THU] }));
  const wed = order(dayOf(first, WED.date));
  const id = wed.at(-1);
  const p = planDays(base({ windows: [TUE26, WED, THU], locks: [{ id, date: TUE.date, index: null }], previous: first }));
  const d = dayOf(p, TUE.date);
  const s = d.stops.find((x) => x.id === id);
  assert.ok(s, "on Tuesday");
  assert.equal(s.locked, true);
  assert.equal(s.lockDay, true);
  assert.ok(legalFree(d));
  once(p);
  // on the current day too
  const tue = order(dayOf(first, TUE.date));
  const q = planDays(base({ windows: [TUE26, WED, THU], frozen: { date: TUE.date, from: TUE.from, ids: tue }, locks: [{ id, date: TUE.date, index: null }], previous: first }));
  assert.ok(order(dayOf(q, TUE.date)).includes(id));
  assert.ok(!order(dayOf(q, WED.date)).includes(id));
  once(q);
});

test("G4 locks: a day whose first stop is locked leaves so as to reach it as it opens", () => {
  const pool = [pt("a", 1, 0.5, 0, open("12:00", "23:00")), pt("b", 2, 0.8, 0.2, open("12:00", "23:00")), pt("late", 3, 1.0, 0.4, open("16:00", "23:00"))];
  const p = planDays(base({ pool, windows: [TUE26], locks: [{ id: "late", date: TUE.date, index: 0 }] }));
  const d = p.days[0];
  assert.equal(order(d)[0], "late");
  assert.notEqual(d.stops[0].openAtArrival, false);
  assert.ok(d.leave > TUE26.from, "leaves later");
  assert.ok(!p.notes.some((n) => n.kind === "lock"));
});

// judge pass 3 N1: "skip" locks a door onto Tuesday (index null); "back Tuesday at 3 / at 4" then pins two follow-ups
// there, their Tuesday hours starting at the time she said (pool.js). The locked day must keep them (its free doors
// come off first), and a follow-up that still can't go says why on that day, never "no window" or an ISO date.
test("N1: follow-ups due on a locked day are placed there before its free doors, and a miss names that day", () => {
  const pool0 = ranked(CHI);
  const start = { lat: pool0[0].lat + 0.01, lon: pool0[0].lon };
  const FRI = { date: "2026-10-23", day: "friday", from: H(13), to: H(18), start };
  const TUE27 = { date: "2026-10-27", day: "tuesday", from: H(14), to: H(18), start };
  // as pool.js does: on that weekday the hours start at the time she said (left as they are when it isn't open then)
  const from = (pool, id, t) => pool.map((r) => {
    const spans = r.id === id && r.parsedHours?.ok ? (r.parsedHours.days.tuesday?.spans ?? []).filter((x) => x.to - Math.max(x.from, t) >= 15).map((x) => ({ from: Math.max(x.from, t), to: x.to })) : [];
    return spans.length ? { ...r, parsedHours: { ...r.parsedHours, days: { ...r.parsedHours.days, tuesday: { closed: false, spans } } } } : r;
  });
  const opts = (o) => ({ pool: pool0, statuses: {}, windows: [FRI, TUE27], visitMin: 25, travel: estimateTravel, pinned: [], ...o });
  const first = planDays(opts({}));
  const fri = first.days[0].stops.map((s) => s.id);
  let placed = 0;
  let open = 0;
  for (let a = 0; a < fri.length; a++)
    for (let c = 0; c < fri.length; c++) {
      const lock = fri[(a + 1) % fri.length];
      if (a === c || lock === fri[c]) continue;
      const fu = [fri[a], fri[c]];
      const pool = from(from(pool0, fu[0], H(15)), fu[1], H(16));
      const p = planDays(opts({ pool, previous: first, statuses: { [fu[0]]: "visited", [fu[1]]: "visited" }, pinned: fu.map((id) => ({ id, kind: "followup", date: TUE27.date })), locks: [{ id: lock, date: TUE27.date, index: null }] }));
      const tue = dayOf(p, TUE27.date).stops.map((s) => s.id);
      assert.ok(tue.includes(lock), "the lock holds");
      for (const id of fu) {
        const r = pool.find((x) => x.id === id);
        const spans = r.parsedHours?.ok ? r.parsedHours.days.tuesday?.spans ?? [] : [{ from: 0, to: 1440 }];
        if (spans.some((x) => Math.min(x.to, TUE27.to) - Math.max(x.from, TUE27.from) >= 25)) open++;
        if (tue.includes(id)) placed++;
        else {
          const n = p.notes.find((x) => x.kind === "followup-unscheduled" && x.id === id);
          assert.ok(n && /Tuesday/.test(n.text), `a missed follow-up names Tuesday: ${n?.text}`);
        }
      }
      for (const n of p.notes) assert.ok(!/\d{4}-\d{2}-\d{2}/.test(n.text) && !/no window/.test(n.text), `note: ${n.text}`);
    }
  // free doors come off for them: every follow-up open in Tuesday's window is placed (fill "week": Friday holds fewer
  // doors, so fewer pairs: 84)
  assert.ok(open > 70, `${open} open`);
  assert.equal(placed, open, `${placed} of ${open} follow-ups open on Tuesday are on it`);
});

// ---- Fill by rank, then route (owner, 2026-10-23): each calendar week takes the best-ranked free doors its days
// hold (WEEK_SLACK more), its days plan on them as before (an area a day, worth vs driving); fill "area" is the old
// whole-plan choice. Pins, locks, carried and unranked doors are never held back; a door below every week's set still
// goes on where it is on the way in time a day has left.
const NEXT = WEEK.map((w) => ({ ...w, date: `2026-10-${Number(w.date.slice(8)) + 7}` }));
const median = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
const rankOf = new Map(AUS_POOL.map((r) => [r.id, r.rank]));
const weekRanks = (plan, ws) => plan.days.filter((d) => ws.some((w) => w.date === d.date)).flatMap((d) => d.stops.map((s) => rankOf.get(s.id)));

test("fill by rank: the default; over two weeks the first takes better-ranked doors than fill area, every stop open on arrival", () => {
  const windows = [...WEEK, ...NEXT];
  const week = planDays(base({ windows }));
  assert.deepEqual(week, planDays(base({ windows, fill: "week" })), "week is the default");
  const area = planDays(base({ windows, fill: "area" }));
  const [w1, a1] = [weekRanks(week, WEEK), weekRanks(area, WEEK)];
  assert.ok(median(w1) < median(a1), `week 1 median #${median(w1)} (area #${median(a1)})`);
  assert.ok(Math.max(...w1) < Math.max(...a1), `week 1 worst #${Math.max(...w1)} (area #${Math.max(...a1)})`);
  assert.ok(median(weekRanks(week, NEXT)) > median(w1), "week 2 takes the next doors down");
  for (const d of week.days) assert.ok(legalFree(d), d.date);
  once(week);
  for (const id of week.unscheduled) assert.ok(week.reasons[id]?.text, `no reason for ${id}`);
});

test("fill by rank: a day's free time before its best doors open is filled with doors on the way, below the week's set", () => {
  const late = (from) => Object.fromEntries(["tuesday"].map((d) => [d, [{ opens: `T${from}:00`, closes: "T23:00:00" }]]));
  const pool = [
    ...Array.from({ length: 20 }, (_, i) => pt(`top${i + 1}`, i + 1, (i % 4) * 0.3, 2 + Math.floor(i / 4) * 0.3, late("16:00"))),
    ...Array.from({ length: 20 }, (_, i) => pt(`low${i + 50}`, i + 50, -0.5 - (i % 4) * 0.3, 1 + Math.floor(i / 4) * 0.3, late("11:00"))),
  ];
  const d = planDays(base({ pool, windows: [TUE26] })).days[0];
  const after = d.stops.filter((s) => s.eta >= H(16)).map((s) => s.id);
  assert.deepEqual(after.slice().sort(), ["top1", "top2", "top3", "top4"], "the best-ranked doors once they open");
  assert.ok(d.stops.filter((s) => s.eta < H(16)).length >= 3, "2–4 pm is not left empty");
});

test("fill by rank: road-matrix areas go week by week (a later week's area never holds a door an earlier one does)", () => {
  const areas = areasFor({ pool: AUS_POOL, windows: [...WEEK, ...NEXT], visitMin: 25 });
  assert.equal(areas.length, 6);
  const first = new Set(areas.slice(0, 3).flatMap((a) => a.ids));
  for (const a of areas.slice(3)) assert.ok(a.ids.every((id) => !first.has(id)), a.date);
  assert.ok(median(areas.slice(0, 3).flatMap((a) => a.ids).map((id) => rankOf.get(id))) < median(areas.slice(3).flatMap((a) => a.ids).map((id) => rankOf.get(id))));
  const old = areasFor({ pool: AUS_POOL, windows: [...WEEK, ...NEXT], visitMin: 25, fill: "area" });
  assert.notDeepEqual(areas.map((a) => a.ids), old.map((a) => a.ids));
});

test("fill by rank: a re-plan keeps each week's doors; marking a week-1 door 'not a fit' leaves week 2 as it was", () => {
  const windows = [...WEEK, ...NEXT];
  const first = planDays(base({ windows }));
  const gone = dayOf(first, WED.date).stops[1].id;
  const p = planDays(base({ windows, previous: first, statuses: { [gone]: "notfit" } }));
  for (const w of NEXT) assert.deepEqual(order(dayOf(p, w.date)), order(dayOf(first, w.date)), w.date);
  assert.ok(!ids(p).includes(gone));
  const again = planDays(base({ windows, previous: first }));
  assert.deepEqual(again.days.map(order), first.days.map(order), "nothing changed: the same plan");
});

// Two weeks name the day by date where a weekday repeats ("adds 40 min of driving to Tue Oct 20"), and an hours reason
// names each weekday once (not "closed Tuesday, Wednesday, Thursday, Tuesday, …").
test("reasons over two weeks: a repeated weekday is named by its date, an hours reason names each weekday once", () => {
  const windows = [...WEEK, ...NEXT];
  const plan = planDays(base({ windows }));
  const texts = Object.values(plan.reasons).map((r) => r.text);
  for (const t of texts) assert.doesNotMatch(t, /\b(Tuesday|Wednesday|Thursday)\b(?!,? )?.*\b\1\b/, t);
  const dayed = Object.values(plan.reasons).filter((r) => r.date && !["status"].includes(r.code));
  assert.ok(dayed.length > 0);
  for (const r of dayed) assert.match(r.text, new RegExp(niceDate(r.date)), r.text);
  const closed = pt("shut", 1, 0.1, 0.1, { monday: [{ opens: "T11:00:00", closes: "T22:00:00" }], tuesday: [{ closed: true }], wednesday: [{ closed: true }], thursday: [{ closed: true }] });
  assert.equal(planDays(base({ pool: [closed, ...AUS_POOL.slice(0, 5)], windows })).reasons.shut.text, "closed Tuesday, Wednesday and Thursday");
  // restReason still says a full day short
  assert.equal(restReason({ reasons: { x: { code: "full", text: "Tue Oct 20 had no time left for it" } } }, "x"), "Tue Oct 20 is full");
});

// judge 11 #3: "fills the wait until the next door opens at 1:36 pm" printed the next stop's ARRIVAL as an opening time.
// A gap-filler's reason names the next door and its real arrival, and says "opens" only when that arrival is its opening.
test("judge 11 #3: a gap-filling stop names the next door and when she arrives there", () => {
  const plans = [planDays(base()), planDays(base({ windows: WEEK.map((w) => ({ ...w, from: H(11) })) }))];
  let seen = 0;
  for (const plan of plans) for (const d of plan.days) d.stops.forEach((s, i) => {
    if (!/^fills /.test(s.orderReason ?? "")) return;
    seen++;
    const next = d.stops[i + 1];
    const name = byId.get(next.id).name;
    assert.ok(s.orderReason.includes(name), `${s.orderReason} names ${name}`);
    assert.ok(s.orderReason.endsWith(` at ${clockShort(next.eta)}`), `${s.orderReason}: the arrival ${clockShort(next.eta)}`);
    assert.doesNotMatch(s.orderReason, /next door opens/);
  });
  assert.ok(seen > 0, "the Austin week has a gap-filling stop");
});
