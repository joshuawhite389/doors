// Cultural slots (docs/CULTURAL-SLOTS.md, owner review 9): structured context with provenance that code — not a prompt
// — makes the talking points, the note and the agent use. A slot record is {slot, field, value, source, by, words, at,
// expires, confirmed}; the authority order is corrected > stated > observed > qloo > inferred > default, and a lower
// source never beats a higher one. Pure: no DOM, no fetch, no storage. Covered by test/slots.test.mjs.

export const SOURCES = ["corrected", "stated", "observed", "qloo", "inferred", "default"];
export const AUTHORITY = Object.fromEntries(SOURCES.map((s, i) => [s, i])); // lower = stronger
// The words the UI and the judge-facing copy use for each source (CULTURAL-SLOTS §3.2).
export const SOURCE_WORDS = { corrected: "your correction", stated: "what you told Doors", observed: "what you did", qloo: "Qloo's data", inferred: "a guess", default: "Doors' template" };

const DAY = 86400000;
// Days until a record stops counting (null = never). Q3: visit facts 60, contact names 180.
export const EXPIRY_DAYS = { corrected: null, stated: 60, observed: 90, qloo: 120, inferred: 14, default: null };
export const CONTACT_DAYS = 180;

// The slots the chat agent (and log-visit) may write, and the source each must carry (CULTURAL-SLOTS §3.1). Anything
// else is refused by validateRecord({agent: true}).
export const ROLES = ["owner", "manager", "bar manager", "beverage director", "gm", "general manager", "taproom manager", "bartender", "buyer", "other"];
export const OBJECTIONS = ["price", "space", "local", "own", "nosell", "already", "owner"];
export const VENUE_TYPES = ["brewery", "bar", "restaurant", "coffee"];
const str = (max) => (v) => typeof v === "string" && v.trim().length > 0 && v.trim().length <= max;
export const AGENT_WRITABLE = {
  "S4.contact": { source: "stated", ok: (v) => v && str(60)(v.name) && (v.role == null || ROLES.includes(String(v.role).toLowerCase())) },
  "S4.objection": { source: "stated", ok: (v) => v && (OBJECTIONS.includes(v.kind) || v.kind === "other") && (v.words == null || str(140)(v.words)) },
  "S4.said": { source: "stated", ok: str(140) },
  "S4.next": { source: "stated", ok: (v) => /^\d{4}-\d{2}-\d{2}( \d{2}:\d{2})?$/.test(String(v ?? "")) },
  "S4.carry": { source: "stated", ok: str(80) },
  "S4.note": { source: "stated", ok: str(300) }, // door notes (lib/door-notes.js): the rep's notebook, never expires
  "S1.venueType": { source: "corrected", ok: (v) => VENUE_TYPES.includes(v) },
  "S6.rule.avoid": { source: "corrected", ok: str(60) },
  "S6.rule.term": { source: "corrected", ok: (v) => v && str(40)(v.from) && str(40)(v.to) },
  "S6.note.email": { source: "corrected", ok: str(2000) },
  "S6.note.sms": { source: "corrected", ok: str(320) },
};
const BRAND_WIDE = new Set(["rule.avoid", "rule.term"]);

const iso = (t) => new Date(t).toISOString();
const ms = (t) => (t == null ? Date.now() : typeof t === "number" ? t : Date.parse(t));

// A record with its expiry worked out. at defaults to now.
export function makeRecord({ slot, field, value, source, by = "rep", words = null, at = null, confirmed = true }) {
  const t = ms(at);
  const days = field === "note" ? null : field === "contact" && source === "stated" ? CONTACT_DAYS : EXPIRY_DAYS[source];
  return { slot, field, value, source, by, words: words ?? null, at: iso(t), expires: days == null ? null : iso(t + days * DAY), confirmed: Boolean(confirmed) };
}

// → {ok: true} or {ok: false, reason}. agent: the writer is the chat agent (only AGENT_WRITABLE, with its source).
export function validateRecord(r, { agent = false } = {}) {
  if (!r || typeof r !== "object") return { ok: false, reason: "not a record" };
  if (!SOURCES.includes(r.source)) return { ok: false, reason: "unknown source" };
  const spec = AGENT_WRITABLE[`${r.slot}.${r.field}`];
  if (agent) {
    if (!spec) return { ok: false, reason: `the agent may not write ${r.slot}.${r.field}` };
    if (r.source !== spec.source) return { ok: false, reason: `${r.slot}.${r.field} is written as ${spec.source}` };
  }
  if (spec && !spec.ok(r.value)) return { ok: false, reason: `bad value for ${r.field}` };
  if (r.source === "inferred" && r.field === "contact") return { ok: false, reason: "nothing is inferred about a person" };
  return { ok: true };
}

export const isLive = (r, now = Date.now()) => Boolean(r) && (r.expires == null || Date.parse(r.expires) > ms(now));
const better = (a, b) => AUTHORITY[a.source] - AUTHORITY[b.source] || Date.parse(b.at) - Date.parse(a.at);

// The winning live record for a field: door scope first, then brand-wide ("*"); strongest source, newest within it.
// slots = {doorId | "*": [records]}.
export function resolve(slots, doorId, field, now = Date.now()) {
  for (const scope of [doorId, "*"]) {
    const rs = (slots?.[scope] ?? []).filter((r) => r?.field === field && isLive(r, now)).sort(better);
    if (rs.length) return rs[0];
  }
  return null;
}
// Every live record for a field (rules can be many): door scope and brand-wide, strongest first.
export const resolveAll = (slots, doorId, field, now = Date.now()) =>
  [doorId, "*"].flatMap((s) => (slots?.[s] ?? []).filter((r) => r?.field === field && isLive(r, now))).sort(better);

