// One page of a door card (Jard 10-23 #9, doorcard concept A): the rows under the card (Stop.tsx) open these, each a
// screen of its own with Back and the edge swipe. params: {key | demo, id, day, page}; page = talk | notes | message |
// qloo | rules. The content moved here from the old long stop; the web's twin is public/ui/doorpage.js.
import { useEffect, useMemo, useRef, useState } from "react";
import { Linking, Pressable, Share, Text, TextInput, View, useWindowDimensions } from "react-native";
import { stopModel, shortDate } from "../../../public/lib/stopmodel.js";
import { noteLabel, mailtoHref, smsHref, noteText, TEXT_HINT } from "../../../public/lib/note.js";
import { talkLabel } from "../../../public/lib/talk-model.js";
import { isoDate, niceDate } from "../../../public/lib/profile.js";
import { makeRecord, supersededRules, ruleInName } from "../../../public/lib/slots.js";
import { lineSources, sourceRows, talkSummary, QLOO_HEAT } from "../../../public/lib/provenance.js";
import { notesOf, makeNote } from "../../../public/lib/door-notes.js";
import { sistersOf, sisterSummary, sisterOrder } from "../../../public/lib/roominsight.js";
import { usePlanEngine } from "./Plan";
import { appGet, appSet } from "../storage";
import { useAgentSpot, useNav } from "../nav";
import { Btn, C, Row, Screen, Section, SrcChip, T, Toast, s } from "../ui";

export const PAGE_TITLES: Record<string, string> = { talk: "Talking points", notes: "Notes", message: "Drafted message", qloo: "Qloo's listing", rules: "Your rules", sisters: "Sister doors" };

// the engine, the stop data and the stop model for one door (Stop.tsx uses it too)
export function useDoor(params: any, cur: { id: string; day: number | null }) {
  const e = usePlanEngine(params);
  const [data, setData] = useState<any>(null);
  useEffect(() => { e?.stopData().then(setData); }, [e]);
  const plan = e?.plan;
  const m = useMemo(() => {
    if (!plan || !data) return null;
    try { return stopModel({ plan, id: cur.id, dayIndex: cur.day, ...data }); } catch { return null; }
  }, [plan, data, cur.id, cur.day]);
  return { e, plan, data, m };
}

const TICKS = "ticks";
export default function DoorPage({ params }: { params: { key?: any; demo?: boolean; id: string; day: number | null; page: string } }) {
  const { e, plan, data, m } = useDoor(params, { id: params.id, day: params.day });
  useAgentSpot({ hide: true }); // intuit 1b #6 (mobile2 10-24): the door card's 'Ask about this door' is the way in; the 💬 covered text
  const [toast, setToast] = useState<{ text: string; undo?: () => void; at: number } | null>(null);
  const title = PAGE_TITLES[params.page] ?? "Door";
  if (!e || !plan) return <Screen title={title}><T k="muted">That plan isn't open.</T></Screen>;
  if (!m) return <Screen title={title}><T k="muted">Loading…</T></Screen>;
  const say = (text: string, undo?: () => void) => setToast({ text, undo, at: Date.now() });
  const body = { talk: TalkPage, notes: NotesPage, message: MessagePage, qloo: QlooPage, rules: RulesPage, sisters: SistersPage }[params.page] ?? QlooPage;
  const Body = body as any;
  return (
    <Screen title={title} testID={`doorpage-${params.page}`}>
      <T k="small" style={{ marginBottom: 4 }}>{m.venue.name}</T>
      <Body e={e} plan={plan} data={data} m={m} id={params.id} params={params} say={say} />
      <Toast toast={toast} onUndo={() => { const u = toast?.undo; setToast(null); u?.(); }} onClose={() => setToast(null)} />
    </Screen>
  );
}

