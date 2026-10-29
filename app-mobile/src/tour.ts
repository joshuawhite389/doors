// The guided demo (public/ui/demo.js) on the phone: the same 23 cards (lib/demo-script.js) over the real phone
// screens, driving Maya's demo plan (its own store, the baked roads, Doors' rules for every answer: no live call).
// A card waits for Continue, for the visitor to do the step in the app (or "Do it for me"), or for the app to finish.
// Screens report what happened (tour.sig) and register what "Do it for me" runs (tour.handlers).
import { STEPS, COUNTED, stepAt } from "../../public/lib/demo-script.js";
import { demoProfile, DEMO_DRINKER, DEMO_SHOWCASE } from "../../public/lib/demo-profile.js";
import { emptyProfile } from "../../public/lib/profile.js";
import { stopModel } from "../../public/lib/stopmodel.js";
import { returnDiff } from "../../public/lib/demo-return.js";
import { swapSide, SWAP_CITIES, SWAP_DRINKER } from "../../public/lib/demo-swap.js";
import { replanSentence, afterDriveText, followUpNow, offVisitDay, swapLine } from "../../public/lib/demo-story.js";
import { makeOutcome, localStamp } from "../../public/lib/outcome.js";
import { cap } from "./engine";
import { navRef } from "./nav";
import { getDemoEngine, openDemo, index, saveDraft } from "./session";
import { chatFor } from "./agent";
import { getJSON } from "./data";

