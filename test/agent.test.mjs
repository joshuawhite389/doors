// R9 chat agent (docs/CONTRACTS-R9.md): tool schemas, code validation of every model call, the rules path, the caps,
// the resting fallback, redaction, and a scripted conversation through the Worker with a stub model. No network.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.js";
import { _resetAgent, AGENT_WINDOW, cleanContext, promptOf, SYSTEM, GEMINI_CHAIN } from "../src/agent.js";
import { TOOLS, runTool, talkLineOk, applyTalkEdits } from "../public/lib/agent-tools.js";
import { answerByRules } from "../public/lib/agent-rules.js";
import { validateRecord, AGENT_WRITABLE, makeRecord } from "../public/lib/slots.js";
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

const { ctx, plan } = await demoContext({ current: "first" });
const FIRST = ctx.day.stops[0].id;
const SECOND = ctx.day.stops[1].id;
const firstName = ctx.doors[FIRST].name;
const now = `${ctx.today}T${ctx.now}`;
const ORIGIN = "https://doors.example";

// a KV that counts writes (the agent must make none)
const kv = () => {
  const m = new Map();
  const k = { puts: 0, get: async (key) => (m.has(key) ? JSON.parse(m.get(key)) : null), put: async (key, v) => (k.puts++, m.set(key, v)), list: async () => ({ keys: [], list_complete: true }) };
  return k;
};
const post = (path, body, { origin = ORIGIN, type = "application/json", ip = "203.0.113.7", raw } = {}) =>
  new Request(`${ORIGIN}${path}`, { method: "POST", headers: { ...(origin ? { origin } : {}), "content-type": type, "cf-connecting-ip": ip }, body: raw ?? JSON.stringify(body) });
const ask = async (env, text, { messages = [], context = ctx, ip } = {}) => (await worker.fetch(post("/api/agent", { v: 1, messages: [...messages, { role: "user", text }], context }, { ip }), env)).json();
// a stub model: a scripted list of steps; `seen` records the prompts it was given
const stub = (steps, seen = []) => (opts) => {
  seen.push(opts);
  return scriptedSession(steps)(opts);
};

// ---------- tool schemas ----------
test("every tool has a name, a description and an object schema whose required args are declared", () => {
  assert.deepEqual(TOOLS.map((t) => t.name), ["explain_door", "compare_doors", "ask_city", "replan", "edit_talking_points", "log_visit", "save_note", "brief_door", "prep_day", "draft_follow_up", "what_to_bring", "next_trip", "remember"]);
  for (const t of TOOLS) {
    assert.ok(t.description.length > 20, t.name);
    assert.equal(t.parameters.type, "object");
    for (const r of t.parameters.required ?? []) assert.ok(t.parameters.properties[r], `${t.name}.${r}`);
  }
});
test("the system prompt is no persona: no 'act like', 'you are a', no group", () => {
  assert.doesNotMatch(SYSTEM, /act (like|as)|you are an? |pretend|as an? (local|bartender|bar manager|expert)/i);
});

