// The planner's pool from a profile (SPEC-V2 §4 Pool): drinker lists merged, Rooms filter, statuses, contacts,
// follow-ups, famous rooms, windows with per-day starts.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPool, mergeLists, rankedIds, effectiveStatuses, windowsFor, openTill, clockShort, bestAddDay, addedText, notAddedText, dayHolding, freshPrevious, uncappedPrevious } from "../public/lib/pool.js";
import { roomOf } from "../public/lib/profile.js";
import { planDays } from "../public/lib/schedule.js";
import { route } from "./helpers.mjs";

const ab = route("athletic-brewing-austin");
const ld = route("liquid-death-austin");
const START = { label: "E Cesar Chavez St", lat: 30.2556, lon: -97.7208 };
const profile = (over = {}) => ({
  drinks: [{ key: "athletic-brewing", name: "Athletic Brewing", ready: true }],
  rooms: ["bars", "breweries"],
  start: START,
  windows: [{ date: "2026-10-14", from: "13:00", to: "18:00" }, { date: "2026-10-13", from: "14:00", to: "16:00" }],
  visitMin: 25,
  known: [],
  ...over,
});

test("rooms filter: only the picked room types; N and ranks count the rooms after the filter", () => {
  const p = buildPool({ routes: [ab], profile: profile(), cityName: "Austin" });
  assert.ok(p.N > 10 && p.N < ab.lists.all.length, `N ${p.N}`);
  for (const id of p.ids) assert.ok(["bars", "breweries"].includes(roomOf(p.venues[id])));
  assert.deepEqual(p.rows.map((r) => r.rank), p.ids.map((_, i) => i + 1));
  assert.equal(p.label, "Austin bars and breweries for people who drink Athletic Brewing");
  const wide = buildPool({ routes: [ab], profile: profile({ rooms: ["bars", "breweries", "restaurants"] }) });
  assert.ok(wide.N > p.N);
  for (const r of p.rows) assert.ok(Number.isFinite(r.lat) && r.parsedHours && "ok" in r.parsedHours);
});

test("several drinker brands merge round-robin by rank, no repeats, and name both drinkers", () => {
  const m = mergeLists([ab, ld]);
  assert.equal(new Set(m.ids).size, m.ids.length);
  assert.equal(m.ids[0], ab.lists.all[0][0]);
  const second = ld.lists.all.map((r) => r[0]).find((id) => id !== m.ids[0]);
  assert.equal(m.ids[1], second, "the second brand's best door is #2");
  const p = buildPool({ routes: [ab, ld], profile: profile({ drinks: [{ name: "Athletic Brewing", ready: true }, { name: "Liquid Death", ready: true }] }), cityName: "Austin" });
  assert.ok(p.N > buildPool({ routes: [ab], profile: profile() }).N);
  assert.match(p.label, /people who drink Athletic Brewing and Liquid Death$/);
  const toy = mergeLists([{ lists: { all: [["1"], ["2"], ["3"]] }, venues: { 1: {}, 2: {}, 3: {} } }, { lists: { all: [["2"], ["4"]] }, venues: { 2: {}, 4: {} } }]);
  assert.deepEqual(toy.ids, ["1", "2", "4", "3"]);
});

test("famous rooms: the uncapped page merges in by affinity", () => {
  const plain = rankedIds(ab);
  const fam = rankedIds(ab, { famous: true });
  const extra = ab.lists.famous.map((r) => r[0]).filter((id) => !plain.includes(id));
  assert.ok(extra.length > 0);
  assert.equal(fam.length, new Set([...plain, ...extra]).size);
  for (const id of extra) assert.ok(fam.includes(id));
  const aff = new Map([...ab.lists.all, ...ab.lists.famous].map((r) => [r[0], r[1]]));
  for (let i = 1; i < fam.length; i++) assert.ok(aff.get(fam[i - 1]) >= aff.get(fam[i]), `sorted by affinity at ${i}`);
});

test("statuses: known doors read as talked, plan statuses win, a cleared status (Undo) removes it", () => {
  const s = effectiveStatuses({ known: ["a", "b"] }, { b: "visited", c: "notfit", a: null });
  assert.deepEqual(s, { b: "visited", c: "notfit" });
  const p = buildPool({ routes: [ab], profile: profile({ known: [ab.lists.all[0][0]] }) });
  const plan = planDays({ pool: p.rows, statuses: p.statuses, windows: windowsFor(profile()), visitMin: 25 });
  const all = plan.days.flatMap((d) => d.stops.map((x) => x.id));
  assert.ok(!all.includes(ab.lists.all[0][0]), "a door you already know is never scheduled");
});

