// Owner review 8 N1 + N2: the signer is required (saved plans without one still open), and "What you make" → a product
// kind with its own copy, facts and ask: a soft drink (sparkling water, soda, coffee…) is not an alcohol alternative,
// "sparkling" alone is not wine, and a blank ask becomes the kind's ask, shown on the form, never invented out of sight.
import { test } from "node:test";
import assert from "node:assert/strict";
import { talkPoints, productKind, defaultAsk, NEUTRAL_ASK } from "../public/lib/talk.js";
import { isNA, isSoft, roomChoices, defaultRooms, validateProfile, canOpen, emptyProfile } from "../public/lib/profile.js";
import { examples } from "../public/lib/examples.js";
import { buildPool, windowsFor } from "../public/lib/pool.js";
import { planDays } from "../public/lib/schedule.js";
import { stopModel } from "../public/lib/stopmodel.js";
import { draftNote } from "../public/lib/note.js";
import { route, city, readJson } from "./helpers.mjs";

const index = readJson("public/data/index.json");
const ctx = { cities: index.cities };
const FACTS = readJson("public/data/facts.json").facts;
const NA_FACTS = new Set(FACTS.filter((f) => f.appliesTo?.includes("na")).map((f) => f.id));
const TODAY = new Date(2026, 9, 21);

// ---------- N2: "What you make" → kind ----------
const KINDS = [
  // soft drinks
  ["artisan Sparkling Water", "soft"], ["Botanical sparkling water", "soft"], ["Canned mountain spring water", "soft"],
  ["Canned water", "soft"], ["Sparkling yuzu", "soft"], ["Craft soda", "soft"], ["Prebiotic soda", "soft"],
  ["Functional adaptogen soda", "soft"], ["Ginger beer", "soft"], ["Root beer", "soft"], ["Ginger ale", "soft"],
  ["Tonic water", "soft"], ["Cold brew coffee", "soft"], ["Canned nitro coffee", "soft"], ["Sparkling tea", "soft"],
  ["Yerba mate", "soft"], ["Matcha latte", "soft"], ["Kombucha", "soft"], ["Energy drink", "soft"],
  ["Cold-pressed juice", "soft"], ["Lemonade", "soft"], ["Sour cherry soda", "soft"], ["Non-alcoholic sparkling water", "soft"],
  // still wine, still beer, still spirits (NA alternatives stay as they were)
  ["Sparkling wine", "wine"], ["Sparkling rosé", "wine"], ["Natural wine", "wine"], ["Non-alcoholic sparkling wine", "wine"], ["Junmai sake", "wine"],
  ["Non-alcoholic hazy IPA", "beer"], ["Coffee stout", "beer"], ["Czech pilsner", "beer"], ["Berliner sour", "beer"],
  ["Reposado tequila", "spirit"], ["Coffee liqueur", "spirit"], ["Tea-infused gin", "spirit"], ["NA gin alternative", "spirit"], ["Espresso martini", "spirit"],
  ["Hard seltzer", "seltzer"], ["Hard kombucha", "seltzer"], ["Hard tea", "seltzer"], ["Canned tequila paloma", "spirit"],
  ["Dry cider", "cider"], ["Sparkling cider", "cider"],
  // can't tell
  ["Non-alcoholic sparkling botanical", "other"], ["zero-proof spritz", "other"], ["", "other"], ["Something new", "other"],
];

test("N2: a table of 'what you make' strings → kind", () => {
  for (const [what, kind] of KINDS) assert.equal(productKind(what), kind, what);
});

test("N2: a soft drink is not an NA alternative; NA alternatives still are; cafés for both", () => {
  for (const w of ["artisan Sparkling Water", "Kombucha", "Cold brew coffee", "Non-alcoholic sparkling water"]) {
    assert.equal(isNA(w), false, w);
    assert.equal(isSoft(w), true, w);
    assert.ok(roomChoices(w).some((r) => r.key === "cafes"), `${w}: cafés on offer`);
    assert.deepEqual(defaultRooms(w), ["bars", "restaurants", "cafes"], w);
  }
  for (const w of ["Non-alcoholic hazy IPA", "NA gin alternative", "zero-proof spritz", "Non-alcoholic sparkling wine", "Non-alcoholic sparkling botanical"]) assert.equal(isNA(w), true, w);
  for (const w of ["Reposado tequila", "Sparkling wine"]) assert.ok(!roomChoices(w).some((r) => r.key === "cafes"), w);
});

