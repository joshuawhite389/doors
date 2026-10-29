// Worker routes in SAMPLE mode: no QLOO_API_KEY, no GEMINI_API_KEY, global fetch replaced with a tripwire.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import worker, { livePaused, budgetUsed, COST, DAILY_RUNS, RESTING, soundDoors, SOUND_MAX, SOUND_MIN_POP, DEFAULT_BUDGET } from "../src/worker.js";
import { LEDGER_BUDGET } from "../src/ledger.js";
import { readJson } from "./helpers.mjs";
import { liveCacheKey } from "../public/lib/live.js";

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

// review6: /api/route takes POST with JSON from the site's own page; the tests' /api/route?… requests become that
const asPost = (url, init = {}) => {
  const u = new URL(url);
  if (u.pathname !== "/api/route") return new Request(url, init);
  const headers = new Headers(init.headers);
  if (!headers.has("origin")) headers.set("origin", u.origin);
  if (!headers.has("content-type")) headers.set("content-type", "application/json");
  if (init.method === "POST") return new Request(u.origin + u.pathname, { ...init, headers });
  return new Request(u.origin + u.pathname, { method: "POST", headers, body: JSON.stringify(Object.fromEntries(u.searchParams)) });
};
const env = { ASSETS: { fetch: async () => new Response("asset") }, V1_ROUTES: "on" };
const ctx = { waitUntil: (p) => p };
let ip = 0;
const call = (path, init = {}) => {
  const headers = new Headers(init.headers);
  headers.set("cf-connecting-ip", `10.0.${Math.floor(++ip / 250)}.${ip % 250}`);
  return worker.fetch(asPost(`https://doors.test${path}`, { ...init, headers }), env, ctx);
};
async function events(res) {
  const text = await res.text(); // reads the NDJSON stream to the end
  return text.split("\n").filter(Boolean).map((l) => JSON.parse(l));
}
const UUID = "00000000-0000-4000-8000-3D216F124F58"; // Lost Grove Brewing (Boise), in the sample data

test("/api/health → sample data, template model", async () => {
  const res = await call("/api/health");
  assert.equal(res.status, 200);
  const b = await res.json();
  assert.equal(b.ok, true);
  assert.equal(b.data, "sample");
  assert.equal(b.model, "template");
  // the live object: SAMPLE has no key, so live calls are off and the reason says why
  assert.equal(typeof b.live, "object");
  assert.equal(b.live.ok, false);
  assert.match(b.live.reason, /SAMPLE/);
  assert.equal(b.live.used, null, "no key: no counter is read");
  assert.equal(b.live.budget, 34000); // 1,500 → 3,000 → 15,000 → 30,000 (round 3) → 34,000 (Oct 28 audit)
});

test("/api/search returns rows", async () => {
  const res = await call("/api/search?q=athletic&type=brand");
  assert.equal(res.status, 200);
  const b = await res.json();
  assert.ok(Array.isArray(b.rows) && b.rows.length > 0);
  assert.ok(b.rows.every((r) => r.id && r.name));
  assert.ok(b.rows.some((r) => /athletic/i.test(r.name)));
  assert.equal(b.mode.data, "sample");
});

test("/api/search type=place&city= returns the place's own record, kept to the city (Add a door)", async () => {
  const res = await call("/api/search?q=lost%20grove&type=place&city=boise");
  assert.equal(res.status, 200);
  const b = await res.json();
  assert.ok(b.rows.length >= 1);
  const r = b.rows[0];
  assert.equal(r.name, "Lost Grove Brewing");
  assert.ok(Number.isFinite(r.venue.lat) && Number.isFinite(r.venue.lon) && r.venue.hours && r.venue.address);
  const far = await (await call("/api/search?q=lost%20grove&type=place&city=austin")).json();
  assert.deepEqual(far.rows, [], "a Boise room is not an Austin door");
  assert.equal((await call("/api/search?q=lost&type=place&city=paris")).status, 400);
  assert.equal((await call("/api/search?q=lost&type=brand&city=boise")).status, 400);
});

