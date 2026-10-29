// The brand form (#/new, #/edit, Duplicate): public/ui/profile.js on the phone. Same profile, same fields, same
// validation (lib/profile.js validateProfile: errors show once a field is touched; "Still needed: …"; Build is off
// until it's ok), same searches (held brands + drinks.json as you type, Qloo only on "Search Qloo"), same city list,
// starting points, address predictions and a pin map. The draft is saved on every edit (as ui/app.js).
import { useEffect, useMemo, useRef, useState } from "react";
import { Keyboard, Pressable, Text, TextInput, View } from "react-native";
import { ROOMS, SUPPORT, roomChoices, defaultRooms, validateProfile, nextDays, dayChip, isoDate, dayOf, MAX_DRINKS, MAX_POURS, poursOf, startChips, chipStart, pinLabel, emptyProfile, formFilled, roomOf, toMinutes, clock12 } from "../../../public/lib/profile.js";
import { examples, exampleOf, fictionLine, cityFromText, cityText } from "../../../public/lib/examples.js";
import { mergeLists, knownHint as knownHintOf, KEEP_ON_ROUTE } from "../../../public/lib/pool.js";
import { genreLabel } from "../../../public/lib/core.js";
import { defaultAsk } from "../../../public/lib/talk.js";
import { searchDrinks, heldMatch, fold } from "../../../public/lib/drinks.js";
import * as cl from "../../../public/lib/citylist.js";
import { copyProfile } from "../../../public/lib/plans.js";
import { makeRecord, supersededRules, ruleInName } from "../../../public/lib/slots.js";
import { searchBrands, searchRooms, loadDrinks, geocode, loadRoutes, locateCity, autocomplete, type GeoRow } from "../data";
import { index, readDraft, saveDraft, savedProfile, keyOf, store, dropEngine, rulesChanged } from "../session";
import { useAgentSpot, useNav } from "../nav";
import { cap } from "../engine";
import PlanMap from "../components/PlanMap";
import { Btn, C, Chip, Fold, Row, Screen, T, s, useBigText } from "../ui";
import { PlansList } from "./Home";
import { tour } from "../tour";
import { openDemo } from "../session";

const clone = <X,>(x: X): X => JSON.parse(JSON.stringify(x));
const DEFAULT_FROM = "14:00";
const DEFAULT_TO = "18:00";
const GATED = ["name", "drinks", "city", "rooms", "start", "windows", "visitMin"];
const NEED: Record<string, string> = { name: "a name to sign your messages", drinks: "a brand your drinker drinks (or a door that pours you)", city: "a city", rooms: "door types", start: "where your day starts", windows: "when you're free", visitMin: "time at each door" };
const SEARCH_OFF = "Address search is off right now: pick a starting point below or drop a pin.";
const PIN_ONLY = "Drop a pin on the map to set your start.";
const fiction = (x: any) => (x.key === "maya" ? "Tidewell and Maya are made up; every bar and restaurant is real." : fictionLine(x));
const signerHint = (brand: string) => `Your name, or “The ${String(brand ?? "").trim() || "Tidewell"} team”`;
const askHint = (what: string) => `Left blank, your notes ask for ${defaultAsk(what)}.`;
const unslug = (k: string) => String(k ?? "").replace(/-([a-z]{2})$/i, (_m, st) => `, ${st.toUpperCase()}`).split("-").map((w) => w.replace(/^\p{Ll}/u, (c) => c.toUpperCase())).join(" ");
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

