// R9 deep "hooks": what a brand's drinkers also like (Qloo cross-domain: TV shows, podcasts, destinations), one call
// per brand × type, cached on disk, every call in data/ledger.jsonl (source "deep-hooks"). Builds
// public/data/culture/hooks.json (Qloo-derived: the public export drops public/data).
//
//   node scripts/deep-hooks.mjs --dry                     the calls a run would make; none made
//   node scripts/deep-hooks.mjs --brands=a,b --types=tv_show,podcast [--max=12]
//   node scripts/deep-hooks.mjs --distinct                overlap of each brand's lists with its category's (no call)
//   node scripts/deep-hooks.mjs --build                   write public/data/culture/hooks.json from the cache (no call)
//
// Brands: the held ones (public/data/index.json) and the prewarm set (data/prewarm/brands.json, private), by key.
// Raw bodies: data/culture-raw/<key>-<type>.json (gitignored). The R9 probe's own answers for Casamigos and Liquid Death
// are read from its folder first (0 calls).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { QlooClient } from "../src/qloo.js";
import { makeLedger } from "../src/ledger.js";

const ROOT = new URL("..", import.meta.url).pathname;
const RAW = join(ROOT, "data/culture-raw");
const OUT = join(ROOT, "public/data/culture/hooks.json");
const PROBE = join(process.env.HOME, ".agent-work/projects/oldjardworkspace/brains/qloo-hackathon/qloo-probes/2026-10-22");
const PROBE_KEY = { casamigos: "casamigos", "liquid-death": "liquid" };
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")).map(([k, v]) => [k, v ?? true]));
export const TYPES = ["tv_show", "podcast", "destination"];

const slug = (s) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
function brands() {
  const index = JSON.parse(readFileSync(join(ROOT, "public/data/index.json"), "utf8"));
  const out = new Map(index.brands.map((b) => [b.key, { key: b.key, name: b.name, id: b.id, category: b.category }]));
  const pw = [join(ROOT, "data/prewarm/brands.json"), join(ROOT, "../doors/data/prewarm/brands.json")].find(existsSync);
  if (pw) for (const [q, b] of Object.entries(JSON.parse(readFileSync(pw, "utf8")))) {
    const key = slug(b.name ?? q); // the key a run stores (route.drinker.key): Qloo's name, slugged
    if (!out.has(key) && b?.id) out.set(key, { key, name: q, id: b.id, qlooName: b.name, category: b.where ?? null });
  }
  return out;
}
const rawFile = (key, type) => join(RAW, `${key}-${type}.json`);
function cached(key, type) {
  if (existsSync(rawFile(key, type))) return JSON.parse(readFileSync(rawFile(key, type), "utf8"));
  const p = PROBE_KEY[key] && join(PROBE, `deep-x-${PROBE_KEY[key]}-${type}.json`);
  if (p && existsSync(p)) {
    const j = JSON.parse(readFileSync(p, "utf8"));
    return { at: j.at ?? "2026-10-22", body: j.body ?? j, from: "probe" };
  }
  return null;
}
const names = (rec) => (rec?.body?.results?.entities ?? []).map((e) => e.name).filter(Boolean);

const all = brands();
if (args.dry || args.brands) {
  const want = String(args.brands ?? [...all.keys()].join(",")).split(",").filter(Boolean);
  const types = String(args.types ?? TYPES.join(",")).split(",");
  const todo = want.flatMap((k) => types.map((t) => [k, t])).filter(([k, t]) => !cached(k, t));
  const unknown = want.filter((k) => !all.has(k));
  if (unknown.length) throw new Error(`unknown brands: ${unknown.join(", ")}`);
  const max = Number(args.max ?? 20);
  console.log(`${todo.length} calls to make (max ${max}): ${todo.map(([k, t]) => `${k}/${t}`).join(" ")}`);
  if (args.dry) process.exit(0);
  if (todo.length > max) throw new Error(`over --max=${max}`);
  mkdirSync(RAW, { recursive: true });
  const ledger = makeLedger(join(ROOT, "data/ledger.jsonl"), { source: "deep-hooks" });
  const q = new QlooClient({ apiKey: readFileSync(join(process.env.HOME, ".config/gigbot/qloo-key"), "utf8").trim(), onLedger: (i) => ledger.record(i) });
  for (const [k, t] of todo) {
    const b = all.get(k);
    try {
      const body = await q.get("/v2/insights", { "filter.type": `urn:entity:${t}`, "signal.interests.entities": b.id, take: 10 });
      writeFileSync(rawFile(k, t), JSON.stringify({ at: new Date().toISOString().slice(0, 10), brand: b, type: t, body }));
      console.log(`${k}/${t}: ${names({ body }).slice(0, 5).join(" · ")}`);
    } catch (e) {
      console.log(`${k}/${t}: ${e.status ?? ""} ${e.message}`);
    }
  }
}

if (args.distinct) {
  // within a category, how much of a brand's list is shared with the others' (the hook says nothing if it's shared)
  const groups = String(args.distinct === true ? "casamigos,don-julio,espolon,teremana;white-claw,truly-hard-seltzer;lacroix,liquid-death" : args.distinct).split(";").map((g) => g.split(","));
  for (const type of TYPES) {
    for (const g of groups) {
      const lists = g.map((k) => [k, names(cached(k, type))]).filter(([, l]) => l.length);
      if (lists.length < 2) continue;
      for (const [k, l] of lists) {
        const others = new Set(lists.filter(([o]) => o !== k).flatMap(([, x]) => x));
        const own = l.filter((n) => !others.has(n));
        console.log(`${type.padEnd(11)} ${k.padEnd(20)} ${own.length}/${l.length} own: ${own.slice(0, 4).join(" · ")}${l.length - own.length ? ` | shared: ${l.filter((n) => others.has(n)).slice(0, 4).join(" · ")}` : ""}`);
      }
      console.log("");
    }
  }
}

if (args.build) {
  const out = { v: 1, note: "Qloo: what a brand's drinkers also like (filter.type tv_show/podcast/destination + the brand as signal, take 10). Private: public/data never leaves the private tree.", brands: {} };
  for (const [k, b] of all) {
    const rec = Object.fromEntries(TYPES.map((t) => [t, cached(k, t)]).filter(([, r]) => r));
    if (!Object.keys(rec).length) continue;
    out.brands[k] = { name: b.name, id: b.id, category: b.category ?? null, captured: Object.values(rec).map((r) => r.at).sort()[0], lists: Object.fromEntries(Object.entries(rec).map(([t, r]) => [t, (r.body?.results?.entities ?? []).filter((e) => e.name).map((e) => ({ name: e.name, tags: [...new Set((e.tags ?? []).map((x) => x.name).filter(Boolean))].slice(0, 10) }))])) };
  }
  mkdirSync(join(ROOT, "public/data/culture"), { recursive: true });
  writeFileSync(OUT, JSON.stringify(out));
  console.log(`${Object.keys(out.brands).length} brands → ${OUT}`);
}
