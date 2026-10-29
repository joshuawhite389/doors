// The Log book (round 4 item 10, Jard 10-27: "a comprehensive place that collects all my activity, doors i've visited,
// doors i'm scheduled to visit, decisions, notes, etc. … also collect doors i'm interested in visiting that i have not
// put on a day's route yet … a simple, intuitive CRM"). Built on what the plan already keeps on the device (store.js
// state: statuses, outcomes, added doors, contacts, notes, the days' drive records, Changes you made, the plan) plus two
// fields of its own, written to the same state:
//   later    {id: {at, venue}}   Save for later: a door the rep wants to visit but hasn't put on a day (venue: enough of
//                                the record to show it when it isn't in the current pool)
//   activity [{seq, at, id?, name?, kind, …}]   every change to a door, appended as the store is written (withActivity
//                                wraps the store, below), so each door has a timeline with times. Capped.
// Pure: no DOM, no storage. Covered by test/logbook.test.mjs.
import { genreLabel } from "./core.js";
import { niceDate, clock12 } from "./profile.js";
import { notesOf } from "./door-notes.js";
import { localStamp, RESULT_TEXT } from "./outcome.js";

export const ACTIVITY_CAP = 3000;
// round 6 #5: the pane's name on the plan's top bar, one constant (Jard picked "My doors" on 10-27; it was "Log book")
export const LOGBOOK_LABEL = "My doors";
const p2 = (n) => String(n).padStart(2, "0");
const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : "");
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

// ---------- Save for later ----------
// The venue fields kept with a saved door (the rest is read from the plan when the door is in it).
export const laterVenue = (v) => (v ? { id: v.id, name: v.name ?? "", address: v.address ?? "", neighborhood: v.neighborhood ?? null, genre: v.genre ?? "", lat: v.lat, lon: v.lon, phone: v.phone ?? "", website: v.website ?? "" } : null);
// state → the same with `id` saved for later (on) or not (off). The input is not changed.
export function withLater(state, id, on, venue = null, at = localStamp(new Date())) {
  const later = { ...(state?.later ?? {}) };
  if (on) later[id] = { at, venue: laterVenue(venue) ?? later[id]?.venue ?? null };
  else delete later[id];
  return { ...state, later };
}

