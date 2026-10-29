// Group 3 lane B (Jard 10-24, GROUP3-SPEC #4–5): the product, the drinkers and an agreed ask before the plan; one
// brand, many cities; old saved plans cleared (store version 2, no migration).
import { test } from "node:test";
import assert from "node:assert/strict";
import { validateProfile, sampleProfile, emptyProfile, productFacts, productLine, drinkersLine, suggestAsk, ageOf, ageChoices, brandPart, cityPart, withBrand, CITY_KEYS, variantsOf, sellsOf } from "../public/lib/profile.js";
import { examples } from "../public/lib/examples.js";
import { demoProfile } from "../public/lib/demo-profile.js";
import { rankedIds, buildPool, labelDrinker } from "../public/lib/pool.js";
import { createStore, storeKey, BRAND_KEY, STORE_VERSION } from "../public/lib/store.js";
import { tapAsk, askUnit } from "../public/lib/ask.js";
import { packState, unpackState } from "../public/lib/carry.js";
import { parseHash } from "../public/lib/router.js";
import { readJson, route } from "./helpers.mjs";

const index = readJson("public/data/index.json");
const ctx = { cities: index.cities };
const TODAY = new Date(2026, 9, 21);
const memStorage = (init = {}) => {
  const m = new Map(Object.entries(init));
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } };
};

test("format and the ask are required; the rest of the product and the drinkers are optional", () => {
  const p = sampleProfile(TODAY);
  assert.deepEqual(validateProfile(p, ctx).errors, {});
  const noFormat = { ...p, product: { ...p.product, format: "" } };
  assert.equal(validateProfile(noFormat, ctx).errors.format, "Pick what it comes in.");
  const other = { ...p, product: { ...p.product, format: "other", formatOther: " " } };
  assert.equal(validateProfile(other, ctx).errors.format, "Say what it comes in.");
  assert.equal(validateProfile({ ...other, product: { ...other.product, formatOther: "pouches" } }, ctx).ok, true);
  const noAsk = { ...p, pitch: { ...p.pitch, ask: "  " } };
  assert.match(validateProfile(noAsk, ctx).errors.ask, /suggested ask, or write your own/);
  const bare = { ...p, product: { ...p.product, size: "", abv: "", sells: "", na: false }, pitch: { ...p.pitch, price: "" }, drinkers: undefined };
  assert.equal(validateProfile(bare, ctx).ok, true);
  assert.equal(validateProfile(emptyProfile(), ctx).errors.format, "Pick what it comes in.");
});

test("every example and the demo carry product details and an ask, and validate", () => {
  for (const x of examples(TODAY)) {
    assert.ok(productFacts(x.profile).format, `${x.key}: a format`);
    assert.ok(productLine(x.profile).length > 5, `${x.key}: ${productLine(x.profile)}`);
    assert.deepEqual(validateProfile(x.profile, ctx).errors, {}, x.key);
  }
  assert.equal(productLine(demoProfile(TODAY)), "12 oz cans · non-alcoholic (0.5%) · $38 a case of 24 · self-distributed");
  assert.equal(productLine(examples(TODAY).find((x) => x.key === "ben").profile), "sixtel keg · 6.2% ABV · $165 a sixtel, $44 a case of 24 · self-distributed");
  assert.equal(productLine(emptyProfile()), "");
});

