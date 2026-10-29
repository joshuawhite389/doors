// R9 free models (docs/AGENT-FREE-MODELS.md): Workers AI's two answer shapes, Llama's argument habits,
// the neuron budget (70b → 8b → resting), the chain order (a cooling Gemini is skipped), one change of a kind per turn,
// and the log-visit judge. A stub env.AI replays recorded Workers AI answers. No network.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.js";
import { _resetAgent, coerceArgs, doorAlias, cleanContext, cleanReply, neuronsSpent, AGENT_NEURONS_70B, GEMINI_CHAIN, AGENT_BUSY, AGENT_RESTING, AGENT_NO_MODEL, restingMessage } from "../src/agent.js";
import { readWorkersAi } from "../src/llm.js";
import { TOOLS, runTool } from "../public/lib/agent-tools.js";
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
const SECOND = ctx.day.stops[1].id;
const post = (path, body) => new Request(`https://doors.example${path}`, { method: "POST", headers: { origin: "https://doors.example", "content-type": "application/json", "cf-connecting-ip": "203.0.113.8" }, body: JSON.stringify(body) });
const ask = async (env, text) => (await worker.fetch(post("/api/agent", { v: 1, messages: [{ role: "user", text }], context: ctx }), env)).json();
// Workers AI's 2026-10 answer (OpenAI shape), as recorded from llama-3.3-70b-instruct-fp8-fast
const oa = (msg, usage = { prompt_tokens: 3100, completion_tokens: 40 }) => ({ object: "chat.completion", choices: [{ index: 0, message: { role: "assistant", content: null, ...msg }, finish_reason: msg.tool_calls ? "tool_calls" : "stop" }], usage });
const call = (name, args, id = "chatcmpl-tool-1") => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });
// a stub binding: replays answers per model, records what it was asked
const stubAI = (byModel) => {
  const seen = [];
  return { seen, run: async (model, input) => (seen.push({ model, input }), (byModel[model] ?? byModel["*"]).shift() ?? oa({ content: "ok" })) };
};
const M70 = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const M8 = "@cf/meta/llama-3.1-8b-instruct-fp8-fast";

test("Workers AI answers in both shapes; a call written as text is read for a known tool only", () => {
  const names = new Set(["explain_door"]);
  let n = 0;
  const id = () => `x${++n}`;
  assert.deepEqual(readWorkersAi(oa({ tool_calls: [call("explain_door", { door_id: "d1" })] }), names, id).calls, [{ id: "chatcmpl-tool-1", name: "explain_door", args: { door_id: "d1" } }]);
  assert.deepEqual(readWorkersAi({ response: "", tool_calls: [{ name: "explain_door", arguments: { door_id: "d2" } }] }, names, id).calls[0].args, { door_id: "d2" });
  assert.equal(readWorkersAi({ response: '{"name": "explain_door", "parameters": {"door_id": "d3"}}' }, names, id).calls[0].args.door_id, "d3");
  assert.equal(readWorkersAi({ response: '<function=explain_door>{"door_id": "d4"}</function>' }, names, id).calls[0].args.door_id, "d4");
  assert.equal(readWorkersAi({ response: '{"name": "drop_tables", "parameters": {}}' }, names, id).calls.length, 0);
  assert.equal(readWorkersAi(oa({ content: "<think>hm</think>Sure." }), names, id).text, "Sure.");
});

test("arguments as the schema types them; Llama 8b's placeholders dropped; d-aliases mapped back to door ids", () => {
  const alias = doorAlias(cleanContext(ctx));
  const replan = TOOLS.find((t) => t.name === "replan").parameters;
  assert.deepEqual(coerceArgs(replan, { skip: ["d2"], end_by: "16:30", start_now: "false", max_doors: "0", lock: "[]", add: "[]", day: "None" }, alias), { skip: [SECOND], end_by: "16:30", start_now: false });
  assert.deepEqual(coerceArgs(replan, { skip: "d1, d2", max_doors: "3", start_now: "True" }, alias), { skip: [FIRST, SECOND], max_doors: 3, start_now: true });
  assert.deepEqual(coerceArgs(replan, { skip: [SECOND] }, alias), { skip: [SECOND] }, "a real id still works");
});

test("a chat turn on Workers AI: the prompt names doors d1…, the call is mapped back and run, neurons counted", async () => {
  const ai = stubAI({ [M70]: [oa({ tool_calls: [call("replan", { skip: ["d2"], end_by: "16:30" })] }), oa({ content: "Done: The Tavern is skipped and you finish by 4:30." })] });
  const r = await ask({ AI: ai }, "I have to be done by 4:30 today, and skip the next one");
  assert.equal(r.by, "workers-ai");
  assert.equal(r.resting, undefined);
  const a = r.actions.find((x) => x.type === "replan");
  assert.deepEqual([a.skip, a.endBy], [[SECOND], "16:30"]);
  assert.match(ai.seen[0].input.messages[1].content, /"current_door":"d1"/);
  assert.ok(!ai.seen[0].input.messages[1].content.includes(FIRST), "no UUIDs in the prompt");
  assert.ok(!JSON.stringify(ai.seen[1].input.messages.at(-1)).includes(SECOND), "tool results speak aliases too");
  assert.ok(Math.abs(neuronsSpent() - 2 * (3100 * 26668 + 40 * 204805) / 1e6) < 0.01);
});

