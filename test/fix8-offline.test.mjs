// Fix 8 (2026-10-23, judge pass 4): a fetch that failed while building a plan (offline, the Worker down, a timeout, a
// 5xx) was said as an empty pool: "No rooms for that profile… pick the brands again", with no Try again (web
// ui/plan.js, phone engine.ts + Plan.tsx). Now it throws unreachable (lib/live.js) and both pages say "Couldn't reach
// Doors" with Try again first; a real empty pool keeps its own message. No Qloo calls: every fetch here is faked.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runLive, unreachable, UNREACHABLE } from "../public/lib/live.js";
import { emptyProfile } from "../public/lib/profile.js";
import { readJson } from "./helpers.mjs";

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const INDEX = () => structuredClone(readJson("public/data/index.json"));
const WIN = [{ date: "2026-10-13", from: "14:00", to: "18:00" }];
const LOOP = { label: "The Loop", lat: 41.884, lon: -87.63 };
const live = () => ({ ...emptyProfile(), brand: "Test", what: "Sparkling water", rooms: ["bars", "restaurants"], start: LOOP, windows: WIN, city: "chicago", drinks: [{ id: "11111111-2222-3333-4444-555555555555", name: "Topo Chico", ready: false }] });
const isUnreachable = (e) => {
  assert.equal(e.offline, true, `offline flag (${e.message})`);
  assert.equal(e.title, "Couldn't reach Doors");
  assert.equal(e.message, UNREACHABLE.text);
  assert.doesNotMatch(e.message, /no rooms|pick the brands|Failed to fetch|Qloo/i);
  assert.match(e.hint, /try again/i);
  return true;
};
const memCache = () => {
  const m = new Map();
  return { m, get: (k) => m.get(k) ?? null, put: (k, v) => m.set(k, v) };
};

test("a live run with no answer (offline, a timeout) is unreachable, not Qloo's verdict, and is not kept as failed", async () => {
  const cache = memCache();
  const offline = async () => { throw new TypeError("Failed to fetch"); };
  await assert.rejects(runLive({ profile: live(), index: INDEX(), fetchImpl: offline, cache }), isUnreachable);
  const timeout = async () => { throw Object.assign(new Error("Aborted"), { name: "AbortError" }); };
  await assert.rejects(runLive({ profile: live(), index: INDEX(), fetchImpl: timeout, cache }), isUnreachable);
  assert.equal(cache.m.size, 0, "a reload asks again");
});

test("a 5xx with no word from the Worker (its host's error page) is unreachable; the Worker's own refusals keep their words", async () => {
  const proxy = async () => new Response("<html>502 Bad Gateway</html>", { status: 502 });
  await assert.rejects(runLive({ profile: live(), index: INDEX(), fetchImpl: proxy }), isUnreachable);
  const qloo = async () => Response.json({ error: "Qloo didn't answer: timeout" }, { status: 502 });
  await assert.rejects(runLive({ profile: live(), index: INDEX(), fetchImpl: qloo }), (e) => !e.offline && /Qloo didn't answer/.test(e.message));
  const paused = async () => Response.json({ error: "New live routes are paused.", paused: true }, { status: 503 });
  await assert.rejects(runLive({ profile: live(), index: INDEX(), fetchImpl: paused }), (e) => !e.offline && /paused/.test(e.message));
});

test("a stream cut off mid-run is unreachable", async () => {
  const cache = memCache();
  const cut = async () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"type":"start"}\n{"type":"step","id":"resolve"')); c.error(new TypeError("network error")); } }));
  await assert.rejects(runLive({ profile: live(), index: INDEX(), fetchImpl: cut, cache }), isUnreachable);
  assert.equal(cache.m.size, 0);
});

test("the web's loadRoutes throws unreachable when a list doesn't load (offline, 5xx), and gives [] only when there is no list", async () => {
  const { loadRoutes } = await import("../public/ui/data.js");
  const index = INDEX();
  const f = index.files.find((x) => x.endsWith("-chicago"));
  const profile = { ...emptyProfile(), city: "chicago", drinks: [{ key: f.replace(/-chicago$/, ""), name: "X", ready: true }] };
  const real = globalThis.fetch;
  try {
    globalThis.fetch = async () => { throw new TypeError("Failed to fetch"); };
    await assert.rejects(loadRoutes(profile, index), isUnreachable);
    globalThis.fetch = async () => new Response("down", { status: 503 });
    await assert.rejects(loadRoutes(profile, index), isUnreachable);
    // the failed fetch isn't cached: Try again fetches again and the plan opens
    globalThis.fetch = async () => Response.json({ captured: "x", lists: { all: [] } });
    assert.equal((await loadRoutes(profile, index)).length, 1);
  } finally {
    globalThis.fetch = real;
  }
  // a real empty pool: no file for this brand in this city is [] (the page's "No rooms for that profile")
  assert.deepEqual(await loadRoutes({ ...profile, drinks: [{ key: "no-such-brand", name: "Nope", ready: true }] }, index), []);
  assert.equal(unreachable(unreachable(new Error("x"))).cause.message, "x", "wrapping twice keeps the first cause");
});

test("web plan.js: a failed list load shows Couldn't reach Doors with Try again first; No rooms stays for a real empty pool", () => {
  const s = src("public/ui/plan.js");
  assert.doesNotMatch(s, /catch\s*\{\s*routes = \[\];?\s*\}/, "the repro: any failure became an empty pool");
  assert.match(s, /unreachableView\(root, unreachable\(e\), editTo\)/);
  assert.match(s, /if \(e\.offline\) return void unreachableView/, "a live run's failed fetch too");
  assert.match(s, /function unreachableView[\s\S]*?class="btn primary" data-retry>Try again<\/button> <a class="btn line" href="\$\{editTo\}">\$\{editWord\(editTo\)\}/); // group 3 #5: "Edit this city"
  assert.match(s, /if \(!routes\.length\) \{\s*root\.innerHTML = `<div class="stub"><div><h2>No doors for that profile/);
});

test("phone: engine.open throws on a failed load; Plan.tsx says Couldn't reach Doors with Try again first", () => {
  const eng = src("app-mobile/src/engine.ts");
  assert.doesNotMatch(eng, /catch\s*\{\s*this\.routes = \[\];?\s*\}/);
  assert.match(eng, /this\.routes = await loadRoutes\(this\.profile, this\.index\);/);
  assert.match(src("app-mobile/src/data.ts"), /throw unreachable\(err\)/);
  const p = src("app-mobile/src/screens/Plan.tsx");
  assert.match(p, /if \(err\.offline\) return setPhase\(offlinePhase\(err\)\)/, "a live run's failed fetch");
  assert.match(p, /ok = await e\.open\(\);\s*\} catch \(err: any\) \{\s*if \(!on\) return;\s*if \(err\?\.offline\) return setPhase\(offlinePhase\(err\)\)/);
  assert.match(p, /title: UNREACHABLE\.title, text: err\.message, hint: err\.hint, retry: true, offline: true/);
  assert.match(p, /phase\.offline \? \(\s*<>\s*<Btn label="Try again" onPress=\{onRetry\} \/>/);
  assert.match(p, /if \(!ok\) return setPhase\(\{ k: "error", title: "No doors for that profile"/, "the real empty pool keeps its message");
});
