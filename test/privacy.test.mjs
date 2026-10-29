// Door-notes privacy: what a rep's note or message says about a person never reaches a model. Phone numbers and
// emails are replaced, a clause describing a person (age, gender, origin, religion, sexuality, health, family, body,
// politics) is left out, and names beside a role or a verb ("the manager is Priya", "Marco said") are found for
// redaction. Qloo's crowd lines, door types and the rep's trade facts stay as written. Data-free.
import { test } from "node:test";
import assert from "node:assert/strict";
import { personalOut, namesIn, forModel, redact } from "../public/lib/slots.js";
import { notPlaces } from "../src/agent.js";
import { runTool } from "../public/lib/agent-tools.js";

// [note, words that must not reach the model, words that must]
const PEOPLE = [
  ["The manager is Priya, she's maybe 45. Wants a case Thursday.", ["45"], ["Wants a case Thursday"]],
  ["Owner is an older Korean guy, very traditional.", ["Korean", "older"], []],
  ["Buyer is a young woman, probably mid-20s.", ["young", "woman", "20s"], []],
  ["Dana is pregnant, due in March, so go before then.", ["pregnant"], ["go before then"]],
  ["He's Muslim so don't push the beer, push the NA.", ["Muslim"], ["push the NA"]],
  ["The bartender is gay and loved the branding.", ["gay"], []],
  ["Sam's divorced and works doubles.", ["divorced"], []],
  ["The GM is from Mexico, speaks Spanish first.", ["Mexico", "Spanish"], []],
  ["Manager has a bad back, don't make him carry cases.", ["bad back"], ["carry cases"]],
  ["Older guy at the bar, 60s, runs the place.", ["Older", "60s"], ["runs the place"]],
  ["He's Jewish, closed Saturdays.", ["Jewish"], ["closed Saturdays"]],
  ["Owner's wife does the books, she's Catholic.", ["Catholic", "wife"], []],
  ["The buyer is in a wheelchair, use the side door.", ["wheelchair"], ["use the side door"]],
  ["Bar lead is a 30 year old dude with tattoos.", ["30 year", "tattoos"], []],
  ["She just had a baby, back in two weeks.", ["baby"], ["back in two weeks"]],
  ["Chef is Indian, vegetarian, doesn't drink.", ["Indian", "vegetarian"], []],
  ["Owner is Black, proud of the neighbourhood.", ["Black"], ["proud of the neighbourhood"]],
];
for (const [note, gone, kept] of PEOPLE) {
  test(`a person's description is left out: ${note}`, () => {
    const out = personalOut(note);
    for (const w of gone) assert.doesNotMatch(out, new RegExp(`\\b${w}\\b`, "i"), out);
    for (const w of kept) assert.match(out, new RegExp(w, "i"), out);
    assert.ok(out.length > 0);
  });
}

// a person named as the subject, no role word: short names too ("Jo is 60 and Catholic" used to go through)
const NAMED = [
  ["Jo is 60 and Catholic.", ["60", "Catholic"], []],
  ["Al is diabetic, bring the NA.", ["diabetic"], ["bring the NA"]],
  ["Mo is a Republican, keep it about the beer.", ["Republican"], ["keep it about the beer"]],
  ["Bea’s pregnant, back in May.", ["pregnant"], ["back in May"]],
  ["Jo is an alcoholic, skip the pitch.", ["alcoholic"], ["skip the pitch"]],
  ["Li is gay, loved the cans.", ["gay"], ["loved the cans"]],
  ["Ed is Mexican and runs the kitchen.", ["Mexican"], []],
  ["Kai is maybe 70, owns the building.", ["70"], ["owns the building"]],
];
for (const [note, gone, kept] of NAMED) {
  test(`a named person's age, religion, health, politics, sexuality or origin is left out: ${note}`, () => {
    const out = personalOut(note);
    for (const w of gone) assert.doesNotMatch(out, new RegExp(`\\b${w}\\b`, "i"), out);
    for (const w of kept) assert.match(out, new RegExp(w, "i"), out);
  });
}
test("a door, the brand or the city as the subject stays: door types, distances, hours, 'non-alcoholic'", () => {
  for (const t of ["Nomadic is a Korean BBQ spot.", "Nomadic is 20 minutes from the first stop.", "The Yard is a gay bar with a patio.", "Pinthouse is open till 2.", "Tidewell is non-alcoholic.", "Tidewell is for the sober curious.", "Austin is busy on Fridays.", "Jo is in, ask for Jo after 3."])
    assert.equal(personalOut(t), t);
  assert.deepEqual(namesIn("Jo is 60 and Catholic. Al is diabetic."), ["Jo", "Al"]);
});

