// Live-model re-run: F4 a never-say word in the brand's own product line
// ("cider" in "Dry hard cider") made cleanReply drop every sentence, so the rep got "I couldn't do that"; F2b "please
// stop using the word regulars when you write my pitch" saved the whole trailing clause as the never-say; coaching was
// too broad: an IPA objection and "next to Angry Orchard" got the canned opener and the stop's first pushback. No network.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.js";
import { _resetAgent, cleanReply, cleanContext, promptOf } from "../src/agent.js";
import { answerByRules, answerFirst, ruleOf, isCoaching } from "../public/lib/agent-rules.js";
import { makeRecord, applyRule } from "../public/lib/slots.js";
import { scriptedSession } from "../src/llm.js";
import { agentContext } from "../public/lib/agent-context.js";
import { demoContext } from "./agent-fixture.mjs";
import { route, city } from "./helpers.mjs";

const realFetch = globalThis.fetch;
before(() => {
  globalThis.fetch = async (u) => {
    throw new Error(`network call attempted in a test: ${u}`);
  };
});
after(() => (globalThis.fetch = realFetch));
beforeEach(() => _resetAgent());

const { ctx: base, plan } = await demoContext({ current: "first" });
const FIRST = base.day.stops[0].id;
const BRAND = "Hollow Pine Cider";
const AT = "2026-10-20T12:00:00.000Z";
let n = 0;
const rule = (field, value) => makeRecord({ slot: "S6", field, value, source: "corrected", by: "rep", at: `2026-10-20T12:00:${String(n++).padStart(2, "0")}.000Z` });
const withRules = (records) => {
  const p = { ...plan, profile: { ...plan.profile, brand: BRAND, what: "Dry hard cider" }, slots: { "*": records } };
  return agentContext({ plan: p, dayIndex: 0, current: FIRST, city: city("austin"), routes: [route("athletic-brewing-austin")], now: new Date(`${plan.days[0].date}T14:20:00`) });
};
const post = (body) => new Request("https://doors.example/api/agent", { method: "POST", headers: { origin: "https://doors.example", "content-type": "application/json", "cf-connecting-ip": "203.0.113.9" }, body: JSON.stringify(body) });
const ask = async (env, text, context = base) => (await worker.fetch(post({ v: 1, messages: [{ role: "user", text }], context }), env)).json();
const stub = (steps, seen = []) => (opts) => (seen.push(opts), scriptedSession(steps)(opts));
const PITCH = "give me a one-line pitch for this door";

// ---------- F4: the product line's own never-say word ----------
test("F4: the model never sees a never-say word in the product line: the rep's substitute or a neutral word", () => {
  const avoid = cleanContext(withRules([rule("rule.avoid", "cider"), rule("rule.avoid", "craft")]));
  const p = promptOf([{ role: "user", text: PITCH }], avoid);
  const view = JSON.parse(/CONTEXT (\{.*\})\n/.exec(p)[1]);
  assert.equal(view.brand, BRAND, "the brand's name is spared");
  assert.doesNotMatch(view.product, /cider|craft/i);
  assert.match(view.product, /^Dry hard drink$/);
  // the current door's talking points reach the model with the rule applied too
  assert.doesNotMatch(JSON.stringify(view.doors.map((d) => d.talk ?? null)).replace(/Hollow Pine Cider/g, ""), /\bcider\b|\bcraft\b/i);
  // a term rule gives the rep's own word
  const term = cleanContext(withRules([rule("rule.term", { from: "cider", to: "apple wine" })]));
  assert.equal(JSON.parse(/CONTEXT (\{.*\})\n/.exec(promptOf([{ role: "user", text: PITCH }], term))[1]).product, "Dry hard apple wine");
});

test("F4: a reply that says a never-say product word is reworded, not dropped (the f4diag lines)", () => {
  const ctx = cleanContext(withRules([rule("rule.avoid", "cider"), rule("rule.avoid", "craft")]));
  const c = (t) => cleanReply(t, ctx, { facts: [], words: PITCH, actions: [] });
  assert.equal(c("Hollow Pine is a dry hard cider that sits next to your beers."), "Hollow Pine is a dry hard drink that sits next to your beers.");
  assert.equal(c('Try this: "Our dry cider pairs with your shrimp tacos and takes one cooler row."'), 'Try this: "Our dry drink pairs with your shrimp tacos and takes one cooler row."');
  assert.equal(c("Hollow Pine's craft dry option fits one row."), "Hollow Pine's dry option fits one row.");
  assert.equal(c("Hollow Pine Cider offers a crisp, dry alternative that takes one row in the cooler."), "Hollow Pine Cider offers a crisp, dry alternative that takes one row in the cooler.");
  assert.equal(c("Ciders sell. An artisanal craft cider sells better."), "Drinks sell. An artisanal drink sells better.");
});

