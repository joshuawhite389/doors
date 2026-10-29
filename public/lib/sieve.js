// The sieve (owner review 3: "why these? why not these? why does this one seem like a good fit, but it's not on the
// list?"): every place Qloo scored for this drinker, and the gate that stopped it on the way to the plan. ui/sieve.js
// draws it as one unit chart: a dot per place, x = Qloo's order, size = Qloo popularity, row = where it stopped.
// Gates, in the order Doors applies them:
//   kind    Qloo ranked it, but it isn't a bar or restaurant (the precompute dropped it; Doors kept only its name)
//   famous  its Qloo popularity is above Doors' 0.9 cap (only when the famous rooms are left out)
//   room    not one of your rooms to pitch (a restaurant when you pitch bars…), or Qloo lists it as closed
//   known   you marked it: already talked to, not a fit, visited
//   open    the planner found it closed, or not open long enough, in every window you're free
//   route   open, but it doesn't fit a day: it adds more than DOOR_MIN of driving to a day's loop (K1), the days are full,
//           or a day is at its doors-a-day limit
//   plan    on a day
// Look-alikes: rooms Qloo matches to a plan room's crowd (place-to-place affinity) that this drinker's list doesn't
// rank at all: the "seems like a good fit" answer. Pure: no DOM.
import { roomOf, roomsPhrase, ROOMS, QUICK_ROOM, HOTEL_ROOM } from "./profile.js";
import { DOOR_MIN } from "./schedule.js";
import { askMiss } from "./ask.js";

export const GATES = [
  { key: "kind", ask: "A bar or restaurant?", out: "Not a bar or restaurant" },
  { key: "famous", ask: "Under the popularity cap?", out: "Among the most popular" },
  { key: "room", ask: "A door you pitch?", out: "Not a door you pitch" },
  { key: "known", ask: "New to you?", out: "You already know it" },
  { key: "open", ask: "Open while you're out?", out: "Not open when you're free" },
  { key: "route", ask: "Fits a day's route?", out: "Doesn't fit a route" },
];
export const FATES = [...GATES.map((g) => g.key), "plan"];
const OPEN_CODES = new Set(["closed", "opens-after", "closes-before", "brief", "hours", "idle-hours"]);
const ROOM_LABEL = { ...Object.fromEntries(ROOMS.map((r) => [r.key, r.label.toLowerCase()])), quick: QUICK_ROOM.label, hotel: HOTEL_ROOM.label };
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// route: one drinker's precomputed list (routes/<brand>-<city>.json); plan: the plan view's plan (days, venues,
// statuses, reasons, pool); famous: the famous rooms are in; city: cities/<city>.json (sisters, sisterVenues).
// → {dots, unscored:{n, names}, extras, lookalikes, counts:{fate: n}, N, who}
export function sieve({ route, plan, profile, famous = false, city = null }) {
  const all = route?.lists?.all ?? [];
  const inAll = new Map(all.map((r, i) => [r[0], i]));
  const famousRows = (route?.lists?.famous ?? []).filter((r) => !inAll.has(r[0]));
  const venues = { ...(route?.venues ?? {}), ...(plan?.venues ?? {}) };
  const where = whereOn(plan);

  // x: Qloo's order on this drinker's list; a famous-only room sits where its affinity would rank in that list
  const scores = all.map((r) => r[1]);
  const xOf = (score) => {
    let k = scores.findIndex((v) => v < score);
    if (k < 0) k = scores.length;
    return k;
  };

  const fateOf = (id, isFamous) => placeFate({ id, plan, profile, venues, famous, isFamous, where });

  const dot = (row, k, isFamous) => {
    const id = row[0];
    const v = venues[id] ?? {};
    return {
      id, name: v.name ?? "A place", score: row[1], rank: isFamous ? null : k + 1, x: isFamous ? xOf(row[1]) : k,
      pop: Number.isFinite(v.popularity) ? v.popularity : null, rating: Number.isFinite(v.rating) ? v.rating : null,
      lat: v.lat, lon: v.lon, crowd: v.crowd ?? null, famous: isFamous, ...fateOf(id, isFamous),
    };
  };
  const dots = [...all.map((r, k) => dot(r, k, false)), ...famousRows.map((r, k) => dot(r, k, true))];

  // on the plan but not on this list: her contact, a room she added, another drinker's room (merged lists)
  const listed = new Set(dots.map((d) => d.id));
  const extras = [...where.entries()]
    .filter(([id]) => !listed.has(id))
    .map(([id, on]) => {
      const v = venues[id] ?? {};
      return { id, name: v.name ?? "A door", lat: v.lat, lon: v.lon, fate: "plan", code: `day${on.di}`, day: on.di, reason: `${cap(on.day)}, stop ${on.n} of ${on.total} · ${v.contact ? "your contact" : v.added ? "added by you" : "from another drinker's list"}` };
    });

  // look-alikes: Qloo place-to-place affinity from a plan room, not ranked for this drinker at all
  const seen = new Map();
  for (const id of where.keys())
    for (const [sid, sc] of city?.sisters?.[id] ?? []) {
      if (listed.has(sid) || where.has(sid)) continue;
      const v = city?.sisterVenues?.[sid] ?? venues[sid];
      if (!v?.name || !Number.isFinite(v.lat)) continue;
      const prev = seen.get(sid);
      if (!prev || sc > prev.score) seen.set(sid, { id: sid, name: v.name, lat: v.lat, lon: v.lon, score: sc, like: venues[id]?.name ?? "a door on your plan", likeId: id, venue: v });
    }
  const lookalikes = [...seen.values()].sort((a, b) => b.score - a.score);

  const dropped = route?.dropped?.all ?? { n: 0, names: [] };
  const counts = Object.fromEntries(FATES.map((f) => [f, dots.filter((d) => d.fate === f).length]));
  counts.kind = dropped.n ?? 0;
  counts.plan += extras.length;
  const who = route?.kind === "pour" ? route.drinker?.who ?? "your drinker" : route?.kind === "room" ? `people who go to ${route?.drinker?.name ?? "the door you named"}` : `${route?.drinker?.name ?? "your"} drinkers`; // N3: a pour run says its own words
  return { dots, unscored: { n: dropped.n ?? 0, names: dropped.names ?? [] }, extras, lookalikes, counts, N: all.length, who, scored: all.length + famousRows.length + (dropped.n ?? 0) };
}

