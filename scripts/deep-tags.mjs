// R9 deep: put Qloo's room tag families (core.tagFamilies) on every venue of the held routes, from the raw Qloo bodies
// already on disk (data/raw, data/raw-live: the precompute's and live runs' own responses). 0 Qloo calls, no
// re-precompute: only the `tags` field of each venue record is added or replaced; everything else is byte-for-byte.
//
//   node scripts/deep-tags.mjs [--raw=<dir>,<dir>] [--prewarm=<dir>] [--check]
//
// --raw      raw body dirs (default: data/raw and data/raw-live of this checkout, else of ../doors)
// --prewarm  also tag the venues of saved prewarm runs (data/prewarm/*.json, private) where a raw body has them
// --check    count coverage only, write nothing
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tagFamilies } from "../public/lib/core.js";

const ROOT = new URL("..", import.meta.url).pathname;
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")).map(([k, v]) => [k, v ?? true]));
const near = (d) => [join(ROOT, d), join(ROOT, "../doors", d)].find(existsSync);
const rawDirs = (typeof args.raw === "string" ? args.raw.split(",") : [near("data/raw"), near("data/raw-live")]).filter(Boolean);

const tags = new Map();
for (const dir of rawDirs) {
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    let body;
    try {
      body = JSON.parse(readFileSync(join(dir, f), "utf8")).body;
    } catch {
      continue;
    }
    const ents = Array.isArray(body?.results?.entities) ? body.results.entities : Array.isArray(body?.results) ? body.results : [];
    for (const e of ents) {
      if (!e?.entity_id || tags.has(e.entity_id)) continue;
      const t = tagFamilies(e.tags);
      if (t) tags.set(e.entity_id, t);
    }
  }
}
console.log(`raw: ${rawDirs.join(", ")} → ${tags.size} places with tag families`);

function tagRoute(route) {
  let n = 0;
  let had = 0;
  for (const [id, v] of Object.entries(route?.venues ?? {})) {
    const t = tags.get(id);
    if (!t) continue;
    had++;
    if (JSON.stringify(v.tags ?? null) !== JSON.stringify(t)) (v.tags = t), n++;
  }
  return { n, had, of: Object.keys(route?.venues ?? {}).length };
}

const routesDir = join(ROOT, "public/data/routes");
let tot = { n: 0, had: 0, of: 0 };
for (const f of readdirSync(routesDir).filter((x) => x.endsWith(".json")).sort()) {
  const p = join(routesDir, f);
  const route = JSON.parse(readFileSync(p, "utf8"));
  const r = tagRoute(route);
  for (const k in tot) tot[k] += r[k];
  if (r.n && !args.check) writeFileSync(p, JSON.stringify(route));
  console.log(`${f}: ${r.had}/${r.of} tagged${r.n ? `, ${r.n} updated` : ""}`);
}
console.log(`held routes: ${tot.had}/${tot.of} venues tagged, ${tot.n} updated${args.check ? " (check only)" : ""}`);

if (args.prewarm) {
  const dir = args.prewarm === true ? near("data/prewarm") : args.prewarm;
  let p = { n: 0, had: 0, of: 0 };
  for (const f of readdirSync(dir).filter((x) => /^[0-9a-f]{24}\.json$/.test(x))) {
    const row = JSON.parse(readFileSync(join(dir, f), "utf8"));
    if (!row.value?.route) continue;
    const r = tagRoute(row.value.route);
    for (const k in p) p[k] += r[k];
    if (r.n && !args.check) writeFileSync(join(dir, f), JSON.stringify(row));
  }
  console.log(`prewarm runs: ${p.had}/${p.of} venues tagged, ${p.n} updated`);
}
