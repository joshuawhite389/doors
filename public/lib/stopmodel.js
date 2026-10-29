// Everything one stop shows (SPEC-V2 §3.5), from the published plan (ui/state.js shape) and the precomputed data:
// the rank line, today's hours, the leg, Why this room, the drafted note, the talking points (template + stored model
// lines), sister rooms and the Qloo record. Pure: the stop panel, the export and the tests all build it the same way.
import { BANNED_PITCH, affinityGap, templatePitch, parseHours, formatDayHours, rawHoursText, genreLabel, priceLabel, NA_BRANDS, BRAND_CATEGORY, isChain, DAYS, dayShort } from "./core.js";
import { isNA, pitchForTalk, roomsPhrase, clock12 } from "./profile.js";
import { talkPoints, venueType, clockText, productKind, humanTime } from "./talk.js";
import { withModelTalk } from "./talk-model.js";
import { talkFacts, talkKey, withTalkSet, pickTalkSet } from "./talk-gen.js"; // group 3 item 3: written per door
import { draftNote, crowdForNote } from "./note.js";
import { isReturnVisit, returnVisitLabel } from "./outcome.js";
import { applyTalkEdits } from "./agent-tools.js"; // R9 chat agent
import { memoryFor, rulesFrom, hasRules, applyRule, resolve } from "./slots.js";
import { roomTagFacts, deepOn, hookFor, heatFor, hoodOf, hooksWith, leadFor } from "./culture.js";
import { labelDrinker } from "./pool.js";
import { liftModel, rarityChips } from "./whyviz/lift.js"; // WHY-VIZ-SPEC §6: the stop card's rarity chips
import { planIds as idsOnPlan } from "./insights.js";

// Every artist name in a city file (sounds, city and neighbourhood lists): never printed in a pitch or talking point.
const avoidCache = new WeakMap();
export function cityArtists(city) {
  if (!city) return [];
  if (avoidCache.has(city)) return avoidCache.get(city);
  const names = new Set();
  const add = (a) => a?.name && names.add(a.name);
  for (const s of Object.values(city.sounds ?? {})) (s.artists ?? []).forEach(add);
  (city.citySound ?? []).forEach(add);
  for (const l of Object.values(city.nbhdSounds ?? {})) (l ?? []).forEach(add);
  const out = [...names];
  avoidCache.set(city, out);
  return out;
}

// "Why this room": the city file's Crowd/Room lines (model-drafted or Qloo's profile text), else the template.
// A stored line with a banned word is replaced by the clean template line for its label (as v1 pitchOf).
export function pitchOf(v, city) {
  const p = city?.pitches?.[v?.id];
  const t = templatePitch(v ?? {});
  if (p?.lines?.length) {
    const lines = p.lines.map((l) => (BANNED_PITCH.test(l.text ?? "") ? t.lines.find((x) => x.label === l.label) ?? null : l)).filter(Boolean);
    return { ...p, lines };
  }
  return t;
}

// "1900 Simond Ave #200, Austin, TX 78702" → "1900 Simond Ave #200"
export function streetOf(address, cityName = "") {
  const a = String(address ?? "").trim();
  if (!a) return "";
  const i = cityName ? a.toLowerCase().indexOf(` ${cityName.toLowerCase()}`) : -1;
  return (i > 0 ? a.slice(0, i) : a.split(",")[0]).replace(/[,\s]+$/, "");
}

// The address as a line to read (judge pass 4, 18): Qloo gives "3664 N Clark St Chicago, IL"; a comma goes before the
// plan's city when there isn't one. Another town's address stays as Qloo gives it.
export function addressLine(address, cityName = "") {
  const a = String(address ?? "").trim();
  if (!a || !cityName) return a;
  const i = a.toLowerCase().lastIndexOf(` ${cityName.toLowerCase()},`);
  return i > 0 && a[i - 1] !== "," ? `${a.slice(0, i)},${a.slice(i)}` : a;
}

