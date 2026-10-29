// R9 polish (docs/JUDGE-WALKTHROUGH.md 2c, 3): Qloo's affinity beside every rank, the rules path's "compare", and a
// "why" answer that leads with the affinity, not the rank alone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { affinityGap } from "../public/lib/core.js";
import { rankAffinity } from "../public/lib/planview.js";
import { answerByRules, doorsNamed } from "../public/lib/agent-rules.js";
import { route } from "./helpers.mjs";
import { demoContext } from "./agent-fixture.mjs";

// round 3 (Jard 10-23: decimals are "super confusing"): the gap to #1 in words, never Qloo's number
test("affinityGap: how close to #1 in words (level under 0.005, near-level within NEAR_LEVEL, none on a merged list)", () => {
  assert.equal(affinityGap({ affinity: 0.9023, top: 0.9121, rank: 49 }), "near-level with #1");
  assert.equal(affinityGap({ affinity: 0.85, top: 0.9121, rank: 49 }), "");
  assert.equal(affinityGap({ affinity: 0.9121, top: 0.9121, rank: 1 }), "the closest match");
  assert.equal(affinityGap({ affinity: 0.9101, top: 0.9121, rank: 7 }), "level with #1");
  assert.equal(affinityGap({ affinity: 0.9, top: 0.92, rank: 3, merged: true }), "");
  assert.equal(affinityGap({ affinity: null, top: 0.9, rank: 3 }), "");
});

