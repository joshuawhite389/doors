// WHY-VIZ-SPEC §4.5 (lane 2): the thread model on the demo bake (Maya · Athletic Brewing · Austin), its words, the
// Doors Agent's context and rules-path answer. Golden numbers: Nomadic Beerworks (the plan's #1) shares its crowd with
// 9 doors, 5 on the plan, Growler Express #3 on Your list, 3 big names; the plan's doors fall into 3 threads. No fix
// outside the table; every sentence number comes from the model; the layout is deterministic and stable. No network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { demoContext } from "./agent-fixture.mjs";
import { route, city } from "./helpers.mjs";
import { sieve } from "../public/lib/sieve.js";
import { threadModel, threadOf, threadAsk, threadAnswer, sisterStatus, fixFor, openDays, FIX_ROWS, layoutOf, MAX_NODES } from "../public/lib/whyviz/thread.js";
import { threadWords, plain } from "../public/lib/whyviz/words.js";
import { changeText } from "../public/lib/whatif.js";

const austin = route("athletic-brewing-austin"), c = city("austin");
let cache = null;
async function demo() {
  if (cache) return cache;
  const { plan } = await demoContext();
  const sv = sieve({ route: austin, plan, profile: plan.profile, city: c });
  return (cache = { plan, sv, m: threadModel({ sv, plan, city: c, route: austin, profile: plan.profile }) });
}
const FIX_TEXT = FIX_ROWS.flatMap((r) => [r.text({ open: ["Monday"], day: "Tuesday", type: "bars" }), r.text({}), r.text({ type: "restaurants" })]).filter(Boolean);
const inTable = (text) => FIX_ROWS.some((r) => { const t = r.text({}); return t && (text === t || (r.key === "closed" && /^Add a day it's open and Doors will place it( \(open .*\))?\.$/.test(text)) || (r.key === "route" && /^Lock it to .* and Doors re-routes the rest around it\.$/.test(text)) || (r.key === "type" && /^Add .* to the door types you pitch\.$/.test(text))); });

test("thread: the demo bake's graph (golden), under 100 ms, the plan's #1 selected", async () => {
  const { m, plan } = await demo();
  assert.equal(m.planN, 22);
  assert.equal(m.byId.get(m.sel).name, "Nomadic Beerworks");
  assert.equal(m.byId.get(m.sel).rank, 1);
  assert.equal(m.threads, 3);
  assert.ok(m.nodes.length <= MAX_NODES && m.nodes.length >= 60, `nodes ${m.nodes.length}`);
  assert.ok(m.edges.length >= 100, `edges ${m.edges.length}`);
  assert.ok(m.nodes.every((n) => m.layout.has(n.id)));
  assert.ok(m.nodes.filter((n) => n.kind === "plan").length === 22);
  for (const n of m.nodes.filter((x) => x.kind === "plan")) assert.ok(plan.days.some((d) => d.stops.some((s) => s.id === n.id)), n.name);
  const t0 = performance.now();
  threadModel({ sv: cache.sv, plan, city: c, route: austin, profile: plan.profile });
  assert.ok(performance.now() - t0 < 100, "under 100 ms");
});

test("thread: Nomadic's thread: 9 doors, 5 on the plan, Growler Express #3 (no time left), 3 big names", async () => {
  const { m } = await demo();
  const rows = threadOf(m, m.sel, { cityName: "Austin" });
  assert.equal(rows.length, 9);
  assert.equal(rows.filter((r) => r.st.k === "plan").length, 5);
  const g = rows.find((r) => r.n.name === "Growler Express");
  assert.equal(g.n.kind, "list");
  assert.equal(g.n.rank, 3);
  assert.equal(g.st.k, "route");
  assert.equal(g.st.word, "#3 on Your list · no time left");
  assert.match(g.st.reason, /^Tuesday had no time left for it\.$/);
  assert.equal(g.st.fix.text, "Raise that day's cap or add a day.");
  const big = rows.filter((r) => r.n.kind === "big").map((r) => r.n.name).sort();
  assert.deepEqual(big, ["Austin Beerworks", "Still Austin Whiskey Co.", "Texas Keeper Cider"]);
  for (const r of rows.filter((x) => x.n.kind === "big")) assert.equal(r.st.fix.text, "Include the most popular doors to put it on, or come back once you have reorders.");
  // doors not on the plan come first, best rank first; then the plan's
  assert.equal(rows[0].n.name, "Growler Express");
  assert.ok(rows.slice(4).every((r) => r.st.k === "plan"));
});

test("thread: the sentence holds only the model's numbers and names", async () => {
  const { m } = await demo();
  const parts = threadWords(m);
  const s = plain(parts);
  assert.match(s, /^Qloo says the same crowd goes to Nomadic Beerworks and 9 other doors: /);
  assert.match(s, /Growler Express \(#3\) is on Your list/);
  assert.match(s, /Austin Beerworks, Still Austin Whiskey Co\. and Texas Keeper Cider are among the most popular doors\. Your plan's doors fall into 3 connected threads\. Click a door to work its thread\.$/);
  assert.deepEqual(parts.filter((p) => typeof p === "object").map((p) => p.t), ["Nomadic Beerworks", "Austin Beerworks, Still Austin Whiskey Co. and Texas Keeper Cider"]);
  assert.equal(parts.find((p) => typeof p === "object" && p.cls === "big").t, "Austin Beerworks, Still Austin Whiskey Co. and Texas Keeper Cider");
  for (const n of s.match(/\d+/g)) assert.ok([9, 3, 1].includes(+n), `number ${n} from the model`); // 9 doors, #3, 3 threads, "and 1 more" (5 on the plan, 4 named)
  // another door: the words still parse
  for (const n of m.nodes.filter((x) => x.kind === "plan")) assert.match(plain(threadWords(m, n.id)), /^Qloo (says|lists)/);
});

test("thread: the agent's context and the rules answer (the mock's shape), no fix outside the table", async () => {
  const { m } = await demo();
  const ask = threadAsk(m, m.sel, { cityName: "Austin" });
  assert.equal(ask.question, "Why aren't these on my plan?");
  assert.equal(ask.selected.name, "Nomadic Beerworks");
  assert.equal(ask.doors.length, 4);
  assert.equal(ask.onPlan.length, 5);
  for (const d of ask.doors) {
    assert.ok(d.name && d.code && d.status && d.reason, d.name);
    assert.ok(inTable(d.fix.text), `fix in the table: ${d.fix.text}`);
  }
  const a = threadAnswer(m, m.sel, { cityName: "Austin" });
  assert.equal(a.by, "rules");
  assert.equal(a.head, "4 of the 9 doors that share Nomadic Beerworks's crowd aren't on your plan. Each one's reason, and what would change it:");
  assert.equal(a.lines[0].head, "Growler Express (#3 on Your list)");
  assert.equal(a.lines[0].reason, "Tuesday had no time left for it.");
  assert.equal(a.lines[0].fix.text, "Raise that day's cap or add a day.");
  assert.equal(a.lines[1].reason, "One of Austin's most popular doors."); // round 3: no "Popularity 0.99"
  assert.equal(a.pick.name, "Growler Express");
  assert.equal(a.pick.text, "My pick: Growler Express first. #3 for your drinker, almost unknown, the same crowd as Nomadic Beerworks. Raise that day's cap or add a day.");
  assert.equal(a.text.split("\n").length, 6);
  // every door on every thread: a fix from the table or none (status)
  for (const n of m.nodes) for (const { st } of threadOf(m, n.id, { cityName: "Austin" })) if (st.fix) assert.ok(inTable(st.fix.text), st.fix.text);
  // nothing to fix: a thread whose doors are all on the plan (or added)
  const all = threadAnswer(m, m.sel, { cityName: "Austin", added: ask.doors.map((d) => d.id) });
  assert.equal(all.text, "Every door that shares Nomadic Beerworks's crowd is already on your plan. Nothing to fix here.");
  assert.deepEqual(all.lines, []);
});

test("thread: the fix table: each reason code maps to one fix; open days read from Qloo's hours", () => {
  assert.equal(fixFor("full").text, "Raise that day's cap or add a day.");
  assert.equal(fixFor("nearer", { day: "Wednesday" }).text, "Lock it to Wednesday and Doors re-routes the rest around it.");
  assert.equal(fixFor("opens-after").text, "Extend that day into the evening and it fits.");
  assert.equal(fixFor("closed", { open: ["Friday", "Saturday"] }).text, "Add a day it's open and Doors will place it (open Friday and Saturday).");
  assert.equal(fixFor("status").text, "");
  assert.equal(fixFor("status").act, null);
  assert.equal(fixFor("famous").act, "famous");
  assert.equal(fixFor("restaurants", { type: "restaurants" }).text, "Add restaurants to the door types you pitch.");
  assert.equal(fixFor("nowhere").text, "Add it by name with + Add a door.");
  assert.equal(fixFor("something-new").key, "byname"); // an unknown code never invents a fix
  const hours = { monday: [{ opens: null, closed: true, closes: null }], tuesday: [{ opens: "T11:00:00", closed: false, closes: "T21:00:00" }], saturday: [{ opens: "T12:00:00", closed: false, closes: "T02:00:00" }] };
  assert.deepEqual(openDays(hours), ["Tuesday", "Saturday"]);
  assert.deepEqual(openDays(null), []);
  // every status kind has its words
  const sts = ["plan", "big", "list", "room", "other"].map((kind) => sisterStatus({ id: "x", name: "X", kind, rank: kind === "list" ? 4 : null, dayName: "Tuesday", stop: 2, fate: kind === "list" ? "route" : null, code: kind === "list" ? "detour" : null, reason: kind === "list" ? "it adds 14 min of driving to Tuesday" : null, reasonDay: "Tuesday", pop: 0.95, genre: "Brewery", type: "breweries", pitched: false, hours: null }, { cityName: "Austin" }));
  assert.deepEqual(sts.map((s) => s.k), ["plan", "big", "route", "room", "other"]);
  assert.equal(sts[2].word, "#4 on Your list · didn't fit a day's route");
  assert.equal(sts[2].fix.text, "Lock it to Tuesday and Doors re-routes the rest around it.");
  assert.equal(sts[3].word, "Ranked · a brewery, a type you don't pitch");
  assert.equal(sts[3].fix.text, "Add breweries to the door types you pitch.");
  assert.equal(sisterStatus({ id: "x", kind: "list" }, { added: ["x"] }).k, "added");
});

test("thread: the layout is deterministic, stays in 0..1, and a seed keeps shared nodes where they were", async () => {
  const { m, plan, sv } = await demo();
  const again = threadModel({ sv, plan, city: c, route: austin, profile: plan.profile });
  for (const n of m.nodes) { const a = m.layout.get(n.id), b = again.layout.get(n.id); assert.ok(a.x >= 0 && a.x <= 1 && a.y >= 0 && a.y <= 1); assert.deepEqual(a, b); }
  // the same graph seeded from its own layout barely moves
  const seeded = layoutOf(m.nodes, m.edges, m.layout);
  const drift = m.nodes.map((n) => Math.hypot(seeded.get(n.id).x - m.layout.get(n.id).x, seeded.get(n.id).y - m.layout.get(n.id).y));
  assert.ok(Math.max(...drift) < 0.25, `max drift ${Math.max(...drift).toFixed(3)}`);
  assert.ok(drift.reduce((a, b) => a + b, 0) / drift.length < 0.06, "mean drift");
  // one node, no nodes
  assert.deepEqual([...layoutOf([{ id: "a", kind: "plan" }], []).values()], [{ x: 0.5, y: 0.5 }]);
  assert.equal(layoutOf([], []).size, 0);
});

test("thread: a multi-add change has its words (whatif)", () => {
  const names = { a: "Growler Express", b: "Hi Hat Public House", c: "El Primo" };
  assert.equal(changeText({ kind: "add", ids: ["a", "b", "c"] }, { names }), "Add 3 doors to my plan: Growler Express, Hi Hat Public House and El Primo");
  assert.equal(changeText({ kind: "add", ids: ["a"] }, { names }), "Add Growler Express to my plan");
  assert.equal(changeText({ kind: "add", id: "a" }, { names }), "Add Growler Express to my plan");
});
