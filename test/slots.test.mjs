// R9 cultural slots (docs/CULTURAL-SLOTS.md): the slot record, authority and expiry, visit memory, the return visit,
// the SMS version, corrections, the envelope and the agent's checks. The §7 scenarios (swap, ablation,
// label-invariance, empty slot, correction) run on the real Austin data with the demo brand.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPool, windowsFor } from "../public/lib/pool.js";
import { planDays } from "../public/lib/schedule.js";
import { BANNED_PITCH } from "../public/lib/core.js";
import { stopModel } from "../public/lib/stopmodel.js";
import { noteFor, smsHref, SMS_MAX } from "../public/lib/note.js";
import { makeOutcome } from "../public/lib/outcome.js";
import { createStore } from "../public/lib/store.js";
import * as SL from "../public/lib/slots.js";
import { arrivalAdvice } from "../public/lib/talk.js";
const adviceFor = (eta, type, span) => arrivalAdvice(eta, "(512) 555-0100", span, 0, type);
import { route, city, readJson } from "./helpers.mjs";
import { demoProfile } from "../public/lib/demo-profile.js";

const ab = route("athletic-brewing-austin");
const AUSTIN = city("austin");
const FACTS = readJson("public/data/facts.json").facts;
const NOMADIC = "00000000-0000-4000-8000-271655E6AA28";
const TUE = "2026-10-13", THU = "2026-10-15";
const NOW = Date.parse("2026-10-15T12:00:00Z");
const profile = demoProfile(new Date(2026, 9, 12)); // Tue Oct 13 1–6 pm, Wed 14, Thu 15; Maya Ortiz, Tidewell
function planFor({ statuses = {}, outcomes = {}, slots = {}, prof = profile } = {}) {
  const pool = buildPool({ routes: [ab], profile: prof, statuses, outcomes, cityName: "Austin" });
  const windows = windowsFor(prof, { today: "2026-10-12" });
  const p = planDays({ pool: pool.rows, statuses: pool.statuses, windows, visitMin: prof.visitMin, pinned: pool.pinned });
  return { ...p, venues: pool.venues, pool: { ids: pool.ids, N: pool.N, label: pool.label, drinker: pool.drinker }, statuses: pool.statuses, outcomes, slots, profile: prof, city: { key: "austin", name: "Austin" }, windows };
}
const dayOfId = (plan, id, from = 0) => plan.days.findIndex((d, i) => i >= from && d.stops.some((s) => s.id === id));
const sm = (plan, id, day, extra = {}) => stopModel({ plan, id, dayIndex: day, city: AUSTIN, facts: FACTS, routes: [ab], now: NOW, ...extra });

// A Tuesday visit to Nomadic, logged as the demo's follow-up; Thursday is the return.
const visitOutcome = (o = {}) => makeOutcome({ result: "followup", followUp: THU, who: "Sam (taproom manager)", note: "liked it, hesitant about price", at: "2026-10-13T20:10:00Z", ...o });
function returnCase(o = {}, slots = {}) {
  const outcomes = { [NOMADIC]: visitOutcome(o) };
  const plan = planFor({ statuses: { [NOMADIC]: "visited" }, outcomes, slots });
  const k = dayOfId(plan, NOMADIC, 1);
  return { plan, k };
}
const allText = (m) => [...m.talk.before, m.talk.opener, ...m.talk.questions, ...m.talk.points.map((p) => p.text), ...m.talk.pushback.flatMap((p) => [p.objection, p.reply]), m.talk.ask, m.note.subject, m.note.body].join("\n");

