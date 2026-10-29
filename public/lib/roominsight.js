// G5 · everything Qloo says about one room for this plan (owner review 2, ask 1): where it ranks for the drinker(s),
// in each age band, in the famous rooms and for the city's other ready brands' drinkers; its popularity and rating;
// Qloo's crowd / room / description text; its crowd's music (only when the sound guard passed); its sister rooms,
// each with why it is or isn't on the route; and the steps that put this room where it is. Pure: no DOM, no fetch.
// The deep-dive (ui/room.js) and the stop's sister rooms read it. Covered by test/roominsight.test.mjs.
//
// Route list rows are [id, affinity, audience growth, explainability] (src/assemble.js `row`): Qloo's
// `query.affinity` (4 dp), `query.measurements.audience_growth` (3 dp; Qloo leaves its meaning undocumented, PROBES),
// and `query.explainability` per signal entity, kept only when the signal had 2+ entities (the proxy sets), so it is
// null on every brand and venue list.
import { genreLabel, priceLabel, formatDayHours, parseHours } from "./core.js";
import { roomOf, roomsPhrase, clock12, QUICK_ROOM, HOTEL_ROOM } from "./profile.js";
import { onPlan, pitchOf, isMerged, routeWho } from "./stopmodel.js";
import { restReason } from "./planview.js";
import { askMiss } from "./ask.js";

// The age re-ranks in the precompute (scripts/config.mjs `ages`; 21–24 is Qloo's "24 and younger" band).
export const AGE_BANDS = [
  { key: "under_25", label: "21–24" },
  { key: "25_34", label: "25–34" },
  { key: "35_44", label: "35–44" },
  { key: "45_54", label: "45–54" },
  { key: "55_plus", label: "55 and over" },
];

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : "");
const A_ROOM = { bars: "a bar", breweries: "a brewery", restaurants: "a restaurant", cafes: "a café", wine: "a wine bar", quick: QUICK_ROOM.a, hotel: HOTEL_ROOM.a };
const ROOMS_PL = { bars: "bars", breweries: "breweries", restaurants: "restaurants", cafes: "cafés", wine: "wine bars", quick: QUICK_ROOM.label, hotel: HOTEL_ROOM.label };
const STATUS_WORDS = { visited: "visited", talked: "already known", notfit: "not a fit" };

// Where `id` sits in one list of a route: {rank, of, affinity, growth}, {rank: null, of} when the list doesn't hold
// it, or null when the route has no such list (an age band Doors didn't fetch for this brand).
export function listRank(route, key, id) {
  const list = route?.lists?.[key];
  if (!Array.isArray(list)) return null;
  const k = list.findIndex((r) => r[0] === id);
  if (k < 0) return { rank: null, of: list.length };
  const row = list[k];
  return { rank: k + 1, of: list.length, affinity: typeof row[1] === "number" ? row[1] : null, growth: typeof row[2] === "number" ? row[2] : null };
}

// A rank as a 0–1 bar: #1 fills it, the last place in the list is a sliver, not in the list is empty.
export const rankBar = (r) => (r?.rank ? Math.max(0.04, 1 - (r.rank - 1) / Math.max(1, r.of)) : 0);

// Where the room ranks when Qloo narrows the drinkers to one age band. ages: [{key, label, rank, of, affinity}];
// the bands Doors didn't fetch are left out.
export function agesOf(route, id) {
  return AGE_BANDS.map((b) => {
    const r = listRank(route, b.key, id);
    return r ? { ...b, ...r } : null;
  }).filter(Boolean);
}

