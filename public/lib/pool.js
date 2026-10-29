// The planner's inputs from a profile (SPEC-V2 §4 "Pool", §6 inputs): the drinker list(s) merged and filtered by Rooms
// to pitch, the statuses that exclude doors, My contacts and follow-ups as pins, and the windows. Pure: no DOM, no
// fetch. Covered by test/pool.test.mjs.
import { parseHours, genreLabel, km } from "./core.js";
import { roomOf, roomsPhrase, dayOf, toMinutes, doorsCap, poursPhrase, listWords, ageOf, ageLabel } from "./profile.js";
import { clockShort } from "./schedule.js";
import { deepOn, crowdTimes, hoodOf, heatWeight } from "./culture.js";
import { askMiss } from "./ask.js";
import { datedWindows } from "./week.js";

// Persona (drinks rep, Boise): "it lists Applebee's twice". Two Qloo records of one room (same name, within
// SAME_ROOM_M, or one phone or address: Sakura Sushi with and without "#138") are one door, at the better rank. Rooms of one chain at different
// addresses stay apart, and each gets its street (venue.branch: "N Eagle Rd") so the list tells them apart.
const SAME_ROOM_M = 120;
const nameKey = (n) => String(n ?? "").toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim();
// "1460 N Eagle Rd Meridian, ID 83642" → "N Eagle Rd"; null when the address doesn't read that way
export function streetOf(address) {
  const m = /^\s*\d+[a-z]?\s+(.+?\b(?:st|street|ave|avenue|rd|road|blvd|dr|drive|ln|lane|way|pkwy|hwy|ct|pl|ter|cir|pike|sq|trl|row)\b\.?)/i.exec(String(address ?? ""));
  return m ? m[1].replace(/\.$/, "") : null;
}
// one name, and one place: within SAME_ROOM_M, the same phone, or the same street address once a suite is dropped
const digits = (p) => String(p ?? "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
const addrKey = (a) => String(a ?? "").toLowerCase().replace(/\s(#|suite|ste\.?|unit|apt\.?)\s*[\w-]+/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const sameRoom = (a, b) => km(a, b) * 1000 <= SAME_ROOM_M || (digits(a.phone).length >= 10 && digits(a.phone) === digits(b.phone)) || (addrKey(a.address) && addrKey(a.address) === addrKey(b.address));
function sameRooms(ids, venues) {
  const keep = [];
  const byName = new Map();
  for (const id of ids) {
    const v = venues[id];
    const k = nameKey(v.name);
    const twins = byName.get(k) ?? [];
    if (k && twins.some((t) => sameRoom(venues[t], v))) continue;
    byName.set(k, [...twins, id]);
    keep.push(id);
  }
  for (const group of byName.values()) {
    if (group.length < 2) continue;
    for (const id of group) {
      const b = streetOf(venues[id].address);
      if (b) venues[id] = { ...venues[id], branch: b };
    }
  }
  return keep;
}

// One drinker's ranked ids: lists.all, or with `famous` the uncapped page merged in by Qloo affinity (rows are
// [id, affinity, growth, …]); an id on both lists keeps its better place.
// group 3 #4: with the drinkers' age band (profile.ageOf: a core.AGE_DIAL key) the doors Qloo ranks for that band (the
// list's own page fetched with signal.demographics.age) come first, in Qloo's order, then the rest as before. A list
// without that band (a room or "pours you" run) is left as it is.
export function rankedIds(route, { famous = false, age = null } = {}) {
  const base = rankedBase(route, famous);
  const band = age ? route?.lists?.[age] : null;
  if (!band?.length) return base;
  const first = band.map((r) => r[0]);
  const seen = new Set(first);
  return [...first, ...base.filter((id) => !seen.has(id))];
}
function rankedBase(route, famous) {
  const all = route?.lists?.all ?? [];
  if (!famous || !route?.lists?.famous?.length) return all.map((r) => r[0]);
  const best = new Map();
  for (const r of [...all, ...route.lists.famous]) if (!best.has(r[0]) || (r[1] ?? 0) > (best.get(r[0]) ?? 0)) best.set(r[0], r[1] ?? 0);
  return [...best].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([id]) => id);
}

// Merge 1–3 drinker lists into one ranked list: round-robin by rank, first appearance wins (A1 decision).
// r2viz (Jard 10-24, "maybe this subset of drinkers should weigh less heavily"): weights {drinker key: "less" | "more"}
// change how many of each list's places a round takes: "more" two, "less" one every other round, anything else one.
// With no "less"/"more" weight the original loop runs unchanged, so every plan made without weights is the same.
export const WEIGHTS = ["less", "normal", "more"];
export function mergeLists(routes, { famous = false, age = null, weights = null } = {}) {
  const lists = routes.map((r) => rankedIds(r, { famous, age }));
  const venues = Object.assign({}, ...routes.map((r) => r.venues));
  const ids = [];
  const seen = new Set();
  const w = routes.map((r) => weights?.[r?.drinker?.key]);
  if (routes.length < 2 || !w.some((x) => x === "less" || x === "more")) {
    for (let i = 0; lists.some((l) => i < l.length); i++)
      for (const l of lists) if (i < l.length && !seen.has(l[i]) && venues[l[i]]) (seen.add(l[i]), ids.push(l[i]));
    return { ids, venues };
  }
  const at = lists.map(() => 0);
  for (let round = 0; lists.some((l, k) => at[k] < l.length); round++)
    lists.forEach((l, k) => {
      const take = w[k] === "more" ? 2 : w[k] === "less" ? (round % 2 === 0 ? 1 : 0) : 1;
      for (let t = 0; t < take && at[k] < l.length; t++) {
        const id = l[at[k]++];
        if (!seen.has(id) && venues[id]) (seen.add(id), ids.push(id));
      }
    });
  return { ids, venues };
}
// The weights a profile sets on its drinkers (profile.drinks[i].weight), or null when none is "less" or "more".
export function weightsOf(profile) {
  const out = {};
  for (const d of profile?.drinks ?? []) if (d?.key && (d.weight === "less" || d.weight === "more")) out[d.key] = d.weight;
  return Object.keys(out).length ? out : null;
}

// Judge pass 8 (#4, #6): the form's "Doors to skip" hint, web and phone. One drinker: the count Why these doors
// leads with (insights.funnel's ranked: Qloo's list plus the places Doors set aside as not bars or restaurants), then
// the bars and restaurants, then the door types she pitches. Two or more drinkers: their lists overlap, so only the
// merged bars and restaurants. Says these doors leave the plan, and where an account that should stay on it goes.
// r: mergeLists(routes); kinds: how many of r.ids are the door types she pitches.
export const KEEP_ON_ROUTE = "To keep an account on your route, add it on the plan with + Add a door.";
export function knownHint({ routes = [], r, kinds = 0, cityName = "your city" } = {}) {
  const n = r?.ids?.length ?? 0;
  const pitch = `${kinds === n ? "all" : kinds} ${kinds === 1 ? "is" : "are"} the door types you pitch`;
  const one = routes.length === 1 ? (routes[0]?.lists?.all?.length ?? 0) + (routes[0]?.dropped?.all?.n ?? 0) : 0;
  const head = one > n ? `Qloo ranked ${one} places in ${cityName} for your drinker; ${n} are bars and restaurants, and ${pitch}.` : `Qloo ranks ${n} bars and restaurants in ${cityName} for your ${routes.length > 1 ? "drinkers" : "drinker"}; ${pitch}.`;
  return `${head} Pick the ones you already call on: Doors skips them, so your days go to new doors. ${KEEP_ON_ROUTE}`;
}

// "Athletic Brewing", "Athletic Brewing and Liquid Death", "the regulars at Parson's Chicken & Fish"; N3, rooms that
// pour you: "regulars like those at Parson's Chicken & Fish", "LaCroix drinkers and regulars like those at …"
export function drinkerPhrase(profile, routes) {
  if (routes[0]?.kind === "pour") return routes[0].drinker?.who ?? poursPhrase(profile.pours ?? []);
  if (profile.pours?.length) {
    const n = (profile.drinks ?? []).map((d) => d.name).filter(Boolean);
    if (n.length) return `${listWords(n)} drinkers and ${poursPhrase(profile.pours)}`;
    if (routes[0]?.kind !== "room") return poursPhrase(profile.pours);
  }
  if (profile.venue || routes[0]?.kind === "room") return `the regulars at ${routes[0]?.drinker?.name ?? "the bar you named"}`;
  const n = (profile.drinks ?? []).map((d) => d.name).filter(Boolean); // L1: a brand found live is a drinker too
  return n.length <= 1 ? n[0] ?? "your drinker" : `${n.slice(0, -1).join(", ")} and ${n.at(-1)}`;
}

// The statuses the planner sees: field 9's "Doors you already know" read as "talked", then the doors marked in the
// plan (a status set in the plan wins; null/undefined = cleared).
export function effectiveStatuses(profile, statuses = {}) {
  const out = {};
  for (const id of profile?.known ?? []) out[id] = "talked";
  for (const [id, s] of Object.entries(statuses ?? {})) {
    if (s) out[id] = s;
    else delete out[id];
  }
  return out;
}

// A contact (a door the rep added) → a venue record. Manual doors have no hours ("hours unverified").
export function contactVenue(c) {
  return { hours: null, genre: null, address: null, image: null, ...c, contact: true };
}

// "BBG'S" → "BBG's": an all-caps word's possessive S in lower case (judge pass 3, N22). Other names as Qloo gives them.
export const shownName = (name) => String(name ?? "").replace(/\b([A-Z0-9]{2,})(['’])S\b/g, "$1$2s");

// a follow-up with a time is visited from that time to this many minutes after it (judge pass 4 #3; persona: 3:00, 3:15 and 3:36 by path)
export const FU_SLACK_MIN = 5;
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

// Build the pool.
// routes: the drinker route files for the profile's city. statuses: {id: "visited"|"talked"|"notfit"} from the plan.
// contacts: [{id, name, lat, lon, address?, hours?, genre?, source:"qloo"|"manual"}] (My contacts, always pinned).
// added: [{…a Qloo venue record, date: "YYYY-MM-DD"}] (rooms added from the map or a list, G3): pinned to that date's
// window; a ranked room keeps its rank, any other is unranked (a sister room has no hours: "hours unverified").
// outcomes: {id: {followUp?: "YYYY-MM-DD", …}}: a follow-up date pins that door to that date (§6.5, §8).
// Returns {rows, venues, ids, N, label, drinker, statuses, pinned}: rows are the planner's pool
// ({id, rank, rawRank, lat, lon, parsedHours, genre}); ids/N = the ranked rooms after the Rooms filter (N in the rank line).
export function buildPool({ routes = [], profile, statuses = {}, contacts = [], added = [], outcomes = {}, famous = false, cityName = "", deepOff = null, heat = null }) {
  const age = ageOf(profile);
  const merged = mergeLists(routes, { famous, age, weights: weightsOf(profile) });
  const venues = { ...merged.venues };
  const rooms = profile.rooms ?? [];
  const ids = sameRooms(merged.ids.filter((id) => {
    const v = venues[id];
    return v && rooms.includes(roomOf(v)) && !askMiss(v, profile) && Number.isFinite(v.lat) && Number.isFinite(v.lon) && !v.closed; // persona MUST #2: the ask filters rooms (lib/ask.js)
  }), venues);
  const rank = new Map(ids.map((id, i) => [id, i + 1]));
  // V4.1 (docs/ROUTING-V3.md): each door's place in its drinker's raw Qloo list (before the Rooms filter; the best over
  // merged lists), the planner's rank value
  const raw = new Map();
  for (const rt of routes) rankedIds(rt, { famous, age }).forEach((id, i) => !(raw.get(id) <= i + 1) && raw.set(id, i + 1));
  const row = (id) => {
    const v = venues[id];
    // R9 deep: the room's crowd times (Qloo time_of_day_fit) for the planner's day choice; none when switched off
    const tod = deepOn("tod", deepOff) ? crowdTimes(v) : [];
    // R9 deep heat: 1 for a door in a top hood of Qloo's heatmap for this brand × city (heat = the hoods list)
    const hw = heat && deepOn("heat", deepOff) ? heatWeight(hoodOf(v, heat)) : 0;
    // name: judge 11 #3, a gap-filler's reason names the next door ("fills the time before Pinthouse Brewing, …")
    return { id, name: v.name ?? null, rank: rank.get(id) ?? null, ...(rank.has(id) && raw.has(id) ? { rawRank: raw.get(id) } : {}), lat: v.lat, lon: v.lon, parsedHours: parseHours(v.hours), genre: genreLabel(v), ...(tod.length ? { tod } : {}), ...(hw ? { heat: hw } : {}) };
  };
  const rows = ids.map(row);
  const pinned = [];
  const inPool = new Set(ids);
  for (const c of contacts ?? []) {
    if (!c?.id || !Number.isFinite(c.lat) || !Number.isFinite(c.lon)) continue;
    if (!venues[c.id]) venues[c.id] = contactVenue(c);
    else venues[c.id] = { ...venues[c.id], contact: true };
    if (!inPool.has(c.id)) (rows.push(row(c.id)), inPool.add(c.id));
    pinned.push({ id: c.id, kind: "contact" });
  }
  for (const a of added ?? []) {
    if (!a?.id || !Number.isFinite(a.lat) || !Number.isFinite(a.lon)) continue;
    venues[a.id] = { ...(venues[a.id] ?? { hours: null, genre: null, address: null, image: null, ...a }), added: true };
    delete venues[a.id].date;
    if (!inPool.has(a.id)) (rows.push(row(a.id)), inPool.add(a.id));
    pinned.push({ id: a.id, kind: "contact", ...(a.date ? { date: a.date } : {}) });
  }
  // a follow-up keeps its door in the pool even when the Rooms filter would drop it
  for (const [id, o] of Object.entries(outcomes ?? {})) {
    if (!o?.followUp) continue;
    if (!inPool.has(id) && venues[id] && Number.isFinite(venues[id].lat)) (rows.push(row(id)), inPool.add(id));
    pinned.push({ id, kind: "followup", date: o.followUp });
    // judge pass 2 (8): "back Thursday at 3": on that weekday the door's hours start at the time she said, so the planner
    // puts the visit at or after it ("follow-up at 3 pm"); a time the room is closed at is left to the stop to say
    const at = /^(\d{2}):(\d{2})$/.exec(o.followUpTime ?? "");
    const r = at && rows.find((x) => x.id === id);
    if (r?.parsedHours?.ok) {
      const t = +at[1] * 60 + +at[2];
      const day = WEEKDAYS[new Date(`${o.followUp}T12:00:00`).getDay()];
      // judge pass 4 (#3, persona "the cap moved 3 pm to 4:03"): the time she said is an appointment. When a window
      // that day holds it, the door is open to her only from that time to FU_SLACK_MIN after it, so the badge, the
      // stop's time and the cap agree; outside every window it stays "at or after", as before
      const vm = Number.isFinite(profile.visitMin) ? profile.visitMin : 25;
      const held = windowsFor(profile, { until: o.followUp }).some((w) => w.date === o.followUp && w.from <= t && t + vm <= w.to); // the usual week: out to its date
      let spans = (r.parsedHours.days[day]?.spans ?? []).filter((x) => x.to - Math.max(x.from, t) >= 15).map((x) => ({ from: Math.max(x.from, t), to: x.to })).sort((a, b) => a.from - b.from);
      if (held && spans.length) spans = [{ from: spans[0].from, to: Math.min(spans[0].to, spans[0].from + FU_SLACK_MIN + vm) }];
      if (spans.length) Object.assign(r, { parsedHours: { ...r.parsedHours, days: { ...r.parsedHours.days, [day]: { closed: false, spans } } }, fuAt: { day, min: t } });
    }
  }
  const own = profile.venue || profile.pours?.length || routes[0]?.kind === "room" || routes[0]?.kind === "pour";
  const drinker = own ? drinkerPhrase(profile, routes) : `${drinkerPhrase(profile, routes)} drinkers`;
  const like = /\bregulars like those at\b/.test(drinker); // N3: "Austin bars for regulars like those at Parson's"
  // intuit audit #5: "people who drink like Athletic Brewing drinkers" said the drinker twice; "people who drink Athletic
  // Brewing" (the venue preset keeps "people who drink like the regulars at …")
  const aged = age && routes.some((r) => r?.lists?.[age]?.length) ? `, aged ${ageLabel(age)}` : ""; // group 3 #4
  const label = `${cityName} ${roomsPhrase(rooms)} for ${like ? drinker : / drinkers$/.test(drinker) ? `people who drink ${drinker.replace(/ drinkers$/, "")}` : `people who drink like ${drinker}`}${aged}`.trim();
  // judge pass 3 (N22): Qloo's all-caps possessive reads as a shout ("BBG'S" → "BBG's"); only the name shown changes
  for (const [id, v] of Object.entries(venues)) if (typeof v?.name === "string" && /\b[A-Z0-9]{2,}['’]S\b/.test(v.name)) venues[id] = { ...v, name: shownName(v.name) };
  return { rows, venues, ids, N: ids.length, label, drinker, statuses: effectiveStatuses(profile, statuses), pinned };
}

// The drinker in a plan's label, as "Athletic Brewing drinkers": labels from before intuit audit #5 say "for people who
// drink like Athletic Brewing drinkers", newer ones "for people who drink Athletic Brewing". null when neither.
export function labelDrinker(label) {
  const s = String(label ?? "");
  const old = s.split(" for people who drink like ")[1];
  if (old) return old;
  const now = s.split(" for people who drink ")[1]?.replace(/, aged [^,]+$/, ""); // group 3 #4: the age band isn't the drinker
  return now ? `${now} drinkers` : null;
}

// Profile windows → planner windows, by date: {date, day, from, to (minutes), start:{id, lat, lon, label}}. A window
// with its own start uses it; otherwise the profile's start. Start ids are per date so a road matrix can key them.
// max (J2): the cap on doors a day, profile.maxPerDay, or null (no cap). profile.maxByDate (a per-day override) is no
// longer read: the owner dropped it (review 5), so an override saved before then can't apply unseen.
// A profile with a usual week (lib/week.js) plans on its dated days over the rolling horizon: opts {today, weeks,
// until}; one without plans on its own windows.
export function windowsFor(profile, opts = {}) {
  return [...datedWindows(profile, opts)]
    .filter((w) => toMinutes(w.from) !== null && toMinutes(w.to) !== null)
    .sort((a, b) => a.date.localeCompare(b.date) || toMinutes(a.from) - toMinutes(b.from))
    .map((w) => {
      const s = w.start && Number.isFinite(w.start.lat) ? w.start : profile.start;
      return {
        date: w.date,
        day: dayOf(w.date),
        from: toMinutes(w.from),
        to: toMinutes(w.to),
        start: s ? { id: `start:${w.date}`, lat: s.lat, lon: s.lon, label: s.label ?? null, own: s !== profile.start } : null,
        max: doorsCap(profile.maxPerDay), // J2: the cap on doors a day (null = none)
      };
    });
}

// The plan as the store keeps it (web ui/plan.js, phone engine.ts): the next re-plan's `previous`. weeks (fill "week"):
// the doors each calendar week took, so a reopened plan re-plans on the same sets (fix13: it re-derived them from the
// days and came out with more doors).
export const savedPlan = (p) => ({ days: p.days, unscheduled: p.unscheduled, carried: p.carried, notes: p.notes, reasons: p.reasons, ...(p.weeks ? { weeks: p.weeks } : {}) });

// A re-plan from fresh (J3: a doors-a-day change is a deliberate pace change): the saved plan as the planner's
// `previous`, minus the days ahead, so they plan as if new. The days that ended and the day under way keep theirs:
// the ones the saved plan flags, and (with `now`, {date, min}) the ones that ended or started since it was made.
export function freshPrevious(saved, now = null) {
  if (!saved?.days) return saved ?? null;
  const begun = (d) => now && (d.date < now.date || (d.date === now.date && d.from <= now.min));
  const { weeks, ...rest } = saved; // fix13: the days ahead choose their doors again
  return { ...rest, days: saved.days.filter((d) => d && (d.past || d.frozen || begun(d))) };
}

// Owner review 5: back to no doors-a-day limit is back to the plan the rep had before any limit. The days that have
// begun come from the saved plan (freshPrevious); the days ahead from the last plan made with no limit (`base`), so
// re-plan stability puts their doors back. No base: as fresh.
export function uncappedPrevious(saved, base, now = null) {
  const kept = freshPrevious(saved, now);
  if (!base?.days || !kept?.days) return kept;
  const key = (d) => `${d.date} ${d.from}`;
  const have = new Set(kept.days.map(key));
  return { ...kept, days: [...kept.days, ...base.days.filter((d) => d && !have.has(key(d)))], ...(base.weeks ? { weeks: base.weeks } : {}) };
}

// 600 → "10 am", 1440 → "midnight", 1500 → "1 am" (an opening span may run past midnight): the planner's clock, so
// "opens 3 pm" reads the same in a row and in a reason.
export { clockShort };

// The hours line on a stop: "open till 10 pm", or "hours unverified" (§9.3). On a day kept as it is (frozen), a
// stop can come up before the room opens: "opens 3:30 pm, you'd be early" (needs the parsed hours and the weekday).
export function openTill(stop, { parsed = null, day = null } = {}) {
  if (!stop.hoursVerified) return "hours unverified";
  if (stop.openAtArrival === false) {
    const next = parsed?.days?.[day]?.spans?.map((x) => x.from).filter((m) => m > stop.eta).sort((a, b) => a - b)[0];
    return next != null ? `opens ${clockShort(next)}, you'd be early` : "closed when you'd arrive";
  }
  return stop.openUntil != null ? `open till ${clockShort(stop.openUntil)}` : "open";
}

// "Add to the best day" (G3; "Let Doors choose" before group 3 #6): the day a room added without a date goes on. trials: [{date, plan}], the planner's plan with
// the room pinned to each open day in turn; rank(id) → its rank or null. The best lands the room there, then keeps the
// most of the plan's other doors, then the better-ranked ones, then drives least, then is the earliest. → a date or null.
export function bestAddDay(trials, id, { rank = () => null } = {}) {
  let best = null;
  for (const t of trials ?? []) {
    const d = t.plan?.days?.find((x) => x?.date === t.date);
    if (!d?.stops.some((s) => s.id === id)) continue;
    const live = t.plan.days.filter((x) => x && !x.past);
    const stops = live.flatMap((x) => x.stops).filter((s) => s.id !== id);
    const value = stops.reduce((a, s) => a + 1 / (1 + (rank(s.id) ?? 100)), 0);
    const min = live.reduce((a, x) => a + (x.min ?? 0), 0);
    const c = { date: t.date, n: stops.length, value, min };
    if (!best || c.n > best.n || (c.n === best.n && (c.value > best.value + 1e-9 || (Math.abs(c.value - best.value) <= 1e-9 && (c.min < best.min || (c.min === best.min && c.date < best.date)))))) best = c;
  }
  return best?.date ?? null;
}

// Where an added room landed, for the toast: "Added to Wednesday, stop 4." or why it is not on a day, from the
// planner's note ("Not on Tuesday: it is closed Tuesday. It stays on Your list.").
export function addedText(plan, id, { day = null } = {}) {
  const k = plan.days.findIndex((d) => d?.stops.some((s) => s.id === id));
  if (k >= 0) return `Added to ${cap(plan.days[k].day)}, stop ${plan.days[k].stops.findIndex((s) => s.id === id) + 1}.`;
  const note = plan.notes?.find((n) => n.id === id && /unscheduled/.test(n.kind ?? ""));
  const why = note?.text?.split(" is not on the plan: ")[1]?.replace(/\.$/, "") ?? "it didn't fit any window";
  return `${day ? `Not on ${cap(day)}` : "Not on the plan"}: ${why}. It stays on Your list.`;
}
// Jard 10-24 web review: a room the planner can't place is not added (no "you added it", no tag, no banner); the toast
// says so and why, from the planner's note: "Couldn't add The Thirsty Scholar: it is closed Monday and Tuesday."
// plan: the trial plan with the room pinned; onList: it is on Your list (a sister room is not).
export const dayHolding = (plan, id) => plan?.days?.findIndex((d) => d?.stops.some((s) => s.id === id)) ?? -1;
export function notAddedText(plan, id, { day = null, name = null, onList = false } = {}) {
  const note = plan?.notes?.find((n) => n.id === id && /unscheduled/.test(n.kind ?? ""));
  const why = note?.text?.split(" is not on the plan: ")[1]?.replace(/\.$/, "") ?? "it didn't fit any window";
  return `Couldn't add ${name ?? "this door"}${day ? ` to ${cap(day)}` : ""}: ${why}.${onList ? " It stays on Your list." : ""}`;
}
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : "");
