// Judge pass 4 (#1) and the drinks-rep persona: Your rules leave the brand's own name alone, match word forms, keep the
// note's intro and sign-off, let the newest of two conflicting rules win, and never fall back to a line they ban.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPool, windowsFor } from "../public/lib/pool.js";
import { planDays } from "../public/lib/schedule.js";
import { stopModel } from "../public/lib/stopmodel.js";
import { noteFor } from "../public/lib/note.js";
import * as SL from "../public/lib/slots.js";
import { route, city, readJson } from "./helpers.mjs";
import { demoProfile } from "../public/lib/demo-profile.js";

const ab = route("athletic-brewing-austin");
const AUSTIN = city("austin");
const FACTS = readJson("public/data/facts.json").facts;
const NOW = Date.parse("2026-10-15T12:00:00Z");
const base = demoProfile(new Date(2026, 9, 12));
const kinfolk = { ...base, brand: "Kinfolk Kombucha", what: "sparkling kombucha, low sugar", pitch: { ...base.pitch, name: "Jordan Lee" } };
const rule = (field, value, at) => SL.makeRecord({ slot: "S6", field, value, source: "corrected", at });
function planWith(slots, prof = kinfolk) {
  const pool = buildPool({ routes: [ab], profile: prof, statuses: {}, outcomes: {}, cityName: "Austin" });
  const p = planDays({ pool: pool.rows, statuses: pool.statuses, windows: windowsFor(prof), visitMin: prof.visitMin, pinned: pool.pinned });
  return { ...p, venues: pool.venues, pool: { ids: pool.ids, N: pool.N, label: pool.label, drinker: pool.drinker }, statuses: pool.statuses, outcomes: {}, slots, profile: prof, city: { key: "austin", name: "Austin" }, windows: windowsFor(prof) };
}
const models = (plan) => plan.days.flatMap((d, i) => d.stops.map((s) => stopModel({ plan, id: s.id, dayIndex: i, city: AUSTIN, facts: FACTS, routes: [ab], now: NOW })));
const talkText = (m) => [...m.talk.before, m.talk.opener, ...(m.talk.toBuyer ? [m.talk.toBuyer] : []), ...m.talk.questions, ...m.talk.points.map((p) => p.text), ...m.talk.pushback.flatMap((p) => [p.objection, p.reply]), m.talk.ask].join("\n");

