// The city field's list (owner review 7, M2): US cities from the Census, matched by prefix as the rep types, with no
// Qloo call and no network. Needs no Qloo data: the four ready cities are written out here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { matchCities, listedCity, cityPick, fold } from "../public/lib/citylist.js";
import { US_CITIES } from "../public/lib/us-cities.js";
import { validateProfile, emptyProfile, citySlug } from "../public/lib/profile.js";
import { cityOf, runLive } from "../public/lib/live.js";

const READY = [
  { key: "austin", name: "Austin", query: "Austin", center: [30.2672, -97.7431] },
  { key: "chicago", name: "Chicago", query: "Chicago", center: [41.8781, -87.6298] },
  { key: "boise", name: "Boise", query: "Boise", center: [43.615, -116.2023] },
  { key: "omaha", name: "Omaha", query: "Omaha", center: [41.2565, -95.9345] },
];
const labels = (q, n) => matchCities(q, READY, n).map((r) => r.label);

test("the list: ~1,900 Census places of 20,000+, each [name, ST, lat, lon, pop], biggest first, plain names", () => {
  assert.ok(US_CITIES.length > 1500 && US_CITIES.length < 2500, String(US_CITIES.length));
  for (const [name, st, lat, lon, pop] of US_CITIES) {
    assert.ok(/^[A-Z]{2}$/.test(st) && Number.isFinite(lat) && Number.isFinite(lon) && pop >= 20000, name);
    assert.ok(!/ (city|town|village|CDP|\(balance\))$|government|County$|\(/.test(name), `legal suffix left in "${name}"`);
  }
  assert.ok(US_CITIES.every((r, i) => !i || US_CITIES[i - 1][4] >= r[4]));
  for (const c of ["Nashville, TN", "Louisville, KY", "Indianapolis, IN", "Honolulu, HI", "Boise, ID", "Lexington, KY", "Ventura, CA"]) assert.ok(US_CITIES.some(([n, s]) => `${n}, ${s}` === c), c);
});

test("typing narrows by prefix, biggest first: 'c' → C cities by population, 'cin' → Cincinnati", () => {
  const c = matchCities("c", READY);
  assert.equal(c.length, 8);
  assert.ok(c.every((r) => r.name.startsWith("C")));
  assert.deepEqual(c.slice(0, 4).map((r) => r.label), ["Chicago, IL", "Charlotte, NC", "Columbus, OH", "Colorado Springs, CO"]);
  assert.ok(c.slice(1).every((r, i) => c[i].pop >= r.pop), "by population");
  assert.equal(labels("cin")[0], "Cincinnati, OH");
  assert.equal(labels("CINCINNATI")[0], "Cincinnati, OH");
  assert.deepEqual(labels("zzzz"), []);
  assert.deepEqual(labels("   "), []);
});

test("'st lo', 'saint lo', 'St. Louis' all find St. Louis; 'fort w' and 'ft w' find Fort Worth", () => {
  for (const q of ["st lo", "saint lo", "St. Louis", "st. louis, mo", "Saint Louis MO"]) assert.equal(labels(q)[0], "St. Louis, MO", q);
  for (const q of ["fort wo", "ft wo", "Ft. Worth"]) assert.equal(labels(q)[0], "Fort Worth, TX", q);
});

test("accents and case fold: 'Sán Jöse' finds San Jose; fold() keeps the comma", () => {
  assert.equal(labels("Sán Jöse")[0], "San Jose, CA");
  assert.equal(fold("  Cañon  City, CO "), "canon city,co");
});

test("'City, ST' typed narrows to that state; a state by name works too; a word inside the name comes after prefixes", () => {
  assert.deepEqual(labels("springfield, mo"), ["Springfield, MO"]);
  assert.deepEqual(labels("springfield il"), ["Springfield, IL"]);
  assert.deepEqual(labels("portland, maine"), ["Portland, Maine", "South Portland, Maine"], "fix14: a state typed in full stays in full");
  assert.ok(labels("springfield").length >= 4);
  const york = labels("york");
  assert.ok(york.indexOf("York, PA") < york.indexOf("New York City"), york.join(" | "));
});

test("the 4 ready cities resolve to their keys when picked, ranked like any city; their namesakes elsewhere are live cities", () => {
  for (const [q, key] of [["austin", "austin"], ["Chicago, IL", "chicago"], ["boi", "boise"], ["omaha ne", "omaha"]]) {
    const r = matchCities(q, READY)[0];
    assert.equal(r.ready, key, q);
    assert.deepEqual(cityPick(r), { city: key });
  }
  const b = labels("b", 20);
  assert.equal(b[0], "Boston, MA", "by population only: no boost for a ready city");
  assert.ok(b.indexOf("Boston, MA") < b.indexOf("Boise, ID"), b.join(" | "));
  assert.equal(matchCities("b", READY, 20).find((r) => r.label === "Boise, ID").ready, "boise");
  const mn = matchCities("austin, mn", READY)[0];
  assert.equal(mn.ready, undefined);
  assert.equal(cityPick(mn).city, "austin-mn");
  assert.equal(matchCities("Chicago Heights", READY)[0].ready, undefined);
});

test("listedCity: what a rep typed and left names one listed city (the biggest of a bare name), else null", () => {
  assert.equal(listedCity("cincinnati", READY).label, "Cincinnati, OH");
  assert.equal(listedCity("Cincinnati, OH", READY).label, "Cincinnati, OH");
  assert.equal(listedCity("springfield", READY).label, "Springfield, MO");
  assert.equal(listedCity("Austin, MN", READY).label, "Austin, MN");
  assert.equal(listedCity("austin", READY).ready, "austin");
  assert.equal(listedCity("cin", READY), null, "a prefix is not a city");
  assert.equal(listedCity("Smallville, KS", READY), null);
});

test("a picked live city carries its centre and 'Cincinnati, OH': validateProfile takes it, and the live run asks for that name", async () => {
  const pick = cityPick(listedCity("cincinnati", READY));
  assert.deepEqual(pick, { city: "cincinnati-oh", cityName: "Cincinnati, OH", cityLive: true, cityCenter: [39.1402, -84.5058] });
  assert.equal(pick.city, citySlug(pick.cityName));
  const p = { ...emptyProfile(), what: "beer", drinks: [{ id: "11111111-2222-3333-4444-555555555555", name: "Rhinegeist", ready: false }], ...pick,
    start: { label: "Fountain Square", lat: 39.1015, lon: -84.5125, source: "geocode" }, windows: [{ date: "2026-11-02", from: "14:00", to: "18:00" }] };
  const v = validateProfile(p, { cities: READY });
  assert.equal(v.errors.city, undefined);
  assert.equal(v.errors.start, undefined);
  assert.match(validateProfile({ ...p, start: { label: "Columbus", lat: 39.96, lon: -83.0, source: "pin" } }, { cities: READY }).errors.start ?? "", /far from Cincinnati, OH/);
  const index = { cities: READY, brands: [], rooms: [], files: [] };
  assert.deepEqual(cityOf(p, index), { key: "cincinnati-oh", name: "Cincinnati, OH", query: "Cincinnati, OH", center: [39.1402, -84.5058], live: true });
  let sent = null;
  const fetchImpl = async (_u, init) => ((sent = JSON.parse(init.body)), Response.json({ error: "stub" }, { status: 500 }));
  await assert.rejects(runLive({ profile: p, index, fetchImpl }));
  assert.equal(sent.city, "Cincinnati, OH");
});

// fix14 (Jard's iPhone, 2026-10-23): "Dayton, Ohio" snapped back to "Dayton, OH", and "Dayton Ohio" found nothing. A
// state typed in full is kept as typed; a typed city is never swapped for another one.
test("fix14: a state in full or by its code, with or without a comma; the full name is kept as typed", () => {
  for (const q of ["Dayton, Ohio", "dayton ohio", "Dayton Ohio", "DAYTON,OHIO"]) {
    assert.equal(labels(q)[0], "Dayton, Ohio", q);
    assert.equal(listedCity(q, READY)?.label, "Dayton, Ohio", q);
  }
  for (const q of ["Dayton, OH", "dayton oh", "Dayton"]) assert.equal(listedCity(q, READY)?.label, "Dayton, OH", q);
  assert.equal(labels("Dayton, Ohi")[0], "Dayton, OH", "a state half typed: the list's own form");
  assert.deepEqual(cityPick(listedCity("Dayton Ohio", READY)), { city: "dayton-ohio", cityName: "Dayton, Ohio", cityLive: true, cityCenter: [39.7847, -84.1996] });
  assert.equal(labels("Kansas City Missouri")[0], "Kansas City, Missouri");
  assert.equal(labels("St. Louis, Missouri")[0], "St. Louis, Missouri");
  assert.equal(labels("Washington, District of Columbia")[0], "Washington, District of Columbia");
  assert.equal(labels("new york new york")[0], "New York City", "Qloo's reading wins (live check F)");
  assert.equal(listedCity("Boise, Idaho", READY).ready, "boise", "a ready city keeps its key");
  assert.equal(labels("Kansas City")[0], "Kansas City, MO", "a city named like a state still matches itself");
  assert.deepEqual(labels("Dayton, Idaho"), [], "never another state's Dayton");
  for (const q of ["Dayton", "Dayton, OH", "Dayton, Ohio", "Dayton Ohio"]) assert.ok(!labels(q).some((l) => /Boise/.test(l)), q);
});
