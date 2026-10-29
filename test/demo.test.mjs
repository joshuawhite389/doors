// C2 demo: the persona's profile, the baked road data (public/data/demo/demo.json, scripts/bake-demo.mjs) and the beat
// list. A failure in "the bake matches the planner" after a planner change means: re-run node scripts/bake-demo.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { route, readJson } from "./helpers.mjs";
import { demoProfile, demoDates, demoContact, DEMO_CONTACT_ID, DEMO_KNOWN, PERSONA } from "../public/lib/demo-profile.js";
import { demoStates, bakedMatrix, dayCoords, coordsKey, DEMO_ATTRIBUTION, planInput, nowStamp, tourNow } from "../public/lib/demo-plan.js";
import { planOnRoads } from "../public/lib/travel.js";
import { freshPrevious } from "../public/lib/pool.js";
import { STEPS, ACTS, COUNTED, stepAt } from "../public/lib/demo-script.js";
import { validateProfile, dayOf, sampleProfile } from "../public/lib/profile.js";
import { DOOR_MIN } from "../public/lib/schedule.js";

const austin = route("athletic-brewing-austin");
const index = readJson("public/data/index.json");
const demo = readJson("public/data/demo/demo.json");
const run = () => demoStates({ routes: [austin], profile: demoProfile(), contact: demo.contact, fetchMatrix: bakedMatrix(demo.matrix), drive: true });

test("demo dates: the next Tuesday, Wednesday and Thursday, never today or earlier", () => {
  for (let k = 0; k < 14; k++) {
    const today = new Date(2026, 9, 5 + k);
    const ds = demoDates(today);
    assert.deepEqual(ds.map(dayOf), ["tuesday", "wednesday", "thursday"]);
    assert.ok(new Date(`${ds[0]}T00:00`) > today, `${ds[0]} after ${today.toDateString()}`);
    assert.ok(new Date(`${ds[0]}T00:00`) - today <= 7 * 864e5);
  }
});

test("demo profile: valid, labelled fiction, Central District Brewing known, her contact a real venue not on the ranked 100", () => {
  const p = demoProfile();
  assert.equal(validateProfile(p, { cities: index.cities }).ok, true);
  assert.match(PERSONA.fiction, /made up/);
  assert.equal(austin.venues[DEMO_KNOWN.id].name, DEMO_KNOWN.name);
  assert.deepEqual(p.known, [DEMO_KNOWN.id]);
  assert.deepEqual(p.windows.map((w) => [w.from, w.to]), [["13:00", "18:00"], ["14:00", "17:00"], ["14:00", "17:00"]]);
  assert.equal(p.visitMin, 25);
  const v = austin.venues[DEMO_CONTACT_ID];
  assert.ok(v && Number.isFinite(v.lat) && v.image, "contact has coordinates and a photo");
  assert.equal(austin.lists.all.some((r) => r[0] === DEMO_CONTACT_ID), false);
  assert.deepEqual(demo.contact, demoContact(v));
  // one Tidewell: the demo builds on F3's sample brand
  const s = sampleProfile();
  for (const k of ["brand", "what", "drinks", "city", "rooms", "visitMin"]) assert.deepEqual(p[k], s[k], k);
  assert.equal(p.pitch.price, s.pitch.price);
  // F4 showcase search (main's ruling): the East chip, Tue 1–6 / Wed 2–5 / Thu 2–5, Central District Brewing known
  assert.equal(p.start.chip, "east");
  assert.deepEqual([p.start.lat, p.start.lon], [30.2556, -97.7208]);
  assert.equal(DEMO_KNOWN.name, "Central District Brewing");
});

