// Drive mode (owner review 9, R9 #3): the day a rep is driving, door by door. Pure: no DOM, no clock (the caller passes
// `now` = {date: "YYYY-MM-DD", min}), so the web drive view (ui/drive.js) and the React Native app read the same day.
// Input is the published plan (ui/state.js shape: days, venues, statuses, outcomes, profile). Covered by
// test/drive-mode.test.mjs.
import { isReturnVisit } from "./outcome.js";
import { clockShort } from "./schedule.js";
import { navAppOf } from "./note.js";
import { dayOf, niceDate } from "./profile.js";

export const LATE_MIN = 15; // minutes behind the planned arrival before drive mode says "running late"

// The day to drive: today's window when it has doors; else the next day ahead with doors (a preview: `today` false);
// else null. → {index, day, today}
export function pickDay(plan, now) {
  const days = plan?.days ?? [];
  const has = (d) => d && d.stops?.length;
  let i = days.findIndex((d) => has(d) && d.date === now?.date);
  if (i >= 0) return { index: i, day: days[i], today: true };
  i = days.findIndex((d) => has(d) && !d.past && (!now?.date || d.date > now.date));
  if (i >= 0) return { index: i, day: days[i], today: false };
  return null;
}

// Is this stop done for the day? Visited (not the return visit of a follow-up), or marked talked / not a fit.
export function isDoneStop(plan, day, stop) {
  const st = plan?.statuses?.[stop.id];
  if (st === "talked" || st === "notfit") return true;
  return st === "visited" && !isReturnVisit(stop, day, plan?.outcomes?.[stop.id]);
}

// The day as drive mode shows it: every stop in the plan's order with {id, n, name, done, eta, stop, venue}, the
// current one (the first not done; null when the day is finished) and the progress.
export function driveQueue(plan, dayIndex) {
  const day = plan?.days?.[dayIndex];
  if (!day) return { day: null, stops: [], current: null, done: 0, total: 0, finished: true };
  const stops = day.stops.map((s, k) => ({ id: s.id, n: k + 1, name: plan.venues?.[s.id]?.name ?? "This door", done: isDoneStop(plan, day, s), eta: s.eta, stop: s, venue: plan.venues?.[s.id] ?? null }));
  const current = stops.find((s) => !s.done) ?? null;
  const done = stops.filter((s) => s.done).length;
  return { day, stops, current, done, total: stops.length, finished: !current };
}

// What's next after the current door (for "then: …" under the big card).
export function nextAfter(q) {
  if (!q.current) return null;
  return q.stops.find((s) => !s.done && s.n > q.current.n) ?? null;
}

// Running late (today only): project the rest of the day from now. The rep is at or heading to the current door;
// each later door takes its planned leg plus the visit. A door is "out" when it would start after the window ends
// (with its visit) or after the room closes. → {late, behind, ends, endText, out:[id], text} or null when on time /
// not today.
export function lateness(q, now, { visitMin = 25, today = true } = {}) {
  if (!today || !q?.current || !q.day || !Number.isFinite(now?.min)) return null;
  const rest = q.stops.filter((s) => !s.done);
  const first = rest[0];
  const behind = Math.round(now.min - first.eta);
  if (!(behind >= LATE_MIN)) return null;
  const to = q.day.to;
  const out = [];
  let t = now.min; // arriving at the current door about now (it is the next thing the rep does)
  rest.forEach((s, k) => {
    if (k) t += s.stop.legMin ?? 0;
    const closes = Number.isFinite(s.stop.openUntil) ? s.stop.openUntil : Infinity;
    if (k && (t + visitMin > to || t > closes)) { out.push(s.id); return; } // dropped: the clock doesn't move for it
    t += visitMin;
  });
  const ends = t;
  const n = out.length;
  // judge pass 8 (#5): the doors that won't fit by name ("Hold Out Brewing doesn't fit"), not "1 door doesn't fit"
  const names = out.map((id) => rest.find((s) => s.id === id)?.name).filter(Boolean);
  const who = names.length !== n ? (n === 1 ? "1 door doesn't" : `${n} doors don't`) : n === 1 ? `${names[0]} doesn't` : n === 2 ? `${names[0]} and ${names[1]} don't` : `${names.slice(0, 2).join(", ")} and ${n - 2} more don't`;
  const text = `Running ${behind} min late.${n ? ` ${who} fit before ${clockShort(to)}.` : ` You'd still finish by ${clockShort(Math.round(ends))}.`}`;
  return { late: true, behind, ends, endText: clockShort(Math.round(ends)), out, text };
}

