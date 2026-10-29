// Live check 2: the chat agent on a live model. F1 a spent Workers AI day skipped
// Gemini; F2 the model claimed rule changes it never made; F3 a term rule rewrote the brand in replies; F4 never-say
// words never reached the chat; F5 coaching on the model was generic and unsourced; F6 the tap filter needed Qloo's
// literal "Full bar"; F7 a model's follow-up wording contradicted the hours line under it; F8 "owner" became a contact
// name; F10 "a Angry Orchard", and the product line skipped the term rules. No network.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.js";
import { _resetAgent, cleanReply, cleanContext, promptOf } from "../src/agent.js";
import { answerByRules } from "../public/lib/agent-rules.js";
import { runTool } from "../public/lib/agent-tools.js";
import { makeRecord } from "../public/lib/slots.js";
import { scriptedSession } from "../src/llm.js";
import { askMiss, hasTaps } from "../public/lib/ask.js";
import { fitReply } from "../public/lib/fu-check.js";
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
const BRAND = "Hollow Pine Cider";
const rule = (field, value, at) => makeRecord({ slot: "S6", field, value, source: "corrected", by: "rep", at });
// the demo plan as Hollow Pine's, with the rep's rules saved, through the page's own context builder
const withRules = (records, over = {}) => {
  const p = { ...plan, profile: { ...plan.profile, brand: BRAND, what: "Dry hard cider", ...over }, slots: { "*": records } };
  return agentContext({ plan: p, dayIndex: 0, current: FIRST, city: city("austin"), routes: [route("athletic-brewing-austin")], now: new Date(`${plan.days[0].date}T14:20:00`) });
};
const post = (body) => new Request("https://doors.example/api/agent", { method: "POST", headers: { origin: "https://doors.example", "content-type": "application/json", "cf-connecting-ip": "203.0.113.9" }, body: JSON.stringify(body) });
const ask = async (env, text, context = base) => (await worker.fetch(post({ v: 1, messages: [{ role: "user", text }], context }), env)).json();
const stub = (steps, seen = []) => (opts) => (seen.push(opts), scriptedSession(steps)(opts));
const AT = "2026-10-20T12:00:00.000Z";

// ---------- F2: a rule is kept by code, before any model ----------
test("F2: 'never say regulars' and 'say X, not Y' are kept as rules with no model call, even with a model up", async () => {
  const seen = [];
  const env = { AGENT_SESSION: stub([{ text: "Understood, I have updated your talking points." }], seen) };
  const r = await ask(env, "never say regulars");
  assert.equal(seen.length, 0, "the model is never asked");
  assert.equal(r.resting, undefined, "not a resting answer: Doors answered on purpose");
  assert.deepEqual(r.tools, [{ name: "remember", ok: true }]);
  const rec = r.actions.find((a) => a.type === "slot")?.record;
  assert.deepEqual([rec?.field, rec?.value], ["rule.avoid", "regulars"]);
  const t = await ask(env, "say craft cider, not hard cider");
  assert.deepEqual(t.actions.find((a) => a.type === "slot")?.record?.value, { from: "hard cider", to: "craft cider" });
  assert.equal(seen.length, 0);
});