test("F4: a never-say word that isn't the product still drops its sentence, and the rep never gets 'I couldn't do that'", async () => {
  const ctx = withRules([rule("rule.avoid", "regulars")]);
  assert.equal(cleanReply("Your regulars will love it. Ask who decides the list.", cleanContext(ctx)), "Ask who decides the list.");
  // every sentence broke the rule: an honest, useful answer instead of an empty one
  const r = await ask({ AGENT_SESSION: stub([{ text: "Your regulars will love it. Tell your regulars about it." }]) }, PITCH, ctx);
  assert.ok(r.reply.trim(), "never empty");
  assert.doesNotMatch(r.reply, /couldn't do that/i);
  assert.match(r.reply, /never-say/i);
});

test("F4 (live): the live pitch with 'cider' never-say answers in words, through the Worker", async () => {
  const ctx = withRules([rule("rule.avoid", "cider")]);
  const seen = [];
  const r = await ask({ AGENT_SESSION: stub([{ text: "Hollow Pine is a dry hard cider that sits next to your beers." }], seen) }, PITCH, ctx);
  assert.equal(r.reply, "Hollow Pine is a dry hard drink that sits next to your beers.");
  assert.doesNotMatch(seen[0].user.replace(/Hollow Pine Cider/g, ""), /"product":"[^"]*cider/i);
});

test("F4: applyRule keeps its old meaning by default: a never-say sentence is null for the talking points", () => {
  assert.equal(applyRule("Our cider is dry.", { avoid: ["cider"], terms: [] }), null);
});

// ---------- F2b: the word, not the trailing clause ----------
test("F2b: a never-say with a trailing clause keeps the word only", () => {
  const v = (s) => ruleOf(s)?.value;
  assert.equal(v("please stop using the word regulars when you write my pitch"), "regulars");
  assert.equal(v("don't say craft in my talking points"), "craft");
  assert.equal(v("never say “regulars” in the pitch"), "regulars");
  assert.equal(v("stop saying hard cider for any of my doors"), "hard cider");
  assert.equal(v("never use the phrase small batch if you can help it"), "small batch");
  // phrases that only look like a clause stay whole
  assert.equal(v("never say on tap"), "on tap");
  assert.equal(v("never say good for you"), "good for you");
  assert.equal(v("never say regulars"), "regulars");
  assert.deepEqual(ruleOf("say apple wine, not cider when you pitch")?.value, { from: "cider", to: "apple wine" });
});

test("F2b: the reply names the word, not the clause", () => {
  const r = answerFirst([{ role: "user", text: "please stop using the word regulars when you write my pitch" }], base, { now: AT });
  assert.equal(r.actions.find((a) => a.type === "slot")?.record?.value, "regulars");
  assert.match(r.reply, /won't say “regulars” in your talking points/);
  assert.doesNotMatch(r.reply, /when you write/);
});

// ---------- coaching: the actual objection, or the model ----------
test("coaching: a question the talking points don't cover goes to the model, not the canned opener", async () => {
  for (const s of ["the bartender says their guests only drink IPAs, how do I answer?", "what should I tell them is next to Angry Orchard on the menu?"]) {
    assert.equal(answerFirst([{ role: "user", text: s }], base, { now: AT }), null, s);
    const seen = [];
    const r = await ask({ AGENT_SESSION: stub([{ text: "Ask what sells beside it." }], seen) }, s);
    assert.equal(seen.length, 1, `the model answers: ${s}`);
    assert.doesNotMatch(r.reply, /We already have Athletic Brewing/);
  }
});

test("coaching: resting, an uncovered question says so plainly, not the canned opener or the help menu", () => {
  const r = answerByRules([{ role: "user", text: "the bartender says their guests only drink IPAs, how do I answer?" }], base, { now: AT });
  assert.doesNotMatch(r.reply, /open with|We already have|^I can explain/);
  assert.match(r.reply, /talking points .* don't cover/);
});

test("coaching: general and known-objection questions still answer from the talking points", () => {
  const rules = (text) => answerFirst([{ role: "user", text }], base, { now: AT });
  for (const s of ["any tips?", "what should I say?", "what should I say at the next door?", "how do I pitch this one?", "what if they already have Angry Orchard?", "what if they say it's too expensive?", "they said we already have a kombucha", "what should I say if the owner isn't in?", "how do I follow up without being pushy?"]) {
    const r = rules(s);
    assert.ok(r && /^At |^To follow up/.test(r.reply), s);
  }
  assert.ok(isCoaching("what should I tell them is next to Angry Orchard on the menu?"), "still a coaching question, just not one the talking points answer");
});