// ---------- the activity log ----------
// Every change between two saved states of a brand-city, as events. prev → next. Nothing when prev was never saved (a
// state moved under a new brand name, an import: its history rides along in `activity` already).
const noteMap = (slots) => {
  const out = new Map();
  for (const [id, recs] of Object.entries(slots ?? {})) for (const r of recs ?? []) if (r?.field === "note" && typeof r.value === "string" && r.value.trim()) out.set(`${id}|${r.id ?? `${r.at}|${r.value}`}`, { id, text: r.value, by: r.by ?? "rep" });
  return out;
};
const ids = (xs) => new Set((xs ?? []).map((x) => (typeof x === "string" ? x : x?.id)).filter(Boolean));
export function activityDiff(prev, next, { at = localStamp(new Date()), nameOf = () => null } = {}) {
  if (!isObj(prev) || !isObj(next) || !prev.savedAt) return [];
  const out = [];
  const ev = (kind, id, extra = {}) => out.push({ at, kind, ...(id ? { id, name: nameOf(id) ?? next.later?.[id]?.venue?.name ?? (next.added ?? []).find((v) => v.id === id)?.name ?? (next.contacts ?? []).find((v) => v.id === id)?.name ?? null } : {}), ...extra });
  const ps = prev.statuses ?? {}, ns = next.statuses ?? {};
  for (const id of new Set([...Object.keys(ps), ...Object.keys(ns)])) if ((ps[id] ?? null) !== (ns[id] ?? null)) ev("status", id, { to: ns[id] ?? null, from: ps[id] ?? null });
  const po = prev.outcomes ?? {}, no = next.outcomes ?? {};
  for (const id of new Set([...Object.keys(po), ...Object.keys(no)])) {
    if (same(po[id], no[id])) continue;
    const o = no[id];
    if (o) ev("outcome", id, { at: o.at && /^\d{4}-\d{2}-\d{2}T/.test(o.at) ? o.at : at, result: o.result, followUp: o.followUp ?? null, who: o.who ?? null, note: o.note ?? null });
    else ev("outcomeCleared", id);
  }
  const pa = ids(prev.added), na = ids(next.added);
  for (const id of na) if (!pa.has(id)) ev("added", id, { date: (next.added ?? []).find((v) => v.id === id)?.date ?? null });
  for (const id of pa) if (!na.has(id)) ev("unadded", id);
  const pc = ids(prev.contacts), nc = ids(next.contacts);
  for (const id of nc) if (!pc.has(id)) ev("contact", id);
  for (const id of pc) if (!nc.has(id)) ev("uncontact", id);
  const pp = ids(prev.parked), np = ids(next.parked);
  for (const id of np) if (!pp.has(id)) ev("parked", id);
  for (const id of pp) if (!np.has(id)) ev("unparked", id);
  const pl = prev.later ?? {}, nl = next.later ?? {};
  for (const id of Object.keys(nl)) if (!pl[id]) ev("saved", id);
  for (const id of Object.keys(pl)) if (!nl[id]) ev("unsaved", id);
  const pn = noteMap(prev.slots), nn = noteMap(next.slots);
  for (const [k, n] of nn) if (!pn.has(k)) ev("note", n.id, { text: n.text, by: n.by }); else if (pn.get(k).text !== n.text) ev("noteEdited", n.id, { text: n.text, by: n.by });
  for (const [k, n] of pn) if (!nn.has(k)) ev("noteDeleted", n.id, { text: n.text });
  const pk = new Map((prev.locks ?? []).map((l) => [l.id, l])), nk = new Map((next.locks ?? []).map((l) => [l.id, l]));
  for (const id of nk.keys()) if (!pk.has(id)) ev("locked", id, { date: nk.get(id).date ?? null });
  for (const id of pk.keys()) if (!nk.has(id)) ev("unlocked", id);
  const pd = prev.drive ?? {}, nd = next.drive ?? {};
  for (const [date, r] of Object.entries(nd)) {
    const was = pd[date] ?? {};
    const seen = new Set((was.removed ?? []).map((x) => `${x.id}|${x.how}|${x.at ?? ""}`));
    for (const x of r?.removed ?? []) if (x?.id && !seen.has(`${x.id}|${x.how}|${x.at ?? ""}`)) ev("offDay", x.id, { date, how: x.how ?? "later", at: x.at && /^\d{4}-\d{2}-\d{2}T/.test(x.at) ? x.at : at });
    const sk = new Set(was.skipped ?? []);
    for (const id of r?.skipped ?? []) if (!sk.has(id)) ev("skipped", id, { date });
    for (const ch of (r?.changes ?? []).slice((was.changes ?? []).length)) for (const id of ch?.ids ?? []) ev("dayChange", id, { date, change: ch.kind, how: ch.how, by: ch.by ?? null, at: ch.at && /^\d{4}-\d{2}-\d{2}T/.test(ch.at) ? ch.at : at });
    if (r?.started && !was.started) ev("dayStarted", null, { date });
    if (r?.ended && !was.ended) ev("dayEnded", null, { date });
  }
  const pw = new Map((prev.whyChanges ?? []).map((e) => [e.id, e])), nw = new Map((next.whyChanges ?? []).map((e) => [e.id, e]));
  for (const [id, e] of nw) if (!pw.has(id)) ev("change", null, { text: e.text ?? "", ref: id });
  for (const [id, e] of pw) if (!nw.has(id)) ev("changeUndone", null, { text: e.text ?? "", ref: id });
  return out;
}

// The saved state with `events` appended to its activity (numbered on, capped).
export function withActivity(state, events) {
  if (!events?.length) return state;
  const was = Array.isArray(state?.activity) ? state.activity : [];
  let seq = was.length ? Math.max(...was.map((e) => e.seq ?? 0)) : 0;
  const all = [...was, ...events.map((e) => ({ ...e, seq: ++seq }))];
  return { ...state, activity: all.length > ACTIVITY_CAP ? all.slice(all.length - ACTIVITY_CAP) : all };
}

// A store (lib/store.js createStore) whose plan writes log their changes: every save, update, setStatus, setOutcome and
// setSlots on a brand-city diffs the state before and after and appends the events. nameOf(id): a door's name now
// (the plan on screen), kept on the event so the Log book can say it when the door is no longer in the plan.
export function loggingStore(store, { nameOf = () => null, now = () => new Date() } = {}) {
  const wrap = (fn) => (brand, city, ...rest) => {
    const prev = store.load(brand, city);
    const out = fn(brand, city, ...rest);
    const events = activityDiff(prev, out, { at: localStamp(now()), nameOf });
    return events.length ? store.update(brand, city, (s) => withActivity(s, events)) : out;
  };
  return { ...store, save: wrap(store.save), update: wrap(store.update), setStatus: wrap(store.setStatus), setOutcome: wrap(store.setOutcome), setSlots: wrap(store.setSlots) };
}

