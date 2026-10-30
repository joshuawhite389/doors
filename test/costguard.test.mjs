// The cost guard (src/spend.js): the day's Claude $ is one counter for the whole site, not one per isolate,
// and every Claude call adds to it (Agent turns and their searches, specialist briefs, Day done polish).
import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import { SpendBook, usdOf, worstUsd, charge, claudeRoom, settled, _resetSpend, AGENT_USD_DAILY } from "../src/spend.js";
import { anthropicSession } from "../src/llm.js";
import { CLAUDE_SPENT, DEBRIEF_SPENT, _resetAgent } from "../src/agent.js";

const realFetch = globalThis.fetch;
globalThis.fetch = async (u) => {
  throw new Error(`network call attempted in a test: ${u}`);
};
after(() => (globalThis.fetch = realFetch));
beforeEach(() => (_resetSpend(), _resetAgent()));
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-6, `${a} ≈ ${b}`);

// a Durable Object's storage, in memory
const storage = () => {
  const m = new Map();
  return { m, get: async (k) => structuredClone(m.get(k)), put: async (k, v) => void m.set(k, structuredClone(v)), delete: async (k) => m.delete(k) };
};
const add = (book, body) => book.fetch(new Request("https://spend/add", { method: "POST", body: JSON.stringify(body) })).then((r) => r.json());
const get = (book, day) => book.fetch(new Request(`https://spend/?day=${day}`)).then((r) => r.json());
// a SPEND_BOOK binding over one SpendBook (fail: the book can't be reached)
const binding = (book, { fail = false } = {}) => ({ idFromName: (n) => n, get: () => ({ fetch: async (url, init) => { if (fail) throw new Error("unreachable"); return book.fetch(new Request(url, init)); } }) });

test("the book: adds a UTC day's $ by kind, keeps it in storage, and starts each day at zero", async () => {
  const st = storage();
  const book = new SpendBook({ storage: st });
  await add(book, { day: "2026-10-24", usd: 0.25, kind: "agent" });
  await add(book, { day: "2026-10-24", usd: 0.1, kind: "brief" });
  const v = await add(book, { day: "2026-10-24", usd: 0.05, kind: "debrief" });
  near(v.usd, 0.4);
  assert.equal(v.calls, 3);
  assert.deepEqual(Object.keys(v.by).sort(), ["agent", "brief", "debrief"]);
  // a restarted object reads the day back from storage
  near((await get(new SpendBook({ storage: st }), "2026-10-24")).usd, 0.4);
  assert.equal((await get(book, "2026-10-25")).usd, 0);
  // a late add for yesterday doesn't touch today
  await add(book, { day: "2026-10-25", usd: 0.2 });
  await add(book, { day: "2026-10-24", usd: 0.01 });
  near((await get(book, "2026-10-25")).usd, 0.2);
  // three days on, the old day's value is dropped
  await add(book, { day: "2026-10-27", usd: 0.01 });
  assert.equal(st.m.has("usd:2026-10-24"), false);
});

test("the book refuses a bad day or amount", async () => {
  const book = new SpendBook({ storage: storage() });
  for (const body of [{ day: "today", usd: 1 }, { day: "2026-10-24", usd: -1 }, { day: "2026-10-24", usd: "x" }, { day: "2026-10-24", usd: 500 }]) {
    const r = await book.fetch(new Request("https://spend/add", { method: "POST", body: JSON.stringify(body) }));
    assert.equal(r.status, 400);
  }
  assert.equal((await get(book, "2026-10-24")).usd, 0);
});

test("prices: from usage, the 5× tier past 100k prompt tokens, a lost call at its most", () => {
  near(usdOf({ input_tokens: 1000, output_tokens: 1000, cache_read_input_tokens: 10_000, server_tool_use: { web_search_requests: 2 } }, "claude-haiku-5-5"), (1000 * 0.1 + 1000 * 0.5 + 10_000 * 0.01) / 1e6 + 0.02);
  near(usdOf({ input_tokens: 1000, output_tokens: 1000 }, "claude-sonnet-5-5"), 0.012);
  near(usdOf({ input_tokens: 90_000, cache_read_input_tokens: 20_000 }, "claude-haiku-5-5"), (90_000 * 0.1 + 20_000 * 0.01) * 5 / 1e6);
  near(usdOf({ input_tokens: 1000, output_tokens: 1000 }, "claude-opus-5-5"), 0.03); // round 3: Opus 5.5 ($5 / $25 per M)
  near(usdOf({ input_tokens: 1000 }, "claude-unknown"), usdOf({ input_tokens: 1000 }, "claude-opus-5-5")); // unknown: priced at the dearest
  // 4,000 characters counted as 4,000 tokens, all 2,048 output tokens, both searches
  near(worstUsd({ model: "claude-sonnet-5-5", body: "x".repeat(4000), maxTokens: 2048, searches: 2 }), (4000 * 2 + 2048 * 10) / 1e6 + 0.02);
  assert.equal(AGENT_USD_DAILY, 30); // round 3 (Jard 10-25): $30 a day, was $2
});

