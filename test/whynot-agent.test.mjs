// Jard 10-23: "why is my highest ranked room not on any of my routes?" Ask Doors blamed the popularity cap (the room
// was 0.51) while the Why view said it stopped at "Fits a day's route?". The agent now reads the plan's own why-not
// (lib/sieve.js placeFate + gateLine, the Why card's words) and states the cap only as it applies. No network.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.js";
import { cleanContext, promptOf, cleanReply } from "../src/agent.js";
import { runTool, doorFacts } from "../public/lib/agent-tools.js";
import { answerByRules } from "../public/lib/agent-rules.js";
import { agentContext } from "../public/lib/agent-context.js";
import { sieve, gateLine } from "../public/lib/sieve.js";
import { scriptedSession } from "../src/llm.js";
import { route, city } from "./helpers.mjs";
import { demoContext } from "./agent-fixture.mjs";

const QUESTION = "why is my highest ranked room not on any of my routes?";
const austin = route("athletic-brewing-austin");
const WHY = "Wednesday has room for it only in place of a stop nearer its route";

// The demo plan with its #1 taken off its day by the planner's "nearer" reason, as on Jard's Higher Gravity card
async function offPlanTop() {
  const { plan: p } = await demoContext();
  const top = Object.entries(p.venues).filter(([id]) => p.pool.ids.includes(id)).map(([id]) => id)[0] ?? p.pool.ids[0];
  const id = p.pool.ids[0];
  assert.equal(id, top);
  const days = p.days.map((d) => ({ ...d, stops: d.stops.filter((s) => s.id !== id) }));
  const plan = { ...p, days, reasons: { ...p.reasons, [id]: { code: "nearer", text: WHY, date: days[1].date } } };
  const ctx = agentContext({ plan, dayIndex: 0, city: city("austin"), routes: [austin], now: new Date(`${plan.days[0].date}T14:20:00`) });
  return { plan, ctx, id };
}

test("whynot: the plan fact is the Why view's card line, word for word", async () => {
  const { plan, ctx, id } = await offPlanTop();
  const d = sieve({ route: austin, plan, profile: plan.profile, city: city("austin") }).dots.find((x) => x.id === id);
  const g = gateLine(d);
  assert.equal(`${g.head} ${g.reason}.`, `Stopped at “Fits a day's route?”: ${WHY}.`); // what the Why card shows
  const f = doorFacts(ctx, id).find((x) => x.source.field === "plan");
  assert.equal(f.text, `Not on any day of your plan. ${g.head} ${g.reason}.`);
  // every door in the context that is off the plan: the same words as its sieve dot
  const sv = sieve({ route: austin, plan, profile: plan.profile, city: city("austin") });
  let n = 0;
  for (const [did, v] of Object.entries(ctx.doors)) {
    const dot = sv.dots.find((x) => x.id === did);
    if (!dot || dot.fate === "plan") continue;
    const gl = gateLine(dot);
    assert.deepEqual({ head: v.plan.head, reason: v.plan.reason }, gl, v.name);
    n++;
  }
  assert.ok(n >= 3, `off-plan doors checked: ${n}`);
});

