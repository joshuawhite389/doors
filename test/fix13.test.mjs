// fix13 (phone check of fill by rank, 2026-10-23): (c) reopening a saved multi-week plan gives the plan it saved (it gave
// 32 doors where the first build gave 30: each week's set of doors was re-derived from the saved days, counting the
// on-the-way doors as the week's); (a) "fits Thu Nov 5, but better-ranked doors fill that week first" only where it is
// true (Las Perlas #33 read it while that week's doors were #38–#50).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readJson } from "./helpers.mjs";
import { demoProfile } from "../public/lib/demo-profile.js";
import { routeFiles } from "../public/lib/live.js";
import { buildPool, windowsFor, savedPlan } from "../public/lib/pool.js";
import { planDays } from "../public/lib/schedule.js";

const index = readJson("public/data/index.json");
const TODAY = new Date(2026, 9, 23); // Fri Oct 23: Maya's days are Tue Oct 27 – Thu Oct 29, then Nov 3–5
const plus = (d, n) => {
  const x = new Date(d + "T12:00:00Z");
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
const HOURS = [["11:00", "17:00"], ["12:00", "18:00"], ["13:00", "19:00"], ["14:00", "20:00"], ["15:00", "21:00"]];
const FILES = ["athletic-brewing-austin", "casamigos-austin", "liquid-death-austin", "lacroix-austin", "white-claw-austin", "parsons-austin"];
function inputFor(file, [from, to], weeks = 2, maxPerDay = null) {
  const prof = { ...demoProfile(TODAY), week: null }; // the dated windows below, not her usual week
  const dates = prof.windows.map((w) => w.date);
  prof.windows = Array.from({ length: weeks }, (_, k) => dates.map((d) => ({ date: plus(d, 7 * k), from, to }))).flat();
  if (maxPerDay) prof.maxPerDay = maxPerDay;
  const routes = (file ? [file] : routeFiles(prof, index)).map((f) => readJson(`public/data/routes/${f}.json`));
  const pool = buildPool({ routes, profile: prof, statuses: {}, contacts: [], added: [], cityName: "Austin" });
  return { pool: pool.rows, statuses: pool.statuses, windows: windowsFor(prof), visitMin: prof.visitMin, pinned: pool.pinned, frozen: null, locks: [], now: { date: "2026-10-23", min: 600 } };
}
const sig = (p) => p.days.map((d) => `${d.date} ${d.stops.map((s) => s.id).join()}`);
const reload = (p) => JSON.parse(JSON.stringify(savedPlan(p))); // what the store keeps (web localStorage, phone AsyncStorage)
const CASES = [null, ...FILES].flatMap((f) => HOURS.map((h) => [f, h]));

test("fix13 (c): reopening a saved two-week plan gives the same plan, and so does every reopen after", () => {
  const bad = [];
  for (const [f, h] of CASES) {
    const input = inputFor(f, h);
    const first = planDays(input);
    let p = first;
    for (let i = 0; i < 2; i++) {
      p = planDays({ ...input, previous: reload(p) });
      if (sig(p).join("|") !== sig(first).join("|")) {
        bad.push(`${f ?? "maya"} ${h.join("–")}: ${first.days.map((d) => d.stops.length)} → ${p.days.map((d) => d.stops.length)}`);
        break;
      }
    }
  }
  assert.deepEqual(bad, []);
});

test("fix13 (c): three weeks and a doors-a-day limit reopen the same too", () => {
  const bad = [];
  for (const [f, h] of CASES.filter((c, i) => i % 3 === 0)) {
    for (const [weeks, cap] of [[3, null], [2, 6]]) {
      const input = inputFor(f, h, weeks, cap);
      const first = planDays(input);
      const again = planDays({ ...input, previous: reload(first) });
      if (sig(again).join("|") !== sig(first).join("|")) bad.push(`${f ?? "maya"} ${h.join("–")} ×${weeks} cap ${cap}`);
    }
  }
  assert.deepEqual(bad, []);
});

test("fix13 (a): a door a week took is told about that week's days; 'better-ranked doors fill that week' only when they do", () => {
  let held = 0;
  const bad = [];
  for (const [f, h] of CASES) {
    const input = inputFor(f, h);
    const p = planDays(input);
    const rank = new Map(input.pool.map((r) => [r.id, r.rank]));
    const weekOf = (date) => plus(date, -((new Date(date + "T12:00:00Z").getUTCDay() + 6) % 7));
    const weekIn = new Map(Object.entries(p.weeks).flatMap(([wk, x]) => x.ids.map((id) => [id, wk])));
    for (const [id, r] of Object.entries(p.reasons)) {
      if (!r.date) continue;
      const wk = weekOf(r.date);
      if (weekIn.has(id)) {
        held++;
        if (weekIn.get(id) !== wk) bad.push(`${f ?? "maya"} ${h.join("–")}: #${rank.get(id)} is week ${weekIn.get(id)}'s but reads "${r.text}"`);
      }
      if (r.code !== "lower") continue;
      const theirs = p.days.filter((d) => weekOf(d.date) === wk).flatMap((d) => d.stops).filter((s) => weekIn.get(s.id) === wk).map((s) => rank.get(s.id));
      if (!theirs.length || theirs.some((x) => x > rank.get(id))) bad.push(`${f ?? "maya"} ${h.join("–")}: #${rank.get(id)} "${r.text}" — that week has #${theirs.join(",#")}`);
    }
  }
  assert.deepEqual(bad, []);
  assert.ok(held > 20, `${held} reasons on doors a week took`);
});

test("fix13 (c): a doors-a-day change chooses the weeks' doors again; back to no limit takes the no-limit plan's weeks", async () => {
  const { freshPrevious, uncappedPrevious } = await import("../public/lib/pool.js");
  const input = inputFor(null, HOURS[0]);
  const saved = reload(planDays(input));
  assert.ok(Object.keys(saved.weeks).length === 2, "the store keeps both weeks");
  assert.equal(freshPrevious(saved).weeks, undefined);
  const base = reload(planDays({ ...input, windows: input.windows.map((w) => ({ ...w, max: null })) }));
  assert.deepEqual(uncappedPrevious(saved, base).weeks, base.weeks);
});

test("fix13 (b): a day's name carries its date where the plan has that weekday twice (Your list, Week, the stop)", async () => {
  const { dayLabel } = await import("../public/lib/planview.js");
  const days = [{ date: "2026-10-27", day: "tuesday" }, { date: "2026-10-29", day: "thursday" }, { date: "2026-11-03", day: "tuesday" }, { date: "2026-11-06", day: "friday" }];
  assert.equal(dayLabel(days, days[0]), "Tue Oct 27");
  assert.equal(dayLabel(days, days[2], { short: true }), "Tue Nov 3");
  assert.equal(dayLabel(days, days[1]), "Thursday", "a weekday the plan has once reads as before");
  assert.equal(dayLabel(days, days[3], { short: true }), "Fri");
  assert.equal(dayLabel([days[0]], days[0]), "Tuesday");
});

test("fix13 (b): web and phone name a plan day through dayLabel in Your list, the Week headers, a day's heading and the stop", async () => {
  const { readFileSync } = await import("node:fs");
  const src = (f) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
  const web = src("public/ui/plan.js");
  const phone = src("app-mobile/src/screens/Plan.tsx");
  for (const [name, s] of [["web", web], ["phone", phone]]) {
    assert.doesNotMatch(s, /const where = \(r(: any)?\) => `\$\{dayShort\(plan\.days\[r\.day\]\)\} · stop/, `${name} Your list`);
    assert.match(s, /dayLabel\(plan\.days, plan\.days\[r\.day\], \{ short: true \}\)/, `${name} Your list`);
  }
  assert.doesNotMatch(web, /<b>\$\{esc\(cap\(d\.day\)\)\} \$\{esc\(rangeText/, "web Week header");
  assert.doesNotMatch(phone, /\{cap\(d\.day\)\} \{rangeText\(d\.from, d\.to\)\}/, "phone Week header");
  assert.doesNotMatch(src("public/ui/stop.js"), /esc\(cap\(m\.day\.day\)\) · stop/, "web stop");
  assert.doesNotMatch(src("app-mobile/src/screens/Stop.tsx"), /cap\(m\.day\.day\)\} · stop/, "phone stop");
});

test("fix13: a door closed on a weekday says it once when the two weeks' hours differ (web shot: 'closed Tuesday, Wednesday, Thursday, Tuesday, …')", () => {
  const input = inputFor(null, HOURS[0]);
  input.windows = input.windows.map((w, i) => (i < 3 ? { ...w, from: w.from + 60 } : w)); // week 1's hours ≠ week 2's
  const shut = { ...input.pool[0], id: "shut", rank: 1, hours: null, parsedHours: { ok: true, days: Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((d) => [d, d === "friday" ? { spans: [{ from: 660, to: 1320 }] } : { closed: true, spans: [] }])) } };
  const p = planDays({ ...input, pool: [shut, ...input.pool.slice(1)] });
  assert.equal(p.reasons.shut?.text, "closed Tuesday, Wednesday and Thursday");
});

test("fix13: an hours reason says each part once when the two weeks' hours differ ('opens 6 pm Thursday, after your window' twice)", () => {
  const input = inputFor(null, HOURS[0]);
  input.windows = input.windows.map((w, i) => (i < 3 ? { ...w, from: w.from + 60 } : w));
  const days = Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((d) => [d, d === "thursday" ? { spans: [{ from: 1080, to: 1380 }] } : { closed: true, spans: [] }]));
  const late = { ...input.pool[0], id: "late", rank: 1, hours: null, parsedHours: { ok: true, days } };
  const p = planDays({ ...input, pool: [late, ...input.pool.slice(1)] });
  assert.equal(p.reasons.late?.text, "closed Tuesday and Wednesday · opens 6 pm Thursday, after your window");
});

test("fix13 (a): a door a week took but could not place goes to the next week open for it (Las Perlas #33 sat off while week 2 held #38–#50)", () => {
  const bad = [];
  for (const [f, h] of CASES) {
    const input = inputFor(f, h);
    const p = planDays(input);
    const weeks = Object.keys(p.weeks).sort();
    const on = new Set(p.days.flatMap((d) => d.stops.map((s) => s.id)));
    for (const wk of weeks.slice(0, -1)) for (const id of p.weeks[wk].ids) if (!on.has(id)) bad.push(`${f ?? "maya"} ${h.join("–")}: ${id} held by ${wk}, off the plan`);
  }
  assert.deepEqual(bad, []);
});
