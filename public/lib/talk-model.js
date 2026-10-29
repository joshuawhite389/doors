// Model-drafted opener lines (SPEC-V2 §7, line 2): stored offline by scripts/talk.mjs under the `talk` key of
// public/data/cities/<city>.json, drafted ONLY from Qloo's profile of the room (its crowd text). Each stored venue has
//   lead: the opener's first sentence, something a rep says at the bar: "Looks like your regulars are …" (two groups at
//         most, no source claimed). The question stays the template's, since it depends on the brand (NA or not).
// R1 (Calacanis 2, the opener ruling) dropped the model "point" lines: reworded profile text is not a point to make.
// Every lead passes the guard (length, banned words, its source field present on the record) when it is stored AND
// again when it is shown (a stale file can't sneak a line past it); a lead that fails is not used and the template
// stands. Pure: no DOM, no fetch. Covered by test/stop.test.mjs.
import { BANNED_PITCH } from "./core.js";
import { mentions, genericCrowd } from "./talk.js";

// The venue fields a model line may come from, and whether the record has them.
export const TALK_FIELDS = {
  customer_demographics_description: (v) => Boolean(v?.crowd),
  ambience_description: (v) => Boolean(v?.ambience),
  good_for: (v) => Boolean(v?.goodFor?.length),
  specialty_dishes: (v) => Boolean(v?.dishes?.length),
  live_music: (v) => v?.liveMusic != null && v.liveMusic !== false,
};
export const MAX_LINE = 120;
export const MAX_WORDS = 18;
const fieldsText = (v) => [v?.crowd, v?.ambience, ...(v?.goodFor ?? []), ...(v?.dishes ?? []), v?.description].filter(Boolean).join(" ");

// Quantifiers a lead may only use when Qloo's crowd text says so itself (R2 M3: "mostly" on rooms Qloo calls diverse).
export const QUANTIFIER = /\b(mostly|mainly|largely|primarily|predominantly|majority|most|a lot of|lots of|many|plenty of)\b/i;
const SOURCE_QUANT = /\b(mostly|mainly|largely|primarily|predominantly|majority|most|many)\b/i;
export const sourceQuantifies = (venue) => SOURCE_QUANT.test(String(venue?.crowd ?? ""));
// Deterministic fix for a stored lead: drop a quantifier the source lacks ("your regulars are mostly X" → "your
// regulars are X"; "you get a lot of X in here" → "you get X in here"). The guard still checks the result.
export function normalizeLead(text, venue) {
  let s = String(text ?? "").trim().replace(/\s+/g, " ");
  if (sourceQuantifies(venue)) return s;
  return s.replace(/\b(mostly|mainly|largely|primarily|predominantly)\s+/gi, "").replace(/\b(a lot of|lots of|plenty of|many|most of|most)\s+/gi, "").replace(/\s+/g, " ");
}

// → {ok: true} or {ok: false, reason}. opts: {venue, source, avoid: [names never to print]}
export function guardTalkLine(text, { venue, source, avoid = [] } = {}) {
  const s = String(text ?? "").trim().replace(/\s+/g, " ");
  if (s.length < 20) return { ok: false, reason: "too short" };
  if (s.length > MAX_LINE || s.split(" ").length > MAX_WORDS) return { ok: false, reason: "too long" };
  if (BANNED_PITCH.test(s)) return { ok: false, reason: "banned word" };
  if (/[!?]/.test(s)) return { ok: false, reason: "not a plain statement" };
  if (!/^Looks like\b/.test(s)) return { ok: false, reason: "not spoken (starts 'Looks like')" };
  if (/\b(listing|Qloo|profile|description|data)\b/i.test(s)) return { ok: false, reason: "claims a source" };
  if ((s.match(/,/g) ?? []).length > 1) return { ok: false, reason: "a list, not a sentence" };
  const fields = String(source ?? "").split(/,\s*/).filter(Boolean);
  if (!fields.length) return { ok: false, reason: "no source field" };
  if (fields.some((f) => !TALK_FIELDS[f])) return { ok: false, reason: "unknown source field" };
  if (fields.some((f) => !TALK_FIELDS[f](venue))) return { ok: false, reason: "source field not on the record" };
  if (!fields.includes("customer_demographics_description")) return { ok: false, reason: "the opener comes from the crowd field" };
  // numbers only when the room's own text has them (no invented figures)
  const own = fieldsText(venue);
  for (const n of s.match(/\d+/g) ?? []) if (!own.includes(n)) return { ok: false, reason: "a number not in the profile" };
  if (/\b(we|our|us)\b/i.test(s)) return { ok: false, reason: "speaks for the brand" };
  if (mentions(s, avoid)) return { ok: false, reason: "names an artist or brand" };
  if (genericCrowd(s)) return { ok: false, reason: "generic: could be any room" };
  if (QUANTIFIER.test(s) && !sourceQuantifies(venue)) return { ok: false, reason: "a quantifier the profile doesn't use" };
  return { ok: true };
}

