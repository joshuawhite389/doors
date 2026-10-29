// The plan view, #/plan (SPEC-V2 §3.4; mockup frames 4, 6, 14): day tabs, the selected day's stops with a status
// menu, the week view, the carry-over notice, Add a door, the toolbar (Start my day, the Why button, Agent, and the
// Menu: Home, Export, Settings, Privacy; docked in the app's header on a wide screen, Jard 10-23 #8) and Watch the
// route on the map's run bar. A status
// change that re-plans says what moved, with Undo (F3).
// G4: drag a stop by its grip (pointer events: mouse and touch) within its day, onto another day's tab or into the Week
// view's days; it locks there (🔒, tap to release) and the day's other stops re-route around it. Keyboard: the grip's
// arrow keys and the ⋯ menu (move up/down, to another day, lock, unlock). Locks are saved with the plan (st.locks).
// Plans with schedule.js (A2) on road times when /api/matrix has them (travel.js).
// The current plan and selected day are published through ./state.js for B2 (animation) and C1 (stop panel).
import { askBrief } from "../lib/brief-client.js";
import { EXCLUDED_STATUSES } from "../lib/schedule.js";
import { DEMO_DEEP_OFF, heatFor, deepOn, HEAT_TOP } from "../lib/culture.js"; // R9 deep
import { buildPool, windowsFor, freshPrevious, uncappedPrevious, savedPlan, openTill, clockShort, mergeLists, bestAddDay, addedText, notAddedText, dayHolding, streetOf, labelDrinker } from "../lib/pool.js";
import { leadHold, crowdKey } from "../lib/crowds.js"; // why2: Start with <crowd>
import { planOnRoads, travelSource } from "../lib/travel.js";
import { planCSV } from "../lib/export.js";
import { clock12, toMinutes, isoDate, pinLabel, roomsPhrase, niceDate, validateProfile } from "../lib/profile.js";
import { genreLabel, parseHours } from "../lib/core.js";
import { shutOn } from "../lib/fu-check.js"; // judge pass 6 (#7): a move never lands on a day the room is shut
import { tourNow } from "../lib/demo-plan.js";
import { profileWith, fieldOf, undoOf, sameAs, famousOf, fieldChanges, changeText, planDiff, diffText } from "../lib/whatif.js"; // r2viz: Why these doors what-if
import { leaveText, replanSummary, offDayText, withoutOffCount, overlapLines, miText, rankLabel, doorReason, orderReason, justOpenedTag, progressLine, restReason, underwayNote, unscheduledIds, listRows, weekCount, carryText, flatList, FLAT_NOTE, ownExtra, dayLabel } from "../lib/planview.js";
import { isMerged, pitchOf } from "../lib/stopmodel.js";
import { $, $$, esc, cap, debounce } from "./dom.js";
import { loadRoutes, getJSON, geocode, searchPlaces, fetchMatrix, runLiveProfile } from "./data.js";
import { cityOf, isLiveProfile, liveDrinkers, profileForRun, liveError, gapsNote, unreachable, UNREACHABLE, routeFiles } from "../lib/live.js";
import { settingsSummary, profileChanges, brandDiffers } from "../lib/settings.js"; // round 4 #6: every setup field in Settings; a saved form's change previewed, applied, undone
import { createMap, addStart, clearMarkers, addRankPins, declutterRanks, showPopup, DAY_COLOURS } from "./map.js";
import { createRoutePlayer, runBuilding, isInstant, hasRoadShape } from "./animate.js"; // B2: road lines, pins, Run the route, building phase
import * as S from "./state.js";
import { mountStop } from "./stop.js"; // C1: the stop panel / phone sheet
import { mountAgent } from "./agent.js"; // R9 chat agent: Ask Doors
import { drawExport, download } from "./export.js"; // C1: notes + call sheet
import { setNavApp, currentNavName, navAppButtons } from "./navapp.js"; // PARITY S14: the navigation app
import { outcomeTags, isReturnVisit } from "../lib/outcome.js";
import { editHref, DEMO_EDIT, BRAND_HREF, CITIES_HREF } from "../lib/plans.js"; // G7; group 3 #5: Settings → Edit my brand, My cities
import { drawWhy as drawWhyPanel, setWhyDoor, setWhyArea } from "./why.js"; // G6: the Why these rooms dashboard
import { openDrive } from "./drive.js"; // R9 drive mode
import { skipToEnd, moveIntoDay, offEveryDay, noRoomText } from "../lib/drive-day.js"; // drive mode's Skip for now; a move onto the day under way
import { dropFromDay, patchRecord, withRemoved, startButton, nextPlanDay, rollPlan, capsWithRolled, movedIds, laterDays, lateMoveInput, lateMoveFits, unhold } from "../lib/day-debrief.js"; // the day flow: pause, remove, end
import { withChange, undoChange, parkIds, unparkIds, withoutParked, markParked } from "../lib/day-stop.js"; // Stop for today, running late's re-homes, their Undo
import { dropRecord } from "../lib/slots.js"; // R9 red team: one record's Undo
import { noteOp } from "../lib/door-notes.js"; // door notes
import { drawLogbook } from "./logbook.js"; // round 4 item 10: the Log book
import { withLater, LOGBOOK_LABEL } from "../lib/logbook.js";
import { BASIS_BUTTON } from "../lib/basis.js"; // round 6 #5: the top-bar labels are one constant each
import { hasWebsite, webSearchHref } from "../lib/note.js"; // Jard 10-23: Search the web ↗ when Qloo has no website
import { icon } from "../lib/icons.js"; // the Doors icon set (Jard 10-24 #1)
const CHEVRON = '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3l5 5-5 5"/></svg>'; // the day tabs\' scroll arrows (the left one is mirrored in CSS)
import { stripModel } from "../lib/whyviz/strip.js"; // WHY-VIZ-SPEC §6: Your list's strip per row
import { stripSVG } from "./whyviz/strip.js";
import { paintWeekClouds, clearWeekClouds } from "./weekclouds.js"; // WHY-VIZ-SPEC §6: the clouds under the week's loops
import { CLASSES, NO_CLASS } from "../lib/whyviz/areas.js"; // round 5 #2b: the Neighbourhoods toggle's legend
import { untilFor, setDateHours, weeksLine, weeksOf, weekLabel, mondayOf, weekAreas, areaName } from "../lib/week.js"; // the usual week: the rolling horizon, a date's own hours, the weeks line

const STATUS = { visited: "Visited", talked: "Already know them", notfit: "Not a fit" };
const OTHERS_KEY = "doors:map-other-days"; // round 8: the map's Other days pill, "on" | "off" (outside doors.v2.: never read as a plan)
const statusLabel = (s) => STATUS[s] ?? (s === "removed" ? "Removed" : s); // "removed": Remove from my plan (no menu entry)
const colour = (i) => DAY_COLOURS[i % DAY_COLOURS.length];
const parsedCache = new Map();
const matrixCache = new Map(); // road matrices by point set, for this tab (a status change does not ask twice)

// "2–6 pm", "11 am–3 pm"
export function rangeText(from, to) {
  const a = clockShort(from);
  const b = clockShort(to);
  const [an, ap] = a.split(" ");
  const [bn, bp] = b.split(" ");
  return ap && ap === bp ? `${an}–${bn} ${bp}` : `${a}–${b}`;
}
const dayShort = (d) => cap(d.day).slice(0, 3);
const doors = (n) => `${n} door${n === 1 ? "" : "s"}`;
const SEARCH_OFF = "Address search is off right now: drop a pin instead.";
const legText = (s) => (s.legMi == null ? "" : `↓ ${s.legMi.toFixed(1)} ${s.source === "ors" ? "road mi" : "mi · est."}`);

// The day the rep is working stays as it is (§6.6): its stops minus the ones marked talked / not a fit. That day is
// today when today is one of the windows, else the day of the latest stop marked Visited (st.current).
// ---- routing flag (docs/ROUTING-V3.md V4.1): ?routing=v4 plans with V4's linear rank weight, ?rankv=N sets RANK_V
// (in the address's query or the hash's); the default is V4.1 at RANK_V 45 ----
export function routingFlag(loc = globalThis.location) {
  try {
    const q = new URLSearchParams(loc?.search ?? "");
    const h = new URLSearchParams((loc?.hash ?? "").split("?")[1] ?? "");
    const get = (k) => q.get(k) ?? h.get(k);
    const out = {};
    if (get("routing") === "v4") out.routing = "v4";
    // ?fill=area: the plan's worth vs driving alone decides each door's day, as before fill by rank (lib/schedule.js)
    if (["area", "week"].includes(get("fill"))) out.fill = get("fill");
    const n = Number(get("rankv"));
    if (get("rankv") != null && Number.isFinite(n) && n >= 0 && n <= 200) out.v5 = { rankV: n };
    return out;
  } catch {
    return {};
  }
}
// ---- end routing flag ----

function frozenFor(st, windows, statuses, now) {
  const cur = st.current?.date >= now.date ? st.current : windows.some((w) => w.date === now.date) ? { date: now.date } : null;
  if (!cur) return null;
  if (!windows.some((w) => w.date === cur.date)) return null;
  const prev = st.plan?.days?.find((d) => d?.date === cur.date);
  if (!prev) return null;
  const ids = prev.stops.map((s) => s.id).filter((id) => statuses[id] !== "talked" && statuses[id] !== "notfit");
  return { date: cur.date, from: prev.from, ids };
}

const nowStamp = () => {
  const d = new Date();
  return { date: isoDate(d), min: d.getHours() * 60 + d.getMinutes() };
};