test("contacts: added to the pool (even outside the rooms filter), pinned, unranked when new, hours unverified", () => {
  const contact = { id: "contact:1", name: "Barbs", lat: 30.262, lon: -97.722, source: "manual", address: "1 Main St" };
  const p = buildPool({ routes: [ab], profile: profile(), contacts: [contact] });
  const row = p.rows.find((r) => r.id === "contact:1");
  assert.equal(row.rank, null);
  assert.equal(row.parsedHours.ok, false);
  assert.equal(p.venues["contact:1"].contact, true);
  assert.deepEqual(p.pinned, [{ id: "contact:1", kind: "contact" }]);
  assert.equal(p.N, buildPool({ routes: [ab], profile: profile() }).N, "a contact does not change N");
  const restaurant = p.ids.length ? Object.values(ab.venues).find((v) => roomOf(v) === "restaurants" && Number.isFinite(v.lat)) : null;
  const q = buildPool({ routes: [ab], profile: profile(), contacts: [{ ...restaurant, source: "qloo" }] });
  assert.ok(q.rows.some((r) => r.id === restaurant.id), "a Qloo contact outside the rooms filter is still in the pool");
  const plan = planDays({ pool: p.rows, statuses: p.statuses, windows: windowsFor(profile()), visitMin: 25, pinned: p.pinned });
  const s = plan.days.flatMap((d) => d.stops).find((x) => x.id === "contact:1");
  assert.ok(s, "the contact is scheduled");
  assert.equal(s.pinned, "contact");
  assert.equal(s.hoursVerified, false);
  assert.equal(openTill(s), "hours unverified");
});

test("follow-ups from outcomes become dated pins", () => {
  const id = ab.lists.all[3][0];
  const p = buildPool({ routes: [ab], profile: profile(), outcomes: { [id]: { result: "followup", followUp: "2026-10-14" }, x: { result: "interested" } } });
  assert.deepEqual(p.pinned, [{ id, kind: "followup", date: "2026-10-14" }]);
});

test("windowsFor: sorted by date, minutes, the day's own start or the profile's, start ids per date", () => {
  const own = { label: "Hotel", lat: 30.27, lon: -97.74 };
  const w = windowsFor(profile({ windows: [{ date: "2026-10-14", from: "13:00", to: "18:00", start: own }, { date: "2026-10-13", from: "14:00", to: "16:00" }] }));
  assert.deepEqual(w.map((x) => [x.date, x.day, x.from, x.to]), [["2026-10-13", "tuesday", 840, 960], ["2026-10-14", "wednesday", 780, 1080]]);
  assert.deepEqual([w[0].start.lat, w[0].start.id, w[0].start.own], [START.lat, "start:2026-10-13", false]);
  assert.deepEqual([w[1].start.lat, w[1].start.own], [own.lat, true]);
});

test("windowsFor (J2): max per day for every day; a saved per-day override is ignored; none or bad = no cap", () => {
  const wins = [{ date: "2026-10-13", from: "14:00", to: "18:00" }, { date: "2026-10-14", from: "13:00", to: "18:00" }];
  assert.deepEqual(windowsFor(profile({ windows: wins })).map((w) => w.max), [null, null], "an old profile: no cap");
  assert.deepEqual(windowsFor(profile({ windows: wins, maxPerDay: 3 })).map((w) => w.max), [3, 3]);
  assert.deepEqual(windowsFor(profile({ windows: wins, maxPerDay: 3, maxByDate: { "2026-10-14": 5 } })).map((w) => w.max), [3, 3]);
  assert.deepEqual(windowsFor(profile({ windows: wins, maxPerDay: null, maxByDate: { "2026-10-13": 2 } })).map((w) => w.max), [null, null]);
  assert.deepEqual(windowsFor(profile({ windows: wins, maxPerDay: 0, maxByDate: { "2026-10-13": "x" } })).map((w) => w.max), [null, null]);
});

test("clockShort / openTill", () => {
  assert.equal(clockShort(1320), "10 pm");
  assert.equal(clockShort(1440), "midnight");
  assert.equal(clockShort(1530), "1:30 am");
  assert.equal(openTill({ hoursVerified: true, openUntil: 1260 }), "open till 9 pm");
  const parsed = { ok: true, days: { tuesday: { closed: false, spans: [{ from: 930, to: 1560 }] } } };
  assert.equal(openTill({ hoursVerified: true, openAtArrival: false, eta: 915 }, { parsed, day: "tuesday" }), "opens 3:30 pm, you'd be early");
  assert.equal(openTill({ hoursVerified: true, openAtArrival: false, eta: 1600 }), "closed when you'd arrive");
});

