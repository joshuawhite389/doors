// The stop (SPEC-V2 §3.5, §7, §8; mockup frames 5 and 7). Opens on the `doors:open-stop {id, day}` window event (a
// list row, a map pin). Desktop: the plan's left column swaps to the stop ("← All stops", "Stop N of M", prev/next).
// Phone (≤ 700 px): a bottom sheet over the map at half height; tap or drag the handle up for the full stop. The map
// flies in to the stop. Content (lib/stopmodel.js): photo, name, rank line, facts row with Directions for this leg,
// Why this room, the drafted note (Copy / Email / Text), the talking points (questions tick off), then folded sister
// rooms and the Qloo record. Footer: Mark visited → the outcome sheet (./outcome.js) · Not a fit · Already talked to.
// Writes only through state.js (setStatus, setOutcome); plan.js re-plans and redraws.
import * as S from "./state.js";
import { $, $$, esc } from "./dom.js";
import { getJSON, loadIndex, loadRoutes, loadCityBase } from "./data.js";
import { DAY_COLOURS, flyToStop, fitTo, boundsOf } from "./map.js";
import { reducedMotion, isPhone } from "./animate.js";
import { openOutcome } from "./outcome.js";
import { stopModel, sequenceOf, shortDate, cardFrame } from "../lib/stopmodel.js";
import { dayLabel } from "../lib/planview.js";
import { peopleWho } from "../lib/basis.js";
import { savedNavApp } from "./navapp.js"; // the rep's navigation app (Settings)
import { noteLabel, mailtoHref, smsHref, telHref, directionsUrl, noteText, webSearchHref, TEXT_HINT } from "../lib/note.js";
import { phoneText } from "../lib/talk.js";
import { talkLabel } from "../lib/talk-model.js";
import { defaultFollowUp, outcomeTags, followUpToast } from "../lib/outcome.js";
import { followUpDay, otherFollowUps } from "../lib/fu-check.js";
import { clock12, isoDate, niceDate } from "../lib/profile.js";
import { sistersOf, sisterSummary, sisterOrder } from "../lib/roominsight.js";
import { makeRecord } from "../lib/slots.js";
import { lineSources, sourceRows, talkSummary, QLOO_HEAT } from "../lib/provenance.js";
import { openRoom, closeRoom } from "./room.js";
import { notesOf, makeNote, hasNote, visitNote } from "../lib/door-notes.js"; // door notes
import { atDoor, aboutLines, statusLine, visitLine, dayTally, tallyWords, afterVisit, nextStop, talkCounts } from "../lib/doorcard.js"; // the door card (Jard 10-23 #9)
import { icon } from "../lib/icons.js"; // the Doors icon set (Jard 10-24 #1)
import { liveSets, requestTalk, talkState } from "./talkgen.js"; // group 3 item 3: talking points written per door
import { enrichFacts } from "../lib/enrich.js"; // round 3: the door's enrichment record → facts for the talking points
import { loadEnrich, enrichFor } from "../lib/enrich-client.js";
import { deepFacts, deepFactsFor } from "../lib/deep.js"; // round 3, lane deep: the door's ranked insight facts (gap, neighbours, owner's week)

const CSS = "/css/stop.css";
if (typeof document !== "undefined" && !document.querySelector(`link[href="${CSS}"]`)) {
  const l = document.createElement("link");
  l.rel = "stylesheet";
  l.href = CSS;
  document.head.append(l);
}

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : "");
const colour = (i) => DAY_COLOURS[(Number.isInteger(i) ? i : 0) % DAY_COLOURS.length];

// The data a stop needs beyond the plan: the city file (pitches, sisters, sounds, stored talk lines), the facts and
// the drinker lists (affinity). All static and cached by getJSON.
export async function loadStopData(plan) {
  const [city, facts, routes, hooks, heat, base] = await Promise.all([
    getJSON(`/data/cities/${plan.city.key}.json`).catch(() => null),
    getJSON("/data/facts.json").then((f) => f.facts ?? []).catch(() => []),
    loadIndex().then((index) => loadRoutes(plan.profile, index)).catch(() => []),
    getJSON("/data/culture/hooks.json").catch(() => null), // R9 deep: what a drinker brand's fans also like
    getJSON("/data/culture/heat.json").catch(() => null), // R9 deep: where in town they are
    loadCityBase(plan.city.key).catch(() => null), // WHY-VIZ-SPEC §6: every door Doors holds for this city, the rarity chips' base
  ]);
  // group 3 item 3: the sets written per door (baked for the demo cities; this device's own by key)
  const baked = await getJSON(`/data/talk/${plan.city.key}.json`).then((t) => t?.sets ?? {}).catch(() => ({}));
  // round 3 (lane enrich): the city's baked enrichment records → each door's extra facts (lib/talk-gen.js talkFacts)
  // enrich: {doorId: enrichFacts(record)} (what the talking points read); enrichRecords: {doorId: record} (what the
  // Agent's door block reads, lib/agent-context.js); enrichBaked: the city has a baked file (else each door is fetched
  // live once, below). Lane agent2 reads these: keep the shape.
  const enriched = await loadEnrich(plan.city.key).catch(() => null);
  const enrichRecords = { ...(enriched?.doors ?? {}) };
  const enrich = Object.fromEntries(Object.entries(enrichRecords).map(([id, rec]) => [id, enrichFacts(rec)]));
  // round 3 (lane deep): the ranked insight facts per door (lib/deep.js), for the plan's doors that have a record: the
  // gap between its site and what its crowd buys, the same-crowd and nearby doors' sites, the owner's week. deepNear =
  // the city's baked neighbour map (scripts/deep-bake.mjs → public/data/deep/<city>.json; without it, the doors the
  // page knows coordinates for). talk2's stopModel reads deepFacts; the Agent reads it through agent-context.js.
  const deepNear = await getJSON(`/data/deep/${plan.city.key}.json`).then((d) => d?.near ?? null).catch(() => null);
  const deepFacts_ = deepFactsFor(enrichRecords, { plan, routes, city, near: deepNear, profile: plan.profile ?? {} });
  return { city, facts, routes, hooks, heat, base, captured: routes[0]?.captured ?? null, talkSets: { baked, live: liveSets() }, enrich, enrichRecords, enrichBaked: Boolean(enriched), deepFacts: deepFacts_, deepNear };
}
export const modelFor = (plan, id, day, data) => stopModel({ plan, id, dayIndex: day, ...data });

// ---------- ticks (questions checked off at the door): this device only ----------
const TICKS = "doors.v2.ticks";
const readTicks = () => {
  try { return JSON.parse(localStorage.getItem(TICKS) ?? "{}") ?? {}; } catch { return {}; }
};
const writeTicks = (t) => {
  try { localStorage.setItem(TICKS, JSON.stringify(t)); } catch {}
};

