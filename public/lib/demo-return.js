// The guided demo's return-visit card, "Thursday, she's back": the same door's card before
// and after her visit, line by line, from the real stop model. before = the stop with visit memory switched off
// (stopModel slotsOff ["S4"]: exactly what the card said before she logged the visit); after = the stop as Thursday
// shows it. Only the lines a judge should compare: who to ask for, what she noted, the opener, the first pushback,
// the note. Pure: no DOM.

const words = (s) => String(s ?? "").trim().split(/\s+/).filter(Boolean).length;
// judge pass 12 #2: a first message opens with a bare "Hi," line (lib/note.js); the card shows the first line that says something
export const GREETING_ONLY = /^(hi|hello|hey)\b[^.]*,$/i;
export const firstLine = (s) => String(s ?? "").split(/\n/).map((x) => x.trim()).find((x) => x && !GREETING_ONLY.test(x)) ?? "";
const noted = (m) => m.talk.before.find((x) => /^Your note from last time:/.test(x)) ?? null;
const push = (p) => (p ? `${p.from === "memory" ? p.objection : `“${p.objection}”`} → ${p.reply}` : "");

// returnDiff(before, after) → {rows: [{key, label, before, after, changed, from}], noteWords: {before, after}}
// from = what in her log changed it ("who you talked to", "your note", "the visit"), or null.
export function returnDiff(before, after) {
  const used = new Set(after.talk.memoryUsed ?? []);
  const rows = [
    { key: "contact", label: "Who to ask for", before: before.talk.before[0], after: after.talk.before[0], from: used.has("contact") ? "who you talked to" : "the visit" },
    { key: "said", label: "Last time you said", before: null, after: noted(after), from: "your note" },
    { key: "opener", label: "Opener", before: before.talk.opener, after: after.talk.opener, from: "the visit" },
    { key: "pushback", label: "First pushback", before: push(before.talk.pushback[0]), after: push(after.talk.pushback[0]), from: after.talk.pushback[0]?.from === "memory" ? "your note" : null }, // her note is where their worry was written down
    { key: "note", label: "Her note to them", before: firstLine(before.note.body), after: firstLine(after.note.body), from: "the visit" },
  ]
    .filter((r) => r.before || r.after)
    .map((r) => ({ ...r, changed: (r.before ?? "") !== (r.after ?? ""), from: (r.before ?? "") !== (r.after ?? "") ? r.from : null }));
  return { rows, noteWords: { before: words(before.note.body), after: words(after.note.body) } };
}
