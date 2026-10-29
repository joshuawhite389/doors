// The door card's top (lib/doorcard.js, Jard 10-23 #9): At the door, About this door, the status line, the visit line,
// the day's tally, after a visit. Real Austin data (Tidewell, Athletic Brewing drinkers).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { route, ROOT } from "./helpers.mjs";
import { buildPool, windowsFor } from "../public/lib/pool.js";
import { planDays } from "../public/lib/schedule.js";
import { stopModel } from "../public/lib/stopmodel.js";
import { atDoor, aboutLines, statusLine, visitLine, dayTally, tallyWords, afterVisit, nextStop } from "../public/lib/doorcard.js";

// Qloo's route and city files are private: these tests skip in the public repo
const skip = !existsSync(join(ROOT, "public/data/routes/athletic-brewing-austin.json")) && "Qloo's Austin data is private";
const r = skip ? null : route("athletic-brewing-austin");
const city = skip ? null : JSON.parse(readFileSync(join(ROOT, "public/data/cities/austin.json"), "utf8"));
const profile = { brand: "Tidewell", what: "Non-alcoholic hazy IPA", price: "$38 a case of 24", ask: "one case of cans in the cooler", drinks: [{ key: "athletic-brewing", name: "Athletic Brewing", ready: true }], rooms: ["bars", "breweries"], start: { lat: 30.25, lon: -97.75 }, windows: [{ date: "2026-10-27", from: "13:00", to: "18:00" }], visitMin: 25 };
const make = ({ statuses = {}, outcomes = {}, slots = {} } = {}) => {
  const pool = buildPool({ routes: [r], profile, statuses, outcomes });
  return { ...planDays({ pool: pool.rows, statuses: pool.statuses, windows: windowsFor(profile), visitMin: 25, pinned: pool.pinned }), venues: pool.venues, statuses: pool.statuses, outcomes, profile, windows: profile.windows, slots, city: { key: "austin", name: "Austin" }, pool: { drinker: "Athletic Brewing drinkers" } };
};

test("At the door: ask for, timing, opener, the ask, bring; tagged lines, not positions", { skip }, () => {
  const p = make();
  const id = p.days[0].stops[0].id;
  const m = stopModel({ plan: p, id, dayIndex: 0, city, routes: [r] });
  assert.equal(m.talk.beforeKinds.length, m.talk.before.length);
  const a = atDoor(m);
  assert.ok(a.askFor && !/^Ask for/.test(a.askFor), a.askFor);
  assert.ok(a.timing, "timing line");
  assert.match(a.bring, /^Cold samples/);
  assert.ok(a.opener && a.ask && /\.$/.test(a.ask));
  assert.deepEqual(a.last, []);
  assert.equal(visitLine(m), "First visit");
  const st = statusLine(m);
  assert.ok(st.length >= 1 && st.every((x) => x.text));
  const ab = aboutLines(m);
  assert.ok(ab.length <= 3 && ab.every((x) => x.title && x.text));
});

test("a rule that hides the who line drops it from At the door and keeps the kinds in step", { skip }, () => {
  const p0 = make();
  const id = p0.days[0].stops[0].id;
  const who = stopModel({ plan: p0, id, dayIndex: 0, city, routes: [r] }).talk.before[0];
  const word = who.match(/(manager|owner|buyer|director)/)[1];
  const p = make({ slots: { "*": [{ field: "rule.avoid", value: word, source: "corrected", by: "rep" }] } });
  const m = stopModel({ plan: p, id, dayIndex: 0, city, routes: [r] });
  assert.equal(m.talk.beforeKinds.length, m.talk.before.length);
  assert.ok(!m.talk.beforeKinds.includes("who"));
  assert.equal(atDoor(m).askFor, null);
});

test("after a visit: the outcome, the tally, the next stop", { skip }, () => {
  const p0 = make();
  const [s1, s2] = p0.days[0].stops;
  const o = { result: "interested", who: "Priya", note: "try a case", at: "2026-10-27T13:48:00" };
  const p = make({ statuses: { [s1.id]: "visited" }, outcomes: { [s1.id]: o } });
  const m = stopModel({ plan: p, id: s1.id, dayIndex: null, city, routes: [r] });
  const av = afterVisit(m);
  assert.match(av.title, /Interested/);
  assert.deepEqual(av.lines, ["Talked to Priya.", "“try a case”"]);
  assert.equal(visitLine(m), null);
  // visited: the status line says when, never an arrival or "closed when you arrive" (mobile2 P3)
  const st = statusLine({ ...m, stop: { openAtArrival: false } });
  assert.ok(st.some((x) => /^Visited 1:48 pm$/.test(x.text)) && !st.some((x) => /Arrive|Closed/.test(x.text)), JSON.stringify(st));
  const t = dayTally(p, 0); // logged on the day's date: counted even when it left the day's list
  assert.equal(t.total, p.days[0].stops.length + (p.days[0].stops.some((s) => s.id === s1.id) ? 0 : 1));
  assert.equal(t.visited, 1);
  assert.equal(t.dots.filter((x) => x === "ok").length, 1);
  assert.equal(t.interested, 1);
  const m2 = stopModel({ plan: p0, id: s1.id, dayIndex: 0, city, routes: [r] });
  assert.deepEqual(nextStop(m2, p0)?.id, s2.id);
});

// Jard 10-24 #4: "9 of 9 doors visited today" beside 2 green dots read as a contradiction. The count was right (grey meant
// "visited, another answer"); the words now carry the answers and the bar has one colour.
test("tallyWords: the count, then interested / follow up / to go, in words", () => {
  const t9 = { dots: ["ok", "ok", "done", "done", "done", "done", "done", "done", "done"], visited: 9, total: 9, interested: 2, followups: 0 };
  assert.deepEqual(tallyWords(t9), { head: "9 of 9 doors visited today", sub: "2 interested" });
  const t3 = { dots: ["ok", "fu", "done", "", "", "", "", "", ""], visited: 3, total: 9, interested: 1, followups: 1 };
  assert.deepEqual(tallyWords(t3), { head: "3 of 9 doors visited today", sub: "1 interested · 1 to follow up · 6 to go" });
  assert.equal(tallyWords({ visited: 1, total: 1, interested: 0, followups: 0 }).sub, "");
});

// Jard web review 10-24: "Why: Nothing in Qloo's tags points at one angle: lead with the taste." is no Why at all
test("At the door: no angle under To the buyer when Qloo's tags point at none", async () => {
  const { NO_ANGLE } = await import("../public/lib/culture.js");
  const src = readFileSync(join(ROOT, "public/lib/culture.js"), "utf8");
  assert.equal(src.split(`"${NO_ANGLE}:`).length - 1, 3, "the na, soft and taste fallbacks start with NO_ANGLE");
  const talk = (a) => ({ talk: { before: [a], beforeKinds: ["angle"], toBuyer: "Can I pour you one cold?" } });
  assert.equal(atDoor(talk(`Your angle: ${NO_ANGLE}: lead with the taste.`)).angle, null);
  assert.equal(atDoor(talk("Your angle: Qloo has this as a sports bar. Come well before game time.")).angle, "Qloo has this as a sports bar. Come well before game time.");
});
