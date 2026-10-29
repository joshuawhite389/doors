// Doors Agent's specialist brief and web search (src/brief.js): category + city keys, the KV cache (built once, shared,
// capped), what is sent (category and city only), the agent hooks and /api/brief. No network: Anthropic is a stub.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { briefCategory, briefKey, citedText, mergeCited, buildBrief, ensureBrief, briefForTurn, briefPrompt, webSearchTool, webFacts, handleBrief, _resetWeb, WEB_VISITOR_DAILY, BRIEF_DAILY } from "../src/brief.js";
import { askBrief, _resetAsked } from "../public/lib/brief-client.js";
import worker from "../src/worker.js";

const kv = () => {
  const m = new Map();
  return { m, get: async (k, t) => (m.has(k) ? (t === "json" ? JSON.parse(m.get(k)) : m.get(k)) : null), put: async (k, v) => void m.set(k, v) };
};
const LONG = "TRADE\nNon-alcoholic beer keeps growing in bars and shops across the country this year. ";
// a recorded-shape answer: a preamble, one search, its result, then cited text
const answer = { stop_reason: "end_turn", usage: { input_tokens: 90000, output_tokens: 5000, server_tool_use: { web_search_requests: 5 } }, content: [
  { type: "text", text: "I'll research this." },
  { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "NA beer Austin" } },
  { type: "web_search_tool_result", tool_use_id: "s1", content: [{ type: "web_search_result", url: "https://a.example/na", title: "NA report" }] },
  { type: "text", text: "I have enough to write the brief.\n\n" },
  { type: "text", text: LONG.repeat(2), citations: [{ type: "web_search_result_location", url: "https://a.example/na", title: "NA report", cited_text: "grew 23%" }] },
  { type: "text", text: "\nSCENE\nEast Austin carries the zero-proof rooms.", citations: [{ type: "web_search_result_location", url: "https://b.example/austin", title: "Austin guide", cited_text: "east side" }] },
  { type: "text", text: " Lead with taste." },
] };
const stub = (calls, body = answer) => async (url, init) => {
  calls.push(JSON.parse(init.body));
  return new Response(JSON.stringify(body), { status: 200 });
};

beforeEach(() => {
  _resetWeb();
  _resetAsked();
});

test("category: coarse and shared; NA split; the key is category + city slug", () => {
  assert.equal(briefCategory("Non-alcoholic hazy IPA").key, "na-beer");
  assert.equal(briefCategory("Craft IPA").key, "craft-beer");
  assert.equal(briefCategory("Hard seltzer").key, "seltzer-rtd");
  assert.equal(briefCategory("Dry hard cider").key, briefCategory("Cider").key);
  assert.equal(briefCategory("Bourbon").key, "spirits");
  assert.equal(briefCategory("Sparkling water").key, "soft-drinks");
  assert.equal(briefCategory("").key, "other");
  assert.equal(briefKey("na-beer", "Austin, TX"), "brief:v1:na-beer:austin-tx");
  assert.equal(briefKey("na-beer", "  São Paulo "), "brief:v1:na-beer:sao-paulo");
});

test("citedText: the text after the last search, its citations as [n], numbered sources", () => {
  const { text, sources } = citedText(answer.content);
  assert.ok(!text.includes("I'll research"));
  assert.match(text, /\[1\]/);
  assert.match(text, /rooms\. \[2\] Lead with taste\./);
  assert.deepEqual(sources.map((s) => s.url), ["https://a.example/na", "https://b.example/austin"]);
});

