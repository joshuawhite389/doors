// review6: one visitor must not be able to push the site into "resting" for the judges, or spend the budget from
// another site. The pre-publish audit: on the Workers free plan KV takes 1,000 writes a day for the whole site, so a new run
// writes KV at most twice, a saved run and a search never. Stubbed Qloo and KV only: no network, no live call.
import { test, beforeEach } from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import worker, { COST, DAILY_RUNS, SEARCH_DAILY, RESTING, _inflight, _resetRuns } from "../src/worker.js";
import { ipKey, visitorKey, daysLeft, dailyCeiling, INFLIGHT_MAX } from "../src/guard.js";
import { _resetBook, KV_DAILY_WRITES, KV_WRITE_HEADROOM, ORS_WRITE_HEADROOM } from "../src/kvbook.js";
import { resetOrsLimiter } from "../src/ors.js";
import { liveCacheKey, normCity } from "../public/lib/live.js";

const ASSETS = { fetch: async () => new Response("asset") };
const ctx = { waitUntil: (p) => p };
const DAY = "2026-11-10";
const COUNT = "count:2026-11";
// each test starts with no run in flight (a cancelled stream's run still finishes in the background) and a clean book
beforeEach(async () => {
  for (let i = 0; i < 400 && _inflight() > 0; i++) await new Promise((r) => setTimeout(r, 10));
  _resetBook();
  _resetRuns();
  resetOrsLimiter();
});

// KV with a little latency (so concurrent requests interleave, as on Cloudflare), metadata and list(), that records
// every write
function kv({ delay = 0, failPut = false, failGet = false } = {}) {
  const store = new Map();
  const meta = new Map();
  const puts = [];
  const wait = () => new Promise((r) => setTimeout(r, delay));
  return {
    store, meta, puts,
    async get(k, t) { await wait(); if (failGet) throw new Error("kv down"); const v = store.get(k); return v == null ? null : t === "json" ? JSON.parse(v) : v; },
    async put(k, v, o = {}) { await wait(); if (failPut) throw new Error("kv down"); puts.push(k); store.set(k, typeof v === "string" ? v : JSON.stringify(v)); if (o.metadata) meta.set(k, o.metadata); },
    async list({ prefix = "" } = {}) { await wait(); return { keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name, metadata: meta.get(name) })), list_complete: true }; },
  };
}
// a Qloo stand-in: empty answers (a brand it doesn't know, a city with no rooms), counting calls
function qloo() {
  const f = async () => { f.n++; return new Response(JSON.stringify({ success: true, results: { entities: [] } }), { headers: { "content-type": "application/json" } }); };
  f.n = 0;
  return f;
}
const run = (env, body, { ip = "198.51.100.1", origin = "https://doors.test", type = "application/json", method = "POST" } = {}) =>
  worker.fetch(new Request("https://doors.test/api/route", { method, headers: { "cf-connecting-ip": ip, ...(origin ? { origin } : {}), "content-type": type }, body: method === "POST" ? JSON.stringify(body) : undefined }), env, ctx);
const read = async (r) => (await r.text()).split("\n").filter(Boolean).map((l) => JSON.parse(l));
const settled = () => new Promise((r) => setTimeout(r, 0));
const counter = (env) => JSON.parse(env.DOORS_KV.store.get(COUNT) ?? "null");
// the counter's key for a visitor: never the address, a salted one-way hash of it for the day
const seen = async (env, ip) => counter(env).ips[await visitorKey(env, ipKey(ip), DAY)] ?? 0;
const sampleEnv = (over = {}) => ({ ASSETS, DOORS_KV: kv(), TODAY: DAY, ...over });
const liveEnv = (over = {}) => ({ ASSETS, DOORS_KV: kv(), TODAY: DAY, QLOO_API_KEY: "x", QLOO_FETCH: qloo(), LEDGER_COUNT: async () => 0, ...over });

