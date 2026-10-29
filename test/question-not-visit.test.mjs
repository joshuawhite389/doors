// A question with visit words in it is answered, never logged as a visit: "I'm
// wondering what I should say… wait for the owner to call back next week" matched "back next" and logged a visit.
// The model's log_visit, drive mode's log and the Worker's log-visit endpoint; the rules chat (it needs the demo's
// data) is in question-not-visit-data.test.mjs. No network, no data: runs in the public repo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { isQuestion, parseVisit } from "../public/lib/visit-parse.js";
import { logVisit } from "../public/lib/drive-log.js";
import { staleChange, logVisitTurn, cleanVisit, _resetAgent } from "../src/agent.js";
import { QUESTIONS, REPORTS } from "./question-strings.mjs";

const stop = { id: "a", name: "Room A" };
const vctx = { stop, now: { date: "2026-10-23", min: 800 }, windows: ["2026-10-29", "2026-10-30"] };

test("questions read as questions; reports (even quoting one) don't", () => {
  for (const q of QUESTIONS) assert.equal(isQuestion(q), true, q);
  for (const r of REPORTS) assert.equal(isQuestion(r), false, r);
});

test("parseVisit asks how it went instead of logging a question; reports still log", () => {
  for (const q of QUESTIONS) {
    const r = parseVisit(q, vctx);
    assert.equal(r.ok, false, q);
    assert.match(r.ask, /how it went/i);
  }
  for (const t of REPORTS) assert.equal(parseVisit(t, vctx).ok, true, t);
});

test("the model's log_visit is refused when the rep's message is a question", () => {
  for (const q of QUESTIONS) assert.match(staleChange("log_visit", { door_id: "x", result: "followup" }, q, {}), /question/, q);
  assert.equal(staleChange("log_visit", { door_id: "x", result: "interested" }, "done, liked it", {}), null);
});

test("drive mode: a question never goes to the log-visit endpoint; the rules ask", async () => {
  let called = 0;
  const r = await logVisit(QUESTIONS[0], vctx, { fetch: async () => (called++, { ok: true, json: async () => ({}) }) });
  assert.equal(called, 0);
  assert.equal(r.ok, false);
  assert.match(r.ask, /how it went/i);
});

test("the Worker's log-visit: a question asks, and no model is called", async () => {
  _resetAgent();
  const v = cleanVisit({ text: QUESTIONS[0], stop: { id: "00000000-0000-4000-8000-da9f5309f34b", name: "Room A" }, now: vctx.now, windows: vctx.windows });
  const r = await logVisitTurn({ v, env: { AGENT_SESSION: () => { throw new Error("model called for a question"); } } });
  assert.equal(r.ok, false);
  assert.match(r.ask, /how it went/i);
});
