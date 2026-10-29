// Judge pass 9, lane E5 (words): "finish by 4" names the doors that came off (planview offDayText), the tour keeps
// track of her #1 door (lib/demo-story.js), card 22 leads with rank against popularity (lib/demo-swap.js), and the
// Agent's context uses the day that holds the door asked about (agent-context dayHolding).
import { test } from "node:test";
import assert from "node:assert/strict";
import { offDayText, withoutOffCount } from "../public/lib/planview.js";
import { replanSentence, afterDriveText, followUpNow, offVisitDay, swapLine } from "../public/lib/demo-story.js";
import { swapSide, SWAP_CITIES, SWAP_DRINKER } from "../public/lib/demo-swap.js";
import { dayHolding } from "../public/lib/agent-context.js";
import { demoProfile } from "../public/lib/demo-profile.js";
import { STEPS } from "../public/lib/demo-script.js";
import { route, readJson } from "./helpers.mjs";
import { existsSync } from "node:fs";
// the Qloo data stays private (scripts/export-public.sh drops it): the one test that reads it skips in the public repo
const NO_DATA = !existsSync(new URL("../public/data/index.json", import.meta.url)) && "needs the private Qloo data";

const V = { a: { name: "Foxy's" }, b: { name: "Idle Hands" }, c: { name: "Hold Out" }, d: { name: "Lazarus" }, e: { name: "Kinda Tropical" }, f: { name: "The Yard" } };
const day = (date, name, ids, extra = {}) => ({ date, day: name, stops: ids.map((id) => ({ id })), ...extra });

test("finish by 4: the doors that came off the day are named, with where each went", () => {
  const prev = { venues: V, days: [day("2026-10-27", "tuesday", ["f", "a", "b", "c", "d"]), day("2026-10-28", "wednesday", ["e"])] };
  const next = { venues: V, days: [day("2026-10-27", "tuesday", ["f"]), day("2026-10-28", "wednesday", ["e", "d"])] };
  assert.equal(offDayText(prev, next, "2026-10-27"), "Foxy's, Idle Hands and Hold Out back on Your list, Lazarus moved to Wednesday");
  assert.equal(offDayText(prev, next, "2026-10-27", { skip: ["a"] }), "Idle Hands and Hold Out back on Your list, Lazarus moved to Wednesday");
  assert.equal(offDayText(prev, prev, "2026-10-27"), "");
  assert.equal(withoutOffCount("Tuesday re-planned: 3 off the day · Wednesday re-planned: 1 door moved from Tuesday", "tuesday"), "Wednesday re-planned: 1 door moved from Tuesday");
  assert.equal(withoutOffCount("Tuesday re-planned: 3 off the day, 1 new door from Your list", "tuesday"), "Tuesday re-planned: 3 off the day, 1 new door from Your list");
});

