// Round 3 (Jard 10-25, ROUND3-SPEC lane "enrich"): the per-door ENRICHMENT RECORD, the deep facts about one door that
// the talking points (talk2) and the Doors Agent (agent2) read. Two sources:
//   1. Qloo, with THE DOOR AS THE SIGNAL (signal.interests.entities=<door id>): the brands its crowd over-indexes on
//      (all kinds, and drink brands), the crowd's age and gender skew, and its typed taste tags (music, dishes,
//      keywords, hobbies). About one door in five Qloo refuses as a signal ("invalid"); those get the drink brands of
//      their part of town instead (signal.location=POINT, 1.2 km) and say so (basis "area").
//   2. The door's own public website and menu page (src/enrich.js fetchSite): what it says it pours, brews, does.
// What counts as DISTINCTIVE is decided against the city's other enriched doors (vsCity, pure, below), by Jard's viz
// rule: a crowd fact counts at ≥ 1.5× the city. Everything else in the record is kept for the Agent's deeper answers.
//
// Record (public/data/enrich/<city>.json → doors[id], and POST /api/enrich for a live plan's door):
// {
//   v: 1, id, name, at: "2026-10-25",
//   qloo: {
//     basis: "door" | "area" | "none",          door: Qloo takes this door as a signal; area: its 1.2 km only; none: nothing
//     brands: [{id, name, aff, pop, cats: ["western wear"…]}]    top 30 brands of any kind (door basis only; cats = Qloo's genre names)
//     drinks: [{id, name, aff, pop, cat}]                        top 30 drink brands; cat ∈ DRINK_CATS
//     ages:   {"24_and_younger": -0.02, …} | null                Qloo's skew per band vs its baseline (door basis only)
//     gender: {male, female} | null
//     tags:   {music: [], dishes: [], keywords: [], hobbies: [], tone: []}   typed taste tags, by affinity (door basis only)
//     calls:  n                                                  Qloo requests this record cost
//   },
//   vsCity: {                                   pure, from the city's enriched doors (vsCity below); null until computed
//     doors: n,                                 how many doors in the city the comparison used
//     drinks: [{name, cat, lift, inDoors}]      this door's drink brands that are rare across the city (lift ≥ 3, top 8)
//     cats:   [{cat, n, share, cityShare, lift}]  drink categories this door's list over-indexes on (lift ≥ 1.5, n ≥ 3)
//     brands: [{name, cats, lift, inDoors}]     rare non-drink brands (lift ≥ 3, top 8): prep, never said in the room
//     ages:   [{band, skew, median, diff}]      bands this door skews to vs the city's doors (|diff| ≥ 0.2)
//     gender: {male, median, diff} | null
//     tags:   {music: [], dishes: [], keywords: [], hobbies: []}   this door's tags that are rare across the city (in < 1/3)
//     scope?: {cities: k}                        set when a LIVE door was compared with the Worker's baked baseline (every
//                                               city Doors has read, src/enrich-baseline.js) instead of its own city
//   },
//   site: {                                     src/enrich.js; null when the door has no website
//     url, menuUrl, fetched: "2026-10-25", ok, reason?: "robots"|"thin"|"http 404"|"skipped host"|…, model,
//     facts: [{k, text, quote, from}]           k ∈ SITE_KEYS; quote is verbatim from the page (checked); from = the url
//   }
// }
// enrichFacts(record) turns it into labelled lines for a model's context (talk-gen's R facts, the Agent's door block).
// Pure: no DOM, no fetch. Covered by test/enrich.test.mjs.

export const ENRICH_VERSION = 1;
export const ENRICH_NOTE = "Per-door enrichment (round 3): Qloo with the door as the signal (brands, drink brands, age and gender skew, taste tags) and the door's own public website; distinctive = vs this city's other enriched doors.";

