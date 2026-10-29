// Live runs (owner review 6): a plan for a brand Doors holds no list for, or in a city it holds no files for. The
// Worker's /api/route agent asks Qloo (about 26 calls a drinker, cached server-side by drinker × city) and streams its
// steps, then the same route file and city file the precompute writes. The client keeps them and feeds them in where
// the fetched files go (/data/routes/<drinker>-<city>.json, /data/cities/<city>.json), so the plan, Your list, Why,
// the stops and saved plans work as for a fetched plan. No DOM; the Worker imports the cache key from here.
import { normCity, citySlug, poursOf, poursPhrase, listWords } from "./profile.js";
import { withoutStarts } from "./week.js";

export { normCity, citySlug };

// The cache key of one run, server and client alike: what Qloo is asked (the drinker's kind and id, or its name before
// it is resolved, or three proxies with their weights in any order; the NA flag) and where (the city however it is
// typed). The agent's day is fixed, so no day (review6). N3: a "pour" run (rooms that pour you, and any brands) keys by
// its items like a proxy.
export function liveCacheKey({ kind = "brand", id = "", name = "", items = null, city = "", na = false }) {
  const who = kind === "proxy" || kind === "pour" ? (items ?? []).map((x) => `${String(x.id).toLowerCase()}*${Number(x.weight) || 1}`).sort().join("+") : id ? String(id).toLowerCase() : `name:${normCity(name)}`;
  return `${kind}|${who}|${normCity(city)}|${na ? "na" : "-"}`;
}

// The profile's city: a ready one from the index (a live run's city once primed), else the live city the profile names
// ({key, name, query, center: the form's lookup or null, live: true}).
export function cityOf(profile, index) {
  const c = index?.cities?.find((x) => x.key === profile?.city);
  if (c) return c;
  if (!profile?.cityLive) return null;
  return { key: profile.city, name: profile.cityName, query: profile.cityName, center: profile.cityCenter ?? null, live: true };
}
// A plan is live when a drink is a brand found live, or the city is one Doors holds no files for.
const readyCity = (profile, index) => !profile.cityLive && Boolean(index?.cities?.some((c) => c.key === profile.city && !c.live));
export const isLiveProfile = (profile, index) => liveDrinkers(profile, index).some((d) => d.live);

// The drinkers a profile asks for, each with the file key its route goes under: {kind, id, name, na, key, live}. In a
// ready city a fetched brand (or preset room) keeps its file; in a live city it runs live by its Qloo id.
export function liveDrinkers(profile, index) {
  const ready = readyCity(profile, index);
  // N3: rooms that already pour you. One preset room alone (Parson's: the Examples) keeps its fetched files in a ready
  // city; any other set is one live "pour" run, the rooms and the brands mixed as Qloo signals (PROBES: they blend).
  const pours = poursOf(profile, index.rooms);
  if (pours.length) {
    const preset = !(profile.drinks ?? []).length && pours.length === 1 ? index.rooms.find((x) => x.id && String(x.id).toLowerCase() === String(pours[0].id).toLowerCase()) : null;
    if (preset) return [{ kind: "room", id: preset.id, name: preset.name, na: false, key: preset.key, live: !ready }];
    const brands = (profile.drinks ?? []).map((d) => {
      const b = d.ready ? index.brands.find((x) => x.key === d.key) : null;
      return { id: d.ready ? b?.id ?? "" : d.id, name: d.name, na: Boolean(b?.na) };
    }).filter((b) => b.id);
    const items = [...pours.map((r) => ({ id: r.id, name: r.name, weight: 1, type: "place" })), ...brands.map((b) => ({ id: b.id, name: b.name, weight: 1, type: "brand" }))];
    const tag = items.map((x) => String(x.id).toLowerCase().replace(/[^0-9a-f]/g, "").slice(0, 4)).sort().join("");
    return [{ kind: "pour", id: "", name: pourWho(items), items, na: brands.some((b) => b.na), key: `pour-${tag}`, live: true }];
  }
  return (profile.drinks ?? []).map((d) => {
    if (d.ready) {
      const b = index.brands.find((x) => x.key === d.key);
      return { kind: "brand", id: b?.id ?? "", name: d.name, na: Boolean(b?.na), key: d.key, live: !ready, ...(d.ref ? { ref: d.ref } : {}) };
    }
    return { kind: "brand", id: d.id, name: d.name, na: false, key: `q-${citySlug(d.name)}-${String(d.id).toLowerCase().replace(/[^0-9a-f]/g, "").slice(0, 6)}`, live: true, ...(d.ref ? { ref: d.ref } : {}) };
  });
}
// A pour run's drinker in words: "regulars like those at Parson's Chicken & Fish", "LaCroix drinkers and regulars like
// those at Parson's Chicken & Fish and Kite String". Shared with the Worker (its route's drinker.who).
export function pourWho(items) {
  const rooms = (items ?? []).filter((x) => x.type === "place");
  const brands = (items ?? []).filter((x) => x.type !== "place").map((x) => x.name);
  return brands.length ? `${listWords(brands)} drinkers and ${poursPhrase(rooms)}` : poursPhrase(rooms);
}