test("KV writes: a new run ≤ 2 (its value with the saved-runs entry as metadata, and the counter once); a saved run 0", async () => {
  const env = sampleEnv();
  const r = await run(env, { kind: "brand", name: "Athletic", city: "boise, idaho" });
  assert.ok((await read(r)).some((e) => e.type === "done"));
  await settled();
  const runKey = `route:v2:sample:${liveCacheKey({ kind: "brand", name: "Athletic", city: "boise, idaho" })}`;
  assert.deepEqual(env.DOORS_KV.puts.sort(), [COUNT, runKey].sort(), "two writes");
  assert.deepEqual(Object.keys(env.DOORS_KV.meta.get(runKey)).sort(), ["at", "cityName", "id", "kind", "name"]);
  assert.equal(env.DOORS_KV.meta.get(runKey).cityName, "Boise", "Qloo's name for the city, never the visitor's text");
  assert.equal(counter(env).writes, 2, "the day's write tally counts both");
  // the same run again, typed another way: a saved run, no write
  const before = env.DOORS_KV.puts.length;
  const hit = await run(env, { kind: "brand", name: "Athletic", city: "  Boise, Idaho " });
  assert.equal(hit.headers.get("x-doors-cache"), "hit");
  await read(hit);
  assert.equal(env.DOORS_KV.puts.length, before, "0 writes");
});

test("KV writes: a search 0 (its call carried into the counter at the next run's settle); ORS: a geocode 0, a matrix 1 while the day allows", async () => {
  const env = liveEnv({ ORS_API_KEY: "k", ORS_FETCH: async (u) => Response.json(new URL(u).pathname.includes("matrix") ? { durations: [[0, 60], [60, 0]], distances: [[0, 1000], [1000, 0]] } : { features: [] }) });
  for (let i = 0; i < 3; i++) assert.equal((await worker.fetch(new Request("https://doors.test/api/search?type=brand&q=guinness", { headers: { "cf-connecting-ip": "203.0.113.30" } }), env, ctx)).status, 200);
  assert.equal(env.DOORS_KV.puts.length, 0, "searches write nothing");
  await worker.fetch(new Request("https://doors.test/api/geocode?q=state%20street&city=chicago", { headers: { "cf-connecting-ip": "203.0.113.30" } }), env, ctx);
  assert.equal(env.DOORS_KV.puts.length, 0, "a geocode writes nothing");
  const matrix = () => worker.fetch(new Request("https://doors.test/api/matrix", { method: "POST", headers: { "cf-connecting-ip": "203.0.113.30", "content-type": "application/json" }, body: JSON.stringify({ coords: [[-87.63, 41.88], [-87.65, 41.89]] }) }), env, ctx);
  await matrix();
  assert.equal(env.DOORS_KV.puts.filter((k) => k.startsWith("ors:")).length, 1, "a matrix is cached once");
  // the next run's settle carries the 3 searches' calls and the matrix's write
  await read(await run(env, { kind: "brand", name: "Nobody", city: "Denver" }, { ip: "203.0.113.31" }));
  await settled();
  const c = counter(env);
  assert.ok(c.calls >= 3 + 1, `calls ${c.calls}`);
  assert.equal(c.writes, 1 + 1, "the matrix's write and the counter's own");
  // past KV_DAILY_WRITES - ORS_WRITE_HEADROOM today, the ORS cache stops writing
  env.DOORS_KV.store.set(COUNT, JSON.stringify({ ...c, writes: KV_DAILY_WRITES - ORS_WRITE_HEADROOM }));
  _resetBook();
  const n = env.DOORS_KV.puts.length;
  await worker.fetch(new Request("https://doors.test/api/matrix", { method: "POST", headers: { "cf-connecting-ip": "203.0.113.32", "content-type": "application/json" }, body: JSON.stringify({ coords: [[-87.6, 41.8], [-87.7, 41.9]] }) }), env, ctx);
  assert.equal(env.DOORS_KV.puts.length, n);
});