// ---------- drink categories (from a brand's Qloo tag ids) ----------
export const DRINK_CATS = ["non-alcoholic", "craft beer", "beer", "cider", "whiskey", "tequila", "vodka", "spirits", "RTD", "wine"];
// Qloo's own brand genres decide (genre:brand:wine_and_spirits:…, the most specific first); product categories only
// when a brand has no drink genre. Keywords never: a craft brewery with one non-alcoholic line stays "craft beer".
const GENRE_RULES = [
  ["non-alcoholic", /wine_and_spirits:non_alcoholic/],
  ["cider", /wine_and_spirits:beer:cider/],
  ["craft beer", /wine_and_spirits:beer:craft/],
  ["beer", /wine_and_spirits:beer(:other)?$/],
  ["whiskey", /wine_and_spirits:spirits:whiskey/],
  ["tequila", /wine_and_spirits:spirits:(tequila|mezcal)/],
  ["vodka", /wine_and_spirits:spirits:vodka/],
  ["RTD", /wine_and_spirits:spirits:(hard_seltzer|cocktails|hard_tea|ready_to_drink)/],
  ["wine", /wine_and_spirits:wine/],
  ["spirits", /wine_and_spirits:spirits/],
];
const CATEGORY_RULES = [
  ["non-alcoholic", /product_category:qloo:non_alcoholic/],
  ["cider", /product_category:qloo:(hard_)?cider/],
  ["beer", /product_category:qloo:beer$/],
  ["whiskey", /product_category:qloo:(whisky|whiskey|bourbon)/],
  ["tequila", /product_category:qloo:(tequila|mezcal)/],
  ["vodka", /product_category:qloo:vodka/],
  ["RTD", /product_category:qloo:(hard_seltzer|hard_tea|ready_to_drink)/],
  ["wine", /product_category:qloo:wine/],
  ["spirits", /product_category:qloo:spirits/],
];
export function drinkCat(tagIds = []) {
  const ids = tagIds.map((t) => String(t?.id ?? t));
  for (const [cat, re] of GENRE_RULES) if (ids.some((id) => re.test(id))) return cat;
  for (const [cat, re] of CATEGORY_RULES) if (ids.some((id) => re.test(id))) return cat;
  return null;
}
const isDrinkBrand = (e) => (e.tags ?? []).some((t) => /genre:brand:wine_and_spirits|industry:qloo:alcoholic_beverages|product_category:qloo:(beer|wine|spirits|non_alcoholic)/.test(String(t.id ?? "")));

