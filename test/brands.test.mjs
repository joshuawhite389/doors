// L1: the brand search (one Qloo call) answers with every kind of brand ("Topo Chico" → Topo Designs, Chico's,
// California State University, Chico). Owner review 7 (M1): the name typed comes first, Qloo's drink tags break ties,
// clearly non-drink ones go, and the empty "where" becomes the drink's kind from the tag. Nothing picks a brand by
// another name on its own (pickBrand). The real Qloo answers (test/fixtures/qloo-search-*.json) are private: those
// tests skip in the public repo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { brandRows, pickBrand } from "../src/plan.js";
import { fold, nameMatch, searchDrinks, heldMatch } from "../public/lib/drinks.js";
import { makeDrinks } from "../scripts/make-drinks.mjs";

const fixture = (name) => new URL(`./fixtures/qloo-search-${name}.json`, import.meta.url);
const real = (name) => JSON.parse(readFileSync(fixture(name), "utf8"));
const noFixtures = !existsSync(fixture("high-noon")) && "the real Qloo answers are private";
const DRINKS = new URL("../public/data/drinks.json", import.meta.url);
const noDrinks = !existsSync(DRINKS) && "public/data/drinks.json is Qloo-derived (private)";

const e = (name, tags, extra = {}) => ({ name, entity_id: `${name.length}`.padStart(8, "0") + "-0000-0000-0000-000000000000", types: ["urn:entity:brand"], disambiguation: "", properties: {}, tags: tags.map((id) => ({ id })), ...extra });
const BODY = { results: [
  e("Topo Designs", ["urn:tag:aesthetic_property:qloo:color_blocked", "urn:tag:lifestyle:qloo:backpacking_across_continents"]),
  e("Topo Chico Hard Seltzer", ["urn:tag:genre:brand:wine_and_spirits:spirits:hard_seltzer", "urn:tag:genre:brand:wine_and_spirits:spirits", "urn:tag:genre:brand:wine_and_spirits"]),
  e("Chico's", ["urn:tag:genre:brand:fashion:casual", "urn:tag:wikipedia_category:clothing_retailers_of_the_united_states"]),
  e("California State University, Chico", ["urn:tag:genre:brand:academic"]),
  e("Topo Chico Spirited", ["urn:tag:aesthetic_property:qloo:sparkling_imagery", "urn:tag:lifestyle:qloo:effortless_hosting"]),
] };

test("brand search: the name typed first, drinks break ties, clearly non-drink brands dropped, the drink's kind as its line", () => {
  const rows = brandRows(BODY, "Topo Chico");
  assert.deepEqual(rows.map((r) => r.name), ["Topo Chico Hard Seltzer", "Topo Chico Spirited", "Topo Designs"]);
  assert.equal(rows[0].where, "Hard seltzer");
  assert.equal(rows[2].where, null);
  // nothing drink-like: every row stays, the name typed first (a brand Qloo tags sparsely is still findable)
  const plain = brandRows({ results: [BODY.results[0], BODY.results[4]] }, "Topo Chico");
  assert.deepEqual(plain.map((r) => r.name), ["Topo Chico Spirited", "Topo Designs"]);
  // a row Qloo describes keeps its own line
  assert.equal(brandRows({ results: [e("Casamigos", ["urn:tag:genre:brand:wine_and_spirits:spirits:tequila"], { disambiguation: "Tequila brand" })] }, "casamigos")[0].where, "Tequila brand");
});

test("names fold accents, case and punctuation; a match needs the same name, its start or the same words", () => {
  assert.equal(fold("NÜTRL Vodka Seltzer"), "nutrl vodka seltzer");
  assert.equal(fold("Tito’s"), "titos");
  assert.equal(nameMatch("NÜTRL Vodka Seltzer", "nutrl"), 3);
  assert.equal(nameMatch("Michelob ULTRA", "michelob ultra"), 4);
  assert.equal(nameMatch("Tito's Vodka", "Tito's Handmade Vodka"), 2);
  assert.equal(nameMatch("Modelo", "Modelo Especial"), 2);
  assert.equal(nameMatch("Miller High Life", "High Noon"), 0);
  assert.equal(nameMatch("Noon", "High Noon"), 0, "one shared word is not the brand");
  assert.equal(pickBrand([{ name: "Miller High Life" }], "High Noon"), null);
});

test("High Noon (real Qloo answer): High Noon Sun Sips first, never Miller High Life", { skip: noFixtures }, () => {
  const rows = brandRows(real("high-noon"), "High Noon");
  assert.equal(rows[0].name, "High Noon Sun Sips");
  assert.equal(rows[0].where, "Hard seltzer");
  assert.equal(pickBrand(rows, "High Noon").name, "High Noon Sun Sips");
  // the answer without Sun Sips: Miller High Life is the top drink, and nothing picks it on its own
  const without = { results: real("high-noon").results.filter((r) => r.name !== "High Noon Sun Sips") };
  const rest = brandRows(without, "High Noon");
  assert.equal(rest[0].name, "Miller High Life");
  assert.equal(pickBrand(rest, "High Noon"), null);
});

