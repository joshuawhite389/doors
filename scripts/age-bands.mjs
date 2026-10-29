// r2 (Jard 10-24): the two age bands the form added, 21–24 (Qloo's "24_and_younger", key under_25) and 55 and over
// ("55_and_older", key 55_plus), for every held brand × city route that lacks them: page 1 of the same door call with
// signal.demographics.age, as the precompute fetches the other bands. Patches only `lists[band]`, `dropped[band]` and
// any venue the band brings that the route doesn't hold (with its tag families, as scripts/deep-tags.mjs does), and
// index.json's `ages`; everything else stays byte-for-byte. No rebuild (precompute build refuses: the data is enriched).
//
//   node scripts/age-bands.mjs [--dry] [--max=N]
//
// Every call goes to data/ledger.jsonl (source "age-bands"); raw bodies to data/raw (gitignored), never fetched twice.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { QlooClient } from "../src/qloo.js";
import { makeLedger } from "../src/ledger.js";
import { doorParams, venuesFromPage, entities } from "../src/plan.js";
import { tagFamilies } from "../public/lib/core.js";
import { CONFIG } from "./config.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const RAW = join(ROOT, "data/raw");
mkdirSync(RAW, { recursive: true });
const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const MAX = Number(args.find((a) => a.startsWith("--max="))?.split("=")[1] ?? Infinity);
const BANDS = ["under_25", "55_plus"];

const ent = JSON.parse(readFileSync(join(ROOT, "data/entities.json"), "utf8"));
const ledger = makeLedger(join(ROOT, "data/ledger.jsonl"), { source: "age-bands" });
let client = null;
let fresh = 0;
let would = 0;
const rawFile = (params) => join(RAW, `${createHash("sha256").update(`GET /v2/insights ${JSON.stringify(params)}`).digest("hex").slice(0, 24)}.json`);
async function get(params, label) {
  const f = rawFile(params);
  if (existsSync(f)) return JSON.parse(readFileSync(f, "utf8")).body;
  if (DRY) return void would++;
  if (fresh >= MAX) throw new Error(`--max=${MAX} reached`);
  ledger.assertBudget(1);
  client ??= new QlooClient({ apiKey: process.env.QLOO_API_KEY ?? readFileSync(join(homedir(), ".config/gigbot/qloo-key"), "utf8").trim(), minGapMs: 400, onLedger: (e) => ledger.record(e) });
  fresh++;
  try {
    const body = await client.get("/v2/insights", params);
    writeFileSync(f, JSON.stringify({ label, method: "GET", path: "/v2/insights", params, at: new Date().toISOString(), body }));
    return body;
  } catch (e) {
    console.log(`  x ${label}: ${String(e.message).slice(0, 160)}`);
    return null;
  }
}

// as src/assemble.js writes a list row and a venue record
const STATIC_KEYS = ["affinity", "growth", "explain"];
const stripQuery = (v) => Object.fromEntries(Object.entries(v).filter(([k]) => !STATIC_KEYS.includes(k)));
const row = (v) => [v.id, v.affinity == null ? null : Math.round(v.affinity * 10000) / 10000, v.growth == null ? null : Math.round(v.growth * 1000) / 1000, v.explain?.length > 1 ? v.explain.map((x) => [x.id, Math.round(x.score * 1000) / 1000]) : null];

const summary = [];
for (const b of CONFIG.brands) {
  for (const c of CONFIG.cities) {
    const file = join(ROOT, "public/data/routes", `${b.key}-${c.key}.json`);
    if (!existsSync(file)) continue;
    const route = JSON.parse(readFileSync(file, "utf8"));
    let changed = false;
    for (const key of BANDS) {
      if (route.lists[key]) continue;
      const body = await get(doorParams({ signalId: ent.brands[b.key].chosen.id, city: c.query, page: 1, ageBuckets: CONFIG.ages[key].buckets }), `${b.key}-${c.key} age ${key}`);
      if (!body) continue;
      const tagsOf = new Map(entities(body).map((e) => [e.entity_id, tagFamilies(e.tags)]));
      const r = venuesFromPage(body, { alcohol: !b.na });
      let added = 0;
      for (const v of r.venues) {
        if (route.venues[v.id]) continue;
        const t = tagsOf.get(v.id);
        route.venues[v.id] = { ...stripQuery(v), ...(t ? { tags: t } : {}) };
        added++;
      }
      route.lists[key] = r.venues.map(row);
      route.dropped[key] = { n: r.dropped, names: r.droppedNames.slice(0, 20) };
      changed = true;
      summary.push(`${b.key}-${c.key} ${key}: ${route.lists[key].length} doors (${added} new to the route)`);
    }
    if (changed && !DRY) writeFileSync(file, JSON.stringify(route));
  }
}
if (!DRY) {
  const f = join(ROOT, "public/data/index.json");
  const index = JSON.parse(readFileSync(f, "utf8"));
  index.ages = CONFIG.ages;
  writeFileSync(f, JSON.stringify(index, null, 1)); // as the file is: one-space indent, no final newline
}
console.log(summary.join("\n"));
console.log(`age-bands: ${fresh} Qloo calls${DRY ? `, ${would} would be made` : ""} · ledger ${ledger.count} this month`);
