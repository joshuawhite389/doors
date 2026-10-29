// The day on a map (phone): the start, each stop numbered in order, the route between them, the current door
// highlighted, each pin numbered. Apple Maps on iOS (react-native-maps, bundled in Expo Go; no key). The web's honesty
// rule: the day's real road geometry (baked OSRM) drawn solid when there is one; otherwise a dashed straight line
// joining the stops in order, an estimate. Tap a pin → that door's name and time; tap the callout → the Door tab.
import { useEffect, useRef } from "react";
import { Text, View } from "react-native";
import MapView, { Marker, Polyline } from "react-native-maps";
import type { DayMapProps } from "./DayMap";

export default function DayMap({ day, stops, currentId, onOpen, road }: DayMapProps) {
  const ref = useRef<MapView>(null);
  const pts = [{ latitude: day.start.lat, longitude: day.start.lon }, ...stops.filter((s) => s.venue).map((s) => ({ latitude: s.venue!.lat, longitude: s.venue!.lon }))];
  useEffect(() => {
    const t = setTimeout(() => ref.current?.fitToCoordinates(pts, { edgePadding: { top: 40, right: 40, bottom: 40, left: 40 }, animated: false }), 300);
    return () => clearTimeout(t);
  }, [day.date, stops.length]);
  return (
    <View style={{ flex: 1 }}>
    <MapView ref={ref} style={{ flex: 1, borderRadius: 12 }} showsUserLocation testID="day-map"
      initialRegion={{ latitude: pts[0].latitude, longitude: pts[0].longitude, latitudeDelta: 0.12, longitudeDelta: 0.12 }}>
      {road ? (
        <Polyline coordinates={road.coords} strokeWidth={4} strokeColor="#2f7d4f" />
      ) : (
        <Polyline coordinates={pts} strokeWidth={3} strokeColor="#2f7d4f" lineDashPattern={[8, 6]} />
      )}
      <Marker coordinate={pts[0]} title="Start" description={day.start.label ?? ""} pinColor="#1f2a24" />
      {stops.filter((s) => s.venue).map((s) => (
        <Marker key={s.id} coordinate={{ latitude: s.venue!.lat, longitude: s.venue!.lon }}
          title={`${s.n}. ${s.name}`} description={`${s.eta}${s.done ? " · done" : s.id === currentId ? " · current" : ""}`}
          zIndex={s.id === currentId ? 100 : s.done ? 1 : 50 - s.n} // the current door's pin sits on top where pins crowd
          onCalloutPress={() => onOpen?.(s.id)}>
          {/* a numbered dot: green = current, grey = done, orange = later */}
          <View style={{ minWidth: 26, height: 26, borderRadius: 13, paddingHorizontal: 4, alignItems: "center", justifyContent: "center", borderWidth: 2, borderColor: "#fff",
            backgroundColor: s.id === currentId ? "#2f7d4f" : s.done ? "#9a9187" : "#c0612b" }}>
            <Text style={{ color: "#fff", fontSize: 13, fontWeight: "700" }}>{s.n}</Text>
          </View>
        </Marker>
      ))}
    </MapView>
      {/* the route's source, as the web's map chip: OSRM's credit for a real road, "estimated" for the straight line */}
      <View pointerEvents="none" style={{ position: "absolute", right: 8, top: 8, backgroundColor: "rgba(250,247,242,0.92)", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 }}>
        <Text style={{ fontSize: 11, color: "#6b6258" }} testID="route-source">{road ? road.label || "Roads" : "Route estimated: straight lines between stops"}</Text>
      </View>
    </View>
  );
}
