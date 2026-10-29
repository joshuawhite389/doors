// WHY-VIZ-SPEC §4.2: picture 2 on the plan's own map while Why these doors is open. A soft wash (a blurred circle
// layer per door, coloured by its area's character) under the day loops and door pins; a pill per named area, laid
// out without overlap; hover a cloud (an invisible fill: the area's doors + 300 m) for who goes out there and how many
// of your doors it holds; tap a cloud or its pill to open its doors in the drawer. The drawer's section (areasHTML):
// the sentence, the legend, a row per named neighbourhood, and the tapped area's doors by fate with Add on each.
// Model: lib/whyviz/areas.js. Owner: ui/why.js (paints on open and after every re-plan, clears when the drawer hides).
import { esc } from "../dom.js";
import { COLOURS, stripHTML, fillStrip, restStrip, stripRows, sayHTML, legendHTML, sourceHTML } from "../viz-dom.js";
import { CLASSES, NO_CLASS, classOf, cloudColour, areaTip, areaLine, areasWords, hullRing, kindWords } from "../../lib/whyviz/areas.js";

const SRC = "wv-areas", WASH = "wv-areas-wash", HIT_SRC = "wv-areas-hit", HIT = "wv-areas-hit";
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const fc = (features) => ({ type: "FeatureCollection", features });
const colourOf = cloudColour;

// the layer the clouds go under: the first of the plan's day loops or the Why view's own dots
function under(map) {
  const ids = (map.getStyle()?.layers ?? []).map((l) => l.id);
  return ids.find((id) => /^route-d\d+-case$/.test(id)) ?? ids.find((id) => ["why-rooms", "why-story", "why-pv", "why-links"].includes(id)) ?? undefined;
}
function put(map, id, data) {
  const src = map.getSource(id);
  if (src) src.setData(data);
  else map.addSource(id, { type: "geojson", data });
}

// paintAreas(map, model, {onTap(key), pills}): draws or updates; safe to call after every re-plan. pills: false draws
// the wash and its hover alone (WHY-VIZ-SPEC §6: the clouds under the week's loops, ui/weekclouds.js).
export function paintAreas(map, model, { onTap = null, pills: withPills = true, owner = null } = {}) {
  if (!map || !model) return;
  const st = (map.__wvAreas ??= { pills: [], onMove: null, handlers: null, model: null });
  st.model = model;
  st.onTap = onTap;
  st.withPills = withPills;
  st.owner = owner; // "week": plan.js's (the Week tab, the Neighbourhoods toggle); null: the Why drawer's own
  const go = () => {
    try {
      const pts = model.areas.flatMap((a) => a.doors.map((d) => ({ type: "Feature", properties: { cls: a.cls ?? "none", key: a.key }, geometry: { type: "Point", coordinates: [d.lon, d.lat] } })));
      put(map, SRC, fc(pts));
      const hits = model.areas.map((a) => ({ type: "Feature", properties: { key: a.key }, geometry: { type: "Polygon", coordinates: [hullRing(a, 300)] } }));
      put(map, HIT_SRC, fc(hits));
      const before = under(map);
      if (!map.getLayer(WASH)) {
        map.addLayer({
          id: WASH, type: "circle", source: SRC,
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 9, 10, 16, 12, 40, 14, 100, 16, 220], // ≈ 40 px at z12 (spec), a 3 km neighbourhood's worth zoomed out
            "circle-blur": 0.85,
            "circle-color": ["match", ["get", "cls"], ...CLASSES.flatMap((c) => [c.cls, c.colour]), NO_CLASS.colour],
            // round 4 #9 (Jard 10-27: "barely visible gray splotches"): the legend's colours, visible; a cloud with no
            // standout group is your drinker's doors in NO_CLASS's colour, a little lighter
            "circle-opacity": ["case", ["==", ["get", "cls"], "none"], 0.26, 0.34],
          },
        }, before);
        map.addLayer({ id: HIT, type: "fill", source: HIT_SRC, paint: { "fill-color": "#000", "fill-opacity": 0 } }, before);
      } else if (before && map.getLayer(before)) {
        map.moveLayer(WASH, before);
        map.moveLayer(HIT, before);
      }
      if (!st.handlers) {
        const areaAt = (e) => { const k = e.features?.[0]?.properties?.key; return k ? st.model.areas.find((a) => a.key === k) ?? null : null; };
        st.handlers = {
          move: (e) => { if (e.originalEvent?.target?.closest?.(".wv-pill")) return; /* the pill's own hover rules; its event bubbles here too */ const a = areaAt(e); if (!a) return hoverArea(map, st, null); map.getCanvas().style.cursor = "pointer"; hoverArea(map, st, a); },
          leave: () => { map.getCanvas().style.cursor = ""; hoverArea(map, st, null); },
          click: (e) => { const a = areaAt(e); if (a) st.onTap?.(a.key); },
        };
        for (const l of [HIT, WASH]) { map.on("mousemove", l, st.handlers.move); map.on("mouseleave", l, st.handlers.leave); map.on("click", l, st.handlers.click); } // the wash too: the hull + 300 m is tiny zoomed out
      }
      pills(map, st);
      try { map.getContainer().dataset.wvWash = `${model.areas.length}${withPills ? "" : " week"}`; } catch {} // the wash is up (the CDP walks read it; the layers aren't DOM)
      if (!st.onMove) { // every move (one pass per frame), and once more when the map settles
        st.onMove = () => { if (st.raf) return; st.raf = requestAnimationFrame(() => { st.raf = 0; if (map.__wvAreas === st) declutter(map, st); }); };
        map.on("move", st.onMove); map.on("moveend", st.onMove); map.on("resize", st.onMove); map.on("idle", st.onMove);
      }
      document.fonts?.ready.then(() => map.__wvAreas === st && declutter(map, st));
    } catch (e) { console.error(e); }
  };
  if (map.isStyleLoaded()) go();
  else map.once("idle", go);
}

