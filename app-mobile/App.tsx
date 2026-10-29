// Doors on the phone: the whole web app, natively (PARITY.md). Home (the landing + your plans) → the brand form →
// the plan (days, week, your list, map, tools) → a stop / Ask / drive mode, on the web's own logic (../public/lib),
// the web's store (same keys) and the same Worker API. Opens on the newest saved plan, as the web's /app does.
import { useEffect, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, SafeAreaView, Text, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { DOORS_API } from "./src/config";
import { boot, store } from "./src/session";
import { NavProvider, RouteKey, agentTo, useAgentSpotFor, useNav, type Route } from "./src/nav";
import SwipeNav from "./src/components/SwipeNav";
import AskFab from "./src/components/AskFab";
import { Btn, C, s } from "./src/ui";
import Home from "./src/screens/Home";
import Form from "./src/screens/Form";
import Plan from "./src/screens/Plan";
import Stop from "./src/screens/Stop";
import Ask from "./src/screens/Ask";
import Drive from "./src/screens/Drive";
import AddDoor from "./src/screens/AddDoor";
import Run from "./src/screens/Run";
import TourCard from "./src/components/TourCard";
import Why from "./src/screens/Why";
import Room from "./src/screens/Room";
import Export from "./src/screens/Export";
import Settings from "./src/screens/Settings";
import DoorPage from "./src/screens/DoorPage";

const SCREENS: Record<string, (p: { params: any }) => React.ReactNode> = {
  home: () => <Home />,
  form: ({ params }) => <Form params={params ?? {}} />,
  plan: ({ params }) => <Plan params={params ?? {}} />,
  demo: () => <Plan params={{ demo: true }} />,
  stop: ({ params }) => <Stop params={params} />,
  ask: ({ params }) => <Ask params={params} />,
  add: ({ params }) => <AddDoor params={params} />,
  run: ({ params }) => <Run params={params} />,
  why: ({ params }) => <Why params={params} />,
  room: ({ params }) => <Room params={params} />,
  doorpage: ({ params }) => <DoorPage params={params} />,
  export: ({ params }) => <Export params={params} />,
  settings: ({ params }) => <Settings params={params} />,
  drive: ({ params }) => (
    <View style={{ flex: 1, backgroundColor: "#faf7f2" }}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}><Drive params={params} /></KeyboardAvoidingView>
    </View>
  ),
};
const NAMES = Object.keys(SCREENS);

// The one Agent button (Jard 10-23 #6), bottom-right over every screen of the app that has a plan, the form included
// when it edits one ("it can help fill the profile"): not the landing, not the Agent itself. A brand-new
// profile has no plan for the Agent to read yet. A screen moves or hides it with useAgentSpot (nav.tsx).
function Agent({ top }: { top: Route }) {
  const nav = useNav();
  const spot = useAgentSpotFor(top.key);
  const to = agentTo(top);
  if (!to || spot.hide || !nav.has("ask")) return null;
  return <AskFab bottom={spot.bottom ?? 16} onPress={spot.onPress ?? (() => nav.push("ask", { ...to, ...(spot.current ? { current: spot.current } : null) }))} />;
}

// ONE safe area for the whole app, mounted once: a SafeAreaView per screen drew each new screen's header under the
// status bar for its first frame, then dropped it into place (iOS gives a new SafeAreaView its insets a frame late)
function Root({ children, style }: { children: React.ReactNode; style?: any }) {
  return <SafeAreaView style={[{ flex: 1, backgroundColor: C.bg }, style]}>{children}</SafeAreaView>;
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const start = () => {
    setError(null);
    boot().then(() => setReady(true)).catch((e) => setError(String(e?.message ?? e)));
  };
  useEffect(start, []);
  if (error) {
    return (
      <Root><View style={s.pad}>
        <Text style={s.h2}>Couldn't reach Doors</Text>
        <Text style={s.body}>Doors needs a connection the first time it opens, to load its city lists. Check you're online, then try again.</Text>
        <Btn label="Try again" onPress={start} />
        {/* the technical reason, small, for whoever is debugging (was the raw URL and error as the message) */}
        <Text maxFontSizeMultiplier={2} style={[s.small, { marginTop: 12 }]}>{DOORS_API} · {error}</Text>
      </View></Root>
    );
  }
  if (!ready) {
    return (
      <Root style={{ justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator size="large" color={C.green} />
        <Text maxFontSizeMultiplier={2} style={[s.muted, { marginTop: 12 }]}>Opening Doors…</Text>
      </Root>
    );
  }
  const newest = store().list()[0];
  const initial = newest ? [{ name: "home" }, { name: "plan", params: { key: { brand: newest.brand, city: newest.city } } }] : [{ name: "home" }];
  return (
    <Root>
      <NavProvider initial={initial} names={NAMES}>
        {(top) => (
          <View style={{ flex: 1, backgroundColor: C.bg }}>
            <SwipeNav routeKey={top.key}>
              <RouteKey.Provider value={top.key}>
                <View style={{ flex: 1 }} key={top.key}>{SCREENS[top.name]?.({ params: top.params }) ?? <Text>Unknown screen</Text>}</View>
              </RouteKey.Provider>
              <Agent top={top} />
            </SwipeNav>
            <TourCard />
          </View>
        )}
      </NavProvider>
      <StatusBar style="dark" />
    </Root>
  );
}
