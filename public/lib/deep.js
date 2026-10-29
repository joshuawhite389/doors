// Round 3, lane deep (Jard 10-25 evening): the per-door MARKET RESEARCH layer, the way a researcher preps a rep for one
// door. The measured lean ("its crowd drinks whiskey 5× the city") is one layer; this goes deeper, in four layers, and
// every line answers "so what" for the pitch, the owner's business or the conversation:
//   1. THE GAP: what the door's own site or menu lists (lib/enrich.js site facts) against what its crowd buys (Qloo with
//      the door as the signal, vsCity) in the rep's own category. Pinthouse: its crowd sits high for non-alcoholic
//      beer drinkers, it brews its own beer, and the only non-alcoholic thing on its site is a root beer float.
//   2. NEIGHBOURS: the doors that share its crowd (the city file's sisters) and the doors within 1 km, and what their
//      own sites list in the rep's category that this door's doesn't ("3 doors with this crowd within 1 km list a
//      non-alcoholic beer; this one lists none").
//   3. THE OWNER'S WEEK: hours by day, when Qloo puts its crowd, its happy hour and recurring events, and from those the
//      likely quiet window (when to walk in, and the slot the owner wants fuller).
//   4. THE ROOM'S OCCASION: the age skew against the city's bars and Qloo's visit tags, which shape the occasion only
//      (a drink claim rests on evidence; a demographic never says what people drink).
// Honesty rules, in code: a fact is built only from fields that are there (src names them); "its site lists none" is
// said as what the site shows on the day it was read, never as what the bar has (absence on a site ≠ absence in the
// bar: the so-what asks); "likely" marks every inference; brand names, other doors' names and age words make a line
// prep-only (for the rep's eyes, never said in the room: OPENERS-RESEARCH §2, talk-gen's avoid list).
//
// deepFacts(record, ctx) → [{label, text, prep?, from?, kind, score, why, src}], best first, the same line shape as
// enrichFacts (talk-gen's D facts; the Agent's insight lines). record = the door's enrichment record (full or slim).
// ctx = {venue, id, profile, routes, plan, city, enrich, venues, near, now}, every key optional:
//   venue    the door's place record (hours, tags.tod/visit, lat/lon, popularity, name)
//   profile  the rep's profile (brand, what, drinks); routes: the drinker routes (routes[0].drinker, lists.all)
//   city     the city file (sisters, sisterVenues); plan: the published plan (venues, pool)
//   enrich   {id: record} for the city's other enriched doors (neighbours' sites); venues: {id: place} for coordinates
//   near     {id: [[nid, km, sister]]} baked by scripts/deep-bake.mjs over every route file (else computed from venues)
// Pure: no DOM, no fetch, no model. Deterministic. Covered by test/deep.test.mjs (synthetic) and test/deep-data.test.mjs
// (golden doors: Pinthouse, Sagebrush, Nomadic, Hold Out).
import { parseHours, DAYS, km } from "./core.js";
import { crowdTimes, TOD_CLOCK } from "./culture.js";
import { fold } from "./drinks.js";
import { vsWhere, vsFew } from "./enrich.js";

export const DEEP_VERSION = 1;
export const DEEP_MAX = 6; // lines per door at most; fewer when the facts are thin
export const NEAR_KM = 1; // "nearby" = within 1 km
export const NEAR_MAX = 12; // neighbours kept per door