test("phone numbers and emails become 'a phone number' / 'an email address' in every common form", () => {
  for (const p of ["617-555-0142", "(617) 555-0142", "(617) 555 0142", "+1 617 555 0142", "617.555.0142", "6175550142", "1-617-555-0142"])
    assert.equal(personalOut(`Call ${p} after 4.`), "Call a phone number after 4.", p);
  for (const e of ["dana@taproom.com", "Dana.Lee+orders@gmail.co.uk"]) assert.equal(personalOut(`Email ${e} for orders`), "Email an email address for orders", e);
});

test("trade facts, door types and Qloo's crowd lines stay as written", () => {
  for (const t of [
    "Wants two cases of the dry one, back Thursday at 3.",
    "Korean BBQ spot, busy after 9, younger crowd.",
    "Gay bar with a big patio, pitch the NA on Sundays.",
    "Price is $5.42 a can, 24 cans a case, 2026-10-24.",
    "Qloo's profile of this room: young professionals, craft beer fans.",
    "Mexican restaurant with a long mezcal list; the cooler is full until November.",
    "Ask for the manager after 3; she does the ordering.",
    "He wants samples of the dry one before he commits to a case.",
    "Open 11:00–23:00, 12 taps, 40 seats, 4.6 road mi from the first stop.",
  ]) assert.equal(personalOut(t), t);
});

test("names beside a role or a verb are found, so redact replaces them; days, verbs and door words are not names", () => {
  const t = "Talked to Marco, the bar manager. Marco said come back Thursday. Priya (owner) orders. A guy named Theo. Text Ana. The manager is Lena. GM: Ravi Shah. Email orders to x.";
  assert.deepEqual(namesIn(t).sort(), ["Ana", "Lena", "Marco", "Priya", "Ravi Shah", "Theo"]);
  const r = redact(t, namesIn(t));
  assert.doesNotMatch(r, /Marco|Priya|Theo|Ana\b|Lena|Ravi|Shah/);
  assert.match(r, /Thursday/);
  assert.deepEqual(namesIn("Thursday said maybe. Owner said yes."), []);
  // "Nomadic said no" is a door, not a person: the Worker drops a found name that is a word of a door, the brand or city
  assert.deepEqual(notPlaces(namesIn("Nomadic said no. Marco said yes."), ["Nomadic Beerworks", "Tidewell", "Austin, TX"]), ["Marco"]);
});

test("forModel: every string of an envelope is scrubbed, door names and ids are not", () => {
  const out = forModel({ doors: [{ id: "d1", name: "Old Man Bar", notes: [{ text: "Owner is an older guy, 617-555-0142" }] }], brand: "Tidewell" }, ["Priya"]);
  assert.equal(out.doors[0].name, "Old Man Bar");
  assert.equal(out.doors[0].id, "d1");
  assert.doesNotMatch(JSON.stringify(out), /older|617/);
});

test("save_note keeps the rep's own phone number on the device (the model only saw 'a phone number')", () => {
  const ctx = { today: "2026-10-27", doors: { a: { name: "Pinthouse", notes: [] } }, envelopes: {}, names: [], day: { stops: [] }, profile: {} };
  const r = runTool("save_note", { door_id: "a", text: "Call back at a phone number after 4" }, ctx, { words: "note: call back at 617-555-0142 after 4", by: "agent" });
  assert.equal(r.ok, true, r.error);
  assert.match(JSON.stringify(r.actions), /617-555-0142/);
});
