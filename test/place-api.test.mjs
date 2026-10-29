// Group 3 item 2 · POST /api/place: a door's music and sister doors fetched when the rep asks. The same guards as a
// plan's run (own page only, the budget, the per-visitor limit), every call counted, the answer kept a day in KV.
// Qloo is a fake (QLOO_FETCH); no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker, { COST } from "../src/worker.js";

const ID = "00000000-0000-4000-8000-271655E6AA28";
const SIS = "00000000-0000-4000-8000-77D781F87446";
const ctx = { waitUntil: (p) => p };
const ASSETS = { fetch: async () => new Response("asset") };
const kvMap = () => {
  const store = new Map();
  return { store, get: async (k, t) => (store.has(k) ? (t === "json" ? JSON.parse(store.get(k)) : store.get(k)) : null), put: async (k, v) => void store.set(k, v) };
};
const artist = (i, genres) => ({ entity_id: `A${i}`, name: `Artist ${i}`, tags: genres.map((g) => ({ id: `urn:tag:genre:music:${g}`, name: g, type: "urn:tag:genre:music" })), properties: {} });
const ARTISTS = { results: { entities: Array.from({ length: 12 }, (_, i) => artist(i, ["americana", "country", "folk"])) } };
const SISTERS = { results: { entities: [{ entity_id: SIS, name: "Austin Beerworks", location: { lat: 30.2, lon: -97.7 }, properties: { primary_genre: { id: "urn:tag:genre:place:brewery" }, address: "1 Main St" }, query: { affinity: 0.98 } }] } };
function fakeQloo() {
  const seen = [];
  const f = async (u) => {
    const q = new URL(u).searchParams;
    seen.push(q.get("filter.type"));
    const body = q.get("filter.type") === "urn:entity:place" ? SISTERS : ARTISTS;
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", "x-month-ratelimit-remaining": "40000" } });
  };
  f.seen = seen;
  return f;
}
let ip = 0;
const post = (env, body, { origin = "https://doors.test" } = {}) =>
  worker.fetch(new Request("https://doors.test/api/place", { method: "POST", headers: { "content-type": "application/json", origin, "cf-connecting-ip": `203.0.113.${++ip % 250}` }, body: JSON.stringify(body) }), env, ctx);

test("music and sisters for one door: three calls, the sound checked, then kept (a second ask is free)", async () => {
  const QLOO_FETCH = fakeQloo();
  const env = { ASSETS, QLOO_API_KEY: "x", LEDGER_COUNT: async () => 100, DOORS_KV: kvMap(), QLOO_FETCH };
  const r = await post(env, { id: ID, city: "Austin", cityName: "Austin", want: ["music", "sisters"], popularity: 0.7, lat: 30.22, lon: -97.76, name: "Nomadic" });
  assert.equal(r.status, 200);
  const b = await r.json();
  assert.equal(b.calls, COST.place);
  assert.equal(QLOO_FETCH.seen.length, 3);
  assert.deepEqual(b.sisters[ID], [[SIS, 0.98]]);
  assert.equal(b.sisterVenues[SIS].name, "Austin Beerworks");
  assert.equal(b.sounds[ID].artists.length, 12);
  assert.equal(typeof b.sounds[ID].guard.pass, "boolean");
  const again = await (await post(env, { id: ID, city: "Austin", want: ["sisters", "music"] })).json();
  assert.equal(again.calls, 0);
  assert.equal(QLOO_FETCH.seen.length, 3, "no new Qloo call");
});

test("a quiet door (popularity under 0.2) isn't asked for music: Qloo refuses those and counts the call", async () => {
  const QLOO_FETCH = fakeQloo();
  const env = { ASSETS, QLOO_API_KEY: "x", LEDGER_COUNT: async () => 100, DOORS_KV: kvMap(), QLOO_FETCH };
  const b = await (await post(env, { id: ID, city: "Austin", want: ["music"], popularity: 0.1 })).json();
  assert.equal(b.calls, 0);
  assert.equal(b.sounds[ID].guard.pass, false);
  assert.equal(QLOO_FETCH.seen.length, 0);
});

test("a spent budget, another site, or a bad request never reaches Qloo", async () => {
  const QLOO_FETCH = fakeQloo();
  const full = { ASSETS, QLOO_API_KEY: "x", LEDGER_COUNT: async () => 34000, DOORS_KV: kvMap(), QLOO_FETCH };
  const r = await post(full, { id: ID, city: "Austin", want: ["sisters"] });
  assert.equal(r.status, 503);
  const b = await r.json();
  assert.equal(b.paused, true);
  assert.match(b.error, /off for today/);
  const ok = { ...full, LEDGER_COUNT: async () => 100 };
  assert.equal((await post(ok, { id: ID, city: "Austin", want: ["sisters"] }, { origin: "https://elsewhere.test" })).status, 403);
  assert.equal((await post(ok, { id: "nope", city: "Austin", want: ["sisters"] })).status, 400);
  assert.equal((await post(ok, { id: ID, city: "Austin", want: [] })).status, 400);
  assert.equal(QLOO_FETCH.seen.length, 0);
});