// "Ranks highest with 25–34 drinkers (#3 of 38)": the band where the room sits highest, by place in the list, and the
// one where it sits lowest. null when fewer than two bands or the room is in none of them.
export function skewOf(ages) {
  if ((ages ?? []).length < 2) return null;
  const pos = (a) => (a.rank ? (a.rank - 1) / Math.max(1, a.of) : 2);
  const sorted = [...ages].sort((a, b) => pos(a) - pos(b));
  const best = sorted[0];
  const worst = sorted.at(-1);
  if (!best.rank) return { best: null, worst: null, text: "Not in any age band's list: its match is with the drinkers as a whole." };
  if (pos(best) === pos(worst)) return { best, worst: null, text: `Ranks the same in every age band (#${best.rank}).` };
  const out = ages.filter((a) => !a.rank);
  const or = (n) => (n.length <= 1 ? n[0] ?? "" : `${n.slice(0, -1).join(", ")} or ${n.at(-1)}`);
  const low = out.length ? `not in the ${or(out.map((a) => a.label))} list${out.length > 1 ? "s" : ""}` : `lowest with ${worst.label} (#${worst.rank} of ${worst.of})`;
  return { best, worst, text: `Ranks highest with ${best.label} drinkers (#${best.rank} of ${best.of}); ${low}.` };
}

// The plan's drinker route(s) as rows: the Qloo rank in the main list (of the food-and-drink rooms kept), the famous
// list, the age bands, and how many places Qloo ranked before Doors' food-and-drink filter.
export function drinkersOf(routes, id) {
  return (routes ?? []).map((r) => {
    const all = listRank(r, "all", id);
    const ages = agesOf(r, id);
    return {
      key: r.drinker?.key ?? null,
      name: r.drinker?.name ?? "this drinker",
      category: r.drinker?.category ?? null,
      kind: r.kind ?? "brand",
      who: routeWho(r),
      items: r.kind === "pour" ? r.drinker?.items ?? [] : null,
      all,
      famous: listRank(r, "famous", id),
      ages,
      skew: skewOf(ages),
      ranked: (r.lists?.all?.length ?? 0) + (r.dropped?.all?.n ?? 0),
      dropped: r.dropped?.all ?? { n: 0, names: [] },
      captured: r.captured ?? null,
      popularityMax: r.filter?.popularityMax ?? null,
    };
  });
}

// The other ready brands in the plan's city (index.brands), as route file keys to load: never the plan's own drinkers.
export function otherBrandFiles(index, plan) {
  const own = new Set((plan?.profile?.drinks ?? []).map((d) => d.key));
  const city = plan?.city?.key;
  const files = new Set(index?.files ?? []);
  return (index?.brands ?? []).filter((b) => !own.has(b.key) && files.has(`${b.key}-${city}`)).map((b) => ({ key: b.key, name: b.name, category: b.category, file: `${b.key}-${city}` }));
}

// "How other brands' drinkers rank this room": [{key, name, category, rank, of, affinity}], best rank first, the
// brands whose top list doesn't hold it last.
export function othersOf(otherRoutes, id) {
  return (otherRoutes ?? [])
    .map((r) => ({ key: r.drinker?.key ?? null, name: r.drinker?.name ?? "?", category: r.drinker?.category ?? null, ...listRank(r, "all", id) }))
    .filter((x) => x.of != null)
    .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || a.name.localeCompare(b.name));
}

// The room's crowd music (Qloo artist affinity with the room as the signal), only when the sound guard passed: the
// top artists with their genres, and the genres most of them share. Held back: the guard's reason, no names.
const SKIP_GENRE = /^(all|usa|us|united_states|america|seen_live|favorites|favourite|beautiful|chill|love|mellow|male_vocalists|female_vocalists|\d0s)$/;
const genreText = (g) => g.replace(/_/g, " ");
export function musicOf(city, id, { take = 8 } = {}) {
  const s = city?.sounds?.[id];
  if (!s) return { state: "none", artists: [], genres: [], detail: "Qloo hasn't been asked for this crowd's music yet." };
  if (!s.guard?.pass) return { state: "held", artists: [], genres: [], reason: s.guard?.reason ?? null, detail: s.guard?.detail ?? "it failed Doors' checks" };
  const top = (s.artists ?? []).slice(0, take);
  const count = new Map();
  for (const a of (s.artists ?? []).slice(0, 10)) for (const g of new Set(a.genres ?? [])) if (!SKIP_GENRE.test(g)) count.set(g, (count.get(g) ?? 0) + 1);
  const genres = [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 6).map(([g, n]) => ({ name: genreText(g), n }));
  return {
    state: "shown",
    artists: top.map((a) => ({ id: a.id, name: a.name, genres: (a.genres ?? []).filter((g) => !SKIP_GENRE.test(g)).slice(0, 3).map(genreText) })),
    genres,
    detail: s.guard.detail,
  };
}

