// Jard's batch 2026-10-23: #14 (a Title-Case product name keeps its casing in the drafted message and the questions),
// #12 (the city of a room that pours you: the opening city's smart list).
import { test } from "node:test";
import assert from "node:assert/strict";
import { lowerFirst } from "../public/lib/culture.js";
import { placeCities } from "../public/lib/citylist.js";

test("#14 lowerFirst: a sentence-case phrase is lowercased; a Title-Case name, a proper adjective or an acronym is not", () => {
  assert.equal(lowerFirst("Green Bottles Beer"), "Green Bottles Beer");
  assert.equal(lowerFirst("Small-batch mezcal"), "small-batch mezcal");
  assert.equal(lowerFirst("Hazy IPA"), "hazy IPA");
  assert.equal(lowerFirst("Irish-style whiskey"), "Irish-style whiskey");
  assert.equal(lowerFirst("IPA"), "IPA");
});

test("#12 placeCities: listed cities as typed, the likely one for a typo, else as typed", () => {
  assert.equal(placeCities("dayton")[0].label, "Dayton, OH");
  const typo = placeCities("Milwuakee");
  assert.deepEqual(typo.map((o) => o.label), ["Milwaukee, WI", "Milwuakee"]);
  assert.equal(typo[0].name, "Milwaukee, WI?");
  assert.deepEqual(placeCities("  "), []);
});
