// WHY-VIZ-SPEC §6 Elsewhere, on the demo bake (Maya · Athletic Brewing · Austin): Your list's strip per row
// (lib/whyviz/strip.js), the stop card's rarity chips (lib/whyviz/lift.js rarityChips through lib/stopmodel.js and
// lib/doorcard.js aboutLines), the landing hero (lib/whyviz/hero.js: picture 1 with two labels, exactly the app's Why
// home for the demo plan). Every number traces to a Qloo field or a Doors count; no decimals in any words.
import { test } from "node:test";
import assert from "node:assert/strict";
import { route, readJson, city } from "./helpers.mjs";
import { demoProfile } from "../public/lib/demo-profile.js";
import { demoStates, bakedMatrix } from "../public/lib/demo-plan.js";
import { buildPool } from "../public/lib/pool.js";
import { cityRooms, CROWD_TERMS, planIds } from "../public/lib/insights.js";
import { popWords } from "../public/lib/core.js";
import { stripModel, BIG_LINE } from "../public/lib/whyviz/strip.js";
import { liftModel, rarityChips, cityShares, STRONG, RARE_MAX } from "../public/lib/whyviz/lift.js";
import { portraitModel } from "../public/lib/whyviz/portrait.js";
import { stopModel } from "../public/lib/stopmodel.js";
import { aboutLines } from "../public/lib/doorcard.js";
import { heroPlan, heroModel } from "../public/lib/whyviz/hero.js";
import { sieve } from "../public/lib/sieve.js";
import { explorerModel } from "../public/lib/whyviz/explorer.js";

const austin = route("athletic-brewing-austin");
const demo = readJson("public/data/demo/demo.json");
const austinCity = city("austin");
const NOMADIC = "00000000-0000-4000-8000-271655E6AA28";
let cache;
async function setup() {
  if (cache) return cache;
  const profile = demoProfile();
  const { states } = await demoStates({ routes: [austin], profile, contact: demo.contact, fetchMatrix: bakedMatrix(demo.matrix) });
  const { plan: p, pool } = states[0];
  const plan = { ...p, venues: pool.venues, statuses: pool.statuses, pool: { ids: pool.ids, N: pool.ids.length }, city: { key: "austin", name: "Austin" }, profile };
  return (cache = { plan, profile, base: cityRooms([austin]) });
}

