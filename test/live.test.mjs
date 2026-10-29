// L1 (owner review 6): live runs end to end. A plan is live when a drink is a Qloo brand found live (ready:false) or the
// city is one Doors holds no files for (cityLive). The client asks the Worker's /api/route agent per drinker, stores the
// route and city files it streams, and feeds them in where fetched files go. Fixtures are made at test time from a
// fetched route file (Qloo ids never land in a committed fixture).
import { test } from "node:test";
import assert from "node:assert/strict";
import { normCity, citySlug, liveCacheKey, cityOf, isLiveProfile, liveDrinkers, routeFiles, runLive, primeLive, mergeCityFiles, liveError, profileForRun } from "../public/lib/live.js";
import { validateProfile, emptyProfile } from "../public/lib/profile.js";
import { buildPool, windowsFor } from "../public/lib/pool.js";
import { planDays, estimateTravel } from "../public/lib/schedule.js";
import { readJson, route as routeFile } from "./helpers.mjs";

const INDEX = () => structuredClone(readJson("public/data/index.json"));
const CAS = () => routeFile("casamigos-chicago");
const WIN = [{ date: "2026-10-13", from: "14:00", to: "18:00" }, { date: "2026-10-14", from: "14:00", to: "18:00" }];
const LOOP = { label: "The Loop", lat: 41.884, lon: -87.63 };
const base = (over = {}) => ({ ...emptyProfile(), brand: "Test", what: "Sparkling water", rooms: ["bars", "restaurants", "breweries"], start: LOOP, windows: WIN, product: { ...emptyProfile().product, format: "cans" }, pitch: { ...emptyProfile().pitch, name: "Sam", ask: "one case of cans in the cooler" }, ...over }); // group 3 #4: format and ask required

// a stream of the agent's events (as src/worker.js runRoute emits them), for a route file
const streamOf = (events) => {
  const text = events.map((e) => JSON.stringify(e) + "\n").join("");
  // split mid-line, as a network stream may
  const cut = Math.floor(text.length / 3);
  return new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(text.slice(0, cut))); c.enqueue(new TextEncoder().encode(text.slice(cut))); c.close(); } }), { headers: { "content-type": "application/x-ndjson" } });
};
const agentEvents = (route, cityName = route.city.name) => {
  const ids = route.lists.all.slice(0, 4).map((r) => r[0]);
  const city = { v: 1, city: route.city.key, name: cityName, live: true, sisters: { [ids[0]]: [[ids[1], 0.9]] }, sisterVenues: {}, sounds: {}, citySound: [], nbhdSounds: {}, pitches: { [ids[0]]: { lines: [{ label: "Crowd", text: "A test crowd." }], by: "template" } } };
  return [
    { type: "start", input: {} },
    { type: "step", id: "resolve", label: "Drinker", detail: `brand ${route.drinker.name}`, calls: 0 },
    { type: "step", id: "pages", label: "Doors", detail: "page 1: 50 rooms", calls: 1 },
    { type: "step", id: "filter", label: "Rooms that pour", detail: "…", calls: 3 },
    { type: "route", route, city },
    { type: "step", id: "pitch", label: "At the door", detail: "template", calls: 25 },
    { type: "done", ok: true, calls: 25 },
  ];
};
const fakeFetch = (route, calls, cityName) => async (url, init) => {
  calls.push({ url, body: JSON.parse(init.body) });
  return streamOf(agentEvents(route, cityName));
};

test("the cache key: kind, the drinker's id (any case) and the city however it is typed", () => {
  assert.equal(normCity("  Denver,  CO "), "denver co");
  assert.equal(normCity("Saint-Paul, Minnesota"), "saint paul minnesota");
  assert.equal(normCity("Québec"), "québec", "review6: letters in any script stay (NFKC, lower case)");
  assert.equal(citySlug("Denver, CO"), "denver-co");
  const a = liveCacheKey({ kind: "brand", id: "00000000-0000-4000-8000-B5A4031E5050", city: "Denver, CO" });
  assert.equal(a, liveCacheKey({ kind: "brand", id: "00000000-0000-4000-8000-b5a4031e5050", city: " denver co" }));
  assert.notEqual(a, liveCacheKey({ kind: "room", id: "00000000-0000-4000-8000-B5A4031E5050", city: "Denver, CO" }));
  assert.notEqual(a, liveCacheKey({ kind: "brand", id: "00000000-0000-4000-8000-B5A4031E5050", city: "Boulder, CO" }));
  // no id: the name, normalised
  assert.equal(liveCacheKey({ kind: "brand", name: "Topo  Chico", city: "Chicago" }), liveCacheKey({ kind: "brand", name: "topo chico", city: "chicago" }));
  // three proxies, in any order
  const items = [{ id: "A" }, { id: "B" }, { id: "C" }];
  assert.equal(liveCacheKey({ kind: "proxy", items, city: "Boise" }), liveCacheKey({ kind: "proxy", items: items.slice().reverse(), city: "boise" }));
});

