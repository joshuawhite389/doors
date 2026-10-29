// Words for the plan view (SPEC-V2 §3.4; R1 Calacanis 7, 8 · Diolosa 5, 6, 7): what a re-plan moved, how other
// brands' drinkers overlap your rooms, the distance suffix, rank labels and the planner's per-row reasons.
// Pure: no DOM. Covered by test/planview.test.mjs.
import { overlap, affinityGap, matchTier, NEAR_LEVEL } from "./core.js";
import { isMerged, affinityOf } from "./stopmodel.js";
import { clock12, niceDate, isNA } from "./profile.js";
import { crowdPhrase } from "./talk.js";

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : "");

// A plan day's name (fix13, phone check of fill by rank): "Tuesday" ("Tue" short), or its date where the plan has that
// weekday twice ("Tue Nov 3"), as the planner's reasons name it: a two-week plan's Your list read "Thu · stop 4" and its
// Week headers "Tuesday" for both weeks. days: the plan's days; d: one of them.
export function dayLabel(days, d, { short = false } = {}) {
  if (!d?.day) return "";
  if ((days ?? []).filter((x) => x?.day === d.day).length > 1) return niceDate(d.date);
  return short ? cap(d.day).slice(0, 3) : cap(d.day);
}
const doors = (n, what = "door") => `${n} ${what}${n === 1 ? "" : "s"}`;
const idOf = (x) => (typeof x === "string" ? x : x?.id);

// A day's distance with how it was measured (§9.4): "11.6 road mi", "11.6 mi, estimated", "11.6 mi (some estimated)".
export function miText(d) {
  const sfx = d.source === "ors" ? "road mi" : d.source === "mixed" ? "mi (some estimated)" : "mi, estimated";
  return `${(d.mi ?? 0).toFixed(1)} ${sfx}`;
}

// When a day leaves later than its window opens (F4: its first room opens later): "Leave 3:40 pm from East Austin ·
// E Cesar Chavez"; null when the day leaves at the window's start (or has no stops).
export function leaveText(d, startLabel = "your start") {
  if (!d?.stops?.length || !Number.isFinite(d.leave) || !(d.leave > d.from)) return null;
  return `Leave ${clock12(d.leave)} from ${startLabel}`;
}

// "#3 of 55 on Your list", one or several drinker brands (Jard 10-24: one rank, one wording on every screen; "Doors'
// merged list" told the rep how the list was built, and Your list makes no claim it is Qloo's own order).
export function rankLabel(plan, id) {
  const k = plan.pool?.ids?.indexOf(id) ?? -1;
  if (k < 0) return plan.venues?.[id]?.contact ? "not on the ranked list" : "";
  return `#${k + 1} of ${plan.pool.N} on Your list`;
}

// R9 polish (judge walkthrough 3): Qloo's affinity for a ranked door beside its rank, against the list's #1 (core.affinityGap):
// "affinity 0.90, 0.01 below #1"; "" for a door off the ranked list or without an affinity row.
export function rankAffinity(plan, routes, id) {
  const k = plan.pool?.ids?.indexOf(id) ?? -1;
  if (k < 0) return "";
  return affinityGap({ affinity: affinityOf(routes, id)?.affinity, top: affinityOf(routes, plan.pool.ids[0])?.affinity, rank: k + 1, merged: isMerged(plan.profile) });
}

// A row's rank in plain words (Jard 10-23: "Near-level with #1 · #14 of 192 · affinity 0.92" and "affinity 0.80, 0.12
// below #1" read as noise): "#14 of 192 on Your list" (Jard 10-24: one wording), and where Qloo scores it within NEAR_LEVEL of #1, "… · nearly tied
// with #1" (judge pass 2 (14): a rank alone overstates precision). No decimals on a row: the stop and room pages keep
// Qloo's affinity numbers (stopmodel affText, rankAffinity). who: "… for Athletic Brewing drinkers" (the map's card).
export function rankLine(plan, routes, id, { who = "" } = {}) {
  const rk = rankLabel(plan, id) + (who && rankLabel(plan, id) ? ` for ${who}` : "");
  if (!rk || (plan.pool?.ids?.indexOf(id) ?? -1) < 0) return rk;
  return `${rk}${rankTier(plan, routes, id) === "near-level with #1" ? ` · ${NEAR_TIE}` : ""}`;
}
export const NEAR_TIE = "nearly tied with #1";

