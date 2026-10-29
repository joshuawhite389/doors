// The day flow of drive mode (Jard 10-23, items 5-9): pause and resume "Start my day", take a door off today's route
// or end the route, and the Day done debrief: every door of the day accounted for under the words the logging buttons
// use, its notes, the follow-ups booked, what to do next. Facts only from what was logged (the honesty line): rules
// over the plan, no model, so it works offline and costs nothing. Pure: no DOM, no clock, no storage (the caller passes
// `now` and the day's record). Shared by ui/drive.js, ui/plan.js and the React Native app. Covered by
// test/dayflow.test.mjs.
import { notesOf, hasNote } from "./door-notes.js";
import { redactDeep, contactOf, namesIn } from "./slots.js";
import { followUpPlace, shortDate } from "./outcome.js";
import { dayOf, niceDate, toMinutes } from "./profile.js";
import { clockShort, estimateTravel, WAIT_MAX_MIN, END_SLACK_MIN } from "./schedule.js";
import { parseHours, openMinutes } from "./core.js";
import { nextOpenDay, shutOn } from "./fu-check.js";
import { isDoneStop, offEveryDay } from "./drive-day.js";

// ---------- the day's record ----------
// One per plan day the rep drives, saved with the plan (store state `drive`: {[date]: record}):
// {started: stamp, paused: stamp | null, ended: stamp | null, removed: [{id, how: "later" | "dropped" | "end", at}],
//  skipped: [id], moved: [{to: date, ids: [id]}] | null, bumped: [{id, from: date}]}
// how: "later" / "dropped" = Remove from today (not part of the day's tally); "end" = left when End my day ran (Not
// visited); "endlist" = left when Stop for today put them back on Your list (Not visited, no roll; lib/day-stop.js).
// changes: [{kind: "stop" | "late", how: "days" | "list", at, ids, by?}] the day's Stop for today and running late
// re-homes, for Changes you made and its Undo (lib/day-stop.js). moved: the doors End my day rolled onto the plan days ahead (rollDay; most go on the next one), so such a
// day may hold more than its cap.
// A stamp is the local "YYYY-MM-DDTHH:MM" (outcome.js localStamp).
export const emptyRecord = () => ({ started: null, paused: null, ended: null, removed: [], skipped: [], moved: null });
export const recordOf = (drive, date) => ({ ...emptyRecord(), ...(drive?.[date] ?? {}) });
// drive → the same with `date`'s record patched (a function or an object); the input is not changed.
export function patchRecord(drive, date, patch) {
  const r = recordOf(drive, date);
  return { ...(drive ?? {}), [date]: { ...r, ...(typeof patch === "function" ? patch(r) : patch) } };
}
// A door taken off the day: the newest call for it wins (moved later, then dropped, says dropped).
export const withRemoved = (r, id, how, at) => ({ ...r, removed: [...(r.removed ?? []).filter((x) => x.id !== id), { id, how, at }] });

// What the plan's "Start my day" button says: "Resume my day" while today's drive is under way (started, not ended,
// doors left), with where the rep left off. → {label, resume, text}
// stopped (web, Stop for today): a day stopped today says Resume my day too, and brings the stopped doors back.
export function startButton(plan, drive, now, { stopped = false } = {}) {
  const r = recordOf(drive, now?.date);
  const last = (r.changes ?? []).at(-1);
  if (stopped && r.ended && last?.kind === "stop" && last.ids?.length) {
    const n = last.ids.length;
    return { label: "Resume my day", resume: true, stopped: true, text: `Brings back the ${n === 1 ? "door" : `${n} doors`} you stopped` };
  }
  const k = (plan?.days ?? []).findIndex((d) => d?.date === now?.date && d.stops?.length);
  if (k < 0 || !r.started || r.ended) return { label: "Start my day", resume: false, text: "" };
  const d = plan.days[k];
  const left = d.stops.filter((s) => !isDoneStop(plan, d, s));
  if (!left.length) return { label: "Start my day", resume: false, text: "" };
  const done = d.stops.length - left.length;
  const name = plan.venues?.[left[0].id]?.name ?? "the next door";
  return { label: "Resume my day", resume: true, text: `${done} of ${d.stops.length} done · next: ${name}` };
}

// ---------- taking doors off the day ----------
// The saved plan (store.js `plan`) with `ids` off the plan day `day` ({date, from}). The planner keeps the frozen day
// as the rep has it, so they stay off it and the other doors keep their order; the days ahead are planned again and
// may take them. → the new saved plan, or null when the day or none of the doors is in it.
export function dropFromDay(saved, day, ids) {
  const k = saved?.days?.findIndex((d) => d && d.date === day?.date && (d.from == null || day.from == null || d.from === day.from)) ?? -1;
  if (k < 0) return null;
  const out = new Set(ids);
  const d = saved.days[k];
  if (!d.stops?.some((s) => out.has(s.id))) return null;
  const days = saved.days.slice();
  days[k] = { ...d, stops: d.stops.filter((s) => !out.has(s.id)) };
  return { ...saved, days };
}

// Where a door taken off `date` is now: "On Tue Oct 27, stop 3" | "Not on a day" | "Dropped from the plan".
export function whereNow(plan, id, date) {
  if (plan?.statuses?.[id] === "notfit") return { text: "Dropped from the plan", dayIndex: -1, dropped: true };
  const days = plan?.days ?? [];
  for (let i = 0; i < days.length; i++) {
    const d = days[i];
    if (!d || d.past || d.date === date) continue;
    const k = d.stops.findIndex((s) => s.id === id);
    if (k >= 0) return { text: `On ${niceDate(d.date)}, stop ${k + 1}`, dayIndex: i, dropped: false };
  }
  return { text: "Not on a day", dayIndex: -1, dropped: false };
}

