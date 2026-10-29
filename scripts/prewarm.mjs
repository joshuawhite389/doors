// Pre-warm popular live runs ("popular runs cached from real Qloo calls"): the Worker's own
// agent (runRoute) for a fixed demo set of popular US drink brands × big US cities, run locally with the real key, each
// result written as the exact KV value under the exact key the Worker reads (kvRunKey), so the site starts with them
// saved and a judge's first runs there are free. RULES.md: no bulk scraping beyond this demo set.
//
//   node scripts/prewarm.mjs --dry-run          the combos and the estimated Qloo calls; no call
//   node scripts/prewarm.mjs --limit=2          the first 2 combos not done yet (resumable: done keys are skipped)
//   node scripts/prewarm.mjs                    every combo (≤ 150; about 21 calls each)
//   node scripts/prewarm.mjs --bulk=<dir>       the KV bulk files for scripts/publish.sh, ≤ 60 MB each (no call)
//
// Writes data/prewarm/ (private; data/ is never committed or exported): <hash>.json = {key, value, metadata} per run,
// exactly as the Worker writes a run (one KV value; the saved-runs entry, with Qloo's name for the city, as its
// metadata: the free plan's 1,000 writes a day, src/kvbook.js), and brands.json (each brand's Qloo id, resolved once).
// Files from before (a {ref} alias, no metadata) are made current with scripts/prewarm-convert.mjs, no call. Every Qloo request goes in data/ledger.jsonl (source "prewarm"); ≥ 250 ms between calls, ≤ 2 retries on a
// 429 or 5xx (src/qloo.js), and the build's ledger budget is checked before every run.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { homedir } from "node:os";
import { QlooClient } from "../src/qloo.js";
import { makeLedger } from "../src/ledger.js";
import { runRoute, validateRoute, kvRunKey, runMeta, COST } from "../src/worker.js";
import { brandRows, pickBrand } from "../src/plan.js";
import { nameMatch } from "../public/lib/drinks.js";

const ROOT = new URL("..", import.meta.url).pathname;
const DIR = join(ROOT, "data/prewarm");
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")).map(([k, v]) => [k, v ?? true]));

import { BRANDS, CITIES, HELD_CITIES, PER_BRAND, combos } from "./prewarm-set.mjs"; // the curated set (test/prewarm-set.test.mjs guards it)
const index = JSON.parse(readFileSync(join(ROOT, "public/data/index.json"), "utf8"));
const fileOf = (key) => join(DIR, createHash("sha256").update(key).digest("hex").slice(0, 24) + ".json");
const done = (key) => existsSync(fileOf(key));
const write = (key, value, metadata) => writeFileSync(fileOf(key), JSON.stringify({ key, value, ...(metadata ? { metadata } : {}) }));
const PER_RUN = 36; // the agent's calls for one brand × city (3 pages, 5 age re-ranks, famous, 12 sisters, ≤ 12 sounds, 2 artist lists, 3 deep)

if (args.bulk) {
  // KV bulk files (a bulk request takes ≤ 100 MB and 10,000 pairs; each pair is one KV write): every run, its
  // saved-runs entry as metadata
  mkdirSync(DIR, { recursive: true });
  mkdirSync(args.bulk, { recursive: true });
  const rows = readdirSync(DIR).filter((f) => /^[0-9a-f]{24}\.json$/.test(f)).map((f) => JSON.parse(readFileSync(join(DIR, f), "utf8"))).filter((r) => r.value?.route);
  const ttl = 45 * 86400; // past the end of judging (Nov 16) for an upload in late October
  const pairs = rows.map((r) => ({ key: r.key, value: JSON.stringify(r.value), expiration_ttl: ttl, ...(r.metadata ? { metadata: r.metadata } : {}) }));
  const files = [[]];
  let size = 0;
  for (const p of pairs) {
    if (size + p.value.length > 60e6 || files.at(-1).length >= 9000) (files.push([]), (size = 0));
    files.at(-1).push(p);
    size += p.value.length;
  }
  files.forEach((f, i) => writeFileSync(join(args.bulk, `bulk-${String(i + 1).padStart(2, "0")}.json`), JSON.stringify(f)));
  console.log(`${rows.length} runs (${rows.filter((r) => r.metadata).length} listed among the saved runs) → ${files.length} file(s) in ${args.bulk}: ${rows.length} KV writes`);
  process.exit(0);
}

