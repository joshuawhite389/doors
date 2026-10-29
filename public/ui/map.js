// The Doors map (SPEC-V2 §5): MapLibre GL with OpenFreeMap Positron recoloured to Doors. Fallback chain: self-hosted
// Protomaps (public/tiles/<city>.pmtiles) → OSM raster. Force a step with ?map=protomaps or ?map=raster.
// Needs the maplibre-gl@5.24.0 script on the page (window.maplibregl); pmtiles and basemaps load only on fallback.
// Every library, glyph and sprite is served from our own origin (public/vendor/, see its README): only the tiles of the
// top style (OpenFreeMap) and of the last fallback (OSM raster) come from elsewhere.
import { icon } from "../lib/icons.js"; // the Doors icon set (Jard 10-24 #1)

export const DAY_COLOURS = ["#E07B2A", "#2F5D4E", "#3E6FB0", "#8B5CF6", "#B4533C", "#0F8A8A", "#6B7280"];
const OFM_STYLE = "https://tiles.openfreemap.org/styles/positron";
const OFM_ATTRIB = '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">© OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
const PM_ATTRIB = '<a href="https://protomaps.com" target="_blank" rel="noopener">Protomaps</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';
const OSM_ATTRIB = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors';
const LIBS = {
  pmtiles: "/vendor/pmtiles-4.5.0/pmtiles.js",
  basemaps: "/vendor/protomaps-basemaps-5.7.2/basemaps.js",
};
export const HEALTH_MS = 6000; // no `idle` within this → next style in the chain

// Recolour OpenFreeMap Positron to the Doors palette: warm paper, soft water, quiet labels; the route stays the only loud thing.
export function doorsColours(st) {
  for (const l of st.layers) {
    const id = l.id, p = (l.paint ??= {});
    if (l.type === "background") p["background-color"] = "#F3F0E8";
    else if (/water/.test(id) && l.type === "fill") p["fill-color"] = "#D6E0DF";
    else if (/water/.test(id) && l.type === "line") p["line-color"] = "#D6E0DF";
    else if (/park|landcover|landuse|wood|grass/.test(id) && l.type === "fill") { p["fill-color"] = "#E6E8DB"; p["fill-opacity"] = 0.8; }
    else if (/building/.test(id) && l.type === "fill") p["fill-color"] = "#E9E4DA";
    else if (/aeroway/.test(id) && l.type === "fill") p["fill-color"] = "#ECE8DF";
    else if (/highway|road|bridge|tunnel/.test(id) && l.type === "line") p["line-color"] = /casing/.test(id) ? "#E0DACB" : /motorway|trunk|major/.test(id) ? "#FBF6EC" : "#FFFFFF";
    else if (/boundary|admin/.test(id) && l.type === "line") p["line-color"] = "#D3CDBF";
    else if (l.type === "symbol") { p["text-color"] = "#8E897E"; p["text-halo-color"] = "#F3F0E8"; }
  }
  return st;
}

// ?map=protomaps|raster forces a fallback; anything else starts at the top of the chain.
export function mapChain(search = "") {
  const f = new URLSearchParams(search).get("map");
  if (f === "raster") return ["raster"];
  if (f === "protomaps") return ["protomaps", "raster"];
  return ["doors", "protomaps", "raster"];
}

const loaded = {};
function loadScript(src) {
  return (loaded[src] ??= new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = res;
    s.onerror = () => rej(new Error(`could not load ${src}`));
    document.head.append(s);
  }));
}

// Our vendored fonts sit in folders without spaces ("Noto-Sans-Regular"): a static host need not decode %20.
export const ownGlyphs = (url, type) => (type === "Glyphs" && url.startsWith(`${location.origin}/vendor/`) ? { url: url.replace(/%20| /g, "-") } : undefined);

