// r2viz (Jard 10-24: "if i did this, what would it change here, ok let's add this to my plan"): a change the rep tries
// from Why these doors, what it would do to the plan, and the words for it. The plan view (ui/plan.js) runs the same
// planner on a scratch copy for the preview (nothing saved) and, on Apply, makes the change for real, logs it in
// Changes you made and gives it an Undo. Pure: no DOM.
//
// change: {kind: "rooms", rooms: [..]} · {kind: "age", age: key | null} · {kind: "weight", key, weight: "less"|"normal"|"more"}
//         · {kind: "famous", on} · {kind: "add", id}
//         · {kind: "set", changes: [..]} (WHY-VIZ-SPEC §4.1: the explorer's controls tried together, one preview, one Apply)
//         · {kind: "profile", profile, text, key} (round 4 #6: the whole profile as a Settings form saved it; text says
//           what changed, lib/settings.js changesLine; key keeps each edit its own entry in Changes you made)
import { ROOMS, ageLabel } from "./profile.js";

export const isSet = (c) => c?.kind === "set";
// the famous switch a change carries (a set may hold one), else null
export const famousOf = (c) => (isSet(c) ? c.changes.find((x) => x.kind === "famous")?.on ?? null : c?.kind === "famous" ? !!c.on : null);
// a set's changes other than the famous switch (the profile fields)
export const fieldChanges = (c) => (isSet(c) ? c.changes.filter((x) => x.kind !== "famous" && x.kind !== "add") : c?.kind === "famous" || c?.kind === "add" ? [] : [c]);

