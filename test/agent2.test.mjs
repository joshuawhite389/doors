// Round 3, lane agent2 (ROUND3-SPEC.md §3 "the Agent gets the same"; WHY-VIZ-SPEC §4.5 the agent ask). Sonnet by
// default with the cap raised; every door's Qloo facts and the enrich lane's record in the prompt; the loose rules
// (numbers stand when backed, Qloo's crowd words stand as Qloo's, a door's name is never "about people"); and the
// "why aren't these on my plan" ask: the Worker checks lib/whyviz/thread.js threadAsk and rebuilds each fix from the
// table, the rules' text equals threadAnswer's, the model path keeps a per-door answer with the table's fixes and falls
// back to the rules' text on any fix outside it. No network.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.js";
import { AGENT_MODEL, AGENT_USD_DAILY, MAX_BODY, cleanContext, cleanWhyNot, promptOf, whyNotNet, cleanReply, hoursWords, agentTurn, _resetAgent } from "../src/agent.js";
import { PRICE_PER_M, usdOf } from "../src/spend.js";
import { agentContext, insightForAgent, aboutForAgent, fixKeyOf, whyNotFixOf, whyNotPick } from "../public/lib/agent-context.js";
import { answerByRules, answerFirst, whyNotText } from "../public/lib/agent-rules.js";
import { threadModel, threadAsk, threadAnswer, FIX_ROWS } from "../public/lib/whyviz/thread.js";
import { sieve } from "../public/lib/sieve.js";
import { demoContext } from "./agent-fixture.mjs";
import { route, city } from "./helpers.mjs";

