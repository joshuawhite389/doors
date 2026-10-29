// Why these doors, the map side (ui/why.js mounts it). r2viz's step-through map story was retired on 2026-10-25
// (WHY-VIZ-SPEC §9a, Jard's pick): its tally lives on as "What doors were left off and why", its map becomes picture 2
// (lane 2: the neighbourhood clouds). What stays here: the preview rings a tried change draws on the map (green joins
// your plan, red comes off), the Add-a-door preview card with Apply (plan.js previewChange / applyChange), the door
// view's Add button and its dashed sister lines (the portrait, ui/whyviz/portrait.js, replaced the r2viz extras), and the loader for Qloo's heatmap neighbourhoods (lib/culture.js heatFor) picture 2 reads.
import { $, esc, instant } from "./dom.js";
import { DAY_COLOURS as DAYS } from "./map.js";
import { getJSON } from "./data.js";
import { sameAs } from "../lib/whatif.js";
import { heatFor } from "../lib/culture.js";
import { CROWD_TERMS } from "../lib/insights.js";
import { and as andList } from "../lib/whyviz/words.js";

const PV = "why-pv";
const C = { later: "#CF6612", aside: "#C9C5BC", ring: "#17191B", inn: "#13875A", out: "#D2463C" };
const narrow = () => matchMedia("(max-width: 900px)").matches;
const reduced = () => instant(); // prefers-reduced-motion, or ?instant=1 (screenshots)

// ---------- Qloo's heatmap neighbourhoods for the plan's drinker (picture 2 reads s.data.hoods) ----------
export async function heatLoad(s) {
  const key = s.ctx.plan.city.key;
  if (s.data.hoodsFor === key) return;
  const heat = await getJSON("/data/culture/heat.json").catch(() => null);
  s.data.hoods = heatFor(heat, s.ctx.routes, key) ?? null;
  s.data.hoodsFor = key;
}

// ---------- the Add-a-door preview (the door view's "Add to my plan", a sister's Add) ----------
export function pvHTML(s) {
  const pv = s.pv;
  if (!pv) return "";
  if (pv.busy) return `<div class="ws-pv busy" role="status">Planning it: ${esc(pv.text ?? "")}…</div>`;
  if (pv.err) return `<div class="ws-pv" role="alert">${esc(pv.err)} <button type="button" class="lnk" data-pv="cancel">Close</button></div>`;
  const r = pv.res, name = (id) => r.venues[id]?.name ?? "A door", d = r.diff;
  const list = (xs, sign) => (xs.length ? `<li class="${sign === "+" ? "in" : "out"}"><b>${sign}</b> ${esc(andList(xs.slice(0, 4).map((x) => name(x.id))))}${xs.length > 4 ? ` and ${xs.length - 4} more` : ""}</li>` : "");
  const dayRows = d.days.filter((x) => x.n[0] !== x.n[1] || Math.abs(x.mi[1] - x.mi[0]) >= 0.5).map((x) => `<li>${esc(x.day[0].toUpperCase() + x.day.slice(1))}: ${x.n[0]} → ${x.n[1]} stops${x.mi[0] || x.mi[1] ? `, ${x.mi[0]} → ${x.mi[1]} mi` : ""}</li>`).join("");
  return `<div class="ws-pv" role="status"><p class="ws-pvh">If you: ${esc(r.text)}</p><p>${esc(r.said)}</p>
    <ul class="ws-pvl">${list(d.inn, "+")}${list(d.out, "−")}</ul>${dayRows ? `<ul class="ws-pvd">${dayRows}</ul>` : ""}
    <p class="ws-pvm">On the map: green rings join your plan, red rings come off.</p>
    <div class="ws-pva">${d.same && d.list[0] === d.list[1] ? "" : `<button type="button" class="btn sm primary" data-pv="apply">Apply to my plan</button>`}<button type="button" class="btn sm line" data-pv="cancel">${d.same && d.list[0] === d.list[1] ? "Close" : "Cancel"}</button></div></div>`;
}
// why.js passes its clicks here first; true = handled
export function pvClick(el, s, e, { render }) {
  const pv = e.target.closest("[data-pv]");
  if (!pv) return false;
  if (pv.dataset.pv === "cancel") (s.pv = null), paintPreview(s, null), render();
  else if (pv.dataset.pv === "apply") applyIt(el, s, render);
  return true;
}
export async function tryChange(el, s, change, render, { from = null } = {}) { // lane 2's thread panel (Add, Add all, the fixes) and the door view's Add; from: where the tray shows (round 4 #7: "logi" = under the explorer's list)
  s.pvFrom = from;
  if (sameAs(s.ctx.profile, s.ctx.famous, change)) { s.pv = null; paintPreview(s, null); return render(); }
  const names = Object.fromEntries((s.ctx.routes ?? []).map((r) => [r.drinker?.key, r.drinker?.name]));
  s.pv = { change, busy: true, text: change.kind === "rooms" ? "door types" : change.kind === "weight" ? `${names[change.key] ?? "a drink"}'s weight` : change.kind === "age" ? "age" : change.kind === "add" ? (change.ids?.length > 1 ? "adding the doors" : "adding the door") : "the most popular doors" };
  render();
  const my = (s.pvSeq = (s.pvSeq ?? 0) + 1);
  const res = await s.ctx.previewChange?.(change).catch(() => null);
  if (my !== s.pvSeq || !s.pv) return;
  s.pv = res?.error ? { change, err: res.error } : res ? { change: res.date ? { ...change, date: res.date, dates: res.dates ?? undefined } : res.dates ? { ...change, dates: res.dates } : change, res } : { change, err: "Doors couldn't plan that change. Try again." };
  render();
  paintPreview(s, res, { fit: true }); // an Add: show the door (round 6 #1 keeps the camera for the controls)
}
async function applyIt(el, s, render) {
  const ch = s.pv?.change;
  if (!ch) return;
  s.pv = null;
  paintPreview(s, null);
  const ok = await s.ctx.applyChange?.(ch);
  if (!ok) render();
}
// the door view's "Add to my plan": the same preview, then Apply
export function previewAdd(el, s, id, render) {
  const v = s.ctx.plan.venues[id] ?? s.m.route.venues[id];
  return tryChange(el, s, { kind: "add", id, venue: v ? { ...v, id } : null }, render);
}

