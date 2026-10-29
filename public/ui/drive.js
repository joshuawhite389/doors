// Drive mode (owner review 9, R9 #3): "Start my day" → one door at a time, full screen: who, why, what to say, the
// address and a Navigate link to the maps app; one big "Log visit" that listens (ui/voice.js: the browser's
// speech, else the Worker's) or takes a few typed words; what was said goes to the agent's log-visit tool (lib/drive-log.js, the
// rules parser when the agent can't answer) → the stop is updated → the next door, with Undo. Day progress, Skip for
// now, and a running-late re-plan. Designed for between stops: big targets, nothing to type while moving.
// Reads and writes only through ./state.js (plan.js re-plans and saves); the day logic is lib/drive-day.js, shared with
// the React Native app.
// DOM hooks (the guided demo drives these): #drive, [data-drive-door][data-id], [data-drive-done], [data-drive-sheet],
// #drive-text [data-drive-text], [data-drive-log], [data-drive-save], [data-drive-again], [data-drive-undo],
// [data-drive-skip], [data-drive-close], [data-drive-late], [data-drive-quick=<result>], [data-drive-fualt], [data-drive-noday],
// [data-drive-mic], [data-drive-read], [data-drive-repeat] (Say it again), [data-drive-voice] (Voice on/off).
// Running late (ease #7): [data-drive-latepick] → [data-drive-lateby=15|30|60|0] (0 = On time again); its doors that
// don't fit: [data-drive-latedays] (Move them into the coming days) | [data-drive-latelist] (Put them back on Your list).
// Stop for today (GROUP3 item 9): [data-drive-end] → [data-drive-endok] (Move them into the coming days) |
// [data-drive-endlist] (Put them back on Your list); the debrief's [data-drive-resumeday] (Resume my day: the Undo).
// The day flow (Jard 10-23): [data-drive-close] is Pause (the day keeps its place; the plan says Resume my day),
// [data-drive-remove] → [data-drive-rm=later|drop], [data-drive-end] → [data-drive-endok]; the debrief
// [data-drive-finished]: [data-db-row][data-id] (details: the door's notes), [data-db-book=<id>], [data-db-drop=<id>],
// [data-db-moved] (End my day's doors on the next day: [data-db-undo], [data-db-choose] → [data-db-roll=<date>],
// [data-db-addday]), [data-db-removed] (the doors taken off with Remove from today, not counted).
import * as S from "./state.js";
import { $, $$, esc, cap } from "./dom.js";
import { pickDay, driveQueue, nextAfter, lateness, lateFor, LATE_PICKS, latePickLabel, LATE_CONTROL as LC, navigateUrl, legMiText as mi, DRIVE_WORDS as W } from "../lib/drive-day.js";
import { aboutLines, atDoor } from "../lib/doorcard.js"; // the door card's Crowd line, the same on drive (ease #15)
import { recordOf, debrief, bookDay, leftToday, laterDays, overCapText, LATE_WORDS as LW } from "../lib/day-debrief.js"; // the day flow (Jard 10-23, items 5-9)
import { STOP_WORDS as SW, stopSheet, stopDoneText, undoneText, choiceLabel } from "../lib/day-stop.js"; // Stop for today (GROUP3 item 9)
import { logVisit } from "../lib/drive-log.js";
import { planNames } from "../lib/agent-context.js";
import { isSkip, sayOutcome } from "../lib/visit-parse.js";
import { makeOutcome, returnVisitLabel, outcomeText, localStamp, QUICK_TEXT } from "../lib/outcome.js";
import { niceDate } from "../lib/profile.js";
import { clockShort } from "../lib/schedule.js";
import { loadStopData, modelFor } from "./stop.js";
import { listen as hear, say as voiceSay, sayAgent, hush, canListen, canSay, setVoiceOffline, micLabel, unlockAudio, whenQuiet, voiceUsed, whyCantListen } from "./voice.js"; // voice in any browser
import { savedNavApp, setNavApp, currentNavName, navAppButtons } from "./navapp.js"; // Navigate opens the rep's app (PARITY S14)
import { openTill } from "../lib/pool.js";
import { parseHours } from "../lib/core.js";
import { addressLine } from "../lib/stopmodel.js";
import { replanSummary } from "../lib/planview.js";
import { notesOf, visitNote, makeNote, NOTE_MAX } from "../lib/door-notes.js"; // door notes
import { mountHandsFree, HF_VOICE_OFF } from "./handsfree.js"; // group 3 #8: the hands-free Agent
import { polishBody, polishView, POLISH_PATH, POLISH_LABEL, POLISH_BUSY, POLISH_FOOT } from "../lib/day-polish.js"; // Doors Agent ability 9
import { createMap, setRoute, addPins, addStart, clearMarkers, fitTo } from "./map.js"; // the Day tab's map (the phone's DayMap)
import { roadFor } from "./animate.js";
// judge pass 4 (#16): the opener says where it came from when Qloo's tags chose it ("off the cocktail list" at The
// Yard, a brewery: its tags say Cocktails), so a line that reads odd for the room shows its grounds
// intuit audit #4: no source line under the opener in the field; each line's source is on the door's Talking points
// door notes on the drive screen: the newest three, read before walking in (edit them on the stop)
import { fitDriveResult, movedDriveResult, comeBackDay, driveSpeech, altLabel, otherFollowUps, keptText } from "../lib/fu-check.js";
import { icon } from "../lib/icons.js"; // the Doors icon set (Jard 10-24 #1)
const voiceHTML = (on) => `${icon(on ? "voice" : "mute", 16, "ic l")}Voice ${on ? "on" : "off"}`;
const MIC_HOW = `${icon("mic", 20, "ic l")}Tap and say how it went`;
const PHONE_VOICE = "The Doors voice isn't available right now: this is the browser's own voice.";

const CSS = "/css/drive.css";
if (typeof document !== "undefined" && !document.querySelector(`link[href="${CSS}"]`)) {
  const l = document.createElement("link");
  l.rel = "stylesheet";
  l.href = CSS;
  document.head.append(l);
}

// Voice on/off (the phone's switch): read-backs and questions are spoken while on; "Read it to me" always speaks.
// Remembered on this device (a convenience: storage may be blocked).
const VOICE_KEY = "doors:drive-voice";
let voiceOn = (() => { try { return localStorage.getItem(VOICE_KEY) !== "off"; } catch { return true; } })();
// a leg's miles, labelled road or estimated (§9.4)

// openDrive({now}) → close({quiet}). now() → {date, min} (the plan view's clock).
// The guided demo makes no live calls (preaudit): while it runs, a visit is read by the rules parser in the
// page and never sent to /api/agent/log-visit.
let offline = false;
// Doors Agent ability 9: the Day done polish, per day ({date, busy, view}); only on the rep's tap, never in the demo
let polish = null;
export const setDriveOffline = (v) => { offline = !!v; setVoiceOffline(v); };

