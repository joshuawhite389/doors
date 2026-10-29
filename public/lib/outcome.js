// Outcomes (SPEC-V2 §8): what happened at a door, stored per door as {result, followUp?, who?, note?, at?}.
// Mark visited → Interested · Follow up (a date, default the next window) · Talked to someone else (who) · No, plus an
// optional note. A followUp date pins the door to that date (schedule.js, §6.5). Pure: covered by test/stop.test.mjs.
import { dayOf, isoDate, niceDate, toMinutes } from "./profile.js";
import { clockShort } from "./schedule.js";

export const RESULTS = [
  { key: "interested", label: "Interested" },
  { key: "followup", label: "Follow up" },
  { key: "someone", label: "Talked to someone else" },
  { key: "no", label: "Not interested" },
];
export const RESULT_TEXT = Object.fromEntries(RESULTS.map((r) => [r.key, r.label]));

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : "");
// "2026-10-15" → "Thu Oct 15"
export const shortDate = (date) => niceDate(date);

// The one-tap answers' words, the same on the stop's outcome sheet and in Start my day, web and phone (PARITY S17)
export const QUICK_TEXT = {
  interested: "✓ Interested",
  followup: (date) => `↻ Follow up ${shortDate(date)}`,
  someone: "Talked to someone else",
  no: "Not interested",
  visited: "Just visited",
};
// The outcome sheet's one-tap choices (ui/outcome.js, the phone's Stop): the glossary's four outcomes, one name each, all
// styled the same (ease audit #8: "Interested · follow up" next to "Follow up" read as three overlapping choices). The
// follow-up's date rides on its own button (text: "Follow up Wed Oct 28"; ease audit 2 #4: a date line under all four
// read as if Interested booked it too). label = the outcome's name; text = what the button says. date = the default.
export const quickChoices = (date) => [
  { key: "interested", label: "Interested", o: { result: "interested" } },
  { key: "followup", label: "Follow up", text: followUpLine(date), o: { result: "followup", followUp: date } },
  { key: "someone", label: QUICK_TEXT.someone, o: { result: "someone" } },
  { key: "no", label: QUICK_TEXT.no, o: { result: "no" } },
];
// The Follow up button's words: "Follow up Wed Oct 28" (another date: Add details).
export function followUpLine(date) { return `Follow up ${shortDate(date)}`; }

// When a visit logged from the stop or Start my day happened: now on today's date; on a previewed day (not today) that
// day, at the stop's planned time (eta, minutes), else now's clock on that day (ease audit: logging on a preview day
// stamped "Visited 9:59 pm", today's clock, on Tuesday's card). dayDate "YYYY-MM-DD" | null.
export function visitStamp(dayDate, eta, now = new Date()) {
  const today = localStamp(now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dayDate ?? "") || dayDate === today.slice(0, 10)) return today;
  const m = Number.isFinite(eta) ? Math.round(eta) : now.getHours() * 60 + now.getMinutes();
  return `${dayDate}T${p2(Math.floor(m / 60) % 24)}:${p2(m % 60)}:00`;
}

// The follow-up date offered first: the next window after `date`, else the next weekday after it.
export function defaultFollowUp(windows = [], date) {
  const next = windows.map((w) => w.date).filter((d) => d > date).sort()[0];
  if (next) return next;
  const [y, m, d] = String(date).split("-").map(Number);
  const t = new Date(y, m - 1, d);
  do t.setDate(t.getDate() + 1);
  while (t.getDay() === 0 || t.getDay() === 6);
  return isoDate(t);
}

// persona (founder): a visit logged Thu 10 pm read "talked on Fri": its stamp was UTC. The visit's own day and clock,
// "2026-10-22T22:05:00" (what drive mode and the agent already write).
const p2 = (n) => String(n).padStart(2, "0");
export const localStamp = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;

// Form fields → the stored outcome, or {error}. "followup" needs a date; any result may carry one.
export function makeOutcome({ result, followUp = "", who = "", note = "", at = null } = {}) {
  if (!RESULT_TEXT[result]) return { error: "Pick what happened." };
  const date = String(followUp ?? "").trim();
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "The follow-up needs a date." };
  if (result === "followup" && !date) return { error: "Pick a day to follow up." };
  const o = { result };
  if (date) o.followUp = date;
  // R9 S4: who they talked to is kept for any result (the return visit asks for them by name)
  if (String(who ?? "").trim()) o.who = String(who).trim().slice(0, 120);
  if (String(note).trim()) o.note = String(note).trim().slice(0, 500);
  if (at) o.at = at;
  return o;
}

