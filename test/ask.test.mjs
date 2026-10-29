// Persona MUST #2 (drinks rep + founder): the brand's ask drives the room filter and the script. A keg/draft/tap/sixtel
// ask goes only to bars, breweries, pubs, taprooms and restaurants tagged "Full bar"; rooms whose Qloo drinks tags are
// soft drinks only leave the pool; the pushback matches the ask; the price becomes a per-pour / per-can margin line,
// talking point #1, in place of the global stat. Real Austin rooms from the precompute.
import { test } from "node:test";
import assert from "node:assert/strict";
import { askMiss, softOnly, hasTaps, tapAsk, parsePrices, marginLine } from "../public/lib/ask.js";
import { talkPoints } from "../public/lib/talk.js";
import { buildPool } from "../public/lib/pool.js";
import { sieve } from "../public/lib/sieve.js";
import { roomOf } from "../public/lib/profile.js";
import { route, readJson } from "./helpers.mjs";

const parsons = route("parsons-austin");
const ab = route("athletic-brewing-austin");
const FACTS = readJson("public/data/facts.json").facts;
const byName = (r, n) => Object.values(r.venues).find((v) => v.name.startsWith(n));
const MOMO = byName(parsons, "Everest Momo");
const KEBAB = byName(parsons, "The Kebab Shop");
const SAMS = byName(ab, "Sam's BBQ");
// the drinks rep's profile (persona round 2): a dry cider, a sixtel ask, two prices
const HOLLOW = { brand: "Hollow Oak", what: "Dry craft cider", price: "$165 a sixtel, $44 a case of 24", ask: "a sixtel", support: "staff tasting" };
// the founder's (persona round 2): an NA IPA by the case, the per-can price typed in by hand
const TIDEWELL = { brand: "Tidewell", what: "Non-alcoholic hazy IPA", price: "$38 a case of 24 ($1.58 a can)", ask: "one case of cans in the cooler", support: "a staff tasting" };
const START = { label: "S Congress", lat: 30.2457, lon: -97.7508 };
// the form's shape (pitch: {price, ask}), as the page and the planner read it
const profile = (over = {}) => ({ brand: HOLLOW.brand, what: HOLLOW.what, rooms: ["bars", "breweries", "restaurants"], start: START, windows: [{ date: "2026-10-28", from: "15:00", to: "20:00" }], visitMin: 25, known: [], pitch: { price: HOLLOW.price, ask: HOLLOW.ask, support: [] }, ...over });

test("the ask: keg, sixtel, draft and tap words read as a tap ask; a case in the cooler doesn't", () => {
  for (const a of ["a sixtel", "a cider on draft for a month", "one tap line", "a half barrel", "a 1/6 bbl", "a keg for the patio"]) assert.ok(tapAsk(a), a);
  for (const a of ["one case of cans in the cooler", "a bottle for the back bar", "", "a sample for the team"]) assert.ok(!tapAsk(a), a);
});

test("rooms: a food truck with soft drinks only leaves any alcohol or NA pitch; a counter without a full bar leaves a keg ask", () => {
  assert.ok(MOMO && KEBAB && SAMS, "the persona's rooms are in the Austin data");
  assert.ok(softOnly(MOMO));
  assert.equal(askMiss(MOMO, HOLLOW)?.code, "soft-only");
  assert.equal(askMiss(MOMO, TIDEWELL)?.code, "soft-only", "the founder's NA IPA too");
  assert.equal(askMiss(MOMO, { what: "Sparkling water", ask: "" }), null, "a soft drink sells where soft drinks sell");
  assert.equal(askMiss(MOMO, { what: "Drink", ask: "" }), null, "a product Doors can't read claims nothing");
  assert.ok(!hasTaps(KEBAB));
  assert.equal(askMiss(KEBAB, HOLLOW)?.code, "no-taps");
  assert.match(askMiss(KEBAB, HOLLOW).reason, /a sixtel/);
  assert.equal(askMiss(KEBAB, { ...HOLLOW, ask: "a case of cans" }), null, "cans are fine at a counter that sells beer");
  assert.equal(askMiss(SAMS, HOLLOW), null, "a restaurant tagged Full bar keeps a keg ask");
  // a café stays for an NA product: the rep picked that chip for it
  assert.equal(askMiss({ name: "Cuppa", genre: "urn:tag:genre:place:cafe", tags: { bev: ["Coffee and tea"] } }, TIDEWELL), null);
  // no drinks tags = no claim
  assert.equal(askMiss({ name: "X", genre: "urn:tag:genre:place:restaurant", tags: {} }, TIDEWELL), null);
  // an alehouse Qloo tags soft-drinks-only keeps its place (its name says it pours)
  assert.equal(softOnly({ name: "Armitage Alehouse", genre: "urn:tag:genre:place:restaurant", tags: { bev: ["Soft drinks"] } }), false);
});

