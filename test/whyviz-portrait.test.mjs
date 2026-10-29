// WHY-VIZ-SPEC §4.7 The door portrait (lib/whyviz/portrait.js) on the demo bake: every value traces to the door's record
// (hours, tags, crowd text, Qloo's sister list, the age pages) or a Doors count (Your list rank, best-known rank, the
// city's share of each crowd group).
import { test } from "node:test";
import assert from "node:assert/strict";
import { route, readJson, city } from "./helpers.mjs";
import { sieve } from "../public/lib/sieve.js";
import { demoProfile } from "../public/lib/demo-profile.js";
import { demoStates, bakedMatrix } from "../public/lib/demo-plan.js";
import { cityRooms, CROWD_TERMS } from "../public/lib/insights.js";
import { listRank } from "../public/lib/roominsight.js";
import { portraitModel, cityShares, hoursOn, RARE_MAX } from "../public/lib/whyviz/portrait.js";

const austin = route("athletic-brewing-austin");
const demo = readJson("public/data/demo/demo.json");
const austinCity = city("austin");
const NOMADIC = "00000000-0000-4000-8000-271655E6AA28";
async function setup() {
  const profile = demoProfile();
  const { states } = await demoStates({ routes: [austin], profile, contact: demo.contact, fetchMatrix: bakedMatrix(demo.matrix) });
  const { plan: p, pool } = states[0];
  const plan = { ...p, venues: pool.venues, statuses: pool.statuses, pool: { ids: pool.ids }, city: { key: "austin", name: "Austin" } };
  return { plan, sv: sieve({ route: austin, plan, profile, city: austinCity }), profile, base: cityRooms([austin]) };
}

test("portrait: Nomadic Beerworks, every value from its record or a Doors count", async () => {
  const { plan, sv, profile, base } = await setup();
  const v = { ...austin.venues[NOMADIC], id: NOMADIC };
  const m = portraitModel({ id: NOMADIC, venue: v, plan, sv, routes: [austin], profile, base, city: austinCity, cityName: "Austin" });
  assert.equal(m.head.name, "Nomadic Beerworks");
  assert.equal(m.head.kind, "Brewery");
  assert.match(m.head.status, /^On your plan: \w+, stop \d+ · #1 of 55 on Your list$/);
  assert.equal(m.match.line, "#1 of 55 for your drinker, 17th most popular on the list.");
  // the day it is on, its hours that day from v.hours, the time-of-day tags verbatim (lower-cased)
  const di = plan.days.findIndex((d) => d.stops.some((s) => s.id === NOMADIC));
  const dayName = plan.days[di].day;
  assert.equal(m.when.dayName, dayName);
  assert.equal(m.when.hours, hoursOn(v, dayName).text);
  assert.match(m.when.hours, /^\d+ (am|pm)–\d+ (am|pm)$/);
  assert.deepEqual(m.when.tod, v.tags.tod);
  assert.equal(m.when.line, `Open ${m.when.hours} ${dayName[0].toUpperCase()}${dayName.slice(1)}. Qloo tags it afternoon, midday, morning, late night and evening.`);
  // crowd chips: exactly the groups the crowd text names, rarest first, the city share from the base, rare ≤ RARE_MAX
  const sh = cityShares(base);
  const named = CROWD_TERMS.filter((t) => t.re.test(v.crowd.toLowerCase())).map((t) => t.key);
  assert.deepEqual(m.who.chips.map((c) => c.key).sort(), named.sort());
  for (let i = 1; i < m.who.chips.length; i++) assert.ok(m.who.chips[i].share >= m.who.chips[i - 1].share);
  for (const c of m.who.chips) { assert.equal(c.share, sh.of[c.key]); assert.equal(c.rare, c.share <= RARE_MAX); if (c.rare) assert.equal(c.text, `${Math.max(1, Math.round(c.share * 100))}% of Austin`); }
  assert.ok(m.who.chips.find((c) => c.key === "dogs").rare && m.who.chips.find((c) => c.key === "beer").rare);
  assert.equal(m.who.quote, v.crowd);
  // ages: every band the data has, the rank from that band's page
  assert.deepEqual(m.ages.map((a) => a.key), ["under_25", "25_34", "35_44", "45_54", "55_plus"]);
  for (const a of m.ages) assert.deepEqual([a.rank, a.of], [listRank(austin, a.key, NOMADIC).rank, listRank(austin, a.key, NOMADIC).of]);
  // sisters: Qloo's list in its order, each with a status that agrees with the plan and the list
  const sis = austinCity.sisters[NOMADIC].map((r) => r[0]);
  assert.deepEqual(m.sisters.map((x) => x.id), sis.slice(0, 8));
  const onPlan = new Set(plan.days.flatMap((d) => d.stops.map((s) => s.id)));
  for (const x of m.sisters) {
    if (onPlan.has(x.id)) assert.equal(x.k, "plan"); else if (plan.pool.ids.includes(x.id)) assert.equal(x.k, "list"); else assert.ok(["big", "out", "none"].includes(x.k));
    if (x.k === "list") assert.equal(x.text, `#${plan.pool.ids.indexOf(x.id) + 1} on Your list`);
  }
  assert.ok(m.sisters.some((x) => x.name === "Growler Express" && x.k === "list" && x.rank === 3));
  assert.deepEqual(m.pours, v.tags.bev);
  assert.deepEqual(m.room, [...v.tags.ambience, ...v.tags.interests]);
  assert.equal(m.footer, `Every value above is a Qloo field on this place or a Doors count over the ${sh.n} Austin doors Doors holds.`);
});

test("portrait: a door off the plan says its gate; no hours on a day says so; hoursOn reads the record", async () => {
  const { plan, sv, profile, base } = await setup();
  const off = sv.dots.find((d) => d.fate === "famous");
  const v = { ...austin.venues[off.id], id: off.id };
  const m = portraitModel({ id: off.id, venue: v, plan, sv, routes: [austin], profile, base, city: austinCity, cityName: "Austin" });
  assert.equal(m.head.status, "One of the most popular doors, left for later");
  assert.equal(m.match.line, "Among the most popular doors in Austin, past Doors' line.");
  assert.ok(m.when.dayName, "the first day ahead with doors");
  assert.deepEqual(hoursOn({ hours: { monday: [{ opens: null, closed: true, closes: null }] } }, "monday"), { open: false, text: null });
  assert.deepEqual(hoursOn({ hours: { friday: [{ opens: "T11:00:00", closes: "T22:30:00", closed: false }] } }, "friday"), { open: true, text: "11 am–10:30 pm" });
  assert.deepEqual(hoursOn({}, "friday"), { open: null, text: null });
  const none = portraitModel({ id: "nope", venue: { name: "Nowhere", crowd: "" }, plan, sv, routes: [austin], profile, base, city: austinCity, cityName: "Austin" });
  assert.equal(none.match.line, "Not on your drinker's list.");
  assert.equal(none.who.line, "Qloo has no crowd description for it.");
  assert.deepEqual(none.sisters, []);
});
