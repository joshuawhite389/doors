// R9 carry: "the plan comes with you" (public/lib/carry.js, /manifest.webmanifest in src/worker.js). No data files.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { encodeCarry, decodeCarry, packState, unpackState, mergeCarried, carrySearch, sameCarry, CARRY_MAX, CARRY_RE } from "../public/lib/carry.js";
import { demoProfile } from "../public/lib/demo-profile.js";
import { createStore } from "../public/lib/store.js";
import worker from "../src/worker.js";

// deterministic Qloo-shaped ids
const uid = (n) => {
  const h = (k) => ((n * 2654435761 + k * 40503) >>> 0).toString(16).toUpperCase().padStart(8, "0");
  return `${h(1)}-${h(2).slice(0, 4)}-${h(3).slice(0, 4)}-${h(4).slice(0, 4)}-${h(5)}${h(6).slice(0, 4)}`;
};
// a planned stop as the plan view saves it
const stop = (n, eta) => ({ id: uid(n), eta, depart: eta + 25, legMi: 1.3, legMin: 6, openAtArrival: true, hoursVerified: true, openUntil: 1440, source: "estimate", pinned: null, carried: false, locked: false, lockDay: null, waitMin: 0, orderReason: "nearest open door" });
const day = (w, ids, extra = {}) => ({ date: w.date, day: "tuesday", from: 780, to: 1080, start: { id: `start:${w.date}`, lat: 30.2556, lon: -97.7208, label: "East Austin · E Cesar Chavez", own: false }, mi: 6.1, min: 24, end: 1070, leave: 780, source: "estimate", frozen: false, past: false, stops: ids.map((n, i) => stop(n, 790 + i * 31)), ...extra });
const range = (a, b) => Array.from({ length: b - a }, (_, i) => a + i);

function demoState() {
  const profile = demoProfile(new Date(2026, 9, 20));
  const [w1, w2, w3] = profile.windows;
  const plan = { days: [day(w1, range(1, 12), { frozen: true }), day(w2, range(12, 18)), day(w3, range(18, 23))], unscheduled: [], carried: [], notes: [], reasons: {} };
  return {
    v: 1, brand: "Tidewell", city: "austin", profile, plan, uncappedPlan: plan,
    statuses: { [uid(1)]: "visited", [uid(2)]: "visited" },
    outcomes: { [uid(1)]: { result: "interested", note: "loved it, wants samples", at: "2026-10-27T13:40" }, [uid(2)]: { result: "followup", followUp: "2026-10-29", followUpTime: "15:00", note: "hesitant about price", at: "2026-10-27T14:20" } },
    slots: {}, current: { date: w1.date, from: 780 }, savedAt: "2026-10-27T18:20:00.000Z",
  };
}

function liveState() {
  const profile = {
    ...demoProfile(new Date(2026, 9, 20)), brand: "Fizzwell", city: "cincinnati-oh", cityName: "Cincinnati OH", cityLive: true, cityCenter: [39.1031, -84.512],
    drinks: [{ id: "00000000-0000-4000-8000-53FB487CB4DE", name: "Spindrift Sparkling Water", ready: false }], start: { lat: 39.1031, lon: -84.512, label: "Downtown Cincinnati" }, known: [uid(90)], maxPerDay: 8,
  };
  const [w1, w2, w3] = profile.windows;
  const plan = { days: [day(w1, range(30, 39), { past: true }), day(w2, range(39, 47), { frozen: true }), day(w3, range(47, 54))] };
  const outcomes = {};
  for (const n of range(30, 36)) outcomes[uid(n)] = { result: ["interested", "followup", "someone", "no"][n % 4], ...(n % 4 === 1 ? { followUp: w3.date } : {}), ...(n % 4 === 2 ? { who: "Sam, the bar manager" } : {}), note: `door ${n}: liked the can, asked about price and a staff tasting next week`, at: `2026-10-27T1${n % 10}:05` };
  return {
    v: 1, brand: "Fizzwell", city: "cincinnati-oh", profile, plan, uncappedPlan: { days: plan.days.slice(1) },
    statuses: Object.fromEntries([...range(30, 39).map((n) => [uid(n), "visited"]), [uid(40), "notfit"], [uid(41), "talked"]]),
    outcomes,
    slots: { [uid(31)]: [{ field: "door.buyer", value: "Sam", source: "person", at: "2026-10-27T11:05" }], "*": [{ field: "brand.price", value: "$38 a case", source: "person" }] },
    contacts: [{ id: uid(99), name: "The Listing Loon", address: "1648 Blue Rock St, Cincinnati, OH 45223", lat: 39.1612, lon: -84.5381, source: "qloo", hours: "Mon-Sun 4pm-2:30am" }],
    added: [{ id: uid(98), name: "Northside Yacht Club", lat: 39.163, lon: -84.539, date: w2.date }],
    locks: [{ id: uid(42), date: w2.date, index: 0 }],
    talkEdits: { [uid(43)]: { opener: "Saw the trivia night crowd: anyone asking for something without booze?" } },
    carriedNotes: {}, current: { date: w2.date, from: 840 }, savedAt: "2026-10-28T15:00:00.000Z",
  };
}
const RULES = [{ field: "rule.avoid", value: "chains", source: "person" }, { field: "rule.term", value: { say: "NA", not: "mocktail" }, source: "person" }];

