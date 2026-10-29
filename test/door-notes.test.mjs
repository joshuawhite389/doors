// Door notes (Jard's iPhone test, 2026-10-23: "a notes section for the user that the agent can log things to, not
// restrictive"): lib/door-notes.js, the agent's save_note tool, the rules path, the model path's net, the context the
// agent reads. No network.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.js";
import { _resetAgent, cleanContext, promptOf, SYSTEM } from "../src/agent.js";
import { makeNote, notesOf, noteOp, whoWrote, worthNoting, hasNote, visitNote, notesForAgent } from "../public/lib/door-notes.js";
import { runTool, TOOLS } from "../public/lib/agent-tools.js";
import { answerByRules } from "../public/lib/agent-rules.js";
import { validateRecord } from "../public/lib/slots.js";
import { agentContext } from "../public/lib/agent-context.js";
import { scriptedSession } from "../src/llm.js";
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
const NAME = base.doors[FIRST].name;
const AT = "2026-10-20T12:00:00.000Z";
const post = (body) => new Request("https://doors.example/api/agent", { method: "POST", headers: { origin: "https://doors.example", "content-type": "application/json", "cf-connecting-ip": "203.0.113.9" }, body: JSON.stringify(body) });
const ask = async (env, text, context = base) => (await worker.fetch(post({ v: 1, messages: [{ role: "user", text }], context }), env)).json();
const notesIn = (r) => (r.actions ?? []).filter((a) => a.type === "slot" && a.record?.field === "note");
const withNotes = (records) => agentContext({ plan: { ...plan, slots: { [FIRST]: records } }, dayIndex: 0, current: FIRST, city: city("austin"), routes: [route("athletic-brewing-austin")], now: new Date(`${plan.days[0].date}T14:20:00`) });

// ---------- the record ----------
test("a note is an S4 slot record that never expires, the agent may write it, and it says who wrote it", () => {
  const n = makeNote({ text: "  The manager is Priya,   back Thursdays ", by: "agent:workers-ai", words: "the manager is Priya, back Thursdays", at: AT });
  assert.equal(n.slot, "S4");
  assert.equal(n.field, "note");
  assert.equal(n.value, "The manager is Priya, back Thursdays");
  assert.equal(n.expires, null);
  assert.ok(n.id);
  assert.deepEqual(validateRecord(n, { agent: true }), { ok: true });
  assert.equal(whoWrote(n), "Doors Agent");
  assert.equal(whoWrote(makeNote({ text: "x y z", by: "rep" })), "You");
  assert.equal(whoWrote(makeNote({ text: "x y z", by: "drive" })), "You, on the road");
  assert.equal(makeNote({ text: "   " }), null);
  assert.ok(makeNote({ text: "a".repeat(400) }).value.length <= 301);
});

test("notesOf lists a door's notes newest first; noteOp edits (marked edited, by kept) and deletes one", () => {
  const a = makeNote({ text: "They want samples", by: "agent:gemini", at: "2026-10-20T10:00:00.000Z" });
  const b = makeNote({ text: "Cooler is full till spring", by: "rep", at: "2026-10-21T10:00:00.000Z" });
  const other = { slot: "S4", field: "said", value: "liked it", source: "stated", at: AT };
  const recs = [a, other, b];
  assert.deepEqual(notesOf({ d: recs }, "d").map((n) => n.text), ["Cooler is full till spring", "They want samples"]);
  const ed = noteOp(recs, { note: a.id, text: "They want samples of the dry one" }, "2026-10-22T10:00:00.000Z");
  const n = notesOf({ d: ed }, "d").find((x) => x.id === a.id);
  assert.equal(n.text, "They want samples of the dry one");
  assert.equal(n.who, "Doors Agent · edited by you");
  assert.equal(ed.length, 3);
  assert.equal(noteOp(recs, { note: b.id, drop: true }).length, 2);
  assert.equal(noteOp(recs, { note: b.id, text: "  " }).length, 2, "an emptied note is deleted");
  assert.ok(noteOp(recs, { note: b.id, drop: true }).includes(other), "other records stay");
});

test("worthNoting: an explicit ask, or a fact for a later visit; never a question or a plain outcome", () => {
  assert.deepEqual(worthNoting("note that the manager is Priya, back Thursdays"), { text: "The manager is Priya, back Thursdays.", explicit: true });
  assert.equal(worthNoting("Remember: they want samples")?.text, "They want samples.");
  assert.equal(worthNoting("can you make a note they close early on Sundays")?.explicit, true);
  assert.equal(worthNoting("The manager is Priya, she's back Thursdays")?.explicit, false);
  assert.ok(worthNoting("they want samples of the dry one"));
  assert.ok(worthNoting("ask for Marco at the bar"));
  assert.ok(worthNoting("she prefers a text over a call"));
  assert.ok(worthNoting("they're changing their menu next month"));
  assert.equal(worthNoting("done, liked it"), null);
  assert.equal(worthNoting("why is my first stop first?", { question: true }), null);
  assert.equal(worthNoting("thanks!"), null);
});

