// The usual week on the shipped data (lib/week.js; the pure half is test/week.test.mjs): validation against the cities,
// and Maya's Austin list planned over weeks. Skipped in the public export (it reads Qloo data).
import { test } from "node:test";
import assert from "node:assert/strict";
import { windowsFor, buildPool } from "../public/lib/pool.js";
import { planDays } from "../public/lib/schedule.js";
import { validateProfile } from "../public/lib/profile.js";
import { untilFor, weeksLine, weeksOf, mondayOf } from "../public/lib/week.js";
import { examples } from "../public/lib/examples.js";
import { route, readJson } from "./helpers.mjs";

const SAT = "2026-10-24";
const WEEK = { days: { tuesday: { from: "14:00", to: "18:00" }, wednesday: { from: "13:00", to: "17:00" } }, changes: {}, since: SAT };

test("validation: a usual week needs a day; its hours are checked; dated days need no week", () => {
  const ex = examples(new Date(2026, 9, 24)).find((x) => x.key === "maya").profile;
  const ctx = { cities: readJson("public/data/index.json").cities };
  assert.ok(validateProfile(ex, ctx).ok, JSON.stringify(validateProfile(ex, ctx).errors));
  assert.equal(validateProfile({ ...ex, week: { days: {}, changes: {}, since: SAT } }, ctx).errors.windows, "Pick at least one day you're free.");
  assert.ok(validateProfile({ ...ex, week: { days: {}, changes: { "2026-10-30": { from: "10:00", to: "12:00" } }, since: SAT } }, ctx).ok, "one date alone is a plan");
  assert.match(validateProfile({ ...ex, week: { ...WEEK, days: { monday: { from: "15:00", to: "14:00" } } } }, ctx).errors.windows, /end must be after/);
  assert.equal(validateProfile({ ...ex, week: { ...WEEK, changes: { "2026-10-30": { off: true } } } }, ctx).errors.windows, undefined, "a day off is no window to check");
  assert.ok(validateProfile({ ...ex, week: null }, ctx).ok, "dated days, as saved before");
});

test("the plan over weeks: the list is worked through week by week, best-ranked first; a far follow-up lands on its own date", () => {
  const today = "2026-10-26";
  const prof = { ...examples(new Date(2026, 9, 24)).find((x) => x.key === "maya").profile, known: [] };
  const routes = [route("athletic-brewing-austin")];
  const id = routes[0].ranked?.[5]?.id ?? routes[0].rows?.[5]?.id ?? Object.keys(routes[0].venues ?? {})[5];
  const fu = "2026-11-19"; // a Thursday four weeks out
  const pool = buildPool({ routes, profile: prof, statuses: { [id]: "visited" }, outcomes: { [id]: { result: "followup", followUp: fu } }, cityName: "Austin" });
  const windows = windowsFor(prof, { today, until: untilFor(pool.pinned, []) });
  const p = planDays({ pool: pool.rows, statuses: pool.statuses, windows, visitMin: prof.visitMin, pinned: pool.pinned, now: { date: today, min: 600 } });
  const weeks = weeksOf(p.days);
  assert.deepEqual(weeks.map((w) => w.week), ["2026-10-26", "2026-11-02", "2026-11-09", "2026-11-16"]);
  // her 55 bars and breweries: week 1 the best fits, week 2 the next; the rest are closed in her hours or not worth the
  // drive (reasons), so the weeks after hold only the follow-up
  assert.ok(weeks[0].doors > weeks[1].doors && weeks[1].doors > 0, JSON.stringify(weeks));
  const rank = new Map(pool.rows.map((r) => [r.id, r.rank]));
  const best = (wk) => Math.min(...p.days.filter((d) => mondayOf(d.date) === wk).flatMap((d) => d.stops).filter((s) => !s.pinned).map((s) => rank.get(s.id)));
  assert.ok(best("2026-10-26") < best("2026-11-02"), "week 1 has the better-ranked doors");
  assert.ok(Object.values(p.reasons).every((r) => r.code !== "full" && r.code !== "better"), "no door is left off for room: the weeks after had room");
  const back = p.days.find((d) => d.date === fu);
  assert.ok(back?.stops.some((s) => s.id === id && s.pinned === "followup"), "the follow-up is on Thu Nov 19");
  assert.match(weeksLine(p.days, 12), /^Week of Oct 26: \d+ doors · Week of Nov 2: \d+ doors · Week of Nov 9: 0 doors · Week of Nov 16: 1 door · 12 left on Your list$/);
  assert.equal(weeksLine(p.days.slice(0, 3)), "", "one week: the day tabs already count it");
  assert.equal(mondayOf("2026-11-01"), "2026-10-26");
});

// ---------- area days (gigbot 10-25): after the first week, the detours grouped into one area's day ----------
const planOf = (weeks, areas, extra = {}) => {
  const prof = { ...examples(new Date(2026, 9, 24)).find((x) => x.key === "maya").profile, known: [] };
  const pool = buildPool({ routes: [route("athletic-brewing-austin")], profile: prof, statuses: {}, outcomes: {}, cityName: "Austin" });
  const windows = windowsFor(prof, { today: "2026-10-26", weeks });
  return { pool, plan: planDays({ pool: pool.rows, statuses: pool.statuses, windows, visitMin: prof.visitMin, pinned: pool.pinned, now: { date: "2026-10-26", min: 600 }, areas, ...extra }) };
};
const strip = (p) => JSON.stringify(p);
const TIME = new Set(["status", "closed", "opens-after", "closes-before", "brief", "hours", "idle-hours", "idle"]);
test("area days: a one-week plan and the first week are exactly as without them", () => {
  assert.equal(strip(planOf(1, true).plan), strip(planOf(1, false).plan), "one week: no change at all");
  const on = planOf(4, true).plan;
  const off = planOf(4, false).plan;
  const wk1 = (p) => JSON.stringify(p.days.filter((d) => mondayOf(d.date) === "2026-10-26"));
  assert.equal(wk1(on), wk1(off));
  assert.ok(on.days.filter((d) => mondayOf(d.date) === "2026-10-26").every((d) => !d.area));
});

