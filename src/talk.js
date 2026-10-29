// Group 3 item 3: POST /api/talk {tf: lib/talk-gen.js talkFacts(…)} → one door's talking points written by Claude
// from Qloo's facts, checked line by line (validateTalkSet) before they go back. → {v: 1, set, model, key,
// cached?} or {v: 1, fallback: true, reason, message}: the screen keeps the template (and says nothing about why).
// Cost guard: the site's Claude $ a day (src/spend.js claudeRoom/charge, kind "talk"), a visitor's sets a day and per
// 10 minutes (this isolate's memory), one call per set, no tools. A set is kept in KV by its key (the facts it was
// written from + the rules' version), shared by everyone who opens the same door with the same product and ask, so a
// door is written once. Round 3 (Jard 10-25): Claude Sonnet 5.5 at high effort, about $0.02–0.05 a door (was Haiku at
// low effort, about $0.001; Opus 5.5 about $0.06); TALK_MODEL / TALK_EFFORT in the env change it.
// Only Qloo's facts about a room, the product line, the drinkers line and the ask leave Doors: never the rep's name.
import { anthropicSession } from "./llm.js";
import { usdOf, worstUsd, charge, claudeRoom, settled } from "./spend.js";
import { originOk, ipKey } from "./guard.js";
import { TALK_SYSTEM, TALK_FORMAT, talkUser, talkKey, validateTalkSet, TALK_GEN_VERSION } from "../public/lib/talk-gen.js";

export const TALK_MODEL = "claude-sonnet-5-5"; // env.TALK_MODEL overrides (round 3, Jard 10-25: Sonnet 5.5, with the prompt's brevity voice; Opus was the sample's pick but Jard chose Sonnet)
export const TALK_EFFORT = "high"; // env.TALK_EFFORT overrides
export const TALK_VISITOR_DAILY = 120; // new sets one visitor may have written a day (a week's plan is ~30 doors)
export const TALK_WINDOW = 40; // … and per 10 minutes
export const TALK_MS = 90000; // Sonnet at high effort thinks for a while
export const TALK_TRIES = 2;
export const TALK_TTL = 60 * 86400;
// the reasons a door keeps the standard lines (for the API's caller and the logs; the screen shows none of them)
export const TALK_SPENT = "Today's budget for written talking points is used up; written ones are back after midnight UTC.";
export const TALK_BUSY = "You've had a lot of talking points written today. Try again later.";
export const TALK_FAILED = "Talking points for this door couldn't be written just now.";
export const TALK_OFF = "Written talking points are off here.";

const json = (body, status = 200) => Response.json(body, { status });
const seen = new Map(); // `${day}|${ip}` → n, and `w|${ip}` → [ts]
const today = (env) => env.TODAY ?? new Date().toISOString().slice(0, 10);
export const _resetTalk = () => seen.clear();
function visitorLimited(env, ip, now = Date.now()) {
  const d = `${today(env)}|${ip}`;
  const w = `w|${ip}`;
  const recent = (seen.get(w) ?? []).filter((t) => now - t < 10 * 60 * 1000);
  if ((seen.get(d) ?? 0) >= Number(env.TALK_VISITOR_DAILY ?? TALK_VISITOR_DAILY) || recent.length >= Number(env.TALK_WINDOW ?? TALK_WINDOW)) return true;
  seen.set(d, (seen.get(d) ?? 0) + 1);
  seen.set(w, [...recent, now]);
  if (seen.size > 20000) seen.clear();
  return false;
}

