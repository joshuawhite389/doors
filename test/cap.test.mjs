// J1: a doors-per-day cap in the planner (windows[i].max, PLAN-V2 owner review 5): no day holds more than its cap; at
// the cap a day takes the best-ranked rooms that fit, even at more driving; pins count and are never dropped; a room
// the cap leaves off says so; no cap plans exactly as before.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHours } from "../public/lib/core.js";
import { planDays, estimateTravel, DOOR_MIN } from "../public/lib/schedule.js";
import { readJson } from "./helpers.mjs";

const AUS = readJson("test/fixtures/athletic-brewing-austin.json");
const AUS_POOL = AUS.pool.slice(0, AUS.ranked).map((r) => ({ ...r, parsedHours: parseHours(r.hours) }));
const START = { lat: 30.2556, lon: -97.7208 };
const H = (h, m = 0) => h * 60 + m;
const TUE = { date: "2026-10-13", day: "tuesday", from: H(14), to: H(16), start: START };
const WED = { date: "2026-10-14", day: "wednesday", from: H(13), to: H(18), start: START };
const THU = { date: "2026-10-15", day: "thursday", from: H(11), to: H(15), start: START };
const WEEK = [TUE, WED, THU];
const capped = (n, ws = WEEK) => ws.map((w) => ({ ...w, max: n }));
const base = (over = {}) => ({ pool: AUS_POOL, statuses: {}, windows: WEEK, visitMin: 25, travel: estimateTravel, pinned: [], ...over });
const dayOf = (plan, date) => plan.days.find((d) => d.date === date);

// a made-up town: #1 a long drive east, #2–#10 a short walk from the start (hours unknown: open whenever)
const room = (id, rank, dLat, dLon) => ({ id, rank, lat: START.lat + dLat, lon: START.lon + dLon, parsedHours: parseHours(null) });
const TOWN = [room("far1", 1, 0, 0.09), ...Array.from({ length: 9 }, (_, i) => room(`near${i + 2}`, i + 2, 0.004 + 0.001 * i, 0.002))];
const TOWN_DAY = { date: "2026-10-13", day: "tuesday", from: H(14), to: H(17), start: START };

test("cap 3: no day holds more than 3 stops", () => {
  const free = planDays(base());
  assert.ok(free.days.some((d) => d.stops.length > 3), "the uncapped week has a day over 3");
  const plan = planDays(base({ windows: capped(3) }));
  for (const d of plan.days) assert.ok(d.stops.length <= 3, `${d.date}: ${d.stops.length} stops`);
  assert.ok(plan.days.every((d) => d.stops.length === 3), "each day still fills to its cap");
  // a per-day cap: only that day is held to it
  const one = planDays(base({ windows: [{ ...TUE, max: 1 }, WED, THU] }));
  assert.equal(dayOf(one, TUE.date).stops.length, 1);
  assert.ok(dayOf(one, WED.date).stops.length > 3);
});

// K1 (driving first) supersedes J1's "best-ranked even at more driving": within a cap the same objective picks.
test("within a cap the same objective picks: the rooms nearest the loop; #1 far away is a detour", () => {
  const far = estimateTravel(START, TOWN[0]).min;
  assert.ok(far > 20, `the far room is a long drive (${far} min)`);
  const plan = planDays({ pool: TOWN, windows: [{ ...TOWN_DAY, max: 1 }], visitMin: 25 });
  assert.deepEqual(plan.days[0].stops.map((s) => s.id), ["near2"]);
  assert.equal(plan.reasons.far1.code, "detour");
  const two = planDays({ pool: TOWN, windows: [{ ...TOWN_DAY, max: 2 }], visitMin: 25 });
  assert.deepEqual(two.days[0].stops.map((s) => s.id).sort(), ["near2", "near3"]);
});

