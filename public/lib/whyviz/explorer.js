// WHY-VIZ-SPEC §4.1 Match × your variables: one dot per place Qloo ranked for the drinker in this city (Your list's
// candidates plus the big names). Up: match (Qloo affinity, no numbers on the picture), or, with an age band picked,
// the rank Qloo gives each door for that band. Across: how well known (popularity), Qloo rating, or distance from the
// day's start. Every dot's fate comes from the sieve: today's (lib/sieve.js over the open plan) or, while a change is
// tried, the preview's (the real planner on a scratch profile, lib/whatif.js + ui/plan.js previewChange). Pure: no DOM.
//
// explorerModel({sv, plan, profile, routes, famous, state, preview, start, cityName})
//   state:   {x: "pop" | "rating" | "km", band: null | ageKey, rooms: [roomKey], famous: bool, r45: bool}
//   preview: null | {pool: [id], plan: the scratch plan ({days}), sv: sieve over it, diff: whatif.js planDiff}
//   start:   {lat, lon, label} | null (the current day's start; "km" needs it)
// → {dots, N, E, top, bigTop, plan, listIn, listOut, planOut, planIn, moved, miles, under, changed, nothing, band,
//    bandLabel, bandOf, bands, xmode, who, city, famousOn, table, words}
// Honesty (§2.5): what qualifies is Your list as the planner builds it (an age band re-ranks the list, it doesn't
// shorten it: doors off that band's page sit faded on the bottom row and stay on Your list); what comes off or joins
// the plan is the planner's own diff, never a guess made here.
import { ageChoices } from "../profile.js";
import { popWords } from "../core.js";
import { placeFate, whereOn, codeLabel } from "../sieve.js";
import { explorerWords } from "./words.js";

export const X_MODES = ["pop", "rating", "km"];
const KM_PER_MI = 1.609344;
// road-free distance in km between a place and the start
export const kmFrom = (p, c) => Math.hypot((p.lat - c.lat) * 111, (p.lon - c.lon) * 111 * Math.cos((c.lat * Math.PI) / 180));

// The x axis for a mode: domain, tick marks [[value, label]], the axis label. km: "10 mi … start", the far end a
// round number of miles that holds every dot.
export function xMode(key, { cityName = "the city", start = null, maxKm = 0 } = {}) {
  if (key === "rating") return { key, label: "Qloo rating →", shortLabel: "Qloo rating →", dom: [2.8, 5], ticks: [[3, "3.0"], [3.5, "3.5"], [4, "4.0"], [4.5, "4.5"], [5, "5.0"]], short: [[3, "3.0"], [4, "4.0"], [5, "5.0"]] };
  if (key === "km") {
    const mi = Math.max(2, Math.ceil(maxKm / KM_PER_MI / 2.5) * 2.5); // 2.5-mile steps
    const far = mi * KM_PER_MI;
    const where = start?.label ? `${start.label}` : "your start";
    const ticks = [[far, `${trim(mi)} mi`], [far * 0.75, trim(mi * 0.75)], [far * 0.5, `${trim(mi * 0.5)} mi`], [far * 0.25, trim(mi * 0.25)], [0, "start"]];
    return { key, label: `← miles from ${where}, the day's start, as the crow flies`, shortLabel: "← miles from the day's start, as the crow flies", dom: [far, 0], ticks, short: [ticks[0], ticks[2], ticks[4]], start: where };
  }
  const ticks = [[0, "unknown"], [0.25, "0.25"], [0.5, "0.50"], [0.75, "0.75"], [1, "everyone knows it"]];
  return { key: "pop", label: `How well known in ${cityName} (Qloo popularity) →`, shortLabel: "How well known (Qloo popularity) →", dom: [0, 1], ticks, short: [ticks[0], ticks[2], ticks[4]] };
}
const trim = (n) => String(Math.round(n * 10) / 10);

