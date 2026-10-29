// Cloudflare Worker: the Doors agent. /api/* here, everything else from public/ (static assets).
// For any drinker (a brand, three weighted loves, or a room) and any city, the agent plans the Qloo calls, applies
// the reachability cap, filters to rooms that pour, finds sister doors, routes the day, gates each room's sound,
// drafts the pitch per door, and streams every step to the page (NDJSON). Precomputed combos are served from disk.
import { QlooClient, quota } from "./qloo.js";
import { heatHoods } from "../public/lib/culture.js"; // R9 deep
import { doorParams, proxyBody, sisterParams, soundParams, localitySoundParams, brandArtistParams, searchRows, brandRows, pickBrand, placeRows, pourRows, slugify, venuesFromPage, entities } from "./plan.js";
import { assembleRoute, assembleSisters, assembleSounds, soundList } from "./assemble.js";
import { draftPitches } from "./pitch.js";
import { parseHours, isOpenFor, buildRoute, templatePitch, DAYS, DAYPARTS, AGE_DIAL, guardSound, referenceGenres, localeCounts } from "../public/lib/core.js";
import { sampleFetch } from "./sample.js";
import { handleDirections, handleMatrix, handleGeocode, CITY_CENTERS } from "./ors.js";
import { handleTiles } from "./tiles.js";
import { liveCacheKey, normCity, pourWho } from "../public/lib/live.js";
import { STATE_NAMES } from "../public/lib/profile.js"; // live check F
const titleCase = (t) => t.replace(/\b\p{L}/gu, (c) => c.toUpperCase());
import { ipKey, visitorKey, dailyCeiling, originOk, INFLIGHT_MAX } from "./guard.js";
import { countNow, noteCalls, reserve, settle, KV_DAILY_WRITES, KV_WRITE_HEADROOM } from "./kvbook.js";
import { ENRICH_BASELINE } from "./enrich-baseline.js";
// ---- R9 chat agent ----
import { handleAgent, handleDebrief, agentModel } from "./agent.js";
import { handleTalk } from "./talk.js"; // group 3 item 3: talking points written per door
import { enrichQloo, enrichSite, enrichRecord, makeSiteFetcher, SITE_MODEL, SITE_FORMAT } from "./enrich.js"; // round 3: per-door enrichment
import { vsBaseline } from "../public/lib/enrich.js"; // qloofull: a live door compared with the baked baseline
import { anthropicSession } from "./llm.js";
import { usdOf, charge, claudeRoom } from "./spend.js";
import { handleBrief } from "./brief.js"; // Doors Agent: the specialist brief (ASK-DOORS-SPEC §3.2)
import { handleVoice } from "./voice.js"; // drive mode's voice when the browser has none
// ---- end R9 chat agent ----
import { CARRY_RE, CARRY_MAX } from "../public/lib/carry.js"; // R9 carry

const qlooCache = new Map(); // per isolate
const hits = new Map(); // best-effort per-IP limiter (protects the month's quota)
// per 10 minutes per visitor: new live runs (on top of their daily cap, DAILY_RUNS below), and searches
const COSTLY = { route: 12, cheap: 40 };

export function limited(ip, kind = "cheap", now = Date.now()) {
  const windowMs = 10 * 60 * 1000;
  const key = `${kind}:${ip}`;
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > (COSTLY[kind] ?? 40);
}

export function modeOf(env) {
  return { data: env.QLOO_API_KEY ? "live" : "sample", model: env.GEMINI_API_KEY ? "Gemini" : "template" };
}

// ---------- the build's own call budget (M2 ruling: enforced in the Worker, not only the key's reserve) ----------
// BUILD_BUDGET (default 34,000 a calendar month since the Oct 28 audit (30,000 from round 3, Jard 10-25, for per-door enrichment; was 15,000 from the
// ruling of Oct 21; 20,000 of Qloo's 50,000 stay unspent;
// src/ledger.js LEDGER_BUDGET is the same number for the dev ledger).
// In production the counter lives in KV (count:<YYYY-MM>, src/kvbook.js), seeded by scripts/publish.sh from
// data/ledger.jsonl (so it already includes the precompute) and written once per new run. In dev the ledger file is the
// counter.
export const COST = { route: 41, search: 1, sisters: 1, door: 1, place: 3, enrich: 4 }; // route: 3 pages + 5 ages + the uncapped page + ANCHORS sisters + SOUND_MAX sounds + city sound + brand artists + 3 deep; place: sisters + sound + the city's sound (cached a day); enrich: the door as a signal (brands, drink brands, demographics, tags)
// qloofull (Jard 10-27: no judge sees an empty feature for want of a Qloo call): sister doors for the run's top ANCHORS
// open doors (was 4) and the sound of up to SOUND_MAX (was 8), so a fresh run's thread and sister rows have material.
export const ANCHORS = 12;
export const DEFAULT_BUDGET = 34000; // round 3 (Jard 10-25, enrich): = src/ledger.js LEDGER_BUDGET (test/worker.test.mjs pins them together)
// L1: judging must not drain the budget (the app stays open to Nov 16; the month rolls over Nov 1).
// A visitor starts at most DAILY_RUNS new live runs a day (KV); saved runs are free and never limited. With less than
// two runs' worth left (or Qloo's month near its reserve), a new run rests: the page offers the examples and the saved
// runs instead of an error.
export const DAILY_RUNS = 5;
// Room sounds (step 6 of a run): Qloo rejects (400, still a counted call) the artist lookup of rooms it knows little
// about, mostly the quietest; so at most SOUND_MAX route rooms, none under SOUND_MIN_POP (unknown popularity is asked).
// The rest show the city's sound, labelled.
export const SOUND_MAX = 12;
export const SOUND_MIN_POP = 0.2;
export const soundDoors = (doors) => doors.filter((v) => v?.popularity == null || v.popularity >= SOUND_MIN_POP).slice(0, SOUND_MAX);
export const RESTING = "New plans are off for today: the daily limit is used. Try one of the examples, or a brand and city someone has already run.";
// Searches (brand and place): at most SEARCH_DAILY a day per visitor (/64 for IPv6) in this isolate's memory, plus
// Cloudflare's SEARCH_LIMITER binding across isolates; each counted into the budget (in memory, carried at the next
// settle). No KV write (the free plan's 1,000 a day are for runs).
export const SEARCH_DAILY = 40;
const searchDay = new Map(); // "<day>|<visitor>" → searches today, this isolate
// The agent plans for one fixed day and part of the day (which rooms get sister doors and sounds); the client's days
// never change a run, so they are not in its cache key.
export const AGENT_DAY = "thursday";
export const AGENT_PART = "evening";
const today = (env) => env.TODAY ?? new Date().toISOString().slice(0, 10);
// True when a word of the typed city (3+ letters, not a filler like "city" or "county") is missing from Qloo's locality
// name and disambiguation: Qloo matched something else. Accents and case are ignored; "FL", "DC" and "St." are skipped,
// and an acronym of the name ("NYC").
const CITY_FILLER = new Set(["city", "county", "the", "saint", "and", "united", "states", "usa"]);
const cityWords = (t) => String(t ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 3 && !CITY_FILLER.has(w));
// Live check F: Qloo can read a "City, ST" in another state ("Wyoming, MI" → Wyoming, New York; "Wyoming, Michigan"
// reads right). A typed "City, ST" whose reading names another state → the state it was read in, else null.
export function stateMisread(typed, loc) {
  const code = /,\s*([A-Za-z]{2})\s*$/.exec(String(typed ?? ""))?.[1]?.toUpperCase();
  const want = code && STATE_NAMES[code];
  const read = String(loc?.disambiguation ?? "").toLowerCase();
  if (!want || !read || read.includes(want)) return null;
  const parts = String(loc.disambiguation).split(",").map((x) => x.trim());
  return parts.at(-1) === "United States" && parts.length >= 2 ? parts.at(-2) : String(loc.disambiguation);
}
export function cityMisread(typed, loc) {
  const read = new Set(cityWords(`${loc?.name ?? ""} ${loc?.disambiguation ?? ""}`));
  const initials = String(loc?.name ?? "").toLowerCase().split(/[^\p{L}]+/u).filter(Boolean).map((w) => w[0]).join(""); // "NYC" for New York
  return cityWords(typed).some((w) => !read.has(w) && !(w.length <= 4 && initials.length >= 2 && w.startsWith(initials)));
}

