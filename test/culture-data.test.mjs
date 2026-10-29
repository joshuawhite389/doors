// R9 deep on the real held data (public/data, in scripts/test.mjs NEEDS_DATA): each signal changes decisions on real
// rooms, and off = the pre-R9 output (the proof harness's ablation baseline).
import { test } from "node:test";
import assert from "node:assert/strict";
import { route } from "./helpers.mjs";
import { buildPool } from "../public/lib/pool.js";
import { planDays } from "../public/lib/schedule.js";
import { crowdTimes, crowdShare } from "../public/lib/culture.js";
import { talkPoints } from "../public/lib/talk.js";
import { sampleProfile } from "../public/lib/profile.js";
import { BANNED_PITCH } from "../public/lib/core.js";

const KEYS = ["athletic-brewing-austin", "casamigos-chicago", "white-claw-omaha", "don-julio-boise"];
const H = (h) => h * 60;
const stripTags = (r) => ({ ...r, venues: Object.fromEntries(Object.entries(r.venues).map(([k, v]) => [k, { ...v, tags: null }])) });
function plan(r, deepOff, fill) {
  const c = r.city;
  const start = { id: "start", lat: c.center[0], lon: c.center[1] };
  // three days at three different times: the day choice is what time-of-day fit decides
  const windows = [["2026-10-27", "tuesday", 11, 15], ["2026-10-28", "wednesday", 14, 18], ["2026-10-29", "thursday", 17, 21]].map(([date, day, a, b]) => ({ date, day, from: H(a), to: H(b), start }));
  const pool = buildPool({ routes: [r], profile: { ...sampleProfile(), city: c.key }, cityName: c.name, deepOff });
  return { pool, plan: planDays({ pool: pool.rows, statuses: pool.statuses, windows, visitMin: 25, pinned: [], fill }) };
}
const ids = (p) => p.days.map((d) => d.stops.map((s) => s.id));

test("held routes carry Qloo's tag families (backfilled from the raw bodies, 0 calls)", () => {
  for (const k of KEYS) {
    const vs = Object.values(route(k).venues);
    assert.ok(vs.filter((v) => v.tags?.tod?.length).length / vs.length > 0.9, k);
    assert.ok(vs.every((v) => !v.tags || !("identity" in v.tags || "age" in v.tags)), k);
  }
});

test("tod ablation: off = the plan of the same rooms with no tags, stop for stop", () => {
  for (const k of KEYS) {
    const r = route(k);
    assert.deepEqual(ids(plan(r, ["tod"]).plan), ids(plan(stripTags(r), null).plan), k);
  }
});

// Fill by rank, then route (owner, 2026-10-23): with each week's doors set by rank, crowd times only choose the day
// within the week. The plans still change; in-crowd arrivals fall under fill "area" (the doors too are chosen) and are
// no worse under fill "week" (measured 49 = 49 of 70 over the 4 cities).
test("tod swap: on, the planner moves doors to the day that catches them outside their crowd times (fewer in-crowd arrivals over 4 cities)", () => {
  for (const fill of ["area", "week"]) {
    let changed = 0;
    const tally = { on: 0, off: 0 };
    for (const k of KEYS) {
      const r = route(k);
      for (const [key, off] of [["on", null], ["off", ["tod"]]]) {
        const { pool, plan: p } = plan(r, off, fill);
        for (const d of p.days) for (const s of d.stops) if (crowdShare(s.eta, s.eta + 25, crowdTimes(pool.venues[s.id])) > 0.5) tally[key]++;
      }
      if (JSON.stringify(ids(plan(r, null, fill).plan)) !== JSON.stringify(ids(plan(r, ["tod"], fill).plan))) changed++;
    }
    assert.ok(changed >= 3, `${fill}: ${changed} of ${KEYS.length} plans changed`);
    assert.ok(fill === "area" ? tally.on < tally.off : tally.on <= tally.off, `${fill}: ${JSON.stringify(tally)}`);
  }
});

test("lead swap on Austin's top 100 for a tequila: Qloo's drinks/menu tags change the opener or ask on many rooms, every change sourced and guard-clean", () => {
  const r = route("casamigos-austin");
  const TEQ = { brand: "Agave Co", what: "Reposado tequila" };
  let changed = 0;
  let gates = 0;
  for (const [id] of r.lists.all.slice(0, 100)) {
    const v = r.venues[id];
    const on = talkPoints({ venue: v, profile: TEQ }, []);
    const off = talkPoints({ venue: v, profile: TEQ, deepOff: ["lead"] }, []);
    if (on.opener === off.opener && on.ask === off.ask && on.questions.join() === off.questions.join()) continue;
    changed++;
    assert.ok(on.deep.lead?.src?.length && on.deep.lead.src.every((s) => s.kind === "qloo" && /^tag:/.test(s.field)), v.name);
    if (on.deep.lead.gate) gates++;
    for (const l of [on.opener, on.ask, ...on.questions]) assert.doesNotMatch(l, BANNED_PITCH, `${v.name}: ${l}`);
  }
  assert.ok(changed >= 20, `${changed} of 100 changed`);
  assert.ok(gates < changed, `${gates} gates`);
});

