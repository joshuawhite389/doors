// Precompute: the work Doors does before anyone arrives. Node 22.
//   node scripts/precompute.mjs <phase> [--only=<brand>-<city>] [--dry]
// Phases (run in order; each is resumable, every raw response is cached under data/raw/ and never fetched twice):
//   resolve   brands, proxies, the preset room                      (~13 calls)
//   pages     doors: 3 capped pages + age variants + uncapped page 1 per brand × city; proxy and room presets
//   refs      city locality artists + brand artists (the room-sound guard's reference set)
//   venues    sister doors + room sound for the top doors of every combo (deduplicated by place id)
//   nbhd      neighbourhood sound for the neighbourhoods those doors sit in (the guard's fallback)
//   build     no calls: writes public/data/** from the cache. Refuses without --force: the shipped data was enriched
//             after it (see the build phase below)
// Every request that reaches Qloo is appended to data/ledger.jsonl. The build's budget is 1,500 calls in October.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { QlooClient, quota } from "../src/qloo.js";
import { makeLedger } from "../src/ledger.js";
import { doorParams, proxyBody, sisterParams, soundParams, localitySoundParams, brandArtistParams, searchRows, slugify } from "../src/plan.js";
import { CONFIG } from "./config.mjs";
import { buildAll } from "./build-data.mjs";
import { day1 } from "./day1.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const RAW = join(ROOT, "data/raw");
mkdirSync(RAW, { recursive: true });
const args = process.argv.slice(2);
const phase = args.find((a) => !a.startsWith("--")) ?? "help";
const flag = (n) => args.find((a) => a.startsWith(`--${n}`))?.split("=")[1] ?? (args.includes(`--${n}`) ? true : undefined);
const DRY = Boolean(flag("dry"));
const ONLY = flag("only");
const MAX = Number(flag("max") ?? Infinity); // hard stop for this run

const ledger = makeLedger(join(ROOT, "data/ledger.jsonl"), {
  source: "precompute",
  onWarn: (n) => console.log(`\n!! LEDGER at ${n} calls: message the orchestrator (budget 1,500).\n`),
});
let qloo;
function client() {
  if (qloo) return qloo;
  const key = process.env.QLOO_API_KEY ?? readFileSync(join(homedir(), ".config/gigbot/qloo-key"), "utf8").trim();
  qloo = new QlooClient({ apiKey: key, minGapMs: 400, onLedger: (e) => ledger.record(e) }); // shares the key with a sibling build: stay well under 5/s
  return qloo;
}

let fresh = 0;
let wouldCall = 0;
const rawKey = (method, path, params) => createHash("sha256").update(`${method} ${path} ${JSON.stringify(params)}`).digest("hex").slice(0, 24);
export function rawFile(method, path, params) {
  return join(RAW, `${rawKey(method, path, params)}.json`);
}
async function cached(method, path, params, label) {
  const f = rawFile(method, path, params);
  if (existsSync(f)) return JSON.parse(readFileSync(f, "utf8")).body;
  if (DRY) {
    wouldCall++;
    return null;
  }
  if (fresh >= MAX) throw new Error(`--max=${MAX} reached`);
  ledger.assertBudget(1);
  const c = client();
  let body;
  try {
    body = method === "GET" ? await c.get(path, params) : await c.post(path, params);
  } catch (err) {
    console.log(`  x ${label}: ${err.message.slice(0, 160)}`);
    writeFileSync(f, JSON.stringify({ label, method, path, params, error: err.message.slice(0, 300), body: null }));
    fresh++;
    return null;
  }
  fresh++;
  writeFileSync(f, JSON.stringify({ label, method, path, params, at: new Date().toISOString(), body }));
  const n = body?.results?.entities?.length ?? (Array.isArray(body?.results) ? body.results.length : "?");
  if (fresh % 10 === 0 || n === 0) console.log(`  ${fresh} calls · ledger ${ledger.count} · month left ${quota.monthRemaining ?? "?"} · ${label} n=${n}`);
  return body;
}
export const get = (path, params, label) => cached("GET", path, params, label);
export const post = (path, body, label) => cached("POST", path, body, label);

const ENT = join(ROOT, "data/entities.json");
const loadEntities = () => (existsSync(ENT) ? JSON.parse(readFileSync(ENT, "utf8")) : null);

