// WHY-VIZ-SPEC §4.7 The door portrait (Why this door, above What to say): the same pictures, small, for one door.
// Every value is a Qloo field on this place or a Doors count over the city: its place on Your list and among the
// city's best-known; its hours on the plan's day and Qloo's time-of-day tags; the crowd groups Qloo names here, rarest
// in the city first, against the share of all the city's doors that name them; its rank on each age band's page; the
// doors that share its crowd with their status; what it pours and the room's tags. Pure: no DOM.
//
// portraitModel({id, venue, plan, sv, routes, profile, base, city, famous, cityName}) → see the object at the end
import { genreLabel } from "../core.js";
import { clock12 } from "../profile.js";
import { agesOf } from "../roominsight.js";
import { whereOn } from "../sieve.js";
import { and, ordinal, cap } from "./words.js";
import { cityShares, rarityChips, RARE_MAX, MOST_MIN } from "./lift.js";
export { cityShares, RARE_MAX, MOST_MIN };
import { ringModel } from "./ring.js";

export const TOD_BINS = ["Morning", "Midday", "Afternoon", "Evening", "Late night"];

const parseT = (t) => { const m = /T(\d\d):(\d\d)/.exec(t ?? ""); return m ? +m[1] * 60 + +m[2] : null; };
const short = (min) => clock12(min).replace(":00", "");
// a door's hours on a weekday ("tuesday") → {open: bool, text: "11 am–9 pm" | null}
export function hoursOn(venue, dayName) {
  const rows = venue?.hours?.[dayName];
  if (!Array.isArray(rows) || !rows.length) return { open: null, text: null };
  const spans = rows.filter((r) => !r.closed && r.opens && r.closes).map((r) => [parseT(r.opens), parseT(r.closes)]).filter(([a, b]) => a != null && b != null);
  if (!spans.length) return { open: false, text: null };
  return { open: true, text: spans.map(([a, b]) => `${short(a)}–${short(b)}`).join(", ") };
}

