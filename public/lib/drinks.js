// Brand names and drink kinds, shared by the browser, the Worker and the Node scripts (owner review 7, M1). No imports,
// no I/O. Qloo's brand search ranks by its own sense of the name ("High Noon" → High Noon Sun Sips first), so a name
// match to what was typed comes first everywhere; whether a brand is a drink only breaks ties. Nothing resolves a name
// on its own (the pre-warm, the agent) unless the top row matches it (pickBrand).

// "NÜTRL", "Tito's" and "Espolòn" read as "nutrl", "titos" and "espolon"
export const fold = (s) =>
  String(s ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const words = (s) => fold(s).split(" ").filter(Boolean);

// How well a brand's name matches what was typed: 4 the same name, 3 the name starts with it ("High Noon Sun Sips"),
// 2 the same words one way or the other with the same first word ("Tito's Handmade Vodka" → "Tito's Vodka",
// "Modelo Especial" → "Modelo"), 1 it's somewhere in the name, 0 not at all.
export function nameMatch(name, query) {
  const n = fold(name);
  const q = fold(query);
  if (!n || !q) return 0;
  if (n === q) return 4;
  if (n.startsWith(q + " ")) return 3;
  const nw = n.split(" ");
  const qw = q.split(" ");
  if (nw[0] === qw[0] && (qw.every((w) => nw.includes(w)) || nw.every((w) => qw.includes(w)))) return 2;
  return n.includes(q) ? 1 : 0;
}

// ---------- is it a drink, and what kind ----------
const DRINK_WORDS = new Set(["beverage", "beverages", "drink", "drinks", "beer", "wine", "wines", "champagne", "spirits", "vodka", "gin", "whisky", "whiskey", "bourbon", "rum", "rhum", "tequila", "mezcal", "liqueur", "liqueurs", "amaro", "seltzer", "cider", "cocktail", "cocktails", "malt", "stout", "lager", "ale", "soda", "water", "coffee", "tea", "juice", "kombucha", "aperitif", "brewing", "brewery", "distillery", "distilling", "winery", "viticulture"]);
// competitor brands Qloo names on drink brands (High Noon Sun Sips: white_claw, truly, vizzy…)
const DRINK_RIVALS = new Set(["white_claw", "truly", "high_noon", "vizzy", "topo_chico_hard_seltzer", "bud_light_seltzer", "bud_light", "budweiser", "coors_light", "coors_banquet", "miller_lite", "michelob_ultra", "pabst_blue_ribbon", "yuengling", "corona", "modelo", "heineken", "stella_artois", "guinness", "blue_moon", "nutrl", "cutwater_spirits", "on_the_rocks", "titos", "titos_handmade_vodka", "smirnoff", "absolut", "grey_goose", "jack_daniels", "jameson", "fireball", "bacardi", "captain_morgan", "patron", "don_julio", "casamigos", "jose_cuervo", "hennessy", "aperol", "campari", "la_croix", "lacroix", "liquid_death", "athletic_brewing", "coca_cola", "pepsi", "red_bull", "monster_energy", "starbucks"]);
const NOT_DRINK = /genre:brand:(fashion|academic|apparel|retail|clothing|automotive|technology|software|sports|footwear|beauty|cosmetics|toys|media|entertainment|travel|finance|electronics|website)|wikipedia_category:.*(clothing|retailers|universit|colleges)|industry:qloo:(fashion|retail|e_commerce|education|higher_education|media|consumer_electronics|technology|software|toys|beauty|cosmetics|automotive|outdoor_equipment|marketplace|online_marketplace)/;

const tagIds = (r) => (r.tags ?? []).map((t) => (typeof t === "string" ? t : t.id ?? t.tag_id ?? ""));
// 1 a drink by any of Qloo's tag families, -1 clearly something else, 0 Qloo doesn't say
export function drinkness(tags) {
  for (const t of tags) {
    if (/^urn:tag:genre:brand:(wine_and_spirits|food_and_beverage:drinks)/.test(t)) return 1;
    const m = t.match(/^urn:tag:(product_category|industry):qloo:(.+)$/);
    if (m && m[2] !== "food_beverage" && m[2].split("_").some((w) => DRINK_WORDS.has(w))) return 1;
    const c = t.match(/^urn:tag:competitor_brand:qloo:(.+)$/);
    if (c && DRINK_RIVALS.has(c[1])) return 1;
  }
  return tags.some((t) => NOT_DRINK.test(t)) ? -1 : 0;
}

// The drink's kind for a short line ("Hard seltzer", "Tequila", "Craft beer"), most specific tag first; null if none.
const GENRE_KIND = [
  ["spirits:hard_seltzer", "Hard seltzer"], ["spirits:tequila", "Tequila"], ["spirits:vodka", "Vodka"], ["spirits:gin", "Gin"],
  ["spirits:rum", "Rum"], ["spirits:liqueur", "Liqueur"], ["whiskey:scotch", "Scotch"], ["whiskey:bourbon", "Bourbon"],
  ["whiskey:rye", "Rye whiskey"], ["spirits:whiskey", "Whiskey"], ["spirits:cocktails", "Canned cocktail"], ["beer:craft", "Craft beer"],
  ["beer:cider", "Cider"], ["wine:sparkling", "Sparkling wine"], ["wine:rose", "Rosé"], ["wine:red", "Red wine"], ["wine:white", "White wine"],
  ["wine_and_spirits:non_alcoholic", "Non-alcoholic"], ["wine_and_spirits:beer", "Beer"], ["wine_and_spirits:wine", "Wine"],
  ["wine_and_spirits:spirits", "Spirits"], ["drinks:energy_drink", "Energy drink"], ["drinks:sport_drinks", "Sports drink"],
  ["drinks:coffee_and_tea", "Coffee & tea"], ["drinks:juice", "Juice"], ["drinks:carbonated", "Soft drink"], ["drinks:non_carbonated", "Soft drink"],
];
const PRODUCT_KIND = [
  [/hard_seltzer/, "Hard seltzer"], [/ready_to_drink_cocktails|canned_cocktails|^cocktails$/, "Canned cocktail"], [/^tequila$/, "Tequila"],
  [/^mezcal$/, "Mezcal"], [/vodka/, "Vodka"], [/^gin$/, "Gin"], [/^whiske?y$/, "Whiskey"], [/^rh?um$/, "Rum"], [/liqueur|amaro/, "Liqueur"],
  [/hard_tea/, "Hard tea"], [/cider/, "Cider"], [/sparkling_wine|champagne/, "Sparkling wine"], [/malt_beverages/, "Malt beverage"],
  [/^non_alcoholic/, "Non-alcoholic"], [/beer|stout/, "Beer"], [/^wines?$/, "Wine"], [/^spirits$/, "Spirits"],
];
export function drinkKind(tags, name = "") {
  const genre = tags.filter((t) => t.startsWith("urn:tag:genre:brand:"));
  const product = tags.map((t) => t.match(/^urn:tag:product_category:qloo:(.+)$/)?.[1]).filter(Boolean);
  // a brewery that also makes a seltzer reads as its beer
  if (/brew|beer|\bales?\b|lager/i.test(name) && genre.concat(product).some((t) => /beer/.test(t))) return genre.some((t) => t.endsWith("beer:craft")) ? "Craft beer" : "Beer";
  for (const [k, label] of GENRE_KIND) if (genre.some((t) => t.includes(k))) return label;
  for (const [re, label] of PRODUCT_KIND) if (product.some((p) => re.test(p))) return label;
  return null;
}

// ---------- Qloo's brand search answer → rows for the picker ----------
// rows: [{id, name, where, popularity, match, drink}] from searchRows-like trimming; query: what was typed.
export function rankBrands(raw, query, trim) {
  const scored = raw.map((r, i) => {
    const tags = tagIds(r);
    const row = trim(r);
    const kind = drinkKind(tags, r.name);
    return { i, match: nameMatch(r.name, query), drink: drinkness(tags), row: { ...row, where: row.where || kind } };
  });
  // a drink field: clearly non-drink brands go when any drink is there (a brand Qloo tags sparsely stays)
  const drinks = scored.some((x) => x.drink > 0);
  return scored
    .filter((x) => !drinks || x.drink >= 0)
    .sort((a, b) => b.match - a.match || b.drink - a.drink || a.i - b.i)
    .map((x) => x.row);
}

// The row a name resolves to without a person choosing (pre-warm, the agent): the top row if its name matches what
// was typed (the same name, starts with it, or the same words), else null: the caller stops and says what Qloo had.
export const pickBrand = (rows, query) => (rows[0] && nameMatch(rows[0].name, query) >= 2 ? rows[0] : null);

// ---------- the drink list Doors holds (public/data/drinks.json, scripts/make-drinks.mjs) ----------
function edits(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
// a near miss (owner review 7: a visitor can't misspell their way out of the list): within 1 edit for 4+ letters, 2 for
// 7+ (1 when the first letter is wrong), of the word or of its start as long as what was typed ("guiness" → guinness,
// "whte" → white, "jamson" → jameson)
function near(t, w) {
  if (t.length < 4) return false;
  const k = t.length >= 7 && t[0] === w[0] ? 2 : 1;
  return edits(t, w, k) <= k || edits(t, w.slice(0, t.length), k) <= k;
}
// one typed word against one word of a name: 3 the word starts with it, 1 a near miss, 0 no
const wordHit = (t, w) => (w.startsWith(t) ? 3 : near(t, w) ? 1 : 0);
// A brand Doors holds files for (index.brands) against folded typed text: anywhere in its name or kind; one letter, only
// names starting with it ("c" → Casamigos, not every brand with a c in it)
export const heldMatch = (b, q) => !q || (q.length === 1 ? [b.name, b.qlooName].some((s) => fold(s).startsWith(q)) : [b.name, b.qlooName, b.category].some((s) => fold(s).includes(q)));

// list: [{id, name, kind, pop}]. Typed text → up to n entries: the name starts with it, then every word starts a word
// of the name (or every word of the name was typed), then it's inside the name, most popular first within each; near
// misses only when nothing else matches.
export function searchDrinks(list, query, n = 8) {
  const q = fold(query);
  if (!q || !Array.isArray(list)) return [];
  const qw = q.split(" ");
  const out = [];
  for (const d of list) {
    const f = d._f ?? (d._f = fold(d.name));
    let s = f === q ? 5 : f.startsWith(q) ? 4 : 0;
    if (!s) {
      const nw = d._w ?? (d._w = f.split(" "));
      const hits = qw.map((t) => Math.max(...nw.map((w) => wordHit(t, w))));
      // the name's own words all typed ("corona extra" → Corona) reads as a word match too; the whole text as one word
      // is a near miss too ("highnoon")
      s = hits.every((h) => h === 3) || nameMatch(d.name, q) === 2 ? 3 : f.includes(q) ? 2 : hits.every((h) => h > 0) || near(q.replace(/ /g, ""), f.replace(/ /g, "")) ? 1 : 0;
    }
    if (s) out.push([s, d]);
  }
  const sure = out.some(([s]) => s > 1);
  return out.filter(([s]) => !sure || s > 1).sort((a, b) => b[0] - a[0] || (b[1].pop ?? 0) - (a[1].pop ?? 0)).slice(0, n).map(([, d]) => d);
}