// ---------- Qloo bodies → record parts ----------
const num = (x, d = 3) => (typeof x === "number" && Number.isFinite(x) ? Number(x.toFixed(d)) : null);
const ents = (body) => (Array.isArray(body?.results?.entities) ? body.results.entities : []);
// a brand's kinds in words: Qloo's genre:brand names under the top level ("Western Wear", "Whiskey"), at most 3
const brandCats = (e) => [...new Set((e.tags ?? []).filter((t) => /^urn:tag:genre:brand:/.test(String(t.id ?? "")) && !/^urn:tag:genre:brand:[a-z_]+$/.test(String(t.id))).map((t) => String(t.name ?? "").trim()).filter(Boolean))].slice(0, 3);
export function brandsFrom(body, { take = 30 } = {}) {
  return ents(body).slice(0, take).map((e) => ({ id: e.entity_id, name: String(e.name ?? "").trim(), aff: num(e.query?.affinity), pop: num(e.popularity), cats: brandCats(e) })).filter((b) => b.id && b.name);
}
export function drinksFrom(body, { take = 30 } = {}) {
  return ents(body).filter(isDrinkBrand).slice(0, take).map((e) => ({ id: e.entity_id, name: String(e.name ?? "").trim(), aff: num(e.query?.affinity), pop: num(e.popularity), cat: drinkCat(e.tags) ?? "spirits" })).filter((b) => b.id && b.name);
}
export const AGE_BANDS = ["24_and_younger", "25_to_29", "30_to_34", "35_to_44", "45_to_54", "55_and_older"];
export const AGE_WORDS = { "24_and_younger": "under 25", "25_to_29": "25–29", "30_to_34": "30–34", "35_to_44": "35–44", "45_to_54": "45–54", "55_and_older": "55 and over" };
export function demoFrom(body, id = null) {
  const rows = Array.isArray(body?.results?.demographics) ? body.results.demographics : [];
  const row = (id && rows.find((r) => r.entity_id === id)) || rows[0];
  if (!row?.query?.age) return { ages: null, gender: null };
  const ages = {};
  for (const b of AGE_BANDS) if (typeof row.query.age[b] === "number") ages[b] = num(row.query.age[b], 2);
  const g = row.query.gender ?? {};
  return { ages: Object.keys(ages).length ? ages : null, gender: typeof g.male === "number" ? { male: num(g.male, 2), female: num(g.female, 2) } : null };
}
// typed taste tags: the types asked for (TAG_TYPES) → the record's families
export const TAG_TYPES = { "urn:tag:genre:music": "music", "urn:tag:specialty_dish:place": "dishes", "urn:tag:keyword:qloo": "keywords", "urn:tag:hobby:qloo": "hobbies", "urn:tag:emotional_tone:qloo": "tone", "urn:tag:audience:qloo": "keywords" };
export const TAG_FAMS = ["music", "dishes", "keywords", "hobbies", "tone"];
const TAG_CAP = { music: 8, dishes: 10, keywords: 10, hobbies: 6, tone: 4 };
export function tagsFrom(body) {
  const rows = Array.isArray(body?.results?.tags) ? body.results.tags : [];
  const out = { music: [], dishes: [], keywords: [], hobbies: [], tone: [] };
  for (const t of rows) {
    const fam = TAG_TYPES[String(t.subtype ?? t.type ?? "")] ?? null; // Qloo's tag rows: {tag_id, name, subtype, query.affinity}
    const name = String(t.name ?? "").trim().replace(/\s+/g, " ");
    if (!fam || !name || /^[a-z]{2}_/.test(name)) continue;
    const l = out[fam];
    const key = name.toLowerCase();
    if (l.length < TAG_CAP[fam] && !l.some((x) => x.toLowerCase() === key)) l.push(fam === "music" ? name.toLowerCase() : name);
  }
  return out;
}

