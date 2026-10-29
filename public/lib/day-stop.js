// Stop for today (GROUP3 item 9, Jard 10-24: "Something came up, we need to stop the day right here. What do we do
// with the rest of the doors?"): in Start my day the rep stops the day and picks what happens to the doors left: "Move
// them into the coming days" (End my day's roll, lib/day-debrief.js rollPlan: the end of each later day in the time it
// has left, rank order; the lowest-fit doors that find no room go back on Your list, with why) or "Put them back on
// Your list". Running late's doors that no longer fit get the same two choices. Each is one entry in the day's record
// (record.changes) so Changes you made lists it with one Undo, and a day stopped today says Resume my day (the Undo).
// Pure: no DOM, no clock, no storage. Shared by ui/drive.js, ui/plan.js and lib/basis.js. Covered by
// test/day-stop.test.mjs.
import { niceDate } from "./profile.js";
import { clockShort } from "./schedule.js";
import { recordOf, patchRecord, laterDays, rollPreview, whereNow, stuckWhy } from "./day-debrief.js";

export const STOP_WORDS = {
  button: "Stop for today",
  title: "Stop for today?",
  days: "Move them into the coming days",
  list: "Put them back on Your list",
  keep: "Keep going",
  resume: "Resume my day",
};

// The two choices' labels for n doors: "Move it into the coming days" / "Put it back on Your list" for one door
export const choiceLabel = (kind, n) => {
  const it = n === 1 ? "it" : "them";
  return kind === "list" ? `Put ${it} back on Your list` : `Move ${it} into the coming days`;
};

