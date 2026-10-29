// The route animation (SPEC-V2 §3.3, §5.1): the line grows along the road, the camera trails its head like someone
// giving directions, and each door pauses with a card. Three pieces:
//   followRoute(map, {...})        one day, once; resolves when it ends or its AbortSignal fires
//   createRoutePlayer({...})        a plan's days on a map: road lines in day colours, pins, Run the route, speed, play all
//   runBuilding(player, {...})      the "building your route" phase when a plan is first built
// Pure maths (door matching, timeline, speed) lives in ../lib/follow.js. ?instant=1 = end state, no animation;
// prefers-reduced-motion = no camera flight, cards shown in order; phone (≤ 700 px) = pitch 0, no bearing drift.
import {
  SPEEDS, PAUSE_MS, INTRO_MS, OUTRO_MS, metres, matchStops, timeline, stateAt, lineTo, clampSpeed, milesAt, zoomFor, follow,
  BUILD, buildPace, createRunSlot, placeCard,
} from "../lib/follow.js";
import { arriveText } from "../lib/stopmodel.js";
import { esc, cap } from "./dom.js";
import { DAY_COLOURS, setRoute, removeRoute, raiseRoute, addPins, clearMarkers, boundsOf } from "./map.js";
import { drawCorridors } from "./corridor.js";
import { icon } from "../lib/icons.js"; // the Doors icon set (Jard 10-24 #1)

const CSS = "/css/animate.css";
if (typeof document !== "undefined" && !document.querySelector(`link[href="${CSS}"]`)) {
  const l = document.createElement("link");
  l.rel = "stylesheet";
  l.href = CSS;
  document.head.append(l);
}

const MI_PER_M = 1 / 1609.344;
const ROAD_FACTOR = 1.35; // the estimate, as src/ors.js
const EST_MPH = 18;
const PITCH = 45;
const BEARING0 = -15; // slow drift from here, +40° over a day
const CAM_TAU = 200; // ms (animation time) for the camera to close ~63% of the gap to the head
const ZOOM_TAU = 700;

const qs = () => new URLSearchParams(typeof location === "undefined" ? "" : location.search);
export const isInstant = () => qs().has("instant");
export const reducedMotion = () => typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
export const isPhone = () => typeof matchMedia !== "undefined" && matchMedia("(max-width: 700px)").matches;
const colourOf = (i) => DAY_COLOURS[i % DAY_COLOURS.length];
const median = (xs) => xs.slice().sort((a, b) => a - b)[xs.length >> 1];
// C2: holdRuns(true) holds every run where it is (the demo's Pause): the line stops growing and the building phase's
// beats wait. holdRuns(false) lets them go on.
let held = false;
const onRelease = new Set();
export function holdRuns(on) {
  held = !!on;
  if (!held) { onRelease.forEach((f) => f()); onRelease.clear(); }
}
const sleep = (ms, signal) => new Promise((res) => {
  if (signal?.aborted) return res(false);
  const done = () => { signal?.removeEventListener("abort", ab); res(true); };
  const t = setTimeout(() => (held ? onRelease.add(done) : done()), ms);
  const ab = () => { clearTimeout(t); onRelease.delete(done); res(false); };
  signal?.addEventListener("abort", ab, { once: true });
});

// ---------- road geometry: /api/directions per day, cached in memory ----------
const roads = new Map();
const coordsOf = (start, stops) => [[start.lon, start.lat], ...stops.map((s) => [s.lon, s.lat])].map(([x, y]) => [+(+x).toFixed(6), +(+y).toFixed(6)]);

// The straight-line estimate, same rule as the Worker's fallback (src/ors.js).
export function estimateRoad(coords, reason = null) {
  const legs = coords.slice(1).map((c, i) => {
    const mi = metres(coords[i], c) * MI_PER_M * ROAD_FACTOR;
    return { mi: +mi.toFixed(1), min: +((mi / EST_MPH) * 60).toFixed(1) };
  });
  return {
    geometry: { type: "LineString", coordinates: coords }, wayPoints: coords.map((_, i) => i), legs,
    mi: +legs.reduce((a, l) => a + l.mi, 0).toFixed(1), min: +legs.reduce((a, l) => a + l.min, 0).toFixed(1),
    source: "estimate", label: "estimated: straight-line distance × 1.35", ...(reason ? { reason } : {}),
  };
}

// {geometry, wayPoints, legs, mi, min, source} for a day: start → each stop in order. Never rejects: any failure is the
// labelled estimate. ?ors=off is passed through (forces the estimate).
// The guided demo makes no live calls (preaudit): while it runs, a day the demo didn't bake (Thursday after
// a logged visit re-plans it) gets the labelled estimate without asking /api/directions.
let roadsOffline = false;
export const setRoadsOffline = (v) => { roadsOffline = !!v; };