export const BIG_NAMES = "Most popular: come back once you have reorders"; // gigbot's pick 10-24; Jard 10-25: 'popular', never 'big names' or 'famous'
export const BIG_SHORT = "Most popular";
export const WEIGHT_WORDS = { less: "Count less", normal: "Normal", more: "Count more" };
const ROOM_WORD = Object.fromEntries(ROOMS.map((r) => [r.key, r.phrase]));
const and = (xs) => (xs.length <= 1 ? xs[0] ?? "" : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// The profile with the change made (a copy; the original is untouched). famous and add aren't profile fields.
export function profileWith(profile, change) {
  if (isSet(change)) return change.changes.reduce((p, c) => profileWith(p, c), structuredClone(profile));
  if (change?.kind === "profile") return structuredClone(change.profile);
  const p = structuredClone(profile);
  if (change?.kind === "rooms") p.rooms = [...change.rooms];
  else if (change?.kind === "age") p.drinkers = { ...(p.drinkers ?? {}), age: change.age ?? null };
  else if (change?.kind === "weight") p.drinks = (p.drinks ?? []).map((d) => (d.key === change.key ? { ...d, weight: change.weight === "normal" ? undefined : change.weight } : d)).map(({ weight, ...d }) => (weight ? { ...d, weight } : d));
  return p;
}
// The profile field the change touches, as it is now (what Undo puts back).
export function fieldOf(profile, change) {
  if (isSet(change)) return change.changes.map((c) => fieldOf(profile, c));
  if (change?.kind === "rooms") return [...(profile.rooms ?? [])];
  if (change?.kind === "age") return profile.drinkers?.age ?? null;
  if (change?.kind === "weight") return profile.drinks?.find((d) => d.key === change.key)?.weight ?? "normal";
  if (change?.kind === "profile") return structuredClone(profile);
  return null;
}
// The change that puts a field back (Undo of an applied change).
export function undoOf(change, from) {
  if (isSet(change)) return { kind: "set", changes: change.changes.map((c, i) => undoOf(c, from?.[i])).filter(Boolean) };
  if (change.kind === "rooms") return { kind: "rooms", rooms: from };
  if (change.kind === "age") return { kind: "age", age: from };
  if (change.kind === "weight") return { kind: "weight", key: change.key, weight: from ?? "normal" };
  if (change.kind === "profile") return from ? { kind: "profile", profile: from, text: change.text, key: change.key } : null;
  return null;
}
// True when the change would change nothing (the control is already there).
export function sameAs(profile, famous, change) {
  if (isSet(change)) return change.changes.every((c) => sameAs(profile, famous, c));
  if (change.kind === "rooms") return [...(profile.rooms ?? [])].sort().join() === [...change.rooms].sort().join();
  if (change.kind === "age") return (profile.drinkers?.age ?? null) === (change.age ?? null);
  if (change.kind === "weight") return (profile.drinks?.find((d) => d.key === change.key)?.weight ?? "normal") === (change.weight ?? "normal");
  if (change.kind === "famous") return !!famous === !!change.on;
  if (change.kind === "profile") return JSON.stringify(change.profile) === JSON.stringify(profile);
  return false;
}

// What the change says, in plain words ("Pitch restaurants too", "Count White Claw drinkers less").
export function changeText(change, { profile = {}, names = {} } = {}) {
  if (isSet(change)) { const ts = change.changes.map((c) => changeText(c, { profile, names })); return ts.length ? and(ts.map((t, i) => (i ? t[0].toLowerCase() + t.slice(1) : t))) : "Change the plan"; }
  if (change.kind === "rooms") {
    const was = new Set(profile.rooms ?? []), now = new Set(change.rooms);
    const add = change.rooms.filter((r) => !was.has(r)), drop = [...was].filter((r) => !now.has(r));
    return add.length && !drop.length ? `Pitch ${and(add.map((r) => ROOM_WORD[r] ?? r))} too` : drop.length && !add.length ? `Stop pitching ${and(drop.map((r) => ROOM_WORD[r] ?? r))}` : `Pitch ${and(change.rooms.map((r) => ROOM_WORD[r] ?? r))}`;
  }
  if (change.kind === "age") return change.age ? `Rank for ${ageLabel(change.age)} drinkers first` : "Rank for drinkers of all ages";
  if (change.kind === "weight") return change.weight === "normal" ? `Count ${names[change.key] ?? "these"} drinkers as normal` : `Count ${names[change.key] ?? "these"} drinkers ${change.weight}`;
  if (change.kind === "famous") return change.on ? "Include the most popular doors now" : "Leave the most popular doors for later";
  if (change.kind === "profile") return change.text || "Change your settings";
  if (change.kind === "add") { // lane 2 (picture 5): several doors from a thread at once
    const ids = change.ids ?? [change.id];
    return ids.length > 1 ? `Add ${ids.length} doors to my plan: ${and(ids.map((id) => names[id] ?? "a door"))}` : `Add ${names[ids[0]] ?? "this door"} to my plan`;
  }
  return "Change the plan";
}

// What a re-plan changed, door by door and day by day. prev, next: plans ({days:[{date, day, stops:[{id}], mi, min}]});
// prevPool, nextPool: Your list ids. → {inn:[{id, day}], out:[{id, day}], moved:[{id, from, to}], days:[{date, day,
// n:[before, after], mi:[before, after], min:[before, after]}], mi:[before, after], min:[before, after], list:[before, after], same}
export function planDiff(prev, next, { prevPool = [], nextPool = [] } = {}) {
  const where = (p) => { const m = new Map(); (p?.days ?? []).forEach((d) => d.stops.forEach((s) => !m.has(s.id) && m.set(s.id, d))); return m; };
  const a = where(prev), b = where(next);
  const inn = [...b].filter(([id]) => !a.has(id)).map(([id, d]) => ({ id, day: d.day, date: d.date }));
  const out = [...a].filter(([id]) => !b.has(id)).map(([id, d]) => ({ id, day: d.day, date: d.date }));
  const moved = [...b].filter(([id, d]) => a.has(id) && a.get(id).date !== d.date).map(([id, d]) => ({ id, from: a.get(id).day, to: d.day }));
  const sum = (p, k) => Math.round((p?.days ?? []).reduce((t, d) => t + (+d[k] || 0), 0) * 10) / 10;
  const days = (next?.days ?? []).map((d) => { const o = (prev?.days ?? []).find((x) => x.date === d.date && x.from === d.from); return { date: d.date, day: d.day, n: [o?.stops.length ?? 0, d.stops.length], mi: [Math.round((+o?.mi || 0) * 10) / 10, Math.round((+d.mi || 0) * 10) / 10], min: [Math.round(+o?.min || 0), Math.round(+d.min || 0)] }; });
  return { inn, out, moved, days, mi: [sum(prev, "mi"), sum(next, "mi")], min: [Math.round(sum(prev, "min")), Math.round(sum(next, "min"))], list: [prevPool.length, nextPool.length], same: !inn.length && !out.length && !moved.length };
}
// The diff in one or two plain sentences ("3 doors join your plan and 2 come off. 4.2 more miles of driving.").
export function diffText(d, { names = {} } = {}) {
  const parts = [];
  if (d.list[0] !== d.list[1]) parts.push(`Your list ${d.list[1] > d.list[0] ? "grows" : "shrinks"} from ${d.list[0]} to ${d.list[1]} doors.`);
  if (d.same) parts.push("Your plan keeps the same doors on the same days.");
  else {
    const io = [d.inn.length ? `${plural(d.inn.length, "door")} ${d.inn.length === 1 ? "joins" : "join"} your plan` : "", d.out.length ? `${d.out.length} ${d.out.length === 1 ? "comes" : "come"} off` : ""].filter(Boolean);
    if (io.length) parts.push(`${io.join(" and ")}.`.replace(/^./, (c) => c.toUpperCase()));
    if (d.moved.length) parts.push(`${plural(d.moved.length, "door")} ${d.moved.length === 1 ? "moves" : "move"} to another day.`);
  }
  const dm = Math.round((d.mi[1] - d.mi[0]) * 10) / 10;
  if (Math.abs(dm) >= 0.5) parts.push(`${Math.abs(dm)} ${dm > 0 ? "more" : "fewer"} miles of driving.`);
  return parts.join(" ");
}
