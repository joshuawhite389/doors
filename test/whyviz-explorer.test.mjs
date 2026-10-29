// WHY-VIZ-SPEC §4.1 Match × your variables (lib/whyviz/explorer.js) on the demo bake (Maya · Athletic Brewing · Austin):
// the default state is today's sieve exactly; a band re-ranks y and adds the band's own doors; a preview's fates are the
// planner's diff; every number in the sentence is the model's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { route, readJson, city } from "./helpers.mjs";
import { sieve } from "../public/lib/sieve.js";
import { demoProfile } from "../public/lib/demo-profile.js";
import { demoStates, bakedMatrix } from "../public/lib/demo-plan.js";
import { explorerModel, bandRanks, bandsOf, xMode, kmFrom, dotRows, fateText, logistics, logiLine, logiShort, LOGI_FATES } from "../public/lib/whyviz/explorer.js";
import { explorerWords, plain, ordinal } from "../public/lib/whyviz/words.js";

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
  const plan = { ...p, venues: pool.venues, statuses: pool.statuses, pool: { ids: pool.ids }, city: { key: "austin", name: "Austin" } };
  const sv = sieve({ route: austin, plan, profile, city: austinCity });
  return (cache = { plan, sv, profile, start: plan.days[0].start });
}
const model = async (state = {}, preview = null) => { const { plan, sv, profile, start } = await setup(); return explorerModel({ sv, plan, profile, routes: [austin], famous: false, state, preview, start, cityName: "Austin" }); };

test("default: today's Your list and plan exactly, the spec's numbers, the spec's sentence", async () => {
  const { plan, sv } = await setup();
  const m = await model();
  assert.equal(m.N, 55);
  assert.equal(m.E, 55);
  assert.equal(m.plan.length, 21);
  assert.equal(m.table.length, 22, "the plan's 21 ranked doors + the contact");
  assert.equal(m.top.name, "Nomadic Beerworks");
  assert.equal(m.top.popRank, 17);
  assert.equal(m.bigTop, 6);
  assert.equal(m.changed, false);
  assert.equal(plain(m.words), "Nomadic Beerworks is #1 of 55 for Athletic Brewing drinkers and only the 17th most popular door on Your list. 6 of the 10 best matches in Austin are among the city's most popular doors, past the line and off the plan. The plan lives in the open corner: loved by your drinker, not yet crowded with reps.");
  // every dot keeps the sieve's fate; qualifies = on Your list; the classes count up
  const fate = new Map(sv.dots.map((d) => [d.id, d.fate]));
  const pool = new Set(plan.pool.ids);
  for (const d of m.dots) { assert.equal(d.fate, fate.get(d.id), d.name); assert.equal(d.q, pool.has(d.id), d.name); }
  const counts = m.dots.reduce((a, d) => ((a[d.cls] = (a[d.cls] ?? 0) + 1), a), {});
  assert.deepEqual(counts, { plan: 21, list: 34, big: 23, out: 45 });
  assert.equal(m.dots.length, sv.dots.length);
  // the tooltip: name, rank, match to 3 decimals, popularity, rating, fate, qualifies
  const rows = dotRows(m.dots.find((d) => d.id === NOMADIC), m);
  assert.deepEqual(rows.map((r) => r[0]).slice(0, 5), ["Nomadic Beerworks", "#1 of 55", "Well known", "4.9", "On your plan, Tuesday stop 6"] /* round 3: no 0.912 / 0.73 (Jard 10-23) */);
  assert.match(rows.at(-2)[0], /^On your plan, \w+ stop \d+$/);
  assert.equal(rows.at(-1)[0], "Qualifies with these settings");
});