// K1 (driving first, RANK_MIN 10) supersedes Tuesday's mean rank ≤ 15: rank decides between near-equal options only.
// The showcase stays Nomadic Beerworks, #1 for Athletic drinkers, on Tuesday. The demo-only "no crossing legs on Tuesday" goes too: shape is no rule (H1), and on the road matrix the shortest loop
// may cross itself where the straight lines do (the drive pass uncrosses it whenever that is shorter and still open).
test("demo plan: the contact is scheduled, the known room is not, the showcased stop is Nomadic Beerworks #1 on Tuesday, every ranked room off the plan says why", async () => {
  const { states, stop1 } = await run();
  const { plan, pool } = states[0];
  const on = plan.days.flatMap((d) => d.stops.map((s) => s.id));
  assert.ok(on.includes(DEMO_CONTACT_ID), "contact on a day");
  assert.ok(!on.includes(DEMO_KNOWN.id), "Central District Brewing left out");
  const tue = plan.days[0].stops.map((s) => pool.ids.indexOf(s.id) + 1);
  assert.ok(tue.length >= 5, `Tuesday ${tue.length} doors`);
  assert.equal(pool.venues[stop1].name, "Nomadic Beerworks");
  assert.equal(pool.ids.indexOf(stop1) + 1, 1);
  for (const id of pool.ids) {
    if (on.includes(id) || id === DEMO_KNOWN.id) continue;
    assert.ok(plan.reasons[id]?.text, `no reason for #${pool.ids.indexOf(id) + 1}`);
    if (plan.reasons[id].code === "detour") assert.ok(plan.reasons[id].min > DOOR_MIN, plan.reasons[id].text);
  }
  assert.equal(new Set(on).size, on.length, "no door twice");
  assert.ok(plan.days.every((d) => d.stops.length), "every day has doors");
  assert.ok(pool.ids.includes(stop1), "the showcased stop is ranked");
  assert.ok(plan.days[0].stops.some((s) => s.id === stop1), "on Tuesday");
  for (const s of plan.days.flatMap((d) => d.stops)) {
    assert.equal(s.source, "ors", "every leg on the baked road matrix");
    assert.notEqual(s.openAtArrival, false);
  }
});

test("the bake matches the planner: every day the demo shows has its baked road, in stop order", async () => {
  const { states } = await run();
  assert.equal(demo.states.length, states.length);
  for (const [k, s] of states.entries())
    for (const [i, d] of s.plan.days.entries()) {
      assert.deepEqual(d.stops.map((x) => x.id), demo.states[k].days[i].ids, `state ${k} ${d.day}: re-run node scripts/bake-demo.mjs`);
      const key = coordsKey(dayCoords(d, s.pool.venues));
      const road = demo.roads.find((r) => coordsKey([[r.start.lon, r.start.lat], ...r.stops.map((x) => [x.lon, x.lat])]) === key);
      assert.ok(road, `state ${k} ${d.day}: a baked road`);
      assert.deepEqual(road.stops.map((x) => x.id), d.stops.map((x) => x.id));
      assert.equal(road.legs.length, d.stops.length);
      assert.equal(road.wayPoints.length, d.stops.length + 1);
      assert.ok(road.wayPoints.every((w, n) => !n || w >= road.wayPoints[n - 1]), "way points in order");
      assert.ok(road.geometry.coordinates.length > d.stops.length + 1, "real road geometry, not straight lines");
      assert.equal(road.source, "ors");
      assert.equal(road.provider, "osrm");
    }
  assert.equal(demo.attribution, DEMO_ATTRIBUTION);
  assert.deepEqual(demo.problems, [], "every stop open on arrival under the routed legs");
});

