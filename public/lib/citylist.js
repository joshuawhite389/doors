// The city field's autocomplete (owner review 7, M2): US cities of 20,000+ people from the Census (lib/us-cities.js),
// matched by prefix as the rep types, biggest first. No Qloo call and no network. The ready cities (index.cities)
// keep their keys when picked; any other pick is a live city with its centre from the list.
import { US_CITIES } from "./us-cities.js";
import { citySlug, STATE_NAMES } from "./profile.js";

// live check F: the state names moved to profile.js (the Worker checks Qloo's reading against them too)
const STATES = STATE_NAMES;

// "Cañon City" → "canon city", "St. Louis" → "st louis"; a comma stays (it splits "City, ST").
export const fold = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[.']/g, "").replace(/[^a-z0-9,]+/g, " ").replace(/ ?, ?/g, ",").trim();
// Short and long forms of a name's words, both ways: "st louis" is also "saint louis".
const SHORT = { st: "saint", ste: "sainte", ft: "fort", mt: "mount" };
const LONG = Object.fromEntries(Object.entries(SHORT).map(([a, b]) => [b, a]));
const variants = (k) => [...new Set([k, k.split(" ").map((w) => SHORT[w] ?? w).join(" "), k.split(" ").map((w) => LONG[w] ?? w).join(" ")])];

// Live check F (probed 2026-10-22, scripts/dev/city-probe.mjs): list rows Qloo misreads as typed, offered as text it
// reads right. "New York, NY" → the state (the server refuses it); "Wyoming, MI" → Wyoming, New York ("Wyoming,
// Michigan" reads right; "Springfield, MO" was read right, so it's not every two-letter state). Delaware, OH and
// Washington, UT read as their counties: the right place, kept.
export const QLOO_READS = { "New York, NY": "New York City", "Wyoming, MI": "Wyoming, Michigan" };
const near = (a, b) => Math.hypot(a[0] - b[0], (a[1] - b[1]) * Math.cos((a[0] * Math.PI) / 180)) * 111 < 40; // km, roughly
let rows = null;
let readyOf = null;
function table(ready) {
  if (rows && readyOf === ready) return rows;
  readyOf = ready;
  rows = US_CITIES.map(([name, state, lat, lon, pop]) => {
    const keys = variants(fold(name));
    const r = ready.find((c) => !c.live && Array.isArray(c.center) && fold(c.name) === fold(name) && near(c.center, [lat, lon]));
    return { name, state, label: QLOO_READS[`${name}, ${state}`] ?? `${name}, ${state}`, lat, lon, pop, keys, st: [state.toLowerCase(), STATES[state] ?? ""], ...(r ? { ready: r.key } : {}) };
  });
  return rows;
}

// fix14: "dayton ohio" / "Dayton, Ohio": a state typed in full, with or without the comma, is kept in the label as
// typed ("Dayton, Ohio"), not snapped to the code; Qloo's own readings (QLOO_READS) still win.
const FULL = Object.values(STATES).sort((a, b) => b.length - a.length);
const titled = (s) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/ Of /g, " of ");
// what was typed → [[name, state or null]]: "cincinnati oh" and "kansas city missouri" also as name + state
function tries(t) {
  const [name, st = null] = t.includes(",") ? t.split(",", 2).map((x) => x.trim()) : [t, null];
  const out = [[name, st || null]];
  if (st) return out;
  const m = /^(.+) ([a-z]{2})$/.exec(name);
  if (m) out.push([m[1], m[2]]);
  for (const s of FULL) if (name.endsWith(" " + s)) out.push([name.slice(0, -s.length - 1).trim(), s]);
  return out;
}
const asTyped = (r, s) => (s && s === r.st[1] && !QLOO_READS[`${r.name}, ${r.state}`] ? { ...r, label: `${r.name}, ${titled(s)}` } : r);

function search(q, ready) {
  const t = fold(q);
  if (!t) return [];
  const out = new Map(); // row → [tier, the state as typed]: tier 1 the exact name, 2 a prefix, 3 a word inside
  for (const r of table(ready)) {
    for (const [n, s] of tries(t)) {
      if (!n || (s && !r.st.some((x) => x.startsWith(s)))) continue;
      const tier = r.keys.includes(n) ? 1 : r.keys.some((k) => k.startsWith(n)) ? 2 : r.keys.some((k) => k.includes(" " + n)) ? 3 : 0;
      if (!tier) continue;
      if (!out.has(r) || out.get(r)[0] > tier) out.set(r, [tier, s]);
    }
  }
  return [...out].sort((a, b) => a[1][0] - b[1][0] || b[0].pop - a[0].pop).map(([r, [tier, s]]) => [asTyped(r, s), tier]);
}

// Up to `limit` cities for what is typed: the exact name first, then names that start with it,
// then names with a word that starts with it ("york" → New York), each by population. "Cin", "cincinnati, oh",
// "Cincinnati OH", "st lo" and "saint lo" all work.
export const matchCities = (q, ready = [], limit = 8) => search(q, ready).slice(0, limit).map(([r]) => r);

// A typed city that names one listed city outright ("Cincinnati, OH", "cincinnati oh", or just "Cincinnati": the
// biggest of that name), or null.
export const listedCity = (text, ready = []) => search(text, ready).find(([, tier]) => tier === 1)?.[0] ?? null;

// The profile fields for a picked city: a ready one by its key, any other as a live city with its centre.
export const cityPick = (r) => (r.ready ? { city: r.ready } : { city: citySlug(r.label), cityName: r.label, cityLive: true, cityCenter: [r.lat, r.lon] });

// Live check H: a typed city Qloo can't place ("Milwuakee") → the listed city it most likely means ("Milwaukee, WI"),
// by edit distance on the name (the state, when typed, must match), biggest first on a tie; null when nothing is close.
const edits = (a, b) => {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1] ? 0.5 : 1));
    prev = cur;
  }
  return prev[b.length];
};
export function nearestCity(text, ready = []) {
  const t = fold(text);
  if (!t) return null;
  const [name, st] = tries(t).at(-1); // "milwuakee wi", "milwuakee wisconsin": the state off the name
  const max = Math.max(1, Math.floor(name.length / 4));
  let best = null;
  for (const r of table(ready)) {
    if (st && !r.st.some((x) => x.startsWith(st))) continue;
    const d = Math.min(...r.keys.map((k) => (Math.abs(k.length - name.length) > max ? Infinity : edits(name, k)))); // cheap cut first: the Worker's CPU
    if (d <= max && (!best || d < best[1])) best = [r, d];
  }
  return best ? asTyped(best[0], st) : null;
}

// Jard 10-23 #12: the city of a room that already pours the rep, with the same smart list as the opening city: listed
// cities as typed ("cin" → Cincinnati, OH), else the one it most likely means ("Milwuakee?"), else as typed.
// → [{label, name}]: label goes in the field (and the Qloo search), name is what the option says.
export function placeCities(q, ready = [], limit = 6) {
  const t = String(q ?? "").trim();
  if (!t) return [];
  const listed = matchCities(t, ready, limit).map((r) => ({ label: r.label, name: r.label }));
  if (listed.length) return listed;
  const near = t.length >= 4 ? nearestCity(t, ready) : null;
  return [...(near ? [{ label: near.label, name: `${near.label}?` }] : []), { label: t, name: `Use “${t}”` }];
}
