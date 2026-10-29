// The plan view's controller (public/ui/plan.js renderPlan: compute, replan, setStatus, restore, setOutcome, slots,
// contacts, addDoor, locks and moves, doors a day, the agent's replan and talk edits, whatIfFirst), DOM-free, on the
// web's own planner and helpers (../public/lib). The screens read engine.plan / engine.sel and call these actions;
// every change saves through the web's store (same keys) and notifies the screens. A change that re-plans says what
// moved, with one Undo (the toast), as on the web.
import { buildPool, windowsFor, freshPrevious, uncappedPrevious, savedPlan, bestAddDay, addedText } from "../../public/lib/pool.js";
import { planOnRoads, travelSource } from "../../public/lib/travel.js";
import { clock12, toMinutes, isoDate, validateProfile } from "../../public/lib/profile.js";
import { leadHold, crowdKey } from "../../public/lib/crowds.js"; // why2: Start with <crowd>
import { replanSummary, offDayText, withoutOffCount } from "../../public/lib/planview.js";
import { isReturnVisit } from "../../public/lib/outcome.js";
import { dropRecord } from "../../public/lib/slots.js";
import { noteOp } from "../../public/lib/door-notes.js"; // door notes
import { DEMO_DEEP_OFF, heatFor, deepOn } from "../../public/lib/culture.js";
import { tourNow } from "../../public/lib/demo-plan.js";
import { skipToEnd, moveIntoDay, offEveryDay, noRoomText } from "../../public/lib/drive-day.js"; // drive mode's Skip for now; a move onto the day under way
import { dropFromDay, patchRecord, withRemoved, nextPlanDay, rollPlan, capsWithRolled, movedIds, laterDays, lateMoveInput, lateMoveFits, unhold } from "../../public/lib/day-debrief.js"; // the day flow: pause, remove, end (ui/plan.js)
import { cityOf, isLiveProfile } from "../../public/lib/live.js";
import { shutOn } from "../../public/lib/fu-check.js"; // judge pass 6 (#7): a move never lands on a day the room is shut
import { getJSON, loadRoutes, fetchMatrix, workerFetch } from "./data";
import { askBrief } from "../../public/lib/brief-client.js"; // Doors Agent: the specialist brief

export const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : "");
const doorsN = (n: number) => `${n} door${n === 1 ? "" : "s"}`;
export const nowStamp = () => {
  const d = new Date();
  return { date: isoDate(d), min: d.getHours() * 60 + d.getMinutes() };
};

function frozenFor(st: any, windows: any[], statuses: any, now: any) {
  const cur = st.current?.date >= now.date ? st.current : windows.some((w) => w.date === now.date) ? { date: now.date } : null;
  if (!cur) return null;
  if (!windows.some((w) => w.date === cur.date)) return null;
  const prev = st.plan?.days?.find((d: any) => d?.date === cur.date);
  if (!prev) return null;
  const ids = prev.stops.map((s: any) => s.id).filter((id: string) => statuses[id] !== "talked" && statuses[id] !== "notfit");
  return { date: cur.date, from: prev.from, ids };
}

export type Toast = { text: string; undo?: () => void; at: number } | null;
export type DemoOpts = { fetchMatrix: (coords: number[][]) => Promise<any>; cache: Map<any, any>; travelNote?: string };
type Before = { plan: any; known: string[]; caps?: any; st: any };

export class PlanEngine {
  store: any;
  index: any;
  profile: any;
  c: any;
  brand: string;
  routes: any[] = [];
  hoods: any = null;
  captured = "";
  st: any = null;
  plan: any = null;
  sel: number | "week" | "rest" = 0;
  focusId: string | null = null;
  rerouted = new Set<string>();
  toast: Toast = null;
  demo: DemoOpts | null;
  dead = false;
  private seq = 0;
  private first = true;
  private planCaps: any = null;
  private matrixCache = new Map();
  private fns = new Set<() => void>();
  onProfile: (p: any) => void = () => {};

  constructor({ store, index, profile, demo = null }: { store: any; index: any; profile: any; demo?: DemoOpts | null }) {
    this.store = store;
    this.index = index;
    this.profile = profile;
    this.demo = demo;
    this.c = cityOf(profile, index);
    this.brand = profile.brand.trim() || "my brand";
  }
  subscribe(fn: () => void) {
    this.fns.add(fn);
    return () => void this.fns.delete(fn);
  }
  emit() {
    this.fns.forEach((f) => { try { f(); } catch (e) { console.error(e); } });
  }
  flash(text: string, undo?: () => void) {
    this.toast = { text, undo, at: Date.now() };
    this.emit();
  }
  clearToast() {
    this.toast = null;
    this.emit();
  }
  get key() {
    return { brand: this.brand, city: this.c.key };
  }
  isLive() {
    return !this.demo && isLiveProfile(this.profile, this.index);
  }
  // after a live run: the city as Qloo knows it now, and whether the start is still in town
  afterLive(): string | null {
    this.c = cityOf(this.profile, this.index);
    const far = validateProfile(this.profile, { cities: this.index.cities }).errors;
    return far.start ?? far.windows ?? null;
  }
  // loads the room lists and builds the first plan; false = no rooms for that profile. Fix 8: lists that didn't load
  // throw (err.offline), so a dropped signal is never said as an empty pool
  async open(): Promise<boolean> {
    this.routes = await loadRoutes(this.profile, this.index);
    this.hoods = heatFor(await getJSON("/data/culture/heat.json").catch(() => null), this.routes, this.c.key);
    if (!this.routes.length) return false;
    this.captured = this.routes[0].captured ?? this.index.captured;
    this.st = this.store.update(this.brand, this.c.key, (s: any) => ({ ...s, profile: this.profile }));
    await this.replan();
    return true;
  }
  // the data a stop needs beyond the plan (ui/stop.js loadStopData): city file, facts, hooks, heat; cached per engine
  private _data: Promise<any> | null = null;
  stopData() {
    this._data ??= (async () => {
      const [city, facts, hooks, heat] = await Promise.all([
        getJSON(`/data/cities/${this.c.key}.json`).catch(() => null),
        getJSON("/data/facts.json").then((f: any) => f.facts ?? []).catch(() => []),
        getJSON("/data/culture/hooks.json").catch(() => null),
        getJSON("/data/culture/heat.json").catch(() => null),
      ]);
      return { city, facts, routes: this.routes, hooks, heat, captured: this.routes[0]?.captured ?? null };
    })();
    return this._data;
  }
  heatOn() {
    return Boolean(this.hoods) && deepOn("heat", this.demo ? DEMO_DEEP_OFF : null);
  }
  private save(patch: any) {
    this.st = this.store.update(this.brand, this.c.key, patch);
  }