// ---------- what an event says ----------
const STATUS_TEXT = { visited: "Visited", talked: "Already know them", notfit: "Not a fit", removed: "Removed from my plan" };
const OFF_TEXT = { later: (d) => `Taken off ${niceDate(d)}'s route, to a later day`, dropped: (d) => `Taken off ${niceDate(d)}'s route`, end: (d) => `Not reached on ${niceDate(d)} (End my day)`, endlist: (d) => `Not reached on ${niceDate(d)}: back on Your list` };
const who = (by) => (by === "rep" ? "you" : by === "drive" ? "you, on the road" : /^(agent|rules)/.test(String(by ?? "")) ? "Doors Agent" : "you");
const q = (t, n = 80) => (t ? `“${t.length > n ? `${t.slice(0, n).replace(/\s+\S*$/, "")}…` : t}”` : "");
export function outcomeText(o) {
  if (!o?.result) return "";
  const head = o.result === "followup" && o.followUp ? `Follow up ${niceDate(o.followUp)}` : RESULT_TEXT[o.result] ?? cap(o.result);
  const tail = [o.result !== "followup" && o.followUp ? `follow up ${niceDate(o.followUp)}` : "", o.who ? `talked to ${o.who}` : "", o.note ? q(o.note) : ""].filter(Boolean).join(" · ");
  return tail ? `${head} · ${tail}` : head;
}
export function eventText(e) {
  switch (e?.kind) {
    case "status": return e.to ? (e.to === "visited" ? "Visited" : `Marked ${STATUS_TEXT[e.to] ?? e.to}`) : `Unmarked (was ${STATUS_TEXT[e.from] ?? e.from ?? "marked"})`;
    case "visit": return `Visited · ${outcomeText(e)}`;
    case "outcome": return `Outcome: ${outcomeText(e)}`;
    case "outcomeCleared": return "Outcome cleared";
    case "added": return e.date ? `Added to your plan for ${niceDate(e.date)}` : "Added to your plan";
    case "unadded": return "Taken off your plan";
    case "contact": return "Saved as your contact";
    case "uncontact": return "Contact removed";
    case "parked": return "Put back on Your list, off every day";
    case "unparked": return "Back on a day";
    case "saved": return "Saved for later";
    case "unsaved": return "Taken off Saved for later";
    case "note": return `Note by ${who(e.by)}: ${q(e.text)}`;
    case "noteEdited": return `Note edited: ${q(e.text)}`;
    case "noteDeleted": return `Note deleted: ${q(e.text)}`;
    case "locked": return e.date ? `Locked onto ${niceDate(e.date)}` : "Locked in its place";
    case "unlocked": return "Unlocked";
    case "offDay": return (OFF_TEXT[e.how] ?? OFF_TEXT.dropped)(e.date);
    case "skipped": return `Skipped for now on ${niceDate(e.date)}`;
    case "dayChange": return `${e.change === "stop" ? `Stopped for today (${niceDate(e.date)})` : `Running late on ${niceDate(e.date)}${e.by ? ` (+${e.by} min)` : ""}`}: ${e.how === "list" ? "put back on Your list" : "moved into the coming days"}`;
    case "dayStarted": return `Started ${niceDate(e.date)}`;
    case "dayEnded": return `Ended ${niceDate(e.date)}`;
    case "change": return e.text || "Plan changed";
    case "changeUndone": return `Undone: ${e.text || "a change"}`;
    default: return String(e?.kind ?? "");
  }
}
// "2026-10-27T14:05:00" → "Mon Oct 27, 2:05 pm"; a date alone → "Mon Oct 27"
export function whenText(at) {
  const m = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2}))?/.exec(String(at ?? ""));
  if (!m) return "";
  return m[2] ? `${niceDate(m[1])}, ${clock12(+m[2] * 60 + +m[3])}` : niceDate(m[1]);
}

