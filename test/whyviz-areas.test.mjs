// WHY-VIZ-SPEC §4.2 (lane 2): the neighbourhood clouds' model on the demo bake. Every door Qloo ranked for the
// drinker grouped under Qloo's own neighbourhoods (the heat map) within 3 km; an area needs 3 doors; a group counts
// with 2 doors and ×1.4 the city; the character is the top classed group. The counts in the tooltip equal
// lib/insights.js crowd() on the same doors; the fallbacks (Qloo's neighbourhood field, a grid) draw too. No network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { demoContext } from "./agent-fixture.mjs";
import { route, city, readJson } from "./helpers.mjs";
import { sieve } from "../public/lib/sieve.js";
import { cityRooms, crowd } from "../public/lib/insights.js";
import { heatFor } from "../public/lib/culture.js";
import { areasModel, areasWords, areaLine, areaTip, hull, hullRing, CLASSES, CLASS_OF, classOf, MIN_DOORS, MIN_NAMED, MIN_LIFT } from "../public/lib/whyviz/areas.js";
import { pillsShown } from "../public/ui/whyviz/areas.js";
import { plain } from "../public/lib/whyviz/words.js";

const austin = route("athletic-brewing-austin"), c = city("austin");
let cache = null;
async function demo() {
  if (cache) return cache;
  const { plan } = await demoContext();
  const idx = readJson("public/data/index.json");
  const files = idx.brands.map((b) => `${b.key}-austin`).filter((f) => idx.files.includes(f)).map(route);
  const base = cityRooms(files);
  const ids = new Set(base.ids), venues = { ...base.venues };
  for (const r of files) for (const row of r.lists?.famous ?? []) if (r.venues?.[row[0]]) (ids.add(row[0]), (venues[row[0]] = r.venues[row[0]]));
  const baseAll = { ids: [...ids], venues };
  const sv = sieve({ route: austin, plan, profile: plan.profile, city: c });
  const hoods = heatFor(readJson("public/data/culture/heat.json"), [austin], "austin");
  const places = [...sv.dots, ...sv.extras];
  const allV = { ...austin.venues, ...plan.venues };
  const m = areasModel({ places, venues: allV, hoods, base: baseAll, poolIds: plan.pool.ids, cityName: "Austin" });
  return (cache = { plan, sv, hoods, places, allV, baseAll, m });
}

test("areas: the demo bake (golden): 15 heat hoods, 12 clouds, Downtown an after-work crowd, East Cesar Chavez a music scene with 7 plan doors, Mueller and East Congress craft beer country", async () => {
  const { m, hoods } = await demo();
  assert.equal(m.source, "heat");
  assert.equal(m.hoodsN, 15);
  assert.equal(hoods.length, 15);
  assert.ok(m.baseN >= 400, `base ${m.baseN}`);
  assert.ok(m.describedN >= 350 && m.describedN <= m.baseN, `described ${m.describedN}`);
  assert.equal(m.areas.length, 12);
  assert.equal(m.named, 11);
  const by = Object.fromEntries(m.areas.map((a) => [a.name, a]));
  assert.equal(by.Downtown.cls, "work");
  assert.equal(by.Downtown.rank, 1);
  assert.equal(by.Downtown.n, 23);
  assert.equal(by["East Cesar Chavez"].cls, "music");
  assert.equal(by["East Cesar Chavez"].planN, 7);
  assert.equal(by["East Cesar Chavez"].groups.find((g) => g.key === "music").n, 4);
  assert.equal(by.Mueller.cls, "beer");
  assert.equal(by["East Congress"].cls, "beer");
  assert.equal(by["Travis Heights"].cls, null, "no group stands out");
  for (const a of m.areas) {
    assert.ok(a.n >= MIN_DOORS);
    assert.ok(a.doors.every((d) => Number.isFinite(d.lat)));
    for (const g of a.groups) { assert.ok(g.n >= MIN_NAMED); assert.ok(g.lift >= MIN_LIFT); assert.equal(g.cls, CLASS_OF[g.key] ?? null); }
    if (a.top) assert.equal(a.top, a.groups.find((g) => g.cls));
    assert.ok(a.hull.length >= 3);
    assert.ok(a.radiusKm <= 3.5, `${a.name} radius ${a.radiusKm}`);
  }
  // named areas first, biggest first
  assert.ok(m.areas.slice(0, m.named).every((a) => a.top));
});

test("areas: the tooltip's counts equal crowd() on the same doors over the same base", async () => {
  const { m, allV, baseAll } = await demo();
  for (const a of m.areas) {
    const cr = crowd(a.doors.map((d) => d.id), allV, { base: baseAll.ids, baseVenues: baseAll.venues, min: 2 });
    for (const g of a.groups) {
      const t = cr.terms.find((x) => x.key === g.key);
      assert.equal(g.n, t.ids.length, `${a.name} ${g.key}`);
      assert.ok(Math.abs(g.lift - t.share / t.base) < 1e-9);
    }
    const tip = areaTip(a, m);
    assert.equal(tip[0][0], a.name);
    assert.match(tip[0][1], new RegExp(`^#${a.rank} of 15 on Qloo's heat map for your drinker$`));
    assert.match(tip[1][0], new RegExp(`^${a.n} ranked doors here$`));
    assert.match(tip.at(-1)[0], new RegExp(`^${a.planN} on your plan · ${a.listN} on Your list$`));
    for (const row of tip.slice(2, -1)) assert.match(row[1], /^×\d+\.\d the city$/);
  }
});

