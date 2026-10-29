// The brand profile: keyword → rooms map, room filter by genre, windows, validation (SPEC-V2 §3.2).
import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultRooms, roomChoices, roomOf, roomsPhrase, isNA, validateProfile, emptyProfile, nextWeekdays, nextDays, dayOf, toMinutes, clock12, poursOf, poursPhrase } from "../public/lib/profile.js";
import { readJson } from "./helpers.mjs";

const index = readJson("public/data/index.json");
const ctx = { cities: index.cities };

test("what you make → default rooms to pitch", () => {
  assert.deepEqual(defaultRooms("Non-alcoholic hazy IPA"), ["bars", "breweries", "restaurants"]);
  assert.deepEqual(defaultRooms("Craft lager"), ["bars", "breweries", "restaurants"]);
  assert.deepEqual(defaultRooms("Hard seltzer"), ["bars", "breweries", "restaurants"]);
  assert.deepEqual(defaultRooms("Blanco tequila"), ["bars", "restaurants"]);
  assert.deepEqual(defaultRooms("Canned RTD margarita"), ["bars", "restaurants"]);
  assert.deepEqual(defaultRooms("Natural wine in cans"), ["restaurants", "wine"]);
  assert.deepEqual(defaultRooms("Sparkling water"), ["bars", "restaurants", "cafes"]);
  assert.deepEqual(defaultRooms("Functional adaptogen soda"), ["bars", "restaurants", "cafes"]);
  assert.deepEqual(defaultRooms(""), ["bars", "restaurants"]);
  assert.deepEqual(defaultRooms(undefined), ["bars", "restaurants"]);
});

test("the café chip is offered only for NA products", () => {
  assert.ok(isNA("Non-alcoholic hazy IPA"));
  assert.ok(isNA("NA gin alternative"));
  assert.ok(isNA("zero-proof spritz"));
  assert.ok(!isNA("Blanco tequila"));
  assert.ok(!isNA("Banana stout")); // "na" inside a word is not NA
  assert.ok(roomChoices("Kombucha").some((r) => r.key === "cafes"));
  assert.ok(!roomChoices("Mezcal").some((r) => r.key === "cafes"));
});

test("roomOf files Qloo genres under the five chips", () => {
  const g = (s, name = "X") => roomOf({ name, genre: `urn:tag:genre:place:${s}` });
  assert.equal(g("bar"), "bars");
  assert.equal(g("cocktail_bar"), "bars");
  assert.equal(g("sports_bar"), "bars");
  assert.equal(g("irish_pub"), "bars");
  assert.equal(g("night_club"), "bars");
  assert.equal(g("brewery"), "breweries");
  assert.equal(g("brewpub"), "breweries");
  assert.equal(g("beer_hall"), "breweries");
  assert.equal(g("wine_bar"), "wine");
  assert.equal(g("winery"), "wine");
  assert.equal(g("restaurant:cafe"), "cafes");
  assert.equal(g("bar_and_grill"), "restaurants");
  assert.equal(g("gastropub"), "restaurants");
  assert.equal(g("poke_bar"), "restaurants");
  assert.equal(g("restaurant:mexican"), "restaurants");
  assert.equal(g("pizza"), "restaurants");
  assert.equal(roomOf({ name: "Hole in the Wall Bar" }), "bars");
  assert.equal(roomOf({ name: "Tacos Guerrero" }), "restaurants");
});

test("roomsPhrase reads as English for the rank sentence", () => {
  assert.equal(roomsPhrase(["bars"]), "bars");
  assert.equal(roomsPhrase(["restaurants", "bars"]), "bars and restaurants");
  assert.equal(roomsPhrase(["bars", "breweries", "restaurants"]), "bars, breweries and restaurants");
});

