// The chat agent's tools (docs/CONTRACTS-R9.md §2): declarations for the model, and code that runs them against the
// context the client sent. The model proposes a call; this code validates every argument and decides. A tool returns
// {ok, facts?, actions?, error?, data?}: facts carry their source (§2.3), actions are what the client applies (§2.2).
// Pure: no fetch, no DOM. The Worker, the rules path (agent-rules.js), the guided demo and the RN app all run it.
import { BANNED_PITCH, affinityGap, popWords } from "./core.js";
import { RESULT_TEXT } from "./outcome.js";
import { mentions, humanTime } from "./talk.js";
import { sayOutcome, parseDate, parseVisit, noteOf } from "./visit-parse.js";
import { isoDate, niceDate } from "./profile.js";
import { AGENT_WRITABLE, ROLES, makeRecord, validateRecord, fromOutcome, nameParts, namesIn, PERSON, PHONE, EMAIL } from "./slots.js";
import { makeNote, hasNote, NOTE_MAX } from "./door-notes.js";
import { PLACE_LABELS } from "./place.js";
import { mailtoHref, smsHref, firstName, SMS_MAX } from "./note.js";
import { PROMISE, weekdayIn } from "./day-debrief.js";
// "16:00" → "4 pm", "16:30" → "4:30 pm": the clock every other line of Doors uses (judge R9)
const clock12 = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm));
  if (!m) return hhmm;
  const h = Number(m[1]) % 24;
  return `${h % 12 || 12}${m[2] === "00" ? "" : `:${m[2]}`} ${h < 12 ? "am" : "pm"}`;
};

// The slot key of a field the agent may write ("contact" → "S4.contact"), or null.
export const writableKey = (field) => Object.keys(AGENT_WRITABLE).find((k) => k.slice(k.indexOf(".") + 1) === field) ?? null;
// A logged visit → its S4 records (CULTURAL-SLOTS §5): stated, by whoever extracted them, not yet confirmed by the rep.
// Door notes: the visit's note (the rep's words) is also a note on the door, so the stop's Notes show it later.
export const memoryFromVisit = (o, { by = "code", at } = {}) => {
  const out = fromOutcome(o, { at, by }).map((r) => ({ ...r, confirmed: false }));
  const n = String(o?.note ?? "").trim() ? makeNote({ text: o.note, by: by === "code" ? "drive" : by, at: at ?? o.at ?? null }) : null;
  return n ? [...out, n] : out;
};

export const SECTIONS = ["opener", "toBuyer", "questions", "points", "pushback", "ask"];
// one-line sections (replace only); toBuyer: the line to the buyer (Jard 10-24 web review: the agent offered to change
// it and the tool couldn't reach it)
export const SINGLE = ["opener", "toBuyer", "ask"];
const MAX_TEXT = 500;
const FAME_CAP = 0.9; // Qloo popularity above it: a famous room, left out unless the rep switches them in (lib/sieve.js)
export const isIsoDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s ?? "")) && isoDate(new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8))) === s;
export const isClock = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s ?? ""));

// A visit (status + outcome) → the §3.1 log-visit result, with its visit memory (slot records) as actions.
export function visitResult({ status, outcome }, { stop, next = [], source, memory = [] }) {
  const nx = (next ?? []).find((x) => x?.id && x.id !== stop.id) ?? null;
  const actions = [{ type: "status", id: stop.id, status }, { type: "outcome", id: stop.id, outcome }, ...memory.map((record) => ({ type: "slot", id: stop.id, record }))];
  return { v: 1, ok: true, source, visit: { status, outcome }, memory, say: `Logged ${stop.name}: ${sayOutcome(outcome)}.${nx ? ` Next: ${nx.name}.` : ""}`, next: nx ? { id: nx.id, name: nx.name } : null, actions };
}
// The rules parser's result (visit-parse.js, drive mode's) + its visit memory: what the Worker and the rules path return.
export function withMemory(r, { stop, words, by = "code" }) {
  if (!r?.ok) return r;
  const memory = memoryFromVisit(r.visit.outcome, { by, at: Date.parse(r.visit.outcome.at ?? "") || Date.now() });
  return { ...r, memory, actions: [...r.actions, ...memory.map((record) => ({ type: "slot", id: stop.id, record }))] };
}
const ID = { type: "string", description: "a door id from the context's doors" };

export const TOOLS = [
  { name: "explain_door", description: "Why a door ranks where it does and what Qloo's data says about it. Returns facts with sources; quote them, add nothing.", parameters: { type: "object", properties: { door_id: ID }, required: ["door_id"] } },
  { name: "compare_doors", description: "The same facts for two or three doors side by side (why one is before another).", parameters: { type: "object", properties: { door_ids: { type: "array", items: { type: "string" } } }, required: ["door_ids"] } },
  { name: "ask_city", description: "What Qloo's data says about the city and its crowd: topic crowd (the doors' crowd descriptions), sound (the city's artists), neighbourhoods, or doors (the plan's best doors).", parameters: { type: "object", properties: { topic: { type: "string", enum: ["crowd", "sound", "neighbourhoods", "doors"] } }, required: ["topic"] } },
  { name: "replan", description: "Re-plan the day: skip doors, finish by a time, start from now, cap the doors, lock or add doors. The app's planner does the routing.", parameters: { type: "object", properties: { skip: { type: "array", items: { type: "string" } }, end_by: { type: "string", description: "HH:MM 24h" }, start_now: { type: "boolean" }, max_doors: { type: "integer" }, lock: { type: "array", items: { type: "string" } }, add: { type: "array", items: { type: "string" } }, day: { type: "string", description: "YYYY-MM-DD, a plan day" }, move: { type: "array", description: "doors to move to another plan day", items: { type: "object", properties: { door_id: ID, day: { type: "string", description: "YYYY-MM-DD, a plan day" } }, required: ["door_id", "day"] } } } } },
  { name: "edit_talking_points", description: "Change one line of a door's talking points. section: opener (said to whoever is behind the bar), toBuyer (the line to the buyer), questions, points, pushback or ask. op replace/add/remove; replace and remove in a list need index (0-based in that section's list) or line (the current line as it reads); opener, toBuyer and ask are one line: replace. Write what a rep says out loud: plain, short, nothing claimed about what the door stocks.", parameters: { type: "object", properties: { door_id: ID, section: { type: "string", enum: SECTIONS }, op: { type: "string", enum: ["replace", "add", "remove"] }, index: { type: "integer" }, line: { type: "string", description: "the current line you replace or remove, as it reads (instead of index)" }, text: { type: "string" }, dictated: { type: "boolean", description: "true when these are the rep's own words, not your rewrite" } }, required: ["door_id", "section", "op"] } },
  { name: "log_visit", description: "Log what happened at a door. result: interested, followup, someone (talked to someone else), no. follow_up_date YYYY-MM-DD and follow_up_time HH:MM only when the rep said them. note: the rep's own words.", parameters: { type: "object", properties: { door_id: ID, result: { type: "string", enum: Object.keys(RESULT_TEXT) }, follow_up_date: { type: "string" }, follow_up_time: { type: "string" }, who: { type: "string" }, note: { type: "string" }, not_a_fit: { type: "boolean" } }, required: ["door_id", "result"] } },
  // Door notes (Jard 2026-10-23): the agent decides what's worth keeping, in the rep's words, and says so
  { name: "save_note", description: "Save a note on a door: anything the rep says that will matter on a later visit (who to ask for and when they are in, what they asked for or want, a promise you or they made, how to reach them, something about the door). Use the rep's own words, one fact per note. Not small talk, not questions, and not how the visit went (log_visit keeps that).", parameters: { type: "object", properties: { door_id: ID, text: { type: "string", description: "the note, in the rep's words" } }, required: ["door_id", "text"] } },
  // Doors Agent abilities (spec §5): read-only bundles, so one call answers "brief me" and "prep my day"
  { name: "brief_door", description: "Brief the rep on one door before they walk in: what Qloo knows about the place (who goes and when, the room, what it pours, what the crowd is into, its music, the doors with the same crowd), its hours and arrival time, the stop's talking points (opener, questions, the ask, likely pushback), the rep's notes and what they logged. What the door pours is not in Doors' data.", parameters: { type: "object", properties: { door_id: ID }, required: ["door_id"] } },
  { name: "prep_day", description: "Prep the day the app is on: its stops in order with rank, affinity, arrival and closing time, each stop's flags, where to lead hardest, the weak doors and why, and better-ranked doors off this day to swap in. Read-only: a swap is made only with replan, when the rep asks.", parameters: { type: "object", properties: {} } },
  { name: "draft_follow_up", description: "Draft a follow-up email or text to a door, in the rep's voice, for the rep to send from their own mail or text app (Doors never sends it). Write only the message (and an email's subject): no greeting and no sign-off, Doors adds both. Short and specific, like a person texting: what was said (the rep's words, the door's notes and logged outcome), the promise or next step. Before they've tasted it, ask only for a time to bring a taste; ask for the order (the rep's ask) only once the rep logged them as interested. Say times like \"around 2\" or \"a little after 1\", never \"1:14 pm\". Never describe the door's crowd. No free goods, cash or perks.", parameters: { type: "object", properties: { door_id: ID, channel: { type: "string", enum: ["email", "text"] }, subject: { type: "string", description: "email only, under 80 characters" }, body: { type: "string" } }, required: ["door_id", "channel", "body"] } },
  // Doors Agent abilities 5 and 7 (spec §5): read-only
  { name: "what_to_bring", description: "What to bring for the day the app is on, door by door: the kit for each door's type (samples, sell sheet, price sheet with the math, a spec for a cocktail bar), what the rep promised to bring or send (their notes and kept items), and the order ask for doors already interested.", parameters: { type: "object", properties: {} } },
  { name: "next_trip", description: "Plan the next trip from the logged visits: which doors deserve a second visit, in what order and when (interested with no return booked first, follow-ups as booked, talked to someone else when the buyer is in, just visited for a name and best time), which to leave for now, and the best-ranked doors not visited yet. Read-only: a change is made only with replan, when the rep asks.", parameters: { type: "object", properties: {} } },
  { name: "remember", description: "Keep something the rep stated or corrected: contact, objection, said, next, carry (stated); venueType, rule.avoid, rule.term, note.email, note.sms (only when the rep explicitly asks to correct it). Never anything about a person beyond a contact's name and role.", parameters: { type: "object", properties: { field: { type: "string" }, value: { description: 'a string; for contact {"name": "…", "role": "manager"}' }, door_id: ID, correction: { type: "boolean", description: "the rep explicitly asked for this correction in this message" } }, required: ["field", "value"] } },
];
export const TOOL_NAMES = TOOLS.map((t) => t.name);

