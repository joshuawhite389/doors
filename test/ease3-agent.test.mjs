// Ease audit pass 2, lane E3a (the Agent): the tour's chat stays the tour's, the starters name the door the rep is at or
// going to next, "I'm running late" is Start my day's Running late (not the capability list) when Doors' rules answer,
// and the Claude notice says when Claude is back in the rep's own time.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { starters, inLocalTime } from "../public/lib/agent-ui.js";
import { answerByRules, lateOf } from "../public/lib/agent-rules.js";
import { clearDemo, DEMO_PREFIX } from "../public/lib/demo-session.js";
import { keyOf } from "../public/ui/agent.js";
import { AGENT_NO_MODEL, AGENT_RESTING, CLAUDE_UNREAD, CLAUDE_SPENT, noScores, SYSTEM, AGENT_SYSTEM } from "../src/agent.js";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("#1 the tour's chat is kept under the tour's prefix: cleared with the tour, never in your own Tidewell · Austin plan", () => {
  const plan = { profile: { brand: "Tidewell" }, city: { key: "austin" } };
  const own = keyOf(plan);
  const tour = keyOf(plan, { demo: true });
  assert.notEqual(own, tour);
  assert.equal(own, "doors.v2.chat.Tidewell-austin");
  assert.ok(tour.startsWith(DEMO_PREFIX));
  const m = new Map([[own, "[mine]"], [tour, "[tour]"]]);
  const storage = { get length() { return m.size; }, key: (i) => [...m.keys()][i] ?? null, removeItem: (k) => m.delete(k) };
  clearDemo(storage);
  assert.deepEqual([...m.keys()], [own]);
  // the plan mounts the panel with its demo flag
  assert.match(read("public/ui/plan.js"), /mountAgent\(root, \{ demo: Boolean\(demo\) \}\)/);
});

const V = (n) => ({ name: n });
const plan = (extra = {}) => ({
  venues: { a: V("Meanwhile Brewing"), b: V("Pinthouse Brewing"), c: V("Lazarus"), d: V("Fora"), e: V("Lazy Bird") },
  days: [
    { date: "2026-10-27", stops: [{ id: "a" }, { id: "b" }, { id: "c" }] },
    { date: "2026-10-28", stops: [{ id: "d" }, { id: "e" }] },
  ],
  statuses: {},
  outcomes: {},
  ...extra,
});
const texts = (p, o) => starters(p, o).map((x) => x.text);

test("#2 starters: stop 1 with nothing logged → 'Why is X first?'", () => {
  assert.deepEqual(texts(plan()), ["Why is Meanwhile Brewing first?", "I'm running late", "Log a visit at Meanwhile Brewing: "]);
  // intuit pass 2 (M9): the button reads without the colon; the box keeps "Log a visit at X: " to finish
  assert.equal(starters(plan()).at(-1).label, "Log a visit at Meanwhile Brewing…");
});

test("#2 starters: stop 1 logged → the next door with nothing logged, and not 'first'", () => {
  const p = plan({ outcomes: { a: { result: "interested" } } });
  assert.deepEqual(texts(p), ["Why Pinthouse Brewing?", "I'm running late", "Log a visit at Pinthouse Brewing: "]);
  assert.deepEqual(texts(plan({ statuses: { a: "visited" } }))[0], "Why Pinthouse Brewing?");
});

test("#2 starters: the open door card (or drive mode's stop) is the door named", () => {
  assert.deepEqual(texts(plan(), { here: "c" }), ["Why Lazarus?", "I'm running late", "Log a visit at Lazarus: "]);
  assert.equal(texts(plan(), { here: "a" })[0], "Why is Meanwhile Brewing first?");
  assert.equal(texts(plan(), { here: "nope" })[0], "Why is Meanwhile Brewing first?"); // not a door on the plan: the next stop
});

test("#2 starters: another day's tab → that day's next door", () => {
  assert.equal(texts(plan(), { dayIndex: 1 })[0], "Why is Fora first?");
  assert.equal(texts(plan({ statuses: { d: "visited" } }), { dayIndex: 1 })[0], "Why Lazy Bird?");
  // a day all logged → the first day ahead with a door left
  const all = plan({ statuses: { a: "visited", b: "visited", c: "visited" } });
  assert.equal(texts(all, { dayIndex: 0 })[0], "Why is Fora first?");
  // past days are skipped
  const past = plan();
  past.days[0].past = true;
  assert.equal(texts(past)[0], "Why is Fora first?");
});

