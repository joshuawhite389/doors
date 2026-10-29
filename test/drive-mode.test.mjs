// R9 drive mode: the day being driven (public/lib/drive-day.js) and the log-visit call with its fallback
// (public/lib/drive-log.js). A scripted day: start → 3 dones by text → a follow-up pinned → the next door.
import { test } from "node:test";
import assert from "node:assert/strict";
import { pickDay, driveQueue, nextAfter, lateness, lateFor, latePickLabel, nextDayIndex, dayTally, navigateUrl } from "../public/lib/drive-day.js";
import { logVisit, checkResult, LOG_URL } from "../public/lib/drive-log.js";

const stop = (id, eta, legMi = 1, legMin = 6, more = {}) => ({ id, eta, depart: eta + 25, legMi, legMin, pinned: null, ...more });
const venue = (id, name) => ({ id, name, lat: 30.26, lon: -97.74, address: `${name} St, Austin, TX` });
function mkPlan() {
  const ids = ["a", "b", "c", "d"];
  return {
    days: [
      { date: "2026-10-22", day: "thursday", from: 780, to: 1020, past: true, stops: [stop("p", 800)] },
      { date: "2026-10-23", day: "friday", from: 780, to: 1020, stops: [stop("a", 790), stop("b", 830), stop("c", 870), stop("d", 910, 2, 12, { openUntil: 960 })] },
      { date: "2026-10-29", day: "thursday", from: 780, to: 1020, stops: [stop("e", 800)] },
    ],
    venues: Object.fromEntries([...ids, "e", "p"].map((id) => [id, venue(id, `Room ${id.toUpperCase()}`)])),
    statuses: {},
    outcomes: {},
    profile: { visitMin: 25 },
    windows: [{ date: "2026-10-23" }, { date: "2026-10-29" }],
  };
}
const NOW = { date: "2026-10-23", min: 785 };

test("today's day is picked; without one, the next day ahead as a preview", () => {
  const p = mkPlan();
  assert.deepEqual(pickDay(p, NOW), { index: 1, day: p.days[1], today: true });
  const pre = pickDay(p, { date: "2026-10-25", min: 600 });
  assert.equal(pre.index, 2);
  assert.equal(pre.today, false);
  assert.equal(pickDay(p, { date: "2026-11-01", min: 600 }), null);
});

test("a scripted day: start → 3 dones by text → a follow-up pinned → the next door", async () => {
  const p = mkPlan();
  let q = driveQueue(p, 1);
  assert.equal(q.current.id, "a");
  assert.equal(q.done, 0);
  assert.equal(nextAfter(q).id, "b");
  const said = { a: "done, loved it, wants samples", b: "come back Thu at 3, liked it, hesitant about price", c: "talked to Sam, he'll pass it on" };
  for (const id of ["a", "b", "c"]) {
    const ctx = { stop: { id, name: p.venues[id].name, date: "2026-10-23" }, now: NOW, windows: ["2026-10-23", "2026-10-29"], next: [] };
    const r = await logVisit(said[id], ctx, { fetch: async () => ({ ok: false, status: 404 }) }); // the endpoint isn't there yet
    assert.equal(r.ok, true, id);
    assert.equal(r.source, "rules");
    // what plan.js does on setStatus / setOutcome
    p.statuses[id] = r.visit.status;
    p.outcomes[id] = r.visit.outcome;
    q = driveQueue(p, 1);
  }
  assert.equal(q.done, 3);
  assert.equal(q.current.id, "d");
  assert.equal(p.outcomes.b.followUp, "2026-10-29");
  assert.equal(p.outcomes.b.followUpTime, "15:00");
  // the follow-up comes back as a stop on Thursday: a return visit, so not done there
  p.days[2].stops.push(stop("b", 900, 1, 6, { pinned: "followup" }));
  const thu = driveQueue(p, 2);
  assert.equal(thu.stops.find((s) => s.id === "b").done, false);
  assert.deepEqual(dayTally(p, q), { visited: 3, interested: 2, followups: 1, no: 0, someone: 1 });
  p.statuses.d = "visited";
  assert.equal(driveQueue(p, 1).finished, true);
});

