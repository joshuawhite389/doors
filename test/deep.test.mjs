// Round 3, lane deep: the per-door market-research layer (public/lib/deep.js), on synthetic records. No data, no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { deepFacts, deepFactsFor, deepLines, deepText, repCategory, siteCarries, siteNames, crowdBuys, listRank, nearDoors, venueMap, weekShape, parseWhen, quietWindow, DEEP_MAX } from "../public/lib/deep.js";
import { deepForAgent, agentContext } from "../public/lib/agent-context.js";

const span = (opens, closes) => [{ opens: `T${opens}:00`, closed: false, closes: `T${closes}:00` }];
const HOURS = { monday: span("11:00", "22:00"), tuesday: span("11:00", "22:00"), wednesday: span("11:00", "22:00"), thursday: span("11:00", "22:00"), friday: span("11:00", "23:00"), saturday: span("11:00", "23:00"), sunday: span("11:00", "22:00") };
const site = (url, facts) => ({ url, fetched: "2026-10-25", ok: true, facts: facts.map(([k, text]) => ({ k, text, quote: text.slice(0, 20), from: url })) });
// a brewpub Qloo won't read as a signal (area basis), its site: brews its own, a root beer float, a happy hour
const PIN = { v: 1, id: "P", name: "Pint Brewing", at: "2026-10-25", qloo: { basis: "area", brands: [], drinks: [{ name: "Athletic Brewing Co", cat: "non-alcoholic" }, { name: "Shiner Beer", cat: "beer" }], ages: null, gender: null, tags: { music: [], dishes: [], keywords: [], hobbies: [], tone: [] }, calls: 2 }, vsCity: { doors: 10, drinks: [], cats: [], brands: [], ages: [], gender: null, tags: {} }, site: site("https://pint.example/", [["brews_own", "Brews its own beer in house."], ["house_drinks", "Flagship beers on tap include Jelly Hazy IPA and Magic Pils."], ["non_alcoholic", "Root beer float made with Maine Root root beer is on the pizza menu."], ["happy_hour", "Happy hour Mon-Fri 3pm-6pm: $5 pints, $7 glasses of wine."], ["events", "Trivia night every Tuesday at 7pm."], ["space", "Plenty of TVs and a covered patio."]]) };
// a door Qloo reads: its crowd leans whiskey and beer, older than the city; its site lists a non-alcoholic beer
const SAGE = { v: 1, id: "S", name: "Sage Hall", at: "2026-10-25", qloo: { basis: "door", brands: [], drinks: [{ name: "Pendleton Whisky", cat: "whiskey" }, { name: "Coors Banquet", cat: "beer" }, { name: "Best Day Brewing", cat: "non-alcoholic" }, { name: "Camarena Tequila", cat: "tequila" }], ages: { "55_and_older": 0.48 }, gender: { male: -0.06, female: 0.06 }, tags: { music: ["country"], dishes: [], keywords: [], hobbies: [], tone: [] }, calls: 4 }, vsCity: { doors: 10, drinks: [{ name: "Camarena Tequila", cat: "tequila", lift: 37.4 }], cats: [{ cat: "whiskey", n: 11, lift: 4.93 }, { cat: "beer", n: 7, lift: 2.97 }], brands: [], ages: [{ band: "55_and_older", skew: 0.48, median: 0.04, diff: 0.44 }], gender: null, tags: {} }, site: site("http://sage.example/", [["what", "Live music venue and bar with two-step dancing."], ["drinks", "Says it has a large local draft beer selection and cocktails."], ["non_alcoholic", "Lists Rationale NA Beer (Mexican lager) and Breather Hop Water."], ["events", "Two-step lessons on Sundays and Tuesdays; line dance lessons Mondays from 7pm to 11pm."], ["other", "Open 3pm to 2am most days; Monday hours are 6pm to 2am."]]) };
const NOSITE = { v: 1, id: "N", name: "No Site Tavern", at: "2026-10-25", qloo: { basis: "door", brands: [], drinks: [{ name: "Best Day Brewing", cat: "non-alcoholic" }], ages: null, gender: null, tags: { music: [], dishes: [], keywords: [], hobbies: [], tone: [] }, calls: 4 }, vsCity: { doors: 10, drinks: [], cats: [{ cat: "non-alcoholic", n: 3, lift: 2.1 }], brands: [], ages: [], gender: null, tags: {} }, site: null };
const EMPTY = { v: 1, id: "E", name: "Empty", at: null, qloo: { basis: "none", brands: [], drinks: [], ages: null, gender: null, tags: {}, calls: 0 }, vsCity: null, site: null };
const VENUES = { P: { id: "P", name: "Pint Brewing", lat: 30.2, lon: -97.74, hours: HOURS, tags: { tod: ["Afternoon", "Evening"], visit: ["Destination", "Routine visit"] }, popularity: 0.88 }, S: { id: "S", name: "Sage Hall", lat: 30.205, lon: -97.742, hours: { monday: span("18:00", "02:00"), tuesday: span("15:00", "02:00"), wednesday: span("15:00", "02:00"), thursday: span("15:00", "02:00"), friday: span("15:00", "02:00"), saturday: span("15:00", "02:00"), sunday: span("15:00", "02:00") }, tags: { tod: ["Afternoon", "Evening", "Late night"], visit: ["Destination"] }, popularity: 0.7 }, N: { id: "N", name: "No Site Tavern", lat: 30.3, lon: -97.8, hours: HOURS, tags: { tod: ["Evening"] } }, E: { id: "E", name: "Empty", lat: 30.204, lon: -97.745, hours: HOURS, tags: {} } };
const ROUTE = { drinker: { key: "athletic-brewing", name: "Athletic Brewing", category: "Non-alcoholic craft beer", na: true }, lists: { all: [["N", 0.93], ["P", 0.9], ["S", 0.8], ["E", 0.5]] }, venues: VENUES };
const CITY = { sisters: { P: [["S", 0.96], ["N", 0.9]], S: [["P", 0.96]] }, sisterVenues: {} };
const PROFILE = { brand: "Tidewell", what: "Non-alcoholic hazy IPA", drinks: [{ key: "athletic-brewing", name: "Athletic Brewing" }] };
const RECS = { P: PIN, S: SAGE, N: NOSITE, E: EMPTY };
const ctx = (extra = {}) => ({ plan: { venues: VENUES, profile: PROFILE }, routes: [ROUTE], city: CITY, enrich: RECS, profile: PROFILE, ...extra });

