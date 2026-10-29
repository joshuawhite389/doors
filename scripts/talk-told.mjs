// R2 grounding audit (Jard 10-24): every baked talking-point set (public/data/talk/<city>.json) checked again through
// the app's own path (lib/stopmodel.js → validateTalkSet), as talk-bake.mjs picks its doors. Lists the sets the checks
// now refuse (they fall back to the template until re-baked) and every line toldTheRoom drops. No calls.
//   node scripts/talk-told.mjs
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { examples } from "../public/lib/examples.js";
import { buildPool, windowsFor } from "../public/lib/pool.js";
import { planDays } from "../public/lib/schedule.js";
import { stopModel } from "../public/lib/stopmodel.js";
import { bakedTalkKey, validateTalkSet, toldTheRoom } from "../public/lib/talk-gen.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const readJson = (rel) => JSON.parse(readFileSync(join(ROOT, rel), "utf8"));
const CITY_NAMES = { austin: "Austin", chicago: "Chicago", boise: "Boise", omaha: "Omaha" };
const facts = readJson("public/data/facts.json").facts ?? [];
const stats = { doors: 0, sets: 0, refused: 0, setsWithTold: 0, toldLines: 0 };
const refused = [], told = [], shown = [];
stats.shownLines = 0; stats.shownTold = 0;
// the spoken lines on a stop as the app shows them (the opener, to the buyer, questions, points, pushback replies)
const spoken = (t) => [["opener", t.opener], ["toBuyer", t.toBuyer], ...t.questions.map((q) => ["question", q]), ...t.points.map((p) => ["point", typeof p === "string" ? p : p.text]), ...t.pushback.map((p) => ["reply", typeof p === "string" ? p : p.reply])].filter(([, x]) => x);
for (const ex of examples()) {
  const profile = ex.profile;
  const cityKey = profile.city;
  const city = readJson(`public/data/cities/${cityKey}.json`);
  const baked = existsSync(join(ROOT, `public/data/talk/${cityKey}.json`)) ? readJson(`public/data/talk/${cityKey}.json`).sets : {};
  const drinkerKeys = [...(profile.drinks ?? []).map((d) => d.key), ...((profile.pours ?? []).length ? ["parsons"] : [])];
  const routes = drinkerKeys.map((k) => readJson(`public/data/routes/${k}-${cityKey}.json`));
  const pool = buildPool({ routes, profile, cityName: CITY_NAMES[cityKey] });
  const planned = planDays({ pool: pool.rows, statuses: pool.statuses, windows: windowsFor(profile), visitMin: profile.visitMin ?? 25, pinned: pool.pinned });
  const plan = { city: { key: cityKey, name: CITY_NAMES[cityKey] }, profile, venues: { ...city.sisterVenues, ...pool.venues }, days: planned.days, pool: { ids: pool.ids, N: pool.N, label: pool.label }, statuses: pool.statuses };
  const ids = [...new Set([...planned.days.flatMap((d) => d.stops.map((s) => s.id)), ...pool.ids.slice(0, ex.key === "maya" ? 60 : 25)])];
  for (const id of ids) {
    const m = stopModel({ plan, id, city, facts, routes });
    if (!m.talkReq) continue;
    stats.doors++;
    const st = baked[bakedTalkKey({ id, profile, ask: m.talk.ask })];
    if (!st) continue;
    stats.sets++;
    const sm = stopModel({ plan, id, city, facts, routes, talkSets: { baked, live: {} } });
    for (const [where, x] of spoken(sm.talk)) {
      stats.shownLines++;
      const hit = toldTheRoom(x);
      if (hit) stats.shownTold++, shown.push(`${ex.key} · ${m.venue.name} · ${sm.talk.by} ${where}: ${x}`);
    }
    const r = validateTalkSet(st.set, m.talkReq);
    if (!r.ok) stats.refused++, refused.push(`${ex.key} · ${m.venue.name}: ${r.reason}`);
    const t = r.dropped.filter((d) => /own room/.test(d.reason));
    if (t.length) stats.setsWithTold++, (stats.toldLines += t.length);
    for (const d of t) told.push(`${ex.key} · ${m.venue.name} · ${d.where}: ${d.text}`);
  }
}
console.log(JSON.stringify(stats));
console.log(`--- refused (template until re-baked)\n${refused.join("\n")}`);
console.log(`--- shown lines that still tell the room (should be none)\n${shown.join("\n")}`);
console.log(`--- lines toldTheRoom drops\n${told.join("\n")}`);
