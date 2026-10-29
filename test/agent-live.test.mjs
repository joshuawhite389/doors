// Live check finding A: Ask Doors on Workers AI answered only "The Doors app shows the
// sources under my reply" (every sentence naming the drinker brand was dropped as "avoid") and re-ran the previous
// turn's replan. A stub env.AI replays Workers AI answers. No network.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.js";
import { _resetAgent, cleanContext, cleanReply, promptOf, staleChange, SYSTEM } from "../src/agent.js";
import { runTool } from "../public/lib/agent-tools.js";
import { demoContext } from "./agent-fixture.mjs";

const realFetch = globalThis.fetch;
before(() => (globalThis.fetch = async (u) => { throw new Error(`network call attempted in a test: ${u}`); }));
after(() => (globalThis.fetch = realFetch));
beforeEach(() => _resetAgent());

const { ctx } = await demoContext({ current: "first" });
const c = cleanContext(ctx);
const [FIRST, SECOND] = ctx.day.stops.map((x) => x.id);
const NAME2 = ctx.doors[SECOND].name;
const brand = c.cityData.drinker;
const post = (messages, context = ctx) => new Request("https://doors.example/api/agent", { method: "POST", headers: { origin: "https://doors.example", "content-type": "application/json", "cf-connecting-ip": "203.0.113.9" }, body: JSON.stringify({ v: 1, messages, context }) });
const oa = (msg) => ({ choices: [{ message: { role: "assistant", content: null, ...msg } }], usage: { prompt_tokens: 3000, completion_tokens: 40 } });
const call = (name, args, id = "t1") => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });
const stubAI = (answers) => {
  const seen = [];
  return { seen, run: async (model, input) => (seen.push(input), answers.shift() ?? oa({ content: "ok" })) };
};

test("a reply may say the rank fact's own words (people who drink like <brand> drinkers); 'pours <brand>' still goes", () => {
  assert.ok(brand, "the fixture has a drinker brand");
  const facts = runTool("explain_door", { door_id: SECOND }, c, {}).facts;
  const t = `${NAME2} ranks #2 of 55 Austin bars and breweries for people who drink like ${brand} drinkers. It pours ${brand} on tap.`;
  // gigbot 10-24: the rank in words unless the rep asks for numbers (noScores)
  assert.equal(cleanReply(t, c, { facts, words: "why?" }), `${NAME2} ranks near the top of the 55 Austin bars and breweries for people who drink like ${brand} drinkers.`);
  assert.equal(cleanReply(t, c, { facts, words: "what number is it?" }), `${NAME2} ranks #2 of 55 Austin bars and breweries for people who drink like ${brand} drinkers.`);
});

test("the prompt's 'sources under your reply' is never the reply, and a model's own source list is dropped", () => {
  assert.doesNotMatch(SYSTEM, /sources under your reply/);
  assert.equal(cleanReply("The Doors app shows the sources under my reply.", c), "");
  assert.equal(cleanReply("It is close by. Sources: Qloo, Doors", c), "It is close by.");
});

test("the prompt sets the earlier turns apart as handled and the last message as the one to answer", () => {
  const p = promptOf([{ role: "user", text: "finish by 4:30" }, { role: "agent", text: "Done." }, { role: "user", text: "why is it first?" }], c);
  assert.match(p, /EARLIER \(already handled\)\nRep: finish by 4:30\nYou: Done\.\n\nANSWER THIS\nRep: why is it first\?$/);
});

test("a change the last message doesn't ask for is refused; so is a replan the day already has", () => {
  assert.match(staleChange("replan", { end_by: "16:30" }, `why is ${NAME2} on my list at all?`, c), /no change/);
  assert.equal(staleChange("replan", { end_by: "16:30" }, "I only have until 4:30", c), null);
  const ends = { ...c, windows: c.windows.map((w) => (w.date === c.day.date ? { ...w, to: "16:30" } : w)) };
  assert.match(staleChange("replan", { end_by: "16:30" }, "I only have until 4:30", ends), /already ends at 16:30/);
  assert.equal(staleChange("replan", { end_by: "16:30", skip: [SECOND] }, "until 4:30 and skip the next one", ends), null);
  // the live check's second identical ask: end 16:30 and max 7, both already so
  const capped = { ...ends, maxPerDay: 7 };
  assert.match(staleChange("replan", { end_by: "16:30", max_doors: 7 }, "which stop would you cut if I only have until 4:30?", capped), /already ends at 16:30 and has up to 7 doors/);
  assert.equal(staleChange("replan", { end_by: "16:30", max_doors: 6 }, "only 6 doors", capped), null);
  assert.match(staleChange("edit_talking_points", { door_id: FIRST }, "why is it first?", c), /no talking-point change/);
  assert.equal(staleChange("edit_talking_points", { door_id: FIRST }, "make my opener shorter", c), null);
});

