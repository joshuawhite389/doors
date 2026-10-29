// Doors core: pure functions shared by the browser, the Worker and the Node scripts. No imports, no I/O.
// Venue trimming, the food-and-drink filter, the hours parser, set overlap, the route builder, the room-sound
// guard and the template pitch. Every function here is covered by test/core.test.mjs.

export const PLACE_TAGS = ["urn:tag:genre:place:restaurant", "urn:tag:category:place:bar", "urn:tag:genre:place:restaurant:bar"];
export const TAG_FILTER_LABEL = "bar and restaurant tags";
export const DAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
export const DAYPARTS = {
  lunch: { label: "lunch", from: 11 * 60, to: 14 * 60 },
  afternoon: { label: "afternoon", from: 14 * 60, to: 17 * 60 },
  evening: { label: "evening", from: 17 * 60, to: 22 * 60 },
};
// Qloo age buckets behind each dial position. The under-25 bucket includes under-21s, so it is offered only for
// non-alcoholic brands and labelled "21+ planning only".
export const AGE_DIAL = {
  all: { label: "All ages", buckets: null },
  // r2 (Jard 10-24): Qloo's youngest band is "24_and_younger"; Doors plans only bars and restaurants, where the
  // drinkers are 21 and over, so it reads as 21–24 (key kept: lists fetched before carry it). 55+ is "55_and_older".
  under_25: { label: "21–24", buckets: "24_and_younger" },
  "25_34": { label: "25–34", buckets: "25_to_29,30_to_34" },
  "35_44": { label: "35–44", buckets: "35_to_44" },
  "45_54": { label: "45–54", buckets: "45_to_54" },
  "55_plus": { label: "55 and over", buckets: "55_and_older" },
};

// ---------- food and drink filter ----------
// Qloo's bar/restaurant tag filter lets some non-F&B rooms through (a pitch-and-putt in Austin). An on-premise
// account is a room that pours: restaurants, bars, breweries, wineries, cafés, music rooms, hotel bars.
const DENY = /(cater|golf|putt|arcade|amusement|soccer|stadium|park$|museum|sculpture|bridge|observation|convention|wedding|banquet|country_club|social_club|^club$|travel_lounge|adult|bowling|_store$|_shop$|store_|grocery|market$|gym|spa$|church|school|groomer|theater|cinema)/;
const DENY_RESTAURANT = /(bakery|patisserie|grocery|supermarket|banquet|cater|deli$|delicatessen|ice_cream|frozen_yogurt|food_court|butcher|cheese_shop|cake_shop|donut|dessert|candy|cookie|chocolate|pie_shop|bagel|popcorn|fast_food|sandwich_shop|açaí|acai|juice|smoothie)/;
const ALLOW = /(restaurant|bar|pub|brew|taproom|tavern|winery|distillery|cider|lounge|night_club|dance_club|live_music|jazz_club|cafe|brasserie|grill|hotel|beer_hall|beer_garden|gastropub)/;
const COFFEE_POURS = /(beer|wine|cocktail|taproom|tap house|taphouse|spirits|tavern|\bpub\b|saloon|cantina|mezcal|cider)/i;
const POURS = /(beer|brew|bar\b|pub\b|tap|wine|cocktail|spirits|tavern|cider|saloon|lounge|cantina|mezcal)/i;

