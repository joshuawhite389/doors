// Settings (Jard 10-23 #5: "Settings = Edit profile, Change navigation app, plus typical mobile-app settings
// (placeholders OK)"), opened from the ☰ menu: an iOS grouped list. Real rows: Edit profile, Navigation app, Read aloud
// in drive mode (drive mode's own Voice switch, same setting), Privacy, Version. Ease audit 10-23 #3: the "Coming soon"
// placeholders are cut (five of eight rows did nothing). Export and Home live in the menu. The web's twin is the ⚙ panel (public/ui/plan.js drawSettings).
import { useState } from "react";
import { Pressable, Switch, Text, View } from "react-native";
import Constants from "expo-constants";
import { usePlanEngine } from "./Plan";
import { useAgentSpot, useNav } from "../nav";
import { chooseNavApp, navAppName, savedNavApp, type NavApp } from "../navapp";
import { appGet, appSet } from "../storage";
import { openPrivacy } from "../components/AppMenu";
import { C, Screen, T, s } from "../ui";

function Group({ title, children, foot }: { title: string; children: React.ReactNode; foot?: string }) {
  return (
    <View style={{ marginTop: 22 }}>
      <Text style={[s.sectH, { marginLeft: 16, marginBottom: 6 }]} accessibilityRole="header" maxFontSizeMultiplier={1.6}>{title}</Text>
      <View style={{ backgroundColor: C.paper, borderRadius: 12, borderWidth: 1, borderColor: C.line, overflow: "hidden" }}>{children}</View>
      {foot ? <T k="small" style={{ marginHorizontal: 16, marginTop: 6 }}>{foot}</T> : null}
    </View>
  );
}
// one row: a label, its value or a switch, a chevron when it opens something
function Item({ label, value, onPress, sw, last, testID }: { label: string; value?: string; onPress?: () => void; sw?: { on: boolean; set: (v: boolean) => void }; last?: boolean; testID?: string }) {
  // mobile2 10-23 (AX large, SE): the value took the row and the label wrapped a letter a line. The label keeps its own
  // width (words wrap, never letters); the value, switch and chevron go on the next line when they don't fit beside it
  const body = (
    <>
      <View style={{ flexGrow: 1, flexShrink: 0, maxWidth: "100%" }}>
        <Text style={s.body} maxFontSizeMultiplier={1.8}>{label}</Text>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginLeft: "auto", flexShrink: 1 }}>
        {value ? <Text style={[s.body, { color: C.ink3, flexShrink: 1, textAlign: "right" }]} maxFontSizeMultiplier={1.8}>{value}</Text> : null}
        {sw ? <Switch value={sw.on} onValueChange={sw.set} trackColor={{ true: C.green }} accessibilityLabel={label} testID={testID} /> : null}
        {onPress ? <Text style={{ fontSize: 22, color: C.ink3, marginLeft: 4 }} allowFontScaling={false} accessibilityElementsHidden importantForAccessibility="no">›</Text> : null}
      </View>
    </>
  );
  const style = { flexDirection: "row" as const, flexWrap: "wrap" as const, alignItems: "center" as const, columnGap: 10, rowGap: 2, minHeight: 50, paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: last ? 0 : 1, borderColor: C.line2 };
  if (!onPress) return <View style={style} accessible={!sw} accessibilityLabel={sw ? undefined : `${label}${value ? `: ${value}` : ""}`}>{body}</View>;
  return <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${label}${value ? `: ${value}` : ""}`} testID={testID} style={({ pressed }) => [style, pressed && { backgroundColor: C.line2 }]}>{body}</Pressable>;
}

export default function Settings({ params }: { params: any }) {
  const nav = useNav();
  const e = usePlanEngine(params);
  useAgentSpot({ hide: true }); // intuit 1b #6 (mobile2 10-24): nothing to ask here; the 💬 only covered the page
  const [app, setApp] = useState<NavApp | null>(savedNavApp());
  const [voice, setVoice] = useState(() => appGet("driveVoice") !== "off");
  const plan = e?.plan;
  const version = Constants.expoConfig?.version ?? "";
  return (
    <Screen title="Settings" testID="settings">
      {e && nav.has("form") ? (
        <Group title="Your profile">
          <Item label="Edit profile" value={plan ? `${e.profile.brand.trim() || "Your brand"} · ${plan.city.name}` : undefined} onPress={() => nav.push("form", e.demo ? { demo: true } : { edit: e.key })} last testID="set-profile" />
        </Group>
      ) : null}
      <Group title="On the road">
        <Item label="Navigation app" value={navAppName(app)} onPress={() => chooseNavApp(setApp)} testID="set-navapp" />
        <Item label="Read aloud in drive mode" sw={{ on: voice, set: (v) => { appSet("driveVoice", v ? "on" : "off"); setVoice(v); } }} testID="set-voice" last />
      </Group>
      <Group title="About" foot="Your plans are saved on this phone only.">
        <Item label="Privacy" onPress={() => openPrivacy()} testID="set-privacy" />
        <Item label="Version" value={version} last />
      </Group>
    </Screen>
  );
}
