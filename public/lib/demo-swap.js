// The guided demo's swap card (owner review 9): the same drinker brand in two cities. Each side is the city's #1 room
// for Athletic Brewing drinkers, as the real stop shows it (lib/stopmodel.js): its rank against where popularity alone
// puts it, how many sister doors it has (doors with a crowd like it), and the first clause of Qloo's own words about its
// crowd.
// Data: the precomputed route and city files the app already serves, so the card makes no call to Qloo, a model or
// anything else. Pure: no DOM, no fetch.
import { buildPool } from "./pool.js";
import { stopModel } from "./stopmodel.js";
import { shortDates } from "./agent-ui.js";

export const SWAP_CITIES = ["austin", "boise"]; // the pair the proof harness measures (na-austin → na-boise)
export const SWAP_DRINKER = "athletic-brewing";

// The source label of docs/CULTURAL-SLOTS.md §3.2, with the date as the app writes it now (intuit pass 1b #9): "Qloo's
// data, Oct 8"
export const qlooSays = (captured) => `Qloo's data${captured ? `, ${shortDates(captured)}` : ""}`;
// Qloo's crowd text cut to its first clause, still quoted as is (intuit pass 1b #9: two 5-line paragraphs crowded card
// 22): "The customer base primarily consists of local craft beer enthusiasts…"
export const firstClause = (t) => {
  const m = /^(.{24,}?)[,;:.](\s|$)/.exec(t ?? "");
  return m && m[1].length < t.trim().length - 1 ? `${m[1]}…` : (t ?? null);
};

// One city's side. route: public/data/routes/<drinker>-<city>.json; city: public/data/cities/<city>.json;
// profile: the demo profile (its city and known rooms are replaced: the swap keeps only the brand and the rooms).
export function swapSide({ route, city, cityKey, cityName, profile }) {
  const p = { ...profile, city: cityKey, known: [] };
  const pool = buildPool({ routes: [route], profile: p, cityName });
  const id = pool.ids[0];
  if (!id) return null;
  const plan = { venues: pool.venues, pool, profile: p, city: { key: cityKey, name: cityName }, days: [] };
  const m = stopModel({ plan, id, city, routes: [route] });
  const crowd = m.why.find((l) => /crowd/i.test(l.label ?? ""));
  // judge pass 9 #3: the card leads with Qloo's rank against popularity alone (as in the lead image), not the openers
  const ranked = pool.rows.filter((r) => r.rank).map((r) => r.id);
  const byPop = [...ranked].sort((a, b) => (pool.venues[b]?.popularity ?? 0) - (pool.venues[a]?.popularity ?? 0));
  return {
    city: cityName,
    id,
    name: m.venue.name,
    rankLine: m.rankLine,
    rank: m.rank,
    of: ranked.length,
    popRank: byPop.indexOf(id) + 1 || null, // where popularity alone would put it, among the same ranked doors
    alike: city?.sisters?.[id]?.length ?? 0, // doors whose crowd Qloo matches to this door's
    drinker: m.drinkerName,
    whyLine: m.whyLine, // judge pass 8 #2: the swap card says why in words, not "#1 of 55"
    // Qloo's text quoted, not reworded (CONTRACTS-R9 §2.3)
    crowd: crowd?.original ?? m.venue.crowd ?? null,
    crowdShort: firstClause(crowd?.original ?? m.venue.crowd ?? null),
    crowdBy: qlooSays(m.record.captured),
    opener: m.talk.opener,
    openerBy: m.talk.lines?.opener === "model" ? "model-drafted from Qloo's profile of this door" : "Doors' template, from Qloo's profile of this door",
  };
}