test("rankAffinity: a plan row's affinity from the drinker's list, against the pool's #1", async () => {
  const { plan } = await demoContext();
  const austin = route("athletic-brewing-austin");
  const [one, two] = plan.pool.ids;
  assert.equal(rankAffinity(plan, [austin], one), "the closest match");
  assert.match(rankAffinity(plan, [austin], two), /^((near-)?level with #1)?$/);
  assert.equal(rankAffinity(plan, [austin], "not-a-door"), "");
});

test("rules compare: two named doors → rank, affinity and the gap for each, plus their stops; facts sourced", async () => {
  const { ctx } = await demoContext({ current: "first" });
  const name = (r) => Object.values(ctx.doors).find((v) => v.rank === r).name;
  const r = answerByRules([{ role: "user", text: `Compare ${name(1)} and ${name(2)}` }], ctx);
  assert.equal(r.tools[0].name, "compare_doors");
  // judge pass 8 #2: ranks and the gap in words; the affinities only when the rep asks for numbers
  assert.match(r.reply, new RegExp(`${name(1)}: #1 of \\d+\\.`));
  assert.doesNotMatch(r.reply, /affinit|0\.\d\d/);
  const rn = answerByRules([{ role: "user", text: `Compare the affinity scores of ${name(1)} and ${name(2)}` }], ctx);
  // round 3: asked for the scores, it still gives ranks and words, no decimal
  assert.match(rn.reply, new RegExp(`${name(1)}: #1 of \\d+\\.`));
  assert.match(rn.reply, new RegExp(`${name(2)}: #2 of \\d+\\.`));
  assert.doesNotMatch(rn.reply, /0\.\d\d/);
  assert.match(r.reply, /closer match by 0\.\d\d|near-equal|level/);
  assert.match(r.reply, /is stop \d+/);
  assert.ok(r.facts.some((f) => f.source.field === "affinity"));
  assert.deepEqual(doorsNamed(`is ${name(2)} or ${name(1)} better?`, ctx).map((id) => ctx.doors[id].rank), [2, 1]);
  assert.match(answerByRules([{ role: "user", text: "help" }], ctx).reply, /compare two doors/);
});

test("rules why: rank, no affinity decimal unless asked (judge pass 8 #2); near-equal to #1 said in words", async () => {
  const { ctx } = await demoContext({ current: "first" });
  const r = answerByRules([{ role: "user", text: "why is this one first?" }], ctx);
  assert.match(r.reply, /Stop 1 of/);
  assert.match(r.reply, /#\d+ of \d+/);
  assert.doesNotMatch(r.reply, /affinit|0\.\d\d/);
  const rn = answerByRules([{ role: "user", text: "why is this one first? what's its affinity score?" }], ctx);
  assert.doesNotMatch(rn.reply, /0\.\d\d/); // round 3: even when asked, no decimal (Jard 10-23)
  // a door within NEAR_LEVEL of #1 says so in plain words, about its crowd (Jard 10-24 web review: no ranking talk)
  const top = Object.values(ctx.doors).find((v) => v.rank === 1);
  const near = Object.entries(ctx.doors).find(([, v]) => v.rank > 1 && typeof v.affinity === "number" && top.affinity - v.affinity < 0.02 && top.affinity - v.affinity >= 0.005);
  if (near) assert.match(answerByRules([{ role: "user", text: `why is ${near[1].name} ranked there?` }], ctx).reply, new RegExp(`Its crowd matches your drinker almost as closely as ${top.name}, your best match\\.`));
});

test("judge pass 2 (5): 'why isn't my #1 first?' names the trade the plan view measured, and only the sources that bear on it", async () => {
  const { ctx } = await demoContext();
  const id = Object.keys(ctx.doors).find((x) => ctx.doors[x].rank === 1);
  const k = ctx.day.stops.findIndex((s) => s.id === id);
  assert.ok(k > 0, "the demo's #1 is not Tuesday's first stop");
  ctx.day.trade = { id, source: "ors", was: { min: 42, mi: 16.7, n: 10 }, then: { min: 44, mi: 18.9, n: 10 }, dropped: [] };
  const r = answerByRules([{ role: "user", text: `${ctx.doors[id].name} is my #1 match. Why isn't it my first stop?` }], ctx);
  assert.match(r.reply, new RegExp(`Stop ${k + 1} of \\d+ .*, between .+ and .+, open till`));
  assert.match(r.reply, /Putting it first adds 2 min of driving \(16\.7 → 18\.9 road mi for the day\), for the same 10 doors/);
  assert.match(r.reply, /It is #1 of \d+ on Your list\./); // judge pass 8 #2: no "(affinity 0.91)"
  assert.deepEqual(r.facts.map((f) => f.source.field), ["order", "trade", "rank", "affinity"]);
  ctx.day.trade = { ...ctx.day.trade, source: "estimate", then: { min: 50, mi: 21.7, n: 9 }, dropped: ["The Drafting Room"] };
  const r2 = answerByRules([{ role: "user", text: `Why isn't ${ctx.doors[id].name} first?` }], ctx);
  // judge pass 10 #3: a door drops, so no minutes (they compare a 10-door day with a 9-door one): the miles and the door
  assert.match(r2.reply, /Putting it first changes the day's route \(16\.7 → 21\.7 mi, estimated\), and The Drafting Room comes off the day: in the new order there's no time to reach it before your day ends or it closes/);
  assert.doesNotMatch(r2.reply, /\bmin of driving\b/);
  ctx.day.trade = { ...ctx.day.trade, then: { min: 43, mi: 18.9, n: 9 }, source: "ors" }; // the judge's case: "adds 1 min" while a door drops
  const r3 = answerByRules([{ role: "user", text: `Why isn't ${ctx.doors[id].name} first?` }], ctx);
  assert.match(r3.reply, /Putting it first changes the day's route \(16\.7 → 18\.9 road mi\), and The Drafting Room comes off the day/);
  assert.doesNotMatch(r3.reply, /adds 1 min/);
});

test("judge pass 2 (14): a rank leads with the tier its affinity supports, so #58 of a flat list reads as near-level", async () => {
  const { matchTier } = await import("../public/lib/core.js");
  assert.equal(matchTier({ affinity: 0.912, top: 0.912, rank: 1 }), "#1");
  assert.equal(matchTier({ affinity: 0.913, top: 0.93, rank: 58 }), "near-level with #1");
  assert.equal(matchTier({ affinity: 0.86, top: 0.912, rank: 9 }), "top 10");
  assert.equal(matchTier({ affinity: 0.83, top: 0.912, rank: 49 }), "");
  assert.equal(matchTier({ affinity: 0.913, top: 0.93, rank: 58, merged: true }), "");
  const { plan } = await demoContext();
  const { rankLine } = await import("../public/lib/planview.js");
  const r = [route("athletic-brewing-austin")];
  // Jard 10-23: a row says its rank in plain words, the tier as "nearly tied with #1", no affinity decimals
  assert.equal(rankLine(plan, r, plan.pool.ids[0]), "#1 of 55 on Your list");
  assert.equal(rankLine(plan, r, plan.pool.ids[1]), "#2 of 55 on Your list · nearly tied with #1", "Pinthouse sits within 0.02 of #1");
  assert.equal(rankLine(plan, r, plan.pool.ids[48]), "#49 of 55 on Your list");
  assert.equal(rankLine(plan, r, plan.pool.ids[0], { who: "Athletic Brewing drinkers" }), "#1 of 55 on Your list for Athletic Brewing drinkers");
  for (const k of [0, 1, 8, 48]) assert.doesNotMatch(rankLine(plan, r, plan.pool.ids[k]), /affinity|below #1|near-level|\d\.\d/);
  const { rankAffinityShort } = await import("../public/lib/planview.js");
  assert.equal(rankAffinityShort(plan, r, plan.pool.ids[1]), "nearly tied with #1", "a map card says the tie too");
  assert.equal(rankAffinityShort(plan, r, plan.pool.ids[8]), "", "no 'top 10' beside a #9, no decimals");
});
