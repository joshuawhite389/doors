// "Why these rooms?" as a dashboard (owner review 2, G6): the numbers behind the ranked list, every one Qloo's or
// counted from Qloo's data. A route file's list rows are [id, affinity, audience_growth, explainability]: affinity is
// Qloo's taste match with the drinker (query.affinity); audience_growth is Qloo's undocumented measurement (not shown);
// explainability is null on every precomputed row (one signal entity per call). Pure: no DOM, no fetch.
// Covered by test/insights.test.mjs.
import { overlap } from "./core.js";
import { rankedIds } from "./pool.js";

const round3 = (x) => Math.round(x * 1000) / 1000;

// The map's match tiers, by rank on your list (the same rank the plan shows: "#3 of 87").
export const TIERS = [
  { key: "t1", to: 10, label: "Top 10" },
  { key: "t2", to: 25, label: "11–25" },
  { key: "t3", to: 50, label: "26–50" },
  { key: "t4", to: Infinity, label: "51 and below" },
];
export const tierOf = (rank) => TIERS.findIndex((t) => rank <= t.to);

// Every id on the plan's days (a return visit counted once).
export const planIds = (plan) => [...new Set((plan?.days ?? []).flatMap((d) => d?.stops?.map((s) => s.id) ?? []))];
// id → index of its first day on the plan
export function dayOfId(plan) {
  const m = new Map();
  (plan?.days ?? []).forEach((d, i) => d?.stops?.forEach((s) => { if (!m.has(s.id)) m.set(s.id, i); }));
  return m;
}

// The headline: what Qloo ranked → what passed the bar/restaurant filter → your rooms → your plan.
// Pages of the main call are capped at popularity 0.9; the famous page (no cap) is counted apart.
export function funnel(route, { pool = [], plan = [] } = {}) {
  const all = route?.lists?.all ?? [];
  const dropped = route?.dropped?.all ?? { n: 0, names: [] };
  const inAll = new Set(all.map((r) => r[0]));
  const famousOnly = (route?.lists?.famous ?? []).filter((r) => !inAll.has(r[0])).map((r) => r[0]);
  return { ranked: all.length + (dropped.n ?? 0), kept: all.length, dropped: dropped.n ?? 0, droppedNames: dropped.names ?? [], famousOnly, pool: pool.length, plan: plan.length, calls: route?.calls ?? null, captured: route?.captured ?? null };
}

// The match curve: the drinker's ranked rooms that are in your pool, in Qloo's order, with Qloo's affinity.
// rank = place on this drinker's list after your room filter (with one drinker, the plan's own rank).
export function curve(route, poolIds, { famous = false } = {}) {
  const pool = new Set(poolIds);
  const score = new Map();
  for (const r of [...(route?.lists?.all ?? []), ...(famous ? route?.lists?.famous ?? [] : [])]) if (r[1] != null && !score.has(r[0])) score.set(r[0], r[1]);
  const rows = rankedIds(route, { famous })
    .filter((id) => pool.has(id) && score.has(id))
    .map((id, i) => ({ id, rank: i + 1, score: score.get(id) }));
  const s = rows.map((r) => r.score);
  return { rows, max: s.length ? Math.max(...s) : null, min: s.length ? Math.min(...s) : null };
}

// Rank correlation (Spearman, average ranks for ties) between two equal-length number arrays; null under 5 points.
export function spearman(xs, ys) {
  const n = xs.length;
  if (n < 5 || ys.length !== n) return null;
  const ranks = (a) => {
    const idx = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]);
    const r = new Array(n);
    for (let i = 0; i < n; ) {
      let j = i;
      while (j + 1 < n && idx[j + 1][0] === idx[i][0]) j++;
      for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2 + 1;
      i = j + 1;
    }
    return r;
  };
  const rx = ranks(xs);
  const ry = ranks(ys);
  const mx = (n + 1) / 2;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    num += (rx[i] - mx) * (ry[i] - mx);
    dx += (rx[i] - mx) ** 2;
    dy += (ry[i] - mx) ** 2;
  }
  return dx && dy ? round3(num / Math.sqrt(dx * dy)) : null;
}