test("windows: next five weekdays from tomorrow, day names, clock", () => {
  const w = nextWeekdays(new Date(2026, 9, 8), 5); // Thursday 8 Oct 2026
  assert.deepEqual(w.map((x) => x.date), ["2026-10-09", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15"]);
  assert.deepEqual(w.map((x) => x.label), ["Fri 9", "Mon 12", "Tue 13", "Wed 14", "Thu 15"]);
  assert.equal(dayOf("2026-10-13"), "tuesday");
  assert.equal(dayOf("2026-10-18"), "sunday");
  assert.equal(toMinutes("14:30"), 870);
  assert.equal(toMinutes("25:00"), null);
  assert.equal(toMinutes("2pm"), null);
  assert.equal(clock12(870), "2:30 pm");
  assert.equal(clock12(0), "12:00 am");
});

const good = () => ({
  ...emptyProfile(),
  brand: "Tidewell",
  what: "Non-alcoholic hazy IPA",
  drinks: [{ key: "athletic-brewing", name: "Athletic Brewing", ready: true }],
  city: "austin",
  rooms: ["bars", "breweries"],
  start: { label: "E Cesar Chavez St", lat: 30.2556, lon: -97.7208 },
  windows: [{ date: "2026-10-13", from: "14:00", to: "16:00" }, { date: "2026-10-14", from: "13:00", to: "18:00" }],
  visitMin: 25,
  product: { ...emptyProfile().product, format: "cans" }, // group 3 #4: required, with the ask
  pitch: { ...emptyProfile().pitch, name: "Maya", ask: "one case of cans in the cooler" },
});

test("a complete profile validates; brand name and what you make are optional", () => {
  assert.deepEqual(validateProfile(good(), ctx), { ok: true, errors: {} });
  assert.equal(validateProfile({ ...good(), brand: "", what: "" }, ctx).ok, true);
});

test("an empty profile names every missing field that gates Build my plan", () => {
  const { ok, errors } = validateProfile(emptyProfile(), ctx);
  assert.equal(ok, false);
  assert.deepEqual(Object.keys(errors).sort(), ["ask", "city", "drinks", "format", "name", "start", "windows"]);
});

// L1 (owner review 6): live runs are on, so a brand found live is enough on its own (was "at least one ready")
test("drinks: 1–3 brands, fetched or found live; the venue preset stands in for brands", () => {
  const UUID = "11111111-2222-3333-4444-555555555555";
  const b = (n, ready = true) => Array.from({ length: n }, (_, i) => (ready ? { key: `b${i}`, name: `B${i}`, ready } : { id: UUID, name: `B${i}`, ready }));
  assert.match(validateProfile({ ...good(), drinks: [] }, ctx).errors.drinks, /a door that already pours you/);
  assert.match(validateProfile({ ...good(), drinks: b(4) }, ctx).errors.drinks, /Up to 3/);
  assert.equal(validateProfile({ ...good(), drinks: b(1, false) }, ctx).ok, true);
  assert.match(validateProfile({ ...good(), drinks: [{ name: "Typed only", ready: false }] }, ctx).errors.drinks, /from the search/);
  assert.equal(validateProfile({ ...good(), drinks: [...b(1, false), ...b(1)] }, ctx).ok, true);
  assert.equal(validateProfile({ ...good(), drinks: [], venue: "parsons" }, ctx).ok, true); // saved before N3
});

// N3: rooms that already pour you (any city) stand in for brands, or join them; up to 3, each picked from the search
test("pours: 1–3 rooms from any city, alone or with brands, each with a Qloo id", () => {
  const UUID = "11111111-2222-3333-4444-555555555555";
  const room = (i = 0) => ({ id: UUID.replace(/1/g, String(i + 2)), name: `Room ${i}`, where: "Logan Square, Chicago" });
  assert.equal(validateProfile({ ...good(), drinks: [], pours: [room()] }, ctx).ok, true);
  assert.equal(validateProfile({ ...good(), pours: [room(), room(1)] }, ctx).ok, true);
  assert.match(validateProfile({ ...good(), pours: [room(), room(1), room(2), room(3)] }, ctx).errors.pours, /Up to 3 doors/);
  assert.match(validateProfile({ ...good(), pours: [{ name: "Typed only" }] }, ctx).errors.pours, /from the search/);
  assert.equal(emptyProfile().pours.length, 0);
  assert.equal("venue" in emptyProfile(), false);
  // a profile saved before N3 reads its preset room as one pour
  assert.deepEqual(poursOf({ venue: "parsons" }, [{ key: "parsons", name: "Parson's", where: "Logan Square, Chicago", id: UUID }]), [{ id: UUID, name: "Parson's", where: "Logan Square, Chicago" }]);
  assert.equal(poursPhrase([{ name: "A" }, { name: "B" }]), "regulars like those at A and B");
});

// L1: any other city is a live city ({city: slug, cityName, cityLive: true}); a bare unknown key is still an error
test("city: a ready city, or a live one by name", () => {
  assert.match(validateProfile({ ...good(), city: "" }, ctx).errors.city, /Pick/);
  assert.match(validateProfile({ ...good(), city: "denver" }, ctx).errors.city, /Pick/);
  assert.equal(validateProfile({ ...good(), city: "denver-co", cityName: "Denver, CO", cityLive: true }, ctx).errors.city, undefined);
  for (const c of ["austin", "boise", "chicago", "omaha"]) {
    const center = index.cities.find((x) => x.key === c).center;
    assert.equal(validateProfile({ ...good(), city: c, start: { lat: center[0], lon: center[1] } }, ctx).ok, true, c);
  }
});

test("start must be a real point near the city", () => {
  assert.ok(validateProfile({ ...good(), start: null }, ctx).errors.start);
  assert.ok(validateProfile({ ...good(), start: { label: "somewhere" } }, ctx).errors.start);
  assert.match(validateProfile({ ...good(), start: { lat: 41.88, lon: -87.63 } }, ctx).errors.start, /far from Austin/);
});

test("rooms: at least one", () => {
  assert.ok(validateProfile({ ...good(), rooms: [] }, ctx).errors.rooms);
  assert.ok(validateProfile({ ...good(), rooms: ["spas"] }, ctx).errors.rooms);
});

test("windows: at least one day, from < to, long enough for one door, each day once", () => {
  const w = (windows) => validateProfile({ ...good(), windows }, ctx).errors.windows;
  assert.match(w([]), /at least one day/);
  assert.match(w([{ date: "2026-10-13", from: "16:00", to: "14:00" }]), /after its start/);
  assert.match(w([{ date: "2026-10-13", from: "14:00", to: "14:20" }]), /at least 25 minutes/);
  assert.match(w([{ date: "2026-10-13", from: "", to: "14:00" }]), /from and a to/);
  assert.match(w([{ date: "2026-10-13", from: "14:00", to: "16:00" }, { date: "2026-10-13", from: "17:00", to: "18:00" }]), /once/);
  assert.equal(w([{ date: "2026-10-13", from: "14:00", to: "14:25" }]), undefined);
});

test("time at each door: whole minutes, 5 to 120", () => {
  for (const v of [0, 4, 121, 2.5, "x", null]) assert.ok(validateProfile({ ...good(), visitMin: v }, ctx).errors.visitMin, String(v));
  assert.equal(validateProfile({ ...good(), visitMin: 45 }, ctx).ok, true);
});

test("the day strip: today and the six days after it, weekends included", () => {
  const w = nextDays(new Date(2026, 9, 9), 7); // Friday 9 Oct 2026
  assert.deepEqual(w.map((x) => x.date), ["2026-10-09", "2026-10-10", "2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15"]);
  assert.deepEqual(w.map((x) => x.label), ["Fri 9", "Sat 10", "Sun 11", "Mon 12", "Tue 13", "Wed 14", "Thu 15"]);
  assert.equal(nextDays(new Date(2026, 9, 30), 7).at(-1).date, "2026-11-05"); // across a month end
});

test("doors a day (J2): maxPerDay null or 1–20, maxByDate {date: 1–20}; empty = no cap; an old profile is valid", () => {
  assert.equal(emptyProfile().maxPerDay, null);
  assert.deepEqual(emptyProfile().maxByDate, {});
  const old = good();
  delete old.maxPerDay;
  delete old.maxByDate;
  assert.equal(validateProfile(old, ctx).ok, true, "saved before J2: no cap");
  for (const n of [null, 1, 6, 20]) assert.equal(validateProfile({ ...good(), maxPerDay: n }, ctx).ok, true, String(n));
  for (const n of [0, 21, 2.5, "3", -1]) assert.match(validateProfile({ ...good(), maxPerDay: n }, ctx).errors.maxPerDay ?? "", /1 to 20/, String(n));
  assert.equal(validateProfile({ ...good(), maxByDate: { "2026-10-13": 5 } }, ctx).ok, true);
  assert.equal(validateProfile({ ...good(), maxByDate: {} }, ctx).ok, true);
  for (const m of [{ "2026-10-13": 0 }, { "2026-10-13": 21 }, { "2026-10-13": null }, { tuesday: 3 }, [3]]) assert.match(validateProfile({ ...good(), maxByDate: m }, ctx).errors.maxByDate ?? "", /1 to 20/, JSON.stringify(m));
});