// ---------- the city comparison (pure) ----------
// doors: {id: record}. Returns {id: vsCity} for every door with a qloo part. Baselines are counted over the doors with
// basis "door" (area-basis doors have no crowd of their own to count), so lift = 1 / (share of doors with the same
// fact). Jard's rule is the floor (≥ 1.5×); long lists use 3× so the lines stay the door's own.
export const LIFT_MIN = 1.5;
export const LIFT_RARE = 3;
const median = (xs) => {
  const s = xs.filter((x) => typeof x === "number").sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const r2 = (x) => Math.round(x * 100) / 100;
// baselineOf(doors) → the counts one comparison needs, as plain JSON (so a baseline can be baked into the Worker:
// scripts/enrich-baseline.mjs → src/enrich-baseline.js, the held and pre-warmed cities' doors together). Counts are
// over the doors with basis "door". `compact` drops names counted once: lift = n / max(1, count) reads the same.
export function baselineOf(doors, { compact = false } = {}) {
  const own = Object.values(doors ?? {}).filter((d) => d?.qloo?.basis === "door");
  const n = own.length;
  const count = (pick) => {
    const m = {};
    for (const d of own) for (const k of new Set(pick(d))) m[k] = (m[k] ?? 0) + 1;
    return compact ? Object.fromEntries(Object.entries(m).filter(([, c]) => c >= 2)) : m;
  };
  const drinkCount = count((d) => (d.qloo.drinks ?? []).map((b) => b.name));
  const brandCount = count((d) => (d.qloo.brands ?? []).map((b) => b.name));
  const tagCount = Object.fromEntries(TAG_FAMS.map((f) => [f, count((d) => (d.qloo.tags?.[f] ?? []).map((x) => x.toLowerCase()))]));
  // the drink-category mix: mean share of each category over the doors' lists
  const catShare = {};
  for (const c of DRINK_CATS) catShare[c] = n ? own.reduce((a, d) => a + ((d.qloo.drinks ?? []).filter((b) => b.cat === c).length / Math.max(1, (d.qloo.drinks ?? []).length)), 0) / n : 0;
  const ageMed = Object.fromEntries(AGE_BANDS.map((b) => [b, median(own.map((d) => d.qloo.ages?.[b]))]));
  const genderMed = median(own.map((d) => d.qloo.gender?.male));
  return { n, drinkCount, brandCount, tagCount, catShare, ageMed, genderMed };
}
// vsBaseline(record, baseline, scope?) → one door's vsCity against a baseline. scope ({cities: k}) is kept on the
// result when the baseline is not this door's own city (the Worker's baked baseline): the words say so (vsWhere).
export function vsBaseline(d, base, scope = null) {
  const q = d?.qloo;
  if (!q) return null;
  const n = base?.n ?? 0;
  const isOwn = q.basis === "door";
  const lift = (m, k) => (n && isOwn ? r2(n / Math.max(1, m?.[k] ?? 0)) : null);
  const drinks = isOwn ? (q.drinks ?? []).slice(0, 15).map((b) => ({ name: b.name, cat: b.cat, lift: lift(base.drinkCount, b.name), inDoors: base.drinkCount?.[b.name] ?? 0 })).filter((x) => x.lift >= LIFT_RARE).slice(0, 8) : [];
  const brands = isOwn ? (q.brands ?? []).filter((b) => !(q.drinks ?? []).some((x) => x.id === b.id)).slice(0, 15).map((b) => ({ name: b.name, cats: b.cats, lift: lift(base.brandCount, b.name), inDoors: base.brandCount?.[b.name] ?? 0 })).filter((x) => x.lift >= LIFT_RARE).slice(0, 8) : [];
  const total = Math.max(1, (q.drinks ?? []).length);
  const cats = isOwn && n ? DRINK_CATS.map((c) => {
    const k = (q.drinks ?? []).filter((b) => b.cat === c).length;
    const share = k / total;
    return { cat: c, n: k, share: r2(share), cityShare: r2(base.catShare[c]), lift: base.catShare[c] ? r2(share / base.catShare[c]) : null };
  }).filter((x) => x.n >= 3 && x.lift >= LIFT_MIN).sort((a, b) => b.lift - a.lift) : [];
  const ages = isOwn && q.ages ? AGE_BANDS.map((b) => ({ band: b, skew: q.ages[b], median: base.ageMed[b], diff: typeof q.ages[b] === "number" && typeof base.ageMed[b] === "number" ? r2(q.ages[b] - base.ageMed[b]) : null })).filter((x) => x.diff != null && Math.abs(x.diff) >= 0.2) : [];
  const gender = isOwn && q.gender && typeof base.genderMed === "number" && Math.abs(q.gender.male - base.genderMed) >= 0.2 ? { male: q.gender.male, median: r2(base.genderMed), diff: r2(q.gender.male - base.genderMed) } : null;
  const tags = {};
  for (const f of ["music", "dishes", "keywords", "hobbies"]) tags[f] = isOwn ? (q.tags?.[f] ?? []).filter((x) => n / Math.max(1, base.tagCount?.[f]?.[x.toLowerCase()] ?? 0) >= LIFT_RARE).slice(0, 6) : [];
  return { doors: n, drinks, cats, brands, ages, gender, tags, ...(scope ? { scope } : {}) };
}
export function vsCity(doors) {
  const base = baselineOf(doors);
  const out = {};
  for (const d of Object.values(doors ?? {}).filter((d) => d?.qloo)) out[d.id] = vsBaseline(d, base);
  return out;
}
// the words for what a door was compared with: its own city's doors, or the Worker's baked baseline over every city
// Doors has read (a live door in a city with no baked file)
export const vsWhere = (v, here = "the city's bars") => (v?.scope?.cities ? `the ${v.doors} bars Doors has read in ${v.scope.cities} US cities` : here);
export const vsFew = (v) => (v?.scope?.cities ? "that few bars Doors has read share" : "that few bars here share");

// ---------- the website facts ----------
export const SITE_KEYS = ["what", "brews_own", "taps", "house_drinks", "non_alcoholic", "drinks", "happy_hour", "events", "food", "space", "other"];
export const SITE_LABELS = {
  what: "What the place says it is",
  brews_own: "Makes its own",
  taps: "Taps",
  house_drinks: "House drinks",
  non_alcoholic: "Non-alcoholic options it lists",
  drinks: "Drinks it names",
  happy_hour: "Happy hour",
  events: "Events",
  food: "Food",
  space: "The space",
  other: "Also on its site",
};
const norm = (s) => String(s ?? "").toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[^a-z0-9'"&$%]+/g, " ").trim();
// a site fact holds when its quote is really on the page (so no line about the bar's stock is the model's own)
export function checkSiteFacts(facts, pageText) {
  const page = norm(pageText);
  const out = [];
  const dropped = [];
  for (const f of Array.isArray(facts) ? facts : []) {
    const k = SITE_KEYS.includes(f?.k) ? f.k : null;
    const text = String(f?.text ?? "").trim().replace(/\s+/g, " ").slice(0, 200);
    const quote = String(f?.quote ?? "").trim().replace(/\s+/g, " ").slice(0, 240);
    if (!k || !text) continue;
    const q = norm(quote);
    if (q.length < 8 || !page.includes(q)) {
      dropped.push({ k, text, reason: q.length < 8 ? "no quote" : "quote not on the page" });
      continue;
    }
    out.push({ k, text, quote });
  }
  return { facts: out, dropped };
}

// ---------- lines for a model ----------
const and = (xs) => (xs.length <= 1 ? xs[0] ?? "" : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
const x = (lift) => (lift >= 10 ? `${Math.round(lift)}×` : `${Math.round(lift * 10) / 10}×`);
const ageWord = (b) => AGE_WORDS[b] ?? b;
// enrichFacts(record, {prep}) → [{label, text, src: "qloo"|"site", prep?: true}]: only what is distinctive (vsCity) or
// stated by the door itself. prep lines (the crowd's brands, its age skew) are for the rep's eyes, never said aloud.
export function enrichFacts(rec, { max = 20 } = {}) {
  const out = [];
  const push = (label, text, extra = {}) => text && out.length < max && out.push({ label, text: String(text).replace(/\s+/g, " ").trim().slice(0, 400), ...extra });
  const q = rec?.qloo ?? null;
  const v = rec?.vsCity ?? null;
  if (q && v && q.basis === "door") {
    if (v.cats?.length) push(`Drink kinds this crowd over-indexes on (vs ${vsWhere(v, "this city's bars")})`, v.cats.slice(0, 3).map((c) => `${c.cat} (${x(c.lift)} ${v.scope?.cities ? "those bars" : "the city's bars"})`).join(", "), { src: "qloo", prep: true });
    if (v.drinks?.length) push(`Drink brands its crowd rates ${vsFew(v)}`, v.drinks.map((b) => `${b.name} (${b.cat}, ${x(b.lift)})`).join(", "), { src: "qloo", prep: true });
    else if (q.drinks?.length) push("Drink brands its crowd rates highest", q.drinks.slice(0, 6).map((b) => `${b.name} (${b.cat})`).join(", "), { src: "qloo", prep: true });
    if (v.brands?.length) push(`Other brands its crowd rates ${vsFew(v)}`, v.brands.map((b) => (b.cats?.length ? `${b.name} (${b.cats[0].toLowerCase()})` : b.name)).join(", "), { src: "qloo", prep: true });
    if (v.ages?.length) push(`Age skew vs ${vsWhere(v, "this city's bars")}`, v.ages.map((a) => `${a.diff > 0 ? "more" : "fewer"} ${ageWord(a.band)} (${a.diff > 0 ? "+" : ""}${a.diff} vs ${v.scope?.cities ? "those bars" : "the city's bars"})`).join(", "), { src: "qloo", prep: true });
    if (v.gender) push(`Gender skew vs ${vsWhere(v, "this city's bars")}`, `${v.gender.diff > 0 ? "more men" : "more women"} than ${v.scope?.cities ? "those bars" : "the city's bars"} (${v.gender.diff > 0 ? "+" : ""}${v.gender.diff})`, { src: "qloo", prep: true });
    if (v.tags?.music?.length) push(`Music its crowd rates ${vsFew(v)}`, v.tags.music.join(", "), { src: "qloo", prep: true });
    if (v.tags?.dishes?.length) push(`Dishes its crowd rates ${vsFew(v)}`, v.tags.dishes.join(", "), { src: "qloo" });
    const kw = [...(v.tags?.keywords ?? []), ...(v.tags?.hobbies ?? [])].slice(0, 8);
    if (kw.length) push(`What else its crowd is into ${vsFew(v)}`, kw.join(", "), { src: "qloo", prep: true });
  } else if (q && q.basis === "area" && q.drinks?.length) {
    push("Drink brands rated in its part of town (Qloo doesn't read this door's own crowd)", q.drinks.slice(0, 6).map((b) => `${b.name} (${b.cat})`).join(", "), { src: "qloo", prep: true });
  }
  const s = rec?.site ?? null;
  if (s?.ok && s.facts?.length) {
    const by = {};
    for (const f of s.facts) (by[f.k] ??= []).push(f.text);
    for (const k of SITE_KEYS) if (by[k]) push(`${SITE_LABELS[k]} (its own website)`, by[k].slice(0, 4).map((t) => (/[.!?]$/.test(t) ? t : `${t}.`)).join(" "), { src: "site", from: s.url });
  }
  return out;
}
// one plain paragraph, for a context block
export function enrichText(rec) {
  return enrichFacts(rec).map((f) => `${f.label}: ${f.text}.`).join(" ");
}
// The slim record the page loads (public/data/enrich/<city>.json): the same shape, long lists cut. The full record
// (30 brands, 30 drink brands, every tag, ids, counts) stays in the build's data/enrich/<city>.json. The skews, the
// distinctive facts and the site are kept: enrichFacts reads the same lines from either.
export const SLIM = { brands: 10, drinks: 12, tags: 6 };
export function slimRecord(r) {
  if (!r) return r;
  const q = r.qloo ?? {};
  const tags = {};
  for (const f of TAG_FAMS) tags[f] = (q.tags?.[f] ?? []).slice(0, SLIM.tags);
  const v = r.vsCity;
  return {
    ...r,
    qloo: { ...q, brands: (q.brands ?? []).slice(0, SLIM.brands).map(({ name, cats }) => ({ name, cats })), drinks: (q.drinks ?? []).slice(0, SLIM.drinks).map(({ name, cat }) => ({ name, cat })), tags },
    vsCity: v ? { ...v, drinks: (v.drinks ?? []).map(({ name, cat, lift }) => ({ name, cat, lift })), brands: (v.brands ?? []).map(({ name, cats, lift }) => ({ name, cats: (cats ?? []).slice(0, 1), lift })), cats: (v.cats ?? []).map(({ cat, n, lift }) => ({ cat, n, lift })) } : v,
    site: r.site ? { ...r.site, pages: undefined } : r.site,
  };
}
// the empty record for a door Qloo and the web gave nothing on
export const emptyEnrich = (id, name) => ({ v: ENRICH_VERSION, id, name, at: null, qloo: { basis: "none", brands: [], drinks: [], ages: null, gender: null, tags: { music: [], dishes: [], keywords: [], hobbies: [], tone: [] }, calls: 0 }, vsCity: null, site: null });
