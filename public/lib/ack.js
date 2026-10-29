// The Doors Agent's instant acknowledgement (Jard 10-28): the model's spoken answer takes a few seconds, so the moment
// the rep's words are in, a short canned line says the Agent got them ("Let me check on that, one second."). The line
// is picked by what the words ask for (a question, a change, a visit or note to save, anything else) and never repeats
// the one just said. Each line is pre-baked as the Aura-2 voice (public/audio/ack/<id>.mp3, scripts/bake-acks.mjs), so
// it plays at once with no network wait; the same text shows on screen as the status. Shared by the web (ui/voice.js
// ack) and the phone (app-mobile/src/voice.ts ack), so both say the same things.
export const ACKS = {
  ask: [
    { id: "ask-1", text: "Let me check on that, one second." },
    { id: "ask-2", text: "One sec, looking." },
    { id: "ask-3", text: "I'll grab that for you." },
  ],
  change: [
    { id: "change-1", text: "Sure, changing that now." },
    { id: "change-2", text: "On it." },
    { id: "change-3", text: "Okay, let me make that change." },
  ],
  log: [
    { id: "log-1", text: "Got it, saving that." },
    { id: "log-2", text: "Okay, noting that down." },
  ],
  generic: [
    { id: "generic-1", text: "Okay, give me a second." },
    { id: "generic-2", text: "Got it, one moment." },
  ],
};
export const ACK_IDS = Object.values(ACKS).flat().map((a) => a.id);
export const ackPath = (id) => `/audio/ack/${id}.mp3`;

const CHANGE = /\b(skip|drop|move|swap|replace|remove|take (it|that|this|them) (off|out)|put (it|that) back|add|change|reschedule|push|bump|running late|late by|i'?m late|cancel|undo|end (my|the) day|stop for today|go back to|switch)\b/i;
const LOG = /\b(went|visit|visited|met|talked|spoke|saw|note|notes|remember|write (that|this) down|they (took|bought|said|want|passed|ordered)|no answer|closed|not interested|they'?re in|come back|try again|follow up|took (a|one|two|three|\d+)|bought|ordered|passed)\b/i;
const ASK = /\?|^(what|who|where|when|why|how|which|tell me|is |are |do |does |did |can |could |should |will |would |any |whats|what'?s|whos|who'?s|wheres|where'?s|hows|how'?s|give me|read me|remind me)\b/i;

// what the words ask for: "ask" | "change" | "log" | "generic"
export function ackIntent(text) {
  const t = String(text ?? "").trim();
  if (!t) return "generic";
  if (CHANGE.test(t) && !ASK.test(t)) return "change";
  if (ASK.test(t)) return "ask";
  if (LOG.test(t)) return "log";
  return "generic";
}

// the line to say for these words, never the one said just before (lastId) → {id, text, intent}
export function pickAck(text, lastId = null, rnd = Math.random) {
  const intent = ackIntent(text);
  const pool = ACKS[intent].filter((a) => a.id !== lastId);
  const a = pool[Math.floor(Math.max(0, Math.min(0.999999, rnd())) * pool.length)] ?? ACKS[intent][0];
  return { ...a, intent };
}