test("Doors suggests an ask from the format, readable by lib/ask.js (a keg ask needs taps, a can ask takes the case price)", () => {
  const p = (format, what, size = "") => ({ ...emptyProfile(), what, product: { ...emptyProfile().product, format, size } });
  assert.equal(suggestAsk(p("cans", "Hazy IPA")), "one case of cans in the cooler");
  assert.equal(suggestAsk(p("cans", "Sparkling water")), "one case of cans in the cooler to try");
  assert.equal(suggestAsk(p("bottles", "Reposado tequila")), "one bottle for the back bar");
  assert.equal(suggestAsk(p("bottles", "Orange wine")), "a few bottles to try by the glass");
  assert.equal(suggestAsk(p("keg", "Dry cider")), "one sixtel on a guest tap line");
  assert.equal(suggestAsk(p("keg", "Pilsner", "half barrel")), "one half barrel on a guest tap line");
  assert.equal(suggestAsk(p("keg", "Pilsner", "50L")), "one 50l keg on a guest tap line");
  assert.equal(suggestAsk(p("", "Mezcal")), "one bottle for the back bar"); // no format: by what it is (talk.js)
  assert.ok(tapAsk(suggestAsk(p("keg", "Lager"))));
  assert.equal(askUnit(suggestAsk(p("cans", "Lager"))), "case");
  assert.equal(askUnit(suggestAsk(p("bottles", "Gin"))), "bottle");
});

test("the drinkers: a line for the Agent and talking points; 21–24 through 55 and over for every drink (r2)", () => {
  const base = { ...emptyProfile(), what: "Hazy IPA" };
  assert.equal(drinkersLine(base), "");
  const d = { ...base, drinkers: { who: "Craft beer fans", age: "25_34", where: "taprooms", basis: "known" } };
  assert.equal(drinkersLine(d), "Craft beer fans · 25–34 · taprooms (what I know)");
  assert.equal(ageOf(d), "25_34");
  assert.deepEqual(ageChoices(base).map((a) => a.label), ["21–24", "25–34", "35–44", "45–54", "55 and over"]);
  assert.equal(ageOf({ ...base, drinkers: { age: "under_25" } }), "under_25");
  assert.equal(drinkersLine({ ...base, drinkers: { age: "55_plus", basis: "guess" } }), "55 and over (my best guess)");
});

test("the age range narrows Qloo's list: that band's doors first, then the rest; the plan label says so", () => {
  const r = route("athletic-brewing-austin");
  const all = rankedIds(r);
  const aged = rankedIds(r, { age: "35_44" });
  const band = r.lists["35_44"].map((x) => x[0]);
  assert.deepEqual(aged.slice(0, band.length), band);
  assert.equal(new Set(aged).size, aged.length);
  assert.ok(all.every((id) => aged.includes(id)));
  assert.notDeepEqual(aged.slice(0, 10), all.slice(0, 10));
  assert.deepEqual(rankedIds(r, { age: "no_such" }), all);
  const p = sampleProfile(TODAY);
  const plain = buildPool({ routes: [r], profile: p, cityName: "Austin" });
  const old = buildPool({ routes: [r], profile: { ...p, drinkers: { age: "35_44" } }, cityName: "Austin" });
  assert.match(old.label, /, aged 35–44$/);
  assert.notDeepEqual(old.ids.slice(0, 5), plain.ids.slice(0, 5));
  assert.equal(labelDrinker(old.label), labelDrinker(plain.label));
  assert.doesNotMatch(plain.label, /aged/); // no age: the demo's plan and its proof stay as they were
});

test("one brand, many cities: split and put back together", () => {
  const p = demoProfile(TODAY);
  const b = brandPart(p);
  const c = cityPart(p);
  for (const k of CITY_KEYS) assert.ok(!(k in b), k);
  assert.equal(b.brand, "Tidewell");
  assert.equal(c.city, "austin");
  assert.deepEqual(withBrand(b, c), { ...emptyProfile(), ...p });
  const fresh = withBrand(b, null);
  assert.equal(fresh.city, "");
  assert.deepEqual(fresh.windows, []);
  assert.equal(fresh.start, null);
  assert.equal(fresh.pitch.ask, p.pitch.ask);
  assert.deepEqual(fresh.product, p.product);
});

