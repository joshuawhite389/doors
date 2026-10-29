// lib/provenance.js: each talking point's source chip is read off stopModel's traces.
import test from "node:test";
import assert from "node:assert/strict";
import { lineSources, sourceCounts } from "../public/lib/provenance.js";

const tod = { kind: "ahead", text: "Qloo puts this room's crowd in the evening: at 3 pm you're ahead of it.", src: { kind: "qloo", field: "tag:time_of_day_fit", tags: ["Evening"] } };
const lead = { question: "When one of your regulars isn't drinking, do they ask for the specialty NA list?", gate: null, ask: null, src: [{ kind: "qloo", field: "tag:beverage_offering", tags: ["Specialty non alcoholic"] }] };
const base = (talk = {}, extra = {}) => ({
  profile: { brand: "Tidewell", pitch: { price: "$44 a case", ask: "one case of cans in the cooler" } },
  memory: null,
  talk: {
    before: ["Ask for the taproom manager or owner.", tod.text, "Bring cold samples, your price ($44 a case) and a one-page sheet.", "Why you're here: #1 of 113 …"],
    opener: `Looks like your regulars are into craft beer. ${lead.question.replace(/^When one of your regulars\b/, "When one of them")}`,
    openerSource: "customer_demographics_description",
    questions: ["What do you have for guests who aren't drinking right now, and how does it move?", "Would a guest can in the cooler work here, or only your own taps?"],
    points: [{ text: "Other Austin rooms whose regulars Qloo matches to yours: A, B.", fact: null }, { text: "A stat.", fact: "na-x" }, { text: "Tidewell is a non-alcoholic hazy IPA.", fact: null }],
    pushback: [{ objection: "Non-alcoholic doesn't sell here.", reply: "Then start with …" }],
    ask: "one case of cans in the cooler",
    hook: { text: "People who drink Athletic Brewing also like …", src: { kind: "qloo", field: "hook:podcast", brand: "Athletic Brewing", room: "sports" } },
    deep: { tod, lead },
    memoryUsed: [],
    ...talk,
  },
  ...extra,
});

test("first visit: Qloo lines say Qloo, profile lines say profile, the rest say template", () => {
  const s = lineSources(base());
  assert.deepEqual(s.before.map((c) => c.label), ["Doors template", "from Qloo · door tags", "from your profile", "from Qloo · rank"]);
  assert.equal(s.opener.label, "from Qloo · door tags"); // the question was picked by the door's tags
  assert.equal(s.hook.label, "from Qloo · taste data");
  assert.deepEqual(s.points.map((c) => c?.label ?? null), ["from Qloo · sister doors", null, "from your profile"]);
  assert.equal(s.ask.label, "from your profile");
  assert.ok(s.questions.every((c) => c.k === "tpl"));
});

test("opener: crowd text alone is Qloo's room profile; no crowd and no tags is the template; a model line says so", () => {
  assert.equal(lineSources(base({ opener: "Looks like your regulars are into craft beer. What do they order?", deep: {} })).opener.label, "from Qloo · door profile");
  assert.equal(lineSources(base({ opener: "What do your regulars order?", openerSource: null, deep: {} })).opener.label, "Doors template");
  assert.equal(lineSources(base({ lines: { opener: "model" }, deep: {} })).opener.label, "from Qloo · door profile"); // round 3: no model named
  assert.equal(lineSources(base({ written: { opener: true }, deep: {} })).opener.label, "from Qloo · this door's facts"); // g6: the written opener
  assert.equal(lineSources(base({ edited: { opener: "rep" } })).opener.label, "your edit");
  // judge pass 2 (6): Ask Doors' edit is Doors', not the rep's; one that kept Qloo's crowd line says so
  assert.equal(lineSources(base({ edited: { opener: "rules" }, editedFrom: { opener: "qloo" } })).opener.label, "Doors' edit · from Qloo");
  assert.equal(lineSources(base({ edited: { opener: "model" } })).opener.label, "Doors' edit");
});

test("return visit: the contact, her note and the logged objection say 'from your note'", () => {
  const m = base({
    before: ["Ask for Sam (bar manager): you talked on Tue Oct 27.", "Your note from last time: “liked it, hesitant about price”.", "Bring cold samples, your price per case and a one-page sheet."],
    opener: "Good to see you again, Sam. Have you had a chance to think it over?",
    pushback: [{ objection: "Last time: “liked it, hesitant about price”", reply: "Start with …", from: "memory" }, { objection: "We don't have room.", reply: "One row." }],
    memoryUsed: ["contact", "said", "objection"],
    deep: {},
  }, { memory: { visit: "return" } });
  const s = lineSources(m);
  assert.deepEqual(s.before.map((c) => c.k), ["you", "you", "tpl"]);
  assert.equal(s.opener.label, "from your note");
  assert.deepEqual(s.pushback.map((c) => c.k), ["you", "tpl"]);
  const n = sourceCounts(s);
  assert.ok(n.you >= 4 && n.tpl > 0);
});