test("one change of a kind per turn: Llama's second replan is answered 'already done', not applied twice", async () => {
  const ai = stubAI({ [M70]: [oa({ tool_calls: [call("replan", { end_by: "16:30" })] }), oa({ tool_calls: [call("replan", { end_by: "16:30" }, "t2")] }), oa({ content: "Done." })] });
  const r = await ask({ AI: ai }, "done by 4:30");
  assert.equal(r.actions.filter((x) => x.type === "replan").length, 1);
  assert.match(JSON.stringify(ai.seen[2].input.messages.filter((m) => m.role === "tool").at(-1)), /already done/);
});

test("neurons: past AGENT_NEURONS_70B the 8b model answers; past the day's share the rules answer, labelled", async () => {
  const big = { prompt_tokens: 120000, completion_tokens: 0 }; // 3,200 neurons on 70b
  const ai = stubAI({ [M70]: [oa({ content: "one" }, big), oa({ content: "two" }, big)], [M8]: [oa({ content: "three" }, { prompt_tokens: 1e6, completion_tokens: 0 })] });
  const env = { AI: ai };
  assert.equal((await ask(env, "hello")).reply, "one");
  assert.equal((await ask(env, "hello")).reply, "two");
  assert.ok(neuronsSpent() > AGENT_NEURONS_70B);
  assert.equal((await ask(env, "hello")).reply, "three");
  assert.equal(ai.seen.at(-1).model, M8);
  const r = await ask(env, "hello");
  assert.equal(r.resting, true);
  assert.match(r.modelError, /workers-ai:neurons/);
  assert.equal(ai.seen.length, 3, "no Workers AI call once the share is used");
});

test("one visitor gets AGENT_70B_PER_VISITOR turns a day on 70b, then 8b", async () => {
  const ai = stubAI({ "*": Array.from({ length: 6 }, () => oa({ content: "ok" }, { prompt_tokens: 10, completion_tokens: 1 })) });
  const env = { AI: ai, AGENT_70B_PER_VISITOR: 2 };
  for (let i = 0; i < 3; i++) await ask(env, "hello");
  assert.deepEqual(ai.seen.map((x) => x.model), [M70, M70, M8]);
});

test("Cloudflare's 'allocation used' error ends Workers AI for the day", async () => {
  const ai = { n: 0, run: async () => (ai.n++, Promise.reject(new Error('Workers AI 429: [{"code":4006,"message":"you have used up your daily free allocation of 10,000 neurons"}]'))) };
  const r = await ask({ AI: ai }, "hello");
  assert.equal(r.resting, true);
  assert.match(r.modelError, /70b:spent/);
  assert.equal((await ask({ AI: ai }, "hello")).modelError, "workers-ai:neurons");
  assert.equal(ai.n, 1);
});

test("chain order (live check D): Workers AI first, Gemini only when Workers AI fails; the panel is told which model", async () => {
  const hits = [];
  const ok = (text) => new Response(JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text }] } }] }), { status: 200 });
  const GEMINI_FETCH = async (url) => (hits.push(url), ok("from gemini"));
  const ai = stubAI({ "*": [oa({ content: "from llama" })] });
  const env = { GEMINI_API_KEY: "k", GEMINI_FETCH, AI: ai };
  const r1 = await ask(env, "hello");
  assert.equal(hits.length, 0, "Gemini isn't asked while Workers AI answers");
  assert.deepEqual([r1.by, r1.model, r1.reply], ["workers-ai", "Cloudflare Workers AI (Llama 3.3 70B)", "from llama"]);
  const down = { GEMINI_API_KEY: "k", GEMINI_FETCH, AI: { run: async () => Promise.reject(new Error("Workers AI 500: boom")) } };
  const r2 = await ask(down, "hello");
  assert.deepEqual([r2.by, r2.model, r2.reply], ["gemini", "Google Gemini (3.5 flash)", "from gemini"]);
});

test("Gemini's per-day 429 cools that model until Google's reset, not 5 minutes (live check D)", async () => {
  const asked = [];
  const day = JSON.stringify({ error: { code: 429, details: [{ "@type": "type.googleapis.com/google.rpc.QuotaFailure", violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] }, { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "31929s" }] } });
  const ok = (text) => new Response(JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text }] } }] }), { status: 200 });
  const env = { GEMINI_API_KEY: "k", GEMINI_MODELS: "m-day,m-ok", GEMINI_FETCH: async (url) => (asked.push(url.match(/models\/([^:]+)/)[1]), url.includes("m-day") ? new Response(day, { status: 429 }) : ok("fine")) };
  assert.equal((await ask(env, "hello")).reply, "fine");
  const { sessions } = await import("../src/agent.js");
  assert.deepEqual(sessions(env, Date.now() + 6 * 60 * 1000).map((x) => x.model), ["m-ok"], "still cooling after 6 min");
  assert.deepEqual(sessions(env, Date.now() + 31930 * 1000).map((x) => x.model), ["m-day", "m-ok"], "back after the reset");
});

