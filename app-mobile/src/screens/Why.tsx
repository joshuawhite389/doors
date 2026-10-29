// "What your plan is based on" (public/ui/basis.js on the web; Jard 10-23 items 2 + 7): the facts the plan is built on,
// as short plain sentences in groups (your corrections, doors on your plan, doors left out, your drinker, the city,
// your settings), from lib/basis.js. Each fact can name its doors ("Show on map") and carry fixes; "Change" opens the
// iOS action sheet of fixes, each one an existing plan action (already know them, not a fit, add to my plan, famous
// doors, Edit profile, Doors Agent), so the plan, its toast (which names the stop that moved) and Doors Agent all
// follow it. A door opens its own view: its way through the six gates (lib/basis.js doorTrail), what to say, its fixes.
// "Why isn't … on my plan?" finds any door Qloo ranked. Every number is Qloo's or counted from Qloo's data.
import { useEffect, useMemo, useState } from "react";
import { Linking, Pressable, Switch, Text, TextInput, View } from "react-native";
import * as I from "../../../public/lib/insights.js";
import { mergeLists } from "../../../public/lib/pool.js";
import { sieve, mapPlaces } from "../../../public/lib/sieve.js";
import { basis, doorTrail, findDoors, sourcesLine, BASIS_TITLE, WHY_DOOR, SHOW, SETTINGS_LINK } from "../../../public/lib/basis.js";
import { usePlanEngine } from "./Plan";
import { base } from "./Room";
import { index } from "../session";
import { getJSON } from "../data";
import { useAgentSpot, useNav } from "../nav";
import PlanMap, { type MapPin } from "../components/PlanMap";
import { Btn, C, DAY_COLOURS, Row, Screen, Scroll, T, Toast, menu, s, useBigText } from "../ui";
import { hasWebsite, webSearchHref } from "../../../public/lib/note.js";
import { Ic } from "../icons"; // the Doors icon set (Jard 10-24 #1)

const OUT_FILL = "#6F6A60";
const link = { color: C.green, fontWeight: "600" as const, fontSize: 15 };
type Lit = { title: string; ids: string[] };