let ofm = null;
let pmProtocol = false;
async function styleFor(kind, city) {
  if (kind === "doors") {
    ofm ??= fetch(OFM_STYLE).then((r) => {
      if (!r.ok) throw new Error(`style ${r.status}`);
      return r.json();
    });
    const st = doorsColours(structuredClone(await ofm.catch((e) => { ofm = null; throw e; })));
    for (const s of Object.values(st.sources ?? {})) if (s.type === "vector") s.attribution = OFM_ATTRIB;
    return st;
  }
  if (kind === "protomaps") {
    await loadScript(LIBS.pmtiles);
    await loadScript(LIBS.basemaps);
    if (!pmProtocol) { window.maplibregl.addProtocol("pmtiles", new window.pmtiles.Protocol().tile); pmProtocol = true; }
    const url = new URL(`/tiles/${city}.pmtiles`, location.origin).href;
    return {
      version: 8,
      glyphs: `${location.origin}/vendor/basemaps-assets/fonts/{fontstack}/{range}.pbf`,
      sprite: `${location.origin}/vendor/basemaps-assets/sprites/v4/light`,
      sources: { protomaps: { type: "vector", url: `pmtiles://${url}`, attribution: PM_ATTRIB } },
      layers: window.basemaps.layers("protomaps", window.basemaps.namedFlavor("light"), { lang: "en" }),
    };
  }
  return {
    version: 8,
    sources: { osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, maxzoom: 19, attribution: OSM_ATTRIB } },
    layers: [
      { id: "bg", type: "background", paint: { "background-color": "#F3F0E8" } },
      { id: "osm", type: "raster", source: "osm", paint: { "raster-saturation": -1, "raster-contrast": -0.25, "raster-brightness-min": 0.12, "raster-opacity": 0.8 } },
    ],
  };
}

// Resolves true once the map is idle with (almost) no tile errors, false on a burst of errors or no idle in time.
function healthy(map, ms = HEALTH_MS) {
  return new Promise((res) => {
    let errors = 0;
    const done = (ok) => { clearTimeout(t); map.off("idle", onIdle); map.off("error", onErr); res(ok); };
    const onIdle = () => done(errors < 3);
    const onErr = () => { if (++errors >= 3) done(false); };
    const t = setTimeout(() => done(false), ms);
    map.on("idle", onIdle);
    map.on("error", onErr);
  });
}

// Create a map in `el`, centred on `view` ({bounds:[[w,s],[e,n]]} or {center:[lon,lat], zoom}), walking the fallback
// chain. Resolves {map, kind}; add layers and markers after it resolves (a style switch would drop them).
export async function createMap(el, { city, view = {}, interactive = true, search = location.search, onKind } = {}) {
  const gl = window.maplibregl;
  if (!gl) throw new Error("MapLibre GL is not loaded");
  let map = null;
  let kind = null;
  for (const k of mapChain(search)) {
    let style;
    try { style = await styleFor(k, city); } catch { continue; }
    kind = k;
    if (!map) {
      map = new gl.Map({
        container: el, style, attributionControl: { compact: true }, interactive, scrollZoom: interactive, dragRotate: false, transformRequest: ownGlyphs,
        pitchWithRotate: false, touchPitch: false, canvasContextAttributes: { preserveDrawingBuffer: true },
        ...(view.bounds ? { bounds: view.bounds, fitBoundsOptions: { padding: view.padding ?? 40 } } : { center: view.center, zoom: view.zoom ?? 12 }),
      });
      if (interactive) { map.addControl(new gl.NavigationControl({ showCompass: false }), "bottom-right"); map.addControl(fullControl(), "bottom-right"); } // the full-screen button lands above the zoom buttons (a bottom corner stacks upward)
    } else map.setStyle(style);
    onKind?.(k);
    if (await healthy(map)) break;
  }
  if (!map.isStyleLoaded()) await Promise.race([new Promise((r) => map.once("style.load", r)), new Promise((r) => setTimeout(r, 3000))]);
  collapseAttribution(el);
  map.resize();
  el.dataset.mapKind = kind; // screenshots and tests can read which base map won
  return { map, kind };
}