// L1: Add a door in a live city: by its name, kept within reach of the centre the live run found
test("/api/search type=place&cityName=&lat=&lon= (a live city): 200; without the centre: 400", async () => {
  const ok = await call("/api/search?type=place&cityName=Boise%2C%20ID&lat=43.615&lon=-116.2023&q=lost%20grove");
  assert.equal(ok.status, 200);
  assert.ok(Array.isArray((await ok.json()).rows));
  assert.equal((await call("/api/search?type=place&cityName=Boise%2C%20ID&q=lost%20grove")).status, 400);
  assert.equal((await call("/api/search?type=brand&cityName=Boise&lat=43.6&lon=-116.2&q=lost%20grove")).status, 400);
});

test("bad input → 400", async () => {
  for (const path of [
    "/api/search?q=a&type=brand",
    "/api/search?q=athletic&type=nope",
    "/api/route?kind=brand&city=Boise",
    "/api/route?kind=wizard&name=Athletic&city=Boise",
    "/api/route?kind=brand&name=Athletic&city=!!", // review6: a city needs a letter or digit, in any script
    "/api/sisters?id=not-a-uuid&city=Boise",
    `/api/sisters?id=${UUID}`,
    `/api/door?id=${UUID}&kind=movie`,
    `/api/door?id=${UUID}&kind=podcast&age=99`,
    "/api/door?id=bad&kind=podcast",
  ]) {
    const res = await call(path);
    assert.equal(res.status, 400, path);
    assert.ok((await res.json()).error, path);
  }
  const bad = await call("/api/route", { method: "POST", body: "{not json", headers: { "content-type": "application/json" } });
  assert.equal(bad.status, 400);
  const two = await call("/api/route", { method: "POST", body: JSON.stringify({ kind: "proxy", city: "Boise", items: [{ id: UUID, name: "a" }, { id: UUID, name: "b" }] }) });
  assert.equal(two.status, 400);
});

test("POST /api/route (brand by name, Boise) streams every step, the route and done", async () => {
  const res = await call("/api/route?kind=brand&name=Athletic&city=Boise");
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type"), /ndjson/);
  const ev = await events(res);
  assert.equal(ev[0].type, "start");
  assert.equal(ev[0].mode.data, "sample");
  const steps = ev.filter((e) => e.type === "step").map((e) => e.id);
  for (const id of ["resolve", "plan", "pages", "filter", "hours", "sisters", "guard", "pitch"]) assert.ok(steps.includes(id), `step ${id}`);
  assert.ok(!ev.some((e) => e.type === "error"), JSON.stringify(ev.find((e) => e.type === "error")));
  const r = ev.find((e) => e.type === "route");
  assert.ok(r, "route event");
  assert.ok(Array.isArray(r.route.lists.all) && r.route.lists.all.length > 0);
  assert.ok(Object.keys(r.route.venues).length > 0);
  for (const [id] of r.route.lists.all) assert.ok(r.route.venues[id], `venue ${id} present`);
  assert.equal(r.route.kind, "brand");
  assert.ok(r.city.pitches && Object.keys(r.city.pitches).length > 0);
  for (const p of Object.values(r.city.pitches)) assert.equal(p.by, "template");
  for (const s of Object.values(r.city.sounds)) assert.equal(typeof s.guard.pass, "boolean");
  const last = ev.at(-1);
  assert.equal(last.type, "done");
  assert.equal(last.ok, true);
});

test("POST /api/route with three proxy ids → done", async () => {
  const proxies = Object.values(readJson("data/entities.json").proxies).slice(0, 3);
  assert.equal(proxies.length, 3);
  const items = proxies.map((p, i) => ({ id: p.chosen.id, name: p.chosen.name, weight: [3, 1, 5][i] }));
  const res = await call("/api/route", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "proxy", city: "Boise", items }) });
  assert.equal(res.status, 200);
  const ev = await events(res);
  assert.ok(!ev.some((e) => e.type === "error"), JSON.stringify(ev.find((e) => e.type === "error")));
  const r = ev.find((e) => e.type === "route");
  assert.equal(r.route.kind, "proxy");
  assert.equal(r.route.drinker.items.length, 3);
  assert.ok(r.route.lists.all.length > 0);
  assert.deepEqual(ev.at(-1), { ...ev.at(-1), type: "done", ok: true });
});

