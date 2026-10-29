// The room-sound guard: synthetic fingerprints plus the real Austin city file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { guardSound, localeCounts, commonArtists, referenceGenres, sceneOf, venueText } from "../public/lib/core.js";
import { city } from "./helpers.mjs";

const VALID = ["ok", "thin", "locale", "genre", "scene", "area", "inherited", "no-signal"];
const artist = (id, name, genres) => ({ id, name, genres });
const many = (n, prefix, name, genres) => Array.from({ length: n }, (_, i) => artist(`${prefix}${i}`, `${name} ${String.fromCharCode(65 + i)}`, genres));

// An Austin-like reference: Texas country, Americana, Tejano, indie, plus the generic genres everyone carries.
const AUSTIN_REF_LISTS = [
  [
    artist("r1", "George Strait", ["country", "texas_country", "pop"]),
    artist("r2", "Willie Nelson", ["country", "outlaw_country", "americana"]),
    artist("r3", "Selena", ["tejano", "latin_pop"]),
    artist("r4", "Spoon", ["indie_rock", "rock"]),
    artist("r5", "Parker McCollum", ["texas_country", "red_dirt"]),
  ],
];
const REF = referenceGenres(AUSTIN_REF_LISTS);
const LOCALE = localeCounts(AUSTIN_REF_LISTS);

const KPOP = Array.from({ length: 10 }, (_, i) => artist(`k${i}`, ["BTS", "BLACKPINK", "TWICE", "NewJeans", "aespa", "IVE", "SEVENTEEN", "Stray Kids", "ITZY", "LE SSERAFIM"][i], ["k_pop", "korean", "pop", "dance"]));
const TEXAS = Array.from({ length: 20 }, (_, i) => artist(`t${i}`, `Texas Singer ${i}`, ["country", "texas_country", "red_dirt"]));

test("K-pop list against an Austin-like reference fails 'locale'", () => {
  const g = guardSound(KPOP, REF, [], { locale: LOCALE, cityName: "Austin" });
  assert.equal(g.pass, false);
  assert.equal(g.reason, "locale");
  assert.equal(g.foreign, 10);
});

test("non-Latin artist names count as foreign even without a locale genre", () => {
  const list = [...many(7, "c", "Country", ["texas_country"]), artist("h1", "방탄소년단", ["texas_country"]), artist("h2", "Иван", ["texas_country"]), artist("h3", "周杰倫", ["texas_country"])];
  assert.equal(guardSound(list, REF, [], { locale: LOCALE }).reason, "locale");
});

test("Cyrillic, Greek, Arabic and Devanagari names count as foreign with no locale genre tags", () => {
  // a Russian-pop top 10 tagged only with the genres the Austin reference has: the script alone must flag it
  const names = ["Оля Полякова", "Полина Гагарина", "Ёлка", "Дима Билан", "Валерия", "Νατάσα Θεοδωρίδου", "عمرو دياب", "अरिजीत सिंह", "SEREBRO", "Artik & Asti"];
  const list = names.map((n, i) => artist(`ru${i}`, n, ["texas_country", "pop"]));
  const g = guardSound(list, REF, [], { locale: LOCALE, cityName: "Austin" });
  assert.equal(g.pass, false);
  assert.equal(g.reason, "locale");
  assert.equal(g.foreign, 8);
  for (const n of ["Оля Полякова", "Νατάσα Θεοδωρίδου", "عمرو دياب", "अरिजीत सिंह"]) {
    const one = [...many(7, "c", "Country", ["texas_country"]), ...[n, n, n].map((x, i) => artist(`f${i}`, x, ["texas_country"]))];
    assert.equal(guardSound(one, REF, [], { locale: LOCALE }).reason, "locale", n);
  }
  // accented Latin names are not foreign
  const accented = ["Beyoncé", "Sigur Rós", "Mötley Crüe", "Ramón Ayala", "Björk", "Céline Dion", "Juanes", "Maná", "Ñengo Flow", "Đorđe"].map((n, i) => artist(`a${i}`, n, ["texas_country"]));
  const ga = guardSound(accented, REF, [], { locale: LOCALE });
  assert.equal(ga.foreign, 0);
  assert.equal(ga.pass, true, ga.detail);
});

test("junk tags (all, usa, bandcamp, texas) do not count as shared genres", () => {
  const junk = many(10, "j", "Junk", ["all", "usa", "bandcamp", "texas"]);
  const ref = new Set([...REF, "all", "usa", "bandcamp", "texas"]);
  const g = guardSound(junk, ref, [], { locale: LOCALE });
  assert.equal(g.pass, false);
  assert.equal(g.reason, "genre");
  assert.equal(g.shared, 0);
  // one real shared genre on 3 of them is enough
  const mixed = [...many(3, "m", "Real", ["texas_country", "all", "usa"]), ...many(7, "j", "Junk", ["all", "usa", "bandcamp", "texas"])];
  assert.equal(guardSound(mixed, ref, [], { locale: LOCALE }).shared, 3);
});

