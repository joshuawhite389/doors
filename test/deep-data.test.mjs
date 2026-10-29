// Round 3, lane deep: the market-research layer on the real Austin records (data/enrich, the city file, the route files):
// the golden doors Jard named (Pinthouse, Sagebrush, Nomadic, Hold Out), the baked neighbour map, a whole city's sweep,
// and the Agent's door block. NEEDS_DATA (scripts/test.mjs). No network, no model.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, existsSync } from "node:fs";
import { readJson } from "./helpers.mjs";
import { deepFacts, deepFactsFor, deepLines, repCategory, venueMap, DEEP_MAX } from "../public/lib/deep.js";
import { agentContext } from "../public/lib/agent-context.js";
import { talkFacts } from "../public/lib/talk-gen.js";

const enrich = (existsSync(new URL("../data/enrich/austin.json", import.meta.url)) ? readJson("data/enrich/austin.json") : readJson("public/data/enrich/austin.json")).doors;
const slim = readJson("public/data/enrich/austin.json").doors;
const city = readJson("public/data/cities/austin.json");
const route = readJson("public/data/routes/athletic-brewing-austin.json");
const routes = readdirSync(new URL("../public/data/routes", import.meta.url)).filter((f) => f.endsWith("-austin.json")).map((f) => readJson(`public/data/routes/${f}`));
const near = existsSync(new URL("../public/data/deep/austin.json", import.meta.url)) ? readJson("public/data/deep/austin.json").near : null;
const PROFILE = { brand: "Tidewell", what: "Non-alcoholic hazy IPA", drinks: [{ key: "athletic-brewing", name: "Athletic Brewing" }], product: { na: true } };
const plan = { city: { key: "austin", name: "Austin" }, profile: PROFILE, venues: route.venues, days: [], pool: { ids: route.lists.all.map((r) => r[0]), N: route.lists.all.length, label: "Austin bars for Athletic Brewing drinkers" } };
const byName = (n) => Object.keys(enrich).find((id) => enrich[id].name === n);
const PIN = byName("Pinthouse Brewing");
const SAGE = byName("Sagebrush");
const NOMAD = byName("Nomadic Beerworks");
const HOLD = byName("Hold Out Brewing");
const venues = venueMap({ plan, routes, city });
const CTX = { plan, routes: [route], city, venues, near, profile: PROFILE };
const factsOf = (id, recs = enrich) => deepFacts(recs[id], { ...CTX, id, venue: venues[id], enrich: recs });