// round 8 (Jard 10-28: "a full screen map button for all versions"): a button over the zoom buttons makes the map's box
// fill the screen. The Fullscreen API where the browser has it (desktop, Android, iPad); iPhone Safari has none for a
// div, so there the box goes position:fixed over the page (MapLibre's own pseudo-fullscreen class). Whatever sits
// inside the map's box (the zoom buttons, the plan's layer menu) comes along. The button turns into a shrink icon, an
// Exit full screen button appears top-right, and Escape exits too; the map's view is kept either way.
export function fullControl() {
  let map, el, btn, exit, onKey, onChange;
  const fsEl = () => document.fullscreenElement ?? document.webkitFullscreenElement ?? null;
  const isFull = () => el.classList.contains("maplibregl-pseudo-fullscreen") || (!!fsEl() && fsEl() === el);
  const api = () => !!(el.requestFullscreen || el.webkitRequestFullscreen) && (document.fullscreenEnabled ?? document.webkitFullscreenEnabled ?? true);
  const paint = () => {
    const on = isFull();
    btn.className = on ? "maplibregl-ctrl-shrink" : "maplibregl-ctrl-fullscreen";
    btn.title = btn.ariaLabel = on ? "Exit full screen" : "Full screen";
    btn.setAttribute("aria-label", btn.title);
    exit.hidden = !on;
    // the view is kept exactly: resize() alone drifted the centre (and on a phone the zoom) when the box shrank back
    const view = { center: map.getCenter(), zoom: map.getZoom(), bearing: map.getBearing(), pitch: map.getPitch() };
    el.classList.toggle("mapfull", on);
    map.resize();
    map.jumpTo(view);
  };
  const pseudo = (on) => { el.classList.toggle("maplibregl-pseudo-fullscreen", on); paint(); };
  const enter = () => {
    if (!api()) return pseudo(true);
    const p = el.requestFullscreen ? el.requestFullscreen() : el.webkitRequestFullscreen();
    Promise.resolve(p).catch(() => pseudo(true));
  };
  const leave = () => {
    if (el.classList.contains("maplibregl-pseudo-fullscreen")) return pseudo(false);
    if (fsEl() === el) Promise.resolve(document.exitFullscreen ? document.exitFullscreen() : document.webkitExitFullscreen?.()).catch(() => {});
  };
  const toggle = () => (isFull() ? leave() : enter());
  return {
    onAdd(m) {
      map = m; el = map.getContainer();
      const box = div("maplibregl-ctrl maplibregl-ctrl-group", "");
      btn = document.createElement("button");
      btn.type = "button";
      btn.innerHTML = `<span class="maplibregl-ctrl-icon" aria-hidden="true"></span>`;
      btn.addEventListener("click", toggle);
      box.appendChild(btn);
      exit = div("mapfull-exit", `<button type="button" class="btn sm">Exit full screen</button>`);
      exit.hidden = true;
      exit.firstElementChild.addEventListener("click", leave);
      el.appendChild(exit);
      onKey = (e) => { if (e.key === "Escape" && el.classList.contains("maplibregl-pseudo-fullscreen")) pseudo(false); };
      onChange = () => paint();
      document.addEventListener("keydown", onKey);
      document.addEventListener("fullscreenchange", onChange);
      document.addEventListener("webkitfullscreenchange", onChange);
      paint();
      return box;
    },
    onRemove() {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
      exit.remove();
    },
  };
}

// Attribution starts collapsed (the ⓘ button opens it).
export function collapseAttribution(el) {
  el.querySelectorAll(".maplibregl-compact-show").forEach((x) => x.classList.remove("maplibregl-compact-show"));
}

const div = (cls, html) => {
  const d = document.createElement("div");
  d.className = cls;
  d.innerHTML = html;
  return d;
};

