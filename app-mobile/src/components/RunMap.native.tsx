// Run the route (ui/animate.js createRoutePlayer) on the phone: the day's road grows from the start, the camera
// follows it, and at each door it pauses with the door's card (stop n · arrive, name, kind · who drinks there); the
// miles counter runs with it. Timing and geometry are the web's (lib/follow.js timeline / stateAt / lineTo / milesAt).
import { useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import MapView, { Marker, Polyline } from "react-native-maps";
import { matchStops, timeline, stateAt, lineTo, pointAt, milesAt, INTRO_MS, OUTRO_MS } from "../../../public/lib/follow.js";
import type { RunMapProps } from "./RunMap";

const ll = ([lon, lat]: number[]) => ({ latitude: lat, longitude: lon });

const fade = (hex: string, a: number) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
};

export default function RunMap({ day, playing, speed, onEnd, runKey, others = [], compact = false }: RunMapProps) {
  const ref = useRef<MapView>(null);
  const tl = useMemo(() => {
    const idx = matchStops(day.coords, day.stops.map((s) => ({ lat: s.lat, lon: s.lon })), { wayPoints: day.wayPoints ?? null });
    return timeline(day.coords, idx);
  }, [day.key]);
  const [t, setT] = useState(-INTRO_MS); // ms at 1×; negative = the intro, the camera on the start
  const last = useRef(0);
  const fitAll = (animated = true) => ref.current?.fitToCoordinates([ll([day.start.lon, day.start.lat]), ...day.stops.map((s) => ({ latitude: s.lat, longitude: s.lon }))], { edgePadding: compact ? { top: 40, right: 30, bottom: 90, left: 30 } : { top: 60, right: 40, bottom: 160, left: 40 }, animated });
  useEffect(() => { setT(-INTRO_MS); setTimeout(() => fitAll(false), 300); }, [day.key, runKey]);
  useEffect(() => {
    if (!playing) return;
    if (t < -INTRO_MS + 50) ref.current?.animateCamera({ center: ll([day.start.lon, day.start.lat]), zoom: 14.5 }, { duration: 800 });
    let prev = Date.now();
    const iv = setInterval(() => {
      const now = Date.now();
      const dt = (now - prev) * speed;
      prev = now;
      setT((x) => {
        const n = x + dt;
        if (n >= tl.total + OUTRO_MS) { clearInterval(iv); setTimeout(() => { fitAll(); onEnd(); }); }
        return n;
      });
    }, 50);
    return () => clearInterval(iv);
  }, [playing, speed, day.key, runKey]);
  const st = stateAt(tl, Math.max(0, t));
  const started = t > 0;
  const line = started ? lineTo(day.coords, tl.cum, st.d) : [];
  // the camera trails the head, a few times a second
  useEffect(() => {
    if (!playing || !started || st.done) return;
    if (Date.now() - last.current < 450) return;
    last.current = Date.now();
    const { pt } = pointAt(day.coords, tl.cum, st.d);
    ref.current?.animateCamera({ center: ll(pt) }, { duration: 450 });
  }, [t]);
  const mi = started ? milesAt(tl, day.legMiles, st.d) : 0;
  const card = st.stop != null && started ? day.stops[st.stop] : null;
  return (
    <View style={{ flex: 1 }}>
      <MapView ref={ref} style={{ flex: 1 }} testID="run-map" initialRegion={{ ...ll([day.start.lon, day.start.lat]), latitudeDelta: 0.1, longitudeDelta: 0.1 }}>
        {others.map((o) => <Polyline key={`o-${o.key}`} coordinates={o.coords} strokeWidth={3} strokeColor={fade(o.color, 0.3)} lineDashPattern={o.solid ? undefined : [8, 6]} />)}
        <Polyline coordinates={day.coords.map(ll)} strokeWidth={3} strokeColor="rgba(98,103,109,0.25)" lineDashPattern={day.solid ? undefined : [8, 6]} />
        {line.length > 1 ? <Polyline coordinates={line.map(ll)} strokeWidth={5} strokeColor={day.color} lineDashPattern={day.solid ? undefined : [8, 6]} /> : null}
        <Marker coordinate={ll([day.start.lon, day.start.lat])} title="Start" pinColor="#17191B" />
        {day.stops.map((s, i) => (
          <Marker key={s.id} coordinate={{ latitude: s.lat, longitude: s.lon }} title={`${s.n}. ${s.name}`} zIndex={50 - i} tracksViewChanges={false}>
            <View style={{ minWidth: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#fff", backgroundColor: i < st.reached || st.done ? s.color : "#B9B5AC" }}>
              <Text style={{ color: "#fff", fontWeight: "700", fontSize: 12 }} allowFontScaling={false}>{s.done ? "✓" : s.n}</Text>
            </View>
          </Marker>
        ))}
      </MapView>
      <View pointerEvents="none" style={{ position: "absolute", left: 10, top: 10, backgroundColor: "rgba(247,246,242,0.94)", borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 }}>
        <Text style={{ fontSize: 15, fontWeight: "700", color: "#17191B" }} testID="run-miles" maxFontSizeMultiplier={1.3}>{mi.toFixed(1)} miles{day.solid ? "" : ", estimated"}</Text>
      </View>
      <View pointerEvents="none" style={{ position: "absolute", right: 8, top: 10, backgroundColor: "rgba(247,246,242,0.92)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3, maxWidth: "50%" }}>
        <Text style={{ fontSize: 11, color: "#62676D" }} maxFontSizeMultiplier={1.2} numberOfLines={2}>{day.label}</Text>
      </View>
      {card ? (
        <View pointerEvents="none" testID="run-card" style={{ position: "absolute", left: 12, right: 12, bottom: 12, backgroundColor: "#fff", borderRadius: 14, padding: 12, flexDirection: "row", gap: 10, shadowColor: "#000", shadowOpacity: 0.15, shadowRadius: 8 }}>
          <View style={{ width: 44, height: 44, borderRadius: 10, backgroundColor: card.color, alignItems: "center", justifyContent: "center" }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><Text style={{ color: "#fff", fontSize: 20, fontWeight: "800" }}>{(card.name.trim()[0] ?? "?").toUpperCase()}</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 13, color: "#62676D" }}>Stop {card.n} · {card.when}</Text>
            <Text style={{ fontSize: 17, fontWeight: "700", color: "#17191B" }}>{card.name}</Text>
            <Text style={{ fontSize: 13, color: "#4A4F55" }}>{card.sub}</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}