test("validation: a live brand in a ready city, a ready brand in a live city; old profiles still load", () => {
  const index = INDEX();
  const ctx = { cities: index.cities };
  const live = { id: "11111111-2222-3333-4444-555555555555", name: "Topo Chico", ready: false };
  assert.equal(validateProfile(base({ city: "chicago", drinks: [live] }), ctx).ok, true, JSON.stringify(validateProfile(base({ city: "chicago", drinks: [live] }), ctx).errors));
  const denver = { city: "denver-co", cityName: "Denver, CO", cityLive: true, start: { label: "Union Station", lat: 39.7527, lon: -105.0001 } };
  assert.equal(validateProfile(base({ ...denver, drinks: [{ key: "casamigos", name: "Casamigos", ready: true }] }), ctx).ok, true);
  // a live city needs its name; its key must be the name's slug, never a ready city's key
  assert.ok(validateProfile(base({ ...denver, cityName: "" , drinks: [live] }), ctx).errors.city);
  assert.ok(validateProfile(base({ ...denver, city: "chicago", drinks: [live] }), ctx).errors.city);
  // a live brand needs a Qloo id and a name
  assert.ok(validateProfile(base({ city: "chicago", drinks: [{ id: "", name: "x", ready: false }] }), ctx).errors.drinks);
  // once the city's centre is known (Qloo's locality, or the form's lookup), the start must be within reach of it
  assert.ok(validateProfile(base({ ...denver, cityCenter: [39.7392, -104.9903], start: LOOP, drinks: [live] }), ctx).errors.start);
  assert.equal(validateProfile(base({ ...denver, cityCenter: [39.7392, -104.9903], drinks: [live] }), ctx).ok, true);
  // an old ready profile, unchanged
  assert.equal(validateProfile(base({ city: "chicago", drinks: [{ key: "casamigos", name: "Casamigos", ready: true }] }), ctx).ok, true);
});

test("which plans are live, and the drinkers each one asks for", () => {
  const index = INDEX();
  const cas = { key: "casamigos", name: "Casamigos", ready: true };
  const topo = { id: "11111111-2222-3333-4444-555555555555", name: "Topo Chico", ready: false };
  assert.equal(isLiveProfile(base({ city: "chicago", drinks: [cas] }), index), false);
  assert.equal(isLiveProfile(base({ city: "chicago", drinks: [cas, topo] }), index), true);
  assert.equal(isLiveProfile(base({ city: "denver-co", cityName: "Denver, CO", cityLive: true, drinks: [cas] }), index), true);
  // in a ready city a ready brand stays fetched; in a live city it runs live too, by its Qloo id
  const mixed = liveDrinkers(base({ city: "chicago", drinks: [cas, topo] }), index);
  assert.deepEqual(mixed.map((d) => [d.live, d.kind, d.name]), [[false, "brand", "Casamigos"], [true, "brand", "Topo Chico"]]);
  assert.match(mixed[1].key, /^q-topo-chico-[0-9a-f]{6}$/);
  const den = liveDrinkers(base({ city: "denver-co", cityName: "Denver, CO", cityLive: true, drinks: [cas] }), index);
  assert.deepEqual(den.map((d) => [d.live, d.key, d.id]), [[true, "casamigos", index.brands.find((b) => b.key === "casamigos").id]]);
  // the regulars of a preset room, in a live city
  const room = liveDrinkers(base({ city: "denver-co", cityName: "Denver, CO", cityLive: true, venue: "parsons", drinks: [] }), index);
  assert.deepEqual(room.map((d) => [d.kind, d.key]), [["room", "parsons"]]);
  // the city: a ready one from the index; a live one from the profile (centre once known)
  assert.equal(cityOf(base({ city: "chicago" }), index).name, "Chicago");
  assert.deepEqual(cityOf(base({ city: "denver-co", cityName: "Denver, CO", cityLive: true }), index), { key: "denver-co", name: "Denver, CO", query: "Denver, CO", center: null, live: true });
});

