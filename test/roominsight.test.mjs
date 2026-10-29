// G5 · the Qloo room deep-dive (lib/roominsight.js): ranks for the drinker, the age bands and other brands, the music
// guard, sister rooms with why each is or isn't on the route, and the steps that chose the room. Real data, no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPool, windowsFor } from "../public/lib/pool.js";
import { planDays } from "../public/lib/schedule.js";
import { BANNED_PITCH } from "../public/lib/core.js";
import { roomOf } from "../public/lib/profile.js";
import { listRank, rankBar, agesOf, skewOf, drinkersOf, otherBrandFiles, othersOf, musicOf, routeStatus, sistersOf, sisterTally, sisterSummary, sisterOrder, howChosen, roomInsight, venueRecord } from "../public/lib/roominsight.js";
import { restReason } from "../public/lib/planview.js";
import { route, city, readJson } from "./helpers.mjs";

const INDEX = readJson("public/data/index.json");
const ab = route("athletic-brewing-austin");
const ld = route("liquid-death-austin");
const AUSTIN = city("austin");
const NOMADIC = "00000000-0000-4000-8000-271655E6AA28";
const FOXYS = "00000000-0000-4000-8000-3B6CBB5E50FC";
const AB = { key: "athletic-brewing", name: "Athletic Brewing", ready: true };
const LD = { key: "liquid-death", name: "Liquid Death", ready: true };
const CITY_NAMES = { austin: "Austin", boise: "Boise", chicago: "Chicago", omaha: "Omaha" };

function planFor({ routes = [ab], drinks = [AB], statuses = {}, cityKey = "austin", rooms = ["bars", "breweries"] } = {}) {
  const profile = {
    brand: "Tidewell", what: "Non-alcoholic hazy IPA", drinks, rooms, visitMin: 25, known: [],
    start: { lat: 30.2556, lon: -97.7208, label: "E Cesar Chavez St" },
    windows: [{ date: "2026-10-13", from: "14:00", to: "16:00" }, { date: "2026-10-14", from: "13:00", to: "18:00" }],
  };
  if (cityKey !== "austin") {
    const c = INDEX.cities.find((x) => x.key === cityKey);
    profile.start = { lat: c.center[0], lon: c.center[1], label: "centre" };
  }
  const pool = buildPool({ routes, profile, statuses, cityName: CITY_NAMES[cityKey] });
  const p = planDays({ pool: pool.rows, statuses: pool.statuses, windows: windowsFor(profile), visitMin: 25, pinned: pool.pinned });
  return { ...p, venues: pool.venues, pool: { ids: pool.ids, N: pool.N, label: pool.label, drinker: pool.drinker }, statuses: pool.statuses, outcomes: {}, profile, city: { key: cityKey, name: CITY_NAMES[cityKey] } };
}
const plan0 = planFor();

// ---------- the drinker's lists ----------
test("listRank: Qloo's place, affinity and growth from the route rows; absent rooms and lists say so", () => {
  assert.deepEqual(listRank(ab, "all", NOMADIC), { rank: 1, of: ab.lists.all.length, affinity: ab.lists.all[0][1], growth: ab.lists.all[0][2] });
  assert.deepEqual(listRank(ab, "all", "nope"), { rank: null, of: ab.lists.all.length });
  assert.deepEqual(listRank(route("casamigos-austin"), "under_25", NOMADIC), { rank: null, of: route("casamigos-austin").lists.under_25.length }, "r2: 21–24 is fetched for every held brand");
  assert.deepEqual(listRank(route("parsons-austin"), "under_25", NOMADIC), { rank: null, of: route("parsons-austin").lists.under_25.length }, "qloofull (10-27): the room preset carries the age lists too");
  assert.equal(listRank({ lists: { all: [] } }, "under_25", NOMADIC), null, "a route without the list says so");
  assert.equal(rankBar({ rank: 1, of: 100 }), 1);
  assert.equal(rankBar({ rank: null, of: 100 }), 0);
  assert.ok(rankBar({ rank: 100, of: 100 }) > 0 && rankBar({ rank: 100, of: 100 }) < 0.1, "the last place is a sliver, not nothing");
});

