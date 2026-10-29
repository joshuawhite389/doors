// WHY-VIZ-SPEC §2.1, §7: the sentence above each picture, plain words, every number from the picture's model. One
// function per picture; the shared helpers first. A sentence is a list of parts: a string, or {t, cls} for a bold
// span (cls "big" = the big-names amber, else the plan green). ui/viz-dom.js sayHTML renders the parts. Pure: no DOM.
import { clock12, toMinutes } from "../profile.js";

export const and = (xs) => (xs.length <= 1 ? xs[0] ?? "" : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
export const lower = (s) => (s && !/^[A-Z][A-Z']|^Qloo|^You\b/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
// "1st", "2nd", "17th", "23rd"
export const ordinal = (n) => { const v = n % 100; return `${n}${v >= 11 && v <= 13 ? "th" : ["th", "st", "nd", "rd"][Math.min(n % 10, 4)] ?? "th"}`; };
// "Oddwood Brewing, WhichCraft and Foxy's and 11 more"
export const nameList = (xs, k = 3, name = (x) => x.name) => and(xs.slice(0, k).map(name)) + (xs.length > k ? ` and ${xs.length - k} more` : "");
// the sentence's parts as one plain string (tests, aria labels)
export const plain = (parts) => parts.map((p) => (typeof p === "string" ? p : p.t)).join("");
// no empty parts, no trailing space
export const tidy = (parts) => { const out = parts.filter((p) => p !== ""); const last = out.at(-1); if (typeof last === "string") out[out.length - 1] = last.replace(/\s+$/, ""); return out; };

// When the rep is out, in words: "Tue 1–6 pm, Wed and Thu 2–5 pm" (was lib/whystory.js windowsWords)
export function windowsWords(plan) {
  const ws = (plan?.days ?? []).filter((d) => d && !d.past).map((d) => ({ d: cap(String(d.day ?? "")).slice(0, 3), t: `${shortTime(d.from)}–${shortTime(d.to)}` }));
  const by = new Map();
  for (const w of ws) by.set(w.t, [...(by.get(w.t) ?? []), w.d]);
  return [...by].map(([t, ds]) => `${and([...new Set(ds)])} ${t}`).join(", ");
}
export const shortTime = (m) => clock12(typeof m === "number" ? m : toMinutes(m) ?? 0).replace(":00", "");

// ---------- 4.1 Match × your variables ----------
// m: explorerModel's output. Default (no change tried): the #1 door, how well known it is, how many of the ten best
// matches are big names. Changed: what qualifies, what falls off the plan, what would join, what the axis now means.
export function explorerWords(m) {
  const { who, city, N, top, plan, bigTop, famousOn, changed, E, listIn, listOut, planOut, planIn, moved, miles, under, band, bandLabel, nothing, previewing } = m;
  if (!changed) {
    if (!top) return [`Qloo ranked no doors in ${city} for ${who} yet.`];
    const parts = [{ t: top.name }, ` is #1 of ${N} for ${who}`];
    parts.push(top.popRank ? ` and only the ${ordinal(top.popRank)} most popular door on Your list. ` : `. `);
    if (bigTop > 0 && !famousOn) parts.push({ t: `${bigTop} of the 10 best matches in ${city} are among the city's most popular doors`, cls: "big" }, `, past the line and off the plan. `);
    else if (bigTop > 0) parts.push({ t: `${bigTop} of the 10 best matches in ${city} are among the city's most popular doors`, cls: "big" }, `, included now. `);
    parts.push(`The plan lives in the open corner: loved by your drinker, not yet crowded with reps.`);
    return parts;
  }
  const parts = [`With these settings `, { t: `${plural(E, "door")} qualify for Your list` }, ` (today: ${N}). `];
  if (nothing) parts.push(`Your plan keeps the same doors on the same days. `);
  else if (previewing) {
    if (listIn.length) parts.push(`${listIn.length} would join it, best match first: ${nameList(listIn)}. `);
    if (listOut.length) parts.push(`${listOut.length} ${listOut.length === 1 ? "leaves" : "leave"} it: ${nameList(listOut)}. `);
    if (planOut.length) parts.push({ t: `${planOut.length} of your ${plan.length} plan doors ${planOut.length === 1 ? "comes" : "come"} off`, cls: "big" }, `: ${nameList(planOut)}. `);
    if (planIn.length) parts.push(`${plural(planIn.length, "door")} ${planIn.length === 1 ? "joins" : "join"} the plan: ${nameList(planIn)}. `);
    if (!planOut.length && !planIn.length) parts.push(moved ? `` : `Your plan keeps the same doors on the same days. `);
    if (moved) parts.push(`${plural(moved, "door")} ${moved === 1 ? "moves" : "move"} to another day. `);
    if (Math.abs(miles) >= 0.5) parts.push(`${Math.abs(miles)} ${miles > 0 ? "more" : "fewer"} miles of driving. `);
  }
  if (under) parts.push(`${plural(under, "door")} on it ${under === 1 ? "rates" : "rate"} under 4.5 and ${under === 1 ? "is" : "are"} greyed out. `);
  if (band) parts.push(`Up is now the rank Qloo gives each door for ${bandLabel} drinkers; faded dots aren't on that list.`);
  return tidy(parts);
}

// ---------- 4.6 The list by age ----------
// m: bumpModel's output; band: the band picked, or null for All ages.
export function bumpWords(m, band = null) {
  const { who, city, series, bands } = m;
  if (!series.length) return [`No door on your plan has an age re-rank from Qloo yet.`];
  if (!bands.length) return [`Qloo has no age re-ranks for these doors yet.`];
  if (!band) {
    const top = series[0];
    const on = bands.filter((b) => top.ranks[b.key]?.rank).map((b) => `#${top.ranks[b.key].rank} of ${top.ranks[b.key].of} for ${b.label}`);
    const off = bands.filter((b) => !top.ranks[b.key]?.rank).map((b) => b.label);
    const parts = [`Pick an age and the list moves. `, { t: top.name }];
    if (on.length) parts.push(` is ${and(on)}`);
    if (off.length) parts.push(`${on.length ? ", and" : " is"} not on the ${and(off)} ${off.length === 1 ? "list" : "lists"} at all`);
    parts.push(`.`);
    return tidy(parts);
  }
  const b = bands.find((x) => x.key === band);
  if (!b) return bumpWords(m, null);
  const ranked = series.map((s) => ({ s, r: s.ranks[band]?.rank ?? null })).filter((x) => x.r).sort((a, b) => a.r - b.r);
  const missing = series.length - ranked.length;
  const n = series.length;
  const parts = [`For `, { t: `${b.label} ${who}` }, `, Qloo ranks ${b.of} ${city} doors. Of your ${NUM[n] ?? n} best: `];
  parts.push(ranked.length ? `${and(ranked.slice(0, 3).map((x) => `${x.s.name} #${x.r}`))} rank` : `none rank`);
  parts.push(`; `, { t: `${missing} ${missing === 1 ? "isn't" : "aren't"} on that list`, cls: "big" }, `. Apply, and Doors ranks Your list for ${b.label} drinkers first, then re-routes your days.`);
  return tidy(parts);
}
const NUM = { 1: "one", 2: "two", 3: "three", 4: "four", 5: "five", 6: "six", 7: "seven", 8: "eight", 9: "nine", 10: "ten", 11: "eleven", 12: "twelve" };

// ---------- 4.7 The door portrait: its lines are built in lib/whyviz/portrait.js from the door's record ----------

// ---------- lane 2 (B, C, D, E) adds its sentences below: areasWords, liftWords, ringWords, threadWords ----------

// ---------- 4.5 Doors that share a crowd (lane 2) ----------
// m: threadModel's output (lib/whyviz/thread.js); id: the selected door. The selected door and the big names are bold.
import { threadOf } from "./thread.js";
export function threadWords(m, id = m.sel) {
  const sel = m.byId.get(id);
  if (!sel) return [m.planN ? "Qloo has no sister doors for the doors on your plan yet." : "No doors on a day yet."];
  const rows = threadOf(m, id);
  const tail = ` Your plan's doors fall into ${plural(m.threads, "connected thread")}. Click a door to work its thread.`;
  if (!rows.length) return [`Qloo lists no doors that share `, { t: sel.name }, `'s crowd.${tail}`];
  const onPlan = rows.filter((r) => r.n.kind === "plan"), onList = rows.filter((r) => r.n.kind === "list"), big = rows.filter((r) => r.n.kind === "big");
  const rest = rows.length - onPlan.length - onList.length - big.length;
  const parts = [`Qloo says the same crowd goes to `, { t: sel.name }, ` and ${plural(rows.length, "other door")}: `];
  const groups = [];
  if (onPlan.length) groups.push([`${nameList(onPlan, 4, (r) => r.n.name)} ${onPlan.length === 1 ? "is" : "are"} on your plan`]);
  if (onList.length) groups.push([`${nameList(onList, 3, (r) => `${r.n.name} (#${r.n.rank})`)} ${onList.length === 1 ? "is" : "are"} on Your list`]);
  if (big.length) groups.push([{ t: nameList(big, 3, (r) => r.n.name), cls: "big" }, ` ${big.length === 1 ? "is one of the most popular doors" : "are among the most popular doors"}`]);
  if (rest) groups.push([`${rest} ${rest === 1 ? "isn't" : "aren't"} on your drinker's list or a type you pitch`]);
  groups.forEach((g, i) => { if (i) parts.push(i === groups.length - 1 ? " and " : ", "); parts.push(...g); });
  parts.push(`.${tail}`);
  return parts;
}

// ---------- 4.3 Who is in the room, against the city (lane 2) ----------
// m: liftModel's output. The groups far above the city (bold), the ones far below, and the ones true of most of the
// city, which are not worth saying (Jard 10-24: "looks like you get music enthusiasts in here").
import { timesWords } from "./lift.js";
export function liftWords(m) {
  const { rows, top, low, common, n, baseN, cityName } = m;
  if (!rows.length) return [`Qloo names no crowd group at two or more of your plan's ${plural(n, "door")} yet.`];
  const parts = [];
  const lowerAll = (xs) => and(xs.map((r) => r.label.toLowerCase()));
  if (top.length) parts.push({ t: cap(lowerAll(top.slice(0, 3))) }, ` ${top.length === 1 ? "is" : "are"} named at your doors ${timesWords(top.slice(0, 3))} as across the ${baseN} ${cityName} doors Qloo describes. `);
  else parts.push(`No group is named at your doors much more often than across the ${baseN} ${cityName} doors Qloo describes. `);
  if (low.length) parts.push({ t: cap(lowerAll(low.slice(0, 2))) }, `, far less. `);
  if (common.length) parts.push(`${and(common.slice(0, 2).map((r, i) => `'${i ? r.label.toLowerCase() : cap(r.label.toLowerCase())}'`))} ${common.length === 1 ? "is" : "are"} true of most of ${cityName}, so ${common.length === 1 ? "it is" : "they are"} not worth saying.`);
  else if (rows.some((r) => r.muted)) parts.push(`The faded rows are about the city: not worth saying.`);
  return parts;
}

// ---------- 4.4 When these doors fill, and when you're there (lane 2) ----------
// m: ringModel's output. The tags over the plan, the day's window against them (bold), the day's doors at the start,
// opening later, and closed that day.
import { clock as ringClock } from "./ring.js";
export function ringWords(m) {
  const { parts, n, day, open0, later, closedN, unknownN, missedN, arcs } = m;
  if (!n) return ["No doors on a day yet."];
  const by = Object.fromEntries(parts.map((p) => [p.key, p.n]));
  const sorted = [...parts].sort((a, b) => b.n - a.n);
  const first = `Qloo tags ${by.Evening} of your ${n} doors with the evening and ${by["Late night"]} with late night; ${by.Morning} with the morning.`;
  if (!day) return [first];
  const dn = cap(day.day);
  const peak = sorted[0];
  const when = day.to <= peak.from ? `before most of them fill` : day.from >= peak.to ? `after most of them have filled` : `as they fill`;
  const parts2 = [`${first} `, { t: `You're out ${dn} ${ringClock(day.from)}–${ringClock(day.to)}, ${when}.` }];
  if (arcs.length) {
    const bits = [`${open0} of ${dn}'s ${plural(arcs.length, "door")} ${open0 === 1 ? "is" : "are"} already open at ${ringClock(day.from)}`];
    if (later) bits.push(`${later} open${later === 1 ? "s" : ""} later in your window`);
    const tail = [];
    if (closedN) tail.push(`${closedN} ${closedN === 1 ? "is" : "are"} closed on ${dn}`);
    if (missedN) tail.push(`${missedN} ${missedN === 1 ? "isn't" : "aren't"} open while you're out`);
    if (unknownN) tail.push(`${unknownN} ${unknownN === 1 ? "has" : "have"} no hours Doors could verify`);
    parts2.push(` ${bits.join("; ")}${tail.length ? `, and ${and(tail)}` : ""}.`);
  }
  return parts2;
}
