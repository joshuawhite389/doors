// The §7 probes for the R9 slots merged at v2-tour 27451e2 (docs/CULTURAL-SLOTS.md): S4 return visit (visit memory),
// S3 the SMS channel, S6 corrections (rules, the rep's own note), S1 a venue-type correction. Run on every scenario of
// the fixed set, not only the Austin demo room: for each, day 1's first planned room is visited on Tuesday and logged
// as a follow-up for Wednesday ("liked it, hesitant about price", talked to Sam the bar manager); Wednesday shows the
// return visit. Code checks only.
import { SCENARIOS } from "./scenarios.mjs";
import { runScenario, NOW } from "./harness.mjs";
import { makeOutcome } from "../../public/lib/outcome.js";
import { makeRecord } from "../../public/lib/slots.js";
import { createStore } from "../../public/lib/store.js";
import { SMS_MAX } from "../../public/lib/note.js";

const WED = "2026-10-28";
const AT = "2026-10-27T20:00:00Z";
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const words = (st) => [...st.before, st.opener, ...st.questions, ...st.points, ...st.pushback, st.ask, st.subject, st.note, st.sms];
const say = (st) => words(st).join("\n");

// The return case for a scenario: {top, first (the Tuesday showing), back (Wednesday's return)} or null when the room
// can't come back on Wednesday (closed, outside the window): the planner says so and the probe skips that scenario.
export function returnCase(s, { who = "Sam (bar manager)", note = "liked it, hesitant about price", slots = {}, slotsOff = [], mutate = null } = {}) {
  const r0 = runScenario(s);
  const top = r0.days[0]?.stops[0];
  if (!top) return null;
  const outcomes = { [top]: makeOutcome({ result: "followup", followUp: WED, who, note, at: AT }) };
  const back = runScenario(s, { statuses: { [top]: "visited" }, outcomes, focus: top, slots, slotsOff, mutate });
  const st = back.stops[0];
  if (!st || st.day < 1) return null;
  return { top, first: r0.stops[0], back: st, run: back };
}

// the text's taste and time words, the template's and the model's (lib/talk-gen.js g6 message rule)
const TASTE_WORDS = /\b(taste|tasting|pour|sample|samples|try|sip|a cold one|a quick drink|a few cold ones)\b/i;
const TIME_WORDS = /\{when\}|\b(stop|swing|come|drop) (by|in)\b|\b(at|around|before|after) \d|\b(mon|tues|wednes|thurs|fri|satur|sun)day\b|\b(this|next) week\b|\btime\b/i;

