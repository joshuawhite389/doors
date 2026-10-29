// The plan (#/plan): public/ui/plan.js's view on the phone, over the engine (src/engine.ts = plan.js's controller).
// A live profile first asks Qloo (the Worker's /api/route), showing its steps; a fresh build shows the building
// steps. Then: the map (each shown day's route and pins, the ranked rooms not on a day), day tabs / Your list / Week,
// the day's stops with the ⋯ menu (statuses, Undo, moves, locks, removes), doors a day, planner notes, carried-over
// notices, the footer, the toast with Undo, and the tools: Start my day and the Why button. The plan is the app's root:
// its header's ☰ opens Home, Export, Settings, Privacy (components/AppMenu); the Agent is App.tsx's round button.
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, FlatList, Linking, Pressable, ScrollView, Text, View } from "react-native";
import { EXCLUDED_STATUSES } from "../../../public/lib/schedule.js";
import { HEAT_TOP } from "../../../public/lib/culture.js";
import { openTill, clockShort, streetOf, labelDrinker } from "../../../public/lib/pool.js";
import { clock12, pinLabel, niceDate, poursOf, listWords } from "../../../public/lib/profile.js";
import { genreLabel, parseHours } from "../../../public/lib/core.js";
import { leaveText, miText, rankLabel, doorReason, orderReason, justOpenedTag, progressLine, underwayNote, unscheduledIds, listRows, weekCount, carryText, restReason, flatList, FLAT_NOTE, ownExtra, dayLabel } from "../../../public/lib/planview.js";
import { outcomeTags, isReturnVisit } from "../../../public/lib/outcome.js";
import { pitchOf } from "../../../public/lib/stopmodel.js";
import { liveDrinkers, liveError, profileForRun, gapsNote, UNREACHABLE } from "../../../public/lib/live.js";
import { cap, nowStamp, type PlanEngine } from "../engine";
import { startButton } from "../../../public/lib/day-debrief.js"; // Resume my day (Jard 10-23, item 5)
import { engineFor, getDemoEngine, openDemo, index, keyOf, saveDraft } from "../session";
import { runLiveProfile, getJSON } from "../data";
import { roadFor, seedDemoRoads, type Road } from "../roads";
import { useEngine, useEngineVer } from "../hooks";
import { useAgentSpot, useNav } from "../nav";
import { tour } from "../tour";
import PlanMap, { type MapDay, type MapPin } from "../components/PlanMap";
import { hasWebsite, webSearchHref } from "../../../public/lib/note.js"; // Jard 10-23: Search the web ↗ when Qloo has no website
import { Btn, C, Chip, HScroll, Row, Screen, T, Tag, Toast, colour, menu, s, spoken, List, useBigText } from "../ui";
import { Ic, type IconName } from "../icons"; // the Doors icon set (Jard 10-24 #1)

