// Plan-view words (F3): re-plan summary, overlap sentences, distance suffix, merged rank label, planner reasons;
// start chips, pin label and the sample brand (lib/profile.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { leaveText, replanSummary, overlapLines, miText, rankLabel, orderReason, restReason, unscheduledIds, listRows } from "../public/lib/planview.js";
import { START_CHIPS, startChips, pinLabel, sampleProfile, validateProfile, dayOf } from "../public/lib/profile.js";
import { mergeLists, buildPool, windowsFor } from "../public/lib/pool.js";
import { planDays } from "../public/lib/schedule.js";
import { km } from "../public/lib/core.js";
import { readJson, route, strip } from "./helpers.mjs";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./helpers.mjs";

const index = readJson("public/data/index.json");
const s = (id) => ({ id });
const day = (date, dayName, ids, extra = {}) => ({ date, day: dayName, stops: ids.map(s), ...extra });

test("replanSummary: doors moved up from a later day, new from the list, dropped; the marked door's day leads", () => {
  const prev = { days: [day("2026-10-13", "tuesday", ["x", "a", "b"]), day("2026-10-14", "wednesday", ["c", "d", "e", "f"])], unscheduled: ["n"] };
  const next = { days: [day("2026-10-13", "tuesday", ["a", "b", "c", "d"]), day("2026-10-14", "wednesday", ["e", "n"])], unscheduled: ["f"] };
  assert.equal(
    replanSummary(prev, next, { id: "x", name: "Hi Hat" }),
    "Tuesday re-planned without Hi Hat: 2 doors moved up from Wednesday · Wednesday re-planned: 1 new door from Your list, 1 off the day",
  );
  // the marked door is on Wednesday: Wednesday leads
  const prev2 = { days: [day("2026-10-13", "tuesday", ["a"]), day("2026-10-14", "wednesday", ["x", "b"])] };
  const next2 = { days: [day("2026-10-13", "tuesday", ["a", "c"]), day("2026-10-14", "wednesday", ["b", "d"])] };
  assert.match(replanSummary(prev2, next2, { id: "x" }), /^Wednesday re-planned: 1 new door/);
  // moved from an earlier day reads "moved from", not "up"
  const p3 = { days: [day("2026-10-13", "tuesday", ["a", "b"]), day("2026-10-14", "wednesday", ["c"])] };
  const n3 = { days: [day("2026-10-13", "tuesday", ["a"]), day("2026-10-14", "wednesday", ["c", "b"])] };
  assert.equal(replanSummary(p3, n3), "Wednesday re-planned: 1 door moved from Tuesday");
});

test("replanSummary: nothing else moved → names the marked door; identical → null; past days are skipped", () => {
  const prev = { days: [day("2026-10-13", "tuesday", ["x", "a"])] };
  const next = { days: [day("2026-10-13", "tuesday", ["a"])] };
  assert.equal(replanSummary(prev, next, { id: "x", name: "Hi Hat" }), "Hi Hat is off Tuesday; nothing else moved.");
  assert.equal(replanSummary(prev, prev), null);
  const past = { days: [day("2026-10-13", "tuesday", ["a"], { past: true })] };
  assert.equal(replanSummary({ days: [day("2026-10-13", "tuesday", ["b"])] }, past), null);
  assert.equal(replanSummary({ days: [day("2026-10-13", "tuesday", ["a", "b"])] }, { days: [day("2026-10-13", "tuesday", ["b", "a"])] }), "Tuesday re-planned: same doors, new order");
});

