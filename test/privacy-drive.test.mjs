// Door-notes privacy, drive mode's Log visit (privacy audit 10-24, blocker 1): what the rep says at the door goes
// through the Worker's /api/agent/log-visit to a model with the plan's names, phone numbers, emails and descriptions of
// people taken out, like every other model path. A stub Messages API records each request. Data-free.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.js";
import { _resetAgent } from "../src/agent.js";
import { logVisit } from "../public/lib/drive-log.js";
import { planNames } from "../public/lib/agent-context.js";

const realFetch = globalThis.fetch;
before(() => (globalThis.fetch = async (u) => { throw new Error(`network call attempted in a test: ${u}`); }));
after(() => (globalThis.fetch = realFetch));
beforeEach(() => _resetAgent());

const usage = { input_tokens: 500, output_tokens: 40, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
const msg = (content, stop = "end_turn") => ({ id: "msg_1", type: "message", role: "assistant", content, stop_reason: stop, usage });
const stubFetch = (answers) => {
  const seen = [];
  const f = async (url, init) => { seen.push(JSON.parse(init.body)); const a = answers.shift(); if (!a) throw new Error("stub exhausted"); return Response.json(a); };
  f.seen = seen;
  return f;
};
const STOP = { id: "00000000-0000-4000-8000-271655E6AA28", name: "The Drafting Room" };
const env = () => ({ ANTHROPIC_API_KEY: "sk-test", ANTHROPIC_FETCH: stubFetch([msg([{ type: "tool_use", id: "toolu_1", name: "log_visit", input: { door_id: "d1", result: "interested" } }], "tool_use"), msg([{ type: "text", text: "Logged." }])]) });
// the client's own call (lib/drive-log.js), with the Worker as its fetch: the body is what web and phone send
const viaWorker = (e) => (url, init) => worker.fetch(new Request(`https://doors.example${url}`, { ...init, headers: { ...init.headers, origin: "https://doors.example", "cf-connecting-ip": "203.0.113.31" } }), e);
const sent = (e) => JSON.stringify(e.ANTHROPIC_FETCH.seen.map((b) => b.messages));

test("a bare name the plan knows (Thursday's return: Tuesday's contact) never reaches the model", async () => {
  const plan = { profile: { pitch: { name: "Maya Ortiz" } }, outcomes: { [STOP.id]: { result: "followup", who: "Priya Shah" } }, slots: {} };
  const ctx = { stop: STOP, now: { date: "2026-10-29", min: 900 }, windows: [], next: [], names: planNames(plan) };
  assert.deepEqual(ctx.names.sort(), ["Maya Ortiz", "Priya Shah"]);
  const e = env();
  const r = await logVisit("Priya liked it, Maya will be back Thursday at 3", ctx, { fetch: viaWorker(e) });
  assert.ok(e.ANTHROPIC_FETCH.seen.length >= 1, JSON.stringify(r));
  assert.doesNotMatch(sent(e), /Priya|Shah|Maya|Ortiz/);
  assert.match(sent(e), /back Thursday at 3/);
});

test("a name the rep says for the first time, a phone, an email and a description of a person are taken out", async () => {
  const ctx = { stop: STOP, now: { date: "2026-10-27", min: 900 }, windows: [], next: [], names: [] };
  const e = env();
  await logVisit("Sam was keen, hesitant about price. He's maybe 60 and Catholic. Call 617-555-0142 or sam@bar.example. Wants a case.", ctx, { fetch: viaWorker(e) });
  assert.ok(e.ANTHROPIC_FETCH.seen.length >= 1);
  const s = sent(e);
  assert.doesNotMatch(s, /\bSam\b|Catholic|\b60\b|617|0142|@bar/, s.match(/\bSam\b|Catholic|\b60\b|617|0142|@bar/)?.[0]);
  assert.match(s, /hesitant about price/);
  assert.match(s, /Wants a case/);
  assert.match(s, /The Drafting Room/); // the door keeps its name
});

test("Day done polish sends the same names as the Agent and drive mode, contacts[] included", async () => {
  const { polishBody } = await import("../public/lib/day-polish.js");
  const plan = { profile: { pitch: { name: "Maya Ortiz" } }, contacts: [{ contactName: "Ravi Shah" }], outcomes: { a: { who: "Priya" } }, slots: {}, days: [], venues: {} };
  assert.deepEqual(polishBody(plan, { stops: [], day: {} }, {}).names.sort(), planNames(plan).sort());
  assert.ok(planNames(plan).includes("Ravi Shah"));
});