test("store v3 (the usual week): plans saved before it are cleared on open (no migration); the brand has its own key", () => {
  assert.equal(STORE_VERSION, 3);
  const old = { v: 2, brand: "Tidewell", city: "austin", profile: { brand: "Tidewell" } };
  const draft = { v: 1, brand: "draft", city: "", profile: { brand: "Half typed" }, statuses: {} };
  const keep = { "doors.v2.live.abc": JSON.stringify({ v: 1, route: {} }), "doors.v2.chat.Tidewell-austin": "[]", "doors.v2.demo": JSON.stringify({ v: 1, phase: "form" }), "doors.v2.built": "sig", "doors.v2.ticks": "{bad json" };
  const s = memStorage({ [storeKey("Tidewell", "austin")]: JSON.stringify({ ...old, statuses: {} }), [storeKey("draft", "")]: JSON.stringify(draft), "doors.rules.v1.tidewell": "[]", "doors:nav-app": "waze", ...keep });
  const store = createStore(s);
  assert.equal(s.m.has(storeKey("Tidewell", "austin")), false);
  assert.equal(s.m.has(storeKey("draft", "")), false);
  for (const k of Object.keys(keep)) assert.ok(s.m.has(k), `${k} is no plan: kept`); // the live-run cache above all
  assert.equal(s.m.get("doors.rules.v1.tidewell"), "[]"); // rules and the navigation app are no plans
  assert.equal(s.m.get("doors:nav-app"), "waze");
  assert.deepEqual(store.list(), []);
  assert.equal(store.getBrand(), null);
  store.setBrand(brandPart(demoProfile(TODAY)));
  store.save("Tidewell", "austin", { profile: demoProfile(TODAY) });
  assert.equal(store.getBrand().brand, "Tidewell");
  assert.equal(store.list().length, 1); // the brand record is no city
  const again = createStore(s); // a reload keeps version 2
  assert.equal(again.list().length, 1);
  assert.equal(again.getBrand().product.format, "cans");
  again.setBrand(null);
  assert.equal(s.m.has(BRAND_KEY), false);
});

test("a carried plan comes back as this store version; the new routes parse", () => {
  const st = { v: STORE_VERSION, brand: "Tidewell", city: "austin", profile: demoProfile(TODAY), plan: null, statuses: {}, outcomes: {}, slots: {} };
  assert.equal(unpackState(packState(st)).state.v, STORE_VERSION);
  assert.deepEqual(parseHash("#/city?city=austin"), { name: "city", params: { city: "austin" }, known: true });
  assert.equal(parseHash("#/brand").name, "brand");
  assert.equal(parseHash("#/cities").name, "cities");
});

test("r2: several variations, and how you sell is the city's (both allowed)", () => {
  const p = { ...emptyProfile(), product: { ...emptyProfile().product, format: "cans", size: "12 oz", abv: "5%" }, pitch: { ...emptyProfile().pitch, price: "$42 a case of 24" } };
  assert.equal(productLine(p), "12 oz cans · 5% ABV · $42 a case of 24");
  const two = { ...p, variants: [{ format: "keg", size: "sixtel", price: "$165 a sixtel" }, { format: "", size: "" }], sells: ["distributor", "self"] };
  assert.equal(productLine(two), "12 oz cans · 5% ABV · $42 a case of 24; sixtel keg · $165 a sixtel · self-distributed and through a distributor");
  assert.equal(variantsOf(two).length, 2, "an empty further variation is left out");
  assert.deepEqual(sellsOf({ product: { sells: "self" } }), ["self"], "a profile saved before r2");
  assert.ok(CITY_KEYS.includes("sells"));
  assert.deepEqual(cityPart(two).sells, ["distributor", "self"]);
  assert.equal(brandPart(two).sells, undefined);
  const ctx = { cities: [{ key: "austin", name: "Austin", center: [30.27, -97.74] }] };
  const bad = { ...sampleProfile(), variants: [{ size: "16 oz" }] };
  assert.match(validateProfile(bad, ctx).errors.format, /variation 2/);
});
