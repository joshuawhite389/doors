// WHY-VIZ-SPEC §4.2 (Jard 10-25: "heat 'clouds' … what the neighborhood is like"): the city by neighbourhood. Every
// place Qloo ranked for the drinker is grouped under the nearest of Qloo's own neighbourhoods for this drinker (the
// locality heat map, culture/heat.json) within 3 km; a neighbourhood with ≥ 3 ranked doors is an area (a cloud on
// the map), coloured by its character: the crowd group that stands out most against the city in Qloo's crowd
// descriptions of its doors (lib/insights.js crowd(): the same counts the Who view shows). Pure: no DOM, no fetch.
import { crowd } from "../insights.js";
import { km } from "../core.js";
import { roomOf, ROOMS } from "../profile.js";

export const NEAR_KM = 3; // a door belongs to a neighbourhood within this
export const MIN_DOORS = 3; // an area needs this many ranked doors
export const MIN_NAMED = 2; // a group counts for an area when this many of its doors name it…
export const MIN_LIFT = 1.4; // …and its share is this many times the city's
export const GRID_KM = 1.5; // the last fallback: a grid with no names

// The character classes (spec §4.2): one per area, from its top classed group.
export const CLASSES = [
  { cls: "music", word: "a music scene", colour: "#8B5CF6", groups: ["music"] },
  { cls: "beer", word: "craft beer country", colour: "#1F7F58", groups: ["beer", "dogs"] },
  { cls: "work", word: "an after-work crowd", colour: "#3E6FB0", groups: ["youngpro", "cocktail", "work"] },
  { cls: "visitors", word: "visitors and students", colour: "#CF6612", groups: ["tourists", "students", "sports"] },
  { cls: "dinner", word: "dinner crowds and families", colour: "#C2457A", groups: ["families", "foodies", "couples"] }, // round 4 #9: was grey; every class gets a colour you can see
];
// round 4 #9 (Jard 10-27: "i just see barely visible gray splotches"): an area where no group stands out is still a
// cloud of your drinker's doors, drawn in its own visible colour and named in the legend
export const NO_CLASS = { cls: "none", word: "no group stands out", colour: "#1A8C8C" };
export const CLASS_OF = Object.fromEntries(CLASSES.flatMap((c) => c.groups.map((g) => [g, c.cls])));
export const classOf = (cls) => CLASSES.find((c) => c.cls === cls) ?? null;
export const cloudColour = (cls) => classOf(cls)?.colour ?? NO_CLASS.colour; // the wash, the pill, the row
const ROOM_PHRASE = Object.fromEntries(ROOMS.map((r) => [r.key, r.phrase]));
const ROOM_ONE = { bars: "bar", breweries: "brewery", restaurants: "restaurant", cafes: "café", wine: "wine bar", quick: "counter-service spot", hotel: "hotel" };
const kindWord = (k, n) => (n === 1 ? ROOM_ONE[k] ?? k : ROOM_PHRASE[k] ?? k);
const and = (xs) => (xs.length <= 1 ? xs[0] ?? "" : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// places: [{id, name, lat, lon, fate, day?, rank?, famous?}] (lib/sieve.js dots + extras; a place's venue holds its
// crowd text); venues: id → venue; hoods: [{name, lat, lon}] in Qloo's order (null → fallbacks); base: the city's
// door ids and venues (every door Doors holds for this city); poolIds: Your list; profile.rooms for the door mix.
// → {areas:[…], hoodsN, named, source: "heat" | "neighborhood" | "grid", baseN}
export function areasModel({ places = [], venues = {}, hoods = null, base = { ids: [], venues: {} }, poolIds = [], cityName = "the city" }) {
  const pts = places.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
  let source = "heat", groupsOf;
  if (hoods?.length) {
    groupsOf = (p) => {
      let bi = -1, bd = Infinity;
      hoods.forEach((h, i) => { const d = km(p, h); if (d < bd) { bd = d; bi = i; } });
      return bd <= NEAR_KM ? { key: `h${bi}`, name: hoods[bi].name, rank: bi + 1, at: hoods[bi] } : null;
    };
  } else if (pts.some((p) => venues[p.id]?.neighborhood)) {
    source = "neighborhood";
    groupsOf = (p) => { const n = venues[p.id]?.neighborhood; return n ? { key: `n:${n}`, name: n, rank: null, at: null } : null; };
  } else {
    source = "grid";
    const kmLon = 111 * Math.cos(((pts[0]?.lat ?? 30) * Math.PI) / 180);
    groupsOf = (p) => { const gx = Math.floor((p.lon * kmLon) / GRID_KM), gy = Math.floor((p.lat * 111) / GRID_KM); return { key: `g${gx},${gy}`, name: null, rank: null, at: null }; };
  }
  const by = new Map();
  for (const p of pts) {
    const g = groupsOf(p);
    if (!g) continue;
    if (!by.has(g.key)) by.set(g.key, { ...g, doors: [] });
    by.get(g.key).doors.push(p);
  }
  const pool = new Set(poolIds);
  const describedN = base.ids.filter((id) => String(base.venues?.[id]?.crowd ?? "").trim()).length; // every lift is over these
  const areas = [];
  for (const g of by.values()) {
    if (g.doors.length < MIN_DOORS) continue;
    const ids = g.doors.map((d) => d.id);
    const cr = crowd(ids, venues, { base: base.ids, baseVenues: base.venues, min: MIN_NAMED });
    const groups = cr.terms.filter((t) => t.base != null && t.base > 0 && t.share / t.base >= MIN_LIFT).map((t) => ({ key: t.key, label: t.label, n: t.ids.length, share: t.share, base: t.base, lift: t.share / t.base, cls: CLASS_OF[t.key] ?? null })).sort((a, b) => b.lift - a.lift || b.n - a.n);
    const top = groups.find((x) => x.cls) ?? null;
    const kinds = new Map();
    for (const id of ids) { const k = roomOf(venues[id] ?? {}); kinds.set(k, (kinds.get(k) ?? 0) + 1); }
    const lat = g.doors.reduce((s, d) => s + d.lat, 0) / g.doors.length, lon = g.doors.reduce((s, d) => s + d.lon, 0) / g.doors.length;
    areas.push({
      key: g.key, name: g.name, rank: g.rank, at: g.at, lat, lon, doors: g.doors, n: g.doors.length, described: cr.n,
      kinds: [...kinds].sort((a, b) => b[1] - a[1]), groups, top, cls: top?.cls ?? null,
      planN: g.doors.filter((d) => d.fate === "plan").length, listN: g.doors.filter((d) => pool.has(d.id)).length,
      radiusKm: Math.max(...g.doors.map((d) => km(d, { lat, lon }))), hull: hull(g.doors.map((d) => [d.lon, d.lat])),
    });
  }
  areas.sort((a, b) => (b.top ? 1 : 0) - (a.top ? 1 : 0) || b.n - a.n || (a.rank ?? 99) - (b.rank ?? 99));
  return { areas, hoodsN: hoods?.length ?? 0, named: areas.filter((a) => a.top).length, source, baseN: base.ids.length, describedN, cityName };
}

// The convex hull of [lon, lat] points (monotone chain); 1 or 2 points come back as they are.
export function hull(points) {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) { while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), p) <= 0) lower.pop(); lower.push(p); }
  const upper = [];
  for (const p of [...pts].reverse()) { while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), p) <= 0) upper.pop(); upper.push(p); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}