test("Pinthouse (Jard's example): the gap leads: its crowd sits high for non-alcoholic beer, it brews its own, the only non-alcoholic thing on its site is a root beer float", () => {
  assert.ok(PIN && SAGE && NOMAD && HOLD, "the four golden doors are in the Austin enrich file");
  const f = factsOf(PIN);
  assert.equal(f[0].kind, "gap");
  assert.equal(f[0].label, "The gap: what its crowd buys vs what its site lists");
  assert.match(f[0].text, /Qloo ranks its crowd \d+ of \d+ on your list/);
  assert.match(f[0].text, /the only non-alcoholic item it lists is a root beer float/);
  assert.match(f[0].text, new RegExp(`ranks its crowd \\d+ of ${plan.pool.N} on your list`), "the list's real size (the plan's pool)");
  assert.match(f[0].text, /brews its own beer \(its site\), so a non-alcoholic beer is the one beer it can't make itself/);
  assert.equal(f[0].from, "https://pinthouse.com/");
  assert.ok(!f[0].prep);
  assert.ok(f.some((x) => x.kind === "business" && /happy hour Mon–Fri 3 pm–6 pm/.test(x.text) && /quiet window is weekdays 11 am–2 pm/.test(x.text)), "the owner's week: the quiet window before its 3–6 happy hour");
  const nb = f.find((x) => x.kind === "neighbours");
  assert.ok(nb && nb.prep, "same-crowd doors' sites list a non-alcoholic beer; the line names doors so it is prep");
  assert.match(nb.text, /this one's site \(read 2026-10-25\) lists none/);
});

test("Sagebrush: a whiskey-and-beer crowd that skews older; its site lists no non-alcoholic beer; lesson nights are the owner's programmed crowd", () => {
  const f = factsOf(SAGE);
  const gap = f.find((x) => x.kind === "gap");
  assert.match(gap.text, /nothing on it names non-alcoholic beers/);
  assert.match(gap.why, /doesn't mean the bar has none: ask/);
  const ev = f.find((x) => x.label === "Nights the owner programs");
  assert.match(ev.text, /two-step lessons/i);
  assert.match(ev.why, /Mon, Tue and Sun have a programmed crowd/);
  const occ = f.find((x) => x.kind === "occasion");
  assert.equal(occ.prep, true);
  assert.match(occ.text, /More 55 and over than the city's bars/);
  // a tequila rep at the same door reads the rare tequila brands as the crowd side
  const t = deepFacts(enrich[SAGE], { ...CTX, id: SAGE, venue: venues[SAGE], enrich, profile: { brand: "Sol", what: "Blanco tequila" }, plan: { ...plan, profile: { brand: "Sol", what: "Blanco tequila" } }, routes: [readJson("public/data/routes/casamigos-austin.json")] });
  assert.equal(t[0].kind, "gap");
  assert.match(t[0].text, /tequila brands few bars here share/);
  // a hard seltzer rep sees the headwind
  const w = deepFacts(enrich[SAGE], { ...CTX, id: SAGE, venue: venues[SAGE], enrich, profile: { brand: "Fizz", what: "Hard seltzer" }, plan: { ...plan, profile: { brand: "Fizz", what: "Hard seltzer" } }, routes: [readJson("public/data/routes/white-claw-austin.json")] });
  assert.ok(w.some((x) => x.kind === "headwind" && /whiskey/.test(x.text)));
});

test("Nomadic and Hold Out already list a non-alcoholic beer (Best Day; Rationale): the line says so and the ask becomes the second line", () => {
  const n = factsOf(NOMAD).find((x) => x.kind === "gap");
  assert.equal(n.label, "Already carries the category");
  assert.match(n.text, /already lists a non-alcoholic beer: Best Day/);
  assert.match(n.why, /the style Best Day doesn't cover/);
  const h = factsOf(HOLD);
  const hg = h.find((x) => x.kind === "gap");
  assert.match(hg.text, /already lists a non-alcoholic beer: Rationale/);
  assert.ok(h.some((x) => x.kind === "business" && /happy hour Mon–Fri 3 pm–6 pm/.test(x.text)));
  assert.ok(!h.some((x) => /Al's/.test(x.text)), "no brand read out of 'deals' or 'meals'");
});

test("the slim public record gives the same lines as the full one (the page computes from public/data/enrich)", () => {
  for (const id of [PIN, SAGE, NOMAD, HOLD]) assert.deepEqual(deepLines(factsOf(id, slim)), deepLines(factsOf(id)), enrich[id].name);
});

test("a whole city: every line is traceable, within the cap, decimal-free, prep where it names a brand or a door; doors with nothing stay silent", () => {
  const all = deepFactsFor(enrich, CTX, Object.keys(enrich));
  const ids = Object.keys(all);
  assert.ok(ids.length >= 500, `${ids.length} of ${Object.keys(enrich).length} Austin doors get at least one line`);
  let lines = 0;
  const kinds = {};
  for (const id of ids) {
    const fs = all[id];
    assert.ok(fs.length >= 1 && fs.length <= DEEP_MAX);
    for (let i = 1; i < fs.length; i++) assert.ok(fs[i - 1].score >= fs[i].score, "best first");
    for (const f of fs) {
      lines++;
      kinds[f.kind] = (kinds[f.kind] ?? 0) + 1;
      assert.ok(f.label && f.text && f.why && f.src.length, `${enrich[id].name}: ${f.label}`);
      assert.ok(f.text.length <= 500 && !/\b0\.\d{2}\b/.test(f.text), f.text);
      assert.ok(!/undefined|null|NaN/.test(f.text), f.text);
      if (f.kind === "neighbours" && /:\s|\(same crowd|\(\d/.test(f.text) && !/None of|Nobody/.test(f.text)) assert.equal(f.prep, true, f.text);
      if (f.kind === "occasion") assert.equal(f.prep, true);
      if (f.from) assert.match(f.from, /^https?:\/\//);
    }
  }
  assert.ok(kinds.gap > 200 && kinds.business > 200 && kinds.neighbours > 100, JSON.stringify(kinds));
  // area-basis doors with no site and a weak list rank say nothing about the gap (fewer lines beats filler)
  const silent = Object.keys(enrich).filter((id) => !all[id]);
  assert.ok(silent.every((id) => !enrich[id].site?.ok || enrich[id].qloo?.basis !== "door"), "a door Qloo reads whose website was read always has at least one line");
});

test("the baked neighbour map covers the city and agrees with the live computation on the golden doors", () => {
  assert.ok(near, "public/data/deep/austin.json is baked (scripts/deep-bake.mjs)");
  assert.ok(Object.keys(near).length >= 500);
  for (const id of [PIN, SAGE, NOMAD, HOLD]) {
    assert.ok(near[id]?.length, enrich[id].name);
    for (const [nid, d, sis] of near[id]) { assert.ok(enrich[nid], nid); assert.ok(d == null || d <= 1 || sis === 1); }
    const live = deepFacts(enrich[id], { ...CTX, id, venue: venues[id], enrich, near: null });
    const baked = factsOf(id);
    assert.deepEqual(baked.map((f) => f.kind), live.map((f) => f.kind), enrich[id].name);
  }
});

test("talk-gen and the Agent take the lines: D facts after Qloo's summary (when talk2's slot is there), the Agent's door block leads with the insight and its so-what", () => {
  const deep = deepFactsFor(enrich, CTX, [PIN, NOMAD]);
  const tf = talkFacts({ venue: route.venues[PIN], id: PIN, city, routes: [route], plan, profile: PROFILE, ask: "one case of cans in the cooler", venueType: "brewery", na: true, deep: deepLines(deep[PIN]) });
  const d = tf.facts.filter((f) => f.kind === "deep");
  if (d.length) {
    assert.equal(d[0].id, "D1");
    assert.match(d[0].text, /root beer float/);
    assert.equal(d[0].url, "https://pinthouse.com/");
  }
  const c = agentContext({ plan: { ...plan, days: [{ date: "2026-10-27", from: 11 * 60, to: 17 * 60, stops: [{ id: PIN, eta: 12 * 60 }] }] }, dayIndex: 0, city, routes: [route], enrich, deep, now: new Date("2026-10-27T10:00:00") });
  const door = c.doors[PIN];
  assert.match(door.insight.lines[0], /^Doors' insight: Qloo ranks its crowd \d+ of \d+ on your list/);
  assert.match(door.insight.lines[1], /^So what: It brews its own beer/);
  assert.ok(door.insight.lines.length <= 12 && door.insight.lines.filter((l) => /^(Doors' insight|So what)/.test(l)).every((l) => l.length <= 240), "deep lines fit the Worker's 240-char cut (the enrich lane's own lines are the Worker's to cut)");
  assert.equal(door.insight.site.url, "https://pinthouse.com/");
});