const austin = route("athletic-brewing-austin"), c = city("austin");
const ASK = "Why aren't these on my plan?";
let cache = null;
async function demo() {
  if (cache) return cache;
  const { plan, ctx } = await demoContext();
  const sv = sieve({ route: austin, plan, profile: plan.profile, city: c });
  const m = threadModel({ sv, plan, city: c, route: austin, profile: plan.profile });
  return (cache = { plan, ctx, m, ask: threadAsk(m, m.sel, { cityName: "Austin" }) });
}
const inTable = (text) => FIX_ROWS.some((r) => { const t = r.text({}); return t && (text === t || (r.key === "closed" && /^Add a day it's open and Doors will place it( \(open .*\))?\.$/.test(text)) || (r.key === "route" && /^Lock it to \S+ and Doors re-routes the rest around it\.$/.test(text)) || (r.key === "type" && /^Add .+ to the door types you pitch\.$/.test(text))); });
const post = (body, env) => worker.fetch(new Request("http://localhost:8792/api/agent", { method: "POST", headers: { origin: "http://localhost:8792", "content-type": "application/json", "cf-connecting-ip": "10.2.2.2" }, body: JSON.stringify(body) }), env).then((r) => r.json());
// an Anthropic answer, stubbed at the fetch (the Claude path is the loose one; the AGENT_SESSION stub is the free models')
const text = (t) => ({ type: "text", text: t });
const msg = (content) => ({ id: "m", type: "message", role: "assistant", content, stop_reason: "end_turn", usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } });
const claude = (answers) => ({ ANTHROPIC_API_KEY: "sk-test", TODAY: "2026-10-27", ANTHROPIC_FETCH: (() => { let i = 0; return async () => Response.json(answers[Math.min(i++, answers.length - 1)]); })() });

test("round 3: Sonnet 5.5 by default, Opus priced, the day's cap at $30, the body cap at 192 KB", () => {
  assert.equal(AGENT_MODEL, "claude-sonnet-5-5");
  assert.deepEqual(PRICE_PER_M["claude-opus-5-5"], [5, 25, 0.5, 6.25]); // talk2's figure ($5 / $25 per M); third-party lists said $4 / $20 on 10-25
  assert.ok(usdOf({ input_tokens: 1e6 }, "claude-opus-5-5") > usdOf({ input_tokens: 1e6 }, "claude-sonnet-5-5"));
  assert.equal(AGENT_USD_DAILY, 30);
  assert.equal(MAX_BODY, 192 * 1024);
});

test("every door's Qloo facts reach the prompt: kind, popularity in words, hours by day, the whole crowd line, description, menu; the off-day doors too", async () => {
  const { ctx } = await demo();
  const cc = cleanContext(ctx);
  const p = promptOf([{ role: "user", text: "Give me one angle for Pinthouse Brewing that I couldn't use at any other door." }], cc);
  assert.match(p, /"name":"Pinthouse Brewing","kind":"brewpub"/);
  assert.match(p, /"popularity":"well known"/); // round 3: words only, the model never sees 0.88
  assert.match(p, /"hours":"Mon 11 am–10 pm; Tue 11 am–10 pm; [^"]*Sun [^"]*"/); // the raw JSON cut at 300 chars lost Tuesday (eval after-v1 #1)
  assert.match(p, /Who goes \(Qloo\): The restaurant serves a broad demographic, attracting local residents, families seeking a community-oriented environment, and beer enthusiasts\. It is popular among/); // the whole line, not its first sentence
  assert.match(p, /Qloo's description: Bright contemporary brewpub/);
  assert.match(p, /Menu highlights \(Qloo's menu tags\): Pizza rolls/);
  assert.match(p, /Its own site: pinthouse\.com/);
  // a door off the day (a light door before round 3) carries its facts too
  const off = Object.entries(cc.doors).find(([id, v]) => v.plan && !v.plan.on && !cc.day.stops.some((s) => s.id === id));
  assert.ok(off, "an off-plan door in the context");
  assert.match(p, new RegExp(`"name":"${off[1].name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^\\n]*"why_not":"Stopped at`));
  assert.ok(off[1].about && off[1].place, "about and place on a light door");
  assert.equal(hoursWords('{"monday":[{"opens":"T11:00:00","closes":"T21:00:00","closed":false}],"tuesday":[{"opens":null,"closes":null,"closed":true}]}'), "Mon 11 am–9 pm; Tue closed");
  assert.equal(hoursWords("no hours listed"), null);
  assert.deepEqual(aboutForAgent({ genre: "urn:tag:genre:place:restaurant:brewpub", description: "x", tags: { menu: ["a", "b"] }, liveMusic: true, rating: 4.66, website: "https://www.pinthouse.com/menu" }), { kind: "brewpub", description: "x", menu: ["a", "b"], liveMusic: true, rating: 4.7, site: "pinthouse.com" });
});

test("the enrich lane's record (lib/enrich.js shape) becomes insight lines with their source; the Worker keeps them; the prompt shows them", async () => {
  const rec = { v: 1, id: "x", name: "Pinthouse Brewing", at: "2026-10-25", qloo: { basis: "door", drinks: [{ name: "Athletic Brewing", cat: "non-alcoholic" }], tags: { music: ["indie rock"] } }, vsCity: { doors: 40, drinks: [{ name: "Athletic Brewing", cat: "non-alcoholic", lift: 3.2 }], cats: [{ cat: "non-alcoholic", lift: 1.8 }], ages: [{ band: "25_to_29", diff: 0.25 }], gender: null, tags: { music: ["indie rock"] }, brands: [{ name: "Patagonia" }] }, site: { url: "https://pinthouse.com/", fetched: "2026-10-25", ok: true, facts: [{ k: "brews_own", text: "Brews its own beer on site.", quote: "we brew our own beer on site", from: "https://pinthouse.com/" }] } };
  const i = insightForAgent(rec, "Austin");
  // lib/enrich.js enrichFacts' lines, prep ones marked (the rep's eyes only), the site's cited
  assert.ok(i.lines.some((l) => /^Drink brands its crowd rates that few bars here share \(for your eyes, not the room\): Athletic Brewing \(non-alcoholic, 3\.2×\)$/.test(l)), i.lines.join("\n"));
  assert.ok(i.lines.some((l) => /^Drink kinds this crowd over-indexes on \(vs this city's bars\) \(for your eyes, not the room\): non-alcoholic \(1\.8× the city's bars\)$/.test(l)));
  assert.ok(i.lines.some((l) => /^Age skew vs this city's bars \(for your eyes, not the room\): more 25–29 \(\+0\.25 vs the city's bars\)$/.test(l)));
  assert.ok(i.lines.some((l) => /^Makes its own \(its own website\): Brews its own beer on site\.$/.test(l)));
  assert.ok(i.lines.some((l) => /for your eyes, not the room\): Patagonia$/.test(l)));
  assert.deepEqual(i.site, { url: "https://pinthouse.com/", captured: "2026-10-25" });
  assert.match(insightForAgent({ qloo: { basis: "area", drinks: [{ name: "Shiner", cat: "beer" }] } }, "Austin").lines.join("\n"), /its part of town \(Qloo doesn't read this door's own crowd\)[^\n]*: Shiner \(beer\)/);
  assert.equal(insightForAgent({ qloo: { basis: "none", drinks: [] }, vsCity: null, site: null }), null);
  assert.equal(insightForAgent(null), null);
  // on the venue (or the city file's enrich map) → the context → the Worker → the prompt
  const { plan } = await demoContext();
  const id = Object.keys(plan.venues).find((x) => plan.venues[x].name === "Pinthouse Brewing");
  plan.venues[id] = { ...plan.venues[id], enrich: rec };
  const ctx = agentContext({ plan, dayIndex: 0, city: c, routes: [austin], now: new Date(`${plan.days[0].date}T12:30:00`) });
  assert.equal(ctx.doors[id].insight.lines.length, i.lines.length);
  const cc = cleanContext(ctx);
  assert.deepEqual(cc.doors[id].insight.site, { url: "https://pinthouse.com/", captured: "2026-10-25" });
  const p = promptOf([{ role: "user", text: "Brief me on Pinthouse Brewing." }], cc);
  assert.match(p, /"insight":\["Drink kinds this crowd over-indexes on/);
  assert.match(p, /"insight_source":"https:\/\/pinthouse\.com\/ \(read 2026-10-25\)"/);
  // the page's own shape: enrich = {id: enrichFacts(record)} (ui/stop.js loadStopData) wins over a record on the venue
  const { enrichFacts } = await import("../public/lib/enrich.js");
  const viaPage = agentContext({ plan, dayIndex: 0, city: c, routes: [austin], enrich: { [id]: enrichFacts(rec) }, now: new Date(`${plan.days[0].date}T12:30:00`) });
  assert.deepEqual(viaPage.doors[id].insight.lines, i.lines);
  assert.equal(viaPage.doors[id].insight.site.url, "https://pinthouse.com/");
  const viaCity = agentContext({ plan: { ...plan, venues: { ...plan.venues, [id]: { ...plan.venues[id], enrich: undefined } } }, dayIndex: 0, city: { ...c, enrich: { doors: { [id]: rec } } }, routes: [austin], now: new Date(`${plan.days[0].date}T12:30:00`) });
  assert.equal(viaCity.doors[id].insight.lines.length, i.lines.length);
});

test("loose rules: a backed number stands, Qloo's crowd words stand as Qloo's, a door's name is never 'about people'", async () => {
  const { ctx } = await demo();
  const cc = cleanContext(ctx);
  const t = "White Tiger is closed Tuesday. Qloo says the crowd is young professionals and families. The buyer is a young guy.";
  const out = cleanReply(t, cc, { facts: [], words: "", asked: "", shown: "", actions: [] }, { loose: true });
  assert.match(out, /^White Tiger is closed Tuesday\. Qloo says the crowd is young professionals and families\.$/);
  // round 3: the Agent's (loose) replies lose a 0.xx score too; the rank stays
  assert.equal(cleanReply("It is #3 of 55 on Your list, popularity 0.15.", cc, { facts: [], words: "rank 3 of 55 popularity 0.15", asked: "why?", shown: "", actions: [] }, { loose: true }), "It is #3 of 55 on Your list.");
  assert.equal(cleanReply("Qloo ranks it #3 of 55.", cc, { facts: [], words: "why?", asked: "why?", shown: "", actions: [] }, { loose: true }), ""); // a number nothing shown backs
});

test("§4.5: the Worker checks threadAsk and rebuilds every fix from the table; a forged fix never gets through", async () => {
  const { ask } = await demo();
  assert.equal(ask.selected.name, "Nomadic Beerworks");
  const forged = structuredClone(ask);
  forged.doors[0].fix.text = "Ask them to open on Tuesdays for you.";
  forged.doors.push({ id: "__proto__", name: "x", rank: 1 });
  const w = cleanWhyNot(forged);
  assert.equal(w.doors.length, ask.doors.length);
  assert.equal(w.doors[0].name, "Growler Express");
  assert.equal(w.doors[0].fix.text, "Raise that day's cap or add a day.");
  assert.deepEqual(w.doors.map((d) => d.fix?.text), ask.doors.map((d) => d.fix?.text));
  for (const d of w.doors) if (d.fix) assert.ok(inTable(d.fix.text), d.fix.text);
  assert.equal(w.onPlan.length, ask.onPlan.length);
  assert.equal(cleanWhyNot(null), null);
  assert.equal(cleanWhyNot({ selected: { id: "nope!" } }), null);
  // the key by the door's own fields, as thread.js picks it
  assert.equal(fixKeyOf({ big: true }), "famous");
  assert.equal(fixKeyOf({ rank: 3, fate: "route", code: "full" }), "full");
  assert.equal(fixKeyOf({ rank: 3, fate: "known", code: "visited" }), "status");
  assert.equal(fixKeyOf({ type: "restaurants", pitched: false, genre: "Sushi" }), "restaurants");
  assert.equal(fixKeyOf({ type: "bars", pitched: true, code: "nowhere" }), "nowhere");
  assert.equal(fixKeyOf({}), "unranked");
  assert.equal(whyNotFixOf({ rank: 3, fate: "known" }), null);
  assert.equal(whyNotFixOf({ rank: 3, fate: "route", code: "nearer" }, { day: "Tuesday" }).text, "Lock it to Tuesday and Doors re-routes the rest around it.");
  assert.equal(whyNotFixOf({ rank: 3, fate: "open", code: "closed", open: ["Saturday"] }).text, "Add a day it's open and Doors will place it (open Saturday).");
  // a route fix's day is read back from the client's text, nothing else is
  const locked = cleanWhyNot({ ...ask, doors: [{ id: ask.doors[0].id, name: "X", rank: 4, fate: "route", code: "nearer", fix: { text: "Lock it to Wednesday and Doors re-routes the rest around it." } }] });
  assert.equal(locked.doors[0].fix.text, "Lock it to Wednesday and Doors re-routes the rest around it.");
  assert.equal(cleanWhyNot({ ...ask, doors: [{ ...locked.doors[0], fix: { text: "Lock it to Evil and Doors re-routes the rest around it." } }] }).doors[0].fix.text, "Lock it to that day and Doors re-routes the rest around it.");
});

test("§4.5: with no model the rules answer is threadAnswer's text, word for word, with the payload for the panel's buttons", async () => {
  const { ctx, ask, m } = await demo();
  const cc = cleanContext({ ...ctx, whynot: ask });
  const expected = threadAnswer(m, m.sel, { cityName: "Austin" });
  const r = answerByRules([{ role: "user", text: ASK }], cc);
  assert.equal(r.reply, expected.text);
  assert.equal(whyNotText(cc.whynot), expected.text);
  assert.match(r.reply, /^4 of the 9 doors that share Nomadic Beerworks's crowd aren't on your plan\. Each one's reason, and what would change it:\n- Growler Express \(#3 on Your list\): Tuesday had no time left for it\. Raise that day's cap or add a day\.\n/);
  assert.match(r.reply, /\nMy pick: Growler Express first\. #3 for your drinker, almost unknown, the same crowd as Nomadic Beerworks\. Raise that day's cap or add a day\.$/);
  assert.equal(r.whynot.pick, whyNotPick(cc.whynot).id);
  assert.equal(r.whynot.doors.length, 4);
  for (const d of r.whynot.doors) if (d.fix) assert.ok(inTable(d.fix.text) && d.fix.act, d.fix.text);
  assert.equal(r.facts.length, 4);
  // the ask goes to the model when one is up; the rules take it when none is
  assert.equal(answerFirst([{ role: "user", text: ASK }], cc, { model: true }), null);
  assert.equal(answerFirst([{ role: "user", text: ASK }], cc, { model: false }).reply, expected.text);
  _resetAgent();
  const turn = await agentTurn({ messages: [{ role: "user", text: ASK }], ctx: cc, env: {} });
  assert.equal(turn.by, "rules");
  assert.equal(turn.reply, expected.text);
});

test("§4.5: the model path: the prompt carries each door's fix; a per-door answer with the table's fixes stands; a fix outside the table → the rules' text", async () => {
  const { ctx, ask } = await demo();
  const context = { ...ctx, whynot: ask };
  const cc = cleanContext(context);
  const p = promptOf([{ role: "user", text: ASK }], cc);
  assert.match(p, /"why_not_ask":\{"about":"Nomadic Beerworks","doors_that_share_its_crowd":9,"on_your_plan":\[/);
  assert.match(p, /"name":"Growler Express","rank":"#3 on Your list","reason":"Tuesday had no time left for it\.","fix":"Raise that day's cap or add a day\.","popularity":"almost unknown"/);
  assert.match(p, /"pick":"Growler Express"/);
  assert.match(p, /why_not_ask in CONTEXT: answer per door/);
  const good = `${whyNotText(cc.whynot)}`;
  const run = async (t) => { _resetAgent(); return post({ v: 1, messages: [{ role: "user", text: ASK }], context }, claude([msg([text(t)])])); };
  const ok = await run(good);
  assert.equal(ok.by, "anthropic");
  assert.equal(ok.reply, good);
  assert.equal(ok.whynot.fallback, undefined);
  assert.equal(ok.whynot.pick, whyNotPick(cc.whynot).id);
  // the model's own words around the table's fixes stand too; a missing pick gets the rules' pick
  const own = good.split("\n").slice(0, -1).map((l) => l.replace("Tuesday had no time left for it.", "Tuesday ran out before it, and it's close to Nomadic.")).join("\n");
  const o = await run(own);
  assert.match(o.reply, /Tuesday ran out before it, and it's close to Nomadic\. Raise that day's cap or add a day\./);
  assert.match(o.reply, /\nMy pick: Growler Express first\./);
  assert.equal(o.whynot.fallback, undefined);
  // a fix the table doesn't hold, a door's line carrying another door's fix, a fix on a line with no door: the rules' text
  for (const bad of [good.replace("Raise that day's cap or add a day.\n", "Ask them to open Tuesdays for you.\n"), good.replace("Raise that day's cap or add a day.\n", "Include the most popular doors to put it on, or come back once you have reorders.\n"), `${good}\nAlso: Lock it to Tuesday and Doors re-routes the rest around it.`, "Nothing to say."]) {
    const b = await run(bad);
    assert.equal(b.reply, good, bad.slice(0, 60));
    assert.equal(b.whynot.fallback, true);
  }
  assert.equal(whyNotNet(good, cc.whynot).fallback, undefined);
  assert.equal(whyNotNet("", cc.whynot).fallback, true);
});

// Round 3 (gigbot 10-25; Jard 10-23: decimals are "super confusing"): no Qloo 0.xx score anywhere the rep reads, or the
// model reads (it repeats what it reads). Ranks and plain words stay. Money ("$1.58") and ABV ("0.5%") are not scores.
test("no 0.xx score in the Agent's replies, the whynot text, the facts under a reply or the model's view of a door", async () => {
  const DEC = /(?<![\d$])0?\.\d{2}\b(?!\s*%)/;
  const { doorFacts } = await import("../public/lib/agent-tools.js");
  const { ctx, ask } = await demo();
  const cc = cleanContext({ ...ctx, whynot: ask });
  // the whynot text, rules and model view
  assert.doesNotMatch(whyNotText(cc.whynot), DEC);
  assert.doesNotMatch(answerByRules([{ role: "user", text: ASK }], cc).reply, DEC);
  const p = promptOf([{ role: "user", text: ASK }], cc);
  assert.doesNotMatch(p, /"(popularity|affinity)":"?0?\.\d/);
  assert.doesNotMatch(promptOf([{ role: "user", text: "Give me one angle for Pinthouse Brewing." }], cleanContext(ctx)), /"(popularity|affinity)":"?0?\.\d/);
  // every door's facts (the Sources under a reply)
  for (const id of Object.keys(ctx.doors)) for (const f of doorFacts(cleanContext(ctx), id)) if (/^(affinity|popularity|rank)$/.test(f.source?.field)) assert.doesNotMatch(f.text, DEC, f.text);
  // the rules, asked for the numbers too
  for (const q of ["why is Pinthouse Brewing first?", "what's Pinthouse Brewing's affinity score?", "compare the affinity scores of Pinthouse Brewing and Nomadic Beerworks", "how popular is Growler Express?"])
    assert.doesNotMatch(answerByRules([{ role: "user", text: q }], cleanContext(ctx)).reply, DEC, q);
  // the Agent's own words (live Sonnet 10-25), asked for the numbers or not: the score goes, the rank and the rest stay
  const live = "They're #2 of 55 on Your list, with 0.90 affinity and 0.88 popularity, so expect a buyer who sees a lot of reps. Get a name.\nMy pick: Growler Express first. It's #3 of 55 on Your list, popularity 0.15 so almost unknown, and it shares Nomadic Beerworks' crowd. At $38 a case, that's $1.58 a can.";
  for (const words of ["why?", "what's its affinity score?"]) {
    const out = cleanReply(live, cc, { facts: [], words: `rank 2 of 55 rank 3 of 55 ${words}`, asked: words, shown: "", actions: [] }, { loose: true }); // the ranks backed, as a tool result would
    assert.doesNotMatch(out, DEC, out);
    assert.match(out, /#2 of 55 on Your list/);
    assert.match(out, /#3 of 55 on Your list/);
    assert.match(out, /\$1\.58 a can/);
  }
});
