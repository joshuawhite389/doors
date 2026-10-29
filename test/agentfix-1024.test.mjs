// Jard's 10-24 web review of the Doors Agent: the stop after a named door, a later day's times, a yes to the agent's
// own offer of an edit, and ranking talk said in plain words.
import { test } from "node:test";
import assert from "node:assert/strict";
import { demoContext } from "./agent-fixture.mjs";
import { staleChange, saysYes, cleanContext, cleanMessages, noScores, promptOf, stopOf, SYSTEM, AGENT_SYSTEM } from "../src/agent.js";
import { answerByRules } from "../public/lib/agent-rules.js";
import { nextStops, runTool, applyTalkEdits } from "../public/lib/agent-tools.js";
import { agentContext } from "../public/lib/agent-context.js";

const OFFER = "Dolphin Lounge's crowd is locals who come for live music, so I'd lead with cans. Want me to make those two edits to the talking points?";

test("a yes to the agent's offer of an edit is the ask for it; 'make the two edits' asks for an edit", () => {
  const c = { windows: [], day: { date: null, stops: [] } };
  assert.equal(staleChange("edit_talking_points", { door_id: "x" }, "yes please", c, OFFER), null);
  assert.equal(staleChange("edit_talking_points", { door_id: "x" }, "make the two edits", c, "I haven't changed them yet."), null);
  assert.equal(staleChange("edit_talking_points", { door_id: "x" }, "do it", c, OFFER), null);
  // live replay 10-24: Haiku asked "Shall I make them?" and then listed the two changes
  assert.equal(staleChange("edit_talking_points", { door_id: "x" }, "yes please", c, "I'd make two changes to Pinthouse's talking points. Shall I make them?\n- First, replace the first pushback line.\n- Second, add a line on cans."), null);
  // a yes with no offer before it, or a question, still asks for no change
  assert.match(staleChange("edit_talking_points", { door_id: "x" }, "yes please", c, "Dolphin Lounge draws locals."), /no talking-point change/);
  assert.match(staleChange("edit_talking_points", { door_id: "x" }, "why is it first?", c, OFFER), /no talking-point change/);
  assert.equal(saysYes("yes, but why is the sky blue and what time is it in Tokyo right now and also what about tomorrow then?"), false);
});

test("a yes to the agent's offered swap re-plans; a yes never turns a log into a question", async () => {
  const { ctx } = await demoContext({});
  const [a] = ctx.day.stops;
  const offer = "Want me to swap it for a stronger door off this day?";
  assert.equal(staleChange("replan", { skip: [a.id], add: [a.id] }, "yes", ctx, offer), null);
  assert.equal(staleChange("log_visit", { door_id: a.id, result: "interested" }, "yes", ctx, "Want me to log it as interested?"), null);
});

test("the stop after a door is on that door's own day (Jard 10-24: 'after Dolphin Lounge' answered stop 1 of Monday)", async () => {
  const { plan } = await demoContext({});
  const d2 = plan.days[1];
  // the app on day 1, the rep asks about a door of day 2
  const ctx = agentContext({ plan, dayIndex: 0, now: new Date(`${plan.days[0].date}T09:00:00`) });
  assert.equal(nextStops(ctx, d2.stops[1].id)[0].id, d2.stops[2].id);
  const name = ctx.doors[d2.stops[1].id].name;
  const r = answerByRules([{ role: "user", text: `what's the next stop after ${name}?` }], ctx);
  assert.match(r.reply, new RegExp(`^Next: ${ctx.doors[d2.stops[2].id].name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}, on \\w+day`));
  assert.deepEqual(r.actions, [{ type: "open", id: d2.stops[2].id }]);
  // the days reach the Worker
  const clean = cleanContext(JSON.parse(JSON.stringify(ctx)));
  assert.equal(clean.days.length, plan.days.length);
  assert.equal(clean.days[1].stops[2].id, d2.stops[2].id);
});