test("visitNote: a logged visit's note becomes a door note once", () => {
  const o = { result: "interested", note: "liked it, hesitant about price", at: AT };
  assert.equal(visitNote(o, { by: "drive" }).value, "liked it, hesitant about price");
  assert.equal(visitNote(o, { notes: [{ text: "Liked it, hesitant about price." }] }), null);
  assert.equal(visitNote({ result: "no" }), null);
});

// ---------- the save_note tool ----------
test("save_note is a tool the model sees, and the prompt tells it to note what matters and say so", () => {
  assert.ok(TOOLS.some((t) => t.name === "save_note"));
  assert.match(SYSTEM, /save_note/);
  assert.match(SYSTEM, /noted it/);
});

test("save_note keeps the rep's words; refuses words the rep never said, notes about a person, a door not on the plan", () => {
  const words = "the manager is Priya, she's back Thursdays";
  const ok = runTool("save_note", { door_id: FIRST, text: "Manager is Priya, back Thursdays" }, base, { by: "agent:workers-ai", words, now: AT });
  assert.equal(ok.ok, true);
  assert.equal(ok.actions[0].type, "slot");
  assert.equal(ok.actions[0].id, FIRST);
  assert.equal(ok.actions[0].record.field, "note");
  assert.equal(ok.actions[0].record.by, "agent:workers-ai");
  const made = runTool("save_note", { door_id: FIRST, text: "Priya loves IPAs and hates cider" }, base, { by: "agent:workers-ai", words, now: AT });
  assert.equal(made.ok, false);
  const person = runTool("save_note", { door_id: FIRST, text: "The manager is an older guy" }, base, { by: "agent:workers-ai", words: "the manager is an older guy", now: AT });
  assert.equal(person.ok, false);
  assert.match(person.error, /age, gender, origin/);
  assert.equal(runTool("save_note", { door_id: FIRST, text: "they want white wine samples" }, base, { by: "agent:x", words: "they want white wine samples", now: AT }).ok, true, "a drink's colour is not a person");
  assert.equal(runTool("save_note", { door_id: "nope", text: "x y z" }, base, { by: "agent:x", words: "x y z" }).ok, false);
});

test("save_note gives back a name the turn redacted, and a note the door has is not saved twice", () => {
  const r = runTool("save_note", { door_id: FIRST, text: "Ask for the contact, back Thursdays" }, base, { by: "agent:workers-ai", words: "ask for Priya, she's back Thursdays", now: AT });
  assert.equal(r.ok, true);
  assert.equal(r.actions[0].record.value, "Ask for Priya, back Thursdays");
  const ctx = withNotes([makeNote({ text: "They want samples", by: "rep", at: AT })]);
  const again = runTool("save_note", { door_id: FIRST, text: "they want samples" }, ctx, { by: "agent:x", words: "they want samples", now: AT });
  assert.equal(again.ok, true);
  assert.equal(again.actions, undefined);
  assert.equal(again.data.already, true);
});

test("remember with field note is the same note (Llama reaches for remember)", () => {
  const r = runTool("remember", { field: "note", value: "they want samples", door_id: FIRST }, base, { by: "agent:workers-ai", words: "they want samples next time", now: AT });
  assert.equal(r.ok, true);
  assert.equal(r.actions[0].record.field, "note");
});

test("a logged visit's note is also a door note (the stop's Notes show it later)", () => {
  const r = runTool("log_visit", { door_id: FIRST, result: "interested", note: "liked it, hesitant about price" }, base, { by: "agent:workers-ai", words: "done, liked it, hesitant about price", now: `${base.today}T14:30` });
  assert.equal(r.ok, true);
  const n = notesIn(r);
  assert.equal(n.length, 1);
  assert.match(n[0].record.value, /hesitant about price/);
});

// ---------- the context the agent reads ----------
test("a door's notes reach the agent: agentContext, cleanContext, the prompt, and explain_door's facts", () => {
  const ctx = withNotes([makeNote({ text: "Manager back Thursdays", by: "rep", at: AT }), makeNote({ text: "They want samples", by: "agent:gemini", at: "2026-10-21T12:00:00.000Z" })]);
  assert.deepEqual(ctx.doors[FIRST].notes, [{ text: "They want samples", by: "ask-doors" }, { text: "Manager back Thursdays", by: "rep" }]);
  const clean = cleanContext(ctx);
  assert.equal(clean.doors[FIRST].notes.length, 2);
  assert.match(promptOf([{ role: "user", text: "what do I know here?" }], clean), /They want samples/);
  const facts = runTool("explain_door", { door_id: FIRST }, clean).facts.filter((f) => f.source.field === "note");
  assert.equal(facts.length, 2);
  assert.equal(facts[0].source.label, "a note Doors Agent saved from your words");
  assert.equal(notesForAgent({}, FIRST).length, 0);
});

