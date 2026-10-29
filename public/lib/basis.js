// "What your plan is based on" (Jard 10-23 items 2 + 7, concept B): the facts the plan is built on, as short plain
// sentences grouped by why a rep opens the screen (a door on the plan they doubt, a door that's missing, who their
// drinker is, the city, their own settings). Each fact names its doors and the fixes that apply to it; a fix is
// carried out by the existing plan actions (already know them / not a fit / add to my plan / famous doors / profile /
// Doors Agent), so the plan and Doors Agent both follow it. doorTrail() is one door's way through the six gates (the
// door card's "Why Doors picked it" row and this screen's door view say the same words). Web (ui/basis.js) and phone
// (screens/Why.tsx) render the same model. Voice (GLOSSARY.md): plain trade words, no taglines. Pure: no DOM.
import { GATES } from "./sieve.js";
import { roomsPhrase, roomOf, ROOMS } from "./profile.js";
import { genreLabel } from "./core.js";
import { travelWords } from "./travel.js";
import { dayChanges } from "./day-stop.js"; // Stop for today and running late's re-homes, each with its Undo

export const BASIS_BUTTON = "Market"; // the plan's top-bar button (one constant: Jard picked "Market" on 10-27, round 6 #5; it was "Why these doors")
export const BASIS_TITLE = BASIS_BUTTON; // the pane's own heading says what the screen is (it was "What your plan is based on")
export const WHY_DOOR = "Why this door"; // one door's view, and the stop's row that opens it (GLOSSARY #34)
export const SHOW = 2; // facts shown per group before "Show N more"

const lower = (t) => (t && !/^[A-Z][A-Z']|^Qloo|^You\b/.test(t) ? t[0].toLowerCase() + t.slice(1) : t);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
// A share in words (audit 2 #9: Why ended in counts a rep can't read): 0.47 → "about half".
export function shareWords(x) {
  if (!Number.isFinite(x)) return "some";
  return x >= 0.85 ? "nearly all" : x >= 0.6 ? "most" : x >= 0.42 ? "about half" : x >= 0.28 ? "about a third" : x >= 0.22 ? "about a quarter" : x >= 0.15 ? "about one in six" : x >= 0.08 ? "about one in ten" : "a few";
}
const and = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : xs[0] ?? "");
const list = (names, n = 3) => (names.length <= n ? join(names) : `${names.slice(0, n).join(", ")} and ${names.length - n} more`);
function join(a) {
  return a.length <= 1 ? a[0] ?? "" : `${a.slice(0, -1).join(", ")} and ${a.at(-1)}`;
}
const TYPE_WORD = { bars: "bar", breweries: "brewery or taproom", restaurants: "restaurant", cafes: "café", wine: "wine bar", quick: "counter-service place", hotel: "hotel" };
export const typeWord = (v) => TYPE_WORD[roomOf(v ?? {})] ?? "bar or restaurant";

// Fixes: what a tap does. The UI maps each kind onto a plan action:
//   status {id, status: "talked"|"notfit"|null}  · add {id}  · remove {id} (Remove from my plan)  · famous {on}  · profile (Edit profile)
//   agent {id?, prefill}  · rule {rule} (remove a talking-points rule)  · door {id} (open the door's view)
const FIX = {
  known: (id) => ({ kind: "status", id, status: "talked", label: "Already a customer" }), // GLOSSARY #44: this screen only
  notfit: (id) => ({ kind: "status", id, status: "notfit", label: "Not a fit" }),
  unmark: (id) => ({ kind: "status", id, status: null, label: "Put it back on my list" }),
  add: (id) => ({ kind: "add", id, label: "Add it to my plan" }),
  remove: (id) => ({ kind: "remove", id, label: "Remove from my plan" }), // Jard 10-24: no reason asked
  agent: (id, name) => ({ kind: "agent", id, label: "Ask", prefill: `About ${name}: ` }),
  types: () => ({ kind: "profile", label: "Change the door types I pitch" }),
  days: () => ({ kind: "profile", label: "Change my days and times" }),
};

// ctx: {sv (lib/sieve.js sieve()), cv (insights.curve), pop (insights.popularity), shared (insights.shared), crowd
// (insights.crowd), sound (insights.sound), funnel (insights.funnel), plan, profile, cityName, famous (switched in),
// hasFamous (the route has a famous page), rules ([{field, value}]), who ("Athletic Brewing drinkers")}
// → {intro, steps:[{n, label}], groups:[{key, title, facts:[fact]}], doors: Map(id → place)}
// fact: {key, text, more?, ids:[door ids], door?: id (opens its view), fixes:[fix], on?: bool (a switch's state)}
// Why's last line, web and phone: where the rankings, hours and miles come from, in words (audit 2 #9).
// captured "2026-10-08"; source = plan.source; note = the tour's own miles credit (its road matrix is baked).
export function sourcesLine(captured, source, note = null) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(captured ?? "");
  const when = m ? ` (${new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString("en-US", { month: "short", day: "numeric" })})` : "";
  return `Rankings, crowds and each door's hours from Qloo${when}. ${note && source === "ors" ? note : travelWords(source)}`;
}
// ease audit 3 #10d: "#1 of 55 on Your list for Athletic Brewing drinkers" read as if the brand were the rep's own;
// "for people who drink Athletic Brewing" says whose taste it is
export const peopleWho = (who) => String(who).replace(/^(.+) drinkers$/, "people who drink $1");

