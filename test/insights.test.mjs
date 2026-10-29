// "Why these rooms?" dashboard numbers (G6, lib/insights.js): every figure is Qloo's or counted from Qloo's data.
import { test } from "node:test";
import assert from "node:assert/strict";
import { TIERS, tierOf, planIds, dayOfId, funnel, curve, spearman, popularity, ageSkew, shared, sound, crowd, cityRooms, genreName } from "../public/lib/insights.js";
import { readJson, route, city, strip } from "./helpers.mjs";

const index = readJson("public/data/index.json");
const ab = route("athletic-brewing-austin");
const ids = (r) => r.lists.all.map((x) => x[0]);

test("tiers: top 10 / 11–25 / 26–50 / 51 and below", () => {
  assert.deepEqual([1, 10, 11, 25, 26, 50, 51, 140].map(tierOf), [0, 0, 1, 1, 2, 2, 3, 3]);
  assert.equal(TIERS.length, 4);
});

test("planIds / dayOfId: unique ids, first day wins (a return visit counts once)", () => {
  const plan = { days: [{ stops: [{ id: "a" }, { id: "b" }] }, { stops: [{ id: "c" }, { id: "a" }] }] };
  assert.deepEqual(planIds(plan), ["a", "b", "c"]);
  assert.deepEqual([...dayOfId(plan)], [["a", 0], ["b", 0], ["c", 1]]);
  assert.deepEqual(planIds(null), []);
});

test("funnel: ranked = kept + dropped (3 pages of 50), famous-only rooms counted apart", () => {
  const f = funnel(ab, { pool: ids(ab).slice(0, 80), plan: ["x", "y"] });
  assert.equal(f.ranked, 150);
  assert.equal(f.kept, ab.lists.all.length);
  assert.equal(f.dropped, ab.dropped.all.n);
  assert.equal(f.pool, 80);
  assert.equal(f.plan, 2);
  assert.equal(f.captured, "2026-10-08");
  const inAll = new Set(ids(ab));
  assert.ok(f.famousOnly.length > 0 && f.famousOnly.every((id) => !inAll.has(id)));
  assert.equal(funnel({}).ranked, 0);
});

test("curve: Qloo's order inside the pool, ranks 1..n, Qloo's affinity, never rising", () => {
  const pool = ids(ab).filter((_, i) => i % 2 === 0);
  const c = curve(ab, pool);
  assert.equal(c.rows.length, pool.length);
  assert.deepEqual(c.rows.map((r) => r.id), pool);
  c.rows.forEach((r, i) => assert.equal(r.rank, i + 1));
  for (let i = 1; i < c.rows.length; i++) assert.ok(c.rows[i].score <= c.rows[i - 1].score);
  assert.equal(c.max, ab.lists.all[0][1]);
  // famous merges the uncapped page by affinity
  const cf = curve(ab, [...ids(ab), ...ab.lists.famous.map((r) => r[0])], { famous: true });
  assert.ok(cf.rows.length > c.rows.length);
  assert.equal(curve({}, []).max, null);
});

test("spearman: perfect, inverse, ties, too few points", () => {
  assert.equal(spearman([1, 2, 3, 4, 5], [10, 20, 30, 40, 50]), 1);
  assert.equal(spearman([1, 2, 3, 4, 5], [5, 4, 3, 2, 1]), -1);
  assert.equal(spearman([1, 1, 2, 3, 4], [1, 1, 2, 3, 4]), 1);
  assert.equal(spearman([1, 2, 3], [1, 2, 3]), null);
});

test("popularity: best-matched vs most popular on the same rooms; famous rooms the cap left out", () => {
  const c = curve(ab, ids(ab));
  const p = popularity(ab, c.rows, ab.venues);
  assert.equal(p.n, 20);
  assert.deepEqual(p.byMatch, ids(ab).slice(0, 20));
  const pops = p.byPop.map((id) => ab.venues[id].popularity);
  for (let i = 1; i < pops.length; i++) assert.ok(pops[i] <= pops[i - 1]);
  assert.ok(p.missed.every((id) => p.byMatch.includes(id) && !p.byPop.includes(id)));
  assert.ok(p.missed.length >= 10, `${p.missed.length} of 20 best-matched outside the 20 most popular`);
  assert.ok(Math.abs(p.rho) < 0.3, `rank correlation ${p.rho}`);
  assert.ok(p.famousOut.length > 0 && p.famousOut.every((f) => f.pop > 0.9));
});