test("room: under the cap yes, at the cap no, an unreachable book no (and its adds are kept and sent later)", async () => {
  const book = new SpendBook({ storage: storage() });
  const env = { SPEND_BOOK: binding(book), AGENT_USD_DAILY: "0.5", TODAY: "2026-10-24" };
  assert.equal((await claudeRoom(env)).ok, true);
  charge(env, 0.3, "agent");
  assert.equal((await claudeRoom(env)).ok, true);
  charge(env, 0.3, "brief");
  const r = await claudeRoom(env);
  assert.deepEqual([r.ok, r.reason], [false, "spent"]);
  near(r.usd, 0.6);
  // the book can't be reached: no Claude call, and the add waits for the book
  const down = { ...env, SPEND_BOOK: binding(book, { fail: true }), AGENT_USD_DAILY: "5" };
  charge(down, 0.2, "agent");
  await settled();
  assert.equal((await claudeRoom(down)).reason, "unreadable");
  near((await get(book, "2026-10-24")).usd, 0.6);
  assert.equal((await claudeRoom({ ...down, SPEND_BOOK: binding(book) })).ok, true);
  near((await get(book, "2026-10-24")).usd, 0.8);
  assert.equal((await claudeRoom({ ...env, AGENT_USD_DAILY: "0" })).ok, false);
});

test("a book that never answers: room says unreadable within the time limit, and an add doesn't hold the reply", async () => {
  const hung = { idFromName: (n) => n, get: () => ({ fetch: () => new Promise(() => {}) }) };
  const env = { SPEND_BOOK: hung, AGENT_USD_DAILY: "5", TODAY: "2026-10-30", SPEND_BOOK_MS: "50" };
  let t = Date.now();
  const room = await claudeRoom(env);
  assert.equal(room.ok, false);
  assert.equal(room.reason, "unreadable");
  assert.ok(Date.now() - t < 1000, `room took ${Date.now() - t} ms`);
  charge(env, 0.01, "agent");
  charge(env, 0.02, "brief");
  t = Date.now();
  await settled();
  assert.ok(Date.now() - t < 1000, `settled took ${Date.now() - t} ms`);
  // back up: the kept adds are sent with the next read
  const book = new SpendBook(storage());
  const up = { ...env, SPEND_BOOK: binding(book) };
  assert.equal((await claudeRoom(up)).ok, true);
  near((await get(book, "2026-10-30")).usd, 0.03);
});

test("an add whose request ended never settles: later Claude calls still go ahead (live 2026-10-30)", async () => {
  // a dead add: the book never answers and its time limit never fires (Workers cancels an ended request's timers)
  const dead = { idFromName: (n) => n, get: () => ({ fetch: () => new Promise(() => {}) }) };
  charge({ SPEND_BOOK: dead, TODAY: "2026-10-30", SPEND_BOOK_MS: "1e12" }, 0.01, "agent");
  const book = new SpendBook(storage());
  const env = { SPEND_BOOK: binding(book), AGENT_USD_DAILY: "5", TODAY: "2026-10-30", SPEND_SETTLE_MS: "50" };
  const t = Date.now();
  assert.equal((await claudeRoom(env)).ok, true);
  assert.ok(Date.now() - t < 1000, `room took ${Date.now() - t} ms`);
  const t2 = Date.now();
  await settled(50);
  assert.ok(Date.now() - t2 < 1000, `settled took ${Date.now() - t2} ms`);
});

test("an Anthropic call that times out is still counted, at its most", async () => {
  const lost = [];
  const sess = anthropicSession({ apiKey: "k", model: "claude-haiku-5-5", maxTokens: 1000, serverTools: [{ type: "web_search_20250305", name: "web_search", max_uses: 2 }], fetchImpl: async () => { throw Object.assign(new Error("timed out"), { name: "TimeoutError" }); }, onLost: (x) => lost.push(x) })({ system: "s", user: "u", tools: [] });
  await assert.rejects(sess.step());
  assert.equal(lost.length, 1);
  assert.equal(lost[0].searches, 2);
  assert.ok(worstUsd(lost[0]) >= 0.02 + (1000 * 0.5) / 1e6);
});

// ---------- two isolates, one book ----------
// Each worker thread loads the Worker afresh (its own module state, like an isolate); both reach the one SpendBook here.
function isolate(name, ip, book) {
  const w = new Worker(new URL("./costguard-isolate.mjs", import.meta.url), { workerData: { name, ip } });
  const calls = new Map();
  let id = 0;
  const ready = new Promise((resolve, reject) => {
    w.on("error", reject);
    w.on("message", async (m) => {
      if (m.ready) return resolve();
      if (m.rpc) {
        const res = await book.fetch(new Request(m.url, { method: m.method, ...(m.body ? { body: m.body } : {}) }));
        return w.postMessage({ rpc: m.rpc, status: res.status, text: await res.text() });
      }
      const c = calls.get(m.id);
      calls.delete(m.id);
      m.error ? c.reject(new Error(m.error)) : c.resolve(m.out);
    });
  });
  const run = async (cmd) => {
    await ready;
    return new Promise((resolve, reject) => {
      calls.set(++id, { resolve, reject });
      w.postMessage({ id, cmd });
    });
  };
  return { run, stop: () => w.terminate() };
}