// ---------- the rules path (the model resting, the demo, offline) ----------
test("rules: 'note that…' saves a note on the open door and says so", () => {
  const r = answerByRules([{ role: "user", text: "note that the manager is Priya, back Thursdays" }], base, { now: AT });
  const n = notesIn(r);
  assert.equal(n.length, 1);
  assert.equal(n[0].id, FIRST);
  assert.equal(n[0].record.value, "The manager is Priya, back Thursdays.");
  assert.equal(n[0].record.by, "rules");
  assert.match(r.reply, new RegExp(`^Noted on ${NAME.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.ok(!r.actions.some((a) => a.type === "outcome"), "a note is not a logged visit");
});

test("rules: a fact for later with no outcome word is a note, not a follow-up on Thursday", () => {
  const r = answerByRules([{ role: "user", text: "The manager is Priya, she's back Thursdays" }], base, { now: AT });
  assert.equal(notesIn(r).length, 1);
  assert.ok(!r.actions.some((a) => a.type === "outcome"));
});

test("rules: a visit with words in it is logged, and its words are a note too", () => {
  const r = answerByRules([{ role: "user", text: "done, liked it, hesitant about price" }], base, { now: AT });
  assert.ok(r.actions.some((a) => a.type === "outcome"));
  assert.equal(notesIn(r).length, 1);
});

test("rules: 'what do I know about <door>' reads its notes back, with sources", () => {
  const ctx = withNotes([makeNote({ text: "They want samples", by: "agent:gemini", at: AT })]);
  const r = answerByRules([{ role: "user", text: `what do I know about ${NAME}?` }], ctx, { now: AT });
  assert.match(r.reply, /They want samples/);
  assert.equal(r.facts[0].source.field, "note");
  const none = answerByRules([{ role: "user", text: "any notes on this one?" }], base, { now: AT });
  assert.match(none.reply, /No notes on/);
});

test("rules: no door open and none named → asks which door, saves nothing", () => {
  const r = answerByRules([{ role: "user", text: "note that they want samples" }], { ...base, current: null }, { now: AT });
  assert.equal(notesIn(r).length, 0);
  assert.match(r.reply, /Which door/);
});

// ---------- the model path ----------
const stub = (steps) => (opts) => scriptedSession(steps)(opts);
test("model: its save_note is applied, and the reply says it noted it", async () => {
  const r = await ask({ AGENT_SESSION: stub([{ calls: [{ name: "save_note", args: { door_id: "d1", text: "they want samples of the dry one" } }] }, { text: "Noted: they want samples of the dry one." }]) }, "they want samples of the dry one next time");
  assert.equal(r.resting, undefined);
  assert.equal(notesIn(r).length, 1);
  assert.equal(notesIn(r)[0].id, FIRST);
  assert.match(r.reply, /Noted/);
});

test("model: the rep asked for a note and the model only said so: code saves it and the reply is true", async () => {
  const r = await ask({ AGENT_SESSION: stub([{ text: "I've noted that the manager is back Thursdays." }]) }, "note that the manager is back Thursdays");
  assert.equal(notesIn(r).length, 1);
  assert.match(r.reply, new RegExp(`Noted on ${NAME.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.`));
  assert.ok(!/I've noted/.test(r.reply), "the model's unbacked claim is dropped");
});

test("model: a fact the model didn't note is offered, never saved unasked", async () => {
  const r = await ask({ AGENT_SESSION: stub([{ text: "Good to know." }]) }, "the manager is Priya, she's back Thursdays");
  assert.equal(notesIn(r).length, 0);
  assert.equal(r.offerNote.id, FIRST);
  assert.match(r.offerNote.text, /back Thursdays/);
});

test("model: log_visit's note and a save_note of the same words are one note", async () => {
  const r = await ask({ AGENT_SESSION: stub([{ calls: [{ name: "log_visit", args: { door_id: "d1", result: "interested", note: "liked it, hesitant about price" } }, { name: "save_note", args: { door_id: "d1", text: "liked it, hesitant about price" } }] }, { text: "Logged and noted." }]) }, "done, liked it, hesitant about price");
  assert.equal(notesIn(r).length, 1);
});