test("tour card 17 names the highlighted row (Thursday's follow-up), the phone's version names no highlight", () => {
  const plan = { venues: { n: { name: "Nomadic Beerworks" }, ...V }, source: "ors", replanCost: { addedMi: 4.3, droppedIds: ["a"] },
    days: [day("2026-10-27", "tuesday", ["n"]), day("2026-10-29", "thursday", ["f", "n"])] };
  plan.days[1].stops[1].pinned = "followup";
  assert.match(replanSentence(plan, "n", "2026-10-29"), /^The highlighted row is her follow-up at Nomadic Beerworks on Thursday, Oct 29\. That adds 4\.3 road miles to Thursday, and Foxy's comes off Thursday to make room\.$/);
  assert.match(replanSentence(plan, "n", "2026-10-29", { highlighted: false }), /^Her follow-up at Nomadic Beerworks goes on Thursday, Oct 29\./);
  const body = STEPS.find((s) => s.key === "replan").body[0];
  assert.match(body, /Tuesday now opens with it/);
  assert.match(STEPS.find((s) => s.key === "drive").body[0], /^Back to Tuesday, after Nomadic\./);
  assert.match(STEPS.find((s) => s.key === "handoff").body[0], /^\{toast\} Those were the highlights/);
});

test("card 17 says which doors her visit pushed off Tuesday, and where they went", () => {
  const venues = { n: { name: "Nomadic Beerworks" }, ...V };
  const prev = { venues, days: [day("2026-10-27", "tuesday", ["a", "b", "n", "c"]), day("2026-10-28", "wednesday", ["e"])] };
  const next = { venues, days: [day("2026-10-27", "tuesday", ["n", "b", "c"]), day("2026-10-28", "wednesday", ["e"])] };
  assert.equal(offVisitDay(prev, next, "2026-10-27", "n"), "Foxy's no longer fits Tuesday (3 doors now, not 4), so it's back on Your list.");
  const moved = { venues, days: [day("2026-10-27", "tuesday", ["n", "c"]), day("2026-10-28", "wednesday", ["e", "b"])] };
  assert.equal(offVisitDay(prev, moved, "2026-10-27", "n"), "Tuesday has 2 doors now, not 4: Foxy's back on Your list, Idle Hands moved to Wednesday.");
  assert.equal(offVisitDay(prev, prev, "2026-10-27", "n"), "", "nothing came off: no sentence");
});

test("the hand-off says where her #1 door is after drive mode's follow-up re-planned its day", () => {
  const plan = { city: { name: "Austin" }, venues: { n: { name: "Nomadic Beerworks" }, ...V },
    outcomes: { n: { result: "interested", followUp: "2026-10-29" }, f: { result: "followup", followUp: "2026-10-29", followUpTime: "15:00" } },
    days: [day("2026-10-27", "tuesday", ["a"]), { date: "2026-10-29", day: "thursday", stops: [{ id: "n", pinned: "followup", eta: 151, waitMin: 0 }, { id: "f", pinned: "followup", eta: 180 }] }] };
  plan.days[1].stops[0].eta = 14 * 60 + 31;
  assert.equal(afterDriveText(plan, "n"), "Thursday changed again: The Yard's 3 pm follow-up joined it, so Nomadic Beerworks is now stop 1, at 2:31 pm.");
  // intuit pass 1b #2: against card 17's Thursday, it says where Nomadic moved from and which doors came off
  const was = { n: 6, count: 6, ids: ["a", "b", "c", "d", "e", "n"] };
  assert.equal(afterDriveText(plan, "n", was), "Thursday changed again: The Yard's 3 pm follow-up joined it, so Nomadic Beerworks moved from stop 6 to stop 1, at 2:31 pm. Foxy's, Idle Hands and 3 more came off Thursday to make room.");
  assert.equal(afterDriveText(plan, "n", { ...was, ids: ["n", "b"] }), "Thursday changed again: The Yard's 3 pm follow-up joined it, so Nomadic Beerworks moved from stop 6 to stop 1, at 2:31 pm. Idle Hands came off Thursday to make room.");
  assert.deepEqual(followUpNow(plan, "n", "2026-10-29"), { n: 1, count: 2, ids: ["n", "f"] });
  assert.equal(afterDriveText({ ...plan, outcomes: { n: plan.outcomes.n } }, "n"), "", "nothing logged in drive mode: no line");
  assert.equal(afterDriveText({ ...plan, outcomes: { ...plan.outcomes, f: { ...plan.outcomes.f, followUp: "2026-10-28" } } }, "n"), "", "another day: her #1 didn't move");
});

test("card 22 leads with each city's #1 rank against where popularity alone puts it, and the doors like it", { skip: NO_DATA }, () => {
  const index = readJson("public/data/index.json");
  const sides = SWAP_CITIES.map((key) => swapSide({ route: route(`${SWAP_DRINKER}-${key}`), city: readJson(`public/data/cities/${key}.json`), cityKey: key, cityName: index.cities.find((c) => c.key === key).name, profile: demoProfile() }));
  const [a, b] = sides;
  assert.equal(a.rank, 1);
  assert.equal(a.of, 55);
  assert.equal(a.popRank, 17, "as the lead image and README say");
  assert.ok(b.popRank > 1);
  assert.ok(a.alike > 0 && b.alike > 0);
  assert.equal(a.drinker, "Athletic Brewing");
  assert.equal(swapLine(sides), `Ordered by popularity alone, Nomadic Beerworks would be #17 in Austin and ${b.name} would be #${b.popRank} in Boise.`);
  assert.equal(swapLine([{ ...a, popRank: 1 }, b]), "");
});

test("the Agent's 'why isn't X first?' uses the day that holds X", () => {
  const plan = { days: [day("2026-10-27", "tuesday", ["a"], { past: true }), day("2026-10-28", "wednesday", ["b"]), day("2026-10-29", "thursday", ["a", "c"])] };
  assert.equal(dayHolding(plan, "a"), 2, "not the past day");
  assert.equal(dayHolding(plan, "zz"), -1);
});
