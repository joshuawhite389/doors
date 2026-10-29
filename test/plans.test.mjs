// G7 "Your plans": store.list() (every saved brand-city plan, newest first, never the form's draft), the list rows,
// and the profile "Duplicate" starts from.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore, listPlans, storeKey } from "../public/lib/store.js";
import { planRow, copyProfile, planHref, editHref, DEMO_EDIT, HOME_HREF, BRAND_HREF, CITIES_HREF, ADD_CITY } from "../public/lib/plans.js";
import { parseHash } from "../public/lib/router.js";
import { emptyProfile } from "../public/lib/profile.js";

const mem = () => {
  const m = new Map();
  return { m, getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } };
};
const CITIES = [{ key: "austin", name: "Austin" }, { key: "chicago", name: "Chicago" }];
const START = { label: "E Cesar Chavez St", lat: 30.2556, lon: -97.7208, source: "geocode" };
const prof = (brand, city, dates = ["2026-10-13", "2026-10-14"]) => ({
  ...emptyProfile(), brand, city, what: "Non-alcoholic hazy IPA", start: START, known: ["room-1"],
  windows: dates.map((date, i) => ({ date, from: "14:00", to: "18:00", ...(i ? { start: { ...START, source: "pin" } } : {}) })),
  pitch: { price: "$42 a case", ask: "one case", support: ["samples"] },
});
const at = (iso, f) => { const real = Date.prototype.toISOString; Date.prototype.toISOString = function () { return iso; }; try { return f(); } finally { Date.prototype.toISOString = real; } };

test("list: every saved plan, newest first; the draft, empty states and other keys are left out", () => {
  const storage = mem();
  const store = createStore(storage);
  at("2026-10-08T10:00:00.000Z", () => store.save("Tidewell", "austin", { profile: prof("Tidewell", "austin") }));
  at("2026-10-09T10:00:00.000Z", () => store.save("Tidewell", "chicago", { profile: prof("Tidewell", "chicago", ["2026-10-20"]) }));
  store.save("draft", "", { profile: prof("Half typed", "") });
  store.save("Nothing", "austin", { statuses: { a: "visited" } }); // no profile: not a plan
  storage.setItem(`${storeKey("junk", "x")}`, "{not json");
  storage.setItem("doors.v2.built", "sig");
  const rows = createStore(storage).list(); // a new session reads the same list
  assert.deepEqual(rows.map((r) => [r.brand, r.city, r.days, r.from, r.to]), [
    ["Tidewell", "chicago", 1, "2026-10-20", "2026-10-20"],
    ["Tidewell", "austin", 2, "2026-10-13", "2026-10-14"],
  ]);
  assert.equal(rows[1].profile.pitch.price, "$42 a case");
});

test("list follows saves and removes in the same session, storage blocked too", () => {
  const boom = () => { throw new Error("blocked"); };
  const store = createStore({ getItem: boom, setItem: boom, removeItem: boom, key: boom, length: 0 });
  assert.deepEqual(store.list(), []);
  store.save("Tidewell", "austin", { profile: prof("Tidewell", "austin") });
  store.save("Tidewell", "chicago", { profile: prof("Tidewell", "chicago") });
  assert.equal(store.list().length, 2);
  store.remove("Tidewell", "austin");
  assert.deepEqual(store.list().map((r) => r.city), ["chicago"]);
});

test("rebuilding the same brand and city updates one plan and keeps its statuses; a new city is a second plan", () => {
  const store = createStore(mem());
  store.update("Tidewell", "austin", (st) => ({ ...st, profile: prof("Tidewell", "austin") }));
  store.setStatus("Tidewell", "austin", "room-2", "visited");
  store.setOutcome("Tidewell", "austin", "room-2", { tags: ["sample"] });
  // Edit profile → Build again with one more day (what app.js onBuild does)
  store.update("Tidewell", "austin", (st) => ({ ...st, profile: prof("Tidewell", "austin", ["2026-10-13", "2026-10-14", "2026-10-15"]), current: null }));
  assert.equal(store.list().length, 1);
  const st = store.load("Tidewell", "austin");
  assert.equal(st.statuses["room-2"], "visited");
  assert.deepEqual(st.outcomes["room-2"], { tags: ["sample"] });
  assert.equal(store.list()[0].days, 3);
  store.update("Tidewell", "chicago", (s) => ({ ...s, profile: prof("Tidewell", "chicago") }));
  assert.deepEqual(store.list().map((r) => r.city).sort(), ["austin", "chicago"]);
});