const STATUS: Record<string, string> = { visited: "Visited", talked: "Already know them", notfit: "Not a fit" };
const doors = (n: number) => `${n} door${n === 1 ? "" : "s"}`;
const dayShort = (d: any) => cap(d.day).slice(0, 3);
export function rangeText(from: number, to: number) {
  const a = clockShort(from);
  const b = clockShort(to);
  const [an, ap] = a.split(" ");
  const [bn, bp] = b.split(" ");
  return ap && ap === bp ? `${an}–${bn} ${bp}` : `${a}–${b}`;
}
const legText = (st: any) => (st.legMi == null ? "" : `↓ ${st.legMi.toFixed(1)} ${st.source === "ors" ? "road mi" : "mi · est."}`);
// the same leg for VoiceOver: no arrow, no abbreviations
const legSaid = (st: any) => (st.legMi == null ? "" : `${st.legMi.toFixed(1)} ${st.source === "ors" ? "road miles" : "miles, estimated,"} from the last stop`);
const LIVE_STEPS: [string, (d: string, city: string) => string][] = [
  ["resolve", (d) => `Finding ${d} in Qloo`],
  ["pages", (d, city) => `Ranking ${city}'s bars and restaurants for ${d} drinkers`],
  ["filter", () => "Keeping the bars and restaurants"],
  ["hours", () => "Reading each door's opening hours"],
  ["sisters", () => "Finding sister doors: doors with the same crowd"],
  ["guard", () => "Checking each door's sound"],
  ["pitch", () => "Drafting what to say at the door"],
];
const PLAIN: Record<string, (d: string) => string | null> = { resolve: (d) => (/^resolved /.test(d) ? `Qloo's match: ${d.replace(/^resolved "[^"]*" to /, "").replace(/; other candidates.*$/, "")}` : ""), pages: (d) => (/: [1-9]\d* rooms$/.test(d) ? d.replace(/^page \d+: /, "") + " ranked" : null), filter: (d) => d.replace(/ \(dropped.*$/, "") + " kept", hours: (d) => d.replace(/ by their own listed hours$/, "") };

type Phase = { k: "loading" } | { k: "live"; names: string[]; at: Record<string, { step: number; detail: Record<number, string> }> } | { k: "error"; title: string; text: string; hint?: string; retry: boolean; offline?: boolean } | { k: "resting"; message: string; runs: any[] } | { k: "building"; step: number; steps: [string, string][]; total: string } | { k: "ready" };

export function usePlanEngine(params: any): PlanEngine | null {
  const e = useMemo(() => (params.demo ? getDemoEngine() : params.key ? engineFor(params.key) : null), [params.demo, params.key?.brand, params.key?.city]);
  return useEngine(e);
}

// One row of the plan's list, re-rendered only when the engine changed (ver) or the view did (sel): local state such as
// the map, its card or a layer toggle no longer re-renders every row
const Cell = memo(({ render }: { render: () => React.ReactNode; sig: string }) => <View style={{ paddingHorizontal: 16 }}>{render()}</View>, (a, b) => a.sig === b.sig);
// the planner's notes for a day (or the week / list); outside Plan so its open state survives Plan's re-renders
function Notes({ d, plan }: { d: any | null; plan: any }) {
  const ns = plan.notes.filter((n: any) => n.kind !== "carried" && (!d || !(n.date ?? n.to) || (n.date ?? n.to) === d.date));
  const [open, setOpen] = useState(false);
  if (!ns.length) return null;
  const text = (n: any) => (plan.venues[n.id]?.added && !plan.venues[n.id]?.contact ? n.text.replace(/^A contact is not on the plan/, "Added by you, but not on the plan") : n.text);
  const items = ns.map((n: any, j: number) => <T key={j} k="muted">• {n.id && plan.venues[n.id]?.name ? <Text style={{ fontWeight: "700" }}>{plan.venues[n.id].name}: </Text> : null}{text(n)}</T>);
  if (ns.length < 2) return <View style={{ marginTop: 8 }}>{items}</View>;
  const fu = ns.filter((n: any) => n.kind === "followup").length;
  const what = fu === ns.length ? `${fu} follow-ups` : fu ? `${fu} follow-up${fu === 1 ? "" : "s"} and ${ns.length - fu} more note${ns.length - fu === 1 ? "" : "s"}` : `${ns.length} notes from the planner`;
  return (
    <View style={{ marginTop: 8 }}>
      <Pressable onPress={() => setOpen(!open)} accessibilityRole="button" accessibilityLabel={what} accessibilityState={{ expanded: open }}><Text style={{ color: C.green, fontWeight: "600" }}>{open ? "▾" : "▸"} {what}</Text></Pressable>
      {open ? items : null}
    </View>
  );
}

// the door's own site, a small link on its row's second line (web plan.js webLink); none when Qloo has no website
function WebLink({ v }: { v: any }) {
  if (!hasWebsite(v)) return null;
  return (
    <Pressable onPress={() => Linking.openURL(v.website)} accessibilityRole="link" accessibilityLabel={`${v.name ?? "This door"} website`} hitSlop={10}>
      <Text maxFontSizeMultiplier={2} style={[s.small, { color: C.green, fontWeight: "600" }]}>Website ↗</Text>
    </Pressable>
  );
}

// Where the plan's list was scrolled, per plan route and view (day / Your list / All days): only the top screen is
// mounted, so a Stop opened from row 40 came Back to the top of the list (mobile2 10-23). Kept for this run of the app.
// The first row in view is kept too: rows below the rendered ones have estimated heights, so a raw offset came Back
// ~635 pt off (opened row 30, back at rows 24-29: mobile2 10-23, 17 sim); a row index lands on the row itself.
const listY = new Map<string, { y: number; index: number | null }>();

export default function Plan({ params }: { params: { key?: { brand: string; city: string }; demo?: boolean; built?: boolean; drive?: boolean } }) {
  const nav = useNav();
  const bigText = useBigText(); // a row's time goes over its name, so the name keeps the row's width (mobile2 10-23)
  const listStack = useBigText(1.15); // Your list: from a little above default the row's button goes under its text (mobile2 10-24, ease4 nit)
  const [demoE, setDemoE] = useState<PlanEngine | null>(params.demo ? getDemoEngine() : null);
  useEffect(() => { if (params.demo && !demoE) openDemo().then(setDemoE); }, []);
  const e0 = usePlanEngine(params);
  const e = useEngine(params.demo ? demoE : e0);
  const ver = useEngineVer(e);
  const [phase, setPhase] = useState<Phase>({ k: "loading" });
  useAgentSpot({ hide: phase.k !== "ready" }); // the Agent button once there is a plan to ask about
  const [mapOpen, setMapOpen] = useState(true);
  // the tour's "Three days, three routes" card (key "week") asks for All days: the tab row scrolls so it's on screen,
  // ringed, as the web does (lane T 0fd0283; mobile2 10-24: on a phone it sat off the right edge)
  const tabsRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const [tourKey, setTourKey] = useState<string | null>(tour.card?.key ?? null);
  useEffect(() => tour.subscribe(() => setTourKey(tour.card?.key ?? null)), []);
  useEffect(() => { if (tourKey === "week") { const t = setTimeout(() => tabsRef.current?.scrollToEnd({ animated: true }), 300); return () => clearTimeout(t); } }, [tourKey]);
  // the map's layers (G3): other days always shown, faint, behind the selected one (Jard's iPhone 10-23: "the other
  // route days on the map, where are those?"; then "Other days on the map: I don't know what that means", so no toggle),
  // and the ranked doors not on a day on Your list (ease #1: the day tabs are the one picker; the map's own toggle went)
  const othersOn = true;
  const [card, setCard] = useState<string | null>(null);
  const [cityData, setCityData] = useState<any>(null);
  useEffect(() => { e?.stopData().then((d: any) => setCityData(d.city)).catch(() => {}); }, [e]);
  useEffect(() => setCard(null), [e?.sel]); // a ranked door's card goes with Your list
  const [roads, setRoads] = useState<Record<string, Road>>({});
  const [run, setRun] = useState(0);

  // ---------- open: a live run first, then the plan; a fresh build shows its steps ----------
  useEffect(() => {
    if (!e) return;
    if (e.plan) return setPhase({ k: "ready" });
    let on = true;
    (async () => {
      if (e.isLive()) {
        const names = liveDrinkers(e.profile, index).filter((d: any) => d.live).map((d: any) => d.name);
        const at: any = Object.fromEntries(names.map((n: string) => [n, { step: 0, detail: {} }]));
        setPhase({ k: "live", names, at: { ...at } });
        try {
          await runLiveProfile(e.profile, index, (ev: any) => {
            const d = ev.drinker && at[ev.drinker] ? ev.drinker : names[0];
            const id = ev.id === "plan" ? "resolve" : ev.id;
            const k = id === "cache" ? LIVE_STEPS.length - 1 : LIVE_STEPS.findIndex(([x]) => x === id);
            if (k < 0 || !at[d]) return;
            at[d].step = k + 1;
            const plain = id === "cache" ? ev.detail : ev.id === "plan" ? null : PLAIN[id]?.(String(ev.detail ?? ""));
            if (plain) at[d].detail[id === "cache" ? 0 : k] = plain;
            if (on) setPhase({ k: "live", names, at: JSON.parse(JSON.stringify(at)) });
          });
        } catch (err: any) {
          if (!on) return;
          if (err.fallback) return setPhase({ k: "resting", message: err.message, runs: err.runs ?? [] });
          if (err.offline) return setPhase(offlinePhase(err));
          const typo = /doesn't know a city called/.test(err.message);
          let hint = err.hint;
          if (typo) {
            const near = (await import("../../../public/lib/citylist.js").catch(() => null) as any)?.nearestCity;
            hint = liveError(err.message, (t: string) => near?.(t)?.label).hint;
          }
          // fix14: or this server runs on Boise's sample data (no Qloo key): not Qloo's answer, and not worth a retry
          const sample = /runs on sample data/.test(err.message);
          const cityError = sample || /doesn't know a city called|^Qloo read "/.test(err.message);
          return setPhase({ k: "error", title: sample ? "This server can't build this city" : "Qloo couldn't build this plan", text: err.message, hint, retry: !cityError });
        }
        const far = e.afterLive();
        if (far) return on && setPhase({ k: "error", title: `Your start is far from ${e.c.name}`, text: far, retry: false });
      }
      let ok: boolean;
      try {
        ok = await e.open();
      } catch (err: any) {
        if (!on) return;
        if (err?.offline) return setPhase(offlinePhase(err));
        throw err;
      }
      if (!on) return;
      if (!ok) return setPhase({ k: "error", title: "No doors for that profile", text: `Doors has no list of doors for these brands in ${e.c.name}. Edit the profile and pick the brands again.`, retry: false });
      if (e.demo) seedDemoRoads((await getJSON("/data/demo/demo.json")).roads, e.plan.venues);
      if (params.built && !params.drive) {
        // the building steps (plan.js buildSteps): what the planner just did, in its words
        const p = e.plan;
        const d0 = typeof e.sel === "number" ? p.days[e.sel] : p.days[0];
        const drinker = labelDrinker(p.pool.label) ?? "your drinker";
        const nDays = p.days.length; // persona (founder): "fit your 7 days" beside "54 doors over 9 days"
        const kept = new Set(p.days.flatMap((d: any) => d.stops.map((x: any) => x.id))).size;
        const total = `${doors(p.days.reduce((a: number, d: any) => a + d.stops.length, 0))} over ${p.days.length} day${p.days.length === 1 ? "" : "s"}`;
        const steps: [string, string][] = [
          [`Ranking ${e.c.name} doors for ${drinker}`, "Qloo's taste data"],
          [`${p.pool.N} ranked · ${kept} open when you're free${ownExtra(p) ? ` · ${ownExtra(p)}` : ""}`, `fit your ${nDays === 1 ? "day" : `${nDays} days`}`],
          [`Planning ${cap(d0?.day ?? "")}`, doors(d0?.stops.length ?? 0)],
          ["Routing from your start", "the doors appear as the route reaches them"],
        ];
        for (let i = 0; i <= steps.length; i++) {
          if (!on) return;
          setPhase({ k: "building", step: i, steps, total });
          await new Promise((r) => setTimeout(r, 750));
        }
      }
      if (on) setPhase({ k: "ready" });
      if (on && params.drive) nav.push("drive", params);
    })().catch((err) => on && setPhase({ k: "error", title: "Doors didn't load", text: String(err?.message ?? err), retry: true }));
    return () => { on = false; };
  }, [e, run]);

  const plan = e?.plan;
  const sel = e?.sel ?? 0;
  // ---------- roads for the shown days ----------
  const yKey = `${nav.stack.at(-1)?.key ?? 0}|${String(sel)}`;
  const listRef = useRef<FlatList<any>>(null);
  const restoreY = useRef(listY.get(yKey) ?? null); // on mount only: a day-tab switch starts at the top
  const yKeyNow = useRef(yKey);
  yKeyNow.current = yKey;
  // FlatList wants these two the same on every render
  const viewCfg = useRef({ itemVisiblePercentThreshold: 10 }).current;
  const onViewable = useRef(({ viewableItems }: { viewableItems: { index?: number | null }[] }) => {
    const k = yKeyNow.current, first = viewableItems.find((v) => v.index != null);
    listY.set(k, { y: listY.get(k)?.y ?? 0, index: first?.index ?? null });
  }).current;
  const shown: number[] = !plan ? [] : sel === "week" || (othersOn && typeof sel === "number") ? plan.days.map((_: any, i: number) => i) : typeof sel === "number" ? [sel] : [];
  const roadKey = (d: any) => `${d.date}|${d.stops.map((x: any) => x.id).join()}`;
  useEffect(() => {
    if (!plan || !e) return;
    for (const i of shown) {
      const d = plan.days[i];
      if (!d?.stops.length || roads[roadKey(d)]) continue;
      roadFor(d.start, d.stops.map((x: any) => plan.venues[x.id]), { offline: !!e.demo }).then((r) => setRoads((m) => ({ ...m, [roadKey(d)]: r })));
    }
  }, [plan, sel, othersOn]);

  if (!e) {
    return <Screen title="Your plan"><T k="h2">That plan isn't on this phone</T><Btn label="Build a plan" onPress={() => nav.replace("form", {})} /></Screen>;
  }
  const editTo = () => nav.push("form", e.demo ? { demo: true } : { edit: e.key });
  if (phase.k === "ready" && e?.demo) tour.sig("ready");
  if (phase.k !== "ready" || !plan) return <PhaseView phase={phase} e={e} onRetry={() => setRun(run + 1)} onEdit={editTo} />;

  const c = e.c;
  const day = typeof sel === "number" ? plan.days[sel] : null;
  const status = (id: string) => plan.statuses[id];
  const isDone = (st: any, d: any) => status(st.id) === "visited" && !isReturnVisit(st, d, plan.outcomes?.[st.id]);
  const startName = (st: any) => (!st ? "your start" : !st.label || st.label === "Pin on the map" ? pinLabel(st, c.key, plan.venues) : st.label);
  const openStop = (id: string, d: number | null) => nav.push("stop", { ...(e.demo ? { demo: true } : { key: e.key }), id, day: d });

  // ---------- map ----------
  const mapDays: MapDay[] = shown.map((i) => {
    const d = plan.days[i];
    const faint = typeof sel === "number" && i !== sel;
    return {
      key: d.date, color: colour(i), start: d.start, strong: !faint, road: roads[roadKey(d)] ?? null,
      pins: d.stops.map((st: any, k: number) => {
        const v = plan.venues[st.id] ?? {};
        const done = isDone(st, d);
        if (faint) return { id: st.id, lat: +v.lat, lon: +v.lon, label: "", color: colour(i), title: `${dayShort(d)} · ${k + 1}. ${v.name}`, sub: `${clock12(st.eta)} · tap to open`, z: 1, faint: true };
        return { id: st.id, lat: +v.lat, lon: +v.lon, label: done ? "✓" : String(k + 1), color: done ? C.done : colour(i), title: `${k + 1}. ${v.name}`, sub: `${clock12(st.eta)} · tap to open`, z: 60 - k, ring: st.pinned === "followup" };
      }),
    };
  });
  const rest: MapPin[] = sel === "rest" ? unscheduledIds(plan).filter((id: string) => Number.isFinite(+plan.venues[id]?.lat)).map((id: string) => {
    const n = plan.pool.ids.indexOf(id) + 1 || null;
    return { id, lat: +plan.venues[id].lat, lon: +plan.venues[id].lon, label: n ? `#${n}` : "•", color: "#9A958C", rank: true, title: plan.venues[id].name, sub: [rankLabel(plan, id), restReason(plan, id) ? `Not on a day: ${restReason(plan, id)}` : ""].filter(Boolean).join(" · "), z: 5 };
  }) : [];
  const credit = undefined;
  // a ranked room's card under the map (plan.js openCard): rank for the drinker, kind, Qloo's crowd line, why it isn't on
  // a day, its website, Open the room, Add to …
  const restIds = new Set(rest.map((x) => x.id));
  const onPin = (id: string) => {
    if (restIds.has(id)) return setCard(id);
    openStop(id, plan.days.findIndex((d: any) => d.stops.some((x: any) => x.id === id)));
  };
  const cardView = card && plan.venues[card] ? (() => {
    const v = plan.venues[card];
    const crowd = cityData?.pitches?.[card] ? pitchOf(v, cityData).lines.find((l: any) => /crowd/i.test(l.label ?? ""))?.text : null;
    const why = restReason(plan, card);
    return (
      <View style={[s.card, { marginHorizontal: 12 }]} testID="rank-card">
        <Row style={{ justifyContent: "space-between" }} wrap={false}><T k="h3" style={{ flex: 1 }}>{v.name ?? card}</T><Pressable onPress={() => setCard(null)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Close"><Text style={{ fontSize: 20, color: C.ink3 }}>×</Text></Pressable></Row>
        <T k="small">{rankLabel(plan, card) ? "" : "Not on the ranked list · "}{cap(genreLabel(v)) || "Bar or restaurant"}</T>
        {crowd ? <T k="body" style={{ marginTop: 6 }}><Text style={{ fontWeight: "700" }}>Crowd:</Text> {crowd}</T> : doorReason(plan, card) ? <T k="body" style={{ marginTop: 6 }}>{doorReason(plan, card)}</T> : null}
        {why ? <T k="muted" style={{ marginTop: 6 }}>Not on a day: {why}.</T> : null}
        <Row style={{ marginTop: 8 }}>
          {hasWebsite(v) ? <Btn small kind="line" label="Website ↗" onPress={() => Linking.openURL(v.website)} /> : webSearchHref(v, plan.city?.name) ? <Btn small kind="line" label="Search the web ↗" onPress={() => Linking.openURL(webSearchHref(v, plan.city?.name)!)} /> : null}
          <Btn small kind="line" label="Open the door" onPress={() => { setCard(null); openStop(card, null); }} />
          <Btn small label="Add to…" onPress={() => addMenu(card)} />
        </Row>
      </View>
    );
  })() : null;

  // ---------- rows ----------
  const tags = (id: string, st?: any) => {
    const v = plan.venues[id] ?? {};
    const o = plan.outcomes?.[id];
    const out: { text: string; tone?: string; icon?: IconName }[] = [];
    if (v.contact) out.push({ text: "My contact", tone: "ok" });
    if (v.added) out.push({ text: "Added by you", tone: "ok" });
    if (st?.carried) out.push({ text: "carried over" });
    if (justOpenedTag(st) && !status(id)) out.push({ text: justOpenedTag(st), tone: "warn" }); // persona (founder); judge 6 #3: says when it opened
    if (status(id) && !(status(id) === "visited" && o?.result)) out.push({ text: STATUS[status(id)], tone: status(id) === "visited" ? "ok" : "warn" });
    for (const t of outcomeTags(o)) out.push({ text: t.label, icon: t.ic ?? undefined, tone: /fu|follow/.test(t.cls) ? "warn" : "ok" }); // judge 12 #5: icons, not ✓ ↻
    return out;
  };
  const rowMenu = (id: string, mv: { d: any; i: number; k: number; st: any } | null) => {
    const v = plan.venues[id] ?? {};
    const items: { label: string; on: () => void; destructive?: boolean; disabled?: boolean }[] = [
      ...Object.entries(STATUS).map(([k, t]) => ({ label: status(id) === k ? `${t} ✓` : t, on: () => e.setStatus(id, k) })),
      { label: "Undo", on: () => e.undoMark(id), disabled: !status(id) },
      { label: "Remove my contact", on: () => e.removeContact(id), destructive: true, disabled: !v.contact },
    ];
    if (mv) {
      if (mv.k > e.lead(mv.d)) items.push({ label: "Move up", on: () => e.moveStop(id, { day: mv.i, index: mv.k - 1 }) });
      if (mv.k < mv.d.stops.length - 1) items.push({ label: "Move down", on: () => e.moveStop(id, { day: mv.i, index: mv.k + 1 }) });
      plan.days.forEach((d: any, j: number) => { if (j !== mv.i && !d.past) items.push({ label: `Move to ${dayLabel(plan.days, d)}`, on: () => e.moveStop(id, { day: j, index: null }) }); });
      items.push({ label: mv.st.locked ? "Unlock: let Doors place it" : "Lock it here", on: () => e.setLock(id, !mv.st.locked) });
    }
    items.push({ label: "Remove from my plan", on: () => e.removeAdded(id), destructive: true, disabled: !v.added });
    menu(v.name ?? "This stop", items);
  };
  const addMenu = (id: string) => {
    const open = plan.days.map((d: any, i: number) => ({ d, i })).filter(({ d }: any) => !d.past && !d.frozen);
    menu(`Add ${plan.venues[id]?.name ?? "this door"} to`, [...open.map(({ d }: any) => ({ label: `${cap(d.day)} · ${niceDate(d.date)}, ${rangeText(d.from, d.to)}`, on: () => e.addDoor(plan.venues[id], { date: d.date }) })), { label: "Let Doors choose", on: () => e.addDoor(plan.venues[id], { date: null }) }]);
  };
  const capSet = (d: any) => plan.windows?.find((w: any) => w.date === d.date)?.max ?? null;
  const capIn = (d: any) => (d.past || d.frozen ? null : capSet(d));
  const doorsOf = (d: any) => (capIn(d) ? `${d.stops.length} of up to ${capIn(d)} doors` : `${doors(d.stops.length)}${d.frozen && !d.past && capSet(d) ? (d.begun === false ? " (kept as planned: no limit)" : " (under way: no limit)") : ""}`);

  const StopRow = ({ d, i, st, k, compact }: { d: any; i: number; st: any; k: number; compact?: boolean }) => {
    const v = plan.venues[st.id] ?? {};
    const done = isDone(st, d);
    const mv = e.movable(d, st);
    const lv = k === 0 && leaveText(d) ? ` · leave ${clock12(d.leave)}` : "";
    const sub = v.source === "manual" ? "Added by you" : `${cap(genreLabel(v)) || "Bar or restaurant"}${doorReason(plan, st.id) ? ` · ${doorReason(plan, st.id)}` : ""}`;
    const tg = tags(st.id, st);
    const why = st.openAtArrival !== false && orderReason(st) ? orderReason(st) : openTill(st, { parsed: parseHours(v.hours), day: d.day });
    return (
      <View testID={`stop-${st.id}`}>
        {!compact && legText(st) ? <Text maxFontSizeMultiplier={2} style={[s.small, { marginLeft: 44, marginTop: 4 }]} accessibilityLabel={`${legSaid(st)}${lv}`}>{legText(st)}{lv}</Text> : null}
        <View style={{ flexDirection: "row", gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderColor: C.line2, backgroundColor: e.focusId === st.id ? C.greenSoft : undefined, alignItems: "flex-start" }}>
          <View style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: done ? C.done : colour(i), alignItems: "center", justifyContent: "center", marginTop: 2 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Text style={{ color: "#fff", fontWeight: "700" }} allowFontScaling={false}>{done ? "✓" : k + 1}</Text>
          </View>
          {/* VoiceOver reads the row once (number, name, what it is, time, why, tags) as ONE element that opens the stop;
              Website ↗ and the 🔒 unlock are their own elements after it (mobile2 10-23: nested inside the row, the row's
              activation point landed on Website and a double-tap opened Safari). The dot and the time column are hidden */}
          <View style={{ flex: 1 }}>
            <Pressable onPress={() => openStop(st.id, i)} onAccessibilityTap={() => openStop(st.id, i)} accessibilityRole="button" accessibilityHint="Opens the stop" testID={`open-${st.id}`}
              accessibilityLabel={spoken(`Stop ${k + 1}${done ? ", visited" : ""}: ${v.name ?? st.id}${v.branch ? `, ${v.branch}` : ""}. ${sub}. ${clock12(st.eta)}${why ? `, ${why}` : ""}.${st.locked && mv ? ` Locked: ${st.lockDay ? `you put it on ${cap(d.day)}` : `you put it ${k === 0 ? "first" : "here"}`}.` : ""}${e.rerouted.has(st.id) ? " Re-routed." : ""}${tg.map((t) => ` ${t.text}.`).join("")}`)}>
              {bigText ? <Text style={{ fontSize: 15, fontWeight: "700", color: C.ink }} accessibilityElementsHidden importantForAccessibility="no">{clock12(st.eta)}</Text> : null}
              <Text style={[s.h3, done && { color: C.ink3 }]} maxFontSizeMultiplier={1.8} /* AX XL broke names mid-word ("Moontowe / r") */>{v.name ?? st.id}{v.branch ? <Text maxFontSizeMultiplier={2} style={s.small}> · {v.branch}</Text> : null}</Text>
              <Text maxFontSizeMultiplier={2} style={s.small}>{sub}</Text>
            </Pressable>
            {/* Jard 10-23: when it's open sits under the row's words; in the time column it squeezed them into ragged lines */}
            {why || hasWebsite(v) ? (
              <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center" }}>
                {why ? <Pressable onPress={() => openStop(st.id, i)} accessible={false}><Text maxFontSizeMultiplier={2} style={[s.small, st.openAtArrival === false && { color: C.warn }]}>{cap(why)}{hasWebsite(v) ? " · " : ""}</Text></Pressable> : null}
                <WebLink v={v} />
              </View>
            ) : null}
            <Row style={{ marginTop: 4, gap: 4 }}>
              {st.locked && mv ? (
                <Pressable onPress={() => e.setLock(st.id, false)} accessibilityRole="button" accessibilityLabel={`Unlock ${v.name ?? "this stop"}: let Doors place it`} hitSlop={8} testID={`unlock-${st.id}`}>
                  <Tag tone="lock" icon="lock" text={`${st.lockDay ? `you put it on ${cap(d.day)}` : `you put it ${k === 0 ? "first" : "here"}`}`} />
                </Pressable>
              ) : null}
              {e.rerouted.has(st.id) || tg.length ? (
                <Pressable onPress={() => openStop(st.id, i)} accessible={false} style={{ flexDirection: "row", flexWrap: "wrap", gap: 4 }}>
                  {e.rerouted.has(st.id) ? <Tag text="re-routed" /> : null}
                  {tg.map((t, j) => <Tag key={j} text={t.text} tone={t.tone} icon={t.icon} />)}
                </Pressable>
              ) : null}
            </Row>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            {bigText ? null : <Text style={{ fontSize: 15, fontWeight: "700", color: C.ink }} accessibilityElementsHidden importantForAccessibility="no">{clock12(st.eta)}</Text>}
            <Pressable onPress={() => rowMenu(st.id, mv ? { d, i, k, st } : null)} accessibilityRole="button" accessibilityLabel={`Mark ${v.name}`} hitSlop={8} style={{ paddingHorizontal: 10, paddingVertical: 4, marginTop: 2, minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" }} testID={`more-${st.id}`}>
              <Ic name="more" size={20} color={C.ink2} />
            </Pressable>
          </View>
        </View>
      </View>
    );
  };

  // the view's rows go to the FlatList (virtualized, memoized cells); its heading and empty text around them
  let head: React.ReactNode = null, empty: React.ReactNode = null;
  let items: { key: string; render: () => React.ReactNode }[] = [];
  if (day) {
    const i = sel as number;
    const visited = day.stops.filter((x: any) => isDone(x, day)).length;
    const leave = leaveText(day, startName(day.start));
    const meta = day.stops.length ? `${doorsOf(day)} · ${miText(day)} · ${clock12(day.stops[0].eta)}–${clock12(day.end)}${visited ? ` · ${visited} visited` : ""}${leave ? ` · ${leave}` : ""}` : day.past ? "This window has ended." : "No door fits this window.";
    head = (
      <View testID="day-view">
        <T k="h2">{dayLabel(plan.days, day)} in {c.name}{day.past ? <Text maxFontSizeMultiplier={2} style={s.small}> (ended)</Text> : null}</T>
        <T k="muted">{meta}</T>
        <View style={{ height: 6, backgroundColor: C.line, borderRadius: 3, marginTop: 10 }}><View style={{ height: 6, width: `${day.stops.length ? (100 * visited) / day.stops.length : 0}%`, backgroundColor: C.done, borderRadius: 3 }} /></View>
        <T k="small" style={{ marginTop: 4 }}>{progressLine(day, visited)}</T>
        <Notes d={day} plan={plan} />
      </View>
    );
    items = day.stops.map((st: any, k: number) => ({ key: st.id, render: () => StopRow({ d: day, i, st, k }) }));
    empty = day.stops.length ? null : (
      <View>
          <T k="muted" style={{ marginTop: 10 }}>{day.past ? `This window has ended${day.stops.length ? "" : " with no door checked off"}. Doors you didn't reach moved to your next days.` : Object.values(plan.reasons ?? {}).some((r: any) => r?.date === day.date) ? `Doors left ${cap(day.day)} empty: the doors open then are on your other days, or a long drive from the rest (Your list says how far, and + Add to a day puts one on it).` : `Nothing on your list is open for ${e.profile.visitMin} minutes between ${rangeText(day.from, day.to)} on ${cap(day.day)}.`}</T>
          {day.past ? null : <Btn small kind="line" label="Edit profile" onPress={() => nav.push("form", e.demo ? { demo: true } : { edit: e.key })} style={{ alignSelf: "flex-start", marginTop: 8 }} testID="empty-edit" />}
      </View>
    );
  } else if (sel === "week") {
    head = (
      <View testID="week-view">
        <T k="h2">All days in {c.name}</T>
        <T k="muted">{weekCount(plan.days)}</T>
        <Notes d={null} plan={plan} />
      </View>
    );
    items = plan.days.flatMap((d: any, i: number) => [
      { key: `day-${d.date}`, render: () => (
            <Pressable onPress={() => e.selectDay(i)} style={{ flexDirection: "row", gap: 8, alignItems: "center", marginTop: 16, paddingBottom: 4 }} accessibilityRole="button">
              <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: colour(i) }} />
              <Text style={[s.body, { flex: 1 }]}><Text style={{ fontWeight: "700" }}>{dayLabel(plan.days, d)} {rangeText(d.from, d.to)}</Text> · {doorsOf(d)}{d.stops.length ? ` · ${miText(d)}` : ""}{leaveText(d) ? ` · ${leaveText(d, startName(d.start))}` : ""}</Text>
            </Pressable>
      ) },
      ...d.stops.map((st: any, k: number) => ({ key: `${d.date}-${st.id}`, render: () => StopRow({ d, i, st, k, compact: true }) })),
    ]);
  } else {
    const rows = listRows(plan);
    const where = (r: any) => `${dayLabel(plan.days, plan.days[r.day], { short: true })} · stop ${r.stop}`;
    const ranked = rows.filter((r: any) => !r.own);
    const own = rows.filter((r: any) => r.own && !r.outside);
    const outside = rows.filter((r: any) => r.outside);
    const onDays = new Set(plan.days.flatMap((d: any) => d.stops.map((x: any) => x.id))).size;
    const marked = ranked.filter((r: any) => EXCLUDED_STATUSES.has(r.state)).length;
    const Row1 = (r: any) => {
      const v = plan.venues[r.id] ?? {};
      const mk = EXCLUDED_STATUSES.has(r.state);
      const on = r.day != null;
      const add = r.state === "rest" && !r.pinned;
      const why = r.state === "rest" ? r.reason ?? "not on a day" : mk && on ? where(r) : null; // ease audit 3 #9: one form, as the button beside an unmarked row
      const acts = (
        <View style={listStack ? { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 } : { alignItems: "flex-end", gap: 6 }}>
          {mk ? <Btn small kind="line" label="Undo" onPress={() => e.undoMark(r.id)} /> : on ? <Btn small kind="line" label={where(r)} onPress={() => openStop(r.id, r.day)} /> : add ? <Btn small kind="line" label="+ Add to a day" onPress={() => addMenu(r.id)} testID={`add-${r.id}`} /> : null}
          <Pressable onPress={() => rowMenu(r.id, null)} hitSlop={8} style={{ paddingHorizontal: 10 }} accessibilityRole="button" accessibilityLabel={`More for ${v.name ?? r.id}`}><Ic name="more" size={20} color={C.ink2} /></Pressable>
        </View>
      );
      // keyed by mode: a live text-size change re-lays the row out (iOS keeps a mounted row's old flex)
      return (
        <View key={listStack ? "stack" : "side"} style={{ flexDirection: "row", gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderColor: C.line2, opacity: mk ? 0.6 : 1 }} testID={`list-${r.id}`}>
          <View style={{ minWidth: 30, height: 30, borderRadius: 15, paddingHorizontal: 4, backgroundColor: mk || !on ? "#B9B5AC" : colour(r.day), alignItems: "center", justifyContent: "center" }}>
            <Text style={{ color: "#fff", fontWeight: "700", fontSize: 12 }} allowFontScaling={false}>{r.rank ?? "•"}</Text>
          </View>
          {/* one element opens the stop; Website ↗ is its own element after it (as the day rows) */}
          <View style={{ flex: 1 }}>
            <Pressable onPress={() => openStop(r.id, on ? r.day : null)} onAccessibilityTap={() => openStop(r.id, on ? r.day : null)} accessibilityRole="button" testID={`open-${r.id}`}>
              <Text style={s.h3} maxFontSizeMultiplier={1.8}>{v.name ?? r.id}{v.branch ?? streetOf(v.address) ? <Text maxFontSizeMultiplier={2} style={s.small}> · {v.branch ?? streetOf(v.address)}</Text> : null}</Text>
              <Text maxFontSizeMultiplier={2} style={s.small}>{v.source === "manual" ? "Added by you" : `${cap(genreLabel(v)) || "Bar or restaurant"}${doorReason(plan, r.id) ? ` · ${doorReason(plan, r.id)}` : ""}`}</Text>
              {why ? <Text maxFontSizeMultiplier={2} style={[s.small, { color: C.ink2 }]}>{why}</Text> : null}
              <Row style={{ marginTop: 4, gap: 4 }}>{tags(r.id).map((t, j) => <Tag key={j} text={t.text} tone={t.tone} icon={t.icon} />)}</Row>
            </Pressable>
            <WebLink v={v} />
            {listStack ? acts : null}
          </View>
          {listStack ? null : acts}
        </View>
      );
    };
    head = (
      <View testID="list-view">
        <T k="h2">Your list</T>
        <T k="muted">Every door Qloo ranked for your drinker, best first. Your days fill from the top, a week at a time.{flatList(plan, e.routes) ? ` ${FLAT_NOTE}` : ""}{underwayNote(plan) ? ` ${underwayNote(plan)}` : ""}</T>
        <T k="small" style={{ marginTop: 4 }}>{plan.pool.N} ranked · {onDays} on your days{marked ? ` · ${marked} marked` : ""}</T>
        <Notes d={null} plan={plan} />
        {ranked.length ? null : <T k="muted">No ranked doors pass your door types. Edit your profile.</T>}
      </View>
    );
    const rowItems = (rs: any[]) => rs.map((r: any) => ({ key: r.id, render: () => Row1(r) }));
    items = [
      ...rowItems(ranked),
      ...(own.length ? [{ key: "h-own", render: () => <T k="h3" style={{ marginTop: 16 }}>Your own doors <Text maxFontSizeMultiplier={2} style={s.small}>· contacts and doors you added</Text></T> }, ...rowItems(own)] : []),
      ...(outside.length ? [{ key: "h-out", render: () => <T k="h3" style={{ marginTop: 16 }}>Marked <Text maxFontSizeMultiplier={2} style={s.small}>· not on your ranked list now (another door type, or closed)</Text></T> }, ...rowItems(outside)] : []),
    ];
  }

  const dismissed = new Set(e.st.dismissed ?? []);
  const carried = Object.values(e.st.carriedNotes ?? {}).filter((n: any) => !dismissed.has(n.from)) as any[];
  // fix5-res: what Qloo didn't answer on this plan's live run (route.gaps), one line, only when something is missing
  const gapLine = gapsNote(e.routes);
  const hoods = e.hoods;
  // the web's footer note (plan.js unshaped): the demo has road miles for every pair but road shapes only for the days
  // it baked; a re-planned day draws dashed, and this says why its miles still read "road mi"
  const unshaped = e.demo && plan.source === "ors" && (day ? [day] : plan.days).some((x: any) => !x.past && x.stops.length && roads[roadKey(x)]?.solid === false)
    ? " A dashed line: a day re-planned offline, so its road shape isn't drawn; its miles and times are still road ones." : "";
  // Jard 10-23 #7: the top of the plan is just Start my day and the Why button (the Why screen names it;
  // "Why these doors" holds the place). The Agent is the round button bottom-right on every screen (#6); Export,
  // Settings and Home are in the ☰ menu (#5); Watch the route is web-only (#5: it plays better on the web)
  const tools: [string, () => void, string, string?][] = [
    [startButton(plan, plan.drive, nowStamp()).label, () => nav.push("drive", e.demo ? { demo: true } : { key: e.key }), "t-drive"], // a paused day: Resume my day (dayflow)
    ["Why these doors", () => nav.push("why", e.demo ? { demo: true } : { key: e.key }), "t-why"],
  ];
  return (
    <Screen title={`${e.profile.brand.trim() || "Your plan"} · ${c.name}`} scroll={false} testID="plan">
      {/* a FlatList, not a ScrollView of every row: Your list (130 rooms) and the Week (9 days) mounted every row, and a
          drag kept the main thread at 55–77% on the XS-size sim. Rows are virtualized and memoized (Cell) */}
      <List ref={listRef} data={items} keyExtractor={(x) => x.key}
        onScroll={(ev) => listY.set(yKey, { y: ev.nativeEvent.contentOffset.y, index: listY.get(yKey)?.index ?? null })} scrollEventThrottle={100}
        onViewableItemsChanged={onViewable} viewabilityConfig={viewCfg}
        // back from a stop: the list where it was. Near the top (the map, the first row) by its offset, once that has laid
        // out; further down by the first row that was in view, which FlatList scrolls to even before it has rendered it
        onContentSizeChange={(_, h) => {
          const r = restoreY.current;
          if (!r) return;
          if (!r.index) { if (h >= r.y) { restoreY.current = null; listRef.current?.scrollToOffset({ offset: r.y, animated: false }); } return; }
          if (items.length > r.index) { restoreY.current = null; listRef.current?.scrollToIndex({ index: r.index, viewPosition: 0, animated: false }); }
        }}
        onScrollToIndexFailed={(info) => {
          listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
          setTimeout(() => listRef.current?.scrollToIndex({ index: info.index, viewPosition: 0, animated: false }), 120);
        }} renderItem={({ item }) => <Cell render={item.render} sig={`${ver}|${String(sel)}|${item.key}|${bigText}`} />}
        extraData={ver} initialNumToRender={8} maxToRenderPerBatch={8} windowSize={9}
        contentContainerStyle={{ paddingBottom: 110 }} keyboardShouldPersistTaps="handled" testID="plan-list"
        ListHeaderComponent={<>
        <Text maxFontSizeMultiplier={2} style={[s.small, { paddingHorizontal: 14, paddingTop: 8 }]} numberOfLines={2} testID="plan-who">{(() => {
          // the web's app bar line: who the plan is for
          const p = e.profile;
          const pours = poursOf(p, index?.rooms ?? []);
          const forWho = p.drinks.length ? `for ${listWords(p.drinks.map((d: any) => d.name))} drinkers` : ""; // intuit audit #5, as the web
          return pours.length ? `${forWho ? `${forWho}; ` : ""}poured at ${pours.map((r: any) => r.name).join(", ")}` : forWho;
        })()}</Text>
        {/* mobile2, 10-23 (17 sim): as a scroller the row ran past the right edge ("Why these rooms?" clipped). One row
            that always fits: the buttons share the width and their text shrinks a little at large sizes or on an SE */}
        <Row wrap={false} style={{ paddingHorizontal: 12, paddingTop: 10 }} testID="toolbar">
          {tools.filter(([, , id]) => nav.has(({ "t-drive": "drive", "t-why": "why" } as any)[id])).map(([l, f, id, a11y]) => <Btn key={id} small fit kind={id === "t-drive" ? "primary" : "line"} label={l} a11y={a11y} onPress={f} testID={id} style={{ flexGrow: 1, flexShrink: 1, paddingHorizontal: 10 }} />)}
        </Row>
        {mapOpen ? (
          <View style={{ paddingHorizontal: 12, paddingTop: 10 }}>
            <PlanMap days={mapDays} extra={rest} height={250} fitKey={String(sel)} credit={credit} onPin={onPin} />
          </View>
        ) : null}
        {cardView}
        <Pressable onPress={() => setMapOpen(!mapOpen)} accessibilityRole="button" style={{ alignSelf: "flex-end", paddingHorizontal: 14, paddingVertical: 6 }}><Text style={{ color: C.green, fontWeight: "600" }} maxFontSizeMultiplier={1.6}>{mapOpen ? "Hide map" : "Show map"}</Text></Pressable>
        <HScroll contentContainerStyle={{ gap: 8, paddingHorizontal: 12 }} testID="daytabs" scrollRef={tabsRef}>
          {plan.days.map((d: any, i: number) => <Chip key={d.date} color={colour(i)} label={`${dayShort(d)} ${+d.date.slice(8)} · ${doors(d.stops.length)}`} on={sel === i} onPress={() => e.selectDay(i)} testID={`tab-${i}`} />)}
          <Chip label={`Your list · ${plan.pool.N}`} on={sel === "rest"} onPress={() => e.selectDay("rest")} testID="tab-rest" />
          {plan.days.length > 1 ? <Chip label="All days" on={sel === "week"} onPress={() => e.selectDay("week")} testID="tab-week" style={tourKey === "week" && sel !== "week" ? { borderWidth: 2, borderColor: C.amber } : null} /> : null}
        </HScroll>
        <View style={{ paddingHorizontal: 16, paddingTop: 12 }}>
          {gapLine ? (
            <View testID="gaps" accessibilityLiveRegion="polite" style={[s.card, { backgroundColor: C.amberSoft, borderColor: C.amberSoft, marginTop: 0, marginBottom: 10 }]}>
              <T k="body">{gapLine}</T>
            </View>
          ) : null}
          {carried.map((n) => (
            <View key={n.from} style={[s.card, { flexDirection: "row", gap: 8, backgroundColor: C.amberSoft, borderColor: C.amberSoft, marginTop: 0, marginBottom: 10 }]}>
              <T k="body" style={{ flex: 1 }}>{carryText(n.text, n.ids.map((id: string) => plan.venues[id]?.name).filter(Boolean).join(", "))}</T>
              <Pressable onPress={() => e.dismissNotice(n.from)} accessibilityRole="button" accessibilityLabel="Dismiss" hitSlop={8}><Text style={{ fontSize: 20, color: C.ink3 }}>×</Text></Pressable>
            </View>
          ))}
          {head}
        </View>
        </>}
        ListFooterComponent={<View style={{ paddingHorizontal: 16 }}>
          {empty}
          {nav.has("add") ? <Btn kind="line" label="+ Add a door" onPress={() => nav.push("add", e.demo ? { demo: true } : { key: e.key })} testID="add-door-btn" /> : null}
          <View style={s.sect}>
            {/* ease #10: no engineering notes under the plan (miles and hours sources are under Why these doors) */}
            {day || unshaped ? <T k="small">{day ? `Leave ${clock12(day.leave ?? day.from)} from ${startName(day.start)} · ${e.profile.visitMin} min a stop.` : ""}{unshaped}</T> : null}
            {e.heatOn() && (!day || day.date === plan.days.find((x: any) => !x.past)?.date) ? <T k="small" style={{ marginTop: 6 }}>Work first: {hoods.slice(0, HEAT_TOP).map((h: any) => h.name).join(", ").replace(/, ([^,]*)$/, " and $1")}. They top Qloo's map of where {e.routes[0]?.drinker?.name ?? "your drinker's"} drinkers are in {c.name}, so the first day leans there.</T> : null}
          </View>
        </View>} />
      <Toast toast={e.toast} onUndo={() => { const u = e.toast?.undo; e.clearToast(); u?.(); }} onClose={() => e.clearToast()} />
    </Screen>
  );
}

// Fix 8: Doors didn't answer (no signal, the Worker down, a timeout): said as that, with Try again first; never "No rooms"
const offlinePhase = (err: any): Phase => ({ k: "error", title: UNREACHABLE.title, text: err.message, hint: err.hint, retry: true, offline: true });

function PhaseView({ phase, e, onRetry, onEdit }: { phase: Phase; e: PlanEngine; onRetry: () => void; onEdit: () => void }) {
  const nav = useNav();
  if (phase.k === "live") {
    return (
      <Screen title="Building your plan" testID="live-run">
        <T k="h2">Doors is asking Qloo…</T>
        <T k="muted">Which bars and restaurants in {e.c.name} have regulars who drink what your drinkers drink. About a minute the first time; this plan opens at once after that.</T>
        {phase.names.map((d) => (
          <View key={d} style={s.card}>
            <T k="h3">{d}</T>
            {LIVE_STEPS.map(([id, t], k) => {
              const at = phase.at[d]?.step ?? 0;
              const done = k < at;
              const now = k === at;
              return (
                <View key={id} style={{ flexDirection: "row", gap: 8, marginTop: 6 }}>
                  <Text style={{ width: 18, color: done ? C.done : now ? C.amber : C.ink3 }}>{done ? "✓" : now ? "●" : "○"}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.body, !done && !now && { color: C.ink3 }]}>{t(d, e.c.name)}</Text>
                    {phase.at[d]?.detail[k] ? <Text maxFontSizeMultiplier={2} style={s.small}>{phase.at[d].detail[k]}</Text> : null}
                  </View>
                </View>
              );
            })}
          </View>
        ))}
      </Screen>
    );
  }
  if (phase.k === "building") {
    return (
      <Screen title="Building your plan" testID="building">
        <T k="small" style={{ textTransform: "uppercase", fontWeight: "700", letterSpacing: 0.6 }}>Building your plan</T>
        <T k="h2" style={{ marginTop: 4 }}>{phase.total}</T>
        {phase.steps.map(([t, sub], k) => (
          <View key={t} style={{ flexDirection: "row", gap: 10, marginTop: 14 }}>
            <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: k < phase.step ? C.done : k === phase.step ? C.amber : C.line, alignItems: "center", justifyContent: "center" }}>
              {k === phase.step ? <ActivityIndicator size="small" color="#fff" /> : <Text style={{ color: "#fff", fontWeight: "700" }}>{k < phase.step ? "✓" : ""}</Text>}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={[s.body, k > phase.step && { color: C.ink3 }]}>{t}</Text>
              <Text maxFontSizeMultiplier={2} style={s.small}>{sub}</Text>
            </View>
          </View>
        ))}
        {phase.step >= phase.steps.length ? <T k="h3" style={{ marginTop: 16, color: C.done }}>Your plan is ready.</T> : null}
      </Screen>
    );
  }
  if (phase.k === "error") {
    return (
      <Screen title="Your plan" testID="plan-error">
        <T k="h2">{phase.title}</T>
        <T k="body">{phase.text}</T>
        {phase.hint ? <T k="body" style={{ marginTop: 6 }}>{phase.hint}</T> : null}
        {phase.offline ? (
          <>
            <Btn label="Try again" onPress={onRetry} />
            <Btn kind="line" label="Edit profile" onPress={onEdit} />
          </>
        ) : (
          <>
            <Btn label="Edit profile" onPress={onEdit} />
            {phase.retry ? <Btn kind="line" label="Try again" onPress={onRetry} /> : null}
          </>
        )}
      </Screen>
    );
  }
  if (phase.k === "resting") {
    return (
      <Screen title="Your plan" testID="plan-resting">
        <T k="h2">New plans are off for today</T>
        <T k="body">{phase.message}</T>
        <Btn label="See the examples" onPress={() => nav.replace("form", {})} />
        {phase.runs.length ? (
          <View style={{ marginTop: 12 }}>
            <T k="small">Plans already built (they open without new Qloo calls)</T>
            <Row style={{ marginTop: 6 }}>
              {phase.runs.map((r: any, i: number) => <Chip key={i} label={`${r.name} · ${r.cityName ?? r.city}`} onPress={() => { saveDraft(profileForRun(e.profile, r, index), null); nav.replace("form", {}); }} />)}
            </Row>
          </View>
        ) : null}
      </Screen>
    );
  }
  return (
    <Screen title="Your plan" testID="plan-loading">
      <ActivityIndicator size="large" style={{ marginTop: 40 }} />
      <T k="muted" style={{ textAlign: "center", marginTop: 12 }}>Ranking {e.c.name}'s bars and restaurants…</T>
    </Screen>
  );
}