test("replanSummary on a real re-plan: marking stop 1 Not a fit reports what moved", () => {
  const profile = { drinks: [{ key: "athletic-brewing", name: "Athletic Brewing", ready: true }], rooms: ["bars", "breweries"], start: { lat: 30.2556, lon: -97.7208 }, windows: [{ date: "2026-10-13", from: "14:00", to: "18:00" }, { date: "2026-10-14", from: "14:00", to: "18:00" }], visitMin: 25 };
  const pool = buildPool({ routes: [route("athletic-brewing-austin")], profile, cityName: "Austin" });
  const run = (statuses) => planDays({ pool: pool.rows, statuses, windows: windowsFor(profile), visitMin: 25, pinned: pool.pinned });
  const p0 = run({});
  const id = p0.days[0].stops[0].id;
  const p1 = run({ [id]: "notfit" });
  const t = replanSummary(p0, p1, { id, name: pool.venues[id].name });
  assert.ok(t, "something is reported");
  assert.ok(t.startsWith(`Tuesday re-planned without ${pool.venues[id].name}: `) || t === `${pool.venues[id].name} is off Tuesday; nothing else moved.`, t);
});

test("overlapLines: one sentence per other brand, on the merged list, drinkers left out, most shared first", () => {
  const routes = [route("athletic-brewing-austin"), route("liquid-death-austin")];
  const base = mergeLists(routes).ids.slice(0, 50);
  const lines = overlapLines({ strip: strip("austin"), base, brands: index.brands, mine: ["athletic-brewing", "liquid-death"] });
  const shared = lines.filter((l) => l.key !== "none");
  const none = lines.find((l) => l.key === "none");
  assert.equal(shared.length + (none?.names.length ?? 0), index.brands.length - 2);
  assert.ok(!lines.some((l) => ["athletic-brewing", "liquid-death"].includes(l.key)));
  for (const l of shared) assert.match(l.text, new RegExp(`^${l.name} drinkers share [1-9]\\d* of these 50 doors\\.$`), "no 'share 0' rows (R2 Calacanis 17)");
  for (let i = 1; i < shared.length; i++) assert.ok(shared[i - 1].n >= shared[i].n);
  if (none) assert.match(none.text, /^No overlap with .+: a different crowd\.$/);
  assert.ok(lines.filter((l) => l.key === "none").length <= 1 && (!none || lines.at(-1) === none));
  // the merged base differs from Athletic's own top 50 (Diolosa 6)
  const one = overlapLines({ strip: strip("austin"), base: strip("austin").brands["athletic-brewing"].ids, brands: index.brands, mine: ["athletic-brewing"] });
  assert.notDeepEqual(lines.map((l) => l.text), one.map((l) => l.text));
  assert.deepEqual(overlapLines({ strip: null, base }), []);
});

test("miText: every day distance says road or estimated (Diolosa 5)", () => {
  assert.equal(miText({ mi: 11.63, source: "ors" }), "11.6 road mi");
  assert.equal(miText({ mi: 4, source: "estimate" }), "4.0 mi, estimated");
  assert.equal(miText({ mi: 4, source: "mixed" }), "4.0 mi (some estimated)");
  assert.match(miText({ mi: 4 }), /est/);
});

test("rankLabel: one wording, 'on Your list', with one drinker brand or several (Jard 10-24)", () => {
  const plan = { pool: { ids: ["a", "b"], N: 2 }, venues: { c: { contact: true } }, profile: { drinks: [{ key: "x", ready: true }] } };
  assert.equal(rankLabel(plan, "b"), "#2 of 2 on Your list");
  assert.equal(rankLabel(plan, "c"), "not on the ranked list");
  assert.equal(rankLabel(plan, "z"), "");
  const two = { ...plan, profile: { drinks: [{ key: "x", ready: true }, { key: "y", ready: true }] } };
  assert.equal(rankLabel(two, "a"), "#1 of 2 on Your list"); // Jard 10-24: one wording, merged or not
  assert.equal(rankLabel({ ...two, profile: { ...two.profile, venue: "parsons" } }, "a"), "#1 of 2 on Your list");
});

