// Room (public/ui/room.js): everything Qloo says about one room, and why it was chosen. Opened from a stop's "Why this
// room" (section "sisters" scrolls to the sister rooms), a sister room, or a Why these rooms card. Content from
// lib/roominsight.js: how the room was chosen, the taste match per drinker, the age bands, other ready brands'
// drinkers (their route files load when the screen opens), popularity and rating, Qloo's crowd / room text, the crowd's
// music (only when the sound guard passed), and sister rooms (tally, open a sister, Open stop, + Add).
// params: {key | demo, id, section?, venue?} — venue: a place outside the plan's venues and the city's sister records
// (a famous room or a look-alike from Why these rooms), so the deep-dive has its record.
import { useEffect, useMemo, useRef, useState } from "react";
import { Linking, Pressable, ScrollView, Text, View } from "react-native";
import { roomInsight, otherBrandFiles, rankBar } from "../../../public/lib/roominsight.js";
import { rankAffinity } from "../../../public/lib/planview.js";
import { usePlanEngine } from "./Plan";
import { index } from "../session";
import { getJSON } from "../data";
import { useNav } from "../nav";
import { Btn, C, Row, Screen, T, Toast, s, Scroll } from "../ui";

const KIND: Record<string, string> = { on: C.green, ranked: "#8FB3A5", filtered: "#C9C4B8", famous: C.amber, marked: "#868B91", unranked: "#E3E0D8" };
const SOURCE: Record<string, string> = { customer_demographics_description: "crowd description", ambience_description: "ambience description", description: "description" };
const pct = (x: number) => `${Math.round(Math.max(0, Math.min(1, x)) * 100)}%`;

export function Bar({ x, color = C.green, soft, tick }: { x: number; color?: string; soft?: boolean; tick?: number }) {
  return (
    <View style={{ height: 8, borderRadius: 4, backgroundColor: C.seg, overflow: "hidden", flex: 1, minWidth: 60 }}>
      <View style={{ width: pct(x) as any, height: 8, borderRadius: 4, backgroundColor: color, opacity: soft ? 0.45 : 1 }} />
      {tick != null ? <View style={{ position: "absolute", left: pct(tick) as any, top: 0, bottom: 0, width: 2, backgroundColor: C.ink }} /> : null}
    </View>
  );
}
function BarRow({ label, sub, x, val, color, soft, best, out, tick }: { label: string; sub?: string; x: number; val: string; color?: string; soft?: boolean; best?: boolean; out?: boolean; tick?: number }) {
  return (
    <View style={{ marginTop: 8, opacity: out ? 0.6 : 1 }}>
      <Row wrap={false} style={{ justifyContent: "space-between" }}>
        {/* one element: the label and its value ("Rating: 4.6 of 5", not '★') */}
        <Text maxFontSizeMultiplier={2} style={[s.small, { color: C.ink, fontWeight: best ? "700" : "500", flex: 1 }]} accessibilityLabel={`${label}${sub ? ` ${sub}` : ""}: ${val.replace(/★\s*/, "")}`}>{label}{sub ? <Text maxFontSizeMultiplier={2} style={s.small}>  {sub}</Text> : null}</Text>
        <Text maxFontSizeMultiplier={2} style={[s.small, { color: C.ink2 }]} accessibilityElementsHidden importantForAccessibility="no">{val}</Text>
      </Row>
      <View style={{ flexDirection: "row", marginTop: 4 }}><Bar x={x} color={color} soft={soft} tick={tick} /></View>
    </View>
  );
}
const Sect = ({ title, children, onLayout, testID }: { title: string; children: React.ReactNode; onLayout?: (y: number) => void; testID?: string }) => (
  <View style={s.sect} onLayout={(ev) => onLayout?.(ev.nativeEvent.layout.y)} testID={testID}>
    <Text style={[s.h3, { marginBottom: 6 }]}>{title}</Text>
    {children}
  </View>
);
const Cap = ({ children }: { children: React.ReactNode }) => <Text maxFontSizeMultiplier={2} style={[s.small, { marginTop: 8 }]}>{children}</Text>;
const Say = ({ children }: { children: React.ReactNode }) => <Text style={[s.body, { fontSize: 15, marginTop: 4 }]}>{children}</Text>;
const Pill = ({ text, strong }: { text: string; strong?: boolean }) => (
  <View style={[s.tag, { backgroundColor: strong ? C.greenSoft : C.chip, borderRadius: 999, paddingHorizontal: 10 }]}><Text style={[s.tagText, strong && { color: C.green }]}>{text}</Text></View>
);

