// r2viz: Why these doors' what-if (lib/whatif.js): the profile a change makes, what Undo puts back, the plan diff and
// its words. The plan view runs the real planner on these; here the pure parts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { profileWith, fieldOf, undoOf, sameAs, changeText, planDiff, diffText, BIG_NAMES } from "../public/lib/whatif.js";

const prof = { rooms: ["bars", "breweries"], drinkers: { age: null }, drinks: [{ key: "a", name: "A" }, { key: "b", name: "B", weight: "less" }] };

test("profileWith changes a copy, never the profile", () => {
  const p = profileWith(prof, { kind: "rooms", rooms: ["bars", "breweries", "restaurants"] });
  assert.deepEqual(p.rooms, ["bars", "breweries", "restaurants"]);
  assert.deepEqual(prof.rooms, ["bars", "breweries"]);
  assert.equal(profileWith(prof, { kind: "age", age: "25_34" }).drinkers.age, "25_34");
  const w = profileWith(prof, { kind: "weight", key: "a", weight: "more" });
  assert.equal(w.drinks[0].weight, "more");
  assert.equal("weight" in profileWith(prof, { kind: "weight", key: "b", weight: "normal" }).drinks[1], false, "normal drops the field (the default path)");
});

test("fieldOf + undoOf put the field back", () => {
  for (const ch of [{ kind: "rooms", rooms: ["bars"] }, { kind: "age", age: "35_44" }, { kind: "weight", key: "b", weight: "more" }]) {
    const from = fieldOf(prof, ch), back = profileWith(profileWith(prof, ch), undoOf(ch, from));
    assert.deepEqual(back, prof, ch.kind);
  }
  assert.ok(sameAs(prof, false, { kind: "weight", key: "a", weight: "normal" }));
  assert.ok(!sameAs(prof, false, { kind: "famous", on: true }));
});

test("changeText says the change plainly", () => {
  assert.equal(changeText({ kind: "rooms", rooms: ["bars", "breweries", "restaurants"] }, { profile: prof }), "Pitch restaurants too");
  assert.equal(changeText({ kind: "rooms", rooms: ["bars"] }, { profile: prof }), "Stop pitching breweries");
  assert.equal(changeText({ kind: "weight", key: "a", weight: "less" }, { names: { a: "White Claw" } }), "Count White Claw drinkers less");
  assert.equal(changeText({ kind: "famous", on: true }), "Include the most popular doors now");
  assert.match(BIG_NAMES, /^Most popular: come back once you have reorders$/);
});

test("planDiff + diffText: doors in, out, moved, miles", () => {
  const d = (date, day, ids, mi) => ({ date, day, from: 780, stops: ids.map((id) => ({ id })), mi, min: mi * 3 });
  const prev = { days: [d("1", "tuesday", ["x", "y", "z"], 10), d("2", "wednesday", ["w"], 5)] };
  const next = { days: [d("1", "tuesday", ["x", "q"], 12), d("2", "wednesday", ["w", "z"], 6)] };
  const df = planDiff(prev, next, { prevPool: [1, 2, 3], nextPool: [1, 2, 3, 4] });
  assert.deepEqual(df.inn.map((x) => x.id), ["q"]);
  assert.deepEqual(df.out.map((x) => x.id), ["y"]);
  assert.deepEqual(df.moved, [{ id: "z", from: "tuesday", to: "wednesday" }]);
  assert.deepEqual(df.mi, [15, 18]);
  assert.equal(diffText(df), "Your list grows from 3 to 4 doors. 1 door joins your plan and 1 comes off. 1 door moves to another day. 3 more miles of driving.");
  assert.equal(diffText(planDiff(prev, prev, { prevPool: [1], nextPool: [1] })), "Your plan keeps the same doors on the same days.");
});