// A door's events, newest first, a visit and its outcome logged together read as one line. events: the state's activity.
export function doorTimeline(activity, id) {
  const mine = (activity ?? []).filter((e) => e.id === id).sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  const out = [];
  for (const e of mine) {
    const last = out.at(-1);
    if (e.kind === "outcome" && last?.kind === "status" && last.to === "visited" && (e.seq ?? 0) - (last.seq ?? 0) <= 3) out[out.length - 1] = { ...e, kind: "visit" };
    else out.push(e);
  }
  return out.map((e) => ({ ...e, text: eventText(e), when: whenText(e.at) })).sort((a, b) => String(b.at).localeCompare(String(a.at)) || (b.seq ?? 0) - (a.seq ?? 0));
}
// The plan-level events (no door): Changes you made, days started and ended. Newest first.
export const planTimeline = (activity) => (activity ?? []).filter((e) => !e.id).map((e) => ({ ...e, text: eventText(e), when: whenText(e.at) })).sort((a, b) => String(b.at).localeCompare(String(a.at)) || (b.seq ?? 0) - (a.seq ?? 0));

// ---------- the rows ----------
// One status per door, in plain words. Order = what wins when several hold.
export const STATUSES = [
  { key: "due", label: "Follow-up due" },
  { key: "followup", label: "Follow up booked" },
  { key: "interested", label: "Interested" },
  { key: "someone", label: "Talked to someone else" },
  { key: "no", label: "Not interested" },
  { key: "visited", label: "Visited" },
  { key: "scheduled", label: "Scheduled" },
  { key: "saved", label: "Saved for later" },
  { key: "notfit", label: "Not a fit" },
  { key: "talked", label: "Already know them" },
  { key: "removed", label: "Removed" },
  { key: "list", label: "On Your list" },
  { key: "off", label: "Not on your list" },
];
export const STATUS_LABEL = Object.fromEntries(STATUSES.map((s) => [s.key, s.label]));

// state: the saved brand-city state; plan: the published plan (state.js shape: days, venues, pool, statuses, outcomes,
// slots) or null; today: "YYYY-MM-DD". → [{id, name, genre, hood, address, status, label, day, date, dayName, stop,
// eta, past, outcome, followUp, who, due, saved, savedAt, notes, lastText, lastAt, next, rank, events}]
export function logbookRows({ state = {}, plan = null, today = "" } = {}) {
  const venues = plan?.venues ?? {};
  const statuses = { ...(state.statuses ?? {}), ...(plan?.statuses ?? {}) };
  const outcomes = { ...(state.outcomes ?? {}), ...(plan?.outcomes ?? {}) };
  const later = state.later ?? {};
  const slots = { ...(state.slots ?? {}), ...(plan?.slots ?? {}) };
  const activity = state.activity ?? [];
  const onDay = new Map();
  (plan?.days ?? []).forEach((d, i) => d?.stops?.forEach((s, k) => onDay.has(s.id) || onDay.set(s.id, { day: i, date: d.date, dayName: cap(d.day ?? ""), stop: k + 1, eta: s.eta ?? null, past: !!d.past })));
  const touched = new Set([
    ...Object.keys(statuses).filter((id) => statuses[id]),
    ...Object.keys(outcomes),
    ...(state.added ?? []).map((v) => v.id),
    ...(state.contacts ?? []).map((v) => v.id),
    ...Object.keys(later),
    ...Object.keys(slots).filter((id) => id !== "*" && notesOf(slots, id).length),
    ...activity.map((e) => e.id).filter(Boolean),
    ...Object.values(state.drive ?? {}).flatMap((r) => [...(r?.removed ?? []).map((x) => x.id), ...(r?.skipped ?? [])]),
    ...onDay.keys(),
  ]);
  const rank = new Map((plan?.pool?.ids ?? []).map((id, i) => [id, i + 1]));
  const rows = [];
  for (const id of touched) {
    const v = venues[id] ?? later[id]?.venue ?? (state.added ?? []).find((x) => x.id === id) ?? (state.contacts ?? []).find((x) => x.id === id) ?? null;
    const name = v?.name ?? activity.find((e) => e.id === id && e.name)?.name ?? "A door no longer in this plan";
    const st = statuses[id] ?? null;
    const o = outcomes[id] ?? null;
    const on = onDay.get(id) ?? null;
    const due = !!(o?.followUp && today && o.followUp <= today);
    const saved = !!later[id];
    const status = st === "visited"
      ? due ? "due" : o?.result === "followup" ? "followup" : o?.result ? o.result : "visited"
      : st === "talked" || st === "notfit" || st === "removed" ? st
      : on && !on.past ? "scheduled"
      : saved ? "saved"
      : rank.has(id) || on ? "list" : "off";
    const notes = notesOf(slots, id);
    const tl = doorTimeline(activity, id);
    const last = tl[0] ?? (o?.at ? { text: `Outcome: ${outcomeText(o)}`, at: o.at } : null);
    const next = status === "due" ? `Follow up now: it was due ${niceDate(o.followUp)}`
      : status === "followup" ? `Follow up ${niceDate(o.followUp)}${o.followUpTime ? ` at ${o.followUpTime}` : ""}`
      : status === "interested" ? (o?.followUp ? `Follow up ${niceDate(o.followUp)}` : "Book a follow-up")
      : status === "someone" ? "Go back for the buyer"
      : status === "scheduled" ? `${on.dayName || niceDate(on.date)} · stop ${on.stop}${on.eta != null ? ` · ${clock12(on.eta)}` : ""}`
      : status === "saved" ? "Put it on a day"
      : status === "list" ? "Add it to a day, or save it for later"
      : "";
    rows.push({
      id, name, genre: cap(genreLabel(v ?? {})) || (v?.source === "manual" ? "Added by you" : ""), hood: v?.neighborhood ?? null, address: v?.address ?? "", phone: v?.phone ?? "",
      status, label: STATUS_LABEL[status], due, saved, savedAt: later[id]?.at ?? null,
      day: on?.day ?? null, date: on?.date ?? null, dayName: on?.dayName ?? "", stop: on?.stop ?? null, eta: on?.eta ?? null, past: on?.past ?? false,
      outcome: o?.result ?? null, outcomeText: o ? outcomeText(o) : "", followUp: o?.followUp ?? null, who: o?.who ?? null,
      notes, lastText: last?.text ?? "", lastAt: last?.at ?? "", next, rank: rank.get(id) ?? null, events: tl.length, contact: !!v?.contact, added: !!v?.added,
    });
  }
  return rows;
}