// Six regional Mexican / Latin acts in a top 10 that otherwise fits Austin.
const LATIN_LIST = [
  ...["Grupo Frontera", "Peso Pluma", "Fuerza Regida", "Carin León", "Grupo Firme", "Intocable"].map((n, i) => artist(`lat${i}`, n, ["regional_mexican", "norteno", "tejano"])),
  ...many(4, "tx", "Texas", ["texas_country", "red_dirt"]),
];
const BREWERY = { id: "brew", name: "Hops & Grain Brewing", genre: "urn:tag:genre:place:brewery", crowd: "A craft-beer crowd of young professionals and beer enthusiasts.", ambience: "Industrial taproom with picnic tables.", description: "Austin brewery known for IPAs." };
const CANTINA = { id: "cant", name: "El Rancho", genre: "urn:tag:genre:place:restaurant:mexican", crowd: "Families and fans of regional Mexican music.", ambience: "Lively, festive." };

test("≥6 of 10 regional Mexican/Latin artists fail 'scene' when the venue's record has no Latin cue", () => {
  assert.equal(sceneOf(LATIN_LIST)?.key, "latin");
  assert.equal(sceneOf(LATIN_LIST).n, 6);
  assert.equal(sceneOf(LATIN_LIST.slice(1)), null, "5 of 9 is not a scene list");
  assert.ok(!/mexic|latin/i.test(venueText(BREWERY)));
  const g = guardSound(LATIN_LIST, REF, [], { locale: LOCALE, cityName: "Austin", venue: BREWERY });
  assert.equal(g.pass, false);
  assert.equal(g.reason, "scene");
  assert.match(g.detail, /6 of the top 10/);
  // without a venue record the scene check does not run
  assert.equal(guardSound(LATIN_LIST, REF, [], { locale: LOCALE }).pass, true);
});

test("the same Latin list passes the scene check where the crowd or genre says Mexican or Latin", () => {
  const g = guardSound(LATIN_LIST, REF, [], { locale: LOCALE, venue: CANTINA });
  assert.equal(g.pass, true, g.detail);
  assert.equal(g.reason, "ok");
  // a crowd line alone is enough
  const crowdOnly = { ...BREWERY, crowd: "A mostly Latino crowd on weekends." };
  assert.equal(guardSound(LATIN_LIST, REF, [], { locale: LOCALE, venue: crowdOnly }).pass, true);
  // the genre alone is enough
  const genreOnly = { ...BREWERY, name: "Ranch 616", crowd: null, ambience: null, description: null, genre: "urn:tag:genre:place:restaurant:tex-mex" };
  assert.equal(guardSound(LATIN_LIST, REF, [], { locale: LOCALE, venue: genreOnly }).pass, true);
});

test("a locale genre the city's own lists carry on 3+ artists is local", () => {
  const cityLists = [many(3, "kc", "Local", ["k_pop"])];
  const locale = localeCounts(cityLists);
  assert.equal(locale.get("k_pop"), 3);
  const latinKpop = many(10, "lk", "Band", ["k_pop", "texas_country"]);
  const g = guardSound(latinKpop, REF, [], { locale });
  assert.equal(g.pass, true, g.detail);
  assert.equal(guardSound(latinKpop, REF, [], { locale: new Map() }).reason, "locale");
});

test("a coherent Texas-country list passes", () => {
  const g = guardSound(TEXAS, REF, [], { locale: LOCALE, cityName: "Austin" });
  assert.equal(g.pass, true, g.detail);
  assert.equal(g.reason, "ok");
  assert.equal(g.shared, 10);
  assert.match(g.detail, /texas country/);
});

test("sharing ≥15 of 20 with a door 0.5 km away fails 'inherited'", () => {
  const twinIds = [...TEXAS.slice(0, 15).map((a) => a.id), "x1", "x2", "x3", "x4", "x5"];
  const g = guardSound(TEXAS, REF, [{ id: "door-b", name: "Door B", km: 0.5, artistIds: twinIds }], { locale: LOCALE });
  assert.equal(g.pass, false);
  assert.equal(g.reason, "inherited");
  assert.deepEqual(g.twins, ["door-b"]);
  // 14 shared, or the same list 1.5 km away, is fine
  const fourteen = [...TEXAS.slice(0, 14).map((a) => a.id), "x1", "x2", "x3", "x4", "x5", "x6"];
  assert.equal(guardSound(TEXAS, REF, [{ id: "b", km: 0.5, artistIds: fourteen }], { locale: LOCALE }).pass, true);
  assert.equal(guardSound(TEXAS, REF, [{ id: "b", km: 1.5, artistIds: twinIds }], { locale: LOCALE }).pass, true);
});

