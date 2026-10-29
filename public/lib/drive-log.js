// Drive mode's "Log visit": what the rep said goes to the agent's log-visit tool (docs/CONTRACTS-R9.md §1.3,
// POST /api/agent/log-visit); offline, resting, or before the endpoint is deployed, the same rules parser runs here
// (lib/visit-parse.js, §3.3). Whatever comes back is checked by code before drive mode applies it: a status and an
// outcome lib/outcome.js would make, for this door. Pure apart from the injected fetch. Covered by
// test/drive-mode.test.mjs.
import { parseVisit, sayOutcome, isQuestion } from "./visit-parse.js";
import { makeOutcome } from "./outcome.js";

// cut a long reply at a word, never mid-word ("…ask about mar", doors-rn 2026-10-22)
const clip = (s, n) => (s.length <= n ? s : `${s.slice(0, n).replace(/\s+\S*$/, "")}…`);

export const LOG_URL = "/api/agent/log-visit";
const STATUSES = new Set(["visited", "talked", "notfit"]);
const TIMEOUT_MS = 8000;

// A log-visit answer → the same answer with a checked visit, or null when it isn't one drive mode can apply.
export function checkResult(r, { stop, now } = {}) {
  if (!r || r.ok !== true || !r.visit || !STATUSES.has(r.visit.status)) return null;
  const o = r.visit.outcome;
  let outcome = null;
  if (o) {
    if (o.followUp && now?.date && o.followUp < now.date) return null; // a past date: not one to pin
    outcome = makeOutcome({ result: o.result, followUp: o.followUp ?? "", who: o.who ?? "", note: o.note ?? "", at: o.at ?? null });
    if (outcome.error) return null;
    if (o.followUpTime && /^([01]\d|2[0-3]):[0-5]\d$/.test(o.followUpTime) && outcome.followUp) outcome.followUpTime = o.followUpTime;
  }
  const say = typeof r.say === "string" && r.say.trim() ? clip(r.say.trim(), 300) : `Logged${stop?.name ? ` ${stop.name}` : ""}: ${sayOutcome(outcome)}.`;
  return { ...r, visit: { status: r.visit.status, outcome }, say };
}

// → {ok:true, visit, say, source, next?} | {ok:false, error, ask} (ask the rep, resend the answer). Never throws.
// opts.fetch: the fetch to use (tests pass a fake; null = rules only). The agent gets one try; anything but a usable
// answer (network, 404 before the endpoint lands, resting, a malformed reply) falls back to the rules parser.
export async function logVisit(text, ctx, { fetch: f = globalThis.fetch, timeoutMs = TIMEOUT_MS } = {}) {
  const local = () => parseVisit(text, ctx);
  if (typeof f !== "function" || isQuestion(text)) return local(); // a question: the rules ask how it went
  const body = { v: 1, text: String(text ?? "").slice(0, 400), stop: ctx.stop, now: ctx.now, windows: ctx.windows ?? [], next: ctx.next ?? [], names: (ctx.names ?? []).slice(0, 40), ...(ctx.envelope ? { envelope: ctx.envelope } : {}) };
  let res;
  try {
    const ctl = typeof AbortController === "function" ? new AbortController() : null;
    const t = ctl && setTimeout(() => ctl.abort(), timeoutMs);
    try {
      res = await f(LOG_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: ctl?.signal });
    } finally {
      clearTimeout(t);
    }
    if (!res?.ok) return local();
    const r = await res.json();
    if (r?.ok === false && typeof r.ask === "string") return { ok: false, error: r.error ?? "", ask: r.ask, source: r.source ?? "model" };
    return checkResult(r, ctx) ?? local();
  } catch {
    return local();
  }
}
