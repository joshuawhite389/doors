// ORS endpoints against hand-written fixtures (test/fixtures/ors). ORS_FETCH replaces the network; global fetch is a
// tripwire. Covers happy paths, the straight-line fallback, the KV cache, validation and the per-IP limiter.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.js";
import { estimateDirections, estimateLeg, parseMatrix, resetOrsLimiter, validateCoords, ORS_CEILING, ORS_PLAN, ESTIMATE_LABEL, PER_IP, AUTO_PER_IP_DAY, AUTO_PER_MIN, AUTO_RESTING } from "../src/ors.js";
import { readJson } from "./helpers.mjs";

const realFetch = globalThis.fetch;
let netCalls = 0;
before(() => {
  globalThis.fetch = async (u) => {
    netCalls++;
    throw new Error(`network call attempted in a test: ${u}`);
  };
});
after(() => {
  globalThis.fetch = realFetch;
  assert.equal(netCalls, 0, "no network calls");
});
beforeEach(() => resetOrsLimiter());

const FX = (n) => readJson(`test/fixtures/ors/${n}.json`);
const NOMADIC = [-97.760568, 30.224437];
const YARD = [-97.761391, 30.217154];
const PINTHOUSE = [-97.742367, 30.215381];
const COORDS = [NOMADIC, YARD, PINTHOUSE];

function makeKv() {
  const store = new Map();
  return { store, get: async (k, t) => (store.has(k) ? (t === "json" ? JSON.parse(store.get(k)) : store.get(k)) : null), put: async (k, v) => void store.set(k, v) };
}
// An ORS stand-in: answers from the fixtures and records every request (path, headers, body).
function fakeOrs({ status = 200, bodyFor } = {}) {
  const seen = [];
  const f = async (u, init = {}) => {
    const url = new URL(u);
    seen.push({ path: url.pathname, params: url.searchParams, headers: new Headers(init.headers), body: init.body ? JSON.parse(init.body) : null });
    if (status !== 200) return new Response(JSON.stringify(FX("quota")), { status });
    const name = url.pathname.startsWith("/v2/directions") ? "directions" : url.pathname.startsWith("/v2/matrix") ? "matrix" : "geocode";
    return Response.json(bodyFor?.(name) ?? FX(name));
  };
  f.seen = seen;
  return f;
}
const envWith = (over = {}) => ({ ASSETS: { fetch: async () => new Response("asset") }, ORS_API_KEY: "test-key", ORS_FETCH: fakeOrs(), DOORS_KV: makeKv(), ...over });
let ip = 0;
const call = (env, path, { body, method, ipAddr } = {}) => {
  const headers = new Headers({ "cf-connecting-ip": ipAddr ?? `10.9.0.${++ip % 250}`, "content-type": "application/json" });
  return worker.fetch(new Request(`https://doors.test${path}`, { method: method ?? (body ? "POST" : "GET"), headers, body: body ? JSON.stringify(body) : undefined }), env, { waitUntil: () => {} });
};

test("directions: ORS geojson → miles and minutes per leg, road geometry, source ors", async () => {
  const env = envWith();
  const res = await call(env, "/api/directions", { body: { coords: COORDS } });
  assert.equal(res.status, 200);
  const b = await res.json();
  assert.equal(b.source, "ors");
  assert.equal(b.geometry.type, "LineString");
  assert.equal(b.geometry.coordinates.length, 10, "the road geometry, not the waypoints");
  assert.deepEqual(b.wayPoints, [0, 4, 9], "each waypoint's index in the geometry (the animation pins doors to it)");
  assert.deepEqual(b.legs, [{ mi: 0.8, min: 3 }, { mi: 1.5, min: 5 }]); // 1215.4 m, 182.6 s; 2398.9 m, 301.2 s
  assert.equal(b.mi, 2.2); // 3614.3 m
  assert.equal(b.min, 8.1); // 483.8 s
  // the request ORS saw
  const [r] = env.ORS_FETCH.seen;
  assert.equal(r.path, "/v2/directions/driving-car/geojson");
  assert.equal(r.headers.get("authorization"), "test-key");
  assert.deepEqual(r.body.coordinates, COORDS);
});