test("a room the cap left off names a day at its cap, and would add at most DOOR_MIN to that day's loop", () => {
  const byId = new Map(AUS_POOL.map((r) => [r.id, r]));
  const m = (a, b) => (estimateTravel(a, b).min > 0 ? Math.max(1, Math.round(estimateTravel(a, b).min)) : 0); // as the planner rounds a leg
  for (const n of [2, 3]) {
    const plan = planDays(base({ windows: capped(n) }));
    for (const [id, why] of Object.entries(plan.reasons)) {
      if (why.code !== "cap") continue;
      const d = dayOf(plan, why.date);
      assert.equal(d.stops.length, n);
      const seq = d.stops.map((s) => byId.get(s.id));
      const loop = (q) => q.reduce((a, r, i) => a + m(i ? q[i - 1] : START, r), 0) + m(q.at(-1), START);
      const add = Math.min(...seq.map((_, p) => p).concat(seq.length).map((p) => loop([...seq.slice(0, p), byId.get(id), ...seq.slice(p)]) - loop(seq)));
      assert.ok(add <= DOOR_MIN, `cap ${n}: ${why.text}, but it adds ${add} min`);
    }
  }
});

test("pins count toward the cap and are never dropped; pins over the cap → just the pins", () => {
  const free = planDays(base());
  const tue = dayOf(free, TUE.date).stops.map((s) => s.id);
  assert.ok(tue.length >= 3);
  // three rooms added to Tuesday (dated contacts), cap 2: Tuesday holds those three and nothing else
  const pinned = tue.slice(0, 3).map((id) => ({ id, kind: "contact", date: TUE.date }));
  const over = planDays(base({ windows: capped(2), pinned }));
  assert.deepEqual(dayOf(over, TUE.date).stops.map((s) => s.id).sort(), tue.slice(0, 3).sort());
  for (const d of over.days) if (d.date !== TUE.date) assert.ok(d.stops.length <= 2);
  // one pin, cap 3: the pin and two doors
  const one = planDays(base({ windows: capped(3), pinned: pinned.slice(0, 1) }));
  const t1 = dayOf(one, TUE.date).stops;
  assert.equal(t1.length, 3);
  assert.ok(t1.some((s) => s.id === tue[0] && s.pinned === "contact"));
  // a lock and a pin on a day capped at 1: both stay, no free door joins them
  const locked = planDays(base({ windows: capped(1), pinned: [{ id: tue[0], kind: "contact", date: TUE.date }], locks: [{ id: tue[1], date: TUE.date, index: 1 }], previous: free }));
  assert.deepEqual(dayOf(locked, TUE.date).stops.map((s) => s.id).sort(), [tue[0], tue[1]].sort());
  for (const d of locked.days) if (d.date !== TUE.date) assert.ok(d.stops.length <= 1);
  // a re-plan with a cap lowered under the previous plan's day: it holds its cap
  const replan = planDays(base({ windows: capped(2), previous: free }));
  for (const d of replan.days) assert.ok(d.stops.length <= 2);
});

test("a room left off only by the cap says so", () => {
  const plan = planDays({ pool: TOWN, windows: [{ ...TOWN_DAY, max: 1 }], visitMin: 25 });
  assert.deepEqual(plan.reasons.near3, { code: "cap", text: "the day is at its limit of 1 door a day", date: TOWN_DAY.date });
  const week = planDays(base({ windows: capped(2) }));
  const why = Object.values(week.reasons).filter((r) => r.code === "cap");
  assert.ok(why.length > 0, "some room is left off by the cap");
  assert.ok(why.some((r) => r.text === "Tuesday is at its limit of 2 doors a day"), why.map((r) => r.text).join(" | "));
});

test("no cap: plans exactly as before (max null, undefined or out of range)", () => {
  const before = planDays(base());
  for (const max of [null, undefined, 0, -1, 2.5, "3"]) assert.deepEqual(planDays(base({ windows: WEEK.map((w) => ({ ...w, max })) })), before, `max ${max}`);
  const pinned = [{ id: AUS_POOL[3].id, kind: "contact" }];
  const p = planDays(base({ pinned }));
  assert.deepEqual(planDays(base({ pinned, windows: capped(null), previous: before })), planDays(base({ pinned, previous: before })));
  assert.deepEqual(planDays(base({ pinned, windows: capped(null) })), p);
});

