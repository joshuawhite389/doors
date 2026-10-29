// Round 3 enrich lane: how a door's ENRICHMENT RECORD (public/lib/enrich.js) is fetched. Runs in Node (scripts/enrich-
// bake.mjs) and in the Worker (POST /api/enrich for a live plan's door). Two halves:
//   enrichQloo({qloo, door})      the door as Qloo's signal: 4 calls (brands, drink brands, demographics, typed tags);
//                                 a door Qloo refuses as a signal (400 "invalid") gets 1 call for its part of town.
//   fetchSite / extractSite       the door's own public website and menu page: robots.txt honoured, one request per
//                                 host every 2 s, no third-party platforms (SKIP_HOSTS), the page text to a model that
//                                 returns facts WITH A VERBATIM QUOTE each; a fact whose quote isn't on the page is dropped.
// Every Qloo request goes through the caller's QlooClient (its onLedger logs it). No keys here.
import { brandsFrom, drinksFrom, demoFrom, tagsFrom, checkSiteFacts, SITE_KEYS, ENRICH_VERSION } from "../public/lib/enrich.js";

// ---------- Qloo ----------
export const DRINK_BRAND_TAG = "urn:tag:genre:brand:wine_and_spirits";
export const TAG_TYPES_ASKED = "urn:tag:genre:music,urn:tag:specialty_dish:place,urn:tag:keyword:qloo,urn:tag:audience:qloo,urn:tag:hobby:qloo,urn:tag:emotional_tone:qloo";
export const AREA_RADIUS_M = 1200;
export const brandParams = (id, take = 30) => ({ "filter.type": "urn:entity:brand", "signal.interests.entities": id, take });
export const drinkParams = (id, take = 30) => ({ "filter.type": "urn:entity:brand", "signal.interests.entities": id, "filter.tags": DRINK_BRAND_TAG, take });
export const demoParams = (id) => ({ "filter.type": "urn:demographics", "signal.interests.entities": id });
export const tagParams = (id, take = 40) => ({ "filter.type": "urn:tag", "signal.interests.entities": id, "filter.tag.types": TAG_TYPES_ASKED, take });
export const areaDrinkParams = ({ lat, lon }, take = 30) => ({ "filter.type": "urn:entity:brand", "signal.location": `POINT(${lon} ${lat})`, "signal.location.radius": AREA_RADIUS_M, "filter.tags": DRINK_BRAND_TAG, take });
// Qloo's answer when an entity can't be a signal (about one door in five)
export const isInvalidSignal = (e) => e?.status === 400 && /invalid/i.test(String(e?.message ?? ""));

// → {qloo: {basis, brands, drinks, ages, gender, tags, calls}, errors: [string]}
// get(params) is the caller's fetch (the bake's raw cache, or the Worker's client.insights); it throws QlooError.
export async function enrichQloo({ get, door }) {
  const id = door.id;
  const errors = [];
  let calls = 0;
  const ask = async (params) => {
    calls++;
    return get(params);
  };
  const empty = { music: [], dishes: [], keywords: [], hobbies: [], tone: [] };
  let brandsBody;
  try {
    brandsBody = await ask(brandParams(id));
  } catch (e) {
    if (isInvalidSignal(e)) {
      // the door is no signal to Qloo: its part of town instead, when we know where it is
      if (typeof door.lat === "number" && typeof door.lon === "number") {
        try {
          const area = await ask(areaDrinkParams(door));
          return { qloo: { basis: "area", brands: [], drinks: drinksFrom(area), ages: null, gender: null, tags: empty, calls }, errors };
        } catch (e2) {
          errors.push(`area: ${e2.message}`);
        }
      }
      return { qloo: { basis: "none", brands: [], drinks: [], ages: null, gender: null, tags: empty, calls }, errors };
    }
    throw e;
  }
  const safe = async (params, label) => {
    try {
      return await ask(params);
    } catch (e) {
      errors.push(`${label}: ${String(e.message).slice(0, 120)}`);
      return null;
    }
  };
  const [drinksBody, demoBody, tagsBody] = await Promise.all([safe(drinkParams(id), "drinks"), safe(demoParams(id), "demographics"), safe(tagParams(id), "tags")]);
  const { ages, gender } = demoFrom(demoBody, id);
  return { qloo: { basis: "door", brands: brandsFrom(brandsBody), drinks: drinksFrom(drinksBody), ages, gender, tags: tagsBody ? tagsFrom(tagsBody) : empty, calls }, errors };
}

