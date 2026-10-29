// The Ask Doors conversation (ui/agent.js panel) as a view: the log (user / agent bubbles, Sources (n), what it did,
// a chip per change with its own Undo on the last answer), the greeting while empty with three starter asks (ease audit #12), "…" then "Still working" after 10 s, and the box. The box is
// UNCONTROLLED (iOS dictation into a controlled TextInput loses words; it sends no onChangeText while dictating), and
// 6 lines tall while in use so the caret stays in view. The mic beside Send (src/mic.ts, Jard 10-23: no keyboard mic
// needed) puts what was said into the box, after anything typed, to read and edit before Send.
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, FlatList, Keyboard, Linking, Pressable, Share, Text, TextInput, useWindowDimensions, View } from "react-native";
import { speak } from "../voice"; // Aura-2 from the Worker, the device voice when it can't (Jard 10-23: all phone speech)
import { MODEL_NOTICE, answeredBy, footFor, restNote, type Chat, type Msg } from "../agent";
import { greeting, starters, sourceTag, sourceItems, chipsOf } from "../../../public/lib/agent-ui.js";
import { openPrivacy } from "./AppMenu";
import { C, Row, T, s } from "../ui";
import { niceDate, clock12, toMinutes } from "../../../public/lib/profile.js";
import { altLabel } from "../../../public/lib/fu-check.js";
import { latePickLabel } from "../../../public/lib/drive-day.js";
import { MIC, useMic } from "../mic";
import MicButton, { micLabel } from "./MicButton";
import { Ic } from "../icons"; // the Doors icon set (Jard 10-24 #1)

// voiced: the screen speaks answers itself (drive mode with Voice on), so VoiceOver doesn't announce them a second time.
// context().mode: "drive" | "stop" | "plan" (spec §6: the answer's length). Away from drive mode a reply is spoken only
// on its 🔊 tap (src/voice.ts: Aura-2, the device's voice as its fallback).
const draftNoApp = (href: string) => (/^sms:/.test(href) ? "No messages app opened on this phone: copy the draft instead." : "No mail app on this phone: copy the draft instead.");

