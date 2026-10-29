// ▶ Watch the route (ui/animate.js): the selected day's route plays on the map, door by door, with Stop / Replay, a speed
// (½×–4×) and the other days to pick (the web's "Play all days" from the week = each day in turn here).
import { useEffect, useState } from "react";
import { View } from "react-native";
import { SPEEDS } from "../../../public/lib/follow.js";
import { cap } from "../engine";
import { usePlanEngine } from "./Plan";
import { workerFetch } from "../data";
import RunMap, { type RunDay } from "../components/RunMap";
import { runDayOf } from "../runday";
import { Btn, C, Chip, Row, Screen, T, colour } from "../ui";

const coordsOf = (start: any, stops: any[]) => [[start.lon, start.lat], ...stops.map((s) => [s.lon, s.lat])].map(([x, y]) => [+(+x).toFixed(6), +(+y).toFixed(6)]);
const roads = new Map<string, any>();
async function directions(start: any, stops: any[], offline: boolean, baked: any[]) {
  const c = coordsOf(start, stops);
  const key = JSON.stringify(c);
  if (roads.has(key)) return roads.get(key);
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-4;
  const bake = baked.find((r: any) => r?.geometry?.type === "LineString" && r.source !== "estimate" && near(r.start?.lat, start.lat) && near(r.start?.lon, start.lon) && r.stops?.length === stops.length && r.stops.every((x: any, i: number) => x.id === stops[i].id));
  let out: any = bake ? { coords: bake.geometry.coordinates, wayPoints: bake.wayPoints ?? null, solid: true, label: bake.label ?? "Roads" } : null;
  if (!out && !offline) {
    try {
      const r = await workerFetch("/api/directions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ coords: c }) });
      const b = r.ok ? await r.json() : null;
      if (b?.geometry?.coordinates?.length >= 2 && b.source !== "estimate") out = { coords: b.geometry.coordinates, wayPoints: b.wayPoints ?? null, solid: true, label: b.label ?? "Roads" };
    } catch {}
  }
  out ??= { coords: c, wayPoints: c.map((_, i) => i), solid: false, label: "Route estimated: straight lines between stops" };
  roads.set(key, out);
  return out;
}

export default function Run({ params }: { params: any }) {
  const e = usePlanEngine(params);
  const plan = e?.plan;
  const first = plan ? (Number.isInteger(params.day) && plan.days[params.day]?.stops.length ? params.day : plan.days.findIndex((d: any) => d.stops.length)) : -1;
  const [k, setK] = useState<number>(first);
  const [day, setDay] = useState<RunDay | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [runKey, setRunKey] = useState(0);
  const [baked, setBaked] = useState<any[]>([]);
  useEffect(() => { if (e?.demo) import("../data").then((m) => m.getJSON("/data/demo/demo.json")).then((d) => setBaked(d.roads ?? [])); }, [e]);
  useEffect(() => {
    if (!plan || k < 0) return;
    const d = plan.days[k];
    const vs = d.stops.map((s: any) => plan.venues[s.id]);
    directions(d.start, d.stops.map((s: any, i: number) => ({ ...s, lat: +vs[i].lat, lon: +vs[i].lon })), !!e!.demo, baked).then((r) => {
      setDay(runDayOf(plan, e!.routes, k, r, `${d.date}-${runKey}`));
      setPlaying(true);
    });
  }, [plan, k, runKey, baked]);
  if (!e || !plan) return <Screen title="Watch the route"><T k="muted">That plan isn't open.</T></Screen>;
  const days = plan.days.map((d: any, i: number) => ({ d, i })).filter(({ d }: any) => d.stops.length);
  return (
    <Screen title={params.all ? "Watch all days" : "Watch the route"} scroll={false} testID="run">
      <View style={{ flex: 1 }}>{day ? <RunMap day={day} playing={playing} speed={speed} runKey={runKey} onEnd={() => { setPlaying(false); const nx = days.find(({ i }: any) => i > k); if (params.all && nx) setK(nx.i); }} /> : null}</View>
      <View style={{ padding: 12, gap: 8, borderTopWidth: 1, borderColor: C.line }}>
        <Row>
          {playing ? <Btn small icon="stop" label="Stop" onPress={() => setPlaying(false)} testID="run-stop" /> : <Btn small icon="play" label="Watch the route" onPress={() => { setRunKey(runKey + 1); }} testID="run-play" />}
          {SPEEDS.map((x: number) => <Chip key={x} label={`${x === 0.5 ? "½" : x}×`} a11y={`${x === 0.5 ? "Half" : x === 1 ? "Normal" : `${x} times`} speed`} on={speed === x} onPress={() => setSpeed(x)} />)}
        </Row>
        <Row>{days.map(({ d, i }: any) => <Chip key={d.date} color={colour(i)} label={`${cap(d.day).slice(0, 3)} · ${d.stops.length}`} a11y={`${cap(d.day)}, ${d.stops.length} door${d.stops.length === 1 ? "" : "s"}`} on={k === i} onPress={() => { setK(i); setRunKey(runKey + 1); }} />)}</Row>
      </View>
    </Screen>
  );
}
