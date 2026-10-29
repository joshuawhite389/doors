// Group 3 item 3 / round 3 (g4): talking points written per door by a model from Qloo's facts (lib/talk-gen.js, src/talk.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readJson } from "./helpers.mjs";
import { talkFacts, talkKey, checkTalkLine, validateTalkSet, withTalkSet, pickTalkSet, bakedTalkKey, talkUser, hoursLine, fillPlaceholders, TALK_SYSTEM } from "../public/lib/talk-gen.js";
import { talkPoints } from "../public/lib/talk.js";
import { talkTurn, cleanTalkFacts, _resetTalk, TALK_MODEL } from "../src/talk.js";
import { _resetSpend } from "../src/spend.js";
import worker from "../src/worker.js";

const route = readJson("public/data/routes/athletic-brewing-austin.json");
const city = readJson("public/data/cities/austin.json");
const byName = (n) => Object.values(route.venues).find((v) => v.name === n);
const MEANWHILE = byName("Meanwhile Brewing");
const PINTHOUSE = byName("Pinthouse Brewing");
const PROFILE = { brand: "Tidewell", what: "Non-alcoholic hazy IPA", support: "a staff tasting", drinks: [{ key: "athletic-brewing", name: "Athletic Brewing" }], product: { format: "cans", size: "12 oz", abv: "0.5%", na: true, sells: "self" }, pitch: { price: "$38 a case of 24", ask: "one case of cans in the cooler" } };
const PLAN = { pool: { ids: route.lists.all.map((r) => r[0]), N: route.lists.all.length, label: "Austin bars, breweries and restaurants for Athletic Brewing drinkers" } };
const tf = talkFacts({ venue: MEANWHILE, id: MEANWHILE.id, city, routes: [route], plan: PLAN, profile: PROFILE, ask: "one case of cans in the cooler", venueType: "brewery", avoid: ["Athletic Brewing", "Khruangbin"], na: true });
const R = (label) => tf.facts.find((f) => f.label.startsWith(label))?.id;

// a set like the ones the model writes (recorded 2026-10-24 for Meanwhile Brewing, trimmed; g4: no taste offer needed)
const GOOD = {
  angle: { text: "Qloo tags it family friendly with food trucks and live music, and it brews its own beer, so a tap is the wrong ask: lead with the parent or driver who wants a beer-style drink without alcohol, in the cooler.", from: [R("How the room feels"), R("The crowd is into"), R("Qloo's summary")] },
  to_buyer: { text: "It's a non-alcoholic hazy IPA in 12 oz cans for whoever is driving the family home.", from: [R("How the room feels"), "P2"] },
  questions: [
    { text: "When you have food trucks in, what do people order with the tacos if they aren't drinking?", from: [R("The crowd is into"), R("Known for")] },
    { text: "What non-alcoholic drinks do you have now, and how do they move?", from: [R("Drinks Qloo tags")] },
    { text: "Who decides what goes in the cooler, and when do you look at it next?", from: [R("Name")] },
  ],
  points: [
    { text: "It gives the parent who is driving something that tastes like a beer at a family table.", from: [R("How the room feels"), "P2"] },
    { text: "A case of 24 is $38, and I can do a staff tasting so your bartenders know it first.", from: ["P3", "P4"] },
  ],
  pushback: [
    { objection: "We already have a non-alcoholic option.", reply: "Good, then people already ask. Start with one case of cans in the cooler and see which one they pick.", from: ["A"] },
    { objection: "We only serve our own beer.", reply: "It's for the guest who isn't drinking today, so the whole group stays at your table.", from: [R("How the room feels")] },
  ],
  // g6: the opener and the message ride in the same set
  opener: { text: "Hi, I'm {rep} with Tidewell, a non-alcoholic hazy IPA. You brew your own, so I'm not after a tap. Who looks after the cooler?", from: [R("Qloo's summary")] },
  message: { subject: "Tidewell, a non-alcoholic hazy IPA, for the cooler", body: "Hi,\n\nI'm {rep} with Tidewell, a non-alcoholic hazy IPA in 12 oz cans. You brew your own beer, so a hazy with no alcohol is the one style a brewery rarely makes itself.\n\nI'm out meeting breweries around Austin and I'll be over your way {when}. Could I pour whoever runs the taproom a cold one? Ten minutes.\n\nThanks,\n{rep}", sms: "Hi, it's {rep} from Tidewell, a non-alcoholic hazy IPA. I'll be over your way {when}. Could I pour whoever runs the taproom a cold one? Ten minutes. {rep}", from: [R("Qloo's summary"), "P2"] },
};
const { opener: _o, message: _m, ...BARE } = GOOD; // the set without them (the template's opener and note stay)