test("areas: the sentence and the rows hold only the model's numbers", async () => {
  const { m } = await demo();
  const s = plain(areasWords(m));
  assert.match(s, /^Qloo's crowd descriptions make 11 neighbourhoods with a character of their own out of your drinker's Austin: Downtown is an after-work crowd \(cocktail lovers ×2\.3 the city\), East Cesar Chavez is a music scene \(live music fans ×4\.2 the city\) and Highland is craft beer country \(craft beer fans ×6\.2 the city\)\. Hover a cloud for who goes out there and how many of your doors it holds\.$/);
  const by = Object.fromEntries(m.areas.map((a) => [a.name, a]));
  assert.equal(areaLine(by.Mueller), "7 doors, 3 breweries and 2 bars. Craft beer country: craft beer fans ×9.4 the city and dog owners ×5.5 the city. 4 on your plan.");
  assert.equal(areaLine(by["Travis Heights"]), "4 doors, 3 restaurants and 1 bar. No group stands out against the city. None on your plan.");
  assert.match(areaLine(by["East Cesar Chavez"]), /^17 doors, 11 bars and 4 restaurants\. A music scene: live music fans ×4\.2 the city\. 7 on your plan\.$/);
  // the words say a class only from the table
  for (const a of m.areas.filter((x) => x.top)) assert.ok(CLASSES.some((cl) => areaLine(a).startsWith(`${a.n} doors`) && areaLine(a).includes(`${classOf(a.cls).word[0].toUpperCase()}${classOf(a.cls).word.slice(1)}:`)));
});

test("areas: fallbacks: no heat run → Qloo's neighbourhood field; none → a 1.5 km grid; nothing ranked → no clouds, the sentence says so", async () => {
  const { places, allV, baseAll, plan } = await demo();
  const nb = areasModel({ places, venues: allV, hoods: null, base: baseAll, poolIds: plan.pool.ids, cityName: "Austin" });
  assert.equal(nb.source, "neighborhood");
  assert.ok(nb.areas.length >= 5);
  assert.ok(nb.areas.every((a) => a.name && a.rank === null));
  const noNb = Object.fromEntries(Object.entries(allV).map(([k, v]) => [k, { ...v, neighborhood: null }]));
  const gr = areasModel({ places, venues: noNb, hoods: null, base: baseAll, poolIds: plan.pool.ids, cityName: "Austin" });
  assert.equal(gr.source, "grid");
  assert.ok(gr.areas.length >= 5);
  assert.ok(gr.areas.every((a) => a.name === null));
  assert.match(areaTip(gr.areas[0], gr)[0][0], /^No name for this part of town$/);
  const none = areasModel({ places: [], venues: {}, hoods: null, base: baseAll, cityName: "Boise" });
  assert.deepEqual(none.areas, []);
  assert.equal(plain(areasWords(none)), "No part of Boise holds 3 or more of the doors Qloo ranked for your drinker, so there are no clouds to draw.");
  const two = areasModel({ places: places.slice(0, 7), venues: allV, hoods: null, base: baseAll, cityName: "Austin" });
  if (two.areas.length && two.areas.length < 3 && two.named) assert.match(plain(areasWords(two)), /Only \d parts? of Austin holds? 3 or more/);
});

test("areas: hull and the hover ring; pills never overlap or leave the map", () => {
  const sq = hull([[0, 0], [1, 0], [1, 1], [0, 1], [0.5, 0.5], [0.2, 0.7]]);
  assert.equal(sq.length, 4);
  assert.deepEqual(hull([[0, 0], [1, 1]]), [[0, 0], [1, 1]]);
  const a = { lat: 30.27, lon: -97.74, hull: [[-97.75, 30.26], [-97.73, 30.26], [-97.73, 30.28], [-97.75, 30.28]], radiusKm: 1.2 };
  const ring = hullRing(a, 300);
  assert.equal(ring.length, 5);
  assert.deepEqual(ring[0], ring.at(-1));
  assert.ok(ring[0][0] < -97.75 && ring[0][1] < 30.26, "grown outwards");
  const pt = { lat: 30.27, lon: -97.74, hull: [[-97.74, 30.27]], radiusKm: 0 };
  assert.equal(hullRing(pt, 300).length, 17);
  // pills: the biggest keeps its place, an overlapping smaller one hides, one off the map hides
  const boxes = [{ i: 0, n: 23, x: 100, y: 100, w: 160, h: 26 }, { i: 1, n: 17, x: 150, y: 110, w: 160, h: 26 }, { i: 2, n: 8, x: 400, y: 300, w: 120, h: 26 }, { i: 3, n: 6, x: 900, y: 10, w: 150, h: 26 }];
  assert.deepEqual([...pillsShown(boxes, { w: 1000, h: 600 })].sort(), [0, 2]);
  assert.deepEqual([...pillsShown(boxes, {})].sort(), [0, 2, 3]);
});