test("turn 2 on Workers AI: the model re-calls turn 1's replan on a 'why' question; nothing is applied, it answers", async () => {
  const ai = stubAI([oa({ tool_calls: [call("replan", { end_by: "16:30" })] }), oa({ tool_calls: [call("explain_door", { door_id: "d2" }, "t2")] }), oa({ content: `${NAME2} ranks #2 of 55 for people who drink like ${brand} drinkers.` })]);
  const r = await (await worker.fetch(post([{ role: "user", text: "I only have until 4:30" }, { role: "agent", text: "Done. The change is on your plan." }, { role: "user", text: `why is ${NAME2} on my list at all?` }]), { AI: ai })).json();
  assert.equal(r.by, "workers-ai");
  assert.deepEqual(r.actions, []);
  assert.deepEqual(r.tools.map((x) => [x.name, x.ok]), [["replan", false], ["explain_door", true]]);
  assert.match(r.reply, /ranks near the top of your list/); // gigbot 10-24: the rank in words
});

test("the tool steps run out on a call: one last step with no tools gives the words", async () => {
  const ai = stubAI([oa({ tool_calls: [call("compare_doors", { door_ids: ["d1", "d2"] })] }), oa({ tool_calls: [call("explain_door", { door_id: "d1" }, "t2")] }), oa({ tool_calls: [call("explain_door", { door_id: "d2" }, "t3")] }), oa({ content: `${NAME2} ranks #2 of 55 for people who drink like ${brand} drinkers.` })]);
  const r = await (await worker.fetch(post([{ role: "user", text: `why is ${NAME2} ranked where it is?` }]), { AI: ai })).json();
  assert.equal(ai.seen.length, 4);
  assert.ok(ai.seen[3].tools?.length, "the answer step keeps the tools declared (without them Llama ignores the results)");
  assert.match(ai.seen[3].messages.at(-1).content, /Call no tool/);
  assert.match(r.reply, /ranks near the top of your list/); // gigbot 10-24: the rank in words
});

test("Workers AI: two calls in one step go back as one call per assistant message (70b's 400 otherwise)", async () => {
  const ai = stubAI([oa({ tool_calls: [call("compare_doors", { door_ids: ["d1", "d2"] }, "a"), call("explain_door", { door_id: "d1" }, "b")] }), oa({ content: "They differ by rank." })]);
  await (await worker.fetch(post([{ role: "user", text: "why is the first ranked where it is?" }]), { AI: ai })).json();
  const hist = ai.seen[1].messages.slice(2, 6); // the session's live array: what step 2 was sent, before its answer
  assert.deepEqual(hist.map((m) => [m.role, m.tool_calls?.length ?? 0]), [["assistant", 1], ["tool", 0], ["assistant", 1], ["tool", 0]]);
});

test("a reply narrating the rep or a tool's result is dropped", () => {
  assert.equal(cleanReply("The answer to the rep's question is in the comparedoors result.", c), "");
  assert.equal(cleanReply("It ranks higher. The compare_doors result shows that.", c), "It ranks higher.");
});

test("the page waits longer than the Worker's longest turn (no live 70b → 8b answer is cut off for the rules)", async () => {
  const { TURN_MS, STEP_MS } = await import("../src/agent.js");
  const src = (await import("node:fs")).readFileSync(new URL("../public/ui/agent.js", import.meta.url), "utf8");
  const page = Number(/const TURN_MS = (\d+);/.exec(src)[1]);
  assert.ok(page > TURN_MS + STEP_MS, `page ${page} ms vs Worker ${TURN_MS} + ${STEP_MS} ms`);
});

test("70b's remember with the contact as a JSON string keeps the contact (it failed 'the rep didn't say that' every time)", async () => {
  const ai = stubAI([oa({ tool_calls: [call("remember", { field: "contact", value: '{"name": "Dana", "role": "manager"}', door_id: "d1", correction: "false" })] }), oa({ content: "Got it." })]);
  const r = await (await worker.fetch(post([{ role: "user", text: "the manager here is called Dana, she runs the bar program" }]), { AI: ai })).json();
  assert.deepEqual(r.tools, [{ name: "remember", ok: true }]);
  const slot = r.actions.find((a) => a.type === "slot");
  assert.equal(slot.record.value.name, "Dana");
  assert.equal(slot.record.value.role, "manager");
  // a name the rep never said still fails, JSON or not
  const ai2 = stubAI([oa({ tool_calls: [call("remember", { field: "contact", value: '{"name": "Robin"}', door_id: "d1" })] }), oa({ content: "ok" })]);
  const r2 = await (await worker.fetch(post([{ role: "user", text: "the manager here is called Dana" }]), { AI: ai2 })).json();
  assert.deepEqual(r2.tools, [{ name: "remember", ok: false }]);
});

test("a contact kept this turn: the reply names them, not 'the contact'; a second remember of it in the turn is not a second action", async () => {
  const c1 = call("remember", { field: "contact", value: '{"name": "Dana", "role": "manager"}', door_id: "d1" });
  const ai = stubAI([oa({ tool_calls: [c1] }), oa({ tool_calls: [{ ...c1, id: "t9" }] }), oa({ content: "The manager here is called the contact." })]);
  const r = await (await worker.fetch(post([{ role: "user", text: "the manager here is called Dana, she runs the bar program" }]), { AI: ai })).json();
  assert.equal(r.reply, "The manager here is called Dana.");
  assert.equal(r.actions.filter((a) => a.type === "slot").length, 1);
});
