// The day map's props, and its stand-in where there is no native map (web builds, the headless checks): the stops in
// order, as text. The phone uses DayMap.native.tsx.
import { Text, View } from "react-native";

export type MapStop = { id: string; n: number; name: string; eta: string; done: boolean; venue: { lat: number; lon: number } | null };
export type DayMapProps = { day: { date: string; start: { lat: number; lon: number; label?: string } }; stops: MapStop[]; currentId: string | null; onOpen?: (id: string) => void;
  // the day's road (baked OSRM geometry) or null: then the map joins the stops with a dashed straight line (an estimate)
  road?: { coords: { latitude: number; longitude: number }[]; label: string } | null };

export default function DayMap({ stops, currentId }: DayMapProps) {
  return (
    <View testID="day-map" style={{ padding: 12, borderRadius: 12, backgroundColor: "#ece6dc" }}>
      <Text style={{ fontSize: 15, color: "#6b6258" }}>Map on the phone. Route: {stops.map((s) => `${s.n}${s.id === currentId ? "*" : ""}`).join(" → ")}</Text>
    </View>
  );
}