// The affinity row for a door: the first drinker list holding it ({affinity, list, drinker, captured}) or null.
export function affinityOf(routes = [], id) {
  for (const r of routes) {
    for (const key of ["all", "famous"]) {
      const row = r?.lists?.[key]?.find((x) => x[0] === id);
      if (row) return { affinity: row[1], list: key, drinker: r.drinker?.name ?? null, who: routeWho(r), captured: r.captured ?? null };
    }
  }
  return null;
}

// The ordered ids the stop's arrows step through: its day's stops, or the Not scheduled list.
export function sequenceOf(plan, dayIndex) {
  const d = Number.isInteger(dayIndex) ? plan?.days?.[dayIndex] : null;
  if (d) return d.stops.map((s) => s.id);
  return plan?.unscheduled ?? [];
}

// What the door card's map frames at desktop width (intuitiveness audit #7: one pin at street level read as a parking
// lot): the stop before (the day's start for stop 1), this stop and the one after, as [[lon, lat], …]. A door with no
// neighbours on a day frames itself with the day's start, else just itself.
export function cardFrame(plan, id, dayIndex) {
  const at = (v) => (Number.isFinite(v?.lat) && Number.isFinite(v?.lon) ? [v.lon, v.lat] : null);
  const me = at(plan?.venues?.[id]);
  if (!me) return [];
  const d = Number.isInteger(dayIndex) ? plan?.days?.[dayIndex] : null;
  const ids = d ? d.stops.map((s) => s.id) : [];
  const k = ids.indexOf(id);
  if (k < 0) return [me];
  const prev = k > 0 ? at(plan.venues[ids[k - 1]]) : at(d.start);
  const next = k < ids.length - 1 ? at(plan.venues[ids[k + 1]]) : null;
  return [prev, me, next].filter(Boolean);
}

// 2+ drinker brands: the order is Doors' merge of their Qloo lists, not a Qloo rank (R1 Diolosa D7). The plan view's
// rank labels, the Why drawer and the CSV say "on Your list" either way (Jard 10-24).
// N3: rooms that pour you make one Qloo list (the rooms and brands blended in one call), so never a merge.
export const isMerged = (profile) => !profile?.venue && !profile?.pours?.length && (profile?.drinks ?? []).filter((x) => x.ready !== false).length >= 2;
// Who a route's list is for, in words: "Athletic Brewing drinkers", "the regulars at Parson's Chicken & Fish" (the preset
// room), or a pour run's own words ("LaCroix drinkers and regulars like those at Parson's Chicken & Fish").
export const routeWho = (r) => (r?.kind === "pour" ? r.drinker?.who ?? r.drinker?.name ?? "your drinker" : r?.kind === "room" || r?.kind === "venue" ? `the regulars at ${r.drinker?.name ?? "the door you named"}` : `${r?.drinker?.name ?? "this"} drinkers`);

