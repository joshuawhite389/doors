// Delete (Jard 10-29: "i need a way to delete profiles/ brands/ cities that i've made"): store.drop deletes a city or a
// brand with its cities, rules and record, and its undo writes back exactly what went; My cities groups by brand.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createStore, storeKey, rulesKey, BRAND_KEY } from "../public/lib/store.js";
import { groupPlans, deleteCityAsk, deleteBrandAsk, deletedCity, deletedBrand, applyBrand } from "../public/lib/plans.js";

const memStorage = () => {
  const m = new Map();
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } };
};
const prof = (brand, city) => ({ brand, city, windows: [{ date: "2026-11-03" }] });
function seeded() {
  const storage = memStorage();
  const s = createStore(storage);
  s.setBrand({ brand: "Very Good Beer" });
  for (const [b, c] of [["Very Good Beer", "cincinnati"], ["Very Good Beer", "dayton"], ["THIS", "dayton"], ["THIS", "austin"]]) {
    s.save(b, c, { profile: prof(b, c), statuses: { v1: "visited" }, outcomes: { v1: { result: "followup", note: "call Tue" } }, activity: [{ seq: 1, kind: "status" }] });
  }
  s.setRules("Very Good Beer", [{ field: "rule.avoid", value: "dive bars" }]);
  s.save("draft", "", { profile: prof("THIS", "") });
  storage.setItem("doors.v2.live.x", "{}"); // a live run's cache: never touched
  return { storage, s };
}

test("drop a city: that plan (statuses, outcomes, log) goes; the rest and the brand stay; undo puts it back", () => {
  const { storage, s } = seeded();
  const before = new Map(storage.m);
  const undo = s.drop({ brand: "Very Good Beer", city: "cincinnati" });
  assert.equal(storage.getItem(storeKey("Very Good Beer", "cincinnati")), null);
  assert.equal(s.load("Very Good Beer", "cincinnati").profile, null);
  assert.deepEqual(s.list().map((r) => `${r.brand}/${r.city}`).sort(), ["THIS/austin", "THIS/dayton", "Very Good Beer/dayton"]);
  assert.equal(s.getBrand().brand, "Very Good Beer");
  assert.equal(s.getRules("Very Good Beer").length, 1);
  undo();
  assert.deepEqual(new Map(storage.m), before);
});

test("drop a brand: every city of it, its rules and its record go; other brands, the draft and caches stay; undo", () => {
  const { storage, s } = seeded();
  const before = new Map(storage.m);
  const undo = s.drop({ brand: "Very Good Beer", city: null });
  assert.deepEqual(s.list().map((r) => `${r.brand}/${r.city}`).sort(), ["THIS/austin", "THIS/dayton"]);
  assert.equal(storage.getItem(BRAND_KEY), null);
  assert.equal(storage.getItem(rulesKey("Very Good Beer")), null);
  assert.ok(storage.getItem("doors.v2.live.x"));
  assert.ok(s.load("draft", "").profile);
  undo();
  assert.deepEqual(new Map(storage.m), before);
});

test("drop a brand that isn't the saved one keeps the saved brand", () => {
  const { s } = seeded();
  s.drop({ brand: "this", city: null }); // case doesn't matter
  assert.deepEqual(s.list().map((r) => r.brand), ["Very Good Beer", "Very Good Beer"]);
  assert.equal(s.getBrand().brand, "Very Good Beer");
});

test("drop works with storage blocked (memory only) and survives a reopen when it isn't", () => {
  const { storage, s } = seeded();
  s.drop({ brand: "THIS", city: "austin" });
  assert.equal(createStore(storage).list().length, 3);
  const mem = createStore(null);
  mem.save("A", "x", { profile: prof("A", "x") });
  const undo = mem.drop({ brand: "A", city: null });
  assert.equal(mem.list().length, 0);
  undo();
  assert.equal(mem.list().length, 1);
});

test("groupPlans: the saved brand first even with no city, then the others; rows keep their order", () => {
  const { s } = seeded();
  s.drop({ brand: "Very Good Beer", city: "cincinnati" });
  s.drop({ brand: "Very Good Beer", city: "dayton" });
  const g = groupPlans(s.list(), s.getBrand());
  assert.deepEqual(g.map((x) => [x.name, x.saved, x.rows.length]), [["Very Good Beer", true, 0], ["THIS", false, 2]]);
  assert.deepEqual(groupPlans([], null), []);
});