test("whynot: a room under the cap never reads as left out for its popularity; one above says so", async () => {
  const { ctx } = await demoContext();
  const [id, v] = Object.entries(ctx.doors).find(([, x]) => x.popularity < 0.9);
  const pop = doorFacts(ctx, id).find((f) => f.source.field === "popularity").text;
  assert.doesNotMatch(pop, /leaves out|left out|above/i);
  // round 3: in words, no decimal (Jard 10-23)
  assert.match(pop, /^Qloo popularity: (well known|known locally|almost unknown)\. That's under Doors' cap on the most popular doors, so the cap doesn't keep it off your plan\.$/);
  const hot = { ...ctx, doors: { ...ctx.doors, [id]: { ...v, popularity: 0.95 } } };
  assert.match(doorFacts(hot, id).find((f) => f.source.field === "popularity").text, /^Qloo popularity: one of the city's most popular doors\. That's above Doors' cap on the most popular doors/);
});

test("whynot: compare_doors carries the plan fact too; a door of the day keeps its order fact instead", async () => {
  const { ctx, id } = await offPlanTop();
  const on = ctx.day.stops[0].id;
  const r = runTool("compare_doors", { door_ids: [id, on] }, ctx);
  assert.ok(r.ok);
  assert.ok(r.facts.some((f) => f.source.door === id && f.source.field === "plan" && f.text.includes(WHY)));
  assert.ok(!doorFacts(ctx, on).some((f) => f.source.field === "plan"));
  assert.ok(doorFacts(ctx, on).some((f) => f.source.field === "order"));
});

test("whynot: the rules path answers Jard's question with the planner's reason, not the cap", async () => {
  const { ctx, id } = await offPlanTop();
  const r = answerByRules([{ role: "user", text: QUESTION }], ctx);
  const v = ctx.doors[id];
  assert.equal(r.reply, `Your highest-ranked door is ${v.name}, #1 of ${v.N} on Your list. Not on any day of your plan. Stopped at “Fits a day's route?”: ${WHY}.`);
  assert.doesNotMatch(r.reply, /popularity|famous|cap\b|0\.90\b/i);
  // the same about a door on the plan, and the other wordings
  const { ctx: c2 } = await demoContext();
  const top = Object.entries(c2.doors).find(([, x]) => x.rank === 1);
  assert.match(answerByRules([{ role: "user", text: "Why isn't my #1 on the plan?" }], c2).reply, new RegExp(`${top[1].name}.*On your plan: \\w+day, stop \\d+ of \\d+|Stop \\d+ of \\d+`));
  const named = Object.entries(c2.doors).find(([, x]) => x.plan && !x.plan.on);
  assert.match(answerByRules([{ role: "user", text: `why is ${named[1].name} not on any of my days?` }], c2).reply, new RegExp(`Not on any day of your plan\\. ${named[1].plan.head.replace(/[?”“]/g, ".")}`));
});

test("whynot: the Worker keeps the plan fate (head rebuilt, never the client's) and shows on_plan", async () => {
  const { ctx, id } = await offPlanTop();
  const c = cleanContext(ctx);
  assert.deepEqual(c.doors[id].plan, { on: false, fate: "route", head: "Stopped at “Fits a day's route?”:", reason: WHY });
  const forged = cleanContext({ ...ctx, doors: { ...ctx.doors, [id]: { ...ctx.doors[id], plan: { on: false, fate: "famous", head: "Too famous:", reason: "x" } } } });
  assert.equal(forged.doors[id].plan.head, "Stopped at “Under the popularity cap?”:");
  assert.equal(cleanContext({ ...ctx, doors: { [id]: { ...ctx.doors[id], plan: { on: false, fate: "nope", reason: "x" } } } }).doors[id].plan, null);
  assert.match(promptOf([{ role: "user", text: QUESTION }], c), new RegExp(`"name":"${ctx.doors[id].name}","kind":"[^"]*","rank":1,"of":\\d+,"popularity":"[^"]*","on_plan":false,"why_not":"Stopped at`)); // round 3: kind, of, popularity and why_not ride along
});

test("whynot: the model path: explain_door hands the model the planner's reason and no cap wording", async () => {
  const { ctx, id } = await offPlanTop();
  const seen = [];
  const session = scriptedSession([{ calls: [{ id: "1", name: "explain_door", args: { door_id: id } }] }, { text: `It isn't on any day: ${WHY}.` }])();
  const env = { AGENT_SESSION: (opts) => (seen.push(opts), { ...session, addResults: (r) => (seen.push(r), session.addResults(r)) }) };
  const post = new Request("http://localhost:8792/api/agent", { method: "POST", headers: { origin: "http://localhost:8792", "content-type": "application/json", "cf-connecting-ip": "10.9.9.9" }, body: JSON.stringify({ v: 1, messages: [{ role: "user", text: QUESTION }], context: ctx }) });
  const out = await (await worker.fetch(post, env)).json();
  const fed = JSON.stringify(seen);
  assert.ok(fed.includes(`Stopped at “Fits a day's route?”: ${WHY}`), "the model reads the Why view's reason");
  assert.doesNotMatch(fed, /leaves out rooms above/);
  assert.match(fed, /the plan fact explain_door returns/); // the system rule
  assert.match(out.reply, new RegExp(WHY));
});

test("whynot: a number at a sentence's end survives the reply cleaner (live: 'an affinity score of 0.')", async () => {
  const { ctx, id } = await offPlanTop();
  const facts = doorFacts(ctx, id);
  const aff = ctx.doors[id].affinity.toFixed(2);
  // round 3 (Jard 10-23: decimals are confusing): asked or not, the score clause goes; the rest of the sentence stays whole
  const out = cleanReply(`It is ranked #1 with an affinity score of ${aff}. ${WHY}.`, cleanContext(ctx), { facts, words: `${QUESTION} What's its affinity score?` });
  assert.doesNotMatch(out, /0\.\d|affinity score of 0\.$/);
  assert.match(out, new RegExp(`${WHY}\\.$`));
});
