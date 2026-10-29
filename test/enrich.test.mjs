// Round 3 enrich lane: the per-door enrichment record (public/lib/enrich.js), how it is fetched (src/enrich.js),
// POST /api/enrich (src/worker.js) and the browser side (public/lib/enrich-client.js). Qloo, the web and the model are
// fakes; no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { drinkCat, brandsFrom, drinksFrom, demoFrom, tagsFrom, vsCity, enrichFacts, enrichText, checkSiteFacts, emptyEnrich, DRINK_CATS, LIFT_RARE } from "../public/lib/enrich.js";
import { enrichQloo, parseRobots, htmlToText, menuLinks, fetchSite, makeSiteFetcher, extractSite, isInvalidSignal, brandParams, areaDrinkParams, cleanUrl, SKIP_HOSTS } from "../src/enrich.js";
import { enrichFor, _resetEnrichClient } from "../public/lib/enrich-client.js";
import worker, { COST } from "../src/worker.js";

const tag = (id, name = id.split(":").at(-1)) => ({ id, name, type: id.split(":").slice(0, 3).join(":") });
const brand = (id, name, tags, aff = 0.9, pop = 0.8) => ({ entity_id: id, name, popularity: pop, tags: tags.map((t) => tag(t)), query: { affinity: aff } });
const WS = "urn:tag:genre:brand:wine_and_spirits";

test("drinkCat: Qloo's brand genres decide, the most specific first; keywords never (a brewery with an NA line stays craft beer)", () => {
  assert.equal(drinkCat([WS, `${WS}:beer:craft`, `${WS}:beer`, "urn:tag:keyword:qloo:craft_beer", "urn:tag:product_category:qloo:non_alcoholic_beverages"]), "craft beer");
  assert.equal(drinkCat([`${WS}:non_alcoholic`, WS, "urn:tag:keyword:qloo:craft_beer"]), "non-alcoholic");
  assert.equal(drinkCat([`${WS}:spirits`, WS, `${WS}:spirits:hard_seltzer`]), "RTD");
  assert.equal(drinkCat([WS, `${WS}:beer:cider`, `${WS}:spirits:hard_seltzer`, `${WS}:beer`]), "cider");
  assert.equal(drinkCat([`${WS}:beer`, WS, `${WS}:beer:other`, "urn:tag:product_category:qloo:hard_tea"]), "beer");
  assert.equal(drinkCat([WS, `${WS}:spirits:vodka`, `${WS}:spirits`]), "vodka");
  assert.equal(drinkCat([`${WS}:spirits:whiskey`, `${WS}:spirits:whiskey:other`]), "whiskey");
  assert.equal(drinkCat(["urn:tag:product_category:qloo:tequila"]), "tequila"); // no genre: the product category
  assert.equal(drinkCat(["urn:tag:genre:brand:apparel"]), null);
  for (const c of ["non-alcoholic", "craft beer", "beer", "cider", "whiskey", "tequila", "vodka", "spirits", "RTD", "wine"]) assert.ok(DRINK_CATS.includes(c));
});

const BRANDS = { results: { entities: [brand("B1", "Stetson", ["urn:tag:genre:brand:apparel", "urn:tag:genre:brand:apparel:western_wear"], 0.97), brand("B2", "Pendleton Whisky", [WS, `${WS}:spirits:whiskey`], 0.91), brand("B3", "Coors Banquet", [WS, `${WS}:beer:other`], 0.88)] } };
const DEMO = { results: { demographics: [{ entity_id: "D1", query: { age: { "24_and_younger": -0.02, "25_to_29": -0.04, "30_to_34": 0, "35_to_44": 0, "45_to_54": -0.49, "55_and_older": 0.48 }, gender: { male: -0.06, female: 0.06 } } }] } };
const TAGS = { results: { tags: [{ tag_id: "urn:tag:genre:music:americana", name: "americana", subtype: "urn:tag:genre:music", query: { affinity: 1 } }, { tag_id: "urn:tag:specialty_dish:place:hush_puppies", name: "Hush Puppies", subtype: "urn:tag:specialty_dish:place", query: { affinity: 0.99 } }, { tag_id: "urn:tag:hobby:qloo:hiking", name: "Hiking", subtype: "urn:tag:hobby:qloo" }, { tag_id: "urn:tag:setting:qloo:downtown", name: "Downtown", subtype: "urn:tag:setting:qloo" }, { tag_id: "urn:tag:genre:music:americana", name: "Americana", subtype: "urn:tag:genre:music" }] } };

