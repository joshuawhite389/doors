// Print the planner's two Austin profiles as tables (eyeball check for public/lib/schedule.js). No network.
// Both: Athletic Brewing drinkers · Bars + Breweries · 25 min a door.
//   default: start E Cesar Chavez (30.2556, -97.7208) · Tue 2–6 pm and Wed 2–6 pm (the profile a judge builds first)
//   demo:    the demo's (SPEC-V2 §3.6): start E Cesar Chavez · Tue 1–6, Wed 2–5, Thu 2–5 · Central District
//            Brewing already talked to (no contact here; the demo's contact is in public/data/demo/demo.json)
// Run: node scripts/plan-demo.mjs [default|demo]
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { genreLabel, legsCross } from "../public/lib/core.js";
import { planDays } from "../public/lib/schedule.js";
import { buildPool, windowsFor } from "../public/lib/pool.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const route = JSON.parse(readFileSync(join(ROOT, "public/data/routes/athletic-brewing-austin.json"), "utf8"));
const START = { lat: 30.2556, lon: -97.7208, label: "E Cesar Chavez" };
const CENTRAL = Object.entries(route.venues).find(([, v]) => v.name === "Central District Brewing")?.[0];

export const PROFILES = {
  default: { start: START, windows: [{ date: "2026-10-13", from: "14:00", to: "18:00" }, { date: "2026-10-14", from: "14:00", to: "18:00" }], known: [] },
  demo: { start: START, windows: [{ date: "2026-10-13", from: "13:00", to: "18:00" }, { date: "2026-10-14", from: "14:00", to: "17:00" }, { date: "2026-10-15", from: "14:00", to: "17:00" }], known: CENTRAL ? [CENTRAL] : [] },
};

// → {plan, pool, input} for a named profile
export function demoPlan(name) {
  const p = PROFILES[name];
  const profile = { brand: "Tidewell", what: "Non-alcoholic hazy IPA", drinks: [{ key: "athletic-brewing", name: "Athletic Brewing", ready: true }], rooms: ["bars", "breweries"], visitMin: 25, ...p };
  const pool = buildPool({ routes: [route], profile, cityName: "Austin" });
  const input = { pool: pool.rows, statuses: pool.statuses, windows: windowsFor(profile), visitMin: 25, pinned: pool.pinned };
  return { plan: planDays(input), pool, input };
}

// Crossing legs and the longest legs of a planned day (start included).
export function dayShape(d, venues) {
  const pts = [d.start, ...d.stops.map((s) => venues[s.id])];
  let cross = 0;
  for (let i = 0; i < pts.length - 1; i++) for (let j = i + 2; j < pts.length - 1; j++) if (legsCross(pts[i], pts[i + 1], pts[j], pts[j + 1])) cross++;
  const legs = d.stops.map((s) => s.legMi);
  return { cross, first: legs[0] ?? 0, longestInner: Math.max(0, ...legs.slice(1)) };
}

const clock = (m) => {
  const x = ((m % 1440) + 1440) % 1440;
  if (x === 0) return "midnight";
  const h = Math.floor(x / 60);
  return `${h % 12 || 12}:${String(x % 60).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`;
};
const pad = (s, n) => String(s).slice(0, n).padEnd(n);
const lpad = (s, n) => String(s).padStart(n);

function print(name) {
  const t0 = performance.now();
  const { plan, pool } = demoPlan(name);
  const ms = performance.now() - t0;
  const v = pool.venues;
  const st = PROFILES[name].start;
  console.log(`\n=== ${name}: ${pool.label} · ${pool.N} ranked rooms · 25 min a door · start ${st.label} ${st.lat},${st.lon}${PROFILES[name].known.length ? " · Central District Brewing already talked to" : ""}`);
  for (const d of plan.days) {
    const sh = dayShape(d, v);
    console.log(`\n${d.day[0].toUpperCase() + d.day.slice(1)} ${d.date} · ${clock(d.from)}–${clock(d.to)} · ${d.stops.length} doors · ${d.mi} mi · ${d.min} min driving · done ${clock(d.end)} (${d.source ?? "no legs"}) · crossings ${sh.cross} · first leg ${sh.first} mi · longest leg after it ${sh.longestInner} mi`);
    console.log(`  ${pad("#", 3)}${pad("Room", 30)}${pad("Genre", 18)}${lpad("Rank", 5)}  ${pad("Arrive", 9)}${pad("Hours", 26)}${lpad("Leg mi", 7)}${lpad("min", 5)}`);
    d.stops.forEach((s, i) => {
      const hours = s.orderReason ?? (s.openUntil == null ? (s.hoursVerified ? "open" : "unverified") : `till ${clock(s.openUntil)}`);
      console.log(`  ${pad(i + 1, 3)}${pad(v[s.id].name, 30)}${pad(genreLabel(v[s.id]), 18)}${lpad(pool.ids.includes(s.id) ? "#" + (pool.ids.indexOf(s.id) + 1) : "-", 5)}  ${pad(clock(s.eta), 9)}${pad(hours, 26)}${lpad(s.legMi.toFixed(1), 7)}${lpad(s.legMin, 5)}`);
    });
  }
  console.log(`\nNot scheduled: ${plan.unscheduled.length} · notes: ${plan.notes.length ? plan.notes.map((n) => n.text).join("; ") : "none"} · planned in ${ms.toFixed(0)} ms`);
  // rank: mean rank of the scheduled doors, and the top 10 open in some window (out-of-reach doors named apart)
  const on = plan.days.flatMap((d) => d.stops.map((s) => s.id));
  const rankOf = (id) => pool.ids.indexOf(id) + 1;
  const open10 = pool.ids.filter((id) => !pool.statuses[id] && !["closed", "opens-after", "closes-before", "brief", "hours"].includes(plan.reasons[id]?.code)).slice(0, 10);
  const reach = open10.filter((id) => !plan.reasons[id]?.outOfReach);
  console.log(`Rank: mean scheduled rank ${(on.reduce((a, id) => a + rankOf(id), 0) / on.length).toFixed(1)} · top-10 kept ${open10.filter((id) => on.includes(id)).length}/10 (${reach.filter((id) => on.includes(id)).length}/${reach.length} in reach)`);
  const top = pool.ids.slice(0, 25).filter((id) => plan.reasons[id]);
  for (const id of top) console.log(`  #${pool.ids.indexOf(id) + 1} ${v[id].name}: ${plan.reasons[id].text}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const which = process.argv[2] ? [process.argv[2]] : Object.keys(PROFILES);
  for (const n of which) print(n);
}