test("matrix: seconds/meters → minutes/miles; a null cell takes the estimate and is listed", async () => {
  const env = envWith();
  const b = await (await call(env, "/api/matrix", { body: { coords: COORDS } })).json();
  assert.equal(b.source, "ors");
  assert.deepEqual(b.durations[0], [0, 3, 7.6]);
  assert.deepEqual(b.distances[1], [0.8, 0, 1.5]);
  assert.deepEqual(b.estimated, [[2, 1]]);
  const e = estimateLeg(PINTHOUSE, YARD);
  assert.equal(b.distances[2][1], Math.round(e.mi * 10) / 10);
  assert.equal(b.label, ESTIMATE_LABEL);
  const [r] = env.ORS_FETCH.seen;
  assert.equal(r.path, "/v2/matrix/driving-car");
  assert.deepEqual(r.body.metrics, ["duration", "distance"]);
});

test("matrix: sources/destinations narrow the request and are passed through", async () => {
  const env = envWith({ ORS_FETCH: fakeOrs({ bodyFor: (n) => (n === "matrix" ? { durations: [[182.6, 455.1]], distances: [[1215.4, 3540.2]] } : null) }) });
  const b = await (await call(env, "/api/matrix", { body: { coords: COORDS, sources: [0], destinations: [1, 2] } })).json();
  assert.equal(b.source, "ors");
  assert.deepEqual(b.durations, [[3, 7.6]]);
  assert.deepEqual(b.sources, [0]);
  assert.deepEqual(b.destinations, [1, 2]);
  assert.deepEqual(env.ORS_FETCH.seen[0].body.sources, [0]);
});

test("geocode: top results as {label, lat, lon}, focused on the city", async () => {
  const env = envWith();
  const b = await (await call(env, "/api/geocode?q=E%20Cesar%20Chavez%20St&city=austin")).json();
  assert.equal(b.source, "ors");
  assert.equal(b.results.length, 3);
  assert.deepEqual(b.results[0], { label: "East Cesar Chavez Street, Austin, TX, USA", lat: 30.2577, lon: -97.7297 });
  const [r] = env.ORS_FETCH.seen;
  assert.equal(r.path, "/geocode/search");
  assert.equal(r.params.get("focus.point.lat"), "30.2672");
  assert.equal(r.params.get("boundary.circle.radius"), "40");
  assert.equal(r.params.get("size"), "5");
});

test("geocode needs a ready city (R1 Diolosa 14): no city, another city or a far lat/lon → 400; a near lat/lon focuses", async () => {
  const env = envWith();
  for (const path of [
    "/api/geocode?q=Main%20Street",
    "/api/geocode?q=Main%20Street&city=denver",
    "/api/geocode?q=Main%20Street&lat=39.7392&lon=-104.9903", // Denver, no city
    "/api/geocode?q=Main%20Street&lat=40.71&lon=-74.0",
  ]) {
    const res = await call(env, path);
    assert.equal(res.status, 400, path);
    assert.ok((await res.json()).error);
  }
  assert.equal(env.ORS_FETCH.seen.length, 0, "nothing reaches ORS");
  // lat/lon near Omaha with no city: allowed, focused there
  assert.equal((await call(env, "/api/geocode?q=Farnam%20St&lat=41.26&lon=-95.94")).status, 200);
  assert.equal(env.ORS_FETCH.seen.at(-1).params.get("focus.point.lat"), "41.26");
  // a far lat/lon with a ready city: ignored, the city centre is the focus
  assert.equal((await call(env, "/api/geocode?q=Congress%20Ave&city=austin&lat=40.71&lon=-74.0")).status, 200);
  assert.equal(env.ORS_FETCH.seen.at(-1).params.get("focus.point.lat"), "30.2672");
  // case-insensitive city
  assert.equal((await call(env, "/api/geocode?q=State%20St&city=Chicago")).status, 200);
});