// The route files a profile reads, by name (fetched or primed): what ui/data.js loadRoutes fetches.
// Every route file Doors holds for a city: the baked brands' and any live run's once primed (primeLive puts a run in
// index.files as <drinker>-<city>). Round 5 #2a (Jard 10-27, Cincinnati: "0 doors Qloo describes", every cloud "no
// group stands out"): the crowd base read the baked brands alone, and a live city has none, so its own run (162 of
// 164 doors with Qloo's crowd text) was never counted. The base is every door Doors holds for the city, live or baked.
export const cityRouteFiles = (index, cityKey) => (cityKey ? (index?.files ?? []).filter((f) => f.endsWith(`-${cityKey}`)) : []);

export function routeFiles(profile, index) {
  const c = cityOf(profile, index);
  if (!c) return [];
  return liveDrinkers(profile, index).map((d) => `${d.key}-${c.key}`).filter((f) => index.files.includes(f));
}

// What to try when a run fails, by what Qloo said.
export function liveError(message, suggest = null) {
  let m = String(message ?? "");
  // live check H: never an API's JSON on screen
  if (/\{\s*"errors?"/.test(m)) m = "Qloo refused this request.";
  const typo = /doesn't know a city called "([^"]+)"/i.exec(m);
  const near = typo && suggest ? suggest(typo[1]) : null;
  const hint = typo ? `${near ? `Did you mean ${near}? ` : ""}Check the spelling, or pick the city from the list as you type.` : /as the state of/i.test(m) ? "Type the city itself, then build again." : /^Qloo read "/.test(m) ? "Change the city with Edit this city, then build again. Nothing was counted against your runs." : /no bars or restaurants/i.test(m) ? "Try the city's full name with its state (\"Denver, CO\"), or a bigger city nearby."
    : /runs on sample data/i.test(m) ? "Pick Boise, ID as the opening city to try Doors on this server."
    : /no (brand|venue) called/i.test(m) ? "Check the brand's spelling, or add another brand your drinkers drink."
    : /paused|budget|quota/i.test(m) ? "Plans for the brands and cities Doors already holds still work."
    : /easy there|limit/i.test(m) ? "Wait a few minutes and build again."
    : "Build again in a moment; if it keeps failing, try another brand or city.";
  const e = new Error(m || "The live run failed.");
  e.hint = hint;
  return e;
}

// Fix 8: a request Doors never answered (offline, the Worker or its host down, a timeout, a 5xx with no word from the
// Worker, a stream cut off) is not Qloo's verdict and not an empty pool: the page says so and offers Try again. The
// Worker's own refusals (a JSON error: paused, resting, Qloo didn't answer) keep their words.
export const UNREACHABLE = {
  title: "Couldn't reach Doors",
  text: "Doors didn't answer, so there's no list of doors to plan with yet. That's the connection or Doors' server, not your profile.",
  hint: "Check you're online, then try again.",
};
export function unreachable(cause) {
  if (cause?.offline) return cause;
  return Object.assign(new Error(UNREACHABLE.text), { hint: UNREACHABLE.hint, title: UNREACHABLE.title, offline: true, cause });
}

// Read an NDJSON stream, one event per line, as it arrives.
export async function readEvents(response, onEvent) {
  const reader = response.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    buf += done ? dec.decode() : dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (line) onEvent(JSON.parse(line));
    }
    if (done) break;
  }
  if (buf.trim()) onEvent(JSON.parse(buf));
}

