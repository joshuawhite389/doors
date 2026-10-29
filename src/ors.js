// Road routing and geocoding through OpenRouteService (SPEC-V2 §5.2), with a straight-line fallback everywhere.
// POST /api/directions {coords:[[lon,lat],…]}            → {geometry, wayPoints, legs:[{mi,min}], mi, min, source}
// POST /api/matrix {coords, sources?, destinations?}       → {durations (min), distances (mi), source}
// GET  /api/geocode?q=&city=                               → {results:[{label,lat,lon}], source} or {fallback:"pin"}
// GET  /api/geocode?q=&cityName=[&lat=&lon=] | ?kind=city&q=  (a live city, by name; kind=city finds the city)
// GET  /api/geocode?kind=auto&q=&lat=&lon=                  → {results, source} predictions while the rep types (M2)
// Every ORS answer is cached in KV by a hash of the request (30 days). A per-IP limiter and a daily ceiling per
// endpoint (below the free Standard plan) keep the key inside its quota; past either, the answer is the estimate.
// The estimate: straight-line distance × 1.35 road factor at 18 mph, labelled `source:"estimate"`.
// `?ors=off` (or `"ors":"off"` in the body) forces the estimate, for testing the fallback.
import { km } from "../public/lib/core.js";
import { orsMayWrite, noteWrites } from "./kvbook.js";
import { ipKey, originOk } from "./guard.js";

export const ORS_BASE = "https://api.openrouteservice.org";
// Free Standard plan, per endpoint (account.heigit.org/info/plans, read 2026-10-08): requests per day / per minute.
export const ORS_PLAN = { directions: { day: 2000, minute: 40 }, matrix: { day: 500, minute: 40 }, geocode: { day: 1000, minute: 100 }, autocomplete: { day: 1000, minute: 100 } };
// Our own daily ceiling, kept under the plan so a busy day still leaves the key working tomorrow.
export const ORS_CEILING = { directions: 1600, matrix: 400, geocode: 800, autocomplete: 800 };
// Request shape limits: ORS allows 50 waypoints and 3,500 matrix cells (openrouteservice.org/restrictions).
export const LIMITS = { waypoints: 50, matrixCoords: 100, matrixCells: 2500 };
export const ROAD_FACTOR = 1.35;
export const EST_MPH = 18;
export const ESTIMATE_LABEL = "estimated: straight-line distance × 1.35";
const MI_PER_M = 1 / 1609.344;
const MI_PER_KM = 0.621371;
const TTL = 30 * 86400;
// Per visitor per 10 minutes. Sized for a rep re-planning ~30 times an hour (R1 Diolosa 10): a plan load asks one
// matrix per window (≤ 5) and one route per day (≤ 5); a re-plan asks no new matrix (the sets ignore statuses) and
// a route for each day that changed (~2). So 10 minutes of heavy use is ~5 matrices and ~15–25 routes, plus Play all
// and a few profile edits; these leave 4–10× headroom and still stop a loop from draining the daily ceiling.
export const PER_IP = { directions: 120, matrix: 60, geocode: 60, autocomplete: 60 };
// Address predictions (M2) are asked while the rep types (≥ 3 characters, 250 ms apart): ~5–10 per address. Besides
// the ten-minute limit, one visitor gets AUTO_PER_IP_DAY a day, and the whole site AUTO_PER_MIN a minute (ORS: 100).
export const AUTO_PER_IP_DAY = 200;
export const AUTO_PER_MIN = 80;

// The four ready cities: geocode focuses on the centre and keeps answers within 40 km.
export const CITY_CENTERS = { austin: [30.2672, -97.7431], boise: [43.615, -116.2023], chicago: [41.8781, -87.6298], omaha: [41.2565, -95.9345] };

const r1 = (x) => Math.round(x * 10) / 10;

// ---------- validation ----------
const isLonLat = (c) => Array.isArray(c) && c.length === 2 && c.every((x) => typeof x === "number" && Number.isFinite(x)) && Math.abs(c[0]) <= 180 && Math.abs(c[1]) <= 90;