// "Running late" said by the rep (ease audit #7: it only showed once today's clock was past the plan, never on a preview
// day): the same lateness, from the planned arrival at the current door plus `by` minutes (or the real clock when that is
// later, today), so the same "N doors don't fit" line and move offer follow. by = 0: the clock alone, as before.
export const LATE_PICKS = [15, 30, 60];
export const latePickLabel = (m) => (m >= 60 ? `+${m / 60} hour${m > 60 ? "s" : ""}` : `+${m} min`);
// shift (GROUP3 item 9): the button's label before a pick says what it does: the rest of the day moves later
export const LATE_CONTROL = { open: "Running late", shift: "Running late: shift everything", clear: "On time again", ask: "How late will you be?" };
export function lateFor(q, now, by = 0, { visitMin = 25, today = true } = {}) {
  if (!(by > 0)) return lateness(q, now, { visitMin, today });
  const first = q?.stops?.find((s) => !s.done);
  if (!q?.current || !first || !Number.isFinite(first.eta)) return null;
  const real = today && Number.isFinite(now?.min) ? now.min : -Infinity;
  const min = Math.max(first.eta + by, real);
  return lateness(q, { ...(now ?? {}), min }, { visitMin, today: true });
}

// The next day after `dayIndex` that a door can be pushed to (not past, not the same date). → index or -1
export function nextDayIndex(plan, dayIndex) {
  const days = plan?.days ?? [];
  const from = days[dayIndex];
  return days.findIndex((d, i) => i > dayIndex && d && !d.past && d.date !== from?.date);
}

// The day's tally when it is finished: {visited, interested, followups, no, someone}.
export function dayTally(plan, q) {
  const t = { visited: 0, interested: 0, followups: 0, no: 0, someone: 0 };
  for (const s of q.stops) {
    if (!s.done) continue;
    t.visited++;
    const o = plan?.outcomes?.[s.id];
    if (o?.result === "interested") t.interested++;
    if (o?.result === "no") t.no++;
    if (o?.result === "someone") t.someone++;
    if (o?.followUp || o?.result === "followup") t.followups++;
  }
  return t;
}

