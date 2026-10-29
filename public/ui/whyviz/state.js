// WHY-VIZ-SPEC §4.1, §4.6: the one control state the pictures share (Across · Your drinkers' age · Door types you pitch
// · Big names · Rating · each drink's weight) and the preview it drives. The state starts as the profile is; the
// difference between the two is one whatif.js set change. Every change runs the real planner on a scratch profile
// (ui/plan.js previewChange, nothing saved) and the sieve over its plan, so the pictures take their fates from the
// preview, never from a guess made here. Apply makes the set real (plan.js applySet: Changes you made, Undo).
import { sieve } from "../../lib/sieve.js";
import { profileWith, sameAs, famousOf } from "../../lib/whatif.js";
import { weightsOf } from "../../lib/pool.js";
import { paintPreview } from "../whymap.js";

const sameSet = (a, b) => [...a].sort().join() === [...b].sort().join();

// the state, reset to the profile whenever the profile (or the famous switch) changes under it (Apply, Undo, Edit)
export function vizState(s) {
  s.viz ??= { st: null, base: null, pv: null, seq: 0, svg: null };
  const base = baseKey(s);
  if (!s.viz.st || s.viz.base !== base) {
    const prev = s.viz.st;
    s.viz.st = fromProfile(s, prev);
    s.viz.base = base;
    s.viz.pv = null;
  }
  return s.viz;
}
const baseKey = (s) => JSON.stringify({ rooms: [...(s.ctx.profile.rooms ?? [])].sort(), age: s.ctx.profile.drinkers?.age ?? null, famous: !!s.ctx.famous, weights: weightsOf(s.ctx.profile) ?? {} });
function fromProfile(s, prev = null) {
  const p = s.ctx.profile;
  return { x: prev?.x ?? "pop", r45: prev?.r45 ?? false, band: p.drinkers?.age ?? null, rooms: [...(p.rooms ?? [])], famous: !!s.ctx.famous, weights: { ...(weightsOf(p) ?? {}) } };
}

// The set change the state is from the profile: {kind: "set", changes: []} when nothing differs.
export function changeSet(s) {
  const { st } = vizState(s);
  const p = s.ctx.profile;
  const changes = [];
  if (!sameSet(st.rooms, p.rooms ?? [])) changes.push({ kind: "rooms", rooms: [...st.rooms] });
  if ((st.band ?? null) !== (p.drinkers?.age ?? null)) changes.push({ kind: "age", age: st.band ?? null });
  if (!!st.famous !== !!s.ctx.famous) changes.push({ kind: "famous", on: !!st.famous });
  for (const r of s.ctx.routes ?? []) {
    const k = r.drinker?.key;
    if (!k) continue;
    const now = weightsOf(p)?.[k] ?? "normal", want = st.weights[k] ?? "normal";
    if (now !== want) changes.push({ kind: "weight", key: k, weight: want });
  }
  return { kind: "set", changes: changes.filter((c) => !sameAs(p, !!s.ctx.famous, c)) };
}

// The preview the pictures draw from: the last good preview for this exact set (or null), and whether one is in flight.
export function previewOf(s) {
  const v = vizState(s), set = changeSet(s);
  if (!set.changes.length) return { preview: null, busy: false, err: null, set };
  const key = JSON.stringify(set);
  const pv = v.pv;
  const good = pv?.key === key && pv.res && pv.sv ? { pool: pv.res.pool, plan: pv.res.plan, sv: pv.sv, diff: pv.res.diff, res: pv.res } : null;
  return { preview: good, busy: !!pv?.busy && pv.key === key, err: pv?.key === key ? pv.err ?? null : null, set, stale: !good && pv?.last ? pv.last : null };
}

// Run the preview for the current state when it isn't already here or in flight. onDraw() redraws the pictures:
// once at once (the previous dots hold, dimmed) and once when the planner answers.
export async function runPreview(s, onDraw) {
  const v = vizState(s), set = changeSet(s);
  if (!set.changes.length) { if (v.pv) { v.pv = null; paintPreview(s, null); } return onDraw(); }
  const key = JSON.stringify(set);
  if (v.pv?.key === key && (v.pv.busy || v.pv.res)) return onDraw();
  const last = v.pv?.res && v.pv?.sv ? { pool: v.pv.res.pool, plan: v.pv.res.plan, sv: v.pv.sv, diff: v.pv.res.diff, res: v.pv.res } : v.pv?.last ?? null;
  const my = ++v.seq;
  v.pv = { key, busy: true, last };
  onDraw();
  const res = await s.ctx.previewChange?.(set).catch(() => null);
  if (my !== v.seq || !s.viz) return;
  if (!res) { v.pv = { key, err: "Doors couldn't plan that change. Try again.", last }; return onDraw(); }
  const scratch = { ...res.plan, venues: res.venues, pool: { ids: res.pool }, statuses: s.ctx.plan.statuses, city: s.ctx.plan.city };
  let sv = null;
  try { sv = sieve({ route: s.m.route, plan: scratch, profile: profileWith(s.ctx.profile, set), famous: famousOf(set) ?? !!s.ctx.famous, city: s.data.city }); } catch (e) { console.error(e); }
  v.pv = { key, res, sv, change: set };
  paintPreview(s, res);
  onDraw();
}

// Apply the set for real (plan.js applySet → re-plan, Changes you made, flash with Undo). The re-plan redraws the drawer.
export async function applyViz(s) {
  const { set } = previewOf(s);
  if (!set.changes.length) return false;
  const v = vizState(s);
  v.pv = null;
  paintPreview(s, null);
  return !!(await s.ctx.applyChange?.(set));
}
// Put the controls back to the profile's settings (nothing was changed).
export function resetViz(s) {
  const v = vizState(s);
  v.st = fromProfile(s, v.st);
  v.pv = null;
  v.seq++;
  paintPreview(s, null);
}
// the drawer closed or left the home: the map's preview rings go
export function clearViz(s) {
  if (!s.viz) return;
  s.viz.seq++;
  s.viz.pv = null;
  paintPreview(s, null);
}

// One control back to the profile's setting (round 4 #8: a chip's ×)
export function resetControl(s, row) {
  const { st } = vizState(s);
  const p = s.ctx.profile;
  if (row === "band") st.band = p.drinkers?.age ?? null;
  else if (row === "rooms") st.rooms = [...(p.rooms ?? [])];
  else if (row === "famous") st.famous = !!s.ctx.famous;
  else if (row === "r45") st.r45 = false;
  else if (row.startsWith("weight:")) st.weights[row.slice(7)] = weightsOf(p)?.[row.slice(7)] ?? "normal";
  return st;
}
// One control changed: row = "x" | "band" | "rooms" | "famous" | "r45" | "weight:<drinker key>", v = the button's value
export function setControl(s, row, v) {
  const { st } = vizState(s);
  if (row === "x") st.x = v;
  else if (row === "band") st.band = v === "all" ? null : v;
  else if (row === "famous") st.famous = v === "true";
  else if (row === "r45") st.r45 = v === "true";
  else if (row === "rooms") { const has = st.rooms.includes(v); if (has && st.rooms.length > 1) st.rooms = st.rooms.filter((x) => x !== v); else if (!has) st.rooms = [...st.rooms, v]; }
  else if (row.startsWith("weight:")) st.weights[row.slice(7)] = v;
  return st;
}