export function validateCoords(coords, { min = 2, max = LIMITS.waypoints } = {}) {
  if (!Array.isArray(coords)) return { error: "coords must be an array of [lon, lat] pairs" };
  if (coords.length < min || coords.length > max) return { error: `coords needs ${min} to ${max} points (got ${coords.length})` };
  const bad = coords.findIndex((c) => !isLonLat(c));
  if (bad >= 0) return { error: `coords[${bad}] must be [lon, lat] numbers (lon −180…180, lat −90…90)` };
  return { coords: coords.map(([lon, lat]) => [Math.round(lon * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6]) };
}

function validateIndexes(list, n, name) {
  if (list == null) return { list: null };
  if (!Array.isArray(list) || !list.length || list.some((i) => !Number.isInteger(i) || i < 0 || i >= n) || new Set(list).size !== list.length) return { error: `${name} must be distinct indexes into coords (0…${n - 1})` };
  return { list };
}

export function validateMatrix(body) {
  const v = validateCoords(body?.coords, { min: 2, max: LIMITS.matrixCoords });
  if (v.error) return v;
  const n = v.coords.length;
  const s = validateIndexes(body.sources, n, "sources");
  if (s.error) return s;
  const d = validateIndexes(body.destinations, n, "destinations");
  if (d.error) return d;
  const cells = (s.list?.length ?? n) * (d.list?.length ?? n);
  if (cells > LIMITS.matrixCells) return { error: `matrix is ${cells} cells; at most ${LIMITS.matrixCells} (pass sources/destinations to narrow it)` };
  return { coords: v.coords, sources: s.list, destinations: d.list };
}

// ---------- the estimate ----------
const pt = ([lon, lat]) => ({ lat, lon });
export function estimateLeg(a, b) {
  const mi = km(pt(a), pt(b)) * MI_PER_KM * ROAD_FACTOR;
  return { mi, min: (mi / EST_MPH) * 60 };
}

export function estimateDirections(coords, reason = null) {
  const raw = coords.slice(1).map((c, i) => estimateLeg(coords[i], c));
  return {
    geometry: { type: "LineString", coordinates: coords },
    wayPoints: coords.map((_, i) => i),
    legs: raw.map((l) => ({ mi: r1(l.mi), min: r1(l.min) })),
    mi: r1(raw.reduce((s, l) => s + l.mi, 0)),
    min: r1(raw.reduce((s, l) => s + l.min, 0)),
    source: "estimate",
    label: ESTIMATE_LABEL,
    ...(reason ? { reason } : {}),
  };
}

export function estimateMatrix(coords, sources = null, destinations = null, reason = null) {
  const S = sources ?? coords.map((_, i) => i);
  const D = destinations ?? coords.map((_, i) => i);
  const durations = [];
  const distances = [];
  for (const i of S) {
    const legs = D.map((j) => (i === j ? { mi: 0, min: 0 } : estimateLeg(coords[i], coords[j])));
    durations.push(legs.map((l) => r1(l.min)));
    distances.push(legs.map((l) => r1(l.mi)));
  }
  return { durations, distances, sources: S, destinations: D, source: "estimate", label: ESTIMATE_LABEL, ...(reason ? { reason } : {}) };
}

// ---------- ORS response parsing (meters and seconds in, miles and minutes out) ----------
export function parseDirections(body, coords) {
  const f = body?.features?.[0];
  let segs = f?.properties?.segments;
  const wp = f?.properties?.way_points;
  if (f?.geometry?.type !== "LineString") throw new Error("ORS directions: unexpected response shape");
  // With instructions on, ORS returns one segment (distance, duration) per pair of consecutive waypoints. Without them
  // (seen live 2026-10-09) it returns only way_points + summary: split the line at the way_points and share the
  // summary's time by distance.
  if (!Array.isArray(segs) && Array.isArray(wp) && wp.length === coords.length && f.properties.summary) {
    const line = f.geometry.coordinates;
    const m = (a, b) => 6371008.8 * 2 * Math.asin(Math.sqrt(Math.sin(((b[1] - a[1]) * Math.PI) / 360) ** 2 + Math.cos((a[1] * Math.PI) / 180) * Math.cos((b[1] * Math.PI) / 180) * Math.sin(((b[0] - a[0]) * Math.PI) / 360) ** 2));
    const geo = wp.slice(1).map((end, i) => { let d = 0; for (let k = wp[i]; k < end; k++) d += m(line[k], line[k + 1]); return d; });
    const tot = geo.reduce((x, y) => x + y, 0) || 1, S = f.properties.summary;
    segs = geo.map((d) => ({ distance: (S.distance * d) / tot, duration: (S.duration * d) / tot }));
  }
  if (!Array.isArray(segs)) throw new Error("ORS directions: unexpected response shape");
  if (segs.length !== coords.length - 1) throw new Error(`ORS directions: ${segs.length} segments for ${coords.length} waypoints`);
  const legs = segs.map((s) => ({ mi: r1((s.distance ?? 0) * MI_PER_M), min: r1((s.duration ?? 0) / 60) }));
  const sum = f.properties.summary ?? {};
  return {
    geometry: { type: "LineString", coordinates: f.geometry.coordinates },
    // index of each waypoint in the geometry (the route animation pins doors to these)
    ...(Array.isArray(f.properties.way_points) ? { wayPoints: f.properties.way_points } : {}),
    legs,
    mi: r1((sum.distance ?? segs.reduce((a, s) => a + (s.distance ?? 0), 0)) * MI_PER_M),
    min: r1((sum.duration ?? segs.reduce((a, s) => a + (s.duration ?? 0), 0)) / 60),
    source: "ors",
  };
}

// Unroutable pairs come back as null: those cells take the estimate and are listed in `estimated`.
export function parseMatrix(body, coords, sources = null, destinations = null) {
  const S = sources ?? coords.map((_, i) => i);
  const D = destinations ?? coords.map((_, i) => i);
  if (!Array.isArray(body?.durations) || !Array.isArray(body?.distances) || body.durations.length !== S.length) throw new Error("ORS matrix: unexpected response shape");
  const estimated = [];
  const durations = [];
  const distances = [];
  S.forEach((i, a) => {
    const du = [];
    const di = [];
    D.forEach((j, b) => {
      const s = body.durations[a]?.[b];
      const m = body.distances[a]?.[b];
      if (typeof s !== "number" || typeof m !== "number") {
        const e = i === j ? { mi: 0, min: 0 } : estimateLeg(coords[i], coords[j]);
        estimated.push([a, b]);
        du.push(r1(e.min));
        di.push(r1(e.mi));
      } else {
        du.push(r1(s / 60));
        di.push(r1(m * MI_PER_M));
      }
    });
    durations.push(du);
    distances.push(di);
  });
  return { durations, distances, sources: S, destinations: D, source: "ors", ...(estimated.length ? { estimated, label: ESTIMATE_LABEL } : {}) };
}

export function parseGeocode(body) {
  if (!Array.isArray(body?.features)) throw new Error("ORS geocode: unexpected response shape");
  return body.features
    .filter((f) => f?.geometry?.type === "Point" && isLonLat(f.geometry.coordinates))
    .slice(0, 5)
    .map((f) => ({ label: String(f.properties?.label ?? f.properties?.name ?? "").slice(0, 160), lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] }));
}

