// R9 drive mode / docs/CONTRACTS-R9.md §3: the rules reading of what a rep says after a door (public/lib/visit-parse.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseVisit, parseDate, parseTime, noteOf, isSkip } from "../public/lib/visit-parse.js";

const now = { date: "2026-10-23", min: 875 }; // a Friday, 2:35 pm
const windows = ["2026-10-23", "2026-10-24", "2026-10-29"];
const stop = { id: "kc", name: "Kitty Cohen's" };
const read = (t, more = {}) => parseVisit(t, { stop, now, windows, next: [{ id: "lz", name: "Lazarus Brewing" }], ...more });

test("the owner's example: liked it + a day = interested with a follow-up at 3 pm, note = the rest of their words", () => {
  const r = read("done, come back Thu at 3, liked it, hesitant about price");
  assert.equal(r.ok, true);
  assert.equal(r.source, "rules");
  assert.equal(r.visit.status, "visited");
  assert.deepEqual({ ...r.visit.outcome, at: undefined }, { result: "interested", followUp: "2026-10-29", followUpTime: "15:00", note: "liked it, hesitant about price", at: undefined });
  assert.equal(r.visit.outcome.at, "2026-10-23T14:35");
  assert.deepEqual(r.next, { id: "lz", name: "Lazarus Brewing" });
  assert.match(r.say, /^Logged Kitty Cohen's: .*Follow up Thu Oct 29, 3 pm.*Next: Lazarus Brewing\.$/);
  assert.deepEqual(r.actions.map((a) => a.type), ["status", "outcome"]);
});

test("come back with no day said → follow-up on the next window", () => {
  const r = read("come back, the buyer's out");
  assert.equal(r.visit.outcome.result, "followup");
  assert.equal(r.visit.outcome.followUp, "2026-10-24");
});

test("a weekday is the next one after today; the same weekday is next week's", () => {
  assert.equal(parseDate("back thursday", "2026-10-23"), "2026-10-29");
  assert.equal(parseDate("back fri", "2026-10-23"), "2026-10-30");
  assert.equal(parseDate("tomorrow", "2026-10-23"), "2026-10-24");
  assert.equal(parseDate("on Oct 30", "2026-10-23"), "2026-10-30");
  assert.equal(parseDate("on 1/5", "2026-10-23"), "2027-01-05");
  assert.equal(parseDate("in 3 days", "2026-10-23"), "2026-10-26");
  assert.equal(parseDate("liked it", "2026-10-23"), null);
});

test("times: business hours read pm for 1–7, am/pm and minutes honoured, no time is null", () => {
  assert.equal(parseTime("at 3"), 15 * 60);
  assert.equal(parseTime("10am"), 10 * 60);
  assert.equal(parseTime("4:30 pm"), 16 * 60 + 30);
  assert.equal(parseTime("at noon"), 12 * 60);
  assert.equal(parseTime("after lunch"), null);
  assert.equal(parseTime("in 3 days"), null);
});

test("results: no, not a fit, someone else, interested, already talked", () => {
  assert.equal(read("not interested").visit.outcome.result, "no");
  const nf = read("they won't carry anything n/a");
  assert.equal(nf.visit.status, "notfit");
  assert.equal(nf.visit.outcome.result, "no");
  const sam = read("talked to Sam, he'll pass it on");
  assert.equal(sam.visit.outcome.result, "someone");
  assert.equal(sam.visit.outcome.who, "Sam");
  assert.equal(read("spoke with the manager, interested").visit.outcome.who, undefined);
  assert.equal(read("loved it, wants samples").visit.outcome.result, "interested");
  assert.equal(read("already talked to them before, no budget").visit.status, "talked");
  assert.equal(read("already talked to them, no").visit.outcome.result, "no");
  assert.equal(read("No.").visit.outcome.result, "no");
  assert.equal(read("it's a no").visit.outcome.result, "no");
  assert.equal(read("no one at the bar but the owner loved it").visit.outcome.result, "interested");
});

test("nothing to go on → ok:false with a question to ask, never a guess", () => {
  for (const t of ["done", "", "hmm"]) {
    const r = read(t);
    assert.equal(r.ok, false);
    assert.ok(r.ask);
  }
});

test("the note only removes words: never adds one", () => {
  const t = "done, back Thu 3pm, liked it, hesitant about price";
  const n = noteOf(t);
  assert.equal(n, "liked it, hesitant about price");
  for (const w of n.split(/\W+/).filter(Boolean)) assert.ok(t.includes(w), w);
});

test("closed / nobody there is a skip, not a visit", () => {
  assert.equal(isSkip("closed, nobody there"), true);
  assert.equal(isSkip("closed the deal, they loved it"), false);
});

test("R9 polish: an explicit date beats a weekday said with it; month words only ('decided 2' is no date)", () => {
  assert.equal(parseDate("come back Thursday Nov 5", "2026-10-23"), "2026-11-05");
  assert.equal(parseDate("back thu 11/5 at 3", "2026-10-23"), "2026-11-05");
  assert.equal(parseDate("back thursday, decided 2 cases", "2026-10-23"), "2026-10-29");
  const r = parseVisit("liked it, come back Thursday Nov 5 at 3", { stop: { id: "a", name: "A" }, now: { date: "2026-10-23", min: 600 }, windows: ["2026-10-23", "2026-10-29"] });
  assert.equal(r.visit.outcome.followUp, "2026-11-05");
});

test("R9 polish: a bare weekday is the next plan day on that weekday when this week's isn't a plan day", () => {
  // said Tue Oct 27; the plan's days are Tue Nov 3 and Wed Nov 4: "back Wed" is Nov 4, not the off-plan Oct 28
  const wins = ["2026-10-27", "2026-11-03", "2026-11-04"];
  assert.equal(parseDate("back wed", "2026-10-27", { windows: wins }), "2026-11-04");
  assert.equal(parseDate("back wed", "2026-10-27", { windows: ["2026-10-28", "2026-11-04"] }), "2026-10-28", "this week's Wed is a plan day: it stands");
  assert.equal(parseDate("back wed", "2026-10-27"), "2026-10-28", "no plan days: the next Wed");
  assert.equal(parseDate("back fri", "2026-10-27", { windows: wins }), "2026-10-30", "no plan Friday: the next Fri");
  const r = parseVisit("done, back Wed at 2, liked it", { stop: { id: "a", name: "A" }, now: { date: "2026-10-27", min: 600 }, windows: wins });
  assert.equal(r.visit.outcome.followUp, "2026-11-04");
});

test("'the manager is busy' is how they are, not who: no name (doors-rn, iPhone XS, 2026-10-22)", () => {
  const r = read("I'm wondering what to say when the manager is busy at the bar and the owner only comes in on weekends");
  assert.notEqual(r.visit?.outcome?.who, "busy");
  assert.equal(r.visit?.outcome?.who ?? "", "");
  assert.equal(read("done, the manager is Dana, liked it").visit.outcome.who, "Dana", "a capitalised name after 'is' still counts");
  assert.equal(read("the owner is Gary Stone, back thursday").visit.outcome.who, "Gary Stone");
});

test("'her name is Dana' and 'Dana is the manager' name the contact; capitalised names only", () => {
  const r = read("talked to the manager, her name is Dana, back friday at 4");
  assert.equal(r.visit.outcome.who, "Dana");
  assert.equal(r.visit.outcome.followUp, "2026-10-30");
  assert.equal(r.visit.outcome.followUpTime, "16:00");
  assert.equal(read("Dana is the manager, liked it").visit.outcome.who, "Dana");
  assert.equal(read("talked to the owner, his name's Gary Stone, interested").visit.outcome.who, "Gary Stone");
  assert.equal(read("Today Dana is the bar manager, interested").visit.outcome.who, "Dana");
  for (const t of ["She is the manager, liked it", "their name is sam, liked it", "spoke with the bar manager, liked it"]) assert.equal(read(t).visit.outcome.who ?? "", "", t);
});

test("judge pass 3 (N3): a deferral is not a yes; not the one who decides is someone else; a bare 'not now' asks", () => {
  const spring = read("talked to the owner, not now, maybe in spring, too many sodas already");
  assert.equal(spring.visit.outcome.result, "no");
  assert.equal(spring.visit.outcome.note, "talked to the owner, not now, maybe in spring, too many sodas already");
  assert.equal(read("spoke to the bartender, owner decides").visit.outcome.result, "someone");
  assert.equal(read("manager wasn't in, left samples").visit.outcome.result, "someone");
  assert.equal(read("spoke to the bartender").visit.outcome.result, "someone");
  assert.equal(read("they have plenty of NA options").visit.outcome.result, "no");
  for (const t of ["not now", "maybe later"]) assert.equal(read(t).ok, false, t);
  const later = read("not now, come back thursday");
  assert.equal(later.visit.outcome.result, "followup");
  assert.equal(later.visit.outcome.followUp, "2026-10-29");
  assert.equal(read("talked to the owner, interested").visit.outcome.result, "interested", "the owner saying yes is still a yes");
  assert.equal(read("the manager is out today, come back tomorrow").visit.outcome.followUp, "2026-10-24", "tomorrow beats today");
});

test("judge pass 3 (N5): 'done at <the door>' is where, not a note", () => {
  assert.equal(read("done at Kitty Cohen's, back Thursday at 3, liked it").visit.outcome.note, "liked it");
  assert.equal(read("done at the corner bar, liked it").visit.outcome.note, "liked it");
  assert.equal(read("done, liked it").visit.outcome.note, "liked it");
});
