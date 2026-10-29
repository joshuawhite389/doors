// WHY-VIZ-SPEC §6 the landing page and the Devpost lead image: picture 1 with two labels. The whole pitch is in it: a
// map or a best-bars list sends a rep to the amber corner (the most popular doors, where every rep already goes); Qloo's graph
// sends her to the green one (loved by her drinker, not yet popular). Every dot is a place Qloo ranked for the demo's
// drinker in the demo's city (the kept list plus the most popular), its fate from lib/sieve.js over the demo's baked plan
// (public/data/demo/demo.json states[0]), through lib/whyviz/explorer.js's model, so the landing draws exactly what the
// app's Why home draws for the same plan. The two labels: the #1 door, and Doors' big-names line. Pure: no DOM.
import { sieve } from "../sieve.js";
import { popWords } from "../core.js";
import { explorerModel } from "./explorer.js";
import { ordinal } from "./words.js";

export const BIG_LINE = 0.9; // Doors' popularity cap (the route filter's popularityMax; the explorer's line)

// The plan the sieve reads, from the demo bake's first state (its three days as planned) over the hero's pool.
// {demo, pool: lib/pool.js buildPool's {ids, venues, N}, profile, cityKey, cityName} → plan
export function heroPlan({ demo = null, pool, profile, cityKey, cityName }) {
  const days = (demo?.states?.[0]?.days ?? []).filter((d) => d?.ids?.length).map((d, i) => ({ day: d.day, date: profile?.windows?.[i]?.date ?? null, from: d.from, to: d.to, start: profile?.start ?? null, stops: d.ids.map((id, k) => ({ id, eta: d.etas?.[k] ?? null })) }));
  return { days, venues: pool.venues, statuses: {}, pool: { ids: pool.ids, N: pool.N ?? pool.ids.length }, city: { key: cityKey, name: cityName }, profile };
}

// → {dots:[{id, name, score, pop, cls}], N, top, bigTop, who, city, labels:{big, top}, caption}
export function heroModel({ route, plan, profile, city = null, cityName = plan?.city?.name ?? "the city" }) {
  const sv = sieve({ route, plan, profile, famous: false, city });
  const m = explorerModel({ sv, plan, profile, routes: [route], famous: false, state: { x: "pop", band: null, rooms: profile?.rooms ?? [], famous: false, r45: false }, cityName });
  const dots = m.dots.filter((d) => Number.isFinite(d.score) && Number.isFinite(d.pop)).map((d) => ({ id: d.id, name: d.name, score: d.score, pop: d.pop, cls: d.cls === "plan" ? "plan" : d.cls === "list" ? "list" : d.cls === "big" ? "big" : "out", listRank: d.listRank }));
  const top = m.top ? { id: m.top.id, name: m.top.name, pop: m.top.pop, popRank: m.top.popRank ?? null, word: popWords(m.top.pop) } : null;
  const who = m.who;
  return {
    dots, N: m.N, top, bigTop: m.bigTop, who, city: cityName, bigLine: BIG_LINE,
    labels: {
      big: "Most popular: 0.9 and up, left for later",
      top: top ? `${top.name} · #1 of ${m.N} for ${who}${top.popRank ? `, ${ordinal(top.popRank)} most popular on Your list` : ""}` : "",
    },
    caption: { b: `${who[0].toUpperCase()}${who.slice(1)} · ${cityName}`, text: `every place Qloo ranked: match up, how well known across` },
  };
}