// ---------- End my day: the doors left roll to the next plan day ----------
// (Jard: no door lost, no re-adding forever): the doors not visited go to the next plan day, first, in
// rank order; one shut all that day, or past what its hours hold, is left to the planner (it may find it another day,
// else Not on a day). That day
// may go past its doors-a-day cap by the doors rolled onto it (capsWithRolled), and the debrief says so.
// The plan day after `date` (not past). → its index, or -1
export const nextPlanDay = (plan, date) => (plan?.days ?? []).findIndex((d) => d && !d.past && d.date > date);
// The later plan days `date`'s rolled doors may go to instead ("Choose another day"). → [{i, date}]
export const laterDays = (plan, date) => (plan?.days ?? []).flatMap((d, i) => (d && !d.past && d.date > date ? [{ i, date: d.date }] : []));
// rollPlan(plan, ids, to, {visitMin, shut, travel}) → {ids: the doors that go at the end of day `to`, in rank order,
// left: the rest}. The roll never pushes a planned door off. A day ahead keeps its own doors; the rolled
// ones only fill the time it has left after its last stop: driven to (travel, the planner's estimate), open on arrival
// or within a short wait (WAIT_MAX_MIN), out by the window's end. shut(venue, window) → a reason when the door can't be
// visited that day (fu-check.js shutOn).
export function rollPlan(plan, ids, to, { visitMin = 25, shut = () => null, travel = estimateTravel } = {}) {
  const d = plan?.days?.[to];
  // rank: the venue's, else its place on Your list (plan.pool.ids, best first)
  const rank = (id) => {
    const r = plan?.venues?.[id]?.rank;
    if (Number.isFinite(r)) return r;
    const k = plan?.pool?.ids?.indexOf(id) ?? -1;
    return k >= 0 ? k + 1 : Infinity;
  };
  const sorted = [...ids].sort((a, b) => rank(a) - rank(b) || String(a).localeCompare(String(b)));
  if (!d) return { ids: [], left: sorted };
  const v = (id) => plan?.venues?.[id];
  const own = (d.stops ?? []).filter((s) => !ids.includes(s.id));
  const last = own.at(-1);
  let at = last ? v(last.id) : d.start ?? null;
  let t = last ? (Number.isFinite(last.depart) ? last.depart : (last.eta ?? d.from) + visitMin) : d.from;
  const fit = [];
  for (const id of sorted) {
    const x = v(id);
    if (!x || shut(x, { date: d.date, from: d.from, to: d.to, visitMin })) continue;
    const leg = at && Number.isFinite(x.lat) ? travel(at, x).min : 0;
    if (!Number.isFinite(leg)) continue;
    const arrive = Math.ceil(t + leg);
    // open on arrival, else the first minute it is within WAIT_MAX_MIN (hours unknown: as the planner, open)
    const hours = x.parsedHours?.ok != null ? x.parsedHours : parseHours(x.hours ?? null);
    let start = null;
    for (let w = arrive; w <= arrive + WAIT_MAX_MIN; w += 5) {
      const m = openMinutes(hours, dayOf(d.date), w, w + visitMin);
      if (m == null || m >= visitMin) { start = w; break; }
    }
    if (start == null || start + visitMin > d.to - END_SLACK_MIN) continue;
    fit.push(id);
    at = x;
    t = start + visitMin;
  }
  return { ids: fit, left: sorted.filter((id) => !fit.includes(id)) };
}
// The doors the rolled ones pushed off the days ahead: `was` = [[date, ids]] before rollDay, `plan` after; kept with
// the ones pushed off before (Choose another day) while they are still off the day they were on. → [{id, from}]
export function bumpedBy(plan, was, moved, before = []) {
  const on = (id, date) => (plan?.days ?? []).some((d) => d && d.date === date && d.stops.some((s) => s.id === id));
  const now = was.flatMap(([date, ids]) => ids.filter((id) => !moved.includes(id) && !on(id, date)).map((id) => ({ id, from: date })));
  const keep = (before ?? []).filter((b) => !moved.includes(b.id) && !on(b.id, b.from) && !now.some((x) => x.id === b.id));
  return [...keep, ...now];
}
// The debrief's line for them: "To make room on Wed Oct 28: A (now Thu Oct 29, stop 3), B (not on a day)."
function bumpedLine(plan, record, date) {
  const xs = (record?.bumped ?? []).filter((b) => !(plan?.days ?? []).some((d) => d && d.date === b.from && d.stops.some((s) => s.id === b.id)));
  const by = new Map();
  for (const b of xs) by.set(b.from, [...(by.get(b.from) ?? []), b.id]);
  return [...by].map(([from, ids]) => `To make room on ${niceDate(from)}: ${ids.map((id) => {
    const w = whereNow(plan, id, date);
    return `${plan?.venues?.[id]?.name ?? "a door"} (${w.dayIndex >= 0 ? `now ${w.text.replace(/^On /, "")}` : w.dropped ? "dropped from the plan" : "not on a day"})`;
  }).join(", ")}.`).join(" ");
}
// What End my day will do with `ids` (the sheet says it before the rep taps, mobile2 10-23: it promised a door that
// then went on no day): rollPlan over the plan days after `date`, as rollDay cascades, by the doors' hours. The planner
// may still move one a day on (it arrives before it opens), never back. → {groups: [{to, ids}], stuck: [{id, why}]}
export function rollPreview(plan, ids, date, { visitMin = plan?.profile?.visitMin ?? 25, shut = shutOn } = {}) {
  const groups = [];
  let pending = [...ids];
  for (const { i, date: to } of laterDays(plan, date)) {
    if (!pending.length) break;
    const r = rollPlan(plan, pending, i, { visitMin, shut });
    if (r.ids.length) groups.push({ to, ids: r.ids });
    pending = r.left;
  }
  return { groups, stuck: pending.map((id) => ({ id, why: stuckWhy(plan, id, date, { visitMin, shut }) })) };
}
// Why a door End my day took off is on no day: "not open during any later day's hours" | "no time left on a later day" |
// "no later day in the plan"
export function stuckWhy(plan, id, date, { visitMin = plan?.profile?.visitMin ?? 25, shut = shutOn } = {}) {
  const later = laterDays(plan, date).map(({ i }) => plan.days[i]);
  if (!later.length) return "no later day in the plan";
  return later.every((d) => shut(plan?.venues?.[id], { date: d.date, from: d.from, to: d.to, visitMin })) ? "not open during any later day's hours" : "no time left on a later day";
}
// The End sheet's sentence for the doors left: where they go, and which can't go anywhere and why
export function endSheetText(plan, ids, date) {
  if (!ids.length) return "Every door is logged.";
  const nm = (id) => plan?.venues?.[id]?.name ?? "a door";
  const { groups, stuck } = rollPreview(plan, ids, date);
  const one = ids.length === 1;
  // each door named once: in where it goes (mobile2 10-23: twice was 3 screens at AX5)
  const head = `${one ? "1 door isn't" : `${ids.length} doors aren't`} visited yet.`;
  // the end of that day, in the time it has left (its own doors stay); the planner's roads can still move one a day on
  const go = groups.map((g) => `${g.ids.map(nm).join(", ")} ${g.ids.length === 1 ? "goes" : "go"} at the end of ${niceDate(g.to)}${laterDays(plan, g.to).length ? `, or the day after if the drive runs long` : ""}.`);
  // each door with its own reason, as the Day done card (mobile2 10-23: the sheet gave all of them the first one's)
  const byWhy = new Map();
  for (const x of stuck) byWhy.set(x.why, [...(byWhy.get(x.why) ?? []), x.id]);
  const why = [...byWhy].map(([w, xs]) => `${xs.map(nm).join(", ")} ${xs.length === 1 ? "goes" : "go"} on Your list, not on a day: ${w}.`).join(" ");
  const keep = groups.length ? "The doors already on those days stay." : "";
  return [head, ...go, why, keep].filter(Boolean).join(" ");
}
// A record's moved groups ({to, ids} saved before the cascade reads as one). → [{to, ids}]
const groupsOf = (r) => (Array.isArray(r?.moved) ? r.moved : r?.moved ? [r.moved] : []).filter((g) => g?.to && g.ids?.length);
// Every door End my day moved from a record. → [id]
export const movedIds = (r) => groupsOf(r).flatMap((g) => g.ids);
// The doors rolled onto each date that still sit there (locks): {date: n}
// (End my day's, and running late's moves: r.lateMoved, the same shape; they come on top of a day's cap alike)
export function rolledOnto(drive, locks = []) {
  const out = {};
  for (const r of Object.values(drive ?? {}))
    for (const m of [...groupsOf(r), ...(r?.lateMoved ?? []).filter((g) => g?.to && g.ids?.length)]) {
      const n = (locks ?? []).filter((l) => l && l.date === m.to && m.ids.includes(l.id)).length;
      if (n) out[m.to] = (out[m.to] ?? 0) + n;
    }
  return out;
}
// The planner's windows with a capped day's cap raised by the doors rolled onto it (they come on top of its own).
export function capsWithRolled(windows, drive, locks) {
  const n = rolledOnto(drive, locks);
  return (windows ?? []).map((w) => (Number.isInteger(w?.max) && n[w.date] ? { ...w, max: w.max + n[w.date] } : w));
}
// The debrief's line for the rolled doors. → {text, head, body, cap, to, ids, choose: [{i, date}], none} | null
// "Moved to Wed Oct 28: A, B." (+ " Thu Oct 29: C." for one that fit only a later day); cap: a day now past its cap.
// none: no later plan day (they are on Your list, not on a day): the caller offers to add a day.
export function movedLine(plan, record, date) {
  const r = record ?? emptyRecord();
  const names = (xs) => xs.map((id) => plan?.venues?.[id]?.name ?? "a door").join(", ");
  // End my day's doors on no day now (not dropped), and why: "Not on a day: Bunny Slope (not open during … hours)."
  const off = !r.ended ? [] : (r.removed ?? []).filter((x) => atEnd(x, r) && x.how !== "endlist" && whereNow(plan, x.id, date).dayIndex < 0 && plan?.statuses?.[x.id] !== "notfit").map((x) => x.id);
  // Stop for today's "Put them back on Your list": on no day by the rep's choice, not for want of room
  const listed = !r.ended ? [] : (r.removed ?? []).filter((x) => x.how === "endlist" && whereNow(plan, x.id, date).dayIndex < 0 && plan?.statuses?.[x.id] !== "notfit").map((x) => x.id);
  const listLine = listed.length ? `Back on Your list: ${names(listed)}.` : "";
  const stuckLine = () => (off.length ? `Not on a day: ${off.map((id) => `${names([id])} (${stuckWhy(plan, id, date)})`).join(", ")}.` : "");
  const groups = groupsOf(r).map((g) => {
    const d = (plan?.days ?? []).find((x) => x && !x.past && x.date === g.to);
    return { d, ids: d ? g.ids.filter((id) => d.stops.some((s) => s.id === id)) : [] };
  }).filter((g) => g.ids.length);
  if (groups.length) {
    const caps = groups.map(({ d }) => {
      const max = plan.windows?.find((w) => w?.date === d.date)?.max; // plan.windows: the profile's caps (only the planner gets capsWithRolled)
      return Number.isInteger(max) && d.stops.length > max ? `${niceDate(d.date)} now has ${plural(d.stops.length, "door")}, ${d.stops.length - max} over your ${max} a day.` : "";
    }).filter(Boolean);
    const one = groups.length === 1 ? groups[0].d.date : null;
    const text = `Moved to ${groups.map((g) => `${niceDate(g.d.date)}: ${names(g.ids)}.`).join(" ")}`;
    // the debrief's card: a heading and the rest (the toast says `text`)
    const head = one ? `Moved to ${niceDate(one)}` : "Moved to the days ahead";
    const body = one ? `${names(groups[0].ids)}.` : groups.map((g) => `${niceDate(g.d.date)}: ${names(g.ids)}.`).join(" ");
    const more = [stuckLine(), listLine, bumpedLine(plan, r, date)].filter(Boolean).join(" ");
    return { to: groups[0].d.date, ids: groups.flatMap((g) => g.ids), text, head, body: `${body}${more ? ` ${more}` : ""}`, cap: caps.join(" "), choose: laterDays(plan, date).filter((x) => x.date !== one), none: false };
  }
  if (!r.ended) return null;
  if (listed.length && !off.length) return { to: null, ids: listed, text: listLine, head: "Back on Your list", body: `${names(listed)}. Add ${listed.length === 1 ? "it" : "them"} to a day from Your list when you want.`, cap: "", choose: [], none: false };
  if (off.length && laterDays(plan, date).length) {
    const text = stuckLine();
    return { to: null, ids: off, text, head: "Not on a day", body: text, cap: "", choose: [], none: false };
  }
  if (!off.length) return null;
  const text = `No day after this one in the plan, so ${names(off)} ${off.length === 1 ? "is" : "are"} not on a day.`;
  return { to: null, ids: off, text, head: "Not on a day", body: text, cap: "", choose: [], none: true };
}

