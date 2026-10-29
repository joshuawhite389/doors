// The sieve (owner review 3): every place Qloo scored lands at exactly one gate, the plan's rooms at the bottom, and
// each stopped room says why in the planner's own words.
import { test } from "node:test";
import assert from "node:assert/strict";
import { route, readJson } from "./helpers.mjs";
import { sieve, verdict, GATES, FATES, ROWS, rowIndex, rowPlaces, mapPlaces, breakdown, codeLabel } from "../public/lib/sieve.js";
import { demoProfile } from "../public/lib/demo-profile.js";
import { demoStates, bakedMatrix } from "../public/lib/demo-plan.js";

const austin = route("athletic-brewing-austin");
const demo = readJson("public/data/demo/demo.json");
const city = readJson("public/data/cities/austin.json");

async function demoPlan() {
  const { states } = await demoStates({ routes: [austin], profile: demoProfile(), contact: demo.contact, fetchMatrix: bakedMatrix(demo.matrix) });
  const { plan, pool } = states[0];
  return { ...plan, venues: pool.venues, statuses: pool.statuses };
}

test("sieve: every scored place has one fate; the plan row holds exactly the plan", async () => {
  const plan = await demoPlan();
  const s = sieve({ route: austin, plan, profile: demoProfile(), city });
  assert.equal(new Set(s.dots.map((d) => d.id)).size, s.dots.length, "no place twice");
  for (const d of s.dots) assert.ok(FATES.includes(d.fate), `${d.name}: ${d.fate}`);
  const onPlan = new Set(plan.days.flatMap((d) => d.stops.map((x) => x.id)));
  const shown = new Set([...s.dots.filter((d) => d.fate === "plan"), ...s.extras].map((d) => d.id));
  assert.deepEqual([...shown].sort(), [...onPlan].sort());
  assert.equal(s.counts.kind, austin.dropped.all.n);
  assert.equal(s.scored, austin.lists.all.length + s.dots.filter((d) => d.famous).length + austin.dropped.all.n);
  // the demo: Central District Brewing is known; the contact is an extra; restaurants stop at "room"
  assert.equal(s.dots.find((d) => d.id === "00000000-0000-4000-8000-D88E4224A5AD").fate, "known");
  assert.ok(s.extras.some((e) => e.id === "00000000-0000-4000-8000-2780BAA954E5"));
  assert.ok(s.counts.room > 0 && s.counts.famous > 0 && s.counts.open + s.counts.route > 0);
  // ranked rooms keep Qloo's order on x; a famous room sits where its affinity would rank
  const ranked = s.dots.filter((d) => !d.famous);
  assert.ok(ranked.every((d, i) => d.x === i));
  for (const f of s.dots.filter((d) => d.famous)) assert.ok(f.x >= 0 && f.x <= s.N);
});

