// Bake the demo's road data (SPEC-V2 §3.6): run the real planner on the demo profile (public/lib/demo-profile.js),
// fetch road times and geometry ONCE from the public OSRM demo server, and write public/data/demo/demo.json. The demo
// page then asks no server for anything. Re-run after any planner change: node scripts/bake-demo.mjs
//   1 OSRM table over the start + every door in the pool (the planner's road times, all three demo states)
//   1 OSRM route per distinct day the demo shows (Tue, Wed, Thu, and any day the follow-up or the drive-mode visit
//   changes)
// Answers are cached in data/demo-osrm-cache.json, so a re-run only asks for what changed. At most 10 requests per
// run, one per second, with a descriptive User-Agent. Prints a summary and every request it made.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import { demoProfile, demoContact, DEMO_CONTACT_ID, DEMO_KNOWN, PERSONA } from "../public/lib/demo-profile.js";
import { demoStates, bakedMatrix, dayCoords, coordsKey, DEMO_ATTRIBUTION, nowStamp } from "../public/lib/demo-plan.js";
import { parseHours, openMinutes, km } from "../public/lib/core.js";
import { WAIT_MAX_MIN } from "../public/lib/schedule.js";
import { clock12 } from "../public/lib/profile.js";
import { parseMatrix } from "../src/ors.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OSRM = "https://router.project-osrm.org";
const UA = "Doors-demo-bake/1.0 (Qloo Agentic Hackathon entry; one-off offline bake of a demo route, at most 10 requests)";
const MAX_CALLS = 10;
const DRY = process.argv.includes("--dry"); // say which requests a run would make, make none
const CACHE = join(ROOT, "data/demo-osrm-cache.json");
const OUT = join(ROOT, "public/data/demo/demo.json");
const MI_PER_M = 1 / 1609.344;
const r1 = (x) => Math.round(x * 10) / 10;

const readJson = (rel) => JSON.parse(readFileSync(join(ROOT, rel), "utf8"));
const route = readJson("public/data/routes/athletic-brewing-austin.json");
const routes = [route];
const cache = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : {};
const calls = [];
let last = 0;

// One OSRM GET, cached on disk by URL. Never more than MAX_CALLS per run, never faster than 1 per second.
async function osrm(path) {
  const url = `${OSRM}${path}`;
  const key = createHash("sha256").update(url).digest("hex").slice(0, 24);
  if (cache[key]) return cache[key].body;
  if (DRY) { console.log(`DRY: would request ${url.length > 140 ? url.slice(0, 140) + "…" : url}`); process.exit(0); }
  if (calls.length >= MAX_CALLS) throw new Error(`OSRM budget: ${MAX_CALLS} requests per run`);
  const wait = last + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  last = Date.now();
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/json" } });
  calls.push(`${res.status} ${url.length > 160 ? url.slice(0, 160) + "…" : url}`);
  const body = await res.json().catch(() => null);
  if (!res.ok || body?.code !== "Ok") throw new Error(`OSRM ${res.status} ${body?.code ?? ""} ${body?.message ?? ""}`);
  cache[key] = { url: url.length > 300 ? url.slice(0, 300) + "…" : url, at: new Date().toISOString(), body };
  writeFileSync(CACHE, JSON.stringify(cache));
  return body;
}
const lonlat = (cs) => cs.map(([lon, lat]) => `${(+lon).toFixed(6)},${(+lat).toFixed(6)}`).join(";");

// ---------- 1 · the road matrix: the start + every door in the pool (contact included) ----------
const profile = demoProfile(new Date());
const contact = demoContact(route.venues[DEMO_CONTACT_ID]);
if (!contact?.name) throw new Error("the demo contact is not in the Austin route file");
const pts = [[profile.start.lon, profile.start.lat]];
{
  const { buildPool } = await import("../public/lib/pool.js");
  const pool = buildPool({ routes, profile, contacts: [contact], cityName: "Austin" });
  for (const r of pool.rows) pts.push([r.lon, r.lat]);
}
if (pts.length > 100) throw new Error(`${pts.length} matrix points: split the table (OSRM demo allows 100)`);
const table = await osrm(`/table/v1/driving/${lonlat(pts)}?annotations=duration,distance`);
const m = parseMatrix(table, pts);
const matrix = { points: pts.map(([lon, lat]) => [+(+lon).toFixed(6), +(+lat).toFixed(6)]), durations: m.durations, distances: m.distances, unroutable: m.estimated?.length ?? 0 };

// ---------- 2 · the planner, three states, on those road times ----------
const now = nowStamp();
const { states, stop1, followUp, driveDoor } = await demoStates({ routes, profile, contact, fetchMatrix: bakedMatrix(matrix), now, drive: true });