const clip = (s, n = MAX_TEXT) => String(s ?? "").replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, n);
const doorOf = (ctx, id) => (typeof id === "string" && Object.hasOwn(ctx?.doors ?? {}, id) ? ctx.doors[id] : null);
const noDoor = (id) => ({ ok: false, error: `"${clip(id, 60)}" is not a door on this plan; use an id from the context` });
const src = (kind, field, door, ctx, label, captured) => ({ kind, field, door: door ?? null, captured: captured ?? null, label });
const qlooLabel = (what, captured) => `Qloo, ${what}${captured ? ` (captured ${captured})` : ""}`;

// gigbot 10-24 (rankfix: one rank everywhere): a door's rank is its place on Your list (plan.pool.ids, as basis.listRanks
// counts it), said that way: with 2+ drinkers the list is Doors' merge of Qloo's lists, so it is never "Qloo ranks it"
export function rankFact(v, ctx) {
  const d = String(ctx.cityData?.drinker ?? "").replace(/ drinkers$/, "");
  const who = /^(the )?regulars\b/i.test(d) ? d : `people who drink ${d}`;
  const of = `${ctx.city?.name ?? "the city"} ${ctx.cityData?.filter || "bars and restaurants"} for ${who}`;
  return `${v.name} is #${v.rank} of ${v.N} on Your list, ${ctx.cityData?.merged ? "Doors' merge of Qloo's rankings" : "Qloo's ranking"} of ${of}.`;
}
// ---------- facts about one door, each with its source ----------
export function doorFacts(ctx, id) {
  const v = doorOf(ctx, id);
  if (!v) return [];
  const cap = v.captured ?? null;
  const city = ctx.city?.name ?? "the city";
  const out = [];
  const q = (field, what, text) => out.push({ text, source: src("qloo", field, id, ctx, qlooLabel(what, cap), cap) });
  const k = (ctx.day?.stops ?? []).findIndex((x) => x.id === id);
  if (k >= 0) {
    const st = ctx.day.stops[k];
    // judge pass 2 (5): where it sits on the loop and how late it's open, then (when the plan view tried it) the trade
    const nm = (x) => (x ? doorOf(ctx, x.id)?.name : null);
    const by = [nm(ctx.day.stops[k - 1]), nm(ctx.day.stops[k + 1])];
    const where = by[0] && by[1] ? `, between ${by[0]} and ${by[1]}` : by[1] ? `, before ${by[1]}` : by[0] ? `, after ${by[0]}` : "";
    out.push({ text: `Stop ${k + 1} of ${ctx.day.stops.length} on ${niceDate(ctx.day.date)}${st.eta ? `, ${etaSay(st.eta)}` : ""}${where}${st.until ? `, open till ${clock12(st.until)}` : ""}. Doors orders a day by driving time and opening hours${st.reason ? ` (${clip(st.reason, 160)})` : ""}, not by rank.`, source: src("plan", "order", id, ctx, "Doors' route", null) });
    const tr = ctx.day.trade?.id === id && k > 0 ? ctx.day.trade : null;
    if (tr) {
      const unit = tr.source === "ors" ? "road mi" : "mi, estimated";
      const dMin = Math.round(tr.then.min - tr.was.min), dMi = Math.round((tr.then.mi - tr.was.mi) * 10) / 10;
      const miles = dMi ? ` (${tr.was.mi.toFixed(1)} → ${tr.then.mi.toFixed(1)} ${unit} for the day)` : "";
      // judge pass 10 #3: when a door drops, the minutes compare two different days ("adds 1 min" while a whole door goes):
      // say the route's miles and the door that came off, not the minutes
      const cost = tr.dropped.length
        ? `changes the day's route${dMi ? ` (${tr.was.mi.toFixed(1)} → ${tr.then.mi.toFixed(1)} ${unit})` : ""}`
        : `${dMin > 0 ? `adds ${dMin} min of driving` : "adds no driving time"}${miles}`;
      // judge pass 9 #5: say why a door drops (a minute costing a whole door read as arbitrary)
      const doors = tr.dropped.length ? `, and ${tr.dropped.slice(0, 4).join(", ")} ${tr.dropped.length === 1 ? "comes" : "come"} off the day: in the new order there's no time to reach ${tr.dropped.length === 1 ? "it" : "them"} before your day ends or ${tr.dropped.length === 1 ? "it closes" : "they close"}` : `, for the same ${tr.then.n} doors`;
      out.push({ text: `Putting it first ${cost}${doors}. Move it to the top of the list to lock it there.`, source: src("plan", "trade", id, ctx, "Doors' route, re-planned with it first", null) });
    }
  }
  // Jard 10-23: whether it is on the plan and, if not, the gate that stopped it, in the Why view's own words
  // (lib/sieve.js placeFate + gateLine, carried on the door by agent-context.js); a stop of this day has its order fact
  if (k < 0 && v.plan?.head) out.push({ text: v.plan.on ? `${v.plan.head} ${clip(v.plan.reason, 200)}.` : `Not on any day of your plan. ${v.plan.head} ${clip(v.plan.reason, 200)}.`, source: src("plan", "plan", id, ctx, "Doors' plan (the Why view)", null) });
  if (v.rank && v.N && ctx.cityData?.drinker) q("rank", "rank for your drinker", rankFact(v, ctx));
  if (typeof v.affinity === "number") {
    // R9 polish (judge walkthrough 3): against the list's #1 when it is on this context, so "#49" reads as near-equal
    const top = Object.values(ctx.doors ?? {}).find((x) => x?.rank === 1 && typeof x.affinity === "number");
    const gap = top && v.rank && v.rank > 1 && !ctx.cityData?.merged ? affinityGap({ affinity: v.affinity, top: top.affinity, rank: v.rank }) : "";
    // round 3 (Jard 10-23: decimals are "super confusing"): the match in words and the rank, never Qloo's 0-1 number
    q("affinity", "taste match for your drinker", `Qloo's taste match for ${v.name} with your drinker${v.rank && v.N ? `: #${v.rank} of ${v.N} on Your list` : ""}${gap ? `, ${gap} (${top.name})` : ""}.`);
  }
  // Jard 10-23: the cap said only as it applies to this room ("0.51 … leaves out rooms above 0.90" read as the reason
  // a 0.51 room was off the plan)
  if (typeof v.popularity === "number") q("popularity", "popularity", `Qloo popularity: ${popWords(v.popularity)}. ${v.popularity > FAME_CAP ? "That's above Doors' cap on the most popular doors; it is on your list because the most popular doors are switched on or you added it" : "That's under Doors' cap on the most popular doors, so the cap doesn't keep it off your plan"}.`);
  if (v.crowd) q("crowd", "customer demographics", `"${clip(v.crowd, 400)}"`);
  if (v.ambience) q("ambience", "ambience", `"${clip(v.ambience, 300)}"`);
  if (Array.isArray(v.goodFor) && v.goodFor.length) q("goodFor", "good for", `Good for: ${v.goodFor.slice(0, 6).map((x) => clip(x, 40)).join(", ")}.`);
  const sis = (v.sisters ?? []).filter((x) => doorOf(ctx, x)).map((x) => ctx.doors[x].name);
  if (sis.length) q("sisters", "sister doors", `Qloo pairs it with ${sis.slice(0, 3).join(", ")} on this plan (people who go to one go to the other).`);
  if (v.sound) q("sound", "door sound", v.sound.pass ? "Its artist list passed Doors' plausibility check, so the stop shows the door's own sound." : `Qloo's artist list for it didn't pass Doors' plausibility check, so the stop shows ${city}'s sound instead.`);
  if (v.outcome?.result) out.push({ text: `You logged: ${RESULT_TEXT[v.outcome.result] ?? v.outcome.result}${v.outcome.followUp ? `, follow up ${v.outcome.followUp}` : ""}${v.outcome.note ? ` ("${clip(v.outcome.note, 140)}")` : ""}.`, source: src("stated", "outcome", id, ctx, "what you told Doors", null) });
  // door notes: the rep's own (and the ones Ask Doors saved from the rep's words), newest first
  for (const n of (v.notes ?? []).slice(0, 6)) out.push({ text: `Note: ${clip(n.text, 300)}`, source: src("stated", "note", id, ctx, n.by === "ask-doors" ? "a note Doors Agent saved from your words" : "your note", null) });
  for (const r of ctx.envelopes?.[id]?.slots ?? []) if (["corrected", "stated"].includes(r.source) && typeof r.value === "string" && r.field !== "note") out.push({ text: `${r.field}: ${clip(r.value, 140)}`, source: src(r.source, r.field, id, ctx, r.source === "corrected" ? "your correction" : "what you told Doors", null) });
  return out;
}

// ---------- the guard for a talking-point line ----------
// Model-written lines: plain, short, no artist or brand names Doors avoids, nothing claimed about what the room stocks
// (core.BANNED_PITCH). The rep's own dictated words are theirs: only cut to length and stripped of markup.
export function talkLineOk(text, { section, dictated = false, avoid = [] } = {}) {
  const s = clip(text, 300);
  if (s.length < 3) return { ok: false, reason: "too short" };
  if (dictated) return { ok: true, text: s };
  if (s.length > (section === "opener" || section === "toBuyer" ? 200 : 160)) return { ok: false, reason: "too long to say" };
  // live replay 10-24: "What do you pour now?" was refused three times as "banned words": the reason names the word
  const banned = BANNED_PITCH.exec(s);
  if (banned) return { ok: false, reason: `it uses "${banned[0]}": Doors never says what a door stocks or pours, or claims a trend, even in a question; say it without that word (e.g. "What do you have for guests who aren't drinking?")` };
  if (/[*_#`]|https?:/.test(s)) return { ok: false, reason: "markup or a link" };
  if (mentions(s, avoid)) return { ok: false, reason: "names an artist or brand Doors never names" };
  return { ok: true, text: s };
}
export const avoidOf = (ctx) => [...(ctx?.avoid ?? []), ...(ctx?.cityData?.citySound ?? [])].filter((x) => typeof x === "string");

// ---- R9 red team: the rep's words are the judge of what the model says the rep said ----
// The model proposes `who`, `note`, a contact, a "dictated" line; code keeps them only when the rep's own message
// (opts.words, never redacted) holds them: else the rules reading of those words, else nothing. No invented memory.
const normW = (x) => String(x ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const FILLER = new Set(["the", "and", "but", "for", "with", "they", "them", "their", "she", "her", "his", "him", "said", "says", "was", "were", "are", "that", "this", "its", "our", "you", "your", "about", "rep", "just", "really", "very"]);
// share: the part of the value's content words that must be in the rep's words (1 = all)
export function grounded(value, words, share = 1) {
  const have = new Set(normW(words).split(" "));
  const toks = normW(value).split(" ").filter((w) => w && (w.length >= 3 || /\d/.test(w)) && !FILLER.has(w));
  if (!toks.length) return normW(value) !== "" && normW(words).includes(normW(value));
  return toks.filter((w) => have.has(w)).length / toks.length >= share;
}
const REDACTED = /^\s*the contact\s*$/i;
// R9 red team F15: what counts as the rep explicitly correcting Doors (only then a "corrected" record or a rule is
// written). A "no"/"not" anywhere is not one ("that was not bad", "no rush", "they're not open Mondays"). Counts:
// a leading "No," / "Nope." / "Wrong:"; "that's wrong" / "that's not right" / "that's incorrect"; a leading "Actually,";
// "it's not a X, it's a Y"; "change / switch / fix / update / set … to"; "call it / call them / it's called";
// "never / don't / do not / stop + say / use / mention / call"; "… instead (of)"; "rather than".
export const CORRECTION = [
  /^\s*(no|nope|nah|wrong)\s*[,.!:;—–-]/i,
  /\b(that'?s|that is|this is|it'?s|it is|you'?re|you are)\s+(wrong|not right|incorrect|a mistake)\b/i,
  /^\s*actually\s*,/i,
  /\b(it'?s|it is|they'?re|they are|this is)\s+not\s+an?\s+[\p{L}' -]{2,30}?[,;:—–-]\s*(it'?s|it is|they'?re|they are|but)\b/iu,
  /\b(change|switch|fix|update|set|correct)\b[^.?!]{0,40}?\b(to|into)\b/i,
  /\b(call it|call them|call that|it'?s called|they'?re called)\b/i,
  /\b(never|don'?t|do not|stop)\s+(say|saying|use|using|mention|mentioning|call|calling)\b/i,
  /\binstead\b/i,
  /^\s*(say|use|call (it|them|that))\b[^.?!]{1,40}?,?\s+not\s+\S/i, // "say sparkling tea, not kombucha" (judge pass 3, N4)
  /\brather than\b/i,
];
export const isCorrection = (words) => CORRECTION.some((re) => re.test(String(words ?? "")));
// A person's name the model gave: kept when the rep said it; "the contact" (the redaction placeholder) or a name the
// rep never said → the one known name (context.names) the rep's words hold, else null.
function nameFrom(name, ctx, words) {
  if (typeof name !== "string" || !name.trim()) return null;
  if (!REDACTED.test(name) && grounded(name, words)) return name;
  const said = (ctx?.names ?? []).filter((n) => typeof n === "string" && n.trim().length >= 2 && grounded(n, words));
  if (said.length === 1) return said[0];
  if (said.length || !REDACTED.test(name)) return null;
  // F14: first names are redacted too, so "talked to Sam" reaches the model as "the contact": the part the rep said of
  // exactly one known name ("Sam" of "Sam Ortiz"), as the rep said it
  const parts = [...new Set((ctx?.names ?? []).flatMap((n) => nameParts(n)).filter((p) => new RegExp(`(^|[^\\p{L}])${p}(?=$|[^\\p{L}])`, "u").test(String(words ?? ""))))];
  if (parts.length) return parts.length === 1 ? parts[0] : null;
  // a name the rep gave in this message and the turn redacted ("talked to Priya Shah")
  const given = namesIn(words);
  return given.length === 1 ? given[0] : null;
}
const judged = (opts) => typeof opts?.words === "string" && opts.words.trim() !== "" && opts.by !== "rules";
// ---- end R9 red team ----

const lineCount = (t, section) => (SINGLE.includes(section) ? (t?.[section] ? 1 : 0) : Array.isArray(t?.[section]) ? t[section].length : 0);

// ---------- run one tool ----------
// opts: {by: "agent:gemini" | "rules", words: the rep's message, now: ISO}
export function runTool(name, args = {}, ctx = {}, opts = {}) {
  const a = args && typeof args === "object" ? args : {};
  switch (name) {
    case "explain_door": {
      if (!doorOf(ctx, a.door_id)) return noDoor(a.door_id);
      const facts = doorFacts(ctx, a.door_id);
      return { ok: true, facts, data: { name: ctx.doors[a.door_id].name, facts: facts.map((f) => f.text) } };
    }
    case "compare_doors": {
      const ids = Array.isArray(a.door_ids) ? [...new Set(a.door_ids)].slice(0, 3) : [];
      if (ids.length < 2) return { ok: false, error: "compare needs two or three door ids" };
      const bad = ids.find((x) => !doorOf(ctx, x));
      if (bad) return noDoor(bad);
      const facts = ids.flatMap((x) => doorFacts(ctx, x).filter((f) => ["plan", "rank", "affinity", "popularity", "crowd"].includes(f.source.field)));
      return { ok: true, facts, data: Object.fromEntries(ids.map((x) => [ctx.doors[x].name, facts.filter((f) => f.source.door === x).map((f) => f.text)])) };
    }
    case "brief_door":
      return briefDoor(ctx, a.door_id);
    case "prep_day":
      return prepDay(ctx);
    case "draft_follow_up":
      return draftFollowUp(ctx, a);
    case "what_to_bring":
      return whatToBring(ctx);
    case "next_trip":
      return nextTrip(ctx);
    case "ask_city":
      return askCity(ctx, a.topic);
    case "replan":
      return replan(ctx, a);
    case "edit_talking_points":
      return editTalk(ctx, a, opts);
    case "log_visit":
      return logVisit(ctx, a, opts);
    case "save_note":
      return saveNote(ctx, a, opts);
    case "remember": {
      if (a.field === "note") return saveNote(ctx, { door_id: a.door_id, text: a.value }, opts); // the same note, by the other door
      const id = a.door_id ?? null;
      if (id != null && !doorOf(ctx, id)) return noDoor(id);
      const key = writableKey(a.field);
      if (!key) return { ok: false, error: `the agent can't keep "${clip(a.field, 40)}"` };
      const [slot] = key.split(".");
      const source = AGENT_WRITABLE[key].source;
      // corrected: only when the rep explicitly asked for the change in this very message
      if (source === "corrected" && !(a.correction === true && isCorrection(opts.words))) return { ok: false, error: `${a.field} is changed only when the rep asks for it` };
      if (!id && !/^rule\./.test(a.field)) return { ok: false, error: `${a.field} needs a door_id` };
      // R9 free models: Llama sends a contact as value "Dana" (+ role beside it); the slot takes {name, role}
      // live check: Llama 3.3 70b sends an object value as a JSON string ('{"name": "Dana", "role": "manager"}'); it was
      // kept whole as the name and failed the own-words check every time
      const raw = typeof a.value === "string" && /^\s*\{[\s\S]*\}\s*$/.test(a.value) ? (() => { try { return JSON.parse(a.value); } catch { return a.value; } })() : a.value;
      let value = a.field === "contact" && typeof raw === "string" ? { name: raw, ...(ROLES.includes(String(a.role ?? "").toLowerCase()) ? { role: String(a.role).toLowerCase() } : {}) } : raw;
      // ---- R9 red team: what the rep "stated" must be in the rep's words (a name: all of it; a phrase: most of it) ----
      if (judged(opts)) {
        const w = opts.words;
        const unsaid = { ok: false, error: `the rep didn't say that: keep ${a.field} only in the rep's own words` };
        if (a.field === "contact") {
          const name = nameFrom(value?.name, ctx, w);
          if (!name) return unsaid;
          value = { ...value, name };
        } else if (["said", "carry"].includes(a.field) && !grounded(value, w, 2 / 3)) return unsaid;
        else if (a.field === "objection" && value?.words != null && !grounded(value.words, w, 2 / 3)) return unsaid;
        else if (a.field === "rule.avoid" && !grounded(value, w)) return unsaid;
        else if (a.field === "rule.term" && !(grounded(value?.from, w) && grounded(value?.to, w))) return unsaid;
      }
      // ---- end R9 red team ----
      const record = makeRecord({ slot, field: a.field, value: typeof value === "string" ? clip(value, 2000) : value, source, by: opts.by ?? "agent", words: clip(opts.words, 400) || null, at: opts.now ?? null, confirmed: false });
      const v = validateRecord(record, { agent: true });
      if (!v.ok) return { ok: false, error: v.reason };
      return { ok: true, actions: [{ type: "slot", id: /^rule\./.test(a.field) ? "*" : id, record }], data: { kept: a.field } };
    }
    default:
      return { ok: false, error: `no tool called ${clip(name, 40)}` };
  }
}

// Who a room's crowd note names (Qloo's own words, matched): the city-crowd answer sums these over the top rooms.
const CROWDS = [
  ["local residents", /\blocal(?:s| residents| neighbou?rhood| crowd| [A-Z]\w+ residents)\b|\bneighbou?rhood (?:crowd|regulars)\b/i],
  ["young professionals", /\b(?:young |local )?professionals\b/i],
  ["groups of friends", /\bgroups? of friends\b|\bfriend groups\b/i],
  ["tourists", /\btourists?\b|\bvisitors\b/i],
  ["craft beer fans", /\b(?:craft )?beer (?:enthusiasts|lovers|fans|drinkers|culture)\b/i],
  ["families", /\bfamil(?:y|ies)\b|\bparents\b/i],
  ["young adults", /\byoung adults\b|\byounger crowd\b|\bcollege students\b|\bstudents\b/i],
  ["couples", /\bcouples\b|\bdate (?:night|spot)\b/i],
  ["sports fans", /\bsports fans\b|\b(?:avid|die-hard) \w+ fans\b/i],
  ["dog owners", /\b(?:dog|pet) owners\b/i],
  ["cocktail fans", /\bcocktail (?:enthusiasts|lovers|fans)\b|\bspirits enthusiasts\b/i],
];
const NOT_A_BAR = /\b(diner|caf[eé]|coffee|bakery|breakfast|brunch|deli|donut|doughnut|juice|tea house|grocery|market)\b/i;
const listOf = (xs) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
// Text cut at a sentence end within n characters, else at a word with "…": never mid-word
export function sentences(text, n = 240) {
  const t = clip(text, 2000);
  if (t.length <= n) return t;
  const cut = t.slice(0, n);
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  if (end >= 40) return cut.slice(0, end + 1);
  return `${cut.slice(0, cut.lastIndexOf(" ")).replace(/[,;:\s]+$/, "")}…`;
}

// ---- Doors Agent abilities 1 and 2 (spec §5): brief me on this door, prep my day ----
// Qloo's genre tag as words ("urn:tag:genre:place:restaurant:cocktail_bar" → "cocktail bar")
export const kindOf = (genre) => clip(String(genre ?? "").split(":").pop().replace(/_/g, " "), 40) || null;
// an arrival as a person says it ("a little after 1 pm", Jard 10-24 #5): the model repeats what the tool gives it
const etaSay = (hhmm) => (minOf(hhmm) == null ? null : humanTime(minOf(hhmm), { ampm: true }));
const minOf = (hhmm) => (/^\d{1,2}:\d{2}$/.test(String(hhmm ?? "")) ? Number(hhmm.split(":")[0]) * 60 + Number(hhmm.split(":")[1]) : null);
const loggedText = (v) => (v?.status === "notfit" ? "not a fit" : v?.outcome?.result ? RESULT_TEXT[v.outcome.result] ?? v.outcome.result : v?.status ? "visited" : null);
// A stop's flags for the day: why it may be weak (each a plain reason), from Doors' own numbers only
export function stopFlags(ctx, st) {
  const v = doorOf(ctx, st.id);
  const out = [];
  if (!v) return out;
  if (v.status === "notfit" || v.outcome?.result === "no") out.push("you logged a no here");
  if (v.rank && v.N && v.rank > (v.N * 2) / 3) out.push(`#${v.rank} of ${v.N}: the bottom third of your list`);
  if (NOT_A_BAR.test(`${v.name} ${v.genre ?? ""}`)) out.push(`a ${kindOf(v.genre) ?? "door"} with no bar to sell into`);
  const eta = minOf(st.eta);
  let until = minOf(st.until);
  if (eta != null && until != null) {
    if (until <= eta && until < 6 * 60) until += 1440; // closes after midnight
    if (until - eta < 60) out.push(`closes at ${clock12(st.until)}, ${Math.max(0, until - eta)} min after you arrive`);
  }
  return out;
}
// the place rows the crowd / ambience / good-for facts don't already cover, and what Qloo field each comes from
const PLACE_FACT = ["when", "room", "pours", "into", "music"];
const PLACE_SOURCE = { when: "time of day and visit tags", room: "ambience tags", pours: "beverage tags", into: "interest tags", music: "the crowd's artists" };
function briefDoor(ctx, id) {
  const v = doorOf(ctx, id);
  if (!v) return noDoor(id);
  // group 3 #7: the door's place picture (lib/place.js rows, carried by agent-context.js): each row is a Qloo fact the
  // briefing may use, shown under the answer with its source
  const place = Object.entries(v.place ?? {}).filter(([, t]) => t).map(([key, text]) => ({ key, label: PLACE_LABELS[key] ?? key, text }));
  const facts = [...doorFacts(ctx, id), ...place.filter((r) => PLACE_FACT.includes(r.key)).map((r) => ({ text: `${r.label}: ${clip(r.text, 200).replace(/\.$/, "")}.`, source: src("qloo", `place.${r.key}`, id, ctx, qlooLabel(PLACE_SOURCE[r.key], v.captured ?? null), v.captured ?? null) }))];
  const t = v.talk;
  const pushback = (t?.pushback ?? []).map((reply, i) => ({ objection: t.objections?.[i] ?? "", reply })).filter((x) => x.reply).slice(0, 4);
  const st = (ctx.day?.stops ?? []).find((x) => x.id === id);
  const data = {
    name: v.name, kind: kindOf(v.genre),
    about_the_place: place.length ? [...(v.crowd ? [`${PLACE_LABELS.who}: ${sentences(v.crowd, 200)}`] : []), ...place.map((r) => `${r.label}: ${r.text}`)] : "Qloo has little on this door beyond its crowd line: brief from that, its hours and its notes",
    facts: facts.map((f) => f.text),
    ...(ctx.profile?.product ? { product_details: ctx.profile.product } : {}),
    ...(st?.eta ? { arrive: etaSay(st.eta) } : {}),
    hours: v.hours || null,
    ...(t ? { opener: t.opener || null, questions: (t.questions ?? []).slice(0, 3), ask: t.ask || null, pushback } : { talking_points: "none for this door here: write the opener and the ask from the trade" }),
    ...(st ? { flags: stopFlags(ctx, st) } : {}),
    logged: loggedText(v),
    menu: "Doors has no menu or tap list for this door: say so in one clause and give the question to ask at the door, or cite its own page if you looked it up",
  };
  return { ok: true, facts, data };
}
function prepDay(ctx) {
  const stops = ctx.day?.stops ?? [];
  if (!stops.length) return { ok: true, facts: [], data: { answer: "The app is on no day with stops: ask the rep to open a day of the plan." } };
  const w = (ctx.windows ?? []).find((x) => x.date === ctx.day.date);
  const rows = stops.map((st, i) => {
    const v = doorOf(ctx, st.id);
    const done = loggedText(v);
    return { stop: i + 1, door_id: st.id, name: v.name, eta: st.eta ? etaSay(st.eta) : null, open_till: st.until ? clock12(st.until) : null, rank: v.rank && v.N ? `#${v.rank} of ${v.N}` : null, kind: kindOf(v.genre), ...(v.crowd ? { crowd: sentences(v.crowd, 140) } : {}), ...(done ? { logged: done } : { flags: stopFlags(ctx, st), ...(minOf(st.eta) != null && minOf(ctx.now) != null && ctx.day.date === ctx.today && minOf(st.eta) < minOf(ctx.now) ? { eta_passed: true } : {}) }), ...(v.notes?.length ? { notes: v.notes.slice(0, 2).map((n) => clip(n.text, 120)) } : {}) };
  });
  const open = rows.filter((r) => !r.logged);
  const rankOf = (r) => doorOf(ctx, r.door_id)?.rank ?? 1e9;
  const lead = [...open].sort((a, b) => rankOf(a) - rankOf(b)).slice(0, 3);
  const weak = open.filter((r) => r.flags?.length);
  // better-ranked doors off this day, not yet visited and not stopped by a gate (on another day, or in the pool)
  const onDay = new Set(stops.map((x) => x.id));
  const worst = weak.length ? Math.max(...weak.map(rankOf)) : null;
  const swaps = worst == null ? [] : Object.entries(ctx.doors ?? {}).filter(([id, v]) => !onDay.has(id) && !v.status && !v.outcome && Number.isFinite(v.rank) && v.rank < worst && v.plan?.on !== false && !NOT_A_BAR.test(`${v.name} ${v.genre ?? ""}`))
    .sort((a, b) => a[1].rank - b[1].rank).slice(0, 3)
    .map(([id, v]) => ({ door_id: id, name: v.name, rank: v.N ? `#${v.rank} of ${v.N}` : `#${v.rank}`, kind: kindOf(v.genre), plan: v.plan ? `${v.plan.head} ${v.plan.reason}` : "in the ranked list, not on a day" }));
  const facts = [{ text: `${niceDate(ctx.day.date)}: ${stops.length} stops${w?.from && w?.to ? `, ${clock12(w.from)} to ${clock12(w.to)}` : ""}${open.length < rows.length ? `, ${rows.length - open.length} already logged` : ""}. Doors orders the day by driving time and opening hours, not by rank.`, source: src("plan", "day", null, ctx, "Doors' route", null) }];
  const seen = new Set();
  for (const r of [...lead, ...weak]) if (!seen.has(r.door_id) && seen.add(r.door_id)) facts.push(...doorFacts(ctx, r.door_id).filter((f) => f.source.field === "rank"));
  return { ok: true, facts: facts.slice(0, 8), data: { day: niceDate(ctx.day.date), hours: w?.from && w?.to ? `${clock12(w.from)} to ${clock12(w.to)}` : null, stops: rows, lead_hardest: lead.map((r) => r.name), weak: weak.map((r) => ({ name: r.name, why: r.flags })), swaps, now: ctx.day.date === ctx.today && ctx.now ? clock12(ctx.now) : null, note: "Suggest swaps; make one only if the rep asks (replan skip + add). eta_passed: the route's arrival time is behind now (offer to re-plan from now)" } };
}
// ---- end abilities 1 and 2 ----

// ---- Doors Agent ability 4 (spec §5): draft the follow-up. Doors never sends: the draft opens in the rep's own app ----
// The model writes the message; code adds the greeting (the contact's first name, known to the Worker, never to the
// model) and the rep's sign-off ("Sign your notes as"), and refuses a draft that offers something of value.
export const OFFERS_VALUE = /\b(free|comp(?:ed|s|ing)?|on the house|no charge|gratis)\b[^.!?]{0,30}\b(cases?|kegs?|sixtels?|product|rounds?|bottles?|cans?|goods|drinks?|samples? for (?:the )?staff)\b|\b(rebates?|kickbacks?|cash|gift cards?|paid placement|exclusive)\b/i;
export const contactOf = (ctx, id) => {
  const v = doorOf(ctx, id);
  const slot = (ctx.envelopes?.[id]?.slots ?? []).filter((r) => r.field === "contact").at(-1)?.value;
  const name = (typeof slot === "string" ? slot : slot?.name) || v?.outcome?.who || "";
  return /^(the )?(manager|owner|bartender|buyer|gm|host|chef|bar manager|general manager|beverage director)$/i.test(String(name).trim()) ? "" : String(name).trim();
};
function draftFollowUp(ctx, a) {
  const v = doorOf(ctx, a.door_id);
  if (!v) return noDoor(a.door_id);
  if (!["email", "text"].includes(a.channel)) return { ok: false, error: "channel must be email or text" };
  let body = String(a.body ?? "").replace(/<[^>]*>/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, 900);
  if (body.length < 20) return { ok: false, error: "the draft is empty: write the message" };
  if (/[*_#`]|https?:/.test(body)) return { ok: false, error: "plain text only: no markup or links. Write it again." };
  if (OFFERS_VALUE.test(`${body} ${a.subject ?? ""}`)) return { ok: false, error: "that draft offers something of value for the placement (tied-house rules): write it again without it" };
  const first = firstName(contactOf(ctx, a.door_id));
  // the model saw "the contact" for every name: the door's contact goes back in, else the sentence reads "you"
  body = body.replace(/^(hi|hey|hello|dear)\b[^\n,]*,?\s*/i, "").replace(/\n*(thanks|thank you|cheers|best|talk soon)?[,!.]?\s*(–|-|—)?\s*(the contact)?\s*$/i, (m, t, d, c) => (t ? `\n\n${t[0].toUpperCase()}${t.slice(1)},` : c || d ? "." : m)).replace(/\bthe contact\b/gi, first || "you").trim();
  const sign = [String(ctx.profile?.signAs ?? "").trim(), String(ctx.profile?.brand ?? "").trim()].filter(Boolean);
  const hello = first ? `Hi ${first},` : "Hi there,";
  const text = a.channel === "text" ? `${hello} ${body.replace(/\s*\n+\s*/g, " ")}${sign.length ? ` – ${sign[0]}${sign[1] && sign[1] !== sign[0] ? `, ${sign[1]}` : ""}` : ""}` : `${hello}\n\n${body}${/,$/.test(body) ? "\n" : "\n\n"}${sign.join("\n")}`.trim();
  if (a.channel === "text" && text.length > SMS_MAX) return { ok: false, error: `too long for a text (${text.length} of ${SMS_MAX} characters with the greeting and sign-off): write it shorter` };
  const subject = a.channel === "email" ? clip(a.subject, 90) || `Following up from ${ctx.profile?.brand || "my visit"}` : null;
  const note = { subject: subject ?? "", body: text, sms: text };
  const draft = { id: a.door_id, name: v.name, channel: a.channel, ...(subject ? { subject } : {}), body: text, href: a.channel === "email" ? mailtoHref(note) : smsHref(note, null) };
  return { ok: true, drafts: [draft], data: { drafted: a.channel, to: v.name, note: "the draft shows under your reply with a button that opens the rep's own app; Doors never sends it. Say in a few words that it's ready to send from their phone; don't repeat the draft." } };
}
// ability 4: the reply's follow-up draft, only as a mailto: or sms: link (never a send)
export function draftOf(r) {
  const d = (r?.drafts ?? [])[0];
  if (!d || !/^(mailto|sms):/.test(String(d.href ?? "")) || !["email", "text"].includes(d.channel)) return null;
  return { id: String(d.id ?? ""), name: String(d.name ?? "").slice(0, 80), channel: d.channel, ...(d.subject ? { subject: String(d.subject).slice(0, 90) } : {}), body: String(d.body ?? "").slice(0, 1200), href: String(d.href).slice(0, 4000) };
}
// ---- end ability 4 ----

// ---- Doors Agent abilities 5 and 7 (spec §5): what to bring, plan the next trip ----
// What the rep promised a door: kept "carry" items, and notes or the visit's words that sound like a promise
export function promisesOf(ctx, id) {
  const v = doorOf(ctx, id);
  const kept = (ctx.envelopes?.[id]?.slots ?? []).filter((r) => r.field === "carry" && typeof r.value === "string").map((r) => clip(r.value, 120));
  const said = [...(v?.notes ?? []).map((n) => n.text), v?.outcome?.note].filter((t) => typeof t === "string" && PROMISE.test(t)).map((t) => clip(t, 160));
  return [...new Set([...kept, ...said])].slice(0, 4);
}
// The kit a door's type wants (the trade brief's "What to bring"), in a line
const KIT = [
  [/brewery|brewpub|taproom|brewing/i, "cans for the cooler, not a tap ask: a brewery pours its own beer"],
  [/cocktail|lounge|speakeasy/i, "one familiar drink and one that shows range, if your product goes in a cocktail; else frame it as the drink for guests who aren't drinking"],
  [/restaurant|kitchen|bistro|grill|cafe|diner/i, "a line on what it pairs with on their menu"],
  [/bar|pub|tavern|saloon|dive/i, "cold cans for a taste at the bar"],
];
// Qloo's door type decides; the name only when there is no type ("G & S Lounge" is a dive bar, not a cocktail lounge)
const kitFor = (v) => (KIT.find(([re]) => re.test(kindOf(v?.genre) ?? "")) ?? KIT.find(([re]) => !kindOf(v?.genre) && re.test(v?.name ?? "")) ?? [null, "cold samples for a taste"])[1];
function whatToBring(ctx) {
  const stops = (ctx.day?.stops ?? []).filter((st) => { const v = doorOf(ctx, st.id); return v && !v.status && !v.outcome; });
  if (!stops.length) return { ok: true, facts: [], data: { answer: "No doors left to visit on the day the app is on: ask the rep to open a day of the plan." } };
  const doors = stops.map((st) => {
    const v = doorOf(ctx, st.id);
    const promised = promisesOf(ctx, st.id);
    const back = v.notes?.length || (ctx.envelopes?.[st.id]?.slots ?? []).some((r) => r.field === "contact");
    return { door_id: st.id, name: v.name, eta: st.eta ? etaSay(st.eta) : null, kind: kindOf(v.genre), kit: kitFor(v), ...(promised.length ? { promised } : {}), ...(back ? { return_visit: true } : {}) };
  });
  const facts = [{ text: `${niceDate(ctx.day.date)}: ${doors.length} doors still to visit. Bring a sample for each, plus a spare.`, source: src("plan", "day", null, ctx, "Doors' route", null) }];
  for (const d of doors) for (const p of d.promised ?? []) facts.push({ text: `${d.name}: you said “${p}”.`, source: src("stated", "note", d.door_id, ctx, "your note", null) });
  return { ok: true, facts: facts.slice(0, 8), data: { day: niceDate(ctx.day.date), samples: doors.length + 1, every_door: "cold samples (within your state's sample limits), a one-page sell sheet, the price sheet with price_math done", doors, note: "Lead with what the rep promised; then the kit by door. Never free product for staff or for the placement." } };
}
const RANK_RESULT = { interested: 1, followup: 2, someone: 3, known: 4, visited: 4, no: 6 };
function nextTrip(ctx) {
  const all = Object.entries(ctx.doors ?? {});
  const later = (ctx.windows ?? []).map((w) => w.date).filter((d) => d > (ctx.today ?? "")).sort();
  const visited = all.filter(([, v]) => v.status || v.outcome?.result);
  const rows = visited.map(([id, v]) => {
    const r = v.status === "notfit" ? "notfit" : v.outcome?.result ?? (v.status === "talked" ? "known" : "visited");
    const days = [...(v.notes ?? []).map((n) => n.text), v.outcome?.note].map((t) => weekdayIn(String(t ?? ""))).filter(Boolean);
    const when = r === "followup" && v.outcome?.followUp ? `booked: follow up ${niceDate(v.outcome.followUp)}`
      : r === "interested" ? `within the week${later[0] ? ` (next plan day ${niceDate(later[0])})` : ""}: go back for the first order`
      : r === "someone" ? `when the buyer is in${days[0] ? ` (your notes say ${days[0][0].toUpperCase()}${days[0].slice(1)})` : ": ask for their best time"}`
      : r === "known" ? "you know them already: go back with the ask"
      : r === "visited" ? `next time you're nearby: get the buyer's name and best time`
      : r === "no" ? "leave it for a couple of months, then try with something new to say"
      : "not a fit: leave it off";
    return { door_id: id, name: v.name, logged: r === "notfit" ? "Not a fit" : r === "known" ? "Already know them" : RESULT_TEXT[r] ?? "Just visited", when, ...(v.outcome?.note ? { said: clip(v.outcome.note, 160) } : {}), ...(promisesOf(ctx, id).length ? { promised: promisesOf(ctx, id) } : {}), order: RANK_RESULT[r] ?? 9, rank: v.rank ?? null };
  }).sort((a, b) => a.order - b.order || (a.rank ?? 1e9) - (b.rank ?? 1e9));
  const go = rows.filter((r) => r.order <= 4).map(({ order, ...r }) => r);
  const leave = rows.filter((r) => r.order > 4).map(({ order, rank, ...r }) => r);
  const fresh = all.filter(([, v]) => !v.status && !v.outcome && Number.isFinite(v.rank) && v.plan?.on !== false).sort((a, b) => a[1].rank - b[1].rank).slice(0, 3).map(([id, v]) => ({ door_id: id, name: v.name, rank: v.N ? `#${v.rank} of ${v.N}` : `#${v.rank}`, plan: v.plan ? `${v.plan.head} ${v.plan.reason}` : null }));
  if (!rows.length) return { ok: true, facts: [], data: { answer: "No visits logged yet, so there's no second visit to plan. The best first visits:", first_visits: fresh } };
  const facts = visited.flatMap(([id]) => doorFacts(ctx, id).filter((f) => f.source.field === "outcome")).slice(0, 8);
  return { ok: true, facts, data: { go_back: go, leave_for_now: leave, first_visits: fresh, plan_days_ahead: later.map(niceDate), note: "Suggest the order and the day; move or add doors only if the rep asks (replan)." } };
}
// ---- end abilities 5 and 7 ----

function askCity(ctx, topic) {
  const cd = ctx.cityData ?? {};
  const city = ctx.city?.name ?? "the city";
  const doors = Object.entries(ctx.doors ?? {}).sort((x, y) => (x[1].rank ?? 1e9) - (y[1].rank ?? 1e9));
  const facts = [];
  if (topic === "sound") {
    if ((cd.citySound ?? []).length) facts.push({ text: `Artists Qloo associates with ${city}: ${cd.citySound.slice(0, 8).map((x) => clip(x, 40)).join(", ")}.`, source: src("qloo", "citySound", null, ctx, qlooLabel(`${city}'s sound`, cd.captured)) });
  } else if (topic === "neighbourhoods") {
    for (const [n, list] of Object.entries(cd.nbhd ?? {}).slice(0, 5)) if (list?.length) facts.push({ text: `${clip(n, 40)}: ${list.slice(0, 4).map((x) => clip(x, 40)).join(", ")}.`, source: src("qloo", "nbhdSound", null, ctx, qlooLabel(`${clip(n, 40)}'s sound`, cd.captured)) });
  } else if (topic === "crowd") {
    // judge pass 3 (N7): first who the best-ranked rooms draw, summed; then the rooms' own words, a drinking room first,
    // each cut at a sentence
    const top = doors.filter(([, v]) => v.crowd && v.rank != null).slice(0, 10);
    const tally = CROWDS.map(([label, re]) => [label, top.filter(([, v]) => re.test(v.crowd)).length]).filter(([, n]) => n >= 2).sort((x, y) => y[1] - x[1]).slice(0, 4);
    if (tally.length) facts.push({ text: `Across your ${top.length} best-ranked doors, Qloo's crowd notes name ${listOf(tally.map(([l, n]) => `${l} (${n})`))}.`, source: src("qloo", "crowd", null, ctx, qlooLabel("customer demographics", cd.captured)) });
    const rooms = doors.filter(([, v]) => v.crowd);
    const drinking = [...rooms.filter(([, v]) => !NOT_A_BAR.test(`${v.name} ${v.genre ?? ""}`)), ...rooms.filter(([, v]) => NOT_A_BAR.test(`${v.name} ${v.genre ?? ""}`))];
    for (const [id, v] of drinking.slice(0, 5)) facts.push({ text: `${v.name}${v.rank ? ` (#${v.rank})` : ""}: "${sentences(v.crowd, 240)}"`, source: src("qloo", "crowd", id, ctx, qlooLabel("customer demographics", v.captured), v.captured) });
  } else if (topic === "doors") {
    for (const [id] of doors.slice(0, 5)) facts.push(...doorFacts(ctx, id).filter((f) => f.source.field === "rank"));
  } else return { ok: false, error: "topic must be crowd, sound, neighbourhoods or doors" };
  if (!facts.length) return { ok: true, facts: [], data: { answer: `Qloo's data here says nothing about ${topic} for ${city}. Say so; don't guess.` } };
  return { ok: true, facts, data: { facts: facts.map((f) => f.text) } };
}

function replan(ctx, a) {
  const ids = (xs, what) => {
    if (xs == null) return [];
    if (!Array.isArray(xs)) throw new Error(`${what} must be a list of door ids`);
    const bad = xs.find((x) => !doorOf(ctx, x));
    if (bad) throw new Error(`"${clip(bad, 60)}" is not a door on this plan`);
    return [...new Set(xs)].slice(0, 20);
  };
  try {
    const act = { type: "replan", skip: ids(a.skip, "skip"), endBy: null, startNow: a.start_now === true, maxDoors: null, lock: ids(a.lock, "lock"), add: ids(a.add, "add"), day: null };
    if (a.end_by != null) {
      if (!isClock(a.end_by)) return { ok: false, error: "end_by must be HH:MM (24 h)" };
      act.endBy = a.end_by;
    }
    if (a.max_doors != null) {
      if (!Number.isInteger(a.max_doors) || a.max_doors < 1 || a.max_doors > 20) return { ok: false, error: "max_doors must be 1 to 20" };
      act.maxDoors = a.max_doors;
    }
    if (a.day != null) {
      if (!(ctx.windows ?? []).some((w) => w.date === a.day)) return { ok: false, error: "day must be one of the plan's days" };
      act.day = a.day;
    }
    // judge pass 6 (#7): "move Bernie's to Tuesday" ({door_id, day} each; the key only when something moves)
    if (a.move != null) {
      if (!Array.isArray(a.move)) return { ok: false, error: "move must be a list of {door_id, day}" };
      const move = [];
      for (const m of a.move.slice(0, 20)) {
        if (!doorOf(ctx, m?.door_id)) return { ok: false, error: `"${clip(String(m?.door_id ?? ""), 60)}" is not a door on this plan` };
        if (!(ctx.windows ?? []).some((w) => w.date === m.day)) return { ok: false, error: "a move's day must be one of the plan's days" };
        move.push({ id: m.door_id, date: m.day });
      }
      if (move.length) act.move = move;
    }
    if (!act.skip.length && !act.lock.length && !act.add.length && !act.endBy && !act.startNow && !act.maxDoors && !act.day && !act.move) return { ok: false, error: "nothing to change: give skip, end_by, start_now, max_doors, lock, add, day or move" };
    const name = (x) => ctx.doors[x].name;
    const said = [act.skip.length && `skip ${act.skip.map(name).join(", ")}`, act.endBy && `finish by ${clock12h(act.endBy)}`, act.startNow && "start from now", act.maxDoors && `at most ${act.maxDoors} doors`, act.lock.length && `keep ${act.lock.map(name).join(", ")} in place`, act.add.length && `add ${act.add.map(name).join(", ")}`, act.move && `move ${act.move.map((m) => `${name(m.id)} to ${niceDate(m.date)}`).join(", ")}`].filter(Boolean).join("; ");
    return { ok: true, actions: [act], data: { asked: said, note: "the app re-plans and shows the new day" } };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// "18:00" → "6 pm", "16:30" → "4:30 pm": the app's own clock words, so the model says them the same way (ease audit #7)
const clock12h = (hhmm) => { const [h, m] = String(hhmm).split(":").map(Number); return `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "am" : "pm"}`; };

// live replay 10-24: Haiku names the line it replaces ("the first pushback line, 'Good: your guests…'") and leaves out
// index: the line whose words it gave (most of them, the best match only), else null
function lineIndex(list, line) {
  if (!Array.isArray(list) || typeof line !== "string" || !line.trim()) return null;
  const text = (x) => (typeof x === "string" ? x : x?.reply ?? x?.text ?? "");
  const score = list.map((x) => (grounded(line, text(x), 0.6) ? normW(line).split(" ").filter((w) => normW(text(x)).split(" ").includes(w)).length : 0));
  const best = Math.max(0, ...score);
  return best > 0 && score.filter((x) => x === best).length === 1 ? score.indexOf(best) : null;
}
function editTalk(ctx, a, opts) {
  const v = doorOf(ctx, a.door_id);
  if (!v) return noDoor(a.door_id);
  if (!SECTIONS.includes(a.section)) return { ok: false, error: `section must be one of ${SECTIONS.join(", ")}` };
  if (!["replace", "add", "remove"].includes(a.op)) return { ok: false, error: "op must be replace, add or remove" };
  const single = SINGLE.includes(a.section);
  const n = lineCount(v.talk, a.section);
  let index = single ? 0 : Number.isInteger(a.index) ? a.index : lineIndex(v.talk?.[a.section], a.line);
  if (a.op === "add") {
    if (single) return { ok: false, error: `${a.section} is one line: use replace` };
    index = n;
  } else if (index == null || index < 0 || index >= Math.max(n, single ? 1 : 0)) {
    // live replay 10-24: Haiku sent a pushback replace with no index, twice: the error names the lines to pick from
    const lines = (v.talk?.[a.section] ?? []).map((x, i) => `${i}: "${clip(typeof x === "string" ? x : x?.reply ?? x?.text ?? "", 60)}"`);
    return { ok: false, error: `${a.op} needs index, 0 to ${Math.max(0, n - 1)} for ${a.section}${lines.length ? ` (${lines.join("; ")})` : ""}: call again with it` };
  }
  if (a.op === "remove") {
    if (single) return { ok: false, error: `${a.section} can't be removed, only replaced` };
    return { ok: true, actions: [{ type: "talk", id: a.door_id, section: a.section, op: "remove", index, text: null, by: "rep" }], data: { removed: `${a.section} line ${index + 1}`, note: "made: the app applies it when you answer, so this turn's tool results still show the old line; tell the rep it's changed" } };
  }
  // R9 red team: "dictated" (the rep's own words skip the guard and are labelled the rep's) only when they are
  const dictated = a.dictated === true && (!judged(opts) || grounded(a.text, opts.words, 0.8));
  const g = talkLineOk(a.text, { section: a.section, dictated, avoid: avoidOf(ctx, a.door_id) });
  if (!g.ok) return { ok: false, error: `that line can't be used: ${g.reason}. Write it again.` };
  return { ok: true, actions: [{ type: "talk", id: a.door_id, section: a.section, op: a.op, index, text: g.text, by: dictated ? "rep" : opts.by === "rules" ? "rules" : "model" }], data: { set: g.text, note: "made: the app applies it when you answer, so this turn's tool results still show the old line; tell the rep it's changed" } };
}

// The model's log_visit, validated, and judged by the rules parser: a day the parser reads from the rep's words wins
// over the model's date (generator ≠ judge).
function logVisit(ctx, a, opts) {
  const v = doorOf(ctx, a.door_id);
  if (!v) return noDoor(a.door_id);
  if (!RESULT_TEXT[a.result]) return { ok: false, error: `result must be one of ${Object.keys(RESULT_TEXT).join(", ")}` };
  const today = ctx.today;
  const o = { result: a.result };
  if (a.follow_up_date != null && a.follow_up_date !== "") {
    if (!isIsoDate(a.follow_up_date) || a.follow_up_date <= today) return { ok: false, error: "follow_up_date must be a real date after today (YYYY-MM-DD)" };
    if (Date.parse(a.follow_up_date) - Date.parse(today) > 60 * 864e5) return { ok: false, error: "follow_up_date is more than 60 days out" };
    o.followUp = a.follow_up_date;
  }
  if (a.follow_up_time) {
    if (!isClock(a.follow_up_time) || !o.followUp) return { ok: false, error: "follow_up_time is HH:MM and needs a follow_up_date" };
    o.followUpTime = a.follow_up_time;
  }
  if (a.result === "followup" && !o.followUp) return { ok: false, error: "a followup needs follow_up_date: ask the rep which day" };
  // R9 free models: a who the rep never said (Llama 8b put the door's name there) is dropped
  const words = String(opts.words ?? "").toLowerCase();
  if (a.who && words.includes(String(a.who).toLowerCase().replace(/^the /, "")) && String(a.who).toLowerCase() !== String(v.name).toLowerCase()) o.who = clip(a.who, 60);
  if (a.note) o.note = clip(repWords(a.note), 500);
  if (!o.note) delete o.note;
  // ---- R9 red team: who and note are the rep's words, never the model's; else the rules reading of them ----
  if (judged(opts)) {
    const w = opts.words;
    const rules = parseVisit(w, { now: { date: today, min: 0 } });
    const who = nameFrom(o.who, ctx, w) ?? (rules.ok ? rules.visit.outcome.who : null);
    // live check 2 (F8): a role alone is kept only when the rep talked to them ("talked to the manager"); "owner wasn't
    // in" made "owner" the contact, and the return opener read "Good to see you again, owner."
    const role = String(who ?? "").trim().toLowerCase().replace(/^(?:the|our|their|an?)\s+/, "");
    const met = ROLES.includes(role) && new RegExp(`\\b(?:talked|spoke|speaking|talking|met|meeting|chatted|saw)\\s+(?:to\\s+|with\\s+)?(?:the\\s+|their\\s+)?${role}\\b`, "i").test(w);
    if (who && (!ROLES.includes(role) || met)) o.who = clip(who, 60);
    else delete o.who;
    if (o.note && !grounded(o.note, w, 2 / 3)) {
      const n = noteOf(w);
      if (n) o.note = clip(n, 500);
      else delete o.note;
    }
  }
  // ---- end R9 red team ----
  // the judge: a day the rep named, read by the rules parser, beats the model's date for it
  const said = opts.words ? parseDate(opts.words, today, { windows: (ctx.windows ?? []).map((w) => w.date) }) : null;
  if (said && o.followUp && said !== o.followUp && said > today) o.followUp = said;
  let status = a.not_a_fit === true && a.result === "no" ? "notfit" : "visited";
  // R9 free models: and yes/no is the rules' call when they read one ("liked it, back Thu" logged as no by Llama 8b;
  // "not a fit" logged as a plain visit by 70b)
  const rules = opts.words ? parseVisit(opts.words, { now: { date: today, min: 0 }, windows: (ctx.windows ?? []).map((w) => w.date) }) : null;
  if (rules?.ok) {
    const r = rules.visit.outcome;
    if ((r.result === "no") !== (o.result === "no")) {
      for (const k of ["followUp", "followUpTime"]) delete o[k];
      Object.assign(o, { result: r.result }, r.followUp ? { followUp: r.followUp } : {}, r.followUpTime ? { followUpTime: r.followUpTime } : {});
    }
    if (rules.visit.status === "notfit" && o.result === "no") status = "notfit";
    // live check 2 (F8): "owner says come back tuesday at 5, interested" was saved as a plain follow-up with no note:
    // the rep's "interested" and their words stand
    if (r.result === "interested" && o.result === "followup") o.result = "interested";
    if (!o.note && r.note && judged(opts)) o.note = clip(r.note, 500);
  }
  o.at = opts.now ?? `${today}T00:00`;
  const memory = memoryFromVisit(o, { by: opts.by ?? "agent", at: Date.parse(o.at) || Date.now() });
  const res = visitResult({ status, outcome: o }, { stop: { id: a.door_id, name: v.name }, next: ctx.next ?? nextStops(ctx, a.door_id), source: opts.by === "rules" ? "rules" : "model", memory });
  return { ok: true, actions: res.actions, result: res, data: { logged: res.say } };
}

// (live F7 on Haiku): a note is the rep's own words, not the model's framing of them: "Rep said: done,
// interested, back Tuesday at 9am." keeps "interested, back Tuesday at 9am." (a "Rep said:" label and the opening
// "done," go; the rest stays as the rep typed it)
export function repWords(text) {
  return String(text ?? "")
    .trim()
    .replace(/^(?:the\s+)?(?:rep|user|you)\s+(?:said|says|noted|reported|mentioned)(?:\s+that)?\s*[:,-]?\s*|^(?:rep|note|notes?)\s*:\s*/i, "")
    .replace(/^["“]([\s\S]*)["”]\.?$/, "$1")
    .replace(/^(?:ok(?:ay)?[,.]?\s*)?(?:done|finished|visited|all done)\s*[,.:;!-]\s*/i, "")
    .trim();
}

// ---- door notes (Jard 2026-10-23) ----
// A note is the rep's words: kept when the rep's message holds most of it (a name the turn redacted to "the contact"
// is given back from that message); never about a person beyond who they are and when they're in (slots.PERSON); one
// note once.
const DRINK_COLOUR = /\b(?:white|black)\s+(?:wine|label|ipa|lager|ale|stout|cherry|tea|box|truffle|currant)s?\b/gi;
function saveNote(ctx, a, opts) {
  const v = doorOf(ctx, a.door_id);
  if (!v) return noDoor(a.door_id);
  let text = clip(repWords(a.text), NOTE_MAX);
  if (text.length < 3) return { ok: false, error: "the note is empty: say what to keep" };
  const w = typeof opts.words === "string" ? opts.words : "";
  if (/\bthe contact\b/i.test(text)) {
    const name = nameFrom("the contact", ctx, w);
    if (!name) return { ok: false, error: "keep the note in the rep's own words" };
    text = text.replace(/\bthe contact\b/gi, name);
  }
  // Privacy: the model saw "a phone number" / "an email address" for the rep's own: the note keeps them (it stays on
  // the rep's device), put back from the rep's message when it gave exactly one
  for (const [ph, re] of [["a phone number", PHONE], ["an email address", EMAIL]]) {
    const got = w.match(re) ?? [];
    if (got.length === 1 && text.includes(ph)) text = text.replace(ph, got[0]);
  }
  if (judged(opts) && !grounded(text, w, 2 / 3)) return { ok: false, error: "the rep didn't say that: a note keeps the rep's own words" };
  if (PERSON.test(text.replace(DRINK_COLOUR, ""))) return { ok: false, error: "Doors keeps no notes about a person's age, gender, origin or background: only who they are and when they're in" };
  if (hasNote(v.notes ?? [], text)) return { ok: true, data: { already: true, note: "that note is already on this door; tell the rep" } };
  const record = makeNote({ text, by: opts.by ?? "agent", words: w || null, at: opts.now ?? null });
  const ok = validateRecord(record, { agent: true });
  if (!ok.ok) return { ok: false, error: ok.reason };
  return { ok: true, actions: [{ type: "slot", id: a.door_id, record }], data: { saved: record.value, door: v.name, note: "saved: tell the rep in a few words that you noted it" } };
}
// ---- end door notes ----

// the stops after this one on its own day that aren't done (the day on screen when the door isn't on another plan day)
export const dayOfDoor = (ctx, id) => (ctx.day?.stops?.some((s) => s.id === id) ? ctx.day : (ctx.days ?? []).find((d) => d?.stops?.some((s) => s.id === id)) ?? ctx.day);
export function nextStops(ctx, id) {
  const stops = dayOfDoor(ctx, id)?.stops ?? [];
  const k = stops.findIndex((s) => s.id === id);
  return stops.slice(k + 1).filter((s) => !doorOf(ctx, s.id)?.status).map((s) => ({ id: s.id, name: doorOf(ctx, s.id)?.name ?? s.name ?? "" }));
}

// ---------- the rep's talking-point edits (the agent's `talk` actions), applied over the stop's own talk ----------
// edits: [{section, op, index, text, by, at}] in the order made. points and pushback keep their shape ({text, fact} /
// {objection, reply}): an edited line is the rep's (fact dropped). Edited lines are marked in `edited` for the stop.
export function applyTalkEdits(talk, edits = []) {
  if (!talk || !edits?.length) return talk;
  const t = { ...talk, questions: [...(talk.questions ?? [])], points: [...(talk.points ?? [])], pushback: [...(talk.pushback ?? [])], edited: { ...(talk.edited ?? {}) } };
  const asLine = (section, text, old) => (section === "points" ? { text } : section === "pushback" ? { objection: old?.objection ?? "", reply: text } : text);
  for (const e of edits) {
    if (!SECTIONS.includes(e?.section)) continue;
    if (SINGLE.includes(e.section)) {
      if (e.op === "replace" && e.text) (t[e.section] = e.text), (t.edited[e.section] = e.by ?? "rep"), (t.editedFrom = { ...(t.editedFrom ?? {}), [e.section]: e.from === "qloo" ? "qloo" : null });
      continue;
    }
    const list = t[e.section];
    if (e.op === "add" && e.text) list.push(asLine(e.section, e.text));
    else if (e.op === "replace" && e.text && e.index >= 0 && e.index < list.length) list[e.index] = asLine(e.section, e.text, list[e.index]);
    else if (e.op === "remove" && e.index >= 0 && e.index < list.length) list.splice(e.index, 1);
    else continue;
    t.edited[e.section] = e.by ?? "rep";
  }
  return t;
}