// L1: a live city (any US city by name). The address is searched in it ("Union Station, Denver, CO"), focused on its
// centre once known (lat/lon); kind=city finds the city itself (the form's map and the start check).
test("geocode in a live city: by its name, focused on its centre when given; kind=city finds the city", async () => {
  const env = envWith();
  assert.equal((await call(env, "/api/geocode?q=Union%20Station&cityName=Denver%2C%20CO")).status, 200);
  let r = env.ORS_FETCH.seen.at(-1);
  assert.equal(r.params.get("text"), "Union Station, Denver, CO");
  assert.equal(r.params.get("boundary.country"), "US");
  assert.equal(r.params.get("boundary.circle.radius"), null, "no centre yet: the name does the work");
  assert.equal((await call(env, "/api/geocode?q=Union%20Station&cityName=Denver%2C%20CO&lat=39.7392&lon=-104.9903")).status, 200);
  r = env.ORS_FETCH.seen.at(-1);
  assert.equal(r.params.get("focus.point.lat"), "39.7392");
  assert.equal(r.params.get("boundary.circle.radius"), "40");
  assert.equal((await call(env, "/api/geocode?kind=city&q=Denver%2C%20CO")).status, 200);
  r = env.ORS_FETCH.seen.at(-1);
  assert.equal(r.params.get("text"), "Denver, CO");
  assert.equal(r.params.get("layers"), "locality,localadmin");
  // a too-short city name is still a 400
  assert.equal((await call(env, "/api/geocode?q=Main%20Street&cityName=D")).status, 400);
});

test("geocode with no match → results [] and fallback pin", async () => {
  const env = envWith({ ORS_FETCH: fakeOrs({ bodyFor: () => ({ type: "FeatureCollection", features: [] }) }) });
  const b = await (await call(env, "/api/geocode?q=nowhere%20at%20all&city=boise")).json();
  assert.deepEqual(b.results, []);
  assert.equal(b.fallback, "pin");
});

