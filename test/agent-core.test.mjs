// Doors Agent core (spec §4, §7): Anthropic first behind the free chain, the
// persona + three-kinds system prompt (cached), thinking effort by mode, the $ guard, the reply filters' loose mode and
// the door-alias rewrite. A stub ANTHROPIC_FETCH replays Messages API answers. No network.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import worker from "../src/worker.js";
import { _resetAgent, AGENT_MODEL, AGENT_SYSTEM, agentSystem, cleanContext, cleanReply, claimsBacked, doorAlias, effortOf, namesForAliases, usdOf, usdSpent, AGENT_DAILY, AGENT_WINDOW } from "../src/agent.js";
import { anthropicSession } from "../src/llm.js";
import { TRADE_BRIEF } from "../src/agent-brief/trade-brief.js";
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
const FIRST = ctx.day.stops[0].id;
const post = (body) => new Request("https://doors.example/api/agent", { method: "POST", headers: { origin: "https://doors.example", "content-type": "application/json", "cf-connecting-ip": "203.0.113.9" }, body: JSON.stringify(body) });
const ask = async (env, text, context = ctx) => (await worker.fetch(post({ v: 1, messages: [{ role: "user", text }], context }), env)).json();
const usage = { input_tokens: 900, output_tokens: 80, cache_read_input_tokens: 9000, cache_creation_input_tokens: 0 };
const msg = (content, stop = "end_turn") => ({ id: "msg_1", type: "message", role: "assistant", content, stop_reason: stop, usage });
const text = (t) => ({ type: "text", text: t });
const use = (name, input, id = "toolu_1") => ({ type: "tool_use", id, name, input });
// a stub Messages API: replays answers in order, records each request body
const stubFetch = (answers) => {
  const seen = [];
  const f = async (url, init) => {
    seen.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    const a = answers.shift();
    if (!a) throw new Error("stub exhausted");
    if (a.status) return new Response(a.body ?? "{}", { status: a.status });
    return Response.json(a);
  };
  f.seen = seen;
  return f;
};
const env = (answers, more = {}) => ({ ANTHROPIC_API_KEY: "sk-test", ANTHROPIC_FETCH: stubFetch(answers), ...more });

test("the trade brief module matches TRADE-BRIEF.md (re-run scripts/build-trade-brief.mjs after editing it)", () => {
  assert.equal(TRADE_BRIEF, readFileSync(new URL("../src/agent-brief/TRADE-BRIEF.md", import.meta.url), "utf8").trim());
  assert.match(TRADE_BRIEF, /tied-house/i);
});