test("N2: the default ask by kind; an unknown kind gets the neutral ask", () => {
  assert.equal(defaultAsk("artisan Sparkling Water"), "one case in the cooler to try");
  assert.equal(defaultAsk("Reposado tequila"), "one bottle for the back bar");
  assert.equal(defaultAsk("Natural wine"), "a few bottles to try by the glass");
  assert.equal(defaultAsk("Non-alcoholic hazy IPA"), "one case of cans in the cooler");
  assert.equal(defaultAsk("zero-proof spritz"), NEUTRAL_ASK);
  assert.equal(defaultAsk(""), NEUTRAL_ASK);
  assert.equal(NEUTRAL_ASK, "a sample for the team and five minutes with whoever buys");
});

// Jard's screenshot: THIS (artisan sparkling water) × Cincinnati, drinker LaCroix. Here on Chicago LaCroix rooms.
const LC = route("lacroix-chicago");
const lcIds = LC.lists.all.map(([id]) => id).slice(0, 60);
const THIS = { brand: "THIS", what: "artisan Sparkling Water", ask: "", drinksLike: [{ name: "LaCroix", na: true }] };
const lines = (t) => [...t.before, t.opener, ...(t.toBuyer ? [t.toBuyer] : []), ...t.questions, ...t.points.map((p) => p.text), ...t.pushback.flatMap((p) => [p.objection, p.reply]), t.ask];

