// the 70b re-run (v2-tour 884b188, 10-23): Llama 3.3 70b is the fallback whenever Anthropic is out. It answered
// "what's first today?" with "Your request is incomplete" 5/5, read Qloo's affinity and popularity numbers out in a
// why-not and in a one-line pitch, added the door's crowd line unasked, and "never say craft" let "well-crafted"
// through. No network.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.js";
import { _resetAgent, cleanReply, cleanContext, plainSay, namesForAliases, doorAlias, sessions } from "../src/agent.js";
import { answerFirst, answerByRules } from "../public/lib/agent-rules.js";
import { doorFacts } from "../public/lib/agent-tools.js";
import { scriptedSession } from "../src/llm.js";
import { demoContext } from "./agent-fixture.mjs";

const realFetch = globalThis.fetch;
before(() => {
  globalThis.fetch = async (u) => {
    throw new Error(`network call attempted in a test: ${u}`);
  };
});
after(() => (globalThis.fetch = realFetch));
beforeEach(() => _resetAgent());

const { ctx } = await demoContext({ current: "first" });
const [s1, s2] = ctx.day.stops;
const name = (s) => ctx.doors[s.id].name;
const ask = (text) => [{ role: "user", text }];

test("free models: no affinity or popularity numbers, no crowd line unasked; a pitch never speaks of Qloo", () => {
  const id = Object.keys(ctx.doors).find((k) => ctx.doors[k].name === "Growler Express");
  const facts = doorFacts(ctx, id);
  const c = cleanContext(ctx);
  const live = "Growler Express is not on any of your days because it didn't fit the route on Tuesday, which had no time left for it. Qloo ranks it #3 of 55 Austin bars and breweries for people who drink like Athletic Brewing drinkers, with an affinity score of 0.89 and a popularity score of 0.15. The restaurant attracts a local neighborhood crowd who enjoy a relaxed environment, craft beer culture, and friendly service.";
  assert.equal(cleanReply(live, c, { facts, words: "why is Growler Express not on any of my days?" }), "Growler Express is not on any of your days because it didn't fit the route on Tuesday, which had no time left for it.");
  // round 3 (Jard 10-23): asked for, the numbers still go; the crowd it was asked about stays
  const asked = cleanReply(live, c, { facts, words: "what's Growler Express's affinity and who is its crowd?" });
  assert.doesNotMatch(asked, /0\.\d\d/);
  assert.match(asked, /crowd/);
  // the trade's own math is not a Qloo number
  assert.equal(plainSay("That's $1.58 a can. Try one case.", "what do I ask for?"), "That's $1.58 a can. Try one case.");
  assert.equal(plainSay("Tidewell is a non-alcoholic hazy IPA your guests can order. The Drafting Room ranks #49 for your drinkers on Qloo. Start with one case.", "give me a one-line pitch for this door"), "Tidewell is a non-alcoholic hazy IPA your guests can order. Start with one case.");
});

test("an alias the free model writes beside the door's name goes", () => {
  const alias = doorAlias(ctx);
  const a = alias.short.get(s1.id);
  assert.equal(namesForAliases(`You have a stop at ${a}, ${name(s1)}, which is on the plan.`, alias, ctx), `You have a stop at ${name(s1)}, which is on the plan.`);
  assert.equal(namesForAliases(`You are visiting ${name(s1)}, ${a}, first today.`, alias, ctx), `You are visiting ${name(s1)}, first today.`);
});

test("'what's first today?' is Doors' own answer without Doors Agent: the first door not yet visited, its time, the next", async () => {
  for (const q of ["what's first today?", "hello, what's first today?", "where do I go first?", "what's my first stop?", "where do I start?"]) {
    const r = answerFirst(ask(q), ctx, { coaching: true });
    assert.match(r?.reply ?? "", new RegExp(`^First today: ${name(s1)}, around \\d{1,2}(:\\d\\d)? [ap]m\\. Then ${name(s2)}`), q);
    assert.deepEqual(r.actions, [{ type: "open", id: s1.id }]);
  }
  assert.equal(answerFirst(ask("what's first today?"), ctx, { coaching: false }), null); // Doors Agent answers it
  assert.equal(answerFirst(ask(`why is ${name(s1)} first?`), ctx, { coaching: true }), null);
  // the first door logged: the next one
  const logged = { ...ctx, doors: { ...ctx.doors, [s1.id]: { ...ctx.doors[s1.id], status: "visited" } } };
  assert.match(answerByRules(ask("what's first today?"), logged).reply, new RegExp(`^${name(s1)} is logged\\. Next today: ${name(s2)}`));
  // through the Worker on the fallback: no model is asked
  let asked = 0;
  const env = { AI: { run: async () => (asked++, { response: "Your request is incomplete." }) }, WORKERS_AI_MODELS: "70b" };
  const req = new Request("http://localhost:8792/api/agent", { method: "POST", headers: { origin: "http://localhost:8792", "content-type": "application/json", "cf-connecting-ip": "10.9.9.8" }, body: JSON.stringify({ v: 1, messages: ask("hello, what's first today?"), context: ctx }) });
  const out = await (await worker.fetch(req, env)).json();
  assert.equal(out.by, "rules");
  assert.match(out.reply, new RegExp(`^First today: ${name(s1)}`));
  assert.equal(asked, 0);
});