// ---------- plumbing: cache, limiter, daily ceiling ----------
const hits = new Map();
export function orsLimited(ip, kind, now = Date.now()) {
  const windowMs = 10 * 60 * 1000;
  const key = `${kind}:${ip}`;
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > (PER_IP[kind] ?? 30);
}
export function resetOrsLimiter() {
  hits.clear();
  memDay.clear();
  geoMemo.clear();
  autoMemo.clear();
  autoDay.clear();
  autoMin.length = 0;
}

export async function cacheKey(kind, input) {
  const bytes = new TextEncoder().encode(JSON.stringify([kind, input]));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return `ors:v1:${kind}:${[...new Uint8Array(hash)].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

async function kvGet(env, key) {
  try {
    return env.DOORS_KV ? await env.DOORS_KV.get(key, "json") : null;
  } catch {
    return null;
  }
}
// The ORS cache in KV (matrices and directions: what a plan needs again) writes only while today's KV writes leave
// room (src/kvbook.js: the free plan's 1,000 a day are mostly for runs); each write is noted in that day's tally.
async function kvPut(env, key, value, ttl = TTL) {
  try {
    if (env.DOORS_KV && (await orsMayWrite(env))) {
      await env.DOORS_KV.put(key, JSON.stringify(value), { expirationTtl: ttl });
      noteWrites(env, 1);
    }
  } catch {}
}
// Geocodes (one per address a rep types) are cached in this isolate's memory only: no KV write.
const geoMemo = new Map();

// Calls made to ORS today, per endpoint, in this isolate's memory (no KV write; ORS refuses past its own quota and
// the Worker then answers the labelled estimate).
const memDay = new Map();
const dayOf = (d = new Date()) => d.toISOString().slice(0, 10);
async function usedToday(env, kind) {
  return memDay.get(`ors:n:${kind}:${dayOf()}`) ?? 0;
}
async function countToday(env, kind) {
  const k = `ors:n:${kind}:${dayOf()}`;
  if (memDay.size > 1000) memDay.clear();
  memDay.set(k, (memDay.get(k) ?? 0) + 1);
}
const ceilingOf = (env, kind) => Number(env[`ORS_CEILING_${kind.toUpperCase()}`] ?? ORS_CEILING[kind]);

// Why this request gets the estimate instead of ORS, or null.
async function skipReason(env, kind, ip, forced) {
  if (forced) return "forced: ors=off";
  if (!env.ORS_API_KEY) return "no ORS key on this server";
  if (orsLimited(ip, kind)) return "too many requests from this visitor in ten minutes";
  if ((await usedToday(env, kind)) >= ceilingOf(env, kind)) return `today's ${kind} ceiling (${ceilingOf(env, kind)}) is reached`;
  return null;
}