test("round trip: the demo plan comes back as saved (days ahead and the day under way as door ids)", async () => {
  const st = demoState();
  const code = await encodeCarry(st);
  assert.match(code, CARRY_RE);
  assert.equal(code[0], "z");
  const { state, rules } = await decodeCarry(code);
  assert.deepEqual(rules, []);
  for (const k of ["brand", "city", "profile", "statuses", "outcomes", "current", "savedAt"]) assert.deepEqual(state[k], st[k], k);
  assert.deepEqual(state.plan.days.map((d) => d.stops.map((s) => s.id)), st.plan.days.map((d) => d.stops.map((s) => s.id)));
  assert.deepEqual(state.plan.days.map(({ stops, ...d }) => d), st.plan.days.map(({ stops, ...d }) => d), "every day's dates, times, start and leave");
  assert.deepEqual(state.uncappedPlan, state.plan, "the uncapped plan rides as 'the same as the plan'");
  assert.deepEqual(state.profile.windows, st.profile.windows, "the dates are the plan's own, not today's");
});

test("round trip: a live-city plan with outcomes, slots, rules, contacts, added rooms, locks and talk edits", async () => {
  const st = liveState();
  const { state, rules } = await decodeCarry(await encodeCarry(st, { rules: RULES }));
  assert.deepEqual(rules, RULES);
  for (const k of ["brand", "city", "profile", "statuses", "outcomes", "slots", "contacts", "added", "locks", "talkEdits", "current", "savedAt"]) assert.deepEqual(state[k], st[k], k);
  assert.deepEqual(state.plan.days[0], st.plan.days[0], "a day that ended comes whole: it shows as it was");
  assert.deepEqual(state.plan.days[1].stops, st.plan.days[1].stops.map((s) => ({ id: s.id })));
  assert.deepEqual(state.uncappedPlan.days.map((d) => d.date), st.uncappedPlan.days.map((d) => d.date));
  assert.equal(state.profile.cityLive, true);
  assert.deepEqual(state.profile.drinks, st.profile.drinks, "the live drinker's Qloo id: the Worker's saved run, a cache hit");
  assert.equal(JSON.stringify(state).includes("lists"), false, "no route or venue list rides along");
});

test("size: both codes are under 4 KB; the plain fallback round-trips; over the cap there is no code", async () => {
  const demo = await encodeCarry(demoState());
  const live = await encodeCarry(liveState(), { rules: RULES });
  assert.ok(demo.length < 4000, `demo ${demo.length}`);
  console.log(`# carry code sizes: demo ${demo.length}, live ${live.length} characters`);
  assert.ok(live.length < 4000, `live ${live.length}`);
  const plain = await encodeCarry(demoState(), { deflate: false });
  assert.equal(plain[0], "j");
  assert.ok(plain.length > demo.length, "deflate earns its keep");
  assert.deepEqual((await decodeCarry(plain)).state.statuses, demoState().statuses);
  // incompressible notes: over CARRY_MAX → null (the page shows "build it in the app")
  const big = demoState();
  let x = 7;
  big.outcomes.big = { result: "no", note: Array.from({ length: 9000 }, () => String.fromCharCode(33 + ((x = (x * 48271) % 2147483647) % 90))).join("") };
  assert.equal(await encodeCarry(big), null);
  assert.equal(await encodeCarry(demoState(), { max: 100 }), null);
  assert.equal(await encodeCarry({ ...demoState(), profile: null }), null, "no plan: no code");
});