// lift: lib/whyviz/lift.js liftModel over the plan (picture 3): a group it marks strong (≥ 1.5× the city) is a rare chip,
// a muted one a grey chip; a group the plan's rows don't hold falls back to the city share alone (≤ RARE_MAX is rare):
// lift.js rarityChips, shared with the stop card (§6).
export function portraitModel({ id, venue = {}, plan, sv, routes = [], profile = {}, base = null, city = null, famous = false, cityName = null, lift = null }) {
  const v = venue;
  const cityWord = cityName ?? plan?.city?.name ?? "the city";
  const listIds = plan?.pool?.ids ?? [];
  const where = whereOn(plan);
  const on = where.get(id) ?? null;
  const dayIdx = on?.di ?? (plan?.days ?? []).findIndex((d) => d && !d.past && d.stops?.length);
  const day = plan?.days?.[dayIdx] ?? plan?.days?.[0] ?? null;
  const dot = sv?.dots?.find((d) => d.id === id) ?? null;
  const listRank = listIds.indexOf(id) + 1 || null;
  const listPop = listIds.map((x) => ({ id: x, pop: (sv?.venues ?? plan?.venues ?? {})[x]?.popularity ?? plan?.venues?.[x]?.popularity ?? null })).filter((x) => Number.isFinite(x.pop)).sort((a, b) => b.pop - a.pop);
  const popRank = listRank ? listPop.findIndex((x) => x.id === id) + 1 || null : null;
  const isBig = !!dot?.famous;
  const fateWord = dot ? ({ plan: null, famous: famous ? "One of the most popular doors, included." : "One of the most popular doors, left for later.", room: dot.code === "closed" ? "Qloo lists it as closed." : "Not a door type you pitch.", known: "You already know it.", open: "On Your list; closed when you're out.", route: "On Your list; didn't fit a day's route.", kind: "Not a bar or restaurant." })[dot.fate] ?? null : "Not on your drinker's list.";
  // match: the small picture 1, this door ringed
  const match = { listRank, listN: listIds.length, popRank, famous: isBig, line: listRank ? `#${listRank} of ${listIds.length} for your drinker${popRank ? `, ${ordinal(popRank)} most popular on the list` : ""}.` : isBig ? `Among the most popular doors in ${cityWord}, past Doors' line.` : fateWord ?? `Not on Your list.` };
  // when: its hours on the plan's day, Qloo's time-of-day tags
  const dayName = day?.day ?? null;
  const h = dayName ? hoursOn(v, dayName) : { open: null, text: null };
  const tod = (v.tags?.tod ?? []).filter((t) => TOD_BINS.includes(t));
  // picture 4 for this door alone: the ring model over its day, its arc kept (lib/whyviz/ring.js)
  let ring = null;
  try { const rm = day ? ringModel({ plan, dayIndex: dayIdx, venues: { ...(plan?.venues ?? {}), [id]: v } }) : null; if (rm?.day) ring = { ...rm, arcs: rm.arcs.filter((a) => a.id === id), list: rm.list.filter((a) => a.id === id) }; } catch { ring = null; }
  const when = { dayName, dayIdx: day ? dayIdx : null, hours: h.text, open: h.open, tod, window: day ? `${short(day.from)}–${short(day.to)}` : null, ring,
    line: [h.open ? `Open ${h.text} ${cap(dayName)}.` : h.open === false ? `Closed ${cap(dayName)}.` : dayName ? `Qloo has no hours for ${cap(dayName)}.` : "", tod.length ? `Qloo tags it ${and(tod.map((x) => x.toLowerCase()))}.` : "Qloo has no time-of-day tags for it."].filter(Boolean).join(" ") };
  // who: the groups named here, rarest in the city first
  const sh = cityShares(base);
  const chips = rarityChips({ venue: v, base, lift, cityName: cityWord }); // lib/whyviz/lift.js: the stop card's chips are the same
  const who = { chips, quote: v.crowd ?? null, baseN: sh.n, line: chips.some((c) => c.rare) ? `Say the rare ones.` : chips.length ? `Nothing here is rare in ${cityWord}.` : `Qloo has no crowd description for it.` };
  // by age: its rank on each band's page (every band the data has)
  const ages = agesOf(routes[0] ?? null, id).filter((a) => a.of).map((a) => ({ key: a.key, label: a.label, rank: a.rank ?? null, of: a.of }));
  // the doors that share its crowd (Qloo's place-to-place affinity), each with its status
  const sisterIds = (city?.sisters?.[id] ?? []).map((r) => (Array.isArray(r) ? r[0] : r));
  const planIds = new Set(where.keys());
  const sisters = sisterIds.map((sid) => {
    const sv0 = plan?.venues?.[sid] ?? sv?.venues?.[sid] ?? city?.sisterVenues?.[sid] ?? null;
    if (!sv0?.name) return null;
    const sd = sv?.dots?.find((d) => d.id === sid);
    const rank = listIds.indexOf(sid) + 1 || null;
    const k = planIds.has(sid) ? "plan" : sd?.famous && !famous ? "big" : rank ? "list" : sd ? "out" : "none";
    const stop = where.get(sid);
    return { id: sid, name: sv0.name, k, rank, text: k === "plan" ? `On your plan · ${cap(stop.day)}, stop ${stop.n}` : k === "big" ? "Most popular, left for later" : k === "list" ? `#${rank} on Your list` : k === "out" ? (sd.fate === "room" ? "Not a door type you pitch" : sd.reason) : "Not on your drinker's list" };
  }).filter(Boolean).slice(0, 8);
  const pours = v.tags?.bev ?? [];
  const room = [...(v.tags?.ambience ?? []), ...(v.tags?.interests ?? [])];
  const head = { name: v.name ?? dot?.name ?? "A door", kind: genreLabel(v) ? cap(genreLabel(v)) : null, neighborhood: v.neighborhood ?? null,
    status: [on ? `On your plan: ${cap(on.day)}, stop ${on.n}` : fateWord?.replace(/\.$/, "") ?? null, listRank ? `#${listRank} of ${listIds.length} on Your list` : null].filter(Boolean).join(" · ") };
  return { id, head, match, when, who, ages, sisters, pours, room, footer: `Every value above is a Qloo field on this place or a Doors count over ${sh.n ? `the ${sh.n} ${cityWord} doors Doors holds` : "the city"}.` };
}