async function orsFetch(env, path, init) {
  const f = env.ORS_FETCH ?? ((u, i) => fetch(u, i));
  const res = await f(`${ORS_BASE}${path}`, { ...init, signal: init.signal ?? AbortSignal.timeout(8000) });
  if (!res.ok) {
    // the key never appears in this message: the URL is not echoed
    const status = res.status === 403 || res.status === 429 ? `${res.status} (quota or rate limit)` : String(res.status);
    throw new Error(`ORS answered ${status}`);
  }
  return res.json();
}

const json = (body, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const ipOf = (req) => req.headers.get("cf-connecting-ip") ?? "local";
const forcedOff = (url, body) => url.searchParams.get("ors") === "off" || body?.ors === "off" || body?.ors === false;

async function readBody(request) {
  if (request.method !== "POST") return { error: "POST a JSON body" };
  try {
    return { body: await request.json() };
  } catch {
    return { error: "Send JSON: {coords:[[lon,lat],…]}" };
  }
}

// ---------- handlers ----------
export async function handleDirections(request, env) {
  const url = new URL(request.url);
  const { body, error } = await readBody(request);
  if (error) return json({ error }, 400);
  const v = validateCoords(body?.coords);
  if (v.error) return json({ error: v.error }, 400);
  const key = await cacheKey("directions", v.coords);
  const forced = forcedOff(url, body);
  if (!forced) {
    const hit = await kvGet(env, key);
    if (hit) return json({ ...hit, cache: "hit" });
  }
  const skip = await skipReason(env, "directions", ipOf(request), forced);
  if (skip) return json(estimateDirections(v.coords, skip));
  try {
    await countToday(env, "directions");
    const raw = await orsFetch(env, "/v2/directions/driving-car/geojson", {
      method: "POST",
      headers: { authorization: env.ORS_API_KEY, "content-type": "application/json", accept: "application/geo+json, application/json" },
      body: JSON.stringify({ coordinates: v.coords, instructions: true, instructions_format: "text", maneuvers: false }), // segments need instructions on
    });
    const out = parseDirections(raw, v.coords);
    await kvPut(env, key, out);
    return json(out);
  } catch (e) {
    return json(estimateDirections(v.coords, e.message.slice(0, 140)));
  }
}

export async function handleMatrix(request, env) {
  const url = new URL(request.url);
  const { body, error } = await readBody(request);
  if (error) return json({ error }, 400);
  const v = validateMatrix(body);
  if (v.error) return json({ error: v.error }, 400);
  const input = { c: v.coords, s: v.sources, d: v.destinations };
  const key = await cacheKey("matrix", input);
  const forced = forcedOff(url, body);
  if (!forced) {
    const hit = await kvGet(env, key);
    if (hit) return json({ ...hit, cache: "hit" });
  }
  const skip = await skipReason(env, "matrix", ipOf(request), forced);
  if (skip) return json(estimateMatrix(v.coords, v.sources, v.destinations, skip));
  try {
    await countToday(env, "matrix");
    const raw = await orsFetch(env, "/v2/matrix/driving-car", {
      method: "POST",
      headers: { authorization: env.ORS_API_KEY, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ locations: v.coords, metrics: ["duration", "distance"], ...(v.sources ? { sources: v.sources } : {}), ...(v.destinations ? { destinations: v.destinations } : {}) }),
    });
    const out = parseMatrix(raw, v.coords, v.sources, v.destinations);
    await kvPut(env, key, out);
    return json(out);
  } catch (e) {
    return json(estimateMatrix(v.coords, v.sources, v.destinations, e.message.slice(0, 140)));
  }
}

const GEOCODE_CITY_KM = 80;

