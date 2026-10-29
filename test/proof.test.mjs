// R9 proof (Cultural Slot Framework §7): the code checks of scripts/proof/probes.mjs over the fixed scenario set, so a
// change that breaks a slot's behaviour fails here. The model screen (scripts/proof.mjs --judge) is not run in tests.
import { test } from "node:test";
import assert from "node:assert/strict";
import { slotsProbe } from "../scripts/proof/slots-probes.mjs";
import { swapProbe, stabilityProbe, ablationProbe, labelProbe, emptyProbe, correctionProbe, talkProbe } from "../scripts/proof/probes.mjs";

let abl;
const ablation = () => (abl ??= ablationProbe());
const failures = (rows) => rows.filter((r) => !r.ok).map((r) => JSON.stringify({ ...r, ra: undefined, rb: undefined }).slice(0, 300));

test("swap: another city or drinker signal changes the rooms and the plan; each side passes the appropriateness checks", () => {
  assert.deepEqual(failures(swapProbe()), []);
});
test("stability: the same input gives a byte-identical decision record", () => {
  assert.deepEqual(failures(stabilityProbe()), []);
});
test("ablation: every slot, switched off alone, changes at least one decision (none is decoration)", () => {
  // Documented exception (docs/PROOF.md, "Since the last proof", gigbot 10-24 (a)): since the family angle reads only
  // Qloo's own tags, the crowd text decides only the daytime and sports angles and the prep line built from them, and
  // none of the 12 proof scenarios hits those; it is reported inert there, not hidden. Any other inert slot fails.
  const inert = ablation().filter((a) => a.inert).map((a) => a.slot);
  assert.deepEqual(inert.filter((x) => x !== "crowd"), []);
});
test("ablation: the words-only slots never move the plan", () => {
  for (const a of ablation().filter((x) => ["na", "crowd", "sisters", "pours", "timing", "lead", "hooks"].includes(x.slot))) {
    assert.equal(a.fieldCounts.ranking + a.fieldCounts.plan, 0, a.slot);
  }
});
// persona MUST #2 (lib/ask.js): What you make and Your ask now pick rooms too (soft-drinks-only rooms leave an alcohol
// or NA pitch; a draft ask keeps rooms with taps), so they move the plan; they never change which kinds of room are picked
test("ablation: kind and ask move the plan only through the ask's room filter, never the room kinds", () => {
  for (const a of ablation().filter((x) => ["kind", "ask"].includes(x.slot))) {
    assert.equal(a.fieldCounts.roomKinds, 0, a.slot);
    assert.ok(a.fieldCounts.plan > 0, `${a.slot} moves the plan (the filter is live)`);
  }
});
test("label invariance: signer names, room demographic labels and labels with no field move no decision", () => {
  assert.deepEqual(failures(labelProbe()), []);
});
test("empty slot: no signal → the form asks, or the output stays neutral; no invented category or number", () => {
  assert.deepEqual(failures(emptyProbe()), []);
});
test("correction: the rep's ask, rooms, Not a fit, known doors and follow-ups persist through a reload and win", () => {
  assert.deepEqual(failures(correctionProbe()), []);
});
test("R9 slots on every scenario: return visit, SMS, corrections and the type fix, each switched off; contact-name invariance; empty memory", () => {
  const { rows, skipped } = slotsProbe();
  assert.deepEqual(failures(rows), []);
  assert.deepEqual(skipped, [], "every scenario's first room comes back on Wednesday");
});
test("ablation: R9 deep hooks and heat each change a decision, the one they're for (small talk; the first day's rooms)", () => {
  const a = Object.fromEntries(ablation().map((x) => [x.slot, x]));
  assert.ok(a.hooks.fieldCounts.hook > 0, JSON.stringify(a.hooks.fieldCounts));
  assert.ok(a.heat.fieldCounts.plan > 0, JSON.stringify(a.heat.fieldCounts));
  assert.equal(a.heat.fieldCounts.ranking, 0, "heat moves rooms between days, never the ranking");
});

test("talking points the proof screen caught stay fixed: small start = the ask, 'already buy' = the brand's category, blank 'What you make' sayable, no odd any-alcohol gate", () => {
  assert.deepEqual(failures(talkProbe()), []);
});