test("repCategory: the rep's category from what they make and the drinker's category; a soft drink is not the non-alcoholic option", () => {
  assert.equal(repCategory({ profile: PROFILE, routes: [ROUTE] }).cat, "non-alcoholic");
  assert.equal(repCategory({ profile: PROFILE, routes: [ROUTE] }).words, "a non-alcoholic beer");
  assert.equal(repCategory({ profile: { what: "Blanco tequila" } }).cat, "tequila");
  assert.equal(repCategory({ profile: { what: "Hard seltzer" } }).cat, "RTD");
  assert.equal(repCategory({ profile: { what: "Sparkling water" } }).cat, "soft");
  assert.equal(repCategory({ profile: { what: "Sparkling water" } }).words, "a sparkling water");
  assert.equal(repCategory({ profile: { what: "Non-alcoholic gin" } }).words, "a non-alcoholic spirit");
  assert.equal(repCategory({ profile: { what: "Rye whiskey" } }).cat, "whiskey");
  assert.equal(repCategory({ profile: { what: "Dry cider" } }).cat, "cider");
  assert.deepEqual(repCategory({ profile: { what: "West coast IPA" } }).cats, ["craft beer", "beer"]);
  assert.equal(repCategory({}).cat, null);
});

test("siteCarries: the words decide, with word boundaries (Al's is not in 'deals'); a root beer float is near the category, not in it", () => {
  const pin = siteCarries(PIN, "non-alcoholic");
  assert.equal(pin.carries.length, 0);
  assert.equal(pin.near.length, 1, "the root beer float sits under non_alcoholic but is no non-alcoholic beer");
  assert.equal(pin.read, "2026-10-25");
  const sage = siteCarries(SAGE, "non-alcoholic");
  assert.equal(sage.carries.length, 1);
  assert.deepEqual(sage.carries[0].brands, ["Rationale"]);
  assert.equal(siteCarries({ site: { ok: true, facts: [{ k: "happy_hour", text: "Great deals on meals for locals." }] } }, "non-alcoholic").carries.length, 0);
  assert.equal(siteCarries(SAGE, "tequila").carries.length, 0, "cocktails are not tequila");
  assert.equal(siteCarries(PIN, "craft beer").carries.length >= 2, true);
  assert.equal(siteCarries({ site: { ok: true, facts: [{ k: "non_alcoholic", text: "Rambler sparkling water and iced tea." }] } }, "soft", repCategory({ profile: { what: "Sparkling water" } })).carries.length, 1);
  assert.equal(siteCarries({ site: { ok: true, facts: [{ k: "non_alcoholic", text: "Root beer floats and iced tea." }] } }, "soft", repCategory({ profile: { what: "Sparkling water" } })).carries.length, 0, "a root beer is not a sparkling water");
  assert.deepEqual(siteNames(SAGE, ["Rationale", "Tidewell"]).map((h) => h.brand), ["Rationale"]);
});