// stopModel({plan, id, dayIndex, city, facts, routes, captured}) → the stop's content. city = cities/<key>.json.
// R9 slots (docs/CULTURAL-SLOTS.md): plan.slots = {doorId | "*": [records]}; slotsOff = ["S4", "S6", "S1", "S1t"] switches a
// slot off (the ablation baseline: all off = the pre-R9 output); now = the clock expiry is read against.
// enrich (round 3, lane enrich): {doorId: lib/enrich.js enrichFacts(record)} for the doors the caller has records for;
// deepFacts (lane deep): {doorId: [{label, text, prep?, from?}]}, the door's ranked insights; both join the talking
// points' facts (lib/talk-gen.js talkFacts)
export function stopModel({ plan, id, dayIndex = null, city = null, facts = [], routes = [], captured = null, slotsOff = [], now = Date.now(), deepOff = null, hooks = null, heat = null, talkSets = null, enrich = null, deepFacts = null, base = null }) {
  const v = plan.venues?.[id] ?? { id, name: id };
  const profile = plan.profile ?? {};
  const d = Number.isInteger(dayIndex) ? plan.days?.[dayIndex] ?? null : null;
  const k = d ? d.stops.findIndex((s) => s.id === id) : -1;
  const stop = k >= 0 ? d.stops[k] : null;
  const day = stop ? d : null;
  const seq = sequenceOf(plan, day ? dayIndex : null);
  const pos = seq.indexOf(id);
  const rankIdx = plan.pool?.ids?.indexOf(id) ?? -1;
  const rank = rankIdx >= 0 ? rankIdx + 1 : null;
  const N = plan.pool?.N ?? null;
  const label = plan.pool?.label ?? "";
  // the drinker, bare ("Athletic Brewing and Liquid Death"; "the regulars at …" for the venue preset; "regulars like
  // those at …" for rooms that pour you, N3)
  const drinker = String(plan.pool?.drinker ?? labelDrinker(label) ?? "");
  const drinkerName = drinker.replace(/ drinkers$/, "");
  const filterLabel = roomsPhrase(profile.rooms ?? []);
  const merged = isMerged(profile);
  // Jard 10-24: one wording on every screen, "#3 of 55 on Your list of Austin bars …" (merged or not; the merged list is
  // the drinkers' lists taken in turn, so never called Qloo's rank)
  const listOf = merged ? `${plan.city?.name ?? ""} ${filterLabel} for ${drinker}` : label;
  const rankLine = !rank ? "" : `#${rank} of ${N} on Your list of ${listOf}`;
  // Judge pass 8 (#2): at the door (drive mode, the door card's Why row) the reason, not "#5 of 55": "Qloo's top pick of
  // Austin bars and breweries for …" (#1), "One of Qloo's top picks of …" (top 10), else "Qloo picked it from …". The
  // rank stays inside Why this door.
  const rankRest = listOf;
  const whyLine = !rank ? "" : rank === 1 ? `Qloo's top pick of ${rankRest}` : rank <= 10 ? `One of Qloo's top picks of ${rankRest}` : `Qloo picked it from ${rankRest}`;
  const parsed = parseHours(v.hours);
  const avoid = [...cityArtists(city), ...(profile.drinks ?? []).map((x) => x.name)];
  const status = plan.statuses?.[id] ?? null;
  const outcome = plan.outcomes?.[id] ?? null;
  const returnVisit = isReturnVisit(stop, d, outcome);
  const returnLabel = returnVisitLabel(stop, d, outcome); // "follow-up visit[, moved from Sat Oct 24]" | ""

  // the leg: from the previous stop or the day's start
  const prevId = stop && k > 0 ? d.stops[k - 1].id : null;
  const from = stop ? (prevId ? plan.venues[prevId] : d.start) : null;

  // Why this room
  const pitch = pitchOf(v, city);
  const why = pitch.lines.filter((l) => /crowd|room/i.test(l.label ?? ""));
  // WHY-VIZ-SPEC §6: with the city's doors to measure against (base: ui/stop.js loadStopData), the crowd line gives way
  // to rarity chips: the groups Qloo names at this door that are rare in the city (lift.js rarityChips: ≥ 1.5× the
  // city over the plan, else ≤ a quarter of the city's doors), each with the city's share. Nothing ordinary gets a
  // chip, so nothing ordinary gets said. null without a base (the card keeps its crowd line).
  const rarity = base?.ids?.length ? rarityOf({ v, plan, base, cityName: plan.city?.name ?? "the city" }) : null;

  // talking points: the template, our rank line, then the stored model lines (guarded again)
  const sisters = (city?.sisters?.[id] ?? [])
    .map((r) => (Array.isArray(r) ? r[0] : r))
    .map((sid) => ({ id: sid, name: plan.venues?.[sid]?.name ?? city?.sisterVenues?.[sid]?.name ?? null, on: onPlan(plan, sid) }))
    .filter((s) => s.name);
  // ---- R9 slots ----
  const off = new Set(slotsOff);
  const slots = plan.slots ?? {};
  const memory = off.has("S4") ? null : memoryFor({ slots, id, outcome, day: stop ? d : null, returnVisit, now });
  const typeFix = off.has("S1") ? null : resolve(slots, id, "venueType", now);
  const talkProfile = { brand: profile.brand, what: profile.what, name: profile.pitch?.name ?? profile.name ?? "", ...pitchForTalk(profile), drinksLike: (profile.drinks ?? []).map((x) => ({ name: x.name, na: x.key ? NA_BRANDS.has(x.key) : null, category: (x.key ? BRAND_CATEGORY[x.key] : x.category) ?? null })) };
  // judge pass 4 (N12): how many rooms earlier on this day lead with a dish question, so this one takes the next wording
  const leadKind = { kind: productKind(profile.what), isNA: productKind(profile.what) !== "soft" && isNA(profile.what) };
  const leadTurn = stop && deepOn("lead", deepOff) ? d.stops.slice(0, k).filter((s) => plan.venues?.[s.id] && leadFor(plan.venues[s.id], leadKind)?.dish).length : null;
  const tpl = talkPoints({ venue: v, date: stop ? d.date : null, leadTurn, rank, N, drinkerName, merged, city: plan.city?.name, filterLabel, profile: talkProfile, eta: stop?.eta ?? null, wait: stop?.waitMin ?? 0, day: stop ? d.day : null, isNA: isNA(profile.what), sisters: sisters.map((s) => s.name), avoid, memory, venueType: typeFix?.value ?? null, timingByType: !off.has("S1t"), deepOff }, facts);
  let talk = withModelTalk(tpl, city?.talk?.venues?.[id], { venue: v, avoid });
  // group 3 item 3: the set a model wrote for this door from Qloo's facts (lib/talk-gen.js), checked again here against
  // today's facts; none yet (or a return visit, whose lines come from what the rep logged) → the template, labelled so
  // "What you make" blank: nothing to pitch, so no written set (the template's neutral words stand)
  const talkReq = memory || !String(profile.what ?? "").trim() ? null : talkFacts({ venue: v, id, city, routes, plan, profile: { ...profile, support: talkProfile.support }, ask: talk.ask, venueType: talk.venueType, avoid, na: talk.isNA, soft: talk.kind === "soft", enrich: enrich?.[id] ?? null, deep: deepFacts?.[id] ?? null });
  const talkK = talkReq ? talkKey(talkReq) : null;
  // g6: the written opener and message carry {rep} and {when}; filled here, on the device, never sent
  const fill = { rep: String(profile.pitch?.name ?? profile.name ?? "").trim().split(/\s+/)[0] ?? "", when: stop && Number.isFinite(stop.eta) && d?.day ? `${cap(d.day)} ${humanTime(stop.eta)}` : null };
  talk = withTalkSet(talk, talkReq ? pickTalkSet(talkSets, { key: talkK, id, profile, ask: talk.ask }, talkReq) : null, fill);
  // R9 deep hooks (lib/culture.js): small talk from what the plan's drinker brands' fans also like, only where the
  // room's own tags meet the item's genre; null otherwise, or when switched off
  talk.hook = deepOn("hooks", deepOff) ? hookFor(v, routes.filter((r) => r?.drinker?.key && (r.kind ?? "brand") === "brand").map((r) => ({ key: r.drinker.key, name: r.drinker.name })), hooksWith(hooks, routes)) : null;
  // private context like "Why you're here" (it names the drinker brand); an item that is also a city artist's name is dropped
  if (talk.hook && cityArtists(city).includes(talk.hook.item)) talk.hook = null;
  talk.factRefs = talk.points.filter((p) => p.fact).map((p) => facts.find((f) => f.id === p.fact)).filter(Boolean);

  // g6: the written message replaces the template's note (first visits); a return visit keeps the template from memory
  const tplNote = draftNote({ venue: v, profile, cityName: plan.city?.name ?? "", day: stop ? d.day : null, date: stop ? d.date : null, eta: stop?.eta ?? null, crowd: crowdForNote(v, talk.lines.opener === "model" && !talk.written?.opener ? { text: talk.opener.split(/(?<=\.)\s+/)[0] } : null, avoid), ask: talk.ask, venueType: talk.venueType, memory, hook: talk.angle?.mail ?? null, kind: talk.kind });
  const note = talk.message && !memory ? { subject: talk.message.subject, body: talk.message.body, sms: talk.message.sms, lines: talk.message.body.split(/\n\n+/), by: "model", visit: "first", parts: null } : tplNote;
  // ---- R9 chat agent: the rep's talking-point edits (plan.talkEdits[id], the agent's talk actions); after the note,
  // which keeps its own drafted lines ----
  // A return visit has its own opener (S4): an opener edited before that visit was for the first one, so it stays there
  const edits = (plan.talkEdits?.[id] ?? []).filter((e) => !(memory && e.section === "opener" && e.at && outcome?.at && e.at < outcome.at));
  if (edits.length) Object.assign(talk, applyTalkEdits(talk, edits));
  // ---- end R9 chat agent ----
  // S6: the rep's own note wins over the draft; then their rules run last, over every line
  const rules = off.has("S6") ? null : rulesFrom(slots, id, now);
  const fixEmail = off.has("S6") ? null : resolve(slots, id, "note.email", now);
  const fixSms = off.has("S6") ? null : resolve(slots, id, "note.sms", now);
  if (fixEmail) Object.assign(note, { body: fixEmail.value, by: "rep", edited: fixEmail.at, parts: null });
  if (fixSms) note.sms = fixSms.value;
  const hidden = hasRules(rules) ? applyRules(talk, note, rules, { keep: [profile.brand, v.name, profile.pitch?.name ?? profile.name, ...String(profile.pitch?.name ?? profile.name ?? "").split(/\s+/)], what: profile.what }) : 0;

  const aff = affinityOf(routes, id);
  return {
    id, venue: v, profile,
    talkReq, talkKey: talkK, // group 3 item 3: what POST /api/talk is sent for this door, and its cache key
    dayIndex: day ? dayIndex : null, day, stop, n: stop ? k + 1 : null, total: stop ? d.stops.length : seq.length, pos, seq,
    returnVisit, returnLabel, status, outcome,
    // the rep's arrival, and the wait outside when the room isn't open yet (eta = when the visit starts; R2 L6)
    arrive: stop ? stop.eta - (stop.waitMin ?? 0) : null,
    wait: stop?.waitMin ?? 0,
    arriveText: stop ? arriveText(stop) : null,
    rank, N, rankLine, whyLine, merged, drinkerName, filterLabel,
    // R9 polish: Qloo's affinity beside the rank ("affinity 0.90, 0.01 below #1"), "" when the door has none
    affText: rank ? affinityGap({ affinity: aff?.affinity, top: affinityOf(routes, plan.pool?.ids?.[0])?.affinity, rank, merged }) : "",
    meta: [cap(genreLabel(v)) || (v.contact ? "My contact" : ""), isChain(v.name) ? "Chain · corporate buys" : "", priceLabel(v.price), v.rating ? `★ ${Number(v.rating).toFixed(1)}` : "", streetOf(v.address, plan.city?.name)].filter(Boolean),
    hoursToday: stop ? (stop.hoursVerified ? formatDayHours(parsed, d.day) ?? "hours unverified" : "hours unverified") : null,
    leg: stop ? { mi: stop.legMi, min: stop.legMin, source: stop.source, from } : null,
    // stop 1 of a day that leaves later than its window opens (F4: the first room opens later): when to leave
    leave: stop && k === 0 && d && Number.isFinite(d.leave) && d.leave > d.from ? d.leave : null,
    why, pitch, rarity,
    // R9 deep: the room's Qloo tags as sourced facts (shown under Why this room; the agent cites them), and the
    // decisions they changed on this stop (talk.deep: tod = arrival line, lead = opener question / ask / gate)
    // R9 deep heat: the door's part of town on Qloo's map of where the drinker brand's fans are (rank only)
    hood: (() => {
      const hoods = deepOn("heat", deepOff) ? heatFor(heat, routes, plan.city?.key) : null;
      const h = hoods && hoodOf(v, hoods);
      return h ? { ...h, text: `Part of town: ${h.name}, #${h.rank} of ${h.of} on Qloo's map of where ${routes[0]?.drinker?.name ?? "your drinker's"} drinkers are in ${plan.city?.name ?? "this city"}.`, src: { kind: "qloo", field: "heatmap:locality", tags: [h.name] } } : null;
    })(),
    roomTags: deepOn("tod", deepOff) || deepOn("lead", deepOff) ? roomTagFacts(v, { captured: affinityOf(routes, id)?.captured ?? captured }) : [],
    note, talk, sisters,
    memory, hidden, avoid,
    record: {
      id: v.source === "manual" ? null : id,
      rank: rankLine || (v.contact ? "Your contact: not on Qloo's ranked list for this drinker." : "not ranked"),
      affinity: aff,
      hoursRaw: rawHoursText(v.hours),
      // intuit audit #1: Qloo's hours as a week ("Mon 8 am–10 pm"), not its JSON; null when they don't parse
      week: parsed.ok ? DAYS.map((x) => `${dayShort(x)} ${formatDayHours(parsed, x) ? cap(formatDayHours(parsed, x)) : "not listed"}`) : null,
      captured: aff?.captured ?? captured,
      when: shortDate(aff?.captured ?? captured), // "Oct 8"
      // round 3 (feedback audit M1): no model named or implied on the door; the privacy page says which model drafts these
      pitchBy: `Qloo's profile of this door (${[...new Set(why.map((l) => l.source))].join(", ") || (pitch.by === "model" ? "its fields" : "none")})`,
    },
  };
}

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : "");
// "2026-10-08" → "Oct 8"; "" when it isn't a date
export function shortDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ""));
  return m ? new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
}

