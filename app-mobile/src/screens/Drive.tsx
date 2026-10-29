// Drive mode on any plan (ui/drive.js on the phone; the first phone app's Door / Day / Ask, now over the engine): the
// current door full screen with why and what to say, Navigate (Apple Maps), a big Done → say it (the app's own mic,
// src/mic.ts: tap, talk, and it's logged) or type it, or tap what happened → the agent's log-visit (the rules parser when it's resting or offline) → read
// back → Save → the plan re-routes → next door, with Undo. Running late → move the rest to the next day. Skip for now.
// The day as a map and a list. Ask with where you are. Back to the plan any time.
// Safety: built for between stops; nothing needs typing while moving (the mic, quick taps, read-aloud).
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FlatList, Keyboard, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from "react-native";
import { useKeepAwake } from "expo-keep-awake"; // the screen stays on while driving, as the web's wakeLock (drive.js)
import { speak, speakAndWait, stopSpeaking, ack } from "../voice"; // Aura-2 from the Worker, the device voice when it can't; the Agent's acknowledgement clips
import type { Chat } from "../agent";
import { pickDay, driveQueue, nextAfter, lateFor, LATE_PICKS, latePickLabel, LATE_CONTROL as LC, legMiText, DRIVE_WORDS as W, lateMovedText } from "../../../public/lib/drive-day.js";
import { recordOf, debrief, bookDay, leftToday, endSheetText, laterDays, lateOffer, overCapText, skippedText, LATE_WORDS as LW } from "../../../public/lib/day-debrief.js"; // the day flow (Jard 10-23, items 5-9; ui/drive.js)
import { logVisit as sharedLogVisit } from "../../../public/lib/drive-log.js";
import { planNames } from "../../../public/lib/agent-context.js";
import { makeOutcome, defaultFollowUp, outcomeText, localStamp, returnVisitLabel, QUICK_TEXT } from "../../../public/lib/outcome.js";
import { fitDriveResult, movedDriveResult, comeBackDay, driveSpeech, altLabel, otherFollowUps, keptText } from "../../../public/lib/fu-check.js";
import { replanSummary } from "../../../public/lib/planview.js";
import { clockShort } from "../../../public/lib/schedule.js";
import { sayOutcome, isSkip } from "../../../public/lib/visit-parse.js";
import { stopModel, addressLine } from "../../../public/lib/stopmodel.js";
import { openTill } from "../../../public/lib/pool.js";
import { parseHours } from "../../../public/lib/core.js";
import { lineSources } from "../../../public/lib/provenance.js";
import { aboutLines } from "../../../public/lib/doorcard.js";
import { clock12, niceDate } from "../../../public/lib/profile.js";
import { workerFetch } from "../data";
import { appGet, appSet } from "../storage";
import { cap, nowStamp, type PlanEngine } from "../engine";
import { roadFor, type Road } from "../roads";
import { chatFor } from "../agent";
import { usePlanEngine } from "./Plan";
import { openDemo } from "../session";
import { useAgentSpot, useBackOverride, useNav } from "../nav";
import { tour } from "../tour";
import { startCaretFollow } from "../../modules/caret-follow";
import ChatView from "../components/ChatView";
import MicButton from "../components/MicButton";
import { MIC, useMic } from "../mic";
import { notesOf, visitNote, makeNote } from "../../../public/lib/door-notes.js"; // door notes
import DayMap from "../components/DayMap";
import { polishBody, polishView, POLISH_PATH, POLISH_LABEL, POLISH_BUSY, POLISH_FOOT } from "../../../public/lib/day-polish.js"; // Doors Agent ability 9
import { C, List, Scroll, spoken as a11yLabel, s as ui, useBigText } from "../ui";
import { chooseNavApp, navAppName, openDirections, savedNavApp, type NavApp } from "../navapp";
import { Ic } from "../icons"; // the Doors icon set (Jard 10-24 #1)

