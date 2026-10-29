// The planner sweep (R1 Diolosa §2, F1): 8 brands × 4 cities × 3 window shapes + a carry-over re-plan, from the
// shipped files, on the estimate. Plus the two Austin profiles a judge sees first (R1 Calacanis 1).
// H1 (owner, routing overhaul, docs/ROUTING-V3.md): shape is no longer a rule. The leg-cap bar becomes a sanity bar (≤ 2%
// of stops after a leg over LONG_LEG_MI), the overlap bar moves from 10% to 20% (the area pull is soft now: a hard
// wall cost doors), and the Austin profiles are judged on doors and open-on-arrival, not crossings.
import test from "node:test";
import assert from "node:assert/strict";
import { sweepPlanner, LONG_LEG_MI } from "../scripts/sweep-planner.mjs";
import { DOOR_MIN } from "../public/lib/schedule.js";
import { demoPlan, dayShape } from "../scripts/plan-demo.mjs";

const s = sweepPlanner();

test(`sweep: ${s.plans} plans, ${s.days} days, ${s.stops} stops, every §6 rule holds (open on arrival, no duplicates, windows, exclusions, timings, determinism)`, () => {
  assert.ok(s.plans >= 128 && s.stops > 2500);
  assert.deepEqual(s.problems, []);
});
// Fill by rank, then route (owner, 2026-10-23): each week takes its best-ranked doors first, so more legs run across
// town. Measured on this sweep: fill "area" 1.0% (35 of 3385), fill "week" 2.8% (90 of 3253); the bar moves to 3%.
test(`sweep: ≤ 3% of stops come after a leg over ${LONG_LEG_MI} mi (${s.longLegs.length} between doors, ${s.firstLegsOver.length} from the start, of ${s.stops})`, () => {
  assert.ok(s.longLegs.length + s.firstLegsOver.length <= 0.03 * s.stops);
});
test(`sweep: the last day's miles per door ≤ 1.3 × the first day's (Mon ${s.miPerDoor.monday} · Fri ${s.miPerDoor.friday} = ${s.lastVsFirst}×)`, () => {
  assert.ok(s.lastVsFirst <= 1.3, JSON.stringify(s.miPerDoor));
});
test(`sweep: ≤ 20% of stops nearer another day's centre than their own (${s.intrusion} / ${s.multiStops} = ${(s.intrusionShare * 100).toFixed(1)}%)`, () => {
  assert.ok(s.intrusionShare <= 0.2);
});
test("sweep: a carried door is scheduled again or named in a note, never dropped silently", () => {
  assert.deepEqual(s.carriedLost, []);
});

test(`sweep: marking a door "not a fit" leaves other days alone: ${s.otherDaysChanged} of ${s.otherDays} changed (${(s.reshuffleShare * 100).toFixed(1)}%; 24.3% before F1, 15.7% before F1b)`, () => {
  assert.ok(s.reshuffleShare <= 0.2);
});
test(`sweep (F1b): doors dropped from untouched days per status change ≤ 1 on average (${s.droppedOther} over ${s.marks} marks = ${s.droppedPerMark}; 1.51 before F1b)`, () => {
  assert.ok(s.droppedPerMark <= 1);
});

// K1 (owner review 5, driving first) supersedes main's R1 rank bar (≥ 65% of each plan's top-10 open doors kept): rank
// only breaks ties now. The share is reported; the bar is that every top-10 door off the plan is off for a stated
// reason, and one off for its driving would add more than DOOR_MIN to its cheapest day.
const off = s.top10Off.reduce((m, x) => ((m[x.code] = (m[x.code] ?? 0) + 1), m), {});
test(`sweep (K1): top-10 doors kept ${(s.top10ReachShare * 100).toFixed(1)}% (${s.top10Reach} of ${s.top10ReachOf}) · mean scheduled rank ${s.meanRank}; the rest off for a reason (${Object.entries(off).map(([k, n]) => `${k} ${n}`).join(", ")})`, () => {
  assert.deepEqual(s.top10Off.filter((x) => x.code === "none" || (x.code === "detour" && !(x.min > DOOR_MIN))), []);
});

for (const name of ["default", "demo"]) {
  test(`${name} Austin profile: ≥ 5 doors a day, every stop open on arrival, no leg over 7 mi`, () => {
    const { plan, pool } = demoPlan(name);
    assert.equal(plan.days.length, name === "demo" ? 3 : 2);
    for (const d of plan.days) {
      assert.ok(d.stops.length >= 5, `${d.day}: ${d.stops.length} doors`);
      assert.ok(d.stops.every((x) => x.openAtArrival !== false));
      const sh = dayShape(d, pool.venues);
      assert.ok(Math.max(sh.longestInner, sh.first) <= 7, `${d.day}: a ${Math.max(sh.longestInner, sh.first)} mi leg`);
    }
  });
}

test("demo profile: Central District Brewing (already talked to) is not scheduled and says why; Nomadic Beerworks #1 is on Tuesday", () => {
  const { plan, pool } = demoPlan("demo");
  const known = Object.keys(pool.venues).find((id) => pool.venues[id].name === "Central District Brewing");
  assert.ok(!plan.days.some((d) => d.stops.some((x) => x.id === known)));
  assert.equal(plan.reasons[known].text, "status: already known");
  assert.ok(plan.days[0].stops.some((s) => pool.venues[s.id].name === "Nomadic Beerworks"));
});
