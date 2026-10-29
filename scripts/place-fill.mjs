// Group 3 item 2 (Jard web review 10-24): music and sister doors for more doors in the held cities. For the top 50 of
// every held list (public/data/routes/*.json, which holds every door on the demo's plan) that the city file has no
// sister doors or room sound for, ask Qloo once each and add the answers to public/data/cities/<city>.json. Nothing
// else in the city files changes: the rooms already there keep their lists and their sound check's verdict.
//   node scripts/place-fill.mjs [--dry] [--max=N] [--only=<city>]
// Budget (gigbot, 10-24): at most 1,100 Qloo calls, no retries; it stops at the first 429 or quota warning. Every raw
// response is cached under data/raw/ (the precompute's key scheme; ../doors/data/raw is read first), so a re-run asks
// for nothing it has. Every request is appended to data/ledger.jsonl (source "place-fill"). Not the precompute.
// The room sound is skipped under popularity 0.2, as the Worker does (src/worker.js SOUND_MIN_POP): Qloo refuses
// most of those and still counts the call.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { QlooClient, quota } from "../src/qloo.js";
import { makeLedger } from "../src/ledger.js";
import { sisterParams, soundParams, localitySoundParams, brandArtistParams, artistsFrom } from "../src/plan.js";
import { assembleSisters, soundList } from "../src/assemble.js";
import { guardSound, referenceGenres, localeCounts, km } from "../public/lib/core.js";
import { CONFIG } from "./config.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const RAW = join(ROOT, "data/raw");
const RAW_OLD = join(ROOT, "../doors/data/raw");
mkdirSync(RAW, { recursive: true });
const args = process.argv.slice(2);
const flag = (n) => args.find((a) => a.startsWith(`--${n}`))?.split("=")[1] ?? (args.includes(`--${n}`) ? true : undefined);
const DRY = Boolean(flag("dry"));
const ONLY = flag("only");
const BUDGET = 1100;
const MAX = Math.min(BUDGET, Number(flag("max") ?? BUDGET));
const TOP = 50;
const SOUND_MIN_POP = 0.2; // src/worker.js SOUND_MIN_POP

const ledger = makeLedger(join(ROOT, "data/ledger.jsonl"), { source: "place-fill" });
let sent = 0; // HTTP requests that reached Qloo this run
let stop = null; // why the run stopped early
let qloo;
function client() {
  if (qloo) return qloo;
  const key = process.env.QLOO_API_KEY ?? readFileSync(join(homedir(), ".config/gigbot/qloo-key"), "utf8").trim();
  qloo = new QlooClient({
    apiKey: key,
    minGapMs: 400,
    retryBudget: 0, // no retries: a 429 stops the run
    onLedger: (e) => {
      sent++;
      ledger.record(e);
      if (e.status === 429) stop = "Qloo answered 429";
      if (typeof e.remaining === "number" && e.remaining < 30000) stop = `Qloo's month is at ${e.remaining} calls left`;
    },
  });
  return qloo;
}

const rawKey = (params) => createHash("sha256").update(`GET /v2/insights ${JSON.stringify(params)}`).digest("hex").slice(0, 24);
function readRaw(params) {
  for (const dir of [RAW, RAW_OLD]) {
    const f = join(dir, `${rawKey(params)}.json`);
    if (existsSync(f)) return JSON.parse(readFileSync(f, "utf8"));
  }
  return null;
}
let would = 0;
async function get(params, label) {
  const hit = readRaw(params);
  if (hit) return hit.body ?? null;
  if (DRY) return (would++, null);
  if (stop) return null;
  if (sent >= MAX) return ((stop = `the ${MAX}-call limit`), null);
  ledger.assertBudget(1);
  const f = join(RAW, `${rawKey(params)}.json`);
  try {
    const body = await client().insights(params);
    writeFileSync(f, JSON.stringify({ label, method: "GET", path: "/v2/insights", params, at: new Date().toISOString(), body }));
    if (sent % 25 === 0) console.log(`  ${sent} calls · month left ${quota.monthRemaining ?? "?"} · ${label}`);
    return body;
  } catch (err) {
    writeFileSync(f, JSON.stringify({ label, method: "GET", path: "/v2/insights", params, error: err.message.slice(0, 300), body: null }));
    console.log(`  x ${label}: ${err.message.slice(0, 120)}`);
    return null;
  }
}

// the doors to fill, per city: the top 50 of every held list, without sisters or a sound in the city file
const ent = JSON.parse(readFileSync(join(ROOT, "data/entities.json"), "utf8"));
const byCity = {};
for (const f of readdirSync(join(ROOT, "public/data/routes")).sort()) {
  const r = JSON.parse(readFileSync(join(ROOT, "public/data/routes", f), "utf8"));
  const ck = r.city.key;
  if (ONLY && ck !== ONLY) continue;
  byCity[ck] ??= { query: r.city.query, venues: new Map(), all: new Map() };
  for (const [id] of r.lists.all.slice(0, TOP)) byCity[ck].venues.set(id, r.venues[id]);
  for (const v of Object.values(r.venues)) byCity[ck].all.set(v.id, v);
}