// ---------- filters, search, sort ----------
export const SORTS = [
  { key: "recent", label: "Last activity" },
  { key: "name", label: "Name" },
  { key: "status", label: "Status" },
  { key: "day", label: "Day and stop" },
  { key: "followUp", label: "Follow-up date" },
  { key: "rank", label: "Rank on Your list" },
];
const fold = (s) => String(s ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
export function filterRows(rows, { status = [], hood = "", q = "", saved = false } = {}) {
  const want = new Set(status.filter(Boolean));
  const t = fold(q).trim();
  return rows.filter((r) =>
    (!want.size || want.has(r.status) || (want.has("saved") && r.saved) || (want.has("visited") && ["due", "followup", "interested", "someone", "no"].includes(r.status)))
    && (!saved || r.saved)
    && (!hood || (r.hood ?? "") === hood)
    && (!t || [r.name, r.hood, r.genre, r.address, r.who, r.label, r.outcomeText, r.next, ...r.notes.map((n) => n.text)].some((x) => fold(x).includes(t))));
}
const statusOrder = new Map(STATUSES.map((s, i) => [s.key, i]));
export function sortRows(rows, key = "recent") {
  const by = {
    recent: (a, b) => String(b.lastAt).localeCompare(String(a.lastAt)) || a.name.localeCompare(b.name),
    name: (a, b) => a.name.localeCompare(b.name),
    status: (a, b) => statusOrder.get(a.status) - statusOrder.get(b.status) || String(b.lastAt).localeCompare(String(a.lastAt)),
    day: (a, b) => (a.date == null) - (b.date == null) || String(a.date ?? "").localeCompare(String(b.date ?? "")) || (a.stop ?? 0) - (b.stop ?? 0) || a.name.localeCompare(b.name),
    followUp: (a, b) => (a.followUp == null) - (b.followUp == null) || String(a.followUp ?? "").localeCompare(String(b.followUp ?? "")) || a.name.localeCompare(b.name),
    rank: (a, b) => (a.rank == null) - (b.rank == null) || (a.rank ?? 0) - (b.rank ?? 0),
  }[key] ?? ((a, b) => 0);
  return [...rows].sort(by);
}

// ---------- counts ----------
// "This week" = Monday to Sunday around `today`.
export function weekOf(today) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(today ?? ""));
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  const back = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - back);
  const from = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
  d.setDate(d.getDate() + 6);
  return { from, to: `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}` };
}
// → {doors, visited, visitedWeek, due, scheduled, saved, byOutcome: [{key, label, n}], byHood: [{hood, n}], notes}
export function logbookCounts(rows, { state = {}, today = "" } = {}) {
  const wk = weekOf(today);
  const visitedAt = new Map();
  for (const e of state.activity ?? []) if (e.id && ((e.kind === "status" && e.to === "visited") || e.kind === "outcome")) visitedAt.set(e.id, [...(visitedAt.get(e.id) ?? []), e.at]);
  const visitedRows = rows.filter((r) => ["due", "followup", "interested", "someone", "no", "visited"].includes(r.status));
  const inWeek = (at) => wk && at && at.slice(0, 10) >= wk.from && at.slice(0, 10) <= wk.to;
  const visitedWeek = visitedRows.filter((r) => inWeek(state.outcomes?.[r.id]?.at) || (visitedAt.get(r.id) ?? []).some(inWeek)).length;
  const n = (k) => rows.filter((r) => r.status === k).length;
  const byOutcome = [
    { key: "interested", label: "Interested", n: n("interested") },
    { key: "followup", label: "Follow up booked", n: n("followup") + n("due") },
    { key: "someone", label: "Talked to someone else", n: n("someone") },
    { key: "no", label: "Not interested", n: n("no") },
    { key: "visited", label: "Visited, no outcome yet", n: n("visited") },
  ].filter((x) => x.n);
  const hoods = new Map();
  for (const r of rows) if (r.hood) hoods.set(r.hood, (hoods.get(r.hood) ?? 0) + 1);
  const byHood = [...hoods].map(([hood, n]) => ({ hood, n })).sort((a, b) => b.n - a.n || a.hood.localeCompare(b.hood));
  return { doors: rows.length, visited: visitedRows.length, visitedWeek, week: wk, due: n("due"), scheduled: n("scheduled"), saved: rows.filter((r) => r.saved).length, notes: rows.reduce((t, r) => t + r.notes.length, 0), byOutcome, byHood };
}