// ---------- code validates every call ----------
test("a door id not on the plan is refused; nothing is applied", () => {
  for (const [name, args] of [["explain_door", { door_id: "nope" }], ["log_visit", { door_id: "nope", result: "no" }], ["replan", { skip: ["nope"] }], ["edit_talking_points", { door_id: "nope", section: "opener", op: "replace", text: "Hello there" }]]) {
    const r = runTool(name, args, ctx);
    assert.equal(r.ok, false, name);
    assert.equal(r.actions, undefined, name);
  }
});
test("log_visit: dates must be real and after today; a followup needs a date; result from RESULTS", () => {
  assert.equal(runTool("log_visit", { door_id: FIRST, result: "followup" }, ctx).ok, false);
  assert.equal(runTool("log_visit", { door_id: FIRST, result: "followup", follow_up_date: ctx.today }, ctx).ok, false);
  assert.equal(runTool("log_visit", { door_id: FIRST, result: "followup", follow_up_date: "2026-02-30" }, ctx).ok, false);
  assert.equal(runTool("log_visit", { door_id: FIRST, result: "maybe" }, ctx).ok, false);
  assert.equal(runTool("log_visit", { door_id: FIRST, result: "interested", follow_up_time: "15:00" }, ctx).ok, false, "a time needs a date");
  const r = runTool("log_visit", { door_id: FIRST, result: "followup", follow_up_date: "2026-10-29", follow_up_time: "15:00", note: "hesitant about price" }, ctx, { now });
  assert.equal(r.ok, true);
  assert.deepEqual(r.actions.slice(0, 2).map((a) => a.type), ["status", "outcome"]);
  assert.equal(r.result.visit.outcome.followUpTime, "15:00");
  const obj = r.actions.find((a) => a.type === "slot" && a.record.field === "objection");
  assert.deepEqual(obj.record.value, { kind: "price", words: "hesitant about price" });
  assert.equal(obj.record.source, "stated");
  assert.equal(obj.record.confirmed, false);
});
test("log_visit: the judge: a day the rep named beats the model's date for it", () => {
  // the model read "Thu" as tomorrow; the rules parser reads it as the next Thursday after today
  const r = runTool("log_visit", { door_id: FIRST, result: "followup", follow_up_date: "2026-10-28" }, ctx, { words: "back Thu", now });
  assert.equal(r.result.visit.outcome.followUp, "2026-10-29");
});
test("edit_talking_points: a model line claiming stock, a trend or an artist name is refused; the rep's own words are kept", () => {
  const artist = ctx.cityData.citySound[0];
  assert.equal(talkLineOk("They pour a lot of NA beer already.", {}).ok, false);
  assert.equal(talkLineOk("NA is trending this week.", {}).ok, false);
  assert.equal(talkLineOk(`Your regulars love ${artist}.`, { avoid: ctx.cityData.citySound }).ok, false);
  assert.equal(runTool("edit_talking_points", { door_id: FIRST, section: "opener", op: "replace", text: "They stock NA beer, right?" }, ctx).ok, false);
  const mine = runTool("edit_talking_points", { door_id: FIRST, section: "opener", op: "replace", text: "They stock NA beer, right?", dictated: true }, ctx);
  assert.equal(mine.ok, true);
  assert.equal(mine.actions[0].by, "rep");
  assert.equal(runTool("edit_talking_points", { door_id: FIRST, section: "questions", op: "replace", index: 99, text: "What sells on a Tuesday?" }, ctx).ok, false);
  assert.equal(runTool("edit_talking_points", { door_id: FIRST, section: "opener", op: "remove" }, ctx).ok, false);
  const add = runTool("edit_talking_points", { door_id: FIRST, section: "questions", op: "add", text: "What sells on a quiet Tuesday?" }, ctx);
  assert.equal(add.actions[0].index, ctx.doors[FIRST].talk.questions.length);
});
test("remember: only AGENT_WRITABLE fields; corrected only on an explicit correction; never a person's traits", () => {
  assert.equal(runTool("remember", { field: "age", value: "older", door_id: FIRST }, ctx, { words: "the owner is older" }).ok, false);
  assert.equal(runTool("remember", { field: "mood", value: "grumpy", door_id: FIRST }, ctx).ok, false);
  assert.equal(runTool("remember", { field: "venueType", value: "bar", door_id: FIRST }, ctx, { words: "nice place" }).ok, false, "not asked as a correction");
  const c = runTool("remember", { field: "venueType", value: "bar", door_id: FIRST, correction: true }, ctx, { words: "no, it's a cocktail bar, not a brewery" });
  assert.equal(c.ok, true);
  assert.equal(c.actions[0].record.source, "corrected");
  const s = runTool("remember", { field: "contact", value: { name: "Sam", role: "bar manager" }, door_id: FIRST }, ctx, { words: "the bar manager is Sam" });
  assert.equal(s.actions[0].record.source, "stated");
  assert.equal(validateRecord(makeRecord({ slot: "S4", field: "contact", value: { name: "Sam", role: "aunt" }, source: "stated" }), { agent: true }).ok, false);
  assert.equal(runTool("remember", { field: "rule.term", value: { from: "NA", to: "alcohol-free" }, correction: true }, ctx, { words: "call it alcohol-free, not NA" }).actions[0].id, "*");
  assert.ok(!Object.keys(AGENT_WRITABLE).some((f) => /age|origin|mood|trait|ethnic|gender/i.test(f)));
});
test("replan: times, caps and days are checked", () => {
  assert.equal(runTool("replan", {}, ctx).ok, false);
  assert.equal(runTool("replan", { end_by: "5pm" }, ctx).ok, false);
  assert.equal(runTool("replan", { max_doors: 40 }, ctx).ok, false);
  assert.equal(runTool("replan", { day: "2030-01-01" }, ctx).ok, false);
  const r = runTool("replan", { skip: [SECOND], end_by: "17:00" }, ctx);
  assert.deepEqual(r.actions[0], { type: "replan", skip: [SECOND], endBy: "17:00", startNow: false, maxDoors: null, lock: [], add: [], day: null });
});