// ---------- the debrief ----------
// The buckets, one per logging answer, in GLOSSARY.md's outcome names (doors-words draft, 10-23: Interested · Follow up
// <day> · Talked to someone else · Not interested · Just visited; words phase 2 swaps them here if Jard changes them),
// plus the doors not visited. Every door of the day is in exactly one.
export const BUCKETS = [
  { key: "interested", label: "Interested" },
  { key: "followup", label: "Follow up" },
  { key: "someone", label: "Talked to someone else" },
  { key: "no", label: "Not interested" },
  { key: "visited", label: "Just visited" },
  { key: "notvisited", label: "Not visited" },
];
const LABEL = Object.fromEntries(BUCKETS.map((b) => [b.key, b.label]));
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const bucketOf = (o) => (o?.result && LABEL[o.result] && o.result !== "notvisited" ? o.result : "visited");

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const WD = /\b(mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?|sun)(?:day)?s?\b/i;
// "manager back Thursdays" → "thursday"
export const weekdayIn = (text) => {
  const m = WD.exec(String(text ?? ""));
  if (!m) return null;
  const k = m[1].slice(0, 3).toLowerCase();
  return WEEKDAYS.find((d) => d.startsWith(k)) ?? null;
};

// The day's notes on a door: the notes written that day, newest first, and the visit's own note when it isn't one.
function dayNotes(plan, id, date) {
  const all = notesOf(plan?.slots, id);
  const out = all.filter((n) => String(n.at ?? "").slice(0, 10) === date);
  const o = plan?.outcomes?.[id];
  if (o?.note && !hasNote(out, o.note)) out.push({ id: `visit|${id}`, text: o.note, by: "rep", who: "You, at the visit", at: o.at ?? null });
  return out.map((n) => ({ id: n.id, text: n.text, who: n.who, by: /^Ask Doors|Doors Agent/.test(n.who ?? "") ? "doors-agent" : n.by === "drive" ? "rep" : n.by ?? "rep", at: n.at ?? null }));
}

