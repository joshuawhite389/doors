// Run the route's map (stand-in where there is no native map). Phone: RunMap.native.tsx.
import { Text, View } from "react-native";
export type RunStop = { id: string; lat: number; lon: number; n: number; name: string; sub: string; when: string; color: string; done: boolean };
export type RunDay = { key: string; color: string; start: { lat: number; lon: number }; stops: RunStop[]; coords: number[][]; wayPoints?: number[] | null; legMiles: number[]; solid: boolean; label: string };
export type RunMapProps = { day: RunDay; playing: boolean; speed: number; onEnd: () => void; runKey: number;
  // the plan map's own run: the other days' roads, faint behind it (web: they go faint while a day plays), and a short
  // map (smaller fit padding)
  others?: { key: string; color: string; coords: { latitude: number; longitude: number }[]; solid: boolean }[]; compact?: boolean };
export default function RunMap({ day }: RunMapProps) {
  return <View testID="run-map" style={{ flex: 1, padding: 12, backgroundColor: "#ece6dc" }}><Text>Watch the route: {day.stops.map((s) => s.n).join(" → ")}</Text></View>;
}
