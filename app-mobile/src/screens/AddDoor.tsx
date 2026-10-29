// Add a door (plan.js drawAdd): Find it on Qloo (one search per tap; the room's own listing, "already ranked #k of N")
// or Enter it myself (name, address with predictions, or a pin dropped on the map) → saved as your contact, always
// scheduled on the first day it's open and fits; the plan says where it landed.
import { useRef, useState } from "react";
import { Pressable, Text, TextInput, View } from "react-native";
import { pinLabel } from "../../../public/lib/profile.js";
import { searchPlaces, geocode, type GeoRow } from "../data";
import { usePlanEngine } from "./Plan";
import { useNav } from "../nav";
import PlanMap from "../components/PlanMap";
import { Btn, C, Chip, Row, Screen, T, s } from "../ui";

const SEARCH_OFF = "Address search is off right now: drop a pin instead.";

export default function AddDoor({ params }: { params: any }) {
  const nav = useNav();
  const e = usePlanEngine(params);
  const [tab, setTab] = useState<"qloo" | "manual">("qloo");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<any>(null);
  const [name, setName] = useState("");
  const [addr, setAddr] = useState("");
  const [geo, setGeo] = useState<GeoRow[] | null | undefined>(undefined);
  const [pin, setPin] = useState<{ lat: number; lon: number } | null>(null);
  const timer = useRef<any>(null);
  if (!e?.plan) return <Screen title="Add a door"><T k="muted">That plan isn't open.</T></Screen>;
  const c = e.c;
  const plan = e.plan;
  const search = async () => {
    if (q.trim().length < 2) return;
    setRows("loading");
    try { setRows(await searchPlaces(q.trim(), c.key, c.live ? c : null)); } catch (err: any) { setRows({ error: `Qloo search didn't answer: ${err.message}` }); }
  };
  const add = async (v: any) => {
    nav.back();
    await e.addContact(v);
  };
  const lookUp = (text: string) => {
    setAddr(text);
    clearTimeout(timer.current);
    if (text.trim().length < 4) return setGeo(undefined);
    timer.current = setTimeout(async () => setGeo(await geocode(text.trim(), c.key, c.live ? { cityName: e.profile.cityName, center: c.center } : null)), 450);
  };
  const center = plan.days[0]?.start ?? e.profile.start;
  return (
    <Screen title="Add a door" testID="add-door">
      <T k="h2">Add a door</T>
      <T k="muted">A door you know: it's always scheduled, on the first day it's open and fits.</T>
      <Row style={{ marginTop: 12 }}>
        <Chip label="Find it on Qloo" on={tab === "qloo"} onPress={() => setTab("qloo")} testID="add-tab-qloo" />
        <Chip label="Enter it myself" on={tab === "manual"} onPress={() => setTab("manual")} testID="add-tab-manual" />
      </Row>
      {tab === "qloo" ? (
        <View style={{ marginTop: 12 }}>
          <Row wrap={false}>
            <TextInput accessibilityLabel={`Search a bar or restaurant in ${c.name}`} style={[s.input, { flex: 1 }]} value={q} onChangeText={setQ} placeholder={`Name of the bar or restaurant in ${c.name}`} placeholderTextColor={C.ph} returnKeyType="search" onSubmitEditing={search} autoCorrect={false} testID="add-q" />
            <Btn small label="Search" onPress={search} />
          </Row>
          <T k="small" style={{ marginTop: 4 }}>One Qloo search per tap. You get the door's own listing: address and hours.</T>
          {rows === "loading" ? <T k="muted" style={{ marginTop: 10 }}>Searching Qloo…</T> : rows?.error ? <T k="muted" style={{ marginTop: 10 }}>{rows.error}</T> : Array.isArray(rows) && !rows.length ? <T k="muted" style={{ marginTop: 10 }}>No {c.name} place by that name on Qloo. Try "Enter it myself".</T> : null}
          {Array.isArray(rows) ? rows.map((r: any) => {
            const k = plan.pool.ids.indexOf(r.id);
            const mine = (e.st.contacts ?? []).some((x: any) => x.id === r.id);
            return (
              <View key={r.id} style={[s.card, { flexDirection: "row", gap: 10, alignItems: "center" }]}>
                <View style={{ flex: 1 }}><T k="h3">{r.name}</T><T k="small">{r.where ?? ""}{k >= 0 ? ` · already ranked #${k + 1} of ${plan.pool.N}` : ""}</T></View>
                <Btn small kind="line" label={mine ? "Added" : "Add"} disabled={mine} onPress={() => add({ ...r.venue, source: "qloo" })} />
              </View>
            );
          }) : null}
        </View>
      ) : (
        <View style={{ marginTop: 12 }}>
          <T k="label">Name</T>
          <TextInput accessibilityLabel="Name" style={s.input} value={name} onChangeText={setName} placeholder="e.g. Barb's Back Room" placeholderTextColor={C.ph} testID="add-name" />
          <T k="label" style={{ marginTop: 12 }}>Address</T>
          <TextInput accessibilityLabel="Address" style={s.input} value={addr} onChangeText={lookUp} placeholder={`Street address in ${c.name}`} placeholderTextColor={C.ph} />
          {geo !== undefined ? (
            <View style={{ borderWidth: 1, borderColor: C.line, borderRadius: 12, marginTop: 6, backgroundColor: C.paper }}>
              {(geo ?? []).map((r, i) => <Pressable key={i} onPress={() => { setAddr(r.label); setGeo(undefined); setPin({ lat: r.lat, lon: r.lon }); }} accessibilityRole="button" style={{ padding: 12, borderBottomWidth: 1, borderColor: C.line2 }}><Text style={s.body}>{r.label}</Text></Pressable>)}
              {!geo?.length ? <Text maxFontSizeMultiplier={2} style={[s.muted, { padding: 12 }]}>{geo === null ? SEARCH_OFF : "No match in this city: drop a pin instead."}</Text> : null}
            </View>
          ) : null}
          <T k="small" style={{ marginTop: 6 }}>{pin ? `${pinLabel(pin, c.key, plan.venues)}.` : "Type the address, or tap the map where the door is."}</T>
          <View style={{ marginTop: 8 }}>
            <PlanMap days={[]} height={240} marker={pin} onPress={setPin} onMarker={setPin} center={center ? { lat: center.lat, lon: center.lon } : null} fitKey={pin ? `${pin.lat}` : "add"} />
          </View>
          <Btn label="Add as my contact" disabled={!name.trim() || !pin} testID="add-save"
            onPress={() => add({ id: `contact:${Date.now().toString(36)}`, name: name.trim(), address: addr.trim() || null, lat: pin!.lat, lon: pin!.lon, hours: null, genre: null, source: "manual" })} />
          <T k="small" style={{ marginTop: 6 }}>Hours unknown: it's marked "hours unverified" and scheduled in your windows.</T>
        </View>
      )}
      <Btn kind="ghost" label="Back to the plan" onPress={() => nav.back()} />
    </Screen>
  );
}