test("planner reasons (F1 shapes), fake data: order reason on a stop, reasons[id].text on a ranked room not scheduled", () => {
  assert.equal(orderReason({ id: "a", orderReason: "opens 3 pm" }), "opens 3 pm");
  assert.equal(orderReason({ id: "a", orderReason: null }), null);
  assert.equal(orderReason({ id: "a", orderReason: "  " }), null);
  const plan = {
    unscheduled: ["a", "b", "c"],
    reasons: {
      a: { code: "opens-after", text: "opens 5 pm, after your window" },
      b: { code: "far", text: "farther than Tuesday's area (6.2 mi)", mi: 6.2, date: "2026-10-13" },
      m: { code: "status", text: "status: not a fit" },
    },
  };
  assert.equal(restReason(plan, "a"), "opens 5 pm, after your window");
  assert.equal(restReason(plan, "b"), "farther than Tuesday's area (6.2 mi)");
  assert.equal(restReason(plan, "c"), null);
  assert.equal(restReason(plan, "m"), null, "a marked door's status tag already says it");
  assert.equal(restReason({ unscheduled: ["a"] }, "a"), null, "no reasons before F1");
  assert.deepEqual(unscheduledIds(plan), ["a", "b", "c"]);
});

test("start chips: 3 per ready city, each inside the city's venue area with ranked rooms within 1 km", () => {
  const venues = {};
  for (const f of readdirSync(join(ROOT, "public/data/routes"))) {
    const c = f.replace(/\.json$/, "").split("-").pop();
    Object.assign((venues[c] ??= {}), JSON.parse(readFileSync(join(ROOT, "public/data/routes", f), "utf8")).venues);
  }
  for (const c of index.cities) {
    const chips = startChips(c.key);
    assert.equal(chips.length, 3, c.key);
    const vs = Object.values(venues[c.key]).filter((v) => Number.isFinite(v.lat));
    const lat = vs.map((v) => v.lat);
    const lon = vs.map((v) => v.lon);
    for (const ch of chips) {
      assert.ok(ch.lat > Math.min(...lat) && ch.lat < Math.max(...lat) && ch.lon > Math.min(...lon) && ch.lon < Math.max(...lon), `${c.key} ${ch.label} in bbox`);
      assert.ok(vs.filter((v) => km(v, ch) < 1).length >= 5, `${c.key} ${ch.label} has rooms nearby`);
      assert.ok(validateProfile({ ...sampleProfile(), city: c.key, start: ch }, { cities: index.cities }).errors.start == null);
    }
  }
  assert.deepEqual(startChips("denver"), []);
});

test("pinLabel: near a chip, in a neighbourhood, else miles from the nearest chip", () => {
  const soco = START_CHIPS.austin[1];
  assert.equal(pinLabel({ lat: soco.lat + 0.001, lon: soco.lon }, "austin"), "Your pin near South Congress");
  // ~1 mi north of Wicker Park, no venues given
  assert.match(pinLabel({ lat: 41.9245, lon: -87.6775 }, "chicago"), /^Your pin, 1\.0 mi from Wicker Park$/);
  const venues = { v: { neighborhood: "Logan Square", lat: 41.9246, lon: -87.6776 } };
  assert.equal(pinLabel({ lat: 41.9245, lon: -87.6775 }, "chicago", venues), "Your pin in Logan Square");
  assert.equal(pinLabel({ lat: 30.2582, lon: -97.7223 }, "austin"), "Your pin near East Austin · E Cesar Chavez");
  assert.equal(pinLabel({ lat: 10, lon: 10 }, "austin"), "Your pin on the map");
});

test("sampleProfile: Tidewell, valid, every Tue + Wed 2–6 pm from next Tuesday, labelled as a sample", () => {
  const p = sampleProfile(new Date(2026, 9, 8)); // a Thursday
  assert.equal(p.brand, "Tidewell");
  assert.equal(p.sample, true);
  // a usual week (lib/week.js): its days that week and the next
  assert.deepEqual(p.windows.map((w) => [w.date, w.from, w.to]), [["2026-10-13", "14:00", "18:00"], ["2026-10-14", "14:00", "18:00"], ["2026-10-20", "14:00", "18:00"], ["2026-10-21", "14:00", "18:00"]]);
  assert.deepEqual(p.windows.map((w) => dayOf(w.date)), ["tuesday", "wednesday", "tuesday", "wednesday"]);
  assert.deepEqual(Object.keys(p.week.days), ["tuesday", "wednesday"]);
  assert.equal(p.week.since, "2026-10-13");
  assert.ok(validateProfile(p, { cities: index.cities }).ok);
  // on a Monday, next Tuesday is tomorrow; on a Tuesday, it's a week out
  assert.equal(sampleProfile(new Date(2026, 9, 12)).windows[0].date, "2026-10-13");
  assert.equal(sampleProfile(new Date(2026, 9, 13)).windows[0].date, "2026-10-20");
  assert.equal(p.start.source, "chip");
});