  // ---------- planning ----------
  // base: the saved state to plan from instead of this.st (a dry run: lateFits), nothing saved (ui/plan.js)
  // hold: day-locks for this one run only (running late's move, lateMoveInput), not shown as locks (unhold, as ui/plan.js)
  async compute({ added = this.st.added ?? [], fresh = false, locks = this.st.locks ?? [], base = null, hold = [] }: { added?: any[]; fresh?: boolean; locks?: any[]; base?: any; hold?: any[] } = {}) {
    const { profile } = this;
    const st = base ? { ...this.st, ...base } : this.st;
    const pool = buildPool({ routes: this.routes, profile, statuses: st.statuses, contacts: st.contacts ?? [], added, outcomes: st.outcomes, famous: !!st.famous, cityName: this.c.name, deepOff: this.demo ? DEMO_DEEP_OFF : null, heat: this.hoods });
    const windows = windowsFor(profile);
    const now = this.demo ? tourNow(st, windows, nowStamp()) : nowStamp(); // the tour plans on its own clock (F9, as ui/plan.js)
    const uncapped = windows.every((w: any) => !w.max);
    const previous = !fresh ? st.plan : uncapped ? uncappedPrevious(st.plan, st.uncappedPlan, now) : freshPrevious(st.plan, now);
    // the planner's caps: a day End my day rolled doors onto holds them on top of its cap (ui/plan.js)
    const frozen = frozenFor(st, windows, pool.statuses, now);
    // why2 "Start with bars": the first open day holds the picked crowd's doors (lib/crowds.js), for this run only (ui/plan.js)
    hold = [...hold, ...leadHold({ routes: this.routes, pool, lead: st.startWith ?? null, windows, visitMin: profile.visitMin, statuses: pool.statuses, frozen, now, locks: [...locks, ...hold], famous: !!st.famous })];
    const input = { pool: pool.rows, statuses: pool.statuses, windows: capsWithRolled(windows, st.drive, locks), visitMin: profile.visitMin, pinned: pool.pinned, frozen, locks: [...locks, ...hold], now, previous };
    const { plan: p } = await planOnRoads(input, { fetchMatrix: this.demo?.fetchMatrix ?? fetchMatrix, cache: this.demo?.cache ?? this.matrixCache });
    return { p: unhold(p, hold), pool, windows };
  }
  slotsView() {
    const own = this.st.slots ?? {};
    return { ...own, "*": [...(own["*"] ?? []), ...this.store.getRules(this.brand)] };
  }
  capsNow = () => ({ maxPerDay: this.profile.maxPerDay ?? null, maxByDate: { ...(this.profile.maxByDate ?? {}) } });
  // hold: day-locks for this one run, not saved (running late's move: lateMoveInput)
  async replan({ fresh = false, hold = [] }: { refit?: boolean; fresh?: boolean; hold?: any[] } = {}) {
    const my = ++this.seq;
    const caps = this.capsNow();
    this.rerouted = new Set();
    const { p, pool, windows } = await this.compute({ fresh, hold });
    if (this.dead || my !== this.seq) return false;
    const carriedNotes = { ...(this.st.carriedNotes ?? {}) };
    for (const n of p.notes) if (n.kind === "carried") carriedNotes[n.from] = { text: n.text, ids: n.ids, from: n.from };
    const saved = savedPlan(p); // fix13: with the weeks' sets, so a reopen re-plans on them
    this.save((s: any) => ({ ...s, plan: saved, carriedNotes, ...(windows.every((w: any) => !w.max) ? { uncappedPlan: saved } : {}) }));
    this.plan = { ...p, venues: pool.venues, pool: { ids: pool.ids, N: pool.N, label: pool.label, drinker: pool.drinker }, statuses: pool.statuses, outcomes: this.st.outcomes, slots: this.slotsView(), talkEdits: this.st.talkEdits ?? {}, drive: this.st.drive ?? {}, profile: this.profile, city: { key: this.c.key, name: this.c.name }, source: travelSource(p), windows };
    if (!this.demo) askBrief(this.plan, (u: string, o: RequestInit) => workerFetch(u, o, 60000)); // Doors Agent: the specialist brief for this category + city (src/brief.js)
    if (typeof this.sel === "number" && !p.days[this.sel]) this.sel = 0;
    if (this.first) {
      this.first = false;
      const k = p.days.findIndex((d: any) => !d.past && d.stops.length);
      this.sel = k >= 0 ? k : 0;
    }
    this.planCaps = caps;
    this.emit();
    return true;
  }
  private before(extra: any = {}): Before {
    const { st } = this;
    return { plan: this.plan, known: [...(this.profile.known ?? [])], st: { statuses: st.statuses, current: st.current, plan: st.plan, carriedNotes: st.carriedNotes, locks: st.locks, ...extra } };
  }
  async setStatus(id: string, status: string | null) {
    const before = this.plan && this.before();
    let day = this.plan?.days.find((d: any) => d.stops.some((s: any) => s.id === id));
    // judge pass 4 (#3): a visit logged while one of the plan's days is today happened today (plan.js setStatus)
    const now = nowStamp();
    const today = status === "visited" ? this.plan?.days.find((d: any) => d.date === now.date && !d.past && now.min < d.to) : null;
    if (today && day && day.date > today.date) day = today;
    // the list's Undo restores what the toast's Undo would, while nothing has changed since the mark (plan.js markUndo)
    if (status && before) this.markUndo.set(id, { before, sig: "" });
    else this.markUndo.delete(id);
    this.st = this.store.setStatus(this.brand, this.c.key, id, status);
    if (!status && (this.profile.known ?? []).includes(id)) {
      this.profile.known = this.profile.known.filter((x: string) => x !== id);
      this.save({ profile: this.profile });
      this.onProfile(this.profile);
    }
    if (status === "visited" && day && !day.past && (!this.st.current || day.date >= this.st.current.date)) this.save({ current: { date: day.date, from: day.from } });
    this.focusId = id;
    await this.replan({ refit: true });
    if (this.dead || !before) return false;
    if (status && this.markUndo.has(id)) this.markUndo.get(id)!.sig = this.planSig();
    const text = replanSummary(before.plan, this.plan, { id, name: this.plan.venues[id]?.name });
    if (text) this.flash(text, () => this.restore(before));
    return !!text;
  }
  private markUndo = new Map<string, { before: any; sig: string }>();
  private planSig = () => JSON.stringify([this.plan?.days?.map((d: any) => d.stops.map((s: any) => s.id).join()).join("|"), this.st.statuses, this.st.outcomes, this.st.locks ?? [], this.st.contacts?.length ?? 0]);
  // the list's Undo on a marked door: the plan as it was before the mark when nothing changed since, else un-mark
  undoMark(id: string) {
    const m = this.markUndo.get(id);
    this.markUndo.clear();
    if (m && m.sig === this.planSig()) return this.restore(m.before);
    return this.setStatus(id, null);
  }
  restore(b: any) {
    this.seq++;
    this.save((s: any) => ({ ...s, ...b.st }));
    if ((this.profile.known ?? []).join() !== b.known.join()) {
      this.profile.known = b.known;
      this.save({ profile: this.profile });
      this.onProfile(this.profile);
    }
    if (b.caps) {
      Object.assign(this.profile, JSON.parse(JSON.stringify(b.caps)));
      this.planCaps = b.caps;
      this.save({ profile: this.profile });
      this.onProfile(this.profile);
    }
    this.plan = { ...b.plan, outcomes: this.st.outcomes, slots: this.slotsView(), talkEdits: this.st.talkEdits ?? {}, drive: this.st.drive ?? {} };
    if (typeof this.sel === "number" && !this.plan.days[this.sel]) this.sel = 0;
    this.rerouted = new Set();
    this.flash("Undone: your plan is back as it was.");
  }
  async setOutcome(id: string, outcome: any) {
    this.st = this.store.setOutcome(this.brand, this.c.key, id, outcome);
    await this.replan();
  }
  // R9 slots: no re-plan (words, not the route)
  setSlot(id: string, rec: any) {
    const { store, brand } = this;
    if (rec?.note) this.st = store.setSlots(brand, this.c.key, id, noteOp(this.st.slots?.[id] ?? [], rec)); // door notes: an edit or a delete
    else if (rec?.clear) {
      if (/^rule\./.test(rec.clear)) store.setRules(brand, store.getRules(brand).filter((r: any) => r.field !== rec.clear || (rec.value != null && JSON.stringify(r.value) !== JSON.stringify(rec.value))));
      else this.st = store.setSlots(brand, this.c.key, id, rec.value != null ? dropRecord(this.st.slots?.[id] ?? [], rec.clear, rec.value) : (this.st.slots?.[id] ?? []).filter((r: any) => r.field !== rec.clear));
    } else if (/^rule\./.test(rec?.field ?? "")) store.setRules(brand, [...store.getRules(brand), rec]);
    else if (rec) this.st = store.setSlots(brand, this.c.key, id, [...(this.st.slots?.[id] ?? []), rec]);
    if (this.plan) this.plan = { ...this.plan, slots: this.slotsView() };
    this.emit();
  }
  async addContact(v: any) {
    const contacts = (this.st.contacts ?? []).filter((x: any) => x.id !== v.id);
    this.save({ contacts: [...contacts, v] });
    if (this.st.statuses[v.id]) this.st = this.store.setStatus(this.brand, this.c.key, v.id, null);
    this.focusId = v.id;
    await this.replan();
    const d = this.plan.days.findIndex((x: any) => x.stops.some((s: any) => s.id === v.id));
    if (d >= 0) this.sel = d;
    this.flash(d >= 0 ? `${v.name} added as your contact: ${cap(this.plan.days[d].day)}, stop ${this.plan.days[d].stops.findIndex((s: any) => s.id === v.id) + 1}.` : `${v.name} added as your contact, but it didn't fit any window. It's under Not on a day.`);
  }
  async removeContact(id: string) {
    this.save({ contacts: (this.st.contacts ?? []).filter((x: any) => x.id !== id) });
    await this.replan();
  }
  async addDoor(venue: any, { date = null }: { date?: string | null } = {}) {
    const { plan } = this;
    const v0 = venue?.id != null ? plan?.venues[venue.id] ?? venue : null;
    if (!plan || !v0 || !Number.isFinite(+v0.lat) || !Number.isFinite(+v0.lon)) return null;
    const { contact, added, date: _d, ...v } = { ...v0, lat: +v0.lat, lon: +v0.lon };
    const before = this.before({ added: this.st.added });
    const others = (this.st.added ?? []).filter((x: any) => x.id !== v.id);
    if (!date) {
      this.flash(`Finding the best day for ${v.name ?? "this door"}…`);
      const my = this.seq;
      const open = plan.days.filter((d: any) => !d.past && !d.frozen).map((d: any) => d.date);
      const trials = [];
      for (const dt of [...new Set(open)]) trials.push({ date: dt, plan: (await this.compute({ added: [...others, { ...v, date: dt }] })).p });
      if (this.dead || my !== this.seq) return null;
      date = bestAddDay(trials, v.id, { rank: (id: string) => plan.pool.ids.indexOf(id) + 1 || null });
    }
    this.save({ added: [...others, { ...v, date: date ?? null }] });
    if (this.st.statuses[v.id]) this.st = this.store.setStatus(this.brand, this.c.key, v.id, null);
    this.focusId = v.id;
    await this.replan();
    if (this.dead) return null;
    const k = this.plan.days.findIndex((d: any) => d.stops.some((s: any) => s.id === v.id));
    if (k >= 0 && this.sel !== "week") this.sel = k;
    const day = date ? this.plan.days.find((d: any) => d.date === date)?.day : null;
    const moved = (replanSummary(before.plan, this.plan, { id: v.id, name: v.name }) ?? "").split(" · ").filter((t: string) => t && !t.endsWith("same doors, new order")).join(" · ");
    this.flash(`${addedText(this.plan, v.id, { day })}${moved ? ` ${moved}.` : ""}`, () => this.restore(before));
    return { day: k >= 0 ? k : null, date: k >= 0 ? this.plan.days[k].date : null };
  }
  async removeAdded(id: string) {
    this.save({ added: (this.st.added ?? []).filter((x: any) => x.id !== id) });
    await this.replan();
  }
  selectDay(d: number | "week" | "rest") {
    this.sel = d;
    this.emit();
  }
  async setFamous(on: boolean) {
    this.save({ famous: on });
    await this.replan();
    this.flash(on ? "The famous doors are in: the list now ranks them with the rest." : "The famous doors are out again.");
  }
  // why2: "Start with <crowd>" (key: lib/crowds.js crowdKey; null mixes the crowds again), as ui/plan.js setStartWith
  async setStartWith(key: string | null) {
    this.save({ startWith: key ?? null });
    await this.replan();
    const d = this.plan?.days?.find((x: any) => x && !x.past && x.stops.length);
    const name = this.routes.find((r: any) => crowdKey(r) === key)?.drinker?.name;
    this.flash(key && name && d ? `${d.day[0].toUpperCase()}${d.day.slice(1)} starts with ${name}'s doors.` : "The crowds are mixed again.");
  }
  dismissNotice(from: string) {
    this.save((s: any) => ({ ...s, dismissed: [...(s.dismissed ?? []), from] }));
    this.emit();
  }