// N3: rooms that already pour you
test("rooms that pour you: Parson's alone in a held city stays fetched; any other set is one live pour run, brands mixed in", async () => {
  const index = INDEX();
  const parsons = index.rooms.find((r) => r.key === "parsons");
  const P = { id: parsons.id, name: parsons.name, where: parsons.where };
  const K = { id: "00000000-0000-4000-8000-E66E86FC6F8B", name: "Kite String", where: "North Center, Chicago, Illinois" };
  const cas = { key: "casamigos", name: "Casamigos", ready: true };
  const topo = { id: "11111111-2222-3333-4444-555555555555", name: "Topo Chico", ready: false };
  assert.deepEqual(liveDrinkers(base({ city: "austin", pours: [P] }), index).map((d) => [d.kind, d.key, d.live]), [["room", "parsons", false]]);
  const alone = liveDrinkers(base({ city: "austin", pours: [P, K] }), index);
  assert.equal(alone.length, 1);
  assert.equal(alone[0].kind, "pour");
  assert.equal(alone[0].live, true);
  assert.equal(alone[0].name, "regulars like those at Parson's Chicken & Fish and Kite String");
  const mixed = liveDrinkers(base({ city: "austin", pours: [K], drinks: [cas, topo] }), index)[0];
  assert.deepEqual(mixed.items.map((x) => [x.type, x.name]), [["place", "Kite String"], ["brand", "Casamigos"], ["brand", "Topo Chico"]]);
  assert.equal(mixed.items[1].id, index.brands.find((b) => b.key === "casamigos").id);
  assert.equal(mixed.name, "Casamigos and Topo Chico drinkers and regulars like those at Kite String");
  assert.match(mixed.key, /^pour-[0-9a-f]+$/);
  assert.ok(isLiveProfile(base({ city: "austin", pours: [K] }), index));
  // the cache key holds every item in any order
  assert.equal(liveCacheKey({ kind: "pour", items: mixed.items, city: "Austin" }), liveCacheKey({ kind: "pour", items: mixed.items.slice().reverse(), city: "austin" }));
  assert.notEqual(liveCacheKey({ kind: "pour", items: mixed.items, city: "Austin" }), liveCacheKey({ kind: "pour", items: mixed.items.slice(1), city: "Austin" }));
  // the request: the items, no id or name
  const calls = [];
  await runLive({ profile: base({ city: "austin", pours: [K], drinks: [cas] }), index, fetchImpl: fakeFetch(CAS(), calls) });
  assert.deepEqual(calls[0].body, { kind: "pour", items: [{ id: K.id, name: "Kite String", weight: 1, type: "place" }, { id: index.brands.find((b) => b.key === "casamigos").id, name: "Casamigos", weight: 1, type: "brand" }], city: "Austin", na: false });
});