test("a brief is built once, cached and shared; only the category and the city are sent", async () => {
  const env = { ANTHROPIC_API_KEY: "k", DOORS_KV: kv() };
  const calls = [];
  const a = await ensureBrief(env, "Tidewell Non-alcoholic hazy IPA", "Austin", { fetchImpl: stub(calls) });
  assert.equal(a.state.status, "building");
  const v = await a.work;
  assert.equal(v.status, "ready");
  assert.equal(v.sources.length, 2);
  assert.ok(v.usd > 0);
  const sent = JSON.stringify(calls[0]);
  assert.ok(!/Tidewell|hazy|IPA/i.test(sent), "no brand or product line leaves Doors");
  assert.match(sent, /non-alcoholic beer/);
  assert.match(sent, /Austin/);
  assert.equal(calls[0].tools[0].type, "web_search_20250305");
  assert.ok(calls[0].tools[0].blocked_domains.includes("linkedin.com"));
  // another rep, another NA beer, same city: the cached brief, no call
  const b = await ensureBrief(env, "NA lager", "austin", { fetchImpl: stub(calls) });
  assert.equal(b.state.status, "ready");
  assert.equal(b.work, undefined);
  assert.equal(calls.length, 2, "two parts at once, then none");
  assert.match(JSON.stringify(calls[0]), /TRADE/);
  assert.match(JSON.stringify(calls[1]), /SCENE/);
  assert.equal(calls[0].tools[0].max_uses, 2);
  assert.deepEqual(calls[0].thinking, { type: "disabled" });
});

test("caps: no key, no KV, the day's builds, a visitor's builds", async () => {
  assert.equal((await ensureBrief({ DOORS_KV: kv() }, "IPA", "Boise")).state.reason, "no model");
  assert.equal((await ensureBrief({ ANTHROPIC_API_KEY: "k" }, "IPA", "Boise")).state.reason, "no cache");
  const env = { ANTHROPIC_API_KEY: "k", DOORS_KV: kv() };
  await env.DOORS_KV.put(`brief:count:${new Date().toISOString().slice(0, 10)}`, JSON.stringify({ n: BRIEF_DAILY }));
  assert.equal((await ensureBrief(env, "IPA", "Boise", { fetchImpl: stub([]) })).state.reason, "daily");
  const env2 = { ANTHROPIC_API_KEY: "k", DOORS_KV: kv() };
  const cities = ["A1", "B2", "C3", "D4", "E5"];
  const got = [];
  for (const c of cities) got.push((await ensureBrief(env2, "IPA", c, { fetchImpl: stub([]), ip: "1.2.3.4" })).state.status);
  assert.deepEqual(got, ["building", "building", "building", "building", "none"]);
});

test("a failed build is stored, not retried at once", async () => {
  const env = { ANTHROPIC_API_KEY: "k", DOORS_KV: kv() };
  const calls = [];
  const thin = { stop_reason: "end_turn", usage: {}, content: [{ type: "text", text: "Too little." }] };
  const f = await (await ensureBrief(env, "IPA", "Tiny Town", { fetchImpl: stub(calls, thin) })).work;
  assert.equal(f.status, "failed");
  assert.equal((await ensureBrief(env, "IPA", "Tiny Town", { fetchImpl: stub(calls, thin) })).state.status, "failed");
  assert.equal(calls.length, 2);
});

test("the agent: briefForTurn reads the cache; briefPrompt carries the text and its sources, or says it's loading", async () => {
  const env = { ANTHROPIC_API_KEY: "k", DOORS_KV: kv() };
  const ctx = { profile: { what: "Non-alcoholic IPA" }, city: { name: "Austin" } };
  const none = await briefForTurn(env, ctx);
  assert.equal(none.status, "loading");
  assert.match(briefPrompt(none), /still loading/);
  await (await ensureBrief(env, "Non-alcoholic IPA", "Austin", { fetchImpl: stub([]) })).work;
  const b = await briefForTurn(env, ctx);
  assert.equal(b.status, "ready");
  const p = briefPrompt(b);
  assert.match(p, /SPECIALIST BRIEF for non-alcoholic beer in Austin/);
  assert.match(p, /\[1\] NA report — https:\/\/a\.example\/na/);
  assert.match(p, /never turn it into a claim about what a named door stocks/);
  assert.equal(briefPrompt({ status: "none" }), "");
  assert.equal((await briefForTurn(env, { profile: {}, city: {} })).status, "none");
});

