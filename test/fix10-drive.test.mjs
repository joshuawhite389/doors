// Judge, phone #7 (web and phone alike): drive mode's read-back is every fact on screen, but read aloud to a driver it
// was a 7-line run-on; and the Done sheet's "Come back" chip offered Thu Oct 29 on a Fri + Tue plan with no word that it
// isn't a plan day (Easy Does It is closed Mon–Wed, so no plan day after Friday is open).
import { test } from "node:test";
import assert from "node:assert/strict";
import { route } from "./helpers.mjs";
import { fitDriveResult, movedDriveResult, driveSpeech, comeBackDay } from "../public/lib/fu-check.js";

const chi = route("lacroix-chicago");
const EASY = "00000000-0000-4000-8000-A969808BC78F"; // Easy Does It: closed Mon–Wed, Thu from 5 pm
const WRIG = "00000000-0000-4000-8000-8F642B1894ED"; // Wrigleyville North: opens 4 pm Tuesdays
const FRI = "2026-10-23";
const TUE = "2026-10-27";
const W = [{ date: FRI }, { date: TUE }];
const fu = (time, date = TUE, extra = {}) => ({ result: "interested", followUp: date, ...(time ? { followUpTime: time } : {}), ...extra });
const res = (outcome) => ({ ok: true, source: "rules", visit: { status: "visited", outcome }, say: "x" });
const one = (s) => assert.equal((s.match(/[.?!](\s|$)/g) ?? []).length, 1, `one sentence: ${s}`);

test("the judge's case: 'back Tuesday at 3' at a room closed Tuesdays is one spoken sentence, the screen keeps it all", () => {
  const r = res(fu("15:00", TUE, { note: "talked to Jen the owner, liked it" }));
  const d = fitDriveResult(r, chi.venues[EASY], { windows: W, next: "Bob Inn" });
  // judge pass 6 (#2): Save takes the offered open day; the screen leads with it (test/fix11)
  assert.match(d.r.say, /^Logged Easy Does It: ✓ Interested · ↻ Follow up Thu Oct 29, 5 pm \(not a plan day\) · Note: .*It's closed Tuesdays \(Qloo's hours\)\. Next: Bob Inn\.$/);
  const s = driveSpeech(d.r, chi.venues[EASY], { windows: W, next: "Bob Inn" });
  assert.equal(s, "Logged Easy Does It: interested, back Thursday, October 29 at 5 pm, not a plan day, as it's closed Tuesdays.");
  one(s);
  assert.ok(s.length < 110, `short: ${s.length}`);
});

test("plain visits: one sentence with what was logged and the next door, no note, no symbols", () => {
  const v = chi.venues[WRIG];
  assert.equal(driveSpeech(res(fu("17:00")), v, { windows: W, next: "Kite String" }), "Logged Wrigleyville North: interested, back Tuesday, October 27 at 5 pm; next, Kite String.");
  assert.equal(driveSpeech(res({ result: "interested", note: "liked the can" }), v, { windows: W, next: "Kite String" }), "Logged Wrigleyville North: interested; next, Kite String.");
  assert.equal(driveSpeech(res(null), v, { windows: W }), "Logged Wrigleyville North: visited.");
  assert.equal(driveSpeech(res({ result: "someone", who: "Jen" }), v, { windows: W }), "Logged Wrigleyville North: talked to Jen.");
  assert.equal(driveSpeech(res({ result: "no" }), v, { windows: W }), "Logged Wrigleyville North: not interested.");
  assert.equal(driveSpeech(res({ result: "followup", followUp: TUE }), v, { windows: W }), "Logged Wrigleyville North: follow up Tuesday, October 27.");
  // after "Make it … instead": the moved day, plainly (a closed day is moved by Save itself now, judge pass 6 #2)
  const m = movedDriveResult(res(fu("15:00")), chi.venues[EASY], { date: "2026-10-29", time: "17:00", planDay: false }, { next: "Bob Inn" });
  assert.equal(driveSpeech(m, chi.venues[EASY], { windows: W, next: "Bob Inn" }), "Logged Easy Does It: interested, back Thursday, October 29 at 5 pm, which isn't a plan day, so add it to your days.");
});

test("every other check is one sentence too: early, off-plan, clash", () => {
  const early = fitDriveResult(res(fu("15:00")), chi.venues[WRIG], { windows: W, next: "Kite String" });
  const se = driveSpeech(early.r, chi.venues[WRIG], { windows: W, next: "Kite String" });
  assert.equal(se, "Logged Wrigleyville North: interested, back Tuesday, October 27 at 4 pm, when it opens; next, Kite String.");
  const sat = fitDriveResult(res(fu(null, "2026-10-24")), chi.venues[EASY], { windows: W });
  const so = driveSpeech(sat.r, chi.venues[EASY], { windows: W });
  assert.equal(so, "Logged Easy Does It: interested, back Saturday, October 24, which isn't a plan day, so the visit goes on Tuesday, October 27.");
  const others = [{ id: "z", name: "Kite String", followUp: TUE, followUpTime: "17:00" }];
  const c = fitDriveResult(res(fu("17:00")), chi.venues[WRIG], { windows: W, others });
  const sc = driveSpeech(c.r, chi.venues[WRIG], { windows: W, others });
  assert.match(sc, /^Kite String's follow-up is at 5 pm Tuesday too: \d{1,2}(:\d{2})? pm instead\?$/);
  for (const s of [se, so, sc]) one(s);
});

test("the Come back chip: the next open plan day; when none is open, the day it offers says it isn't a plan day", () => {
  assert.deepEqual(comeBackDay(chi.venues[WRIG], { windows: W, from: FRI }), { date: TUE, planDay: true });
  // the judge's case: Easy Does It is closed on every plan day after Friday
  assert.deepEqual(comeBackDay(chi.venues[EASY], { windows: W, from: FRI }), { date: "2026-10-29", planDay: false });
  // hours unknown: the next plan day (lib/outcome.js defaultFollowUp)
  assert.deepEqual(comeBackDay({ hours: null }, { windows: W, from: FRI }), { date: TUE, planDay: true });
  // the last plan day: no plan day comes after it
  assert.deepEqual(comeBackDay({ hours: null }, { windows: W, from: TUE }), { date: "2026-10-28", planDay: false });
  // no windows at all (a bare drive): nothing to compare, so not flagged
  assert.deepEqual(comeBackDay({ hours: null }, { windows: [], from: FRI }), { date: "2026-10-26", planDay: true });
});