export default function Why({ params }: { params: any }) {
  const nav = useNav();
  const e = usePlanEngine(params);
  const bigText = useBigText(); // the 4 number boxes go two by two at big text, so no number or word splits (mobile2 10-23)
  const [data, setData] = useState<any>(null);
  const [drinker, setDrinker] = useState(0);
  const [door, setDoor] = useState<string | null>(params.door ?? null); // the stop's "Why this door" row opens here on its door
  const [lit, setLit] = useState<Lit | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  // intuit audit #9: a door's view here has its own "tell Doors Agent" fix, so no 💬 beside it
  useAgentSpot({ hide: !!door });
  const plan = e?.plan;

  useEffect(() => {
    if (!plan || !index) return;
    let on = true;
    const cityKey = plan.city.key;
    const brandFiles = index.brands.map((b: any) => `${b.key}-${cityKey}`).filter((f: string) => index.files.includes(f));
    Promise.all([
      getJSON(`/data/cities/${cityKey}.json`).catch(() => null),
      getJSON(`/data/strip/${cityKey}.json`).catch(() => null),
      Promise.all(brandFiles.map((f: string) => getJSON(`/data/routes/${f}.json`).catch(() => null))),
    ]).then(([city, strip, cityRoutes]) => on && setData({ city, strip, base: I.cityRooms((cityRoutes as any[]).filter(Boolean)) }));
    return () => { on = false; };
  }, [plan?.city?.key]);

  const famous = !!e?.st?.famous;
  const m = useMemo(() => {
    if (!e || !plan || !data || !e.routes.length) return null;
    const routes = e.routes;
    const profile = e.profile;
    const route = routes[Math.min(drinker, routes.length - 1)];
    const venues = { ...route.venues, ...plan.venues };
    const cv = I.curve(route, plan.pool.ids, { famous });
    const myIds = cv.rows.map((r: any) => r.id);
    const mine = profile.venue || profile.pours?.length ? [] : profile.drinks.filter((x: any) => x.ready).map((x: any) => x.key);
    const baseIds = mine.length === 1 && data.strip?.brands?.[mine[0]] ? data.strip.brands[mine[0]].ids : mergeLists(routes).ids.slice(0, 50);
    const sv = sieve({ route, plan, profile, famous, city: data.city });
    const rules = (() => { try { return e.store.getRules(e.brand) ?? []; } catch { return []; } })();
    const ctx = {
      sv, cv, venues, plan, profile, famous, rules, cityName: plan.city.name, added: (e.st.added ?? []).map((a: any) => a.id),
      hasFamous: !!route.lists?.famous?.length, talk: data.city?.talk?.venues ?? {},
      pop: I.popularity(route, cv.rows, venues),
      shared: I.shared({ strip: data.strip, base: baseIds, brands: index.brands, mine }),
      crowd: I.crowd(myIds.slice(0, 50), venues, { base: data.base.ids, baseVenues: data.base.venues }),
      sound: I.sound(myIds, data.city?.sounds ?? {}),
      funnel: I.funnel(route, { pool: plan.pool.ids, plan: I.planIds(plan) }),
    };
    return { ctx, b: basis(ctx), route, venues, sv };
  }, [e, plan, data, drinker, famous, e?.st?.added, e?.st?.statuses]);

  if (!e || !plan) return <Screen title={BASIS_TITLE}><T k="muted">That plan isn't open.</T></Screen>;
  if (!m) return <Screen title={BASIS_TITLE} testID="why"><T k="muted">Reading Qloo's data for these doors…</T></Screen>;
  const { b, sv } = m;
  const dayOf: Map<string, number> = I.dayOfId(plan);
  const placeOf = (id: string) => b.doors.get(id) ?? sv.lookalikes.find((d: any) => d.id === id) ?? null;
  const venueOf = (id: string) => plan.venues[id] ?? m.route.venues[id] ?? placeOf(id)?.venue ?? data.city?.sisterVenues?.[id] ?? null;

  // ---------- fixes: each one an existing plan action ----------
  const run = async (f: any) => {
    setBusy(true);
    try {
      if (f.kind === "status") { await e.setStatus(f.id, f.status); if (f.status) setDoor(null); }
      else if (f.kind === "add") { const v = venueOf(f.id); if (v) await e.addDoor({ ...v, id: f.id }, { date: null }); }
      else if (f.kind === "famous") await e.setFamous(f.on);
      else if (f.kind === "profile") nav.push("form", e.demo ? { demo: true } : { edit: e.key });
      else if (f.kind === "agent") nav.push("ask", { ...base(params), current: f.id ?? undefined, prefill: f.prefill });
      else if (f.kind === "rule") e.setSlot(null as any, { clear: f.rule.field, value: f.rule.value });
    } finally { setBusy(false); }
  };
  const change = (title: string, fixes: any[]) => (fixes.length === 1 ? run(fixes[0]) : menu(title, fixes.map((f) => ({ label: f.label, on: () => run(f) }))));
  const openStop = (id: string) => plan.venues[id] && nav.push("stop", { ...base(params), id, day: dayOf.get(id) ?? null });

  // ---------- the map (Show on map): the plan's doors in their days' colours, the lit doors ringed ----------
  const mapView = lit ? (() => {
    const sel = new Set(lit.ids);
    const pins: MapPin[] = [];
    const seen = new Set<string>();
    mapPlaces(sv).filter((d: any) => d.fate === "plan" && !d.like).forEach((d: any) => {
      seen.add(d.id);
      const day = d.day ?? 0;
      const n = plan.days[day]?.stops.findIndex((x: any) => x.id === d.id);
      pins.push({ id: d.id, lat: d.lat, lon: d.lon, label: n >= 0 ? String(n + 1) : "•", color: DAY_COLOURS[day % DAY_COLOURS.length], title: d.name, sub: d.reason, z: 20, ring: sel.has(d.id) });
    });
    for (const id of lit.ids) {
      if (seen.has(id)) continue;
      const v = plan.venues[id] ?? m.route.venues[id] ?? placeOf(id);
      if (!v || !Number.isFinite(v.lat) || !Number.isFinite(v.lon)) continue;
      pins.push({ id, lat: v.lat, lon: v.lon, label: "·", color: OUT_FILL, title: v.name, z: 10, ring: true });
    }
    return (
      <View style={{ position: "absolute", left: 0, right: 0, top: 0, bottom: 0, backgroundColor: C.bg }} testID="why-map">
        <View style={{ flex: 1 }}><PlanMap days={[]} extra={pins} onPin={(id) => { setLit(null); if (placeOf(id)) setDoor(id); }} fitKey={`${lit.title}|${lit.ids.length}`} focus={null} /></View>
        <View style={{ backgroundColor: C.paper, borderTopWidth: 1, borderColor: C.line, padding: 14 }}>
          <Text style={s.body}><Text style={{ fontWeight: "700" }}>{lit.title}</Text> · ringed on the map. Tap a door to see it.</Text>
          <Btn small kind="line" label="Back to the list" onPress={() => setLit(null)} style={{ marginTop: 10 }} testID="w-back" />
        </View>
      </View>
    );
  })() : null;

  // ---------- one fact ----------
  const Fact = ({ f, last }: { f: any; last: boolean }) => {
    const sw = f.on !== undefined;
    return (
      <View style={{ paddingVertical: 12, borderBottomWidth: last ? 0 : 1, borderColor: C.line2 }} testID={`w-fact-${f.key}`}>
        <Row wrap={false} style={{ alignItems: "flex-start", gap: 10 }}>
          <Pressable style={{ flex: 1 }} disabled={!f.door} onPress={() => f.door && setDoor(f.door)} accessibilityRole={f.door ? "button" : undefined} accessibilityHint={f.door ? "Shows why Doors picked it or left it out" : undefined}>
            <Text style={[s.body, { fontWeight: "600" }]}>{f.text}</Text>
            {f.more ? <Text maxFontSizeMultiplier={2} style={[s.muted, { marginTop: 2 }]}>{f.more}</Text> : null}
          </Pressable>
          {sw ? <Switch value={!!f.on} disabled={busy} onValueChange={() => run(f.fixes[0])} accessibilityLabel={f.fixes[0]?.label} testID={`w-switch-${f.key}`} /> : f.door ? <Text style={{ color: C.ink3, fontSize: 20, marginTop: -2 }}>›</Text> : null}
        </Row>
        {(!sw && f.fixes.length) || f.ids.length > 1 ? (
          <Row style={{ gap: 18, marginTop: 6 }}>
            {!sw && f.fixes.length ? <Pressable onPress={() => change(f.text, f.fixes)} disabled={busy} hitSlop={8} accessibilityRole="button" accessibilityLabel={f.fixes.length === 1 ? f.fixes[0].label : `Change: ${f.text}`} testID={`w-fix-${f.key}`} style={{ minHeight: 32, justifyContent: "center" }}><Text style={link}>{f.fixes.length === 1 ? f.fixes[0].label : "Change"}</Text></Pressable> : null}
            {f.ids.length > 1 ? <Pressable onPress={() => setLit({ title: f.text.replace(/[.:].*$/, ""), ids: f.ids })} hitSlop={8} accessibilityRole="button" testID={`w-map-${f.key}`} style={{ minHeight: 32, justifyContent: "center" }}><Text style={link}>Show on map</Text></Pressable> : null}
          </Row>
        ) : null}
      </View>
    );
  };

  // ---------- one door: its way through the gates ----------
  const doorView = door ? (() => {
    const d = placeOf(door);
    const t = doorTrail(d, m.ctx);
    if (!t) return null;
    const v = venueOf(door) ?? {};
    const web = hasWebsite(v) ? v.website : webSearchHref({ ...v, name: v.name ?? t.name }, plan.city?.name);
    return (
      <Scroll key={door} contentContainerStyle={s.pad} testID="w-door">
        <T k="h2">{t.name}</T>
        <Text style={[s.body, { color: C.ink2 }]}>{t.head}</Text>
        <View style={{ backgroundColor: C.paper, borderWidth: 1, borderColor: C.line, borderRadius: 14, paddingHorizontal: 14, marginTop: 12 }}>
          {t.lines.map((l: any, i: number) => (
            <Row key={i} wrap={false} style={{ gap: 10, paddingVertical: 10, borderBottomWidth: i === t.lines.length - 1 ? 0 : 1, borderColor: C.line2, alignItems: "flex-start" }}>
              <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: l.ok ? C.green : C.amber, alignItems: "center", justifyContent: "center", marginTop: 1 }}><Ic name={l.ok ? "check" : "close"} size={13} color="#fff" /></View>
              <Text style={[s.body, { flex: 1, fontSize: 15 }]} accessibilityLabel={`${l.ok ? "Passed" : "Stopped"}: ${l.text}`}>{l.text}</Text>
            </Row>
          ))}
        </View>
        {t.say || t.crowd ? (
          <View style={{ marginTop: 16 }}>
            <T k="label">What to say</T>
            {t.say ? <View style={{ backgroundColor: C.greenSoft, borderRadius: 12, padding: 12 }}><Text style={[s.body, { fontSize: 15 }]}>“{t.say}”</Text></View> : null}
            {t.crowd ? <Text maxFontSizeMultiplier={2} style={[s.small, { marginTop: 6 }]}>Qloo on the crowd: {t.crowd}</Text> : null}
          </View>
        ) : null}
        {t.fixes.length ? (
          <View style={{ marginTop: 16, gap: 8 }} testID="w-door-fixes">
            <T k="label">Is something here wrong?</T>
            {t.fixes.map((f: any) => <Btn key={f.label} kind="line" label={f.label} disabled={busy} onPress={() => run(f)} testID={`w-dfix-${f.kind}${f.status ? `-${f.status}` : ""}`} />)}
          </View>
        ) : null}
        <Row style={{ columnGap: 18, rowGap: 0, marginTop: 14 }}>
          {plan.venues[door] && d?.fate === "plan" ? <Pressable onPress={() => openStop(door)} accessibilityRole="button" style={{ minHeight: 44, justifyContent: "center" }}><Text style={link}>Open the stop</Text></Pressable> : null}
          <Pressable onPress={() => nav.push("room", { ...base(params), id: door, venue: plan.venues[door] ? undefined : v })} accessibilityRole="button" style={{ minHeight: 44, justifyContent: "center" }} testID="w-door-room"><Text style={link}>Everything Qloo knows</Text></Pressable>
          {web ? <Pressable onPress={() => Linking.openURL(web)} accessibilityRole="link" style={{ minHeight: 44, justifyContent: "center" }}><Text style={link}>{hasWebsite(v) ? "Website ↗" : "Search the web ↗"}</Text></Pressable> : null}
          {Number.isFinite(v.lat) ? <Pressable onPress={() => setLit({ title: t.name, ids: [door] })} accessibilityRole="button" style={{ minHeight: 44, justifyContent: "center" }}><Text style={link}>Show on map</Text></Pressable> : null}
        </Row>
      </Scroll>
    );
  })() : null;

  const found = findDoors(sv, q);
  const routes = e.routes;
  return (
    <Screen title={door ? WHY_DOOR : BASIS_TITLE} scroll={false} testID="why" back={lit ? () => setLit(null) : door && door !== params.door ? () => setDoor(null) : true}
      footer={<Toast toast={e.toast} onUndo={() => { e.toast?.undo?.(); e.clearToast(); }} onClose={() => e.clearToast()} />}>
      {doorView ?? (
        <Scroll contentContainerStyle={s.pad} keyboardShouldPersistTaps="handled" testID="w-list">
          <Text style={[s.body, { color: C.ink2 }]}>{b.intro}</Text>
          <Row key={bigText ? "big" : "std"} wrap={bigText} style={{ marginTop: 12, gap: 6 }} testID="w-steps">
            {b.steps.map((st: any, i: number) => (
              <View key={i} style={{ ...(bigText ? { flexBasis: "45%", flexGrow: 1, flexShrink: 0 } : { flexBasis: 0, flexGrow: 1, flexShrink: 1 }), backgroundColor: i === b.steps.length - 1 ? C.green : C.paper, borderWidth: 1, borderColor: i === b.steps.length - 1 ? C.green : C.line, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 6 }}>
                <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.5} style={{ fontSize: 20, fontWeight: "800", color: i === b.steps.length - 1 ? "#fff" : C.ink }}>{st.n}</Text>
                <Text maxFontSizeMultiplier={1.6} style={[s.small, { fontSize: 12, lineHeight: 15 }, i === b.steps.length - 1 ? { color: "#fff" } : null]}>{st.label}</Text>
              </View>
            ))}
          </Row>
          {routes.length > 1 ? (
            <Row style={{ marginTop: 12, gap: 6 }} testID="w-drinkers">
              {routes.map((r: any, i: number) => (
                <Pressable key={i} onPress={() => { setDrinker(i); setOpen({}); }} accessibilityRole="button" accessibilityState={{ selected: i === drinker }} style={{ paddingVertical: 7, paddingHorizontal: 12, borderRadius: 99, backgroundColor: i === drinker ? C.ink : C.chip }}>
                  <Text style={{ fontSize: 14, color: i === drinker ? "#fff" : C.ink }}>{r.drinker?.name ?? ""} drinkers</Text>
                </Pressable>
              ))}
            </Row>
          ) : null}
          {b.groups.map((g: any) => {
            const all = open[g.key];
            const shown = all ? g.facts : g.facts.slice(0, SHOW);
            return (
              <View key={g.key} style={{ marginTop: 20 }} testID={`w-group-${g.key}`}>
                <Text style={s.h3} accessibilityRole="header">{g.title}</Text>
                <View style={{ backgroundColor: C.paper, borderWidth: 1, borderColor: C.line, borderRadius: 14, paddingHorizontal: 14, marginTop: 8 }}>
                  {shown.map((f: any, i: number) => <Fact key={f.key} f={f} last={i === shown.length - 1 && !(g.facts.length > SHOW)} />)}
                  {g.facts.length > SHOW ? (
                    <Pressable onPress={() => setOpen({ ...open, [g.key]: !all })} accessibilityRole="button" accessibilityState={{ expanded: !!all }} style={{ paddingVertical: 12 }} testID={`w-more-${g.key}`}>
                      <Text style={link}>{all ? "Show fewer" : `Show ${g.facts.length - SHOW} more`}</Text>
                    </Pressable>
                  ) : null}
                </View>
                {g.key === "out" ? (
                  <View style={{ marginTop: 10 }}>
                    <TextInput value={q} onChangeText={setQ} placeholder="Why isn't … on my plan?" placeholderTextColor={C.ph} style={s.input} accessibilityLabel="Find a door: why isn't it on my plan?" testID="w-find" autoCorrect={false} />
                    {found.map((d: any) => (
                      <Pressable key={d.id} onPress={() => { setQ(""); setDoor(d.id); }} accessibilityRole="button" style={{ paddingVertical: 10, borderBottomWidth: 1, borderColor: C.line2 }}>
                        <Text style={s.body}>{d.name} <Text style={s.small}>{d.fate === "plan" ? "on your plan" : d.like ? "not on Qloo's list" : "left out"}</Text></Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </View>
            );
          })}
          {/* intuitiveness audit #8: door types and days live in Settings; one link, not a second Settings here */}
          {nav.has("settings") ? <Pressable onPress={() => nav.push("settings", base(params))} accessibilityRole="button" style={{ minHeight: 44, justifyContent: "center", marginTop: 14 }} testID="w-settings"><Text style={link}>{SETTINGS_LINK}</Text></Pressable> : null}
          <Text maxFontSizeMultiplier={2} style={[s.small, { marginTop: 18 }]}>{sourcesLine(e.captured, e.plan?.source, e.demo?.travelNote ?? null)}</Text>
        </Scroll>
      )}
      {mapView}
    </Screen>
  );
}
