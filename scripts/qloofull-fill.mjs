// qloofull (Jard 10-27: by submission no Qloo data is missing for any feature in any city Doors offers). P1: give the
// SAVED RUNS (data/prewarm/*.json, the KV values publish.sh uploads) and the PARSON'S PRESET (public/data/routes/
// parsons-<city>.json) what a live run carries today (src/worker.js runRoute): every age re-rank, the most popular doors,
// and for the preset its heat map and hooks. Patches only the fields named; everything else stays byte-for-byte.
//
//   node scripts/qloofull-fill.mjs --prewarm-ages [--dry] [--max=N]   lists.<band> + dropped.<band> (+ new venues, tagged)
//                                                                       for every band of AGE_DIAL a brand run lacks
//   node scripts/qloofull-fill.mjs --culture [--dir=…] [--dry]           heat map + hooks for a saved run that has none (3 calls)
//   node scripts/qloofull-fill.mjs --rooms [--dry] [--max=N]           Parson's routes: 5 age lists + famous; heat.json
//                                                                       runs["parsons|<city>"]; hooks.json brands.parsons
// Every call: data/ledger.jsonl (source "qloofull"); raw bodies under data/raw (age-bands' key scheme), never twice.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { QlooClient } from "../src/qloo.js";
import { makeLedger } from "../src/ledger.js";
import { doorParams, venuesFromPage, entities } from "../src/plan.js";
import { tagFamilies, AGE_DIAL } from "../public/lib/core.js";
import { heatHoods } from "../public/lib/culture.js";
import { CONFIG } from "./config.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const RAW = join(ROOT, "data/raw");
mkdirSync(RAW, { recursive: true });
const args = process.argv.slice(2);
const PREWARM = (() => { const d = args.find((a) => a.startsWith("--dir="))?.split("=")[1]; return d ? (d.startsWith("/") ? d : join(ROOT, d)) : join(ROOT, "data/prewarm"); })(); // --dir=<runs dir> (data/prewarm-dev: Jard's dev KV runs, scripts/qloofull-dev.mjs)
const DRY = args.includes("--dry");
const MAX = Number(args.find((a) => a.startsWith("--max="))?.split("=")[1] ?? Infinity);
const BANDS = Object.entries(AGE_DIAL).filter(([, a]) => a.buckets).map(([k, a]) => [k, a.buckets]);

const ledger = makeLedger(join(ROOT, "data/ledger.jsonl"), { source: "qloofull" });
let client = null;
let fresh = 0;
let would = 0;
let stop = null;
const rawFile = (params) => join(RAW, `${createHash("sha256").update(`GET /v2/insights ${JSON.stringify(params)}`).digest("hex").slice(0, 24)}.json`);
async function get(params, label) {
  const f = rawFile(params);
  if (existsSync(f)) return JSON.parse(readFileSync(f, "utf8")).body;
  if (DRY) return void would++;
  if (stop) return null;
  if (fresh >= MAX) return void (stop = `--max=${MAX} reached`);
  ledger.assertBudget(1);
  client ??= new QlooClient({
    apiKey: process.env.QLOO_API_KEY ?? readFileSync(join(homedir(), ".config/gigbot/qloo-key"), "utf8").trim(),
    minGapMs: 300,
    retryBudget: 0,
    onLedger: (e) => {
      ledger.record(e);
      if (e.status === 429) stop = "Qloo answered 429";
      if (typeof e.remaining === "number" && e.remaining < 12000) stop = `Qloo's month is at ${e.remaining} calls left (reserve)`;
    },
  });
  fresh++;
  try {
    const body = await client.get("/v2/insights", params);
    writeFileSync(f, JSON.stringify({ label, method: "GET", path: "/v2/insights", params, at: new Date().toISOString(), body }));
    return body;
  } catch (e) {
    console.log(`  x ${label}: ${String(e.message).slice(0, 160)}`);
    if (e.status && e.status < 500 && e.status !== 429) writeFileSync(f, JSON.stringify({ label, method: "GET", path: "/v2/insights", params, at: new Date().toISOString(), error: String(e.message).slice(0, 300), body: null }));
    return null;
  }
}

