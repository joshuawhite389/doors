// The plan's map props, and its stand-in where there is no native map (web builds, headless checks). Phone:
// PlanMap.native.tsx.
import { Text, View } from "react-native";

export type MapPin = { id: string; lat: number; lon: number; label: string; color: string; title: string; sub?: string; z?: number; ring?: boolean;
  // another day's door behind the day in view: a small unnumbered dot, never in a count bubble
  faint?: boolean;
  // a ranked door not on a day ("#14"): a square tile, grouped only with its own kind (never with a day's stops)
  rank?: boolean };
export type MapDay = { key: string; color: string; start: { lat: number; lon: number; label?: string } | null; pins: MapPin[]; road?: { coords: { latitude: number; longitude: number }[]; solid: boolean; label: string } | null; strong?: boolean };
export type PlanMapProps = { days: MapDay[]; extra?: MapPin[]; onPin?: (id: string) => void; onPress?: (ll: { lat: number; lon: number }) => void; marker?: { lat: number; lon: number } | null; onMarker?: (ll: { lat: number; lon: number }) => void; fitKey?: string; credit?: string; height?: number; center?: { lat: number; lon: number } | null;
  // a selected place: the map zooms to it (the Why card), instead of fitting everything
  focus?: { lat: number; lon: number } | null;
  // a preview that doesn't move (the landing's, mobile2 10-23): a drag on it scrolls the page instead of panning it
  still?: boolean };

export default function PlanMap({ days, height = 260 }: PlanMapProps) {
  return (
    <View testID="plan-map" style={{ height, padding: 12, borderRadius: 12, backgroundColor: "#ece6dc" }}>
      <Text style={{ fontSize: 14, color: "#6b6258" }}>Map on the phone. {days.map((d) => d.pins.map((p) => p.label).join("→")).join(" | ")}</Text>
    </View>
  );
}
