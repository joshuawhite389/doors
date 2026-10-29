// why2 concept A (Jard's pick 10-24): the "What do you want to do?" model (lib/basis.js whyHome) over one merged
// drinker (lib/crowds.js mergedRoute): the four tiles, the plan's doors by day, the doors left out by reason with their
// fixes, the two crowds with "Start with …".
import { test } from "node:test";
import assert from "node:assert/strict";
import { basis, whyHome, VIEWS } from "../public/lib/basis.js";
import { crowds, mergedRoute, crowdKey } from "../public/lib/crowds.js";
import { sieve } from "../public/lib/sieve.js";
import * as I from "../public/lib/insights.js";
import { buildPool, windowsFor } from "../public/lib/pool.js";
import { planDays } from "../public/lib/schedule.js";
import { route } from "./helpers.mjs";

const ab = route("athletic-brewing-boise");
const cm = route("casamigos-boise");
const profile = {
  drinks: [{ key: "athletic-brewing", name: "Athletic Brewing", ready: true }, { key: "casamigos", name: "Casamigos", ready: true }],
  rooms: ["bars", "breweries", "restaurants"],
  start: { label: "Downtown Boise", lat: 43.615, lon: -116.2023 },
  windows: [{ date: "2026-10-29", from: "13:00", to: "17:00" }, { date: "2026-10-30", from: "13:00", to: "17:00" }],
  visitMin: 25,
  maxPerDay: 6,
  known: [],
};
export function model(routes = [ab, cm], startWith = null) {
  const pool = buildPool({ routes, profile, cityName: "Boise" });
  const windows = windowsFor(profile);
  const p = planDays({ pool: pool.rows, statuses: pool.statuses, windows, visitMin: 25 });
  const plan = { ...p, venues: pool.venues, pool: { ids: pool.ids, N: pool.N }, statuses: pool.statuses, city: { key: "boise", name: "Boise" } };
  const route1 = mergedRoute(routes);
  const cv = I.curve(route1, pool.ids);
  const sv = sieve({ route: route1, plan, profile });
  const ctx = { sv, cv, venues: { ...route1.venues, ...plan.venues }, plan, profile, cityName: "Boise", hasFamous: !!route1.lists.famous.length, pop: I.popularity(route1, cv.rows, route1.venues), funnel: I.funnel(route1, { pool: pool.ids, plan: I.planIds(plan) }) };
  const b = basis(ctx);
  return { h: whyHome(ctx, b, crowds({ routes, pool }), startWith), sv, plan, pool };
}

test("whyHome: one drinker, four tiles, every number counted from the plan", () => {
  const { h, sv, plan } = model();
  assert.equal(h.who.title, "Athletic Brewing + Casamigos drinkers");
  assert.match(h.who.sub, /^Boise · \d+ doors · Thu, Fri$/);
  assert.match(sv.who, /Athletic Brewing and Casamigos drinkers/); // the merged drinker, not one drink of two
  assert.deepEqual(h.tiles.map((t) => t.title), ["Doors Deep Dive", "What doors were left off and why", "Who likes your drink?", "See it on the map"]);
  assert.equal(h.tiles[2].line, "People who also drink Athletic Brewing and Casamigos.");
  assert.ok(h.tiles.every((t) => t.go)); // every tile: icon, title, subtitle, button (Jard 10-24)
  const n = plan.days.reduce((t, d) => t + d.stops.length, 0);
  assert.equal(h.onPlan, n);
  assert.equal(h.days.flatMap((d) => d.doors).length, n);
  assert.match(h.tiles[0].line, new RegExp(`^${n} doors\\.`));
  assert.ok(h.nOut > 0 && h.tiles[1].line === `${h.nOut} doors. Add new doors, refine how Doors chooses what's right for your brand.`);
  // missing = ranked above the plan's lowest-ranked door, not the list's tail
  const worst = Math.max(...sv.dots.filter((d) => d.fate === "plan" && !d.famous).map((d) => d.x));
  for (const g of h.missing) for (const d of g.doors) assert.ok(sv.dots.find((x) => x.id === d.id).x < worst);
});

test("whyHome: doors left out, grouped by reason, each door addable, each reason with its own fix", () => {
  const { h, plan } = model();
  const on = new Set(plan.days.flatMap((d) => d.stops.map((s) => s.id)));
  for (const g of h.missing) {
    assert.equal(g.doors.length, g.n);
    for (const d of g.doors) (assert.ok(!on.has(d.id)), assert.equal(d.fix.kind, "add"));
  }
  const open = h.missing.find((g) => g.key === "open");
  if (open) assert.equal(open.fix.kind, "profile");
  assert.equal(new Set(h.missing.flatMap((g) => g.doors.map((d) => d.id))).size, h.nOut);
});

test("whyHome: two crowds told apart, each with Start with …; the picked one offers to mix them again", () => {
  const { h } = model();
  assert.ok(h.crowds && h.crowds.groups.length === 2);
  assert.match(h.shareLine, /^Two crowds: Athletic Brewing and Casamigos drinkers go to mostly different doors \(\d+ of their top 50 shared\)\.$/);
  assert.deepEqual(h.crowds.groups.map((g) => g.fix.label), ["Start with Athletic Brewing's doors", "Start with Casamigos's doors"]);
  const picked = model(undefined, crowdKey(cm)).h;
  assert.deepEqual(picked.crowds.groups.map((g) => g.fix.label), ["Start with Athletic Brewing's doors", "Mix the crowds again"]);
  // one drink: no crowds, the Who tile says what's there
  const one = model([ab]).h;
  assert.equal(one.crowds, null);
});

test("whoTitle: 'Who likes <brand>?' from the profile's brand, else 'Who likes your drink?' (Jard 10-24)", async () => {
  const { whoTitle } = await import("../public/lib/basis.js");
  assert.equal(whoTitle({ brand: "Tidewell" }), "Who likes Tidewell?");
  assert.equal(whoTitle({ brand: "  " }), "Who likes your drink?");
  assert.equal(whoTitle(null), "Who likes your drink?");
});
