// The saved runs (data/prewarm/*.json: the popular brand × city runs scripts/prewarm.mjs wrote, what a judge opens
// first), in the order the bakes work them: the biggest cities first (gigbot 10-27: most-shown first), then by brand.
// Shared by enrich-bake --runs, deep-bake and talk-max --all. A run's city object (value.city) stands in for
// public/data/cities/<city>.json where that file doesn't exist (the 12 cities beyond Austin and Chicago).
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

export const CITY_ORDER = ["New York", "Los Angeles County", "Chicago", "Houston", "Phoenix", "San Diego", "Dallas", "Austin", "Seattle", "Denver", "Nashville", "Boston", "Atlanta", "Miami-Dade County"];
export const RUN_TOP = 40; // the doors a run bakes: the top of its ranked list

export function savedRuns(ROOT) {
  const dir = join(ROOT, "data/prewarm");
  if (!existsSync(dir)) return [];
  const rows = readdirSync(dir).filter((f) => /^[0-9a-f]{24}\.json$/.test(f)).map((f) => ({ f, ...JSON.parse(readFileSync(join(dir, f), "utf8")) })).filter((r) => r.value?.route && r.value?.city?.city);
  const rank = (r) => { const i = CITY_ORDER.indexOf(r.metadata?.cityName ?? r.value.city?.name); return i < 0 ? 99 : i; };
  rows.sort((a, b) => rank(a) - rank(b) || String(a.metadata?.name ?? "").localeCompare(String(b.metadata?.name ?? "")));
  return rows.map((r) => ({ hash: r.f.slice(0, 24), file: r.f, key: r.key, brand: r.metadata?.name ?? r.value.route.drinker?.name, cityName: r.metadata?.cityName ?? r.value.city?.name, cityKey: r.value.city.city, route: r.value.route, city: r.value.city }));
}
export const runCities = (runs) => [...new Set(runs.map((r) => r.cityKey))];
// the doors of a city across its runs: each run's top RUN_TOP, first seen first; venues from the routes (+ sister venues)
export function runVenues(runs, cityKey, top = RUN_TOP) {
  const venues = {};
  const ids = [];
  for (const r of runs.filter((x) => x.cityKey === cityKey)) {
    for (const [id] of r.route.lists.all.slice(0, top)) {
      const v = r.route.venues[id];
      if (!v) continue;
      if (!venues[id]) ids.push(id);
      venues[id] ??= v;
    }
  }
  for (const r of runs.filter((x) => x.cityKey === cityKey)) for (const [id, v] of Object.entries(r.city.sisterVenues ?? {})) venues[id] ??= v;
  return { ids, venues };
}
// a city object in the shape of public/data/cities/<city>.json, from the city's runs (sisters merged)
export function runCityFile(runs, cityKey) {
  const rs = runs.filter((x) => x.cityKey === cityKey);
  if (!rs.length) return null;
  const sisters = {}, sisterVenues = {};
  for (const r of rs) { Object.assign(sisters, r.city.sisters ?? {}); Object.assign(sisterVenues, r.city.sisterVenues ?? {}); }
  return { ...rs[0].city, sisters, sisterVenues };
}
export const runRoutes = (runs, cityKey) => runs.filter((x) => x.cityKey === cityKey).map((r) => r.route);