// The hull grown by `m` metres from the area's centre (the hover target: the cloud's doors + 300 m). → a closed ring.
export function hullRing(a, m = 300) {
  const kmLon = 111 * Math.cos((a.lat * Math.PI) / 180);
  const grow = (p) => { const dx = (p[0] - a.lon) * kmLon, dy = (p[1] - a.lat) * 111; const d = Math.hypot(dx, dy) || 0.001; const f = (d + m / 1000) / d; return [a.lon + (dx * f) / kmLon, a.lat + (dy * f) / 111]; };
  let ring;
  if (a.hull.length >= 3) ring = a.hull.map(grow);
  else { // a line or a point: a circle of the grown radius
    const r = (a.radiusKm || 0) + m / 1000;
    ring = Array.from({ length: 16 }, (_, i) => { const t = (i / 16) * Math.PI * 2; return [a.lon + (Math.cos(t) * r) / kmLon, a.lat + (Math.sin(t) * r) / 111]; });
  }
  return [...ring, ring[0]];
}

// ---------- words ----------
export const kindWords = (kinds) => and(kinds.slice(0, 2).map(([k, n]) => `${n} ${kindWord(k, n)}`));
export const liftWord = (g) => `${g.label.toLowerCase()} ×${g.lift.toFixed(1)} the city`;
// the row under the map: "Downtown · 19 doors, 11 bars and 6 restaurants. An after-work crowd: cocktail lovers ×4.5
// the city and tourists and visitors ×2.5 the city. 3 on your plan."
export function areaLine(a) {
  const ch = a.top ? `${cap(classOf(a.cls).word)}: ${and(a.groups.filter((g) => g.cls === a.cls).slice(0, 2).map(liftWord))}.` : "No group stands out against the city.";
  return `${plural(a.n, "door")}, ${kindWords(a.kinds)}. ${ch} ${a.planN ? `${a.planN} on your plan.` : "None on your plan."}`;
}
// the tooltip's rows: [[value, label], …]
export function areaTip(a, m) {
  const name = a.name ?? "No name for this part of town";
  return [
    [name, a.rank ? `#${a.rank} of ${m.hoodsN} on Qloo's heat map for your drinker` : m.source === "grid" ? "a 1.5 km square" : "Qloo's neighbourhood field"],
    [`${plural(a.n, "ranked door")} here`, kindWords(a.kinds)],
    ...a.groups.slice(0, 3).map((g) => [`${g.label.toLowerCase()} ${g.n} of ${a.n}`, `×${g.lift.toFixed(1)} the city`]),
    [`${a.planN} on your plan · ${a.listN} on Your list`, ""],
  ];
}
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
// the sentence (lib/whyviz/words.js convention: parts, {t} bold)
export function areasWords(m) {
  const { areas, named, cityName } = m;
  if (!areas.length) return [`No part of ${cityName} holds ${MIN_DOORS} or more of the doors Qloo ranked for your drinker, so there are no clouds to draw.`];
  const top = areas.filter((a) => a.top).slice(0, 3);
  if (!named) return [`${plural(areas.length, "part")} of ${cityName} ${areas.length === 1 ? "holds" : "hold"} ${MIN_DOORS} or more of your drinker's doors, but no crowd group there stands out against the city. The clouds show where those doors cluster. Hover a cloud for who goes out there and how many of your doors it holds.`];
  const parts = [`Qloo's crowd descriptions make `, { t: `${plural(named, "neighbourhood")} with a character of ${named === 1 ? "its" : "their"} own` }, ` out of your drinker's ${cityName}: `];
  top.forEach((a, i) => { parts.push({ t: a.name ?? "one part of town" }, ` is ${classOf(a.cls).word} (${liftWord(a.groups.find((g) => g.cls === a.cls))})`, i < top.length - 1 ? (i === top.length - 2 ? " and " : ", ") : ". "); });
  if (areas.length < 3) parts.push(`Only ${plural(areas.length, "part")} of ${cityName} ${areas.length === 1 ? "holds" : "hold"} ${MIN_DOORS} or more of your drinker's doors. `);
  parts.push(`Hover a cloud for who goes out there and how many of your doors it holds.`);
  return parts;
}