// ---------- the door's own website ----------
export const UA = "Mozilla/5.0 (compatible; DoorsBot/1.0; public pages only; honours robots.txt)";
// never fetched: platforms whose terms forbid it or whose pages are not the bar's own words
export const SKIP_HOSTS = /(^|\.)(untappd\.com|yelp\.com|facebook\.com|fb\.com|instagram\.com|google\.com|goo\.gl|tripadvisor\.com|doordash\.com|ubereats\.com|grubhub\.com|postmates\.com|toasttab\.com|order\.online|opentable\.com|resy\.com|tiktok\.com|x\.com|twitter\.com|linkedin\.com|foursquare\.com|zomato\.com|seamless\.com|clover\.com|chownow\.com|olo\.com)$/i;
export const PAGE_MAX_BYTES = 1_500_000;
export const PAGE_MAX_CHARS = 14000;
export const HOST_GAP_MS = 2000;
export const FETCH_MS = 15000;

// robots.txt → allowed(path) for our agent: the group for "doorsbot", else "*"; longest matching rule wins (Allow
// beats Disallow at equal length); no rules → allowed.
export function parseRobots(text) {
  const groups = [];
  let cur = null;
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) continue;
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const k = m[1].toLowerCase();
    const v = m[2].trim();
    if (k === "user-agent") {
      if (!cur || cur.rules.length) cur = { agents: [], rules: [] }, groups.push(cur);
      cur.agents.push(v.toLowerCase());
    } else if ((k === "allow" || k === "disallow") && cur) cur.rules.push({ allow: k === "allow", path: v });
  }
  const pick = groups.find((g) => g.agents.some((a) => a.includes("doorsbot"))) ?? groups.find((g) => g.agents.includes("*")) ?? null;
  const rules = pick?.rules ?? [];
  const toRe = (p) => new RegExp("^" + p.replace(/[.+?^{}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));
  return {
    groups: groups.length,
    allowed(path = "/") {
      let best = null;
      for (const r of rules) {
        if (!r.path) continue; // "Disallow:" (empty) allows everything
        if (!toRe(r.path).test(path)) continue;
        if (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow)) best = r;
      }
      return best ? best.allow : true;
    },
  };
}