test("KV writes in the resting trigger: at KV_DAILY_WRITES - KV_WRITE_HEADROOM today new runs rest; saved runs still open with 0 writes", async () => {
  assert.deepEqual([KV_DAILY_WRITES, KV_WRITE_HEADROOM], [1000, 200]);
  const env = sampleEnv();
  await read(await run(env, { kind: "brand", name: "Athletic", city: "Boise" }));
  await settled();
  env.DOORS_KV.store.set(COUNT, JSON.stringify({ ...counter(env), writes: 800 }));
  _resetBook();
  const r = await run(env, { kind: "brand", name: "Athletic", city: "Denver" }, { ip: "203.0.113.40" });
  assert.equal(r.status, 429);
  const b = await r.json();
  assert.deepEqual([b.resting, b.message, b.writes], [true, RESTING, 800]);
  const n = env.DOORS_KV.puts.length;
  const hit = await run(env, { kind: "brand", name: "Athletic", city: "Boise" }, { ip: "203.0.113.40" });
  assert.equal(hit.headers.get("x-doors-cache"), "hit");
  await read(hit);
  assert.equal(env.DOORS_KV.puts.length, n);
});

test("findings 1, 3: twenty concurrent new runs from one visitor: at most INFLIGHT_MAX start, the rest rest", async () => {
  const env = sampleEnv({ DOORS_KV: kv({ delay: 5 }) });
  const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => run(env, { kind: "brand", name: "Athletic", city: `Nowhere ${i}` })));
  const started = rs.filter((r) => r.status === 200).length;
  assert.ok(started <= INFLIGHT_MAX, `${started} started`);
  for (const r of rs.filter((x) => x.status !== 200)) assert.equal((await r.json()).message, RESTING);
  await Promise.all(rs.map((r) => r.body?.cancel?.().catch(() => {})));
});

test("finding 1: a visitor's day: 5 new runs (the ones in flight held in memory), then rest", async () => {
  const env = sampleEnv({ DOORS_KV: kv({ delay: 5 }) });
  const statuses = [];
  // in pairs (INFLIGHT_MAX) so the daily cap, not the in-flight limit, is what stops the sixth
  for (let i = 0; i < 4; i++) {
    const rs = await Promise.all([0, 1].map((j) => run(env, { kind: "brand", name: "Athletic", city: `Boise ${i}-${j}` })));
    for (const r of rs) (statuses.push(r.status), await read(r));
  }
  assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429, 429, 429]);
  await settled();
  assert.equal(await seen(env, "198.51.100.1"), DAILY_RUNS);
});

test("finding 1a: the site's own daily ceiling, from what's left of the budget over the days left to Nov 16", async () => {
  assert.equal(daysLeft("2026-11-10"), 7);
  assert.equal(daysLeft("2026-11-16"), 1);
  assert.equal(daysLeft("2026-11-20"), 11, "after judging: the days left in the month");
  assert.equal(dailyCeiling({ budget: 15000, used: 1405, cost: 26, day: "2026-10-21" }), 19);
  assert.equal(dailyCeiling({ budget: 3000, used: 2990, cost: 26, day: "2026-10-21" }), 1, "at least one");
  // today's site-wide count at the ceiling: a new visitor's new run rests, nothing written, Qloo never asked
  const env = liveEnv({ BUILD_BUDGET: "1000", LEDGER_COUNT: async () => 1000 - 3 * COST.route }); // 3 runs left, 7 days → 1 a day
  env.DOORS_KV.store.set(COUNT, JSON.stringify({ calls: 0, day: DAY, runs: 1, writes: 2, ips: {} }));
  const r = await run(env, { kind: "brand", name: "Athletic", city: "Denver" }, { ip: "203.0.113.9" });
  assert.equal(r.status, 429);
  const b = await r.json();
  assert.deepEqual([b.resting, b.ceiling, b.message], [true, 1, RESTING]);
  assert.equal(env.QLOO_FETCH.n, 0);
  assert.equal(env.DOORS_KV.puts.length, 0);
});

