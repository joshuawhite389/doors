// R9 deep "heat": where in a city a brand's fans are (Qloo heatmap, locality boundaries), one call per brand × city,
// cached on disk, every call in data/ledger.jsonl (source "deep-heat"). Builds public/data/culture/heat.json
// (Qloo-derived, private: the public export drops public/data). Rank only: Qloo's locality affinity is a rank, not a
// strength (R9 probe), so only the order is kept.
//
//   node scripts/deep-heat.mjs --dry                 the calls a run would make
//   node scripts/deep-heat.mjs --run [--max=32]      make them (held brands × held cities)
//   node scripts/deep-heat.mjs --build               write public/data/culture/heat.json from the cache (no call)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { QlooClient } from "../src/qloo.js";
import { makeLedger } from "../src/ledger.js";
import { heatHoods } from "../public/lib/culture.js";

const ROOT = new URL("..", import.meta.url).pathname;
const RAW = join(ROOT, "data/culture-raw");
const OUT = join(ROOT, "public/data/culture/heat.json");
const PROBE = join(process.env.HOME, ".agent-work/projects/oldjardworkspace/brains/qloo-hackathon/qloo-probes/2026-10-22");
const PROBE_FILE = { "casamigos|austin": "deep-h-heat-locality.json", "liquid-death|austin": "deep-h-heat-locality-liquid.json", "casamigos|chicago": "deep-h-heat-locality-casamigos-chi.json" };
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")).map(([k, v]) => [k, v ?? true]));
const index = JSON.parse(readFileSync(join(ROOT, "public/data/index.json"), "utf8"));
const combos = index.brands.flatMap((b) => index.cities.map((c) => ({ b, c, key: `${b.key}|${c.key}` })));
const rawFile = (key) => join(RAW, `heat-${key.replace("|", "-")}.json`);
function cached(key) {
  if (existsSync(rawFile(key))) return JSON.parse(readFileSync(rawFile(key), "utf8"));
  const p = PROBE_FILE[key] && join(PROBE, PROBE_FILE[key]);
  if (p && existsSync(p)) {
    const j = JSON.parse(readFileSync(p, "utf8"));
    return { at: "2026-10-22", body: j.body ?? j, from: "probe" };
  }
  return null;
}

if (args.dry || args.run) {
  const todo = combos.filter((x) => !cached(x.key));
  const max = Number(args.max ?? 32);
  console.log(`${todo.length} calls to make (max ${max})`);
  if (args.dry) process.exit(0);
  if (todo.length > max) throw new Error(`over --max=${max}`);
  mkdirSync(RAW, { recursive: true });
  const ledger = makeLedger(join(ROOT, "data/ledger.jsonl"), { source: "deep-heat" });
  const q = new QlooClient({ apiKey: readFileSync(join(process.env.HOME, ".config/gigbot/qloo-key"), "utf8").trim(), onLedger: (i) => ledger.record(i) });
  for (const { b, c, key } of todo) {
    try {
      const body = await q.get("/v2/insights", { "filter.type": "urn:heatmap", "signal.interests.entities": b.id, "filter.location.query": c.query ?? c.name, "output.heatmap.boundary": "urn:entity:locality" });
      writeFileSync(rawFile(key), JSON.stringify({ at: new Date().toISOString().slice(0, 10), body }));
      console.log(`${key}: ${heatHoods(body, c).slice(0, 5).map((h) => h.name).join(" · ")}`);
    } catch (e) {
      console.log(`${key}: ${e.status ?? ""} ${e.message}`);
    }
  }
}

if (args.build) {
  const out = { v: 1, note: "Qloo heatmap (locality boundaries) per brand × city: the city's neighbourhoods in Qloo's order for the brand's fans. Rank only.", runs: {} };
  for (const { c, key } of combos) {
    const r = cached(key);
    if (!r) continue;
    const hoods = heatHoods(r.body, c).slice(0, 15);
    if (hoods.length) out.runs[key] = { captured: r.at, hoods };
  }
  mkdirSync(join(ROOT, "public/data/culture"), { recursive: true });
  writeFileSync(OUT, JSON.stringify(out));
  console.log(`${Object.keys(out.runs).length} brand × city runs → ${OUT}`);
}