// ---------- the map: a tried change's rings (green joins your plan, red comes off) ----------
const fc = (features) => ({ type: "FeatureCollection", features });
function ensurePv(map) {
  if (!map.getSource(PV)) map.addSource(PV, { type: "geojson", data: fc([]) });
  if (!map.getLayer(PV)) map.addLayer({ id: PV, type: "circle", source: PV, paint: { "circle-radius": 13, "circle-color": "rgba(0,0,0,0)", "circle-stroke-width": 3, "circle-stroke-color": ["get", "c"] } });
}
// res: a previewChange result (its diff and venues), or null to clear
// round 6 #1 (Jard 10-27: "the map changes, making everything move around"): a control's preview only restyles the rings;
// fit: true (an Add from a row or a door's page) brings that door into view, the one time the camera moves
export function paintPreview(s, res = s.pv?.res ?? null, { fit = false } = {}) {
  const map = s.ctx?.map;
  if (!map) return;
  const go = () => {
    try {
      ensurePv(map);
      if (!res) return map.getSource(PV).setData(fc([]));
      const at = (id) => { const v = res.venues[id] ?? s.ctx.plan.venues[id]; return v && Number.isFinite(v.lat) ? [v.lon, v.lat] : null; };
      const f = (xs, c) => xs.map((x) => at(x.id)).filter(Boolean).map((p) => ({ type: "Feature", properties: { c }, geometry: { type: "Point", coordinates: p } }));
      map.getSource(PV).setData(fc([...f(res.diff.inn, C.inn), ...f(res.diff.out, C.out)]));
      const all = [...res.diff.inn, ...res.diff.out].map((x) => at(x.id)).filter(Boolean);
      if (fit && all.length) fitAll(map, all.map(([lon, lat]) => ({ lon, lat })));
    } catch (e) { console.error(e); }
  };
  if (map.isStyleLoaded()) go();
  else map.once("idle", go);
}
function fitAll(map, pts) {
  if (!pts.length) return;
  const lons = pts.map((p) => p.lon), lats = pts.map((p) => p.lat);
  const pad = narrow() ? { top: 40, bottom: 40, left: 30, right: 30 } : { top: 70, bottom: 60, left: 60, right: 60 };
  try { map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: pad, maxZoom: 13.5, duration: reduced() ? 0 : 1200 }); } catch {}
}
export function clearPreview(s) {
  const map = s.ctx?.map;
  if (!map) return;
  try {
    if (map.getLayer(PV)) map.removeLayer(PV);
    if (map.getSource(PV)) map.removeSource(PV);
  } catch { /* the map is gone with the view */ }
}