// ---------- 3 · road geometry for every distinct day shown ----------
// A day already routed on its own (cached) is reused. Every other day goes into ONE route request: the days one after
// another, each from the start, with steps, so each leg's own geometry can be cut back out (the leg from one day's last
// door to the next day's start is dropped). continue_straight=false lets a leg leave a door either way, as a day on
// its own would.
const r6 = (c) => [+c[0].toFixed(6), +c[1].toFixed(6)];
function dayRoad(d, venues, legs) {
  const coords = [];
  const wayPoints = [0];
  for (const l of legs) {
    const pts = l.steps.flatMap((st) => st.geometry.coordinates).map(r6);
    for (const c of pts) if (!coords.length || c[0] !== coords.at(-1)[0] || c[1] !== coords.at(-1)[1]) coords.push(c);
    if (coords.length < 2) coords.push(coords[0]);
    wayPoints.push(coords.length - 1);
  }
  const dist = legs.reduce((x, l) => x + l.distance, 0);
  const dur = legs.reduce((x, l) => x + l.duration, 0);
  return {
    key: coordsKey(dayCoords(d, venues)), start: { lat: d.start.lat, lon: d.start.lon }, stops: d.stops.map((x) => ({ id: x.id, lat: venues[x.id].lat, lon: venues[x.id].lon })),
    geometry: { type: "LineString", coordinates: coords }, wayPoints,
    legs: legs.map((l) => ({ mi: r1(l.distance * MI_PER_M), min: r1(l.duration / 60) })),
    mi: r1(dist * MI_PER_M), min: r1(dur / 60),
    // "ors" is the app's word for real road geometry (45° follow, solid line, "road miles"); the provider is OSRM
    source: "ors", provider: "osrm", label: DEMO_ATTRIBUTION,
  };
}
const cachedBody = (path) => cache[createHash("sha256").update(`${OSRM}${path}`).digest("hex").slice(0, 24)]?.body ?? null;
const roads = new Map();
const missing = [];
for (const s of states)
  for (const d of s.plan.days) {
    if (!d.stops.length) continue;
    const cs = dayCoords(d, s.pool.venues);
    const key = coordsKey(cs);
    if (roads.has(key) || missing.some((m) => m.key === key)) continue;
    // an earlier bake's route for exactly this day (whole-geometry form, before batching)
    const old = cachedBody(`/route/v1/driving/${lonlat(cs)}?overview=full&geometries=geojson`);
    if (old) {
      const rt = old.routes[0];
      const coords = rt.geometry.coordinates.map(r6);
      const at = (w, from) => { let best = from, bd = Infinity; for (let i = from; i < coords.length; i++) { const q = (coords[i][0] - w[0]) ** 2 + (coords[i][1] - w[1]) ** 2; if (q < bd) (bd = q), (best = i); if (q === 0) break; } return best; };
      const wayPoints = [];
      for (const w of old.waypoints) wayPoints.push(at(w.location, wayPoints.at(-1) ?? 0));
      roads.set(key, { ...dayRoad(d, s.pool.venues, rt.legs.map((l) => ({ ...l, steps: [] }))), geometry: { type: "LineString", coordinates: coords }, wayPoints });
    } else missing.push({ key, d, venues: s.pool.venues, cs });
  }
if (missing.length) {
  const all = missing.flatMap((m) => m.cs);
  if (all.length > 100) throw new Error(`${all.length} waypoints in one route request: split it`);
  const b = await osrm(`/route/v1/driving/${lonlat(all)}?overview=false&steps=true&geometries=geojson&continue_straight=false`);
  let k = 0;
  for (const m of missing) {
    const n = m.cs.length - 1;
    roads.set(m.key, dayRoad(m.d, m.venues, b.routes[0].legs.slice(k, k + n)));
    k += n + 1; // skip the leg back to the next day's start
  }
}

// ---------- 4 · re-check: every stop open on arrival, inside its window, under the road legs ----------
const problems = [];
const drift = [];
for (const [k, s] of states.entries())
  for (const d of s.plan.days) {
    const road = roads.get(coordsKey(dayCoords(d, s.pool.venues)));
    if (!road) continue;
    let t = d.leave ?? d.from; // the rep leaves when the plan says (later than the window's start when a room opens late)
    d.stops.forEach((x, j) => {
      const v = s.pool.venues[x.id];
      const parsed = parseHours(v.hours);
      const arrive = t + Math.max(1, Math.ceil(road.legs[j].min));
      // the planner may wait up to WAIT_MAX_MIN for a room to open (stop.waitMin); the routed day gets the same rule
      let start = arrive;
      const ok = (m) => { const o = openMinutes(parsed, d.day, m, m + profile.visitMin); return o === null || o >= profile.visitMin; };
      while (!ok(start) && start - arrive < WAIT_MAX_MIN) start++;
      if (!ok(start) && !(k > 0 && d.frozen)) problems.push(`state ${k} ${d.day} stop ${j + 1} ${v.name}: arrives ${clock12(arrive)}, not open for ${profile.visitMin} min within a ${WAIT_MAX_MIN}-min wait`);
      // the plan's times come from the table; the routed day can run a few minutes longer (turn rules at each stop)
      if (Math.abs(start - x.eta) > 3) drift.push(`state ${k} ${d.day} stop ${j + 1} ${v.name}: plan says ${clock12(x.eta)}${x.waitMin ? ` (after a ${x.waitMin}-min wait)` : ""}, routed ${clock12(start)}${start > arrive ? ` (after a ${start - arrive}-min wait)` : ""}`);
      t = start + profile.visitMin;
    });
    if (t > d.to) problems.push(`state ${k} ${d.day}: ends ${clock12(t)}, after the window (${clock12(d.to)})`);
  }

