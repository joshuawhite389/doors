// WHY-VIZ-SPEC §4.3: who is in the room, against the city. One row per crowd group Qloo names in the descriptions
// of the plan's doors (lib/insights.js CROWD_TERMS, the same counts the Who view shows): the share of plan doors
// naming it against the share across every door Doors holds for the city. The lift is the ratio; a group within
// 0.8–1.25× the city is muted ("about the city") and is never a talking point (spec rule 3, Jard 10-24 on "music
// enthusiasts"). Pure: no DOM, no fetch.
import { crowd, CROWD_TERMS } from "../insights.js";

export const MUTED = [0.8, 1.25]; // about the city
export const STRONG = 1.5; // worth saying (and the talking-point rule's floor, spec §4.3)
export const WEAK = 0.6; // "far less"
export const MIN_DOORS = 2; // a row needs this many plan doors naming it (crowd()'s own floor)
export const PHONE_KEEP = (r) => r.lift >= STRONG || r.lift <= WEAK; // the phone's rows (spec §5)

// planIds: the plan's doors (every day, once each); venues: id → venue (crowd text); base: {ids, venues} the city's
// doors; cityName. → {n (plan doors described), baseN (city doors described), rows:[{key, label, n, share, base, lift,
// muted, dir}], top, low, common, cityName}
export function liftModel({ planIds = [], venues = {}, base = { ids: [], venues: {} }, cityName = "the city" }) {
  const cr = crowd(planIds, venues, { base: base.ids, baseVenues: base.venues, min: MIN_DOORS });
  const rows = cr.terms.filter((t) => t.base != null).map((t) => {
    const lift = t.base > 0 ? t.share / t.base : Infinity;
    const muted = lift >= MUTED[0] && lift <= MUTED[1];
    return { key: t.key, label: t.label, n: t.ids.length, ids: t.ids, share: t.share, base: t.base, lift, muted, dir: muted ? "about" : lift > 1 ? "more" : "less" };
  }).sort((a, b) => b.lift - a.lift || b.n - a.n || a.label.localeCompare(b.label));
  return {
    n: cr.n, baseN: cr.baseN ?? 0, rows, cityName,
    top: rows.filter((r) => r.lift >= STRONG), low: rows.filter((r) => r.lift <= WEAK),
    common: rows.filter((r) => r.muted && r.base >= 0.5), // true of most of the city
  };
}
export const liftLabel = (r) => (r.muted ? "about the city" : !Number.isFinite(r.lift) ? "only at your doors" : `×${r.lift.toFixed(1)}`);
const times = (x) => (x >= 10 ? `${Math.round(x)}` : x.toFixed(1).replace(/\.0$/, ""));
// "5 to 7 times as often" / "about twice as often" / "7 times as often"
export function timesWords(rows) {
  const ls = rows.map((r) => r.lift).filter(Number.isFinite);
  if (!ls.length) return "far more often";
  const lo = Math.min(...ls), hi = Math.max(...ls);
  const a = Math.round(lo), b = Math.round(hi);
  if (lo >= 1.95) return a === b ? `${a} times as often` : `${a} to ${b} times as often`;
  if (hi >= 1.95) return `up to ${times(hi)} times as often`;
  return times(lo) === times(hi) ? `${times(hi)} times as often` : `${times(lo)} to ${times(hi)} times as often`; // round 5: never "1.5 to 1.5"
}

// ---- one door against the city (WHY-VIZ-SPEC §4.7 the portrait's chips, §6 the stop card's rarity chips) ----
export const RARE_MAX = 0.25; // with no plan-level row, a group named at a quarter of the city's doors or fewer is rare
export const MOST_MIN = 0.5;
// the share of the city's doors (every brand's ranked list Doors holds) whose crowd text names each group
export function cityShares(base) {
  const texts = (base?.ids ?? []).map((id) => String(base.venues?.[id]?.crowd ?? "").toLowerCase()).filter(Boolean);
  return { n: texts.length, of: Object.fromEntries(CROWD_TERMS.map((t) => [t.key, texts.length ? texts.filter((x) => t.re.test(x)).length / texts.length : 0])) };
}
// The groups Qloo's crowd description of one door names, rarest in the city first, each with the city's share. A group
// is rare (a chip worth saying) when the plan-level lift (liftModel's row) is ≥ STRONG, or, with no row for it, when
// the city share is ≤ RARE_MAX. Nothing ordinary gets a chip, so nothing ordinary gets said (spec §6).
// → [{key, label, share, lift, muted, rare, text}]
export function rarityChips({ venue = {}, base = null, lift = null, cityName = "the city" } = {}) {
  const sh = cityShares(base);
  const text = String(venue?.crowd ?? "").toLowerCase();
  const rowOf = (key) => lift?.rows?.find((r) => r.key === key) ?? null;
  return CROWD_TERMS.filter((t) => t.re.test(text)).map((t) => ({ key: t.key, label: t.label, share: sh.of[t.key] ?? 0, lift: rowOf(t.key)?.lift ?? null, muted: rowOf(t.key)?.muted ?? false })).sort((a, b) => a.share - b.share)
    .map((c) => { const rare = c.lift != null ? c.lift >= STRONG : c.share <= RARE_MAX; return { ...c, rare, text: rare ? `${Math.max(1, Math.round(c.share * 100))}% of ${cityName}` : c.share >= MOST_MIN ? `most of ${cityName}` : `common in ${cityName}` }; });
}