test("area days: the far doors go out in groups on later days with no doors of their own; closed ones keep their reasons", () => {
  const { pool, plan: on } = planOf(4, true);
  const off = planOf(4, false).plan;
  const rank = new Map(pool.rows.map((r) => [r.id, r]));
  const areas = on.days.filter((d) => d.area);
  assert.ok(areas.length >= 2, `area days: ${areas.length}`);
  for (const d of areas) {
    assert.ok(mondayOf(d.date) !== "2026-10-26", "never in the first week");
    assert.equal(off.days.find((x) => x.date === d.date).stops.length, 0, `${d.date} had no doors of its own`);
    assert.ok(d.area.ids.length >= 2 && d.stops.every((s) => off.reasons[s.id] && !TIME.has(off.reasons[s.id].code)), "its doors were off for their driving, not their hours");
    assert.ok(d.min <= 50 * d.stops.length, `${d.date}: ${d.min} min for ${d.stops.length} doors`);
    const pts = d.stops.map((s) => rank.get(s.id));
    for (const a of pts) for (const b of pts) assert.ok(Math.hypot(a.lat - b.lat, (a.lon - b.lon) * 0.86) * 111.2 < 17, "one area");
  }
  // Growler Express (#3, Buda) is no longer off the plan: the south day takes it
  const growler = pool.rows.find((r) => /^Growler Express/.test(r.name)).id;
  assert.equal(off.reasons[growler]?.code, "detour");
  assert.ok(areas.some((d) => d.stops.some((s) => s.id === growler)));
  for (const [id, r] of Object.entries(off.reasons)) if (TIME.has(r.code)) assert.deepEqual(on.reasons[id], r, "closed in her hours etc.: the same reason");
  const onDay = new Set(on.days.flatMap((d) => d.stops.map((s) => s.id)));
  assert.ok(Object.keys(on.reasons).every((id) => !onDay.has(id)) && on.unscheduled.every((id) => !onDay.has(id)));
  // the same input plans the same (a reopened plan)
  assert.equal(strip(planOf(4, true).plan), strip(on));
});

test("area names: the day's shared neighbourhood, else its direction from the start", async () => {
  const { areaName, weekAreas } = await import("../public/lib/week.js");
  const start = { lat: 30.2556, lon: -97.7208 };
  const v = { a: { neighborhood: "Zilker", lat: 30.26, lon: -97.77 }, b: { neighborhood: "Zilker", lat: 30.26, lon: -97.77 }, c: { neighborhood: null, lat: 30.27, lon: -97.76 }, s1: { lat: 30.07, lon: -97.84 }, s2: { lat: 30.09, lon: -97.83 }, n: { neighborhood: "Wooten", lat: 30.37, lon: -97.72 }, m: { neighborhood: "Mueller", lat: 30.3, lon: -97.7 }, x: { lat: 30.26, lon: -97.72 } };
  const st = (...ids) => ids.map((id) => ({ id }));
  assert.equal(areaName(st("a", "b", "c"), v, start, "Austin"), "Zilker");
  assert.equal(areaName(st("n", "m", "c"), v, start, "Austin"), "Mueller and Wooten");
  assert.equal(areaName(st("s1", "s2"), v, start, "Austin"), "Southwest Austin");
  assert.equal(areaName(st("x"), v, start, "Austin"), "Around your start");
  assert.equal(weekAreas([{ stops: st("a", "b") }, { stops: [] }, { stops: st("s1", "s2"), start }], v, "Austin").replace(/\s+/g, " "), "Zilker day, Southwest Austin day");
});

test("a timed follow-up past the two planned weeks is still an appointment on its usual day", () => {
  const prof = { ...examples(new Date(2026, 9, 24)).find((x) => x.key === "maya").profile, known: [] };
  const R = route("athletic-brewing-austin");
  const id = Object.values(R.venues).find((v) => v.name === "Meanwhile Brewing").id;
  const far = "2026-12-01"; // a Tuesday five weeks out, one of her usual days
  const rowOf = (p) => buildPool({ routes: [R], profile: p, statuses: { [id]: "visited" }, outcomes: { [id]: { result: "followup", followUp: far, followUpTime: "15:00" } }, cityName: "Austin" }).rows.find((r) => r.id === id);
  const span = (r) => r.parsedHours.days.tuesday.spans;
  const held = rowOf(prof);
  assert.equal(span(held).length, 1);
  assert.ok(span(held)[0].from === 900 && span(held)[0].to - span(held)[0].from <= 60, `held to 3 pm: ${JSON.stringify(span(held))}`);
  const dated = rowOf({ ...prof, week: null, windows: prof.windows.filter((w) => w.date < "2026-11-01") });
  assert.ok(span(dated)[0].to - span(dated)[0].from > 60, "dated days that don't reach it: at or after 3 pm, as before");
});
