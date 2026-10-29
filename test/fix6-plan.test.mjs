// Judge pass 5 (#3): a closed-day follow-up's offer. The plan has Fri 23 and Tue 27; Easy Does It is closed Tuesdays
// and its next open day is Thu Oct 29, not one of the rep's days: the offer says so, and the chat's one-tap Move stays
// while the follow-up it would move is still as logged.
import { test } from "node:test";
import assert from "node:assert/strict";
import { route } from "./helpers.mjs";
import { fitFollowUp, fitReply, fitDriveResult, offerLive, altLabel } from "../public/lib/fu-check.js";

const chi = route("lacroix-chicago");
const EASY = "00000000-0000-4000-8000-A969808BC78F"; // closed Mon–Wed, Thu from 5 pm
const BERNIE = "00000000-0000-4000-8000-3E7DDF5A28E4"; // closed Tuesdays
const W = [{ date: "2026-10-23" }, { date: "2026-10-27" }];
const fu = (time, date = "2026-10-27") => ({ result: "interested", followUp: date, ...(time ? { followUpTime: time } : {}) });

test("an offered day that isn't a plan day says so, in the read-back and on the button", () => {
  const r = fitFollowUp(fu("15:00"), chi.venues[EASY], { windows: W });
  assert.deepEqual(r.alt, { date: "2026-10-29", time: "17:00", planDay: false });
  assert.equal(r.text, "Easy Does It is closed Tuesdays (Qloo's hours). Thu Oct 29, 5 pm instead? It isn't one of your plan days, and none comes after it, so the visit isn't on your plan. Add Thu Oct 29 to your days to go then.");
  assert.equal(altLabel(r.alt), "Thu Oct 29, 5 pm (not a plan day)");
  assert.equal(altLabel(r.alt, " instead"), "Thu Oct 29, 5 pm instead (not a plan day)", "drive mode's button");
  const d = fitDriveResult({ ok: true, visit: { status: "visited", outcome: fu("15:00") }, say: "x" }, chi.venues[EASY], { windows: W, next: "Toons" });
  // drive mode (judge pass 6 #2): Save takes the offered day, labelled on the read-back (test/fix11)
  assert.match(d.r.say, /↻ Follow up Thu Oct 29, 5 pm \(not a plan day\)\. It's closed Tuesdays \(Qloo's hours\)\. Next: Toons\.$/);
});

test("a plan day it is open on is offered plainly", () => {
  const r = fitFollowUp(fu("15:00"), chi.venues[BERNIE], { windows: [...W, { date: "2026-10-30" }] });
  assert.deepEqual(r.alt, { date: "2026-10-30", time: "15:00", planDay: true });
  assert.equal(r.text, "Bernie's Tap & Grill is closed Tuesdays (Qloo's hours). Fri Oct 30, 3 pm instead?");
  assert.equal(altLabel(r.alt), "Fri Oct 30, 3 pm");
  // no plan days known (no windows): nothing to compare with, nothing added
  assert.equal(fitFollowUp(fu("15:00"), chi.venues[BERNIE], { windows: [] }).alt.planDay, undefined);
});

test("the chat's Move offer stays live until the follow-up it would move changes", () => {
  const o = fu("15:00");
  const { offers } = fitReply({ reply: "Logged Easy Does It: x.", actions: [{ type: "outcome", id: EASY, outcome: o }] }, chi.venues, { windows: W });
  const [offer] = offers;
  assert.equal(offerLive(offer, { [EASY]: { ...o, note: "liked it" } }), true, "still Tuesday 3 pm, as logged");
  assert.equal(offerLive(offer, { [EASY]: { ...o, followUp: "2026-10-29", followUpTime: "17:00" } }), false, "moved");
  assert.equal(offerLive(offer, { [EASY]: { ...o, followUpTime: "16:00" } }), false, "another time");
  assert.equal(offerLive(offer, {}), false, "undone");
});

// (2026-10-23), on the judge-5 own plan: Wrigleyville North logged "back Tuesday at 3" (→ 4 pm, its opening),
// then The Closet "back Tuesday at 2" (→ 4 pm too). Tuesday dropped Wrigleyville North's follow-up and the toast said
// only "1 new door from Your list, 1 back on Your list". A follow-up is never dropped silently.
const CLOSET = "00000000-0000-4000-8000-7343BA1F1580"; // opens 4 pm Tuesdays
const WRIG = "00000000-0000-4000-8000-8F642B1894ED"; // opens 4 pm Tuesdays
const TUE = "2026-10-27";