// ---------- Talking points: Questions · Points · Pushback, ticks, where each line came from ----------
function TalkPage({ m }: any) {
  const [tab, setTab] = useState<"q" | "p" | "b">("q");
  const [ticks, setTicks] = useState<Record<string, boolean>>(() => appGet(TICKS) ?? {});
  const t = m.talk;
  // intuit audit #4, as the web: one line at the top, each line's source in the Sources fold at the end
  const src = lineSources(m);
  const rows = sourceRows(src);
  const [srcOpen, setSrcOpen] = useState(false);
  const refs: any[] = [];
  for (const f of t.factRefs ?? []) {
    const r = refs.find((x) => (f.url && x.url === f.url) || x.id === f.id);
    if (!r) refs.push({ ...f, ids: [f.id] });
    else r.ids.push(f.id);
  }
  const fn = (p: any) => { const i = refs.findIndex((f) => f.ids.includes(p.fact)); return i >= 0 ? ` [${i + 1}]` : ""; };
  const tick = (k: string) => {
    const key = `${m.id}:${k}`;
    const next = { ...ticks, [key]: !ticks[key] };
    if (!next[key]) delete next[key];
    setTicks(next);
    appSet(TICKS, next);
  };
  const tabs: [typeof tab, string][] = [["q", `Questions ${t.questions.length}`], ["p", `Points ${t.points.length}`], ["b", `Pushback ${t.pushback.length}`]]; // one line each (intuit 1b #7)
  return (
    <View>
      <T k="small" testID="talk-sources-line">{talkSummary(src, t)}</T>
      {t.visit === "return" ? <T k="small" style={{ marginBottom: 6, color: C.warn }}>Return visit: these lines use what you told Doors last time.</T> : null}
      {/* intuit 1b #7 (mobile2 10-24): the prep first, as the web (who to ask for, when, what to bring), then the lines */}
      <Section title="Before you walk in">
        {t.before.map((x: string, i: number) => <T key={i} k="body">• {x}</T>)}
      </Section>
      <View style={{ flexDirection: "row", backgroundColor: C.seg, borderRadius: 10, padding: 3, gap: 2, marginVertical: 8 }} accessibilityRole="tablist">
        {tabs.map(([k, label]) => (
          <Pressable key={k} onPress={() => setTab(k)} accessibilityRole="tab" accessibilityState={{ selected: tab === k }} testID={`talk-tab-${k}`}
            style={{ flex: 1, minHeight: 40, borderRadius: 8, alignItems: "center", justifyContent: "center", paddingHorizontal: 4, backgroundColor: tab === k ? C.paper : "transparent" }}>
            <Text style={{ fontWeight: "600", fontSize: 14, color: tab === k ? C.ink : C.ink2, textAlign: "center" }} maxFontSizeMultiplier={1.5} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{label}</Text>
          </Pressable>
        ))}
      </View>
      {tab === "q" ? (
        <View testID="talk-questions">
          <T k="small">Qloo doesn't know what they stock — ask.</T>
          {t.questions.map((q: string, i: number) => <Tick key={i} on={!!ticks[`${m.id}:q${i}`]} onPress={() => tick(`q${i}`)} text={q} />)}
        </View>
      ) : tab === "p" ? (
        <View testID="talk-points">
          {t.points.map((p: any, i: number) => <Tick key={i} on={!!ticks[`${m.id}:p${i}`]} onPress={() => tick(`p${i}`)} text={`${p.text}${fn(p)}`} />)}
          {refs.length ? <View style={{ marginTop: 8 }}>{refs.map((f, i) => <Pressable key={i} onPress={() => f.url && Linking.openURL(f.url)} style={{ minHeight: 44, justifyContent: "center" }} accessibilityRole="link" accessibilityLabel={`Source ${i + 1}: ${f.source}`}><Text maxFontSizeMultiplier={2} style={[s.small, { color: C.green }]}>[{i + 1}] {f.source} ↗</Text></Pressable>)}</View> : null}
        </View>
      ) : (
        <View testID="talk-pushback">
          {t.pushback.map((p: any, i: number) => (
            <View key={i} style={[s.card, { marginTop: 8 }]}>
              <T k="body" style={{ fontWeight: "700" }}>{p.from === "memory" ? p.objection : `“${p.objection}”`}</T>
              <T k="body" style={{ marginTop: 4 }}>{p.reply}</T>
            </View>
          ))}
        </View>
      )}
      {m.hidden ? <T k="small" style={{ marginTop: 14 }}>{m.hidden} line{m.hidden > 1 ? "s" : ""} hidden by your rules.</T> : null}
      <Pressable onPress={() => setSrcOpen(!srcOpen)} style={{ marginTop: 14, minHeight: 44, justifyContent: "center" }} accessibilityRole="button" accessibilityState={{ expanded: srcOpen }} testID="talk-sources">
        <Text maxFontSizeMultiplier={2} style={[s.small, { color: C.ink2, fontWeight: "600" }]}>{srcOpen ? "▾" : "▸"} Sources ({rows.length})</Text>
      </Pressable>
      {srcOpen ? (
        <View testID="talk-sources-list">
          {rows.map((r: any, i: number) => <View key={i} style={{ marginBottom: 6 }}><T k="body" style={{ fontSize: 15 }}><Text style={{ fontWeight: "700" }}>{r.where}</Text>: {r.label}</T>{r.title ? <T k="small">{r.title}</T> : null}</View>)}
          <T k="small" style={{ marginTop: 4 }}>Every other line is Doors' template, filled in with your profile.{refs.length ? " Numbered points link to their article." : ""} {talkLabel(t)}</T>
        </View>
      ) : null}
    </View>
  );
}
function Tick({ on, onPress, text, chip }: { on: boolean; onPress: () => void; text: string; chip?: any }) {
  // the box grows with the text (intuit 1b #7: a 22 pt box beside 30 pt text at AX sizes)
  const k = Math.min(useWindowDimensions().fontScale, 2.2), box = Math.round(22 * Math.max(1, k));
  return (
    <Pressable onPress={onPress} accessibilityRole="checkbox" accessibilityState={{ checked: on }} style={{ flexDirection: "row", gap: 10, paddingVertical: 8, borderBottomWidth: 1, borderColor: C.line2 }}>
      <View style={{ width: box, height: box, borderRadius: Math.round(box / 3.6), borderWidth: 2, borderColor: on ? C.done : C.ink3, backgroundColor: on ? C.done : "transparent", alignItems: "center", justifyContent: "center", marginTop: Math.round(box / 22) }}>{on ? <Text style={{ color: "#fff", fontWeight: "800", fontSize: Math.round(13 * box / 22) }} allowFontScaling={false}>✓</Text> : null}</View>
      <View style={{ flex: 1 }}><Text style={[s.body, on && { color: C.ink3, textDecorationLine: "line-through" }]}>{text}</Text><SrcChip c={chip} /></View>
    </Pressable>
  );
}

