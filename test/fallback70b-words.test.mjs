// the 70b re-run (v2-tour 884b188, 10-23), the parts that need no data (they run in the public export too):
// "never say craft" let "well-crafted" through, and Llama 3.3 70b answered "what's first today?" with a canned "Your
// request is incomplete". The rest (with the demo plan) is fallback70b.test.mjs. No network.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { applyRule } from "../public/lib/slots.js";
import { workersAiSession } from "../src/llm.js";
import { repWords } from "../public/lib/agent-tools.js";

const realFetch = globalThis.fetch;
before(() => {
  globalThis.fetch = async (u) => {
    throw new Error(`network call attempted in a test: ${u}`);
  };
});
after(() => (globalThis.fetch = realFetch));

test("never-say matches the word's forms, not only its plural", () => {
  const avoid = (a) => ({ avoid: [a], terms: [] });
  for (const [t, a] of [["A well-crafted cider.", "craft"], ["Our handcrafted cider.", "craft"], ["Crafted with care.", "craft"], ["Crafting it took years.", "craft"], ["Freshly hopped.", "hops"], ["Ciders sell.", "cider"], ["A curated list.", "curate"], ["Your regulars will like it.", "regular"], ["Your regular will like it.", "regulars"], ["Two cocktails.", "cocktail"]]) assert.equal(applyRule(t, avoid(a)), null, `${a} in ${t}`);
  // a different word that starts with it is left alone ("regulars" must not kill "regularly")
  for (const [t, a] of [["They rotate taps regularly.", "regulars"], ["A crafty move.", "craft"], ["A hoppy ale.", "hops"], ["The aircraft landed.", "craft"], ["Ginger beer.", "gin"], ["A whale of a time.", "ale"]]) assert.equal(applyRule(t, avoid(a)), t, `${a} not in ${t}`);
  // the chat rewords a modifier in front of a noun, form and all; in front of a small word the line goes
  const soft = { soften: { what: "Dry hard cider" } };
  assert.equal(applyRule("A well-crafted cider for your cooler.", avoid("craft"), soft), "A cider for your cooler.");
  assert.equal(applyRule("Our handcrafted cider sells.", avoid("craft"), soft), "Our cider sells.");
  assert.equal(applyRule("Crafted with care in Oregon.", avoid("craft"), soft), null);
  assert.equal(applyRule("Ciders sell well.", avoid("cider"), soft), "Drinks sell well.");
});

test("Workers AI: the canned 'your request is incomplete' is asked again without tools, once", async () => {
  const calls = [];
  const replies = [{ response: "Your request is incomplete. Please provide more details or specify the task you need help with." }, { response: "First today is The Drafting Room." }];
  const ai = { run: async (m, i) => (calls.push(i), replies.shift()) };
  const sess = workersAiSession({ ai })({ system: "s", user: "u", tools: [{ name: "explain_door", description: "d", parameters: { type: "object", properties: { door_id: { type: "string" } } } }] });
  const out = await sess.step();
  assert.equal(out.text, "First today is The Drafting Room.");
  assert.equal(calls.length, 2);
  assert.ok(calls[0].tools && !calls[1].tools);
  // twice canned: no content (the next model, else the rules), never the canned line to the rep
  const twice = { run: async () => ({ response: "Your input is lacking necessary information. Please provide more details." }) };
  await assert.rejects(workersAiSession({ ai: twice })({ system: "s", user: "u", tools: [{ name: "x", description: "d", parameters: {} }] }).step(), /no content/);
});


test("a note keeps the rep's own words: no 'Rep said:' label, no opening 'done,' (live F7 on Haiku)", () => {
  assert.equal(repWords("Rep said: done, interested, back Tuesday at 9am."), "interested, back Tuesday at 9am.");
  assert.equal(repWords("The rep said that the manager is Priya"), "the manager is Priya");
  assert.equal(repWords("done, owner wasn't in"), "owner wasn't in");
  assert.equal(repWords("Owner wasn't in. Back Saturday at 3pm."), "Owner wasn't in. Back Saturday at 3pm.");
  assert.equal(repWords("Done."), "");
});