// L1: the agent's steps as the rep reads them, in order (src/worker.js runRoute's step ids). Only the plain details
// show under them (which brand Qloo matched, how many rooms); the agent's own wording stays in its stream.
const PLAIN = { resolve: (d) => (/^resolved /.test(d) ? `Qloo's match: ${d.replace(/^resolved "[^"]*" to /, "").replace(/; other candidates.*$/, "")}` : ""), pages: (d) => (/: [1-9]\d* rooms$/.test(d) ? d.replace(/^page \d+: /, "") + " ranked" : null), filter: (d) => d.replace(/ \(dropped.*$/, "").replace(/ → /, " → ") + " kept", hours: (d) => d.replace(/ by their own listed hours$/, "") };
const LIVE_STEPS = [
  ["resolve", (d) => `Finding ${d} in Qloo`],
  ["pages", (d, city) => `Ranking ${city}'s bars and restaurants for ${d} drinkers`],
  ["filter", () => "Keeping the bars and restaurants"], // judge R9: "rooms that pour" read as "rooms that pour you"
  ["hours", () => "Reading each door's opening hours"],
  ["sisters", () => "Finding sister doors: doors with the same crowd"],
  ["guard", () => "Checking each door's sound"],
  ["pitch", () => "Drafting what to say at the door"],
];
// A live plan asks Qloo first (the Worker's /api/route agent, once per drinker; a saved run opens at once), showing its
// steps. → true when the files are in place; false after saying what went wrong and what to try.
async function runLiveView(root, { profile, index, editTo, onUse, alive = () => true }) {
  const c = cityOf(profile, index);
  const names = liveDrinkers(profile, index).filter((d) => d.live).map((d) => d.name);
  const box = document.createElement("div");
  box.className = "liverun";
  box.setAttribute("role", "status");
  box.setAttribute("aria-live", "polite");
  box.innerHTML = `<h2>Doors is asking Qloo…</h2>
    <p class="muted">Which bars and restaurants in ${esc(c.name)} have regulars who drink what your drinkers drink. About a minute the first time; this plan opens instantly after that.</p>
    ${names.map((d, i) => `<section data-d="${i}"><h3>${esc(d)}</h3><ol>${LIVE_STEPS.map(([id, t]) => `<li data-step="${id}"><b>${esc(t(d, c.name))}</b><span class="muted small"></span></li>`).join("")}</ol></section>`).join("")}`;
  root.replaceChildren(box);
  const sec = (d) => box.querySelector(`[data-d="${Math.max(0, names.indexOf(d))}"]`);
  const mark = (el, id, detail) => {
    if (!el) return;
    const lis = [...el.querySelectorAll("li")];
    const at = id === "cache" ? lis.length - 1 : lis.findIndex((li) => li.dataset.step === id);
    if (at < 0) return;
    lis.forEach((li, i) => {
      li.classList.toggle("done", i <= at);
      li.classList.toggle("now", i === at + 1);
    });
    const plain = id === "cache" ? detail : PLAIN[id]?.(String(detail ?? ""));
    if (plain) lis[id === "cache" ? 0 : at].querySelector("span").textContent = plain;
  };
  names.forEach((d) => sec(d)?.querySelector("li")?.classList.add("now"));
  try {
    await runLiveProfile(profile, index, (e) => box.isConnected && mark(sec(e.drinker), e.id === "plan" ? "resolve" : e.id, e.id === "plan" ? null : e.detail));
    return true;
  } catch (e) {
    if (!box.isConnected || !alive()) return false;
    if (e.fallback) return void restingView(root, { message: e.message, runs: e.runs ?? [], profile, index, onUse }), false;
    if (e.offline) return void unreachableView(root, e, editTo), false;
    // live check H: a typo city's hint names the city it likely means. The city list (~84 kB) loads only here, not on
    // every app load (polish2: first-load speed)
    const typo = /doesn't know a city called/.test(e.message);
    const near = typo ? (await import("../lib/citylist.js").catch(() => null))?.nearestCity : null;
    if (!box.isConnected || !alive()) return false;
    const hint = typo ? liveError(e.message, (t) => near?.(t)?.label).hint : e.hint;
    // live check H: the city is the problem, so building again can't help: only Edit profile
    // fix14: or this server runs on Boise's sample data (no Qloo key): not Qloo's answer, and not worth a retry
    const sample = /runs on sample data/.test(e.message);
    const cityError = sample || /doesn't know a city called|^Qloo read "/.test(e.message);
    root.innerHTML = `<div class="stub"><div><h2>${sample ? "This server can't build this city" : "Qloo couldn't build this plan"}</h2><p>${esc(e.message)}</p>${hint ? `<p>${esc(hint)}</p>` : ""}
      <a class="btn primary" href="${editTo}">${editWord(editTo)}</a>${cityError ? "" : ` <button type="button" class="btn line" data-retry>Try again</button>`}</div></div>`;
    root.querySelector("[data-retry]")?.addEventListener("click", () => window.dispatchEvent(new HashChangeEvent("hashchange")));
    return false;
  }
}

// group 3 #5: a plan's edit link opens its city's days and start (the demo's: Maya's profile in the form)
const editWord = (href) => (String(href).startsWith("#/city") ? "Edit this city" : "Edit profile");

// Fix 8: Doors didn't answer (offline, the Worker down, a timeout, a 5xx): said as that, with Try again first, never as
// "No rooms for that profile". Try again re-opens the plan (the failed fetch isn't cached: ui/data.js getJSON)
function unreachableView(root, e, editTo) {
  root.innerHTML = `<div class="stub" data-unreachable><div><h2>${esc(e.title ?? UNREACHABLE.title)}</h2><p>${esc(e.message)}</p>${e.hint ? `<p>${esc(e.hint)}</p>` : ""}
    <button type="button" class="btn primary" data-retry>Try again</button> <a class="btn line" href="${editTo}">${editWord(editTo)}</a></div></div>`;
  root.querySelector("[data-retry]")?.addEventListener("click", () => window.dispatchEvent(new HashChangeEvent("hashchange")));
}

// New live runs resting (the budget's end) or a visitor's daily runs used: no error, the message as the Worker says it,
// the examples (on the form) and the runs already made, which open free: a click puts that brand and city in the form.
function restingView(root, { message, runs, profile, index, onUse }) {
  root.innerHTML = `<div class="stub"><div><h2>New plans are off for today</h2><p>${esc(message)}</p>
    <p><a class="btn primary" href="#/new">See the examples</a></p>
    ${runs.length ? `<p class="muted small">Plans already built (they open without new Qloo calls)</p><div class="chips" style="justify-content:center;gap:8px">${runs.map((r, i) => `<button type="button" class="chip" data-run="${i}">${esc(r.name)} · ${esc(r.cityName ?? r.city)}</button>`).join("")}</div>` : ""}</div></div>`;
  root.querySelector(".chips")?.addEventListener("click", (e) => {
    const b = e.target.closest("[data-run]");
    if (b) onUse?.(profileForRun(profile, runs[+b.dataset.run], index));
  });
}

// Returns a cleanup function. onProfile(profile) when the plan view changes the profile (Undo on a known door).
// demo (C2, ui/demo.js): {fetchMatrix, cache, travelNote} plans on the demo's baked road matrix instead of /api/matrix,
// keeps its matrices out of this tab's cache, and names their source in the footer.
// pending (round 4 #6): {profile, text} a Settings form just saved: shown as a change to try (what it does to the plan),
// applied with Apply (Changes you made, Undo) or dropped. onBrand(brandPart): the brand's fields changed on this plan
// (Apply or its Undo): the app writes them into the other cities.
export async function renderPlan(root, { index, profile, store, onProfile = () => {}, onUse = null, alive = () => true, demo = null, drive = false, nav = null, carry = null, params = {}, plans = null, pending = null, onBrand = null }) {
  let c = cityOf(profile, index); // L1: a live city until its run names it (Qloo's locality, its centre)
  const brand = profile.brand.trim() || "my brand";
  const editTo = demo ? DEMO_EDIT : editHref(brand, c.key); // G7: Edit profile opens this plan's profile
  let dead = false;
  if (!demo && isLiveProfile(profile, index)) {
    if (!(await runLiveView(root, { profile, index, editTo, onUse, alive }))) return () => {};
    if (!alive()) return () => {}; // the rep moved on: the run is kept, the page is not touched
    c = cityOf(profile, index);
    // the city as Qloo knows it now has a centre: a start (or a day's own start) far from it is a mistake, not a plan
    const far = validateProfile(profile, { cities: index.cities }).errors;
    if (far.start || far.windows) {
      root.innerHTML = `<div class="stub"><div><h2>Your start is far from ${esc(c.name)}</h2><p>${esc(far.start ?? far.windows)}</p><a class="btn primary" href="${editTo}">${editWord(editTo)}</a></div></div>`;
      return () => {};
    }
  }
  root.innerHTML = `<div class="empty" role="status">Ranking ${esc(c.name)}'s bars and restaurants…</div>`;
  let routes;
  try {
    routes = await loadRoutes(profile, index);
  } catch (e) {
    if (dead || !alive()) return () => {};
    unreachableView(root, unreachable(e), editTo); // fix 8: a list that didn't load is not an empty pool
    return () => {};
  }
  // R9 deep heat: Qloo's map of where the drinker brand's fans are in this city (top hoods first), or null
  const heatJson = await getJSON("/data/culture/heat.json").catch(() => null);
  let hoods = heatFor(heatJson, routes, c.key);
  const heatOn = () => Boolean(hoods) && deepOn("heat", demo ? DEMO_DEEP_OFF : null);
  if (dead || !alive()) return () => {};
  if (!routes.length) {
    root.innerHTML = `<div class="stub"><div><h2>No doors for that profile</h2><p>Doors has no list of doors for these brands in ${esc(c.name)}. Edit your brand and pick the brands again.</p><a class="btn primary" href="${demo ? editTo : BRAND_HREF}">Edit my brand</a></div></div>`;
    return () => {};
  }
  const captured = routes[0].captured ?? index.captured;

  let st = store.update(brand, c.key, (s) => ({ ...s, profile }));
  let plan = null; // the published plan (state.js shape)
  let sel = 0; // day index, "week" or "rest"
  let view = "list"; // "list" | "add"
  let focusId = null;
  let rerouted = new Set(); // G4: stops the last lock or move re-routed (until the next re-plan)

  // ---------- planning ----------
  // base: the saved state to plan from instead of st (a dry run: lateFits), nothing saved. hold: day-locks for this
  // one run only (running late's move, lateMoveInput), not shown as locks (unhold)
  // prof (r2viz): the profile to plan with instead of the saved one (Why these doors' what-if preview: a scratch copy)
  // rts (round 4 #6): the drinker lists to plan with instead of this plan's (a Settings change to the brands: preview)
  async function compute({ added = st.added ?? [], fresh = false, locks = st.locks ?? [], base = null, hold = [], prof = profile, rts = routes } = {}) {
    const profile = prof;
    const s = base ? { ...st, ...base } : st;
    const pool = buildPool({ routes: rts, profile, statuses: s.statuses, contacts: s.contacts ?? [], added, outcomes: s.outcomes, famous: !!s.famous, cityName: c.name, deepOff: demo ? DEMO_DEEP_OFF : null, heat: hoods });
    // the usual week's days this week and next, and on to the latest follow-up or moved door (lib/week.js)
    const windows = windowsFor(profile, { until: untilFor(pool.pinned, [...locks, ...hold]) });
    const now = demo ? tourNow(st, windows, nowStamp()) : nowStamp(); // the tour plans on its own clock (F9)
    // a doors-a-day change: the days ahead plan as if new, or, back to no limit, around the last plan with no limit
    const uncapped = windows.every((w) => !w.max);
    const previous = !fresh ? s.plan : uncapped ? uncappedPrevious(s.plan, s.uncappedPlan, now) : freshPrevious(s.plan, now);
    // the planner's caps: a day End my day rolled doors onto holds them on top of its cap (lib/day-debrief.js)
    const frozen = frozenFor(s, windows, pool.statuses, now);
    // why2 "Start with bars": the first open day holds the picked crowd's doors (lib/crowds.js), for this run only
    hold = [...hold, ...leadHold({ routes, pool, lead: s.startWith ?? null, windows, visitMin: profile.visitMin, statuses: pool.statuses, frozen, now, locks: [...locks, ...hold], famous: !!s.famous })];
    // the doors put back on Your list (Stop for today, running late: s.parked) stay off every day (lib/day-stop.js)
    const input = withoutParked({ pool: pool.rows, statuses: pool.statuses, windows: capsWithRolled(windows, s.drive, locks), visitMin: profile.visitMin, pinned: pool.pinned, frozen, locks: [...locks, ...hold], now, previous, areas: Boolean(profile.week), ...routingFlag() }, s.parked);
    const { plan: p } = await planOnRoads(input, { fetchMatrix: demo?.fetchMatrix ?? fetchMatrix, cache: demo?.cache ?? matrixCache });
    return { p: markParked(unhold(p, hold), s.parked), pool, windows };
  }
  let seq = 0;
  let first = true; // the first plan selects the first day with doors
  // refit: a status change that changed the selected day's doors refits the map to the day (never stays zoomed on a
  // removed stop); other re-plans keep the view where the rep has it.
  // fresh (J3, a doors-a-day change): the days ahead plan as if new, not around the doors they had
  // hold: day-locks for this one run, not saved (running late's move: lateMoveInput)
  async function replan({ refit = false, fresh = false, hold = [] } = {}) {
    const my = ++seq;
    const caps = capsNow(); // the caps this plan is built with
    rerouted = new Set();
    const was = dayIds(sel);
    const { p, pool, windows } = await compute({ fresh, hold });
    if (dead || my !== seq) return;
    // carry-over notices stay until dismissed (the next re-plan no longer lists them)
    const carriedNotes = { ...(st.carriedNotes ?? {}) };
    for (const n of p.notes) if (n.kind === "carried") carriedNotes[n.from] = { text: n.text, ids: n.ids, from: n.from };
    const saved = savedPlan(p); // fix13: with the weeks' sets, so a reopen re-plans on them
    // the last plan made with no doors-a-day limit: what "Any" goes back to (uncappedPrevious)
    st = store.update(brand, c.key, (s) => ({ ...s, plan: saved, carriedNotes, ...(windows.every((w) => !w.max) ? { uncappedPlan: saved } : {}) }));
    plan = { ...p, venues: pool.venues, pool: { ids: pool.ids, N: pool.N, label: pool.label, drinker: pool.drinker }, statuses: pool.statuses, outcomes: st.outcomes, slots: slotsView(), talkEdits: st.talkEdits ?? {} /* R9 chat agent */, drive: st.drive ?? {}, later: st.later ?? {} /* Log book: Save for later */, profile, city: { key: c.key, name: c.name }, source: travelSource(p), windows };
    if (!document.documentElement.classList.contains("in-demo")) askBrief(plan, (u, o) => fetch(u, o)); // Doors Agent: the specialist brief for this category + city (src/brief.js); the guided demo makes no live calls
    if (typeof sel === "number" && !p.days[sel]) sel = 0;
    if (refit && was !== dayIds(sel)) fitted = null;
    if (!layers.init) (layers.init = true), (layers.days = new Set(p.days.keys()));
    if (first) {
      first = false;
      const k = p.days.findIndex((d) => !d.past && d.stops.length);
      sel = k >= 0 ? k : 0;
    }
    planCaps = caps;
    S.setSelected(sel);
    S.setPlan(plan);
    draw();
    return true; // false-y when a later re-plan superseded this one
  }
  const capsNow = () => ({ maxPerDay: profile.maxPerDay ?? null, maxByDate: { ...(profile.maxByDate ?? {}) } });
  let planCaps = null; // the caps of the plan on screen (J3: what Undo of a cap change restores, with that plan)
  const dayIds = (k) => (!plan ? "" : k === "week" ? plan.days.map((d) => d.stops.map((s) => s.id).join()).join("|") : typeof k === "number" ? plan.days[k]?.stops.map((s) => s.id).join() ?? "" : "");
  async function setStatus(id, status) {
    // what Undo restores: the status, the frozen day, the saved plan and the published one (R1 Calacanis 7)
    const before = plan && { plan, known: [...(profile.known ?? [])], st: { statuses: st.statuses, current: st.current, plan: st.plan, carriedNotes: st.carriedNotes, locks: st.locks } };
    let day = plan?.days.find((d) => d.stops.some((s) => s.id === id));
    // judge pass 4 (#3): a visit logged while one of the plan's days is today happened today, so today is the day being
    // worked, not the later day the door was planned on ("done at The Closet, back Tuesday at 4" on a Friday froze
    // Tuesday and drew its 4 pm return as a ✓ at 2:46). With no plan day today (the tour) nothing changes
    const now = nowStamp();
    const today = status === "visited" ? plan?.days.find((d) => d.date === now.date && !d.past && now.min < d.to) : null;
    if (today && day && day.date > today.date) day = today;
    st = store.setStatus(brand, c.key, id, status);
    if (!status && (profile.known ?? []).includes(id)) {
      profile.known = profile.known.filter((x) => x !== id);
      st = store.update(brand, c.key, { profile });
      onProfile(profile);
    }
    // a stop checked Visited means that day is being worked: it keeps its order (a visit out of order re-routes the rest
    // of it from there, G4), later days re-plan (§6.6). Marking
    // "already talked to" or "not a fit" before the day re-plans the whole plan, so the gap fills.
    if (status === "visited" && day && !day.past && (!st.current || day.date >= st.current.date)) st = store.update(brand, c.key, { current: { date: day.date, from: day.from } });
    focusId = id;
    await replan({ refit: true });
    if (dead || !before) return false;
    const text = replanSummary(before.plan, plan, { id, name: plan.venues[id]?.name });
    if (text) flash(text, () => restore(before));
    // persona (drinks rep): Undo on Your list after the toast is gone put the door back unrouted. Keep what the toast's
    // Undo restores; the list's Undo uses it while nothing else has changed since (else it un-marks and re-plans)
    if (status) markUndo.set(id, { before, sig: planSig() });
    else markUndo.delete(id);
    return !!text; // the stop panel shows its own toast only when this one didn't (one Undo on screen)
  }
  const markUndo = new Map(); // id → {before (as setStatus keeps it), sig: the plan right after it was marked}
  const planSig = () => JSON.stringify([dayIds("week"), st.statuses, st.outcomes, st.locks ?? [], st.contacts?.length ?? 0]);
  // the list's Undo on a marked door: the plan as it was before the mark when nothing changed since, else un-mark
  function undoMark(id) {
    const m = markUndo.get(id);
    markUndo.clear();
    if (m && m.sig === planSig()) return restore(m.before);
    return setStatus(id, null);
  }
  function restore(b) {
    seq++; // a re-plan still in flight loses
    st = store.update(brand, c.key, (s) => ({ ...s, ...b.st }));
    if ((profile.known ?? []).join() !== b.known.join()) {
      profile.known = b.known;
      st = store.update(brand, c.key, { profile });
      onProfile(profile);
    }
    if (b.caps) {
      Object.assign(profile, structuredClone(b.caps));
      planCaps = b.caps;
      st = store.update(brand, c.key, { profile });
      onProfile(profile);
    }
    plan = { ...b.plan, outcomes: st.outcomes, slots: slotsView(), talkEdits: st.talkEdits ?? {} /* R9 chat agent */, drive: st.drive ?? {}, later: st.later ?? {} };
    if (typeof sel === "number" && !plan.days[sel]) sel = 0;
    fitted = null;
    rerouted = new Set();
    S.setSelected(sel);
    S.setPlan(plan);
    draw();
    flash("Undone: your plan is back as it was.");
  }
  async function setOutcome(id, outcome) {
    st = store.setOutcome(brand, c.key, id, outcome);
    await replan();
  }
  // Save for later (round 4 item 10, Jard 10-27: "doors i'm interested in visiting that i have not put on a day's route
  // yet"): a flag on the door, kept with the plan (st.later, lib/logbook.js), shown as a tag on its rows, the stop and
  // the map card, and as a row in the Log book. No re-plan: the door stays where it is. With Undo.
  function setLater(id, on) {
    if (!plan) return false;
    const v = plan.venues[id] ?? st.later?.[id]?.venue ?? null;
    st = store.update(brand, c.key, (s) => withLater(s, id, on, v));
    plan = { ...plan, later: st.later ?? {} };
    S.setPlan(plan);
    draw();
    const name = v?.name ?? "The door";
    flash(on ? `${name} saved for later. It's in ${LOGBOOK_LABEL}.` : `${name} taken off Saved for later.`, () => setLater(id, !on));
    return true;
  }
  // ---- R9 cultural slots (docs/CULTURAL-SLOTS.md) ----
  // the door slots of this brand-city plus the brand's rules (every city, Q4) under "*"
  function slotsView() {
    const own = st.slots ?? {};
    return { ...own, "*": [...(own["*"] ?? []), ...store.getRules(brand)] };
  }
  // setSlot(id, record): add a record (a rule goes to the brand's rules); setSlot(id, {clear: field}) drops a door's field.
  // No re-plan: slots change words, never the route. The stop panel redraws from the published plan.
  function setSlot(id, rec) {
    if (rec?.note) st = store.setSlots(brand, c.key, id, noteOp(st.slots?.[id] ?? [], rec)); // door notes: an edit or a delete
    else if (rec?.clear) {
      if (/^rule\./.test(rec.clear)) store.setRules(brand, store.getRules(brand).filter((r) => r.field !== rec.clear || (rec.value != null && JSON.stringify(r.value) !== JSON.stringify(rec.value))));
      // R9 red team: with a value (the agent's Undo), only that record goes (slots.dropRecord)
      else st = store.setSlots(brand, c.key, id, rec.value != null ? dropRecord(st.slots?.[id] ?? [], rec.clear, rec.value) : (st.slots?.[id] ?? []).filter((r) => r.field !== rec.clear));
    } else if (/^rule\./.test(rec?.field ?? "")) store.setRules(brand, [...store.getRules(brand), rec]);
    else if (rec) st = store.setSlots(brand, c.key, id, [...(st.slots?.[id] ?? []), rec]);
    if (plan) (plan = { ...plan, slots: slotsView() }), S.setPlan(plan);
  }
  // ---- end R9 slots ----
  async function addContact(v) {
    const contacts = (st.contacts ?? []).filter((x) => x.id !== v.id);
    st = store.update(brand, c.key, { contacts: [...contacts, v], parked: unparkIds(st.parked, [v.id]) });
    // a contact that was marked earlier gets a clean slate
    if (st.statuses[v.id]) st = store.setStatus(brand, c.key, v.id, null);
    focusId = v.id;
    view = "list";
    await replan();
    const d = plan.days.findIndex((x) => x.stops.some((s) => s.id === v.id));
    if (d >= 0) selectDay(d);
    flash(d >= 0 ? `${v.name} added as your contact: ${cap(plan.days[d].day)}, stop ${plan.days[d].stops.findIndex((s) => s.id === v.id) + 1}.` : `${v.name} added as your contact, but it didn't fit any window. It's under Not on a day.`);
  }
  async function removeContact(id) {
    st = store.update(brand, c.key, { contacts: (st.contacts ?? []).filter((x) => x.id !== id) });
    await replan();
  }
  // G3: a room added from the map or a list (S.addDoor): saved with the plan like a contact, pinned to `date`, or to the
  // day the planner does best with it (a trial plan per open day: bestAddDay). Says where it landed, with Undo.
  async function addDoor(venue, { date = null } = {}) {
    const v0 = venue?.id != null ? plan?.venues[venue.id] ?? venue : null;
    if (!plan || !v0 || !Number.isFinite(+v0.lat) || !Number.isFinite(+v0.lon)) return null;
    const { contact, added, date: _, ...v } = { ...v0, lat: +v0.lat, lon: +v0.lon };
    const before = { plan, known: [...(profile.known ?? [])], st: { statuses: st.statuses, current: st.current, plan: st.plan, carriedNotes: st.carriedNotes, added: st.added, parked: st.parked ?? [] } };
    const others = (st.added ?? []).filter((x) => x.id !== v.id);
    // the trial plans see the room with a clean slate, as it is saved (a "Not a fit" mark would keep it off every day)
    // (and off the doors put back on Your list: adding one back is the rep's call, lib/day-stop.js)
    const base = { statuses: Object.fromEntries(Object.entries(st.statuses ?? {}).filter(([k]) => k !== v.id)), parked: unparkIds(st.parked, [v.id]) };
    const my = seq;
    let probe = null;
    if (!date) {
      flash(`Finding the best day for ${v.name ?? "this door"}…`);
      const open = plan.days.filter((d) => !d.past && !d.frozen).map((d) => d.date);
      const trials = [];
      for (const dt of [...new Set(open)]) trials.push({ date: dt, plan: (await compute({ added: [...others, { ...v, date: dt }], base })).p });
      if (dead || my !== seq) return null;
      date = bestAddDay(trials, v.id, { rank: (id) => (plan.pool.ids.indexOf(id) + 1 || null) });
      probe = trials.find((t) => t.date === date)?.plan ?? null;
    }
    // Jard 10-24: a room no day can hold is not added (no change entry, "Added by you" tag or banner): say why, keep nothing
    if (!probe) probe = (await compute({ added: [...others, { ...v, date: date ?? null }], base })).p;
    if (dead || my !== seq) return null;
    const onList = plan.pool.ids.includes(v.id);
    if (dayHolding(probe, v.id) < 0) {
      flash(notAddedText(probe, v.id, { day: date ? plan.days.find((d) => d.date === date)?.day : null, name: v.name, onList }));
      return null;
    }
    st = store.update(brand, c.key, { added: [...others, { ...v, date: date ?? null }], parked: unparkIds(st.parked, [v.id]) });
    if (st.statuses[v.id]) st = store.setStatus(brand, c.key, v.id, null); // an added room gets a clean slate
    focusId = v.id;
    view = "list";
    closePopup();
    await replan();
    if (dead) return null;
    const k = plan.days.findIndex((d) => d.stops.some((s) => s.id === v.id));
    if (k < 0) { // the trial placed it and the re-plan didn't: put everything back, nothing recorded
      const why = notAddedText(plan, v.id, { name: v.name, onList });
      restore(before);
      flash(why);
      return null;
    }
    fitted = null; // the week's bounds may have grown: fit them again
    layers.days.add(k);
    if (sel !== "week") selectDay(k);
    else drawMap();
    const day = date ? plan.days.find((d) => d.date === date)?.day : null;
    // what it cost ("Tuesday re-planned: 1 back on Your list"); a new order alone goes unsaid
    const moved = (replanSummary(before.plan, plan, { id: v.id, name: v.name }) ?? "").split(" · ").filter((t) => t && !t.endsWith("same doors, new order")).join(" · ");
    flash(`${addedText(plan, v.id, { day })}${moved ? ` ${moved}.` : ""}`, () => restore(before));
    return { day: k, date: plan.days[k].date };
  }
  // Jard 10-24: a plain "Remove from my plan", no reason asked (its row menu, its stop, Why this door). A room you added
  // comes out of Changes you made (its banner and "Added by you" tag go with it); a door on a day is marked "removed"
  // (the planner leaves it off as it does "Not a fit"; Changes you made has its Undo). With Undo.
  async function removeDoor(id) {
    if (!plan) return false;
    const name = plan.venues[id]?.name ?? "That door";
    const before = { plan, known: [...(profile.known ?? [])], st: { statuses: st.statuses, current: st.current, plan: st.plan, carriedNotes: st.carriedNotes, locks: st.locks, added: st.added } };
    const wasAdded = (st.added ?? []).some((x) => x.id === id);
    const k = dayHolding(plan, id);
    if (wasAdded) st = store.update(brand, c.key, { added: st.added.filter((x) => x.id !== id) });
    if (k >= 0 && (!wasAdded || plan.pool.ids.includes(id))) st = store.setStatus(brand, c.key, id, "removed");
    // a day under way keeps its stops as saved: take it off that day too (as removeStop does)
    const next = k >= 0 && plan.days[k].frozen ? dropFromDay(st.plan, plan.days[k], [id]) : null;
    if (next) st = store.update(brand, c.key, { plan: next });
    if ((st.locks ?? []).some((l) => l.id === id)) st = store.update(brand, c.key, { locks: st.locks.filter((l) => l.id !== id) });
    focusId = id;
    await replan({ refit: true });
    if (dead) return false;
    flash(`${name} is off your plan.`, () => restore(before));
    if (st.statuses?.[id] === "removed") markUndo.set(id, { before, sig: planSig() }); // Your list's Undo puts it back where it was
    return true;
  }
  // Map layers: every day's route shows (the list's day bold, the others faint); the ranked doors no day holds show on
  // Your list. ease #1 (AUDIT-EASE-1): the list tabs are the one day picker and the map follows them (the map's own day
  // chips went: two pickers for one thing).
  const layers = { days: new Set(), rest: false, init: false, hoods: false, others: othersSaved() }; // hoods: round 5 #2b, the map coloured by neighbourhood on any tab; others: round 8 (below)
  // Round 8 (Jard 10-28: "an option on the map to hide the faded other routes to make the map less busy"): the Other
  // days pill by Neighbourhoods. On (the default, today's map): a day's view draws the other days' routes and pins
  // faded behind it. Off: the day on screen alone. All days and Your list show every day either way (the pill hides
  // there: it would do nothing). The choice is kept per device (OTHERS_KEY); the camera stays where it is.
  function othersSaved() { try { return localStorage.getItem(OTHERS_KEY) !== "off"; } catch { return true; } }
  const othersApply = () => typeof sel === "number" && plan?.days.length > 1; // the pill shows, and bites, only on a day's tab
  function selectDay(d) {
    sel = d;
    view = "list";
    layers.rest = d === "rest";
    if (!layers.rest) closePopup();
    S.setSelected(sel);
    draw();
  }

  // ---------- G4: locks and moves ----------
  // A day's visits (marked visited or talked, not a return visit) lead the current day: nothing moves above them.
  const isDone = (s, d) => plan.statuses[s.id] === "visited" && !isReturnVisit(s, d, plan.outcomes?.[s.id]);
  const lead = (d) => {
    let k = 0;
    while (k < d.stops.length && isDone(d.stops[k], d)) k++;
    return d.frozen ? k : 0;
  };
  const movable = (d, s) => d && !d.past && !isDone(s, d);
  // Every lock, as the days show them, with `orders` (date → ids) in place of a day's order: {id, date, index}.
  // locked: id → "place" | "day" (index null: held on its day only, placed by the planner).
  const lockList = (locked, orders = new Map()) =>
    plan.days.flatMap((d) => (d.past ? [] : (orders.get(d.date) ?? d.stops.map((s) => s.id)).flatMap((x, i) => (locked.has(x) ? [{ id: x, date: d.date, index: locked.get(x) === "day" ? null : i }] : []))));
  const lockedNow = () => new Map(plan.days.flatMap((d) => (d.past ? [] : d.stops.filter((s) => s.locked).map((s) => [s.id, s.lockDay ? "day" : "place"]))));
  // saved: a new saved plan to keep with the locks (a move onto or off the day under way edits that day itself)
  // guard (a move): when the re-plan leaves a door that was on a day ahead on no day (the moved one too), it is undone
  // and the toast says so (a planned door is never pushed off, as End my day). → false when undone
  async function relock(locks, id, say, saved = null, guard = null) {
    const before = { plan, known: [...(profile.known ?? [])], st: { statuses: st.statuses, current: st.current, plan: st.plan, carriedNotes: st.carriedNotes, locks: st.locks } };
    st = store.update(brand, c.key, saved ? { locks, plan: saved } : { locks });
    focusId = id;
    await replan({ refit: true });
    if (dead) return true;
    const off = guard ? offEveryDay(before.plan, plan) : [];
    if (off.length) {
      restore(before);
      flash(noRoomText(plan, id, off, guard.day));
      return false;
    }
    // the stops whose place changed, on the days still ahead
    for (const d of plan.days) {
      const old = before.plan.days.find((x) => x?.date === d.date && x.from === d.from);
      if (d.past || !old) continue;
      d.stops.forEach((s, k) => { if (!s.locked && s.id !== id && old.stops.findIndex((x) => x.id === s.id) !== k) rerouted.add(s.id); });
    }
    draw();
    const sum = replanSummary(before.plan, plan);
    flash(`${say()}${sum ? ` ${sum}.` : ""}`, () => restore(before));
    return true;
  }
  const placeOf = (id) => {
    const i = plan.days.findIndex((d) => d.stops.some((s) => s.id === id));
    return i < 0 ? null : { i, n: plan.days[i].stops.findIndex((s) => s.id === id) + 1, d: plan.days[i] };
  };
  async function setLock(id, on) {
    const at = placeOf(id);
    if (!plan || !at || !movable(at.d, at.d.stops[at.n - 1])) return false;
    const locked = lockedNow();
    if (on) locked.set(id, "place");
    else locked.delete(id);
    const name = plan.venues[id]?.name ?? "That stop";
    await relock(lockList(locked), id, () => {
      const p = placeOf(id);
      return on ? `${name} locked: ${cap(p?.d.day ?? "")}, stop ${p?.n}.` : `${name} unlocked: Doors places it again.`;
    });
    return true;
  }
  // index null (a drop on a day's tab): locked to that day, the planner picks its place
  async function moveStop(id, { day, index }) {
    const to = plan?.days[day];
    const at = placeOf(id);
    if (!to || to.past || !at || !movable(at.d, at.d.stops[at.n - 1])) return false;
    const order = (d) => d.stops.map((s) => s.id).filter((x) => x !== id);
    const tgt = order(to);
    tgt.splice(Number.isInteger(index) ? Math.max(lead(to), Math.min(index, tgt.length)) : tgt.length, 0, id);
    const orders = new Map([[to.date, tgt]]);
    if (at.d !== to) orders.set(at.d.date, order(at.d));
    const locked = lockedNow();
    const name = plan.venues[id]?.name ?? "That stop";
    // the day under way (frozen) is kept as the rep has it: a lock there re-planned it from the clock and took doors
    // off (mobile2 10-23: 6 of 7). Onto it or within it: the saved day's own order (moveIntoDay), no lock; off it to
    // a day ahead: the saved day without the door (dropFromDay), locked to its new day as any move
    const saved = to.frozen ? moveIntoDay(st.plan, at.d, to, id, Number.isInteger(index) ? index : null, lead(to)) : at.d.frozen ? dropFromDay(st.plan, at.d, [id]) : null;
    if (saved && to.frozen) {
      locked.delete(id);
      orders.delete(to.date);
      orders.delete(at.d.date);
      return relock(lockList(locked, orders), id, () => { const p = placeOf(id); return p ? `${name} moved to ${cap(p.d.day)}: stop ${p.n}.` : `${name} didn't fit there.`; }, saved, { day: to.day });
    }
    if (saved) orders.delete(at.d.date);
    locked.set(id, Number.isInteger(index) ? "place" : "day");
    return relock(lockList(locked, orders), id, () => {
      const p = placeOf(id);
      if (!p) return `${name} didn't fit there.`;
      return Number.isInteger(index) ? `${name} locked: ${cap(p.d.day)}, stop ${p.n}.` : `${name} moved to ${cap(p.d.day)}: stop ${p.n}.`;
    }, saved, { day: to.day });
  }
  // drive mode's "Skip for now": the door goes to the end of its day. On the day being worked (frozen) that is a new
  // order for the day as the rep has it (lib/drive-day.js skipToEnd), not a lock: a place lock at the end re-planned
  // the day around it and took free doors off. A day ahead re-plans around a lock at the end, as a drag does (moveStop).
  async function skipStop(id) {
    const at = placeOf(id);
    if (!plan || !at || !movable(at.d, at.d.stops[at.n - 1])) return false;
    const next = at.d.frozen ? skipToEnd(st.plan, at.d, id) : null;
    if (!next) return moveStop(id, { day: at.i, index: at.d.stops.length });
    st = store.update(brand, c.key, { plan: next, locks: (st.locks ?? []).filter((l) => l.id !== id) });
    focusId = id;
    await replan({ refit: true });
    return !dead;
  }
  // ---- R9 drive mode: an exact Undo (the state and the plan as they were, outcomes included) ----
  const snapshot = () => plan && { plan, known: [...(profile.known ?? [])], st: { statuses: st.statuses, outcomes: st.outcomes, current: st.current, plan: st.plan, carriedNotes: st.carriedNotes, locks: st.locks, drive: st.drive ?? {}, parked: st.parked ?? [] } };
  const restoreSnapshot = (b) => b && restore(b);
  // ---- end R9 drive mode ----
  // ---- the day flow (Jard 10-23, items 5-6; lib/day-debrief.js) ----
  // setDrive(date, patch): the day's drive record (started, paused, ended, removed, skipped). No re-plan: it changes
  // what drive mode and the Start my day button say, never the route.
  function setDrive(date, patch) {
    st = store.update(brand, c.key, { drive: patchRecord(st.drive, date, patch) });
    if (plan) (plan = { ...plan, drive: st.drive }), S.setPlan(plan), drawDriveBtn();
  }
  // removeStop(id, {drop}): off its day for good. drop: dropped from the plan (Not a fit). Else off the day only: on the
  // day being worked (frozen) the saved day without it (the planner keeps that day as the rep has it, and may put the
  // door on a day ahead); on a day ahead it is locked to the next day, as Ask Doors' skip. Skip for now only moves it
  // to the end of today, so it came back as the next door forever (item 6). → the day's date, or false.
  async function removeStop(id, { drop = false, at = null } = {}) {
    const p0 = placeOf(id);
    if (!plan || !p0 || !movable(p0.d, p0.d.stops[p0.n - 1])) return false;
    const date = p0.d.date;
    if (drop) st = store.setStatus(brand, c.key, id, "notfit");
    else if (p0.d.frozen) {
      const next = dropFromDay(st.plan, p0.d, [id]);
      if (next) st = store.update(brand, c.key, { plan: next, locks: (st.locks ?? []).filter((l) => l.id !== id) });
    } else {
      const locked = lockedNow();
      const nd = plan.days.slice(p0.i + 1).find((d) => !d.past && d.date !== date);
      const orders = new Map([[date, p0.d.stops.map((x) => x.id).filter((x) => x !== id)]]);
      if (nd) orders.set(nd.date, [...nd.stops.map((x) => x.id), id]), locked.set(id, "day");
      else locked.delete(id);
      st = store.update(brand, c.key, { locks: lockList(locked, orders) });
    }
    st = store.update(brand, c.key, { drive: patchRecord(st.drive, date, (r) => withRemoved(r, id, drop ? "dropped" : "later", at)) });
    focusId = id;
    await replan({ refit: true });
    return dead ? false : date;
  }
  // skipDoors(date, ids, {at}): running late's Skip (ease audit 3 #2). The doors come off that day's route and go back on
  // Your list with no lock: never locked onto the next day (Remove's way on a day ahead), since the banner has just said
  // no later day has room. The day is kept as the rep has it (the day under way, as a visit logged there makes it), so
  // the re-plan neither puts them back on it nor fills the gap from Your list. → the ids taken off, or false
  async function skipDoors(date, ids, { at = null } = {}) {
    const d = plan?.days.find((x) => x.date === date && !x.past);
    const off = d ? ids.filter((id) => d.stops.some((s) => s.id === id && movable(d, s))) : [];
    if (!off.length) return false;
    if (!d.frozen) st = store.update(brand, c.key, { current: { date: d.date, from: d.from } });
    const next = dropFromDay(st.plan, d, off);
    if (next) st = store.update(brand, c.key, { plan: next });
    st = store.update(brand, c.key, { locks: (st.locks ?? []).filter((l) => !off.includes(l.id)), drive: patchRecord(st.drive, date, (r) => off.reduce((x, id) => withRemoved(x, id, "later", at), r)) });
    focusId = off[0];
    await replan({ refit: true });
    return dead ? false : off;
  }
  // endDay(date, {ids, at, how}): Stop for today (End my day). The doors not done come off the day, the day is marked
  // ended, and drive mode shows the debrief. how "days" (Move them into the coming days): they roll to the next plan
  // day, first, in rank order (rollDay); with no later day they are on Your list, not on a day. how "list" (Put them
  // back on Your list): off the day, no roll, no lock. A stop that took doors off is one entry in Changes you made
  // (lib/day-stop.js). → true, or false when the day isn't on the plan.
  async function endDay(date, { ids = [], at = null, how = "days" } = {}) {
    const k = plan?.days.findIndex((d) => d.date === date) ?? -1;
    if (k < 0) return false;
    const d = plan.days[k];
    const off = ids.filter((id) => d.stops.some((s) => s.id === id && movable(d, s)));
    if (off.length && !d.frozen) st = store.update(brand, c.key, { current: { date: d.date, from: d.from } }); // kept as the rep has it
    const next = off.length ? dropFromDay(st.plan, d, off) : null;
    if (next) st = store.update(brand, c.key, { plan: next, locks: (st.locks ?? []).filter((l) => !off.includes(l.id)) });
    const list = how === "list";
    if (list && off.length) st = store.update(brand, c.key, { parked: parkIds(st.parked, off) }); // kept off every day
    st = store.update(brand, c.key, { drive: patchRecord(st.drive, date, (r) => {
      const x = { ...off.reduce((y, id) => withRemoved(y, id, list ? "endlist" : "end", at), r), ended: at ?? true, paused: null, moved: null };
      return off.length ? withChange(x, { kind: "stop", how: list ? "list" : "days", at, ids: off }) : x;
    }) });
    const to = nextPlanDay(plan, date);
    if (off.length && to >= 0 && !list) return rollDay(date, plan.days[to].date, off);
    await replan({ refit: true });
    return !dead;
  }
  // rollDay(date, to, ids?): the doors End my day took off `date` (ids, else the ones it moved) go at the end of plan
  // day `to`, in rank order, locked there, in the time it has left ("Choose another day" calls it again).
  // never push a planned door off: a day ahead keeps its own doors. A door that would push one off, arrive shut, or run
  // past the window's end comes back off and goes on to the next plan day, and so on; with no day left it is on Your
  // list, not on a day (Day done says why). → true | false
  // late (running late's Move them into the coming days): the groups go on the record's lateMoved (they come on top of
  // the days' caps alike), after the ones it has, and the day is not ended.
  async function rollDay(date, to, ids = null, { late = false } = {}) {
    const move = ids ?? movedIds(st.drive?.[date]);
    const keep = (r) => (r.lateMoved ?? []).map((g) => ({ ...g, ids: g.ids.filter((x) => !move.includes(x)) })).filter((g) => g.ids.length);
    const put = (gs) => (r) => (late ? { lateMoved: [...keep(r), ...gs.filter((g) => g.ids.length)] } : { moved: gs.filter((g) => g.ids.length).length ? gs.filter((g) => g.ids.length) : null });
    if (!move.length || !plan?.days.some((d) => d.date === to && !d.past)) return false;
    const vm = profile.visitMin ?? 25;
    // off any day ahead first (Choose another day: they were locked on the day they went to)
    const free = lockedNow();
    for (const id of move) free.delete(id);
    const orders0 = new Map(plan.days.filter((d) => !d.past).map((d) => [d.date, d.stops.map((s) => s.id).filter((x) => !move.includes(x))]));
    let base = { plan: plan.days.reduce((sp, d) => (d.past ? sp : dropFromDay(sp, d, move) ?? sp), st.plan), locks: lockList(free, orders0) };
    // every door on a day ahead now, and its day: none may leave it
    const was = plan.days.filter((d) => !d.past && d.date > date).flatMap((d) => d.stops.filter((s) => !move.includes(s.id)).map((s) => [s.id, d.date]));
    const pushedOff = () => was.filter(([id, dt]) => !plan.days.find((d) => d.date === dt)?.stops.some((s) => s.id === id));
    const groups = [];
    let pending = move;
    for (let day = to; pending.length && day && !dead; day = plan.days.find((d) => !d.past && d.date > day)?.date ?? null) {
      const tk = plan.days.findIndex((d) => d.date === day);
      let { ids: on, left } = rollPlan(plan, pending, tk, { visitMin: vm, shut: shutOn });
      const gone = [];
      // on: locked at the end of the day, after its own doors; while that pushes a door off or one of them can't be
      // visited open in the window, the last of them comes back off (the day as it was, then the rest again)
      for (let guard = 0; on.length && !dead && guard <= pending.length; guard++) {
        const locked = new Map(base.locks.map((l) => [l.id, l.index == null ? "day" : "place"]));
        const ordersNow = new Map(plan.days.filter((d) => !d.past).map((d) => [d.date, d.stops.map((s) => s.id).filter((x) => !pending.includes(x) && !gone.includes(x))]));
        for (const l of base.locks) if (!ordersNow.get(l.date)?.includes(l.id)) ordersNow.set(l.date, [...(ordersNow.get(l.date) ?? []), l.id]);
        ordersNow.set(day, [...(ordersNow.get(day) ?? []), ...on]);
        for (const id of on) locked.set(id, "place");
        st = store.update(brand, c.key, { plan: base.plan, locks: lockList(locked, ordersNow), drive: patchRecord(st.drive, date, put([...groups, { to: day, ids: on }])) });
        await replan({ refit: true });
        const d = plan.days.find((x) => x.date === day);
        const late = on.filter((id) => { const x = d?.stops.find((y) => y.id === id); return !x || x.openAtArrival === false || x.depart > d.to; });
        if (!late.length && !pushedOff().length) break;
        const back = late.length ? late : [on.at(-1)];
        gone.push(...back);
        on = on.filter((x) => !back.includes(x));
      }
      if (!on.length && gone.length) {
        // none fit: the days ahead as they were
        st = store.update(brand, c.key, { plan: base.plan, locks: base.locks, drive: patchRecord(st.drive, date, put(groups)) });
        await replan({ refit: true });
      }
      if (on.length) base = { plan: st.plan, locks: st.locks ?? [] }; // the next day plans around these
      groups.push({ to: day, ids: on });
      pending = [...left, ...gone];
    }
    if (!groups.some((g) => g.ids.length) && !dead) {
      st = store.update(brand, c.key, { plan: base.plan, locks: base.locks, drive: patchRecord(st.drive, date, put([])) });
      await replan({ refit: true });
    }
    if (!dead) {
      // a safety net, never expected: a planned door off its day is said on Day done, with where it is
      // running late's doors that found no day are off today (on Your list): the debrief lists them apart
      const placed = new Set(groups.flatMap((g) => g.ids));
      st = store.update(brand, c.key, { drive: patchRecord(st.drive, date, (r) => ({ ...(late ? move.filter((id) => !placed.has(id)).reduce((x, id) => withRemoved(x, id, "later", null), r) : {}), bumped: pushedOff().map(([id, from]) => ({ id, from })) })) });
      plan = { ...plan, drive: st.drive };
      S.setPlan(plan);
    }
    return !dead;
  }
  // Running late (never offer a move the guard would refuse). lateFits(k, ids): for each later plan day,
  // the planner's run with the doors that don't fit day k moved to its end (lateMoveInput; every other door ahead held
  // on its day), nothing saved: does every one land there in the day's time, every other door still on its day?
  // → [{i, date, day, ok}]. moveLate(k, ids, i): that same move, kept
  // only when it works (lateMoveFits), else undone. → true | false
  async function lateFits(k, ids) {
    const p0 = plan;
    const out = [];
    if (!p0?.days[k] || !ids?.length) return out;
    for (const { i, date } of laterDays(p0, p0.days[k].date)) {
      const { saved, locks, drive, hold } = lateMoveInput(p0, st.plan, k, ids, i, lockedNow(), st.drive);
      const { p } = await compute({ locks, hold, base: { plan: saved, locks, drive } });
      if (dead || plan !== p0) return null; // the plan changed under it: the caller asks again
      out.push({ i, date, day: p0.days[i].day, ok: lateMoveFits(p0, p, ids, date) });
    }
    return out;
  }
  async function moveLate(k, ids, i) {
    if (!plan?.days[k] || !plan.days[i] || plan.days[i].past || !ids?.length) return false;
    const before = { plan, known: [...(profile.known ?? [])], st: { statuses: st.statuses, current: st.current, plan: st.plan, carriedNotes: st.carriedNotes, locks: st.locks, drive: st.drive ?? {} } };
    const { saved, locks, drive, hold } = lateMoveInput(plan, st.plan, k, ids, i, lockedNow(), st.drive);
    st = store.update(brand, c.key, { locks, plan: saved, drive });
    await replan({ refit: true, hold });
    if (dead) return false;
    if (lateMoveFits(before.plan, plan, ids, before.plan.days[i].date)) return true;
    restore(before);
    return false;
  }
  // lateRehome(date, ids, how, {at, by}): running late's doors that no longer fit today, the same two choices as Stop for
  // today: "days" rolls them into the coming days (rollDay, late: the lowest-fit go back on Your list when the days are
  // full), "list" takes them off today onto Your list (skipDoors). One entry in Changes you made when it moved any.
  // → the ids taken off today, or false
  async function lateRehome(date, ids, how, { at = null, by = 0 } = {}) {
    const d = plan?.days.find((x) => x.date === date && !x.past);
    const off = d ? ids.filter((id) => d.stops.some((s) => s.id === id && movable(d, s))) : [];
    if (!off.length) return false;
    const log = () => (st = store.update(brand, c.key, { drive: patchRecord(st.drive, date, (r) => withChange(r, { kind: "late", how, at, by, ids: off })) }));
    if (how === "list") {
      const was = st.parked;
      st = store.update(brand, c.key, { parked: parkIds(st.parked, off) }); // kept off every day
      const done = await skipDoors(date, off, { at });
      if (!done?.length && !dead) st = store.update(brand, c.key, { parked: was });
      if (!done?.length || dead) return false;
      log();
    } else {
      const to = nextPlanDay(plan, date);
      if (to < 0) return false;
      if (!d.frozen) st = store.update(brand, c.key, { current: { date: d.date, from: d.from } });
      const next = dropFromDay(st.plan, d, off);
      if (next) st = store.update(brand, c.key, { plan: next, locks: (st.locks ?? []).filter((l) => !off.includes(l.id)) });
      log();
      if (!(await rollDay(date, plan.days[to].date, off, { late: true }))) return false;
    }
    plan = { ...plan, drive: st.drive };
    S.setPlan(plan);
    return off;
  }
  // undoDayChange(date): the Undo of the day's newest Stop for today or running late re-home (Changes you made, Resume
  // my day): the doors back at the end of that day's route, off the days ahead, unlocked; the record as before.
  // → {ids, change} | false
  async function undoDayChange(date) {
    const u = plan && undoChange(st.plan, plan, st.drive, date);
    if (!u) return false;
    const d = plan.days.find((x) => x.date === date && !x.past);
    st = store.update(brand, c.key, { plan: u.saved, drive: u.drive, parked: unparkIds(st.parked, u.change.ids), locks: (st.locks ?? []).filter((l) => !u.ids.includes(l.id)), ...(d ? { current: { date: d.date, from: d.from } } : {}) });
    await replan({ refit: true });
    if (dead) return false;
    plan = { ...plan, drive: st.drive };
    S.setPlan(plan);
    drawDriveBtn();
    return { ids: u.ids, change: u.change };
  }
  // the toolbar's Start my day says Resume my day while today's drive is under way (item 5)
  function drawDriveBtn() {
    const b = $("#t-drive", root);
    if (!b || !plan) return;
    const s = startButton(plan, plan.drive, demo ? tourNow(st, plan.windows ?? [], nowStamp()) : nowStamp(), { stopped: true });
    b.textContent = s.label;
    b.title = s.text;
    b.toggleAttribute("data-drive-resume", s.resume);
    b.toggleAttribute("data-drive-stopped", !!s.stopped);
  }
  // ---- end the day flow ----
  // ---- R9 chat agent: the agent's replan and talk actions (docs/CONTRACTS-R9.md §2.2) ----
  // setTalk(id, edit): one talking-point edit {section, op, index, text, by}, kept for this door (stopModel applies them);
  // {clear: true} drops the door's edits, {undoLast: true} the last one. No re-plan: words, not the route.
  function setTalk(id, edit) {
    const edits = { ...(st.talkEdits ?? {}) };
    edits[id] = edit?.clear ? [] : edit?.undoLast ? (edits[id] ?? []).slice(0, -1) : [...(edits[id] ?? []), { section: edit.section, op: edit.op, index: edit.index, text: edit.text, by: edit.by, ...(edit.from ? { from: edit.from } : {}), at: new Date().toISOString() }];
    st = store.update(brand, c.key, { talkEdits: edits });
    if (plan) (plan = { ...plan, talkEdits: edits }), S.setPlan(plan);
  }
  // agentReplan({skip, endBy, maxDoors, lock, add, day, move}): one re-plan, one Undo. endBy ends that day's window (the day
  // asked, else the selected day); maxDoors is the plan's doors a day (J3); a skipped door is locked to the next day
  // ahead (Not scheduled when there is none); lock keeps a stop where it is; add puts a ranked room on the plan.
  // out (Doors Agent's change chip): gets {undo, said: what changed, in a few words}.
  async function agentReplan(a = {}, out = {}) {
    if (!plan) return null;
    const day = a.day ? plan.days.find((d) => d.date === a.day) : typeof sel === "number" ? plan.days[sel] : plan.days.find((d) => !d.past);
    const before = { plan, known: [...(profile.known ?? [])], caps: { ...(planCaps ?? capsNow()), windows: structuredClone(profile.windows ?? []), week: structuredClone(profile.week ?? null) }, st: { statuses: st.statuses, current: st.current, plan: st.plan, carriedNotes: st.carriedNotes, locks: st.locks, added: st.added, parked: st.parked ?? [] } };
    const said = [];
    if (a.endBy && day) {
      // that date's hours: on the usual week, a change to that date only (lib/week.js)
      if (day.from < toMinutes(a.endBy)) setDateHours(profile, day.date, { to: a.endBy });
      said.push(`${cap(day.day)} ends at ${clock12(toMinutes(a.endBy))}`);
    }
    if (a.maxDoors) {
      profile.maxPerDay = a.maxDoors;
      said.push(`up to ${doors(a.maxDoors)} a day`);
    }
    if (a.endBy || a.maxDoors) (st = store.update(brand, c.key, { profile })), onProfile(profile);
    const locked = lockedNow();
    const orders = new Map();
    for (const id of a.skip ?? []) {
      const at = placeOf(id);
      if (!at) continue;
      const next = plan.days.slice(at.i + 1).find((d) => !d.past);
      orders.set(at.d.date, (orders.get(at.d.date) ?? at.d.stops.map((x) => x.id)).filter((x) => x !== id));
      if (next) orders.set(next.date, [...(orders.get(next.date) ?? next.stops.map((x) => x.id)), id]), locked.set(id, "day");
      else locked.delete(id);
      said.push(`${plan.venues[id]?.name ?? "that door"} ${next ? `moved to ${cap(next.day)}` : "off the plan"}`);
    }
    // judge pass 6 (#7): move = [{id, date}]: off its day and locked to the day asked, as a skip is to the next one;
    // never to a day its room is shut (it stays where it is, and the answer says why)
    const kept = [];
    for (const { id, date } of a.move ?? []) {
      const at = placeOf(id);
      const to = plan.days.find((d) => d.date === date && !d.past);
      if (!to || at?.d === to) continue;
      const shut = shutOn(plan.venues[id], { date: to.date, from: to.from, to: to.to, visitMin: profile.visitMin ?? 25 });
      if (shut) { kept.push(`${plan.venues[id]?.name ?? "That door"} is ${shut} (Qloo's hours), so it stays ${at ? `on ${cap(at.d.day)}` : "off the plan"}`); continue; }
      if (at) orders.set(at.d.date, (orders.get(at.d.date) ?? at.d.stops.map((x) => x.id)).filter((x) => x !== id));
      orders.set(to.date, [...(orders.get(to.date) ?? to.stops.map((x) => x.id)), id]), locked.set(id, "day");
      said.push(`${plan.venues[id]?.name ?? "that door"} moved to ${cap(to.day)}`);
    }
    for (const id of a.lock ?? []) if (placeOf(id)) locked.set(id, "place"), said.push(`${plan.venues[id]?.name} locked in place`);
    if ((a.skip ?? []).length || (a.lock ?? []).length || (a.move ?? []).length) st = store.update(brand, c.key, { locks: lockList(locked, orders) });
    const added = (a.add ?? []).map((id) => plan.venues[id]).filter((v) => v && Number.isFinite(+v.lat) && !placeOf(v.id));
    if (added.length) st = store.update(brand, c.key, { added: [...(st.added ?? []).filter((x) => !added.some((v) => v.id === x.id)), ...added.map((v) => ({ ...v, lat: +v.lat, lon: +v.lon, date: day?.date ?? null }))], parked: unparkIds(st.parked, added.map((v) => v.id)) }), said.push(`${added.map((v) => v.name).join(", ")} added`);
    if (!said.length) return kept.length ? { text: `${kept.join(". ")}.`, unchanged: true } : null; // nothing to undo
    if (!(await replan({ refit: true, fresh: Boolean(a.maxDoors) })) || dead) return null;
    // Jard 10-24: a room no day could hold is not added: out of the saved adds again, and the answer says why
    const unplaced = added.filter((v) => dayHolding(plan, v.id) < 0);
    if (unplaced.length) {
      const why = unplaced.map((v) => notAddedText(plan, v.id, { day: day?.day ?? null, name: v.name, onList: plan.pool.ids.includes(v.id) }).replace(/\.$/, ""));
      st = store.update(brand, c.key, { added: (st.added ?? []).filter((x) => !unplaced.some((v) => v.id === x.id)) });
      const i = said.findIndex((t) => t.endsWith(" added"));
      const ok = added.filter((v) => !unplaced.includes(v));
      if (ok.length) said[i] = `${ok.map((v) => v.name).join(", ")} added`;
      else said.splice(i, 1);
      kept.push(...why);
      if (!said.length) { // nothing else changed: the plan as it was, nothing to undo
        restore(before);
        flash(`${kept.join(". ")}.`);
        return { text: `${kept.join(". ")}.`, unchanged: true };
      }
      if (!(await replan({ refit: true, fresh: Boolean(a.maxDoors) })) || dead) return null;
    }
    let sum = replanSummary(before.plan, plan);
    const off = a.endBy && day ? offDayText(before.plan, plan, day.date, { skip: a.skip ?? [] }) : ""; // judge pass 9 #4
    if (off) (said[0] = `${said[0]}: ${off}`), (sum = withoutOffCount(sum, day.day));
    const text = `${kept.length ? `${kept.join(". ")}. ` : ""}${cap(said.join(", "))}.${sum ? ` ${sum}.` : ""}`;
    flash(text, () => restore(before));
    out.undo = () => restore(before);
    out.said = cap(said.join(", "));
    return text;
  }
  // Judge pass 2 (5): "why isn't X first?" names the trade. The same planner, with X locked at the top of its day (after
  // the day's visits), on a scratch copy: nothing is saved or drawn. → {id, date, was: {min, mi, n}, then: {min, mi, n},
  // dropped: [names]}, or null when X is not a movable stop below the top.
  async function whatIfFirst(id) {
    const at = plan && placeOf(id);
    if (!at || at.d.past || !movable(at.d, at.d.stops[at.n - 1])) return null;
    const top = lead(at.d);
    if (at.n - 1 <= top) return null;
    const locks = [...(st.locks ?? []).filter((l) => l.id !== id), { id, date: at.d.date, index: top }];
    const { p } = await compute({ locks }).catch(() => ({}));
    const e = p?.days.find((x) => x.date === at.d.date && x.from === at.d.from);
    if (dead || !e?.stops.some((s) => s.id === id)) return null;
    const of = (d) => ({ min: Math.round(d.min ?? 0), mi: Math.round((d.mi ?? 0) * 10) / 10, n: d.stops.length });
    return { id, date: at.d.date, source: at.d.source === "ors" && e.source === "ors" ? "ors" : "estimate", was: of(at.d), then: of(e), dropped: at.d.stops.filter((s) => !e.stops.some((x) => x.id === s.id)).map((s) => plan.venues[s.id]?.name).filter(Boolean) };
  }
  // ---- end R9 chat agent ----
  // ---- r2viz: try a change from Why these doors, see what it does, apply it (lib/whatif.js) ----
  const drinkNames = () => Object.fromEntries(routes.map((r) => [r.drinker?.key, r.drinker?.name]));
  // previewChange(change) → {change, text, diff, said, plan (the scratch plan), pool, venues} or null; nothing saved.
  async function previewChange(change) {
    if (!plan) return null;
    const my = seq;
    let r;
    if (change.kind === "add") {
      // one door (its best day, or change.date: lane 2's "lock it to that day"), or several at once (change.ids, lane
      // 2's thread panel: one scratch plan with all of them, the planner picks their days)
      const ids = change.ids ?? [change.id];
      const vs = ids.map((id) => ({ id, v: plan.venues[id] ?? change.venues?.[id] ?? (id === change.id ? change.venue : null) })).filter(({ v }) => v && Number.isFinite(+v.lat))
        .map(({ id, v }) => { const { contact, added, date: _, ...vv } = { ...v, lat: +v.lat, lon: +v.lon, id }; return vv; });
      if (!vs.length) return null;
      const others = (st.added ?? []).filter((x) => !ids.includes(x.id));
      const base = { statuses: Object.fromEntries(Object.entries(st.statuses ?? {}).filter(([k]) => !ids.includes(k))), parked: unparkIds(st.parked, ids) };
      if (vs.length === 1) {
        const vv = vs[0];
        const trials = [];
        for (const dt of change.date ? [change.date] : [...new Set(plan.days.filter((d) => !d.past && !d.frozen).map((d) => d.date))]) trials.push({ date: dt, plan: (await compute({ added: [...others, { ...vv, date: dt }], base })).p });
        const date = bestAddDay(trials, vv.id, { rank: (id) => plan.pool.ids.indexOf(id) + 1 || null });
        const t = trials.find((x) => x.date === date);
        if (!t) return { error: notAddedText(trials.at(-1)?.plan ?? plan, vv.id, { day: change.date ? plan.days.find((d) => d.date === change.date)?.day : null, name: vv.name, onList: plan.pool.ids.includes(vv.id) }) }; // no day can hold it: say why (as addDoor's toast)
        r = { p: t.plan, pool: { ids: plan.pool.ids, venues: plan.venues }, date, dates: { [vv.id]: date } };
      } else {
        const p = (await compute({ added: [...others, ...vs.map((v) => ({ ...v, date: null }))], base })).p;
        r = { p, pool: { ids: plan.pool.ids, venues: plan.venues }, dates: Object.fromEntries(vs.map((v) => [v.id, p.days.find((d) => d.stops.some((x) => x.id === v.id))?.date ?? null])) };
      }
    } else if (change.kind === "profile") {
      // round 4 #6: a Settings form's profile; other brands or pours mean other drinker lists (fetched, or a live run's
      // files already on this device: ui/app.js sends a profile that needs a run down the plain save path instead)
      r = await compute({ prof: profileWith(profile, change), rts: await routesFor(change.profile) });
    } else {
      const fam = famousOf(change); // a famous switch, alone or inside a set (WHY-VIZ-SPEC §4.1)
      r = await compute({ prof: profileWith(profile, change), base: fam !== null ? { famous: !!fam } : null });
    }
    if (dead || my !== seq || !r) return null;
    const names = { ...drinkNames(), ...Object.fromEntries((change.ids ?? [change.id]).filter(Boolean).map((id) => [id, plan.venues[id]?.name ?? change.venues?.[id]?.name ?? change.venue?.name])) };
    const diff = planDiff(plan, r.p, { prevPool: plan.pool.ids, nextPool: r.pool.ids });
    return { change, text: changeText(change, { profile, names }), diff, said: diffText(diff), plan: r.p, pool: r.pool.ids, venues: { ...plan.venues, ...(r.pool.venues ?? {}) }, date: r.date ?? null, dates: r.dates ?? null };
  }
  // applyChange(change): make it for real, log it in Changes you made (st.whyChanges), flash what it did with Undo.
  async function applyChange(change) {
    if (!plan) return false;
    if (change.kind === "set") return applySet(change);
    if (change.kind === "famous") return setFamous(!!change.on), true;
    if (change.kind === "add" && change.ids) return addDoors(change.ids.map((id) => ({ venue: plan.venues[id] ?? change.venues?.[id] ?? null, date: change.dates?.[id] ?? null })));
    if (change.kind === "add") return !!(await addDoor(plan.venues[change.id] ?? change.venue, { date: change.date ?? null }));
    const before = plan, beforeIds = plan.pool.ids, from = fieldOf(profile, change);
    const text = changeText(change, { profile, names: drinkNames() });
    if (change.kind === "profile") await takeProfile(profileWith(profile, change)); else Object.assign(profile, profileWith(profile, change));
    st = store.update(brand, c.key, (x) => ({ ...x, profile, whyChanges: [...(x.whyChanges ?? []).filter((e) => !(e.kind === change.kind && (e.key ?? null) === (change.key ?? null))), { id: `w${Date.now()}`, kind: change.kind, key: change.key ?? null, text, from: (x.whyChanges ?? []).find((e) => e.kind === change.kind && (e.key ?? null) === (change.key ?? null))?.from ?? from, change }] }));
    onProfile(profile);
    await replan();
    const entry = st.whyChanges.at(-1);
    flash(`${text}. ${diffText(planDiff(before, plan, { prevPool: beforeIds, nextPool: plan.pool.ids }))}`, () => undoWhyChange(entry.id));
    return true;
  }
  // applySet(set): the explorer's controls applied together (WHY-VIZ-SPEC §4.1): every field change logged in Changes
  // you made with its own Undo, the famous switch flipped with them, one re-plan, one flash whose Undo puts all back.
  async function applySet(set) {
    const subs = set.changes.filter((c) => !sameAs(profile, !!st.famous, c));
    if (!subs.length) return false;
    const fam = famousOf({ kind: "set", changes: subs });
    const fields = fieldChanges({ kind: "set", changes: subs });
    if (!fields.length) return setFamous(!!fam), true;
    const before = plan, beforeIds = plan.pool.ids, famousBefore = !!st.famous;
    const names = drinkNames();
    const text = changeText({ kind: "set", changes: subs }, { profile, names });
    const entries = fields.map((c, k) => ({ id: `w${Date.now()}${k}`, kind: c.kind, key: c.key ?? null, text: changeText(c, { profile, names }), from: (st.whyChanges ?? []).find((e) => e.kind === c.kind && (e.key ?? null) === (c.key ?? null))?.from ?? fieldOf(profile, c), change: c }));
    Object.assign(profile, profileWith(profile, { kind: "set", changes: fields }));
    st = store.update(brand, c.key, (x) => ({ ...x, profile, famous: fam === null ? x.famous : !!fam, whyChanges: [...(x.whyChanges ?? []).filter((e) => !entries.some((n) => n.kind === e.kind && (n.key ?? null) === (e.key ?? null))), ...entries] }));
    onProfile(profile);
    await replan();
    flash(`${text}. ${diffText(planDiff(before, plan, { prevPool: beforeIds, nextPool: plan.pool.ids }))}`, async () => {
      for (const e of entries) { const back = undoOf(e.change, e.from); if (back) Object.assign(profile, profileWith(profile, back)); }
      st = store.update(brand, c.key, (x) => ({ ...x, profile, famous: famousBefore, whyChanges: (x.whyChanges ?? []).filter((y) => !entries.some((e) => e.id === y.id)) }));
      onProfile(profile);
      await replan();
      flash(`Undone: ${text[0].toLowerCase()}${text.slice(1)}.`);
    });
    return true;
  }
  // addDoors(items): lane 2's thread panel (WHY-VIZ-SPEC §4.5 "Add all"): several doors at once, each on the day the
  // preview put it on (date null: the planner picks), one re-plan, one toast, one Undo. A door no day can hold is not
  // added (as addDoor); the toast says which.
  async function addDoors(items) {
    if (!plan || !items?.length) return false;
    const vs = items.map(({ venue, date }) => { const v0 = venue?.id != null ? plan.venues[venue.id] ?? venue : null; if (!v0 || !Number.isFinite(+v0.lat) || !Number.isFinite(+v0.lon)) return null; const { contact, added, date: _, ...v } = { ...v0, lat: +v0.lat, lon: +v0.lon }; return { ...v, date: date ?? null }; }).filter(Boolean);
    if (!vs.length) return false;
    const before = { plan, known: [...(profile.known ?? [])], st: { statuses: st.statuses, current: st.current, plan: st.plan, carriedNotes: st.carriedNotes, added: st.added, parked: st.parked ?? [] } };
    const ids = vs.map((v) => v.id);
    const others = (st.added ?? []).filter((x) => !ids.includes(x.id));
    st = store.update(brand, c.key, { added: [...others, ...vs], parked: unparkIds(st.parked, ids) });
    for (const id of ids) if (st.statuses[id]) st = store.setStatus(brand, c.key, id, null);
    await replan();
    if (dead) return false;
    const on = ids.filter((id) => dayHolding(plan, id) >= 0), off = ids.filter((id) => !on.includes(id));
    const name = (id) => vs.find((v) => v.id === id)?.name ?? "a door";
    if (!on.length) { restore(before); flash(`Doors couldn't place ${off.map(name).join(", ")}: no day you're out can hold ${off.length === 1 ? "it" : "them"}.`); return false; }
    if (off.length) { st = store.update(brand, c.key, { added: st.added.filter((x) => !off.includes(x.id)) }); await replan(); if (dead) return false; }
    fitted = null;
    const dayOf = (id) => plan.days[dayHolding(plan, id)]?.day.replace(/^./, (ch) => ch.toUpperCase());
    flash(`${on.length === 1 ? `Added ${name(on[0])} to ${dayOf(on[0])}.` : `Added ${on.length} doors: ${on.map((id) => `${name(id)} on ${dayOf(id)}`).join(", ")}.`}${off.length ? ` Couldn't place ${off.map(name).join(", ")}.` : ""}`, () => restore(before));
    return true;
  }
  // round 4 #6: the plan's profile replaced by one a Settings form saved (Apply) or put back (Undo): keys it no longer
  // holds go too; other brands or pours load their lists (cached: the preview loaded them); the heat map follows; the
  // brand's fields, when they changed, go to the other cities (onBrand: ui/app.js saveBrand)
  const sameFiles = (a, b) => routeFiles(a, index).join() === routeFiles(b, index).join();
  const routesFor = async (next) => (sameFiles(profile, next) ? routes : loadRoutes(next, index));
  async function takeProfile(next) {
    const rts = await routesFor(next);
    const brandMoved = brandDiffers(profile, next);
    for (const k of Object.keys(profile)) if (!(k in next)) delete profile[k];
    Object.assign(profile, next);
    if (rts !== routes) { routes = rts; hoods = heatFor(heatJson, routes, c.key); }
    if (brandMoved) onBrand?.(structuredClone(next));
  }
  // undoWhyChange(id): put that change's field back as it was before the rep first changed it, and re-plan.
  async function undoWhyChange(id) {
    const e = (st.whyChanges ?? []).find((x) => x.id === id);
    if (!e) return false;
    const back = undoOf(e.change, e.from);
    if (back?.kind === "profile") await takeProfile(back.profile);
    else if (back) Object.assign(profile, profileWith(profile, back));
    st = store.update(brand, c.key, (x) => ({ ...x, profile, whyChanges: (x.whyChanges ?? []).filter((y) => y.id !== id) }));
    onProfile(profile);
    await replan();
    flash(`Undone: ${e.text.replace(/^./, (ch) => ch.toLowerCase())}.`);
    return true;
  }
  // ---- round 4 #6: a Settings form's change (ui/app.js pending) ----
  // The tray at the top of the list: what changed (lib/settings.js words), what it does to the plan (previewChange on a
  // scratch copy, nothing saved), Apply (applyChange: Changes you made, a toast with Undo) or keep the old settings.
  // A change that can't touch the plan (the ask, your name, the pitch) applies at once, with the same Undo.
  const PLAN_FIELDS = new Set(["drinks", "pours", "rooms", "drinkers", "start", "windows", "visit", "cap", "known"]);
  async function showPending({ profile: next, text }) {
    const tray = $("#p-pending", root);
    const changes = profileChanges(profile, next, index);
    if (!changes.length) return void flash("Nothing changed in your settings.");
    const change = { kind: "profile", profile: next, text: text || changes.map((x) => `${x.label}: ${x.to}`).join("; "), key: `p${Date.now()}` };
    const what = `<ul class="pend-list">${changes.map((x) => `<li><b>${esc(x.label)}:</b> ${esc(x.to)} <span class="muted">(was ${esc(x.from)})</span></li>`).join("")}</ul>`;
    if (!changes.some((x) => PLAN_FIELDS.has(x.field))) { await applyChange(change); return; }
    const show = (body, acts) => { tray.innerHTML = `<div class="pend-h"><b>Your new settings</b> <span class="muted small">Not applied yet.</span></div>${what}<div class="pend-what" role="status">${body}</div><div class="pend-acts">${acts}</div>`; tray.hidden = false; };
    const keepBtn = `<button type="button" class="btn sm line" data-pend="keep">Keep the old settings</button>`;
    show(`Checking what this does to your plan…`, `<button type="button" class="btn sm primary" disabled>Apply to my plan</button>${keepBtn}`);
    let r = null, err = null;
    try { r = await previewChange(change); } catch (e) { err = e; }
    if (dead) return;
    if (!r || r.error || err) show(esc(err ? unreachable(err).message ?? "Doors couldn't load the doors for these brands. Check you're online, then try again." : r?.error ?? "Doors couldn't check this change."), `<button type="button" class="btn sm primary" data-pend="retry">Try again</button>${keepBtn}`);
    else show(`If you apply: ${esc(r.said || "your plan keeps the same doors on the same days.")}`, `<button type="button" class="btn sm primary" data-pend="apply">Apply to my plan</button>${keepBtn}`);
    tray.onclick = async (e) => {
      const act = e.target.closest("[data-pend]")?.dataset.pend;
      if (!act) return;
      if (act === "retry") return void showPending({ profile: next, text });
      tray.hidden = true;
      tray.innerHTML = "";
      if (act === "apply") await applyChange(change);
      else flash("Your settings are as they were.");
    };
  }
  // ---- end r2viz ----
  S.register({ setStatus, setOutcome, selectDay, addDoor, setLock, moveStop, skipStop, setSlot, setLater, snapshot, restore: restoreSnapshot, setTalk, agentReplan, whatIfFirst, previewChange, applyChange, undoWhyChange, setDrive, removeStop, removeDoor, skipDoors, endDay, rollDay, lateFits, moveLate, lateRehome, undoDayChange, editTo: () => editTo });

  // ---------- layout ----------
  root.innerHTML = `
  <div class="route">
    <section class="rcol" aria-label="Your plan">
      <div class="daytabs" role="tablist" aria-label="What the list shows"></div>
      <div class="pending" id="p-pending" hidden></div><!-- round 4 #6: a Settings change to try -->
      <div class="notices" id="p-notices"></div>
      <div class="offline-note" id="p-offline" role="status" hidden>You're offline. Your plan still works on this device; miles are estimated until you're back online.</div>
      <div id="p-body" role="tabpanel"></div>
      <div class="rfoot" id="p-foot"></div>
      <div class="drawer" id="why" hidden></div>
      <div class="drawer lbp" id="logbook" role="dialog" aria-label="${esc(LOGBOOK_LABEL)}" hidden></div><!-- round 4 item 10: ui/logbook.js -->
    </section>
    <div class="mapwrap"><div class="m" id="plan-map" role="region" aria-label="Map of your plan">
      <div class="hoodkey" id="p-hoods"><!-- round 5 #2b (Jard 10-27: the neighbourhood map was only under All days → See it on the map). Inside the map's box so it rides along into full screen (map.js) -->
        <!-- round 8 (Jard 10-28: "a little semi transparent doors logo with a caret that we can collapse these options into"): the map's layer toggles live under one small button, shut by default so the map is quiet -->
        <button type="button" class="layersbtn" id="t-layers" aria-expanded="false" aria-haspopup="true" aria-controls="p-layers" aria-label="Map layers" title="Map layers"><i class="dlogo"></i><b class="caret"></b></button>
        <div class="layers" id="p-layers" hidden>
          <button type="button" class="hoodbtn" id="t-hoods" aria-pressed="false" title="Colour the map by who goes out in each part of town"><i></i><span class="lbl" data-l="Neighbourhoods">Neighbourhoods</span></button>
          <button type="button" class="hoodbtn othersbtn" id="t-others" aria-pressed="${layers.others}" title="Show the other days' routes and pins, faded, behind this day's" hidden><i></i><span class="lbl" data-l="Other days">Other days</span></button><!-- round 8 (Jard 10-28): hide the faded other days -->
        </div>
        <span class="hoodleg" id="p-hoodleg" hidden></span>
      </div>
    </div>
      <div class="rpop pcard" id="p-card" role="dialog" aria-label="Ranked door" hidden></div>
      <div class="weeklegend" id="p-weeklegend" hidden></div>
      <div class="tools" role="toolbar" aria-label="Plan tools">
        <button class="btn sm drive-start" id="t-drive" data-drive-start>Start my day</button>
        <button class="btn sm" data-drawer="why" aria-expanded="false" aria-controls="why">${esc(BASIS_BUTTON)}</button>
        <button class="btn sm" data-drawer="logbook" aria-expanded="false" aria-controls="logbook">${esc(LOGBOOK_LABEL)}</button><!-- round 6 #5 (Jard 10-27): a main button of the bar, out of the Menu -->
        <button class="btn sm menu-btn" id="t-menu" data-drawer="menu" aria-expanded="false" aria-controls="menu" aria-haspopup="true" aria-label="Menu: Home, Export, Settings, Privacy">${icon("menu", 18)}<span class="lbl">Menu</span></button>
      </div>
      <div class="drawer menu-pop" id="menu" aria-label="Menu" hidden>
        <a class="mi" href="/?home=1"><b>Home</b><span>Watch the tour</span></a><!-- group 3 #5: Your plans and New profile went; your cities are in Settings -->
        <button type="button" class="mi" data-drawer="export" aria-expanded="false" aria-controls="export"><b>Export</b><span>The plan as CSV, the drafted messages, the call sheet</span></button>
        <button type="button" class="mi" id="t-settings" data-drawer="settings" aria-expanded="false" aria-controls="settings"><b>Settings</b><span>Your brand, your cities, navigation app</span></button>
        <button type="button" class="mi" id="t-homescreen" data-drawer="homescreen" aria-expanded="false" aria-controls="homescreen" hidden><b>Add to Home Screen</b><span></span></button><!-- round 8 (Jard 10-28): an iPhone or iPad in a browser tab (ui/carry.js status); the drive-mode strip went -->
        <a class="mi" href="/privacy" target="_blank" rel="noopener"><b>Privacy</b><span>Saved on this device only. What Doors sends, and to whom</span></a>
      </div>
      <button type="button" class="btn ask" data-agent="open" aria-expanded="false" aria-controls="agentPanel" aria-label="Doors Agent" title="Doors Agent">${icon("agent", 28)}<span class="lbl">Agent</span></button><!-- R9 chat agent; the one Agent on the plan (Jard 10-23). Round 6 #4 (Jard 10-27): a round button at the screen's bottom right at every width, as the phone's AskFab, never in the top bar (css/doors.css .mapwrap .btn.ask) -->
      <div class="drawer" id="settings" role="dialog" aria-label="Settings" hidden></div>
      <div class="drawer" id="export" role="dialog" aria-label="Export" hidden></div>
      <div class="drawer" id="homescreen" role="dialog" aria-label="Add to Home Screen" hidden></div>
      <div class="maptip" id="p-maptip" hidden></div>
      <div class="legend" id="p-legend"></div>
      <div class="toast" id="p-toast" role="status" hidden></div>
    </div>
  </div>`;
  // Jard 10-23 #8: on a wide screen the toolbar sits in the app's header (doors.css .app:has(.route .tools)); the header keeps
  // its brand line clear of it
  const toolsEl = $(".tools", root);
  const dockTools = () => document.documentElement.style.setProperty("--tools-w", `${toolsEl.offsetWidth}px`);
  requestAnimationFrame(dockTools);
  window.addEventListener("resize", dockTools);
  const tabs = $(".daytabs", root);
  const body = $("#p-body", root);
  const unmountStop = mountStop($(".rcol", root)); // C1
  const unmountAgent = mountAgent(root, { demo: Boolean(demo) }); // R9 chat agent; the tour keeps its own chat

  const flash = (text, undo) => {
    const t = $("#p-toast", root);
    t.innerHTML = `<span>${esc(text)}</span>${undo ? `<button type="button" class="lnk" data-undo>Undo</button>` : ""}`;
    t.hidden = false;
    // above the map's legend (the week's day chips, the day's key), never on top of it (judge pass 2); a phone's toast
    // is docked to the screen's bottom and its legend sits at the map's top
    const legs = [...root.querySelectorAll(".mapwrap .weeklegend, .mapwrap .legend")].filter((e) => !e.hidden && e.getClientRects().length && getComputedStyle(e).display !== "none");
    t.style.bottom = !matchMedia("(max-width:700px)").matches && legs.length ? `${Math.round(t.parentElement.getBoundingClientRect().bottom - Math.min(...legs.map((e) => e.getBoundingClientRect().top)) + 10)}px` : "";
    flash.undo = undo ?? null;
    clearTimeout(flash.t);
    flash.t = setTimeout(() => ((t.hidden = true), (flash.undo = null)), undo ? 9000 : 5000);
  };
  $("#p-toast", root).addEventListener("click", (e) => {
    if (!e.target.closest("[data-undo]") || !flash.undo) return;
    const u = flash.undo;
    flash.undo = null;
    $("#p-toast", root).hidden = true;
    u();
  });

  // ---------- drawing ----------
  function draw() {
    if (!plan) return;
    root.querySelector(".mapwrap")?.classList.toggle("is-week", sel === "week"); // R2 L9: no single-day miles chip over the week
    drawTabs();
    drawNotices();
    if (view === "add") drawAdd();
    else if (sel === "week") drawWeek();
    else if (sel === "rest") drawRest();
    else drawDay(plan.days[sel], sel);
    drawFoot();
    drawMap();
    drawDriveBtn();
    if ($("#why", root).hidden === false) drawWhy();
    if ($("#logbook", root).hidden === false) drawLog();
  }

  // persona (founder): a 9-day plan had three tabs reading "Tue · 8 doors"; each says its date ("Tue 27 · 8 doors")
  function drawTabs() {
    const tab = (t, on, label, title, cls = "") => `<button type="button" role="tab" aria-selected="${sel === t}" tabindex="${sel === t ? 0 : -1}" aria-controls="p-body" data-tab="${t}"${cls}${on ? "" : ' data-off=""'} title="${title}">${label}</button>`;
    const off = " (its route is hidden on the map)";
    // intuit audit 1b #4: at a phone width the days scroll in a row of their own and Your list / All days sit on the
    // row under it, always in view (they were off-screen right at 320–390 px); elsewhere .dtdays is display:contents
    // round 4 item 3 (Jard 10-27: "there's no way to scroll and see the rest of these without clicking to reposition
    // the days"): at a desktop width an arrow button sits at each edge that has more past it (sticky, over a paper
    // fade); the strip also scrolls on the wheel and by dragging it (below). Both hidden at a phone width: the days'
    // row swipes
    const arrow = (side, label) => `<button type="button" class="tarr ${side}" aria-label="${label}" title="${label}" tabindex="-1">${CHEVRON}</button>`;
    tabs.innerHTML = arrow("l", "Scroll the tabs left") +
      `<span class="dtdays" role="presentation">${plan.days.map((d, i) => tab(i, layers.days.has(i), `<i style="background:${colour(i)}"></i>${dayShort(d)} ${+d.date.slice(8)}<span class="dn"> · ${doors(d.stops.length)}</span>`, `${esc(niceDate(d.date))}, ${esc(rangeText(d.from, d.to))}${layers.days.has(i) ? "" : off}`)).join("")}</span>` +
      tab("rest", true, `Your list<span class="dn"> · ${plan.pool.N}</span>`, "Every ranked door, best first; the map shows the ones not on a day") +
      (plan.days.length > 1 ? tab("week", true, "All days", "Every day's route", ' class="wk"') : "") +
      arrow("r", "Scroll the tabs right");
    if (!tabs.querySelector('[aria-selected="true"]')) tabs.querySelector("[data-tab]")?.setAttribute("tabindex", "0"); // the add view: still one stop in the Tab order
    // one scrolling row at a desktop width (doors.css): the chosen tab in view, a fade where there is more
    const on = tabs.querySelector('[aria-selected="true"]');
    const sc = scroller();
    if (on && sc.contains(on) && sc.scrollWidth > sc.clientWidth) sc.scrollLeft = Math.max(0, Math.min(on.offsetLeft - sc.clientWidth / 2 + on.offsetWidth / 2, sc.scrollWidth - sc.clientWidth));
    tabEdges();
  }
  // the row that scrolls: the days' own row at a phone width, else the whole tab row
  const scroller = () => { const d = tabs.querySelector(".dtdays"); return d && getComputedStyle(d).display !== "contents" ? d : tabs; };
  function tabEdges() {
    for (const el of [tabs, tabs.querySelector(".dtdays")].filter(Boolean)) {
      const more = el === scroller() && el.scrollWidth - el.clientWidth > 1;
      el.classList.toggle("more-l", more && el.scrollLeft > 1);
      el.classList.toggle("more-r", more && el.scrollLeft < el.scrollWidth - el.clientWidth - 1);
    }
  }
  tabs.addEventListener("scroll", tabEdges, { passive: true, capture: true });
  window.addEventListener("resize", tabEdges);
  // round 4 item 3: the arrows scroll the strip by most of its width; the wheel scrolls it sideways while there is more
  // that way (else the page scrolls as usual); a mouse or pen drags it (a drag of 5 px or more is not a click)
  tabs.addEventListener("click", (e) => {
    const a = e.target.closest(".tarr");
    if (a) scroller().scrollBy({ left: (a.classList.contains("l") ? -1 : 1) * Math.max(120, scroller().clientWidth * 0.7), behavior: "smooth" });
    else if (strip.dragged) { strip.dragged = false; e.stopImmediatePropagation(); e.preventDefault(); }
  }, { capture: true });
  tabs.addEventListener("wheel", (e) => {
    const sc = scroller();
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? 0 : e.deltaY;
    if (!d || sc.scrollWidth - sc.clientWidth <= 1) return;
    const max = sc.scrollWidth - sc.clientWidth;
    if ((d < 0 && sc.scrollLeft <= 0) || (d > 0 && sc.scrollLeft >= max - 1)) return;
    e.preventDefault();
    sc.scrollLeft += d;
  }, { passive: false });
  const strip = { down: null, dragged: false };
  tabs.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "touch" || e.button > 0 || e.target.closest(".tarr")) return;
    const sc = scroller();
    if (sc.scrollWidth - sc.clientWidth <= 1) return;
    strip.down = { x: e.clientX, left: sc.scrollLeft, sc, id: e.pointerId };
    strip.dragged = false;
  });
  const stripMove = (e) => {
    const d = strip.down;
    if (!d || e.pointerId !== d.id) return;
    const dx = e.clientX - d.x;
    if (!strip.dragged && Math.abs(dx) < 5) return;
    strip.dragged = true;
    tabs.classList.add("is-scrolling");
    d.sc.scrollLeft = d.left - dx;
  };
  const stripUp = (e) => {
    if (!strip.down || e.pointerId !== strip.down.id) return;
    strip.down = null;
    tabs.classList.remove("is-scrolling");
    setTimeout(() => { strip.dragged = false; }, 0); // the drag's own click (if any) comes before this; the next click is a click
  };
  window.addEventListener("pointermove", stripMove);
  window.addEventListener("pointerup", stripUp);
  window.addEventListener("pointercancel", stripUp);
  const tabValue = (t) => (t === "rest" || t === "week" ? t : Number(t));
  tabs.addEventListener("click", (e) => {
    const b = e.target.closest("[data-tab]");
    if (!b) return;
    const t = tabValue(b.dataset.tab);
    if (t !== sel || view !== "list" || t === "week") selectDay(t); // the list's own tab does nothing; Week again shows every day again
  });
  // tabs keyboard: arrows / Home / End move along the row and show that tab (automatic activation)
  tabs.addEventListener("keydown", (e) => {
    const all = [...tabs.querySelectorAll("[data-tab]")];
    const k = all.indexOf(e.target.closest("[data-tab]"));
    const to = { ArrowRight: k + 1, ArrowLeft: k - 1, Home: 0, End: all.length - 1 }[e.key];
    if (k < 0 || to === undefined) return;
    e.preventDefault();
    const b = all[(to + all.length) % all.length];
    selectDay(tabValue(b.dataset.tab));
    tabs.querySelector(`[data-tab="${b.dataset.tab}"]`)?.focus();
  });

  function drawNotices() {
    const dismissed = new Set(st.dismissed ?? []);
    const carried = Object.values(st.carriedNotes ?? {}).filter((n) => !dismissed.has(n.from));
    // fix5-res: what Qloo didn't answer on this plan's live run (route.gaps), only when something is missing
    const gapLine = gapsNote(routes);
    $("#p-notices", root).innerHTML = (gapLine ? `<div class="notice" data-gaps role="status"><span>${esc(gapLine)}</span></div>` : "") + carried
      .map((n) => `<div class="notice" data-from="${esc(n.from)}"><span>${esc(carryText(n.text, n.ids.map((id) => plan.venues[id]?.name).filter(Boolean).join(", ")))}</span><button class="x" aria-label="Dismiss">×</button></div>`)
      .join("");
  }
  $("#p-notices", root).addEventListener("click", (e) => {
    const n = e.target.closest(".x") && e.target.closest("[data-from]");
    if (!n) return;
    st = store.update(brand, c.key, (s) => ({ ...s, dismissed: [...(s.dismissed ?? []), n.dataset.from] }));
    drawNotices();
  });

  const tags = (id, s) => {
    const v = plan.venues[id] ?? {};
    const o = plan.outcomes?.[id];
    return [
      v.contact ? `<span class="tg c">My contact</span>` : "",
      v.added ? `<span class="tg c">Added by you</span>` : "",
      plan.later?.[id] ? `<span class="tg sv">Saved for later</span>` : "", // Log book: Save for later
      s?.carried ? `<span class="tg">carried over</span>` : "",
      justOpenedTag(s) && !plan.statuses[id] ? `<span class="tg">${esc(justOpenedTag(s))}</span>` : "", // persona (founder); judge 6 #3: says when it opened
      plan.statuses[id] && !(plan.statuses[id] === "visited" && o?.result) ? `<span class="tg st-${plan.statuses[id]}">${statusLabel(plan.statuses[id])}</span>` : "",
      ...outcomeTags(o).map((t) => `<span class="tg ${t.cls}">${t.ic ? icon(t.ic, 12, "ic l") : ""}${esc(t.label)}</span>`), // C1: Interested, Follow up Thu 15 (judge 12 #5: icons, not ✓ ↻)
    ].join("");
  };
  const hoursOf = (id) => {
    if (!parsedCache.has(id)) parsedCache.set(id, parseHours(plan.venues[id]?.hours));
    return parsedCache.get(id);
  };
  // J3: a day's cap in force (the day being worked is never capped, J1). ease #13: the cap is set in Edit profile
  // ("Most doors a day"), not on the plan
  const capSet = (d) => plan.windows?.find((w) => w.date === d.date)?.max ?? null;
  const capIn = (d) => (d.past || d.frozen ? null : capSet(d));
  const doorsOf = (d) => (capIn(d) ? `${d.stops.length} of up to ${capIn(d)} doors` : `${doors(d.stops.length)}${d.frozen && !d.past && capSet(d) ? (d.begun === false ? " (kept as planned: no limit)" : " (under way: no limit)") : ""}`);
  const rankText = (id) => rankLabel(plan, id); // "#3 of 55 on Your list"
  // a row's kind and why the door is worth a stop (ease audit #6: "Crowd: local residents and couples · Serves NA", not "Qloo rank #9 of 55"; the rank stays on Your list's pins and in Why this door), wrapping only between
  // its phrases (the crowd's words wrap: a no-wrap span ran under the time and ⋯)
  const subHTML = (id, v) => (v.source === "manual" ? "Added by you" : [cap(genreLabel(v)) || "Bar or restaurant", ...(doorReason(plan, id) ? doorReason(plan, id).split(" · ") : [])].map((t) => `<span${/^Crowd: /.test(t) ? "" : ' class="nw"'}>${esc(t)}</span>`).join(" · "));
  // mv (a stop that can move, G4): {d, i, k, s} adds move up / down, to another day ahead, lock / unlock
  const menuHTML = (id, mv = null) => {
    const v = plan.venues[id] ?? {};
    const s = plan.statuses[id];
    const moves = mv
      ? `<hr>${mv.k > lead(mv.d) ? `<button role="menuitem" data-move="${mv.i}:${mv.k - 1}">Move up</button>` : ""}${mv.k < mv.d.stops.length - 1 ? `<button role="menuitem" data-move="${mv.i}:${mv.k + 1}">Move down</button>` : ""}${plan.days
          .map((d, j) => (j === mv.i || d.past ? "" : `<button role="menuitem" data-move="${j}:">Move to ${esc(dayLabel(plan.days, d))}</button>`))
          .join("")}<button role="menuitem" data-lock="${mv.s.locked ? "off" : "on"}">${mv.s.locked ? "Unlock: let Doors place it" : "Lock it here"}</button>`
      : "";
    return `<button class="more" aria-haspopup="menu" aria-expanded="false" aria-label="Mark ${esc(v.name)}">${icon("more", 18)}</button>
      <div class="menu" role="menu" hidden>
        ${Object.entries(STATUS).map(([k, t]) => `<button role="menuitem" data-act="${k}"${s === k ? ' aria-current="true"' : ""}>${t}</button>`).join("")}
        <button role="menuitem" data-act="undo"${s ? "" : " disabled"}>Undo</button>
        <button role="menuitem" data-act="later">${plan.later?.[id] ? "Remove from Saved for later" : "Save for later"}</button>
        ${v.contact ? `<button role="menuitem" data-act="remove">Remove my contact</button>` : ""}${moves}
        ${v.added ? `<button role="menuitem" data-act="unadd">Remove from my plan</button>` : ""}
      </div>`;
  };

  // the room's own site, a small link on its row (owner review 2); none when Qloo has no http(s) website. Jard 10-23: it
  // sits on the row's second line (.ln2), after the hours, not glued to the end of the rank words
  const webLink = (v) => (/^https?:\/\//i.test(v.website ?? "") ? `<a class="wlink" href="${esc(v.website)}" target="_blank" rel="noopener" aria-label="${esc(v.name ?? "")} website (opens in a new tab)">Website ↗</a>` : "");

  // a row's second line: when it's open ("open till 2 am", in warning colour when it's closed at arrival) · Website ↗.
  // Jard 10-23: the hours sat in the time column and squeezed the row's words into three ragged lines
  const line2 = (hours, v, warn = false) => {
    const parts = [hours ? `<span${warn ? ' class="warn"' : ""}>${esc(hours)}</span>` : "", webLink(v)].filter(Boolean);
    return parts.length ? `<div class="ln2">${parts.join(" · ")}</div>` : "";
  };
  function stopsHTML(d, i, { compact = false } = {}) {
    return d.stops
      .map((s, k) => {
        const v = plan.venues[s.id] ?? {};
        const done = plan.statuses[s.id] === "visited" && !isReturnVisit(s, d, plan.outcomes?.[s.id]);
        const lv = k === 0 && leaveText(d) ? ` · leave ${clock12(d.leave)}` : "";
        const mv = movable(d, s);
        return `${compact ? "" : `<li class="leg">${legText(s)}${lv}</li>`}
        <li class="stop${done ? " visited" : ""}${focusId === s.id ? " sel" : ""}${s.locked ? " locked" : ""}" data-id="${esc(s.id)}" data-day="${i}" data-k="${k}">
          ${mv ? `<button type="button" class="grip" aria-label="Move ${esc(v.name ?? "this stop")}: drag it, or use the arrow keys" title="Drag to move. It stays where you put it.">${icon("grip", 16)}</button>` : `<span class="grip off" aria-hidden="true"></span>`}
          <div class="pin" style="background:${done ? "var(--done)" : colour(i)}" aria-hidden="true">${done ? "✓" : k + 1}</div>
          <div class="body"><button class="nm" data-open>${esc(v.name ?? s.id)}${branchHTML(v)}</button>
            <div class="sb">${subHTML(s.id, v)}</div>
            ${line2(s.openAtArrival !== false && orderReason(s) ? orderReason(s) : openTill(s, { parsed: hoursOf(s.id), day: d.day }), v, s.openAtArrival === false)}
            <div class="tgs">${s.locked && mv ? `<button type="button" class="tg lk" data-unlock aria-label="Unlock ${esc(v.name ?? "this stop")}: let Doors place it" title="Unlock: let Doors place it">${icon("lock", 13, "ic l")}${s.lockDay ? `you put it on ${esc(cap(d.day))}` : `you put it ${k === 0 ? "first" : "here"}`}</button>` : ""}${rerouted.has(s.id) ? `<span class="tg rr">re-routed</span>` : ""}${tags(s.id, s)}</div></div>
          <div class="eta">${clock12(s.eta)}</div>
          ${menuHTML(s.id, mv ? { d, i, k, s } : null)}
        </li>`;
      })
      .join("");
  }

  function drawDay(d, i) {
    if (!d) return void (body.innerHTML = `<div class="empty">No days in your profile. <a href="${editTo}">${editWord(editTo)}</a></div>`);
    const visited = d.stops.filter((s) => plan.statuses[s.id] === "visited" && !isReturnVisit(s, d, plan.outcomes?.[s.id])).length;
    const mi = miText(d);
    const leave = leaveText(d, startName(d.start));
    const meta = d.stops.length ? `${doorsOf(d)} · ${mi} · ${clock12(d.stops[0].eta)}–${clock12(d.end)}${visited ? ` · ${visited} visited` : ""}${leave ? ` · ${leave}` : ""}` : d.past ? "This window has ended." : "No door fits this window.";
    const empty = d.past
      ? `<li class="empty">This window has ended${d.stops.length ? "" : " with no door checked off"}. Doors you didn't reach moved to your next days.</li>`
      : Object.values(plan.reasons ?? {}).some((r) => r?.date === d.date)
        // persona (founder): "nothing is open" was said while rooms open that day sat on Your list; it says why now
        ? `<li class="empty">Doors left ${esc(cap(d.day))} empty: the doors open then are on your other days, or a long drive from the rest (Your list says how far, and + Add to a day puts one on it). <a href="${editTo}">${editWord(editTo)}</a></li>`
        : `<li class="empty">Nothing on your list is open for ${profile.visitMin} minutes between ${esc(rangeText(d.from, d.to))} on ${esc(cap(d.day))}. <a href="${editTo}">${editWord(editTo)}</a></li>`;
    body.innerHTML = `
      <div class="rhead"><h2>${esc(dayLabel(plan.days, d))} in ${esc(c.name)}${d.past ? ' <span class="muted small">(ended)</span>' : ""}</h2>
        <div class="meta">${meta}</div>${d.area ? `<div class="meta weeks">${esc(areaName(d.stops, plan.venues, d.start, c.name))} day: the doors left on Your list out this way, grouped into one drive.</div>` : ""}
        <div class="prog" role="progressbar" aria-valuemin="0" aria-valuemax="${d.stops.length}" aria-valuenow="${visited}" aria-label="Doors visited"><i style="width:${d.stops.length ? (100 * visited) / d.stops.length : 0}%"></i></div>
        <div class="progtxt">${esc(progressLine(d, visited))}</div></div>
      ${planNotes(d)}
      <ul class="stops dnd" aria-label="${esc(cap(d.day))}'s stops">${d.stops.length ? stopsHTML(d, i) : empty}</ul>
      <div class="addbar"><button class="btn line sm" data-add>+ Add a door</button></div>`;
  }

  // the plan over weeks (the usual week, lib/week.js): "Week of Oct 26: 18 doors · … · 12 left on Your list"; "" for one week
  const leftOnList = () => unscheduledIds(plan).filter((id) => !plan.statuses?.[id]).length;
  const weeksMeta = () => { const w = weeksLine(plan.days, leftOnList()); return w ? `<div class="meta weeks">${esc(w)}</div>` : ""; };
  function drawWeek() {
    const ws = weeksOf(plan.days);
    body.innerHTML = `
      <div class="rhead"><h2>All days in ${esc(c.name)}</h2>
        <div class="meta">${esc(weekCount(plan.days))}</div>${weeksMeta()}</div>
      ${planNotes(null)}
      <ul class="stops week dnd">${plan.days
        .map((d, i) => `${ws.length > 1 && (i === 0 || mondayOf(plan.days[i - 1].date) !== mondayOf(d.date)) ? `<li class="weekhead">${esc(weekLabel(mondayOf(d.date)))} · ${esc(doors(ws.find((w) => w.week === mondayOf(d.date))?.doors ?? 0))}${(() => { const a = weekAreas(plan.days.filter((x) => mondayOf(x.date) === mondayOf(d.date)), plan.venues, c.name); return a ? `<span class="areas">${esc(a)}</span>` : ""; })()}</li>` : ""}<li class="dayhead"><button data-tab="${i}"><i style="background:${colour(i)}"></i><b>${esc(dayLabel(plan.days, d))} ${esc(rangeText(d.from, d.to))}</b> · ${doorsOf(d)}${d.stops.length ? ` · ${miText(d)}` : ""}${leaveText(d) ? ` · ${esc(leaveText(d, startName(d.start)))}` : ""}</button></li>${stopsHTML(d, i, { compact: true })}`)
        .join("")}</ul>
      <div class="addbar"><button class="btn line sm" data-add>+ Add a door</button></div>`;
  }

  // persona (Boise): two rooms of one chain read as one listed twice; each says its street (lib/pool.js venue.branch)
  // Your list (every row, persona: rows read alike without an address) gives the street; a day's rows only a chain's
  function branchHTML(v, every = false) {
    const st = v.branch ?? (every ? streetOf(v.address) : null);
    return st ? ` <span class="muted">· ${esc(st)}</span>` : "";
  }
  // J4 (owner review 5): Your list, every ranked room best first (lib/planview.js listRows): on a day ("Tue · stop 3",
  // opens the stop), not on a day (the planner's reason, + Add), or marked (greyed in place, Undo); then your own doors.
  function drawRest() {
    const rows = listRows(plan);
    const where = (r) => `${dayLabel(plan.days, plan.days[r.day], { short: true })} · stop ${r.stop}`;
    const row = (r) => {
      const { id } = r;
      const v = plan.venues[id] ?? {};
      const marked = EXCLUDED_STATUSES.has(r.state);
      const on = r.day != null;
      const pin = marked ? "#B9B5AC" : on ? colour(r.day) : "#B9B5AC";
      const add = r.state === "rest" && !r.pinned && S.can("addDoor"); // a pin is already yours: + Add would add it twice
      const why = r.state === "rest" ? r.reason ?? "not on a day" : marked && on ? where(r) : null; // ease audit 3 #9: one form for a row's day ("Tue · stop 3"), as the button beside an unmarked row
      const strip = r.rank != null ? stripSVG(stripModel({ pop: v.popularity, onDay: on, marked })) : ""; // §6: where the door sits between unknown and famous, with Doors' line
      const act = marked
        ? `<button type="button" class="btn line sm" data-act="undo" aria-label="Undo ${esc(statusLabel(r.state))} on ${esc(v.name ?? "this door")}">Undo</button>`
        : on ? `<button type="button" class="btn line sm onday" data-open title="Open this stop"><i style="background:${colour(r.day)}"></i>${esc(where(r))}</button>`
        : add ? `<button type="button" class="btn line sm" data-addopen aria-expanded="false">+ Add to a day</button>` : "";
      return `<li class="stop rest${marked ? " marked" : ""}" data-id="${esc(id)}"${on ? ` data-day="${r.day}"` : ""}><div class="pin rk" style="border-color:${pin}" aria-hidden="true">${r.rank != null ? `#${r.rank}` : "•"}</div>
        <div class="body"><button class="nm" data-open>${esc(v.name ?? id)}${branchHTML(v, true)}</button><div class="sb">${subHTML(id, v)}</div>${strip}${line2("", v)}${why ? `<div class="why">${esc(why)}</div>` : ""}<div class="tgs">${tags(id)}</div>${add ? addChoiceHTML(id, { hidden: true }) : ""}</div>
        <div>${act}</div>${menuHTML(id)}</li>`;
    };
    const ranked = rows.filter((r) => !r.own);
    const own = rows.filter((r) => r.own && !r.outside);
    const outside = rows.filter((r) => r.outside);
    // judge pass 3 (N26): the same count as Week and Why these rooms (every door on a day, yours and visited ones too)
    const onDays = new Set(plan.days.flatMap((d) => d.stops.map((s) => s.id))).size;
    const marked = ranked.filter((r) => EXCLUDED_STATUSES.has(r.state)).length;
    body.innerHTML = `
      <div class="rhead"><h2>Your list</h2>
        <div class="meta">Every door Qloo ranked for your drinker, best first. Your days fill from the top, a week at a time.${flatList(plan, routes) ? ` ${esc(FLAT_NOTE)}` : ""}${underwayNote(plan) ? ` ${esc(underwayNote(plan))}` : ""}</div>${weeksMeta()}
        <div class="progtxt">${plan.pool.N} ranked · ${onDays} on your days${marked ? ` · ${marked} marked` : ""}</div></div>
      ${planNotes(null)}
      <ul class="stops">
        ${ranked.map(row).join("") || `<li class="empty">No ranked doors pass your door types. <a href="${demo ? editTo : BRAND_HREF}">${demo ? "Edit profile" : "Edit my brand"}</a></li>`}
        ${own.length ? `<li class="dayhead"><b>Your own doors</b> · contacts and doors you added</li>${own.map(row).join("")}` : ""}
        ${outside.length ? `<li class="dayhead"><b>Marked</b> · not on your ranked list now (another door type, or closed)</li>${outside.map(row).join("")}` : ""}
      </ul>
      <div class="addbar"><button class="btn line sm" data-add>+ Add a door</button></div>`;
  }

  // G3: "Add to [Tue] [Wed] [Thu] · Add to the best day" (group 3 #6, was "Let Doors choose") for a room (the map card and the ranked-rooms rows); days that
  // ended or are being worked are left out.
  function addChoiceHTML(id, { hidden = false } = {}) {
    const open = plan.days.map((d, i) => ({ d, i })).filter(({ d }) => !d.past && !d.frozen);
    return `<div class="addto" data-for="${esc(id)}"${hidden ? " hidden" : ""}><span class="lbl">Add to</span>${open.map(({ d, i }) => `<button type="button" class="chip" data-add-day="${esc(d.date)}" title="${esc(niceDate(d.date))}, ${esc(rangeText(d.from, d.to))}"><i style="background:${colour(i)}"></i>${esc(dayLabel(plan.days, d, { short: true }))}</button>`).join("")}<button type="button" class="chip auto" data-add-day="">Add to the best day</button></div>`;
  }

  // judge pass 2 (19): the demo's offline bake has road miles for every pair, but road shapes only for the days it
  // routed; a re-planned day draws dashed, and the footer says why its miles still read "road mi"
  const unshaped = (d) => {
    if (!demo || plan.source !== "ors") return "";
    const ds = (d ? [d] : plan.days).filter((x) => !x.past && x.stops.length);
    return ds.some((x) => !hasRoadShape(x.start, x.stops.map((s) => plan.venues[s.id] ?? {}))) ? " A dashed line: a day re-planned offline, so its road shape isn't drawn; its miles and times are still road ones." : "";
  };
  // Notes from the planner, plainly (follow-up moved, a contact that didn't fit, …). d = a day, or null for all.
  function planNotes(d) {
    // a note's day is `to` (follow-ups) or `date` (F1's far-start)
    const ns = plan.notes.filter((n) => n.kind !== "carried" && (!d || !(n.date ?? n.to) || (n.date ?? n.to) === d.date));
    if (!ns.length) return "";
    // a room added from the map or a list is pinned as a contact (G3); its note says so in its own words
    const text = (n) => (plan.venues[n.id]?.added && !plan.venues[n.id]?.contact ? n.text.replace(/^A contact is not on the plan/, "Added by you, but not on the plan") : n.text);
    // Jard 10-24: an added room no day holds (saved before the fix that stops such adds) can be taken back out right here
    const unadd = (n) => (plan.venues[n.id]?.added && !plan.venues[n.id]?.contact && /unscheduled/.test(n.kind ?? "") ? ` <button type="button" class="lnk" data-unadd="${esc(n.id)}">Remove from my plan</button>` : "");
    const items = ns.map((n) => `<li>${n.id && plan.venues[n.id]?.name ? `<b>${esc(plan.venues[n.id].name)}</b>: ` : ""}${esc(text(n))}${unadd(n)}</li>`).join("");
    if (ns.length < 2) return `<ul class="pnotes">${items}</ul>`;
    // two or more fold into one line, so the header doesn't eat the stop list
    const fu = ns.filter((n) => n.kind === "followup").length;
    const what = fu === ns.length ? `${fu} follow-ups` : fu ? `${fu} follow-up${fu === 1 ? "" : "s"} and ${ns.length - fu} more note${ns.length - fu === 1 ? "" : "s"}` : `${ns.length} notes from the planner`;
    return `<details class="pnotes"><summary>${esc(what)}</summary><ul>${items}</ul></details>`;
  }

  // a start in words; profiles saved before F3 say "Pin on the map"
  const startName = (s) => (!s ? "your start" : !s.label || s.label === "Pin on the map" ? pinLabel(s, c.key, plan.venues) : s.label);
  function drawFoot() {
    const d = typeof sel === "number" ? plan.days[sel] : null;
    // ease #10: no engineering notes under the plan (how miles were measured and when hours were captured are under Why
    // these doors' sources and on each door card)
    const day = `${d ? `Leave ${clock12(d.leave ?? d.from)} from ${startName(d.start)} · ${profile.visitMin} min a stop.` : ""}${unshaped(d)}`.trim();
    $("#p-foot", root).innerHTML = `
      ${day ? `<p>${esc(day)}</p>` : ""}
      ${heatOn() && (!d || d.date === plan.days.find((x) => !x.past)?.date) ? `<p class="heatline">Work first: ${esc(hoods.slice(0, HEAT_TOP).map((h) => h.name).join(", ").replace(/, ([^,]*)$/, " and $1"))}. They top Qloo's map of where ${esc(routes[0]?.drinker?.name ?? "your drinker's")} drinkers are in ${esc(c.name)}, so the first day leans there.</p>` : ""}`;
  }

  // ---------- stop rows: open, menu ----------
  const closeMenus = () => $$(".menu:not([hidden])", root).forEach((m) => { m.hidden = true; m.previousElementSibling?.setAttribute("aria-expanded", "false"); });
  body.addEventListener("click", async (e) => {
    if (e.target.closest("[data-add]")) return void ((view = "add"), draw());
    const un = e.target.closest("[data-unadd]");
    if (un) return removeDoor(un.dataset.unadd);
    const tab = e.target.closest(".dayhead [data-tab]");
    if (tab) return selectDay(Number(tab.dataset.tab));
    const li = e.target.closest("[data-id]");
    if (!li) return;
    const id = li.dataset.id;
    const ao = e.target.closest("[data-addopen]");
    if (ao) {
      const box = li.querySelector(".addto");
      box.hidden = !box.hidden;
      ao.setAttribute("aria-expanded", String(!box.hidden));
      if (!box.hidden) box.querySelector("button")?.focus();
      return;
    }
    const ad = e.target.closest("[data-add-day]");
    if (ad) return addDoor(plan.venues[id], { date: ad.dataset.addDay || null });
    const more = e.target.closest(".more");
    if (more) {
      const m = more.nextElementSibling;
      const open = m.hidden;
      closeMenus();
      m.hidden = !open;
      more.setAttribute("aria-expanded", String(open));
      if (open) m.querySelector("button:not([disabled])")?.focus();
      return;
    }
    const mv = e.target.closest("[data-move]")?.dataset.move;
    if (mv) {
      closeMenus();
      const [day, index] = mv.split(":");
      return moveStop(id, { day: Number(day), index: index === "" ? null : Number(index) });
    }
    const lk = e.target.closest("[data-lock]")?.dataset.lock;
    if (lk) return void (closeMenus(), setLock(id, lk === "on"));
    if (e.target.closest("[data-unlock]")) return setLock(id, false);
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act) {
      closeMenus();
      if (act === "remove") return removeContact(id);
      if (act === "unadd") return removeDoor(id);
      if (act === "later") return setLater(id, !plan.later?.[id]);
      return act === "undo" ? undoMark(id) : setStatus(id, act);
    }
    if (e.target.closest("[data-open]")) openStop(id, li.dataset.day != null ? Number(li.dataset.day) : null);
  });
  body.addEventListener("keydown", (e) => {
    // G4: the grip's arrow keys move the stop one place (and lock it there); focus follows it
    const g = e.target.closest(".grip");
    if (g && (e.key === "ArrowUp" || e.key === "ArrowDown")) {
      e.preventDefault();
      const li = g.closest(".stop");
      const id = li.dataset.id;
      moveStop(id, { day: Number(li.dataset.day), index: Number(li.dataset.k) + (e.key === "ArrowUp" ? -1 : 1) }).then(() => $(`.stop[data-id="${CSS.escape(id)}"] .grip`, body)?.focus());
      return;
    }
    if (e.key === "Escape" && e.target.closest(".menu")) {
      const more = e.target.closest(".menu").previousElementSibling;
      closeMenus();
      more?.focus();
    }
  });
  const onDocClick = (e) => { if (!e.target.closest(".more, .menu")) closeMenus(); };
  document.addEventListener("click", onDocClick);

  // ---------- G4: drag a stop by its grip (pointer events: mouse, pen and touch) ----------
  // Drop targets: a stop row of a day ahead (before or after it), another day's tab (its end), a Week day's head (its
  // start). The ghost follows the pointer; the drop line shows where it lands; Escape or a cancel drops nothing.
  let drag = null;
  const unmark = () => $$(".drop-before, .drop-after, .drop-on", root).forEach((x) => x.classList.remove("drop-before", "drop-after", "drop-on"));
  function dropAt(x, y) {
    unmark();
    const el = document.elementFromPoint(x, y);
    const row = el?.closest(".stops.dnd .stop[data-day]");
    const tab = el?.closest(".daytabs [data-tab], .dayhead [data-tab]");
    if (row && row !== drag.li && root.contains(row)) {
      const d = Number(row.dataset.day);
      if (plan.days[d]?.past) return null;
      const r = row.getBoundingClientRect();
      const after = y > r.top + r.height / 2;
      row.classList.add(after ? "drop-after" : "drop-before");
      let index = Number(row.dataset.k) + (after ? 1 : 0);
      if (d === drag.day && Number(drag.li.dataset.k) < index) index--;
      return { day: d, index };
    }
    if (tab && /^\d+$/.test(tab.dataset.tab) && root.contains(tab)) {
      const d = Number(tab.dataset.tab);
      const head = !!tab.closest(".dayhead");
      if (plan.days[d]?.past || (d === drag.day && !head)) return null;
      tab.classList.add("drop-on");
      return { day: d, index: head ? 0 : null };
    }
    return null;
  }
  function endDrag(commit) {
    const d = drag;
    drag = null;
    if (!d) return;
    d.ghost?.remove();
    d.li.classList.remove("dragging");
    root.classList.remove("is-dragging");
    unmark();
    cancelAnimationFrame(d.raf);
    if (commit && d.ghost && d.to && !(d.to.day === d.day && d.to.index === Number(d.li.dataset.k))) moveStop(d.id, d.to);
  }
  body.addEventListener("pointerdown", (e) => {
    const g = e.target.closest(".grip:not(.off)");
    if (!g || e.button > 0 || drag) return;
    e.preventDefault();
    const li = g.closest(".stop");
    drag = { id: li.dataset.id, day: Number(li.dataset.day), li, x0: e.clientX, y0: e.clientY, y: e.clientY, pid: e.pointerId, ghost: null, to: null };
    g.setPointerCapture?.(e.pointerId);
  });
  // near the top or bottom edge, the list (or the page, on a phone) scrolls
  const edgeScroll = () => {
    if (!drag?.ghost) return;
    const list = drag.li.closest(".stops");
    const r = list.scrollHeight > list.clientHeight ? list.getBoundingClientRect() : { top: 0, bottom: innerHeight };
    const v = drag.y < r.top + 48 ? -10 : drag.y > r.bottom - 48 ? 10 : 0;
    // the list scrolls in its own box; on a short desktop window the whole left column does (doors.css); else the page
    const col = list.closest(".rcol");
    if (v) (list.scrollHeight > list.clientHeight ? list.scrollBy(0, v) : col && col.scrollHeight > col.clientHeight ? col.scrollBy(0, v) : scrollBy(0, v)), (drag.to = dropAt(drag.x, drag.y));
    drag.raf = requestAnimationFrame(edgeScroll);
  };
  body.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.pid) return;
    drag.x = e.clientX;
    drag.y = e.clientY;
    if (!drag.ghost) {
      if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 5) return;
      const r = drag.li.getBoundingClientRect();
      drag.ghost = drag.li.cloneNode(true);
      drag.ghost.classList.add("ghost");
      drag.ghost.removeAttribute("data-id");
      drag.ghost.style.cssText = `width:${r.width}px;left:${r.left}px;top:0`;
      drag.dy = drag.y0 - r.top;
      document.body.append(drag.ghost);
      drag.li.classList.add("dragging");
      root.classList.add("is-dragging");
      drag.raf = requestAnimationFrame(edgeScroll);
    }
    drag.ghost.style.transform = `translateY(${e.clientY - drag.dy}px)`;
    drag.to = dropAt(e.clientX, e.clientY);
  });
  body.addEventListener("pointerup", (e) => { if (drag && e.pointerId === drag.pid) endDrag(true); });
  body.addEventListener("pointercancel", () => endDrag(false));
  const onDragKey = (e) => { if (e.key === "Escape" && drag) endDrag(false); };
  document.addEventListener("keydown", onDragKey);

  function openStop(id, day) {
    focusId = id;
    $$(".stop.sel", root).forEach((x) => x.classList.toggle("sel", x.dataset.id === id));
    $$(`.stop[data-id="${CSS.escape(id)}"]`, root).forEach((x) => x.classList.add("sel"));
    const v = plan.venues[id];
    if (map && v && Number.isFinite(v.lat)) map.easeTo({ center: [v.lon, v.lat], zoom: Math.max(map.getZoom(), 14), duration: 600 });
    window.dispatchEvent(new CustomEvent("doors:open-stop", { detail: { id, day } }));
  }

  // ---------- Add a door ----------
  let addTab = "qloo";
  let addRows = null; // Qloo results, "loading", or {error}
  let pinMode = null; // {lat, lon} once the map is clicked in manual mode
  let geoRows = [];
  function drawAdd() {
    body.innerHTML = `
      <div class="rhead"><h2>Add a door</h2><div class="meta">A door you know: it's always scheduled, on the first day it's open and fits.</div></div>
      <div class="addpane">
        <div class="seg" role="tablist"><button role="tab" aria-selected="${addTab === "qloo"}" data-at="qloo">Find it on Qloo</button><button role="tab" aria-selected="${addTab === "manual"}" data-at="manual">Enter it myself</button></div>
        ${addTab === "qloo" ? `
        <form id="a-q" class="arow"><label class="sr" for="a-qin">Name of the bar or restaurant</label><input class="inp" id="a-qin" autocomplete="off" placeholder="Name of the bar or restaurant in ${esc(c.name)}" value="${esc(drawAdd.q ?? "")}"><button class="btn primary sm" type="submit">Search</button></form>
        <div class="hint">One Qloo search per click. You get the door's own listing: address and hours.</div>
        <ul class="results">${resultsHTML()}</ul>` : `
        <form id="a-m">
          <div class="field"><label for="a-name">Name</label><input class="inp" id="a-name" autocomplete="off" required placeholder="e.g. Barb's Back Room"></div>
          <div class="field"><label for="a-addr">Address</label><input class="inp" id="a-addr" autocomplete="off" placeholder="Street address in ${esc(c.name)}">
            <div class="dd" id="a-dd" role="listbox" hidden></div>
            <div class="hint" id="a-where">${pinMode ? `${esc(pinLabel(pinMode, c.key, plan.venues))}.` : "Type the address, or drop a pin on the map."}</div></div>
          <div class="arow"><button type="button" class="btn line sm" id="a-pin">${pinMode ? "Move the pin" : "Drop a pin on the map"}</button><button class="btn primary sm" type="submit" ${pinMode ? "" : "disabled"} id="a-save">Add as my contact</button></div>
          <div class="hint">Hours unknown: it's marked "hours unverified" and scheduled in your windows.</div>
        </form>`}
        <button class="btn ghost sm" data-cancel>Back to the plan</button>
      </div>`;
  }
  const resultsHTML = () => {
    if (addRows === "loading") return `<li class="note">Searching Qloo…</li>`;
    if (addRows?.error) return `<li class="note">${esc(addRows.error)}</li>`;
    if (Array.isArray(addRows) && !addRows.length) return `<li class="note">No ${esc(c.name)} place by that name on Qloo. Try "Enter it myself".</li>`;
    if (!Array.isArray(addRows)) return "";
    return addRows
      .map((r, i) => {
        const k = plan.pool.ids.indexOf(r.id);
        const mine = (st.contacts ?? []).some((x) => x.id === r.id);
        return `<li><div><b>${esc(r.name)}</b><div class="small muted">${esc(r.where ?? "")}${k >= 0 ? ` · already ranked #${k + 1} of ${plan.pool.N}` : ""}</div></div>
          <button class="btn line sm" data-pick="${i}" ${mine ? "disabled" : ""}>${mine ? "Added" : "Add"}</button></li>`;
      })
      .join("");
  };
  body.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (e.target.id === "a-q") {
      const q = $("#a-qin", root).value.trim();
      drawAdd.q = q;
      if (q.length < 2) return;
      addRows = "loading";
      $(".results", root).innerHTML = resultsHTML();
      try { addRows = await searchPlaces(q, c.key, c.live ? c : null); } catch (err) { addRows = { error: `Qloo search didn't answer: ${err.message}` }; }
      if (view === "add") $(".results", root).innerHTML = resultsHTML();
    } else if (e.target.id === "a-m") {
      const name = $("#a-name", root).value.trim();
      if (!name || !pinMode) return;
      const addr = $("#a-addr", root).value.trim();
      const v = { id: `contact:${Date.now().toString(36)}`, name, address: addr || null, lat: pinMode.lat, lon: pinMode.lon, hours: null, genre: null, source: "manual" };
      pinMode = null;
      setPinMode(false);
      await addContact(v);
    }
  });
  body.addEventListener("click", async (e) => {
    const at = e.target.closest("[data-at]");
    if (at) return void ((addTab = at.dataset.at), drawAdd());
    if (e.target.closest("[data-cancel]")) return void ((view = "list"), setPinMode(false), draw());
    const pick = e.target.closest("[data-pick]");
    if (pick) {
      const r = addRows[+pick.dataset.pick];
      await addContact({ ...r.venue, source: "qloo" });
    }
    if (e.target.id === "a-pin") setPinMode(true);
    const g = e.target.closest("#a-dd [data-i]");
    if (g) {
      const r = geoRows[+g.dataset.i];
      $("#a-addr", root).value = r.label;
      $("#a-dd", root).hidden = true;
      setPin({ lat: r.lat, lon: r.lon });
      map?.easeTo({ center: [r.lon, r.lat], zoom: 15, duration: 600 });
    }
  });
  const lookUp = debounce(async (q) => {
    const dd = $("#a-dd", root);
    if (!dd || q.length < 4) return dd && (dd.hidden = true);
    const rows = await geocode(q, c.key, c.live ? { cityName: profile.cityName, center: c.center } : null);
    if ($("#a-addr", root)?.value.trim() !== q) return;
    geoRows = rows ?? [];
    dd.innerHTML = geoRows.map((r, i) => `<div role="option" data-i="${i}">${esc(r.label)}</div>`).join("") || `<div class="note">${rows === null ? SEARCH_OFF : "No match in this city: drop a pin instead."}</div>`;
    dd.hidden = false;
  }, 450);
  body.addEventListener("input", (e) => { if (e.target.id === "a-addr") lookUp(e.target.value.trim()); });

  let pinMarker = null;
  function setPin(ll) {
    pinMode = ll;
    if (map && !pinMarker) {
      pinMarker = addStart(map, ll, { draggable: true });
      pinMarker.getElement().querySelector(".mstart").classList.add("contact");
      pinMarker.on("dragend", () => { const p = pinMarker.getLngLat(); setPin({ lat: p.lat, lon: p.lng }); });
    }
    pinMarker?.setLngLat([ll.lon, ll.lat]);
    const w = $("#a-where", root);
    if (w) w.textContent = `${pinLabel(ll, c.key, plan.venues)}.`;
    const s = $("#a-save", root);
    if (s) s.disabled = false;
  }
  function setPinMode(on) {
    const tip = $("#p-maptip", root);
    tip.hidden = !on;
    tip.textContent = "Click the map where the door is";
    if (map) map.getCanvas().style.cursor = on ? "crosshair" : "";
    setPinMode.on = on;
    if (!on && pinMarker) (pinMarker.remove(), (pinMarker = null));
    if (on && matchMedia("(max-width: 900px)").matches) $("#plan-map", root).scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }

  // ---------- toolbar ----------
  // R9 drive mode: full screen over the plan, through state.js (&drive=1 stays in the address while it's open: syncUrl)
  let closeDrive = null;
  const startDrive = (by = 0) => {
    if (closeDrive) return;
    // a day stopped today: Resume my day brings the stopped doors back first (lib/day-stop.js undoChange)
    const resume = !by && $("#t-drive", root)?.hasAttribute("data-drive-stopped");
    closeDrive = openDrive({ now: nowStamp, by, resume, onClose: () => { closeDrive = null; syncUrl(); $("#t-drive", root)?.focus(); } });
    syncUrl();
  };
  $("#t-drive", root).addEventListener("click", () => startDrive());
  // ease audit 2 #3: the Agent's "I'm running late" opens Start my day that late (open already: ui/drive.js takes it)
  const onLate = (e) => { if (!closeDrive && +e.detail?.by > 0) startDrive(+e.detail.by); };
  window.addEventListener("doors:late", onLate);
  // ▶ Watch the route, the map's run bar (one place for it: Jard 10-23 found two Run the route buttons): the selected
  // day, or every day in turn from the week view. B2's player listens for doors:run-route.
  const watchRoute = () => {
    const day = typeof sel === "number" ? sel : plan.days.findIndex((d) => d.stops.length);
    if (sel === "week") plan.days.forEach((_, i) => layers.days.add(i));
    else if (day >= 0) layers.days.add(day);
    window.dispatchEvent(new CustomEvent("doors:run-route", { detail: sel === "week" ? { all: true, map } : { day, date: plan.days[day]?.date, map } }));
  };
  // owner review 3: "Why these rooms?" takes the left column (the plan list folds away, "Your plan" brings it back), so
  // the whole map stays in view while you click through it; Settings stays a drawer over the map.
  const whyMode = (on) => {
    const r = $(".route", root);
    if (!r || r.classList.contains("why-mode") === on) return;
    r.classList.toggle("why-mode", on);
    if (on) closePopup(); // H2: in why-mode every place opens the Why card (ui/why.js), never a second card
    requestAnimationFrame(() => { try { map?.resize(); } catch {} });
    syncUrl();
  };
  // the Log book takes the left column the same way (css/logbook.css .route.log-mode)
  const logMode = (on) => {
    const r = $(".route", root);
    if (!r || r.classList.contains("log-mode") === on) return;
    r.classList.toggle("log-mode", on);
    if (on) closePopup();
    requestAnimationFrame(() => { try { map?.resize(); } catch {} });
    syncUrl();
  };
  let logReturn = false; // a door opened from the Log book: closing it brings the Log book back
  function drawLog() {
    drawLogbook($("#logbook", root), {
      plan, state: st, brand, city: c.name, today: (demo ? tourNow(st, plan.windows ?? [], nowStamp()) : nowStamp()).date,
      setLater, flash, close: () => closeDrawers(),
      openStop: (id) => { if (!plan.venues[id]) return; logReturn = true; openStop(id, plan.days.findIndex((d) => d.stops.some((s) => s.id === id)) >= 0 ? plan.days.findIndex((d) => d.stops.some((s) => s.id === id)) : null); },
    });
  }
  const closeDrawers = () => {
    $$("[data-drawer]", root).forEach((x) => { x.setAttribute("aria-expanded", "false"); $(`#${x.dataset.drawer}`, root).hidden = true; });
    whyMode(false);
    logMode(false);
    setTimeout(weekClouds, 0); // §6: after the Why drawer's observer has cleared its own clouds
  };
  $$("[data-drawer]", root).forEach((b) =>
    b.addEventListener("click", async () => {
      const id = b.dataset.drawer;
      const dr = $(`#${id}`, root);
      const open = dr.hidden;
      // round 8 item 4 (Jard 10-28): from one open screen, a tap on another button of the row goes straight to it, as
      // ONE change of the address (closing Market and opening My doors were two: the close's history.back() landed
      // after the open and shut it, so the screen fell back to the plan and a second tap was needed). Back from the
      // new screen returns to the plan (app.js planNav: a switch replaces the entry, never stacks one).
      const was = syncing;
      syncing = true;
      try {
        closeDrawers();
        if (!open) return;
        // ease audit 3 #1: at a phone width the door card is a bottom sheet over the page, and the menu, Settings and
        // Export open in the page under the map, so under the sheet (Menu looked dead). The card closes first.
        if (id !== "why" && stopOpen && matchMedia("(max-width:700px)").matches) window.dispatchEvent(new CustomEvent("doors:close-stop"));
        dr.hidden = false;
        b.setAttribute("aria-expanded", "true");
        if (id === "why") (whyMode(true), drawWhy());
        else if (id === "logbook") (logMode(true), drawLog(), dr.scrollTop = 0);
        else if (id === "settings") drawSettings(dr);
        else if (id === "export") drawExportPanel(dr);
        else if (id === "homescreen") drawHomeScreen(dr);
        else if (id === "menu") (syncHomeScreen(), $(".mi", dr)?.focus());
      } finally {
        syncing = was;
        syncUrl();
      }
    }),
  );
  // owner review 2 (G2): a click anywhere outside an open drawer (the map, the list) or Escape closes it. A press that
  // drags (panning the map) is not a click.
  const isOpen = () => $$(".drawer", root).some((d) => !d.hidden);
  let downAt = null;
  const onDrawerDown = (e) => { downAt = [e.clientX, e.clientY]; };
  const onDrawerClick = (e) => {
    if (!isOpen() || !e.target.isConnected || e.target.closest(".drawer, [data-drawer]")) return;
    if (downAt && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return;
    // Why these rooms stays open while you use the map beside it; the menu, Settings and Export close on a click outside.
    // round 8 (settings + phone2 together): this runs in the capture phase, before Start my day's own handler. A tap on
    // Start my day from an open Settings is ONE change of the address (phone2 item 4): the drawers close silently here
    // and the drive's syncUrl makes the change (closing Settings here synced on its own, its history.back() landed after
    // the drive opened and shut it). A plain click outside still drops the closed drawer from the address.
    const toScreen = !!e.target.closest("#t-drive, [data-drive-start]");
    const was = syncing;
    if (toScreen) syncing = true;
    try {
      ["menu", "settings", "export", "homescreen"].forEach((id) => { if ($(`#${id}`, root) && !$(`#${id}`, root).hidden) { $(`[data-drawer="${id}"]`, root).setAttribute("aria-expanded", "false"); $(`#${id}`, root).hidden = true; } });
    } finally {
      syncing = was;
    }
    if (!toScreen) syncUrl();
  };
  const onMenuBack = (e) => {
    if (!e.target.closest?.("[data-mback]") || !root.contains(e.target)) return;
    closeDrawers();
    $('[data-drawer="menu"]', root)?.click();
  };
  root.addEventListener("click", onMenuBack);
  const onDrawerKey = (e) => {
    if (e.key !== "Escape" || !isOpen()) return;
    const b = $('[data-drawer][aria-expanded="true"]', root);
    closeDrawers();
    syncUrl();
    b?.focus();
  };
  // H3: a stop opened from anywhere (a pin on the map, a card, the tour) takes the left column, so Why steps aside; its
  // "Why these rooms?" button brings it back, and leaving it shows the stop again
  const onOpenStop = (e) => {
    stopOpen = e.detail?.id ?? null;
    if (!$("#why", root).hidden || !$("#logbook", root).hidden) closeDrawers();
    syncUrl();
  };
  const onStopClosed = () => {
    stopOpen = null;
    // round 8 item 4: the door closing and the Log book coming back are one change of the address (see the drawer click)
    if (logReturn) { logReturn = false; const was = syncing; syncing = true; try { $('[data-drawer="logbook"]', root)?.click(); } finally { syncing = was; } }
    syncUrl();
  };
  window.addEventListener("doors:open-stop", onOpenStop);
  window.addEventListener("doors:stop-closed", onStopClosed);
  // ease audit 3 #10e: offline, the header only said "mi, estimated"; a line says why
  const onNet = () => { const n = $("#p-offline", root); if (n) n.hidden = navigator.onLine !== false; };
  window.addEventListener("online", onNet);
  window.addEventListener("offline", onNet);
  onNet();

  // ---- ease #5 (AUDIT-EASE-1): browser Back. A door card (&stop=<id>), Why these doors (&why=1) and Start my day
  // (&drive=1) each add a history entry (app.js nav), so Back (a phone's swipe-back too) closes what was opened instead of
  // leaving the plan; Back or Forward onto this plan (app.js calls syncFrom) opens and closes them to match the address.
  // The tour (demo) has no nav: its address stays #/demo. ----
  let syncing = false;
  let stopOpen = null; // the door card on screen
  // round 8: Settings (&settings=1) too, so a brand or city form's Back comes back to it open
  const panelState = () => ({ stop: stopOpen, why: $("#why", root)?.hidden === false ? "1" : null, log: $("#logbook", root)?.hidden === false ? "1" : null, drive: closeDrive ? "1" : null, settings: $("#settings", root)?.hidden === false ? "1" : null });
  function syncUrl() { if (nav && !syncing && !dead) nav.set(panelState()); }
  function syncFrom(p) {
    if (!plan || dead) return;
    syncing = true;
    try {
      if (p.stop && p.stop !== stopOpen && plan.venues[p.stop]) openStop(p.stop, null);
      else if (!p.stop && stopOpen) window.dispatchEvent(new CustomEvent("doors:close-stop"));
      const whyOn = $("#why", root).hidden === false;
      if (p.why === "1" && !whyOn) $('[data-drawer="why"]', root)?.click();
      else if (p.why !== "1" && whyOn) closeDrawers();
      const logOn = $("#logbook", root).hidden === false;
      if (p.log === "1" && !logOn) $('[data-drawer="logbook"]', root)?.click();
      else if (p.log !== "1" && logOn) closeDrawers();
      if (p.drive === "1" && !closeDrive) startDrive();
      else if (p.drive !== "1" && closeDrive) closeDrive();
      const setOn = $("#settings", root)?.hidden === false;
      if (p.settings === "1" && !setOn) $("#t-settings", root)?.click();
      else if (p.settings !== "1" && setOn) closeDrawers();
    } finally {
      syncing = false;
    }
  }
  nav?.bind(syncFrom);
  document.addEventListener("pointerdown", onDrawerDown, true);
  document.addEventListener("click", onDrawerClick, true);
  document.addEventListener("keydown", onDrawerKey);
  // Settings (Jard 10-23 19:00 #5/#8, the phone's twin): Edit profile and the navigation app, opened from the menu.
  // Export is its own panel from the menu, as on the phone.
  // Jard web review 10-24 #10: a page opened from the Menu (Settings, Export, Your plans) has a Back to the Menu
  const menuBack = `<button type="button" class="lnk mback" data-mback>← Back</button>`;
  function drawExportPanel(dr) {
    dr.innerHTML = `${menuBack}<div class="set-export"></div>`; // drawExport titles it
    drawExport($(".set-export", dr), { plan, brand, onCSV: exportCSV, flash });
  }
  // round 8 (Jard 10-28): Add to Home Screen, from the Menu on an iPhone or iPad in a browser tab (the drive-mode strip
  // went). Two steps in plain words; Prepare reloads with this plan (ui/carry.js prepare), then the sheet says Ready.
  const HS = { get: "Two steps: Prepare, then Share", ready: "Ready: Share → Add to Home Screen", big: "This plan is too big to come along" };
  function drawHomeScreen(dr) {
    const s = carry?.status();
    const body = !s ? `<p>Open this plan in Safari on an iPhone or iPad, then Add to Home Screen from the Menu.</p>`
      : s.state === "big" ? `<p>This plan is too big to come with Add to Home Screen: build it in the app.</p>`
      : s.state === "ready" ? `<p><b>Ready: Share → Add to Home Screen.</b></p><p>The app on your Home Screen opens this plan.</p>`
      : `<ol class="hs-steps"><li>Tap Prepare (the page reloads with this plan).</li><li>Tap Share → Add to Home Screen.</li></ol><button type="button" class="btn" data-carry-prepare>Prepare</button>`;
    dr.innerHTML = `${menuBack}<h3>Add to Home Screen</h3>${body}`;
    const go = $("[data-carry-prepare]", dr);
    if (go) go.onclick = async () => { go.disabled = true; go.textContent = "Reloading…"; if (!(await carry.prepare())) drawHomeScreen(dr); };
  }
  // the Menu item: shown with the state's line, or hidden (desktop, standalone, no plan); the open sheet follows
  function syncHomeScreen() {
    const it = $("#t-homescreen", root);
    if (!it) return;
    const s = carry?.status();
    it.hidden = !s;
    if (s) $("span", it).textContent = HS[s.state];
    $("#t-menu", root)?.setAttribute("aria-label", s ? "Menu: Home, Export, Settings, Add to Home Screen, Privacy" : "Menu: Home, Export, Settings, Privacy");
    const dr = $("#homescreen", root);
    if (dr && !dr.hidden) drawHomeScreen(dr);
  }
  window.addEventListener("doors:carry", syncHomeScreen);
  syncHomeScreen();
  // Prepare's reload: the sheet again, now Ready
  if (carry?.prepared?.()) setTimeout(() => { if (!dead) $("#t-homescreen", root)?.click(); }, 0);
  // round 4 #6 (Jard 10-27: "i don't see a way to edit my schedule, hours, etc."): everything from setup is editable
  // from here. round 8 (Jard 10-28: "why do we have every single thing that we can edit in settings when it all takes
  // you to the same page?"): one short summary per part, with one Edit each (the brand's form, this city's form). The
  // brand's fields are for every city; the city's are this plan's. The demo: Maya's one form.
  function drawSettings(dr) {
    const sum = settingsSummary(profile, index, { cityKey: c.key, demoHref: demo ? editTo : null });
    const li = (r) => `<li><b>${esc(r.label)}</b><span>${esc(r.value)}</span></li>`;
    const part = (k) => `<ul class="set-sum">${sum[k].map(li).join("")}</ul>`;
    dr.innerHTML = `${menuBack}<h3>Settings</h3>
      <p class="small muted">Saving a change shows what it does to your plan before it applies, with Undo.</p>
      <div class="set-head"><h4>${demo ? "Maya's brand" : "Your brand"}</h4><a class="btn line sm" href="${esc(demo ? editTo : BRAND_HREF)}">Edit my brand</a></div>
      <p class="small muted">For every city.</p>
      ${part("brand")}
      <div class="set-head"><h4>${esc(c.name)}</h4><a class="btn line sm" href="${esc(editTo)}">Edit this city</a></div>
      <p class="small muted">This city's days, hours, start and doors.</p>
      ${part("city")}
      <ul class="xlist">
        ${demo ? "" : `<li><div><b>My cities</b><div class="small muted">Every city you've opened, each with its own plan. Add one or delete one.</div></div><a class="btn line sm" href="${CITIES_HREF}">My cities</a></li>`}<!-- group 3 #5 -->
        <li class="set-nav"><div><b>Navigation app</b><div class="small muted">Navigate and directions open ${esc(currentNavName())}.</div></div><div class="set-navapps" role="group" aria-label="Navigation app">${navAppButtons()}</div></li>
      </ul>`;
    // PARITY S14 (the phone's Settings → Navigation app): remembered on this device; the open stop's Directions follow
    $(".set-navapps", dr).addEventListener("click", (e) => {
      const b = e.target.closest("[data-nav-app]");
      if (!b) return;
      setNavApp(b.dataset.navApp);
      drawSettings(dr);
      $(`[data-nav-app="${b.dataset.navApp}"]`, dr)?.focus();
    });
  }
  function exportCSV() {
    const csv = planCSV({ plan, venues: plan.venues, pool: plan.pool, statuses: plan.statuses, outcomes: st.outcomes, captured, source: plan.source, merged: isMerged(profile) });
    download(csv, `doors-${brand.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${c.key}.csv`, "text/csv");
    flash("Plan exported as CSV: every stop with its status and outcome.");
  }

  // Why these rooms (§3.4, §9.1; owner review 2, G6): the explorable dashboard over the map (ui/why.js), on Qloo's
  // data for this plan; the famous-rooms switch inside it is handled below.
  // What your plan is based on (Jard 10-23 #2/#7): its fixes run this view's own actions (setStatus and addDoor through
  // ui/state.js; the famous doors and talking-points rules here)
  function drawWhy() {
    drawWhyPanel($("#why", root), { plan, routes, profile, index, famous: !!st.famous, captured, travelNote: demo?.travelNote ?? null, map, editTo, today: (demo ? tourNow(st, plan.windows ?? [], nowStamp()) : nowStamp()).date, added: st.added ?? [], rules: store.getRules(brand), setFamous, setStartWith, startWith: st.startWith ?? null, removeRule: (r) => (setSlot(null, { clear: r.field, value: r.value }), drawWhy()), whyChanges: st.whyChanges ?? [], previewChange, applyChange, undoWhyChange });
  }
  async function setFamous(on) {
    st = store.update(brand, c.key, { famous: on });
    await replan();
    flash(on ? "The most popular doors are in: the list now ranks them with the rest." : "The most popular doors are out again.");
  }
  // why2: "Start with <crowd>" (key: lib/crowds.js crowdKey; null mixes the crowds again)
  async function setStartWith(key) {
    st = store.update(brand, c.key, { startWith: key ?? null });
    await replan();
    const d = plan?.days?.find((x) => x && !x.past && x.stops.length);
    const name = routes.find((r) => crowdKey(r) === key)?.drinker?.name;
    flash(key && name && d ? `${d.day[0].toUpperCase()}${d.day.slice(1)} starts with ${name}'s doors.` : "The crowds are mixed again.");
  }
  // the stop's "Why this door" row: this panel, open on that door
  const onWhyDoor = (e) => {
    const el = $("#why", root);
    if (!el || !e.detail?.id) return;
    e.preventDefault(); // handled: the stop's row doesn't also open Qloo's deep-dive
    setWhyDoor(el, e.detail.id);
    if (el.hidden) $('[data-drawer="why"]', root)?.click();
    else drawWhy();
  };
  window.addEventListener("doors:why-door", onWhyDoor);
  $("#why", root).addEventListener("change", async (e) => {
    if (e.target.id !== "w-famous") return;
    await setFamous(e.target.checked);
  });

  // ---------- map ----------
  // B2's route player owns the day lines (real roads via /api/directions) and the pins; this view adds the starts,
  // the layer chips (G3: each day and the other ranked rooms, toggled on their own) and the ranked rooms' markers
  // and cards. The camera always fits the whole week, so every tab shares one reference.
  let map = null;
  let player = null;
  let markers = [];
  let fitted = null; // the selection the map was last fitted to
  const ll = (id) => plan.venues[id];
  const playerDays = () =>
    plan.days.map((d) => ({
      start: d.start,
      stops: d.stops.map((s, k) => {
        const v = ll(s.id) ?? {};
        const done = plan.statuses[s.id] === "visited" && !isReturnVisit(s, d, plan.outcomes?.[s.id]);
        return { id: s.id, lat: v.lat, lon: v.lon, n: done ? "✓" : k + 1, ...(done ? { color: "var(--done)" } : s.pinned === "followup" ? { cls: "fu" } : {}), name: v.name, genre: cap(genreLabel(v)) || (v.contact ? "My contact" : "Bar or restaurant"), rank: plan.pool.ids.indexOf(s.id) + 1 || null, N: plan.pool.N, reason: doorReason(plan, s.id), eta: s.eta, wait: s.waitMin ?? 0, est: s.source !== "ors", image: v.image ?? null };
      }),
      corridor: d.corridor ?? null, // V5 (public/ui/corridor.js)
    }));

  let rankMarkers = [];
  let rankRooms = [];
  let popup = null;
  const closePopup = () => {
    popup?.remove();
    popup = null;
    const pc = $("#p-card", root);
    if (pc) pc.hidden = true;
  };
  function drawMap() {
    if (!map) return;
    clearMarkers(markers);
    markers = [];
    const starts = new Map();
    for (const d of plan.days) if (d.start) starts.set(`${d.start.lat},${d.start.lon}`, d.start);
    for (const s of starts.values()) markers.push(addStart(map, s));
    clearMarkers(rankMarkers);
    const rest = unscheduledIds(plan).filter((id) => Number.isFinite(ll(id)?.lat));
    rankRooms = layers.rest ? rest.map((id) => ({ id, lat: ll(id).lat, lon: ll(id).lon, n: plan.pool.ids.indexOf(id) + 1 || null, name: ll(id).name, added: !!ll(id).added })).reverse() : [];
    rankMarkers = addRankPins(map, rankRooms, { onClick: (r) => openCard(r.id) });
    $("#p-legend", root).hidden = true;
    // fit when the selection changes (a status change keeps the view where the rep has it)
    const fitView = fitted !== String(sel);
    fitted = String(sel);
    const ob = $("#t-others", root);
    if (ob) ob.hidden = !othersApply();
    player?.draw({ fitView });
    declutter();
    weekClouds();
  }
  // WHY-VIZ-SPEC §6: picture 2's clouds under the week's loops while the Week tab is up and the Why drawer is closed
  // (open, the drawer paints its own, with pills; closed again, plan.js paints these back)
  // Round 5 #2b: the Neighbourhoods toggle on the map draws the same clouds with their pills on any tab; a cloud or pill
  // tapped opens the Why drawer on that area (the full picture: the list, the legend, the area's doors).
  function weekClouds() {
    if (!map) return;
    const on = () => (sel === "week" || layers.hoods) && view !== "add" && $("#why", root)?.hidden !== false;
    const leg = $("#p-hoodleg", root);
    if (on()) paintWeekClouds(map, { plan, routes, profile, famous: !!st.famous, hoods, cityKey: c.key, cityName: c.name, still: () => !dead && on(), pills: layers.hoods, onTap: layers.hoods ? openWhyArea : null })
      .then((m) => { if (leg && m && layers.hoods && on()) { leg.innerHTML = hoodLegend(m); leg.hidden = false; } })
      .catch((e) => console.error(e));
    else { clearWeekClouds(map); if (leg) leg.hidden = true; }
  }
  const hoodLegend = (m) => [...CLASSES.filter((k) => m.areas.some((a) => a.cls === k.cls)), ...(m.areas.some((a) => !a.top) ? [NO_CLASS] : [])].map((k) => `<span><i style="background:${k.colour}"></i>${esc(k.word)}</span>`).join("") || `<span>No part of ${esc(c.name)} holds 3 or more of your drinker's doors</span>`;
  function openWhyArea(key) {
    const el = $("#why", root);
    if (!el) return;
    setWhyArea(el, key);
    if (el.hidden) $('[data-drawer="why"]', root)?.click();
    else drawWhy();
  }
  // round 8 (Jard 10-28): the layer toggles sit under the Doors-logo button at the map's top-left; a tap opens them, a
  // tap on the button again, anywhere outside, or Escape shuts them. Shut on every load (the map stays quiet). The
  // button shows a dot while Neighbourhoods is on (the one layer that adds to the map; Other days is on by default).
  const layBtn = $("#t-layers", root);
  const layBox = $("#p-layers", root);
  const layersOpen = (on) => { if (!layBtn || !layBox) return; layBox.hidden = !on; layBtn.setAttribute("aria-expanded", String(on)); };
  layBtn?.addEventListener("click", () => layersOpen(layBox.hidden));
  const onLayersDown = (e) => { if (layBox && !layBox.hidden && !e.target.closest?.("#p-hoods")) layersOpen(false); };
  const onLayersKey = (e) => { if (e.key === "Escape" && layBox && !layBox.hidden) { layersOpen(false); layBtn.focus(); } };
  document.addEventListener("pointerdown", onLayersDown, true);
  document.addEventListener("keydown", onLayersKey);
  $("#t-hoods", root)?.addEventListener("click", (e) => {
    layers.hoods = !layers.hoods;
    e.currentTarget.setAttribute("aria-pressed", String(layers.hoods));
    if (layBtn) layBtn.dataset.on = String(layers.hoods);
    weekClouds();
  });
  $("#t-others", root)?.addEventListener("click", (e) => {
    layers.others = !layers.others;
    e.currentTarget.setAttribute("aria-pressed", String(layers.others));
    try { localStorage.setItem(OTHERS_KEY, layers.others ? "on" : "off"); } catch {}
    player?.draw(); // no fitView: the camera stays put
    declutter();
  });
  // intuitiveness audit #6: tags that would cover a day pin or a better-ranked tag become dots (map.js)
  const declutter = () => requestAnimationFrame(() => declutterRanks(map, rankMarkers, rankRooms));

  // A ranked room's card on the map (G3): the door card's header, shrunk (photo, name, one line, rank), Qloo's crowd
  // line, Open the door + Website, Add to.
  async function openCard(id) {
    const v = plan.venues[id];
    if (!map || !v) return;
    const city = await getJSON(`/data/cities/${c.key}.json`).catch(() => null);
    if (dead) return;
    closePopup();
    const crowd = city?.pitches?.[id] ? pitchOf(v, city).lines.find((l) => /crowd/i.test(l.label ?? ""))?.text : null;
    const rk = rankText(id);
    const why = restReason(plan, id);
    const meta = [cap(genreLabel(v)) || "Bar or restaurant", v.rating ? `★ ${Number(v.rating).toFixed(1)}` : "", streetOf(v.address)].filter(Boolean);
    const web = hasWebsite(v) ? `<a class="btn line" href="${esc(v.website)}" target="_blank" rel="noopener" aria-label="${esc(v.name ?? "")} website (opens in a new tab)">Website ↗</a>`
      : webSearchHref(v, c.name) ? `<a class="btn line" href="${esc(webSearchHref(v, c.name))}" target="_blank" rel="noopener" aria-label="Search the web for ${esc(v.name ?? "")} (opens in a new tab)">Search the web ↗</a>` : "";
    const html = `
      ${v.image ? `<div class="pchero"><img src="${esc(v.image)}" alt="" loading="lazy" onerror="this.parentNode.remove()"></div>` : ""}
      <h4>${esc(v.name ?? id)}</h4>
      <div class="kv">${meta.map(esc).join(" · ")}</div>
      <div class="rk">${rk ? esc(rk) : "Not on the ranked list"}</div>
      ${crowd ? `<p class="crowd"><b>Crowd:</b> ${esc(crowd)}</p>` : doorReason(plan, id) ? `<p class="crowd">${esc(doorReason(plan, id))}</p>` : ""}
      ${why ? `<p class="muted">Not on a day: ${esc(why)}.</p>` : ""}
      <div class="lnks"><button type="button" class="btn primary" data-card-open>Open the door</button>${web}<button type="button" class="btn line" data-card-later aria-pressed="${!!plan.later?.[id]}">${plan.later?.[id] ? "Saved for later ✓" : "Save for later"}</button></div>
      ${S.can("addDoor") ? addChoiceHTML(id) : ""}`;
    cardId = id;
    // a phone's map is too short for a card on it: the card sits under the map instead
    if (matchMedia("(max-width: 900px)").matches) {
      const pc = $("#p-card", root);
      pc.innerHTML = `<button type="button" class="x" data-card-close aria-label="Close">${icon("close", 18)}</button>${html}`;
      pc.hidden = false;
      return;
    }
    const p = (popup = showPopup(map, v, html));
    p.on("close", () => { if (popup === p) popup = null; });
    p.getElement().addEventListener("click", onCard);
    fitCard(p);
  }
  // the card is taller than the old one: pan the map so all of it sits clear of the map's top bar and day chips
  function fitCard(p) {
    const box = map.getContainer().getBoundingClientRect();
    const r = p.getElement().getBoundingClientRect();
    const over = (sel) => [...root.querySelectorAll(sel)].filter((e) => e.getClientRects().length).map((e) => e.getBoundingClientRect());
    const top = Math.max(box.top + 8, ...over(".runbar").map((b) => b.bottom + 8));
    const bottom = Math.min(box.bottom - 8, ...over(".weeklegend").map((b) => b.top - 8));
    const dy = r.top < top ? r.top - top : r.bottom > bottom ? Math.min(r.bottom - bottom, r.top - top) : 0;
    const dx = r.left < box.left + 8 ? r.left - box.left - 8 : r.right > box.right - 56 ? r.right - box.right + 56 : 0;
    if (dx || dy) map.panBy([dx, dy], { duration: isInstant() ? 0 : 300 });
  }
  let cardId = null;
  function onCard(e) {
    if (e.target.closest("[data-card-close]")) return closePopup();
    if (e.target.closest("[data-card-open]")) return void (closePopup(), openStop(cardId, null));
    if (e.target.closest("[data-card-later]")) return void (setLater(cardId, !plan.later?.[cardId]), openCard(cardId));
    const ad = e.target.closest("[data-add-day]");
    if (ad) addDoor(plan.venues[cardId], { date: ad.dataset.addDay || null });
  }
  $("#p-card", root).addEventListener("click", onCard);

  // first plan, then the map. B2: when the building phase will run, the plan is hidden from its first draw (the map
  // can take a few seconds); runBuilding reveals it step by step, and every other path below shows it whole.
  const shell = $(".route", root);
  const unveil = () => delete shell.dataset.b2;
  if (!isInstant() && !builtBefore(profile) && !drive) shell.dataset.b2 = "rank"; // R9: no building phase under drive mode
  await replan();
  if (dead) return () => {};
  if (pending) showPending(pending); // round 4 #6: a Settings form's change, to try first
  if (drive) startDrive(); // R9: #/plan?…&drive=1 opens straight into drive mode
  if (nav && (params.stop || params.why === "1" || params.settings === "1")) syncFrom(params); // ease #5: a reload keeps the door card or Why open; round 8: a form's Back, Settings open
  const startPt = plan.days[0]?.start ?? profile.start;
  try {
    ({ map } = await createMap($("#plan-map", root), { city: c.key, view: { center: [startPt.lon, startPt.lat], zoom: 12 } }));
  } catch {
    $("#plan-map", root).innerHTML = `<div class="empty">The map didn't load. The plan on the left is complete.</div>`;
    unveil();
  }
  // round 8: the rep left the plan for a form while its map loaded (Settings opens on arrival now, so Edit comes sooner);
  // alive() only tells plan from plan, so the page itself is checked
  if (dead || !alive() || !shell?.isConnected) return () => map?.remove();
  if (map) {
    S.setMap(map);
    const wrap = root.querySelector(".mapwrap");
    player = createRoutePlayer({ map, wrap, days: playerDays, selected: () => (typeof sel === "number" ? sel : -1), week: () => sel === "week", visible: (i) => layers.days.has(i) && (layers.others || !othersApply() || i === sel), onPin: (s, i) => openStop(s.id, i), onPlay: watchRoute, controls: !!demo }); // ease #2: Watch the route is the tour's only
    map.on("click", (ev) => { if (setPinMode.on) setPin({ lat: ev.lngLat.lat, lon: ev.lngLat.lng }); });
    map.on("moveend", declutter);
    // ---- B2: the building phase, once per profile per tab, on the first day with doors ----
    // runBuilding owns the reveal: each part of the plan shows at its pill step (data-b2 on .route), and any press
    // cancels it. It claims the map synchronously, before drawMap()'s roads come back, so the player's draw holds off
    // and the finished route is not drawn under the ranking beat.
    const d0 = typeof sel === "number" ? plan.days[sel] : null;
    if (d0?.stops.length && !builtBefore(profile) && !drive) {
      markBuilt(profile);
      fitted = String(sel);
      drawMap();
      const list = $("#p-body .stops", root);
      const rows = (j) => { const li = list.querySelector(`.stop[data-id="${CSS.escape(d0.stops[j].id)}"]`); return [li?.previousElementSibling, li].filter(Boolean); };
      list.querySelectorAll(".stop, .leg").forEach((li) => li.classList.add("b2-hide", "b2-show"));
      const reveal = (j) => rows(j).forEach((li) => li.classList.remove("b2-hide"));
      const ids = plan.pool.ids.filter((id) => Number.isFinite(ll(id)?.lat));
      const kept = new Set(plan.days.flatMap((d) => d.stops.map((s) => ids.indexOf(s.id))).filter((k) => k >= 0));
      const drinker = labelDrinker(plan.pool.label) ?? "your drinker";
      const nDays = plan.days.length; // persona (founder): "fit your 7 days" beside "54 doors over 9 days"
      buildSteps(shell, [
        ["rank", `Ranking ${c.name} doors for ${drinker}`, "Qloo's taste data"],
        ["cull", `${plan.pool.N} ranked · ${kept.size} open when you're free${ownExtra(plan) ? ` · ${ownExtra(plan)}` : ""}`, `fit your ${nDays === 1 ? "day" : `${nDays} days`}`],
        ["plan", `Planning ${cap(d0.day)}`, doors(d0.stops.length)],
        ["route", "Routing from your start", "the doors appear below as the route reaches them"],
      ], `${doors(plan.days.reduce((a, d) => a + d.stops.length, 0))} over ${plan.days.length} day${plan.days.length === 1 ? "" : "s"}`);
      runBuilding(player, {
        wrap, root: shell, day: sel, hideLayers: ["others"], reveal, revealAll: () => d0.stops.forEach((_, j) => reveal(j)),
        ranked: ids.map((id) => [ll(id).lon, ll(id).lat]), kept,
        text: {
          ranking: `Ranking ${c.name} doors for ${drinker}…`,
          caption: (n) => `${n} ${c.name} doors ranked for ${drinker}`,
          kept: `${kept.size} open when you're free and fit your ${nDays === 1 ? "day" : `${nDays} days`}${ownExtra(plan) ? ` · ${ownExtra(plan)}` : ""}`,
          ranked: `${plan.pool.N} doors ranked · keeping the ones open when you're free`,
          planning: `Planning ${cap(d0.day)}…`,
          routing: "Routing from your start…",
          ready: `Your plan is ready: ${doors(plan.days.reduce((a, d) => a + d.stops.length, 0))} over ${plan.days.length} day${plan.days.length === 1 ? "" : "s"}`,
        },
      });
    } else {
      unveil();
      drawMap();
    }
    // ---- end B2 ----
  }
  return () => {
    dead = true;
    window.removeEventListener("resize", dockTools);
    window.removeEventListener("resize", tabEdges);
    closeDrive?.({ quiet: true });
    unmountStop();
    unmountAgent(); // R9 chat agent
    document.removeEventListener("click", onDocClick);
    document.removeEventListener("keydown", onDragKey);
    endDrag(false);
    document.removeEventListener("pointerdown", onDrawerDown, true);
    document.removeEventListener("click", onDrawerClick, true);
    document.removeEventListener("keydown", onDrawerKey);
    document.removeEventListener("pointerdown", onLayersDown, true);
    document.removeEventListener("keydown", onLayersKey);
    root.removeEventListener("click", onMenuBack);
    window.removeEventListener("doors:carry", syncHomeScreen);
    window.removeEventListener("doors:open-stop", onOpenStop);
    window.removeEventListener("doors:stop-closed", onStopClosed);
    window.removeEventListener("doors:late", onLate);
    window.removeEventListener("online", onNet);
    window.removeEventListener("offline", onNet);
    nav?.bind(null);
    window.removeEventListener("doors:why-door", onWhyDoor);
    S.register(null);
    S.setMap(null);
    player?.destroy();
    closePopup();
    map?.remove();
  };
}

// R9 polish (judge walkthrough 5): the left column during the building phase shows its steps (done, now, next) and
// the plan's size, so the first 15 s aren't a blank column. It follows doors:building and goes when the plan shows.
const BUILD_ORDER = ["rank", "cull", "plan", "route"];
function buildSteps(shell, steps, total) {
  const col = shell.querySelector(".rcol");
  if (!col) return;
  col.querySelector(".bsteps")?.remove();
  const el = document.createElement("div");
  el.className = "bsteps";
  el.setAttribute("role", "status");
  el.innerHTML = `<div class="bs-h">Building your plan</div><div class="bs-sum">${esc(total)}</div>
    <ol>${steps.map(([k, t, sub]) => `<li data-s="${k}"><i aria-hidden="true"></i><span>${esc(t)}<small>${esc(sub)}</small></span></li>`).join("")}</ol>`;
  col.prepend(el);
  const at = (stage) => {
    const k = BUILD_ORDER.indexOf(stage);
    el.querySelectorAll("li").forEach((li) => {
      const j = BUILD_ORDER.indexOf(li.dataset.s);
      li.className = j < k ? "done" : j === k ? "on" : "";
    });
  };
  at("rank");
  const on = (e) => {
    const s = e.detail?.stage;
    if (BUILD_ORDER.includes(s)) return at(s);
    window.removeEventListener("doors:building", on);
    el.classList.add("gone");
    setTimeout(() => el.remove(), 450);
  };
  window.addEventListener("doors:building", on);
}

// B2: the building phase runs once per profile per tab; reopening the same plan goes straight to the plan (G7: for
// each saved plan, so switching between them doesn't replay it).
const builtSig = (profile) => JSON.stringify([profile.brand, profile.city, profile.drinks?.map((d) => d.key), profile.venue, profile.pours?.map((r) => r.id), profile.rooms, profile.start, profile.windows, profile.week, profile.visitMin]);
const builtList = () => { try { const v = JSON.parse(sessionStorage.getItem("doors.v2.built") ?? "[]"); return Array.isArray(v) ? v : []; } catch { return []; } };
function builtBefore(profile) {
  return builtList().includes(builtSig(profile));
}
function markBuilt(profile) {
  try { sessionStorage.setItem("doors.v2.built", JSON.stringify([builtSig(profile), ...builtList()].slice(0, 20))); } catch {}
}