test("a 'say X, not Y' rule leaves the brand name alone, doesn't double a word, matches the plural and capitalises", () => {
  const ms = models(planWith({ "*": [rule("rule.term", { from: "kombucha", to: "sparkling tea" }, "2026-10-14T00:00:00Z")] }));
  assert.ok(ms.length > 3);
  for (const m of ms) {
    const all = `${talkText(m)}\n${m.note.subject}\n${m.note.body}\n${noteFor(m.note, "sms")}`;
    assert.doesNotMatch(all, /Kinfolk sparkling tea/i, `${m.venue.name}: the brand name is the rep's`);
    assert.doesNotMatch(all, /sparkling sparkling/i, m.venue.name);
    assert.doesNotMatch(all.replace(/Kinfolk Kombucha/g, ""), /kombucha/i, `${m.venue.name}: every other form is swapped`);
    assert.doesNotMatch(all, /(^|[“"]|[.!?] )sparkling tea/m, `${m.venue.name}: a sentence starts with a capital`);
    assert.match(m.note.subject, /^Kinfolk Kombucha, a sparkling tea, low sugar$/);
    assert.match(m.note.body, /Thanks,\nJordan$/);
    assert.match(m.note.body, /I'm Jordan with Kinfolk Kombucha, a sparkling tea, low sugar/);
  }
  assert.equal(SL.applyRule("What kombuchas do you carry right now?", { terms: [{ from: "kombucha", to: "sparkling tea" }] }), "What sparkling teas do you carry right now?");
  assert.equal(SL.applyRule("“Kombucha doesn't sell here.”", { terms: [{ from: "kombucha", to: "sparkling tea" }] }), "“Sparkling tea doesn't sell here.”");
});

test("a 'never say' rule never drops the note's intro or sign-off, and never hides the brand name", () => {
  const ms = models(planWith({ "*": [rule("rule.avoid", "kombucha", "2026-10-14T00:00:00Z")] }));
  for (const m of ms) {
    assert.match(m.note.body, /^Hi,\n\nI'm Jordan with Kinfolk Kombucha/, m.venue.name);
    assert.match(m.note.body, /Thanks,\nJordan$/, m.venue.name);
    assert.match(m.note.subject, /^Kinfolk Kombucha/);
    assert.doesNotMatch(`${talkText(m)}\n${m.note.body}`.replace(/Kinfolk Kombucha/g, ""), /kombucha/i, m.venue.name);
    assert.match(noteFor(m.note, "sms"), /Jordan from Kinfolk Kombucha/);
  }
});

test("conflicting rules: the newest wins (a later 'say X, not Y' replaces 'never say Y', and back)", () => {
  const avoidOld = rule("rule.avoid", "kombucha", "2026-10-13T00:00:00Z");
  const termNew = rule("rule.term", { from: "kombucha", to: "sparkling tea" }, "2026-10-14T00:00:00Z");
  let r = SL.rulesFrom({ "*": [avoidOld, termNew] }, "x", NOW);
  assert.deepEqual(r.avoid, []);
  assert.deepEqual(r.terms, [{ from: "kombucha", to: "sparkling tea" }]);
  const avoidNew = rule("rule.avoid", "Kombuchas", "2026-10-15T00:00:00Z");
  r = SL.rulesFrom({ "*": [avoidOld, termNew, avoidNew] }, "x", NOW);
  assert.deepEqual(r.avoid, ["Kombuchas"]);
  assert.deepEqual(r.terms, []);
  assert.deepEqual(SL.supersededRules({ "*": [avoidOld, termNew] }, "x", NOW).map((x) => x.at), [avoidOld.at]);
  // same minute (the chat stamps rules to the minute): the one saved later wins
  const sameA = rule("rule.avoid", "kombucha", "2026-10-14T00:00:00Z"), sameT = rule("rule.term", { from: "kombucha", to: "sparkling tea" }, "2026-10-14T00:00:00Z");
  assert.deepEqual(SL.rulesFrom({ "*": [sameA, sameT] }, "x", NOW).avoid, []);
  assert.deepEqual(SL.rulesFrom({ "*": [sameT, sameA] }, "x", NOW).avoid, ["kombucha"]);
  const m = models(planWith({ "*": [avoidOld, termNew] }))[0];
  assert.match(m.note.body, /a sparkling tea, low sugar/);
});

test("persona: a 'never say' rule is applied to the opener's fallback too (never say regulars)", () => {
  const ms = models(planWith({ "*": [rule("rule.avoid", "regulars", "2026-10-14T00:00:00Z")] }, base));
  for (const m of ms) {
    assert.doesNotMatch(m.talk.opener, /\bregulars?\b/i, m.venue.name);
    assert.ok(m.talk.opener.length > 10);
    assert.doesNotMatch(m.talk.ask, /\bregulars?\b/i);
  }
  for (const a of ["order", "buys", "whoever"]) {
    const m = models(planWith({ "*": [rule("rule.avoid", "regulars", "2026-10-14T00:00:00Z"), rule("rule.avoid", a, "2026-10-14T00:00:00Z")] }, base))[0];
    assert.doesNotMatch(`${m.talk.opener}\n${m.talk.ask}`, new RegExp(`\\b${a}`, "i"), a);
  }
});

// ---------- the chat: what it says when it keeps a rule, and coaching answers (judge pass 4 #1, #4) ----------
import { agentContext } from "../public/lib/agent-context.js";
import { answerByRules } from "../public/lib/agent-rules.js";
const ctxOf = (plan, { dayIndex = 0, current = null, at = `${plan.days[0].date}T09:00:00` } = {}) => agentContext({ plan, dayIndex, current, city: AUSTIN, routes: [ab], facts: FACTS, now: new Date(at) });
const ask = (ctx, text) => answerByRules([{ role: "user", text }], ctx, { now: `${ctx.today}T${ctx.now}` });

test("chat: a rule that replaces an earlier one says so, and a rule word in the brand name is left alone, out loud", () => {
  const plan = planWith({ "*": [rule("rule.avoid", "kombucha", "2026-10-13T00:00:00Z")] });
  // the browser's "now" has minute precision: a rule saved seconds ago reads as later than it (found in the real app)
  const just = planWith({ "*": [rule("rule.avoid", "kombucha", "2026-10-15T14:20:40Z")] });
  assert.match(ask(ctxOf(just, { at: "2026-10-15T14:20:00Z" }), "say sparkling tea, not kombucha").reply, /replaces your earlier rule/);
  const r = ask(ctxOf(plan), "say sparkling tea, not kombucha");
  assert.match(r.reply, /replaces your earlier rule \(never say “kombucha”\)/);
  assert.match(r.reply, /“kombucha” is in your brand name, Kinfolk Kombucha: I'll leave the name alone/);
  const plain = ask(ctxOf(planWith({})), "never say regulars");
  assert.doesNotMatch(plain.reply, /replaces|brand name/);
});

test("coaching: 'we already have a kombucha' answers that objection, not the drinker brand's pushback", () => {
  const ctx = ctxOf(planWith({}));
  const r = ask(ctx, "what should I say if they said we already have a kombucha");
  assert.doesNotMatch(r.reply, /when they say “We already have Athletic Brewing/);
  assert.match(r.reply, /already have (a )?kombucha/i);
  assert.match(r.reply, /second option/);
  assert.match(r.reply, /sparkling kombucha, low sugar/);
});

test("coaching: 'too expensive' gets a useful answer, never Doors' internal 'no price line'", () => {
  const noPrice = { ...kinfolk, pitch: { ...kinfolk.pitch, price: "" } };
  const r = ask(ctxOf(planWith({}, noPrice)), "what if they say it's too expensive");
  assert.doesNotMatch(r.reply, /no price line/i);
  assert.match(r.reply, /haven't set a price/i);
  assert.match(r.reply, /trial/);
  const priced = ask(ctxOf(planWith({}, { ...kinfolk, pitch: { ...kinfolk.pitch, price: "$38 a case of 24" } })), "what if they say it's too expensive");
  assert.doesNotMatch(priced.reply, /no price line/i);
  assert.match(priced.reply, /\$38 a case of 24/);
});

test("coaching answers target the rep's next door, not stop 1 of the day on screen", () => {
  const plan = planWith({});
  assert.ok(plan.days.length >= 2);
  const next = plan.days[0].stops[0];
  const viewed = plan.days[1].stops[0];
  const r = ask(ctxOf(plan, { dayIndex: 1 }), "what should I say if the owner isn't in");
  assert.match(r.reply, new RegExp(`At ${plan.venues[next.id].name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  assert.doesNotMatch(r.reply, new RegExp(`At ${plan.venues[viewed.id].name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
  // once the first door is visited, the next one is the second
  const after = { ...plan, statuses: { ...plan.statuses, [next.id]: "visited" } };
  const r2 = ask(ctxOf(after, { dayIndex: 1 }), "what should I say if the owner isn't in");
  assert.match(r2.reply, new RegExp(`At ${plan.venues[plan.days[0].stops[1].id].name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
});

// ---------- judge pass 4 (#17): the parser keeps a vague "next week" that isn't the follow-up's own words ----------
import { parseVisit, noteOf } from "../public/lib/visit-parse.js";
test("parser: 'call next week' keeps 'next week' in the note; 'come back next week' is still the follow-up", () => {
  const r = parseVisit("they'll think about it, call next week", { stop: { id: "x", name: "Easy Does It", date: "2026-10-22" }, now: { date: "2026-10-22", min: 900 }, windows: ["2026-10-23", "2026-10-27"] });
  assert.equal(r.visit.outcome.note, "they'll think about it, call next week");
  assert.equal(noteOf("done liked it said to come back next week"), "liked it");
  assert.equal(noteOf("liked it, back next week"), "liked it");
  assert.equal(noteOf("owner decides, email her in two weeks"), "owner decides, email her in two weeks");
  assert.equal(noteOf("done, back Thu 3pm, liked it, hesitant about price"), "liked it, hesitant about price");
});

// ---------- judge pass 4 (N12): the dish question rotates its wording down a day, so two rooms don't read as one template
test("openers: rooms on one day that lead with a dish never repeat the same wording back to back, and use every wording", () => {
  for (const prof of [kinfolk, base]) {
    const plan = planWith({}, prof);
    plan.days.forEach((d, i) => {
      const ms = d.stops.map((s) => stopModel({ plan, id: s.id, dayIndex: i, city: AUSTIN, facts: FACTS, routes: [ab], now: NOW }));
      const dish = ms.map((m) => m.talk.deep?.lead?.src?.[0]?.field === "tag:menu_highlight" ? m.talk.deep.lead.question.replace(/the .+?( here)?\?$/, "…") : null).filter(Boolean);
      for (let k = 1; k < dish.length; k++) assert.notEqual(dish[k], dish[k - 1], `${prof.brand} ${d.day}: ${dish.join(" | ")}`);
      if (dish.length >= 3) assert.equal(new Set(dish.slice(0, 3)).size, 3, `${prof.brand} ${d.day}: ${dish.join(" | ")}`);
    });
  }
});

// ---------- (persona capture): a SAMPLE=1 dev server reached Gemini from drive mode ----------
import { modelEnv } from "../scripts/dev/model-env.mjs";
test("dev server: SAMPLE=1 or NO_MODEL=1 never gets a model key, from the env or the key file", () => {
  const file = (n) => (n === "gemini-key" ? "FILEKEY" : undefined);
  assert.equal(modelEnv({ SAMPLE: "1" }, file).gemini, undefined);
  assert.equal(modelEnv({ NO_MODEL: "1" }, file).gemini, undefined);
  assert.equal(modelEnv({ SAMPLE: "1", GEMINI_API_KEY: "ENV" }, file).gemini, undefined);
  assert.equal(modelEnv({ SAMPLE: "1", WORKERS_AI: "1" }, file).workersAi, false);
  assert.equal(modelEnv({}, file).gemini, "FILEKEY");
  assert.equal(modelEnv({ NO_MODEL: "1", WORKERS_AI: "1" }, file).workersAi, true, "Workers AI alone stays an explicit opt-in");
});

// ---------- (persona REPORT 'Top changes' 6): a chain's drinks are bought by corporate ----------
import { isChain } from "../public/lib/core.js";
import { talkPoints } from "../public/lib/talk.js";
test("chains are tagged 'corporate buys' on the stop, and the talking points don't send the rep to the bartender", () => {
  for (const n of ["Applebee's Grill + Bar", "Applebee’s", "Buffalo Wild Wings", "Giordano's", "Chili's Grill & Bar", "Twin Peaks", "Dave & Buster's", "Hooters", "Yard House", "Herbalife Nutrition Club"]) assert.ok(isChain(n), n);
  for (const n of ["Nomadic Beerworks", "The Yard", "Kite String Cantina", "Chili Parlor Bar", "Applebeeswax Bar", "Hooterville Tavern"]) assert.ok(!isChain(n), n);
  const t = talkPoints({ venue: { name: "Applebee's Grill + Bar", genre: "urn:tag:genre:place:restaurant:american" }, profile: { brand: "Kinfolk Kombucha", what: "sparkling kombucha" } });
  assert.match(t.before[0], /chain.*corporate buys/i);
  assert.doesNotMatch(t.before[0], /bartender/);
  const plan = planWith({});
  const ids = Object.keys(plan.venues).filter((id) => isChain(plan.venues[id].name));
  for (const id of ids) {
    const m = stopModel({ plan, id, dayIndex: null, city: AUSTIN, facts: FACTS, routes: [ab], now: NOW });
    assert.ok(m.meta.includes("Chain · corporate buys"), m.venue.name);
  }
});