// ---------- CSV ----------
export const LOG_COLUMNS = ["door", "status", "next_step", "day", "date", "stop", "last_activity", "last_activity_at", "outcome", "follow_up", "talked_to", "notes", "saved_for_later", "neighborhood", "kind", "address", "phone", "rank", "door_id"];
export const guardCell = (s) => (/^[=+\-@\t\r]/.test(s) ? `'${s}` : s); // a cell a spreadsheet would run as a formula
const cell = (v) => { const s = typeof v === "number" ? String(v) : guardCell(v == null ? "" : String(v)); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const line = (cols, o) => cols.map((c) => cell(o[c])).join(",");
export function logbookCSV(rows, { brand = "", city = "", today = "" } = {}) {
  const out = [LOG_COLUMNS.join(",")];
  for (const r of rows) out.push(line(LOG_COLUMNS, {
    door: r.name, status: r.label, next_step: r.next, day: r.dayName, date: r.date ?? "", stop: r.stop ?? "", last_activity: r.lastText, last_activity_at: r.lastAt,
    outcome: r.outcome ? RESULT_TEXT[r.outcome] ?? r.outcome : "", follow_up: r.followUp ?? "", talked_to: r.who ?? "", notes: r.notes.map((n) => `${n.who}: ${n.text}`).join(" | "),
    saved_for_later: r.saved ? "yes" : "", neighborhood: r.hood ?? "", kind: r.genre, address: r.address, phone: r.phone, rank: r.rank ?? "", door_id: /^contact:/.test(r.id) ? "" : r.id,
  }));
  out.push("", `${LOGBOOK_LABEL},${cell(brand)},${cell(city)},${cell(today)},Saved on this device only.`);
  return out.join("\r\n");
}
export const ACTIVITY_COLUMNS = ["at", "door", "event", "details", "door_id"];
export function activityCSV(activity, { nameOf = () => null } = {}) {
  const out = [ACTIVITY_COLUMNS.join(",")];
  const rows = [...(activity ?? [])].sort((a, b) => String(b.at).localeCompare(String(a.at)) || (b.seq ?? 0) - (a.seq ?? 0));
  for (const e of rows) out.push(line(ACTIVITY_COLUMNS, { at: e.at, door: e.id ? nameOf(e.id) ?? e.name ?? "" : "", event: cap(e.kind.replace(/([A-Z])/g, " $1").toLowerCase()), details: eventText(e), door_id: e.id && !/^contact:/.test(e.id) ? e.id : "" }));
  return out.join("\r\n");
}
