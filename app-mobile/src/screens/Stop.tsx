// A stop on the phone: the door card (Jard 10-23 #9, doorcard concept A), from the web's own stop model
// (lib/stopmodel.js) and its door card lines (lib/doorcard.js). The rows open DoorPage.tsx; the outcome sheet is here.
// Writes go through the engine (the web's plan.js actions).
import { useContext, useEffect, useMemo, useRef, useState } from "react";
import { Image, Linking, Pressable, ScrollView, Switch, Text, TextInput, View } from "react-native";
import { sequenceOf } from "../../../public/lib/stopmodel.js";
import { dayLabel } from "../../../public/lib/planview.js";
import { telHref, webSearchHref } from "../../../public/lib/note.js";
import { defaultFollowUp, outcomeTags, followUpToast, RESULTS, makeOutcome, shortDate, localStamp, quickChoices, visitStamp } from "../../../public/lib/outcome.js";
import { fitFollowUp, moveFollowUp, followUpDay, altLabel, otherFollowUps, clashStem } from "../../../public/lib/fu-check.js";
import { parseTime } from "../../../public/lib/visit-parse.js";
import { clockShort } from "../../../public/lib/schedule.js";
import { clock12, isoDate, niceDate } from "../../../public/lib/profile.js";
import { sistersOf, sisterSummary } from "../../../public/lib/roominsight.js";
import { atDoor, aboutLines, statusLine, visitLine, dayTally, tallyWords, afterVisit, nextStop, talkCounts } from "../../../public/lib/doorcard.js";
import { notesOf, visitNote } from "../../../public/lib/door-notes.js";
import { cap } from "../engine";
import { openDirections } from "../navapp";
import { RouteKey, useAgentSpot, useNav } from "../nav";
import { tour, makeTourOutcome } from "../tour";
import { Btn, C, Chip, HScroll, Row, Screen, T, Toast, colour, menu, s, useBigText } from "../ui";
import { FAB_SIDE, FAB_SIZE } from "../components/AskFab";
import { useDoor } from "./DoorPage";
import { Ic, type IconName } from "../icons"; // the Doors icon set (Jard 10-24 #1)