// The tags a list row, a pin title and the stop show: "✓ Interested", "↻ Follow up Thu 15", "Talked to Sam", "No".
// text keeps its mark for lines and toasts ("Logged · ✓ Interested"); a chip shows ic (the icon set) + label instead
// (judge pass 12 #5: a text ↻ beside the new icons read as an odd mark)
const mark = (t) => (/^✓ /.test(t.text) ? { ...t, ic: "check", label: t.text.slice(2) } : /^↻ /.test(t.text) ? { ...t, ic: "followup", label: t.text.slice(2) } : { ...t, ic: null, label: t.text });
export function outcomeTags(o) {
  if (!o?.result) return [];
  const out = [];
  if (o.result === "interested") out.push({ cls: "ok", text: "✓ Interested" });
  else if (o.result === "someone") out.push({ cls: "", text: o.who ? `Talked to ${o.who}` : "Talked to someone else" });
  else if (o.result === "no") out.push({ cls: "no", text: "Not interested" });
  if (o.followUp) out.push({ cls: "fu", text: `↻ Follow up ${shortDate(o.followUp)}${/^\d{2}:\d{2}$/.test(o.followUpTime ?? "") ? `, ${clockShort(toMinutes(o.followUpTime))}` : ""}` });
  else if (o.result === "followup") out.push({ cls: "fu", text: "↻ Follow up" });
  return out.map(mark);
}
export const outcomeText = (o) => outcomeTags(o).map((t) => t.text).join(" · ");

// Where a follow-up landed after the re-plan: {dayIndex, n, day} on its date or later, or the planner's note.
export function followUpPlace(plan, id, date) {
  const days = plan?.days ?? [];
  for (let i = 0; i < days.length; i++) {
    const d = days[i];
    if (!d || d.date < date) continue;
    const k = d.stops.findIndex((s) => s.id === id && s.pinned === "followup");
    if (k >= 0) {
      const note = plan.notes?.find((n) => n.kind === "followup-moved" && n.id === id);
      return { dayIndex: i, n: k + 1, day: d, moved: note ?? null, text: `Follow-up on ${niceDate(d.date)}, stop ${k + 1}.${note ? ` ${note.text}` : ""}` };
    }
  }
  const note = plan?.notes?.find((n) => /^followup/.test(n.kind) && n.id === id);
  return { dayIndex: -1, n: null, day: null, moved: note ?? null, text: note ? note.text : `Follow-up saved for ${shortDate(date)}: no window that day or later, so it isn't on a day yet. Add a day in Edit this city.` };
}

// Is this stop the return visit of a follow-up (so it reads as a stop to make, not a done one)? The planner tags every
// appearance of a follow-up door as pinned; only the one on or after the follow-up date is the return.
export function isReturnVisit(stop, day, outcome) {
  return stop?.pinned === "followup" && Boolean(outcome?.followUp) && Boolean(day?.date) && day.date >= outcome.followUp;
}
// The return visit's label on the stop and in drive mode, with the day she said when the planner moved it (phone job,
// 10-23: a Sat Oct 24 follow-up on a Tue plan read "Tuesday · stop 9 · follow-up visit"): "follow-up visit" on its own
// date | "follow-up visit, moved from Sat Oct 24" on a later day | "" when this stop isn't the return.
export function returnVisitLabel(stop, day, outcome) {
  if (!isReturnVisit(stop, day, outcome)) return "";
  return day.date === outcome.followUp ? "follow-up visit" : `follow-up visit, moved from ${shortDate(outcome.followUp)}`;
}

// The follow-up toast, with what the re-plan cost when the planner says (plan.replanCost = {addedMi, droppedIds,
// movedIds}, feature-detected; R2 Calacanis 13): "Follow-up on Thu Oct 15, stop 3 · +4.1 road mi · Tied House back on Your
// list". venues: id → {name}.
export function followUpToast(plan, id, date, venues = plan?.venues ?? {}) {
  const at = followUpPlace(plan, id, date);
  const cost = plan?.replanCost;
  if (!cost) return at.text;
  const name = (x) => venues[x]?.name ?? null;
  const bits = [at.text.replace(/\.$/, "")];
  if (Number.isFinite(cost.addedMi) && Math.abs(cost.addedMi) >= 0.1) bits.push(`${cost.addedMi > 0 ? "+" : "−"}${Math.abs(cost.addedMi).toFixed(1)} ${plan.source === "ors" ? "road mi" : "mi, estimated"}`);
  // ease audit 3 #10c: "X off the day" read like a loss; say where it went (back on Your list, or the day it moved to)
  const dayOf = (x) => plan.days?.find((dd) => dd?.stops?.some((s) => s.id === x));
  const dropped = (cost.droppedIds ?? []).filter((x) => name(x) && !dayOf(x)).map(name);
  if (dropped.length) bits.push(`${dropped.length > 2 ? `${dropped.slice(0, 2).join(", ")} and ${dropped.length - 2} more` : dropped.join(" and ")} back on Your list`);
  const shifted = (cost.droppedIds ?? []).filter((x) => name(x) && dayOf(x) && !(cost.movedIds ?? []).includes(x)).map((x) => `${name(x)} moved to ${dayOf(x).day[0].toUpperCase()}${dayOf(x).day.slice(1)}`);
  if (shifted.length) bits.push(...shifted);
  const moved = (cost.movedIds ?? []).filter((x) => x !== id).map((x) => {
    const d = plan.days?.find((dd) => dd?.stops?.some((s) => s.id === x));
    return name(x) && d ? `${name(x)} moved to ${d.day[0].toUpperCase()}${d.day.slice(1)}` : null;
  }).filter(Boolean);
  if (moved.length) bits.push(moved.length > 2 ? `${moved.length} other doors moved days` : moved.join(" · "));
  return bits.join(" · ");
}