test("#2 starters: nothing ahead → the plain asks", () => {
  assert.deepEqual(texts({ days: [], venues: {} }), ["Why these doors?", "I'm running late", "Log a visit: "]);
  assert.deepEqual(texts(null), ["Why these doors?", "I'm running late", "Log a visit: "]);
});

test("#2 web and phone pass the open door and the selected day", () => {
  assert.match(read("public/ui/agent.js"), /starters\(S\.getPlan\(\), \{ here: m === "plan" \? null : current, dayIndex/);
  assert.match(read("app-mobile/src/components/ChatView.tsx"), /starters\(chat\.e\.plan, \{ here: c\.mode && c\.mode !== "plan" \? c\.current \?\? null : null, dayIndex: sel \}\)/);
});

test("#3 'running late' is recognised, with or without a time; 'open late' and 'later' are not", () => {
  const by = (t) => lateOf(t)?.by ?? null;
  assert.equal(by("I'm running late"), 0);
  assert.equal(by("im running 20 minutes late"), 20);
  assert.equal(by("running an hour behind"), 60);
  assert.equal(by("I'll be half an hour late"), 30);
  assert.equal(by("running about 1.5 hours late"), 90);
  assert.equal(by("gonna be like ten minutes late"), 10);
  assert.equal(by("we're behind schedule"), 0);
  for (const t of ["is Fora open late?", "how late does it stay open", "they said come back later", "talk to them later", "Why is Meanwhile Brewing first?",
    "running late, skip the next one", "I'm late, I have to finish by 5", "running behind, move Fora to Thursday"]) assert.equal(by(t), null, t);
});

const ctx = { doors: {}, day: { date: "2026-10-27", stops: [] }, windows: [], today: "2026-10-27", now: "13:10" };
const ask = (t) => answerByRules([{ role: "user", text: t }], ctx, { now: "2026-10-27T13:10" });

test("#3 the starter 'I'm running late' with Doors' rules: how late, with Start my day's picks (not the capability list)", () => {
  const r = ask("I'm running late");
  assert.equal(r.by, "rules");
  assert.equal(r.reply, "How late will you be? Pick one and Start my day shows which doors still fit.");
  assert.deepEqual(r.late, { picks: [15, 30, 60] });
  assert.deepEqual(r.actions, []);
});

test("#3 a time said → Start my day opens that late (the 'late' action)", () => {
  const r = ask("running 30 min late");
  assert.deepEqual(r.actions, [{ type: "late", by: 30 }]);
  assert.match(r.reply, /^Opening Start my day 30 min late: it shows which doors still fit/);
  assert.equal(ask("I'm an hour behind").actions[0].by, 60);
  assert.match(ask("I'm an hour behind").reply, /Start my day 1 hour late/);
});

test("#3 the panel: picks as buttons, the late action opens Start my day (web plan.js, drive.js; phone Ask, Drive)", () => {
  const agent = read("public/ui/agent.js");
  assert.match(agent, /data-agent="late"/);
  assert.match(agent, /a\.type === "late"/);
  assert.match(agent, /new CustomEvent\("doors:late"/);
  assert.match(read("public/ui/plan.js"), /addEventListener\("doors:late", onLate\)/);
  assert.match(read("public/ui/drive.js"), /addEventListener\("doors:late", onLate\)/);
  assert.match(read("public/ui/drive.js"), /openDrive\(\{ now, onClose = \(\) => \{\}, by = 0(, resume = false)? \}\)/);
  assert.match(read("app-mobile/src/agent.ts"), /a\.type === "late"/);
  assert.match(read("app-mobile/src/components/ChatView.tsx"), /chat-late-/);
  assert.match(read("app-mobile/src/screens/Ask.tsx"), /nav\.push\("drive", .*late: by/);
  assert.match(read("app-mobile/src/screens/Drive.tsx"), /params\?\.late/);
});

test("#3 the resting notes name today's screens: 'door cards and Log visit', not 'the stop panel and Done'", () => {
  for (const s of [AGENT_NO_MODEL, AGENT_RESTING]) {
    assert.match(s, /Your plan, door cards and Log visit still work\./);
    assert.doesNotMatch(s, /stop panel|\bDone\b/);
  }
});

test("#10a Claude's notices: back in the rep's own time, and no 'can't read today's spend'", () => {
  assert.doesNotMatch(CLAUDE_UNREAD, /spend|read/);
  const tz = process.env.TZ;
  try {
    process.env.TZ = "America/New_York";
    assert.equal(inLocalTime(CLAUDE_SPENT, new Date("2026-10-24T03:00:00Z")), "Claude's daily budget for Doors is used up; it's back at 8 pm.");
    process.env.TZ = "Asia/Kolkata";
    assert.equal(inLocalTime(CLAUDE_SPENT, new Date("2026-10-24T12:00:00Z")), "Claude's daily budget for Doors is used up; it's back at 5:30 am.");
    process.env.TZ = "UTC";
    assert.equal(inLocalTime(CLAUDE_SPENT, new Date("2026-10-24T12:00:00Z")), "Claude's daily budget for Doors is used up; it's back at midnight.");
  } finally {
    if (tz == null) delete process.env.TZ;
    else process.env.TZ = tz;
  }
  assert.equal(inLocalTime("This answer: Claude."), "This answer: Claude.");
  assert.match(read("public/lib/day-polish.js"), /failed: inLocalTime\(/);
});

test("gigbot 10-24: live Haiku read out 'rank 7 of 55 … affinity of 0.87 … at 0.91': the prompt says not to, the filter makes sure", () => {
  assert.match(SYSTEM, /Say a rank only as the door's place on Your list .* Never write Qloo's affinity or popularity as a number or any 0\.xx decimal, even when the rep asks for the numbers/);
  // round 3 (agent2, Jard 10-25): the Claude prompt says the numbers when they make the point; the free models' prompt keeps the rule
  assert.doesNotMatch(AGENT_SYSTEM, /Never say a rank number|Say a rank only/);
  assert.match(AGENT_SYSTEM, /a rank or a count when it makes the point .* never as a 0\.xx score/); // round 3: no decimal examples
  assert.doesNotMatch(AGENT_SYSTEM, /popularity 0\.\d/);
  assert.match(AGENT_SYSTEM, /SO WHAT: a crowd or demographic fact/);
  assert.match(AGENT_SYSTEM, /Say what they need and stop/);
  const live = "The Stay Put is first because it's rank 7 of 55 for your drinker, with an affinity of 0.87, close to Nomadic Beerworks at 0.91. It opens at 3 pm.";
  assert.equal(noScores(live, "Why is The Stay Put first?"), "The Stay Put is first because it's near the top of your list for your drinker, close to Nomadic Beerworks. It opens at 3 pm.");
  assert.equal(noScores(live, "what's its affinity?"), live); // asked for the numbers
  assert.equal(noScores("It sits at #40 of 55 on your list (affinity 0.62). Go there last.", "why?"), "It sits further down your list. Go there last.");
  assert.equal(noScores("Both are strong: Fora (0.91) and Lazy Bird (0.88).", "why?"), "Both are strong: Fora and Lazy Bird.");
  assert.equal(noScores("Its popularity is 0.15 and that is low. Lead with margin.", "why?"), "Lead with margin.");
  assert.equal(noScores("Fora has an affinity of 0.91 and a popularity of 0.40.", "why?"), "");
  assert.equal(noScores("That is $4.02 a pint and 1.75 road mi.", "why?"), "That is $4.02 a pint and 1.75 road mi."); // money and miles stay
  assert.equal(noScores("It is level with #1 for your drinker.", "why?"), "It is level with #1 for your drinker.");
  // Claude's backing words carry the whole prompt (which says "affinity"): the numbers test reads the rep's own words
  assert.match(read("src/agent.js"), /asked: words, actions/);
  assert.match(read("src/agent.js"), /if \(backing && !loose\) t = noScores\(t, backing\.asked \?\? backing\.words \?\? ""\);/); // round 3: the free models only
});