// N3: rooms that already pour you (any city), alone or with brands: one blended run, POSTed like a proxy
test("POST /api/route kind=pour: a room from another city plus a brand → one blended run, the room itself left out", async () => {
  const LACROIX = "00000000-0000-4000-8000-B46287EBA875";
  const items = [{ id: UUID, name: "Lost Grove Brewing", type: "place" }, { id: LACROIX, name: "LaCroix", type: "brand" }];
  const res = await call("/api/route", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "pour", city: "Boise", items }) });
  assert.equal(res.status, 200);
  const ev = await events(res);
  assert.ok(!ev.some((e) => e.type === "error"), JSON.stringify(ev.find((e) => e.type === "error")));
  const r = ev.find((e) => e.type === "route");
  assert.equal(r.route.kind, "pour");
  assert.equal(r.route.drinker.who, "LaCroix drinkers and regulars like those at Lost Grove Brewing");
  assert.deepEqual(r.route.drinker.items.map((x) => [x.type, x.weight]), [["place", 1], ["brand", 1]]);
  assert.ok(r.route.lists.all.length > 0);
  assert.ok(!r.route.venues[UUID] && !r.route.lists.all.some(([id]) => id === UUID), "the rep's own room is not a door");
  assert.match(ev.find((e) => e.id === "resolve").detail, /2 Qloo signals weighed alike/);
  assert.deepEqual(ev.at(-1), { ...ev.at(-1), type: "done", ok: true });
  // bad sets: no room, four rooms, four brands, a repeated id, a room without a name
  const room = (i) => ({ id: UUID.replace(/^6/, String(i)), name: `R${i}`, type: "place" });
  const brand = (i) => ({ id: LACROIX.replace(/^7/, String(i)), name: `B${i}`, type: "brand" });
  for (const bad of [[brand(1)], [room(1), room(2), room(3), room(4)], [room(1), brand(1), brand(2), brand(3), brand(4)], [room(1), room(1)], [{ id: UUID, type: "place" }]]) {
    const r400 = await call("/api/route", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "pour", city: "Boise", items: bad }) });
    assert.equal(r400.status, 400, JSON.stringify(bad));
  }
});

test("/api/search type=room: a bar or restaurant in any city, \"neighbourhood, city\" or its address", async () => {
  const res = await call("/api/search?q=lost%20grove&type=room");
  assert.equal(res.status, 200);
  const { rows } = await res.json();
  assert.ok(rows.length >= 1);
  assert.equal(rows[0].id, UUID);
  assert.ok(rows[0].where);
  assert.deepEqual(Object.keys(rows[0]).sort(), ["id", "name", "where"]);
});

test("/api/sisters → ids array", async () => {
  const res = await call(`/api/sisters?id=${UUID}&city=Boise`);
  assert.equal(res.status, 200);
  const b = await res.json();
  assert.ok(Array.isArray(b.ids) && b.ids.length > 0);
  for (const [id, aff] of b.ids) {
    assert.ok(typeof id === "string" && b.records[id]);
    assert.ok(aff === null || typeof aff === "number");
  }
});

test("/api/door?kind=podcast → items", async () => {
  const res = await call(`/api/door?id=${UUID}&kind=podcast`);
  assert.equal(res.status, 200);
  const b = await res.json();
  assert.ok(Array.isArray(b.items) && b.items.length > 0);
  assert.ok(b.items.every((x) => x.name));
  assert.match(b.label, /podcasts/);
  assert.equal(b.age, "all");
});

test("unknown /api/x → 404; non-api path → asset", async () => {
  const res = await call("/api/x");
  assert.equal(res.status, 404);
  const asset = await call("/index.html");
  assert.equal(await asset.text(), "asset");
  assert.equal(await (await call("/")).text(), "asset");
});

// ---------- the build's own call budget (M2 ruling, enforced in the Worker; 34,000 calls since the Oct 28 audit (30,000 from round 3, (15,000 from the ruling of Oct 21)) ----------
const ASSETS = env.ASSETS;
const tripwire = async (u) => {
  throw new Error(`Qloo fetch attempted while the budget is spent: ${u}`);
};