type Result = { ok: true; visit: { status: string; outcome: any }; say: string; source: string } | { ok: false; error?: string; ask: string };
type Sheet = { id: string; name: string; text: string; busy: boolean; result: Extract<Result, { ok: true }> | null; ask: string | null; alt?: any; noDay?: any };
const spoken = (x: string) => x.replace(/[✓↻“”"]/g, "").replace(/\s·\s/g, ", ").replace(/\s+/g, " ").trim();
const clock = (m: number | null | undefined) => (m == null ? "" : clock12(m));
const legText = (st: any) => (st?.legMin == null ? "" : `${st.legMin} min · ${st.legMi} mi ${st.source === "ors" || st.source === "osrm" ? "by road" : "estimated"}`);

// the door's why + what to say, from the web's stop model with each line's source chip (as the web's drive mode)
function doorModel(plan: any, data: any, id: string, dayIndex: number) {
  try {
    const m = stopModel({ plan, id, dayIndex, ...data });
    const src = lineSources(m);
    const t = m.talk;
    const qc = src.questions.slice(0, 2);
    const allTpl = qc.every((c: any) => c?.k === "tpl");
    return {
      // the door card's words (ease audit #15): its Crowd (or The room) line, and "Why this door" = the reason in words (judge pass 8 #2)
      why: (m.why ?? []).map((l: any) => ({ label: l.label, text: l.text })), crowd: aboutLines(m).find((x: any) => x.key === "crowd" || x.key === "room") ?? null, whyLine: m.whyLine ?? "", hoursToday: m.hoursToday,
      opener: t.opener, toBuyer: t.toBuyer ?? null, openerChip: src.opener ?? null, openerWhy: src.opener?.k === "qloo" && src.opener.title ? src.opener.title : "",
      questions: (t.questions ?? []).slice(0, 2).map((text: string, i: number) => ({ text, chip: allTpl || qc[i]?.k === "tpl" ? null : qc[i] ?? null })),
      questionsChip: allTpl ? qc[0] ?? null : null, ask: t.ask, askChip: src.ask ?? null,
    };
  } catch {
    return null;
  }
}

export default function Drive({ params }: { params: any }) {
  const nav = useNav();
  const e = usePlanEngine(params) as PlanEngine | null;
  const [screen, setScreen] = useState<"door" | "day" | "ask">("door");
  const [data, setData] = useState<any>(null);
  const [date, setDate] = useState<string | null>(null); // the day being driven (by date: indices shift)
  const [viewId, setViewId] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const [undo, setUndo] = useState<{ before: any; text: string; note?: { id: string; nid: string } | null } | null>(null);
  const [toastLines, setToastLines] = useState(0); // the toast's words, measured in lines (the hint shows when they're cut)
  const [endBefore, setEndBefore] = useState<any>(null); // the debrief's Undo of End my day (this visit to drive mode)
  const [toastOpen, setToastOpen] = useState(false);
  // running late's offer (ui/drive.js lateCk): the dry run of the move per later day for the doors that
  // don't fit, keyed by them and the days ahead; fits null while it runs. lateChoosing: "Choose a day" is open
  const lateCk = useRef<{ key: string; fits: any[] | null } | null>(null);
  const [, setLateTick] = useState(0);
  const [lateChoosing, setLateChoosing] = useState(false);
  const bigFont = useBigText(); // the late banner's two buttons share a row unless the text is big
  // AUDIT-EASE-3 #3 (SE, Large text): the footer (Running late, Navigate, Log visit) left the door card ~30 pt, under the
  // 💬. From a little above default the late control moves to the card's top and the footer's buttons stop growing
  const tightFoot = useBigText(1.15);
  // "Running late" said by the rep (ease audit #7, ui/drive.js the same): minutes late on that day, and its picker open
  const [lateSaid, setLateSaid] = useState<{ date: string | null; by: number }>({ date: null, by: 0 });
  const [latePicking, setLatePicking] = useState(false);
  const [voice, setVoice] = useState(() => appGet("driveVoice") !== "off"); // remembered, as the web's (drive.js VOICE_KEY)
  const [reads, setReads] = useState(0); // read-alouds under way (the hands-free ear is paused while Doors talks)
  const [reading, setReading] = useState(false); // Read it to me is reading (Jard 10-28: the tap showed nothing)
  const [hfMuted, setHfMuted] = useState(false); // the hands-free Agent's Mute (this drive only; Voice off also stops it)
  const [navApp, setNavApp] = useState<NavApp | null>(() => savedNavApp());
  const [road, setRoad] = useState<Road | null>(null);
  const [off, setOff] = useState<{ phase: "remove" | "end"; id: string | null } | null>(null); // Remove from today / End my day
  // the app's Agent button (Jard 10-23 #6) opens drive mode's own Ask tab, sits above the Navigate / Done buttons, and
  // steps aside for a sheet and on the Ask tab itself
  const [footH, setFootH] = useState(0);
  // mobile2 10-23: the door's name and the Say lines ran under the button (SE at large text; a Pro Max at default): the
  // button sits over this scroller on every phone, so its text always keeps the button's width
  useAgentSpot({ bottom: (screen === "door" ? footH : 0) + 16, hide: true, onPress: () => setScreen("ask") }); // intuit audit #9: the Ask tab is the way in here; no 💬 beside it
  const [, tick] = useState(0);
  const { fontScale, height: winH } = useWindowDimensions();
  const shortHead = winH < 700; // an SE-sized screen: the previewed day's header in two lines (intuit 1b #1)
  const big = fontScale > 1.5;
  const LINE = 24 * fontScale;
  const grow = (lines: number, share: number) => Math.round(Math.min(lines * LINE + 26, winH * share));
  const noOnChange = process.env.EXPO_PUBLIC_UI_TEST_NO_ONCHANGE === "1";
  const sheetScroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const doorScroll = useRef<React.ComponentRef<typeof ScrollView>>(null); // Running late: back up to its line
  const doneBoxY = useRef(0);
  const doneText = useRef("");
  const [doneLen, setDoneLen] = useState(0);
  const [doneKey, setDoneKey] = useState(0); // a new Done box when the mic filled it (the box is uncontrolled)
  // the Done box's mic: what was said goes straight to Log it (the read-back, Change it and the toast's Undo follow)
  const doneMic = useMic((said) => {
    doneText.current = [doneText.current.trim(), said].filter(Boolean).join(" ").slice(0, 400);
    setDoneKey((n) => n + 1);
    submit();
  });
  useEffect(() => { startCaretFollow(); }, []);
  useKeepAwake("doors-drive");
  useEffect(() => { e?.stopData().then(setData); }, [e]);
  useEffect(() => { const t = setInterval(() => tick((n) => n + 1), 30000); return () => clearInterval(t); }, []); // running late shows up on its own

  const plan = e?.plan;
  const now = nowStamp();
  const k = useMemo(() => {
    if (!plan) return -1;
    const at = date ? plan.days.findIndex((d: any) => d.date === date && (d.stops.length || recordOf(plan.drive, date).ended)) : -1; // an ended day keeps its debrief
    return at >= 0 ? at : pickDay(plan, now)?.index ?? -1;
  }, [plan, date, now.date]);
  const q = plan && k >= 0 ? driveQueue(plan, k) : null;
  useEffect(() => { if (q && !date) setDate(q.day.date); }, [q?.day.date]);
  // ease audit 2 #3: opened from the Agent's "I'm running late" (params.late: minutes): that late, once
  const lateParam = useRef(+params?.late || 0);
  useEffect(() => { if (q && lateParam.current > 0) { setLateSaid({ date: q.day.date, by: lateParam.current }); lateParam.current = 0; } }, [q?.day.date]);
  // the day's record (ui/drive.js): started the first time today opens; a paused day says where it picks up
  const opened = useRef(false);
  useEffect(() => {
    if (!q || !e || opened.current) return;
    opened.current = true;
    if (q.day.date !== nowStamp().date) return;
    const r = recordOf(plan.drive, q.day.date);
    if (!r.started) e.setDrive(q.day.date, { started: localStamp(new Date()), paused: null });
    else if (r.paused && q.current) {
      e.setDrive(q.day.date, { paused: null });
      setUndo({ before: null, text: `Welcome back. Picking up at stop ${q.current.n} of ${q.total}: ${q.current.name}.` });
    }
  }, [q?.day.date]);
  const roadKey = q ? `${q.day.date}|${q.day.stops.map((x: any) => x.id).join()}` : "";
  useEffect(() => {
    if (!q || !plan) return;
    roadFor(q.day.start, q.day.stops.map((x: any) => plan.venues[x.id]), { offline: !!e?.demo }).then(setRoad);
  }, [roadKey]);

  // the ear (HandsFreeBar) is held while a read-aloud plays, so the Agent never hears Doors itself
  const say = useCallback(async (text: string) => {
    if (!voice) return;
    setReads((n) => n + 1);
    try { await speakAndWait(spoken(text), { offline: !!e?.demo }); } finally { setReads((n) => n - 1); }
  }, [voice]);
  // Read it to me (always, Voice on or off: it was asked for): the button shows Reading… with a Stop until it ends
  const readIt = async (text: string) => {
    setReading(true);
    setReads((n) => n + 1);
    try { await speakAndWait(spoken(text), { offline: !!e?.demo }); } finally { setReads((n) => n - 1); setReading(false); }
  };

  // Pause (item 5): today's drive keeps its place; the plan's button says Resume my day
  const pausable = () => !!(plan && q && q.day.date === nowStamp().date && !q.finished && !recordOf(plan.drive, q.day.date).ended);
  const leave = () => { stopSpeaking(); if (pausable()) e!.setDrive(q!.day.date, { paused: localStamp(new Date()) }); nav.back(); };
  useBackOverride(leave); // the edge swipe and Android's back pause the day as the button does
  const Top = ({ children }: { children?: React.ReactNode }) => (
    <View style={st.top}>
      <View style={st.topRow}>
        <Pressable onPress={leave} accessibilityRole="button" accessibilityLabel={pausable() ? "Pause your day: back to the plan, it keeps your place" : "Back to the plan"} hitSlop={10} testID="drive-back">
          {pausable() ? <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}><Ic name="pause" size={16} color={C.green} /><Text style={st.back} maxFontSizeMultiplier={1.3}>Pause</Text></View> : <Text style={st.back} maxFontSizeMultiplier={1.3}>‹ Back to plan</Text>}
        </Pressable>
        <Pressable onPress={() => (appSet("driveVoice", voice ? "off" : "on"), setVoice(!voice), stopSpeaking())} accessibilityRole="switch" accessibilityLabel="Voice" accessibilityState={{ checked: voice }} style={st.tab}><Text style={st.tabText} maxFontSizeMultiplier={1.3}>{voice ? "Voice on" : "Voice off"}</Text></Pressable>
      </View>
      {children}
    </View>
  );
  if (!e || !plan) return <View style={st.shell}><Top /><Text style={ui.muted}>Your plan is loading…</Text></View>;
  if (!q) {
    return (
      <View style={st.shell}><Top />
        <Text style={st.name} accessibilityRole="header">No doors on a day ahead</Text>
        <Text style={st.body}>Add a day or a door in the plan, then start your day.</Text>
        <Big label="Back to the plan" onPress={() => nav.back()} />
      </View>
    );
  }
  const today = q.day.date === now.date;
  // the SE's previewed-day title, one line: "Wed Oct 28 · 2 of 8 done" (intuit 1b #1)
  const shortTitle = (() => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(q.day.date));
    const d = m ? new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }).replace(",", "") : String(q.day.date);
    return `${d} · ${q.finished && q.total ? "Day done" : `${q.done} of ${q.total} done`}`;
  })();
  const cur = q.current;
  const viewed = viewId ? q.stops.find((x: any) => x.id === viewId && x.id !== cur?.id) ?? null : null;
  const door = viewed ?? cur;
  const then = nextAfter(q);
  const v = door?.venue ?? null;
  const dm = data && door ? doorModel(plan, data, door.id, k) : null;
  const lateBy = lateSaid.date === q.day.date ? lateSaid.by : 0;
  const late = cur && !viewed ? lateFor(q, now, lateBy, { visitMin: plan.profile?.visitMin ?? 25, today }) : null;
  // only a day the move really fits is offered (lib lateOffer from the engine's lateFits; the move is the same input)
  const offer: any = (() => {
    if (!late?.out.length) return null;
    const later = laterDays(plan, plan.days[k].date);
    if (!later.length) return { noDay: true };
    const key = JSON.stringify([plan.days[k].date, late.out, later.map(({ i }: any) => plan.days[i].stops.map((x: any) => x.id))]);
    if (lateCk.current?.key === key) return lateCk.current.fits ? lateOffer(lateCk.current.fits) : { pending: true };
    const ck: { key: string; fits: any[] | null } = (lateCk.current = { key, fits: null });
    Promise.resolve(e!.lateFits(k, late.out)).then((f) => {
      if (lateCk.current !== ck) return;
      if (f) ck.fits = f;
      else lateCk.current = null; // the plan changed while it ran: asked again on the next draw
      setLateChoosing(false);
      setLateTick((n) => n + 1);
    }, () => { if (lateCk.current === ck) { ck.fits = []; setLateTick((n) => n + 1); } });
    return { pending: true };
  })();
  // ease audit 3 #2: no day to move them to → the two ways out on the banner itself (ui/drive.js lateOutHTML)
  const lateOut = late?.out.length ? (
    // mobile2 10-24: side by side at every size (labels wrap, capped at 1.3x), so both stay above the footer on an SE at AX sizes
    <View style={[st.quickRow, { flexWrap: "nowrap" }]} testID="drive-late-out">
      {/* above default the headline already names the doors, so the button says it short (VoiceOver keeps the names) */}
      <Small label={tightFoot ? (late.out.length === 1 ? "Skip it" : late.out.length === 2 ? "Skip both" : `Skip those ${late.out.length}`) : LW.skip(late.out.map((id: string) => plan.venues[id]?.name ?? "that door"))} a11y={a11yLabel(LW.skip(late.out.map((id: string) => plan.venues[id]?.name ?? "that door")))} onPress={skipLate} testID="drive-late-skip" style={{ flexBasis: 0 }} cap={1.3} />
      {today ? <Small label={LW.end} onPress={() => setOff({ phase: "end", id: null })} testID="drive-late-end" style={{ flexBasis: 0 }} cap={1.3} /> : null}
    </View>
  ) : null;

  // Running late's control (judge 8, 10-24): in the footer by Navigate and Log visit; at big text at the top of the card,
  // where it stays above the fold without the footer crowding out the door
  const lateCtl = () => (
    <View style={[st.quickRow, { marginBottom: 6 }]} testID="drive-latectl">{/* judge 8 (10-24): Running late sits by Navigate and Log visit, not below the fold */}
      {latePicking ? (
        <>
          <Text style={[st.muted, { width: "100%" }]}>{LC.ask}</Text>
          {LATE_PICKS.map((x: number) => <Small key={x} label={latePickLabel(x)} a11y={x >= 60 ? `${x / 60} hour late` : `${x} minutes late`} onPress={() => { setLateSaid({ date: q.day.date, by: x }); setLatePicking(false); lateCk.current = null; doorScroll.current?.scrollTo({ y: 0, animated: true }); }} testID={`drive-lateby-${x}`} />)}
          {lateBy ? <Small label={LC.clear} onPress={() => { setLateSaid({ date: q.day.date, by: 0 }); setLatePicking(false); }} testID="drive-lateby-0" /> : null}
        </>
      ) : <Small label={lateBy ? `${LC.open} · ${latePickLabel(lateBy)}` : LC.open} onPress={() => setLatePicking(true)} testID="drive-latepick" cap={1.3} />}
    </View>
  );
  const ctxFor = (id: string) => ({
    stop: { id, name: plan.venues[id]?.name ?? "", date: q.day.date },
    now: nowStamp(),
    windows: (plan.windows ?? []).map((w: any) => w.date),
    next: q.stops.filter((x: any) => !x.done && x.id !== id).map((x: any) => ({ id: x.id, name: x.name })),
    names: planNames(plan), // the Worker redacts them before the model reads the visit
  });
  const fuFrom = () => (q.day.date > nowStamp().date ? q.day.date : nowStamp().date);
  // judge pass 4 (#2, #3): a follow-up is checked against the door's hours before it's saved (lib/fu-check.js)
  const hoursOpts = () => ({ windows: plan.windows ?? [], visitMin: plan.profile?.visitMin ?? 25 });
  const fitHours = (r: any, ctx: any) => fitDriveResult(r, plan.venues?.[ctx.stop.id], { ...hoursOpts(), next: ctx.next[0]?.name ?? "", others: otherFollowUps(plan.outcomes, plan.venues, ctx.stop.id) });
  // judge (phone #7): the read-back read aloud is one sentence (lib driveSpeech); the screen keeps every fact
  const speechOf = (r: any, id: string) => driveSpeech(r, plan.venues?.[id], { ...hoursOpts(), next: ctxFor(id).next[0]?.name ?? "", others: otherFollowUps(plan.outcomes, plan.venues, id) });
  // the one-tap "Come back" day: the next plan day the door is open, never one it's closed; {date, planDay}
  const comeBack = (id: string) => comeBackDay(plan.venues?.[id], { ...hoursOpts(), from: fuFrom() });
  const openSheet = () => {
    if (!door) return;
    doneText.current = tour.on && tour.doneText ? tour.doneText : "";
    tour.sig("driveSheet");
    setDoneLen(0);
    setSheet({ id: door.id, name: door.name, text: "", busy: false, result: null, ask: null });
  };
  const closeSheet = () => { doneMic.cancel(); setSheet(null); };
  // A note on the door from the road (PARITY M1, the web's drive.js the same): said → saved at once; typed → Save note.
  // Either way a toast with Undo. noteFor: the door the mic was started on (the card can move on while it listens).
  const [noteBox, setNoteBox] = useState<string | null>(null); // the typed box, open (its text) or closed (null)
  const noteFor = useRef<string | null>(null);
  const addNote = (id: string | null, text: string) => {
    const rec = id ? makeNote({ text, by: "drive" }) : null;
    if (!rec || !e) return false;
    e.setSlot(id!, rec);
    e.clearToast();
    // Undo drops the note itself (the plan's snapshot holds no notes; the web's drive.js the same)
    setUndo({ before: null, note: { id: id!, nid: rec.id }, text: `Note saved on ${plan.venues?.[id!]?.name ?? "this door"}: “${rec.value}”.` });
    return true;
  };
  const noteMic = useMic((said) => { addNote(noteFor.current, said); });
  const logBox = () => {
    if (doneText.current.trim()) return submit();
    Keyboard.dismiss();
    setTimeout(submit, 150);
  };
  async function skip(id = cur?.id) {
    if (!id) return;
    const before = e!.snapshot();
    const name = plan.venues[id]?.name ?? "That door";
    await e!.skipStop(id); // the door last on today's order, nothing else taken off (Jard 10-23; ui/drive.js the same)
    e!.setDrive(q!.day.date, (r: any) => ({ skipped: [...new Set([...(r.skipped ?? []), id])] }));
    e!.clearToast();
    const after = driveQueue(e!.plan, k);
    const shut = after.stops.find((x: any) => x.id === id)?.stop.openAtArrival === false;
    const others = replanSummary(before.plan, e!.plan, { id, name });
    if (after.current?.id === id) return setUndo({ before: null, text: `${name} couldn't move: it's still the next door.` });
    setUndo({ before, text: `${name} moved to the end of the day.${shut ? " It may be closed by then." : ""}${others ? ` ${others.replace(/\.?$/, ".")}` : ""}` });
  }
  async function pushLate(nd: number) {
    if (!late?.out.length || nd < 0) return;
    const before = e!.snapshot();
    const target = plan.days[nd];
    const n = (await e!.moveLate(k, late.out, nd)) ? late.out.length : 0; // one move, as the dry run
    lateCk.current = null;
    setLateChoosing(false);
    e!.clearToast();
    setUndo({ before: n ? before : null, text: [lateMovedText(n, late.out.length, cap(target.day)), n ? overCapText(e!.plan, target.date) : ""].filter(Boolean).join(" ") });
  }

  // the late banner's Skip (ease audit 3 #2; ui/drive.js skipLate): the doors that don't fit come off this day's route and
  // back on Your list, unlocked (engine skipDoors), one Undo for all
  async function skipLate() {
    const ids: string[] = late?.out ?? [];
    if (!ids.length) return;
    const before = e!.snapshot();
    const off = await e!.skipDoors(q!.day.date, ids, { at: localStamp(new Date()) });
    lateCk.current = null;
    e!.clearToast();
    if (!off || !off.length) return setUndo({ before: null, text: `${plan.venues[ids[0]]?.name ?? "That door"} couldn't come off the day.` });
    setUndo({ before, text: skippedText(e!.plan, off, plan.venues, today) });
  }
  async function removeDoor(how: "later" | "drop") {
    const id = off?.id;
    setOff(null);
    if (!id) return;
    const before = e!.snapshot();
    const name = plan.venues[id]?.name ?? "That door";
    const okDate = await e!.removeStop(id, { drop: how === "drop", at: localStamp(new Date()) });
    e!.clearToast();
    if (!okDate) return setUndo({ before: null, text: `${name} couldn't come off the day.` });
    const b = debrief(e!.plan, driveQueue(e!.plan, k), recordOf(e!.plan.drive, q!.day.date));
    const w = [...b.rows, ...b.removed].find((r: any) => r.id === id)?.where;
    setUndo({ before, text: how === "drop" ? `${name} is dropped from the plan.` : `${name} is off ${today ? "today" : "this day"}. ${w ? `${w.text}.` : ""}` });
  }
  async function endMyDay() {
    setOff(null);
    const before = e!.snapshot();
    await e!.endDay(q!.day.date, { ids: leftToday(q), at: localStamp(new Date()) });
    e!.clearToast();
    setViewId(null);
    setScreen("door");
    setEndBefore(before);
    setUndo({ before, text: "Day ended." });
  }
  const undoEnd = () => { const b = endBefore; setEndBefore(null); setUndo(null); if (b) e!.restore(b); setUndo({ before: null, text: "Undone: the day is back on." }); };
  // "Choose another day": End my day's doors to that plan day instead, with Undo (ui/drive.js rollTo)
  async function rollTo(to: string) {
    const before = e!.snapshot();
    const ok = await e!.rollDay(q!.day.date, to);
    e!.clearToast();
    if (!ok) return setUndo({ before: null, text: "They couldn't move to that day." });
    const m = debrief(e!.plan, driveQueue(e!.plan, k), recordOf(e!.plan.drive, q!.day.date)).moved;
    setUndo({ before, text: m?.text ?? `Moved to ${niceDate(to)}.` });
  }
  // the debrief's one-tap follow-up: the outcome as logged, with that day added
  async function book(id: string, day: string) {
    const o = plan.outcomes?.[id];
    const out = makeOutcome({ result: o?.result ?? "followup", followUp: day, who: o?.who ?? "", note: o?.note ?? "", at: o?.at ?? localStamp(new Date()) });
    if ((out as any).error) return;
    const before = e!.snapshot();
    if (!o) await e!.setStatus(id, "visited");
    await e!.setOutcome(id, out);
    setEndBefore(null); // a restore would take the follow-up back too
    e!.clearToast();
    setUndo({ before, text: `${plan.venues[id]?.name ?? "That door"}: follow up ${niceDate(day)}.` });
  }
  const submit = async () => {
    if (!sheet || sheet.busy) return;
    const t = doneText.current.trim();
    if (!t) return setSheet({ ...sheet, ask: "Say or type how it went." });
    if (isSkip(t)) { setSheet(null); return skip(sheet.id); }
    setSheet({ ...sheet, text: t, busy: true, ask: null });
    const r: Result = await sharedLogVisit(t, ctxFor(sheet.id), e.demo ? { fetch: null } : { fetch: workerFetch });
    if (!r.ok) {
      setSheet((x) => x && { ...x, busy: false, ask: r.ask ?? "How did it go: interested, follow up, or not interested?" });
      say(r.ask ?? "How did it go?");
      return;
    }
    const fit = fitHours(r, ctxFor(sheet.id));
    setSheet((x) => x && { ...x, busy: false, result: fit.r, alt: fit.alt, noDay: fit.noDay });
    tour.sig("driveRead");
    say(speechOf(fit.r, sheet.id));
  };
  const quick = (kind: "visited" | "interested" | "followup" | "someone" | "no") => {
    if (!sheet) return;
    const ctx = ctxFor(sheet.id);
    const at = localStamp(new Date());
    const outcome = kind === "visited" ? null : makeOutcome({ result: kind, followUp: kind === "followup" ? comeBack(sheet.id).date : "", at });
    const nx = ctx.next[0];
    const fit = fitHours({ ok: true as const, source: "rules", visit: { status: "visited", outcome }, say: `Logged ${ctx.stop.name}: ${sayOutcome(outcome).replace(/\.$/, "")}.${nx ? ` Next: ${nx.name}.` : ""}` }, ctx);
    setSheet({ ...sheet, result: fit.r, alt: fit.alt, noDay: fit.noDay, ask: null });
    say(speechOf(fit.r, sheet.id));
  };
  // res: the no-day version of a closed-day follow-up (fix11, judge 6 #2: 'Save with no day yet')
  const save = async (res?: any) => {
    if (!sheet?.result) return;
    const r = res ?? sheet.result;
    const id = sheet.id;
    const before = e.snapshot();
    setSheet(null);
    setViewId(null);
    await e.setStatus(id, r.visit.status);
    await e.setOutcome(id, r.visit.outcome ?? null);
    // door notes: what the rep said at Done stays on the door (the stop's Notes, the next visit)
    const vn = visitNote(r.visit.outcome, { notes: notesOf(e.plan.slots, id), by: "drive" });
    if (vn) e.setSlot(id, vn);
    e.clearToast();
    setToastOpen(false);
    // a visit that moves doors on another day says so (ui/drive.js replanSummary); a declined offer keeps the facts, not the question
    const moved = replanSummary(before.plan, e.plan, { id, name: e.plan?.venues?.[id]?.name });
    setUndo({ before, note: vn ? { id, nid: vn.id } : null, text: `${keptText(r.say.replace(/ Next: .*$/, ""))}${moved ? ` ${moved.replace(/\.?$/, ".")}` : ""}` });
    tour.sig("driveSaved");
  };
  const doUndo = () => {
    if (!undo) return;
    const b = undo.before;
    const n = undo.note;
    setUndo(null);
    if (b) e.restore(b);
    if (n) e.setSlot(n.id, { note: n.nid, drop: true }); // the snapshot holds no slots: the visit's note goes too
    if (n && !b) setUndo({ before: null, text: "Undone: that note is gone." }); // a note on its own (the door card's)
  };
  const resetDemo = async () => {
    setUndo(null);
    await openDemo({ fresh: true });
    nav.reset([{ name: "home" }, { name: "plan", params: { demo: true } }, { name: "drive", params: { demo: true } }]);
  };
  const t = sheet ? null : null;
  void t;
  if (tour.on) {
    tour.handlers.driveDone = openSheet;
    tour.handlers.driveLog = logBox;
    tour.handlers.driveSave = save;
  }
  const fu = sheet ? comeBack(sheet.id) : { date: defaultFollowUp(plan.windows ?? [], fuFrom()), planDay: true };

  // mobile2 10-24: the header's lines are capped lower than the door's (title 1.2x, grey lines 1.15x, tabs 1.3x), so at AX
  // sizes on an SE the door name still shows above the footer
  return (
    <View style={st.shell} testID="drive">
      <Top>
        {/* intuit audit #2, the web's words (lib/drive-day.js): a previewed day leads with the day, then says it's ahead of time */}
        {/* intuit 1b #1 (mobile2 10-24): on a short screen (SE) a previewed day is two lines, "Wed Oct 28 · 2 of 8
            done" and "Preview: today is Sat Oct 24", so the door's name and opener show above Running late */}
        {today ? null : <Text style={st.dayTitle} testID="day-title" accessibilityRole="header" maxFontSizeMultiplier={1.2}>{shortHead ? shortTitle : W.dayTitle(q.day.date)}</Text>}
        {today ? null : <Text style={ui.muted} testID="day-ahead" maxFontSizeMultiplier={1.15}>{shortHead ? `${String(q.day.date) > String(now.date) ? "Preview" : "A past day"}: today is ${niceDate(now.date)}` : W.notToday(q.day.date, now.date)}</Text>}
        {today || !shortHead ? <Text style={ui.muted} testID="day-label" maxFontSizeMultiplier={1.15} numberOfLines={2}>
          {plan.profile.brand} · {e.c.name} · {today ? "Today · " : ""}{W.progress(q)}
        </Text> : null}
        <View style={st.tabs}>
          <Tab label="Door" on={screen === "door"} onPress={() => (setViewId(null), setScreen("door"))} />
          {q.finished && recordOf(plan.drive, q.day.date).ended ? null : <Tab label={`All ${q.total} stops`} on={screen === "day"} onPress={() => setScreen("day")} /> /* an ended day: the debrief lists every door */}
          <Tab label="Ask" on={screen === "ask"} onPress={() => setScreen("ask")} />
        </View>
      </Top>
      {undo ? (
        <View style={[st.toast, big && st.stack]}>
          {/* mobile2 10-23 (AX5): the words capped at 1.4× and 3 lines, a tap opens the rest in a box that scrolls, so the
              toast never fills a third of the screen */}
          <Pressable style={big ? null : { flex: 1 }} onPress={() => setToastOpen(!toastOpen)} accessibilityRole="button" accessibilityLabel={undo.text}>
            {toastOpen ? (
              <ScrollView style={{ maxHeight: 160 }}><Text style={[st.body, { marginBottom: 0 }]} maxFontSizeMultiplier={1.4}>{undo.text}</Text></ScrollView>
            ) : (
              <Text style={[st.body, { marginBottom: 0 }]} numberOfLines={big ? 3 : 2} maxFontSizeMultiplier={1.4}>{undo.text}</Text>
            )}
            {/* measured: the hint only when the words don't fit their lines (mobile2: it showed on toasts that fit) */}
            <Text style={[st.body, { marginBottom: 0, position: "absolute", opacity: 0, left: 0, right: 0 }]} maxFontSizeMultiplier={1.4} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" onTextLayout={(ev) => setToastLines(ev.nativeEvent.lines.length)}>{undo.text}</Text>
            {!toastOpen && toastLines > (big ? 3 : 2) ? <Text style={st.src} maxFontSizeMultiplier={1.4}>Tap for the whole note</Text> : null}
          </Pressable>
          {undo.before || undo.note ? <Pressable onPress={doUndo} accessibilityRole="button" style={st.toastBtn} testID="drive-undo"><Text style={st.toastBtnText} maxFontSizeMultiplier={1.4}>Undo</Text></Pressable> : <Pressable onPress={() => setUndo(null)} accessibilityRole="button" accessibilityLabel="Dismiss" style={st.toastBtn}><Text style={st.toastBtnText} maxFontSizeMultiplier={1.4}>OK</Text></Pressable>}
        </View>
      ) : null}

      {screen === "door" ? (
        door && v ? (
          <View style={{ flex: 1 }}>
            {/* mobile2 10-24: no 💬 on drive (intuit #9), so no gutter for it: the door card has the full width */}
            <Scroll ref={doorScroll} style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 8 }} testID="current-door">
              {viewed ? (
                <Pressable onPress={() => setViewId(null)} accessibilityRole="button" style={st.viewing}>
                  <Text style={st.viewingText}>Not your current door{door.done ? " (done)" : ""} · Back to {cur ? cur.name : "the day"}</Text>
                </Pressable>
              ) : null}
              {late ? (
                <View style={st.late} testID="drive-late">
                  {/* mobile2 10-24 (ease4 nit): capped (headline 1.2x, why 1.3x), and from 1.15x Skip / End my day come before the why
                      line, so on an SE at AX sizes they stay on screen above the footer */}
                  <Text style={[st.body, { fontWeight: "700" }]} maxFontSizeMultiplier={1.2}>{late.text}</Text>
                  {!offer ? null : offer.noDay || offer.none ? (() => {
                    const why = <Text style={[st.muted, tightFoot && { marginTop: 6 }]} testID={offer.none ? "drive-late-none" : undefined} maxFontSizeMultiplier={1.3}>{offer.none ? LW.none(late.out.length) : LW.noDay(late.out.length)}</Text>;
                    return tightFoot ? <>{lateOut}{why}</> : <>{why}{lateOut}</>;
                  })()
                    : offer.pending ? <Text style={st.muted} testID="drive-late-checking" maxFontSizeMultiplier={1.3}>{LW.checking}</Text>
                    : <>
                        {offer.next ? <Text style={st.muted} testID="drive-late-full" maxFontSizeMultiplier={1.3}>{LW.full(offer.next)}</Text> : null}
                        {/* mobile2 10-23: Move and Choose a day share the row (labels wrap); stacked at big text */}
                        <View key={bigFont ? "big" : "std"} style={[st.quickRow, { flexWrap: bigFont ? "wrap" : "nowrap" }]}>
                          <Small label={LW.move(late.out.length, offer.to.day)} onPress={() => pushLate(offer.to.i)} testID="drive-late-move" style={{ flexBasis: bigFont ? "auto" : 0 }} />
                          {offer.choose.length > 1 ? <Small label={LW.choose} onPress={() => setLateChoosing((x) => !x)} testID="drive-late-choose" style={{ flexBasis: bigFont ? "auto" : 0 }} /> : null}
                        </View>
                        {/* mobile2 10-23: the days two to a row, so the list leaves the door card on screen */}
                        {lateChoosing ? (
                          <View style={st.quickRow} testID="drive-late-picks">
                            {offer.choose.map((x: any) => (
                              <Pressable key={x.date} disabled={x.full} onPress={() => pushLate(x.i)} accessibilityRole="button" accessibilityState={{ disabled: x.full }} accessibilityLabel={a11yLabel(LW.pick(x))} testID={`drive-late-pick-${x.date}`} style={({ pressed }) => [st.small, st.pick, x.full && { opacity: 0.55 }, pressed && { opacity: 0.8 }]}>
                                <Text style={st.smallText} maxFontSizeMultiplier={1.6}>{LW.pick(x)}</Text>
                              </Pressable>
                            ))}
                          </View>
                        ) : null}
                      </>}
                </View>
              ) : null}
              {!viewed && tightFoot ? <View style={{ marginBottom: 8 }}>{lateCtl()}</View> : null}
              <Text style={st.kicker} maxFontSizeMultiplier={1.3} /* mobile2 10-24: capped, so at AX sizes the door name stays above the fold on an SE */>Stop {door.n} of {q.total} · planned {clock(door.eta)}{(() => { const fu = returnVisitLabel(door.stop, q.day, plan.outcomes?.[door.id]); return fu ? ` · ${fu}` : ""; })() /* fix7: says the day she said when the planner moved it */}</Text>
              <Text style={st.name} accessibilityRole="header" maxFontSizeMultiplier={1.4}>{v.name}</Text>
              <Text style={st.body}>{v.address ? addressLine(v.address, plan.city?.name ?? plan.profile?.cityName) : v.neighborhood ?? ""}</Text>
              <Text style={st.muted}>{legText(door.stop)}{dm?.hoursToday ? ` · ${dm.hoursToday}` : ""}{dm?.hoursToday && door.stop.openAtArrival === false ? <Text style={st.closed} testID="drive-closed"> · {openTill(door.stop, { parsed: parseHours(v.hours), day: q.day.day })}</Text> : null}</Text>
              {plan.outcomes[door.id] ? <Text style={[st.muted, { marginTop: 8 }]}>Last time: {outcomeText(plan.outcomes[door.id])}</Text> : null}
              {/* audit 2 #8: what to say right under the door; the reasons and your notes after it */}
              {dm ? (
                <View style={st.sect} testID="door-say">
                  <Text style={st.sectH} accessibilityRole="header">Opener</Text>
                  <Text style={[st.body, st.opener]}>{dm.opener}</Text>
                  {dm.toBuyer ? <><View style={st.sectRow}><Text style={st.sectH2} accessibilityRole="header">To the buyer</Text></View><Text style={[st.body, st.opener]} testID="drive-tobuyer">{dm.toBuyer}</Text></> : null}
                  {/* intuit audit #4: no source chips in the field; each line's source is on the door's Talking points */}
                  {dm.questions.length ? (
                    <>
                      <View style={st.sectRow}><Text style={st.sectH2} accessibilityRole="header">Questions</Text></View>
                      {dm.questions.map((x: any, i: number) => <View key={i} style={{ marginBottom: 4 }}><Text style={st.body}>• {x.text}</Text></View>)}
                    </>
                  ) : null}
                  <View style={st.sectRow}><Text style={st.sectH2} accessibilityRole="header">The ask</Text></View>
                  <Text style={st.body}>{cap(dm.ask)}.</Text>
                  {reading ? (
                    <View style={{ flexDirection: "row", gap: 8 }} testID="drive-reading">
                      <Small icon="voice" label="Reading…" a11y="Reading it to you" onPress={() => {}} style={st.smallOn} />
                      <Small label="Stop" a11y="Stop reading" onPress={() => { stopSpeaking(); setReading(false); }} style={{ flexGrow: 0, minWidth: 88 }} testID="drive-read-stop" />
                    </View>
                  ) : (
                    <Small icon="voice" label="Read it to me" testID="drive-read" onPress={() => readIt(`${dm.opener} ${dm.toBuyer ? `To the buyer: ${dm.toBuyer} ` : ""}${dm.questions.map((x: any) => x.text).join(" ")} The ask: ${dm.ask}.`)} />
                  )}
                </View>
              ) : <Text style={[st.muted, { marginTop: 12 }]}>Loading what to say…</Text>}
              {door.stop.orderReason ? <Text style={[st.muted, { marginTop: 8 }]}>Why now: {door.stop.orderReason}</Text> : null}
              {dm?.crowd || dm?.whyLine ? (
                <View style={st.sect} testID="door-why">
                  {dm.crowd ? <><Text style={st.sectH} accessibilityRole="header">{dm.crowd.title}</Text><Text style={st.body}>{dm.crowd.text}</Text></> : null}
                  {dm.whyLine ? <><Text style={[st.sectH2, dm.crowd && { marginTop: 8 }]} accessibilityRole="header">Why this door</Text><Text style={st.src}>{dm.whyLine}</Text></> : null}
                </View>
              ) : null}
              {(() => { const ns = notesOf(plan.slots, door.id); return (
                <View style={[st.sect, { borderLeftWidth: 4, borderLeftColor: "#E07B2A" }]} testID="door-notes">
                  <Text style={st.sectH} accessibilityRole="header">Your notes</Text>
                  {ns.slice(0, 3).map((n: any) => <Text key={n.id} style={st.body}>• {n.text} <Text style={st.src}>{n.who}</Text></Text>)}
                  {ns.length > 3 ? <Text style={st.src}>{ns.length - 3} more on the stop</Text> : null}
                  {MIC && !e.demo ? <MicButton mic={{ ...noteMic, toggle: () => { if (noteMic.phase === "idle") noteFor.current = door.id; noteMic.toggle(); } }} wide idle="Tap and say a note" testID="note-mic" /> : null}
                  {noteMic.note ? <Text style={[st.body, st.ask]} accessibilityLiveRegion="polite" testID="note-mic-note">{noteMic.note}</Text> : null}
                  {noteBox == null ? (
                    <Pressable onPress={() => { noteMic.clearNote(); setNoteBox(""); }} accessibilityRole="button" testID="note-type" style={{ minHeight: 44, justifyContent: "center", marginTop: 4 }}>
                      <Text style={{ color: C.green, fontWeight: "700", fontSize: 16 }} maxFontSizeMultiplier={1.6}>{MIC && !e.demo ? "Or type a note" : "Add a note"}</Text>
                    </Pressable>
                  ) : (
                    <>
                      <TextInput accessibilityLabel={`Add a note on ${v.name}`} testID="note-new" style={[st.input, { minHeight: 64 }]} multiline maxLength={300} autoFocus value={noteBox} onChangeText={setNoteBox}
                        placeholder="Add a note: the manager is Priya, back Thursdays" placeholderTextColor={C.ph} />
                      <View style={st.quickRow}>
                        <Small label="Save note" onPress={() => { if (addNote(door.id, noteBox)) setNoteBox(null); }} testID="note-save" />
                        <Small label="Cancel" onPress={() => setNoteBox(null)} />
                      </View>
                    </>
                  )}
                </View>
              ); })()}
              {then && !viewed ? <Text style={[st.muted, { marginTop: 8 }]}>{W.then(then)}</Text> : !viewed ? <Text style={[st.muted, { marginTop: 8 }]}>Last door of the day</Text> : null}
              {!viewed && then ? <View style={{ marginTop: 12 }}><Small label={recordOf(plan.drive, q.day.date).skipped.includes(door.id) ? "Skip again" : "Skip for now"} onPress={() => skip()} /></View> : null}
              {!viewed ? (
                <View style={st.quickRow}>
                  <Small label={`Remove from ${today ? "today" : "this day"}`} onPress={() => setOff({ phase: "remove", id: door.id })} testID="drive-remove" />
                  {today ? <Small label="End my day" onPress={() => setOff({ phase: "end", id: null })} testID="drive-end" /> : null}
                </View>
              ) : null}
              <Text style={[st.src, { marginTop: 12 }]}>{W.safe(MIC && !e.demo)}</Text>
            </Scroll>
            <View onLayout={(ev) => setFootH(Math.round(ev.nativeEvent.layout.height))}>
                {!viewed && !tightFoot ? lateCtl() : null}
              <Big label={`Navigate${door.stop.legMi != null ? ` · ${legMiText(door.stop)}` : ""}`} onPress={() => openDirections(v).then(() => setNavApp(savedNavApp()))} cap={tightFoot ? 1.15 : 1.6} />
              <NavWith app={navApp} onChange={setNavApp} />
              <Big label={W.done} tone="go" onPress={openSheet} testID="drive-done" cap={tightFoot ? 1.15 : 1.6} />
              {/* Jard 10-28: always hands-free in drive mode. Voice on and the app's mic: the Agent listens from the start,
                  under the door (never in the guided demo: no live calls) */}
              {voice && MIC && !e.demo ? (
                <HandsFreeBar chat={chatFor(e)} context={() => ({ current: cur?.id ?? null, dayIndex: k, mode: "drive" })} offline={!!e.demo}
                  held={reads > 0 || !!sheet || doneMic.phase !== "idle" || noteMic.phase !== "idle"} muted={hfMuted} onMute={setHfMuted}
                  onType={() => { setHfMuted(true); setScreen("ask"); }}
                  onLate={(by) => { if (q) setLateSaid({ date: q.day.date, by }); setLatePicking(false); setViewId(null); }} />
              ) : null}
            </View>
          </View>
        ) : (
          <DayDone plan={plan} q={q} k={k} onBook={book} onDrop={(id) => (setEndBefore(null), e.setStatus(id, "notfit"))} onPreview={(d) => setDate(d)}
            onBack={() => nav.back()} demo={!!e.demo} onReset={resetDemo} onUndoEnd={endBefore ? undoEnd : null} onRoll={rollTo}
            onAddDay={() => nav.push("form", e.demo ? { demo: true } : { edit: e.key })} />
        )
      ) : screen === "ask" ? (
        <ChatView chat={chatFor(e)} /* spec §6: the greeting, no suggestions; mode drive: short, spoken (Voice on) */
          context={() => ({ current: cur?.id ?? null, dayIndex: k, mode: "drive" })} onReply={(m) => say(m.text)} voiced={voice} onOpen={(id) => { setViewId(id); setScreen("door"); }}
          onLate={(by) => { if (q) setLateSaid({ date: q.day.date, by }); setLatePicking(false); setViewId(null); setScreen("door"); }} /* ease audit 2 #3 */ />
      ) : (
        <View style={{ flex: 1 }}>
          <View style={{ flex: 1, minHeight: 220, marginBottom: 8 }}>
            <DayMap
              day={q.day}
              stops={q.stops.map((x: any) => ({ id: x.id, n: x.n, name: x.name, eta: clock(x.eta), done: x.done, venue: x.venue ? { lat: +x.venue.lat, lon: +x.venue.lon } : null }))}
              currentId={cur?.id ?? null}
              road={road?.solid ? { coords: road.coords, label: road.label } : null}
              onOpen={(id) => (setViewId(id), setScreen("door"))}
            />
          </View>
          <List style={{ flex: 1 }} data={q.stops} keyExtractor={(x: any) => x.id}
            renderItem={({ item }: { item: any }) => {
              const here = item.id === cur?.id;
              const o = plan.outcomes[item.id];
              return (
                <Pressable onPress={() => (setViewId(item.id), setScreen("door"))} style={[st.row, here && st.rowHere]} accessibilityRole="button" accessibilityLabel={`Stop ${item.n}, ${item.name}, ${clock(item.eta)}${item.done ? ", done" : here ? ", current" : ""}${o ? `, ${outcomeText(o)}` : ""}`}>
                  <Text style={st.rowN}>{item.n}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[st.rowName, item.done && st.rowDone]}>{item.name}</Text>
                    <Text style={st.muted}>{clock(item.eta)}{item.venue?.neighborhood ? ` · ${item.venue.neighborhood}` : ""}{plan.statuses[item.id] ? ` · ${plan.statuses[item.id]}` : ""}{o ? ` · ${outcomeText(o)}` : ""}</Text>
                  </View>
                </Pressable>
              );
            }} />
        </View>
      )}

      {off ? (
        <View style={st.sheetWrap} accessibilityViewIsModal onAccessibilityEscape={() => setOff(null)}>
          <View style={st.sheet} testID="off-sheet">
            <ScrollView>
              {off.phase === "remove" ? (
                <>
                  <Text style={st.h1} maxFontSizeMultiplier={1.6}>Remove {plan.venues[off.id!]?.name ?? "this door"}?</Text>
                  <Text style={st.body}>Skip for now only moves it to the end of the day. This takes it off for good.</Text>
                  <Big label={`Off ${today ? "today" : "this day"}: Doors puts it on another day if it fits`} onPress={() => removeDoor("later")} testID="drive-rm-later" />
                  <Big label={W.drop(plan.venues[off.id!]?.name ?? "it")} onPress={() => removeDoor("drop")} testID="drive-rm-drop" />
                </>
              ) : (() => {
                const left = q.stops.filter((x: any) => !x.done);
                return (
                  <>
                    <Text style={st.h1} maxFontSizeMultiplier={1.6}>End your day now?</Text>
                    <Text style={st.body}>{endSheetText(plan, left.map((x: any) => x.id), q.day.date)}</Text>
                    <Big label="End my day" tone="go" onPress={endMyDay} testID="drive-end-ok" />
                    <Big label="Keep going" onPress={() => setOff(null)} />
                  </>
                );
              })()}
              <Pressable onPress={() => setOff(null)} style={{ alignSelf: "center", padding: 12 }} accessibilityRole="button"><Text style={st.muted}>Cancel</Text></Pressable>
            </ScrollView>
          </View>
        </View>
      ) : null}
      {sheet ? (
        <View style={st.sheetWrap} accessibilityViewIsModal onAccessibilityEscape={closeSheet}>
          <View style={[st.sheet, { maxHeight: "100%" }]} testID="done-sheet">
            <ScrollView ref={sheetScroll} keyboardShouldPersistTaps="handled">
              <Text style={st.h1} maxFontSizeMultiplier={1.6}>{W.sheetTitle(sheet.name)}</Text>
              {sheet.result ? (
                <>
                  <Text style={st.body} testID="read-back">{sheet.result.say}</Text>
                  <Text style={st.muted}>{W.readBy(sheet.result.source)}</Text>
                  {sheet.alt ? <Big label={`Make it ${altLabel(sheet.alt, " instead")}`} onPress={() => { const r2 = movedDriveResult(sheet.result, plan.venues?.[sheet.id], sheet.alt, { next: ctxFor(sheet.id).next[0]?.name ?? "" }); setSheet({ ...sheet, result: r2, alt: null }); say(speechOf(r2, sheet.id)); }} testID="drive-fualt" /> : null}
                  <Big label={W.save} tone="go" onPress={() => save()} testID="drive-save" />
                  {sheet.noDay ? <Big label="Save with no day yet" onPress={() => save(sheet.noDay)} testID="drive-noday" /> : null}
                  <Big label="Say it again" onPress={() => say(speechOf(sheet.result!, sheet.id))} />
                  <Big label="Change it" onPress={() => setSheet({ ...sheet, result: null, alt: null })} />
                </>
              ) : (
                <>
                  <Text style={st.muted} maxFontSizeMultiplier={1.3}>{MIC && !e.demo ? "Tap the mic and say it" : "Say it or type it"}: "liked it, come back Thursday at 3, hesitant about price".</Text>
                  {MIC && !e.demo ? <MicButton mic={doneMic} wide idle="Tap and say how it went" testID="done-mic" /> : null}
                  {doneMic.note ? <Text style={[st.body, st.ask]} accessibilityLiveRegion="polite" testID="done-mic-note">{doneMic.note}</Text> : null}
                  <TextInput key={doneKey} accessibilityLabel="What happened" testID="done-text" style={[st.input, { height: grow(6, 0.3), minHeight: 96 }]}
                    onEndEditing={(ev) => (doneText.current = ev.nativeEvent.text)}
                    onLayout={(ev) => (doneBoxY.current = ev.nativeEvent.layout.y)}
                    onFocus={() => setTimeout(() => sheetScroll.current?.scrollTo({ y: Math.max(0, doneBoxY.current - 8), animated: true }), 300)}
                    defaultValue={doneText.current}
                    onChangeText={noOnChange ? undefined : (x) => { doneText.current = x; if (x.length > 300 || doneLen > 300) setDoneLen(x.length); }}
                    placeholder={MIC && !e.demo ? "Or type how it went" : "How it went"} multiline scrollEnabled autoFocus={!(MIC && !e.demo)} maxLength={400} returnKeyType="done" submitBehavior="blurAndSubmit"
                    onSubmitEditing={(ev) => { doneText.current = ev.nativeEvent.text; submit(); }} />
                  {doneLen > 300 ? <Text style={[st.muted, doneLen >= 400 && st.ask]}>{doneLen >= 400 ? "That's the most one log takes (400). Log it, then add the rest in Ask." : `${doneLen}/400`}</Text> : null}
                  {sheet.ask ? <Text style={[st.body, st.ask]}>{sheet.ask}</Text> : null}
                  <Big label={sheet.busy ? "Reading…" : "Log it"} tone="go" onPress={logBox} testID="drive-log" />
                  <View style={st.quickRow}>
                    <Small label={QUICK_TEXT.interested} onPress={() => quick("interested")} />
                    <Small label={`${QUICK_TEXT.followup(fu.date)}${fu.planDay ? "" : " (not a plan day)"}`} onPress={() => quick("followup")} />
                    <Small label={QUICK_TEXT.someone} onPress={() => quick("someone")} />
                    <Small label={QUICK_TEXT.no} onPress={() => quick("no")} />
                    <Small label={QUICK_TEXT.visited} onPress={() => quick("visited")} />
                  </View>
                </>
              )}
              <Pressable onPress={closeSheet} style={{ alignSelf: "center", padding: 12 }} accessibilityRole="button"><Text style={st.muted}>Cancel</Text></Pressable>
            </ScrollView>
          </View>
        </View>
      ) : null}
    </View>
  );
}

