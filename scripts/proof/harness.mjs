// The proof harness (Cultural Slot Framework §7, owner review 9 R9): runs Doors' real pipeline, the same pure modules
// the page runs (lib/pool.js buildPool → lib/schedule.js planDays → lib/stopmodel.js stopModel: rank, plan, note, talking
// points, ask), on the committed precomputed Qloo files, with each cultural input ("slot") on or withheld. No network,
// no Qloo call, no model call. Group 3 item 3: a stop's questions, points, pushback, line for the buyer and angle are
// the set Claude wrote for that door from Qloo's facts, as in the app: read from data/proof/talk-sets.json (written once
// per set of facts by scripts/proof/talk-fill.mjs, so a re-run judges the same text); a stop with none keeps the
// template and is listed in talkWanted.
// A slot "off" means its input is withheld from the real code, not a flag inside it: what Doors does without that signal.
import { readFileSync } from "node:fs";
import { enrichFacts } from "../../public/lib/enrich.js";
import { deepFactsFor } from "../../public/lib/deep.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildPool, windowsFor } from "../../public/lib/pool.js";
import { planDays } from "../../public/lib/schedule.js";
import { stopModel } from "../../public/lib/stopmodel.js";
import { noteFor } from "../../public/lib/note.js";
import { productKind } from "../../public/lib/talk.js";
import { isNA } from "../../public/lib/profile.js";
import { heatFor } from "../../public/lib/culture.js";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const json = (rel) => JSON.parse(readFileSync(join(ROOT, rel), "utf8"));
const clone = (x) => structuredClone(x);
const memo = new Map();
const cached = (rel) => (memo.has(rel) ? memo.get(rel) : (memo.set(rel, json(rel)), memo.get(rel)));
export const FACTS = () => cached("public/data/facts.json").facts;
// the written talking points the proof judges (group 3 item 3), and the stops still waiting for one: key → talkReq
export const TALK_SETS_FILE = "data/proof/talk-sets.json";
const TALK = (() => { try { return { live: json(TALK_SETS_FILE).sets ?? {} }; } catch { return { live: {} }; } })();
// round 3 (lane enrich): the city's baked enrichment records → each door's extra facts for the talking points
const ENRICH = {};
export const enrichOf = (cityKey) => (ENRICH[cityKey] ??= (() => { try { return Object.fromEntries(Object.entries(json(`public/data/enrich/${cityKey}.json`).doors ?? {}).map(([id, r]) => [id, enrichFacts(r)])); } catch { return {}; } })());
// round 3 (lane deep): the door's ranked insights, from the city's enrichment records and its baked neighbour map
const RECORDS = {}, NEAR = {};
const recordsOf = (cityKey) => (RECORDS[cityKey] ??= (() => { try { return json(`public/data/enrich/${cityKey}.json`).doors ?? {}; } catch { return {}; } })());
const nearOf = (cityKey) => (NEAR[cityKey] ??= (() => { try { return json(`public/data/deep/${cityKey}.json`).near ?? null; } catch { return null; } })());
export const deepOf = (cityKey, { plan, routes, city, profile }, ids = null) => deepFactsFor(recordsOf(cityKey), { plan, routes, city, near: nearOf(cityKey), profile }, ids);
export const talkWanted = new Map();

// The routes a profile reads (as lib/live.js does for a held city): one per drinker brand, or the preset room's.
export function routesFor(profile) {
  if (profile.drinks?.length) return profile.drinks.map((d) => clone(cached(`public/data/routes/${d.key}-${profile.city}.json`)));
  if (profile.pours?.length) return [clone(cached(`public/data/routes/parsons-${profile.city}.json`))];
  return [];
}
export const cityFile = (key) => clone(cached(`public/data/cities/${key}.json`));