test("livePaused: SAMPLE reason without a key; budget reason at 33990 used; null at 100 used", async () => {
  assert.match(await livePaused(env, COST.route), /SAMPLE/);
  const spent = { QLOO_API_KEY: "x", LEDGER_COUNT: async () => 33990, ASSETS, QLOO_FETCH: tripwire };
  const why = await livePaused(spent, 26);
  assert.equal(typeof why, "string");
  assert.match(why, /budget/);
  assert.match(why, /33990 of 34000/);
  assert.equal(await livePaused(spent, 10), null, "33990 + 10 is exactly the budget: still allowed");
  assert.equal(await livePaused({ QLOO_API_KEY: "x", LEDGER_COUNT: async () => 100, ASSETS }, 26), null);
  assert.match(await livePaused({ QLOO_API_KEY: "x", LEDGER_COUNT: async () => 100, BUILD_BUDGET: "120", ASSETS }, 26), /budget/, "BUILD_BUDGET overrides 34000");
});

test("a spent budget answers 503 paused on every live endpoint without calling Qloo", async () => {
  let qlooCalls = 0;
  const spent = {
    QLOO_API_KEY: "x",
    LEDGER_COUNT: async () => 33990,
    ASSETS,
    V1_ROUTES: "on",
    QLOO_FETCH: async (u) => {
      qlooCalls++;
      return tripwire(u);
    },
  };
  const go = (path) => worker.fetch(asPost(`https://doors.test${path}`, { headers: { "cf-connecting-ip": `198.51.100.${++ip % 250}` } }), spent, ctx);
  // (single-letter name/city fail validation with 400 before the budget check, so use two letters)
  const res = await go("/api/route?kind=brand&name=Xx&city=Yy");
  assert.equal(res.status, 503);
  const b = await res.json();
  assert.equal(b.paused, true);
  assert.equal(b.resting, true, "a new run rests: never an error page");
  // search (cost 1) still fits 33990 + 1, so make the ledger full for the cheap endpoints
  const full = { ...spent, LEDGER_COUNT: async () => 34000 };
  const goFull = (path) => worker.fetch(asPost(`https://doors.test${path}`, { headers: { "cf-connecting-ip": `198.51.100.${++ip % 250}` } }), full, ctx);
  for (const path of ["/api/search?q=athletic&type=brand", `/api/sisters?id=${UUID}&city=Boise`, `/api/door?id=${UUID}&kind=podcast`]) {
    const r = await goFull(path);
    assert.equal(r.status, 503, path);
    assert.equal((await r.json()).paused, true, path);
  }
  assert.equal(qlooCalls, 0, "QLOO_FETCH never called");
  // /api/health reports the pause
  const h = await (await go("/api/health")).json();
  assert.equal(h.data, "live");
  assert.deepEqual(h.live, { ok: false, reason: await livePaused(spent, COST.route), used: 33990, budget: 34000 });
  const fine = await (await worker.fetch(asPost("https://doors.test/api/health"), { QLOO_API_KEY: "x", LEDGER_COUNT: async () => 100, ASSETS }, ctx)).json();
  assert.deepEqual(fine.live, { ok: true, reason: null, used: 100, budget: 34000 });
});

