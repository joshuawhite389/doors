// A day's road on the map (ui/animate.js roadFor): /api/directions for start → stops in order, cached; any failure is
// the labelled straight-line estimate (drawn dashed). The demo seeds its baked OSRM roads and asks nothing (offline).
import { workerFetch } from "./data";

export type Road = { coords: { latitude: number; longitude: number }[]; solid: boolean; label: string };
const roads = new Map<string, Promise<Road>>();
const coordsOf = (start: any, stops: any[]) => [[start.lon, start.lat], ...stops.map((s) => [s.lon, s.lat])].map(([x, y]) => [+(+x).toFixed(6), +(+y).toFixed(6)]);
const toLL = (c: number[][]) => c.map(([lon, lat]) => ({ latitude: lat, longitude: lon }));
const estimate = (c: number[][]): Road => ({ coords: toLL(c), solid: false, label: "Route estimated: straight lines between stops" });

export function seedRoad(start: any, stops: any[], geometry: number[][], label: string) {
  roads.set(JSON.stringify(coordsOf(start, stops)), Promise.resolve({ coords: toLL(geometry), solid: true, label }));
}
export function roadFor(start: any, stops: any[], { offline = false } = {}): Promise<Road> {
  const c = coordsOf(start, stops);
  const key = JSON.stringify(c);
  if (c.length < 2 || (offline && !roads.has(key))) return Promise.resolve(estimate(c));
  if (!roads.has(key)) {
    const p = workerFetch("/api/directions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ coords: c }) })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`directions ${r.status}`))))
      .then((b: any): Road => {
        if (b?.geometry?.type !== "LineString" || !(b.geometry.coordinates?.length >= 2)) throw new Error("bad shape");
        return b.source === "estimate" ? estimate(c) : { coords: toLL(b.geometry.coordinates), solid: true, label: b.label ?? "Roads" };
      })
      .catch(() => { roads.delete(key); return estimate(c); });
    roads.set(key, p);
  }
  return roads.get(key)!;
}
// the demo's baked roads (demo.json roads: {start, stops:[{id}], geometry, label}) for its venues
export function seedDemoRoads(demoRoads: any[], venues: Record<string, any>) {
  for (const r of demoRoads ?? []) {
    if (r?.geometry?.type !== "LineString" || r.source === "estimate" || !r.start) continue;
    const stops = (r.stops ?? []).map((s: any) => venues[s.id] ?? s);
    if (stops.every((s: any) => Number.isFinite(+s.lat))) seedRoad(r.start, stops, r.geometry.coordinates, r.label ?? "Roads");
  }
}
