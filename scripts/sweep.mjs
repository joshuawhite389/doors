// The all-routes sweep (Diolosa R2): rebuild every precomputed route from the shipped files and check the route rules
// and the food-and-drink filter. No Qloo calls.   node scripts/sweep.mjs [--json]
import { readdirSync, readFileSync } from "node:fs";
import { buildRoute, parseHours, isOpenFor, legsCross, km } from "../public/lib/core.js";

const ROOT = new URL("..", import.meta.url).pathname;
// A broad "not a door" name test, wider than the filter itself, to measure what still reaches a route.
export const JUNK = /(coffee|espresso|\bboba\b|bubble tea|juice|smoothie|bakery|patisserie|grocer|\bmarket\b|\bdeli\b|delicatessen|sandwich|cater|panera|o['’]?hare|terminal \d|concourse|admirals club)/i;
const POURS = /(beer|wine|cocktail|taproom|tap house|taphouse|spirits|tavern|\bpub\b|saloon|cantina|mezcal|cider|kitchen|grill|bistro|\bbar\b|basque market|old market)/i; // Basque Market (Boise) is a tapas bar

export function sweep() {
  const out = { routes: 0, crossings: 0, kmMismatch: 0, longLegs: [], overSize: 0, junkRoutes: 0, junkSample: 0, junkDoors: new Set() };
  const files = readdirSync(ROOT + "public/data/routes").filter((f) => f.endsWith(".json"));
  for (const f of files) {
    const r = JSON.parse(readFileSync(ROOT + "public/data/routes/" + f, "utf8"));
    const city = JSON.parse(readFileSync(ROOT + `public/data/cities/${r.city.key}.json`, "utf8"));
    const sis = Object.fromEntries(Object.entries(city.sisters).map(([k, v]) => [k, v.map((x) => x[0])]));
    for (const [lk, list] of Object.entries(r.lists)) {
      for (const day of ["tuesday", "friday", "saturday", "sunday"]) {
        for (const part of ["lunch", "afternoon", "evening"]) {
          const rows = list.map((x) => r.venues[x[0]]).filter((v) => v && !v.closed && isOpenFor(parseHours(v.hours), day, part) !== false);
          const rt = buildRoute(rows, sis);
          const pts = rt.stops.map((s) => r.venues[s.id]);
          const main = ["tuesday", "friday", "sunday"].includes(day) && ["lunch", "evening"].includes(part);
          if (main) {
            out.routes++;
            for (let i = 1; i < pts.length; i++) for (let j = i + 2; j < pts.length; j++) if (legsCross(pts[i - 1], pts[i], pts[j - 1], pts[j])) out.crossings++;
            if (Math.abs(rt.km - Math.round(rt.legs.reduce((a, b) => a + b, 0) * 10) / 10) > 1e-9) out.kmMismatch++;
            if (rt.maxLegKm > 8) out.longLegs.push(`${f} ${lk} ${day} ${part} ${rt.maxLegKm} km`);
            if (rt.stops.length > 12) out.overSize++;
          }
          // Diolosa's sample: all-ages list, Tuesday and Saturday, three dayparts
          if (lk === "all" && ["tuesday", "saturday"].includes(day)) {
            out.junkSample++;
            const bad = pts.filter((v) => JUNK.test(v.name) && !POURS.test(v.name));
            if (bad.length) out.junkRoutes++;
            bad.forEach((v) => out.junkDoors.add(v.name));
          }
        }
      }
    }
  }
  out.junkDoors = [...out.junkDoors];
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const s = sweep();
  console.log(JSON.stringify({ ...s, longLegs: s.longLegs.slice(0, 10), longLegCount: s.longLegs.length }, null, process.argv.includes("--json") ? 1 : 0));
}