// Add a record to a slots map (a new object): brand-wide fields go to "*". Returns the new map.
export function addRecord(slots = {}, doorId, record) {
  const scope = BRAND_WIDE.has(record.field) ? "*" : doorId;
  return { ...slots, [scope]: [...(slots[scope] ?? []), record] };
}
// Drop a door's records for a field (e.g. "Reset to draft"). Returns the new map.
export function clearField(slots = {}, doorId, field) {
  return { ...slots, [doorId]: (slots[doorId] ?? []).filter((r) => r.field !== field) };
}

// R9 red team: Undo of one added record drops that record only (the newest with the same field and value), not every
// record of the field: undoing the agent's "contact: Jo" must not also erase the rep's "contact: Sam".
export function dropRecord(list = [], field, value) {
  const k = JSON.stringify(value);
  const i = list.findLastIndex((r) => r?.field === field && JSON.stringify(r.value) === k);
  return i < 0 ? list : [...list.slice(0, i), ...list.slice(i + 1)];
}

// "A trace line": "What you told Doors, Tue Oct 21 (“hesitant about price”)".
export function trace(r) {
  if (!r) return "";
  const d = new Date(r.at); // persona (founder): the rep's own calendar day, not UTC's (Thu 10 pm read "Fri")
  const when = Number.isFinite(d.getTime()) ? `${"Sun Mon Tue Wed Thu Fri Sat".split(" ")[d.getDay()]} ${"Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ")[d.getMonth()]} ${d.getDate()}` : "";
  const w = SOURCE_WORDS[r.source] ?? r.source;
  return `${w[0].toUpperCase()}${w.slice(1)}${when ? `, ${when}` : ""}${r.words ? ` (“${r.words}”)` : ""}${r.confirmed === false ? ", not yet confirmed" : ""}`;
}

