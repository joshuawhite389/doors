// The rep's usual week (Jard 10-24: "this is my schedule, some weeks it changes, but more or less i want a plan for the
// week, every week"): the days they are free, repeating every week, plus changes to one date. Doors plans from it on a
// rolling horizon: this week and the next, more when a follow-up or a moved door is due later, so a date off the old
// one-week list still lands on a real day. Pure: no DOM, no clock (the caller passes `today`). Covered by
// test/week.test.mjs.
//
// profile.week = {days: {tuesday: {from:"14:00", to:"18:00", start?}}, changes: {"2026-10-27": {off:true} |
//   {from, to, start?}}, since: "2026-10-24" | null}
//   days: the usual week, by weekday; start: that weekday's own start ({label, lat, lon, source}), else the profile's.
//   changes: one date only. {off:true} takes a usual day off; {from, to} sets that date's hours (a usual day's, or a day
//   added for that date only).
//   since: the first date the week applies (the day it was set up): the days of that week before it are not planned.
//   ahead (optional): weeks planned ahead, AHEAD_WEEKS when absent (the guided demo plans its one week: ahead 1).
// A profile with a week plans on weekDates(week) (lib/pool.js windowsFor); profile.windows holds the same dated days
// for the readers that list them. A profile without one (a plan saved before, the proof's scenarios, the examples) plans
// on its own dated windows, as before.
import { DAYS } from "./core.js";

export const AHEAD_WEEKS = 2; // this week and the next
export const MAX_WEEKS = 12; // a follow-up further out than this is not planned yet
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const utc = (date) => new Date(`${date}T12:00:00Z`);
// "2026-10-24" + 3 → "2026-10-27"
export function addDays(date, n) {
  const d = utc(date);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}
// the Monday of a date's week
export function mondayOf(date) {
  const d = utc(date);
  return addDays(date, -((d.getUTCDay() + 6) % 7));
}
export const weekdayOf = (date) => DAYS[(utc(date).getUTCDay() + 6) % 7];
// today as "YYYY-MM-DD" (local calendar date), from a Date or a date string
export const dateOf = (today) => (typeof today === "string" ? today.slice(0, 10) : `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`);

export const emptyWeek = () => ({ days: {}, changes: {}, since: null });

const hoursOf = (x) => ({ from: x.from, to: x.to, ...(x.start ? { start: structuredClone(x.start) } : {}) });

// A week read from dated windows (a profile saved before the usual week; the form opening one): each weekday takes its
// first window's hours and start.
export function weekFromWindows(windows = [], since = null) {
  const week = emptyWeek();
  for (const w of [...windows].filter((x) => DATE_RE.test(x?.date ?? "")).sort((a, b) => a.date.localeCompare(b.date))) {
    const day = weekdayOf(w.date);
    if (!week.days[day]) week.days[day] = hoursOf(w);
  }
  week.since = since;
  return week;
}

// The horizon: from the Monday of today's week through the Sunday of the `weeks`th week from today's week (from
// `since`'s, when later), and on through the week holding `until` (a later follow-up or moved door), at most MAX_WEEKS
// weeks past that Monday (`cap`, its last date).
export function horizon(week, { today, weeks = week?.ahead ?? AHEAD_WEEKS, until = null } = {}) {
  const first = mondayOf(dateOf(today ?? new Date()));
  const mon = week?.since && DATE_RE.test(week.since) && week.since > first ? mondayOf(week.since) : first;
  let last = addDays(mon, 7 * Math.max(1, weeks) - 1);
  const cap = addDays(mon, 7 * MAX_WEEKS - 1);
  if (until && DATE_RE.test(until) && until > last) last = addDays(mondayOf(until), 6);
  if (last > cap) last = cap;
  return { first, last, cap };
}

// A date's hours on the week: {from, to, start?} | null (not free). A change for that date says; else its weekday's
// usual hours, from `since` on.
export function hoursOn(week, date) {
  const ch = week?.changes?.[date];
  if (ch?.off) return null;
  if (ch?.from && ch?.to) return hoursOf(ch);
  const u = week?.days?.[weekdayOf(date)];
  if (!u?.from || !u?.to || (week.since && date < week.since)) return null;
  return hoursOf(u);
}