// ---------- Notes: the add box first (the keyboard never covers it), then the notes, newest first ----------
function NotesPage({ e, plan, m, id, params, say }: any) {
  const nav = useNav();
  const notes = notesOf(plan.slots, id);
  const [noteEdit, setNoteEdit] = useState<{ id: string; text: string } | null>(null);
  const addRef = useRef<any>(null);
  const draft = useRef(""); // the add box is uncontrolled (dictation drops words when value is re-set: AGENTS.md)
  const [has, setHas] = useState(false);
  const noteDay = (at: string) => (Number.isFinite(Date.parse(at ?? "")) ? niceDate(isoDate(new Date(at))) : "");
  const save = () => {
    const rec = makeNote({ text: draft.current, by: "rep" });
    if (rec) e.setSlot(id, rec);
    draft.current = "";
    setHas(false);
    addRef.current?.clear();
  };
  return (
    <View>
      {noteEdit ? null : (
        <View>
          <TextInput ref={addRef} returnKeyType="done" submitBehavior="blurAndSubmit" onSubmitEditing={() => has && save()} style={[s.input, { marginTop: 6, minHeight: 64, textAlignVertical: "top" }]} multiline maxLength={300} defaultValue="" onChangeText={(t) => { draft.current = t; setHas(!!t.trim()); }} placeholder="Add a note: the manager is Priya, back Thursdays" placeholderTextColor={C.ph} accessibilityLabel={`Add a note on ${m.venue.name}`} testID="note-new" />
          <Row style={{ marginTop: 6 }}>
            <Btn small kind="line" label="Save note" disabled={!has} onPress={save} testID="note-save" />
            {nav.has("ask") ? <Btn small kind="ghost" label={`Ask Doors Agent about ${m.venue.name}`} onPress={() => nav.push("ask", { ...params, current: id })} testID="note-ask" /> : null}
          </Row>
        </View>
      )}
      {notes.length ? notes.map((n: any) => noteEdit?.id === n.id ? (
        <View key={n.id} style={{ marginTop: 10 }}>
          <TextInput returnKeyType="done" submitBehavior="blurAndSubmit" style={[s.input, { minHeight: 64, textAlignVertical: "top" }]} multiline maxLength={300} value={noteEdit?.text ?? ""} onChangeText={(t) => setNoteEdit({ id: n.id, text: t })} autoFocus accessibilityLabel="Edit this note" testID="note-edit-text" />
          <Row style={{ marginTop: 6 }}>
            <Btn small label="Save" onPress={() => { e.setSlot(id, (noteEdit?.text ?? "").trim() ? { note: n.id, text: noteEdit?.text ?? "" } : { note: n.id, drop: true }); setNoteEdit(null); }} testID="note-edit-save" />
            <Btn small kind="line" label="Cancel" onPress={() => setNoteEdit(null)} />
          </Row>
        </View>
      ) : (
        <View key={n.id} style={{ borderLeftWidth: 3, borderColor: /^(Ask Doors|Doors Agent)/.test(n.who) ? C.green : C.amber, paddingLeft: 10, marginTop: 14 }} testID="note-item">
          <T k="body">{n.text}</T>
          <Row wrap style={{ gap: 4, alignItems: "center" }}>
            <T k="small" style={{ fontWeight: "700" }}>{n.who}</T>
            {noteDay(n.at) ? <T k="small">· {noteDay(n.at)} ·</T> : <T k="small">·</T>}
            <Pressable onPress={() => setNoteEdit({ id: n.id, text: n.text })} hitSlop={8} style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 4 }} accessibilityRole="button" accessibilityLabel="Edit this note" testID="note-edit"><Text style={{ color: C.green, fontWeight: "600" }} maxFontSizeMultiplier={1.6}>Edit</Text></Pressable>
            <Pressable onPress={() => { const rec = (plan.slots?.[id] ?? []).find((r: any) => r.field === "note" && (r.id ?? `${r.at}|${r.value}`) === n.id); e.setSlot(id, { note: n.id, drop: true }); say("Note deleted.", rec ? () => e.setSlot(id, rec) : undefined); }} hitSlop={8} style={{ minHeight: 44, justifyContent: "center", paddingHorizontal: 4 }} accessibilityRole="button" accessibilityLabel="Delete this note" testID="note-del"><Text style={{ color: C.green, fontWeight: "600" }} maxFontSizeMultiplier={1.6}>Delete</Text></Pressable>
          </Row>
        </View>
      )) : <T k="small" style={{ marginTop: 12 }}>No notes yet. Add who to ask for, when they're in, what they want, or tell Doors Agent and it notes what matters.</T>}
    </View>
  );
}

