// The cost guard: the day's Claude $ for the whole site, not per isolate. Every Anthropic call (an Agent
// step, its web searches, a specialist brief, Day done polish) is priced from the usage Anthropic returns and added to
// one counter a UTC day, kept in a Durable Object (SpendBook below; binding SPEND_BOOK). KV can't hold it: no atomic
// add (two isolates writing at once lose one), and the free plan's 1,000 writes a day are for runs (src/kvbook.js).
// Past AGENT_USD_DAILY nothing calls Anthropic until 00:00 UTC; the Agent answers on the free chain. Round 3 (Jard
// 10-25, "forget the dollar limits for now"): $30 a day (was $2), with the Agent on Sonnet by default; the code path
// stays, the number moved. AGENT_USD_DAILY in wrangler.toml overrides it.
// The counter can't be read → no Claude call (the free chain answers): an unread counter is treated as spent.
// It can overshoot by the calls already running when it crosses the cap (each a few cents at most).
// Without the binding (the dev server, tests) the book is this isolate's own SpendBook, the same code in memory.

export const AGENT_USD_DAILY = 30;
// $ per million tokens [input, output, cache read, cache write 5 min], prompts up to 100k tokens (published 2026-10).
// Haiku 5.5 charges 5× on a prompt over 100k (LONG_PROMPT); the guard prices every model that way, to stay over.
export const PRICE_PER_M = { "claude-haiku-5-5": [0.1, 0.5, 0.01, 0.125], "claude-sonnet-5-5": [2, 10, 0.1, 2.5], "claude-opus-5-5": [5, 25, 0.5, 6.25] };
export const LONG_PROMPT = 100000;
export const SEARCH_USD = 0.01; // Anthropic's web search: $10 per 1,000
export const usdOf = (u, model) => {
  const [i, o, r, w] = PRICE_PER_M[model] ?? PRICE_PER_M["claude-opus-5-5"]; // an unknown model is priced at the dearest
  const prompt = (u?.input_tokens ?? 0) + (u?.cache_read_input_tokens ?? 0) + (u?.cache_creation_input_tokens ?? 0);
  const x = prompt > LONG_PROMPT ? 5 : 1;
  return (((u?.input_tokens ?? 0) * i + (u?.output_tokens ?? 0) * o + (u?.cache_read_input_tokens ?? 0) * r + (u?.cache_creation_input_tokens ?? 0) * w) * x) / 1e6 + (u?.server_tool_use?.web_search_requests ?? 0) * SEARCH_USD;
};
// A call that was sent but never answered (a timeout, a dropped connection) may still be billed, with no usage to
// read: it is counted at its most: the request's characters as tokens, max_tokens out, every search it allowed.
export const worstUsd = ({ model, body = "", maxTokens = 0, searches = 0 }) => usdOf({ input_tokens: String(body).length, output_tokens: maxTokens, server_tool_use: { web_search_requests: searches } }, model);

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
export const KINDS = ["agent", "brief", "debrief", "talk", "enrich"]; // enrich: round 3, a live door's website read

// ---------- the Durable Object: one instance for the site (idFromName("claude")) ----------
// GET /?day=YYYY-MM-DD → {day, usd, calls, by}; POST /add {day, usd, kind} → the same, after adding. A Durable Object
// handles one request at a time around its storage calls, so two adds can't read the same total.
export class SpendBook {
  constructor(state) {
    this.storage = state?.storage ?? null;
    this.days = new Map();
  }
  async load(day) {
    if (!this.days.has(day)) {
      const v = (this.storage ? await this.storage.get(`usd:${day}`) : null) ?? { day, usd: 0, calls: 0, by: {} };
      this.days.set(day, v);
      for (const d of this.days.keys()) if (d < day && this.days.size > 3) this.days.delete(d);
    }
    return this.days.get(day);
  }
  async fetch(request) {
    const url = new URL(request.url);
    const add = request.method === "POST" && url.pathname === "/add";
    const b = add ? await request.json().catch(() => ({})) : {};
    const day = add ? b.day : url.searchParams.get("day");
    if (!DAY_RE.test(String(day ?? ""))) return Response.json({ error: "day: YYYY-MM-DD" }, { status: 400 });
    const v = await this.load(day);
    if (add) {
      const usd = Number(b.usd);
      if (!(usd > 0) || usd > 50) return Response.json({ error: "usd: a positive number" }, { status: 400 });
      const kind = KINDS.includes(b.kind) ? b.kind : "agent";
      v.usd = Math.round((v.usd + usd) * 1e6) / 1e6;
      v.calls += 1;
      v.by[kind] = Math.round(((v.by[kind] ?? 0) + usd) * 1e6) / 1e6;
      if (this.storage) {
        await this.storage.put(`usd:${day}`, v);
        // a day's value is kept 3 days (for the logs), then dropped
        const old = new Date(Date.parse(`${day}T00:00:00Z`) - 3 * 864e5).toISOString().slice(0, 10);
        await this.storage.delete(`usd:${old}`);
      }
    }
    return Response.json(v);
  }
}

