// Door notes (Jard's iPhone test, 2026-10-23: "a notes section for the user that the agent can log things to, not
// restrictive, and the notes show up for each door"). A note is a slot record {slot: "S4", field: "note", value: the
// text, by, at, id, edited?}: kept in the same local store as the plan's other slots (store.setSlots; the phone's
// AsyncStorage through the same store), never on the Worker. The rep writes notes on the stop; Ask Doors writes them
// with its save_note tool (agent-tools.js), always in the rep's own words, and says so. Notes never expire and never
// feed the talking points: they are the rep's notebook, read back to the rep and to the agent.
// Pure: no DOM, no fetch, no storage. Covered by test/door-notes.test.mjs.
import { makeRecord } from "./slots.js";

export const NOTE_MAX = 300; // characters a note keeps
export const NOTES_TO_AGENT = 6; // a door's newest notes the agent reads
const clean = (s) => String(s ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
const clip = (s, n = NOTE_MAX) => (s.length <= n ? s : `${s.slice(0, n).replace(/\s+\S*$/, "")}…`);
let seq = 0;
const newId = (at) => `n${Date.parse(at).toString(36)}${(++seq).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

// A note record. by: "rep" (typed on the stop), "agent:<model>" or "rules" (Ask Doors), "drive" (drive mode's Done).
// words: the rep's message it came from (Ask Doors' notes), shown nowhere but kept as the record's trace.
export function makeNote({ text, by = "rep", words = null, at = null, id = null } = {}) {
  const value = clip(clean(text));
  if (!value) return null;
  const r = makeRecord({ slot: "S4", field: "note", value, source: "stated", by, words: words ? clip(clean(words), 400) : null, at, confirmed: by === "rep" || by === "drive" });
  return { ...r, expires: null, id: id ?? newId(r.at) };
}

export const isNote = (r) => r?.field === "note" && typeof r.value === "string" && r.value.trim() !== "";
// Who wrote it, in the stop's words.
export function whoWrote(r) {
  const by = String(r?.by ?? "");
  const base = by === "rep" ? "You" : by === "drive" ? "You, on the road" : /^(agent|rules)/.test(by) ? "Doors Agent" : "You";
  return r?.edited && base !== "You" ? `${base} · edited by you` : r?.edited ? "You · edited" : base;
}
// A door's notes, newest first: [{id, text, by, who, at, edited}]
export function notesOf(slots, id) {
  return (slots?.[id] ?? []).filter(isNote).map((r) => ({ id: r.id ?? `${r.at}|${r.value}`, text: r.value, by: r.by, who: whoWrote(r), at: r.editedAt ?? r.at, edited: Boolean(r.edited) })).sort((a, b) => String(b.at).localeCompare(String(a.at)));
}
// What the agent reads of a door's notes: the newest few, text and who wrote them.
export const notesForAgent = (slots, id) => notesOf(slots, id).slice(0, NOTES_TO_AGENT).map((n) => ({ text: n.text, by: /^(Ask Doors|Doors Agent)/.test(n.who) ? "ask-doors" : "rep" }));

// An edit or a delete, on a door's records (the store's setSlots takes the result). op: {note: id, text} edits (an
// empty text deletes); {note: id, drop: true} deletes. at: when. Records that aren't that note are left as they are.
export function noteOp(records = [], op = {}, at = new Date().toISOString()) {
  const hit = (r) => isNote(r) && (r.id ?? `${r.at}|${r.value}`) === op.note;
  if (op.drop) return records.filter((r) => !hit(r));
  const text = clip(clean(op.text));
  if (!text) return records.filter((r) => !hit(r));
  return records.map((r) => (hit(r) && r.value !== text ? { ...r, value: text, edited: true, editedAt: at, confirmed: true } : r));
}
// Is this text already one of the door's notes (the same words, case and punctuation aside)?
const key = (s) => clean(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export const hasNote = (notes = [], text) => notes.some((n) => key(n?.text ?? n?.value ?? n) === key(text));

// ---------- what's worth a note (the rules path, and the net under the model's own call) ----------
// explicit: the rep asks for a note ("note that…", "remember…", "jot down…"): the words after it are the note.
const EXPLICIT = /^\s*(?:(?:hey|ok(?:ay)?|so|and|also|oh)[,\s]+)?(?:please\s+|can you\s+|could you\s+)?(?:(?:make|add|take|leave|save|put)\s+(?:a\s+)?note(?:\s+(?:for|on)\s+(?:this|that|the)\s+(?:one|door|stop|place|bar|room))?|note(?:\s+down)?|jot(?:\s+down)?|write(?:\s+down)?|remember|don'?t forget|keep in mind)\b\s*(?:that\b|this\b)?\s*[:,—–-]?\s*/i;
// facts that matter on a later visit: who to ask for, when they're in, what they asked for, how to reach them, the room
const FACTS = [
  /\b(?:the\s+)?(?:owner|manager|bar manager|beverage director|buyer|gm|general manager|taproom manager|bartender|head bartender)(?:'s|’s| is| was)\s+(?:named\s+|called\s+)?[A-Z][a-z]+/,
  /\b(?:ask for|talk to|speak (?:to|with)|deal with|go through)\s+(?:the\s+)?(?:[A-Z][a-z]+|owner|manager|buyer|bar manager|beverage director|gm)\b/,
  /\b(?:she|he|they|owner|manager|buyer|gm)(?:'s|’s| is| are| works?| comes? in)?\s+(?:only\s+)?(?:in|back|there|around|off)\s+(?:on\s+)?(?:mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?|sundays?|weekends?|weekdays?|mornings?|afternoons?|evenings?|nights?|mon|tues?|wed|thu(?:rs)?|fri|sat|sun)\b/i,
  /\b(?:want|wants|wanted|asked for|asking for|needs?|would like|requested)\s+(?:some\s+|a\s+|the\s+|to see\s+|to try\s+)?(?:samples?|tasting|price list|pricing|sell ?sheet|spec sheet|case|cans?|menu|deck|info|invoice|distributor|our distributor)\b/i,
  /\b(?:best time|come (?:in|by|back) (?:before|after|around)|busy (?:after|before|on)|slow (?:on|after|before)|don'?t come (?:on|after|before|during))\b/i,
  /\b(?:prefers?|rather)\s+(?:a\s+)?(?:text|email|call|calls|texts|emails|in person|drop[- ]?ins?)\b/i,
  /\b(?:closed for|renovat\w*|new menu|menu change|menu reset|changing (?:the|their) menu|reset (?:in|on|next)|new owner|under new|moving to|reopen\w*)\b/i,
  /\b(?:cooler|fridge|tap list|taps?|draft list|shelf|shelves|back bar)\s+(?:is|are|space|full|open|has|opens?)\b/i,
];
// → the note's text, or null. A question is never a note; a bare outcome ("done, liked it") is the visit log's.
export function worthNoting(words, { question = false } = {}) {
  const w = clean(words);
  if (!w || w.length < 6 || question) return null;
  const m = EXPLICIT.exec(w);
  if (m && w.length - m[0].length >= 3) return { text: tidy(w.slice(m[0].length)), explicit: true };
  if (FACTS.some((re) => re.test(w))) return { text: tidy(w), explicit: false };
  return null;
}
// the rep's words as a note: a capital first letter, a full stop, no "for this door" tail
function tidy(s) {
  const t = clean(s).replace(/\s+(?:for|on|about)\s+(?:this|that|the)\s+(?:one|door|stop|place|bar|room)\s*[.!]?$/i, "").replace(/[\s,;:—–-]+$/, "");
  const u = t.replace(/^./, (c) => c.toUpperCase());
  return clip(/[.!?…"”)]$/.test(u) ? u : `${u}.`);
}

// A logged visit's note (the outcome sheet's, drive mode's Done) as a door note, unless the door already has it.
export function visitNote(outcome, { notes = [], by = "rep", at = null } = {}) {
  const t = String(outcome?.note ?? "").trim();
  if (!t || hasNote(notes, t)) return null;
  return makeNote({ text: t, by, at: at ?? outcome?.at ?? null });
}
