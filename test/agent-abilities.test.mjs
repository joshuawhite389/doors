// Doors Agent abilities (ASK-DOORS-SPEC §5, build steps 4, 7, 8): the read-only
// tools behind "brief me on this door" and "prep my day", the price math in CONTEXT for objections, and the prompt's
// ability rules. A stub ANTHROPIC_FETCH replays Messages API answers. No network.
import { test, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.js";
import { _resetAgent, AGENT_SYSTEM, promptOf, doorAlias } from "../src/agent.js";
import { runTool, stopFlags, kindOf } from "../public/lib/agent-tools.js";
import { webFacts, _resetWeb, plainCited } from "../src/brief.js";
import { cleanReply, orphanQuotes } from "../src/agent.js";
import { demoContext } from "./agent-fixture.mjs";

const realFetch = globalThis.fetch;
before(() => {
  globalThis.fetch = async (u) => {
    throw new Error(`network call attempted in a test: ${u}`);
  };
});
after(() => (globalThis.fetch = realFetch));
beforeEach(() => _resetAgent());

const { ctx } = await demoContext({ current: "first" });
const FIRST = ctx.day.stops[0].id; // The Drafting Room, #49 of 55
const byName = (n) => Object.keys(ctx.doors).find((id) => ctx.doors[id].name === n);
const post = (body) => new Request("https://doors.example/api/agent", { method: "POST", headers: { origin: "https://doors.example", "content-type": "application/json", "cf-connecting-ip": "203.0.113.9" }, body: JSON.stringify(body) });
const ask = async (env, text, context = ctx) => (await worker.fetch(post({ v: 1, messages: [{ role: "user", text }], context }), env)).json();
const usage = { input_tokens: 900, output_tokens: 80, cache_read_input_tokens: 9000, cache_creation_input_tokens: 0 };
const msg = (content, stop = "end_turn") => ({ id: "msg_1", type: "message", role: "assistant", content, stop_reason: stop, usage });
const text = (t) => ({ type: "text", text: t });
const use = (name, input, id = "toolu_1") => ({ type: "tool_use", id, name, input });
const stubFetch = (answers) => {
  const seen = [];
  const f = async (url, init) => {
    seen.push({ url, body: JSON.parse(init.body) });
    const a = answers.shift();
    if (!a) throw new Error("stub exhausted");
    return Response.json(a);
  };
  f.seen = seen;
  return f;
};
const env = (answers) => ({ ANTHROPIC_API_KEY: "sk-test", ANTHROPIC_FETCH: stubFetch(answers) });

test("kindOf: Qloo's genre tag in words", () => {
  assert.equal(kindOf("urn:tag:genre:place:restaurant:cocktail_bar"), "cocktail bar");
  assert.equal(kindOf(""), null);
});

test("brief_door: the room, the plan fact, the stop's talking points and pushback, its flags, and no menu claimed", () => {
  const r = runTool("brief_door", { door_id: FIRST }, ctx);
  assert.equal(r.ok, true);
  assert.equal(r.data.name, "The Drafting Room");
  assert.equal(r.data.kind, "cocktail bar");
  assert.ok(r.data.opener && r.data.ask);
  assert.ok(r.data.pushback.length >= 1 && r.data.pushback.every((p) => p.reply));
  assert.deepEqual(r.data.flags, ["#49 of 55: the bottom third of your list"]);
  assert.match(r.data.menu, /no menu/);
  assert.ok(r.facts.some((f) => f.source.kind === "qloo" && f.source.field === "crowd"));
  assert.ok(r.facts.some((f) => f.source.kind === "plan"));
  // a door with no talking points here (not a full door) says so, so the model writes from the trade
  const light = Object.keys(ctx.doors).find((id) => !ctx.doors[id].talk);
  assert.match(runTool("brief_door", { door_id: light }, ctx).data.talking_points, /none/);
  assert.equal(runTool("brief_door", { door_id: "nope" }, ctx).ok, false);
});

test("prep_day: every stop in order, the best-ranked to lead, the weak with reasons, swaps better than the weakest", () => {
  const r = runTool("prep_day", {}, ctx);
  assert.equal(r.ok, true);
  assert.equal(r.data.stops.length, ctx.day.stops.length);
  assert.deepEqual(r.data.stops.map((s) => s.door_id), ctx.day.stops.map((s) => s.id));
  assert.deepEqual(r.data.lead_hardest, ["Nomadic Beerworks", "Pinthouse Brewing", "The Yard"]);
  assert.deepEqual(r.data.weak.map((w) => w.name), ["The Drafting Room"]);
  assert.ok(r.data.swaps.length >= 1 && r.data.swaps.length <= 3);
  for (const s of r.data.swaps) {
    const v = ctx.doors[s.door_id];
    assert.ok(v.rank < 49 && !ctx.day.stops.some((x) => x.id === s.door_id) && v.plan?.on !== false, s.name);
  }
  assert.ok(r.facts.length <= 8 && r.facts[0].source.kind === "plan");
  assert.equal(r.actions, undefined); // read-only
});

test("prep_day: a logged door is not weak or a lead; a short window before closing is a flag", () => {
  const c = structuredClone(ctx);
  const nomadic = byName("Nomadic Beerworks");
  c.doors[nomadic].outcome = { result: "interested" };
  const r = runTool("prep_day", {}, c);
  assert.ok(!r.data.lead_hardest.includes("Nomadic Beerworks"));
  assert.equal(r.data.stops.find((s) => s.name === "Nomadic Beerworks").logged, "Interested");
  const st = { ...c.day.stops[1], eta: "21:30", until: "22:00" };
  assert.ok(stopFlags(c, st).some((f) => /closes at 10 pm, 30 min after you arrive/.test(f)));
  // after midnight is not "before arrival"
  assert.ok(!stopFlags(c, { ...st, eta: "17:00", until: "02:00" }).some((f) => /closes/.test(f)));
  assert.match(runTool("prep_day", {}, { ...c, day: { date: null, stops: [] } }).data.answer, /no day/);
});

test("CONTEXT carries the price, the ask and the price math (objections use it, never a made-up cost)", () => {
  const p = promptOf([{ role: "user", text: "too pricey" }], ctx, [], doorAlias(ctx));
  const view = JSON.parse(/CONTEXT (\{.*\})\n/.exec(p)[1]);
  assert.equal(view.price, "$38 a case of 24");
  assert.equal(view.your_ask, "one case of cans in the cooler");
  assert.match(view.price_math, /\$1\.58 a can/);
});

test("the system prompt names each ability's tool and rules", () => {
  assert.match(AGENT_SYSTEM, /Brief me on a door[^\n]*brief_door/);
  assert.match(AGENT_SYSTEM, /Prep my day[^\n]*prep_day/);
  assert.match(AGENT_SYSTEM, /objection[^\n]*price_math/);
  assert.match(AGENT_SYSTEM, /never name the drinker brand/);
});

test("prep my day end to end: prep_day runs, its rank facts are under the reply, no action", async () => {
  const e = env([msg([use("prep_day", {})], "tool_use"), msg([text("Lead hardest at Nomadic Beerworks (#1 of 55). The Drafting Room is #49 of 55: go in short, or swap it.")])]);
  const r = await ask(e, "Prep my day");
  assert.equal(r.by, "anthropic");
  assert.deepEqual(r.tools, [{ name: "prep_day", ok: true }]);
  assert.deepEqual(r.actions, []);
  // round 3 (agent2): a Claude reply says the rank number when it makes the point (the rank fact under it backs it)
  assert.match(r.reply, /The Drafting Room is #49 of 55/);
  assert.ok(r.facts.some((f) => /Nomadic Beerworks/.test(f.text) && /#1 of 55/.test(f.text)));
  // the tool result reached the model with door aliases, not ids
  const second = JSON.stringify(e.ANTHROPIC_FETCH.seen[1].body.messages);
  assert.ok(!second.includes(FIRST) && /door_id\\+":\\+"d1\\/.test(second));
});

test("web facts: an answer from searches with no citations still lists the pages read, with links", () => {
  _resetWeb();
  const content = [{ type: "server_tool_use", name: "web_search", id: "s1", input: { query: "Low Down Lounge Austin menu" } }, { type: "web_search_tool_result", tool_use_id: "s1", content: [{ type: "web_search_result", url: "https://lowdown.example/happy-hour", title: "Happy Hour" }, { type: "web_search_result", url: "https://lowdown.example/", title: "Low Down Lounge" }] }, { type: "text", text: "Their page shows a happy hour." }];
  const f = webFacts(content, "t1");
  assert.deepEqual(f.map((x) => x.source.url), ["https://lowdown.example/happy-hour", "https://lowdown.example/"]);
  assert.ok(f.every((x) => x.source.kind === "web" && /^Page read: /.test(x.text)));
  // cited text wins when there is some
  content[2].citations = [{ type: "web_search_result_location", url: "https://lowdown.example/happy-hour", title: "Happy Hour", cited_text: "Happy hour 4-7 pm" }];
  assert.deepEqual(webFacts(content, "t1").map((x) => x.text), ["Happy hour 4-7 pm"]);
});

test("a list reply is cleaned line by line: a dropped sentence takes no line break or opening quote with it", () => {
  const t = "- Who they are: young professionals and craft beer fans.\n- Open with: \"Lots of young professionals here. How do guests who aren't drinking get taken care of?\"\n- Ask for: one case of cans in the cooler.";
  const out = cleanReply(t, ctx, null, { loose: true });
  const lines = out.split("\n");
  assert.equal(lines.length, 2);
  assert.ok(lines.every((l) => l.startsWith("- ")), out);
  assert.ok(!/young/.test(out));
  assert.equal(orphanQuotes('How are they taken care of?" Ask.'), "How are they taken care of? Ask.");
  // "re-plan" / "replan" is a word in a loose reply, not a tool leak
  assert.match(cleanReply("If you want it, I can replan to add it on Wednesday. Should I?", ctx, null, { loose: true }), /replan to add it/);
});

test("a web answer after tool facts keeps its pages in the reply's sources (mobile2 10-23: no Sources row, no link ↗)", async () => {
  _resetWeb();
  const ids = ctx.day.stops.slice(0, 3).map((x) => x.id);
  const web = [{ type: "server_tool_use", name: "web_search", id: "s1", input: { query: "news" } }, { type: "web_search_tool_result", tool_use_id: "s1", content: [{ type: "web_search_result", url: "https://news.example/a", title: "A story" }] }, { ...text("It reopened in September."), citations: [{ type: "web_search_result_location", url: "https://news.example/a", title: "A story", cited_text: "Reopened in September" }] }];
  const e = env([msg(ids.map((id, i) => use("explain_door", { door_id: doorAlias(ctx).short.get(id) ?? id }, `toolu_${i}`)), "tool_use"), msg(web)]);
  const r = await ask(e, "has it been in the news lately?");
  assert.equal(r.by, "anthropic", JSON.stringify(r).slice(0, 300));
  assert.ok(r.facts.length <= 12 && r.facts.length > 10, `${r.facts.length}`);
  const w = r.facts.filter((f) => f.source.kind === "web");
  assert.deepEqual(w.map((f) => f.source.url), ["https://news.example/a"]);
});

test("a web source's cited words read as plain text: no markdown headings or escapes (live 10-23)", () => {
  assert.equal(plainCited("# Nomadic Beerworks ## You might also like #### Launches Programs \\| Eater Austin **new** #1 of 55"), "Nomadic Beerworks You might also like Launches Programs | Eater Austin new #1 of 55");
});

// ---------- ability 4: draft the follow-up ----------
import { draftOf, OFFERS_VALUE } from "../public/lib/agent-tools.js";
const withContact = () => {
  const c = structuredClone(ctx);
  c.profile.signAs = "Maya Ortiz";
  c.doors[FIRST].outcome = { result: "followup", who: "Dana Ruiz", followUp: "2026-10-29" };
  return c;
};
test("draft_follow_up: code adds the greeting (the contact's first name) and the sign-off; mailto link, never a send", () => {
  const r = runTool("draft_follow_up", { door_id: FIRST, channel: "email", subject: "Tidewell tasting Thursday", body: "Hi the contact,\nGreat meeting you today. I'll bring cold Tidewell Thursday at 3 for the taste.\nThanks,\nthe contact" }, withContact());
  assert.equal(r.ok, true);
  assert.equal(r.actions, undefined); // not a change to the plan
  const d = r.drafts[0];
  assert.equal(d.body, "Hi Dana,\n\nGreat meeting you today. I'll bring cold Tidewell Thursday at 3 for the taste.\n\nThanks,\nMaya Ortiz\nTidewell");
  assert.match(d.href, /^mailto:\?subject=Tidewell%20tasting%20Thursday&body=Hi%20Dana/);
  assert.deepEqual(draftOf({ drafts: [d] }), { id: FIRST, name: "The Drafting Room", channel: "email", subject: "Tidewell tasting Thursday", body: d.body, href: d.href });
});
test("draft_follow_up: a text fits 320 characters with its greeting and sign-off; no contact → Hi there", () => {
  const t = runTool("draft_follow_up", { door_id: FIRST, channel: "text", body: "Thanks for the time today. See you Thursday at 3 with cold cans for the taste." }, { ...ctx, profile: { ...ctx.profile, signAs: "Maya" } });
  assert.equal(t.drafts[0].body, "Hi there, Thanks for the time today. See you Thursday at 3 with cold cans for the taste. – Maya, Tidewell");
  assert.match(t.drafts[0].href, /^sms:\?&body=Hi%20there/);
  assert.match(runTool("draft_follow_up", { door_id: FIRST, channel: "text", body: "x ".repeat(200) }, ctx).error, /too long for a text/);
});
test("draft_follow_up refuses a draft that offers something of value (tied-house), markup, links; draftOf takes only mailto:/sms:", () => {
  for (const body of ["Happy to send a free case to get you started.", "I can comp the staff a round this Friday.", "We'd do a cash rebate on the first keg."]) assert.match(runTool("draft_follow_up", { door_id: FIRST, channel: "email", body }, ctx).error ?? "", /tied-house/, body);
  assert.ok(!OFFERS_VALUE.test("I'll bring a sample for you to taste on Thursday."));
  assert.equal(runTool("draft_follow_up", { door_id: FIRST, channel: "email", body: "See our menu at https://x.example for more." }, ctx).ok, false);
  assert.equal(draftOf({ drafts: [{ channel: "email", body: "x", href: "javascript:alert(1)" }] }), null);
});
test("draft the follow-up end to end: the reply carries the draft; one draft a turn; no 'sent' claim needed", async () => {
  const e = env([msg([use("draft_follow_up", { door_id: "d1", channel: "text", body: "Thanks for today. See you Thursday at 3 for the taste." })], "tool_use"), msg([text("Your text to The Drafting Room is ready: tap Open in Messages to send it from your phone.")])]);
  const r = await ask(e, "Draft a text to The Drafting Room saying I'll see them Thursday at 3", withContact());
  assert.equal(r.drafts.length, 1);
  assert.equal(r.drafts[0].body, "Hi Dana, Thanks for today. See you Thursday at 3 for the taste. – Maya Ortiz, Tidewell");
  // the model never saw the contact's name or the rep's
  const sent = JSON.stringify(e.ANTHROPIC_FETCH.seen.map((x) => x.body));
  assert.ok(!/Dana|Maya Ortiz/.test(sent));
  assert.match(r.reply, /ready/);
});

// ---------- ability 9: Day done polish ----------
import { polishBody, polishView } from "../public/lib/day-polish.js";
import { driveQueue } from "../public/lib/drive-day.js";
import { recordOf } from "../public/lib/day-debrief.js";
const dayPlan = () => {
  const st = (id, eta, more = {}) => ({ id, eta, legMi: 1, legMin: 6, pinned: null, ...more });
  return {
    days: [{ date: "2026-10-27", day: "tuesday", from: 780, to: 1080, stops: ["a", "b", "c"].map((id, k) => st(id, 790 + k * 30)) }, { date: "2026-10-28", day: "wednesday", from: 840, to: 1020, stops: [st("c", 930, { pinned: "followup" })] }],
    venues: { a: { id: "a", name: "Nomadic Beerworks" }, b: { id: "b", name: "Pinthouse" }, c: { id: "c", name: "The Yard" } },
    statuses: { a: "visited", c: "visited" },
    outcomes: { a: { result: "interested", who: "Dana Ruiz", note: "Dana wants a case once the cooler is cleared", at: "2026-10-27T13:10" }, c: { result: "followup", followUp: "2026-10-28", followUpTime: "15:30", at: "2026-10-27T14:10" } },
    slots: {}, windows: [{ date: "2026-10-27" }, { date: "2026-10-28" }],
    profile: { visitMin: 25, brand: "Tidewell", what: "Non-alcoholic hazy IPA", pitch: { name: "Maya Ortiz" } },
  };
};
const polishPost = (body, e) => worker.fetch(new Request("https://doors.example/api/agent/debrief", { method: "POST", headers: { origin: "https://doors.example", "content-type": "application/json", "cf-connecting-ip": "203.0.113.7" }, body: JSON.stringify(body) }), e).then((r) => r.json());
test("Day done polish: one call, no tools, no names sent; doors it wasn't given and unbacked numbers are dropped; the contact's name comes back", async () => {
  const p = dayPlan();
  const body = polishBody(p, driveQueue(p, 0), recordOf({}, "2026-10-27"));
  assert.deepEqual(body.names.sort(), ["Dana Ruiz", "Maya Ortiz"]);
  const answer = JSON.stringify({ summary: "Two of 3 doors visited; The Yard tasting is tomorrow at 3:30 pm.", doors: [{ id: "d1", note: "Interested. The contact wants a case once the cooler is cleared." }, { id: "d3", note: "Follow up Wednesday at 3:30 pm." }, { id: "d9", note: "Invented door." }, { id: "d1", note: "They will order 12 cases." }], next: ["Bring cold cans to The Yard Wednesday at 3:30 pm.", "Call back on the 14th."] });
  const e = env([msg([text(answer)])]);
  const r = await polishPost(body, e);
  assert.equal(r.by, "anthropic");
  const req = e.ANTHROPIC_FETCH.seen[0].body;
  assert.deepEqual(req.tools, []);
  assert.doesNotMatch(JSON.stringify(req), /Dana|Maya|Ortiz/);
  assert.match(req.messages[0].content, /"id":"d1"/);
  assert.deepEqual(r.polished.doors.map((d) => [d.name, d.note]), [["Nomadic Beerworks", "Interested. Dana wants a case once the cooler is cleared."], ["The Yard", "Follow up Wednesday at 3:30 pm."]]);
  assert.deepEqual(r.polished.next, ["Bring cold cans to The Yard Wednesday at 3:30 pm."]); // "the 14th" is in no fact
  const v = polishView(r);
  assert.equal(v.doors.length, 2);
  assert.match(v.model, /Sonnet/); // round 3: Sonnet 5.5 by default
});
test("Day done polish: an empty day, no model, or a bad answer say so; the template stays the answer", async () => {
  const p = dayPlan();
  p.statuses = {}, p.outcomes = {};
  p.days[0].stops = [];
  assert.equal((await polishPost(polishBody(p, driveQueue(p, 0), recordOf({}, "2026-10-27")), env([]))).reason, "empty");
  const p2 = dayPlan();
  const b2 = polishBody(p2, driveQueue(p2, 0), recordOf({}, "2026-10-27"));
  const none = await polishPost(b2, {});
  assert.equal(none.resting, true);
  assert.ok(polishView(none).failed);
  const bad = await polishPost(b2, env([msg([text("Sorry, I can't.")])]));
  assert.equal(bad.resting, true);
  assert.equal((await polishPost({ nope: 1 }, env([]))).error, "Send {facts, profile}");
});

// ---------- web honesty (a repeated cited phrase, an invented "Woodbury location") ----------
import { webBacked, dedupeRepeats } from "../src/agent.js";
test("webBacked: a number or a proper name nothing in front of the model held fails; a page's own words pass", () => {
  const pool = "Low Down Lounge happy hour Monday 4:00 PM – 8:00 PM $2 Coors Nomadic Beerworks Austin";
  assert.equal(webBacked("Nomadic Beerworks also has a Woodbury location.", pool), false);
  assert.equal(webBacked("They pour $6 drafts.", pool), false);
  assert.equal(webBacked("Low Down Lounge runs $2 Coors at happy hour until 8 pm.", pool), true);
  assert.equal(webBacked("Ask the bartender on Tuesday what they keep in the cooler.", pool), true);
});
test("dedupeRepeats: a phrase or a sentence said twice is said once", () => {
  assert.equal(dedupeRepeats("The site advertises discounted cocktail, beer and frozen drink specials Discounted cocktail, beer and frozen drink specials., and more."), "The site advertises discounted cocktail, beer and frozen drink specials, and more.");
  assert.equal(dedupeRepeats("Go in short. Ask for one case. Go in short."), "Go in short. Ask for one case.");
});
test("a turn that searched the web: the invented branch is dropped, the cited fact stays with its link", async () => {
  const nomadic = byName("Nomadic Beerworks");
  const content = [
    { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "Nomadic Beerworks Austin" } },
    { type: "web_search_tool_result", tool_use_id: "s1", content: [{ type: "web_search_result", url: "https://nomadic.example/", title: "Nomadic Beerworks | Austin taproom" }] },
    { type: "text", text: "Their site says the taproom has trivia on Wednesdays.", citations: [{ type: "web_search_result_location", url: "https://nomadic.example/", title: "Nomadic Beerworks | Austin taproom", cited_text: "Trivia every Wednesday at 7 pm in the taproom." }] },
    { type: "text", text: " They also run a second location in Woodbury. Go Wednesday before trivia and ask for the buyer." },
  ];
  const e = env([msg(content)]);
  const r = await ask(e, "Does Nomadic Beerworks have other locations?", { ...ctx, current: nomadic });
  assert.doesNotMatch(r.reply, /Woodbury/);
  assert.match(r.reply, /trivia on Wednesdays/);
  assert.match(r.reply, /ask for the buyer/);
  assert.ok(r.facts.some((f) => f.source.kind === "web" && f.source.url === "https://nomadic.example/"));
});

// ---------- abilities 5 and 7: what to bring, plan the next trip ----------
const logged = () => {
  const c = structuredClone(ctx);
  const ids = c.day.stops.map((s) => s.id);
  Object.assign(c.doors[ids[1]], { status: "visited", outcome: { result: "interested", note: "I will bring the sell sheet Thursday" } });
  Object.assign(c.doors[ids[2]], { status: "visited", outcome: { result: "someone", note: "buyer in Tuesdays" } });
  Object.assign(c.doors[ids[3]], { status: "visited", outcome: { result: "no" } });
  c.doors[ids[4]].notes = [{ text: "I will bring a cold four-pack for the GM", by: "rep" }];
  return { c, ids };
};
test("what_to_bring: the doors left on the day, each with its kit; promises first-class; a sample each plus a spare", () => {
  const { c, ids } = logged();
  const r = runTool("what_to_bring", {}, c);
  assert.equal(r.ok, true);
  assert.equal(r.actions, undefined);
  assert.ok(!r.data.doors.some((d) => [ids[1], ids[2], ids[3]].includes(d.door_id)), "logged doors are done");
  assert.equal(r.data.samples, r.data.doors.length + 1);
  const sage = r.data.doors.find((d) => d.door_id === ids[4]);
  assert.deepEqual(sage.promised, ["I will bring a cold four-pack for the GM"]);
  assert.match(r.data.doors.find((d) => d.name === "Nomadic Beerworks").kit, /not a tap ask/);
  assert.ok(r.facts.some((f) => f.source.kind === "stated" && /four-pack/.test(f.text)));
});
test("next_trip: interested first, the buyer's day from the notes, a no left for later, the best first visits ahead", () => {
  const { c, ids } = logged();
  const r = runTool("next_trip", {}, c);
  assert.equal(r.data.go_back[0].door_id, ids[1]);
  assert.match(r.data.go_back[0].when, /first order/);
  assert.match(r.data.go_back.find((d) => d.door_id === ids[2]).when, /Tuesday/);
  assert.deepEqual(r.data.leave_for_now.map((d) => d.door_id), [ids[3]]);
  assert.ok(r.data.first_visits.length >= 1 && r.data.first_visits.every((d) => !c.doors[d.door_id].status));
  assert.ok(r.facts.length && r.facts.every((f) => f.source.field === "outcome"));
  // nothing logged: the first visits
  const fresh = runTool("next_trip", {}, structuredClone(ctx));
  assert.ok(Array.isArray(fresh.data.go_back ?? fresh.data.first_visits));
});
test("the system prompt names abilities 8, 6, 5 and 7", () => {
  assert.match(AGENT_SYSTEM, /Explain the trade[^\n]*ABC board/);
  assert.match(AGENT_SYSTEM, /The door's week[^\n]*search the web/);
  assert.match(AGENT_SYSTEM, /What to bring[^\n]*what_to_bring/);
  assert.match(AGENT_SYSTEM, /Plan the next trip[^\n]*next_trip/);
});

// ---------- web asks on Sonnet: one setting, bounded per visitor ----------
import { WEB_ASK, AGENT_WEB_VISITOR_DAILY } from "../src/agent.js";
test("with AGENT_MODEL=haiku: a web ask goes to Sonnet, any other ask to Haiku; past the visitor's daily cap, or AGENT_WEB_MODEL=off, Haiku", async () => {
  assert.ok(WEB_ASK.test("What's happening at Low Down Lounge this week?") && WEB_ASK.test("what's on tap at Pinthouse") && WEB_ASK.test("Who owns this place?"));
  assert.ok(!WEB_ASK.test("Prep my day") && !WEB_ASK.test("They said it's too pricey"));
  const modelOf = async (text, more = {}) => { const e = { ...env([msg([text_("ok, go in short.")])]), AGENT_MODEL: "claude-haiku-5-5", ...more }; await ask(e, text); return e.ANTHROPIC_FETCH.seen[0].body.model; }; // round 3: Sonnet is the default, so the web model only differs with Haiku set
  const text_ = (t) => ({ type: "text", text: t });
  assert.equal(await modelOf("What's on tap at Pinthouse Brewing?"), "claude-sonnet-5-5");
  assert.equal(await modelOf("Prep my day"), "claude-haiku-5-5");
  assert.equal(await modelOf("What's on tap at Pinthouse Brewing?", { AGENT_WEB_MODEL: "off" }), "claude-haiku-5-5");
  _resetAgent();
  for (let i = 0; i < AGENT_WEB_VISITOR_DAILY; i++) assert.equal(await modelOf("any events at Nomadic this week?"), "claude-sonnet-5-5");
  assert.equal(await modelOf("any events at Nomadic this week?"), "claude-haiku-5-5");
});
