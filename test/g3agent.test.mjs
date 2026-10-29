// Group 3 lane C (Jard's 10-24 web review, item 7): the Agent's context carries each door's place picture and the
// product, a briefing reads them, and a long chat with the full context still fits the Worker's body cap. No network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { demoContext } from "./agent-fixture.mjs";
import { cleanContext, promptOf, asksBrief, MAX_BODY, placeLines } from "../src/agent.js";
import { runTool } from "../public/lib/agent-tools.js";
import { agentContext, placeForAgent, drinkersForAgent } from "../public/lib/agent-context.js";
import { city, route } from "./helpers.mjs";

test("the context carries each full door's place picture, compact, without the age row", async () => {
  const { ctx } = await demoContext({});
  const v = ctx.doors[ctx.nextDoor];
  assert.equal(v.name, "The Drafting Room");
  assert.deepEqual(Object.keys(v.place), ["when", "room", "pours", "into", "sisters"]);
  assert.match(v.place.room, /Live music/);
  assert.equal(placeForAgent({ rows: [{ key: "ages", label: "Ages", text: "x" }] }).ages, undefined);
  const light = Object.values(ctx.doors).find((d) => !d.talk);
  assert.ok(light.place && light.about, "round 3 (agent2): every door carries its place picture and about record"); // was: light doors had none
});