// The age bands the data has for these drinkers: [{key, label}] (never an empty band; §4.1 States)
export function bandsOf(profile, routes = []) {
  return ageChoices(profile ?? {}).filter((a) => routes.some((r) => r?.lists?.[a.key]?.length)).map(({ key, label }) => ({ key, label }));
}
// Each door's rank on Qloo's list for a band ("#16 of 38 for 25–34"): id → {rank, of}. One drinker: the band's own
// page (roominsight.js listRank reads the same list). Two or more: the bands' pages interleaved round-robin, first
// appearance wins, as lib/pool.js mergeLists merges the full lists. A door not on the band's list has no entry.
export function bandRanks(routes, band) {
  const lists = routes.map((r) => (r?.lists?.[band] ?? []).map((x) => x[0]));
  const ids = [];
  const seen = new Set();
  for (let i = 0; lists.some((l) => i < l.length); i++) for (const l of lists) if (i < l.length && !seen.has(l[i])) (seen.add(l[i]), ids.push(l[i]));
  const m = new Map(ids.map((id, i) => [id, { rank: i + 1, of: ids.length }]));
  m.of = ids.length;
  return m;
}

export const planDays = (plan) => new Set((plan?.days ?? []).flatMap((d) => d?.stops?.map((s) => s.id) ?? []));