// L1: judging can't drain the budget. A visitor starts at most DAILY_RUNS new live runs a day (KV);
// saved runs are free and never limited.
// KV with metadata and list() (the saved runs are a list of the runs' keys and their metadata)
const kvMap = () => {
  const store = new Map();
  const meta = new Map();
  return {
    store, meta,
    get: async (k, t) => (store.has(k) ? (t === "json" ? JSON.parse(store.get(k)) : store.get(k)) : null),
    put: async (k, v, o = {}) => void (store.set(k, v), o.metadata ? meta.set(k, o.metadata) : meta.delete(k)),
    list: async ({ prefix = "" } = {}) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name, metadata: meta.get(name) })), list_complete: true }),
  };
};
test("a visitor's new live runs are capped per day, with a plain message; saved runs still open", async () => {
  assert.equal(DAILY_RUNS, 5);
  const DOORS_KV = kvMap();
  const kvEnv = { ASSETS: env.ASSETS, DOORS_KV };
  const go = (city) => worker.fetch(asPost(`https://doors.test/api/route?kind=brand&name=Athletic&city=${city}`, { headers: { "cf-connecting-ip": "192.0.2.77" } }), kvEnv, ctx);
  for (const city of ["Boise 1", "Boise 2", "Boise 3", "Boise 4", "Boise 5"]) {
    const r = await go(city);
    assert.equal(r.status, 200, city);
    await events(r);
  }
  const sixth = await go("Boise 6");
  assert.equal(sixth.status, 429);
  const b = await sixth.json();
  assert.equal(b.daily, true);
  assert.equal(b.message, RESTING, "the same plain message, never an error");
  assert.equal(b.error, undefined);
  // a run already saved (any visitor's) is not a new run: no limit
  const again = await go("boise 1");
  assert.equal(again.status, 200);
  assert.equal(again.headers.get("x-doors-cache"), "hit");
  // another visitor is not affected
  const other = await worker.fetch(asPost("https://doors.test/api/route?kind=brand&name=Athletic&city=Boise%207", { headers: { "cf-connecting-ip": "192.0.2.78" } }), kvEnv, ctx);
  assert.equal(other.status, 200);
  await events(other);
});

// Near the end of the budget (less than two runs' worth left, or Qloo's month low) a new run never errors: it answers
// "resting" with the saved runs to offer; a saved run still opens
test("near the budget's end: new runs rest (no error), saved runs still open, /api/runs lists them", async () => {
  const DOORS_KV = kvMap();
  // a run made earlier in live mode (its files as SAMPLE's agent writes them)
  const sample = await events(await worker.fetch(asPost("https://doors.test/api/route?kind=brand&name=Athletic&city=Boise", { headers: { "cf-connecting-ip": "192.0.2.90" } }), { ASSETS: env.ASSETS, DOORS_KV }, ctx));
  const got = sample.find((e) => e.type === "route");
  await DOORS_KV.put(`route:v2:live:${liveCacheKey({ kind: "brand", name: "Athletic", city: "Boise" })}`, JSON.stringify({ route: got.route, city: got.city, at: "2026-10-21" }));
  // (the saved-runs list is written by new runs only, never on a cache hit: review6)
  // (its saved-runs entry is the value's metadata, written with it: the pre-publish audit, the KV free plan)
  DOORS_KV.meta.set(`route:v2:live:${liveCacheKey({ kind: "brand", name: "Athletic", city: "Boise" })}`, { kind: "brand", id: got.route.drinker.id, name: got.route.drinker.name, cityName: "Boise", at: "2026-10-21" });
  let qlooCalls = 0;
  const low = { ASSETS: env.ASSETS, DOORS_KV, QLOO_API_KEY: "x", LEDGER_COUNT: async () => 34000 - 2 * COST.route + 1, QLOO_FETCH: async (u) => { qlooCalls++; return tripwire(u); } };
  // the saved run opens free, budget or not
  const open = await worker.fetch(asPost("https://doors.test/api/route?kind=brand&name=Athletic&city=boise", { headers: { "cf-connecting-ip": "192.0.2.91" } }), low, ctx);
  assert.equal(open.headers.get("x-doors-cache"), "hit");
  assert.ok((await events(open)).some((e) => e.type === "route"));
  // SAMPLE's own runs never show among live ones
  assert.deepEqual((await (await worker.fetch(asPost("https://doors.test/api/runs"), { ASSETS: env.ASSETS, DOORS_KV }, ctx)).json()).runs.map((r) => r.cityName), ["Boise"]);
  const res = await worker.fetch(asPost("https://doors.test/api/route?kind=brand&name=Athletic&city=Denver", { headers: { "cf-connecting-ip": "192.0.2.91" } }), low, ctx);
  assert.equal(res.status, 503);
  const b = await res.json();
  assert.equal(b.resting, true);
  assert.equal(b.message, RESTING);
  assert.equal(RESTING, "New plans are off for today: the daily limit is used. Try one of the examples, or a brand and city someone has already run.");
  assert.equal(b.error, undefined, "not an error");
  assert.deepEqual(b.runs.map((r) => [r.name, r.cityName]), [["Athletic Brewing Co", "Boise"]]);
  assert.equal(qlooCalls, 0);
  // /api/runs: the saved runs, newest first (what the page offers)
  const list = await (await worker.fetch(asPost("https://doors.test/api/runs"), low, ctx)).json();
  assert.deepEqual(list.runs.map((r) => r.cityName), ["Boise"]);
  assert.ok(list.runs[0].id && list.runs[0].kind === "brand");
  // two runs' worth left: still live
  assert.equal(await livePaused({ ...low, LEDGER_COUNT: async () => 34000 - 2 * COST.route }, 2 * COST.route), null);
});

