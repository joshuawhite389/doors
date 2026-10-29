// Talking points (public/lib/talk.js) on real Austin venues from the precompute: a brewery, a bar and a restaurant;
// NA vs alcohol; arriving during service vs the lull; no banned words; no stocking claims; every fact sourced.
import { test } from "node:test";
import assert from "node:assert/strict";
import { talkPoints, venueType, productKind, arrivalAdvice, crowdPhrase, phoneText } from "../public/lib/talk.js";
import { BANNED_PITCH, BRAND_CATEGORY, NA_BRANDS } from "../public/lib/core.js";
import { route, city, readJson } from "./helpers.mjs";

const R = route("athletic-brewing-austin");
const C = city("austin");
const FACTS = readJson("public/data/facts.json").facts;
const ids = R.lists.all.map(([id]) => id);
const byName = (n) => {
  const id = ids.find((x) => R.venues[x].name === n);
  assert.ok(id, `${n} is in the Austin list`);
  return { venue: R.venues[id], rank: ids.indexOf(id) + 1 };
};
const sistersOf = (v) => (C.sisters[v.id] ?? []).slice(0, 2).map(([id]) => C.sisterVenues[id]?.name).filter(Boolean);
const TIDEWELL = { brand: "Tidewell", what: "Non-alcoholic hazy IPA", price: "$38 a case", ask: "", support: "a staff tasting", drinksLike: ["Athletic Brewing"] };
const TEQUILA = { brand: "Agave Norte", what: "Reposado tequila", drinksLike: ["Casamigos"] };
const make = (name, { profile = TIDEWELL, isNA = true, eta = 14 * 60 + 10 } = {}) => {
  const { venue, rank } = byName(name);
  // the kind × venue-type template = the R9 deep ablation baseline (deep: test/culture.test.mjs)
  return talkPoints({ venue, rank, N: ids.length, drinkerName: "Athletic Brewing", city: "Austin", profile, eta, isNA, sisters: sistersOf(venue), deepOff: true }, FACTS);
};
// every line a rep reads, flattened
const lines = (t) => [...t.before, t.opener, ...(t.toBuyer ? [t.toBuyer] : []), ...t.questions, ...t.points.map((p) => p.text), ...t.pushback.flatMap((p) => [p.objection, p.reply]), t.ask];
// statements: everything except questions and the venue's own (quoted) objections
const statements = (t) => [...t.before, ...t.points.map((p) => p.text), ...t.pushback.map((p) => p.reply), t.ask, ...t.opener.split(/(?<=[.?])\s+/).filter((s) => !s.endsWith("?"))];
// a before line by its kind ("who", "timing", "order", "bring", "why", "angle", "sisters")
const at = (t, k) => t.before[t.beforeKinds.indexOf(k)];
const SAMPLES = [
  ["Nomadic Beerworks", "brewery"],
  ["The Lucky Duck", "bar"],
  ["Tacos Guerrero", "restaurant"],
];

test("venue type from genreLabel: a brewery, a bar and a restaurant in the Austin precompute", () => {
  for (const [name, type] of SAMPLES) assert.equal(venueType(byName(name).venue), type, name);
  assert.equal(venueType({ genre: "urn:tag:genre:place:restaurant:cafe", name: "Corner Café" }), "coffee");
  assert.equal(venueType({ genre: "urn:tag:genre:place:wine_bar", name: "Vino" }), "bar");
  assert.equal(venueType({ genre: "urn:tag:genre:place:restaurant:mexican", name: "Taqueria" }), "restaurant");
});