export function slotsProbe() {
  const rows = [];
  const add = (probe, case_, key, ok, detail = "") => rows.push({ probe, case: case_, key, ok, detail });
  const skipped = [];
  for (const s of SCENARIOS) {
    const c = returnCase(s);
    if (!c) { skipped.push(s.key); continue; }
    const { first, back } = c;
    // ---- swap W1: first visit ↔ return visit ----
    add("swap", "First ↔ return visit: no crowd line, asks for Sam, price objection first, note greets Sam and is shorter", s.key,
      !/Looks like/.test(back.opener) && back.before.some((b) => /\bSam\b/.test(b)) && /price/i.test(back.pushback[0] ?? "") && /^Hi Sam\b/.test(back.note) && back.note.length < first.note.length,
      `opener "${back.opener.slice(0, 80)}"; pushback[0] "${(back.pushback[0] ?? "").slice(0, 60)}"`);
    add("swap", "First ↔ return visit: the ask and the facts stay", s.key, back.ask === first.ask || /^Confirm the first order/.test(back.ask), `ask "${back.ask}"`);
    // ---- swap W3: email ↔ SMS ----
    // Jard 10-24 #5: a first text asks for a time and a taste, never for the order. Round 3 (talk2): the model writes
    // the text in its own words (lib/talk-gen.js checks it never names the order), so the check reads the intent, not
    // the template's phrases: it names a time to come by and asks for a taste (taste, pour, sample, try, sip, a cold one).
    add("swap", `Email ↔ SMS: the text is ≤ ${SMS_MAX} chars, names a time and asks for a taste, not the order; the email is unchanged`, s.key,
      first.sms.length <= SMS_MAX && !first.sms.includes(first.ask) && TASTE_WORDS.test(first.sms) && TIME_WORDS.test(first.sms) && first.sms !== first.note, `${first.sms.length} chars`);
    // ---- stability ----
    add("stability", "Return visit, run twice: identical", s.key, eq(returnCase(s).back, back));
    // ---- ablation: S4 off → the first-visit words at the return stop (the template's or R9 deep lead's question) ----
    const offS4 = returnCase(s, { slotsOff: ["S4"] }).back;
    add("ablation", "S4 off (visit memory): the return stop talks like a first visit", s.key, !/^Good to see you again/.test(offS4.opener) && /\?$/.test(offS4.opener) && !/^Hi Sam\b/.test(offS4.note), `opener "${offS4.opener.slice(0, 60)}"`);
    // ---- ablation: S6 off with a rule present → the rule stops applying ----
    const rule = { "*": [makeRecord({ slot: "S6", field: "rule.avoid", value: "price", source: "corrected", at: AT })] };
    const withRule = returnCase(s, { slots: rule }).back;
    const ruleOff = returnCase(s, { slots: rule, slotsOff: ["S6"] }).back;
    add("ablation", "S6 off (corrections): a rule 'never say price' stops applying", s.key, !/\bprice\b/i.test(say(withRule)) && /\bprice\b/i.test(say(ruleOff)));
    // ---- ablation: S1 venue-type correction ----
    const otherType = back.venueType === "restaurant" ? "bar" : "restaurant";
    const typeFix = { [c.top]: [makeRecord({ slot: "S1", field: "venueType", value: otherType, source: "corrected", at: AT })] };
    const fixed = returnCase(s, { slots: typeFix }).back;
    const fixedOff = returnCase(s, { slots: typeFix, slotsOff: ["S1"] }).back;
    add("ablation", "S1 (venue-type correction): the rep's type wins; off → Qloo's genre", s.key, fixed.venueType === otherType && fixedOff.venueType === back.venueType, `${back.venueType} → ${fixed.venueType}`);
    // ---- label invariance: the contact's name ----
    const NAMES = ["Sam", "Guadalupe", "Wei", "Mohammed", "Aoife", "DeShawn"];
    const masked = NAMES.map((n) => JSON.stringify(returnCase(s, { who: `${n} (bar manager)` }).back).split(n).join("<NAME>"));
    const pron = NAMES.map((n) => say(returnCase(s, { who: `${n} (bar manager)` }).back)).some((t) => /\b(he|she|him|her|his|hers)\b/i.test(t));
    add("label invariance", "Contact name swapped (6 names): identical once masked; no pronoun", s.key, masked.every((x) => x === masked[0]) && !pron);
    // ---- empty slot: a return visit with no note and no contact ----
    const bare = returnCase(s, { who: "", note: "" }).back;
    add("empty slot", "Return visit, no note, no contact: no quote, no name, no invented objection", s.key,
      !/“|"|\bSam\b|Last time you said/.test(bare.opener + bare.note) && /^Hi, it's\b/.test(bare.note) && !/price/i.test(bare.pushback[0] ?? ""), `opener "${bare.opener.slice(0, 60)}"`);
    // ---- empty slot: an objection Doors has no reply for is quoted, not answered ----
    const odd = returnCase(s, { note: "the owner hates cans" }).back;
    add("empty slot", "Unmatched objection: quoted as the rep's words, no invented reply", s.key, odd.pushback.some((p) => /the owner hates cans/.test(p)), (odd.pushback[0] ?? "").slice(0, 80));
    // ---- empty slot: an expired memory → first-visit lines ----
    const late = runScenario(s, { statuses: { [c.top]: "visited" }, outcomes: { [c.top]: makeOutcome({ result: "followup", followUp: WED, who: "Sam (bar manager)", note: "liked it, hesitant about price", at: "2026-07-01T20:00:00Z" }) }, focus: c.top }).stops[0];
    add("empty slot", "Memory past its expiry (stated, 60 days): no quote, no objection", s.key, late && !/Last time you said|hesitant/.test(say(late)), late?.opener?.slice(0, 60) ?? "not planned");
    // ---- correction: persists through the store and wins ----
    const storage = memoryStorage();
    const store = createStore(storage);
    const brand = s.profile.brand, cityKey = s.profile.city;
    store.setRules(brand, [makeRecord({ slot: "S6", field: "rule.term", value: { from: "cooler", to: "fridge" }, source: "corrected", at: AT })]);
    const mine = "Hi team, quick one: can I drop off two cold cans for the staff on Wednesday? Thanks.";
    store.setSlots(brand, cityKey, c.top, [makeRecord({ slot: "S6", field: "note.email", value: mine, source: "corrected", at: AT }), makeRecord({ slot: "S4", field: "objection", value: { kind: "space", words: "no room on the shelf" }, source: "corrected", at: AT })]);
    const re = createStore(storage); // reload
    const reSlots = { ...re.load(brand, cityKey).slots, "*": re.getRules(brand) };
    const corr = returnCase(s, { slots: reSlots }).back;
    add("correction", "The rep's own note replaces the draft, after a reload", s.key, corr.note === mine);
    add("correction", "A brand term (cooler → fridge) applies after a reload; Doors never says 'cooler'", s.key, !/\bcooler\b/i.test(words(corr).filter((x) => x !== mine).join("\n")) && (!/\bcooler\b/i.test(say(back)) || /\bfridge\b/.test(say(corr))));
    add("correction", "A corrected objection (space) beats the stated one (price)", s.key, /room|space/i.test(corr.pushback[0] ?? "") && !/price/i.test(corr.pushback[0] ?? ""), (corr.pushback[0] ?? "").slice(0, 70));
    const other = runScenario(s, { slots: reSlots }).stops.find((x) => x.id !== c.top);
    add("correction", "The door's own note stays on that door; other doors keep the draft", s.key, !other || other.note !== mine);
  }
  return { rows, skipped };
}

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } };
}
export { NOW };
