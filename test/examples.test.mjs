// The form's Examples row (owner review 6): one made-up rep per fetched drinker (and one for the bar's regulars),
// each in a city we hold; every one validates and builds a plan. And the city field's text → profile city.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EXAMPLES, examples, exampleOf, fictionLine, cityFromText, cityText } from "../public/lib/examples.js";
import { validateProfile, roomChoices } from "../public/lib/profile.js";
import { demoProfile } from "../public/lib/demo-profile.js";
import { buildPool, windowsFor } from "../public/lib/pool.js";
import { planDays } from "../public/lib/schedule.js";
import { liveDrinkers } from "../public/lib/live.js";
import { readJson, route } from "./helpers.mjs";

const index = readJson("public/data/index.json");
const ctx = { cities: index.cities };
const TODAY = new Date(2026, 9, 21); // a Wednesday

test("one example per fetched drinker brand plus the bar's regulars; Maya is the demo's profile; cities spread", () => {
  const xs = examples(TODAY);
  const drinkers = xs.flatMap((x) => x.profile.drinks.map((d) => d.key));
  for (const b of index.brands) assert.ok(drinkers.includes(b.key), `an example drinks like ${b.name}`);
  assert.ok(xs.some((x) => x.profile.pours?.length === 1 && x.profile.pours[0].name === "Parson's Chicken & Fish" && !x.profile.drinks.length), "one for rooms that pour you (Parson's)");
  assert.equal(xs.length, index.brands.length + 1);
  const maya = xs.find((x) => x.key === "maya");
  const { sample, ...mp } = maya.profile;
  const demo = demoProfile(TODAY);
  delete demo.week.ahead; // the form plans her usual week two weeks ahead; only the tour plans one
  assert.deepEqual(mp, demo);
  assert.equal(maya.label, "Maya Ortiz · Tidewell (non-alcoholic hazy IPA) · Austin");
  assert.equal(fictionLine(maya), "Tidewell and Maya are made up; every bar and restaurant is real.");
  const per = {};
  for (const x of xs) per[x.profile.city] = (per[x.profile.city] ?? 0) + 1;
  assert.deepEqual(Object.keys(per).sort(), index.cities.map((c) => c.key).sort(), "every fetched city has one");
  assert.ok(Math.max(...Object.values(per)) <= 3);
  assert.equal(new Set(xs.map((x) => x.label)).size, xs.length);
  for (const x of xs) {
    assert.match(x.label, /^[^·]+ · [^·]+ \([^)]+\) · (Austin|Boise|Chicago|Omaha)$/, x.label);
    assert.ok(!/ready|live|instant|Qloo call/i.test(x.label + fictionLine(x)));
  }
});

test("every example validates, offers its rooms, is dated after today, and builds a plan", () => {
  for (const x of examples(TODAY)) {
    const p = x.profile;
    assert.deepEqual(validateProfile(p, ctx), { ok: true, errors: {} }, x.key);
    const offered = roomChoices(p.what).map((r) => r.key);
    assert.ok(p.rooms.every((r) => offered.includes(r)), `${x.key}: rooms on offer`);
    assert.ok(p.windows.every((w) => w.date > "2026-10-21"), `${x.key}: future days`);
    assert.ok(p.pitch.price && p.pitch.ask && p.pitch.name && p.pitch.support.length, `${x.key}: a pitch`);
    const keys = liveDrinkers(p, index).map((d) => d.key); // N3: Parson's alone in a held city reads its fetched file
    assert.ok(liveDrinkers(p, index).every((d) => !d.live), `${x.key}: no live run`);
    const routes = keys.map((k) => route(`${k}-${p.city}`));
    const pool = buildPool({ routes, profile: p, cityName: index.cities.find((c) => c.key === p.city).name });
    assert.ok(pool.N >= 10, `${x.key}: ${pool.N} ranked rooms`);
    const plan = planDays({ pool: pool.rows, statuses: pool.statuses, windows: windowsFor(p), visitMin: p.visitMin, pinned: pool.pinned });
    const n = plan.days.reduce((a, d) => a + d.stops.length, 0);
    assert.ok(n >= 4, `${x.key}: ${n} doors`);
  }
});

test("exampleOf: the sample flag → its example (true = Maya, the demo's hand-off)", () => {
  assert.equal(exampleOf(true).key, "maya");
  assert.equal(exampleOf(EXAMPLES[1].key).key, EXAMPLES[1].key);
  assert.equal(exampleOf(undefined), null);
  assert.equal(exampleOf("nope"), null);
});

test("city text: a fetched city by name (any case, with a state), else a city as typed", () => {
  for (const t of ["Austin", "austin", " Austin, TX ", "AUSTIN TX"]) assert.deepEqual(cityFromText(t, index.cities), { city: "austin" }, t);
  assert.deepEqual(cityFromText("Denver, CO", index.cities), { city: "denver-co", cityName: "Denver, CO", cityLive: true });
  assert.deepEqual(cityFromText("  St. Paul ,  MN ", index.cities), { city: "st-paul-mn", cityName: "St. Paul, MN", cityLive: true });
  assert.deepEqual(cityFromText("Querétaro", index.cities), { city: "querétaro", cityName: "Querétaro", cityLive: true }); // review6: one Unicode-aware slug (lib/profile.js citySlug)
  assert.deepEqual(cityFromText("  ", index.cities), { city: "" });
  assert.equal(cityText({ city: "austin" }, index.cities), "Austin");
  assert.equal(cityText({ city: "denver-co", cityName: "Denver, CO", cityLive: true }, index.cities), "Denver, CO");
  assert.equal(cityText({ city: "" }, index.cities), "");
});