test("facts (g4): Qloo's summary, hours, price and rating, the rank and match for the rep's drinkers (prep), the product, the ask; artists and sister doors are prep only", () => {
  assert.equal(tf.facts[0].text, "Meanwhile Brewing");
  assert.ok(tf.facts.filter((f) => f.kind === "room").length >= 8);
  assert.match(tf.facts.find((f) => f.label === "Qloo's summary of the door").text, /brew/i, "Qloo's own summary of the door is a fact now");
  assert.match(tf.facts.find((f) => f.label === "Hours").text, /\d+ ?[ap]m/, "the week's hours as one line");
  assert.equal(hoursLine(PINTHOUSE.hours), "Mon–Thu 11 am–10 pm; Fri–Sat 11 am–11 pm; Sun 11 am–10 pm");
  const why = tf.facts.find((f) => f.label === "Why it's on the rep's list");
  assert.match(why.text, /Athletic Brewing drinkers at 0\.\d\d of 1; rank \d+ of \d+/);
  assert.equal(why.prep, true, "the rank names the drinker brand: prep only");
  assert.ok(tf.facts.some((f) => f.kind === "product" && f.text.includes("12 oz cans")), "lane B's productLine");
  assert.equal(tf.facts.find((f) => f.id === "A").text, "one case of cans in the cooler");
  for (const f of tf.facts.filter((x) => /music|same crowd/.test(x.label))) assert.equal(f.prep, true, f.label);
  assert.match(talkUser(tf), /prep only, never said in the room/);
  assert.ok(tf.avoid.includes("Khruangbin"));
  assert.equal(talkKey(tf), talkKey(JSON.parse(JSON.stringify(tf))), "the key is stable");
  assert.notEqual(talkKey(tf), talkKey({ ...tf, facts: tf.facts.map((f) => (f.id === "A" ? { ...f, text: "two cases" } : f)) }), "a new ask is a new set");
  // the prompt asks for one sharp insight and few lines, and no longer for a taste offer or three of everything
  assert.match(TALK_SYSTEM, /one sharp insight/);
  assert.doesNotMatch(TALK_SYSTEM, /ending with an offer to taste|\(3 questions\)/);
});

test("enrich (lane enrich): enrichFacts lines join the facts; a site line is an S fact a spoken line may state and cite", () => {
  const extra = [
    { label: "Drink kinds this crowd over-indexes on (vs this city's bars)", text: "non-alcoholic (2.1× the city's bars)", src: "qloo", prep: true },
    { label: "Brews its own beer (its own website)", text: "Yes: a rotating list of house-brewed beers", src: "site", from: "https://example.com/beers" },
  ];
  const t2 = talkFacts({ venue: PINTHOUSE, id: PINTHOUSE.id, city, routes: [route], plan: PLAN, profile: PROFILE, ask: tf.ask, venueType: "brewery", na: true, enrich: extra });
  const site = t2.facts.find((f) => f.kind === "site");
  assert.equal(site.id, "S1");
  assert.equal(site.url, "https://example.com/beers");
  assert.ok(t2.facts.some((f) => f.kind === "room" && f.prep && /over-indexes/.test(f.label)));
  assert.ok(checkTalkLine("You already brew your own beers, so I'm not asking for a tap.", "point", t2, ["S1"]).ok, "a stock statement citing the site");
  assert.ok(checkTalkLine("You already have a long list of guest ciders, so this fits.", "point", t2, ["R3"]).ok === false, "a stock statement without the site");
  assert.notEqual(talkKey(t2), talkKey(talkFacts({ venue: PINTHOUSE, id: PINTHOUSE.id, city, routes: [route], plan: PLAN, profile: PROFILE, ask: tf.ask, venueType: "brewery", na: true })), "enrich facts change the key");
  // lane deep: ranked insight facts are the D facts, right after Qloo's summary, and count as door facts
  const t3 = talkFacts({ venue: PINTHOUSE, id: PINTHOUSE.id, city, routes: [route], plan: PLAN, profile: PROFILE, ask: tf.ask, venueType: "brewery", na: true, deep: [{ label: "The gap", text: "Its crowd rates non-alcoholic beer 2.3× the city; its site lists no non-alcoholic beer." }] });
  assert.equal(t3.facts.find((f) => f.kind === "deep").id, "D1");
  assert.equal(t3.facts.findIndex((f) => f.kind === "deep"), t3.facts.findIndex((f) => f.label === "Qloo's summary of the door") + 1);
  assert.ok(checkTalkLine("Its crowd rates non-alcoholic beer well above the city and the site lists none: that gap is the pitch.", "angle", t3, ["D1"]).ok);
  // a D fact from the bar's own site (from = its url) counts as sited for the stock rule (gigbot 10-26)
  const t4 = talkFacts({ venue: PINTHOUSE, id: PINTHOUSE.id, city, routes: [route], plan: PLAN, profile: PROFILE, ask: tf.ask, venueType: "brewery", na: true, deep: [{ label: "The gap", text: "Its site lists a root beer float as the only non-alcoholic drink.", from: "https://pinthouse.com/" }, { label: "Same crowd", text: "Live Oak carries Athletic Brewing." }] });
  assert.ok(checkTalkLine("You already list a root beer float as the only non-alcoholic option, so a hazy fills the gap.", "point", t4, ["D1"]).ok, "sited through the D fact's url");
  assert.equal(checkTalkLine("You already list a root beer float as the only non-alcoholic option, so a hazy fills the gap.", "point", t4, ["D2"]).ok, false, "a D fact without the url is not a site cite");
  assert.match(TALK_SYSTEM, /D…/);
});

