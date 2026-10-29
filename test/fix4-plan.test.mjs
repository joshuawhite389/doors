// Judge pass 4 (#2, #3) and the drinks-rep persona ("the cap moved a 3 pm follow-up to 4:03"): a follow-up is checked
// against the door's hours when it is logged, and its time holds on the plan, so the read-back, the badge and the
// planned time agree.
import { test } from "node:test";
import assert from "node:assert/strict";
import { route } from "./helpers.mjs";
import { fitFollowUp, nextOpenDay, followUpDay, moveFollowUp } from "../public/lib/fu-check.js";
import { buildPool, windowsFor, FU_SLACK_MIN } from "../public/lib/pool.js";
import { planDays } from "../public/lib/schedule.js";
import { outcomeText } from "../public/lib/outcome.js";
import { emptyProfile, chipStart, START_CHIPS, defaultRooms, dayOf } from "../public/lib/profile.js";

const chi = route("lacroix-chicago");
const EASY = "00000000-0000-4000-8000-A969808BC78F"; // Easy Does It: closed Mon–Wed, Thu from 5 pm
const BERNIE = "00000000-0000-4000-8000-3E7DDF5A28E4"; // Bernie's Tap & Grill: closed Tuesdays
const WRIG = "00000000-0000-4000-8000-8F642B1894ED"; // Wrigleyville North: opens 4 pm Tuesdays
const FRI = "2026-10-23";
const TUE = "2026-10-27";
const W = [{ date: FRI }, { date: TUE }];
const fu = (time, date = TUE) => ({ result: "interested", followUp: date, ...(time ? { followUpTime: time } : {}) });

test("closed that day: kept as said, the read-back says so and offers the next open day (at its opening)", () => {
  const r = fitFollowUp(fu("15:00"), chi.venues[EASY], { windows: W });
  assert.equal(r.code, "closed");
  assert.deepEqual(r.outcome, fu("15:00"), "the rep's day is not changed behind her back");
  assert.deepEqual(r.alt, { date: "2026-10-29", time: "17:00", planDay: false }); // judge pass 5 (#3): not a plan day
  assert.equal(r.text, "Easy Does It is closed Tuesdays (Qloo's hours). Thu Oct 29, 5 pm instead? It isn't one of your plan days, and none comes after it, so the visit isn't on your plan. Add Thu Oct 29 to your days to go then.");
  assert.deepEqual(moveFollowUp(r.outcome, r.alt), { result: "interested", followUp: "2026-10-29", followUpTime: "17:00" });
  // no time said: the next open day, no time
  assert.deepEqual(fitFollowUp(fu(null), chi.venues[BERNIE], { windows: W }).alt.time, null);
});

test("a later plan day it is open on is offered before a calendar day", () => {
  const r = fitFollowUp(fu("15:00"), chi.venues[BERNIE], { windows: [...W, { date: "2026-10-30" }] });
  assert.equal(r.code, "closed");
  assert.equal(r.alt.date, "2026-10-30");
  assert.match(r.text, /^Bernie's Tap & Grill is closed Tuesdays \(Qloo's hours\)\. Fri Oct 30, 3 pm instead\?$/);
});

test("before opening: the time becomes the opening and the read-back says why", () => {
  const r = fitFollowUp(fu("15:00"), chi.venues[WRIG], { windows: W });
  assert.equal(r.code, "early");
  assert.equal(r.outcome.followUpTime, "16:00");
  assert.equal(r.text, "Wrigleyville North opens 4 pm Tuesday, so the follow-up is at 4 pm.");
  assert.match(outcomeText(r.outcome), /Follow up Tue Oct 27, 4 pm/, "the badge says the time it will be");
});

test("open at that time, no follow-up, or hours unknown: nothing changes", () => {
  for (const [o, v] of [[fu("17:00"), chi.venues[WRIG]], [fu(null), chi.venues[WRIG]], [{ result: "no" }, chi.venues[EASY]], [fu("15:00"), { name: "X", hours: null }]]) {
    const r = fitFollowUp(o, v, { windows: W });
    assert.equal(r.code, null);
    assert.equal(r.outcome, o);
    assert.equal(r.text, "");
  }
});

test("drive mode's one-tap Come back: never a day the door is closed", () => {
  const d = followUpDay(chi.venues[BERNIE], { windows: W, from: FRI });
  assert.ok(d && d > FRI && dayOf(d) !== "tuesday", d);
  assert.equal(followUpDay(chi.venues[WRIG], { windows: W, from: FRI }), TUE, "open Tuesday: the plan's next day");
  assert.equal(followUpDay({ hours: null }, { windows: W, from: FRI }), null, "hours unknown: the caller's default");
  assert.equal(nextOpenDay(chi.venues[EASY], { after: TUE, windows: W }).date, "2026-10-29");
});