async function resolve() {
  const out = { brands: {}, proxies: {}, rooms: {}, extra: {} };
  const pick = async (q, types, re) => {
    const body = await get("/search", { query: q, types, take: 5 }, `search ${q}`);
    const rows = searchRows(body);
    const norm = (x) => String(x).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const hit = rows.find((r) => re.test(norm(r.name)) || re.test(r.name)) ?? rows[0];
    return { query: q, chosen: hit ?? null, candidates: rows };
  };
  for (const b of CONFIG.brands) out.brands[b.key] = { ...b, ...(await pick(b.query, "urn:entity:brand", b.match)) };
  for (const set of CONFIG.proxySets) for (const p of set.items) out.proxies[p.key] ??= { ...p, ...(await pick(p.query, p.type, p.match)) };
  for (const r of CONFIG.rooms) out.rooms[r.key] = { ...r, ...(await pick(r.query, "urn:entity:place", r.match)) };
  for (const x of CONFIG.extraBrands) out.extra[x.key] = { ...x, ...(await pick(x.query, "urn:entity:brand", x.match)) };
  const clean = JSON.parse(JSON.stringify(out, (k, v) => (v instanceof RegExp ? v.source : v)));
  writeFileSync(ENT, JSON.stringify(clean, null, 2));
  for (const [k, v] of Object.entries({ ...out.brands, ...out.proxies, ...out.rooms, ...out.extra })) console.log(`  ${k.padEnd(18)} → ${v.chosen?.name ?? "NONE"} (${v.chosen?.id ?? "-"})  [${v.candidates.map((c) => c.name).join(" | ")}]`);
}

const combos = () => {
  const list = [];
  for (const b of CONFIG.brands) for (const c of CONFIG.cities) list.push({ b, c, key: `${b.key}-${c.key}` });
  return ONLY ? list.filter((x) => x.key === ONLY || x.b.key === ONLY || x.c.key === ONLY) : list;
};

export async function fetchCombo(ent, b, c) {
  const id = ent.brands[b.key].chosen.id;
  const res = { pages: [], ages: {}, famous: null };
  for (let p = 1; p <= 3; p++) res.pages.push(await get("/v2/insights", doorParams({ signalId: id, city: c.query, page: p }), `${b.key}-${c.key} p${p}`));
  for (const [ak, a] of Object.entries(CONFIG.ages)) {
    if (a.naOnly && !b.na) continue;
    res.ages[ak] = await get("/v2/insights", doorParams({ signalId: id, city: c.query, page: 1, ageBuckets: a.buckets }), `${b.key}-${c.key} age ${ak}`);
  }
  res.famous = await get("/v2/insights", doorParams({ signalId: id, city: c.query, page: 1, cap: null }), `${b.key}-${c.key} uncapped`);
  return res;
}

export async function fetchProxy(ent, set, c) {
  const proxies = set.items.map((p) => ({ id: ent.proxies[p.key].chosen.id, weight: p.weight }));
  const pages = [];
  for (let p = 1; p <= 3; p++) pages.push(await post("/v2/insights", proxyBody({ proxies, city: c.query, page: p }), `${set.key}-${c.key} p${p}`));
  return pages;
}

export async function fetchRoom(ent, r, c) {
  const id = ent.rooms[r.key].chosen.id;
  const pages = [];
  for (let p = 1; p <= 3; p++) pages.push(await get("/v2/insights", { ...doorParams({ signalId: id, city: c.query, page: p }), "filter.exclude.entities": id }, `${r.key}-${c.key} p${p}`));
  return pages;
}

async function pages() {
  const ent = loadEntities();
  for (const { b, c } of combos()) await fetchCombo(ent, b, c);
  if (!ONLY) {
    for (const set of CONFIG.proxySets) for (const c of CONFIG.cities) await fetchProxy(ent, set, c);
    for (const r of CONFIG.rooms) for (const c of CONFIG.cities) await fetchRoom(ent, r, c);
  }
}

async function refs() {
  const ent = loadEntities();
  for (const c of CONFIG.cities) await get("/v2/insights", localitySoundParams({ query: c.query, take: 50 }), `city sound ${c.key}`);
  for (const b of CONFIG.brands) await get("/v2/insights", brandArtistParams({ brandId: ent.brands[b.key].chosen.id }), `brand artists ${b.key}`);
}

// The doors that get sister doors and a room sound up front: the top N of each combo's capped all-ages list.
export async function showcaseDoors(ent, topN = CONFIG.showcaseTop) {
  const { venuesFromPage } = await import("../src/plan.js");
  const byCity = {};
  for (const { b, c } of combos()) {
    const id = ent.brands[b.key].chosen.id;
    const body = await get("/v2/insights", doorParams({ signalId: id, city: c.query, page: 1 }), `${b.key}-${c.key} p1`);
    const { venues } = venuesFromPage(body, { alcohol: !b.na });
    byCity[c.key] ??= new Map();
    for (const v of venues.slice(0, topN)) byCity[c.key].set(v.id, v);
  }
  return byCity;
}

async function venues() {
  const ent = loadEntities();
  const byCity = await showcaseDoors(ent);
  let total = 0;
  for (const [ck, m] of Object.entries(byCity)) {
    total += m.size;
    console.log(`  ${ck}: ${m.size} unique showcase doors`);
  }
  console.log(`  total unique showcase doors ${total} → up to ${total * 2} calls (sisters + sound)`);
  if (flag("count")) return;
  for (const [ck, m] of Object.entries(byCity)) {
    const c = CONFIG.cities.find((x) => x.key === ck);
    for (const id of m.keys()) {
      await get("/v2/insights", sisterParams({ placeId: id, city: c.query }), `sisters ${ck} ${m.get(id).name}`);
      await get("/v2/insights", soundParams({ placeId: id }), `sound ${ck} ${m.get(id).name}`);
    }
  }
}

