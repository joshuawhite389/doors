// Source: Qloo /v2/insights brand listings by tag (genre + industry), 2026-10-22, ledgered, private.
// The drink list for "Your drinker also drinks…" (owner review 7, M1): public/data/drinks.json, searched in the page as
// you type (public/lib/drinks.js searchDrinks), no Qloo call. Built from two Qloo brand lists already fetched and
// ledgered on 2026-10-22: every brand Qloo tags genre wine_and_spirits or
// food_and_beverage:drinks (data/drinks/genre.json), and every brand tagged industry alcoholic_beverages
// (data/drinks/industry.json). One row per brand: retailers, parent companies and non-drinks out. No Qloo call.
// Qloo-derived: data/ and public/data/ stay out of the public repo (scripts/export-public.sh).
// Run: node scripts/make-drinks.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { drinkKind, fold } from "../public/lib/drinks.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// shops (Total Wine & More, BevMo!, The Whisky Exchange, Magnolia), and brands that are about something else
const SHOP = /^urn:tag:(industry:qloo:(retail|e_commerce)|genre:brand:(retail|website|industrials|food_and_beverage:pet_food))$/;
// the groups that own the brands, not a drink anyone orders
const PARENT = /^(diageo( gb)?|pernod ricard|constellation brands|brown forman|molson coors brewing company|anheuser busch( inbev)?|ab inbev|carlsberg group|asahi group holdings|kirin holdings|suntory holdings|beam suntory|campari group|bacardi limited|treasury wine estates)$/;
const ALCOHOL = /wine_and_spirits|alcoholic|spirits|beer|wine/;

// rows: [{id, name, pop, tags}] from either list → [{id, name, kind, pop}], most popular first
export function makeDrinks(rows) {
  const byId = new Map();
  for (const r of rows) {
    const had = byId.get(r.id);
    byId.set(r.id, had ? { ...had, tags: [...new Set([...had.tags, ...r.tags])] } : { ...r, tags: [...r.tags] });
  }
  const byName = new Map(); // a name Qloo holds twice (Paulaner, Carling…): the more popular one
  for (const r of byId.values()) {
    const t = r.tags;
    if (t.some((x) => SHOP.test(x)) || PARENT.test(fold(r.name))) continue;
    if (!t.some((x) => /genre:brand:|product_category:/.test(x))) continue; // a company, not a product (Brown-Forman)
    if (t.some((x) => /genre:brand:health_and_beauty/.test(x)) && !t.some((x) => ALCOHOL.test(x))) continue; // supplements
    const kind = drinkKind(t, r.name);
    if (!kind && !t.some((x) => /drinks|alcoholic|beverage/.test(x))) continue;
    const row = { id: r.id, name: r.name, kind: kind ?? "Drink", pop: Math.round((r.pop ?? 0) * 1000) / 1000 };
    const k = fold(r.name);
    if (!byName.has(k) || byName.get(k).pop < row.pop) byName.set(k, row);
  }
  return [...byName.values()].sort((a, b) => b.pop - a.pop || a.name.localeCompare(b.name));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const read = (f) => JSON.parse(readFileSync(join(ROOT, "data/drinks", f), "utf8"));
  const genre = read("genre.json");
  const industry = read("industry.json");
  const out = makeDrinks([...genre, ...industry]);
  writeFileSync(join(ROOT, "public/data/drinks.json"), JSON.stringify(out) + "\n");
  console.log(`public/data/drinks.json: ${out.length} drinks (from ${genre.length} genre + ${industry.length} industry rows)`);
}