// The first drinker route holding `id` in `key`: {route, rank, of}.
function firstIn(routes, key, id) {
  for (const r of routes ?? []) {
    const x = listRank(r, key, id);
    if (x?.rank) return { route: r, ...x };
  }
  return null;
}

// Why a room is or isn't on the route, in one line, for a sister room or the room itself:
// kind "on" (On Wednesday · stop 2), "ranked" (on the plan's ranked list, not scheduled: the planner's reason),
// "marked" (the rep marked it), "filtered" (Qloo ranked it for the drinker; outside the rooms to pitch or closed),
// "famous" (only in the famous rooms, which are off), "unranked" (not in the drinker's ranked list).
export function routeStatus(plan, id, routes = []) {
  const drinker = plan?.pool?.drinker ?? "your drinker";
  const on = onPlan(plan, id);
  if (on) return { kind: "on", dayIndex: on.dayIndex, n: on.n, text: `On ${cap(on.day)} · stop ${on.n}` };
  const st = plan?.statuses?.[id];
  if (st) return { kind: "marked", text: `You marked it ${STATUS_WORDS[st] ?? st}: left out of the plan` };
  const k = plan?.pool?.ids?.indexOf(id) ?? -1;
  if (k >= 0) {
    const why = restReason(plan, id);
    return { kind: "ranked", rank: k + 1, text: `#${k + 1} of ${plan.pool.N} on Your list, not on a day${why ? `: ${why}` : ""}` };
  }
  const v = plan?.venues?.[id];
  const q = firstIn(routes, "all", id);
  if (q) {
    const who = `${q.route.drinker?.name ?? "the"} drinkers`;
    const rooms = plan?.profile?.rooms ?? [];
    // Jard 10-24: Qloo's raw place ("#5") counts doors Your list leaves out, so a door off Your list shows no number
    if (v?.closed) return { kind: "filtered", text: `Qloo ranks it for ${who}, but it's listed as closed` };
    const type = v ? roomOf(v) : null;
    // intuitiveness audit #3: the reason in plain words ("A restaurant: you don't pitch restaurants"), no rank jargon
    if (type && !rooms.includes(type)) return { kind: "filtered", text: A_ROOM[type] ? `${cap(A_ROOM[type])}: you don't pitch ${ROOMS_PL[type]}` : "Outside your door types" };
    const miss = v ? askMiss(v, plan?.profile ?? {}) : null; // persona MUST #2: the ask filters rooms (lib/ask.js)
    if (miss) return { kind: "filtered", text: `Qloo ranks it for ${who}; left out: ${miss.reason}` };
    return { kind: "filtered", text: `Qloo ranks it for ${who}, but it isn't on Your list` };
  }
  const f = firstIn(routes, "famous", id);
  if (f) return { kind: "famous", text: "Very popular: left out unless you include the most popular doors" };
  return { kind: "unranked", text: `Not in the ranked list for ${drinker}` };
}

// The venue record to add a room with (S.addDoor): the plan's record, else the city file's sister record.
export function venueRecord(plan, city, id) {
  const v = plan?.venues?.[id] ?? city?.sisterVenues?.[id] ?? null;
  return v && Number.isFinite(v.lat) && Number.isFinite(v.lon) ? { ...v, id } : null;
}

// Sister rooms: rooms whose regulars Qloo matches to this room's (place-to-place affinity, the room as the signal),
// each with its status on this plan. addable: not on a day, not marked, and a record with a location.
export function sistersOf(plan, city, id, routes = [], { take = Infinity } = {}) {
  return (city?.sisters?.[id] ?? [])
    .map((r) => (Array.isArray(r) ? { id: r[0], score: typeof r[1] === "number" ? r[1] : null } : { id: r, score: null }))
    .map((s) => {
      const v = plan?.venues?.[s.id] ?? city?.sisterVenues?.[s.id] ?? null;
      if (!v?.name) return null;
      let status = routeStatus(plan, s.id, routes);
      if (status.kind === "unranked") status = { ...status, text: `${status.text}: a similar crowd to this door` };
      const venue = venueRecord(plan, city, s.id);
      return { ...s, name: v.name, genre: cap(genreLabel(v)), status, venue, addable: !!venue && !["on", "marked"].includes(status.kind) };
    })
    .filter(Boolean)
    .slice(0, take);
}

