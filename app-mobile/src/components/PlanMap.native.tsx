// The plan on a map (Apple Maps on iOS): each shown day's start, its numbered pins in the day's colour (✓ when done) and
// its road, solid when routed (OSRM / ORS), dashed when it's the straight-line estimate, with the route's credit;
// extra pins (the ranked rooms not on a day); an optional draggable marker (Drop a pin). Tap a pin → onPin.
import { useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import MapView, { Callout, Marker, Polyline } from "react-native-maps";
import type { PlanMapProps, MapPin } from "./PlanMap";

// Pins closer than NEAR px (overlapping) at the map's current zoom join one count pill at their middle (Jard's iPhone,
// 10-23: the old fan-out spread a zoomed-out city into a big ring). The pill says "13 doors" in words, so a count never
// reads as a stop or rank number (Jard 10-23: "zooming in shows different numbers"). Tap a pill → the map zooms to its
// doors and it splits. Pins
// that still touch at street zoom (one building) fan out on a small fixed ring instead. Screen space, so the route
// lines keep the true points. Faint pins (another day's) never join: they are small dots under the day in view.
const NEAR = 26; // a pin's width: closer than this they overlap
const PILL_W = 80, PILL_H = 34; // a pill's size and a little air: two pills closer than this (either way) merge
const RING = 18; // px: the ring a same-block group fans out on (fan below)
const SAME_BLOCK = 0.0003; // degrees, ~30 m: closer than this at the current zoom, zooming in can't split them
type Group = { lat: number; lon: number; ix: number[] };
// route stops and ranked doors group apart: a pill holds one kind
function cluster(pins: MapPin[], degPerPx: number): Group[] {
  const stops = clusterOf(pins, degPerPx, (p) => !p.rank), ranks = clusterOf(pins, degPerPx, (p) => !!p.rank);
  apart(stops, ranks, pins, degPerPx);
  // mobile2, 10-23 (17 sim): a ranked pill stepped clear of the stops could land on another ranked pill ("8 doors"
  // under "103 doors"): ranked groups that touch now join, and the joined pill steps clear of the stops again
  if (merge(ranks, pins, degPerPx)) apart(stops, ranks, pins, degPerPx);
  return [...stops, ...ranks];
}
// a group's drawn size in px: a stop pin, a "#14" tile, a fanned ring, or a "13 doors" pill
function box(g: Group, pins: MapPin[], degPerPx: number): [number, number] {
  if (g.ix.length === 1) { const p = pins[g.ix[0]]; return p.rank ? [12 + 7 * p.label.length, 24] : [26, 26]; }
  if (NEAR * degPerPx < SAME_BLOCK) return [2 * RING + 26, 2 * RING + 26];
  return [30 + 7.5 * `${g.ix.length} doors`.length, PILL_H];
}
// mobile2, 10-23 (17 sim): zoomed out, the "9 doors" stops pill sat on a "#64" tile and hid its number. The two kinds
// never merge, so a ranked group (tile or pill) that touches a stop group steps straight up or down until it clears
// it. Screen space, a few px at any zoom; the route keeps its true points and a tap still zooms to the true doors
function apart(stops: Group[], ranks: Group[], pins: MapPin[], degPerPx: number) {
  if (!(degPerPx > 0) || !stops.length) return;
  const k = (lat: number) => Math.cos((lat * Math.PI) / 180) || 1;
  for (let pass = 0; pass < 4; pass++) {
    let moved = false;
    for (const r of ranks) {
      const [rw, rh] = box(r, pins, degPerPx);
      for (const st of stops) {
        const [sw, sh] = box(st, pins, degPerPx);
        const dx = (Math.abs(r.lon - st.lon) * k(st.lat)) / degPerPx, dy = (st.lat - r.lat) / degPerPx; // dy > 0: r is below
        const need = (rh + sh) / 2 + 3;
        if (dx >= (rw + sw) / 2 || Math.abs(dy) >= need) continue;
        r.lat = st.lat + (dy >= 0 ? -need : need) * degPerPx;
        moved = true;
      }
    }
    if (!moved) return;
  }
}
function clusterOf(pins: MapPin[], degPerPx: number, kind: (p: MapPin) => boolean): Group[] {
  const k = (lat: number) => Math.cos((lat * Math.PI) / 180) || 1;
  const order = pins.map((_, i) => i).filter((i) => !pins[i].faint && kind(pins[i])).sort((a, b) => (pins[b].z ?? 10) - (pins[a].z ?? 10));
  const groups: Group[] = [];
  for (const i of order) {
    const p = pins[i];
    const g = degPerPx > 0 ? groups.find((g) => Math.hypot((p.lat - g.lat) / degPerPx, ((p.lon - g.lon) * k(g.lat)) / degPerPx) < NEAR) : undefined;
    if (g) g.ix.push(i);
    else groups.push({ lat: p.lat, lon: p.lon, ix: [i] });
  }
  groups.forEach((g) => mid(g, pins));
  merge(groups, pins, degPerPx);
  return groups;
}
const mid = (g: Group, pins: MapPin[]) => {
  g.lat = g.ix.reduce((a, i) => a + pins[i].lat, 0) / g.ix.length;
  g.lon = g.ix.reduce((a, i) => a + pins[i].lon, 0) / g.ix.length;
};
// pills are wider than pins: two groups whose drawn boxes still touch become one (seen: "3" "3" "2" stacked; and a
// "103 doors" pill is wider than PILL_W, so it's each pill's own box, plus a little air). true when any joined
function merge(groups: Group[], pins: MapPin[], degPerPx: number) {
  if (!(degPerPx > 0)) return false;
  const k = (lat: number) => Math.cos((lat * Math.PI) / 180) || 1;
  let any = false;
  for (let merged = true; merged; ) {
    merged = false;
    for (let x = 0; x < groups.length && !merged; x++)
      for (let y = x + 1; y < groups.length && !merged; y++) {
        const [g, h] = [groups[x], groups[y]];
        if (g.ix.length + h.ix.length < 3) continue; // two single pins: NEAR already decided
        const [gw, gh] = box(g, pins, degPerPx), [hw, hh] = box(h, pins, degPerPx);
        const w = Math.max(PILL_W, (gw + hw) / 2 + 4), hgt = Math.max(PILL_H, (gh + hh) / 2 + 4);
        if (Math.abs(g.lat - h.lat) / degPerPx < hgt && (Math.abs(g.lon - h.lon) * k(g.lat)) / degPerPx < w) {
          g.ix.push(...h.ix);
          groups.splice(y, 1);
          mid(g, pins);
          merged = any = true;
        }
      }
  }
  return any;
}
// a same-block group's pins on a ring of RING px around their middle
function fan(pins: MapPin[], g: Group, degPerPx: number) {
  const k = Math.cos((g.lat * Math.PI) / 180) || 1;
  const r = RING * degPerPx;
  return g.ix.map((i, j) => {
    const a = (2 * Math.PI * j) / g.ix.length - Math.PI / 2;
    return { i, at: { latitude: g.lat + r * Math.sin(a), longitude: g.lon + (r * Math.cos(a)) / k } };
  });
}

// a count pill: "13 doors" on a stacked white card (a second card peeks behind it), never a bare number
function Bubble({ n, color }: { n: number; color: string }) {
  return (
    <View style={{ paddingTop: 3, paddingLeft: 3 }}>
      <View style={{ position: "absolute", top: 0, left: 0, right: 3, bottom: 3, borderRadius: 14, borderWidth: 2, borderColor: color, backgroundColor: "#fff", opacity: 0.85 }} />
      <View style={{ height: 28, borderRadius: 14, paddingHorizontal: 10, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: color, backgroundColor: "#fff", shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } }}>
        <Text style={{ color, fontSize: 13, fontWeight: "800" }} allowFontScaling={false}>{n} doors</Text>
      </View>
    </View>
  );
}
// another day's door behind the day in view (web: small, dimmed, unnumbered, so two "1"s don't stack)
function Faint({ color }: { color: string }) {
  return <View style={{ width: 12, height: 12, borderRadius: 6, borderWidth: 1.5, borderColor: "#fff", backgroundColor: color, opacity: 0.7 }} />;
}
// "#E07B2A" → "rgba(224,123,42,a)"
const fade = (hex: string, a: number) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
};

