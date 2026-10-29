// Home: the web's landing page (public/index.html + ui/landing.js) and "Your plans" (ui/profile.js mountPlans):
// open your newest plan, every saved plan with Duplicate / Delete, Watch the tour (the demo), Start with my brand.
// Outside the app (Jard 10-23 #4): opening a plan leaves it behind (nav.tsx APP_ROOTS); the plan's ☰ menu has Home.
import { useEffect, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { planRow } from "../../../public/lib/plans.js";
import { clockShort, labelDrinker } from "../../../public/lib/pool.js";
import { cap } from "../engine";
import { useNav } from "../nav";
import { index, store, openDemo, dropEngine, dropDraftOf } from "../session";
import { roadFor, seedDemoRoads } from "../roads";
import { getJSON } from "../data";
import { tour } from "../tour";
import PlanMap, { type MapDay } from "../components/PlanMap";
import { Btn, C, Row, Screen, T, s, colour } from "../ui";

const STEPS = [
  ["1 · Tell it about your brand", "What you make, who drinks it, where you're opening and where your day starts."],
  ["2 · Doors picks the doors and plans the route", "Qloo's taste data ranks every bar and restaurant in the city for your drinker, and Doors routes the best open ones."],
  ["3 · Visit each door", "Open a stop, read why it's on your list and the drafted message, go in, log the visit."],
  ["4 · Log visits and re-plan", "Ask Doors Agent why a door is where it is, with sources. Say how a visit went from the car, and the follow-up and the rest of the week re-plan."],
];

export function PlansList({ onChange }: { onChange?: () => void }) {
  const nav = useNav();
  const [, setN] = useState(0);
  const [ask, setAsk] = useState<string | null>(null);
  const rows = store().list().map((r: any) => ({ r, row: planRow(r, index?.cities ?? []) }));
  if (!rows.length) return <T k="muted">No saved plans yet. Build one and it shows here.</T>;
  return (
    <View testID="plans-list">
      {rows.map(({ r, row }: any) => (
        <View key={row.id} style={s.card}>
          <Pressable onPress={() => nav.push("plan", { key: { brand: r.brand, city: r.city } })} accessibilityRole="button">
            <T k="h3">{row.name} <Text style={{ fontWeight: "400" }}>in {row.city}</Text></T>
            <T k="muted">{row.days}{row.opened ? ` · ${row.opened}` : ""}</T>
          </Pressable>
          {ask === row.id ? (
            <View style={{ marginTop: 8 }}>
              <T k="body">Delete {row.name} in {row.city}? Its statuses, outcomes and contacts go too.</T>
              <Row style={{ marginTop: 8 }}>
                <Btn small kind="warn" label="Delete" a11y={`Yes, delete ${row.name} in ${row.city}`} onPress={() => { store().remove(r.brand, r.city); dropEngine({ brand: r.brand, city: r.city }); dropDraftOf(r.brand, r.city); setAsk(null); setN((n) => n + 1); onChange?.(); }} />
                <Btn small kind="line" label="Keep" onPress={() => setAsk(null)} />
              </Row>
            </View>
          ) : (
            <Row style={{ marginTop: 8 }}>
              <Btn small kind="primary" label="Open" a11y={`Open ${row.name} in ${row.city}`} onPress={() => nav.push("plan", { key: { brand: r.brand, city: r.city } })} />
              <Btn small kind="line" label="Edit" a11y={`Edit ${row.name} in ${row.city}`} onPress={() => nav.push("form", { edit: { brand: r.brand, city: r.city } })} />
              <Btn small kind="line" label="Duplicate" a11y={`Duplicate ${row.name} in ${row.city}`} onPress={() => nav.push("form", { edit: { brand: r.brand, city: r.city }, copy: true })} />
              <Btn small kind="ghost" label="Delete" a11y={`Delete ${row.name} in ${row.city}`} onPress={() => setAsk(row.id)} />
            </Row>
          )}
        </View>
      ))}
    </View>
  );
}

export default function Home() {
  const nav = useNav();
  const [n, setN] = useState(0);
  const rows = useMemo(() => store().list(), [n, nav.stack.length]);
  const [hero, setHero] = useState<{ day: MapDay; cap: string } | null>(null);
  useEffect(() => {
    // the hero: the demo's first baked day (Austin), its road from the bake, as the landing's map
    (async () => {
      const e = await openDemo();
      const demo = await getJSON("/data/demo/demo.json");
      seedDemoRoads(demo.roads, e.plan.venues);
      const d = e.plan.days.find((x: any) => x.stops.length);
      if (!d) return;
      const pins = d.stops.map((st: any, k: number) => ({ id: st.id, lat: +e.plan.venues[st.id].lat, lon: +e.plan.venues[st.id].lon, label: String(k + 1), color: colour(0), title: `${k + 1}. ${e.plan.venues[st.id].name}`, z: 50 - k }));
      const road = await roadFor(d.start, d.stops.map((st: any) => e.plan.venues[st.id]), { offline: true });
      const who = labelDrinker(e.plan.pool.label) ?? "Athletic Brewing drinkers";
      setHero({ day: { key: d.date, color: colour(0), start: d.start, pins, road }, cap: `${who} · Austin · ${cap(d.day).slice(0, 3)} ${clockShort(d.from)}–${clockShort(d.to)} · ${d.stops.length} doors` });
    })().catch(() => {});
  }, []);
  const top = rows[0];
  const topRow = top ? planRow(top, index?.cities ?? []) : null;
  return (
    // the landing is outside the app (Jard 10-23 #4): no Back into it from the plan, the plan's ☰ Home comes here. Its
    // header's Get started went (#3: Start my profile below says the same)
    <Screen testID="home" back={false}>
      <T k="small" style={{ color: C.green, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.6 }}>For drink brands and distributor reps</T>
      <T k="h1" style={{ marginTop: 6 }}>Plan your sales days in a new city.</T>
      <T k="body">Doors ranks every bar and restaurant by how well its regulars match your drinkers, plans your sales days as driving routes with talking points for every stop. Log how each visit went and the days ahead re-plan; ask Doors Agent why it picked a door.</T>
      {topRow ? <Btn testID="open-newest" label={`Open your plan: ${topRow.name} · ${topRow.city}`} onPress={() => nav.push("plan", { key: { brand: top.brand, city: top.city } })} /> : null}
      <Btn testID="watch-demo" kind={topRow ? "line" : "primary"} label="Watch the tour →" onPress={() => tour.start()} />
      <Btn testID="start-brand" kind="line" label="Start my profile" onPress={() => nav.push("form", {})} />
      <T k="small" style={{ marginTop: 8 }}>Built for NA beer, RTD, craft spirits and functional drinks. Rankings from Qloo's taste data.</T>
      {hero ? (
        <View style={{ marginTop: 14 }}>
          <PlanMap days={[hero.day]} height={240} fitKey="hero" still />
          <T k="small" style={{ marginTop: 6 }}>{hero.cap}</T>
        </View>
      ) : null}
      {rows.length ? (
        <View style={s.sect}>
          <T k="h2">Your plans</T>
          <PlansList onChange={() => setN(n + 1)} />
        </View>
      ) : null}
      <View style={s.sect}>
        {STEPS.map(([h, b]) => (
          <View key={h} style={{ marginBottom: 12 }}><T k="h3">{h}</T><T k="muted">{b}</T></View>
        ))}
      </View>
      <View style={s.sect}>
        <T k="h2">Who it's for</T>
        <View style={s.card}>
          <T k="h3">For brands</T>
          <T k="muted">Doors starts from the brands your drinker already buys and finds the doors where people like them are regulars.</T>
          {["A plan for each day you're in town, open doors only", "Why each door is on the list, from Qloo's profile of the door", "A drafted message and talking points for every door"].map((x) => <T key={x} k="body">• {x}</T>)}
        </View>
        <View style={s.card}>
          <T k="h3">For distributor reps</T>
          <T k="muted">A new SKU in your book and a week to get placements. Doors gives you the doors whose crowd fits it, grouped by area and in route order from your first stop.</T>
          {["Day routes built around the hours you have", "Log an outcome at each door; doors you miss move to a later day", "Export the plan for your manager or your CRM"].map((x) => <T key={x} k="body">• {x}</T>)}
        </View>
      </View>
      <View style={s.sect}>
        <T k="muted">The doors whose regulars drink like yours, whether or not they pour you yet. Not a distribution check: Qloo doesn't know what a door stocks.</T>
        <T k="small" style={{ marginTop: 8 }}>Bar and restaurant rankings and listings from Qloo's taste data. Maps: Apple Maps; routes: OSRM, © OpenStreetMap contributors. Built for the Qloo Agentic Hackathon.</T>
        <T k="small" style={{ marginTop: 4 }}>Saved on this device only.</T>
      </View>
    </Screen>
  );
}
