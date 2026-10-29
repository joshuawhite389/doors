// The app's menu (Jard 10-23 #5: "hamburger top-left with Export, Privacy, a link to the homepage, Settings"): the ☰ at
// the top-left of the app's root screen (the plan, which has no Back) opens a panel from the left. Home goes out to the
// landing (the demo, a new brand, your saved plans); the plan's Plans button and ⚙ are gone into it. The web's twin is
// the plan's header menu (public/ui/plan.js).
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, Linking, Modal, Pressable, Text, useWindowDimensions, View } from "react-native";
import * as WebBrowser from "expo-web-browser";
import { DOORS_API } from "../config";
import { useNav } from "../nav";
import { C, Logo, s } from "../ui";

// mobile2, 10-23: Privacy sent you to Safari and out of the app. It opens in a sheet over Doors (SFSafariViewController)
// and Done brings you back; Safari only if the sheet can't open
export const openPrivacy = () => WebBrowser.openBrowserAsync(`${DOORS_API}/privacy.html`, { dismissButtonStyle: "done" }).catch(() => Linking.openURL(`${DOORS_API}/privacy.html`));

export function MenuButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable onPress={() => setOpen(true)} accessibilityRole="button" accessibilityLabel="Menu" accessibilityHint="Home, export, settings, privacy" hitSlop={8} testID="menu"
        style={{ minWidth: 44, minHeight: 44, justifyContent: "center", alignItems: "flex-start" }}>
        <View style={{ gap: 4 }} accessibilityElementsHidden importantForAccessibility="no">
          {[0, 1, 2].map((i) => <View key={i} style={{ width: 22, height: 2.5, borderRadius: 2, backgroundColor: C.green }} />)}
        </View>
      </Pressable>
      {open ? <MenuPanel onClose={() => setOpen(false)} /> : null}
    </>
  );
}

function MenuPanel({ onClose }: { onClose: () => void }) {
  const nav = useNav();
  const { width } = useWindowDimensions();
  const w = Math.min(320, Math.round(width * 0.82));
  const x = useRef(new Animated.Value(-w)).current;
  useEffect(() => { Animated.timing(x, { toValue: 0, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(); }, []);
  // mobile2 10-23: Privacy's Safari sheet, presented while this Modal was still closing, hung off the closing Modal and
  // never showed, and the app took no taps until relaunch. Anything that presents a native sheet waits until the Modal
  // has gone (iOS's dismiss animation); a screen change can go at once
  const close = (then?: () => void, sheet?: boolean) => Animated.timing(x, { toValue: -w, duration: 160, useNativeDriver: true }).start(() => { onClose(); if (then) sheet ? setTimeout(then, 450) : then(); });
  const top = nav.stack.at(-1);
  const p = top?.params ?? {};
  const to = top?.name === "demo" || p.demo ? { demo: true } : p.key ? { key: p.key } : null;
  const items: { label: string; sub: string; on: () => void; testID: string; sheet?: boolean }[] = [
    { label: "Home", sub: "Watch the tour, start a new profile, your saved plans", on: () => nav.reset([{ name: "home" }]), testID: "menu-home" },
    ...(to && nav.has("export") ? [{ label: "Export", sub: "The plan as CSV, the drafted messages, the call sheet", on: () => nav.push("export", to), testID: "menu-export" }] : []),
    ...(nav.has("settings") ? [{ label: "Settings", sub: "Edit profile, navigation app", on: () => nav.push("settings", to ?? {}), testID: "menu-settings" }] : []),
    { label: "Privacy", sub: "Saved on this phone only. What Doors sends, and to whom", on: () => openPrivacy(), testID: "menu-privacy", sheet: true },
  ];
  return (
    <Modal transparent visible animationType="none" onRequestClose={() => close()} supportedOrientations={["portrait", "landscape"]}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.3)" }} onPress={() => close()} accessibilityLabel="Close the menu" accessibilityRole="button" />
      <Animated.View accessibilityViewIsModal style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: w, backgroundColor: C.paper, transform: [{ translateX: x }], shadowColor: "#000", shadowOpacity: 0.2, shadowRadius: 16 }} testID="menu-panel">
        <View style={{ paddingTop: 70, paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: 1, borderColor: C.line }}>
          <Logo />
        </View>
        {items.map((it) => (
          <Pressable key={it.testID} testID={it.testID} accessibilityRole="button" accessibilityLabel={it.label} accessibilityHint={it.sub} onPress={() => close(it.on, it.sheet)}
            style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingVertical: 14, minHeight: 60, backgroundColor: pressed ? C.line2 : "transparent" })}>
            <View style={{ flex: 1 }}>
              <Text style={s.h3} maxFontSizeMultiplier={1.6}>{it.label}</Text>
              <Text style={s.small} maxFontSizeMultiplier={1.6}>{it.sub}</Text>
            </View>
          </Pressable>
        ))}
      </Animated.View>
    </Modal>
  );
}