test("running late: on time says nothing; far behind drops what won't fit before the window or closing", () => {
  const p = mkPlan();
  const q = driveQueue(p, 1);
  assert.equal(lateness(q, NOW), null);
  assert.equal(lateness(q, NOW, { today: false }), null);
  const l = lateness(q, { date: "2026-10-23", min: 900 });
  assert.equal(l.behind, 110);
  assert.deepEqual(l.out, ["d"]); // a at 900, b 931, c 962, d would arrive 999 > its 960 close
  assert.match(l.text, /^Running 110 min late\. Room D doesn't fit before/); // judge pass 8 #5: named
  assert.equal(nextDayIndex(p, 1), 2);
  assert.equal(nextDayIndex(p, 2), -1);
});

test("ease #7: 'Running late' said by the rep: from the planned arrival + N min, on a preview day too; the clock wins when later", () => {
  const p = mkPlan();
  const q = driveQueue(p, 1);
  assert.equal(lateFor(q, NOW, 0), null, "nothing said: the clock alone (on time)");
  const l = lateFor(q, NOW, 30);
  assert.equal(l.behind, 30);
  assert.match(l.text, /^Running 30 min late\. You'd still finish by /);
  assert.equal(lateFor(q, NOW, 30, { today: false }).behind, 30, "a preview day: from the plan's own times");
  assert.deepEqual(lateFor(q, NOW, 60, { today: false }).out, [], "+1 hour: a 850, b 881, c 912, d 949, all fit");
  assert.equal(lateFor(q, { date: "2026-10-23", min: 900 }, 15).behind, 110, "already later by the clock: the clock");
  assert.deepEqual(["+15 min", "+30 min", "+1 hour"], [15, 30, 60].map(latePickLabel));
});

test("the agent's answer is used when it is valid; anything else falls back to the rules", async () => {
  const ctx = { stop: { id: "a", name: "Room A" }, now: NOW, windows: ["2026-10-29"] };
  const good = { v: 1, ok: true, source: "model", visit: { status: "visited", outcome: { result: "followup", followUp: "2026-10-29", followUpTime: "15:00", note: "price" } }, say: "Logged Room A." };
  let sent;
  const r = await logVisit("whatever", ctx, { fetch: async (url, init) => ((sent = { url, body: JSON.parse(init.body) }), { ok: true, json: async () => good }) });
  assert.equal(sent.url, LOG_URL);
  assert.equal(sent.body.v, 1);
  assert.equal(sent.body.stop.id, "a");
  assert.equal(r.source, "model");
  assert.equal(r.visit.outcome.followUpTime, "15:00");
  // a past date, a made-up status, a resting answer, a thrown fetch: rules
  assert.equal(checkResult({ ...good, visit: { status: "visited", outcome: { result: "followup", followUp: "2026-10-01" } } }, ctx), null);
  assert.equal(checkResult({ ...good, visit: { status: "maybe" } }, ctx), null);
  for (const f of [async () => ({ ok: true, json: async () => ({ resting: true, message: "resting" }) }), async () => { throw new Error("offline"); }]) {
    const x = await logVisit("not interested", ctx, { fetch: f });
    assert.equal(x.source, "rules");
    assert.equal(x.visit.outcome.result, "no");
  }
  // the agent asks a question back: drive mode asks the rep
  const ask = await logVisit("done", ctx, { fetch: async () => ({ ok: true, json: async () => ({ ok: false, error: "no result", ask: "How did it go?" }) }) });
  assert.deepEqual([ask.ok, ask.ask], [false, "How did it go?"]);
});

test("Navigate: Apple Maps on Apple devices, Google Maps elsewhere, driving", () => {
  const v = venue("a", "Room A");
  assert.match(navigateUrl(v, "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)"), /^https:\/\/maps\.apple\.com\/\?daddr=30\.260000%2C-97\.740000.*dirflg=d$/);
  assert.match(navigateUrl(v, "Mozilla/5.0 (Linux; Android 14)"), /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&destination=30\.260000%2C-97\.740000&travelmode=driving$/);
  assert.match(navigateUrl({ name: "X", address: "1 Main St" }, ""), /destination=X%2C%201%20Main%20St/);
  assert.equal(navigateUrl(null), null);
});

test("a long read-back is cut at a word, never mid-word (doors-rn, 2026-10-22)", () => {
  const ctx = { stop: { id: "a", name: "Room A" }, now: NOW, windows: ["2026-10-29"] };
  const say = `Logged Room A: ↻ Follow up · Note: ${"the bar was loud and the manager said to ask about ".repeat(6)}march`;
  const r = checkResult({ v: 1, ok: true, source: "model", visit: { status: "visited", outcome: { result: "followup", followUp: "2026-10-29" } }, say }, ctx);
  assert.ok(r.say.length <= 301 && r.say.endsWith("…"), r.say);
  assert.match(r.say, /\b(the|bar|was|loud|and|manager|said|to|ask|about)…$/);
});

test("Start my day's words are shared, web and phone (PARITY S18)", async () => {
  const { DRIVE_WORDS: W, legMiText } = await import("../public/lib/drive-day.js");
  assert.equal(W.progress({ done: 2, total: 9 }), "2 of 9 doors done");
  assert.equal(W.progress({ done: 0, total: 1 }), "0 of 1 door done");
  assert.equal(W.progress({ finished: true, done: 9, total: 9 }), "Day done");
  assert.equal(W.sheetTitle("Nomadic"), "How did it go at Nomadic?");
  assert.equal(W.readBy("rules"), "Read by Doors' rules (Doors Agent wasn't used)");
  assert.equal(W.drop("Nomadic"), "Drop Nomadic from the plan");
  assert.equal(W.done, "Log visit"); // GLOSSARY rule 8
  assert.equal(W.then({ name: "Pinthouse", stop: { legMi: 1.24, source: "ors" } }), "Then: Pinthouse · 1.2 road mi");
  assert.equal(legMiText({ legMi: 3, source: "estimate" }), "3.0 mi · est.");
});

test("Move those n: the target day is found by date and start, a date with two windows lands on the one shown (PARITY S19)", async () => {
  const { sameDayIndex } = await import("../public/lib/drive-day.js");
  const plan = { days: [{ date: "2026-10-27", from: 600 }, { date: "2026-10-28", from: 540 }, { date: "2026-10-28", from: 1020 }] };
  assert.equal(sameDayIndex(plan, { date: "2026-10-28", from: 1020 }), 2);
  assert.equal(sameDayIndex(plan, { date: "2026-10-28", from: 540 }), 1);
  assert.equal(sameDayIndex(plan, { date: "2026-10-29", from: 540 }), -1);
});

test("a move never pushes a planned door off: offEveryDay finds them, the toast names them", async () => {
  const { offEveryDay, noRoomText, lateMovedText } = await import("../public/lib/drive-day.js");
  const before = { days: [{ past: true, stops: [{ id: "old" }] }, { stops: [{ id: "a" }, { id: "b" }] }, { stops: [{ id: "c" }] }] };
  const after = { days: [{ past: true, stops: [] }, { stops: [{ id: "a" }, { id: "c" }] }, { stops: [] }] };
  assert.deepEqual(offEveryDay(before, after), ["b"]);
  assert.deepEqual(offEveryDay(before, before), []);
  const plan = { venues: { a: { name: "A" }, b: { name: "B" } } };
  assert.equal(noRoomText(plan, "a", ["b"], "wednesday"), "No time left on Wednesday for A: it would push B off your days. Nothing moved.");
  assert.equal(noRoomText(plan, "a", ["a"], "wednesday"), "A doesn't fit on Wednesday. Nothing moved.");
  assert.equal(lateMovedText(2, 2, "Thursday"), "2 doors moved to Thursday.");
  assert.equal(lateMovedText(1, 3, "Thursday"), "1 door moved to Thursday. 2 doors didn't fit on Thursday without pushing a planned door off: skip them or end the day early.");
  assert.equal(lateMovedText(0, 1, "Thursday"), "1 door didn't fit on Thursday without pushing a planned door off: skip it or end the day early.");
});