// ---------- the record ----------
test("slot record: expiry by source (stated 60 d, contact 180 d, corrected never), authority order", () => {
  const at = "2026-10-01T00:00:00Z";
  assert.equal(SL.makeRecord({ slot: "S4", field: "said", value: "x", source: "stated", at }).expires, "2026-11-30T00:00:00.000Z");
  assert.equal(SL.makeRecord({ slot: "S4", field: "contact", value: { name: "Sam" }, source: "stated", at }).expires, "2027-03-30T00:00:00.000Z");
  assert.equal(SL.makeRecord({ slot: "S6", field: "rule.avoid", value: "price", source: "corrected", at }).expires, null);
  const slots = {
    d: [
      SL.makeRecord({ slot: "S4", field: "objection", value: { kind: "price" }, source: "stated", at: "2026-10-10T00:00:00Z" }),
      SL.makeRecord({ slot: "S4", field: "objection", value: { kind: "space" }, source: "corrected", at: "2026-10-02T00:00:00Z" }),
      SL.makeRecord({ slot: "S4", field: "objection", value: { kind: "local" }, source: "inferred", at: "2026-10-12T00:00:00Z" }),
    ],
  };
  assert.equal(SL.resolve(slots, "d", "objection", NOW).value.kind, "space", "a correction beats a newer statement and a newer guess");
  slots.d.splice(1, 1);
  assert.equal(SL.resolve(slots, "d", "objection", NOW).value.kind, "price", "stated beats inferred");
  assert.equal(SL.resolve(slots, "d", "objection", Date.parse("2027-01-01")), null, "expired records don't count");
});

test("agent-writable list: only the listed slots, each with its source; nothing inferred about a person", () => {
  const r = (slot, field, value, source) => ({ slot, field, value, source });
  assert.ok(SL.validateRecord(r("S4", "contact", { name: "Sam", role: "owner" }, "stated"), { agent: true }).ok);
  assert.ok(SL.validateRecord(r("S6", "rule.term", { from: "NA", to: "alcohol-free" }, "corrected"), { agent: true }).ok);
  assert.ok(!SL.validateRecord(r("S4", "contact", { name: "Sam" }, "corrected"), { agent: true }).ok, "wrong source");
  assert.ok(!SL.validateRecord(r("S2", "crowd", "young", "qloo"), { agent: true }).ok, "not writable");
  assert.ok(!SL.validateRecord(r("S4", "mood", "grumpy", "stated"), { agent: true }).ok, "no person traits");
  assert.ok(!SL.validateRecord(r("S4", "contact", { name: "Sam" }, "inferred")).ok);
  assert.ok(!SL.validateRecord(r("S6", "note.sms", "x".repeat(321), "corrected"), { agent: true }).ok, "SMS cap");
});

test("visit memory from an outcome: contact and role, objection kind with the rep's words, said, next", () => {
  const rs = SL.fromOutcome(visitOutcome());
  const by = Object.fromEntries(rs.map((r) => [r.field, r]));
  assert.deepEqual(by.contact.value, { name: "Sam", role: "taproom manager" });
  assert.deepEqual(by.objection.value, { kind: "price", words: "liked it, hesitant about price" });
  assert.equal(by.said.value, "liked it, hesitant about price");
  assert.equal(by.next.value, THU);
  assert.ok(rs.every((r) => r.source === "stated"));
  assert.deepEqual(SL.contactOf("Sam, the owner"), { name: "Sam", role: "owner" });
  assert.deepEqual(SL.contactOf("Jo Anne"), { name: "Jo Anne" });
  for (const [t, k] of [["no room in the cooler", "space"], ["only local brands", "local"], ["need to ask the owner", "owner"], ["NA doesn't sell here", "nosell"], ["they already have Athletic", "already"], ["nice chat", null]]) assert.equal(SL.objectionOf(t), k, t);
});

