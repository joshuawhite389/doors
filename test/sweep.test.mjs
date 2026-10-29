// The all-routes sweep (Diolosa R2): every precomputed route file × every list × Tue/Fri/Sun × lunch/evening.
import test from "node:test";
import assert from "node:assert/strict";
import { sweep } from "../scripts/sweep.mjs";

const s = sweep();

test(`all-routes sweep: ${s.routes} routes rebuilt from the shipped files`, () => {
  assert.ok(s.routes >= 1000, "every route file × list × day × daypart");
});
test("no crossing legs in any route", () => assert.equal(s.crossings, 0));
test("total km equals the sum of the legs shown in every route", () => assert.equal(s.kmMismatch, 0));
test("no leg over 8 km in any route (isolated anchors are demoted)", () => assert.deepEqual(s.longLegs, []));
test("no route has more than 12 stops", () => assert.equal(s.overSize, 0));
test(`no coffee/bakery/grocer/deli/juice/boba/airport door on any of the ${s.junkSample} sampled routes`, () => {
  assert.equal(s.junkRoutes, 0, `doors: ${s.junkDoors.join(", ")}`);
});