// A route line with a white casing. coords = [[lon, lat], …]. Calling again with the same id replaces the data, and
// the colour/width/opacity/dash when given (the route player fades unselected days this way). dash: a dashed line,
// for a day that has no road geometry yet (the straight-line estimate).
export const DASH = [1.1, 2.1]; // in line widths; the round caps lengthen each dash by one width
export function setRoute(map, coords, { id = "route", color = DAY_COLOURS[0], width = 4.5, opacity = 1, paint = false, dash = false } = {}) {
  const data = { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: coords } };
  const src = map.getSource(id);
  if (src) {
    src.setData(data);
    if (paint && map.getLayer(id)) {
      map.setPaintProperty(`${id}-case`, "line-width", width + 4);
      map.setPaintProperty(`${id}-case`, "line-opacity", 0.9 * opacity);
      map.setPaintProperty(id, "line-color", color);
      map.setPaintProperty(id, "line-width", width);
      map.setPaintProperty(id, "line-opacity", opacity);
      map.setPaintProperty(id, "line-dasharray", dash ? DASH : null);
    }
    return;
  }
  map.addSource(id, { type: "geojson", data });
  map.addLayer({ id: `${id}-case`, type: "line", source: id, layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": "#fff", "line-width": width + 4, "line-opacity": 0.9 * opacity } });
  map.addLayer({ id, type: "line", source: id, layout: { "line-join": "round", "line-cap": "round" }, paint: { "line-color": color, "line-width": width, "line-opacity": opacity, ...(dash ? { "line-dasharray": DASH } : {}) } });
}

// Grey dots for the other ranked rooms. pts = [[lon, lat], …]
export function setDots(map, pts, { id = "others", color = "#B9B5AC", opacity = 0.75, radius = 4 } = {}) {
  const data = { type: "FeatureCollection", features: pts.map((c) => ({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: c } })) };
  const src = map.getSource(id);
  if (src) return src.setData(data);
  map.addSource(id, { type: "geojson", data });
  map.addLayer({ id, type: "circle", source: id, paint: { "circle-radius": radius, "circle-color": color, "circle-opacity": opacity } });
}

// Numbered pins. stops = [{lat, lon, n, color?, cls?}]. Returns the markers (remove with clearMarkers).
export function addPins(map, stops, { color = null, cls = "", onClick } = {}) {
  return stops.map((s) => {
    const bg = s.color ?? color; // a stop may carry its own colour / class (a visited door is green)
    const el = div("", `<div class="mpin ${s.cls ?? cls}"${bg ? ` style="background:${bg}"` : ""}>${s.n}</div>`);
    if (onClick) { el.style.cursor = "pointer"; el.addEventListener("click", () => onClick(s)); }
    return new window.maplibregl.Marker({ element: el }).setLngLat([s.lon, s.lat]).addTo(map);
  });
}

export function addStart(map, { lat, lon }, { draggable = false } = {}) {
  return new window.maplibregl.Marker({ element: div("", `<div class="mstart" title="Your start">${icon("home", 17)}</div>`), draggable }).setLngLat([lon, lat]).addTo(map);
}

export const clearMarkers = (ms) => ms?.forEach((m) => m.remove());

// Remove a route line (both layers and the source), if it is there.
export function removeRoute(map, id) {
  for (const l of [id, `${id}-case`]) if (map.getLayer(l)) map.removeLayer(l);
  if (map.getSource(id)) map.removeSource(id);
}

// Bring a route line (casing + line) above the other routes.
export function raiseRoute(map, id) {
  if (!map.getLayer(id)) return;
  map.moveLayer(`${id}-case`);
  map.moveLayer(id);
}

export function boundsOf(coords) {
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of coords) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
  return [[w, s], [e, n]];
}

export function fitTo(map, coords, { padding = 60, duration = 0 } = {}) {
  if (!coords.length) return;
  map.fitBounds(boundsOf(coords), { padding, duration, maxZoom: 15 });
}