// The judge's own plan: Kinfolk Kombucha × LaCroix drinkers, Chicago, from Wicker Park, Fri + Tue 2–6 pm.
const what = "Low-sugar kombucha";
const profile = (over = {}) => ({ ...emptyProfile(), brand: "Kinfolk Kombucha", what, drinks: [{ key: "lacroix", name: "LaCroix", ready: true }], city: "chicago", rooms: defaultRooms(what), start: chipStart(START_CHIPS.chicago[1]), windows: [{ date: FRI, from: "14:00", to: "18:00" }, { date: TUE, from: "14:00", to: "18:00" }], visitMin: 25, ...over });
const planWith = (outcomes, over) => {
  const p = profile(over);
  const pool = buildPool({ routes: [chi], profile: p, outcomes, cityName: "Chicago" });
  const windows = windowsFor(p);
  const plan = planDays({ pool: pool.rows, statuses: { ...pool.statuses, ...Object.fromEntries(Object.keys(outcomes).map((k) => [k, "visited"])) }, windows, visitMin: 25, pinned: pool.pinned });
  return plan.days.find((d) => d.date === TUE).stops;
};

test("a follow-up's time holds on the plan: the stop is at that time (within FU_SLACK_MIN), with or without a cap", () => {
  const at = fitFollowUp(fu("15:00"), chi.venues[WRIG], { windows: W }).outcome; // as logged: 4 pm
  for (const over of [{}, { maxPerDay: 4 }]) {
    const s = planWith({ [WRIG]: at }, over).find((x) => x.id === WRIG);
    assert.ok(s, `Wrigleyville North is on Tuesday ${JSON.stringify(over)}`);
    assert.ok(s.eta >= 16 * 60 && s.eta <= 16 * 60 + FU_SLACK_MIN, `eta ${s.eta} ${JSON.stringify(over)}`);
    assert.match(s.orderReason ?? "", /^follow-up at 4 pm/);
  }
  // a time inside the window and the hours, e.g. 5 pm: at 5 pm, not wherever the driving puts it
  const s5 = planWith({ [WRIG]: fu("17:00") }).find((x) => x.id === WRIG);
  assert.ok(s5.eta >= 17 * 60 && s5.eta <= 17 * 60 + FU_SLACK_MIN, `eta ${s5.eta}`);
});

test("judge pass 4 #11 (N21): after the tour Thursday doesn't idle 20 min before The Yard's 3 pm follow-up", async () => {
  const { readJson } = await import("./helpers.mjs");
  const { demoProfile } = await import("../public/lib/demo-profile.js");
  const { demoStates, bakedMatrix } = await import("../public/lib/demo-plan.js");
  const demo = readJson("public/data/demo/demo.json");
  const out = await demoStates({ routes: [route("athletic-brewing-austin")], profile: demoProfile(), contact: demo.contact, fetchMatrix: bakedMatrix(demo.matrix), drive: true });
  const thu = out.states.at(-1).plan.days.at(-1);
  const yard = thu.stops.find((s) => s.id === out.driveDoor);
  assert.equal(yard.eta, 15 * 60, "The Yard at its 3 pm follow-up");
  assert.equal(yard.waitMin, 0, "no idle at the door");
  assert.ok(thu.stops.every((s) => !s.waitMin), thu.stops.map((s) => s.waitMin).join(","));
  assert.ok(thu.leave > thu.from, "the day leaves later instead");
});