test("crowdBuys / listRank: the crowd side in the rep's category, strongest from vsCity's categories; the rep's own brand in the list; area basis is its part of town", () => {
  const rc = repCategory({ profile: PROFILE, routes: [ROUTE] });
  assert.equal(crowdBuys(NOSITE, rc).strength, 3);
  assert.equal(crowdBuys(PIN, rc).strength, 1);
  assert.equal(crowdBuys(PIN, rc).basis, "area");
  assert.deepEqual(crowdBuys(PIN, rc).own, ["Athletic Brewing Co"]);
  assert.equal(crowdBuys(SAGE, rc).strength, 1);
  assert.equal(crowdBuys(SAGE, repCategory({ profile: { what: "Tequila" } })).strength, 2, "a rare tequila brand in its list");
  assert.equal(crowdBuys(EMPTY, rc).strength, 0);
  assert.deepEqual(listRank([ROUTE], "P"), { who: "Athletic Brewing drinkers", rank: 2, N: 4 });
  assert.deepEqual(listRank([ROUTE], "P", { pool: { ids: ["N", "P"], N: 55 } }), { who: "Athletic Brewing drinkers", rank: 2, N: 55 }, "the plan's pool is the list the rep sees: its real size");
  assert.equal(listRank([ROUTE], "S", { pool: { ids: ["N", "P"], N: 55 } }).rank, 3, "a door off the pool falls back to the route's list");
  assert.equal(listRank([ROUTE], "Z"), null);
});

test("nearDoors / venueMap: sisters first, then within 1 km, only doors with a record; a baked near map wins", () => {
  const venues = venueMap({ plan: { venues: VENUES }, routes: [ROUTE], city: CITY });
  assert.equal(Object.keys(venues).length, 4);
  const n = nearDoors("P", { enrich: RECS, venues, city: CITY });
  assert.deepEqual(n.map((r) => r[0]), ["S", "N", "E"], "S and N share the crowd (N is far), E is within 1 km");
  assert.equal(n[0][2], 1);
  assert.equal(n[2][2], 0);
  assert.ok(n[2][1] < 1);
  assert.deepEqual(nearDoors("P", { enrich: RECS, venues, city: CITY, near: { P: [["S", 0.6, 1], ["X", 0.1, 0]] } }), [["S", 0.6, 1]], "a baked row for a door with no record is dropped");
});

test("weekShape / parseWhen / quietWindow: the week in words, a happy hour's days and hours, the quiet stretch before Qloo's crowd", () => {
  const w = weekShape(HOURS);
  assert.equal(w.text, "opens 11 am every day it's open");
  assert.equal(weekShape({ ...HOURS, monday: [{ closed: true }], friday: span("11:00", "02:00"), saturday: span("11:00", "02:00") }).text, "closed Mon; opens 11 am every day it's open; open past midnight Fri and Sat");
  assert.equal(weekShape(VENUES.S.hours).weekdayOpen, 15 * 60, "the most common weekday opening, not the mean");
  assert.equal(weekShape(VENUES.S.hours).text, "opens 3 pm Tue–Sun, opens 6 pm Mon; open past midnight Mon–Sun".replace("; open past midnight Mon–Sun", ""));
  assert.equal(weekShape(null).ok, false);
  assert.deepEqual(parseWhen("Happy hour Mon-Fri 3pm-6pm: $5 pints"), { days: ["monday", "tuesday", "wednesday", "thursday", "friday"], from: 15 * 60, to: 18 * 60, text: "Mon–Fri 3 pm–6 pm" });
  assert.equal(parseWhen("Two-step lessons on Sundays and Tuesdays").text, "Tue and Sun");
  assert.equal(parseWhen("Line dance lessons Mondays from 7pm to 11pm").text, "Mon 7 pm–11 pm");
  assert.equal(parseWhen("Happy hour 3-6 daily").text, "Mon–Sun 3 pm–6 pm");
  assert.equal(parseWhen("Great food"), null);
  const q = quietWindow(VENUES.P);
  assert.equal(q.text, "weekdays 11 am–2 pm");
  assert.equal(quietWindow(VENUES.S).text, null, "opens 3 pm into an afternoon crowd: no quiet stretch");
  assert.equal(quietWindow({ hours: HOURS, tags: { tod: ["Morning", "Midday", "Afternoon", "Evening"] } }), null, "4+ day parts: no signal");
});

