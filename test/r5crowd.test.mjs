// Round 5 lane crowd (Jard 10-27): #2a a live city's crowd base is its own run (Cincinnati showed "0 doors Qloo
// describes" and every cloud "no group stands out" because the base read the baked brands alone); #1 the Who view's
// empty state says its one sentence once and names no "0 doors"; the drinkers icon is in the set.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cityRouteFiles } from "../public/lib/live.js";
import { liftModel } from "../public/lib/whyviz/lift.js";
import { liftWords, plain } from "../public/lib/whyviz/words.js";
import { areasModel } from "../public/lib/whyviz/areas.js";
import { cityRooms } from "../public/lib/insights.js";
import { ICONS, icon } from "../public/lib/icons.js";
import { readJson } from "./helpers.mjs";

test("r5 #2a: cityRouteFiles: the baked brands' files and a primed live run's alike, by city", () => {
  const idx = readJson("public/data/index.json");
  const austin = cityRouteFiles(idx, "austin");
  assert.ok(austin.length >= 8, `austin ${austin.length}`);
  assert.ok(austin.every((f) => f.endsWith("-austin")));
  assert.deepEqual(cityRouteFiles(idx, "cincinnati-oh"), []);
  const primed = { ...idx, files: [...idx.files, "budweiser-cincinnati-oh"] }; // lib/live.js primeLive
  assert.deepEqual(cityRouteFiles(primed, "cincinnati-oh"), ["budweiser-cincinnati-oh"]);
  assert.deepEqual(cityRouteFiles(primed, ""), []);
  assert.deepEqual(cityRouteFiles(null, "austin"), []);
});

// a live run shaped like Cincinnati's: 12 ranked doors in two neighbourhoods, Qloo's crowd text on each
function liveRun() {
  const at = (i) => (i < 6 ? { lat: 39.10 + i * 0.002, lon: -84.51 + i * 0.002 } : { lat: 39.16 + (i - 6) * 0.002, lon: -84.43 + (i - 6) * 0.002 });
  const text = (i) => (i < 6 ? "The crowd is mostly young professionals and locals after work." : i < 10 ? "Popular with students and college groups, plus locals." : "Families and locals on weekends.");
  const venues = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`D${i}`, { name: `Door ${i}`, ...at(i), crowd: text(i), primary_genre: "urn:tag:genre:place:bar" }]));
  const route = { drinker: { key: "budweiser", name: "Budweiser" }, lists: { all: Object.keys(venues).map((id, i) => [id, 0.9 - i * 0.01]), famous: [] }, venues, culture: { heat: [{ name: "Downtown", lat: 39.105, lon: -84.505 }, { name: "Clifton", lat: 39.165, lon: -84.425 }] } };
  return route;
}

test("r5 #2a: a live run as the base: the city's neighbourhoods get a real group instead of all 'no group stands out'", () => {
  const r = liveRun();
  const base = cityRooms([r]);
  assert.equal(base.ids.length, 12);
  const places = r.lists.all.map(([id], i) => ({ id, name: r.venues[id].name, lat: r.venues[id].lat, lon: r.venues[id].lon, fate: i < 6 ? "plan" : "route", rank: i + 1 }));
  const m = areasModel({ places, venues: r.venues, hoods: r.culture.heat, base, poolIds: base.ids, cityName: "Cincinnati" });
  assert.equal(m.baseN, 12);
  assert.equal(m.describedN, 12);
  assert.equal(m.areas.length, 2);
  assert.equal(m.named, 2, "both neighbourhoods have a character");
  const by = Object.fromEntries(m.areas.map((a) => [a.name, a.cls]));
  assert.equal(by.Downtown, "work");
  assert.equal(by.Clifton, "visitors");
  // the same places over an empty base (the bug): every area "no group stands out"
  const empty = areasModel({ places, venues: r.venues, hoods: r.culture.heat, base: { ids: [], venues: {} }, poolIds: base.ids, cityName: "Cincinnati" });
  assert.equal(empty.named, 0);
  assert.equal(empty.describedN, 0);
});

test("r5 #1: the Who view with no rows says its sentence once and never '0 doors Qloo describes'", () => {
  const none = liftModel({ planIds: ["A"], venues: { A: { crowd: "" } }, base: { ids: [], venues: {} }, cityName: "Cincinnati" });
  assert.equal(none.rows.length, 0);
  assert.equal(none.baseN, 0);
  const s = plain(liftWords(none));
  assert.equal(s, "Qloo names no crowd group at two or more of your plan's 0 doors yet.");
  assert.ok(!/0 doors Qloo describes/.test(s));
});

test("r5 #1: the drinkers icon is in the Doors set (24 grid, stroked) and renders", () => {
  assert.ok(ICONS.drinkers?.body.includes("<path"));
  assert.equal(ICONS.drinkers.label, "Your drinkers");
  const svg = icon("drinkers", 20);
  assert.ok(svg.startsWith("<svg") && svg.includes('viewBox="0 0 24 24"') && svg.includes('stroke-width="2"'));
});