// ---------- Drafted message: Share / Email / Text, the subject and body (an edit is kept as your version) ----------
function MessagePage({ e, m, id }: any) {
  const note = m.note;
  const subj = useRef<string | null>(null);
  const body = useRef<string | null>(null);
  const [ver, setVer] = useState(0);
  const edited = () => {
    const sj = subj.current ?? note.subject;
    const bd = body.current ?? note.body;
    return sj === note.subject && bd === note.body ? note : { subject: sj, body: bd, sms: note.sms };
  };
  const saveBody = () => {
    const b = body.current;
    if (b != null && b.trim() && b !== note.body) e.setSlot(id, makeRecord({ slot: "S6", field: "note.email", value: b.slice(0, 2000), source: "corrected", by: "rep" }));
  };
  return (
    <View key={ver}>
      <Row style={{ justifyContent: "space-between", marginTop: 4 }} wrap={false}>
        <T k="small" style={{ flex: 1 }}>{note.by === "rep" ? "Your version" : "Edit before sending"}</T>
        {note.by === "rep" ? <Pressable onPress={() => { subj.current = null; body.current = null; e.setSlot(id, { clear: "note.email" }); setVer(ver + 1); }} accessibilityRole="button" style={{ minHeight: 44, justifyContent: "center" }}><Text style={{ color: C.green, fontWeight: "600" }}>Reset to draft</Text></Pressable> : null}
      </Row>
      <Row>
        <Btn small kind="line" label="Share" onPress={() => Share.share({ message: noteText(edited()) })} testID="note-share" />
        <Btn small kind="line" label="Email" onPress={() => Linking.openURL(mailtoHref(edited()))} />
        <Btn small kind="line" label="Text" onPress={() => Linking.openURL(smsHref(edited(), m.venue.phone))} />
      </Row>
      <TextInput style={[s.input, { marginTop: 10, fontWeight: "600" }]} multiline defaultValue={note.subject} onChangeText={(t) => (subj.current = t)} accessibilityLabel="Subject" />
      <TextInput style={[s.input, { marginTop: 8, minHeight: 200, textAlignVertical: "top" }]} multiline scrollEnabled={false} defaultValue={note.body} onChangeText={(t) => (body.current = t)} onBlur={saveBody} accessibilityLabel="Message" testID="note-body" />
      <T k="small" style={{ marginTop: 4 }}>{noteLabel(note)} Nothing is sent from Doors. {TEXT_HINT}</T>
    </View>
  );
}