// C1: fly in to one stop (pitch ~45° on desktop, flat on a phone; no flight with reduced motion). padding moves the
// centre clear of a bottom sheet or a side panel.
export function flyToStop(map, { lat, lon }, { pitch = 45, zoom = 15.5, reduced = false, padding = null } = {}) {
  if (!map || !Number.isFinite(lat) || !Number.isFinite(lon)) return;
  const opts = { center: [lon, lat], zoom: Math.max(zoom, Math.min(map.getZoom(), 17)), pitch, bearing: pitch ? -12 : 0, ...(padding ? { padding } : {}) };
  if (reduced) map.jumpTo(opts);
  else map.flyTo({ ...opts, duration: 1400, essential: false });
}

const attr = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// G3: the other ranked rooms as rank-numbered markers (a white tile with an ink border: reads on every base map).
// rooms = [{id, lat, lon, n, name}]. onClick(room, marker). Returns the markers (remove with clearMarkers).
export function addRankPins(map, rooms, { onClick } = {}) {
  return rooms.map((r) => {
    const el = div("", `<button type="button" class="mrank${r.added ? " added" : ""}" aria-label="${attr(r.name ?? "Ranked door")}${r.n ? `, ranked ${r.n}` : ""}">${r.n ? `#${r.n}` : "•"}</button>`); // "#14": a rank, never read as stop 14
    if (onClick) el.firstChild.addEventListener("click", (e) => { e.stopPropagation(); onClick(r, m); });
    const m = new window.maplibregl.Marker({ element: el }).setLngLat([r.lon, r.lat]).addTo(map);
    return m;
  });
}

// Intuitiveness audit #6: Your list's "#41" tags piled up on the day pins downtown. Best rank first, a tag keeps its
// number only where it clears the day pins, the starts and the tags already kept; the rest shrink to a small dot (the
// rank stays in its label and on its card). Run again after every move. markers: addRankPins' (any order), each with
// rooms[i] = {n}. Pure geometry is in rankTagsShown, for the tests.
export function rankTagsShown(tags, blockers, { pad = 2 } = {}) {
  const hit = (a, b) => a.x - pad < b.x + b.w && b.x - pad < a.x + a.w && a.y - pad < b.y + b.h && b.y - pad < a.y + a.h;
  const kept = [];
  const show = new Set();
  for (const t of [...tags].sort((a, b) => (a.n ?? Infinity) - (b.n ?? Infinity))) {
    if (blockers.some((b) => hit(t, b)) || kept.some((k) => hit(t, k))) continue;
    kept.push(t);
    show.add(t.i);
  }
  return show;
}
export function declutterRanks(map, markers, rooms) {
  if (!map || !markers?.length) return;
  const box = map.getContainer().getBoundingClientRect();
  const blockers = [...map.getContainer().querySelectorAll(".mpin, .mstart")].map((e) => e.getBoundingClientRect()).filter((r) => r.width).map((r) => ({ x: r.left - box.left, y: r.top - box.top, w: r.width, h: r.height }));
  const tags = markers.map((m, i) => {
    const p = map.project(m.getLngLat());
    const label = rooms[i]?.n ? `#${rooms[i].n}` : "•";
    const w = 14 + 7 * label.length;
    return { i, n: rooms[i]?.n ?? null, x: p.x - w / 2, y: p.y - 12, w, h: 24 };
  });
  const show = rankTagsShown(tags, blockers);
  markers.forEach((m, i) => m.getElement().firstChild?.classList.toggle("dot", !show.has(i)));
}

// G3: a card on the map at [lon, lat] (html). Closes on a map click or with its ×. Returns the popup.
// A room in the top part of the map opens its card below it, clear of the plan's toolbar (top right).
// `anchor` fixes the side (a caller that pans the map to make room); else a room high on the map opens below it.
export function showPopup(map, { lat, lon }, html, { className = "rpop", anchor = null } = {}) {
  const high = map.project([lon, lat]).y < map.getContainer().clientHeight * 0.55;
  const side = anchor ?? (high ? "top" : null);
  return new window.maplibregl.Popup({ className, maxWidth: "300px", offset: 16, focusAfterOpen: false, ...(side ? { anchor: side } : {}) }).setLngLat([lon, lat]).setHTML(html).addTo(map);
}