// visible text of an HTML page: title, meta description, body text with scripts, styles and markup gone
const unescape = (s) => String(s ?? "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;|&#x27;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&[a-z]+;/gi, " ");
export function htmlToText(html, max = PAGE_MAX_CHARS) {
  let s = String(html ?? "");
  const title = unescape(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(s)?.[1] ?? "").replace(/\s+/g, " ").trim();
  const desc = unescape(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i.exec(s)?.[1] ?? /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i.exec(s)?.[1] ?? "").replace(/\s+/g, " ").trim();
  s = s.replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style|noscript|svg|template|iframe)[^>]*>[\s\S]*?<\/\1>/gi, " ");
  s = s.replace(/<\/(p|div|li|h[1-6]|tr|br|section|article|header|footer|nav|td|th|dt|dd)>/gi, "\n").replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ");
  s = unescape(s);
  s = s.replace(/[ \t\f\v]+/g, " ").replace(/\s*\n\s*/g, "\n").replace(/\n{2,}/g, "\n").trim();
  const head = [title && `Title: ${title}`, desc && `Description: ${desc}`].filter(Boolean).join("\n");
  const out = (head ? head + "\n" : "") + s;
  return out.length > max ? out.slice(0, max) : out;
}
// links on a page worth a second request: the menu, the taps, the drinks, happy hour, events (same host only)
export const MENU_LINK = /menu|beer|tap|draft|draught|drink|cocktail|wine|spirits|happy|event|brew/i;
export function menuLinks(html, base, { max = 2 } = {}) {
  const out = [];
  let origin;
  try {
    origin = new URL(base).origin;
  } catch {
    return out;
  }
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(String(html ?? ""))) && out.length < max) {
    const text = m[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    let u;
    try {
      u = new URL(m[1], base);
    } catch {
      continue;
    }
    if (u.origin !== origin || !/^https?:$/.test(u.protocol)) continue;
    if (/\.(pdf|jpe?g|png|gif|webp|svg|zip|mp4)$/i.test(u.pathname)) continue;
    if (!(MENU_LINK.test(text) || MENU_LINK.test(u.pathname))) continue;
    u.hash = "";
    const href = u.toString().replace(/\/$/, "");
    if (href.replace(/\/$/, "") === base.replace(/\/$/, "") || out.includes(href)) continue;
    out.push(href);
  }
  return out;
}
const cleanUrl = (u) => {
  if (!u) return null;
  let s = String(u).trim();
  try {
    s = decodeURIComponent(s);
  } catch {}
  if (!/^https?:\/\//i.test(s)) s = "https://" + s.replace(/^\/+/, "");
  try {
    const url = new URL(s);
    url.hash = "";
    // tracking query strings (Pinthouse's "?olonwp=…") go
    if (/^(olonwp|utm_|fbclid|gclid|ref)/i.test([...url.searchParams.keys()][0] ?? "")) url.search = "";
    return url.toString();
  } catch {
    return null;
  }
};
export { cleanUrl };

// A polite fetcher shared by a run: robots per host (cached), one request per host every HOST_GAP_MS, timeouts, size cap.
export function makeSiteFetcher({ fetchImpl = globalThis.fetch, gapMs = HOST_GAP_MS, timeoutMs = FETCH_MS, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), now = Date.now } = {}) {
  const robots = new Map();
  const lastHit = new Map();
  const wait = async (host) => {
    const at = Math.max(now(), (lastHit.get(host) ?? 0) + gapMs);
    lastHit.set(host, at);
    if (at > now()) await sleep(at - now());
  };
  const getText = async (url) => {
    const res = await fetchImpl(url, { headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.5", "accept-language": "en-US,en;q=0.8" }, redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
    const len = Number(res.headers?.get?.("content-length") ?? 0);
    if (len > PAGE_MAX_BYTES) return { res, text: null, reason: "too big" };
    const ctype = String(res.headers?.get?.("content-type") ?? "");
    if (ctype && !/text\/html|application\/xhtml|text\/plain/i.test(ctype)) return { res, text: null, reason: `not html (${ctype.split(";")[0]})` };
    const buf = await res.arrayBuffer();
    if (buf.byteLength > PAGE_MAX_BYTES) return { res, text: null, reason: "too big" };
    return { res, text: new TextDecoder("utf-8", { fatal: false }).decode(buf), reason: null };
  };
  const allowed = async (url) => {
    const u = new URL(url);
    if (!robots.has(u.host)) {
      let parsed = parseRobots("");
      try {
        await wait(u.host);
        const r = await getText(`${u.origin}/robots.txt`);
        if (r.res.ok && r.text) parsed = parseRobots(r.text);
      } catch {}
      robots.set(u.host, parsed);
    }
    return robots.get(u.host).allowed(u.pathname + u.search);
  };
  // → {url, ok, status, reason, html, text}
  async function page(rawUrl) {
    const url = cleanUrl(rawUrl);
    if (!url) return { url: rawUrl, ok: false, reason: "no url" };
    const host = new URL(url).host;
    if (SKIP_HOSTS.test(host)) return { url, ok: false, reason: "skipped host" };
    if (!(await allowed(url))) return { url, ok: false, reason: "robots" };
    try {
      await wait(host);
      const r = await getText(url);
      if (!r.res.ok) return { url, ok: false, status: r.res.status, reason: `http ${r.res.status}` };
      if (!r.text) return { url, ok: false, status: r.res.status, reason: r.reason };
      const text = htmlToText(r.text);
      return { url, ok: true, status: r.res.status, html: r.text, text, final: r.res.url || url };
    } catch (e) {
      return { url, ok: false, reason: /abort|timeout/i.test(String(e?.name ?? e?.message)) ? "timeout" : `fetch: ${String(e?.message ?? e).slice(0, 80)}` };
    }
  }
  return { page, allowed, robots };
}

// The door's site: its homepage, its menu page (Qloo's menu_url) and up to two menu-like links from the homepage.
// → {url, menuUrl, pages: [{url, text}], reason?: why nothing came back}
export const THIN_CHARS = 300;
export async function fetchSite({ website, menu = null, fetcher }) {
  const url = cleanUrl(website);
  const menuUrl = cleanUrl(menu);
  if (!url) return { url: null, menuUrl, pages: [], reason: "no website" };
  const pages = [];
  const seen = new Set();
  const take = async (u) => {
    if (!u || seen.has(u.replace(/\/$/, ""))) return null;
    seen.add(u.replace(/\/$/, ""));
    const p = await fetcher.page(u);
    if (p.ok && p.text && p.text.length >= THIN_CHARS) pages.push({ url: p.final ?? p.url, text: p.text });
    return p;
  };
  const home = await take(url);
  if (!home?.ok) return { url, menuUrl, pages, reason: home?.reason ?? "no page" };
  if (menuUrl) await take(menuUrl);
  for (const l of menuLinks(home.html, home.final ?? url)) await take(l);
  if (!pages.length) return { url, menuUrl, pages, reason: "thin" };
  return { url, menuUrl, pages };
}

// ---------- the model that reads the pages ----------
export const SITE_MODEL = "claude-sonnet-5-5";
export const SITE_SYSTEM = [
  "You read the public website of one bar or restaurant for a drinks salesperson who is about to call on it. From the page text you are given, pull out ONLY what the site itself states, as short facts, each with a verbatim quote from the page that proves it.",
  `Fact kinds (k): ${SITE_KEYS.join(", ")}. what = what the place says it is, in its own words; brews_own = it brews, distills, roasts or makes its own drinks (only when stated); taps = how many taps/draft lines, when stated; house_drinks = house beers, house cocktails, signature drinks by name; non_alcoholic = any non-alcoholic option it lists (NA beer by brand, mocktails, zero-proof, kombucha, sodas, coffee); drinks = brands, styles or programs of beer, wine, spirits or cocktails it names (brand names matter: a rep needs to know what they already pour); happy_hour = happy hour days, hours, deals; events = recurring events (trivia, live music nights, run clubs, markets, game days); food = the food in one line; space = patio, dog-friendly, capacity, private room, TVs, stage; other = anything else a salesperson would want to know (new ownership, hours, delivery, awards).`,
  "Rules: never infer or guess. No fact without a quote that appears word for word on the page (up to 30 words). text is plain and literal, at most 25 words, no slogans. At most 14 facts; prefer drinks, non_alcoholic, brews_own, taps, happy_hour and events over the rest. Skip navigation, cookie notices, legal text and job ads. If the pages say nothing useful, return an empty list.",
  'Return ONLY JSON: {"facts": [{"k": "...", "text": "...", "quote": "...", "from": "<the page url the quote is on>"}]}.',
].join("\n");
const FACT = { type: "object", properties: { k: { type: "string" }, text: { type: "string" }, quote: { type: "string" }, from: { type: "string" } }, required: ["k", "text", "quote", "from"], additionalProperties: false };
export const SITE_FORMAT = { type: "json_schema", schema: { type: "object", properties: { facts: { type: "array", items: FACT } }, required: ["facts"], additionalProperties: false } };
export function siteUser({ name, pages }) {
  return [`The place: ${name}.`, ...pages.map((p, i) => `--- PAGE ${i + 1}: ${p.url} ---\n${p.text}`)].join("\n\n");
}
// make: an anthropicSession factory (src/llm.js) with SITE_FORMAT. → {facts, dropped, raw}
export async function extractSite({ name, pages, make }) {
  const out = await make({ system: SITE_SYSTEM, user: siteUser({ name, pages }), tools: [] }).step();
  let raw = null;
  try {
    raw = JSON.parse(/\{[\s\S]*\}/.exec(out.text ?? "")?.[0] ?? "");
  } catch {}
  const all = pages.map((p) => p.text).join("\n");
  const byUrl = new Map(pages.map((p) => [p.url.replace(/\/$/, ""), p]));
  const { facts, dropped } = checkSiteFacts(raw?.facts ?? [], all);
  // the quote's page, as the model said when that page really holds it, else the first page that does
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9'"&$%]+/g, " ").trim();
  for (const f of facts) {
    const said = byUrl.get(String(raw.facts.find((x) => x.text === f.text)?.from ?? "").replace(/\/$/, ""));
    const holds = (p) => p && norm(p.text).includes(norm(f.quote));
    const page = holds(said) ? said : pages.find(holds);
    f.from = page?.url ?? pages[0].url;
  }
  return { facts, dropped, raw };
}

// one door's site record (the record's `site`), end to end: fetch, then the model when there is text
export async function enrichSite({ door, fetcher, make, model = SITE_MODEL, today = new Date().toISOString().slice(0, 10) }) {
  const got = await fetchSite({ website: door.website, menu: door.menu, fetcher });
  if (!got.url) return null;
  const base = { url: got.url, menuUrl: got.menuUrl, fetched: today, pages: got.pages.map((p) => p.url) };
  if (!got.pages.length) return { ...base, ok: false, reason: got.reason ?? "thin", model: null, facts: [] };
  const { facts, dropped } = await extractSite({ name: door.name, pages: got.pages, make });
  return { ...base, ok: true, model, facts, dropped: dropped.length };
}

export const enrichRecord = ({ door, qloo, site = null, today = new Date().toISOString().slice(0, 10) }) => ({ v: ENRICH_VERSION, id: door.id, name: door.name, at: today, qloo, vsCity: null, site });