const nameOf = (plan, id) => plan?.venues?.[id]?.name ?? "a door";
const join = (xs) => (xs.length <= 1 ? xs[0] ?? "" : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
const names = (plan, ids) => join(ids.map((id) => nameOf(plan, id)));
const doors = (n) => (n === 1 ? "1 door" : `${n} doors`);
const short = (date) => niceDate(date).slice(0, 3);
// The later plan days as a short range: "Tue", "Tue and Wed", "Tue–Sat"
export function dayRange(dates) {
  const ds = [...new Set(dates)].sort();
  if (!ds.length) return "";
  if (ds.length === 1) return short(ds[0]);
  if (ds.length === 2) return `${short(ds[0])} and ${short(ds[1])}`;
  return `${short(ds[0])}–${short(ds.at(-1))}`;
}

// The doors that found no day, by why, in plain words: "No room left on Thu–Sat: Hold Out back on Your list."
// stuck: [{id, why}] (rollPreview's, or stuckWhy's now); date: the day they came off.
export function stuckText(plan, stuck, date) {
  const range = dayRange(laterDays(plan, date).map((x) => x.date));
  const by = new Map();
  for (const x of stuck ?? []) by.set(x.why, [...(by.get(x.why) ?? []), x.id]);
  return [...by].map(([why, ids]) => {
    const who = `${names(plan, ids)} back on Your list.`;
    if (why === "no later day in the plan") return `No day after this one in the plan: ${who}`;
    if (why === "not open during any later day's hours") return `Not open during your hours on ${range}: ${who}`;
    return `No room left on ${range}: ${who}`;
  }).join(" ");
}

// The Stop for today sheet, before the rep picks: the doors left, and what each choice will do with them.
// → {head, days, list}
export function stopSheet(plan, ids, date) {
  if (!ids?.length) return { head: "Every door is logged.", days: "", list: "" };
  const { groups, stuck } = rollPreview(plan, ids, date);
  const head = `${doors(ids.length)} left: ${names(plan, ids)}.`;
  const g0 = groups[0];
  const go = groups.length > 1
    ? `Doors puts them at the end of the coming days: ${groups.map((g) => `${names(plan, g.ids)} on ${niceDate(g.to)}`).join(", ")}.`
    : g0 ? `Doors puts ${g0.ids.length === ids.length ? (ids.length === 1 ? "it" : "them") : names(plan, g0.ids)} at the end of ${niceDate(g0.to)}.` : "";
  const keep = groups.length ? "The doors already on those days stay." : "";
  const days = [go, stuckText(plan, stuck, date), keep].filter(Boolean).join(" ");
  const list = `${ids.length === 1 ? "It comes off today and waits" : "They come off today and wait"} on Your list, on no day. Add ${ids.length === 1 ? "it" : "them"} to a day when you want.`;
  return { head, days, list };
}

// Where `ids` (taken off `date`) are now, said back after the move or listed under Changes you made: "Tue Oct 27: A, B.
// Wed Oct 28: C. No room left on Wed–Sat: D back on Your list." how "list": the ones on no day are on Your list by the
// rep's choice ("Back on Your list: A, B."), and one the planner placed on a day of its own accord says where.
export function whereText(plan, ids, date, how = "days") {
  const on = new Map();
  const off = [];
  for (const id of ids ?? []) {
    if (plan?.statuses?.[id] === "notfit") continue;
    const w = whereNow(plan, id, date);
    if (w.dayIndex >= 0) {
      const d = plan.days[w.dayIndex].date;
      on.set(d, [...(on.get(d) ?? []), id]);
    } else off.push(id);
  }
  const days = [...on].sort(([a], [b]) => a.localeCompare(b)).map(([d, xs]) => `${niceDate(d)}: ${names(plan, xs)}.`).join(" ");
  const rest = !off.length ? "" : how === "list" ? `Back on Your list: ${names(plan, off)}.` : stuckText(plan, off.map((id) => ({ id, why: stuckWhy(plan, id, date) })), date);
  return [days, rest].filter(Boolean).join(" ");
}

// The toast after the choice (from the plan as it is now, never from the preview)
export function stopDoneText(plan, ids, date, how, { late = false } = {}) {
  const where = whereText(plan, ids, date, how);
  const head = late ? "" : "Stopped for today.";
  return [head, where].filter(Boolean).join(" ") || "Stopped for today.";
}

// ---------- the change log (Changes you made) ----------
// One entry per Stop for today or running late re-home, kept on the day's record only when it moved something.
export const withChange = (r, ch) => ({ ...r, changes: [...(r?.changes ?? []), ch] });
const stampMin = (at) => {
  const m = /T(\d{2}):(\d{2})/.exec(String(at ?? ""));
  return m ? +m[1] * 60 + +m[2] : null;
};
// The entry as Changes you made says it. → {text, more}
export function changeText(plan, date, ch) {
  const t = stampMin(ch.at);
  const n = ch.ids?.length ?? 0;
  const what = ch.how === "list" ? "put back on Your list" : "moved into the coming days";
  const text = ch.kind === "stop"
    ? `Stopped ${niceDate(date)}${t != null ? ` at ${clockShort(t)}` : ""}: ${doors(n)} ${what}.`
    : `Running late on ${niceDate(date)}${ch.by ? ` (+${ch.by} min)` : ""}: ${names(plan, ch.ids)} ${what}.`;
  return { text, more: whereText(plan, ch.ids, date, ch.how) };
}
// Changes you made's facts for the day flow (lib/basis.js "mine"): every entry, newest first; Undo on the newest of a
// day while that day is today (a stop is undone the same day: Resume my day). → [{key, text, more, ids, fixes}]
export function dayChanges(plan, drive, today = null) {
  const out = [];
  for (const [date, r] of Object.entries(drive ?? {}).sort(([a], [b]) => b.localeCompare(a))) {
    const xs = r?.changes ?? [];
    xs.forEach((ch, i) => {
      if (!ch?.ids?.length) return;
      const { text, more } = changeText(plan, date, ch);
      const undo = date === today && i === xs.length - 1;
      out.push({ key: `d-${date}-${i}`, text, more, ids: [...ch.ids], fixes: undo ? [{ kind: "dayUndo", date, label: ch.kind === "stop" ? "Undo: resume my day" : "Undo" }] : [], at: ch.at ?? "" });
    });
  }
  return out.sort((a, b) => String(b.at).localeCompare(String(a.at))).map(({ at, ...f }) => f);
}

// The Undo of a day's newest change (Changes you made, Resume my day): the doors back at the end of `date`'s route in
// their order, off every other day; the record as before the change. saved: the saved plan (store.js `plan`); plan: the
// published one (statuses: a door marked Not a fit or talked to since stays off). → {saved, drive, ids, change} | null
export function undoChange(saved, plan, drive, date) {
  const r = recordOf(drive, date);
  const ch = (r.changes ?? []).at(-1);
  if (!ch?.ids?.length) return null;
  const k = saved?.days?.findIndex((d) => d && d.date === date) ?? -1;
  if (k < 0) return null;
  const st = plan?.statuses ?? {};
  const ids = ch.ids.filter((id) => st[id] !== "notfit" && st[id] !== "talked");
  const back = new Set(ids);
  const stopOf = new Map();
  const days = saved.days.map((d, i) => {
    if (!d || i === k) return d;
    for (const s of d.stops ?? []) if (back.has(s.id) && !stopOf.has(s.id)) stopOf.set(s.id, s);
    return d.stops?.some((s) => back.has(s.id)) ? { ...d, stops: d.stops.filter((s) => !back.has(s.id)) } : d;
  });
  const d = days[k];
  const have = new Set((d.stops ?? []).map((s) => s.id));
  days[k] = { ...d, stops: [...(d.stops ?? []), ...ids.filter((id) => !have.has(id)).map((id) => ({ ...(stopOf.get(id) ?? { id }), id }))] };
  const all = new Set(ch.ids);
  const next = patchRecord(drive, date, (x) => ({
    changes: (x.changes ?? []).slice(0, -1),
    removed: (x.removed ?? []).filter((y) => !all.has(y.id)),
    ...(ch.kind === "stop"
      ? { ended: null, paused: null, moved: null, bumped: [] }
      : { lateMoved: (x.lateMoved ?? []).map((g) => ({ ...g, ids: g.ids.filter((y) => !all.has(y)) })).filter((g) => g.ids.length) }),
  }));
  return { saved: { ...saved, days }, drive: next, ids, change: ch };
}
// The toast for it: "Back on today: A, B and C."
export const undoneText = (plan, ids) => (ids.length ? `Back on today: ${names(plan, ids)}.` : "Nothing to bring back: those doors are marked since.");

// ---------- "Put them back on Your list" holds them there ----------
// The doors the rep put back on Your list (Stop for today, running late) stay off every day until the rep adds one
// back (Add to the best day, a day picked, the Agent's add) or undoes the change (Undo, Resume my day): the saved
// state's `parked` ids, kept out of the planner's input. Your list still lists them (plan.pool), with why.
export const PARKED_REASON = "you put it back on Your list";
export const parkIds = (parked, ids) => [...new Set([...(parked ?? []), ...(ids ?? [])])];
export const unparkIds = (parked, ids) => {
  const out = new Set(ids ?? []);
  const left = (parked ?? []).filter((id) => !out.has(id));
  return left.length === (parked ?? []).length ? parked ?? [] : left;
};
// The planner's input (schedule.js planDays) without the parked doors: not in the pool, not pinned, not locked.
export function withoutParked(input, parked) {
  const out = new Set(parked ?? []);
  if (!out.size) return input;
  const keep = (x) => !out.has(x?.id);
  return { ...input, pool: (input.pool ?? []).filter(keep), pinned: (input.pinned ?? []).filter(keep), locks: (input.locks ?? []).filter(keep) };
}
// The plan with each parked door's reason for Your list (planview restReason reads plan.reasons)
export function markParked(p, parked) {
  if (!p || !parked?.length) return p;
  const on = new Set((p.days ?? []).flatMap((d) => (d?.stops ?? []).map((s) => s.id)));
  const reasons = { ...(p.reasons ?? {}) };
  for (const id of parked) if (!on.has(id)) reasons[id] = { code: "parked", text: PARKED_REASON };
  return { ...p, reasons };
}
