// R9 deep (lib/culture.js): each Qloo cultural signal changes one decision, and switched off gives the pre-R9 output.
// Pure: synthetic rooms, no public/data (the public suite runs it). Real-data swaps: test/culture-data.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { tagFamilies } from "../public/lib/core.js";
import { crowdTimes, crowdShare, todAdvice, leadFor, roomTagFacts, deepOn, setDeepOff, deepOffFromSearch, DEEP_KEYS } from "../public/lib/culture.js";
import { talkPoints, clockText } from "../public/lib/talk.js";

const T = (fam, name) => ({ id: `urn:tag:${fam}:qloo:${name.toLowerCase().replace(/\W+/g, "_")}`, name, type: `urn:tag:${fam}:qloo` });
const room = (over = {}, tags = {}) => ({ id: "r1", name: "Test Room", genre: "urn:tag:genre:place:bar", phone: "+15125550100", crowd: null, ...over, tags });
const NIGHT = { tod: ["Evening", "Late night"] };
const TEQ = { brand: "Agave Co", what: "Reposado tequila" };
const NA = { brand: "Tidewell", what: "Non-alcoholic hazy IPA" };

test("tagFamilies keeps the six decision families by name, capped, and drops who-the-crowd-is tags", () => {
  const t = tagFamilies([T("time_of_day_fit", "Evening"), T("beverage_offering", "Cocktails"), T("menu_highlight", "Wings"), T("customer_identity", "Locals"), T("age_range", "Young adults"), T("interests", "Mixology"), T("ambience", "Lively"), T("visit_intent", "Destination")]);
  assert.deepEqual(t, { tod: ["Evening"], bev: ["Cocktails"], menu: ["Wings"], interests: ["Mixology"], ambience: ["Lively"], visit: ["Destination"] });
  assert.equal(tagFamilies([T("customer_identity", "Locals")]), null);
  assert.equal(tagFamilies(undefined), null);
});

test("crowd times: busy all day (4+ times, or All day) is no signal", () => {
  assert.deepEqual(crowdTimes(room({}, NIGHT)), ["Evening", "Late night"]);
  assert.deepEqual(crowdTimes(room({}, { tod: ["Morning", "Midday", "Afternoon", "Evening"] })), []);
  assert.deepEqual(crowdTimes(room({}, { tod: ["All day", "Evening"] })), []);
  assert.equal(crowdShare(14 * 60, 17 * 60, ["Evening", "Late night"]), 0);
  assert.equal(crowdShare(17 * 60, 20 * 60, ["Evening", "Late night"]), 1);
  assert.ok(Math.abs(crowdShare(16 * 60, 18 * 60, ["Evening"]) - 0.5) < 0.05);
  assert.equal(crowdShare(22 * 60, 23 * 60, ["Late night"]), 1);
});