// ---------- slots: where a cultural input enters a decision, and how to withhold it ----------
// framework: S1 intake, S2 selection/ranking, S3 expression, S4 memory. source: the authority level of the input.
// off(ctx) mutates {profile, routes, city} (fresh copies). applies(s) = the scenario has this input at all.
const NA_STRIP = /\b(non[- ]?alcoholic|alcohol[- ]free|na|zero[- ]proof)\s*/gi;
export const SLOTS = [
  { key: "drinker", framework: "S2", source: "external (Qloo taste graph)", decision: "which rooms, in what order",
    what: "Qloo's ranking of the city's rooms for the drinker signal (a brand's drinkers, or a room's regulars)",
    off: ({ routes }) => { for (const r of routes) neutralOrder(r); }, applies: () => true,
    offMeans: "the same rooms ordered by Qloo popularity alone (a generic 'popular bars' list)" },
  { key: "rooms", framework: "S2", source: "person-stated (Rooms to pitch)", decision: "which kinds of room are on the list",
    what: "the rep's Rooms to pitch chips (defaults from what they make)",
    off: ({ profile }) => { profile.rooms = ["bars", "breweries", "restaurants", "cafes", "wine"]; }, applies: () => true,
    offMeans: "every kind of room" },
  { key: "kind", framework: "S3", source: "person-stated (What you make)", decision: "format question, the default ask, pushback, facts, the margin line's unit, and (persona MUST #2) whether rooms whose drinks tags are soft drinks only leave the list",
    what: "the product kind read from What you make (beer, spirit, soft…)",
    off: ({ profile }) => { profile.what = isNA(profile.what) ? "Non-alcoholic drink" : "Drink"; }, applies: () => true,
    offMeans: "What you make reads 'Drink' (or 'Non-alcoholic drink'): kind other" },
  { key: "na", framework: "S3", source: "person-stated (What you make)", decision: "NA framing of the opener, questions, pushback, NA facts",
    what: "the non-alcoholic reading of What you make",
    off: ({ profile }) => { profile.what = profile.what.replace(NA_STRIP, "").trim(); }, applies: (s) => isNA(s.profile.what),
    offMeans: "What you make without its non-alcoholic words" },
  { key: "crowd", framework: "S3", source: "external (Qloo room profile)", decision: "the angle: the rep's prep line and the line for the buyer (never said as a crowd description)",
    what: "Qloo's crowd text for each room",
    off: ({ routes, city }) => { for (const r of routes) for (const v of Object.values(r.venues)) delete v.crowd; city.talk = { venues: {} }; }, applies: () => true,
    offMeans: "no crowd text" },
  { key: "venuetype", framework: "S2+S3", source: "external (Qloo genre tag)", decision: "who to ask for, format question, the room kind filter",
    what: "Qloo's genre tag on each room",
    off: ({ routes }) => { for (const r of routes) for (const v of Object.values(r.venues)) delete v.genre; }, applies: () => true,
    offMeans: "no genre: rooms typed from their names only" },
  { key: "sisters", framework: "S3", source: "external (Qloo sister rooms)", decision: "the 'Sister doors' line before the visit",
    what: "Qloo's sister rooms for the top rooms",
    off: ({ city }) => { city.sisters = {}; }, applies: () => true, offMeans: "no sister rooms" },
  { key: "pours", framework: "S4", source: "person-stated (rooms that already pour you)", decision: "the note's 'you'll already find us at' line",
    what: "the rep's own rooms that pour them",
    off: ({ profile }) => { profile.pours = []; }, applies: (s) => Boolean(s.profile.pours?.length), offMeans: "no rooms named (the preset room's list still ranks)" },
  { key: "timing", framework: "S1 (R9 S1t)", source: "default (Doors' rule of thumb by venue type)", decision: "the arrival advice (when to walk in, call first)",
    what: "rush and lull hours by venue type (CULTURAL-SLOTS gap 5)", off: (ctx) => { ctx.slotsOff.push("S1t"); }, applies: () => true,
    offMeans: "one global service clock for every room" },
  { key: "tod", framework: "S2+S1 (R9 deep)", source: "external (Qloo room tag: time-of-day fit)", decision: "which day a door goes on; the arrival line",
    what: "Qloo's per-room crowd times", off: (ctx) => { ctx.deepOff.push("tod"); }, applies: () => true, offMeans: "no crowd times: days by driving and rank, arrival by the clock" },
  { key: "lead", framework: "S3 (R9 deep)", source: "external (Qloo room tags: drinks, menu)", decision: "the opener's question, the ask, a gate question when the room's drinks miss the category",
    what: "Qloo's beverage and menu tags on the room", off: (ctx) => { ctx.deepOff.push("lead"); }, applies: () => true, offMeans: "the kind's template question and ask" },
  { key: "hooks", framework: "S3 (R9 deep)", source: "external (Qloo: brand → TV shows, podcasts, trips)", decision: "the stop's small talk, only where the room's tags meet a brand-specific item",
    what: "what the drinker brand's fans also like", off: (ctx) => { ctx.deepOff.push("hooks"); }, applies: (s) => Boolean(s.profile.drinks?.length), offMeans: "no small talk" },
  { key: "heat", framework: "S2 (R9 deep)", source: "external (Qloo heatmap: the city's neighbourhoods for the brand's fans, rank only)", decision: "which part of town the first day works",
    what: "Qloo's map of where the drinker brand's fans are", off: (ctx) => { ctx.deepOff.push("heat"); }, applies: (s) => Boolean(s.profile.drinks?.length), offMeans: "days by driving and rank alone" },
  { key: "ask", framework: "S3", source: "person-stated (Your ask)", decision: "the ask in the talking points and the note; (persona MUST #2) a keg, draft or tap ask keeps only rooms with taps, and the margin line uses the price in its unit",
    what: "the rep's own ask", off: ({ profile }) => { profile.pitch.ask = ""; }, applies: (s) => Boolean(s.profile.pitch?.ask), offMeans: "blank ask: the kind's default" },
];
export const slot = (k) => SLOTS.find((s) => s.key === k);

