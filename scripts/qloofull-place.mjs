// qloofull (Jard 10-27): sister doors and the door sound for the SAVED RUNS' top doors, as scripts/place-fill.mjs did for
// the held cities. A saved run (data/prewarm/*.json, the KV value publish.sh uploads) holds sister doors for 4 anchors and
// the sound of ≤ 8 doors; the thread picture and the sister rows are mostly empty for a judge. For the top N doors of
// every run in a city (what the planner fills first) that no run in the city has sisters or a sound for: one call each,
// the sound checked as a run checks it (src/assemble.js assembleSounds' guard, against the city's sound and the city's
// brands' artists), then written into EVERY run of the city whose route holds the door (city.sisters, city.sisterVenues,
// city.sounds). Nothing else in a run changes.
//   node scripts/qloofull-place.mjs --city=<key>|all [--top=40] [--dry] [--max=N] [--gap=400] [--floor=12000]
// Every call → data/ledger.jsonl (source "qloofull-place"); raw bodies under data/raw (place-fill's key scheme).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { QlooClient, quota } from "../src/qloo.js";
import { makeLedger } from "../src/ledger.js";
import { sisterParams, soundParams, localitySoundParams, brandArtistParams, artistsFrom } from "../src/plan.js";
import { assembleSisters, soundList } from "../src/assemble.js";
import { guardSound, referenceGenres, localeCounts, km } from "../public/lib/core.js";

const ROOT = new URL("..", import.meta.url).pathname;
const RAW = join(ROOT, "data/raw");
const args = process.argv.slice(2);
const flag = (n, d = null) => args.find((a) => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=") ?? (args.includes(`--${n}`) ? true : d);
const DIR = typeof flag("dir") === "string" ? (flag("dir").startsWith("/") ? flag("dir") : join(ROOT, flag("dir"))) : join(ROOT, "data/prewarm"); // --dir=data/prewarm-dev: Jard's dev KV runs
mkdirSync(RAW, { recursive: true });
const DRY = Boolean(flag("dry"));
const CITY = String(flag("city", "all"));
const TOPN = Number(flag("top", 40));
const MAX = Number(flag("max", Infinity));
const FLOOR = Number(flag("floor", 12000));
const SOUND_MIN_POP = 0.2; // src/worker.js

const ledger = makeLedger(join(ROOT, "data/ledger.jsonl"), { source: "qloofull-place" });
let limited = 0; // 429s seen this run
let sent = 0, would = 0, stop = null, qloo;
const client = () => (qloo ??= new QlooClient({
  apiKey: process.env.QLOO_API_KEY ?? readFileSync(join(homedir(), ".config/gigbot/qloo-key"), "utf8").trim(),
  minGapMs: Number(flag("gap", 400)),
  retryBudget: 2, // a 429 gets two jittered retries (src/qloo.js); several fills share Qloo's 10 a second
  onLedger: (e) => {
    sent++;
    ledger.record(e);
    if (e.status === 429 && ++limited >= 12) stop = "Qloo answered 429 twelve times";
    if (typeof e.remaining === "number" && e.remaining < FLOOR) stop = `Qloo's month is at ${e.remaining} calls left (floor ${FLOOR})`;
  },
}));
const rawKey = (params) => createHash("sha256").update(`GET /v2/insights ${JSON.stringify(params)}`).digest("hex").slice(0, 24);
const readRaw = (params) => {
  const f = join(RAW, `${rawKey(params)}.json`);
  return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null;
};
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
    if (sent % 50 === 0) console.log(`  ${sent} calls · month left ${quota.monthRemaining ?? "?"} · ${label}`);
    return body;
  } catch (err) {
    if (err.status && err.status < 500 && err.status !== 429) writeFileSync(f, JSON.stringify({ label, method: "GET", path: "/v2/insights", params, error: String(err.message).slice(0, 300), body: null }));
    console.log(`  x ${label}: ${String(err.message).slice(0, 120)}`);
    return null;
  }
}

// the saved runs by city
const files = readdirSync(DIR).filter((f) => /^[0-9a-f]{24}\.json$/.test(f)).sort();
const byCity = {};
for (const f of files) {
  const row = JSON.parse(readFileSync(join(DIR, f), "utf8"));
  const rt = row.value?.route;
  if (!rt?.city?.key) continue;
  (byCity[rt.city.key] ??= []).push({ f, row });
}
const cities = CITY === "all" ? Object.keys(byCity).sort((a, b) => byCity[b].length - byCity[a].length || a.localeCompare(b)) : CITY.split(",");

