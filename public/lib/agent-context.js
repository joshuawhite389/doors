// The context the chat agent reads (docs/CONTRACTS-R9.md §1.2), built by code from the published plan (ui/state.js
// shape) and the city file: never from the conversation. The day's stops first, then the best of the rest of the plan,
// at most 40 doors. Pure: the web chat, drive mode, the guided demo and the RN app build it the same way.
import { stopModel } from "./stopmodel.js";
import { rawHoursText, parseHours, formatDayHours, genreLabel, DAYS } from "./core.js";
import { envelope } from "./slots.js";
import { notesForAgent } from "./door-notes.js";
import { placeFate, gateLine, whereOn } from "./sieve.js";
import { placePicture } from "./place.js";
import { productLine, drinkersLine } from "./profile.js";
import { enrichFacts } from "./enrich.js";
import { deepLines } from "./deep.js"; // round 3, lane deep: the door's ranked insight facts (the gap, the neighbours, the owner's week)

export const CONTEXT_DOORS = 40;
const pad = (n) => String(n).padStart(2, "0");
const hhmm = (min) => (Number.isFinite(min) ? `${pad(Math.floor(min / 60) % 24)}:${pad(Math.round(min) % 60)}` : "");
const lineText = (x) => (typeof x === "string" ? x : x?.text ?? x?.reply ?? "");

