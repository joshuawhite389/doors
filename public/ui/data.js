// Loads the precomputed v1 data (public/data/**) for the v2 UI, and the live hooks (brand search, geocode, live runs).
import { routeFiles, cityRouteFiles, runLive, primeLive, unreachable } from "../lib/live.js";
import { mergePlace } from "../lib/place.js";

const cache = new Map();
export function getJSON(url) {
  if (!cache.has(url)) cache.set(url, fetch(url).then((r) => { if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.json(); }).then((j) => withPlaces(url, j)).catch((e) => { cache.delete(url); throw e; }));
  return cache.get(url);
}

// Group 3 item 2: a door's music and sister doors fetched in the app (POST /api/place) are kept on this device per city
// and merged into that city's file wherever it is read (Why this door, the stop, Everything Qloo knows).
const PLACES = "doors.v2.places";
const readPlaces = () => {
  try { return JSON.parse(localStorage.getItem(PLACES) ?? "{}") ?? {}; } catch { return {}; }
};
const CITY_URL = /^\/data\/cities\/([^/]+)\.json$/;
function withPlaces(url, j) {
  const key = CITY_URL.exec(url)?.[1];
  const got = key && readPlaces()[key];
  return got && j ? mergePlace(j, got) : j;
}
// → the city file with the door filled in, or throws an Error whose message is plain words for the screen
export async function fetchPlace({ cityKey, city, cityName, venue, want }) {
  let res;
  try {
    res = await fetch("/api/place", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: venue.id, city, cityName, want, popularity: venue.popularity ?? null, lat: venue.lat ?? null, lon: venue.lon ?? null, name: venue.name ?? "" }) });
  } catch {
    throw new Error("Doors didn't answer. Check you're online, then try again.");
  }
  const b = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(b.error ?? `Qloo didn't answer (${res.status}). Try again in a minute.`);
  const got = { sounds: b.sounds, sisters: b.sisters, sisterVenues: b.sisterVenues };
  const all = readPlaces();
  all[cityKey] = mergePlace(all[cityKey] ?? {}, got);
  try { localStorage.setItem(PLACES, JSON.stringify(all)); } catch {}
  const url = `/data/cities/${cityKey}.json`;
  const now = await (cache.get(url) ?? Promise.resolve(null)).catch(() => null);
  const merged = mergePlace(now ?? {}, got);
  cache.set(url, Promise.resolve(merged));
  return merged;
}
export const loadIndex = () => getJSON("/data/index.json");
// WHY-VIZ-SPEC §6: every door Doors holds for a city (the ranked lists and the big names of every brand file), the base
// a crowd group's city share is measured over (the stop card's rarity chips, the week view's clouds; ui/why.js builds
// the same for the drawer). Cached by getJSON, so the drawer, a stop and the week share one load. null: no files.
export async function loadCityBase(cityKey) {
  const index = await loadIndex();
  const files = cityRouteFiles(index, cityKey); // the baked brands and a live run's files alike (round 5 #2a)
  const routes = (await Promise.all(files.map((f) => getJSON(`/data/routes/${f}.json`).catch(() => null)))).filter(Boolean);
  if (!routes.length) return null;
  const { cityRooms } = await import("../lib/insights.js");
  const base = cityRooms(routes);
  const ids = new Set(base.ids), venues = { ...base.venues };
  for (const r of routes) for (const row of r?.lists?.famous ?? []) if (r.venues?.[row[0]]) (ids.add(row[0]), (venues[row[0]] = r.venues[row[0]]));
  return { ids: [...ids], venues };
}

// The drinker lists for a profile in its city: the venue preset, else each brand it names; fetched files, or a live
// run's files once primed (primeLiveRun).
// Fix 8: a list that didn't load throws unreachable (lib/live.js), never [] (no rooms): the page offers Try again.
export async function loadRoutes(profile, index) {
  return Promise.all(routeFiles(profile, index).map((f) => getJSON(`/data/routes/${f}.json`))).catch((e) => {
    throw unreachable(e);
  });
}

// L1: a live run's files, kept on this device by the run's cache key (lib/live.js liveCacheKey), so a saved plan opens
// without asking again; the Worker keeps them too (KV), so a cleared device costs no Qloo call either.
const LIVE = "doors.v2.live.";
const liveMem = new Map();
export const liveStore = {
  get(key) {
    if (liveMem.has(key)) return liveMem.get(key);
    try {
      const v = JSON.parse(localStorage.getItem(LIVE + key) ?? "null");
      if (v) liveMem.set(key, v);
      return v;
    } catch {
      return null;
    }
  },
  put(key, value) {
    liveMem.set(key, value);
    try {
      localStorage.setItem(LIVE + key, JSON.stringify(value));
    } catch {
      // full: drop the older runs and try once more (this run stays in memory either way)
      try {
        for (const k of Object.keys(localStorage)) if (k.startsWith(LIVE)) localStorage.removeItem(k);
        localStorage.setItem(LIVE + key, JSON.stringify(value));
      } catch {}
    }
  },
};
// Run a live profile's drinkers (onStep for each agent step) and put the files where fetched files go.
export async function runLiveProfile(profile, index, onStep) {
  const res = await runLive({ profile, index, onStep, cache: liveStore });
  await primeLive({ index, cache, fetched: getJSON }, res);
  const url = `/data/cities/${res.city.key}.json`; // the doors fetched in the app, over the live city file too
  if (cache.has(url)) cache.set(url, cache.get(url).then((j) => withPlaces(url, j)));
  return res;
}

