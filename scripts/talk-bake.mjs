// Bake the written talking points for the demo and the examples (group 3 item 3), so a judge sees sets Claude wrote
// from Qloo's facts without a live call: for each example profile (lib/examples.js; Maya is the guided demo), the doors
// on its plan and the top of its Your list, through the same path the app uses (lib/stopmodel.js → talkReq) and the
// Worker's own call (src/talk.js talkTurn: TALK_MODEL, one call a door, every line checked). Writes
// public/data/talk/<city>.json {v, sets: {bakedKey: {set, model, at}}}; the app checks each set again before showing it.
// Every call is logged in data/talk-bake.jsonl with its $.
//   node scripts/talk-bake.mjs [--only=maya,dana] [--top=25] [--limit=N] [--dry] [--redo]
// --dry: build the facts and print the first door's prompt; no calls. --redo: write over sets already baked.
// --told: also write again the sets that pass but lose a line to toldTheRoom (R2).
// Round 3 (gigbot 10-25): each set is stamped with the key of the facts it was written from (lib/talk-gen.js talkKey:
// the rules' version + every fact, the enrich record included), so a plain run writes again only the doors whose
// facts changed since (or whose set the checks now refuse). A set with no stamp is written again; --stamp instead
// stamps every passing unstamped set with today's key, no call (only when you know they were written from today's
// facts). A billing or rate-limit error from Anthropic stops the run (exit 2, "STOP:" in the log) instead of burning
// through the list.
const STOP_ERROR = /credit|billing|insufficient|quota|rate.?limit|\b429\b|\b402\b|overloaded/i;
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { examples } from "../public/lib/examples.js";
import { buildPool, windowsFor } from "../public/lib/pool.js";
import { planDays } from "../public/lib/schedule.js";
import { stopModel } from "../public/lib/stopmodel.js";
import { talkUser, bakedTalkKey, validateTalkSet, talkKey } from "../public/lib/talk-gen.js";
import { talkTurn } from "../src/talk.js";
import { enrichFacts } from "../public/lib/enrich.js";
import { deepFactsFor } from "../public/lib/deep.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k, d = null) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? d;
const ONLY = arg("only")?.split(",") ?? null;
const TOP = Number(arg("top", 25));
const TOP_DEMO = Number(arg("top-demo", 60)); // the guided demo (Maya) plans other days than her example: deeper on her list
const LIMIT = Number(arg("limit", 0)) || Infinity;
const DRY = process.argv.includes("--dry");
const REDO = process.argv.includes("--redo");
// --told (R2 10-24): write again only the sets whose checks now drop a line that tells the buyer about their own room
const TOLD = process.argv.includes("--told");
const STAMP = process.argv.includes("--stamp");
const readJson = (rel) => JSON.parse(readFileSync(join(ROOT, rel), "utf8"));
const CITY_NAMES = { austin: "Austin", chicago: "Chicago", boise: "Boise", omaha: "Omaha" };
const key = DRY ? null : readFileSync(join(homedir(), ".config/gigbot/anthropic-key"), "utf8").trim();
// BAKE_USD: the bake's own $ cap (round 3: Sonnet at high effort is about $0.04 a door, so a full bake is ~$15)
const env = { ANTHROPIC_API_KEY: key, TALK_VISITOR_DAILY: 100000, TALK_WINDOW: 100000, AGENT_USD_DAILY: Number(process.env.BAKE_USD ?? 60), ...(process.env.TALK_MODEL ? { TALK_MODEL: process.env.TALK_MODEL } : {}) };
const facts = readJson("public/data/facts.json").facts ?? [];
const LEDGER = join(ROOT, "data/talk-bake.jsonl");

const outs = {};
const NOTE = "Talking points written per door from Qloo's facts by scripts/talk-bake.mjs (the model is in each set); each set passed lib/talk-gen.js validateTalkSet and is checked again in the app.";
const outOf = (city) => (outs[city] ??= existsSync(join(ROOT, `public/data/talk/${city}.json`)) ? { ...readJson(`public/data/talk/${city}.json`), note: NOTE } : { v: 1, note: NOTE, sets: {} });
let calls = 0, usd = 0, ok = 0, refused = 0, changed = 0, stamped = 0, stop = null;

