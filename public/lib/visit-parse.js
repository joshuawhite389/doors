// The rules reading of "how did it go" (owner review 9, R9 #3; docs/CONTRACTS-R9.md §3.3), said or typed after a
// door: "done, come back Thu at 3, liked it, hesitant about price" → the log-visit result: a status, an outcome
// (lib/outcome.js shape + followUpTime) and a sentence to read back. Rules, not a model: drive mode and the RN app run it
// offline and when the agent is resting; the Worker runs it as the judge of the model's call. The note is the rep's own
// words minus the result, day and time: never a word added. Pure (pass `now`). Covered by test/visit-parse.test.mjs.
import { makeOutcome, outcomeText } from "./outcome.js";
import { niceDate, isoDate } from "./profile.js";
import { clockShort } from "./schedule.js";

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const DAY_RE = "(sun|mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat)(?:day|nesday|sday|rsday|urday)?";
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
// a month's name or its abbreviation, then the day ("Nov 5", "november 5th", "Sept. 3"); never "decided 2"
const MONTH_DAY = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)(?:uary|ruary|ch|il|e|y|ust|t|tember|ober|ember)?\.? (\d{1,2})(?:st|nd|rd|th)?\b/;

const addDays = (date, n) => {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(y, m - 1, d);
  t.setDate(t.getDate() + n);
  return isoDate(t);
};
const weekday = (date) => {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
};