// Neutral order: the same rooms, by Qloo popularity (not drinker-specific), ties by id. Rewrites lists.all in place.
export function neutralOrder(route) {
  const rows = route.lists.all.map((r) => [r[0], route.venues[r[0]]?.popularity ?? 0]);
  rows.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  route.lists.all = rows.map(([id]) => [id, null, null, null]);
  route.lists.famous = [];
}

// ---------- one run ----------
// scenario: {key, cityName, profile}. opts: {off: [slot keys], mutate(ctx) (a probe's own edit), statuses, outcomes,
// profile (overrides the scenario's)}. → the decision record: everything a rep would act on, as plain data.
// R9 slots (docs/CULTURAL-SLOTS.md): slots = plan.slots ({doorId | "*": [records]}), slotsOff = stopModel's switch
// (["S4", "S6", "S1"]), focus = a door id: record that door on the first day it is planned (a return visit) instead of
// day 1's first stops. added = rooms added to a day (pool.js `added`: [{…venue, id, date}]), planned whatever the routing
// picks, for probes about one room's words. now: fixed, so expiry is reproducible.
export const NOW = Date.parse("2026-10-28T18:00:00Z");
export function runScenario(scenario, { off = [], mutate = null, statuses = {}, outcomes = {}, profile = null, stops = 3, slots = {}, slotsOff = [], focus = null, added = [], now = NOW } = {}) {
  const ctx = { profile: clone(profile ?? scenario.profile), routes: null, city: cityFile(scenario.profile.city), slotsOff: [...slotsOff], deepOff: [] };
  ctx.routes = routesFor(ctx.profile);
  for (const k of off) slot(k).off(ctx);
  if (mutate) mutate(ctx);
  const { profile: p, routes, city } = ctx;
  slotsOff = ctx.slotsOff;
  const hooks = cached("public/data/culture/hooks.json");
  const heat = cached("public/data/culture/heat.json");
  const pool = buildPool({ routes, profile: p, statuses, outcomes, added, cityName: scenario.cityName, deepOff: ctx.deepOff, heat: heatFor(heat, routes, p.city) }); // explicit list: never the page-wide default
  const windows = windowsFor(p);
  const plan0 = planDays({ pool: pool.rows, statuses: pool.statuses, windows, visitMin: p.visitMin, pinned: pool.pinned });
  const plan = { ...plan0, venues: pool.venues, pool: { ids: pool.ids, N: pool.N, label: pool.label, drinker: pool.drinker }, statuses: pool.statuses, outcomes, slots, profile: p, city: { key: p.city, name: scenario.cityName }, windows };
  const name = (id) => pool.venues[id]?.name ?? id;
  const days = plan.days.map((d) => (d ? { date: d.date, stops: d.stops.map((s) => s.id) } : null));
  const focusDay = focus ? plan.days.findIndex((d) => d?.stops.some((s) => s.id === focus)) : -1;
  const picks = focus ? (focusDay >= 0 ? [[focus, focusDay]] : []) : (plan.days[0]?.stops ?? []).slice(0, stops).map((s) => [s.id, 0]);
  const facts = FACTS();
  const deepFacts = deepOf(p.city, { plan, routes, city, profile: p }, picks.map(([id]) => id)); // the judged stops only (every door in the city would take minutes a run)
  const stopRecs = picks.map(([id, dayIndex]) => {
    const m = stopModel({ plan, id, dayIndex, city, facts, routes, slotsOff, now, deepOff: ctx.deepOff, hooks, heat, talkSets: TALK, enrich: enrichOf(p.city), deepFacts });
    if (m.talkReq && m.talk.by !== "model") talkWanted.set(m.talkKey, m.talkReq);
    const v = pool.venues[id];
    return {
      id, name: v.name, genre: v.genre ?? null, neighborhood: v.neighborhood ?? null, crowdSource: v.crowd ?? null,
      rankLine: m.rankLine, before: m.talk.before, opener: m.talk.opener, toBuyer: m.talk.toBuyer ?? null, openerBy: m.talk.lines.opener, talkBy: m.talk.by,
      questions: m.talk.questions, points: m.talk.points.map((x) => x.text), pushback: m.talk.pushback.map((x) => `${x.objection} → ${x.reply}`),
      ask: m.talk.ask, facts: m.talk.facts, venueType: m.talk.venueType, note: m.note.body, subject: m.note.subject,
      sms: m.note.sms ?? noteFor(m.note, "sms"), returnVisit: Boolean(m.returnVisit), day: dayIndex,
      hook: m.talk.hook?.text ?? null, hood: m.hood?.text ?? null,
      lead: m.talk.deep?.lead ? { question: m.talk.deep.lead.question ?? null, gate: m.talk.deep.lead.gate ?? null, ask: m.talk.deep.lead.ask ?? null, src: (m.talk.deep.lead.src ?? []).map((x) => x.field ?? x.label ?? null) } : null,
    };
  });
  return {
    scenario: scenario.key, off: [...off], kind: productKind(p.what), na: isNA(p.what),
    rooms: [...p.rooms], N: pool.N, label: pool.label,
    top10: pool.ids.slice(0, 10), top10Names: pool.ids.slice(0, 10).map(name),
    days, dayNames: days.map((d) => d && d.stops.map(name)), unscheduled: plan.unscheduled ?? [],
    stops: stopRecs,
  };
}