async function nbhd() {
  const ent = loadEntities();
  const byCity = await showcaseDoors(ent);
  for (const [ck, m] of Object.entries(byCity)) {
    const c = CONFIG.cities.find((x) => x.key === ck);
    const counts = {};
    for (const v of m.values()) if (v.neighborhood) counts[v.neighborhood] = (counts[v.neighborhood] ?? 0) + 1;
    const top = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, CONFIG.nbhdPerCity)
      .map(([n]) => n);
    console.log(`  ${ck}: ${top.join(" | ")}`);
    for (const n of top) await get("/v2/insights", localitySoundParams({ query: `${n}, ${c.query}` }), `nbhd ${ck} ${n}`);
  }
}

// Read-only view of the raw cache for the build: it can never make a call.
function readRaw(method, path, params) {
  const f = rawFile(method, path, params);
  if (!existsSync(f)) return null;
  const r = JSON.parse(readFileSync(f, "utf8"));
  return r.body ? { body: r.body, at: r.at } : r.error ? { error: r.error } : null;
}
// Fill sister doors + room sound for the doors on the judge click path's Tuesday-evening routes that the top-20
// showcase does not cover (Diolosa R2 #5). Records them in data/extra-doors.json so the build includes them.
const FILL_COMBOS = ["athletic-brewing-austin", "athletic-brewing-chicago", "athletic-brewing-boise", "parsons-austin", "phoebe-glossier-sweetgreen-austin", "casamigos-chicago"];
async function fill() {
  const { buildRoute, parseHours, isOpenFor } = await import("../public/lib/core.js");
  const extraFile = join(ROOT, "data/extra-doors.json");
  const extra = existsSync(extraFile) ? JSON.parse(readFileSync(extraFile, "utf8")) : {};
  for (const key of FILL_COMBOS) {
    const r = JSON.parse(readFileSync(join(ROOT, "public/data/routes", `${key}.json`), "utf8"));
    const city = JSON.parse(readFileSync(join(ROOT, "public/data/cities", `${r.city.key}.json`), "utf8"));
    const sis = Object.fromEntries(Object.entries(city.sisters).map(([k, v]) => [k, v.map((x) => x[0])]));
    const rows = r.lists.all.map((x) => r.venues[x[0]]).filter((v) => !v.closed && isOpenFor(parseHours(v.hours), "tuesday", "evening") !== false);
    for (const s of buildRoute(rows, sis).stops) {
      const v = r.venues[s.id];
      if (city.sisters[s.id] && city.sounds[s.id]) continue;
      await get("/v2/insights", sisterParams({ placeId: s.id, city: r.city.query }), `sisters ${r.city.key} ${v.name}`);
      await get("/v2/insights", soundParams({ placeId: s.id }), `sound ${r.city.key} ${v.name}`);
      (extra[r.city.key] ??= {})[s.id] = v;
    }
  }
  if (!DRY) writeFileSync(extraFile, JSON.stringify(extra));
}

const phases = { resolve, fill, pages, refs, venues, nbhd, day1: () => day1({ get, loadEntities, CONFIG, ROOT }), build: () => {
  // The shipped public/data/** is no longer the build's output alone: later steps enriched it in place
  // (scripts/deep-tags.mjs room tag families, scripts/deep-hooks.mjs + deep-heat.mjs culture files, the preaudit pitch
  // fill, index.json without the v1 three-loves routes removed in f497d4c). Rebuilding would silently drop all of that,
  // so it refuses unless asked twice. Restore the tree with git, not with this.
  if (!args.includes("--force")) {
    console.error("precompute build refuses: public/data/** has been enriched since the build (deep tags, culture, filled pitches); a rebuild would drop them. Use git to restore data; --force only for a fresh tree you will re-enrich.");
    process.exit(2);
  }
  return buildAll({ readRaw, loadEntities, CONFIG, ROOT, ledgerCount: ledger.count });
} };
if (!phases[phase]) {
  console.log("usage: node scripts/precompute.mjs resolve|pages|refs|venues|nbhd|build [--only=<brand>-<city>] [--dry] [--max=N]");
  process.exit(1);
}
const t0 = Date.now();
await phases[phase]();
console.log(`${phase}: ${fresh} new Qloo calls${DRY ? `, ${wouldCall} would be made` : ""} · ledger ${ledger.count} this month · month remaining ${quota.monthRemaining ?? "(no call made)"} · ${((Date.now() - t0) / 1000).toFixed(1)} s`);