// Ease audit 10-23 #6 (both personas: "Qloo rank #9 of 55" says nothing at the door): a row says why the door is worth
// a stop, from Qloo's own profile of it, not its rank. Who drinks there (Qloo's crowd text, cut to its groups, else
// its top two interests), and "Serves NA" where Qloo lists non-alcoholic drinks and the rep sells one. The rank
// stays on Your list's pins and in Why this door. "" when Qloo has neither. avoid: names never to print.
const PEOPLES = /\b(american|british|irish|english|scottish|italian|french|spanish|mexican|latin|japanese|chinese|korean|thai|vietnamese|indian|greek|german|belgian|basque|cajun|creole|cuban|caribbean|mediterranean|asian|european|texan|texas|tex-mex|southern|nordic|polish|ethiopian|peruvian|brazilian|argentinian|filipino|hawaiian|middle eastern|lebanese|turkish|persian|oaxacan)\b/g;
export function doorReason(plan, id, { avoid = [] } = {}) {
  const v = plan?.venues?.[id];
  if (!v || v.source === "manual") return "";
  let who = crowdPhrase(v, avoid)?.text?.replace(/^(your regulars are|you draw)\s+/i, "") ?? "";
  // a dangling "ranging from locals" tail goes; a cut that ends mid-phrase ("a local neighborhood crowd, specifically
  // those") or runs long keeps its first group only
  who = who.replace(/,?\s+ranging\b.*$/i, "");
  if (/\b(those|who|that|of|the|a|an|and|with|from|specifically)$/i.test(who) || who.length > 60) who = who.split(/,|\s+and\s+/)[0].replace(/\s+\b(specifically|particularly|mainly|mostly)\b.*$/i, "").trim();
  // the row says "Crowd:" already: "energetic crowd of young professionals" → "young professionals", "young adult
  // crowd" → "young adult", "a diverse mix of local families" → "local families"
  who = who.replace(/^(an?\s+)?([\w'-]+,?\s+){0,4}?(crowd|clientele|mix|blend|base)\s+of\s+/i, "").replace(/^(a|an)\s+/i, "").trim();
  // "young adult crowd", "a vibrant, young and diverse crowd": with "crowd" cut it reads broken ("Crowd: young adult",
  // persona rep), so those use the interests instead
  if (/\s(crowd|clientele)$/i.test(who) || who.split(/\s+/).length < 2 || who.length > 60) who = "";
  if (!who) {
    // Qloo's interest tags are Title Case ("Craft beer", "British pub culture"): lower-case, names of peoples kept
    let ints = (v.tags?.interests ?? []).filter((t) => typeof t === "string" && t.trim()).slice(0, 2).map((t) => t.trim().toLowerCase().replace(PEOPLES, (w) => cap(w)));
    if (ints.some((t) => / and /.test(t))) ints = ints.slice(0, 1); // "interior design and architecture" and … reads as a list of three
    who = ints.length ? `into ${ints.join(" and ")}` : "";
  }
  const na = isNA(plan.profile?.what) && (v.tags?.bev ?? []).some((t) => /non[- ]?alcoholic|mocktail|zero[- ]proof/i.test(String(t)));
  return [who ? `Crowd: ${who}` : "", na ? "Serves NA" : ""].filter(Boolean).join(" · ");
}
// judge pass 2 (14): the tier a rank sits in (core.matchTier), "" when none. Judge pass 4 (#12): on a flat list
// (flatList) "near-level with #1" is left out: it was on nearly every row (#44, #59…), so Your list says it once
export function rankTier(plan, routes, id) {
  const k = plan.pool?.ids?.indexOf(id) ?? -1;
  if (k < 0) return "";
  const t = matchTier({ affinity: affinityOf(routes, id)?.affinity, top: affinityOf(routes, plan.pool.ids[0])?.affinity, rank: k + 1, merged: isMerged(plan.profile) });
  return t === "near-level with #1" && flatList(plan, routes) ? "" : t;
}
// Judge pass 4 (#12): a list where at least half the ranked rooms sit within NEAR_LEVEL of #1 (LaCroix × Chicago: 84
// of 96) ranks on a weak signal; FLAT_NOTE says so once instead of a tier on every row.
const flatSeen = new WeakMap();
export function flatList(plan, routes) {
  const ids = plan?.pool?.ids ?? [];
  if (ids.length < 10 || isMerged(plan.profile)) return false;
  if (flatSeen.has(plan.pool)) return flatSeen.get(plan.pool);
  const top = affinityOf(routes, ids[0])?.affinity;
  const near = typeof top === "number" ? ids.filter((id) => { const a = affinityOf(routes, id)?.affinity; return typeof a === "number" && top - a < NEAR_LEVEL; }).length : 0;
  const flat = near * 2 >= ids.length;
  flatSeen.set(plan.pool, flat);
  return flat;
}
export const FLAT_NOTE = `Qloo scores most of these doors nearly the same as #1, so their order is a weak signal here; where the day's route runs matters more.`;

// …and in a map card's few words, beside its "#14 of 192": "nearly tied with #1", or "" (Jard 10-23: no decimals, no
// "top 10" beside a #8)
export function rankAffinityShort(plan, routes, id) {
  return rankTier(plan, routes, id) === "near-level with #1" ? NEAR_TIE : "";
}

// The planner's reasons (F1), when it gives them: why a scheduled stop sits where it does (`stop.orderReason`, "opens
// 3 pm"), and why a ranked room isn't on a day (`plan.reasons[id] = {code, text, date?, mi?}`, "opens 5 pm, after your
// window"). Code "status" (a door the rep marked) is left out: the row's status tag already says it.
// persona (founder) + judge passes 5 (#9) and 6 (#3): a stop reached soon after its room opens says when it opened
// ("open till 2 am" beside a bare "just opened" read as wrong). stop: a planned stop ({eta, justOpened}). → text | null
// audit 2 #10b: small chip words ("opened 3 pm: setup time, keep it short" was a sentence on a chip)
export const justOpenedTag = (s) => (s?.justOpened != null && Number.isFinite(s.eta) ? "Just after opening: keep it short" : null);
// A day's progress line. Visits logged before the day starts (frozen, begun false) read "2 of 10
// visited · the day keeps its plan until it starts", a contradiction; they are logged early, and the rest keep times.
// Nothing logged yet on a day that hasn't started is plain "0 of N visited" (it read "0 logged early").
export function progressLine(d, visited) {
  if (d?.frozen && d.begun === false && visited > 0) return `${visited} logged early · the rest keep their times until the day starts`;
  return `${visited} of ${d?.stops?.length ?? 0} visited${d?.frozen && d.begun !== false ? " · the rest of the day re-routes from your last visit" : ""}`;
}
export const orderReason = (s) => (typeof s?.orderReason === "string" && s.orderReason.trim()) || null;
export function restReason(plan, id) {
  const r = plan.reasons?.[id];
  const text = typeof r === "string" ? r : r?.code === "status" ? null : r?.text;
  if (!(typeof text === "string" && text.trim())) return null;
  // judge pass 3 (N14): a full day said short ("Wednesday is full", "a better-ranked door took Thursday's slot"); that a
  // day under way keeps its stops is said once, in Your list's header (underwayNote), not on every row
  const m = /^(\w+day|[A-Z][a-z]{2} [A-Z][a-z]{2} \d{1,2}|the day) (had no time left for it|has room for it only in place of (a stop nearer its route|a better-ranked stop, for the same driving|a stop it already had \(a re-plan keeps a day's stops\)))$/.exec(text.trim());
  if (!m || typeof r !== "object") return text;
  const day = m[1];
  const s = day === "the day" ? "the day's" : `${day}'s`;
  return r.code === "nearer" ? `doors nearer ${s} route took its slots` : r.code === "better" ? `a better-ranked door took ${s} slot` : `${day} is full`;
}
// "Tuesday is under way, so it keeps its stops." (judge pass 3, N14), or null with no day under way or one day only.
// A day kept for a visit logged early isn't under way until it starts (F9: begun false).
export function underwayNote(plan) {
  const cur = (plan?.days ?? []).find((d) => d?.frozen && !d.past && d.begun !== false);
  if (!cur?.day || (plan.days ?? []).length < 2) return null;
  return `${cur.day[0].toUpperCase()}${cur.day.slice(1)} is under way, so it keeps its stops.`;
}
export const unscheduledIds = (plan) => (plan.unscheduled ?? []).map(idOf).filter(Boolean);

// Your list (J4, owner review 5): every ranked room (plan.pool.ids, after the Rooms filter) in rank order, then the
// rep's own doors that aren't ranked (contacts, added rooms, any other door on a day), then the rooms the rep marked
// that are off the ranked list now (out of the Rooms filter, or closed), so they can still be undone. One row each:
// {id, rank (1-based or null), own (not ranked), outside (marked, off the list), pinned (a contact, added room or
// follow-up: already the rep's, so no + Add), state: "visited"|"talked"|"notfit" (the rep marked it: it stays in place,
// greyed) | "day" (on a day) | "rest" (not on a day), day (index into plan.days) and stop (1-based) when on a day (a
// return visit: its first day), reason (for a room not on a day: restReason, else a pin's planner note)}.
export function listRows(plan) {
  const at = new Map();
  (plan.days ?? []).forEach((d, i) => d?.stops?.forEach((s, k) => at.has(s.id) || at.set(s.id, { day: i, stop: k + 1 })));
  const ranked = plan.pool?.ids ?? [];
  const isRanked = new Set(ranked);
  const venues = plan.venues ?? {};
  const marked = (id) => ["visited", "talked", "notfit", "removed"].includes(plan.statuses?.[id]);
  const own = [...new Set([...Object.keys(venues).filter((id) => venues[id]?.contact || venues[id]?.added), ...at.keys()])].filter((id) => !isRanked.has(id));
  const ownSet = new Set(own);
  const outside = Object.keys(plan.statuses ?? {}).filter((id) => venues[id] && marked(id) && !isRanked.has(id) && !ownSet.has(id));
  const noteWhy = (id) => {
    const n = (plan.notes ?? []).find((x) => x.id === id && /unscheduled/.test(x.kind ?? ""));
    return n?.text?.split(" is not on the plan: ")[1]?.replace(/\.$/, "") || null;
  };
  const row = (id, rank, out = false) => {
    const on = at.get(id);
    const status = plan.statuses?.[id];
    const state = marked(id) ? status : on ? "day" : "rest";
    const v = venues[id] ?? {};
    const pinned = !!(v.contact || v.added || plan.reasons?.[id]?.pinned || plan.outcomes?.[id]?.followUp);
    return { id, rank, own: rank == null, outside: out, pinned, state, day: on?.day ?? null, stop: on?.stop ?? null, reason: state === "rest" ? restReason(plan, id) ?? noteWhy(id) : null };
  };
  return [...ranked.map((id, k) => row(id, k + 1)), ...own.map((id) => row(id, null)), ...outside.map((id) => row(id, null, true))];
}

// What a re-plan moved, in one line (Calacanis 7): "Tuesday re-planned without Hi Hat: 2 doors moved up from Wednesday, 1 new door
// from Your list · Wednesday re-planned: 1 back on Your list". The marked door itself is not
// counted. Past days are skipped. Returns null when the plans are the same. A visit out of order re-routes the current
// day once it is under way (G4): "Tuesday re-routed from Nomadic Beerworks, from 3:54 pm: 2 no longer fit and went
// back on Your list".
export function replanSummary(prev, next, { id = null, name = null } = {}) {
  if (!prev?.days || !next?.days) return null;
  const where = (plan) => {
    const m = new Map();
    plan.days.forEach((d) => d?.stops.forEach((s) => m.set(s.id, d)));
    return m;
  };
  const before = where(prev);
  const after = where(next);
  const parts = [];
  for (const d of next.days) {
    if (!d || d.past) continue;
    const old = prev.days.find((x) => x?.date === d.date);
    const oldIds = (old?.stops ?? []).map((s) => s.id).filter((x) => x !== id);
    const newIds = d.stops.map((s) => s.id).filter((x) => x !== id);
    const bits = [];
    const from = new Map(); // origin day → count
    let fresh = 0;
    for (const x of newIds) {
      if (oldIds.includes(x)) continue;
      const o = before.get(x);
      if (o) from.set(o, (from.get(o) ?? 0) + 1);
      else fresh++;
    }
    for (const [o, n] of from) bits.push(`${doors(n)} moved ${o.date > d.date ? "up " : ""}from ${cap(o.day)}`);
    if (fresh) bits.push(`${fresh} new ${fresh === 1 ? "door" : "doors"} from Your list`);
    // (judge-5 own plan): a follow-up that came off this day is named, never counted as a door gone back to the
    // list (two follow-ups at 4 pm Tuesday: one was dropped and the toast said "1 back on Your list")
    const lostFu = oldIds.filter((x) => !newIds.includes(x) && (next.notes ?? []).some((n) => n.kind === "followup-unscheduled" && n.id === x));
    for (const x of lostFu) {
      const why = (next.notes.find((n) => n.kind === "followup-unscheduled" && n.id === x).text ?? "").replace(/^[^:]*:\s*/, "").replace(/\.$/, "").replace(new RegExp(` on ${cap(d.day)}$`), "");
      parts.push({ d, text: `${(next.venues ?? prev.venues)?.[x]?.name ?? "A door"}'s follow-up came off ${cap(d.day)}${why ? `: ${why}` : ""}` });
    }
    const dropped = oldIds.filter((x) => !after.has(x) && !lostFu.includes(x)).length;
    const at = d.stops.findIndex((x) => x.id === id);
    const routed = d.frozen && name && old && at >= 0 && old.stops.findIndex((x) => x.id === id) > at; // the visit moved up
    if (dropped) bits.push(routed ? `${dropped} no longer fit and came off the day` : `${dropped} off the day`);
    if (!bits.length && !routed && oldIds.length && oldIds.join() !== newIds.join() && oldIds.length === newIds.length) bits.push("same doors, new order");
    const left = id && name && old?.stops.some((x) => x.id === id) && !d.stops.some((x) => x.id === id);
    // the planner says when the rest re-routes from (schedule.js "rerouted" note; a day not started keeps its plan, F9)
    const how = (next.notes ?? []).find((n) => n.kind === "rerouted" && n.date === d.date && n.id === id);
    const head = how?.mode === "now" ? `${cap(d.day)} re-routed from ${name}, from ${clock12(how.at)}` : `${cap(d.day)} re-routed from ${name}`;
    if (routed) parts.push({ d, text: `${head}${bits.length ? `: ${bits.join(", ")}` : ""}` });
    else if (bits.length) parts.push({ d, text: `${cap(d.day)} re-planned${left ? ` without ${name}` : ""}: ${bits.join(", ")}` });
  }
  // the marked door's day leads
  const home = id ? before.get(id) : null;
  parts.sort((a, b) => (b.d.date === home?.date) - (a.d.date === home?.date) || a.d.date.localeCompare(b.d.date));
  if (!parts.length) {
    if (id && home && !after.has(id) && !home.past) return `${name ?? "That door"} is off ${cap(home.day)}; nothing else moved.`;
    return null;
  }
  return parts.map((p) => p.text).join(" · ");
}

// judge pass 9 #4: "finish by 4" says which doors came off that day and where each went, as running late does:
// "Foxy's, Idle Hands, Hold Out and Lazarus back on Your list, Kinda Tropical moved to Wednesday". "" when none came
// off. skip: doors the same re-plan skipped on purpose (said on their own).
export function offDayText(prev, next, date, { skip = [] } = {}) {
  const was = (prev?.days ?? []).find((d) => d?.date === date);
  const now = (next?.days ?? []).find((d) => d?.date === date);
  if (!was) return "";
  const venues = next?.venues ?? prev?.venues ?? {};
  const name = (x) => venues[x]?.name ?? null;
  const ids = was.stops.map((s) => s.id).filter((x) => name(x) && !skip.includes(x) && !(now?.stops ?? []).some((s) => s.id === x));
  const dayOf = (x) => (next?.days ?? []).find((d) => d && !d.past && d.stops.some((s) => s.id === x));
  const list = (xs) => (xs.length > 5 ? `${xs.slice(0, 4).join(", ")} and ${xs.length - 4} more` : xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : xs[0]);
  const free = ids.filter((x) => !dayOf(x)).map(name);
  const moved = new Map();
  for (const x of ids.filter(dayOf)) moved.set(cap(dayOf(x).day), [...(moved.get(cap(dayOf(x).day)) ?? []), name(x)]);
  return [...(free.length ? [`${list(free)} back on Your list`] : []), ...[...moved].map(([d, xs]) => `${list(xs)} moved to ${d}`)].join(", ");
}
// replanSummary without the "<Day> re-planned: N off the day" part an offDayText already named
export const withoutOffCount = (sum, day) => (sum ?? "").split(" · ").filter((t) => t && !new RegExp(`^${cap(day ?? "")} re-planned: \\d+ off the day$`).test(t)).join(" · ");

// Other brands' drinkers in your rooms (Compare brands folded into Why these rooms, Calacanis 8 · Diolosa 6).
// strip = data/strip/<city>.json ({brands: {key: {ids: top 50}}}); base = your top-50 room ids (the merged list with 2+
// drinkers); brands = index.brands; mine = your drinker brand keys (left out). One sentence per other brand, most
// shared first: "Liquid Death drinkers share 22 of these 50 rooms."
export function overlapLines({ strip, base, brands = [], mine = [] }) {
  if (!strip?.brands || !base?.length) return [];
  const n = Math.min(50, base.length);
  return brands
    .filter((b) => strip.brands[b.key] && !mine.includes(b.key))
    .map((b) => ({ key: b.key, name: b.name, n: overlap(strip.brands[b.key].ids, base.slice(0, 50)) }))
    .sort((a, b) => b.n - a.n || a.name.localeCompare(b.name))
    .map((x) => ({ ...x, text: `${x.name} drinkers share ${x.n} of these ${n} doors.` }))
    // five "share 0 of 50" rows read as broken: name the brands with overlap, then one line for the rest (R2 Calacanis 17)
    .reduce((out, x, _, all) => {
      if (x.n > 0) out.push(x);
      else if (!out.some((y) => y.key === "none")) {
        const zero = all.filter((y) => y.n === 0).map((y) => y.name);
        out.push({ key: "none", name: null, n: 0, names: zero, text: `No overlap with ${zero.length > 1 ? `${zero.slice(0, -1).join(", ")} or ${zero.at(-1)}` : zero[0]}: a different crowd.` });
      }
      return out;
    }, []);
}

// The Week head: unique doors, plus the return visits of follow-ups (the same door on a second day; R2 L1).
// "18 doors over 3 days, plus 1 return visit"
export function weekCount(days = []) {
  const all = days.flatMap((d) => d?.stops?.map((s) => s.id) ?? []);
  const unique = new Set(all).size;
  const back = all.length - unique;
  return `${unique} door${unique === 1 ? "" : "s"} over ${days.length} day${days.length === 1 ? "" : "s"}${back ? `, plus ${back} return visit${back === 1 ? "" : "s"}` : ""}`;
}
// Judge pass 4 (#15): the building steps count ranked doors ("21 open when you're free") and then every door ("22 doors
// over 3 days"); the doors on the days that aren't on the ranked list (her contact, rooms she added) say themselves:
// "+ BBG's, your contact" | "+2 contacts" | "+2 of your own" | "" (none). Judge 10: "+1 contact" didn't say which door
export function ownExtra(plan) {
  const ranked = new Set(plan?.pool?.ids ?? []);
  const own = [...new Set((plan?.days ?? []).flatMap((d) => d?.stops?.map((s) => s.id) ?? []))].filter((id) => !ranked.has(id));
  if (!own.length) return "";
  const contacts = own.every((id) => plan.venues?.[id]?.contact);
  const one = own.length === 1 ? plan.venues?.[own[0]]?.name : null;
  if (one) return `+ ${one}, ${contacts ? "your contact" : "your own"}`;
  return `+${own.length} ${contacts ? `contact${own.length === 1 ? "" : "s"}` : "of your own"}`;
}
// The carry-over notice: carried doors go back into the pool (they keep their rank and win ties only; R2 L2).
// ease audit 3 #10f: "They're back in the pool" (one door: "they"; "the pool" is the planner's word) → Your list, by count
export const carryText = (text, names) => `${text}: ${names}. ${/^1 door\b/.test(text) ? "It's" : "They're"} back on Your list for your next days.`;
