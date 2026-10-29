// R9 swap card (lib/demo-swap.js): the same drinker brand in two held cities gives a different #1 room, Qloo's own crowd
// words for it (quoted, labelled with CULTURAL-SLOTS §3.2's words) and a different opener. Held files only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { route, readJson } from "./helpers.mjs";
import { swapSide, SWAP_CITIES, SWAP_DRINKER, qlooSays } from "../public/lib/demo-swap.js";
import { demoProfile } from "../public/lib/demo-profile.js";
import { STEPS } from "../public/lib/demo-script.js";

const index = readJson("public/data/index.json");
const side = (key) => swapSide({ route: route(`${SWAP_DRINKER}-${key}`), city: readJson(`public/data/cities/${key}.json`), cityKey: key, cityName: index.cities.find((c) => c.key === key).name, profile: demoProfile() });

test("swap: Austin and Boise, same brand, a different #1 room, crowd and opener, each labelled with its source", () => {
  const [a, b] = SWAP_CITIES.map(side);
  assert.equal(a.name, "Nomadic Beerworks", "Austin's #1 is the room the tour already opened");
  assert.notEqual(a.name, b.name);
  // the opener is the rep's intro (the same words in both cities, Jard 10-24 #5); the swap card shows no opener (judge pass 9 #3)
  assert.notEqual(a.crowd, b.crowd);
  for (const [x, key] of [[a, "austin"], [b, "boise"]]) {
    assert.match(x.rankLine, /^#1 of \d+ /);
    assert.match(x.rankLine, /Athletic Brewing/);
    assert.ok(route(`${SWAP_DRINKER}-${key}`).venues[x.id].crowd.startsWith(x.crowd), "Qloo's own sentences, quoted as is");
    assert.match(x.crowdBy, /^Qloo's data, [A-Z][a-z]{2} \d{1,2}$/, "the date as the app writes it (intuit pass 1b #9)");
    assert.ok(x.crowd.startsWith(x.crowdShort.replace(/…$/, "")) && x.crowdShort.length < 90, "the first clause, quoted as is");
    assert.match(x.openerBy, /model-drafted|Doors' template/);
  }
  assert.equal(qlooSays(null), "Qloo's data");
});

test("swap card copy claims no judged result (framework §8: untested stays unclaimed)", () => {
  const s = STEPS.find((x) => x.key === "swap");
  assert.ok(s, "the swap step is in the tour");
  assert.ok(STEPS.findIndex((x) => x.key === "swap") > STEPS.findIndex((x) => x.key === "replan"));
  assert.doesNotMatch([s.title, ...s.body].join(" "), /cultural(ly)? grounded|judges?|preferred|proven|better/i);
});
