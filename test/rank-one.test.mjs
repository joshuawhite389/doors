// Jard's web review 10-24: Classics Sports Bar was "#4" on Your list and "#5 on Qloo's list" in Doors Deep Dive. One
// rank everywhere: a door's place on Your list (plan.pool.ids, after the door-type filter), said "#4 of 202 on Your list"
// (GLOSSARY #15); a door that isn't on Your list shows no number.
import { test } from "node:test";
import assert from "node:assert/strict";
import { basis, whyHome, doorTrail } from "../public/lib/basis.js";
import { crowds, mergedRoute } from "../public/lib/crowds.js";
import { sieve } from "../public/lib/sieve.js";
import * as I from "../public/lib/insights.js";
import { buildPool, windowsFor } from "../public/lib/pool.js";
import { planDays } from "../public/lib/schedule.js";
import { rankLabel } from "../public/lib/planview.js";
import { routeStatus } from "../public/lib/roominsight.js";
import { route } from "./helpers.mjs";

const routes = [route("athletic-brewing-boise"), route("casamigos-boise")];
const profile = {
  drinks: [{ key: "athletic-brewing", name: "Athletic Brewing", ready: true }, { key: "casamigos", name: "Casamigos", ready: true }],
  rooms: ["bars"], // the restaurants Qloo ranks between the bars shift its raw order away from Your list's
  start: { label: "Downtown Boise", lat: 43.615, lon: -116.2023 },
  windows: [{ date: "2026-10-29", from: "13:00", to: "17:00" }, { date: "2026-10-30", from: "13:00", to: "17:00" }],
  visitMin: 25, maxPerDay: 6, known: [],
};
function model(famous = false) {
  const pool = buildPool({ routes, profile, cityName: "Boise", famous });
  const p = planDays({ pool: pool.rows, statuses: pool.statuses, windows: windowsFor(profile), visitMin: 25 });
  const plan = { ...p, venues: pool.venues, pool: { ids: pool.ids, N: pool.N }, statuses: pool.statuses, city: { key: "boise", name: "Boise" }, profile };
  const r1 = mergedRoute(routes, { famous });
  const cv = I.curve(r1, pool.ids, { famous });
  const sv = sieve({ route: r1, plan, profile, famous });
  const ctx = { sv, cv, venues: { ...r1.venues, ...plan.venues }, plan, profile, famous, cityName: "Boise", hasFamous: !!r1.lists.famous.length, pop: I.popularity(r1, cv.rows, r1.venues), funnel: I.funnel(r1, { pool: pool.ids, plan: I.planIds(plan) }) };
  const b = basis(ctx);
  return { ctx, b, h: whyHome(ctx, b, crowds({ routes, pool }), null), plan, sv, pool };
}
const yourRank = (plan, id) => plan.pool.ids.indexOf(id) + 1;

for (const famous of [false, true]) test(`one rank: Deep Dive, Why, map popup and door pages agree with Your list${famous ? " (famous doors in)" : ""}`, () => {
  const { ctx, b, h, plan, sv } = model(famous);
  // the bug's precondition: Qloo's raw order and Your list disagree for some door on the plan
  const onPlan = h.days.flatMap((d) => d.doors);
  assert.ok(onPlan.some((d) => sv.dots.find((x) => x.id === d.id && x.x + 1 !== yourRank(plan, d.id))), "fixture no longer shifts ranks");
  for (const d of onPlan) {
    const k = yourRank(plan, d.id);
    if (k > 0) assert.equal(d.line, `#${k} on Your list`, d.name);
    assert.ok(!/Qloo's list/.test(d.line), d.line);
    assert.equal(rankLabel(plan, d.id), k > 0 ? `#${k} of ${plan.pool.N} on Your list` : "");
    const t = doorTrail(sv.dots.find((x) => x.id === d.id) ?? sv.extras.find((x) => x.id === d.id), ctx);
    if (k > 0) assert.equal(t.head.replace(/ for .*$/, ""), `#${k} of ${plan.pool.N} on Your list`);
  }
  // every "#N" the Why screen prints is the door's place on Your list
  for (const f of b.groups.flatMap((g) => g.facts)) {
    for (const m of f.text.matchAll(/#(\d+)/g)) assert.equal(+m[1], yourRank(plan, f.door), f.text);
    assert.ok(!/number \d+ on Qloo's list/.test(f.text), f.text);
  }
  // a door Qloo ranks that isn't on Your list (a restaurant here) gets no number anywhere
  const off = sv.dots.find((d) => d.fate === "room" && !d.famous);
  assert.ok(off);
  assert.ok(!/#\d|number \d/.test(doorTrail(off, ctx).head), doorTrail(off, ctx).head);
  assert.ok(!/#\d/.test(routeStatus(plan, off.id, routes).text), routeStatus(plan, off.id, routes).text);
});