// A typeahead: the input, its options inline below it (a phone has no room for a floating list).
function Options({ rows, notes, onPick, testID }: { rows: { key: string; name: string; sub?: string; search?: boolean; city?: string; right?: string }[]; notes?: string[]; onPick: (i: number) => void; testID?: string }) {
  if (!rows.length && !notes?.length) return null;
  return (
    <View style={{ borderWidth: 1, borderColor: C.line, borderRadius: 12, backgroundColor: C.paper, marginTop: 6, overflow: "hidden" }} testID={testID}>
      {rows.map((o, i) => (
        <Pressable key={o.key + i} onPress={() => onPick(i)} accessibilityRole="button" style={({ pressed }) => [{ paddingVertical: 11, paddingHorizontal: 12, borderBottomWidth: 1, borderColor: C.line2 }, pressed && { backgroundColor: C.greenSoft }]}>
          {o.search ? <Text style={{ fontSize: 16, color: C.green, fontWeight: "600" }}>Search Qloo for “{o.name}”{o.city ? ` in ${o.city}` : ""}</Text> : (
            <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
              <View style={{ flex: 1 }}><Text style={{ fontSize: 16, color: C.ink }}>{o.name}</Text>{o.sub ? <Text maxFontSizeMultiplier={2} style={s.small}>{o.sub}</Text> : null}</View>
              {o.right ? <Text maxFontSizeMultiplier={2} style={s.small}>{o.right}</Text> : null}
            </View>
          )}
        </Pressable>
      ))}
      {(notes ?? []).map((n) => <Text key={n} style={[s.muted, { padding: 12 }]}>{n}</Text>)}
    </View>
  );
}
function Tags({ items, onRemove }: { items: { name: string; sub?: string }[]; onRemove: (i: number) => void }) {
  if (!items.length) return null;
  return (
    <Row style={{ marginBottom: 6 }}>
      {items.map((x, i) => (
        <Pressable key={x.name + i} onPress={() => onRemove(i)} accessibilityRole="button" accessibilityLabel={`Remove ${x.name}`} style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: C.greenSoft, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 }}>
          <Text style={{ fontSize: 15, color: C.ink }}>{x.name}{x.sub ? <Text maxFontSizeMultiplier={2} style={s.small}> · {x.sub}</Text> : null}</Text>
          <Text style={{ fontSize: 16, color: C.ink3 }}>×</Text>
        </Pressable>
      ))}
    </Row>
  );
}
const fieldY: Record<string, number> = {}; // where each field sits in the form (the guided demo scrolls to it)
function Field({ label, hint, err, children, testID }: { label: string; hint?: string; err?: string | null; children: React.ReactNode; testID?: string }) {
  return (
    <View style={{ marginTop: 18 }} testID={testID} onLayout={testID ? (ev) => (fieldY[testID] = ev.nativeEvent.layout.y) : undefined}>
      <Text style={s.label}>{label}</Text>
      {children}
      {hint ? <Text maxFontSizeMultiplier={2} style={[s.small, { marginTop: 4 }]}>{hint}</Text> : null}
      {err ? <Text style={s.err}>{err}</Text> : null}
    </View>
  );
}
// a time, in 15-minute steps: ‹ 2:00 pm ›
function TimeStep({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) {
  const m = toMinutes(value) ?? 0;
  const step = (d: number) => onChange(hhmm(Math.max(0, Math.min(23 * 60 + 45, m + d))));
  return (
    <View style={{ flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: C.line, borderRadius: 10, backgroundColor: C.paper }} accessible accessibilityRole="adjustable" accessibilityLabel={label} accessibilityValue={{ text: clock12(m) }} accessibilityActions={[{ name: "increment" }, { name: "decrement" }]} onAccessibilityAction={(e) => step(e.nativeEvent.actionName === "increment" ? 15 : -15)}>
      <Pressable onPress={() => step(-15)} onLongPress={() => step(-60)} hitSlop={6} style={{ paddingHorizontal: 10, paddingVertical: 8 }}><Text style={{ fontSize: 18, color: C.green }}>‹</Text></Pressable>
      <Text style={{ fontSize: 15, minWidth: 66, textAlign: "center", color: C.ink }}>{clock12(m)}</Text>
      <Pressable onPress={() => step(15)} onLongPress={() => step(60)} hitSlop={6} style={{ paddingHorizontal: 10, paddingVertical: 8 }}><Text style={{ fontSize: 18, color: C.green }}>›</Text></Pressable>
    </View>
  );
}

// Another day (the web's date input): any date from today on, a month at a time; a tap adds that day, a picked day is
// ticked. Plain views: no native date picker module.
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
function MonthPicker({ min, picked, onPick }: { min: string; picked: string[]; onPick: (d: string) => void }) {
  const [y0, m0] = min.split("-").map(Number);
  const [at, setAt] = useState({ y: y0, m: m0 - 1 }); // m: 0–11
  const first = new Date(at.y, at.m, 1);
  const n = new Date(at.y, at.m + 1, 0).getDate();
  const cells: (string | null)[] = [...Array(first.getDay()).fill(null), ...Array.from({ length: n }, (_, i) => isoDate(new Date(at.y, at.m, i + 1)))];
  while (cells.length % 7) cells.push(null);
  const step = (k: number) => setAt(({ y, m }) => ({ y: y + Math.floor((m + k) / 12), m: (m + k + 12) % 12 }));
  const canBack = at.y > y0 || (at.y === y0 && at.m > m0 - 1);
  const nav = (k: number, on: boolean, a11y: string, t: string) => (
    <Pressable onPress={() => on && step(k)} disabled={!on} accessibilityRole="button" accessibilityLabel={a11y} accessibilityState={{ disabled: !on }} hitSlop={6}
      style={{ minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center", opacity: on ? 1 : 0.3 }}><Text style={{ fontSize: 20, color: C.green, fontWeight: "700" }}>{t}</Text></Pressable>
  );
  return (
    <View style={[s.card, { padding: 8, marginTop: 8 }]} testID="month-picker">
      <Row wrap={false} style={{ justifyContent: "space-between", alignItems: "center" }}>
        {nav(-1, canBack, "Previous month", "‹")}
        <T k="h3">{MONTHS[at.m]} {at.y}</T>
        {nav(1, true, "Next month", "›")}
      </Row>
      <View style={{ flexDirection: "row" }}>{["S", "M", "T", "W", "T", "F", "S"].map((d, i) => <Text key={i} style={[s.small, { flex: 1, textAlign: "center" }]} accessibilityElementsHidden importantForAccessibility="no">{d}</Text>)}</View>
      {Array.from({ length: cells.length / 7 }, (_, r) => (
        <View key={r} style={{ flexDirection: "row" }}>
          {cells.slice(r * 7, r * 7 + 7).map((d, i) => {
            if (!d) return <View key={i} style={{ flex: 1, minHeight: 44 }} />;
            const off = d < min;
            const on = picked.includes(d);
            return (
              <Pressable key={i} onPress={() => !off && !on && onPick(d)} disabled={off || on} accessibilityRole="button" accessibilityLabel={`${dayChip(d)}${on ? ", added" : ""}`} accessibilityState={{ disabled: off, selected: on }} testID={`pick-${d}`}
                style={{ flex: 1, minHeight: 44, alignItems: "center", justifyContent: "center" }}>
                <View style={{ width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: on ? C.green : "transparent" }}>
                  <Text style={{ fontSize: 15, color: on ? "#fff" : off ? C.line : C.ink, fontWeight: d === min ? "800" : "500" }} allowFontScaling={false}>{+d.slice(8)}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

export default function Form({ params }: { params: { edit?: { brand: string; city: string }; copy?: boolean; blank?: boolean; demo?: boolean; tour?: boolean } }) {
  // intuit 1b #6 (mobile2 10-24): no 💬 on the form. It only showed on Edit profile, where it sat in the pinned bar beside
  // Save and re-plan and at AX sizes covered Brand name; the form is for filling in, the plan is where you ask
  useAgentSpot({ hide: true });
  const nav = useNav();
  // what the form starts from (ui/app.js show(): #/edit loads a saved plan's profile, a copy, the demo's, or blank)
  const init = useMemo(() => {
    if (params.edit) {
      const saved = savedProfile(params.edit.brand, params.edit.city);
      if (saved) {
        const editOf = { ...params.edit, name: saved.brand, ...(params.copy ? { copy: true } : {}) };
        const p = params.copy ? copyProfile(saved) : saved;
        saveDraft(p, editOf);
        return { p, editOf };
      }
    }
    if (params.tour) return { p: { ...emptyProfile(), ...tour.form }, editOf: null };
    if (params.demo) {
      const p = { ...exampleOf("maya").profile, sample: true };
      saveDraft(p, null);
      return { p, editOf: null };
    }
    if (params.blank) {
      saveDraft(emptyProfile(), null);
      return { p: emptyProfile(), editOf: null };
    }
    const d = readDraft();
    // Jard 10-23 #1: a draft still editing a plan that's gone (deleted) starts blank, not as Edit of the deleted one
    if (d.editOf && !d.editOf.copy && !savedProfile(d.editOf.brand, d.editOf.city)) {
      saveDraft(emptyProfile(), null);
      return { p: emptyProfile(), editOf: null };
    }
    // owner 10-23: after the demo, Start with my brand showed Maya's profile (the demo leaves her as an untouched sample
    // draft). An example nobody has changed isn't theirs: start blank; the Examples row is still one tap away
    if (d.profile.sample && !d.editOf) {
      saveDraft(emptyProfile(), null);
      return { p: emptyProfile(), editOf: null };
    }
    return { p: d.profile, editOf: d.editOf };
  }, []);
  const [p, setP] = useState<any>(() => clone(init.p));
  const [editOf, setEditOf] = useState<any>(init.editOf);
  const [touched, setTouched] = useState<Set<string>>(() => new Set(init.editOf && !String(init.p.pitch?.name ?? "").trim() ? ["name"] : []));
  const touch = (...k: string[]) => setTouched((t) => new Set([...t, ...k]));
  const days = useMemo(() => nextDays(new Date()), []);
  const today = isoDate(new Date());
  const city = index.cities.find((c: any) => c.key === p.city);
  // every edit: a new profile object, saved as the draft
  const upd = (f: (q: any) => void) => setP((cur: any) => {
    const q = clone(cur);
    f(q);
    saveDraft(q, editOf);
    return q;
  });
  useEffect(() => {
    // a profile saved before N3 ("venue": the Parson's preset) reads as that room
    if (!p.pours?.length && p.venue) upd((q) => { q.pours = poursOf(q, index.rooms); delete q.venue; });
  }, []);
  const { ok, errors } = validateProfile(p, { cities: index.cities });
  const bigText = useBigText();
  // a one-line field shrinks a placeholder that doesn't fit (mobile2 10-23: tiny hints under big labels): short ones at big text
  const ph = (long: string, short: string) => (bigText ? short : long);
  const err = (k: string) => (touched.has(k) ? errors[k] ?? null : null);
  const missing = GATED.filter((k) => errors[k] && !touched.has(k)).map((k) => NEED[k]);
  const need = ok ? "" : missing.length ? `Still needed: ${missing[0]}${missing.length > 1 ? ` (and ${missing.length - 1} more)` : ""}.` : (Object.values(errors)[0] as string) ?? "";

  // ---------- drinks typeahead ----------
  const [dq, setDq] = useState("");
  const [live, setLive] = useState<any>(null); // rows | "loading" | {error}
  const [drinkList, setDrinkList] = useState<any>(null);
  useEffect(() => { if (dq && drinkList === null) loadDrinks().then((l) => setDrinkList(l ?? false)); }, [dq]);
  const drinkOpts = () => {
    const q = fold(dq);
    if (!q) return [];
    const chosen = new Set(p.drinks.map((d: any) => d.key ?? d.id));
    const held = new Set(index.brands.map((b: any) => b.id));
    const out: any[] = index.brands.filter((b: any) => !chosen.has(b.key) && heldMatch(b, q)).map((b: any) => ({ kind: "ready", key: b.key, name: b.name, sub: b.category }));
    const nReady = out.length;
    out.push(...searchDrinks(drinkList || null, q, 12).filter((d: any) => !held.has(d.id) && !chosen.has(d.id)).slice(0, Math.max(0, 8 - nReady)).map((d: any) => ({ kind: "live", key: d.id, id: d.id, name: d.name, sub: d.kind, cat: d.kind })));
    if (Array.isArray(live)) out.push(...live.filter((r: any) => !chosen.has(r.id) && !held.has(r.id) && !out.some((o) => o.id === r.id)).map((r: any) => ({ kind: "live", key: r.id, id: r.id, name: r.name, sub: r.where })));
    if (q.length >= 2 && live === null) out.push({ kind: "search", key: "search", name: dq.trim(), search: true });
    return out;
  };
  const dOpts = drinkOpts();
  const pickDrink = async (o: any) => {
    if (o.kind === "search") {
      setLive("loading");
      try { setLive(await searchBrands(o.name)); } catch { setLive({ error: "The search didn't go through. Try again in a moment." }); }
      return;
    }
    upd((q) => q.drinks.push(o.kind === "ready" ? { key: o.key, name: o.name, ready: true } : { id: o.id, name: o.name, ready: false, where: o.sub ?? null, ...(o.cat ? { category: o.cat } : {}) }));
    touch("drinks");
    setDq("");
    setLive(null);
  };
  // ---------- rooms that already pour you ----------
  const [rq, setRq] = useState("");
  const [rlive, setRlive] = useState<any>(null);
  // Jard 10-23 #12: its city, with the opening city's smart list (public/lib/citylist.js placeCities); it rides the
  // Qloo search ("Kite String Chicago, IL") and stays for the next one
  const [rcity, setRcity] = useState("");
  const [rcityOpen, setRcityOpen] = useState(false);
  const pourOpts = () => {
    const q = fold(rq);
    const chosen = new Set((p.pours ?? []).map((r: any) => String(r.id).toLowerCase()));
    const out: any[] = q.length >= 2 ? index.rooms.filter((r: any) => r.id && !chosen.has(r.id.toLowerCase()) && fold(r.name).includes(q)).map((r: any) => ({ kind: "room", key: r.id, id: r.id, name: r.name, sub: r.where })) : [];
    if (Array.isArray(rlive)) out.push(...rlive.filter((r: any) => !chosen.has(String(r.id).toLowerCase()) && !out.some((o) => o.id === r.id)).map((r: any) => ({ kind: "room", key: r.id, id: r.id, name: r.name, sub: r.where })));
    if (q.length >= 2 && rlive === null) out.push({ kind: "search", key: "search", name: rq.trim(), city: rcity.trim(), search: true });
    return out;
  };
  const rOpts = pourOpts();
  const pickPour = async (o: any) => {
    if (o.kind === "search") {
      setRlive("loading");
      try { setRlive(await searchRooms(o.city ? `${o.name} ${o.city}` : o.name)); } catch (e: any) { setRlive({ error: /today|easy there|resting/i.test(e.message) ? e.message : "The search didn't go through. Try again in a moment." }); }
      return;
    }
    upd((q) => { q.pours = [...(q.pours ?? []), { id: o.id, name: o.name, where: o.sub ?? null }]; });
    touch("pours", "drinks");
    setRq("");
    setRlive(null);
  };

  // ---------- city ----------
  const [cq, setCq] = useState<string>(() => cityText(init.p, index.cities));
  const [cityOpen, setCityOpen] = useState(false);
  const cityOpts = () => {
    const q = cq.trim();
    const typed = cityFromText(q, index.cities);
    const listed = q ? cl.matchCities(q, index.cities, 8).map((r: any) => ({ key: r.label, row: r, name: r.label })) : [];
    if (listed.length) return listed;
    const held = index.cities.filter((c: any) => !q || c.name.toLowerCase().includes(q.toLowerCase()) || typed.city === c.key).map((c: any) => ({ key: c.key, ckey: c.key, name: c.name }));
    const near = q.length >= 4 ? cl.nearestCity(q, index.cities) : null;
    const nearOpt = near && !held.some((c: any) => c.ckey === near.ready) ? [{ key: "near", row: near, name: `${near.label}?` }] : [];
    return [...nearOpt, ...held, ...(typed.cityLive ? [{ key: "typed", text: typed.cityName, name: `Use “${typed.cityName}” (not on Doors' city list; Qloo may not know it)` }] : [])];
  };
  const typedCity = (text: string) => {
    const hit = cl.listedCity(text, index.cities);
    return hit ? cl.cityPick(hit) : cityFromText(text, index.cities);
  };
  const setCity = (next: any) => {
    setCityOpen(false);
    upd((q) => {
      const was = q.city;
      delete q.cityName;
      delete q.cityLive;
      delete q.cityCenter;
      Object.assign(q, next);
      if (q.city === was) return;
      const c = index.cities.find((x: any) => x.key === q.city);
      if (!c) {
        if (q.start) q.start = null;
        for (const w of q.windows ?? []) delete w.start;
        return;
      }
      if (q.start && validateProfile({ ...q, windows: [] }, { cities: index.cities }).errors.start) {
        const first = startChips(q.city)[0];
        q.start = first ? chipStart(first) : null;
      }
      for (const w of q.windows ?? []) if (w.start && validateProfile({ ...q, start: w.start, windows: [] }, { cities: index.cities }).errors.start) delete w.start;
    });
    touch("city");
    setCq(cityText({ ...p, ...next }, index.cities));
  };
  // a city typed off the list: its centre by its name (ORS), for the address search, the pin map and the far check
  useEffect(() => {
    if (!p.cityLive || !p.cityName || p.cityCenter) return;
    const name = p.cityName;
    locateCity(name).then((at) => { if (at) upd((q) => { if (q.cityName === name) q.cityCenter = [at.lat, at.lon]; }); });
  }, [p.cityName, p.cityLive]);
  useEffect(() => { setAq(p.start?.label ?? ""); }, [p.start?.lat, p.start?.lon, p.start?.chip]);

  // ---------- start ----------
  const [aq, setAq] = useState<string>(init.p.start?.label ?? "");
  const [addr, setAddr] = useState<{ rows: GeoRow[]; note?: string | null }>({ rows: [] });
  const [addrOff, setAddrOff] = useState<string | null>(null);
  const [pinOpen, setPinOpen] = useState(false);
  const centre = () => city?.center ?? (p.cityLive ? p.cityCenter : null) ?? null;
  const liveGeo = () => (p.cityLive ? { cityName: p.cityName, center: p.cityCenter } : null);
  const timer = useRef<any>(null);
  const ctl = useRef<AbortController | null>(null);
  const onAddr = (text: string) => {
    setAq(text);
    if (p.start?.source === "pin") upd((q) => { q.start.label = text.trim() || pinLabel(q.start, q.city, ranked?.venues); });
    else if (p.start) upd((q) => { q.start = null; });
    clearTimeout(timer.current);
    ctl.current?.abort();
    const q = text.trim();
    if (!p.city) return setAddr({ rows: [], note: q ? "Pick a city first." : null });
    const at = centre();
    if (at) {
      if (q.length < 3) return setAddr({ rows: [] });
      timer.current = setTimeout(async () => {
        const c = (ctl.current = new AbortController());
        const res = await autocomplete(q, at, c.signal);
        if (c.signal.aborted) return;
        setAddrOff(res.rows ? null : res.message ?? null);
        setAddr({ rows: res.rows ?? [], note: res.rows && !res.rows.length ? "No match in this city yet: keep typing, or drop a pin." : null });
      }, 250);
    } else {
      if (q.length < 4) return setAddr({ rows: [] });
      if (!city && !p.cityLive) return setAddr({ rows: [], note: PIN_ONLY });
      timer.current = setTimeout(async () => {
        const rows = await geocode(q, p.city, liveGeo());
        setAddrOff(rows === null ? SEARCH_OFF : null);
        setAddr({ rows: rows ?? [], note: rows && !rows.length ? "No match in this city: drop a pin instead." : null });
      }, 450);
    }
  };
  const setStart = (st: any) => { upd((q) => { q.start = st; }); touch("start"); if (st) setAddrOff(null); setAddr({ rows: [] }); };
  const pinStart = (ll: { lat: number; lon: number }) => {
    const typed = aq.trim();
    const auto = !typed || (p.start && p.start.source !== "geocode" && typed === p.start.label);
    const label = auto ? pinLabel(ll, p.city, ranked?.venues) : typed;
    setAq(label);
    setStart({ label, lat: ll.lat, lon: ll.lon, source: "pin" });
  };
  const startHint = !p.start ? "" : p.start.source === "geocode" ? "Start set." : `Start: ${p.start.label}.`;

  // ---------- windows ----------
  const [moreDays, setMoreDays] = useState(false);
  const [editing, setEditing] = useState<string | null>(null); // the date whose own start is being set
  const [wq, setWq] = useState("");
  const [wrows, setWrows] = useState<{ rows: GeoRow[] | null; date: string } | null>(null);
  const [wpin, setWpin] = useState<string | null>(null);
  const label = (date: string) => days.find((d: any) => d.date === date)?.label ?? dayChip(date); // judge pass 4 (18): one format
  const addDay = (d: string) => { if (!d || p.windows.some((w: any) => w.date === d)) return; upd((q) => { q.windows = [...q.windows, { date: d, from: DEFAULT_FROM, to: DEFAULT_TO }]; }); touch("windows"); };
  const toggleDay = (d: string) => (p.windows.some((w: any) => w.date === d) ? (upd((q) => { q.windows = q.windows.filter((w: any) => w.date !== d); }), touch("windows")) : addDay(d));
  const setDayStart = (date: string, st: any) => { upd((q) => { const w = q.windows.find((x: any) => x.date === date); if (w) { if (st) w.start = st; else delete w.start; } }); setEditing(null); setWpin(null); setWq(""); setWrows(null); touch("windows"); };
  const lookUpDay = (date: string, text: string) => {
    setWq(text);
    clearTimeout(timer.current);
    const q = text.trim();
    if (q.length < 4) return setWrows(null);
    if (!city && !p.cityLive) return setWrows({ rows: [], date });
    timer.current = setTimeout(async () => setWrows({ rows: await geocode(q, p.city, liveGeo()), date }), 450);
  };

  // ---------- doors you already know ----------
  const [ranked, setRanked] = useState<any>(null);
  const [kq, setKq] = useState("");
  const rkey = `${p.city}|${(p.pours ?? []).map((r: any) => r.id).join(",")}|${p.drinks.filter((d: any) => d.ready).map((d: any) => d.key).join(",")}`;
  useEffect(() => {
    if (!city || (!p.pours?.length && !p.drinks.some((d: any) => d.ready))) return setRanked(null);
    let on = true;
    loadRoutes(p, index).catch(() => []).then((routes: any[]) => { if (on) setRanked(routes.length ? { key: rkey, routes, ...mergeLists(routes) } : null); });
    return () => { on = false; };
  }, [rkey]);
  const laterRooms = !ranked && p.city && (p.cityLive || p.drinks.some((d: any) => !d.ready) || p.pours?.length);
  const kinds = ranked ? ranked.ids.filter((id: string) => { const v = ranked.venues[id]; return v && (p.rooms ?? []).includes(roomOf(v)) && Number.isFinite(v.lat) && Number.isFinite(v.lon) && !v.closed; }).length : 0;
  const knownHint = ranked ? knownHintOf({ routes: ranked.routes, r: ranked, kinds, cityName: city?.name }) : `${laterRooms ? "Your ranked doors come with your plan: mark the ones you know there." : "Pick your drinker's brand and your city first."} ${KEEP_ON_ROUTE}`;
  const kHits = ranked && kq.trim().length >= 2 ? ranked.ids.map((id: string, i: number) => ({ id, i, v: ranked.venues[id] })).filter((x: any) => !p.known.includes(x.id) && x.v?.name?.toLowerCase().includes(kq.trim().toLowerCase())).slice(0, 8) : [];

  // ---------- examples, clear ----------
  const xs = useMemo(() => examples(), []);
  const [exOpen, setExOpen] = useState(false); // ease (AUDIT-EASE-1): the examples fold into one row, "Try an example"
  const cur = p.sample ? xs.find((x: any) => x.key === (p.sample === true ? "maya" : p.sample)) : null;
  const filled = formFilled(p);
  const replace = (next: any) => { const q = clone(next); saveDraft(q, editOf); setP(q); setCq(cityText(q, index.cities)); setAq(q.start?.label ?? ""); setTouched(new Set()); setDq(""); setRq(""); };

  // the guided demo fills the form card by card (tour.form), and Build makes Maya's demo plan (its own store)
  useEffect(() => {
    if (!params.tour) return;
    const sync = () => { if (tour.form) { const q = clone({ ...emptyProfile(), ...tour.form }); setP(q); setCq(cityText(q, index.cities)); setAq(q.start?.label ?? ""); } };
    tour.handlers.build = () => build();
    return tour.subscribe(sync);
  });
  const scroller = useRef<any>(null);
  // a typeahead's options open under its input: bring the field to the top so the keyboard doesn't hide them (5.8" XS)
  const lift = (at: string) => setTimeout(() => scroller.current?.scrollTo({ y: Math.max(0, (fieldY[at] ?? 0) - 8), animated: true }), 150);
  // the Build bar steps aside while the keyboard is up (on a 5.8" phone it took a third of what was left)
  const [kb, setKb] = useState(false);
  useEffect(() => {
    const a = Keyboard.addListener("keyboardWillShow", () => setKb(true));
    const b = Keyboard.addListener("keyboardWillHide", () => setKb(false));
    return () => { a.remove(); b.remove(); };
  }, []);
  const tourKey = params.tour ? tour.card?.key : null;
  useEffect(() => {
    const at = ({ drinker: "fd-drinks", day: "fd-start", pitch: "fd-pitch", build: "fd-known" } as any)[tourKey ?? ""];
    if (at) setTimeout(() => scroller.current?.scrollTo({ y: Math.max(0, (fieldY[at] ?? 0) - 12), animated: true }), 250);
  }, [tourKey]);
  const build = () => {
    if (params.tour) {
      tour.sig("built");
      openDemo({ fresh: true }).then(() => nav.replace("plan", { demo: true, built: true }));
      return;
    }
    setTouched(new Set([...touched, ...GATED]));
    if (!ok) return;
    // ui/app.js onBuild: same brand + city = the same saved plan (statuses, contacts stay; no day stays frozen)
    const k = keyOf(p);
    store().update(k.brand, k.city, (st: any) => ({ ...st, profile: p, current: null }));
    const eo = { ...k, name: p.brand };
    setEditOf(eo);
    saveDraft(p, eo);
    dropEngine(k);
    nav.replace("plan", { key: k, built: true });
  };
  const edNote = editOf ? (() => {
    const cn = index.cities.find((c: any) => c.key === editOf.city)?.name ?? (p.city === editOf.city && p.cityName ? p.cityName : unslug(editOf.city));
    const name = `${editOf.name || editOf.brand} in ${cn}`;
    return editOf.copy ? `Copy of ${name}. Pick the new city and where your day starts, then build. ${name} stays saved.` : `Editing ${name}. Its statuses, outcomes and contacts stay when you re-plan.`;
  })() : null;
  const hasPlans = store().list().length > 0;
  const ed = Boolean(editOf && !editOf.copy); // Edit profile: the plan's own form, a Cancel, no new-profile tools (audit 2 #6)

  return (
    <Screen title={editOf && !editOf.copy ? "Edit profile" : "Your profile"} testID="form" scrollRef={scroller}
      footer={kb ? null :
        <View style={{ padding: 12, borderTopWidth: 1, borderColor: C.line, backgroundColor: C.bg }}>
          {need ? <Text maxFontSizeMultiplier={bigText ? 1.4 : 2} numberOfLines={bigText ? 2 : undefined} style={[s.small, { marginBottom: 2 }]} testID="need">{need}</Text> : null /* mobile2 10-23: at big text 2 lines, so the footer leaves the form room */}
          <View style={{ flexDirection: "row" }}>
            {ed ? <Btn kind="line" label="Cancel" onPress={() => nav.replace("plan", { key: { brand: editOf.brand, city: editOf.city } })} testID="f-cancel" style={{ marginTop: 4, marginRight: 8 }} fit /> : null}
            <Btn label={ed ? "Save and re-plan" : "Build my plan  →"} onPress={build} disabled={!ok} testID="build" style={{ marginTop: 4, flex: 1 }} fit /* one line at AX sizes (intuit 1b #6: "Save and re- / plan") */ />
          </View>
        </View>
      }>
      {hasPlans && !params.tour && !ed ? <Fold key={bigText ? "big" : "std"} title={`Your plans · ${store().list().length} saved`} initial={!editOf && !bigText /* at big text shut, so the profile shows first (mobile2 10-24) */}><PlansList /></Fold> : null}
      <T k="h2">{editOf && !editOf.copy ? "Edit profile" : "Your profile"}</T>
      {edNote ? (
        <View style={[s.card, { backgroundColor: C.amberSoft, borderColor: C.amberSoft }]} testID="edit-note">
          <T k="body">{edNote}</T>
          {ed ? null : <Pressable onPress={() => { setEditOf(null); replace(emptyProfile()); saveDraft(emptyProfile(), null); }} accessibilityRole="button"><Text style={{ color: C.green, fontWeight: "700", marginTop: 6 }}>New profile</Text></Pressable>}
        </View>
      ) : null}
      {ed || (editOf && !p.sample) || params.tour ? null : (
        <View style={s.card} testID="examples">
          <Row style={{ justifyContent: "space-between" }} wrap={false}>
            <Pressable onPress={() => setExOpen(!exOpen)} accessibilityRole="button" accessibilityLabel="Try an example" accessibilityState={{ expanded: exOpen }} hitSlop={8} style={{ flex: 1, minHeight: 36, justifyContent: "center" }} testID="ex-fold"><Text style={{ color: C.green, fontWeight: "700" }} maxFontSizeMultiplier={1.6}>Try an example {exOpen ? "▾" : "▸"}</Text></Pressable>
            {/* nothing to clear on an empty form (judge #10); Jard 10-23: kept in the row, invisible and untouchable, so its appearing moves nothing */}
            <View pointerEvents={filled ? "auto" : "none"} style={{ opacity: filled ? 1 : 0 }} accessibilityElementsHidden={!filled} importantForAccessibility={filled ? "auto" : "no-hide-descendants"}>
              <Btn small kind="ghost" label="Clear the form" onPress={() => replace(emptyProfile())} disabled={!filled} testID="f-clear" />
            </View>
          </Row>
          {cur ? <T k="muted">{`${fiction(cur)} Change anything, or press Build.`}</T> : null}
          {exOpen ? <View style={{ gap: 6, marginTop: 8 }}>
            {xs.map((x: any) => {
              const [who, ...rest] = x.label.split(" · ");
              const on = cur?.key === x.key;
              return (
                <Pressable key={x.key} onPress={() => replace(x.profile)} accessibilityRole="button" accessibilityState={{ selected: on }} testID={`ex-${x.key}`} style={{ padding: 10, borderRadius: 10, backgroundColor: on ? C.green : C.seg }}>
                  <Text style={{ fontWeight: "700", color: on ? "#fff" : C.ink }}>{who}</Text>
                  <Text style={{ fontSize: 13, color: on ? "#fff" : C.ink3 }}>{rest.join(" · ")}</Text>
                </Pressable>
              );
            })}
          </View> : null}
        </View>
      )}

      <Field label="Brand name">
        <TextInput accessibilityLabel="Brand name" style={s.input} value={p.brand} placeholder="e.g. Tidewell" placeholderTextColor={C.ph} autoCorrect={false} testID="f-brand" onChangeText={(t) => upd((q) => { q.brand = t; delete q.sample; })} />
      </Field>
      <Field label="What you make">
        <TextInput accessibilityLabel="What you make" style={s.input} value={p.what} placeholder={ph("e.g. Non-alcoholic hazy IPA", "e.g. NA hazy IPA")} placeholderTextColor={C.ph} testID="f-what"
          onChangeText={(t) => upd((q) => { q.what = t; const offered = roomChoices(t).map((r: any) => r.key); q.rooms = !q.roomsTouched ? defaultRooms(t).filter((k: string) => offered.includes(k)) : q.rooms.filter((k: string) => offered.includes(k)); })} />
      </Field>
      <Field label="Sign your messages as" hint="Every drafted message ends with it." err={err("name")}>
        <TextInput accessibilityLabel="Sign your messages as" style={s.input} value={p.pitch?.name ?? ""} placeholder={ph(signerHint(p.brand), "Your name")} placeholderTextColor={C.ph} autoComplete="name" testID="f-name" onChangeText={(t) => upd((q) => { q.pitch.name = t; })} onBlur={() => touch("name")} />
      </Field>

      <Field label="Your drinker also drinks…" hint="Up to three. A brand that just launched isn't in anyone's data yet; your drinker's other favourites are." err={err("drinks")} testID="fd-drinks">
        <Tags items={p.drinks} onRemove={(i) => { upd((q) => q.drinks.splice(i, 1)); touch("drinks"); }} />
        {p.drinks.length < MAX_DRINKS ? (
          <TextInput accessibilityLabel="Your drinker also drinks: search a brand" style={s.input} value={dq} placeholder={p.drinks.length ? "Another brand" : "Type any brand"} placeholderTextColor={C.ph} autoCorrect={false} testID="f-drinks" onFocus={() => lift("fd-drinks")} onChangeText={(t) => { setDq(t); setLive(null); }} />
        ) : null}
        {dq.trim() ? (
          <Options rows={dOpts} onPick={(i) => pickDrink(dOpts[i])} testID="dd-drinks"
            notes={[...(live === "loading" ? ["Searching…"] : []), ...(live?.error ? [live.error] : []), ...(Array.isArray(live) && !live.length ? ["Qloo doesn't know that one. Check the spelling, or pick a bigger brand your drinker also drinks."] : []), ...(!dOpts.length && live === null ? ["Type a brand your drinker drinks."] : [])]} />
        ) : null}
      </Field>

      <Field testID="fd-pours" label="Doors that already pour you (any city · optional)" hint="Up to three, any city. Doors finds doors in your opening city whose regulars are like theirs; with brands above, both count. If one is in your opening city, it can stay on your route." err={err("pours")}>
        <Tags items={(p.pours ?? []).map((r: any) => ({ name: r.name, sub: r.where }))} onRemove={(i) => { upd((q) => q.pours.splice(i, 1)); touch("pours"); }} />
        {(p.pours ?? []).length < MAX_POURS ? (
          <TextInput accessibilityLabel="Doors that already pour you: search a bar or restaurant" style={s.input} value={rq} placeholder={(p.pours ?? []).length ? "Another bar or restaurant" : "A bar or restaurant"} placeholderTextColor={C.ph} autoCorrect={false} testID="f-pours" onFocus={() => lift("fd-pours")} onChangeText={(t) => { setRq(t); setRlive(null); }} />
        ) : null}
        {(p.pours ?? []).length < MAX_POURS ? (
          <TextInput accessibilityLabel="The city of the bar or restaurant that pours you" style={[s.input, { marginTop: 8 }]} value={rcity} placeholder={ph("Its city, e.g. Chicago, IL", "Its city")} placeholderTextColor={C.ph} autoCorrect={false} testID="f-pours-city"
            onFocus={() => (setRcityOpen(true), lift("fd-pours"))} onChangeText={(t) => { setRcity(t); setRcityOpen(true); setRlive(null); }}
            onBlur={() => setTimeout(() => setRcityOpen(false), 200)} />
        ) : null}
        {rcityOpen ? (() => { const o = cl.placeCities(rcity, index.cities).filter((c: any, _i: number, all: any[]) => !(all.length === 1 && c.label === rcity.trim())); return <Options rows={o.map((c: any) => ({ key: c.label, name: c.name }))} onPick={(i) => { setRcity(o[i].label); setRcityOpen(false); setRlive(null); }} testID="dd-pours-city" />; })() : null}
        {rq.trim().length >= 2 || rlive !== null ? (
          <Options rows={rOpts} onPick={(i) => pickPour(rOpts[i])}
            notes={[...(rlive === "loading" ? ["Searching…"] : []), ...(rlive?.error ? [rlive.error] : []), ...(Array.isArray(rlive) && !rlive.length ? [rcity.trim() ? "Qloo has no bar or restaurant by that name there. Check the spelling or the city." : "Qloo has no bar or restaurant by that name. Add its city below, or check the spelling."] : [])]} />
        ) : null}
      </Field>

      <Field label="Opening city" err={err("city")} testID="fd-city">
        <TextInput accessibilityLabel="Opening city" style={s.input} value={cq} placeholder="e.g. Denver, CO" placeholderTextColor={C.ph} autoCorrect={false} testID="f-city"
          onFocus={() => (setCityOpen(true), lift("fd-city"))} onChangeText={(t) => { setCq(t); setCityOpen(true); }}
          onSubmitEditing={() => setCity(typedCity(cq))}
          onBlur={() => setTimeout(() => setCityOpen((o) => { if (o && cq.trim() !== cityText(p, index.cities)) setCity(typedCity(cq)); return false; }), 200)} />
        {cityOpen ? (() => { const o = cityOpts(); return <Options rows={o} onPick={(i) => setCity(o[i].row ? cl.cityPick(o[i].row) : o[i].ckey ? { city: o[i].ckey } : typedCity(o[i].text ?? cq))} testID="dd-city" />; })() : null}
      </Field>
      <Field label="Door types" err={err("rooms")}>
        <Row>
          {roomChoices(p.what).map((r: any) => (
            <Chip key={r.key} label={r.label} on={p.rooms.includes(r.key)} onPress={() => { upd((q) => { q.rooms = q.rooms.includes(r.key) ? q.rooms.filter((x: string) => x !== r.key) : ROOMS.map((x: any) => x.key).filter((x: string) => x === r.key || q.rooms.includes(x)); q.roomsTouched = true; }); touch("rooms"); }} />
          ))}
        </Row>
      </Field>

      <Field label="Where your day starts" err={err("start")} testID="fd-start">
        <Row wrap={false}>
          <TextInput accessibilityLabel="Where your day starts: street address" style={[s.input, { flex: 1 }]} value={aq} placeholder={ph("Street address, or drop a pin", "Street address")} placeholderTextColor={C.ph} autoCorrect={false} testID="f-addr" onFocus={() => lift("fd-start")} onChangeText={onAddr} />
          <Btn small kind="line" label={pinOpen ? "Hide map" : "Drop a pin"} onPress={() => setPinOpen(!pinOpen)} testID="pin-btn" />
        </Row>
        <Options rows={addr.rows.map((r, i) => ({ key: String(i), name: r.label }))} notes={addr.note ? [addr.note] : []} onPick={(i) => { const r = addr.rows[i]; setAq(r.label); setStart({ label: r.label, lat: r.lat, lon: r.lon, source: "geocode" }); }} />
        {addrOff ? <T k="small" style={{ color: C.warn, marginTop: 4 }}>{addrOff}</T> : null}
        {startChips(p.city).length ? (
          <View style={{ marginTop: 8 }}>
            <T k="small">Or start from</T>
            <Row style={{ marginTop: 4 }}>
              {startChips(p.city).map((c: any) => <Chip key={c.key} label={c.label} on={p.start?.source === "chip" && p.start.chip === c.key} onPress={() => { setAq(c.label); setStart(chipStart(c)); }} />)}
            </Row>
          </View>
        ) : null}
        {startHint ? <T k="small" style={{ marginTop: 6 }}>{startHint}</T> : null}
        {pinOpen ? (
          <View style={{ marginTop: 8 }}>
            <PlanMap days={[]} height={260} marker={p.start ? { lat: p.start.lat, lon: p.start.lon } : null} onPress={pinStart} onMarker={pinStart}
              center={p.start ? { lat: p.start.lat, lon: p.start.lon } : centre() ? { lat: centre()[0], lon: centre()[1] } : null} fitKey={`pin-${p.city}`} />
            <T k="small" style={{ marginTop: 4 }}>Tap the map to set your start; drag the pin to move it.</T>
          </View>
        ) : null}
      </Field>

      <Field label="When you're free" err={err("windows")} testID="fd-windows">
        <Row>
          {[...days.map((d: any) => d.date), ...p.windows.map((w: any) => w.date).filter((d: string) => !days.some((x: any) => x.date === d))].sort().map((d: string) => (
            <Chip key={d} label={label(d)} on={p.windows.some((w: any) => w.date === d)} onPress={() => toggleDay(d)} testID={`day-${d}`} />
          ))}
          <Chip label={moreDays ? "Hide the calendar" : "Another day…"} onPress={() => setMoreDays(!moreDays)} testID="another-day" />
        </Row>
        {moreDays ? <MonthPicker min={today} picked={p.windows.map((w: any) => w.date)} onPick={addDay} /> : null}
        {[...p.windows].sort((a: any, b: any) => a.date.localeCompare(b.date)).map((w: any) => (
          <View key={w.date} style={[s.card, { padding: 10 }]} testID={`win-${w.date}`}>
            <Row style={{ justifyContent: "space-between" }} wrap={false}>
              <T k="h3">{label(w.date)}</T>
              <Pressable onPress={() => { upd((q) => { q.windows = q.windows.filter((x: any) => x.date !== w.date); }); touch("windows"); if (editing === w.date) setEditing(null); }} accessibilityRole="button" accessibilityLabel={`Remove ${label(w.date)}`} hitSlop={10} style={{ minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" }}><Text style={{ fontSize: 22, color: C.ink3 }}>×</Text></Pressable>
            </Row>
            <Row style={{ marginTop: 6 }}>
              <TimeStep label={`${label(w.date)} from`} value={w.from} onChange={(v) => { upd((q) => { q.windows.find((x: any) => x.date === w.date).from = v; }); touch("windows"); }} />
              <Text style={s.muted} accessibilityElementsHidden importantForAccessibility="no">to</Text>
              <TimeStep label={`${label(w.date)} to`} value={w.to} onChange={(v) => { upd((q) => { q.windows.find((x: any) => x.date === w.date).to = v; }); touch("windows"); }} />
            </Row>
            {w.start ? (
              <Row style={{ marginTop: 6 }}><T k="muted">from <Text style={{ fontWeight: "700" }}>{w.start.label ?? "a pin"}</Text></T><Pressable onPress={() => setDayStart(w.date, undefined)} accessibilityRole="button"><Text style={{ color: C.green, fontWeight: "600" }}>use my usual start</Text></Pressable></Row>
            ) : editing !== w.date ? (
              <Pressable onPress={() => { setEditing(w.date); setWq(""); setWrows(null); setWpin(null); }} style={{ marginTop: 6, minHeight: 44, justifyContent: "center" }} accessibilityRole="button"><Text style={{ color: C.green, fontWeight: "600" }}>Start elsewhere</Text></Pressable>
            ) : null}
            {editing === w.date ? (
              <View style={{ marginTop: 6 }}>
                <Row wrap={false}>
                  <TextInput accessibilityLabel={`Where ${label(w.date)} starts: an address`} style={[s.input, { flex: 1 }]} value={wq} placeholder={`Where ${label(w.date)} starts: an address`} placeholderTextColor={C.ph} onChangeText={(t) => lookUpDay(w.date, t)} />
                </Row>
                {wrows && wrows.date === w.date ? <Options rows={(wrows.rows ?? []).map((r, i) => ({ key: String(i), name: r.label }))} notes={wrows.rows === null ? [SEARCH_OFF] : !wrows.rows.length ? [!city && !p.cityLive ? PIN_ONLY : "No match in this city: drop a pin instead."] : []} onPick={(i) => { const r = wrows.rows![i]; setDayStart(w.date, { label: r.label, lat: r.lat, lon: r.lon, source: "geocode" }); }} /> : null}
                <Row style={{ marginTop: 6 }}>
                  {startChips(p.city).map((c: any) => <Chip key={c.key} label={c.label} onPress={() => setDayStart(w.date, chipStart(c))} />)}
                </Row>
                <Row style={{ marginTop: 6 }}>
                  <Btn small kind="line" label="Drop a pin" onPress={() => setWpin(w.date)} />
                  <Btn small kind="ghost" label="Cancel" onPress={() => { setEditing(null); setWpin(null); }} />
                </Row>
                {wpin === w.date ? (
                  <View style={{ marginTop: 6 }}>
                    <PlanMap days={[]} height={220} onPress={(ll) => setDayStart(w.date, { label: pinLabel(ll, p.city, ranked?.venues), lat: ll.lat, lon: ll.lon, source: "pin" })}
                      center={p.start ? { lat: p.start.lat, lon: p.start.lon } : centre() ? { lat: centre()[0], lon: centre()[1] } : null} fitKey={`wpin-${w.date}`} />
                    <T k="small">Tap the map to set {label(w.date)}'s start.</T>
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>
        ))}
      </Field>
      <Field label="Time at each door" err={err("visitMin")}>
        <Row>
          <TextInput accessibilityLabel="Minutes at each door" style={[s.input, { width: 90 }]} value={p.visitMin == null ? "" : String(p.visitMin)} keyboardType="number-pad" testID="f-visit" onChangeText={(t) => { upd((q) => { q.visitMin = t === "" ? null : Number(t); }); touch("visitMin"); }} />
          <T k="muted">min</T>
          {[15, 20, 25, 30, 45].map((n) => <Chip key={n} label={String(n)} a11y={`${n} minutes`} on={p.visitMin === n} onPress={() => { upd((q) => { q.visitMin = n; }); touch("visitMin"); }} />)}
        </Row>
      </Field>

      <Field label="Most doors a day">
        <Row>{[null, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => <Chip key={String(n)} label={n == null ? "No limit" : String(n)} a11y={n == null ? "Any number of doors a day" : `Up to ${n} door${n === 1 ? "" : "s"} a day`} on={(p.maxPerDay ?? null) === n} onPress={() => upd((q) => { q.maxPerDay = n; })} />)}</Row>
      </Field>
      <View onLayout={(ev) => (fieldY["fd-pitch"] = ev.nativeEvent.layout.y)}><Fold key={`pitch-${!!p.pitch?.support?.length}`} title="Your pitch · optional · feeds the talking points" initial={!!(p.pitch?.price || p.pitch?.ask || p.pitch?.support?.length)} testID="fd-pitch">
        <Field label="Price per case">
          <TextInput accessibilityLabel="Price per case" style={s.input} value={p.pitch?.price ?? ""} placeholder={ph("e.g. $42 a case of 24", "Price a case")} placeholderTextColor={C.ph} onChangeText={(t) => upd((q) => { q.pitch.price = t; })} />
        </Field>
        <Field label="Their menu price (optional, a serve)">
          <TextInput accessibilityLabel="Their menu price" style={s.input} value={p.pitch?.menuPrice ?? ""} keyboardType="decimal-pad" placeholder="e.g. $7" placeholderTextColor={C.ph} onChangeText={(t) => upd((q) => { q.pitch.menuPrice = t; })} />
        </Field>
        <Field label="Your ask" hint={askHint(p.what)}>
          <TextInput accessibilityLabel="Your ask" style={s.input} value={p.pitch?.ask ?? ""} placeholder={ph(defaultAsk(p.what), "Your ask")} placeholderTextColor={C.ph} onChangeText={(t) => upd((q) => { q.pitch.ask = t; })} />
        </Field>
        <Field label="Support you offer">
          <Row>{SUPPORT.map((x: any) => <Chip key={x.key} label={x.label} on={p.pitch?.support?.includes(x.key)} onPress={() => upd((q) => { q.pitch.support = q.pitch.support.includes(x.key) ? q.pitch.support.filter((k: string) => k !== x.key) : SUPPORT.map((y: any) => y.key).filter((k: string) => k === x.key || q.pitch.support.includes(k)); })} />)}</Row>
        </Field>
      </Fold></View>
      <View onLayout={(ev) => (fieldY["fd-known"] = ev.nativeEvent.layout.y)}><Fold key={`known-${!!p.known?.length}`} title="Doors to skip · optional · you already call on them" initial={!!p.known?.length} testID="fd-known">
        <Field label="Doors you already call on" hint={knownHint}>
          <TextInput accessibilityLabel="Doors you already call on: search your city's ranked doors" style={s.input} value={kq} editable={!!ranked} onFocus={() => setTimeout(() => scroller.current?.scrollTo({ y: Math.max(0, (fieldY["fd-known"] ?? 0) + 40), animated: true }), 150)} placeholder={ph("Name of a bar or restaurant", "A bar or restaurant")} placeholderTextColor={C.ph} onChangeText={setKq} />
          {kq.trim().length >= 2 && ranked ? <Options rows={kHits.map((x: any) => ({ key: x.id, name: x.v.name, sub: `${cap(genreLabel(x.v)) || ""}${x.v.neighborhood ? ` · ${x.v.neighborhood}` : ""}`, right: `#${x.i + 1} · Already know them` }))} notes={kHits.length ? [] : ["No ranked door by that name."]} onPick={(i) => { upd((q) => { q.known = [...q.known, kHits[i].id]; }); setKq(""); }} /> : null}
          <View style={{ marginTop: 8 }}><Tags items={p.known.map((id: string) => ({ name: ranked?.venues[id]?.name ?? "A door you know" }))} onRemove={(i) => upd((q) => { q.known.splice(i, 1); })} /></View>
        </Field>
      </Fold></View>
      {editOf && !editOf.copy ? <RulesBox brand={savedProfile(editOf.brand, editOf.city)?.brand?.trim() || editOf.name || ""} /> : null}
      <View style={s.sect}>
        <T k="h3">What happens next</T>
        <T k="muted">Doors asks Qloo which bars and restaurants in your city have regulars who drink what your drinker drinks, keeps the ones open while you're out, and routes them from your start.</T>
        <T k="muted" style={{ marginTop: 6 }}>Every stop gets a drafted message built from Qloo's profile of that door.</T>
      </View>
    </Screen>
  );
}

// Your rules (R9 S6) in Edit profile, as the web's ui/rules.js: the brand's words, every city ("never say …", "say …
// instead of …"). Brand-wide, so here and not on each door card (ease audit #9). The store's rules for that brand.
const ruleTxt = (r: any) => (r.field === "rule.avoid" ? `Never say “${r.value}”` : `Say “${r.value.to}”, not “${r.value.from}”`);
function RulesBox({ brand }: { brand: string }) {
  const [rules, setRules] = useState<any[]>(() => (brand ? store().getRules(brand) : []));
  const [avoid, setAvoid] = useState("");
  const [to, setTo] = useState("");
  const [from, setFrom] = useState("");
  if (!brand) return null;
  const live = rules.filter((r: any) => /^rule\./.test(r.field));
  const old = supersededRules({ "*": live }, "*");
  const tag = (r: any) => (old.includes(r) ? " · replaced by a newer rule" : ruleInName(r.field === "rule.term" ? r.value?.from : r.value, [brand]) ? " · not in your brand name" : "");
  const put = (next: any[]) => { store().setRules(brand, next); setRules(next); rulesChanged(brand); };
  const add = (rec: any) => put([...rules, makeRecord({ slot: "S6", ...rec, source: "corrected", by: "rep" })]);
  return (
    <Fold title={`Your rules · optional · words Doors never uses${live.length ? ` · ${live.length}` : ""}`} initial={live.length > 0} testID="fd-rules">
      <T k="small">Words Doors must never use, or must say your way, in every drafted message and talking point for {brand}, in every city.</T>
      {live.map((r: any, i: number) => (
        <Row key={i} style={{ justifyContent: "space-between", marginTop: 6 }} wrap={false}>
          <T k="body" style={{ flex: 1 }}>{ruleTxt(r)}{tag(r) ? <Text maxFontSizeMultiplier={2} style={s.small}>{tag(r)}</Text> : null}</T>
          <Pressable onPress={() => put(rules.filter((x: any) => x !== r))} accessibilityRole="button" accessibilityLabel={`Remove: ${ruleTxt(r)}`} style={{ minHeight: 44, justifyContent: "center" }}><Text style={{ color: C.green, fontWeight: "600" }}>Remove</Text></Pressable>
        </Row>
      ))}
      <T k="label" style={{ marginTop: 14 }}>Never say</T>
      <Row wrap={false}>
        <TextInput accessibilityLabel="Never say" style={[s.input, { flex: 1 }]} value={avoid} onChangeText={setAvoid} maxLength={60} placeholder="e.g. mocktail" placeholderTextColor={C.ph} />
        <Btn small kind="line" label="Add" onPress={() => { if (avoid.trim()) { add({ field: "rule.avoid", value: avoid.trim() }); setAvoid(""); } }} testID="rule-avoid-add" />
      </Row>
      <T k="label" style={{ marginTop: 14 }}>Say … instead of …</T>
      <Row wrap={false}>
        <TextInput accessibilityLabel="Say" style={[s.input, { flex: 1 }]} value={to} onChangeText={setTo} maxLength={40} placeholder="your word" placeholderTextColor={C.ph} />
        <T k="muted">instead of</T>
        <TextInput accessibilityLabel="instead of" style={[s.input, { flex: 1 }]} value={from} onChangeText={setFrom} maxLength={40} placeholder="their word" placeholderTextColor={C.ph} />
      </Row>
      <Btn small kind="line" label="Add" style={{ alignSelf: "flex-start", marginTop: 6 }} onPress={() => { if (to.trim() && from.trim()) { add({ field: "rule.term", value: { from: from.trim(), to: to.trim() } }); setTo(""); setFrom(""); } }} testID="rule-term-add" />
    </Fold>
  );
}
