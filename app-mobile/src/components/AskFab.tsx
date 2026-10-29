// The Agent button (Jard 10-23 #6: "an Agent icon that stays on EVERY screen, bottom-right, always reachable, never
// covering essential UI"): one round button App.tsx draws over the top screen of the app (not the landing, the form or
// the Agent itself). A screen with a footer lifts it above the footer, or hides it while a sheet is up (useAgentSpot);
// every scroll view ends FAB_INSET below its last row (ui.tsx Scroll / List), so it never sits on one. The web's .askfab (public/css/agent.css).
import { Pressable, Text, useWindowDimensions, View } from "react-native";
import { C, useKeyboardUp } from "../ui";
import { Ic } from "../icons"; // the Doors icon set (Jard 10-24 #1)

export const FAB_SIZE = 56;
// the room a screen keeps clear of it: at its right edge (a note box), below its last row (a list)
export const FAB_SIDE = FAB_SIZE + 14;
// a short screen (iPhone SE, 667 pt; mobile2 10-23: the button covered half the stop's note box on its first view)
export const useFabCompact = () => useWindowDimensions().height < 700;
export default function AskFab({ onPress, bottom = 16, testID = "ask-fab" }: { onPress: () => void; bottom?: number; testID?: string }) {
  // while typing (a note, the visit sheet) it rode up on the keyboard and covered the box being typed in (sim, 10-23)
  if (useKeyboardUp()) return null;
  return (
    <View pointerEvents="box-none" style={{ position: "absolute", right: 14, bottom }}>
      <Pressable onPress={onPress} testID={testID} accessibilityRole="button" accessibilityLabel="Doors Agent" accessibilityHint="Ask about your plan, log a visit, or tell it something to note"
        style={({ pressed }) => ({ width: FAB_SIZE, height: FAB_SIZE, alignItems: "center", justifyContent: "center", borderRadius: FAB_SIZE / 2, backgroundColor: C.green, opacity: pressed ? 0.85 : 1, shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 6 })}>
        <Ic name="agent" size={28} color="#fff" />
      </Pressable>
    </View>
  );
}