test("an age band: y is Qloo's rank on that band's own page, the band's own doors join as dots, nothing is called off the list", async () => {
  const bands = bandsOf(demoProfile(), [austin]);
  assert.deepEqual(bands.map((b) => b.key), ["under_25", "25_34", "35_44", "45_54", "55_plus"]);
  const r = bandRanks([austin], "25_34");
  assert.deepEqual(r.get(NOMADIC), { rank: 16, of: 38 });
  const m = await model({ band: "25_34" });
  const nom = m.dots.find((d) => d.id === NOMADIC);
  assert.equal(nom.bandRank, 16);
  assert.equal(nom.bandOf, 38);
  assert.equal(nom.faded, false);
  assert.equal(m.E, 55, "without the planner's answer the list is today's");
  const yaya = m.dots.find((d) => d.name === "YaYa Cafe");
  assert.ok(yaya?.bandOnly && yaya.bandRank && !yaya.q, "a door only on the band's page is a dot, not yet on Your list");
  assert.equal(m.dots.filter((d) => d.faded).length, m.dots.filter((d) => !d.bandRank).length);
  assert.match(plain(m.words), /^With these settings 55 doors qualify for Your list \(today: 55\)\. Up is now the rank Qloo gives each door for 25–34 drinkers; faded dots aren't on that list\.$/);
  assert.equal(dotRows(yaya, m)[1][0], "Ranked for 25–34 drinkers only");
  // the merged band page of two drinkers: round-robin, first appearance wins
  const two = bandRanks([austin, { lists: { "25_34": [["x", 0.9], [NOMADIC, 0.8]] } }], "25_34");
  assert.equal(two.get("x").rank, 2);
  assert.equal(two.of, 39);
});

test("a preview: what qualifies is the planner's list, what comes off or joins the plan is the planner's diff", async () => {
  const { plan, sv, profile } = await setup();
  const planIds = plan.days.flatMap((d) => d.stops.map((s) => s.id));
  const gone = planIds.slice(-2), newcomer = sv.dots.find((d) => !plan.pool.ids.includes(d.id) && !d.famous && d.fate === "room");
  const pool = [...plan.pool.ids.filter((id) => !gone.includes(id)), newcomer.id];
  const scratch = { ...plan, days: plan.days.map((d) => ({ ...d, stops: d.stops.filter((s) => !gone.includes(s.id)) })), pool: { ids: pool } };
  const sv2 = sieve({ route: austin, plan: scratch, profile, city: austinCity });
  const diff = { inn: [], out: gone.map((id) => ({ id, day: "tuesday" })), moved: [{ id: planIds[0], from: "tuesday", to: "wednesday" }], mi: [40, 37.4], list: [55, 54], same: false };
  const m = await model({}, { pool, plan: scratch, sv: sv2, diff });
  assert.equal(m.E, 54);
  assert.deepEqual(m.listOut.map((d) => d.id).sort(), gone.sort());
  assert.deepEqual(m.listIn.map((d) => d.id), [newcomer.id]);
  assert.deepEqual(m.planOut.map((d) => d.id).sort(), gone.sort());
  assert.equal(m.moved, 1);
  assert.equal(m.miles, -2.6);
  for (const id of gone) assert.equal(m.dots.find((d) => d.id === id).cls, "off", "on the plan today, comes off: grey with the amber ring");
  assert.equal(m.dots.find((d) => d.id === newcomer.id).cls, "list");
  const names = gone.map((id) => sv.dots.find((d) => d.id === id).name);
  const w = plain(m.words);
  assert.match(w, /^With these settings 54 doors qualify for Your list \(today: 55\)\. 1 would join it, best match first: /);
  for (const n of names) assert.ok(w.includes(n), n);
  assert.match(w, /2 of your 21 plan doors come off: /);
  assert.match(w, /1 door moves to another day\. 2\.6 fewer miles of driving\.$/);
  // the same plan back: nothing changes
  const same = await model({}, { pool: plan.pool.ids, plan, sv, diff: { inn: [], out: [], moved: [], mi: [40, 40], list: [55, 55], same: true } });
  assert.ok(same.nothing);
  assert.match(plain(same.words), /Your plan keeps the same doors on the same days\./);
});

test("rating 4.5 and up is a display filter: greyed and counted, the plan untouched", async () => {
  const m = await model({ r45: true });
  const under = m.dots.filter((d) => d.under);
  assert.ok(under.length > 0 && under.every((d) => d.rating < 4.5 && !d.q));
  assert.equal(m.E, 55 - m.under);
  assert.match(plain(m.words), new RegExp(`${m.under} doors on it rate under 4\\.5 and are greyed out\\.`));
  assert.ok(m.dots.filter((d) => d.onPlan && d.under).every((d) => d.cls === "out"), "a plan door under 4.5 greys, it is not called off the plan");
});

test("the Across axis: how well known, rating, miles from the day's start as the crow flies", async () => {
  const { start } = await setup();
  assert.equal(start.label, "East Austin · E Cesar Chavez");
  const km = await model({ x: "km" });
  assert.equal(km.xmode.key, "km");
  assert.match(km.xmode.label, /^← miles from East Austin · E Cesar Chavez, the day's start, as the crow flies$/);
  assert.equal(km.xmode.ticks.at(-1)[1], "start");
  assert.match(km.xmode.ticks[0][1], /^\d+(\.\d)? mi$/);
  assert.ok(km.dots.every((d) => !Number.isFinite(d.lat) || d.km <= km.xmode.dom[0]), "every dot inside the axis");
  assert.ok(Math.abs(kmFrom({ lat: 30.2556, lon: -97.7308 }, { lat: 30.2556, lon: -97.7208 }) - 0.96) < 0.02);
  const noStart = explorerModel({ sv: (await setup()).sv, plan: (await setup()).plan, profile: demoProfile(), routes: [austin], state: { x: "km" }, start: null });
  assert.equal(noStart.xmode.key, "pop", "no start: back to how well known");
  assert.deepEqual(xMode("rating").dom, [2.8, 5]);
  assert.equal(xMode("pop", { cityName: "Boise" }).label, "How well known in Boise (Qloo popularity) →");
});

test("words: every number the sentence says is one the model produced", async () => {
  const { plan, sv } = await setup();
  const gone = plan.days[1].stops.slice(0, 3).map((s) => s.id);
  const pool = plan.pool.ids.filter((id) => !gone.includes(id));
  const scratch = { ...plan, days: plan.days.map((d) => ({ ...d, stops: d.stops.filter((s) => !gone.includes(s.id)) })), pool: { ids: pool } };
  const m = await model({ band: "35_44", r45: true }, { pool, plan: scratch, sv: sieve({ route: austin, plan: scratch, profile: demoProfile(), city: austinCity }), diff: { inn: [], out: gone.map((id) => ({ id })), moved: [], mi: [40, 35.5], list: [55, 52], same: false } });
  const nums = (plain(m.words).match(/\d+(\.\d+)?/g) ?? []).map(Number);
  const ok = new Set([m.N, m.E, m.listIn.length, m.listOut.length, m.planOut.length, m.planIn.length, m.plan.length, m.moved, Math.abs(m.miles), m.under, 4.5, 35, 44]);
  for (const n of nums) assert.ok(ok.has(n), `${n} in: ${plain(m.words)}`);
  assert.equal(ordinal(1), "1st"); assert.equal(ordinal(2), "2nd"); assert.equal(ordinal(3), "3rd"); assert.equal(ordinal(11), "11th"); assert.equal(ordinal(22), "22nd"); assert.equal(ordinal(113), "113th");
  assert.equal(fateText({ fate: "open" }), "closed when you're out");
  assert.equal(fateText({ fate: "famous" }, null, true), "most popular, included");
});

// round 4 #7 (Jard 10-27): the reasons doors are off the plan, as filters, with the planner's own codes; the list of
// doors that remain; nothing counted that the sieve didn't say
test("logistics: the reasons' counts add up to every ranked door off a day; the codes are the planner's; a picked reason lists its doors, a code narrows them", async () => {
  const { sv, plan } = await setup();
  const m = await model();
  for (const d of m.dots) assert.equal(d.code, sv.dots.find((x) => x.id === d.id)?.code ?? d.code, `${d.name} carries the sieve's code`);
  const L = logistics(m, { days: plan.days.map((d) => d.day), rooms: ["bars", "breweries"] });
  assert.equal(L.active, false);
  assert.deepEqual(L.doors, []);
  const off = m.dots.filter((d) => !d.onNext && d.fate !== "plan" && d.fate !== "kind" && Number.isFinite(d.lat));
  assert.equal(L.offN, off.length);
  assert.equal(L.groups.reduce((t, g) => t + g.n, 0), off.length, "every off door sits in exactly one reason");
  assert.ok(L.groups.every((g) => LOGI_FATES.some((f) => f.key === g.key) && g.n > 0));
  for (const g of L.groups) { assert.equal(g.codes.reduce((t, c) => t + c.n, 0), g.n, `${g.key}'s codes add up`); assert.ok(g.codes.every((c) => c.label && !/^[a-z-]+$/.test(c.label) || c.code === "other"), `${g.key}: codes have words`); }
  const route = L.groups.find((g) => g.key === "route"), open = L.groups.find((g) => g.key === "open"), famous = L.groups.find((g) => g.key === "famous");
  assert.ok(route && route.n >= 5, `route ${route?.n}`);
  assert.ok(famous && famous.n >= 10, `famous ${famous?.n}`);
  const known = L.groups.find((g) => g.key === "known");
  assert.equal(route.n + open.n + (known?.n ?? 0), m.dots.filter((d) => d.listRank && !d.onNext).length, "Your list's doors off a day are exactly the route, open and marked reasons");
  // the planner's reason text rides along on every route/open door
  for (const d of off.filter((x) => x.fate === "route" || x.fate === "open")) assert.ok(d.reason && d.code, `${d.name}: ${d.code} ${d.reason}`);
  // pick route: its doors, on Your list first by rank
  const R = logistics(m, { fates: ["route"], days: plan.days.map((d) => d.day), rooms: ["bars", "breweries"] });
  assert.equal(R.active, true);
  assert.equal(R.doors.length, route.n);
  assert.ok(R.doors.every((d) => d.fate === "route"));
  const ranks = R.doors.map((d) => d.listRank ?? 1e9);
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
  assert.match(logiLine(R.doors[0]), /^#\d+ on Your list · \S/);
  // round 5 #5: the planner's route sentences said short on the rows; nothing else is reworded
  assert.ok(R.doors.every((d) => !/re-plan|has room for it only|had no time left/.test(logiLine(d))), "no long planner sentence on a row");
  assert.equal(logiShort({ code: "full", reason: "Tuesday had no time left for it" }), "Tuesday was full");
  assert.equal(logiShort({ code: "kept", reason: "Thu Oct 29 has room for it only in place of a stop it already had (a re-plan keeps a day's stops)" }), "Thu Oct 29: only by dropping a stop");
  assert.equal(logiShort({ code: "nearer", reason: "the day has room for it only in place of a stop nearer its route" }), "The day: only in place of a nearer stop");
  assert.equal(logiShort({ code: "better", reason: "Wednesday has room for it only in place of a better-ranked stop, for the same driving" }), "Wednesday: only in place of a better-ranked stop");
  assert.equal(logiShort({ code: "idle", reason: "Tuesday is free from 3 pm, but not long enough to get there and visit" }), "Tuesday is free from 3 pm, but not long enough to get there and visit");
  // pick route + famous: both; a code within route narrows route only
  const RF = logistics(m, { fates: ["route", "famous"] });
  assert.equal(RF.doors.length, route.n + famous.n);
  const top = route.codes[0];
  const RC = logistics(m, { fates: ["route", "famous"], codes: [top.code] });
  assert.equal(RC.doors.length, top.n + famous.n, `code ${top.code} (${top.label}) narrows route to ${top.n}, famous stays`);
  assert.ok(RC.groups.find((g) => g.key === "route").codes.every((c) => c.on === (c.code === top.code)));
});