// ---------- facts carry sources ----------
test("explain_door: every fact has a source; Qloo's crowd text is quoted verbatim with its capture date", () => {
  const r = runTool("explain_door", { door_id: FIRST }, ctx);
  assert.ok(r.facts.length >= 4);
  for (const f of r.facts) assert.ok(f.source?.kind && f.source.label, f.text);
  const crowd = r.facts.find((f) => f.source.field === "crowd");
  assert.equal(crowd.text, `"${plan.venues[FIRST].crowd}"`);
  assert.equal(crowd.source.captured, "2026-10-08");
  assert.equal(r.facts.find((f) => f.source.field === "order").source.kind, "plan");
});
test("ask_city with no data says so instead of guessing", () => {
  const r = runTool("ask_city", { topic: "neighbourhoods" }, { ...ctx, cityData: { ...ctx.cityData, nbhd: {} } });
  assert.equal(r.facts.length, 0);
  assert.match(r.data.answer, /says nothing/);
});

// ---------- the rules path (resting, the demo, offline) ----------
test("rules: 'why is X first' → the route's reason and Qloo's rank, sourced", () => {
  const r = answerByRules([{ role: "user", text: `why is ${firstName} first?` }], ctx, { now });
  assert.equal(r.by, "rules");
  assert.match(r.reply, /Stop 1 of/);
  assert.match(r.reply, /#\d+ of \d+ on Your list, Qloo.s ranking/); // gigbot 10-24: one rank, Your list
  assert.ok(r.facts.every((f) => f.source));
});
test("rules: 'make my opener shorter' → one talk action, the opener's question alone", () => {
  const r = answerByRules([{ role: "user", text: "make my opener shorter" }], ctx, { now });
  assert.equal(r.actions.length, 1);
  assert.equal(r.actions[0].type, "talk");
  assert.equal(r.actions[0].section, "opener");
  assert.ok(r.actions[0].text.length < ctx.doors[FIRST].talk.opener.length || r.actions[0].text === ctx.doors[FIRST].talk.opener);
  assert.match(r.actions[0].text, /\?$/);
});
test("a shorter opener keeps who is talking and who buys (Jard 10-24 #5: no crowd line to keep)", async () => {
  const { ctx: c } = await demoContext({ current: "00000000-0000-4000-8000-271655E6AA28" });
  const was = c.doors[c.current].talk.opener;
  assert.match(was, /^(Hi|Hey), I'm Maya with Tidewell, a non-alcoholic hazy IPA\. Who does the beer buying here\? Mind if I grab their name/);
  const r = answerByRules([{ role: "user", text: "Make the opener for Nomadic Beerworks shorter" }], c, { now });
  const a = r.actions.find((x) => x.type === "talk");
  assert.notEqual(a.from, "qloo");
  assert.match(a.text, /^(Hi|Hey), I'm Maya with Tidewell\. Who does the beer buying here\?$/);
  assert.ok(a.text.split(" ").length < was.split(" ").length * 0.7, a.text);
  assert.doesNotMatch(r.reply, /crowd line/);
});
test("rules: a visit said in free text → status, outcome (follow-up Thu 3 pm), visit memory, the next door", () => {
  const r = answerByRules([{ role: "user", text: "done, back Thu 3pm, liked it, hesitant about price" }], ctx, { now });
  const o = r.actions.find((a) => a.type === "outcome").outcome;
  assert.equal(o.followUp, "2026-10-29");
  assert.equal(o.followUpTime, "15:00");
  assert.equal(o.note, "liked it, hesitant about price");
  assert.ok(r.actions.some((a) => a.type === "slot" && a.record.field === "objection"));
  assert.match(r.reply, new RegExp(`Next: ${ctx.doors[SECOND].name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
});
test("rules: what's next, skip, finish by, the city's sound", () => {
  assert.equal(answerByRules([{ role: "user", text: "what's next?" }], ctx).actions[0].id, SECOND);
  assert.deepEqual(answerByRules([{ role: "user", text: "skip this one" }], ctx).actions[0].skip, [FIRST]);
  assert.equal(answerByRules([{ role: "user", text: "I need to finish by 5pm" }], ctx).actions[0].endBy, "17:00");
  // a re-plan, not a visit ("done by"): both asks in one replan
  const both = answerByRules([{ role: "user", text: "I have to be done by 4:30 today, and skip the next one" }], ctx);
  assert.deepEqual(both.actions, [{ type: "replan", skip: [SECOND], endBy: "16:30", startNow: false, maxDoors: null, lock: [], add: [], day: null }]);
  assert.match(answerByRules([{ role: "user", text: "what music does Austin like?" }], ctx).reply, /Artists Qloo associates with Austin/);
});

// ---------- the Worker: guards ----------
test("/api/agent: POST + JSON + Origin; size; body shape", async () => {
  const env = {};
  assert.equal((await worker.fetch(new Request(`${ORIGIN}/api/agent`), env)).status, 405);
  assert.equal((await worker.fetch(post("/api/agent", {}, { type: "text/plain" }), env)).status, 415);
  assert.equal((await worker.fetch(post("/api/agent", {}, { origin: null }), env)).status, 403);
  assert.equal((await worker.fetch(post("/api/agent", {}, { origin: "https://evil.example" }), env)).status, 403);
  assert.equal((await worker.fetch(post("/api/agent", null, { raw: "x".repeat(200000) }), env)).status, 413); // round 3: the cap is 192 KB
  assert.equal((await worker.fetch(post("/api/agent", { messages: [{ role: "agent", text: "hi" }] }), env)).status, 400);
});
test("/api/agent with no model is resting, still answers by rules, writes no KV", async () => {
  const env = { DOORS_KV: kv() };
  const r = await ask(env, "done, back Thu 3pm, liked it, hesitant about price");
  assert.equal(r.resting, true);
  assert.equal(r.by, "rules");
  assert.ok(r.actions.some((a) => a.type === "outcome"));
  assert.equal(env.DOORS_KV.puts, 0);
  const h = await (await worker.fetch(new Request(`${ORIGIN}/api/health`), env)).json();
  assert.deepEqual(h.agent, { ok: false, model: "none" });
});
test("caps: AGENT_WINDOW turns per 10 minutes, AGENT_DAILY a day, then the rules answer labelled resting", async () => {
  const env = { AGENT_SESSION: stub(Array(100).fill({ text: "ok" })), AGENT_DAILY: 3 };
  for (let i = 0; i < 3; i++) assert.equal((await ask(env, "hello", { ip: "198.51.100.1" })).by, "stub");
  const r = await ask(env, `why is ${firstName} first?`, { ip: "198.51.100.1" });
  assert.equal(r.resting, true);
  assert.equal(r.reason, "daily");
  assert.match(r.reply, /Stop 1 of/);
  assert.equal((await ask(env, "hello", { ip: "198.51.100.2" })).by, "stub", "another visitor is not limited");
  const env2 = { AGENT_SESSION: stub(Array(100).fill({ text: "ok" })) };
  for (let i = 0; i < AGENT_WINDOW; i++) await ask(env2, "hello", { ip: "198.51.100.3" });
  assert.equal((await ask(env2, "hello", { ip: "198.51.100.3" })).reason, "busy");
});
test("the site's model calls a day: past AGENT_MODEL_DAILY the agent rests", async () => {
  const env = { AGENT_SESSION: stub(Array(10).fill({ text: "ok" })), AGENT_MODEL_DAILY: 2 };
  assert.equal((await ask(env, "a", { ip: "1.1.1.1" })).by, "stub");
  assert.equal((await ask(env, "b", { ip: "1.1.1.2" })).by, "stub");
  const r = await ask(env, "c", { ip: "1.1.1.3" });
  assert.equal(r.resting, true);
  assert.equal(r.by, "rules");
});
test("a model that fails falls back to the next, then to rules", async () => {
  const env = { AGENT_SESSION: () => ({ step: async () => { throw new Error("Gemini 429"); }, addResults() {} }) };
  const r = await ask(env, "what's next?");
  assert.equal(r.resting, true);
  assert.equal(r.actions[0].type, "open");
});

// ---------- the Worker: a scripted conversation with a stub model ----------
test("a conversation: explain → edit (a bad line refused, then fixed) → log a visit; only validated actions reach the client", async () => {
  const seen = [];
  const steps = [
    // turn 1: explain the first door
    { calls: [{ id: "1", name: "explain_door", args: { door_id: FIRST } }] },
    (results) => ({ text: `It's first because of driving time; Qloo ranks it #${ctx.doors[FIRST].rank}.` }),
    // turn 2: a line with a banned word (refused), then a clean one
    { calls: [{ id: "2", name: "edit_talking_points", args: { door_id: FIRST, section: "opener", op: "replace", text: "Looks like you stock NA already." } }] },
    { calls: [{ id: "3", name: "edit_talking_points", args: { door_id: FIRST, section: "opener", op: "replace", text: "What do your regulars order when they skip a beer?" } }] },
    { text: "Shortened it." },
    // turn 3: log a visit, plus a call with a door that isn't on the plan
    { calls: [{ id: "4", name: "log_visit", args: { door_id: FIRST, result: "interested", follow_up_date: "2026-10-29", follow_up_time: "15:00", note: "liked it, hesitant about price" } }, { id: "5", name: "replan", args: { skip: ["not-a-door"] } }] },
    { text: "Logged it. Next is the second stop." },
  ];
  const session = scriptedSession(steps)();
  const env = { AGENT_SESSION: (opts) => (seen.push(opts), session) };
  const t1 = await ask(env, `why is ${firstName} first?`);
  assert.equal(t1.by, "stub");
  assert.ok(t1.facts.length >= 4 && t1.facts.every((f) => f.source));
  assert.deepEqual(t1.actions, []);
  const t2 = await ask(env, "make the opener shorter", { messages: [{ role: "user", text: "why?" }, { role: "agent", text: t1.reply }] });
  assert.deepEqual(t2.tools, [{ name: "edit_talking_points", ok: false }, { name: "edit_talking_points", ok: true }]);
  assert.equal(t2.actions.length, 1);
  assert.equal(t2.actions[0].text, "What do your regulars order when they skip a beer?");
  assert.equal(t2.actions[0].by, "model");
  const t3 = await ask(env, "done, back Thu 3pm, liked it, hesitant about price");
  assert.deepEqual(t3.tools.map((t) => t.ok), [true, false]);
  assert.ok(!t3.actions.some((a) => a.type === "replan"), "the invalid call was never applied");
  assert.equal(t3.actions.find((a) => a.type === "outcome").outcome.followUp, "2026-10-29");
  assert.equal(t3.reply, "Logged it. Next is the second stop.");
});
test("contact names never reach the model: redacted to 'the contact'", async () => {
  const c = cleanContext({ ...ctx, doors: { ...ctx.doors, [FIRST]: { ...ctx.doors[FIRST], outcome: { result: "someone", who: "Dana Whitfield" } } } });
  const p = promptOf([{ role: "user", text: "what did Dana Whitfield say at the last stop?" }], c, ["Dana Whitfield"]);
  assert.doesNotMatch(p, /Dana/);
  const seen = [];
  const env = { AGENT_SESSION: stub([{ text: "ok" }], seen) };
  await (await worker.fetch(post("/api/agent", { messages: [{ role: "user", text: "Dana Whitfield liked it" }], context: { ...ctx, doors: { ...ctx.doors, [FIRST]: { ...ctx.doors[FIRST], outcome: { result: "someone", who: "Dana Whitfield" } } } } }), env)).json();
  assert.doesNotMatch(seen[0].user, /Dana/);
});
test("a reply naming an artist Doors never names is dropped for the facts", async () => {
  const artist = ctx.cityData.citySound[0];
  const env = { AGENT_SESSION: stub([{ calls: [{ id: "1", name: "explain_door", args: { door_id: FIRST } }] }, { text: `Fans of ${artist} go there.` }]) };
  const r = await ask(env, "tell me about this one");
  assert.ok(!r.reply.includes(artist));
});
test("Gemini is called with the key in a header (never the URL), tools declared; a 429 rests", async () => {
  const calls = [];
  const env = { GEMINI_API_KEY: "test-key", GEMINI_FETCH: async (url, init) => (calls.push({ url, init }), new Response("quota", { status: 429 })) };
  const r = await ask(env, "what's next?");
  assert.equal(calls.length, GEMINI_CHAIN.length, "each free model in the chain is tried once (their quotas are separate)");
  assert.doesNotMatch(calls[0].url, /test-key/);
  assert.equal(calls[0].init.headers["x-goog-api-key"], "test-key");
  assert.equal(JSON.parse(calls[0].init.body).tools[0].functionDeclarations.length, TOOLS.length);
  assert.equal(r.resting, true);
  assert.equal(r.modelError, GEMINI_CHAIN.map((m) => `${m}:429`).join(","));
});

// ---------- /api/agent/log-visit ----------
const visit = (text, extra = {}) => ({ v: 1, text, stop: { id: FIRST, name: firstName, date: ctx.today }, now: { date: ctx.today, min: 860 }, windows: ctx.windows.map((w) => w.date), next: [{ id: SECOND, name: ctx.doors[SECOND].name }], ...extra });
test("log-visit with no model: the rules reading, §3.1 shape", async () => {
  const r = await (await worker.fetch(post("/api/agent/log-visit", visit("done, back Thu 3pm, liked it, hesitant about price")), {})).json();
  assert.equal(r.ok, true);
  assert.equal(r.source, "rules");
  assert.deepEqual(r.visit.outcome, { result: "interested", followUp: "2026-10-29", note: "liked it, hesitant about price", at: `${ctx.today}T14:20`, followUpTime: "15:00" });
  assert.equal(r.visit.status, "visited");
  assert.deepEqual(r.next, { id: SECOND, name: ctx.doors[SECOND].name });
  assert.ok(r.memory.length >= 2);
  assert.match(r.say, /^Logged /);
});
test("log-visit with a model: its call is validated and judged (a misread day is corrected)", async () => {
  const env = { AGENT_SESSION: stub([{ calls: [{ id: "1", name: "log_visit", args: { door_id: FIRST, result: "followup", follow_up_date: "2026-10-28", follow_up_time: "15:00", note: "hesitant about price" } }] }, { text: "ok" }]) };
  const r = await (await worker.fetch(post("/api/agent/log-visit", visit("come back Thu at 3, hesitant about price")), env)).json();
  assert.equal(r.source, "model");
  assert.equal(r.visit.outcome.followUp, "2026-10-29");
  assert.equal(r.visit.outcome.followUpTime, "15:00");
});
test("log-visit: a model that logs nothing valid → the rules reading; unreadable text → a question to ask", async () => {
  const env = { AGENT_SESSION: stub([{ calls: [{ id: "1", name: "log_visit", args: { door_id: "other", result: "no" } }] }, { text: "ok" }]) };
  const r = await (await worker.fetch(post("/api/agent/log-visit", visit("not interested, too expensive")), env)).json();
  assert.equal(r.source, "rules");
  assert.equal(r.visit.outcome.result, "no");
  const q = await (await worker.fetch(post("/api/agent/log-visit", visit("hmm")), {})).json();
  assert.equal(q.ok, false);
  assert.ok(q.ask);
});
test("log-visit: bad body 400; over the visitor's day {resting, message}", async () => {
  assert.equal((await worker.fetch(post("/api/agent/log-visit", { text: "done" }), {})).status, 400);
  const env = { AGENT_DAILY: 1 };
  await worker.fetch(post("/api/agent/log-visit", visit("liked it"), { ip: "192.0.2.9" }), env);
  const r = await (await worker.fetch(post("/api/agent/log-visit", visit("liked it"), { ip: "192.0.2.9" }), env)).json();
  assert.equal(r.resting, true);
  assert.ok(r.message);
});

// ---------- Q2: names never reach the model; the panel says so ----------
test("Q2: the rep's name and every contact's are redacted from the prompt and the tool results", async () => {
  const seen = [];
  const doors = { ...ctx.doors, [FIRST]: { ...ctx.doors[FIRST], outcome: { result: "someone", who: "Dana Whitfield" } } };
  const envelopes = { ...ctx.envelopes, [FIRST]: { ...ctx.envelopes[FIRST], slots: [{ field: "said", value: "Dana Whitfield wants a call from Robin Okafor", source: "stated" }] } };
  const context = { ...ctx, doors, envelopes, names: ["Robin Okafor", "Dana Whitfield"] };
  const session = scriptedSession([{ calls: [{ id: "1", name: "explain_door", args: { door_id: FIRST } }] }, { text: "ok" }])();
  const env = { AGENT_SESSION: (opts) => (seen.push(opts), { ...session, addResults: (r) => (seen.push(r), session.addResults(r)) }) };
  await (await worker.fetch(post("/api/agent", { messages: [{ role: "user", text: "Robin Okafor here: what did Dana Whitfield say?" }], context }), env)).json();
  const sent = JSON.stringify(seen);
  assert.doesNotMatch(sent, /Robin|Okafor|Dana|Whitfield/);
  assert.match(sent, /the contact/);
});
test("Q2: agentContext carries the rep's name for redaction (profile.pitch.name)", () => {
  assert.ok(ctx.names.includes(plan.profile.pitch.name), JSON.stringify(ctx.names));
});
test("Q2: the Ask Doors panel shows the notice verbatim", async () => {
  const src = (await import("node:fs")).readFileSync(new URL("../public/ui/agent.js", import.meta.url), "utf8");
  assert.match(src, /export const MODEL_NOTICE = "Your messages go to Anthropic's Claude, or to Workers AI or Google Gemini when Claude can't answer, with names removed first; voice goes to Cloudflare\.";/);
  // Jard web review 10-24 #7: the panel's footer is the Privacy link (the notice is kept in the markup, hidden); the
  // privacy page names who gets the messages and that names are removed first
  assert.match(src, /<span class="afoot-t" hidden>\$\{esc\(footText\(\)\)\}<\/span><a href="\/privacy" target="_blank"/);
  const priv = (await import("node:fs")).readFileSync(new URL("../public/privacy.html", import.meta.url), "utf8");
  for (const w of [/Anthropic/, /Workers AI/, /Gemini/, /removed/]) assert.match(priv, w);
});

// ---------- the Gemini chain ----------
test("an overloaded Gemini model hands the turn to the next in the chain, and cools down for the next turn", async () => {
  const asked = [];
  const ok = (text) => new Response(JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text }] } }] }), { status: 200 });
  const env = { GEMINI_API_KEY: "k", GEMINI_MODELS: "m-busy,m-ok", GEMINI_FETCH: async (url) => (asked.push(url.match(/models\/([^:]+)/)[1]), url.includes("m-busy") ? new Response("busy", { status: 503 }) : ok("Next is the second stop.")) };
  const r = await ask(env, "what's next?");
  assert.equal(r.by, "gemini");
  assert.equal(r.reply, "Next is the second stop.");
  assert.deepEqual(asked, ["m-busy", "m-ok"]);
  asked.length = 0;
  await ask(env, "and after that?");
  assert.deepEqual(asked, ["m-ok"], "the busy model waits its cooldown out");
});