// ---------- Sister doors (intuitiveness audit #3): the card's one row opens this; on your route first, each with its
// reason in plain words, Open or + Add. Qloo's scores stay in the deep-dive (Room). ----------
function SistersPage({ e, plan, data, id, params, say }: any) {
  const nav = useNav();
  const [adding, setAdding] = useState<string | null>(null);
  const sisters = sistersOf(plan, data?.city, id, data?.routes ?? []);
  const { n, on } = sisterSummary(sisters);
  const add = async (x: any) => {
    if (!x.venue || adding) return;
    setAdding(x.id);
    try { await e.addDoor(x.venue, { date: null }); } finally { setAdding(null); }
    const now = sistersOf(e.plan, data?.city, id, data?.routes ?? []).find((y: any) => y.id === x.id);
    say(`${x.name}: ${now?.status.text ?? "added"}.`);
  };
  const base = params.demo ? { demo: true } : { key: params.key };
  return (
    <View testID="sisters">
      <T k="small" style={{ marginBottom: 6 }}>Doors whose regulars are like this door's. {on} of {n} on your route.</T>
      {sisterOrder(sisters).map((x: any, i: number) => (
        <Row key={x.id} wrap={false} style={{ gap: 10, alignItems: "center", paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderColor: C.line2 }}>
          <View style={{ flex: 1 }}><T k="body" style={{ fontWeight: "700" }}>{x.name}</T><T k="small">{x.status.text}</T></View>
          {x.status.kind === "on" ? <Btn small kind="line" label="Open" onPress={() => nav.push("stop", { ...base, id: x.id, day: x.status.dayIndex })} />
            : x.addable ? <Btn small kind="line" label={adding === x.id ? "Adding…" : "+ Add"} disabled={!!adding} onPress={() => add(x)} testID={`sister-add-${x.id}`} /> : null}
        </Row>
      ))}
      {nav.has("room") ? <Pressable onPress={() => nav.push("room", { ...params, id, section: "sisters" })} accessibilityRole="button" style={{ minHeight: 44, justifyContent: "center", marginTop: 6 }}><Text style={{ color: C.green, fontWeight: "600", fontSize: 15 }} maxFontSizeMultiplier={1.8}>Qloo's match scores for these doors ›</Text></Pressable> : null}
    </View>
  );
}

// ---------- Qloo data: the profile lines, the tags, the record ----------
function QlooPage({ m }: any) {
  // intuit audit #1, as the web (ui/stop.js recordHTML): the rank, the week's hours, the website; no ids, affinity
  // decimals, field names or model ids (which model drafted the crowd and room lines is on the privacy page)
  const r = m.record;
  const v = m.venue;
  const hours = r.week ? r.week.join("\n") : /^\s*[{[]/.test(r.hoursRaw) ? "Qloo's hours for this door couldn't be read." : r.hoursRaw === "no hours listed" ? "Qloo lists no hours for this door." : r.hoursRaw;
  const rows: [string, string][] = [["Rank", r.rank], ["Hours", hours], ...(v.website ? [["Website", v.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")] as [string, string]] : [])];
  return (
    <View>
      <Section title="Qloo's profile of this door" testID="why">
        {m.why.length ? m.why.map((l: any, i: number) => <T key={i} k="body" style={{ marginTop: 6 }}><Text style={{ fontWeight: "700" }}>{l.label}.</Text> {l.text}</T>) : <T k="small">Qloo has no description of this door's crowd or feel. {m.rank ? "It's on the list for its taste match alone." : ""}</T>}
        {m.why.length ? <T k="small" style={{ marginTop: 6 }}>{m.pitch.by === "model" ? "Crowd and room lines written by a model from Qloo's profile of this door." : "Crowd and room lines from Qloo's profile of this door."}</T> : null}
        {m.hood ? <View style={{ marginTop: 8 }}><T k="small">{m.hood.text}</T><SrcChip c={QLOO_HEAT(m.hood.src)} /></View> : null}
      </Section>
      {m.roomTags?.length ? (
        <Section title="Qloo's tags">
          {m.roomTags.map((f: any, i: number) => <T key={i} k="body"><Text style={{ fontWeight: "700" }}>{f.label}: </Text>{f.text.slice(f.label.length + 2).replace(/\.$/, "")}</T>)}
          <T k="small" style={{ marginTop: 4 }}>{shortDate(m.roomTags[0].source.captured) ? `Saved ${shortDate(m.roomTags[0].source.captured)}. ` : ""}Doors uses them to pick the day, the opener and the ask.</T>
        </Section>
      ) : null}
      <Section title="Rank and hours" testID="record">
        {rows.map(([k, val]) => <View key={k} style={{ marginBottom: 6 }}><T k="small" style={{ fontWeight: "700" }}>{k}</T><T k="body" style={{ fontSize: 15 }}>{val}</T></View>)}
        <T k="small">Saved from Qloo{r.when ? ` on ${r.when}` : ""}. Opening a door makes no call to Qloo.</T>
      </Section>
    </View>
  );
}

// ---------- Your rules: never say / say … instead of …, every city ----------
function RulesPage({ e, plan, m, id }: any) {
  const [avoid, setAvoid] = useState("");
  const [to, setTo] = useState("");
  const [from, setFrom] = useState("");
  const rules = [...(plan.slots?.["*"] ?? [])].filter((r: any) => /^rule\./.test(r.field));
  const oldRules = supersededRules(plan.slots ?? {}, "*");
  const ruleTag = (r: any) => (oldRules.includes(r) ? " · replaced by a newer rule" : ruleInName(r.field === "rule.term" ? r.value?.from : r.value, [m.profile.brand ?? ""]) ? " · not in your brand name" : "");
  const ruleTxt = (r: any) => (r.field === "rule.avoid" ? `Never say “${r.value}”` : `Say “${r.value.to}”, not “${r.value.from}”`);
  return (
    <View testID="rules">
      <T k="small">Words Doors must never use, or must say your way, in every message and talking point for {m.profile.brand || "your brand"}, in every city.{m.hidden ? ` Hiding ${m.hidden} line${m.hidden > 1 ? "s" : ""} on this stop.` : ""}</T>
      {rules.map((r: any, i: number) => (
        <Row key={i} style={{ justifyContent: "space-between", marginTop: 6 }} wrap={false}><T k="body" style={{ flex: 1 }}>{ruleTxt(r)}{ruleTag(r) ? <Text maxFontSizeMultiplier={2} style={s.small}>{ruleTag(r)}</Text> : null}</T><Pressable onPress={() => e.setSlot(id, { clear: r.field, value: r.value })} accessibilityRole="button" accessibilityLabel={`Remove: ${ruleTxt(r)}`} style={{ minHeight: 44, justifyContent: "center" }}><Text style={{ color: C.green, fontWeight: "600" }}>Remove</Text></Pressable></Row>
      ))}
      <T k="label" style={{ marginTop: 14 }}>Never say</T>
      <Row wrap={false}><TextInput accessibilityLabel="Never say" style={[s.input, { flex: 1 }]} value={avoid} onChangeText={setAvoid} maxLength={60} placeholder="e.g. mocktail" placeholderTextColor={C.ph} /><Btn small kind="line" label="Add" onPress={() => { if (avoid.trim()) { e.setSlot(id, makeRecord({ slot: "S6", field: "rule.avoid", value: avoid.trim(), source: "corrected", by: "rep" })); setAvoid(""); } }} /></Row>
      <T k="label" style={{ marginTop: 14 }}>Say … instead of …</T>
      <Row wrap={false}>
        <TextInput accessibilityLabel="Say" style={[s.input, { flex: 1 }]} value={to} onChangeText={setTo} maxLength={40} placeholder="your word" placeholderTextColor={C.ph} />
        <T k="muted">instead of</T>
        <TextInput accessibilityLabel="instead of" style={[s.input, { flex: 1 }]} value={from} onChangeText={setFrom} maxLength={40} placeholder="their word" placeholderTextColor={C.ph} />
      </Row>
      <Btn small kind="line" label="Add" style={{ alignSelf: "flex-start", marginTop: 6 }} onPress={() => { if (to.trim() && from.trim()) { e.setSlot(id, makeRecord({ slot: "S6", field: "rule.term", value: { from: from.trim(), to: to.trim() }, source: "corrected", by: "rep" })); setTo(""); setFrom(""); } }} />
    </View>
  );
}