test("bad codes are ignored (null, never a throw)", async () => {
  const b64 = (s) => Buffer.from(s).toString("base64url");
  const good = await encodeCarry(demoState());
  const bad = [undefined, null, 42, "", "z", "x" + good.slice(1), good.slice(0, 40), good.slice(0, -12) + "AAAAAAAAAAAA", "z$$$$", "j" + b64("not json"), "j" + b64("{}"),
    "j" + b64(JSON.stringify({ v: 2, b: "x", c: "y", p: {} })), "j" + b64(JSON.stringify({ v: 1, b: "x", c: "", p: {} })), "j" + b64(JSON.stringify({ v: 1, b: "x", c: "y", p: [] })), "j" + b64("[1,2]"),
    "j" + "A".repeat(CARRY_MAX + 1), "jété", "j" + b64("\xff\xfe")];
  for (const c of bad) assert.equal(await decodeCarry(c), null, String(c).slice(0, 30));
  assert.equal(unpackState(packState({ v: 1, brand: "x", city: "", profile: {} })), null);
});

test("merge: the copy saved more recently wins; a later outcome from the other copy is kept; a tie keeps this device's", () => {
  const local = { ...demoState(), savedAt: "2026-10-27T19:00:00.000Z", statuses: { a: "visited", b: "visited" }, outcomes: { a: { result: "no", at: "2026-10-27T18:30" } } };
  const older = { ...demoState(), savedAt: "2026-10-27T18:00:00.000Z", statuses: { a: "visited" }, outcomes: { a: { result: "interested", at: "2026-10-27T13:00" }, c: { result: "interested", at: "2026-10-27T19:10" } } };
  const m = mergeCarried(local, older);
  assert.deepEqual(m.statuses, local.statuses, "the newer copy's statuses, whole");
  assert.deepEqual(m.outcomes.a, local.outcomes.a);
  assert.deepEqual(m.outcomes.c, older.outcomes.c, "an outcome recorded after the newer copy was saved");
  const newer = { ...older, savedAt: "2026-10-27T20:00:00.000Z", outcomes: { a: { result: "interested", at: "2026-10-27T13:00" } } };
  const n = mergeCarried(local, newer);
  assert.deepEqual(n.statuses, newer.statuses);
  assert.deepEqual(n.outcomes.a, local.outcomes.a, "per door, the later `at` wins");
  assert.equal(mergeCarried(local, { ...local, statuses: {} }), local, "a tie (the app reopening its install code) keeps this device's copy");
  const empty = { v: 1, brand: "Tidewell", city: "austin", profile: null, statuses: {}, outcomes: {} };
  assert.equal(mergeCarried(empty, older), older, "nothing here: the carried plan");
});

test("a carried plan written through store.js lists as a saved plan and opens", async () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k), key: (i) => [...mem.keys()][i] ?? null, get length() { return mem.size; } };
  const store = createStore(storage);
  const { state, rules } = await decodeCarry(await encodeCarry(liveState(), { rules: RULES }));
  store.save(state.brand, state.city, mergeCarried(store.load(state.brand, state.city), state));
  store.setRules(state.brand, rules);
  assert.deepEqual(store.list().map((r) => [r.brand, r.city]), [["Fizzwell", "cincinnati-oh"]]);
  assert.deepEqual(store.load("Fizzwell", "cincinnati-oh").outcomes, liveState().outcomes);
  assert.deepEqual(store.getRules("Fizzwell"), RULES);
});

// ---- the Worker's /manifest.webmanifest ----
const MANIFEST = readFileSync(new URL("../public/manifest.json", import.meta.url), "utf8");
function envCounting() {
  const n = { kv: 0, assets: 0 };
  const kv = new Proxy({}, { get: () => () => { n.kv++; return null; } });
  return { n, env: { DOORS_KV: kv, QLOO_API_KEY: "x", QLOO_FETCH: () => { throw new Error("Qloo called"); }, ASSETS: { fetch: async (req) => (n.assets++, new URL(req.url).pathname === "/manifest.json" ? new Response(MANIFEST, { headers: { "content-type": "application/json" } }) : new Response("nf", { status: 404 })) } } };
}
const get = (env, q) => worker.fetch(new Request(`https://doors.test/manifest.webmanifest${q}`), env, { waitUntil() {} });