test("plain words for the ask and the toast", () => {
  assert.equal(deleteCityAsk("Very Good Beer", "Cincinnati"), "Delete Very Good Beer in Cincinnati? Its plan, visits and notes on this device go too.");
  assert.equal(deleteBrandAsk("THIS", 2), "Delete THIS and its 2 cities? Their plans, visits and notes on this device go too.");
  assert.equal(deleteBrandAsk("THIS", 1), "Delete THIS and its 1 city? Their plans, visits and notes on this device go too.");
  assert.equal(deletedCity("THIS", "Dayton"), "Deleted THIS in Dayton.");
  assert.equal(deletedBrand("THIS", 2), "Deleted THIS and its 2 cities.");
});

test("every place that lists plans reaches Delete: Menu, Settings, Edit my brand, a city's form, the landing", () => {
  const plan = readFileSync(new URL("../public/ui/plan.js", import.meta.url), "utf8");
  const app = readFileSync(new URL("../public/ui/app.js", import.meta.url), "utf8");
  const landing = readFileSync(new URL("../public/ui/landing.js", import.meta.url), "utf8");
  assert.match(plan, /class="mi" href="\$\{CITIES_HREF\}"><b>My cities<\/b>/);
  assert.match(plan, /Delete this city/);
  assert.match(app, /label: "Delete this brand"/);
  assert.match(app, /label: "Delete this city"/);
  assert.match(landing, /href="\/app#\/cities">Edit or delete/);
});

test("Edit my brand writes into that brand's cities only: another brand's cities stay byte for byte", () => {
  const { storage, s } = seeded();
  const other = new Map([...storage.m].filter(([k]) => k.startsWith("doors.v2.this-")));
  const was = s.getBrand();
  applyBrand(s, { ...was, what: "Hazy lager" }, was);
  for (const [k, v] of other) assert.equal(storage.getItem(k), v, `${k} untouched`);
  for (const c of ["cincinnati", "dayton"]) {
    const st = s.load("Very Good Beer", c);
    assert.equal(st.profile.what, "Hazy lager");
    assert.equal(st.profile.city, c);
    assert.equal(st.statuses.v1, "visited"); // its visits stay
  }
});

test("a renamed brand moves its own cities and rules; the other brand (even sharing a city) stays", () => {
  const { storage, s } = seeded();
  const other = new Map([...storage.m].filter(([k]) => k.startsWith("doors.v2.this-")));
  const was = s.getBrand();
  applyBrand(s, { ...was, brand: "Good Beer Co" }, was);
  assert.deepEqual(s.list().map((r) => `${r.brand}/${r.city}`).sort(), ["Good Beer Co/cincinnati", "Good Beer Co/dayton", "THIS/austin", "THIS/dayton"]);
  for (const [k, v] of other) assert.equal(storage.getItem(k), v, `${k} untouched`);
  assert.equal(s.getRules("Good Beer Co").length, 1);
  assert.equal(s.getRules("Very Good Beer").length, 0);
  assert.equal(s.load("Good Beer Co", "dayton").outcomes.v1.note, "call Tue");
});

test("applyBrand's except skips that city of the brand only", () => {
  const { s } = seeded();
  const was = s.getBrand();
  applyBrand(s, { ...was, what: "Pils" }, was, { except: "dayton" });
  assert.equal(s.load("Very Good Beer", "cincinnati").profile.what, "Pils");
  assert.notEqual(s.load("Very Good Beer", "dayton").profile.what, "Pils");
  assert.notEqual(s.load("THIS", "dayton").profile.what, "Pils");
});

test("the app saves the brand through applyBrand, and a delete clears that city's Agent chat (Undo puts it back)", () => {
  const app = readFileSync(new URL("../public/ui/app.js", import.meta.url), "utf8");
  assert.match(app, /return applyBrand\(store, next, savedBrand\(\), \{ except \}\);/);
  assert.doesNotMatch(app, /for \(const row of store\.list\(\)\) \{\n\s+if \(except/); // the old every-city loop is gone
  assert.match(app, /sessionStorage\.removeItem\(k\)/);
  assert.match(app, /chats\.forEach\(\(\[k, v\]\) => sessionStorage\.setItem\(k, v\)\)/);
});
