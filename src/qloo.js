// Thin Qloo API client. Runs in Cloudflare Workers and Node 22+ (global fetch).
// The key never leaves the server: the browser only ever talks to /api/*.
// Copied from Opener; adds POST (weighted signals need {id, weight} objects) and an onLedger hook per real request.

export const QLOO_BASE_URL = "https://hackathon.api.qloo.com";

export class QlooError extends Error {
  constructor(message, { status, path } = {}) {
    super(message);
    this.name = "QlooError";
    this.status = status;
    this.path = path;
  }
}

// Qloo takes arrays as comma-joined query values.
export function toQueryString(params) {
  const url = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    url.set(key, Array.isArray(value) ? value.join(",") : String(value));
  }
  return url.toString();
}

export function resultArray(response, key) {
  const results = response?.results;
  if (Array.isArray(results)) return results;
  const value = results?.[key] ?? [];
  return Array.isArray(value) ? value : [];
}

// The hackathon key allows 5 requests/second and 10,000/month (see DATA-CHECK.md).
// Space request starts so one client never exceeds ~4/s, and remember the monthly balance.
const MIN_GAP_MS = 250;
// fix5-res: a 429 (or a 5xx, or a dropped connection) is retried after RETRY_MS, then twice that, each with up to half
// again of jitter (concurrent runs in other isolates back off apart, not in step); Qloo's Retry-After wins when it says
// longer (at most 5 s). A 429 also holds back this isolate's next requests by the same wait. A run's client retries
// at most RETRY_BUDGET times in all: Cloudflare's free plan allows 50 subrequests per request, and a run is ~25 calls.
const RETRY_MS = 800;
export const RETRY_BUDGET = 8;
export const quota = { monthRemaining: undefined };
// Shared by every client in this isolate, so concurrent visitors share one budget.
const gate = { nextSlot: 0 };

export class QlooClient {
  constructor({ apiKey, baseUrl = QLOO_BASE_URL, fetchImpl = globalThis.fetch, cache = new Map(), onRequest, onLedger, minGapMs = MIN_GAP_MS, retryMs = RETRY_MS, retryBudget = RETRY_BUDGET, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
    if (!apiKey) throw new Error("QlooClient needs an apiKey");
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.fetch = fetchImpl;
    this.cache = cache;
    this.onRequest = onRequest;
    this.onLedger = onLedger; // called once per HTTP request that reached Qloo: {path, params, status, remaining, ms}
    this.calls = 0;
    this.minGapMs = minGapMs;
    this.retryMs = retryMs;
    this.retriesLeft = retryBudget;
    this.sleep = sleep;
  }

  // the wait before retry `attempt` (1, 2): RETRY_MS × 2^(attempt-1) plus up to half again, or Qloo's Retry-After
  backoff(attempt, retryAfter) {
    const ms = Math.round(this.retryMs * 2 ** (attempt - 1) * (1 + Math.random() / 2));
    const ra = Number.parseFloat(retryAfter);
    return Number.isFinite(ra) && ra > 0 ? Math.max(ms, Math.min(5000, ra * 1000)) : ms;
  }

  async slot() {
    const now = Date.now();
    if (!this.minGapMs) return;
    const at = Math.max(now, gate.nextSlot);
    gate.nextSlot = at + this.minGapMs;
    if (at > now) await new Promise((r) => setTimeout(r, at - now));
  }

  get(path, params = {}) {
    return this.request("GET", path, params);
  }

  // POST with a JSON body (weighted signals). Cached by the body.
  post(path, body = {}) {
    return this.request("POST", path, body);
  }

  async request(method, path, params) {
    const qs = method === "GET" ? toQueryString(params) : "";
    const key = method === "GET" ? `${path}?${qs}` : `POST ${path} ${JSON.stringify(params)}`;
    if (this.cache.has(key)) return this.cache.get(key);
    let lastError;
    let wait = 0;
    // Two bounded retries, only on rate limits, server errors and dropped connections, within the run's retry budget.
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) {
        if (this.retriesLeft <= 0) break;
        this.retriesLeft--;
        await this.sleep(wait || this.backoff(attempt));
      }
      wait = 0;
      await this.slot();
      const started = Date.now();
      let res;
      try {
        res = await this.fetch(method === "GET" ? `${this.baseUrl}${path}?${qs}` : `${this.baseUrl}${path}`, {
          method,
          headers: { "X-Api-Key": this.apiKey, Accept: "application/json", ...(method === "POST" ? { "content-type": "application/json" } : {}) },
          ...(method === "POST" ? { body: JSON.stringify(params) } : {}),
        });
      } catch (err) {
        lastError = new QlooError(`Qloo request failed: ${err.message}`, { path });
        continue;
      }
      const devCached = res.headers?.get?.("x-doors-dev-cache") === "1"; // dev server's disk cache: no Qloo call made
      if (!devCached) this.calls++;
      const left = Number.parseInt(res.headers?.get?.("x-month-ratelimit-remaining"), 10);
      if (Number.isFinite(left)) quota.monthRemaining = left;
      const ms = Date.now() - started;
      this.onRequest?.({ path, params, status: res.status, ms });
      if (!devCached) try {
        await this.onLedger?.({ method, path, params, status: res.status, remaining: Number.isFinite(left) ? left : null, ms });
      } catch {}
      if (res.ok) {
        const body = await res.json();
        this.cache.set(key, body);
        if (this.cache.size > 500) this.cache.delete(this.cache.keys().next().value);
        return body;
      }
      const text = (await res.text()).slice(0, 300);
      lastError = new QlooError(`Qloo ${res.status} on ${path}: ${text}`, { status: res.status, path });
      if (res.status !== 429 && res.status < 500) break;
      if (res.status === 429) {
        wait = this.backoff(attempt + 1, res.headers?.get?.("retry-after"));
        if (this.minGapMs) gate.nextSlot = Math.max(gate.nextSlot, Date.now() + wait); // the whole isolate eases off
      }
    }
    throw lastError;
  }

  search(query, { types, take = 5 } = {}) {
    return this.get("/search", { query, types, take });
  }

  insights(params) {
    return this.get("/v2/insights", params);
  }

  insightsPost(body) {
    return this.post("/v2/insights", body);
  }

  tags(params) {
    return this.get("/v2/tags", params);
  }

}