// The saved runs, newest first (what a resting page offers): {kind, id, name (Qloo's), cityName (Qloo's locality), at,
// ref}. Never the visitor's own city text: each run's value carries this as KV metadata (written with it, no extra
// write), and the list is a KV list() of the mode's runs (a read; one per isolate per RUNS_TTL). A run whose city Qloo
// didn't resolve has no metadata, so it isn't listed. `ref` names the run (a hash of its key): picking it asks for it.
const RUNS_TTL = 10 * 60 * 1000;
let runsMemo = new WeakMap(); // the KV binding → mode → {at, rows: [{…, key}]}
export const runRef = (key) => {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < key.length; i++) {
    const c = key.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
};
async function savedRuns(env) {
  const mode = modeOf(env).data;
  const kv = env.DOORS_KV;
  if (!kv) return [];
  if (!runsMemo.has(kv)) runsMemo.set(kv, new Map());
  const memo = runsMemo.get(kv).get(mode);
  if (memo && Date.now() - memo.at < RUNS_TTL) return memo.rows;
  const rows = [];
  try {
    if (env.DOORS_KV?.list) {
      let cursor;
      for (let page = 0; page < 3; page++) {
        const r = await env.DOORS_KV.list({ prefix: `route:v2:${mode}:`, cursor });
        for (const k of r.keys ?? []) if (k.metadata?.cityName && k.metadata?.name) rows.push({ ...k.metadata, cityName: countyless(k.metadata.cityName), ref: runRef(k.name), key: k.name });
        if (r.list_complete || !r.cursor) break;
        cursor = r.cursor;
      }
    }
  } catch {}
  rows.sort((a, b) => String(b.at ?? "").localeCompare(String(a.at ?? "")) || a.name.localeCompare(b.name));
  // one row per drinker and city (a city typed several ways is one city to Qloo)
  const seen = new Set();
  const out = rows.filter((r) => {
    const k = `${String(r.id).toLowerCase()}|${normCity(r.cityName)}`;
    return !seen.has(k) && seen.add(k);
  });
  runsMemo.get(kv).set(mode, { at: Date.now(), rows: out });
  return out;
}
export const _resetRuns = () => void (runsMemo = new WeakMap());
const offered = async (env, n = 12) => (await savedRuns(env)).slice(0, n).map(({ key, ...r }) => r);
const monthOf = (env = {}) => (env.TODAY ?? new Date().toISOString()).slice(0, 7); // env.TODAY: the tests' clock

export async function budgetUsed(env, month = monthOf(env)) {
  if (typeof env.LEDGER_COUNT === "function") return env.LEDGER_COUNT(month);
  if (env.DOORS_KV) {
    try {
      return (await countNow(env)).calls;
    } catch {
      return Infinity; // cannot read the counter: treat the budget as spent
    }
  }
  return null; // no counter bound
}

// Qloo calls outside a run (searches, v1's extras): counted in memory, carried into the counter at the next settle.
// No KV write (the free plan's writes are for runs). Without a key (SAMPLE) nothing is counted.
export async function spend(env, n) {
  if (env.QLOO_API_KEY && n) noteCalls(n);
  return true;
}

// Why live calls are paused right now, or null. Precomputed routes never reach this: they are static files.
export async function livePaused(env, cost = 1) {
  if (!env.QLOO_API_KEY) return "SAMPLE mode: no Qloo key on this server, so live calls answer from fixtures";
  const budget = Number(env.BUILD_BUDGET ?? DEFAULT_BUDGET);
  const used = await budgetUsed(env);
  if (used === null) return "no call counter is bound (DOORS_KV), so live calls are refused rather than left uncounted";
  if (used + cost > budget) return `this build's Qloo budget for ${monthOf(env)} is spent (${used} of ${budget} calls)`;
  if (nearQuota(env)) return "the Qloo key is near its monthly quota";
  return null;
}

// A floor on the key itself (Qloo's rolling month, reset ~Nov 20): below QLOO_RESERVE calls left, live calls stop. Not
// 16,000: our ceiling (34,000 a calendar month) is what keeps that much unspent, and the two months don't line up, so
// a 20,000 floor would stop live runs through judging once October's calls are in Qloo's window.
export const DEFAULT_RESERVE = 2000;
export function nearQuota(env) {
  const reserve = Number(env.QLOO_RESERVE ?? DEFAULT_RESERVE);
  return Boolean(env.QLOO_API_KEY) && typeof quota.monthRemaining === "number" && quota.monthRemaining < reserve;
}

function makeQloo(env) {
  return new QlooClient({
    apiKey: env.QLOO_API_KEY || "sample",
    fetchImpl: env.QLOO_API_KEY ? (env.QLOO_FETCH ?? ((u, i) => fetch(u, i))) : sampleFetch(),
    minGapMs: env.QLOO_API_KEY ? undefined : 0,
    cache: qlooCache,
    onLedger: env.QLOO_API_KEY ? (e) => env.QLOO_LEDGER?.(e) : undefined, // sample responses are not Qloo calls; KV counts per request (spend)
  });
}

const json = (body, status = 200, headers = {}) => Response.json(body, { status, headers });
// a visitor: an IPv4 address or an IPv6 /64 (src/guard.js ipKey)
const ipOf = (req) => ipKey(req.headers.get("cf-connecting-ip") ?? "local");

async function kvGet(env, key) {
  try {
    return env.DOORS_KV ? await env.DOORS_KV.get(key, "json") : null;
  } catch {
    return null;
  }
}
// fix5-res: a run with gaps (calls Qloo refused) is kept a day, not 30: the next visitor's run fills them in.
export const RUN_TTL = 30 * 86400;
export const GAP_TTL = 86400;
async function kvPut(env, key, value, metadata, ttl = RUN_TTL) {
  try {
    if (env.DOORS_KV) await env.DOORS_KV.put(key, JSON.stringify(value), { expirationTtl: ttl, ...(metadata ? { metadata } : {}) });
    return Boolean(env.DOORS_KV);
  } catch {
    return false;
  }
}