// the pills: HTML markers (the pmtiles fallback has no glyphs for a symbol layer); laid out by declutter()
function pills(map, st) {
  for (const p of st.pills) p.marker.remove();
  st.pills = (st.withPills === false ? [] : st.model.areas.filter((a) => a.name)).map((a) => { // round 4 #9: every named area has a pill, not only the ones with a character
    const el = document.createElement("button");
    el.type = "button";
    el.className = "wv-pill";
    el.setAttribute("aria-label", `${a.name}: ${a.top ? classOf(a.cls).word : NO_CLASS.word}; ${plural(a.n, "ranked door")}, ${a.planN} on your plan`);
    el.innerHTML = `<i style="background:${colourOf(a.cls)}"></i><b>${esc(a.name)}</b><span>${esc(pillWords(a))}</span>`;
    el.addEventListener("click", (e) => { e.stopPropagation(); st.onTap?.(a.key); });
    el.addEventListener("pointerenter", () => hoverArea(map, st, a));
    el.addEventListener("pointerleave", (e) => { if (e.pointerType !== "touch") hoverArea(map, st, null); });
    el.addEventListener("focus", () => hoverArea(map, st, a));
    el.addEventListener("blur", () => hoverArea(map, st, null));
    const marker = new window.maplibregl.Marker({ element: el, anchor: "center" }).setLngLat([a.lon, a.lat]).addTo(map);
    return { a, marker, el };
  });
  declutter(map, st);
}
// round 4 #5 (Jard 10-27): no box over the map. Hovering, tapping or focusing a cloud or its pill lights the pill (its
// words become the door counts) or, where the pill isn't showing, puts a small light label at the cloud; the details
// (areaTip's rows) go to the drawer's strip under "The city by neighbourhood" when that section is on screen.
const drawerStrip = () => document.querySelector(".wv-areas [data-wv-strip]");
function hoverArea(map, st, a) {
  if ((st.hot ?? null) === (a?.key ?? null)) return;
  const prev = st.pills.find((p) => p.a.key === st.hot);
  if (prev) { prev.el.classList.remove("hot"); prev.el.querySelector("span").textContent = pillWords(prev.a); }
  if (st.label) { st.label.remove(); st.label = null; }
  st.hot = a?.key ?? null;
  if (!a) return restStrip(drawerStrip());
  const pill = st.pills.find((p) => p.a.key === a.key);
  if (pill && !pill.el.classList.contains("hid")) {
    pill.el.classList.add("hot");
    pill.el.querySelector("span").textContent = `· ${plural(a.n, "door")} · ${a.planN} on your plan`;
  } else {
    const el = document.createElement("div");
    el.className = "wv-maplbl";
    el.setAttribute("aria-hidden", "true");
    el.innerHTML = `<b>${esc(a.name ?? "This part of town")}</b><span>${esc(`${plural(a.n, "door")} · ${a.planN} on your plan`)}</span>`;
    st.label = new window.maplibregl.Marker({ element: el, anchor: "top", offset: [0, 10] }).setLngLat([a.lon, a.lat]).addTo(map);
  }
  fillStrip(drawerStrip(), areaTip(a, st.model));
}
const pillWords = (a) => `· ${a.top ? a.groups.find((g) => g.cls === a.cls)?.label.toLowerCase() ?? classOf(a.cls).word : plural(a.n, "door")}`;