test("a good set passes; the template's ask, opener and prep stay; nothing on the set names a model", () => {
  const r = validateTalkSet(GOOD, tf);
  assert.ok(r.ok, JSON.stringify(r.dropped));
  const t = talkPoints({ venue: MEANWHILE, profile: { ...PROFILE, ask: PROFILE.pitch.ask, price: PROFILE.pitch.price }, isNA: true, eta: 14 * 60 + 10, day: "tuesday" }, []);
  const w = withTalkSet(t, { set: r.set, model: "claude-sonnet-5-5", key: "k" });
  assert.equal(w.by, "model");
  assert.equal(w.writtenBy, undefined, "round 3: no label on the screen");
  assert.equal(w.ask, t.ask, "the ask stays the rep's");
  assert.match(w.opener, /^Hi, I'm with Tidewell.*not after a tap/, "g6: the opener is the set's, the rep's blank name folded away");
  assert.equal(withTalkSet(t, { set: validateTalkSet(BARE, tf).set, model: "m", key: "k" }).opener, t.opener, "without one, the opener stays Doors'");
  assert.deepEqual(w.questions, GOOD.questions.map((q) => q.text));
  assert.ok(w.points.some((p) => p.margin), "the price-per-pour point (Doors' sums) stays first");
  assert.match(w.before.find((b) => b.startsWith("Your angle:")), /family friendly/);
  assert.equal(withTalkSet(t, null).by, "template");
  assert.equal(withTalkSet({ ...t, visit: "return" }, { set: r.set }).by, "template", "a return visit keeps the lines from what the rep logged");
});

test("the checks that stay: invented numbers, names, events, stock, patronising the room, artists, a changed ask, no citation, Qloo out loud", () => {
  const room = [R("How the room feels")];
  const bad = [
    ["point", "Most bars sell 40 cases of this a month.", room, /number|other bars/],
    ["point", "Dave the owner told me he loves hazy IPAs.", room, /name not in the facts/],
    ["question", "Would it work for your trivia crowd on Tuesdays?", room, /trivia|name/],
    ["point", "You already have Athletic on tap, so this fits next to it.", room, /room has|names/],
    ["point", "Your crowd is mostly young professionals and families.", room, /own room/],
    ["point", "Families come in here for the food trucks, so it fits.", room, /own room/],
    ["point", "People in their 30s want a drink they can have at lunch.", room, /number/],
    ["point", "Anyone who likes Khruangbin will like this beer.", room, /Khruangbin/],
    ["point", "The same people drink at Whitfield's, so it fits here.", [R("Doors with the same crowd")], /Whitfield/],
    ["reply", "Start with two cases and see how it goes.", ["A"], /number|ask/],
    ["question", "What do people order here when they aren't drinking?", [], /cites no fact/],
    ["angle", "Lead with the driver.", ["P2"], /nothing about the door/],
    ["point", "Qloo says this room is family friendly.", room, /Qloo/],
    ["point", "We pour it for families at every brewery in town.", room, /other bars/],
    ["point", "This is a game-changer for your cooler.", room, /banned/],
    ["question", "Does the patio get busy on weekends?", room, /patio/],
    ["point", "It's great, you'll love it!", room, /plain/],
  ];
  for (const [where, text, from, re] of bad) {
    const r = checkTalkLine(text, where, tf, from);
    assert.equal(r.ok, false, text);
    assert.match(r.reason, re, `${text} → ${r.reason}`);
  }
  // fine (g4): numbers, names and words the facts hold, in any case; a question about their drinks; the drinker brand in
  // an objection; trade words (pour, stock, distribute); a question that cites only the product; a short objection; a
  // buyer's claim about other bars; "what you have"; a brewery brewing its own beer
  assert.ok(checkTalkLine("A case of 24 is $38, and it's 0.5% so a driver can have one.", "point", tf, ["P3", R("How the room feels")]).ok);
  assert.ok(checkTalkLine("Would it sit next to the Helles lager, or on its own in the cooler?", "question", tf, [R("Known for")]).ok);
  assert.ok(checkTalkLine("Would it sit next to the Secret Beach IPA in the cooler?", "question", tf, [R("Known for")]).ok, "the menu's name, capitalised");
  assert.ok(checkTalkLine("We already have Athletic Brewing.", "objection", tf, []).ok);
  assert.ok(checkTalkLine("If you get asked for Athletic Brewing, this is the same drinker on a hazy.", "point", tf, ["P5"]).ok, "the drinker brand is trade talk");
  assert.ok(checkTalkLine("Between lunch and the late nights on Friday, when do more people skip alcohol?", "question", tf, [R("Hours")]).ok);
  assert.ok(checkTalkLine("Mine is a hazy IPA at 0.5%, so compare it before deciding.", "reply", tf, ["P3"]).ok);
  assert.ok(checkTalkLine("No room.", "objection", tf, []).ok);
  assert.ok(checkTalkLine("Every brewery in town is pitching me NA beer this month.", "objection", tf, []).ok);
  assert.ok(checkTalkLine("Good. Start with one case of cans in the cooler and see which one they pick.", "reply", tf, ["A"]).ok);
  assert.ok(checkTalkLine("Your bartenders can pour it for the guest who skips alcohol, and I stock the cooler myself.", "point", tf, ["P3"]).ok);
  assert.ok(checkTalkLine("Who buys for the cooler, and how often do they look at it?", "question", tf, ["P3"]).ok);
  assert.ok(checkTalkLine("It sits next to what you have without taking a tap.", "point", tf, ["P3"]).ok);
  assert.ok(checkTalkLine("Since you brew your own beer, I'm not asking for a tap, only the cooler.", "point", tf, [R("Qloo's summary")]).ok);
  assert.ok(checkTalkLine("It's a hazy IPA with no alcohol, so it is a second option for anyone pacing themselves.", "point", tf, ["P2"]).ok, "an NA product may say so, or not");
});

test("a set needs its angle, a question and a point, and a fact about the door; pushback may be empty", () => {
  assert.equal(validateTalkSet(null, tf).ok, false);
  assert.equal(validateTalkSet({ ...GOOD, points: [{ text: "Dave the owner told me he loves it.", from: ["R6"] }] }, tf).reason, "no point passed");
  assert.equal(validateTalkSet({ ...GOOD, angle: { text: "Lead with the driver.", from: ["P2"] } }, tf).reason, "no angle (the insight) passed");
  const thin = { ...GOOD, questions: GOOD.questions.slice(0, 1), points: GOOD.points.slice(0, 1), pushback: [] };
  const r = validateTalkSet(thin, tf);
  assert.ok(r.ok, "fewer lines beat filler");
  assert.equal(r.set.pushback.length, 0);
  // the g3 "must say who it's for" rule is gone: an NA set that never says "isn't drinking" passes
  const noNA = { ...GOOD, to_buyer: { text: "It's a hazy IPA in 12 oz cans, so can I open one for you to taste?", from: ["P2"] }, questions: GOOD.questions.slice(2).concat([{ text: "When you have food trucks in, what do people order with the tacos?", from: [R("The crowd is into")] }]), pushback: [GOOD.pushback[0]].map((p) => ({ ...p, objection: "We already have an option for that." })), points: [{ text: "It gives the parent at a family table something that tastes like a beer.", from: [R("How the room feels")] }, GOOD.points[1]] };
  assert.ok(validateTalkSet(noNA, tf).ok);
});

test("g6: the opener and the message are the model's, with {rep} and {when} filled on the device; the note swaps in; a message must say when and name the city", async () => {
  const withOM = { ...GOOD,
    opener: { text: "Hi, I'm {rep} with Tidewell, a non-alcoholic hazy IPA. Since you brew your own, who handles the cooler, and when's a good time to catch them?", from: [R("Qloo's summary")] },
    message: { subject: "Tidewell, a non-alcoholic hazy IPA, for the cooler", body: "Hi,\n\nI'm {rep} with Tidewell, a non-alcoholic hazy IPA in 12 oz cans. You brew your own beer, so I'm not after a tap: a hazy with no alcohol is the one style a brewery rarely makes itself, and your food-truck tables will have a driver at them.\n\nI'm out meeting breweries around Austin and I'll be over your way {when}. Could I pour whoever runs the taproom a cold one? Ten minutes.\n\nThanks,\n{rep}", sms: "Hi, it's {rep} from Tidewell, a non-alcoholic hazy IPA. I'll be over your way {when}. Could I pour whoever runs the taproom a cold one? Ten minutes. – {rep}", from: [R("Qloo's summary"), "P2"] } };
  const r = validateTalkSet(withOM, tf);
  assert.ok(r.ok, JSON.stringify(r.dropped));
  assert.ok(r.set.opener && r.set.message, "both kept");
  const t = talkPoints({ venue: MEANWHILE, profile: { ...PROFILE, name: "Maya Ortiz", ask: PROFILE.pitch.ask, price: PROFILE.pitch.price }, isNA: true, eta: 14 * 60 + 10, day: "tuesday" }, []);
  const w = withTalkSet(t, { set: r.set, model: "m", key: "k" }, { rep: "Maya", when: "Tuesday a little after 2" });
  assert.match(w.opener, /^Hi, I'm Maya with Tidewell/);
  assert.equal(w.lines.opener, "model");
  assert.match(w.message.body, /over your way Tuesday a little after 2\./);
  assert.match(w.message.body, /Thanks,\nMaya$/);
  assert.doesNotMatch(JSON.stringify(w.message), /\{rep\}|\{when\}/);
  assert.match(fillPlaceholders("I'll be by {when}.", {}), /one afternoon soon/);
  assert.equal(fillPlaceholders("Hi, I'm {rep} with Tidewell.", { rep: "" }), "Hi, I'm with Tidewell.");
  // the checks: no {when} → refused; the city missing → refused; the rep's name is never in the facts
  assert.match(checkTalkLine(withOM.message.body.replace("{when}", "soon"), "message", tf, withOM.message.from).reason, /when/);
  assert.match(checkTalkLine(withOM.message.body.replace("Austin", "town"), "message", tf, withOM.message.from).reason, /city/);
  // Jard 10-24 note 5: the message asks for a time and a taste, never the order
  assert.match(checkTalkLine(withOM.message.body.replace("Ten minutes.", "The ask is one case of cans in the cooler."), "message", tf, withOM.message.from).reason, /names the order/);
  assert.match(checkTalkLine(withOM.message.sms.replace("Ten minutes.", "Aim: one case in the cooler."), "sms", tf, withOM.message.from).reason, /names the order/);
  assert.match(checkTalkLine("Hi, it's {rep} from Tidewell. I'll be over your way {when}. Start with one case? – {rep}", "sms", tf, []).reason, /names the order/);
  assert.ok(!JSON.stringify(tf).includes("Maya"));
  assert.ok(checkTalkLine("Hi, I'm {rep} with Tidewell. Who does the beer buying here?", "opener", tf, []).ok, "an opener may cite nothing");
  // a set without them still passes; the template's opener and note stay
  const r2 = validateTalkSet(BARE, tf);
  const w2 = withTalkSet(t, { set: r2.set, model: "m", key: "k" }, { rep: "Maya" });
  assert.equal(w2.opener, t.opener);
  assert.equal(w2.message, null);
  // stopModel: the written message is the note (by "model"), placeholders filled from the profile and the day
  const { stopModel } = await import("../public/lib/stopmodel.js");
  const plan = { city: { key: "austin", name: "Austin" }, profile: { ...PROFILE, name: "Maya Ortiz" }, venues: route.venues, days: [{ day: "tuesday", date: "2026-10-27", stops: [{ id: MEANWHILE.id, eta: 14 * 60 + 10 }] }], pool: { ids: [MEANWHILE.id], N: 1 } };
  const m0 = stopModel({ plan, id: MEANWHILE.id, dayIndex: 0, city, routes: [route] });
  const m = stopModel({ plan, id: MEANWHILE.id, dayIndex: 0, city, routes: [route], talkSets: { live: { [m0.talkKey]: { set: r.set, model: "m" } } } });
  assert.equal(m.note.by, "model");
  assert.match(m.note.body, /Tuesday a little after 2/, "Doors' own time wording (lib/talk.js humanTime)");
  assert.match(m.note.sms, /Maya/);
  assert.equal(m.talk.lines.opener, "model");
  assert.equal(m0.note.by, "template");
});

test("a stored or baked set is checked again against today's facts before it shows", () => {
  const r = validateTalkSet(GOOD, tf);
  const k = talkKey(tf);
  const bk = bakedTalkKey({ id: MEANWHILE.id, profile: PROFILE, ask: tf.ask });
  assert.ok(pickTalkSet({ live: { [k]: { set: r.set, model: "m" } } }, { key: k, id: MEANWHILE.id, profile: PROFILE, ask: tf.ask }, tf));
  assert.equal(pickTalkSet({ baked: { [bk]: { set: r.set } } }, { key: "other", id: MEANWHILE.id, profile: PROFILE, ask: tf.ask }, tf).baked, true);
  // the facts changed (the price fact P3 is gone): the lines that used its numbers are dropped on the way to the screen
  const fewer = { ...tf, facts: tf.facts.filter((f) => f.id !== "P3") };
  const again = pickTalkSet({ live: { [k]: { set: r.set } } }, { key: k, id: MEANWHILE.id, profile: PROFILE, ask: tf.ask }, fewer);
  assert.equal(again.set.toBuyer, null, "12 oz was P3's");
  assert.equal(again.set.points.length, 1, "$38 was P3's");
  // and a set that loses its angle to a facts change falls back to the template
  const noSummary = { ...tf, facts: tf.facts.filter((f) => !/summary|feels|into/.test(f.label)) };
  assert.equal(pickTalkSet({ live: { [k]: { set: r.set } } }, { key: k, id: MEANWHILE.id, profile: PROFILE, ask: tf.ask }, noSummary), null);
  assert.equal(pickTalkSet(null, { key: k }, tf), null);
});

test("Qloo's crowd description reaches the model (round 3) under the so-what rule; a soft drink is never the non-alcoholic option; blank 'What you make' gets no set", async () => {
  // Jard 10-25: the crowd text is a fact now ("why is it there if not to be used"); a demographic shapes the occasion,
  // never a drink claim (tasteGuess, and the proof's label probe)
  const tfOf = (crowd) => talkFacts({ venue: { ...MEANWHILE, crowd }, id: MEANWHILE.id, city, routes: [route], plan: PLAN, profile: PROFILE, ask: tf.ask, venueType: "brewery", na: true });
  assert.notEqual(talkKey(tfOf("The customer base primarily consists of Hispanic families.")), talkKey(tfOf("The customer base primarily consists of retirees and older couples.")));
  assert.match(tfOf("Black professionals").facts.find((f) => f.label.startsWith("Who goes")).text, /Black professionals/);
  assert.match(TALK_SYSTEM, /SO WHAT/);
  assert.match(checkTalkLine("Hispanic families like a lighter beer, so lead with the lager.", "point", tf, ["R3"]).reason, /guesses a group's taste/);
  assert.match(checkTalkLine("Retirees go for wine here.", "angle", tf, ["R3"]).reason, /guesses a group's taste/);
  assert.ok(checkTalkLine("Families at lunch means whoever is driving wants a 0.5% can with the pizza.", "point", tf, ["R3", "P3"]).ok, "the occasion is fine");
  assert.ok(checkTalkLine("Do the students in at 9 pm ask for anything without alcohol?", "question", tf, ["R3"]).ok, "a question is fine");
  // a soft drink, or an alcoholic one, is never pitched as the non-alcoholic option (a truth check that stays)
  const water = talkFacts({ venue: MEANWHILE, id: MEANWHILE.id, city, routes: [route], plan: PLAN, profile: { ...PROFILE, what: "Canned spring water" }, ask: tf.ask, venueType: "brewery", soft: true });
  assert.match(water.facts.find((f) => f.label === "What kind of drink").text, /never pitched as the non-alcoholic/);
  assert.match(checkTalkLine("It gives the guest who isn't drinking something better than tap water.", "point", water, [R("How the room feels")]).reason, /non-alcoholic option/);
  // … unless it's the rep's own words: their ask
  const zero = { ...water, ask: "one flavour on the menu as a zero-proof option", facts: water.facts.map((f) => (f.id === "A" ? { ...f, text: "one flavour on the menu as a zero-proof option" } : f)) };
  assert.ok(checkTalkLine("Then start with one flavour on the menu as a zero-proof option and see how it moves.", "reply", zero, ["A"]).ok);
  // What you make blank: nothing to pitch
  const { stopModel } = await import("../public/lib/stopmodel.js");
  const plan = { city: { key: "austin", name: "Austin" }, profile: { ...PROFILE, what: "" }, venues: route.venues, days: [], pool: { ids: [MEANWHILE.id], N: 1 } };
  assert.equal(stopModel({ plan, id: MEANWHILE.id, city, routes: [route] }).talkReq, null);
  // stopModel passes a door's enrich facts through
  const plan2 = { ...plan, profile: PROFILE };
  const m = stopModel({ plan: plan2, id: MEANWHILE.id, city, routes: [route], enrich: { [MEANWHILE.id]: [{ label: "Taps (its own website)", text: "20 taps, all house beers", src: "site", from: "https://example.com" }] } });
  assert.ok(m.talkReq.facts.some((f) => f.kind === "site"));
});

// ---------- the Worker ----------
const reply = (obj, usage = { input_tokens: 1600, output_tokens: 900 }) => new Response(JSON.stringify({ content: [{ type: "text", text: JSON.stringify(obj) }], stop_reason: "end_turn", usage }), { status: 200, headers: { "content-type": "application/json" } });
const memKV = () => { const m = new Map(); return { get: async (k) => (m.has(k) ? JSON.parse(m.get(k)) : null), put: async (k, v) => void m.set(k, v), m }; };
const envOf = (fetchImpl, extra = {}) => ({ ANTHROPIC_API_KEY: "test", ANTHROPIC_FETCH: fetchImpl, DOORS_KV: memKV(), TODAY: "2026-10-24", ...extra });

test("POST /api/talk: one Sonnet call a door at high effort, checked, kept in KV; a second ask for the same facts is free", async () => {
  _resetTalk(); _resetSpend?.();
  let calls = 0;
  let sent = null;
  const env = envOf(async (url, init) => { calls++; sent = JSON.parse(init.body); return reply(GOOD); });
  const post = (body, origin = "https://doors.example") => worker.fetch(new Request("https://doors.example/api/talk", { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify(body) }), env, {});
  const j = await (await post({ tf })).json();
  assert.ok(j.set, JSON.stringify(j));
  assert.equal(TALK_MODEL, "claude-sonnet-5-5");
  assert.equal(j.model, "claude-sonnet-5-5");
  assert.equal(sent.model, "claude-sonnet-5-5");
  assert.equal(sent.output_config.effort, "high");
  assert.equal(sent.tools.length, 0, "no tools");
  assert.ok(!JSON.stringify(sent).includes("Maya"), "the rep's name never leaves Doors");
  assert.ok(j.usd > 0 && j.usd < 0.05, `$${j.usd} a door`);
  const again = await (await post({ tf })).json();
  assert.equal(again.cached, true);
  assert.equal(calls, 1);
  assert.equal((await post({ tf }, "https://evil.example")).status, 403);
  assert.equal((await post({ tf: { facts: [] } })).status, 400);
});

test("POST /api/talk: lines that fail get one retry that names them; still failing → the template, no model named", async () => {
  _resetTalk();
  const users = [];
  const BAD = { ...GOOD, angle: { text: "Lead with the driver.", from: ["P2"] } };
  let n = 0;
  const env = envOf(async (url, init) => { users.push(JSON.parse(init.body).messages[0].content); return reply(n++ ? GOOD : BAD); });
  const r = await talkTurn({ tf, env });
  assert.ok(r.set);
  assert.equal(r.tries, 2);
  assert.match(users[1], /failed Doors' checks[\s\S]*Lead with the driver/);
  _resetTalk();
  const env2 = envOf(async () => reply(BAD));
  const r2 = await talkTurn({ tf, env: env2 });
  assert.equal(r2.fallback, true);
  assert.equal(r2.tries, 2, "never more than two calls");
  assert.doesNotMatch(r2.message, /Claude|Sonnet|Haiku/);
});

test("g6: a set that passes but lost its opener or message gets the second try; the first good set is kept when the retry is worse", async () => {
  _resetTalk();
  const OM = { opener: { text: "Hi, I'm {rep} with Tidewell, a non-alcoholic hazy IPA. You brew your own, so I'm not after a tap. Who looks after the cooler?", from: [R("Qloo's summary")] }, message: { subject: "Tidewell for the cooler", body: "Hi,\n\nI'm {rep} with Tidewell, a non-alcoholic hazy IPA. You brew your own, so a hazy with no alcohol is the one style you won't make. I'm out meeting breweries around Austin and I'll be over your way {when}. Could I pour whoever runs the taproom a cold one? Ten minutes.\n\nThanks,\n{rep}", sms: "Hi, it's {rep} from Tidewell, a non-alcoholic hazy IPA. I'll be over your way {when}. Ten minutes and a taste? {rep}", from: [R("Qloo's summary")] } };
  let n = 0;
  const env = envOf(async () => reply(n++ ? { ...GOOD, ...OM } : { ...GOOD, ...OM, message: { ...OM.message, sms: "Your room fills up late, so start with one case. {when} {rep}" } }));
  const r = await talkTurn({ tf, env });
  assert.equal(r.tries, 2, "the lost text earns the second try");
  assert.ok(r.set.message, "and the second try's message is kept");
  _resetTalk();
  let k = 0;
  const env2 = envOf(async () => reply(k++ ? { ...GOOD, angle: { text: "Lead with the driver.", from: ["P2"] } } : { ...GOOD, ...OM, message: { ...OM.message, sms: "Start with one case. {when} {rep}" } }));
  const r2 = await talkTurn({ tf, env: env2 });
  assert.equal(r2.tries, 2);
  assert.ok(r2.set && r2.set.opener && !r2.set.message, "the first good set is kept when the retry loses the whole set");
});

test("POST /api/talk: the day's Claude budget spent, no key, or a visitor over their cap → the template, no call", async () => {
  _resetTalk();
  let calls = 0;
  const f = async () => (calls++, reply(GOOD));
  assert.equal((await talkTurn({ tf, env: envOf(f, { AGENT_USD_DAILY: 0 }) })).reason, "spent");
  assert.equal((await talkTurn({ tf, env: envOf(f, { ANTHROPIC_API_KEY: "" }) })).reason, "off");
  const env = envOf(f, { TALK_VISITOR_DAILY: 1 });
  await talkTurn({ tf, env, ip: "a" });
  const other = { ...tf, facts: tf.facts.map((x) => (x.id === "A" ? { ...x, text: "a sixtel on a guest tap line" } : x)), ask: "a sixtel on a guest tap line" };
  assert.equal((await talkTurn({ tf: other, env, ip: "a" })).reason, "busy");
  assert.equal(calls, 1);
  assert.equal(cleanTalkFacts({ facts: [{ id: "X1", text: "x" }] }), null, "odd ids are refused");
  assert.ok(cleanTalkFacts({ facts: [{ id: "R1", kind: "room", text: "x" }, { id: "S1", kind: "site", text: "y" }] }).facts.some((x) => x.kind === "site"), "site facts pass the Worker's shaping");
  assert.ok(cleanTalkFacts({ facts: [{ id: "R1", kind: "room", text: "x" }, { id: "D1", kind: "deep", text: "z" }] }).facts.some((x) => x.kind === "deep"), "deep facts too");
});