// ---------- /api/search ----------
// room (N3): a bar or restaurant in any city, for "Rooms that already pour you"
const SEARCH_TYPES = { brand: "urn:entity:brand", place: "urn:entity:place", room: "urn:entity:place", any: "urn:entity:artist,urn:entity:brand,urn:entity:place,urn:entity:tv_show,urn:entity:movie,urn:entity:podcast,urn:entity:book" };
async function handleSearch(url, env, req) {
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 80);
  const type = url.searchParams.get("type") ?? "brand";
  // type=place&city=<ready city key>: a door in that city (Add a door); rows carry the place's own record.
  // L1: or a live city, type=place&cityName=<as typed>&lat=&lon= (its centre, from the live run)
  const city = url.searchParams.get("city");
  const cityName = (url.searchParams.get("cityName") ?? "").trim().slice(0, 80);
  const at = [Number(url.searchParams.get("lat")), Number(url.searchParams.get("lon"))];
  if (q.length < 2 || !SEARCH_TYPES[type]) return json({ error: "q (2+ characters) and type=brand|place|room|any are required" }, 400);
  if (cityName && (type !== "place" || cityName.length < 2 || !url.searchParams.has("lat") || !at.every(Number.isFinite) || Math.abs(at[0]) > 90 || Math.abs(at[1]) > 180)) return json({ error: "cityName needs type=place and the city's lat and lon" }, 400);
  if (city != null && (type !== "place" || !CITY_CENTERS[city])) return json({ error: `city must be one of ${Object.keys(CITY_CENTERS).join(", ")} with type=place` }, 400);
  // review6: another site may not search through this one; a visitor gets SEARCH_DAILY a day; each counts in the budget
  if (!originOk(req, env)) return json({ error: "Searches come from Doors' own page." }, 403);
  if (limited(ipOf(req), "cheap")) return json({ error: "Too many searches in ten minutes. Try again in a few minutes." }, 429);
  const ps = await livePaused(env, COST.search);
  if (ps && env.QLOO_API_KEY) return json({ error: "Search is off for today: its daily limit is used. The brands in the list and the examples still work.", paused: true }, 503);
  const dayKey = `${today(env)}|${ipOf(req)}`;
  let limitedEdge = false;
  if (env.SEARCH_LIMITER) {
    try {
      limitedEdge = !(await env.SEARCH_LIMITER.limit({ key: ipOf(req) })).success;
    } catch {}
  }
  if (limitedEdge || (searchDay.get(dayKey) ?? 0) >= SEARCH_DAILY) return json({ error: "That's today's searches from this browser. The brands in the list and the examples still work.", daily: true }, 429);
  if (searchDay.size > 20000) searchDay.clear();
  searchDay.set(dayKey, (searchDay.get(dayKey) ?? 0) + 1);
  await spend(env, COST.search);
  try {
    if (city || cityName) {
      const name = cityName || city[0].toUpperCase() + city.slice(1);
      const body = await makeQloo(env).search(`${q} ${name}`, { types: SEARCH_TYPES.place, take: 10 });
      return json({ rows: placeRows(body, cityName ? at : CITY_CENTERS[city]), mode: modeOf(env) }, 200, { "cache-control": "max-age=86400" });
    }
    // L1: brands ask for a few more rows (the same one call), then the name typed first, drinks next (brandRows)
    const body = await makeQloo(env).search(q, { types: SEARCH_TYPES[type], take: type === "brand" || type === "room" ? 10 : 6 });
    const rows = type === "brand" ? brandRows(body, q).slice(0, 6) : type === "room" ? pourRows(body).slice(0, 6) : searchRows(body);
    return json({ rows, mode: modeOf(env) }, 200, { "cache-control": "max-age=86400" });
  } catch (e) {
    return json({ error: `Qloo didn't answer: ${e.message.slice(0, 140)}` }, 502);
  }
}

// ---------- /api/sisters (lazy sister doors for a door that was not precomputed) ----------
async function handleSisters(url, env, req) {
  const id = url.searchParams.get("id") ?? "";
  const city = (url.searchParams.get("city") ?? "").slice(0, 60);
  if (!/^[0-9A-F-]{30,40}$/i.test(id) || !city) return json({ error: "id and city are required" }, 400);
  const k = `sisters:${id}:${city.toLowerCase()}`;
  const hit = await kvGet(env, k);
  if (hit) return json(hit);
  if (limited(ipOf(req), "cheap")) return json({ error: "Too many requests; try again shortly." }, 429);
  const ps = await livePaused(env, COST.sisters);
  if (ps && env.QLOO_API_KEY) return json({ error: `Sister doors for new rooms are paused: ${ps}.`, paused: true }, 503);
  if (!(await spend(env, COST.sisters))) return json({ error: "The call counter can't be written right now; try again shortly.", paused: true }, 503);
  try {
    const out = assembleSisters(await makeQloo(env).insights(sisterParams({ placeId: id, city })));
    await kvPut(env, k, out);
    return json(out, 200, { "cache-control": "max-age=86400" });
  } catch (e) {
    return json({ error: `Qloo didn't answer: ${e.message.slice(0, 140)}` }, 502);
  }
}

// ---------- /api/place (group 3 item 2): a door's music and sister doors, fetched when the rep asks ----------
// POST {id, city (the city as Qloo reads it), cityName, want: ["music"?, "sisters"?], popularity?, lat?, lon?, name?}
// → {sounds?: {id: {artists, guard}}, sisters?: {id: [[id, score]]}, sisterVenues?, calls}. Only from Doors' own page;
// the same guards as a plan's run: per-visitor limit, the build's monthly budget and the key's reserve (livePaused),
// every call counted (spend). Answers are kept a day in KV per door and city, so a second ask costs nothing. The
// room sound is checked as a run checks it (src/assemble.js) against the city's sound (one more call, kept a day).
// Under popularity 0.2 Qloo refuses the artist lookup (a counted call), so music isn't asked there (SOUND_MIN_POP).
async function handlePlace(request, env) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405);
  if (!originOk(request, env)) return json({ error: "This comes from Doors' own page." }, 403);
  const b = await request.json().catch(() => ({}));
  const id = String(b.id ?? "");
  const city = String(b.city ?? "").trim().slice(0, 80);
  const want = (Array.isArray(b.want) ? b.want : []).filter((w) => w === "music" || w === "sisters");
  if (!/^[0-9A-F-]{30,40}$/i.test(id) || city.length < 2 || !want.length) return json({ error: "id, city and want (music, sisters) are required" }, 400);
  const quiet = typeof b.popularity === "number" && b.popularity < SOUND_MIN_POP;
  const k = `place:v1:${id}:${normCity(city)}:${[...want].sort().join(",")}`;
  const hit = await kvGet(env, k);
  if (hit) return json({ ...hit, calls: 0 });
  if (limited(ipOf(request), "cheap")) return json({ error: "Too many requests in ten minutes. Try again in a few minutes." }, 429);
  const ps = await livePaused(env, COST.place);
  if (ps && env.QLOO_API_KEY) return json({ error: "Getting more from Qloo is off for today: its daily limit is used.", paused: true }, 503);
  const qloo = makeQloo(env);
  const out = {};
  let calls = 0;
  try {
    if (want.includes("sisters")) {
      calls++;
      const s = assembleSisters(await qloo.insights(sisterParams({ placeId: id, city })));
      out.sisters = { [id]: s.ids };
      out.sisterVenues = s.records;
    }
    if (want.includes("music")) {
      if (quiet) out.sounds = { [id]: { artists: [], guard: { pass: false, reason: "no-signal", detail: "Qloo knows too little about this door's crowd to name their music" } } };
      else {
        const ck = `citysound:v1:${normCity(city)}`;
        let citySound = await kvGet(env, ck);
        const [body, cityBody] = await Promise.all([
          (calls++, qloo.insights(soundParams({ placeId: id })).catch((e) => (e.status && e.status < 500 ? { refused: true } : Promise.reject(e)))),
          citySound ? null : (calls++, qloo.insights(localitySoundParams({ query: city, take: 50 })).catch(() => null)),
        ]);
        if (!citySound) {
          citySound = soundList(cityBody ?? {}, 50);
          if (citySound.length) await kvPut(env, ck, citySound);
        }
        if (body?.refused) out.sounds = { [id]: { artists: [], guard: { pass: false, reason: "no-signal", detail: "Qloo returned no artist signal for this venue" } } };
        else {
          const artists = soundList(body, 20);
          const venue = { id, name: String(b.name ?? "").slice(0, 120), lat: Number(b.lat), lon: Number(b.lon) };
          const guard = citySound.length
            ? guardSound(artists, referenceGenres([citySound]), [], { locale: localeCounts([citySound]), cityName: String(b.cityName ?? city).slice(0, 80), venue })
            : { pass: false, reason: "unchecked", detail: "Qloo didn't answer for the city's sound, so there was nothing to check this door's list against" };
          out.sounds = { [id]: { artists, guard } };
        }
      }
    }
  } catch (e) {
    await spend(env, calls);
    return json({ error: "Qloo didn't answer. Try again in a minute.", detail: String(e.message ?? e).slice(0, 140) }, 502);
  }
  await spend(env, calls);
  await kvPut(env, k, out);
  return json({ ...out, calls });
}