test("the visit takes Tuesday's first slot and a door that no longer fits is carried and said; the follow-up lands on Thursday, Tuesday keeps its new order", async () => {
  const { states, stop1, followUp } = await run();
  const [s0, s1, s2] = states;
  // G4/H1 on the tour's clock (tourNow, F9): it is Tuesday at its window's start, so the visit takes its first slot and
  // the rest re-route from there. K1: Tuesday's 10
  // doors are a tight loop, so moving Nomadic Beerworks from stop 7 to stop 1 can leave a door without time: it is
  // carried and the notes say so (was "every door stays"). The Latchkey's day is the planner's call now.
  const t0 = s0.plan.days[0];
  const t1 = s1.plan.days[0];
  assert.equal(t1.frozen, true);
  assert.equal(t1.stops[0].id, stop1, "the visit leads Tuesday");
  assert.equal(t1.stops[0].eta, t0.from + t1.stops[0].legMin, "timed from the window's start");
  for (const s of t1.stops) assert.notEqual(s.openAtArrival, false);
  assert.ok(t0.stops.findIndex((s) => s.id === stop1) > 0, "the showcased stop is not first on Tuesday (the tour asks why it isn't her first stop)");
  const kept = new Set(t1.stops.map((s) => s.id));
  assert.ok(t1.stops.every((s) => t0.stops.some((x) => x.id === s.id)), "no new door on Tuesday");
  const gone = t0.stops.map((s) => s.id).filter((id) => !kept.has(id));
  assert.ok(gone.length <= 1, `${gone.length} doors off Tuesday`);
  assert.deepEqual(s1.plan.carried, gone, "a door off Tuesday is carried");
  if (gone.length) assert.ok(s1.plan.notes.some((n) => n.kind === "carried" && n.ids.join() === gone.join()), "and said");
  assert.ok(s1.plan.notes.some((n) => n.kind === "rerouted" && n.mode === "now" && n.id === stop1));
  assert.equal(t1.begun, true, "her Tuesday is under way in the tour");
  const thu = s2.plan.days.at(-1);
  assert.equal(thu.day, "thursday");
  assert.equal(followUp, thu.date);
  const fu = thu.stops.find((s) => s.id === stop1);
  assert.ok(fu, "the showcased stop is on Thursday");
  // its cost is said: the rooms given up are named by replanCost, so the toast says it (K1 supersedes "at most two": a
  // follow-up is placed whatever it costs; each room it displaces was on a day of the plan before)
  assert.ok(s2.plan.replanCost, "replanCost");
  for (const id of s2.plan.replanCost.droppedIds) assert.ok(s0.plan.days.some((d) => d.stops.some((x) => x.id === id)), id);
  assert.ok(Number.isFinite(s2.plan.replanCost.addedMi), "the toast names the miles"); // K1: was ≤ 5 (H1), ≤ 2.5 before
  assert.equal(fu.pinned, "followup");
  // the demo's week follows the wall clock (the next Tuesday after today: Nov 3–5 from Oct 27), so the note names the
  // plan's own Thursday, not a fixed October one
  const thuWords = new Date(`${thu.date}T12:00`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }).replace(",", "");
  assert.ok(s2.plan.notes.some((n) => n.text === `Follow-up visit on ${thuWords}.`), `the planner says where it landed (${thuWords})`);
  assert.deepEqual(s2.plan.days[0].stops.map((s) => [s.id, s.eta]), t1.stops.map((s) => [s.id, s.eta]), "Tuesday as re-routed");
  assert.equal(s2.plan.days[0].frozen, true);
});

test("the guided demo's steps: well formed, in story order, the visitor clicks the app at the key moments", () => {
  assert.deepEqual(STEPS.map((s) => s.key), ["intro", "drinker", "day", "pitch", "build", "building", "tuesday", "askwhy", "answer", "week", "open", "why", "talk", "shorter", "visit", "outcome", "replan", "back", "drive", "done", "save", "swap", "handoff"]);
  assert.equal(new Set(STEPS.map((s) => s.key)).size, STEPS.length);
  for (const s of STEPS) {
    assert.ok(ACTS.includes(s.act), s.key);
    assert.ok(["profile", "plan"].includes(s.phase), s.key);
    assert.ok(s.title.length > 3 && s.title.length < 40, s.key);
    assert.ok(s.body.length >= 1 && s.body.every((p) => typeof p === "string" && p.length > 10 && p.length < 260), s.key);
    assert.equal(s.act === "click", typeof s.cta === "string" && /^Click /.test(s.cta), `${s.key}: a click step says what to click`);
    // round 8 (Jard 10-28): read at a glance or skimmed: at most 35 words a card (the app's own toast not counted)
    const words = s.body.join(" ").replace(/\{toast\}|\{door\}/g, "").trim().split(/\s+/).filter(Boolean).length;
    assert.ok(words <= 35, `${s.key}: ${words} words`);
    assert.ok(s.title.split(/\s+/).length <= 6, `${s.key}: title ${s.title}`);
  }
  // the profile, folded for R9 (≤ 22 cards): the drinker, where and when, pitch and known doors, then build
  assert.deepEqual(STEPS.filter((s) => s.phase === "profile").map((s) => s.key), ["intro", "drinker", "day", "pitch", "build"]);
  assert.ok(STEPS.filter((s) => s.act === "click").length >= 5, "the visitor does the clicking, not just Continue");
  assert.equal(STEPS.at(-1).act, "end");
  assert.equal(COUNTED, STEPS.length - 1);
  assert.equal(stepAt("visit"), STEPS.findIndex((s) => s.key === "visit"));
  // the fiction is said up front, once: the banner on every card (judge pass 2, 27); no "your drinkers" (the owner's ruling)
  assert.match(PERSONA.fiction, /made up/);
  assert.match(readFileSync(new URL("../public/ui/demo.js", import.meta.url), "utf8"), /class="dfic">\$\{esc\(PERSONA\.fiction\)\}/);
  for (const s of STEPS) assert.doesNotMatch([s.title, ...s.body].join(" "), /your drinkers|already are/i, s.key);
});

