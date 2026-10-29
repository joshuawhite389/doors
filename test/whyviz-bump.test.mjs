// WHY-VIZ-SPEC §4.6 The list by age (lib/whyviz/bump.js) on the demo bake: the plan's twelve best doors, Qloo's rank on
// each band's own page, the sentence for All ages and for a band, every number the model's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { route, readJson, city } from "./helpers.mjs";
import { sieve } from "../public/lib/sieve.js";
import { demoProfile } from "../public/lib/demo-profile.js";
import { demoStates, bakedMatrix } from "../public/lib/demo-plan.js";
import { listRank } from "../public/lib/roominsight.js";
import { bumpModel, bumpRows, BUMP_DOORS, BUMP_DOORS_PHONE } from "../public/lib/whyviz/bump.js";
import { plain } from "../public/lib/whyviz/words.js";

const austin = route("athletic-brewing-austin");
const demo = readJson("public/data/demo/demo.json");
async function setup() {
  const profile = demoProfile();
  const { states } = await demoStates({ routes: [austin], profile, contact: demo.contact, fetchMatrix: bakedMatrix(demo.matrix) });
  const { plan: p, pool } = states[0];
  const plan = { ...p, venues: pool.venues, statuses: pool.statuses, pool: { ids: pool.ids }, city: { key: "austin", name: "Austin" } };
  return { plan, sv: sieve({ route: austin, plan, profile, city: city("austin") }), profile };
}

test("bump: the plan's twelve best by Your list rank, each band's rank from that band's own page (roominsight listRank agrees)", async () => {
  const { plan, sv, profile } = await setup();
  const m = bumpModel({ plan, routes: [austin], profile, sv, cityName: "Austin" });
  assert.equal(m.series.length, BUMP_DOORS);
  assert.deepEqual(m.bands.map((b) => `${b.key}:${b.of}`), ["under_25:34", "25_34:38", "35_44:28", "45_54:37", "55_plus:35"]);
  const onPlan = new Set(plan.days.flatMap((d) => d.stops.map((s) => s.id)));
  for (let i = 1; i < m.series.length; i++) assert.ok(m.series[i].listRank > m.series[i - 1].listRank, "best first");
  for (const s of m.series) {
    assert.ok(onPlan.has(s.id), s.name);
    assert.equal(s.ranks.all.of, 55);
    for (const b of m.bands) { const r = listRank(austin, b.key, s.id); assert.deepEqual(s.ranks[b.key], r.rank ? { rank: r.rank, of: r.of } : null, `${s.name} ${b.key}`); }
  }
  const nom = m.series[0];
  assert.equal(nom.name, "Nomadic Beerworks");
  assert.deepEqual(nom.ranks["25_34"], { rank: 16, of: 38 });
  assert.equal(m.maxRank, 38);
  assert.equal(plain(m.words()), "Pick an age and the list moves. Nomadic Beerworks is #16 of 38 for 25–34 and #1 of 28 for 35–44, and not on the 21–24, 45–54 and 55 and over lists at all.");
  const w = plain(m.words("25_34"));
  assert.match(w, /^For 25–34 Athletic Brewing drinkers, Qloo ranks 38 Austin doors\. Of your twelve best: .+ #\d+, .+ #\d+ and .+ #\d+ rank; \d+ aren't on that list\. Apply, and Doors ranks Your list for 25–34 drinkers first, then re-routes your days\.$/);
  const ranked = m.series.filter((s) => s.ranks["25_34"]).sort((a, b) => a.ranks["25_34"].rank - b.ranks["25_34"].rank);
  assert.ok(w.includes(`${ranked[0].name} #${ranked[0].ranks["25_34"].rank}`));
  assert.ok(w.includes(`${m.series.length - ranked.length} aren't on that list`));
  // every number in the band sentence is the model's
  const nums = (w.match(/\d+/g) ?? []).map(Number);
  const ok = new Set([38, 25, 34, m.series.length - ranked.length, ...ranked.slice(0, 3).map((s) => s.ranks["25_34"].rank)]);
  for (const n of nums) assert.ok(ok.has(n), `${n} in: ${w}`);
  // the tooltip
  assert.deepEqual(bumpRows(nom, "25_34", m), [["Nomadic Beerworks", ""], ["#16 of 38", "for 25–34 Athletic Brewing drinkers"]]);
  assert.deepEqual(bumpRows(nom, "under_25", m)[1], ["not on this list", "for 21–24 Athletic Brewing drinkers"]);
  // the phone: six doors
  assert.equal(bumpModel({ plan, routes: [austin], profile, sv, n: BUMP_DOORS_PHONE }).series.length, 6);
  // a band the plan's doors all miss, and no bands at all
  const none = bumpModel({ plan, routes: [{ ...austin, lists: { all: austin.lists.all } }], profile, sv });
  assert.deepEqual(none.bands, []);
  assert.equal(plain(none.words()), "Qloo has no age re-ranks for these doors yet.");
});