// ---------- /api/enrich (round 3): one door's enrichment record for a live plan (public/lib/enrich.js) ----------
// POST {id, city (as Qloo reads it), cityName?, name, lat?, lon?, website?, menu?, want?: ["qloo"?, "site"?]}
// → {door: record, calls, usd}. Only from Doors' own page; the same guards as a plan's run (per-visitor limit, the
// build's budget, the key's reserve), every Qloo call counted (spend). The website half costs a model call
// (Anthropic, kind "enrich" in the day's Claude $) and only runs when the key is set. Kept a day in KV per door, so a
// second ask is free. vsCity on a live record is computed against the baked baseline (src/enrich-baseline.js: every door
// Doors has read in the held and pre-warmed cities), marked scope {cities}, so its words say what it was compared with;
// a held city's baked record is read first by the client (lib/enrich-client.js) and never comes here. The KV copy is
// written only while the day's writes are under the ceiling the runs keep (kvbook): a miss costs the next visitor 4 calls,
// never a broken feature.
export const ENRICH_TTL = 86400;
async function handleEnrich(request, env) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405);
  if (!originOk(request, env)) return json({ error: "This comes from Doors' own page." }, 403);
  const b = await request.json().catch(() => ({}));
  const id = String(b.id ?? "");
  const city = String(b.city ?? "").trim().slice(0, 80);
  const want = (Array.isArray(b.want) ? b.want : ["qloo", "site"]).filter((w) => w === "qloo" || w === "site");
  if (!/^[0-9A-F-]{30,40}$/i.test(id) || city.length < 2 || !want.length) return json({ error: "id, city and want (qloo, site) are required" }, 400);
  const door = { id, name: String(b.name ?? "").slice(0, 120), lat: Number.isFinite(Number(b.lat)) ? Number(b.lat) : null, lon: Number.isFinite(Number(b.lon)) ? Number(b.lon) : null, website: typeof b.website === "string" ? b.website.slice(0, 300) : null, menu: typeof b.menu === "string" ? b.menu.slice(0, 300) : null };
  const k = `enrich:v1:${id}:${normCity(city)}:${[...want].sort().join(",")}`;
  const hit = await kvGet(env, k);
  if (hit) return json({ ...hit, calls: 0, usd: 0 });
  if (limited(ipOf(request), "cheap")) return json({ error: "Too many requests in ten minutes. Try again in a few minutes." }, 429);
  const today = (env.TODAY ?? new Date().toISOString()).slice(0, 10);
  let qloo = { basis: "none", brands: [], drinks: [], ages: null, gender: null, tags: { music: [], dishes: [], keywords: [], hobbies: [], tone: [] }, calls: 0 };
  let calls = 0;
  const notes = [];
  if (want.includes("qloo")) {
    const ps = await livePaused(env, COST.enrich);
    if (ps && env.QLOO_API_KEY) return json({ error: "Getting more from Qloo is off for today: its daily limit is used.", paused: true }, 503);
    const client = makeQloo(env);
    try {
      const r = await enrichQloo({ get: (params) => client.insights(params), door });
      qloo = r.qloo;
      calls = r.qloo.calls;
      notes.push(...r.errors);
    } catch (e) {
      await spend(env, calls || 1);
      return json({ error: "Qloo didn't answer. Try again in a minute.", detail: String(e.message ?? e).slice(0, 140) }, 502);
    }
    await spend(env, calls);
  }
  let site = null;
  let usd = 0;
  if (want.includes("site") && door.website) {
    if (!env.ANTHROPIC_API_KEY) site = { url: door.website, menuUrl: door.menu, fetched: today, ok: false, reason: "no model key on this server", model: null, facts: [] };
    else {
      const room = await claudeRoom(env);
      if (!room.ok) site = { url: door.website, menuUrl: door.menu, fetched: today, ok: false, reason: "the site's model budget for today is used", model: null, facts: [] };
      else {
        const model = String(env.ENRICH_MODEL || SITE_MODEL).trim();
        const f = env.ANTHROPIC_FETCH;
        const make = anthropicSession({ apiKey: env.ANTHROPIC_API_KEY, model, effort: "low", maxTokens: 3000, format: SITE_FORMAT, timeoutMs: Number(env.ENRICH_MS ?? 60000), ...(f ? { fetchImpl: f } : {}), onUsage: (u, m) => { const x = usdOf(u, m); usd += x; charge(env, x, "enrich"); } });
        const fetcher = makeSiteFetcher({ fetchImpl: env.SITE_FETCH ?? ((u, i) => fetch(u, i)), gapMs: Number(env.ENRICH_GAP_MS ?? 1000), timeoutMs: Number(env.ENRICH_FETCH_MS ?? 8000) });
        try {
          site = await enrichSite({ door, fetcher, make, model, today });
        } catch (e) {
          site = { url: door.website, menuUrl: door.menu, fetched: today, ok: false, reason: `model: ${String(e.message ?? e).slice(0, 80)}`, model, facts: [] };
        }
      }
    }
  }
  const rec = enrichRecord({ door, qloo, site, today });
  rec.vsCity = qloo.basis === "none" ? null : vsBaseline(rec, ENRICH_BASELINE, { cities: ENRICH_BASELINE.cities.length });
  const out = { door: rec, notes };
  const c = await countNow(env).catch(() => null);
  if (!c || c.writes < KV_DAILY_WRITES - KV_WRITE_HEADROOM) await kvPut(env, k, out, null, ENRICH_TTL);
  return json({ ...out, calls, usd: Math.round(usd * 1e6) / 1e6 });
}

// ---------- /api/door (S2 extras: regulars by age, TV, podcasts) ----------
async function handleDoor(url, env, req) {
  const id = url.searchParams.get("id") ?? "";
  const kind = url.searchParams.get("kind") ?? "artist";
  const age = url.searchParams.get("age") ?? "all";
  if (!/^[0-9A-F-]{30,40}$/i.test(id) || !["artist", "tv_show", "podcast"].includes(kind) || !AGE_DIAL[age]) return json({ error: "id, kind=artist|tv_show|podcast and a valid age are required" }, 400);
  const k = `door:${id}:${kind}:${age}`;
  const hit = await kvGet(env, k);
  if (hit) return json(hit);
  if (limited(ipOf(req), "cheap")) return json({ error: "Too many requests; try again shortly." }, 429);
  const ps = await livePaused(env, COST.door);
  if (ps && env.QLOO_API_KEY) return json({ error: `Door extras are paused: ${ps}.`, paused: true }, 503);
  if (!(await spend(env, COST.door))) return json({ error: "The call counter can't be written right now; try again shortly.", paused: true }, 503);
  try {
    const params = { "filter.type": `urn:entity:${kind}`, "signal.interests.entities": id, take: 10, ...(AGE_DIAL[age].buckets ? { "signal.demographics.age": AGE_DIAL[age].buckets } : {}) };
    const body = await makeQloo(env).insights(params);
    const out = { items: entities(body).map((e) => ({ name: e.name, id: e.entity_id })), label: kind === "artist" ? "artists Qloo associates with this venue's crowd" : `${kind === "tv_show" ? "TV shows" : "podcasts"} Qloo associates with this venue's crowd`, age };
    await kvPut(env, k, out);
    return json(out, 200, { "cache-control": "max-age=86400" });
  } catch (e) {
    return json({ error: `Qloo didn't answer: ${e.message.slice(0, 140)}` }, 502);
  }
}