test("pool: a sixtel ask plans only rooms with taps and no soft-drinks-only room; the sieve says why the others left", () => {
  const p = buildPool({ routes: [parsons], profile: profile(), cityName: "Austin" });
  const wide = buildPool({ routes: [parsons], profile: profile({ pitch: { price: HOLLOW.price, ask: "one case of cans in the cooler", support: [] } }), cityName: "Austin" });
  assert.ok(p.N > 10 && p.N < wide.N, `sixtel ${p.N} < cans ${wide.N}`);
  for (const id of p.ids) {
    const v = p.venues[id];
    assert.ok(hasTaps(v), `${v.name} (${roomOf(v)}) has taps`);
    assert.ok(!softOnly(v), `${v.name} is not soft-drinks only`);
  }
  assert.ok(!p.ids.includes(MOMO.id) && !p.ids.includes(KEBAB.id));
  assert.ok(!wide.ids.includes(MOMO.id), "soft-drinks only leaves the cans plan too");
  assert.ok(wide.ids.includes(KEBAB.id), "cans keep the counter that sells beer");
  const s = sieve({ route: parsons, plan: { days: [], venues: p.venues, statuses: {}, reasons: {} }, profile: profile() });
  const kebab = s.dots.find((d) => d.id === KEBAB.id);
  assert.equal(kebab.fate, "room");
  assert.match(kebab.reason, /taps/i);
  assert.match(s.dots.find((d) => d.id === MOMO.id).reason, /soft drinks/i);
});

