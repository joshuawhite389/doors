// The door card (Jard 10-23 #9; doorcard/concepts/RATIONALE.md, concept A): what the top of a stop shows, picked from the
// stop model (lib/stopmodel.js) so the web (ui/stop.js) and the phone (Stop.tsx) choose the same lines. Plain words only
// (GLOSSARY "Voice"). Everything here is a selection of lines Doors already wrote; nothing new is said.
import { outcomeTags } from "./outcome.js";
import { clock12 } from "./profile.js";
import { NO_ANGLE } from "./culture.js";

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : "");
const dot = (s) => (s && !/[.!?…”"]$/.test(s) ? `${s}.` : s);
const pick = (t, kind) => {
  const i = (t.beforeKinds ?? []).indexOf(kind);
  return i >= 0 ? t.before[i] : null;
};

// the angle under "To the buyer": none when Qloo's tags point at no angle (Jard web review 10-24)
const angleOf = (line) => { const a = line?.replace(/^Your angle: /, "") ?? null; return a && !a.startsWith(NO_ANGLE) ? a : null; };

// At the door: who to ask for (+ when), what they said last time, the opener, the ask, what to bring.
// → { askFor, timing, last[], opener, toBuyer, angle, order, ask, bring }; a line the brand's rules hid is null.
// Jard 10-24 #5: the opener is said to whoever is behind the bar; toBuyer to the buyer, with the angle (the rep's prep,
// from Qloo's tags) under it; order = buy something before asking for anyone.
export function atDoor(m) {
  const t = m.talk ?? {};
  const who = pick(t, "who") ?? (t.beforeKinds ? null : t.before?.[0] ?? null);
  const bring = pick(t, "bring");
  const last = (t.beforeKinds ?? []).map((k, i) => (k === "last" ? t.before[i] : null)).filter(Boolean);
  return {
    askFor: who ? cap(who.replace(/^Ask for /, "")) : null,
    timing: pick(t, "timing"),
    last,
    opener: t.opener ?? null,
    toBuyer: t.toBuyer ?? null,
    angle: angleOf(pick(t, "angle")),
    order: pick(t, "order"),
    ask: t.ask ? dot(cap(t.ask)) : null,
    bring: bring ? cap(bring.replace(/^Bring /, "")) : null,
  };
}

// Up to three lines on what the door is like: its crowd, what it's known for, small talk. → [{key, title, text}]
export function aboutLines(m) {
  const out = [];
  const crowd = (m.why ?? []).find((l) => /crowd/i.test(l.label ?? ""));
  const room = (m.why ?? []).find((l) => /room/i.test(l.label ?? ""));
  const tag = (label) => {
    const f = (m.roomTags ?? []).find((x) => x.label === label);
    return f ? cap(f.text.slice(f.label.length + 2).replace(/\.$/, "")) : null;
  };
  // WHY-VIZ-SPEC §6: with the city's doors to measure against (m.rarity, lib/stopmodel.js), the Crowd line gives way to
  // rarity chips: the groups Qloo names here that are rare in the city, each with the city's share. With none rare,
  // nothing ordinary gets said: the room line takes the slot. text keeps the chips as words for the drive card.
  if (m.rarity) { if (m.rarity.chips.length) out.push({ key: "crowd", title: "Crowd", chips: m.rarity.chips.map((c) => ({ label: c.label, share: c.text })), text: m.rarity.chips.map((c) => `${c.label} (${c.text})`).join(" · ") }); else if (room) out.push({ key: "room", title: "The room", text: dot(room.text) }); }
  else if (crowd) out.push({ key: "crowd", title: "Crowd", text: dot(crowd.text) });
  else if (room) out.push({ key: "room", title: "The room", text: dot(room.text) });
  const known = tag("Known for") ?? tag("Drinks");
  if (known) out.push({ key: "known", title: tag("Known for") ? "Known for" : "Drinks", text: dot(known) });
  if (m.talk?.hook?.text) out.push({ key: "smalltalk", title: "Small talk", text: m.talk.hook.text });
  return out.slice(0, 3);
}

// The talking points' row on the card, its counts named (ease audit #9: "3 · 4 · 3" read as nothing):
// "3 questions · 4 points · 3 pushbacks"; a part with none is left out.
export function talkCounts(t) {
  const n = (k, one, many) => (k ? `${k} ${k === 1 ? one : many}` : "");
  return [n(t?.questions?.length ?? 0, "question", "questions"), n(t?.points?.length ?? 0, "point", "points"), n(t?.pushback?.length ?? 0, "pushback", "pushbacks")].filter(Boolean).join(" · ");
}

// The status line under the name: open or closed at arrival, today's hours, the arrival. → [{text, tone}]
export function statusLine(m) {
  if (!m.stop) return m.hoursToday ? [{ text: m.hoursToday }] : [];
  // visited: when, not an arrival (the re-plan gives a logged door its visit time as its eta; mobile2 10-23 P3)
  if (m.status === "visited" && !m.returnVisit) {
    const at = Date.parse(m.outcome?.at ?? "");
    const hrs = m.hoursToday && m.hoursToday !== "hours unverified" ? m.hoursToday : null;
    return [hrs ? { text: `Hours ${hrs}` } : null, Number.isFinite(at) ? { text: `Visited ${clock12(new Date(at).getHours() * 60 + new Date(at).getMinutes())}`, tone: "ok" } : { text: "Visited", tone: "ok" }].filter(Boolean);
  }
  const closed = m.stop.openAtArrival === false;
  const hrs = m.hoursToday && m.hoursToday !== "hours unverified" ? m.hoursToday : null;
  return [
    closed ? { text: "Closed when you arrive", tone: "warn" } : hrs ? { text: `Open ${hrs}`, tone: "ok" } : { text: "Hours unverified" },
    m.arriveText ? { text: m.arriveText.replace(/^Arrive /, "Arrive ") } : null,
  ].filter(Boolean);
}

// First visit or a return visit. → "First visit" | "Return visit" | "Return visit · moved from …"
export function visitLine(m) {
  if (m.status === "visited" && !m.returnVisit) return null;
  if (m.returnVisit || m.talk?.visit === "return") return m.returnLabel ? cap(m.returnLabel.replace(/^follow-up visit/, "Return visit")) : "Return visit";
  return "First visit";
}

// The day so far: the day's stops plus the doors logged on its date (a logged door can leave the day's list), in order:
// "ok" interested, "fu" follow-up, "done" any other outcome, "" not yet. → { dots[], visited, total } | null
export function dayTally(plan, dayIndex) {
  const d = Number.isInteger(dayIndex) && dayIndex >= 0 ? plan?.days?.[dayIndex] : null;
  if (!d) return null;
  const ids = d.stops.map((s) => s.id);
  for (const [id, o] of Object.entries(plan.outcomes ?? {})) if (!ids.includes(id) && plan.statuses?.[id] === "visited" && String(o?.at ?? "").slice(0, 10) === d.date) ids.unshift(id);
  const dots = ids.map((id) => {
    if (plan.statuses?.[id] !== "visited") return "";
    const o = plan.outcomes?.[id] ?? {};
    return o.result === "interested" ? "ok" : o.result === "followup" || o.followUp ? "fu" : "done";
  });
  return { dots, visited: dots.filter(Boolean).length, total: dots.length, interested: dots.filter((x) => x === "ok").length, followups: dots.filter((x) => x === "fu").length };
}

// The day's progress in words (Jard 10-24 #4: coloured dots made him stop and decode them; one bar colour now means
// visited, and these words carry the rest). → { head: "3 of 9 doors visited today", sub: "1 interested · 6 to go" | "" }
export function tallyWords(t) {
  const left = t.total - t.visited;
  const sub = [t.interested ? `${t.interested} interested` : "", t.followups ? `${t.followups} to follow up` : "", left ? `${left} to go` : ""].filter(Boolean).join(" · ");
  return { head: `${t.visited} of ${t.total} doors visited today`, sub };
}

// After a visit: the outcome in words and what comes next. → { title, lines[] } | null
export function afterVisit(m) {
  if (m.status !== "visited" || m.returnVisit) return null;
  const tags = outcomeTags(m.outcome).map((x) => x.text);
  const o = m.outcome ?? {};
  const lines = [];
  if (o.who) lines.push(`Talked to ${o.who}.`);
  if (o.note) lines.push(`“${o.note}”`);
  return { title: tags.length ? tags.join(" · ") : "Visited", lines };
}

// The next stop on the same day, for the after-visit button. → {id, name, arrive} | null
export function nextStop(m, plan) {
  if (!Number.isInteger(m.dayIndex)) return null;
  const id = m.seq?.[m.pos + 1];
  const day = plan?.days?.[m.dayIndex];
  const s = day?.stops.find((x) => x.id === id);
  return s ? { id, name: plan.venues?.[id]?.name ?? "Next door", arrive: s.eta ?? null } : null;
}
