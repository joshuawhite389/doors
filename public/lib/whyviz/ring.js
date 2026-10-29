// WHY-VIZ-SPEC §4.4: when these doors fill, and when you are there. A 24-hour ring: the outer band is Qloo's
// time_of_day_fit tags over the plan's doors (one arc per day part, Doors' clock for Qloo's words), inside it one arc
// per door of the selected day (its opening hours that day, green where they overlap the day's window), the window
// wedge in the centre; a door closed that day draws nothing and is listed. Pure: no DOM, no fetch.
import { parseHours, formatDayHours, tagFamilies, DAYS } from "../core.js";
import { planIds } from "../insights.js";
import { clock12 } from "../profile.js";

// Doors' clock for Qloo's words (minutes from midnight; late night runs past it)
export const PARTS = [
  { key: "Morning", label: "Morning", from: 360, to: 660 },
  { key: "Midday", label: "Midday", from: 660, to: 840 },
  { key: "Afternoon", label: "Afternoon", from: 840, to: 1080 },
  { key: "Evening", label: "Evening", from: 1080, to: 1320 },
  { key: "Late night", label: "Late night", from: 1320, to: 1560 },
];
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
export const clock = (m) => clock12(((m % 1440) + 1440) % 1440).replace(":00", "");
const todOf = (v) => v?.tags?.tod ?? tagFamilies(v?.tags)?.tod ?? [];

// plan: the plan view's plan (days with from/to in minutes, stops); dayIndex: the selected day; venues: id → venue.
// → {parts:[{key, label, n, from, to}], n (plan doors), days:[{i, day, date, label, n, past}], day:{i, day, date, from, to, label},
//    arcs:[{id, name, spans, open (minutes inside the window), state: "open0" | "later" | "closed" | "unknown" | "missed",
//    opensAt, closesAt, hours, tod}], open0, later, closedN, unknownN, missedN, list:[{id, name, word, state}]}
export function ringModel({ plan, dayIndex = null, venues = plan?.venues ?? {} }) {
  const ids = planIds(plan);
  const counts = new Map(PARTS.map((p) => [p.key, 0]));
  for (const id of ids) for (const t of todOf(venues[id])) if (counts.has(t)) counts.set(t, counts.get(t) + 1);
  const parts = PARTS.map((p) => ({ ...p, n: counts.get(p.key) }));
  const days = (plan?.days ?? []).map((d, i) => ({ i, day: d.day, date: d.date, label: cap(d.day).slice(0, 3), n: d.stops?.length ?? 0, past: Boolean(d.past), from: d.from, to: d.to }));
  const live = days.filter((d) => !d.past);
  const di = Number.isInteger(dayIndex) && days[dayIndex] ? dayIndex : (live[0] ?? days[0])?.i ?? null;
  const d = di == null ? null : days[di];
  const day = d ? { i: d.i, day: d.day, date: d.date, from: d.from, to: d.to, label: `${cap(d.day)} ${clock(d.from)}–${clock(d.to)}` } : null;
  const arcs = [];
  if (day) {
    const prev = DAYS[(DAYS.indexOf(day.day) + 6) % 7];
    for (const s of plan.days[d.i].stops ?? []) {
      const v = venues[s.id] ?? {};
      const p = parseHours(v.hours);
      const entry = p.ok ? p.days[day.day] : null;
      // today's spans plus yesterday's run past midnight (a 2 am close counts for the small hours)
      const spill = p.ok ? (p.days[prev]?.spans ?? []).filter((x) => x.to > 1440).map((x) => ({ from: 0, to: x.to - 1440 })) : [];
      const spans = p.ok && entry && !entry.closed ? [...entry.spans] : [];
      const all = [...spill, ...spans];
      const open = all.reduce((t, x) => t + Math.max(0, Math.min(day.to, x.to) - Math.max(day.from, x.from)), 0);
      const first = spans.length ? Math.min(...spans.map((x) => x.from)) : null, last = spans.length ? Math.max(...spans.map((x) => x.to)) : null;
      const state = !p.ok ? "unknown" : entry?.closed || (!spans.length && !spill.length) ? "closed" : open <= 0 ? "missed" : first != null && first <= day.from ? "open0" : "later";
      arcs.push({ id: s.id, name: v.name ?? "A door", spans: all, open, state, opensAt: first, closesAt: last, hours: p.ok ? formatDayHours(p, day.day) : null, tod: todOf(v), eta: s.eta ?? null });
    }
  }
  const n = (k) => arcs.filter((a) => a.state === k).length;
  const word = (a) => (a.state === "closed" ? `closed ${cap(day.day)}` : a.state === "unknown" ? "hours unverified" : a.state === "missed" ? `${a.hours}: not while you're out` : a.state === "open0" ? `open at ${clock(day.from)}` : `opens ${clock(a.opensAt)}`);
  const order = { open0: 0, later: 1, missed: 2, closed: 3, unknown: 4 };
  const list = [...arcs].sort((p, q) => order[p.state] - order[q.state] || (p.opensAt ?? 1e9) - (q.opensAt ?? 1e9) || p.name.localeCompare(q.name)).map((a) => ({ id: a.id, name: a.name, word: word(a), state: a.state, hours: a.hours }));
  return { parts, n: ids.length, days, day, arcs, open0: n("open0"), later: n("later"), closedN: n("closed"), unknownN: n("unknown"), missedN: n("missed"), list };
}