for (const ck of cities) {
  const runs = byCity[ck] ?? [];
  if (!runs.length) { console.log(`${ck}: no saved runs`); continue; }
  const sample = runs[0].row.value.route.city;
  const query = sample.query ?? sample.name;
  // the doors: the top N of every run; what the city already holds (any run) is not asked again
  const top = new Map();
  const all = new Map();
  const haveSis = new Map(), haveSnd = new Map(), sisterVenues = {};
  for (const { row } of runs) {
    const rt = row.value.route, c = row.value.city ?? {};
    for (const [id] of (rt.lists?.all ?? []).slice(0, TOPN)) if (rt.venues?.[id]) top.set(id, rt.venues[id]);
    for (const v of Object.values(rt.venues ?? {})) all.set(v.id, v);
    for (const [id, s] of Object.entries(c.sisters ?? {})) haveSis.set(id, s);
    for (const [id, s] of Object.entries(c.sounds ?? {})) haveSnd.set(id, s);
    Object.assign(sisterVenues, c.sisterVenues ?? {});
  }
  // a held city (Austin, Chicago): what its baked city file holds for these doors is copied in, no call (a saved run
  // in a held city reads its own city file, not the baked one: lib/live.js primeLive)
  const newSis = {}, newSisVenues = {}, newSnd = {};
  const heldF = join(ROOT, "public/data/cities", `${ck}.json`);
  if (existsSync(heldF)) {
    const held = JSON.parse(readFileSync(heldF, "utf8"));
    for (const id of top.keys()) {
      if (!haveSis.has(id) && held.sisters?.[id]) { newSis[id] = held.sisters[id]; for (const [sid] of held.sisters[id]) if (held.sisterVenues?.[sid]) newSisVenues[sid] ??= held.sisterVenues[sid]; }
      if (!haveSnd.has(id) && held.sounds?.[id]) newSnd[id] = held.sounds[id];
    }
    console.log(`  ${ck}: ${Object.keys(newSis).length} sister lists and ${Object.keys(newSnd).length} sounds copied from the baked city file`);
  }
  const sis = [...top.keys()].filter((id) => !haveSis.has(id) && !newSis[id]);
  const snd = [...top.values()].filter((v) => !haveSnd.has(v.id) && !newSnd[v.id] && (v.popularity == null || v.popularity >= SOUND_MIN_POP)).map((v) => v.id);
  console.log(`${ck} (${runs.length} runs, "${query}"): ${top.size} doors in the top ${TOPN}s · sisters to ask ${sis.length} · sounds to ask ${snd.length}`);

  // references for the sound check: the city's sound and the city's brands' artists (one call each, cached)
  const citySound = soundList((await get(localitySoundParams({ query, take: 50 }), `${ck} city sound`)) ?? {}, 50);
  const brandIds = [...new Set(runs.map(({ row }) => row.value.route.drinker?.id).filter(Boolean))];
  const brandLists = [];
  for (const bid of brandIds) brandLists.push(soundList((await get(brandArtistParams({ brandId: bid }), `${ck} brand artists ${bid.slice(0, 8)}`)) ?? {}, 30));
  const cityLists = [citySound.length ? citySound : runs[0].row.value.city?.citySound ?? []];
  const ref = referenceGenres([...cityLists, ...brandLists]);
  const locale = localeCounts(cityLists);
  const where = (id) => all.get(id) ?? sisterVenues[id] ?? null;

  for (const id of sis) {
    if (stop) break;
    const body = await get(sisterParams({ placeId: id, city: query }), `sisters ${ck} ${top.get(id)?.name}`);
    if (!body) continue;
    const s = assembleSisters(body);
    newSis[id] = s.ids;
    for (const [sid, rec] of Object.entries(s.records)) newSisVenues[sid] ??= rec;
  }
  const lists = Object.fromEntries([...haveSnd].map(([id, s]) => [id, s.artists]));
  for (const id of snd) {
    if (stop) break;
    const body = await get(soundParams({ placeId: id }), `sound ${ck} ${top.get(id)?.name}`);
    if (body) lists[id] = artistsFrom(body).slice(0, 20);
    else if (readRaw(soundParams({ placeId: id }))?.error) newSnd[id] = { artists: [], guard: { pass: false, reason: "no-signal", detail: "Qloo returned no artist signal for this venue (the venue is not accepted as an artist signal)" } };
  }
  for (const id of snd) {
    if (!lists[id] || haveSnd.has(id) || newSnd[id]) continue;
    const d = where(id) ?? { id };
    const nearby = Object.entries(lists).filter(([o, l]) => o !== id && l?.length && where(o)).map(([o, l]) => ({ id: o, name: where(o).name, km: km(d, where(o)), artistIds: l.map((a) => a.id) })).filter((o) => o.km <= 1);
    const guard = guardSound(lists[id], ref, nearby, { locale, common: new Set(), cityName: sample.name, venue: d });
    newSnd[id] = { artists: lists[id].map(({ id: aid, name, genres, spotify }) => ({ id: aid, name, genres: (genres ?? []).slice(0, 12), spotify })), guard };
  }
  // write into every run of the city whose route holds the door
  let wrote = 0;
  for (const { f, row } of runs) {
    const rt = row.value.route;
    const c = (row.value.city ??= { v: 1, city: ck, name: sample.name, live: true, sisters: {}, sisterVenues: {}, sounds: {}, citySound: [], nbhdSounds: {}, pitches: {} });
    c.sisters ??= {}; c.sisterVenues ??= {}; c.sounds ??= {};
    let changed = false;
    // what was fetched now, and what another run of the city already held (a door's lists are the door's, not the run's)
    for (const id of top.keys()) {
      if (!rt.venues?.[id]) continue;
      const ids = newSis[id] ?? haveSis.get(id);
      if (ids && !c.sisters[id]) { c.sisters[id] = ids; for (const [sid] of ids) { const rec = newSisVenues[sid] ?? sisterVenues[sid]; if (rec && !c.sisterVenues[sid] && !rt.venues[sid]) c.sisterVenues[sid] = rec; } changed = true; }
      const snd = newSnd[id] ?? haveSnd.get(id);
      if (snd && !c.sounds[id]) { c.sounds[id] = snd; changed = true; }
    }
    if (changed && !DRY) (writeFileSync(join(DIR, f), JSON.stringify(row)), wrote++);
  }
  const pass = Object.values(newSnd).filter((s) => s.guard?.pass).length;
  console.log(`  ${ck}: +${Object.keys(newSis).length} sister lists, +${Object.keys(newSnd).length} sounds (${pass} passed the check) → ${wrote} runs written${stop ? ` · STOPPED: ${stop}` : ""}`);
  if (stop) break;
}
console.log(`qloofull-place: ${sent} Qloo calls${DRY ? `, ${would} would be made` : ""} · month left ${quota.monthRemaining ?? "(no call made)"}${stop ? ` · STOPPED: ${stop}` : ""}`);
if (stop) process.exit(4);
