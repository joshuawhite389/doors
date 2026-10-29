// Judge pass 6 (#2, #3) and judge pass 5 (#9): a closed-day follow-up in drive mode no longer saves the closed day by
// default, and its read-back leads with what Save stores; the "just opened" tag says when the room opened and only
// tags an arrival within JUST_OPENED_MIN of it (it sat beside "open till 2 am" on 4 of 8 Friday stops).
import { test } from "node:test";
import assert from "node:assert/strict";
import { route } from "./helpers.mjs";
import { fitDriveResult, driveSpeech, keptText } from "../public/lib/fu-check.js";
import { JUST_OPENED_MIN } from "../public/lib/schedule.js";
import { justOpenedTag } from "../public/lib/planview.js";

const chi = route("lacroix-chicago");
const EASY = "00000000-0000-4000-8000-A969808BC78F"; // Easy Does It: closed Mon–Wed, Thu from 5 pm, Fri from 2 pm
const BERNIE = "00000000-0000-4000-8000-3E7DDF5A28E4"; // Bernie's Tap & Grill: closed Tuesdays
const FRI = "2026-10-23";
const TUE = "2026-10-27";
const W = [{ date: FRI }, { date: TUE }];
const fu = (time, date = TUE, extra = {}) => ({ result: "interested", followUp: date, ...(time ? { followUpTime: time } : {}), ...extra });
const res = (outcome) => ({ ok: true, source: "rules", visit: { status: "visited", outcome }, say: "x" });

test("judge 6 #2: on a closed day the default Save stores the offered open day, and the read-back leads with it", () => {
  const d = fitDriveResult(res(fu("15:00", TUE, { note: "talked to Jen the owner, liked it" })), chi.venues[EASY], { windows: W, next: "Toons" });
  const o = d.r.visit.outcome;
  assert.equal(o.followUp, "2026-10-29", "not the closed Tuesday");
  assert.equal(o.followUpTime, "17:00");
  assert.equal(o.note, "talked to Jen the owner, liked it", "her words are kept");
  assert.equal(d.r.say, "Logged Easy Does It: ✓ Interested · ↻ Follow up Thu Oct 29, 5 pm (not a plan day) · Note: talked to Jen the owner, liked it. It's closed Tuesdays (Qloo's hours). Next: Toons.");
  assert.ok(!/Tue Oct 27/.test(d.r.say), "the bad date isn't on screen");
  assert.equal(d.alt, null, "no 'instead' button: Save already takes it");
  // the other choice: no day yet (her words stay in the note)
  const n = d.noDay.visit.outcome;
  assert.equal(n.followUp, undefined);
  assert.equal(n.followUpTime, undefined);
  assert.equal(n.result, "interested");
  assert.equal(d.noDay.say, "Logged Easy Does It: ✓ Interested · Note: talked to Jen the owner, liked it. No follow-up day yet: it's closed Tuesdays (Qloo's hours). Next: Toons.");
  // the toast after Save leads with the stored day too (the phone cut it to "Follow up Tu…")
  assert.match(keptText(d.r.say.replace(/ Next: .*$/, "")), /^Logged Easy Does It: ✓ Interested · ↻ Follow up Thu Oct 29, 5 pm/);
  // spoken: one sentence, the stored day first
  assert.equal(driveSpeech(d.r, chi.venues[EASY], { windows: W, next: "Toons" }), "Logged Easy Does It: interested, back Thursday, October 29 at 5 pm, not a plan day, as it's closed Tuesdays.");
});

test("judge 6 #2: an offered plan day reads plainly; no open day known saves no day", () => {
  const d = fitDriveResult(res(fu("15:00")), chi.venues[BERNIE], { windows: [...W, { date: "2026-10-30" }], next: "Toons" });
  assert.equal(d.r.visit.outcome.followUp, "2026-10-30");
  assert.equal(d.r.say, "Logged Bernie's Tap & Grill: ✓ Interested · ↻ Follow up Fri Oct 30, 3 pm. It's closed Tuesdays (Qloo's hours). Next: Toons.");
  assert.equal(driveSpeech(d.r, chi.venues[BERNIE], { windows: [...W, { date: "2026-10-30" }], next: "Toons" }), "Logged Bernie's Tap & Grill: interested, back Friday, October 30 at 3 pm, as it's closed Tuesdays; next, Toons.");
  // a room with hours that never fit a visit: nothing to offer, so Save keeps no day (never the closed one)
  const shut = { name: "Shut Bar", hours: Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((k) => [k, [{ opens: null, closed: true, closes: null }]])) };
  const s = fitDriveResult(res(fu("15:00")), shut, { windows: W });
  assert.equal(s.r.visit.outcome.followUp, undefined);
  assert.equal(s.noDay, null);
  assert.equal(s.r.say, "Logged Shut Bar: ✓ Interested. No follow-up day yet: it's closed Tuesdays (Qloo's hours).");
});