test('wording: no "people who like X drinkers" anywhere (Diolosa 12)', () => {
  const walk = (d) => readdirSync(join(ROOT, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === "data" ? [] : walk(join(d, e.name))) : /\.(js|html|md)$/.test(e.name) ? [join(d, e.name)] : []));
  for (const f of [...walk("public"), ...walk("src"), "README.md"]) {
    const t = readFileSync(join(ROOT, f), "utf8");
    assert.ok(!/people who like\b/i.test(t), f);
  }
});

test("restReason reads F1's {code, text} reasons", async () => {
  const { restReason } = await import("../public/lib/planview.js");
  const plan = { unscheduled: ["a", "b"], reasons: { a: { code: "opens-after", text: "opens 5 pm, after your window" } } };
  assert.equal(restReason(plan, "a"), "opens 5 pm, after your window");
  assert.equal(restReason(plan, "b"), null);
});

test("F4: a day that leaves later than its window says when, in human time; one that leaves on time says nothing", () => {
  const day = { from: 13 * 60, leave: 15 * 60 + 40, stops: [{ id: "a" }] };
  assert.equal(leaveText(day, "East Austin · E Cesar Chavez"), "Leave 3:40 pm from East Austin · E Cesar Chavez");
  assert.equal(leaveText({ ...day, leave: day.from }, "x"), null);
  assert.equal(leaveText({ ...day, stops: [] }, "x"), null);
  assert.equal(leaveText({ from: 840, stops: [{ id: "a" }] }, "x"), null, "no leave field (an old saved plan): nothing");
});

test("replanSummary (G4): a visit out of order says the current day re-routed from it, and what no longer fits", () => {
  const prev = { days: [day("2026-10-13", "tuesday", ["a", "b", "x", "c", "d"]), day("2026-10-14", "wednesday", ["e"])] };
  const next = { days: [day("2026-10-13", "tuesday", ["x", "c", "b"], { frozen: true }), day("2026-10-14", "wednesday", ["e"])] };
  assert.equal(replanSummary(prev, next, { id: "x", name: "Nomadic Beerworks" }), "Tuesday re-routed from Nomadic Beerworks: 2 no longer fit and came off the day");
  const same = { days: [day("2026-10-13", "tuesday", ["x", "a", "b", "c", "d"], { frozen: true }), day("2026-10-14", "wednesday", ["e"])] };
  assert.equal(replanSummary(prev, same, { id: "x", name: "Nomadic Beerworks" }), "Tuesday re-routed from Nomadic Beerworks");
  // a visit in order is no re-route
  const inOrder = { days: [day("2026-10-13", "tuesday", ["a", "b", "x", "c", "d"], { frozen: true }), day("2026-10-14", "wednesday", ["e"])] };
  assert.equal(replanSummary(prev, inOrder, { id: "x", name: "Nomadic Beerworks" }), null);
});

test("replanSummary (H1): the re-route says which case applied, from the planner's note", () => {
  const prev = { days: [day("2026-10-13", "tuesday", ["a", "b", "x", "c"])] };
  // F9: a day not started keeps its plan, the visit done in place: no re-route to say
  const early = { days: [day("2026-10-13", "tuesday", ["a", "b", "x", "c"], { frozen: true, begun: false })], notes: [] };
  assert.equal(replanSummary(prev, early, { id: "x", name: "Nomadic Beerworks" }), null);
  const now = { days: [day("2026-10-13", "tuesday", ["a", "x", "c"], { frozen: true })], notes: [{ kind: "rerouted", mode: "now", id: "x", date: "2026-10-13", at: 954 }] };
  assert.equal(replanSummary(prev, now, { id: "x", name: "Nomadic Beerworks" }), "Tuesday re-routed from Nomadic Beerworks, from 3:54 pm: 1 no longer fit and came off the day");
});