// The drink list Doors holds (scripts/make-drinks.mjs), searched in the page as you type: [{id, name, kind, pop}], or
// null where there is none (the public repo): the field then searches Qloo only.
export const loadDrinks = () => getJSON("/data/drinks.json").catch(() => null);

// Live Qloo brand search through the Worker (v1 /api/search: one Qloo call per query, cached a day). Only ever called
// from an explicit "Search Qloo" click, never while typing.
export async function searchBrands(q) {
  const r = await fetch(`/api/search?type=brand&q=${encodeURIComponent(q)}`);
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(b.error ?? `search ${r.status}`);
  return b.rows ?? [];
}

// N3: a bar or restaurant in any city ("Rooms that already pour you"): one Qloo call → [{id, name, where}]
export async function searchRooms(q) {
  const r = await fetch(`/api/search?type=room&q=${encodeURIComponent(q)}`);
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(b.error ?? `search ${r.status}`);
  return b.rows ?? [];
}

// Address → [{label, lat, lon}] through the Worker's /api/geocode (slice A3). [] = a real search with no match. null =
// address search is off (no key, a limit, a provider error: the Worker answers `source:"none"`) or the endpoint
// failed: the form then offers the start chips and the pin, and never says "no match".
// L1: a live city by its name (live: {cityName, center?}), focused on its centre once known.
export async function geocode(q, city, live = null) {
  try {
    const where = live?.cityName ? `cityName=${encodeURIComponent(live.cityName)}${Array.isArray(live.center) ? `&lat=${live.center[0]}&lon=${live.center[1]}` : ""}` : `city=${encodeURIComponent(city)}`;
    const r = await fetch(`/api/geocode?q=${encodeURIComponent(q)}&${where}`);
    if (!r.ok) return null;
    const b = await r.json();
    if (b?.source === "none") return null;
    const rows = Array.isArray(b) ? b : b.results ?? b.rows ?? [];
    return rows.filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lon)).slice(0, 5);
  } catch {
    return null;
  }
}

// L1: a live city's centre by its name ({label, lat, lon}), or null when the lookup is off or finds nothing.
export async function locateCity(name) {
  try {
    const r = await fetch(`/api/geocode?kind=city&q=${encodeURIComponent(name)}`);
    if (!r.ok) return null;
    const b = await r.json();
    const x = (b.results ?? []).find((y) => Number.isFinite(y.lat) && Number.isFinite(y.lon));
    return x ?? null;
  } catch {
    return null;
  }
}

// Road matrix for the planner (slice A3's /api/matrix): {durations (min), distances (mi), source}. ?ors=off on the
// page forces the estimate, as on the Worker.
export async function fetchMatrix(coords) {
  const off = new URLSearchParams(location.search).get("ors") === "off";
  const r = await fetch(`/api/matrix${off ? "?ors=off" : ""}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ coords }) });
  if (!r.ok) throw new Error(`matrix ${r.status}`);
  return r.json();
}

// Add a door: Qloo places in a ready city by name (one Qloo call per search, cached a day). Rows carry the venue
// record: [{id, name, where, venue}]. Only ever called from an explicit Search click.
// L1: in a live city (live: {name, center}), by its name, kept within reach of its centre.
export async function searchPlaces(q, city, live = null) {
  const where = live?.center ? `cityName=${encodeURIComponent(live.query ?? live.name)}&lat=${live.center[0]}&lon=${live.center[1]}` : `city=${encodeURIComponent(city)}`;
  const r = await fetch(`/api/search?type=place&${where}&q=${encodeURIComponent(q)}`);
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(b.error ?? `search ${r.status}`);
  return b.rows ?? [];
}

// Address predictions while the rep types (owner review 7, M2): the Worker's /api/geocode?kind=auto, focused on the
// city's centre ([lat, lon]). → {rows: [{label, lat, lon}]}, or {rows: null, message} when search is resting (a cap,
// no key, ORS failing) or the request failed. A stale request is aborted by the caller (signal).
export async function autocomplete(q, center, signal) {
  const resting = { rows: null, message: "Address lookup isn't available right now: it has hit its limit for today or isn't set up on this server. Pick a starting point below or drop a pin on the map instead." };
  try {
    const r = await fetch(`/api/geocode?kind=auto&q=${encodeURIComponent(q)}&lat=${center[0]}&lon=${center[1]}`, { signal });
    const b = await r.json().catch(() => ({}));
    if (!r.ok || b.source === "none") return { ...resting, ...(b.message ? { message: b.message } : {}) };
    return { rows: (b.results ?? []).filter((x) => Number.isFinite(x.lat) && Number.isFinite(x.lon)).slice(0, 5) };
  } catch {
    return resting;
  }
}
