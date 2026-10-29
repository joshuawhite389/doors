// The chat agent (owner review 9; docs/CONTRACTS-R9.md §1): POST /api/agent (one chat turn) and /api/agent/log-visit
// (drive mode's "done"). The Worker keeps no conversation and no plan: the client sends both, the agent answers with
// text, sourced facts and validated actions the client applies. No KV write, no Qloo call per turn.
// Free model only: Gemini's free tier (GEMINI_API_KEY), else Cloudflare Workers AI (env.AI), else the rules path
// (public/lib/agent-rules.js), labelled "resting". Every tool call the model makes is validated and run by code
// (public/lib/agent-tools.js); the model never writes an action itself. No persona prompt: what the agent knows about a
// room or a city is the tool results, each with its source.
import { anthropicSession, geminiSession, workersAiSession, WORKERS_AI_MODELS } from "./llm.js";
import { usdOf, worstUsd, charge, claudeRoom, settled, usdSeen, _resetSpend } from "./spend.js";
import { TRADE_BRIEF } from "./agent-brief/trade-brief.js";
import { PLACE_LABELS } from "../public/lib/place.js";
import { briefForTurn, briefPrompt, webSearchTool, WEB_RULES, webFacts } from "./brief.js";
import { ipKey, originOk } from "./guard.js";
import { TOOLS, runTool, withMemory, nextStops } from "../public/lib/agent-tools.js";
import { answerByRules, answerFirst, rulesOfContext, notWebAsk, ASKS_NUMBERS, asksBrief, HELP, whyNotLines, whyNotPayload, whyNotAnswer, whyNotText } from "../public/lib/agent-rules.js";
import { FIX_ROWS, whyNotFixOf, whyNotPick, hoursWords } from "../public/lib/agent-context.js";
import { ROOMS } from "../public/lib/profile.js";
import { DAYS, popWords } from "../public/lib/core.js";
import { FATES } from "../public/lib/sieve.js";
export { asksBrief, BRIEF_ASK } from "../public/lib/agent-rules.js";
import { parseVisit, isQuestion } from "../public/lib/visit-parse.js";
import { worthNoting, hasNote } from "../public/lib/door-notes.js";
import { doorNamed } from "../public/lib/agent-rules.js";
import { redact, checkReply, namesIn, applyRule, forModel, personalOut, nameParts } from "../public/lib/slots.js";
import { GATES } from "../public/lib/sieve.js";
import { toldTheRoom } from "../public/lib/talk-gen.js";
import { marginLine } from "../public/lib/ask.js";
import { RESULT_TEXT } from "../public/lib/outcome.js";
import { humanTime } from "../public/lib/talk.js";
import { niceDate } from "../public/lib/profile.js";

export const AGENT_WINDOW = 20; // turns per visitor per 10 minutes
export const AGENT_DAILY = 60; // turns per visitor per day (Doors Agent spec §7, Jard 10-23: 20 per 10 min, 60 a day)
export const AGENT_MODEL_DAILY = 1200; // model calls per isolate per day (Gemini's free quota is the other ceiling)
export const MAX_STEPS = 3; // model round trips per turn
export const STEP_MS = 8000; // one model step at most (then the next model, or the rules)
// A turn starts no new model and no new model step after TURN_MS; each step is cut at STEP_MS (8 s), so a turn ends by
// ~TURN_MS + STEP_MS = 22 s, inside the page's 25 s wait (ui/agent.js). Live 70b: 1–10 s a turn, so 70b → 8b fits.
export const TURN_MS = 14000;
export const GEMINI_STEP_MS = 6000; // a Gemini step (live 2026-10-22: 1–4 s when it answers; flash-lite hangs 30 s+ when not)
// group 3 #7: 96 KB (was 64): the demo plan's context was 55 KB before the place pictures (60 KB after), so a long chat
// (12 messages of up to 1,500 characters) was refused as "too much to send". cleanContext still cuts every field.
// round 3 (agent2): 192 KB: every door now carries its place picture, Qloo's description and menu, and the enrich
// lane's insight record (the demo plan's context is 93 KB). cleanContext still cuts every field.
export const MAX_BODY = 192 * 1024;
export const MAX_MESSAGES = 12;
export const MAX_DOORS = 40;
// ---- Doors Agent (spec §7, Jard 10-23): Anthropic first, then the free chain ----
// Round 3 (Jard 10-25, "the doors agent feels not smart"): Sonnet 5.5 by default (was Haiku 5.5); one setting,
// AGENT_MODEL=claude-opus-5-5 or claude-haiku-5-5. ANTHROPIC_API_KEY is a Worker secret. The before/after eval:
// scripts/dev/agent2-eval.mjs, docs/AGENT2-EVAL.md.
export const AGENT_MODEL = "claude-sonnet-5-5";
// Thinking effort: low in drive mode (a spoken answer within ~5 s), higher at a desk (AGENT_EFFORT_DESK to tune)
export const effortOf = (env, ctx) => (ctx.mode === "drive" ? env.AGENT_EFFORT_DRIVE || "low" : env.AGENT_EFFORT_DESK || "medium");
export const ANTHROPIC_STEP_MS = 12000; // one Anthropic step (live 10-23: 1–4 s a tool step on Haiku at low effort; Sonnet at medium ~2–7 s, round 3)
// a desk turn that may search the web (abilities eval 10-23: a menu lookup took 8–10 s, and one timed out at 10 s);
// still inside the page's 25 s wait. Drive mode keeps ANTHROPIC_STEP_MS: a spoken answer must come fast.
export const ANTHROPIC_WEB_STEP_MS = 15000;
// Web-search turns on Sonnet (Haiku often answers from the pages without citing them, so
// the honesty guard drops those sentences and the answer thins out). One setting: AGENT_WEB_MODEL ("off" = Haiku for
// everything). Picked before the call from the ask's words (WEB_ASK); an ask they miss still has web search on Haiku.
// AGENT_WEB_VISITOR_DAILY bounds the spend: past it a visitor's web asks go to Haiku for the day.
export const AGENT_WEB_MODEL = "claude-sonnet-5-5";
export const AGENT_WEB_VISITOR_DAILY = 10;
export const WEB_ASK = /\b(menus?|pours?|pouring|on tap|taps?|tap list|draft list|beer list|wine list|cocktail list|happy hours?|events?|trivia|live music|open mic|dj|tonight|this week|this weekend|news|owners?|owns|opened|been open|locations?|branch(es)?|website|reviews?|specials?|what'?s on|what'?s happening|what do they (sell|serve|carry)|pints? cost|cost a pint|price of a)\b/i;
const webModelDay = new Map(); // "<day>|<ip>" → Sonnet web turns today
// The $ guard (src/spend.js): one counter for the whole site a UTC day, every Claude call priced from its usage.
// Past AGENT_USD_DAILY ($30 a day since round 3; was $2 under the Console's $70/month cap) no Claude call starts until
// 00:00 UTC and the free chain answers.
export { AGENT_USD_DAILY, PRICE_PER_M, usdOf } from "./spend.js";
export const usdSpent = () => usdSeen();
// what a reply says when Claude was passed over and a free model or Doors' rules answered (spent: the day's $;
// unreadable: the counter can't be read right now, so no Claude call). "after midnight UTC": the panel says it in the
// rep's own time (lib/agent-ui.js inLocalTime)
export const CLAUDE_SPENT = "Claude's daily budget for Doors is used up; it's back after midnight UTC.";
export const CLAUDE_UNREAD = "Claude is paused for a moment; ask again in a minute.";
const claudeNotice = (why) => (why === "unreadable" ? CLAUDE_UNREAD : CLAUDE_SPENT);
// ---- end Doors Agent ----
export const AGENT_RESTING = "Doors Agent is off for today: its daily limit is used. Your plan, door cards and Log visit still work.";
// R9 polish (judge walkthrough 2a): "for today" only when the day's model budget is spent. A transient failure (a
// Gemini 429/503, a timeout) says so; no model configured at all says that.
export const AGENT_BUSY = "The free models are busy right now, so Doors' own rules answered. Ask again in a moment.";
export const AGENT_EASY = "Too many messages in ten minutes, so Doors' rules answer for now. Doors Agent is back in a few minutes.";
// web honesty: when the pages couldn't back a sentence (or any), what the reply says instead
export const WEB_UNSURE = "The pages I found don't say that clearly for this door (links below), so I won't guess. Ask at the door: who buys, and what they pour for guests who aren't drinking.";
export const WEB_UNSURE_TAIL = "The rest I couldn't tie to those pages, so ask at the door: who buys, and when they're in.";
export const AGENT_NO_MODEL = "No model is connected here, so Doors' own rules answered. Your plan, door cards and Log visit still work.";
// failed (agentTurn's list) → the resting copy: spent-only (or nothing tried after a spent budget) → for today
export function restingMessage(failed = []) {
  if (!failed.length) return AGENT_NO_MODEL;
  const spent = (f) => f === "spent" || /:(spent|neurons)$/.test(f);
  return failed.every(spent) ? AGENT_RESTING : AGENT_BUSY;
}
const ID_RE = /^(?!__proto__$)[0-9A-Za-z_-]{1,64}$/; // R9 red team: "__proto__" would set the doors map's prototype

const recent = new Map(); // "<ip>" → timestamps in the last 10 min
const daily = new Map(); // "<day>|<ip>" → turns today
const modelDay = { day: null, n: 0 };
export function _resetAgent() {
  coolUntil.clear();
  Object.assign(neuronDay, { day: null, n: 0 });
  recent.clear();
  daily.clear();
  Object.assign(modelDay, { day: null, n: 0 });
  _resetSpend();
  webModelDay.clear();
}
const today = (env) => env.TODAY ?? new Date().toISOString().slice(0, 10);