// S6 rules over the talking points and the note, in place; returns how many lines they hid. keep = names the rules never
// touch (the brand, the venue, the rep: judge pass 4 #1). The opener and the ask fall back to plain words that pass the
// rules too (persona: "never say regulars" got "What do your regulars order now?"); the note's intro and sign-off are
// never hidden: the intro drops what the rep makes before it drops who is writing.
const OPENERS = ["Who does the buying here?", "Is the manager around?", "Who should I talk to about drinks?", "How's the day going?"];
const ASKS = ["a few minutes with whoever buys", "a few minutes with the buyer", "ten minutes of your time"];
function applyRules(talk, note, rules, { keep = [], what = "" } = {}) {
  let n = 0;
  const pass = (x) => applyRule(x, rules, { keep });
  const one = (x) => { const y = pass(x); if (y == null) n++; return y; };
  const firstOk = (xs) => xs.map(pass).find((y) => y != null) ?? xs.at(-1);
  // the what-you-make words out of an intro: "…from Kinfolk Kombucha, a sparkling kombucha, low sugar, and…" → "…from
  // Kinfolk Kombucha, and…"; "(sparkling kombucha, low sugar)" → ""; "a new sparkling kombucha brand" → "a new drinks brand"
  const w = String(what ?? "").trim().replace(/\s+/g, " ");
  const lw = w.replace(/^[A-Z](?![A-Z])/, (c) => c.toLowerCase());
  const bare = (x) => (w ? String(x).split(`, a ${lw}`).join("").split(`, an ${lw}`).join("").split(` (${lw})`).join("").split(`a new ${lw} brand`).join("a new drinks brand") : String(x));
  const keepLine = (x, minimal) => pass(x) ?? pass(bare(x)) ?? minimal;
  const opener = one(talk.opener);
  if (opener == null) Object.assign(talk, { openerSource: null, lines: { ...(talk.lines ?? {}), opener: "template" } });
  const before = talk.before.map(one);
  if (talk.beforeKinds) talk.beforeKinds = talk.beforeKinds.filter((_, i) => before[i] != null);
  talk.before = before.filter((x) => x != null);
  talk.opener = opener ?? firstOk(OPENERS);
  if (talk.toBuyer) talk.toBuyer = one(talk.toBuyer);
  talk.questions = talk.questions.map(one).filter((x) => x != null);
  talk.points = talk.points.map((p) => ({ ...p, text: one(p.text) })).filter((p) => p.text != null);
  talk.pushback = talk.pushback.map((p) => ({ ...p, objection: one(p.objection), reply: one(p.reply) })).filter((p) => p.objection != null && p.reply != null);
  talk.ask = one(talk.ask) ?? firstOk(ASKS);
  talk.facts = talk.points.filter((p) => p.fact).map((p) => p.fact);
  talk.factRefs = (talk.factRefs ?? []).filter((f) => talk.facts.includes(f.id));
  const terms = { terms: rules.terms };
  if (note.by !== "rep") {
    const last = note.lines.length - 1;
    // the intro: the "I'm …" line of a first note (its greeting is "Hi," alone), or a return note's "Hi …" line
    const intro = ((i) => (i >= 0 ? i : /^Hi\b/.test(note.lines[0] ?? "") ? 0 : -1))(note.lines.findIndex((x) => /^I'm\b/.test(x)));
    const sign = /^Thanks\b/.test(note.lines[last] ?? "") ? last : -1;
    // an intro the rules can't pass even without what the rep makes still says who is writing (names only)
    const who = (x) => String(x).split(/[,.]/)[0] + ".";
    note.lines = note.lines.map((x, i) => (i === intro ? keepLine(x, who(x)) : i === sign ? keepLine(x, applyRule(x, terms, { keep }) ?? x) : one(x))).filter((x) => x != null);
    note.body = note.lines.join("\n\n");
    note.subject = keepLine(note.subject, null) ?? firstOk(["Could I bring a tasting?", "Could I stop by?"]); // the subject is the brand and what it is: drop the what before the brand
    if (note.parts) for (const k of Object.keys(note.parts)) if (typeof note.parts[k] === "string") note.parts[k] = k === "hello" || k === "sign" ? keepLine(note.parts[k], who(note.parts[k])) : pass(note.parts[k]);
  } else note.body = applyRule(note.body, terms, { keep }) ?? note.body; // the rep's own text: terms only
  if (note.sms) note.sms = applyRule(note.sms, terms, { keep }) ?? note.sms;
  return n;
}
// "Arrive 2:46 pm · opens 3 pm, wait ~14 min", or "Arrive 2:14 pm"
export function arriveText(stop) {
  const w = stop.waitMin ?? 0;
  return w > 0 ? `Arrive ${clock12(stop.eta - w)} · opens ${clockText(stop.eta)}, wait ~${w} min` : `Arrive ${clock12(stop.eta)}`;
}
// Where a door sits on the plan: {dayIndex, n, day} (the first day holding it) or null.
export function onPlan(plan, id) {
  for (let i = 0; i < (plan?.days ?? []).length; i++) {
    const k = plan.days[i]?.stops.findIndex((s) => s.id === id) ?? -1;
    if (k >= 0) return { dayIndex: i, n: k + 1, day: plan.days[i].day };
  }
  return null;
}

// §6 rarity chips for one door: {chips: the rare ones, all, baseN, line}
function rarityOf({ v, plan, base, cityName }) {
  const lift = liftModel({ planIds: idsOnPlan(plan), venues: { ...(base.venues ?? {}), ...(plan.venues ?? {}) }, base, cityName });
  const all = rarityChips({ venue: v, base, lift, cityName });
  const chips = all.filter((c) => c.rare);
  const named = all.length;
  const line = !named ? `Qloo doesn't describe this door's crowd.` : chips.length ? "" : `Qloo names ${named === 1 ? "one group" : `${named} groups`} here, none rare in ${cityName}.`;
  return { chips, all, baseN: base.ids.length, cityName, line };
}
