// The guided demo's card (ui/coach.js + the demo banner) on the phone: docked under the screen (or at the top, over a sheet),
// "Guided demo · Maya Ortiz · Tidewell · Austin · Step i of N", the card's words, and Continue / Do it for me / the
// hand-off buttons; Skip to the finished plan (every step), Restart and Close tour; fold it to a bar for more of the screen.
// Owner 10-23 (his iPhone 17): the card floated over the screen's bottom and hid what it pointed at (the Ask box, the
// form's Build my plan). At the bottom it now takes its own room in the layout: the screen above it is shorter, and its
// footer (Ask's input, Build my plan) sits just above the card. Only a top card (over a sheet) still floats.
import { useEffect, useState } from "react";
import { AccessibilityInfo, Pressable, ScrollView, Text, useWindowDimensions, View } from "react-native";
import { useNav } from "../nav";
import { tour, COUNTED } from "../tour";
import { Btn, C, Row, s } from "../ui";
import { Ic } from "../icons"; // the Doors icon set (Jard 10-24 #1)

export default function TourCard() {
  const [, setN] = useState(0);
  useEffect(() => tour.subscribe(() => setN((n) => n + 1)), []);
  const { height } = useWindowDimensions();
  const topKey = useNav().stack.at(-1)?.key;
  // the hand-off card: remember the screen it first shows on (a skip resets the stack in the same tick), close it on leaving
  useEffect(() => {
    if (!tour.on || tour.card?.key !== "handoff" || topKey == null) return;
    if (tour.handoffAt == null) tour.handoffAt = topKey;
    else if (topKey !== tour.handoffAt) tour.close();
  });
  // VoiceOver: each new card is read out (the card sits after the screen in reading order)
  useEffect(() => {
    const k = tour.card;
    if (tour.on && k) AccessibilityInfo.announceForAccessibility(`${k.n ? `Demo step ${k.n} of ${COUNTED}: ` : "Demo: "}${k.title}`);
  }, [tour.on && tour.card?.key]);
  const c = tour.card;
  if (!tour.on || !c) return null;
  const top = c.dock === "top";
  const head = (
    <Row wrap={false} style={{ justifyContent: "space-between", gap: 6 }}>
      <View style={{ marginTop: 2 }}><Ic name="play" size={12} color="#fff" /></View>
      <Text maxFontSizeMultiplier={2} style={[s.small, { flex: 1, color: "#fff" }]} numberOfLines={2}
        accessibilityLabel={`Guided demo: Maya Ortiz, Tidewell, Austin${c.n ? `. Step ${c.n} of ${COUNTED}` : ""}`}>Guided demo · Maya Ortiz · Tidewell · Austin{c.n ? `\nStep ${c.n} of ${COUNTED}` : ""}</Text>
      <Pressable onPress={() => tour.toggle()} hitSlop={8} accessibilityRole="button" accessibilityLabel={tour.min ? "Show the card" : "Hide the card"} testID="tour-fold" style={{ minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" }}><Text style={{ color: "#fff", fontWeight: "700" }}>{tour.min ? "Show ▴" : "Hide ▾"}</Text></Pressable>
    </Row>
  );
  // the card sizes to its words, up to 55% of the screen (mobile2 10-23: capped at 36%, every card stopped mid-sentence)
  return (
    <View pointerEvents="box-none" style={top ? { position: "absolute", left: 0, right: 0, top: 4, padding: 10 } : { paddingHorizontal: 10, paddingTop: 6, paddingBottom: 4 }} testID="tour-card">
      <View style={{ backgroundColor: C.ink, borderRadius: 16, padding: 14, maxHeight: tour.min ? undefined : Math.round(height * 0.55), shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 10 }}>
        {head}
        {tour.min ? null : (
          <>
            <ScrollView style={{ marginTop: 6, flexShrink: 1 }} contentContainerStyle={{ paddingBottom: 4 }}>
              <Text style={{ fontSize: 19, fontWeight: "800", color: "#fff", marginBottom: 6 }} accessibilityRole="header">{c.title}</Text>
              {c.body.map((b, i) => <Text key={i} style={{ fontSize: 15, lineHeight: 21, color: "#E7E5E0", marginBottom: 6 }}>{b}</Text>)}
              {c.extra?.kind === "back" ? (
                <View style={{ marginTop: 4 }}>
                  <Text maxFontSizeMultiplier={2} style={[s.small, { color: "#B9B5AC" }]}>Before the visit → {c.extra.day}, back</Text>
                  {c.extra.rows.map((r: any) => (
                    <View key={r.key} style={{ marginTop: 6, padding: 8, borderRadius: 10, backgroundColor: r.changed ? "#2F5D4E" : "#2a2d30" }}>
                      <Text style={{ color: "#fff", fontWeight: "700", fontSize: 13 }}>{r.label}</Text>
                      <Text style={{ color: "#B9B5AC", fontSize: 13, textDecorationLine: r.changed && r.before ? "line-through" : "none" }}>{r.before ?? "nothing yet"}</Text>
                      <Text style={{ color: "#fff", fontSize: 14 }}>{r.after}{r.from ? <Text style={{ color: "#FCEBDD", fontSize: 12 }}>{"\n"}from {r.from}</Text> : null}</Text>
                    </View>
                  ))}
                  {c.extra.same ? <Text maxFontSizeMultiplier={2} style={[s.small, { color: "#B9B5AC", marginTop: 6 }]}>Hours: {c.extra.same} · same: Qloo's data</Text> : null}
                  <Text maxFontSizeMultiplier={2} style={[s.small, { color: "#B9B5AC", marginTop: 6 }]}>Her note: {c.extra.words.before} words before, {c.extra.words.after} after. Hours and Qloo's facts don't change: only what she told Doors does.</Text>
                </View>
              ) : c.extra?.kind === "swap" ? (
                <View style={{ marginTop: 4, gap: 8 }}>
                  {c.extra.sides.map((x: any) => (
                    <View key={x.city} style={{ padding: 10, borderRadius: 10, backgroundColor: "#2a2d30" }}>
                      <Text style={{ color: "#fff", fontWeight: "800" }}>{x.city}: {x.name}</Text>
                      {/* judge pass 9 #3: rank against popularity alone and the doors like it; no opener (two read as one template), and no crowd quote on a phone (the web's ≤700 px hides it too) so both cities fit */}
                      <Text style={{ color: "#fff", fontSize: 14 }}><Text style={{ fontWeight: "800", fontSize: 16 }}>#{x.rank} of {x.of}</Text> on Qloo's list for {x.drinker} drinkers</Text>
                      {x.popRank ? <Text style={{ color: "#E7E5E0", fontSize: 13 }}><Text style={{ fontWeight: "800" }}>#{x.popRank}</Text> by popularity alone</Text> : null}
                      {x.alike ? <Text style={{ color: "#E7E5E0", fontSize: 13 }}>{x.alike} sister doors</Text> : null}
                    </View>
                  ))}
                </View>
              ) : null}
            </ScrollView>
            <Row style={{ marginTop: 8 }}>
              {c.act === "continue" ? <Btn small label="Continue" onPress={() => tour.press("continue")} testID="tour-continue" style={{ backgroundColor: C.done }} /> : null}
              {c.act === "click" ? <><Text style={{ color: "#FCEBDD", fontWeight: "700", flexShrink: 1 }}>{c.cta}</Text><Btn small label="Do it for me" onPress={() => tour.press("auto")} testID="tour-auto" style={{ backgroundColor: C.done }} /></> : null}
              {c.act === "wait" ? <Text style={{ color: "#B9B5AC" }}>Working…</Text> : null}
              {(c.buttons ?? []).map((b) => <Btn key={b.label} small label={b.label} kind={b.kind === "primary" ? "primary" : "line"} fg="#fff" onPress={b.on} style={b.kind === "primary" ? { backgroundColor: C.done } : { borderColor: "#B9B5AC" }} />)}
            </Row>
            {c.key !== "handoff" && c.key !== "off" ? (
              <Row style={{ marginTop: 8, justifyContent: "space-between" }} wrap={false}>
                <Pressable onPress={() => tour.start()} hitSlop={6} style={{ minHeight: 44, justifyContent: "center" }} accessibilityRole="button" accessibilityLabel="Restart demo"><Text style={{ color: "#B9B5AC", fontWeight: "600" }} maxFontSizeMultiplier={1.3}>↻ Restart</Text></Pressable>
                {/* Skip on every step, as the web's demo banner (the intro card has it as its own button); in this row, not a line of its own */}
                {c.key !== "intro" ? <Pressable onPress={() => tour.start({ skip: true })} hitSlop={6} style={{ minHeight: 44, justifyContent: "center", flexShrink: 1 }} testID="tour-skip" accessibilityRole="button"><Text style={{ color: "#B9B5AC", fontWeight: "600", textAlign: "center" }} maxFontSizeMultiplier={1.3}>Skip to the finished plan</Text></Pressable> : null}
                <Pressable onPress={() => tour.close()} hitSlop={6} style={{ minHeight: 44, justifyContent: "center" }} testID="tour-close" accessibilityRole="button"><Text style={{ color: "#B9B5AC", fontWeight: "600" }}>Close tour</Text></Pressable>
              </Row>
            ) : null}
          </>
        )}
      </View>
    </View>
  );
}