test("shape: six sections, template-labelled, 3 questions, 3–4 points (plus the product line), 2–3 pushbacks", () => {
  for (const [name] of SAMPLES)
    for (const isNA of [true, false]) {
      const t = make(name, { isNA, profile: isNA ? TIDEWELL : TEQUILA });
      assert.equal(t.by, "template");
      // judge pass 4 (N24): the sister rooms, when Qloo has any, are a fifth line for the rep, after why she's here
      const { venue } = byName(name);
      // Jard 10-24 #5: prep is who, timing, buy something first, bring, why you're here, the angle (+ sister doors)
      // group 3: no angle line when no Qloo tag points at one (the na / soft / taste fallbacks)
      const angled = !["na", "soft", "taste"].includes(t.angle.key) || /Your angle/.test(t.before.join(" "));
      assert.deepEqual(t.beforeKinds, ["who", "timing", "order", "bring", "why", ...(angled ? ["angle"] : []), ...(sistersOf(venue).length ? ["sisters"] : [])], name);
      if (sistersOf(venue).length) assert.match(at(t, "sisters"), /^Sister doors: Qloo matches its regulars to /);
      assert.match(at(t, "why"), /^Why you're here: Qloo ranks this door #\d+ of \d+ /, "the rank is rep-facing context (R2 Calacanis 11)");
      assert.match(at(t, "order"), /^Order something and pay for it before you ask for anyone/);
      if (angled) assert.match(at(t, "angle"), /^Your angle: /);
      assert.doesNotMatch(t.before.join(" "), /Nothing in Qloo's tags/);
      assert.match(t.toBuyer, /\?/, "the line for the buyer carries an offer to taste");
      assert.doesNotMatch(`${t.opener} ${t.toBuyer}`, /Looks like|your regulars|crowd|Qloo|#\d/, "nothing about the room's crowd or the data is said out loud");
      assert.ok(!t.points.some((p) => /Qloo ranks|#\d+ of/.test(p.text)), "no rank among the points to make");
      assert.ok(t.opener.length > 20);
      assert.equal(t.questions.length, 3);
      assert.ok(t.questions.every((q) => q.endsWith("?")));
      assert.ok(t.points.length >= 2 && t.points.length <= 4, `${name}: ${t.points.length} points`);
      assert.ok(t.pushback.length >= 2 && t.pushback.length <= 3);
      assert.ok(t.ask.length > 5);
    }
});

test("brewery, NA brand, in the lull: taproom manager, 'good time', the crowd opener, NA facts", () => {
  const t = make("Nomadic Beerworks");
  assert.match(t.before[0], /taproom manager/);
  assert.equal(t.arrival, "lull");
  assert.equal(t.before[1], "You'll get there a little after 2 pm, between lunch and dinner — a good time to catch a manager.");
  assert.match(at(t, "bring"), /\$38 a case/);
  assert.match(t.opener, /^(Hi|Hey), I'm with Tidewell, a non-alcoholic hazy IPA\. Who does the beer buying here\? Mind if I grab their name and the best time to catch them\?$/);
  assert.equal(t.openerSource, null);
  assert.equal(at(t, "why"), "Why you're here: Qloo ranks this door #1 of 100 Austin bars and restaurants for people who drink Athletic Brewing.");
  assert.ok(t.facts.length === 2 && t.facts.every((id) => FACTS.find((f) => f.id === id).appliesTo.includes("na")));
  assert.ok(t.pushback.some((p) => /our own beer/.test(p.objection)), "a brewery hears 'we only serve our own beer'");
  assert.ok(t.pushback.some((p) => /Athletic Brewing/.test(p.objection)), "the drinks-like brand shows up as an objection");
  assert.match(t.points.at(-1).text, /^Tidewell is a non-alcoholic hazy IPA; we back it with a staff tasting\.$/);
  assert.equal(t.ask, "one case of cans in the cooler");
});

test("bar, alcohol brand, during dinner service: call first with the phone; only 'all' facts; back-bar ask", () => {
  const t = make("The Lucky Duck", { isNA: false, profile: TEQUILA, eta: 18 * 60 });
  assert.match(t.before[0], /bar manager or beverage director/);
  assert.equal(t.arrival, "service");
  assert.match(t.before[1], /^You'll get there around 6 pm, during service — call first: \(512\) 537-1519\./);
  assert.match(t.opener, /^(Hi|Hey), I'm with Agave Norte, a reposado tequila\. Is your bar manager around\? If not, when's a good time to catch them\?$/);
  assert.equal(t.toBuyer, "Can I pour you one neat? Then we can talk about where it'd fit.");
  assert.ok(!/isn't drinking/.test(t.opener));
  assert.ok(t.facts.length <= 1 && t.facts.every((id) => FACTS.find((f) => f.id === id).appliesTo.includes("all")), "alcohol: no NA stats");
  assert.match(t.questions[1], /back bar/);
  assert.equal(t.ask, "one bottle for the back bar");
});

test("restaurant at lunch service: GM, call first; NA restaurant facts; the profile's own ask wins", () => {
  const t = make("Tacos Guerrero", { eta: 12 * 60, profile: { ...TIDEWELL, ask: "two cases for the patio cooler" } });
  assert.match(t.before[0], /general manager/);
  assert.match(t.before[1], /around noon, during service — call first: \(512\) 939-2308/);
  assert.match(t.questions[2], /drinks list/);
  assert.ok(t.facts.length === 2 && t.facts.every((id) => ["na-menu-95k", "na-return-39", "na-sales-2024", "na-table-time"].includes(id)), t.facts.join());
  assert.equal(t.ask, "two cases for the patio cooler");
});

test("arrival logic: lull 2–5 pm; service 11:30–1:30 and after 5:30; edges; no phone; string eta", () => {
  assert.equal(arrivalAdvice(14 * 60).kind, "lull");
  assert.equal(arrivalAdvice(16 * 60 + 59).kind, "lull");
  assert.equal(arrivalAdvice(11 * 60 + 30).kind, "service");
  assert.equal(arrivalAdvice(13 * 60 + 29).kind, "service");
  assert.equal(arrivalAdvice(13 * 60 + 45).kind, "late-lunch");
  assert.equal(arrivalAdvice(17 * 60 + 10).kind, "pre-dinner");
  assert.equal(arrivalAdvice(17 * 60 + 30).kind, "service");
  assert.equal(arrivalAdvice(21 * 60).kind, "service");
  assert.equal(arrivalAdvice(10 * 60).kind, "early");
  assert.equal(arrivalAdvice("14:10").kind, "lull");
  assert.equal(arrivalAdvice(null).kind, "unknown");
  assert.match(arrivalAdvice(19 * 60, null).text, /call first if you can find a number/);
  assert.equal(phoneText("+15125879669"), "(512) 587-9669");
});

test("no banned words in any line, for every top-30 Austin venue, NA and alcohol, at three times of day", () => {
  for (const id of ids.slice(0, 30)) {
    const venue = R.venues[id];
    for (const [isNA, profile] of [[true, TIDEWELL], [false, TEQUILA], [false, { brand: "Lone Pils", what: "Czech pilsner" }]])
      for (const eta of [12 * 60, 15 * 60, 19 * 60]) {
        const t = talkPoints({ venue, rank: 1, N: 100, drinkerName: "Athletic Brewing", city: "Austin", profile, eta, isNA, sisters: sistersOf(venue) }, FACTS);
        for (const l of lines(t)) assert.ok(!BANNED_PITCH.test(l), `${venue.name}: "${l}"`);
      }
  }
});

test("no stocking claims: statements never say carries/pours/stocks/serves your; questions may ask", () => {
  const CLAIM = /\b(carr(y|ies)|pours?|stocks?|on tap|serves? (our|your|it))\b/i;
  for (const id of ids.slice(0, 30)) {
    const venue = R.venues[id];
    for (const [isNA, profile] of [[true, TIDEWELL], [false, TEQUILA]]) {
      const t = talkPoints({ venue, rank: 2, N: 100, drinkerName: "Athletic Brewing", city: "Austin", profile, eta: 15 * 60, isNA, sisters: sistersOf(venue) }, FACTS);
      for (const s of statements(t)) assert.ok(!CLAIM.test(s), `${venue.name}: "${s}"`);
    }
  }
});

test("no artist names: a crowd line naming an artist (or a name in `avoid`) is not used", () => {
  const v = { name: "X", genre: "urn:tag:genre:place:bar", crowd: "The customer base consists of fans of Willie Nelson and local regulars." };
  assert.equal(crowdPhrase(v), null);
  const w = { name: "Y", genre: "urn:tag:genre:place:bar", crowd: "The bar attracts Khruangbin listeners and students." };
  assert.equal(crowdPhrase(w, ["Khruangbin"]), null);
  const t = talkPoints({ venue: w, profile: TIDEWELL, isNA: true, eta: 900, avoid: ["Khruangbin"] }, FACTS);
  assert.ok(!lines(t).some((l) => /Khruangbin/.test(l)));
  assert.match(t.opener, /^(Hi|Hey), I'm with Tidewell/);
  // the Austin sound lists never leak into talking points
  const artists = new Set([...(C.citySound ?? []), ...(C.commonArtists ?? [])].map((a) => (typeof a === "string" ? a : a?.name)).filter((n) => n && n.length > 3 && !/^[0-9A-F-]{30,}$/i.test(n)));
  assert.ok(artists.size >= 10, "the city's artist list is loaded");
  for (const id of ids.slice(0, 30)) {
    const t = talkPoints({ venue: R.venues[id], rank: 1, N: 100, drinkerName: "Athletic Brewing", city: "Austin", profile: TIDEWELL, eta: 900, isNA: true, sisters: sistersOf(R.venues[id]) }, FACTS);
    for (const l of lines(t)) for (const a of artists) assert.ok(!new RegExp(`\\b${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(l), `${a} in "${l}"`);
  }
});

test("every fact used exists in facts.json with an https url and a source; facts.json is well-formed", () => {
  const known = new Map(FACTS.map((f) => [f.id, f]));
  assert.equal(known.size, FACTS.length, "ids are unique");
  for (const f of FACTS) {
    assert.match(f.url, /^https:\/\//, f.id);
    assert.ok(f.source && f.text, f.id);
    assert.ok(Array.isArray(f.appliesTo) && f.appliesTo.every((a) => a === "na" || a === "all"), f.id);
    assert.ok(!BANNED_PITCH.test(f.text), f.id);
  }
  for (const id of ids.slice(0, 30))
    for (const [isNA, profile] of [[true, TIDEWELL], [false, TEQUILA]]) {
      const t = talkPoints({ venue: R.venues[id], rank: 1, N: 100, drinkerName: "Athletic Brewing", city: "Austin", profile, eta: 900, isNA }, FACTS);
      for (const fid of t.facts) assert.ok(known.get(fid)?.url, fid);
      assert.deepEqual(t.facts, t.points.filter((p) => p.fact).map((p) => p.fact));
      for (const p of t.points.filter((x) => x.fact)) assert.equal(p.text, known.get(p.fact).text, "fact text is never rewritten");
    }
  // a fact with a category only applies to that category (NA beer share never shows for NA spirits)
  const t = talkPoints({ venue: byName("Nomadic Beerworks").venue, profile: { brand: "Zero G", what: "Non-alcoholic gin" }, isNA: true }, FACTS);
  assert.ok(!t.facts.includes("na-beer-onprem-36"));
  // without facts: no fact points, still a full card
  assert.deepEqual(talkPoints({ venue: byName("Nomadic Beerworks").venue, profile: TIDEWELL, isNA: true }).facts, []);
});

test("productKind maps 'What you make' to a format", () => {
  assert.equal(productKind("Non-alcoholic hazy IPA"), "beer");
  assert.equal(productKind("Reposado tequila"), "spirit");
  assert.equal(productKind("Hard seltzer"), "seltzer");
  assert.equal(productKind("Dry cider"), "cider");
  assert.equal(productKind("Canned water"), "soft"); // N2: a soft drink (was "other")
  assert.equal(productKind("Natural wine"), "wine");
});

// ---------- R1 fixes (C1) ----------
test("D2: venue type uses whole words: a steakhouse is a restaurant, not a tea room; tea houses are still coffee", () => {
  assert.equal(venueType({ genre: "urn:tag:genre:place:restaurant:steakhouse", name: "Bob's Steak & Chop House" }), "restaurant");
  assert.equal(venueType({ genre: "urn:tag:genre:place:restaurant:steak_house", name: "Steak 48" }), "restaurant");
  assert.equal(venueType({ genre: "urn:tag:genre:place:restaurant:tea_house", name: "Tea Haus" }), "coffee");
  assert.equal(venueType({ genre: "urn:tag:genre:place:restaurant:public_house", name: "Public" }), "restaurant");
  const steaks = Object.values(R.venues).filter((v) => /steak/i.test(v.genre ?? ""));
  for (const v of steaks) assert.notEqual(venueType(v), "coffee", v.name);
});

test("D3: 'your guests already buy non-alcoholic drinks' only when the drinks-like brand is NA like the product", () => {
  const { venue } = byName("The Lucky Duck");
  const run = (profile, isNA) => talkPoints({ venue, rank: 3, N: 100, drinkerName: "x", city: "Austin", profile, isNA }, FACTS).pushback[0];
  const naVsTequila = run({ ...TIDEWELL, drinksLike: [{ name: "Casamigos", na: false }] }, true);
  assert.equal(naVsTequila.objection, "We already have Casamigos.");
  assert.doesNotMatch(naVsTequila.reply, /already buy/);
  assert.match(naVsTequila.reply, /isn't drinking tonight/);
  assert.match(run({ ...TIDEWELL, drinksLike: [{ name: "Athletic Brewing", na: true }] }, true).reply, /already buy non-alcoholic drinks/);
  assert.doesNotMatch(run({ ...TEQUILA, drinksLike: [{ name: "Liquid Death", na: true }] }, false).reply, /already buy/);
  // R9 proof finding 2: the claim names the brand's own category (the data), never the product's; no category, no claim
  assert.match(run({ ...TEQUILA, drinksLike: [{ name: "Casamigos", na: false, category: "Tequila" }] }, false).reply, /^Good: your guests already buy tequila\./);
  assert.doesNotMatch(run({ ...TEQUILA, drinksLike: [{ name: "Casamigos", na: false }] }, false).reply, /already buy/);
});

test("BRAND_CATEGORY and NA_BRANDS match the held brands in public/data/index.json", () => {
  const brands = readJson("public/data/index.json").brands;
  assert.deepEqual(BRAND_CATEGORY, Object.fromEntries(brands.map((b) => [b.key, b.category])));
  assert.deepEqual([...NA_BRANDS].sort(), brands.filter((b) => b.na).map((b) => b.key).sort());
});

test("R9 proof finding 2: 'We already have Casamigos' never becomes 'your guests already buy small-batch mezcal'", () => {
  const { venue } = byName("The Lucky Duck");
  const MEZCAL = { brand: "Brasa Verde", what: "Small-batch mezcal" };
  const run = (like) => talkPoints({ venue, profile: { ...MEZCAL, drinksLike: [like] }, isNA: false }, FACTS).pushback[0].reply;
  assert.equal(run({ name: "Casamigos", na: false, category: "Tequila" }), "Good: your guests already buy tequila. Brasa Verde sits next to it as a second option, not a replacement.");
  // another kind (a seltzer, a beer) backs no claim about a spirit
  assert.doesNotMatch(run({ name: "White Claw", na: false, category: "Hard seltzer" }), /already buy/);
  assert.doesNotMatch(run({ name: "Casamigos", na: null, category: "Tequila" }), /already buy/);
  for (const like of [{ name: "Casamigos", na: false, category: "Tequila" }, { name: "Casamigos", na: false }]) assert.doesNotMatch(run(like), /mezcal/);
});

test("R9 proof finding 1: the pushback's small start is the rep's own ask, verbatim, never a kind default that contradicts it", () => {
  const { venue } = byName("The Lucky Duck");
  const CIDER = { brand: "Hollow Oak", what: "Dry craft cider", price: "$44 a case of 24", ask: "a cider on draft for a month" };
  const t = talkPoints({ venue, profile: CIDER, isNA: false, deepOff: true }, FACTS);
  const nosell = t.pushback.find((p) => /doesn't sell here/.test(p.objection)).reply;
  assert.equal(nosell, "Then start with a cider on draft for a month. If it doesn't move in a few weeks, you've only given up one rotating tap line."); // persona MUST #2: the rep's keg words
  assert.doesNotMatch(t.pushback.map((p) => p.reply).join(" "), /case of cans|no keg|shelf spot|row in the cooler/);
  // the return visit's price reply: the same start; a case price never prices a draft (or a bottle)
  const back = (profile) => talkPoints({ venue, profile, isNA: false, deepOff: true, memory: { visit: "return", objection: { kind: "price", words: "too pricey" } } }, FACTS).pushback[0].reply;
  assert.equal(back(CIDER), "Start with a cider on draft for a month; if it doesn't move in a few weeks, we'll look at it together.");
  assert.doesNotMatch(back({ brand: "Brasa Verde", what: "Small-batch mezcal", price: "$420 a case of 12" }), /\$420/);
  assert.match(back({ ...CIDER, ask: "two cases of cans" }), /^Start with two cases of cans \(\$44 a case of 24\)/);
  // a blank ask: the ask the notes use (the kind's default), the same words in the pushback and the ask
  const d = talkPoints({ venue, profile: { ...CIDER, ask: "" }, isNA: false, deepOff: true }, FACTS);
  assert.match(d.pushback.find((p) => /doesn't sell here/.test(p.objection)).reply, new RegExp(`^Then start with ${d.ask}\\.`));
  // a sample start never says "if it doesn't move"
  const s = talkPoints({ venue, profile: { brand: "Kvassly", what: "Craft kvass" }, isNA: false, deepOff: true }, FACTS);
  assert.match(s.pushback.find((p) => /sell here/.test(p.objection)).reply, /no order until your team has tasted it\.$/);
});

test("R9 proof finding 3: a blank 'What you make' talks neutral, sayable English: no 'want drink', no 'carry in drink'", () => {
  const { venue } = byName("The Lucky Duck");
  const t = talkPoints({ venue, profile: { brand: "Tidewell", what: "" }, isNA: false, deepOff: true }, FACTS);
  const all = lines(t).join("\n");
  assert.doesNotMatch(all, /want drink\b|in drink\b|is a drink\b|^Drink doesn't/m);
  assert.ok(t.questions.includes("What's on your drinks list right now, and what moves?"));
  assert.ok(t.pushback.some((p) => p.objection === "That won't sell here."));
  assert.ok(t.points.some((p) => p.text === "Tidewell: taste it before you decide anything."));
  assert.match(talkPoints({ venue: { name: "Nowhere" }, profile: { brand: "Tidewell", what: "" } }, []).opener, /^(Hi|Hey), I'm with Tidewell\. Who does your drinks list\? Mind if I grab their name and the best time to catch them\?$/);
});

test("D8: na-table-time (a vendor anecdote) is in at most ~1 in 3 NA outputs; facts rotate; text never rewritten", () => {
  let n = 0, hit = 0;
  const seen = new Set();
  ids.slice(0, 100).forEach((id, k) => {
    const t = talkPoints({ venue: R.venues[id], rank: k + 1, N: 100, drinkerName: "Athletic Brewing", city: "Austin", profile: TIDEWELL, isNA: true }, FACTS);
    n++;
    if (t.facts.includes("na-table-time")) hit++;
    t.facts.forEach((f) => seen.add(f));
    for (const p of t.points.filter((x) => x.fact)) assert.equal(p.text, FACTS.find((f) => f.id === p.fact).text);
  });
  assert.ok(hit / n <= 0.34, `${hit} of ${n}`);
  assert.ok(seen.size >= 4, [...seen].join());
  const rd = FACTS.filter((f) => /restaurantdive/.test(f.url));
  assert.equal(rd.length, 3);
  for (const f of rd) assert.match(f.source, /^Opinion piece by Sidework's CEO, Restaurant Dive/);
  assert.match(FACTS.find((f) => f.id === "bartender-rec-46").text, /consumers globally/);
});

test("Calacanis 2: the opener is something a rep says: no source claimed, at most two groups, weak lines → template", () => {
  assert.equal(crowdPhrase({ crowd: "The clientele consists of students, young professionals, families, and tourists." }).text, "your regulars are students and young professionals");
  assert.equal(crowdPhrase({ crowd: "The crowd is a diverse mix of locals and tourists." }), null);
  assert.equal(crowdPhrase({ crowd: "The customer base consists primarily of locals." }), null);
  for (const id of ids.slice(0, 100)) {
    const t = talkPoints({ venue: R.venues[id], profile: TIDEWELL, isNA: true }, FACTS);
    assert.doesNotMatch(t.opener, /listing|Qloo|Looks like|regulars/i, "Jard 10-24 #5: the opener never describes the room");
    const lead = t.opener.split(/(?<=\.)\s/)[0];
    if (/^Looks like/.test(lead)) assert.ok(lead.split(/\s+/).length <= 26, lead);
  }
});

test("Calacanis 3: timing from the venue's hours: first in the door within 30 min of opening, near close within the hour", () => {
  assert.match(arrivalAdvice(15 * 60 + 10, null, { from: 15 * 60, to: 23 * 60 }).text, /^You're first in the door: they open at 3 pm\./);
  assert.match(arrivalAdvice(21 * 60 + 10, "(512) 555-0100", { from: 15 * 60, to: 22 * 60 }).text, /within an hour of close \(they close at 10 pm\)/);
  assert.equal(arrivalAdvice(16 * 60, null, { from: 15 * 60, to: 23 * 60 }).kind, "lull");
  const { venue } = byName("Nomadic Beerworks"); // opens 11 am on Tuesdays
  const t = talkPoints({ venue, profile: TIDEWELL, isNA: true, eta: 11 * 60 + 5, day: "tuesday" }, FACTS);
  assert.equal(t.arrival, "opening");
  assert.match(t.before[1], /they open at 11 am/);
});

test("D7: two drinker brands = 'on Your list' (Jard 10-24), never 'Qloo ranks'", () => {
  const { venue } = byName("Nomadic Beerworks");
  const t = talkPoints({ venue, rank: 4, N: 80, drinkerName: "Athletic Brewing and Liquid Death", merged: true, city: "Austin", filterLabel: "bars and breweries", profile: TIDEWELL, isNA: true }, FACTS);
  assert.equal(at(t, "why"), "Why you're here: This door is #4 of 80 on Your list of Austin bars and breweries for Athletic Brewing and Liquid Death drinkers, built from Qloo's rankings.");
  assert.ok(![...t.before, ...t.points.map((p) => p.text)].some((x) => /Qloo ranks/.test(x)));
  const r = talkPoints({ venue, rank: 2, N: 50, drinkerName: "the regulars at Parson's Chicken & Fish", city: "Chicago", filterLabel: "bars", profile: TIDEWELL, isNA: true }, FACTS);
  assert.equal(at(r, "why"), "Why you're here: Qloo ranks this door #2 of 50 Chicago bars for people who drink like the regulars at Parson's Chicken & Fish.");
});

// live check B: an adjective list is one group, never cut to "a vibrant and young". Real crowd
// texts from the held routes and the live runs (scripts/dev/crowd-sweep.mjs sweeps all 3,511: none ends on a bare
// adjective)
test("crowdPhrase keeps an adjective list whole and still cuts a list of groups to two", async () => {
  const { crowdPhrase: cp } = await import("../public/lib/talk.js");
  const say = (crowd) => cp({ crowd })?.text ?? null;
  assert.equal(say("The restaurant attracts a vibrant, young, and trendy demographic, including local residents, office workers in River North, and hotel guests."), "you draw a vibrant, young and trendy demographic");
  assert.equal(say("The restaurant attracts a local, friendly, and gregarious crowd including regulars, wine and cocktail enthusiasts, and social groups looking for a welcoming environment."), "you draw a local, friendly and gregarious crowd");
  assert.equal(say("The typical customer at Bunny Slope consists of small groups seeking a unique, social, and experiential night out, particularly for celebrations and private gatherings in downtown Chicago."), "your regulars are small groups seeking a unique, social and experiential night out");
  assert.equal(say("The bar attracts a local crowd, particularly young adults and those seeking a lively atmosphere."), "you draw a local crowd, particularly young adults");
  assert.equal(say("The bar attracts a local crowd, particularly regulars who enjoy the friendly service."), "you draw a local crowd, particularly regulars");
  assert.equal(say("The customer base primarily consists of local craft beer enthusiasts, young professionals, and tourists looking for a relaxed atmosphere."), "your regulars are local craft beer enthusiasts and young professionals");
  // a list-level ", often/along with/with …" ends the group; an article + lone adjective at the end is no opener
  assert.equal(say("The restaurant attracts a mix of local residents and hotel guests, often drawing a younger crowd on weekends."), "you draw a mix of local residents and hotel guests");
  assert.equal(say("The bar attracts local families and repeat customers, fostering a welcoming atmosphere."), "you draw local families and repeat customers");
  assert.equal(say("The pub draws hotel guests staying at the Sable Hotel, along with tourists."), "you draw hotel guests staying at the Sable Hotel");
  assert.equal(say("The bar serves as a neighborhood pub, attracting families."), null);
  // never people by origin or religion; food is not people
  assert.equal(say("The restaurant serves the local Bangladeshi and South Asian community in Austin, attracting families."), null);
  assert.equal(say("The restaurant attracts a diverse clientele, primarily serving the local Jewish community."), null);
  assert.equal(say("The restaurant attracts locals who frequent the restaurant as a go-to spot for authentic Korean meals."), "you draw locals who frequent the restaurant as a go-to spot for authentic Korean meals");
  assert.equal(say("The customer base primarily consists of couples seeking a romantic date night atmosphere, groups of friends looking for a lively social environment with entertainment, and local residents who appreciate the nostalgic, old Hollywood aesthetic."), "your regulars are couples seeking a romantic date night atmosphere and groups of friends looking for a lively social environment with entertainment");
});

test("judge pass 3 (N11): a clause after the crowd is cut, never joined on with 'and'", () => {
  const say = (crowd) => crowdPhrase({ crowd })?.text ?? null;
  assert.equal(say("The bar primarily serves craft beer fans and young professionals, appealing to students and couples looking for a relaxed spot."), "you draw craft beer fans and young professionals");
  assert.match(say("The pub primarily serves Lincoln Park locals and Chicago singles, maintaining a reputation as a neighborhood staple."), /^you draw [lL]incoln Park locals and Chicago singles$/);
  for (const c of ["The restaurant attracts a local neighborhood crowd, primarily consisting of young adults and regulars who frequent it.", "The restaurant attracts a broad demographic, primarily serving local families, groups of friends, and couples."]) {
    const t = say(c);
    assert.ok(t == null || !/\band (?:\w+ly )?\w+ing\b/.test(t), t);
  }
  assert.equal(say("The bar attracts a younger crowd, primarily consisting of college students and young professionals."), "you draw a younger crowd of college students and young professionals");
});