// plan: the published plan; dayIndex: the selected day (an index into plan.days); current: the open / drive-mode door;
// city: the city file (sounds, sisters, pitches); routes: the drinker routes (affinity rows); talk: {id: edited talk};
// envelopes: {id: CULTURAL-SLOTS envelope}; now: a Date.
// The rep's name (signs the notes) and every contact's (outcomes' who, contact slots, contacts): the Worker redacts them
// before any model call (Q2). Drive mode's Log visit sends the same list (privacy audit 10-24 blocker 1).
export function planNames(plan) {
  return [...new Set([plan?.profile?.pitch?.name, ...Object.values(plan?.outcomes ?? {}).map((o) => o?.who), ...Object.values(plan?.slots ?? {}).flat().filter((r) => r?.field === "contact").map((r) => r.value?.name ?? r.value), ...(plan?.contacts ?? []).map((x) => x?.contactName)].filter((x) => typeof x === "string" && x.trim().length >= 2))];
}
// judge pass 9 #5: the day that holds a door (a door asked about on another day than the one on screen: "why isn't X
// first?" at 390 px got the selected day, without X, so the answer had no order fact and said the app gave no reason)
// Group 3 #7 (Jard 10-24): the door's place picture (lib/place.js, the same facts "Why this door" shows) for the Agent's
// briefing, compact ({when: "…", room: "…"}; the Worker adds the labels): the context was already 55 KB of the Worker's
// 64 KB. "Who goes" is the crowd line the door already carries; the age row stays out (the Agent never describes people
// by age).
export const AGENT_PLACE_ROWS = ["when", "room", "pours", "into", "music", "sisters"];
export function placeForAgent(pic) {
  return Object.fromEntries((pic?.rows ?? []).filter((r) => AGENT_PLACE_ROWS.includes(r.key)).map((r) => [r.key, String(r.text).slice(0, 160)]));
}
// ---- Round 3, agent2 (Jard 10-25: "the doors agent feels not smart"; ROUND3-SPEC §3): the Agent reads every Qloo
// fact Doors holds on a door, not ten tag lines. aboutForAgent: what the place record carries beyond the picture
// (Qloo's description, its menu highlights, live music, rating, neighbourhood, its own site's host). The Worker
// (src/agent.js cleanDoor) cuts each field; promptOf shows them as about_the_place lines on every door.
const hostOf = (url) => { try { return new URL(String(url)).host.replace(/^www\./, ""); } catch { return null; } };
export function aboutForAgent(v) {
  if (!v) return {};
  const menu = Array.isArray(v.tags?.menu) ? v.tags.menu.filter((x) => typeof x === "string" && x.trim()).slice(0, 6) : [];
  const out = {
    ...(genreLabel(v) ? { kind: genreLabel(v) } : {}),
    ...(v.description ? { description: String(v.description).slice(0, 300) } : {}),
    ...(menu.length ? { menu } : {}),
    ...(v.liveMusic === true ? { liveMusic: true } : {}),
    ...(Number.isFinite(v.rating) ? { rating: Math.round(v.rating * 10) / 10 } : {}),
    ...(v.neighborhood ? { neighborhood: String(v.neighborhood).slice(0, 60) } : {}),
    ...(hostOf(v.website) ? { site: hostOf(v.website) } : {}),
  };
  return out;
}
// The enrich lane's per-door insight record (ROUND3-SPEC lane "enrich": the door as a Qloo signal → the drink brands
// and crowd groups it over-indexes on vs the city, plus facts from its own public site with the URL and date). Its
// shape is read loosely so the record can grow: `lines` (strings) pass through; `brands` [{name, lift}], `crowd` /
// `groups` [{group|name, lift, share}] and `site` {url, captured, facts[]} become one line each; any other key whose
// value is a list of strings becomes a line labelled by the key. → {lines, site: {url, captured}} | null.
const liftOf = (x) => (Number.isFinite(x?.lift) ? `${(Math.round(x.lift * 10) / 10).toFixed(1)}× the city` : null);
export function insightForAgent(rec, cityName = "the city") {
  if (!rec || typeof rec !== "object") return null;
  const lines = [];
  // the page's shape (ui/stop.js loadStopData, talk2's loader): enrichFacts' list itself, [{label, text, src, prep?, from?}]
  if (Array.isArray(rec)) {
    const facts = rec.filter((f) => f && typeof f === "object" && typeof f.text === "string" && f.text.trim());
    for (const f of facts) lines.push(`${f.label ? `${f.label}${f.prep ? " (for your eyes, not the room)" : ""}: ` : ""}${f.text}`);
    const from = facts.find((f) => f.src === "site" && typeof f.from === "string" && /^https?:\/\//.test(f.from))?.from ?? null;
    return lines.length ? { lines: lines.slice(0, 14), ...(from ? { site: { url: from.slice(0, 300), captured: null } } : {}) } : null;
  }
  const strs = (xs) => (Array.isArray(xs) ? xs.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim().slice(0, 240)) : []);
  lines.push(...strs(rec.lines));
  const named = (xs, key) => (Array.isArray(xs) ? xs.filter((x) => x && typeof x === "object" && (x[key] ?? x.name)).map((x) => `${x[key] ?? x.name}${[liftOf(x), Number.isFinite(x.share) ? `${Math.round(x.share * 100)}% of ${cityName}` : null].filter(Boolean).length ? ` (${[liftOf(x), Number.isFinite(x.share) ? `${Math.round(x.share * 100)}% of ${cityName}` : null].filter(Boolean).join(", ")})` : ""}`) : []);
  const brands = named(rec.brands, "name").slice(0, 8);
  if (brands.length) lines.push(`Drink brands this door's crowd over-indexes on, vs ${cityName} (Qloo): ${brands.join(", ")}`);
  const groups = named(rec.crowd ?? rec.groups, "group").slice(0, 8);
  if (groups.length) lines.push(`Its crowd against ${cityName} (Qloo): ${groups.join(", ")}`);
  let site = null;
  if (rec.site && typeof rec.site === "object") {
    const facts = strs(rec.site.facts).slice(0, 8);
    const host = hostOf(rec.site.url);
    if (facts.length) lines.push(`Its own site${host ? ` (${host}` : ""}${rec.site.captured ? `${host ? ", " : " ("}read ${rec.site.captured}` : ""}${host || rec.site.captured ? ")" : ""}: ${facts.join(" ")}`);
    if (rec.site.url) site = { url: String(rec.site.url).slice(0, 300), captured: rec.site.captured ?? null };
  }
  for (const [k, v] of Object.entries(rec)) if (!["lines", "brands", "crowd", "groups", "site", "qloo", "vsCity", "v", "id", "name", "at"].includes(k) && Array.isArray(v) && v.every((x) => typeof x === "string") && v.length) lines.push(`${k[0].toUpperCase()}${k.slice(1).replace(/[_-]/g, " ")}: ${strs(v).join("; ")}`);
  // the enrich lane's record (public/lib/enrich.js, round 3): Qloo with the door as the signal, judged against the
  // city's other doors (vsCity: lift ≥ 1.5× / rare ≥ 3×), and the door's own site's checked facts: its own renderer
  // (enrichFacts) makes the lines; prep = for the rep's eyes, never said in the room; a site line may be said and cited
  if (rec.qloo || rec.vsCity || rec.site) {
    for (const f of enrichFacts(rec)) lines.push(`${f.label}${f.prep ? " (for your eyes, not the room)" : ""}: ${f.text}`);
    if (rec.site?.url) site = { url: String(rec.site.url).slice(0, 300), captured: rec.site.fetched ?? rec.site.captured ?? null };
    return lines.length ? { lines: lines.slice(0, 14), ...(site ? { site } : {}) } : null;
  }
  const q = rec.qloo && typeof rec.qloo === "object" ? rec.qloo : null;
  const vc = rec.vsCity && typeof rec.vsCity === "object" ? rec.vsCity : null;
  const x = (n) => (Number.isFinite(n) ? `${(Math.round(n * 10) / 10).toFixed(1)}×` : null);
  if (q?.basis === "area") lines.push(`Qloo won't take this door as a signal, so its drink-brand facts are its part of town's (1.2 km), not this door's crowd.`);
  if (vc) {
    const drinks = (vc.drinks ?? []).filter((d) => d?.name).slice(0, 8).map((d) => `${d.name}${d.cat ? ` (${d.cat}${x(d.lift) ? `, ${x(d.lift)} the city` : ""})` : x(d.lift) ? ` (${x(d.lift)} the city)` : ""}`);
    if (drinks.length) lines.push(`Drink brands this door's crowd over-indexes on, rare across ${cityName}'s doors (Qloo, door as the signal): ${drinks.join(", ")}`);
    const cats = (vc.cats ?? []).filter((c) => c?.cat).slice(0, 6).map((c) => `${c.cat}${x(c.lift) ? ` (${x(c.lift)} the city's doors)` : ""}`);
    if (cats.length) lines.push(`Drink categories its crowd leans to, vs ${cityName}'s doors (Qloo): ${cats.join(", ")}`);
    const ages = (vc.ages ?? []).filter((a) => a?.band).slice(0, 3).map((a) => `${AGE_WORD[a.band] ?? a.band}${Number.isFinite(a.diff) ? ` (${a.diff > 0 ? "+" : ""}${Math.round(a.diff * 100)} points vs the city's doors)` : ""}`);
    if (ages.length) lines.push(`Age skew of its crowd, vs ${cityName}'s doors (Qloo; say it as Qloo's, never to the buyer): ${ages.join(", ")}`);
    const tags = vc.tags && typeof vc.tags === "object" ? Object.entries(vc.tags).filter(([, v]) => Array.isArray(v) && v.length).map(([k, v]) => `${k}: ${v.slice(0, 5).join(", ")}`) : [];
    if (tags.length) lines.push(`Taste tags rare across ${cityName}'s doors (Qloo): ${tags.join("; ")}`);
    const brands = (vc.brands ?? []).filter((b) => b?.name).slice(0, 6).map((b) => b.name);
    if (brands.length) lines.push(`Other brands its crowd over-indexes on (Qloo; for your eyes, not the room): ${brands.join(", ")}`);
  } else if (q?.drinks?.length) lines.push(`Drink brands its crowd over-indexes on (Qloo${q.basis === "area" ? ", its part of town" : ", door as the signal"}): ${q.drinks.filter((d) => d?.name).slice(0, 8).map((d) => `${d.name}${d.cat ? ` (${d.cat})` : ""}`).join(", ")}`);
  if (q?.tags && !vc) { const music = (q.tags.music ?? []).slice(0, 4); if (music.length) lines.push(`Its crowd's music (Qloo): ${music.join(", ")}`); }
  if (rec.site && typeof rec.site === "object" && Array.isArray(rec.site.facts)) {
    const facts = rec.site.facts.filter((f) => f && typeof f === "object" && typeof f.text === "string" && f.text.trim()).slice(0, 8);
    const host = hostOf(rec.site.url);
    if (facts.length) lines.push(`Its own site${host ? ` (${host}` : ""}${rec.site.fetched ? `${host ? ", " : " ("}read ${rec.site.fetched}` : ""}${host || rec.site.fetched ? ")" : ""}: ${facts.map((f) => `${SITE_WORD[f.k] ?? ""}${SITE_WORD[f.k] ? ": " : ""}${f.text.trim().slice(0, 200)}`).join(" | ")}`);
    if (rec.site.url && !site) site = { url: String(rec.site.url).slice(0, 300), captured: rec.site.fetched ?? rec.site.captured ?? null };
  }
  return lines.length ? { lines: lines.slice(0, 12), ...(site ? { site } : {}) } : null;
}
const AGE_WORD = { "24_and_younger": "under 25", "25_to_29": "25–29", "30_to_34": "30–34", "35_to_44": "35–44", "45_to_54": "45–54", "55_and_older": "55 and over" };
const SITE_WORD = { what: "What it is", brews_own: "Brews its own", taps: "Taps", house_drinks: "House drinks", non_alcoholic: "Non-alcoholic", drinks: "Drinks", happy_hour: "Happy hour", events: "Events", food: "Food", space: "The space", other: "" };
// hours by day in words ("Mon 11 am–10 pm; Tue closed; …"), or the raw text when Qloo's hours can't be parsed: the raw
// JSON cut at 300 characters lost most days (eval after-v1 #1 read a Friday close as Tuesday's)
export function hoursWords(hours) {
  const raw = typeof hours === "string" && /^\s*\{/.test(hours) ? (() => { try { return JSON.parse(hours); } catch { return null; } })() : hours;
  const p = parseHours(raw);
  if (!p.ok) return typeof hours === "string" && hours && hours !== "no hours listed" && !/^\s*\{/.test(hours) ? hours.slice(0, 300) : null;
  const out = DAYS.map((d) => { const t = formatDayHours(p, d); return t ? `${d.slice(0, 3).replace(/^\w/, (c) => c.toUpperCase())} ${t}` : null; }).filter(Boolean);
  return out.length ? out.join("; ") : null;
}
// where a door's insight record lives: on the venue, or in the city file keyed by id (the enrich lane bakes both)
// (the enrich lane bakes public/data/enrich/<city>.json {doors: {id: record}}; the page merges it as city.enrich)
// The page (ui/stop.js loadStopData, talk2's loader) passes `enrich` = {id: enrichFacts(record)}: that wins; a record on
// the venue or in the city file (tests, other callers) is rendered the same way.
export const insightOf = (v, city, id, enrich = null) => enrich?.[id] ?? v?.insight ?? v?.enrich ?? city?.insights?.[id] ?? city?.enrich?.[id] ?? city?.enrich?.doors?.[id] ?? null;
// Group 3 #4 (lane B): the product and the user's drinkers as one line each (lib/profile.js). The drinkers' age band
// stays out: it narrows Qloo's ranking, but the Agent never describes people by age (its sentence would be dropped).
export const productForAgent = (profile) => productLine(profile);
// The user's own words; whether they know it or it is their best guess is said for the model ("I" would read as the model).
export const drinkersForAgent = (profile) => drinkersLine({ ...profile, drinkers: { ...(profile?.drinkers ?? {}), age: "" } }).replace(/ \(what I know\)$/, " (the user knows this)").replace(/ \(my best guess\)$/, " (the user's best guess or research)");

export const dayHolding = (plan, id) => (plan?.days ?? []).findIndex((d) => d && !d.past && d.stops?.some((s) => s.id === id));

// Round 3, lane deep: deepFacts = {doorId: lib/deep.js deepFacts(record, ctx)} (ui/stop.js loadStopData computes them from the
// enrich records; the talk bake does the same). They lead the door's insight lines, each as the evidence and then its
// "So what:" line (the Worker's cleanInsight keeps 12 lines of 240 chars: deepForAgent cuts to fit), so the Agent answers
// across the same layers the talking points read: the gap, the neighbours, the owner's week, the room's occasion.
const cutAt = (t, n) => (String(t).length <= n ? String(t) : `${String(t).slice(0, n - 1).replace(/\s+\S*$/, "")}…`);
export const AGENT_DEEP_FACTS = 3;
export function deepForAgent(facts) {
  const out = [];
  for (const f of deepLines(facts).slice(0, AGENT_DEEP_FACTS)) {
    const full = (facts.find((x) => x.text === f.text) ?? {});
    const why = typeof full.why === "string" && full.why ? full.why : null;
    const evidence = why && f.text.endsWith(why) ? f.text.slice(0, -why.length).trim() : f.text;
    out.push(`Doors' insight${f.prep ? " (for your eyes, not the room)" : ""}: ${cutAt(evidence, 240 - 50)}`);
    if (why) out.push(`So what: ${cutAt(why, 240 - 9)}`);
  }
  return out;
}
export function agentContext({ plan, dayIndex = 0, current = null, city = null, routes = [], facts = [], talk = {}, envelopes: given = {}, now = new Date(), enrich = null, deep = null }) {
  const envelopes = { ...given }; // slots.envelope per full door, unless the caller built them
  const days = plan?.days ?? [];
  const day = Number.isInteger(dayIndex) ? days[dayIndex] ?? null : null;
  const ids = [];
  const add = (id) => id && !ids.includes(id) && plan.venues?.[id] && ids.length < CONTEXT_DOORS && ids.push(id);
  // judge pass 4 (#4): the rep's next door: the first stop from today on with nothing logged yet
  const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const nextDay = days.findIndex((d) => d && !d.past && (!d.date || d.date >= today) && d.stops?.some((s) => !plan.statuses?.[s.id] && !plan.outcomes?.[s.id]?.result));
  const next = nextDay >= 0 ? days[nextDay].stops.find((s) => !plan.statuses?.[s.id] && !plan.outcomes?.[s.id]?.result)?.id ?? null : null;
  add(current);
  add(next);
  (day?.stops ?? []).forEach((s) => add(s.id));
  days.forEach((d) => d?.stops?.forEach((s) => add(s.id)));
  (plan?.pool?.ids ?? []).forEach(add);
  const doors = {};
  const where = whereOn(plan);
  // Whether it is on a day and, if not, the gate that stopped it: the Why view's own words (lib/sieve.js placeFate).
  // A door here came from a day or the ranked pool, so the famous-rooms gate never applies to it.
  const fateOf = (id) => {
    const f = placeFate({ id, plan, profile: plan?.profile, where });
    const g = gateLine(f);
    return g ? { on: f.fate === "plan", fate: f.fate, head: g.head, reason: g.reason } : null;
  };
  // full records for the day's stops and the current door; the rest of the plan light (name, rank, Qloo's crowd line)
  const full = new Set([current, next, ...(day?.stops ?? []).map((x) => x.id)]);
  for (const id of ids) {
    const m = stopModel({ plan, id, dayIndex: day?.stops?.some((s) => s.id === id) ? dayIndex : id === next ? nextDay : null, city, facts, routes, now });
    const v = m.venue;
    const base = { name: v.name, rank: m.rank, N: m.N, status: m.status, outcome: m.outcome, popularity: v.popularity ?? null, affinity: m.record.affinity?.affinity ?? null, crowd: String(v.crowd ?? "").slice(0, 400), captured: m.record.captured ?? null, plan: fateOf(id) };
    const notes = notesForAgent(plan.slots ?? {}, id); // door notes: the rep's and Ask Doors', on every door
    if (notes.length) base.notes = notes;
    // round 3 (agent2): every door carries its place picture, what else Qloo holds on it and the enrich lane's insight
    // record, so an ask about any door on the list is answered from that door's own facts
    const insight0 = insightForAgent(insightOf(v, city, id, enrich), plan?.city?.name);
    const deepL = Array.isArray(deep?.[id]) && deep[id].length ? deepForAgent(deep[id]) : [];
    const deepFrom = deepL.length ? deep[id].find((f) => typeof f.from === "string" && /^https?:\/\//.test(f.from))?.from ?? null : null;
    const insight = deepL.length ? { ...(insight0 ?? {}), lines: [...deepL, ...(insight0?.lines ?? [])].slice(0, 12), ...(insight0?.site ? {} : deepFrom ? { site: { url: deepFrom.slice(0, 300), captured: null } } : {}) } : insight0;
    const rich = { place: placeForAgent(placePicture({ id, venue: v, city, routes, plan })), about: aboutForAgent(v), ...(insight ? { insight } : {}) };
    if (!full.has(id)) {
      doors[id] = { ...base, genre: v.genre ?? "", hours: hoursWords(v.hours) ?? String(rawHoursText(v.hours) ?? "").slice(0, 300), ...rich };
      continue;
    }
    const t = talk[id] ?? m.talk;
    if (!envelopes[id]) envelopes[id] = envelope(m, { slots: plan.slots ?? {}, brandCity: `${plan.profile?.brand ?? ""}-${plan.city?.key ?? ""}`, now: now.getTime() });
    doors[id] = {
      ...base,
      address: v.address ?? "", hours: hoursWords(v.hours) ?? String(rawHoursText(v.hours) ?? "").slice(0, 300), ambience: String(v.ambience ?? "").slice(0, 400), goodFor: (v.goodFor ?? []).slice(0, 8), genre: v.genre ?? "",
      sisters: m.sisters.map((s) => s.id).slice(0, 6),
      sound: city?.sounds?.[id] ? { pass: Boolean(city.sounds[id].guard?.pass) } : null,
      ...rich,
      talk: { opener: t.opener ?? "", ...(t.toBuyer ? { toBuyer: t.toBuyer } : {}), questions: (t.questions ?? []).map(lineText), points: (t.points ?? []).map(lineText), pushback: (t.pushback ?? []).map(lineText), objections: (t.pushback ?? []).map((p) => (typeof p === "object" ? String(p?.objection ?? "") : "")), ask: t.ask ?? "" },
    };
  }
  const firstDrinker = (routes ?? [])[0];
  return {
    today,
    now: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    profile: { brand: plan?.profile?.brand ?? "", what: plan?.profile?.what ?? "", price: plan?.profile?.pitch?.price ?? "", ask: plan?.profile?.pitch?.ask ?? "", product: productForAgent(plan?.profile), drinkers: drinkersForAgent(plan?.profile), signAs: plan?.profile?.pitch?.name ?? "" }, // signAs: a draft's sign-off only, never sent to a model
    city: { key: plan?.city?.key ?? "", name: plan?.city?.name ?? "" },
    windows: days.filter(Boolean).map((d) => ({ date: d.date, from: hhmm(d.from), to: hhmm(d.to) })),
    maxPerDay: Number.isInteger(plan?.profile?.maxPerDay) ? plan.profile.maxPerDay : null, // live check A: the cap as it stands
    // Jard 10-24 web review: every plan day's stops in order, so "the stop after X" is read on X's own day (the model
    // answered "Next is R Bar Arena", the first door from today on, when asked what comes after a later stop)
    days: days.filter((d) => d && !d.past && d.date).map((d) => ({ date: d.date, stops: (d.stops ?? []).filter((x) => doors[x.id]).map((x) => ({ id: x.id, eta: hhmm(x.eta) })) })),
    day: { date: day?.date ?? null, stops: (day?.stops ?? []).map((s) => ({ id: s.id, eta: hhmm(s.eta), locked: Boolean(s.locked), pinned: s.pinned ?? null, legMin: s.legMin ?? null, until: hhmm(s.openUntil), reason: s.orderReason ?? "" })), mi: day?.mi ?? null, min: day?.min ?? null },
    current: current && doors[current] ? current : null,
    nextDoor: next && doors[next] ? next : null, // judge pass 4 (#4): the first door from today on with nothing logged
    // the rep's name (signs the notes) and every contact's: the Worker redacts them before any model call (Q2)
    names: planNames(plan),
    doors,
    // the envelopes, slim: what the agent reads (the visit, the contact, the rep's terms and slots); every door's avoid
    // list (the city's artists, the drinker brands, rule.avoid) goes once, as `avoid`
    // (the drinker brands first: the cap must never cut them)
    avoid: [...new Set([...(plan?.profile?.drinks ?? []).map((x) => x.name), ...Object.values(envelopes).flatMap((e) => e?.constraints?.avoid ?? [])].filter(Boolean))].slice(0, 800),
    envelopes: Object.fromEntries(Object.entries(envelopes).filter(([id]) => doors[id]).map(([id, e]) => [id, slimEnvelope(e)])),
    cityData: {
      citySound: (city?.citySound ?? []).map((a) => a?.name ?? a).filter(Boolean).slice(0, 20),
      nbhd: Object.fromEntries(Object.entries(city?.nbhdSounds ?? {}).slice(0, 8).map(([k, l]) => [k, (l ?? []).map((a) => a?.name ?? a).slice(0, 6)])),
      drinker: String(plan?.pool?.drinker ?? "").replace(/ drinkers$/, "") || firstDrinker?.drinker?.name || "",
      merged: ids.length ? stopModel({ plan, id: ids[0], city }).merged : false,
      filter: ids.length ? stopModel({ plan, id: ids[0], city }).filterLabel : "",
      captured: firstDrinker?.captured ?? null,
    },
  };
}

// What of a CULTURAL-SLOTS envelope the agent reads (the full one stays on the client).
export function slimEnvelope(e) {
  return {
    v: e?.v ?? 1,
    occasion: { visit: e?.occasion?.visit ?? "first", lastVisit: e?.occasion?.lastVisit ?? null, outcome: e?.occasion?.outcome ?? null },
    audience: { contact: e?.audience?.contact ?? null },
    constraints: { terms: e?.constraints?.terms ?? {} },
    slots: (e?.slots ?? []).map(({ field, value, source, at, trace }) => ({ field, value, source, at, trace })),
  };
}

// ---- WHY-VIZ-SPEC §4.5 (round 3, agent2): "Why aren't these on my plan?" ----
// The thread panel builds the ask (lib/whyviz/thread.js threadAsk: the selected door and, per connected door not on the
// plan, its rank, fate, the planner's code and reason, big-name flag, popularity, genre and type, open days, and its fix
// from the table FIX_ROWS, keyed by the planner's code). ui/agent.js sends it as context.whynot; the Worker checks it
// (src/agent.js cleanWhyNot, the fix rebuilt from the table by fixKeyOf below) and the model answers per door with that
// fix word for word (whyNotNet is the net); with no model, agent-rules.js whyNotAnswer composes threadAnswer's text.
export { ASK_QUESTION as WHYNOT_ASK, FIX_ROWS, fixFor, openDays } from "./whyviz/thread.js";
import { FIX_ROWS as ROWS_, fixFor as fixFor_ } from "./whyviz/thread.js";
// the fix table's key for one door of the ask (thread.js sisterStatus's choice, from the ask's own fields): the
// planner's code for a listed door (status when it was marked), famous for a big name, the room type when that type isn't
// pitched, else unranked
export function fixKeyOf(d) {
  if (!d) return "unranked";
  if (d.big) return "famous";
  if (d.rank) return d.fate === "known" ? "status" : d.code || "route";
  if (d.type && !d.pitched && ROWS_.some((r) => r.codes.includes(d.type))) return d.type;
  return d.code && ROWS_.some((r) => r.codes.includes(d.code)) ? d.code : "unranked";
}
// the fix for one door of the ask, from the table alone → {key, act, text} | null (status: none)
export function whyNotFixOf(d, { day = null } = {}) {
  const f = fixFor_(fixKeyOf(d), { open: d?.open ?? [], type: d?.type ?? null, day });
  return f.text ? f : null;
}
// the pick (thread.js threadAnswer's): the best-ranked door off the plan with a fix that has a button
export const whyNotPick = (ask) => (ask?.doors ?? []).filter((d) => d.rank && d.fix?.act).sort((a, b) => a.rank - b.rank)[0] ?? null;
