// The live-run and search guards (review6): one visitor must not be able to push the site into "resting" for the
// judges, or spend the budget from another site. The counts themselves are in src/kvbook.js (one KV value, written
// once per new run: the free plan's 1,000 writes a day). Option A of the review: no D1.

export const JUDGING_END = "2026-11-16"; // the app stays open and free through judging
export const INFLIGHT_MAX = 2; // new runs at once per isolate

// The key a visitor's limits are counted under: an IPv4 address, or an IPv6 address's /64 (one home or phone network
// gets a whole /64, so per-address limits would be no limit at all).
export function ipKey(ip) {
  const s = String(ip ?? "").trim().toLowerCase();
  if (!s.includes(":")) return s || "local";
  const [head, tail = ""] = s.split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const groups = s.includes("::") ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t] : h;
  return `${groups.slice(0, 4).map((g) => (g || "0").replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

// What the KV run counter keeps for a visitor (no raw IPs at rest): a one-way hash of the day, a
// secret salt and ipKey's address (/64 for IPv6), so a stored key can't be turned back into an address or matched
// across days. The salt: env.IP_SALT (a Worker secret); without it, one derived from QLOO_API_KEY (a secret, never
// stored); without either (dev, tests), a fixed dev salt. The counts and limits are the same as before, only the key changes.
export async function visitorKey(env, ip, day) {
  const salt = env?.IP_SALT ?? (env?.QLOO_API_KEY ? `qloo|${env.QLOO_API_KEY}` : "doors-dev-salt");
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`doors-visitor|${salt}|${day}|${ip}`)));
  return `v1:${btoa(String.fromCharCode(...d.slice(0, 16))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
}

// Days from `day` (YYYY-MM-DD) to the end of judging, both counted; past it, the days left in the calendar month.
export function daysLeft(day, end = JUDGING_END) {
  const d = Date.parse(`${day}T00:00:00Z`);
  const e = Date.parse(`${end}T00:00:00Z`);
  if (d <= e) return Math.round((e - d) / 864e5) + 1;
  const dt = new Date(d);
  return new Date(Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth() + 1, 0)).getUTCDate() - dt.getUTCDate() + 1;
}

// How many new live runs the whole site may start today: what is left of the month's budget, spread over the days
// left, at COST.route a run; at least one.
export const dailyCeiling = ({ budget, used, cost, day, end = JUDGING_END }) => Math.max(1, Math.floor(Math.max(0, budget - used) / cost / daysLeft(day, end)));

// A request from another site may not start runs or searches on this one (it would spend the budget through its own
// visitors). `required`: the request must carry an Origin (browsers send one on every POST). Allowed: this Worker's
// own origin, a local dev server, and ALLOWED_ORIGINS (comma-separated).
export function originOk(request, env = {}, { required = false } = {}) {
  const origin = request.headers.get("origin");
  if (request.headers.get("sec-fetch-site") === "cross-site") return false;
  if (!origin) return !required;
  if (origin === new URL(request.url).origin) return true;
  if (/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) return true;
  return String(env.ALLOWED_ORIGINS ?? "").split(",").map((s) => s.trim()).filter(Boolean).includes(origin);
}