test("ageSkew: each band's order inside the pool, its own picks outside the overall top", () => {
  const pool = ids(ab);
  const a = ageSkew(ab, pool, index.ages, { top: 20 });
  assert.deepEqual(a.bands.map((b) => b.key).sort(), ["25_34", "35_44", "45_54", "55_plus", "under_25"]);
  const u = a.bands.find((b) => b.key === "under_25");
  assert.equal(u.label, "21–24"); // r2: Qloo's "24 and younger", read as 21–24 (Doors plans 21+ rooms only)
  for (const b of a.bands) {
    assert.ok(b.top.length <= 20);
    assert.ok(b.own.every((id) => b.top.includes(id) && !pool.slice(0, 20).includes(id)));
  }
  const first = a.bands[0].ids[0];
  assert.equal(a.rankIn(first)[a.bands[0].key], 1);
  assert.equal(a.rankIn("nope")[a.bands[0].key], null);
  // r2: every held brand carries 21–24 and 55 and over; qloofull (10-27): the Parson's room preset carries them too
  assert.ok(ageSkew(route("casamigos-austin"), ids(route("casamigos-austin")), index.ages).bands.some((b) => b.key === "55_plus"));
  assert.deepEqual(ageSkew(route("parsons-austin"), ids(route("parsons-austin")), index.ages).bands.map((b) => b.key).sort(), ["25_34", "35_44", "45_54", "55_plus", "under_25"]);
});

test("shared: other brands' top 50 against your top 50, with the shared ids, mine left out", () => {
  const s = strip("austin");
  const rows = shared({ strip: s, base: ids(ab), brands: index.brands, mine: ["athletic-brewing"] });
  assert.equal(rows.length, 7);
  assert.ok(!rows.some((r) => r.key === "athletic-brewing"));
  for (const r of rows) {
    assert.equal(r.ids.length, r.n);
    assert.equal(r.n, s.matrix[`athletic-brewing|${r.key}`] ?? s.matrix[`${r.key}|athletic-brewing`]);
  }
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i].n <= rows[i - 1].n);
  assert.deepEqual(shared({ strip: null, base: ids(ab) }), []);
});

test("sound: only guarded rooms count; genres folded and counted once per room", () => {
  const c = city("austin");
  const pool = ids(ab);
  const s = sound(pool, c.sounds);
  assert.ok(s.rooms.every((id) => c.sounds[id].guard.pass));
  assert.equal(s.checked, pool.filter((id) => c.sounds[id]).length);
  assert.ok(s.genres.length && s.genres.every((g) => g.ids.length >= 2 && g.ids.length <= s.rooms.length && new Set(g.ids).size === g.ids.length));
  assert.ok(!s.genres.some((g) => ["r_b", "rhythm_blues", "rap"].includes(g.key)));
  assert.equal(genreName("rb"), "R&B");
  assert.equal(genreName("folk_rock"), "Folk rock");
  // a failing guard is never counted
  const fake = { a: { artists: [{ name: "X", genres: ["rock"] }], guard: { pass: false } }, b: { artists: [{ name: "X", genres: ["rock"] }], guard: { pass: false } } };
  assert.deepEqual(sound(["a", "b"], fake).genres, []);
});

test("crowd: rooms whose Qloo crowd text names each descriptor, against every ranked room in the city", () => {
  const venues = { a: { crowd: "Young professionals and couples on date nights." }, b: { crowd: "Couples and families." }, c: { crowd: "" }, d: { crowd: "Students." } };
  const r = crowd(["a", "b", "c"], venues, { base: ["a", "b", "d"], min: 1 });
  assert.equal(r.n, 2); // c has no crowd text
  const couples = r.terms.find((t) => t.key === "couples");
  assert.deepEqual(couples.ids, ["a", "b"]);
  assert.equal(couples.share, 1);
  assert.equal(couples.base, 2 / 3);
  assert.equal(r.terms[0].key, "couples");
  const real = crowd(ids(ab).slice(0, 50), ab.venues);
  assert.ok(real.n >= 45 && real.terms.length >= 5);
  assert.equal(real.terms[0].base, null);
});

test("cityRooms: unique ranked rooms across route files", () => {
  const cr = route("casamigos-austin");
  const u = cityRooms([ab, cr]);
  assert.equal(u.ids.length, new Set([...ids(ab), ...ids(cr)]).size);
  assert.ok(u.ids.every((id) => u.venues[id]));
});

test("shared: a flat overlap stands out for no brand (why2 bug: Heineken + Bud Light in Boise read as Athletic Brewing)", () => {
  const hb = readJson("test/fixtures/heineken-budlight-boise.json");
  const base = [];
  for (let i = 0; i < 50; i++) for (const l of [hb.heineken, hb["bud-light"]]) if (l[i] && !base.includes(l[i])) base.push(l[i]);
  const rows = shared({ strip: strip("boise"), base, brands: index.brands, mine: [] });
  assert.ok(rows.length === 8 && rows[0].n - rows.at(-1).n < 10);
  assert.ok(!rows.some((r) => r.stands));
  // a real cluster still stands: Athletic Brewing in Boise → LaCroix and White Claw, not the tequilas
  const ab = shared({ strip: strip("boise"), base: strip("boise").brands["athletic-brewing"].ids, brands: index.brands, mine: ["athletic-brewing"] });
  assert.deepEqual(ab.filter((r) => r.stands).map((r) => r.key), ["lacroix", "white-claw"]);
});
