// Spoken visits (Web Speech in Safari/Chrome, the phone): number words, no punctuation, lowercase. Jard's Safari check,
// 2026-10-22: "Done come back Thursday at three liked it hesitant about price" lost the time and kept "at three" in the note.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseVisit, spoken, sayOutcome } from "../public/lib/visit-parse.js";

const at = { stop: { id: "x", name: "Nomadic Beerworks" }, now: { date: "2026-10-22", min: 900 } }; // Thu 3 pm
const o = (t) => parseVisit(t, at).visit.outcome;

test("Jard's dictation: follow-up Thu 3 pm, interested, note without the time", () => {
  const x = o("Done come back Thursday at three liked it hesitant about price");
  assert.deepEqual([x.result, x.followUp, x.followUpTime, x.note], ["interested", "2026-10-29", "15:00", "liked it, hesitant about price"]);
});

test("spoken times: three thirty, half past, quarter to, noon, p.m., in the afternoon, o'clock", () => {
  const t = (s) => o(s).followUpTime;
  assert.equal(t("come back friday at three thirty"), "15:30");
  assert.equal(t("back friday half past four interested"), "16:30");
  assert.equal(t("come back friday at quarter to five loved it"), "16:45");
  assert.equal(t("back thursday at noon liked it"), "12:00");
  assert.equal(t("come back monday three p.m. liked it"), "15:00");
  assert.equal(t("come back monday at three in the afternoon wants samples"), "15:00");
  assert.equal(t("come back monday at ten in the morning"), "10:00");
  assert.equal(t("come back monday four o'clock"), "16:00");
});

test("no-comma dictation splits into clauses; prepositions don't split; the name is one word unless capitalised", () => {
  assert.equal(o("done come back friday at quarter to five loved it worried about delivery").note, "loved it, worried about delivery");
  assert.equal(o("done liked it said to come back next week").note, "liked it");
  const s = o("done liked it talked to Sam come back Monday at 3 pm");
  assert.deepEqual([s.who, s.followUpTime, s.note], ["Sam", "15:00", "liked it, talked to Sam"]);
  assert.equal(o("done spoke with Maria not a fit").who, "Maria");
  assert.equal(spoken("done, liked it, at 3"), "done, liked it, at 3", "typed text with commas stays as typed");
  assert.equal(spoken("come back in three days"), "come back in three days", "'in three days' is a date, not a time");
});

test("the read-back labels its parts", () => {
  assert.equal(sayOutcome(o("Done come back Thursday at three liked it hesitant about price")), "✓ Interested · ↻ Follow up Thu Oct 29, 3 pm · Note: liked it, hesitant about price");
});