test("brandsFrom / drinksFrom / demoFrom / tagsFrom read Qloo's bodies into the record's parts", () => {
  const b = brandsFrom(BRANDS);
  assert.deepEqual(b.map((x) => x.name), ["Stetson", "Pendleton Whisky", "Coors Banquet"]);
  assert.deepEqual(b[0].cats, ["western_wear"]); // the sub-genre names, never the top level
  assert.equal(b[0].aff, 0.97);
  const d = drinksFrom(BRANDS);
  assert.deepEqual(d.map((x) => [x.name, x.cat]), [["Pendleton Whisky", "whiskey"], ["Coors Banquet", "beer"]]); // Stetson is no drink
  assert.deepEqual(demoFrom(DEMO, "D1"), { ages: { "24_and_younger": -0.02, "25_to_29": -0.04, "30_to_34": 0, "35_to_44": 0, "45_to_54": -0.49, "55_and_older": 0.48 }, gender: { male: -0.06, female: 0.06 } });
  assert.deepEqual(demoFrom({ results: { demographics: [] } }), { ages: null, gender: null });
  const t = tagsFrom(TAGS);
  assert.deepEqual(t.music, ["americana"]); // once, lower case
  assert.deepEqual(t.dishes, ["Hush Puppies"]);
  assert.deepEqual(t.hobbies, ["Hiking"]);
  assert.deepEqual(t.keywords, []); // "Downtown" is a setting tag: not asked for, not kept
});

// four doors in one city: whiskey at one, a common beer at all, one area-basis door
const door = (id, name, drinks, ages, extra = {}) => ({ ...emptyEnrich(id, name), at: "2026-10-25", qloo: { basis: "door", brands: drinks.map(([n, c]) => ({ id: n, name: n, aff: 0.9, pop: 0.8, cats: [c] })), drinks: drinks.map(([n, c]) => ({ id: n, name: n, aff: 0.9, pop: 0.8, cat: c })), ages, gender: { male: 0, female: 0 }, tags: { music: [], dishes: [], keywords: [], hobbies: [], tone: [] }, calls: 4, ...extra } });
const AGES = (old) => ({ "24_and_younger": 0, "25_to_29": 0, "30_to_34": 0, "35_to_44": 0, "45_to_54": 0, "55_and_older": old });
const CITY = {
  A: door("A", "Honky Tonk", [["Pendleton Whisky", "whiskey"], ["Bulleit", "whiskey"], ["Stillhouse", "whiskey"], ["Lone Star", "beer"]], AGES(0.5)),
  B: door("B", "Brewpub", [["Lagunitas", "craft beer"], ["Dogfish Head", "craft beer"], ["Sierra Nevada", "craft beer"], ["Lone Star", "beer"]], AGES(-0.2)),
  C: door("C", "Sports Bar", [["Coors", "beer"], ["Miller", "beer"], ["Bud", "beer"], ["Lone Star", "beer"]], AGES(0.0)),
  D: door("D", "Cocktail Bar", [["Tito's", "vodka"], ["Casamigos", "tequila"], ["Hendrick's", "spirits"], ["Lone Star", "beer"]], AGES(0.1)),
  E: { ...emptyEnrich("E", "No Signal"), at: "2026-10-25", qloo: { basis: "area", brands: [], drinks: [{ id: "x", name: "Shiner", aff: 0.9, pop: 0.7, cat: "beer" }], ages: null, gender: null, tags: { music: [], dishes: [], keywords: [], hobbies: [], tone: [] }, calls: 2 } },
};