// Doors Agent ability 9 (ui/drive.js polishHTML): on the rep's tap, the day's facts rewritten into polished notes and
// next steps (one model call, facts only); the template debrief around it always stays
function DayPolish({ plan, q }: { plan: any; q: any }) {
  const [state, setState] = useState<{ date: string; busy: boolean; view?: any } | null>(null);
  const date = q.day.date;
  const pl = state?.date === date ? state : null;
  const run = async () => {
    if (pl?.busy) return;
    setState({ date, busy: true });
    let r: any = null;
    try {
      const res = await workerFetch(POLISH_PATH, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(polishBody(plan, q, recordOf(plan.drive, date))) }, 30000);
      r = await res.json().catch(() => null);
    } catch {}
    setState({ date, busy: false, view: polishView(r) });
  };
  if (!pl) return <Pressable onPress={run} accessibilityRole="button" style={st.chip} testID="db-polish"><Text style={st.chipText} maxFontSizeMultiplier={1.5}>{POLISH_LABEL}</Text></Pressable>;
  if (pl.busy) return <Text style={[st.muted, { marginTop: 8 }]} accessibilityLiveRegion="polite" testID="db-polishing">{POLISH_BUSY}</Text>;
  const v = pl.view;
  if (v.failed) return (
    <View style={{ marginTop: 8 }} testID="db-polish-failed"><Text style={st.muted} accessibilityLiveRegion="polite">{v.failed}</Text>
      <Pressable onPress={run} accessibilityRole="button" style={st.chip}><Text style={st.chipText} maxFontSizeMultiplier={1.5}>Try again</Text></Pressable></View>
  );
  return (
    <View style={st.sect} testID="db-polished">
      <Text style={st.sectH} accessibilityRole="header">Doors Agent's notes</Text>
      {v.summary ? <Text style={st.body}>{v.summary}</Text> : null}
      {v.doors.map((d: any) => <View key={d.id} style={st.step}><Text style={st.rowName}>{d.name}</Text><Text style={st.muted}>{d.note}</Text></View>)}
      {v.next.length ? <Text style={st.sectH} accessibilityRole="header">Next</Text> : null}
      {v.next.map((x: string, i: number) => <View key={i} style={st.step}><Text style={st.muted}>{x}</Text></View>)}
      <Text style={[st.muted, { fontSize: 13 }]}>{POLISH_FOOT}{v.model ? ` ${v.model}.` : ""}</Text>
    </View>
  );
}