// ---------- talk edits reach the stop (stopModel), not its drafted note ----------
test("a talk action shows in the stop's talking points; the drafted note keeps its own lines", async () => {
  const { stopModel } = await import("../public/lib/stopmodel.js");
  const { applyTalkEdits } = await import("../public/lib/agent-tools.js");
  const before = stopModel({ plan, id: FIRST, dayIndex: 0 });
  const edited = { ...plan, talkEdits: { [FIRST]: [{ section: "opener", op: "replace", index: 0, text: "What do your regulars order when they skip a beer?", by: "model" }, { section: "questions", op: "add", text: "What sells on a quiet Tuesday?", by: "rep" }] } };
  const after = stopModel({ plan: edited, id: FIRST, dayIndex: 0 });
  assert.equal(after.talk.opener, "What do your regulars order when they skip a beer?");
  assert.equal(after.talk.questions.at(-1), "What sells on a quiet Tuesday?");
  assert.deepEqual(after.talk.edited, { opener: "model", questions: "rep" });
  assert.equal(after.note.body, before.note.body);
  assert.equal(applyTalkEdits(before.talk, [{ section: "questions", op: "remove", index: 99 }]).questions.length, before.talk.questions.length);
});

test("judge pass 3 (N4): a door's own first word names it; 'never say X' and 'say X, not Y' are Your rules", () => {
  const { ctx: c } = { ctx };
  const r = answerByRules([{ role: "user", text: "compare Nomadic and Pinthouse" }], c, { now });
  assert.match(r.reply, /^Nomadic Beerworks: #1 of 55.*Pinthouse Brewing: #2 of 55/);
  const avoid = answerByRules([{ role: "user", text: "never say kombucha" }], c, { now });
  assert.deepEqual(avoid.actions.map((a) => [a.type, a.id, a.record.field, a.record.value]), [["slot", "*", "rule.avoid", "kombucha"]]);
  assert.match(avoid.reply, /Your rules/);
  const term = answerByRules([{ role: "user", text: "say sparkling tea, not kombucha" }], c, { now });
  assert.deepEqual(term.actions[0].record.value, { from: "kombucha", to: "sparkling tea" });
  assert.deepEqual(answerByRules([{ role: "user", text: "don't say NA, say alcohol-free" }], c, { now }).actions[0].record.value, { from: "NA", to: "alcohol-free" });
});

test("judge pass 3 (N7): the city's crowd leads with who the best rooms draw, summed, and never cuts mid-word", () => {
  const r = answerByRules([{ role: "user", text: "What crowd does Qloo see in this city?" }], ctx, { now });
  assert.match(r.reply, /^Across your 10 best-ranked doors, Qloo's crowd notes name local residents \(\d+\)/);
  for (const f of r.facts) assert.match(f.text, /[.!?…]"?$/, f.text);
});