  // ---------- locks and moves (G4) ----------
  isDone = (s: any, d: any) => this.plan.statuses[s.id] === "visited" && !isReturnVisit(s, d, this.plan.outcomes?.[s.id]);
  lead = (d: any) => {
    let k = 0;
    while (k < d.stops.length && this.isDone(d.stops[k], d)) k++;
    return d.frozen ? k : 0;
  };
  movable = (d: any, s: any) => d && !d.past && !this.isDone(s, d);
  private lockList = (locked: Map<string, string>, orders = new Map<string, string[]>()) =>
    this.plan.days.flatMap((d: any) => (d.past ? [] : (orders.get(d.date) ?? d.stops.map((s: any) => s.id)).flatMap((x: string, i: number) => (locked.has(x) ? [{ id: x, date: d.date, index: locked.get(x) === "day" ? null : i }] : []))));
  private lockedNow = () => new Map<string, string>(this.plan.days.flatMap((d: any) => (d.past ? [] : d.stops.filter((s: any) => s.locked).map((s: any) => [s.id, s.lockDay ? "day" : "place"]))));
  placeOf = (id: string) => {
    const i = this.plan.days.findIndex((d: any) => d.stops.some((s: any) => s.id === id));
    return i < 0 ? null : { i, n: this.plan.days[i].stops.findIndex((s: any) => s.id === id) + 1, d: this.plan.days[i] };
  };
  // saved: a new saved plan to keep with the locks (a move onto or off the day under way edits that day itself)
  // guard (a move): when the re-plan leaves a door that was on a day ahead on no day (the moved one too), it is undone
  // and the toast says so (a planned door is never pushed off, as End my day). → false when undone
  private async relock(locks: any[], id: string, say: () => string, saved: any = null, guard: { day: string } | null = null) {
    const before = this.before();
    this.save(saved ? { locks, plan: saved } : { locks });
    this.focusId = id;
    await this.replan({ refit: true });
    if (this.dead) return true;
    const off = guard ? offEveryDay(before.plan, this.plan) : [];
    if (off.length) {
      this.restore(before);
      this.flash(noRoomText(this.plan, id, off, guard!.day));
      return false;
    }
    for (const d of this.plan.days) {
      const old = before.plan.days.find((x: any) => x?.date === d.date && x.from === d.from);
      if (d.past || !old) continue;
      d.stops.forEach((s: any, k: number) => { if (!s.locked && s.id !== id && old.stops.findIndex((x: any) => x.id === s.id) !== k) this.rerouted.add(s.id); });
    }
    const sum = replanSummary(before.plan, this.plan);
    this.flash(`${say()}${sum ? ` ${sum}.` : ""}`, () => this.restore(before));
    return true;
  }
  async setCaps(next: any, say: string) {
    const before = { ...this.before(), caps: this.planCaps ?? this.capsNow() };
    Object.assign(this.profile, next);
    this.save({ profile: this.profile });
    this.onProfile(this.profile);
    if (!(await this.replan({ refit: true, fresh: true })) || this.dead) return;
    const sum = replanSummary(before.plan, this.plan);
    this.flash(`${say}${sum ? ` ${sum}.` : ""}`, () => this.restore(before));
  }
  setMaxPerDay(n: number | null) {
    return this.setCaps({ maxPerDay: n }, n ? `Up to ${doorsN(n)} a day.` : "Any number of doors a day.");
  }
  async setLock(id: string, on: boolean) {
    const at = this.placeOf(id);
    if (!this.plan || !at || !this.movable(at.d, at.d.stops[at.n - 1])) return false;
    const locked = this.lockedNow();
    if (on) locked.set(id, "place");
    else locked.delete(id);
    const name = this.plan.venues[id]?.name ?? "That stop";
    await this.relock(this.lockList(locked), id, () => {
      const p = this.placeOf(id);
      return on ? `${name} locked: ${cap(p?.d.day ?? "")}, stop ${p?.n}.` : `${name} unlocked: Doors places it again.`;
    });
    return true;
  }
  async moveStop(id: string, { day, index }: { day: number; index: number | null }) {
    const to = this.plan?.days[day];
    const at = this.placeOf(id);
    if (!to || to.past || !at || !this.movable(at.d, at.d.stops[at.n - 1])) return false;
    const order = (d: any) => d.stops.map((s: any) => s.id).filter((x: string) => x !== id);
    const tgt = order(to);
    tgt.splice(Number.isInteger(index) ? Math.max(this.lead(to), Math.min(index as number, tgt.length)) : tgt.length, 0, id);
    const orders = new Map([[to.date, tgt]]);
    if (at.d !== to) orders.set(at.d.date, order(at.d));
    const locked = this.lockedNow();
    const name = this.plan.venues[id]?.name ?? "That stop";
    // the day under way (frozen) is kept as the rep has it: a lock there re-planned it from the clock and took doors
    // off (mobile2 10-23: 6 of 7). Onto it or within it: the saved day's own order (moveIntoDay), no lock; off it to
    // a day ahead: the saved day without the door (dropFromDay), locked to its new day as any move (ui/plan.js)
    const saved = to.frozen ? moveIntoDay(this.st.plan, at.d, to, id, Number.isInteger(index) ? index : null, this.lead(to)) : at.d.frozen ? dropFromDay(this.st.plan, at.d, [id]) : null;
    if (saved && to.frozen) {
      locked.delete(id);
      orders.delete(to.date);
      orders.delete(at.d.date);
      return this.relock(this.lockList(locked, orders), id, () => { const p = this.placeOf(id); return p ? `${name} moved to ${cap(p.d.day)}: stop ${p.n}.` : `${name} didn't fit there.`; }, saved, { day: to.day });
    }
    if (saved) orders.delete(at.d.date);
    locked.set(id, Number.isInteger(index) ? "place" : "day");
    return this.relock(this.lockList(locked, orders), id, () => {
      const p = this.placeOf(id);
      if (!p) return `${name} didn't fit there.`;
      return Number.isInteger(index) ? `${name} locked: ${cap(p.d.day)}, stop ${p.n}.` : `${name} moved to ${cap(p.d.day)}: stop ${p.n}.`;
    }, saved, { day: to.day });
  }
  // drive mode's "Skip for now" (ui/plan.js skipStop): the door last on the day being worked, by the day's order, not a
  // lock (a place lock at the end re-planned the day around it and took free doors off); a day ahead: moveStop
  async skipStop(id: string) {
    const at = this.placeOf(id);
    if (!this.plan || !at || !this.movable(at.d, at.d.stops[at.n - 1])) return false;
    const next = at.d.frozen ? skipToEnd(this.st.plan, at.d, id) : null;
    if (!next) return this.moveStop(id, { day: at.i, index: at.d.stops.length });
    this.save({ plan: next, locks: (this.st.locks ?? []).filter((l: any) => l.id !== id) });
    this.focusId = id;
    await this.replan({ refit: true });
    return !this.dead;
  }
  // drive mode's exact Undo
  snapshot = () => this.plan && { ...this.before({ outcomes: this.st.outcomes, drive: this.st.drive ?? {} }) };
  // ---------- the day flow (Jard 10-23, items 5-6; ui/plan.js setDrive / removeStop / endDay) ----------
  // the day's drive record (started, paused, ended, removed, skipped): no re-plan, words only
  setDrive(date: string, patch: any) {
    this.save({ drive: patchRecord(this.st.drive, date, patch) });
    if (this.plan) this.plan = { ...this.plan, drive: this.st.drive };
    this.emit();
  }
  // off its day for good: drop = Not a fit; else off the day being worked (the planner may put it on a day ahead), or
  // on a day ahead locked to the next day. Skip for now only moves it to the end of today. → the day's date | false
  async removeStop(id: string, { drop = false, at = null }: { drop?: boolean; at?: string | null } = {}) {
    const p0 = this.placeOf(id);
    if (!this.plan || !p0 || !this.movable(p0.d, p0.d.stops[p0.n - 1])) return false;
    const date = p0.d.date;
    if (drop) this.st = this.store.setStatus(this.brand, this.c.key, id, "notfit");
    else if (p0.d.frozen) {
      const next = dropFromDay(this.st.plan, p0.d, [id]);
      if (next) this.save({ plan: next, locks: (this.st.locks ?? []).filter((l: any) => l.id !== id) });
    } else {
      const locked = this.lockedNow();
      const nd = this.plan.days.slice(p0.i + 1).find((d: any) => !d.past && d.date !== date);
      const orders = new Map<string, string[]>([[date, p0.d.stops.map((x: any) => x.id).filter((x: string) => x !== id)]]);
      if (nd) orders.set(nd.date, [...nd.stops.map((x: any) => x.id), id]), locked.set(id, "day");
      else locked.delete(id);
      this.save({ locks: this.lockList(locked, orders) });
    }
    this.save({ drive: patchRecord(this.st.drive, date, (r: any) => withRemoved(r, id, drop ? "dropped" : "later", at)) });
    this.focusId = id;
    await this.replan({ refit: true });
    return this.dead ? false : date;
  }
  // running late's Skip (ui/plan.js skipDoors): off that day's route and back on Your list, no lock; the day kept as the
  // rep has it (the day under way), so the re-plan neither puts them back nor fills the gap. → the ids taken off | false
  async skipDoors(date: string, ids: string[], { at = null }: { at?: string | null } = {}) {
    const d = this.plan?.days.find((x: any) => x.date === date && !x.past);
    const off = d ? ids.filter((id) => d.stops.some((s: any) => s.id === id && this.movable(d, s))) : [];
    if (!off.length) return false;
    if (!d.frozen) this.save({ current: { date: d.date, from: d.from } });
    const next = dropFromDay(this.st.plan, d, off);
    if (next) this.save({ plan: next });
    this.save({ locks: (this.st.locks ?? []).filter((l: any) => !off.includes(l.id)), drive: patchRecord(this.st.drive, date, (r: any) => off.reduce((x: any, id: string) => withRemoved(x, id, "later", at), r)) });
    this.focusId = off[0];
    await this.replan({ refit: true });
    return this.dead ? false : off;
  }
  // End my day: the doors not done come off the day, the day is marked ended (drive mode shows the debrief)
  async endDay(date: string, { ids = [], at = null }: { ids?: string[]; at?: string | null } = {}) {
    const k = this.plan?.days.findIndex((d: any) => d.date === date) ?? -1;
    if (k < 0) return false;
    const d = this.plan.days[k];
    const off = ids.filter((id) => d.stops.some((s: any) => s.id === id && this.movable(d, s)));
    const next = d.frozen && off.length ? dropFromDay(this.st.plan, d, off) : null;
    if (next) this.save({ plan: next, locks: (this.st.locks ?? []).filter((l: any) => !off.includes(l.id)) });
    this.save({ drive: patchRecord(this.st.drive, date, (r: any) => ({ ...off.reduce((x: any, id: string) => withRemoved(x, id, "end", at), r), ended: at ?? true, paused: null, moved: null })) });
    const to = nextPlanDay(this.plan, date);
    if (off.length && to >= 0) return this.rollDay(date, this.plan.days[to].date, off);
    await this.replan({ refit: true });
    return !this.dead;
  }
  // End my day's doors at the end of plan day `to`, in rank order, in the time it has left; never push a planned door
  // off: one that would, or arrive shut, or run past the end goes on to the next day (ui/plan.js rollDay)
  // Running late (ui/plan.js lateFits / moveLate: never offer a move the guard would refuse): a dry run of
  // the move per later plan day, every other door ahead held on its day → [{i, date, day, ok}] (null when the plan
  // changed under it); the move itself, the same input, kept only when it works → true | false
  async lateFits(k: number, ids: string[]) {
    const p0 = this.plan;
    const out: { i: number; date: string; day: string; ok: boolean }[] = [];
    if (!p0?.days[k] || !ids?.length) return out;
    for (const { i, date } of laterDays(p0, p0.days[k].date)) {
      const { saved, locks, drive, hold } = lateMoveInput(p0, this.st.plan, k, ids, i, this.lockedNow(), this.st.drive);
      const { p } = await this.compute({ locks, hold, base: { plan: saved, locks, drive } });
      if (this.dead || this.plan !== p0) return null;
      out.push({ i, date, day: p0.days[i].day, ok: lateMoveFits(p0, p, ids, date) });
    }
    return out;
  }
  async moveLate(k: number, ids: string[], i: number) {
    if (!this.plan?.days[k] || !this.plan.days[i] || this.plan.days[i].past || !ids?.length) return false;
    const before = this.before({ drive: this.st.drive ?? {} });
    const { saved, locks, drive, hold } = lateMoveInput(this.plan, this.st.plan, k, ids, i, this.lockedNow(), this.st.drive);
    this.save({ locks, plan: saved, drive });
    await this.replan({ refit: true, hold });
    if (this.dead) return false;
    if (lateMoveFits(before.plan, this.plan, ids, before.plan.days[i].date)) return true;
    this.restore(before);
    return false;
  }
  async rollDay(date: string, to: string, ids: string[] | null = null) {
    const move: string[] = ids ?? movedIds(this.st.drive?.[date]);
    if (!move.length || !this.plan?.days.some((d: any) => d.date === to && !d.past)) return false;
    const vm = this.profile.visitMin ?? 25;
    const live = () => this.plan.days.filter((d: any) => !d.past);
    const free = this.lockedNow();
    for (const id of move) free.delete(id);
    const orders0 = new Map<string, string[]>(live().map((d: any) => [d.date, d.stops.map((s: any) => s.id).filter((x: string) => !move.includes(x))]));
    let base: { plan: any; locks: any[] } = { plan: live().reduce((sp: any, d: any) => dropFromDay(sp, d, move) ?? sp, this.st.plan), locks: this.lockList(free, orders0) };
    const was: [string, string][] = live().filter((d: any) => d.date > date).flatMap((d: any) => d.stops.filter((s: any) => !move.includes(s.id)).map((s: any) => [s.id, d.date] as [string, string]));
    const pushedOff = () => was.filter(([id, dt]) => !this.plan.days.find((d: any) => d.date === dt)?.stops.some((s: any) => s.id === id));
    const groups: { to: string; ids: string[] }[] = [];
    let pending = move;
    for (let day: string | null = to; pending.length && day && !this.dead; day = this.plan.days.find((d: any) => !d.past && d.date > day!)?.date ?? null) {
      const at: string = day;
      const tk = this.plan.days.findIndex((d: any) => d.date === at);
      const r0 = rollPlan(this.plan, pending, tk, { visitMin: vm, shut: shutOn }) as { ids: string[]; left: string[] };
      let on = r0.ids;
      const gone: string[] = [];
      for (let guard = 0; on.length && !this.dead && guard <= pending.length; guard++) {
        const locked = new Map<string, string>(base.locks.map((l: any) => [l.id, l.index == null ? "day" : "place"]));
        const ordersNow = new Map<string, string[]>(live().map((d: any) => [d.date, d.stops.map((s: any) => s.id).filter((x: string) => !pending.includes(x) && !gone.includes(x))]));
        for (const l of base.locks) if (!ordersNow.get(l.date)?.includes(l.id)) ordersNow.set(l.date, [...(ordersNow.get(l.date) ?? []), l.id]);
        ordersNow.set(at, [...(ordersNow.get(at) ?? []), ...on]);
        for (const id of on) locked.set(id, "place");
        this.save({ plan: base.plan, locks: this.lockList(locked, ordersNow), drive: patchRecord(this.st.drive, date, { moved: [...groups, { to: at, ids: on }].filter((g) => g.ids.length) }) });
        await this.replan({ refit: true });
        const d = this.plan.days.find((x: any) => x.date === at);
        const late = on.filter((id) => { const x = d?.stops.find((y: any) => y.id === id); return !x || x.openAtArrival === false || x.depart > d.to; });
        if (!late.length && !pushedOff().length) break;
        const back = late.length ? late : [on[on.length - 1]];
        gone.push(...back);
        on = on.filter((x) => !back.includes(x));
      }
      if (!on.length && gone.length) {
        this.save({ plan: base.plan, locks: base.locks, drive: patchRecord(this.st.drive, date, { moved: groups.filter((g) => g.ids.length) }) });
        await this.replan({ refit: true });
      }
      if (on.length) base = { plan: this.st.plan, locks: this.st.locks ?? [] };
      groups.push({ to: at, ids: on });
      pending = [...r0.left, ...gone];
    }
    if (!groups.some((g) => g.ids.length) && !this.dead) {
      this.save({ plan: base.plan, locks: base.locks, drive: patchRecord(this.st.drive, date, { moved: null }) });
      await this.replan({ refit: true });
    }
    if (!this.dead) {
      this.save({ drive: patchRecord(this.st.drive, date, () => ({ bumped: pushedOff().map(([id, from]) => ({ id, from })) })) }); // a safety net, never expected
      this.plan = { ...this.plan, drive: this.st.drive };
      this.emit();
    }
    return !this.dead;
  }
  // ---------- the chat agent's actions (CONTRACTS-R9 §2.2) ----------
  setTalk(id: string, edit: any) {
    const edits = { ...(this.st.talkEdits ?? {}) };
    edits[id] = edit?.clear ? [] : edit?.undoLast ? (edits[id] ?? []).slice(0, -1) : [...(edits[id] ?? []), { section: edit.section, op: edit.op, index: edit.index, text: edit.text, by: edit.by, ...(edit.from ? { from: edit.from } : {}), at: new Date().toISOString() }];
    this.save({ talkEdits: edits });
    if (this.plan) this.plan = { ...this.plan, talkEdits: edits };
    this.emit();
  }
  // out (Doors Agent's change chip): gets {undo, said: what changed, in a few words} (ui/plan.js agentReplan)
  async agentReplan(a: any = {}, out: { undo?: () => void; said?: string } = {}) {
    const { plan, profile } = this;
    if (!plan) return null;
    const sel = this.sel;
    const day = a.day ? plan.days.find((d: any) => d.date === a.day) : typeof sel === "number" ? plan.days[sel] : plan.days.find((d: any) => !d.past);
    const before = { ...this.before({ added: this.st.added }), caps: { ...(this.planCaps ?? this.capsNow()), windows: JSON.parse(JSON.stringify(profile.windows ?? [])) } };
    const said: string[] = [];
    if (a.endBy && day) {
      profile.windows = (profile.windows ?? []).map((w: any) => (w.date === day.date && w.from < a.endBy ? { ...w, to: a.endBy } : w));
      said.push(`${cap(day.day)} ends at ${clock12(toMinutes(a.endBy))}`);
    }
    if (a.maxDoors) {
      profile.maxPerDay = a.maxDoors;
      said.push(`up to ${doorsN(a.maxDoors)} a day`);
    }
    if (a.endBy || a.maxDoors) this.save({ profile }), this.onProfile(profile);
    const locked = this.lockedNow();
    const orders = new Map<string, string[]>();
    for (const id of a.skip ?? []) {
      const at = this.placeOf(id);
      if (!at) continue;
      const next = plan.days.slice(at.i + 1).find((d: any) => !d.past);
      orders.set(at.d.date, (orders.get(at.d.date) ?? at.d.stops.map((x: any) => x.id)).filter((x: string) => x !== id));
      if (next) orders.set(next.date, [...(orders.get(next.date) ?? next.stops.map((x: any) => x.id)), id]), locked.set(id, "day");
      else locked.delete(id);
      said.push(`${plan.venues[id]?.name ?? "that door"} ${next ? `moved to ${cap(next.day)}` : "off the plan"}`);
    }
    // fix11 (judge pass 6 #7): "move X to Tuesday", as the web's plan.js; a day it's shut keeps it where it is
    const kept: string[] = [];
    for (const { id, date } of a.move ?? []) {
      const at = this.placeOf(id);
      const to = plan.days.find((d: any) => d.date === date && !d.past);
      if (!to || at?.d === to) continue;
      const shut = shutOn(plan.venues[id], { date: to.date, from: to.from, to: to.to, visitMin: profile.visitMin ?? 25 });
      if (shut) { kept.push(`${plan.venues[id]?.name ?? "That door"} is ${shut} (Qloo's hours), so it stays ${at ? `on ${cap(at.d.day)}` : "off the plan"}`); continue; }
      if (at) orders.set(at.d.date, (orders.get(at.d.date) ?? at.d.stops.map((x: any) => x.id)).filter((x: string) => x !== id));
      orders.set(to.date, [...(orders.get(to.date) ?? to.stops.map((x: any) => x.id)), id]), locked.set(id, "day");
      said.push(`${plan.venues[id]?.name ?? "that door"} moved to ${cap(to.day)}`);
    }
    for (const id of a.lock ?? []) if (this.placeOf(id)) locked.set(id, "place"), said.push(`${plan.venues[id]?.name} locked in place`);
    if ((a.skip ?? []).length || (a.lock ?? []).length || (a.move ?? []).length) this.save({ locks: this.lockList(locked, orders) });
    const added = (a.add ?? []).map((id: string) => plan.venues[id]).filter((v: any) => v && Number.isFinite(+v.lat) && !this.placeOf(v.id));
    if (added.length) this.save({ added: [...(this.st.added ?? []).filter((x: any) => !added.some((v: any) => v.id === x.id)), ...added.map((v: any) => ({ ...v, lat: +v.lat, lon: +v.lon, date: day?.date ?? null }))] }), said.push(`${added.map((v: any) => v.name).join(", ")} added`);
    if (!said.length) return kept.length ? { text: `${kept.join(". ")}.`, unchanged: true } : null; // nothing to undo
    if (!(await this.replan({ refit: true, fresh: Boolean(a.maxDoors) })) || this.dead) return null;
    let sum = replanSummary(before.plan, this.plan);
    const off = a.endBy && day ? offDayText(before.plan, this.plan, day.date, { skip: a.skip ?? [] }) : ""; // judge pass 9 #4
    if (off) (said[0] = `${said[0]}: ${off}`), (sum = withoutOffCount(sum, day.day));
    const text = `${kept.length ? `${kept.join(". ")}. ` : ""}${cap(said.join(", "))}.${sum ? ` ${sum}.` : ""}`;
    this.flash(text, () => this.restore(before));
    out.undo = () => this.restore(before);
    out.said = cap(said.join(", "));
    return text;
  }
  async whatIfFirst(id: string) {
    const at = this.plan && this.placeOf(id);
    if (!at || at.d.past || !this.movable(at.d, at.d.stops[at.n - 1])) return null;
    const top = this.lead(at.d);
    if (at.n - 1 <= top) return null;
    const locks = [...(this.st.locks ?? []).filter((l: any) => l.id !== id), { id, date: at.d.date, index: top }];
    const { p } = (await this.compute({ locks }).catch(() => ({}))) as any;
    const e = p?.days.find((x: any) => x.date === at.d.date && x.from === at.d.from);
    if (this.dead || !e?.stops.some((s: any) => s.id === id)) return null;
    const of = (d: any) => ({ min: Math.round(d.min ?? 0), mi: Math.round((d.mi ?? 0) * 10) / 10, n: d.stops.length });
    return { id, date: at.d.date, source: at.d.source === "ors" && e.source === "ors" ? "ors" : "estimate", was: of(at.d), then: of(e), dropped: at.d.stops.filter((s: any) => !e.stops.some((x: any) => x.id === s.id)).map((s: any) => this.plan.venues[s.id]?.name).filter(Boolean) };
  }
  // the S.* actions object the web's panels call (ui/state.js shape), for shared code that takes it
  actions() {
    return {
      setStatus: (id: string, s: string | null) => this.setStatus(id, s),
      setOutcome: (id: string, o: any) => this.setOutcome(id, o),
      selectDay: (d: any) => this.selectDay(d),
      addDoor: (v: any, o?: any) => this.addDoor(v, o),
      setLock: (id: string, on: boolean) => this.setLock(id, on),
      moveStop: (id: string, to: any) => this.moveStop(id, to),
      skipStop: (id: string) => this.skipStop(id),
      setDrive: (date: string, patch: any) => this.setDrive(date, patch),
      removeStop: (id: string, o?: any) => this.removeStop(id, o),
      skipDoors: (date: string, ids: string[], o?: any) => this.skipDoors(date, ids, o),
      endDay: (date: string, o?: any) => this.endDay(date, o),
      rollDay: (date: string, to: string) => this.rollDay(date, to),
      lateFits: (k: number, ids: string[]) => this.lateFits(k, ids),
      moveLate: (k: number, ids: string[], i: number) => this.moveLate(k, ids, i),
      setSlot: (id: string, r: any) => this.setSlot(id, r),
      setTalk: (id: string, e: any) => this.setTalk(id, e),
      snapshot: () => this.snapshot(),
      restore: (b: any) => b && this.restore(b),
      agentReplan: (a: any, out?: any) => this.agentReplan(a, out),
      whatIfFirst: (id: string) => this.whatIfFirst(id),
    };
  }
}