test("deepFacts: the gap leads for a brewpub whose only non-alcoholic listing is a root beer float; every line names its fields; the so-what is there", () => {
  const f = deepFacts(PIN, ctx({ id: "P", venue: VENUES.P }));
  assert.ok(f.length >= 3 && f.length <= DEEP_MAX);
  assert.equal(f[0].kind, "gap");
  assert.equal(f[0].score, 100, "rank 2 of 4 on the rep's list counts as the crowd side");
  assert.match(f[0].text, /ranks its crowd 2 of 4 on your list/);
  assert.match(f[0].text, /only non-alcoholic item it lists is a root beer float/);
  assert.match(f[0].text, /brews its own beer \(its site\), so a non-alcoholic beer is the one beer it can't make itself/);
  assert.match(f[0].text, /ask what the guest who isn't drinking gets handed now/, "absence on a site is a question, never a claim");
  assert.equal(f[0].from, "https://pint.example/");
  assert.ok(f[0].src.includes("site.facts[brews_own]") && f[0].src.includes("routes.lists.all"));
  assert.ok(!f[0].prep, "the gap names no brand Qloo gave and no other door, so it may feed a spoken question");
  assert.ok(f.every((x) => typeof x.why === "string" && x.why.length > 20), "every line answers so what");
  assert.ok(f.every((x) => Array.isArray(x.src) && x.src.length), "every line is traceable to fields");
  assert.ok(f.every((x) => !/\b0\.\d\d\b/.test(x.text)), "no Qloo decimals in a line");
  const nb = f.find((x) => x.kind === "neighbours");
  assert.ok(nb, "the same-crowd door's site lists a non-alcoholic beer");
  assert.match(nb.text, /Sage Hall \(same crowd, nearby: Rationale\)/);
  assert.match(nb.text, /this one's site \(read 2026-10-25\) lists none/);
  assert.equal(nb.prep, true, "names another door: for the rep's eyes");
  const b = f.find((x) => x.kind === "business");
  assert.match(b.text, /likely quiet window is weekdays 11 am–2 pm/);
  assert.match(b.text, /happy hour Mon–Fri 3 pm–6 pm/);
  assert.match(b.why, /arrive in the quiet window, before it starts/);
  assert.equal(b.from, "https://pint.example/");
  const ev = f.find((x) => x.label === "Nights the owner programs");
  assert.match(ev.text, /Tue 7 pm: Trivia night/);
  assert.ok(f.every((x) => x.text.length <= 500));
});

test("deepFacts: a door that already lists the category, with a whiskey crowd (the occasion line is prep); another category sees the headwind", () => {
  const f = deepFacts(SAGE, ctx({ id: "S", venue: VENUES.S }));
  const gap = f.find((x) => x.kind === "gap");
  assert.equal(gap.label, "Already carries the category");
  assert.match(gap.text, /already lists a non-alcoholic beer: Rationale/);
  assert.match(gap.why, /the second non-alcoholic line or the style Rationale doesn't cover/);
  const occ = f.find((x) => x.kind === "occasion");
  assert.equal(occ.prep, true);
  assert.match(occ.text, /More 55 and over than the city's bars \(Qloo\); Qloo tags it a destination/);
  assert.match(occ.why, /never tell the buyer who their crowd is/);
  const wk = f.find((x) => x.label === "The owner's week");
  assert.match(wk.text, /opens 6 pm Mon/);
  assert.match(wk.text, /no quiet stretch after opening/);
  assert.ok(!f.some((x) => x.kind === "headwind"), "non-alcoholic sits in its list: no headwind");
  // a hard seltzer rep at the same door: nothing in its list points at seltzers, the crowd leans whiskey
  const g = deepFacts(SAGE, ctx({ id: "S", venue: VENUES.S, profile: { what: "Hard seltzer", brand: "Fizz" }, plan: { venues: VENUES, profile: { what: "Hard seltzer", brand: "Fizz" } }, routes: [{ ...ROUTE, drinker: { name: "White Claw", category: "Hard seltzer" } }] }));
  const hw = g.find((x) => x.kind === "headwind");
  assert.match(hw.text, /whiskey and beer crowd \(whiskey 4\.9×, beer 3× the city's bars\)/);
  assert.match(hw.why, /Don't lead with taste here/);
  assert.ok(!g.some((x) => x.label === "Already carries the category"));
  // a tequila rep: the rare tequila brand is the crowd side and the site shows no tequila
  const t = deepFacts(SAGE, ctx({ id: "S", venue: VENUES.S, profile: { what: "Blanco tequila", brand: "Sol" }, plan: { venues: VENUES, profile: { what: "Blanco tequila", brand: "Sol" } }, routes: [{ ...ROUTE, drinker: { name: "Casamigos", category: "Tequila" } }] }));
  assert.equal(t[0].kind, "gap");
  assert.match(t[0].text, /tequila brands few bars here share/);
  assert.match(t[0].text, /nothing on it names tequila/);
});

test("deepFacts: no website read → the crowd side only, as a question; nothing at all → no lines; neighbours need a record", () => {
  const f = deepFacts(NOSITE, ctx({ id: "N", venue: VENUES.N }));
  assert.equal(f[0].label, "The crowd side only: no website read");
  assert.match(f[0].text, /well ahead of the city's bars for non-alcoholic beers \(non-alcoholic 2\.1× the city's bars\)/);
  assert.match(f[0].text, /Doors read no website for this door, so what it carries is unknown/);
  const e = deepFacts(EMPTY, ctx({ id: "E", venue: VENUES.E }));
  assert.deepEqual(e.map((x) => x.kind), ["neighbours"], "nothing of its own: only what the block next to it lists");
  assert.match(e[0].text, /this door's own site wasn't read/);
  assert.deepEqual(deepFacts({ ...EMPTY, id: "Q" }, ctx({ id: "Q" })), [], "no record, no coordinates: nothing");
  assert.deepEqual(deepFacts(null, ctx()), []);
  assert.deepEqual(deepFacts(PIN, {}).filter((x) => x.kind === "neighbours"), [], "no city, no records: no neighbours");
});

test("deepFactsFor / deepLines / deepText: many doors at once; the shape talk-gen and the Agent take", () => {
  const all = deepFactsFor(RECS, ctx());
  assert.deepEqual(Object.keys(all).sort(), ["E", "N", "P", "S"]);
  assert.equal(all.P[0].kind, "gap");
  const lines = deepLines(all.P);
  assert.deepEqual(Object.keys(lines[0]).sort(), ["from", "label", "text"]);
  assert.ok(lines.every((l) => Object.keys(l).every((k) => ["label", "text", "prep", "from"].includes(k))));
  assert.match(deepText(all.S), /Already carries the category: /);
  assert.deepEqual(Object.keys(deepFactsFor(RECS, ctx(), ["E", "Z"])), ["E"]);
});

test("the Agent: deep facts lead the door's insight lines as evidence + 'So what:', within the Worker's 12 × 240 cut", () => {
  const all = deepFactsFor(RECS, ctx());
  const lines = deepForAgent(all.P);
  assert.ok(lines.length >= 4 && lines.length <= 6);
  assert.match(lines[0], /^Doors' insight: Qloo ranks its crowd 2 of 4 on your list/);
  assert.match(lines[1], /^So what: It brews its own beer/);
  assert.ok(lines.every((l) => l.length <= 240));
  assert.ok(lines.some((l) => /for your eyes, not the room/.test(l)), "a prep line says so");
  const plan = { profile: PROFILE, city: { key: "x", name: "X" }, venues: VENUES, days: [{ date: "2026-10-27", from: 11 * 60, to: 17 * 60, stops: [{ id: "P", eta: 12 * 60 }] }], pool: { ids: ["N", "P", "S", "E"], N: 4 } };
  const c = agentContext({ plan, dayIndex: 0, city: CITY, routes: [ROUTE], enrich: RECS, deep: all, now: new Date("2026-10-27T10:00:00") });
  const door = c.doors.P;
  assert.ok(door.insight?.lines?.length, "the door block carries insight lines");
  assert.match(door.insight.lines[0], /^Doors' insight: /);
  assert.match(door.insight.lines[1], /^So what: /);
  assert.ok(door.insight.lines.length <= 12);
  assert.ok(door.insight.lines.some((l) => /its own website/.test(l)), "enrichFacts' lines follow");
  assert.equal(door.insight.site.url, "https://pint.example/");
  const without = agentContext({ plan, dayIndex: 0, city: CITY, routes: [ROUTE], enrich: RECS, now: new Date("2026-10-27T10:00:00") });
  assert.ok(!/^Doors' insight/.test(without.doors.P.insight?.lines?.[0] ?? ""), "without deep facts the block is the enrich lane's");
});
