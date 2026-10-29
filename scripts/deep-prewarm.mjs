// R9 deep for the PREWARMED runs (data/prewarm/*.json, the KV values scripts/prewarm.mjs wrote): give them the same
// cultural layer a live run gets, without re-running them (no re-precompute: only `tags` on venues and `culture` on the
// route are added). Every call ledgered (source "deep-prewarm"), cache-first (data/culture-raw/, gitignored).
//
//   node scripts/deep-prewarm.mjs --plan                     what is missing and the calls it would take (no call)
//   node scripts/deep-prewarm.mjs --tags  [--batch=200] [--max=N]   room tags: GET /entities?entity_ids=…, batched by city
//   node scripts/deep-prewarm.mjs --heat  [--max=N]          heatmap per run (brand × city), most-shown first
//   node scripts/deep-prewarm.mjs --apply [--dir=<prewarm>]  write tags + route.culture into the run files (backup first)
// Hooks (brand → TV, podcasts) come from scripts/deep-hooks.mjs (same cache); --apply copies them onto each run.
// Then: node scripts/prewarm.mjs --bulk=<dir> rebuilds the KV bulk files (publish.sh is the owner's).
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { QlooClient } from "../src/qloo.js";
import { makeLedger } from "../src/ledger.js";
import { tagFamilies } from "../public/lib/core.js";
import { heatHoods } from "../public/lib/culture.js";

const ROOT = new URL("..", import.meta.url).pathname;
const RAW = join(ROOT, "data/culture-raw");
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")).map(([k, v]) => [k, v ?? true]));
const DIR = typeof args.dir === "string" ? args.dir : [join(ROOT, "data/prewarm"), join(ROOT, "../doors/data/prewarm")].find(existsSync);
const rawDirs = [join(ROOT, "data/raw"), join(ROOT, "data/raw-live"), join(ROOT, "../doors/data/raw"), join(ROOT, "../doors/data/raw-live"), RAW].filter(existsSync);
mkdirSync(RAW, { recursive: true });

const runs = readdirSync(DIR).filter((f) => /^[0-9a-f]{24}\.json$/.test(f)).map((f) => ({ f, row: JSON.parse(readFileSync(join(DIR, f), "utf8")) })).filter((x) => x.row.value?.route);
// every place with tag families in a raw body on disk (precompute, live, and this script's entity answers)
function knownTags() {
  const tags = new Map();
  for (const dir of rawDirs) for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    let body;
    try { body = JSON.parse(readFileSync(join(dir, f), "utf8")).body; } catch { continue; }
    const ents = Array.isArray(body?.results?.entities) ? body.results.entities : Array.isArray(body?.results) ? body.results : [];
    for (const e of ents) if (e?.entity_id && !tags.has(e.entity_id)) { const t = tagFamilies(e.tags); if (t) tags.set(e.entity_id, t); }
  }
  return tags;
}
const cityOf = (r) => r.value.route.city?.key ?? r.value.route.city?.name;
const shown = (r) => (r.row.metadata ? 1 : 0); // listed among the saved runs (what a judge sees first)
const qloo = () => {
  const ledger = makeLedger(join(ROOT, "data/ledger.jsonl"), { source: "deep-prewarm" });
  return new QlooClient({ apiKey: readFileSync(join(process.env.HOME, ".config/gigbot/qloo-key"), "utf8").trim(), onLedger: (i) => ledger.record(i) });
};
const heatFile = (r) => join(RAW, `heat-${r.value.route.drinker.key}-${cityOf(r)}.json`);

const tags = knownTags();
const missing = new Map(); // city → Set(ids) (the ranked list: what the planner and the stops use)
for (const { row } of runs) {
  const ids = (row.value.route.lists?.all ?? []).map((x) => x[0]);
  for (const id of ids) if (!tags.has(id)) (missing.get(cityOf(row)) ?? missing.set(cityOf(row), new Set()).get(cityOf(row))).add(id);
}
const nMissing = [...missing.values()].reduce((a, s) => a + s.size, 0);
const batch = Number(args.batch ?? 200);

if (args.plan) {
  const heatTodo = runs.filter((r) => !existsSync(heatFile(r.row)));
  console.log(`${runs.length} runs in ${DIR}; ${tags.size} places tagged on disk; ${nMissing} ranked venues untagged → ${[...missing.values()].reduce((a, s) => a + Math.ceil(s.size / batch), 0)} entity calls at ${batch} a call; ${heatTodo.length} heatmaps to fetch`);
}

