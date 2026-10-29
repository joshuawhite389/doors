// fix5-res: one refused Qloo call (a 429 in step 6's burst, a hard cap, a dropped connection) must not throw away a
// live run. Only the first page of doors is required; every other call degrades and the run says what's missing.
// The real QlooClient (retries, backoff) over SAMPLE's fixtures, with chosen calls refused. No network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { QlooClient, RETRY_BUDGET } from "../src/qloo.js";
import { sampleFetch } from "../src/sample.js";
import { runRoute } from "../src/worker.js";
import { assembleSounds } from "../src/assemble.js";
import { SAMPLE } from "../src/sample-data.js";

// What a request asks Qloo, by its params (src/plan.js builders)
function kindOf(url, init = {}) {
  const u = new URL(url);
  if (u.pathname === "/search") return "search";
  const p = init.method === "POST" ? JSON.parse(init.body) : Object.fromEntries(u.searchParams);
  const t = p["filter.type"];
  if (t === "urn:entity:place") {
    if (p["signal.demographics.age"]) return "age";
    if (!p.page) return "sisters";
    if (!p["filter.popularity.max"]) return "famous";
    return `page${p.page}`;
  }
  if (t === "urn:entity:artist") {
    if (p["signal.location.query"]) return "city sound";
    return Number(p.take) === 30 ? "brand artists" : "sound";
  }
  return "deep";
}

// refuse(kind, nthAttemptOfThatKind) → a Response to answer instead, or "throw", or null to answer from SAMPLE
function fakeQloo(refuse) {
  const real = sampleFetch();
  const seen = {};
  const log = [];
  const fetchImpl = async (url, init) => {
    const k = kindOf(url, init);
    seen[k] = (seen[k] ?? 0) + 1;
    const r = refuse(k, seen[k], log.length + 1);
    log.push({ k, refused: Boolean(r) });
    if (r === "throw") throw new Error("Too many subrequests.");
    if (r) return r;
    return real(url, init);
  };
  return { fetchImpl, log, seen };
}
const r429 = () => new Response("Too Many Requests", { status: 429 });

async function run(refuse, { kind = "brand", retryMs = 1 } = {}) {
  const f = fakeQloo(refuse);
  const qloo = new QlooClient({ apiKey: "test", fetchImpl: f.fetchImpl, cache: new Map(), minGapMs: 0, retryMs });
  const events = [];
  const id = "00000000-0000-4000-8000-30002EA85C1F";
  const out = await runRoute({ input: { kind, city: "Boise", day: "thursday", part: "evening", items: [{ id, name: "Athletic Brewing" }], na: true }, qloo, env: {}, emit: (e) => events.push(e) });
  return { out, events, f, steps: Object.fromEntries(events.filter((e) => e.type === "step").map((e) => [e.id, e.detail])) };
}

test("baseline: a clean SAMPLE brand run has no gaps", async () => {
  const { out } = await run(() => null);
  assert.ok(out.route.lists.all.length > 0);
  assert.deepEqual(out.route.gaps ?? [], []);
});