test("the chat's read-back: an early time is corrected in the reply and the saved outcome; a closed day adds the offer", async () => {
  const { fitReply, fitDriveResult, movedDriveResult } = await import("../public/lib/fu-check.js");
  const { sayOutcome } = await import("../public/lib/visit-parse.js");
  const o = fu("15:00");
  const r = { reply: `Logged Wrigleyville North: ${sayOutcome(o)}. Next: Kite String.`, actions: [{ type: "status", id: WRIG, status: "visited" }, { type: "outcome", id: WRIG, outcome: o }] };
  const got = fitReply(r, chi.venues, { windows: W });
  assert.equal(got.actions[1].outcome.followUpTime, "16:00");
  assert.equal(got.reply, "Logged Wrigleyville North: ✓ Interested · ↻ Follow up Tue Oct 27, 4 pm. Wrigleyville North opens 4 pm Tuesday, so the follow-up is at 4 pm. Next: Kite String.");
  assert.deepEqual(got.offers, []);
  const c = fitReply({ reply: "Logged Easy Does It: x.", actions: [{ type: "outcome", id: EASY, outcome: o }] }, chi.venues, { windows: W });
  assert.equal(c.reply, "Logged Easy Does It: x. Easy Does It is closed Tuesdays (Qloo's hours). Thu Oct 29, 5 pm instead? It isn't one of your plan days, and none comes after it, so the visit isn't on your plan. Add Thu Oct 29 to your days to go then.");
  assert.equal(c.actions[0].outcome, o);
  assert.deepEqual(c.offers.map((x) => [x.id, x.alt.date]), [[EASY, "2026-10-29"]]);
  // drive mode: the same check on its read-back, and "instead" moves it
  const d = fitDriveResult({ ok: true, visit: { status: "visited", outcome: o }, say: "Logged Easy Does It: …" }, chi.venues[EASY], { windows: W, next: "Bob Inn" });
  // judge pass 6 (#2): Save takes the offered open day, and the read-back leads with it (test/fix11)
  assert.equal(d.r.say, "Logged Easy Does It: ✓ Interested · ↻ Follow up Thu Oct 29, 5 pm (not a plan day). It's closed Tuesdays (Qloo's hours). Next: Bob Inn.");
  assert.equal(movedDriveResult({ ok: true, visit: { status: "visited", outcome: o }, say: "" }, chi.venues[EASY], { date: "2026-10-29", time: "17:00" }, { next: "Bob Inn" }).say, "Logged Easy Does It: ✓ Interested · ↻ Follow up Thu Oct 29, 5 pm. Next: Bob Inn.");
  // nothing to say: untouched
  const ok = { ok: true, visit: { status: "visited", outcome: fu("17:00") }, say: "s" };
  assert.equal(fitDriveResult(ok, chi.venues[WRIG], { windows: W }).r, ok);
});