// pure: which pills show, biggest area first, none overlapping another kept one or leaving the map
export function pillsShown(boxes, { w, h, pad = 4 } = {}) {
  const hit = (a, b) => a.x - pad < b.x + b.w && b.x - pad < a.x + a.w && a.y - pad < b.y + b.h && b.y - pad < a.y + a.h;
  const kept = [], show = new Set();
  for (const b of [...boxes].sort((p, q) => q.n - p.n)) {
    if (b.x < 0 || b.y < 0 || (w && b.x + b.w > w) || (h && b.y + b.h > h)) continue;
    if (kept.some((k) => hit(b, k))) continue;
    kept.push(b);
    show.add(b.i);
  }
  return show;
}
function declutter(map, st) {
  if (!st.pills.length) return;
  const box = map.getContainer().getBoundingClientRect();
  const boxes = st.pills.map((p, i) => { const c = map.project(p.marker.getLngLat()); const w = p.el.offsetWidth || 160, h = p.el.offsetHeight || 26; return { i, n: p.a.n, x: c.x - w / 2, y: c.y - h / 2, w, h }; });
  const show = pillsShown(boxes, { w: box.width, h: box.height });
  st.pills.forEach((p, i) => { p.el.classList.toggle("hid", !show.has(i)); p.el.dataset.box = `${Math.round(boxes[i].x)},${Math.round(boxes[i].y)},${boxes[i].w},${boxes[i].h}`; });
}

export function clearAreas(map) {
  const st = map?.__wvAreas;
  if (!st) return;
  try {
    for (const p of st.pills) p.marker.remove();
    st.pills = [];
    if (st.label) { st.label.remove(); st.label = null; }
    st.hot = null;
    if (st.handlers) { for (const l of [HIT, WASH]) { map.off("mousemove", l, st.handlers.move); map.off("mouseleave", l, st.handlers.leave); map.off("click", l, st.handlers.click); } st.handlers = null; }
    if (st.onMove) { map.off("move", st.onMove); map.off("moveend", st.onMove); map.off("resize", st.onMove); map.off("idle", st.onMove); cancelAnimationFrame(st.raf); st.onMove = null; }
    for (const l of [HIT, WASH]) if (map.getLayer(l)) map.removeLayer(l);
    for (const s of [HIT_SRC, SRC]) if (map.getSource(s)) map.removeSource(s);
    delete map.getContainer().dataset.wvWash;
  } catch { /* the map is gone with the view */ }
  map.__wvAreas = null;
}