test("vsCity: a brand few doors share is distinctive (lift = doors / doors with it), one every door has is not; categories, ages; an area door compares to nothing", () => {
  const v = vsCity(CITY);
  assert.equal(v.A.doors, 4); // area doors don't count in the baseline
  assert.deepEqual(v.A.drinks.map((x) => [x.name, x.lift, x.inDoors]), [["Pendleton Whisky", 4, 1], ["Bulleit", 4, 1], ["Stillhouse", 4, 1]]);
  assert.ok(!v.A.drinks.some((x) => x.name === "Lone Star")); // in all four: lift 1
  assert.ok(LIFT_RARE <= 4);
  assert.deepEqual(v.A.cats.map((c) => [c.cat, c.n, c.lift]), [["whiskey", 3, 4]]); // 3 of 4 vs a city mean of 3/16
  assert.deepEqual(v.A.ages.map((a) => [a.band, a.diff]), [["55_and_older", 0.45]]); // 0.5 vs a median of 0.05
  assert.deepEqual(v.B.ages.map((a) => [a.band, a.diff]), [["55_and_older", -0.25]]);
  assert.deepEqual(v.C.ages, []); // 0 vs 0.05
  assert.equal(v.A.gender, null);
  assert.deepEqual(v.E, { doors: 4, drinks: [], cats: [], brands: [], ages: [], gender: null, tags: { music: [], dishes: [], keywords: [], hobbies: [] } });
  assert.deepEqual(vsCity({}), {});
});