test("listRows (J4): every ranked room in rank order with its state; marked rooms stay in place; own doors after", () => {
  const plan = {
    pool: { ids: ["a", "b", "c", "d", "e", "f"], N: 6 },
    days: [day("2026-10-13", "tuesday", ["b", "k", "a"]), day("2026-10-14", "wednesday", ["e", "k"])],
    unscheduled: ["c"],
    reasons: { c: { code: "opens-after", text: "opens 5 pm, after your window" }, f: { code: "status", text: "status: not a fit" } },
    statuses: { a: "visited", d: "talked", f: "notfit" },
    venues: { a: {}, b: {}, c: {}, d: {}, e: {}, f: {}, k: { contact: true }, m: { added: true }, z: {} },
  };
  const rows = listRows(plan);
  assert.deepEqual(rows.map((r) => [r.id, r.rank, r.state]), [
    ["a", 1, "visited"], ["b", 2, "day"], ["c", 3, "rest"], ["d", 4, "talked"], ["e", 5, "day"], ["f", 6, "notfit"],
    ["k", null, "day"], ["m", null, "rest"],
  ]);
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));
  assert.deepEqual([by.b.day, by.b.stop], [0, 1], "on Tuesday, stop 1");
  assert.deepEqual([by.a.day, by.a.stop], [0, 3], "a visited stop still says where it is");
  assert.deepEqual([by.e.day, by.e.stop], [1, 1]);
  assert.deepEqual([by.k.day, by.k.stop, by.k.own], [0, 2, true], "a return visit: its first day");
  assert.equal(by.c.reason, "opens 5 pm, after your window");
  assert.equal(by.f.reason, null, "a marked room's status says it");
  assert.equal(by.b.own, false);
  assert.ok(!by.z, "a venue that is neither ranked nor yours is left out");
});

test("listRows (J4): an unknown reason code keeps its text; no text → null; empty plan → []", () => {
  const plan = { pool: { ids: ["a", "b"], N: 2 }, days: [], unscheduled: ["a", "b"], reasons: { a: { code: "cap", text: "Tuesday is at your 5 doors" }, b: { code: "cap" } }, statuses: {}, venues: { a: {}, b: {} } };
  assert.deepEqual(listRows(plan).map((r) => r.reason), ["Tuesday is at your 5 doors", null]);
  assert.deepEqual(listRows({ pool: { ids: [], N: 0 }, days: [], venues: {} }), []);
});

test("listRows (review): a marked room outside the ranked list stays listed, so it can be undone; pins say so and why", () => {
  const plan = {
    pool: { ids: ["a", "f"], N: 2 },
    days: [day("2026-10-13", "tuesday", ["a"])],
    unscheduled: ["k", "f"],
    reasons: { f: { code: "far", text: "farther than Tuesday's area", pinned: true } },
    notes: [{ kind: "contact-unscheduled", id: "k", text: "A contact is not on the plan: closed Tuesday." }],
    statuses: { x: "notfit", y: "talked", gone: "visited" },
    outcomes: { f: { followUp: "2026-10-13" } },
    venues: { a: {}, k: { contact: true }, f: {}, x: { closed: true }, y: {} },
  };
  const by = Object.fromEntries(listRows(plan).map((r) => [r.id, r]));
  assert.deepEqual([by.x.state, by.x.outside, by.x.own], ["notfit", true, true], "closed, marked: listed outside the ranked list");
  assert.deepEqual([by.y.state, by.y.outside], ["talked", true], "out of the Rooms filter, marked");
  assert.ok(!by.gone, "no venue record: nothing to show");
  assert.deepEqual([by.k.state, by.k.pinned, by.k.reason], ["rest", true, "closed Tuesday"], "a contact off the plan: its note's reason");
  assert.equal(by.k.outside, false);
  assert.deepEqual([by.f.own, by.f.pinned, by.f.reason], [false, true, "farther than Tuesday's area"], "a follow-up off its day: pinned, ranked");
  assert.equal(by.a.pinned, false);
});