// ---------- comparing two runs, decision by decision ----------
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const jaccard = (a, b) => { const A = new Set(a), B = new Set(b); const i = [...A].filter((x) => B.has(x)).length; return A.size + B.size - i ? i / (A.size + B.size - i) : 1; };
const SISTER_LINE = /^(Rooms like it|Sister doors): /;
// The decision fields: what changes if this differs.
export const FIELDS = {
  ranking: (r) => r.top10,
  roomKinds: (r) => r.rooms,
  plan: (r) => r.days,
  // judge pass 4 (N24): the sister rooms' "Rooms like it" line sits in Before you walk in now; it is still a talking
  // point's content, not arrival advice, so it counts under points
  arrival: (r) => r.stops.map((s) => s.before.filter((b) => !SISTER_LINE.test(b))),
  opener: (r) => r.stops.map((s) => [s.opener, s.toBuyer ?? null]), // the opener and the line for the buyer (2026-10-24)
  questions: (r) => r.stops.map((s) => s.questions),
  points: (r) => r.stops.map((s) => [...s.points, ...s.before.filter((b) => SISTER_LINE.test(b))]),
  pushback: (r) => r.stops.map((s) => s.pushback),
  ask: (r) => r.stops.map((s) => s.ask),
  facts: (r) => r.stops.map((s) => s.facts),
  note: (r) => r.stops.map((s) => s.note),
  hook: (r) => r.stops.map((s) => s.hook ?? null),
};
export function diff(a, b) {
  const changed = Object.keys(FIELDS).filter((f) => !eq(FIELDS[f](a), FIELDS[f](b)));
  return { changed, top10Overlap: jaccard(a.top10, b.top10), day1Overlap: jaccard(a.days[0]?.stops ?? [], b.days[0]?.stops ?? []) };
}
// Per-stop field compare for the talk fields when the stops differ: compare by position only (what a rep reads).
export const sameRecord = (a, b) => eq(a, b);