const ID = /^(R\d{1,2}|S\d{1,2}|D\d{1,2}|P\d{1,2}|A)$/; // S: the door's own site (lane enrich); D: Doors' ranked insights (lane deep)
const s = (x, n) => String(x ?? "").replace(/[\u0000-\u001f]+/g, " ").trim().slice(0, n);
// the client's facts, capped and shaped (it can only fool its own screen, but nothing odd reaches the model)
export function cleanTalkFacts(tf) {
  if (!tf || typeof tf !== "object" || !Array.isArray(tf.facts)) return null;
  const facts = tf.facts.slice(0, 40).map((f) => (f && ID.test(String(f.id)) ? { id: String(f.id), kind: ["room", "site", "deep", "product", "ask"].includes(f.kind) ? f.kind : "room", label: s(f.label, 100), text: s(f.text, 500), ...(f.prep ? { prep: true } : {}), ...(f.kind === "site" && /^https?:\/\//.test(String(f.url ?? "")) ? { url: s(f.url, 300) } : {}) } : null)).filter((f) => f && f.text);
  if (!facts.some((f) => f.kind === "room") || new Set(facts.map((f) => f.id)).size !== facts.length) return null;
  const list = (xs, n) => (Array.isArray(xs) ? xs.slice(0, n).map((x) => s(x, 80)).filter(Boolean) : []);
  return { facts, ask: s(tf.ask, 200), na: tf.na === true, avoid: list(tf.avoid, 40), venueType: ["bar", "brewery", "restaurant", "coffee"].includes(tf.venueType) ? tf.venueType : null, brand: s(tf.brand, 80), drinks: list(tf.drinks, 8) };
}

export async function talkTurn({ tf, env, ip = "local", fetchImpl = null }) {
  const key = talkKey(tf);
  const kvKey = `talk:${TALK_GEN_VERSION}:${key}`;
  try {
    const hit = env.DOORS_KV ? await env.DOORS_KV.get(kvKey, "json") : null;
    if (hit?.set) return { v: 1, ...hit, key, cached: true };
  } catch {}
  if (!env.ANTHROPIC_API_KEY) return { v: 1, fallback: true, reason: "off", message: TALK_OFF };
  if (visitorLimited(env, ip)) return { v: 1, fallback: true, reason: "busy", message: TALK_BUSY };
  const room = await claudeRoom(env);
  if (!room.ok) return { v: 1, fallback: true, reason: room.reason === "spent" ? "spent" : "unread", message: room.reason === "spent" ? TALK_SPENT : TALK_FAILED };
  const model = String(env.TALK_MODEL || TALK_MODEL).trim();
  const usage = [];
  const f = fetchImpl ?? env.ANTHROPIC_FETCH;
  const effort = String(env.TALK_EFFORT || TALK_EFFORT).trim();
  const make = anthropicSession({ apiKey: env.ANTHROPIC_API_KEY, model, effort, maxTokens: 12000, format: env.TALK_FORMAT === "off" ? null : TALK_FORMAT, timeoutMs: Number(env.TALK_MS ?? TALK_MS), ...(f ? { fetchImpl: f } : {}), onUsage: (u, m) => { const usd = usdOf(u, m); charge(env, usd, "talk"); usage.push({ ...u, usd }); }, onLost: (x) => { const usd = worstUsd(x); charge(env, usd, "talk"); usage.push({ usd, lost: true }); } });
  // one try, and a second when lines fail the checks (the model is told which and why); never more. g6: a set that
  // passes but lost its opener or its message to the checks gets the second try too; the first good set is kept when
  // the second try comes back worse
  let r = null;
  let best = null;
  let tries = 0;
  let error = null;
  const whole = (x) => Boolean(x?.ok && x.set.opener && x.set.message);
  for (; tries < TALK_TRIES && !whole(r); tries++) {
    if (tries && !(await claudeRoom(env)).ok) break;
    let out;
    try {
      out = await make({ system: [{ type: "text", text: TALK_SYSTEM, cache_control: { type: "ephemeral" } }], user: talkUser(tf, r?.dropped ?? [], r?.reason ?? null), tools: [] }).step();
    } catch (e) {
      error = String(e?.message ?? e).slice(0, 200);
      console.warn(`[talk] failed: ${error.slice(0, 120)}`);
      break;
    }
    let raw = null;
    try {
      raw = JSON.parse(/\{[\s\S]*\}/.exec(out.text ?? "")?.[0] ?? "");
    } catch {}
    r = validateTalkSet(raw, tf);
    if (r.ok && (!best || whole(r))) best = r;
    if (!r.ok) console.warn(`[talk] set refused (try ${tries + 1}, ${out.stop ?? "?"}, ${String(out.text ?? "").length} chars${raw ? "" : `: ${JSON.stringify(String(out.text ?? "").slice(0, 160))}`}): ${r.reason}; dropped ${r.dropped.map((d) => `${d.where}: ${d.reason}`).join("; ").slice(0, 300)}`);
  }
  await settled();
  if (best && !whole(r)) r = best; // the second try lost the set: keep the first
  const usd = Math.round(usage.reduce((a, u) => a + (u.usd ?? 0), 0) * 1e6) / 1e6;
  if (!r) return { v: 1, fallback: true, reason: "model", message: TALK_FAILED, usd, tries, ...(error ? { error } : {}) };
  if (!r.ok) return { v: 1, fallback: true, reason: "checks", message: TALK_FAILED, dropped: r.dropped, usd, tries };
  const val = { set: r.set, model, at: new Date().toISOString().slice(0, 10), dropped: r.dropped.length };
  try {
    if (env.DOORS_KV) await env.DOORS_KV.put(kvKey, JSON.stringify(val), { expirationTtl: TALK_TTL });
  } catch {}
  return { v: 1, ...val, key, usd, tries, droppedLines: r.dropped };
}

export async function handleTalk(request, env) {
  if (request.method !== "POST") return json({ error: "POST a JSON body" }, 405);
  if (!/^application\/json\b/i.test(request.headers.get("content-type") ?? "")) return json({ error: "Send JSON (content-type: application/json)" }, 415);
  if (!originOk(request, env, { required: true })) return json({ error: "Talking points answer Doors' own page and app." }, 403);
  let body;
  try {
    body = JSON.parse((await request.text()).slice(0, 24000));
  } catch {
    return json({ error: "Send JSON {tf}" }, 400);
  }
  const tf = cleanTalkFacts(body?.tf);
  if (!tf) return json({ error: "tf: {facts: [{id, kind, label, text}], ask, avoid, venueType}" }, 400);
  return json(await talkTurn({ tf, env, ip: ipKey(request.headers.get("cf-connecting-ip") ?? "local") }));
}
