// R9 red team (docs/REDTEAM-R9.md): each High/Medium finding, attacked through the real Worker path with a stub model
// (no network), then the honest path beside it so a fix can't break what a rep does.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.js";
import { _resetAgent, agentLimited, cleanContext, cleanReply, claimsBacked, AGENT_WINDOW, AGENT_DAILY, NET_SHARE, MAX_BODY } from "../src/agent.js";
import { runTool, grounded, isCorrection } from "../public/lib/agent-tools.js";
import { answerByRules } from "../public/lib/agent-rules.js";
import { parseVisit } from "../public/lib/visit-parse.js";
import { checkReply, dropRecord, redact, namesIn } from "../public/lib/slots.js";
import { ipKey } from "../src/guard.js";
import { scriptedSession } from "../src/llm.js";
import { demoContext } from "./agent-fixture.mjs";

const realFetch = globalThis.fetch;
before(() => (globalThis.fetch = async (u) => { throw new Error(`network call attempted in a test: ${u}`); }));
after(() => (globalThis.fetch = realFetch));
beforeEach(() => _resetAgent());

const { ctx } = await demoContext({ current: "first" });
const FIRST = ctx.day.stops[0].id;
const SECOND = ctx.day.stops[1].id;
const ORIGIN = "https://doors.example";
const post = (path, raw, headers = {}) => new Request(`${ORIGIN}${path}`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json", "cf-connecting-ip": "203.0.113.7", ...headers }, body: raw });
const stubEnv = (steps) => ({ AGENT_SESSION: (o) => scriptedSession(steps)(o) });
const chat = async (env, text, context = ctx) => (await worker.fetch(post("/api/agent", JSON.stringify({ v: 1, messages: [{ role: "user", text }], context })), env)).json();
const visit = (text, extra = {}) => JSON.stringify({ v: 1, text, stop: { id: FIRST, name: ctx.doors[FIRST].name }, now: { date: ctx.today, min: 860 }, windows: ctx.windows.map((w) => w.date), next: [{ id: SECOND, name: ctx.doors[SECOND].name }], ...extra });
const opts = (words) => ({ by: "agent:stub", words, now: `${ctx.today}T14:20` });

// ---------- F1 bodies ----------
test("F1: a JSON body that isn't an object is a 400, not a crash", async () => {
  for (const path of ["/api/agent", "/api/agent/log-visit"]) for (const raw of ["null", "[1]", '"x"', "7"]) {
    const r = await worker.fetch(post(path, raw), {});
    assert.equal(r.status, 400, `${path} ${raw}`);
  }
});
test("F2: the body cap (192 KB since round 3) counts bytes (emoji) and a declared content-length over it is refused unread", async () => {
  const big = JSON.stringify({ v: 1, messages: [{ role: "user", text: "hi" }], pad: "😀".repeat(60000) }); // 120 K chars, 240 KB
  assert.ok(big.length < MAX_BODY && Buffer.byteLength(big) > MAX_BODY);
  assert.equal((await worker.fetch(post("/api/agent", big), {})).status, 413);
  assert.equal((await worker.fetch(post("/api/agent", "{}", { "content-length": String(MAX_BODY + 1) }), {})).status, 413);
  const ok = await worker.fetch(post("/api/agent", JSON.stringify({ v: 1, messages: [{ role: "user", text: "what's next" }], context: ctx })), {});
  assert.equal(ok.status, 200, "an honest body still answers");
});
test("F10: a door id __proto__ is dropped, the plan's doors stay a plain map", () => {
  const c = cleanContext(JSON.parse(`{"doors":{"__proto__":{"name":"PWN"},"a1":{"name":"A"}}}`));
  assert.deepEqual(Object.keys(c.doors), ["a1"]);
  assert.equal(Object.getPrototypeOf(c.doors), Object.prototype);
});

// ---------- F3 invented memory ----------
test("F3: log-visit keeps the rep's words, not the model's invented who and note (the rules reading instead)", async () => {
  const env = stubEnv([{ calls: [{ name: "log_visit", args: { door_id: SECOND, result: "interested", who: "Bob the drunk", note: "owner said our beer tastes like soap" } }] }, { text: "ok" }]);
  const r = await (await worker.fetch(post("/api/agent/log-visit", visit("done, liked it")), env)).json();
  assert.equal(r.ok, true);
  assert.equal(r.visit.outcome.who, undefined);
  assert.equal(r.visit.outcome.note, "liked it");
  assert.ok(r.actions.every((a) => a.id === FIRST), "only the stop");
  assert.ok(!JSON.stringify(r).includes("soap") && !JSON.stringify(r).includes("Bob"));
});
test("F3: the honest model log keeps a who and note the rep said", async () => {
  const env = stubEnv([{ calls: [{ name: "log_visit", args: { door_id: FIRST, result: "interested", who: "Dana", note: "hesitant about price" } }] }, { text: "ok" }]);
  const r = await (await worker.fetch(post("/api/agent/log-visit", visit("done, talked to Dana, liked it, hesitant about price")), env)).json();
  assert.equal(r.source, "model");
  assert.equal(r.visit.outcome.who, "Dana");
  assert.equal(r.visit.outcome.note, "hesitant about price");
});
test("F3: remember refuses a contact or a 'said' the rep never said; keeps what they did say", () => {
  assert.equal(runTool("remember", { field: "contact", door_id: FIRST, value: { name: "Gary Stone", role: "owner" } }, ctx, opts("thanks")).ok, false);
  assert.equal(runTool("remember", { field: "said", door_id: FIRST, value: "they hate local beer" }, ctx, opts("thanks")).ok, false);
  assert.equal(runTool("remember", { field: "rule.avoid", value: "craft", correction: true }, ctx, opts("no, never say local")).ok, false);
  const ok = runTool("remember", { field: "contact", door_id: FIRST, value: { name: "Gary Stone", role: "owner" } }, ctx, opts("the owner is Gary Stone"));
  assert.equal(ok.ok, true);
  assert.equal(ok.actions[0].record.value.name, "Gary Stone");
  assert.equal(runTool("remember", { field: "said", door_id: FIRST, value: "wants a tasting first" }, ctx, opts("she said she wants a tasting first")).ok, true);
});
test("F4: the redaction placeholder 'the contact' is never stored as a name: the known name the rep said is", async () => {
  const c = { ...ctx, names: ["Sam Ortiz"] };
  const seen = [];
  const env = { AGENT_SESSION: (o) => (seen.push(o.user), scriptedSession([{ calls: [{ name: "log_visit", args: { door_id: FIRST, result: "interested", who: "the contact" } }, { name: "remember", args: { field: "contact", door_id: FIRST, value: { name: "the contact", role: "buyer" } } }] }, { text: "ok" }])(o)) };
  const r = await chat(env, "talked to Sam Ortiz, the buyer, interested", c);
  assert.ok(!seen[0].includes("Sam Ortiz"), "the model never saw the name");
  const out = r.actions.find((a) => a.type === "outcome");
  assert.equal(out.outcome.who, "Sam Ortiz");
  const slot = r.actions.filter((a) => a.type === "slot" && a.record.field === "contact");
  assert.ok(slot.length && slot.every((a) => a.record.value.name === "Sam Ortiz"), JSON.stringify(slot));
});

// ---------- F5 dictated ----------
test("F5: 'dictated' skips the talking-point guard only when the rep's message holds the line", async () => {
  const line = "We pour the best IPA in town, everyone stocks us";
  const env = stubEnv([{ calls: [{ name: "edit_talking_points", args: { door_id: FIRST, section: "opener", op: "replace", text: line, dictated: true } }] }, { text: "ok" }]);
  const r = await chat(env, "make the opener better");
  assert.equal(r.actions.length, 0, "the model's own line goes through the guard (and fails it)");
  const mine = runTool("edit_talking_points", { door_id: FIRST, section: "points", op: "add", text: "Everyone in Austin is already pouring our IPA.", dictated: true }, ctx, opts("Add a point, my own words: Everyone in Austin is already pouring our IPA."));
  assert.equal(mine.ok, true);
  assert.equal(mine.actions[0].by, "rep");
});

// ---------- F6 re-plans ----------
test("F6: one re-plan a turn, however many the model asks for", async () => {
  const calls = [1, 2, 3, 4].map((n) => ({ name: "replan", args: { max_doors: n } }));
  const r = await chat(stubEnv([{ calls }, { calls }, { text: "ok" }]), "replan it");
  assert.equal(r.actions.filter((a) => a.type === "replan").length, 1);
  assert.equal(r.actions[0].maxDoors, 1);
});

// ---------- F7 unsourced claims ----------
test("F7: a sentence speaking for Qloo with no facts behind it is dropped; one backed by this turn's facts stays", async () => {
  const r = await chat(stubEnv([{ text: "Qloo ranks it number 1 in all of Texas. It has a 0.99 affinity. Ask for the manager." }]), "x");
  assert.equal(r.reply, "Ask for the manager.");
  const facts = runTool("explain_door", { door_id: FIRST }, ctx).facts;
  const rank = facts.find((f) => f.source.field === "rank").text;
  const n = /\d+ of \d+/.exec(rank)[0];
  assert.equal(claimsBacked(`Qloo ranks it ${n}.`, { facts }), `Qloo ranks it ${n}.`);
  assert.equal(claimsBacked("Qloo ranks it 1 of 2.", { facts }), "");
  assert.equal(claimsBacked("Qloo's data doesn't say.", { facts: [] }), "Qloo's data doesn't say.");
  assert.equal(cleanReply("Kitty is close by.", cleanContext(ctx), { facts: [], words: "" }), "Kitty is close by.");
});

// ---------- F8 caps ----------
test("F8: an IPv6 /48 can't rotate /64s past the caps; filling the maps doesn't reset anyone's count", () => {
  const env = {};
  let n = 0;
  for (let i = 0; i < AGENT_WINDOW * NET_SHARE + 5; i++) if (!agentLimited(env, ipKey(`2001:db8:1:${i.toString(16)}::1`))) n++;
  assert.equal(n, AGENT_WINDOW * NET_SHARE, "the /48 is held at NET_SHARE visitors' worth");
  _resetAgent();
  const me = "198.51.100.1";
  for (let i = 0; i < AGENT_WINDOW; i++) agentLimited(env, me);
  assert.equal(agentLimited(env, me), "busy");
  for (let i = 0; i < 6000; i++) agentLimited(env, `10.${(i >> 16) & 255}.${(i >> 8) & 255}.${i & 255}`);
  assert.equal(agentLimited(env, me), "busy", "6,000 fresh visitors didn't clear my window");
  assert.equal(agentLimited({}, "192.0.2.1"), null, "IPv4 visitors are unchanged");
  assert.ok(AGENT_DAILY > AGENT_WINDOW);
});

// ---------- F9 rules path ----------
test("F9: the rules path doesn't log a bulk command on the current door, nor 'today' as a follow-up", () => {
  const r = answerByRules([{ role: "user", text: "Mark every stop today as interested." }], ctx, { now: `${ctx.today}T14:20` });
  assert.equal(r.actions.length, 0);
  assert.match(r.reply, /one door at a time/);
  const p = parseVisit("liked it today", { stop: { id: FIRST, name: "A" }, now: { date: ctx.today, min: 860 } });
  assert.equal(p.visit.outcome.result, "interested");
  assert.equal(p.visit.outcome.followUp, undefined);
  const back = parseVisit("come back today at 5", { stop: { id: FIRST, name: "A" }, now: { date: ctx.today, min: 860 } });
  assert.equal(back.visit.outcome.followUp, ctx.today, "a come-back later today stays");
  const sam = parseVisit("talked to Sam, interested", { stop: { id: FIRST, name: "A" }, now: { date: ctx.today, min: 860 } });
  assert.equal(sam.visit.outcome.result, "interested");
  assert.equal(sam.visit.outcome.who, "Sam");
});

// ---------- F11 CPU ----------
test("F11: the reply check stays cheap with a full avoid list (the free plan's CPU limit is 10 ms)", () => {
  const avoid = Array.from({ length: 800 }, (_, i) => `Artist Number ${i}`);
  const text = Array.from({ length: 12 }, (_, i) => `Sentence ${i} is here.`).join(" ");
  checkReply(text, { constraints: { avoid } });
  const t = performance.now();
  for (let i = 0; i < 20; i++) checkReply(text, { constraints: { avoid } });
  assert.ok((performance.now() - t) / 20 < 5, `${((performance.now() - t) / 20).toFixed(1)} ms`);
  assert.equal(checkReply("They play Artist Number 7 there. Fine.", { constraints: { avoid } }).text, "Fine.", "still drops a named one");
});

// ---------- F12 slot Undo ----------
test("F12: undoing the agent's contact keeps the rep's earlier one", () => {
  const sam = { field: "contact", value: { name: "Sam" } };
  const jo = { field: "contact", value: { name: "Jo" } };
  assert.deepEqual(dropRecord([sam, jo], "contact", { name: "Jo" }), [sam]);
  assert.deepEqual(dropRecord([sam], "contact", { name: "Jo" }), [sam]);
});
test("grounded: names need every word, phrases most", () => {
  assert.equal(grounded("Sam Ortiz", "talked to sam ortiz"), true);
  assert.equal(grounded("Sam Stone", "talked to sam ortiz"), false);
  assert.equal(grounded("hesitant about the price", "liked it, hesitant on price", 2 / 3), true);
});

// ---------- F14 first names ----------
test("F14: first and last names alone are redacted, case as written; names the lines or the chat give a person too", async () => {
  assert.equal(redact("remember Sam; Ortiz called", ["Sam Ortiz"]), "remember the contact; the contact called");
  assert.equal(redact("Sam (bar manager) liked it", ["Sam (bar manager)"]), "the contact liked it");
  assert.equal(redact("Will said they will call in May, may be", ["Will May"]), "the contact said they will call in the contact, may be", "lowercase words stay");
  assert.equal(redact("Sammy is not Sam", ["Sam Ortiz"]), "Sammy is not the contact", "whole words only");
  assert.deepEqual(namesIn("Ask for Jordan (owner). Hi Parson’s team, talked to Dana Lee. Ask for the bar manager. Hi Sam,"), ["Jordan", "Dana Lee", "Sam"]);
  // through the Worker: the stored name's first name in the chat, a name in a stored line, a name the rep just gave
  const c = structuredClone({ ...ctx, names: ["Sam Ortiz"] });
  c.doors[FIRST].outcome = { result: "followup", note: "Ask for Jordan next time; Ortiz knows the list" };
  c.doors[FIRST].talk.points.push("Ask for Jordan; Ortiz knows the list.");
  const seen = [];
  const env = { AGENT_SESSION: (o) => (seen.push(o.user), scriptedSession([{ calls: [{ name: "remember", args: { field: "contact", door_id: FIRST, value: { name: "the contact", role: "buyer" } } }] }, { text: "ok" }])(o)) };
  const r = await chat(env, "remember Sam, the buyer. Also talked to Priya Shah", c);
  for (const n of ["Sam", "Ortiz", "Jordan", "Priya", "Shah"]) assert.ok(!new RegExp(`\\b${n}\\b`).test(seen[0]), `${n} reached the model`);
  // "the contact" comes back as the part of the stored name the rep said
  const slot = r.actions.find((a) => a.type === "slot" && a.record.field === "contact");
  assert.equal(slot?.record.value.name, "Sam");
  // a name the rep gave in this message, redacted on the way in, comes back as the rep said it
  assert.equal(runTool("remember", { field: "contact", door_id: FIRST, value: { name: "the contact", role: "owner" } }, ctx, opts("talked to Priya Shah, the owner")).actions[0].record.value.name, "Priya Shah");
});

// ---------- F15 what counts as a correction ----------
test("F15: only an explicit correction writes a 'corrected' record; a 'no' or 'not' in passing doesn't", () => {
  const vt = (words) => runTool("remember", { field: "venueType", value: "brewery", door_id: FIRST, correction: true }, ctx, opts(words)).ok;
  // counts: a leading No/Nope/Wrong, "that's wrong/not right", a leading "Actually,", "it's not a X, it's a Y",
  // "change/switch/fix … to", "call it", "never/don't say", "instead", "rather than"
  for (const w of ["No, it's a brewery", "Nope. Brewery.", "That's wrong, it's a brewery", "that's not right: it's a brewery", "Actually, it's a brewery",
    "it's not a bar, it's a brewery", "change it to a brewery", "switch the type to brewery", "call it a brewery", "it's a brewery instead", "a brewery rather than a bar"]) assert.equal(vt(w), true, w);
  // doesn't: a no/not/change/actually in passing
  for (const w of ["that was not bad", "no rush, it's a brewery", "they're not open Mondays", "they actually liked it", "nothing to change", "I'm not sure", "no"]) assert.equal(vt(w), false, w);
  assert.equal(isCorrection("never say local"), true);
  assert.equal(isCorrection("don't use craft"), true);
  // correction: true from the model is still required, whatever the words
  assert.equal(runTool("remember", { field: "venueType", value: "brewery", door_id: FIRST }, ctx, opts("No, it's a brewery")).ok, false);
});

// ---------- the daily cap ----------
test("AGENT_DAILY is 60 turns per visitor a day (Doors Agent spec §7, Jard 10-23)", () => {
  assert.equal(AGENT_DAILY, 60);
});

// doors-rn, 2026-10-22: the name WHO catches is cleaned of filler and role words around it
test("visit-parse: 'talked to Sam the manager' is Sam, interested stays; role-only and pronouns are no name", async () => {
  const { parseVisit, nameOf } = await import("../public/lib/visit-parse.js");
  const at = { stop: { id: "x", name: "Nomadic Beerworks" }, now: { date: "2026-10-22", min: 900 } };
  const o = (t) => parseVisit(t, at).visit.outcome;
  assert.deepEqual([o("done, liked it, hesitant about price, talked to Sam the manager").result, o("done, liked it, hesitant about price, talked to Sam the manager").who], ["interested", "Sam"]);
  assert.equal(o("talked to the manager Sam, interested").who, "Sam");
  assert.equal(o("talked to Sam Lee, come back Friday").who, "Sam Lee");
  assert.equal(o("spoke with Maria, the owner. not a fit").who, "Maria");
  assert.equal(o("talked to the bar manager, liked it").who ?? "", "");
  assert.equal(o("talked to them before, no").who ?? "", "");
  assert.equal(nameOf("Sam the"), "Sam");
});