test("tod swap: a night bar at noon is 'ahead of its crowd' (clock said service); at 2:30 pm a lunch room is in its crowd (clock said lull)", () => {
  const night = talkPoints({ venue: room({}, NIGHT), profile: TEQ, eta: 12 * 60 }, []);
  assert.equal(night.arrival, "ahead");
  // no hours known: an evening-only room may still be shut at noon (personas, final round: WYLD Bar)
  assert.match(night.before[1], /^Qloo puts this door's crowd in the evening and late night: getting there around noon, it may not be open yet\. Call first: \(512\) 555-0100, or come right when it opens\.$/);
  // its own hours say it's open at noon: ahead of its crowd, a good time
  const OPEN = { tuesday: [{ opens: "T11:00:00", closed: false, closes: "T23:00:00" }] };
  const openNight = talkPoints({ venue: room({ hours: OPEN }, NIGHT), profile: TEQ, eta: 12 * 60 + 30, day: "tuesday" }, []);
  assert.match(openNight.before[1], /getting there around 12:30 pm, you're ahead of it, a good time to catch a manager\.$/);
  assert.equal(night.deep.tod.replaced, "service");
  assert.deepEqual(night.deep.tod.src, { kind: "qloo", field: "tag:time_of_day_fit", tags: ["Evening", "Late night"] });
  const lunch = talkPoints({ venue: room({}, { tod: ["Midday", "Afternoon"] }), profile: TEQ, eta: 14 * 60 + 30 }, []);
  assert.equal(lunch.arrival, "in-crowd");
  assert.match(lunch.before[1], /you may walk into it\. Keep it to five minutes, or call first: \(512\) 555-0100\.$/);
  // ablation: off = the clock's line, byte for byte
  for (const [v, eta] of [[room({}, NIGHT), 12 * 60], [room({}, { tod: ["Midday", "Afternoon"] }), 870]]) {
    const off = talkPoints({ venue: v, profile: TEQ, eta, deepOff: ["tod"] }, []);
    const bare = talkPoints({ venue: { ...v, tags: null }, profile: TEQ, eta }, []);
    assert.deepEqual({ ...off, deep: null }, { ...bare, deep: null });
    assert.notEqual(off.before[1], talkPoints({ venue: v, profile: TEQ, eta }, []).before[1]);
  }
});

test("tod agrees with the clock → the clock's line stays (decide, don't decorate); the room's own hours always win", () => {
  const t = talkPoints({ venue: room({}, NIGHT), profile: TEQ, eta: 19 * 60 }, []);
  assert.equal(t.arrival, "service");
  assert.equal(t.deep.tod, null);
  const OPEN = { tuesday: [{ opens: "T11:00:00", closed: false, closes: "T23:00:00" }] };
  const lull = talkPoints({ venue: room({ hours: OPEN }, NIGHT), profile: TEQ, eta: 15 * 60, day: "tuesday" }, []);
  assert.equal(lull.arrival, "lull", "open by its own hours: the clock's line stays");
  assert.equal(talkPoints({ venue: room({}, NIGHT), profile: TEQ, eta: 15 * 60 }, []).deep.tod.closedRisk, true, "no hours: may not be open yet");
  const wait = talkPoints({ venue: room({}, NIGHT), profile: TEQ, eta: 12 * 60, wait: 10 }, []);
  assert.equal(wait.arrival, "wait");
  assert.equal(todAdvice(room({}, {}), 600, clockText), null);
});

test("lead swap: the room's drinks and menu tags pick the angle (the line for the buyer, the rep's prep) and the ask; the rep's own ask wins", () => {
  const at = (t, k) => t.before[t.beforeKinds.indexOf(k)];
  const cocktails = room({}, { bev: ["Specialty cocktails", "Beer"] });
  const beerOnly = room({}, { bev: ["Beer", "Wine"] });
  const wings = room({ genre: "urn:tag:genre:place:restaurant:sports_bar" }, { bev: ["Beer"], menu: ["Fried pickles", "Buffalo wings"] });
  const a = talkPoints({ venue: cocktails, profile: TEQ }, []);
  assert.equal(a.toBuyer, "Can I pour you one neat? Then we can talk about where it'd fit.");
  assert.match(at(a, "angle"), /^Your angle: Qloo tags this room for specialty cocktails: talk to whoever builds the menu/);
  assert.equal(a.ask, "one bottle for a cocktail on the menu");
  assert.equal(a.deep.lead.src[0].field, "tag:beverage_offering");
  // a named house cocktail on the menu: the pitch is that drink, made with yours (the bartender makes it)
  const marg = talkPoints({ venue: room({}, { bev: ["Cocktails"], menu: ["Margarita", "Wings"] }), profile: TEQ }, []);
  assert.equal(marg.toBuyer, "Could your bartender make me your margarita with an ounce of this, so we can taste it next to the house one?");
  assert.match(at(marg, "angle"), /Check the menu: if the margarita is still on it/, "Qloo's menu can be stale: the rep checks");
  assert.equal(marg.angle.mail, "I'd love to taste it in your margarita, next to the house one.");
  // gate: Qloo lists beer and wine only → ask before pitching a bottle; the ask becomes a sample
  const b = talkPoints({ venue: beerOnly, profile: TEQ }, []);
  assert.equal(b.questions[0], "Do you serve spirits, or only beer and wine?");
  assert.equal(b.ask, "a sample for the team, if it fits your drinks list");
  // a dish the room is known for is what the rep orders, never a question to the buyer
  const c = talkPoints({ venue: wings, profile: NA, isNA: true }, []);
  assert.match(at(c, "order"), /If you're hungry, the buffalo wings are what they're known for\.$/);
  assert.doesNotMatch(`${c.opener} ${c.toBuyer}`, /wings/);
  assert.ok(c.angle.src.some((x) => x.field === "tag:menu_highlight" && x.tags[0] === "Buffalo wings"));
  // NA next to a room's own non-alcoholic shelf: next to it, not blind
  const lane = talkPoints({ venue: room({}, { bev: ["Specialty non alcoholic", "Beer"] }), profile: NA, isNA: true }, []);
  assert.equal(lane.angle.key, "na-lane");
  assert.match(lane.toBuyer, /next to what you've got\?$/);
  // stated beats Qloo: the profile's ask stands
  assert.equal(talkPoints({ venue: cocktails, profile: { ...TEQ, ask: "two bottles on consignment" } }, []).ask, "two bottles on consignment");
  // ablation: off = the template
  for (const [v, p, na] of [[cocktails, TEQ, false], [beerOnly, TEQ, false], [wings, NA, true]]) {
    const off = talkPoints({ venue: v, profile: p, isNA: na, deepOff: ["lead"] }, []);
    const bare = talkPoints({ venue: { ...v, tags: null }, profile: p, isNA: na }, []);
    assert.deepEqual({ ...off, deep: null }, { ...bare, deep: null });
  }
});

test("angle: the crowd text picks the story when the tags don't (the proof's crowd slot), never said out loud", () => {
  // proof re-judge 10-24: "families" in the crowd text no longer picks the family angle; Qloo's own tag does
  assert.equal(talkPoints({ venue: room({ crowd: "The customer base consists of local families and dog owners." }, {}), profile: NA, isNA: true }, []).angle.key, "na");
  const fam = talkPoints({ venue: room({}, { ambience: ["Family friendly"] }), profile: NA, isNA: true }, []);
  assert.equal(fam.angle.key, "na-driver");
  assert.match(fam.angle.why, /^Qloo's tags for this room include family friendly/);
  assert.doesNotMatch(`${fam.opener} ${fam.toBuyer}`, /families|regulars|crowd/i);
  const work = talkPoints({ venue: room({ crowd: "The clientele includes students and remote workers with laptops." }, {}), profile: NA, isNA: true, eta: 12 * 60 + 15 }, []);
  assert.equal(work.angle.key, "na-daytime");
  // judge pass 12 #3: the lunch angle only before ~2:30 pm; a 3:30 pm visit (or no time) falls through to the next angle
  for (const eta of [15 * 60 + 30, "14:30", null]) {
    const late = talkPoints({ venue: room({ crowd: "The clientele includes students and remote workers with laptops." }, { interests: ["Coffee culture"] }), profile: NA, isNA: true, eta }, []);
    assert.equal(late.angle.key, "na", `eta ${eta}`);
    assert.doesNotMatch(`${late.toBuyer} ${late.angle.why}`, /lunch|coffee/i);
  }
  assert.equal(talkPoints({ venue: room({}, { interests: ["Coffee culture"] }), profile: NA, isNA: true, eta: "14:29" }, []).angle.key, "na-daytime");
  const none = talkPoints({ venue: room({ crowd: "A diverse mix of locals and tourists." }, {}), profile: NA, isNA: true }, []);
  assert.equal(none.angle.key, "na");
  // "Board games" is not a sports room (fresh-output review: a cocktail bar with board games)
  const cider = { brand: "Hollow Oak", what: "Dry craft cider" };
  assert.notEqual(talkPoints({ venue: room({}, { interests: ["Board games", "Craft cocktails"] }), profile: cider }, []).angle.key, "game");
  assert.equal(talkPoints({ venue: room({ crowd: "The bar attracts sports fans on game days." }, {}), profile: cider }, []).angle.key, "game");
  // a crowd swap (remote workers) changes the angle: the crowd text can still decide it
  assert.notEqual(work.toBuyer, none.toBuyer);
});

test("R9 proof finding 5: a 'Non alcoholic only' tag the room contradicts asks no 'any alcohol at all?' gate", () => {
  // Armitage Alehouse: "Non alcoholic only" next to Full bar, Spirits, Beer → the tag is dropped, the cocktail lead runs
  const armitage = room({ name: "Armitage Alehouse", genre: "urn:tag:genre:place:restaurant:british" }, { bev: ["Non alcoholic only", "Specialty cocktails", "Cocktails", "Beer", "Spirits", "Wine", "Full bar"] });
  const a = talkPoints({ venue: armitage, profile: TEQ }, []);
  assert.ok(!a.questions.some((q) => /any alcohol/.test(q)));
  assert.equal(a.deep.lead.gate, undefined);
  assert.equal(a.toBuyer, "Can I pour you one neat? Then we can talk about where it'd fit.");
  assert.match(a.angle.why, /specialty cocktails/);
  // only the tag, but the room's name or genre says it pours → no gate at all (nothing trustworthy to gate on)
  for (const v of [room({ name: "Armitage Alehouse" }, { bev: ["Non alcoholic only"] }), room({ name: "Corner", genre: "urn:tag:genre:place:bar:pub" }, { bev: ["Non alcoholic only"] })]) {
    assert.equal(leadFor(v, { kind: "spirit" }), null, v.name);
  }
  // a room that is plausibly NA only (a café, nothing else poured) still gets the gate
  const cafe = room({ name: "Sprout Juice Café", genre: "urn:tag:genre:place:cafe" }, { bev: ["Non alcoholic only", "Coffee and tea"] });
  assert.equal(leadFor(cafe, { kind: "spirit" }).gate, "Do you serve any alcohol at all, or is it all non-alcoholic here?");
  // the spirits gate names beer and wine only when the tags say the room pours them
  assert.equal(leadFor(room({}, { bev: ["Coffee and tea"] }), { kind: "spirit" }).gate, "Do you serve spirits here?");
  assert.equal(leadFor(room({}, { bev: ["Beer", "Wine"] }), { kind: "spirit" }).gate, "Do you serve spirits, or only beer and wine?");
});

test("lead never frames a soft drink as an alcohol alternative, and a room with no drinks tags leads nothing", () => {
  const soft = talkPoints({ venue: room({}, { bev: ["Specialty non alcoholic", "Cocktails"] }), profile: { brand: "Fizz", what: "Sparkling water" }, isNA: true }, []);
  assert.doesNotMatch(`${soft.opener} ${soft.toBuyer} ${soft.angle.why}`, /isn't drinking|non-alcoholic|isn't alcohol/);
  assert.equal(leadFor(room({}, { ambience: ["Lively"] }), { kind: "beer" }), null);
  assert.equal(leadFor(room({}, {}), { kind: "spirit" }), null);
});

test("room tags as sourced facts: Qloo's names, labelled, never a who-the-crowd-is family", () => {
  const f = roomTagFacts(room({}, { bev: ["Beer", "Cocktails"], menu: ["Wings"], tod: ["Evening"], visit: ["Destination"] }), { captured: "2026-10-08" });
  assert.deepEqual(f.map((x) => x.text), ["Drinks: Beer and cocktails.", "Known for: Wings.", "Crowd times: Evening.", "How people use it: A destination."]); // intuit pass 2 (M9): capitalized after the label, like the others
  assert.ok(f.every((x) => x.source.kind === "qloo" && x.source.field.startsWith("tag:") && x.source.captured === "2026-10-08" && x.source.door === "r1"));
});

test("switches: deepOn per call, the page-wide list, the URL", () => {
  assert.equal(deepOn("tod"), true);
  assert.equal(deepOn("tod", ["tod"]), false);
  assert.equal(deepOn("lead", true), false);
  setDeepOff("tod,hooks");
  assert.equal(deepOn("tod"), false);
  assert.equal(deepOn("lead"), true);
  setDeepOff([]);
  assert.deepEqual(deepOffFromSearch("?deep=off"), DEEP_KEYS);
  assert.deepEqual(deepOffFromSearch("?deepOff=lead,nope"), ["lead"]);
});

// ---------- hooks ----------
import { distinctItems, hookFor, brandKind } from "../public/lib/culture.js";
const I = (name, ...tags) => ({ name, tags });
const HOOKS = {
  brands: {
    "agave-a": { name: "Agave A", category: "Tequila", captured: "2026-10-22", lists: { podcast: [I("Shared Pod", "Sports"), I("Golf Talk", "Golf", "Sports"), I("Everyone Pod", "Comedy")], tv_show: [I("Cartel Drama", "Crime")] } },
    "agave-b": { name: "Agave B", category: "Tequila", lists: { podcast: [I("Shared Pod", "Sports"), I("Everyone Pod", "Comedy")], tv_show: [I("Cartel Drama", "Crime")] } },
    "fizz": { name: "Fizz", category: "Hard seltzer", lists: { podcast: [I("Everyone Pod", "Comedy"), I("Dating Pod", "Reality")] } },
  },
};
test("hooks: an item a same-category brand or 3+ brands share is not this brand's; the rest stay in Qloo's order", () => {
  const d = distinctItems("agave-a", HOOKS.brands);
  assert.deepEqual(d.podcast.map((x) => x.name), ["Golf Talk"]);
  assert.deepEqual(d.tv_show, []);
  assert.deepEqual(distinctItems("fizz", HOOKS.brands).podcast.map((x) => x.name), ["Dating Pod"]);
  assert.equal(brandKind({ category: "Tequila" }), "spirit");
  assert.equal(brandKind({ name: "Truly Hard Seltzer", category: "Wine and spirits" }), "seltzer");
});
test("hooks: used only where the room's own tags meet the item's genre; labelled 'People who drink <brand> also like'; none otherwise", () => {
  const sports = room({ genre: "urn:tag:genre:place:restaurant:sports_bar" }, { interests: ["Sports viewing"] });
  const h = hookFor(sports, [{ key: "agave-a", name: "Agave A" }], HOOKS);
  assert.equal(h.text, "People who drink Agave A also like the podcast Golf Talk. Bring it up if sports comes up.");
  assert.deepEqual(h.src, { kind: "qloo", field: "hook:podcast", tags: ["Golf Talk"], brand: "Agave A", room: "Sports viewing", captured: "2026-10-22" });
  assert.equal(hookFor(room({}, { interests: ["Wine appreciation"] }), [{ key: "agave-a", name: "Agave A" }], HOOKS), null);
  assert.equal(hookFor(sports, [{ key: "unknown", name: "X" }], HOOKS), null);
  assert.equal(hookFor(sports, [{ key: "agave-a", name: "Agave A" }], null), null);
});

// ---------- heat ----------
import { heatHoods, hoodOf, heatFor } from "../public/lib/culture.js";
test("heat: admin rows (country, county, state, the city) dropped; hoods in Qloo's order; a door's hood by name, else nearest within 1.5 km", () => {
  const body = { results: { entities: [
    { name: "United States of America", disambiguation: "United States of America", boundary: "MULTIPOLYGON (((-180 51, -179 51)))" },
    { name: "Testville", disambiguation: "Testville, Some County, Texas, United States of America", boundary: "POLYGON ((-97.9 30.3, -97.7 30.3))" },
    { name: "Some County", disambiguation: "Some County, Texas, United States of America", boundary: "POLYGON ((-98 30, -97 30))" },
    { name: "Old Town", disambiguation: "Old Town, Testville, Some County, Texas, United States of America", boundary: "POINT (-97.74 30.27)" },
    { name: "Far Suburb", disambiguation: "Far Suburb, Elsewhere, Some County, Texas, United States of America", boundary: "POINT (-98.9 31.4)" },
    { name: "Riverside", disambiguation: "Riverside, Testville, Some County, Texas, United States of America", boundary: "POLYGON ((-97.72 30.25, -97.70 30.25, -97.70 30.23, -97.72 30.23))" },
  ] } };
  const hoods = heatHoods(body, { name: "Testville", center: [30.27, -97.74] });
  assert.deepEqual(hoods.map((h) => h.name), ["Old Town", "Riverside"]);
  assert.deepEqual(hoodOf({ neighborhood: "Riverside", lat: 0, lon: 0 }, hoods), { name: "Riverside", rank: 2, of: 2 });
  assert.equal(hoodOf({ neighborhood: null, lat: 30.271, lon: -97.741 }, hoods).name, "Old Town");
  assert.equal(hoodOf({ neighborhood: null, lat: 31, lon: -97 }, hoods), null);
  assert.deepEqual(heatFor({ runs: { "b|testville": { hoods } } }, [{ drinker: { key: "b" }, city: { key: "testville" } }]), hoods);
});

// ---------- prewarmed / live runs: route.culture (scripts/deep-prewarm.mjs, src/worker.js runRoute 6b) ----------
import { hooksWith } from "../public/lib/culture.js";
test("a run that carries route.culture: its heat and hooks are read like the held files'; the held file wins for a held brand", () => {
  const hoods = [{ name: "Old Town", lat: 30.27, lon: -97.74 }];
  const r = { drinker: { key: "newbrand", name: "New Brand" }, city: { key: "x" }, culture: { captured: "2026-10-22", heat: hoods, hooks: { name: "New Brand", lists: { podcast: [I("Golf Talk", "Golf")] } } } };
  assert.deepEqual(heatFor(null, [r]), hoods);
  const pool = hooksWith(HOOKS, [r]);
  assert.ok(pool.brands.newbrand && pool.brands["agave-a"]);
  const h = hookFor(room({}, { interests: ["Sports viewing"] }), [{ key: "newbrand", name: "New Brand" }], pool);
  assert.match(h.text, /^People who drink New Brand also like the podcast Golf Talk\. Bring it up/);
  assert.equal(hooksWith(HOOKS, [{ ...r, drinker: { key: "agave-a" } }]).brands["agave-a"], HOOKS.brands["agave-a"]);
});

// live check I: "a new small-batch irish-style whiskey" — the rep's own capitals stay in the lead question
test("the lead question keeps a proper adjective's capital and lowers a plain first word", async () => {
  const { lowerFirst } = await import("../public/lib/culture.js");
  assert.deepEqual(["Small-batch Irish-style whiskey", "Irish whiskey", "Kentucky bourbon", "New small-batch gin", "New England IPA", "IPA"].map(lowerFirst), ["small-batch Irish-style whiskey", "Irish whiskey", "Kentucky bourbon", "new small-batch gin", "New England IPA", "IPA"]);
});