if (args.tags) {
  const q = qloo();
  const max = Number(args.max ?? 1);
  let made = 0;
  // --pack: one list over every city (the last batches of small cities share a call)
  const groups = args.pack ? [["all", new Set([...missing.values()].flatMap((x) => [...x]))]] : [...missing].sort((a, b) => b[1].size - a[1].size);
  for (const [city, set] of groups) {
    const ids = [...set];
    for (let i = 0; i < ids.length && made < max; i += batch) {
      const chunk = ids.slice(i, i + batch);
      made++;
      try {
        const body = await q.get("/entities", { entity_ids: chunk.join(",") });
        const got = Array.isArray(body?.results) ? body.results : body?.results?.entities ?? [];
        writeFileSync(join(RAW, `ent-${city}-${i}-${Date.now()}.json`), JSON.stringify({ at: new Date().toISOString().slice(0, 10), body }));
        console.log(`${city} ${i}: asked ${chunk.length}, got ${got.length}, with tags ${got.filter((e) => e.tags?.length).length}`);
      } catch (e) {
        console.log(`${city} ${i}: ${e.status ?? ""} ${e.message}`);
        break;
      }
    }
    if (made >= max) break;
  }
}

if (args.heat) {
  const q = qloo();
  const max = Number(args.max ?? 0);
  let made = 0;
  // --cities=a,b,c: these cities first, in this order (prewarm.mjs's own order: the biggest first)
  const order = String(args.cities ?? "").split(",").filter(Boolean);
  const rank = (r) => (order.indexOf(cityOf(r)) + 1 || order.length + 1);
  for (const { row } of runs.slice().sort((a, b) => rank(a.row) - rank(b.row) || shown(b) - shown(a))) {
    if (made >= max) break;
    if (existsSync(heatFile(row))) continue;
    made++;
    const rt = row.value.route;
    try {
      const body = await q.get("/v2/insights", { "filter.type": "urn:heatmap", "signal.interests.entities": rt.drinker.id, "filter.location.query": rt.city.query ?? rt.city.name, "output.heatmap.boundary": "urn:entity:locality" });
      writeFileSync(heatFile(row), JSON.stringify({ at: new Date().toISOString().slice(0, 10), body }));
      console.log(`${rt.drinker.key}|${cityOf(row)}: ${heatHoods(body, rt.city).slice(0, 4).map((h) => h.name).join(" · ")}`);
    } catch (e) {
      console.log(`${rt.drinker.key}|${cityOf(row)}: ${e.status ?? ""} ${e.message}`);
    }
  }
}

if (args.apply) {
  const backup = join(RAW, `prewarm-backup-${Date.now()}`);
  mkdirSync(backup, { recursive: true });
  const hooks = (key, type) => {
    const p = join(RAW, `${key}-${type}.json`);
    if (!existsSync(p)) return null;
    return (JSON.parse(readFileSync(p, "utf8")).body?.results?.entities ?? []).filter((e) => e.name).map((e) => ({ name: e.name, tags: [...new Set((e.tags ?? []).map((x) => x.name).filter(Boolean))].slice(0, 10) }));
  };
  const t = { runs: 0, venues: 0, tagged: 0, hooks: 0, heat: 0 };
  for (const { f, row } of runs) {
    const rt = row.value.route;
    copyFileSync(join(DIR, f), join(backup, f));
    for (const [id, v] of Object.entries(rt.venues ?? {})) {
      t.venues++;
      const tg = tags.get(id);
      if (tg) (v.tags = tg), t.tagged++;
    }
    // qloofull: what the run already holds stays when this checkout has no raw body for it (the raw cache is not shared)
    const prev = rt.culture ?? {};
    const culture = { captured: prev.captured ?? new Date().toISOString().slice(0, 10) };
    const tv = hooks(rt.drinker.key, "tv_show"), pod = hooks(rt.drinker.key, "podcast");
    if (tv || pod) (culture.hooks = { name: rt.drinker.name, category: null, lists: { tv_show: tv ?? [], podcast: pod ?? [] } }), t.hooks++;
    else if (prev.hooks) culture.hooks = prev.hooks;
    if (existsSync(heatFile(row))) {
      const hoods = heatHoods(JSON.parse(readFileSync(heatFile(row), "utf8")).body, rt.city).slice(0, 15);
      if (hoods.length) (culture.heat = hoods), t.heat++;
    } else if (prev.heat?.length) culture.heat = prev.heat;
    if (culture.hooks || culture.heat) rt.culture = culture;
    t.runs++;
    writeFileSync(join(DIR, f), JSON.stringify(row));
  }
  console.log(`applied to ${t.runs} runs: ${t.tagged}/${t.venues} venues tagged, hooks on ${t.hooks}, heat on ${t.heat}. Backup: ${backup}`);
}