// Several city files for one city (the fetched one and each drinker's live run) as one: later files win per room.
export function mergeCityFiles(files) {
  const fs = files.filter(Boolean);
  if (fs.length <= 1) return fs[0] ?? null;
  const out = { ...fs[0] };
  for (const k of ["sisters", "sisterVenues", "sounds", "nbhdSounds", "pitches"]) out[k] = Object.assign({}, ...fs.map((f) => f[k] ?? {}));
  const seen = new Set();
  out.citySound = fs.flatMap((f) => f.citySound ?? []).filter((a) => a?.name && !seen.has(a.name) && seen.add(a.name));
  out.live = fs.some((f) => f.live);
  return out;
}

// Live check: a failure building again can't fix (what Qloo says about the city or the brand) is kept with the run's key
// for a day, so reloading the page doesn't spend another Qloo call on it. Busy, resting and network errors aren't kept.
const SETTLED = /doesn't know a city called|as the state of|^Qloo read "|no (brand|venue) called|returned no bars or restaurants|Qloo refused this request/i;
const SETTLED_MS = 24 * 3600 * 1000;
// fix5-res: a run Qloo didn't fully answer (route.gaps, src/worker.js runRoute) is kept on this device for a day, as the
// Worker keeps it: then it is asked again, so the gaps can fill in. A run without gaps is kept for good.
const GAPS_MS = 24 * 3600 * 1000;
// The plan view's line (and the phone's): what Qloo didn't answer, over every drinker's route; null without gaps.
export function gapsNote(routes) {
  const gaps = [...new Set((routes ?? []).flatMap((r) => r?.route?.gaps ?? r?.gaps ?? []))];
  return gaps.length ? `Qloo didn't answer for: ${gaps.join(", ")}. Run it again tomorrow to fill them in.` : null;
}

// Run the live drinkers of a profile: one /api/route request each (or the client's own store, keyed as the server's
// cache), its steps to onStep({drinker, id, label, detail}). → {routes:[{key, route}], cities:[cityFile], city: the
// city entry ({key, name, query, center, live})}. Throws liveError(…) with .hint.
export async function runLive({ profile, index, fetchImpl = fetch, onStep = () => {}, cache = null }) {
  const c = cityOf(profile, index);
  const query = c?.live ? profile.cityName : c?.query ?? c?.name;
  const routes = [];
  const cities = [];
  for (const d of liveDrinkers(profile, index).filter((x) => x.live)) {
    const key = liveCacheKey({ kind: d.kind, id: d.id, name: d.name, items: d.items ?? null, city: query, na: d.na });
    let got = cache?.get(key) ?? null;
    // a run that failed for good (the city, the brand): said again from this device, no new Qloo call on a reload
    if (got?.failed) {
      if (Date.now() - (got.failed.at ?? 0) < SETTLED_MS) throw Object.assign(liveError(got.failed.message), { cached: true });
      got = null;
    }
    if (got?.route?.gaps?.length && Date.now() - (got.at ?? 0) >= GAPS_MS) got = null;
    if (!got) {
      // a saved run picked from the list carries its ref: the Worker serves that run (free) whatever the city is called
      const body = d.kind === "pour" ? { kind: "pour", items: d.items, city: query, na: d.na } : { kind: d.kind, id: d.id, name: d.name, city: query, na: d.na, ...(d.ref ? { ref: d.ref } : {}) };
      let res;
      try {
        res = await fetchImpl("/api/route", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      } catch (err) {
        throw unreachable(err); // fix 8: no answer at all (offline, a timeout)
      }
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        // fix 8: a 5xx with no word from the Worker is its host, not the Worker refusing (a proxy's error page)
        if (res.status >= 500 && !b.error && !b.message) throw unreachable(new Error(`/api/route: ${res.status}`));
        // resting (the budget's end) and the daily cap are not failures: the page falls back to examples and saved runs
        const e = liveError(b.resting || b.daily ? b.message : b.error ?? `The live run failed (${res.status}).`);
        if (b.resting || b.daily) Object.assign(e, { fallback: b.resting ? "resting" : "daily", runs: b.runs ?? [] });
        throw e;
      }
      let route = null;
      let city = null;
      let error = null;
      // fix 8: a stream cut off mid-run is the connection; nothing is kept as a failed run
      await readEvents(res, (e) => {
        if (e.type === "step") onStep({ drinker: d.name, id: e.id, label: e.label, detail: e.detail, calls: e.calls ?? null });
        else if (e.type === "route") (route = e.route), (city = e.city);
        else if (e.type === "pitches" && city) city = { ...city, pitches: { ...city.pitches, ...e.pitches } };
        else if (e.type === "error") error = e.error;
      }).catch((err) => {
        throw unreachable(err);
      });
      const settled = (message) => {
        if (SETTLED.test(message)) cache?.put(key, { failed: { message, at: Date.now() } });
        return liveError(message);
      };
      if (error || !route) throw settled(error ?? "The live run ended without a list of doors.");
      if (!route.lists?.all?.length) throw settled(`Qloo returned no bars or restaurants for this drinker in "${query}".`);
      got = { route, city, at: Date.now() };
      cache?.put(key, got);
    }
    routes.push({ key: d.key, route: got.route });
    cities.push(got.city);
  }
  // a live city is Qloo's resolved locality (its name and centre), under the profile's key
  const r0 = routes[0]?.route;
  const city = c?.live ? { key: c.key, name: placeName(r0?.city?.name, query) ?? c.name, query, center: r0?.city?.center ?? c.center ?? (profile.start ? [profile.start.lat, profile.start.lon] : null), live: true } : c;
  return { routes, cities, city };
}