const str = (x) => (typeof x === "string" ? x.trim() : x == null ? "" : String(x).trim());
const uniq = (xs) => [...new Set(xs.filter(Boolean))];
const and = (xs) => (xs.length <= 1 ? xs[0] ?? "" : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
const r1 = (x) => Math.round(x * 10) / 10;
const times = (lift) => (lift >= 10 ? `${Math.round(lift)}×` : `${r1(lift)}×`);
const end = (s) => (/[.!?]$/.test(s) ? s : `${s}.`);
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// ---------- the rep's category ----------
// From what the rep makes (profile.what) and the drinker brand's category (routes[0].drinker.category, index.json):
// → {cat, cats, words, plural, na, soft, brands}. cat: one of lib/enrich.js DRINK_CATS, or "soft" (a sparkling water,
// a soda: Qloo has no drink category for it, so the crowd side of the gap is empty and only sites count).
const NA_WORD = /\b(non-?alcoholic|alcohol-?free|zero-?proof|\bna\b|n\/a|0\.0%?|0\.5%|dealcoholi[sz]ed|booze-?free)\b/i;
const SOFT_WORD = /\b(sparkling water|mineral water|seltzer water|soda water|tonic water|canned water|spring water|still water|\bwater\b|soda|cola|root beer|ginger beer|ginger ale|coffee|cold brew|espresso|\btea\b|matcha|yerba|kombucha|juice|lemonade|energy drink|hop water)\b/i;
const CAT_RULES = [
  ["RTD", /\b(hard (seltzer|tea|kombucha|lemonade|soda|cider soda|coffee)|seltzer(?! water)|canned cocktail|ready[- ]to[- ]drink|\brtd\b|spiked)\b/i],
  ["cider", /\bciders?\b/i],
  ["tequila", /\b(tequila|mezcal|agave)\b/i],
  ["whiskey", /\b(whisk(e)?y|bourbon|\brye\b|scotch)\b/i],
  ["vodka", /\bvodka\b/i],
  ["spirits", /\b(gin|rum|spirits?|liqueur|amaro|aperitif|aperitivo|brandy|cognac|absinthe)\b/i],
  ["wine", /\b(wine|ros[eé]|prosecco|champagne|cava|sake|vermouth)\b/i],
  ["craft beer", /\b(beer|ipa|lager|ales?|stout|pils(ner)?|porter|hazy|k[oö]lsch|\bsour\b|wheat|saison|brew)\b/i],
];
const CAT_WORDS = {
  "non-alcoholic": ["a non-alcoholic beer", "non-alcoholic beer"],
  RTD: ["a hard seltzer or canned cocktail", "hard seltzers and canned cocktails"],
  cider: ["a cider", "cider"],
  tequila: ["a tequila", "tequila"],
  whiskey: ["a whiskey", "whiskey"],
  vodka: ["a vodka", "vodka"],
  spirits: ["a spirit", "spirits"],
  wine: ["a wine", "wine"],
  "craft beer": ["a beer", "beer"],
  soft: ["a soft drink", "soft drinks"],
};
export function repCategory({ profile = {}, routes = [] } = {}) {
  const drinker = routes?.[0]?.drinker ?? null;
  const what = str(profile?.what);
  const text = [what, str(drinker?.category)].filter(Boolean).join(" ");
  const brands = uniq([str(profile?.brand), ...(profile?.drinks ?? []).map((d) => str(d?.name)), str(drinker?.name), str(drinker?.qlooName)]);
  const na = (NA_WORD.test(text) || drinker?.na === true || profile?.product?.na === true) && !(SOFT_WORD.test(what) && !NA_WORD.test(what));
  if (na && !SOFT_WORD.test(what)) {
    const beer = CAT_RULES.find(([c]) => c === "craft beer")[1].test(text);
    const kind = CAT_RULES.find(([c, re]) => c !== "craft beer" && re.test(text))?.[0] ?? null;
    const noun = beer ? "beer" : kind === "spirits" || kind === "tequila" || kind === "whiskey" || kind === "vodka" ? "spirit" : kind === "wine" ? "wine" : kind === "RTD" ? "canned cocktail" : null;
    return { cat: "non-alcoholic", cats: ["non-alcoholic"], words: noun ? `a non-alcoholic ${noun}` : "a non-alcoholic option", plural: noun ? `non-alcoholic ${noun}s` : "non-alcoholic options", na: true, soft: false, brands };
  }
  if (SOFT_WORD.test(text) && !CAT_RULES.slice(0, 7).some(([, re]) => re.test(text))) {
    const w = /sparkling|seltzer water|soda water|mineral|tonic/i.test(text) ? ["a sparkling water", "sparkling waters"] : /water/i.test(text) ? ["a canned water", "bottled or canned waters"] : /coffee|cold brew|espresso/i.test(text) ? ["a cold coffee", "cold coffees"] : /kombucha/i.test(text) ? ["a kombucha", "kombuchas"] : /tea|matcha|yerba/i.test(text) ? ["an iced tea", "teas"] : /energy/i.test(text) ? ["an energy drink", "energy drinks"] : CAT_WORDS.soft;
    return { cat: "soft", cats: [], words: w[0], plural: w[1], na: false, soft: true, brands };
  }
  for (const [cat, re] of CAT_RULES) if (re.test(text)) return { cat, cats: cat === "craft beer" ? ["craft beer", "beer"] : [cat], words: CAT_WORDS[cat][0], plural: CAT_WORDS[cat][1], na: false, soft: false, brands };
  return { cat: null, cats: [], words: "it", plural: "this kind of drink", na: false, soft: false, brands };
}

// ---------- what a site lists, by category ----------
// Site facts (lib/enrich.js SITE_KEYS) that name a drink of the category. Brand lists are for naming the rival on the
// site ("lists Rationale"), not for deciding: the words decide. A root beer float, a coffee or a THC seltzer is not a
// non-alcoholic beer (owner review 8 N2: a soft drink is never the alcohol-free option).
const NA_BRANDS = ["Athletic Brewing", "Athletic", "Best Day", "Rationale", "Heineken 0.0", "Guinness 0.0", "Guinness 0", "Untitled Art", "Partake", "Bravus", "Go Brewing", "Just the Haze", "Sunbrew", "Budweiser Zero", "Bud Zero", "Clausthaler", "Hoppy Refresher", "Hoplark", "Special Effects", "Bitburger Drive", "Peroni 0.0", "Stella Artois Liberté", "Kaliber", "O'Doul's", "Odouls", "Trail Pass", "Two Roots", "Surreal", "Ceria", "WellBeing", "Gruvi", "Al's", "Big Drop", "Mash Gang", "Lucky Saint", "Erdinger Alkoholfrei", "Brooklyn Special Effects", "Sierra Nevada Trail Pass", "Corona Non-Alcoholic", "Sam Adams Just the Haze", "Michelob Ultra Zero", "Coors Edge", "Busch NA", "Beck's Blue", "Curious Elixirs", "Ghia", "Seedlip", "Ritual Zero", "Lyre's", "Kin Euphorics", "Monday Gin", "Spiritless", "Free Spirits", "Wilderton", "Pathfinder", "De Soi", "Hiyo", "Casamara"];
const TEQUILA_BRANDS = ["Casamigos", "Don Julio", "Espolòn", "Espolon", "Teremana", "Patrón", "Patron", "Herradura", "Jose Cuervo", "Cuervo", "Código 1530", "Codigo", "Camarena", "1800", "Hornitos", "Fortaleza", "Siete Leguas", "Clase Azul", "818", "Milagro", "Cazadores", "Olmeca Altos", "Altos", "El Jimador", "Lunazul", "Avión", "Avion", "Volcan", "Mijenta", "Cincoro", "Del Maguey", "Montelobos", "Ilegal", "Banhez", "Los Vecinos"];
const WHISKEY_BRANDS = ["Bulleit", "Maker's Mark", "Makers Mark", "Jack Daniel's", "Jack Daniels", "Jameson", "Buffalo Trace", "Woodford", "Knob Creek", "Wild Turkey", "Four Roses", "Stillhouse", "TINCUP", "Tincup", "Pendleton", "Crown Royal", "Jim Beam", "Elijah Craig", "Angel's Envy", "Basil Hayden", "Michter's", "Garrison Brothers", "Balcones", "Still Austin", "Tullamore", "Redbreast", "Macallan", "Glenlivet", "Johnnie Walker", "High West", "Uncle Nearest", "Old Forester", "Evan Williams", "Rittenhouse", "Sazerac", "Fireball", "Skrewball"];
const VODKA_BRANDS = ["Tito's", "Titos", "Grey Goose", "Ketel One", "Ketel", "Absolut", "Smirnoff", "Belvedere", "Chopin", "Deep Eddy", "Dripping Springs", "Stoli", "Stolichnaya", "Cîroc", "Ciroc", "Western Son", "Wheatley", "Haku", "New Amsterdam", "Svedka"];
const RTD_BRANDS = ["White Claw", "High Noon", "Truly", "Cutwater", "NÜTRL", "Nutrl", "On The Rocks", "Twisted Tea", "Vizzy", "Bud Light Seltzer", "Topo Chico Hard Seltzer", "Ranch Water", "Lone River", "Karbach Ranch Water", "June Shine", "JuneShine", "Surfside", "Sun Cruiser", "BeatBox", "Austin Cocktails", "Tip Top", "Post Meridiem", "Two Chicks", "Cayman Jack", "Mike's Hard", "Smirnoff Ice", "Happy Dad", "Long Drink", "Carbliss", "Crook & Marker", "Mom Water", "Bev"];
const CIDER_BRANDS = ["Austin Eastciders", "Eastciders", "Angry Orchard", "Ace Cider", "2 Towns", "City Orchard", "Western Cider", "Bold Rock", "Woodchuck", "Strongbow", "Stem Ciders", "Schilling", "Golden State", "Shacksbury", "Texas Keeper", "Argus", "Fairweather", "Blake's", "Virtue Cider", "Original Sin", "Downeast", "Citizen Cider"];
const WATER_BRANDS = ["Topo Chico", "LaCroix", "La Croix", "Liquid Death", "Rambler", "Waterloo", "Richard's Rainwater", "Mountain Valley", "Perrier", "San Pellegrino", "Pellegrino", "Spindrift", "Evian", "Fiji", "Smartwater", "Aquafina", "Dasani", "Bubly", "Polar Seltzer"];
const SODA_BRANDS = ["Maine Root", "Mexican Coke", "Coca-Cola", "Coke", "Pepsi", "Dr Pepper", "Sprite", "Fever-Tree", "Q Mixers", "Olipop", "Poppi", "Boylan", "Jarritos", "Fentimans"];
const SOFT_BRANDS = [...WATER_BRANDS, ...SODA_BRANDS, "Red Bull", "Celsius", "Health-Ade", "GT's"];
const SOFT_KINDS = [
  [/sparkling|seltzer water|soda water|mineral|tonic/i, { re: /\b(sparkling water|mineral water|seltzer water|soda water|club soda|tonic water|sparkling)\b/i, brands: WATER_BRANDS }],
  [/water/i, { re: /\b(sparkling water|mineral water|seltzer water|soda water|club soda|bottled water|spring water|canned water|still water)\b/i, brands: WATER_BRANDS }],
  [/coffee/i, { re: /\b(coffee|cold brew|espresso|latte|nitro coffee)\b/i, brands: [] }],
  [/kombucha/i, { re: /\bkombucha\b/i, brands: ["Health-Ade", "GT's"] }],
  [/tea/i, { re: /\b(iced tea|sweet tea|\bteas?\b|matcha|yerba)\b/i, brands: [] }],
  [/energy/i, { re: /\benergy drinks?\b/i, brands: ["Red Bull", "Celsius", "Monster"] }],
];
const CAT_SITE = {
  "non-alcoholic": { re: /\b(non-?alcoholic|alcohol-?free|zero-?proof|spirit-?free|booze-?free|\bna\b|n\/a|0\.0|0\.5%|dealcoholi[sz]ed|mocktails?|hop water|hopped water|nonalcoholic)\b/i, brands: NA_BRANDS, not: /\b(root beer|float|coffee|cold brew|espresso|lemonade|iced tea|juice|soda|sparkling water|thc|cbd|delta-?[89]|kombucha|energy)\b/i },
  tequila: { re: /\b(tequila|mezcal|margaritas?|palomas?|ranch water|agave)\b/i, brands: TEQUILA_BRANDS },
  whiskey: { re: /\b(whisk(e)?y|bourbon|\brye\b|scotch|old fashioned|manhattan|whiskey sour|boilermaker)\b/i, brands: WHISKEY_BRANDS },
  vodka: { re: /\b(vodka|moscow mule|vodka soda|cosmopolitan|bloody mary|easy mary)\b/i, brands: VODKA_BRANDS },
  RTD: { re: /\b(hard seltzers?|seltzers?(?! water)|canned cocktails?|ready[- ]to[- ]drink|hard tea|hard kombucha|spiked)\b/i, brands: RTD_BRANDS },
  cider: { re: /\bciders?\b/i, brands: CIDER_BRANDS },
  wine: { re: /\b(wines?|ros[eé]|prosecco|champagne|cava|sangria|spritz|frizzante|cabernet|pinot|chardonnay|sauvignon|merlot|riesling|by the glass|sommelier|natural wine)\b/i, brands: [] },
  spirits: { re: /\b(gin|rum|spirits|liqueur|amaro|aperol|campari|cocktails?|full bar|back bar|well drinks)\b/i, brands: [] },
  "craft beer": { re: /\b(beers?|ipa|lagers?|ales?|stouts?|pils(ner)?|porter|hazy|k[oö]lsch|draft|draught|taps?|on tap|brews?|brewery|crowlers?|pints?)\b/i, brands: [] },
  beer: { re: /\b(beers?|ipa|lagers?|ales?|stouts?|pils(ner)?|porter|hazy|k[oö]lsch|draft|draught|taps?|on tap|brews?|brewery|crowlers?|pints?)\b/i, brands: [] },
  soft: { re: /\b(sparkling water|mineral water|seltzer water|soda water|tonic|canned water|spring water|bottled water|sodas?|cola|root beer|ginger beer|ginger ale|coffee|cold brew|espresso|iced tea|\bteas?\b|lemonade|juice|kombucha|energy drinks?)\b/i, brands: SOFT_BRANDS },
};
const EVENT_WORD = /\b(trivia|live music|music|bands?|dj|nights?|club|markets?|lessons?|league|bingo|karaoke|game ?days?|watch part(y|ies)|brunch|run|comedy|open mic|tastings?|festival|party|parties|show|concert|dancing|dance)\b/i;
const DRINK_KEYS = ["house_drinks", "drinks", "non_alcoholic", "taps", "brews_own", "happy_hour", "other", "food"];
const siteFacts = (rec) => (rec?.site?.ok && Array.isArray(rec.site.facts) ? rec.site.facts.filter((f) => f && typeof f.text === "string") : []);
const hasWord = (text, w) => { const f = fold(w); return Boolean(f) && ` ${fold(text)} `.includes(` ${f} `); };
const brandsIn = (text, list) => list.filter((b) => hasWord(text, b));
// "Root beer float made with Maine Root root beer is on the pizza menu." → "a root beer float"; "Also lists cold brew
// coffee, iced tea and lemonade." → "cold brew coffee, iced tea and lemonade"
const noun = (t) => {
  let s = str(t).replace(/\.$/, "").replace(/^(it |they |also |the menu |the site )?(lists?|offers?|serves?|has|have|sells?|carries|pours?|stocks?)\s+/i, "");
  s = s.split(/\s+(?:made with|is|are|on the|available|served|comes?)\b/i)[0].trim();
  s = s.replace(/^(a|an|the)\s+/i, "");
  s = short(s, 70);
  return /^[A-Z][a-z]/.test(s) && !/^[A-Z][a-z]+ [A-Z]/.test(s) ? `${/^[aeiou]/i.test(s) ? "an" : "a"} ${s[0].toLowerCase()}${s.slice(1)}` : s;
};
const short = (s, n = 110) => (s.length <= n ? s : `${s.slice(0, n - 1).replace(/[,;:\s]+\S*$/, "")}…`);
// → {carries: [{k, text, brands, i}], near: [{k, text, i}] (the category's key, but not the category: a root beer float
// under non_alcoholic), read: "2026-10-25" | null, url}
export function siteCarries(rec, cat, rc = null) {
  const rule = cat === "soft" && rc?.words ? SOFT_KINDS.find(([re]) => re.test(rc.words))?.[1] ?? CAT_SITE.soft : CAT_SITE[cat] ?? null;
  const facts = siteFacts(rec);
  const out = { carries: [], near: [], read: rec?.site?.fetched ?? null, url: rec?.site?.url ?? null, facts: facts.length };
  if (!rule) return out;
  facts.forEach((f, i) => {
    if (!DRINK_KEYS.includes(f.k)) return;
    const t = f.text;
    const named = brandsIn(t, rule.brands);
    const hit = rule.re.test(t) || named.length > 0;
    const isNaKey = cat === "non-alcoholic" && f.k === "non_alcoholic";
    if (hit && !(isNaKey && !named.length && rule.not && rule.not.test(t) && !/\b(na beer|non-?alcoholic beer|0\.0|zero-?proof beer|alcohol-?free beer|hop water)\b/i.test(t))) out.carries.push({ k: f.k, text: t, brands: named, i });
    else if (isNaKey) out.near.push({ k: f.k, text: t, i });
  });
  return out;
}
// the rep's own brand on the door's site (a reorder, not a cold pitch)
export function siteNames(rec, brands = []) {
  const facts = siteFacts(rec);
  const hits = [];
  facts.forEach((f, i) => { for (const b of brands) if (b && b.length >= 3 && hasWord(f.text, b)) hits.push({ brand: b, text: f.text, i }); });
  return hits;
}

// ---------- what the crowd buys, in the rep's category (Qloo) ----------
// → {strength: 0–3, cats: [{cat, lift}], drinks: [{name, cat, lift?}], own: [names of the rep's brands in its list],
//    basis, src[]}. Door basis only counts as the door's own crowd; area basis is its part of town (said so, prep).
export function crowdBuys(rec, rc) {
  const q = rec?.qloo ?? null;
  const v = rec?.vsCity ?? null;
  const cats = rc?.cats ?? [];
  const out = { strength: 0, basis: q?.basis ?? "none", cats: [], drinks: [], rare: [], own: [], src: [] };
  if (!q || !cats.length) return out;
  const inCat = (b) => cats.includes(b?.cat);
  if (q.basis === "door" && v) {
    out.cats = (v.cats ?? []).filter((c) => cats.includes(c.cat)).map((c) => ({ cat: c.cat, lift: c.lift }));
    out.rare = (v.drinks ?? []).filter(inCat).map((b) => ({ name: b.name, cat: b.cat, lift: b.lift }));
    if (out.cats.length) out.src.push("vsCity.cats");
    if (out.rare.length) out.src.push("vsCity.drinks");
  }
  out.drinks = (q.drinks ?? []).filter(inCat).map((b) => ({ name: b.name, cat: b.cat }));
  if (out.drinks.length) out.src.push("qloo.drinks");
  out.own = out.drinks.filter((b) => (rc.brands ?? []).some((n) => n.length >= 3 && (hasWord(b.name, n) || hasWord(n, b.name)))).map((b) => b.name);
  if (q.basis === "door") out.strength = out.cats.length ? 3 : out.rare.length || out.own.length ? 2 : out.drinks.length ? 1 : 0;
  else if (q.basis === "area") out.strength = out.drinks.length ? 1 : 0;
  return out;
}
// The door's place on the rep's list: the plan's pool (the ranked list the rep sees, its real size) first, else the
// routes' lists (lists.all: [[id, affinity, …]]) → {who, rank, N} | null
export function listRank(routes = [], id, plan = null) {
  const ids = Array.isArray(plan?.pool?.ids) ? plan.pool.ids : null;
  if (ids) {
    const i = ids.indexOf(id);
    if (i >= 0) return { who: routes?.[0]?.drinker?.name ? `${routes[0].drinker.name} drinkers` : "your drinkers", rank: i + 1, N: Number.isFinite(plan.pool.N) ? plan.pool.N : ids.length };
  }
  for (const r of routes ?? []) {
    const rows = r?.lists?.all ?? [];
    const i = rows.findIndex((row) => (Array.isArray(row) ? row[0] : row?.id) === id);
    if (i >= 0) return { who: r?.drinker?.name ? `${r.drinker.name} drinkers` : "your drinkers", rank: i + 1, N: rows.length };
  }
  return null;
}

// ---------- neighbours ----------
// The city's coordinates for doors: the plan's venues, the routes' venues, the city file's sister venues.
export function venueMap({ plan = null, routes = [], city = null, venues = null } = {}) {
  const out = {};
  const add = (v) => { if (v?.id && v.lat != null && v.lon != null && !out[v.id]) out[v.id] = v; };
  for (const v of Object.values(venues ?? {})) add(v);
  for (const v of Object.values(plan?.venues ?? {})) add(v);
  for (const r of routes ?? []) for (const v of Object.values(r?.venues ?? {})) add(v);
  for (const v of Object.values(city?.sisterVenues ?? {})) add(v);
  return out;
}
// → [[nid, km, sister(0|1)]] nearest first, sisters first among equals; only doors with an enrichment record.
export function nearDoors(id, { enrich = {}, venues = {}, city = null, near = null } = {}) {
  if (near?.[id]) return near[id].filter((r) => enrich?.[r[0]]).slice(0, NEAR_MAX);
  const me = venues?.[id];
  const sis = new Map((city?.sisters?.[id] ?? []).map((r) => [Array.isArray(r) ? r[0] : r, 1]));
  const rows = [];
  for (const nid of Object.keys(enrich ?? {})) {
    if (nid === id) continue;
    const v = venues?.[nid];
    const d = me && v ? km(me, v) : Infinity;
    if (d <= NEAR_KM || sis.has(nid)) rows.push([nid, Number.isFinite(d) ? Math.round(d * 100) / 100 : null, sis.has(nid) ? 1 : 0]);
  }
  return rows.sort((a, b) => b[2] - a[2] || (a[1] ?? 9) - (b[1] ?? 9)).slice(0, NEAR_MAX);
}

// ---------- the owner's week ----------
const DAY_SHORT = { monday: "Mon", tuesday: "Tue", wednesday: "Wed", thursday: "Thu", friday: "Fri", saturday: "Sat", sunday: "Sun" };
const clock = (min) => {
  const m = ((min % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (m === 0) return "midnight";
  if (m === 720) return "noon";
  return `${h % 12 || 12}${mm ? `:${String(mm).padStart(2, "0")}` : ""} ${h < 12 ? "am" : "pm"}`;
};
// runs of days with the same value → "Mon–Thu", "Fri–Sat and Sun"
const runs = (days) => {
  const idx = days.map((d) => DAYS.indexOf(d)).filter((i) => i >= 0).sort((a, b) => a - b);
  const out = [];
  for (const i of idx) {
    const last = out.at(-1);
    if (last && last[1] === i - 1) last[1] = i;
    else out.push([i, i]);
  }
  const parts = out.flatMap(([a, b]) => (b - a >= 2 ? [`${DAY_SHORT[DAYS[a]]}–${DAY_SHORT[DAYS[b]]}`] : DAYS.slice(a, b + 1).map((d) => DAY_SHORT[d])));
  return and(parts);
};
// → {ok, closed: [days], opens: {time: [days]}, late: [days] (past midnight), weekdayOpen, weekendOpen, text}
export function weekShape(hours) {
  const p = parseHours(hours);
  const out = { ok: p.ok, closed: [], opens: {}, late: [], weekdayOpen: null, weekendOpen: null, text: null };
  if (!p.ok) return out;
  for (const d of DAYS) {
    const day = p.days[d];
    if (!day) continue;
    if (day.closed || !day.spans.length) { out.closed.push(d); continue; }
    const first = Math.min(...day.spans.map((s) => s.from));
    const lastTo = Math.max(...day.spans.map((s) => s.to));
    (out.opens[first] ??= []).push(d);
    if (lastTo > 1440) out.late.push(d);
  }
  const wk = ["monday", "tuesday", "wednesday", "thursday"].map((d) => p.days[d]).filter((d) => d && !d.closed && d.spans.length).map((d) => Math.min(...d.spans.map((s) => s.from)));
  const we = ["saturday", "sunday"].map((d) => p.days[d]).filter((d) => d && !d.closed && d.spans.length).map((d) => Math.min(...d.spans.map((s) => s.from)));
  const mode = (xs) => (xs.length ? Number([...xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map())].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0]) : null);
  out.weekdayOpen = mode(wk);
  out.weekendOpen = mode(we);
  const parts = [];
  if (out.closed.length) parts.push(`closed ${runs(out.closed)}`);
  const opens = Object.entries(out.opens).sort((a, b) => b[1].length - a[1].length);
  if (opens.length === 1) parts.push(`opens ${clock(Number(opens[0][0]))} every day it's open`);
  else if (opens.length) parts.push(opens.slice(0, 3).map(([t, ds]) => `opens ${clock(Number(t))} ${runs(ds)}`).join(", "));
  if (out.late.length && out.late.length < 7) parts.push(`open past midnight ${runs(out.late)}`);
  out.text = parts.length ? parts.join("; ") : null;
  return out;
}
// Happy hour days and times out of a site fact ("Happy hour Mon-Fri 3pm-6pm: $5 pints") → {days, from, to, text} | null
const DAY_RE = /\b(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*\b/gi;
const DAY_KEY = { mon: "monday", tue: "tuesday", wed: "wednesday", thu: "thursday", fri: "friday", sat: "saturday", sun: "sunday" };
const TIME_RE = /(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\s*(?:-|–|—|to|until|till|through)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?/i;
const toMin = (h, m, ap, fallbackAp) => {
  let hh = Number(h);
  const a = (ap ?? fallbackAp ?? "").replace(/\./g, "").toLowerCase();
  if (a === "pm" && hh < 12) hh += 12;
  if (a === "am" && hh === 12) hh = 0;
  if (!a && hh <= 11 && hh >= 1) hh += 12; // "3-6" at a bar is the afternoon
  return hh * 60 + Number(m ?? 0);
};
export function parseWhen(text) {
  const s = str(text);
  const dayHits = [...s.matchAll(DAY_RE)].map((m) => DAY_KEY[m[1].slice(0, 3).toLowerCase()]).filter(Boolean);
  let days = uniq(dayHits);
  // "Mon-Fri" / "Mon to Fri" → the run
  const span = /\b(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*\s*(?:-|–|—|to|through|thru)\s*(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)[a-z]*\b/i.exec(s);
  if (span) {
    const a = DAYS.indexOf(DAY_KEY[span[1].slice(0, 3).toLowerCase()]);
    const b = DAYS.indexOf(DAY_KEY[span[2].slice(0, 3).toLowerCase()]);
    if (a >= 0 && b >= 0) days = uniq([...DAYS.slice(a, b >= a ? b + 1 : 7), ...(b < a ? DAYS.slice(0, b + 1) : []), ...days]);
  }
  if (/\b(daily|every day|everyday|all week|7 days)\b/i.test(s)) days = [...DAYS];
  if (/\bweekdays?\b/i.test(s)) days = uniq([...days, ...DAYS.slice(0, 5)]);
  if (/\bweekends?\b/i.test(s)) days = uniq([...days, "saturday", "sunday"]);
  const t = TIME_RE.exec(s);
  let from = null;
  let to = null;
  if (t) {
    to = toMin(t[4], t[5], t[6], null);
    from = toMin(t[1], t[2], t[3], t[6]);
    if (to <= from) to += 720; // "11-2" → 11 am to 2 pm or 11 pm to 2 am; keep the shorter reading
    if (to - from > 720) to -= 720;
  } else {
    const one = /\b(?:at|from|starting|starts)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\b/i.exec(s) ?? /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)\b/i.exec(s);
    if (one) from = toMin(one[1], one[2], one[3], null);
  }
  if (!days.length && from == null) return null;
  const sorted = DAYS.filter((d) => days.includes(d));
  return { days: sorted, from, to, text: [sorted.length ? runs(sorted) : null, from != null && to != null ? `${clock(from)}–${clock(to)}` : from != null ? clock(from) : null].filter(Boolean).join(" ") || null };
}
// The likely quiet window: between opening and the first time of day Qloo puts the crowd in (crowdTimes), on weekdays.
// → {from, to, days, text, src} | null. Null when Qloo's day parts are broad (4+) or the hours are unknown.
export function quietWindow(venue, ws = null) {
  const w = ws ?? weekShape(venue?.hours);
  const t = crowdTimes(venue);
  if (!w.ok || !t.length) return null;
  const first = TOD_CLOCK[t[0]]?.[0];
  if (!Number.isFinite(first)) return null;
  const open = w.weekdayOpen;
  if (open == null) return null;
  if (first - open < 60) return { from: null, to: null, days: [], text: null, crowd: t, src: ["venue.hours", "venue.tags.tod"], note: `opens ${clock(open)} weekdays and Qloo puts its crowd in from the ${t[0].toLowerCase()}` };
  return { from: open, to: first, days: DAYS.slice(0, 5).filter((d) => !w.closed.includes(d)), crowd: t, text: `weekdays ${clock(open)}–${clock(first)}`, src: ["venue.hours", "venue.tags.tod"] };
}

// ---------- the facts ----------
const prepNames = (text, names) => names.some((n) => n && n.length >= 3 && hasWord(text, n));
const cut = (s, n = 500) => (s.length <= n ? s : `${s.slice(0, n - 1).replace(/\s+\S*$/, "")}…`);
const make = ({ kind, label, text, why, score, src = [], from = null, prep = false }) => ({ label, text: cut(`${end(str(text))}${why ? ` ${end(str(why))}` : ""}`.replace(/\s+/g, " ")), ...(prep ? { prep: true } : {}), ...(from ? { from } : {}), kind, score, why: str(why) || null, src: uniq(src) });

export function deepFacts(rec, ctx = {}) {
  const { venue = null, routes = [], plan = null, city = null, profile = plan?.profile ?? {}, enrich = null, near = null, now = null } = ctx;
  const id = ctx.id ?? rec?.id ?? venue?.id ?? null;
  const v = venue ?? plan?.venues?.[id] ?? null;
  const name = str(rec?.name || v?.name || "this door");
  const rc = repCategory({ profile, routes });
  const facts = [];
  const site = siteCarries(rec, rc.cat, rc);
  const siteOk = Boolean(rec?.site?.ok) && site.facts > 0;
  const readOn = site.read ? ` (read ${site.read})` : "";
  const brews = siteFacts(rec).find((f) => f.k === "brews_own") ?? null;
  const own = siteNames(rec, rc.brands);
  const buys = crowdBuys(rec, rc);
  const rank = listRank(routes, id, plan);
  const otherNames = []; // names that make a line prep-only: Qloo's drink brands, the other doors
  const catWord = rc.plural;
  const noun1 = rc.na ? "non-alcoholic" : rc.soft ? rc.words.replace(/^an? /, "") : rc.cat;
  const single = rc.words.replace(/^an? /, ""); // "non-alcoholic beer", "tequila", "sparkling water"

  // ---- the crowd side, in words (no decimals; brand names only in the prep line enrichFacts already gives) ----
  const rankStrong = Boolean(rank && rank.rank <= Math.max(3, Math.ceil(rank.N * 0.1)) && rank.rank <= rank.N / 2);
  const rankBit = rank ? `rank ${rank.rank} of ${rank.N} on your list` : null;
  const crowdLine = (() => {
    if (buys.strength >= 3) return `Qloo puts its crowd well ahead of ${vsWhere(rec?.vsCity)} for ${catWord} (${buys.cats.map((c) => `${c.cat} ${times(c.lift)}`).join(", ")} ${rec?.vsCity?.scope?.cities ? "those bars" : "the city's bars"})${rankStrong ? `, ${rankBit}` : ""}`;
    if (rankStrong && buys.own.length) return `Qloo ranks its crowd ${rank.rank} of ${rank.N} on your list and puts ${and(buys.own)} among the drink brands it rates`;
    if (rankStrong && buys.strength >= 1 && buys.basis === "door") return `Qloo ranks its crowd ${rank.rank} of ${rank.N} on your list and puts ${catWord} among what it rates`;
    if (rankStrong) return `Qloo ranks its crowd ${rank.rank} of ${rank.N} on your list${buys.strength === 1 ? ` (it won't read this door's own crowd; its part of town rates ${catWord})` : ""}`;
    if (buys.strength === 2 && buys.own.length) return `Qloo puts ${and(buys.own)} among the drink brands its crowd rates`;
    if (buys.strength === 2) return `Qloo puts ${single} brands ${vsFew(rec?.vsCity).replace(/^that /, "")} among its crowd's picks`;
    if (buys.strength === 1 && buys.basis === "door") return `Qloo puts ${catWord} among what its crowd rates`;
    if (buys.strength === 1) return `Qloo won't read this door's own crowd; its part of town rates ${catWord}`;
    return null;
  })();
  const crowdSrc = [...buys.src, ...(rank ? ["routes.lists.all"] : [])];
  const crowdIsWeak = !(buys.strength >= 2 || rankStrong);

  // ---- 1. the gap ----
  if (own.length) {
    facts.push(make({ kind: "gap", label: "Already on its site", text: `Its own site${readOn} already names ${and(uniq(own.map((o) => o.brand)))}: "${short(own[0].text)}"`, why: "This is a reorder or a second line, not a cold pitch: ask how it moves and what would make them take more.", score: 95, src: [`site.facts[${own[0].i}]`], from: site.url, prep: false }));
  } else if (rc.cat && siteOk && !site.carries.length && (crowdLine || rc.soft)) {
    const nearItems = site.near.slice(0, 2).map((n) => noun(n.text));
    const near = nearItems.length ? `the only non-alcoholic ${nearItems.length === 1 ? "item it lists is" : "items it lists are"} ${and(nearItems)}` : `nothing on it names ${catWord}`;
    const evidence = crowdLine ? `${crowdLine}, but on its own site${readOn} ${near}` : `On its own site${readOn} ${near}`;
    let why;
    if (brews && rc.na) why = `It brews its own beer (its site), so ${rc.words} is the one beer it can't make itself: ask what the guest who isn't drinking gets handed now.`;
    else if (brews) why = `It brews its own beer (its site); ${catWord} are bought in, so the ask goes to whoever buys for the back bar: ask who that is and what's there now.`;
    else if (rc.soft) why = `A site rarely lists the water or soda; ask what's in the cooler for the guest who isn't drinking, then offer ${rc.words} for that slot.`;
    else why = `The site shows no ${catWord}, which doesn't mean the bar has none: ask what they hand a guest who orders ${rc.words}, and whether the answer sells.`;
    facts.push(make({ kind: "gap", label: "The gap: what its crowd buys vs what its site lists", text: evidence, why, score: crowdIsWeak ? 70 : 100, src: [...crowdSrc, "site.facts", ...(brews ? [`site.facts[brews_own]`] : [])], from: site.url, prep: prepNames(evidence, otherNames) }));
  } else if (rc.cat && siteOk && site.carries.length) {
    const c = site.carries[0];
    const names = uniq(site.carries.flatMap((x) => x.brands));
    const evidence = `Its own site${readOn} already lists ${names.length === 1 || (!names.length && site.carries.length === 1) ? rc.words : catWord}: ${names.length ? and(names.slice(0, 3)) : `"${short(c.text)}"`}${crowdLine ? `; ${crowdLine.replace(/^Qloo/, "and Qloo")}` : ""}`;
    const why = names.length ? `The slot exists and ${and(names.slice(0, 2))} ${names.length > 1 ? "hold" : "holds"} it: the ask is the second ${noun1} line or the style ${names[0]} doesn't cover, and a side-by-side taste with the staff decides it.` : `The slot exists: the ask is the next line in it, not whether to have one, so lead with what's different about ${rc.words} of yours.`;
    facts.push(make({ kind: "gap", label: "Already carries the category", text: evidence, why, score: 60, src: [`site.facts[${c.i}]`, ...crowdSrc], from: site.url, prep: prepNames(evidence, otherNames) }));
  } else if (rc.cat && !siteOk && crowdLine && !crowdIsWeak) {
    facts.push(make({ kind: "gap", label: "The crowd side only: no website read", text: `${crowdLine}; Doors read no website for this door, so what it carries is unknown`, why: `Walk in with the question, not the claim: what do they hand a guest who orders ${rc.words}, and is it selling?`, score: buys.strength >= 3 ? 65 : 55, src: crowdSrc, prep: prepNames(crowdLine, otherNames) }));
  }
  // headwind: the crowd leans hard elsewhere and nothing puts the rep's category forward
  const lean = rec?.qloo?.basis === "door" ? (rec?.vsCity?.cats ?? []).filter((c) => !rc.cats.includes(c.cat)).slice(0, 2) : [];
  if (rc.cat && !rc.soft && buys.strength === 0 && lean.length && !own.length) {
    const ev = `Qloo reads its crowd as a ${and(lean.map((c) => c.cat))} crowd (${lean.map((c) => `${c.cat} ${times(c.lift)}`).join(", ")} ${vsWhere(rec?.vsCity)}), and nothing in its list points at ${catWord}`;
    facts.push(make({ kind: "headwind", label: "Headwind: the crowd leans elsewhere", text: ev, why: `Don't lead with taste here; lead with the occasion the room already sells (its events, its happy hour, the guest who wants ${rc.words} in a ${lean[0].cat} room) and keep the ask small.`, score: 58, src: ["vsCity.cats"], prep: false }));
  }

  // ---- 2. neighbours ----
  const venues = venueMap({ plan, routes, city, venues: ctx.venues });
  const nears = rc.cat ? nearDoors(id, { enrich: enrich ?? {}, venues, city, near }) : [];
  if (nears.length) {
    const withSite = nears.map(([nid, d, sis]) => ({ nid, d, sis, rec: enrich[nid] })).filter((n) => n.rec?.site?.ok);
    const carry = withSite.map((n) => ({ ...n, c: siteCarries(n.rec, rc.cat, rc) })).filter((n) => n.c.carries.length);
    if (withSite.length) {
      const nm = (n) => str(n.rec.name || venues[n.nid]?.name || "a door");
      const how = (n) => (n.sis && n.d != null && n.d <= NEAR_KM ? "same crowd, nearby" : n.sis ? "same crowd" : `${Math.max(0.1, Math.round(n.d * 10) / 10)} km`);
      const list = carry.slice(0, 3).map((n) => `${nm(n)} (${how(n)}${n.c.carries[0].brands.length ? `: ${and(uniq(n.c.carries.flatMap((x) => x.brands)).slice(0, 2))}` : ""})`);
      otherNames.push(...carry.map(nm));
      const pool = `the ${withSite.length} nearby or same-crowd door${withSite.length === 1 ? "" : "s"} whose site${withSite.length === 1 ? "" : "s"} Doors read`;
      if (carry.length && siteOk && !site.carries.length && !own.length) {
        facts.push(make({ kind: "neighbours", label: "Doors with its crowd nearby carry what its site doesn't", text: `Of ${pool}, ${carry.length} list${carry.length === 1 ? "s" : ""} ${catWord}: ${and(list)}; this one's site${readOn} lists none`, why: `Its regulars can already get ${rc.words} a short walk away: the pitch is parity (what the room next door has), not a leap, and the staff may already field the ask.`, score: carry.length >= 2 ? 85 : 68, src: ["city.sisters", "near", ...carry.slice(0, 3).map((n) => `enrich[${n.nid}].site.facts`)], prep: true }));
      } else if (carry.length && !siteOk) {
        facts.push(make({ kind: "neighbours", label: "Doors with its crowd nearby list the category", text: `Of ${pool}, ${carry.length} list${carry.length === 1 ? "s" : ""} ${catWord}: ${and(list)}; this door's own site wasn't read`, why: `The block already sells ${rc.words}: ask whether this room does too, and what it chose.`, score: 60, src: ["city.sisters", "near", ...carry.slice(0, 3).map((n) => `enrich[${n.nid}].site.facts`)], prep: true }));
      } else if (carry.length && (site.carries.length || own.length)) {
        facts.push(make({ kind: "neighbours", label: "The block already sells the category", text: `${carry.length} of ${pool} also list${carry.length === 1 ? "s" : ""} ${catWord}: ${and(list)}`, why: `It's a category the whole block carries: the pitch is which ${noun1} wins the slot, so bring the comparison, not the category.`, score: 50, src: ["city.sisters", "near", ...carry.slice(0, 3).map((n) => `enrich[${n.nid}].site.facts`)], prep: true }));
      } else if (!carry.length && withSite.length >= 2 && siteOk && !site.carries.length && !own.length && !crowdIsWeak) {
        facts.push(make({ kind: "neighbours", label: "Nobody nearby lists it either", text: `None of ${pool} list${withSite.length === 1 ? "s" : ""} ${catWord}, and neither does this one's site${readOn}`, why: `Nobody on the block owns ${rc.words} yet: whoever says yes first is the only place its crowd can get it, which is the line for an owner who likes being first.`, score: 55, src: ["city.sisters", "near"], prep: false }));
      }
    }
  }

  // ---- 3. the owner's week ----
  const ws = weekShape(v?.hours);
  const quiet = quietWindow(v, ws);
  const hh = siteFacts(rec).filter((f) => f.k === "happy_hour");
  const hhWhen = hh.map((f) => parseWhen(f.text)).find(Boolean) ?? null;
  const events = siteFacts(rec).filter((f) => f.k === "events");
  const evWhen = events.map((f) => ({ f, w: parseWhen(f.text) })).filter((x) => x.w?.days?.length);
  const visit = Array.isArray(v?.tags?.visit) ? v.tags.visit : [];
  const pop = Number.isFinite(v?.popularity) ? v.popularity : null;
  {
    const bits = [];
    const src = [];
    if (ws.text) { bits.push(cap(ws.text)); src.push("venue.hours"); }
    if (quiet?.text) { bits.push(`Qloo puts its crowd in the ${and(quiet.crowd.map((t) => t.toLowerCase()))}, so the likely quiet window is ${quiet.text}`); src.push(...quiet.src); }
    else if (quiet?.note) { bits.push(`it ${quiet.note}, so there is no quiet stretch after opening`); src.push(...quiet.src); }
    if (hh.length) { bits.push(`its site posts a happy hour${hhWhen?.text ? ` ${hhWhen.text}` : ""} (${noun(hh[0].text.replace(/^happy hour[^:]*:\s*/i, ""))})`); src.push("site.facts[happy_hour]"); }
    const shaped = ws.closed.length || (ws.late.length && ws.late.length < 7) || Object.keys(ws.opens).length > 1;
    if (hh.length || quiet?.text || (bits.length >= 2 && shaped)) {
      let why;
      if (hh.length && hhWhen?.from != null) why = `The happy hour is the slot the owner is already paying to fill (${hhWhen.text}): pitch ${rc.words} as something that sells at that hour, and arrive ${quiet?.text ? `in the quiet window, before it starts` : "before it starts"}.`;
      else if (hh.length) why = `A posted happy hour means a slow stretch they're discounting to fill: ask which hours it's for and pitch ${rc.words} for that hour.`;
      else if (quiet?.text) why = `Walk in ${quiet.text}: the room is open and the crowd isn't in yet, so the owner can talk; and that empty stretch is the business they'd like more of.`;
      else if (quiet?.note) why = `It opens straight into its crowd: catch the owner right at opening, or ask for a time before the doors open.`;
      else why = `No quiet window shows in Qloo's day parts: ask the staff when the owner does the ordering and come back then.`;
      facts.push(make({ kind: "business", label: "The owner's week", text: bits.join("; "), why, score: hh.length && quiet?.text ? 75 : hh.length || quiet?.text ? 62 : 40, src, from: hh.length ? site.url : null, prep: false }));
    }
  }
  if (evWhen.length) {
    const lines = evWhen.slice(0, 3).map((x) => `${x.w.text}: ${short(x.f.text, 80)}`);
    const nights = uniq(evWhen.flatMap((x) => x.w.days));
    const why = `${runs(nights)} ${nights.length === 1 ? "has" : "have"} a programmed crowd the owner built on purpose: ask what that crowd drinks between sets or rounds, and whether ${rc.words} fits the night.`;
    facts.push(make({ kind: "business", label: "Nights the owner programs", text: `Its site${readOn} lists recurring events: ${lines.join(" | ")}`, why, score: 58, src: ["site.facts[events]"], from: site.url, prep: false }));
  } else if (events.filter((f) => EVENT_WORD.test(f.text)).length) {
    const evs = events.filter((f) => EVENT_WORD.test(f.text));
    facts.push(make({ kind: "business", label: "What the owner programs", text: `Its site${readOn} lists events: ${evs.slice(0, 2).map((f) => short(f.text, 90)).join(" | ")}`, why: `The events are the owner's own bet on who comes: tie the ask to one of them, not to the room in general.`, score: 42, src: ["site.facts[events]"], from: site.url, prep: false }));
  }

  // ---- 4. the room's occasion (demographics shape the occasion, never the drink) ----
  {
    const ages = rec?.qloo?.basis === "door" ? (rec?.vsCity?.ages ?? []).filter((a) => Number.isFinite(a.diff)).sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff)) : [];
    const g = rec?.qloo?.basis === "door" ? rec?.vsCity?.gender ?? null : null;
    const bits = [];
    const src = [];
    const AGE_WORDS = { "24_and_younger": "under 25", "25_to_29": "25–29", "30_to_34": "30–34", "35_to_44": "35–44", "45_to_54": "45–54", "55_and_older": "55 and over" };
    if (ages.length) { bits.push(`${ages[0].diff > 0 ? "more" : "fewer"} ${AGE_WORDS[ages[0].band] ?? ages[0].band} than ${vsWhere(rec?.vsCity)} (Qloo)`); src.push("vsCity.ages"); }
    if (g) { bits.push(`${g.diff > 0 ? "more men" : "more women"} than ${vsWhere(rec?.vsCity)} (Qloo)`); src.push("vsCity.gender"); }
    const vis = visit.includes("Destination") && !visit.includes("Routine visit") ? "a destination, not a routine stop" : visit.includes("Routine visit") && !visit.includes("Destination") ? "a routine stop for regulars" : visit.includes("Special occasion") ? "a special-occasion room" : null;
    if (vis) { bits.push(`Qloo tags it ${vis}`); src.push("venue.tags.visit"); }
    if (pop != null && pop >= 0.95) { bits.push(`among the city's most popular doors (Qloo popularity)`); src.push("venue.popularity"); }
    if (src.some((k) => k.startsWith("vsCity.")) && bits.length >= 2) {
      const why = vis?.startsWith("a destination") ? `A destination room sells the visit, not the price: pitch ${rc.words} as part of the occasion people drive in for, and never tell the buyer who their crowd is.` : vis?.startsWith("a routine") ? `Regulars repeat: the pitch is a line that earns a standing place, with a trial the regulars will notice, and never a word about who they are.` : `These shape the occasion, not the drink: use them to pick the moment (${rc.words} for the night out, the table, the round), and keep the demographics to yourself.`;
      facts.push(make({ kind: "occasion", label: "Who is in the room, vs the city (for your eyes)", text: cap(bits.join("; ")), why, score: 38, src, prep: true }));
    }
  }

  // ---- rank, cap, mark prep where a line names a brand or another door ----
  const out = facts
    .filter((f) => f && f.score >= 30)
    .sort((a, b) => b.score - a.score)
    .slice(0, DEEP_MAX)
    .map((f) => (!f.prep && prepNames(f.text, otherNames) ? { ...f, prep: true } : f));
  // never two lines of the same kind at the top unless the second is business/occasion
  return out;
}

// {id: facts} for many doors (the loader, the bake, the talk bake). records: {id: record} (the city's enrich file's
// doors); ids: which doors (default: the plan's venues that have a record). ctx as deepFacts', venue filled per door.
export function deepFactsFor(records, ctx = {}, ids = null) {
  const recs = records ?? {};
  const list = Array.isArray(ids) ? ids : Object.keys(ctx.plan?.venues ?? {}).filter((id) => recs[id]);
  const venues = venueMap({ plan: ctx.plan, routes: ctx.routes, city: ctx.city, venues: ctx.venues });
  const out = {};
  for (const id of list) {
    if (!recs[id]) continue;
    const f = deepFacts(recs[id], { ...ctx, id, venue: ctx.plan?.venues?.[id] ?? venues[id] ?? null, enrich: recs, venues });
    if (f.length) out[id] = f;
  }
  return out;
}
// one plain paragraph (a context block, a test's eye)
export const deepText = (facts) => (facts ?? []).map((f) => `${f.label}${f.prep ? " (prep only)" : ""}: ${f.text}`).join(" ");
// the shape talk-gen / the Agent take, nothing else (kind, score, src stay in Doors)
export const deepLines = (facts) => (facts ?? []).map(({ label, text, prep, from }) => ({ label, text, ...(prep ? { prep: true } : {}), ...(from ? { from } : {}) }));