let plannedCalls = 0;
const plan = {};
for (const [ck, { venues }] of Object.entries(byCity)) {
  const city = JSON.parse(readFileSync(join(ROOT, "public/data/cities", `${ck}.json`), "utf8"));
  const sis = [...venues.keys()].filter((id) => !city.sisters[id]);
  const snd = [...venues.values()].filter((v) => !city.sounds[v.id] && (v.popularity == null || v.popularity >= SOUND_MIN_POP)).map((v) => v.id);
  const lowPop = [...venues.values()].filter((v) => !city.sounds[v.id] && v.popularity != null && v.popularity < SOUND_MIN_POP).length;
  plan[ck] = { city, sis, snd };
  plannedCalls += sis.length + snd.length;
  console.log(`${ck}: ${venues.size} doors in the top ${TOP}s · sisters to ask ${sis.length} · sounds to ask ${snd.length} (skipped ${lowPop} under popularity ${SOUND_MIN_POP})`);
}
console.log(`planned: up to ${plannedCalls} calls (cached answers cost nothing) · budget ${MAX}`);
if (plannedCalls > BUDGET && !flag("max")) {
  console.log(`!! over the ${BUDGET}-call budget: stopping before any call. Ask gigbot.`);
  process.exit(3);
}

// the sound check's references, from the raw cache (the precompute asked for them): the city's sound, its
// neighbourhoods' sounds (kept in the city file), every held brand's artists
const brandArtistLists = CONFIG.brands.map((b) => soundList(readRaw(brandArtistParams({ brandId: ent.brands[b.key].chosen.id }))?.body ?? {}, 30));

for (const [ck, { city, sis, snd }] of Object.entries(plan)) {
  const c = CONFIG.cities.find((x) => x.key === ck);
  let addSis = 0, addSnd = 0;
  for (const id of sis) {
    const body = await get(sisterParams({ placeId: id, city: c.query }), `sisters ${ck} ${byCity[ck].venues.get(id)?.name}`);
    if (!body) continue;
    const s = assembleSisters(body);
    city.sisters[id] = s.ids;
    for (const [sid, rec] of Object.entries(s.records)) city.sisterVenues[sid] ??= rec;
    addSis++;
  }
  const newLists = {};
  for (const id of snd) {
    const body = await get(soundParams({ placeId: id }), `sound ${ck} ${byCity[ck].venues.get(id)?.name}`);
    if (body) newLists[id] = artistsFrom(body).slice(0, 20);
    else if (readRaw(soundParams({ placeId: id }))?.error) city.sounds[id] = { artists: [], guard: { pass: false, reason: "no-signal", detail: "Qloo returned no artist signal for this venue (the venue is not accepted as an artist signal)" } };
  }
  // the same check the build ran (src/assemble.js assembleSounds), against the same references; the rooms already
  // in the file are neighbours for it, and keep their own verdicts
  const citySound = soundList(readRaw(localitySoundParams({ query: c.query, take: 50 }))?.body ?? {}, 50);
  const cityLists = [citySound.length ? citySound : city.citySound ?? [], ...Object.values(city.nbhdSounds ?? {})];
  const ref = referenceGenres([...cityLists, ...brandArtistLists]);
  const locale = localeCounts(cityLists);
  const common = new Set(city.commonArtists ?? []);
  const where = (id) => byCity[ck].all.get(id) ?? city.sisterVenues[id] ?? null;
  const lists = { ...Object.fromEntries(Object.entries(city.sounds).map(([id, s]) => [id, s.artists])), ...newLists };
  for (const [id, artists] of Object.entries(newLists)) {
    const d = where(id) ?? { id };
    const nearby = Object.entries(lists)
      .filter(([o, l]) => o !== id && l?.length && where(o))
      .map(([o, l]) => ({ id: o, name: where(o).name, km: km(d, where(o)), artistIds: l.map((a) => a.id) }))
      .filter((o) => o.km <= 1);
    const guard = guardSound(artists, ref, nearby, { locale, common, cityName: c.name, venue: d });
    city.sounds[id] = { artists: artists.map(({ id: aid, name, genres, spotify }) => ({ id: aid, name, genres: genres.slice(0, 12), spotify })), guard };
    addSnd++;
  }
  if (!DRY) writeFileSync(join(ROOT, "public/data/cities", `${ck}.json`), JSON.stringify(city));
  const pass = Object.keys(newLists).filter((id) => city.sounds[id]?.guard?.pass).length;
  console.log(`  ${ck}: +${addSis} sister lists, +${addSnd} sounds (${pass} passed the check) → sisters ${Object.keys(city.sisters).length}, sounds ${Object.keys(city.sounds).length}`);
  if (stop) break;
}
console.log(`place-fill: ${sent} Qloo calls this run${DRY ? `, ${would} would be made` : ""} · ledger ${ledger.count} this month · month left ${quota.monthRemaining ?? "(no call made)"}${stop ? ` · STOPPED: ${stop}` : ""}`);
if (stop) process.exit(4);