export default function Room({ params }: { params: any }) {
  const nav = useNav();
  const e = usePlanEngine(params);
  const [data, setData] = useState<any>(null);
  const [others, setOthers] = useState<any[] | null>(null);
  const [adding, setAdding] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const scroller = useRef<any>(null);
  const ys = useRef<Record<string, number>>({});
  const scrolled = useRef(false);
  useEffect(() => { e?.stopData().then(setData).catch(() => setData({})); }, [e]);
  useEffect(() => {
    const plan = e?.plan;
    if (!plan || !index) return setOthers([]);
    let on = true;
    Promise.all(otherBrandFiles(index, plan).map((f: any) => getJSON(`/data/routes/${f.file}.json`).catch(() => null)))
      .then((xs) => on && setOthers(xs.filter(Boolean)))
      .catch(() => on && setOthers([]));
    return () => { on = false; };
  }, [e]);
  const plan = e?.plan;
  const city = useMemo(() => {
    const c = data?.city ?? null;
    const v = params.venue;
    // a famous room or a look-alike rides along as a sister record (why.js openDeepDive)
    return v && !plan?.venues?.[params.id] && !c?.sisterVenues?.[params.id] ? { ...(c ?? {}), sisterVenues: { ...(c?.sisterVenues ?? {}), [params.id]: v } } : c;
  }, [data, params.venue, params.id, plan]);
  const ri = useMemo(() => (plan && data ? roomInsight({ plan, id: params.id, city, routes: e!.routes, others: others ?? [] }) : null), [plan, data, city, others, params.id]);
  if (!e || !plan) return <Screen title="About this door"><T k="muted">That plan isn't open.</T></Screen>;
  if (!ri) return <Screen title="About this door"><T k="muted">Reading Qloo's record of this door…</T></Screen>;
  const at = (k: string) => (y: number) => {
    ys.current[k] = y;
    if (params.section === k && !scrolled.current && others != null) {
      scrolled.current = true;
      setTimeout(() => scroller.current?.scrollTo({ y: Math.max(0, y - 8), animated: false }), 60);
    }
  };
  const v = ri.venue;
  const st = ri.status;
  const aff = ri.rank ? rankAffinity(plan, e.routes, params.id) : "";
  const famousIncl = ri.drinkers.some((d: any) => d.kind === "pour" || d.kind === "room");
  const chips = [ri.facts.liveMusic === true ? "Live music" : null, ...ri.facts.goodFor.map((g: any) => (typeof g === "string" ? g : g?.name)).filter(Boolean)].filter(Boolean) as string[];
  const m = ri.music;
  const on = ri.sisters.filter((x: any) => x.status.kind === "on").length;
  const add = async (x: any) => {
    if (!x.venue) return;
    setAdding(x.id);
    await e.addDoor(x.venue, { date: null });
    setAdding(null);
    const now = roomInsight({ plan: e.plan, id: params.id, city, routes: e.routes, others: others ?? [] }).sisters.find((y: any) => y.id === x.id);
    setSaid(`${x.name}: ${now?.status.text ?? "added"}.`);
  };
  return (
    <Screen title="About this door" scroll={false} testID="room" footer={<Toast toast={e.toast} onUndo={() => { e.toast?.undo?.(); e.clearToast(); }} onClose={() => e.clearToast()} />}>
      <Scroll ref={scroller} contentContainerStyle={s.pad}>
        <Text style={[s.sectH, { marginBottom: 4 }]}>Everything Qloo knows about this door</Text>
        <T k="h2" testID="room-name">{ri.name}</T>
        <T k="muted">{[...ri.meta, ri.rank ? `#${ri.rank} of ${ri.N} on your list` : null, aff || null].filter(Boolean).join(" · ")}</T>
        <View style={{ flexDirection: "row", marginTop: 8 }}>
          <View style={{ backgroundColor: st.kind === "on" ? C.greenSoft : C.seg, borderRadius: 99, paddingHorizontal: 11, paddingVertical: 4, flexShrink: 1 }}>
            <Text style={{ fontSize: 13, color: st.kind === "on" ? C.green : C.ink2, fontWeight: "500" }} testID="room-status">{st.text}</Text>
          </View>
        </View>
        {said ? <Text maxFontSizeMultiplier={2} style={[s.small, { color: C.green, marginTop: 8 }]}>{said}</Text> : null}

        <Sect title="How this door was chosen" onLayout={at("how")}>
          {ri.steps.map((x: any, i: number) => (
            <Row key={i} wrap={false} style={{ alignItems: "flex-start", marginTop: 6 }}>
              <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: C.green, alignItems: "center", justifyContent: "center" }}><Text style={{ color: "#fff", fontSize: 12, fontWeight: "700" }}>{i + 1}</Text></View>
              <View style={{ flex: 1 }}><Text style={[s.body, { fontWeight: "700", fontSize: 15 }]}>{x.label}</Text><Text maxFontSizeMultiplier={2} style={s.muted}>{x.text}</Text></View>
            </Row>
          ))}
        </Sect>

        <Sect title="Affinity" onLayout={at("match")}>
          {ri.drinkers.map((d: any, i: number) => {
            const a = d.all;
            const fam = d.famous?.rank ? `#${d.famous.rank} of ${d.famous.of} with the popularity cap off (famous doors in)` : d.famous ? `Not in the top ${d.famous.of} with the popularity cap off` : "";
            return (
              <Row key={i} wrap={false} style={{ alignItems: "flex-start", marginTop: 8, gap: 12 }}>
                {a?.rank ? <View style={{ backgroundColor: C.greenSoft, borderRadius: 10, padding: 8, minWidth: 80, alignItems: "center" }} accessible accessibilityLabel={`Qloo affinity ${a.affinity?.toFixed(3) ?? "unknown"}, out of 1`}><Text style={{ fontSize: 22, fontWeight: "800", color: C.green }}>{a.affinity?.toFixed(3) ?? "—"}</Text><Text maxFontSizeMultiplier={2} style={s.small}>Qloo affinity</Text></View> : null}
                <View style={{ flex: 1 }}>
                  <Text style={[s.body, { fontWeight: "600", fontSize: 15 }]}>For {d.who ?? `${d.name} drinkers`}{d.category ? <Text maxFontSizeMultiplier={2} style={s.small}> · {d.category}</Text> : null}</Text>
                  <BarRow label={a?.rank ? `#${a.rank} of ${a.of} in Qloo's order` : "Not in Qloo's main list"} x={rankBar(a)} val="" />
                  {fam ? <BarRow label={fam} x={rankBar(d.famous)} val="" soft /> : null}
                </View>
              </Row>
            );
          })}
          {ri.merged && ri.rank ? <Cap>On your plan it is #{ri.rank} of {ri.N} on Doors' merged list: the drinkers' lists taken in turn, so that order is Doors', built from Qloo's ranks.</Cap> : null}
          <Cap>Affinity is Qloo's {famousIncl ? "taste" : "brand-to-place"} score, 0 to 1, within this drinker's list; it isn't comparable across lists. A longer bar is a higher rank.</Cap>
        </Sect>

        {ri.drinkers.some((d: any) => d.ages.length) ? (
          <Sect title="Who skews here: age bands" onLayout={at("ages")}>
            {ri.drinkers.filter((d: any) => d.ages.length).map((d: any, i: number) => (
              <View key={i}>
                {ri.drinkers.length > 1 ? <Text style={[s.body, { fontWeight: "600", fontSize: 15, marginTop: 6 }]}>{d.name} drinkers</Text> : null}
                {d.ages.map((a: any) => <BarRow key={a.label} label={a.label} x={rankBar(a)} val={a.rank ? `#${a.rank} of ${a.of}` : `not in the ${a.of}`} best={!!a.rank && a === d.skew?.best} />)}
                {d.skew ? <Say>{d.skew.text}</Say> : null}
              </View>
            ))}
            <Cap>Qloo re-ranks the drinkers' doors when the signal is narrowed to one age band (one page of 50 per band, bars and restaurants kept). Under 25 is fetched for non-alcoholic brands only.</Cap>
          </Sect>
        ) : null}

        {others == null ? (
          <Sect title="How other brands' drinkers rank this door"><Cap>Loading the other ready brands' {plan.city?.name ?? ""} lists…</Cap></Sect>
        ) : ri.others.length ? (
          <Sect title="How other brands' drinkers rank this door" onLayout={at("others")} testID="room-others">
            <Say>In the ranked list for {ri.othersIn} of the {ri.others.length} other ready brands in {plan.city?.name ?? "this city"}.</Say>
            {ri.others.map((o: any) => <BarRow key={o.name} label={o.name} sub={o.category ?? ""} x={rankBar(o)} val={o.rank ? `#${o.rank} of ${o.of}` : `not in the ${o.of}`} out={!o.rank} />)}
            <Cap>Each brand's own Qloo list for {plan.city?.name ?? "the city"} (same request as yours, that brand as the signal). A door high on several lists has a broad crowd; one only on yours is specific to your drinkers.</Cap>
          </Sect>
        ) : null}

        {ri.popularity != null || ri.rating != null ? (
          <Sect title="Popularity and rating" onLayout={at("pop")}>
            {ri.popularity != null ? <BarRow label="Qloo popularity" x={ri.popularity} val={ri.popularity.toFixed(2)} tick={0.9} /> : null}
            {ri.rating != null ? <BarRow label="Rating" x={ri.rating / 5} val={`★ ${ri.rating.toFixed(1)} of 5`} color={C.amber} /> : null}
            <Cap>Popularity is Qloo's, 0 to 1. The tick is Doors' cap at 0.9: doors above it are the famous ones, left out unless you include them{ri.famousRoom ? " (this is one of them)" : ""}. The rating is the business rating on Qloo's record of the door.</Cap>
          </Sect>
        ) : null}

        <Sect title="The crowd and the door" onLayout={at("text")}>
          {!ri.lines.length && !chips.length ? <Cap>Qloo has no description of this door's crowd or feel.</Cap> : null}
          {ri.lines.map((l: any) => (
            <View key={l.label} style={{ borderLeftWidth: 3, borderColor: C.line, paddingLeft: 10, marginTop: 8 }}>
              <Text style={[s.body, { fontWeight: "700", fontSize: 15 }]}>{l.label}</Text>
              <Text style={[s.body, { fontSize: 15 }]}>{l.text}</Text>
              <Text maxFontSizeMultiplier={2} style={s.small}>Qloo's {SOURCE[l.source] ?? l.source}</Text>
            </View>
          ))}
          {chips.length ? <Row style={{ marginTop: 8, gap: 6 }}>{chips.map((c) => <Pill key={c} text={c} />)}</Row> : null}
          {ri.pitch.lines.length && ri.pitch.by === "model" ? <Cap>The stop's "Why this door" lines are model-drafted from these.</Cap> : null}
          {ri.facts.website || ri.facts.menu ? (
            <Row style={{ marginTop: 8, gap: 16 }}>
              {ri.facts.website ? <Pressable onPress={() => Linking.openURL(ri.facts.website)} accessibilityRole="link" style={{ minHeight: 44, justifyContent: "center" }} accessibilityLabel="Website"><Text style={{ color: C.green, fontWeight: "600" }}>Website ↗</Text></Pressable> : null}
              {ri.facts.menu ? <Pressable onPress={() => Linking.openURL(ri.facts.menu)} accessibilityRole="link" style={{ minHeight: 44, justifyContent: "center" }} accessibilityLabel="Menu"><Text style={{ color: C.green, fontWeight: "600" }}>Menu ↗</Text></Pressable> : null}
            </Row>
          ) : null}
        </Sect>

        <Sect title="The crowd's music" onLayout={at("music")}>
          {m.state === "none" ? <Cap>{m.detail}</Cap> : m.state === "held" ? (
            <>
              <Say>Doors holds this door's list back: {m.detail}.</Say>
              <Cap>Qloo's artist affinity with this door as the signal can fall back to the area's sound; Doors only shows a list that passes its checks.</Cap>
            </>
          ) : (
            <>
              {m.genres.length ? <Row style={{ gap: 6 }}>{m.genres.map((g: any) => <Pill key={g.name} text={`${g.name} ${g.n}/10`} strong />)}</Row> : null}
              {m.artists.map((a: any) => (
                <Text key={a.name} style={[s.body, { fontSize: 15, marginTop: 6 }]}><Text style={{ fontWeight: "700" }}>{a.name}</Text>{a.genres.length ? <Text maxFontSizeMultiplier={2} style={s.small}>  {a.genres.join(", ")}</Text> : null}</Text>
              ))}
              <Cap>Artists Qloo matches to this door's crowd (artist affinity, this door as the signal); passed Doors' checks: {m.detail}. Background for you, never quoted in a drafted message or talking point.</Cap>
            </>
          )}
        </Sect>

        <Sect title="Sister doors" onLayout={at("sisters")} testID="room-sisters">
          {!ri.sisters.length ? <Cap>No sister doors precomputed for this door (only the top doors in each city have them).</Cap> : (
            <>
              <Say>Qloo matches these doors' regulars to this door's crowd (place-to-place affinity, this door as the signal), not to {ri.drinker}. Your route is ranked on {ri.drinker}, so a sister is on it only when it also ranks for them and fits a day: {on} of {ri.sisters.length} are.</Say>
              <View style={{ flexDirection: "row", gap: 2, height: 12, borderRadius: 99, overflow: "hidden", marginTop: 12 }}>
                {ri.sisterTally.map((t: any) => <View key={t.kind} style={{ flex: t.n, backgroundColor: KIND[t.kind] }} />)}
              </View>
              <Row style={{ marginTop: 6, gap: 12 }}>
                {ri.sisterTally.map((t: any) => (
                  <Row key={t.kind} wrap={false} style={{ gap: 5 }}><View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: KIND[t.kind] }} /><Text maxFontSizeMultiplier={2} style={s.small}><Text style={{ fontWeight: "700", color: C.ink }}>{t.n}</Text> {t.label}</Text></Row>
                ))}
              </Row>
              {ri.sisters.map((x: any) => (
                <View key={x.id} style={{ borderTopWidth: 1, borderColor: C.line2, paddingVertical: 10, marginTop: 6, flexDirection: "row", gap: 10, alignItems: "center" }} testID={`sis-${x.id}`}>
                  <View style={{ flex: 1 }}>
                    <Pressable onPress={() => nav.push("room", { ...base(params), id: x.id })} accessibilityRole="button" style={{ minHeight: 44, justifyContent: "center" }}
                      accessibilityLabel={`${x.name}${x.genre ? `, ${x.genre}` : ""}${x.score != null ? `, affinity ${x.score.toFixed(3)}` : ""}`}><Text style={{ color: C.green, fontWeight: "600", fontSize: 16 }}>{x.name}{x.genre ? <Text maxFontSizeMultiplier={2} style={s.small}>  {x.genre}</Text> : null}</Text></Pressable>
                    <Text maxFontSizeMultiplier={2} style={[s.small, x.status.kind === "on" && { color: C.green, fontWeight: "500" }]}>{x.status.text}</Text>
                  </View>
                  <View style={{ alignItems: "flex-end", gap: 6 }}>
                    {x.score != null ? <Text maxFontSizeMultiplier={2} style={[s.small, { fontVariant: ["tabular-nums"] }]} accessibilityElementsHidden importantForAccessibility="no">{x.score.toFixed(3)}</Text> : null}
                    {x.status.kind === "on" ? <Btn small kind="line" label="Open stop" onPress={() => nav.push("stop", { ...base(params), id: x.id, day: x.status.dayIndex })} /> : x.addable ? <Btn small kind="line" label={adding === x.id ? "Adding…" : "+ Add"} disabled={!!adding} onPress={() => add(x)} testID={`sis-add-${x.id}`} /> : null}
                  </View>
                </View>
              ))}
              <Cap>The number is Qloo's place-to-place affinity with this door, 0 to 1. + Add puts a door on the plan; Doors picks the day it fits.</Cap>
            </>
          )}
        </Sect>
        <Text maxFontSizeMultiplier={2} style={[s.small, { marginTop: 18 }]}>Static data captured from Qloo's Insights API{data?.captured ? ` on ${data.captured}` : ""}; nothing here calls Qloo.{v.id && v.source !== "manual" ? ` Qloo id ${v.id}.` : ""}</Text>
      </Scroll>
    </Screen>
  );
}
// the plan's own params (demo or key), without this room's id / section / venue
export const base = (p: any) => (p.demo ? { demo: true } : { key: p.key });