// ---------- 5 · the hero: the best-ranked day of 5+ doors in the built plan (else the one with the most doors) ----------
const s0 = states[0];
const meanRank = (d) => {
  const ks = d.stops.map((x) => s0.pool.ids.indexOf(x.id)).filter((k) => k >= 0);
  return ks.length ? ks.reduce((a, b) => a + b, 0) / ks.length : Infinity;
};
const full = s0.plan.days.map((d, i) => [d, i]).filter(([d]) => d.stops.length >= 5);
const heroDay = full.length
  ? full.reduce((b, x) => (meanRank(x[0]) < meanRank(b[0]) ? x : b))[1]
  : s0.plan.days.reduce((b, d, i) => (d.stops.length > (s0.plan.days[b]?.stops.length ?? -1) ? i : b), 0);

const out = {
  v: 1,
  baked: new Date().toISOString().slice(0, 10),
  persona: PERSONA,
  attribution: DEMO_ATTRIBUTION,
  contact,
  known: DEMO_KNOWN,
  matrix,
  roads: [...roads.values()],
  // what the bake saw (tests compare the page's planner to this)
  states: states.map((s) => ({ days: s.plan.days.map((d) => ({ day: d.day, from: d.from, to: d.to, ids: d.stops.map((x) => x.id), etas: d.stops.map((x) => x.eta), mi: d.mi, frozen: !!d.frozen })), notes: s.plan.notes.map((n) => n.text) })),
  stop1,
  hero: { day: heroDay },
  problems,
  drift,
};
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out));

// ---------- summary ----------
const name = (id) => s0.pool.venues[id]?.name ?? id;
const rank = (id) => (s0.pool.ids.indexOf(id) >= 0 ? `#${s0.pool.ids.indexOf(id) + 1}` : id === DEMO_CONTACT_ID ? "contact" : "-");
console.log(`Demo bake ${out.baked}: ${s0.pool.label} · ${s0.pool.N} ranked · matrix ${pts.length} points (${matrix.unroutable} unroutable cells)`);
for (const [k, s] of states.entries()) {
  console.log(`\nState ${k}${k === 0 ? " · built" : k === 1 ? ` · ${name(stop1)} visited` : k === 2 ? ` · follow-up ${followUp}` : ` · drive mode: ${name(driveDoor)} back ${followUp} at 3 pm`}`);
  for (const d of s.plan.days) {
    const road = roads.get(coordsKey(dayCoords(d, s.pool.venues)));
    console.log(`  ${d.day.slice(0, 3)} ${d.date} ${clock12(d.from)}–${clock12(d.to)}${d.frozen ? " (current day)" : ""}: ${d.stops.length} doors · ${d.mi} mi planned · ${road ? `${road.mi} road mi routed` : "no road"} · ${d.stops.map((x) => `${name(x.id)} ${rank(x.id)} ${clock12(x.eta)}${x.pinned ? ` [${x.pinned}]` : ""}`).join(" → ")}`);
  }
  for (const n of s.plan.notes) console.log(`  note: ${n.text}`);
}
const far = Math.max(...out.roads.flatMap((r) => r.legs.slice(1).map((l) => l.mi)));
console.log(`\nRoads baked: ${out.roads.length} · longest leg between doors ${far} mi · hero = ${s0.plan.days[heroDay].day} (${s0.plan.days[heroDay].stops.length} doors) · showcased stop = ${name(stop1)} (Tuesday stop ${s0.plan.days[0].stops.findIndex((x) => x.id === stop1) + 1}) · contact ${name(DEMO_CONTACT_ID)} ${km(profile.start, contact).toFixed(1)} km from the start`);
if (drift.length) console.log(`\nTiming drift over 3 min, table vs routed day (${drift.length}):\n  ${drift.join("\n  ")}`);
console.log(problems.length ? `\nPROBLEMS (${problems.length}):\n  ${problems.join("\n  ")}` : "\nRe-check: every stop open on arrival (for the full visit) and inside its window under the routed legs.");
console.log(`\nOSRM requests this run: ${calls.length}${calls.length ? "\n  " + calls.join("\n  ") : " (all answers from data/demo-osrm-cache.json)"}`);
console.log(`Wrote ${OUT.replace(ROOT + "/", "")}`);