test("enrichFacts: only the distinctive lines, prep marked; an area door says so; the site's lines carry their url; nothing → no lines", () => {
  const v = vsCity(CITY);
  const a = { ...CITY.A, vsCity: v.A, site: { url: "https://honky.example/", menuUrl: null, fetched: "2026-10-25", ok: true, model: "m", facts: [{ k: "events", text: "Two-step lessons on Sundays and Tuesdays.", quote: "two step lessons", from: "https://honky.example/events" }, { k: "drinks", text: "A large local draft beer selection.", quote: "huge local draft beer selection", from: "https://honky.example/" }] } };
  const lines = enrichFacts(a);
  const labels = lines.map((l) => l.label);
  assert.ok(labels[0].startsWith("Drink kinds this crowd over-indexes on"), labels[0]);
  assert.match(lines[0].text, /whiskey \(4× the city's bars\)/);
  assert.ok(lines.find((l) => /Drink brands its crowd rates that few bars here share/.test(l.label))?.text.includes("Pendleton Whisky (whiskey, 4×)"));
  assert.ok(lines.find((l) => l.label === "Age skew vs this city's bars")?.text.includes("more 55 and over (+0.45"));
  for (const l of lines.filter((l) => l.src === "qloo")) assert.equal(l.prep, true, l.label);
  const site = lines.filter((l) => l.src === "site");
  assert.deepEqual(site.map((l) => l.label), ["Drinks it names (its own website)", "Events (its own website)"]); // SITE_KEYS order
  assert.equal(site[0].from, "https://honky.example/");
  assert.equal(site[0].prep, undefined); // the door's own words may be said and cited
  assert.match(enrichText(a), /^Drink kinds this crowd over-indexes on/);
  const e = enrichFacts({ ...CITY.E, vsCity: v.E });
  assert.equal(e.length, 1);
  assert.match(e[0].label, /part of town \(Qloo doesn't read this door's own crowd\)/);
  assert.deepEqual(enrichFacts(emptyEnrich("Z", "Nothing")), []);
  assert.deepEqual(enrichFacts(null), []);
});

test("checkSiteFacts: a fact stays only with a verbatim quote on the page", () => {
  const page = "Happy Hour\nMon - Fri: 3pm - 6pm · $5 Pints of Beer · $7 Glasses of Wine\nOur brewing team crafts flavorful beers.";
  const { facts, dropped } = checkSiteFacts([
    { k: "happy_hour", text: "Happy hour Mon–Fri 3–6pm: $5 pints.", quote: "Mon - Fri: 3pm - 6pm $5 Pints of Beer" },
    { k: "brews_own", text: "Brews its own beer.", quote: "Our brewing team crafts flavorful beers" },
    { k: "taps", text: "40 taps.", quote: "40 taps of local beer" },
    { k: "food", text: "Pizza.", quote: "" },
    { k: "nonsense", text: "x", quote: "Happy Hour Mon" },
  ], page);
  assert.deepEqual(facts.map((f) => f.k), ["happy_hour", "brews_own"]);
  assert.deepEqual(dropped.map((d) => d.reason), ["quote not on the page", "no quote"]);
});

test("parseRobots: our group first, else *, longest rule wins, Allow beats Disallow at equal length, no file = allowed", () => {
  const r = parseRobots("User-agent: *\nDisallow: /private/\nDisallow: /menu\nAllow: /menu/public\n\nUser-agent: Googlebot\nDisallow: /\n");
  assert.equal(r.allowed("/"), true);
  assert.equal(r.allowed("/menu"), false);
  assert.equal(r.allowed("/menu/drinks"), false);
  assert.equal(r.allowed("/menu/public/beer"), true);
  assert.equal(r.allowed("/private/x"), false);
  const ours = parseRobots("User-agent: DoorsBot\nDisallow: /events\n\nUser-agent: *\nDisallow: /\n");
  assert.equal(ours.allowed("/"), true);
  assert.equal(ours.allowed("/events/1"), false);
  assert.equal(parseRobots("").allowed("/anything"), true);
  assert.equal(parseRobots("User-agent: *\nDisallow:\n").allowed("/x"), true); // an empty Disallow allows all
  assert.equal(parseRobots("User-agent: *\nDisallow: /*.pdf$\n").allowed("/menu.pdf"), false);
});

test("htmlToText keeps the title, description and visible words; menuLinks keeps same-host menu-like links only", () => {
  const html = `<html><head><title>Ben White  Brewpub</title><meta name="description" content="Brewpub &amp; pizza"><style>.x{}</style><script>var a=1;</script></head><body><nav><a href="/pizza-menu">Pizza Menu</a><a href="https://order.toasttab.com/x">Order</a><a href="/about">About</a><a href="https://brewpub.example/beer#taps">Our Beer</a><a href="/menu.pdf">PDF</a></nav><h1>Happy Hour</h1><p>Mon &ndash; Fri: 3pm&nbsp;- 6pm</p><!-- hidden --></body></html>`;
  const t = htmlToText(html);
  assert.match(t, /^Title: Ben White Brewpub\nDescription: Brewpub & pizza\n/);
  assert.match(t, /Happy Hour\nMon\s+Fri: 3pm - 6pm/);
  assert.doesNotMatch(t, /var a=1|\.x\{\}|hidden/);
  assert.deepEqual(menuLinks(html, "https://brewpub.example/"), ["https://brewpub.example/pizza-menu", "https://brewpub.example/beer"]);
  assert.deepEqual(menuLinks(html, "https://brewpub.example/", { max: 1 }), ["https://brewpub.example/pizza-menu"]);
  assert.equal(cleanUrl("https://brewpub.example/%3Folonwp%3DJjBtp"), "https://brewpub.example/"); // Qloo's tracking query goes
  assert.equal(cleanUrl("twostep.example"), "https://twostep.example/");
  assert.ok(SKIP_HOSTS.test("www.untappd.com") && SKIP_HOSTS.test("order.toasttab.com") && !SKIP_HOSTS.test("order.pinthouse.com"));
});

const invalid = () => Object.assign(new Error("Qloo 400 on /v2/insights: All of the provided signal.interests.entities were invalid."), { status: 400 });
test("enrichQloo: a valid door is 4 calls (basis door); a door Qloo refuses as a signal gets its part of town (2 calls, basis area), or nothing without a location", async () => {
  const seen = [];
  const get = async (p) => {
    seen.push(p);
    if (p["filter.type"] === "urn:demographics") return DEMO;
    if (p["filter.type"] === "urn:tag") return TAGS;
    return BRANDS;
  };
  const ok = await enrichQloo({ get, door: { id: "D1", name: "Two Step Hall", lat: 30.2, lon: -97.7 } });
  assert.equal(ok.qloo.basis, "door");
  assert.equal(ok.qloo.calls, 4);
  assert.deepEqual(seen.map((p) => p["filter.type"]), ["urn:entity:brand", "urn:entity:brand", "urn:demographics", "urn:tag"]);
  assert.deepEqual(seen[0], brandParams("D1"));
  assert.equal(ok.qloo.ages["55_and_older"], 0.48);
  assert.deepEqual(ok.qloo.tags.music, ["americana"]);
  assert.deepEqual(ok.errors, []);
  const areaSeen = [];
  const area = await enrichQloo({ get: async (p) => { areaSeen.push(p); if (p["signal.interests.entities"]) throw invalid(); return BRANDS; }, door: { id: "P1", name: "Ben White Brewpub", lat: 30.2153808, lon: -97.7423669 } });
  assert.equal(area.qloo.basis, "area");
  assert.equal(area.qloo.calls, 2);
  assert.deepEqual(areaSeen[1], areaDrinkParams({ lat: 30.2153808, lon: -97.7423669 }));
  assert.deepEqual(area.qloo.drinks.map((d) => d.name), ["Pendleton Whisky", "Coors Banquet"]);
  assert.equal(area.qloo.ages, null);
  const none = await enrichQloo({ get: async () => { throw invalid(); }, door: { id: "P2", name: "Nowhere" } });
  assert.equal(none.qloo.basis, "none");
  assert.equal(none.qloo.calls, 1);
  assert.ok(isInvalidSignal(invalid()) && !isInvalidSignal(Object.assign(new Error("Qloo 429"), { status: 429 })));
  // a 5xx on the first call is the caller's to handle (the Worker answers 502)
  await assert.rejects(enrichQloo({ get: async () => { throw Object.assign(new Error("Qloo 503"), { status: 503 }); }, door: { id: "X" } }), /503/);
  // a failed side call is noted, the rest of the record stands
  const partial = await enrichQloo({ get: async (p) => { if (p["filter.type"] === "urn:tag") throw Object.assign(new Error("Qloo 400 on tags"), { status: 400 }); return p["filter.type"] === "urn:demographics" ? DEMO : BRANDS; }, door: { id: "D1" } });
  assert.equal(partial.qloo.basis, "door");
  assert.deepEqual(partial.qloo.tags.music, []);
  assert.match(partial.errors[0], /^tags: /);
});

// a fake web: url → {status, body, type}
const web = (pages) => {
  const hits = [];
  const f = async (url) => {
    hits.push(url);
    const p = pages[url.replace(/\/$/, "")] ?? pages[url];
    if (!p) return new Response("not here", { status: 404, headers: { "content-type": "text/html" } });
    return new Response(p.body ?? p, { status: p.status ?? 200, headers: { "content-type": p.type ?? "text/html; charset=utf-8" } });
  };
  f.hits = hits;
  return f;
};
const long = (s) => `<html><body><p>${s}</p><p>${"Menu line. ".repeat(40)}</p></body></html>`;

test("fetchSite: robots.txt honoured, a host waits between requests, the menu page and menu-like links follow, third-party hosts and thin pages are skipped", async () => {
  const pages = {
    "https://bar.example/robots.txt": "User-agent: *\nDisallow: /secret\n",
    "https://bar.example": long(`Welcome to The Bar <a href="/drinks">Drinks</a> <a href="/secret">Secret</a> <a href="https://www.untappd.com/v/bar">Untappd</a>`),
    "https://bar.example/drinks": long("Twenty taps of Texas beer"),
    "https://order.bar.example": long("Online menu"),
    "https://order.bar.example/robots.txt": "User-agent: *\nDisallow: /\n",
  };
  const fetchImpl = web(pages);
  const waits = [];
  const fetcher = makeSiteFetcher({ fetchImpl, gapMs: 1000, sleep: async (ms) => void waits.push(ms), now: (() => { let t = 0; return () => (t += 10); })() });
  const got = await fetchSite({ website: "https://bar.example/", menu: "https://order.bar.example/", fetcher });
  assert.deepEqual(got.pages.map((p) => p.url), ["https://bar.example/", "https://bar.example/drinks"]); // the menu host's robots said no; /secret is disallowed and not menu-like anyway
  assert.ok(got.pages[1].text.includes("Twenty taps"));
  assert.ok(fetchImpl.hits.includes("https://bar.example/robots.txt") && fetchImpl.hits.includes("https://order.bar.example/robots.txt"));
  assert.ok(!fetchImpl.hits.some((u) => /untappd|secret/.test(u)));
  assert.ok(!fetchImpl.hits.includes("https://order.bar.example/"));
  assert.ok(waits.length >= 2 && waits.every((w) => w > 0)); // the same host waited between its requests
  const thin = await fetchSite({ website: "https://thin.example/", fetcher: makeSiteFetcher({ fetchImpl: web({ "https://thin.example": "<html><body>Hi</body></html>" }), gapMs: 0 }) });
  assert.equal(thin.reason, "thin");
  const gone = await fetchSite({ website: "https://gone.example/", fetcher: makeSiteFetcher({ fetchImpl: web({}), gapMs: 0 }) });
  assert.equal(gone.reason, "http 404");
  const none = await fetchSite({ website: null, fetcher });
  assert.equal(none.reason, "no website");
  const skipped = await fetchSite({ website: "https://www.yelp.com/biz/bar", fetcher });
  assert.equal(skipped.reason, "skipped host");
});

test("extractSite: the model's facts are checked against the pages; the quote's page becomes `from`", async () => {
  const pages = [{ url: "https://bar.example/", text: "The Bar. Live music every Friday night." }, { url: "https://bar.example/drinks", text: "Twenty taps of Texas beer. Athletic Brewing Run Wild IPA (non-alcoholic)." }];
  const make = () => ({ step: async () => ({ text: JSON.stringify({ facts: [
    { k: "taps", text: "Twenty taps of Texas beer.", quote: "Twenty taps of Texas beer", from: "https://bar.example/drinks" },
    { k: "non_alcoholic", text: "Pours Athletic Brewing Run Wild IPA.", quote: "Athletic Brewing Run Wild IPA (non-alcoholic)", from: "https://bar.example/" }, // wrong page: corrected
    { k: "events", text: "Live music on Fridays.", quote: "Live music every Friday night", from: "https://bar.example/" },
    { k: "drinks", text: "Forty wines by the glass.", quote: "Forty wines by the glass", from: "https://bar.example/drinks" }, // not on any page: dropped
  ] }) }) });
  const r = await extractSite({ name: "The Bar", pages, make });
  assert.deepEqual(r.facts.map((f) => [f.k, f.from]), [["taps", "https://bar.example/drinks"], ["non_alcoholic", "https://bar.example/drinks"], ["events", "https://bar.example/"]]);
  assert.equal(r.dropped.length, 1);
});

// ---------- POST /api/enrich ----------
const ctx = { waitUntil: (p) => p };
const ASSETS = { fetch: async () => new Response("asset") };
const kvMap = () => {
  const store = new Map();
  return { store, get: async (k, t) => (store.has(k) ? (t === "json" ? JSON.parse(store.get(k)) : store.get(k)) : null), put: async (k, v) => void store.set(k, v) };
};
const fakeQloo = ({ invalidIds = [] } = {}) => {
  const seen = [];
  const f = async (u) => {
    const q = new URL(u).searchParams;
    seen.push(Object.fromEntries(q));
    if (invalidIds.includes(q.get("signal.interests.entities"))) return new Response(JSON.stringify({ errors: [{ message: "All of the provided signal.interests.entities were invalid." }] }), { status: 400, headers: { "content-type": "application/json", "x-month-ratelimit-remaining": "40000" } });
    const body = q.get("filter.type") === "urn:demographics" ? DEMO : q.get("filter.type") === "urn:tag" ? TAGS : BRANDS;
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", "x-month-ratelimit-remaining": "40000" } });
  };
  f.seen = seen;
  return f;
};
let ip = 0;
const post = (env, body, { origin = "https://doors.test", path = "/api/enrich" } = {}) =>
  worker.fetch(new Request(`https://doors.test${path}`, { method: "POST", headers: { "content-type": "application/json", origin, "cf-connecting-ip": `203.0.113.${++ip % 250}` }, body: JSON.stringify(body) }), env, ctx);
const ID = "00000000-0000-4000-8000-000000000101"; // synthetic ids only: the public export forbids Qloo entity ids

test("/api/enrich: the Qloo half for a live door (4 calls, counted), kept a day in KV (the second ask is free); no model key → the site half says so", async () => {
  const QLOO_FETCH = fakeQloo();
  const env = { ASSETS, QLOO_API_KEY: "x", LEDGER_COUNT: async () => 100, DOORS_KV: kvMap(), QLOO_FETCH, TODAY: "2026-10-25T12:00:00Z" };
  const r = await post(env, { id: ID, city: "Austin", cityName: "Austin", name: "Two Step Hall", lat: 30.2, lon: -97.77, website: "https://twostep.example/" });
  assert.equal(r.status, 200);
  const b = await r.json();
  assert.equal(b.calls, COST.enrich);
  assert.equal(b.door.id, ID);
  assert.equal(b.door.qloo.basis, "door");
  assert.equal(b.door.qloo.calls, 4);
  assert.deepEqual(b.door.qloo.drinks.map((d) => d.name), ["Pendleton Whisky", "Coors Banquet"]);
  assert.ok(b.door.vsCity && b.door.vsCity.scope?.cities >= 1 && b.door.vsCity.doors > 0); // qloofull: a live record is compared with the baked baseline (every city Doors has read), and says so
  assert.equal(b.door.site.ok, false);
  assert.match(b.door.site.reason, /no model key/);
  assert.equal(b.door.at, "2026-10-25");
  assert.equal(QLOO_FETCH.seen.length, 4);
  assert.ok([...env.DOORS_KV.store.keys()].some((k) => k.startsWith(`enrich:v1:${ID}:austin:`)));
  const again = await (await post(env, { id: ID, city: "Austin", name: "Two Step Hall", website: "https://twostep.example/" })).json();
  assert.equal(again.calls, 0);
  assert.equal(again.door.qloo.basis, "door");
  assert.equal(QLOO_FETCH.seen.length, 4);
});

test("/api/enrich: a door Qloo refuses as a signal gets its area (basis area); bad input 400; another origin 403; live paused 503", async () => {
  const PIN = "00000000-0000-4000-8000-000000000102"; // not ID: the Worker's Qloo cache is shared across tests
  const QLOO_FETCH = fakeQloo({ invalidIds: [PIN] });
  const env = { ASSETS, QLOO_API_KEY: "x", LEDGER_COUNT: async () => 100, DOORS_KV: kvMap(), QLOO_FETCH };
  const b = await (await post(env, { id: PIN, city: "Austin", name: "Ben White Brewpub", lat: 30.2153808, lon: -97.7423669, want: ["qloo"] })).json();
  assert.equal(b.door.qloo.basis, "area");
  assert.equal(b.calls, 2);
  assert.equal(b.door.site, null);
  assert.equal((await post(env, { id: "nope", city: "Austin" })).status, 400);
  assert.equal((await post(env, { id: ID, city: "Austin" }, { origin: "https://evil.example" })).status, 403);
  const spent = { ...env, DOORS_KV: kvMap(), LEDGER_COUNT: async () => 34000 };
  const r = await post(spent, { id: "11111111-2222-3333-4444-555555555555", city: "Austin", want: ["qloo"] });
  assert.equal(r.status, 503);
  assert.equal((await r.json()).paused, true);
});

test("/api/enrich: with a model key the site half reads the page through the same fetcher rules and charges the day's $", async () => {
  const QLOO_FETCH = fakeQloo();
  const SITE_FETCH = web({ "https://bar.example/robots.txt": "User-agent: *\nAllow: /\n", "https://bar.example": long("Twenty taps of Texas beer. Happy hour 3-6 daily.") });
  const answers = [{ id: "m", type: "message", role: "assistant", stop_reason: "end_turn", usage: { input_tokens: 500, output_tokens: 60 }, content: [{ type: "text", text: JSON.stringify({ facts: [{ k: "taps", text: "Twenty taps of Texas beer.", quote: "Twenty taps of Texas beer", from: "https://bar.example/" }, { k: "happy_hour", text: "Made up.", quote: "two for one wells", from: "https://bar.example/" }] }) }] }];
  const ANTHROPIC_FETCH = async () => Response.json(answers.shift());
  const env = { ASSETS, QLOO_API_KEY: "x", ANTHROPIC_API_KEY: "sk-test", ANTHROPIC_FETCH, SITE_FETCH, ENRICH_GAP_MS: 0, LEDGER_COUNT: async () => 100, DOORS_KV: kvMap(), QLOO_FETCH };
  const b = await (await post(env, { id: ID, city: "Austin", name: "The Bar", website: "https://bar.example/" })).json();
  assert.equal(b.door.site.ok, true);
  assert.deepEqual(b.door.site.facts.map((f) => f.k), ["taps"]); // the made-up line's quote isn't on the page
  assert.equal(b.door.site.dropped, 1);
  assert.ok(b.usd > 0);
  assert.ok(SITE_FETCH.hits.includes("https://bar.example/robots.txt"));
});

// ---------- the browser side ----------
test("enrichFor: the baked file first, then this device, then /api/enrich (kept on the device); never throws", async () => {
  _resetEnrichClient();
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v) };
  const baked = { v: 1, city: "austin", doors: { [ID]: { ...emptyEnrich(ID, "Two Step Hall"), at: "2026-10-25" } } };
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(url);
    if (url === "/data/enrich/austin.json") return Response.json(baked);
    if (url === "/data/enrich/boise.json") return new Response("", { status: 404 });
    if (url === "/api/enrich") return Response.json({ door: { ...emptyEnrich(JSON.parse(init.body).id, "Live Door"), at: "2026-10-25", qloo: { basis: "door", brands: [], drinks: [], ages: null, gender: null, tags: {}, calls: 4 } }, calls: 4 });
    throw new Error("unexpected " + url);
  };
  const a = await enrichFor({ venue: { id: ID, name: "Two Step Hall" }, cityKey: "austin", city: "Austin", fetchImpl, storage });
  assert.equal(a.from, "baked");
  assert.equal(a.record.name, "Two Step Hall");
  const live = await enrichFor({ venue: { id: "LIVE-1111-2222-3333-444444444444", name: "Live Door", website: "https://x.example" }, cityKey: "boise", city: "Boise", fetchImpl, storage });
  assert.equal(live.from, "live");
  assert.equal(live.calls, 4);
  const dev = await enrichFor({ venue: { id: "LIVE-1111-2222-3333-444444444444" }, cityKey: "boise", city: "Boise", fetchImpl, storage });
  assert.equal(dev.from, "device");
  assert.equal(calls.filter((u) => u === "/api/enrich").length, 1);
  assert.equal(calls.filter((u) => u === "/data/enrich/austin.json").length, 1); // once per page
  const offline = await enrichFor({ venue: { id: "OFF-1111-2222-3333-444444444444" }, city: "Boise", fetchImpl: async () => { throw new Error("offline"); }, storage });
  assert.equal(offline.from, "none");
  assert.match(offline.error, /online/);
  const noLive = await enrichFor({ venue: { id: "OFF-1111-2222-3333-444444444444" }, city: "Boise", fetchImpl, storage, live: false });
  assert.deepEqual(noLive, { record: null, from: "none" });
});