// ---------- one door (Why this door): who goes, when, the doors the same crowd goes to ----------
const LINKS = "why-links";
// each crowd group's share over all the city's doors Doors holds (the base for "rarest in Austin first")
export function shares(s) {
  if (s.data.shares) return s.data.shares;
  const { ids = [], venues = {} } = s.data.base ?? {};
  const texts = ids.map((id) => String(venues[id]?.crowd ?? "").toLowerCase()).filter(Boolean);
  s.data.shares = { n: texts.length, of: Object.fromEntries(CROWD_TERMS.map((t) => [t.key, texts.length ? texts.filter((x) => t.re.test(x)).length / texts.length : 0])) };
  return s.data.shares;
}
const dotOf = (s, id) => s.m.sv.dots.find((d) => d.id === id) ?? s.m.sv.extras.find((d) => d.id === id) ?? null;
export function sisterStatus(s, id) {
  const d = dotOf(s, id), rank = s.ctx.plan.pool.ids.indexOf(id) + 1;
  if (d?.fate === "plan") return { text: d.reason, c: DAYS[(d.day ?? 0) % DAYS.length], act: false, k: "plan" };
  if (d?.fate === "famous") return { text: "Most popular, for later", c: C.later, act: false, k: "big" };
  if (rank) return { text: `#${rank} on Your list`, c: C.ring, act: true, k: "list" };
  if (d) return { text: d.fate === "room" ? "Not a door type you pitch" : d.reason, c: C.aside, act: false, k: "out" };
  return { text: "Not on your drinker's list", c: C.aside, act: false, k: "none" };
}
export function sistersOf(s, id, n = 6) {
  const city = s.data.city ?? {};
  return (city.sisters?.[id] ?? []).map((r) => (Array.isArray(r) ? r : [r, null])).map(([sid, sc]) => ({ id: sid, sc, v: s.ctx.plan.venues[sid] ?? s.m.route.venues[sid] ?? city.sisterVenues?.[sid] ?? null })).filter((x) => x.v?.name).slice(0, n);
}
// the door view's "Add to my plan" (the portrait sits under it): the same preview as Try a change, then Apply
export function addDoorHTML(s, id, v) {
  const d = dotOf(s, id);
  if (!d || d.fate === "plan" || !Number.isFinite(+v?.lat) || !S_CAN_ADD()) return "";
  return `<div class="wd-add"><button type="button" class="btn sm primary" data-addpv="${esc(id)}">Add to my plan</button><span>See what it changes before anything moves.</span></div>`;
}
let S_CAN_ADD = () => true;
export const setCanAdd = (fn) => (S_CAN_ADD = fn);
export const canAdd = () => S_CAN_ADD();
export function paintLinks(s, id) {
  const map = s.ctx.map;
  if (!map) return;
  try {
    const v = id && (s.ctx.plan.venues[id] ?? s.m.route.venues[id]);
    const feats = !v || !Number.isFinite(v.lat) ? [] : sistersOf(s, id).filter((x) => Number.isFinite(x.v.lat)).map((x) => ({ type: "Feature", properties: { c: sisterStatus(s, x.id).c }, geometry: { type: "LineString", coordinates: [[v.lon, v.lat], [x.v.lon, x.v.lat]] } }));
    const data = fc(feats);
    if (map.getSource(LINKS)) map.getSource(LINKS).setData(data);
    else map.addSource(LINKS, { type: "geojson", data });
    if (!map.getLayer(LINKS)) map.addLayer({ id: LINKS, type: "line", source: LINKS, paint: { "line-color": ["get", "c"], "line-width": 1.8, "line-opacity": 0.85, "line-dasharray": [2, 1.5] } });
  } catch (e) { console.error(e); }
}
export function clearLinks(s) {
  const map = s.ctx?.map;
  try { if (map?.getLayer(LINKS)) map.removeLayer(LINKS); if (map?.getSource(LINKS)) map.removeSource(LINKS); } catch {}
}