test("sieve: stopped rooms say why in the planner's words; look-alikes are not on the drinker's list", async () => {
  const plan = await demoPlan();
  const s = sieve({ route: austin, plan, profile: demoProfile(), city });
  for (const d of s.dots.filter((x) => x.fate === "open" || x.fate === "route")) {
    const r = plan.reasons[d.id];
    if (r) assert.equal(d.reason.toLowerCase(), r.text.toLowerCase());
  }
  const listed = new Set(s.dots.map((d) => d.id));
  assert.ok(s.lookalikes.length > 0);
  for (const l of s.lookalikes) assert.ok(!listed.has(l.id) && l.like && Number.isFinite(l.lat));
  const top = s.dots.find((d) => d.rank === 1);
  assert.match(verdict(top, s), /^#1 of \d+ for Athletic Brewing drinkers/);
  assert.match(verdict(s.lookalikes[0], s), /doesn't rank it for Athletic Brewing drinkers/);
  const stopped = s.dots.find((d) => d.fate === "open");
  if (stopped) assert.match(verdict(stopped, s), /Stopped at “Open while you're out\?”: /);
  assert.equal(GATES.length, 6);
});

test("sieve: with the famous rooms in, nothing stops at the popularity cap", async () => {
  const plan = await demoPlan();
  const s = sieve({ route: austin, plan, profile: demoProfile(), city, famous: true });
  assert.equal(s.counts.famous, 0);
});

test("explorer: every row's places add up to its count, in Qloo's order; every place on the map once", async () => {
  const plan = await demoPlan();
  const s = sieve({ route: austin, plan, profile: demoProfile(), city });
  assert.equal(ROWS.length, 8);
  for (let k = 1; k < 7; k++) {
    const ps = rowPlaces(s, k);
    assert.equal(ps.length, s.counts[ROWS[k].key], ROWS[k].ask);
    assert.ok(ps.every((d) => rowIndex(d) === k));
    const xs = ps.filter((d) => !d.extra && Number.isFinite(d.x)).map((d) => d.x);
    assert.deepEqual(xs, [...xs].sort((a, b) => a - b), `${ROWS[k].ask} in Qloo's order`);
  }
  assert.equal(rowPlaces(s, 0).length, austin.dropped.all.names.length); // names only
  assert.ok(rowPlaces(s, 0).every((d) => d.unscored && !d.id));
  assert.deepEqual(rowPlaces(s, 7), s.lookalikes);
  assert.ok(rowPlaces(s, 7).every((d) => rowIndex(d) === 7));
  assert.deepEqual(rowPlaces(s, 9), []);
  const mp = mapPlaces(s);
  assert.equal(new Set(mp.map((d) => d.id)).size, mp.length);
  assert.ok(mp.every((d) => Number.isFinite(d.lat) && Number.isFinite(d.lon)));
  assert.ok(mp.some((d) => d.famous) && mp.some((d) => d.like) && mp.some((d) => d.fate === "plan"));
});

test("explorer: a row's breakdown splits it by the planner's reason codes and sums to the row", async () => {
  const plan = await demoPlan();
  const s = sieve({ route: austin, plan, profile: demoProfile(), city });
  const days = plan.days.map((d) => d.day[0].toUpperCase() + d.day.slice(1));
  for (let k = 0; k < 8; k++) {
    const b = breakdown(s, k, { days, rooms: demoProfile().rooms });
    assert.equal(b.reduce((a, g) => a + g.n, 0), rowPlaces(s, k).length, ROWS[k].ask);
    for (const g of b) assert.ok(g.label && !/undefined|null/.test(g.label), g.label);
    if (ROWS[k].key !== "plan") for (let i = 1; i < b.length; i++) assert.ok(b[i].n <= b[i - 1].n);
  }
  // the open gate: every group is one of the planner's hours codes, and its places carry that code
  const open = breakdown(s, 5);
  for (const g of open) for (const id of g.ids) assert.equal(s.dots.find((d) => d.id === id).code, g.code);
  // the plan: one group per day with doors, in day order, labelled by the day
  const pb = breakdown(s, 6, { days });
  assert.deepEqual(pb.map((g) => g.label), days.filter((_, i) => plan.days[i].stops.length));
  // look-alikes: grouped by the plan room they resemble
  assert.ok(breakdown(s, 7).every((g) => g.label.startsWith("Like ")));
  assert.equal(codeLabel("closed"), "Closed on the days you're out");
  assert.match(codeLabel("cafes", { rooms: ["bars"] }), /^Coffee & cafés: not a door you pitch \(bars\)$/);
  assert.equal(codeLabel("day1", { days: ["Tuesday", "Wednesday"] }), "Wednesday");
});

// judge pass 2/3 (24): the chart's counts subtract: the capped list less every gate but the famous one (a second pull,
// counted apart) is the plan's rooms from the list; the plan row adds the contact on top
test("sieve: the funnel adds up from the ranked list to the plan, the famous rooms apart", async () => {
  const plan = await demoPlan();
  const s = sieve({ route: austin, plan, profile: demoProfile(), city });
  const c = s.counts;
  const start = s.scored - c.famous;
  assert.equal(start, austin.lists.all.length + austin.dropped.all.n);
  assert.equal(start - c.kind - c.room - c.known - c.open - c.route, c.plan - s.extras.length);
  assert.ok(s.extras.length > 0, "the demo's contact is an extra");
});