// VoiceOver (mobile2, 10-23, 17 sim): MapKit speaks a marker's title and description ("3. Lockwood Restaurant, 4:15 pm
// · tap to open", "Mirai Sushi, #14 of 130 · …") and ignores accessibilityLabel on a react-native-maps Marker; a marker
// with no title is just "Map pin". So a count pill gets a title too ("13 ranked doors here"), with an empty tooltip
// Callout so a tap still only zooms in, no bubble
const pillSaid = (n: number, rank: boolean) => `${n} ${rank ? "ranked doors" : "stops"} here. Tap to zoom in`;

function Dot({ p }: { p: MapPin }) {
  // a ranked door: a white tile with an ink border and "#14" (the web's .mrank), unlike a day's round coloured stops
  if (p.rank) return (
    <View style={{ minWidth: 26, height: 24, borderRadius: 7, paddingHorizontal: 4, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#17191B", backgroundColor: "#fff" }}>
      <Text style={{ color: "#17191B", fontSize: 11, fontWeight: "700" }} allowFontScaling={false}>{p.label}</Text>
    </View>
  );
  return (
    <View style={{ minWidth: 26, height: 26, borderRadius: 13, paddingHorizontal: 4, alignItems: "center", justifyContent: "center", borderWidth: p.ring ? 3 : 2, borderColor: p.ring ? "#17191B" : "#fff", backgroundColor: p.color }}>
      <Text style={{ color: "#fff", fontSize: 12, fontWeight: "700" }} allowFontScaling={false}>{p.label}</Text>
    </View>
  );
}

export default function PlanMap({ days, extra = [], onPin, onPress, marker, onMarker, fitKey, credit, height, center, focus, still }: PlanMapProps) {
  const ref = useRef<MapView>(null);
  const [view, setView] = useState({ latDelta: 0.12, h: height ?? 250 });
  const shown = useMemo(() => [...extra, ...days.flatMap((d) => d.pins)].filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon)), [days, extra]);
  const degPerPx = view.latDelta / (view.h || 1);
  const groups = useMemo(() => cluster(shown, degPerPx), [shown, degPerPx]);
  // the fit: the days in view (a faint day is context around them, as the web's day view), the extra pins, the marker
  const pts = useMemo(() => {
    const strong = days.filter((d) => d.strong !== false);
    const all = [...(strong.length ? strong : days).flatMap((d) => [...(d.start ? [d.start] : []), ...d.pins]), ...extra, ...(marker ? [marker] : [])].filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
    return all.map((p) => ({ latitude: p.lat, longitude: p.lon }));
  }, [days, extra, marker]);
  const zoomTo = (g: Group) => ref.current?.fitToCoordinates(g.ix.map((i) => ({ latitude: shown[i].lat, longitude: shown[i].lon })), { edgePadding: { top: 70, right: 60, bottom: 60, left: 60 }, animated: true });
  // fit the pins; also once the map is ready: a fit sent before MapKit is ready is dropped, and the map stayed at its
  // 0.12° first region (seen on a relaunch into a plan)
  const fit = () => {
    if (!pts.length) return;
    focus ? ref.current?.animateToRegion({ latitude: focus.lat, longitude: focus.lon, latitudeDelta: 0.025, longitudeDelta: 0.025 }, 400) : pts.length === 1 ? ref.current?.animateToRegion({ ...pts[0], latitudeDelta: 0.02, longitudeDelta: 0.02 }, 0) : ref.current?.fitToCoordinates(pts, { edgePadding: { top: 50, right: 40, bottom: 40, left: 40 }, animated: false });
  };
  // mobile2, 10-23 (17 sim): after a pinch, switching to Your list kept the old camera, with none of its tiles in view.
  // The first fit can be dropped while MapKit is busy adding a hundred new markers, so it fits once more a moment later
  // (a no-op when the first one landed)
  // mobile2 10-23 (again): a day-tab switch once left the map on an empty area until the next switch. The timers called
  // the fit of the render that set them (that render's pins); they now call the latest one, the fit runs again when the
  // pins themselves change, and once more later while MapKit is still adding markers
  const fitNow = useRef(fit);
  fitNow.current = fit;
  // the pins and starts only: a dragged Drop-a-pin marker must not pull the camera after it
  const ptsKey = [...days.flatMap((d) => [...(d.start ? [d.start] : []), ...d.pins]), ...extra].map((p) => `${(+p.lat).toFixed(4)},${(+p.lon).toFixed(4)}`).join("|");
  useEffect(() => {
    const t = [250, 900, 1800].map((ms) => setTimeout(() => fitNow.current(), ms));
    return () => t.forEach(clearTimeout);
  }, [fitKey, ptsKey]);
  // a pin opens its stop (or a ranked door's card) in one tap, as the web's; with no onPin it shows its callout
  const tap = (p: any) => (onPin ? { onPress: () => onPin(p.id), accessibilityLabel: `${p.title}${p.sub ? `, ${p.sub.replace(/ · tap to open$/, "")}` : ""}`, accessibilityRole: "button" as const } : { title: p.title, description: p.sub });
  const c0 = pts[0] ?? (center ? { latitude: center.lat, longitude: center.lon } : { latitude: 30.27, longitude: -97.74 });
  const label = credit ?? days.find((d) => d.road)?.road?.label;
  return (
    <View style={{ height: height ?? undefined, flex: height ? undefined : 1, borderRadius: 12, overflow: "hidden" }}
      // mobile2 10-23 (17 sim, once, right after an install): relaunched into the plan, Fri's map sat on an empty area
      // until a tab switch. A fit also when the map lays out at a new height (only then: a pan must stay where it is).
      // (onMapLoaded would be the other hook, but on iOS it fires for Google Maps only)
      onLayout={(e) => { const h = e.nativeEvent.layout.height; if (h !== view.h) { setView((v) => ({ ...v, h })); setTimeout(() => fitNow.current(), 50); } }}>
      <MapView ref={ref} style={{ flex: 1 }} testID="plan-map" onMapReady={fit} scrollEnabled={!still} zoomEnabled={!still} rotateEnabled={!still} pitchEnabled={!still} initialRegion={{ ...c0, latitudeDelta: 0.12, longitudeDelta: 0.12 }}
        onRegionChangeComplete={(r) => setView((v) => (Math.abs(r.latitudeDelta - v.latDelta) / v.latDelta > 0.05 ? { ...v, latDelta: r.latitudeDelta } : v))}
        onPress={onPress ? (e) => onPress({ lat: e.nativeEvent.coordinate.latitude, lon: e.nativeEvent.coordinate.longitude }) : undefined}>
        {days.map((d) =>
          d.road ? (
            <Polyline key={`r-${d.key}-${d.strong === false}`} coordinates={d.road.coords} strokeWidth={d.strong === false ? 3 : 4.5} strokeColor={d.strong === false ? fade(d.color, 0.35) : d.color} zIndex={d.strong === false ? 1 : 2} lineDashPattern={d.road.solid ? undefined : [8, 6]} />
          ) : null,
        )}
        {days.map((d) => (d.start && d.strong !== false ? <Marker key={`s-${d.key}`} coordinate={{ latitude: d.start.lat, longitude: d.start.lon }} title="Start" description={d.start.label ?? ""} pinColor="#17191B" /> : null))}
        {shown.map((p, i) => (p.faint ? (
          <Marker key={`f-${p.id}-${i}`} coordinate={{ latitude: p.lat, longitude: p.lon }} {...tap(p)} zIndex={1} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false}>
            <Faint color={p.color} />
          </Marker>
        ) : null))}
        {groups.flatMap((g) => {
          if (g.ix.length === 1) {
            const i = g.ix[0], p = shown[i];
            return [<Marker key={`${p.id}-${i}`} coordinate={{ latitude: g.lat, longitude: g.lon }} {...tap(p)} zIndex={p.z ?? 10} tracksViewChanges={false}><Dot p={p} /></Marker>];
          }
          if (NEAR * degPerPx < SAME_BLOCK) return fan(shown, g, degPerPx).map(({ i, at }) => { const p = shown[i]; return <Marker key={`${p.id}-${i}`} coordinate={at} {...tap(p)} zIndex={p.z ?? 10} tracksViewChanges={false}><Dot p={p} /></Marker>; });
          const cs = shown[g.ix[0]].rank ? ["#17191B"] : [...new Set(g.ix.map((i) => shown[i].color))];
          return [<Marker key={`c-${g.ix.map((i) => shown[i].id).join()}`} coordinate={{ latitude: g.lat, longitude: g.lon }} zIndex={100} anchor={{ x: 0.5, y: 0.5 }} onPress={() => zoomTo(g)} tracksViewChanges={false}
            title={pillSaid(g.ix.length, !!shown[g.ix[0]].rank)} testID="pin-cluster"><Bubble n={g.ix.length} color={cs.length === 1 ? cs[0] : "#17191B"} /><Callout tooltip><View /></Callout></Marker>];
        })}
        {marker ? <Marker coordinate={{ latitude: marker.lat, longitude: marker.lon }} draggable pinColor="#E07B2A" onDragEnd={(e) => onMarker?.({ lat: e.nativeEvent.coordinate.latitude, lon: e.nativeEvent.coordinate.longitude })} /> : null}
      </MapView>
      {label ? (
        <View pointerEvents="none" style={{ position: "absolute", right: 8, top: 8, backgroundColor: "rgba(247,246,242,0.92)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, maxWidth: "80%" }}>
          <Text style={{ fontSize: 11, color: "#62676D" }} testID="route-source" maxFontSizeMultiplier={1.2} numberOfLines={2}>{label}</Text>
        </View>
      ) : null}
    </View>
  );
}
