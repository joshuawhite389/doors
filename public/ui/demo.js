// The guided demo, #/demo (SPEC-V2 §3.6, reworked as an onboarding tour after the owner's first review): Maya Ortiz's
// profile fills in section by section, a card stopping on each part worth explaining; the visitor presses Build my
// plan, Week, the #1 stop, Mark visited and Save outcome in the real app; the week re-plans; the controls are theirs.
// Steps and their words: ../lib/demo-script.js. Cards: ./coach.js. Persona and profile: ../lib/demo-profile.js.
// Baked data: /data/demo/demo.json (scripts/bake-demo.mjs): her contact's record, the OSRM road matrix and every
// day's road geometry.
// Rules:
//   - The demo plan is baked: no call to Qloo, ORS or the plan-building endpoints. Every same-origin /api/ request is
//     refused while the demo is on screen (counted in window.__demo.blocked) except LIVE (Jard 10-29: "I don't want
//     any parts of the app we are submitting not working anywhere for anyone at any time"): Doors Agent (/api/agent,
//     its log-visit and Day done polish) and the Aura voice (/api/voice/*) work as in the app, under the Worker's own
//     per-visitor limits (counted in window.__demo.live). The plan lives in a memory store, never the visitor's saved plans.
//   - Nothing waits on a timer the visitor can't see: every step waits for Continue or for the visitor's own click.
//   - "Skip to the finished plan" (the banner, every step; once: card 1 no longer repeats it) jumps to the ?instant=1 end state with no reload.
//   - The visitor can leave the script at any point (click around, close the tour, build early) and nothing breaks:
//     the form is filled through the profile (renderProfile's sync), never through focus-dependent typeaheads; a step
//     whose target is gone shows its card in the middle; anything unexpected ends the tour with "keep exploring".
//   - A reload resumes (H3, ../lib/demo-session.js, this tab's sessionStorage): on the form, the same card with the form
//     filled to it; once the plan is built, the plan as they left it (visits and outcomes kept), the tour closed, with
//     a card that says so. "Restart demo" clears it and starts at card 1. Any other way in (Watch the tour, Watch the
//     demo instead) starts at card 1.
// ?instant=1: the hand-off end state at once (screenshots); it neither reads nor writes the saved progress.
import { STEPS, COUNTED, stepAt } from "../lib/demo-script.js";
import { PERSONA, DEMO_KNOWN, DEMO_DRINKER, demoProfile } from "../lib/demo-profile.js";
import { demoStates, bakedMatrix, DEMO_ATTRIBUTION } from "../lib/demo-plan.js";
import { swapSide, SWAP_CITIES, SWAP_DRINKER } from "../lib/demo-swap.js";
import { returnDiff } from "../lib/demo-return.js";
import { stopModel } from "../lib/stopmodel.js";
import { emptyProfile } from "../lib/profile.js";
import { replanSentence, afterDriveText, followUpNow, offVisitDay, swapLine } from "../lib/demo-story.js";
import { createStore } from "../lib/store.js";
import { loggingStore } from "../lib/logbook.js"; // the activity log (round 4 item 10)
import { BASIS_BUTTON } from "../lib/basis.js"; // round 6 #5: the explore card names the top-bar button by its constant
import { prefixed, readRecord, writeRecord, clearDemo, resumeFrom } from "../lib/demo-session.js";
import { $, esc, cap } from "./dom.js";
import { getJSON, loadRoutes } from "./data.js";
import { renderProfile } from "./profile.js";
import { renderPlan } from "./plan.js";
import { setOutcomeClock } from "./outcome.js";
import { shownName } from "../lib/pool.js";
import { loadStopData } from "./stop.js";
import { createMap } from "./map.js";
import { seedRoad, activePlayer, isInstant, reducedMotion, setRoadsOffline } from "./animate.js";
import { createCoach } from "./coach.js";
import * as S from "./state.js";
import { icon } from "../lib/icons.js"; // the Doors icon set (Jard 10-24 #1)

// what she logs at the #1 stop: Sam is made up like Maya (CULTURAL-SLOTS §7.3: a name, never a trait)
const DEMO_VISIT = { who: "Sam, the bar manager", note: "Liked the samples, hesitant about price" };

if (!document.querySelector('link[href="/css/demo.css"]')) document.head.append(Object.assign(document.createElement("link"), { rel: "stylesheet", href: "/css/demo.css" }));

// what the demo lets through to the Worker (Jard 10-29): Doors Agent and the Aura voice, as in the app
export const DEMO_LIVE = new Set(["/api/agent", "/api/agent/log-visit", "/api/agent/debrief", "/api/voice/say", "/api/voice/listen"]);
const STOP = Symbol("demo stopped"); // the page left, or the visitor closed the tour
const BUILT_EARLY = Symbol("build pressed"); // the visitor pressed Build my plan before the tour got there
const BUILT = "doors.v2.built"; // B2's once-per-profile building flag (sessionStorage)
const TYPE_MS = 34; // per character
const TRAVEL_NOTE = "Miles and drive times: OSRM (baked for the demo), © OpenStreetMap contributors.";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// a reload (or back/forward) of a page that opened on #/demo: its first demo may resume a finished plan
const RELOADED = ["reload", "back_forward"].includes(performance.getEntriesByType?.("navigation")?.[0]?.type) && /^#\/demo/.test(location.hash);
let rendered = 0;
const session = () => { try { return sessionStorage; } catch { return null; } };