// ---------- /api/route: the agent ----------
export function validateRoute(input) {
  const errors = [];
  const kind = String(input.kind ?? "brand");
  if (!["brand", "room", "proxy", "pour"].includes(kind)) errors.push("kind must be brand, room, proxy or pour");
  const city = String(input.city ?? "").trim().slice(0, 60);
  if (!normCity(city)) errors.push("city is required");
  // review6: the client's days never change a run (AGENT_DAY / AGENT_PART), so they are not in its cache key
  const day = AGENT_DAY;
  const part = AGENT_PART;
  let items = [];
  if (kind === "proxy") {
    items = (Array.isArray(input.items) ? input.items : []).slice(0, 3).map((x) => ({ id: String(x.id ?? ""), name: String(x.name ?? "").slice(0, 80), weight: Math.max(1, Math.min(5, Math.round(Number(x.weight) || 3))) }));
    if (items.length !== 3 || items.some((x) => !/^[0-9A-F-]{30,40}$/i.test(x.id))) errors.push("proxy needs three items with Qloo ids");
  } else if (kind === "pour") {
    // N3: 1–3 rooms that already pour the rep (Qloo places, any city) and up to 3 brands, weighed alike
    const raw = Array.isArray(input.items) ? input.items.slice(0, 6) : [];
    items = raw.map((x) => ({ id: String(x?.id ?? ""), name: String(x?.name ?? "").trim().slice(0, 80), weight: 1, type: x?.type === "place" ? "place" : "brand" }));
    const rooms = items.filter((x) => x.type === "place").length;
    if (rooms < 1 || rooms > 3 || items.length - rooms > 3 || items.some((x) => !/^[0-9A-F-]{30,40}$/i.test(x.id) || !x.name) || new Set(items.map((x) => x.id.toLowerCase())).size !== items.length) errors.push("pour needs 1 to 3 rooms and up to 3 brands, each with a Qloo id and a name");
  } else {
    const id = String(input.id ?? "");
    const name = String(input.name ?? "").trim().slice(0, 80);
    if (!/^[0-9A-F-]{30,40}$/i.test(id) && name.length < 2) errors.push("id or name is required");
    items = [{ id: /^[0-9A-F-]{30,40}$/i.test(id) ? id : "", name, weight: 1 }];
  }
  const na = input.na === true || input.na === "1" || input.na === "true"; // "?na=false" must not read as true
  // a saved run picked from the list, by its ref (/api/runs): not part of what Qloo is asked
  const ref = /^[0-9a-f]{16}$/.test(String(input.ref ?? "")) ? String(input.ref) : null;
  return { errors, input: { kind, city, day, part, items, na, ...(ref ? { ref } : {}) } };
}

