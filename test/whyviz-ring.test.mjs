// WHY-VIZ-SPEC §4.4 (lane 2): the day ring's model on the demo bake. The outer band's counts equal the tag families
// on the plan's doors; every Tuesday door's arc is its hours; the window wedge is the day's; a closed door is listed,
// not drawn; the sentence holds only the model's numbers. No network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { demoContext } from "./agent-fixture.mjs";
import { parseHours, tagFamilies } from "../public/lib/core.js";
import { planIds } from "../public/lib/insights.js";
import { ringModel, PARTS, clock } from "../public/lib/whyviz/ring.js";
import { ringWords, plain } from "../public/lib/whyviz/words.js";

let cache = null;
const demo = async () => (cache ??= await demoContext());

test("ring: the demo bake (golden): evening 22 of 22, late night 14, morning 4; Tuesday 1 pm–6 pm: 5 open at 1 pm, 5 open later, none closed", async () => {
  const { plan } = await demo();
  const m = ringModel({ plan, dayIndex: 0 });
  assert.equal(m.n, 22);
  const by = Object.fromEntries(m.parts.map((p) => [p.key, p.n]));
  assert.deepEqual(by, { Morning: 4, Midday: 2, Afternoon: 20, Evening: 22, "Late night": 14 });
  assert.deepEqual(m.days.map((d) => [d.label, d.n]), [["Tue", 10], ["Wed", 6], ["Thu", 6]]);
  assert.equal(m.day.day, "tuesday");
  assert.equal(m.day.label, "Tuesday 1 pm–6 pm");
  assert.equal(m.arcs.length, 10);
  assert.equal(m.open0, 5);
  assert.equal(m.later, 5);
  assert.equal(m.closedN, 0);
  assert.equal(m.unknownN, 0);
  assert.equal(m.missedN, 0);
  // every arc is that door's hours that day, and its open minutes are the overlap with the window
  for (const a of m.arcs) {
    const p = parseHours(plan.venues[a.id].hours);
    const spans = p.days.tuesday.spans;
    assert.deepEqual(a.spans.filter((s) => s.from >= 0 && !(s.from === 0 && spans.every((x) => x.from !== 0))), spans, a.name);
    const open = spans.reduce((t, x) => t + Math.max(0, Math.min(1080, x.to) - Math.max(780, x.from)), 0);
    assert.equal(a.open, open, a.name);
    assert.equal(a.state, spans.some((x) => x.from <= 780) ? "open0" : "later", a.name);
  }
  // the list: open at 1 pm first, then by opening time
  assert.equal(m.list[0].word, "open at 1 pm");
  assert.match(m.list.at(-1).word, /^opens 4 pm$/);
  assert.deepEqual(m.list.slice(5).map((x) => x.word), ["opens 3 pm", "opens 3 pm", "opens 3:30 pm", "opens 4 pm", "opens 4 pm"]);
  // the outer band's counts are the tag families on the plan's doors
  const cnt = {};
  for (const id of planIds(plan)) for (const t of plan.venues[id].tags?.tod ?? tagFamilies(plan.venues[id].tags)?.tod ?? []) cnt[t] = (cnt[t] ?? 0) + 1;
  for (const p of PARTS) assert.equal(m.parts.find((x) => x.key === p.key).n, cnt[p.key] ?? 0);
});

test("ring: a day picked, a door closed that day, hours unknown, past midnight", async () => {
  const { plan } = await demo();
  const wed = ringModel({ plan, dayIndex: 1 });
  assert.equal(wed.day.day, "wednesday");
  assert.equal(wed.arcs.length, 6);
  assert.equal(wed.day.label, "Wednesday 2 pm–5 pm");
  // a door closed on Tuesday: listed, not drawn (state closed); one with no hours: unknown; a 4 pm–2 am door spills
  const id = plan.days[0].stops[0].id;
  const closedPlan = { ...plan, venues: { ...plan.venues, [id]: { ...plan.venues[id], hours: { ...plan.venues[id].hours, tuesday: [{ opens: null, closed: true, closes: null }] } } } };
  const c = ringModel({ plan: closedPlan, dayIndex: 0 });
  assert.equal(c.closedN, 1);
  assert.equal(c.arcs.find((a) => a.id === id).state, "closed");
  assert.equal(c.list.at(-1).word, "closed Tuesday");
  assert.match(plain(ringWords(c)), /, and 1 is closed on Tuesday\.$/);
  const unknownPlan = { ...plan, venues: { ...plan.venues, [id]: { ...plan.venues[id], hours: null } } };
  const u = ringModel({ plan: unknownPlan, dayIndex: 0 });
  assert.equal(u.unknownN, 1);
  assert.match(plain(ringWords(u)), /1 has no hours Doors could verify\.$/);
  const late = ringModel({ plan, dayIndex: 0 }).arcs.find((a) => a.name === "Latchkey");
  assert.deepEqual(late.spans, [{ from: 0, to: 120 }, { from: 960, to: 1560 }]); // Monday's 2 am close spills into Tuesday's small hours
  assert.equal(late.open, 120);
  // no day: the tags alone
  const none = ringModel({ plan: { ...plan, days: [] } });
  assert.equal(none.day, null);
  assert.equal(none.n, 0);
  assert.equal(plain(ringWords(none)), "No doors on a day yet.");
  assert.equal(plain(ringWords({ ...ringModel({ plan, dayIndex: 0 }), day: null })), "Qloo tags 22 of your 22 doors with the evening and 14 with late night; 4 with the morning.");
  assert.equal(clock(780), "1 pm");
  assert.equal(clock(930), "3:30 pm");
  assert.equal(clock(1560), "2 am");
});

test("ring: the sentence (spec §4.4) from the model only", async () => {
  const { plan } = await demo();
  const m = ringModel({ plan, dayIndex: 0 });
  const parts = ringWords(m), s = plain(parts);
  assert.equal(s, "Qloo tags 22 of your 22 doors with the evening and 14 with late night; 4 with the morning. You're out Tuesday 1 pm–6 pm, before most of them fill. 5 of Tuesday's 10 doors are already open at 1 pm; 5 open later in your window.");
  assert.deepEqual(parts.filter((p) => typeof p === "object").map((p) => p.t), ["You're out Tuesday 1 pm–6 pm, before most of them fill."]);
  for (const n of s.match(/\d+/g)) assert.ok([22, 14, 4, 1, 6, 5, 10].includes(+n), `number ${n}`);
});