test("finding 1d: a counter that can't be read rests the run (never uncounted); a run's calls are written once, at its end", async () => {
  const down = liveEnv({ DOORS_KV: kv({ failGet: true }), LEDGER_COUNT: undefined });
  const d = await run(down, { kind: "brand", name: "Athletic", city: "Denver" });
  assert.equal(d.status, 503);
  assert.equal((await d.json()).message, RESTING);
  assert.equal(down.QLOO_FETCH.n, 0);
  const env = liveEnv();
  await read(await run(env, { kind: "brand", name: "Nobody at all", city: "Denver" }, { ip: "198.51.100.61" }));
  await settled();
  assert.deepEqual(env.DOORS_KV.puts, [COUNT], "one write: the counter (the run failed, so no value)");
  assert.equal(counter(env).calls, env.QLOO_FETCH.n);
});

test("finding 2: IPv6 visitors are counted by their /64", async () => {
  assert.equal(ipKey("2001:db8:abcd:12::1"), "2001:db8:abcd:12::/64");
  assert.equal(ipKey("2001:0db8:abcd:0012:ffff:0:0:9"), "2001:db8:abcd:12::/64");
  assert.equal(ipKey("203.0.113.5"), "203.0.113.5");
  const env = sampleEnv();
  const statuses = [];
  for (let i = 1; i <= 6; i++) {
    const r = await run(env, { kind: "brand", name: "Athletic", city: `V6 ${i}` }, { ip: `2001:db8:1:2::${i.toString(16)}` });
    statuses.push(r.status);
    await read(r);
  }
  assert.deepEqual(statuses, [200, 200, 200, 200, 200, 429]);
  const other = await run(env, { kind: "brand", name: "Athletic", city: "V6 other" }, { ip: "2001:db8:1:3::1" });
  assert.equal(other.status, 200);
  await read(other);
});

test("the run counter stores no IP address: a salted one-way hash of it (/64 for IPv6), new each day", async () => {
  const env = sampleEnv({ IP_SALT: "salt-a" });
  for (const [ip, city] of [["198.51.100.60", "Boise H1"], ["2001:db8:9:9::1", "Boise H2"]]) await read(await run(env, { kind: "brand", name: "Athletic", city }, { ip }));
  await settled();
  const stored = env.DOORS_KV.store.get(COUNT);
  for (const raw of ["198.51.100.60", "2001:db8:9:9", "/64"]) assert.ok(!stored.includes(raw), `${raw} is not in the counter`);
  const keys = Object.keys(counter(env).ips);
  assert.equal(keys.length, 2);
  for (const k of keys) assert.match(k, /^v1:[A-Za-z0-9_-]{22}$/);
  assert.equal(await seen(env, "198.51.100.60"), 1);
  assert.equal(await seen(env, "2001:db8:9:9::abcd"), 1, "the same /64 is the same visitor");
  // one way, salted, per day: another salt or another day gives another key; the fallbacks are stated
  const k = (e, day = DAY, ip = "198.51.100.60") => visitorKey(e, ipKey(ip), day);
  assert.equal(await k({ IP_SALT: "salt-a" }), await k({ IP_SALT: "salt-a" }));
  assert.notEqual(await k({ IP_SALT: "salt-a" }), await k({ IP_SALT: "salt-b" }));
  assert.notEqual(await k({ IP_SALT: "salt-a" }), await k({ IP_SALT: "salt-a" }, "2026-11-11"));
  assert.notEqual(await k({ QLOO_API_KEY: "q1" }), await k({ QLOO_API_KEY: "q2" }), "no IP_SALT: a salt from the Qloo key secret");
  assert.notEqual(await k({}), await k({}, DAY, "198.51.100.61"), "dev: a fixed salt, still per address");
});

test("finding 4: a run that fails before spending (no such brand) doesn't use the visitor's day; Try again isn't charged twice", async () => {
  const env = liveEnv();
  for (let i = 0; i < DAILY_RUNS + 2; i++) {
    const r = await run(env, { kind: "brand", name: `Typo${i}`, city: "Denver" }, { ip: "198.51.100.4" });
    assert.equal(r.status, 200, `run ${i + 1}`);
    assert.ok((await read(r)).some((e) => e.type === "error"));
  }
  await settled();
  const c = counter(env);
  assert.deepEqual([c.runs, await seen(env, "198.51.100.4")], [0, 0]);
  assert.equal(c.calls, env.QLOO_FETCH.n, "their calls still count in the budget");
});

