// Crowds (why2, Jard 10-24 #3): a rep who names two drinks names one drinker, but each drink's Qloo list can be a
// different crowd (Heineken and Bud Light in Boise share none of their top 50 doors: Bud Light's are bars, Heineken's
// restaurants). Each door belongs to the drink whose list ranks it best; crowds() describes them for "Why these
// doors" (web ui/why.js, phone Why.tsx); leadHold() is "Start with bars": the first open day gets the doors of the
// crowd the rep picks, held there for the planner run (compute()'s hold, as running late's move), and the planner
// routes the rest around them. Pure: no DOM, no I/O.
import { rankedIds, mergeLists } from "./pool.js";
import { roomOf, ROOMS } from "./profile.js";
import { planDays, EXCLUDED_STATUSES } from "./schedule.js";

export const TOP = 50; // the head of each drink's list the crowds are told apart by
export const DISTINCT_MAX = 15; // two crowds are told apart when their top 50s share at most this many doors

// A route's crowd key: the held brand's key, a live brand's Qloo id, else its name.
export const crowdKey = (route) => String(route?.drinker?.key ?? route?.drinker?.id ?? route?.drinker?.name ?? "");

// id → index of the route whose list ranks it best (ties: the earlier route, the profile's order).
export function crowdOf(routes = [], { famous = false } = {}) {
  const best = new Map();
  routes.forEach((r, k) => rankedIds(r, { famous }).forEach((id, i) => {
    const b = best.get(id);
    if (!b || i < b.i) best.set(id, { i, k });
  }));
  return new Map([...best].map(([id, b]) => [id, b.k]));
}

// The crowds of a plan's drinks, for the screen. pool: buildPool()'s (ids = the doors the rep pitches, venues).
// → {distinct, shared, crowds:[{key, name, room, roomWord, ids}]} | null (one drink, or none)
//   shared: doors both of the first two top 50s hold; distinct: shared ≤ DISTINCT_MAX.
//   room: the room type most of this crowd's pitched doors are (ROOMS key), when every crowd has one and no two share
//   it (Bud Light's bars, Heineken's restaurants); else null on all, and the crowds go by the drink's name only;
//   roomWord: "bars", "restaurants" …
//   ids: the crowd's pitched doors, best first.
export function crowds({ routes = [], pool, famous = false } = {}) {
  if (routes.length < 2 || !pool) return null;
  const tops = routes.map((r) => new Set(rankedIds(r, { famous }).slice(0, TOP)));
  const shared = [...tops[0]].filter((id) => tops[1].has(id)).length;
  const of = crowdOf(routes, { famous });
  const list = routes.map((r, k) => {
    const ids = pool.ids.filter((id) => of.get(id) === k);
    const n = new Map();
    for (const id of ids) n.set(roomOf(pool.venues[id] ?? {}), (n.get(roomOf(pool.venues[id] ?? {})) ?? 0) + 1);
    const top = [...n].sort((a, b) => b[1] - a[1])[0];
    return { key: crowdKey(r), name: r?.drinker?.name ?? `Drink ${k + 1}`, top: top && top[1] * 2 > ids.length ? top[0] : null, ids };
  });
  const rooms = list.map((c) => c.top);
  const out = list.map((c) => {
    const room = rooms.every((x) => x && rooms.filter((y) => y === x).length === 1) ? c.top : null;
    return { key: c.key, name: c.name, room, roomWord: room ? ROOMS.find((x) => x.key === room)?.phrase ?? room : null, ids: c.ids };
  });
  return { distinct: shared <= DISTINCT_MAX, shared, crowds: out };
}

// The day holds for "Start with <crowd>" (lead: a crowdKey). The first window not past, not under way (frozen) is
// planned with that crowd's doors alone; those doors are held on that day (index null: day only) for the real run.
// Doors the rep already locked or pinned keep their own place. → [{id, date, index:null}] ([] with no lead or no day).
export function leadHold({ routes = [], pool, lead = null, windows = [], visitMin = 25, statuses = {}, frozen = null, now = null, locks = [], famous = false } = {}) {
  if (!lead || !pool) return [];
  const k = routes.findIndex((r) => crowdKey(r) === lead);
  if (k < 0) return [];
  const w = windows.find((x) => !(now && (x.date < now.date || (x.date === now.date && now.min >= x.from))) && x.date !== frozen?.date);
  if (!w) return [];
  const of = crowdOf(routes, { famous });
  const taken = new Set([...locks.map((l) => l.id), ...(pool.pinned ?? []).map((p) => p.id)]);
  const rows = pool.rows.filter((r) => of.get(r.id) === k && !taken.has(r.id) && !EXCLUDED_STATUSES.has(statuses[r.id]));
  if (!rows.length) return [];
  const p = planDays({ pool: rows, statuses, windows: [w], visitMin, now });
  return (p.days[0]?.stops ?? []).map((s) => ({ id: s.id, date: w.date, index: null }));
}

// One drinker for the Why screen (Jard 10-24 #3: "when i said my drinkers also drink heineken and bud light, i wasn't
// implying that they drink either"): the drinks' lists as one route, in the plan pool's own merged order (pool.js
// mergeLists, round-robin by rank), each door with its best Qloo score. One route: that route.
export function mergedRoute(routes = [], { famous = false } = {}) {
  if (routes.length < 2) return routes[0] ?? null;
  const m = mergeLists(routes, { famous: false });
  const row = new Map();
  for (const r of routes) for (const x of r?.lists?.all ?? []) if (!row.has(x[0]) || (x[1] ?? 0) > (row.get(x[0])[1] ?? 0)) row.set(x[0], x);
  const inAll = new Set(m.ids);
  const fam = new Map();
  for (const r of routes) for (const x of r?.lists?.famous ?? []) if (!inAll.has(x[0]) && (!fam.has(x[0]) || (x[1] ?? 0) > (fam.get(x[0])[1] ?? 0))) fam.set(x[0], x);
  const names = routes.map((r) => r?.drinker?.name).filter(Boolean);
  const dropped = routes.map((r) => r?.dropped?.all ?? { n: 0, names: [] });
  return {
    ...routes[0],
    drinker: { key: routes.map(crowdKey).join("+"), name: names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0] ?? "" },
    venues: Object.assign({}, ...routes.map((r) => r?.venues ?? {})),
    lists: { all: m.ids.map((id) => row.get(id)).filter(Boolean), famous: [...fam.values()].sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0)) },
    dropped: { all: { n: dropped.reduce((t, d) => t + (d.n ?? 0), 0), names: [...new Set(dropped.flatMap((d) => d.names ?? []))] } },
  };
}