// The dated days the week gives over the horizon, as profile windows: [{date, from, to, start?}], by date. With
// `until`, the horizon runs on a week at a time until a free day on or after it (a follow-up on a day the rep isn't
// free lands on the next free day, so that day must be planned).
export function weekDates(week, opts = {}) {
  if (!week) return [];
  const { first, last, cap } = horizon(week, opts);
  const out = [];
  const add = (from, to) => {
    for (let d = from; d <= to; d = addDays(d, 1)) {
      const h = hoursOn(week, d);
      if (h) out.push({ date: d, ...h });
    }
  };
  add(first, last);
  const until = DATE_RE.test(opts.until ?? "") ? opts.until : null;
  for (let end = last; until && !out.some((w) => w.date >= until) && end < cap; end = addDays(end, 7)) add(addDays(end, 1), addDays(end, 7));
  return out;
}

// One date's change: {off:true} | {from, to, start?} | null (back to the usual week). A change that says what the usual
// week already says is dropped.
export function setChange(week, date, change) {
  const out = { ...week, changes: { ...(week?.changes ?? {}) } };
  delete out.changes[date];
  const usual = week?.days?.[weekdayOf(date)];
  if (change?.off) {
    if (usual) out.changes[date] = { off: true };
  } else if (change?.from && change?.to) {
    const same = usual && !(week.since && date < week.since) && usual.from === change.from && usual.to === change.to && JSON.stringify(usual.start ?? null) === JSON.stringify(change.start ?? null);
    if (!same) out.changes[date] = hoursOf(change);
  }
  return out;
}

// The week for another city: the same days and hours, no day's own start (a start is a place in the old city).
export function withoutStarts(week) {
  if (!week) return week ?? null;
  const strip = (o) => Object.fromEntries(Object.entries(o ?? {}).map(([k, { start, ...x }]) => [k, x]));
  return { ...week, days: strip(week.days), changes: strip(week.changes) };
}

// The changes still ahead (on or after `today`): the form keeps no past ones.
export function pruneChanges(week, today) {
  const t = dateOf(today ?? new Date());
  return { ...week, changes: Object.fromEntries(Object.entries(week?.changes ?? {}).filter(([d]) => d >= t)) };
}

// A profile's dated days now: the week's over the horizon, else its own windows.
export const datedWindows = (profile, opts = {}) => (profile?.week ? weekDates(profile.week, opts) : profile?.windows ?? []);
// The profile with its windows rolled to today (the readers that list profile.windows see this week and the next).
export const rolled = (profile, opts = {}) => (profile?.week ? { ...profile, windows: weekDates(profile.week, opts) } : profile);

// One date's hours changed from the plan (the Agent's "end Tuesday at 5"): a date change on the week, else that
// window's own hours. → the profile, changed in place.
export function setDateHours(profile, date, { from, to }) {
  if (profile.week) {
    const ch = profile.week.changes?.[date];
    const cur = ch?.from && ch?.to ? ch : profile.week.days?.[weekdayOf(date)];
    if (cur) profile.week = setChange(profile.week, date, { ...hoursOf(cur), ...(from ? { from } : {}), ...(to ? { to } : {}) });
  }
  profile.windows = (profile.windows ?? []).map((x) => (x.date === date ? { ...x, ...(from ? { from } : {}), ...(to ? { to } : {}) } : x));
  return profile;
}

// A follow-up's checks (lib/fu-check.js) read the plan's windows; a date past the plan's last day is on the usual week,
// which the next plan reaches out to (untilFor). The plan's windows ({date, from, to} minutes) and, after its last
// day, the week's days through `until` and on to the next free one.
const mins = (s) => { const [h, m] = String(s).split(":").map(Number); return h * 60 + m; };
export function reachWindows(windows = [], week = null, until = null, today = undefined) {
  if (!week || !DATE_RE.test(until ?? "")) return windows;
  const last = windows.map((w) => w?.date).filter(Boolean).sort().at(-1) ?? "";
  const more = weekDates(week, { until, today }).filter((w) => w.date > last).map((w) => ({ date: w.date, day: weekdayOf(w.date), from: mins(w.from), to: mins(w.to) }));
  return more.length ? [...windows, ...more] : windows;
}

// The latest date the plan must reach: the follow-ups' and the day locks' (a door moved to a date), so the horizon
// covers them (weekDates: and the next free day after, when the rep isn't free that day). → "YYYY-MM-DD" | null
export function untilFor(pinned = [], locks = []) {
  return [...pinned.map((p) => p?.date), ...locks.map((l) => l?.date)].filter((d) => DATE_RE.test(d ?? "")).sort().at(-1) ?? null;
}