// Each plan stop's place: id → {di, n, day, total}.
export function whereOn(plan) {
  const where = new Map();
  (plan?.days ?? []).forEach((d, di) => d?.stops?.forEach((s, k) => where.set(s.id, { di, n: k + 1, day: d.day, total: d.stops.length })));
  return where;
}

// One place's fate: the gate that stopped it on the way to the plan, or its day → {fate, code, reason, day?}. The Why
// view's dots and Ask Doors' "plan" fact (agent-context.js) both read it, so the two never say different things.
// isFamous: it is on the uncapped famous page only; famous: the famous rooms are switched in.
export function placeFate({ id, plan, profile, venues = plan?.venues ?? {}, famous = false, isFamous = false, where = whereOn(plan) }) {
  const v = venues[id];
  const on = where.get(id);
  const rooms = profile?.rooms ?? [];
  if (isFamous && !famous && !on) return { fate: "famous", code: "famous", reason: "One of the city's most popular doors, and those are left out" }; // ease audit #6: no 0–1 numbers on Why
  if (on) return { fate: "plan", code: `day${on.di}`, reason: `${cap(on.day)}, stop ${on.n} of ${on.total}`, day: on.di };
  if (!v || v.closed || !Number.isFinite(v.lat)) return { fate: "room", code: v?.closed ? "closed" : "nowhere", reason: v?.closed ? "Qloo lists it as closed" : "Qloo has no location for it" };
  const kind = roomOf(v);
  if (!rooms.includes(kind)) return { fate: "room", code: kind, reason: `${cap(ROOM_LABEL[kind] ?? kind)}: you pitch ${roomsPhrase(rooms)}` };
  const miss = askMiss(v, profile ?? {}); // persona MUST #2: the ask filters rooms (lib/ask.js)
  if (miss) return { fate: "room", code: miss.code, reason: cap(miss.reason) };
  const st = plan?.statuses?.[id];
  const r = plan?.reasons?.[id];
  if (st || r?.code === "status") return { fate: "known", code: st ?? "marked", reason: { visited: "You visited it", talked: "You already know them", notfit: "You marked it not a fit", removed: "You removed it from your plan" }[st] ?? cap(r?.text ?? "You marked it") };
  if (r && OPEN_CODES.has(r.code)) return { fate: "open", code: r.code, reason: cap(r.text) };
  return { fate: "route", code: r?.code ?? "lower", reason: r?.text ? cap(r.text) : "Lower on the list than the doors that filled your days" };
}

// The Why view card's gate line, its head apart (the card bolds it): {head: "Stopped at “Fits a day's route?”:" |
// "On your plan:", reason}. A look-alike has none (null).
export function gateLine(d) {
  if (!d || d.like) return null;
  if (d.fate === "plan") return { head: "On your plan:", reason: d.reason };
  const g = GATES.find((x) => x.key === d.fate);
  return g ? { head: `Stopped at “${g.ask}”:`, reason: d.reason } : null;
}

// The sentence for one place: where it stopped and why (the search box and a clicked dot).
export function verdict(d, s) {
  if (!d) return "";
  if (d.like) return `Qloo matches its crowd to ${d.like} (place-to-place affinity ${d.score.toFixed(3)}), but doesn't rank it for ${s.who}: Doors never saw it as a candidate.`;
  if (d.unscored) return `Qloo ranked it for ${s.who}, but it isn't a bar or restaurant, so Doors set it aside.`;
  const head = d.rank ? `#${d.rank} of ${s.N} for ${s.who}` : d.famous ? `One of the most popular doors: on the list for ${s.who} with the popularity cap off` : "Not on this drinker's list";
  const gate = GATES.find((g) => g.key === d.fate);
  return d.fate === "plan" ? `${head}. On your plan: ${d.reason}.` : `${head}. Stopped at “${gate.ask}”: ${lower(d.reason)}.`;
}