// Day done (Jard 10-23, items 7-9; ui/drive.js doneHTML): an assistant's debrief of the day, from what was logged and
// nothing else. Every door counted once in the logging answers' words; a door opens to its notes; next steps first.
function DayDone({ plan, q, k, onBook, onDrop, onPreview, onBack, demo, onReset, onUndoEnd, onRoll, onAddDay }: { plan: any; q: any; k: number; onBook: (id: string, d: string) => void; onDrop: (id: string) => void; onPreview: (d: string) => void; onBack: () => void; demo: boolean; onReset: () => void; onUndoEnd: (() => void) | null; onRoll: (to: string) => void; onAddDay: () => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const b = debrief(plan, q, recordOf(plan.drive, q.day.date));
  const opts = { windows: plan.windows ?? [], visitMin: plan.profile?.visitMin ?? 25, from: q.day.date };
  const bookOf = (x: any) => bookDay(x, plan.venues?.[x.id], opts) ?? comeBackDay(plan.venues?.[x.id], opts).date;
  void k;
  return (
    <Scroll style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 16 }} testID="drive-finished">
      <Text style={st.kicker} maxFontSizeMultiplier={1.3}>Day done · {b.dateText}</Text>
      <Text style={st.name} accessibilityRole="header" maxFontSizeMultiplier={1.6}>{b.title}</Text>
      <Text style={st.body}>{b.sub}</Text>
      {b.counts.length ? (
        <View style={st.counts} accessibilityLabel={b.counts.map((c: any) => `${c.n} ${c.label}`).join(", ")}>
          {b.counts.map((c: any) => <View key={c.key} style={[st.count, c.key === "notvisited" && { borderStyle: "dashed" }]}><Text style={st.countText} maxFontSizeMultiplier={1.5}><Text style={st.countN}>{c.n}</Text> {c.label}</Text></View>)}
        </View>
      ) : null}
      {!demo ? <DayPolish plan={plan} q={q} /> : null}
      {b.moved || b.booked.length || b.suggest.length || b.next ? (
        <View style={st.sect} testID="db-next">
          <Text style={st.sectH} accessibilityRole="header">Next steps</Text>
          {b.moved ? (
            <View style={st.step} testID="db-moved"><Text style={st.rowName}>{b.moved.head}</Text><Text style={st.muted}>{b.moved.body}{b.moved.cap ? ` ${b.moved.cap}` : ""}</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {onUndoEnd ? <Pressable onPress={onUndoEnd} accessibilityRole="button" style={st.chip} testID="db-undo"><Text style={st.chipText} maxFontSizeMultiplier={1.5}>Undo</Text></Pressable> : null}
                {b.moved.choose.length ? <Pressable onPress={() => setChoosing(!choosing)} accessibilityRole="button" accessibilityState={{ expanded: choosing }} style={st.chip} testID="db-choose"><Text style={st.chipText} maxFontSizeMultiplier={1.5}>Choose another day</Text></Pressable> : null}
                {b.moved.none ? <Pressable onPress={onAddDay} accessibilityRole="button" style={st.chip} testID="db-addday"><Text style={st.chipText} maxFontSizeMultiplier={1.5}>Add a day</Text></Pressable> : null}
              </View>
              {choosing ? <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }} accessibilityLabel="Move them to">
                {b.moved.choose.map((x: any) => <Pressable key={x.date} onPress={() => (setChoosing(false), onRoll(x.date))} accessibilityRole="button" style={st.chip} testID={`db-roll-${x.date}`}><Text style={st.chipText} maxFontSizeMultiplier={1.5}>{niceDate(x.date)}</Text></Pressable>)}
              </View> : null}
            </View>
          ) : null}
          {b.booked.map((x: any) => <View key={`b${x.id}`} style={st.step}><Text style={st.rowName}>{x.name}</Text><Text style={st.muted}>Follow up {x.text}</Text></View>)}
          {b.suggest.slice(0, 4).map((x: any) => { const d = bookOf(x); return (
            <View key={`s${x.id}`} style={st.step}><Text style={st.rowName}>{x.name}</Text><Text style={st.muted}>{x.text}</Text>
              {d ? <Pressable onPress={() => onBook(x.id, d)} accessibilityRole="button" style={st.chip} testID={`db-book-${x.id}`}><Text style={st.chipText} maxFontSizeMultiplier={1.5}>Follow up {niceDate(d)}</Text></Pressable> : null}</View>
          ); })}
          {b.next ? <View style={st.step}><Text style={st.rowName}>{niceDate(b.next.date)}</Text><Text style={st.muted}>{b.next.text}</Text>
            <Pressable onPress={() => onPreview(b.next.date)} accessibilityRole="button" style={st.chip}><Text style={st.chipText} maxFontSizeMultiplier={1.5}>Preview</Text></Pressable></View> : null}
        </View>
      ) : null}
      {b.rows.length ? (
        <View style={st.sect} testID="db-doors">
          <Text style={st.sectH} accessibilityRole="header">Every door{b.total > 1 ? ` (${b.total})` : ""}</Text>
          {b.rows.map((r: any) => {
            const on = open === r.id;
            return (
              <View key={r.id} style={[st.dbRow, r.bucket === "notvisited" && { borderStyle: "dashed" }]}>
                <Pressable onPress={() => setOpen(on ? null : r.id)} accessibilityRole="button" accessibilityState={{ expanded: on }} accessibilityLabel={`${r.name}, ${r.label}${r.detail ? `, ${r.detail}` : ""}${r.notes.length ? `, ${r.notes.length} note${r.notes.length === 1 ? "" : "s"}` : ""}`} style={{ flexDirection: "row", gap: 10, alignItems: "center", minHeight: 44 }} testID={`db-row-${r.id}`}>
                  <Text style={st.rowN}>{r.n ?? "–"}</Text>
                  <View style={{ flex: 1 }}><Text style={st.rowName}>{r.name}</Text><Text style={st.muted}>{r.label}{r.detail ? ` · ${r.detail}` : ""}</Text></View>
                  {r.notes.length && !on ? <Text style={st.src}>{r.notes.length === 1 ? "1 note" : `${r.notes.length} notes`}</Text> : null}
                </Pressable>
                {on ? (
                  <View style={{ marginLeft: 34, marginTop: 6 }}>
                    {r.notes.length ? r.notes.map((n: any) => <Text key={n.id} style={st.body}>• {n.text} <Text style={st.src}>{n.who}</Text></Text>) : r.bucket === "notvisited" ? null : <Text style={st.muted}>No notes from this visit.</Text>}
                    {r.bucket === "notvisited" && plan.statuses?.[r.id] !== "notfit" ? <Pressable onPress={() => onDrop(r.id)} accessibilityRole="button" style={st.chip}><Text style={st.chipText} maxFontSizeMultiplier={1.5}>Drop it from the plan</Text></Pressable> : null}
                  </View>
                ) : null}
              </View>
            );
          })}
        </View>
      ) : null}
      {b.removed.length ? (
        <View style={st.sect} testID="db-removed">
          <Text style={st.sectH} accessibilityRole="header">Removed from {q.day.date === nowStamp().date ? "today" : "this day"} ({b.removed.length})</Text>
          {b.removed.map((r: any) => (
            <View key={r.id} style={[st.dbRow, { borderStyle: "dashed" }]} accessible accessibilityLabel={`${r.name}, ${r.detail}`} testID={`db-removed-${r.id}`}>
              <View style={{ flexDirection: "row", gap: 10, alignItems: "center", minHeight: 44 }}>
                <Text style={st.rowN}>–</Text>
                <View style={{ flex: 1 }}><Text style={st.rowName}>{r.name}</Text><Text style={st.muted}>{r.detail}</Text></View>
              </View>
            </View>
          ))}
        </View>
      ) : null}
      {demo ? <Big label="Start the demo day over" onPress={onReset} /> : null}
      <Big label="Back to the plan" onPress={onBack} />
    </Scroll>
  );
}
function Tab({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[st.tab, on && st.tabOn]} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: on }}>
      <Text style={[st.tabText, on && st.tabTextOn]} maxFontSizeMultiplier={1.3}>{label}</Text>
    </Pressable>
  );
}
function Big({ label, onPress, tone, testID, cap = 1.6 }: { label: string; onPress: () => void; tone?: "go"; testID?: string; cap?: number }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={a11yLabel(label)} testID={testID} style={({ pressed }) => [st.big, tone === "go" && st.bigGo, pressed && { opacity: 0.8 }]}>
      <Text style={st.bigText} maxFontSizeMultiplier={cap}>{label}</Text>
    </Pressable>
  );
}
// owner 10-23: which app Navigate opens, and a way to change it (remembered)
function NavWith({ app, onChange }: { app: NavApp | null; onChange: (k: NavApp) => void }) {
  return (
    <Pressable onPress={() => chooseNavApp(onChange)} accessibilityRole="button" accessibilityLabel={`Navigation app: ${navAppName(app)}. Change`} testID="nav-app" hitSlop={6} style={{ minHeight: 44, justifyContent: "center", alignItems: "center" }}>
      <Text style={st.src} maxFontSizeMultiplier={1.6}>Opens {navAppName(app)} · <Text style={{ color: C.green, fontWeight: "700" }}>Change</Text></Text>
    </Pressable>
  );
}
// The hands-free Doors Agent (the web's ui/handsfree.js): a bar under the door, listening from the moment drive mode
// opens (src/mic.ts useMic wait: nothing sent until the rep speaks), through quiet gaps and after each answer. When the
// words are in, a short canned line says the Agent got them at once (src/voice.ts ack: a bundled Aura-2 clip) while
// the model works; the answer is read in the Aura-2 voice (speakAndWait), then it listens again. held (a read-aloud,
// the Done box's or a note's mic, the sheet): the ear closes and comes back after. Mute / Listen; Type instead → the
// Ask tab. The turn is the drive chat's own (chatFor), so it is in the history with its changes.
type HFPhase = "listen" | "read" | "think" | "speak" | "paused" | "muted" | "off";
export const HF_WORDS: Record<HFPhase, { head: string; hint: string }> = {
  listen: { head: "Listening", hint: "Ask about your next stop, or say how a visit went." },
  read: { head: "Listening", hint: "Getting your words…" },
  think: { head: "Working", hint: "" },
  speak: { head: "Speaking", hint: "Tap to stop it and ask something else." },
  paused: { head: "Paused", hint: "Listening again when that's done." },
  muted: { head: "Muted", hint: "Tap to listen again." },
  off: { head: "Not listening", hint: "" },
};
export const HF_NO_ANSWER = "Doors Agent didn't answer. Say it again, or type it.";
export const HF_PHONE_VOICE = "The Doors voice isn't available right now: this is the phone's own voice.";
function HandsFreeBar({ chat, context, held, muted, onMute, onType, onLate, offline }: { chat: Chat; context: () => { current: string | null; dayIndex: number; mode: string }; held: boolean; muted: boolean; onMute: (m: boolean) => void; onType: () => void; onLate?: (by: number) => void; offline: boolean }) {
  const [phase, setPhase] = useState<HFPhase>("muted");
  const [words, setWords] = useState("");
  const [answer, setAnswer] = useState("");
  const [note, setNote] = useState("");
  const run = useRef(0); // each ask / pause / mute: an older turn ends quietly
  const live = useRef(true);
  const heldRef = useRef(held);
  heldRef.current = held;
  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const mic = useMic((said) => ask(said), { wait: true, onMiss: () => listen() });
  const micRef = useRef(mic);
  micRef.current = mic;

  const listen = () => {
    if (!live.current || heldRef.current || mutedRef.current) return;
    setPhase("listen");
    if (micRef.current.phase === "idle") micRef.current.toggle();
  };
  const ask = async (t: string) => {
    const r = ++run.current;
    setWords(t);
    setAnswer("");
    setPhase("think");
    const a = ack(t); // the acknowledgement: said at once, shown while the model works
    setNote(a.text);
    let m: any = null;
    try { m = await chat.send(t, context()); } catch {}
    if (r !== run.current || !live.current) return;
    setNote("");
    if (!m?.text) { setNote(HF_NO_ANSWER); return listen(); }
    if (m.lateBy) onLate?.(m.lateBy);
    setAnswer(m.text);
    setPhase("speak");
    const how = await speakAndWait(m.text, { offline });
    if (r !== run.current || !live.current) return;
    if (how === "device") setNote(HF_PHONE_VOICE);
    listen();
  };
  // held or muted: the ear closes (what it was hearing is dropped); back: it listens again
  useEffect(() => {
    if (held || muted) {
      run.current++;
      if (micRef.current.phase === "listen") micRef.current.cancel();
      if (phaseRef.current === "speak") stopSpeaking();
      setPhase(muted ? "muted" : "paused");
    } else listen();
  }, [held, muted]);
  useEffect(() => { if (mic.phase === "read" && phaseRef.current === "listen") setPhase("read"); }, [mic.phase]);
  useEffect(() => { if (mic.note) { setNote(mic.note); setPhase("off"); } }, [mic.note]);
  useEffect(() => () => { live.current = false; }, []);

  // the big button: listening → done talking (what was said goes now); speaking → stop it and listen; muted, paused
  // or a problem → listen again
  const tap = () => {
    if (phase === "listen") return micRef.current.toggle();
    if (phase === "speak") { run.current++; stopSpeaking(); return listen(); }
    if (phase === "muted") return onMute(false);
    if (phase === "off" || phase === "paused") { mic.clearNote(); setNote(""); return listen(); }
  };
  const w = HF_WORDS[phase];
  const hint = phase === "think" || phase === "off" ? note || w.hint : phase === "speak" ? "" : w.hint;
  const on = phase === "listen" || phase === "read";
  const ring = on ? "#6FD394" : phase === "speak" ? "#F3F1EC" : phase === "think" ? "#B9C2BE" : "#2B3833";
  return (
    <View style={hf.bar} accessibilityLabel="Doors Agent, hands-free" testID="drive-handsfree">
      <Pressable onPress={tap} accessibilityRole="button" accessibilityLabel={`Doors Agent: ${w.head}. ${w.hint}`} accessibilityState={{ selected: on }} testID="hf-big"
        style={({ pressed }) => [hf.big, { borderColor: ring, transform: [{ scale: on ? 1 + mic.level * 0.08 : 1 }] }, pressed && { opacity: 0.85 }]}>
        <View style={[hf.dot, { backgroundColor: on ? "#6FD394" : phase === "speak" ? "#F3F1EC" : phase === "think" ? "#B9C2BE" : "#7F8A86" }]} />
        <Text style={hf.head} maxFontSizeMultiplier={1.3} testID="hf-head">{w.head}</Text>
      </Pressable>
      <View style={{ flex: 1, minWidth: 0 }}>
        {hint ? <Text style={hf.hint} maxFontSizeMultiplier={1.5} accessibilityLiveRegion="polite" testID="hf-hint">{hint}</Text> : null}
        {words ? <Text style={hf.words} maxFontSizeMultiplier={1.5} numberOfLines={1}><Text style={hf.youSaid}>YOU SAID  </Text>{words}</Text> : null}
        {answer ? <Text style={hf.answer} maxFontSizeMultiplier={1.5} numberOfLines={3} accessibilityLiveRegion="polite" testID="hf-answer">{answer}</Text> : null}
        {note && phase !== "think" && phase !== "off" ? <Text style={hf.note} maxFontSizeMultiplier={1.5} testID="hf-note">{note}</Text> : null}
        <View style={hf.row}>
          <Pressable onPress={() => onMute(phase !== "muted")} accessibilityRole="button" accessibilityState={{ selected: phase === "muted" }} style={[hf.btn, phase === "muted" && hf.btnOn]} testID="hf-mute"><Text style={[hf.btnText, phase === "muted" && hf.btnTextOn]} maxFontSizeMultiplier={1.3}>{phase === "muted" ? "Listen" : "Mute"}</Text></Pressable>
          <Pressable onPress={onType} accessibilityRole="button" style={hf.btn} testID="hf-type"><Text style={hf.btnText} maxFontSizeMultiplier={1.3}>Type instead</Text></Pressable>
        </View>
      </View>
    </View>
  );
}
const hf = StyleSheet.create({
  bar: { flexDirection: "row", gap: 12, alignItems: "flex-start", backgroundColor: "#0B100E", borderRadius: 18, padding: 12, marginTop: 12 },
  big: { width: 88, height: 88, borderRadius: 44, borderWidth: 3, backgroundColor: "#1E3328", alignItems: "center", justifyContent: "center", gap: 4, alignSelf: "center" },
  dot: { width: 16, height: 16, borderRadius: 8 },
  head: { color: "#F3F1EC", fontSize: 13, fontWeight: "700", textAlign: "center" },
  hint: { color: "#B9C2BE", fontSize: 14, lineHeight: 19 },
  words: { color: "#B9C2BE", fontSize: 13, marginTop: 2 },
  youSaid: { color: "#7F8A86", fontSize: 11, fontWeight: "600" },
  answer: { color: "#F3F1EC", fontSize: 16, lineHeight: 22, marginTop: 2 },
  note: { color: "#FFC48F", fontSize: 13, marginTop: 2 },
  row: { flexDirection: "row", gap: 8, marginTop: 8 },
  btn: { minHeight: 40, paddingHorizontal: 14, borderRadius: 999, borderWidth: 1, borderColor: "#2B3833", backgroundColor: "#18211E", alignItems: "center", justifyContent: "center" },
  btnOn: { backgroundColor: "#F3F1EC", borderColor: "#F3F1EC" },
  btnText: { color: "#F3F1EC", fontSize: 14, fontWeight: "600" },
  btnTextOn: { color: "#0B100E" },
});