test("G3 added rooms: a ranked room keeps its rank, a sister room is unranked and hours unverified; both pinned to their date", () => {
  const p0 = buildPool({ routes: [ab], profile: profile() });
  const id = p0.ids.at(-3); // Anderson Mill Pub, low on the list, open Wednesday
  const sister = { id: "sister:1", name: "Austin Beerworks", lat: 30.3795, lon: -97.7297, genre: "urn:tag:genre:place:brewery", address: "3001 Industrial Terrace" };
  const p = buildPool({ routes: [ab], profile: profile(), added: [{ ...p0.venues[id], date: "2026-10-14" }, { ...sister, date: null }] });
  assert.equal(p.rows.find((r) => r.id === id).rank, p0.ids.length - 2);
  assert.equal(p.N, p0.N, "adding does not change N");
  assert.equal(p.venues[id].added, true);
  assert.equal(p.venues[id].hours, p0.venues[id].hours, "the ranked room keeps its own record");
  assert.equal(p.venues["sister:1"].name, "Austin Beerworks");
  assert.equal(p.venues["sister:1"].date, undefined);
  assert.equal(p.rows.find((r) => r.id === "sister:1").rank, null);
  assert.deepEqual(p.pinned, [{ id, kind: "contact", date: "2026-10-14" }, { id: "sister:1", kind: "contact" }]);
  const plan = planDays({ pool: p.rows, statuses: p.statuses, windows: windowsFor(profile()), visitMin: 25, pinned: p.pinned });
  const on = (x) => plan.days.find((d) => d.stops.some((s) => s.id === x));
  assert.equal(on(id)?.date, "2026-10-14");
  const s = on("sister:1")?.stops.find((x) => x.id === "sister:1");
  assert.ok(s, "the sister room is scheduled");
  assert.equal(openTill(s), "hours unverified");
});

test("G3 bestAddDay: lands the room, keeps the most doors, then the better-ranked ones, then drives least, then earliest", () => {
  const day = (date, ids, min = 30, past = false) => ({ date, day: "tuesday", past, min, stops: ids.map((id) => ({ id })) });
  const plan = (days) => ({ days });
  const trials = [
    { date: "a", plan: plan([day("a", ["x", 1, 2]), day("b", [3])]) }, // drops 4
    { date: "b", plan: plan([day("a", [1, 2, 4]), day("b", ["x", 3])]) },
    { date: "c", plan: plan([day("a", [1, 2, 4]), day("c", [3])]) }, // x did not land
  ];
  assert.equal(bestAddDay(trials, "x"), "b");
  const rank = (id) => id;
  const tie = [
    { date: "a", plan: plan([day("a", ["x", 1, 9]), day("b", [3])]) },
    { date: "b", plan: plan([day("a", [1, 2]), day("b", ["x", 3])]) },
  ];
  assert.equal(bestAddDay(tie, "x", { rank }), "b", "keeps #2 rather than #9");
  const same = [
    { date: "b", plan: plan([day("a", [1], 30), day("b", ["x"], 20)]) },
    { date: "a", plan: plan([day("a", ["x", 1], 25), day("b", [], 0)]) },
  ];
  assert.equal(bestAddDay(same, "x", { rank }), "a", "drives least");
  assert.equal(bestAddDay([trials[2]], "x"), null);
});

test("G3 addedText: where it landed, or the planner's reason", () => {
  const plan = { days: [{ day: "tuesday", stops: [{ id: "a" }] }, { day: "wednesday", stops: [{ id: "b" }, { id: "x" }] }], notes: [{ kind: "contact-unscheduled", id: "y", text: "A contact is not on the plan: it is closed Tuesday." }] };
  assert.equal(addedText(plan, "x"), "Added to Wednesday, stop 2.");
  assert.equal(addedText(plan, "y", { day: "tuesday" }), "Not on Tuesday: it is closed Tuesday. It stays on Your list.");
  assert.equal(addedText(plan, "z"), "Not on the plan: it didn't fit any window. It stays on Your list.");
});