// the pre-publish audit (KV free plan): the month's calls live in one counter value, count:<YYYY-MM> (src/kvbook.js)
test("budgetUsed reads the KV counter seeded at publish; no counter means live calls are refused", async () => {
  const { _resetBook } = await import("../src/kvbook.js");
  const store = new Map([["count:2026-10", JSON.stringify({ calls: 1307 })], ["count:2027-01", JSON.stringify({ calls: 7, day: "2027-01-02", runs: 1 })]]);
  const DOORS_KV = { get: async (k, t) => (store.has(k) ? (t === "json" ? JSON.parse(store.get(k)) : store.get(k)) : null), put: async (k, v) => void store.set(k, v) };
  const at = async (TODAY) => (_resetBook(), budgetUsed({ DOORS_KV, TODAY }));
  assert.equal(await at("2026-10-21"), 1307, "the seeded counter already includes the precompute");
  assert.equal(await at("2027-01-05"), 7);
  assert.equal(await at("2026-11-02"), 0);
  _resetBook();
  // a failing KV counts as a spent budget
  const broken = { get: async () => { throw new Error("kv down"); }, put: async () => {} };
  assert.equal(await budgetUsed({ DOORS_KV: broken }, "2026-10"), Infinity);
  // no KV and no dev ledger: null, and livePaused refuses rather than leaving calls uncounted
  assert.equal(await budgetUsed({}, "2026-10"), null);
  assert.match(await livePaused({ QLOO_API_KEY: "x" }, COST.route), /no call counter/);
  // the dev ledger hook wins over KV
  assert.equal(await budgetUsed({ DOORS_KV, LEDGER_COUNT: async (m) => (m === "2026-10" ? 999 : 0) }, "2026-10"), 999);
});


// L1: /api/route is v2's live agent now; v1's lazy sisters and door extras stay off unless V1_ROUTES=on
test("/api/route is on in v2; v1's /api/sisters and /api/door stay off unless V1_ROUTES=on", async () => {
  const off = { ASSETS: env.ASSETS };
  for (const path of [`/api/sisters?id=${UUID}&city=Boise`, `/api/door?id=${UUID}&kind=podcast`]) {
    const r = await worker.fetch(asPost(`https://doors.test${path}`), off, ctx);
    assert.equal(r.status, 410, path);
  }
  const r = await worker.fetch(asPost("https://doors.test/api/route?kind=brand&name=Athletic&city=Boise", { headers: { "cf-connecting-ip": "192.0.2.10" } }), off, ctx);
  assert.equal(r.status, 200);
  assert.ok((await events(r)).some((e) => e.type === "route"));
});