function Small({ label, onPress, testID, style, a11y, cap = 1.6, icon }: { icon?: "voice"; label: string; onPress: () => void; testID?: string; style?: any; a11y?: string; cap?: number }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={a11y ?? a11yLabel(label)} testID={testID} style={({ pressed }) => [st.small, style, pressed && { opacity: 0.8 }]}>
      {icon ? <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}><Ic name={icon} size={16} color="#1f2a24" /><Text style={st.smallText} maxFontSizeMultiplier={cap}>{label}</Text></View> : <Text style={st.smallText} maxFontSizeMultiplier={cap}>{label}</Text>}
    </Pressable>
  );
}

const st = StyleSheet.create({
  shell: { flex: 1, backgroundColor: "#faf7f2", padding: 16, paddingTop: 8 },
  top: { marginBottom: 12 },
  topRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  back: { fontSize: 17, color: C.green, fontWeight: "700" },
  tabs: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  tab: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 999, backgroundColor: "#ece6dc" },
  tabOn: { backgroundColor: "#1f2a24" },
  tabText: { fontSize: 15, color: "#1f2a24" },
  tabTextOn: { color: "#faf7f2", fontWeight: "600" },
  kicker: { fontSize: 15, color: "#6b6258", marginBottom: 6 },
  name: { fontSize: 34, fontWeight: "700", color: "#1f2a24", marginBottom: 8 },
  h1: { fontSize: 24, fontWeight: "700", color: "#1f2a24", marginBottom: 8 },
  dayTitle: { fontSize: 20, fontWeight: "700", color: "#1f2a24", marginBottom: 2 },
  body: { fontSize: 18, color: "#2c2c2c", marginBottom: 6 },
  muted: { fontSize: 15, color: "#6b6258" },
  closed: { color: C.warn, fontWeight: "700" }, // closed when you get there (the web's .dv-hours b)
  ask: { color: "#8a4b12", fontWeight: "600", marginTop: 8 },
  big: { minHeight: 64, borderRadius: 16, backgroundColor: "#1f2a24", alignItems: "center", justifyContent: "center", marginTop: 12, paddingHorizontal: 12 },
  bigGo: { backgroundColor: "#2f7d4f", minHeight: 88 },
  bigText: { color: "#fff", fontSize: 22, fontWeight: "700", textAlign: "center" },
  small: { flexGrow: 1, minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: "#1f2a24", alignItems: "center", justifyContent: "center", paddingHorizontal: 10, marginTop: 8 },
  smallOn: { backgroundColor: "#CFEFDB", borderColor: "#CFEFDB" }, // Read it to me while it reads
  pick: { flexBasis: "45%", marginTop: 0 }, // two to a row, quickRow's gap between
  smallText: { fontSize: 16, color: "#1f2a24", fontWeight: "600", textAlign: "center" },
  quickRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  input: { borderRadius: 12, borderWidth: 1, borderColor: "#cfc6b8", backgroundColor: "#fff", padding: 12, fontSize: 18, lineHeight: 24, marginTop: 12, textAlignVertical: "top" },
  sheetWrap: { position: "absolute", left: 0, right: 0, top: 0, bottom: 0, justifyContent: "flex-end", backgroundColor: "rgba(31,42,36,0.35)" },
  sheet: { backgroundColor: "#faf7f2", borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, paddingBottom: 24 },
  src: { fontSize: 13, color: "#8a8176", marginTop: 4 },
  sect: { marginTop: 16, paddingTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderColor: "#d9d1c5" },
  sectH: { fontSize: 13, fontWeight: "700", color: "#6b6258", letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 6 },
  sectH2: { fontSize: 13, fontWeight: "700", color: "#6b6258", letterSpacing: 0.6, textTransform: "uppercase" },
  sectRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8, marginTop: 12, marginBottom: 4 },
  opener: { fontSize: 20, lineHeight: 27, color: "#1f2a24", fontWeight: "600" },
  viewing: { backgroundColor: "#fdf1e3", borderRadius: 10, padding: 10, marginBottom: 10 },
  viewingText: { fontSize: 15, color: "#8a4b12", fontWeight: "600" },
  late: { backgroundColor: "#fdf1e3", borderRadius: 12, padding: 12, marginBottom: 12 },
  stack: { flexDirection: "column", alignItems: "stretch" },
  toast: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: "#eef5ef", borderRadius: 12, padding: 12, marginBottom: 12 },
  toastBtn: { paddingVertical: 10, paddingHorizontal: 16, borderRadius: 999, backgroundColor: "#1f2a24", alignItems: "center" },
  toastBtnText: { color: "#fff", fontSize: 16, fontWeight: "700" },
  row: { flexDirection: "row", gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: "#d9d1c5" },
  rowHere: { backgroundColor: "#eef5ef" },
  rowN: { width: 24, fontSize: 17, fontWeight: "700", color: "#6b6258", textAlign: "right" },
  rowName: { fontSize: 17, color: "#1f2a24", fontWeight: "600" },
  rowDone: { textDecorationLine: "line-through", color: "#9a9187" },
  counts: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  count: { borderWidth: 1, borderColor: "#d9d1c5", borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12, backgroundColor: "#fff" },
  countText: { fontSize: 15, color: "#6b6258" },
  countN: { fontSize: 17, fontWeight: "700", color: "#1f2a24" },
  step: { backgroundColor: "#fff", borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: "#d9d1c5", padding: 12, marginBottom: 8, gap: 4 },
  chip: { alignSelf: "flex-start", borderWidth: 1, borderColor: "#2f7d4f", borderRadius: 999, minHeight: 40, justifyContent: "center", paddingHorizontal: 14, marginTop: 6 },
  chipText: { fontSize: 15, fontWeight: "600", color: "#2f7d4f" },
  dbRow: { backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#e4ddd2", padding: 10, marginBottom: 8 },
});