const lower = (t) => (t && !/^[A-Z][A-Z']|^Qloo|^You\b/.test(t) ? t[0].toLowerCase() + t.slice(1) : t);
const fmt = (x) => (Number.isFinite(x) ? x.toFixed(2) : "unknown");

// ---------- the explorer (owner review 3, H2): a row of the finished sieve, its places and why they stopped ----------
// Rows, top to bottom: the six gates, the plan, the look-alikes. ROWS[k].key is a fate, or "look".
export const ROWS = [...GATES.map((g) => ({ key: g.key, ask: g.ask, out: g.out })), { key: "plan", ask: "Your plan", out: "On a day" }, { key: "look", ask: "Look-alikes", out: "Same crowd, not on the list" }];
export const rowIndex = (d) => (d?.like ? 7 : d?.fate === "plan" ? 6 : GATES.findIndex((g) => g.key === d?.fate));

// The places in a row, in the chart's order: Qloo's order (a famous room where its affinity would rank; the plan's
// contacts and added rooms last), the look-alikes most alike first. The "kind" row has names only: {name, unscored}.
export function rowPlaces(sv, k) {
  const key = ROWS[k]?.key;
  if (!key) return [];
  if (key === "look") return sv.lookalikes;
  if (key === "kind") return sv.unscored.names.map((name) => ({ name, unscored: true, fate: "kind", code: "kind" }));
  const ds = sv.dots.filter((d) => d.fate === key).sort((a, b) => a.x - b.x || (a.famous ? 1 : 0) - (b.famous ? 1 : 0));
  return key === "plan" ? [...ds, ...sv.extras] : ds;
}

// Every place on the map, in Qloo's order: the ranked and famous rooms, the plan's extras, then the look-alikes.
export const mapPlaces = (sv) => [...[...sv.dots].sort((a, b) => a.x - b.x || (a.famous ? 1 : 0) - (b.famous ? 1 : 0)), ...sv.extras, ...sv.lookalikes].filter((d) => Number.isFinite(d.lat) && Number.isFinite(d.lon));

// A row's places by sub-reason, the biggest group first: "Open while you're out?" → closed that day 6, opens after
// your window 5…; "Fits a day's route?" → its codes; the plan → its days; the look-alikes → the plan room each is like.
// → [{code, label, n, ids, names}] (ids for places on the map or in the chart; names for the names-only row).
const CODE_LABEL = {
  kind: "Not a bar or restaurant (names only)",
  famous: "Qloo popularity above 0.9",
  "soft-only": "Soft drinks only on Qloo's drinks tags",
  "no-taps": "No taps for your keg or draft ask",
  closed: "Closed on the days you're out",
  "opens-after": "Opens after your window",
  "closes-before": "Closes before your window",
  brief: "Open too briefly in your window",
  hours: "Hours miss your windows",
  "idle-hours": "Would mean waiting for it to open",
  idle: "Would leave you waiting between stops",
  far: "Too far from that day's area",
  detour: `Adds more than ${DOOR_MIN} min of driving to a day`,
  cap: "Your days are at their doors-a-day limit",
  nearer: "Fits only in place of a stop nearer the route",
  better: "Fits only in place of a better-ranked stop",
  kept: "Fits only in place of a stop the day kept",
  route: "Doesn't fit the day's route",
  full: "The days are full",
  "hours-clash": "Its hours clash with the day's order",
  lower: "Lower on the list than the doors that filled your days",
  visited: "You visited it",
  talked: "Already know them",
  notfit: "Marked not a fit",
  removed: "Removed from your plan",
  marked: "You marked it",
  nowhere: "Qloo has no location for it",
};
export function codeLabel(code, { days = [], rooms = [] } = {}) {
  if (CODE_LABEL[code]) return CODE_LABEL[code];
  const day = /^day(\d+)$/.exec(code ?? "");
  if (day) return days[+day[1]] ?? `Day ${+day[1] + 1}`;
  const room = ROOMS.find((r) => r.key === code);
  if (room) return `${room.label}: not a door you pitch${rooms.length ? ` (${roomsPhrase(rooms)})` : ""}`;
  return code ? cap(String(code).replace(/-/g, " ")) : "Other";
}
export function breakdown(sv, k, { days = [], rooms = [] } = {}) {
  const places = rowPlaces(sv, k);
  const groups = new Map();
  for (const d of places) {
    const code = ROWS[k].key === "look" ? `like:${d.likeId}` : d.code ?? "other";
    if (!groups.has(code)) groups.set(code, { code, label: ROWS[k].key === "look" ? `Like ${d.like}` : codeLabel(code, { days, rooms }), ids: [], names: [] });
    const g = groups.get(code);
    if (d.id) g.ids.push(d.id);
    else g.names.push(d.name);
  }
  const out = [...groups.values()].map((g) => ({ ...g, n: g.ids.length + g.names.length }));
  // the plan's days keep their order; everything else, biggest first
  return ROWS[k].key === "plan" ? out.sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true })) : out.sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
}