test("N2: a sparkling water's talk: no NA framing or NA facts, no wine ask, its own copy (even if a caller says isNA)", () => {
  const types = new Set();
  for (const [k, id] of lcIds.entries()) {
    for (const flag of [false, true]) {
      const t = talkPoints({ venue: LC.venues[id], rank: k + 1, N: 100, drinkerName: "LaCroix", city: "Chicago", profile: THIS, isNA: flag, deepOff: true }, FACTS); // template baseline
      types.add(t.venueType);
      const all = lines(t).join("\n");
      assert.doesNotMatch(all, /non-?alcoholic|isn't drinking|by the glass|bottles/i, `${LC.venues[id].name}: ${all}`);
      assert.ok(t.facts.every((f) => !NA_FACTS.has(f)), `${LC.venues[id].name}: ${t.facts}`);
      assert.equal(t.ask, "one case in the cooler to try");
      assert.match(t.opener, /^(Hi|Hey), I'm with THIS, an artisan Sparkling Water\. /);
      assert.match(t.questions[0], /^What sparkling waters do you carry/);
      assert.ok(t.pushback.some((p) => p.objection === "Sparkling water doesn't sell here."));
    }
  }
  assert.ok(types.size >= 2, [...types].join());
});

test("N2: NA alternatives keep their NA copy and facts", () => {
  const t = talkPoints({ venue: LC.venues[lcIds[0]], rank: 1, N: 100, drinkerName: "LaCroix", city: "Chicago", profile: { brand: "Zero G", what: "Non-alcoholic gin" }, isNA: true }, FACTS);
  assert.match(t.toBuyer, /isn't drinking|driving/, "an NA line");
  assert.doesNotMatch(t.toBuyer, /beer|one cold/, "an NA gin is a drink, poured as a taste");
  assert.match(t.opener, /^(Hi|Hey), I'm with Zero G, a non-alcoholic gin\./);
  assert.ok(t.facts.some((f) => NA_FACTS.has(f)));
  assert.equal(t.ask, "one bottle for the back bar");
  const u = talkPoints({ venue: LC.venues[lcIds[0]], rank: 1, N: 100, profile: { brand: "Mystery", what: "Something new" } }, FACTS);
  assert.equal(u.ask, NEUTRAL_ASK);
  assert.ok(!draftNote({ venue: { name: "X" }, profile: { brand: "B" }, ask: "" }).body.includes(NEUTRAL_ASK), "no product ask in a first message");
});

// ---------- every Example, through the stop model (talk + drafted note) ----------
const stopOf = (p) => {
  // N3: a preset room as "rooms that already pour you" reads its fetched files, like v1's venue (lib/live.js)
  const roomKeys = (p.pours ?? []).map((r) => index.rooms.find((x) => x.id === r.id)?.key).filter(Boolean);
  const keys = p.venue ? [p.venue] : roomKeys.length ? roomKeys : p.drinks.map((d) => d.key);
  const routes = keys.map((k) => route(`${k}-${p.city}`));
  const cityName = index.cities.find((c) => c.key === p.city).name;
  const pool = buildPool({ routes, profile: p, cityName });
  const windows = windowsFor(p);
  const d = planDays({ pool: pool.rows, statuses: pool.statuses, windows, visitMin: p.visitMin, pinned: pool.pinned });
  const plan = { ...d, venues: pool.venues, pool: { ids: pool.ids, N: pool.N, label: pool.label, drinker: pool.drinker }, statuses: pool.statuses, outcomes: {}, profile: p, city: { key: p.city, name: cityName }, windows };
  return stopModel({ plan, id: d.days[0].stops[0].id, dayIndex: 0, city: city(p.city), facts: FACTS, routes, deepOff: true }); // the kinds' template baseline (R9 deep off)
};

test("N1 + N2: every Example fills a complete form, signs its notes, and talks like its kind", () => {
  const want = { maya: "beer", dana: "spirit", luis: "spirit", priya: "spirit", marcus: "spirit", jess: "soft", tom: "soft", kayla: "seltzer", ben: "cider" };
  for (const x of examples(TODAY)) {
    const p = x.profile;
    assert.deepEqual(validateProfile(p, ctx), { ok: true, errors: {} }, x.key);
    assert.equal(productKind(p.what), want[x.key] ?? productKind(p.what), x.key);
    for (const blank of [false, true]) {
      const q = blank ? { ...p, pitch: { ...p.pitch, ask: "" } } : p;
      const m = stopOf(q);
      const ask = blank ? defaultAsk(p.what) : p.pitch.ask;
      assert.equal(m.talk.ask, ask, `${x.key}: the ask`);
      assert.ok(!m.note.body.includes(ask), `${x.key}: the ask is for the conversation after the taste, not the first note`);
      assert.match(m.note.body, new RegExp(`Thanks,\\n${p.pitch.name.split(" ")[0]}$`), `${x.key}: signed`);
      assert.match(m.note.body, new RegExp(`Could I stop in and pour .+ ${["wine", "spirit"].includes(productKind(p.what)) ? "a taste" : "a cold one"}\\?|drop off a few cold ones|make .+ a quick drink with it`), `${x.key}: a taste, in the kind's words`);
      if (isSoft(p.what)) {
        assert.doesNotMatch(lines(m.talk).join("\n"), /non-?alcoholic|isn't drinking/i, x.key);
        assert.ok(m.talk.facts.every((f) => !NA_FACTS.has(f)), `${x.key}: no NA facts`);
      }
      if (blank && !["wine", "spirit"].includes(productKind(p.what))) assert.doesNotMatch(m.talk.ask, /glass|bottle/, `${x.key}: no wine or spirit ask`);
    }
  }
});

// ---------- N1: the signer ----------
test("N1: the signer is required; a saved plan without one still opens", () => {
  const ex = examples(TODAY)[0].profile;
  for (const name of ["", "   ", undefined]) {
    const p = { ...ex, pitch: { ...ex.pitch, name } };
    const v = validateProfile(p, ctx);
    assert.equal(v.ok, false);
    assert.deepEqual(Object.keys(v.errors), ["name"]);
    assert.match(v.errors.name, /signed/);
    assert.equal(canOpen(p, ctx), true, "opens anyway");
  }
  const old = { ...ex };
  delete old.pitch;
  assert.equal(canOpen(old, ctx), true, "saved before pitch existed");
  assert.equal(canOpen({ ...ex, windows: [], week: null }, ctx), false, "any other error still stops it");
  assert.equal(canOpen(null, ctx), false);
  assert.ok(validateProfile({ ...ex, pitch: { ...ex.pitch, name: "The THIS team" } }, ctx).ok);
  assert.ok(validateProfile(emptyProfile(), ctx).errors.name);
});

// N2 × N3: a soft drink planned from rooms that already pour it still talks like a soft drink
test("N2 × N3: a sparkling water planned from a room that pours it gets the soft-drink opener, points and ask", () => {
  const tom = examples(TODAY).find((x) => x.key === "tom").profile;
  const parsons = index.rooms.find((r) => r.key === "parsons");
  const p = { ...tom, brand: "THIS", what: "artisan Sparkling Water", drinks: [], pours: [{ id: parsons.id, name: parsons.name, where: parsons.where }], city: "austin", start: examples(TODAY).find((x) => x.key === "ben").profile.start, pitch: { ...tom.pitch, ask: "" } };
  assert.equal(productKind(p.what), "soft");
  const m = stopOf(p);
  const all = lines(m.talk).join("\n");
  assert.doesNotMatch(all, /non-?alcoholic|isn't drinking/i);
  assert.ok(m.talk.facts.every((f) => !NA_FACTS.has(f)));
  assert.equal(m.talk.ask, defaultAsk(p.what));
  assert.doesNotMatch(m.talk.ask, /glass|bottle/);
});