test("judge pass 3 (N14): a full day said short; a day under way is said once, in the header", async () => {
  const { restReason, underwayNote } = await import("../public/lib/planview.js");
  const plan = { days: [{ day: "tuesday", frozen: true }, { day: "wednesday" }], reasons: { a: { code: "kept", text: "Wednesday has room for it only in place of a stop it already had (a re-plan keeps a day's stops)" }, b: { code: "better", text: "Thursday has room for it only in place of a better-ranked stop, for the same driving" }, c: { code: "full", text: "Wednesday had no time left for it" }, d: { code: "hours", text: "opens 5 pm, after your window" } } };
  assert.equal(restReason(plan, "a"), "Wednesday is full");
  assert.equal(restReason(plan, "b"), "a better-ranked door took Thursday's slot");
  assert.equal(restReason(plan, "c"), "Wednesday is full");
  assert.equal(restReason(plan, "d"), "opens 5 pm, after your window", "no 'Tuesday keeps the stops it has' on every row");
  assert.equal(underwayNote(plan), "Tuesday is under way, so it keeps its stops.");
  assert.equal(underwayNote({ days: [{ day: "tuesday" }, { day: "wednesday" }] }), null);
  // F9: a Friday kept for a visit logged Thursday night isn't under way yet
  assert.equal(underwayNote({ days: [{ day: "thursday" }, { day: "friday", frozen: true, begun: false }] }), null);
  assert.equal(underwayNote({ days: [{ day: "thursday" }, { day: "friday", frozen: true, begun: true }] }), "Friday is under way, so it keeps its stops.");
});

// ease audit #6: a row says why the door is worth a stop (Qloo's crowd text, else its interests; Serves NA for an NA
// brand where Qloo lists NA drinks), never its rank or a 0–1 number
test("doorReason: the row's reason from Qloo's profile, no rank", async () => {
  const { doorReason } = await import("../public/lib/planview.js");
  const { buildPool } = await import("../public/lib/pool.js");
  const { route } = await import("./helpers.mjs");
  const ab = route("athletic-brewing-austin");
  const profile = { brand: "Tidewell", what: "Non-alcoholic hazy IPA", drinks: [{ key: "athletic-brewing", name: "Athletic Brewing", ready: true }], rooms: ["bars", "breweries"], windows: [], visitMin: 25, known: [] };
  const pool = buildPool({ routes: [ab], profile, statuses: {}, outcomes: {}, cityName: "Austin" });
  const plan = { venues: pool.venues, profile };
  const by = (name) => doorReason(plan, pool.ids.find((id) => pool.venues[id].name === name));
  assert.equal(by("Nomadic Beerworks"), "Crowd: local craft beer enthusiasts and young professionals");
  assert.equal(by("Meanwhile Brewing"), "Crowd: local families and young professionals · Serves NA");
  assert.equal(by("Pinthouse Brewing"), "Crowd: into microbreweries and gourmet pizza");
  for (const id of pool.ids) assert.doesNotMatch(doorReason(plan, id), /#\d|\b0\.\d|rank|affinity|\s(of|and|the|from|those)$/, pool.venues[id].name);
  // not an NA brand: no NA tag; a door you added says nothing here (its row says "Added by you")
  assert.doesNotMatch(doorReason({ venues: pool.venues, profile: { ...profile, what: "Hazy IPA" } }, pool.ids.find((id) => pool.venues[id].name === "Meanwhile Brewing")), /NA/);
  assert.equal(doorReason({ venues: { x: { id: "x", name: "Mine", source: "manual" } }, profile }, "x"), "");
});