// mountStop(rcol) → cleanup. rcol = the plan's left column.
const enrichAsked = new Set(); // door ids this page has asked /api/enrich for (once each)
export function mountStop(rcol) {
  const el = document.createElement("section");
  el.className = "stopview";
  el.hidden = true;
  el.setAttribute("aria-label", "Stop");
  rcol.append(el);
  let cur = null; // {id, day}
  let data = null;
  let m = null; // the stop model on screen
  let outcomeOpen = false;
  let noteEdit = null; // door notes: the note being edited (its id)
  let pg = null; // the door card's page on screen (talk | notes | message | qloo | rules), null = the card
  let ticks = readTicks();
  let token = 0;

  const plan = () => S.getPlan();

  async function open(id, day, { fly = true } = {}) {
    const p = plan();
    if (!p?.venues?.[id]) return;
    const my = ++token;
    data ??= await loadStopData(p);
    if (my !== token) return;
    cur = { id, day: Number.isInteger(day) ? day : null };
    outcomeOpen = false;
    noteEdit = null;
    pg = null;
    closeRoom({ focus: false }); // G5: the deep-dive belongs to the stop it was opened from
    const fresh = el.hidden;
    el.hidden = false;
    // intuit audit 1b #5: a short phone screen (≤ 700 px tall) opens the sheet full height: half of 568 px left ~170 px
    // to read the door. Pulled down, it is the half sheet; ‹ › keep whichever the rep chose
    if (fresh && isPhone() && innerHeight <= 700) el.classList.add("full");
    rcol.classList.add("stopping");
    document.documentElement.classList.toggle("sheet-open", isPhone());
    render();
    $$(".stop[data-id]", rcol).forEach((x) => x.classList.toggle("sel", x.dataset.id === id));
    if (fly) flyIn();
    if (isPhone()) window.scrollTo({ top: 0, behavior: reducedMotion() ? "auto" : "smooth" });
    $("h2", el)?.focus({ preventScroll: true });
  }

  function close() {
    if (!cur) return;
    closeRoom({ focus: false });
    cur = null;
    m = null;
    el.hidden = true;
    el.classList.remove("full");
    el.innerHTML = "";
    rcol.classList.remove("stopping");
    document.documentElement.classList.remove("sheet-open");
    const map = S.getMap();
    if (map) {
      // back to the whole week (owner review 2: the map keeps the week as its reference; G3)
      const pts = (plan()?.days ?? []).flatMap((x) => [...(x.start ? [[x.start.lon, x.start.lat]] : []), ...x.stops.map((s) => plan().venues[s.id]).filter((v) => Number.isFinite(v?.lat)).map((v) => [v.lon, v.lat])]);
      map.easeTo({ pitch: 0, bearing: 0, duration: reducedMotion() ? 0 : 500 });
      if (pts.length) setTimeout(() => fitTo(map, pts, { padding: 60, duration: reducedMotion() ? 0 : 600 }), reducedMotion() ? 0 : 520);
    }
    rcol.querySelector(".stop.sel .nm")?.focus({ preventScroll: true });
    window.dispatchEvent(new CustomEvent("doors:stop-closed")); // ease #5: the plan drops &stop= from the address
  }

  function flyIn() {
    const map = S.getMap();
    const v = m?.venue;
    if (!map || !v) return;
    if (isPhone()) return flyToStop(map, v, { pitch: 0, reduced: reducedMotion() });
    // intuitiveness audit #7: at desktop width, the stop with its neighbours (before, after, or the day's start), flat,
    // never closer than street-block zoom
    const pts = cardFrame(plan(), cur.id, cur.day);
    if (pts.length < 2) return map.flyTo({ center: [v.lon, v.lat], zoom: 14, pitch: 0, bearing: 0, duration: reducedMotion() ? 0 : 1000 });
    map.fitBounds(boundsOf(pts), { padding: 80, maxZoom: 14.5, pitch: 0, bearing: 0, duration: reducedMotion() ? 0 : 1000 });
  }

  // ---------- render ----------
  function render() {
    const p = plan();
    if (!cur || !p) return;
    m = modelFor(p, cur.id, cur.day, data);
    // round 3: a door with no baked enrichment record gets one fetched once (the device keeps it); the talking points
    // wait for it, so they are written from the full facts, not twice. qloofull: any door without a record, a baked
    // city or not (a saved run in Austin brings doors the held brands' files never held).
    const enrichPending = data && !data.enrich?.[cur.id] && !enrichAsked.has(cur.id);
    if (enrichPending) {
      const at = cur.id;
      enrichAsked.add(at);
      enrichFor({ venue: m.venue, cityKey: p.city?.key ?? null, city: p.city?.name ?? null, cityName: p.city?.name ?? null })
        .then((r) => {
          if (!data || !r?.record) return;
          data.enrich = { ...data.enrich, [at]: enrichFacts(r.record) };
          data.enrichRecords = { ...data.enrichRecords, [at]: r.record };
          // lane deep: the live record's insight facts too (the neighbours are the records this page holds)
          const df = deepFacts(r.record, { id: at, venue: m.venue, plan: p, routes: data.routes, city: data.city, enrich: data.enrichRecords, near: data.deepNear ?? null, profile: p.profile ?? {} });
          if (df.length) data.deepFacts = { ...(data.deepFacts ?? {}), [at]: df };
        })
        .catch(() => {})
        .finally(() => { if (data && cur?.id === at && (!el.contains(document.activeElement) || !/^(TEXTAREA|INPUT)$/.test(document.activeElement.tagName))) render(); });
    }
    // group 3 item 3: no written set for this door yet → ask for one once; the stop redraws when it's back (not while the
    // rep is typing in it)
    if (m.talkReq && m.talk.by !== "model" && !enrichPending) {
      const at = cur.id;
      requestTalk(m.talkReq, m.talkKey, () => {
        if (!data || cur?.id !== at) return;
        data.talkSets = { ...data.talkSets, live: liveSets() };
        if (!el.contains(document.activeElement) || !/^(TEXTAREA|INPUT)$/.test(document.activeElement.tagName)) render();
      });
    }
    if (cur.day != null && m.dayIndex == null) cur.day = null; // the door left that day (marked): show it unscheduled
    const v = m.venue;
    const done = m.status === "visited" && !m.returnVisit;
    const pinTxt = done ? "✓" : m.n ?? "•";
    const pinBg = done ? "var(--done)" : m.n ? colour(m.dayIndex) : "#B9B5AC";
    const where = m.day ? `Stop ${m.n} of ${m.total}` : m.status ? cap({ visited: "visited", talked: "already known", notfit: "not a fit" }[m.status]) : "Not on a day";
    const kicker = m.day ? `${m.stop ? `<b>${esc(m.arriveText)}</b> ` : ""}<span>· ${esc(dayLabel(p.days, m.day))} · stop ${m.n}${m.returnLabel ? ` · ${esc(m.returnLabel)}` : ""}</span>` : "Not on a day";
    const phone = phoneText(v.phone);
    const tel = telHref(v.phone);
    const ua = navigator.userAgent;
    const dir = Number.isFinite(v.lat) ? directionsUrl(m.leg?.from && Number.isFinite(m.leg.from.lat) ? m.leg.from : null, v, ua, savedNavApp()) : null;
    const legTxt = m.leg ? `${m.leg.mi.toFixed(1)} ${m.leg.source === "ors" ? "road mi" : "mi · est."}` : "Directions";
    const web = /^https?:\/\//i.test(v.website ?? "") ? v.website : null;
    const look = web ? null : webSearchHref(v, p.city?.name); // Jard 10-23: no website from Qloo → a plain web search
    const tags = outcomeTags(m.outcome);
    el.innerHTML = `
      <div class="shead">
        <button type="button" class="sback" data-s="close">← All stops</button>
        <button type="button" class="sask" data-s="ask" aria-controls="agentPanel">Ask about this door</button>
        <div class="snav">
          <button type="button" data-s="prev" aria-label="Previous stop" ${m.pos > 0 ? "" : "disabled"}>‹</button>
          <span>${esc(where)}</span>
          <button type="button" data-s="next" aria-label="Next stop" ${m.pos >= 0 && m.pos < m.seq.length - 1 ? "" : "disabled"}>›</button>
        </div>
        <div class="sname" aria-hidden="true" hidden>${esc(v.name)}</div>
      </div>
      <button type="button" class="grab" data-s="grow" aria-label="${el.classList.contains("full") ? "Show less of the stop" : "Pull up for the full stop"}"><i></i></button>
      <div class="sscroll">${pg ? pageHTML(pg, m, p, data, cur, noteEdit) : `
        <div class="shero${v.image ? "" : " noimg"}">${v.image ? `<img src="${esc(v.image)}" alt="" loading="lazy" onerror="this.parentNode.classList.add('noimg');this.remove()">` : ""}</div>
        <div class="sbody">
          <div class="skick"><span class="spin" style="background:${pinBg}" aria-hidden="true">${pinTxt}</span>${esc(m.day ? `${dayLabel(p.days, m.day)}${m.returnLabel ? ` · ${m.returnLabel}` : ""}` : "Not on a day")}</div><!-- ease audit 3 #10f: "stop 2 of 9" is in the header just above (as on the phone) -->
          <h2 tabindex="-1">${esc(v.name)}</h2>
          <div class="kv">${m.meta.map(esc).join(" · ") || (v.source === "manual" ? "Added by you" : "")}</div>
          ${statusHTML(m)}
          <div class="dacts">
            ${dir ? `<a class="dact pri" href="${esc(dir)}" target="_blank" rel="noopener"><i aria-hidden="true">${icon("directions")}</i>Directions${m.leg ? `<small>${esc(legTxt)}</small>` : ""}</a>` : ""}
            ${tel ? `<a class="dact" href="${esc(tel)}" aria-label="Call ${esc(phone)}"><i aria-hidden="true">${icon("call")}</i>Call</a>` : ""}
            <button type="button" class="dact" data-s="pg" data-pg="message"><i aria-hidden="true">${icon("message")}</i>Message</button>
            ${web ? `<a class="dact" href="${esc(web)}" target="_blank" rel="noopener" aria-label="${esc(v.name)} website (opens in a new tab)"><i aria-hidden="true">${icon("website")}</i>Website</a>` : look ? `<a class="dact" href="${esc(look)}" target="_blank" rel="noopener" aria-label="Search the web for ${esc(v.name)} (opens in a new tab)"><i aria-hidden="true">${icon("search")}</i>Search the web</a>` : ""}
          </div>
          ${afterHTML(m, p, cur)}
          ${doorHTML(m)}
          ${aboutHTML(m)}
          <div class="drows">
            ${rowHTML("notes", "notes", `Notes${notesOf(p.slots, cur.id).length ? ` · ${notesOf(p.slots, cur.id).length}` : ""}`, notesOf(p.slots, cur.id)[0]?.text ?? "Who to ask for, when they're in")}
            ${rowHTML("message", "message", "Drafted message", m.note.subject)}
            <button type="button" class="drow" data-s="why-door"><i aria-hidden="true">${icon("why", 18)}</i><span><b>Why this door</b><small>${esc(m.whyLine || m.record.rank)}</small></span><em aria-hidden="true">›</em></button>
            ${sisterRowHTML(sistersOf(p, data?.city, cur.id, data?.routes ?? []))}
          </div>
        </div>`}
      </div>
      <div class="sfoot">${footHTML(m, tel)}</div>
      <div class="ohost"></div>
      <div class="stoast" role="status" hidden></div>`;
    nameLine();
  }

  // judge 9 #1: once the door's name has scrolled out of view, the header names the door (the tour and the doc image
  // scroll the card to At the door, and nothing on screen said which door it was)
  function nameLine() {
    const line = $(".sname", el);
    const head = $(".shead", el);
    const title = $(".sbody h2, .pgh", el);
    if (!line || !head) return;
    const off = !title || title.getBoundingClientRect().bottom <= head.getBoundingClientRect().bottom;
    if (line.hidden === off) line.hidden = !off;
  }
  el.addEventListener("scroll", nameLine, true); // scroll doesn't bubble: capture the card's own scroller

  const toast = (text, undo) => {
    const t = $(".stoast", el);
    if (!t) return;
    t.innerHTML = `<span>${esc(text)}</span>${undo ? `<button type="button" class="lnk" data-s="undo-last">Undo</button>` : ""}`;
    t.hidden = false;
    toast.undo = undo ?? null;
    clearTimeout(toast.t);
    toast.t = setTimeout(() => (t.hidden = true), 6000);
  };

  // ---------- actions ----------
  async function mark(status) {
    const p = plan();
    const id = cur.id;
    const day = cur.day;
    const seq = sequenceOf(p, day);
    const k = seq.indexOf(id);
    const next = seq.filter((x) => x !== id)[Math.max(0, k)] ?? null;
    const name = p.venues[id]?.name ?? "That door";
    const planToast = await S.setStatus(id, status); // true: the plan's re-plan toast (with Undo) is showing
    const label = status === "notfit" ? "not a fit" : "already known";
    if (next && Number.isInteger(day) && plan()?.days?.[day]?.stops.some((s) => s.id === next)) await open(next, day);
    else if (cur) render();
    if (planToast) return;
    toast(`${name} marked ${label}. It's out of the plan.`, async () => {
      await S.setStatus(id, null);
      await open(id, day);
    });
  }

  // Jard 10-24: Remove from my plan, no reason asked (plan.js removeDoor shows its toast with Undo); on to the next stop
  async function removeIt() {
    const p = plan();
    const { id, day } = cur;
    const seq = sequenceOf(p, day);
    const k = seq.indexOf(id);
    const next = seq.filter((x) => x !== id)[Math.max(0, k)] ?? null;
    await S.removeDoor(id);
    if (next && Number.isInteger(day) && plan()?.days?.[day]?.stops.some((s) => s.id === next)) await open(next, day);
    else if (cur) close();
  }

  function markVisited() {
    outcomeOpen = true;
    const p = plan();
    const host = $(".ohost", el);
    host.classList.add("on");
    const date = m.day?.date ?? isoDate(new Date()); // local, not UTC (persona: a 10 pm visit read as the next day)
    const id = cur.id;
    const day = cur.day;
    openOutcome(host, {
      name: m.venue.name,
      current: m.returnVisit ? null : m.outcome,
      defaultDate: followUpDay(p.venues?.[id], { windows: p.windows ?? [], week: p.profile?.week ?? null, from: date, visitMin: p.profile?.visitMin ?? 25 }) ?? defaultFollowUp(p.windows ?? [], date), // never a day it's closed
      venue: p.venues?.[id] ?? null, windows: p.windows ?? [], week: p.profile?.week ?? null, visitMin: p.profile?.visitMin ?? 25, // judge pass 4 (#2, #3)
      others: otherFollowUps(p.outcomes, p.venues, id), // a follow-up at the time of another one that day
      day: m.day?.date ?? null, eta: m.stop?.eta ?? null, // a previewed day's visit is stamped on that day, at its slot
      onCancel: () => {
        outcomeOpen = false;
        host.classList.remove("on");
        host.innerHTML = "";
        $('[data-s="visit"]', el)?.focus();
      },
      onSave: async (o, { said = "" } = {}) => {
        outcomeOpen = false;
        const before = { status: plan().statuses[id] ?? null, outcome: plan().outcomes?.[id] ?? null };
        if (plan().statuses[id] !== "visited" || m.returnVisit) await S.setStatus(id, "visited");
        await S.setOutcome(id, o);
        const vn = visitNote(o, { notes: notesOf(plan().slots, id), by: "rep" }); // door notes: the visit's words stay on the door
        if (vn && S.can("setSlot")) S.setSlot(id, vn);
        cur = { id, day };
        // a follow-up shows in the Week view right away, with the planner's note (R1 Calacanis 4)
        if (o.followUp) S.selectDay("week");
        render();
        const undo = async () => {
          if (vn && S.can("setSlot")) S.setSlot(id, { note: vn.id, drop: true });
          await S.setOutcome(id, before.outcome);
          if (before.status !== "visited") await S.setStatus(id, before.status);
          toast("Undone.");
        };
        toast(o.followUp ? `${said ? `${said} ` : ""}${followUpToast(plan(), id, o.followUp)}` : `Logged · ${outcomeTags(o).map((t) => t.text).join(" · ") || "saved"}.`, undo);
      },
    });
  }

  async function undoVisit() {
    const id = cur.id;
    await S.setOutcome(id, null);
    await S.setStatus(id, null);
    toast("Visit undone.");
  }

  function step(dir) {
    const k = m.pos + dir;
    const id = m.seq[k];
    if (id) open(id, cur.day);
  }

  async function copyNote() {
    const subject = $("#n-subj", el)?.value ?? m.note.subject;
    const body = $("#n-body", el)?.value ?? m.note.body;
    const text = noteText({ subject, body });
    try {
      await navigator.clipboard.writeText(text);
      toast("Note copied.");
    } catch {
      const ta = $("#n-body", el);
      ta?.select();
      toast("Select the note and copy it (the browser blocked the clipboard).");
    }
  }
  // Email / Text use the note as edited; untouched, the draft (with its own text-message version, R9 S3)
  const edited = () => {
    const subject = $("#n-subj", el)?.value ?? m.note.subject;
    const body = $("#n-body", el)?.value ?? m.note.body;
    return subject === m.note.subject && body === m.note.body ? m.note : { subject, body, sms: m.note.sms };
  };

  el.addEventListener("click", (e) => {
    const mn = $(".smore", el); // ⋯ menu: any click outside it closes it
    if (mn && !mn.hidden && !e.target.closest(".smore, [data-s=more]")) (mn.hidden = true), $("[data-s=more]", el)?.setAttribute("aria-expanded", "false");
    const s = e.target.closest("[data-s]")?.dataset.s;
    if (s === "close") return close(); // Jard web review 10-24 #11: "← All stops" is the stop list from a page too; "‹ <door>" is the card
    if (s === "pg") return (pg = e.target.closest("[data-pg]").dataset.pg), render(), $(".sscroll", el)?.scrollTo(0, 0), $(".pgh h3", el)?.focus();
    if (s === "pg-back") return (pg = null), render(), $("h2", el)?.focus();
    // The Why panel opens on this door (its handler calls preventDefault); without it, Qloo's deep-dive
    if (s === "why-door") return window.dispatchEvent(new CustomEvent("doors:why-door", { detail: { id: cur.id }, cancelable: true })) ? openRoom(cur.id, data) : undefined;
    if (s === "next-door") return open(e.target.closest("[data-id]").dataset.id, cur.day);
    if (s === "more") return toggleMore(e.target.closest("[data-s]"));
    if (s === "prev") return step(-1);
    if (s === "next") return step(1);
    if (s === "grow") return toggleFull();
    if (s === "visit") return markVisited();
    if (s === "notfit" || s === "talked") return mark(s);
    if (s === "remove") return removeIt();
    if (s === "later") return S.setLater(cur.id, !plan()?.later?.[cur.id]);
    if (s === "undo") return undoVisit();
    if (s === "copy") return copyNote();
    if (s === "reset-note") return S.setSlot(cur.id, { clear: "note.email" }); // R9 S6: back to the draft
    // ---- door notes ----
    if (s === "ask") return window.dispatchEvent(new CustomEvent("doors:ask", { detail: { id: cur.id } }));
    if (s === "note-edit") return (noteEdit = e.target.closest("[data-nid]").dataset.nid), render(), $(".dnotes textarea[data-edit]", el)?.focus();
    if (s === "note-cancel") return (noteEdit = null), render();
    if (s === "note-del") {
      const nid = e.target.closest("[data-nid]").dataset.nid;
      const n = notesOf(plan().slots, cur.id).find((x) => x.id === nid);
      const rec = (plan().slots?.[cur.id] ?? []).find((r) => r.field === "note" && (r.id ?? `${r.at}|${r.value}`) === nid);
      S.setSlot(cur.id, { note: nid, drop: true });
      const id = cur.id;
      return toast(`Note deleted${n ? `: “${n.text.slice(0, 40)}${n.text.length > 40 ? "…" : ""}”` : ""}.`, rec ? () => S.setSlot(id, rec) : null);
    }
    // ---- end door notes ----
    if (s === "undo-last") return toast.undo?.();
    if (s === "room") return openRoom(cur.id, data);
    if (s === "room-sisters") return openRoom(cur.id, data, { section: "sisters" });
    if (s === "add-sister") {
      const b = e.target.closest("[data-id]");
      const sis = sistersOf(plan(), data?.city, cur.id, data?.routes ?? []).find((x) => x.id === b.dataset.id);
      if (!sis?.venue || !S.can("addDoor")) return;
      b.disabled = true;
      return Promise.resolve(S.addDoor(sis.venue, { date: null })).then(() => cur && render());
    }
    if (s === "open-sister") {
      const b = e.target.closest("[data-id]");
      return open(b.dataset.id, Number(b.dataset.day));
    }
    const a = e.target.closest("a[data-href]");
    if (a) a.href = a.dataset.href === "mail" ? mailtoHref(edited()) : smsHref(edited(), m.venue.phone);
  });
  el.addEventListener("submit", (e) => {
    // ---- door notes: add one, or save an edit ----
    const nf = e.target.closest("form.nform");
    if (nf) {
      e.preventDefault();
      const ta = $("textarea", nf);
      const text = ta?.value.trim() ?? "";
      if (nf.dataset.nid) {
        noteEdit = null;
        return text ? S.setSlot(cur.id, { note: nf.dataset.nid, text }) : S.setSlot(cur.id, { note: nf.dataset.nid, drop: true });
      }
      if (!text) return ta?.focus();
      const rec = makeNote({ text, by: "rep" });
      if (rec && S.can("setSlot")) S.setSlot(cur.id, rec);
      return;
    }
    // ---- end door notes ----
  });
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && e.target.closest?.("form.nform textarea")) {
      e.preventDefault();
      e.target.closest("form").requestSubmit();
    }
    if (e.key === "Escape" && e.target.closest?.("form.nform[data-nid]")) (e.stopPropagation(), (noteEdit = null), render());
  });
  el.addEventListener("change", (e) => {
    // R9 S6: the rep's edit to the note is a correction: it's kept for this door and wins over the draft
    if (e.target.id === "n-body" && S.can("setSlot") && e.target.value.trim() && e.target.value !== m.note.body)
      return S.setSlot(cur.id, makeRecord({ slot: "S6", field: "note.email", value: e.target.value.slice(0, 2000), source: "corrected", by: "rep" }));
    const t = e.target.closest("[data-tick]");
    if (!t) return;
    ticks = { ...readTicks(), [t.dataset.tick]: t.checked || undefined };
    writeTicks(ticks);
  });

  // ⋯ in the footer: Not a fit, Already know them (Change outcome / Undo after a visit)
  function toggleMore(btn, on) {
    const m2 = $(".smore", el);
    on ??= m2.hidden;
    m2.hidden = !on;
    btn.setAttribute("aria-expanded", String(on));
    if (on) m2.querySelector("button, a")?.focus();
  }
  // menu keys: arrows/Home/End move, Escape closes it (focus back on ⋯), Tab closes it and moves on
  el.addEventListener("keydown", (e) => {
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && e.target.closest?.("[data-s=more]")) return e.preventDefault(), toggleMore(e.target.closest("[data-s=more]"), true);
    const m2 = e.target.closest?.(".smore");
    if (!m2 || m2.hidden) return;
    const items = [...m2.querySelectorAll("button, a")];
    const i = items.indexOf(e.target);
    const go = { ArrowDown: i + 1, ArrowUp: i - 1, Home: 0, End: items.length - 1 }[e.key];
    if (go != null) return e.preventDefault(), items[(go + items.length) % items.length].focus();
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      const btn = $("[data-s=more]", el);
      toggleMore(btn, false);
      return btn.focus();
    }
    if (e.key === "Tab") toggleMore($("[data-s=more]", el), false);
  });

  // ---------- phone sheet: tap or drag the handle ----------
  function toggleFull(on = !el.classList.contains("full")) {
    el.classList.toggle("full", on);
    $(".grab", el)?.setAttribute("aria-label", on ? "Show less of the stop" : "Pull up for the full stop");
  }
  let drag = null;
  el.addEventListener("pointerdown", (e) => {
    if (!isPhone() || !e.target.closest(".grab, .shead")) return;
    drag = { y: e.clientY, t: Date.now() };
  });
  window.addEventListener("pointerup", onUp);
  function onUp(e) {
    if (!drag) return;
    const dy = e.clientY - drag.y;
    drag = null;
    if (Math.abs(dy) < 8) return; // a tap: the click handler decides
    const full = el.classList.contains("full");
    if (dy < -30) toggleFull(true);
    else if (dy > 60) full ? toggleFull(false) : close();
  }

  // ---------- wiring ----------
  const onOpen = (e) => open(e.detail?.id, e.detail?.day);
  window.addEventListener("doors:open-stop", onOpen);
  window.addEventListener("doors:close-stop", close); // ease #5: browser Back
  const off = S.onPlanChange(() => { if (cur && !outcomeOpen) render(); });
  const onKey = (e) => {
    if (e.key === "Escape" && cur && !outcomeOpen && !e.target.closest?.(".menu")) close();
  };
  document.addEventListener("keydown", onKey);
  return () => {
    window.removeEventListener("doors:open-stop", onOpen);
    window.removeEventListener("doors:close-stop", close);
    window.removeEventListener("pointerup", onUp);
    document.removeEventListener("keydown", onKey);
    document.documentElement.classList.remove("sheet-open");
    off();
    el.remove();
  };
}