// renderDemo(root, {index, params, onHandOff(profile)}) → cleanup. Synchronous: the banner and the form show at once.
export function renderDemo(root, { index, params = {}, onHandOff }) {
  const instant = isInstant() || params.instant != null;
  const still = reducedMotion();
  // where this demo opens (H3): a reload resumes; anything else starts at card 1 with the old progress cleared
  const ss = instant ? null : session();
  const resume = ss ? resumeFrom(readRecord(ss), { reload: RELOADED && !rendered }) : null;
  rendered++;
  if (ss && !resume) clearDemo(ss);
  const save = (rec) => { if (ss && !ctl.dead) writeRecord(ss, rec); };
  // this tab only: the demo never touches the visitor's saved plans (memory when storage is blocked, or for ?instant=1)
  const store = loggingStore(createStore(ss ? prefixed(ss) : null), { nameOf: (id) => S.getPlan()?.venues?.[id]?.name ?? null });
  const log = (window.__demo = { start: Date.now(), steps: [], blocked: [], live: [], errors: [], done: null });
  const ctl = { dead: false, off: false, skip: false, built: false, phase: "profile", planned: false, building: null };
  const coach = createCoach();
  let cleanups = [];
  let prewarm = null;

  // ---------- Ask Doors in the demo: the live Doors Agent (ui/agent.js's own fetch, through the allow-list below), on
  // the demo plan as its context; drive mode's microphone, hands-free bar and Aura voice as in the app ----------
  document.documentElement.classList.add("in-demo"); // css: on a phone the Ask Doors sheet leaves room for the card
  try { for (let i = (ss?.length ?? 0) - 1; i >= 0; i--) { const k = ss.key(i); if (k?.startsWith("doors.v2.chat.Tidewell")) ss.removeItem(k); } } catch {} // a fresh chat each demo

  // ---------- no Qloo, ORS or plan-building calls while the demo is on screen (the plan is baked) ----------
  setRoadsOffline(true); // a day the demo didn't bake gets the labelled estimate, never /api/directions
  const realFetch = window.fetch;
  window.fetch = (input, init) => {
    const u = new URL(typeof input === "string" || input instanceof URL ? String(input) : input.url, location.href);
    if (u.origin === location.origin && DEMO_LIVE.has(u.pathname)) {
      log.live.push(u.pathname);
      if (u.pathname === "/api/agent") log.agent = (log.agent ?? 0) + 1;
    } else if (u.origin === location.origin && u.pathname.startsWith("/api/")) {
      log.blocked.push(u.pathname);
      console.warn(`demo: refused ${u.pathname} (the demo's plan is baked)`);
      return Promise.resolve(new Response(JSON.stringify({ error: "The demo's plan is baked: this call is off in the demo." }), { status: 503, headers: { "content-type": "application/json" } }));
    }
    return realFetch(input, init);
  };

  root.innerHTML = `
  <div class="demo${still ? " still" : ""}">
    <div class="demo-banner" role="region" aria-label="Demo">
      <span class="dtext">${icon("play", 13, "ic l")}<b>Guided demo.</b> <span class="dline">${esc(PERSONA.name)} · ${esc(PERSONA.brand)} · Austin.</span> <span class="dfic">${esc(PERSONA.fiction)}</span></span>
      <div class="ctl">
        <span class="dstep" aria-live="polite"></span>
        <button type="button" data-d="restart" data-short="" aria-label="Restart demo">${icon("restart", 15, "ic l")}Restart demo</button>
        <button type="button" data-d="skip" data-short="Skip to end" aria-label="Skip to the finished plan">Skip to the finished plan</button>
        <button type="button" data-d="close" data-short="" aria-label="Close tour">${icon("close", 15, "ic nar")}Close tour</button>
      </div>
    </div>
    <div class="dstage"></div>
  </div>`;
  const stage = $(".dstage", root);
  const banner = $(".demo-banner", root);
  const say = (text) => { $(".dstep", banner).textContent = text; };
  // tour fit (320): the banner sits over the page (under the app bar, then sticky at the top), so a door's full-height
  // sheet ran under it (its ← All stops and Stop n of m hidden); stop.css caps the sheet below the banner's bottom edge,
  // kept current here as the banner wraps or the page scrolls
  const bannerH = () => document.documentElement.style.setProperty("--dbanner-h", `${Math.max(0, Math.round(banner.getBoundingClientRect().bottom))}px`);
  const bannerRO = typeof ResizeObserver === "function" ? new ResizeObserver(bannerH) : null;
  bannerRO?.observe(banner);
  window.addEventListener("scroll", bannerH, { passive: true });
  bannerH();

  banner.addEventListener("click", (e) => {
    const k = e.target.closest("[data-d]")?.dataset.d;
    if (k === "restart") restart();
    else if (k === "skip") skipToEnd();
    else if (k === "close") closeTour();
  });
  function restart() {
    if (ss) clearDemo(ss);
    ctl.dead = true; // nothing writes the progress back on the way out
    location.reload();
  }
  // the visitor takes over: the cards go, the app stays
  function closeTour() {
    ctl.off = true;
    coach.hide();
    $('[data-d="close"]', banner).hidden = true;
    say("");
  }
  // from any step: the script stops where it is, and the finished plan (the ?instant=1 end state) replaces the page
  async function skipToEnd() {
    if (ctl.skip || ctl.dead) return;
    ctl.skip = true;
    coach.hide();
    $('[data-d="skip"]', banner).hidden = true;
    $('[data-d="close"]', banner).hidden = true;
    say("");
    try {
      await ctl.building?.catch(() => {}); // a build already under way lands first, then the end state replaces it
      if (activePlayer()?.building) { // the building phase ends itself before its map goes
        skipBuilding();
        for (let i = 0; i < 50 && !built.v; i++) await sleep(40);
      }
      await buildPlan({ endState: true });
      S.selectDay("week");
      handOff();
    } catch (e) {
      ctl.skip = false;
      offScript(e);
    }
  }

  // the data, loading while the form fills
  const dataP = Promise.all([getJSON("/data/demo/demo.json"), loadRoutes(demoProfile(), index)]).then(([demo, routes]) => ({ demo, routes }));
  dataP.catch(() => {});

  // ---------- waiting: every wait ends when the page leaves, the tour closes, or (on the form) Build is pressed ----------
  const check = () => {
    if (ctl.dead || ctl.off || ctl.skip) throw STOP;
    if (ctl.phase === "profile" && ctl.built) throw BUILT_EARLY;
  };
  async function pause(ms) {
    const end = performance.now() + (still ? Math.min(ms, 150) : ms);
    for (;;) {
      check();
      const left = end - performance.now();
      if (left <= 0) return;
      await sleep(Math.min(left, 40));
    }
  }
  async function until(fn, timeout = Infinity) {
    const t0 = performance.now();
    for (;;) {
      check();
      let v = null;
      try { v = fn(); } catch {}
      if (v) return v;
      if (performance.now() - t0 > timeout) return null;
      await sleep(60);
    }
  }

  // ---------- a step: its card, then Continue or the visitor's own click ----------
  // o: {target: () => Element, done: () => truthy, auto: () => void (Do it for me), toast, door (fills "{door}"), place}
  let ff = -1; // a resumed form: the steps before this one fill in at once, with no card
  async function step(key, o = {}) {
    const i = stepAt(key);
    const s = STEPS[i];
    if (i < ff) return void check();
    ff = -1;
    if (s.act !== "end") check(); // the hand-off shows after a skip too
    else if (ctl.dead) throw STOP;
    if (s.phase === "profile") save({ phase: "form", step: key });
    log.steps.push({ key, at: Date.now() - log.start });
    // intuit audit (smaller): the banner said "Step 5 of 22" and the card "5 OF 22"; the card keeps it (the banner's
    // step is hidden on a phone anyway)
    say("");
    let go = false;
    const buttons = [...(o.lead ?? [])];
    if (s.act === "continue") buttons.push({ label: "Continue", kind: "primary", on: () => (go = true) });
    if (s.act === "click" && o.auto) buttons.push({ label: "Do it for me", kind: "link", on: () => { try { o.auto(); } catch (e) { console.warn("demo:", e); } } });
    if (o.buttons) buttons.push(...o.buttons);
    coach.show({
      target: o.target ?? (() => null), title: s.title, body: s.body.map((b) => b.replace("{toast}", o.toast ?? "").replace("{door}", o.door || "this door").trim()).filter(Boolean),
      counter: s.act === "end" ? "" : `Step ${i + 1} of ${COUNTED}`, cta: s.cta, buttons, dim: s.act !== "wait" && s.act !== "end", place: o.place, dock: o.dock, beside: o.beside, keep: o.keep, reveal: o.reveal, extra: o.extra, wide: o.wide, explore: o.explore,
    });
    if (s.act === "end") return;
    await until(() => go || o.done?.());
    coach.hide();
  }

  // ---------- helpers ----------
  const hl = (el, on = true) => el?.classList.toggle("demo-hl", on);
  async function flash(el, ms = 650) {
    if (!el || ff >= 0) return;
    el.scrollIntoView({ block: "center", behavior: still ? "auto" : "smooth" });
    hl(el);
    await pause(ms);
    hl(el, false);
  }
  // type into a text field: its own input listener sees every character (no focus needed)
  async function typeInto(el, text) {
    if (!el) return;
    hl(el);
    for (let i = still || ff >= 0 ? text.length : 1; i <= text.length; i++) {
      el.value = text.slice(0, i);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      if (i < text.length) await pause(TYPE_MS);
    }
    hl(el, false);
  }
  // the look of typing, with no events: the typeahead stays shut and the pick goes through the profile
  async function typeLook(el, text) {
    if (!el || still || ff >= 0) return;
    hl(el);
    for (let i = 1; i <= text.length; i++) {
      el.value = text.slice(0, i);
      await pause(TYPE_MS);
    }
    el.value = "";
    hl(el, false);
  }

  // tiles for the plan map, fetched while the form fills (no blank map when the route builds)
  function warmTiles(demo) {
    if (instant || !window.maplibregl) return null;
    const el = document.createElement("div");
    el.className = "dwarm";
    el.setAttribute("aria-hidden", "true");
    document.body.append(el);
    let map = null;
    let dead = false;
    const stop = () => {
      dead = true;
      try { map?.remove(); } catch {}
      map = null;
      el.remove();
    };
    const idle = () => new Promise((r) => { map?.once("idle", r); setTimeout(r, 4000); });
    (async () => {
      const tue = demo.roads[0];
      const m = (await createMap(el, { city: "austin", interactive: false, view: { center: [tue.start.lon, tue.start.lat], zoom: 12 } })).map;
      if (dead) return void m.remove();
      map = m;
      await idle();
      const pts = tue.geometry.coordinates.filter((_, i, a) => i % Math.max(1, Math.floor(a.length / 6)) === 0);
      for (const [lon, lat] of pts) {
        if (dead) return;
        map.jumpTo({ center: [lon, lat], zoom: 14.6, pitch: 45 });
        await idle();
      }
      stop();
    })().catch(stop);
    return stop;
  }

  // ---------- the profile: filled section by section ----------
  let profile = null;
  let form = null;
  async function profileTour(from = null) {
    ff = from ? stepAt(from) : -1;
    profile = emptyProfile();
    const p = profile;
    const target = demoProfile();
    stage.innerHTML = "";
    form = renderProfile(stage, {
      index, profile: p, onChange: () => {},
      onBuild: () => {
        ctl.built = true;
        if (ctl.off && !ctl.skip && !ctl.planned) buildPlan().catch(offScript); // the tour is closed: just build what they made
      },
    });
    cleanups.push(form);
    $(".pside", stage).innerHTML = `<div class="pside-in">
      <h3>Who's using this</h3>
      <div class="persona"><div class="avatar" aria-hidden="true">MO</div><div><b>${esc(PERSONA.name)}</b><div class="small muted">Founder, ${esc(PERSONA.brand)} · San Diego</div></div></div>
      <p>Tidewell is in 40 San Diego accounts. A distributor just picked it up for Austin, and Maya has three afternoons next week to get it onto menus.</p>
      <p>She doesn't know Austin's bars. Her customers drink Athletic Brewing: the person who orders one at a brewery while their friends order IPAs.</p></div>`; // judge pass 2 (27): the banner says the fiction, once
    const f = (sel) => $(sel, stage);
    dataP.then(({ demo }) => { if (!ctl.dead && !instant) prewarm = warmTiles(demo); }).catch(() => {});

    // intuit pass 2 #1: under 420 px the banner is one row without the made-up line, so card 1 says it there
    const fic = document.createElement("p"); fic.className = "cfic"; fic.textContent = PERSONA.fiction;
    // intuit pass 2 (M9): Skip once, in the banner; card 1 no longer repeats it
    await step("intro", { target: () => f(".pside"), extra: fic });

    // brand, what she makes, her customers' brand, city, rooms
    f("#f-brand")?.scrollIntoView({ block: "center", behavior: still ? "auto" : "smooth" });
    await typeInto(f("#f-brand"), target.brand);
    await typeInto(f("#f-what"), target.what);
    await typeLook(f("#f-drinks"), "Athletic");
    p.drinks = [{ ...DEMO_DRINKER }];
    p.product = { ...target.product }; // group 3 #4: what it comes in (required)
    p.sells = [...(target.sells ?? [])]; // r2: how she sells in Austin
    p.pitch = { ...p.pitch, name: target.pitch.name }; // N1: the signer sits with the brand, required
    p.city = target.city;
    p.rooms = [...target.rooms];
    p.roomsTouched = true;
    form.sync();
    await flash(f("#fd-drinks"), 400);
    await step("drinker", { target: () => f("#fd-drinks") });

    // where her day starts, and when she's free
    p.start = { ...target.start };
    form.sync();
    await flash(f("#fd-start"), 400);
    p.windows = target.windows.map((w) => ({ ...w }));
    p.week = structuredClone(target.week); // her usual week: Tue, Wed, Thu, the demo plans its first
    p.visitMin = target.visitMin;
    form.sync();
    await flash(f("#fd-windows"), 400);
    // judge pass 4 (14): on a phone the whole field is taller than the room above the card, so the card covered Thursday;
    // the three days' windows alone fit, put just under the banner (the card docks below them)
    const phone = matchMedia("(max-width: 700px)").matches && f("#wins");
    if (phone) window.scrollBy({ top: phone.getBoundingClientRect().top - ($(".demo-banner")?.getBoundingClientRect().bottom ?? 0) - 18 });
    await step("day", { target: () => (phone && f("#wins")) || f("#fd-windows") });

    // her pitch and the doors she skips (judge pass 8 #4: no contacts block here, the real form has none; her contact
    // BBG's is added on the plan, as + Add a door does)
    p.pitch = { ...target.pitch, support: [...target.pitch.support] };
    form.sync();
    if (f("#fd-pitch")) f("#fd-pitch").open = true;
    await flash(f("#fd-pitch"), 400);
    p.known = [...target.known];
    const known = f("#fd-known");
    if (known) known.open = true;
    form.sync();
    await dataP;
    await until(() => f("#known-tags .tag"), 1500); // the ranked rooms load, then Central District Brewing shows
    await flash(known);
    await step("pitch", { target: () => f("#fd-known") ?? f("#fd-pitch") });

    // the visitor builds
    await step("build", { target: () => f("#build"), done: () => ctl.built, auto: () => f("#build")?.click() });
  }

  // ---------- the plan: Build my plan → the building phase, Tuesday on baked roads ----------
  let ctx = null; // {demo, routes, stop1, thu}
  const story = { top: null, was: null }; // judge pass 9 #2: her #1 door, for the hand-off's "where it is now" (and where it was)
  const built = { v: false };
  const onBuilt = (e) => { if (["done", "skipped", "cancelled"].includes(e.detail?.stage)) built.v = true; };
  window.addEventListener("doors:building", onBuilt);
  const skipBuilding = () => window.dispatchEvent(new CustomEvent("doors:run-route", { detail: { stop: true, reason: "skip" } }));

  function buildPlan(o) {
    const p = (ctl.building = buildNow(o));
    p.catch(() => {});
    return p;
  }
  // restore (H3): the plan saved in this tab, as the visitor left it, with no building phase
  async function buildNow({ endState = false, restore = null } = {}) {
    ctl.phase = "plan";
    ctl.planned = true;
    const { demo, routes } = await dataP;
    if (ctl.dead) throw STOP;
    prewarm?.();
    prewarm = null;
    for (const r of demo.roads) seedRoad(r.start, r.stops, r);
    const p = restore ?? (endState ? demoProfile() : profile ?? demoProfile()); // the end state is Maya's whole profile
    profile = p;
    if (endState) {
      // judge pass 6 (#5): with the drive step too, so Skip ends where the walked tour does (19 + 2, Thu 5)
      const { st } = await demoStates({ routes, profile: p, contact: demo.contact, fetchMatrix: bakedMatrix(demo.matrix), drive: true });
      store.save(p.brand, p.city, { ...st, profile: p });
    } else if (!restore) store.update(p.brand, p.city, { contacts: [demo.contact] }); // a restore: the store holds it
    if (!restore) save({ phase: "plan", profile: p, done: false });
    let old = null;
    try { old = sessionStorage.getItem(BUILT); sessionStorage.removeItem(BUILT); } catch {}
    built.v = false;
    await sleep(50); // the form's last async redraws land before it goes
    if (ctl.dead) throw STOP;
    for (const fn of cleanups.splice(0)) { try { fn?.(); } catch {} }
    form = null;
    stage.innerHTML = "";
    window.scrollTo(0, 0);
    stage.scrollTop = 0;
    const stopPlan = await renderPlan(stage, { index, profile: p, store, demo: { fetchMatrix: bakedMatrix(demo.matrix), cache: new Map(), travelNote: TRAVEL_NOTE } });
    cleanups.push(stopPlan);
    try { if (old) sessionStorage.setItem(BUILT, old); } catch {}
    if (ctl.dead) throw STOP;
    const wrap = $(".mapwrap", stage);
    if (wrap && !$(".rattr", wrap)) wrap.append(Object.assign(document.createElement("div"), { className: "rattr", textContent: DEMO_ATTRIBUTION }));
    const plan = S.getPlan();
    ctx = { demo, routes, stop1: demo.stop1, thu: plan?.days?.at(-1)?.date ?? null };
    if ((endState || restore) && activePlayer()?.building) skipBuilding();
    return plan;
  }

  const sv = () => $(".stopview:not([hidden])", stage);
  const row = (id, day) => $(`.stops.week .stop[data-id="${CSS.escape(id)}"]${day != null ? `[data-day="${day}"]` : ""}`, stage);
  const anyRow = (id) => row(id) ?? $(`.stop[data-id="${CSS.escape(id)}"]`, stage);
  const section = (title) => [...(sv()?.querySelectorAll(".sect") ?? [])].find((s) => s.querySelector("h4")?.textContent.startsWith(title)) ?? null;

  // ---------- owner review 9: Ask Doors (ui/agent.js), the real panel; its turns go to the live Doors Agent ----------
  const panel = () => document.querySelector("#agentPanel");
  async function ask(key, text, o = {}) {
    if (!$('[data-agent="open"]', stage)) return false; // no chat in this build
    if (panel()?.hidden !== false) $('[data-agent="open"]', stage)?.click();
    await until(() => document.querySelector("#agentInput"), 3000);
    const input = document.querySelector("#agentInput");
    if (!input) return false;
    let replied = false;
    const on = () => (replied = true);
    window.addEventListener("doors:agent-reply", on);
    try {
      await typeInto(input, text);
      await step(key, { target: () => document.querySelector("#agentInput")?.closest("form") ?? panel()?.querySelector('[data-agent="send"]') ?? panel(), done: () => replied, auto: () => panel()?.querySelector('[data-agent="send"]')?.click(), ...o });
      await until(() => replied, 30000); // a live turn: the panel's own cut-off (ui/agent.js TURN_MS 25 s) answers by rules past it
    } finally { window.removeEventListener("doors:agent-reply", on); }
    await pause(500);
    return true;
  }
  const closeAgent = () => { if (panel() && !panel().hidden) panel().querySelector('[data-agent="close"]')?.click(); };

  async function planTour() {
    const plan = await buildPlan();
    if (!plan?.days?.length) throw new Error("no plan for this profile");
    if (activePlayer()?.building) await step("building", { done: () => built.v, place: "corner" });
    await pause(400);

    await step("tuesday", { target: () => $(".rcol .stops", stage) ?? $(".rcol", stage) });

    if (await ask("askwhy", "Nomadic Beerworks is ranked #1. Why isn't it my first stop?")) {
      const facts = [...(panel()?.querySelectorAll("details") ?? [])].at(-1); // the sources, open: they are the point
      if (facts) facts.open = true;
      await pause(300);
      // the whole panel is framed; its log scrolls so the reply's first line and its Sources header are on screen
      const showReply = () => {
        const log = panel()?.querySelector(".alog");
        const msg = [...(log?.querySelectorAll('.agent-msg[data-role="agent"]') ?? [])].at(-1);
        if (log && msg) log.scrollTop += msg.getBoundingClientRect().top - log.getBoundingClientRect().top - 8;
      };
      // reshoot5: on a phone the panel is a bottom sheet and the card docked over its answer; like card 13 it now points
      // at the answer's log and stays above the sheet (the bigger side), so the answer and its Sources show
      const phone = () => matchMedia("(max-width: 700px)").matches;
      await step("answer", { target: () => (phone() && panel()?.querySelector(".alog")) || panel(), reveal: showReply, keep: () => (phone() ? panel() : null) });
      closeAgent();
      await pause(300);
    }

    if (S.getSelectedDay() !== "week")
      await step("week", { target: () => $('.daytabs [data-tab="week"]', stage), done: () => S.getSelectedDay() === "week", auto: () => S.selectDay("week") });

    await step("open", {
      target: () => anyRow(ctx.stop1)?.querySelector("[data-open]") ?? anyRow(ctx.stop1),
      beside: () => anyRow(ctx.stop1), // judge pass 4 (14): the card never covers the rest of her row
      done: () => sv()?.querySelector("h2"),
      auto: () => window.dispatchEvent(new CustomEvent("doors:open-stop", { detail: { id: ctx.stop1, day: 0 } })),
    });
    await pause(500);
    const opened = () => sv();
    // the door card (Jard 10-23 #9): why = About this door and the Why this door row under it, scrolled into view (intuit
    // pass 1b #3: the card named them while only the hours and At the door were on screen); talk = At the door's opener
    await step("why", { target: () => {
      const about = opened()?.querySelector(".dabout");
      const top = [about?.querySelector("h4") ? about : null, opened()?.querySelector('[data-s="why-door"]')].filter(Boolean);
      return top.length ? top : opened()?.querySelector(".sbody");
    } });
    // reshoot4: the door card scrolls so At the door's heading sits at the top of its scroll box (not a line cut in half
    // under the door's header); on a phone the opener does, and the card stays clear of the door's sheet (its name shows)
    const toAtDoor = (t) => {
      const box = opened()?.querySelector(".sscroll");
      const head = (matchMedia("(max-width: 700px)").matches ? t : opened()?.querySelector(".atdoor")) ?? t; // a phone: the opener itself, so the card fits under it
      if (!box || !head) return t.scrollIntoView({ block: "center" });
      box.scrollBy({ top: head.getBoundingClientRect().top - box.getBoundingClientRect().top - 6, behavior: still ? "auto" : "smooth" });
    };
    await step("talk", { target: () => opened()?.querySelector(".atdoor .dl p.big")?.closest(".dl") ?? opened()?.querySelector(".atdoor"), reveal: toAtDoor, keep: () => opened() });

    if (await ask("shorter", "Make the opener for Nomadic Beerworks shorter")) {
      await pause(1200); // the did-line and its Undo
      closeAgent();
      await flash(opened()?.querySelector(".atdoor .dl p.big"), 900);
    }

    // Mark visited → the outcome sheet, for whichever stop is open (the visitor may have opened another)
    const shown = opened()?.querySelector("h2")?.textContent;
    const pl = S.getPlan();
    const id = Object.keys(pl?.venues ?? {}).find((k) => pl.venues[k]?.name === shown) ?? ctx.stop1;
    story.top = id;
    await step("visit", {
      target: () => opened()?.querySelector('[data-s="visit"]'),
      done: () => $(".osheet", stage) || S.getPlan()?.outcomes?.[id],
      auto: () => opened()?.querySelector('[data-s="visit"]')?.click(),
    });
    // the story (card "visit"): on Tuesday she goes to her #1 first, before the rest of the day, so the re-plan opens
    // Tuesday with this visit; it's logged at the day's start, so the return visit says "you talked on Tue …"
    const visitDay = pl?.days?.find((d) => d.stops.some((s) => s.id === id));
    const visitWin = profile?.windows?.find((w) => w.date === visitDay?.date);
    if (visitDay?.date) setOutcomeClock(() => new Date(`${visitDay.date}T${visitWin?.from ?? "13:00"}:00`));
    // the details filled in for her: Interested, come back Thursday
    const sheet = $(".osheet", stage);
    if (sheet) {
      const more = $("#o-more", sheet);
      if (more?.hidden) $('[data-o="more"]', sheet)?.click();
      $('[data-r="interested"]', sheet)?.click();
      const on = $("#o-fuon", sheet);
      if (on && !on.checked) on.click();
      const date = $("#o-date", sheet);
      if (date && ctx.thu) {
        date.value = ctx.thu;
        date.dispatchEvent(new Event("change", { bubbles: true }));
      }
      // who and what she heard: the return visit (card "back") is built from these
      const who = $("#o-whoin", sheet);
      if (who) who.value = DEMO_VISIT.who;
      const note = $("#o-note", sheet);
      if (note) note.value = DEMO_VISIT.note;
      // intuit pass 1b #3: on a phone Save sat below the fold under the card; the card stays at the top and the sheet
      // scrolls to its end, so Save and the filled-in details above it show under the card
      const narrow = matchMedia("(max-width: 700px)").matches;
      const toSave = (el) => {
        let s = el.parentElement;
        while (s && !(/(auto|scroll)/.test(getComputedStyle(s).overflowY) && s.scrollHeight > s.clientHeight + 1)) s = s.parentElement;
        const r = el.getBoundingClientRect();
        (s ?? document.scrollingElement).scrollBy({ top: r.bottom - (innerHeight - 16), behavior: still ? "auto" : "smooth" });
      };
      await step("outcome", {
        target: () => (narrow && $('.osheet [data-o="save"]', stage)) || $(".osheet", stage),
        done: () => !$(".osheet", stage),
        auto: () => $('.osheet [data-o="save"]', stage)?.click(),
        dock: "top",
        reveal: narrow ? toSave : undefined,
      });
    }

    // what the re-plan cost, in the app's own words
    const saved = S.getPlan()?.outcomes?.[id];
    if (saved?.followUp) {
      await until(() => $(".stoast:not([hidden]) span", stage)?.textContent?.trim(), 2000);
      sv()?.querySelector('[data-s="close"]')?.click();
      if (S.getSelectedDay() !== "week") S.selectDay("week");
      await pause(500);
      activePlayer()?.draw?.({ fitView: true });
      const last = (S.getPlan()?.days?.length ?? 1) - 1;
      // the card says what the plan's toast says, in a sentence: the toast goes, so the card never sits on it
      const pt = $("#p-toast", stage);
      if (pt) pt.hidden = true;
      story.was = followUpNow(S.getPlan(), id, saved.followUp); // the End card says where it moved from
      const off = offVisitDay(pl, S.getPlan(), visitDay?.date, id); // the doors the visit pushed off Tuesday, named
      await step("replan", { target: () => row(id, last) ?? row(id), toast: [off, replanSentence(S.getPlan(), id, saved.followUp)].filter(Boolean).join(" ") });
      await backStep(id, last);
    }
    check();
    await driveSteps();
    await swapStep();
    handOff();
  }

  // ---------- "Thursday, she's back": the same door's card before and after the visit ----------
  // before = the Thursday stop with visit memory off (stopModel slotsOff S4: what the card said before she logged it);
  // after = the Thursday stop as the app shows it. Changed lines are highlighted, each with what in her log changed it.
  async function backStep(id, dayIndex) {
    const plan = S.getPlan();
    if (!plan?.days?.[dayIndex]?.stops?.some((s) => s.id === id)) return; // no return visit on the plan: no card
    let d = null;
    let same = null; // what doesn't change, shown plain under the highlighted rows so the highlight means something
    try {
      const data = await loadStopData(plan);
      const after = stopModel({ plan, id, dayIndex, ...data });
      const before = stopModel({ plan, id, dayIndex, ...data, slotsOff: ["S4"] });
      if (after.talk.visit === "return") d = returnDiff(before, after);
      if (after.hoursToday && after.hoursToday !== "hours unverified") same = `open ${after.hoursToday} ${cap(plan.days[dayIndex]?.day ?? "")}`.trim(); // judge pass 8 #2: no rank number in the tour
    } catch (e) { console.warn("demo: return card", e); }
    check();
    if (!d) return;
    const day = (i) => (plan.days[i]?.date ? new Date(`${plan.days[i].date}T12:00`).toLocaleDateString("en-US", { weekday: "long" }) : "");
    const el = document.createElement("div");
    el.className = "dback";
    el.innerHTML = `<div class="dbh" aria-hidden="true"><span></span><span>Before the visit</span><span>${esc(day(dayIndex) || "Thursday")}, back</span></div>
      ${d.rows.map((r) => `<div class="dbr${r.changed ? " ch" : ""}" data-row="${esc(r.key)}">
        <b>${esc(r.label)}</b>
        <p class="was"${r.before ? ` title="${esc(r.before)}"` : ""}><span class="sr">Before: </span><span class="t">${r.before ? esc(r.before) : "<i>nothing yet</i>"}</span></p>
        <p class="now"><span class="sr">Now: </span>${esc(r.after ?? "")}${r.from ? ` <span class="srcchip" data-k="you">from ${esc(r.from)}</span>` : ""}</p>
      </div>`).join("")}
      ${same ? `<div class="dbr same" data-row="same"><b>Hours</b><p class="was"><span class="sr">Before: </span>${esc(same)}</p><p class="now"><span class="sr">Now: </span>${esc(same)} <span class="dbsame">same: Qloo's data</span></p></div>` : ""}
      <p class="dbn">Her note: ${d.noteWords.before} words before, ${d.noteWords.after} after. Hours and Qloo's facts don't change: only what she told Doors does.</p>`;
    await step("back", { target: () => row(id, dayIndex) ?? row(id), extra: el, wide: "xl" });
  }

  // ---------- owner review 9: drive mode (ui/drive.js), the real overlay on the demo's plan ----------
  // Done → her words typed into the sheet's text box → Log it: /api/agent/log-visit reads them, live, as in the app
  // (drive's own fallback, the rules parser in lib/visit-parse.js, when it can't). The sheet's microphone listens while
  // the demo types, as in the app; Log it ends the listening. The demo's Tuesday is a day ahead, so drive shows it as
  // "a preview: not today".
  async function driveSteps() {
    if (!$("#t-drive", stage)) return; // no drive mode in this build: on to the next card
    const dv = () => document.querySelector("#drive");
    await step("drive", { target: () => $("#t-drive", stage), done: () => dv()?.querySelector("[data-drive-door]"), auto: () => $("#t-drive", stage)?.click() });
    await pause(700);
    const first = dv()?.querySelector("[data-drive-door]")?.dataset.id;
    const door = S.getPlan()?.venues?.[first]?.name ?? ""; // intuit pass 1b #2: cards 20-21 name the door she's at
    await step("done", { door, target: () => dv()?.querySelector("[data-drive-done]"), done: () => dv()?.querySelector("#drive-text"), auto: () => dv()?.querySelector("[data-drive-done]")?.click() });
    // a date, not a weekday: "Thursday" would mean this week's Thursday to a visitor on a Tuesday or Wednesday
    const later = profile?.windows?.at(-1)?.date ?? ctx?.thu;
    const when = later ? new Date(`${later}T12:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "Thursday";
    await pause(400);
    await typeInto(dv()?.querySelector("#drive-text"), `done, liked it, come back ${when} at 3, hesitant about price`);
    await pause(300);
    dv()?.querySelector("[data-drive-log]")?.click();
    await until(() => dv()?.querySelector("[data-drive-save]"), 30000); // a live read
    await step("save", {
      door,
      // judge 10 #1 / tour fit: on a phone the card docked over the read-back (390) or over Save (320); it points at both,
      // so it takes the free side, shrunk to it if it must, and the read-back and Save & next door both show
      target: () => {
        const both = [dv()?.querySelector("[data-drive-readback]"), dv()?.querySelector("[data-drive-save]")].filter(Boolean);
        return matchMedia("(max-width: 700px)").matches && both.length ? both : both[0] ?? null;
      },
      done: () => !dv()?.querySelector("[data-drive-sheet]") && dv()?.querySelector("[data-drive-door]")?.dataset.id !== first,
      auto: () => dv()?.querySelector("[data-drive-save]")?.click(),
    });
    await pause(2200); // the next door and the toast, before the overlay goes
    dv()?.querySelector("[data-drive-close]")?.click();
    await pause(400);
  }

  // ---------- owner review 9: the same brand in two cities (precomputed files only: no call) ----------
  async function swapStep() {
    let sides = null;
    try {
      sides = await Promise.all(SWAP_CITIES.map(async (key) => {
        const [route, city] = await Promise.all([getJSON(`/data/routes/${SWAP_DRINKER}-${key}.json`), getJSON(`/data/cities/${key}.json`)]);
        const cityName = index?.cities?.find((c) => c.key === key)?.name ?? cap(key);
        return swapSide({ route, city, cityKey: key, cityName, profile: profile ?? demoProfile() });
      }));
    } catch (e) { console.warn("demo: swap data", e); }
    check();
    if (!sides?.every(Boolean)) return; // no data, no card: the tour goes on to the hand-off
    const el = document.createElement("div");
    el.className = "dswap";
    // judge pass 9 #3: each side leads with Qloo's rank against popularity alone and the doors like it; the two openers
    // side by side read as one template, so the card shows Qloo's crowd words and no opener
    el.innerHTML = sides.map((x) => `<div data-city="${esc(x.city)}">
      <h4>${esc(x.city)}: ${esc(x.name)}</h4>
      <p class="rk1"><b>#${x.rank} of ${x.of}</b> on Qloo's list for ${esc(x.drinker)} drinkers</p>
      ${x.popRank ? `<p class="rk2"><b>#${x.popRank}</b> by popularity alone</p>` : ""}
      ${x.alike ? `<p class="rk2">${x.alike} sister doors</p>` : ""}
      <q>${esc(x.crowdShort ?? "Qloo doesn't describe this crowd.")}</q>
    </div>`).join("") + `<p class="src">${esc(sides[0].crowdBy)}</p>`; // intuit pass 1b #9: one source line, the date as the app writes it
    await step("swap", { extra: el, wide: true, toast: swapLine(sides) });
  }

  // ---------- the hand-off ----------
  function handOff() {
    coach.hide();
    const plan = S.getPlan();
    const rt = $("#p-toast", stage);
    if (rt) rt.hidden = true;
    // Tuesday's first stop not yet visited, by day and name (intuit pass 1b #2: "Open stop 3" read as Thursday's)
    const tue = plan?.days?.[0]?.stops ?? [];
    const k = tue.findIndex((s) => plan.statuses?.[s.id] !== "visited");
    const n = k >= 0 ? k + 1 : null;
    // r2 (Jard 10-24: "let's invite our users (the judges) to explore"): places to go next, each spotlighting its part
    // of the page on hover or focus (coach.js explore), then Start my profile and Close
    const press = (sel) => () => { coach.hide(); $(sel, stage)?.click(); };
    const explore = [
      { label: "Talk to the Doors Agent", sub: "Ask about a door, your day or your pitch.", spot: () => $('[data-agent="open"]', stage), on: press('[data-agent="open"]') },
      { label: BASIS_BUTTON, sub: "How Qloo's data picked these doors.", spot: () => $('[data-drawer="why"]', stage), on: press('[data-drawer="why"]') },
    ];
    if (n) explore.push({ label: `Open ${plan.venues?.[tue[n - 1].id]?.name ?? `stop ${n}`} (Tuesday)`, sub: "Who drinks there, what to say, log the visit.", spot: () => anyRow(tue[n - 1].id), on: () => {
      coach.hide();
      S.selectDay(0);
      window.dispatchEvent(new CustomEvent("doors:open-stop", { detail: { id: tue[n - 1].id, day: 0 } }));
    } });
    explore.push({ label: "Explore Maya's Austin plan", sub: "Three afternoons, door by door. Move, mark or add one.", spot: () => $(".rcol", stage), on: () => coach.hide() });
    // her profile as F3's sample brand ("Sample brand. Tidewell and Maya are made up…"): change one field and build
    const buttons = [];
    buttons.push({ label: "Start my profile", kind: "primary", on: () => onHandOff?.(emptyProfile()) }); // owner review 5: a blank form ("Fill with Maya's example" is on it)
    buttons.push({ label: "Close", kind: "link", on: () => coach.hide() });
    step("handoff", { buttons, explore, place: "bottom", toast: story.top ? afterDriveText(plan, story.top, story.was) : "" }).catch(() => {});
    // intuit 1b (smaller): on a phone the End card stayed up over ~half the screen and followed the visitor into a door;
    // once they open a door it steps aside (the tour is over; the banner keeps Restart)
    const endAside = () => { window.removeEventListener("doors:open-stop", endAside); if (matchMedia("(max-width: 700px)").matches) coach.hide(); };
    window.addEventListener("doors:open-stop", endAside);
    // Jard 10-29: drive mode is the app's own, hands-free bar and all; the End card never sits over it (any width)
    const driveAside = (e) => { if (e.target.closest?.("#t-drive")) { document.removeEventListener("click", driveAside, true); coach.hide(); } };
    document.addEventListener("click", driveAside, true);
    cleanups.push(() => document.removeEventListener("click", driveAside, true));
    $('[data-d="close"]', banner).hidden = true;
    $('[data-d="skip"]', banner).hidden = true;
    say("");
    log.done = Date.now();
    if (profile) save({ phase: "plan", profile, done: true });
  }

  // ---------- off the script: never an error banner, just the app ----------
  function offScript(e) {
    if (e === STOP || ctl.dead) return;
    console.warn("demo: off script:", e);
    log.errors.push(String(e?.message ?? e));
    coach.show({
      title: "You left the tour",
      body: ["Everything on this page still works. Keep going, or restart the tour."],
      buttons: [{ label: "Restart the tour", kind: "line", on: restart }, { label: "Keep exploring", kind: "primary", on: () => closeTour() }],
      dim: false, place: "bottom",
    });
    $('[data-d="close"]', banner).hidden = true;
    say("");
  }

  // ---------- run ----------
  (async () => {
    try {
      if (instant) {
        await buildPlan({ endState: true });
        S.selectDay("week");
        handOff();
        return;
      }
      if (resume?.at === "plan") {
        // the plan as they left it, the tour closed: "Restart demo" is the way back to card 1
        ctl.off = true;
        $('[data-d="close"]', banner).hidden = true;
        $('[data-d="skip"]', banner).hidden = true;
        say("");
        await buildPlan({ restore: resume.profile });
        S.selectDay("week");
        log.done = log.restored = Date.now();
        // a reload mid-tour: say where they are, and the two ways on (the cards don't pick up mid-plan)
        if (!resume.done) coach.show({
          title: "Your demo plan, as you left it",
          body: ["The page reloaded, so the tour stopped here. Everything you did is kept."],
          buttons: [{ label: "Restart the tour", kind: "line", on: restart }, { label: "Keep exploring", kind: "primary", on: () => coach.hide() }],
          dim: false, place: "bottom",
        });
        return;
      }
      try {
        await profileTour(resume?.at === "form" ? resume.step : null);
      } catch (e) {
        if (e !== BUILT_EARLY) throw e; // pressed Build before the tour got there: on to the plan
      }
      await planTour();
    } catch (e) {
      offScript(e);
    }
  })();

  return () => {
    ctl.dead = true;
    coach.destroy();
    prewarm?.();
    window.removeEventListener("doors:building", onBuilt);
    window.fetch = realFetch;
    setRoadsOffline(false);
    setOutcomeClock(null);
    document.documentElement.classList.remove("in-demo");
    bannerRO?.disconnect();
    window.removeEventListener("scroll", bannerH);
    document.documentElement.style.removeProperty("--dbanner-h");
    for (const fn of cleanups.reverse()) { try { fn?.(); } catch {} }
    cleanups = [];
  };
}