const list = combos();
const brandsFile = join(DIR, "brands.json");
mkdirSync(DIR, { recursive: true });
const brands = existsSync(brandsFile) ? JSON.parse(readFileSync(brandsFile, "utf8")) : {};
const matched = (q) => brands[q] && nameMatch(brands[q].name, q) >= 2;
for (const q of Object.keys(brands)) if (!matched(q)) console.log(`!! "${q}" was saved as ${brands[q].name}: no name match, it will be searched again`);
const searches = BRANDS.filter((b) => !b.held && !matched(b.q)).length;
if (args["dry-run"]) {
  for (const c of list) console.log(`${c.brand.q ?? c.brand.held} × ${c.city}`);
  const todo = list.filter((c) => !c.brand.q || !matched(c.brand.q) || !done(kvRunKey("live", inputOf(c, brands[c.brand.q]))));
  console.log(`${list.length} combos (${todo.length} not done) · about ${todo.length * PER_RUN + searches} Qloo calls (${PER_RUN} a run + ${searches} brand searches)`);
  process.exit(0);
}

function inputOf(c, b) {
  const held = c.brand.held ? index.brands.find((x) => x.key === c.brand.held) : null;
  const { input } = validateRoute({ kind: "brand", id: held?.id ?? b?.id, name: held?.name ?? b?.name, city: c.city, na: Boolean(held?.na) });
  return input;
}

const key = (process.env.QLOO_API_KEY ?? readFileSync(join(homedir(), ".config/gigbot/qloo-key"), "utf8")).trim();
const gem = process.env.GEMINI_API_KEY ?? (existsSync(join(homedir(), ".config/gigbot/gemini-key")) ? readFileSync(join(homedir(), ".config/gigbot/gemini-key"), "utf8").trim() : undefined);
const ledger = makeLedger(join(ROOT, "data/ledger.jsonl"), { source: "prewarm" });
const qloo = new QlooClient({ apiKey: key, onLedger: (e) => ledger.record(e) }); // 250 ms between calls, ≤ 2 retries

// each brand's Qloo id, once, when a run first needs it: Qloo's top row for the name, and only if that row's name
// matches it (owner review 7: "High Noon" resolved to Miller High Life). No match: stop loudly, that brand fails.
// A brand resolved before this rule is checked the same way and searched again if it doesn't match.
function resolveBrand(q, rows) {
  const b = pickBrand(rows, q);
  if (!b) throw new Error(`!! "${q}" → no name match; Qloo had: ${rows.slice(0, 5).map((r) => r.name).join(", ") || "nothing"}`);
  return { id: b.id, name: b.name, where: b.where };
}
const failed = new Set(); // searched once this run, no match: not searched again
async function brandOf(q) {
  if (matched(q)) return brands[q];
  if (failed.has(q)) return null;
  ledger.assertBudget(1);
  const rows = brandRows(await qloo.search(q, { types: "urn:entity:brand", take: 10 }), q);
  try {
    brands[q] = resolveBrand(q, rows);
  } catch (e) {
    delete brands[q];
    failed.add(q);
    writeFileSync(brandsFile, JSON.stringify(brands, null, 1));
    return void console.error(e.message);
  }
  writeFileSync(brandsFile, JSON.stringify(brands, null, 1));
  console.log(`brand "${q}" → ${brands[q].name}${brands[q].where ? ` (${brands[q].where})` : ""}`);
  return brands[q];
}

// the runs, resumable
let ran = 0;
for (const c of list) {
  if (args.limit && ran >= Number(args.limit)) break;
  if (c.brand.q && matched(c.brand.q) && done(kvRunKey("live", inputOf(c, brands[c.brand.q])))) continue;
  const b = c.brand.q ? await brandOf(c.brand.q) : null;
  if (c.brand.q && !b) continue;
  const input = inputOf(c, b);
  const k = kvRunKey("live", input);
  if (done(k)) continue;
  ledger.assertBudget(COST.route);
  const before = qloo.calls;
  const at = new Date().toISOString().slice(0, 10);
  try {
    const out = await runRoute({ input, qloo, env: { GEMINI_API_KEY: gem }, emit: () => {} });
    write(k, { route: out.route, city: out.city, at }, runMeta(out, input, at));
    console.log(`${input.items[0].name} × ${c.city} → ${out.route.lists.all.length} rooms in ${out.route.city?.name ?? "?"} · ${qloo.calls - before} calls`);
  } catch (e) {
    console.log(`!! ${input.items[0].name} × ${c.city}: ${e.message.slice(0, 160)} · ${qloo.calls - before} calls`);
  }
  ran++;
}
console.log(`ledger: ${ledger.count} calls this month (budget ${ledger.remainingBudget() + ledger.count})`);
if (failed.size) {
  console.error(`!! no name match for ${[...failed].map((q) => `"${q}"`).join(", ")}: their runs were skipped`);
  process.exit(1);
}