// ---------- sections ----------
// Door notes: the rep's and Ask Doors' (lib/door-notes.js), newest first, each with who wrote it and when; edit and
// delete in place; a box to add one. editing = the id of the note being edited.
const noteWhen = (at) => (Number.isFinite(Date.parse(at ?? "")) ? niceDate(isoDate(new Date(at))) : ""); // the rep's own day, not UTC's
export function notesHTML(notes, editing = null, name = "this door") {
  const li = (n) => n.id === editing
    ? `<li data-nid="${esc(n.id)}"><form class="nform" data-nid="${esc(n.id)}"><textarea data-edit rows="2" maxlength="300" aria-label="Edit this note">${esc(n.text)}</textarea><div class="nbtns"><button type="submit" class="btn primary sm">Save</button><button type="button" class="btn line sm" data-s="note-cancel">Cancel</button></div></form></li>`
    : `<li data-nid="${esc(n.id)}" data-by="${esc(/^(Ask Doors|Doors Agent)/.test(n.who) ? "agent" : "rep")}"><p class="ntext">${esc(n.text)}</p><p class="nmeta"><span class="nwho">${esc(n.who)}</span>${noteWhen(n.at) ? ` · ${esc(noteWhen(n.at))}` : ""} · <button type="button" class="lnk" data-s="note-edit" aria-label="Edit this note">Edit</button> · <button type="button" class="lnk" data-s="note-del" aria-label="Delete this note">Delete</button></p></li>`;
  return `<section class="sect dnotes" aria-label="Notes on ${esc(name)}"><h4>Notes${notes.length ? ` · ${notes.length}` : ""}</h4>
    ${notes.length ? `<ul class="nlist">${notes.map(li).join("")}</ul>` : `<p class="cap">Nothing yet. Add who to ask for, when they're in, what they want, or tell Doors Agent and it notes what matters.</p>`}
    ${editing ? "" : `<form class="nform" data-new><textarea rows="2" maxlength="300" placeholder="Add a note: the manager is Priya, back Thursdays" aria-label="Add a note on ${esc(name)}"></textarea><div class="nbtns"><button type="submit" class="btn line sm">Save note</button><button type="button" class="lnk" data-s="ask">Ask Doors Agent about ${esc(name)}</button></div></form>`}</section>`;
}
// G5: the deep-dive link (ui/room.js) under the Why lines: everything Qloo says about the room and why it was chosen
const deepLink = `<button type="button" class="lnk rv-open" data-s="room">See everything Qloo knows about this door →</button>`;
// ---- R9 deep (lib/culture.js): the room's Qloo tags; each line's source chip comes from lib/provenance.js ----
const heatHTML = (m) => (m.hood ? `<p class="cap heatcap">${esc(m.hood.text)}${srcChip(QLOO_HEAT(m.hood.src))}</p>` : "");
const qtagsHTML = (m) => heatHTML(m) + (m.roomTags?.length ? `<dl class="qtags">${m.roomTags.map((f) => `<dt>${esc(f.label)}</dt><dd>${esc(f.text.slice(f.label.length + 2).replace(/\.$/, ""))}</dd>`).join("")}</dl><p class="cap">Qloo's tags for this door${shortDate(m.roomTags[0].source.captured) ? `, saved ${esc(shortDate(m.roomTags[0].source.captured))}` : ""}. Doors uses them to pick the day, the opener and the ask.</p>` : "");
const srcChip = (c) => (c ? ` <span class="srcchip" data-k="${esc(c.k)}"${c.title ? ` title="${esc(c.title)}"` : ""}>${esc(c.label)}</span>` : "");
// ---- end R9 deep ----
function whyHTML(m) {
  const a = m.record.affinity;
  // judge pass 8 (#2): the rank in words up top (Jard 10-24: Your list's words, as in Why and Deep Dive); the affinity decimal stays in The Qloo record below
  const match = a && m.rank ? `<p class="whymatch"><b>#${m.rank} of ${m.N}</b> on Your list for ${esc(peopleWho(a.who ?? (m.profile.venue ? `the regulars at ${a.drinker}` : `${a.drinker ?? "this"} drinkers`)))}${a.list === "famous" ? " (the most popular doors list)" : ""}</p>` : "";
  if (!m.why.length) return `<section class="sect"><h4>Why this door</h4>${match}<p class="cap">Qloo has no description of this door's crowd or feel. ${m.rank ? "It's on the list for its taste match alone." : ""}</p>${qtagsHTML(m)}${deepLink}</section>`;
  const model = m.pitch.by === "model";
  return `<section class="sect"><h4>Why this door</h4>
    ${match}
    ${m.why.map((l) => `<p><b>${esc(l.label)}.</b> ${esc(l.text)}</p>`).join("")}
    <p class="cap">Crowd and room lines from Qloo's profile of this door.</p>
    ${qtagsHTML(m)}${deepLink}</section>`;
}

function noteHTML(m) {
  const n = m.note;
  const mine = n.by === "rep";
  return `<section class="sect snote"><h4>Drafted message <span>${mine ? `your version · <button type="button" class="lnk" data-s="reset-note">Reset to draft</button>` : "edit before sending"}</span></h4>
    <div class="mail">
      <div class="act"><button type="button" class="btn sm line" data-s="copy">Copy</button><a class="btn sm line" data-href="mail" href="${esc(mailtoHref(n))}">Email</a><a class="btn sm line" data-href="sms" href="${esc(smsHref(n, m.venue.phone))}">Text</a></div>
      <label class="sr" for="n-subj">Subject</label><textarea class="subj" id="n-subj" rows="2">${esc(n.subject)}</textarea>
      <label class="sr" for="n-body">Note</label><textarea id="n-body" rows="9">${esc(n.body)}</textarea>
    </div>
    <p class="cap">${esc(noteLabel(n))} Nothing is sent from Doors. ${esc(TEXT_HINT)}</p></section>`;
}

function talkHTML(m, ticks) {
  const t = m.talk;
  // judge pass 3 (N10): two facts from one article share one footnote (as the call sheet does); when their labels
  // differ only in the bracket, the footnote drops it
  const refs = [];
  for (const f of t.factRefs) {
    const r = refs.find((x) => (f.url && x.url === f.url) || x.id === f.id);
    if (!r) refs.push({ ...f, ids: [f.id] });
    else (r.ids.push(f.id), r.source !== f.source && (r.source = r.source.replace(/\s*\([^)]*\)\s*$/, "")));
  }
  const fn = (p) => {
    const i = refs.findIndex((f) => f.ids.includes(p.fact));
    return i >= 0 ? ` <sup><a href="${esc(refs[i].url)}" target="_blank" rel="noopener" aria-label="Source ${i + 1}: ${esc(refs[i].source)}">${i + 1}</a></sup>` : "";
  };
  const tick = (k, text, mark = "") => {
    const key = `${m.id}:${k}`;
    return `<li><label><input type="checkbox" data-tick="${esc(key)}" ${ticks[key] ? "checked" : ""}> <span>${esc(text)}${mark}</span></label></li>`;
  };
  // intuit audit #4: one line at the top says where the lines came from; each line's source is in the Sources fold at
  // the end (lib/provenance.js), not a chip after every line
  const src = lineSources(m);
  const rows = sourceRows(src);
  // Round 3 (Jard 10-25): nothing on the page says which model wrote the lines or that a model did ("our users don't
  // need to know how the sausage is made"; the privacy page says it). While this door's own lines are still being
  // written, one quiet line says so, because the lines below will change when they land.
  const ts = t.by === "model" ? null : talkState(m.talkKey);
  const by = ts === "pending" ? `<p class="talkby"><span>Writing this door's talking points. They'll show here in a few seconds.</span></p>` : "";
  return `<section class="sect talk" aria-label="Talking points">
    ${by}
    <p class="cap srcline">${esc(talkSummary(src, t))}</p>
    ${t.visit === "return" ? `<p class="cap slotcap">Return visit: these lines use what you told Doors last time${t.memoryUsed?.length ? ` (${esc(t.memoryUsed.map((f) => ({ contact: "who you talked to", said: "your note", objection: "their pushback", carry: "what they carry" })[f] ?? f).join(", "))})` : ""}.</p>` : ""}
    <div class="tp"><h5>Before you walk in</h5><ul>${t.before.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></div>
    <div class="tp"><h5>Opener</h5><p class="opener">${esc(t.opener)}</p></div>
    ${t.toBuyer ? `<div class="tp"><h5>To the buyer</h5><p class="opener">${esc(t.toBuyer)}</p></div>` : ""}
    ${t.hook ? `<div class="tp"><h5>Small talk</h5><p>${esc(t.hook.text)}</p></div>` : ""}
    <div class="tp"><h5>Questions to ask</h5><p class="ask-note">Qloo doesn't know what they stock — ask.</p><ul class="ticks">${t.questions.map((q, i) => tick(`q${i}`, q)).join("")}</ul></div>
    <div class="tp"><h5>Points to make</h5><ul class="ticks">${t.points.map((p, i) => `<li><label><input type="checkbox" data-tick="${esc(`${m.id}:p${i}`)}" ${ticks[`${m.id}:p${i}`] ? "checked" : ""}> <span>${esc(p.text)}${fn(p)}</span></label></li>`).join("")}</ul></div>
    <div class="tp"><h5>Likely pushback</h5><dl class="push">${t.pushback.map((p) => `<dt>${p.from === "memory" ? esc(p.objection) : `“${esc(p.objection)}”`}</dt><dd>${esc(p.reply)}</dd>`).join("")}</dl></div>
    <div class="tp theask"><h5>The ask</h5><p>${esc(cap(t.ask))}.</p></div>
    ${refs.length ? `<ol class="fns">${refs.map((f) => `<li><a href="${esc(f.url)}" target="_blank" rel="noopener">${esc(f.source)} ↗</a></li>`).join("")}</ol>` : ""}
    ${m.hidden ? `<p class="cap">${m.hidden} line${m.hidden > 1 ? "s" : ""} hidden by your rules.</p>` : ""}
    <details class="fold srcfold"><summary>Sources (${rows.length})</summary>
      <ul class="srcrows">${rows.map((r) => `<li><b>${esc(r.where)}</b>: ${esc(r.label)}${r.title ? `<small>${esc(r.title)}</small>` : ""}</li>`).join("")}</ul>
      <p class="cap">Every other line is Doors' template, filled in with your profile.${refs.length ? " Numbered points link to their article." : ""} ${esc(talkLabel(t))}</p></details></section>`;
}