test("doors a day (J3): a cap change re-plans fresh: cap 3, then Any, gives back the never-capped plan; the day under way never moves", async () => {
  const { st } = await run();
  const profile = demoProfile();
  const fm = bakedMatrix(demo.matrix);
  const now = nowStamp(); // as on the page
  const plan = async (prof, previous) => (await planOnRoads(planInput({ routes: [austin], profile: prof, st: { ...st, plan: previous }, now }).input, { fetchMatrix: fm, cache: new Map() })).plan;
  const saved = (p) => ({ days: p.days, unscheduled: p.unscheduled, carried: p.carried, notes: p.notes });
  const shape = (p) => p.days.map((d) => d.stops.map((s) => s.id).join());
  const shown = await plan(profile, st.plan); // the plan the demo shows
  const base = await plan(profile, freshPrevious(st.plan)); // never capped, planned fresh
  const capped = await plan({ ...profile, maxPerDay: 3 }, freshPrevious(st.plan));
  assert.ok(capped.days.every((d) => d.frozen || d.stops.length <= 3));
  const any = await plan(profile, freshPrevious(saved(capped)));
  assert.deepEqual(shape(any), shape(base), "Any after a cap = never capped, planned fresh");
  const tue = base.days.findIndex((d) => d.frozen);
  assert.ok(tue >= 0, "the demo has a day under way");
  for (const p of [base, capped, any]) assert.deepEqual(shape(p)[tue], shape(shown)[tue], "the day under way stays as it is");
  assert.deepEqual(freshPrevious(null), null);
  assert.ok(freshPrevious(st.plan).days.every((d) => d.past || d.frozen));
});

// F9 (fix5-plan): the tour's clock. Before a visit, the real clock; once Tuesday is being worked and the real clock is
// before it, Tuesday at its window's start; past that, the real clock again.
test("tourNow: the tour's day is under way once she logs a visit on it, without touching a real day under way", () => {
  const W = [{ date: "2026-10-27", from: 840, to: 1080 }, { date: "2026-10-28", from: 780, to: 1080 }];
  const real = { date: "2026-10-23", min: 1300 };
  assert.deepEqual(tourNow({ current: null }, W, real), real);
  assert.deepEqual(tourNow({ current: { date: "2026-10-27", from: 840 } }, W, real), { date: "2026-10-27", min: 840 });
  assert.deepEqual(tourNow({ current: { date: "2026-10-27" } }, W, { date: "2026-10-27", min: 900 }), { date: "2026-10-27", min: 900 });
  assert.deepEqual(tourNow({ current: { date: "2026-10-20" } }, W, real), real, "a day not in the windows");
});

// Fill by rank (2026-10-23) moved Nomadic from Tuesday's 5th stop to 6th: the tour's "the plan has it as stop 6" line is
// read from the plan it plays, so it says the place the built plan gives #1.
test("the tour's visit line names #1's place on the built Tuesday", async () => {
  const { DEMO_SHOWCASE } = await import("../public/lib/demo-profile.js");
  const { states } = await run();
  const at = states[0].plan.days[0].stops.findIndex((s) => s.id === DEMO_SHOWCASE.id);
  // judge 10 #5: in the door card's own words ("Stop 6 of 10")
  const line = STEPS.flatMap((s) => s.body ?? []).find((b) => /starts Tuesday at Nomadic, though the plan has it as stop/.test(b));
  assert.ok(at > 0, "#1 is not first on the built Tuesday (the tour asks why)");
  // judge 11 #4: and the plan's time for it, the one the door card's timing tip is about
  // judge 12 #4: in the door card's words ("around 3:30 pm"), so the two agree
  const { humanTime } = await import("../public/lib/talk.js");
  assert.match(line, new RegExp(`the plan has it as stop ${at + 1}, ${humanTime(states[0].plan.days[0].stops[at].eta, { ampm: true })}\\. Log the visit`));
});