// ---------- the Worker's side ----------
let local = new SpendBook(null); // no binding: this isolate's own book
const seen = { day: null, usd: 0, at: 0 }; // the last total the book returned
const unsent = { day: null, usd: 0, by: {} }; // adds the book didn't take (unreachable): sent with the next one
// adds on their way → when each was sent. Live 2026-10-30: this list is shared by every request in an isolate, and an
// add sent by a request that then ended (the visitor left mid-answer, a waitUntil cut off) never settles: Workers
// cancels that request's I/O and timers. Every later Claude call awaited it and hung. So settled() waits at most
// SETTLE_MS, and an add older than STALE_MS is dropped (its $ was counted as unsent or is lost: a few cents at most).
const outstanding = new Map();
export const SETTLE_MS = 4000;
const STALE_MS = 60000;
export function _resetSpend() {
  local = new SpendBook(null);
  Object.assign(seen, { day: null, usd: 0, at: 0 });
  Object.assign(unsent, { day: null, usd: 0, by: {} });
  outstanding.clear();
}
const today = (env) => env.TODAY ?? new Date().toISOString().slice(0, 10);
export const capOf = (env) => Number(env.AGENT_USD_DAILY ?? AGENT_USD_DAILY);
const book = (env) => (env.SPEND_BOOK ? env.SPEND_BOOK.get(env.SPEND_BOOK.idFromName("claude")) : { fetch: (url, init) => local.fetch(new Request(url, init)) });
// Live 2026-10-30: the book stopped answering and every Claude path (Agent, polish, briefs) waited on it with no end.
// A read or add that takes longer than BOOK_MS fails like an unreachable book: no Claude call, the add kept for later.
export const BOOK_MS = 3000;
const within = (p, ms, what) => {
  let t;
  return Promise.race([p, new Promise((_, no) => (t = setTimeout(() => no(new Error(`${what}: no answer in ${ms} ms`)), ms)))]).finally(() => clearTimeout(t));
};
const bookMs = (env) => Number(env.SPEND_BOOK_MS ?? BOOK_MS);
async function ask(env, path, body) {
  const res = await within(book(env).fetch(`https://spend${path}`, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}), bookMs(env), "spend book");
  if (!res.ok) throw new Error(`spend book ${res.status}`);
  const v = await within(res.json(), bookMs(env), "spend book");
  if (v.day === today(env)) Object.assign(seen, { day: v.day, usd: Number(v.usd) || 0, at: Date.now() });
  return v;
}
async function send(env, day, usd, kind) {
  try {
    await ask(env, "/add", { day, usd, kind });
    return true;
  } catch (e) {
    if (unsent.day !== day) Object.assign(unsent, { day, usd: 0, by: {} });
    unsent.usd += usd;
    unsent.by[kind] = (unsent.by[kind] ?? 0) + usd;
    console.warn(`[spend] add failed, kept for the next one: ${String(e?.message ?? e).slice(0, 120)}`);
    return false;
  }
}
const retryUnsent = async (env) => {
  if (unsent.day !== today(env) || !(unsent.usd > 0)) return;
  const by = { ...unsent.by };
  Object.assign(unsent, { usd: 0, by: {} });
  // the book down: one failed add is enough, the rest go back unsent (not a wait per kind)
  const left = Object.entries(by);
  while (left.length) {
    const [kind, usd] = left.shift();
    if (await send(env, today(env), usd, kind)) continue;
    for (const [k, u] of left) (unsent.usd += u), (unsent.by[k] = (unsent.by[k] ?? 0) + u);
    break;
  }
};

// One Anthropic call's $ onto the site's day (kind: agent | brief | debrief). Returns the add's promise; settled()
// waits for every add this isolate has sent.
export function charge(env, usd, kind = "agent") {
  if (!(usd > 0)) return Promise.resolve();
  const day = today(env);
  if (seen.day === day) seen.usd += usd; // this isolate's view moves at once; the book's answer replaces it
  const p = send(env, day, usd, kind).finally(() => outstanding.delete(p));
  outstanding.set(p, Date.now());
  return p;
}
export function settled(ms = SETTLE_MS) {
  const now = Date.now();
  for (const [p, at] of outstanding) if (now - at > STALE_MS) outstanding.delete(p);
  if (!outstanding.size) return Promise.resolve([]);
  let t;
  return Promise.race([Promise.allSettled([...outstanding.keys()]), new Promise((ok) => (t = setTimeout(() => ok([]), ms)))]).finally(() => clearTimeout(t));
}

// May a Claude call start now? → {ok, usd, cap, reason?}: ok while the site's day is under the cap. One read of the
// book every time (no cached total: another isolate may have spent since); an unreadable book is a no.
export async function claudeRoom(env) {
  const cap = capOf(env);
  if (!(cap > 0)) return { ok: false, usd: 0, cap, reason: "spent" };
  await settled(Number(env.SPEND_SETTLE_MS ?? SETTLE_MS));
  await retryUnsent(env);
  const day = today(env);
  const pending = unsent.day === day ? unsent.usd : 0;
  try {
    await ask(env, `/?day=${day}`);
  } catch (e) {
    console.warn(`[spend] the day's Claude $ can't be read, so no Claude call: ${String(e?.message ?? e).slice(0, 120)}`);
    return { ok: false, usd: null, cap, reason: "unreadable" };
  }
  if (seen.day !== day) Object.assign(seen, { day, usd: 0, at: Date.now() });
  const usd = seen.usd + pending;
  return usd < cap ? { ok: true, usd, cap } : { ok: false, usd, cap, reason: "spent" };
}
// what this isolate last saw of the site's day (for tests and logs)
export const usdSeen = () => seen.usd;
