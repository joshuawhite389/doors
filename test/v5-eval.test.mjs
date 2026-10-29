// The V5 eval harness (scripts/sweep-v5.mjs, docs/ROUTING-V5-EVAL.md): the owner's example and the value curves.
import { test } from "node:test";
import assert from "node:assert/strict";
import { CURVES } from "../scripts/sweep-routing.mjs";

test("curves: #1 is worth 1, values fall with rank", () => {
  for (const [c, k] of [["hyper", 10], ["exp", 10], ["linear", 0]]) {
    const v = (r) => CURVES[c](r, { k, N: 100 });
    assert.ok(Math.abs(v(1) - 1) < 1e-9);
    assert.ok(v(2) > v(10) && v(10) > v(90));
  }
  assert.equal(CURVES.aff(1, { aff: 0.9, a1: 0.9, aN: 0.5 }), 1);
  assert.equal(CURVES.aff(1, { aff: null, a1: 0.9, aN: 0.5 }), 0);
});

test("the owner's example: b = 1, 2, 103, 88, 6 beats a = 1, 8, 54, 78, 90 on every curve", async () => {
  const { example } = await import("../scripts/sweep-v5.mjs");
  const ex = example();
  assert.ok(ex.length >= 6);
  for (const e of ex) assert.equal(e.winner, "b", e.label);
});
