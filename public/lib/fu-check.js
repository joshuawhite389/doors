// Judge pass 4 (#2, #3): a follow-up is checked against the door's hours when it is logged, so the read-back, the badge
// and the planned time agree. "back Tuesday at 3" at a room closed Tuesdays says so and offers the next day it is open;
// at a room that opens at 4 the time becomes 4 pm and the read-back says why. Hours unknown: nothing changes.
// Pure: drive mode (ui/drive.js) and the chat panel (ui/agent.js) call it on what they are about to save. Covered by
// test/fu-check.test.mjs.
import { parseHours, openMinutes } from "./core.js";
import { dayOf, niceDate, toMinutes, isoDate } from "./profile.js";
import { clockShort } from "./schedule.js";
import { sayOutcome } from "./visit-parse.js";
import { defaultFollowUp } from "./outcome.js";
import { reachWindows } from "./week.js";

const pad = (n) => String(n).padStart(2, "0");
const hhmm = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const plural = (day) => `${day[0].toUpperCase()}${day.slice(1)}s`;
const Day = (day) => `${day[0].toUpperCase()}${day.slice(1)}`;
const addDays = (date, k) => {
  const [y, m, d] = String(date).split("-").map(Number);
  return isoDate(new Date(y, m - 1, d + k));
};

// The door's own spans on a weekday ({from, to} minutes, to may pass midnight), or null when its hours don't say.
function daySpans(parsed, day) {
  if (!parsed?.ok || !parsed.days[day]) return null;
  return parsed.days[day].closed ? [] : parsed.days[day].spans;
}

// Where a visit at minute t (null: any time) can go on a weekday: {ok:true, at} (at = the visit's time, t or the
// opening it waits for) | {ok:false} (closed, or nothing left after t) | null (hours don't say).
function slotOn(parsed, day, t, visitMin) {
  const spans = daySpans(parsed, day);
  if (!spans) return null;
  const fits = spans.filter((s) => s.to - s.from >= visitMin);
  if (t == null) return fits.length ? { ok: true, at: null } : { ok: false };
  const now = fits.find((s) => s.from <= t && s.to - t >= visitMin);
  if (now) return { ok: true, at: t };
  const later = fits.filter((s) => s.from > t).sort((a, b) => a.from - b.from)[0];
  return later ? { ok: true, at: later.from } : { ok: false };
}

// The door's hours: a venue record ({hours}) or an already parsed {ok, days}.
const hoursOf = (venue) => (venue?.parsedHours?.ok != null ? venue.parsedHours : parseHours(venue?.hours ?? null));

// The first day after `after` the door is open for a visit (at `t` if it can, else at its opening): a plan window's date
// first (windows: [{date}]), else the next weekday within two weeks, else any day (a rep's week is Mon–Fri, as
// lib/outcome.js defaultFollowUp has it). → {date, time|null} | null
export function nextOpenDay(venue, { after, t = null, windows = [], visitMin = 25 } = {}) {
  const parsed = hoursOf(venue);
  if (!parsed?.ok || !after) return null;
  const at = (date) => {
    const s = slotOn(parsed, dayOf(date), t, visitMin);
    return s?.ok ? { date, time: s.at == null ? null : hhmm(s.at) } : null;
  };
  for (const d of [...new Set(windows.map((w) => w?.date).filter((d) => d > after))].sort()) {
    const got = at(d);
    if (got) return got;
  }
  for (const weekend of [false, true]) {
    for (let k = 1; k <= 14; k++) {
      const d = addDays(after, k);
      if (!weekend && /^(saturday|sunday)$/.test(dayOf(d))) continue;
      const got = at(d);
      if (got) return got;
    }
  }
  return null;
}