export async function handleGeocode(request, env) {
  const url = new URL(request.url);
  const q = (url.searchParams.get("q") ?? "").trim().replace(/\s+/g, " ");
  if (q.length < 3 || q.length > 120) return json({ error: "q (3–120 characters) is required" }, 400);
  if (url.searchParams.get("kind") === "auto") return handleAutocomplete(request, env, url, q);
  // L1: a live city, by its name: an address in it (focused on its centre once the page knows it), or the city itself
  const cityName = (url.searchParams.get("cityName") ?? "").trim().replace(/\s+/g, " ");
  const findCity = url.searchParams.get("kind") === "city";
  if (findCity || (url.searchParams.has("cityName") && !CITY_CENTERS[(url.searchParams.get("city") ?? "").trim().toLowerCase()])) {
    if (!findCity && (cityName.length < 2 || cityName.length > 80)) return json({ error: "cityName (2–80 characters) is required" }, 400);
    const c = [Number(url.searchParams.get("lon")), Number(url.searchParams.get("lat"))];
    const center = url.searchParams.has("lat") && isLonLat(c) ? [c[1], c[0]] : null;
    return geocodeText(request, env, url, { text: findCity ? q : `${q}, ${cityName}`, center, layers: findCity ? "locality,localadmin" : null });
  }
  // Only for the four ready cities (R1 Diolosa 14): `city` must be one of them, or lat/lon within 80 km of one's
  // centre. A lat/lon far from the named city is ignored (the city centre is used).
  const cityKey = (url.searchParams.get("city") ?? "").trim().toLowerCase();
  if (cityKey && !CITY_CENTERS[cityKey]) return json({ error: `city must be one of ${Object.keys(CITY_CENTERS).join(", ")}` }, 400);
  let center = CITY_CENTERS[cityKey] ?? null;
  const lat = url.searchParams.get("lat");
  const lon = url.searchParams.get("lon");
  if (lat != null || lon != null) {
    const c = [Number(lon), Number(lat)];
    if (!isLonLat(c)) return json({ error: "lat and lon must be numbers (lat −90…90, lon −180…180)" }, 400);
    const near = (ctr) => km({ lat: ctr[0], lon: ctr[1] }, { lat: c[1], lon: c[0] }) <= GEOCODE_CITY_KM;
    if (center ? near(center) : Object.values(CITY_CENTERS).some(near)) center = [c[1], c[0]];
    else if (!center) return json({ error: "lat/lon must be within 80 km of a ready city (austin, boise, chicago, omaha)" }, 400);
  }
  if (!center) return json({ error: "city (austin, boise, chicago or omaha) or lat/lon near one is required" }, 400);
  return geocodeText(request, env, url, { text: q, center });
}

// One ORS geocode search, cached in KV: text, focused and bounded (40 km) on center when given, US only.
async function geocodeText(request, env, url, { text, center = null, layers = null }) {
  const q = text;
  const fallback = (reason) => json({ fallback: "pin", results: [], source: "none", reason, message: "Couldn't look up addresses right now: drop a pin on the map instead." });
  const input = { q: q.toLowerCase(), center, ...(layers ? { layers } : {}) };
  const key = await cacheKey("geocode", input);
  const forced = forcedOff(url, null);
  if (!forced) {
    const hit = geoMemo.get(key);
    if (hit) return json({ ...hit, cache: "hit" });
  }
  const skip = await skipReason(env, "geocode", ipOf(request), forced);
  if (skip) return fallback(skip);
  try {
    await countToday(env, "geocode");
    const p = new URLSearchParams({ api_key: env.ORS_API_KEY, text: q, size: "5", "boundary.country": "US" });
    if (layers) p.set("layers", layers);
    if (center) {
      p.set("focus.point.lat", String(center[0]));
      p.set("focus.point.lon", String(center[1]));
      p.set("boundary.circle.lat", String(center[0]));
      p.set("boundary.circle.lon", String(center[1]));
      p.set("boundary.circle.radius", "40");
    }
    const results = parseGeocode(await orsFetch(env, `/geocode/search?${p}`, { headers: { accept: "application/json" } }));
    const out = { results, source: "ors", ...(results.length ? {} : { fallback: "pin", message: "No match for that address: drop a pin on the map instead." }) };
    if (geoMemo.size > 2000) geoMemo.clear();
    geoMemo.set(key, out);
    return json(out);
  } catch (e) {
    return fallback(e.message.slice(0, 140));
  }
}