test("Jard 10-24 notAddedText / dayHolding: a room no day holds is not added, and the toast says why", () => {
  const plan = { days: [{ day: "monday", stops: [{ id: "a" }] }, { day: "tuesday", stops: [{ id: "x" }] }], notes: [{ kind: "contact-unscheduled", id: "y", text: "A contact is not on the plan: it is closed Monday and Tuesday · opens 7 pm Wednesday, after your window." }] };
  assert.equal(dayHolding(plan, "x"), 1);
  assert.equal(dayHolding(plan, "y"), -1);
  assert.equal(dayHolding(null, "y"), -1);
  assert.equal(notAddedText(plan, "y", { name: "The Thirsty Scholar", onList: true }), "Couldn't add The Thirsty Scholar: it is closed Monday and Tuesday · opens 7 pm Wednesday, after your window. It stays on Your list.");
  assert.equal(notAddedText(plan, "z", { day: "monday", name: "Bar Z" }), "Couldn't add Bar Z to Monday: it didn't fit any window.");
});

test("freshPrevious: keeps the days that ended or started by now (their visits and carry-overs), drops the days ahead", () => {
  const day = (date, from, to, extra = {}) => ({ date, from, to, stops: [{ id: `${date}-${from}` }], ...extra });
  const saved = { days: [day("2026-10-12", 600, 900), day("2026-10-13", 540, 660), day("2026-10-13", 840, 960), day("2026-10-13", 1000, 1100), day("2026-10-14", 600, 900), day("2026-10-15", 600, 900, { past: true })] };
  const keep = (now) => freshPrevious(saved, now).days.map((d) => `${d.date}-${d.from}`);
  // Tuesday 3 pm: Monday ended, Tuesday morning ended, Tuesday afternoon under way; the rest are ahead
  assert.deepEqual(keep({ date: "2026-10-13", min: 900 }), ["2026-10-12-600", "2026-10-13-540", "2026-10-13-840", "2026-10-15-600"]);
  // no clock: only the days the saved plan flags
  assert.deepEqual(freshPrevious(saved).days.map((d) => d.date), ["2026-10-15"]);
  assert.equal(freshPrevious(null, { date: "2026-10-13", min: 0 }), null);
});

test("uncappedPrevious: begun days from the saved plan, the days ahead from the last plan with no limit", () => {
  const saved = { days: [{ date: "2026-10-13", from: 780, past: true, stops: [{ id: "a" }] }, { date: "2026-10-14", from: 840, stops: [{ id: "c" }] }] };
  const base = { days: [{ date: "2026-10-13", from: 780, stops: [{ id: "x" }] }, { date: "2026-10-14", from: 840, stops: [{ id: "c" }, { id: "d" }] }] };
  const p = uncappedPrevious(saved, base, { date: "2026-10-13", min: 900 });
  assert.deepEqual(p.days.map((d) => d.stops.map((s) => s.id)), [["a"], ["c", "d"]]);
  assert.deepEqual(uncappedPrevious(saved, null, { date: "2026-10-13", min: 900 }).days.length, 1); // no base: as fresh
});

// N3: rooms that already pour you: the list is for "regulars like those at …", with any brands named first
test("pour runs: the pool's label and drinker read as the rep's own rooms, never 'people who drink like regulars'", async () => {
  const { rankSentence } = await import("../public/lib/talk.js");
  const { routeWho, isMerged } = await import("../public/lib/stopmodel.js");
  const who = "LaCroix drinkers and regulars like those at Parson's Chicken & Fish";
  const r = { kind: "pour", drinker: { name: "Parson's Chicken & Fish + LaCroix", who, items: [] }, lists: { all: [] }, venues: {} };
  const profile = { rooms: ["bars"], pours: [{ id: "x", name: "Parson's Chicken & Fish" }], drinks: [{ key: "lacroix", name: "LaCroix", ready: true }, { key: "b", name: "B", ready: true }] };
  const pool = buildPool({ routes: [r], profile, cityName: "Austin" });
  assert.equal(pool.drinker, who);
  assert.equal(pool.label, `Austin bars for ${who}`);
  assert.equal(routeWho(r), who);
  assert.equal(isMerged(profile), false, "one blended Qloo list, not a merge");
  assert.equal(rankSentence({ rank: 3, N: 40, city: "Austin", filter: "bars", drinkerName: "regulars like those at Kite String" }), "Qloo ranks this door #3 of 40 Austin bars for regulars like those at Kite String.");
  assert.equal(rankSentence({ rank: 3, N: 40, city: "Austin", filter: "bars", drinkerName: "LaCroix" }), "Qloo ranks this door #3 of 40 Austin bars for people who drink LaCroix.");
});