test("Topo Chico and NÜTRL (real Qloo answers): the name match first, accents folded", { skip: noFixtures }, () => {
  const tc = brandRows(real("topo-chico"), "Topo Chico");
  assert.deepEqual(tc.slice(0, 2).map((r) => r.name), ["Topo Chico Hard Seltzer", "Topo Chico Spirited"]);
  assert.equal(pickBrand(tc, "Topo Chico").name, "Topo Chico Hard Seltzer");
  assert.ok(!tc.some((r) => /Chico's|Chicor|University/.test(r.name)), "fashion, beauty and a school go");
  const n = brandRows(real("nutrl"), "nutrl");
  assert.equal(pickBrand(n, "nutrl").name, "NÜTRL Vodka Seltzer");
  assert.equal(pickBrand(n, "Nütrl").name, "NÜTRL Vodka Seltzer");
});

test("the drink list in the page: prefix, words, near misses, accents; most popular first; 0 Qloo calls", { skip: noDrinks }, () => {
  const list = JSON.parse(readFileSync(DRINKS, "utf8"));
  const top = (q) => searchDrinks(list, q)[0]?.name;
  assert.equal(top("guiness"), "Guinness");
  assert.equal(top("high noon"), "High Noon Sun Sips");
  assert.equal(top("tito"), "Tito's Vodka");
  assert.deepEqual(searchDrinks(list, "nutrl").map((d) => d.name), ["NÜTRL Vodka Seltzer"], "near misses only when nothing matches");
  assert.equal(top("espolon"), "Espolòn Tequila");
  const c = searchDrinks(list, "c");
  assert.equal(c.length, 8);
  assert.ok(c.every((d) => fold(d.name).startsWith("c")), "every row starts with c");
  assert.deepEqual(c.map((d) => d.pop), [...c.map((d) => d.pop)].sort((a, b) => b - a), "most popular first");
  assert.ok(!list.some((d) => /^(Total Wine & More|BevMo!|DIAGEO|Diageo GB|Pernod Ricard|Brown-Forman)$/.test(d.name)), "no shops or parent companies");
});

test("the drink list keeps drinks and drops shops, parent companies and companies without a product", () => {
  const id = (n) => `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`;
  const rows = [
    { id: id(1), name: "High Noon Sun Sips", pop: 0.33, tags: ["urn:tag:industry:qloo:alcoholic_beverages", "urn:tag:product_category:qloo:hard_seltzer"] },
    { id: id(2), name: "Total Wine & More", pop: 0.82, tags: ["urn:tag:industry:qloo:retail", "urn:tag:industry:qloo:alcoholic_beverages", "urn:tag:industry:qloo:e_commerce"] },
    { id: id(3), name: "DIAGEO", pop: 0.65, tags: ["urn:tag:industry:qloo:alcoholic_beverages", "urn:tag:product_category:qloo:spirits"] },
    { id: id(4), name: "Brown-Forman", pop: 0.41, tags: ["urn:tag:industry:qloo:alcoholic_beverages"] },
    { id: id(5), name: "Magnolia", pop: 0.99, tags: ["urn:tag:genre:brand:wine_and_spirits:spirits:whiskey", "urn:tag:genre:brand:retail"] },
    { id: id(6), name: "Guinness", pop: 0.97, tags: ["urn:tag:genre:brand:wine_and_spirits:beer"] },
    { id: id(6), name: "Guinness", pop: 0.97, tags: ["urn:tag:industry:qloo:alcoholic_beverages"] },
  ];
  assert.deepEqual(makeDrinks(rows), [
    { id: id(6), name: "Guinness", kind: "Beer", pop: 0.97 },
    { id: id(1), name: "High Noon Sun Sips", kind: "Hard seltzer", pop: 0.33 },
  ]);
});

test("misspellings still find the drink: near misses from 4 letters, a wrong first letter, the whole text, the name's own words", { skip: noDrinks }, () => {
  const list = JSON.parse(readFileSync(DRINKS, "utf8"));
  const top = (q) => searchDrinks(list, q)[0]?.name;
  assert.equal(top("whte claw"), "White Claw");
  assert.equal(top("jamson"), "Jameson Irish Whiskey");
  assert.equal(top("modlo"), "Modelo");
  assert.equal(top("corona extra"), "Corona");
  assert.equal(top("hineken"), "Heineken");
  assert.equal(top("gorona"), "Corona", "a wrong first letter, 1 edit");
  assert.equal(top("highnoon"), "High Noon Sun Sips");
});

test("the brands Doors holds: one letter matches the start of a name only", () => {
  const held = [{ name: "Casamigos", qlooName: "Casamigos", category: "Tequila" }, { name: "Athletic Brewing", qlooName: "Athletic Brewing Co", category: "Non-alcoholic craft beer" }, { name: "Liquid Death", qlooName: "Liquid Death", category: "Canned water" }];
  assert.deepEqual(held.filter((b) => heldMatch(b, "c")).map((b) => b.name), ["Casamigos"]);
  assert.deepEqual(held.filter((b) => heldMatch(b, "ca")).map((b) => b.name), ["Casamigos", "Liquid Death"], "two letters: anywhere, kind too");
  assert.equal(held.filter((b) => heldMatch(b, "")).length, 3);
});
