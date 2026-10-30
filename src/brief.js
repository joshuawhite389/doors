// Doors Agent's specialist brief and web search (ASK-DOORS-SPEC §3.2, §3.4, build step 3).
//
// The specialist brief: when a profile is saved, POST /api/brief {what, city} asks Claude, with Anthropic's web search
// tool, to research and write a short sourced brief for the product's category in that city (the category's trade, the
// city's drinking scene, how people there talk, what lands and what doesn't, the state's trade-practice rules). It is
// built once per category + city, kept in KV and shared by everyone with the same combination; a cached brief is never
// rebuilt. Only the category and the city leave Doors: never the brand, the product line, the plan or a name.
// The agent reads it as context.specialistBrief (handleAgent fills it from KV with briefForTurn; the client never sends
// it). Until it is ready the agent uses the trade persona alone and says the specialist brief is still loading.
//
// Web search for doors: Anthropic's server-side web_search tool inside the agent's own call (webSearchTool), public
// pages only (Anthropic's crawler honours robots.txt; no logins, no social sites, no people-search sites). Every fact it
// gives comes back as a citation with its link (webFacts), shown under the reply like Qloo's and the route's.
import { productKind, NA_WORD } from "../public/lib/talk.js";
import { usdOf, worstUsd, charge, claudeRoom, settled } from "./spend.js";

export const BRIEF_VERSION = "v1";
export const BRIEF_MODEL = "claude-haiku-5-5"; // env.BRIEF_MODEL overrides (claude-sonnet-5-5 if Haiku's briefs read thin)
export const BRIEF_DAILY = 30; // new briefs a day for the whole site (each ~10–20¢)
export const BRIEF_VISITOR_DAILY = 4; // new briefs one visitor may start a day (this isolate's memory)
export const BRIEF_SEARCHES = 2; // web searches each of a brief's two parts may make (4 a brief)
export const BRIEF_STALE_MS = 2 * 60 * 1000; // a build that has said nothing for this long is taken as dead
export const BRIEF_TTL_S = 60 * 24 * 3600; // a brief is kept 60 days, then built again on the next save
export const BRIEF_MS = 24000; // each part at most: a build ends inside Cloudflare's ~30 s waitUntil after the page goes away
export const WEB_TURN_SEARCHES = 2; // web searches one agent turn may make
export const WEB_VISITOR_DAILY = 15; // web searches one visitor may make a day (this isolate's memory)
export const WEB_DAILY = 400; // web searches a day for the whole isolate (~$4 of searches at Anthropic's $10 / 1,000)
// The dev script's old estimate (scripts/dev/brief-live.mjs). The Worker prices a brief with usdOf (src/spend.js), the
// same table as every Claude call, and counts it against the site's day.
export const PRICE = { in: 1, out: 5, search: 0.01 };

// Sites behind logins, and sites about private people: the agent never reads them.
export const BLOCKED_DOMAINS = ["linkedin.com", "facebook.com", "instagram.com", "x.com", "twitter.com", "tiktok.com", "threads.net", "whitepages.com", "spokeo.com", "beenverified.com", "truepeoplesearch.com", "fastpeoplesearch.com", "radaris.com", "peoplefinders.com", "mylife.com", "zoominfo.com", "rocketreach.co"];