// ease audit 2 #2 (lib/agent-ui.js starters, as the web): the door the rep is at (a stop, drive mode), else the selected
// day's next stop
function startersFor(chat: Chat, context?: () => { current?: string | null; dayIndex?: number | null; mode?: string }) {
  const c = context?.() ?? {};
  const sel = c.dayIndex ?? (typeof chat.e.sel === "number" ? chat.e.sel : null);
  return starters(chat.e.plan, { here: c.mode && c.mode !== "plan" ? c.current ?? null : null, dayIndex: sel });
}
// onLate(by): "I'm running late" (ease audit 2 #3): Start my day's Running late, that many minutes
export default function ChatView({ chat, context, onOpen, onLate, onReply, prefill, voiced }: { voiced?: boolean; prefill?: string; chat: Chat; context?: () => { current?: string | null; dayIndex?: number | null; mode?: string }; onOpen?: (id: string) => void; onLate?: (by: number) => void; onReply?: (m: Msg) => void }) {
  const [, setN] = useState(0);
  const [open, setOpen] = useState(false);
  // ability 4 (mobile2 10-23): the draft's app didn't open (no mail app on the phone): say so, offer Share (it has Copy)
  const [noApp, setNoApp] = useState<number | null>(null);
  const openDraft = async (i: number, href: string) => {
    try {
      if (!(await Linking.canOpenURL(href))) throw new Error("no app");
      await Linking.openURL(href);
      setNoApp(null);
    } catch {
      setNoApp(i);
      AccessibilityInfo.announceForAccessibility?.(draftNoApp(href));
    }
  };
  const [slow, setSlow] = useState(false);
  const [srcOpen, setSrcOpen] = useState<number | null>(null);
  const text = useRef(prefill ?? "");
  const [box, setBox] = useState({ key: 0, text: prefill ?? "" }); // a new box with the spoken words in it (it's uncontrolled)
  const mic = useMic((said) => {
    text.current = [text.current.trim(), said].filter(Boolean).join(" ").slice(0, 600);
    setBox((b) => ({ key: b.key + 1, text: text.current }));
    setOpen(true);
  });
  const input = useRef<React.ComponentRef<typeof TextInput>>(null);
  const list = useRef<FlatList<Msg>>(null);
  const { fontScale, height } = useWindowDimensions();
  // mobile2 10-23, AX5: the box and the line under it took half the screen; the box's words grow to 2× at most (as the
  // small print), so the chat keeps most of the screen
  const BOX_SCALE = Math.min(fontScale, 2);
  const LINE = 24 * BOX_SCALE;
  useEffect(() => chat.e.subscribe(() => setN((n) => n + 1)), [chat]);
  const send = async (t?: string) => {
    const words = (t ?? text.current).trim();
    if (!words || chat.busy) return;
    if (t == null) { text.current = ""; input.current?.clear(); setOpen(false); }
    Keyboard.dismiss(); // judge, phone #3: the answer came in behind the keyboard; sent = done typing
    const timer = setTimeout(() => setSlow(true), chat.offline ? 1e9 : 10000);
    const m = await chat.send(words, context?.() ?? {});
    clearTimeout(timer);
    setSlow(false);
    if (m) {
      if (!voiced && m.text) AccessibilityInfo.announceForAccessibility(m.text);
      onReply?.(m);
      if (m.open) onOpen?.(m.open);
      if (m.lateBy) onLate?.(m.lateBy);
    }
  };
  const sendBox = () => {
    if (text.current.trim()) return send();
    input.current?.blur(); // dictation: onEndEditing fills the ref
    setTimeout(() => send(), 150);
  };
  const msgs = chat.messages;
  const lastAgent = msgs.map((m) => m.role).lastIndexOf("agent");
  return (
    <View style={{ flex: 1 }}>
      <FlatList ref={list} data={msgs} keyExtractor={(_, i) => String(i)} testID="chat-log" keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" contentContainerStyle={{ padding: 12 }}
        // the question in flight: the end; an answer: its own top, so a long one reads from its first line
        onContentSizeChange={() => (msgs.at(-1)?.role === "agent" && msgs.length > 1 ? list.current?.scrollToIndex({ index: msgs.length - 1, viewPosition: 0, animated: true }) : list.current?.scrollToEnd({ animated: true }))}
        onScrollToIndexFailed={() => list.current?.scrollToEnd({ animated: true })}
        // ease audit #12: the greeting, then three asks to start from (spec §6 had none); the first two send, "Log a visit
        // at …" goes into the box to finish (lib/agent-ui.js starters, as the web)
        ListEmptyComponent={<View>
          <Text style={[s.body, { color: C.ink2, fontWeight: "500" }]} testID="chat-hello">{greeting(chat.e.plan?.profile)}</Text>
          <View style={{ alignItems: "flex-start", gap: 8, marginTop: 10 }}>
            {startersFor(chat, context).map((x: any, i: number) => (
              <Pressable key={i} onPress={() => (x.send ? send(x.text) : (text.current = x.text, setBox((b) => ({ key: b.key + 1, text: x.text })), setOpen(true), setTimeout(() => input.current?.focus(), 50)))} accessibilityRole="button" testID={`chat-start-${i}`}
                style={({ pressed }) => ({ minHeight: 40, justifyContent: "center", paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, borderWidth: 1, borderColor: C.line, backgroundColor: pressed ? C.line2 : C.paper })}>
                <Text style={{ color: C.green, fontWeight: "600", fontSize: 15 }} maxFontSizeMultiplier={2}>{x.text.trim()}</Text>
              </Pressable>
            ))}
          </View>
        </View>}
        ListFooterComponent={!chat.busy ? undefined : <View style={{ alignSelf: "flex-start", backgroundColor: C.paper, borderRadius: 14, padding: 12, marginVertical: 6, borderWidth: 1, borderColor: C.line }}><Text maxFontSizeMultiplier={2} style={s.muted}>{slow ? "Still working: the model is slow right now…" : "…"}</Text></View>}
        renderItem={({ item, index }) =>
          item.role === "user" ? (
            <Text style={{ alignSelf: "flex-end", backgroundColor: C.green, color: "#fff", fontSize: 16, padding: 10, borderRadius: 14, marginVertical: 6, maxWidth: "85%", overflow: "hidden" }}>{item.text}</Text>
          ) : (
            <View style={{ alignSelf: "flex-start", backgroundColor: C.paper, borderRadius: 14, padding: 12, marginVertical: 6, maxWidth: "95%", borderWidth: 1, borderColor: C.line }}>
              {item.badge ? <Text maxFontSizeMultiplier={2} style={[s.small, { fontWeight: "700", marginBottom: 2, paddingRight: 34 }]}>{item.badge}</Text> : null}
              {/* mobile2 10-23: a flex:1 Text in a row inside this shrink-to-fit bubble was measured at one width and drawn
                  at another, so its last line was cut (no ellipsis). The answer is a plain block now, the 🔊 sits over its corner. */}
              <Text style={[s.body, item.text ? { paddingRight: 34 } : null]}>{item.text}</Text>
              {item.text ? <Pressable onPress={() => speak(item.text, { offline: !!chat.offline })} hitSlop={6} style={{ position: "absolute", top: 4, right: 4, minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center", opacity: 0.6 }} accessibilityRole="button" accessibilityLabel="Read this answer aloud" testID={`chat-say-${index}`}><Ic name="voice" size={18} color={C.green} /></Pressable> : null}
              {item.draft ? (
                <View testID="agent-draft" style={{ marginTop: 8, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: C.line }}>
                  {item.draft.subject ? <Text style={[s.small, { fontWeight: "700", marginBottom: 4 }]}>{item.draft.subject}</Text> : null}
                  <Text style={s.small} selectable>{item.draft.body}</Text>
                  <Pressable onPress={() => openDraft(index, item.draft!.href)} style={{ marginTop: 6, minHeight: 44, justifyContent: "center" }} testID="draft-open" accessibilityRole="link" accessibilityLabel={item.draft.channel === "text" ? "Open the draft in Messages" : "Open the draft in Mail"}>
                    <Text style={{ color: C.green, fontWeight: "700" }}>{item.draft.channel === "text" ? "Open in Messages" : "Open in Mail"}</Text>
                  </Pressable>
                  {noApp === index ? (
                    <View testID="draft-noapp">
                      <Text style={[s.small, { marginTop: 4 }]}>{draftNoApp(item.draft.href)}</Text>
                      <Pressable onPress={() => Share.share({ message: item.draft!.subject ? `${item.draft!.subject}\n\n${item.draft!.body}` : item.draft!.body }).catch(() => {})} style={{ minHeight: 44, justifyContent: "center" }} testID="draft-share" accessibilityRole="button">
                        <Text style={{ color: C.green, fontWeight: "700" }}>Share or copy the draft</Text>
                      </Pressable>
                    </View>
                  ) : null}
                </View>
              ) : null}
              {(item.facts ?? []).length ? (
                <Pressable onPress={() => setSrcOpen(srcOpen === index ? null : index)} style={{ marginTop: 6 }} accessibilityRole="button" accessibilityLabel={`Sources (${sourceItems(item).length})`} accessibilityState={{ expanded: srcOpen === index }}>
                  <Text maxFontSizeMultiplier={2} style={[s.small, { color: C.ink3 }]}>{srcOpen === index ? "▾" : "▸"} Sources ({sourceItems(item).length})</Text>
                </Pressable>
              ) : null}
              {/* spec §6: every door fact keeps its source, as a small quiet tag (Qloo / route / you / link); a link opens */}
              {srcOpen === index ? sourceItems(item).map((f: any, i: number) => { const t = f.src; return <Text key={i} maxFontSizeMultiplier={2} style={[s.small, { marginTop: 3, color: C.ink3 }]}>{f.text}  {t.url ? <Text style={{ color: C.green, fontSize: 12, textDecorationLine: "underline" }} onPress={() => Linking.openURL(t.url!)} accessibilityRole="link" accessibilityLabel={`Source: ${t.title || "link"}`}>link ↗</Text> : f.named ? null : <Text style={{ fontSize: 12, fontWeight: "600" }} accessibilityLabel={`Source: ${t.title || t.tag}`}>[{t.tag}]</Text>}</Text>; }) : null}
              {/* spec §5: a chip per change ("Meanwhile moved to Friday · Undo") */}
              {chipsOf(item).length ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 }}>{chipsOf(item).map((c: any, k: number) => { const undoable = !c.undone && chat.canUndo(index, c.g); return (
                <View key={k} style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", borderWidth: 1, borderColor: C.line, borderRadius: 22, paddingHorizontal: 10, paddingVertical: undoable ? 0 : 4 }} testID={`chat-chip-${k}`}>
                  <Text style={{ fontSize: 14, color: c.undone ? C.ink3 : C.done, fontWeight: "600", textDecorationLine: c.undone ? "line-through" : "none" }}>{c.text}{c.undone ? " · Undone" : ""}</Text>
                  {undoable ? <Pressable onPress={() => chat.doUndo(c.g)} hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }} style={{ minHeight: 44, minWidth: 44, justifyContent: "center" }} testID={`chat-undo-${k}`} accessibilityRole="button" accessibilityLabel={`Undo: ${c.text}`}><Text style={{ fontSize: 14, color: C.green, fontWeight: "700" }}> · Undo</Text></Pressable> : null}
                </View>
              ); })}</View> : null}
              {/* ease audit 2 #3: "I'm running late" with no time: Start my day's own picks, on the last answer only */}
              {item.late?.picks?.length && onLate && index === msgs.length - 1 ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 }}>{item.late.picks.map((x: number) => (
                <Pressable key={x} onPress={() => onLate(x)} accessibilityRole="button" testID={`chat-late-${x}`}
                  style={({ pressed }) => ({ minHeight: 44, justifyContent: "center", paddingHorizontal: 14, borderRadius: 22, borderWidth: 1, borderColor: C.line, backgroundColor: pressed ? C.line2 : C.paper })}>
                  <Text style={{ color: C.green, fontWeight: "600", fontSize: 15 }} maxFontSizeMultiplier={2}>{latePickLabel(x)}</Text>
                </Pressable>
              ))}</View> : null}
              {item.offers?.length ? item.offers.map((o: any, k: number) => chat.offerLive(o) ? <Pressable key={k} onPress={() => chat.takeOffer(index, k)} style={{ marginTop: 6 }} testID={`fu-alt-${k}`} accessibilityRole="button"><Text style={{ color: C.green, fontWeight: "700" }}>Move {o.name} to {altLabel(o.alt)}</Text></Pressable> : null) : null}
              {chat.noteOfferLive(item) ? <Pressable onPress={() => chat.takeNote(index)} style={{ marginTop: 6, minHeight: 44, justifyContent: "center" }} testID="note-offer" accessibilityRole="button"><Text style={{ color: C.green, fontWeight: "700" }}>Save as a note for {item.offerNote!.name}</Text></Pressable> : null}
              {restNote(item, msgs.slice(0, index).reverse().find((x) => x.role === "agent")) ? <Text maxFontSizeMultiplier={2} style={[s.small, { marginTop: 4 }]}>{restNote(item, msgs.slice(0, index).reverse().find((x) => x.role === "agent"))}</Text> : null}
              {answeredBy(item) && !(chat.offline && item.resting) /* the demo's footer already says it: one line, not two (judge #6) */ ? <Text maxFontSizeMultiplier={2} style={[s.small, { marginTop: 4 }]}>{answeredBy(item)}</Text> : null}
            </View>
          )
        }
      />
      {mic.phase !== "idle" || mic.note ? <Text maxFontSizeMultiplier={2} accessibilityLiveRegion="polite" testID="chat-mic-note" style={[s.small, { paddingHorizontal: 12, paddingTop: 6, color: mic.note ? C.warn : C.ink2 }]}>{mic.note ?? micLabel(mic, "")}</Text> : null}
      <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-end", padding: 10, borderTopWidth: mic.phase !== "idle" || mic.note ? 0 : 1, borderColor: C.line }}>
        <TextInput key={box.key} ref={input} testID="chat-text" style={[s.input, { flex: 1, height: open ? Math.round(Math.min(6 * LINE + 26, height * 0.3)) : Math.round(LINE + 26), textAlignVertical: "top" }]}
          onFocus={() => { setOpen(true); mic.clearNote(); }} onBlur={() => setOpen(!!text.current.trim())} onEndEditing={(e) => (text.current = e.nativeEvent.text)} defaultValue={box.text}
          onChangeText={(t) => (text.current = t)} placeholder="Ask, log a visit, or add a note" placeholderTextColor={C.ph} maxFontSizeMultiplier={2} maxLength={600} multiline scrollEnabled returnKeyType="send" submitBehavior="submit"
          onSubmitEditing={(e) => { text.current = e.nativeEvent.text; send(); }} />
        {MIC && !chat.offline ? <MicButton mic={mic} testID="chat-mic" /> : null}
        <Pressable onPress={sendBox} disabled={mic.phase !== "idle"} accessibilityRole="button" style={{ paddingVertical: 12, paddingHorizontal: 16, borderRadius: 999, backgroundColor: C.green }} testID="chat-send"><Text style={{ color: "#fff", fontWeight: "700", fontSize: 16 }} maxFontSizeMultiplier={2}>{chat.busy ? "…" : "Send"}</Text></Pressable>
      </View>
      {chat.offline ? <Text maxFontSizeMultiplier={1.5} style={[s.small, { paddingHorizontal: 12, paddingBottom: 6 }]}>The guided demo answers from Doors' rules on this phone: no model is called.</Text> : footFor(lastAgent >= 0 ? msgs[lastAgent] : null).notice ? <Text maxFontSizeMultiplier={1.5} style={[s.small, { paddingHorizontal: 12, paddingBottom: 6 }]}>{MODEL_NOTICE} <Text style={{ color: C.green, textDecorationLine: "underline" }} onPress={() => openPrivacy()} accessibilityRole="link" testID="chat-privacy">Privacy</Text></Text> : null}
    </View>
  );
}