// ---- R9 red team: a /48 counts too (one IPv6 customer or VM gets a /48 = 65,536 /64s, each a fresh "visitor"), at
// NET_SHARE visitors' worth; and a full map drops its least-used keys, never all of them (clearing reset every cap) ----
export const NET_SHARE = 4;
const netOf = (ip) => (/::\/64$/.test(ip) ? `${ip.split(":").slice(0, 3).join(":")}::/48` : null);
// weight: how much a key has used (its count); the least used go first, so a flood of one-turn visitors can't push out
// the counts that matter (a visitor at the cap)
const trim = (m, max, weight) => {
  if (m.size <= max) return;
  const drop = [...m.entries()].map(([k, v]) => [k, weight(v)]).sort((a, b) => a[1] - b[1]).slice(0, m.size - Math.floor(max * 0.9));
  for (const [k] of drop) m.delete(k);
};
// ---- end R9 red team ----
// ---- Jard web review R2 (10-24, Carmichael's): the user's drinker words are not door facts ----
// Asked "why is this a good fit?", Haiku said Carmichael's crowd is "local regulars who want a laid-back spot, which
// suits health-conscious parents and professionals": the first half was Qloo's, the second the user's own words about
// THEIR drinkers (profile.drinkers), said as if it were about the door. The prompt walls them off; this is the net
// under it for every model. A word from the user's drinkers line that no door fact in front of the model holds (the
// tool results, the doors' Qloo fields and notes; never the user's own message) may appear only in a clause that says
// whose words they are ("your drinkers are …", "you described them as …", "if your drinkers are …"); any other
// sentence with it is dropped.
const DRINKER_STOP = new Set("people person folks drinkers drinker drink drinks who what when where they them their there with from into that this those these like likes want wants love loves about also some most mostly mainly lots plenty usually often other others more less very just really knows know user users guess best research the and for are our your yours mine".split(" "));
export function drinkerTerms(drinkers) {
  const t = String(drinkers ?? "").replace(/\s*\((?:the user knows this|the user's best guess or research|what I know|my best guess)\)\s*$/i, "").toLowerCase();
  return [...new Set(t.split(/[^\p{L}\p{N}'’-]+/u).map((w) => w.replace(/^['’-]+|['’-]+$/g, "")).filter((w) => w.length >= 4 && !DRINKER_STOP.has(w) && !/^\d/.test(w)))];
}
const stemOf = (w) => w.replace(/(?:ies|es|s)$/, "");
const hasTerm = (text, w) => new RegExp(`(?<![\\p{L}-])${reEsc(stemOf(w))}(?:s|es|ies)?(?![\\p{L}-])`, "iu").test(text);
// a clause that says the words are the user's own read of their drinkers
const OWN_WORDS = /\b(?:you(?:'ve| have)? (?:described|said|told|wrote|put|listed|named|picked|chose|see|think|guess|know)|you(?:'re| are) (?:selling|aiming|going after)|your (?:own )?(?:drinkers?|read|words|description|best guess|guess|picture|profile|customers?|buyers? of)\b|if your drinkers|in your (?:words|profile)|according to you)/i;
// a clause that says the data doesn't show them ("Nothing in Qloo's data mentions parents") is the honest answer
const NOT_THERE = /\b(?:doesn'?t|does not|don'?t|do not|isn'?t|is not|aren'?t|nothing|no sign|no mention|never|not (?:in|on|something|from|what))\b/i;
export function drinkerPool(ctx, backing = {}) {
  const doors = Object.values(ctx?.doors ?? {}).map((v) => [v.crowd, v.ambience, ...(v.goodFor ?? []), v.genre, ...Object.values(v.place ?? {}), ...(v.notes ?? []).map((n) => n.text), v.outcome?.note].filter(Boolean).join(" "));
  // backing.words is the rep's message + the tool results; only the tool results (backing.shown) count as door facts
  return [...(backing.facts ?? []).map((f) => f?.text ?? ""), backing.shown ?? "", backing.web ?? "", ...doors].join(" ");
}
export function drinkersOffDoors(text, ctx, backing = {}) {
  const pool = drinkerPool(ctx, backing);
  const terms = drinkerTerms(ctx?.profile?.drinkers).filter((w) => !hasTerm(pool, w));
  if (!terms.length) return String(text ?? "");
  const keep = (x) => !terms.some((w) => hasTerm(x, w)) || x.split(/[,;:—–(]|\s-\s|\b(?:which|so|but|because|while)\b/i).every((c) => !terms.some((w) => hasTerm(c, w)) || OWN_WORDS.test(c) || NOT_THERE.test(c));
  return (String(text ?? "").match(SENTENCE_Q) ?? []).filter(keep).join("").trim();
}
// A line the user is told to say (in quotes) never tells the buyer what their own room is like (Jard R2: "looks like you
// get music enthusiasts in here"; live replay 10-24: a briefing's opener "Your crowd here is out for live music and
// cocktails"). talk-gen's toldTheRoom finds it; that sentence of the quote goes, and a quote left empty goes with its
// sentence.
export function roomOutOfQuotes(text) {
  let gone = false;
  const out = String(text ?? "").replace(/([“"])([^“”"]{8,600})([”"])/g, (m, a, q, b) => {
    const parts = q.match(/[^.!?]+[.!?]*\s*/g) ?? [q];
    const keep = parts.filter((x) => !toldTheRoom(x));
    if (keep.length === parts.length) return m;
    if (!keep.length) return (gone = true), "\u0004.";
    return `${a}${keep.join("").trim()}${b}`;
  });
  return gone ? (out.match(SENTENCE_Q) ?? []).filter((x) => !x.includes("\u0004")).join("").trim() : out;
}
// ---- end R2 ----
// One turn for this visitor: null when allowed (and counted), else "busy" (10 min) or "daily".
export function agentLimited(env, ip, now = Date.now()) {
  const keys = [[ip, 1], ...(netOf(ip) ? [[netOf(ip), NET_SHARE]] : [])];
  const r = keys.map(([k]) => (recent.get(k) ?? []).filter((t) => now - t < 10 * 60 * 1000));
  if (keys.some(([, x], i) => r[i].length >= AGENT_WINDOW * x)) return "busy";
  const cap = Number(env.AGENT_DAILY ?? AGENT_DAILY);
  if (keys.some(([k, x]) => (daily.get(`${today(env)}|${k}`) ?? 0) >= cap * x)) return "daily";
  keys.forEach(([k], i) => {
    r[i].push(now);
    recent.set(k, r[i]);
    const d = `${today(env)}|${k}`;
    daily.set(d, (daily.get(d) ?? 0) + 1);
  });
  trim(recent, 5000, (ts) => ts.filter((t) => now - t < 10 * 60 * 1000).length);
  trim(daily, 20000, (n) => n);
  return null;
}
const turnsLeft = (env, ip) => Math.max(0, Number(env.AGENT_DAILY ?? AGENT_DAILY) - (daily.get(`${today(env)}|${ip}`) ?? 0));
// one model call against the isolate's daily ceiling: false when it is spent
function modelCall(env) {
  if (modelDay.day !== today(env)) Object.assign(modelDay, { day: today(env), n: 0 });
  if (modelDay.n >= Number(env.AGENT_MODEL_DAILY ?? AGENT_MODEL_DAILY)) return false;
  modelDay.n++;
  return true;
}

// The model sessions to try, in order (free only). env.AGENT_SESSION: the tests' stub ({system, user, tools} → session).
// Live check D: Workers AI first. Gemini's
// free tier allows 20 requests a day per model on 3.5-flash and 3-flash (a turn is 2–4), and 3.1-flash-lite 503s or
// hangs; on the same 10 asks Llama 3.3 70b was 9/10 right in ~6 s, Gemini 1/10. Gemini is the backup once the day's
// Workers AI neurons are used (GEMINI_MODELS, comma-separated, or GEMINI_MODEL alone). A model that failed is skipped
// until it cools: COOLDOWN_MS, or until Google's daily reset when the 429 says the day's quota is used.
export const GEMINI_CHAIN = ["gemini-3.5-flash", "gemini-3-flash-preview", "gemini-3.1-flash-lite"];
export const COOLDOWN_MS = 5 * 60 * 1000;
const coolUntil = new Map(); // model → skipped until then (this isolate)
// claudeOk: the site's Claude $ for the day has room (claudeRoom, src/spend.js; agentTurn reads it first)
export function sessions(env, now = Date.now(), ip = null, ctx = null, usage = null, words = "", claudeOk = true) {
  if (env.AGENT_SESSION) return [{ by: "stub", make: env.AGENT_SESSION }];
  const out = [];
  // Doors Agent: Anthropic first while the day's $ guard has room (usage: the turn's own token tally, agentTurn)
  if (env.ANTHROPIC_API_KEY && claudeOk) {
    const base = String(env.AGENT_MODEL || AGENT_MODEL).trim();
    const web = ctx ? webSearchTool(ctx, env, ip) : null;
    const session = (model, webStep) => ({ by: "anthropic", model, make: anthropicSession({ apiKey: env.ANTHROPIC_API_KEY, model, effort: ctx ? effortOf(env, ctx) : "medium", serverTools: web ? [web] : [], timeoutMs: Number(webStep ? env.ANTHROPIC_WEB_STEP_MS ?? ANTHROPIC_WEB_STEP_MS : env.ANTHROPIC_STEP_MS ?? ANTHROPIC_STEP_MS), ...(env.ANTHROPIC_FETCH ? { fetchImpl: env.ANTHROPIC_FETCH } : {}), onUsage: (u, m) => { const usd = usdOf(u, m); charge(env, usd, "agent"); usage?.push({ ...u, usd }); }, onLost: (x) => { const usd = worstUsd(x); charge(env, usd, "agent"); usage?.push({ usd, lost: true }); } }) });
    // a web ask: Sonnet first (this visitor's day allowing), Haiku behind it if Sonnet fails
    const webModel = String(env.AGENT_WEB_MODEL ?? AGENT_WEB_MODEL).trim();
    const key = `${today(env)}|${ip ?? "local"}`;
    if (web && webModel && webModel !== "off" && webModel !== base && WEB_ASK.test(String(words)) && !notWebAsk(words) && (webModelDay.get(key) ?? 0) < Number(env.AGENT_WEB_VISITOR_DAILY ?? AGENT_WEB_VISITOR_DAILY)) {
      webModelDay.set(key, (webModelDay.get(key) ?? 0) + 1);
      trim(webModelDay, 20000, (n) => n);
      out.push(session(webModel, true));
    }
    out.push(session(base, Boolean(web && ctx?.mode !== "drive")));
  }
  if (env.AI?.run) for (const key of workersAiChain(env, ip)) out.push({ by: "workers-ai", model: key, make: workersAiSession({ ai: timed(env.AI, STEP_MS), model: WORKERS_AI_MODELS[key] ?? key, onUsage: (u) => spendNeurons(env, key, u) }) });
  if (env.GEMINI_API_KEY) {
    const chain = String(env.GEMINI_MODELS || env.GEMINI_MODEL || GEMINI_CHAIN.join(",")).split(",").map((x) => x.trim()).filter(Boolean);
    for (const model of chain) out.push({ by: "gemini", model, make: geminiSession({ apiKey: env.GEMINI_API_KEY, model, timeoutMs: GEMINI_STEP_MS, ...(env.GEMINI_FETCH ? { fetchImpl: env.GEMINI_FETCH } : {}) }) });
  }
  // a cooling model is skipped, not just moved back. Live check D: when every model is cooling, none is tried (a turn
  // waited 6 s on Gemini models that had just refused); the rules answer at once, labelled busy (agentTurn)
  const warm = out.filter((x) => now >= (coolUntil.get(x.model) ?? -Infinity));
  // the skipped ones, for the turn's modelError: "<model>:spent" (its day's quota) or "<model>:cooling"
  warm.skipped = out.filter((x) => !warm.includes(x)).map((x) => `${x.model}:${coolUntil.get(x.model) - now > COOLDOWN_MS ? "spent" : "cooling"}`);
  return warm;
}
// What answered, in the panel's words (live check D: the badge and the footer name it)
const MODEL_NAMES = { "70b": "Llama 3.3 70B", "8b": "Llama 3.1 8B", qwen: "Qwen3 30B" };
const CLAUDE = (m) => String(m).replace(/^claude-/, "").replace(/-(\d+)-(\d+)$/, " $1.$2").replace(/^\w/, (c) => c.toUpperCase());
export const modelName = (by, model) => (by === "anthropic" ? `Anthropic Claude (${CLAUDE(model)})` : by === "workers-ai" ? `Cloudflare Workers AI (${MODEL_NAMES[model] ?? model})` : by === "gemini" ? `Google Gemini (${String(model).replace(/^gemini-/, "").replace(/-/g, " ")})` : null);
// ---------- Workers AI: the free 10,000 neurons a day (account-wide, reset 00:00 UTC) ----------
// developers.cloudflare.com/workers-ai/platform/pricing (2026-10-20): neurons per million tokens [in, out].
export const NEURONS_PER_M = { "70b": [26668, 204805], "8b": [4119, 34868], qwen: [4625, 30475] };
// This isolate's share of the day (in memory, like the model-call count): the 70b model while under AGENT_NEURONS_70B,
// then the 8b one up to AGENT_NEURONS_DAILY, then the rules ("resting"). Headroom below 10,000 covers other isolates
// and the estimate's error; Cloudflare's own "allocation used" error (4006) also ends the day for Workers AI.
export const AGENT_NEURONS_70B = 6000; // ~25 turns at ~240 neurons (measured 180–350)
export const AGENT_NEURONS_DAILY = 8500; // then ~65 more on 8b at ~37 (28–47); 15% under Cloudflare's 10,000
export const AGENT_70B_PER_VISITOR = 12; // turns a day one visitor gets on 70b, so one judge can't spend everyone's share
const neuronDay = { day: null, n: 0 };
const neuronsLeft = (env) => {
  if (neuronDay.day !== today(env)) Object.assign(neuronDay, { day: today(env), n: 0 });
  return { big: Number(env.AGENT_NEURONS_70B ?? AGENT_NEURONS_70B) - neuronDay.n, all: Number(env.AGENT_NEURONS_DAILY ?? AGENT_NEURONS_DAILY) - neuronDay.n };
};
export const neuronsSpent = () => neuronDay.n;
// drive mode's voice (src/voice.js) draws on the same day's share: room left, and what a voice call used
export const neuronsRoom = (env, need = 0) => neuronsLeft(env).all > need;
export const spendVoiceNeurons = (env, n) => { neuronsLeft(env); neuronDay.n += Number(n) || 0; };
function spendNeurons(env, key, u) {
  neuronsLeft(env);
  const [i, o] = NEURONS_PER_M[key] ?? NEURONS_PER_M["70b"];
  // no usage reported: count a full step (the prompt is ~3 k tokens) so the budget errs on the safe side
  neuronDay.n += u ? ((u.prompt_tokens ?? 0) * i + (u.completion_tokens ?? 0) * o) / 1e6 : (4000 * i + 512 * o) / 1e6;
}
function workersAiChain(env, ip = null) {
  const left = neuronsLeft(env);
  if (left.all <= 0) return [];
  const chain = String(env.WORKERS_AI_MODELS || "70b,8b").split(",").map((x) => x.trim()).filter(Boolean);
  const mine = ip == null ? 0 : (daily.get(`${today(env)}|${ip}`) ?? 0); // this visitor's turns today, this one counted
  const big = left.big > 0 && mine <= Number(env.AGENT_70B_PER_VISITOR ?? AGENT_70B_PER_VISITOR);
  return big ? chain : chain.filter((k) => k !== "70b");
}
// the binding takes no abort signal: a step that runs past ms fails as a timeout (the next model, or the rules)
const timed = (ai, ms) => ({
  run: (model, input) => {
    let t;
    return Promise.race([ai.run(model, input), new Promise((_, no) => (t = setTimeout(() => no(Object.assign(new Error("Workers AI timeout"), { name: "TimeoutError" })), ms)))]).finally(() => clearTimeout(t));
  },
});
export const agentModel = (env) => sessions(env)[0]?.by ?? "none";

// ---------- input ----------
const s = (x, n) => String(x ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, n);
const num = (x) => (typeof x === "number" && Number.isFinite(x) ? x : null);
const arr = (x, n, f) => (Array.isArray(x) ? x.slice(0, n).map(f).filter((y) => y != null) : []);
const isDate = (x) => /^\d{4}-\d{2}-\d{2}$/.test(String(x ?? ""));
const isClock = (x) => /^\d{1,2}:\d{2}$/.test(String(x ?? ""));

function cleanTalk(t) {
  if (!t || typeof t !== "object") return null;
  const line = (x) => (typeof x === "string" ? s(x, 300) : x && typeof x === "object" ? s(x.text ?? x.reply ?? "", 300) : null);
  return { opener: s(t.opener, 300), ...(t.toBuyer ? { toBuyer: s(t.toBuyer, 300) } : {}), questions: arr(t.questions, 8, line), points: arr(t.points, 8, line), pushback: arr(t.pushback, 8, line), objections: arr(t.objections, 8, line), ask: s(t.ask, 300) };
}
const PLACE_KEYS = ["when", "room", "pours", "into", "music", "sisters"];
function cleanDoor(v) {
  if (!v || typeof v !== "object") return null;
  const o = v.outcome && typeof v.outcome === "object" ? { result: s(v.outcome.result, 20), ...(isDate(v.outcome.followUp) ? { followUp: v.outcome.followUp } : {}), ...(v.outcome.note ? { note: s(v.outcome.note, 400) } : {}), ...(v.outcome.who ? { who: s(v.outcome.who, 60) } : {}) } : null;
  return {
    name: s(v.name, 80) || "a door",
    rank: num(v.rank), N: num(v.N), status: ["visited", "talked", "notfit"].includes(v.status) ? v.status : null, outcome: o,
    address: s(v.address, 160), hours: s(v.hours, 300), popularity: num(v.popularity), affinity: num(v.affinity),
    crowd: s(v.crowd, 400), ambience: s(v.ambience, 400), goodFor: arr(v.goodFor, 8, (x) => s(x, 40) || null), genre: s(v.genre, 60),
    sisters: arr(v.sisters, 6, (x) => (ID_RE.test(String(x)) ? String(x) : null)),
    sound: v.sound && typeof v.sound === "object" ? { pass: v.sound.pass === true } : null,
    talk: cleanTalk(v.talk), captured: isDate(v.captured) ? v.captured : null,
    plan: cleanFate(v.plan), // Jard 10-23: on the plan, or the Why view's gate and reason
    // group 3 #7: the door's place picture (agent-context.js placeForAgent): Qloo's facts by row, {when: "…", …}
    place: v.place && typeof v.place === "object" && !Array.isArray(v.place) ? Object.fromEntries(PLACE_KEYS.map((k) => [k, s(v.place[k], 160)]).filter(([, x]) => x)) : {},
    // round 3 (agent2): what else Qloo holds on the door (agent-context.js aboutForAgent) and the enrich lane's insight
    // record (insightForAgent): lines the model may say, each with where it comes from
    about: cleanAbout(v.about),
    insight: cleanInsight(v.insight),
    notes: arr(v.notes, 6, (n) => (n && typeof n === "object" && s(n.text, 300) ? { text: s(n.text, 300), by: n.by === "ask-doors" ? "ask-doors" : "rep" } : null)), // door notes
  };
}
function cleanAbout(a) {
  if (!a || typeof a !== "object") return {};
  const out = { kind: s(a.kind, 60), description: s(a.description, 300), menu: arr(a.menu, 6, (x) => s(x, 60) || null), liveMusic: a.liveMusic === true, rating: num(a.rating), neighborhood: s(a.neighborhood, 60), site: s(a.site, 80) };
  return Object.fromEntries(Object.entries(out).filter(([, x]) => x === true || (typeof x === "number") || (typeof x === "string" && x) || (Array.isArray(x) && x.length)));
}
function cleanInsight(i) {
  if (!i || typeof i !== "object") return null;
  const lines = arr(i.lines, 12, (x) => s(x, 240) || null);
  if (!lines.length) return null;
  return { lines, ...(i.site && typeof i.site === "object" && /^https?:\/\//.test(String(i.site.url ?? "")) ? { site: { url: s(i.site.url, 300), captured: isDate(i.site.captured) ? i.site.captured : null } } : {}) };
}
// WHY-VIZ-SPEC §4.5: the thread panel's structured ask (lib/whyviz/thread.js threadAsk). Ids checked, text cut, and
// each door's fix rebuilt from the table by its own fields (agent-context.js whyNotFixOf), never taken from the client:
// only the day a route fix names ("Lock it to Tuesday…") is read from the client's text, as the planner's own day name.
const DAY_NAME = /^(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day$/;
export function cleanWhyNot(w) {
  if (!w || typeof w !== "object" || !ID_RE.test(String(w.selected?.id ?? ""))) return null;
  const door = (d) => (d && typeof d === "object" && ID_RE.test(String(d.id ?? "")) ? { id: String(d.id), name: s(d.name, 80) || "a door" } : null);
  const doors = arr(w.doors, 30, (d) => {
    const base = door(d);
    if (!base) return null;
    const type = ROOMS.some((r) => r.key === d.type) ? d.type : null;
    const open = arr(d.open, 7, (x) => (typeof x === "string" && DAY_NAME.test(x) ? x : null));
    const day = /^Lock it to (\S+) and Doors re-routes/.exec(String(d.fix?.text ?? ""))?.[1] ?? null;
    const out = { ...base, rank: Number.isInteger(d.rank) && d.rank > 0 ? d.rank : null, fate: FATES.includes(d.fate) ? d.fate : null, code: s(d.code, 20) || null, why: s(d.why, 200) || null, big: d.big === true, popularity: num(d.popularity), genre: s(d.genre, 60), type, pitched: d.pitched === true, open, status: s(d.status, 80), reason: s(d.reason, 240) || "It didn't fit a day." };
    out.fix = whyNotFixOf(out, { day: day && DAY_NAME.test(day) ? day : null });
    return out;
  });
  return { question: s(w.question, 120), selected: door(w.selected), doors, onPlan: arr(w.onPlan, 60, door) };
}
// A door's place on the plan (agent-context.js): the head is rebuilt from the gate, never taken from the client.
function cleanFate(f) {
  if (!f || typeof f !== "object") return null;
  const on = f.on === true;
  const g = GATES.find((x) => x.key === f.fate);
  const reason = s(f.reason, 200);
  if (!reason || (!on && !g)) return null;
  return { on, fate: on ? "plan" : g.key, head: on ? "On your plan:" : `Stopped at “${g.ask}”:`, reason };
}
// The client's context (§1.2) → what the agent may read: cut, typed, ids checked. Never sent to Qloo.
export function cleanContext(c = {}) {
  const doors = {};
  for (const [id, v] of Object.entries(c?.doors ?? {}).slice(0, MAX_DOORS)) if (ID_RE.test(id)) doors[id] = cleanDoor(v);
  const cd = c?.cityData ?? {};
  const envelopes = {};
  for (const [id, e] of Object.entries(c?.envelopes ?? {}).slice(0, MAX_DOORS)) if (Object.hasOwn(doors, id) && e && typeof e === "object") envelopes[id] = { constraints: { avoid: [], terms: Object.fromEntries(Object.entries(e.constraints?.terms ?? {}).slice(0, 20).map(([k, x]) => [s(k, 40), s(x, 40)]).filter(([k, x]) => k && x)) }, slots: arr(e.slots, 30, (r) => (r && typeof r === "object" ? { field: s(r.field, 30), value: typeof r.value === "string" ? s(r.value, 300) : r.value?.name ? { name: s(r.value.name, 60) } : r.field === "rule.term" && r.value?.from && r.value?.to ? { from: s(r.value.from, 40), to: s(r.value.to, 40) } : null, source: s(r.source, 12), ...(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z?$/.test(String(r.at ?? "")) ? { at: String(r.at) } : {}) } : null)) };
  return {
    today: isDate(c?.today) ? c.today : new Date().toISOString().slice(0, 10),
    // Doors Agent (spec §6): the screen asked from sets the length: drive mode and a stop one or two sentences (drive mode
    // aloud, at low thinking effort), the plan and its map up to about three plus a short list. "desk" (older clients) is
    // the plan
    mode: ["drive", "stop", "plan"].includes(c?.mode) ? c.mode : "plan",
    now: isClock(c?.now) ? c.now : "12:00",
    profile: { brand: s(c?.profile?.brand, 80), what: s(c?.profile?.what, 120), price: s(c?.profile?.price, 60), ask: s(c?.profile?.ask, 200), product: s(c?.profile?.product, 320), drinkers: s(c?.profile?.drinkers, 240), signAs: s(c?.profile?.signAs, 60) },
    city: { key: s(c?.city?.key, 60), name: s(c?.city?.name, 80) },
    windows: arr(c?.windows, 14, (w) => (isDate(w?.date) ? { date: w.date, from: s(w.from, 5), to: s(w.to, 5) } : null)),
    maxPerDay: Number.isInteger(c?.maxPerDay) && c.maxPerDay >= 1 && c.maxPerDay <= 20 ? c.maxPerDay : null,
    days: arr(c?.days, 14, (d) => (isDate(d?.date) ? { date: d.date, stops: arr(d.stops, 25, (x) => (Object.hasOwn(doors, String(x?.id)) ? { id: String(x.id), eta: s(x.eta, 5) } : null)) } : null)),
    day: { date: isDate(c?.day?.date) ? c.day.date : null, stops: arr(c?.day?.stops, 25, (x) => (Object.hasOwn(doors, String(x?.id)) ? { id: String(x.id), eta: s(x.eta, 5), locked: x.locked === true, legMin: num(x.legMin), until: s(x.until, 5), reason: s(x.reason, 160) } : null)), trade: cleanTrade(c?.day?.trade, doors) },
    current: Object.hasOwn(doors, String(c?.current)) ? String(c.current) : null,
    nextDoor: Object.hasOwn(doors, String(c?.nextDoor)) ? String(c.nextDoor) : null, // judge pass 4 (#4)
    doors,
    envelopes,
    names: arr(c?.names, 40, (x) => s(x, 60) || null), // the rep's and contacts' names: only to redact, never sent on
    avoid: arr(c?.avoid, 800, (x) => s(x, 60) || null),
    cityData: { citySound: arr(cd.citySound, 20, (x) => s(typeof x === "string" ? x : x?.name, 60) || null), nbhd: Object.fromEntries(Object.entries(cd.nbhd ?? {}).slice(0, 8).map(([k, l]) => [s(k, 40), arr(l, 6, (x) => s(typeof x === "string" ? x : x?.name, 60) || null)])), drinker: s(cd.drinker, 120), merged: cd.merged === true, filter: s(cd.filter, 80), captured: isDate(cd.captured) ? cd.captured : null },
    whynot: cleanWhyNot(c?.whynot), // WHY-VIZ-SPEC §4.5
  };
}
// Judge pass 2 (5): the plan view's "that stop first" re-plan (ui/plan.js whatIfFirst), numbers only
function cleanTrade(t, doors) {
  if (!t || typeof t !== "object" || !Object.hasOwn(doors, String(t.id))) return null;
  const leg = (x) => ({ min: num(x?.min) ?? 0, mi: num(x?.mi) ?? 0, n: num(x?.n) ?? 0 });
  return { id: String(t.id), was: leg(t.was), then: leg(t.then), dropped: arr(t.dropped, 10, (x) => s(x, 80) || null), source: t.source === "ors" ? "ors" : "estimate" };
}
// Jard 10-24 web review: the agent's own replies keep up to 1,500 characters: its offer ("Want me to make those two
// edits?") came last in a reply past 600, was cut, and the rep's "yes please" then read as asking for nothing
export function cleanMessages(m) {
  const out = arr(m, 40, (x) => (x && ["user", "agent"].includes(x.role) && typeof x.text === "string" && x.text.trim() ? { role: x.role, text: s(x.text, x.role === "agent" ? 2400 : 600) } : null)).slice(-MAX_MESSAGES);
  return out.at(-1)?.role === "user" ? out : null;
}

// Every name the context holds (context.names: the rep's and the contacts', outcomes' who, contact slots): replaced by
// "the contact" before the model sees anything (CULTURAL-SLOTS §4 rule 3, Q2).
const contactNames = (ctx) => [...new Set([...ctx.names, ...Object.values(ctx.doors).map((v) => v.outcome?.who), ...Object.values(ctx.envelopes).flatMap((e) => e.slots.filter((r) => r.field === "contact").map((r) => r.value?.name ?? r.value))].filter((x) => typeof x === "string" && x.length >= 2))];

// gigbot 10-24 (agentfix finding a): the user's own name ("Sign your messages as") was redacted like a contact's, so a line
// the model wrote for the user read "Hi, I'm the contact with Tidewell". It gets its own placeholder, which code puts
// back: the user's first name (or the whole sign-off when it names a team, "The Tidewell team"). It still never reaches
// a model.
export const ME = "[your name]";
const reEsc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function meOf(ctx) {
  const full = String(ctx?.profile?.signAs ?? "").trim();
  if (full.length < 2) return null;
  const brand = new Set(String(ctx?.profile?.brand ?? "").toLowerCase().split(/\s+/).filter(Boolean));
  const team = /\bteam\b/i.test(full) || [...brand].some((w) => full.toLowerCase().split(/\s+/).includes(w));
  const parts = team ? [] : nameParts(full).filter((x) => !brand.has(x.toLowerCase()));
  return { full, parts, back: team || !parts.length ? full : parts[0] };
}
// the user's name (whole, then each part) → [your name]; "I'm [your name] [your name]" (first and last) said once
export function meOut(text, me) {
  if (!me) return String(text ?? "");
  let t = String(text ?? "");
  for (const n of [me.full, ...me.parts].sort((a, b) => b.length - a.length)) t = t.replace(new RegExp(`(^|[^\\p{L}\\p{N}])${reEsc(n)}(?=$|[^\\p{L}\\p{N}])`, "gu"), (m, pre) => `${pre}${ME}`);
  return t.split(`${ME} ${ME}`).join(ME);
}
// and back, in everything the turn returns (the reply, a draft, an edited line)
export function meBack(x, me) {
  if (typeof x === "string") return x.split(ME).join(me?.back ?? "your name");
  if (Array.isArray(x)) return x.map((y) => meBack(y, me));
  if (x && typeof x === "object") return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, meBack(v, me)]));
  return x;
}

// Privacy: a name namesIn spots ("Nomadic said no") that is a word of a door's name, the brand or the city is a place,
// not a person: redacting it would rename the door everywhere in the prompt
export function notPlaces(found, places) {
  const words = new Set(places.filter((x) => typeof x === "string").flatMap((x) => x.toLowerCase().split(/[^\p{L}\p{N}'’]+/u)).filter(Boolean));
  return found.filter((n) => !String(n).toLowerCase().split(/\s+/).some((w) => words.has(w)));
}

// ---------- the prompt: what the agent can see, no persona ----------
export const SYSTEM = [
  "You help a drinks sales rep through a day of visiting bars and restaurants (doors) with the Doors app.",
  "You know only what is in CONTEXT and in tool results. Doors' data comes from Qloo and from what the rep told Doors.",
  "For anything about a door, its rank, its crowd or the city, call a tool (explain_door, compare_doors, ask_city) and say only what the result says. If a result says nothing, say Qloo's data doesn't say; never guess.",
  "Whether a door is on the plan, and why not, is the plan fact explain_door returns: give that reason in its words and no other.",
  // Llama read out "affinity 0.83… popularity 0.60" in a pitch and after a why-not; the app shows
  // Qloo's numbers under the reply, so the reply says them in trade words
  // gigbot 10-24 (live Haiku): "rank 7 of 55 … affinity of 0.87, close to Nomadic Beerworks at 0.91" to "Why is X first?"
  "Say Qloo's data in plain words: near the top of your list, in the top half, its crowd matches your drinker as closely as your best door, close to another door. Say a rank only as the door's place on Your list (\"#7 of 55 on Your list\"), never \"rank 7\". Never write Qloo's affinity or popularity as a number or any 0.xx decimal, even when the rep asks for the numbers (Jard: decimals are confusing): give the rank (\"#2 of 55 on Your list\") and plain words (\"one of Austin's most popular doors\", \"almost unknown\"). When you compare doors, say which ranks higher, or that they are level.",
  "Answer only what the rep asked. Why a door is or isn't on the plan: give the plan fact and stop. Say what a door's crowd is only when the rep asks about its crowd, in the result's words.",
  "A pitch, opener or line is what the rep says to the door's buyer: name the brand and its product (CONTEXT brand, product, talk), in one or two sentences, never about Qloo, rank or scores, and never a description of the door's crowd or regulars (nobody tells a bar who drinks there): Qloo's data picks what to lead with, it is not said. The opener is said to whoever is behind the bar (who you are, who buys, when to catch them); the line for the buyer is the angle and an offer to taste.",
  "Never describe or guess anything about a person (age, origin, taste, mood). Never say what a door stocks or pours.",
  "Say an arrival time the way a person does, as the tools give it: \"around 2 pm\", \"a little after 1 pm\", \"a little before 3 pm\"; never to the minute (\"1:14 pm\") and never with \"~\". Posted hours and the rep's own times as given (\"opens 11:30 am\", \"done by 5 pm\"). Never 24-hour like \"18:00\"; days as \"Tuesday\" or \"Tue Oct 27\".", // ease audit #7: "ends by 18:00"; Jard 10-24 #5: "nobody says 2:03 pm"
  "To change the day call replan; to change talking points call edit_talking_points; when the rep says how a visit went call log_visit; when the rep states or corrects a contact, a rule or a door's type call remember.",
  "You keep the rep's notes on each door (a door's notes are in CONTEXT). When the rep says something that will matter on a later visit (who to ask for, when they're in, what they want or asked for, a promise, how to reach them, something about the door), call save_note with it in the rep's words, then say in a few words that you noted it. Don't note small talk, questions, or what log_visit already keeps. When the rep asks what they know about a door, answer from its notes.",
  "If a tool returns an error, fix the call or ask the rep one short question.",
  "Advice on what to say or do is for current_door, or for next_door when current_door_logged is true, unless the rep names a door.",
  "Make each change once: after a tool's result, answer the rep. If the rep only thanks you or chats, answer in a few words without a tool.",
  "Answer only the rep's last message. Earlier messages are already handled: never redo a change they asked for.",
  "The stop after a door is the next stop on that door's own day (its stop field in CONTEXT; the stop after the last stop of a day is the first stop of the next plan day). next_door is the first door not yet visited from today on: it is the answer to \"where do I go next?\" with no door named, never to \"what comes after X?\". A stop's number on its day (\"stop 2 of 6\") is not a rank: say it as it is, or leave it out.",
  "A stop's arrival time is on its own day. now is the time on today only: a time on a later day has not passed (say it with its day, \"Monday around 2 pm\"), and never tell the user to go now to a door whose day is not today, or call that day today.",
  "Offer only a change your tools make (replan, edit_talking_points, log_visit, save_note, remember, draft_follow_up). When the user's last message says yes to a change you offered in your last reply (\"yes please\", \"do it\"), make that change now with the tool. If a change tool returns an error, fix the call and make it again in this turn (another index, a line without the word it names); if it still fails, say in plain words what stopped it (\"Doors doesn't put 'pour' in a line\") and offer the fix. Never say \"the system\", \"the tool\" or \"rejected\".",
  "How well a door matches is said in plain words about its crowd, never in Doors' or Qloo's ranking terms: \"its crowd matches your drinker about as closely as any door on your list\", \"one of your closest matches\", \"a weaker match than most\". Never contrast its match with its place on the list (\"level with the top match, though its overall place is lower\"), and never say \"#1\", \"top match\", \"overall place\", \"affinity\" or \"score\" unless the user asks for the numbers. A rank, when asked, is the door's place on Your list (\"#4 of 55 on Your list\"), never \"Qloo ranks it #4\".",
  "Follow the rep's rules in CONTEXT (your_rules) in every reply: never use a never_say word, and use say_instead's words; the brand's own name stays as it is.",
  "Never say you changed, saved, updated, logged or will remember anything unless a tool did it in this turn.",
  "Reply in plain text, at most three short sentences, no markdown, no list of sources.",
].join(" ");

// ---- Doors Agent (spec §4, §6): the Anthropic path's system prompt. The free models keep SYSTEM above (Llama won't
// carry the persona: spec §7). Block 1 (cached): who the agent is, the three kinds of statement, the tool rules, then
// the trade persona brief. Block 2 (cached on its own): the specialist brief (src/brief.js). The turn's CONTEXT is the
// user message, so it never breaks the cache.
export const AGENT_SYSTEM = [
  // Round 3 (Jard 10-25, ROUND3-SPEC §3 "smarter model, loose rules"): the rules that forced sameness are gone (no rank or
  // popularity numbers, never the crowd, never Qloo's crowd words). What stays: true to the facts, no claim about what a
  // door stocks unless Doors' facts for it say so (then cite it), plain trade words, never patronise the buyer about their
  // own room, one sharp insight per door, fewer lines when the facts are thin, every answer unmistakably that door's.
  "You are Doors Agent, riding along with a drinks salesperson (a brand founder selling their own product, or a distributor rep) through planning and visiting bars and restaurants (doors) with the Doors app. You have done this job: you know the trade, its words and its tricks. You are a sharp colleague, not a generic chatbot: what the user wants from you is an insight about a specific door that gives them an edge in the pitch, never advice that would fit any bar.",
  "WHAT YOU KNOW: CONTEXT holds the plan and every door on it and on Your list, each with its Qloo facts (about_the_place: who goes, when, the room, what it pours, what the crowd is into, its music, the doors that share its crowd, Qloo's description, menu highlights, rating, neighbourhood, its site), its hours, its rank and popularity, whether it is on the plan and why not, its talking points, the user's notes and what they logged, and, when Doors has it, an insight record (insight: the drink brands and crowd groups its crowd over-indexes on against the city's other doors, checked facts from its own site with the page's date). Read it all before you answer. The tools (explain_door, compare_doors, brief_door, prep_day, ask_city) return the same facts with their sources: call one when the answer leans on a door's numbers, so the sources show under your reply.",
  "HONESTY: three kinds of statement.",
  "1. Facts about a specific door come only from CONTEXT, tool results, the user's own words about that door (its notes; your_drinkers is about their drinkers, never a door) or a public page you looked up. Say them as they are, a rank or a count when it makes the point (\"#3 of 55 on Your list\", \"2.3× the city\"); Qloo's popularity and taste match in words (\"almost unknown\", \"one of Austin's most popular doors\"), never as a 0.xx score (Jard: decimals are confusing). Every fact you state about a door must be one you can point to there; nothing about a door comes from your general knowledge of it. Whether a door is on the plan, and why not, is the plan fact in CONTEXT (why_not) and from explain_door: give that reason.",
  "2. Trade know-how (the TRADE BRIEF below, and the SPECIALIST BRIEF when there is one) is said with confidence, as advice, not hedged. When the data stops, say so in one short clause and keep going with the know-how, e.g. \"Qloo doesn't cover their menu, but a brewery that pours its own usually…\". Never stop at \"I don't know\" or \"Qloo's data doesn't say\" alone.",
  "3. Never claim what a door stocks, pours or carries unless Doors' facts for it say so (Qloo's beverage and menu tags, an insight line from its own site, a page you read), and then say where it comes from (\"its site lists…\", \"Qloo tags it…\"). Otherwise ask it as a question at the door. Qloo's drinker match (\"people who drink Athletic Brewing\") is about taste: it never means a door's regulars order that brand or the door carries it. Never invent a person or a specific about a named place (its buyer, its sales, its history, an event, a price); never describe an individual by age, gender, origin or background. Qloo's crowd words (\"young professionals\", \"families\", an age skew) are Qloo's: say them as Qloo's (\"Qloo says the crowd is…\"), and never tell a buyer who their own crowd or the user's drinkers are by age. Never say you changed, saved, updated, logged or will remember anything unless a tool did it in this turn.",
  "THE LAW: never suggest breaking tied-house or trade-practice rules (no free goods, cash, rebates, paid placements or perks for a placement; no paying staff to push a brand; no exclusives). When a question touches it, say no plainly, give the legal path, and say to check their state's ABC board.",
  "THE ANSWER: lead with the ONE sharpest thing about this door the user can use: the fact and what it means for the pitch (its insight lines first when it has them, then what the place picture says that most doors don't: the room tags, the menu items, the music, the doors that share its crowd and whether they are on the plan, its hours against the stop). A gap you infer (\"a brewpub that brews its own won't have a non-alcoholic hazy IPA of its own\") is said as what to ask at the door, never as what they stock. Then the move: a line to say, a question to ask, a number, a decision or a next step. Every door's answer must be unmistakably that door's; a sentence that would fit any bar gets cut. Fewer lines when the facts are thin beats filler. Say what the facts mean, not only what they are. No generic trade advice (\"ask who does the buying\", \"be friendly\", \"bring a sample\", \"ask for the manager\") unless it is tied to a fact about this door.",
  // Jard 10-25 (with talk2's): a crowd fact restated is not an insight; a drink claim needs evidence, not demographics
  "SO WHAT: a crowd or demographic fact (Qloo's crowd description included) is there for what it means: for the pitch, for the business, or for connecting with the owner or buyer. Say that, never the fact restated as an observation (\"I see a lot of young professionals\", \"the crowd is families\"). What a door's people drink or would order rests on evidence for that door: the brands its crowd over-indexes on, its menu, its own site, a page you read. Demographics alone never prove a drink taste (young professionals don't make an NA beer door).",
  "TOOLS: to change the day call replan; to change talking points call edit_talking_points; when the user says how a visit went call log_visit; when the user states or corrects a contact, a rule or a door's type call remember. Several changes in one message are fine: make each once. After a tool's result, answer the user.",
  "Say an arrival time the way a person does, as the tools give it: \"around 2 pm\", \"a little after 1 pm\", \"a little before 3 pm\"; never to the minute (\"1:14 pm\") and never with \"~\". Posted hours and the rep's own times as given (\"opens 11:30 am\", \"done by 5 pm\"). Never 24-hour like \"18:00\"; days as \"Tuesday\" or \"Tue Oct 27\".", // ease audit #7: "ends by 18:00"; Jard 10-24 #5: "nobody says 2:03 pm"
  "Notes: a door's notes are in CONTEXT. When the user says something that will matter on a later visit (who to ask for, when they're in, what they want, a promise, how to reach them, something about the door), call save_note with it in their words, then say in a few words that you noted it. Don't note small talk, questions, or what log_visit already keeps. When asked what they know about a door, answer from its notes.",
  // judge pass 9 #5: at 390 px a live answer said "the app doesn't give a reason" for the order
  "The day's order: Doors orders each day by driving time between the doors and each door's opening hours, not by rank. Asked why a door isn't first or why the day runs in this order, call explain_door for it and say that, with its place on the loop and the trade of putting it first when explain_door gives one. Never say Doors or the app gives no reason for the order.",
  "You can see the whole plan in CONTEXT (every door, its rank, whether it is on the plan, the day's stops in order). Never say you haven't looked: call compare_doors or explain_door for the doors you need (up to three at a time). Asked when to walk into a door, check its hours first, then apply the trade's timing; never send them to a door before it opens.",
  "ABILITIES:",
  // group 3 #7 (Jard 10-24: "Ask who does the buying, then ask for one case of cans in the cooler" was "such generic
  // information… a waste of time"): a briefing is about this door, from its facts, or it is not a briefing
  "- Brief me on a door (\"brief me\", \"tell me about my next stop\", \"what do I need to know about X\", \"help me land the sale\", \"something to go in with\"): call brief_door (no door named: next_door, or current_door when the user is at it). The briefing is about THIS door: every line uses a fact about it (its insight lines, about_the_place, its notes, what was logged, its stop and hours). Give, in this order: (1) three concrete things about this door, each from its facts, each with what it means for the pitch (\"It's a late-night room with live music, so go before 7 when the bar manager can talk\"; \"Qloo says its crowd over-indexes on Athletic Brewing 2.3× the city, so the NA slot is already half sold\"); (2) what to say: one opening line you write for this door, in quotes, that those facts picked but that never tells the bar what its own room, crowd or hours are like (\"Your crowd here is out for live music\" is the line that ends the conversation: say what the product does, or ask) (not the talking points' opener word for word, and not \"who does your buying\"), then the ask with the price math and the product details (format, size) when CONTEXT has them; (3) what to watch for: the pushback most likely at a door like this (its talking points' pushback when there is one) with the line to answer it, and when not to walk in (its busy hours). When CONTEXT has your_drinkers (the user's own words about who drinks their product; never a fact about the door), one of the three things is how this door's crowd, in Qloo's words, lines up with those drinkers, in the user's words, each said as whose it is (where they overlap, where they don't), and the opening line leans on the overlap; a best guess is said as one (\"if your drinkers are runners, …\"). Don't repeat its rank or say Doors chose it: the user knows it's on the plan. At a desk: a short list of five to seven lines. In drive mode or at a stop: up to five short sentences that read well aloud, no list.",
  // Jard web review R2 (10-24, Carmichael's): "its crowd … suits health-conscious parents and professionals" was the
  // user's own words about their drinkers, said as a fact about the door (drinkersOffDoors is the net under this rule)
  "- Your drinkers: your_drinkers in CONTEXT is the user's own picture of who drinks THEIR product. It is never a fact about a door: it says nothing about who goes to a door, what its crowd is like or what suits it. Only Qloo's facts (tool results, a door's crowd, place picture and insight lines) and the user's notes on a door describe a door. To say how a door fits, set the two side by side and say whose each is: \"Qloo says its crowd is local regulars after a laid-back spot; you described your drinkers as health-conscious parents and professionals, so the overlap is the laid-back regulars.\" Never join them into one claim about the door (\"its crowd suits health-conscious parents\", \"a spot for professionals\"), and if Qloo's facts don't show the user's drinkers there, say that plainly. Keep \"what they know\" apart from \"their best guess\" (a guess is said as one: \"if your drinkers are runners, …\"). Never tell a buyer who the user's drinkers are by age.",
  "- Prep my day (\"prep my day\", \"which doors are weak\", \"where do I lead\"): call prep_day once, not compare_doors. Say where to lead hardest and with what (by rank, and what kind of door it is), name each weak door with its reason and the move (go in short, go first or last, or swap), and suggest a swap from its swaps with its plan fact. Make no change unless the user asks; offer it as a question. At a desk a short list is fine.",
  "- Handle an objection (\"they said it's too pricey\", \"no room\", \"we already have one\", \"they only pour their own\"): give the trade's answer as a line the user can say now, in quotes, built on a fact about this door when there is one (a brewery that brews its own: a non-alcoholic beer is the one beer their own taps can't make, so ask whether they carry one; never say they have none), then the small ask to close. Use the door's own pushback line when brief_door or CONTEXT has one for that objection. Money: use price_math from CONTEXT as it is; never make up a cost or a menu price (a menu price not in CONTEXT is said as an example: \"if it sells at $7…\").",
  "- Explain the trade (distributors, chargebacks, depletions, menu placement, tap handles, pour cost, what's legal): answer from the TRADE BRIEF and the SPECIALIST BRIEF (its RULES part for their state), plainly, with the user's own numbers where they fit (price, price_math). On the law: the safe path, and check their state's ABC board for the exact limits. End with what it means for them this week.",
  "- The door's week (\"what's on at X\", \"when's trivia\", \"any events this week\"): search the web for the door's own events, trivia, live music, happy hour and recent local news. Name each event the pages give for this week with its day (trivia, open mic, live music, specials), and say only what the pages say; don't comment on what the pages leave out beyond one clause; then say when to come (a quiet time, not their busy night or happy hour) and what to mention at the door. Nothing found: say so in one clause and give the trade's timing.",
  "- What to bring (\"what should I bring\", \"what do I need tomorrow\"): call what_to_bring. Lead with what they promised a door, then the kit by door type, then the count of samples. Only the day the app is on: for another day, say to open it.",
  "- Plan the next trip (\"which doors should I go back to\", \"plan my next trip\"): call next_trip. Give the order and when for each door to go back to, the ones to leave for now and why, then the best first visits still ahead. Offer a move with replan as a question.",
  "- Compare doors (\"X or Y\", \"which deserves more time\", \"which says yes first\"): call compare_doors, then decide. Name the better fit for THIS product and say why from each door's own facts (its insight lines, what it pours, its crowd vs the city, its hours against the user's day), not from rank alone; a lower-ranked door with a sharper fact can win. End with the move at each.",
  "- Draft the follow-up (\"draft a follow-up to X\", \"write them a text\"): call draft_follow_up once with the message only (Doors adds the greeting and the user's sign-off). In the user's voice: plain, warm, three to five short sentences for an email, one or two for a text (text unless they ask for email). Use only what was said: their words, the door's notes and logged outcome; never add a promise they didn't make (what they'll bring or do), a date, or a detail about the door (what it pours). End on one small ask (a time to taste, the first case). Then say in one sentence that the draft is ready to send from their own app; Doors never sends it, so never say it was sent.",
  "- Lines the user says to a bar never claim what the door's regulars drink, order or buy, never name the drinker brand Qloo matched them on (that match is Doors' private reasoning, not something to tell the buyer), and never tell the buyer what their own room or crowd is like (\"looks like you get music fans in here\"): Qloo's facts pick the angle; they are not said to the buyer.",
  // WHY-VIZ-SPEC §4.5: the thread panel's ask; the fix lines come from the table in why_not_ask (whyNotNet is the net)
  "- Why aren't these on my plan (why_not_ask in CONTEXT): answer per door, in this shape. First one line: \"N of the M doors that share X's crowd aren't on your plan. Each one's reason, and what would change it:\". Then one line per door in not_on_your_plan, each starting with \"- \" and the door's name (its rank in brackets when it has one), then its reason in your words, then its fix line from why_not_ask word for word; one door per line, and never another door's fix or any other logistics (no fix: say so). Then one line \"My pick: <door> first.\" naming the door you'd add first and why (its rank, its popularity, the shared crowd, a fact from CONTEXT), ending with that door's fix line word for word.",
  "If a tool returns an error, fix the call or ask one short question.",
  "Advice on what to say or do is for current_door, or for next_door when current_door_logged is true, unless the user names a door.",
  "Answer only the user's last message; earlier messages are already handled, never redo a change they asked for.",
  "The stop after a door is the next stop on that door's own day (its stop field in CONTEXT; the stop after the last stop of a day is the first stop of the next plan day). next_door is the first door not yet visited from today on: it is the answer to \"where do I go next?\" with no door named, never to \"what comes after X?\". A stop's number on its day (\"stop 2 of 6\") is not a rank: say it as it is, or leave it out.",
  "A stop's arrival time is on its own day. now is the time on today only: a time on a later day has not passed (say it with its day, \"Monday around 2 pm\"), and never tell the user to go now to a door whose day is not today, or call that day today.",
  "Offer only a change your tools make (replan, edit_talking_points, log_visit, save_note, remember, draft_follow_up). When the user's last message says yes to a change you offered in your last reply (\"yes please\", \"do it\"), make that change now with the tool. If a change tool returns an error, fix the call and make it again in this turn (another index, a line without the word it names); if it still fails, say in plain words what stopped it (\"Doors doesn't put 'pour' in a line\") and offer the fix. Never say \"the system\", \"the tool\" or \"rejected\".",
  "Never claim something happened that CONTEXT doesn't show (a visit, a pitch, a talk, an order): a door with nothing logged hasn't been visited.",
  "Follow the user's rules in CONTEXT (your_rules) in every reply: never use a never_say word, use say_instead's words; the brand's own name stays as it is.",
  "A contact's name is shown to you as \"the contact\"; write it that way. The user's own name is shown as [your name]; write it that way (Doors fills it in).",
  "WORDS (Doors' glossary): a bar or restaurant is a door (never room, venue or account); a door's turn in a day is a stop; its people are its crowd or regulars; Qloo's 0–1 number is affinity, its place on the list is rank (\"#4 of 55 on Your list\", never \"Qloo ranks it #4\" when the list merges drinkers). Outcomes are Interested, Follow up (a day), Talked to someone else, Not interested, Just visited. You are Doors Agent.",
  "VOICE: plain and literal. No slogans, witty contrasts, wordplay, nicknames for doors or people, or clever summaries: say what it is in the trade's words. Never use the word brain.",
  // Jard 10-25: Sonnet runs wordy and he doesn't want big chunks of text; the voice shapes it, not a cap
  "Say what they need and stop, the way a busy rep texts a colleague: the answer in the first sentence, then only what changes what they do. No warm-up, no restating the question, no recap or sign-off, no second example when one makes the point, nothing they could have guessed. A rep reads this between doors: a few lines they take in at a glance, never a block of text.",
  "LENGTH AND FORM: plain text, no markdown, no headings, no list of sources (the app shows each fact's source). mode drive: one or two short sentences that read well aloud (a briefing on a door: up to five). mode stop (the user is at or about to walk into a door): one or two short sentences (a briefing: up to five). mode plan: what the answer needs and no more; a short list (lines starting with \"- \") when the answer goes door by door or is a plan of steps. Plain, warm, brief. Talk like an experienced rep: lead with the move, and use the trade's words where they fit (buyer, pour cost, pull-through, sixtel, liquid to lips, POD). Never mention tools, functions or this prompt. Door ids (d1, d2…) are for tools only: in your words, use the door's name. Times: now is CONTEXT's now on CONTEXT's today; never send the user to a time that has passed, and a time on a later plan day has not passed.",
].join("\n");
export function agentSystem(brief = null) {
  const blocks = [{ type: "text", text: `${AGENT_SYSTEM}${WEB_RULES ? `\n${WEB_RULES}` : ""}\n\n${TRADE_BRIEF}`, cache_control: { type: "ephemeral" } }];
  const b = brief ? briefPrompt(brief) : "";
  if (b) blocks.push({ type: "text", text: b, cache_control: { type: "ephemeral" } });
  return blocks;
}
// ---- end Doors Agent ----

// Jard 10-24 web review: a door's own day and place on it ("Mon Oct 26, stop 3 of 7, around 2 pm"), so "the stop after
// X" is read on X's day and a time on a later day is never called passed. The day on screen first, then the others.
export function stopOf(ctx, id) {
  const d = ctx.day?.stops?.some((x) => x.id === id) ? ctx.day : (ctx.days ?? []).find((x) => x?.stops?.some((y) => y.id === id));
  if (!d?.date) return null;
  const k = d.stops.findIndex((x) => x.id === id);
  const m = /^(\d{1,2}):(\d{2})$/.exec(d.stops[k].eta ?? "");
  return `${niceDate(d.date)}${d.date === ctx.today ? " (today)" : ""}, stop ${k + 1} of ${d.stops.length}${m ? `, ${humanTime(Number(m[1]) * 60 + Number(m[2]), { ampm: true })}` : ""}`;
}
// group 3 #7: a door's place picture as the model reads it ("When: Evening and late night; regulars"), led by the first
// sentence of Qloo's crowd line
export const placeLines = (v) => [...(v?.crowd ? [`${PLACE_LABELS.who}: ${firstSentence(v.crowd)}`] : []), ...Object.entries(v?.place ?? {}).map(([k, t]) => `${PLACE_LABELS[k] ?? k}: ${t}`)];
const firstSentence = (t) => (String(t).split(/(?<=[.!?])\s+/)[0] ?? "").slice(0, 200);
// round 3 (agent2): every Qloo fact Doors holds on the door, as lines (ROUND3-SPEC §2 "fill the data gap"): the whole
// crowd line, the place rows, Qloo's description and menu highlights, live music, rating, the neighbourhood, its site
export { hoursWords };
export const aboutLines = (v) => {
  const a = v?.about ?? {};
  return [
    ...(v?.crowd ? [`${PLACE_LABELS.who} (Qloo): ${String(v.crowd).slice(0, 400)}`] : []),
    ...Object.entries(v?.place ?? {}).map(([k, t]) => `${PLACE_LABELS[k] ?? k}: ${t}`),
    ...(a.description ? [`Qloo's description: ${a.description}`] : []),
    ...(a.menu?.length ? [`Menu highlights (Qloo's menu tags): ${a.menu.join(", ")}`] : []),
    ...(a.liveMusic && !/live music/i.test(v?.place?.room ?? "") ? ["Live music (Qloo)"] : []),
    ...(typeof a.rating === "number" ? [`Rating ${a.rating} of 5 (Qloo)`] : []),
    ...(a.neighborhood ? [`Neighbourhood: ${a.neighborhood}`] : []),
    ...(a.site ? [`Its own site: ${a.site}`] : []),
  ];
};
export function promptOf(messages, ctx, names = [], alias = null) {
  // the doors by id and name; the talking points of the current door only (the others come back from the tools)
  const ref = (id) => alias?.short.get(id) ?? id;
  // live check 2 (F4): the rep's rules reach the model (they were only applied to its reply, and "never say" not at all)
  const rules = rulesOfContext(ctx);
  // fix9 (F4): and to what it reads: a never-say word in the product line ("cider" in "Dry hard cider") or the talking
  // points made it say the word, and every sentence of its reply was dropped
  const keep = [ctx.profile.brand, ...Object.values(ctx.doors).map((v) => v.name)];
  const ruled = (x) => (typeof x === "string" ? (applyRule(x, rules, { keep, soften: { what: ctx.profile.what } }) ?? "") : Array.isArray(x) ? x.map(ruled) : x && typeof x === "object" ? Object.fromEntries(Object.entries(x).map(([k, v]) => [k, ruled(v)])) : x);
  // round 3 (agent2): every door carries its kind, its popularity in words, its hours, about_the_place (every Qloo fact
  // Doors holds) and its insight lines; the day's doors and the current and next door carry their talking points
  const near = (id) => id === ctx.current || id === ctx.nextDoor || ctx.day.stops.some((x) => x.id === id);
  const pop = (x) => popWords(x) || null; // round 3: words only, so the model never sees (or repeats) 0.99
  const doors = Object.entries(ctx.doors).map(([id, v]) => ({ id: ref(id), name: v.name, ...(v.about?.kind ? { kind: v.about.kind } : {}), ...((x) => (x ? { stop: x } : {}))(stopOf(ctx, id)), rank: v.rank, ...(v.N ? { of: v.N } : {}), ...(pop(v.popularity) ? { popularity: pop(v.popularity) } : {}), on_plan: v.plan ? v.plan.on : null, ...(v.plan && !v.plan.on ? { why_not: `${v.plan.head} ${v.plan.reason}` } : {}), status: v.status, outcome: v.outcome?.result ? RESULT_TEXT[v.outcome.result] ?? v.outcome.result : null, ...(hoursWords(v.hours) ? { hours: hoursWords(v.hours) } : {}), ...(v.notes?.length ? { notes: v.notes.slice(0, near(id) ? 6 : 2).map((n) => ruled(n.text)) } : {}), ...(near(id) && v.talk ? { talk: ruled(v.talk) } : {}), ...(aboutLines(v).length ? { about_the_place: aboutLines(v).map(ruled) } : {}), ...(v.insight?.lines?.length ? { insight: v.insight.lines.map(ruled), ...(v.insight.site ? { insight_source: `${v.insight.site.url}${v.insight.site.captured ? ` (read ${v.insight.site.captured})` : ""}` } : {}) } : {}) }));
  // WHY-VIZ-SPEC §4.5: the thread panel's ask, with each door's fix line from the table (the model uses it word for word)
  const whynot = ctx.whynot ? { why_not_ask: { about: ctx.whynot.selected.name, doors_that_share_its_crowd: ctx.whynot.doors.length + ctx.whynot.onPlan.length, on_your_plan: ctx.whynot.onPlan.map((d) => d.name), not_on_your_plan: ctx.whynot.doors.map((d) => ({ name: d.name, rank: d.rank ? `#${d.rank} on Your list` : "not on Your list", reason: d.reason, fix: d.fix?.text ?? "no fix: say that one is their call", ...(d.big ? { big_name: true } : {}), ...(typeof d.popularity === "number" ? { popularity: popWords(d.popularity) } : {}), ...(d.genre ? { type: d.genre, type_pitched: d.pitched } : {}), ...(d.open.length ? { open: d.open } : {}) })), pick: whyNotPick(ctx.whynot)?.name ?? null } } : {};
  const view = { ...whynot, mode: ctx.mode, today: ctx.today, today_is: niceDate(ctx.today), now: ctx.now, city: ctx.city.name, brand: ctx.profile.brand, product: ruled(ctx.profile.what), ...(ctx.profile.product ? { product_details: ctx.profile.product } : {}), ...(ctx.profile.drinkers ? { your_drinkers: ruled(ctx.profile.drinkers), your_drinkers_is: "the user's own words about who drinks their product; not Qloo's data, not about any door" } : {}), ...(ctx.profile.price ? { price: ctx.profile.price } : {}), ...(ctx.profile.ask ? { your_ask: ruled(ctx.profile.ask) } : {}), ...((m) => (m ? { price_math: m } : {}))(marginLine(ctx.profile)?.text), plan_days: ctx.windows.map((w) => w.date), day: ctx.day.date, ...(ctx.day.date ? { day_is: `${niceDate(ctx.day.date)}${ctx.day.date === ctx.today ? " (today)" : ctx.day.date > ctx.today ? " (ahead: none of its times have passed)" : ""}` } : {}), day_hours: (({ from, to } = {}) => (from && to ? `${from}-${to}` : null))(ctx.windows.find((w) => w.date === ctx.day.date)), max_doors_a_day: ctx.maxPerDay, stops_in_order: ctx.day.stops.map((x) => `${ref(x.id)} (eta ${x.eta || "?"})`), current_door: ctx.current ? ref(ctx.current) : null, ...(ctx.current && (ctx.doors[ctx.current]?.status || ctx.doors[ctx.current]?.outcome) ? { current_door_logged: true } : {}), next_door: ctx.nextDoor ? ref(ctx.nextDoor) : null, ...(rules.avoid.length || rules.terms.length ? { your_rules: { never_say: rules.avoid, say_instead: rules.terms.map((t) => ({ say: t.to, not: t.from })) } } : {}), doors };
  // live check (A): Llama re-ran an earlier message's replan; the earlier turns are marked done, the last one stands apart
  const earlier = messages.slice(0, -1).map((m) => `${m.role === "user" ? "Rep" : "You"}: ${m.role === "user" ? personalOut(m.text) : m.text}`).join("\n");
  // Doors Agent: drive mode's answer is spoken, so its length is restated next to the ask (live eval 10-23: Haiku gave
  // four sentences in drive mode with the rule only in the system prompt)
  // group 3 #7 (Jard 10-24: "tell me about this next stop" got one generic line): a briefing runs longer, in every mode
  const words = messages.at(-1)?.text ?? "";
  const brief = asksBrief(words);
  const last = `Rep: ${personalOut(words)}${ctx.whynot ? "\n(why_not_ask in CONTEXT: answer per door in the shape ABILITIES gives, each door's fix line word for word, then My pick)" : brief ? `\n(a briefing: call brief_door, then three facts about this door, what to say, what to watch for; ${ctx.mode === "plan" ? "a short list is fine" : "at most five short sentences, spoken aloud, no list, no menu caveat"})` : ctx.mode === "drive" ? "\n(drive mode: one or two short sentences, spoken aloud)" : ctx.mode === "stop" ? "\n(at a stop: one or two short sentences)" : ""}`;
  // Privacy: phone numbers, emails and what a note says about a person never reach a model (slots.forModel)
  return redact(`CONTEXT ${JSON.stringify(forModel(view, names))}\n\n${earlier ? `EARLIER (already handled)\n${earlier}\n\n` : ""}ANSWER THIS\n${last}`, names);
}

// ---------- R9 free models: what makes small models' tool calls land ----------
// Door ids are long UUIDs: ~a third of the prompt's tokens and easy for Llama 8b to miscopy. The model sees d1, d2…
// (in the day's order, then the rest); its calls are mapped back, so a real id still works.
const ID_ARGS = ["door_id", "door_ids", "skip", "lock", "add"];
export function doorAlias(ctx) {
  const ids = [...new Set([...ctx.day.stops.map((x) => x.id), ...Object.keys(ctx.doors)])];
  const short = new Map(ids.map((id, i) => [id, `d${i + 1}`]));
  const long = new Map(ids.map((id, i) => [`d${i + 1}`, id]));
  return { short, long, ids };
}
const unalias = (alias, x) => (typeof x === "string" ? (alias.long.get(x.trim().toLowerCase()) ?? x) : x);
const aliasText = (alias, t) => alias.ids.reduce((acc, id) => (acc.includes(id) ? acc.split(id).join(alias.short.get(id)) : acc), t);
// Arguments as the schema types them: Llama 8b sends "true", "3" and a lone string for a list.
export function coerceArgs(params, args, alias = null) {
  const out = {};
  const props = params?.properties ?? {};
  for (const [k, v0] of Object.entries(args && typeof args === "object" && !Array.isArray(args) ? args : {})) {
    let v = v0;
    const type = props[k]?.type;
    if (type === "boolean" && typeof v === "string") v = /^true$/i.test(v.trim()) ? true : /^false$/i.test(v.trim()) ? false : v;
    else if (type === "integer" && typeof v === "string" && /^\s*-?\d+\s*$/.test(v)) v = Number(v);
    else if (type === "array" && typeof v === "string") v = /^\s*\[/.test(v) ? (safeJson(v) ?? [v]) : v.split(",").map((x) => x.trim()).filter(Boolean);
    // an empty optional arg is no arg: Llama 8b fills each one ("None", "[]", max_doors 0)
    const optional = !(params?.required ?? []).includes(k);
    if (v == null || v === "" || (typeof v === "string" && /^(none|null|undefined|n\/a)$/i.test(v.trim()))) continue;
    if (optional && ((Array.isArray(v) && !v.length) || (type === "integer" && v === 0))) continue;
    if (alias && ID_ARGS.includes(k)) v = Array.isArray(v) ? v.map((x) => unalias(alias, x)) : unalias(alias, v);
    out[k] = v;
  }
  return out;
}
const safeJson = (t) => {
  try {
    return JSON.parse(t);
  } catch {
    return null;
  }
};
// One change of each kind per turn: Llama re-calls replan / log_visit / the same edit after seeing its result.
const callKey = (name, a) => (name === "edit_talking_points" ? `${name}|${a.door_id}|${a.section}|${a.index ?? 0}` : name === "remember" ? `${name}|${a.door_id ?? "*"}|${a.field}` : ["replan", "log_visit", "draft_follow_up"].includes(name) ? name : null);

// ---- live check (A): an old change re-run ----
// Llama 70b re-ran turn 1's replan on turn 2's "why is it on my list?". A change is made only when the rep's last
// message asks for that kind of change, and a replan that changes nothing on the day as it stands is refused.
const ASKS_REPLAN = /\b(skip|cut|drop|lose|remove|leave|until|by|finish|end|done|start|now|lock|keep|add|include|max|most|only|fewer|more|re-?plan|reorder|move|swap|instead|tomorrow|today|day|time|hours?|earlier|later|out|\d{1,2}(:\d{2})?\s*(am|pm)?)\b/i;
const ASKS_TALK = /\b(opener|open|opening|points?|questions?|pushback|objections?|ask|line|lines|say|pitch|talk|shorter|longer|shorten|rewrite|reword|changes?|edits?|replace|swap|add|remove|drop|mention|softer|tone|wording|words?)\b/i;
// Jard 10-24 web review: the agent offered "Want me to make those two edits?", the rep said "yes please" (then "make the
// two edits") and both were refused as stale. A short yes to the agent's own offer asks for the change it offered.
const YES = /^\s*(?:yes|yeah|yep|yup|sure|ok(?:ay)?|please(?: do)?|go ahead|do it|do that|do those|do both|sounds good|perfect|great|let'?s do (?:it|that)|make (?:it|them|those|that|the|both))\b/i;
// the agent's last reply offered something ("Want me to make those two edits?", "Shall I make them?" before a list)
const OFFERED = /\?\s*$|\b(?:want me to|shall i|should i|like me to|do you want|i can (?:make|change|swap|add|log|move)|ok to|okay to)\b[^?]{0,200}\?/i;
export const saysYes = (words) => YES.test(String(words ?? "")) && String(words).trim().length <= 80;
// the rep's words, with the agent's offer they answer when they are a short yes to it
export function askedFor(words, prev) {
  return saysYes(words) && OFFERED.test(String(prev ?? "")) ? `${prev} ${words}` : words;
}
export function staleChange(name, args, words, ctx, prev = null) {
  // a question with visit words in it ("…call back next week?") is answered, never logged
  if (name === "log_visit" && isQuestion(words)) return "the rep's last message is a question, not how a visit went: answer it, log nothing";
  words = askedFor(words, prev);
  if (name === "replan") {
    if (!ASKS_REPLAN.test(words)) return "the rep's last message asks for no change to the day: answer it, change nothing";
    const w = ctx.windows.find((x) => x.date === (args.day ?? ctx.day.date));
    const onDay = new Set(ctx.day.stops.map((x) => x.id));
    const skip = (Array.isArray(args.skip) ? args.skip : []).filter((x) => onDay.has(x));
    const newMax = args.max_doors != null && args.max_doors !== ctx.maxPerDay;
    const rest = newMax || ["start_now", "lock", "add"].some((k) => args[k] != null && args[k] !== false && !(Array.isArray(args[k]) && !args[k].length));
    const sameEnd = args.end_by == null || (w?.to && args.end_by.padStart(5, "0") === w.to.padStart(5, "0"));
    if (sameEnd && !skip.length && !rest && (args.end_by != null || args.max_doors != null || (args.skip ?? []).length)) return `nothing to change: the day already ${[args.end_by != null && `ends at ${args.end_by}`, args.max_doors != null && `has up to ${args.max_doors} doors`, (args.skip ?? []).length && "leaves those doors out"].filter(Boolean).join(" and ")}`;
  }
  if (name === "edit_talking_points" && !ASKS_TALK.test(words)) return "the rep's last message asks for no talking-point change: answer it, change nothing";
  return null;
}
// ---- end live check (A) ----

// ---------- one turn ----------
// → the §1.1 response (or the rules answer, labelled resting, when no model answers)
export async function agentTurn({ messages, ctx, env, ip = "local", tools = TOOLS, first = true }) {
  const usage = []; // Doors Agent: this turn's Anthropic usage (tokens, $), on the response as cost
  // live check 2 (F2, F5): a rule or a coaching question Doors answers itself: no model, a real action, its sources
  // the site's Claude $ for today (one read of the book, src/spend.js); spent or unreadable → the free chain
  const room = env.ANTHROPIC_API_KEY && !env.AGENT_SESSION ? await claudeRoom(env) : null;
  let passedOver = room && !room.ok ? room.reason : null; // why Claude was passed over: the reply's notice
  let roomRead = Boolean(room?.ok); // room is fresh: no Claude call since it was read
  const claudeUp = Boolean(room?.ok && Date.now() >= (coolUntil.get(String(env.AGENT_MODEL || AGENT_MODEL).trim()) ?? -Infinity));
  // §4.5: the why-not ask goes to the model when one is there (Claude, or the tests' stub); the rules compose it otherwise
  const own = first ? answerFirst(messages, ctx, { now: `${ctx.today}T${ctx.now.padStart(5, "0")}`, coaching: !claudeUp, model: claudeUp || Boolean(env.AGENT_SESSION) }) : null;
  if (own) return { ...own, ...(passedOver ? { notice: claudeNotice(passedOver) } : {}), left: turnsLeft(env, ip) };
  // the 70b re-run 10-23 (F8): without Doors Agent, a visit the rules can log is theirs ("done, owner wasn't in,
  // back saturday at 3pm": Llama 70b saved a note and never logged the visit, 3/3). answerByRules keeps its own order,
  // so "I have to be done by 4:30" stays a re-plan; only a visit it logged is taken, else the model goes on
  // (a free model is set up; with none the resting path below answers it the same, labelled resting)
  if (first && !claudeUp && !env.AGENT_SESSION && (env.AI?.run || env.GEMINI_API_KEY)) {
    const r = answerByRules(messages, ctx, { now: `${ctx.today}T${ctx.now.padStart(5, "0")}` });
    if (r.tools?.some((x) => x.name === "log_visit" && x.ok)) return { ...r, ...(passedOver ? { notice: claudeNotice(passedOver) } : {}), left: turnsLeft(env, ip) };
  }
  let replanned = false; // R9 red team: one re-plan a turn (each runs the client's planner)
  // F14: stored names (and their first and last names, in redact) plus any name the stored lines or the chat give a
  // person ("Ask for Jordan", "talked to Dana"): none reaches a model
  const me = meOf(ctx);
  const names = [...new Set([...contactNames(ctx), ...notPlaces([...namesIn(JSON.stringify({ doors: ctx.doors, envelopes: ctx.envelopes })), ...messages.flatMap((m) => namesIn(m.text))], [ctx.profile.brand, ctx.city.name, ...Object.values(ctx.doors).map((v) => v.name)])])].filter((n) => !me || (n !== me.full && !me.parts.includes(n)));
  const words = messages.at(-1).text;
  const now = `${ctx.today}T${ctx.now.padStart(5, "0")}`;
  const failed = [];
  if (passedOver) failed.push(`claude:${passedOver === "spent" ? "spent" : "unreadable"}`);
  if (env.AI?.run && !env.AGENT_SESSION && !workersAiChain(env).length) failed.push("workers-ai:neurons"); // the day's share is used
  const t0 = Date.now();
  let list = sessions(env, Date.now(), ip, ctx, usage, words, Boolean(room?.ok));
  // live check D: models skipped because they are cooling are named, so the resting copy says busy (or, for a model
  // whose day is spent, for today)
  failed.push(...(list.skipped ?? []));
  for (let i = 0; i < list.length; i++) {
    const { by, model, make } = list[i];
    if (Date.now() - t0 > TURN_MS) break;
    const facts = [];
    const actions = [];
    const drafts = []; // ability 4: follow-up drafts, opened in the rep's own app (never sent)
    const ran = [];
    try {
      const alias = doorAlias(ctx);
      const done = new Set();
      const claude = by === "anthropic";
      const user = meOut(promptOf(messages, ctx, names, alias), me);
      const sess = make({ system: claude ? agentSystem(ctx.specialistBrief) : SYSTEM, user, tools });
      // Doors Agent: what the model was shown (CONTEXT and every tool result) backs a number it repeats ("stop 4")
      let shown = claude ? user : "";
      let toolText = ""; // the tool results alone (R2: door facts; CONTEXT carries the user's own drinker words)
      const web = { searched: false, pool: "" }; // web honesty: what the pages the model read said
      let text = "";
      for (let step = 0; step < MAX_STEPS; step++) {
        if (step > 0 && Date.now() - t0 > TURN_MS) break; // past the turn's budget: answer from what the tools gave
        if (!modelCall(env)) throw Object.assign(new Error("model day spent"), { resting: "model" });
        // each Claude step first asks the site's book (another isolate may have used the day's $); the turn's
        // first Claude step goes on the read agentTurn just made
        if (claude) {
          const r = roomRead ? room : await claudeRoom(env);
          roomRead = false;
          if (!r.ok) throw Object.assign(new Error(`Claude ${r.reason}`), { claudeOff: r.reason });
        }
        const out = await sess.step();
        text = (claude ? textOfBlocks(out.content) : null) ?? out.text ?? "";
        if (out.content) facts.push(...webFacts(out.content, ip)), webSeen(out.content, web); // a web search's cited pages (src/brief.js)
        if (!out.calls?.length) break;
        const results = out.calls.slice(0, 4).map((call) => {
          const tool = tools.find((t) => t.name === call.name);
          const args = meBack(coerceArgs(tool?.parameters, call.args, alias), me); // an edited line or a draft: the user's own name
          const key = callKey(call.name, args);
          if (key && done.has(key)) return { call, result: { ok: true, note: "already done this turn; now answer the rep" } };
          // R9 red team: one re-plan per message
          const stale = tool ? staleChange(call.name, args, words, ctx, messages.at(-2)?.role === "agent" ? messages.at(-2).text : null) : null;
          const r = !tool ? { ok: false, error: `no tool called ${call.name}` } : stale ? { ok: false, error: stale } : call.name === "replan" && replanned ? { ok: false, error: "the day is already being re-planned this turn: one re-plan per message" } : runTool(call.name, args, ctx, { by: `agent:${by}`, words, now });
          if (call.name === "replan" && r.ok) replanned = true;
          ran.push({ name: call.name, ok: r.ok });
          if (r.ok) {
            if (key) done.add(key);
            facts.push(...(r.facts ?? []));
            actions.push(...(r.actions ?? []));
            drafts.push(...(r.drafts ?? []));
          }
          return { call, result: JSON.parse(meOut(aliasText(alias, JSON.stringify(forModel(r.ok ? { ok: true, ...(r.data ?? {}) } : { ok: false, error: r.error }, names))), me)) };
        });
        if (claude) shown += ` ${JSON.stringify(results.map((x) => x.result))}`;
        toolText += ` ${JSON.stringify(results.map((x) => x.result))}`;
        sess.addResults(results);
        if (step === MAX_STEPS - 1) text = "";
      }
      // live check (A): the steps ran out on a tool call (no words for the rep): one last step that may only answer
      if (!text.trim() && ran.length && sess.answer && Date.now() - t0 < TURN_MS && (!claude || (await claudeRoom(env)).ok) && modelCall(env)) {
        const last = await sess.answer();
        text = (claude ? textOfBlocks(last.content) : null) ?? last.text ?? "";
        if (last.content) facts.push(...webFacts(last.content, ip)), webSeen(last.content, web);
      }
      // live check: the model sees "the contact" for a name (redacted) and says "is called the contact"; a contact kept
      // this turn is in the rep's own words, so the reply to the rep gives the name back
      const kept = actions.find((a) => a.type === "slot" && a.record?.field === "contact")?.record?.value?.name;
      // phone live run: the planner runs on the client and may move a skipped door to another day, so the model can't
      // know what a re-plan did ("removed the hotel" when it went to Tuesday): the reply says what was asked, from the
      // action, and the line under it (the client's) says where each door went
      const re = actions.find((a) => a.type === "replan");
      // Doors Agent (live eval 10-23): Haiku writes the door aliases in its prose ("Nomadic Beerworks (d6, #1)"), and a
      // sentence with an id is dropped whole: the alias goes, or becomes the door's name
      // the free models too ("You have a stop at d1, The Drafting Room")
      text = meBack(namesForAliases(text, alias, ctx), me); // before the cleaner: it drops a sentence with brackets
      const backingWeb = { facts, words: claude ? `${words} ${shown}` : words, asked: words, actions, shown: toolText, ...(web.searched ? { web: `${web.pool} ${ctx.specialistBrief ? briefPrompt(ctx.specialistBrief) : ""}` } : {}) };
      let reply = (re ? replanSay(re, ctx) : cleanReply(text, ctx, backingWeb, claude ? { loose: true } : {}) || fallbackReply(ran, facts, actions, ruleHit(text, ctx), { ctx, messages })).replace(/\bthe contact\b/g, (m) => kept ?? m);
      // web honesty: a sentence the pages didn't back was left out; say so, with the move
      const thin = (t) => /^Page read: /.test(t) || t.replace(/[^\p{L}]/gu, "").length < 40; // "Yes, probably." is not an answer
      if (web.searched && (thin(reply) || backingWeb.webDropped)) reply = thin(reply) ? WEB_UNSURE : `${reply} ${WEB_UNSURE_TAIL}`.trim();
      // door notes: the same words noted twice in one turn (log_visit's note and a save_note) are one note
      const net = noteNet({ actions: dedupeNotes(actions), words, ctx, by, now });
      if (net.say && !reply.includes(net.say)) reply = `${reply} ${net.say}`.trim();
      // WHY-VIZ-SPEC §4.5: the per-door answer carries each door's fix from the table and no other; else the rules' text
      let whynot = null;
      if (ctx.whynot) {
        const wn = whyNotNet(reply, ctx.whynot);
        reply = wn.reply;
        whynot = { ...whyNotPayload(ctx.whynot), ...(wn.fallback ? { fallback: true } : {}) };
        facts.push(...whyNotAnswer(ctx.whynot).facts);
      }
      return { v: 1, reply, facts: dedupe(facts), actions: net.actions, tools: ran, by, ...(whynot ? { whynot } : {}), ...(passedOver && !claude ? { notice: claudeNotice(passedOver) } : {}), ...(net.offer ? { offerNote: net.offer } : {}), ...(drafts.length ? { drafts: drafts.slice(-1) } : {}), ...(modelName(by, model) ? { model: modelName(by, model) } : {}), ...(usage.length ? { cost: costOf(usage) } : {}), ...(env.AGENT_DEBUG ? { raw: text, ...(web.searched ? { webPool: web.pool.slice(0, 20000) } : {}) } : {}), left: turnsLeft(env, ip) };
    } catch (e) {
      if (e?.resting) {
        failed.push("spent");
        break; // the day's model calls are spent: rules, below
      }
      if (e?.claudeOff) {
        // the site's Claude $ ran out during the turn: no other Claude session, the free chain goes on
        passedOver = e.claudeOff;
        failed.push(`${model}:${e.claudeOff === "spent" ? "spent" : "unreadable"}`);
        list = list.filter((x, j) => j <= i || x.by !== "anthropic");
        continue;
      }
      // this model failed (quota, timeout, bad output): the next one, else the rules. Logged (never the key or the text).
      const kind = errKind(e);
      if (model) coolUntil.set(model, Date.now() + Math.max(COOLDOWN_MS, e?.coolMs ?? 0));
      failed.push(`${model ?? by}:${kind}`);
      if (kind === "spent") {
        // Cloudflare says the day's free neurons are used (account-wide): no other Workers AI model, but Gemini still
        // (live check 2, F1: a break here skipped Gemini on the first turn after the neurons ran out)
        neuronDay.n = Infinity;
        list = list.filter((x, j) => j <= i || x.by !== "workers-ai");
        continue;
      }
      console.warn(`[agent] ${model ?? by} failed: ${kind}${kind !== "timeout" ? ` (${String(e?.message ?? e).slice(0, 160)})` : ""}`);
    }
  }
  const r = answerByRules(messages, ctx, { now });
  // modelError: why no model answered ("gemini:timeout", "gemini:429", "workers-ai:error", "spent", "none"), for clients' logs
  const message = restingMessage(failed);
  // retry: a transient failure (asking again soon may reach a model), R9 polish
  return { ...r, resting: true, reason: "model", modelError: failed.join(",") || "none", message, ...(message === AGENT_BUSY ? { retry: true } : {}), left: turnsLeft(env, ip) };
}

// ---- WHY-VIZ-SPEC §4.5: the net under the model's per-door answer ----
// Each door off the plan must be on its own line with its fix line from the table (word for word; the "(open …)" and
// "Lock it to <day>" variables aside) and no other door's; a "My pick" line names one of those doors with its own fix;
// no other line carries a table fix. Anything else → the rules' composed text (threadAnswer's), so no fix outside the
// table ever reaches the user. A missing pick line gets the rules' pick.
const fixBase = (t) => String(t ?? "").toLowerCase().replace(/\s*\(open [^)]*\)/g, "").replace(/lock it to \S+ and doors/g, "lock it to that day and doors").replace(/\s+/g, " ").trim();
const FIX_BASES = FIX_ROWS.map((r) => fixBase(r.text({ open: [], day: null, type: "bars" }))).filter(Boolean);
const lowName = (t) => String(t ?? "").toLowerCase().replace(/\s+/g, " ").trim();
export function whyNotNet(text, ask) {
  const { pick } = whyNotLines(ask);
  const off = ask.doors ?? [];
  const lines = String(text ?? "").split(/\n+/).map((x) => x.trim()).filter(Boolean);
  const names = (l) => off.filter((d) => lowName(l).includes(lowName(d.name)));
  const own = (d) => (d.fix ? fixBase(d.fix.text) : null);
  const rogue = (l, d) => FIX_BASES.some((f) => f !== own(d) && fixBase(l).includes(f)) || (own(d) && fixBase(l).split(own(d)).length > 2);
  let ok = off.length > 0 && lines.length > 0;
  for (const d of off) {
    if (!ok) break;
    const line = lines.find((l) => !/^my pick\b/i.test(l) && names(l).includes(d));
    ok = Boolean(line) && (!d.fix || fixBase(line).includes(own(d))) && !rogue(line, d) && names(line).length === 1;
  }
  const pickLine = lines.find((l) => /^my pick\b/i.test(l));
  if (ok && pickLine) {
    const d = names(pickLine)[0] ?? null;
    ok = Boolean(d) && !rogue(pickLine, d);
  }
  if (ok) for (const l of lines) if (!names(l).length && FIX_BASES.some((f) => fixBase(l).includes(f))) ok = false;
  if (!ok) return { reply: whyNotText(ask), fallback: true };
  return { reply: pickLine || !pick ? String(text).trim() : `${String(text).trim()}\n${pick.text}` };
}
// ---- end §4.5 ----
// ---- door notes (Jard 2026-10-23): the net under the model's own save_note ----
// The model decides what's worth a note. When it noted nothing and logged nothing: a rep who asked for a note ("note
// that…", "remember…") gets it, saved by code and said; a fact that will matter later ("the manager is Priya, back
// Thursdays") is offered (offerNote: the panel's "Save as a note" button), never saved unasked.
const isNoteAct = (a) => a.type === "slot" && a.record?.field === "note";
export function dedupeNotes(actions) {
  const seen = [];
  return actions.filter((a) => !isNoteAct(a) || (!hasNote(seen.filter((x) => x.id === a.id).map((x) => x.text), a.record.value) && seen.push({ id: a.id, text: a.record.value })));
}
export function noteNet({ actions, words, ctx, by, now }) {
  if (actions.some((a) => isNoteAct(a) || a.type === "outcome") || isQuestion(words)) return { actions };
  const w = worthNoting(words);
  const id = w ? (doorNamed(words, ctx) ?? ctx.current) : null;
  if (!w || !id || !ctx.doors[id]) return { actions };
  if (!w.explicit) return { actions, offer: { id, name: ctx.doors[id].name, text: w.text } };
  const r = runTool("save_note", { door_id: id, text: w.text }, ctx, { by: `agent:${by}`, words, now });
  if (!r.ok) return { actions };
  if (r.data?.already) return { actions, say: `That's already in your notes on ${ctx.doors[id].name}.` };
  return { actions: [...actions, ...r.actions], say: `Noted on ${ctx.doors[id].name}.` };
}
// ---- end door notes ----

// "(d6, #1 at 0.91)" → "(#1 at 0.91)", "(d6)" → "", "skip d6" → "skip Nomadic Beerworks"; an unknown dN stays (and
// cleanReply drops its sentence)
export function namesForAliases(text, alias, ctx) {
  const name = (a) => ctx.doors[alias.long.get(a.toLowerCase())]?.name;
  return String(text ?? "")
    .replace(/\(\s*(d\d{1,2})\s*\)/gi, (m, a) => (name(a) ? "" : m))
    .replace(/\(\s*(d\d{1,2})\s*[,;:]\s*/gi, (m, a) => (name(a) ? "(" : m))
    .replace(/[,;]\s*(d\d{1,2})\s*\)/gi, (m, a) => (name(a) ? ")" : m))
    // Llama's "The Drafting Room, d1, first today": the alias after the name goes
    .replace(/,\s*(d\d{1,2})\b(?=\s*[,.;!?]|$)/gi, (m, a) => (name(a) ? "" : m))
    .replace(/\b(d\d{1,2}),\s*/gi, (m, a, at, all) => (name(a) && all.slice(at + m.length).startsWith(name(a)) ? "" : m))
    .replace(/\b(d\d{1,2})\b/gi, (m, a) => name(a) ?? m)
    .replace(/ {2,}/g, " ")
    .replace(/ +([,.;)])/g, "$1");
}
// the turn's Anthropic usage, summed: tokens by kind and $ (estimated from PRICE_PER_M)
const costOf = (us) => us.reduce((a, u) => ({ in: a.in + (u.input_tokens ?? 0), out: a.out + (u.output_tokens ?? 0), cacheRead: a.cacheRead + (u.cache_read_input_tokens ?? 0), cacheWrite: a.cacheWrite + (u.cache_creation_input_tokens ?? 0), usd: Math.round((a.usd + u.usd) * 1e6) / 1e6, calls: a.calls + 1 }), { in: 0, out: 0, cacheRead: 0, cacheWrite: 0, usd: 0, calls: 0 });
const errKind = (e) => (e?.name === "TimeoutError" || e?.name === "AbortError" ? "timeout" : /4006|daily free allocation|neurons/i.test(e?.message ?? "") ? "spent" : /(?:Gemini|Workers AI|Anthropic) (\d{3})/.exec(e?.message ?? "")?.[1] ?? (/no content/.test(e?.message ?? "") ? "empty" : "error"));

// The model's text, shown only when it is plain and names nothing Doors never names (artists, avoided words).
// ---- R9 red team: a claim about Qloo's data stands only on this turn's facts ----
// A sentence that speaks for Qloo or its numbers (rank, affinity, popularity, a score, the crowd) is kept only when a
// tool returned facts this turn and every number in it is in those facts or in the rep's own words; else it is
// dropped (the facts under the reply still show what Qloo says).
// (a decimal is Qloo's 0–1 number, never money: "$5.42 a can" dropped a whole pitch)
const CLAIM = /\b(qloo|rank(s|ed|ing)?|affinity|popularity|percentile|score[sd]?|demographics?|crowd)\b|(?<![\d$.])0?\.\d{2}\b/i;
// Doors Agent (loose): only a sentence that speaks for Qloo's numbers (Qloo, rank, affinity, popularity) needs backing,
// so the trade's own math ("$4 a pint", "a 20% pour cost") and know-how about crowds stand
const CLAIM_LOOSE = /\b(qloo|rank(s|ed|ing)?|affinity|popularity|percentile)\b/i;
export function claimsBacked(text, { facts = [], words = "" } = {}, loose = false) {
  const pool = `${facts.map((f) => f?.text ?? "").join(" ")} ${words}`;
  const nums = new Set((pool.match(/\d*\.?\d+/g) ?? []).map(Number)); // by value: "0.6" is the fact's "0.60"
  const numOk = (n) => nums.has(Number(n));
  const NONE = /\b(doesn'?t|does not|don'?t|do not|isn'?t|is not|has no|have no|nothing|no data)\b/i; // "Qloo's data doesn't say"
  const keep = (s) => {
    if (!(loose ? CLAIM_LOOSE : CLAIM).test(s)) return true;
    const ns = s.match(/\d*\.?\d+/g) ?? [];
    if (!ns.length && NONE.test(s)) return true;
    // loose (round 3): a number is backed by anything in front of the model (CONTEXT and tool results are in words), so
    // a rank or popularity read from CONTEXT stands without a tool call; the free models still need a tool's facts
    return (loose || facts.length > 0) && ns.every(numOk);
  };
  // loose: the whitespace between sentences stays (a list's line breaks)
  if (loose) return String(text ?? "").split(/(?<=[.!?])(\s+)/).filter((x, i, all) => (i % 2 ? keep(all[i - 1]) : keep(x))).join("");
  return String(text ?? "").split(/(?<=[.!?])\s+/).filter(keep).join(" ");
}
// ---- end R9 red team ----
// ---- the 70b re-run 10-23: the free models say Qloo's data in trade words ----
// Llama (the fallback whenever Anthropic is out) recited "an affinity score of 0.89 and a popularity score of 0.15"
// after a why-not and in a one-line pitch, and added the door's crowd line to an answer that wasn't about the crowd.
// Its prompt says not to; this is the net under it. A sentence is dropped when it reads out an affinity or popularity
// number (unless the rep asked for those numbers), tells the door's crowd unasked, or, in a pitch or opener the rep
// asked for, speaks of Qloo or rank at all (a line for the bartender). The facts under the reply keep every number.
const RAW_NUMBER = /\b(popularity|percentile)\b|\baffinity\b[^.!?]*\d|(?<![\d$])0?\.\d{2}\b/i;
const ASKS_CROWD = /\b(crowd|who (goes|drinks|comes|are they|is there)|people|clientele|vibe|brief|what do i (need to )?know|tell me about|what about|what kind of)\b/i;
const CROWD_LINE = /\b(crowd|clientele|attracts?|draws? (a|an|in)|frequented)\b/i;
const ASKS_PITCH = /\b(pitch|opener|one[- ]liner|(first|second|opening|next) line|a line)\b/i;
const QLOO_TALK = /\b(qloo|rank(s|ed|ing)?|affinity|popularity|percentile)\b|#\d/i;
export function plainSay(text, words = "") {
  const pitch = ASKS_PITCH.test(words);
  const drop = (x) => RAW_NUMBER.test(x) /* round 3: even when asked (Jard 10-23: decimals are confusing) */ || (!ASKS_CROWD.test(words) && CROWD_LINE.test(x)) || (pitch && QLOO_TALK.test(x));
  return (String(text ?? "").match(SENTENCE) ?? []).filter((x) => !drop(x)).join("").trim();
}
// gigbot 10-24 (live Claude Haiku): "Why is The Stay Put first?" → "rank 7 of 55 … an affinity of 0.87, close to Nomadic
// Beerworks at 0.91". The prompt says not to; this is the net under it for every model (Claude's replies skip plainSay).
// Unless the rep asked for numbers (ASKS_NUMBERS, on the rep's own words): a score clause goes ("with an affinity of
// 0.87", "at 0.91", "(0.87)"), a rank becomes words ("rank 7 of 55" → "near the top of your list"), and a sentence that
// still reads out a score is dropped. The facts under the reply keep every number.
const TIER = (k, n, of) => (k <= 5 || k / n <= 0.2 ? `near the top of ${of}` : k / n <= 0.5 ? `in the top half of ${of}` : `further down ${of}`);
// (a stop's number on its day, "stop 2 of 6", is not a rank: Jard 10-24 replay read "stop near the top of the 6")
const RANK_KN = /(?<![\w#])(?<!\bstops?\s+)(?:(?:sits|is|comes in|it's|it is)\s+)?(?:at\s+)?(?:rank(?=\s)\s+|(rank(?:s|ed)|placed?|comes?)\s+(?:at\s+)?)?(?:no\.\s*|number\s+)?#?(\d+)(?:st|nd|rd|th)?\s+(?:out\s+)?of\s+(?:the\s+)?(\d+)\b(\s+(?:on|in)\s+(?:your|the)\s+(?:list|ranking)\b)?/gi;
const SCORE = /(?<![\d$])0?\.\d{2}\b|\b(?:affinity|popularity)\b[^.!?]*\d/i;
function noScore1(x) {
  if (/^\s*(?:its|their|the|[\p{L}'’ ]{1,40}?['’]s)\s+(?:Qloo(?:'s)?\s+)?(?:affinity|popularity)\b/iu.test(x) && SCORE.test(x)) return ""; // the score is the subject
  const t = x
    .replace(/\s*\((?:[^()]*?)(?:(?<![\d$])0?\.\d{2}|#\d+|\b\d+\s+of\s+\d+)[^()]*\)/g, "")
    .replace(/,?\s*(?:(?:with|and|has|having|giving it|at|for)\s+)?(?:(?:an?|the)\s+)?(?:Qloo(?:'s)?\s+)?(?:affinity|popularity|match)(?:\s+score)?\s*(?:of|is|at|:|=)?\s*(?<![\d$])0?\.\d+/gi, "")
    .replace(/(?<![\d$])0?\.\d{2}\s+(?:affinity|popularity)(?:\s+score)?/gi, "")
    .replace(/\s+(?:at|with|of|on)\s+(?<![\d$])0?\.\d{2}\b/g, "")
    .replace(RANK_KN, (m, verb, k, n, tail, off, all) => {
      const lead = /^(?:sits|is|comes in|it's|it is)\b/i.exec(m)?.[0];
      const after = all.slice(off + m.length);
      const more = !tail && /^\s+[a-z]/i.test(after) && !/^\s+(?:on|in|for|with|and|but|so|because|while|as|to|by)\b/i.test(after);
      return [lead, verb, TIER(+k, +n, more ? `the ${n}` : "your list")].filter(Boolean).join(" ");
    })
    .replace(/\brank(?:ed)?\s+#?\d+\b(?!\s+(?:out\s+)?of)(?:\s+(?:on|in)\s+your\s+list\b)?/gi, "on your list")
    .replace(/\s+,/g, ",").replace(/,\s*([.!?])/g, "$1").replace(/[ \t]{2,}/g, " ");
  if (t === x) return SCORE.test(x) ? "" : x;
  // a sentence the cut left without its head ("and that is low.") or still reading out a score goes
  return SCORE.test(t) || !/^\s*(?:-\s+)?["“(]?[\p{Lu}\d]/u.test(t) || (t.match(/\p{L}+/gu) ?? []).length < 3 ? "" : t;
}
export function noScores(text, asked = "") {
  if (ASKS_NUMBERS.test(asked)) return String(text ?? ""); // asked: the ranks stay as said; noDecimals still takes any 0.xx
  return (String(text ?? "").match(SENTENCE) ?? []).map(noScore1).join("").replace(/^\s+/, "").trim();
}
// Round 3 (gigbot 10-25; Jard 10-23: decimals are "super confusing"): live Sonnet wrote "0.90 affinity and 0.88
// popularity" and "popularity 0.15". Every reply loses a Qloo score clause ("with an affinity of 0.90", "popularity
// 0.15", "(0.88)"); a sentence that still reads out a 0.xx score goes. Money ("$1.58"), ABV ("0.5%") and ranks stay.
const DECIMAL = /(?<![\d$])0?\.\d{2}\b(?!\s*%)/;
export function noDecimals(text) {
  return (String(text ?? "").match(SENTENCE_Q) ?? []).map((x) => {
    if (!DECIMAL.test(x)) return x;
    const t = x
      .replace(/,?\s*(?:(?:with|and|has|having|giving it|at|for)\s+)?(?:(?:an?|the)\s+)?(?:Qloo(?:'s)?\s+)?(?:affinity|popularity|match)(?:\s+score)?\s*(?:of|is|at|:|=)?\s*(?<![\d$])0?\.\d+/gi, "")
      .replace(/,?\s*(?:(?:with|and)\s+)?(?<![\d$])0?\.\d{2}\s+(?:affinity|popularity)(?:\s+score)?(?:\s+and\s+(?<![\d$])0?\.\d{2}\s+(?:affinity|popularity))?/gi, "")
      .replace(/\s*\((?:[^()]*?)(?<![\d$])0?\.\d{2}[^()]*\)/g, "")
      .replace(/\s+,/g, ",").replace(/([:;])\s*,/g, "$1").replace(/(\w)( so\b)/, "$1,$2").replace(/,\s*([.!?])/g, "$1").replace(/[ \t]{2,}/g, " ");
    // a sentence the cut left without its point ("It has a.") goes too
    const gone = DECIMAL.test(t) || (t.match(/\p{L}+/gu) ?? []).length < 3 || /\b(?:a|an|the|of|with|at|and)\s*[.!?]\s*$/i.test(t);
    return gone ? (/\n\s*$/.test(x) ? "\n" : "") : t;
  }).join("");
}
// ---- end the 70b re-run ----
const CLAIMED = /\b(?:I(?:'ve|’ve| have| just| also)*|I'll|I’ll|I will|I've gone ahead and)\s+(?:now\s+|also\s+|gone ahead and\s+)?(?:updated?|changed?|removed?|added|add|saved?|logged|log|edited|edit|replaced?|re-?planned|re-?plan|moved?|noted|note|kept|keep|set|rewr(?:ote|itten|ite)|adjusted|adjust|remembered|remember|deleted?|dropped|drop|skipped|skip|marked|mark|taken out|take out)\b|\bI(?: won'?t| will not| won’t)\s+(?:say|use|mention)\b|\b(?:has|have) been (?:updated|changed|removed|added|saved|logged|noted|edited|replaced|moved)\b/i;
// A reply's sentences; a point between digits is a decimal, not a sentence end (live check 10-23: "affinity score of
// 0.91." was cut at "0." and its "91." dropped as a sentence with no words, so the rep read "an affinity score of 0.")
const SENTENCE = /(?:[^.!?]|\.(?=\d))+[.!?]*/g;
const SENTENCE_Q = /(?:[^.!?]|\.(?=\d))+[.!?]*["”’)\]]*/g; // and a kept sentence's closing quote
// loose (Doors Agent, Anthropic): a reply's line breaks stay (a short list), it may run longer, and only the filters
// that catch a real leak apply (tool names, ids, braces), not the ones written for Llama's narration ("the rep")
export function cleanReply(text, ctx, backing = null, { loose = false, line = false } = {}) {
  // round 3: a Qloo score clause goes first, so the backing checks below don't drop the whole sentence for an
  // unbacked 0.90 and take its rank and its advice with it
  if (loose && !line) text = noDecimals(text); // the free models' path (plainSay, noScores) drops these sentences itself
  // abilities eval 10-23: in a list, a dropped sentence took its line break with it and two lines ran together: each
  // line is cleaned on its own, then the kept lines are joined
  if (loose && !line && /\n/.test(String(text ?? ""))) {
    // a list line whose first sentence was dropped keeps its dash
    const lines = String(text).split(/\n+/).map((x) => [x, cleanReply(x, ctx, backing, { loose, line: true })]).filter(([, y]) => /\p{L}{2}/u.test(y)).map(([x, y]) => (/^\s*-\s/.test(x) && !/^-\s/.test(y) ? `- ${y}` : y));
    const out = lines.join("\n");
    return out.length > 2400 ? out.slice(0, 2400).replace(/[^.!?\n]*$/, "").trim() : out;
  }
  let t = String(text ?? "").replace(/[*_`>]+|#(?!\d)/g, "");

  // a line break rides through the sentence filters (slots.checkReply joins with spaces) as " \u0003 ", put back at the end
  t = (loose ? t.replace(/[^\S\n]+/g, " ").trim().replace(/ *\n[\s]*/g, " \u0003 ") : t.replace(/\s+/g, " ")).trim();
  if (!t) return "";
  // live check 2 (F3, F4): the rep's own rules go through applyRule below (the brand spared), not this avoid list
  const rules = rulesOfContext(ctx);
  const own = new Set(rules.avoid.map((x) => String(x).trim().toLowerCase()));
  const avoid = [...ctx.cityData.citySound, ...ctx.avoid].filter((x) => !own.has(String(x).trim().toLowerCase()));
  // slots.checkReply: a sentence naming an avoided name, or about people's age, gender, origin…, is dropped; the
  // rep's term rules (rule.term) apply
  const env = ctx.current ? ctx.envelopes[ctx.current] : null;
  // live check (A): the drinker brand is avoided (Doors never says a room pours it), but every rank fact names it as the
  // audience ("people who drink Aperol"; before intuit audit #5 "people who drink like Aperol drinkers"); in that phrasing it stays, so the reply can say the facts
  const kept = [];
  const brand = ctx.cityData.drinker.trim();
  if (brand) {
    const b = brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    t = t.replace(new RegExp(`\\bpeople who drink ${b}\\b|\\b(?:drink(?:s|ing)?|drinkers?) like (?:the )?${b}(?:'s)?(?: (?:drinkers?|fans|crowd))?\\b|\\b${b}(?:'s)? (?:drinkers?|fans)\\b`, "gi"), (m) => `\u0001${kept.push(m) - 1}\u0001`);
  }
  // round 3 (agent2): a door's name is a place, not a person ("White Tiger" tripped the about-people filter and its
  // sentence went): every door name (and the why-not doors') rides through the filters as a token
  for (const name of [...new Set([...Object.values(ctx.doors ?? {}).map((v) => v?.name), ...(ctx.whynot?.doors ?? []).map((d) => d.name), ctx.whynot?.selected?.name].filter((x) => typeof x === "string" && x.length >= 3))].sort((x, y) => y.length - x.length)) {
    const n = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    t = t.replace(new RegExp(`(?<![\\p{L}\\p{N}])${n}(?![\\p{L}\\p{N}])`, "giu"), (m) => `\u0001${kept.push(m) - 1}\u0001`);
  }
  t = checkReply(t, { constraints: { avoid, terms: {} } }).text.trim();
  t = t.replace(/\u0001(\d+)\u0001/g, (_, i) => kept[Number(i)]);
  // live check 2 (F3, F4): the rep's rules, as the talking points take them: a term is replaced, and the brand's and the
  // doors' own names are left alone ("Hollow Pine Cider" stays). fix9 (F4): a never-say drink word is reworded ("dry
  // hard cider" → "dry hard drink", "craft cider" → "cider"); a sentence with any other never-say word is dropped
  const known = new Set(rules.terms.map((x) => x.from.toLowerCase()));
  for (const [from, to] of Object.entries(env?.constraints?.terms ?? {})) if (!known.has(from.toLowerCase())) rules.terms.push({ from, to });
  if (rules.avoid.length || rules.terms.length) {
    const keep = [ctx.profile.brand, ...Object.values(ctx.doors).map((v) => v.name)];
    t = (t.match(SENTENCE) ?? []).map((x) => applyRule(x, rules, { keep, soften: { what: ctx.profile.what } })).filter((x) => x != null).join("").trim();
  }
  // the model copies the product line as the form has it ("Hollow Pine Cider's Dry hard
  // drink"): inside a sentence it starts lower case (an acronym stays: "NA hazy IPA")
  for (const w of new Set([ctx.profile?.what, ...(rules.avoid.length || rules.terms.length ? [applyRule(String(ctx.profile?.what ?? ""), rules, { keep: [ctx.profile?.brand], soften: { what: ctx.profile?.what } })] : [])])) {
    const p = String(w ?? "").trim();
    if (!/^\p{Lu}\p{Ll}/u.test(p)) continue;
    t = t.replace(new RegExp(`(?<=[\\p{L}\\p{N},;:'’)] )${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "gu"), (m) => m[0].toLowerCase() + m.slice(1));
  }
  // live check 2 (F2): a sentence claiming a change no tool made this turn ("I have updated your talking points") is
  // dropped: the rep would believe it
  if (backing && !(backing.actions ?? []).length) t = (t.match(SENTENCE) ?? []).filter((x) => !CLAIMED.test(x)).join("").trim();
  // live check (A): Llama parroted the prompt's "The app shows the sources under your reply", or lists them itself
  t = (t.match(SENTENCE) ?? []).filter((x) => !/\bsources?\b[^.!?]*\b(under|below|shown?s?|app)\b|^\s*sources?\s*:/i.test(x)).join("").trim();
  // R9 free models: a sentence that narrates the tool call ("The replan function is called with skip=[…]") or shows a
  // door id is dropped (then the fallback reply)
  // live check A: and a sentence about "the rep" or a tool's "result" (8b: "The answer to the rep's question is in the
  // comparedoors result."), a tool's name with its underscore dropped too
  // loose (abilities eval 10-23): "replan" and "remember" are words a reply may use ("I can re-plan…"), not a leak
  const TOOL_TALK = new RegExp(`\\b(${TOOLS.filter((x) => !loose || x.name.includes("_")).map((x) => `${x.name}|${x.name.replace(/_/g, "")}`).join("|")}${loose ? "|tool call" : "|function|parameters?|tool call|the rep|results? (above|below)|(tool|the \\w+) results?"})\\b|\\bd\\d{1,2}\\b|[0-9A-F]{8}-[0-9A-F]{4}-|[{}\\[\\]]`, "i");
  t = (t.match(SENTENCE) ?? []).filter((x) => !TOOL_TALK.test(x)).join("").trim();
  if (backing) t = claimsBacked(t, backing, loose).trim();
  if (backing) t = drinkersOffDoors(t, ctx, backing);
  t = roomOutOfQuotes(t);
  if (backing && !loose) t = plainSay(t, backing.words ?? "");
  // round 3 (agent2, Jard 10-25 "we are neutering our app"): a Claude reply (loose) says Qloo's numbers when they make the
  // point (claimsBacked above holds every number to what the model was shown); the free models' are still put in words
  if (backing && !loose) t = noScores(t, backing.asked ?? backing.words ?? "");
  t = noDecimals(t); // round 3 (gigbot 10-25): and once more after the cuts (a clause the cuts joined)
  // web honesty: in a turn that searched the web, a repeated phrase is said once, and a sentence naming a number or a
  // proper name nothing in front of the model held is dropped (an invented branch, price, owner)
  if (backing?.web != null) {
    const pool = `${backing.web} ${backing.words ?? ""} ${(backing.facts ?? []).map((f) => f?.text ?? "").join(" ")} ${TRADE_BRIEF} ${ctx.city?.name ?? ""} ${ctx.profile?.brand ?? ""} ${ctx.profile?.what ?? ""}`;
    const all = dedupeRepeats(t).match(SENTENCE_Q) ?? [];
    const kept = all.filter((x) => webBacked(x.replace(/\u0003/g, ""), pool));
    t = kept.join("").trim();
    // what was dropped is said honestly, with the move: never an empty answer or a bare page title
    if (kept.length < all.filter((x) => /\p{L}{2}/u.test(x)).length) backing.webDropped = true;
  }
  const cap = loose ? 2400 : 700; // round 3: a per-door answer (why_not_ask, a briefing) runs long
  if (t.length > cap) t = t.slice(0, cap).replace(/[^.!?]*$/, "") || t.slice(0, cap);
  // live check 2 (flash-lite): a dropped sentence's closing quote ('")') was left as the whole reply: no words, no reply
  // fix9 (F4): a kept sentence keeps its own closing quote ('…cooler row."')
  t = (t.match(SENTENCE_Q) ?? []).filter((x) => /\p{L}{2}/u.test(x)).join("").trim();
  if (loose) t = t.replace(/(\s*\u0003\s*)+/g, "\n").trim();
  if (loose) t = orphanQuotes(t);
  return t;
}
// A closing quote whose opening one went with a dropped sentence ('How do they take care of guests?" Ask for…'): gone
export function orphanQuotes(t) {
  let open = false;
  return String(t).replace(/["“”]/g, (q, i, all) => {
    const before = all[i - 1] ?? " ";
    const closer = q === "”" || (q === '"' && /[.!?,\p{L}\d]/u.test(before) && open) || (q === '"' && /[.!?]/.test(before));
    if (closer && !open) return "";
    open = !closer;
    return q;
  }).replace(/ {2,}/g, " ");
}
// ---- web honesty (a repeated cited phrase, an invented "Woodbury location") ----
// What the web pages said this turn: every cited passage and every result's title. A sentence of a reply from a turn
// that searched is kept only when each number and each proper name in it was in front of the model: the pages, CONTEXT
// and tool results, the user's words, the trade and specialist briefs. A place, a branch, a price or a person the
// pages never named can't pass.
export function webSeen(content = [], web) {
  for (const c of content) {
    if (c.type === "server_tool_use" && c.name === "web_search") web.searched = true;
    if (c.type === "web_search_tool_result" && Array.isArray(c.content)) for (const x of c.content) if (x?.title) web.pool += ` ${x.title}`;
    if (c.type === "text") for (const x of c.citations ?? []) web.pool += ` ${x.cited_text ?? ""} ${x.title ?? ""}`;
  }
  return web;
}
const COMMON_CAPS = new Set(["I", "I'm", "I'd", "I'll", "I've", "Doors", "Qloo", "Agent", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Sept", "Oct", "Nov", "Dec", "January", "February", "March", "April", "June", "July", "August", "September", "October", "November", "December", "AM", "PM", "NA", "OK", "ABV", "IPA", "ABC", "US", "USA"]);
const normCap = (w) => w.replace(/['’]s$/, "").replace(/[’]/g, "'");
export function webBacked(sentence, pool) {
  const low = pool.toLowerCase();
  const nums = String(sentence).match(/\d+(?:[.,]\d+)?/g) ?? [];
  const poolNums = new Set((pool.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(",", ".")));
  for (const [, h] of pool.matchAll(/\b(\d{1,2}):\d{2}\b/g)) poolNums.add(String(Number(h) % 12 || 12)); // "15:00" is "3 pm"
  if (!nums.every((n) => poolNums.has(n.replace(",", ".")) || poolNums.has(String(Number(n.replace(",", ".")))))) return false;
  // proper names: a capitalised word that doesn't start the sentence (or a run of them), outside quotes the user gave
  const words = String(sentence).replace(/^[^\p{L}]*\p{L}[\p{L}'’-]*/u, "").match(/\b\p{Lu}[\p{L}'’&-]*(?:\s+(?:&\s+)?\p{Lu}[\p{L}'’&-]*)*/gu) ?? [];
  return words.every((ph) => ph.split(/\s+/).filter((w) => w !== "&").every((w) => { const x = normCap(w); const y = x.replace(/s$/, ""); return COMMON_CAPS.has(x) || COMMON_CAPS.has(y) || low.includes(x.toLowerCase()) || (y.length > 2 && low.includes(y.toLowerCase())); }));
}
// The reply's text from its blocks. Live 10-23: Haiku pastes a page's sentence as a cited block straight after its own
// paraphrase ("…frozen cocktails during happy hour" + "Potent slush cocktails poured during happy hour."): a cited block
// that starts a new capitalised sentence mid-sentence is that paste, and is left out (its link stays in the facts).
export function textOfBlocks(content) {
  if (!Array.isArray(content)) return null;
  const blocks = content.filter((b) => b.type === "text");
  if (!blocks.length) return null;
  let out = "";
  for (const b of blocks) {
    const t = String(b.text ?? "");
    const pasted = (b.citations ?? []).length && /^\s*\p{Lu}/u.test(t) && /[\p{L}\d,]\s*$/u.test(out) && /\s/.test(t.trim());
    if (!pasted) out += t;
  }
  return out;
}
// a run of four or more words said twice in a row ("…frozen drink specials Discounted cocktail, beer and frozen drink
// specials.") keeps its first saying
export function dedupeRepeats(t) {
  let out = String(t ?? "");
  for (let n = 12; n >= 4; n--) {
    const re = new RegExp(`((?:[\\p{L}\\p{N}$'’-]+[,;:]?\\s+){${n - 1}}[\\p{L}\\p{N}$'’-]+)([.,;:]?\\s*[.,;:]?\\s*)\\1`, "giu");
    out = out.replace(re, "$1$2");
  }
  // a sentence said twice
  const seen = new Set();
  return (out.match(/[^.!?]+[.!?]*\s*/g) ?? [out]).filter((x) => { const k = x.trim().toLowerCase(); if (!k || !seen.has(k)) return seen.add(k), true; return false; }).join("").replace(/\s{2,}/g, " ").replace(/\.\s*,/g, ",").replace(/\.\s*\./g, ".").trim();
}
// ---- end web honesty ----
export function replanSay(a, ctx) {
  const names = (ids) => ids.map((id) => ctx.doors[id]?.name ?? "a door").join(", ");
  const clock = (hhmm) => { const [h, m] = String(hhmm).split(":").map(Number); return `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""} ${h < 12 ? "am" : "pm"}`; };
  const parts = [a.skip?.length && `${names(a.skip)} off this day`, a.endBy && `finishing by ${clock(a.endBy)}`, a.startNow && "starting from now", a.maxDoors && `at most ${a.maxDoors} doors a day`, a.lock?.length && `keeping ${names(a.lock)} in place`, a.add?.length && `adding ${names(a.add)}`].filter(Boolean);
  const where = a.skip?.length ? ` The line below says where ${a.skip.length === 1 ? "it" : "they"} went.` : " The line below shows the new day.";
  return `Re-planning the day${parts.length ? `: ${parts.join(", ")}` : ""}.${where}`;
}
// fix9 (F4): the never-say word the model's text said (outside the brand and the doors' names), else null
function ruleHit(text, ctx) {
  const keep = [ctx.profile.brand, ...Object.values(ctx.doors).map((v) => v.name)];
  return rulesOfContext(ctx).avoid.find((a) => applyRule(String(text ?? ""), { avoid: [a], terms: [] }, { keep }) == null) ?? null;
}
// gigbot 10-24 (agentfix finding b): when the cleaner left no sentence, or the model's steps ran out, the reply was
// "Done. The change is on your plan." or "I couldn't do that.": now it says what was changed, door by door, or the facts
// the tools found, or Doors' own rules' answer (when that changes nothing), and only then that the answer didn't come.
const TALK_WORD = { opener: "opener", toBuyer: "line to the buyer", questions: "questions", points: "points", pushback: "answers to pushback", ask: "ask" };
export function didSay(actions = [], ctx = {}) {
  const nm = (id) => ctx.doors?.[id]?.name ?? "that door";
  const out = [];
  const logged = new Set(actions.filter((a) => a.type === "outcome").map((a) => a.id));
  for (const a of actions) {
    if (a.type === "outcome") out.push(`Logged ${nm(a.id)}: ${RESULT_TEXT[a.outcome?.result] ?? a.outcome?.result ?? "visited"}${isDate(a.outcome?.followUp) ? `, follow up ${niceDate(a.outcome.followUp)}` : ""}.`);
    else if (a.type === "status" && !logged.has(a.id)) out.push(`Marked ${nm(a.id)} as ${a.status === "notfit" ? "not a fit" : a.status}.`);
    else if (a.type === "talk") out.push(a.op === "remove" ? `Took a line out of ${nm(a.id)}'s ${TALK_WORD[a.section] ?? "talking points"}.` : `Changed ${nm(a.id)}'s ${TALK_WORD[a.section] ?? "talking points"}${a.text ? `: “${String(a.text).slice(0, 160)}”` : ""}.`);
    else if (a.type === "slot") {
      const f = a.record?.field, v = a.record?.value;
      if (f === "note") out.push(`Noted on ${nm(a.id)}: “${String(v).slice(0, 160)}”.`);
      else if (f === "contact") out.push(`Kept the contact at ${nm(a.id)}.`);
      else if (f === "rule.avoid") out.push(`Added “${v}” to your never-say list.`);
      else if (f === "rule.term") out.push(`From now on: “${v?.to}”, not “${v?.from}”.`);
      else if (!logged.has(a.id)) out.push(`Kept that for ${nm(a.id)}.`);
    }
  }
  return [...new Set(out)].join(" ");
}
export function fallbackReply(ran, facts, actions, hit = null, { ctx = {}, messages = [] } = {}) {
  if (actions.length) return didSay(actions, ctx) || "Made the change you asked for: it's on your plan.";
  if (facts.length) return facts.slice(0, 2).map((f) => f.text).join(" ");
  // fix9 (F4): every sentence said a never-say word: say so, never an empty or "couldn't" answer
  if (hit) return `I left that answer out: it kept saying “${hit}”, which is on your never-say list. Ask again and I'll word it without it.`;
  // Doors' own rules, when their answer changes nothing (a change is only ever made on the model's tool call)
  try {
    const r = messages.length ? answerByRules(messages, ctx, { now: `${ctx.today}T${String(ctx.now ?? "12:00").padStart(5, "0")}` }) : null;
    if (r?.reply && !r.actions?.length && r.reply !== HELP) return r.reply;
  } catch {}
  return "That answer didn't come through, and nothing was changed. Ask again, one thing at a time.";
}
// at most 12; a web search's pages always among them (mobile2 10-23: a web answer showed no Sources row, no link ↗)
const dedupe = (facts) => {
  const seen = new Set();
  const all = facts.filter((f) => !seen.has(f.text) && seen.add(f.text));
  const web = all.filter((f) => f.source?.kind === "web").slice(0, 4);
  const rest = all.filter((f) => f.source?.kind !== "web").slice(0, 12 - web.length);
  return all.filter((f) => web.includes(f) || rest.includes(f));
};

// ---------- log-visit: one shot (drive mode) ----------
export function cleanVisit(b = {}) {
  const text = s(b.text, 400);
  const stop = b.stop && ID_RE.test(String(b.stop.id ?? "")) ? { id: String(b.stop.id), name: s(b.stop.name, 80) || "this stop", date: isDate(b.stop.date) ? b.stop.date : null } : null;
  const now = isDate(b.now?.date) ? { date: b.now.date, min: Math.max(0, Math.min(1439, Math.round(num(b.now.min) ?? 0))) } : null;
  if (!text || !stop || !now) return { error: "text, stop {id, name} and now {date, min} are required" };
  return { text, stop, now, windows: arr(b.windows, 30, (d) => (isDate(d) ? d : null)), next: arr(b.next, 25, (x) => (ID_RE.test(String(x?.id ?? "")) ? { id: String(x.id), name: s(x.name, 80) } : null)), names: arr(b.names, 40, (x) => s(x, 60) || null) };
}
export async function logVisitTurn({ v, env }) {
  const rules = () => withMemory(parseVisit(v.text, v), { stop: v.stop, words: v.text });
  if (isQuestion(v.text)) return rules(); // a question logs nothing: the rules ask how it went, no model call
  const hh = `${String(Math.floor(v.now.min / 60)).padStart(2, "0")}:${String(v.now.min % 60).padStart(2, "0")}`;
  // the agent's view of one door: the stop, the day's next stops, the plan's days
  const ctx = cleanContext({ mode: "drive", names: v.names ?? [], today: v.now.date, now: hh, windows: v.windows.map((date) => ({ date })), current: v.stop.id, doors: Object.fromEntries([[v.stop.id, { name: v.stop.name }], ...v.next.map((x) => [x.id, { name: x.name }])]), day: { date: v.now.date, stops: [v.stop, ...v.next].map((x) => ({ id: x.id })) } });
  const tool = TOOLS.filter((t) => t.name === "log_visit");
  const turn = await agentTurn({ messages: [{ role: "user", text: `At ${v.stop.name} (door ${v.stop.id}) just now: ${v.text}` }], ctx, env, tools: tool, first: false });
  // the model's log_visit, if it made a valid one; else the rules reading
  if (!turn.resting) {
    const logged = turn.actions.find((a) => a.type === "outcome");
    if (logged) {
      const r = runTool("log_visit", { door_id: v.stop.id, result: logged.outcome.result, follow_up_date: logged.outcome.followUp, follow_up_time: logged.outcome.followUpTime, who: logged.outcome.who, note: logged.outcome.note, not_a_fit: turn.actions.some((a) => a.type === "status" && a.status === "notfit") }, { ...ctx, next: v.next }, { by: `agent:${turn.by}`, words: v.text, now: `${v.now.date}T${hh}` });
      if (r.ok) return { ...r.result, source: "model" };
    }
  }
  return rules();
}

// ---------- HTTP ----------
const json = (body, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
export async function handleAgent(request, env, path) {
  if (request.method !== "POST") return json({ error: "POST a JSON body" }, 405);
  if (!/^application\/json\b/i.test(request.headers.get("content-type") ?? "")) return json({ error: "Send JSON (content-type: application/json)" }, 415);
  if (!originOk(request, env, { required: true })) return json({ error: "Doors Agent answers Doors' own page and app." }, 403);
  // R9 red team: bytes, not characters (64 K emoji were 256 KB), and never read past the cap into memory
  const raw = await readCapped(request, MAX_BODY);
  if (raw == null) return json({ error: "That's too much to send at once." }, 413);
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return json({ error: "Send JSON" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ error: "Send a JSON object" }, 400);
  const ip = ipKey(request.headers.get("cf-connecting-ip") ?? "local");
  if (path === "/api/agent/log-visit") {
    const v = cleanVisit(body);
    if (v.error) return json({ error: v.error }, 400);
    // over the visitor's cap the client reads it with the same parser itself (§1.3)
    const why = (await edgeLimited(env, ip)) ? "busy" : agentLimited(env, ip); // R9 red team: busy is not "daily"
    if (why) return json({ v: 1, resting: true, reason: why, message: why === "busy" ? AGENT_EASY : AGENT_RESTING });
    return json(await logVisitTurn({ v, env }));
  }
  const messages = cleanMessages(body.messages);
  if (!messages) return json({ error: "messages: [{role: user|agent, text}], the last from the user" }, 400);
  const ctx = cleanContext(body.context);
  // the specialist brief for this profile's category + city (src/brief.js, read on the server; the client never sends it)
  ctx.specialistBrief = env.ANTHROPIC_API_KEY ? await briefForTurn(env, ctx).catch(() => null) : null;
  const reason = (await edgeLimited(env, ip)) ? "busy" : agentLimited(env, ip);
  if (reason) return json({ ...answerByRules(messages, ctx, { now: `${ctx.today}T${ctx.now}` }), resting: true, reason: reason === "busy" ? "busy" : "daily", message: reason === "busy" ? AGENT_EASY : AGENT_RESTING, left: turnsLeft(env, ip) });
  const turn = await agentTurn({ messages, ctx, env, ip });
  await settled(); // the turn's Claude $ is in the site's book before the reply goes
  return json(turn);
}
// ---- Doors Agent ability 9 (spec §5, §9): Day done polish. The template debrief (lib/day-debrief.js) always shows;
// on the rep's tap, POST /api/agent/debrief {facts: dayFacts(…, {redact: false}), profile} → one Anthropic call, no
// tools, that rewrites the facts into polished notes and next steps. Facts only: a door it wasn't given is dropped,
// and so is a line with a number the facts don't hold. Names are redacted here before the call and put back after.
export const DEBRIEF_SYSTEM = [
  "You are Doors Agent. You write the Day done notes for a drinks salesperson (a brand founder or a distributor rep) after a day of visiting bars and restaurants (doors).",
  "FACTS ONLY: rewrite the FACTS you are given into clean notes and next steps. Never add anything the facts don't say: no guesses about why, no new promises, dates, times, people or details about a door. Next steps come only from the facts: follow-ups booked, promises made, doors not reached and where they are now, tomorrow's first stops, open follow-ups.",
  "A contact's name is shown as \"the contact\"; write it that way. Outcomes are Interested, Follow up, Talked to someone else, Not interested, Just visited. Plain, warm, brief: the trade's words where they fit (buyer, sample, case). Times as \"3:30 pm\", days as \"Wednesday\".",
  "Each outcome means only what it says: \"Talked to someone else\" means they spoke with someone other than the buyer, nothing about why; \"Just visited\" means no outcome was logged. A door with nothing beyond its outcome gets the outcome alone, no filler (never \"no further details were recorded\"). Don't start a note with \"Outcome:\".",
  "Return ONLY JSON: {\"summary\": \"one or two sentences on the day\", \"doors\": [{\"id\": \"d1\", \"note\": \"one or two sentences: what happened and what was said or promised\"}], \"next\": [\"one short next step\", …]}. One entry per visited door that has something to say; at most 6 next steps, most urgent first.",
].join("\n");
const cleanDayFacts = (f = {}) => {
  const door = (d) => (d && ID_RE.test(String(d.id ?? "")) ? { id: String(d.id), n: num(d.n), name: s(d.name, 80) || "A door", status: d.status === "visited" ? "visited" : "not-reached", skipped: d.skipped === true, outcome: s(d.resultLabel, 40) || null, who: s(d.who, 60) || null, role: s(d.whoRole, 30) || null, said: s(d.said, 400) || null, followUp: d.followUp && isDate(d.followUp.date) ? { date: d.followUp.date, time: isClock(d.followUp.time) ? d.followUp.time : null, onDay: isDate(d.followUp.onDay) ? d.followUp.onDay : null, stop: num(d.followUp.stop) } : null, notes: arr(d.notes, 6, (n) => s(n?.text, 300) || null), promises: arr(d.promises, 4, (n) => s(n?.text, 200) || null), where: s(d.where?.text, 160) || null } : null);
  return {
    date: isDate(f.date) ? f.date : null,
    totals: { planned: num(f.totals?.planned) ?? 0, visited: num(f.totals?.visited) ?? 0, notReached: num(f.totals?.notReached) ?? 0 },
    doors: arr(f.doors, 30, door),
    removed: arr(f.removed, 20, (r) => (r && ID_RE.test(String(r.id ?? "")) ? { id: String(r.id), name: s(r.name, 80), reason: s(r.reason, 60), where: s(r.where?.text, 160) || null } : null)),
    tomorrow: f.tomorrow && isDate(f.tomorrow.date) ? { date: f.tomorrow.date, doors: num(f.tomorrow.doors), first: arr(f.tomorrow.first, 3, (x) => (x ? { name: s(x.name, 80), eta: s(x.eta, 5), followUp: x.followUp === true } : null)) } : null,
    openFollowUps: arr(f.openFollowUps, 12, (x) => (x && isDate(x.date) ? { name: s(x.name, 80), date: x.date, time: isClock(x.time) ? x.time : null } : null)),
    moved: f.moved && typeof f.moved === "object" ? { head: s(f.moved.head, 160), body: s(f.moved.body, 300) } : null,
  };
};
const weekday = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
export const DEBRIEF_SPENT = "Polish uses Claude, and today's Claude budget for Doors is used up. The notes above are complete; polish is back after midnight UTC.";
export const DEBRIEF_UNREAD = "Doors Agent couldn't polish the notes just now. The notes above are complete; try again in a moment.";
export async function debriefTurn({ facts, profile = {}, env, names = [] }) {
  const f = cleanDayFacts(facts);
  if (!f.doors.length && !f.removed.length) return { v: 1, resting: true, reason: "empty", message: "Nothing was logged on this day, so there's nothing to polish." };
  if (!env.ANTHROPIC_API_KEY) return { v: 1, resting: true, reason: "model", message: AGENT_NO_MODEL.replace("Doors' own rules answered", "the notes above are Doors' own") };
  // the site's Claude $ for today (src/spend.js)
  const room = await claudeRoom(env);
  if (!room.ok) return { v: 1, resting: true, reason: "model", ...(room.reason === "spent" ? {} : { retry: true }), message: room.reason === "spent" ? DEBRIEF_SPENT : DEBRIEF_UNREAD };
  if (!modelCall(env)) return { v: 1, resting: true, reason: "model", message: AGENT_NO_MODEL.replace("Doors' own rules answered", "the notes above are Doors' own") };
  const alias = new Map(f.doors.map((d, i) => [d.id, `d${i + 1}`]));
  const back = new Map([...alias].map(([id, a]) => [a, id]));
  const who = [...new Set([...names, ...f.doors.map((d) => d.who)].filter((x) => typeof x === "string" && x.length >= 2))];
  // the model's view: door ids as d1…, dates with their weekday, every name redacted
  const view = { ...f, date: f.date ? `${f.date} (${weekday(f.date)})` : null, doors: f.doors.map(({ id, who: w, ...d }) => ({ id: alias.get(id), ...d, ...(w ? { who: "the contact" } : {}), ...(d.followUp ? { followUp: { ...d.followUp, day: weekday(d.followUp.date) } } : {}) })), removed: f.removed.map(({ id, ...r }) => r), brand: s(profile.brand, 80), product: s(profile.what, 120) };
  const user = redact(`FACTS ${JSON.stringify(forModel(view, who))}\n\nWrite the Day done notes as JSON.`, notPlaces([...who, ...namesIn(JSON.stringify(view))], f.doors.map((d) => d.name)));
  const usage = [];
  const model = String(env.AGENT_MODEL || AGENT_MODEL).trim();
  const sess = anthropicSession({ apiKey: env.ANTHROPIC_API_KEY, model, effort: "low", maxTokens: 4000, timeoutMs: Number(env.ANTHROPIC_STEP_MS ?? ANTHROPIC_STEP_MS) * 2, ...(env.ANTHROPIC_FETCH ? { fetchImpl: env.ANTHROPIC_FETCH } : {}), onUsage: (u, m) => { const usd = usdOf(u, m); charge(env, usd, "debrief"); usage.push({ ...u, usd }); }, onLost: (x) => { const usd = worstUsd(x); charge(env, usd, "debrief"); usage.push({ usd, lost: true }); } })({ system: [{ type: "text", text: DEBRIEF_SYSTEM, cache_control: { type: "ephemeral" } }], user, tools: [] });
  let out;
  try {
    out = await sess.step();
  } catch (e) {
    console.warn(`[agent] debrief failed: ${errKind(e)}`);
    return { v: 1, resting: true, reason: "model", retry: true, message: "Doors Agent couldn't polish the notes just now. The notes above are complete; try again in a moment." };
  }
  const j = safeJson(/\{[\s\S]*\}/.exec(out.text ?? "")?.[0] ?? "") ?? {};
  // facts only: every number a line says must be in the facts (dates, times, counts); else the line is dropped
  const pool = new Set((JSON.stringify(view).match(/\d+/g) ?? []).map(Number));
  for (const [, h] of JSON.stringify(view).matchAll(/"(\d{1,2}):\d{2}"/g)) pool.add(Number(h) % 12 || 12); // "15:00" is said "3 pm"
  const backed = (t) => (String(t).match(/\d+/g) ?? []).every((n) => pool.has(Number(n)));
  const line = (t, n) => { const x = s(t, n).replace(/[*_`#]+/g, ""); return x && backed(x) ? x : null; };
  const firstOf = (x) => String(x ?? "").trim().split(/\s+/)[0];
  const doors = arr(j.doors, 30, (d) => {
    const id = back.get(String(d?.id ?? "").trim().toLowerCase());
    const dd = id ? f.doors.find((x) => x.id === id) : null;
    const note = dd ? line(d.note, 400) : null;
    return note ? { id, name: dd.name, note: dd.who ? note.replace(/\bthe contact\b/gi, firstOf(dd.who)) : note } : null;
  });
  const one = who.length === 1 ? firstOf(who[0]) : null; // one name on the day: it goes back everywhere
  const fill = (t) => (one ? t.replace(/\bthe contact\b/gi, one) : t);
  const summary = line(j.summary, 400);
  const next = arr(j.next, 6, (t) => line(t, 200)).map(fill);
  if (!summary && !doors.length && !next.length) console.warn(`[agent] debrief: nothing usable (${out.stop ?? "?"}, ${String(out.text ?? "").length} chars)`);
  if (!summary && !doors.length && !next.length) return { v: 1, resting: true, reason: "model", retry: true, message: "Doors Agent couldn't polish the notes just now. The notes above are complete; try again in a moment." };
  return { v: 1, polished: { ...(summary ? { summary: fill(summary) } : {}), doors, next }, by: "anthropic", model: modelName("anthropic", model), cost: costOf(usage) };
}
export async function handleDebrief(request, env) {
  if (request.method !== "POST") return json({ error: "POST a JSON body" }, 405);
  if (!/^application\/json\b/i.test(request.headers.get("content-type") ?? "")) return json({ error: "Send JSON (content-type: application/json)" }, 415);
  if (!originOk(request, env, { required: true })) return json({ error: "Doors Agent answers Doors' own page and app." }, 403);
  const raw = await readCapped(request, MAX_BODY);
  if (raw == null) return json({ error: "That's too much to send at once." }, 413);
  const body = safeJson(raw);
  if (!body || typeof body !== "object" || Array.isArray(body) || !body.facts || typeof body.facts !== "object") return json({ error: "Send {facts, profile}" }, 400);
  const ip = ipKey(request.headers.get("cf-connecting-ip") ?? "local");
  const why = (await edgeLimited(env, ip)) ? "busy" : agentLimited(env, ip);
  if (why) return json({ v: 1, resting: true, reason: why, message: why === "busy" ? AGENT_EASY : AGENT_RESTING });
  const out = await debriefTurn({ facts: body.facts, profile: body.profile ?? {}, env, names: arr(body.names, 40, (x) => s(x, 60) || null) });
  await settled(); // the turn's Claude $ is in the site's book before the reply goes
  return json(out);
}
// ---- end ability 9 ----

// The body as text, or null when it is over `max` bytes (by its content-length, else as it streams in).
export async function readCapped(request, max) {
  const len = Number(request.headers.get("content-length"));
  if (Number.isFinite(len) && len > max) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const parts = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > max) {
      reader.cancel().catch(() => {});
      return null;
    }
    parts.push(value);
  }
  const all = new Uint8Array(n);
  let o = 0;
  for (const p of parts) all.set(p, o), (o += p.byteLength);
  return new TextDecoder().decode(all);
}
async function edgeLimited(env, ip) {
  if (!env.AGENT_LIMITER) return false;
  try {
    return !(await env.AGENT_LIMITER.limit({ key: ip })).success;
  } catch {
    return false;
  }
}
export { nextStops };