test("/manifest.webmanifest?c=<code>: the app's manifest with start_url carrying the code; no KV, no Qloo", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error("network"); };
  try {
    const { n, env } = envCounting();
    const code = await encodeCarry(liveState(), { rules: RULES });
    const res = await get(env, `?c=${code}`);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/manifest+json");
    assert.equal(res.headers.get("cache-control"), "no-store");
    const m = await res.json();
    assert.equal(m.start_url, `/app?drive=1&c=${code}`);
    const plain = JSON.parse(MANIFEST);
    assert.deepEqual({ ...m, start_url: plain.start_url }, plain, "everything else as public/manifest.json");
    // the round trip the installed app makes
    assert.deepEqual((await decodeCarry(new URL(m.start_url, "https://doors.test").searchParams.get("c"))).state.statuses, liveState().statuses);
    for (const q of ["", "?c=", "?c=bad!code", `?c=${"z" + "A".repeat(CARRY_MAX)}`, "?c=%3Cscript%3E", "?c=q123", `?c=${code}%26x%3D1`]) {
      const r = await get(env, q);
      assert.equal(r.status, 200, q);
      assert.equal((await r.json()).start_url, "/app?drive=1", `plain for ${q.slice(0, 30)}`);
    }
    assert.equal(n.kv, 0, "no KV read or write");
    assert.ok(n.assets >= 8);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("wrangler.toml sends /manifest.webmanifest to the Worker first", () => {
  const toml = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
  assert.match(toml, /run_worker_first = \[[^\]]*"\/manifest\.webmanifest"/);
});

// ---- R9 carry2: the manifest link at parse time, the tab's address, Prepare (the Menu's Add to Home Screen) ----
const APP_HTML = readFileSync(new URL("../public/app.html", import.meta.url), "utf8");

test("app.html writes the manifest link at parse time, before any other link; a static one only in <noscript>", async () => {
  const head = APP_HTML.slice(0, APP_HTML.indexOf("</head>"));
  const script = head.indexOf("doorsManifest(location.search)");
  assert.ok(script > 0 && script < head.indexOf("<link"), "the inline script comes before every <link>");
  assert.deepEqual([...head.matchAll(/<link rel="manifest"[^>]*>/g)].map((m) => m[0]), ['<link rel="manifest" href="/manifest.json">']);
  assert.match(head, /<noscript><link rel="manifest" href="\/manifest.json"><\/noscript>/);
  // the inline chooser, run as the page runs it
  const src = /function doorsManifest\(search\) \{[\s\S]*?\n\}/.exec(head)[0];
  const doorsManifest = new Function(`${src}; return doorsManifest;`)();
  const code = await encodeCarry(demoState());
  assert.equal(doorsManifest(`?drive=1&c=${code}`), `/manifest.webmanifest?c=${code}`);
  assert.equal(doorsManifest(`?c=${code}&drive=1`), `/manifest.webmanifest?c=${code}`);
  for (const q of ["", "?drive=1", "?c=", "?c=bad!code", "?c=q123", "?c=%3Cscript%3E", `?c=z${"A".repeat(CARRY_MAX)}`, "?c=z%22onload%3D"]) assert.equal(doorsManifest(q), "/manifest.json", q);
  // the same rule as the Worker's
  for (const c of [code, "zAbc_-9", "bad!", "", "j" + "A".repeat(CARRY_MAX)]) assert.equal(doorsManifest(`?c=${c}`) !== "/manifest.json", c.length <= CARRY_MAX && CARRY_RE.test(c), c.slice(0, 20));
});

test("carrySearch: the tab's address carries the latest code with drive=1, other params kept; no code drops c", () => {
  assert.equal(carrySearch("", "zAbc"), "?drive=1&c=zAbc");
  assert.equal(carrySearch("?drive=1&c=zOld", "zNew"), "?drive=1&c=zNew");
  assert.equal(carrySearch("?deep=off", "zAbc"), "?deep=off&drive=1&c=zAbc");
  assert.equal(carrySearch("?drive=1&c=zOld", null), "?drive=1", "over the cap: no code in the address");
  assert.equal(carrySearch("?c=zOld", null), "");
  assert.equal(carrySearch("", null), "");
});

test("a reload with ?c= in a browser tab keeps this device's copy; codes for the same plan match whatever its savedAt", async () => {
  const st = demoState();
  const code = await encodeCarry(st);
  const { state } = await decodeCarry(code);
  assert.equal(mergeCarried(st, state), st, "the code's own savedAt: a tie, this device's copy");
  const later = { ...st, savedAt: "2026-10-27T18:21:00.000Z" }; // opening the plan saved it again
  assert.equal(mergeCarried(later, state), later);
  assert.equal(await sameCarry(code, await encodeCarry(later)), true, "Ready: the parsed manifest is this plan as it stands");
  assert.equal(await sameCarry(code, await encodeCarry({ ...later, statuses: { ...st.statuses, [uid(3)]: "visited" } })), false, "a door logged since: Prepare again");
  assert.equal(await sameCarry(null, code), false);
  assert.equal(await sameCarry(code, "zjunk"), false);
});