// End my day's doors: how "end", or (records saved before 10-23 pm) "later" stamped with the day's end
const atEnd = (r, record) => r.how === "end" || r.how === "endlist" || (r.how === "later" && record.ended != null && r.at != null && r.at === record.ended);

// ---------- the day's facts (Doors Agent spec §9) ----------
// What a promise sounds like in the rep's words ("said I'd bring samples Thursday", "will email the sell sheet")
export const PROMISE = /\b(?:I'?ll|I'?d|I will|we'?ll|we will|will|promised(?: to)?|going to)\s+(?:send|bring|drop(?: off| by)?|email|text|call|get (?:them|him|her|you)|follow up|come back|stop by)\b/i;
const hhmm = (m) => (Number.isFinite(m) ? `${String(Math.floor(Math.round(m) / 60)).padStart(2, "0")}:${String(Math.round(m) % 60).padStart(2, "0")}` : null);

// dayFacts(plan, q, record, {redact}) → the facts of the day, as data (JSON-safe), for the Doors Agent to write from
// and for the Day done screen to render from (debrief). Only what was logged or planned; nothing guessed.
// {v: 1, date, ended, totals: {planned, visited, notReached, removed},
//  doors: [{id, n, name, status: "visited" | "not-reached", skipped, result, resultLabel, logged, who, whoRole, said,
//           followUp: {date, time, onDay, stop} | null, notes: [{text, by, at}], promises: [{text, from}],
//           where: {text, date, stop} | null}],
//  removed: [{id, name, reason: "off today" | "dropped from the plan", where, notes}],
//  notReached: [{id, name, where}], moved: movedLine(…) | null,
//  tomorrow: {date, doors: n, followUps: n, first: [{id, name, eta, followUp}]} | null,
//  openFollowUps: [{id, name, date, time, onDay, stop, fromToday}], bumped: [{id, name, from, where}]}
// redact (default true): contacts' and the rep's names become "the contact" (slots.js redact, as the Worker does), so
// the result can go to a model as is. The screen passes redact: false.
export function dayFacts(plan, q, record = emptyRecord(), { redact = true } = {}) {
  const date = q?.day?.date ?? null;
  const venue = (id) => plan?.venues?.[id];
  const where = (id) => {
    const w = whereNow(plan, id, date);
    return { text: w.text, date: w.dayIndex >= 0 ? plan.days[w.dayIndex].date : null, stop: w.dayIndex >= 0 ? plan.days[w.dayIndex].stops.findIndex((s) => s.id === id) + 1 : null, dropped: w.dropped };
  };
  const fu = (id, o) => {
    if (!o?.followUp) return null;
    const at = followUpPlace(plan, id, o.followUp);
    return { date: o.followUp, time: /^\d{2}:\d{2}$/.test(o.followUpTime ?? "") ? o.followUpTime : null, onDay: at.dayIndex >= 0 ? at.day.date : null, stop: at.n ?? null };
  };
  const promisesOf = (o, notes) => {
    const out = [];
    for (const r of plan?.slots?.[`${o?.__id}`] ?? []) if (r?.field === "carry" && r.value) out.push({ text: String(r.value), from: "remembered" });
    for (const n of notes) if (PROMISE.test(n.text) && !out.some((x) => x.text === n.text)) out.push({ text: n.text, from: n.id?.startsWith("visit|") ? "visit" : "note" });
    return out;
  };
  const door = (s, done) => {
    const o = plan?.outcomes?.[s.id];
    const notes = dayNotes(plan, s.id, date);
    const c = done ? contactOf(o?.who) : null;
    const result = done ? bucketOf(o) : null;
    return {
      id: s.id, n: s.n ?? null, name: s.name ?? venue(s.id)?.name ?? "A door",
      status: done ? "visited" : "not-reached",
      skipped: (record.skipped ?? []).includes(s.id),
      result, resultLabel: result ? LABEL[result] : null, logged: done ? o?.at ?? null : null,
      who: c?.name ?? null, whoRole: c?.role ?? null, said: done && o?.note ? o.note : null,
      followUp: done ? fu(s.id, o) : null,
      notes, promises: promisesOf({ ...o, __id: s.id }, notes),
      where: done ? null : where(s.id),
    };
  };
  const doors = [];
  const removed = [];
  const seen = new Set();
  for (const s of q?.stops ?? []) seen.add(s.id), doors.push(door(s, s.done));
  // the doors End my day took off: not reached, with where they are now. Remove from today's: apart, not counted
  for (const r of record.removed ?? []) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    if (atEnd(r, record)) doors.push({ ...door({ id: r.id }, false), skipped: (record.skipped ?? []).includes(r.id) });
    else removed.push({ id: r.id, name: venue(r.id)?.name ?? "A door", reason: r.how === "dropped" ? "dropped from the plan" : "off today", at: r.at ?? null, where: where(r.id), notes: dayNotes(plan, r.id, date) });
  }
  const notReached = doors.filter((d) => d.status === "not-reached").map((d) => ({ id: d.id, name: d.name, where: d.where }));
  // the next day with doors after this one: its first stops
  const days = plan?.days ?? [];
  const k2 = days.findIndex((d) => d && !d.past && d.date > date && d.stops?.length);
  const tomorrow = k2 < 0 ? null : { date: days[k2].date, doors: days[k2].stops.length, followUps: days[k2].stops.filter((s) => s.pinned === "followup").length, first: days[k2].stops.slice(0, 3).map((s) => ({ id: s.id, name: venue(s.id)?.name ?? "A door", eta: hhmm(s.eta), followUp: s.pinned === "followup" })) };
  // every follow-up still ahead, across the plan (on or after this day)
  const openFollowUps = Object.entries(plan?.outcomes ?? {}).filter(([id, o]) => o?.followUp && (!date || o.followUp >= date) && plan?.statuses?.[id] !== "notfit")
    .map(([id, o]) => ({ id, name: venue(id)?.name ?? "A door", ...fu(id, o), fromToday: doors.some((d) => d.id === id && d.status === "visited") }))
    .sort((a, b) => a.date.localeCompare(b.date) || String(a.time ?? "").localeCompare(String(b.time ?? "")) || a.name.localeCompare(b.name));
  const out = {
    v: 1, date, ended: Boolean(record.ended),
    totals: { planned: doors.length, visited: doors.filter((d) => d.status === "visited").length, notReached: notReached.length, removed: removed.length },
    doors, removed, notReached, moved: movedLine(plan, record, date), tomorrow, openFollowUps,
    // doors already on the days ahead that the rolled ones pushed off, and where they are now
    bumped: (record.bumped ?? []).map((b) => ({ id: b.id, name: venue(b.id)?.name ?? "A door", from: b.from, where: where(b.id) })),
  };
  if (!redact) return out;
  // the names a model never gets (agent-context.js `names`, and names the day's words give a person)
  const names = [plan?.profile?.pitch?.name, ...Object.values(plan?.outcomes ?? {}).map((o) => o?.who), ...Object.values(plan?.slots ?? {}).flat().filter((r) => r?.field === "contact").map((r) => r.value?.name ?? r.value), ...(plan?.contacts ?? []).map((x) => x?.contactName)]
    .flatMap((x) => (typeof x === "string" ? [x, contactOf(x)?.name] : [])).filter((x) => typeof x === "string" && x.trim().length >= 2);
  const words = doors.flatMap((d) => [d.said, ...d.notes.map((n) => n.text)]).concat(removed.flatMap((r) => r.notes.map((n) => n.text)));
  return redactDeep(out, [...new Set([...names, ...words.flatMap((w) => namesIn(w))])]);
}