export function explorerModel({ sv, plan, profile, routes = [], famous = false, state = {}, preview = null, start = null, cityName = null }) {
  const st = { x: "pop", band: null, rooms: profile?.rooms ?? [], famous: !!famous, r45: false, ...state };
  const city = cityName ?? plan?.city?.name ?? "the city";
  const who = sv?.who ?? "your drinker";
  const venues = { ...(sv?.venues ?? {}), ...(plan?.venues ?? {}) };
  const listIds = plan?.pool?.ids ?? [];
  const listRank = new Map(listIds.map((id, i) => [id, i + 1]));
  const onPlan = planDays(plan);
  const famousOn = preview ? !!st.famous : !!famous;
  const prevPool = preview ? new Set(preview.pool ?? []) : null;
  const prevDays = preview ? planDays(preview.plan) : null;
  const prevFate = preview?.sv ? new Map(preview.sv.dots.map((d) => [d.id, d])) : null;
  const band = st.band && bandsOf(profile, routes).some((b) => b.key === st.band) ? st.band : null;
  const ranks = band ? bandRanks(routes, band) : null;
  const useStart = start && Number.isFinite(start.lat) && Number.isFinite(start.lon) ? start : null;

  const dots = (sv?.dots ?? []).map((d) => {
    const v = venues[d.id] ?? {};
    const km = useStart && Number.isFinite(d.lat) ? kmFrom(d, useStart) : null;
    const cur = prevFate?.get(d.id) ?? d;
    const under = st.r45 && Number.isFinite(d.rating) && d.rating < 4.5; // display filter (§9b: v1)
    // qualifies = on Your list under these settings (today's list, or the preview's), the rating filter applied
    const inList = preview ? prevPool.has(d.id) : listRank.has(d.id);
    const q = inList && !under;
    const onNow = onPlan.has(d.id);
    const onNext = preview ? prevDays.has(d.id) : onNow;
    let cls;
    if (q && onNext) cls = "plan";
    else if (q) cls = "list";
    else if (onNow && !onNext) cls = "off";
    else if (d.famous && !famousOn && !inList) cls = "big";
    else cls = "out";
    const br = ranks?.get(d.id) ?? null;
    return {
      id: d.id, name: d.name, score: d.score, rank: d.rank, famous: !!d.famous, pop: d.pop, rating: d.rating, lat: d.lat, lon: d.lon, km,
      listRank: listRank.get(d.id) ?? null, onPlan: onNow, onNext, day: d.fate === "plan" ? d.day ?? null : null, contact: !!v.contact,
      fate: cur.fate, code: cur.code ?? null, reason: cur.reason, fateText: fateText(cur, plan, famousOn), q, under, cls,
      bandRank: br?.rank ?? null, bandOf: br?.of ?? (ranks?.of ?? null), faded: !!band && !br,
    };
  });
  // a band's own page holds doors the all-ages list doesn't (Qloo ranks them for that band only): with a band picked
  // they are dots too, scored by the band's affinity, their gate from the sieve's own placeFate (never a guess)
  if (band) {
    const have = new Set(dots.map((d) => d.id));
    const prevPlan = preview ? { ...preview.plan, venues: { ...venues, ...(preview.plan?.venues ?? {}) }, statuses: plan?.statuses, pool: { ids: preview.pool } } : plan;
    const where = whereOn(prevPlan);
    const scoreOf = (id) => { for (const r of routes) { const row = (r?.lists?.[band] ?? []).find((x) => x[0] === id); if (row) return row[1]; } return null; };
    for (const [id, br] of ranks) {
      if (have.has(id)) continue;
      const v = venues[id] ?? routes.map((r) => r?.venues?.[id]).find(Boolean);
      if (!v?.name) continue;
      const inList = preview ? prevPool.has(id) : false;
      const under = st.r45 && Number.isFinite(v.rating) && v.rating < 4.5;
      const q = inList && !under;
      const onNext = where.has(id);
      const f = placeFate({ id, plan: prevPlan, profile, venues: { ...venues, [id]: v }, famous: famousOn, where });
      dots.push({
        id, name: v.name, score: scoreOf(id), rank: null, famous: false, pop: Number.isFinite(v.popularity) ? v.popularity : null, rating: Number.isFinite(v.rating) ? v.rating : null, lat: v.lat, lon: v.lon, km: useStart && Number.isFinite(v.lat) ? kmFrom(v, useStart) : null,
        listRank: null, onPlan: false, onNext, day: null, contact: false, fate: f.fate, code: f.code ?? null, reason: f.reason, fateText: fateText(f, prevPlan, famousOn), q, under, cls: q && onNext ? "plan" : q ? "list" : "out",
        bandRank: br.rank, bandOf: br.of, faded: false, bandOnly: true,
      });
    }
  }
  const byId = new Map(dots.map((d) => [d.id, d]));
  const top = listIds.map((id) => byId.get(id)).find(Boolean) ?? null;
  if (top) {
    const listDots = listIds.map((id) => byId.get(id)).filter((d) => d && Number.isFinite(d.pop)).sort((a, b) => b.pop - a.pop);
    top.popRank = listDots.findIndex((d) => d.id === top.id) + 1 || null;
  }
  const best10 = [...dots].sort((a, b) => b.score - a.score).slice(0, 10);
  const bigTop = best10.filter((d) => d.famous).length;
  const planDots = dots.filter((d) => d.onPlan);
  const byRank = (a, b) => (a.listRank ?? 1e9) - (b.listRank ?? 1e9);
  const E = dots.filter((d) => d.q);
  // Your list: who joins it and who leaves it with these settings (the preview's pool against today's)
  const listIn = E.filter((d) => !listRank.has(d.id)).sort((a, b) => b.score - a.score);
  const listOut = dots.filter((d) => listRank.has(d.id) && !d.q).sort((a, b) => (b.onPlan ? 1 : 0) - (a.onPlan ? 1 : 0) || byRank(a, b));
  // the plan: the planner's own diff (lib/whatif.js planDiff): doors off a day, doors onto a day, doors moved, miles
  const diff = preview?.diff ?? null;
  const planOut = (diff ? diff.out.map((x) => byId.get(x.id)).filter(Boolean) : []).sort(byRank);
  const planIn = (diff ? diff.inn.map((x) => byId.get(x.id)).filter(Boolean) : []).sort((a, b) => b.score - a.score);
  const moved = diff?.moved?.length ?? 0;
  const miles = diff ? Math.round((diff.mi[1] - diff.mi[0]) * 10) / 10 : 0;
  const under = st.r45 ? dots.filter((d) => d.under && (listRank.has(d.id) || (preview && prevPool.has(d.id)))).length : 0;
  const changed = !!preview || st.r45 || !!band;
  const nothing = !!preview && !listIn.length && !listOut.length && !planOut.length && !planIn.length && !moved;
  const bands = bandsOf(profile, routes);
  const maxKm = Math.max(0, ...dots.map((d) => d.km ?? 0));
  const xmode = xMode(st.x === "km" && !useStart ? "pop" : st.x, { cityName: city, start: useStart, maxKm });
  const extras = (sv?.extras ?? []).map((e) => ({ id: e.id, name: e.name, listRank: null, score: null, pop: venues[e.id]?.popularity ?? null, rating: venues[e.id]?.rating ?? null, day: e.day ?? null, extra: true }));
  const dayName = (i) => (Number.isFinite(i) ? capWord(plan?.days?.[i]?.day ?? "") : "");
  const table = [...planDots.sort((a, b) => (a.listRank ?? 1e9) - (b.listRank ?? 1e9)), ...extras].map((d) => ({ id: d.id, name: d.name, listRank: d.listRank, score: d.score, pop: d.pop, rating: d.rating, day: dayName(d.day), extra: !!d.extra }));
  const m = {
    dots, N: listIds.length, E: E.length, top, bigTop, plan: planDots, listIn, listOut, planOut, planIn, moved, miles, under, changed, nothing, previewing: !!preview,
    band, bandLabel: bands.find((b) => b.key === band)?.label ?? null, bandOf: ranks?.of ?? null, bands, xmode, who, city, famousOn, table, state: st,
  };
  m.words = explorerWords(m);
  return m;
}

