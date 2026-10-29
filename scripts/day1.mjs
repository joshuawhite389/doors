// The day-1 kill tests (SPEC §9 M1), rerun from this repo's cached precompute + 1 call (Patrón, Austin).
// Writes tests/day1.md. Called by `node scripts/precompute.mjs day1`.
import { writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { doorParams, sisterParams, entities } from "../src/plan.js";
import { overlap, genreLabel, km } from "../public/lib/core.js";

export async function day1({ get, loadEntities, CONFIG, ROOT }) {
  const ent = loadEntities();
  const names = (b) => entities(b).map((e) => e.entity_id);
  const L = [];
  const out = (s = "") => L.push(s);
  out("# Day-1 tests (rerun from the repo)");
  out("");
  out(`Run ${new Date().toISOString().slice(0, 10)} by \`node scripts/precompute.mjs day1\`. Raw lists are Qloo's top 50 before the food-and-drink filter, as in PROBES §14.`);
  out("");
  // 1. tequila pairs, Austin, uncapped page 1 (the probe's setting)
  out("## 1. Within-category discrimination: tequila pairs in Austin (kill line: >25/50 shared, except Don Julio/Patrón)");
  out("");
  const teq = { casamigos: "Casamigos", "don-julio": "Don Julio", espolon: "Espolòn", teremana: "Teremana" };
  const lists = {};
  for (const [k, n] of Object.entries(teq)) lists[n] = names(await get("/v2/insights", doorParams({ signalId: ent.brands[k].chosen.id, city: "Austin", page: 1, cap: null }), `${k}-austin uncapped`));
  lists["Patrón"] = names(await get("/v2/insights", doorParams({ signalId: ent.extra.patron.chosen.id, city: "Austin", page: 1, cap: null }), "patron-austin uncapped"));
  out("| pair | shared of 50 | verdict |");
  out("|---|---|---|");
  const ks = Object.keys(lists);
  let fails = 0;
  for (let i = 0; i < ks.length; i++)
    for (let j = i + 1; j < ks.length; j++) {
      const n = overlap(lists[ks[i]], lists[ks[j]]);
      const exempt = [ks[i], ks[j]].sort().join("/") === "Don Julio/Patrón";
      const pass = n <= 25 || exempt;
      if (!pass) fails++;
      out(`| ${ks[i]} / ${ks[j]} | ${n} | ${pass ? (exempt && n > 25 ? "exempt (the steakhouse pair)" : "pass") : "**FAIL**"} |`);
    }
  out("");
  out(`Result: ${fails ? `**${fails} pair(s) over the line**` : "pass"}.`);
  out("");
  // 2. popularity cap keeps specificity: capped page-1 overlaps between brands, every city
  out("## 2. The popularity cap (0.9) keeps brand specificity");
  out("");
  out("Capped top-50 overlap between brand pairs, per city (lower = more brand-specific). Median and maximum over the 28 pairs; Athletic vs Casamigos named.");
  out("");
  out("| city | median pair overlap | max pair (brands) | Athletic / Casamigos |");
  out("|---|---|---|---|");
  for (const c of CONFIG.cities) {
    const caps = {};
    for (const b of CONFIG.brands) caps[b.name] = names(await get("/v2/insights", doorParams({ signalId: ent.brands[b.key].chosen.id, city: c.query, page: 1 }), `${b.key}-${c.key} p1`));
    const pairs = [];
    const bn = Object.keys(caps);
    for (let i = 0; i < bn.length; i++) for (let j = i + 1; j < bn.length; j++) pairs.push([overlap(caps[bn[i]], caps[bn[j]]), `${bn[i]}/${bn[j]}`]);
    pairs.sort((a, b) => a[0] - b[0]);
    const med = pairs[Math.floor(pairs.length / 2)][0];
    const mx = pairs[pairs.length - 1];
    out(`| ${c.name} | ${med}/50 | ${mx[0]}/50 (${mx[1]}) | ${overlap(caps["Athletic Brewing"], caps["Casamigos"])}/50 |`);
  }
  out("");
  const capAus = names(await get("/v2/insights", doorParams({ signalId: ent.brands.casamigos.chosen.id, city: "Austin", page: 1 }), "casamigos-austin p1"));
  const pop = entities(await get("/v2/insights", doorParams({ signalId: ent.brands.casamigos.chosen.id, city: "Austin", page: 1, cap: null }), "casamigos-austin uncapped")).map((e) => e.popularity).sort();
  const popC = entities(await get("/v2/insights", doorParams({ signalId: ent.brands.casamigos.chosen.id, city: "Austin", page: 1 }), "casamigos-austin p1")).map((e) => e.popularity).sort();
  out(`Casamigos in Austin: uncapped median popularity ${pop[25]?.toFixed(3)}, capped ${popC[25]?.toFixed(3)}; capped vs uncapped share ${overlap(capAus, lists["Casamigos"])}/50 rooms.`);
  out("");
  // 3. ten random sister-door lists (seeded), from the precomputed showcase doors
  out("## 3. Ten random sister-door lists (seeded pick from the 409 showcase doors)");
  out("");
  const pool = [];
  for (const c of CONFIG.cities) {
    const city = JSON.parse(readFileSync(join(ROOT, "public/data/cities", `${c.key}.json`), "utf8"));
    const venues = {};
    for (const b of CONFIG.brands) {
      try {
        Object.assign(venues, JSON.parse(readFileSync(join(ROOT, "public/data/routes", `${b.key}-${c.key}.json`), "utf8")).venues);
      } catch {}
    }
    for (const id of Object.keys(city.sisters)) if (venues[id]) pool.push({ c, v: venues[id], sis: city.sisters[id].map(([sid]) => venues[sid] ?? city.sisterVenues[sid]).filter(Boolean) });
  }
  let seed = 20261008;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const picks = [];
  while (picks.length < 10 && pool.length) picks.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
  for (const p of picks) {
    const d = p.sis.slice(0, 6).map((s) => km(p.v, s)).filter(Number.isFinite).sort((a, b) => a - b);
    out(`- **${p.v.name}** (${p.c.name}, ${p.v.neighborhood ?? "no neighbourhood"}, ${genreLabel(p.v)}) → ${p.sis.slice(0, 6).map((s) => `${s.name} (${genreLabel(s)}${s.neighborhood ? `, ${s.neighborhood}` : ""})`).join("; ")}. Median distance ${d.length ? d[Math.floor(d.length / 2)].toFixed(1) : "?"} km.`);
  }
  out("");
  out("Verdict per list: see the reviewer note below (written by the builder after reading the lists).");
  writeFileSync(join(ROOT, "tests/day1.md"), L.join("\n") + "\n");
  console.log(L.join("\n"));
}
