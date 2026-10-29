#!/usr/bin/env node
// Round 3, lane deep: bake the per-city NEIGHBOUR MAP the deep layer reads (public/lib/deep.js nearDoors), and print a
// door's insight facts for review. The facts themselves are computed live (they depend on the rep's category), so the
// only baked thing is brand-independent: for every enriched door, the enriched doors that share its crowd (the city
// file's sisters) or sit within NEAR_KM, from every route file's coordinates (the page only knows the loaded routes').
//   node scripts/deep-bake.mjs                       → public/data/deep/<city>.json for every city with an enrich file
//   node scripts/deep-bake.mjs --print "Pinthouse" --city austin --brand athletic-brewing [--full]
//   node scripts/deep-bake.mjs --stats --city austin --brand casamigos
// No Qloo calls, no model. Reads data/enrich (full records) when present, else public/data/enrich (slim).
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deepFactsFor, nearDoors, venueMap, DEEP_VERSION, NEAR_KM } from "../public/lib/deep.js";
import { savedRuns, runCityFile, runRoutes } from "./saved-runs.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const J = (p) => JSON.parse(readFileSync(join(ROOT, p), "utf8"));
const arg = (k, d = null) => { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] ?? true : d; };
const has = (k) => process.argv.includes(k);

const cities = readdirSync(join(ROOT, "public/data/enrich")).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));
const enrichOf = (city) => (existsSync(join(ROOT, `data/enrich/${city}.json`)) ? J(`data/enrich/${city}.json`) : J(`public/data/enrich/${city}.json`)).doors ?? {};
// the saved runs (data/prewarm) add their routes, and stand in for public/data/cities/<city>.json where there is none
// (the 12 cities beyond the held ones; gigbot 10-27)
const RUNS = savedRuns(ROOT);
const routesOf = (city) => [...readdirSync(join(ROOT, "public/data/routes")).filter((f) => f.endsWith(`-${city}.json`)).map((f) => J(`public/data/routes/${f}`)), ...runRoutes(RUNS, city)];
const cityFileOf = (city) => (existsSync(join(ROOT, `public/data/cities/${city}.json`)) ? J(`public/data/cities/${city}.json`) : runCityFile(RUNS, city) ?? { city, name: city, sisters: {}, sisterVenues: {} });

function bake(city) {
  const enrich = enrichOf(city);
  const cityFile = cityFileOf(city);
  const venues = venueMap({ routes: routesOf(city), city: cityFile });
  const near = {};
  let rows = 0;
  for (const id of Object.keys(enrich)) {
    const n = nearDoors(id, { enrich, venues, city: cityFile });
    if (n.length) { near[id] = n; rows += n.length; }
  }
  const out = { v: DEEP_VERSION, city, baked: new Date().toISOString().slice(0, 10), km: NEAR_KM, note: "Lane deep: for each enriched door, the enriched doors that share its crowd (sisters) or sit within km, nearest first: [id, km, sister]. The insight facts are computed by public/lib/deep.js from this and the enrich records.", near };
  mkdirSync(join(ROOT, "public/data/deep"), { recursive: true });
  writeFileSync(join(ROOT, `public/data/deep/${city}.json`), JSON.stringify(out));
  return { doors: Object.keys(enrich).length, withNear: Object.keys(near).length, rows, bytes: JSON.stringify(out).length };
}

function ctxFor(city, brand) {
  const enrich = enrichOf(city);
  const cityFile = J(`public/data/cities/${city}.json`);
  const route = J(`public/data/routes/${brand}-${city}.json`);
  const venues = venueMap({ routes: routesOf(city), city: cityFile });
  const near = existsSync(join(ROOT, `public/data/deep/${city}.json`)) ? J(`public/data/deep/${city}.json`).near : null;
  const profile = { brand: "(the rep's brand)", what: route.drinker?.category ?? "", drinks: [{ key: route.drinker?.key, name: route.drinker?.name }] };
  const plan = { venues: route.venues, profile, pool: { ids: route.lists.all.map((r) => r[0]), N: route.lists.all.length }, city: { key: city } };
  return { enrich, ctx: { plan, routes: [route], city: cityFile, venues, near, profile } };
}

if (has("--print")) {
  const city = arg("--city", "austin");
  const brand = arg("--brand", "athletic-brewing");
  const q = String(arg("--print")).toLowerCase();
  const { enrich, ctx } = ctxFor(city, brand);
  const ids = Object.keys(enrich).filter((id) => String(enrich[id].name ?? "").toLowerCase().includes(q));
  const out = deepFactsFor(enrich, ctx, ids);
  for (const id of ids) {
    const r = enrich[id];
    console.log(`\n=== ${r.name} (${city}, ${brand}; Qloo basis ${r.qloo?.basis}, site ${r.site?.ok ? "read" : "none"})`);
    for (const f of out[id] ?? []) console.log(`- [${f.kind} ${f.score}${f.prep ? " prep" : ""}] ${f.label}\n    ${f.text}${has("--full") ? `\n    src: ${f.src.join(", ")}${f.from ? ` from: ${f.from}` : ""}` : ""}`);
    if (!(out[id] ?? []).length) console.log("  (no insight facts: nothing distinctive in its record)");
  }
} else if (has("--stats")) {
  const city = arg("--city", "austin");
  const brand = arg("--brand", "athletic-brewing");
  const { enrich, ctx } = ctxFor(city, brand);
  const t0 = Date.now();
  const out = deepFactsFor(enrich, ctx, Object.keys(enrich));
  const kinds = {};
  const tops = {};
  let lines = 0;
  for (const fs of Object.values(out)) { lines += fs.length; tops[fs[0].kind] = (tops[fs[0].kind] ?? 0) + 1; for (const f of fs) kinds[f.kind] = (kinds[f.kind] ?? 0) + 1; }
  console.log(JSON.stringify({ city, brand, doors: Object.keys(enrich).length, withFacts: Object.keys(out).length, lines, kinds, topKind: tops, ms: Date.now() - t0 }));
} else {
  for (const city of cities) console.log(city, JSON.stringify(bake(city)));
}
