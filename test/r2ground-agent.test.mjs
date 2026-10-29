// Jard web review R2 (10-24, imgs 205112, 205233): at Carmichael's the Agent said the door's crowd "suits health-conscious
// parents and professionals". That was the user's own drinkers line (profile.drinkers), not Qloo. The prompt walls the
// user's drinker words off from door facts, and drinkersOffDoors drops a sentence that puts them on a door unsaid-whose.
import { test } from "node:test";
import assert from "node:assert/strict";
import { demoContext } from "./agent-fixture.mjs";
import { cleanContext, promptOf, cleanReply, drinkerTerms, drinkersOffDoors, AGENT_SYSTEM } from "../src/agent.js";
import { agentContext } from "../public/lib/agent-context.js";
import { city, route } from "./helpers.mjs";

async function ctxWith(drinkers) {
  const { plan } = await demoContext({});
  plan.profile = { ...plan.profile, drinkers };
  const raw = agentContext({ plan, dayIndex: 0, city: city("austin"), routes: [route("athletic-brewing-austin")], now: new Date(`${plan.days[0].date}T12:30:00`) });
  const c = cleanContext(raw);
  // Carmichael's as Qloo had it in Jard's run: a laid-back room of local regulars, nothing about parents or health
  const id = c.nextDoor;
  c.doors[id] = { ...c.doors[id], name: "Carmichael's", crowd: "Local regulars looking for a laid-back spot to unwind.", ambience: "Relaxed, casual.", goodFor: ["happy hour"], place: {}, notes: [] };
  for (const [k, v] of Object.entries(c.doors)) if (k !== id) c.doors[k] = { ...v, crowd: "", ambience: "", goodFor: [], place: {}, notes: [] };
  return { c, id };
}
const PARENTS = { who: "health-conscious parents and professionals", where: "", basis: "known" };

test("drinkerTerms: the content words of the user's drinkers line, not its basis tag or filler", () => {
  assert.deepEqual(drinkerTerms("health-conscious parents and professionals (the user knows this)"), ["health-conscious", "parents", "professionals"]);
  assert.deepEqual(drinkerTerms("runners · taprooms (the user's best guess or research)"), ["runners", "taprooms"]);
  assert.deepEqual(drinkerTerms(""), []);
});

test("Carmichael's: the live answer that said the door suits the user's drinkers loses that sentence; the opener stays", async () => {
  const { c } = await ctxWith(PARENTS);
  const bad = "Carmichael's crowd matches your drinkers about as closely as any door on your list: local regulars who want a laid-back spot, which suits health-conscious parents and professionals. Open with \"Who decides your drinks list?\" and ask for one case of cans in the cooler to try at $38.";
  const out = drinkersOffDoors(bad, c, { facts: [], shown: "" });
  assert.doesNotMatch(out, /parents|professionals|health/);
  assert.match(out, /^Open with "Who decides your drinks list\?"/);
  // through the whole cleaner (Claude's loose path) too
  assert.doesNotMatch(cleanReply(bad, c, { facts: [], words: "why is this a good fit", asked: "why is this a good fit", shown: "", actions: [] }, { loose: true }), /parents|professionals/);
});

test("the user's drinker words stay when the reply says whose they are, or when Qloo's facts use them too", async () => {
  const { c, id } = await ctxWith(PARENTS);
  const own = [
    "The health-conscious parents and professionals part is your own read of your drinkers, not something Qloo shows for Carmichael's, so don't present it to the bar as fact.",
    "Qloo says its crowd is local regulars after a laid-back spot; you described your drinkers as health-conscious parents and professionals, so the overlap is the laid-back regulars.",
    "If your drinkers are health-conscious parents, lead with the can at 0.5%.",
  ];
  for (const x of own) assert.equal(drinkersOffDoors(x, c, { facts: [], shown: "" }), x, x);
  // a word Qloo's crowd text holds is a door fact: "professionals" said of a door whose crowd line has it stays
  c.doors[id].crowd = "Young professionals and local regulars.";
  const qloo = "Carmichael's draws young professionals after work.";
  assert.equal(drinkersOffDoors(qloo, c, { facts: [], shown: "" }), qloo);
  // and one a tool result returned this turn
  c.doors[id].crowd = "";
  assert.equal(drinkersOffDoors(qloo, c, { facts: [], shown: '{"about_the_place":["Who goes: young professionals"]}' }), qloo);
  assert.equal(drinkersOffDoors(qloo, c, { facts: [], shown: "" }), "", "no door fact holds it: dropped");
});

test("the rep's own question doesn't ground the words: asked 'how do you know parents go here?', the answer may not say they do", async () => {
  const { c } = await ctxWith(PARENTS);
  const asked = "How do you know that this is a laid back spot and that health conscious folks and also parents or professionals like to visit here?";
  const bad = "Parents and professionals like it here because it's laid-back. Ask for the buyer.";
  const out = cleanReply(bad, c, { facts: [], words: `${asked} {}`, asked, shown: "", actions: [] }, { loose: true });
  assert.equal(out, "Ask for the buyer.");
});

test("no drinkers line: nothing changes", async () => {
  const { c } = await ctxWith({ who: "", where: "", basis: "" });
  const x = "Carmichael's is a laid-back spot for parents.";
  assert.equal(drinkersOffDoors(x, c, { facts: [], shown: "" }), x);
});

test("the prompt: your_drinkers is labelled the user's own words, and the rule says it never describes a door", async () => {
  const { c } = await ctxWith(PARENTS);
  const p = promptOf([{ role: "user", text: "why exactly is this a good fit for my drink?" }], c);
  assert.match(p, /"your_drinkers":"health-conscious parents and professionals \(the user knows this\)"/);
  assert.match(p, /"your_drinkers_is":"the user's own words about who drinks their product; not Qloo's data, not about any door"/);
  assert.match(AGENT_SYSTEM, /It is never a fact about a door/);
  assert.match(AGENT_SYSTEM, /Never join them into one claim about the door/);
});

test("live replay 10-24: 'Nothing in Qloo's data mentions health-conscious parents or professionals' is the honest answer, kept", async () => {
  const { c } = await ctxWith(PARENTS);
  const x = "Nothing in Qloo's data for this door mentions health-conscious parents or professionals.";
  assert.equal(drinkersOffDoors(x, c, { facts: [], shown: "" }), x);
});

test("live replay 10-24: a briefing's opener that tells the bar about its own room loses that sentence; the rest stays", async () => {
  const { roomOutOfQuotes } = await import("../src/agent.js");
  const brief = "Opener: \"Hi, I'm Maya with Tidewell. Your crowd here is out for live music and cocktails, and I've got a non-alcoholic hazy IPA in 12 oz cans. Who buys your beer, and when's a good time to catch them?\"";
  const out = roomOutOfQuotes(brief);
  assert.doesNotMatch(out, /Your crowd here/);
  assert.match(out, /^Opener: "Hi, I'm Maya with Tidewell\. Who buys your beer, and when's a good time to catch them\?"$/);
  assert.equal(roomOutOfQuotes("Say: \"Looks like you get music enthusiasts in here.\" Then ask for the buyer."), "Then ask for the buyer.");
  const fine = "Open with \"Who decides your drinks list?\" and ask for one case of cans in the cooler.";
  assert.equal(roomOutOfQuotes(fine), fine);
});