test("judge 6 #3 / judge 5 #9: the tag names the opening, and only an arrival within the window gets it", () => {
  assert.equal(JUST_OPENED_MIN, 20);
  assert.equal(justOpenedTag({ eta: 14 * 60 + 7, justOpened: 7 }), "Just after opening: keep it short");
  assert.equal(justOpenedTag({ eta: 17 * 60 + 15, justOpened: 15 }), "Just after opening: keep it short");
  assert.equal(justOpenedTag({ eta: 17 * 60 + 27, justOpened: null }), null);
  assert.equal(justOpenedTag(null), null);
});

test("judge 6 #2: shut for the rest of the day after the time reads the same way", () => {
  const early = { name: "Early Bar", hours: { thursday: [{ opens: "T11:00:00", closed: false, closes: "T15:00:00" }], friday: [{ opens: "T11:00:00", closed: false, closes: "T15:00:00" }] } };
  // no later day is open at 11:59 pm either: no day, never the impossible one
  const d = fitDriveResult(res(fu("23:59", "2026-10-29")), early, { windows: W });
  assert.equal(d.r.say, "Logged Early Bar: ✓ Interested. No follow-up day yet: it isn't open after 11:59 pm Thursday (Qloo's hours).");
  assert.equal(d.r.visit.outcome.followUp, undefined);
  assert.equal(driveSpeech(d.r, early, { windows: W }), "Logged Early Bar: interested, no follow-up day yet, as it isn't open after 11:59 pm Thursday.");
});