export async function runRoute({ input, qloo, env, emit }) {
  const { kind, city, day, part, items } = input;
  // qloofull: the calls a step reports are the client's own count for this run (the deltas of calls made at once used to
  // be summed, so a run said 199 when the key saw 40); the budget (settle) always read the client's count
  const base = qloo.calls;
  let calls = 0;
  const call = async (label, fn) => {
    try {
      return await fn();
    } finally {
      calls = qloo.calls - base;
    }
  };
  const step = (id, label, detail) => emit({ type: "step", id, label, detail, calls: (calls = qloo.calls - base) });
  // fix5-res: only the first page of doors is required. Any other call Qloo refuses (a 429 after its retries, a cap, a
  // dropped connection) leaves its part out, and the run says what's missing (route.gaps: short labels the plan view
  // lists, public/lib/live.js gapsNote; the step lines say more) instead of
  // throwing away the calls already spent. A 400 on a room's sound is Qloo knowing too little about the room: not a gap.
  const gaps = [];
  const refused = (e) => !(e?.status >= 400 && e.status < 500 && e.status !== 429);
  const soft = (label, fn) => call(label, fn).catch((e) => ({ failed: true, refused: refused(e) }));
  const got = (b) => (b && !b.failed ? b : null);

  // 1. resolve the drinker
  let drinker;
  if (kind === "proxy") {
    drinker = { key: `proxy-${items.map((x) => slugify(x.name)).join("-")}`.slice(0, 80), name: items.map((x) => x.name).join(" + "), items };
    step("resolve", "Drinker", `three things they love, weights ${items.map((x) => `${x.name} ×${x.weight}`).join(", ")}`);
  } else if (kind === "pour") {
    // N3: the rooms (any city) and the brands as one weighted signal (PROBES 2026-10-22: places and brands blend)
    const who = pourWho(items);
    drinker = { key: `pour-${items.map((x) => slugify(x.name)).join("-")}`.slice(0, 80), name: items.map((x) => x.name).join(" + "), who, items, na: input.na };
    step("resolve", "Drinker", `${who}: ${items.length} Qloo signals weighed alike (${items.map((x) => `${x.name}, ${x.type === "place" ? "a door" : "a brand"}`).join("; ")})`);
  } else {
    let { id, name } = items[0];
    if (!id) {
      const body = await call("search", () => qloo.search(name, { types: kind === "room" ? "urn:entity:place" : "urn:entity:brand", take: 5 }));
      const rows = kind === "room" ? searchRows(body) : brandRows(body, name); // the name typed first, then drinks (M1)
      if (!rows.length) throw new Error(`Qloo has no ${kind === "room" ? "venue" : "brand"} called "${name}"`);
      // owner review 7: never a brand by another name ("High Noon" was Miller High Life). Stop after this one call (the
      // run is given back) and say what Qloo had.
      const pick = kind === "room" ? rows[0] : pickBrand(rows, name);
      if (!pick) throw new Error(`Qloo has no brand called "${name}". It had ${rows.slice(0, 3).map((r) => r.name).join(", ")}. Pick one of those, or check the spelling.`);
      id = pick.id;
      name = pick.name;
      step("resolve", "Drinker", `resolved "${items[0].name}" to ${pick.name}${pick.where ? ` (${pick.where})` : ""}; other candidates: ${rows.filter((r) => r !== pick).slice(0, 3).map((r) => r.name).join(", ") || "none"}`);
    } else step("resolve", "Drinker", `${kind === "room" ? "the regulars of" : "brand"} ${name || id}`);
    drinker = kind === "room" ? { key: `room-${slugify(name)}`, name, id } : { key: slugify(name), name, id, na: input.na };
  }

  // 2. plan
  // qloofull (Jard 10-27: no Qloo data missing for any drinker kind): every kind gets the age re-ranks, the uncapped page,
  // the hooks and the heat map. A brand or room is one GET signal (filter.exclude.entities for the room); a proxy or pour
  // run sends its weighted signals in the same POST body (probed 2026-10-27: signal.demographics.age, urn:heatmap and
  // urn:entity:tv_show all take the weighted list). A pour run drops the rep's own rooms from every list, as from page 1.
  const single = kind === "brand" || kind === "room";
  const own = kind === "room" ? { "filter.exclude.entities": drinker.id } : {};
  const sigs = single ? null : items.map((x) => ({ id: x.id, weight: Number(x.weight) || 1 }));
  const dropOwn = (body) => (kind === "pour" && body?.results?.entities ? { ...body, results: { ...body.results, entities: body.results.entities.filter((e) => !items.some((x) => x.id.toLowerCase() === String(e.entity_id).toLowerCase())) } } : body);
  const ages = Object.entries(AGE_DIAL).filter(([k, a]) => a.buckets && (!a.naOnly || input.na));
  step("plan", "Plan", `3 pages of bars and restaurants in ${city} ranked for this drinker (popularity cap 0.9: reachable doors)${ages.length ? `, ${ages.length} age re-ranks, the uncapped page for the most popular doors` : ""}; then sister doors for the route's anchors, the city's sound and a room-sound check per door`);

  // 3. fetch the doors
  const pages = [];
  for (let p = 1; p <= 3; p++) {
    let body = await (p === 1 ? call : soft)("page", () => (kind === "proxy" || kind === "pour" ? qloo.insightsPost(proxyBody({ proxies: items, city, page: p })) : qloo.insights({ ...doorParams({ signalId: drinker.id, city, page: p }), ...(kind === "room" ? { "filter.exclude.entities": drinker.id } : {}) }))).catch((e) => {
      // live check H: a typo city ("Milwuakee") is Qloo's 400 "unable to resolve to a valid locality": say it plainly
      // (the page adds the listed city it most likely means), never the API's JSON
      if (/unable to resolve to a valid locality/i.test(e?.message ?? "")) throw new Error(`Qloo doesn't know a city called "${city}".`);
      throw e;
    });
    if (body?.failed) {
      gaps.push(`rooms page ${p}`);
      step("pages", "Doors", `page ${p}: Qloo didn't answer, so the plan uses the ${pages.reduce((s, b) => s + entities(b).length, 0)} doors it has`);
      break;
    }
    // a room that already pours you is not a door to knock on (it may be in the opening city)
    if (kind === "pour" && body?.results?.entities) body = { ...body, results: { ...body.results, entities: body.results.entities.filter((e) => !items.some((x) => x.id.toLowerCase() === String(e.entity_id).toLowerCase())) } };
    pages.push(body);
    // Qloo may read a city as its state ("New York, NY" → "New York, United States"): the rooms would be statewide.
    // Stop after this first call (the visitor's run is given back) and say what to type instead.
    const loc = p === 1 ? body?.query?.localities?.filter?.[0] : null;
    if (loc?.disambiguation && loc.disambiguation.split(",").length === 2 && /united states$/i.test(loc.disambiguation)) throw new Error(`Qloo read "${city}" as the state of ${loc.name}, not a city. Try the city's own name ("${loc.name} City", or a borough or neighbourhood).`);
    // Qloo reads any text as some place ("Qwxzy Flats" → The Flats, Beverly Hills): if a word the visitor typed is
    // missing from what Qloo read, stop after this first call too and ask them to confirm by typing Qloo's reading.
    // fix14: SAMPLE (no key) answers every city from Boise's fixtures: say so, never "Qloo read it as Boise"
    if (loc && !env?.QLOO_API_KEY && (stateMisread(city, loc) || cityMisread(city, loc))) throw new Error(`This server runs on sample data (no Qloo key), which only covers Boise, Idaho, so it can't build "${city}". The hosted Doors app builds any US city.`);
    // fix14: "type the state in full" only when Qloo read the typed city's own name in another state, never another city
    const elsewhere = loc && !cityMisread(city, loc) ? stateMisread(city, loc) : null;
    if (elsewhere) throw new Error(`Qloo read "${city}" as ${loc.name}, ${elsewhere}. Type the state in full ("${city.replace(/,\s*[A-Za-z]{2}\s*$/, "")}, ${titleCase(STATE_NAMES[/,\s*([A-Za-z]{2})\s*$/.exec(city)[1].toUpperCase()])}").`);
    if (loc && cityMisread(city, loc)) throw new Error(`Qloo read "${city}" as ${[loc.name, loc.disambiguation].filter(Boolean).join(", ")}. If that's right, type it as the city; if not, check the spelling.`);
    step("pages", "Doors", `page ${p}: ${entities(body).length} doors`);
    if (entities(body).length < 50 - (kind === "pour" ? items.length : 0)) break;
  }
  if (!entities(pages[0]).length) throw new Error(`Qloo returned no bars or restaurants for this drinker in "${city}". Try the city's full name.`);
  const [ageList, famousBody] = await Promise.all([
    Promise.all(ages.map(([k, a]) => soft("age", () => (single ? qloo.insights({ ...doorParams({ signalId: drinker.id, city, page: 1, ageBuckets: a.buckets }), ...own }) : qloo.insightsPost({ ...proxyBody({ proxies: items, city, page: 1 }), "signal.demographics.age": a.buckets })).then(dropOwn)).then((b) => [k, b]))),
    soft("famous", () => (single ? qloo.insights({ ...doorParams({ signalId: drinker.id, city, page: 1, cap: null }), ...own }) : qloo.insightsPost(proxyBody({ proxies: items, city, page: 1, cap: null }))).then(dropOwn)),
  ]);
  const ageBodies = Object.fromEntries(ageList.filter(([, b]) => got(b)));
  const famous = got(famousBody);
  const agesMissing = ageList.filter(([, b]) => !got(b)).map(([k]) => k);
  if (agesMissing.length) gaps.push("age re-ranks");
  if (famousBody?.failed) gaps.push("the most popular doors");
  const where = pages[0]?.query?.localities?.filter?.[0];
  const cityObj = { key: slugify(city), name: where?.name ?? city, query: city, center: where?.location ? [where.location.lat, where.location.lon] : null, disambiguation: where?.disambiguation ?? null, resolved: Boolean(where?.name) };
  const alcohol = (kind === "brand" || (kind === "pour" && items.some((x) => x.type === "brand"))) && !input.na;
  const route = assembleRoute({ kind, drinker, city: cityObj, pages, ages: ageBodies, famous, alcohol, captured: new Date().toISOString().slice(0, 10), calls: 0 });
  const fetched = pages.reduce((s, b) => s + entities(b).length, 0);
  step("filter", "Bars and restaurants", `${fetched} fetched → ${route.lists.all.length} bars and restaurants (dropped ${route.dropped.all.n}: ${route.dropped.all.names.slice(0, 4).join(", ") || "none"})${cityObj.disambiguation ? ` · city resolved to ${cityObj.disambiguation}` : ""}`);

  // 4. hours
  const rows = route.lists.all.map(([id]) => route.venues[id]);
  const open = rows.filter((v) => !v.closed && isOpenFor(parseHours(v.hours), day, part) !== false);
  step("hours", "Open", `${open.length} of ${rows.length} open on a sample ${day[0].toUpperCase()}${day.slice(1)} ${part} by their own listed hours`); // judge R9: not the rep's days; the plan checks those

  // 5. sister doors for the likely anchors, then the route
  const sisters = {};
  const sisterVenues = {};
  let r = buildRoute(open, sisters);
  const anchors = open.slice(0, ANCHORS);
  const sisterBodies = (await Promise.all(anchors.map((v) => soft("sisters", () => qloo.insights(sisterParams({ placeId: v.id, city })))))).map(got);
  const sistersMissing = sisterBodies.filter((b) => !b).length;
  if (sistersMissing) gaps.push("sister doors");
  anchors.forEach((v, i) => {
    if (!sisterBodies[i]) return;
    const s = assembleSisters(sisterBodies[i]);
    sisters[v.id] = s.ids;
    Object.assign(sisterVenues, s.records);
  });
  r = buildRoute(open, Object.fromEntries(Object.entries(sisters).map(([k, x]) => [k, x.map((y) => y[0])])));
  step("sisters", "Sister doors", `${anchors.length} anchors → ${r.groups.length} groups by Qloo sister doors, ${r.stops.length} doors, ${r.km} km of straight lines${sistersMissing ? `; Qloo didn't answer for ${sistersMissing} anchor${sistersMissing > 1 ? "s" : ""}, grouped by distance alone` : ""}`);

  // 6. room sounds, gated
  const routeDoors = r.stops.map((s) => route.venues[s.id]);
  const soundBodies = {};
  const [soundList12, cityBody, brandBody] = await Promise.all([
    Promise.all(routeDoors.map((v) => (soundDoors(routeDoors).includes(v) ? soft("sound", () => qloo.insights(soundParams({ placeId: v.id }))) : null))),
    soft("city sound", () => qloo.insights(localitySoundParams({ query: city, take: 50 }))),
    kind === "brand" ? soft("brand artists", () => qloo.insights(brandArtistParams({ brandId: drinker.id }))) : null,
  ]);
  routeDoors.forEach((v, i) => got(soundList12[i]) && (soundBodies[v.id] = soundList12[i]));
  const soundsMissing = soundList12.filter((b) => b?.failed && b.refused).length;
  if (soundsMissing) gaps.push("room sounds");
  if (cityBody?.failed) gaps.push("city sound");
  if (brandBody?.failed) gaps.push("brand artists");
  const citySound = soundList(got(cityBody), 50);
  const drinkerArtists = got(brandBody) ? soundList(brandBody, 30) : [];
  const sounds = assembleSounds({ doors: routeDoors, soundBodies, refLists: [citySound, drinkerArtists], cityLists: [citySound], cityName: cityObj.name });
  const pass = Object.values(sounds).filter((s) => s.guard.pass).length;
  const soundGaps = [cityBody?.failed && `${cityObj.name}'s sound`, brandBody?.failed && `the brand's artists`, soundsMissing && `${soundsMissing} room${soundsMissing > 1 ? "s'" : "'s"} own list${soundsMissing > 1 ? "s" : ""}`].filter(Boolean);
  const rest = citySound.length ? `the rest show ${cityObj.name}'s sound, labelled` : "the rest are held back";
  step("guard", "Door sound check", `${pass} of ${Object.keys(sounds).length} doors' artist lists passed the plausibility check; ${rest}${soundGaps.length ? `. Qloo didn't answer for ${soundGaps.join(" or ")} this run, so ${citySound.length || drinkerArtists.length ? "the check had less to go on" : "no room's list could be checked"}` : ""}`);

  // 6b. R9 deep (public/lib/culture.js): a brand run also asks what its fans like (TV, podcasts) and where in this city
  // they are (heatmap by locality, rank only): 3 calls, kept on the route (the same KV value: no extra write)
  {
    const ask = (params) => (single ? qloo.insights({ ...params, "signal.interests.entities": drinker.id }) : qloo.insightsPost({ ...params, "signal.interests.entities": sigs }));
    const [tvBody, podsBody, heatRaw] = await Promise.all([
      ...["tv_show", "podcast"].map((t) => soft("deep hooks", () => ask({ "filter.type": `urn:entity:${t}`, take: 10 }))),
      soft("deep heat", () => ask({ "filter.type": "urn:heatmap", "filter.location.query": city, "output.heatmap.boundary": "urn:entity:locality" })),
    ]);
    const deepMissing = [tvBody?.failed && "fans' TV shows", podsBody?.failed && "fans' podcasts", heatRaw?.failed && "neighbourhood map"].filter(Boolean);
    gaps.push(...deepMissing);
    const [tv, pods, heatBody] = [tvBody, podsBody, heatRaw].map(got);
    const items = (b) => entities(b).filter((e) => e?.name).map((e) => ({ name: e.name, tags: [...new Set((e.tags ?? []).map((x) => x?.name).filter(Boolean))].slice(0, 10) }));
    route.culture = { captured: route.captured, hooks: { name: drinker.name, category: null, lists: { tv_show: items(tv), podcast: items(pods) } }, heat: heatHoods(heatBody, cityObj).slice(0, 15) };
    step("deep", kind === "brand" ? "What their fans like" : kind === "room" ? "What its regulars like" : "What this crowd also likes", `${route.culture.hooks.lists.tv_show.length} TV shows, ${route.culture.hooks.lists.podcast.length} podcasts; ${route.culture.heat.length} neighbourhoods ranked on Qloo's map${deepMissing.length ? ` (Qloo didn't answer for ${deepMissing.join(", ")})` : ""}`);
  }

  // 7. pitches: the route goes out now with template lines; the model's drafts follow as their own event
  const pitchesNow = {};
  for (const v of routeDoors) pitchesNow[v.id] = templatePitch(v);
  route.calls = calls = qloo.calls - base;
  route.gaps = gaps;
  const cityFile = { v: 1, city: cityObj.key, name: cityObj.name, live: true, sisters, sisterVenues, sounds, citySound: citySound.slice(0, 20), nbhdSounds: {}, pitches: pitchesNow };
  emit({ type: "route", route, city: cityFile });
  let pitches = pitchesNow;
  try {
    pitches = await draftPitches(routeDoors, { apiKey: env.GEMINI_API_KEY, timeoutMs: 12000 });
  } catch {}
  const drafted = Object.values(pitches).filter((p) => p.by === "model").length;
  step("pitch", "At the door", drafted ? `${drafted} of ${routeDoors.length} drafted by the model from each door's own descriptions; the rest from a template` : env.GEMINI_API_KEY ? "the model did not answer in time (or is over its daily quota), so these lines come from a template over each venue's own descriptions" : "drafted from a template over each venue's own descriptions (no model configured)");
  if (drafted) emit({ type: "pitches", pitches });
  return { route, city: { ...cityFile, pitches }, calls };
}

// A run's KV key: what Qloo is asked (kind, the drinker's id or name, proxy weights, na) and where (the city, however
// it is typed), shared with the client (lib/live.js liveCacheKey).
// (scripts/prewarm.mjs writes the same keys: kvRunKey)
export const kvRunKey = (mode, input, city = input.city) => `route:v2:${mode}:${liveCacheKey({ kind: input.kind, id: input.items[0]?.id, name: input.items[0]?.name, items: input.items, city, na: input.na })}`;
const runKey = (env, input, city = input.city) => kvRunKey(modeOf(env).data, input, city);
// A run's saved-runs entry, kept as its KV value's metadata (no extra write): Qloo's name for the drinker and for the
// city, only when Qloo resolved the city (never the visitor's own text). scripts/prewarm.mjs writes the same.
// Live check C: Qloo may resolve a city to its county ("Milwaukee, WI" → "Milwaukee County"). A run is kept only when
// every word typed is in Qloo's reading (cityMisread), so a stored "X County" was typed as X: the list says X.
export const countyless = (name) => String(name ?? "").replace(/\s+(County|Parish|Borough)$/i, "") || name;
export const runMeta = (out, input, at) => {
  if (input.kind === "pour") return null; // N3: a pour run is the rep's own rooms; it is not offered to others as a saved run
  const resolved = out.route.city?.resolved ? out.route.city.name : null;
  return resolved ? { kind: input.kind, id: out.route.drinker?.id ?? input.items[0]?.id ?? "", name: out.route.drinker?.name ?? input.items[0]?.name ?? "", cityName: countyless(resolved), at } : null;
};
let inflight = 0; // new runs running in this isolate (review6: INFLIGHT_MAX)
export const _inflight = () => inflight; // for the tests

async function handleRoute(request, env, ctx) {
  // review6: POST with JSON, from this site's own page only (a third-party page can't make its visitors start runs)
  if (request.method !== "POST") return json({ error: "POST a JSON body" }, 405, { allow: "POST" });
  if (!/^application\/json\b/i.test(request.headers.get("content-type") ?? "")) return json({ error: "Send JSON (content-type: application/json)" }, 415);
  if (!originOk(request, env, { required: true })) return json({ error: "Live runs start from Doors' own page." }, 403);
  let raw;
  try {
    raw = await request.json();
  } catch {
    return json({ error: "Send JSON: {kind, id or name, city}" }, 400);
  }
  const { errors, input } = validateRoute(raw);
  if (errors.length) return json({ error: errors.join("; ") }, 400);
  const mode = modeOf(env);
  // A run already made: free, never limited, no KV write. Asked for as typed, or picked from the saved runs by its ref.
  const kvKey = runKey(env, input);
  let saved = await kvGet(env, kvKey);
  if (saved?.ref) saved = await kvGet(env, saved.ref); // an older alias (kept under Qloo's own name for the city)
  if (!saved?.route && input.ref) {
    const row = (await savedRuns(env)).find((r) => r.ref === input.ref && (!input.items[0]?.id || String(r.id).toLowerCase() === input.items[0].id.toLowerCase()));
    if (row) saved = await kvGet(env, row.key);
  }
  if (saved?.route) {
    const at = saved.at ? ` on ${saved.at}` : "";
    const lines = [
      { type: "start", input, mode, cached: true },
      { type: "step", id: "cache", label: "Saved run", detail: `Doors asked Qloo about this drinker in ${saved.route.city?.name ?? input.city}${at}: the same rooms again, no new Qloo calls${saved.route.gaps?.length ? `. Qloo didn't answer for ${saved.route.gaps.join("; ")} on that run` : ""}`, calls: 0 },
      { type: "route", route: saved.route, city: saved.city },
      { type: "done", ok: true, calls: 0, cached: true },
    ].map((e) => JSON.stringify({ t: Date.now(), ...e }) + "\n");
    return new Response(lines.join(""), { headers: { "content-type": "application/x-ndjson", "cache-control": "no-store", "x-doors-cache": "hit" } });
  }
  // A new run. Every refusal is the same plain "resting" answer with the examples and the saved runs, never an error.
  const rest = async (status, extra = {}) => json({ resting: true, message: RESTING, runs: await offered(env), ...extra }, status);
  const ps = await livePaused(env, 2 * COST.route);
  if (ps && env.QLOO_API_KEY) return rest(503, { paused: true, reason: ps });
  const ip = ipOf(request);
  // the counter's key for this visitor today: a salted one-way hash, never the address (src/guard.js visitorKey);
  // hashed before the in-flight check, which must have no await between it and the reservation
  const visitor = await visitorKey(env, ip, today(env));
  if (inflight >= INFLIGHT_MAX) return rest(429, { busy: true });
  // taken at once (no await before it), so concurrent requests in this isolate see each other; given back on a refusal
  inflight++;
  const release = reserve(env, visitor, env.QLOO_API_KEY ? COST.route : 0); // held in memory until the run settles
  const refuse = async (status, extra) => {
    inflight--;
    release();
    return rest(status, extra);
  };
  // Dev only (scripts/dev.mjs sets DEV_UNLIMITED_LOCAL): the local jobs all share one loopback "visitor", so its own
  // per-visitor limits are off there; the budget, the site's daily ceiling and the KV write ceiling still hold. On
  // Cloudflare every request carries cf-connecting-ip, and the flag is never set.
  const devLocal = env.DEV_UNLIMITED_LOCAL === "1" && ip === "local";
  if (!devLocal && limited(ip, "route")) return refuse(429, { daily: true });
  if (env.RUN_LIMITER && !devLocal) {
    try {
      if (!(await env.RUN_LIMITER.limit({ key: ip })).success) return refuse(429, { daily: true });
    } catch {}
  }
  // Today's counts, from the one counter value (src/kvbook.js: one read, no write until the run settles; this run's
  // own reservation included): the site's KV writes (the free plan's 1,000 a day), the site's own ceiling on new runs
  // (live only), this visitor's runs.
  const day = today(env);
  if (env.DOORS_KV) {
    let c;
    try {
      c = await countNow(env);
    } catch {
      return refuse(503, { paused: true }); // can't read the counter: never run uncounted
    }
    if (c.writes >= KV_DAILY_WRITES - KV_WRITE_HEADROOM) return refuse(429, { writes: c.writes });
    if (env.QLOO_API_KEY) {
      const ceiling = dailyCeiling({ budget: Number(env.BUILD_BUDGET ?? DEFAULT_BUDGET), used: (await budgetUsed(env)) - COST.route, cost: COST.route, day });
      if (c.runs > ceiling) return refuse(429, { ceiling });
    }
    if (!devLocal && (c.ips[visitor] ?? 0) > DAILY_RUNS) return refuse(429, { daily: true });
  } else if (env.QLOO_API_KEY) return refuse(503, { paused: true });

  const qloo = makeQloo(env);
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  let ok = false;
  const emit = (e) => {
    const line = JSON.stringify({ t: Date.now(), ...e }) + "\n";
    writer.write(enc.encode(line)).catch(() => {});
  };
  emit({ type: "start", input, mode });
  let out = null;
  const work = runRoute({ input, qloo, env, emit })
    .then((o) => {
      out = o;
      ok = true;
    })
    .catch((e) => emit({ type: "error", error: e.message.slice(0, 240) }))
    .then(async () => {
      const at = today(env);
      // KV write 1 (a run that worked): its route and city files, with the saved-runs entry as metadata (Qloo's name
      // for the city, only when Qloo resolved it), saved before "done" so a client building again right away finds it
      let wrote = 0;
      if (ok) {
        if (await kvPut(env, kvKey, { route: out.route, city: out.city, at }, runMeta(out, input, at), out.route.gaps?.length ? GAP_TTL : RUN_TTL)) wrote = 1;
      }
      // KV write 2: the counter, once: the calls made, the run counted for the site and its visitor unless it failed
      // before spending (brand not found, no rooms, a city read as a state), the writes made
      await settle(env, { calls: env.QLOO_API_KEY ? qloo.calls : 0, counted: ok || qloo.calls > 2, ip: visitor, writes: wrote });
      // released only now that the counter (or this isolate's pending part) holds it: no gap where it's in neither
      inflight--;
      release();
      if (ok) emit({ type: "done", ok: true, calls: out.calls });
      await writer.close().catch(() => {});
    });
  ctx?.waitUntil?.(work);
  return new Response(readable, { headers: { "content-type": "application/x-ndjson", "cache-control": "no-store", "x-doors-cache": "miss" } });
}

// ---- R9 carry: "the plan comes with you" ----
// /manifest.webmanifest?c=<code>: public/manifest.json with start_url /app?drive=1&c=<code>, so the app installed from
// a plan opens that plan (iOS gives it its own storage; public/lib/carry.js). Anything but a code: the plain manifest.
// The asset only: no KV, no Qloo.
export async function handleManifest(request, env) {
  const url = new URL(request.url);
  const res = await env.ASSETS.fetch(new Request(new URL("/manifest.json", url), { method: "GET" }));
  if (!res.ok) return res;
  const m = await res.json();
  const c = url.searchParams.get("c") ?? "";
  if (c.length <= CARRY_MAX && CARRY_RE.test(c)) m.start_url = `/app?drive=1&c=${c}`;
  return new Response(JSON.stringify(m), { headers: { "content-type": "application/manifest+json", "cache-control": "no-store" } });
}
// ---- end R9 carry ----

// ---- polish2: link previews ----
// The two pages' Open Graph / Twitter tags need absolute URLs, and the deploy's workers.dev subdomain is picked at
// first deploy (scripts/publish.sh), so the HTML says __ORIGIN__ and the page is served with this request's own origin
// in its place. Only these paths, only a 200 text/html answer; everything else passes through (wrangler.toml sends
// them to the Worker first: run_worker_first).
export const PAGES = ["/", "/index.html", "/app", "/app.html"];
export async function handlePage(request, env) {
  const res = await env.ASSETS.fetch(request);
  if (res.status !== 200 || !/^text\/html/.test(res.headers.get("content-type") ?? "")) return res;
  const html = (await res.text()).replaceAll("__ORIGIN__", new URL(request.url).origin);
  const headers = new Headers(res.headers);
  headers.delete("content-length");
  headers.delete("etag");
  return new Response(html, { status: 200, headers });
}
// ---- end polish2 ----

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const p = url.pathname;
    if (p === "/api/health") {
      const paused = await livePaused(env, COST.route);
      return json({ ok: true, ...modeOf(env), roads: env.ORS_API_KEY ? "ors" : "estimate", live: { ok: !paused, reason: paused, used: env.QLOO_API_KEY ? await budgetUsed(env) : null, budget: Number(env.BUILD_BUDGET ?? DEFAULT_BUDGET) }, monthRemaining: quota.monthRemaining ?? null, agent: { ok: agentModel(env) !== "none", model: agentModel(env) } });
    }
    if (p === "/api/search") return handleSearch(url, env, request);
    // ---- R9 chat agent: docs/CONTRACTS-R9.md §1 ----
    if (p === "/api/agent" || p === "/api/agent/log-visit") return handleAgent(request, env, p);
    if (p === "/api/agent/debrief") return handleDebrief(request, env); // Doors Agent ability 9: Day done polish
    if (p === "/api/brief") return handleBrief(request, env, ctx, { originOk, ip: ipKey(request.headers.get("cf-connecting-ip") ?? "local") });
    if (p === "/api/voice/listen" || p === "/api/voice/say") return handleVoice(request, env, p);
    // ---- end R9 chat agent ----
    // L1: the saved live runs (free to open), newest first, for a page whose new runs are resting
    if (p === "/api/runs") return json({ runs: await offered(env, 20) });
    // L1: /api/route is v2's live agent (a brand or city Doors holds no files for). v1's lazy extras (sisters, door)
    // stay off unless V1_ROUTES=on, so a visitor cannot spend
    // the build's Qloo budget through them (D1 item 9).
    if ((p === "/api/sisters" || p === "/api/door") && env.V1_ROUTES !== "on") return json({ error: "retired in v2" }, 410);
    if (p === "/api/route") return handleRoute(request, env, ctx);
    if (p === "/api/place") return handlePlace(request, env); // group 3 item 2
    if (p === "/api/enrich") return handleEnrich(request, env); // round 3: a live plan's door, enriched
    if (p === "/api/talk") return handleTalk(request, env); // group 3 item 3
    if (p === "/api/sisters") return handleSisters(url, env, request);
    if (p === "/api/door") return handleDoor(url, env, request);
    if (p === "/api/directions") return handleDirections(request, env);
    if (p === "/api/matrix") return handleMatrix(request, env);
    if (p === "/api/geocode") return handleGeocode(request, env);
    if (p.startsWith("/api/")) return json({ error: "not found" }, 404);
    if (p.startsWith("/tiles/")) return handleTiles(request, env);
    if (p === "/manifest.webmanifest") return handleManifest(request, env); // R9 carry
    if (PAGES.includes(p) && (request.method === "GET" || request.method === "HEAD")) return handlePage(request, env); // polish2
    return env.ASSETS.fetch(request);
  },
};