test("a top 10 that is mostly city-common artists fails 'area'", () => {
  const common = new Set(TEXAS.slice(0, 6).map((a) => a.id));
  const g = guardSound(TEXAS, REF, [], { locale: LOCALE, common });
  assert.equal(g.pass, false);
  assert.equal(g.reason, "area");
  // 4 common is still allowed (maxCommon 4)
  assert.equal(guardSound(TEXAS, REF, [], { locale: LOCALE, common: new Set(TEXAS.slice(0, 4).map((a) => a.id)) }).pass, true);
});

test("commonArtists: ≥10% and ≥3 of ≥10 door lists (top 10 only, counted once per list)", () => {
  const lists = Array.from({ length: 20 }, (_, i) => [`u${i}a`, `u${i}b`]);
  lists[0].push("shared", "shared");
  lists[1].push("shared");
  lists[4].push("twice");
  lists[5].push("twice");
  lists[6].push("shared");
  lists[2].unshift(...Array.from({ length: 10 }, (_, j) => `pad${j}`), "late"); // "late" sits at position 11
  lists[3].push("late");
  const c = commonArtists(lists);
  assert.ok(c.has("shared"), "3 of 20 lists");
  assert.ok(!c.has("twice"), "2 of 20 = 10% but under the 3-room minimum");
  assert.ok(!c.has("late"), "only 1 of 20 lists carries it inside its top 10 (5%)");
  assert.ok(!c.has("u0a"));
  assert.equal(commonArtists(lists.slice(0, 9)).size, 0, "fewer than 10 lists: no common set");
});

test("fewer than 5 artists is 'thin'", () => {
  const g = guardSound(TEXAS.slice(0, 4), REF, []);
  assert.equal(g.pass, false);
  assert.equal(g.reason, "thin");
  assert.equal(guardSound(null, REF).reason, "thin");
});

test("generic-only genre matches (pop, rock) do not count as shared", () => {
  const generic = many(10, "g", "Generic", ["pop", "rock", "dance", "hip_hop"]);
  const ref = new Set([...REF, "pop", "rock", "dance", "hip_hop"]);
  const g = guardSound(generic, ref, [], { locale: LOCALE });
  assert.equal(g.pass, false);
  assert.equal(g.reason, "genre");
  assert.equal(g.shared, 0);
});

test("real Austin city file: every sound has a guard with pass boolean and a reason", () => {
  const c = city("austin");
  const reasons = {};
  const entries = Object.entries(c.sounds);
  assert.ok(entries.length > 50);
  for (const [id, s] of entries) {
    assert.equal(typeof s.guard?.pass, "boolean", id);
    assert.equal(typeof s.guard.reason, "string", id);
    assert.ok(VALID.includes(s.guard.reason), s.guard.reason);
    assert.equal(s.guard.pass, s.guard.reason === "ok", id);
    assert.equal(typeof s.guard.detail, "string", id);
    assert.ok(Array.isArray(s.artists), id);
    if (s.guard.reason === "no-signal") assert.deepEqual(s.artists, [], `${id}: no-signal has no artists`);
    reasons[s.guard.reason] = (reasons[s.guard.reason] ?? 0) + 1;
  }
  console.log("austin stored guard reasons:", JSON.stringify(reasons));
  assert.ok(reasons.locale > 0, "real failures include locale");
  assert.ok(reasons.area > 0, "real failures include area");
  assert.ok(reasons.scene > 0, "real failures include scene");
});

test("real Austin: Nomadic Beerworks' regional-Mexican list fails 'scene'", () => {
  const c = city("austin");
  const s = c.sounds["00000000-0000-4000-8000-271655E6AA28"];
  assert.ok(s, "Nomadic Beerworks has a stored sound");
  assert.equal(s.guard.pass, false);
  assert.equal(s.guard.reason, "scene");
  assert.match(s.guard.detail, /Mexican and Latin/);
  assert.equal(sceneOf(s.artists)?.key, "latin", "the stored list itself is a Latin scene list");
});

test("real Austin: re-running guardSound over the stored lists gives well-formed verdicts", () => {
  const c = city("austin");
  const cityLists = [c.citySound, ...Object.values(c.nbhdSounds)];
  const ref = referenceGenres(cityLists);
  const locale = localeCounts(cityLists);
  const common = new Set(c.commonArtists ?? []);
  const reasons = {};
  for (const s of Object.values(c.sounds)) {
    let g;
    assert.doesNotThrow(() => (g = guardSound(s.artists, ref, [], { locale, common, cityName: c.name })));
    assert.equal(typeof g.pass, "boolean");
    assert.equal(typeof g.detail, "string");
    reasons[g.reason] = (reasons[g.reason] ?? 0) + 1;
    // (Stored artists keep only 5 genres each and the precompute's reference also held the brands' artists, so the
    // recomputed reasons are not expected to equal the stored ones exactly.)
  }
  console.log("austin recomputed guard reasons (city + neighbourhood reference only):", JSON.stringify(reasons));
  assert.ok(reasons.area > 0, "area failures reproduce from the stored commonArtists");
});