test("a live run: one request per live drinker, steps reported, files primed where fetched files go, the plan builds", async () => {
  const index = INDEX();
  const route = CAS();
  const topo = { id: route.drinker.id, name: "Topo Chico", ready: false }; // the casamigos list stands in for a live brand
  const profile = base({ city: "chicago", drinks: [{ key: "athletic-brewing", name: "Athletic Brewing", ready: true }, topo] });
  const calls = [];
  const steps = [];
  const store = new Map();
  const cache = { get: (k) => store.get(k) ?? null, put: (k, v) => store.set(k, v) };
  const res = await runLive({ profile, index, fetchImpl: fakeFetch(route, calls), onStep: (s) => steps.push(s), cache });
  assert.equal(calls.length, 1, "only the live drinker asks the agent");
  assert.deepEqual(calls[0].body, { kind: "brand", id: route.drinker.id, name: "Topo Chico", city: "Chicago", na: false }); // review6: no day (the agent's is fixed)
  assert.deepEqual(steps.map((s) => s.id), ["resolve", "pages", "filter", "pitch"]);
  assert.ok(steps.every((s) => s.drinker === "Topo Chico"));
  // primed: the live route under its file name, the city file merged over the fetched one
  const files = new Map();
  const fetched = async (url) => readJson(url.slice(1).replace(/^data\//, "public/data/"));
  await primeLive({ index, cache: files, fetched }, res);
  const names = routeFiles(profile, index);
  assert.deepEqual(names, ["athletic-brewing-chicago", `${liveDrinkers(profile, index)[1].key}-chicago`]);
  assert.ok(index.files.includes(names[1]));
  assert.equal((await files.get(`/data/routes/${names[1]}.json`)).drinker.id, route.drinker.id);
  const city = await files.get("/data/cities/chicago.json");
  const id0 = route.lists.all[0][0];
  assert.equal(city.pitches[id0].lines[0].text, "A test crowd.", "the live run's lines win for its rooms");
  assert.ok(Object.keys(city.pitches).length > 100, "the fetched city's lines stay");
  // the plan builds from both lists, merged as fetched lists are
  const routes = [routeFile("athletic-brewing-chicago"), await files.get(`/data/routes/${names[1]}.json`)];
  const pool = buildPool({ routes, profile, cityName: "Chicago" });
  assert.ok(pool.N > 50);
  assert.match(pool.drinker, /Athletic Brewing and Topo Chico/);
  const plan = planDays({ pool: pool.rows, windows: windowsFor(profile), visitMin: 25, travel: estimateTravel });
  assert.ok(plan.days.every((d) => d.stops.length > 0));
  // a second run (a saved plan reloading) is served from the client's store: no request
  const again = await runLive({ profile, index, fetchImpl: fakeFetch(route, calls), cache });
  assert.equal(calls.length, 1);
  assert.equal(again.routes[0].route.drinker.id, route.drinker.id);
});

test("a ready brand in a live city: the city is Qloo's resolved locality, its key the profile's", async () => {
  const index = INDEX();
  const route = { ...CAS(), city: { key: "denver", name: "Denver", query: "Denver, CO", center: [39.7392, -104.9903] } };
  const profile = base({ city: "denver-co", cityName: "Denver, CO", cityLive: true, start: { label: "Union Station", lat: 39.7527, lon: -105.0001 }, drinks: [{ key: "casamigos", name: "Casamigos", ready: true }] });
  const calls = [];
  const res = await runLive({ profile, index, fetchImpl: fakeFetch(route, calls, "Denver"), cache: null });
  assert.equal(calls[0].body.city, "Denver, CO");
  assert.equal(calls[0].body.id, index.brands.find((b) => b.key === "casamigos").id);
  const files = new Map();
  await primeLive({ index, cache: files, fetched: async () => { throw new Error("no fetched file for a live city"); } }, res);
  const c = cityOf(profile, index);
  assert.deepEqual([c.key, c.name, c.center, c.live], ["denver-co", "Denver", [39.7392, -104.9903], true]);
  assert.deepEqual(routeFiles(profile, index), ["casamigos-denver-co"]);
  assert.equal((await files.get("/data/cities/denver-co.json")).name, "Denver");
  // validation now knows the centre: the start is checked against it, and one 500 km off is caught
  assert.equal(validateProfile(profile, { cities: index.cities }).ok, true);
  assert.match(validateProfile({ ...profile, start: { label: "Albuquerque", lat: 35.08, lon: -106.65 } }, { cities: index.cities }).errors.start, /far from Denver/);
});

test("errors say what happened and what to try", async () => {
  const index = INDEX();
  const profile = base({ city: "denver-co", cityName: "Denvr", cityLive: true, drinks: [{ id: "11111111-2222-3333-4444-555555555555", name: "Topo Chico", ready: false }] });
  const err = (e) => async () => streamOf([{ type: "start" }, { type: "error", error: e }]);
  await assert.rejects(runLive({ profile, index, fetchImpl: err(`Qloo returned no bars or restaurants for this drinker in "Denvr". Try the city's full name.`) }), (e) => {
    assert.match(e.message, /no bars or restaurants/);
    assert.match(e.hint, /full name/);
    return true;
  });
  // refused before it starts (a spent budget, the per-visitor limit): the Worker's own words
  const paused = async () => Response.json({ error: "New live routes are paused: this build's Qloo budget is spent.", paused: true }, { status: 503 });
  await assert.rejects(runLive({ profile, index, fetchImpl: paused }), /paused/);
  assert.match(liveError("Qloo has no brand called \"Topo\"").hint, /brand/);
});

// L1: near the budget's end, or past a visitor's daily runs, the page never shows an error: it says
// plainly that live runs are resting and offers the examples and the runs already made (free to open)
test("resting and the daily cap come back as a fallback with the saved runs, not an error", async () => {
  const index = INDEX();
  const profile = base({ city: "denver-co", cityName: "Denver, CO", cityLive: true, drinks: [{ id: "11111111-2222-3333-4444-555555555555", name: "Topo Chico", ready: false }] });
  const runs = [{ kind: "brand", id: "00000000-0000-4000-8000-8F658497CEA5", name: "Topo Chico Hard Seltzer", city: "Chicago", cityName: "Chicago", at: "2026-10-21" }];
  const resting = async () => Response.json({ resting: true, paused: true, message: "New plans are off for today: the daily limit is used. Try one of the examples, or a brand and city someone has already run.", runs }, { status: 503 });
  await assert.rejects(runLive({ profile, index, fetchImpl: resting }), (e) => {
    assert.equal(e.fallback, "resting");
    assert.match(e.message, /^New plans are off for today/);
    assert.deepEqual(e.runs, runs);
    return true;
  });
  const daily = async () => Response.json({ daily: true, message: "New plans are off for today: the daily limit is used. Try one of the examples, or a brand and city someone has already run.", runs }, { status: 429 });
  await assert.rejects(runLive({ profile, index, fetchImpl: daily }), (e) => e.fallback === "daily" && e.runs.length === 1 && /^New plans are off for today/.test(e.message));
});

test("a saved run offered on a resting page becomes the profile's brand and city (the start kept only in the same city)", () => {
  const index = INDEX();
  const p = base({ city: "denver-co", cityName: "Denver, CO", cityLive: true, start: { label: "Union Station", lat: 39.75, lon: -105 }, known: ["x"], drinks: [{ key: "casamigos", name: "Casamigos", ready: true }] });
  // review6: a saved run carries Qloo's name for its city (cityName), never what a visitor typed
  const chi = profileForRun(p, { kind: "brand", id: "00000000-0000-4000-8000-8F658497CEA5", name: "Topo Chico Hard Seltzer", cityName: "Chicago" }, index);
  assert.deepEqual(chi.drinks, [{ id: "00000000-0000-4000-8000-8F658497CEA5", name: "Topo Chico Hard Seltzer", ready: false, where: "" }]);
  assert.deepEqual([chi.city, chi.cityLive, chi.cityName, chi.start, chi.known], ["chicago", undefined, undefined, null, []]);
  const den = profileForRun({ ...p, city: "denver", cityName: "Denver" }, { kind: "brand", id: "00000000-0000-4000-8000-B5A4031E5050", name: "Casamigos", cityName: "Denver" }, index);
  assert.deepEqual([den.city, den.cityLive, den.start.label], ["denver", true, "Union Station"]);
  assert.deepEqual(den.drinks, [{ key: "casamigos", name: "Casamigos", ready: true }], "a fetched brand stays a fetched brand");
});

test("city files from several drinkers merge: sisters, venues, sounds and lines from each", () => {
  const a = { v: 1, city: "x", name: "X", sisters: { a: [["b", 1]] }, sisterVenues: { b: { id: "b" } }, sounds: { a: { artists: [] } }, citySound: [{ name: "Alpha" }], nbhdSounds: {}, pitches: { a: { lines: [] } } };
  const b = { v: 1, city: "x", name: "X", live: true, sisters: { c: [["d", 1]] }, sisterVenues: { d: { id: "d" } }, sounds: {}, citySound: [{ name: "Alpha" }, { name: "Beta" }], nbhdSounds: {}, pitches: { c: { lines: [] } } };
  const m = mergeCityFiles([a, b]);
  assert.deepEqual(Object.keys(m.sisters).sort(), ["a", "c"]);
  assert.deepEqual(Object.keys(m.sisterVenues).sort(), ["b", "d"]);
  assert.deepEqual(Object.keys(m.pitches).sort(), ["a", "c"]);
  assert.deepEqual(m.citySound.map((x) => x.name), ["Alpha", "Beta"]);
});

// the pre-publish audit (KV free plan): a saved run is picked by its ref (the Worker keeps no alias under Qloo's city name)
test("a saved run picked from the list sends its ref, so the Worker serves that run", async () => {
  const index = INDEX();
  const p = profileForRun(base({ city: "chicago" }), { kind: "brand", id: "11111111-2222-3333-4444-555555555555", name: "Guinness", cityName: "Denver", ref: "0123456789abcdef" }, index);
  const calls = [];
  await runLive({ profile: { ...p, start: { lat: 39.75, lon: -105 } }, index, fetchImpl: async (url, init) => (calls.push(JSON.parse(init.body)), streamOf(agentEvents(CAS()))) }).catch(() => {});
  assert.equal(calls[0].ref, "0123456789abcdef");
  assert.equal(calls[0].city, "Denver");
});

test("cityMisread: a city Qloo read as something else stops the run; spelling variants, states and acronyms pass", async () => {
  const { cityMisread } = await import("../src/worker.js");
  assert.equal(cityMisread("Qwxzy Flats", { name: "The Flats", disambiguation: "Beverly Hills, CA" }), true);
  assert.equal(cityMisread("Chicgo", { name: "Chicago" }), true);
  for (const [t, l] of [["Miami, FL", { name: "Miami-Dade County" }], ["St. Louis, MO", { name: "St. Louis" }], ["Montréal", { name: "Montreal" }], ["NYC", { name: "New York" }], ["New York City", { name: "New York" }], ["Austin, TX", { name: "Austin", disambiguation: "Texas, United States" }]])
    assert.equal(cityMisread(t, l), false, t);
});

// live check C: Qloo read "Milwaukee, WI" as "Milwaukee County"; the page says the typed city
test("a county reading of the typed city shows the city's name; any other reading is Qloo's", async () => {
  const { placeName } = await import("../public/lib/live.js");
  assert.equal(placeName("Milwaukee County", "Milwaukee, WI"), "Milwaukee");
  assert.equal(placeName("Delaware County", "Delaware, OH"), "Delaware");
  assert.equal(placeName("Cook County", "Chicago"), "Cook County");
  assert.equal(placeName("New York", "New York City"), "New York");
  assert.equal(placeName(null, "Milwaukee, WI"), null);
});

// live check leftover: reloading a failed live run spent a Qloo call each time
test("a live run that failed for good is said again from the device on a reload: no second request; busy isn't kept", async () => {
  const index = INDEX();
  const topo = { id: "11111111-2222-3333-4444-555555555555", name: "Topo Chico", ready: false };
  const profile = base({ city: "chicago", drinks: [topo] });
  const store = new Map();
  const cache = { get: (k) => store.get(k) ?? null, put: (k, v) => store.set(k, v) };
  const calls = [];
  const failWith = (error) => async (url, init) => (calls.push(init), streamOf([{ type: "error", error }]));
  await assert.rejects(runLive({ profile, index, fetchImpl: failWith('Qloo doesn\'t know a city called "Chicgo".'), cache }), /doesn't know a city/);
  const e = await runLive({ profile, index, fetchImpl: failWith("never asked"), cache }).catch((x) => x);
  assert.equal(calls.length, 1, "the reload makes no request");
  assert.equal(e.cached, true);
  assert.match(e.message, /doesn't know a city called "Chicgo"/);
  // a transient failure is not kept: the next try asks again
  store.clear();
  await assert.rejects(runLive({ profile, index, fetchImpl: failWith("Qloo 503 on /v2/insights"), cache }));
  await assert.rejects(runLive({ profile, index, fetchImpl: failWith("Qloo 503 on /v2/insights"), cache }));
  assert.equal(calls.length, 3);
});

test("fix5-res: a run with gaps kept on this device is asked again after a day; one without gaps stays", async () => {
  const index = INDEX();
  const route = { ...CAS(), gaps: ["city sound"] };
  const profile = base({ city: "chicago", drinks: [{ id: route.drinker.id, name: "Topo Chico", ready: false }] });
  const calls = [];
  const store = new Map();
  const cache = { get: (k) => store.get(k) ?? null, put: (k, v) => store.set(k, v) };
  await runLive({ profile, index, fetchImpl: fakeFetch(route, calls), cache });
  await runLive({ profile, index, fetchImpl: fakeFetch(route, calls), cache });
  assert.equal(calls.length, 1, "same day: served from the device");
  for (const [k, v] of store) store.set(k, { ...v, at: Date.now() - 25 * 3600 * 1000 });
  await runLive({ profile, index, fetchImpl: fakeFetch(route, calls), cache });
  assert.equal(calls.length, 2, "a day later: asked again, so the gaps can fill in");
  for (const [k, v] of store) store.set(k, { ...v, route: { ...v.route, gaps: [] }, at: 0 });
  await runLive({ profile, index, fetchImpl: fakeFetch(route, calls), cache });
  assert.equal(calls.length, 2, "no gaps: kept for good");
});