test("price: parsed per unit; a sixtel is ~41 pints / 55 twelve-ounce glasses; a case of 24 at $38 is $1.58 a can", () => {
  const ps = parsePrices(HOLLOW.price);
  assert.deepEqual(ps.map((x) => x.unit), ["keg", "case"]);
  const keg = marginLine(HOLLOW);
  assert.match(keg.text, /^A sixtel holds about 41 pints \(55 twelve-ounce glasses\): at \$165 that's about \$4 a pint, \$3 a 12 oz glass/);
  const can = marginLine(TIDEWELL);
  assert.equal(can.text, "$38 a case of 24 is $1.58 a can: if it sells at $7 on your menu, you keep about $5.42 a can.");
  assert.match(marginLine({ ...TIDEWELL, menuPrice: "$8" }).text, /at \$8 on your menu, you keep about \$6\.42/);
  // the price must be in the ask's unit: a case price never prices a draft ask
  assert.equal(marginLine({ ...HOLLOW, price: "$44 a case of 24" }), null);
  assert.equal(marginLine({ ...HOLLOW, price: "" }), null);
  assert.equal(marginLine({ ...HOLLOW, ask: "a case of cans", price: "$165 a sixtel, $44 a case of 24" }).text.startsWith("$44 a case of 24 is $1.83 a can"), true);
});

test("script: a sixtel ask gets keg pushback, never 'a row in the cooler', and the margin is point #1 in place of the global stat", () => {
  const t = talkPoints({ venue: SAMS, rank: 3, N: 40, drinkerName: "Parson's", city: "Austin", profile: HOLLOW }, FACTS);
  const all = JSON.stringify(t.pushback);
  assert.doesNotMatch(all, /cooler/i);
  assert.match(t.pushback.find((p) => /room/.test(p.objection)).reply, /rotating tap line/i);
  assert.match(t.pushback.find((p) => /doesn't sell/.test(p.objection)).reply, /tap line/i);
  assert.match(t.points[0].text, /^A sixtel holds about 41 pints/);
  assert.equal(t.points[0].margin, true);
  assert.ok(!t.facts.includes("bartender-rec-46") && !t.facts.includes("bartender-reliability"), `no global stat: ${t.facts}`);
  // a bar too
  const bar = Object.values(parsons.venues).find((v) => roomOf(v) === "bars" && v.tags?.bev?.length);
  const tb = talkPoints({ venue: bar, profile: HOLLOW }, FACTS);
  assert.doesNotMatch(JSON.stringify(tb.pushback), /cooler/i);
  assert.match(tb.points[0].text, /sixtel/);
});

test("script: the founder's NA cans lead with $1.58 a can; NA facts stay after it; no price → the stat stays", () => {
  const t = talkPoints({ venue: SAMS, profile: TIDEWELL, isNA: true }, FACTS);
  assert.match(t.points[0].text, /\$1\.58 a can: if it sells at \$7 on your menu, you keep about \$5\.42 a can/);
  assert.ok(t.facts.length >= 1, "NA category facts still follow the margin line");
  assert.doesNotMatch(t.before.join(" "), /\(\$38 a case of 24 \(\$1\.58 a can\)\)/, "no doubled parentheses");
  const noPrice = talkPoints({ venue: SAMS, profile: { ...HOLLOW, price: "" } }, FACTS);
  assert.ok(!noPrice.points.some((p) => p.margin));
  assert.ok(noPrice.facts.length === 1, "without a margin line the one category fact stays");
});

test("note: a return visit after 'no room' answers a keg ask with a tap line, not the cooler", async () => {
  const { draftNote } = await import("../public/lib/note.js");
  const n = draftNote({ venue: SAMS, profile: HOLLOW, ask: HOLLOW.ask, memory: { visit: "return", objection: { kind: "space" } } });
  assert.match(n.body, /rotating tap line/);
  assert.doesNotMatch(n.body, /cooler/);
  const c = draftNote({ venue: SAMS, profile: TIDEWELL, ask: TIDEWELL.ask, memory: { visit: "return", objection: { kind: "space" } } });
  assert.match(c.body, /row in the cooler/);
});

test("price: a case of mezcal or wine is bottles (shots, glasses), never cans; an unreadable kind says 'each'", () => {
  const mez = marginLine({ what: "Small-batch mezcal", price: "$420 a case of 12", ask: "a mezcal cocktail on the list" });
  assert.equal(mez.text, "$420 a case of 12 is $35 a bottle, about 17 shots of 1.5 oz: about $2.06 a shot, to price against your cocktails.");
  const wine = marginLine({ what: "Orange wine", price: "$22 a bottle", ask: "a few bottles to try by the glass" });
  assert.equal(wine.text, "At $22 a bottle, five glasses to a bottle: about $4.40 a glass, so at $12 a glass you keep about $7.60.");
  assert.match(marginLine({ what: "Drink", price: "$38 a case of 24", ask: "" }).text, /\$1\.58 each: .* you keep about \$5\.42 each\.$/);
  assert.match(marginLine({ what: "Sparkling water", price: "$30 a case of 24", ask: "" }).text, /\$1\.25 each: if it sells at \$4 on your menu/);
  assert.match(marginLine({ what: "Canned mountain spring water", price: "$28 a case of 24", ask: "a row in the grab-and-go fridge" }).text, /\$1\.17 a can: if it sells at \$4/);
  assert.match(marginLine({ what: "Canned tequila paloma", price: "$46 a case of 24", ask: "a case in the cooler for the patio" }).text, /^\$46 a case of 24 is \$1\.92 a can: if it sells at \$7/);
  assert.match(marginLine({ what: "Añejo tequila", price: "$540 a case of 12", ask: "an añejo flight on the back bar" }).text, /^\$540 a case of 12 is \$45 a bottle, about 17 shots/);
});