test("a follow-up at the time of another one that day offers the next free slot", () => {
  const others = [{ id: WRIG, name: "Wrigleyville North", followUp: TUE, followUpTime: "16:00" }];
  const r = fitFollowUp(fu("14:00"), chi.venues[CLOSET], { windows: W, others });
  assert.equal(r.code, "clash");
  assert.equal(r.outcome.followUpTime, "16:00", "the opening still applies");
  assert.deepEqual(r.alt, { date: TUE, time: "16:40", planDay: true });
  assert.equal(r.text, "The Closet opens 4 pm Tuesday, so the follow-up is at 4 pm. Wrigleyville North's follow-up is at 4 pm Tuesday too: 4:40 pm instead?");
  // its own follow-up isn't another one; another day or no time: no clash
  assert.equal(fitFollowUp(fu("16:00"), chi.venues[WRIG], { windows: W, others }).code, null);
  assert.equal(fitFollowUp(fu("17:00"), chi.venues[CLOSET], { windows: W, others }).code, null);
  assert.equal(fitFollowUp(fu("16:00", "2026-10-26"), chi.venues[CLOSET], { windows: W, others }).code, "offplan", "another day: no clash (Monday isn't a plan day)");
  // drive mode and the chat get the same offer (the chat reads the other follow-ups from the plan's outcomes)
  const d = fitDriveResult({ ok: true, visit: { status: "visited", outcome: fu("14:00") }, say: "x" }, chi.venues[CLOSET], { windows: W, others, next: "Weeds Tavern" });
  assert.deepEqual(d.alt, r.alt);
  assert.match(d.r.say, /Wrigleyville North's follow-up is at 4 pm Tuesday too: 4:40 pm instead\? Next: Weeds Tavern\.$/);
  const c = fitReply({ reply: "Logged The Closet: x.", actions: [{ type: "outcome", id: CLOSET, outcome: fu("14:00") }] }, chi.venues, { windows: W, outcomes: { [WRIG]: { result: "interested", followUp: TUE, followUpTime: "16:00" } } });
  assert.deepEqual(c.offers.map((o) => [o.id, o.alt.time]), [[CLOSET, "16:40"]]);
});

test("the planner keeps both at 4 and 4:40; at 4 and 4 the toast names the follow-up that came off", async () => {
  const { buildPool, windowsFor } = await import("../public/lib/pool.js");
  const { planDays } = await import("../public/lib/schedule.js");
  const { heatFor } = await import("../public/lib/culture.js");
  const { replanSummary } = await import("../public/lib/planview.js");
  const { readJson } = await import("./helpers.mjs");
  const profile = { v: 1, brand: "Kinfolk Kombucha", what: "kombucha", drinks: [{ key: "lacroix", name: "LaCroix", ready: true }], pours: [], city: "chicago", rooms: ["bars", "restaurants", "cafes"], start: { label: "Wicker Park", lat: 41.9088, lon: -87.6796 }, windows: [{ date: "2026-10-23", from: "14:00", to: "18:00" }, { date: TUE, from: "14:00", to: "18:00" }], visitMin: 25, pitch: { name: "Jordan" }, known: [] };
  const heat = heatFor(readJson("public/data/culture/heat.json"), [chi], "chicago");
  const now = { date: "2026-10-23", min: 60 };
  const plan = (statuses, outcomes, previous) => {
    const pool = buildPool({ routes: [chi], profile, statuses, outcomes, cityName: "Chicago", heat });
    const frozen = previous && { date: "2026-10-23", from: 840, ids: previous.days[0].stops.map((s) => s.id) };
    return { ...planDays({ pool: pool.rows, statuses: pool.statuses, windows: windowsFor(profile), visitMin: 25, pinned: pool.pinned, frozen, now, previous }), venues: pool.venues };
  };
  const on = (p, id) => p.days.find((d) => d.date === TUE).stops.some((s) => s.id === id);
  const wrig = { [WRIG]: { result: "interested", followUp: TUE, followUpTime: "16:00" } };
  const first = plan({ [WRIG]: "visited" }, wrig, plan({}, {}, null));
  assert.ok(on(first, WRIG));
  const st = { [WRIG]: "visited", [CLOSET]: "visited" };
  const ok = plan(st, { ...wrig, [CLOSET]: { result: "interested", followUp: TUE, followUpTime: "16:40" } }, first);
  assert.ok(on(ok, WRIG) && on(ok, CLOSET), "4 pm and 4:40 pm both on Tuesday");
  const clash = plan(st, { ...wrig, [CLOSET]: { result: "interested", followUp: TUE, followUpTime: "16:00" } }, first);
  assert.ok(!on(clash, WRIG), "the repro: one of the two comes off");
  assert.match(replanSummary(first, clash, { id: CLOSET, name: "The Closet" }), /Wrigleyville North's follow-up came off Tuesday: it could not be reached in time( ·|$)/);
});

test("a follow-up on a day that isn't a plan day says so, even with the room open (judge-5: 'call next week' → Fri Oct 30)", () => {
  const TOONS = Object.keys(chi.venues).find((id) => /^Toons/.test(chi.venues[id].name));
  const o = { result: "followup", followUp: "2026-10-30", note: "they'll think about it, call next week" };
  const r = fitFollowUp(o, chi.venues[TOONS], { windows: W });
  assert.equal(r.code, "offplan");
  assert.equal(r.outcome, o, "kept as said");
  assert.equal(r.alt, null);
  assert.equal(r.text, "Fri Oct 30 isn't one of your plan days, and none comes after it, so the visit isn't on your plan. Add Fri Oct 30 to your days to go then.");
  const d = fitDriveResult({ ok: true, visit: { status: "visited", outcome: o }, say: "x" }, chi.venues[TOONS], { windows: W, next: "Bernie's Tap & Grill" });
  assert.match(d.r.say, /^Logged Toons Bar & Grill: .*Fri Oct 30 isn't one of your plan days, and none comes after it, so the visit isn't on your plan\. Add Fri Oct 30 to your days to go then\. Next: Bernie's Tap & Grill\.$/);
  const c = fitReply({ reply: "Logged Toons Bar & Grill: x.", actions: [{ type: "outcome", id: TOONS, outcome: o }] }, chi.venues, { windows: W });
  assert.match(c.reply, /Fri Oct 30 isn't one of your plan days/);
  // a plan day, or no plan days known: nothing to say
  assert.equal(fitFollowUp({ ...o, followUp: "2026-10-27" }, chi.venues[TOONS], { windows: W }).code, null);
  assert.equal(fitFollowUp(o, chi.venues[TOONS], { windows: [] }).code, null);
  // hours unknown: still said
  assert.equal(fitFollowUp(o, { name: "Somewhere", hours: null }, { windows: W }).code, "offplan");
});