// L1: a run is kept in KV by (kind, drinker, city as typed in any case): the same run again streams the saved files
// with no Qloo call, the per-visitor limit untouched
test("a repeat run is served from KV: same files, 0 Qloo calls, any spelling of the city", async () => {
  const store = new Map();
  const DOORS_KV = { get: async (k, t) => (store.has(k) ? (t === "json" ? JSON.parse(store.get(k)) : store.get(k)) : null), put: async (k, v) => void store.set(k, v) };
  const kvEnv = { ASSETS: env.ASSETS, DOORS_KV };
  const go = (path) => worker.fetch(asPost(`https://doors.test${path}`, { headers: { "cf-connecting-ip": "192.0.2.20" } }), kvEnv, ctx);
  const first = await go("/api/route?kind=brand&name=Athletic&city=Boise");
  assert.equal(first.headers.get("x-doors-cache"), "miss");
  const a = await events(first);
  assert.equal(a.find((e) => e.type === "done").cached, undefined, "the first run asked Qloo");
  await new Promise((r) => setTimeout(r, 0));
  assert.ok([...store.keys()].some((k) => k.startsWith("route:")), "saved in KV");
  const again = await go("/api/route?kind=brand&name=athletic&city=%20boise%20");
  assert.equal(again.headers.get("x-doors-cache"), "hit");
  const b = await events(again);
  assert.deepEqual(b.find((e) => e.type === "route").route, a.find((e) => e.type === "route").route);
  assert.deepEqual(b.find((e) => e.type === "done"), { ...b.find((e) => e.type === "done"), ok: true, calls: 0, cached: true });
  assert.ok(b.some((e) => e.type === "step" && e.id === "cache"));
});

// L1: Qloo answers 400 (and still counts the call) for the sound of rooms it knows little about, mostly the quietest
// ones (popularity 0.05, 0.12 in the real runs). A run asks the sound of at most SOUND_MAX route rooms, none under
// SOUND_MIN_POP; the rest show the city's sound, labelled, as a failed lookup did.
test("room sounds: at most SOUND_MAX route rooms, none under SOUND_MIN_POP popularity, route order kept", () => {
  assert.equal(SOUND_MAX, 12); // qloofull: was 8
  assert.equal(SOUND_MIN_POP, 0.2);
  const doors = [0.9, 0.12, 0.8, 0.05, 0.7, 0.6, null, 0.5, 0.45, 0.4, 0.35, 0.3, 0.33, 0.31, 0.3, 0.29].map((popularity, i) => ({ id: `d${i}`, popularity }));
  assert.deepEqual(soundDoors(doors).map((v) => v.id), ["d0", "d2", "d4", "d5", "d6", "d7", "d8", "d9", "d10", "d11", "d12", "d13"]);
});

// Dev only: the local jobs share one loopback "visitor"; scripts/dev.mjs sets DEV_UNLIMITED_LOCAL so its per-visitor
// cap is off there. On Cloudflare (cf-connecting-ip present) or without the flag the cap holds.
test("dev's loopback visitor has no per-visitor run cap; a real visitor, or no flag, still stops at DAILY_RUNS", async () => {
  const run = async (kvEnv, headers, n) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      const r = await worker.fetch(asPost(`https://doors.test/api/route?kind=brand&name=Athletic&city=Boise%20${headers ? "r" : "l"}${i}`, { headers: headers ?? {} }), kvEnv, ctx);
      out.push(r.status);
      if (r.status === 200) await events(r);
      else await r.json();
    }
    return out;
  };
  const dev = { ASSETS: env.ASSETS, DOORS_KV: kvMap(), DEV_UNLIMITED_LOCAL: "1" };
  assert.deepEqual(await run(dev, null, DAILY_RUNS + 2), Array(DAILY_RUNS + 2).fill(200), "loopback in dev");
  const real = await run({ ...dev, DOORS_KV: kvMap() }, { "cf-connecting-ip": "192.0.2.90" }, DAILY_RUNS + 1);
  assert.equal(real.at(-1), 429, "a real visitor in dev keeps the cap");
  const prod = await run({ ASSETS: env.ASSETS, DOORS_KV: kvMap() }, null, DAILY_RUNS + 1);
  assert.equal(prod.at(-1), 429, "no flag (production): loopback is capped like anyone");
});

// round 3 (gigbot 10-25): the Worker's live gate and the dev ledger are one budget; enrich raised the ledger to 34,000
// and the Worker stayed at 15,000, so /api/health said 15,000 and live plans would have stopped ~1,700 calls early
test("the Worker's DEFAULT_BUDGET is the ledger's LEDGER_BUDGET (34,000 since the Oct 28 audit)", () => {
  assert.equal(DEFAULT_BUDGET, LEDGER_BUDGET);
  assert.equal(DEFAULT_BUDGET, 34000);
});