// The date said in the text, from today: "today", "tomorrow", "Thu", "next Thursday", "in 3 days", "next week",
// "Oct 30", "10/30". → "YYYY-MM-DD" or null. An explicit date beats a weekday said with it ("Thursday Nov 5" → Nov 5).
// A bare weekday is the next one after today, or, given the plan's window dates, the first plan day on that weekday
// from then on (said on Tue, "back Wed" with the plan's Wed a week out → that plan day, not this week's off-plan Wed).
export function parseDate(text, today, { windows = [] } = {}) {
  const s = ` ${String(text).toLowerCase()} `;
  if (/\btomorrow\b|\btmrw\b/.test(s)) return addDays(today, 1); // "out today, back tomorrow" → tomorrow
  if (/\btoday\b|\btonight\b|\bthis (afternoon|evening)\b/.test(s)) return today;
  let m = /\bin (\d{1,2}|a|one|two|three|four|five|six|seven) (day|days|week|weeks)\b/.exec(s);
  if (m) {
    const n = { a: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 }[m[1]] ?? +m[1];
    return addDays(today, /week/.test(m[2]) ? n * 7 : n);
  }
  // R9 polish: the explicit date first
  m = MONTH_DAY.exec(s);
  let month;
  let day;
  if (m) (month = MONTHS.indexOf(m[1]) + 1), (day = +m[2]);
  else if ((m = /\b(\d{1,2})\/(\d{1,2})\b/.exec(s))) (month = +m[1]), (day = +m[2]);
  if (month && day >= 1 && day <= 31) {
    const y = +today.slice(0, 4);
    let iso = `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (iso < today) iso = `${y + 1}${iso.slice(4)}`;
    return iso;
  }
  m = new RegExp(`\\b(next )?${DAY_RE}\\b`).exec(s);
  if (m) {
    const want = DAYS.findIndex((d) => d.startsWith(m[2].slice(0, 3)));
    let n = (want - weekday(today) + 7) % 7 || 7;
    if (m[1] && n < 7 && /\bnext week\b/.test(s)) n += 7;
    const date = addDays(today, n);
    // R9 polish: a plan day on that weekday, from the date said on
    const plan = (windows ?? []).filter((d) => typeof d === "string" && d >= date && weekday(d) === want).sort()[0];
    return plan && !(windows ?? []).includes(date) ? plan : date;
  }
  if (/\bnext week\b/.test(s)) return addDays(today, 7);
  return null;
}

// The time said: "at 3", "3pm", "3:30 pm", "noon", "after 4". Bare hours read as business hours (1–7 → pm,
// 8–11 → am). → minutes from midnight or null.
export function parseTime(text) {
  const s = String(text).toLowerCase();
  if (/\bnoon\b|\bmidday\b/.test(s)) return 12 * 60;
  let m = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)/.exec(s);
  if (!m) m = /\b(?:at|after|around|about|by|before|@)\s*(\d{1,2})(?::(\d{2}))?\b(?!\s*(?:day|days|week|weeks|min|minutes|mi|miles|\/))/.exec(s);
  if (!m) return null;
  let h = +m[1];
  const min = m[2] ? +m[2] : 0;
  if (h > 23 || min > 59) return null;
  const ap = m[3]?.[0];
  if (ap === "p" && h < 12) h += 12;
  else if (ap === "a" && h === 12) h = 0;
  else if (!ap && h >= 1 && h <= 7) h += 12;
  return h * 60 + min;
}

const NOTFIT = /\b(not a fit|wrong (place|room|spot)|won'?t carry|wouldn'?t carry|don'?t carry (anything|drinks|beverages|n\/?a|non[- ]?alc)|doesn'?t (do|serve) (drinks|alcohol|beverages))\b/i;
const NO = /\b(not interested|no thanks|no thank you|not for (us|them|me)|said no|turned (us |me )?down|passed|no luck|not buying|no budget|they'?re out)\b/i;
// a bare "no" as its own clause: "already talked to them, no", "No." (not "no one", "no budget": those read above)
const NO_BARE = /(?:^|[,.;:!]\s*|\b(?:said|answer(?:ed)?|it'?s a)\s+)no\s*(?:[,.;!]|$)/i;
const YES = /\b(interested|liked|loved|love(d)? it|keen|into it|wants?|want to|order(ed|ing)?|samples? (left|dropped)|excited|great (convo|conversation|meeting|chat)|good (convo|conversation|meeting|chat)|said yes)\b/i;
const BACK = /\b(come back|coming back|back on|go back|follow[- ]?up|return|call (back|them|him|her)|swing by|stop by|check (back|in)|revisit)\b/i;
const BACK_DAY = new RegExp(`\\bback (next |on )?${DAY_RE}\\b`, "i");
// A deferral is not a yes (judge pass 3, N3): "not now, maybe in spring, too many sodas already" is a pass for now.
// With a day to come back it is a follow-up; with a season or "too many" it is a No (the note keeps their words);
// a bare "not now" / "maybe later" asks which.
const DEFER_HARD = /\b(?:(?:maybe |try |come back |check back )?(?:in|next|this) (?:the )?(?:spring|summer|fall|autumn|winter|season|year)|after the holidays|too many|(?:already )?(?:have|carry|stock|got) (?:too many|enough|plenty)|no room (?:on|for|in)|(?:menu|list|lineup|cooler) is full|not this (?:season|year|month)|not adding)\b/i;
const DEFER_SOFT = /\b(?:not now|not right now|not yet|not at the moment|not today|maybe later|maybe another time|some ?other time|later on|another time)\b/i;
// Not the one who decides (N3): "spoke to the bartender, owner decides", "manager wasn't in", "have to ask the owner".
const ELSEWHERE = /\b(?:(?:owner|manager|buyer|gm|boss)(?:'s| is| was)? (?:decides?|makes? the call|has the final say|calls the shots|(?:was|is|wasn'?t|isn'?t|not) (?:in|there|around|here|available)|off|out)|(?:owner|manager|buyer|gm|boss)'?s (?:call|decision)|(?:has|have|needs?|got) to (?:ask|check with|run it by|talk to) (?:the |their |her |his )?(?:owner|manager|buyer|gm|boss)|(?:pass(?:ing)? it (?:on|along)|passes it on) to (?:the )?(?:owner|manager|buyer|gm|boss)|(?:talked|spoke) (?:to|with) (?:a |the )?(?:bartender|server|staff|barback|host))\b/i;
const BEFORE = /\b(already talked|talked to (them|him|her) (before|already)|spoke (to|with) (them|him|her) (before|already))\b/i;
const SKIP = /\b(closed|shut|nobody (there|home)|no one (there|around)|couldn'?t get in|skip( it| this one)?)\b/i;
// "talked to Sam", "spoke with the bar manager", "left it with Jo", "manager is Dana"
const WHO = /\b(?:talked to|talked with|spoke to|spoke with|left (?:it|samples?|a sample|my card) with|(?:the )?(?:manager|buyer|owner) is)\s+((?:the\s+)?[A-Za-z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*)?)/i;
// When WHO caught a role and no name: "her name is Dana", "Dana is the manager".
// Case-sensitive on the name, so only a capitalised word counts; "She is the manager" is no one.
const NAME_IS = /\b(?:[Hh]er|[Hh]is|[Tt]heir|[Tt]he)\s+name(?:'s|\s+is)\s+([A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*)?)/;
const IS_ROLE = /\b([A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*)?)\s+is\s+(?:the|their|our)\s+(?:bar\s+|general\s+|beverage\s+|bev\s+)?(?:manager|owner|buyer|GM|gm|director)\b/;
const NOT_NAME = /^(she|he|they|it|this|that|who|nobody|someone|somebody|everyone|there|today|yesterday|i|we|you)$/i;
function nameIs(raw) {
  const m = NAME_IS.exec(raw) ?? IS_ROLE.exec(raw);
  if (!m) return "";
  const words = m[1].split(/\s+/);
  while (words.length && NOT_NAME.test(words[0])) words.shift();
  return nameOf(words.join(" "));
}
const BUYER = /^(the\s+)?(buyer|owner|gm|general manager|beverage director|bev director|bar manager|manager|decision[- ]maker)$/i;
const VAGUE = /^(the\s+)?(them|him|her|someone|somebody|staff|bartender|a bartender|it|before|already)$/i;
// The person's name out of what WHO caught: WHO is case-insensitive, so its second word can catch filler ("Sam the
// manager" → "Sam the") or a role ("the manager Sam"). Filler and role words around the name are dropped; a role
// with no name ("the bar manager") is no name (BUYER reads it). Reported by doors-rn, 2026-10-22.
const FILLER = /^(the|a|an|and|but|who|about|re|on|at|from|of|them|him|her|someone|somebody|it|before|already|again)$/i;
const ROLE_WORD = /\b(manager|owner|buyer|gm|bartender|director|bev|beverage|general|bar|head|lead|server|staff)\b/i;
export function nameOf(said) {
  const words = String(said ?? "").split(/\s+/).filter(Boolean).filter((w) => !FILLER.test(w) && !ROLE_WORD.test(w));
  // a second word counts only when it is capitalised ("Sam Lee"), so dictation's "Sam come back…" is Sam
  return words.filter((w, i) => i === 0 || /^[A-Z]/.test(w)).join(" ");
}

// Is this "skip this one" rather than a visit? (closed, nobody there.) Drive mode moves the door to the end of today.
export const isSkip = (text) => SKIP.test(String(text ?? "")) && !YES.test(String(text ?? "")) && !BACK.test(String(text ?? ""));

// The rep's words with the result, the day and the time taken out: "done, back Thu 3pm, liked it, hesitant about
// price" → "liked it, hesitant about price". Never adds a word; when nothing is left, no note.
export function noteOf(text, { stop = null } = {}) {
  let s = ` ${String(text ?? "")} `;
  // "done at Easy Does It, …": the door's name is where, not what they said (judge pass 3, N5)
  const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (stop?.name) s = s.replace(new RegExp(`^\\s*(ok(ay)?[,.]?\\s*)?(done|finished|visited|all done|left)\\s+(at|with)\\s+(the\\s+)?${esc(String(stop.name))}\\b[,.:;!]?`, "i"), " ");
  s = s.replace(/^\s*(ok(ay)?[,.]?\s*)?(done|finished|visited|all done)\s+at\s+(?![^,.;]*\d)[^,.;]{1,60}[,.;]/i, " ");
  s = s.replace(/^\s*(ok(ay)?[,.]?\s*)?(done|finished|visited|all done)\b[,.:;!]?/i, " ");
  // judge pass 4 (#17): a vague when ("next week", "in two weeks") goes only with the back words it belongs to ("come
  // back next week"); after another verb it is what they said ("call next week") and stays in the note
  const vague = "next week|in (?:\\d{1,2}|a|one|two|three|four|five|six|seven|a few|a couple(?: of)?) (?:days?|weeks?)";
  s = s.replace(new RegExp(`\\b(?:come back|coming back|go back|back|follow[- ]?up|swing by|stop by|check back|revisit)\\s+(?:${vague})\\b`, "gi"), " ");
  const date = new RegExp(`\\b(next |on |this )?(${DAY_RE}|today|tomorrow|tmrw|(${MONTHS.join("|")})[a-z]*\\.? \\d{1,2}(st|nd|rd|th)?|\\d{1,2}\\/\\d{1,2})\\b`, "gi");
  const time = /\b((at|after|around|about|by|before|@)\s*)?\d{1,2}(:\d{2})?\s*(am|pm|a\.m\.|p\.m\.)|\b(at|after|around|about|by|@)\s*\d{1,2}(:\d{2})?\b|\b(at |around )?(noon|midday)\b/gi;
  const back = /\b(come back|coming back|go back|back|follow[- ]?up|swing by|stop by|check back|revisit)\b/gi;
  s = s.replace(time, " ").replace(date, " ").replace(back, " ");
  return s
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;!?])/g, "$1")
    .replace(/([,;.])(\s*[,;.])+/g, "$1")
    .replace(/^[\s,.;:!-]+|[\s,;:-]+$/g, "")
    .replace(/,?\s*\b(?:said|told (?:me|us)|asked (?:me|us)|wants (?:me|us)|want (?:me|us))?\s*to$/i, "") // "said to [come back next week]"
    .trim()
    .slice(0, 500);
}

const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const fail = (error, ask) => ({ v: 1, ok: false, error, ask, source: "rules" });

// Dictation (Web Speech, the phone) → the words the parser reads (Jard's Safari check, 2026-10-22):
// spoken times become digits ("at three thirty" → "at 3:30", "half past three" → "3:30", "three p.m." / "three in the
// afternoon" → "3 pm", "three o'clock" → "3"), and a run with no punctuation is split into clauses before the words a
// rep starts a new thought with ("come back thursday at 3 liked it hesitant about price" → "… at 3, liked it,
// hesitant about price"). Typed text with commas is left as typed. Never adds a word.
const NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const MINS = { "oh five": 5, ten: 10, fifteen: 15, twenty: 20, "twenty five": 25, thirty: 30, "thirty five": 35, forty: 40, "forty five": 45, "forty-five": 45, fifty: 50, "fifty five": 55 };
const NUMW = Object.keys(NUM).join("|");
const MINW = Object.keys(MINS).sort((a, b) => b.length - a.length).join("|");
const CLAUSE = /\s(?=(?:liked|loved|interested|hesitant|worried|concerned|wants|wanted|asked|talked|spoke|left|needs|busy|maybe|price|pricing|not interested|no budget|said)\b)/gi;
const JOIN = /\b(not|very|really|was|is|were|are|and|but|or|so|the|a|to|it's|be|seemed|seems|super|kinda|pretty|they|she|he|we|i|who|if|about|of|on|with|for|in|over|re|the)$/i;
export function spoken(text) {
  let s = String(text ?? "");
  const h = (w) => NUM[w.toLowerCase()];
  const mm = (w) => String(MINS[w.toLowerCase().replace(/-/g, " ")] ?? MINS[w.toLowerCase()]).padStart(2, "0");
  s = s.replace(new RegExp(`\\b((?:at|after|around|about|by|before) )?half past (${NUMW})\\b`, "gi"), (_, p, w) => `${p ?? "at "}${h(w)}:30`);
  s = s.replace(new RegExp(`\\b((?:at|after|around|about|by|before) )?quarter past (${NUMW})\\b`, "gi"), (_, p, w) => `${p ?? "at "}${h(w)}:15`);
  s = s.replace(new RegExp(`\\b((?:at|after|around|about|by|before) )?quarter to (${NUMW})\\b`, "gi"), (_, p, w) => `${p ?? "at "}${h(w) === 1 ? 12 : h(w) - 1}:45`);
  s = s.replace(new RegExp(`\\b(at|after|around|about|by|before) (${NUMW}) (${MINW})\\b`, "gi"), (_, p, w, m) => `${p} ${h(w)}:${mm(m)}`);
  s = s.replace(new RegExp(`\\b((?:at|after|around|about|by|before) )?(${NUMW}|\\d{1,2})\\s*o'?clock\\b`, "gi"), (_, p, w) => `${p ?? "at "}${NUM[w.toLowerCase()] ?? w}`);
  s = s.replace(new RegExp(`\\b(${NUMW}|\\d{1,2}(?::\\d{2})?)\\s*(p\\.?m\\.?|a\\.?m\\.?)(?=\\s|$|[,.;!?])`, "gi"), (_, w, ap) => `${NUM[w.toLowerCase()] ?? w} ${ap[0].toLowerCase()}m`);
  s = s.replace(new RegExp(`\\b(${NUMW}|\\d{1,2}(?::\\d{2})?)\\s+in the (afternoon|evening)\\b`, "gi"), (_, w) => `${NUM[w.toLowerCase()] ?? w} pm`);
  s = s.replace(new RegExp(`\\b(${NUMW}|\\d{1,2}(?::\\d{2})?)\\s+in the morning\\b`, "gi"), (_, w) => `${NUM[w.toLowerCase()] ?? w} am`);
  s = s.replace(new RegExp(`\\b(at|after|around|about|by|before) (${NUMW})\\b`, "gi"), (_, p, w) => `${p} ${h(w)}`);
  if (!/[,.;!?]/.test(s)) {
    s = s.replace(/(\b(?:at|after|around|about|by|before) \d{1,2}(?::\d{2})?(?: [ap]m)?)\s(?=[a-z])(?![ap]m\b)/gi, "$1, ");
    s = s.replace(CLAUSE, (m0, off, all) => (JOIN.test(all.slice(0, off).trim()) || /,$/.test(all.slice(0, off)) || off === 0 ? m0 : ", "));
    s = s.replace(/^\s*,\s*/, "");
  }
  return s;
}

// Text → the log-visit result (docs/CONTRACTS-R9.md §3.1) with source "rules", or {ok:false, error, ask} when it can't
// be read safely (no result at all). stop = {id, name}; now = {date, min}; windows = the plan's window dates; next =
// the day's remaining stops [{id, name}] in order (optional: names the next door).
// A question, not a report: "what should I say… wait for the owner to call back next week" holds visit words ("back
// next") but logs nothing. Chat answers it; a visit log asks how it went.
// Anywhere: a "?" or words a report never uses. At the start only: short asks that a report can quote ("she said can I
// come back Thursday" is a visit).
const QUESTION = /\?|\b(?:wondering|i wonder|what should (?:i|we)|how (?:do|should) (?:i|we)|any (?:tips|advice|ideas)|help me (?:with|figure|decide|say)|tips? (?:on|for)|advice (?:on|for))\b/i;
const ASKS = /^(?:(?:hey|so|ok(?:ay)?|um+|uh+|quick question)[,\s]+)*(?:should|can|could|would|do|does|is|are|what|why|how(?! it went))\b/i; // not "when I got there…": a report
export const isQuestion = (text) => QUESTION.test(String(text ?? "")) || ASKS.test(String(text ?? "").trim());

export function parseVisit(text, { stop = null, now = null, windows = [], next = [] } = {}) {
  const raw = spoken(String(text ?? "").replace(/\s+/g, " ").trim()).slice(0, 400);
  if (!raw) return fail("Nothing said.", "How did it go?");
  if (isQuestion(raw)) return fail("That reads as a question, not how the visit went.", "Ask that in Doors Agent. Here, say how it went: interested, follow up, or not interested?");
  const today = now?.date ?? isoDate(new Date());
  const wins = [...new Set((windows ?? []).filter(Boolean))].sort();
  let date = parseDate(raw, today, { windows: wins });
  if (/\bnext week\b/.test(raw.toLowerCase()) && !new RegExp(`\\b${DAY_RE}\\b`, "i").test(raw)) date = wins.find((d) => d >= addDays(today, 7)) ?? addDays(today, 7);
  const time = parseTime(raw);
  const back = BACK.test(raw) || BACK_DAY.test(raw);
  const whoM = WHO.exec(raw);
  const said = whoM ? whoM[1].trim().replace(/\s+(and|but|who|about|re|on)$/i, "") : "";
  let who = nameOf(said);
  // "the manager is busy at the bar": after "is" a lowercase word is how they are, not who (doors-rn, iPhone XS,
  // 2026-10-22). Dictation capitalises names, so "manager is Dana" still counts.
  if (whoM && /\bis$/i.test(whoM[0].slice(0, whoM[0].length - whoM[1].length).trim()) && !/^[A-Z]/.test(who)) who = "";
  if (!who) who = nameIs(raw);
  const buyer = BUYER.test(said) || (!who && ROLE_WORD.test(said) && !/\b(bartender|server|staff|barback|host)\b/i.test(said));
  if (VAGUE.test(said) || VAGUE.test(who)) who = "";
  let result;
  let status = "visited";
  if (NOTFIT.test(raw)) (result = "no"), (status = "notfit");
  else if (NO.test(raw) || NO_BARE.test(raw)) result = "no";
  else if ((DEFER_HARD.test(raw) || DEFER_SOFT.test(raw)) && (date || back)) result = "followup";
  else if (DEFER_HARD.test(raw)) result = "no";
  else if (DEFER_SOFT.test(raw)) return fail("Not now, with no day to follow up.", "Not now: say a day to follow up, or say not interested.");
  else if (ELSEWHERE.test(raw) && !(YES.test(raw) && date)) result = date || back ? "followup" : "someone";
  else if (YES.test(raw) && date) result = "interested";
  else if (date || back) result = "followup";
  // R9 red team: "talked to Sam, interested" is interested (with who), not "someone else"
  else if (YES.test(raw) || buyer) result = "interested";
  else if (who) result = "someone";
  if (BEFORE.test(raw)) status = "talked";
  if (!result) return fail("No result said.", "How did it go: interested, follow up, or not interested?");
  let followUp = date && date >= today ? date : null;
  // R9 red team: "today" with no come-back and no time ("every stop today", "liked it today") is not a follow-up date
  if (followUp === today && !back && time == null) followUp = null;
  if (result === "followup" && !followUp) followUp = wins.find((d) => d > today) ?? addDays(today, 1);
  if (followUp === today && result === "followup" && time == null) followUp = wins.find((d) => d > today) ?? addDays(today, 1);
  const note = noteOf(raw, { stop });
  const at = now && Number.isFinite(now.min) ? `${today}T${hhmm(now.min)}` : null;
  const o = makeOutcome({ result, followUp: followUp ?? "", who, note, at });
  if (o.error) return fail(o.error, "Which day do you follow up?");
  if (time != null && o.followUp) o.followUpTime = hhmm(time);
  const nx = (next ?? []).find((x) => x && x.id !== stop?.id) ?? null;
  const say = `Logged${stop?.name ? ` ${stop.name}` : ""}: ${sayOutcome(o)}.${nx ? ` Next: ${nx.name}.` : ""}`;
  const id = stop?.id ?? null;
  return {
    v: 1,
    ok: true,
    source: "rules",
    visit: { status, outcome: o },
    say,
    next: nx ? { id: nx.id, name: nx.name } : null,
    actions: id ? [{ type: "status", id, status }, { type: "outcome", id, outcome: o }] : [],
  };
}

// "✓ Interested · ↻ Follow up Thu Oct 23, 3 pm · Note: liked it, hesitant about price"
export function sayOutcome(o) {
  if (!o) return "Visited.";
  let t = outcomeText(o) || "Visited";
  if (o.followUp) t = t.replace(/↻ Follow up.*?(?= · |$)/, `↻ Follow up ${niceDate(o.followUp)}${o.followUpTime ? `, ${clockShort(toMin(o.followUpTime))}` : ""}`);
  return `${t}${o.note ? ` · Note: ${o.note}` : ""}`; // labelled, so a read-back says which part is which
}
const toMin = (hhmm) => {
  const [h, m] = String(hhmm).split(":").map(Number);
  return h * 60 + (m || 0);
};