const capWord = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
// the tooltip's fate line: "on your plan, Tuesday stop 6" / "closed when you're out" / "didn't fit a day's route" /
// "big name" / "not a door type you pitch" / "you already know it"
export function fateText(d, plan, famousOn = false) {
  if (!d) return "";
  if (d.fate === "plan") { const day = plan?.days?.[d.day]?.day; const n = /stop (\d+)/.exec(d.reason ?? "")?.[1]; return `on your plan${day ? `, ${capWord(day)}${n ? ` stop ${n}` : ""}` : ""}`; }
  if (d.fate === "famous") return famousOn ? "most popular, included" : "most popular, left for later";
  if (d.fate === "room") return d.code === "closed" ? "Qloo lists it as closed" : "not a door type you pitch";
  if (d.fate === "known") return "you already know it";
  if (d.fate === "open") return "closed when you're out";
  if (d.fate === "route") return "didn't fit a day's route";
  if (d.fate === "kind") return "not a bar or restaurant";
  return d.reason ? d.reason[0].toLowerCase() + d.reason.slice(1) : "";
}

// The dot's tooltip rows: name · #k of N on Your list · match (3 decimals, tooltip only) · how well known · its fate ·
// qualifies / wouldn't qualify
export function dotRows(d, m) {
  const rows = [[d.name, d.day != null && m.plan ? "" : ""]];
  rows.push([d.listRank ? `#${d.listRank} of ${m.N}` : d.famous ? "Most popular" : d.bandOnly ? `Ranked for ${m.bandLabel} drinkers only` : "Not on Your list", d.listRank ? "on Your list" : ""]);
  if (m.band) rows.push([d.bandRank ? `#${d.bandRank} of ${d.bandOf}` : "not on this age's list", `for ${m.bandLabel} drinkers`]);
  // round 3 (Jard 10-23: decimals are "super confusing"): no 0.xx; how well known in words, the match is the rank above
  rows.push([popWords(d.pop) ? popWords(d.pop)[0].toUpperCase() + popWords(d.pop).slice(1) : "—", "how well known (Qloo popularity)"]);
  if (Number.isFinite(d.rating)) rows.push([d.rating.toFixed(1), "Qloo rating"]);
  if (m.xmode.key === "km" && Number.isFinite(d.km)) rows.push([`${(d.km / KM_PER_MI).toFixed(1)} mi, as the crow flies`, `from ${m.xmode.start}`]); // §9.4: not a road distance, and it says so
  rows.push([d.fateText ? d.fateText[0].toUpperCase() + d.fateText.slice(1) : "", ""]);
  rows.push([d.q ? "Qualifies with these settings" : "Wouldn't qualify with these settings", ""]);
  return rows;
}

