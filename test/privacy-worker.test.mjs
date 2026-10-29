// Door-notes privacy through the real Worker path: a stub Messages API records every request, and nothing a note
// or a message says about a person (name, phone, email, description) is in any of them. Needs the demo data.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.js";
import { _resetAgent } from "../src/agent.js";
import { demoContext } from "./agent-fixture.mjs";

const realFetch = globalThis.fetch;
before(() => (globalThis.fetch = async (u) => { throw new Error(`network call attempted in a test: ${u}`); }));
after(() => (globalThis.fetch = realFetch));
beforeEach(() => _resetAgent());

const usage = { input_tokens: 900, output_tokens: 80, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };
const msg = (content) => ({ id: "msg_1", type: "message", role: "assistant", content, stop_reason: "end_turn", usage });
const stubFetch = (answers) => {
  const seen = [];
  const f = async (url, init) => { seen.push(JSON.parse(init.body)); const a = answers.shift(); if (!a) throw new Error("stub exhausted"); return Response.json(a); };
  f.seen = seen;
  return f;
};
const env = (answers) => ({ ANTHROPIC_API_KEY: "sk-test", ANTHROPIC_FETCH: stubFetch(answers) });
const req = (path, body) => new Request(`https://doors.example${path}`, { method: "POST", headers: { origin: "https://doors.example", "content-type": "application/json", "cf-connecting-ip": "203.0.113.21" }, body: JSON.stringify(body) });
// round 3 (agent2): the ages as the notes say them ("maybe 45", "is 60"): a door's popularity "0.60" is not an age
const PRIVATE = /Priya|Marco|\bJo\b|Catholic|\bis 60\b|617|0142|0199|@|Muslim|pregnant|\bmaybe 45\b|Korean/i;

test("Doors Agent: a door's notes and the rep's message reach the model with no name, phone, email or description", async () => {
  const { ctx } = await demoContext({ current: "first" });
  const id = ctx.day.stops[0].id;
  ctx.doors[id].notes = [
    { text: "The manager is Priya, she's maybe 45. Call 617-555-0142 or priya@bar.example.", by: "rep" },
    { text: "Owner is an older Korean guy; she's pregnant, so ask for the manager.", by: "rep" },
  ];
  const e = env([msg([{ type: "text", text: "Noted: the manager does the ordering." }])]);
  const text = "Talked to Marco, the bar manager. Jo is 60 and Catholic. He's Muslim so push the NA. His cell is 617 555 0199, email marco@pub.example. Wants a case Thursday.";
  const r = await (await worker.fetch(req("/api/agent", { v: 1, messages: [{ role: "user", text }], context: ctx }), e)).json();
  assert.equal(r.by, "anthropic", JSON.stringify(r).slice(0, 300));
  assert.ok(e.ANTHROPIC_FETCH.seen.length >= 1);
  const sent = JSON.stringify(e.ANTHROPIC_FETCH.seen.map((b) => b.messages));
  assert.doesNotMatch(sent, PRIVATE, sent.match(PRIVATE)?.[0]);
  assert.match(sent, /push the NA/);
  assert.match(sent, /Wants a case Thursday/);
  assert.match(sent, /a phone number/);
  assert.match(sent, new RegExp(ctx.doors[id].name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))); // the door keeps its name
});

test("Day done polish: a visit note's phone, email and description of a person never reach the model", async () => {
  const answer = JSON.stringify({ summary: "One door visited.", doors: [{ id: "d1", note: "Interested." }], next: [] });
  const e = env([msg([{ type: "text", text: answer }])]);
  const facts = { date: "2026-10-27", totals: { planned: 1, visited: 1, notReached: 0 }, doors: [{ id: "a", n: 1, name: "Nomadic Beerworks", status: "visited", resultLabel: "Interested", who: "Priya", note: "Priya is pregnant, call her at 617-555-0142 or priya@bar.example. Wants a case." }] };
  const r = await (await worker.fetch(req("/api/agent/debrief", { facts, profile: { brand: "Tidewell" }, names: ["Priya"] }), e)).json();
  assert.ok(e.ANTHROPIC_FETCH.seen.length === 1, JSON.stringify(r).slice(0, 300));
  const sent = JSON.stringify(e.ANTHROPIC_FETCH.seen[0].messages);
  assert.doesNotMatch(sent, PRIVATE, sent.match(PRIVATE)?.[0]);
  assert.match(sent, /Nomadic Beerworks/);
});