test("Anthropic answers first: Sonnet 5.5 (round 3), the persona + rules block cached, CONTEXT in the user turn, its name and cost on the reply", async () => {
  const e = env([msg([text("Lead with the margin math: at $7 a can they keep about $5.42. Ask for one case in the cooler.")])]);
  const r = await ask(e, "how do I pitch this place?");
  assert.equal(r.by, "anthropic");
  assert.equal(r.model, "Anthropic Claude (Sonnet 5.5)");
  assert.match(r.reply, /\$5\.42/);
  const req = e.ANTHROPIC_FETCH.seen[0];
  assert.equal(req.url, "https://api.anthropic.com/v1/messages");
  assert.equal(req.headers["x-api-key"], "sk-test");
  assert.equal(req.body.model, AGENT_MODEL);
  assert.equal(req.body.model, "claude-sonnet-5-5");
  assert.equal(req.body.system[0].cache_control.type, "ephemeral");
  assert.ok(req.body.system[0].text.includes(TRADE_BRIEF));
  assert.match(req.body.system[0].text, /three kinds of statement/i);
  assert.doesNotMatch(req.body.system[0].text, /CONTEXT \{/); // the turn's context never breaks the cache
  assert.match(req.body.messages[0].content, /^CONTEXT \{/);
  assert.deepEqual(req.body.thinking, { type: "adaptive" });
  assert.equal(req.body.output_config.effort, "medium"); // desk
  assert.ok(req.body.tools.some((t) => t.name === "replan" && t.input_schema));
  assert.ok(r.cost.usd > 0 && r.cost.cacheRead === 9000);
});

test("one setting: AGENT_MODEL=claude-opus-5-5 (or haiku)", async () => {
  const e = env([msg([text("Ask for the buyer and their best time.")])], { AGENT_MODEL: "claude-opus-5-5" });
  const r = await ask(e, "what now?");
  assert.equal(e.ANTHROPIC_FETCH.seen[0].body.model, "claude-opus-5-5");
  assert.equal(r.model, "Anthropic Claude (Opus 5.5)");
  const h = env([msg([text("Ask for the buyer and their best time.")])], { AGENT_MODEL: "claude-haiku-5-5" });
  assert.equal((await ask(h, "what now?")).model, "Anthropic Claude (Haiku 5.5)");
});

test("thinking effort: low in drive mode, higher at a desk; drive mode's ask carries its length", async () => {
  assert.equal(effortOf({}, { mode: "drive" }), "low");
  assert.equal(effortOf({}, { mode: "desk" }), "medium");
  assert.equal(effortOf({ AGENT_EFFORT_DESK: "high" }, { mode: "desk" }), "high");
  assert.equal(cleanContext({ mode: "drive" }).mode, "drive");
  assert.equal(cleanContext({ mode: "anything" }).mode, "plan");
  const e = env([msg([text("Ask for the buyer.")])]);
  await ask(e, "what now?", { ...ctx, mode: "drive" });
  const b = e.ANTHROPIC_FETCH.seen[0].body;
  assert.equal(b.output_config.effort, "low");
  assert.match(b.messages[0].content, /drive mode: one or two short sentences/);
});

test("length by screen (spec §6, step 5): drive and stop ask for one or two sentences, the plan for up to about three", async () => {
  assert.equal(cleanContext({ mode: "stop" }).mode, "stop");
  assert.equal(cleanContext({ mode: "plan" }).mode, "plan");
  assert.equal(cleanContext({ mode: "desk" }).mode, "plan"); // an older client
  assert.equal(effortOf({}, { mode: "stop" }), "medium");
  assert.match(AGENT_SYSTEM, /mode stop \(.*\): one or two short sentences \(a briefing: up to five\)\. mode plan: what the answer needs and no more; a short list/); assert.match(AGENT_SYSTEM, /Say what they need and stop/); // Jard 10-25: the voice shapes the length, not a sentence count; // round 3: a desk answer runs as long as it needs
  const e = env([msg([text("Lead with the margin.")]), msg([text("Lead with the margin.")])]);
  await ask(e, "how do I open here?", { ...ctx, mode: "stop" });
  await ask(e, "how do I open here?", { ...ctx, mode: "plan" });
  const [stop, plan] = e.ANTHROPIC_FETCH.seen.map((x) => x.body.messages[0].content);
  assert.match(stop, /"mode":"stop"/);
  assert.match(stop, /\(at a stop: one or two short sentences\)/);
  assert.match(plan, /"mode":"plan"/);
  assert.doesNotMatch(plan, /one or two short sentences/);
});

test("a tool call round-trips: tool_use → our tool runs → tool_result, the assistant's blocks kept verbatim (thinking too)", async () => {
  const thinking = { type: "thinking", thinking: "", signature: "sig-abc" };
  const e = env([msg([thinking, use("explain_door", { door_id: "d1" })], "tool_use"), msg([text("It's #49 of 55, so keep the ask small: one case.")])]);
  const r = await ask(e, "how strong a fit is this place?");
  assert.deepEqual(r.tools, [{ name: "explain_door", ok: true }]);
  const second = e.ANTHROPIC_FETCH.seen[1].body.messages;
  assert.deepEqual(second[1], { role: "assistant", content: [thinking, use("explain_door", { door_id: "d1" })] });
  assert.equal(second[2].content[0].type, "tool_result");
  assert.equal(second[2].content[0].tool_use_id, "toolu_1");
  assert.ok(r.facts.length > 0);
});

test("pause_turn is called again inside the same step, and its blocks accumulate", async () => {
  const f = stubFetch([msg([text("Looking")], "pause_turn"), msg([text(" it up. Ask for the buyer.")])]);
  const s = anthropicSession({ apiKey: "k", fetchImpl: f })({ system: "sys", user: "hi", tools: [] });
  const out = await s.step();
  assert.equal(f.seen.length, 2);
  assert.equal(out.text, "Looking it up. Ask for the buyer.");
  assert.equal(out.content.length, 2);
  assert.equal(f.seen[1].body.messages.at(-1).role, "assistant"); // the paused turn goes on from its own blocks
});

test("Anthropic fails → the free chain, then the rules; the model cools", async () => {
  const e = env([{ status: 529, body: '{"type":"error","error":{"type":"overloaded_error"}}' }]);
  const r = await ask(e, "what now?");
  assert.equal(r.resting, true);
  assert.match(r.modelError, /claude-sonnet-5-5:529/);
  const again = await ask({ ...e, ANTHROPIC_FETCH: stubFetch([]) }, "what now?");
  assert.match(again.modelError, /claude-sonnet-5-5:cooling/);
});

test("the $ guard: past AGENT_USD_DAILY the site stops calling Anthropic for the day", async () => {
  const big = { input_tokens: 10_000_000, output_tokens: 0 }; // $1 on Haiku
  const e = env([{ ...msg([text("Ask for the buyer.")]), usage: big }], { AGENT_USD_DAILY: "0.5" });
  assert.equal((await ask(e, "what now?")).by, "anthropic");
  assert.ok(usdSpent() >= 1);
  const r = await ask({ ...e, ANTHROPIC_FETCH: stubFetch([]) }, "what now?");
  assert.equal(r.resting, true);
  assert.ok(Math.abs(usdOf({ input_tokens: 50_000, output_tokens: 50_000 }, "claude-haiku-5-5") - 0.03) < 1e-9);
  // a prompt over 100k tokens is Haiku 5.5's 5× tier
  assert.ok(Math.abs(usdOf({ input_tokens: 200_000, output_tokens: 0 }, "claude-haiku-5-5") - 0.1) < 1e-9);
});

test("per visitor: 20 asks per 10 minutes, 60 a day", () => {
  assert.equal(AGENT_WINDOW, 20);
  assert.equal(AGENT_DAILY, 60);
});

test("a coaching question goes to Doors Agent when it's up, to Doors' rules when not", async () => {
  const q = "The manager says it's too pricey. What do I say?";
  const e = env([msg([text("Do the math per serve: $1.58 a can against a $7 menu price.")])]);
  assert.equal((await ask(e, q)).by, "anthropic");
  const free = await ask({}, q);
  assert.notEqual(free.by, "anthropic");
});

test("the system prompt: three kinds, the law, no 'only facts, else Qloo doesn't say'; a specialist brief is its own cached block", () => {
  assert.match(AGENT_SYSTEM, /Trade know-how/);
  assert.match(AGENT_SYSTEM, /Never stop at \\?"I don't know\\?"/);
  assert.match(AGENT_SYSTEM, /tied-house/);
  assert.doesNotMatch(AGENT_SYSTEM, /say Qloo's data doesn't say; never guess/);
  assert.equal(agentSystem(null).length, 1);
  assert.equal(agentSystem({ status: "none" }).length, 1); // the stub brief.js gives no block
});

test("loose replies (Anthropic): a list's line breaks stay, the trade's own math stands, Qloo numbers still need backing", () => {
  const t = "Lead with margin.\n- $165 a sixtel is about $4.02 a pint.\n- Qloo ranks it #3 of 55.";
  assert.equal(cleanReply(t, ctx, { facts: [], words: "" }, { loose: true }), "Lead with margin.\n- $165 a sixtel is about $4.02 a pint.");
  // round 3 (agent2): a backed number stands in a Claude reply, asked for or not (the free models' path still words it)
  assert.match(cleanReply(t, ctx, { facts: [{ text: "#3 of 55" }], words: "" }, { loose: true }), /ranks it #3 of 55/);
  assert.match(cleanReply(t, ctx, { facts: [{ text: "#3 of 55" }], words: "its numbers?" }, { loose: true }), /ranks it #3 of 55/);
  assert.match(cleanReply(t, ctx, { facts: [], words: "CONTEXT rank 3 of 55" }, { loose: true }), /ranks it #3 of 55/); // backed by what the model was shown
  // the strict (free model) path is unchanged: one line, the unbacked decimal dropped
  assert.doesNotMatch(cleanReply(t, ctx, { facts: [], words: "" }), /\n/);
  assert.equal(claimsBacked("A crowd like this wants it cold.", { facts: [] }, true), "A crowd like this wants it cold.");
});

test("door aliases in the model's prose become names (live eval 10-23: whole sentences were dropped)", () => {
  const al = doorAlias(ctx);
  const n1 = ctx.doors[al.long.get("d1")].name;
  const n6 = ctx.doors[al.long.get("d6")].name;
  assert.equal(namesForAliases(`Lead at ${n6} (d6, #1 at 0.91). Skip d1 if late.`, al, ctx), `Lead at ${n6} (#1 at 0.91). Skip ${n1} if late.`);
  assert.equal(namesForAliases(`${n6} (d6) first.`, al, ctx), `${n6} first.`);
  assert.equal(namesForAliases("d99 stays.", al, ctx), "d99 stays.");
});

test("drive mode's log-visit runs at low effort", async () => {
  const e = env([msg([use("log_visit", { door_id: "d1", result: "interested" })], "tool_use"), msg([text("Logged.")])]);
  const res = await worker.fetch(new Request("https://doors.example/api/agent/log-visit", { method: "POST", headers: { origin: "https://doors.example", "content-type": "application/json" }, body: JSON.stringify({ text: "they loved it, want a case", stop: { id: FIRST, name: "The Drafting Room" }, now: { date: ctx.today, min: 900 } }) }), e);
  assert.equal(res.status, 200);
  assert.equal(e.ANTHROPIC_FETCH.seen[0].body.output_config.effort, "low");
});