// The door card's one sister row (intuitiveness audit #3): "3 on your route · All 18", and the sister page's order:
// the ones on your route first, then the ones you can add, each group in Qloo's order.
export function sisterSummary(sisters) {
  const n = sisters?.length ?? 0;
  const on = (sisters ?? []).filter((s) => s.status?.kind === "on").length;
  return { n, on, sub: `${on ? `${on} on your route` : "None on your route"} · All ${n}` };
}
export function sisterOrder(sisters) {
  const rank = (s) => (s.status?.kind === "on" ? 0 : s.addable ? 1 : 2);
  return (sisters ?? []).map((s, i) => [s, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([s]) => s);
}

// The sisters by status, for the deep-dive's tally bar: [{kind, label, n}] in a fixed order, empty kinds left out.
export const SISTER_KINDS = [
  { kind: "on", label: "on your route" },
  { kind: "ranked", label: "ranked for your drinkers, not scheduled" },
  { kind: "filtered", label: "ranked, outside your door types" },
  { kind: "famous", label: "most popular doors, left out", one: "most popular door, left out" },
  { kind: "marked", label: "marked by you" },
  { kind: "unranked", label: "not ranked for your drinkers" },
];
export function sisterTally(sisters) {
  return SISTER_KINDS.map(({ one, ...k }) => {
    const n = (sisters ?? []).filter((s) => s.status?.kind === k.kind).length;
    return { ...k, n, label: n === 1 && one ? one : k.label };
  }).filter((k) => k.n);
}

const listOf = (n) => (n.length <= 1 ? n[0] ?? "" : `${n.slice(0, -1).join(", ")} and ${n.at(-1)}`);

// The steps that put this room where it is: Qloo's match, Doors' food-and-drink filter, the rooms to pitch, the route.
export function howChosen(plan, id, routes = [], drinkers = drinkersOf(routes, id)) {
  const city = plan?.city?.name ?? "the city";
  const v = plan?.venues?.[id] ?? {};
  const merged = isMerged(plan?.profile);
  const steps = [];
  for (const d of drinkers) {
    const at = d.all?.rank ? `This door: #${d.all.rank}.` /* round 3: no affinity decimal (Jard 10-23) */ : d.famous?.rank ? `This door is in the most popular doors list (#${d.famous.rank}), not the main one.` : "This door is not in that list.";
    const who = d.who ?? `${d.name} drinkers`;
    const signal = d.items?.length ? `${listOf(d.items.map((x) => x.name))} as the signals, weighed alike (${d.items.some((x) => x.type !== "place") ? "doors and brands blended" : "place-to-place affinity, from any city"})` : d.kind === "room" ? `${d.name} as the signal (place-to-place affinity)` : `${d.name} as the signal (brand-to-place affinity)`;
    steps.push({ key: "qloo", label: "Qloo's affinity", text: `Qloo ranked ${d.ranked} ${city} places for ${who}, with ${signal}, bar and restaurant tags${d.popularityMax ? ", the city's most popular doors left out" : ""}. ${at}` });
    if (d.dropped.n) steps.push({ key: "fnb", label: "Bars and restaurants only", text: `Doors set aside ${d.dropped.n} that aren't bars or restaurants${d.dropped.names?.length ? ` (${d.dropped.names.slice(0, 3).join(", ")}…)` : ""}, leaving ${d.all?.of ?? 0} in Qloo's order.` });
  }
  const k = plan?.pool?.ids?.indexOf(id) ?? -1;
  const rooms = roomsPhrase(plan?.profile?.rooms ?? []);
  const type = roomOf(v);
  const mergedText = merged ? ` The ${drinkers.length} lists are merged by taking each one's next door in turn, so the order is Doors', built from Qloo's ranks.` : "";
  steps.push({
    key: "rooms",
    label: "Your door types",
    text: k >= 0
      ? `Kept ${rooms}: ${plan.pool.N} doors. This one is #${k + 1}.${mergedText}`
      : v.contact ? "You added this door yourself: it isn't from the ranked list."
      : !drinkers.some((d) => d.all?.rank) ? `Kept ${rooms} from the ranked list; this door isn't on it.`
      : v.closed ? `Kept ${rooms} that are open; this door is listed as closed.`
      : (plan?.profile?.rooms ?? []).includes(type) && askMiss(v, plan.profile) ? `Kept ${rooms} that fit your ask: this door is left out (${askMiss(v, plan.profile).reason}).`
      : `Kept ${rooms}: this door is ${A_ROOM[type] ?? "another door type"}, so it isn't on your list.`,
  });
  const st = routeStatus(plan, id, routes);
  let route = st.text;
  if (st.kind === "on") {
    const d = plan.days[st.dayIndex];
    const s = d.stops[st.n - 1];
    const hours = s.hoursVerified ? formatDayHours(parseHours(v.hours), d.day) : null;
    const leg = Number.isFinite(s.legMi) ? `${s.legMi.toFixed(1)} ${s.source === "ors" ? "road mi" : "mi (estimated)"} from ${st.n === 1 ? "your start" : "the stop before"}` : null;
    route = `${st.text}: ${s.openAtArrival === false ? "early for its opening" : "open when you arrive"} (${clock12(s.eta)}${hours ? `, ${hours}` : ", hours unverified"})${leg ? `, ${leg}` : ""}, inside your time that day.`;
  }
  steps.push({ key: "route", label: "The route", text: route.endsWith(".") ? route : `${route}.` });
  return steps;
}

// Everything at once. routes = the plan's drinker routes; others = the city's other ready brands' routes (optional:
// loaded lazily, [] until then).
export function roomInsight({ plan, id, city = null, routes = [], others = [] }) {
  const v = plan?.venues?.[id] ?? city?.sisterVenues?.[id] ?? { id, name: id };
  const drinkers = drinkersOf(routes, id);
  const pitch = pitchOf(v, city);
  const k = plan?.pool?.ids?.indexOf(id) ?? -1;
  const lines = [
    v.crowd ? { label: "Crowd", text: v.crowd, source: "customer_demographics_description" } : null,
    v.ambience ? { label: "Room", text: v.ambience, source: "ambience_description" } : null,
    v.description ? { label: "About", text: v.description, source: "description" } : null,
  ].filter(Boolean);
  const othersRows = othersOf(others, id);
  const sisters = sistersOf(plan, city, id, routes);
  return {
    id,
    venue: v,
    name: v.name,
    meta: [cap(genreLabel(v)), priceLabel(v.price), v.neighborhood].filter(Boolean),
    rank: k >= 0 ? k + 1 : null,
    N: plan?.pool?.N ?? null,
    merged: isMerged(plan?.profile),
    drinker: plan?.pool?.drinker ?? "your drinker",
    drinkers,
    others: othersRows,
    othersIn: othersRows.filter((x) => x.rank).length,
    popularity: typeof v.popularity === "number" ? v.popularity : null,
    famousRoom: typeof v.popularity === "number" && drinkers.some((d) => d.popularityMax && v.popularity > d.popularityMax),
    rating: typeof v.rating === "number" ? v.rating : null,
    // Qloo's own words about the room, and the condensed lines a stop shows (model-drafted or template)
    lines,
    pitch: { by: pitch.by ?? "template", model: pitch.model ?? null, lines: (pitch.lines ?? []).filter((l) => /crowd|room/i.test(l.label ?? "")) },
    facts: {
      liveMusic: v.liveMusic === true ? true : v.liveMusic === false ? false : null,
      goodFor: Array.isArray(v.goodFor) ? v.goodFor : [],
      dishes: Array.isArray(v.dishes) ? v.dishes : [],
      website: v.website ?? null,
      menu: v.menu ?? null,
    },
    music: musicOf(city, id),
    sisters,
    sisterTally: sisterTally(sisters),
    status: routeStatus(plan, id, routes),
    steps: howChosen(plan, id, routes, drinkers),
  };
}