test("the product line starts lower case inside a sentence, softened or not", () => {
  const c = cleanContext(ctx);
  const brand = { ...c, profile: { ...c.profile, brand: "Hollow Pine Cider", what: "Dry hard cider" } };
  assert.equal(cleanReply("Hollow Pine Cider's Dry hard cider is a great option. Dry hard cider sells.", brand, { facts: [], words: "pitch" }), "Hollow Pine Cider's dry hard cider is a great option. Dry hard cider sells.");
  const avoidCider = { ...brand, envelopes: { [s1.id]: { constraints: { avoid: [], terms: {} }, slots: [{ field: "rule.avoid", value: "cider", source: "corrected", at: "2026-10-20T12:00:00.000Z" }] } } };
  assert.equal(cleanReply("Hollow Pine Cider's Dry hard drink is a great option.", avoidCider, { facts: [], words: "pitch" }), "Hollow Pine Cider's dry hard drink is a great option.");
  // an acronym stays
  const na = { ...c, profile: { ...c.profile, what: "NA hazy IPA" } };
  assert.equal(cleanReply("Tidewell's NA hazy IPA sells.", na, { facts: [], words: "pitch" }), "Tidewell's NA hazy IPA sells.");
});

test("without Doors Agent, a visit the rules can log never reaches the free model (live F8: 70b only saved a note)", async () => {
  let asked = 0;
  const env = { AI: { run: async () => (asked++, { response: "Noted." }) }, WORKERS_AI_MODELS: "70b" };
  const post = (text, ip) => new Request("http://localhost:8792/api/agent", { method: "POST", headers: { origin: "http://localhost:8792", "content-type": "application/json", "cf-connecting-ip": ip }, body: JSON.stringify({ v: 1, messages: ask(text), context: ctx }) });
  const out = await (await worker.fetch(post("done, owner wasn't in, back saturday at 3pm", "10.9.9.7"), env)).json();
  assert.equal(out.by, "rules");
  assert.equal(asked, 0);
  const o = out.actions.find((a) => a.type === "outcome")?.outcome;
  assert.equal(o?.result, "followup");
  assert.equal(o?.followUpTime, "15:00");
  assert.equal(dayOf(o.followUp), 6); // a Saturday
  assert.match(o.note, /owner wasn't in/);
  assert.match(out.reply, new RegExp(`^Logged ${name(s1)}`));
  // a re-plan with "done" in it is still a re-plan: the rules didn't log a visit, so the model is asked
  _resetAgent();
  await (await worker.fetch(post("I have to be done by 4:30", "10.9.9.6"), env)).json();
  assert.equal(asked, 1);
});
const dayOf = (d) => { const [y, m, x] = d.split("-").map(Number); return new Date(y, m - 1, x).getDay(); };

test("a visit log or what the door said is never a Sonnet web turn, whatever words it holds (live F8 went to Sonnet on 'owner')", () => {
  const c = cleanContext(ctx);
  const models = (w, ip) => sessions({ ANTHROPIC_API_KEY: "test", AGENT_MODEL: "claude-haiku-5-5" }, Date.now(), ip, c, [], w).map((x) => x.model); // round 3: Sonnet is the default; the web model only differs with Haiku set
  for (const [i, w] of ["done, owner wasn't in, back saturday at 3pm", "done, they have 20 taps, back next week", "the owner says it's too expensive, what do I say?", "owner isn't in today"].entries()) assert.deepEqual(models(w, `10.8.0.${i}`), ["claude-haiku-5-5"], w);
  for (const [i, w] of ["who owns The Drafting Room?", "what's on tap at Pinthouse Brewing?", "any events tonight at The Drafting Room?"].entries()) assert.deepEqual(models(w, `10.8.1.${i}`), ["claude-sonnet-5-5", "claude-haiku-5-5"], w);
});

test("the model's visit note is saved as the rep's words (live F7: Haiku saved 'Rep said: done, interested…')", async () => {
  const env = { AGENT_SESSION: scriptedSession([{ calls: [{ id: "1", name: "log_visit", args: { door_id: s1.id, result: "interested", follow_up_date: "2026-11-03", follow_up_time: "09:00", note: "Rep said: done, interested, back Tuesday at 9am." } }] }, { text: "Logged." }]) };
  const req = new Request("http://localhost:8792/api/agent", { method: "POST", headers: { origin: "http://localhost:8792", "content-type": "application/json", "cf-connecting-ip": "10.9.9.5" }, body: JSON.stringify({ v: 1, messages: ask("done, interested, back tuesday at 9am"), context: ctx }) });
  const out = await (await worker.fetch(req, env)).json();
  const o = out.actions.find((a) => a.type === "outcome")?.outcome;
  assert.equal(o?.note, "interested, back Tuesday at 9am.");
  assert.ok(!out.actions.some((a) => a.type === "slot" && /rep said|^done/i.test(String(a.record?.value ?? ""))), JSON.stringify(out.actions));
});