export function roadFor(start, stops) {
  const coords = coordsOf(start, stops);
  if (coords.length < 2) return Promise.resolve(estimateRoad(coords));
  if (roadsOffline && !roads.has(JSON.stringify(coords))) return Promise.resolve(estimateRoad(coords));
  const key = JSON.stringify(coords);
  if (!roads.has(key)) {
    const off = qs().get("ors") === "off";
    const p = fetch(`/api/directions${off ? "?ors=off" : ""}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ coords }) })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`directions ${r.status}`))))
      .then((b) => {
        if (b?.geometry?.type !== "LineString" || !(b.geometry.coordinates?.length >= 2) || b.legs?.length !== coords.length - 1) throw new Error("directions: bad shape");
        return b;
      })
      .catch((e) => { roads.delete(key); return estimateRoad(coords, e.message); });
    roads.set(key, p);
  }
  return roads.get(key);
}

// Judge pass 2 (19): is this day's road shape known (baked or fetched)? Offline (the demo), a re-planned day that the
// bake never routed draws as the dashed straight line, though its miles come from the baked road table.
export const hasRoadShape = (start, stops) => roads.has(JSON.stringify(coordsOf(start, stops)));

// Bake a known road for a day (the demo's precomputed geometry): later roadFor calls with the same start + stops get it.
export function seedRoad(start, stops, road) {
  roads.set(JSON.stringify(coordsOf(start, stops)), Promise.resolve(road));
}

// ---------- the door card ----------
// The arrival, and the wait when the room isn't open yet: "arrive 10:44 am · opens 11 am, wait ~16 min" (R2 L6).
const lower1 = (s) => s.replace(/^A/, "a");
// stop.est: its arrival comes from estimated drive times, so the card says "about 2:14 pm · estimated drive".
function cardEl(stop, { n, total, color }) {
  const wrap = document.createElement("div");
  wrap.className = "dcard-m";
  const photo = stop.image
    ? `<img class="ph" src="${esc(stop.image)}" alt="" loading="eager" referrerpolicy="no-referrer">`
    : `<div class="ph" style="background:${color}">${esc((stop.name ?? "?").trim()[0] ?? "?")}</div>`;
  // judge pass 8 (#2): the card says who drinks there (stop.reason, planview.doorReason), not "#5 of 55"
  wrap.innerHTML = `<div class="dcard" role="status" aria-live="polite">${photo}<div class="tx">
    <div class="k"><i style="background:${color}"></i>Stop ${n}${stop.eta != null && !stop.est ? ` · ${lower1(arriveText({ eta: stop.eta, waitMin: stop.wait ?? 0 }))}` : ""}</div>
    <b>${esc(stop.name ?? "A door")}</b>
    <div class="g">${esc([cap(stop.genre) || "Bar or restaurant", stop.reason].filter(Boolean).join(" · "))}${total ? ` <span class="sr">stop ${n} of ${total}</span>` : ""}</div>
    ${stop.eta != null && stop.est ? `<div class="e">about ${lower1(arriveText({ eta: stop.eta, waitMin: stop.wait ?? 0 })).replace(/^arrive /, "")} · estimated drive</div>` : ""}</div></div>`;
  const img = wrap.querySelector("img");
  if (img) img.addEventListener("error", () => { img.replaceWith(Object.assign(document.createElement("div"), { className: "ph", textContent: (stop.name ?? "?").trim()[0] ?? "?", style: `background:${color}` })); }, { once: true });
  return wrap;
}

// opts.avoid: [{lon, lat, w}] pins the card should not cover (stop 1 weighs most); the card goes above its pin, or
// below / beside it when above would cover one or run off the map (placeCard). Returns {hide(speed), remove()}.
export function showCard(map, stop, opts) {
  const el = cardEl(stop, opts);
  let anchor = "bottom";
  let offset = [0, -20];
  if (opts.avoid?.length) {
    const c = map.getContainer();
    el.style.cssText = "position:absolute;visibility:hidden;left:0;top:0";
    c.append(el);
    const size = { w: el.firstElementChild.offsetWidth, h: el.firstElementChild.offsetHeight };
    el.remove();
    el.style.cssText = "";
    // opts.at: where the pin will sit once the camera settles (the follow camera trails the line, so at the moment the
    // pin pops it is off to one side; ease audit 3 #10h: on a 390 px hero the card went beside it and ran off the map)
    const here = map.project([stop.lon, stop.lat]);
    const dx = opts.at ? opts.at.x - here.x : 0, dy = opts.at ? opts.at.y - here.y : 0;
    const pt = (p) => { const q = map.project([p.lon, p.lat]); return { x: q.x + dx, y: q.y + dy }; };
    ({ anchor, offset } = placeCard(pt(stop), opts.avoid.map((p) => ({ ...pt(p), w: p.w })), size, { w: c.clientWidth, h: c.clientHeight }));
  }
  el.classList.add(`at-${anchor}`);
  const marker = new window.maplibregl.Marker({ element: el, anchor, offset }).setLngLat([stop.lon, stop.lat]).addTo(map);
  const card = el.firstElementChild;
  requestAnimationFrame(() => requestAnimationFrame(() => card.classList.add("in")));
  let gone = false;
  return {
    hide(speed = 1) {
      if (gone) return;
      gone = true;
      card.style.transitionDuration = `${0.6 / speed}s`;
      card.classList.remove("in");
      card.classList.add("out");
      setTimeout(() => marker.remove(), 650 / speed + 50);
    },
    remove() { gone = true; marker.remove(); },
  };
}

// Resolve on the map's moveend (or abort, or a timeout so a dropped event never hangs a run).
function moved(map, ms, signal) {
  return new Promise((res) => {
    const done = () => { clearTimeout(t); map.off("moveend", done); signal?.removeEventListener("abort", done); res(); };
    const t = setTimeout(done, ms + 400);
    map.once("moveend", done);
    signal?.addEventListener("abort", done, { once: true });
  });
}

// fitPadding, grown to keep the fit clear of an overlay on the map's top or bottom edge (G3: the layer chips)
function clearOf(map, el) {
  const pad = fitPadding(map);
  const m = map.getContainer().getBoundingClientRect();
  const b = el?.getBoundingClientRect();
  if (!b?.height || b.height > m.height / 3) return pad;
  if (b.top - m.top > m.height / 2) pad.bottom = Math.max(pad.bottom, m.bottom - b.top + 16);
  else pad.top = Math.max(pad.top, b.bottom - m.top + 16);
  return pad;
}
function fitPadding(map) {
  const c = map.getContainer();
  const narrow = c.clientWidth < 520;
  const h = c.clientHeight || 300; // audit 2 #5: the phone map is shorter now; fixed 60 + 64 left a 55 px strip at 320 px
  return narrow ? { top: Math.round(Math.min(60, h * 0.14)), bottom: Math.round(Math.min(64, h * 0.16)), left: 36, right: 52 } : { top: 90, bottom: 70, left: 70, right: 70 };
}

// ---------- followRoute: one day, once ----------
// map: a MapLibre map. geometry: GeoJSON LineString (or [[lon, lat], …]) from the start through every stop.
// stops: [{lat, lon, n?, name, genre, rank, N, eta (minutes), image}] in order. start: {lat, lon}. legs: [{mi}] (for the
// miles counter; else measured). speed: a number or () => number (read every frame, so the slider works mid-run).
// onStop(j, stop): a door is reached (pin popped). onProgress({mi, leg, done}): every frame. onPin(stop): pin click.
// signal: AbortSignal. id: the line's source id. source: the road's source; "estimate" (no road geometry, a straight
// line) flies flat (pitch 0, no bearing drift) over a dashed line, since a tilted ruler-straight line over city blocks
// reads as a flight path. pace: an extra speed-up, or (timeline) => speed-up (the building phase's cap). introMs/outroMs at 1×. paused(): true
// holds the line where it is (an offscreen hero). padding: the end fit's padding (room for overlays). Resolves {status: "done"|"aborted", markers: the day's pins}.
export async function followRoute(map, o) {
  const coords = Array.isArray(o.geometry) ? o.geometry : o.geometry.coordinates;
  const stops = o.stops ?? [];
  const id = o.id ?? "route";
  const color = o.color ?? DAY_COLOURS[0];
  let pace = typeof o.pace === "number" ? o.pace : 1; // a function of the timeline is read once it is known
  const speed = typeof o.speed === "function" ? () => clampSpeed(o.speed()) * pace : () => clampSpeed(o.speed ?? 1) * pace;
  const flat = o.source === "estimate";
  const dash = flat;
  const signal = o.signal;
  const idx = matchStops(coords, stops, { wayPoints: o.wayPoints });
  const tl = timeline(coords, idx);
  if (typeof o.pace === "function") pace = o.pace(tl);
  const legMi = o.legs?.length === stops.length ? o.legs.map((l) => l.mi) : tl.legs.map((l) => (l.to - l.from) * MI_PER_M);
  const markers = [];
  const pin = (j, cls) => markers.push(...addPins(map, [{ ...stops[j], n: stops[j].n ?? j + 1 }], { color, cls, onClick: o.onPin }));
  const width = o.width ?? 5;
  const total = stops.length;
  const fitAll = (duration) => map.fitBounds(boundsOf(coords), { padding: o.padding ?? fitPadding(map), pitch: 0, bearing: 0, duration, maxZoom: 15 });
  // pins a card must not cover: stop 1 most, then the start and the doors already reached
  const avoid = (j) => o.avoid === false ? null : [
    ...(o.start ? [{ lon: o.start.lon, lat: o.start.lat, w: 2 }] : []),
    ...stops.slice(0, j).map((s, k) => ({ lon: s.lon, lat: s.lat, w: k ? 1 : 6 })),
  ];

  // ?instant=1: the end state
  if (o.instant ?? isInstant()) {
    setRoute(map, coords, { id, color, width, paint: true, dash });
    stops.forEach((_, j) => { pin(j, ""); o.onStop?.(j, stops[j]); });
    o.onProgress?.({ mi: legMi.reduce((a, b) => a + b, 0), leg: total - 1, done: true });
    if (o.fit !== false) fitAll(0);
    return { status: "done", markers };
  }

  // reduced motion: no camera flight; the whole day is drawn, then each door's card shows in turn
  if (o.reduced ?? reducedMotion()) {
    setRoute(map, coords, { id, color, width, paint: true, dash });
    stops.forEach((_, j) => pin(j, ""));
    if (o.fit !== false) fitAll(0);
    for (let j = 0; j < total; j++) {
      const c = showCard(map, stops[j], { n: stops[j].n ?? j + 1, total, color, avoid: avoid(total)?.filter((p) => p.lon !== stops[j].lon || p.lat !== stops[j].lat) });
      o.onStop?.(j, stops[j]);
      o.onProgress?.({ mi: legMi.slice(0, j + 1).reduce((a, b) => a + b, 0), leg: j, done: j === total - 1 });
      const ok = await sleep((PAUSE_MS * 1.6) / speed(), signal);
      c.remove();
      if (!ok) return { status: "aborted", markers };
    }
    return { status: "done", markers };
  }

  const phone = o.phone ?? isPhone();
  const level = phone || flat; // no tilt, no bearing drift
  const pitch = level ? 0 : PITCH;
  // a smaller map zooms out (zoomFor is tuned for the ~1000 px plan map), so the head stays in view
  const zoomAt = (mi) => zoomFor(mi) - Math.max(phone ? 0.7 : 0, Math.log2(820 / Math.max(map.getContainer().clientWidth, 200)));
  // the head sits a little below the middle, so its card has room above it
  const lift = () => map.getContainer().clientHeight * (phone ? 0.16 : 0.12);
  const bearingAt = (d) => (level ? 0 : BEARING0 + 40 * (tl.cum.at(-1) ? d / tl.cum.at(-1) : 0));
  setRoute(map, [coords[0], coords[0]], { id, color, width, paint: true, dash });
  const src = map.getSource(id);
  raiseRoute(map, id);

  // intro: settle on the start, tilted
  map.stop();
  const introMs = (o.introMs ?? INTRO_MS) / speed();
  map.easeTo({ center: coords[0], zoom: zoomAt(legMi[0] ?? 1), pitch, bearing: bearingAt(0), duration: introMs, offset: [0, lift()], essential: true });
  await moved(map, introMs, signal);
  if (signal?.aborted) return { status: "aborted", markers };

  const status = await new Promise((res) => {
    const c0 = map.getCenter();
    let cam = [c0.lng, c0.lat];
    let zoom = map.getZoom();
    let t = 0;
    let last = performance.now();
    let reached = 0;
    let card = null;
    let raf = 0;
    const finish = (s) => { cancelAnimationFrame(raf); signal?.removeEventListener("abort", onAbort); card?.remove(); res(s); };
    const onAbort = () => finish("aborted");
    signal?.addEventListener("abort", onAbort, { once: true });
    const frame = (now) => {
      if (signal?.aborted) return;
      if (o.paused?.() || held) { last = now; raf = requestAnimationFrame(frame); return; }
      const s = speed();
      const dt = Math.min(100, now - last) * s; // animation ms this frame (a background tab doesn't jump the line)
      last = now;
      t += dt;
      const st = stateAt(tl, t);
      const line = lineTo(coords, tl.cum, st.d);
      src.setData({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: line } });
      while (reached < st.reached) {
        const j = reached++;
        pin(j, "pop");
        card?.hide(s);
        const box = map.getContainer();
        card = showCard(map, stops[j], { n: stops[j].n ?? j + 1, total, color, avoid: avoid(j), at: { x: box.clientWidth / 2, y: box.clientHeight / 2 + lift() } });
        o.onStop?.(j, stops[j]);
      }
      if (card && st.stop === null) { card.hide(s); card = null; }
      const hp = map.project(line.at(-1));
      const aim = map.unproject([hp.x, hp.y - lift()]);
      const k = follow(dt, CAM_TAU);
      cam = [cam[0] + (aim.lng - cam[0]) * k, cam[1] + (aim.lat - cam[1]) * k];
      const zLeg = st.stop === null ? st.leg : Math.min(st.stop + 1, total - 1);
      zoom += (zoomAt(legMi[Math.max(0, zLeg)] ?? 1) - zoom) * follow(dt, ZOOM_TAU);
      map.jumpTo({ center: cam, zoom, pitch, bearing: bearingAt(st.d) });
      map.redraw(); // draw this frame now, so the canvas and the DOM pins/cards move together
      o.onProgress?.({ mi: milesAt(tl, legMi, st.d), leg: st.leg, done: st.done });
      if (st.done) return finish("done");
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
  });
  if (status === "aborted") return { status, markers };

  // outro: pull back to the whole day, flat
  src.setData({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } });
  if (o.fit !== false) {
    const outMs = (o.outroMs ?? OUTRO_MS) / speed();
    fitAll(outMs);
    await moved(map, outMs, signal);
  }
  return { status: signal?.aborted ? "aborted" : "done", markers };
}

// ---------- the player: a plan's days on one map ----------
let active = null;
// The player on screen now (C2's demo script drives it: await activePlayer().play(0)).
export const activePlayer = () => active;

// map, wrap: the map and its positioned container (controls go in its corner). days(): [{start:{lat, lon}, stops:[…],
// color?, label?}] (stops as followRoute). selected(): the index of the day on screen. week(): true when the week view is
// on. visible(i): false hides day i's line and pins (G3 map layers; default every day). onPin(stop, dayIndex): a pin was
// clicked. onPlay(): the bar's ▶ Watch the route asks the caller which day to play (default: play the selected one).
// controls: render the Watch-the-route bar (default true).
// Events: listens for `doors:run-route` on window (detail {day?, all?, speed?, stop?}); dispatches `doors:route-state`
// {playing, day, all, speed, status} and `doors:route-stop` {day, index, stop} on window.
// One run at a time (createRunSlot): the building phase, a day or Play all. Starting one, or Stop, cancels the run in
// progress, and a cancelled run reports no more doors.
export function createRoutePlayer({ map, wrap, days, selected = () => 0, week = () => false, visible = () => true, onPin, onPlay = null, controls = true, fit = true }) {
  const pins = new Map(); // day → markers
  const shown = new Set(); // day indexes with a line on the map
  const slot = createRunSlot();
  let speed = clampSpeed(Number(qs().get("speed")) || 1);
  let playing = null; // {day} | {all: true} (Run the route / Play all; the building phase is not "playing")
  let destroyed = false;
  const lid = (i) => `route-d${i}`;
  const dayList = () => (days() ?? []).map((d, i) => ({ ...d, color: d.color ?? colourOf(i), stops: (d.stops ?? []).filter((s) => Number.isFinite(+s.lat) && Number.isFinite(+s.lon)) }));
  const emit = (name, detail) => window.dispatchEvent(new CustomEvent(name, { detail }));
  const state = (status) => emit("doors:route-state", { playing: !!playing, day: playing?.day ?? null, all: !!playing?.all, speed, status });
  const building = () => slot.current?.kind === "building" && !slot.current.ctl.signal.aborted;

  const clearDay = (i) => { clearMarkers(pins.get(i)); pins.delete(i); };
  // faint (judge pass 2, 30): another day's pins in one day's view: small, dimmed and unnumbered, so two "1"s don't stack
  const pinDay = (i, d, faint = false) => {
    clearDay(i);
    pins.set(i, addPins(map, d.stops.map((s, j) => (faint ? { ...s, n: "", cls: `${s.cls ?? ""} faint` } : { ...s, n: s.n ?? j + 1 })), { color: d.color, onClick: onPin ? (s) => onPin(s, i) : undefined }));
  };

  // Draw the resting state: every visible(i) day in full colour with its pins and its real road (dashed while it is the
  // straight-line estimate), the selected one on top (owner review 5: shown = shown in full); a day not visible(i), not
  // at all. fitView fits the whole week (G3: every tab keeps the same reference). Resolves once every road is in. Does
  // nothing while a run or the building phase owns the map (they draw it when they end).
  let drawTok = 0;
  let fitDue = false; // a fit asked for by a draw that a later one superseded still happens
  async function draw({ fitView = false } = {}) {
    queueMicrotask(ui); // the bar follows the view (the week vs a day); after the constructor (bar is declared below)
    const tok = ++drawTok;
    if (fitView) fitDue = true;
    const ds = dayList();
    const sel = selected();
    const wk = week();
    const rs = await Promise.all(ds.map((d) => (d.stops.length ? roadFor(d.start, d.stops) : null)));
    if (tok !== drawTok || destroyed || playing || building()) return rs;
    for (const i of [...shown]) if (i >= ds.length || !rs[i] || !visible(i)) { removeRoute(map, lid(i)); clearDay(i); shown.delete(i); }
    ds.forEach((d, i) => {
      if (!rs[i] || !visible(i)) return;
      const faint = !wk && ds[sel] && i !== sel; // judge pass 2 (30): one day's view puts the other days behind it
      setRoute(map, rs[i].geometry.coordinates, { id: lid(i), color: d.color, width: faint ? 3 : 4.5, opacity: faint ? 0.35 : 1, paint: true, dash: rs[i].source === "estimate" });
      shown.add(i);
      pinDay(i, d, faint);
    });
    if (ds[sel] && rs[sel] && !wk && visible(sel)) raiseRoute(map, lid(sel));
    // ---- V5 corridors (public/ui/corridor.js): the shown days' detour ellipses under the lines ----
    drawCorridors(map, ds, { show: (i) => !!rs[i] && visible(i), sel: wk ? -1 : sel });
    if (fitDue) {
      fitDue = false;
      // a phone-width map (audit 2 #5): the week made the selected day a small cluster on a short map, so it fits that day
      const one = !wk && rs[sel] && map.getContainer().clientWidth <= 700;
      const pts = one ? rs[sel].geometry.coordinates : rs.flatMap((r) => r?.geometry.coordinates ?? []);
      if (pts.length) map.fitBounds(boundsOf(pts), { padding: clearOf(map, wrap?.querySelector(".weeklegend:not([hidden])")), pitch: 0, bearing: 0, duration: 0, maxZoom: 15 });
    }
    return rs;
  }

  // One day's follow, inside run `run` (a slot token). A cancelled run's doors are not reported and its pins go.
  async function playDay(i, run, { onStop, onProgress, fitEnd = true, pace, introMs, outroMs } = {}) {
    const signal = run.ctl.signal;
    const d = dayList()[i];
    if (!d?.stops.length) return { status: "empty" };
    const road = await roadFor(d.start, d.stops);
    if (signal.aborted) return { status: "aborted" };
    clearDay(i);
    const r = await followRoute(map, {
      geometry: road.geometry, wayPoints: road.wayPoints, legs: road.legs, source: road.source, stops: d.stops, start: d.start, color: d.color,
      id: lid(i), speed: () => speed, pace, introMs, outroMs, signal, fit: fitEnd && fit, instant: isInstant(),
      onPin: onPin ? (s) => onPin(s, i) : undefined,
      onStop: (j, s) => {
        if (!slot.report(run, `${i}:${j}`)) return;
        onStop?.(j, s);
        emit("doors:route-stop", { day: i, index: j, stop: s });
      },
      onProgress: (p) => { if (!signal.aborted) onProgress?.(p); },
    });
    if (r.status === "aborted" || signal.aborted) { clearMarkers(r.markers); return { status: "aborted", road }; }
    shown.add(i);
    pins.set(i, r.markers);
    return { ...r, road };
  }

  // Play one day (default: the selected one). Resolves {status}.
  async function play(i = selected(), opts = {}) {
    map.stop();
    const run = slot.claim("play");
    playing = { day: i };
    ui();
    state("playing");
    // the other days go faint and lose their pins; this one starts empty
    dayList().forEach((_, k) => {
      if (k === i) return;
      clearDay(k);
      if (map.getLayer(lid(k))) { map.setPaintProperty(lid(k), "line-opacity", 0.3); map.setPaintProperty(`${lid(k)}-case`, "line-opacity", 0.27); map.setPaintProperty(lid(k), "line-width", 3); }
    });
    const r = await playDay(i, run, opts);
    if (slot.current === run) finish(run, r.status);
    else slot.end(run, r.status);
    return r;
  }

  // Play every day in turn, each in its colour, ending on the week.
  async function playAll(opts = {}) {
    map.stop();
    const run = slot.claim("all");
    const signal = run.ctl.signal;
    playing = { all: true, day: 0 };
    ui();
    state("playing");
    const ds = dayList();
    ds.forEach((_, k) => { if (shown.has(k)) { removeRoute(map, lid(k)); shown.delete(k); } clearDay(k); });
    let status = "done";
    for (let i = 0; i < ds.length; i++) {
      if (!ds[i].stops.length) continue;
      if (playing.day !== i) {
        playing.day = i;
        state("playing");
      }
      const r = await playDay(i, run, { ...opts, fitEnd: i === ds.length - 1 });
      if (r.status === "aborted") { status = "aborted"; break; }
      if (map.getLayer(lid(i))) { map.setPaintProperty(lid(i), "line-width", 4.5); }
    }
    if (slot.current !== run) {
      slot.end(run, status);
      return { status };
    }
    if (status === "done" && fit) {
      const pts = (await Promise.all(ds.map((d) => (d.stops.length ? roadFor(d.start, d.stops) : null)))).flatMap((r) => r?.geometry.coordinates ?? []);
      if (pts.length && !signal.aborted) {
        const ms = isInstant() || reducedMotion() ? 0 : OUTRO_MS / speed;
        map.fitBounds(boundsOf(pts), { padding: fitPadding(map), pitch: 0, bearing: 0, duration: ms, maxZoom: 15 });
      }
    }
    if (slot.current === run) finish(run, status, { allShown: true });
    else slot.end(run, status);
    return { status };
  }

  function finish(run, status, { allShown = false } = {}) {
    if (!slot.end(run, status)) return;
    playing = null;
    ui();
    state(status);
    // back to the resting state (keep the camera where the run left it)
    if (!allShown) draw();
    else dayList().forEach((d, i) => { if (!pins.has(i) && d.stops.length && shown.has(i)) pinDay(i, d); });
  }

  // Stop the run in progress (a day, Play all, or the building phase): the day(s) are drawn whole. The building phase
  // ends itself (runBuilding draws the plan when its run is cancelled).
  function stop(redraw = true, reason = "stop") {
    const run = slot.current;
    if (!run) return;
    slot.cancel(reason);
    map.stop();
    if (run.kind === "building") return;
    slot.end(run, "stopped");
    playing = null;
    if (redraw) { ui(); state("stopped"); draw({ fitView: true }); }
  }

  function setSpeed(x) {
    speed = clampSpeed(x);
    if (bar) { bar.querySelector("input").value = String(SPEEDS.indexOf(speed)); bar.querySelector("output").textContent = `${speed}×`; }
    state(playing ? "playing" : "idle");
  }

  // ---------- the Run-the-route bar ----------
  let bar = null;
  function ui() {
    if (!bar) return;
    const busy = !!playing;
    bar.classList.toggle("busy", busy);
    // the week shows Watch all days only: there both buttons played every day (Jard 10-23: one button per thing)
    bar.querySelector(".rb-play").hidden = busy || !!wrap.querySelector("[data-run-route]") || (week() && dayList().filter((d) => d.stops.length).length > 1);
    bar.querySelector(".rb-stop").hidden = !busy;
    bar.querySelector(".rb-all").hidden = dayList().filter((d) => d.stops.length).length < 2;
    bar.classList.toggle("empty", bar.querySelector(".rb-play").hidden && bar.querySelector(".rb-stop").hidden); // a phone shows neither the slider nor Watch all (css): nothing left → no bar
  }
  if (controls && wrap) {
    bar = document.createElement("div");
    bar.className = "runbar";
    bar.setAttribute("role", "group");
    bar.setAttribute("aria-label", "Watch the route");
    bar.innerHTML = `<button type="button" class="btn sm rb-play">${icon("play", 14, "ic l")}Watch the route</button>
      <button type="button" class="btn sm rb-stop" hidden>${icon("stop", 14, "ic l")}Stop</button>
      <label class="rb-speed" title="Speed"><span class="sr">Speed</span>
        <input type="range" min="0" max="${SPEEDS.length - 1}" step="1" value="${SPEEDS.indexOf(speed)}" aria-valuetext="${speed}×">
        <output aria-hidden="true">${speed}×</output></label>
      <button type="button" class="btn sm rb-all"><span>Watch all<span class="long"> days</span></span></button>`;
    wrap.append(bar);
    bar.querySelector(".rb-play").addEventListener("click", () => (onPlay ? onPlay() : play())); // the plan picks the day (or all, from All days)
    bar.querySelector(".rb-stop").addEventListener("click", () => stop());
    bar.querySelector(".rb-all").addEventListener("click", () => playAll());
    const range = bar.querySelector("input");
    range.addEventListener("input", () => { setSpeed(SPEEDS[+range.value]); range.setAttribute("aria-valuetext", `${speed}×`); });
    ui();
  }
  const onRun = (e) => {
    const d = e.detail ?? {};
    if (d.speed != null) setSpeed(d.speed);
    if (d.stop) return stop(true, d.reason ?? "stop");
    if (d.all) playAll(); else play(Number.isInteger(d.day) ? d.day : selected());
  };
  window.addEventListener("doors:run-route", onRun);

  const player = {
    draw, play, playAll, stop, setSpeed,
    get speed() { return speed; },
    get playing() { return !!playing; },
    get building() { return building(); },
    get map() { return map; },
    showControls(on) { bar?.classList.toggle("off", !on); },
    // for runBuilding
    _slot: slot,
    _playDay: playDay,
    _road: (i) => { const d = dayList()[i]; return d?.stops.length ? roadFor(d.start, d.stops) : Promise.resolve(null); },
    destroy() {
      destroyed = true;
      stop(false);
      window.removeEventListener("doors:run-route", onRun);
      for (const i of pins.keys()) clearDay(i);
      bar?.remove();
      if (active === player) active = null;
    },
  };
  active = player;
  return player;
}

// ---------- the building phase (§3.3) ----------
// player: from createRoutePlayer. root: the plan view; its data-b2 attribute names the beat ("rank" → "plan" →
// "route"; removed once the plan is whole) so the CSS shows each part of the plan only at its pill step, and a press
// inside it (a tab, Week, a row, the toolbar, the map) cancels the phase, as does Run the route or Stop.
// ranked: [[lon, lat], …] the pool in rank order; kept: Set of indexes into `ranked` that made the plan.
// text: {ranking, ranked, planning, routing, ready} pill lines, caption(n) and kept: the ranking caption's two lines.
// reveal(j): list row j of day `day` appears; revealAll(). hideLayers: map layer ids hidden during the phase.
// Beats at 1× (BUILD in ../lib/follow.js): rooms appear and are counted 1.1 s, the closed ones fade 1.3 s, day tabs
// 0.6 s, then day 1's follow, sped up so the whole phase stays ≤ 16 s. Resolves "done", "skipped" (Skip, Escape) or
// "cancelled" (any other press, or a run started); it ends once, with the whole plan on screen.
// Dispatches doors:building {stage: "rank" | "cull" | "plan" | "route" | "done" | "skipped" | "cancelled"} on window.
export async function runBuilding(player, { wrap, root = wrap, ranked = [], kept = new Set(), text = {}, reveal, revealAll, hideLayers = [], day = 0 }) {
  const map = player.map;
  if (isInstant()) {
    delete root.dataset.b2;
    revealAll?.();
    await player.draw({ fitView: true });
    // said like every other ending, so whoever follows the phase (the steps card in ui/plan.js, the demo) sees it end;
    // without it the steps card stayed on screen, unticked, under ?instant=1
    window.dispatchEvent(new CustomEvent("doors:building", { detail: { stage: "skipped" } }));
    return "skipped";
  }
  const slot = player._slot;
  const run = slot.claim("building");
  const signal = run.ctl.signal;
  const stage = (s) => {
    if (s === "rank" || s === "plan" || s === "route") root.dataset.b2 = s;
    window.dispatchEvent(new CustomEvent("doors:building", { detail: { stage: s } }));
  };
  stage("rank");
  const still = reducedMotion();
  const sp = () => player.speed;
  const wait = (ms) => sleep(still ? Math.min(ms, 400) : ms / sp(), signal);
  const aborted = new Promise((res) => signal.addEventListener("abort", () => res(null), { once: true }));
  const roadP = player._road(day); // day 1's road loads during the ranking beat
  player.showControls(false);
  wrap.classList.add("b2-building");
  // the plan view can go (Edit profile, another plan, the demo closing) while this runs: its map is removed under us
  const live = () => !map._removed && !!map.style;
  const vis = (on) => live() && hideLayers.forEach((l) => map.getLayer(l) && map.setLayoutProperty(l, "visibility", on ? "visible" : "none"));
  vis(false);

  // any press cancels: Skip and Escape skip to the plan, anything else hands the plan over at once
  const PRESS = "button, a, input, select, label, [data-tab], .stop, .maplibregl-marker";
  const onPress = (e) => {
    if (e.type === "keydown") {
      if (e.key === "Escape") return void slot.cancel("skip");
      if (e.key !== "Enter" && e.key !== " ") return;
    }
    const t = e.target instanceof Element ? e.target : null;
    if (!t || !root.contains(t)) return;
    if (t.closest(".bpill .skip")) return void slot.cancel("skip");
    // a mouse on the map takes the camera back; a finger there may just be scrolling the page
    if (t.closest(PRESS) || (t.closest(".maplibregl-canvas") && e.pointerType === "mouse")) slot.cancel("user");
  };
  root.addEventListener("pointerdown", onPress, true);
  window.addEventListener("keydown", onPress, true);

  const pill = document.createElement("div");
  pill.className = "bpill";
  pill.setAttribute("role", "status");
  pill.innerHTML = `<i class="dot"></i><span class="t"></span><button type="button" class="skip">Skip ▸</button>`;
  const miles = document.createElement("div");
  miles.className = "bmiles";
  miles.innerHTML = `<b>0.0</b><span>miles</span>`;
  miles.hidden = true;
  const caption = document.createElement("div");
  caption.className = "bcap";
  caption.innerHTML = `<b></b><span></span>`;
  wrap.append(pill, miles, caption);
  // the pill never runs under the map's toolbar (Start my day…): a long line drops it under the toolbar (judge pass 2)
  const clearTools = () => {
    pill.style.top = "";
    const btns = [...(wrap.querySelector(".tools")?.children ?? [])].filter((b) => b.getClientRects().length && getComputedStyle(b).visibility !== "hidden");
    if (!btns.length) return;
    const p = pill.getBoundingClientRect();
    const rs = btns.map((b) => b.getBoundingClientRect());
    if (rs.some((b) => p.right + 8 > b.left && p.left < b.right && p.top < b.bottom && p.bottom > b.top)) pill.style.top = `${Math.round(Math.max(...rs.map((b) => b.bottom)) - wrap.getBoundingClientRect().top + 10)}px`;
  };
  const say = (t) => { pill.querySelector(".t").textContent = t; clearTools(); };
  pill.querySelector(".skip").addEventListener("click", () => slot.cancel("skip"));

  // ranked rooms as dots: they appear in rank order, then the ones that didn't make the plan fade
  const SRC = "b2-ranked";
  const fc = (pts) => ({ type: "FeatureCollection", features: pts.map(([c, k]) => ({ type: "Feature", properties: { k: k ? 1 : 0 }, geometry: { type: "Point", coordinates: c } })) });
  const all = ranked.map((c, i) => [c, kept.has(i)]);
  map.addSource(SRC, { type: "geojson", data: fc([]) });
  map.addLayer({
    id: SRC, type: "circle", source: SRC,
    paint: {
      "circle-radius": 4.5, "circle-color": "#6F6A60", "circle-opacity": 0.85, "circle-stroke-color": "#fff", "circle-stroke-width": 1,
      "circle-opacity-transition": { duration: 700 }, "circle-color-transition": { duration: 700 }, "circle-radius-transition": { duration: 500 },
    },
  });
  const cleanup = () => {
    if (!live()) return;
    if (map.getLayer(SRC)) map.removeLayer(SRC);
    if (map.getSource(SRC)) map.removeSource(SRC);
    vis(true);
  };
  const end = async (status = run.reason === "skip" ? "skipped" : "cancelled") => {
    if (!slot.end(run, status)) return run.ended;
    root.removeEventListener("pointerdown", onPress, true);
    window.removeEventListener("keydown", onPress, true);
    delete root.dataset.b2;
    revealAll?.();
    cleanup();
    caption.remove();
    wrap.classList.remove("b2-building");
    stage(status);
    if (status === "cancelled") {
      // the rep took over: no pill in their way
      pill.remove();
      miles.remove();
      player.showControls(true);
    } else {
      say(text.ready ?? "Your plan is ready");
      pill.classList.add("ready");
      // the pill holds the corner for a moment, then gives it back to the Run-the-route bar
      const hold = status === "done" ? 2600 : 1400;
      setTimeout(() => { pill.classList.add("gone"); miles.classList.add("gone"); }, hold);
      setTimeout(() => { pill.remove(); miles.remove(); player.showControls(true); }, hold + 400);
    }
    // Skip fits the day; after a press, that press owns the camera (a row flies to its door, a tab fits its day)
    if (live()) await player.draw({ fitView: status === "skipped" });
    return status;
  };

  try {
    // 1 · ranking: the rooms appear in rank order and the caption counts them (the Qloo moment, on its own)
    say(text.ranking ?? "Ranking the city's bars and restaurants…");
    // frame the nearest 90% of the rooms (with every kept one): a few far suburbs shouldn't shrink the city to a dot
    if (ranked.length) {
      const mid = [median(ranked.map((c) => c[0])), median(ranked.map((c) => c[1]))];
      const near = ranked.map((c, i) => [metres(mid, c), i]).sort((a, b) => a[0] - b[0]);
      const core = near.filter(([, i], k) => k < Math.ceil(near.length * 0.9) || kept.has(i)).map(([, i]) => ranked[i]);
      map.fitBounds(boundsOf(core), { padding: fitPadding(map), duration: still ? 0 : 700 / sp(), pitch: 0, bearing: 0, maxZoom: 13.5 });
    }
    const steps = still ? 1 : 12;
    for (let s = 1; s <= steps; s++) {
      const n = Math.ceil((all.length * s) / steps);
      if (live()) map.getSource(SRC)?.setData(fc(all.slice(0, n)));
      caption.firstElementChild.textContent = text.caption?.(n) ?? `${n} doors ranked`;
      if (s === 1) requestAnimationFrame(() => caption.classList.add("in"));
      if (!(await wait(BUILD.rankIn / steps))) return end();
    }
    // 2 · the ones that can't fit fade
    stage("cull");
    say(text.ranked ?? `${ranked.length} doors ranked · keeping the ones open when you're free`);
    caption.lastElementChild.textContent = text.kept ?? "";
    caption.classList.add("kept");
    if (!live()) return end();
    map.setPaintProperty(SRC, "circle-opacity", ["case", ["==", ["get", "k"], 1], 0.95, 0.18]);
    map.setPaintProperty(SRC, "circle-color", ["case", ["==", ["get", "k"], 1], DAY_COLOURS[day] ?? DAY_COLOURS[0], "#9A968C"]);
    map.setPaintProperty(SRC, "circle-radius", ["case", ["==", ["get", "k"], 1], 5.5, 3.5]);
    if (!(await wait(BUILD.cull))) return end();
    // 3 · planning: the day tabs and the day's name
    stage("plan");
    say(text.planning ?? "Planning your first day…");
    caption.classList.remove("in");
    if (!(await wait(BUILD.plan))) return end();
    // 4 · routing: the camera follows day 1, rows fill in as its doors are reached, miles count up
    stage("route");
    say(text.routing ?? "Routing from your start…");
    const road = await Promise.race([roadP, aborted]);
    if (signal.aborted) return end();
    miles.lastElementChild.textContent = road?.source === "ors" ? "miles" : "miles, estimated";
    miles.hidden = false;
    const r = await player._playDay(day, run, {
      pace: buildPace, introMs: BUILD.intro, outroMs: BUILD.outro,
      onStop: (j) => { reveal?.(j); if (text.routingStop) say(text.routingStop(j)); },
      onProgress: ({ mi }) => { miles.firstElementChild.textContent = mi.toFixed(1); },
    });
    return end(r.status === "aborted" || signal.aborted ? undefined : "done");
  } finally {
    if (live() && map.getSource(SRC)) cleanup();
  }
}
