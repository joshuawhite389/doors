// The tap-to-talk mic (src/mic.ts) as a button: "round" beside the Agent box's Send, "wide" in the Done box. One tap
// listens (the button turns amber and pulses with the voice, the seconds count up), a second tap or a pause after
// speaking stops it, then "Getting your words…" until the Worker's Whisper answers. A problem (no mic permission, no
// signal, nothing heard) is a plain line under it; typing always still works.
import { Pressable, Text, View } from "react-native";
import { MAX_MS, type MicPhase } from "../mic";
import { C } from "../ui";
import { Ic } from "../icons";

type Mic = { phase: MicPhase; level: number; secs: number; toggle: () => void };

// a microphone drawn in Views (no icon font in the app): capsule, cradle, stand
// the mic and stop shapes are the Doors icon set's (Jard 10-24 #1: was a mic built from Views and a white square)
export function MicGlyph({ color = "#fff", size = 22 }: { color?: string; size?: number }) {
  return <Ic name="mic" size={size} color={color} />;
}
const STOP = () => <Ic name="stop" size={20} color="#fff" />;

export function micLabel(m: Pick<Mic, "phase" | "secs">, idle: string) {
  if (m.phase === "listen") return `Listening… tap when done${m.secs ? ` (${m.secs} s)` : ""}`;
  if (m.phase === "read") return "Getting your words…";
  return idle;
}

export default function MicButton({ mic, wide, idle = "Tap and say it", testID = "mic" }: { mic: Mic; wide?: boolean; idle?: string; testID?: string }) {
  const on = mic.phase === "listen";
  const busy = mic.phase === "read";
  const bg = on ? C.amber : busy ? C.ink3 : C.green;
  const a11y = on ? "Stop listening" : busy ? "Getting your words" : wide ? idle : "Talk: tap and say it";
  const hint = on ? `Stops by itself after a pause, or at ${MAX_MS / 1000} seconds` : busy ? undefined : "Records until you tap again, then puts your words in";
  if (!wide) {
    const ring = on ? 4 + Math.round(mic.level * 8) : 0;
    return (
      <Pressable onPress={mic.toggle} disabled={busy} accessibilityRole="button" accessibilityLabel={a11y} accessibilityHint={hint} accessibilityState={{ busy, selected: on }} testID={testID} hitSlop={4}
        style={({ pressed }) => ({ width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center", backgroundColor: bg, opacity: pressed ? 0.8 : 1, borderWidth: ring ? 2 : 0, borderColor: C.amberSoft, transform: [{ scale: on ? 1 + mic.level * 0.12 : 1 }] })}>
        {on ? <STOP /> : busy ? <Text style={{ color: "#fff", fontWeight: "700", fontSize: 16 }}>…</Text> : <MicGlyph />}
      </Pressable>
    );
  }
  return (
    <Pressable onPress={mic.toggle} disabled={busy} accessibilityRole="button" accessibilityLabel={a11y} accessibilityHint={hint} accessibilityState={{ busy, selected: on }} testID={testID}
      style={({ pressed }) => ({ minHeight: 64, borderRadius: 16, marginTop: 12, paddingHorizontal: 16, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 12, backgroundColor: bg, opacity: pressed ? 0.85 : 1 })}>
      <View style={{ width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.18)", transform: [{ scale: on ? 1 + mic.level * 0.3 : 1 }] }}>
        {on ? <STOP /> : <MicGlyph size={24} />}
      </View>
      <Text style={{ color: "#fff", fontWeight: "700", fontSize: 18, flexShrink: 1 }} maxFontSizeMultiplier={1.6}>{micLabel(mic, idle)}</Text>
    </Pressable>
  );
}
