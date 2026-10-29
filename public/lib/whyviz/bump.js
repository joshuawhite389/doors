// WHY-VIZ-SPEC §4.6 The list by age: a bump chart. Columns: All ages and each age band the data has; rows: rank. The
// plan's twelve best doors (by Your list rank) as lines from their overall rank to Qloo's rank for them on each band's
// own page; a line that drops to the bottom row is a door that band's page doesn't include. The age buttons are
// picture 1's (one state, ui/whyviz/state.js); Apply = whatif kind age. Pure: no DOM.
//
// bumpModel({plan, routes, profile, sv, n}) → {series: [{id, name, listRank, ranks: {all: {rank, of}, <band>: {rank, of} | null}}],
//   bands: [{key, label, of}], maxRank, who, city, n}
import { bandsOf, bandRanks, planDays } from "./explorer.js";
import { bumpWords } from "./words.js";

export const BUMP_DOORS = 12;
export const BUMP_DOORS_PHONE = 6;

export function bumpModel({ plan, routes = [], profile = {}, sv = null, n = BUMP_DOORS, cityName = null }) {
  const listIds = plan?.pool?.ids ?? [];
  const onPlan = planDays(plan);
  const venues = { ...(sv?.venues ?? {}), ...(plan?.venues ?? {}) };
  const nameOf = (id) => venues[id]?.name ?? sv?.dots?.find((d) => d.id === id)?.name ?? "A door";
  const bands = bandsOf(profile, routes).map((b) => { const r = bandRanks(routes, b.key); return { key: b.key, label: b.label, of: r.of, ranks: r }; });
  const doors = listIds.map((id, i) => ({ id, listRank: i + 1 })).filter((d) => onPlan.has(d.id)).slice(0, n);
  const series = doors.map((d) => {
    const ranks = { all: { rank: d.listRank, of: listIds.length } };
    for (const b of bands) { const r = b.ranks.get(d.id); ranks[b.key] = r ? { rank: r.rank, of: r.of } : null; }
    return { id: d.id, name: nameOf(d.id), listRank: d.listRank, ranks };
  });
  const maxRank = Math.max(1, ...bands.map((b) => b.of), ...series.map((s) => s.listRank));
  const m = { series, bands: bands.map(({ key, label, of }) => ({ key, label, of })), maxRank, who: sv?.who ?? "your drinker", city: cityName ?? plan?.city?.name ?? "the city", n, listN: listIds.length };
  m.words = (band = null) => bumpWords(m, band);
  return m;
}

// the tooltip rows for one dot: "#16 of 38" · "for 25–34 Athletic Brewing drinkers"
export function bumpRows(s, bandKey, m) {
  const r = s.ranks[bandKey];
  const b = m.bands.find((x) => x.key === bandKey);
  const who = bandKey === "all" ? `for ${m.who}, all ages` : `for ${b?.label ?? bandKey} ${m.who}`;
  return [[s.name, ""], [r ? `#${r.rank} of ${r.of}` : "not on this list", who]];
}