test("judge 6 #4: the web form's Clear shows only when there is something to clear (as the phone's)", async () => {
  const { readFileSync } = await import("node:fs");
  const { formFilled, emptyProfile } = await import("../public/lib/profile.js");
  assert.equal(formFilled(emptyProfile()), false);
  assert.equal(formFilled({ ...emptyProfile(), brand: "Kinfolk Kombucha" }), true);
  assert.equal(formFilled({ ...emptyProfile(), city: "chicago" }), true);
  const ui = readFileSync(new URL("../public/ui/profile.js", import.meta.url), "utf8");
  assert.match(ui, /id="f-clear"\$\{formFilled\(p\) \? "" : " inert"\}/);
  assert.match(ui, /clr\.inert = !formFilled\(p\)/);
  // Jard 10-23: kept in the layout while empty (invisible + inert), so its appearing moves nothing
  const css = readFileSync(new URL("../public/css/doors.css", import.meta.url), "utf8");
  assert.match(css, /#f-clear\[inert\]\{visibility:hidden\}/);
  assert.doesNotMatch(css, /#f-clear\[hidden\]/);
});

test("judge 6 #5: Skip to the finished plan is the walked tour's end (the drive step's follow-up too)", async () => {
  const { readFileSync } = await import("node:fs");
  const { readJson } = await import("./helpers.mjs");
  const { demoProfile } = await import("../public/lib/demo-profile.js");
  const { demoStates, bakedMatrix } = await import("../public/lib/demo-plan.js");
  const demo = readJson("public/data/demo/demo.json");
  const out = await demoStates({ routes: [route("athletic-brewing-austin")], profile: demoProfile(), contact: demo.contact, fetchMatrix: bakedMatrix(demo.matrix), drive: true });
  const { plan } = out.states.at(-1);
  const { weekCount } = await import("../public/lib/planview.js");
  assert.equal(weekCount(plan.days), "18 doors over 3 days, plus 2 return visits", "the README Week image's numbers");
  assert.equal(plan.days.at(-1).stops.length, 5, "Thu 5");
  const ui = readFileSync(new URL("../public/ui/demo.js", import.meta.url), "utf8");
  assert.match(ui, /judge pass 6 \(#5\).*\n\s*const \{ st \} = await demoStates\(\{[^\n]*drive: true \}\);/);
});

test("judge 6 #7: the rules path moves a named door to a plan day ('can you move X to Thursday'), and says when a day isn't one", async () => {
  const { demoContext } = await import("./agent-fixture.mjs");
  const { answerByRules } = await import("../public/lib/agent-rules.js");
  const { runTool } = await import("../public/lib/agent-tools.js");
  const { plan, ctx } = await demoContext();
  const [tue, , thu] = plan.days;
  const id = tue.stops[1].id;
  const name = plan.venues[id].name;
  const r = answerByRules([{ role: "user", text: `can you move ${name} to Thursday` }], ctx);
  assert.deepEqual(r.actions, [{ type: "replan", skip: [], endBy: null, startNow: false, maxDoors: null, lock: [], add: [], day: null, move: [{ id, date: thu.date }] }]);
  assert.equal(r.reply, `Asking the planner to move ${name} to Thursday.`);
  // a weekday the plan has no day for: said, nothing changes
  const sat = answerByRules([{ role: "user", text: `move ${name} to saturday please` }], ctx);
  assert.equal(sat.actions?.length ?? 0, 0);
  assert.match(sat.reply, /^Saturday isn't one of your plan days \(Tuesday, Wednesday, Thursday\)/);
  // the tool checks the day and the door (the model's path)
  assert.equal(runTool("replan", { move: [{ door_id: id, day: "2026-01-01" }] }, ctx).ok, false);
  assert.equal(runTool("replan", { move: [{ door_id: "nope", day: thu.date }] }, ctx).ok, false);
  // the old shape is unchanged when nothing moves
  assert.equal("move" in runTool("replan", { skip: [id] }, ctx).actions[0], false);
});

test("judge 6 #7: a visit that says 'put it on for Friday' is still a visit", async () => {
  const { demoContext } = await import("./agent-fixture.mjs");
  const { answerByRules } = await import("../public/lib/agent-rules.js");
  const { ctx } = await demoContext({ current: "first" });
  const r = answerByRules([{ role: "user", text: "done, liked it, they might put it on for thursday" }], ctx);
  assert.ok(r.actions.some((a) => a.type === "outcome" || a.type === "status"), JSON.stringify(r));
  assert.ok(!r.actions.some((a) => a.type === "replan"));
});

test("judge 6 #7: a move never lands on a day the room is shut (Bernie's is closed Tuesdays)", async () => {
  const { shutOn } = await import("../public/lib/fu-check.js");
  const { readFileSync } = await import("node:fs");
  const WRIG = "00000000-0000-4000-8000-8F642B1894ED"; // Wrigleyville North: opens 4 pm Tuesdays
  assert.equal(shutOn(chi.venues[BERNIE], { date: TUE, from: 840, to: 1080 }), "closed Tuesdays");
  assert.equal(shutOn(chi.venues[BERNIE], { date: FRI, from: 840, to: 1080 }), null);
  assert.equal(shutOn(chi.venues[WRIG], { date: TUE, from: 840, to: 1080 }), null, "open from 4, inside 2–6");
  assert.equal(shutOn(chi.venues[WRIG], { date: TUE, from: 600, to: 900 }), "not open 10 am–3 pm Tuesday");
  assert.equal(shutOn({ name: "x", hours: null }, { date: TUE, from: 840, to: 1080 }), null, "hours unknown: no claim");
  const ui = readFileSync(new URL("../public/ui/plan.js", import.meta.url), "utf8");
  assert.match(ui, /const shut = shutOn\(plan\.venues\[id\]/);
});

test("a day with visits logged before it starts says so, not 'N visited · keeps its plan'", async () => {
  const { progressLine } = await import("../public/lib/planview.js");
  const stops = Array.from({ length: 10 }, (_, i) => ({ id: `d${i}` }));
  assert.equal(progressLine({ stops, frozen: true, begun: false }, 2), "2 logged early · the rest keep their times until the day starts");
  assert.equal(progressLine({ stops, frozen: true, begun: true }, 2), "2 of 10 visited · the rest of the day re-routes from your last visit");
  assert.equal(progressLine({ stops }, 0), "0 of 10 visited");
  // mobile2 (10-23): today's day before it starts, nothing logged, read "0 logged early · …"; nothing is early
  assert.equal(progressLine({ stops, frozen: true, begun: false }, 0), "0 of 10 visited");
  const ui = (await import("node:fs")).readFileSync(new URL("../public/ui/plan.js", import.meta.url), "utf8");
  assert.ok(!ui.includes("the day keeps its plan until it starts"));
  assert.match(ui, /progressLine\(d, visited\)/);
});