// Sister doors (G5): matched to this door's crowd, not to the drinker. On the card, one row like Notes and Why this
// door (intuitiveness audit #3); its page lists them all, the ones on your route first, each with its reason in plain
// words. Qloo's scores stay in the deep-dive.
function sisterRowHTML(sisters) {
  return sisters.length ? rowHTML("sisters", "sisters", "Sister doors", sisterSummary(sisters).sub) : "";
}
function sistersHTML(sisters) {
  const can = S.can("addDoor");
  const { n, on } = sisterSummary(sisters);
  return `<section class="sect dsis" aria-label="Sister doors"><p class="cap">Doors whose regulars are like this door's. ${on} of ${n} on your route.</p>
    <ul class="sis">${sisterOrder(sisters).map((s) => `<li><div><b>${esc(s.name)}</b><small>${esc(s.status.text)}</small></div>${s.status.kind === "on" ? `<button type="button" class="btn line sm" data-s="open-sister" data-id="${esc(s.id)}" data-day="${s.status.dayIndex}">Open</button>` : s.addable && can ? `<button type="button" class="btn sm line" data-s="add-sister" data-id="${esc(s.id)}">+ Add</button>` : ""}</li>`).join("")}</ul>
    <button type="button" class="lnk" data-s="room-sisters">Qloo's match scores for these doors ›</button></section>`;
}