test("strip: a dot at the door's popularity, the tick at Doors' line, words never numbers", () => {
  assert.equal(BIG_LINE, 0.9);
  const on = stripModel({ pop: 0.73, onDay: true });
  assert.deepEqual([on.x, on.tick, on.cls, on.word], [0.73, 0.9, "plan", popWords(0.73)]);
  assert.equal(on.text, "How well known: well known");
  assert.equal(stripModel({ pop: 0.15, onDay: false }).cls, "list");
  assert.equal(stripModel({ pop: 0.15, onDay: true, marked: true }).cls, "off");
  const big = stripModel({ pop: 0.95, onDay: false });
  assert.equal(big.cls, "big");
  assert.match(big.text, /past Doors' big-names line$/);
  const none = stripModel({ pop: null });
  assert.deepEqual([none.x, none.cls, none.text], [null, "none", "Qloo has no popularity for this door"]);
  assert.equal(stripModel({ pop: 1.4 }).x, 1, "clamped to the hairline");
  for (const p of [0.07, 0.42, 0.66, 0.91]) assert.doesNotMatch(stripModel({ pop: p }).text, /\d/, "no numbers in the words");
});

test("strip: every ranked row of the demo's Your list has a dot and words", async () => {
  const { plan } = await setup();
  const rows = plan.pool.ids.map((id) => stripModel({ pop: plan.venues[id].popularity, onDay: planIds(plan).includes(id) }));
  assert.equal(rows.length, 55);
  assert.ok(rows.every((r) => r.x != null && r.word), "Qloo has a popularity on every ranked door");
  assert.equal(rows.filter((r) => r.cls === "plan").length, 21);
  assert.equal(rows[0].word, popWords(plan.venues[NOMADIC].popularity));
  assert.equal(rows[2].cls, "list", "Growler Express (#3) sits on the list, not on a day");
  assert.equal(rows[2].word, "almost unknown");
});

test("rarity chips: the door's groups, rare by the plan-level lift (≥ 1.5× the city) or the city share, rarest first", async () => {
  const { plan, base } = await setup();
  const v = { ...austin.venues[NOMADIC], id: NOMADIC };
  const lift = liftModel({ planIds: planIds(plan), venues: { ...base.venues, ...plan.venues }, base, cityName: "Austin" });
  const chips = rarityChips({ venue: v, base, lift, cityName: "Austin" });
  const named = CROWD_TERMS.filter((t) => t.re.test(v.crowd.toLowerCase())).map((t) => t.key).sort();
  assert.deepEqual(chips.map((c) => c.key).sort(), named, "exactly the groups Qloo's crowd text names");
  const sh = cityShares(base);
  for (let i = 1; i < chips.length; i++) assert.ok(chips[i].share >= chips[i - 1].share, "rarest in the city first");
  for (const c of chips) {
    assert.equal(c.share, sh.of[c.key], "the city share is the base's count");
    const row = lift.rows.find((r) => r.key === c.key);
    assert.equal(c.rare, row ? row.lift >= STRONG : c.share <= RARE_MAX, `${c.key}: rare by the lift rule`);
    if (c.rare) assert.equal(c.text, `${Math.max(1, Math.round(c.share * 100))}% of Austin`);
    else assert.match(c.text, /^(most of|common in) Austin$/);
    assert.doesNotMatch(c.text, /\d\.\d/, "no decimals");
  }
  assert.ok(chips.filter((c) => c.rare).length >= 2, "Nomadic has rare groups to say");
  // the portrait's chips are the same function
  const pm = portraitModel({ id: NOMADIC, venue: v, plan, sv: sieve({ route: austin, plan, profile: plan.profile, city: austinCity }), routes: [austin], profile: plan.profile, base, city: austinCity, cityName: "Austin", lift });
  assert.deepEqual(pm.who.chips, chips);
});

test("stop card: with the city base the Crowd entry is the rare chips; without it the crowd line stays", async () => {
  const { plan, base } = await setup();
  const di = plan.days.findIndex((d) => d.stops.some((s) => s.id === NOMADIC));
  const m = stopModel({ plan, id: NOMADIC, dayIndex: di, city: austinCity, routes: [austin], base });
  assert.ok(m.rarity && m.rarity.chips.length >= 2);
  assert.equal(m.rarity.cityName, "Austin");
  assert.equal(m.rarity.baseN, base.ids.length);
  assert.ok(m.rarity.chips.every((c) => c.rare), "only rare groups get a chip");
  assert.ok(m.why.some((l) => /crowd/i.test(l.label)), "Qloo's listing keeps its crowd line");
  const ab = aboutLines(m);
  assert.equal(ab[0].key, "crowd");
  assert.deepEqual(ab[0].chips, m.rarity.chips.map((c) => ({ label: c.label, share: c.text })));
  assert.equal(ab[0].text, m.rarity.chips.map((c) => `${c.label} (${c.text})`).join(" · "), "the drive card reads the same chips as words");
  const m0 = stopModel({ plan, id: NOMADIC, dayIndex: di, city: austinCity, routes: [austin] });
  assert.equal(m0.rarity, null);
  assert.equal(aboutLines(m0)[0].key, "crowd");
  assert.ok(!aboutLines(m0)[0].chips && aboutLines(m0)[0].text.length > 10, "no base: the crowd sentence as before");
  // nothing ordinary gets said: a door whose groups are all common has no Crowd entry, the room line takes the slot
  const ordinary = plan.pool.ids.map((id) => stopModel({ plan, id, dayIndex: null, city: austinCity, routes: [austin], base })).find((x) => x.rarity && x.rarity.all.length && !x.rarity.chips.length);
  if (ordinary) {
    assert.match(ordinary.rarity.line, /none rare in Austin\.$/);
    assert.ok(!aboutLines(ordinary).some((x) => x.key === "crowd"));
  }
});

test("hero: picture 1 for the demo plan, exactly the app's Why home, with two labels", async () => {
  const profile = demoProfile();
  const pool = buildPool({ routes: [austin], profile, contacts: demo.contact ? [demo.contact] : [], cityName: "Austin" });
  const plan = heroPlan({ demo, pool, profile, cityKey: "austin", cityName: "Austin" });
  assert.deepEqual(plan.days.map((d) => d.stops.length), demo.states[0].days.map((d) => d.ids.length));
  const m = heroModel({ route: austin, plan, profile, city: austinCity, cityName: "Austin" });
  assert.equal(m.N, 55);
  assert.equal(m.dots.filter((d) => d.cls === "plan").length, 21);
  assert.equal(m.top.name, "Nomadic Beerworks");
  assert.equal(m.top.popRank, 17);
  assert.equal(m.bigTop, 6);
  assert.equal(m.labels.big, "Most popular: 0.9 and up, left for later");
  assert.equal(m.labels.top, "Nomadic Beerworks · #1 of 55 for Athletic Brewing drinkers, 17th most popular on Your list");
  assert.equal(m.caption.b, "Athletic Brewing drinkers · Austin");
  // the same dots, fates and top door as the explorer over the same sieve (the app's Why home)
  const sv = sieve({ route: austin, plan, profile, city: austinCity });
  const ex = explorerModel({ sv, plan, profile, routes: [austin], famous: false, state: { x: "pop", rooms: profile.rooms }, cityName: "Austin" });
  assert.deepEqual(m.dots.map((d) => [d.id, d.cls === "out" ? "out" : d.cls]), ex.dots.filter((d) => Number.isFinite(d.score) && Number.isFinite(d.pop)).map((d) => [d.id, ["plan", "list", "big"].includes(d.cls) ? d.cls : "out"]));
  assert.ok(m.dots.every((d) => d.pop >= 0 && d.pop <= 1 && Number.isFinite(d.score)));
  assert.ok(m.dots.filter((d) => d.cls === "big").every((d) => d.pop >= m.bigLine), "big names sit past the line");
  // the demo plan as first built: 21 of the 55 on days (the tour's own count)
  const { plan: built } = await setup();
  assert.deepEqual(planIds(plan).sort(), planIds(built).sort());
});