// ---------- round 4 #7 (Jard 10-27): why the doors off your plan are off, as filters, and the doors that remain ----------
// "what doors were dropped because they didn't fit in a day's route or my availability was not right? … a quick list
// of all the options that remain after certain filters so that i can do a quick add". The reasons are the sieve's
// gates (lib/sieve.js: the planner's own reason codes for route and open), never a guess made here. A dot counts as
// off the plan when the plan (today's, or the preview's while a change is tried) has no day for it.
export const LOGI_FATES = [
  { key: "route", label: "Didn't fit a day's route" },
  { key: "open", label: "Not open when you're out" },
  { key: "famous", label: "Most popular, left for later" },
  { key: "room", label: "Not a door type you pitch" },
  { key: "known", label: "You marked it" },
];
// m: explorerModel's output; fates: the reasons picked; codes: the planner codes picked within them (none = all of
// that reason); days / rooms: for the code labels. → {groups: [{key, label, n, on, codes: [{code, label, n, on}]}],
// doors: the dots left off for the picked reasons (on Your list first, by rank, then best match first), active}
export function logistics(m, { fates = [], codes = [], days = [], rooms = [] } = {}) {
  const off = (m?.dots ?? []).filter((d) => !d.onNext && d.fate !== "plan" && d.fate !== "kind" && Number.isFinite(d.lat) && Number.isFinite(d.lon));
  const fs = new Set(fates), cs = new Set(codes);
  const groups = LOGI_FATES.map(({ key, label }) => {
    const ds = off.filter((d) => d.fate === key);
    const by = new Map();
    for (const d of ds) { const c = d.code ?? "other"; by.set(c, (by.get(c) ?? 0) + 1); }
    const picked = [...by.keys()].filter((c) => cs.has(c));
    return { key, label, n: ds.length, on: fs.has(key), codes: [...by].map(([code, n]) => ({ code, label: codeLabel(code, { days, rooms }), n, on: !picked.length || cs.has(code) })).sort((a, b) => b.n - a.n || a.label.localeCompare(b.label)) };
  }).filter((g) => g.n);
  const pass = (d) => { const g = groups.find((x) => x.key === d.fate); if (!g?.on) return false; const picked = g.codes.filter((c) => cs.has(c.code)); return !picked.length || cs.has(d.code ?? "other"); };
  const doors = fates.length ? off.filter(pass).sort((a, b) => (a.listRank ?? 1e9) - (b.listRank ?? 1e9) || (b.score ?? -1) - (a.score ?? -1)) : [];
  return { groups, doors, active: fates.length > 0, offN: off.length };
}
// a listed door's line: "#12 on Your list · Tuesday was full" (round 5 #5, gigbot: the planner's route sentences said
// short; the rest of the sieve's reasons as they are)
const DAY_RE = /^(\w+day|[A-Z][a-z]{2} [A-Z][a-z]{2} \d{1,2}|the day) (had no time left for it|has room for it only in place of )/;
export function logiShort(d) {
  const text = typeof d?.reason === "string" ? d.reason.trim() : "";
  const m = DAY_RE.exec(text);
  if (!m) return text;
  const day = m[1] === "the day" ? "The day" : m[1];
  if (d.code === "full" || /had no time/.test(m[2])) return `${day} was full`;
  if (d.code === "nearer") return `${day}: only in place of a nearer stop`;
  if (d.code === "better") return `${day}: only in place of a better-ranked stop`;
  return `${day}: only by dropping a stop`;
}
export const logiLine = (d) => [d.listRank ? `#${d.listRank} on Your list` : d.famous ? "Most popular" : d.bandOnly ? "Ranked for this age only" : "Not on Your list", logiShort(d)].filter(Boolean).join(" · ");