test("F2: a model reply claiming a change no tool made is dropped, never shown", async () => {
  const env = { AGENT_SESSION: stub([{ text: "Understood, I have updated your talking points. I won't use that word again." }]) };
  const r = await ask(env, "can you make the opener friendlier?");
  assert.deepEqual(r.actions, []);
  assert.doesNotMatch(r.reply, /updated|won't use/i);
  // with a real change this turn the claim stands
  const ok = cleanReply("I have logged the visit.", base, { facts: [], words: "done", actions: [{ type: "outcome" }] });
  assert.equal(ok, "I have logged the visit.");
});

// ---------- F1: a spent Workers AI day falls through to Gemini on the same turn ----------
test("F1: a 4006 on the first turn tries Gemini next, not the rules", async () => {
  const ai = { n: 0, run: async () => (ai.n++, Promise.reject(new Error('Workers AI 429: [{"code":4006,"message":"you have used up your daily free allocation of 10,000 neurons"}]'))) };
  const hits = [];
  const GEMINI_FETCH = async (url) => (hits.push(url), new Response(JSON.stringify({ candidates: [{ content: { role: "model", parts: [{ text: "from gemini" }] } }] }), { status: 200 }));
  const r = await ask({ AI: ai, GEMINI_API_KEY: "k", GEMINI_FETCH }, "hello");
  assert.deepEqual([r.by, r.reply, r.resting], ["gemini", "from gemini", undefined]);
  assert.equal(ai.n, 1, "the 8b model isn't tried after Cloudflare says the day is used");
  assert.equal(hits.length, 1);
});

test("all models down: the rules answer, honestly labelled, with no claimed action", async () => {
  const ai = { run: async () => Promise.reject(new Error('Workers AI 429: [{"code":4006,"message":"daily free allocation"}]')) };
  const GEMINI_FETCH = async () => new Response(JSON.stringify({ error: { code: 429 } }), { status: 429 });
  const r = await ask({ AI: ai, GEMINI_API_KEY: "k", GEMINI_FETCH }, "can you make the opener friendlier?");
  assert.equal(r.resting, true);
  assert.equal(r.by, "rules");
  assert.match(r.message, /rules/i);
  assert.deepEqual(r.actions, []);
  assert.doesNotMatch(r.reply, /updated|changed|saved/i);
});

// ---------- F3, F4: the rep's rules on the chat's own words ----------
test("F3: a term rule changes 'cider' in a reply but never the brand's name", () => {
  const ctx = cleanContext(withRules([rule("rule.term", { from: "cider", to: "apple wine" }, AT)]));
  assert.equal(cleanReply("Tell them Hollow Pine Cider sits next to it. Our cider is dry.", ctx), "Tell them Hollow Pine Cider sits next to it. Our apple wine is dry.");
});

// fix9 (live-model re-run F4): a never-say drink word is reworded, not its sentence dropped (fix9-agent.test.mjs)
test("F4: never-say words reach the model's prompt and a reply that says one is reworded (the brand spared)", () => {
  const ctx = cleanContext(withRules([rule("rule.avoid", "craft", AT), rule("rule.avoid", "cider", AT)]));
  const p = promptOf([{ role: "user", text: "what do I say?" }], ctx);
  assert.match(p, /"never_say":\["craft","cider"\]/);
  assert.equal(cleanReply("Hollow Pine craft cider is great. Ask who decides the list. Hollow Pine Cider is local.", ctx), "Hollow Pine drink is great. Ask who decides the list. Hollow Pine Cider is local.");
});

test("F4 (live, flash-lite): a reply whose only sentence broke a rule leaves no stray quote behind", () => {
  const ctx = cleanContext(withRules([rule("rule.avoid", "regulars", AT)]));
  assert.equal(cleanReply('Try: "Your regulars will love it with tacos.")', ctx), "");
});

test("F3/F4: the newest rule on a word wins in the chat too (a term after a never-say)", () => {
  const ctx = cleanContext(withRules([rule("rule.avoid", "cider", "2026-10-20T12:00:00.000Z"), rule("rule.term", { from: "cider", to: "apple wine" }, "2026-10-20T12:05:00.000Z")]));
  assert.equal(cleanReply("Our cider is dry.", ctx), "Our apple wine is dry.");
});

// ---------- F5, F10: coaching from the stop's own talking points, before the model ----------
test("F5: a rival, too expensive and the next door are coached from the stop's talking points, sourced, no model", async () => {
  const seen = [];
  const env = { AGENT_SESSION: stub([{ text: "Highlight its crisp, refreshing, unique profile." }], seen) };
  const rival = await ask(env, "what if they already have Angry Orchard?");
  assert.match(rival.reply, new RegExp(`^At ${base.doors[FIRST].name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}, if they already have an Angry Orchard`));
  assert.ok(rival.facts.length && rival.facts.every((f) => f.source?.door === FIRST));
  const price = await ask(env, "what do I say if they say it's too expensive?");
  assert.match(price.reply, /\$38 a case of 24/, "the rep's own price");
  const next = await ask(env, "what should I say at the next door?");
  assert.match(next.reply, new RegExp(`^At ${base.doors[SECOND].name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`), "the door after the open one");
  assert.equal(seen.length, 0, "the model is never asked");
  assert.doesNotMatch([rival.reply, price.reply, next.reply].join(" "), /crisp|refreshing|unique/);
});

test("F5: the model also gets the next door's talking points", () => {
  const p = promptOf([{ role: "user", text: "hi" }], cleanContext({ ...base, nextDoor: SECOND }));
  assert.ok(base.doors[SECOND].talk?.opener);
  assert.ok(p.includes(JSON.stringify(base.doors[SECOND].talk.opener)));
});

test("F10: the coaching line's product goes through the term rules", () => {
  const ctx = withRules([rule("rule.term", { from: "cider", to: "apple wine" }, AT)]);
  const r = answerByRules([{ role: "user", text: "what if they already have Angry Orchard?" }], ctx, { now: AT });
  assert.match(r.reply, /an Angry Orchard/);
  assert.match(r.reply, /what's different about yours: dry hard apple wine/);
});

// ---------- F6: the tap filter ----------
test("F6: a restaurant with beer and spirits keeps a tap ask; no drinks tags stays neutral; beer alone leaves", () => {
  const HOLLOW = { what: "Dry hard cider", ask: "a sixtel on one tap line for a month" };
  const R = (bev) => ({ name: "X", genre: "urn:tag:genre:place:restaurant:taco", tags: bev ? { bev } : {} });
  assert.equal(askMiss(R(["Cocktails", "Coffee and tea", "Spirits", "Specialty alcoholic", "Beer", "Wine"]), HOLLOW), null, "Big Star");
  assert.equal(askMiss(R(["Cocktails", "Beer", "Coffee and tea", "Wine", "Spirits"]), HOLLOW), null, "Penumbra");
  assert.equal(askMiss(R(null), HOLLOW), null, "Ada Street: Qloo has no drinks tags");
  assert.ok(hasTaps(R(null)));
  const beer = askMiss(R(["Beer"]), HOLLOW);
  assert.equal(beer?.code, "no-taps", "a taqueria with beer alone");
  assert.match(beer.reason, /beer but no spirits/);
  assert.equal(askMiss(R(["Wine"]), HOLLOW)?.code, "no-taps");
  // proof re-judge (4178e74, pour-omaha / pour-austin): cocktails without spirits is most often a beer-and-wine
  // licence (mimosas at First Watch, wine margaritas at a taqueria): no bar, so no taps that Qloo can see
  assert.equal(askMiss({ ...R(["Coffee and tea", "Beer", "Fresh juices", "Cocktails", "Wine"]), name: "First Watch" }, HOLLOW)?.code, "no-taps");
  assert.equal(askMiss(R(["Beer", "Cocktails"]), HOLLOW)?.code, "no-taps");
});

// ---------- F7: the model's follow-up wording vs the hours line ----------
test("F7: a model's own 'logged for Tuesday at 10' is replaced by what is saved, so nothing contradicts the hours line", () => {
  const chi = route("lacroix-chicago");
  const WRIG = "00000000-0000-4000-8000-8F642B1894ED"; // opens 4 pm Tuesdays
  const o = { result: "interested", followUp: "2026-10-27", followUpTime: "15:00" };
  const r = { reply: "I have logged that follow-up for Tuesday at 3:00 PM. Good luck!", actions: [{ type: "outcome", id: WRIG, outcome: o }] };
  const got = fitReply(r, chi.venues, { windows: [{ date: "2026-10-23" }, { date: "2026-10-27" }] });
  assert.doesNotMatch(got.reply, /3:00 PM/);
  assert.match(got.reply, /^Logged Wrigleyville North: .*4 pm\. Good luck! Wrigleyville North opens 4 pm Tuesday, so the follow-up is at 4 pm\.$/);
});

// ---------- F8: a role is not a name ----------
test("F8: 'owner wasn't in' keeps no contact called owner; 'interested' and the rep's words stand", () => {
  const ctx = cleanContext(base);
  const r = runTool("log_visit", { door_id: FIRST, result: "followup", follow_up_date: "2026-10-31", who: "owner" }, ctx, { by: "agent:gemini", words: "done, owner wasn't in, back saturday at 3pm", now: `${ctx.today}T${ctx.now}` });
  assert.ok(r.ok, r.error);
  const out = r.actions.find((a) => a.type === "outcome").outcome;
  assert.equal(out.who, undefined);
  const s = runTool("log_visit", { door_id: FIRST, result: "followup", follow_up_date: "2026-10-31" }, ctx, { by: "agent:gemini", words: "owner says come back saturday at 5, interested", now: `${ctx.today}T${ctx.now}` });
  const o2 = s.actions.find((a) => a.type === "outcome").outcome;
  assert.equal(o2.result, "interested");
  assert.ok(o2.note, "the rep's words kept as the note");
});

// ---------- phone live run: the reply says the change that ran, not the model's version ----------
test("a re-plan's reply comes from the action: the model said 'removed the hotel', the planner moved it to Tuesday", async () => {
  const env = { AGENT_SESSION: stub([{ calls: [{ id: "1", name: "replan", args: { skip: [SECOND] } }] }, { text: `I removed ${base.doors[SECOND].name} from your plan. It has a strong cocktail list.` }]) };
  const r = await ask(env, `swap ${base.doors[SECOND].name} for a taproom`);
  assert.equal(r.actions[0]?.type, "replan");
  assert.doesNotMatch(r.reply, /removed/i);
  assert.equal(r.reply, `Re-planning the day: ${base.doors[SECOND].name} off this day. The line below says where it went.`);
});

// ---------- phone live run (c): a hotel is a room only with a bar signal ----------
test("a place:hotel counts as a room only with a drinks signal (a drinks tag, or bar, lounge or dining in Qloo's description)", async () => {
  const { roomOf } = await import("../public/lib/profile.js");
  const { sieve } = await import("../public/lib/sieve.js");
  const H = (over) => ({ name: "Some Hotel", genre: "urn:tag:genre:place:hotel", tags: {}, ...over });
  const indigo = H({ name: "Hotel Indigo Denver Downtown-Union Station by IHG", description: "Stylish woodsy-chic boutique hotel near Union Station with soundproof rooms, on-site restaurant and bar, fitness center, and meeting facilities." });
  assert.equal(roomOf(indigo), "restaurants", "Hotel Indigo: Qloo says it has a bar");
  assert.equal(roomOf(H({ tags: { bev: ["Cocktails"] } })), "restaurants", "a drinks tag");
  assert.equal(roomOf(H({ description: "Rooftop lounge with city views." })), "restaurants");
  const motel = H({ name: "Budget Inn", description: "Simple rooms near the highway with free parking and a continental breakfast." });
  assert.equal(roomOf(motel), "hotel");
  assert.equal(roomOf(H({ description: null })), "hotel", "nothing says it has a bar");
  assert.equal(roomOf(H({ name: "Fairmont Austin", description: "Upscale downtown Austin hotel with rooftop pool, spa, multiple dining options, and extensive event space." })), "restaurants", "on-site dining");
  assert.equal(roomOf(H({ name: "The Carleton of Oak Park Hotel", description: "Historic boutique hotel with vintage charm, kitchenettes, free parking, and event spaces." })), "hotel");
  assert.equal(roomOf(H({ description: "Small hotel with a coffee bar and free parking." })), "hotel", "a coffee bar is no bar");
  // the sieve names why it is out
  const v = { ...motel, id: "M1", lat: 39.7, lon: -105 };
  const s = sieve({ route: { venues: { M1: v }, lists: { all: [["M1", 0.5]], famous: [] } }, plan: { days: [], venues: { M1: v }, statuses: {}, reasons: {} }, profile: { rooms: ["bars", "breweries", "restaurants"] } });
  const dot = s.dots.find((d) => d.id === "M1");
  assert.equal(dot?.fate, "room");
  assert.match(dot.reason, /hotel/i);
});