// Maps deep link for the door in the rep's navigation app (app: "apple" | "google" | "waze", PARITY S14), none chosen:
// Apple Maps on Apple devices, else Google Maps; driving directions from where the phone is (no origin: the maps app
// uses the current location).
export function navigateUrl(venue, ua = "", app = null) {
  if (!venue) return null;
  const k = navAppOf(app, ua); // the rep's navigation app (lib/note.js), else by the browser
  const has = Number.isFinite(+venue.lat) && Number.isFinite(+venue.lon) && venue.lat !== null && venue.lon !== null;
  const ll = has ? `${(+venue.lat).toFixed(6)},${(+venue.lon).toFixed(6)}` : null;
  const q = [venue.name, venue.address].filter(Boolean).join(", ");
  if (!ll && !q) return null;
  if (k === "waze") return ll ? `https://waze.com/ul?ll=${encodeURIComponent(ll)}&navigate=yes` : `https://waze.com/ul?q=${encodeURIComponent(q)}&navigate=yes`;
  if (k === "apple") return `https://maps.apple.com/?daddr=${encodeURIComponent(ll ?? q)}${ll && q ? `&q=${encodeURIComponent(venue.name ?? "")}` : ""}&dirflg=d`;
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(ll ?? q)}&travelmode=driving`;
}

// "Skip for now" on the day being worked (Skip didn't work on the web): the saved
// plan (store.js `plan`) with `id` moved to the end of that day's order. The planner keeps the frozen day as the rep
// has it, so the door goes last, the day is re-timed, and nothing else moves or comes off. A place lock at the end (the
// old Skip, moveStop) re-planned the day around the lock and took free doors off: 7 of 14 in test/drive-mode.test.mjs.
// `day`: {date, from} of the plan day. → the new saved plan, or null when the day or the door isn't in it.
export function skipToEnd(saved, day, id) {
  const k = saved?.days?.findIndex((d) => d && d.date === day?.date && (d.from == null || day.from == null || d.from === day.from)) ?? -1;
  if (k < 0) return null;
  const d = saved.days[k];
  const s = d.stops?.find((x) => x.id === id);
  if (!s) return null;
  const days = saved.days.slice();
  days[k] = { ...d, stops: [...d.stops.filter((x) => x.id !== id), s] };
  return { ...saved, days };
}

// Start my day's words, web and phone (PARITY S18): one place, so the two say the same thing
export const legMiText = (s) => (Number.isFinite(s?.legMi) ? `${s.legMi.toFixed(1)} ${s.source === "ors" ? "road mi" : "mi · est."}` : "");
export const DRIVE_WORDS = {
  progress: (q) => (q.finished && q.total ? "Day done" : `${q.done} of ${q.total} door${q.total === 1 ? "" : "s"} done`),
  done: "Log visit", // GLOSSARY rule 8 (Jard OK): the stop card's word
  sheetTitle: (name) => `How did it go at ${name}?`,
  readBy: (source) => (source === "rules" ? "Read by Doors' rules (Doors Agent wasn't used)" : "Read by Doors Agent"),
  save: "Save & next door",
  drop: (name) => `Drop ${name} from the plan`,
  then: (nx) => `Then: ${nx.name}${nx.stop?.legMi != null ? ` · ${legMiText(nx.stop)}` : ""}`,
  // the door card's safety line: mic = the app can listen here (the guided demo on the phone has none)
  // intuit audit #2: a previewed day leads with the day, not a caveat ("Preview of Tue Oct 27 (not today)" read as "it
  // didn't start"). date: the day on screen; today: today's date (both "2026-10-27")
  dayTitle: (date) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date ?? ""));
    return m ? `${new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}` : String(date ?? "");
  },
  notToday: (date, today) => {
    const wd = dayOf(date).replace(/^./, (c) => c.toUpperCase());
    return `Today is ${niceDate(today)}. ${String(date) > String(today) ? `This is ${wd}'s route, ahead of time.` : `This was ${wd}'s route.`}`;
  },
  // intuit audit 1b #1: a small screen (≤ 420 px wide or ≤ 700 px tall) gets one header line, "Tue Oct 27 · 0 of 9
  // done", and the preview note in one short line under it (the full words above stay for a bigger screen)
  dayLine: (q, date, isToday) => `${isToday ? "Today" : niceDate(date)} · ${q.finished && q.total ? "Day done" : `${q.done} of ${q.total} done`}`,
  previewShort: (date, today) => `${String(date) > String(today) ? "Preview" : "Past day"}: today is ${niceDate(today)}`,
  safe: (mic) => `For between stops: park before you read or type. ${mic ? "Log visit listens: tap the mic and say how it went." : "Log visit takes a quick tap or a few typed words."}`,
};

// "Move those n to <day>": the target day found again after each move (indices shift), by its date and its start, so
// a date with two windows lands on the one shown (PARITY S19: the phone matched by date only)
// "Move those n" said back: how many went, and the ones a full day couldn't take (a planned door is never pushed off)
export const lateMovedText = (n, all, day) => `${n ? `${n === 1 ? "1 door" : `${n} doors`} moved to ${day}.` : ""}${n < all ? `${n ? " " : ""}${all - n === 1 ? "1 door" : `${all - n} doors`} didn't fit on ${day} without pushing a planned door off: skip ${all - n === 1 ? "it" : "them"} or end the day early.` : ""}`;
export const sameDayIndex = (plan, target) => (plan?.days ?? []).findIndex((d) => d.date === target.date && d.from === target.from);

// A door moved onto (or within) the day being worked (frozen) (mobile2 10-23: "Move to Friday" on the day under way
// re-planned it from the clock and took 6 of 7 doors off): like skipToEnd, the saved plan with the door put into that
// day's order at `index` (null: the end; never before `lead`, the visits already in order), taken off the day it was
// on. The planner keeps a frozen day as the rep has it, so nothing else moves or comes off; no lock. `from`/`to`:
// {date, from} of plan days. → the new saved plan, or null when the target day isn't in it.
export function moveIntoDay(saved, from, to, id, index = null, lead = 0) {
  const at = (day) => saved?.days?.findIndex((d) => d && d.date === day?.date && (d.from == null || day.from == null || d.from === day.from)) ?? -1;
  const kt = at(to);
  if (kt < 0 || !id) return null;
  const ks = from ? at(from) : -1;
  const s = (ks >= 0 ? saved.days[ks].stops?.find((x) => x.id === id) : null) ?? saved.days[kt].stops?.find((x) => x.id === id) ?? { id };
  const days = saved.days.slice();
  if (ks >= 0 && ks !== kt) days[ks] = { ...days[ks], stops: days[ks].stops.filter((x) => x.id !== id) };
  const rest = days[kt].stops.filter((x) => x.id !== id);
  const i = Number.isInteger(index) ? Math.max(lead, Math.min(index, rest.length)) : rest.length;
  days[kt] = { ...days[kt], stops: [...rest.slice(0, i), s, ...rest.slice(i)] };
  return { ...saved, days };
}

// A move never pushes a planned door off (a day ahead takes a moved door only in the time
// it has left): the doors on a day still ahead before a re-plan that are on no day after it. → [id]
export function offEveryDay(before, after) {
  const on = new Set((after?.days ?? []).flatMap((d) => (d ? d.stops.map((s) => s.id) : [])));
  return [...new Set((before?.days ?? []).flatMap((d) => (d && !d.past ? d.stops.map((s) => s.id) : [])))].filter((id) => !on.has(id));
}
// The toast when a move is undone for it
export function noRoomText(plan, id, off, day) {
  const nm = (x) => plan?.venues?.[x]?.name ?? "a door";
  const others = off.filter((x) => x !== id);
  const when = day ? ` on ${day[0].toUpperCase()}${day.slice(1)}` : " there";
  return others.length
    ? `No time left${when} for ${nm(id)}: it would push ${others.map(nm).join(", ")} off your days. Nothing moved.`
    : `${nm(id)} doesn't fit${when}. Nothing moved.`;
}