export const DEMO_VISIT = { who: "Sam, the bar manager", note: "Liked the samples, hesitant about price" };
export type Card = { key: string; n: number; title: string; body: string[]; act: string; cta?: string; extra?: { kind: "back"; rows: any[]; same: string | null; words: any; day: string } | { kind: "swap"; sides: any[] } | null; buttons?: { label: string; kind?: "primary" | "line" | "ghost"; on: () => void }[]; dock?: "top" | "bottom" };
const STOP = Symbol("stop");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class Tour {
  on = false;
  card: Card | null = null;
  min = false; // the card folded to a bar so the visitor can use the screen under it
  flags: Record<string, any> = {};
  handlers: Record<string, () => any> = {};
  form: any = null; // the profile the form shows during the profile cards
  outcome: any = null; // the outcome sheet's details, filled in for her
  doneText: string | null = null; // what drive mode's Done box holds
  was: any = null; // her #1's follow-up at card "replan" (lib/demo-story.js followUpNow), for the End card
  private fns = new Set<() => void>();
  private resolve: ((how: string) => void) | null = null;
  private runId = 0;
  subscribe(fn: () => void) {
    this.fns.add(fn);
    return () => void this.fns.delete(fn);
  }
  emit() {
    this.fns.forEach((f) => f());
  }
  sig(name: string, v: any = true) {
    if (!this.on) return;
    this.flags[name] = v;
  }
  press(how = "continue") {
    const r = this.resolve;
    this.resolve = null;
    r?.(how);
  }
  toggle() {
    this.min = !this.min;
    this.emit();
  }
  handoffAt: number | null = null;
  close() {
    this.runId++;
    this.on = false;
    this.card = null;
    this.press("stop");
    this.emit();
  }
  // one card: until Continue, done() turns true, or "Do it for me" (auto)
  private async step(key: string, o: { done?: () => any; auto?: () => any; toast?: string; door?: string; extra?: Card["extra"]; buttons?: Card["buttons"]; dock?: "top" | "bottom" } = {}) {
    const my = this.runId;
    const s = STEPS[stepAt(key)];
    // the web's words for the phone: a phone is tapped (judge #10), it is an app not a page (drive's buttons say the
    // same on both: lib/drive-day.js DRIVE_WORDS)
    const phone = (x: string) => x.replace(/\bClick\b/g, "Tap").replace(/\bclick\b/g, "tap").replace(/\bon this page\b/g, "in this app").replace(/\bthis page\b/g, "this app");
    const counted = STEPS.slice(0, stepAt(key) + 1).filter((x: any) => x.act !== "end").length;
    this.card = { key, n: counted, title: s.title, body: s.body.map((b: string) => phone(b.replace("{toast}", o.toast ?? "").replace("{door}", o.door || "this door").trim())).filter(Boolean), act: s.act, cta: s.cta && phone(s.cta), extra: o.extra ?? null, buttons: o.buttons, dock: o.dock };
    this.min = false;
    this.emit();
    if (s.act === "end") return;
    await new Promise<void>((ok) => {
      let iv: any = null;
      const finish = () => { clearInterval(iv); this.resolve = null; ok(); };
      this.resolve = async (how) => {
        if (how === "auto" && o.auto) { await o.auto(); if (!o.done) return finish(); return; }
        if (how === "continue" && s.act !== "click" && s.act !== "wait") return finish();
        if (how === "stop") return finish();
      };
      if (o.done) iv = setInterval(() => { try { if (o.done!()) finish(); } catch {} }, 300);
    });
    if (my !== this.runId) throw STOP;
  }
  async start({ skip = false } = {}) {
    this.runId++;
    this.on = true;
    this.flags = {};
    this.was = null;
    this.handlers = {};
    this.outcome = null;
    this.doneText = null;
    const my = this.runId;
    const nav = () => navRef.current!;
    try {
      if (skip) return await this.finished();
      // ---------- the profile ----------
      const target = demoProfile();
      this.form = { ...emptyProfile() };
      nav().reset([{ name: "home" }, { name: "form", params: { tour: true } }]);
      await this.step("intro", { buttons: [{ label: "Skip to the finished plan", kind: "line", on: () => this.start({ skip: true }) }] });
      this.form = { ...this.form, brand: target.brand, what: target.what, drinks: [{ ...DEMO_DRINKER }], pitch: { ...this.form.pitch, name: target.pitch.name }, city: target.city, rooms: [...target.rooms], roomsTouched: true };
      this.emit();
      await this.step("drinker");
      this.form = { ...this.form, start: { ...target.start }, windows: target.windows.map((w: any) => ({ ...w })), visitMin: target.visitMin };
      this.emit();
      await this.step("day");
      this.form = { ...this.form, pitch: { ...target.pitch, support: [...target.pitch.support] }, known: [...target.known] };
      this.emit();
      await this.step("pitch");
      await this.step("build", { done: () => this.flags.built, auto: () => this.handlers.build?.() });
      // ---------- the plan ----------
      await this.step("building", { done: () => this.flags.ready });
      await sleep(300);
      await this.step("tuesday");
      const e = () => getDemoEngine()!;
      await this.ask("askwhy", "Nomadic Beerworks is ranked #1. Why isn't it my first stop?");
      await this.step("answer");
      nav().back();
      await sleep(300);
      // docked at the top: at the bottom it covered the day tabs on an SE (mobile2 10-24); Plan scrolls All days into view
      if (e().sel !== "week") await this.step("week", { done: () => e().sel === "week", auto: () => e().selectDay("week"), dock: "top" });
      const id = Object.keys(e().plan.venues).find((k) => e().plan.venues[k]?.name === DEMO_SHOWCASE.name) ?? DEMO_SHOWCASE.id;
      const dayOf = () => e().plan.days.findIndex((d: any) => d.stops.some((x: any) => x.id === id));
      const onStop = () => { const t = nav().stack.at(-1); return t?.name === "stop" && t.params?.id === id; };
      await this.step("open", { done: onStop, auto: () => nav().push("stop", { demo: true, id, day: dayOf() }) });
      setTimeout(() => (this.handlers as any).scrollStop?.("rank"), 400);
      await this.step("why");
      setTimeout(() => (this.handlers as any).scrollStop?.("talk"), 400);
      await this.step("talk");
      await this.ask("shorter", "Make the opener for Nomadic Beerworks shorter");
      await sleep(1200);
      nav().back();
      // Mark visited: the sheet with her details; on Tuesday, at the day's start (the return visit says "you talked on Tue")
      const pl = e().plan;
      const vday = pl.days.find((d: any) => d.stops.some((x: any) => x.id === id));
      const vwin = e().profile.windows?.find((w: any) => w.date === vday?.date);
      const thu = pl.days.at(-1)?.date ?? null;
      this.outcome = { result: "interested", followUp: thu, who: DEMO_VISIT.who, note: DEMO_VISIT.note, more: true, at: vday ? new Date(`${vday.date}T${vwin?.from ?? "13:00"}:00`) : null };
      this.flags.sheet = false;
      await this.step("visit", { done: () => this.flags.sheet || e().plan.outcomes?.[id], auto: () => this.handlers.visit?.() });
      if (!e().plan.outcomes?.[id]) {
        await this.step("outcome", { done: () => e().plan.outcomes?.[id], auto: () => this.handlers.saveOutcome?.(), dock: "top" });
      }
      this.outcome = null;
      const saved = e().plan.outcomes?.[id];
      if (saved?.followUp) {
        await sleep(600);
        if (nav().stack.at(-1)?.name === "stop") nav().back();
        e().selectDay("week");
        e().clearToast();
        this.was = followUpNow(e().plan, id, saved.followUp); // the End card says where it moved from (intuit pass 1b #2)
        const off = offVisitDay(pl, e().plan, vday?.date, id); // the doors the visit pushed off Tuesday, named
        await this.step("replan", { toast: [off, replanSentence(e().plan, id, saved.followUp, { highlighted: false })].filter(Boolean).join(" ") });
        await this.backStep(id);
      }
      // ---------- drive mode ----------
      const onDrive = () => nav().stack.at(-1)?.name === "drive";
      await this.step("drive", { done: onDrive, auto: () => nav().push("drive", { demo: true }) });
      await sleep(600);
      const later = e().profile.windows?.at(-1)?.date ?? thu;
      const when = later ? new Date(`${later}T12:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "Thursday";
      this.doneText = `done, liked it, come back ${when} at 3, hesitant about price`;
      this.flags.driveSheet = false;
      const dday = e().plan.days?.[0];
      const door = e().plan.venues?.[dday?.stops?.find((x: any) => e().plan.statuses?.[x.id] !== "visited")?.id]?.name ?? ""; // drive's first door: cards 20-21 name it
      await this.step("done", { door, done: () => this.flags.driveSheet, auto: () => this.handlers.driveDone?.(), dock: "top" });
      await sleep(500);
      this.flags.driveRead = false;
      this.handlers.driveLog?.();
      for (let i = 0; i < 30 && !this.flags.driveRead; i++) await sleep(250);
      this.flags.driveSaved = false;
      await this.step("save", { door, done: () => this.flags.driveSaved, auto: () => this.handlers.driveSave?.(), dock: "top" }); // judge #5: the card hid Save
      this.doneText = null;
      await sleep(1800);
      if (onDrive()) nav().back();
      await this.swapStep();
      this.handOff();
    } catch (err) {
      if (err === STOP || my !== this.runId) return;
      console.warn("tour: off script", err);
      this.card = { key: "off", n: 0, title: "You left the tour", body: ["Everything in the app still works. Keep going, or restart the tour from the beginning."], act: "end", buttons: [{ label: "Restart the tour", kind: "line", on: () => this.start() }, { label: "Keep exploring", kind: "primary", on: () => this.close() }] };
      this.emit();
    }
  }
  private async ask(key: string, text: string) {
    const e = getDemoEngine()!;
    const chat = chatFor(e);
    const n = chat.messages.length;
    navRef.current!.push("ask", { demo: true, prefill: text });
    await this.step(key, { done: () => chat.messages.length >= n + 2 && !chat.busy, auto: () => chat.send(text, { current: null }) });
  }
  private async finished() {
    const e = await openDemo({ fresh: true, endState: true });
    saveDraft({ ...demoProfile(), sample: true }, null);
    e.selectDay("week");
    navRef.current!.reset([{ name: "home" }, { name: "plan", params: { demo: true } }]);
    this.handOff();
  }
  private async backStep(id: string) {
    const e = getDemoEngine()!;
    const plan = e.plan;
    const k = plan.days.length - 1;
    if (!plan.days[k]?.stops?.some((x: any) => x.id === id)) return;
    try {
      const data = await e.stopData();
      const after = stopModel({ plan, id, dayIndex: k, ...data });
      const before = stopModel({ plan, id, dayIndex: k, ...data, slotsOff: ["S4"] });
      if (after.talk.visit !== "return") return;
      const d = returnDiff(before, after);
      const same = after.hoursToday && after.hoursToday !== "hours unverified" ? `open ${after.hoursToday} ${cap(plan.days[k]?.day ?? "")}`.trim() : null; // judge pass 8 #2: no rank number in the tour
      const day = new Date(`${plan.days[k].date}T12:00`).toLocaleDateString("en-US", { weekday: "long" });
      await this.step("back", { extra: { kind: "back", rows: d.rows, same, words: d.noteWords, day } });
    } catch (err) {
      if (err === STOP) throw err;
      console.warn("tour: return card", err);
    }
  }
  private async swapStep() {
    let sides: any[] | null = null;
    try {
      sides = await Promise.all(SWAP_CITIES.map(async (key: string) => {
        const [route, city] = await Promise.all([getJSON(`/data/routes/${SWAP_DRINKER}-${key}.json`), getJSON(`/data/cities/${key}.json`)]);
        const cityName = index?.cities?.find((c: any) => c.key === key)?.name ?? cap(key);
        return swapSide({ route, city, cityKey: key, cityName, profile: demoProfile() });
      }));
    } catch {}
    if (!sides?.every(Boolean)) return;
    await this.step("swap", { extra: { kind: "swap", sides }, toast: swapLine(sides) });
  }
  private handOff() {
    const e = getDemoEngine();
    const tue = e?.plan?.days?.[0]?.stops ?? [];
    const k = tue.findIndex((x: any) => e!.plan.statuses?.[x.id] !== "visited");
    const buttons: Card["buttons"] = [];
    if (k >= 0) buttons.push({ label: `Open ${e!.plan.venues?.[tue[k].id]?.name ?? `stop ${k + 1}`} (Tuesday)`, kind: "line", on: () => { this.close(); e!.selectDay(0); navRef.current!.push("stop", { demo: true, id: tue[k].id, day: 0 }); } });
    buttons.push({ label: "Start my profile", kind: "primary", on: () => { this.close(); navRef.current!.reset([{ name: "home" }, { name: "form", params: { blank: true } }]); } });
    buttons.push({ label: "Close", kind: "ghost", on: () => this.close() });
    this.handoffAt = null; // the last card closes when she leaves the screen it first shows on (TourCard records it; judge #5)
    const top = e?.plan ? Object.keys(e.plan.venues).find((k) => e.plan.venues[k]?.name === DEMO_SHOWCASE.name) ?? DEMO_SHOWCASE.id : null;
    this.step("handoff", { buttons, toast: top ? afterDriveText(e!.plan, top, this.was) : "" }).catch(() => {}); // judge pass 9 #2
  }
}
export const tour = new Tour();
export { COUNTED };

export const makeTourOutcome = (o: any) => makeOutcome({ result: o.result, followUp: o.followUp ?? "", who: o.who, note: o.note, at: localStamp(o.at ?? new Date()) });