// debrief(plan, q, record, {now}) → the Day done screen's model, rendered from dayFacts (the same facts the agent reads):
// {date, dateText, title, sub, counts: [{key, label, n}], rows: [{id, n, name, bucket, label, detail, notes, where?}],
//  removed: rows taken off with Remove from today (not counted), moved: movedLine(…), facts: dayFacts(…, unredacted),
//  booked: [{id, name, text}], suggest: [{id, kind, name, text, weekday?}], next: {date, text} | null, total}
// q: driveQueue(plan, k) for the day; record: recordOf(plan.drive, date).
export function debrief(plan, q, record = emptyRecord(), { now = null } = {}) {
  const f = dayFacts(plan, q, record, { redact: false });
  const date = f.date;
  const whereOf = (d) => ({ text: d.where.text, dayIndex: d.where.date ? (plan.days ?? []).findIndex((x) => x?.date === d.where.date && !x.past) : -1, dropped: d.where.dropped });
  const detail = (d) => {
    const bits = [];
    if (d.who) bits.push(`talked to ${plan?.outcomes?.[d.id]?.who ?? d.who}`);
    if (d.followUp) bits.push(`${d.result === "followup" ? "" : "follow up "}${shortDate(d.followUp.date)}${d.followUp.time ? `, ${clockShort(toMinutes(d.followUp.time))}` : ""}`);
    const t = bits.join(" · ");
    return t ? t[0].toUpperCase() + t.slice(1) : "";
  };
  // a door on the route (n) not done is still on today's route; one End my day took off says where it is now
  const rows = f.doors.map((d) => d.status === "visited" ? { id: d.id, n: d.n, name: d.name, bucket: d.result, label: d.resultLabel, detail: detail(d), notes: d.notes }
    : d.n != null ? { id: d.id, n: d.n, name: d.name, bucket: "notvisited", label: LABEL.notvisited, detail: "Still on today's route", notes: d.notes }
    : { id: d.id, n: null, name: d.name, bucket: "notvisited", label: LABEL.notvisited, detail: d.where.text, where: whereOf(d), how: "end", notes: d.notes });
  const removed = f.removed.map((r) => ({ id: r.id, n: null, name: r.name, bucket: "removed", label: "Removed from today", detail: r.where.text, where: whereOf(r), how: r.reason === "dropped from the plan" ? "dropped" : "later", notes: r.notes }));
  const counts = BUCKETS.map((b) => ({ ...b, n: rows.filter((r) => r.bucket === b.key).length })).filter((c) => c.n);
  const visited = rows.filter((r) => r.bucket !== "notvisited").length;
  const total = rows.length;
  const left = total - visited;
  const title = `${plural(visited, "door")} visited${left ? `, ${left} not` : ""}`;
  // one plain sentence of what came of it (the counts show the rest)
  const c = Object.fromEntries(counts.map((x) => [x.key, x.n]));
  const said = [c.interested && `${c.interested} interested`, c.followup && `${c.followup} to follow up`, c.someone && `${c.someone} sent you to someone else`, c.no && `${c.no} not interested`].filter(Boolean);
  const sub = said.length ? `${said.join(", ").replace(/, ([^,]*)$/, " and $1")}.` : visited ? "Nothing logged beyond the visits." : "No doors visited.";

  // follow-ups booked from today's visits, where the planner put them
  const booked = f.doors.filter((d) => d.followUp).map((d) => ({ id: d.id, name: d.name, text: d.followUp.onDay ? `${niceDate(d.followUp.onDay)}, stop ${d.followUp.stop}${d.followUp.time ? ` · ${clockShort(toMinutes(d.followUp.time))}` : ""}` : `${shortDate(d.followUp.date)}: not on a day` }));
  // suggested follow-ups: only from what was logged, and only where nothing is booked yet
  const suggest = [];
  for (const r of rows) {
    const o = plan?.outcomes?.[r.id];
    if (r.bucket === "notvisited" || o?.followUp) continue;
    const wd = r.notes.map((n) => ({ n, wd: weekdayIn(n.text) })).find((x) => x.wd);
    if (wd) suggest.push({ id: r.id, kind: "note", name: r.name, weekday: wd.wd, text: `Your note: “${wd.n.text}”. No return booked.` });
    else if (r.bucket === "interested") suggest.push({ id: r.id, kind: "interested", name: r.name, text: "Interested, and no return booked." });
    else if (r.bucket === "someone") suggest.push({ id: r.id, kind: "someone", name: r.name, text: o?.who ? `Ask for ${o.who} next time. No return booked.` : "You talked to someone else. No return booked." });
  }
  // the next day with doors after this one
  const t = f.tomorrow;
  const next = t && { date: t.date, dayIndex: (plan.days ?? []).findIndex((d) => d?.date === t.date && !d.past), text: `${plural(t.doors, "door")}, first ${t.first[0].name}${t.first[0].eta ? ` at ${clockShort(toMinutes(t.first[0].eta))}` : ""}${t.followUps ? ` · ${plural(t.followUps, "follow-up")}` : ""}` };
  return { date, dateText: date ? niceDate(date) : "", title, sub, counts, rows, removed, booked, suggest, next, total, visited, ended: f.ended, moved: f.moved, facts: f };
}