test("fallback: no key → straight-line × 1.35 at 18 mph, labelled estimate; geocode → drop a pin", async () => {
  const env = envWith({ ORS_API_KEY: undefined });
  const d = await (await call(env, "/api/directions", { body: { coords: COORDS } })).json();
  assert.equal(d.source, "estimate");
  assert.equal(d.label, "estimated: straight-line distance × 1.35");
  assert.match(d.reason, /no ORS key/);
  assert.deepEqual(d.geometry.coordinates, COORDS, "straight lines between the stops");
  assert.deepEqual(d.wayPoints, COORDS.map((_, i) => i));
  // the formula, by hand: haversine miles × 1.35, minutes at 18 mph
  const R = 3958.7613;
  const rad = (x) => (x * Math.PI) / 180;
  const hav = (a, b) => 2 * R * Math.asin(Math.sqrt(Math.sin(rad(b[1] - a[1]) / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(rad(b[0] - a[0]) / 2) ** 2));
  const mi = hav(NOMADIC, YARD) * 1.35;
  assert.ok(Math.abs(d.legs[0].mi - mi) < 0.06, `${d.legs[0].mi} vs ${mi}`);
  assert.ok(Math.abs(d.legs[0].min - (mi / 18) * 60) < 0.06);
  assert.equal(d.legs.length, 2);
  const m = await (await call(env, "/api/matrix", { body: { coords: COORDS } })).json();
  assert.equal(m.source, "estimate");
  assert.equal(m.durations.length, 3);
  assert.equal(m.durations[1][1], 0);
  assert.equal(m.distances[0][1], d.legs[0].mi, "matrix and directions estimate agree");
  const g = await (await call(env, "/api/geocode?q=E%20Cesar%20Chavez&city=austin")).json();
  assert.equal(g.fallback, "pin");
  assert.deepEqual(g.results, []);
  assert.equal(env.ORS_FETCH.seen.length, 0, "no ORS call without a key");
});

test("fallback: ?ors=off and {ors:'off'} force the estimate even with a key and a cached answer", async () => {
  const env = envWith();
  await call(env, "/api/directions", { body: { coords: COORDS } }); // caches the ORS answer
  const q = await (await call(env, "/api/directions?ors=off", { body: { coords: COORDS } })).json();
  assert.equal(q.source, "estimate");
  assert.match(q.reason, /forced/);
  const b = await (await call(env, "/api/matrix", { body: { coords: COORDS, ors: "off" } })).json();
  assert.equal(b.source, "estimate");
  const g = await (await call(env, "/api/geocode?q=E%20Cesar%20Chavez&city=austin&ors=off")).json();
  assert.equal(g.fallback, "pin");
  assert.equal(env.ORS_FETCH.seen.length, 1, "only the first request reached ORS");
});

test("fallback: ORS quota error (403/429), a bad shape or a thrown fetch → the estimate, and the key never leaks", async () => {
  for (const status of [403, 429, 500]) {
    const env = envWith({ ORS_FETCH: fakeOrs({ status }) });
    const d = await (await call(env, "/api/directions", { body: { coords: COORDS } })).json();
    assert.equal(d.source, "estimate", String(status));
    assert.match(d.reason, new RegExp(String(status)));
    const g = await call(env, "/api/geocode?q=E%20Cesar%20Chavez&city=austin");
    const gt = await g.text();
    assert.ok(!gt.includes("test-key"), "the key is not in the answer");
    assert.equal(JSON.parse(gt).fallback, "pin");
  }
  const shape = envWith({ ORS_FETCH: fakeOrs({ bodyFor: () => ({ nope: true }) }) });
  assert.equal((await (await call(shape, "/api/directions", { body: { coords: COORDS } })).json()).source, "estimate");
  assert.equal((await (await call(shape, "/api/matrix", { body: { coords: COORDS } })).json()).source, "estimate");
  const thrown = envWith({ ORS_FETCH: async () => { throw new Error("socket hang up"); } });
  assert.equal((await (await call(thrown, "/api/directions", { body: { coords: COORDS } })).json()).source, "estimate");
  // an estimate is never cached as if it were a road answer
  assert.ok(![...thrown.DOORS_KV.store.keys()].some((k) => k.startsWith("ors:v1:")));
});

test("cache: the second identical request is a KV hit (no ORS call); a different request is not", async () => {
  const env = envWith();
  const a = await (await call(env, "/api/directions", { body: { coords: COORDS } })).json();
  const b = await (await call(env, "/api/directions", { body: { coords: COORDS } })).json();
  assert.equal(b.cache, "hit");
  assert.deepEqual({ ...b, cache: undefined }, { ...a, cache: undefined });
  assert.equal(env.ORS_FETCH.seen.length, 1);
  await call(env, "/api/directions", { body: { coords: [NOMADIC, PINTHOUSE] } });
  assert.equal(env.ORS_FETCH.seen.length, 2);
  // geocode: case and spacing of the query share one cache entry
  await call(env, "/api/geocode?q=E%20Cesar%20Chavez&city=austin");
  const g = await (await call(env, "/api/geocode?q=e%20cesar%20%20chavez&city=austin")).json();
  assert.equal(g.cache, "hit");
  assert.equal(env.ORS_FETCH.seen.length, 3);
  // stored with a 30-day TTL
  const puts = [];
  const kv = { get: async () => null, put: async (k, v, o) => void puts.push([k, o]) };
  await call(envWith({ DOORS_KV: kv }), "/api/matrix", { body: { coords: COORDS } });
  const cached = puts.find(([k]) => k.startsWith("ors:v1:matrix:"));
  assert.equal(cached[1].expirationTtl, 30 * 86400);
});

test("validation: bad JSON, bad coords, too many points, bad indexes, short query → 400 with an error", async () => {
  const env = envWith();
  const cases = [
    ["/api/directions", { method: "GET" }],
    ["/api/directions", { body: { coords: [NOMADIC] } }],
    ["/api/directions", { body: { coords: "nope" } }],
    ["/api/directions", { body: { coords: [NOMADIC, [200, 30]] } }],
    ["/api/directions", { body: { coords: [NOMADIC, [-97.7, 95]] } }],
    ["/api/directions", { body: { coords: [NOMADIC, ["-97.7", "30.2"]] } }],
    ["/api/directions", { body: { coords: [NOMADIC, [-97.7, 30.2, 5]] } }],
    ["/api/directions", { body: { coords: Array.from({ length: 51 }, (_, i) => [-97.7 + i / 1000, 30.2]) } }],
    ["/api/matrix", { body: { coords: COORDS, sources: [3] } }],
    ["/api/matrix", { body: { coords: COORDS, destinations: [1, 1] } }],
    ["/api/matrix", { body: { coords: Array.from({ length: 101 }, (_, i) => [-97.7 + i / 1000, 30.2]) } }],
    ["/api/matrix", { body: { coords: Array.from({ length: 60 }, (_, i) => [-97.7 + i / 1000, 30.2]) } }], // 3,600 cells
    ["/api/geocode?q=ab&city=austin", {}],
    [`/api/geocode?q=${"x".repeat(121)}`, {}],
    ["/api/geocode?q=main%20street&lat=abc&lon=-97", {}],
  ];
  for (const [path, opts] of cases) {
    const res = await call(env, path, opts);
    assert.equal(res.status, 400, `${path} ${JSON.stringify(opts).slice(0, 80)}`);
    assert.ok((await res.json()).error);
  }
  const raw = await worker.fetch(new Request("https://doors.test/api/directions", { method: "POST", body: "{not json" }), env, {});
  assert.equal(raw.status, 400);
  assert.equal(env.ORS_FETCH.seen.length, 0, "nothing invalid reaches ORS");
  // 60 points with sources/destinations narrowed to 50 × 50 is allowed
  const ok = await call(env, "/api/matrix", { body: { coords: Array.from({ length: 60 }, (_, i) => [-97.7 + i / 1000, 30.2]), sources: [...Array(50).keys()], destinations: [...Array(50).keys()], ors: "off" } });
  assert.equal(ok.status, 200);
  assert.deepEqual(validateCoords([[1.23456789, 2.3456789], [3, 4]]).coords[0], [1.234568, 2.345679]);
});

test(`limiter: past ${PER_IP.directions} directions in ten minutes one visitor gets the estimate; another visitor still gets roads`, async () => {
  const env = envWith({ DOORS_KV: undefined }); // no cache: every request would reach ORS
  let last;
  for (let i = 0; i < PER_IP.directions + 1; i++) last = await (await call(env, "/api/directions", { body: { coords: COORDS }, ipAddr: "10.1.1.1" })).json();
  assert.equal(last.source, "estimate");
  assert.match(last.reason, /too many requests/);
  assert.equal(env.ORS_FETCH.seen.length, PER_IP.directions);
  const other = await (await call(env, "/api/directions", { body: { coords: COORDS }, ipAddr: "10.1.1.2" })).json();
  assert.equal(other.source, "ors");
});

// the pre-publish audit (KV free plan): the daily ORS count lives in this isolate's memory, and geocodes aren't cached in KV
test("daily ceiling: at the ceiling every visitor gets the estimate; no KV write for the count or a geocode", async () => {
  const kv = makeKv();
  const env = envWith({ DOORS_KV: kv, ORS_CEILING_GEOCODE: "2" });
  assert.equal((await (await call(env, "/api/geocode?q=first%20street&city=omaha")).json()).source, "ors");
  assert.equal((await (await call(env, "/api/geocode?q=second%20street&city=omaha")).json()).source, "ors");
  const third = await (await call(env, "/api/geocode?q=third%20street&city=omaha")).json();
  assert.equal(third.fallback, "pin");
  assert.match(third.reason, /ceiling/);
  assert.equal([...kv.store.keys()].filter((k) => k.startsWith("ors:")).length, 0, "nothing written");
  assert.ok(ORS_CEILING.directions < 2000 && ORS_CEILING.matrix < 500 && ORS_CEILING.geocode < 1000, "ceilings sit under the free plan");
});

test("parseMatrix and estimateDirections are pure and unit-correct", () => {
  const m = parseMatrix({ durations: [[0, 60]], distances: [[0, 1609.344]] }, [NOMADIC, YARD], [0], null);
  assert.deepEqual(m.durations, [[0, 1]]);
  assert.deepEqual(m.distances, [[0, 1]]);
  const e = estimateDirections([NOMADIC, NOMADIC]);
  assert.deepEqual(e.legs, [{ mi: 0, min: 0 }]);
});

test("/api/health says which roads are in use", async () => {
  const withKey = await (await call(envWith(), "/api/health")).json();
  assert.equal(withKey.roads, "ors");
  const without = await (await call(envWith({ ORS_API_KEY: undefined }), "/api/health")).json();
  assert.equal(without.roads, "estimate");
});

test("limiter is sized for a rep re-planning 30 times an hour (R1 Diolosa 10)", () => {
  // one plan load (5 windows) + 30 re-plans an hour, each re-routing ~2 changed days, in the busiest 10 minutes
  const busy = { matrix: 5 + 5, directions: 5 + 2 * 15 };
  assert.ok(PER_IP.matrix >= 4 * busy.matrix && PER_IP.directions >= 3 * busy.directions, JSON.stringify(PER_IP));
});

test("parseDirections handles the live no-segments shape (way_points + summary only, recorded 2026-10-09)", async () => {
  const { parseDirections } = await import("../src/ors.js");
  const { readFileSync } = await import("node:fs");
  const body = JSON.parse(readFileSync(new URL("./fixtures/ors/live-directions-noseg.json", import.meta.url)));
  const coords = [[-97.7208, 30.2556], [-97.7606, 30.2244], [-97.786, 30.229]];
  const out = parseDirections(body, coords);
  assert.equal(out.source, "ors");
  assert.equal(out.legs.length, 2);
  const sumMi = out.legs.reduce((a, l) => a + l.mi, 0);
  assert.ok(Math.abs(sumMi - out.mi) <= 0.2, `legs ${sumMi} vs total ${out.mi}`);
  assert.ok(out.legs.every((l) => l.mi > 0 && l.min > 0));
});

// ---------- address predictions while typing (owner review 7, M2) ----------
const CINCY = "lat=39.1402&lon=-84.5058";
const countingKv = () => {
  const kv = makeKv();
  kv.reads = 0;
  kv.writes = 0;
  const { get, put } = kv;
  kv.get = (...a) => (kv.reads++, get(...a));
  kv.put = (...a) => (kv.writes++, put(...a));
  return kv;
};

test("autocomplete: ORS /geocode/autocomplete focused on the city's centre, boxed ~40 km, US, addresses/venues/streets", async () => {
  const env = envWith();
  const b = await (await call(env, `/api/geocode?kind=auto&q=Vine%20St&${CINCY}`)).json();
  assert.equal(b.source, "ors");
  assert.ok(b.results.length > 0 && b.results.every((r) => r.label && Number.isFinite(r.lat) && Number.isFinite(r.lon)));
  const r = env.ORS_FETCH.seen[0];
  assert.equal(r.path, "/geocode/autocomplete");
  assert.equal(r.params.get("text"), "Vine St");
  assert.equal(r.params.get("focus.point.lat"), "39.14");
  assert.equal(r.params.get("boundary.country"), "US");
  assert.equal(r.params.get("layers"), "address,venue,street");
  assert.ok(Math.abs(Number(r.params.get("boundary.rect.max_lat")) - 39.14 - 0.36) < 0.01);
  assert.equal(r.params.get("boundary.circle.radius"), null, "autocomplete takes a box, not a circle");
});

test("autocomplete: 0 KV reads or writes a keystroke; the same prediction twice is one ORS call (memory cache)", async () => {
  const kv = countingKv();
  const env = envWith({ DOORS_KV: kv });
  for (const q of ["123", "123%20M", "123%20Ma", "123%20Mai", "123%20Main", "123%20main", "123%20Main"]) assert.equal((await call(env, `/api/geocode?kind=auto&q=${q}&${CINCY}`)).status, 200);
  assert.equal(kv.writes, 0, "no KV write");
  assert.equal(kv.reads, 0, "no KV read");
  assert.equal(env.ORS_FETCH.seen.length, 5, "'123 Main' and '123 main' share one answer");
  const again = await (await call(env, `/api/geocode?kind=auto&q=123%20Main&${CINCY}`)).json();
  assert.equal(again.cache, "hit");
});

test("autocomplete caps: per visitor per day, the site per minute, the daily ceiling; past any → resting, never ORS", async () => {
  assert.ok(ORS_CEILING.autocomplete < ORS_PLAN.autocomplete.day && AUTO_PER_MIN < ORS_PLAN.autocomplete.minute, "caps sit inside ORS's free plan");
  // the site per minute
  let env = envWith();
  let last;
  for (let i = 0; i <= AUTO_PER_MIN; i++) last = await (await call(env, `/api/geocode?kind=auto&q=${i}%20Main%20St&${CINCY}`)).json();
  assert.equal(env.ORS_FETCH.seen.length, AUTO_PER_MIN);
  assert.equal(last.resting, true);
  assert.equal(last.message, AUTO_RESTING);
  // one visitor a day (the ten-minute limit is lifted so the daily one shows)
  resetOrsLimiter();
  const saved = PER_IP.autocomplete;
  PER_IP.autocomplete = 1e6;
  try {
    let clock = Date.now();
    env = envWith({ ORS_NOW: () => (clock += 1000) }); // a second apart: the site's minute cap never bites
    for (let i = 0; i <= AUTO_PER_IP_DAY; i++) last = await (await call(env, `/api/geocode?kind=auto&q=${i}%20Oak%20St&${CINCY}`, { ipAddr: "10.7.7.7" })).json();
    assert.equal(env.ORS_FETCH.seen.length, AUTO_PER_IP_DAY);
    assert.equal(last.resting, true);
    assert.match(last.reason, /today/);
    // another visitor still gets predictions
    assert.equal((await (await call(env, `/api/geocode?kind=auto&q=Elm%20St&${CINCY}`, { ipAddr: "10.7.7.8" })).json()).source, "ors");
  } finally {
    PER_IP.autocomplete = saved;
  }
  // the site's daily ceiling
  resetOrsLimiter();
  env = envWith({ ORS_CEILING_AUTOCOMPLETE: "2" });
  await call(env, `/api/geocode?kind=auto&q=one%20st&${CINCY}`);
  await call(env, `/api/geocode?kind=auto&q=two%20st&${CINCY}`);
  last = await (await call(env, `/api/geocode?kind=auto&q=three%20st&${CINCY}`)).json();
  assert.equal(last.resting, true);
  assert.match(last.reason, /ceiling/);
  assert.equal(env.ORS_FETCH.seen.length, 2);
});

test("autocomplete: ORS failing, no key, or another site's page → resting or 403; a bad centre → 400", async () => {
  const quota = await (await call(envWith({ ORS_FETCH: fakeOrs({ status: 429 }) }), `/api/geocode?kind=auto&q=Vine%20St&${CINCY}`)).json();
  assert.equal(quota.resting, true);
  assert.equal(quota.message, AUTO_RESTING);
  assert.equal((await (await call(envWith({ ORS_API_KEY: undefined }), `/api/geocode?kind=auto&q=Vine%20St&${CINCY}`)).json()).resting, true);
  assert.equal((await call(envWith(), "/api/geocode?kind=auto&q=Vine%20St")).status, 400);
  assert.equal((await call(envWith(), "/api/geocode?kind=auto&q=Vine%20St&lat=99&lon=-84")).status, 400);
  assert.equal((await call(envWith(), "/api/geocode?kind=auto&q=Vi&lat=39&lon=-84")).status, 400, "3 characters at least");
  const cross = new Request(`https://doors.test/api/geocode?kind=auto&q=Vine%20St&${CINCY}`, { headers: { origin: "https://elsewhere.example", "sec-fetch-site": "cross-site" } });
  const env = envWith();
  assert.equal((await worker.fetch(cross, env, { waitUntil: () => {} })).status, 403);
  assert.equal(env.ORS_FETCH.seen.length, 0);
});

test("autocomplete: an address ORS lists twice (as an address and as a venue) shows once", async () => {
  const f = (label, lon) => ({ type: "Feature", geometry: { type: "Point", coordinates: [lon, 39.1] }, properties: { label } });
  const env = envWith({ ORS_FETCH: fakeOrs({ bodyFor: () => ({ features: [f("1 Vine Street, Cincinnati, OH, USA", -84.51), f("1 Vine Street, Cincinnati, OH, USA", -84.5101), f("Vine St, Cincinnati, OH, USA", -84.52)] }) }) });
  const b = await (await call(env, `/api/geocode?kind=auto&q=1%20Vine&${CINCY}`)).json();
  assert.deepEqual(b.results.map((r) => r.label), ["1 Vine Street, Cincinnati, OH, USA", "Vine St, Cincinnati, OH, USA"]);
});

// fix14 (Jard's iPhone, 2026-10-23): "Address search is resting" meant nothing to him. Say what happened and what to do,
// the same words on the web page and the phone.
test("fix14: address search off says why (a limit, or no lookup on this server) and what to do", async () => {
  const { readFileSync } = await import("node:fs");
  assert.doesNotMatch(AUTO_RESTING, /resting/i);
  assert.match(AUTO_RESTING, /limit/);
  assert.match(AUTO_RESTING, /pick a starting point|drop a pin/i);
  for (const f of ["public/ui/data.js", "app-mobile/src/data.ts"]) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
    assert.ok(!/Address search is resting/.test(src), f);
    assert.ok(src.includes(JSON.stringify(AUTO_RESTING)), `${f} says the Worker's words`);
  }
});