// ---------- the drawer's section ----------
// model; sel: the tapped area's key; fateOf(id) → {word, fate, lat} for the tapped area's doors; canAdd; narrow
export function areasHTML(model, { sel = null, canAdd = false, narrow = false } = {}) {
  if (!model) return "";
  const legend = legendHTML([...CLASSES.map((c) => ({ swatch: c.colour, text: c.word })), ...(model.areas.some((a) => !a.top) ? [{ swatch: NO_CLASS.colour, text: NO_CLASS.word }] : [])]);
  const rows = model.areas.filter((a) => a.name).map((a) => `<li><button type="button" class="wv-arow${a.key === sel ? " on" : ""}" data-wv-area="${esc(a.key)}" aria-pressed="${a.key === sel}"><i style="background:${colourOf(a.cls)}"></i><span><b>${esc(a.name ?? "No name")}</b> · ${esc(areaLine(a))}</span></button></li>`).join("");
  const a = sel && model.areas.find((x) => x.key === sel);
  return `<section class="wv-areas" aria-label="The city by neighbourhood">
    <h4 class="wv-h">The city by neighbourhood</h4>
    ${sayHTML(areasWords(model))}
    ${legend}
    ${stripHTML("Hover or tap a cloud on the map: who goes out there and how many of your doors it holds.")}
    ${rows ? `<ul class="wv-arows">${rows}</ul>` : ""}
    ${a ? areaSheetHTML(a, model, { canAdd }) : narrow ? `<p class="w-fm">Tap a cloud on the map for its doors.</p>` : ""}
    ${sourceHTML(`Qloo's locality heat map for your drinker (${model.hoodsN ? plural(model.hoodsN, "neighbourhood") : model.source === "neighborhood" ? "Qloo's neighbourhood field" : "a 1.5 km grid"}), each door's crowd description, and the same counts over the ${plural(model.describedN, "door")} Qloo describes in ${esc(model.cityName)}.`)}
  </section>`;
}
// round 6 #2: the strip under "The city by neighbourhood" reserves room for the tallest cloud's rows (viz-dom.js
// reserveStrips); why.js calls this once the section is in the page
export function areasReserve(root, model) {
  const strip = root?.querySelector?.(".wv-areas [data-wv-strip]");
  if (!strip || !model) return;
  for (const a of model.areas) stripRows(strip.parentElement, () => areaTip(a, model), strip);
}
const FATE_WORD = { plan: "On your plan", famous: "Most popular, left for later", room: "Not a door type you pitch", known: "You marked them", open: "Not open when you're out", route: "Didn't fit a day's route", kind: "Not a bar or restaurant" };
const FATE_ORDER = ["plan", "open", "route", "known", "famous", "room", "kind"];
export function areaSheetHTML(a, model, { canAdd = false } = {}) {
  const groups = FATE_ORDER.map((f) => [f, a.doors.filter((d) => (d.fate ?? "route") === f)]).filter(([, ds]) => ds.length);
  return `<div class="wv-asheet" data-wv-sheet="${esc(a.key)}">
    <div class="wv-ashead"><h5>${esc(a.name ?? "This part of town")}</h5><p>${esc(plural(a.n, "ranked door"))}, ${esc(kindWords(a.kinds))}. ${esc(areaLine(a).split(". ").slice(1).join(". "))}</p>${a.groups.length ? `<p class="w-fm">${esc(a.groups.slice(0, 3).map((g) => `${g.label} ${g.n} of ${a.n}, ×${g.lift.toFixed(1)} the city`).join(" · "))}</p>` : ""}</div>
    ${groups.map(([f, ds]) => `<h6>${esc(FATE_WORD[f] ?? f)} · ${ds.length}</h6><ul class="wv-adoors">${ds.sort((p, q) => (p.rank ?? 1e9) - (q.rank ?? 1e9)).map((d) => `<li><button type="button" class="wv-adoor" data-door="${esc(d.id)}"><b>${esc(d.name)}</b><small>${esc(d.fate === "plan" ? d.reason : d.rank ? `#${d.rank} on Your list${d.reason && d.fate !== "plan" ? ` · ${d.reason}` : ""}` : d.reason ?? "")}</small></button>${f !== "plan" && canAdd && Number.isFinite(d.lat) ? `<button type="button" class="btn sm line" data-th-add="${esc(d.id)}">Add</button>` : ""}</li>`).join("")}</ul>`).join("")}
  </div>`;
}