// ---------- category + city ----------
// The brief's category, from the product line (the profile's "what"). Shared by everyone with the same one, so it is
// coarse on purpose: "Dry hard cider" and "Cider" are one brief.
const CATEGORIES = {
  "na-beer": "non-alcoholic beer",
  "craft-beer": "craft beer",
  "seltzer-rtd": "hard seltzer and canned cocktails (RTD)",
  cider: "hard cider",
  "na-wine": "non-alcoholic wine",
  wine: "wine",
  "na-spirits": "non-alcoholic spirits",
  spirits: "craft spirits",
  "soft-drinks": "craft soft drinks (sodas, sparkling water, kombucha, cold coffee, tea)",
  other: "a new drink brand",
};
export function briefCategory(what = "") {
  const kind = productKind(what);
  const na = NA_WORD.test(String(what)) && kind !== "soft";
  const key = kind === "beer" ? (na ? "na-beer" : "craft-beer") : kind === "seltzer" ? "seltzer-rtd" : kind === "cider" ? "cider" : kind === "wine" ? (na ? "na-wine" : "wine") : kind === "spirit" ? (na ? "na-spirits" : "spirits") : kind === "soft" ? "soft-drinks" : na ? "na-beer" : "other";
  return { key, label: CATEGORIES[key] };
}
export const cityName = (s) => String(s ?? "").replace(/[^\p{L}\p{N} ,.'-]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 60);
export const citySlugOf = (s) => cityName(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
export const briefKey = (cat, city) => `brief:${BRIEF_VERSION}:${cat}:${citySlugOf(city)}`;
const dayKey = (now = new Date()) => `brief:count:${now.toISOString().slice(0, 10)}`;

// ---------- the build ----------
export const BRIEF_SYSTEM = [
  "You research for Doors, an app that drink brands' founders and distributor reps use to plan sales visits to bars, restaurants and shops (on-premise and off-premise) in a city.",
  "You write a specialist brief that a field salesperson reads before working that city with that category of drink. It is read by an AI assistant that coaches them, so facts must be right and sourced.",
  "Search the web for current, public information. Prefer trade press (Brewbound, BevNET, Beverage Dynamics, VinePair, Wine Enthusiast, Craft Brewing Business, Good Beer Hunting, SevenFifty Daily), local press and city guides, the state's alcohol regulator, and industry data. Never use social media or anything about private people.",
  "Write about kinds of bars and restaurants (doors, as the trade says), neighbourhoods and trends, not about any one bar's buyer or staff. You may name a door only when a source says what it is known for, and you never say what a named door stocks unless a source says so.",
  "Never name or describe a person (owners, founders, staff, buyers): write about businesses, kinds of doors and the trade.",
  "Every factual sentence must rest on a search result you cite, said in your own plain words (don't paste the source's sentence). Advice that follows from the facts may be written plainly without a citation.",
].join(" ");
// The brief is two parts asked at once (each ~10–20 s), so a build ends inside the ~30 s Cloudflare gives a request's
// work after the page goes away (one five-part call took 29–41 s, measured 10-23): the category's trade and the state's
// rules, and the city's scene, talk and what lands.
const PLAIN = "Plain text, short sentences, no markdown, no preamble or closing remarks. Each part headed by its name in capitals on its own line.";
export const BRIEF_PARTS = [
  {
    key: "trade",
    ask: (label, city) => [
      `Category: ${label}. City: ${city}, USA.`,
      "Write two parts, under 220 words in all:",
      "TRADE: the category's US trade right now: growth or decline, price points by the glass/can/bottle where known, who buys it and why, how distributors treat it, seasonality.",
      `RULES: the trade-practice basics in ${city}'s state a seller must know (tied-house: free goods, samples, tastings, paying for placement, who may sell to retailers), from the state regulator or a law firm's summary.`,
      `${PLAIN} Start with TRADE.`,
    ].join("\n"),
  },
  {
    key: "city",
    ask: (label, city) => [
      `Category: ${label}. City: ${city}, USA.`,
      "Write three parts, under 260 words in all:",
      `SCENE: ${city}'s drinking scene for this category: the neighbourhoods and kinds of doors where it sells, local makers and competitors a buyer will compare it with, recent openings or trends.`,
      `TALK: how buyers and bartenders in ${city} talk about it: the local words and references, what they care about (local, price, margin, menu space, events, sober-curious crowd, tourists).`,
      "LANDS: two or three angles that land with buyers here, and two or three that don't, each with why.",
      `${PLAIN} Start with SCENE.`,
    ].join("\n"),
  },
];
export const briefAsk = (label, city) => BRIEF_PARTS.map((p) => p.ask(label, city)).join("\n\n");

const addUsage = (a, u = {}) => ({
  input_tokens: (a.input_tokens ?? 0) + (u.input_tokens ?? 0),
  cache_read_input_tokens: (a.cache_read_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
  cache_creation_input_tokens: (a.cache_creation_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
  output_tokens: (a.output_tokens ?? 0) + (u.output_tokens ?? 0),
  server_tool_use: { web_search_requests: (a.server_tool_use?.web_search_requests ?? 0) + (u.server_tool_use?.web_search_requests ?? 0) },
});

// The answer's text with its citations as [n] marks, and the numbered sources: the text after the last search result
// (what comes before it is the model's "I'll search…").
export function citedText(content = []) {
  const lastResult = content.map((c) => c.type).lastIndexOf("web_search_tool_result");
  const blocks = content.slice(lastResult + 1).filter((c) => c.type === "text");
  const sources = [];
  const num = (c) => {
    let i = sources.findIndex((s) => s.url === c.url);
    if (i < 0) i = sources.push({ title: String(c.title ?? "").slice(0, 120), url: c.url }) - 1;
    return i + 1;
  };
  let text = "";
  for (const b of blocks) {
    const ns = [...new Set((b.citations ?? []).filter((c) => typeof c.url === "string" && /^https?:\/\//.test(c.url)).map(num))];
    text += b.text + (ns.length ? ` [${ns.join(", ")}]` : "");
  }
  // a mark lands after the cited span, which may have taken the sentence's period with it: tidy "…bars. [2]" spacing
  text = text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return { text, sources };
}

// One Anthropic call with web search, continued on pause_turn (the server's loop stops after ~10 tool steps). Each
// response's $ goes on the site's day (src/spend.js); a request sent and never answered, at its most.
async function claudeSearch({ apiKey, model, system, user, city, maxUses, fetchImpl = globalThis.fetch, timeoutMs = BRIEF_MS, maxTokens = 3000, env = {} }) {
  const messages = [{ role: "user", content: user }];
  const t0 = Date.now();
  let usage = {};
  let content = [];
  for (let i = 0; i < 2; i++) {
    const req = JSON.stringify({ model, max_tokens: maxTokens, thinking: { type: "disabled" }, system, messages, tools: [{ type: "web_search_20250305", name: "web_search", max_uses: maxUses, blocked_domains: BLOCKED_DOMAINS, user_location: { type: "approximate", city, country: "US" } }] });
    const lost = (e) => {
      charge(env, worstUsd({ model, body: req, maxTokens, searches: maxUses }), "brief");
      throw e;
    };
    const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      signal: AbortSignal.timeout(Math.max(1000, timeoutMs - (Date.now() - t0))),
      body: req,
    }).catch(lost);
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const body = await res.json().catch(lost);
    charge(env, usdOf(body.usage, model), "brief");
    usage = addUsage(usage, body.usage);
    content = [...content, ...(body.content ?? [])];
    if (body.stop_reason !== "pause_turn") return { content, usage, ms: Date.now() - t0, stop: body.stop_reason };
    messages.push({ role: "assistant", content: body.content });
  }
  return { content, usage, ms: Date.now() - t0, stop: "pause_turn" };
}

// Merge the parts' cited texts: their [n] marks renumbered onto one source list.
export function mergeCited(parts) {
  const sources = [];
  const texts = parts.map(({ text, sources: own }) => text.replace(/\[(\d+(?:, \d+)*)\]/g, (m, ns) => `[${ns.split(", ").map((n) => {
    const s = own[Number(n) - 1];
    if (!s) return n;
    let i = sources.findIndex((x) => x.url === s.url);
    if (i < 0) i = sources.push(s) - 1;
    return i + 1;
  }).join(", ")}]`));
  return { text: texts.join("\n\n"), sources };
}

// Build one brief: its two parts at once. A part that fails or runs out of time is left out (partial: true); a
// build with no part is thrown (the caller stores the failure). → the value to store.
export async function buildBrief({ env, cat, city, fetchImpl }) {
  const model = env.BRIEF_MODEL || BRIEF_MODEL;
  const label = CATEGORIES[cat] ?? CATEGORIES.other;
  const t0 = Date.now();
  const outs = await Promise.allSettled(BRIEF_PARTS.map((p) => claudeSearch({ apiKey: env.ANTHROPIC_API_KEY, model, system: BRIEF_SYSTEM, user: p.ask(label, city), city: city.split(",")[0], maxUses: BRIEF_SEARCHES, fetchImpl, env })));
  const done = [];
  let usage = {};
  let cut = false;
  outs.forEach((o, i) => {
    if (o.status !== "fulfilled") return console.warn(`[brief] part ${BRIEF_PARTS[i].key} failed: ${String(o.reason?.message ?? o.reason).slice(0, 160)}`);
    usage = addUsage(usage, o.value.usage);
    const c = citedText(o.value.content);
    // cut off at max_tokens: keep the whole lines (a paid-for part is not thrown away), marked cut
    if (o.value.stop === "max_tokens") (cut = true), (c.text = c.text.slice(0, c.text.lastIndexOf("\n")).trim());
    // the model's own note before the first heading ("I have enough to write the brief…") is not the brief
    const head = c.text.search(/^(TRADE|RULES|SCENE|TALK|LANDS)\s*$/m);
    if (head > 0) c.text = c.text.slice(head);
    if (c.text.length >= 120 && c.sources.length) done.push(c);
  });
  const { text, sources } = mergeCited(done);
  if (text.length < 200 || !sources.length) throw new Error(`brief too thin (${text.length} chars, ${sources.length} sources)`);
  return { status: "ready", v: BRIEF_VERSION, category: cat, label, city, text: text.slice(0, 6000), sources: sources.slice(0, 30), built: new Date().toISOString(), model, ...(done.length < BRIEF_PARTS.length ? { partial: true } : {}), ...(cut ? { cut: true } : {}), searches: usage.server_tool_use?.web_search_requests ?? 0, usage: { in: usage.input_tokens ?? 0, out: usage.output_tokens ?? 0 }, usd: Number(usdOf(usage, model).toFixed(4)), ms: Date.now() - t0 };
}

// ---------- the cache ----------
const building = new Map(); // key → promise, this isolate
const visitorBuilds = new Map(); // "<day>|<ip>" → builds started
const nowIso = () => new Date().toISOString();
async function kvGet(env, key) {
  try {
    return env.DOORS_KV ? await env.DOORS_KV.get(key, "json") : null;
  } catch {
    return null;
  }
}
const kvPut = (env, key, v, ttl = BRIEF_TTL_S) => env.DOORS_KV?.put(key, JSON.stringify(v), { expirationTtl: ttl, metadata: { status: v.status } }).catch?.(() => {});

// The brief's state, for /api/brief and the agent: ready (its text), building, failed, or none (never asked for).
export async function briefState(env, cat, city) {
  const v = await kvGet(env, briefKey(cat, city));
  if (!v) return { status: "none" };
  if (v.status === "building" && Date.now() - Date.parse(v.at) > BRIEF_STALE_MS) return { status: "none", stale: true };
  return v;
}

// Ensure a brief exists for this category + city: the cached one, else start a build (unless one is running, the day's
// builds are spent, or there is no key). → {state, work?}: work is the build's promise, for waitUntil.
export async function ensureBrief(env, what, city, { fetchImpl, now = new Date(), ip = null } = {}) {
  const { key: cat } = briefCategory(what);
  const name = cityName(city);
  if (!name || !citySlugOf(name)) return { state: { status: "none", reason: "no city" } };
  const key = briefKey(cat, name);
  const have = await briefState(env, cat, name);
  // a failed build is tried again after the stale window (a thin brief for a small city stays failed a day)
  const retry = have.status === "failed" && Date.now() - Date.parse(have.at) > (have.thin ? 24 * 3600e3 : BRIEF_STALE_MS);
  if (have.status === "ready" || have.status === "building" || (have.status === "failed" && !retry)) return { state: have };
  // a build another request started: never await it here (an ended request's promise can hang this one, live 10-30)
  if (building.has(key)) return { state: { status: "building", category: cat, city: name } };
  if (!env.ANTHROPIC_API_KEY) return { state: { status: "none", reason: "no model" } };
  if (!env.DOORS_KV) return { state: { status: "none", reason: "no cache" } };
  // the site's Claude $ for today has room (src/spend.js); spent or unreadable → no build, the turn goes on without
  const room = await claudeRoom(env);
  if (!room.ok) return { state: { status: "none", reason: room.reason === "spent" ? "spent" : "busy" } };
  const vd = now.toISOString().slice(0, 10);
  if (ip && (visitorBuilds.get(`${vd}|${ip}`) ?? 0) >= BRIEF_VISITOR_DAILY) return { state: { status: "none", reason: "visitor" } };
  const count = Number((await kvGet(env, dayKey(now)))?.n ?? 0);
  if (count >= Number(env.BRIEF_DAILY ?? BRIEF_DAILY)) return { state: { status: "none", reason: "daily" } };
  const mark = { status: "building", category: cat, city: name, at: nowIso() };
  await kvPut(env, key, mark, 600);
  await kvPut(env, dayKey(now), { n: count + 1 }, 2 * 24 * 3600);
  if (ip) {
    for (const k of visitorBuilds.keys()) if (!k.startsWith(vd)) visitorBuilds.delete(k);
    visitorBuilds.set(`${vd}|${ip}`, (visitorBuilds.get(`${vd}|${ip}`) ?? 0) + 1);
  }
  const work = buildBrief({ env, cat, city: name, fetchImpl })
    .then(async (v) => {
      await kvPut(env, key, v);
      console.log(`[brief] ${key} built: ${v.searches} searches, ${v.usage.in}+${v.usage.out} tokens, ~$${v.usd}, ${v.ms} ms`);
      return v;
    })
    .catch(async (e) => {
      const thin = /too thin/.test(String(e?.message));
      console.warn(`[brief] ${key} failed: ${String(e?.message ?? e).slice(0, 200)}`);
      const f = { status: "failed", category: cat, city: name, at: nowIso(), thin };
      await kvPut(env, key, f, 2 * 24 * 3600);
      return f;
    })
    .finally(() => (building.delete(key), settled())); // the build's $ adds reach the book inside waitUntil
  building.set(key, work);
  return { state: mark, work };
}

// ---------- for the agent (src/agent.js) ----------
// context.specialistBrief: one KV read a turn, from the plan's own product line and city.
export async function briefForTurn(env, ctx) {
  const what = ctx?.profile?.what;
  const city = ctx?.city?.name;
  if (!city) return { status: "none" };
  const { key: cat, label } = briefCategory(what);
  const v = await briefState(env, cat, cityName(city));
  const base = { category: label, city: cityName(city) };
  if (v.status === "ready") return { status: "ready", ...base, text: v.text, sources: v.sources.map(({ title, url }) => ({ title, url })), built: v.built };
  // building, or never asked for (a profile saved before briefs existed): the client asks for one when the panel opens
  return { status: v.status === "building" ? "loading" : v.status === "failed" ? "failed" : "loading", ...base };
}

// The system block the agent gets (its own cached block after the persona).
export function briefPrompt(b) {
  if (!b || b.status === "none") return "";
  if (b.status !== "ready")
    return b.status === "failed"
      ? `SPECIALIST BRIEF: none for ${b.category} in ${b.city}; web research found too little. Use your trade know-how, and web_search when the rep needs a local fact.`
      : `SPECIALIST BRIEF: the brief for ${b.category} in ${b.city} is still loading. Use your trade know-how; if the rep asks about the city's scene or local rules, say in one clause that the specialist brief is still loading, then give your best trade advice.`;
  const src = b.sources.map((s, i) => `[${i + 1}] ${s.title ? `${s.title} — ` : ""}${s.url}`).join("\n");
  return [
    `SPECIALIST BRIEF for ${b.category} in ${b.city} (researched ${String(b.built).slice(0, 10)} from public web sources; numbers in brackets are its sources).`,
    "Use it as your local expertise: the city's scene, how people there talk, what lands and what doesn't, and the state's rules. It is about the category and the city, not about any one door: never turn it into a claim about what a named door stocks or who works there. When you use a fact from it that the rep may want to check, give its link from SOURCES.",
    b.text,
    `SOURCES\n${src}`,
  ].join("\n\n");
}

// ---------- web search inside the agent's turn ----------
export const WEB_RULES = [
  "You can search the web (web_search) for public pages about a door: its own site's menu, its events, trivia nights and happy hours, and recent local news about it.",
  "Search only when the rep asks for something like that, or when briefing them on a door and its own page would answer it; never for a person.",
  "Search for the door's name and the city. Say only what a page says, and cite it; if the pages don't say, say so in one clause and go on with trade know-how.",
  "A web fact is stated only as the page says it: its words or a close paraphrase, about this door in this city. Never add a location, branch, address, owner, opening date, menu item, price or event a page didn't state; a page about a same-named place in another city is not this door. Say each fact once. Never name or describe a person from a page (owners, founders, staff). Cite every web fact; what you can't cite, don't say. Put each web fact in its own short sentence, in the page's words, so its citation stays with it.",
  "Every fact from the web keeps its link; Doors shows the links under your reply.",
].join(" ");

const webDay = { day: null, all: 0, ips: new Map() };
function webBook() {
  const d = new Date().toISOString().slice(0, 10);
  if (webDay.day !== d) Object.assign(webDay, { day: d, all: 0, ips: new Map() });
  return webDay;
}
export function _resetWeb() {
  Object.assign(webDay, { day: null, all: 0, ips: new Map() });
}
// The server tool for the Anthropic request, or null when this visitor's or the site's searches for today are spent.
export function webSearchTool(ctx, env = {}, ip = "local") {
  if (env.WEB_SEARCH === "0") return null;
  const b = webBook();
  if (b.all >= Number(env.WEB_DAILY ?? WEB_DAILY) || (b.ips.get(ip) ?? 0) >= WEB_VISITOR_DAILY) return null;
  const city = cityName(ctx?.city?.name);
  return { type: "web_search_20250305", name: "web_search", max_uses: WEB_TURN_SEARCHES, blocked_domains: BLOCKED_DOMAINS, ...(city ? { user_location: { type: "approximate", city, country: "US" } } : {}) };
}
// The turn's web facts from the assistant's content blocks: one fact per cited page, its words the cited text, in the
// facts' shape (agent-tools.js src()): {text, source: {kind: "web", field, door, captured, label: the site, url, title}}.
// ip (optional): counts this turn's searches against the visitor's day.
export function webFacts(content = [], ip = null) {
  const searches = content.filter((c) => c.type === "server_tool_use" && c.name === "web_search").length;
  if (searches) {
    const b = webBook();
    b.all += searches;
    if (ip) b.ips.set(ip, (b.ips.get(ip) ?? 0) + searches);
  }
  const facts = [];
  for (const c of content) {
    if (c.type !== "text") continue;
    for (const x of c.citations ?? []) {
      if (x.type !== "web_search_result_location" || !/^https?:\/\//.test(x.url ?? "")) continue;
      const f = facts.find((y) => y.source.url === x.url);
      const said = plainCited(x.cited_text).slice(0, 240);
      if (f) {
        if (said && !f.text.includes(said) && f.text.length < 400) f.text += ` … ${said}`;
      } else facts.push({ text: said || String(x.title ?? "").slice(0, 120), source: { kind: "web", field: "web", door: null, captured: new Date().toISOString().slice(0, 10), label: hostOf(x.url), url: x.url, title: String(x.title ?? "").slice(0, 120) } });
    }
  }
  // abilities eval 10-23: Haiku sometimes answers from its searches with no citations, and the reply's web facts
  // showed no link: then the pages it read are the sources (title and link; their words are not claimed)
  if (!facts.length && searches) {
    for (const c of content) {
      if (c.type !== "web_search_tool_result" || !Array.isArray(c.content)) continue;
      for (const x of c.content) if (x?.type === "web_search_result" && /^https?:\/\//.test(x.url ?? "") && !facts.some((y) => y.source.url === x.url) && facts.length < 3) facts.push({ text: `Page read: ${String(x.title ?? hostOf(x.url)).slice(0, 120)}`, source: { kind: "web", field: "web", door: null, captured: new Date().toISOString().slice(0, 10), label: hostOf(x.url), url: x.url, title: String(x.title ?? "").slice(0, 120) } });
    }
  }
  return facts.slice(0, 8);
}
// a page's cited words as plain text: its markdown headings, emphasis marks and escapes go (live 10-23: a source read
// "# Nomadic Beerworks ## You might also like #### … \| Eater Austin")
export const plainCited = (t) => String(t ?? "").replace(/(^|\s)#{1,6}(?=\s)/g, "$1").replace(/\\([\\|*_#[\]()>`-])/g, "$1").replace(/\*\*|__/g, "").replace(/\s+/g, " ").trim();
export const hostOf = (u) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "web";
  }
};

// ---------- HTTP: /api/brief ----------
// POST {what, city} (the profile's product line and city; only its category and the city are used): the brief's state;
// a build runs inside the request (and waitUntil, if the page goes away), so a client that waits gets the ready brief.
// GET ?what=&city=: the state only, never a build.
const json = (body, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const publicState = (s) => (s.status === "ready" ? { status: "ready", category: s.label, city: s.city, built: s.built, text: s.text, sources: s.sources } : { status: s.status, ...(s.reason ? { reason: s.reason } : {}) });
export async function handleBrief(request, env, ctx, { originOk, ip = null } = {}) {
  const url = new URL(request.url);
  if (request.method === "GET") {
    const { key: cat } = briefCategory(url.searchParams.get("what") ?? "");
    return json(publicState(await briefState(env, cat, cityName(url.searchParams.get("city")))));
  }
  if (request.method !== "POST") return json({ error: "GET or POST" }, 405);
  if (originOk && !originOk(request, env, { required: true })) return json({ error: "Briefs answer Doors' own page and app." }, 403);
  let body;
  try {
    body = JSON.parse((await request.text()).slice(0, 4000));
  } catch {
    return json({ error: "Send JSON {what, city}" }, 400);
  }
  const { state, work } = await ensureBrief(env, body?.what, body?.city, { ip });
  if (!work) return json(publicState(state));
  ctx?.waitUntil?.(work);
  if (body?.wait === false) return json(publicState(state));
  return json(publicState(await work));
}
