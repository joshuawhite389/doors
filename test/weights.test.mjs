// r2viz: per-drinker weights in the list merge (lib/pool.js mergeLists / weightsOf). The default path must be the
// same as before weights existed: the merge here is checked against the pre-r2viz loop, copied verbatim, for every
// pair and triple of held brands in every held city, with weights absent, empty and all "normal".
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { mergeLists, rankedIds, weightsOf, buildPool } from "../public/lib/pool.js";
import { sampleProfile } from "../public/lib/profile.js";

const ROUTES = "public/data/routes";
const read = (f) => JSON.parse(fs.readFileSync(`${ROUTES}/${f}`, "utf8"));
const noRoutes = !fs.existsSync(ROUTES) && "the route files are Qloo-derived (private)";
const byCity = {};
for (const f of noRoutes ? [] : fs.readdirSync(ROUTES).filter((x) => x.endsWith(".json"))) {
  const r = read(f);
  (byCity[r.city?.key] ??= []).push(r);
}
// the merge as it was before r2viz (99c8aa4), verbatim
function before(routes, { famous = false, age = null } = {}) {
  const lists = routes.map((r) => rankedIds(r, { famous, age }));
  const venues = Object.assign({}, ...routes.map((r) => r.venues));
  const ids = [];
  const seen = new Set();
  for (let i = 0; lists.some((l) => i < l.length); i++)
    for (const l of lists) if (i < l.length && !seen.has(l[i]) && venues[l[i]]) (seen.add(l[i]), ids.push(l[i]));
  return { ids, venues };
}
const combos = (xs) => xs.flatMap((a, i) => [[a], ...xs.slice(i + 1).flatMap((b, j) => [[a, b], ...xs.slice(i + j + 2, i + j + 4).map((c) => [a, b, c])])]);

test("default weights leave every merge exactly as before", { skip: noRoutes }, () => {
  let n = 0;
  for (const routes of Object.values(byCity))
    for (const set of combos(routes))
      for (const famous of [false, true]) {
        const want = before(set, { famous }).ids;
        const normal = Object.fromEntries(set.map((r) => [r.drinker.key, "normal"]));
        for (const weights of [undefined, null, {}, normal]) assert.deepEqual(mergeLists(set, { famous, weights }).ids, want);
        n++;
      }
  assert.ok(n > 100, `checked ${n} merges`);
});

test("weightsOf: only less and more count", () => {
  assert.equal(weightsOf({ drinks: [{ key: "a" }, { key: "b", weight: "normal" }] }), null);
  assert.deepEqual(weightsOf({ drinks: [{ key: "a", weight: "less" }, { key: "b", weight: "more" }, { key: "c" }] }), { a: "less", b: "more" });
  assert.equal(weightsOf(null), null);
});

test("a heavier drinker fills more of the top of the list, a lighter one less", { skip: noRoutes }, () => {
  const [a, b] = byCity.austin.filter((r) => r.kind === "brand").slice(0, 2);
  const top = (ids, r) => ids.slice(0, 30).filter((id) => rankedIds(r).slice(0, 60).includes(id)).length;
  const even = mergeLists([a, b]).ids, more = mergeLists([a, b], { weights: { [a.drinker.key]: "more" } }).ids, less = mergeLists([a, b], { weights: { [a.drinker.key]: "less" } }).ids;
  assert.ok(top(more, a) > top(even, a), "more: more of a's doors near the top");
  assert.ok(top(less, a) < top(even, a), "less: fewer of a's doors near the top");
  assert.equal(new Set(more).size, new Set(even).size, "the same doors, in another order");
});

test("buildPool: a profile with no weights or normal weights builds the same pool", { skip: noRoutes }, () => {
  const routes = byCity.austin.filter((r) => r.kind === "brand").slice(0, 3);
  const p = { ...sampleProfile(new Date(2026, 9, 24)), drinks: routes.map((r) => ({ key: r.drinker.key, name: r.drinker.name, ready: true })) };
  const q = { ...p, drinks: p.drinks.map((d) => ({ ...d, weight: "normal" })) };
  assert.deepEqual(buildPool({ routes, profile: q, cityName: "Austin" }).ids, buildPool({ routes, profile: p, cityName: "Austin" }).ids);
  const r = { ...p, drinks: p.drinks.map((d, i) => (i === 0 ? { ...d, weight: "less" } : d)) };
  assert.notDeepEqual(buildPool({ routes, profile: r, cityName: "Austin" }).ids, buildPool({ routes, profile: p, cityName: "Austin" }).ids);
});

// the same checks on made-up lists, so the public tree (no route files) still runs them
test("made-up lists: default weights as before, less and more reorder", () => {
  const mk = (key, ids) => ({ drinker: { key }, lists: { all: ids.map((id, i) => [id, 1 - i / 100]) }, venues: Object.fromEntries(ids.map((id) => [id, { id, name: id }])) });
  const a = mk("a", ["a1", "a2", "a3", "a4", "s1", "a5"]), b = mk("b", ["b1", "s1", "b2", "b3", "b4", "b5"]);
  for (const weights of [undefined, {}, { a: "normal", b: "normal" }]) assert.deepEqual(mergeLists([a, b], { weights }).ids, before([a, b]).ids);
  assert.deepEqual(mergeLists([a, b], { weights: { a: "more" } }).ids.slice(0, 6), ["a1", "a2", "b1", "a3", "a4", "s1"]);
  assert.deepEqual(mergeLists([a, b], { weights: { a: "less" } }).ids.slice(0, 5), ["a1", "b1", "s1", "a2", "b2"]);
});