test("city sound refused on every try: the plan still builds and says the city's sound is missing", async () => {
  const { out, events, steps } = await run((k) => (k === "city sound" ? r429() : null));
  assert.ok(events.some((e) => e.type === "route"), "the route went out");
  assert.ok(out.route.lists.all.length > 0);
  assert.ok(out.route.gaps.some((g) => /sound/i.test(g)), JSON.stringify(out.route.gaps));
  assert.match(steps.guard, /didn't answer|didn't come back/i);
  assert.doesNotMatch(steps.guard, /the rest show Boise's sound/); // there is no city sound to show
  assert.deepEqual(out.city.citySound, []);
});

test("brand artists refused: the plan still builds and says so", async () => {
  const { out, steps } = await run((k) => (k === "brand artists" ? r429() : null));
  assert.ok(out.route.lists.all.length > 0);
  assert.ok(out.route.gaps.some((g) => /artists/i.test(g)), JSON.stringify(out.route.gaps));
  assert.match(steps.guard, /artists/i);
});

test("age re-ranks and the famous page refused: no empty lists pretend to be answers, the gaps say so", async () => {
  const { out } = await run((k) => (k === "age" || k === "famous" ? r429() : null));
  assert.ok(out.route.lists.all.length > 0);
  assert.equal(out.route.lists.famous, undefined);
  for (const key of Object.keys(out.route.lists)) assert.ok(["all"].includes(key), `unexpected list ${key}`);
  assert.ok(out.route.gaps.some((g) => /most popular/i.test(g)));
  assert.ok(out.route.gaps.some((g) => /age/i.test(g)));
});

test("a hard cap: every call after the 6th is refused (a thrown fetch), and the plan still builds from page 1", async () => {
  const { out, events } = await run((k, n, i) => (i > 6 ? "throw" : null));
  assert.ok(events.some((e) => e.type === "route"));
  assert.ok(out.route.lists.all.length > 0);
  assert.ok(out.route.gaps.length >= 3, JSON.stringify(out.route.gaps));
});

test("one transient 429 (first try only) is retried: nothing is missing", async () => {
  const { out, f } = await run((k, n) => (k === "city sound" && n === 1 ? r429() : null));
  assert.deepEqual(out.route.gaps, []);
  assert.ok(out.city.citySound.length > 0);
  assert.equal(f.seen["city sound"], 2);
});

test("page 1 refused: the run still fails, plainly (nothing to plan from)", async () => {
  await assert.rejects(run((k) => (k === "page1" ? r429() : null)), /Qloo/);
});

test("a run's retries are capped (Workers' subrequest limit): a 429 storm stops retrying, the plan still builds", async () => {
  const clean = await run(() => null);
  const { out, f } = await run((k) => (k === "page1" ? null : r429()));
  assert.ok(out.route.lists.all.length > 0);
  // every call's first try, plus at most the run's retry budget: well inside the free plan's 50 subrequests
  assert.equal(f.log.length, clean.f.log.length + RETRY_BUDGET);
  assert.ok(f.log.length + 2 <= 50); // + the model's drafts
});

test("assembleSounds with no reference lists at all: rooms are held back as unchecked, never 'only 0 share a genre'", () => {
  const doors = SAMPLE.page.results.entities.slice(0, 2).map((e) => ({ id: e.entity_id, name: e.name, lat: e.location?.lat, lon: e.location?.lon }));
  const soundBodies = Object.fromEntries(doors.map((d, i) => [d.id, SAMPLE.sounds[i % SAMPLE.sounds.length]]));
  const out = assembleSounds({ doors, soundBodies, refLists: [[], []], cityLists: [[]], cityName: "Boise" });
  for (const d of doors) {
    assert.equal(out[d.id].guard.pass, false);
    assert.equal(out[d.id].guard.reason, "unchecked");
    assert.match(out[d.id].guard.detail, /Qloo didn't answer/);
  }
});

test("429 backoff: the client waits longer than a fixed 700 ms ladder would and adds jitter", async () => {
  const waits = [];
  let n = 0;
  const qloo = new QlooClient({ apiKey: "t", minGapMs: 0, retryMs: 10, cache: new Map(), sleep: async (ms) => waits.push(ms), fetchImpl: async () => (++n < 3 ? r429() : new Response("{}", { status: 200 })) });
  await qloo.get("/v2/insights", { a: 1 });
  assert.equal(waits.length, 2);
  assert.ok(waits[1] > waits[0], JSON.stringify(waits));
});

// Through the Worker's own /api/route, in live mode (a key, the real 250 ms gate and backoff), with Qloo refusing
// every city-sound call: two judges' runs at once, from two visitors, both get a plan; the degraded run is kept a day.
import worker, { GAP_TTL, _inflight } from "../src/worker.js";
test("two concurrent live runs through /api/route with city sound refused: both plans build; KV keeps them a day", { timeout: 60000 }, async () => {
  const ttls = new Map();
  const store = new Map();
  const DOORS_KV = {
    async get(k, t) { const v = store.get(k); return v == null ? null : t === "json" ? JSON.parse(v) : v; },
    async put(k, v, o = {}) { store.set(k, v); ttls.set(k, o.expirationTtl); },
    async list() { return { keys: [], list_complete: true }; },
  };
  const f = fakeQloo((k) => (k === "city sound" ? r429() : null));
  const env = { ASSETS: { fetch: async () => new Response("asset") }, DOORS_KV, TODAY: "2026-11-10", QLOO_API_KEY: "x", QLOO_FETCH: f.fetchImpl, LEDGER_COUNT: async () => 0 };
  const go = (name, ip) => worker.fetch(new Request("https://doors.test/api/route", { method: "POST", headers: { "cf-connecting-ip": ip, origin: "https://doors.test", "content-type": "application/json" }, body: JSON.stringify({ kind: "brand", name, city: "Boise" }) }), env, { waitUntil: (p) => p });
  const read = async (r) => (await r.text()).split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const [a, b] = await Promise.all([go("Athletic", "198.51.100.7"), go("LaCroix", "198.51.100.8")].map(async (p) => read(await p)));
  for (const ev of [a, b]) {
    assert.equal(ev.find((e) => e.type === "error"), undefined, JSON.stringify(ev.find((e) => e.type === "error")));
    const route = ev.find((e) => e.type === "route").route;
    assert.ok(route.gaps.some((g) => /sound/.test(g)));
    assert.ok(ev.some((e) => e.type === "done"));
  }
  for (let i = 0; i < 200 && _inflight() > 0; i++) await new Promise((r) => setTimeout(r, 10));
  const runKeys = [...ttls.keys()].filter((k) => k.startsWith("route:"));
  assert.ok(runKeys.length >= 1);
  for (const k of runKeys) assert.equal(ttls.get(k), GAP_TTL);
});

// ---- the plan view's line (public/lib/live.js gapsNote): short labels, merged over the drinkers, only with gaps ----
import { gapsNote } from "../public/lib/live.js";
test("gapsNote: one line naming what Qloo didn't answer, merged over drinkers; null without gaps", () => {
  assert.equal(gapsNote([{ route: { gaps: [] } }, { route: {} }]), null);
  assert.equal(gapsNote([{ route: { gaps: ["city sound", "brand artists"] } }, { route: { gaps: ["city sound"] } }]), "Qloo didn't answer for: city sound, brand artists. Run it again tomorrow to fill them in.");
});
test("the worker's gaps are the short labels the line reads", async () => {
  const { out } = await run((k) => (["city sound", "brand artists", "famous"].includes(k) ? r429() : null));
  assert.deepEqual(out.route.gaps, ["the most popular doors", "city sound", "brand artists"]);
});