test("finding 5: searches: a daily cap per visitor (/64), each counted in the budget, no KV write", async () => {
  const env = liveEnv();
  // (a query no other test asks: the isolate keeps Qloo's answers, which would cost no call)
  const go = (ip) => worker.fetch(new Request("https://doors.test/api/search?type=brand&q=irish%20stout%20cap", { headers: { "cf-connecting-ip": ip } }), env, ctx);
  let last;
  for (let i = 0; i <= SEARCH_DAILY; i++) last = await go(`2001:db8:9:9::${(i + 1).toString(16)}`);
  assert.equal(last.status, 429, "the 41st from one /64");
  assert.ok(env.QLOO_FETCH.n >= 1, "asked Qloo (repeats come from the isolate's cache)");
  assert.equal(env.DOORS_KV.puts.length, 0);
  assert.equal((await go("198.51.100.200")).status, 200, "another visitor");
});

test("finding 9: POST with JSON, from this site only (runs and searches)", async () => {
  const env = sampleEnv();
  assert.equal((await run(env, {}, { ip: "198.51.100.9", method: "GET" })).status, 405);
  assert.equal((await run(env, { kind: "brand", name: "Athletic", city: "Boise" }, { ip: "198.51.100.9", type: "text/plain" })).status, 415);
  assert.equal((await run(env, { kind: "brand", name: "Athletic", city: "Boise" }, { ip: "198.51.100.9", origin: "https://evil.example" })).status, 403);
  assert.equal((await run(env, { kind: "brand", name: "Athletic", city: "Boise" }, { ip: "198.51.100.9", origin: null })).status, 403, "no Origin on a POST");
  const dev = await run(env, { kind: "brand", name: "Athletic", city: "Boise" }, { ip: "198.51.100.9", origin: "http://127.0.0.1:8797" });
  assert.equal(dev.status, 200, "the local dev server");
  await read(dev);
  const search = (h) => worker.fetch(new Request("https://doors.test/api/search?type=brand&q=athletic", { headers: { "cf-connecting-ip": "198.51.100.77", ...h } }), env, ctx);
  assert.equal((await search({ origin: "https://evil.example" })).status, 403);
  assert.equal((await search({ "sec-fetch-site": "cross-site" })).status, 403);
  assert.equal((await search({ "sec-fetch-site": "same-origin" })).status, 200);
});

test("findings 7, 8: the cache key; the saved runs list Qloo's locality only; picking one asks for it by its ref, free", async () => {
  assert.notEqual(liveCacheKey({ kind: "brand", id: "A", city: "Denver" }), liveCacheKey({ kind: "brand", id: "A", city: "Denver", na: true }));
  const p = (w) => [{ id: "a", weight: w }, { id: "b", weight: 3 }, { id: "c", weight: 3 }];
  assert.notEqual(liveCacheKey({ kind: "proxy", items: p(1), city: "Boise" }), liveCacheKey({ kind: "proxy", items: p(5), city: "Boise" }));
  assert.deepEqual([normCity("東京"), normCity("Москва"), normCity("!!")], ["東京", "москва", ""]);
  const env = sampleEnv();
  await read(await run(env, { kind: "brand", name: "Athletic", city: "boise, idaho" }, { ip: "198.51.100.8" }));
  await settled();
  const list = await (await worker.fetch(new Request("https://doors.test/api/runs"), env, ctx)).json();
  assert.deepEqual(list.runs.map((x) => [x.name, x.cityName, "city" in x, "key" in x, /^[0-9a-f]{16}$/.test(x.ref)]), [["Athletic Brewing Co", "Boise", false, false, true]]);
  // the page asks for it by Qloo's name and its ref: a saved run, no write
  const n = env.DOORS_KV.puts.length;
  const hit = await run(env, { kind: "brand", name: "Athletic", city: "Boise", ref: list.runs[0].ref }, { ip: "198.51.100.8" });
  assert.equal(hit.headers.get("x-doors-cache"), "hit");
  await read(hit);
  assert.equal(env.DOORS_KV.puts.length, n);
});