test("web search: the server tool until the visitor's day is spent; facts carry their links", () => {
  const ctx = { city: { name: "Austin" } };
  const tool = webSearchTool(ctx, {}, "v1");
  assert.equal(tool.type, "web_search_20250305");
  assert.equal(tool.user_location.city, "Austin");
  const content = [
    { type: "server_tool_use", name: "web_search", input: { query: "Meanwhile Brewing events" } },
    { type: "text", text: "Trivia is Tuesday at 8.", citations: [{ type: "web_search_result_location", url: "https://www.meanwhilebeer.com/events", title: "Events", cited_text: "Tuesday Trivia 8:00 pm" }, { type: "web_search_result_location", url: "https://www.meanwhilebeer.com/events", cited_text: "free to enter" }] },
    { type: "text", text: "Bad link.", citations: [{ type: "web_search_result_location", url: "javascript:alert(1)", cited_text: "x" }] },
  ];
  const facts = webFacts(content, "v1");
  assert.equal(facts.length, 1);
  assert.equal(facts[0].source.kind, "web");
  assert.equal(facts[0].source.label, "meanwhilebeer.com");
  assert.equal(facts[0].source.url, "https://www.meanwhilebeer.com/events");
  assert.match(facts[0].text, /Tuesday Trivia 8:00 pm … free to enter/);
  for (let i = 1; i < WEB_VISITOR_DAILY; i++) webFacts(content, "v1");
  assert.equal(webSearchTool(ctx, {}, "v1"), null);
  assert.ok(webSearchTool(ctx, {}, "v2"));
  assert.equal(webSearchTool(ctx, { WEB_SEARCH: "0" }, "v3"), null);
});

test("/api/brief: POST builds and answers the brief; GET only reads; a foreign page is refused", async () => {
  const env = { ANTHROPIC_API_KEY: "k", DOORS_KV: kv() };
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = stub(calls);
  try {
    const post = (origin) => worker.fetch(new Request("https://doors.example/api/brief", { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ what: "Hard seltzer", city: "Boise" }) }), env, { waitUntil() {} });
    assert.equal((await post("https://evil.example")).status, 403);
    const r = await (await post("https://doors.example")).json();
    assert.equal(r.status, "ready");
    assert.equal(r.category, "hard seltzer and canned cocktails (RTD)");
    assert.equal(r.sources.length, 2);
    const g = await (await worker.fetch(new Request("https://doors.example/api/brief?what=Hard+seltzer&city=Boise"), env, {})).json();
    assert.equal(g.status, "ready");
    const g2 = await (await worker.fetch(new Request("https://doors.example/api/brief?what=Cider&city=Boise"), env, {})).json();
    assert.equal(g2.status, "none");
    assert.equal(calls.length, 2);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("client: asks once per product line + city, sends only those two", async () => {
  const sent = [];
  const send = async (u, o) => sent.push([u, JSON.parse(o.body)]);
  const plan = { profile: { what: "Craft IPA", brand: "Tidewell", pitch: { name: "Maya" } }, city: { key: "dayton", name: "Dayton" } };
  assert.equal(askBrief(plan, send), true);
  assert.equal(askBrief(plan, send), false);
  assert.equal(askBrief({ profile: { what: "x" }, city: {} }, send), false);
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(sent, [["/api/brief", { what: "Craft IPA", city: "Dayton" }]]);
});

test("two parts: their sources renumbered onto one list; a part that fails is left out (partial)", async () => {
  const m = mergeCited([
    { text: "TRADE\nUp 23%. [1] Shelves [2]", sources: [{ url: "https://a" }, { url: "https://b" }] },
    { text: "SCENE\nEast side. [1, 2]", sources: [{ url: "https://b" }, { url: "https://c" }] },
  ]);
  assert.equal(m.text, "TRADE\nUp 23%. [1] Shelves [2]\n\nSCENE\nEast side. [2, 3]");
  assert.deepEqual(m.sources.map((x) => x.url), ["https://a", "https://b", "https://c"]);
  let n = 0;
  const half = async () => (++n === 1 ? new Response(JSON.stringify(answer), { status: 200 }) : new Response("overloaded", { status: 529 }));
  const v = await buildBrief({ env: { ANTHROPIC_API_KEY: "k" }, cat: "na-beer", city: "Austin", fetchImpl: half });
  assert.equal(v.status, "ready");
  assert.equal(v.partial, true);
  assert.match(v.text, /^TRADE\n/, "the model's note before the first heading is dropped");
});