// ---------- address predictions while typing (owner review 7, M2) ----------
// ORS /geocode/autocomplete, focused on the city's centre and kept to a box ~40 km around it (autocomplete takes
// boundary.rect, not boundary.circle), US only. Answers are kept in this isolate's memory: 0 KV reads or writes a
// keystroke. Past a cap, or when ORS fails: {source:"none", resting:true}, and the page offers the pin and the
// starting points.
const autoMemo = new Map();
const autoDay = new Map(); // `${day}|${ip}` → predictions asked today
const autoMin = []; // times of the site's predictions in the last minute
export const AUTO_RESTING = "Address lookup isn't available right now: it has hit its limit for today or isn't set up on this server. Pick a starting point below or drop a pin on the map instead.";
const AUTO_KM = 40;

// "57 La Belle St" → "57 Labelle St"; "Van Buren", "De Soto", "Mc Kinley" alike. q unchanged when there's none.
export const joinParticles = (q) => q.replace(/\b(la|le|de|du|da|di|del|des|van|von|mc|mac)\s+(?=[a-z]{3})/gi, "$1");

async function handleAutocomplete(request, env, url, q) {
  if (!originOk(request, env)) return json({ error: "Address search comes from Doors' own page." }, 403);
  const c = [Number(url.searchParams.get("lon")), Number(url.searchParams.get("lat"))];
  if (!url.searchParams.has("lat") || !url.searchParams.has("lon") || !isLonLat(c)) return json({ error: "lat and lon (the city's centre) are required" }, 400);
  const center = [Math.round(c[1] * 100) / 100, Math.round(c[0] * 100) / 100]; // ~1 km: one cache entry per city
  const resting = (reason) => json({ results: [], source: "none", resting: true, reason, message: AUTO_RESTING });
  const key = JSON.stringify([q.toLowerCase(), center]);
  const forced = forcedOff(url, null);
  const hit = !forced && autoMemo.get(key);
  if (hit) return json({ ...hit, cache: "hit" });
  const ip = ipKey(ipOf(request));
  const day = dayOf();
  const now = env.ORS_NOW?.() ?? Date.now(); // tests move the clock
  while (autoMin.length && now - autoMin[0] > 60000) autoMin.shift();
  const skip = (await skipReason(env, "autocomplete", ip, forced)) ??
    ((autoDay.get(`${day}|${ip}`) ?? 0) >= AUTO_PER_IP_DAY ? "this visitor's predictions for today are used" : autoMin.length >= AUTO_PER_MIN ? "too many predictions this minute" : null);
  if (skip) return resting(skip);
  try {
    await countToday(env, "autocomplete");
    if (autoDay.size > 5000) autoDay.clear();
    autoDay.set(`${day}|${ip}`, (autoDay.get(`${day}|${ip}`) ?? 0) + 1);
    autoMin.push(now);
    const dLat = AUTO_KM / 111;
    const dLon = AUTO_KM / (111 * Math.cos((center[0] * Math.PI) / 180));
    const p = new URLSearchParams({ api_key: env.ORS_API_KEY, text: q, size: "5", layers: "address,venue,street", "boundary.country": "US",
      "focus.point.lat": String(center[0]), "focus.point.lon": String(center[1]),
      "boundary.rect.min_lat": (center[0] - dLat).toFixed(4), "boundary.rect.max_lat": (center[0] + dLat).toFixed(4),
      "boundary.rect.min_lon": (center[1] - dLon).toFixed(4), "boundary.rect.max_lon": (center[1] + dLon).toFixed(4) });
    const ask = async () => parseGeocode(await orsFetch(env, `/geocode/autocomplete?${p}`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(5000) }));
    let rows = await ask();
    // Jard 10-23 #13: ORS's house numbers can spell a street as one word ("57 Labelle Street") where the street, and
    // the rep, say "La Belle": 0 predictions for the right spelling. One more try with the particle joined (one more
    // counted call, only on a miss).
    const joined = joinParticles(q);
    if (!rows.length && joined !== q) {
      await countToday(env, "autocomplete");
      p.set("text", joined);
      rows = await ask();
    }
    const out = { results: rows.filter((r, i) => rows.findIndex((x) => x.label === r.label) === i), source: "ors" }; // ORS repeats an address as a venue
    if (autoMemo.size > 5000) autoMemo.clear();
    autoMemo.set(key, out);
    return json(out);
  } catch (e) {
    return resting(e.message.slice(0, 140));
  }
}