test("every model cooling: no model is asked again, the rules answer at once, busy (live check D)", async () => {
  let n = 0;
  const day = JSON.stringify({ error: { code: 429, details: [{ violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] }, { "@type": "type.googleapis.com/google.rpc.RetryInfo", retryDelay: "30000s" }] } });
  const env = { GEMINI_API_KEY: "k", GEMINI_MODELS: "m-day,m-busy", GEMINI_FETCH: async (url) => (n++, url.includes("m-day") ? new Response(day, { status: 429 }) : new Response("busy", { status: 503 })) };
  const r1 = await ask(env, "hello");
  assert.equal(n, 2);
  assert.equal(r1.resting, true);
  const t0 = Date.now();
  const r2 = await ask(env, "hello");
  assert.equal(n, 2, "neither model asked again");
  assert.ok(Date.now() - t0 < 500);
  assert.equal(r2.modelError, "m-day:spent,m-busy:cooling");
  assert.equal(r2.message, AGENT_BUSY);
});

test("20 quick asks from one visitor on the production config (Gemini 429ing, Workers AI bound) all get a model answer (R9 polish)", async () => {
  let gemini = 0;
  const GEMINI_FETCH = async () => (gemini++, new Response("quota", { status: 429 }));
  const ai = stubAI({ "*": [] }); // every step: "ok"
  const env = { GEMINI_API_KEY: "k", GEMINI_FETCH, AI: ai };
  const by = [];
  for (let i = 0; i < 20; i++) by.push((await ask(env, `why is stop ${(i % 3) + 1} there?`)).by);
  assert.deepEqual([...new Set(by)], ["workers-ai"], "no turn fell to the rules");
  assert.ok(gemini <= GEMINI_CHAIN.length, `Gemini tried ${gemini} times across 20 turns`);
});

test("resting copy: 'for today' only when the day is spent; a transient failure says busy, with retry (R9 polish)", async () => {
  const GEMINI_FETCH = async () => new Response("overloaded", { status: 503 });
  const busy = await ask({ GEMINI_API_KEY: "k", GEMINI_FETCH }, "hello");
  assert.equal(busy.resting, true);
  assert.equal(busy.message, AGENT_BUSY);
  assert.equal(busy.retry, true);
  assert.doesNotMatch(busy.message, /for today/);
  assert.equal(restingMessage(["spent"]), AGENT_RESTING);
  assert.equal(restingMessage(["workers-ai:neurons", "70b:spent"]), AGENT_RESTING);
  assert.equal(restingMessage(["workers-ai:neurons", "gemini-3.5-flash:429"]), AGENT_BUSY);
  assert.equal(restingMessage([]), AGENT_NO_MODEL);
});

test("a reply that narrates the tool call or shows an id is dropped for the fallback", () => {
  const c = cleanContext(ctx);
  assert.equal(cleanReply('The replan function is called with skip=["d2"]. You finish by 4:30.', c), "You finish by 4:30.");
  assert.equal(cleanReply(`Skipped ${SECOND}.`, c), "");
});

test("log-visit judge: the rules decide yes/no and not-a-fit; a who the rep never said is dropped", () => {
  const opts = { words: "done, come back Thursday at 3, liked it, hesitant about price", now: `${ctx.today}T14:20` };
  const r = runTool("log_visit", { door_id: FIRST, result: "no", follow_up_date: "2026-10-29", follow_up_time: "15:00", who: ctx.doors[FIRST].name, note: "liked it" }, ctx, opts);
  assert.equal(r.ok, true);
  assert.notEqual(r.result.visit.outcome.result, "no");
  assert.equal(r.result.visit.outcome.followUp, "2026-10-29");
  assert.equal(r.result.visit.outcome.who, undefined);
  const nf = runTool("log_visit", { door_id: FIRST, result: "no" }, ctx, { words: "not a fit, they only do wine" });
  assert.equal(nf.result.visit.status, "notfit");
  const who = runTool("log_visit", { door_id: FIRST, result: "someone", who: "the manager" }, ctx, { words: "talked to the manager" });
  assert.equal(who.result.visit.outcome.who, "the manager");
});

test("remember: a contact sent as a bare name (+ role beside it) is kept as {name, role}", () => {
  const r = runTool("remember", { field: "contact", value: "Dana", role: "manager", door_id: FIRST }, ctx, { words: "the manager here is Dana" });
  assert.equal(r.ok, true);
  assert.deepEqual(r.actions[0].record.value, { name: "Dana", role: "manager" });
});