// ---------- visit memory (S4) ----------
// What the rep's note says, matched to an objection kind. Deterministic; the rep's words are kept as written.
const OBJ = [
  ["price", /\b(price|pric(ey|y)|expensive|cost|margins?|too much|\$)/i],
  ["space", /\b(no room|space|shelf|cooler('s| is)? full|full cooler|no line|too many)\b/i], // "too many sodas already" (judge pass 3)
  ["local", /\blocal\b/i],
  ["own", /\b(own beer|their own|only (serve|pour|carry) (their|our) own)\b/i],
  ["already", /\balready (have|carry|got|stock)/i],
  ["owner", /\b(owner|check with|ask (the|their) (boss|owner|gm)|not the (buyer|one who decides)|needs? to ask)\b/i],
  ["nosell", /\b(doesn'?t sell|won'?t sell|don'?t sell|no demand|nobody (asks|orders)|wouldn'?t move)\b/i],
];
export function objectionOf(text) {
  const t = String(text ?? "");
  for (const [kind, re] of OBJ) if (re.test(t)) return kind;
  return null;
}
// "Sam (bar manager)", "Sam, bar manager", "Sam the owner" → {name, role?}
export function contactOf(who) {
  const s = String(who ?? "").trim().replace(/\s+/g, " ");
  if (!s) return null;
  const m = /^(.+?)(?:\s*[,(]\s*(?:the\s+)?|\s+(?:the|our|their)\s+)([a-z ]+?)\)?$/i.exec(s);
  const role = m && ROLES.includes(m[2].toLowerCase()) ? m[2].toLowerCase() : null;
  const name = (role ? m[1] : s).slice(0, 60).trim();
  return name ? { name, ...(role ? { role } : {}) } : null;
}

// An outcome (outcome.makeOutcome) → the S4 records it states. at = when it was logged.
export function fromOutcome(o, { at = null, by = "rep" } = {}) {
  if (!o?.result) return [];
  const when = at ?? o.at ?? null;
  const out = [];
  const rec = (field, value, words) => out.push(makeRecord({ slot: "S4", field, value, source: "stated", by, words, at: when }));
  const c = contactOf(o.who);
  if (c) rec("contact", c, o.who);
  const note = String(o.note ?? "").trim();
  if (note) {
    const kind = objectionOf(note);
    if (kind) rec("objection", { kind, words: note.slice(0, 140) }, note.slice(0, 140));
    rec("said", note.slice(0, 140), note.slice(0, 140));
  }
  if (o.followUp) rec("next", o.followUp, null);
  return out;
}

// Is this showing of a door a return visit? A door with an outcome, seen on a later day than the one it was logged on
// (or on its follow-up pin), or off the plan entirely.
export function visitOf({ outcome, day = null, returnVisit = false } = {}) {
  if (!outcome?.result) return "first";
  if (returnVisit) return "return";
  const logged = String(outcome.at ?? "").slice(0, 10);
  if (!day?.date) return "return";
  return logged && day.date > logged ? "return" : "first";
}

// The memory a stop's talking points and note read. slots = the saved records; outcome = the door's outcome (its
// records count even when nothing was written to slots yet, as "stated" at outcome.at).
// → null (first visit, nothing to use) or {visit, lastVisit, result, contact, objection, said, carry, used:[records]}.
export function memoryFor({ slots = {}, id, outcome = null, day = null, returnVisit = false, now = Date.now() } = {}) {
  const visit = visitOf({ outcome, day, returnVisit });
  if (visit !== "return") return null;
  const merged = { ...slots, [id]: [...fromOutcome(outcome), ...(slots[id] ?? [])] };
  const get = (f) => resolve(merged, id, f, now);
  const contact = get("contact");
  const objection = get("objection");
  const said = get("said");
  const carry = get("carry");
  const used = [contact, objection, said, carry].filter(Boolean);
  return {
    visit,
    lastVisit: String(outcome?.at ?? "").slice(0, 10) || null,
    result: outcome?.result ?? null,
    followUp: outcome?.followUp ?? null, // judge pass 2 (8): the return note says the day and time she agreed
    followUpTime: outcome?.followUpTime ?? null,
    contact: contact?.value ?? null,
    objection: objection?.value ?? null,
    said: said?.value ?? null,
    carry: carry?.value ?? null,
    used,
  };
}

// ---------- corrections (S6) ----------
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordRe = (s) => new RegExp(`(^|[^\\p{L}\\p{N}])${esc(s)}(?=$|[^\\p{L}\\p{N}])`, "giu");
// The word a rule is about, for spotting two rules on the same word ("Kombuchas" and "kombucha" are one word)
const ruleWord = (s) => String(s ?? "").trim().toLowerCase().replace(/(?<=[a-z]{3})e?s$/, "");
// "Never say cocktail" also keeps out "cocktails" (judge R9: the plural slipped through into the opener). The 70b
// re-run 10-23 (F4): and the word's other forms: "never say craft" let "well-crafted" through. The phrase's last word
// matches as itself plural, -ed or -ing (craft → crafts, crafted, crafting; hop → hopped; brew → brewing), and joined
// into a compound ("well-crafted", "hand-crafted", "handcrafted"). Not a different word that starts with it: "regulars"
// leaves "regularly" alone, "craft" leaves "crafty"
function formSrc(phrase) {
  const words = String(phrase).trim().split(/\s+/);
  const base = ruleWord(words.pop());
  let stem;
  if (base.length < 3) stem = `${esc(base)}(?:e?s)?`;
  else if (/[^aeiou]y$/.test(base)) stem = `${esc(base.slice(0, -1))}(?:y|ies|ied|ying)`;
  else if (/[^aeiou]e$/.test(base)) stem = `${esc(base.slice(0, -1))}(?:e|es|ed|ing)`;
  else stem = `${esc(base)}(?:e?s|${/[^aeiou]$/.test(base) ? `(?:${esc(base.at(-1))})?` : ""}(?:ed|ing))?`;
  return [...words.map(esc), `${words.length ? "" : "(?:hand|home|micro)?"}${stem}`].join("\\s+");
}
const avoidRe = (s) => new RegExp(`(^|[^\\p{L}\\p{N}])${formSrc(s)}(?=$|[^\\p{L}\\p{N}])`, "iu");
const ruleKey = (r) => ruleWord(r.field === "rule.term" ? r.value?.from : r.value);
// Judge pass 4 (#1): two rules on the same word ("never say kombucha", later "say sparkling tea, not kombucha")
// contradict each other: the newest wins, the older is kept on record but no longer counts.
function liveRules(slots, doorId, now) {
  // in the order saved (door scope, then brand-wide): two rules saved in the same minute carry the same time, and then
  // the later-saved one wins (found in the app: the chat stamps rules to the minute)
  const all = [doorId, "*"].flatMap((sc) => (slots?.[sc] ?? []).filter((r) => (r?.field === "rule.avoid" || r?.field === "rule.term") && isLive(r, now)));
  const newest = new Map();
  for (const r of all) {
    const k = ruleKey(r);
    if (k && (!newest.has(k) || Date.parse(r.at) >= Date.parse(newest.get(k).at))) newest.set(k, r);
  }
  return { all, kept: all.filter((r) => !ruleKey(r) || newest.get(ruleKey(r)) === r) };
}
// The rules a newer rule on the same word replaced (Your rules shows them as replaced).
export const supersededRules = (slots, doorId, now = Date.now()) => {
  const { all, kept } = liveRules(slots, doorId, now);
  return all.filter((r) => !kept.includes(r));
};
// rules = {avoid: [phrase], terms: [{from, to}]} (from resolveAll of rule.avoid / rule.term, newest per word)
export function rulesFrom(slots, doorId, now = Date.now()) {
  const { kept } = liveRules(slots, doorId, now);
  return {
    avoid: kept.filter((r) => r.field === "rule.avoid").map((r) => r.value),
    terms: kept.filter((r) => r.field === "rule.term").map((r) => r.value),
  };
}
export const hasRules = (rules) => Boolean(rules?.avoid?.length || rules?.terms?.length);
// The rule a new one replaces, if any (the agent says so: "That replaces your earlier rule …").
export function ruleReplaced(slots, record, now = Date.now()) {
  const k = ruleKey(record);
  // the new rule isn't saved yet, so every saved rule on its word is older (a minute-precision "now" can read earlier
  // than a rule saved seconds ago: no date test)
  return k ? resolveAll(slots, "*", "rule.avoid", now).concat(resolveAll(slots, "*", "rule.term", now)).filter((r) => r !== record && ruleKey(r) === k).sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0] ?? null : null;
}
export const ruleText = (r) => (r?.field === "rule.term" ? `say “${r.value?.to}”, not “${r.value?.from}”` : r ? `never say “${r.value}”` : "");
// A rule word inside a name the rules leave alone (the brand: "Kinfolk Kombucha"), or null.
export function ruleInName(word, names = []) {
  const re = avoidRe(String(word ?? "").trim());
  return names.find((n) => n && re.test(n)) ?? null;
}
// What the chat says when it keeps a rule (judge pass 4 #1): the earlier rule it replaces, and a rule word inside the
// brand's own name ("“kombucha” is in your brand name, Kinfolk Kombucha: I'll leave the name alone"). → [sentence]
export function ruleNotes(slots, record, brand = "", now = Date.now()) {
  const out = [];
  const old = ruleReplaced(slots, record, now);
  if (old && ruleText(old) !== ruleText(record)) out.push(`That replaces your earlier rule (${ruleText(old)}): the newest rule wins.`);
  const word = record?.field === "rule.term" ? record.value?.from : record?.value;
  if (ruleInName(word, [brand])) out.push(`“${String(word).trim()}” is in your brand name, ${String(brand).trim()}: I'll leave the name alone.`);
  return out;
}
const plural = (w) => (/(s|x|z|ch|sh)$/i.test(w) ? `${w}es` : /[^aeiou]y$/i.test(w) ? `${w.slice(0, -1)}ies` : `${w}s`);
const sentenceStart = (before) => /(^|[.!?])$/.test(before.replace(/[\s“"‘'(]+$/u, ""));
// One line through the rules: null when it says an avoided phrase, else with the terms replaced (whole words, plurals
// too). keep = names the rules never touch (the brand, the venue, the rep): judge pass 4 (#1) "Kinfolk sparkling tea".
// ---- fix9 (live-model re-run F4): a never-say word reworded, not its sentence dropped ----
// The chat and the model's prompt can't lose every sentence when the never-say word is the brand's own product
// ("cider" in "Dry hard cider"). A drink noun (or the product line's own last word) becomes "drink"; a word in front
// of another ("craft cider", "hard seltzer") is left out. Any other word still drops the line (null).
const DRINK_NOUN = /^(?:cider|beer|ale|lager|ipa|stout|porter|pilsner|kombucha|seltzer|wine|spirit|vodka|gin|whiske?y|bourbon|tequila|mezcal|rum|soda|mocktail|cocktail|tea|mead|sake|brew|rtd|drink|beverage|bevvy)$/i;
const MODIFIER = /^(?:craft|hard|artisanal|artisan|premium|local|natural|organic|sparkling|dry|sweet|non-alcoholic|alcohol-free|na|zero-proof|handcrafted|small-batch|boozy|spiked|light|session)$/i;
const anFor = (art, next) => `${art[0]}${/^[aeiou]/i.test(next) && !/^(one|uni|use|eu)/i.test(next) ? "n" : ""}`;
function softKind(a, what) {
  const w = String(a).trim().toLowerCase().split(/\s+/);
  const prod = String(what ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  const last = ruleWord(w.at(-1));
  if (DRINK_NOUN.test(last) || (prod.length && last === ruleWord(prod.at(-1)))) return "noun";
  if (w.length === 1 && (MODIFIER.test(w[0]) || prod.slice(0, -1).includes(w[0]))) return "mod";
  return null;
}
function soften(s, avoid, what) {
  for (const a of [...avoid].filter(Boolean).sort((x, y) => softKind(x, what) === "mod" ? -1 : softKind(y, what) === "mod" ? 1 : 0)) {
    if (!avoidRe(a).test(s)) continue;
    const kind = softKind(a, what);
    if (!kind) return null;
    if (kind === "mod") {
      // "a craft cider" → "a cider"; one with no word after it ("it's craft.") can't go quietly
      // a form of it in front of a noun goes too ("a well-crafted cider" → "a cider"), never in front of a small word
      // ("crafted with care" can't lose its verb: the line is dropped)
      s = s.replace(new RegExp(`(^|[^\\p{L}\\p{N}])(?:(a|an|A|An)\\s+)?(?:\\p{L}+-)?${formSrc(a)}\\s+(?!(?:one|ones|with|by|in|into|for|to|and|or|from|of|at|on|as|is|are|was|that|this|it|the|a|an)(?![\\p{L}\\p{N}]))(?=(\\p{L}+))`, "giu"), (m, pre, art, next) => `${pre}${art ? `${anFor(art, next)} ` : ""}`);
      if (avoidRe(a).test(s)) return null;
    } else {
      s = s.replace(new RegExp(`(^|[^\\p{L}\\p{N}])(?:(a|an|A|An)\\s+)?${esc(a)}(e?s)?(?=$|[^\\p{L}\\p{N}])`, "giu"), (m, pre, art, pl) => {
        const word = m.slice(pre.length + (art ? art.length + 1 : 0));
        const to = `${/^\p{Lu}/u.test(word) && !art ? "D" : "d"}rink${pl ? "s" : ""}`;
        return `${pre}${art ? `${anFor(art, "drink")} ` : ""}${to}`;
      });
      if (avoidRe(a).test(s)) return null; // another form of it ("ciders'", "cidery") the rewording didn't take
    }
  }
  return s.replace(/\b(drinks?)\s+drinks?\b/gi, "$1");
}
// ---- end fix9 ----
// soften = {what}: never-say words are reworded where they can be (the chat and the model's prompt); without it a line
// with one is null (the talking points drop it).
export function applyRule(text, rules, { keep = [], soften: soft = null } = {}) {
  if (text == null) return text;
  let s = String(text);
  const held = [];
  for (const k of [...new Set(keep.map((x) => String(x ?? "").trim()).filter((x) => x.length >= 2))].sort((a, b) => b.length - a.length)) {
    s = s.replace(wordRe(k), (m, pre) => (held.push(m.slice(pre.length)), `${pre}\uE000${String.fromCharCode(0xE100 + held.length - 1)}\uE001`));
  }
  const back = (x) => x.replace(/\uE000(.)\uE001/gu, (m, c) => held[c.charCodeAt(0) - 0xE100]);
  if (soft) {
    s = soften(s, rules?.avoid ?? [], soft.what);
    if (s == null) return null;
  } else if ((rules?.avoid ?? []).some((a) => a && avoidRe(a).test(s))) return null;
  for (const t of rules?.terms ?? []) {
    if (!t?.from) continue;
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])${esc(t.from)}(e?s)?(?=$|[^\\p{L}\\p{N}])`, "giu");
    s = s.replace(re, (m, pre, pl, at, all) => {
      const before = all.slice(0, at) + pre;
      let to = pl && !/s$/i.test(t.from) ? plural(t.to) : t.to;
      // "a sparkling kombucha" → "a sparkling tea", not "a sparkling sparkling tea"
      const prev = /([\p{L}\p{N}'’-]+)\s+$/u.exec(before)?.[1];
      const [first, ...rest] = to.split(/\s+/);
      if (prev && rest.length && prev.toLowerCase() === first.toLowerCase()) to = rest.join(" ");
      if (sentenceStart(before) && /^\p{Ll}/u.test(to)) to = to[0].toUpperCase() + to.slice(1);
      return `${pre}${to}`;
    });
    // "a non-alcoholic" → "an alcohol-free": the article agrees with the new word
    const an = /^[aeiou]/i.test(t.to) && !/^(one|uni|use|eu)/i.test(t.to);
    s = s.replace(new RegExp(`(^|[^\\p{L}])(a|an|A|An) (?=${esc(t.to)}(?=$|[^\\p{L}\\p{N}]))`, "gu"), (m, pre, art) => `${pre}${art[0]}${an ? "n" : ""} `);
  }
  return back(s);
}

// ---------- the envelope (S5) and the agent's checks ----------
// Names never sent to an LLM: the contact's and the rep's. Q2: code strips them before ANY model call.
// R9 red team F14: a full name ("Sam Ortiz") also hides its parts ("Sam", "Ortiz"): the rep says "remember Sam". Parts
// are capitalised words of the name (a "(bar manager)" role is not a name) and match case as written, so a contact
// called Will or May doesn't redact "will" or "may".
const PART = /^\p{Lu}[\p{L}'’-]+$/u;
export const nameParts = (n) => String(n ?? "").replace(/\([^)]*\)/g, " ").split(/[\s,]+/).filter((w) => w.length >= 2 && PART.test(w));
const partRe = (s) => new RegExp(`(^|[^\\p{L}\\p{N}])${esc(s)}(?=$|[^\\p{L}\\p{N}])`, "gu");
export function redact(text, names = []) {
  let s = String(text ?? "");
  const full = [...new Set(names.map((x) => String(x ?? "").trim()).filter((x) => x.length >= 2))];
  for (const n of [...full].sort((a, b) => b.length - a.length)) s = s.replace(wordRe(n), (m, pre) => `${pre}the contact`);
  for (const p of [...new Set(full.flatMap(nameParts))].sort((a, b) => b.length - a.length)) s = s.replace(partRe(p), (m, pre) => `${pre}the contact`);
  return s;
}
// Names a text gives a person ("Ask for Jordan", "talked to Dana Lee", "Hi Sam,"): a capitalised word or two after the
// cue. "Hi <venue> team" is the note's greeting to a room, not a person. F14: these are redacted like stored names.
const CUE = /\b(?:[Aa]sk for|[Tt]alked to|[Tt]alked with|[Ss]poke (?:to|with)|[Mm]et with|[Mm]et|[Hh]i|[Hh]ello|[Dd]ear)\s+(\p{Lu}[\p{L}'’-]+(?:\s\p{Lu}[\p{L}'’-]+)?)/gu;
const NOT_NAME = new Set(["The", "A", "An", "Your", "Our", "Their", "This", "That", "There", "Doors", "Qloo", "Team", "Everyone", "Mr", "Ms", "Mrs"]);
export function namesIn(text) {
  const out = new Set();
  const t = String(text ?? "");
  for (const m of t.matchAll(CUE)) if (!NOT_NAME.has(m[1].split(/\s/)[0]) && !/^\s+team\b/.test(t.slice(m.index + m[0].length))) out.add(m[1]);
  // Privacy: a name beside the person's role ("the manager is Priya", "manager Priya", "Priya, the bar manager",
  // "Priya (owner)", "a guy named Marco", "text Marco") or before what they said ("Marco said come back Thursday")
  for (const re of ROLE_CUES) for (const m of t.matchAll(re)) if (!NOT_NAME.has(m[1].split(/\s/)[0]) && !NOT_NAME_WORD.test(m[1])) out.add(m[1]);
  for (const m of t.matchAll(NAMED_SUBJ)) if (SENSITIVE.test(m[2]) && !NOT_NAME.has(m[1].split(/\s/)[0]) && !NOT_NAME_WORD.test(m[1])) out.add(m[1]);
  return [...out];
}
const ROLE = "(?:bar manager|general manager|beverage director|bev director|head brewer|bar lead|manager|owner|buyer|bartender|gm|GM|chef|server|sommelier|somm|brewer|booker|boss|contact|wife|husband|partner|guy|dude|lady|woman|man)";
const NM = "(\\p{Lu}[\\p{L}'’-]+(?:\\s\\p{Lu}[\\p{L}'’-]+)?)";
const ROLE_CUES = [
  new RegExp(`\\b${ROLE}(?:'s|’s)?(?:\\s+name)?(?:\\s+is|\\s*[:=]|\\s+named|\\s+called)?\\s+${NM}`, "gu"),
  new RegExp(`${NM},?\\s+(?:\\((?:the\\s+)?${ROLE}\\)|(?:the|our|their|is the|is their|is our)\\s+${ROLE}(?![\\p{L}]))`, "gu"),
  new RegExp(`\\b(?:[Nn]amed|[Cc]alled|[Nn]ame is|[Nn]ame's|[Nn]ame’s)\\s+${NM}`, "gu"),
  new RegExp(`\\b(?:[Tt]ext|[Cc]all|[Ee]mail|[Mm]essage|[Tt]hank|[Tt]ell|[Ff]ind|[Ss]ee)\\s+${NM}`, "gu"),
  new RegExp(`${NM}\\s+(?:said|says|told|asked|wants|wanted|runs|orders|does the ordering|is in|is off|is out|works|liked|loved|likes|loves|hated|was|wasn't|seemed|thinks|thought|agreed|tasted|tried|took|bought|ordered|signed|got)\\b`, "gu"),
];
// capitalised words that start a sentence or name a day, not a person
const NAMED_SUBJ = /(?<![\p{L}])(\p{Lu}[\p{L}'’-]+(?:\s\p{Lu}[\p{L}'’-]+)?)(?:\s+(?:is|was)|'s|’s)\s+([^.;!?]*)/gu;
const NOT_NAME_WORD = /^(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|January|February|March|April|May|June|July|August|September|October|November|December|Today|Tomorrow|Tonight|They|She|He|It|We|I|You|Owner|Manager|Buyer|Bartender|Chef|Nobody|Someone|Everyone|Staff|Doors|Qloo|NA|IPA|Email|Text|Call|Ask|Come|Back|Talked|Wants|Said|Spoke|Met|Check|Bring|Drop|Follow|Send|Try|Next|Last|Then|Also|And|But|So|Maybe|Probably|Great|Good|No|Yes|Not)\b/;

// ---------- Privacy: what a note or message says about a person never reaches a model ----------
// Phone numbers and email addresses become "a phone number" / "an email address". A clause that describes a person
// (age, gender, origin, religion, sexuality, health, family, body, politics) is left out: it names someone (she, his,
// the owner, the contact) and a personal trait, or it is a trait only a person has ("45 years old", "pregnant").
// Qloo's crowd lines have no person in them ("young professionals"), so they stay; door names are never scrubbed.
export const PHONE = /(?<![\w.+-])(?:\+?1[\s.-]?)?(?:\(\d{3}\)\s?|\d{3}[\s.-]?)\d{3}[\s.-]?\d{4}(?![\w-])/g;
export const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const REF = /\b(?:she|he|her|him|his|hers|herself|himself|she's|he's|owner|owners|manager|gm|buyer|bartender|chef|server|boss|wife|husband|guy|dude|lady|woman|man|girl|boy|sommelier|somm|brewer|bar lead|the contact)\b/i;
const TRAIT = new RegExp("\\b(?:" + [
  "old|older|young|younger|elderly|aged|\\d0s|(?:early|mid|late)[- ]?\\d0s|(?:about|around|maybe|like|probably|roughly)\\s\\d{2}(?!\\s?(?:min|mins|minutes|cases?|bottles?|cans?|kegs?|doors?|taps?|seats?|%|dollars|bucks|bucks))",
  "male|female|trans|transgender|nonbinary|non-binary|gay|lesbian|queer|bisexual|bi|straight",
  "korean|mexican|indian|chinese|japanese|vietnamese|thai|filipin[oa]|italian|irish|polish|greek|russian|ukrainian|german|french|spanish|brazilian|colombian|cuban|puerto rican|dominican|haitian|jamaican|nigerian|ethiopian|african|arab|persian|iranian|turkish|lebanese|white|black|asian|latin[oax]|hispanic|caucasian|ethnic\\w*|immigrants?|from (?:mexico|india|china|korea|japan|vietnam|ireland|italy|poland|russia|brazil|colombia|cuba|nigeria|abroad|overseas)|speaks? (?:spanish|chinese|korean|vietnamese|russian|polish|arabic|hindi|portuguese|french|italian|no english|little english|broken english)|accent",
  "muslim|jewish|christian|catholic|mormon|hindu|buddhist|sikh|religious|church|mosque|synagogue|atheist",
  "pregnant|baby|maternity|paternity|sick|illness|cancer|chemo|surgery|disabled|disability|wheelchair|blind|deaf|bad back|injur\\w*|rehab|recovering|(?<![\\w-])alcoholic|diabetic|depress\\w*|anxiety|therapy|vegetarian|vegan",
  "divorced|divorcing|married|single|widow\\w*|dating|girlfriend|boyfriend|wife|husband|kids?|children|son|daughter",
  "tattoos?|tattooed|fat|overweight|skinny|thin|bald|pretty|hot|cute|attractive|ugly|short|tall",
  "republican|democrat|conservative|liberal|trump|maga|woke|political",
].join("|") + ")\\b", "i");
// A person named as the subject ("Jo is 60 and Catholic", "Al's diabetic", "Mo is a Republican"): with no role word
// the clause is still about them when what follows is age, religion, health, politics, sexuality or origin. Origin
// and sexuality words before a door word ("a Korean BBQ spot", "a gay bar") describe the door and stay.
const NAMED = /(?:^|[^\p{L}])\p{Lu}[\p{L}'’-]*(?:\s\p{Lu}[\p{L}'’-]+)?(?:\s+(?:is|was)|'s|’s)\s+(.*)$/u;
const DOOR_WORD = "(?:bbq|barbecue|food|kitchen|spot|place|restaurant|bar|pub|joint|cafe|café|bakery|taqueria|diner|grill|brewery|menu|cuisine|crowd|neighbou?rhood|owned|run)";
const SENSITIVE = new RegExp("^(?:(?:about|around|maybe|like|probably|roughly|only|just|over|under)\\s)?(?:\\d{2}(?!\\s?(?:min|mins|minutes|miles?|mi|cases?|bottles?|cans?|kegs?|doors?|taps?|seats?|%|dollars|bucks|hours?|h\\b|am|pm|:))\\b|\\d0s\\b)|\\b(?:old|older|young|younger|elderly|" + [
  "muslim|jewish|christian|catholic|mormon|hindu|buddhist|sikh|religious|atheist",
  "pregnant|sick|ill|diabetic|disabled|blind|deaf|(?<![\\w-])alcoholic|in recovery|recovering|depressed|on chemo|in rehab",
  "republican|democrat|conservative|liberal|maga|political",
].join("|") + ")\\b|\\b(?:gay|lesbian|trans|queer|bisexual|korean|mexican|indian|chinese|japanese|vietnamese|thai|filipin[oa]|italian|irish|polish|greek|russian|african|arab|persian|turkish|lebanese|white|black|asian|latin[oax]|hispanic|immigrant)\\b(?!\\s+(?:\\w+\\s+)?" + DOOR_WORD + "\\b)", "i");
const POSSESSED = new RegExp("^(?:\\w+\\s+)?(?:" + DOOR_WORD.slice(3, -1) + "|regulars|profile|list|patio|taps?|hours|team|staff|rank|affinity|popularity)\\b", "i");
const namedTrait = (c) => {
  const m = c.match(NAMED);
  if (!m || !SENSITIVE.test(m[1])) return false;
  const subj = c.slice(0, c.length - m[1].length).trim().replace(/^[^\p{L}]+/u, "");
  if (NOT_NAME_WORD.test(subj) || NOT_NAME.has(subj.split(/\s/)[0])) return false;
  return !(/['’]s$/.test(subj) && POSSESSED.test(m[1])); // "Nomadic's crowd is young": the door's crowd, not a person
};
const ALWAYS = /\b(?:\d{1,2}\s?(?:years?|yrs?)[- ]old|in (?:her|his|their) (?:early |mid |late )?\d0s|pregnant|divorced|widow(?:ed|er)?|had a baby|maternity leave|in a wheelchair|has cancer|in rehab)\b/i;
const SEP = /((?<=[.;!?])\s+|,\s+|\s+-\s+|\s+—\s+|\s*\n+\s*|\s+(?:so|but)\s+)/;
export function personalOut(text) {
  let t = String(text ?? "").replace(EMAIL, "an email address").replace(PHONE, "a phone number");
  if (!REF.test(t) && !ALWAYS.test(t) && !NAMED.test(t)) return t;
  const parts = t.split(SEP);
  const out = [];
  let prevDropped = false, dropped = 0;
  for (let i = 0; i < parts.length; i += 2) {
    const c = parts[i], sep = parts[i + 1] ?? "";
    const short = c.trim().split(/\s+/).length <= 3;
    const drop = ALWAYS.test(c) || namedTrait(c) || (TRAIT.test(c) && (REF.test(c) || (prevDropped && short)));
    prevDropped = drop;
    if (drop) { dropped++; if (out.length) out[out.length - 1] = /[.;!?]/.test(out[out.length - 1]) || !/[.;!?]/.test(c + sep) ? out[out.length - 1] : `${c.trim().slice(-1)}${sep}`; continue; }
    out.push(c, sep);
  }
  if (!dropped) return t;
  const kept = out.join("").replace(/[,;\s—-]+$/, "").replace(/^[,;\s—-]+/, "").trim();
  return kept ? (/[.!?]$/.test(kept) || !/[.!?]$/.test(t.trim()) ? kept : `${kept}.`) : "(a note about a person, left out)";
}
// A whole envelope for a model: names redacted, phones/emails replaced and person descriptions left out, strings only.
// Keys in `keep` (door names, ids, the brand) are left as they are.
const KEEP_KEYS = new Set(["name", "id", "brand", "door", "door_id", "city", "key", "url", "source"]);
export function forModel(x, names = [], k = null) {
  if (typeof x === "string") return redact(k && KEEP_KEYS.has(k) ? x : personalOut(x), names);
  if (Array.isArray(x)) return x.map((y) => forModel(y, names, k));
  if (x && typeof x === "object") return Object.fromEntries(Object.entries(x).map(([kk, v]) => [kk, forModel(v, names, kk)]));
  return x;
}
// A whole envelope with names redacted (deep, strings only).
export function redactDeep(x, names) {
  if (typeof x === "string") return redact(x, names);
  if (Array.isArray(x)) return x.map((y) => redactDeep(y, names));
  if (x && typeof x === "object") return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, redactDeep(v, names)]));
  return x;
}

// The context envelope one door gets (CULTURAL-SLOTS §4), from the stop model (lib/stopmodel.js) and the saved slots.
export function envelope(m, { slots = {}, brandCity = "", channel = "spoken", now = Date.now() } = {}) {
  const mem = m?.memory ?? null;
  const live = [...(slots[m?.id] ?? []), ...(slots["*"] ?? [])].filter((r) => isLive(r, now));
  const contactRec = mem?.used?.find((r) => r.field === "contact") ?? null;
  const rules = rulesFrom(slots, m?.id, now);
  return {
    v: 1,
    brandCity,
    door: { id: m?.id ?? null, name: m?.venue?.name ?? null, venueType: m?.talk?.venueType ?? null, rank: m?.rank ?? null, N: m?.N ?? null, rankBy: m?.merged ? "doors-merged" : "qloo" },
    audience: { role: m?.talk?.before?.[0] ?? null, contact: contactRec ? { value: contactRec.value, source: contactRec.source, at: contactRec.at } : null },
    occasion: { visit: mem?.visit ?? "first", lastVisit: mem?.lastVisit ?? null, outcome: m?.outcome?.result ?? null, channel, arrival: m?.talk?.arrival ?? null },
    constraints: { kind: m?.talk?.kind ?? null, isNA: m?.talk?.isNA ?? null, ask: m?.talk?.ask ?? null, maxWords: { spoken: 18, sms: 55 }, maxChars: { sms: 320 }, avoid: [...(m?.avoid ?? []), ...rules.avoid], terms: Object.fromEntries(rules.terms.map((t) => [t.from, t.to])) },
    slots: live.map((r) => ({ ...r, trace: trace(r) })),
    qloo: {
      crowd: m?.venue?.crowd ? { field: "customer_demographics_description", captured: m?.record?.captured ?? null } : null,
      // R9 deep (lib/culture.js): the room's Qloo tags as sourced facts (cite as [qloo:tag:<field>]), and the lines they
      // changed on this stop. [] / null when the signals are off or Qloo has none.
      tags: m?.roomTags ?? [],
      hook: m?.talk?.hook ? { text: m.talk.hook.text, src: m.talk.hook.src } : null, // cite as [qloo:hook]
      hood: m?.hood ? { text: m.hood.text, src: m.hood.src } : null, // cite as [qloo:heatmap]
      decided: m?.talk?.deep ? { tod: m.talk.deep.tod ? { kind: m.talk.deep.tod.kind, src: m.talk.deep.tod.src } : null, lead: m.talk.deep.lead ? { question: m.talk.deep.lead.question ?? null, gate: m.talk.deep.lead.gate ?? null, ask: m.talk.deep.lead.ask ?? null, src: m.talk.deep.lead.src } : null } : null,
    },
  };
}

// The agent's free text, checked by code: an avoided name or phrase drops the sentence; a sentence about people's
// age, gender, ethnicity, religion or origin is dropped unless it cites [qloo:age] (asked about, the room's aggregate).
export const PERSON = /\b(ages?|aged|young|younger|older|elderly|millennials?|gen ?z|boomers?|men|women|male|female|guys|girls|ethnic\w*|race|racial|religio\w*|immigrants?|latin[oax]s?|hispanic|asian|black|white)\b/i;
export function checkReply(text, env) {
  const avoid = env?.constraints?.avoid ?? [];
  const dropped = [];
  // R9 red team: a cheap substring test before each word regex (an honest context carries ~700 avoided names; compiling
  // a regex per name per sentence cost ~16 ms CPU a reply, over the free Workers plan's 10 ms)
  const low = avoid.map((a) => (typeof a === "string" ? a.trim().toLowerCase() : ""));
  const kept = String(text ?? "").split(/(?<=[.!?])\s+/).filter((s) => {
    const sl = s.toLowerCase();
    if (avoid.some((a, i) => low[i] && sl.includes(low[i]) && wordRe(a.trim()).test(s))) return dropped.push({ s, why: "avoid" }), false;
    // round 3 (agent2, loose rules): Qloo's own crowd words ("young professionals", "families") stand when the sentence
    // says they are Qloo's; a sentence that describes people on its own still goes
    if (PERSON.test(s) && !/\[qloo:age\]/.test(s) && !/\bQloo\b/.test(s)) return dropped.push({ s, why: "about people" }), false;
    return true;
  });
  let out = kept.join(" ");
  for (const [from, to] of Object.entries(env?.constraints?.terms ?? {})) out = out.replace(wordRe(from), (m, pre) => `${pre}${to}`);
  return { text: out, dropped };
}