// the pre-warm (scripts/prewarm.mjs) writes kvRunKey("live", …) for what the page sends; a page's run must find it
test("a pre-warmed run's KV key is the key the page's run asks for", async () => {
  const { kvRunKey, validateRoute } = await import("../src/worker.js");
  const id = "00000000-0000-4000-8000-F5D98F39FBC6";
  const body = { kind: "brand", id, name: "Modelo", city: "New York, NY", na: false }; // what lib/live.js runLive POSTs
  const server = kvRunKey("live", validateRoute(body).input);
  assert.equal(server, `route:v2:live:${liveCacheKey({ kind: "brand", id, name: "Modelo", city: "New York, NY", na: false })}`);
  assert.equal(server, "route:v2:live:brand|00000000-0000-4000-8000-f5d98f39fbc6|new york ny|-");
});

// Qloo can read a city as its state ("New York, NY" → "New York, United States"): the agent stops after the first
// call with what to type instead, and the visitor's run doesn't count
test("a city Qloo reads as a state: the run stops after one call, says so, and doesn't count", async () => {
  const state = { results: { entities: [] }, query: { localities: { filter: [{ name: "New York", disambiguation: "New York, United States", location: { lat: 42.9, lon: -75.6 } }] } } };
  const f = async () => { f.n++; return new Response(JSON.stringify(state), { headers: { "content-type": "application/json" } }); };
  f.n = 0;
  const env = liveEnv({ QLOO_FETCH: f });
  const r = await run(env, { kind: "brand", id: "00000000-0000-4000-8000-F5D98F39FBC6", name: "Modelo", city: "New York, NY" }, { ip: "198.51.100.50" });
  const err = (await read(r)).find((e) => e.type === "error");
  assert.match(err.error, /as the state of New York, not a city/);
  assert.equal(f.n, 1);
  await settled();
  assert.equal(await seen(env, "198.51.100.50"), 0);
});

// Qloo reads any text as some place ("Qwxzy Flats" → The Flats, Beverly Hills): the agent stops after the first call,
// names what Qloo read so the visitor can confirm it by typing it, and the run doesn't count
test("a city Qloo read as another place: the run stops after one call, names Qloo's reading, and doesn't count", async () => {
  const flats = { results: { entities: [{ entity_id: "x" }] }, query: { localities: { filter: [{ name: "The Flats", disambiguation: "Beverly Hills, CA", location: { lat: 34.07, lon: -118.41 } }] } } };
  const f = async () => { f.n++; return new Response(JSON.stringify(flats), { headers: { "content-type": "application/json" } }); };
  f.n = 0;
  const env = liveEnv({ QLOO_FETCH: f });
  const r = await run(env, { kind: "brand", id: "00000000-0000-4000-8000-F5D98F39FBC6", name: "Modelo", city: "Qwxzy Flats" }, { ip: "198.51.100.51" });
  const err = (await read(r)).find((e) => e.type === "error");
  assert.match(err.error, /Qloo read "Qwxzy Flats" as The Flats, Beverly Hills, CA/);
  assert.equal(f.n, 1);
  await settled();
  assert.equal(await seen(env, "198.51.100.51"), 0);
});