// The outcome sheet (ui/outcome.js): one tap saves; "Add details" opens result, who, come back + date, note.
const pad = (n: number) => String(n).padStart(2, "0");
const hhmm = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
// The outcome sheet (ui/outcome.js): one tap saves; "Add details" opens result, who, come back + date + an optional time,
// note. A follow-up is checked against the door's hours (lib/fu-check.js) before it's saved: a time before opening
// becomes the opening (said in the toast), a closed day asks first and offers the next open day. The one-tap choices are
// the glossary's four outcomes, all styled the same, the Follow up button carrying its date (ease audit #8, audit 2 #4).
// day + eta: the stop's day and planned arrival: a visit logged on a previewed day is stamped there (lib visitStamp).
export function OutcomeSheet({ name, current, defaultDate, windows, onSave, onCancel, now, prefill, venue = null, planWindows = [], visitMin = 25, others = [], day = null, eta = null }: { name: string; current: any; defaultDate: string; windows: string[]; onSave: (o: any, x?: { said?: string }) => void; onCancel: () => void; now?: () => Date; prefill?: any; venue?: any; planWindows?: any[]; visitMin?: number; others?: any[]; day?: string | null; eta?: number | null }) {
  const init = prefill ?? current;
  const [more, setMore] = useState(!!prefill?.more);
  const [result, setResult] = useState<string | null>(init?.result ?? null);
  const [follow, setFollow] = useState(Boolean(init?.followUp));
  const [date, setDate] = useState<string>(init?.followUp ?? defaultDate);
  const [who, setWho] = useState(init?.who ?? "");
  const [note, setNote] = useState(init?.note ?? "");
  const [time, setTime] = useState<string>(init?.followUpTime ?? "");
  const [warned, setWarned] = useState<string | null>(null);
  const [alt, setAlt] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  // the tour's clock when it gives a real date (left mid-tour it can be an Invalid Date: "Visited" with no time,
  // mobile2 10-23 on the demo plan), else the stop's own day and slot
  const at = () => { const t: any = now?.(); return t instanceof Date && Number.isFinite(t.getTime()) ? localStamp(t) : visitStamp(day, eta); };
  const tm = time ? +time.slice(0, 2) * 60 + +time.slice(3) : null;
  const stepTime = (d: number) => setTime(hhmm(Math.max(0, Math.min(23 * 60 + 55, (tm ?? 15 * 60) + d))));
  const must = result === "followup";
  const dates = useMemo(() => {
    const out = new Set<string>(windows.filter((d) => d >= isoDate(new Date())));
    for (let k = 1; k <= 21; k++) { const d = new Date(); d.setDate(d.getDate() + k); out.add(isoDate(d)); }
    return [...out].sort();
  }, []);
  return (
    <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: "rgba(23,25,27,0.4)", justifyContent: "flex-end" }} testID="outcome-sheet"
      accessibilityViewIsModal onAccessibilityEscape={onCancel}>
      <View style={{ backgroundColor: C.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: "92%" }}>
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 30 }} keyboardShouldPersistTaps="handled">
          <T k="h2">How did it go at {name}?</T>
          {!more ? quickChoices(defaultDate).map((q: any) => <Btn key={q.key} kind="line" label={q.text ?? q.label} onPress={() => onSave(makeOutcome({ ...q.o, at: at() }))} testID={`oq-${q.key}`} />) : null}
          <Pressable onPress={() => setMore(!more)} style={{ paddingVertical: 12 }} accessibilityRole="button" accessibilityLabel="Add details: another date, who, a note" accessibilityState={{ expanded: more }}><Text style={{ color: C.green, fontWeight: "600", fontSize: 16 }}>{more ? "▾ " : ""}Add details: another date, who, a note</Text></Pressable>
          {more ? (
            <View>
              <Row>{RESULTS.map((r: any) => <Chip key={r.key} label={r.label} on={result === r.key} onPress={() => setResult(r.key)} />)}</Row>
              <T k="label" style={{ marginTop: 14 }}>Who did you talk to?{result === "someone" ? "" : <Text maxFontSizeMultiplier={2} style={s.small}> (optional: next time Doors says to ask for them)</Text>}</T>
              <TextInput accessibilityLabel="Who did you talk to" style={s.input} value={who} onChangeText={setWho} placeholder="e.g. Jo, the bar manager" placeholderTextColor={C.ph} />
              <Row style={{ marginTop: 14 }}>
                {must ? <T k="label">Follow up on</T> : <><Switch value={follow} onValueChange={setFollow} accessibilityLabel="Follow up" /><T k="body">Follow up</T></>}
              </Row>
              {must || follow ? <T k="body" style={{ marginTop: 6, fontWeight: "700" }} testID="o-date">Follow up {niceDate(date)}{time ? `, ${clockShort(tm!)}` : ""}</T> : null}
              {must || follow ? (
                <HScroll contentContainerStyle={{ gap: 6, paddingVertical: 8 }}>
                  {dates.map((d) => <Chip key={d} label={shortDate(d)} on={date === d} onPress={() => setDate(d)} />)}
                </HScroll>
              ) : null}
              {must || follow ? (
                <Row testID="o-time">
                  <Text style={s.muted} accessibilityElementsHidden importantForAccessibility="no">at</Text>
                  {time ? (
                    <View style={{ flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: C.line, borderRadius: 10, backgroundColor: C.paper }}
                      accessible accessibilityRole="adjustable" accessibilityLabel="Follow up at" accessibilityValue={{ text: clockShort(tm!) }} accessibilityActions={[{ name: "increment" }, { name: "decrement" }]} onAccessibilityAction={(ev) => stepTime(ev.nativeEvent.actionName === "increment" ? 15 : -15)}>
                      <Pressable onPress={() => stepTime(-15)} hitSlop={6} style={{ paddingHorizontal: 10, paddingVertical: 8 }}><Text style={{ fontSize: 18, color: C.green }}>‹</Text></Pressable>
                      <Text style={{ fontSize: 15, minWidth: 66, textAlign: "center" }}>{clockShort(tm!)}</Text>
                      <Pressable onPress={() => stepTime(15)} hitSlop={6} style={{ paddingHorizontal: 10, paddingVertical: 8 }}><Text style={{ fontSize: 18, color: C.green }}>›</Text></Pressable>
                    </View>
                  ) : <Chip label="Add the time you promised" onPress={() => setTime("15:00")} />}
                  {time ? <Pressable onPress={() => setTime("")} accessibilityRole="button"><Text style={{ color: C.green, fontWeight: "600" }}>No time</Text></Pressable> : null}
                </Row>
              ) : null}
              <T k="label" style={{ marginTop: 10 }}>Note <Text maxFontSizeMultiplier={2} style={s.small}>(optional)</Text></T>
              <TextInput accessibilityLabel="Note" style={[s.input, { minHeight: 70 }]} multiline value={note} onChangeText={setNote} placeholder="What they said, who to ask for next time" placeholderTextColor={C.ph} />
              {err ? <T k="body" style={{ color: "#b3261e", marginTop: 6 }}>{err}</T> : null}
              {err && alt ? <Pressable onPress={() => { const mv = moveFollowUp({}, alt); setDate(mv.followUp); setTime(mv.followUpTime ?? ""); setErr(null); setWarned(null); setAlt(null); }} testID="o-alt" accessibilityRole="button"><Text style={{ color: C.green, fontWeight: "700", marginTop: 4 }}>Use {altLabel(alt)}</Text></Pressable> : null}
              <Btn label="Save outcome" onPress={() => {
                const o = makeOutcome({ result, followUp: must || follow ? date : "", who, note, at: at() });
                if (o.error) return setErr(o.error);
                // the time box, else a time the note says ("come back Thursday at 3")
                if (o.followUp) {
                  const said = time || (parseTime(o.note ?? "") != null ? hhmm(parseTime(o.note)) : "");
                  if (/^\d{2}:\d{2}$/.test(said)) o.followUpTime = said;
                }
                const fit = fitFollowUp(o, venue, { windows: planWindows, visitMin, others }); // others: a follow-up at the time of another one that day (fix6)
                // a closed day, a time another follow-up already has that day (fix6 'clash'), or a day that isn't a plan day
                // ('offplan', no alt): said once, with the next free slot when there is one
                if ((fit.code === "closed" || fit.code === "clash" || fit.code === "offplan") && warned !== `${o.followUp} ${o.followUpTime ?? ""}`) {
                  setWarned(`${o.followUp} ${o.followUpTime ?? ""}`);
                  setErr(`${fit.code === "offplan" ? fit.text : fit.code === "clash" ? clashStem(fit.text) : fit.text.replace(/ [^.]*instead\?( It isn't one of your plan days.*)?$| Pick another day\?$/, "")}${fit.alt ? (fit.code === "clash" ? " Use the next free slot below, or" : " Use the next open day below, or") : ""} Save again to keep it.`);
                  setAlt(fit.alt);
                  return;
                }
                onSave(fit.outcome, { said: fit.code === "early" ? fit.text : fit.code === "clash" && fit.outcome !== o ? fit.text.replace(/ [^.]*$/, "") : "" });
              }} testID="o-save" />
            </View>
          ) : null}
          <Btn kind="ghost" label="Cancel" onPress={onCancel} />
        </ScrollView>
      </View>
    </View>
  );
}