// Popular isn't the same as matched: Qloo's popularity (0–1, the venue record) against Qloo's affinity, for the
// curve's rooms. top: how many of the best-matched are outside the same number of most popular. famousOut: rooms
// the uncapped famous page ranked that the main list leaves out (popularity over 0.9), when that page exists.
export function popularity(route, rows, venues = {}, { top = 20 } = {}) {
  const pts = rows.filter((r) => Number.isFinite(venues[r.id]?.popularity)).map((r) => ({ ...r, pop: venues[r.id].popularity }));
  const n = Math.min(top, pts.length);
  const byMatch = pts.slice(0, n).map((p) => p.id);
  const byPop = [...pts].sort((a, b) => b.pop - a.pop || a.rank - b.rank).slice(0, n).map((p) => p.id);
  const popSet = new Set(byPop);
  const missed = byMatch.filter((id) => !popSet.has(id)); // best-matched, not among the most popular
  const inAll = new Set((route?.lists?.all ?? []).map((r) => r[0]));
  const famousOut = (route?.lists?.famous ?? [])
    .filter((r) => !inAll.has(r[0]) && venues[r[0]]?.popularity > 0.9 && r[1] != null) // over the cap; a lower one only ranked past page 3
    .map((r) => ({ id: r[0], score: r[1], pop: venues[r[0]].popularity }));
  return { pts, n, byMatch, byPop, missed, famousOut, rho: spearman(pts.map((p) => p.pop), pts.map((p) => p.score)) };
}

// Who skews where: Qloo re-ranked the same rooms with an age band as a second signal. For each band present in the
// route: its list inside your pool, in its order; its top `top`; and the rooms in its top that are outside your
// overall top `top` (the band's own picks). rankIn(id) → {band: rank on that band's list in your pool | null}.
export function ageSkew(route, poolIds, ages = {}, { top = 20 } = {}) {
  const pool = new Set(poolIds);
  const overall = new Set(poolIds.slice(0, top));
  const bands = Object.entries(ages)
    .filter(([k]) => route?.lists?.[k]?.length)
    .map(([key, a]) => {
      const ids = route.lists[key].map((r) => r[0]).filter((id) => pool.has(id));
      const head = ids.slice(0, top);
      return { key, label: a.label.replace(/\s*\(.*\)$/, ""), ids, top: head, own: head.filter((id) => !overall.has(id)) };
    });
  const ranks = new Map(bands.map((b) => [b.key, new Map(b.ids.map((id, i) => [id, i + 1]))]));
  const rankIn = (id) => Object.fromEntries(bands.map((b) => [b.key, ranks.get(b.key).get(id) ?? null]));
  return { bands, top, rankIn };
}

// Shared crowds: of your top 50 (base), the rooms each other brand's drinkers also have in their top 50 (the strip).
export function shared({ strip, base = [], brands = [], mine = [] }) {
  if (!strip?.brands || !base.length) return [];
  const head = base.slice(0, 50);
  const rows = brands
    .filter((b) => strip.brands[b.key] && !mine.includes(b.key))
    .map((b) => {
      const theirs = new Set(strip.brands[b.key].ids);
      const ids = head.filter((id) => theirs.has(id));
      return { key: b.key, name: b.name, category: b.category ?? "", n: overlap(strip.brands[b.key].ids, head), ids };
    })
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
  // why2 bug (Jard 10-24 #3): a brand "stands out" only when its overlap is well above the others'. A Heineken + Bud
  // Light drinker in Boise overlaps every held brand about the same (16–19 of 50), and the name sort then made
  // "Athletic Brewing" the headline; a flat overlap says nothing about the drinker, so no line is built from it.
  // Stands out: the overlaps spread by 10 or more, and this one is in the upper half of that spread.
  const hi = rows[0]?.n ?? 0;
  const lo = rows.at(-1)?.n ?? 0;
  return rows.map((r) => ({ ...r, stands: hi - lo >= 10 && r.n >= 10 && r.n >= (hi + lo) / 2 }));
}

// What the crowds listen to: artists Qloo associates with each room's audience (cities/<city>.json sounds), only
// for rooms whose list passed Doors' guard (guard.pass; the rest read as the area's sound, a scene the room's own
// record doesn't point to, or no signal). Counted per room: a genre counts a room once if any of its top `per`
// artists carries it. Near-duplicate genre tags are folded (r_b, rb, rhythm_blues → R&B); catch-alls ("all") skipped.
const GENRE_FOLD = { r_b: "rb", rhythm_blues: "rb", contemporary_rb: "rb", rap: "hip_hop", alternative_country: "alt_country" };
const GENRE_SKIP = new Set(["all", "other", "unknown"]); // catch-all tags, not genres
const GENRE_LABEL = { rb: "R&B", hip_hop: "Hip-hop and rap", edm: "EDM", indie_pop: "Indie pop", alt_country: "Alt-country" };
export const genreName = (g) => GENRE_LABEL[g] ?? (g.charAt(0).toUpperCase() + g.slice(1)).replace(/_/g, " ");
export function sound(ids, sounds = {}, { per = 10 } = {}) {
  const checked = ids.filter((id) => sounds[id]);
  const pass = checked.filter((id) => sounds[id].guard?.pass);
  const genres = new Map();
  const artists = new Map();
  for (const id of pass) {
    const seen = new Set();
    for (const a of sounds[id].artists.slice(0, per)) {
      if (!artists.has(a.name)) artists.set(a.name, new Set());
      artists.get(a.name).add(id);
      for (const g0 of a.genres ?? []) {
        const g = GENRE_FOLD[g0] ?? g0;
        if (seen.has(g) || GENRE_SKIP.has(g)) continue;
        seen.add(g);
        if (!genres.has(g)) genres.set(g, []);
        genres.get(g).push(id);
      }
    }
  }
  const out = (m, f) => [...m].map(([k, v]) => ({ ...f(k), ids: [...v] })).sort((a, b) => b.ids.length - a.ids.length || (a.label ?? a.name).localeCompare(b.label ?? b.name));
  return {
    checked: checked.length,
    rooms: pass,
    genres: out(genres, (k) => ({ key: k, label: genreName(k) })).filter((g) => g.ids.length >= 2),
    artists: out(artists, (k) => ({ name: k })).filter((a) => a.ids.length >= 2),
  };
}