// ---------- §7.1 swap ----------
test("W1 swap: first visit ↔ return visit at Nomadic Beerworks changes the opener, who to ask for, pushback, note", () => {
  const p0 = planFor();
  const k0 = dayOfId(p0, NOMADIC);
  assert.ok(k0 >= 0, "Nomadic is on the plan");
  const a = sm(p0, NOMADIC, k0);
  const { plan, k } = returnCase();
  assert.ok(k >= 1, "the follow-up lands on Thursday");
  const b = sm(plan, NOMADIC, k);
  assert.equal(a.talk.visit, "first");
  assert.equal(b.talk.visit, "return");
  assert.match(a.talk.opener, /^(Hi|Hey), I'm Maya with Tidewell/);
  // personas, final round: the return opener comes from what was logged (here: price), never "think it over?"
  assert.equal(b.talk.opener, "Good to see you again, Sam. I brought the price sheet, so we can look at the numbers together.");
  assert.match(b.talk.before[0], /^Ask for Sam \(taproom manager\): you talked on Tue Oct 13\.$/);
  assert.ok(b.talk.before.includes("Your note from last time: “liked it, hesitant about price”."));
  assert.equal(b.talk.pushback[0].from, "memory");
  // the start is the ask the notes use (R9 proof finding 1); the case price rides along because the ask is a case
  assert.match(b.talk.pushback[0].reply, /^Start with one case of cans in the cooler \(\$38 a case of 24\)/);
  assert.equal(b.talk.questions[0], "What's missing on your list right now?");
  assert.match(b.note.body, /^Hi Sam, it's Maya from Tidewell again: thanks for your time on Tuesday\./);
  assert.match(b.note.body, /price sheet/);
  assert.doesNotMatch(b.note.body, /Looks like|I'm Maya|we're opening/);
  assert.ok(b.note.body.length < a.note.body.length, "the return note is shorter");
  assert.deepEqual(b.talk.memoryUsed.sort(), ["contact", "objection", "said"]);
  for (const m of [a, b]) assert.equal(m.rankLine, a.rankLine), assert.deepEqual(m.talk.facts, a.talk.facts);
  assert.doesNotMatch(allText(b), BANNED_PITCH);
  assert.doesNotMatch(allText(b), /undefined|null|NaN|\[object/);
});

test("W2 swap: the logged objection decides the first pushback", () => {
  const replies = {};
  for (const note of ["too pricey for us", "no room in the cooler", "we only do local brands", "need to ask the owner"]) {
    const { plan, k } = returnCase({ note });
    replies[note] = sm(plan, NOMADIC, k).talk.pushback[0].reply;
  }
  assert.equal(new Set(Object.values(replies)).size, 4, JSON.stringify(replies, null, 1));
});

test("W3 swap: email ↔ SMS — the text is ≤ 320 characters, keeps the ask and the name; email unchanged", () => {
  const p0 = planFor();
  for (const [plan, id, k] of [[p0, NOMADIC, dayOfId(p0, NOMADIC)], [returnCase().plan, NOMADIC, returnCase().k]]) {
    const m = sm(plan, id, k);
    const n = m.note;
    const sms = noteFor(n, "sms");
    assert.ok(sms.length <= SMS_MAX, `${sms.length}: ${sms}`);
    assert.ok(sms.length < n.body.length / 1.5, "much shorter than the email");
    // the product ask: never in a first text; in a return text only once the rep logged "interested" (Jard 10-24 #5)
    if (m.talk.visit === "first" || plan.outcomes?.[id]?.result !== "interested") assert.doesNotMatch(sms, /one case of cans in the cooler/);
    else assert.match(sms, /one case of cans in the cooler/);
    assert.doesNotMatch(sms, /~|\d:(?!30)\d\d/, "times as a person says them");
    assert.match(sms, /– Maya$/);
    assert.equal(noteFor(n, "email"), n.body);
    assert.match(decodeURIComponent(smsHref(n, "(512) 555-0100")), new RegExp(`body=${sms.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
  }
  const long = { parts: { hello: "Hi " + "x".repeat(300), when: "w", ask: "a", sign: "Maya" } };
  assert.ok(noteFor(long, "sms").length <= SMS_MAX);
});

test("W6: same inputs → identical output", () => {
  const { plan, k } = returnCase();
  assert.deepEqual(sm(plan, NOMADIC, k), sm(plan, NOMADIC, k));
});

// ---------- §7.2 ablation ----------
test("ablation: each slot off restores the pre-R9 lines; on, it changes at least one", () => {
  const { plan, k } = returnCase({}, { "*": [SL.makeRecord({ slot: "S6", field: "rule.term", value: { from: "samples", to: "a taste" }, source: "corrected", at: "2026-10-14T00:00:00Z" })] });
  const on = sm(plan, NOMADIC, k);
  const off4 = sm(plan, NOMADIC, k, { slotsOff: ["S4"] });
  const off6 = sm(plan, NOMADIC, k, { slotsOff: ["S6"] });
  const all = sm(plan, NOMADIC, k, { slotsOff: ["S1", "S1t", "S4", "S6"] });
  // all off = a plan with no outcome memory and no slots, line for line (the baseline is real)
  const base = sm({ ...plan, slots: {} }, NOMADIC, k, { slotsOff: ["S4", "S1t"] });
  assert.deepEqual(all.talk, base.talk);
  assert.equal(all.note.body, base.note.body);
  assert.notEqual(on.talk.opener, off4.talk.opener, "S4 earns its place");
  assert.match(off6.note.body + off6.talk.before.join(" "), /samples/);
  assert.doesNotMatch(on.note.body + on.talk.before.join(" "), /\bsamples\b/, "S6 earns its place");
  assert.match(on.talk.before.join(" "), /a taste/);
});

// ---------- §7.3 label-invariance ----------
test("L1/L2 label-invariance: swapping the contact's or the rep's name changes only the name", () => {
  const norm = (m, names) => SL.redact(allText(m), names);
  const outs = ["Sam", "Guadalupe", "Wei", "Mohammed", "Aoife"].map((n) => {
    const { plan, k } = returnCase({ who: `${n} (taproom manager)` });
    return norm(sm(plan, NOMADIC, k), [n]);
  });
  assert.equal(new Set(outs).size, 1);
  assert.doesNotMatch(outs[0], /\b(he|she|him|her|his|hers)\b/i, "no pronoun for the contact");
  const reps = ["Maya Ortiz", "DeShawn Carter", "Priya Raman"].map((n) => {
    const prof = { ...profile, pitch: { ...profile.pitch, name: n } };
    const outcomes = { [NOMADIC]: visitOutcome() };
    const plan = planFor({ statuses: { [NOMADIC]: "visited" }, outcomes, prof });
    return norm(sm(plan, NOMADIC, dayOfId(plan, NOMADIC, 1)), [n.split(" ")[0]]);
  });
  assert.equal(new Set(reps).size, 1);
});

test("L3 label-invariance: the room's neighbourhood never changes the talking points", () => {
  const p0 = planFor();
  const k = dayOfId(p0, NOMADIC);
  const a = sm(p0, NOMADIC, k);
  const moved = { ...p0, venues: { ...p0.venues, [NOMADIC]: { ...p0.venues[NOMADIC], neighborhood: "Logan Square" } } };
  assert.deepEqual(sm(moved, NOMADIC, k).talk, a.talk);
});

// ---------- §7.4 empty slot ----------
test("E1 empty: a return visit with no note and no contact stays neutral — no name, no quote", () => {
  const { plan, k } = returnCase({ who: "", note: "" });
  const m = sm(plan, NOMADIC, k);
  assert.equal(m.talk.opener, "Good to see you again. I brought a couple of cold ones for you and the team.");
  assert.match(m.talk.before[0], /^Ask for the taproom manager or an owner, and say you're back from Tue Oct 13\.$/);
  assert.doesNotMatch(allText(m), /“|Sam|Last time:/);
  assert.match(m.note.body, /^Hi, it's Maya from Tidewell again/);
  assert.deepEqual(m.talk.memoryUsed, []);
});

test("E4 empty: an expired note is not used; E5: an unmatched objection is quoted, never answered for the rep", () => {
  const { plan, k } = returnCase();
  const late = sm(plan, NOMADIC, k, { now: Date.parse("2026-12-20T00:00:00Z") });
  assert.ok(!late.talk.before.some((l) => /Your note/.test(l)), "60-day note expired");
  assert.match(late.talk.before[0], /^Ask for Sam/, "the contact (180 days) still counts");
  const odd = returnCase({ note: "the owner hates cans" });
  const o = sm(odd.plan, NOMADIC, odd.k).talk.pushback[0];
  assert.equal(o.objection, "Last time: “the owner hates cans”");
  const weird = returnCase({}, { [NOMADIC]: [SL.makeRecord({ slot: "S4", field: "objection", value: { kind: "other", words: "the colour is ugly" }, source: "stated", by: "agent:test", at: "2026-10-14T00:00:00Z", confirmed: false })] });
  assert.equal(sm(weird.plan, NOMADIC, weird.k).talk.pushback[0].reply, "That's what you noted: have your answer ready.");
});

test("a first visit already logged on its own day still reads as that visit (no return content the same day)", () => {
  const outcomes = { [NOMADIC]: makeOutcome({ result: "interested", note: "liked it", at: "2026-10-13T20:10:00Z" }) };
  const plan = planFor({ outcomes });
  const k = dayOfId(plan, NOMADIC);
  assert.equal(plan.days[k].date, TUE);
  assert.equal(sm(plan, NOMADIC, k).talk.visit, "first");
});

// ---------- §7.5 correction ----------
test("C1 correction: the rep's edited note survives a store round trip and replaces the draft", () => {
  const store = createStore(null);
  const rec = SL.makeRecord({ slot: "S6", field: "note.email", value: "Hi Sam — my own words.", source: "corrected", at: "2026-10-14T00:00:00Z" });
  store.setSlots("Tidewell", "austin", NOMADIC, [rec]);
  const json = JSON.stringify(store.load("Tidewell", "austin"));
  const slots = JSON.parse(json).slots;
  const p0 = planFor({ slots });
  const m = sm(p0, NOMADIC, dayOfId(p0, NOMADIC));
  assert.equal(m.note.body, "Hi Sam — my own words.");
  assert.equal(m.note.by, "rep");
  assert.equal(noteFor(m.note, "sms"), "Hi Sam — my own words.", "no draft parts left behind");
});

test("C2/C3 correction: an avoid rule hides the line on every door; a term rule rewrites every output; brand rules are per brand", () => {
  const store = createStore(null);
  store.setRules("Tidewell", [
    SL.makeRecord({ slot: "S6", field: "rule.avoid", value: "price", source: "corrected" }),
    SL.makeRecord({ slot: "S6", field: "rule.term", value: { from: "non-alcoholic", to: "alcohol-free" }, source: "corrected" }),
  ]);
  assert.equal(store.getRules("Other Brand").length, 0);
  const slots = { "*": store.getRules("Tidewell") };
  const p0 = planFor({ slots });
  let hidden = 0;
  for (const d of p0.days) for (const s of d.stops) {
    const m = sm(p0, s.id, p0.days.indexOf(d));
    assert.doesNotMatch(allText(m), /\bprice\b/i, s.id);
    assert.doesNotMatch(allText(m), /\bnon-alcoholic\b/i, s.id);
    hidden += m.hidden;
  }
  assert.ok(hidden > 0);
  const m = sm(p0, NOMADIC, dayOfId(p0, NOMADIC));
  assert.match(m.note.body, /Tidewell, an alcohol-free hazy IPA/, "the article agrees");
  assert.equal(SL.applyRule("A non-alcoholic IPA and an NA beer", { terms: [{ from: "non-alcoholic", to: "alcohol-free" }, { from: "NA", to: "zero-proof" }] }), "An alcohol-free IPA and a zero-proof beer");
  const clean = sm(planFor(), NOMADIC, dayOfId(planFor(), NOMADIC));
  assert.match(allText(clean), /price/, "removing the rules restores the lines");
});

test("C5 correction beats stated: an edited objection decides the pushback; a venue-type correction changes who to ask for", () => {
  const fix = SL.makeRecord({ slot: "S4", field: "objection", value: { kind: "space", words: "really it's space" }, source: "corrected", at: "2026-10-14T00:00:00Z" });
  const { plan, k } = returnCase({}, { [NOMADIC]: [fix] });
  assert.match(sm(plan, NOMADIC, k).talk.pushback[0].reply, /one row in the cooler/);
  const p0 = planFor({ slots: { [NOMADIC]: [SL.makeRecord({ slot: "S1", field: "venueType", value: "bar", source: "corrected" })] } });
  assert.match(sm(p0, NOMADIC, dayOfId(p0, NOMADIC)).talk.before[0], /bar manager or beverage director/);
});

// ---------- S5 envelope and the agent's checks ----------
test("envelope: door, audience, occasion, constraints and live slots with traces; redacted before a model call (Q2)", () => {
  const { plan, k } = returnCase({}, { "*": [SL.makeRecord({ slot: "S6", field: "rule.avoid", value: "keg", source: "corrected", at: "2026-10-14T00:00:00Z" })] });
  const m = sm(plan, NOMADIC, k);
  const env = SL.envelope(m, { slots: plan.slots, brandCity: "tidewell-austin", channel: "sms", now: NOW });
  assert.equal(env.occasion.visit, "return");
  assert.equal(env.occasion.channel, "sms");
  assert.deepEqual(env.audience.contact.value, { name: "Sam", role: "taproom manager" });
  assert.equal(env.constraints.isNA, true);
  assert.ok(env.constraints.avoid.includes("keg") && env.constraints.avoid.includes("Athletic Brewing"));
  assert.ok(env.slots.every((r) => r.trace));
  const red = JSON.stringify(SL.redactDeep(env, ["Sam", "Maya"]));
  assert.doesNotMatch(red, /\bSam\b|\bMaya\b/);
  assert.match(red, /the contact/);
  assert.equal(SL.redact("Sammy met Sam", ["Sam"]), "Sammy met the contact", "whole words only");
  const empty = SL.envelope(sm(planFor(), NOMADIC, dayOfId(planFor(), NOMADIC)), { slots: {}, now: NOW });
  assert.equal(empty.audience.contact, null);
  assert.deepEqual(empty.slots, []);
  assert.equal(empty.occasion.visit, "first");
});

test("checkReply: drops avoided names and uncited claims about people; applies the rep's terms", () => {
  const env = { constraints: { avoid: ["Athletic Brewing"], terms: { NA: "alcohol-free" } } };
  const r = SL.checkReply("Nomadic is a good fit. Their regulars are mostly young men. Athletic Brewing is there. Bring NA samples. Qloo skews the room 25–29 [qloo:age].", env);
  assert.equal(r.text, "Nomadic is a good fit. Bring alcohol-free samples. Qloo skews the room 25–29 [qloo:age].");
  assert.deepEqual(r.dropped.map((d) => d.why), ["about people", "avoid"]);
});

test("W4 swap: the same arrival at a café, a bar and a restaurant gets each room's own timing; the room's hours still win", () => {
  const A = (eta, type, span = null) => adviceFor(eta, type, span);
  for (const [eta, kinds] of [[8 * 60 + 10, ["rush-am", "early", "early"]], [17 * 60 + 15, ["late", "happy-hour", "pre-dinner"]], [15 * 60, ["lull", "quiet", "lull"]]]) {
    const got = ["coffee", "bar", "restaurant"].map((t) => A(eta, t).kind);
    assert.deepEqual(got, kinds, `${eta}`);
  }
  assert.equal(A(16 * 60 + 5, "bar", { from: 16 * 60, to: 26 * 60 }).kind, "opening", "first in the door beats happy hour");
  assert.equal(A(8 * 60 + 10, null).kind, "early", "no type = the old clock (ablation)");
  // through the stop: a brewery mid-afternoon reads as before the after-work crowd; S1t off = the old wording
  const p0 = planFor();
  const k = dayOfId(p0, NOMADIC);
  const on = sm(p0, NOMADIC, k);
  const off = sm(p0, NOMADIC, k, { slotsOff: ["S1t"] });
  assert.equal(on.talk.arrival, "quiet");
  assert.equal(off.talk.arrival, "lull");
});

test("judge R9: a 'never say' rule keeps out the plural too, not words that merely start with it", () => {
  const r = { avoid: ["cocktail"], terms: [] };
  assert.equal(SL.applyRule("Which of your cocktails could take a new small-batch mezcal?", r), null);
  assert.equal(SL.applyRule("A cocktail on the list.", r), null);
  assert.equal(SL.applyRule("Ask about the cocktailbar menu.", r), "Ask about the cocktailbar menu.");
});

test("live check E / judge pass 2 (8): a return note says the follow-up day and time she agreed, not the card's planned slot", async () => {
  const { draftNote } = await import("../public/lib/note.js");
  const memory = { visit: "return", lastVisit: "2026-10-24", result: "interested", followUp: "2026-10-26", followUpTime: "15:00", contact: null, objection: null };
  const n = draftNote({ venue: { name: "The Yard" }, profile: { brand: "Tidewell", pitch: { name: "Maya Ortiz" } }, day: "saturday", date: "2026-10-31", eta: 842, memory });
  assert.match(n.body, /I'll be by Monday around 3, if that still works\./);
  assert.match(n.body, /thanks for your time on Saturday/);
  assert.doesNotMatch(n.body, /Saturday around/);
  const n2 = draftNote({ venue: { name: "The Yard" }, profile: { brand: "Tidewell" }, day: "monday", date: "2026-10-26", eta: 935, memory: { ...memory, followUpTime: null } });
  assert.match(n2.body, /I'll be by Monday around 3:30, if that still works\./);
});