import { stopModel } from "../public/lib/stopmodel.js";
import { readJson, city } from "./helpers.mjs";
import { hookFor } from "../public/lib/culture.js";
test("hooks on real rooms: a hook on some rooms, not most (decide, don't decorate); off = none", () => {
  const hooks = readJson("public/data/culture/hooks.json");
  for (const [key, name, c] of [["athletic-brewing", "Athletic Brewing", "austin"], ["casamigos", "Casamigos", "chicago"], ["white-claw", "White Claw", "omaha"]]) {
    const r = route(`${key}-${c}`);
    const top = r.lists.all.slice(0, 60).map((x) => r.venues[x[0]]);
    const n = top.filter((v) => hookFor(v, [{ key, name }], hooks)).length;
    assert.ok(n >= 3 && n <= 40, `${key}: ${n}/60`);
  }
  const r = route("athletic-brewing-austin");
  const id = r.lists.all.map((x) => x[0]).find((i) => hookFor(r.venues[i], [{ key: "athletic-brewing", name: "Athletic Brewing" }], hooks));
  const plan = { venues: r.venues, profile: { brand: "Tidewell", what: "Non-alcoholic hazy IPA", drinks: [{ key: "athletic-brewing", name: "Athletic Brewing" }] }, days: [], pool: { ids: [], N: 0 }, city: { key: "austin", name: "Austin" } };
  const on = stopModel({ plan, id, city: city("austin"), routes: [r], hooks });
  assert.match(on.talk.hook.text, /^People who drink Athletic Brewing also like /);
  assert.equal(stopModel({ plan, id, city: city("austin"), routes: [r], hooks, deepOff: ["hooks"] }).talk.hook, null);
});

import { heatFor as heatOf } from "../public/lib/culture.js";
test("heat: off = no heat; on, the first day works the top hoods of Qloo's map more often (10 held plans), no door lost overall", () => {
  const heat = readJson("public/data/culture/heat.json");
  const KEYS10 = ["athletic-brewing-austin", "casamigos-chicago", "white-claw-omaha", "espolon-chicago", "lacroix-austin", "don-julio-austin", "liquid-death-chicago", "teremana-boise", "white-claw-chicago", "casamigos-omaha"];
  const t = { on: { hot: 0, doors: 0 }, off: { hot: 0, doors: 0 } };
  for (const k of KEYS10) {
    const r = route(k);
    const c = r.city;
    const start = { id: "start", lat: c.center[0], lon: c.center[1] };
    const windows = ["2026-10-27", "2026-10-28", "2026-10-29"].map((date, i) => ({ date, day: ["tuesday", "wednesday", "thursday"][i], from: H(13), to: H(18), start }));
    const hoods = heatOf(heat, [r]);
    assert.ok(hoods?.length, k);
    const pl = (off) => {
      const pool = buildPool({ routes: [r], profile: { ...sampleProfile(), city: c.key }, cityName: c.name, deepOff: off, heat: hoods });
      return { pool, plan: planDays({ pool: pool.rows, statuses: pool.statuses, windows, visitMin: 25, pinned: [] }) };
    };
    const hot = new Set(pl(null).pool.rows.filter((x) => x.heat).map((x) => x.id));
    assert.ok(pl(["heat"]).pool.rows.every((x) => !x.heat), k);
    for (const [key, off] of [["on", null], ["off", ["heat"]]]) {
      const { plan: p } = pl(off);
      t[key].hot += p.days[0].stops.filter((s) => hot.has(s.id)).length;
      t[key].doors += p.days.reduce((a, d) => a + d.stops.length, 0);
    }
  }
  assert.ok(t.on.hot >= t.off.hot * 1.4, JSON.stringify(t));
  assert.ok(t.on.doors >= t.off.doors - 3, JSON.stringify(t));
});

import { runRoute } from "../src/worker.js";
import { SAMPLE } from "../src/sample-data.js";
test("a live brand run carries what its fans like and Qloo's map of the city (3 calls, src/worker.js runRoute 6b); a room run doesn't ask", async () => {
  const asked = [];
  const stub = {
    calls: 0,
    async insights(p) {
      this.calls++;
      asked.push(p["filter.type"]);
      if (p["filter.type"] === "urn:entity:tv_show") return { results: { entities: [{ name: "Some Show", tags: [{ name: "Comedy" }] }] } };
      if (p["filter.type"] === "urn:entity:podcast") return { results: { entities: [{ name: "Golf Talk", tags: [{ name: "Golf" }, { name: "Sports" }] }] } };
      if (p["filter.type"] === "urn:heatmap") return { results: { entities: [{ name: "Boise", disambiguation: "Boise, Ada, Idaho, United States of America", boundary: "POLYGON ((-116.3 43.6, -116.1 43.6))" }, { name: "North End", disambiguation: "North End, Boise, Ada, Idaho, United States of America", boundary: "POINT (-116.2 43.63)" }] } };
      if (p["filter.type"] === "urn:entity:artist") return SAMPLE.sounds?.[0] ?? { results: { entities: [] } };
      return p["signal.interests.entities"] && String(p["filter.exclude.entities"] ?? "") ? SAMPLE.sisters : SAMPLE.page;
    },
    async search() { this.calls++; return { results: [] }; },
    async insightsPost() { this.calls++; return SAMPLE.page; },
  };
  const id = SAMPLE.page.results.entities[0]?.query?.explainability?.["signal.interests.entities"]?.[0]?.entity_id ?? "00000000-0000-4000-8000-30002EA85C1F";
  const out = await runRoute({ input: { kind: "brand", city: "Boise", day: "tuesday", part: "afternoon", items: [{ id, name: "Athletic Brewing" }], na: true }, qloo: stub, env: {}, emit: () => {} });
  assert.deepEqual(out.route.culture.hooks.lists.podcast, [{ name: "Golf Talk", tags: ["Golf", "Sports"] }]);
  assert.deepEqual(out.route.culture.heat.map((h) => h.name), ["North End"]);
  assert.equal(asked.filter((t) => ["urn:entity:tv_show", "urn:entity:podcast", "urn:heatmap"].includes(t)).length, 3);
});