// The crowd in Qloo's words: rooms whose Qloo crowd text (customer_demographics_description) mentions each
// descriptor. Doors picks the phrases and counts them; Qloo wrote the text. `base` = a wider set of rooms (every
// ranked room in the city) to compare against; share = rooms mentioning it / rooms with crowd text.
export const CROWD_TERMS = [
  { key: "youngpro", label: "Young professionals", re: /young professionals?/ },
  { key: "business", label: "Business crowd", re: /business (professionals|travell?ers|people|meetings|crowd|lunch)/ },
  { key: "couples", label: "Couples and date nights", re: /couples|date[- ]nights?/ },
  { key: "friends", label: "Groups of friends", re: /groups? of friends|friend groups/ },
  { key: "families", label: "Families", re: /famil(y|ies)/ },
  { key: "foodies", label: "Food enthusiasts", re: /food(ies| enthusiasts| lovers)|culinary enthusiasts/ },
  { key: "beer", label: "Craft beer fans", re: /craft beer|beer (enthusiasts|lovers|fans|connoisseurs)/ },
  { key: "cocktail", label: "Cocktail lovers", re: /cocktail (enthusiasts|lovers|connoisseurs|aficionados|fans)/ },
  { key: "wine", label: "Wine lovers", re: /wine (enthusiasts|lovers|connoisseurs)|oenophiles/ },
  { key: "locals", label: "Locals and neighbours", re: /local residents|locals|neighbou?rhood (residents|regulars)|regulars/ },
  { key: "tourists", label: "Tourists and visitors", re: /tourists?|visitors/ },
  { key: "hotel", label: "Hotel guests", re: /hotel guests|guests staying/ },
  { key: "students", label: "Students", re: /students|college/ },
  { key: "sports", label: "Sports fans", re: /sports? (fans|enthusiasts)|game[- ]day|watch(ing)? (the )?games?/ },
  { key: "music", label: "Live music fans", re: /music (lovers|fans|enthusiasts)|live music/ },
  { key: "late", label: "Late-night crowd", re: /late[- ]night/ },
  { key: "dogs", label: "Dog owners", re: /dog owners|pet owners|with (their )?dogs/ },
  { key: "health", label: "Health-conscious", re: /health[- ]conscious|wellness/ },
  { key: "work", label: "Remote workers", re: /remote work|work or study|study or work|laptop/ },
  { key: "lgbtq", label: "LGBTQ+ community", re: /lgbtq/ },
  { key: "upscale", label: "Upscale, sophisticated", re: /upscale|sophisticated|affluent/ },
  { key: "trendy", label: "Trendy, stylish", re: /trendy|stylish|fashionable/ },
];
export function crowd(ids, venues = {}, { base = null, baseVenues = venues, min = 2 } = {}) {
  const count = (list, vs) => {
    const texts = list.map((id) => [id, String(vs[id]?.crowd ?? "").toLowerCase()]).filter(([, t]) => t);
    return { n: texts.length, hits: CROWD_TERMS.map((t) => texts.filter(([, x]) => t.re.test(x)).map(([id]) => id)) };
  };
  const mine = count(ids, venues);
  const wide = base ? count(base, baseVenues) : null;
  const terms = CROWD_TERMS.map((t, i) => ({
    key: t.key,
    label: t.label,
    ids: mine.hits[i],
    share: mine.n ? mine.hits[i].length / mine.n : 0,
    base: wide?.n ? wide.hits[i].length / wide.n : null,
  }))
    .filter((t) => t.ids.length >= min)
    .sort((a, b) => b.share - a.share || a.label.localeCompare(b.label));
  return { n: mine.n, baseN: wide?.n ?? null, terms };
}

// Every ranked room in the city across the given route files (the crowd baseline), unique.
export function cityRooms(routes = []) {
  const ids = new Set();
  const venues = {};
  for (const r of routes) for (const row of r?.lists?.all ?? []) if (r.venues?.[row[0]]) (ids.add(row[0]), (venues[row[0]] = r.venues[row[0]]));
  return { ids: [...ids], venues };
}