// Names that say "not a room that pours" whatever genre Qloo filed them under (Diolosa R2: Panera under restaurant,
// coffee houses under restaurant:cafe, boba, juice, grocer-cafés, delis, caterers). Kept only if the name also pours.
const NAME_DENY = /(coffee|espresso|\bboba\b|bubble tea|\btea (house|bar|shop)\b|juice|smoothie|bakery|bakehouse|patisserie|grocer|grocery|\bmarket\b|\bdeli\b|delicatessen|sandwich|cater|panera|corner bakery|creamery|donut|doughnut|bagel)/i;
const MARKET_RESCUE = /(kitchen|grill|bistro|brasserie|tavern|\bbar\b|\bpub\b|fulton market|old market|basque market)/i;
// a real bar word ("The Garage Bar & Sandwiches", "16th Street Bar & Coffee Lounge"), not "Coffee Bar" / "Juice Bar"
const BAR_WORD = /(?<!(coffee|juice|espresso|smoothie|tea|chocolat|salad|oxygen|nail)\s)\bbar\b/i;
// Airport rooms are not doors a founder walks into (terminal bars, airline clubs). "Airport Blvd" streets stay.
const AIRPORT = /(o['’]?hare|international airport|midway airport|\bterminal\s*\d|\bconcourse\b|admirals club|airline club|\bord\b terminal|airport (concourse|terminal))/i;

export function genreId(v) {
  return v?.genre ?? v?.properties?.primary_genre?.id ?? "";
}

// (persona capture, 2026-10-22): a chain's drinks list is bought by corporate, not at the door: the stop says
// "corporate buys" so the rep asks who decides for the location instead of pitching the bartender. National and big
// regional chains by name (whole words; curly or straight apostrophes).
const CHAINS = /^(?:the\s+)?(?:applebee['’]?s|buffalo wild wings|bdubs|chili['’]?s(?: grill)?|giordano['’]?s|olive garden|red robin|outback steakhouse|texas roadhouse|hooters|twin peaks|tilted kilt|dave (?:&|and) buster['’]?s|topgolf|yard house|bj['’]?s restaurant|cheesecake factory|p\.? ?f\.? chang['’]?s|bar louie|old chicago|world of beer|miller['’]?s ale house|hard rock cafe|margaritaville|red lobster|ruby tuesday|tgi friday['’]?s|denny['’]?s|ihop|cracker barrel|logan['’]?s roadhouse|longhorn steakhouse|carrabba['’]?s|bonefish grill|seasons 52|ruth['’]?s chris|fleming['’]?s|del frisco['’]?s|fogo de ch[aã]o|rock bottom|gordon biersch|punch bowl social|walk-on['’]?s|kona grill|uncle julio['’]?s|chuy['’]?s|cheddar['’]?s|hopdoddy|starbucks|dunkin['’]?|panera|chipotle|herbalife|nutrition club|first watch|snooze|hurricane grill|famous dave['’]?s|buca di beppo|maggiano['’]?s|bj['’]?s brewhouse|on the border|abuelo['’]?s|el torito|twin peaks)(?![\p{L}\p{N}])/iu;
export const isChain = (name) => CHAINS.test(String(name ?? "").trim()) || /\bnutrition club\b/i.test(String(name ?? ""));

// alcohol: true for an alcohol brand (coffee shops are then kept only when the name says they pour).
export function isFoodAndDrink(v, { alcohol = false } = {}) {
  const g = genreId(v).replace("urn:tag:genre:place:", "");
  const name = v?.name ?? "";
  if (/\b(hy-?vee|whole foods|kroger|safeway|albertsons|walmart|target|costco|trader joe|h-e-b|heb|jewel-osco|mariano)/i.test(name)) return false; // grocery chains filed under restaurant genres
  if (AIRPORT.test(name) || AIRPORT.test(v?.address ?? "")) return false;
  if (NAME_DENY.test(name) && !COFFEE_POURS.test(name) && !BAR_WORD.test(name) && !(/\bmarket\b/i.test(name) && MARKET_RESCUE.test(name) && !/(coffee|bakery|grocer|deli|juice|boba|sandwich|cater|panera)/i.test(name))) return false;
  if (!g) return true; // no category: keep, it arrived through the bar/restaurant tag filter
  if (/^restaurant(:|$)/.test(g)) {
    const sub = g.replace(/^restaurant:?/, "");
    // coffee-only rooms are not doors for a drink brand, unless the name says beer, wine or cocktails
    if (/coffee|tea_house|tea_store|bubble_tea|boba|roaster/.test(sub)) return COFFEE_POURS.test(name);
    // a café filed as restaurant:cafe whose name is just "café/cafe" is a coffee house, not a door
    if (sub === "cafe" && /caf[eé]/i.test(name) && !/(restaurant|bistro|kitchen|grill|bar\b|brasserie|tavern)/i.test(name) && !COFFEE_POURS.test(name)) return false;
    return !DENY_RESTAURANT.test(sub);
  }
  if (/^event_venue$/.test(g)) return POURS.test(name);
  if (DENY.test(g)) return false;
  return ALLOW.test(g);
}

export function genreLabel(v) {
  const g = genreId(v).split(":").pop() || "";
  return g.replace(/_\(us\)/, "").replace(/_/g, " ").replace(/&/g, "and").trim();
}

// ---------- room tag families (R9 deep) ----------
// The Qloo tag families Doors decides with (lib/culture.js), kept by name and capped, from a place's `tags[]`. The rest
// (customer_identity, age_range, …) are dropped here: no slot reads who the crowd is (docs/CULTURAL-SLOTS.md §2).
export const TAG_FAMILIES = { time_of_day_fit: "tod", visit_intent: "visit", beverage_offering: "bev", menu_highlight: "menu", interests: "interests", ambience: "ambience" };
const TAG_CAP = { tod: 7, visit: 3, bev: 10, menu: 6, interests: 6, ambience: 6 };
export function tagFamilies(tags) {
  if (!Array.isArray(tags) || !tags.length) return null;
  const out = {};
  for (const t of tags) {
    const fam = TAG_FAMILIES[String(t?.type ?? t?.id ?? "").split(":")[2]];
    const name = String(t?.name ?? "").trim();
    if (!fam || !name) continue;
    const l = (out[fam] ??= []);
    if (l.length < TAG_CAP[fam] && !l.includes(name)) l.push(name);
  }
  return Object.keys(out).length ? out : null;
}

// ---------- venue record ----------
const firstSentence = (s, max = 220) => {
  if (!s) return "";
  const m = String(s).match(/^.*?[.!?](\s|$)/);
  const t = (m ? m[0] : String(s)).trim();
  return t.length > max ? t.slice(0, max - 1).replace(/\s+\S*$/, "") + "…" : t;
};
export { firstSentence };

// Trim a Qloo place result to the fields Doors uses (keeps route files near 250 KB for 150 venues).
export function trimVenue(e) {
  const p = e.properties ?? {};
  const q = e.query ?? {};
  return {
    id: e.entity_id,
    name: e.name,
    lat: e.location?.lat ?? null,
    lon: e.location?.lon ?? null,
    address: p.address ?? null,
    neighborhood: p.neighborhood ?? null,
    phone: p.phone ?? null,
    website: p.website ?? null,
    menu: p.menu_url ?? null,
    image: p.images?.[0]?.url ?? p.image?.url ?? null,
    price: p.price_level ?? null,
    rating: p.business_rating ?? null,
    popularity: e.popularity ?? null,
    genre: p.primary_genre?.id ?? null,
    closed: p.is_closed ?? false,
    hours: p.hours ?? null,
    crowd: p.customer_demographics_description ?? null,
    ambience: p.ambience_description ?? null,
    description: p.short_description ?? p.description ?? null,
    goodFor: (p.good_for ?? []).map((g) => g?.name).filter(Boolean),
    liveMusic: p.live_music ?? null,
    dishes: (p.specialty_dishes ?? []).map((d) => (typeof d === "string" ? d : d?.name)).filter(Boolean).slice(0, 6),
    tags: tagFamilies(e.tags), // R9 deep: Qloo's room tag families, by name (lib/culture.js decides with them)
    affinity: q.affinity ?? null,
    growth: q.measurements?.audience_growth ?? null,
    explain: (q.explainability?.["signal.interests.entities"] ?? []).map((x) => ({ id: x.entity_id, score: x.score })),
  };
}

// ---------- hours ----------
const toMin = (t) => {
  const m = /^T?(\d{1,2}):(\d{2})/.exec(String(t ?? ""));
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 24 || mi > 59) return null;
  return h * 60 + mi;
};

// Parse Qloo's `hours` ({monday:[{opens:"T11:00:00", closes:"T22:00:00", closed:false}], …}).
// Returns {ok, days:{monday:{closed, spans:[{from,to}]}}, raw}. A close at or before the open runs past midnight
// (to + 1440). A day with no usable entry is missing; any unusable entry makes ok false ("hours unverified").
export function parseHours(hours) {
  const out = { ok: false, days: {}, raw: hours ?? null };
  if (!hours || typeof hours !== "object" || Array.isArray(hours)) return out;
  let good = 0;
  let bad = 0;
  for (const day of DAYS) {
    const entries = hours[day];
    if (!Array.isArray(entries) || !entries.length) continue;
    const spans = [];
    let closed = false;
    for (const s of entries) {
      if (s?.closed === true) {
        closed = true;
        continue;
      }
      const from = toMin(s?.opens);
      let to = toMin(s?.closes);
      if (from === null || to === null) {
        bad++;
        continue;
      }
      if (to <= from) to += 1440;
      spans.push({ from, to });
    }
    if (spans.length) closed = false;
    if (!spans.length && !closed) continue;
    out.days[day] = { closed, spans };
    good++;
  }
  out.ok = good > 0 && bad === 0;
  return out;
}

// Minutes the venue is open inside [from, to) on `day`, counting the previous day's spans that run past midnight.
export function openMinutes(parsed, day, from, to) {
  if (!parsed?.ok) return null;
  const i = DAYS.indexOf(day);
  const prev = DAYS[(i + 6) % 7];
  const spans = [...(parsed.days[day]?.spans ?? []), ...(parsed.days[prev]?.spans ?? []).filter((s) => s.to > 1440).map((s) => ({ from: 0, to: s.to - 1440 }))];
  if (!parsed.days[day] && !parsed.days[prev]) return null;
  let m = 0;
  for (const s of spans) m += Math.max(0, Math.min(to, s.to) - Math.max(from, s.from));
  return m;
}

// "open" = at least 90 minutes of the daypart (or all of it when shorter). null = unknown (hours unverified).
export function isOpenFor(parsed, day, daypart = "evening") {
  const dp = DAYPARTS[daypart] ?? DAYPARTS.evening;
  const m = openMinutes(parsed, day, dp.from, dp.to);
  if (m === null) return null;
  return m >= Math.min(90, dp.to - dp.from);
}

const clock = (min) => {
  const m = ((min % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (m === 0) return "midnight";
  if (m === 720) return "noon";
  const h12 = h % 12 || 12;
  return `${h12}${mm ? ":" + String(mm).padStart(2, "0") : ""} ${h < 12 ? "am" : "pm"}`;
};

// "5–11 pm", "11 am–2 am", "closed", or null when unknown.
export function formatDayHours(parsed, day) {
  if (!parsed?.ok) return null;
  const d = parsed.days[day];
  if (!d) return null;
  if (d.closed || !d.spans.length) return "closed";
  return d.spans
    .map((s) => {
      if (s.to - s.from >= 1440) return "open 24 hours";
      const a = clock(s.from);
      const b = clock(s.to);
      const [an, ap] = a.split(" ");
      const [bn, bp] = b.split(" ");
      return ap && bp && ap === bp && s.to - s.from < 720 ? `${an}–${bn} ${bp}` : `${a}–${b}`;
    })
    .join(", ");
}

export function rawHoursText(raw) {
  if (raw == null) return "no hours listed";
  return typeof raw === "string" ? raw : JSON.stringify(raw).slice(0, 160);
}

// ---------- geometry ----------
export function km(a, b) {
  if (a?.lat == null || b?.lat == null) return Infinity;
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

// ---------- set overlap (the brand strip) ----------
export function overlap(aIds, bIds) {
  const b = new Set(bIds);
  let n = 0;
  for (const id of new Set(aIds)) if (b.has(id)) n++;
  return n;
}

export function overlapSentence(otherName, baseName, n, of = 50) {
  return `${otherName} shares ${n} of ${of} doors with ${baseName}`;
}

// ---------- route builder ----------
// Doors are already ranked by affinity and filtered (open on the day, price cap). Selection: the best open door is
// door 1 and anchors group A; its Qloo sister doors that are also ranked, open and within maxKm join it (up to
// groupMax); repeat with the next best unused door until `size` doors. Only doors within radiusKm of door 1 are
// eligible (the radius widens through `radii` until there are `size`). Order: nearest-neighbour from door 1, then a
// 2-opt pass so no two legs cross. No leg may exceed maxLeg km: a door that would need one is dropped to the ranked
// list and the next eligible door within maxLeg of the route takes its place. Straight lines, not turn-by-turn.
const tourLen = (pts) => {
  let t = 0;
  for (let i = 1; i < pts.length; i++) t += km(pts[i - 1], pts[i]);
  return t;
};
export function nearestNeighbour(pts) {
  if (pts.length < 3) return pts.slice();
  const left = pts.slice(1);
  const seq = [pts[0]];
  while (left.length) {
    const cur = seq[seq.length - 1];
    let j = 0;
    let bd = Infinity;
    left.forEach((p, i) => {
      const d = km(cur, p);
      if (d < bd) {
        bd = d;
        j = i;
      }
    });
    seq.push(left.splice(j, 1)[0]);
  }
  return seq;
}
// 2-opt on an open path with a fixed start: reverse any segment that shortens the path (removes crossings).
export function twoOpt(pts, dist = km) {
  const p = pts.slice();
  const n = p.length;
  let improved = true;
  let guard = 0;
  while (improved && guard++ < 200) {
    improved = false;
    for (let i = 1; i < n - 1; i++) {
      for (let k = i + 1; k < n; k++) {
        const before = dist(p[i - 1], p[i]) + (k + 1 < n ? dist(p[k], p[k + 1]) : 0);
        const after = dist(p[i - 1], p[k]) + (k + 1 < n ? dist(p[i], p[k + 1]) : 0);
        if (after + 1e-9 < before) {
          const seg = p.slice(i, k + 1).reverse();
          p.splice(i, k - i + 1, ...seg);
          improved = true;
        }
      }
    }
  }
  return p;
}
// Do two legs a-b and c-d cross? (used by the tests to prove the 2-opt result)
export function legsCross(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q.lon - p.lon) * (r.lat - p.lat) - (q.lat - p.lat) * (r.lon - p.lon));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}

export function buildRoute(allDoors, sisters = {}, opts = {}) {
  // An isolated best door (an airport bar, a suburb with nothing near it) cannot start a legal route: demote it to
  // the ranked list with the reason and let the next door lead. Bounded: at most 10 demotions.
  const { maxLeg = 8, size = 12 } = opts;
  const demoted = [];
  let pool = allDoors.filter((d) => d.lat != null);
  for (let i = 0; i < 10 && pool.length > 1; i++) {
    const r = buildRouteOnce(pool, sisters, opts);
    const isolated = pool.filter((d) => d !== pool[0] && km(pool[0], d) <= maxLeg).length < Math.min(2, pool.length - 1);
    // demoting only helps if some other door has a neighbour within maxLeg (else keep the best door alone)
    const better = pool.slice(1).some((d) => pool.some((o) => o !== d && o !== pool[0] && km(d, o) <= maxLeg));
    if ((r.maxLegKm <= maxLeg && !(isolated && r.stops.length < Math.min(size, pool.length))) || !better) {
      r.dropped = [...demoted, ...r.dropped];
      return r;
    }
    demoted.push({ id: pool[0].id, reason: `more than ${maxLeg} km from the other open doors, so it does not lead the route` });
    pool = pool.slice(1);
  }
  const r = buildRouteOnce(pool, sisters, opts);
  r.dropped = [...demoted, ...r.dropped];
  return r;
}

function buildRouteOnce(allDoors, sisters = {}, { size = 12, groupMax = 4, maxKm = 6, maxLeg = 8, radii = [5, 8, 12, 20, Infinity] } = {}) {
  const first = allDoors.find((d) => d.lat != null);
  let doors = allDoors.filter((d) => d.lat != null);
  let radiusKm = null;
  if (first) {
    for (const r of radii) {
      doors = allDoors.filter((d) => d.lat != null && km(first, d) <= r);
      radiusKm = r;
      if (doors.length >= size) break;
    }
  }
  const byId = new Map(doors.map((d) => [d.id, d]));
  const used = new Set();
  const banned = new Set();
  const groupOf = new Map();
  const groups = [];
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const addGroup = (anchor) => {
    const g = { letter: letters[groups.length] ?? "?", anchor: anchor.id, ids: [anchor.id], sistersKnown: Array.isArray(sisters[anchor.id]) };
    used.add(anchor.id);
    groupOf.set(anchor.id, g);
    for (const sid of sisters[anchor.id] ?? []) {
      if (g.ids.length >= groupMax || used.size >= size) break;
      const s = byId.get(sid);
      if (!s || used.has(sid) || banned.has(sid) || km(anchor, s) > maxKm) continue;
      used.add(sid);
      g.ids.push(sid);
      groupOf.set(sid, g);
    }
    groups.push(g);
  };
  const fill = (near) => {
    for (const d of doors) {
      if (used.size >= size) break;
      if (used.has(d.id) || banned.has(d.id)) continue;
      if (near && !near(d)) continue;
      addGroup(d);
    }
  };
  fill(null);
  const dropped = [];
  let seq = [];
  for (let pass = 0; pass < 30; pass++) {
    const pts = [...used].map((id) => byId.get(id));
    if (!pts.length) break;
    const start = pts.find((p) => p.id === first?.id) ?? pts[0];
    // 2-opt on a metric that heavily penalises legs over maxLeg, so a legal order is found when one exists
    const pen = (a, b) => {
      const d = km(a, b);
      return d > maxLeg ? d + 1000 : d;
    };
    seq = twoOpt(twoOpt(nearestNeighbour([start, ...pts.filter((p) => p !== start)]), pen));
    const bad = seq.findIndex((p, i) => i > 0 && km(seq[i - 1], p) > maxLeg);
    if (bad < 0) break;
    const out = seq[bad];
    used.delete(out.id);
    banned.add(out.id);
    const g = groupOf.get(out.id);
    if (g) g.ids = g.ids.filter((x) => x !== out.id);
    dropped.push({ id: out.id, reason: `more than ${maxLeg} km from the rest of the route` });
    fill((d) => seq.some((p) => p.id !== out.id && km(p, d) <= maxLeg));
  }
  const live = groups.filter((g) => g.ids.length);
  const stops = seq.map((p, i) => {
    const g = groupOf.get(p.id);
    return { id: p.id, n: i + 1, group: g?.letter ?? "?", anchor: g?.anchor === p.id };
  });
  const legs = seq.map((p, i) => (i ? Math.round(km(seq[i - 1], p) * 10) / 10 : 0));
  const total = Math.round(legs.reduce((a, b) => a + b, 0) * 10) / 10; // equals the sum of the legs shown
  return {
    stops,
    groups: live.map((g) => ({ letter: g.letter, anchor: g.anchor, ids: g.ids, sistersKnown: g.sistersKnown })),
    km: total,
    legs,
    maxLegKm: legs.length ? Math.max(...legs) : 0,
    radiusKm: Number.isFinite(radiusKm) ? radiusKm : null,
    eligible: doors.length,
    dropped,
  };
}

// Replace a door that said no: drop it and rebuild with its sisters promoted to the front of the candidate list.
export function replan(doors, sisters, declinedIds, opts) {
  const no = new Set(declinedIds);
  const promoted = [];
  for (const id of declinedIds) for (const s of sisters[id] ?? []) if (!no.has(s)) promoted.push(s);
  const byId = new Map(doors.map((d) => [d.id, d]));
  const front = [...new Set(promoted)].map((id) => byId.get(id)).filter(Boolean);
  const rest = doors.filter((d) => !no.has(d.id) && !front.includes(d));
  return buildRoute(mergeKeepRank(rest, front), sisters, opts);
}

// Keep the anchors' rank order but make sure promoted sisters are considered right after the first door.
function mergeKeepRank(rest, front) {
  if (!front.length) return rest;
  const set = new Set(front.map((d) => d.id));
  const others = rest.filter((d) => !set.has(d.id));
  return [...others.slice(0, 1), ...front, ...others.slice(1)];
}

// ---------- the room-sound guard ----------
// A venue's artist list ("artists Qloo associates with this venue's crowd") is shown as "this room" only if it is
// plausible: (1) at least 3 of its top 10 artists share a specific (non-generic) genre with the reference set
// (the city's locality artists plus the brand's artists); (2) no more than 2 of the top 10 carry a locale genre
// (Ukrainian, K-pop, Punjabi…) absent from the reference set or a non-Latin-script name; (3) no door within 1 km
// shares 15 or more of the same top 20 (an inherited, area-level list). Otherwise the card shows the
// neighbourhood's sound, labelled as such. A failed list never reaches any pitch text.
const GENERIC = new Set(["pop", "rock", "electronic", "dance", "hip_hop", "rap", "r_b", "rhythm_blues", "pop_rock", "alternative_rock", "alternative", "dance_pop", "soul", "funk", "singer_songwriter", "singer_and_songwriter", "electronica", "adult_contemporary", "contemporary", "indie", "instrumental", "soundtrack", "acoustic",
  // junk tags that are not genres (Diolosa M2 review): they must never earn a "shared genre"
  "all", "usa", "us", "united_states", "america", "bandcamp", "seen_live", "favorites", "favourite", "00s", "90s", "80s", "70s", "60s", "male_vocalists", "female_vocalists", "beautiful", "chill", "love", "mellow", "alabama", "alaska", "arizona", "arkansas", "california", "colorado", "connecticut", "delaware", "florida", "georgia", "hawaii", "idaho", "illinois", "indiana", "iowa", "kansas", "kentucky", "louisiana", "maine", "maryland", "massachusetts", "michigan", "minnesota", "mississippi", "missouri", "montana", "nebraska", "nevada", "new_hampshire", "new_jersey", "new_mexico", "new_york", "north_carolina", "north_dakota", "ohio", "oklahoma", "oregon", "pennsylvania", "rhode_island", "south_carolina", "south_dakota", "tennessee", "texas", "utah", "vermont", "virginia", "washington", "west_virginia", "wisconsin", "wyoming"]);
const LOCALE = /(ukrain|russia|korea|k_pop|kpop|j_pop|jpop|japan|punjab|bhangra|bollywood|indian|hindi|tamil|telugu|turk|polish|arab|persian|chinese|mandopop|cantopop|thai|vietnam|filipin|opm|indonesia|greek|romania|serbia|bulgar|czech|hungar|french|german|schlager|italian|swedish|norweg|finnish|danish|dutch|brazil|portug|afrobeat|nigeria|ghana)/;
const slug = (s) => String(s).toLowerCase().replace(/&/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

export function artistGenres(a) {
  const out = new Set();
  for (const t of a?.tags ?? []) {
    if (/^urn:tag:(genre|subgenre):/.test(t.type ?? "") || /^urn:tag:(genre|subgenre):/.test(t.id ?? "")) out.add(slug(t.name ?? String(t.id).split(":").pop()));
  }
  for (const g of a?.genres ?? []) out.add(slug(g));
  return out;
}

export function trimArtist(a) {
  const sp = a.external?.spotify?.[0];
  return { id: a.entity_id ?? a.id, name: a.name, genres: [...artistGenres(a)].slice(0, 12), spotify: sp?.id ?? null, affinity: a.query?.affinity ?? null };
}

export function referenceGenres(lists) {
  const s = new Set();
  for (const list of lists) for (const a of list ?? []) for (const g of a.genres ?? artistGenres(a)) s.add(g);
  return s;
}

// Latin letters (Basic, Latin-1, Extended-A/B, Extended Additional), digits, spaces and common punctuation only.
const nonLatin = (name) => /[^\u0020-\u007E\u00A0-\u024F\u1E00-\u1EFF\u2010-\u201F\s]/.test(String(name ?? ""));

// Locale genres count as local only when the city's own lists (city + neighbourhoods) carry them on 3+ artists.
export function localeCounts(cityLists) {
  const m = new Map();
  for (const list of cityLists) for (const a of list ?? []) for (const g of a.genres ?? artistGenres(a)) if (LOCALE.test(g)) m.set(g, (m.get(g) ?? 0) + 1);
  return m;
}

// Artists that Qloo returns for many rooms across the city (≥10% of the door lists): the area's sound, not a room's.
export function commonArtists(lists, share = 0.1) {
  const freq = new Map();
  for (const l of lists) for (const id of new Set(l.slice(0, 10))) freq.set(id, (freq.get(id) ?? 0) + 1);
  const n = lists.length;
  const min = Math.max(3, Math.ceil(n * share)); // at least 3 rooms, so a 12-door live route is not over-flagged
  return new Set([...freq].filter(([, c]) => n >= 10 && c >= min).map(([id]) => id));
}

// Scene lists: when most of a room's artists come from one scene, the venue's own Qloo record (genre, name,
// crowd, ambience, description) must point to that scene, or the list is not this room's.
export const SCENES = [
  { key: "latin", label: "regional Mexican and Latin acts", artist: /(mexic|latin|spanish|banda|norte|tejano|cumbia|ranchera|mariachi|reggaeton|bachata|salsa|merengue|corrido|grupera|tropical|cuban|colombia)/, venue: /(mexic|latin|hispanic|latino|latina|taqueria|tex.?mex|cantina|mezcal|tequila|spanish|cuban|peru|salvador|colombia|venezuel|puerto ric|dominican|caribbean|salsa|cumbia|bachata|reggaeton|banda|norte)/i },
  { key: "christian", label: "Christian and worship acts", artist: /(christian|worship|gospel|ccm|praise)/, venue: /(church|christian|faith|gospel|worship|ministr)/i },
];
export function sceneOf(artists, need = 6) {
  const top = (artists ?? []).slice(0, 10);
  for (const sc of SCENES) {
    const n = top.filter((a) => [...(a.genres ? a.genres : artistGenres(a))].some((g) => sc.artist.test(g))).length;
    if (n >= need) return { ...sc, n };
  }
  return null;
}
export function venueText(v) {
  // the venue's identity fields only: a menu word ("taco") is not a scene (Diolosa R2)
  return [v?.name, v?.genre, v?.crowd, v?.ambience].filter(Boolean).join(" ");
}

export function guardSound(artists, refGenres, nearby = [], { minShared = 3, maxForeign = 2, inheritAt = 15, inheritKm = 1, locale = new Map(), common = new Set(), maxCommon = 4, cityName = "the city", venue = null } = {}) {
  const top = (artists ?? []).slice(0, 10);
  if (top.length < 5) return { pass: false, reason: "thin", detail: `only ${top.length} artists returned` };
  let shared = 0;
  let foreign = 0;
  const matched = new Set();
  for (const a of top) {
    const gs = a.genres ? new Set(a.genres) : artistGenres(a);
    const specific = [...gs].filter((g) => !GENERIC.has(g));
    const hit = specific.filter((g) => refGenres.has(g));
    if (hit.length) {
      shared++;
      hit.slice(0, 2).forEach((g) => matched.add(g));
    }
    const localeHit = [...gs].some((g) => LOCALE.test(g) && (locale.get(g) ?? 0) < 3);
    if (localeHit || nonLatin(a.name)) foreign++;
  }
  if (foreign > maxForeign) return { pass: false, reason: "locale", detail: `${foreign} of the top 10 come from a music scene ${cityName}'s own lists do not have`, shared, foreign };
  if (shared < minShared) return { pass: false, reason: "genre", detail: `only ${shared} of the top 10 share a specific genre with ${cityName}'s or the drinkers' artists`, shared, foreign };
  const sc = venue ? sceneOf(artists) : null;
  if (sc && !sc.venue.test(venueText(venue))) return { pass: false, reason: "scene", detail: `${sc.n} of the top 10 are ${sc.label}, and nothing in this door's own Qloo record points to that scene`, shared, foreign };
  const ids = (artists ?? []).slice(0, 20).map((a) => a.id);
  const nCommon = ids.slice(0, 10).filter((id) => common.has(id)).length;
  if (nCommon > maxCommon) return { pass: false, reason: "area", detail: `${nCommon} of the top 10 are artists Qloo returns for many doors across ${cityName}: the area's sound, not this door's`, shared, foreign };
  const twins = nearby.filter((n) => n.km <= inheritKm && overlap(ids, (n.artistIds ?? []).slice(0, 20)) >= inheritAt);
  if (twins.length) return { pass: false, reason: "inherited", detail: `shares 15+ of its top 20 with ${twins.map((t) => t.name ?? t.id).join(", ")} within 1 km`, shared, foreign, twins: twins.map((t) => t.id) };
  return { pass: true, reason: "ok", detail: `${shared} of the top 10 share genres with ${cityName}'s or the drinkers' artists (${[...matched].slice(0, 4).join(", ").replace(/_/g, " ")})`, shared, foreign };
}

// ---------- the template pitch ("At the door") ----------
// Three lines from the venue's own Qloo descriptions. Used when no model draft exists, and as the model's source.
// Words no pitch line may carry, model-drafted or template (no time axis, no claim about what a venue stocks).
// "pour" is the room's claim ("they pour X"); the rep pouring a taste ("Can I pour you one cold?", "pour whoever buys a
// taste", Jard 10-24 #5) is not, and passes.
export const BANNED_PITCH = /\b(this week|trending|rising|on the rise|hot right now|stocks?|pours?(?!\s+(?:you|whoever|it|one|a taste|for the team)\b)|poured|pour-over|carries|serves (our|your)|distribut)/i;
// Round 3 (lib/talk-gen.js g4): the hype half of BANNED_PITCH plus the slogan words, for the lines a model writes for a
// door. A rep says stock, pour, carry and distribute all day, so those are not held against a written line (its claims
// about what a room has are caught by talk-gen's own STOCK check instead).
export const BANNED_HYPE = /\b(this week|trending|rising|on the rise|hot right now|partnership|small ask|synergy|game[- ]changer|elevate|curated)\b/i;
// Doors' wording rules (test/honesty.test.mjs §9.8) for lines a model writes (lib/talk-gen.js): say "drink like"; no score
export const BANNED_WORDING = /people\swho\slike\b|\bcomposite\b|\b(door|venue|room) score\b/i;
// The guard is for Doors' own words: a claim about what a room stocks or pours. A rep's own typed words (their ask,
// "what you make", their support, brand and name: "a mezcal pour for the bar team", "pour-over coffee") are theirs and
// are kept verbatim, so they are taken out of a line before it is tested (owner review 8).
export function bannedOwn(line, own = []) {
  let t = String(line ?? "");
  for (const w of own) { const x = String(w ?? "").trim(); if (x.length >= 2) t = t.split(x).join("Yours"); }
  return BANNED_PITCH.test(t);
}

// First sentence of a venue description that carries no banned word (a description saying "rising" or "trending"
// never prints as a claim: the next clean sentence is used, or none).
export function cleanSentence(text) {
  if (!text) return "";
  const parts = String(text).match(/[^.!?]+[.!?]*/g) ?? [String(text)];
  for (const p of parts) {
    const t = firstSentence(p.trim());
    if (t && !BANNED_PITCH.test(t)) return t;
  }
  return "";
}

export function templatePitch(v) {
  const lines = [];
  const crowd = cleanSentence(v.crowd);
  if (crowd) lines.push({ label: "Crowd", text: crowd.replace(/^The (clientele|crowd|customer base|demographic) (consists primarily of|is primarily|is|includes)\s*/i, (m) => m), source: "customer_demographics_description" });
  const room = cleanSentence(v.ambience);
  if (room) lines.push({ label: "Room", text: room, source: "ambience_description" });
  const hooks = [];
  if (v.liveMusic) hooks.push("live music");
  if (v.goodFor?.length) hooks.push(`good for ${v.goodFor.slice(0, 3).join(", ").toLowerCase()}`);
  const dishes = (v.dishes ?? []).filter((d) => !BANNED_PITCH.test(d));
  if (dishes.length) hooks.push(`known for ${dishes.slice(0, 2).join(" and ")}`);
  if (hooks.length) lines.push({ label: "Angle", text: hooks.join(" · ").replace(/^./, (c) => c.toUpperCase()), source: ["live_music", "good_for", "specialty_dishes"].filter((k, i) => [v.liveMusic, v.goodFor?.length, dishes.length][i]).join(", ") });
  if (!lines.length && cleanSentence(v.description)) lines.push({ label: "Room", text: cleanSentence(v.description), source: "description" });
  // the banned-word check applies to template lines too ("Known for Pour Over Coffee" must not ship)
  return { lines: lines.filter((l) => !BANNED_PITCH.test(l.text)).slice(0, 3), by: "template" };
}

// ---------- labels ----------
export const priceLabel = (p) => (p ? "$".repeat(Math.max(1, Math.min(4, Math.round(p)))) : null);
export const fmtAffinity = (a) => (typeof a === "number" ? a.toFixed(3) : "—");
// R9 polish (judge walkthrough 3): Qloo's affinity beside a rank, so a flat list reads flat. "#49 of 55" alone reads as
// "a bad room" when #49 is 0.90 and #1 is 0.91: → "affinity 0.90, 0.01 below #1" | "affinity 0.91, the top match" |
// "affinity 0.90, level with #1" (gap under 0.005). top: #1's affinity; merged (2+ drinker lists): no gap, the lists'
// scores aren't on one scale. "" without an affinity.
export function affinityGap({ affinity, top = null, rank = null, merged = false } = {}) {
  if (typeof affinity !== "number" || !Number.isFinite(affinity)) return "";
  // round 3 (Jard 10-23: decimals are "super confusing"): the gap to #1 in words, never Qloo's 0-1 number
  if (merged || typeof top !== "number" || !rank) return "";
  if (rank === 1) return "the closest match";
  const gap = top - affinity;
  return gap < 0.005 ? "level with #1" : gap <= NEAR_LEVEL ? "near-level with #1" : "";
}
// Qloo's popularity (0-1, a percentile in the city) in the rep's words, never the number (round 3, Jard 10-23)
export const popWords = (p) => (typeof p !== "number" || !Number.isFinite(p) ? "" : p >= 0.9 ? "one of the city's most popular doors" : p >= 0.6 ? "well known" : p >= 0.3 ? "known locally" : "almost unknown");
// Judge pass 2 (14): a rank alone overstates precision (Chicago's 126 rooms sit within 0.03 of #1), so a label leads
// with the tier the affinity supports: "top match" (#1), "near-level with #1" (under 0.02 below it), "top 10", or none.
export const NEAR_LEVEL = 0.02;
export function matchTier({ affinity, top = null, rank = null, merged = false } = {}) {
  if (!rank) return "";
  if (rank === 1) return "#1";
  if (!merged && typeof affinity === "number" && typeof top === "number" && top - affinity < NEAR_LEVEL) return "near-level with #1";
  return rank <= 10 ? "top 10" : "";
}
export const dayShort = (d) => (d ? d.slice(0, 3).replace(/^./, (c) => c.toUpperCase()) : "");
export const dayLong = (d) => (d ? d.replace(/^./, (c) => c.toUpperCase()) : "");
export const NA_BRANDS = new Set(["athletic-brewing", "liquid-death", "lacroix"]);
// The held brands' categories (public/data/index.json brands[].category; a test keeps them equal). Talking points name a
// brand's category only from here, never the product's (R9 proof finding 2: Casamigos is a tequila, not a mezcal).
export const BRAND_CATEGORY = { "athletic-brewing": "Non-alcoholic craft beer", casamigos: "Tequila", "don-julio": "Tequila", espolon: "Tequila", teremana: "Tequila", "liquid-death": "Canned water", lacroix: "Sparkling water", "white-claw": "Hard seltzer" };