for (const ex of examples()) {
  if (ONLY && !ONLY.includes(ex.key)) continue;
  const profile = ex.profile;
  const cityKey = profile.city;
  const city = readJson(`public/data/cities/${cityKey}.json`);
  const drinkerKeys = [...(profile.drinks ?? []).map((d) => d.key), ...((profile.pours ?? []).length ? ["parsons"] : [])];
  const routes = drinkerKeys.map((k) => readJson(`public/data/routes/${k}-${cityKey}.json`));
  const pool = buildPool({ routes, profile, cityName: CITY_NAMES[cityKey] });
  const planned = planDays({ pool: pool.rows, statuses: pool.statuses, windows: windowsFor(profile), visitMin: profile.visitMin ?? 25, pinned: pool.pinned });
  const plan = { city: { key: cityKey, name: CITY_NAMES[cityKey] }, profile, venues: { ...city.sisterVenues, ...pool.venues }, days: planned.days, pool: { ids: pool.ids, N: pool.N, label: pool.label }, statuses: pool.statuses };
  const ids = [...new Set([...planned.days.flatMap((d) => d.stops.map((s) => s.id)), ...pool.ids.slice(0, ex.key === "maya" ? TOP_DEMO : TOP)])].slice(0, LIMIT);
  const out = outOf(cityKey);
  // round 3 (lane enrich): the city's baked enrichment records → each door's extra facts
  const records = (() => { try { return readJson(`public/data/enrich/${cityKey}.json`).doors ?? {}; } catch { return {}; } })();
  const enrich = Object.fromEntries(Object.entries(records).map(([id, r]) => [id, enrichFacts(r)]));
  // round 3 (lane deep): the door's ranked insights (lib/deep.js), from the records and the city's baked neighbour map
  const deepFacts = deepFactsFor(records, { plan, routes, city, near: (() => { try { return readJson(`public/data/deep/${cityKey}.json`).near ?? null; } catch { return null; } })(), profile });
  console.log(`${ex.key} (${ex.brand}, ${cityKey}): ${ids.length} doors`);
  const jobs = ids.map((id) => async () => {
    const m = stopModel({ plan, id, city, facts, routes, enrich, deepFacts });
    if (!m.talkReq) return;
    const bk = bakedTalkKey({ id, profile, ask: m.talk.ask });
    const fk = talkKey(m.talkReq);
    const now = out.sets[bk] ? validateTalkSet(out.sets[bk].set, m.talkReq) : null;
    if (now && !REDO && now.ok && !(TOLD && now.dropped.some((d) => /own room/.test(d.reason)))) {
      if (!out.sets[bk].factsKey && STAMP) (out.sets[bk].factsKey = fk, stamped++);
      if (out.sets[bk].factsKey === fk) return; // the facts it saw are today's facts
      changed++;
    }
    if (DRY) {
      if (!calls++) console.log(talkUser(m.talkReq));
      return;
    }
    if (stop) return;
    const r = await talkTurn({ tf: m.talkReq, env, ip: "bake" });
    calls++;
    if (r.error && STOP_ERROR.test(r.error)) { stop = `STOP: Anthropic refused (${r.error.slice(0, 160)}); ${calls} calls made, the rest left for the next run`; console.error(stop); }
    usd += r.usd ?? 0;
    appendFileSync(LEDGER, JSON.stringify({ at: new Date().toISOString(), ex: ex.key, id, name: m.venue.name, ok: Boolean(r.set), reason: r.reason ?? null, usd: r.usd ?? 0, dropped: (r.droppedLines ?? r.dropped ?? []).map((d) => `${d.where}: ${d.reason}`) }) + "\n");
    if (r.set) (ok++, (out.sets[bk] = { set: r.set, model: r.model, at: r.at, factsKey: fk }));
    else (refused++, delete out.sets[bk], console.log(`  refused ${m.venue.name}: ${r.reason} ${(r.dropped ?? []).map((d) => `${d.where}: ${d.reason}`).join("; ")}`));
  });
  for (let i = 0; i < jobs.length && !stop; i += 4) await Promise.all(jobs.slice(i, i + 4).map((j) => j()));
  if (stop) break;
}
if (!DRY) {
  mkdirSync(join(ROOT, "public/data/talk"), { recursive: true });
  for (const [c, o] of Object.entries(outs)) writeFileSync(join(ROOT, `public/data/talk/${c}.json`), JSON.stringify(o));
}
console.log(`calls ${calls} · written ${ok} · refused ${refused} · facts changed ${changed} · stamped ${stamped} · $${usd.toFixed(4)}`);
if (stop) process.exit(2);