// Live check C: Qloo may resolve a typed city to its county ("Milwaukee, WI" → "Milwaukee County"); the page says the
// city the rep typed ("Saturday in Milwaukee"), not the county. Any other reading is Qloo's name as it is.
export function placeName(qlooName, typed) {
  if (!qlooName) return null;
  const mine = String(typed ?? "").split(",")[0].trim();
  const county = /^(.+?)\s+(County|Parish|Borough)$/i.exec(qlooName);
  return county && mine && normCity(county[1]) === normCity(mine) ? mine.replace(/^\p{Ll}/u, (ch) => ch.toUpperCase()) : qlooName;
}

// Put a run's files where the fetched ones go: cache (url → Promise of JSON, ui/data.js getJSON's), the index's files
// and cities. In a ready city the live city file is merged over the fetched one (fetched(url) reads it).
export async function primeLive({ index, cache, fetched }, { routes, cities, city }) {
  if (!index.cities.some((x) => x.key === city.key)) index.cities.push(city);
  else if (city.live) Object.assign(index.cities.find((x) => x.key === city.key), city);
  for (const { key, route } of routes) {
    const f = `${key}-${city.key}`;
    cache.set(`/data/routes/${f}.json`, Promise.resolve(route));
    if (!index.files.includes(f)) index.files.push(f);
  }
  const url = `/data/cities/${city.key}.json`;
  const own = city.live ? null : await fetched(url).catch(() => null);
  const merged = mergeCityFiles([own, ...cities]);
  if (merged) cache.set(url, Promise.resolve(city.live ? { ...merged, city: city.key, name: city.name } : merged));
}

// A saved run (from /api/runs, offered when new runs rest) as the profile's drinker and city: a fetched brand by its key,
// any other as found live; a held city by its key, any other as a live city. The start (and doors already known) stay
// only when the city is the same.
// review6: a run carries Qloo's name for its city (cityName), never what a visitor typed; the Worker keeps the run under
// that name too, so picking it is a saved run, free.
export function profileForRun(profile, run, index) {
  const brand = index.brands.find((b) => b.id === run.id);
  const held = index.cities.find((c) => !c.live && (normCity(c.name) === normCity(run.cityName) || normCity(c.query ?? "") === normCity(run.cityName)));
  const city = held ? { city: held.key } : { city: citySlug(run.cityName), cityName: run.cityName, cityLive: true };
  const same = city.city === profile.city;
  const ref = run.ref ? { ref: run.ref } : {};
  const out = { ...profile, venue: null, pours: [], drinks: [brand ? { key: brand.key, name: brand.name, ready: true, ...ref } : { id: run.id, name: run.name, ready: false, where: "", ...ref }], ...city };
  if (held) for (const k of ["cityName", "cityLive", "cityCenter"]) delete out[k];
  if (same) {
    if (!held) Object.assign(out, { cityName: profile.cityName ?? out.cityName, ...(profile.cityCenter ? { cityCenter: profile.cityCenter } : {}) });
  } else Object.assign(out, { start: null, known: [], windows: (profile.windows ?? []).map(({ start, ...w }) => w), ...(profile.week ? { week: withoutStarts(profile.week) } : {}) });
  return out;
}
