// V5 corridors on the map (docs/ROUTING-V5-EVAL.md): each shown day's detour ellipse (public/lib/corridor.js) as a
// faint fill in the day's colour with a dashed outline (a pair corridor: the union of its legs' ellipses, outlined
// round the outside only), under the route lines; the selected day's a little stronger.
// A day without day.corridor (V4, or a frozen/past/locked day) draws none. ?corridor=0 hides them all.
import { corridorFill, corridorOutline } from "../lib/corridor.js";

const lid = (i) => `corridor-d${i}`;
const off = () => typeof location !== "undefined" && new URLSearchParams(location.search).get("corridor") === "0";

export function removeCorridor(map, i) {
  for (const l of [`${lid(i)}-line`, `${lid(i)}-fill`]) if (map.getLayer(l)) map.removeLayer(l);
  if (map.getSource(lid(i))) map.removeSource(lid(i));
}

// days: [{corridor, color}], show(i): drawn at all, sel: the selected day (-1 for none / the week).
export function drawCorridors(map, days, { show = () => true, sel = -1 } = {}) {
  const hide = off();
  // under the first route line on the map, so lines and pins stay on top
  const under = map.getStyle()?.layers?.find((l) => /^route-d\d+-case$/.test(l.id))?.id;
  for (let i = 0; ; i++) {
    if (i >= days.length && !map.getSource(lid(i))) break;
    const d = days[i];
    const ring = !hide && d && show(i) ? corridorFill(d.corridor) : null;
    if (!ring) { removeCorridor(map, i); continue; }
    const props = { anchor: d.corridor.anchorId ?? null, rank: d.corridor.anchorRank ?? null };
    const data = { type: "FeatureCollection", features: [
      { type: "Feature", properties: { ...props, part: "fill" }, geometry: { type: "Polygon", coordinates: [ring] } },
      { type: "Feature", properties: { ...props, part: "line" }, geometry: { type: "MultiLineString", coordinates: corridorOutline(d.corridor) } },
    ] };
    const strong = i === sel;
    if (map.getSource(lid(i))) map.getSource(lid(i)).setData(data);
    else {
      map.addSource(lid(i), { type: "geojson", data });
      map.addLayer({ id: `${lid(i)}-fill`, type: "fill", source: lid(i), filter: ["==", ["get", "part"], "fill"], paint: { "fill-color": d.color, "fill-opacity": 0.07 } }, under);
      map.addLayer({ id: `${lid(i)}-line`, type: "line", source: lid(i), filter: ["==", ["get", "part"], "line"], layout: { "line-join": "round" }, paint: { "line-color": d.color, "line-width": 1.5, "line-opacity": 0.6, "line-dasharray": [3, 2] } }, under);
    }
    map.setPaintProperty(`${lid(i)}-fill`, "fill-opacity", strong ? 0.12 : 0.06);
    map.setPaintProperty(`${lid(i)}-line`, "line-opacity", strong ? 0.85 : 0.45);
    map.setPaintProperty(`${lid(i)}-line`, "line-width", strong ? 2 : 1.25);
  }
}
