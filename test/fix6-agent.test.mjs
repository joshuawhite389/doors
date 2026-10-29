// Judge pass 5 (#4): coaching on the rules path. "they said we already have a kombucha" (the rep reporting what a door
// said) fell to the help menu, and with the logged stop 1 still the chat's open stop every answer was about it, not the
// rep's next door. No network.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.js";
import { _resetAgent } from "../src/agent.js";
import { answerByRules, isCoaching } from "../public/lib/agent-rules.js";
import { scriptedSession } from "../src/llm.js";
import { agentContext } from "../public/lib/agent-context.js";
import { demoContext } from "./agent-fixture.mjs";
import { route, city } from "./helpers.mjs";

const realFetch = globalThis.fetch;
before(() => {
  globalThis.fetch = async (u) => {
    throw new Error(`network call attempted in a test: ${u}`);
  };
});
after(() => (globalThis.fetch = realFetch));
beforeEach(() => _resetAgent());

const { ctx: base, plan } = await demoContext({ current: "first" });
const FIRST = base.day.stops[0].id;
const SECOND = base.day.stops[1].id;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const at = (id) => new RegExp(`^At ${esc(base.doors[id].name)}\\b`);
// after the tour: stop 1 logged, and still the stop the chat saw opened last
const logged = agentContext({ plan: { ...plan, statuses: { ...plan.statuses, [FIRST]: "visited" }, outcomes: { ...plan.outcomes, [FIRST]: { result: "interested" } } }, dayIndex: 0, current: FIRST, city: city("austin"), routes: [route("athletic-brewing-austin")], now: new Date(`${plan.days[0].date}T14:20:00`) });
const rules = (text, ctx = base) => answerByRules([{ role: "user", text }], ctx, { now: `${ctx.today}T${ctx.now}` });

test("#4: the rep reporting a door's objection is a coaching question", () => {
  for (const s of ["they said we already have a kombucha", "They said they already carry Angry Orchard.", "the manager said it's too expensive", "she told me they don't have room", "bartender says it won't sell here", "they keep saying we already have one"]) assert.ok(isCoaching(s), s);
  // a visit being logged is not coaching
  for (const s of ["done, they said no", "they said come back Thursday at 3", "done at Toons, they said they liked it", "they said we already have a kombucha, logged it"]) assert.ok(!isCoaching(s), s);
});

test("#4: 'they said we already have a kombucha' answers the objection, not the help menu", () => {
  const r = rules("they said we already have a kombucha");
  assert.equal(r.by, "rules");
  assert.match(r.reply, /if they already have a kombucha/);
  assert.ok(r.facts.length && r.facts.every((f) => f.source?.kind === "doors"));
  assert.doesNotMatch(r.reply, /^I can explain/);
});

test("#4: with the open stop already logged, coaching is about the next door", () => {
  assert.equal(logged.current, FIRST);
  assert.equal(logged.nextDoor, SECOND);
  for (const s of ["they said we already have a kombucha", "what if they say it's too expensive?", "what should I say if the owner isn't in?", "any tips?"]) assert.match(rules(s, logged).reply, at(SECOND), s);
  // naming a door still wins, and an open door with nothing logged is still the one coached
  assert.match(rules(`what if they already have a kombucha at ${base.doors[FIRST].name}?`, logged).reply, at(FIRST));
  assert.match(rules("what if they say it's too expensive?").reply, at(FIRST));
});

test("#4: on the Worker, with a model up, the same answers come from the rules and never ask the model", async () => {
  const seen = [];
  const env = { AGENT_SESSION: (o) => (seen.push(o), scriptedSession([{ text: "Highlight its unique profile." }])(o)) };
  const post = (text) => new Request("https://doors.example/api/agent", { method: "POST", headers: { origin: "https://doors.example", "content-type": "application/json", "cf-connecting-ip": "203.0.113.9" }, body: JSON.stringify({ v: 1, messages: [{ role: "user", text }], context: logged }) });
  const r = await (await worker.fetch(post("they said we already have a kombucha"), env)).json();
  assert.match(r.reply, at(SECOND));
  assert.match(r.reply, /already have a kombucha/);
  assert.equal(seen.length, 0);
});
