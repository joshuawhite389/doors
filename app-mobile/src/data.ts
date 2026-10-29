// The web's data layer (public/ui/data.js) on the phone: the same Worker endpoints and static files, on DOORS_API
// (the shared modules use paths like "/api/…": they go there too). Live runs keep their files in the app's storage.
import { routeFiles, runLive, primeLive, unreachable } from "../../public/lib/live.js";
import { DOORS_API } from "./config";
import { syncStorage } from "./storage";

export const api = (path: string) => (path.startsWith("/") ? DOORS_API + path : path);
// Native fetch sends no Origin; the Worker's POST endpoints want one (CONTRACTS-R9 §0): its own.
export const workerFetch = (url: string, init: RequestInit = {}, ms = 30000) =>
  timed(api(url), ms, { ...init, headers: { ...(init.headers as Record<string, string>), Origin: DOORS_API } });

// The Worker's static files (/data/…), kept on the phone once fetched, so a saved plan opens with no signal (the web's
// offline shell, sw.js, does the same in the browser). A fresh copy always wins when the network answers.
// a fetch that gives up after ms (no signal: the phone's request can hang far longer than a rep will wait)
export function timed(url: string, ms: number, init: RequestInit = {}) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return fetch(url, { ...init, signal: c.signal }).finally(() => clearTimeout(t));
}
const cache = new Map<string, Promise<any>>();
const KEPT = "doors.app.cache.";
export function getJSON(url: string, ms = 8000): Promise<any> {
  if (!cache.has(url))
    cache.set(url, timed(api(url), ms)
      .then(async (r) => {
        if (!r.ok) throw new Error(`${url}: ${r.status}`);
        const text = await r.text();
        if (url.startsWith("/data/")) try { syncStorage.setItem(KEPT + url, text); } catch {}
        return JSON.parse(text);
      })
      .catch((e) => {
        const kept = url.startsWith("/data/") ? syncStorage.getItem(KEPT + url) : null;
        if (kept) return JSON.parse(kept);
        cache.delete(url);
        throw e;
      }));
  return cache.get(url)!;
}
export const loadIndex = (ms?: number) => getJSON("/data/index.json", ms);
// Fix 8: a list that didn't load (and isn't kept on the phone) throws unreachable, never [] (no rooms): Try again
export const loadRoutes = (profile: any, index: any) =>
  Promise.all(routeFiles(profile, index).map((f: string) => getJSON(`/data/routes/${f}.json`))).catch((err) => {
    throw unreachable(err);
  });

const LIVE = "doors.v2.live.";
const liveMem = new Map<string, any>();
export const liveStore = {
  get(key: string) {
    if (liveMem.has(key)) return liveMem.get(key);
    try {
      const v = JSON.parse(syncStorage.getItem(LIVE + key) ?? "null");
      if (v) liveMem.set(key, v);
      return v;
    } catch {
      return null;
    }
  },
  put(key: string, value: any) {
    liveMem.set(key, value);
    try { syncStorage.setItem(LIVE + key, JSON.stringify(value)); } catch {}
  },
};
// Run a live profile's drinkers (onStep for each agent step) and put its files where fetched files go.
export async function runLiveProfile(profile: any, index: any, onStep: (e: any) => void) {
  const res = await runLive({ profile, index, onStep, cache: liveStore, fetchImpl: (u: string, i?: RequestInit) => workerFetch(u, i) });
  await primeLive({ index, cache, fetched: getJSON }, res);
  return res;
}

export const loadDrinks = () => getJSON("/data/drinks.json").catch(() => null);

async function search(type: string, q: string, extra = "") {
  const r = await fetch(api(`/api/search?type=${type}${extra}&q=${encodeURIComponent(q)}`));
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(b.error ?? `search ${r.status}`);
  return b.rows ?? [];
}
export const searchBrands = (q: string) => search("brand", q);
export const searchRooms = (q: string) => search("room", q);
export function searchPlaces(q: string, city: string, live: any = null) {
  const where = live?.center ? `&cityName=${encodeURIComponent(live.query ?? live.name)}&lat=${live.center[0]}&lon=${live.center[1]}` : `&city=${encodeURIComponent(city)}`;
  return search("place", q, where);
}

export type GeoRow = { label: string; lat: number; lon: number };
export async function geocode(q: string, city: string, live: any = null): Promise<GeoRow[] | null> {
  try {
    const where = live?.cityName ? `cityName=${encodeURIComponent(live.cityName)}${Array.isArray(live.center) ? `&lat=${live.center[0]}&lon=${live.center[1]}` : ""}` : `city=${encodeURIComponent(city)}`;
    const r = await fetch(api(`/api/geocode?q=${encodeURIComponent(q)}&${where}`));
    if (!r.ok) return null;
    const b = await r.json();
    if (b?.source === "none") return null;
    const rows = Array.isArray(b) ? b : b.results ?? b.rows ?? [];
    return rows.filter((x: any) => Number.isFinite(x.lat) && Number.isFinite(x.lon)).slice(0, 5);
  } catch {
    return null;
  }
}
export async function locateCity(name: string): Promise<GeoRow | null> {
  try {
    const r = await fetch(api(`/api/geocode?kind=city&q=${encodeURIComponent(name)}`));
    if (!r.ok) return null;
    const b = await r.json();
    return (b.results ?? []).find((y: any) => Number.isFinite(y.lat) && Number.isFinite(y.lon)) ?? null;
  } catch {
    return null;
  }
}
export async function autocomplete(q: string, center: number[], signal?: AbortSignal): Promise<{ rows: GeoRow[] | null; message?: string }> {
  const resting = { rows: null, message: "Address lookup isn't available right now: it has hit its limit for today or isn't set up on this server. Pick a starting point below or drop a pin on the map instead." };
  try {
    const r = await fetch(api(`/api/geocode?kind=auto&q=${encodeURIComponent(q)}&lat=${center[0]}&lon=${center[1]}`), { signal });
    const b = await r.json().catch(() => ({}));
    if (!r.ok || b.source === "none") return { ...resting, ...(b.message ? { message: b.message } : {}) };
    return { rows: (b.results ?? []).filter((x: any) => Number.isFinite(x.lat) && Number.isFinite(x.lon)).slice(0, 5) };
  } catch {
    return resting;
  }
}
// Road matrix for the planner (/api/matrix): {durations, distances, source}
export async function fetchMatrix(coords: number[][]) {
  const r = await workerFetch("/api/matrix", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ coords }) }, 10000);
  if (!r.ok) throw new Error(`matrix ${r.status}`);
  return r.json();
}