test("the prompt gives each door its day and stop, and says a later day's times haven't passed", async () => {
  const { plan } = await demoContext({});
  // Saturday before the plan, as Jard tested it: today is not a plan day
  const ctx = cleanContext(JSON.parse(JSON.stringify(agentContext({ plan, dayIndex: 0, now: new Date("2026-10-24T15:14:00") }))));
  const first = plan.days[0].stops[0].id;
  assert.match(stopOf(ctx, first), /^\w{3} \w{3} \d+, stop 1 of \d+, (around|a little)/);
  const d3 = plan.days[2].stops[0].id;
  assert.match(stopOf(ctx, d3), /, stop 1 of /);
  const p = promptOf([{ role: "user", text: "what's next?" }], ctx);
  assert.match(p, /"today_is":"Sat Oct 24"/);
  assert.match(p, /"day_is":"\w{3} \w{3} \d+ \(ahead: none of its times have passed\)"/);
  assert.match(p, /"stop":"\w{3} \w{3} \d+, stop 1 of/);
  for (const sys of [SYSTEM, AGENT_SYSTEM]) {
    assert.match(sys, /The stop after a door is the next stop on that door's own day/);
    assert.match(sys, /a time on a later day has not passed/);
    assert.match(sys, /says yes to a change you offered/);
    assert.doesNotMatch(sys, /level with your best door/);
  }
});

test("rules: how close a door is to the best match is said about its crowd, never as '#1' (Jard 10-24)", async () => {
  const { ctx } = await demoContext({ current: "first" });
  const top = Object.values(ctx.doors).find((v) => v.rank === 1);
  const near = Object.values(ctx.doors).find((v) => v.rank > 1 && typeof v.affinity === "number" && top.affinity - v.affinity < 0.02);
  assert.ok(near, "the demo plan has a door near the best match");
  const r = answerByRules([{ role: "user", text: `why is ${near.name} ranked there?` }], ctx);
  assert.match(r.reply, new RegExp(`Its crowd matches your drinker (almost )?as closely as ${top.name}, your best match\\.`));
  assert.doesNotMatch(r.reply, /#1\b|near-equal|level with|scores it/);
});

test("the line to the buyer can be edited (the agent offered it and the tool couldn't reach it)", async () => {
  const { ctx } = await demoContext({ current: "first" });
  const id = ctx.current;
  const r = runTool("edit_talking_points", { door_id: id, section: "toBuyer", op: "replace", text: "Would you taste it next to the NA option you have now?" }, ctx, { by: "agent:anthropic", words: "yes please" });
  assert.equal(r.ok, true, r.error);
  const t = applyTalkEdits({ opener: "Hi", toBuyer: "old", questions: [], points: [], pushback: [], ask: "one case" }, [{ ...r.actions[0], by: "model" }]);
  assert.equal(t.toBuyer, "Would you taste it next to the NA option you have now?");
  assert.equal(t.edited.toBuyer, "model");
  assert.equal(runTool("edit_talking_points", { door_id: id, section: "toBuyer", op: "add", text: "x y z" }, ctx).ok, false);
});

test("the agent's own reply keeps its offer at the end (cut at 600 it lost 'Should I make both?')", () => {
  const long = `${"I'd make two changes. ".repeat(40)}Should I make both changes now?`;
  const m = cleanMessages([{ role: "user", text: "what would you change?" }, { role: "agent", text: long }, { role: "user", text: "yes please" }]);
  assert.match(m[1].text, /Should I make both changes now\?$/);
  assert.equal(staleChange("edit_talking_points", { door_id: "x" }, "yes please", { windows: [], day: { stops: [] } }, m[1].text), null);
});

test("a replace names its line by its words when it leaves out index (live replay: Haiku never sent index)", async () => {
  const { ctx } = await demoContext({ current: "first" });
  const id = ctx.current;
  const pb = ctx.doors[id].talk.pushback;
  assert.ok(pb.length >= 2);
  const quote = pb[1].split(" ").slice(0, 8).join(" ");
  const r = runTool("edit_talking_points", { door_id: id, section: "pushback", op: "replace", line: quote, text: "Start with one case and see how it moves." }, ctx);
  assert.equal(r.ok, true, r.error);
  assert.equal(r.actions[0].index, 1);
  const none = runTool("edit_talking_points", { door_id: id, section: "pushback", op: "replace", text: "Start with one case and see how it moves." }, ctx);
  assert.match(none.error, /needs index, 0 to \d+ for pushback \(0: "/);
});

test("a stop's number on its day is not a rank: noScores keeps 'stop 2 of 6' (live replay: 'stop near the top of the 6')", () => {
  assert.equal(noScores("Hold Out is stop 2 of 6 that day, around 2:30 pm."), "Hold Out is stop 2 of 6 that day, around 2:30 pm.");
  assert.match(noScores("It ranks 7 of 55 on your list."), /near the top of your list|in the top half of your list/);
});