// owner review 7 (M1): the agent's name-only resolve never takes a brand by another name ("High Noon" → Miller High
// Life). Qloo's real answer for "High Noon" without its #1: the run stops after the one search call, names what Qloo
// had, and doesn't count.
test("a brand name Qloo's top row doesn't match: the run stops after the search, names what Qloo had, and doesn't count", async () => {
  const hn = JSON.parse(readFileSync(new URL("./fixtures/qloo-search-high-noon.json", import.meta.url), "utf8"));
  const body = { results: hn.results.filter((r) => r.name !== "High Noon Sun Sips") };
  const f = async () => { f.n++; return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } }); };
  f.n = 0;
  const env = liveEnv({ QLOO_FETCH: f });
  const r = await run(env, { kind: "brand", name: "High Noon", city: "Denver, CO" }, { ip: "198.51.100.52" });
  const events = await read(r);
  const err = events.find((e) => e.type === "error");
  assert.match(err.error, /Qloo has no brand called "High Noon"\. It had Miller High Life/);
  assert.ok(!events.some((e) => e.type === "step" && e.id === "resolve"), "no drinker resolved");
  assert.equal(f.n, 1);
  await settled();
  assert.equal(await seen(env, "198.51.100.52"), 0);
  // with Sun Sips there, it resolves to Sun Sips (typed another way: the Worker keeps Qloo's answers by request)
  const g = async (u) => { g.n++; return new Response(JSON.stringify(new URL(u).pathname === "/search" ? hn : { results: { entities: [] } }), { headers: { "content-type": "application/json" } }); };
  g.n = 0;
  const ok = await read(await run(liveEnv({ QLOO_FETCH: g }), { kind: "brand", name: "high noon", city: "Denver, CO" }, { ip: "198.51.100.53" }));
  assert.match(ok.find((e) => e.id === "resolve").detail, /resolved "high noon" to High Noon Sun Sips \(Hard seltzer\)/);
});

// live check H: a typo city ("Milwuakee") is Qloo's 400 "unable to resolve to a valid locality": one call, a plain
// sentence (never the API's JSON), and the page's hint names the listed city it most likely means
test("a city Qloo can't place: one call, a plain sentence, no JSON; the hint suggests the listed city", async () => {
  const { liveError } = await import("../public/lib/live.js");
  const { nearestCity } = await import("../public/lib/citylist.js");
  const bad = JSON.stringify({ errors: [{ message: "filter.location.query is unable to resolve to a valid locality.", path: "filter.location" }] });
  const f = async () => { f.n++; return new Response(bad, { status: 400, headers: { "content-type": "application/json" } }); };
  f.n = 0;
  const env = liveEnv({ QLOO_FETCH: f });
  const r = await run(env, { kind: "brand", id: "00000000-0000-4000-8000-F5D98F39FBC6", name: "Jameson", city: "Milwuakee" }, { ip: "198.51.100.51" });
  const err = (await read(r)).find((e) => e.type === "error");
  assert.equal(err.error, 'Qloo doesn\'t know a city called "Milwuakee".');
  assert.equal(f.n, 1);
  assert.equal(liveError(err.error, (t) => nearestCity(t)?.label).hint, "Did you mean Milwaukee, WI? Check the spelling, or pick the city from the list as you type.");
  assert.equal(liveError(err.error).hint, "Check the spelling, or pick the city from the list as you type.");
  assert.equal(liveError(`Qloo 400 on /v2/insights: ${bad}`).message, "Qloo refused this request.");
  assert.deepEqual(["Chcago", "San Fransisco", "Cincinatti oh", "Qwxzy Flats"].map((t) => nearestCity(t)?.label ?? null), ["Chicago, IL", "San Francisco, CA", "Cincinnati, OH", null]);
});

// live check F: the city list offers what Qloo reads right, and a reading in another state is refused with why
test("the list offers New York as 'New York City'; a 'City, ST' Qloo reads in another state stops after one call", async () => {
  const { matchCities, cityPick } = await import("../public/lib/citylist.js");
  const { liveError } = await import("../public/lib/live.js");
  assert.equal(matchCities("new york")[0].label, "New York City");
  assert.equal(cityPick(matchCities("new york")[0]).cityName, "New York City");
  assert.equal(matchCities("wyoming, mi")[0].label, "Wyoming, Michigan");
  assert.equal(matchCities("milwaukee")[0].label, "Milwaukee, WI", "every other row keeps its label (the pre-warmed runs' keys)");
  const reading = { results: { entities: [{ entity_id: "x", name: "Somewhere" }] }, query: { localities: { filter: [{ name: "Wyoming", disambiguation: "Wyoming, Middlebury, Wyoming County, New York, United States", location: { lat: 42.8, lon: -78.1 } }] } } };
  const f = async () => { f.n++; return new Response(JSON.stringify(reading), { headers: { "content-type": "application/json" } }); };
  f.n = 0;
  const env = liveEnv({ QLOO_FETCH: f });
  const r = await run(env, { kind: "brand", id: "00000000-0000-4000-8000-F5D98F39FBC6", name: "Modelo", city: "Wyoming, MI" }, { ip: "198.51.100.52" });
  const err = (await read(r)).find((e) => e.type === "error");
  assert.equal(err.error, 'Qloo read "Wyoming, MI" as Wyoming, New York. Type the state in full ("Wyoming, Michigan").');
  assert.equal(f.n, 1);
  assert.match(liveError(err.error).hint, /Edit this city/); // group 3 #5
  await settled();
  assert.equal(await seen(env, "198.51.100.52"), 0);
});