// The usual week in words: "Tue 2–6 pm, Wed 2–6 pm" (clock: minutes → "2 pm").
export function weekWords(week, clock) {
  const m = (s) => { const [h, mi] = String(s).split(":").map(Number); return h * 60 + mi; };
  return DAYS.filter((d) => week?.days?.[d]).map((d) => `${d[0].toUpperCase()}${d.slice(1, 3)} ${clock(m(week.days[d].from))}–${clock(m(week.days[d].to))}`).join(", ");
}

// The plan over weeks (Jard 10-24: "tackle the city over weeks"): the doors on each week's days, and how many ranked
// doors are left on Your list for the weeks after. days: the plan's; left: the doors on no day.
// → "Week of Oct 26: 18 doors · Week of Nov 2: 17 doors · 12 left on Your list" ("" for one week, which the day tabs
// already count).
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function weeksOf(days = []) {
  const by = new Map();
  for (const d of days) {
    if (!d?.date) continue;
    const wk = mondayOf(d.date);
    if (!by.has(wk)) by.set(wk, { week: wk, days: 0, ids: new Set() });
    const w = by.get(wk);
    w.days++;
    for (const s of d.stops ?? []) w.ids.add(s.id);
  }
  return [...by.values()].sort((a, b) => a.week.localeCompare(b.week)).map((w) => ({ week: w.week, days: w.days, doors: w.ids.size }));
}
export const weekLabel = (monday) => `Week of ${MONTHS[+monday.slice(5, 7) - 1]} ${+monday.slice(8, 10)}`;
export function weeksLine(days = [], left = null) {
  const ws = weeksOf(days);
  if (ws.length < 2) return "";
  const parts = ws.map((w) => `${weekLabel(w.week)}: ${w.doors} door${w.doors === 1 ? "" : "s"}`);
  if (Number.isFinite(left)) parts.push(`${left} left on Your list`);
  return parts.join(" · ");
}

// A day's area in words, for the week heads (gigbot 10-25: "Week of Nov 2: East Austin day, South Lamar day"): the
// neighbourhood at least half its doors share, else its two most common ones together, else its direction from the
// day's start ("South Austin"; "Around your start" within NEAR_KM). stops: [{id}], venues: {id: {neighborhood, lat,
// lon}}, start: {lat, lon}, city: the city's name. → "" for a day with no doors.
const NEAR_KM = 3;
const COMPASS = ["East", "Northeast", "North", "Northwest", "West", "Southwest", "South", "Southeast"];
export function areaName(stops = [], venues = {}, start = null, city = "") {
  const vs = stops.map((s) => venues?.[s.id]).filter(Boolean);
  if (!vs.length) return "";
  const count = new Map();
  for (const v of vs) if (v.neighborhood) count.set(v.neighborhood, (count.get(v.neighborhood) ?? 0) + 1);
  const top = [...count].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (top[0] && top[0][1] * 2 >= vs.length) return top[0][0];
  if (top[1] && (top[0][1] + top[1][1]) * 2 >= vs.length) return `${top[0][0]} and ${top[1][0]}`;
  const pts = vs.filter((v) => Number.isFinite(v.lat) && Number.isFinite(v.lon));
  if (!pts.length || !Number.isFinite(start?.lat)) return top[0]?.[0] ?? "";
  const c = { lat: pts.reduce((a, v) => a + v.lat, 0) / pts.length, lon: pts.reduce((a, v) => a + v.lon, 0) / pts.length };
  const dy = c.lat - start.lat;
  const dx = (c.lon - start.lon) * Math.cos((start.lat * Math.PI) / 180);
  if (Math.hypot(dx, dy) * 111.2 < NEAR_KM) return "Around your start";
  const dir = COMPASS[Math.round((((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360) / 45) % 8];
  return city ? `${dir} ${city}` : dir;
}
// A week's days by area: "East Cesar Chavez day, South Austin day" (days with doors, in date order, each area once).
export function weekAreas(days = [], venues = {}, city = "") {
  const names = days.filter((d) => d?.stops?.length).map((d) => areaName(d.stops, venues, d.start, city)).filter(Boolean);
  return [...new Set(names)].map((n) => `${n} day`).join(", ");
}
