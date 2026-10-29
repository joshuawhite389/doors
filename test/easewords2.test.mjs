// Judge pass 8 (#2, #4, #6): no rank number at the door, Sources that don't repeat the answer, one count for "how many
// places Qloo ranked", and a form field that says its doors leave the plan.
import { test } from "node:test";
import assert from "node:assert/strict";
import { stopModel } from "../public/lib/stopmodel.js";
import { sourceItems } from "../public/lib/agent-ui.js";
import { knownHint, mergeLists, KEEP_ON_ROUTE } from "../public/lib/pool.js";
import { funnel } from "../public/lib/insights.js";
import { answerByRules } from "../public/lib/agent-rules.js";
import { route } from "./helpers.mjs";
import { demoContext } from "./agent-fixture.mjs";

test("whyLine: the door's reason in words, never '#k of N'", async () => {
  const { plan } = await demoContext();
  const ids = plan.pool.ids;
  for (const [k, re] of [[0, /^Qloo's top pick of /], [4, /^One of Qloo's top picks of /], [30, /^Qloo picked it from /]]) {
    const m = stopModel({ plan, id: ids[k] });
    assert.match(m.whyLine, re);
    assert.doesNotMatch(m.whyLine, /#\d|\d\.\d/);
  }
});

test("sourceItems: a fact the answer says, and Qloo's scores, show as their source's name only; no decimals", async () => {
  const { ctx } = await demoContext({ current: "first" });
  const r = answerByRules([{ role: "user", text: "why is this one first?" }], ctx);
  const items = sourceItems({ text: r.reply, facts: r.facts });
  assert.ok(items.length > 0);
  for (const f of items) if (r.reply.includes(f.text)) assert.fail(`Sources repeat the answer: ${f.text}`);
  assert.ok(items.every((f) => !/\b0\.\d\d/.test(f.text)), items.map((f) => f.text).join(" | "));
  assert.ok(items.some((f) => f.short && /^Qloo, /.test(f.text)));
});

test("knownHint: one drinker says the count Why these doors leads with, then the bars and restaurants", () => {
  const austin = route("athletic-brewing-austin");
  const r = mergeLists([austin]);
  const f = funnel(austin);
  const h = knownHint({ routes: [austin], r, kinds: 40, cityName: "Austin" });
  assert.ok(f.ranked > r.ids.length);
  assert.match(h, new RegExp(`^Qloo ranked ${f.ranked} places in Austin for your drinker; ${r.ids.length} are bars and restaurants, and 40 are the door types you pitch\\.`));
  assert.match(h, /Doors skips them/);
  assert.ok(h.endsWith(KEEP_ON_ROUTE));
});