// by: open already running this many minutes late (ease audit 2 #3: the Agent's "I'm running late")
// resume: the plan's Resume my day on a day stopped today: the stopped doors come back first (S.undoDayChange)
export function openDrive({ now, onClose = () => {}, by = 0, resume = false }) {
  const el = document.createElement("section");
  el.id = "drive";
  el.className = "drive";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.setAttribute("aria-label", "Start my day");
  el.innerHTML = `<div class="dv-body"></div><div class="dv-toast" role="status" aria-live="polite" hidden></div>`;
  const body = el.firstElementChild;
  document.body.append(el);
  unlockAudio(); // Start my day's tap: the one <audio> plays a silence now, so every later voice plays without a tap
  document.documentElement.classList.add("driving");
  // polish2: a modal for keyboards too: Tab stays in drive mode instead of walking the plan behind it (the tour's card
  // and Ask live outside .app, so they stay reachable)
  const behind = document.querySelector("body > .app");
  behind?.setAttribute("inert", "");

  const plan = () => S.getPlan();
  let date = pickDay(plan(), now())?.day.date ?? null; // the day being driven (by date: indices can shift)
  let endUndo = null; // the debrief's Undo of End my day: the snapshot from before it (this visit to drive mode only)
  let choosing = false; // the debrief's "Choose another day" is open
  // "Running late" said by the rep (ease audit #7): minutes late on this day (0 = the clock alone), and its picker open
  let lateBy = 0;
  let latePicking = false;
  let lateDate = null; // the day lateBy was said for: another day starts on time
  const lateOf = (q, p) => { if (lateDate !== q.day.date) (lateBy = 0), (lateDate = q.day.date); return lateFor(q, now(), lateBy, { visitMin: p.profile?.visitMin ?? 25, today: q.day.date === now().date }); };
  // say how late (a pick, or the Agent): up to the late line, first on the door (under the sticky header otherwise)
  function setLate(b) {
    lateBy = b;
    lateDate = date;
    latePicking = false;
    screen = "door";
    viewId = null;
    render();
    if (lateBy) el.scrollTo?.({ top: 0 });
  }
  let screen = "door"; // "door" | "day" (the phone's Door / Day tabs; Ask is the Ask Doors button)
  let viewId = null; // a stop opened from the Day list that isn't the current door (the phone's "viewed" door)
  let sheet = null; // {id, phase: "listen" | "type" | "read" | "ask", text, result, error}
  let stopRec = null; // ends the listening under way (voice.js)
  // a note on the door from the road (PARITY M1, the phone's Drive.tsx the same): said → saved at once; typed → Save note
  let note = { id: null, phase: "idle", secs: 0, live: "", error: null }; // the door the mic was started on, and its phase
  let noteStop = null; // ends the note's listening
  let noteBox = null; // the typed box: null (closed) or {id, text}
  let micT = null; // the seconds on a listening mic
  let navPick = false; // "Change" under Navigate is open
  let data = null; // the stop data (talking points), loaded once
  let busy = false;
  let readKey = null; // "read" (Read it to me) | "repeat" (Say it again) while that button's words are being read
  let sheetHeld = false; // the hands-free Agent is paused for the Log visit sheet
  let noteHeld = false; // … or for the note mic
  let phoneVoiceSaid = false; // the one toast when a read-aloud had to use the browser's own voice
  let toastT = null;
  let wake = null;
  let dayMap = null; // the Day tab's map: {el, map, key, marks}; one element, moved into each redraw of the Day tab
  const fuFrom = () => (date > now().date ? date : now().date); // a follow-up goes after the later of today and the day on screen
  const rec = (d = date) => recordOf(plan()?.drive, d);
  const dayIndex = () => (plan()?.days ?? []).findIndex((d) => d.date === date && (d.stops.length || rec().ended)); // an ended day keeps its debrief

  loadStopData(plan()).then((d) => { data = d; if (!sheet) render(); }).catch(() => {});
  try { navigator.wakeLock?.request("screen").then((w) => (wake = w)).catch(() => {}); } catch {}

  function render() {
    const p = plan();
    if (!p) return void (body.innerHTML = `<div class="dv-empty"><p>Your plan is loading…</p></div>`);
    if (date == null || dayIndex() < 0) date = pickDay(p, now())?.day.date ?? null;
    const k = dayIndex();
    if (k < 0) {
      body.innerHTML = `${top(null)}<div class="dv-empty"><h2>No doors on a day ahead</h2><p>Add a day or a door in the plan, then start your day.</p><button type="button" class="dv-big line" data-drive-close>Back to the plan</button></div>`;
      return;
    }
    const q = driveQueue(p, k);
    const today = q.day.date === now().date;
    holdHands();
    // what the rep is typing survives a redraw (a voice answer or failure can arrive mid-word)
    const box = $("#drive-text", el);
    const typing = box && document.activeElement === box ? [box.selectionStart, box.selectionEnd] : null;
    if (box && sheet && (sheet.phase === "type" || sheet.phase === "listen" || sheet.phase === "reading") && box.value && !busy) sheet.text = box.value;
    const nbox = $("#drive-note", el);
    if (nbox && noteBox) noteBox.text = nbox.value;
    const ntyping = nbox && document.activeElement === nbox ? [nbox.selectionStart, nbox.selectionEnd] : null;
    const viewed = viewId ? q.stops.find((x) => x.id === viewId && x.id !== q.current?.id) ?? null : null;
    if (!viewed) viewId = null;
    body.innerHTML = `${top(q, today)}${screen === "day" ? dayHTML(p, q) : viewed ? doorHTML(p, q, k, today, viewed) : q.finished ? doneHTML(p, q, k) : doorHTML(p, q, k, today)}${sheet ? sheetHTML() : ""}`;
    const box2 = typing && $("#drive-text", el);
    if (box2) box2.focus({ preventScroll: true }), box2.setSelectionRange(...typing);
    else if (sheet) focusSheet();
    const nbox2 = ntyping && !sheet && $("#drive-note", el);
    if (nbox2) nbox2.focus({ preventScroll: true }), nbox2.setSelectionRange(...ntyping);
    if (screen === "day") showDayMap(p, q);
    placeToast();
  }

  // The Day tab's map (the phone's DayMap): the start, the day's doors numbered in order (green = current, grey = done,
  // orange = later), the road when there is one, else the dashed straight line, labelled. A pin opens its door.
  function showDayMap(p, q) {
    const slot = $("[data-drive-map]", el);
    if (!slot || !window.maplibregl) return;
    if (!dayMap) {
      const box = document.createElement("div");
      box.className = "dv-mapbox";
      box.innerHTML = `<div class="dv-mapgl" data-testid="day-map"></div><p class="dv-mapsrc" data-route-source></p>`;
      dayMap = { el: box, map: null, key: "", marks: [] };
      const pts = [[q.day.start.lon, q.day.start.lat], ...q.stops.filter((x) => x.venue).map((x) => [+x.venue.lon, +x.venue.lat])];
      const lons = pts.map((c) => c[0]), lats = pts.map((c) => c[1]);
      createMap(box.firstElementChild, { city: p.city?.key, view: { bounds: [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], padding: 40 } })
        .then(({ map }) => { if (!dayMap) return void map.remove(); dayMap.map = map; dayMap.key = ""; if (screen === "day") drawDayMap(); })
        .catch(() => { box.firstElementChild.innerHTML = `<p class="dv-mapsrc">The map didn't load. The list below has every door.</p>`; });
    }
    slot.replaceWith(dayMap.el);
    dayMap.map?.resize();
    drawDayMap();
  }
  async function drawDayMap() {
    const m = dayMap?.map;
    const p = plan();
    const k = p ? dayIndex() : -1;
    if (!m || k < 0) return;
    const q = driveQueue(p, k);
    const stops = q.stops.filter((x) => x.venue && Number.isFinite(+x.venue.lat));
    const key = `${q.day.date}|${stops.map((x) => `${x.id}${x.done ? "+" : ""}`).join()}|${q.current?.id ?? ""}`;
    if (key === dayMap.key) return;
    dayMap.key = key;
    const road = await roadFor(q.day.start, stops.map((x) => ({ lat: +x.venue.lat, lon: +x.venue.lon })));
    if (dayMap?.key !== key) return; // a newer draw is under way
    const solid = road.source !== "estimate";
    setRoute(m, road.geometry.coordinates, { id: "dv-route", color: "#2f7d4f", width: solid ? 4 : 3, dash: !solid, paint: true });
    clearMarkers(dayMap.marks);
    const pins = stops.map((x) => ({ id: x.id, lat: +x.venue.lat, lon: +x.venue.lon, n: x.n, color: x.id === q.current?.id ? "#2f7d4f" : x.done ? "#9a9187" : "#c0612b" }));
    dayMap.marks = [addStart(m, q.day.start), ...addPins(m, pins.slice().reverse(), { onClick: (s) => { screen = "door"; viewId = s.id; render(); window.scrollTo?.(0, 0); } })]; // reversed: the current door and the early stops sit on top
    fitTo(m, [[q.day.start.lon, q.day.start.lat], ...pins.map((x) => [x.lon, x.lat])], { padding: { top: 52, bottom: 30, left: 30, right: 44 } }); // clear of the source chip and the zoom buttons
    const src = $("[data-route-source]", dayMap.el);
    if (src) src.textContent = solid ? road.label || "Roads" : "Route estimated: straight lines between stops";
  }

  function top(q, today) {
    const dots = q ? q.stops.map((s) => `<i class="${s.done ? "on" : q.current?.id === s.id ? "cur" : ""}"></i>`).join("") : "";
    return `<header class="dv-top">
      <button type="button" class="dv-x dv-pause" data-drive-close aria-label="${q && today && !q.finished ? "Pause your day: back to the plan, it keeps your place" : "Back to the plan"}">${q && today && !q.finished ? "<span class=\"dv-bars\" aria-hidden=\"true\"><i></i><i></i></span><small>Pause</small>" : icon("close", 22)}</button>
      <button type="button" class="dv-askfab" data-drive-ask aria-controls="agentPanel">Agent</button>
      <div class="dv-day">${q ? `<b>${today ? "Today" : esc(W.dayTitle(q.day.date))}</b>${today ? "" : `<small class="dv-ahead">${esc(W.notToday(q.day.date, now().date))}</small>`}<span>${q.finished && canResume() ? "Stopped for today" : W.progress(q)}</span><b class="dv-line">${esc(q.finished && canResume() ? "Today · Stopped for today" : W.dayLine(q, q.day.date, today))}</b>${today ? "" : `<small class="dv-ahead dv-line">${esc(W.previewShort(q.day.date, now().date))}</small>`}` : "<b>Start my day</b>"}</div>
      ${q ? `<div class="dv-dots" aria-hidden="true">${dots}</div>` : ""}
      <div class="dv-tabs">${q && !(q.finished && rec(q.day.date).ended) ? `<button type="button" class="dv-voice" data-drive-screen="${screen === "day" ? "door" : "day"}" aria-pressed="${screen === "day"}">${screen === "day" ? "Back to the door" : `All ${q.total} stops`}</button>` : ""}
      <button type="button" class="dv-voice" data-drive-voice aria-pressed="${voiceOn}">${voiceHTML(voiceOn)}</button></div>
    </header>`;
  }

  // Running late's doors that don't fit today (GROUP3 item 9): the same two choices as Stop for today, with what Move
  // would do (lib/day-stop.js stopSheet: End my day's roll, so a full day sends the lowest-fit back on Your list, said).
  // No later day: Put them back on Your list, or Stop for today.
  function lateHTML(p, q, out, today) {
    const later = laterDays(p, q.day.date).length > 0;
    const can = S.can("lateRehome");
    const what = later ? stopSheet(p, out, q.day.date).days : LW.noDay(out.length);
    return `<p class="dv-late-what" data-drive-late-what>${esc(what)}</p><div class="dv-late-acts">${later && can ? `<button type="button" class="dv-mid" data-drive-latedays>${esc(choiceLabel("days", out.length))}</button>` : ""}${can ? `<button type="button" class="dv-mid line" data-drive-latelist>${esc(choiceLabel("list", out.length))}</button>` : ""}${!later && today && S.can("endDay") ? `<button type="button" class="dv-mid line" data-drive-end>${esc(SW.button)}</button>` : ""}</div>`;
  }

  function doorHTML(p, q, k, today, viewed = null) {
    const c = viewed ?? q.current;
    const v = c.venue ?? {};
    const m = data ? safeModel(p, c.id, k) : null;
    const late = viewed ? null : lateOf(q, p);
    if (!viewed) lateShown = late?.text ?? "";
    const nx = viewed ? null : nextAfter(q);
    const last = p.outcomes?.[c.id] ? outcomeText(p.outcomes[c.id]) : "";
    // the door card's words (ease audit #15): its Crowd (or The room) line, and "Why this door" = the reason in words
    // (judge pass 8 #2: no "#5 of 55" at the door; the rank is in Why this door)
    const crowd = (m ? aboutLines(m).find((x) => x.key === "crowd" || x.key === "room") : null) ?? (v.crowd ? { title: "Crowd", text: v.crowd } : null);
    const t = m?.talk;
    // intuit pass 2 #3: who to ask for sits over the opener, as on the door card ("Ask for the taproom manager or an owner")
    const who = m ? atDoor(m).askFor : null;
    const nav = navigateUrl(v, navigator.userAgent, savedNavApp());
    const fu = returnVisitLabel(c.stop, q.day, p.outcomes?.[c.id]); // with the day she said when the planner moved it
    // audit 2 #8: what to say sits right under the door's name (it was two scrolls down, under an empty notes box); the
    // reasons and your notes follow it
    return `<main class="dv-door" data-drive-door data-id="${esc(c.id)}"${viewed ? " data-drive-viewed" : ""}>
      ${viewed ? `<button type="button" class="dv-viewing" data-drive-back>Not your current door${c.done ? " (done)" : ""} · Back to ${esc(q.current?.name ?? "the day")}</button>` : ""}
      ${late ? `<div class="dv-late" data-drive-late role="status"><b>${esc(late.text)}</b>${late.out.length ? lateHTML(p, q, late.out, today) : ""}</div>` : ""}
      <p class="dv-kick">Stop ${c.n} of ${q.total}${Number.isFinite(c.eta) ? ` · planned ${esc(clockShort(c.eta))}` : ""}${fu ? ` · ${esc(fu)}` : ""}</p>
      <h1 class="dv-name">${esc(c.name)}</h1>
      <p class="dv-addr">${esc(addressLine(v.address, p.city?.name ?? p.profile?.cityName))}</p>
      ${m?.hoursToday ? `<p class="dv-hours">${esc(m.hoursToday)}${c.stop.openAtArrival === false ? ` · <b>${esc(openTill(c.stop, { parsed: parseHours(v.hours), day: q.day.day }))}</b>` : ""}</p>` : ""}
      ${last ? `<p class="dv-hours">Last time: ${esc(last)}</p>` : ""}
      ${t ? `<section class="dv-talk">${who ? `<p class="dv-askfor" data-drive-askfor><span>Ask for</span> ${esc(/^(The|A|An|Whoever) /.test(who) ? who[0].toLowerCase() + who.slice(1) : who)}</p>` : ""}<h2>Opener</h2><p class="dv-opener">${esc(t.opener)}</p>${t.toBuyer ? `<h2>To the buyer</h2><p class="dv-opener">${esc(t.toBuyer)}</p>` : ""}
        ${t.questions?.length ? `<h2>Questions</h2><ul>${t.questions.slice(0, 2).map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
        <h2>The ask</h2><p>${esc(cap(t.ask))}.</p>
        ${canSay() ? readBtn("read", "dv-mid", "Read it to me") : ""}</section>` : `<p class="dv-muted">Loading what to say…</p>`}
      ${c.stop.orderReason ? `<p class="dv-hours">Why now: ${esc(c.stop.orderReason)}</p>` : ""}
      ${crowd || m?.whyLine ? `<section class="dv-why">${crowd ? `<h2>${esc(crowd.title)}</h2><p>${esc(crowd.text)}</p>` : ""}${m?.whyLine ? `<h2>Why this door</h2><small>${esc(m.whyLine)}</small>` : ""}</section>` : ""}
      ${notesHTML(p, c.id, c.name)}
      <div class="dv-acts">
        ${viewed ? "" : `<div class="dv-latectl" data-drive-latectl>${latePicking ? `<span>${esc(LC.ask)}</span>${LATE_PICKS.map((x) => `<button type="button" class="dv-chip" data-drive-lateby="${x}" aria-pressed="${lateBy === x}">${esc(latePickLabel(x))}</button>`).join("")}${lateBy ? `<button type="button" class="dv-chip" data-drive-lateby="0">${esc(LC.clear)}</button>` : ""}` : `<button type="button" class="dv-mid line" data-drive-latepick aria-expanded="false">${esc(lateBy ? `${LC.open} · ${latePickLabel(lateBy)}` : LC.shift ?? LC.open)}</button>`}</div>`}
        ${nav ? `<a class="dv-big line dv-nav" data-drive-nav href="${esc(nav)}" target="_blank" rel="noopener"><span>Navigate</span>${c.stop.legMi != null ? ` <small>${esc(mi(c.stop))}</small>` : ""}</a>` : ""}<!-- small (intuitiveness audit pass 1): the distance is a caption that breaks whole, never "Navigate · / 4.4 mi" -->
        <button type="button" class="dv-big primary" data-drive-done>${W.done}</button>
      </div>
      ${nav ? `<div class="dv-navwith" data-drive-navwith>${navPick ? `<span>Navigate with</span>${navAppButtons("dv-mid line")}` : `<button type="button" class="dv-link" data-drive-navpick aria-label="Navigation app: ${esc(currentNavName())}. Change">Opens ${esc(currentNavName())} · <b>Change</b></button>`}</div>` : ""}
      ${viewed ? "" : `<div class="dv-sec">
        ${nx ? `<button type="button" class="dv-mid line" data-drive-skip>${rec().skipped.includes(c.id) ? "Skip again" : "Skip for now"}</button>` : ""}
        ${nx ? `<p class="dv-next">Then: <b>${esc(nx.name)}</b>${nx.stop.legMi != null ? ` · ${esc(mi(nx.stop))}` : ""}</p>` : `<p class="dv-next">Last door of the day</p>`}
      </div>
      <div class="dv-off">${S.can("removeStop") ? `<button type="button" class="dv-mid line" data-drive-remove>Remove from ${today ? "today" : "this day"}</button>` : ""}
        ${today && S.can("endDay") ? `<button type="button" class="dv-mid line" data-drive-end>${esc(SW.button)}</button>` : ""}</div>`}
      <p class="dv-safe">${esc(W.safe(canListen()))}</p>
    </main>`;
  }

  // the door's notes (PARITY M1, as the phone): always shown; the newest 3, a mic "Tap and say a note" (said → saved at
  // once) and "Or type a note" (a box, Save note / Cancel); no mic in this browser: "Add a note". Errors: a plain line.
  function notesHTML(p, id, name) {
    const ns = notesOf(p.slots, id);
    const ph = note.id === id ? note.phase : "idle";
    const mic = canListen() || ph !== "idle";
    const box = noteBox?.id === id ? noteBox : null;
    return `<section class="dv-notes" data-drive-notes data-id="${esc(id)}"><h2>Your notes</h2>
      ${ns.length ? `<ul>${ns.slice(0, 3).map((n) => `<li>${esc(n.text)} <small>${esc(n.who)}</small></li>`).join("")}</ul>${ns.length > 3 ? `<small>${ns.length - 3} more on the stop</small>` : ""}` : ""}
      ${mic ? `<button type="button" class="dv-mic dv-notemic${ph === "listen" ? " on" : ""}" data-drive-notemic aria-pressed="${ph === "listen"}" ${ph === "reading" ? "disabled" : ""}>${ph === "idle" ? icon("mic", 18, "ic l") : ""}${esc(micLabel(ph, note.secs, "Tap and say a note"))}</button>
      <p class="dv-notelive" aria-live="polite">${ph !== "idle" ? esc(note.live) : ""}</p>` : ""}
      ${note.id === id && note.error ? `<p class="dv-err" role="alert">${esc(note.error)}</p>` : ""}
      ${box ? `<form class="dv-type dv-noteform" data-drive-noteform>
        <label for="drive-note">Add a note on ${esc(name)}</label>
        <textarea id="drive-note" rows="2" maxlength="${NOTE_MAX}" placeholder="Add a note: the manager is Priya, back Thursdays">${esc(box.text)}</textarea>
        <div class="dv-notebtns"><button type="submit" class="dv-mid primary">Save note</button><button type="button" class="dv-mid line" data-drive-notecancel>Cancel</button></div>
      </form>` : `<button type="button" class="dv-link" data-drive-notetype>${mic ? "Or type a note" : "Add a note"}</button>`}
    </section>`;
  }
  // a redraw of the notes only (a full one under the rep's thumb loses the tap and the scroll)
  function drawNotes() {
    const sec = $("[data-drive-notes]", el);
    const p = plan();
    if (!sec || !p) return render();
    holdHands();
    const nbox = $("#drive-note", el);
    if (nbox && noteBox) noteBox.text = nbox.value;
    const id = sec.dataset.id;
    sec.outerHTML = notesHTML(p, id, p.venues?.[id]?.name ?? $(".dv-name", el)?.textContent ?? "this door");
  }

  // the phone's Day tab: the day's doors in order; one opens it (the current one goes back to the door)
  function dayHTML(p, q) {
    return `<main class="dv-door dv-daylist" data-drive-daylist><div data-drive-map></div><ol>${q.stops.map((x) => {
      const o = p.outcomes?.[x.id];
      const here = x.id === q.current?.id;
      const bits = [Number.isFinite(x.eta) ? clockShort(x.eta) : "", x.venue?.neighborhood ?? "", p.statuses?.[x.id] ?? "", o ? outcomeText(o) : ""].filter(Boolean).join(" · ");
      return `<li><button type="button" class="dv-row${here ? " here" : ""}${x.done ? " done" : ""}" data-drive-open="${esc(x.id)}"><b>${x.n}</b><span><i>${esc(x.name)}</i><small>${esc(bits)}${here ? " · current" : ""}</small></span></button></li>`;
    }).join("")}</ol></main>`;
  }

  // Doors Agent ability 9: the polish button, then its notes (the template above them always stays)
  function polishHTML(date) {
    if (offline) return "";
    const pl = polish?.date === date ? polish : null;
    if (!pl) return `<div class="db-acts"><button type="button" class="dv-chip" data-db-polish>${esc(POLISH_LABEL)}</button></div>`;
    if (pl.busy) return `<p class="db-none" data-db-polishing role="status">${esc(POLISH_BUSY)}</p>`;
    const v = pl.view;
    if (v.failed) return `<p class="db-none" data-db-polish-failed role="status">${esc(v.failed)} <button type="button" class="dv-chip" data-db-polish>Try again</button></p>`;
    return `<section class="db-sec" data-db-polished><h2>Doors Agent's notes</h2>${v.summary ? `<p>${esc(v.summary)}</p>` : ""}
      ${v.doors.length ? `<ul class="db-steps">${v.doors.map((d) => `<li><b>${esc(d.name)}</b><span>${esc(d.note)}</span></li>`).join("")}</ul>` : ""}
      ${v.next.length ? `<h2>Next</h2><ul class="db-steps">${v.next.map((x) => `<li><span>${esc(x)}</span></li>`).join("")}</ul>` : ""}
      <p class="db-none">${esc(POLISH_FOOT)}${v.model ? ` ${esc(v.model)}.` : ""}</p></section>`;
  }
  async function polishDay() {
    const p = plan();
    const q = driveQueue(p, dayIndex());
    const date = q.day.date;
    if (polish?.date === date && polish.busy) return;
    polish = { date, busy: true };
    render();
    let r = null;
    try {
      const res = await fetch(POLISH_PATH, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(polishBody(p, q, rec(date))) });
      r = await res.json().catch(() => null);
    } catch {}
    polish = { date, busy: false, view: polishView(r) };
    render();
  }
  // Day done (Jard 10-23, items 7-9): an assistant's debrief of the day, from what was logged and nothing else. Every
  // door is counted once, in the logging answers' words; a door opens to its notes; what to do next comes first.
  function doneHTML(p, q, k) {
    const b = debrief(p, q, rec(q.day.date));
    const from = q.day.date;
    const opts = { windows: p.windows ?? [], week: p.profile?.week ?? null, visitMin: p.profile?.visitMin ?? 25, from };
    const bookOf = (x) => bookDay(x, p.venues?.[x.id], opts) ?? comeBackDay(p.venues?.[x.id], opts).date;
    const m = b.moved;
    const moved = m && `<li data-db-moved><b>${esc(m.head)}</b><span>${esc(m.body)}${m.cap ? ` ${esc(m.cap)}` : ""}</span>
      <div class="db-acts">${endUndo && !canResume() && S.can("restore") ? `<button type="button" class="dv-chip" data-db-undo>Undo</button>` : ""}
      ${m.choose.length && S.can("rollDay") ? `<button type="button" class="dv-chip" data-db-choose aria-expanded="${choosing}">Choose another day</button>` : ""}
      ${m.none && S.can("editTo") ? `<a class="dv-chip" data-db-addday href="${esc(S.editTo())}">Add a day</a>` : ""}</div>
      ${choosing && m.choose.length ? `<div class="db-acts" data-db-days role="group" aria-label="Move them to">${m.choose.map((x) => `<button type="button" class="dv-chip" data-db-roll="${esc(x.date)}">${esc(niceDate(x.date))}</button>`).join("")}</div>` : ""}</li>`;
    const steps = [
      ...(moved ? [moved] : []),
      ...b.booked.map((x) => `<li><b>${esc(x.name)}</b><span>Follow up ${esc(x.text)}</span></li>`),
      ...b.suggest.slice(0, 4).map((x) => { const d = bookOf(x); return `<li><b>${esc(x.name)}</b><span>${esc(x.text)}</span>${d ? `<button type="button" class="dv-chip" data-db-book="${esc(x.id)}" data-date="${esc(d)}">Follow up ${esc(niceDate(d))}</button>` : ""}</li>`; }),
      ...(b.next ? [`<li><b>${esc(niceDate(b.next.date))}</b><span>${esc(b.next.text)}</span><button type="button" class="dv-chip" data-drive-day="${esc(b.next.date)}">Preview</button></li>`] : []),
    ];
    const row = (r) => `<li><details class="db-row${r.bucket === "notvisited" || r.bucket === "removed" ? " off" : ""}" data-db-row data-id="${esc(r.id)}"${r.notes.length || r.bucket === "notvisited" || r.bucket === "removed" ? "" : " data-empty"}>
        <summary><i>${r.n ?? "–"}</i><span><b>${esc(r.name)}</b><small>${r.bucket === "removed" ? esc(r.detail) : `${esc(r.label)}${r.detail ? ` · ${esc(r.detail)}` : ""}`}</small></span>${r.notes.length ? `<em>${r.notes.length === 1 ? "1 note" : `${r.notes.length} notes`}</em>` : ""}</summary>
        ${r.notes.length ? `<ul class="db-notes">${r.notes.map((n) => `<li>${esc(n.text)} <small>${esc(n.who)}</small></li>`).join("")}</ul>` : r.bucket === "notvisited" || r.bucket === "removed" ? "" : `<p class="db-none">No notes from this visit.</p>`}
        ${r.bucket === "notvisited" && !r.where?.dropped && p.statuses?.[r.id] !== "notfit" ? `<button type="button" class="dv-chip" data-db-drop="${esc(r.id)}">Drop it from the plan</button>` : ""}
      </details></li>`;
    return `<main class="dv-door dv-fin" data-drive-finished>
      <p class="dv-kick">${canResume() ? "Stopped for today" : "Day done"} · ${esc(b.dateText)}</p>
      <h1 class="dv-name">${esc(b.title)}</h1>
      <p class="dv-addr">${esc(b.sub)}</p>
      ${b.counts.length ? `<ul class="db-counts" aria-label="Every door, by what happened">${b.counts.map((c) => `<li class="db-${c.key}"><b>${c.n}</b> ${esc(c.label)}</li>`).join("")}</ul>` : ""}
      ${polishHTML(from)}
      ${steps.length ? `<section class="db-sec" data-db-next><h2>Next steps</h2><ul class="db-steps">${steps.join("")}</ul></section>` : ""}
      ${b.rows.length ? `<section class="db-sec" data-db-doors><h2>Every door${b.total > 1 ? ` (${b.total})` : ""}</h2><ol class="db-rows">${b.rows.map(row).join("")}</ol></section>` : ""}
      ${b.removed.length ? `<section class="db-sec" data-db-removed><h2>Removed from ${from === now().date ? "today" : "this day"} (${b.removed.length})</h2><ol class="db-rows">${b.removed.map(row).join("")}</ol></section>` : ""}
      <div class="dv-acts">${canResume() ? `<button type="button" class="dv-big primary" data-drive-resumeday>${esc(SW.resume)}</button>` : ""}<button type="button" class="dv-big line" data-drive-close>Back to the plan</button></div>
    </main>`;
  }
  // Resume my day on a day stopped today (its newest change is the stop): the stopped doors back on today's route
  const canResume = () => date === now().date && S.can("undoDayChange") && rec().ended && (rec().changes ?? []).at(-1)?.kind === "stop";

  // Remove from today / End my day: a short sheet, never a browser dialog
  function offHTML() {
    const p = plan();
    const q = driveQueue(p, dayIndex());
    if (sheet.phase === "remove") {
      const name = p.venues?.[sheet.id]?.name ?? "this door";
      return `<p class="dv-said">Skip for now only moves it to the end of the day. This takes it off for good.</p>
        <div class="dv-acts"><button type="button" class="dv-big line" data-drive-rm="later">Off ${q.day.date === now().date ? "today" : "this day"}: Doors puts it on another day if it fits</button>
        <button type="button" class="dv-big line" data-drive-rm="drop">${esc(W.drop(name))}</button></div>`;
    }
    // Stop for today (GROUP3 item 9): the doors left, and what each choice does with them before the rep picks
    const left = q.stops.filter((s) => !s.done).map((s) => s.id);
    const t = stopSheet(p, left, q.day.date);
    const later = laterDays(p, q.day.date).length > 0;
    return `<p class="dv-said" data-drive-left>${esc(t.head)}</p>
      <div class="dv-acts dv-stopacts">${later ? `<button type="button" class="dv-big primary" data-drive-endok>${esc(choiceLabel("days", left.length))}</button><p class="dv-stopwhat">${esc(t.days)}</p>` : ""}
      <button type="button" class="dv-big ${later ? "line" : "primary"}" data-drive-endlist>${esc(choiceLabel("list", left.length))}</button><p class="dv-stopwhat">${esc(later ? t.list : `${LW.noDay(left.length)} ${t.list}`)}</p>
      <button type="button" class="dv-big line" data-drive-cancel>${esc(SW.keep)}</button></div>`;
  }

  function sheetHTML() {
    const s = sheet;
    const name = plan()?.venues?.[s.id]?.name ?? "this stop";
    if (s.phase === "remove" || s.phase === "end") {
      const h = s.phase === "end" ? SW.title : `Remove ${name}?`;
      return `<div class="dv-sheet" data-drive-sheet role="dialog" aria-modal="true" aria-label="${esc(h)}">
      <div class="dv-sheet-in"><header><h2>${esc(h)}</h2><button type="button" class="dv-x" data-drive-cancel aria-label="Cancel">${icon("close", 18)}</button></header>${offHTML()}</div></div>`;
    }
    const fu = comeBack(s.id); // judge R9: after the day on screen, not today (a previewed day offered itself)
    const quick = `<div class="dv-quick" role="group" aria-label="Or tap what happened">
      <button type="button" class="dv-mid line" data-drive-quick="interested">${QUICK_TEXT.interested}</button>
      <button type="button" class="dv-mid line" data-drive-quick="followup">${esc(QUICK_TEXT.followup(fu.date))}${fu.planDay ? "" : " (not a plan day)"}</button>
      <button type="button" class="dv-mid line" data-drive-quick="someone">${QUICK_TEXT.someone}</button>
      <button type="button" class="dv-mid line" data-drive-quick="no">${QUICK_TEXT.no}</button>
      <button type="button" class="dv-mid line" data-drive-quick="visited">${QUICK_TEXT.visited}</button></div>`;
    let body;
    if (s.phase === "read") {
      body = `<p class="dv-said">${s.text ? `“${esc(s.text)}”` : ""}</p>
        <p class="dv-readback" data-drive-readback>${esc(s.result.say)}</p>
        <p class="dv-src">${esc(W.readBy(s.result.source))}</p>
        <div class="dv-acts"><button type="button" class="dv-big primary" data-drive-save>${esc(W.save)}</button>
        ${s.alt ? `<button type="button" class="dv-big line" data-drive-fualt>Make it ${esc(altLabel(s.alt, " instead"))}</button>` : ""}
        ${s.noDay ? `<button type="button" class="dv-big line" data-drive-noday>Save with no day yet</button>` : ""}
        ${canSay() ? readBtn("repeat", "dv-big", "Say it again") : ""}
        <button type="button" class="dv-big line" data-drive-again>Change it</button></div>`;
    } else {
      const listening = s.phase === "listen";
      const reading = s.phase === "reading";
      body = `${s.ask ? `<p class="dv-readback dv-ask">${esc(s.ask)}</p>` : ""}
        ${canListen() || listening || reading ? `<button type="button" class="dv-mic${listening ? " on" : ""}" data-drive-mic aria-pressed="${listening}" ${reading ? "disabled" : ""}>${listening || reading ? esc(micLabel(s.phase, sheet.secs, "")) : MIC_HOW}</button>
        <p class="dv-live" aria-live="polite">${esc(s.live ?? "")}</p>` : s.error ? `<p class="dv-err" role="alert">${esc(s.error)}</p>` : ""}
        ${quick}
        <form class="dv-type" data-drive-form>
          <label for="drive-text">${canListen() ? "Parked? Or type it" : "How did it go? (park first)"}</label>
          <textarea id="drive-text" data-drive-text rows="2" maxlength="400" placeholder="done, come back Thu at 3, liked it, hesitant about price">${esc(s.text ?? "")}</textarea>
          <button type="submit" class="dv-mid primary" data-drive-log ${busy ? "disabled" : ""}>${busy ? "Reading…" : "Log it"}</button>
        </form>
        ${s.error && (canListen() || listening || reading) ? `<p class="dv-err" role="alert">${esc(s.error)}</p>` : ""}`;
    }
    return `<div class="dv-sheet" data-drive-sheet role="dialog" aria-modal="true" aria-label="${esc(W.sheetTitle(name))}">
      <div class="dv-sheet-in"><header><h2>${esc(W.sheetTitle(name))}</h2><button type="button" class="dv-x" data-drive-cancel aria-label="Cancel">${icon("close", 18)}</button></header>${body}</div></div>`;
  }

  function focusSheet() {
    // never the text box first: on a phone that opens the keyboard (nothing to type while moving)
    const f = $("[data-drive-save]", el) ?? $("[data-drive-mic]", el) ?? $("[data-drive-quick]", el) ?? $("[data-drive-rm], [data-drive-endok], [data-drive-endlist]", el);
    f?.focus({ preventScroll: true });
  }

  const safeModel = (p, id, k) => { try { return modelFor(p, id, k, data); } catch { return null; } };

  // ---------- voice ----------
  // read-backs and questions while Voice is on; a failure says so once, on the toast (the button it came from goes).
  // serverFirst (PARITY S15): the Worker's Aura-2 voice first, as the phone reads, so both sound the same; the
  // browser's own voice when the Worker can't (and in the guided demo, which makes no live calls)
  // (the hands-free Agent's ear is paused while Doors reads, so it never hears itself; one toast the first time the
  // Doors voice couldn't read and the browser's own did)
  const say = async (text, onFail) => {
    hands.pause();
    try {
      const ok = await voiceSay(text, { onFail, serverFirst: true });
      if (ok && voiceUsed() === "browser" && !phoneVoiceSaid) { phoneVoiceSaid = true; toast(PHONE_VOICE); }
      if (ok) await whenQuiet();
      return ok;
    } finally {
      hands.resume();
    }
  };
  const speak = (text) => { if (voiceOn) say(text, (m) => { toast(m); if (!sheet) render(); }); };
  // Read it to me / Say it again (Jard 10-28: "no UI feedback to indicate I pushed anything"): the button is pressed and
  // says Reading… with a Stop beside it until the reading ends (or fails: the toast says why)
  function readBtn(key, cls, label) {
    if (readKey !== key) return `<button type="button" class="${cls} line" data-drive-${key} aria-pressed="false">${key === "read" ? icon("voice", 18, "ic l") : ""}${label}</button>`;
    return `<div class="dv-readrow"><button type="button" class="${cls} reading" data-drive-${key} aria-pressed="true" aria-live="polite">${key === "read" ? icon("voice", 18, "ic l") : ""}Reading…</button><button type="button" class="${cls} line dv-stop" data-drive-stopread aria-label="Stop reading">Stop</button></div>`;
  }
  function drawRead(key, cls, label) {
    const b = $(`[data-drive-${key}]`, el);
    if (!b) return;
    const row = b.closest(".dv-readrow");
    const t = document.createElement("template");
    t.innerHTML = readBtn(key, cls, label);
    (row ?? b).replaceWith(t.content);
  }
  async function readAloud(key, cls, label, text) {
    if (readKey) { hush(); readKey = null; drawRead(key, cls, label); }
    readKey = key;
    drawRead(key, cls, label);
    await say(text, (msg) => { toast(msg); });
    if (readKey === key) { readKey = null; drawRead(key, cls, label); }
  }
  // the hands-free Agent's ear closes while the Log visit sheet or the note mic is up (they use the microphone)
  function holdHands() {
    const sheetUp = Boolean(sheet);
    if (sheetUp !== sheetHeld) { sheetHeld = sheetUp; sheetUp ? hands.pause() : hands.resume(); }
    const noteUp = note.phase !== "idle";
    if (noteUp !== noteHeld) { noteHeld = noteUp; noteUp ? hands.pause() : hands.resume(); }
  }
  // the browser's speech, else the Worker's (voice.js); what failed says why on the sheet, never a made-up "didn't catch"
  function listen() {
    if (!sheet) return;
    stopListening();
    hush();
    const id = sheet.id;
    const mine = () => sheet?.id === id && (sheet.phase === "listen" || sheet.phase === "reading");
    sheet.phase = "listen";
    sheet.live = "";
    sheet.error = null;
    sheet.secs = 0;
    render();
    countSecs(() => (mine() && sheet.phase === "listen" ? sheet : null), () => $("[data-drive-mic]", el));
    const me = {}; // this listening (onFail may come at once, inside hear(), before it returns)
    stopRec = null;
    me.stop = hear({
      onLive: (t) => {
        if (!mine()) return;
        sheet.live = t;
        const lv = $(".dv-live", el);
        if (lv) lv.textContent = t;
      },
      onPhase: (ph) => { if (mine() && sheet.phase !== ph) (sheet.phase = ph), redrawSheet(); },
      onText: (t) => { me.over = true; if (stopRec === me.stop) stopRec = null; if (mine()) submit(t, { spoken: true }); },
      onFail: (msg) => { me.over = true; if (stopRec === me.stop) stopRec = null; if (mine()) (sheet.phase = "type"), (sheet.error = msg), redrawSheet(); },
    });
    if (!me.over) stopRec = me.stop;
  }
  // a voice change on the open sheet touches only the mic, the label and the error line: a full redraw under a tap on
  // an answer or Log it lost the tap (drive-cdp, 10-23)
  function redrawSheet() {
    if (!$("[data-drive-quick]", el) || !$("#drive-text", el)) return render();
    const label = $("label[for=drive-text]", el);
    if (label) label.textContent = canListen() ? "Parked? Or type it" : "How did it go? (park first)";
    const mic = $("[data-drive-mic]", el);
    if (mic && !canListen() && sheet.phase === "type") mic.remove(), $(".dv-live", el)?.remove();
    else if (mic) {
      const on = sheet.phase === "listen";
      mic.classList.toggle("on", on);
      mic.setAttribute("aria-pressed", String(on));
      mic.disabled = sheet.phase === "reading";
      if (on || sheet.phase === "reading") mic.textContent = micLabel(sheet.phase, sheet.secs, ""); else mic.innerHTML = MIC_HOW;
    }
    let e = $(".dv-sheet .dv-err", el);
    if (!sheet.error) return void e?.remove();
    if (!e) (e = document.createElement("p")), (e.className = "dv-err"), e.setAttribute("role", "alert"), $("[data-drive-form]", el)?.after(e);
    e.textContent = sheet.error;
  }
  // stop listening and drop what was heard (cancel, a quick tap, typing)
  function stopListening() {
    const s = stopRec;
    stopRec = null;
    s?.();
  }
  // the seconds on a listening mic, as the phone's: who() → the state with .secs while it listens, btn() → the button
  function countSecs(who, btn) {
    clearInterval(micT);
    const t0 = Date.now();
    micT = setInterval(() => {
      const w = who();
      if (!w) return clearInterval(micT);
      w.secs = Math.floor((Date.now() - t0) / 1000);
      const b = btn();
      if (b) b.textContent = micLabel("listen", w.secs, "");
    }, 1000);
  }

  // ---------- a note on the door (PARITY M1) ----------
  function listenNote(id) {
    stopNote();
    stopListening();
    hush();
    noteBox = null;
    note = { id, phase: "listen", secs: 0, live: "", error: null };
    drawNotes();
    const mine = () => note.id === id && note.phase !== "idle";
    countSecs(() => (mine() && note.phase === "listen" ? note : null), () => $("[data-drive-notemic]", el));
    const me = {};
    // onLive: the words as the browser hears them (the recording's "Listening…" is on the button already)
    me.stop = hear({
      onLive: (t) => { if (!mine() || /^Listening…/.test(t)) return; note.live = t; const lv = $(".dv-notelive", el); if (lv) lv.textContent = t; },
      onPhase: (ph) => { if (mine() && note.phase !== ph) (note.phase = ph), drawNotes(); },
      onText: (t) => { me.over = true; if (noteStop === me.stop) noteStop = null; if (!mine()) return; note = { id: null, phase: "idle", secs: 0, live: "", error: null }; if (!addNote(id, t)) drawNotes(); },
      onFail: (msg) => { me.over = true; if (noteStop === me.stop) noteStop = null; if (mine()) (note = { id, phase: "idle", secs: 0, live: "", error: msg }), drawNotes(); },
    });
    if (!me.over) noteStop = me.stop;
  }
  // drop the note's listening and what was heard
  function stopNote() {
    const s = noteStop;
    noteStop = null;
    if (note.phase !== "idle") note = { id: null, phase: "idle", secs: 0, live: "", error: null };
    s?.();
  }
  // saved as the stop's notes are (lib/door-notes.js makeNote, by "drive"), with a toast and Undo
  function addNote(id, text) {
    const rec = id ? makeNote({ text, by: "drive" }) : null;
    if (!rec || !S.can("setSlot")) return false;
    S.setSlot(id, rec);
    render();
    // the Undo drops that note (the plan's snapshot doesn't hold the notes)
    toast(`Note saved on ${plan()?.venues?.[id]?.name ?? "this door"}: “${rec.value}”.`, () => { S.setSlot(id, { note: rec.id, drop: true }); render(); toast("Undone: that note is gone."); });
    return true;
  }

  // ---------- logging ----------
  // judge pass 4 (#2, #3): a follow-up is checked against the door's hours before it is saved (lib/fu-check.js): a
  // closed day is said and the next open day offered; a time before opening becomes the opening
  const hoursOpts = () => ({ windows: plan()?.windows ?? [], week: plan()?.profile?.week ?? null, visitMin: plan()?.profile?.visitMin ?? 25 });
  const fitHours = (r, ctx) => fitDriveResult(r, plan()?.venues?.[ctx.stop.id], { ...hoursOpts(), next: ctx.next[0]?.name ?? "", others: otherFollowUps(plan()?.outcomes, plan()?.venues, ctx.stop.id) });
  // judge (phone #7): the read-back read aloud is one sentence (lib driveSpeech); the screen keeps every fact
  const speechOf = (r, ctx) => driveSpeech(r, plan()?.venues?.[ctx.stop.id], { ...hoursOpts(), next: ctx.next[0]?.name ?? "", others: otherFollowUps(plan()?.outcomes, plan()?.venues, ctx.stop.id) });
  // the one-tap "Come back" day: the next plan day the door is open, never one it is closed; {date, planDay}
  const comeBack = (id) => comeBackDay(plan()?.venues?.[id], { ...hoursOpts(), from: fuFrom() });
  function ctxFor(id) {
    const p = plan();
    const q = driveQueue(p, dayIndex());
    return {
      stop: { id, name: p.venues?.[id]?.name ?? "", date },
      now: now(),
      windows: (p.windows ?? []).map((w) => w.date),
      next: q.stops.filter((s) => !s.done && s.id !== id).map((s) => ({ id: s.id, name: s.name })),
      names: planNames(p), // the Worker redacts them before the model reads the visit
    };
  }
  async function submit(text, { spoken = false } = {}) {
    if (!sheet || busy) return;
    const t = String(text ?? "").trim();
    if (!t) { sheet.error = "Say or type how it went."; return render(); }
    if (isSkip(t)) { sheet = null; return skip(); }
    busy = true;
    sheet.text = t;
    render();
    if (sheet.phase === "reading" || sheet.phase === "listen") sheet.phase = "type";
    const ctx = ctxFor(sheet.id);
    const r = await logVisit(t, ctx, offline ? { fetch: null } : {}); // r.memory (slot records, CULTURAL-SLOTS §3) is not applied here yet
    busy = false;
    if (!sheet) return;
    if (!r.ok) {
      sheet.phase = "type";
      sheet.ask = r.ask ?? "How did it go: interested, follow up, or not interested?";
      sheet.error = null;
      render();
      speak(sheet.ask); // the phone asks aloud too, typed or said
      return;
    }
    sheet.phase = "read";
    ({ r: sheet.result, alt: sheet.alt, noDay: sheet.noDay } = fitHours(r, ctx));
    sheet.ask = null;
    render();
    speak(speechOf(sheet.result, ctx));
  }
  function quick(kind) {
    if (!sheet) return;
    const ctx = ctxFor(sheet.id);
    const at = `${ctx.now.date}T${String(Math.floor(ctx.now.min / 60)).padStart(2, "0")}:${String(ctx.now.min % 60).padStart(2, "0")}`;
    const outcome = kind === "visited" ? null : makeOutcome({ result: kind, followUp: kind === "followup" ? comeBack(sheet.id).date : "", at });
    const nx = ctx.next[0];
    sheet.phase = "read";
    sheet.text = "";
    ({ r: sheet.result, alt: sheet.alt, noDay: sheet.noDay } = fitHours({ ok: true, source: "rules", visit: { status: "visited", outcome }, say: `Logged ${ctx.stop.name}: ${sayOutcome(outcome).replace(/\.$/, "")}.${nx ? ` Next: ${nx.name}.` : ""}` }, ctx));
    render();
    speak(speechOf(sheet.result, ctx)); // as the phone: a tapped answer is read back too
  }
  // live check E: on a previewed day (not today) the visit happened on that day, at the stop's slot, so the return
  // note thanks them for that day, not for today
  function visitAt(id) {
    const n = now();
    if (!date || date === n.date) return null;
    const eta = driveQueue(plan(), dayIndex()).stops.find((s) => s.id === id)?.eta;
    const m = Number.isFinite(eta) ? eta : n.min;
    return `${date}T${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  }
  async function save() {
    if (!sheet?.result || busy) return;
    const { id } = sheet;
    const at = visitAt(id);
    const result = at && sheet.result.visit.outcome ? { ...sheet.result, visit: { ...sheet.result.visit, outcome: { ...sheet.result.visit.outcome, at } } } : sheet.result;
    busy = true;
    const before = S.snapshot?.() ?? null;
    const prev = { status: plan().statuses?.[id] ?? null, outcome: plan().outcomes?.[id] ?? null };
    sheet = null;
    viewId = null; // as the phone: after a save, back to the current door
    const was = plan();
    let vn = null;
    try {
      await S.setStatus(id, result.visit.status);
      await S.setOutcome(id, result.visit.outcome ?? null);
      // door notes: what the rep said at Done stays on the door (the stop's Notes, the next visit)
      vn = visitNote(result.visit.outcome, { notes: notesOf(plan().slots, id), by: "drive" });
      if (vn && S.can("setSlot")) S.setSlot(id, vn);
    } finally {
      busy = false;
    }
    render();
    // judge pass 5 (#2): a visit that moves doors on another day says so, here where the rep is looking
    const moved = replanSummary(was, plan(), { id, name: plan()?.venues?.[id]?.name });
    // the offer was declined by saving as said: the toast keeps the facts, not the question
    toast(`${keptText(result.say.replace(/ Next: .*$/, ""))}${moved ? ` ${moved.replace(/\.?$/, ".")}` : ""}`, async () => {
      if (before && S.can("restore")) S.restore(before);
      else { await S.setOutcome(id, prev.outcome); await S.setStatus(id, prev.status); }
      if (vn && S.can("setSlot")) S.setSlot(id, { note: vn.id, drop: true });
      render();
      toast("Undone: that stop is back as it was.");
    });
  }
  async function skip() {
    const p = plan();
    const k = dayIndex();
    const q = driveQueue(p, k);
    const c = q.current;
    if (!c || !nextAfter(q)) return render();
    const before = S.snapshot?.() ?? null;
    // Jard 10-23: the old Skip (a place lock at the end) re-planned the day around it and took doors off; skipStop puts
    // the door last on the day being worked and moves nothing else (plan.js, lib/drive-day.js skipToEnd)
    if (S.can("skipStop")) await S.skipStop(c.id);
    else await S.moveStop(c.id, { day: k, index: q.total });
    if (S.can("setDrive")) S.setDrive(q.day.date, (r) => ({ skipped: [...new Set([...(r.skipped ?? []), c.id])] }));
    render();
    const after = driveQueue(plan(), dayIndex());
    const moved = after.current?.id !== c.id;
    const shut = after.stops.find((s) => s.id === c.id)?.stop.openAtArrival === false;
    const others = replanSummary(p, plan(), { id: c.id, name: c.name });
    const text = moved ? `${c.name} moved to the end of the day.${shut ? " It may be closed by then." : ""}${others ? ` ${others.replace(/\.?$/, ".")}` : ""}` : `${c.name} couldn't move: it's still the next door.`;
    toast(text, moved && before && S.can("restore") ? () => { S.restore(before); render(); toast("Undone."); } : null);
  }
  const stamp = () => localStamp(new Date());
  async function removeDoor(how) {
    const id = sheet?.id;
    if (!id || busy) return;
    const p = plan();
    const name = p.venues?.[id]?.name ?? "That door";
    const before = S.snapshot?.() ?? null;
    sheet = null;
    busy = true;
    let ok = false;
    try { ok = await S.removeStop(id, { drop: how === "drop", at: stamp() }); } finally { busy = false; }
    render();
    if (!ok) return toast(`${name} couldn't come off the day.`);
    const b = debrief(plan(), driveQueue(plan(), dayIndex()), rec());
    const w = [...b.rows, ...b.removed].find((r) => r.id === id)?.where;
    toast(how === "drop" ? `${name} is dropped from the plan.` : `${name} is off ${date === now().date ? "today" : "this day"}. ${w ? `${w.text}.` : ""}`, before && S.can("restore") ? () => { S.restore(before); render(); toast("Undone."); } : null);
  }
  // running late's doors that don't fit: into the coming days or back on Your list (plan.js lateRehome), one Undo
  async function lateRehome(how) {
    const p = plan();
    const q = driveQueue(p, dayIndex());
    const ids = lateOf(q, p)?.out ?? [];
    if (!ids.length || busy) return;
    const before = S.snapshot?.() ?? null;
    busy = true;
    let off = false;
    try { off = await S.lateRehome(q.day.date, ids, how, { at: stamp(), by: lateBy }); } finally { busy = false; }
    render();
    if (!off?.length) return toast(`${p.venues?.[ids[0]]?.name ?? "That door"} couldn't come off the day.`);
    const over = how === "days" ? [...new Set(off.map((id) => plan().days.find((d) => d.date > date && d.stops.some((s) => s.id === id))?.date).filter(Boolean))].map((d) => overCapText(plan(), d)).filter(Boolean).join(" ") : "";
    toast([stopDoneText(plan(), off, date, how, { late: true }), over].filter(Boolean).join(" "), before && S.can("restore") ? () => { S.restore(before); render(); toast("Undone."); } : null);
  }
  // Stop for today: how "days" (Move them into the coming days) | "list" (Put them back on Your list)
  async function endMyDay(how = "days") {
    if (busy) return;
    const q = driveQueue(plan(), dayIndex());
    const left = leftToday(q);
    const before = S.snapshot?.() ?? null;
    sheet = null;
    busy = true;
    try { await S.endDay(q.day.date, { ids: left, at: stamp(), how }); } finally { busy = false; }
    viewId = null;
    screen = "door";
    endUndo = before && S.can("restore") ? () => { endUndo = null; choosing = false; S.restore(before); render(); toast("Undone: the day is back on."); } : null;
    render();
    el.scrollTo?.(0, 0); // the debrief from its top (drive mode scrolls itself)
    toast(left.length ? stopDoneText(plan(), left, date, how) : "Stopped for today.", endUndo);
  }
  // Resume my day (the debrief's, or the plan's on a day stopped today): the stopped doors back on today's route
  async function resumeDay() {
    if (busy) return;
    busy = true;
    let u = false;
    try { u = await S.undoDayChange(date); } finally { busy = false; }
    endUndo = null;
    choosing = false;
    screen = "door";
    viewId = null;
    render();
    el.scrollTo?.(0, 0);
    if (!u) return toast("Your day couldn't be resumed.");
    const q = driveQueue(plan(), dayIndex());
    toast(`${undoneText(plan(), u.ids)}${q.current ? ` Picking up at stop ${q.current.n} of ${q.total}: ${q.current.name}.` : ""}`);
  }
  // "Choose another day": End my day's doors to that plan day instead, with Undo
  async function rollTo(to) {
    if (busy) return;
    const before = S.snapshot?.() ?? null;
    choosing = false;
    busy = true;
    let ok = false;
    try { ok = await S.rollDay(date, to); } finally { busy = false; }
    render();
    if (!ok) return toast("They couldn't move to that day.");
    const m = debrief(plan(), driveQueue(plan(), dayIndex()), rec()).moved;
    toast(m?.text ?? `Moved to ${niceDate(to)}.`, before && S.can("restore") ? () => { S.restore(before); render(); toast("Undone."); } : null);
  }
  // the debrief's one-tap follow-up: the outcome as logged, with that day added
  async function book(id, day) {
    const o = plan()?.outcomes?.[id];
    const out = makeOutcome({ result: o?.result ?? "followup", followUp: day, who: o?.who ?? "", note: o?.note ?? "", at: o?.at ?? stamp() });
    if (out.error) return;
    const before = S.snapshot?.() ?? null;
    if (!o) await S.setStatus(id, "visited");
    await S.setOutcome(id, out);
    endUndo = null;
    render();
    toast(`${plan()?.venues?.[id]?.name ?? "That door"}: follow up ${niceDate(day)}.`, before && S.can("restore") ? () => { S.restore(before); render(); toast("Undone."); } : null);
  }
  // never over the door's buttons: above them wherever they sit on screen, else below (the toast covered Done for 10 s
  // after a Skip when they were pinned; webvoice 10-23: at desktop width, not pinned, it sat over Log visit and ate a
  // tap). Again after every render, scroll and resize: the buttons move under a toast already shown.
  function placeToast() {
    const t = $(".dv-toast", el);
    if (!t || t.hidden) return;
    t.style.bottom = "";
    const acts = $(".dv-door .dv-acts", el)?.getBoundingClientRect();
    const box = t.getBoundingClientRect();
    if (acts && acts.height && acts.top < innerHeight && acts.bottom > 0 && acts.top < box.bottom && acts.bottom > box.top)
      t.style.bottom = `${Math.round(acts.top - box.height - 16 >= 0 ? innerHeight - acts.top + 8 : Math.max(8, innerHeight - acts.bottom - box.height - 8))}px`;
    // a long text scrolls (200% zoom); else taps go through the words to what's under them, Undo still takes its own
    const sp = t.querySelector("span");
    t.toggleAttribute("data-scroll", !!sp && sp.scrollHeight > sp.clientHeight + 1);
  }
  el.addEventListener("scroll", placeToast, { capture: true, passive: true });
  window.addEventListener("resize", placeToast);

  function toast(text, undo = null) {
    const t = $(".dv-toast", el);
    if (!t) return;
    t.innerHTML = `<span>${esc(text)}</span>${undo ? `<button type="button" class="dv-mid line" data-drive-undo>Undo</button>` : ""}`;
    t.hidden = false;
    placeToast();
    toast.undo = undo;
    clearTimeout(toastT);
    toastT = setTimeout(() => { t.hidden = true; toast.undo = null; }, undo ? 10000 : 4000);
  }

  // ---------- events ----------
  el.addEventListener("click", (e) => {
    unlockAudio(); // any tap in drive mode: the voice may play on its own after it
    const b = e.target.closest("button, a");
    if (!b || !el.contains(b)) return;
    const d = b.dataset;
    if ("driveClose" in d) return close();
    if ("dbPolish" in d) return void polishDay();
    if ("driveScreen" in d) { screen = d.driveScreen === "day" ? "day" : "door"; viewId = null; return render(); }
    if ("driveOpen" in d) { screen = "door"; viewId = d.driveOpen; render(); return void window.scrollTo?.(0, 0); }
    if ("driveBack" in d) { viewId = null; return render(); }
    if ("driveDone" in d) {
      const id = $("[data-drive-door]", el)?.dataset.id;
      if (!id) return;
      stopNote();
      noteBox = null;
      sheet = { id, phase: canListen() ? "listen" : "type", text: "" };
      if (canListen()) return listen(); // the tap is the gesture the microphone needs
      return render();
    }
    if ("driveCancel" in d) { stopListening(); sheet = null; return render(); }
    if ("driveNotemic" in d) { const id = b.closest("[data-drive-notes]")?.dataset.id; if (!id) return; return note.id === id && note.phase === "listen" ? noteStop?.() : listenNote(id); } // a tap while listening ends it: what was said is saved
    if ("driveNotetype" in d) { const id = b.closest("[data-drive-notes]")?.dataset.id; if (!id) return; stopNote(); note.error = null; noteBox = { id, text: "" }; drawNotes(); return void $("#drive-note", el)?.focus(); }
    if ("driveNotecancel" in d) { noteBox = null; return drawNotes(); }
    if ("navApp" in d) { setNavApp(d.navApp); navPick = false; return render(); }
    if ("driveNavpick" in d) { navPick = true; render(); return void $("[data-nav-app][aria-pressed=true]", el)?.focus(); }
    if ("driveMic" in d) return sheet?.phase === "listen" ? stopRec?.() : listen(); // a tap while listening ends it: what was said is read
    if ("driveQuick" in d) { stopListening(); return quick(d.driveQuick); }
    if ("driveSave" in d) return save();
    if ("driveNoday" in d && sheet?.noDay) { sheet.result = sheet.noDay; sheet.noDay = null; return save(); } // judge pass 6 (#2)
    if ("driveFualt" in d && sheet?.alt) { sheet.result = movedDriveResult(sheet.result, plan()?.venues?.[sheet.id], sheet.alt, { next: ctxFor(sheet.id).next[0]?.name ?? "" }); sheet.alt = null; return render(); }
    if ("driveAgain" in d) { hush(); sheet.phase = canListen() ? "listen" : "type"; sheet.result = null; sheet.alt = null; sheet.noDay = null; return canListen() ? listen() : render(); } // Change it
    if ("driveRepeat" in d && sheet?.result) return void readAloud("repeat", "dv-big", "Say it again", speechOf(sheet.result, ctxFor(sheet.id))); // Say it again
    if ("driveStopread" in d) { hush(); const k = readKey; readKey = null; if (k) drawRead(k, k === "read" ? "dv-mid" : "dv-big", k === "read" ? "Read it to me" : "Say it again"); return; }
    if ("driveVoice" in d) {
      voiceOn = !voiceOn;
      try { localStorage.setItem(VOICE_KEY, voiceOn ? "on" : "off"); } catch {}
      if (!voiceOn) hush(), hands.stop(); // Voice off turns hands-free off too
      else if (!offline && plan() && dayIndex() >= 0) hands.start(driveQueue(plan(), dayIndex()).current?.id ?? null, { reason: whyNoVoice() }); // Voice on: the Agent listens again (or says why it can't)
      b.setAttribute("aria-pressed", String(voiceOn));
      b.innerHTML = voiceHTML(voiceOn);
      return;
    }
    if ("driveUndo" in d) { const u = toast.undo; toast.undo = null; $(".dv-toast", el).hidden = true; return u?.(); }
    if ("driveSkip" in d) return skip();
    if ("driveLatedays" in d) return lateRehome("days");
    if ("driveLatelist" in d) return lateRehome("list");
    if ("driveResumeday" in d) return resumeDay();
    if ("driveRemove" in d) { const id = $("[data-drive-door]", el)?.dataset.id; if (id) (sheet = { id, phase: "remove" }), render(); return; }
    if ("driveEnd" in d) { sheet = { id: null, phase: "end" }; return render(); }
    if ("driveRm" in d) return removeDoor(d.driveRm);
    if ("driveEndok" in d) return endMyDay("days");
    if ("driveEndlist" in d) return endMyDay("list");
    if ("dbBook" in d) return book(d.dbBook, d.date);
    if ("dbDrop" in d) { const id = d.dbDrop; endUndo = null; return S.setStatus(id, "notfit").then(() => render()); }
    if ("dbUndo" in d) { const u = endUndo; $(".dv-toast", el).hidden = true; toast.undo = null; return u?.(); }
    if ("dbChoose" in d) { choosing = !choosing; return render(); }
    if ("dbRoll" in d) return rollTo(d.dbRoll);
    // group 3 #8 (Jard 10-24): with Voice on, the Agent is hands-free (ui/handsfree.js): it listens at once, no chat box.
    // r8hf (Jard 10-28): it never opens the chat box on its own. When it can't listen (Voice off, no microphone in this
    // browser, the microphone failed) the bar says why and offers Listen / Try again and Type instead; only the guided
    // demo (no live calls) goes straight to the panel, whose rules answer there.
    if ("driveAsk" in d) {
      const id = driveQueue(plan(), dayIndex()).current?.id ?? null;
      if (offline) return askPanel(id); // the demo: Doors' own rules answer in the panel
      return hands.start(id, { reason: whyNoVoice() }); // listening, or "Not listening" with the reason (the bar is up already: this listens again)
    }
    if ("driveLatepick" in d) { latePicking = true; render(); return $("[data-drive-lateby]", el)?.focus(); }
    if ("driveLateby" in d) return setLate(+d.driveLateby || 0); // up to the late line, first on the door (under the sticky header otherwise)
    if ("driveDay" in d) { date = d.driveDay; return render(); }
    if ("driveRead" in d) {
      const p = plan();
      const c = driveQueue(p, dayIndex()).current;
      const m = c && data ? safeModel(p, c.id, dayIndex()) : null;
      // what the phone reads: the opener, the questions, the ask (always, Voice on or off: it was asked for)
      if (m) readAloud("read", "dv-mid", "Read it to me", `${m.talk.opener} ${m.talk.toBuyer ? `To the buyer: ${m.talk.toBuyer} ` : ""}${(m.talk.questions ?? []).slice(0, 2).join(" ")} The ask: ${m.talk.ask}.`);
    }
  });
  el.addEventListener("submit", (e) => {
    if (e.target.matches("[data-drive-noteform]")) {
      e.preventDefault();
      const id = noteBox?.id;
      const text = $("#drive-note", el)?.value ?? "";
      if (!id || !text.trim()) return;
      const keep = noteBox;
      noteBox = null;
      if (!addNote(id, text)) noteBox = { ...keep, text };
      return drawNotes();
    }
    if (!e.target.matches("[data-drive-form]")) return;
    e.preventDefault();
    stopListening();
    submit($("#drive-text", el)?.value ?? "");
  });
  const onKey = (e) => {
    if (e.key !== "Escape") return;
    if (!sheet && (noteBox || note.phase !== "idle")) { stopNote(); noteBox = null; return drawNotes(); } // Escape closes the note first
    if (sheet) { stopListening(); sheet = null; render(); } else close();
  };
  document.addEventListener("keydown", onKey);
  // Doors Agent (spec §6): in drive mode its answer is spoken (Aura-2 first), while Voice is on
  // (hands-free reads its own answers: e.detail.quiet)
  const onAgentReply = (e) => { if (voiceOn && e.detail?.mode === "drive" && e.detail.reply && !e.detail.quiet) sayAgent(e.detail.reply, { onFail: (m) => toast(m) }); };
  const askPanel = (id) => window.dispatchEvent(new CustomEvent("doors:ask", { detail: { id } }));
  // why the Agent can't listen right now, in the rep's words; null when it can (voice.js whyCantListen names what the
  // browser lacks: no secure address, no getUserMedia, no AudioContext, offline)
  const whyNoVoice = () => (!voiceOn ? HF_VOICE_OFF : whyCantListen());
  const hands = mountHandsFree({
    onType: () => askPanel(driveQueue(plan(), dayIndex()).current?.id ?? null),
    // Listen / Try again on the bar: Voice off turns on first (the rep asked to be heard); the demo has no voice
    onListen: () => {
      if (offline) return false;
      if (!voiceOn) {
        voiceOn = true;
        try { localStorage.setItem(VOICE_KEY, "on"); } catch {}
        const b = $("[data-drive-voice]", el);
        if (b) { b.setAttribute("aria-pressed", "true"); b.innerHTML = voiceHTML(true); }
      }
      return true;
    },
  });
  window.addEventListener("doors:agent-reply", onAgentReply);
  // ease audit 2 #3: the Agent's "I'm running late" (+15 min…): the same as this screen's Running late picks
  const onLate = (e) => { const b = +e.detail?.by || 0; if (b > 0) setLate(b); };
  window.addEventListener("doors:late", onLate);
  const off = S.onPlanChange(() => { if (!sheet && !busy) render(); });
  // running late shows up on its own: a redraw when the late line would change (not every minute: focus stays put)
  const lateNow = () => { const p = plan(); const k = dayIndex(); if (!p || k < 0) return ""; const q = driveQueue(p, k); return lateOf(q, p)?.text ?? ""; };
  let lateShown = "";
  const tick = setInterval(() => { if (!sheet && !busy && lateNow() !== lateShown) render(); }, 30000);

  function close({ quiet = false } = {}) {
    // Pause (item 5): today's drive keeps its place; the plan's button says Resume my day
    const p = plan();
    const k = p ? dayIndex() : -1;
    if (k >= 0 && date === now().date && !driveQueue(p, k).finished && !rec().ended && S.can("setDrive")) S.setDrive(date, { paused: stamp() });
    stopListening();
    stopNote();
    clearInterval(micT);
    hush();
    off();
    clearInterval(tick);
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("doors:agent-reply", onAgentReply);
    hands.destroy();
    window.removeEventListener("doors:late", onLate);
    window.removeEventListener("resize", placeToast);
    clearTimeout(toastT);
    try { wake?.release(); } catch {}
    try { dayMap?.map?.remove(); } catch {}
    dayMap = null;
    el.remove();
    behind?.removeAttribute("inert");
    document.documentElement.classList.remove("driving");
    if (!quiet) onClose();
  }

  if (by > 0) (lateBy = by), (lateDate = date);
  render();
  if (resume && canResume()) resumeDay();
  // Jard 10-28: always hands-free in drive mode. Voice on: the Agent's bar is up and listening from the start (Start my
  // day's tap is the gesture the microphone needs); when this browser can't listen the bar is up anyway and says why
  // (r8hf: never a silent fall-back to the chat box). Not with Voice off, and not in the guided demo (no live calls).
  if (voiceOn && !offline && plan() && dayIndex() >= 0) hands.start(driveQueue(plan(), dayIndex()).current?.id ?? null, { reason: whyCantListen() });
  // the day's record: started the first time today is opened; a paused day says where it picks up
  {
    const p = plan();
    const k = p ? dayIndex() : -1;
    if (k >= 0 && date === now().date && S.can("setDrive")) {
      const r = rec();
      const q = driveQueue(p, k);
      if (!r.started) S.setDrive(date, { started: stamp(), paused: null });
      else if (r.paused && !q.finished) {
        S.setDrive(date, { paused: null });
        toast(`Welcome back. Picking up at stop ${q.current.n} of ${q.total}: ${q.current.name}.`);
      }
    }
  }
  $("[data-drive-done]", el)?.focus({ preventScroll: true });
  return close;
}