// The door card (Jard 10-23 #9, doorcard concept A, like a maps place card): photo, name, one status line, four action
// buttons, then At the door (lib/doorcard.js), About this door, and rows that open a page of their own (DoorPage.tsx).
// After a visit the top shows the outcome, the day so far and the next door. Footer: Log visit · ⋯ · the Agent button.
// the stop each stop route was last showing (‹ › change it in place): a row's page and Back come back to that stop, not
// to the one the route was opened on (mobile2 10-23 P1)
const shown = new Map<number, { id: string; day: number | null }>();
export default function Stop({ params }: { params: { key?: any; demo?: boolean; id: string; day: number | null } }) {
  const nav = useNav();
  const routeKey = useContext(RouteKey);
  const [cur, setCurState] = useState<{ id: string; day: number | null }>(() => shown.get(routeKey) ?? { id: params.id, day: params.day });
  const setCur = (c: { id: string; day: number | null }) => { shown.set(routeKey, c); setCurState(c); };
  const bigText = useBigText(); // the four action tiles go two by two, so no label breaks mid-word (mobile2 10-23 P2)
  const { e, plan, data, m } = useDoor(params, cur);
  const [sheet, setSheet] = useState(false);
  const [imgBad, setImgBad] = useState(false);
  const [imgOk, setImgOk] = useState(false);
  const [toast, setToast] = useState<{ text: string; undo?: () => void; at: number } | null>(null);
  // the app's Agent button (App.tsx) sits in the footer row, at its right (the footer keeps FAB_SIDE free for it)
  const [footH, setFootH] = useState(76);
  useAgentSpot({ bottom: Math.max(10, (footH - FAB_SIZE) / 2), current: cur.id, hide: !!sheet || !!(toast ?? e?.toast) });
  const scroller = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const ys = useRef<{ about?: number; door?: number }>({});
  useEffect(() => { setImgOk(false); setImgBad(false); scroller.current?.scrollTo({ y: 0, animated: false }); }, [cur.id]);
  useEffect(() => { if (sheet) tour.sig("sheet"); }, [sheet]);
  if (!e || !plan) return <Screen title="Stop"><T k="muted">That plan isn't open.</T></Screen>;
  if (!m) return <Screen title="Stop"><T k="muted">Loading the stop…</T></Screen>;
  const say = (text: string, undo?: () => void) => setToast({ text, undo, at: Date.now() });
  if (cur.day != null && m.dayIndex == null) setTimeout(() => setCur({ id: cur.id, day: null }));
  const v = m.venue;
  const done = m.status === "visited" && !m.returnVisit;
  const out = m.status === "talked" || m.status === "notfit";
  const where = m.day ? `Stop ${m.n} of ${m.total}` : m.status ? cap(({ visited: "visited", talked: "already known", notfit: "not a fit" } as any)[m.status]) : "Not on a day";
  const head = v.name ? `${v.name} · ${where.charAt(0).toLowerCase()}${where.slice(1)}` : where; // judge 9 #1: the header names the door when the card scrolls
  const tel = telHref(v.phone);
  const dir = Number.isFinite(+v.lat) ? () => openDirections(v, m.leg?.from && Number.isFinite(m.leg.from.lat) ? m.leg.from : null) : null;
  const web = /^https?:\/\//i.test(v.website ?? "") ? v.website : null;
  const look = web ? null : webSearchHref(v, plan?.city?.name); // Jard 10-23: no website from Qloo → a plain web search
  const door = atDoor(m);
  const about = aboutLines(m);
  const status = statusLine(m);
  const visit = visitLine(m);
  const after = afterVisit(m);
  const tally = after ? dayTally(plan, Number.isInteger(cur.day) ? cur.day : plan.days.findIndex((d: any) => d.date === String(m.outcome?.at ?? "").slice(0, 10))) : null;
  const tw = tally ? tallyWords(tally) : null;
  const next = nextStop(m, plan);
  const notes = notesOf(plan.slots, cur.id);
  const sisters = sistersOf(plan, data?.city, cur.id, data?.routes ?? []);
  const page = (p: string) => nav.push("doorpage", { ...params, id: cur.id, day: cur.day, page: p });
  const step = (d: number) => { const id = m.seq[m.pos + d]; if (id) setCur({ id, day: cur.day }); };

  async function mark(st: string) {
    const id = cur.id;
    const day = cur.day;
    const seq = sequenceOf(plan, day);
    const k = seq.indexOf(id);
    const nx = seq.filter((x: string) => x !== id)[Math.max(0, k)] ?? null;
    const name = plan.venues[id]?.name ?? "That door";
    const planToast = await e!.setStatus(id, st);
    if (nx && Number.isInteger(day) && e!.plan.days?.[day as number]?.stops.some((x: any) => x.id === nx)) setCur({ id: nx, day });
    if (planToast) return;
    say(`${name} marked ${st === "notfit" ? "not a fit" : "already known"}. It's out of the plan.`, async () => { await e!.setStatus(id, null); setCur({ id, day }); });
  }
  async function saveOutcome(o: any, { said = "" }: { said?: string } = {}) {
    setSheet(false);
    const id = cur.id;
    const before = { status: e!.plan.statuses[id] ?? null, outcome: e!.plan.outcomes?.[id] ?? null };
    if (e!.plan.statuses[id] !== "visited" || m!.returnVisit) await e!.setStatus(id, "visited");
    await e!.setOutcome(id, o);
    const vn = visitNote(o, { notes: notesOf(e!.plan.slots, id), by: "rep" }); // door notes: the visit's words stay on the door
    if (vn) e!.setSlot(id, vn);
    if (o.followUp) e!.selectDay("week"); // a follow-up shows in the Week view right away (web: R1 Calacanis 4)
    e!.clearToast();
    scroller.current?.scrollTo({ y: 0, animated: true });
    const undo = async () => { if (vn) e!.setSlot(id, { note: vn.id, drop: true }); await e!.setOutcome(id, before.outcome); if (before.status !== "visited") await e!.setStatus(id, before.status); say("Undone."); };
    say(o.followUp ? `${said ? `${said} ` : ""}${followUpToast(e!.plan, id, o.followUp)}` : `Logged · ${outcomeTags(o).map((x: any) => x.text).join(" · ") || "saved"}.`, undo);
  }
  const undoVisit = async () => { await e.setOutcome(cur.id, null); await e.setStatus(cur.id, null); e.clearToast(); say("Visit undone."); };
  const more = () => menu(v.name, [
    ...(done ? [{ label: "Change outcome", on: () => setSheet(true) }, { label: "Undo the visit", on: undoVisit }] : []),
    ...(!done && !out ? [{ label: "Not a fit", on: () => mark("notfit") }, { label: "Already know them", on: () => mark("talked") }] : []),
  ]); // Call is on the action row, not here too (ease audit #15)
  if (tour.on) {
    tour.handlers.visit = () => setSheet(true);
    // the tour's why / talk cards scroll what they describe to the top: About this door, At the door
    (tour.handlers as any).scrollStop = (k: "rank" | "talk") => { const y = k === "rank" ? ys.current.about : ys.current.door; if (y != null) scroller.current?.scrollTo({ y: Math.max(0, y - 8), animated: true }); };
    tour.handlers.saveOutcome = () => tour.outcome && saveOutcome(makeTourOutcome(tour.outcome));
  }
  const pinBg = done ? C.done : m.n ? colour(m.dayIndex) : "#B9B5AC";
  const badge = m.day ? `${dayLabel(plan.days, m.day)}${m.returnLabel ? ` · ${m.returnLabel}` : ""}` : "Not on a day"; // the header says "Stop n of N" (judge 8: it showed twice)
  const legTxt = m.leg ? `${m.leg.mi.toFixed(1)} mi` : "";
  return (
    <Screen title={head} scroll={false} testID="stop" headHidden={!!sheet}
      right={<Row wrap={false} style={{ gap: 2 }}>
        <Pressable onPress={() => step(-1)} disabled={!(m.pos > 0)} hitSlop={6} style={{ padding: 6, opacity: m.pos > 0 ? 1 : 0.3, minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" }} accessibilityRole="button" accessibilityState={{ disabled: !(m.pos > 0) }} accessibilityLabel="Previous stop" testID="prev"><Text style={{ fontSize: 22, color: C.green }}>‹</Text></Pressable>
        <Pressable onPress={() => step(1)} disabled={!(m.pos >= 0 && m.pos < m.seq.length - 1)} hitSlop={6} style={{ padding: 6, opacity: m.pos >= 0 && m.pos < m.seq.length - 1 ? 1 : 0.3, minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" }} accessibilityRole="button" accessibilityState={{ disabled: !(m.pos >= 0 && m.pos < m.seq.length - 1) }} accessibilityLabel="Next stop" testID="next"><Text style={{ fontSize: 22, color: C.green }}>›</Text></Pressable>
      </Row>}>
      <ScrollView ref={scroller} contentContainerStyle={{ padding: 16, paddingBottom: 30 }} keyboardShouldPersistTaps="handled">
        {/* the photo, with the stop's day and number on it */}
        {v.image && !imgBad ? (
          <View style={{ height: imgOk ? 170 : 0, borderRadius: 16, overflow: "hidden", marginBottom: imgOk ? 12 : 0, backgroundColor: C.line }}>
            <Image onError={() => setImgBad(true)} onLoad={() => setImgOk(true)} source={{ uri: v.image }} style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0 }} resizeMode="cover" accessibilityIgnoresInvertColors accessible accessibilityRole="image" accessibilityLabel={`Photo of ${v.name ?? "the door"}`} />
          </View>
        ) : null}
        <Row wrap={false} style={{ gap: 8, alignItems: "center" }}>
          <View style={{ minWidth: 26, height: 26, paddingHorizontal: 6, borderRadius: 13, backgroundColor: pinBg, alignItems: "center", justifyContent: "center" }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><Text style={{ color: "#fff", fontWeight: "800", fontSize: 13 }} maxFontSizeMultiplier={1.2}>{done ? "✓" : m.n ?? "•"}</Text></View>
          <T k="small" style={{ flex: 1, fontWeight: "600" }}>{badge}</T>
        </Row>
        <T k="h1" style={{ fontSize: 28, marginTop: 6 }} header>{v.name}</T>
        <T k="muted">{m.meta.join(" · ") || (v.source === "manual" ? "Added by you" : "")}</T>
        {status.length ? (
          <Text style={[s.body, { marginTop: 8 }]} maxFontSizeMultiplier={2} testID="status">
            {status.map((x: any, i: number) => <Text key={i} style={x.tone === "ok" ? { color: C.done, fontWeight: "700" } : x.tone === "warn" ? { color: C.warn, fontWeight: "700" } : null}>{i ? " · " : ""}{x.text}</Text>)}
            {m.wait ? <Text>{` · wait ~${m.wait} min`}</Text> : null}
          </Text>
        ) : null}

        {/* four actions, like a maps place card */}
        <Row key={bigText ? "big" : "std"} wrap={bigText} style={{ gap: 8, marginTop: 12, alignItems: "stretch" }} testID="actions">{/* keyed: a live text-size change rebuilds the row (an in-place restyle kept the old widths on iOS, mobile2 10-23) */}
          {dir ? <Act half={bigText} icon="directions" label="Directions" sub={legTxt} primary onPress={dir} /> : null}
          {tel ? <Act half={bigText} icon="call" label="Call" onPress={() => Linking.openURL(tel)} /> : null}
          <Act half={bigText} icon="message" label="Message" onPress={() => page("message")} testID="act-message" />
          {web ? <Act half={bigText} icon="website" label="Website" onPress={() => Linking.openURL(web)} /> : look ? <Act half={bigText} icon="search" label="Search the web" a11y={`Search the web for ${v.name}`} onPress={() => Linking.openURL(look)} /> : null}
        </Row>

        {/* after a visit: what happened, the day so far, the next door */}
        {after ? (
          <View style={[card, { borderColor: "#cfe5d7", backgroundColor: "#eef6f1" }]} testID="after">
            <T k="h3" style={{ color: C.done }}>{/^✓/.test(after.title) ? after.title : `✓ ${after.title}`}</T>
            {after.lines.map((x: string, i: number) => <T key={i} k="body" style={{ marginTop: 4 }}>{x}</T>)}
            {tally && tw ? (
              /* Jard 10-24 #4: words first, one bar colour = visited (the coloured dots needed decoding); web: ui/stop.js tallyHTML */
              <View style={{ marginTop: 12 }} accessible accessibilityLabel={`${tw.head}${tw.sub ? `. ${tw.sub}` : ""}`}>
                <T k="body" style={{ fontWeight: "700", color: C.ink }}>{tw.head}</T>
                <Row style={{ gap: 3, marginTop: 6, marginBottom: 4 }}>{tally.dots.map((d: string, i: number) => <View key={i} style={{ flex: 1, height: 8, borderRadius: 4, backgroundColor: d ? C.done : "#D5E3DA" }} />)}</Row>
                {tw.sub ? <T k="small">{tw.sub}</T> : null}
              </View>
            ) : null}
          </View>
        ) : out ? (
          <View style={[card, { backgroundColor: C.seg }]}><T k="body">{m.status === "notfit" ? "Not a fit" : "Already know them"} · left out of the plan</T></View>
        ) : null}

        {/* At the door: what a rep reads in the 30 seconds before walking in */}
        {!done ? (
          <View style={card} onLayout={(ev) => (ys.current.door = ev.nativeEvent.layout.y)} testID="talk">
            <Row style={{ justifyContent: "space-between" }} wrap={false}><T k="h3">At the door</T>{visit ? <T k="small">{visit}</T> : null}</Row>
            {door.askFor ? <Line k="Ask for" text={door.askFor} sub={door.timing} /> : door.timing ? <Line k="When" text={door.timing} /> : null}
            {door.last.map((x: string, i: number) => <Line key={i} k="Last time" text={x} />)}
            {door.order ? <Line k="First" text={door.order} /> : null}
            {door.opener ? <Line k="Opener" text={`“${door.opener}”`} big /> : null}
            {door.toBuyer ? <Line k="To the buyer" text={`“${door.toBuyer}”`} sub={door.angle ? `Why: ${door.angle}` : null} big /> : null}
            {door.ask ? <Line k="The ask" text={door.ask} sub={door.toBuyer ? "After they've tasted it." : null} ask /> : null}
            {door.bring ? <Line k="Bring" text={door.bring} /> : null}
            <Pressable onPress={() => page("talk")} style={{ minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderTopWidth: 1, borderColor: C.line2, marginTop: 6 }} accessibilityRole="button" testID="talk-open">
              <Text style={{ color: C.green, fontWeight: "700", fontSize: 15, flex: 1 }} maxFontSizeMultiplier={1.8}>{talkCounts(m.talk) || "Talking points"}</Text>
              <Text style={{ color: C.green, fontWeight: "700" }} maxFontSizeMultiplier={1.5} accessibilityElementsHidden importantForAccessibility="no">›</Text>
            </Pressable>
          </View>
        ) : null}

        {/* About this door: three lines, then Qloo's raw listing as one link (not a row at the card's end; ease #9) */}
        <View style={{ marginTop: about.length ? 16 : 8 }} onLayout={(ev) => (ys.current.about = ev.nativeEvent.layout.y)} testID="about">
          {about.length ? <T k="h3">About this door</T> : null}
          {about.map((x: any) => (
            <View key={x.key} style={{ marginTop: 8 }}>
              <T k="label">{x.title}</T>
              <T k="body">{x.text}</T>
            </View>
          ))}
          <Pressable onPress={() => page("qloo")} accessibilityRole="button" style={{ minHeight: 44, justifyContent: "center" }} testID="row-qloo"><Text style={{ color: C.green, fontWeight: "600", fontSize: 15 }} maxFontSizeMultiplier={1.8}>See Qloo's listing ›</Text></Pressable>
        </View>

        <Group>
          <RowLink icon="notes" title={`Notes${notes.length ? ` · ${notes.length}` : ""}`} sub={notes[0]?.text ?? "Who to ask for, when they're in"} onPress={() => page("notes")} testID="row-notes" />
          <RowLink icon="message" title="Drafted message" sub={m.note.subject} onPress={() => page("message")} testID="row-message" />
          {/* the Why screen's view of this one door (Why.tsx opens on params.door, lib/basis.js doorTrail) */}
          {nav.has("why") ? <RowLink icon="why" title="Why this door" sub={m.whyLine || m.record.rank} onPress={() => nav.push("why", { ...(params.demo ? { demo: true } : { key: params.key }), door: cur.id })} testID="why-door" /> : null}
          {/* intuitiveness audit #3: sister doors are one row here; DoorPage lists them with their reasons */}
          {sisters.length ? <RowLink icon="sisters" title="Sister doors" sub={sisterSummary(sisters).sub} onPress={() => page("sisters")} testID="row-sisters" /> : null}
        </Group>


      </ScrollView>

      {/* footer: one big button, ⋯ for the rest, and the Agent button's place at the right */}
      <View onLayout={(ev) => setFootH(Math.round(ev.nativeEvent.layout.height))} style={{ flexDirection: "row", gap: 10, alignItems: "center", padding: 12, paddingRight: 12 + FAB_SIDE, borderTopWidth: 1, borderColor: C.line, backgroundColor: C.bg }} testID="stop-foot">
        {out ? <Btn label="Undo" onPress={() => e.setStatus(cur.id, null)} style={{ flex: 1, marginTop: 0 }} />
          : done ? (next ? <Btn label={`Next: ${next.name}${next.arrive ? ` · ${clock12(next.arrive)}` : ""}`} onPress={() => setCur({ id: next.id, day: cur.day })} style={{ flex: 1, marginTop: 0 }} testID="next-door" cap={bigText ? 2.2 : 1.5} fit /* one line: on an SE it wrapped beside ⋯ and 💬 (mobile2 10-24) */ />
            : <Btn label="Change outcome" onPress={() => setSheet(true)} style={{ flex: 1, marginTop: 0 }} />)
          : <Btn label="Log visit" onPress={() => setSheet(true)} style={{ flex: 1, marginTop: 0 }} testID="visit" cap={bigText ? 2.2 : 1.5} />}
        <Pressable onPress={more} style={{ width: 52, height: 52, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper, alignItems: "center", justifyContent: "center" }} accessibilityRole="button" accessibilityLabel={done ? "More: Change outcome, Undo the visit" : "More: Not a fit, Already know them"} testID="more"><Ic name="more" size={22} color={C.ink2} /></Pressable>
      </View>
      <Toast toast={toast ?? e.toast} onUndo={() => { const u = (toast ?? e.toast)?.undo; setToast(null); e.clearToast(); u?.(); }} onClose={() => { setToast(null); e.clearToast(); }} bottom={footH + 12} />
      {sheet ? <OutcomeSheet name={v.name} current={m.returnVisit ? null : m.outcome} defaultDate={followUpDay(plan.venues?.[cur.id], { windows: plan.windows ?? [], from: m.day?.date ?? isoDate(new Date()), visitMin: plan.profile?.visitMin ?? 25 }) ?? defaultFollowUp(plan.windows ?? [], m.day?.date ?? isoDate(new Date()))} windows={(plan.windows ?? []).map((w: any) => w.date)} venue={plan.venues?.[cur.id] ?? null} planWindows={plan.windows ?? []} visitMin={plan.profile?.visitMin ?? 25} others={otherFollowUps(plan.outcomes, plan.venues, cur.id)} day={m.day?.date ?? null} eta={m.stop?.eta ?? null} onSave={saveOutcome} onCancel={() => setSheet(false)} prefill={tour.on ? tour.outcome : undefined} now={tour.on && tour.outcome?.at ? () => tour.outcome.at : undefined} /> : null}
    </Screen>
  );
}

const card = { backgroundColor: C.paper, borderWidth: 1, borderColor: C.line, borderRadius: 16, padding: 14, marginTop: 14 } as const;
function Act({ icon, label, sub, primary, onPress, testID, a11y, half }: { icon: IconName; label: string; sub?: string; primary?: boolean; onPress: () => void; testID?: string; a11y?: string; half?: boolean }) {
  const fg = primary ? "#fff" : C.green;
  return (
    <Pressable onPress={onPress} testID={testID} accessibilityRole="button" accessibilityLabel={a11y ?? `${label}${sub ? `, ${sub}` : ""}`}
      style={({ pressed }) => ({ ...(half ? { flexBasis: "46%", flexGrow: 1, flexShrink: 0 } : { flexBasis: 0, flexGrow: 1, flexShrink: 1 }) /* every key both ways: a key left out keeps its old value when the size changes live (mobile2 10-23) */, minHeight: 60, borderRadius: 12, paddingVertical: 8, paddingHorizontal: 2, alignItems: "center", justifyContent: "center", backgroundColor: primary ? C.green : C.seg, opacity: pressed ? 0.8 : 1 })}>
      <View style={{ marginBottom: 2 }}><Ic name={icon} size={20} color={fg} /></View>
      <Text numberOfLines={half ? 0 : 2} adjustsFontSizeToFit={!half} minimumFontScale={0.8} maxFontSizeMultiplier={half ? 2.2 : 1.4} style={{ color: fg, fontWeight: "700", fontSize: 13, textAlign: "center" }}>{label}</Text>
      {sub ? <Text style={{ color: fg, fontSize: 11, opacity: 0.85 }} maxFontSizeMultiplier={half ? 2 : 1.3}>{sub}</Text> : null}
    </Pressable>
  );
}
function Line({ k, text, sub, big, ask }: { k: string; text: string; sub?: string | null; big?: boolean; ask?: boolean }) {
  return (
    <View style={{ paddingTop: 10, marginTop: 8, borderTopWidth: 1, borderColor: C.line2 }}>
      <Text style={s.sectH} maxFontSizeMultiplier={1.6}>{k}</Text>
      {ask ? <View style={{ backgroundColor: C.amberSoft, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, marginTop: 4 }}><T k="body" style={{ fontWeight: "700", color: C.warn }}>{text}</T></View>
        : <T k="body" style={[{ marginTop: 2 }, big && { fontSize: 18, fontWeight: "600", lineHeight: 25 }]}>{text}</T>}
      {sub ? <T k="small" style={{ marginTop: 2 }}>{sub}</T> : null}
    </View>
  );
}
function Group({ children }: { children: React.ReactNode }) {
  return <View style={{ marginTop: 16, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.paper, overflow: "hidden" }}>{children}</View>;
}
function RowLink({ icon, title, sub, onPress, testID }: { icon: IconName; title: string; sub?: string; onPress: () => void; testID?: string }) {
  return (
    <Pressable onPress={onPress} testID={testID} accessibilityRole="button" accessibilityLabel={`${title}${sub ? `. ${sub}` : ""}`}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 10, minHeight: 56, borderTopWidth: 1, borderColor: C.line2, backgroundColor: pressed ? C.line2 : C.paper })}>
      <View style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: C.greenSoft, alignItems: "center", justifyContent: "center" }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants"><Ic name={icon} size={18} color={C.green} /></View>
      <View style={{ flex: 1 }}>
        <T k="body" style={{ fontWeight: "600" }}>{title}</T>
        {sub ? <T k="small" lines={1}>{sub}</T> : null}
      </View>
      <Text style={{ color: C.ink3, fontSize: 20 }} accessibilityElementsHidden importantForAccessibility="no">›</Text>
    </Pressable>
  );
}