// Qloo's listing, in words (intuit audit #1): the rank, the week's hours, the website. No ids, affinity decimals,
// field names or model ids here; which model drafted the crowd and room lines is on the privacy page.
function recordHTML(m) {
  const r = m.record;
  const row = (k, v) => `<dt>${esc(k)}</dt><dd>${v}</dd>`;
  const hours = r.week ? `<ul class="week">${r.week.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`
    : esc(/^\s*[{[]/.test(r.hoursRaw) ? "Qloo's hours for this door couldn't be read." : r.hoursRaw === "no hours listed" ? "Qloo lists no hours for this door." : r.hoursRaw);
  return `<details class="fold"><summary>Rank and hours</summary><dl class="rec">
    ${row("Rank", esc(r.rank))}
    ${row("Hours", hours)}
    ${m.venue.website ? row("Website", `<a href="${esc(m.venue.website)}" target="_blank" rel="noopener">${esc(m.venue.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""))}</a>`) : ""}
  </dl><p class="cap">Saved from Qloo${r.when ? ` on ${esc(r.when)}` : ""}. Opening a door makes no call to Qloo.</p></details>`;
}

// ---------- the door card (Jard 10-23 #9; lib/doorcard.js picks the lines, the phone's Stop.tsx shows the same) ----------
function statusHTML(m) {
  const st = statusLine(m);
  return st.length ? `<p class="dstatus">${st.map((x, i) => `${i ? " · " : ""}<span class="${x.tone ?? ""}">${esc(x.text)}</span>`).join("")}${m.wait ? ` · wait ~${m.wait} min` : ""}</p>` : "";
}
function doorHTML(m) {
  if (m.status === "visited" && !m.returnVisit) return "";
  const d = atDoor(m);
  const visit = visitLine(m);
  const line = (k, text, { sub = null, cls = "" } = {}) => `<div class="dl"><h5>${esc(k)}</h5><p class="${cls}">${esc(text)}</p>${sub ? `<p class="dsub">${esc(sub)}</p>` : ""}</div>`;
  const t = m.talk;
  return `<section class="atdoor" aria-label="At the door"><div class="dch"><h4>At the door</h4>${visit ? `<span>${esc(visit)}</span>` : ""}</div>
    ${d.askFor ? line("Ask for", d.askFor, { sub: d.timing }) : d.timing ? line("When", d.timing) : ""}
    ${d.last.map((x) => line("Last time", x)).join("")}
    ${d.order ? line("First", d.order) : ""}
    ${d.opener ? line("Opener", `“${d.opener}”`, { cls: "big" }) : ""}
    ${d.toBuyer ? line("To the buyer", `“${d.toBuyer}”`, { cls: "big", sub: d.angle ? `Why: ${d.angle}` : null }) : ""}
    ${d.ask ? line("The ask", d.ask, { cls: "theask", sub: d.toBuyer ? "After they've tasted it." : null }) : ""}
    ${d.bring ? line("Bring", d.bring) : ""}
    <button type="button" class="dmore" data-s="pg" data-pg="talk"><span>${esc(talkCounts(t) || "Talking points")}</span><span aria-hidden="true">›</span></button></section>`;
}
function aboutHTML(m) {
  const a = aboutLines(m);
  // Qloo's raw listing (profile, tags, hours as listed, the record) is one link here, under what Doors read from it, not a
  // row of its own at the card's end (ease audit #9)
  const qloo = `<button type="button" class="lnk dqloo" data-s="pg" data-pg="qloo">See Qloo's listing ›</button>`;
  // WHY-VIZ-SPEC §6: the Crowd entry is rarity chips ("Dog owners 3% of Austin") when the city base is loaded (lib/doorcard.js aboutLines)
  const line = (x) => (x.chips ? `<div class="rchips" role="list" aria-label="Crowd groups rare in ${esc(m.rarity?.cityName ?? "the city")}">${x.chips.map((c) => `<span role="listitem" class="rchip">${esc(c.label)}<b>${esc(c.share)}</b></span>`).join("")}</div><p class="rline">Groups Qloo names here that your plan has far more of than ${esc(m.rarity?.cityName ?? "the city")} does, each with the share of the ${m.rarity?.baseN ?? ""} ${esc(m.rarity?.cityName ?? "")} doors Doors holds that have it.</p>` : `<p>${esc(x.text)}</p>`);
  return `<section class="dabout" aria-label="About this door">${a.length ? `<h4>About this door</h4>${a.map((x) => `<div><h5>${esc(x.title)}</h5>${line(x)}</div>`).join("")}` : ""}${qloo}</section>`;
}
function afterHTML(m, p, cur) {
  if (m.status === "removed") return `<div class="dafter out">Removed from your plan</div>`;
  if (m.status === "talked" || m.status === "notfit") return `<div class="dafter out">${m.status === "notfit" ? "Not a fit" : "Already know them"} · left out of the plan</div>`;
  const a = afterVisit(m);
  if (!a) return "";
  const k = Number.isInteger(cur.day) ? cur.day : (p.days ?? []).findIndex((d) => d.date === String(m.outcome?.at ?? "").slice(0, 10));
  const t = dayTally(p, k);
  return `<div class="dafter"><b>${esc(/^✓/.test(a.title) ? a.title : `✓ ${a.title}`)}</b>${a.lines.map((x) => `<p>${esc(x)}</p>`).join("")}
    ${t ? tallyHTML(t) : ""}</div>`;
}
// the day's progress: the words first, then one bar whose filled part is the doors visited (no colour code to learn)
function tallyHTML(t) {
  const w = tallyWords(t);
  return `<div class="dtally"><p class="dtally-h">${esc(w.head)}</p><div class="dtally-bar" aria-hidden="true">${t.dots.map((d) => `<i${d ? ' class="v"' : ""}></i>`).join("")}</div>${w.sub ? `<p class="dsub">${esc(w.sub)}</p>` : ""}</div>`;
}
const rowHTML = (pg, ic, title, sub) => `<button type="button" class="drow" data-s="pg" data-pg="${pg}"><i aria-hidden="true">${icon(ic, 18)}</i><span><b>${esc(title)}</b>${sub ? `<small>${esc(sub)}</small>` : ""}</span><em aria-hidden="true">›</em></button>`;
const PAGES = { talk: "Talking points", notes: "Notes", message: "Drafted message", qloo: "Qloo's listing", sisters: "Sister doors" };
// a row's page, in place of the card (‹ back to the card); the sections are the stop's own (notes, note, talk, record)
function pageHTML(pg, m, p, data, cur, noteEdit) {
  const body = pg === "talk" ? talkHTML(m, readTicks())
    : pg === "notes" ? notesHTML(notesOf(p.slots, cur.id), noteEdit, m.venue.name)
    : pg === "message" ? noteHTML(m)
    : pg === "sisters" ? sistersHTML(sistersOf(p, data?.city, cur.id, data?.routes ?? []))
    : whyHTML(m).replace(deepLink, "") + recordHTML(m).replace("<details class=\"fold\">", "<details class=\"fold\" open>");
  return `<div class="sbody dpage"><div class="pgh"><button type="button" class="sback" data-s="pg-back">‹ ${esc(m.venue.name)}</button><h3 tabindex="-1">${esc(PAGES[pg] ?? "")}</h3></div>${body}</div>`;
}

function footHTML(m, tel) {
  const done = m.status === "visited" && !m.returnVisit;
  const out = m.status === "talked" || m.status === "notfit" || m.status === "removed";
  const p = S.getPlan();
  const canRemove = !done && !out && (!!m.stop || !!m.venue?.added) && S.can("removeDoor");
  const nx = done ? nextStop(m, p) : null;
  const main = out ? `<button type="button" class="btn primary" data-s="undo">Undo</button>`
    : done ? (nx ? `<button type="button" class="btn primary" data-s="next-door" data-id="${esc(nx.id)}">Next: ${esc(nx.name)}${nx.arrive != null ? ` · ${esc(clock12(nx.arrive))}` : ""}</button>` : `<button type="button" class="btn primary" data-s="visit">Change outcome</button>`)
    : `<button type="button" class="btn primary" data-s="visit">Log visit</button>`;
  const items = [
    ...(done ? [`<button type="button" data-s="visit">Change outcome</button>`, `<button type="button" data-s="undo">Undo the visit</button>`] : []),
    ...(!done && !out ? [`<button type="button" data-s="notfit">Not a fit</button>`, `<button type="button" data-s="talked">Already know them</button>`] : []),
    ...(canRemove ? [`<button type="button" data-s="remove">Remove from my plan</button>`] : []),
    ...(S.can("setLater") ? [`<button type="button" data-s="later">${p?.later?.[m.venue.id] ? "Remove from Saved for later" : "Save for later"}</button>`] : []), // Log book (round 4 item 10)
  ]; // Call is on the action row above, not here too (ease audit #15)
  return `<div class="sbtns">${main}${items.length ? `<button type="button" class="btn line smorebtn" data-s="more" aria-haspopup="menu" aria-expanded="false" aria-label="More: ${done ? "Change outcome, Undo the visit" : `Not a fit, Already know them${canRemove ? ", Remove from my plan" : ""}`}">${icon("more", 20)}</button>` : ""}</div>
    <div class="smore" role="menu" aria-label="More" hidden>${items.map((b) => b.replace(/^<(button|a) /, '<$1 role="menuitem" ')).join("")}</div>`;
}