// The template's question, made to follow a lead sentence: "When one of your regulars …" → "When one of them …".
export function openerQuestion(opener) {
  const q = String(opener ?? "").split(/(?<=[.?])\s+/).filter((x) => x.endsWith("?")).at(-1) ?? "What do they order?";
  return q.replace(/^When one of your regulars\b/, "When one of them").replace(/^What do your regulars order\b/, "What do they order");
}

// Judge pass 2 (6): "make my opener shorter" keeps the room's crowd line (Qloo's, model-worded) and compresses both
// halves: "Looks like you get a lot of X in here." → "Lots of X here."; the question loses its example and filler.
// → {text, kept} (kept: the crowd line survived). No crowd line: the question alone, as before.
export function shortOpener(opener) {
  // Jard 10-24 #5: the opener is an intro + who buys ("Hi, I'm Maya with Tidewell, a non-alcoholic hazy IPA. Who does
  // the beer buying here? Mind if I grab their name …?"): shorter keeps who is talking and who buys
  const intro = /^((?:Hi|Hey), I'm (?:[^,.]+ )?with [^,.]+?)(?:, [^.]+)?\. ((?:Who|Is) [^?]+\?)/.exec(String(opener ?? "").trim());
  if (intro) return { text: `${intro[1]}. ${intro[2]}`, kept: false };
  const parts = String(opener ?? "").trim().split(/(?<=[.?!])\s+/).filter(Boolean);
  const qAt = parts.map((x) => x.endsWith("?")).lastIndexOf(true);
  let q = qAt >= 0 ? parts[qAt] : "What do they order?";
  const lead = parts.slice(0, Math.max(qAt, 0)).join(" ");
  q = q.replace(/,\s*(like|such as)\b[^?]*\?$/, "?").replace(/\bwith their drinks here\b/, "with drinks").replace(/^Do people order\b/, "Do they order")
    .replace(/^(?:What do people drink with the .+ here|When someone orders the .+, what do they drink with it)\?$/, "Do they order food with drinks?")
    .replace(/^When one of (your regulars|them) isn't drinking, what do they order\?$/, "When they're not drinking, what do they order?")
    .replace(/^When one of (your regulars|them) isn't drinking, do they get something off the cocktail list, or a soda\?$/, "Do non-drinkers here order off the cocktail list, or a soda?")
    .replace(/^What do your regulars order\b/, "What do they order");
  const m = /^Looks like (?:you get (?:a lot of )?(.+?) in here|your regulars are (.+?))\.?$/i.exec(lead);
  if (!m) return { text: q.replace(/^What do they order\b/, lead ? "What do they order" : "What do your regulars order").replace(/^When they're not\b/, lead ? "When they're not" : "When your regulars aren't"), kept: false };
  return { text: `Lots of ${m[1] ?? m[2]} here. ${q}`, kept: true };
}

// Template talking points (talk.js) + the stored model lead for this venue → the lines to show, labelled.
// stored: talk.venues[id] = {lead?: {text, source}, model}. Adds `lines: {opener}` ("model" | "template"), `model`
// (the model id when the lead is model-drafted) and sets `by` to "model" or "template".
export function withModelTalk(t, stored, { venue, avoid = [] } = {}) {
  // Jard 10-24 #5 (OPENERS-PLAN.md): the opener never describes the room's crowd, so the stored "Looks like …" leads are
  // no longer shown. They stay in the city files (and guardTalkLine stays) for scripts/talk.mjs; nothing here reads them.
  return { ...t, points: [...t.points], lines: { opener: "template" }, model: null };
}

export function talkLabel(t) {
  if (t.by !== "model") return "Template from your profile and Qloo's profile of this door.";
  // group 3 item 3 / round 3: the set written for this door from Qloo's facts (lib/talk-gen.js). No model is named on
  // the door (intuit audit #1; Jard 10-25): the privacy page says which model writes these lines
  if (t.talkKey !== undefined) return "The angle, the line for the buyer, the questions, the points and the pushback were built for this door from Qloo's facts about it, your product and your ask, and checked against those facts.";
  return "The opener's first sentence is model-drafted from Qloo's profile of this door; the rest is a template.";
}
