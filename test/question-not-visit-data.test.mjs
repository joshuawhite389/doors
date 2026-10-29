// The rules chat half of question-not-visit.test.mjs: a question about the current door logs no visit. It reads the
// demo's plan (agent-fixture.mjs → public/data), so the public repo skips it (scripts/test.mjs NEEDS_DATA).
import { test } from "node:test";
import assert from "node:assert/strict";
import { answerByRules } from "../public/lib/agent-rules.js";
import { demoContext } from "./agent-fixture.mjs";
import { QUESTIONS } from "./question-strings.mjs";

test("rules chat: a question about the current door logs no visit and marks nothing", async () => {
  const { ctx } = await demoContext({ current: "first" });
  for (const q of QUESTIONS) {
    const r = answerByRules([{ role: "user", text: q }], ctx, { now: `${ctx.today}T${ctx.now}` });
    assert.ok(!(r.tools ?? []).some((t) => t.name === "log_visit"), q);
    assert.ok(!(r.actions ?? []).some((a) => a.type === "outcome" || a.type === "status"), q);
  }
  const ok = answerByRules([{ role: "user", text: "done, liked it, come back Thursday at 3" }], ctx, { now: `${ctx.today}T${ctx.now}` });
  assert.ok((ok.tools ?? []).some((t) => t.name === "log_visit" && t.ok), "a report still logs");
});


// Jard's phone test (2026-10-22): with no model, a coaching question got the help text. The rules answer it from the
// stop's own talking points (the matching pushback and reply, the who-decides question, the ask), with sources.
test("rules chat: coaching questions are answered from the stop's talking points, with sources; help only when unmatched", async () => {
  const { ctx } = await demoContext({ current: "first" });
  const say = (q) => answerByRules([{ role: "user", text: q }], ctx, { now: `${ctx.today}T${ctx.now}` });
  const t = ctx.doors[ctx.current].talk;
  const HELP = /^I can explain why a door ranks/;
  for (const q of ["what should I say if the manager tells me to come back next week", "I'm wondering what I should say if they tell me to wait for the owner to call back next week", "What if the manager says come back later"]) {
    const r = say(q);
    assert.doesNotMatch(r.reply, HELP, q);
    assert.ok(r.reply.includes(t.questions.find((x) => /who decides/i.test(x))), q);
    assert.ok(r.facts.length >= 1 && r.facts.every((f) => f.source?.label), q);
  }
  const pushy = say("how do I follow up without being pushy");
  assert.match(pushy.reply, /drafted message/);
  assert.match(pushy.reply, new RegExp(t.ask));
  const room = say("what do I say if they don't have room");
  const k = t.objections.findIndex((o) => /room/i.test(o));
  assert.ok(room.reply.includes(t.objections[k]) && room.reply.includes(t.pushback[k]), room.reply);
  assert.equal(room.facts[0].source.field, "talk.pushback");
  assert.match(say("what do I say when they're not interested").reply, /don't push/);
  // judge pass 4 (#4): the rep's price and the trial, never Doors' internal "no price line"
  assert.match(say("what if they say it's too expensive").reply, /say your price plainly: \$38 a case of 24\. .*trial/);
  const named = say("any tips for Nomadic?");
  assert.match(named.reply, /^At Nomadic Beerworks, open with/);
  for (const q of ["purple monkey dishwasher", "hello"]) assert.match(say(q).reply, HELP, q);
});