// as src/assemble.js writes a list row and a venue record (scripts/age-bands.mjs does the same)
const STATIC_KEYS = ["affinity", "growth", "explain"];
const stripQuery = (v) => Object.fromEntries(Object.entries(v).filter(([k]) => !STATIC_KEYS.includes(k)));
const row = (v) => [v.id, v.affinity == null ? null : Math.round(v.affinity * 10000) / 10000, v.growth == null ? null : Math.round(v.growth * 1000) / 1000, v.explain?.length > 1 ? v.explain.map((x) => [x.id, Math.round(x.score * 1000) / 1000]) : null];
// one list (an age band or the famous page) patched onto a route: lists[key], dropped[key], venues it brings
async function patchList(route, key, params, label) {
  if (route.lists[key]) return null;
  const body = await get(params, label);
  if (!body) return null;
  const tagsOf = new Map(entities(body).map((e) => [e.entity_id, tagFamilies(e.tags)]));
  const r = venuesFromPage(body, { alcohol: Boolean(route.filter?.alcohol) });
  let added = 0;
  for (const v of r.venues) {
    if (route.venues[v.id]) continue;
    const t = tagsOf.get(v.id);
    route.venues[v.id] = { ...stripQuery(v), ...(t ? { tags: t } : {}) };
    added++;
  }
  route.lists[key] = r.venues.map(row);
  route.dropped[key] = { n: r.dropped, names: r.droppedNames.slice(0, 20) };
  return `${label}: ${route.lists[key].length} doors (${added} new to the route)`;
}

const summary = [];
if (args.includes("--prewarm-ages")) {
  const files = readdirSync(PREWARM).filter((f) => /^[0-9a-f]{24}\.json$/.test(f)).sort();
  // most-shown first: the runs listed among the saved runs (metadata) before the aliases
  const rows = files.map((f) => ({ f, row: JSON.parse(readFileSync(join(PREWARM, f), "utf8")) })).filter((x) => x.row.value?.route?.kind === "brand").sort((a, b) => (b.row.metadata ? 1 : 0) - (a.row.metadata ? 1 : 0));
  for (const { f, row } of rows) {
    if (stop) break;
    const route = row.value.route;
    let changed = false;
    for (const [key, buckets] of BANDS) {
      const s = await patchList(route, key, doorParams({ signalId: route.drinker.id, city: route.city.query ?? route.city.name, page: 1, ageBuckets: buckets }), `${route.drinker.key}|${route.city.key} ${key}`);
      if (s) (summary.push(s), (changed = true));
    }
    if (changed && !DRY) writeFileSync(join(PREWARM, f), JSON.stringify(row));
  }
}

// --culture: a saved run with no culture (heat map, hooks: runRoute 6b) gets it, 3 calls a run
if (args.includes("--culture")) {
  const files = readdirSync(PREWARM).filter((f) => /^[0-9a-f]{24}\.json$/.test(f)).sort();
  for (const f of files) {
    if (stop) break;
    const row = JSON.parse(readFileSync(join(PREWARM, f), "utf8"));
    const rt = row.value?.route;
    if (!rt || !["brand", "room"].includes(rt.kind) || !rt.drinker?.id || rt.culture?.heat?.length) continue;
    const label = `${rt.drinker.key}|${rt.city.key}`;
    const lists = {};
    for (const type of ["tv_show", "podcast"]) {
      const body = await get({ "filter.type": `urn:entity:${type}`, "signal.interests.entities": rt.drinker.id, take: 10 }, `${label} hooks ${type}`);
      lists[type] = entities(body).filter((e) => e?.name).map((e) => ({ name: e.name, tags: [...new Set((e.tags ?? []).map((x) => x?.name).filter(Boolean))].slice(0, 10) }));
    }
    const heatBody = await get({ "filter.type": "urn:heatmap", "signal.interests.entities": rt.drinker.id, "filter.location.query": rt.city.query ?? rt.city.name, "output.heatmap.boundary": "urn:entity:locality" }, `${label} heat`);
    const heat = heatBody ? heatHoods(heatBody, rt.city).slice(0, 15) : [];
    if (DRY) continue;
    rt.culture = { captured: rt.culture?.captured ?? new Date().toISOString().slice(0, 10), hooks: rt.culture?.hooks ?? { name: rt.drinker.name, category: null, lists }, ...(heat.length ? { heat } : rt.culture?.heat ? { heat: rt.culture.heat } : {}) };
    writeFileSync(join(PREWARM, f), JSON.stringify(row));
    summary.push(`${label} culture: ${lists.tv_show.length} TV shows, ${lists.podcast.length} podcasts, ${heat.length} neighbourhoods`);
  }
}