test("autocomplete (Jard 10-23 #13): 0 predictions for '57 La Belle Street' → one more try as 'LaBelle', ORS's spelling", async () => {
  const seen = [];
  const ORS_FETCH = async (u) => {
    const t = new URL(u).searchParams.get("text");
    seen.push(t);
    const features = /labelle/i.test(t) ? [{ type: "Feature", geometry: { type: "Point", coordinates: [-84.173185, 39.757093] }, properties: { label: "57 Labelle Street, Dayton, OH, USA" } }] : [];
    return Response.json({ features });
  };
  const env = envWith({ ORS_FETCH });
  const b = await (await call(env, `/api/geocode?kind=auto&q=57%20La%20Belle%20Street&lat=39.76&lon=-84.19`)).json();
  assert.deepEqual(seen, ["57 La Belle Street", "57 LaBelle Street"]);
  assert.equal(b.results[0].label, "57 Labelle Street, Dayton, OH, USA");
  // a hit the first time, or nothing to join, is one call
  seen.length = 0;
  await call(env, `/api/geocode?kind=auto&q=57%20Labelle%20St&lat=39.76&lon=-84.19`);
  await call(env, `/api/geocode?kind=auto&q=12%20Main%20St&lat=39.76&lon=-84.19`);
  assert.deepEqual(seen, ["57 Labelle St", "12 Main St"]);
});