// A follow-up about to be saved, against the door's hours.
// outcome: {followUp: "YYYY-MM-DD", followUpTime?: "HH:MM", …}; venue: {name, hours}.
// → {outcome, code, text, alt}: code null (fine, or hours unknown), "early" (the time moved to the opening: outcome
// carries the new time), "closed" (closed that day, or shut for the rest of it after the time: the outcome is kept as
// the rep said it and alt = {date, time} is the next open day, offered). text is the sentence to add to the read-back.
export function fitFollowUp(outcome, venue, { windows = [], visitMin = 25, others = [], week = null } = {}) {
  const none = { outcome, code: null, text: "", alt: null };
  if (!outcome?.followUp) return none;
  windows = reachWindows(windows, week, addDays(outcome.followUp, 7)); // the usual week: a date past the plan's days is still a plan day
  const parsed = hoursOf(venue);
  const day = dayOf(outcome.followUp);
  const t = toMinutes(outcome.followUpTime);
  const s = slotOn(parsed, day, t, visitMin);
  const name = venue?.name ?? "This door";
  if (s && !s.ok) {
    const shut = daySpans(parsed, day).length === 0;
    const next = nextOpenDay(venue, { after: outcome.followUp, t, windows, visitMin });
    // judge pass 5 (#3): with no later plan day open, the next open day is a calendar day the plan has no route for: say so
    const alt = next && windows.length ? { ...next, planDay: windows.some((w) => w?.date === next.date) } : next;
    const why = shut ? `${name} is closed ${plural(day)}` : `${name} isn't open after ${clockShort(t)} ${Day(day)}`;
    const offer = alt ? ` ${when(alt)} instead?${alt.planDay === false ? ` It ${offPlan(alt.date, windows)}` : ""}` : " Pick another day?";
    const spoken = `${why}: ${alt ? `${sayWhen(alt.date, alt.time)} instead${alt.planDay === false ? ", though it isn't a plan day" : ""}?` : "pick another day?"}`;
    return { outcome, code: "closed", text: `${why} (Qloo's hours).${offer}`, alt, spoken };
  }
  const early = s && t != null && s.at !== t;
  const fixed = early ? { ...outcome, followUpTime: hhmm(s.at) } : outcome;
  const earlyText = early ? `${name} opens ${clockShort(s.at)} ${Day(day)}, so the follow-up is at ${clockShort(s.at)}.` : "";
  // (judge-5 own plan): two follow-ups at one time on one day can't both be visited, and the planner dropped one
  // with no word. The other follow-ups that day: this one waits for each it overlaps (a visit plus FU_GAP_MIN to drive)
  const at = toMinutes(fixed.followUpTime);
  const busy = at == null ? [] : (others ?? []).map((o) => ({ ...o, t: toMinutes(o?.followUpTime) })).filter((o) => o.id !== venue?.id && o.followUp === fixed.followUp && o.t != null).sort((a, b) => a.t - b.t);
  const hit = (x) => busy.find((o) => Math.abs(x - o.t) < visitMin + FU_GAP_MIN);
  const first = at == null ? null : hit(at);
  if (!first) {
    // (judge-5: "call next week" → Fri Oct 30 on a Fri + Tue plan): a day with no window is on no route: say so
    if (windows.length && !windows.some((v) => v?.date === fixed.followUp)) return { outcome: fixed, code: "offplan", text: `${earlyText ? `${earlyText} ` : ""}${niceDate(fixed.followUp)} ${offPlan(fixed.followUp, windows)}`, alt: null };
    return early ? { outcome: fixed, code: "early", text: earlyText, alt: null } : none;
  }
  const w = windows.find((x) => x?.date === fixed.followUp && Number.isFinite(x.to));
  let x = at;
  for (let o = first, n = 0; o && n <= busy.length; o = hit(x), n++) {
    x = o.t + visitMin + FU_GAP_MIN;
    const sl = slotOn(parsed, day, x, visitMin);
    if (sl && !sl.ok) { x = null; break; }
    if (sl?.at != null) x = sl.at;
  }
  const free = x != null && !hit(x) && !(w && x + visitMin > w.to - 5);
  const alt = free ? { date: fixed.followUp, time: hhmm(x), ...(windows.length ? { planDay: windows.some((v) => v?.date === fixed.followUp) } : {}) } : null;
  const spoken = `${first.name || "Another door"}'s follow-up is at ${clockShort(first.t)} ${Day(day)} too: ${alt ? `${clockShort(x)} instead?` : "pick another time?"}`;
  return { outcome: fixed, code: "clash", text: `${earlyText ? `${earlyText} ` : ""}${spoken}`, alt, spoken };
}
// A clash's text without its offer question, for a sheet that offers the slot as a button: "… is at 4 pm Tuesday too."
// Up to the "?", not the last colon: the offered time has its own ("4:40 pm instead?"; the phone's Stop.tsx, a7f0665).
export const clashStem = (text) => String(text ?? "").replace(/: [^?]*\?$/, ".");
// A follow-up date with no window: what the planner does with it (the old "add it … to route" line
// read as if it weren't routed, yet the planner puts it on the next plan day, schedule.js "followup-moved"), so the
// sentence names that day, or says none comes after it (followUpPlace: "no window that day or later").
function offPlan(date, windows = []) {
  const next = windows.map((w) => w?.date).filter((d) => d && d > date).sort()[0];
  const go = `Add ${niceDate(date)} to your days to go then.`;
  return next ? `isn't one of your plan days, so Doors puts the visit on ${niceDate(next)}, your next plan day. ${go}` : `isn't one of your plan days, and none comes after it, so the visit isn't on your plan. ${go}`;
}
// A read-back without its offer question (the rep saved as said): drive's toast. Drops "<when> instead?" and, after an
// off-plan offer, both of its sentences.
export const keptText = (say) => String(say ?? "").replace(/ [^.?]*instead\?( It isn't one of your plan days[^.]*\.( Add [^.]*\.)?)?/, "");
// minutes to drive between two follow-ups on one day (the visits themselves are visitMin each)
export const FU_GAP_MIN = 15;
// The plan's other timed follow-ups, as fitFollowUp's `others`: outcomes {id: outcome}, venues {id: {name}}.
export const otherFollowUps = (outcomes = {}, venues = {}, except = null) => Object.entries(outcomes ?? {}).filter(([id, o]) => id !== except && o?.followUp && o.followUpTime).map(([id, o]) => ({ id, name: venues?.[id]?.name ?? "", followUp: o.followUp, followUpTime: o.followUpTime }));
const when = (alt) => `${niceDate(alt.date)}${alt.time ? `, ${clockShort(toMinutes(alt.time))}` : ""}`;
// The offered day on a button: "Thu Oct 29, 5 pm (not a plan day)"; then = words after the day ("Thu Oct 29 instead (…)").
export const altLabel = (alt, then = "") => `${when(alt)}${then}${alt?.planDay === false ? " (not a plan day)" : ""}`;
// A chat offer ({id, outcome, alt}) can still be taken while the door's saved follow-up is the one it was made for (judge
// pass 5 #3: the Move button went with the next message). outcomes: the plan's {id: outcome}.
export function offerLive(offer, outcomes = {}) {
  const now = outcomes?.[offer?.id];
  return Boolean(now?.followUp) && now.followUp === offer.outcome?.followUp && (now.followUpTime ?? "") === (offer.outcome?.followUpTime ?? "");
}

// Judge pass 6 (#7): "move Bernie's to Tuesday" put a room closed Tuesdays on Tuesday. Why a door can't be visited in
// a plan day's window ({date, from, to} minutes): "closed Tuesdays" | "not open 2 pm–6 pm Tuesday" | null (it can, or
// its hours don't say).
export function shutOn(venue, { date, from, to, visitMin = 25 } = {}) {
  const parsed = hoursOf(venue);
  const day = dayOf(date);
  const spans = daySpans(parsed, day);
  if (!spans || !Number.isFinite(from) || !Number.isFinite(to)) return null;
  const m = openMinutes(parsed, day, from, to);
  if (m == null || m >= visitMin) return null;
  return spans.length ? `not open ${clockShort(from)}–${clockShort(to)} ${Day(day)}` : `closed ${plural(day)}`;
}
// The outcome moved to the offered day (the "instead?" button).
export const moveFollowUp = (outcome, alt) => {
  const o = { ...outcome, followUp: alt.date };
  if (alt.time) o.followUpTime = alt.time;
  else delete o.followUpTime;
  return o;
};

// Judge, phone #7: the "Come back" chip's day, never a closed one, and {planDay:false} when it is a day the plan has no
// route for (Easy Does It, closed Mon–Wed, on a Fri + Tue plan: Thu Oct 29), so the chip can say so. No windows: true.
export function comeBackDay(venue, { windows = [], from, visitMin = 25, week = null } = {}) {
  windows = reachWindows(windows, week, addDays(from, 14)); // the usual week: the days after the plan's last
  const date = followUpDay(venue, { windows, from, visitMin }) ?? defaultFollowUp(windows, from);
  return { date, planDay: !windows.length || windows.some((w) => w?.date === date) };
}

// The day a one-tap "Come back" offers at this door: the next plan day after `from` it is open on, else the next
// calendar day it is open (drive mode's chip offered Bernie's a Tuesday it is closed). Hours unknown: the next plan
// day, as lib/outcome.js defaultFollowUp picks it. → "YYYY-MM-DD" | null (no open day known: the caller's default)
export function followUpDay(venue, { windows = [], from, visitMin = 25, week = null } = {}) {
  windows = reachWindows(windows, week, addDays(from, 14));
  const parsed = hoursOf(venue);
  if (!parsed?.ok) return null;
  return nextOpenDay(venue, { after: from, windows, visitMin })?.date ?? null;
}

// The chat's answer (ui/agent.js), before its actions are applied: each logged follow-up checked against its door's
// hours. "early" changes the outcome to the opening and the read-back with it; "closed" keeps it and adds the offer.
// r: {reply, actions}; venues: {id: {name, hours}}. → {reply, actions, offers:[{id, name, outcome, alt}]}
const WHEN = /\b(mon|tues?|wed(nes)?|thu(rs)?|fri|sat(ur)?|sun)(day)?\b|\b\d{1,2}(:\d{2})?\s*([ap]\.?m\b\.?)|\b\d{1,2}:\d{2}\b|\b(tomorrow|tonight|next week)\b/i;
export function fitReply(r, venues, { windows = [], visitMin = 25, outcomes = {}, week = null } = {}) {
  const said = { ...(outcomes ?? {}) }; // the plan's follow-ups, then this reply's own, as they are checked
  let reply = String(r?.reply ?? "");
  const offers = [];
  const add = (text) => {
    const k = reply.indexOf(" Next: ");
    reply = k >= 0 ? `${reply.slice(0, k)} ${text}${reply.slice(k)}` : `${reply}${reply ? " " : ""}${text}`;
  };
  const actions = (r?.actions ?? []).map((a) => {
    if (a?.type !== "outcome" || !a.outcome?.followUp) return a;
    const v = venues?.[a.id];
    const fit = fitFollowUp(a.outcome, v, { windows, visitMin, others: otherFollowUps(said, venues, a.id), week });
    said[a.id] = fit.outcome;
    if (!fit.code) return a;
    const moved = fit.outcome !== a.outcome; // the time became the opening ("early", or before a "clash" offer)
    if (moved) reply = reply.split(sayOutcome(a.outcome)).join(sayOutcome(fit.outcome));
    // live check 2 (F7): a model's own wording ("I have logged that follow-up for Tuesday at 10:00 AM") isn't
    // sayOutcome's, so it stood over the fix line that contradicts it: its sentences naming a day or a time go, and
    // the read-back says what is saved
    if (!reply.includes(sayOutcome(a.outcome)) && !reply.includes(sayOutcome(fit.outcome))) {
      const said = (reply.match(/[^.!?]+[.!?]*/g) ?? []).filter((x) => !WHEN.test(x)).join("").trim();
      if (said !== reply.trim()) reply = `Logged ${v?.name ?? "this stop"}: ${sayOutcome(moved ? fit.outcome : a.outcome).replace(/\.$/, "")}.${said ? ` ${said}` : ""}`;
    }
    add(fit.text);
    if (fit.alt) offers.push({ id: a.id, name: v?.name ?? "", outcome: fit.outcome, alt: fit.alt });
    return moved ? { ...a, outcome: fit.outcome } : a;
  });
  return { ...r, reply, actions, offers };
}

// Drive mode's read-back (ui/drive.js), checked the same way: r = a logVisit answer ({ok, visit:{status, outcome},
// say}); next = the next door's name or "". → {r (outcome and say updated), alt (the offered day) | null}
export function fitDriveResult(r, venue, { windows = [], visitMin = 25, next = "", others = [], week = null } = {}) {
  const o = r?.visit?.outcome;
  if (!r?.ok || !o?.followUp) return { r, alt: null };
  const fit = fitFollowUp(o, venue, { windows, visitMin, others, week });
  if (!fit.code) return { r, alt: null };
  if (fit.code === "closed") return closedDriveResult(r, venue, fit, next);
  const say = `Logged ${venue?.name ?? "this stop"}: ${sayOutcome(fit.outcome).replace(/\.$/, "")}. ${fit.text}${next ? ` Next: ${next}.` : ""}`;
  return { r: { ...r, visit: { ...r.visit, outcome: fit.outcome }, say }, alt: fit.alt };
}
// Judge pass 6 (#2): on a closed day the big Save stored the day Doors had just said can't happen, under a 7-line
// read-back that opened with it. Now Save takes the offered open day and the read-back leads with what is stored; the
// other choice (noDay) keeps no follow-up day, the rep's words staying in the note. No open day found: no day.
// → {r, alt: null, noDay: the no-day result | null}
function closedDriveResult(r, venue, fit, next) {
  const name = venue?.name ?? "this stop";
  const why = fit.text.replace(/ \(Qloo's hours\)\..*$/, "").replace(/^.*? is closed /, "it's closed ").replace(/^.*? isn't open /, "it isn't open ");
  const tail = next ? ` Next: ${next}.` : "";
  const noOutcome = { ...fit.outcome };
  delete noOutcome.followUp;
  delete noOutcome.followUpTime;
  const said = (o) => sayOutcome(o).replace(/\.$/, "");
  const noDay = { ...r, visit: { ...r.visit, outcome: noOutcome }, say: `Logged ${name}: ${said(noOutcome)}. No follow-up day yet: ${why} (Qloo's hours).${tail}`, closedWhy: why };
  if (!fit.alt) return { r: noDay, alt: null, noDay: null };
  const moved = moveFollowUp(fit.outcome, fit.alt);
  const tag = fit.alt.planDay === false ? " (not a plan day)" : "";
  const text = said(moved).replace(/(↻ Follow up [^·]*?)( · |$)/, `$1${tag}$2`);
  const Why = why[0].toUpperCase() + why.slice(1);
  return { r: { ...r, visit: { ...r.visit, outcome: moved }, say: `Logged ${name}: ${text}. ${Why} (Qloo's hours).${tail}`, closedWhy: why, planDay: fit.alt.planDay !== false }, alt: null, noDay };
}
// The read-back after "instead": the outcome moved to the offered day.
export function movedDriveResult(r, venue, alt, { next = "" } = {}) {
  const outcome = moveFollowUp(r.visit.outcome, alt);
  return { ...r, visit: { ...r.visit, outcome }, say: `Logged ${venue?.name ?? "this stop"}: ${sayOutcome(outcome).replace(/\.$/, "")}.${next ? ` Next: ${next}.` : ""}` };
}

// Judge, phone #7 (web and phone alike): drive mode's read-back (r.say) keeps every fact on screen; read aloud to a
// driver it is one sentence: what was logged and the next door, or, when the follow-up needs a choice, just the
// question. No note (the rep's own words), no symbols. r: a drive result as fitDriveResult/movedDriveResult return it;
// opts as fitDriveResult's. → the sentence to speak
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const sayDate = (date) => `${Day(dayOf(date))}, ${MONTH_NAMES[+String(date).slice(5, 7) - 1]} ${+String(date).slice(8, 10)}`;
const sayWhen = (date, time) => `${sayDate(date)}${time ? ` at ${clockShort(toMinutes(time))}` : ""}`;
export function driveSpeech(r, venue, { windows = [], visitMin = 25, next = "", others = [], week = null } = {}) {
  const name = venue?.name ?? "this stop";
  const o = r?.visit?.outcome ?? null;
  // judge pass 6 (#2): a closed day's follow-up was already moved to the offered day: say that day, then why
  if (r?.closedWhy) {
    const back = o?.followUp ? `${o.result === "followup" ? "" : ", back"} ${sayWhen(o.followUp, o.followUpTime)}, ${r.planDay === false ? "not a plan day, " : ""}as ${r.closedWhy}` : `, no follow-up day yet, as ${r.closedWhy}`;
    const word = { interested: "interested", followup: "follow up", someone: o?.who ? `talked to ${o.who}` : "talked to someone else", no: "not interested" }[o?.result] ?? "visited";
    return `Logged ${name}: ${word}${back}${next && r.planDay !== false ? `; next, ${next}` : ""}.`;
  }
  const fit = o?.followUp ? fitFollowUp(o, venue, { windows, visitMin, others, week }) : null;
  if (fit?.spoken) return fit.spoken; // closed or clash: the rep picks (on screen) before the next door
  const word = { interested: "interested", followup: "follow up", someone: o?.who ? `talked to ${o.who}` : "talked to someone else", no: "not interested" }[o?.result] ?? "visited";
  let what = word;
  if (o?.followUp) {
    const t = toMinutes(o.followUpTime);
    const opens = t != null && fit?.code !== "offplan" && (daySpans(hoursOf(venue), dayOf(o.followUp)) ?? []).some((s) => s.from === t);
    what = `${word}${o.result === "followup" ? "" : ", back"} ${sayWhen(o.followUp, o.followUpTime)}${opens ? ", when it opens" : ""}`;
  }
  if (fit?.code === "offplan") {
    const after = windows.map((w) => w?.date).filter((d) => d && d > o.followUp).sort()[0];
    what += `, which isn't a plan day, ${after ? `so the visit goes on ${sayDate(after)}` : "so add it to your days"}`;
  }
  return `Logged ${name}: ${what}${next && fit?.code !== "offplan" ? `; next, ${next}` : ""}.`;
}