// A door's rank: its place on Your list (plan.pool.ids, after the door-type filter; planview rankLabel, the stop page
// and the agent count the same), else the Why curve's order. Qloo's raw order (sieve x) counts the restaurants and closed
// doors Your list leaves out, so it never prints as a rank. → Map(id → 1-based rank)
export function listRanks(plan, cv) {
  const ids = plan?.pool?.ids ?? (cv?.rows ?? []).map((r) => r.id);
  return new Map(ids.map((id, i) => [id, i + 1]));
}
const listN = (plan, cv) => plan?.pool?.N ?? plan?.pool?.ids?.length ?? cv?.rows?.length ?? 0;

export function basis(ctx) {
  const { sv, cv, pop, shared = [], crowd, sound, funnel, plan, profile = {}, cityName = "your city", famous = false, hasFamous = false, rules = [] } = ctx;
  const who = peopleWho(ctx.who ?? sv?.who ?? "your drinker");
  const days = plan?.days ?? [];
  // Jard 10-24 (#4 on Your list, #5 in Deep Dive): one rank everywhere, the door's place on Your list (listRanks)
  const rank = listRanks(plan, cv);
  const N = listN(plan, cv);
  const places = new Map([...(sv?.dots ?? []), ...(sv?.extras ?? [])].map((d) => [d.id, d]));
  const onPlan = [...places.values()].filter((d) => d.fate === "plan");
  const planN = onPlan.length;
  const nm = (id) => places.get(id)?.name ?? plan?.venues?.[id]?.name ?? "a door";
  const venue = (id) => plan?.venues?.[id] ?? null;
  const rk = (id) => rank.get(id) ?? null;
  const rankLine = (id) => (rk(id) ? `#${rk(id)} of ${N}` : null);

  // ease audit #6: three tiles, the middle one Your list's count (a fourth, "are bars or restaurants", read as a stats report)
  const steps = [
    { n: funnel?.ranked ?? sv?.scored ?? 0, label: "places Qloo ranked" },
    { n: N, label: `${roomsPhrase(profile.rooms ?? [])} on Your list` },
    { n: planN, label: "on your plan" },
  ];
  const intro = `Qloo ranked ${steps[0].n} places in ${cityName} by how closely their regulars' tastes match ${who}. Doors kept the ${roomsPhrase(profile.rooms ?? [])} you pitch and fit ${planN} of them into your ${plural(days.length, "day")}. Tap any line that's wrong and the plan changes.`;

  const groups = [];
  const add = (key, title, facts) => facts.filter(Boolean).length && groups.push({ key, title, facts: facts.filter(Boolean) });

  // ---------- your corrections: what you changed, each with its undo ----------
  const marked = Object.entries(plan?.statuses ?? {}).filter(([, s]) => s === "talked" || s === "notfit" || s === "removed");
  const added = (ctx.added ?? plan?.added ?? []).map((a) => a.id ?? a).filter((id) => places.has(id) || venue(id));
  add("mine", "Your corrections", [
    ...marked.map(([id, s]) => ({ key: `m-${id}`, text: `${nm(id)}: ${s === "talked" ? "you already know them" : s === "removed" ? "you removed it" : "not a fit"}.`, more: "Left off the plan.", ids: [id], door: id, fixes: [FIX.unmark(id)] })),
    ...added.map((id) => ({ key: `a-${id}`, text: `${nm(id)}: you added it.`, more: whereText(places.get(id)) ?? "", ids: [id], door: id, fixes: ctx.removable ? [FIX.remove(id)] : [] })),
    famous && hasFamous ? { key: "famous-on", text: "The most popular doors are included now.", more: "You switched them on.", ids: [], fixes: [{ kind: "famous", on: false, label: "Leave the most popular doors for later" }] } : null,
    // r2viz: the changes tried and applied on Why these doors' map (door types, age, a drinker's weight), each with Undo
    // round 4 #6: a Settings form's save (kind "profile") is one of them, undone the same way
    ...(ctx.whyChanges ?? []).map((e) => ({ key: `w-${e.id}`, text: `${e.text}.`, more: e.kind === "profile" ? "You changed this in Settings." : `You changed this on ${BASIS_BUTTON}.`, ids: [], fixes: [{ kind: "whyundo", id: e.id, label: "Undo" }] })),
    // ctx.today ("YYYY-MM-DD"): the newest of today's day-flow changes has Undo (a stop is undone the same day)
    ...dayChanges(plan, plan?.drive, ctx.today ?? null),
    ...rules.filter((r) => r.field === "rule.avoid" || r.field === "rule.term").map((r, i) => ({
      key: `r-${i}`, text: r.field === "rule.avoid" ? `Your talking points never say “${r.value}”.` : `Your talking points say “${r.value?.to}”, not “${r.value?.from}”.`, more: "Every door, every city.", ids: [], fixes: [{ kind: "rule", rule: r, label: "Remove this rule" }],
    })),
  ]);

  // ---------- doors on your plan ----------
  const planFacts = [];
  const first = onPlan.filter((d) => rk(d.id)).sort((a, b) => rk(a.id) - rk(b.id))[0];
  // ease audit #6: words, not Qloo's 0–1 numbers; those stay on the door's "Everything Qloo knows" page
  if (first) planFacts.push({ key: `p-${first.id}`, text: `${first.name} is ${rankLine(first.id)} on Your list for ${who}.`, more: `${first.reason}.`, ids: [first.id], door: first.id, fixes: doorFixes(first.id, first.name, true, !!ctx.removable) });
  const pts = new Map((pop?.pts ?? []).map((p) => [p.id, p]));
  const lesser = (pop?.missed ?? []).filter((id) => places.get(id)?.fate === "plan" && id !== first?.id).sort((a, b) => (pts.get(a)?.pop ?? 1) - (pts.get(b)?.pop ?? 1))[0];
  if (lesser) planFacts.push({ key: `p-${lesser}`, text: `${nm(lesser)} is ${rankLine(lesser)} on Your list.`, more: `Not one of the city's ${pop.n} most popular doors, so a list of the most popular would miss it.`, ids: [lesser], door: lesser, fixes: doorFixes(lesser, nm(lesser), true, !!ctx.removable) });
  for (const d of onPlan.sort((a, b) => (rk(a.id) ?? 1e9) - (rk(b.id) ?? 1e9))) {
    if (d.id === first?.id || d.id === lesser) continue;
    const r = rankLine(d.id);
    planFacts.push({ key: `p-${d.id}`, text: `${d.name}: ${r ?? (venue(d.id)?.contact ? "your contact" : venue(d.id)?.added ? "you added it" : "from another drinker's list")}.`, more: `${String(d.reason).split(" · ")[0]}.`, ids: [d.id], door: d.id, fixes: doorFixes(d.id, d.name, true, !!ctx.removable) });
  }
  add("plan", "Doors on your plan", planFacts);

  // ---------- doors left out ----------
  const outFacts = [];
  const famousOut = (sv?.dots ?? []).filter((d) => d.fate === "famous");
  // r2viz (gigbot's pick 10-24, Jard can veto): the famous doors are "Big names: come back once you have reorders"
  if (famousOut.length && hasFamous) outFacts.push({ key: "famous", text: `${plural(famousOut.length, "most popular door")} left for later: ${list(famousOut.map((d) => d.name))}.`, more: "Most popular: come back once you have reorders. Doors leaves the city's most popular doors for later, by Qloo's popularity score.", ids: famousOut.map((d) => d.id), fixes: [{ kind: "famous", on: true, label: "Include the most popular doors now" }] });
  const onList = (d) => (rankLine(d.id) ? `${d.name} is ${rankLine(d.id)} on Your list` : `Qloo ranks ${d.name} for ${who}`);
  const best = (fate, test = () => true) => (sv?.dots ?? []).filter((d) => d.fate === fate && !d.famous && test(d)).sort((a, b) => a.x - b.x);
  const room = best("room", (d) => ROOMS.some((r) => r.key === d.code));
  if (room.length) {
    const d = room[0];
    outFacts.push({ key: `o-${d.id}`, text: `Qloo ranks ${d.name} for ${who}, but it's a ${typeWord(d.venue ?? venue(d.id) ?? ctx.venues?.[d.id])} and you pitch ${roomsPhrase(profile.rooms ?? [])}.`, more: room.length > 1 ? `${plural(room.length - 1, "more door")} left out for the same reason.` : "", ids: room.map((x) => x.id), door: d.id, fixes: [FIX.add(d.id), FIX.types()] });
  }
  const open = best("open");
  if (open.length) {
    const d = open[0];
    outFacts.push({ key: `o-${d.id}`, text: `${onList(d)}, but it isn't open while you're out.`, more: `${d.reason}.${open.length > 1 ? ` ${plural(open.length - 1, "more door")} left out for their hours.` : ""}`, ids: open.map((x) => x.id), door: d.id, fixes: [FIX.add(d.id), FIX.days()] });
  }
  const route = best("route");
  if (route.length) {
    const d = route[0];
    outFacts.push({ key: `o-${d.id}`, text: `${onList(d)}, but it didn't fit a day's route.`, more: `${d.reason}.${route.length > 1 ? ` ${plural(route.length - 1, "more door")} didn't fit a route.` : ""}`, ids: route.map((x) => x.id), door: d.id, fixes: [FIX.add(d.id)] });
  }
  if (sv?.unscored?.n) outFacts.push({ key: "kind", text: `${plural(sv.unscored.n, "place")} Qloo ranked aren't bars or restaurants, such as ${list(sv.unscored.names, 3)}.`, more: "Doors set them aside.", ids: [], fixes: [] });
  add("out", "Doors left out", outFacts);

  // ---------- your drinker ----------
  const drink = [];
  const sh = shared.filter((r) => r.n > 0 && r.stands !== false); // insights.shared: only brands that stand out
  // in words, no counts (audit 2 #9): "Many of your best doors are also favorites of LaCroix drinkers in Austin."
  if (sh.length) drink.push({ key: "shared", text: `${sh[0].n >= 15 ? "Many" : "Some"} of your best doors are also favorites of ${sh[0].name} drinkers in ${cityName}.`, more: sh.length > 1 ? `${and(sh.slice(1, 3).map((r) => r.name))} drinkers like many of the same doors.` : "", ids: sh[0].ids ?? [], fixes: [] });
  const terms = [...(crowd?.terms ?? [])].filter((t) => t.base != null && t.ids.length >= 3 && t.share > t.base).sort((a, b) => b.share / Math.max(b.base, 0.01) - a.share / Math.max(a.base, 0.01));
  if (terms.length) {
    const t = terms[0];
    const [at, all] = [shareWords(t.share), shareWords(t.base)];
    drink.push({ key: `cr-${t.key}`, text: at !== all ? `Qloo describes the crowd at ${at} of your top doors as ${lower(t.label)}, against ${all === "a few" ? "only a few" : all} of all the doors it ranked in ${cityName}.` : `Qloo describes the crowd at your top doors as ${lower(t.label)} more often than across ${cityName}.`, more: terms.length > 1 ? `Also more common at your doors: ${terms.slice(1, 3).map((x) => lower(x.label)).join(", ")}.` : "", ids: t.ids, fixes: [] });
  }
  add("drinker", "Your drinker", drink);

  // ---------- the city ----------
  const town = [];
  if (sound?.rooms?.length >= 3 && sound.artists?.length) town.push({ key: "sound", text: `The artists Qloo links most often to your doors' crowds: ${join(sound.artists.slice(0, 3).map((a) => a.name))}.`, more: sound.genres?.length ? `Mostly ${join(sound.genres.slice(0, 3).map((g) => g.label.toLowerCase()))}, at ${plural(sound.rooms.length, "door")} with a music signal.` : "", ids: sound.artists[0].ids ?? [], fixes: [] });
  if (Number.isFinite(pop?.rho) && pop.pts.length >= 5 && Math.abs(pop.rho) < 0.2) town.push({ key: "poprho", text: `In ${cityName}, the most popular doors aren't your best fits.`, more: `Of ${pop.pts.length} doors on Your list, the most popular ones aren't the ones whose crowds match ${who}.`, ids: pop.missed ?? [], fixes: [] });
  add("city", cityName, town);

  // ---------- famous doors (the one plan setting that isn't in Settings) ----------
  // intuitiveness audit #8: door types and days read like a second Settings here (the phone's testers found them before
  // ☰ → Settings), so they are one link under the groups (SETTINGS_LINK); the famous-doors switch stays
  add("settings", "Most popular doors", [
    hasFamous ? { key: "famous", text: famous ? "The most popular doors are included." : "The most popular doors are left out.", more: "The city's most popular doors, by Qloo's popularity score.", ids: [], on: famous, fixes: [{ kind: "famous", on: !famous, label: famous ? "Leave the most popular doors out" : "Include the most popular doors" }] } : null,
  ]);

  return { intro, steps, groups, doors: places };
}

function whereText(d) {
  return d?.fate === "plan" ? `${d.reason}.` : null;
}
// rm: the screen has Remove from my plan (ctx.removable: the web's S.removeDoor; the phone's Why.tsx has no handler yet)
function doorFixes(id, name, onPlan, rm = false) {
  return onPlan ? [FIX.known(id), FIX.notfit(id), ...(rm ? [FIX.remove(id)] : []), FIX.agent(id, name)] : [FIX.add(id), FIX.agent(id, name)];
}

// The link under Why's groups (web ui/why.js, phone Why.tsx): it opens Settings.
export const SETTINGS_LINK = "Change door types or days in Settings ›";

// One door's way through the gates: {name, head, lines:[{ok, text}], fixes, say?}. d: a sieve place (dot, extra or
// look-alike); ctx as basis() plus {venues, talkFor?: (id) → the stop's {opener, toBuyer}}. The lines stop at the gate that stopped it.
export function doorTrail(d, ctx) {
  if (!d) return null;
  const { plan, cityName = "" } = ctx;
  const who = peopleWho(ctx.who ?? ctx.sv?.who ?? "your drinker");
  const v = ctx.venues?.[d.id] ?? plan?.venues?.[d.id] ?? d.venue ?? {};
  const r = listRanks(plan, ctx.cv).get(d.id);
  const N = listN(plan, ctx.cv);
  const head = d.like ? `Not on Qloo's list for ${who}. Its crowd is ${Math.round(d.score * 100)}% like ${d.like}'s.` : r ? `#${r} of ${N} on Your list for ${who}.` : d.rank ? `Qloo ranks it for ${who}. It isn't on Your list.` : d.famous ? `Qloo ranks it for ${who} only with the popularity limit off.` : v.contact ? "Your contact." : v.added ? "You added it." : `From another drinker's list.`;
  const lines = [];
  if (!d.like && !d.unscored && !v.contact && !v.added) {
    const at = d.fate === "plan" ? GATES.length : GATES.findIndex((g) => g.key === d.fate);
    const type = typeWord(v);
    // Jard web review 10-24: only lines that say something about this door. "A bar (bar)" said the type twice; the
    // famous and door-type gates it passed only said back the rep's own settings, so they show only when they stop it.
    const g = genreLabel(v).toLowerCase();
    const an = (w) => `${/^[aeiou]/.test(w) ? "An" : "A"} ${w}`;
    const ok = {
      kind: !g || g === type ? an(type) : g.includes(type) ? an(g) : `${an(type)}: ${g[0].toUpperCase()}${g.slice(1)}`,
      famous: null,
      room: null,
      known: "New to you: you haven't marked it",
      open: "Open while you're out",
      route: d.fate === "plan" ? `${d.reason}` : "Fits a day's route",
    };
    GATES.forEach((g, i) => {
      if (i < at) { if (ok[g.key]) lines.push({ ok: true, text: ok[g.key] }); }
      else if (i === at) lines.push({ ok: false, text: `${g.out}: ${lower(d.reason)}` });
    });
    if (d.fate === "plan") lines[lines.length - 1] = { ok: true, text: `On your plan: ${d.reason}` };
  } else if (d.unscored) lines.push({ ok: false, text: "Not a bar or restaurant, so Doors set it aside" });
  else if (d.fate === "plan") lines.push({ ok: true, text: `On your plan: ${d.reason}` });
  // Jard web review R2 (10-24): "What to say" is the stop's own opener and buyer line (ctx.talkFor(id) → {opener,
  // toBuyer}, from the stop's talking points), never the stored model "Looks like you get … in here" leads that
  // talk-model.js retired; no talkFor (or a door off the plan) → nothing.
  const said = d.fate === "plan" && typeof ctx.talkFor === "function" ? ctx.talkFor(d.id) : null;
  const crowd = String(v.crowd ?? d.crowd ?? "").split(/(?<=\.)\s/)[0] || null;
  const fixes = d.fate === "plan" ? doorFixes(d.id, d.name, true, !!ctx.removable)
    : v.added && ctx.removable ? [FIX.remove(d.id)] // added but no day holds it (saved before Jard 10-24's fix): take it back out
    : d.fate === "known" ? [FIX.unmark(d.id)]
    : d.fate === "famous" ? [{ kind: "famous", on: true, label: "Include the most popular doors" }, FIX.add(d.id)]
    : d.fate === "room" && ROOMS.some((x) => x.key === d.code) ? [FIX.add(d.id), FIX.types()]
    : d.unscored ? [] : [FIX.add(d.id)];
  // group 3 item 1: one plain line on why it is or isn't on the plan (the gate list goes behind "How this door was chosen")
  const last = lines.at(-1);
  const onIt = d.fate === "plan" && !d.like;
  const why = {
    title: onIt ? WHY_ON : WHY_OFF,
    text: [onIt ? `${last?.text ?? "On your plan"}.` : last && !last.ok ? `${last.text}.` : null, head].filter(Boolean).join(" ").replace(/\.\./g, ".").replace(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/g, (w) => w[0].toUpperCase() + w.slice(1)),
  };
  return { id: d.id, name: d.name, head, lines, why, say: said?.opener || null, toBuyer: said?.toBuyer || null, crowd, fixes, city: cityName };
}
export const HOW_TITLE = "How this door was chosen"; // the fold on Why this door, and the section on Everything Qloo knows
export const WHY_ON = "Why it's on your plan";
export const WHY_OFF = "Why it's not on your plan";

// "Why isn't … on my plan?": every place the screen can name, best first, for a search box → [{id, name, fate}]
export function findDoors(sv, q) {
  const t = String(q ?? "").trim().toLowerCase();
  if (t.length < 2) return [];
  const all = [...(sv?.dots ?? []), ...(sv?.extras ?? []), ...(sv?.lookalikes ?? [])];
  return all.filter((d) => d.name?.toLowerCase().includes(t)).sort((a, b) => (a.name.toLowerCase().startsWith(t) ? 0 : 1) - (b.name.toLowerCase().startsWith(t) ? 0 : 1) || (a.x ?? 1e9) - (b.x ?? 1e9)).slice(0, 8);
}

// ---------- why2 concept A (Jard's pick, 10-24): "What do you want to do?" ----------
// The screen opens on who the plan is for and four tiles, each a short way in that ends in a change to the plan. Web
// (ui/why.js) and phone (screens/Why.tsx, one pushed screen per view: params.view) render this one model.
export const WHY_ASK = "What do you want to do?";
// Jard 10-24 (A, round 1): "Doors Deep Dive"; "What doors were left off and why"; "Who likes <your drink>?" (Doors
// sells to bars and restaurants, so not "Who I'm selling to"); every tile icon, title, subtitle, button.
export const VIEWS = {
  plan: "Doors Deep Dive",
  missing: "What doors were left off and why",
  who: "Who likes your drink?",
  map: "See it on the map",
  changes: "Changes you made",
};
export const whoTitle = (profile) => (String(profile?.brand ?? "").trim() ? `Who likes ${String(profile.brand).trim()}?` : VIEWS.who);
export const MISSING_SHOW = 6; // doors shown per reason before "Show N more"
const DAY_SHORT = (d) => (d ? d[0].toUpperCase() + d.slice(1, 3) : "");

// The ways a ranked door is left out, in the order a rep can act on them, each with the one change that fixes it.
const OUT_GROUPS = [
  { fate: "route", title: "Didn't fit a day's route", fix: null },
  { fate: "open", title: "Closed when you're out", fix: () => FIX.days() },
  { fate: "famous", title: "Most popular doors, left out", fix: () => ({ kind: "famous", on: true, label: "Include the most popular doors" }) },
  { fate: "room", title: "A door type you don't pitch", fix: () => FIX.types() },
];

// ctx: basis()'s ctx (sv from the merged route), b: basis(ctx), cr: crowds() or null, startWith: the crowd key the
// first day starts with (or null). → {who:{title, sub}, tiles:[{key, title, line}], days, missing, crowds, facts, changes}
//   days: [{label, doors:[{id, name, line}]}] the plan's doors by day; missing: [{key, title, n, fix, doors:[{id, name,
//   reason, fix}]}]; crowds: {shared, groups:[{key, label, n, examples, fix}]} | null (only when the crowds differ);
//   facts: the drinker and city facts (basis groups "drinker" and the city); changes: basis group "mine"'s facts.
export function whyHome(ctx, b, cr = null, startWith = null) {
  const { sv, plan, profile = {}, cityName = "your city", hasFamous = false } = ctx;
  const days = (plan?.days ?? []).filter((d) => d && !d.past && d.stops?.length);
  const onPlan = days.reduce((t, d) => t + d.stops.length, 0);
  const drinks = (profile.drinks ?? []).map((d) => d.name).filter(Boolean);
  const who = {
    title: drinks.length ? `${drinks.join(" + ")} drinkers` : String(sv?.who ?? "Your drinker").replace(/^./, (c) => c.toUpperCase()),
    sub: [cityName, plural(onPlan, "door"), days.map((d) => DAY_SHORT(d.day)).filter((x, i, a) => a.indexOf(x) === i).join(", ")].filter(Boolean).join(" · "),
    // the Who tile's answer: "People who also drink Heineken and Bud Light."
    people: drinks.length ? `People who also drink ${drinks.length > 1 ? `${drinks.slice(0, -1).join(", ")} and ${drinks.at(-1)}` : drinks[0]}.` : `${String(sv?.who ?? "Your drinker").replace(/^./, (c) => c.toUpperCase())}.`,
  };
  const facts = b.groups.filter((g) => g.key === "drinker" || g.key === "city").flatMap((g) => g.facts);
  const changes = b.groups.find((g) => g.key === "mine")?.facts ?? [];

  const place = (id) => b.doors.get(id);
  const ranks = listRanks(plan, ctx.cv);
  const dayList = days.map((d) => ({
    label: `${d.day[0].toUpperCase()}${d.day.slice(1)}`,
    date: d.date,
    doors: d.stops.map((s, i) => {
      const p = place(s.id);
      const v = plan.venues?.[s.id] ?? {};
      const r = ranks.has(s.id) ? `#${ranks.get(s.id)} on Your list` : v.contact ? "Your contact" : v.added ? "You added it" : "From the other drink's list";
      return { id: s.id, n: i + 1, name: v.name ?? p?.name ?? "A door", line: r };
    }),
  }));

  // "missing" is the doors Qloo ranks above the plan's lowest-ranked door (or its top 20 with no ranked door on the
  // plan): better fits than one already on it, not the list's long tail
  const planX = (sv?.dots ?? []).filter((d) => d.fate === "plan" && !d.famous).map((d) => d.x);
  const cut = planX.length ? Math.max(...planX) : 20;
  const dots = (sv?.dots ?? []).filter((d) => !d.like && d.x < cut);
  const missing = OUT_GROUPS.filter((g) => g.fate !== "famous" || hasFamous).map((g) => {
    const ds = dots.filter((d) => d.fate === g.fate && (g.fate === "famous" || !d.famous)).sort((a, z) => a.x - z.x);
    return { key: g.fate, title: g.title, n: ds.length, fix: g.fix ? g.fix() : null, doors: ds.map((d) => ({ id: d.id, name: d.name, reason: d.reason, fix: FIX.add(d.id) })) };
  }).filter((g) => g.n);
  const nOut = missing.reduce((t, g) => t + g.n, 0);

  let crowds = null;
  if (cr?.distinct) {
    const planIds = new Set(days.flatMap((d) => d.stops.map((s) => s.id)));
    crowds = {
      shared: cr.shared,
      groups: cr.crowds.map((c) => {
        const mine = c.ids.filter((id) => planIds.has(id));
        const label = c.roomWord ? `${c.roomWord[0].toUpperCase()}${c.roomWord.slice(1)}: ${c.name} drinkers` : `${c.name} drinkers`;
        const on = startWith === c.key;
        return { key: c.key, label, name: c.name, room: c.room, n: mine.length, examples: mine.slice(0, 3).map((id) => plan.venues?.[id]?.name ?? place(id)?.name).filter(Boolean), on,
          fix: on ? { kind: "startWith", key: null, label: "Mix the crowds again" } : { kind: "startWith", key: c.key, label: `Start with ${c.roomWord ?? `${c.name}'s doors`}` } };
      }),
    };
  }
  const shareLine = crowds ? `Two crowds: ${crowds.groups.map((g) => g.name).join(" and ")} drinkers go to ${crowds.shared ? `mostly different doors (${crowds.shared} of their top 50 shared)` : "different doors"}.` : null;

  const refine = "Add new doors, refine how Doors chooses what's right for your brand.";
  const tiles = [
    { key: "plan", title: VIEWS.plan, line: onPlan ? `${plural(onPlan, "door")}. Tap one to see why it's there.` : "No doors on a day yet.", go: "See the doors" },
    { key: "missing", title: VIEWS.missing, line: nOut ? `${plural(nOut, "door")}. ${refine}` : refine, go: "See them" },
    { key: "who", title: whoTitle(profile), line: who.people, go: "See and edit" },
    { key: "map", title: VIEWS.map, line: `Your ${plural(onPlan, "door")}${nOut ? ` and the ${nOut} left off` : ""}.`, go: "Open the map" },
  ];
  return { who, tiles, days: dayList, missing, crowds, shareLine, facts, changes, nOut, onPlan };
}