// live check C leftover: the saved runs said "Jameson Irish Whiskey · Milwaukee County"
test("the saved runs list a county reading by the city's name (old entries too)", async () => {
  const { countyless, runMeta } = await import("../src/worker.js");
  assert.deepEqual(["Milwaukee County", "Delaware County", "Orleans Parish", "Chicago", "County Line"].map(countyless), ["Milwaukee", "Delaware", "Orleans", "Chicago", "County Line"]);
  assert.equal(runMeta({ route: { city: { resolved: true, name: "Milwaukee County" }, drinker: { id: "j", name: "Jameson" } } }, { kind: "brand", items: [] }, "2026-10-22").cityName, "Milwaukee");
  const env = sampleEnv();
  await env.DOORS_KV.put("route:v2:sample:brand|j|milwaukee wi|-", "{}", { metadata: { kind: "brand", id: "j", name: "Jameson Irish Whiskey", cityName: "Milwaukee County", at: "2026-10-22" } });
  const list = await (await worker.fetch(new Request("https://doors.test/api/runs"), env, ctx)).json();
  assert.deepEqual(list.runs.map((x) => `${x.name} · ${x.cityName}`), ["Jameson Irish Whiskey · Milwaukee"]);
});

// fix14 (Jard's iPhone, 2026-10-23, the Mac's SAMPLE server): "Dayton, OH" came back as "Qloo read it as Boise, Idaho.
// Type the state in full", wrong twice: the sample fixtures are Boise's, and a different city is not a state fix.
test("fix14: another city's reading never says 'type the state in full'; SAMPLE says it only holds Boise", async () => {
  const { liveError } = await import("../public/lib/live.js");
  const env = sampleEnv();
  for (const [city, ip] of [["Dayton, OH", "198.51.100.61"], ["Dayton, Ohio", "198.51.100.62"], ["Dayton", "198.51.100.63"]]) {
    const err = (await read(await run(env, { kind: "brand", name: "Athletic", city }, { ip }))).find((e) => e.type === "error");
    assert.equal(err?.error, `This server runs on sample data (no Qloo key), which only covers Boise, Idaho, so it can't build "${city}". The hosted Doors app builds any US city.`, city);
    assert.equal(liveError(err.error).hint, "Pick Boise, ID as the opening city to try Doors on this server.");
  }
  const reading = { results: { entities: [{ entity_id: "x", name: "Somewhere" }] }, query: { localities: { filter: [{ name: "Boise", disambiguation: "Boise, Ada County, Idaho, United States" }] } } };
  const f = async () => new Response(JSON.stringify(reading), { headers: { "content-type": "application/json" } });
  const err = (await read(await run(liveEnv({ QLOO_FETCH: f }), { kind: "brand", id: "00000000-0000-4000-8000-F5D98F39FBC6", name: "Modelo", city: "Dayton, OH" }, { ip: "198.51.100.64" }))).find((e) => e.type === "error");
  assert.equal(err.error, 'Qloo read "Dayton, OH" as Boise, Boise, Ada County, Idaho, United States. If that\'s right, type it as the city; if not, check the spelling.');
  await settled();
});