if (args.includes("--rooms")) {
  const heatF = join(ROOT, "public/data/culture/heat.json");
  const hooksF = join(ROOT, "public/data/culture/hooks.json");
  const heat = JSON.parse(readFileSync(heatF, "utf8"));
  const hooks = JSON.parse(readFileSync(hooksF, "utf8"));
  const today = new Date().toISOString().slice(0, 10);
  for (const room of CONFIG.rooms) {
    let roomId = null; // the preset's Qloo id, as its route files hold it
    for (const c of CONFIG.cities) {
      if (stop) break;
      const file = join(ROOT, "public/data/routes", `${room.key}-${c.key}.json`);
      if (!existsSync(file)) continue;
      const route = JSON.parse(readFileSync(file, "utf8"));
      const id = route.drinker.id;
      roomId ??= id;
      let changed = false;
      for (const [key, buckets] of BANDS) {
        const s = await patchList(route, key, { ...doorParams({ signalId: id, city: c.query, page: 1, ageBuckets: buckets }), "filter.exclude.entities": id }, `${room.key}-${c.key} ${key}`);
        if (s) (summary.push(s), (changed = true));
      }
      const s = await patchList(route, "famous", { ...doorParams({ signalId: id, city: c.query, page: 1, cap: null }), "filter.exclude.entities": id }, `${room.key}-${c.key} famous`);
      if (s) (summary.push(s), (changed = true));
      if (changed && !DRY) writeFileSync(file, JSON.stringify(route));
      // heat: the room's regulars on Qloo's map of this city (runRoute 6b, for a brand)
      const hk = `${room.key}|${c.key}`;
      if (!heat.runs[hk]?.hoods?.length) {
        const body = await get({ "filter.type": "urn:heatmap", "signal.interests.entities": id, "filter.location.query": c.query, "output.heatmap.boundary": "urn:entity:locality" }, `${hk} heat`);
        const hoods = body ? heatHoods(body, { key: c.key, name: c.name, center: c.center }).slice(0, 15) : [];
        if (hoods.length) (heat.runs[hk] = { captured: today, hoods }), summary.push(`${hk} heat: ${hoods.length} neighbourhoods`);
      }
    }
    // hooks: what the room's regulars also like (deep-hooks.mjs's record shape)
    if (roomId && !hooks.brands[room.key]) {
      const lists = {};
      for (const type of ["tv_show", "podcast", "destination"]) {
        const body = await get({ "filter.type": `urn:entity:${type}`, "signal.interests.entities": roomId, take: 10 }, `${room.key} hooks ${type}`);
        lists[type] = entities(body).filter((e) => e?.name).map((e) => ({ name: e.name, tags: [...new Set((e.tags ?? []).map((x) => x?.name).filter(Boolean))].slice(0, 10) }));
      }
      if (Object.values(lists).some((l) => l.length)) (hooks.brands[room.key] = { name: room.name, id: roomId, category: null, captured: today, lists }), summary.push(`${room.key} hooks: ${Object.entries(lists).map(([t, l]) => `${l.length} ${t}`).join(", ")}`);
    }
  }
  if (!DRY) {
    writeFileSync(heatF, JSON.stringify(heat));
    writeFileSync(hooksF, JSON.stringify(hooks));
  }
}
console.log(summary.join("\n"));
console.log(`qloofull-fill: ${fresh} Qloo calls${DRY ? `, ${would} would be made` : ""}${stop ? ` · STOPPED: ${stop}` : ""} · ledger ${ledger.count} this month`);