test("two isolates share the day's cap: each turn adds to one book, and the second isolate stops when the site's day is spent", async () => {
  const book = new SpendBook({ storage: storage() });
  const a = isolate("a", 11, book);
  const b = isolate("b", 12, book);
  try {
    // each Claude answer is ~$0.30; the cap is $1
    assert.equal((await a.run("turn")).by, "anthropic");
    assert.equal((await a.run("turn")).by, "anthropic");
    assert.equal((await b.run("turn")).by, "anthropic");
    assert.equal((await b.run("turn")).by, "anthropic"); // starts at $0.90: under the cap
    near((await get(book, "2026-10-24")).usd, 4 * usdOf({ input_tokens: 1000, output_tokens: 600_000 }, "claude-haiku-5-5"));
    // isolate a spent only $0.60 itself; per isolate it would call Claude again. The site's day is $1.20: no.
    const r = await a.run("turn");
    assert.notEqual(r.by, "anthropic"); // Doors' rules answer this one (a coaching question), else the free chain
    assert.equal(r.notice, CLAUDE_SPENT);
    // Day done polish and a brief stop too, in either isolate
    const d = await b.run("debrief");
    assert.deepEqual([d.polished, d.message], [false, DEBRIEF_SPENT]);
    assert.deepEqual(await a.run("brief"), { status: "none", reason: "spent" });
    assert.equal((await get(book, "2026-10-24")).calls, 4);
  } finally {
    await Promise.all([a.stop(), b.stop()]);
  }
});

test("every Claude call counts against the one day: Day done polish and a specialist brief in one isolate, Agent turns in the other", async () => {
  const book = new SpendBook({ storage: storage() });
  const a = isolate("a", 21, book);
  const b = isolate("b", 22, book);
  try {
    assert.equal((await a.run("debrief")).polished, true); // $0.30
    await b.run("brief"); // two parts, $0.60 (too thin to keep, still paid for)
    assert.equal((await a.run("turn")).by, "anthropic"); // starts at $0.90
    const r = await b.run("turn");
    assert.notEqual(r.by, "anthropic");
    assert.equal(r.notice, CLAUDE_SPENT);
    const v = await get(book, "2026-10-24");
    const one = usdOf({ input_tokens: 1000, output_tokens: 600_000 }, "claude-haiku-5-5");
    near(v.by.debrief, one);
    near(v.by.brief, 2 * one);
    near(v.by.agent, one);
  } finally {
    await Promise.all([a.stop(), b.stop()]);
  }
});

test("the day spent: the free chain answers with the notice, no error; the reply names the free model", async () => {
  const { default: worker } = await import("../src/worker.js");
  const { demoContext } = await import("./agent-fixture.mjs");
  const { ctx } = await demoContext({ current: "first" });
  let claudeCalls = 0;
  const env = { ANTHROPIC_API_KEY: "k", ANTHROPIC_FETCH: async () => (claudeCalls++, new Response("{}", { status: 500 })), AGENT_USD_DAILY: "0.5", TODAY: "2026-10-24", AI: { run: async () => ({ response: "Bring two cans to sample." }) }, WORKERS_AI_MODELS: "70b" };
  charge(env, 0.6, "agent");
  await settled();
  const res = await worker.fetch(new Request("https://doors.example/api/agent", { method: "POST", headers: { origin: "https://doors.example", "content-type": "application/json" }, body: JSON.stringify({ v: 1, messages: [{ role: "user", text: "should I bring a cooler bag?" }], context: ctx }) }), env);
  assert.equal(res.status, 200);
  const r = await res.json();
  assert.equal(r.by, "workers-ai");
  assert.equal(r.notice, CLAUDE_SPENT);
  assert.equal(r.resting, undefined);
  assert.equal(claudeCalls, 0);
  const { answeredBy } = await import("../public/ui/agent.js"); // the panel's footer line
  // ease audit 2 #10a: the footer says when Claude is back in the device's own time, not UTC
  const { inLocalTime } = await import("../public/lib/agent-ui.js");
  assert.equal(answeredBy(r), inLocalTime(`This answer: ${r.model}. ${CLAUDE_SPENT}`));
  assert.doesNotMatch(answeredBy(r), /UTC/);
  assert.match(answeredBy(r), /back at (midnight|\d{1,2}(:\d\d)? [ap]m)\.$/);
});
