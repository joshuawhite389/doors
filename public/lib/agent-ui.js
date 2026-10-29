// Doors Agent's panel, the parts web and phone share (spec §5–6, step 5): the greeting, the screen's mode (it sets the
// answer's length on the Worker), each fact's source tag, and the change chips with their own Undo. Pure: no DOM.
import { firstName } from "./note.js";

// "Hi Jard, how can I help?": the name the notes are signed with (the profile, on the device); none → "Hi, how…"
export function greeting(profile) {
  const n = firstName(profile?.pitch?.name ?? "");
  return `Hi${n ? ` ${n}` : ""}, how can I help?`;
}

// Ease audit 10-23 #12: the empty panel offers three asks to start from (it opened on a greeting alone). A tap sends
// the first two; "Log a visit at …" goes into the box for the rep to finish. Ease audit 2 #2: the door named is the one
// the rep is at (here: the open door card, or drive mode's stop), else the first stop with nothing logged on the
// selected day (dayIndex), else on the first day still ahead. "Why is X first?" only while X is the day's first stop and
// nothing is logged there; another door asks "Why X?". → [{text, send}]
export function starters(plan, { here = null, dayIndex = null } = {}) {
  const days = plan?.days ?? [];
  const venues = plan?.venues ?? {};
  const logged = (id) => Boolean(plan?.statuses?.[id] || plan?.outcomes?.[id]?.result);
  const ahead = (d) => d && !d.past && d.stops?.length;
  const sel = Number.isInteger(dayIndex) && ahead(days[dayIndex]) ? days[dayIndex] : null;
  const open = (d) => d?.stops.find((x) => !logged(x.id) && venues[x.id]) ?? null;
  let day = null;
  let id = here && venues[here] ? here : null;
  if (id) day = days.find((d) => ahead(d) && d.stops.some((x) => x.id === id)) ?? null;
  else {
    day = open(sel) ? sel : days.find((d) => ahead(d) && open(d)) ?? null;
    id = open(day)?.id ?? null;
  }
  const name = id ? venues[id].name ?? null : null;
  const first = name && day?.stops[0]?.id === id && !logged(id);
  return [
    name ? { text: first ? `Why is ${name} first?` : `Why ${name}?`, send: true } : { text: "Why these doors?", send: true },
    { text: "I'm running late", send: true },
    // intuit pass 2 (M9): the button reads "Log a visit at X…"; the box is filled with "Log a visit at X: " to finish
    { text: name ? `Log a visit at ${name}: ` : "Log a visit: ", label: name ? `Log a visit at ${name}…` : "Log a visit…", send: false },
  ];
}

// Ease audit 2 #10a: the Worker says when Claude is back as "after midnight UTC" (it doesn't know the rep's clock); the
// panel says it in the device's own time ("back at 8 pm"). Anything else passes through. now: a Date
export function inLocalTime(text, now = new Date()) {
  const s = String(text ?? "");
  if (!/after midnight UTC/.test(s)) return s;
  const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const h = at.getHours();
  const m = at.getMinutes();
  const t = h === 0 && m === 0 ? "midnight" : `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "am" : "pm"}`;
  return s.replace(/after midnight UTC/g, `at ${t}`);
}

// The screen the ask comes from → context.mode: drive mode and a stop answer in one or two sentences, the plan (and
// its map) in up to about three plus a short list (src/agent.js cleanContext).
export const MODES = ["drive", "stop", "plan"];
export const modeOf = ({ driving = false, stop = false } = {}) => (driving ? "drive" : stop ? "stop" : "plan");

// A fact's source as a short tag: Qloo, route (Doors' plan and route), you (what the user told Doors), link (a public
// page: it opens), Doors (the talking points). label stays as the tag's tooltip.
const TAG = { qloo: "Qloo", plan: "route", stated: "you", corrected: "you", web: "link", doors: "Doors" };
export function sourceTag(source) {
  const url = /^https?:\/\//.test(source?.url ?? "") ? source.url : null;
  return { tag: url ? "link" : TAG[source?.kind] ?? "Doors", url, title: source?.title || source?.label || "" };
}

// Judge pass 8 (#2): an answer's Sources, web and phone. A fact the answer already says (its sentence is in the reply),
// and Qloo's raw scores (affinity, popularity), show as their source's name only ("Qloo, rank for your drinker"), not
// the sentence again; other facts keep their words. Same name twice → once. → [{text, src: sourceTag(), source}]
// "(captured 2026-10-08)" → "(Oct 8)", any other "2026-10-08" → "Oct 8"
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const shortDates = (t) => String(t ?? "").replace(/\b(?:captured )?(\d{4})-(\d{2})-(\d{2})\b/g, (_, y, mo, d) => `${MON[+mo - 1] ?? mo} ${+d}`);
const SCORE_FIELDS = new Set(["affinity", "popularity"]);
const flat = (x) => String(x ?? "").replace(/\s+/g, " ").trim().toLowerCase();
export function sourceItems(m) {
  const said = flat(m?.text);
  const seen = new Set();
  const out = [];
  for (const f of m?.facts ?? []) {
    const short = SCORE_FIELDS.has(f.source?.field) || (flat(f.text).length > 0 && said.includes(flat(f.text)));
    const text = shortDates(short ? (f.source?.label || sourceTag(f.source).title || sourceTag(f.source).tag) : f.text);
    const key = `${text}|${f.source?.kind ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const src = sourceTag(f.source);
    // intuit audit (smaller): "Doors' route [route]", "Qloo, rank … [Qloo]": no tag when the words already name it
    const named = !src.url && new RegExp(`\\b${src.tag === "you" ? "your?" : src.tag}\\b`, "i").test(text);
    out.push({ text, short, src, source: f.source, named });
  }
  return out;
}

// The changes one answer made, one chip each ("Meanwhile moved to Friday · Undo"). A chip's Undo runs its group's
// undo; changes that can only come back together (statuses and outcomes return as one snapshot, a visit's said/next
// with it) share a group, so undoing one marks the others undone too: never a chip that says it's still there when it
// isn't. → {chips: [{text, g}], add(text, g), undo(g, fn), undos: Map g → fn (newest first within the group)}
export function changeSet() {
  const chips = [];
  const fns = new Map();
  return {
    chips,
    add(text, g) {
      if (text) chips.push({ text, g });
    },
    undo(g, fn) {
      fns.set(g, [fn, ...(fns.get(g) ?? [])]);
    },
    get undos() {
      return new Map([...fns].map(([g, list]) => [g, async () => { for (const f of list) await f(); }]));
    },
  };
}
// A message's chips: today's [{text, g, undone?}], or a log kept before chips (did: "a · b") as plain chips
export const chipsOf = (m) => (Array.isArray(m?.chips) ? m.chips : m?.did ? String(m.did).split(" · ").map((text) => ({ text, g: null })) : []);
// the chips' words in one line (drive mode's toast, the guided demo's checks)
export const chipsText = (chips) => chips.map((c) => c.text).join(" · ");