test("age bands: the rank in each band Doors fetched, and the skew sentence", () => {
  const ages = agesOf(ab, NOMADIC);
  assert.deepEqual(ages.map((a) => a.key), ["under_25", "25_34", "35_44", "45_54", "55_plus"]);
  const b35 = ages.find((a) => a.key === "35_44");
  assert.equal(b35.rank, ab.lists["35_44"].findIndex((r) => r[0] === NOMADIC) + 1);
  assert.equal(b35.of, ab.lists["35_44"].length);
  const sk = skewOf(ages);
  assert.equal(sk.best.key, "35_44");
  assert.match(sk.text, /^Ranks highest with 35–44 drinkers \(#1 of \d+\); not in the 21–24, 45–54 or 55 and over lists\.$/);
  assert.deepEqual(agesOf(route("casamigos-austin"), NOMADIC).map((a) => a.key), ["under_25", "25_34", "35_44", "45_54", "55_plus"]);
  assert.match(skewOf([{ label: "25–34", rank: null, of: 30 }, { label: "35–44", rank: null, of: 30 }]).text, /^Not in any age band's list/);
  assert.equal(skewOf([{ label: "25–34", rank: 3, of: 30 }]), null, "one band says nothing about skew");
});

test("drinkersOf: one row per drinker list, with how many places Qloo ranked before the food-and-drink filter", () => {
  const [d] = drinkersOf([ab], NOMADIC);
  assert.equal(d.name, "Athletic Brewing");
  assert.equal(d.all.rank, 1);
  assert.equal(d.ranked, ab.lists.all.length + ab.dropped.all.n);
  assert.equal(d.popularityMax, 0.9);
  assert.equal(d.famous.rank, ab.lists.famous.findIndex((r) => r[0] === NOMADIC) + 1);
  assert.equal(drinkersOf([ab, ld], NOMADIC).length, 2);
});

// ---------- other brands ----------
test("other ready brands: every brand in the city but the plan's own, ranked best first, missing ones last", () => {
  const files = otherBrandFiles(INDEX, plan0);
  assert.equal(files.length, INDEX.brands.length - 1);
  assert.ok(files.every((f) => f.file.endsWith("-austin") && f.key !== "athletic-brewing"));
  assert.equal(otherBrandFiles(INDEX, planFor({ routes: [ab, ld], drinks: [AB, LD] })).length, INDEX.brands.length - 2);
  const others = othersOf(files.map((f) => route(f.file)), FOXYS);
  assert.equal(others.length, files.length);
  const ranks = others.map((o) => o.rank ?? Infinity);
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
  for (const o of others.filter((x) => x.rank)) assert.equal(route(`${o.key}-austin`).lists.all[o.rank - 1][0], FOXYS);
});

// ---------- music ----------
test("music: only a list that passed the sound guard is shown; a held list gives the guard's reason and no names", () => {
  const held = musicOf(AUSTIN, NOMADIC);
  assert.equal(held.state, "held");
  assert.deepEqual(held.artists, []);
  assert.match(held.detail, /regional Mexican/);
  const shown = musicOf(AUSTIN, FOXYS);
  assert.equal(shown.state, "shown");
  assert.equal(shown.artists[0].name, AUSTIN.sounds[FOXYS].artists[0].name);
  assert.ok(shown.artists.length <= 8 && shown.genres.length > 0);
  assert.ok(shown.genres.every((g) => g.n >= 1 && g.n <= 10 && !/_/.test(g.name) && g.name !== "all"));
  assert.equal(musicOf(AUSTIN, "not-a-room").state, "none");
});

// ---------- sister rooms: why each is or isn't on the route (owner review 2) ----------
test("routeStatus: on a day, ranked but not scheduled (the planner's reason), marked, outside the rooms, famous, unranked", () => {
  const s = plan0.days[1].stops[1];
  assert.deepEqual(routeStatus(plan0, s.id, [ab]), { kind: "on", dayIndex: 1, n: 2, text: `On Wednesday · stop 2` });
  const rest = plan0.pool.ids.find((id) => plan0.reasons[id]?.text);
  const st = routeStatus(plan0, rest, [ab]);
  assert.equal(st.kind, "ranked");
  assert.equal(st.text, `#${plan0.pool.ids.indexOf(rest) + 1} of ${plan0.pool.N} on Your list, not on a day: ${restReason(plan0, rest)}`); // judge pass 3 (N14): the short form
  const marked = planFor({ statuses: { [NOMADIC]: "notfit" } });
  assert.equal(routeStatus(marked, NOMADIC, [ab]).text, "You marked it not a fit: left out of the plan");
  const rest2 = ab.lists.all.map((r) => r[0]).find((id) => !plan0.pool.ids.includes(id) && !ab.venues[id].closed && !["bars", "breweries"].includes(roomOf(ab.venues[id])));
  assert.match(routeStatus(plan0, rest2, [ab]).text, /^A (restaurant|café|wine bar): you don't pitch (restaurants|cafés|wine bars)$/);
  const famous = ab.lists.famous.map((r) => r[0]).find((id) => !ab.lists.all.some((r) => r[0] === id));
  assert.match(routeStatus(plan0, famous, [ab]).text, /^Very popular: left out unless you include the most popular doors$/);
  assert.equal(routeStatus(plan0, "elsewhere", [ab]).text, "Not in the ranked list for Athletic Brewing drinkers");
  const merged = planFor({ routes: [ab, ld], drinks: [AB, LD] });
  const mrest = merged.pool.ids.find((id) => merged.reasons[id]?.text);
  assert.match(routeStatus(merged, mrest, [ab, ld]).text, /^#\d+ of \d+ on Your list, not on a day: /);
});

test("sistersOf: Qloo's scores in Qloo's order, each with a status; + Add only for rooms off the plan with a location", () => {
  const sis = sistersOf(plan0, AUSTIN, NOMADIC, [ab]);
  const raw = AUSTIN.sisters[NOMADIC];
  assert.ok(sis.length > 5 && sis.length <= raw.length);
  assert.deepEqual(sis.map((s) => s.id), raw.map((r) => r[0]).filter((id) => sis.some((s) => s.id === id)), "Qloo's order");
  for (const s of sis) {
    assert.equal(s.score, raw.find((r) => r[0] === s.id)[1]);
    assert.ok(s.status.text && !/undefined|null|NaN/.test(s.status.text), s.status.text);
    assert.equal(s.addable, s.status.kind !== "on" && s.status.kind !== "marked");
    if (s.addable) assert.ok(Number.isFinite(s.venue.lat) && s.venue.id === s.id);
  }
  assert.ok(sis.some((s) => s.status.kind === "on"), "some sisters are on the route");
  assert.ok(sis.some((s) => s.status.kind !== "on"), "and some are not, each saying why");
  const tally = sisterTally(sis);
  assert.equal(tally.reduce((a, t) => a + t.n, 0), sis.length);
  assert.ok(tally.every((t) => t.n > 0 && t.label));
  assert.equal(sisterTally([{ status: { kind: "famous" } }])[0].label, "most popular door, left out");
  // intuitiveness audit #3: the card's one row, and the page lists the doors on your route first, then the addable ones
  const sum = sisterSummary(sis);
  assert.equal(sum.sub, `${sum.on ? `${sum.on} on your route` : "None on your route"} · All ${sis.length}`);
  assert.equal(sisterSummary([]).sub, "None on your route · All 0");
  const ord = sisterOrder(sis).map((s) => (s.status.kind === "on" ? 0 : s.addable ? 1 : 2));
  assert.deepEqual(ord, [...ord].sort((a, b) => a - b));
  assert.equal(sisterOrder(sis).length, sis.length);
  assert.ok(sis.every((s) => !/popularity cap/.test(s.status.text)), "no 'popularity cap' on a sister");
  // a sister outside every drinker list adds with the city file's record
  const only = Object.keys(AUSTIN.sisterVenues).find((id) => !plan0.venues[id]);
  assert.equal(venueRecord(plan0, AUSTIN, only).name, AUSTIN.sisterVenues[only].name);
});

// ---------- how it was chosen ----------
test("howChosen: Qloo's match with its numbers, the food-and-drink filter, the door types, the route rules", () => {
  const steps = howChosen(plan0, NOMADIC, [ab]);
  assert.deepEqual(steps.map((s) => s.key), ["qloo", "fnb", "rooms", "route"]);
  assert.match(steps[0].text, new RegExp(`^Qloo ranked ${ab.lists.all.length + ab.dropped.all.n} Austin places for Athletic Brewing drinkers, with Athletic Brewing as the signal \\(brand-to-place affinity\\), bar and restaurant tags, the city's most popular doors left out\\. This door: #1\\.$`)); // round 3: no 0.9 cap or 0.912 affinity in words the rep reads
  assert.match(steps[1].text, new RegExp(`^Doors set aside ${ab.dropped.all.n} that aren't bars or restaurants \\(.+\\), leaving ${ab.lists.all.length} in Qloo's order\\.$`));
  assert.equal(steps[2].text, `Kept bars and breweries: ${plan0.pool.N} doors. This one is #1.`);
  // K1 (driving first): #1 is on the plan only when it is worth its driving; else the route step gives the planner's reason
  const on = /^On (Tuesday|Wednesday|Thursday) · stop \d+: open when you arrive \(\d+:\d\d [ap]m, .+\), [\d.]+ (road mi|mi \(estimated\)) from (your start|the stop before), inside your time that day\.$/;
  assert.match(steps[3].text, new RegExp(`${on.source}|^#1 of ${plan0.pool.N} on Your list, not on a day: .+\\.$`));
  const stop = plan0.days.find((d) => d.stops.length).stops[0].id;
  assert.match(howChosen(plan0, stop, [ab]).find((x) => x.key === "route").text, on);
  const merged = planFor({ routes: [ab, ld], drinks: [AB, LD] });
  const ms = howChosen(merged, NOMADIC, [ab, ld]);
  assert.equal(ms.filter((s) => s.key === "qloo").length, 2, "one Qloo step per drinker");
  assert.match(ms.find((s) => s.key === "rooms").text, /merged by taking each one's next door in turn/);
  // a sister room outside every list: the rooms step says it was never on the ranked list
  const only = Object.keys(AUSTIN.sisterVenues).find((id) => !plan0.venues[id]);
  const os = howChosen({ ...plan0, venues: { ...plan0.venues, [only]: AUSTIN.sisterVenues[only] } }, only, [ab]);
  assert.equal(os.find((s) => s.key === "rooms").text, "Kept bars and breweries from the ranked list; this door isn't on it.");
  assert.equal(os.find((s) => s.key === "route").text, "Not in the ranked list for Athletic Brewing drinkers.");
  const un = sistersOf(plan0, AUSTIN, NOMADIC, [ab]).concat(sistersOf(plan0, AUSTIN, FOXYS, [ab])).find((x) => x.status.kind === "unranked");
  assert.equal(un.status.text, "Not in the ranked list for Athletic Brewing drinkers: a similar crowd to this door");
});

// ---------- everything at once, every city ----------
test("roomInsight: every string is filled, honest and free of banned claims, for stops and rest rooms in all four cities", () => {
  let n = 0;
  for (const key of Object.keys(CITY_NAMES)) {
    const routes = [route(`athletic-brewing-${key}`)];
    const plan = planFor({ routes, cityKey: key });
    const c = city(key);
    const others = otherBrandFiles(INDEX, plan).map((f) => route(f.file));
    const ids = [...plan.days.flatMap((d) => d.stops.map((s) => s.id)), ...plan.pool.ids.slice(0, 12)];
    for (const id of new Set(ids)) {
      const ri = roomInsight({ plan, id, city: c, routes, others });
      n++;
      assert.equal(ri.others.length, INDEX.brands.length - 1);
      assert.ok(ri.drinkers[0].all.rank, `${ri.name}: on the drinker's list`);
      const strings = [ri.status.text, ...ri.steps.map((s) => s.text), ...ri.sisters.map((s) => s.status.text), ...ri.drinkers.map((d) => d.skew?.text).filter(Boolean), ri.music.detail];
      for (const t of strings) {
        assert.doesNotMatch(t, /undefined|\bnull\b|NaN|\[object/, `${key} ${ri.name}: ${t}`);
        assert.doesNotMatch(t, /\b(trending|rising|this week|composite)\b/i, t);
      }
      for (const t of ri.steps.map((s) => s.text)) assert.doesNotMatch(t.replaceAll(ri.name, ""), BANNED_PITCH, t);
      if (ri.music.state !== "shown") assert.deepEqual(ri.music.artists, []);
      assert.ok(ri.lines.every((l) => ["customer_demographics_description", "ambience_description", "description"].includes(l.source)));
    }
  }
  assert.ok(n >= 60, `${n} rooms checked`);
});