test("the Worker keeps the place rows and the product line; the prompt gives the next door's place", async () => {
  const { plan } = await demoContext({});
  plan.profile = { ...plan.profile, product: { format: "cans", size: "12 oz", abv: "0.5%", na: true, sells: "self" }, drinkers: { who: "runners", age: "25_34", where: "taprooms", basis: "known" } };
  const raw = agentContext({ plan, dayIndex: 0, city: city("austin"), routes: [route("athletic-brewing-austin")], now: new Date(`${plan.days[0].date}T12:30:00`) });
  assert.match(raw.profile.product, /^12 oz cans · non-alcoholic/);
  assert.doesNotMatch(drinkersForAgent(plan.profile), /25|34/);
  assert.equal(drinkersForAgent(plan.profile), "runners · taprooms (the user knows this)");
  assert.match(drinkersForAgent({ drinkers: { who: "runners", basis: "guess" } }), /\(the user's best guess or research\)$/);
  const c = cleanContext({ ...raw, mode: "drive" });
  assert.match(c.doors[c.nextDoor].place.into, /Craft cocktails/);
  assert.equal(c.doors[c.nextDoor].place.bogus, undefined);
  const p = promptOf([{ role: "user", text: "Tell me a little bit more about this next stop I'm about to make." }], c);
  assert.match(p, /"about_the_place":\["Who goes \(Qloo\): /); // round 3: the whole crowd line, marked as Qloo's
  assert.match(p, /"product_details":"12 oz cans/);
  assert.match(p, /"your_drinkers":"runners · taprooms \(the user knows this\)"/);
  assert.match(p, /a briefing: call brief_door/);
  assert.match(p, /at most five short sentences, spoken aloud/);
  assert.match(placeLines({ crowd: "A. B.", place: { room: "Fun" } }).join("|"), /^Who goes: A\.\|The room: Fun$/);
});

test("brief_door returns the place and backs each row with a Qloo fact", async () => {
  const { ctx } = await demoContext({});
  const c = cleanContext(ctx);
  const r = runTool("brief_door", { door_id: c.nextDoor }, c);
  assert.ok(r.ok);
  assert.ok(r.data.about_the_place.some((x) => /^The room: .*Live music/.test(x)));
  const place = r.facts.filter((f) => f.source.field.startsWith("place."));
  assert.ok(place.length >= 3);
  assert.match(place[0].source.label, /^Qloo, /);
});

test("a briefing is asked in Jard's words; 'the stop after X' is not a briefing", () => {
  assert.ok(asksBrief("Tell me a little bit more about this next stop I'm about to make."));
  assert.ok(asksBrief("Give me some crucial details that will help me land the sale."));
  assert.ok(!asksBrief("what's the next stop after Dolphin Lounge?"));
  assert.ok(!asksBrief("where do I go next?"));
});

test("a long chat with the demo's full context fits the Worker's body cap", async () => {
  const { ctx } = await demoContext({});
  const messages = Array.from({ length: 12 }, (_, i) => ({ role: i % 2 ? "agent" : "user", text: "x".repeat(i % 2 ? 1500 : 600) }));
  const body = JSON.stringify({ v: 1, messages, context: { ...ctx, mode: "drive" } });
  assert.ok(new TextEncoder().encode(body).length < MAX_BODY, `${body.length} >= ${MAX_BODY}`);
});

test("the user's own name: [your name] to the model, put back after (agentfix finding a: 'I'm the contact with Tidewell')", async () => {
  const { meOf, meOut, meBack, ME } = await import("../src/agent.js");
  const me = meOf({ profile: { signAs: "Maya Ortiz", brand: "Tidewell" } });
  assert.deepEqual(me, { full: "Maya Ortiz", parts: ["Maya", "Ortiz"], back: "Maya" });
  assert.equal(meOut("Hi, I'm Maya with Tidewell. Maya Ortiz, Tidewell", me), `Hi, I'm ${ME} with Tidewell. ${ME}, Tidewell`);
  assert.equal(meBack({ reply: `Open with "Hi, I'm ${ME} with Tidewell."`, n: 1 }, me).reply, `Open with "Hi, I'm Maya with Tidewell."`);
  // a team sign-off is put back whole, and the brand is never taken for a name
  const team = meOf({ profile: { signAs: "The Tidewell team", brand: "Tidewell" } });
  assert.equal(team.back, "The Tidewell team");
  assert.equal(meOut("Tidewell is a hazy IPA. The Tidewell team", team), `Tidewell is a hazy IPA. ${ME}`);
  assert.equal(meOf({ profile: { signAs: "" } }), null);
  // the demo's prompt: the opener reads [your name], never "the contact" or the name itself
  const { ctx } = await demoContext({});
  const c = cleanContext(ctx);
  const p = meOut(promptOf([{ role: "user", text: "brief me" }], c, [], null), meOf(c));
  assert.match(p, /I'm \[your name\] with Tidewell/);
  assert.doesNotMatch(p, /Maya|I'm the contact/);
});

test("an answer the cleaner emptied says what was done, the facts, or Doors' rules (agentfix finding b)", async () => {
  const { fallbackReply, didSay } = await import("../src/agent.js");
  const { ctx } = await demoContext({});
  const c = cleanContext(ctx);
  const id = c.nextDoor;
  const name = c.doors[id].name;
  assert.equal(didSay([{ type: "talk", id, section: "opener", op: "replace", index: 0, text: "Hi there." }], c), `Changed ${name}'s opener: “Hi there.”.`);
  assert.equal(didSay([{ type: "status", id, status: "visited" }, { type: "outcome", id, outcome: { result: "interested" } }, { type: "slot", id, record: { field: "said", value: "x" } }], c), `Logged ${name}: Interested.`);
  assert.equal(didSay([{ type: "slot", id, record: { field: "note", value: "back Thursdays" } }], c), `Noted on ${name}: “back Thursdays”.`);
  const fx = [{ text: "Fact one." }, { text: "Fact two." }, { text: "Fact three." }];
  assert.equal(fallbackReply([], fx, []), "Fact one. Fact two.");
  // nothing ran: Doors' rules answer (a briefing here), never "I couldn't do that"
  const r = fallbackReply([], [], [], null, { ctx: c, messages: [{ role: "user", text: "tell me about my next stop" }] });
  assert.match(r, new RegExp(`^${name}`));
  assert.doesNotMatch(r, /couldn't do that|change is on your plan/);
  assert.match(fallbackReply([], [], [], null, { ctx: c, messages: [{ role: "user", text: "zzz qqq" }] }), /didn't come through, and nothing was changed/);
});