// The day a suggestion's "Book" offers: for a note naming a weekday, the next plan day on that weekday the door is
// open; else the caller's one-tap Come back day. → "YYYY-MM-DD" | null
export function bookDay(s, venue, { windows = [], from, visitMin = 25 } = {}) {
  if (!s?.weekday) return null;
  const on = windows.filter((w) => w?.date > from && dayOf(w.date) === s.weekday);
  if (!on.length) return null;
  const open = nextOpenDay(venue, { after: from, windows: on, visitMin })?.date;
  return on.some((w) => w.date === open) ? open : on[0].date; // hours unknown (or shut every one): the first of them
}

// The doors End my day takes off: today's doors not done. → [id]
export const leftToday = (q) => (q?.stops ?? []).filter((s) => !s.done).map((s) => s.id);

// ---- running late's move (the banner never offers a move the guard would refuse) ----
// The doors that don't fit today (`ids`, off plan day k, the day under way) to the end of plan day `to`, as one move:
// the saved plan without them on day k (dropFromDay) and the locks with each of them day-locked to `to`. locked: the
// locks now, Map id → "day" | "place". The same input for the dry run (which day can take them) and the move itself,
// so what the banner offers is what happens. drive: the drive records; the move is kept on day k's (lateMoved), so
// the doors come on top of `to`'s doors-a-day cap, as End my day's (capsWithRolled; a planner fills every day to its
// cap or its end, so with no room over the cap no move would ever fit). hold: every other door on a later day
// day-locked to its day for this one run (not saved: the move's dry run and its re-plan), so the planner can't make
// room on `to` by pushing its own doors on to a later day (a day-lock never comes
// off: a day with no time left then runs past its end and lateMoveFits says it is full). → {saved, locks, drive, hold}
export function lateMoveInput(plan, saved, k, ids, to, locked, drive = {}) {
  const from = plan?.days?.[k];
  const d = plan?.days?.[to];
  const out = new Set(ids);
  const today = new Set((from?.stops ?? []).map((s) => s.id));
  const next = (from?.frozen && dropFromDay(saved, from, ids)) || saved;
  const m = new Map(locked);
  for (const id of ids) m.set(id, "day");
  const orders = new Map([[d.date, [...d.stops.map((s) => s.id).filter((x) => !out.has(x)), ...ids]]]);
  if (from && from.date !== d.date) orders.set(from.date, from.stops.map((s) => s.id).filter((x) => !out.has(x)));
  const locks = (plan?.days ?? []).flatMap((x) => (!x || x.past ? [] : (orders.get(x.date) ?? x.stops.map((s) => s.id)).flatMap((id, i) => (m.has(id) ? [{ id, date: x.date, index: m.get(id) === "day" ? null : i }] : []))));
  const rec = patchRecord(drive, from?.date, (r) => ({ lateMoved: [...(r.lateMoved ?? []).map((g) => ({ ...g, ids: g.ids.filter((x) => !out.has(x)) })).filter((g) => g.ids.length), { to: d.date, ids: [...ids] }] }));
  // (mobile2 10-23: "No later day has room" with Wed Nov 4 empty): a day under way with nothing logged isn't
  // frozen, so the day the doors go to took one of its other doors as it grew (a bump: no fit on any day); those are
  // held on it too. A frozen day keeps its doors already (frozen ids).
  const hold = (plan?.days ?? []).flatMap((x) => (!x || x.past || !(x.date > from?.date || (x === from && !from.frozen)) ? [] : x.stops.filter((s) => !out.has(s.id) && !m.has(s.id) && (x === from || !today.has(s.id))).map((s) => ({ id: s.id, date: x.date, index: null }))));
  return { saved: next, locks, drive: rec, hold };
}
// A plan made with running late's hold (lateMoveInput) as the rep sees it: the held doors are not locked (no 🔒, and
// lockedNow doesn't make them real locks), and no "Locked to …" note for them. → plan
export function unhold(p, hold) {
  const ids = new Set((hold ?? []).map((l) => l.id));
  if (!p || !ids.size) return p;
  return { ...p, days: p.days.map((d) => (d ? { ...d, stops: d.stops.map((s) => (ids.has(s.id) ? { ...s, locked: false, lockDay: false } : s)) } : d)), notes: (p.notes ?? []).filter((n) => !(n?.kind === "lock" && ids.has(n.id))) };
}
// The move worked: every one of `ids` is on `toDate`; every stop on a day ahead open when reached and done by its
// day's end (as it was before the move); every other door on a day of `before` (not past) is still on that same day after
// (as End my day's roll: a day keeps its own doors, none pushed on to a later day
// or off the days); and `toDate` holds only its own doors and the moved ones (no pile-up from the other days or Your
// list). Pairs id@date: a visited door with a follow-up sits on two days.
export function lateMoveFits(before, after, ids, toDate) {
  const out = new Set(ids);
  const ahead = (p) => (p?.days ?? []).filter((d) => d && !d.past);
  const pairs = (p) => ahead(p).flatMap((d) => d.stops.map((s) => `${s.id}@${d.date}`));
  const now = new Set(pairs(after));
  const d = ahead(after).find((x) => x.date === toDate);
  const on = d?.stops ?? [];
  const own = ahead(before).find((x) => x.date === toDate)?.stops.filter((s) => !out.has(s.id)).length ?? 0;
  // no stop on a day ahead shut when reached or done after the day's end (one that already was before the move aside)
  const bad = (x, s) => s.openAtArrival === false || s.depart > x.to;
  const badBefore = new Set(ahead(before).flatMap((x) => x.stops.filter((s) => bad(x, s)).map((s) => `${s.id}@${x.date}`)));
  const timed = ahead(after).every((x) => x.stops.every((s) => !bad(x, s) || (badBefore.has(`${s.id}@${x.date}`) && !out.has(s.id))));
  return ids.every((id) => on.some((s) => s.id === id)) && timed && on.length <= own + ids.length && !offEveryDay(before, after).length && ahead(before).every((x) => x.stops.every((s) => out.has(s.id) || now.has(`${s.id}@${x.date}`)));
}
// The banner's offer from the dry runs (fits: [{i, date, day, ok}], later days in order): the first day with room,
// and every later day for "Choose a day", the full ones marked. → {to: {i, day} | null, next: the first later day's
// name when it is full (said: "Wednesday is full"), choose: [{i, day, date, full}], none: no later day has room}
export function lateOffer(fits) {
  const xs = fits ?? [];
  const to = xs.find((f) => f.ok) ?? null;
  return { to: to && { i: to.i, day: to.day }, next: xs[0] && !xs[0].ok ? xs[0].day : null, choose: xs.map((f) => ({ i: f.i, day: f.day, date: f.date, full: !f.ok })), none: !!xs.length && !to };
}
// The banner's words, web and phone the same
const capWord = (x) => (x ? `${x[0].toUpperCase()}${x.slice(1)}` : x);
export const LATE_WORDS = {
  checking: "Checking which day has room…",
  // ease audit 3 #2: the line used to end "skip it or end the day early" with nothing to tap; the banner now carries
  // those two buttons (skip, end), so the line only says why
  none: (n) => `No later day has room for ${n === 1 ? "it" : "them"} without pushing a planned door off.`,
  noDay: (n) => `No later day to move ${n === 1 ? "it" : "them"} to.`,
  skip: (names) => (names.length === 1 ? `Skip ${names[0]}` : names.length === 2 ? `Skip ${names[0]} and ${names[1]}` : `Skip those ${names.length}`),
  end: "End my day",
  choose: "Choose a day",
  full: (day) => `${capWord(day)} is full.`,
  move: (n, day) => `Move ${n === 1 ? "it" : `those ${n}`} to ${capWord(day)}`,
  pick: (x) => `${niceDate(x.date)}${x.full ? " · full" : ""}`,
};
// Running late's Skip said back (web + phone): "Oddwood Brewing is off today and back on Your list." (a door the
// re-plan put on a later day of its own accord, unlocked, says where: "… is off today. On Thu Oct 29, stop 5.")
export function skippedText(plan, ids, venues = plan?.venues ?? {}, today = true) {
  const name = (id) => venues?.[id]?.name ?? "That door";
  const placed = ids.map((id) => ({ id, w: whereNow(plan, id, null) })).filter((x) => x.w.dayIndex >= 0);
  const free = ids.filter((id) => !placed.some((x) => x.id === id));
  const off = today ? "today" : "this day";
  const list = (xs) => (xs.length === 1 ? name(xs[0]) : xs.length === 2 ? `${name(xs[0])} and ${name(xs[1])}` : `${xs.length} doors`);
  const bits = [];
  if (free.length) bits.push(`${list(free)} ${free.length === 1 ? "is" : "are"} off ${off} and back on Your list.`);
  for (const x of placed) bits.push(`${name(x.id)} is off ${off}. ${x.w.text}.`);
  return bits.join(" ");
}
// A day now past its doors-a-day cap (doors moved onto it on top): "Thu Oct 29 now has 5 doors, 1 over your 4 a day." | ""
export function overCapText(plan, date) {
  const d = (plan?.days ?? []).find((x) => x && !x.past && x.date === date);
  const max = plan?.windows?.find((w) => w?.date === date)?.max;
  return d && Number.isInteger(max) && d.stops.length > max ? `${niceDate(date)} now has ${plural(d.stops.length, "door")}, ${d.stops.length - max} over your ${max} a day.` : "";
}