test("persona (Boise): one room listed twice is one door; two rooms of one chain each say their street", async () => {
  const { buildPool, streetOf } = await import("../public/lib/pool.js");
  const r = route("liquid-death-boise");
  const p = buildPool({ routes: [r], profile: { rooms: ["bars", "breweries", "restaurants"], windows: [] }, cityName: "Boise" });
  const named = (re) => p.ids.filter((id) => re.test(p.venues[id].name));
  assert.equal(named(/^Sakura Sushi$/).length, 1, "Sakura Sushi with and without #138 is one door");
  const ab = named(/^Applebee's/);
  assert.equal(ab.length, 2, "two Applebee's, at two addresses");
  assert.deepEqual(ab.map((id) => p.venues[id].branch).sort(), ["N Eagle Rd", "W Emerald St"]);
  assert.equal(p.venues[named(/^Sakura Sushi$/)[0]].branch, undefined, "a lone room needs no street");
  assert.equal(streetOf("3210 E Chinden Blvd #138 Eagle, ID 83616"), "E Chinden Blvd");
  assert.equal(streetOf("somewhere"), null);
});

test("judge pass 4 #12: a flat list says so once; its rows lose 'Near-level with #1'. A spread list keeps the tier", async () => {
  const { rankLine, flatList, FLAT_NOTE } = await import("../public/lib/planview.js");
  const p = profile();
  const pool = buildPool({ routes: [chi], profile: p, cityName: "Chicago" });
  const plan = { pool: { ids: pool.ids, N: pool.N }, profile: p, venues: pool.venues };
  assert.equal(flatList(plan, [chi]), true, "LaCroix × Chicago: most rooms within 0.02 of #1");
  assert.match(FLAT_NOTE, /nearly the same as #1, so their order is a weak signal here/);
  assert.doesNotMatch(FLAT_NOTE, /\d\.\d/); // judge pass 8 #2: no decimals
  for (const k of [1, 20, 43, 58]) assert.doesNotMatch(rankLine(plan, [chi], pool.ids[k]), /near-level|nearly tied/i, `#${k + 1}`);
  assert.match(rankLine(plan, [chi], pool.ids[43]), /^#44 of \d+ on Your list$/);
  const aus = route("athletic-brewing-austin");
  const ap = { ...profile(), city: "austin", drinks: [{ key: "athletic-brewing", name: "Athletic Brewing", ready: true }], rooms: ["bars", "breweries"] };
  const apool = buildPool({ routes: [aus], profile: ap, cityName: "Austin" });
  assert.equal(flatList({ pool: { ids: apool.ids, N: apool.N }, profile: ap }, [aus]), false, "Athletic × Austin is spread out");
});

test("judge pass 4 #12: a hot-dog stand and a fast-food room with no drinks list are not 'Restaurants with a bar'", async () => {
  const { roomOf } = await import("../public/lib/profile.js");
  const by = (re) => Object.values(chi.venues).find((v) => re.test(v.name));
  assert.equal(roomOf(by(/^Flub A Dub Chub/)), "quick");
  assert.equal(roomOf(by(/^Popeyes/)), "quick");
  assert.equal(roomOf(by(/^Giordano's/)), "restaurants", "a sit-down pizza place with a bar stays");
  assert.equal(roomOf({ genre: "urn:tag:genre:place:restaurant:pizza", tags: { interests: ["Fast food"], bev: ["Beer"] } }), "restaurants", "fast but pours beer: kept");
  const pool = buildPool({ routes: [chi], profile: profile(), cityName: "Chicago" });
  assert.ok(!pool.ids.some((id) => /^Flub A Dub|^Popeyes/.test(pool.venues[id].name)), "off the kombucha list");
});

test("judge pass 4 #15: the building steps name the doors that aren't ranked ('+1 contact')", async () => {
  const { ownExtra } = await import("../public/lib/planview.js");
  const plan = { pool: { ids: ["a", "b"] }, venues: { c: { contact: true, name: "BBG's" }, d: { added: true } }, days: [{ stops: [{ id: "a" }, { id: "c" }] }, { stops: [{ id: "b" }, { id: "a" }] }] };
  assert.equal(ownExtra(plan), "+ BBG's, your contact"); // judge 10: the door by name
  plan.days[1].stops.push({ id: "d" });
  assert.equal(ownExtra(plan), "+2 of your own");
  assert.equal(ownExtra({ ...plan, days: [{ stops: [{ id: "a" }] }] }), "");
});

test("the offered day is a weekday when one is open within two weeks", () => {
  // Easy Does It from Friday: Tue–Wed closed, Sat open, Thu from 5 pm → Thursday, not Saturday
  assert.deepEqual(nextOpenDay(chi.venues[EASY], { after: FRI, t: 15 * 60, windows: [] }), { date: "2026-10-29", time: "17:00" });
  assert.equal(followUpDay(chi.venues[EASY], { windows: W, from: FRI }), "2026-10-29");
});

test("persona: a visit logged at 10 pm is that day's visit, not the next (local stamp, local trace)", async () => {
  const { localStamp } = await import("../public/lib/outcome.js");
  const { visitOf, trace } = await import("../public/lib/slots.js");
  const d = new Date(2026, 9, 22, 22, 5); // Thu Oct 22, 10:05 pm local
  assert.equal(localStamp(d), "2026-10-22T22:05:00");
  assert.equal(visitOf({ outcome: { result: "interested", at: localStamp(d) }, day: { date: "2026-10-22" } }), "first", "same day: not yet a return");
  assert.match(trace({ source: "stated", at: d.toISOString() }), /Thu Oct 22/);
});

test("persona (founder): a stop reached within 30 min of its room opening is labelled; a follow-up's time is not an opening", async () => {
  const { JUST_OPENED_MIN } = await import("../public/lib/schedule.js");
  const { readJson } = await import("./helpers.mjs");
  const { parseHours, openMinutes } = await import("../public/lib/core.js");
  const { demoProfile } = await import("../public/lib/demo-profile.js");
  const { demoStates, bakedMatrix } = await import("../public/lib/demo-plan.js");
  const demo = readJson("public/data/demo/demo.json");
  const aus = route("athletic-brewing-austin");
  const out = await demoStates({ routes: [aus], profile: demoProfile(), contact: demo.contact, fetchMatrix: bakedMatrix(demo.matrix), drive: true });
  const { plan, pool } = out.states.at(-1);
  let n = 0;
  for (const d of plan.days) for (const s of d.stops) {
    const h = parseHours(pool.venues[s.id]?.hours);
    // opened within the half hour before the stop: closed then, open at arrival
    const fresh = h.ok && openMinutes(h, d.day, s.eta - JUST_OPENED_MIN + 1, s.eta) < JUST_OPENED_MIN - 1 && openMinutes(h, d.day, s.eta, s.eta + 1) === 1;
    if (s.id === out.driveDoor && d === plan.days.at(-1)) assert.equal(s.justOpened, null, "The Yard's 3 pm is her time, not its opening");
    else assert.equal(s.justOpened != null, fresh, `${pool.venues[s.id].name} ${d.day} ${s.eta}`);
    if (s.justOpened != null) (n++, assert.ok(s.justOpened >= 0 && s.justOpened < JUST_OPENED_MIN));
  }
  assert.ok(n > 0, "the tour has stops that just opened");
});

test("the form's menu price reaches the margin line (else its typical $7 a can)", async () => {
  const { pitchForTalk, sampleProfile } = await import("../public/lib/profile.js");
  const { marginLine } = await import("../public/lib/ask.js");
  const p = sampleProfile(new Date(2026, 9, 22));
  const talk = (menu) => ({ what: p.what, ...pitchForTalk({ ...p, pitch: { ...p.pitch, ...(menu != null ? { menuPrice: menu } : {}) } }) });
  assert.equal(pitchForTalk(p).menuPrice, undefined);
  assert.match(marginLine(talk(null)).text, /at \$7 on your menu/);
  assert.match(marginLine(talk("$9")).text, /at \$9 on your menu/);
  assert.match(marginLine(talk("  ")).text, /at \$7 on your menu/, "blank: the typical price");
});
