// Intuitiveness audit #6: Your list's map keeps a "#41" tag only where it clears the day pins and the better-ranked tags.
import { test } from "node:test";
import assert from "node:assert/strict";
import { rankTagsShown } from "../public/ui/map.js";

const tag = (i, n, x, y) => ({ i, n, x, y, w: 30, h: 24 });
test("rank tags: best rank wins a collision, a tag on a day pin becomes a dot, clear tags all show", () => {
  // two tags on top of each other: only the better rank keeps its number, whatever order they come in
  assert.deepEqual([...rankTagsShown([tag(0, 41, 100, 100), tag(1, 4, 105, 102)], [])], [1]);
  // a tag over a day pin hides; one clear of it shows
  const pin = { x: 200, y: 200, w: 30, h: 30 };
  assert.deepEqual([...rankTagsShown([tag(0, 7, 205, 205), tag(1, 9, 400, 400)], [pin])], [1]);
  // nothing touching: all shown
  assert.equal(rankTagsShown([tag(0, 1, 0, 0), tag(1, 2, 100, 0), tag(2, 3, 200, 0)], []).size, 3);
  // an unranked door ("•") yields to every ranked one
  assert.deepEqual([...rankTagsShown([tag(0, null, 50, 50), tag(1, 30, 52, 50)], [])], [1]);
});

// Intuitiveness audit #7: the door card's map at 1400 frames the stop with its neighbours, not one pin at street level.
import { cardFrame } from "../public/lib/stopmodel.js";
test("cardFrame: before + this + after; stop 1 uses the day's start; a door off the days frames itself", () => {
  const v = (lat) => ({ lat, lon: -97 });
  const plan = { venues: { a: v(30.1), b: v(30.2), c: v(30.3), x: v(30.9) }, days: [{ start: v(30.0), stops: [{ id: "a" }, { id: "b" }, { id: "c" }] }] };
  assert.deepEqual(cardFrame(plan, "b", 0).map((p) => p[1]), [30.1, 30.2, 30.3]);
  assert.deepEqual(cardFrame(plan, "a", 0).map((p) => p[1]), [30.0, 30.1, 30.2]);
  assert.deepEqual(cardFrame(plan, "c", 0).map((p) => p[1]), [30.2, 30.3]);
  assert.deepEqual(cardFrame(plan, "x", null).map((p) => p[1]), [30.9]);
  assert.deepEqual(cardFrame(plan, "nowhere", 0), []);
});