test("listPlans ties on time sort by brand", () => {
  const s = (brand) => ({ brand, city: "austin", profile: prof(brand, "austin"), savedAt: "2026-10-09T00:00:00.000Z" });
  assert.deepEqual(listPlans([s("Zed"), s("Alder"), null]).map((r) => r.brand), ["Alder", "Zed"]);
});

test("planRow: brand, city name, days, opened date, and links that route back to the plan", () => {
  const row = { brand: "Tidewell", city: "austin", profile: prof("Tidewell", "austin"), days: 2, from: "2026-10-13", to: "2026-10-14", savedAt: "2026-10-09T15:00:00.000Z" };
  const r = planRow(row, CITIES);
  assert.equal(r.name, "Tidewell");
  assert.equal(r.city, "Austin");
  assert.equal(r.days, "2 days · Tue Oct 13 – Wed Oct 14");
  assert.match(r.opened, /^Opened Oct \d+$/);
  assert.deepEqual(parseHash(r.open), { name: "plan", params: { brand: "Tidewell", city: "austin" }, known: true });
  assert.deepEqual(parseHash(r.edit), { name: "city", params: { city: "austin" }, known: true }); // group 3 #5: Edit a city
  assert.equal(planRow({ ...row, days: 1, to: row.from }, CITIES).days, "1 day · Tue Oct 13");
  assert.equal(planRow({ ...row, days: 0, from: null, to: null, city: "nowhere" }, CITIES).days, "No days set");
  assert.equal(planRow({ ...row, profile: { ...row.profile, brand: "" }, brand: "my brand" }, CITIES).name, "my brand");
  // L1: a live city is named by the profile's own name for it
  assert.equal(planRow({ ...row, city: "denver-co", profile: { ...row.profile, city: "denver-co", cityName: "Denver, CO", cityLive: true } }, CITIES).city, "Denver, CO");
});

test("copyProfile: a live city's name, flag and centre go with the city", () => {
  const c = copyProfile({ ...prof("Tidewell", "denver-co"), cityName: "Denver, CO", cityLive: true, cityCenter: [39.74, -104.99] });
  assert.deepEqual([c.city, c.cityName, c.cityLive, c.cityCenter], ["", undefined, undefined, undefined]);
});

test("edit links: a city's form, Edit my brand, My cities, Add a city; the demo's plan asks for the sample brand", () => {
  assert.deepEqual(parseHash(editHref("my brand", "austin")), { name: "city", params: { city: "austin" }, known: true });
  assert.equal(parseHash(planHref("A&B", "austin")).params.brand, "A&B");
  assert.deepEqual([BRAND_HREF, CITIES_HREF, ADD_CITY].map((h) => parseHash(h).name), ["brand", "cities", "city"]);
  assert.deepEqual(parseHash(DEMO_EDIT), { name: "edit", params: { demo: "1" }, known: true });
});

test("copyProfile keeps the brand and the days, drops everything tied to the old city, and leaves the original alone", () => {
  const p = { ...prof("Tidewell", "austin"), sample: true };
  const c = copyProfile(p);
  assert.equal(c.brand, "Tidewell");
  assert.equal(c.city, "");
  assert.equal(c.start, null);
  assert.deepEqual(c.known, []);
  assert.equal(c.sample, undefined);
  assert.deepEqual(c.windows, [{ date: "2026-10-13", from: "14:00", to: "18:00" }, { date: "2026-10-14", from: "14:00", to: "18:00" }]);
  assert.deepEqual(c.pitch, p.pitch);
  assert.equal(p.city, "austin");
  assert.ok(p.windows[1].start);
});

test("doors a day (J2) is saved with the plan and kept by Duplicate", () => {
  const store = createStore(null);
  const p = { ...emptyProfile(), brand: "Tidewell", city: "austin", maxPerDay: 4, maxByDate: { "2026-10-15": 6 } };
  store.update("Tidewell", "austin", (s) => ({ ...s, profile: p }));
  assert.deepEqual([store.load("Tidewell", "austin").profile.maxPerDay, store.load("Tidewell", "austin").profile.maxByDate], [4, { "2026-10-15": 6 }]);
  const c = copyProfile(p);
  assert.deepEqual([c.maxPerDay, c.maxByDate], [4, { "2026-10-15": 6 }]);
});

test("the logo's home link is the landing", () => {
  assert.equal(new URL(HOME_HREF, "https://d.example").pathname, "/");
});