const rankOf = new Map(AUS_POOL.map((r) => [r.id, r.rank]));
const idOf = (rank) => AUS_POOL.find((r) => r.rank === rank).id;

test("a lock onto a day at its cap takes off the day's worst-ranked free door, and the reason names that day", () => {
  const p0 = planDays(base({ windows: capped(3) }));
  const thu = dayOf(p0, THU.date).stops.map((s) => s.id);
  const mover = dayOf(p0, WED.date).stops.at(-1).id;
  const p = planDays(base({ windows: capped(3), previous: p0, locks: [{ id: mover, date: THU.date, index: 0 }] }));
  const got = dayOf(p, THU.date).stops.map((s) => s.id);
  assert.equal(got.length, 3);
  assert.equal(got[0], mover);
  const worst = thu.reduce((a, b) => (rankOf.get(b) > rankOf.get(a) ? b : a));
  assert.deepEqual(got.slice(1).sort(), thu.filter((id) => id !== worst).sort(), `Thu ${got.map((id) => "#" + rankOf.get(id))}`);
  if (!p.days.some((d) => d.stops.some((s) => s.id === worst))) assert.deepEqual(p.reasons[worst], { code: "cap", text: "Thursday is at its limit of 3 doors a day", date: THU.date });
});

test("undated contacts go to a day under its cap first; a day passes its cap only when no day has room", () => {
  const free = planDays(base());
  const tue = dayOf(free, TUE.date).stops.map((s) => s.id).slice(0, 3);
  const three = planDays(base({ windows: capped(1), pinned: tue.map((id) => ({ id, kind: "contact" })) }));
  for (const d of three.days) assert.equal(d.stops.length, 1, `${d.date}: ${d.stops.length}`);
  assert.deepEqual(three.days.map((d) => d.stops[0].id).sort(), tue.slice().sort());
  // #14 opens at 3 pm (not on Thursday's window): it gets Tuesday or Wednesday, the others go round it
  const r1 = [10, 7, 14].map(idOf);
  const hard = planDays(base({ windows: capped(1), pinned: r1.map((id) => ({ id, kind: "contact" })) }));
  assert.deepEqual(hard.days.map((d) => d.stops.length), [1, 1, 1]);
  assert.deepEqual(hard.days.map((d) => d.stops[0].id).sort(), r1.slice().sort());
  // four contacts, three days of 1: all four placed, one day over
  const four = [...tue, dayOf(free, WED.date).stops[0].id];
  const p = planDays(base({ windows: capped(1), pinned: four.map((id) => ({ id, kind: "contact" })) }));
  assert.deepEqual(p.days.flatMap((d) => d.stops.map((s) => s.id)).sort(), four.slice().sort());
  assert.deepEqual(p.days.map((d) => d.stops.length).sort(), [1, 1, 2]);
});

test("a cap no day reaches changes nothing: Up to 20, or each day's own count, plans exactly as no cap", () => {
  const free = planDays(base());
  assert.deepEqual(planDays(base({ windows: capped(20) })), free);
  assert.deepEqual(planDays(base({ windows: WEEK.map((w) => ({ ...w, max: dayOf(free, w.date).stops.length })) })), free);
  // a cap that binds on one day only: that day holds it, and no other day passes its own cap
  const tueN = dayOf(free, TUE.date).stops.length;
  const p = planDays(base({ windows: WEEK.map((w) => ({ ...w, max: w === TUE ? tueN - 1 : dayOf(free, w.date).stops.length })) }));
  for (const w of WEEK) assert.ok(dayOf(p, w.date).stops.length <= (w === TUE ? tueN - 1 : dayOf(free, w.date).stops.length), w.date);
});
