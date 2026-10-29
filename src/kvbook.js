// KV on the Workers free plan: 1,000 writes and 100,000 reads a day for the whole site. So the Worker
// writes KV twice per new live run at most (the run's own value, and this counter once when it settles), never on a
// saved run or a search, and caches ORS answers only while today's writes leave room. Everything else is counted in
// this isolate's memory and carried into the counter at the next settle.
//
// The counter: one value a month, count:<YYYY-MM> = {calls, day, runs, writes, ips}: the month's Qloo calls (seeded
// by scripts/publish.sh from the ledger), and today's new runs, KV writes and runs per visitor (reset when the day
// changes). Read at the start of a new run, written once when it ends.

export const KV_DAILY_WRITES = 1000; // the free plan's writes a day, for the whole site
export const KV_WRITE_HEADROOM = 200; // new runs rest at 800: room left for the counters and the ORS cache
export const ORS_WRITE_HEADROOM = 50; // the ORS cache stops writing at 950

const monthOf = (env = {}) => (env.TODAY ?? new Date().toISOString()).slice(0, 7);
const dayOf = (env = {}) => env.TODAY ?? new Date().toISOString().slice(0, 10);
export const countKey = (env) => `count:${monthOf(env)}`;

// this isolate's part not yet in KV: Qloo calls (searches, failed settles), writes made (the ORS cache), runs and runs
// per visitor (a settle that failed); and what new runs in flight have reserved
const pending = { calls: 0, writes: 0, runs: 0, ips: {}, day: null };
const inflight = { calls: 0, runs: 0, ips: {} };
export function _resetBook() {
  chain = Promise.resolve();
  Object.assign(pending, { calls: 0, writes: 0, runs: 0, ips: {}, day: null });
  Object.assign(inflight, { calls: 0, runs: 0, ips: {} });
  cache.v = null;
}

// The stored counter (one KV read, kept 5 s in memory), its day fields reset when the day has changed.
const cache = { v: null, at: 0 };
export async function readCount(env, { fresh = false } = {}) {
  if (!env.DOORS_KV) return null;
  if (!fresh && cache.v && Date.now() - cache.at < 5000 && cache.v.month === monthOf(env)) return cache.v;
  const raw = await env.DOORS_KV.get(countKey(env), "json"); // throws when KV can't be read: the caller rests
  const day = dayOf(env);
  const v = { month: monthOf(env), calls: Number(raw?.calls ?? 0), day, runs: 0, writes: 0, ips: {} };
  if (raw?.day === day) Object.assign(v, { runs: Number(raw.runs ?? 0), writes: Number(raw.writes ?? 0), ips: { ...(raw.ips ?? {}) } });
  cache.v = v;
  cache.at = Date.now();
  return v;
}

// The counter as this isolate sees it: stored + pending + in flight. null without KV.
export async function countNow(env) {
  const v = await readCount(env);
  if (!v) return null;
  const today = pending.day === v.day;
  const ips = { ...v.ips };
  for (const src of [today ? pending.ips : {}, inflight.ips]) for (const [k, n] of Object.entries(src)) ips[k] = (ips[k] ?? 0) + n;
  return { calls: v.calls + pending.calls + inflight.calls, runs: v.runs + (today ? pending.runs : 0) + inflight.runs, writes: v.writes + (today ? pending.writes : 0), ips };
}

// Note writes made outside a settle (the ORS cache), and Qloo calls made outside a run (searches): carried into the
// counter at the next settle.
export function noteWrites(env, n = 1) {
  if (pending.day !== dayOf(env)) Object.assign(pending, { writes: 0, runs: 0, ips: {}, day: dayOf(env) });
  pending.writes += n;
}
export const noteCalls = (n) => void (pending.calls += n);

// A new run starts: its reserve and its visitor's count are held in memory until it settles.
export function reserve(env, ip, calls) {
  inflight.calls += calls;
  inflight.runs += 1;
  inflight.ips[ip] = (inflight.ips[ip] ?? 0) + 1;
  return () => {
    inflight.calls -= calls;
    inflight.runs -= 1;
    if (!--inflight.ips[ip]) delete inflight.ips[ip];
  };
}

// A run ends: one read and ONE write of the counter: its calls, whether it counts as today's run for the site and its
// visitor (a run that failed before spending doesn't), the writes it made (`writes`, besides this one) and everything
// pending in this isolate. A write that fails stays pending, so the next settle carries it.
// Settles run one at a time in this isolate (a chain), so two can't read the same value and the second overwrite the first.
let chain = Promise.resolve();
export function settle(env, delta = {}) {
  const next = chain.then(() => settleNow(env, delta));
  chain = next.catch(() => {});
  return next;
}
async function settleNow(env, { calls = 0, counted = false, ip = null, writes = 0 } = {}) {
  if (pending.day !== dayOf(env)) Object.assign(pending, { writes: 0, runs: 0, ips: {}, day: dayOf(env) });
  pending.calls += calls;
  pending.writes += writes + 1;
  if (counted) {
    pending.runs += 1;
    if (ip) pending.ips[ip] = (pending.ips[ip] ?? 0) + 1;
  }
  if (!env.DOORS_KV) return true;
  try {
    const v = await readCount(env, { fresh: true });
    const ips = { ...v.ips };
    for (const [k, n] of Object.entries(pending.ips)) ips[k] = (ips[k] ?? 0) + n;
    const next = { calls: v.calls + pending.calls, day: v.day, runs: v.runs + pending.runs, writes: v.writes + pending.writes, ips };
    await env.DOORS_KV.put(countKey(env), JSON.stringify(next), { expirationTtl: 70 * 86400 });
    Object.assign(pending, { calls: 0, writes: 0, runs: 0, ips: {} });
    cache.v = { month: monthOf(env), ...next };
    cache.at = Date.now();
    return true;
  } catch {
    return false;
  }
}

// May the ORS cache write now? Only below KV_DAILY_WRITES - ORS_WRITE_HEADROOM today (one read, cached 5 s).
export async function orsMayWrite(env) {
  try {
    const c = await countNow(env);
    return Boolean(c) && c.writes < KV_DAILY_WRITES - ORS_WRITE_HEADROOM;
  } catch {
    return false;
  }
}
