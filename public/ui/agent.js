// R9 chat agent: the "Ask Doors" panel on the plan (docs/CONTRACTS-R9.md §5). A back-and-forth with the agent on the
// Worker (/api/agent); its answers carry their sources and its actions are applied here, through state.js only
// (plan.js re-plans and redraws). The conversation stays in this tab (sessionStorage); the Worker keeps nothing.
// Offline, or when the Worker can't be reached, the same rules path answers here (lib/agent-rules.js).
// Seams for the guided demo and drive mode: setTransport(fn), sendAgent(text), the doors:agent-reply event.
import * as S from "./state.js";
import { $, esc } from "./dom.js";
import { loadStopData } from "./stop.js";
import { agentContext, dayHolding, WHYNOT_ASK } from "../lib/agent-context.js";
import { answerByRules, doorNamed } from "../lib/agent-rules.js";
import { RESULT_TEXT } from "../lib/outcome.js";
import { ruleNotes } from "../lib/slots.js";
import { niceDate, clock12, toMinutes } from "../lib/profile.js";
import { fitReply, moveFollowUp, offerLive, altLabel } from "../lib/fu-check.js";
import { makeNote, notesOf, hasNote } from "../lib/door-notes.js"; // door notes
import { greeting, starters, inLocalTime, modeOf, sourceTag, sourceItems, changeSet, chipsOf, chipsText } from "../lib/agent-ui.js"; // Doors Agent (spec step 5)
import { sayAgent, listen as hear, hush, canListen, micLabel } from "./voice.js";
import { draftOf } from "../lib/agent-tools.js"; // ability 4: follow-up drafts
import { DEMO_PREFIX } from "../lib/demo-session.js";
import { latePickLabel } from "../lib/drive-day.js";
import { icon } from "../lib/icons.js"; // the Doors icon set (Jard 10-24 #1)

const CSS = "/css/agent.css";
if (typeof document !== "undefined" && !document.querySelector(`link[href="${CSS}"]`)) {
  const l = document.createElement("link");
  l.rel = "stylesheet";
  l.href = CSS;
  document.head.append(l);
}

// ---------- transport: fetch, or the demo's recorded replies ----------
let transport = null;
let transportNotice = null; // what the panel says about where messages go, when the transport isn't the model's
// opts.notice: the panel's footer line for this transport (the demo: "no model is called"); it also never says the
// free model is busy, since none is asked
export function setTransport(fn, { notice = null } = {}) {
  transport = typeof fn === "function" ? fn : null;
  transportNotice = transport ? notice : null;
  const foot = typeof document !== "undefined" ? document.querySelector("#agentPanel .afoot-t") : null; // live check D: #agentWho sits beside it
  if (foot) foot.textContent = footText();
}
// ease audit #12: one line under the box (it was three or four), and a Privacy link for the rest
const footText = () => transportNotice ?? `${MODEL_NOTICE} `;
const STOP_DATA_MS = 5000; // the city file and facts: a turn waits this long for them, then answers without them
// the Worker starts no model step after 14 s and cuts each at 8 s, so it answers by ~22 s (src/agent.js TURN_MS); past
// this, Doors' rules answer here. Live check D: it was 20 s, which could drop a 70b → 8b answer that was still coming
const TURN_MS = 25000;
async function call(path, body) {
  if (transport) return transport(path, body);
  const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const out = await res.json().catch(() => null);
  if (!out || (!res.ok && !out.reply)) throw new Error(out?.error ?? `HTTP ${res.status}`);
  return out;
}

const MAX_KEPT = 12;
// Q2: the panel says this, verbatim. Spec §8 (agentui2 10-23): Anthropic answers first now and voice
// is Cloudflare's; the footer then names the model that answered, privacy.html says what goes where.
export const MODEL_NOTICE = "Your messages go to Anthropic's Claude, or to Workers AI or Google Gemini when Claude can't answer, with names removed first; voice goes to Cloudflare.";
// the footer's line for the last answer: the model that gave it (r.model, from the Worker), or Doors' own rules
// r.notice (from the Worker) says why Claude was passed over, when a free model or the rules answered
export const answeredBy = (r) => (r.resting ? "This answer is from Doors' own rules: no model was used." : inLocalTime(r.model ? `This answer: ${r.model}.${r.notice ? ` ${r.notice}` : ""}` : r.notice ?? ""));
// judge pass 4 (N25): the footer under a rules answer is that one line; the line about the free model shows only while
// a model answers (or before any answer). last: the last agent message or null → {who, notice}
export const footFor = (last) => ({ who: last ? answeredBy(last) : "", notice: !last?.resting });
// the resting note under an answer, once: not again under the next answer when it says the same thing
const REST = "Doors Agent isn't available; this answer is from Doors' rules.";
export function restNote(m, prev) {
  if (!m?.resting) return "";
  const t = m.message ?? REST;
  return prev?.resting && (prev.message ?? REST) === t ? "" : t;
}
// ease audit 2 #1: the tour's chat is kept under the tour's own prefix (lib/demo-session.js), so it is cleared with the
// tour and never shows in your own plan of the same brand and city (Maya's example is the tour's Tidewell · Austin)
export const keyOf = (plan, { demo = false } = {}) => `${demo ? DEMO_PREFIX : ""}doors.v2.chat.${plan?.profile?.brand ?? ""}-${plan?.city?.key ?? ""}`;
const readLog = (k) => {
  try {
    return JSON.parse(sessionStorage.getItem(k) ?? "[]") ?? [];
  } catch {
    return [];
  }
};
const writeLog = (k, log) => {
  try {
    sessionStorage.setItem(k, JSON.stringify(log.slice(-40)));
  } catch {}
};

let api = null; // the mounted panel's {send}
// opts.quiet (group 3 #8, hands-free drive): the turn runs and is kept in the chat, with the panel left closed
export const sendAgent = (text, opts = {}) => api?.send(text, opts);
// the door the Agent is asked about (drive mode's stop), without opening the panel
export const setAgentDoor = (id) => api?.setDoor(id);

// mountAgent(root, {demo}) → cleanup. root = the plan view; the open button is root's [data-agent="open"]. demo: the
// tour's plan (its chat is the tour's, not yours)
export function mountAgent(root, { demo = false } = {}) {
  const panel = document.createElement("section");
  panel.id = "agentPanel";
  panel.className = "agentpanel";
  panel.hidden = true;
  panel.dataset.state = "idle";
  panel.setAttribute("aria-label", "Doors Agent");
  panel.innerHTML = `
    <header class="ahead"><b>Doors Agent</b><span class="amodel" id="agentModel"></span><button type="button" class="aclose" data-agent="close" aria-label="Close">${icon("close", 18)}</button></header>
    <div class="alog" id="agentLog" aria-live="polite"></div>
    <form class="aform" id="agentForm">
      <textarea id="agentInput" rows="1" maxlength="600" placeholder="Ask, log a visit, or add a note" aria-label="Your message" enterkeyhint="send"></textarea>
      <button type="button" class="amic" data-agent="mic" aria-label="Talk: tap and say it" aria-pressed="false" title="Tap and say it"${canListen() ? "" : " hidden"}>${icon("mic", 18)}</button>
      <button type="submit" class="btn primary sm asend" data-agent="send" aria-label="Send">${icon("send", 20)}<span class="lbl">Send</span></button>
    </form>
    <p class="aerr" role="alert" hidden></p>
    <p class="afoot"><span id="agentWho"></span> <span class="afoot-t" hidden>${esc(footText())}</span><a href="/privacy" target="_blank" rel="noopener">Privacy</a></p>`;
  document.body.append(panel);
  // Jard 2026-10-23: one Ask Doors per screen: the plan toolbar's (green, first), not a floating button that covered the
  // footer; a stop has its own in-context one, drive mode its own (ui/drive.js)
  // "Ask Doors about this door" (the stop, drive mode): doors:ask {id, prefill?}
  // WHY-VIZ-SPEC §4.5: the thread panel's "Ask the Doors Agent why these aren't on my plan" sends
  // doors:ask {id, whynot: threadAsk(model, id, …) (lib/whyviz/thread.js), send: true}: the next turn carries that ask as
  // context.whynot (the Worker checks it and rebuilds each fix from the table), and the reply's `whynot` (each door's
  // fix with its action, the pick, fallback: true when the rules' text answered) rides on the doors:agent-reply event
  let pendingWhyNot = null;
  const onAsk = (e) => {
    if (e.detail?.id) current = e.detail.id;
    open(true);
    if (e.detail?.whynot?.selected?.id && Array.isArray(e.detail.whynot.doors)) pendingWhyNot = e.detail.whynot;
    const prefill = e.detail?.prefill ?? (pendingWhyNot ? pendingWhyNot.question || WHYNOT_ASK : null);
    if (prefill) { input.value = String(prefill); grow(); }
    if (e.detail?.send && prefill) { input.value = ""; send(String(prefill)); }
  };
  window.addEventListener("doors:ask", onAsk);
  const log = $("#agentLog", panel);
  const input = $("#agentInput", panel);
  let current = null; // the stop the rep has open (doors:open-stop)
  let data = null; // the city file, facts and drinker lists (as the stop panel loads them)
  let busy = false;
  let messages = readLog(keyOf(S.getPlan(), { demo }));
  // the last answer's change chips' Undo: {at: its index in messages, fns: Map group → undo}. In memory: a reload keeps
  // the chips, not their Undo (as before)
  let undo = null;
  // Doors Agent (spec §6): the screen sets the answer's length. Drive mode while it is open; a stop while its panel is
  // open; else the plan and its map
  // ease audit 2 #2: the starters name the door the rep is at (an open door card, drive mode's stop), else the selected
  // day's next stop
  const startList = () => {
    const m = mode();
    const sel = S.getSelectedDay();
    return starters(S.getPlan(), { here: m === "plan" ? null : current, dayIndex: typeof sel === "number" ? sel : null });
  };
  const mode = () => modeOf({ driving: document.documentElement.classList.contains("driving"), stop: Boolean(document.querySelector(".stopview:not([hidden])")) });

  function draw() {
    log.innerHTML = messages.length
      ? messages.map((m, i) => msgHtml(m, i === messages.length - 1, messages.slice(0, i).findLast((x) => x.role === "agent"), i)).join("")
      : `<div class="aempty" data-agent="hello">${esc(greeting(S.getPlan()?.profile))}</div><div class="astart">${startList().map((x, i) => `<button type="button" class="btn line sm" data-agent="start" data-i="${i}">${esc((x.label ?? x.text).trim())}</button>`).join("")}</div>`; // ease audit #12: three asks to start from (spec §6 had none)
    log.scrollTop = log.scrollHeight;
    const lastAgent = messages.findLast((m) => m.role === "agent");
    // Jard web review 10-24 #7: no paragraph on where messages go under the box, only the Privacy link (privacy.html says
    // it); the footer keeps a line only when Claude was passed over (r.notice: spent for the day, back at …)
    $("#agentWho", panel).textContent = lastAgent && !lastAgent.resting && lastAgent.notice ? inLocalTime(lastAgent.notice) : "";
    $("#agentModel", panel).textContent = lastAgent?.badge ?? "";
  }
  function msgHtml(m, last, prev, i) {
    if (m.role === "user") return `<div class="agent-msg" data-role="user">${esc(m.text)}</div>`;
    // spec §6: every door fact keeps its source, as a small quiet tag (Qloo / route / you / link); a link opens the page
    const tagHtml = (src) => {
      const t = sourceTag(src);
      return t.url ? `<a class="agent-src" data-tag="link" href="${esc(t.url)}" target="_blank" rel="noopener noreferrer" title="${esc(t.title)}">link ↗</a>` : `<span class="agent-src" data-tag="${esc(t.tag)}" title="${esc(t.title)}">${esc(t.tag)}</span>`;
    };
    // judge pass 8 (#2): a fact the answer already says shows as its source's name only (lib/agent-ui.js sourceItems)
    const items = sourceItems(m);
    const facts = items.length
      ? `<details class="agent-facts"${items.length <= 3 ? " open" : ""}><summary>Sources (${items.length})</summary><ul>${items.map((f) => `<li data-kind="${esc(f.source?.kind ?? "")}" data-field="${esc(f.source?.field ?? "")}"${f.short ? " data-short" : ""}>${esc(f.text)}${f.named ? "" : ` ${tagHtml(f.source)}`}</li>`).join("")}</ul></details>`
      : "";
    // spec §5: a chip per change ("Meanwhile moved to Friday · Undo"); Undo on the last answer's chips only
    const chips = chipsOf(m);
    const did = chips.length ? `<div class="agent-did">${chips.map((c) => `<span class="achip"${c.undone ? " data-undone" : ""}>${esc(c.text)}${c.undone ? " · Undone" : last && undo?.at === i && undo.fns.has(c.g) ? ` · <button type="button" class="lnk" data-agent="undo" data-g="${esc(c.g)}">Undo</button>` : ""}</span>`).join("")}</div>` : "";
    // spec §6: away from drive mode a reply is spoken only on this tap (Aura-2, ui/voice.js sayAgent)
    const speak = m.text ? `<button type="button" class="asay" data-agent="say" data-i="${i}" aria-label="Read this answer aloud" title="Read aloud">${icon("voice", 16)}</button>` : "";
    const note = restNote(m, prev);
    const rest = note ? `<div class="arest">${esc(note)}</div>` : "";
    // judge pass 4 (#2): a follow-up on a day the door is closed: one tap moves it to the next open day
    // judge pass 5 (#3): the offer stays on its message, past the next one, while the follow-up is still as logged
    const live = (m.offers ?? []).map((o, k) => ({ o, k })).filter(({ o }) => offerLive(o, S.getPlan()?.outcomes));
    const offers = live.length ? `<div class="agent-did">${live.map(({ o, k }) => `<button type="button" class="lnk" data-agent="fu-alt" data-i="${i}" data-k="${k}">Move ${esc(o.name)} to ${esc(altLabel(o.alt))}</button>`).join(" · ")}</div>` : "";
    // door notes: a fact the model didn't note, offered (one tap saves it, in the rep's words)
    const on = m.offerNote && !hasNote(notesOf(S.getPlan()?.slots, m.offerNote.id), m.offerNote.text) ? `<div class="agent-did"><button type="button" class="lnk" data-agent="note-offer" data-i="${i}">Save as a note for ${esc(m.offerNote.name)}</button></div>` : "";
    // ability 4: the follow-up draft, opened in the rep's own mail or text app (Doors never sends it)
    const d = m.draft;
    const dr = d ? `<div class="agent-draft" data-channel="${esc(d.channel)}">${d.subject ? `<div class="adraft-s">${esc(d.subject)}</div>` : ""}<div class="adraft-b">${esc(d.body)}</div><a class="lnk adraft-open" href="${esc(d.href)}">${d.channel === "text" ? "Open in Messages" : "Open in Mail"}</a> · <button type="button" class="lnk" data-agent="draft-copy" data-i="${i}">Copy</button></div>` : "";
    // ease audit 2 #3: "I'm running late" with no time: Start my day's own picks, on the last answer only
    const lt = last && m.late?.picks?.length ? `<div class="agent-did">${m.late.picks.map((x) => `<button type="button" class="btn line sm" data-agent="late" data-by="${x}">${esc(latePickLabel(x))}</button>`).join(" ")}</div>` : "";
    return `<div class="agent-msg" data-role="agent" data-by="${esc(m.by ?? "")}">${speak}${esc(m.text)}${dr}${facts}${did}${lt}${offers}${on}${rest}</div>`;
  }
  // ---------- talk (PARITY M3, the phone's ChatView the same): the mic left of Send; the words go INTO the box to edit,
  // never sent on their own. The browser's speech first, else the Worker's Whisper (ui/voice.js listen) ----------
  const micB = $('[data-agent="mic"]', panel);
  const errP = $(".aerr", panel);
  const PH = input.placeholder;
  let mic = null; // {phase: "listen" | "reading", secs, stop, t}
  function drawMic() {
    const ph = mic?.phase ?? "idle";
    micB.hidden = !canListen() && !mic;
    micB.classList.toggle("on", ph === "listen");
    micB.setAttribute("aria-pressed", String(ph === "listen"));
    micB.disabled = ph === "reading";
    micB.innerHTML = ph === "listen" ? icon("stop", 16) : ph === "reading" ? "…" : icon("mic", 18);
    micB.setAttribute("aria-label", ph === "listen" ? "Stop listening" : ph === "reading" ? "Getting your words" : "Talk: tap and say it");
    input.placeholder = ph === "idle" ? PH : micLabel(ph, mic.secs, "");
  }
  function micErr(msg) { errP.textContent = msg ?? ""; errP.hidden = !msg; }
  function stopMic() {
    const m = mic;
    mic = null;
    clearInterval(m?.t);
    m?.stop?.();
    if (m) drawMic();
  }
  function talk() {
    if (mic?.phase === "listen") return mic.stop?.(); // a second tap ends it: what was said goes in the box
    if (mic) return;
    hush(); // the agent's spoken answer stops: the rep is talking
    micErr(null);
    const base = input.value.trim();
    const put = (t) => { input.value = [base, t].filter(Boolean).join(" ").slice(0, 600); grow(); };
    const me = (mic = { phase: "listen", secs: 0 });
    const t0 = Date.now();
    me.t = setInterval(() => { if (mic === me && me.phase === "listen") (me.secs = Math.floor((Date.now() - t0) / 1000)), drawMic(); }, 1000);
    drawMic();
    const end = () => { if (mic === me) clearInterval(me.t), (mic = null), drawMic(); };
    const stop = hear({
      onLive: (t) => { if (mic === me && !/^Listening…/.test(t)) put(t); }, // the browser's words as they come; the recording's "Listening…" is not words
      onPhase: (ph) => { if (mic === me && me.phase !== ph) (me.phase = ph), drawMic(); },
      onText: (t) => { if (mic !== me) return; put(t); end(); input.focus(); input.setSelectionRange(input.value.length, input.value.length); },
      onFail: (msg) => { if (mic !== me) return; input.value = base; end(); micErr(msg); },
    });
    if (mic === me) me.stop = stop;
  }
  micB.addEventListener("click", talk);
  input.addEventListener("input", () => micErr(null));

  // round 8 (Jard 10-28, his iPhone: "when you pull up the agent, it should just be the whole screen"): at a phone width
  // the panel takes the whole screen (css/agent.css) and follows the visual viewport, so with the keyboard up the box,
  // the thread and the × sit above it (iOS keeps a fixed element's bottom under the keyboard: --kb is the keyboard's
  // height in layout px, --vvt the visible top, --vvh the visible height). The page under it is locked while it is open
  // (body fixed at its scroll), so neither the keyboard nor a swipe over the thread moves it. Round 7's sheet (the
  // lower part of the screen, a scrim) is gone: "the phone is too small to have a half screen to chat with an agent".
  const phoneMQ = typeof matchMedia === "function" ? matchMedia("(max-width:700px)") : { matches: false };
  const vv = typeof visualViewport !== "undefined" ? visualViewport : null;
  const fitViewport = () => {
    if (panel.hidden || !phoneMQ.matches) return;
    const vh = vv ? vv.height : innerHeight;
    const kb = vv ? Math.max(0, Math.round(innerHeight - vv.height - vv.offsetTop)) : 0;
    panel.style.setProperty("--kb", `${kb}px`);
    panel.style.setProperty("--vvt", `${Math.max(0, Math.round(vv ? vv.offsetTop : 0))}px`);
    // the tour (html.in-demo): its banner (Skip, Close tour) stays in view above the panel
    const banner = document.documentElement.classList.contains("in-demo") ? document.querySelector(".demo-banner") : null;
    panel.style.setProperty("--atop", `${banner && banner.getClientRects().length ? Math.max(0, Math.round(banner.getBoundingClientRect().bottom)) : 0}px`);
    panel.style.setProperty("--vvh", `${Math.round(vh)}px`);
    panel.classList.toggle("kb-up", kb > 80); // the keyboard is up: the sheet may take more of what is left
    document.documentElement.style.setProperty("--sheet-h", `${Math.round(panel.getBoundingClientRect().height + kb)}px`); // the toast sits above the sheet
  };
  let lockTop = null; // the page's scroll while the body is locked
  const lockPage = (on) => {
    if (on && !phoneMQ.matches) return;
    if (on === (lockTop != null)) return;
    if (on) {
      lockTop = scrollY;
      document.body.style.top = `${-lockTop}px`;
      document.documentElement.classList.add("agent-lock");
    } else {
      const y = lockTop;
      lockTop = null;
      document.documentElement.classList.remove("agent-lock");
      document.body.style.top = "";
      scrollTo(0, y);
    }
  };
  vv?.addEventListener("resize", fitViewport);
  vv?.addEventListener("scroll", fitViewport);
  // round 8: on the phone the open panel is a history entry (as the plan's panels, ui/app.js planNav): Back (the
  // phone's swipe from the edge, the browser's button) closes it, and the × goes back so the entry goes with it. The
  // history is what says whether it is open: a pop onto the entry (Back from a door the Agent opened) opens it again.
  let hist = false; // the panel's entry is the history's top
  const inHistory = () => Boolean(history.state?.doorsAgent);
  const onPop = () => {
    if (!phoneMQ.matches) return;
    if (!panel.hidden && !inHistory()) { hist = false; open(false); }
    else if (panel.hidden && inHistory()) { hist = true; open(true, { fromHistory: true }); }
  };
  window.addEventListener("popstate", onPop);
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(() => fitViewport()) : null; // a reply changes the sheet's height: the toast follows
  ro?.observe(panel);
  // the box is one line and grows with its text to the css cap (max-height), on every width
  const grow = () => {
    input.style.height = "auto";
    const cap = parseFloat(getComputedStyle(input).maxHeight) || 120;
    // empty: the css height (one line; a wrapped placeholder does not grow it)
    input.style.height = input.value ? `${Math.min(input.scrollHeight, cap)}px` : "";
    input.style.overflowY = input.value && input.scrollHeight > cap ? "auto" : "hidden";
    fitViewport();
  };
  input.addEventListener("input", grow);
  function open(on = true, { fromHistory = false } = {}) {
    if (!on) stopMic();
    if (on && !fromHistory && phoneMQ.matches && !hist && !inHistory()) { try { history.pushState({ doorsAgent: true }, ""); hist = true; } catch {} }
    if (!on && hist) { hist = false; if (inHistory()) { try { history.back(); } catch {} } } // its entry goes with it (the pop finds the panel closed already)
    panel.hidden = !on;
    document.documentElement.classList.toggle("agent-open", on); // the plan's toast moves clear of the panel
    $('[data-agent="open"]', root)?.setAttribute("aria-expanded", String(on));
    if (on) {
      if (!mic) drawMic(); // voice that died elsewhere (drive's Done) takes the mic away here too
      messages = readLog(keyOf(S.getPlan(), { demo }));
      draw();
      lockPage(true);
      grow();
      fitViewport();
      input.focus();
    } else {
      panel.style.removeProperty("--kb");
      document.documentElement.style.removeProperty("--sheet-h");
      lockPage(false);
    }
  }

  // ease audit 2 #3: running late is Start my day's Running late (ui/plan.js opens it, ui/drive.js sets how late); the
  // panel closes so its late line and move offer are in view
  function runLate(by) {
    if (!(by > 0)) return;
    open(false);
    window.dispatchEvent(new CustomEvent("doors:late", { detail: { by } }));
  }

  // ---------- the actions, through state.js ----------
  // → {chips: [{text, g}], fns: Map group → undo}. Groups (lib/agent-ui.js changeSet): "plan" for statuses, outcomes and
  // re-plans (they come back together: the snapshot from before the turn, and each re-plan's own Undo), one each for a
  // kept fact or a talking-point change
  async function apply(actions, plan, reply = "") {
    const cs = changeSet();
    const did = (text, g = null) => cs.add(text, g);
    // statuses and outcomes come back exactly as they were (drive mode's snapshot), else one by one
    const snap = (actions ?? []).some((a) => a.type === "status" || a.type === "outcome") && S.can("snapshot") ? S.snapshot() : null;
    const name = (id) => plan.venues?.[id]?.name ?? "that door";
    // first in, so it runs last: after the re-plans' own Undo, the turn's start comes back
    if (snap) cs.undo("plan", () => S.restore(snap));
    let k = 0;
    for (const a of actions ?? []) {
      const g = a.type === "status" || a.type === "outcome" || a.type === "replan" ? "plan" : `c${k++}`;
      try {
        if (a.type === "status" && S.can("setStatus")) {
          const prev = plan.statuses?.[a.id] ?? null;
          await S.setStatus(a.id, a.status);
          if (!snap) cs.undo(g, () => S.setStatus(a.id, prev));
          if (a.status !== "visited") did(`${name(a.id)}: ${a.status === "notfit" ? "not a fit" : "already known"}`, g);
        } else if (a.type === "outcome" && S.can("setOutcome")) {
          const prev = plan.outcomes?.[a.id] ?? null;
          await S.setOutcome(a.id, a.outcome);
          if (!snap) cs.undo(g, () => S.setOutcome(a.id, prev));
          did(`${name(a.id)} logged: ${RESULT_TEXT[a.outcome.result] ?? a.outcome.result}${a.outcome.followUp ? `, follow up ${niceDate(a.outcome.followUp)}${a.outcome.followUpTime ? `, ${clock12(toMinutes(a.outcome.followUpTime)).replace(":00 ", " ")}` : ""}` : ""}`, g);
        } else if (a.type === "slot" && S.can("setSlot")) {
          // judge pass 4 (#1): a rule that replaces an older one, or touches the brand's name, says so (once)
          const notes = /^rule\./.test(a.record.field) ? ruleNotes(plan.slots ?? {}, a.record, plan.profile?.brand).filter((x) => !reply.includes(x)) : [];
          S.setSlot(a.id, a.record);
          // judge pass 3 (N5): what they said and the day to come back are already in the "logged" line: they come back
          // with it
          const withVisit = (a.record.field === "said" || a.record.field === "next") && (actions ?? []).some((b) => b.type === "outcome" && b.id === a.id);
          cs.undo(withVisit ? "plan" : g, () => S.setSlot(a.id, { clear: a.record.field, value: a.record.value }));
          if (withVisit) continue;
          // live check: a kept fact said nothing on screen ("the manager is called Dana" looked ignored)
          const v = a.record.value;
          // judge pass 3: a rule and a pushback said in words, not as field names ("Kept: term", "objection")
          const PUSH = { price: "price", space: "no room for it", local: "wants local", own: "pours its own", already: "already carries one", owner: "the owner decides", nosell: "doesn't think it would sell" };
          if (a.record.field === "rule.avoid") { did([`Your rules: never say “${v}”`, ...notes].join(". "), g); continue; }
          if (a.record.field === "rule.term") { did([`Your rules: say “${v?.to}”, not “${v?.from}”`, ...notes].join(". "), g); continue; }
          // door notes: the reply already says it ("Noted on …"): the chip says where it went
          if (a.record.field === "note") { did(reply.includes(String(v).slice(0, 24)) || /\bNoted\b/.test(reply) ? `In ${name(a.id)}'s Notes` : `Noted for ${name(a.id)}: “${String(v).slice(0, 80)}${String(v).length > 80 ? "…" : ""}”`, g); continue; }
          if (a.record.field === "objection") { did(`Kept for ${name(a.id)}: their pushback (${PUSH[v?.kind] ?? v?.kind ?? "noted"})`, g); continue; }
          const what = a.record.field === "contact" ? `contact ${v?.name ?? v}${v?.role ? ` (${v.role})` : ""}` : typeof v === "string" ? `${a.record.field.replace(/^rule\./, "")}: “${v.slice(0, 60)}”` : a.record.field.replace(/^rule\./, "");
          did(`Kept${a.id && a.id !== "*" ? ` for ${name(a.id)}` : ""}: ${what}`, g);
        } else if (a.type === "talk" && S.can("setTalk")) {
          S.setTalk(a.id, a);
          cs.undo(g, () => S.setTalk(a.id, { undoLast: true }));
          did(`${a.op === "remove" ? "Removed" : a.op === "add" ? "Added" : "Changed"} ${a.section === "opener" ? "the opener" : a.section === "toBuyer" ? "the line to the buyer" : a.section === "ask" ? "the ask" : `a line in ${a.section}`} for ${name(a.id)}`, g);
        } else if (a.type === "replan" && S.can("agentReplan")) {
          const out = {}; // plan.js fills its Undo and what changed, in a few words (the chip)
          const text = await S.agentReplan(a, out); // its own toast carries Undo too
          if (text?.unchanged) did(text.text.replace(/\.$/, "")); // judge pass 6 (#7): a refused move changed nothing
          else if (text) {
            if (out.undo) cs.undo(g, out.undo);
            did(out.said ?? text.replace(/\.$/, ""), out.undo ? g : null); // judge pass 2 (26): where the doors went
          } else did("Nothing on the plan needed to change");
        } else if (a.type === "open") {
          const p = S.getPlan();
          const day = p?.days?.findIndex((d) => d.stops.some((s) => s.id === a.id));
          window.dispatchEvent(new CustomEvent("doors:open-stop", { detail: { id: a.id, day: day >= 0 ? day : null } }));
          if (phoneMQ.matches) { hist = false; open(false); } // round 8: the panel is the whole screen on the phone: the door opened under it is what to see (its entry stays: Back from the door returns here)
        } else if (a.type === "late" && a.by > 0) {
          runLate(a.by);
          did(`Start my day: ${latePickLabel(a.by)}`);
        } else did(`(This version of Doors can't apply a ${a.type} change.)`);
      } catch (e) {
        did(`Couldn't apply a ${a.type} change: ${e.message}`);
      }
    }
    const fns = cs.undos;
    // a group with no chip on screen (a visit's said/next alone) has nothing to tap: never an Undo hidden in the chips
    for (const c of cs.chips) if (c.g != null && !fns.has(c.g)) c.g = null;
    return { chips: cs.chips, fns };
  }

  // ---------- one turn ----------
  async function send(text, { quiet = false } = {}) {
    const t = String(text ?? "").trim().slice(0, 600);
    const plan = S.getPlan();
    if (!t || busy || !plan) return null;
    if (panel.hidden && !quiet) open(true);
    busy = true;
    panel.dataset.state = "thinking";
    messages.push({ role: "user", text: t });
    draw();
    log.insertAdjacentHTML("beforeend", `<div class="agent-msg athinking" data-role="agent">…</div>`);
    // R9 polish: a model step that runs long is cut at 8 s on the Worker (STEP_MS) and the backup answers: say so (only
    // when a model is asked: the demo's rules answer in the page). Live check D: Llama 70b's normal turn is 1–10 s (2–3
    // steps), so the line waits 10 s and doesn't claim a backup yet
    const slow = transportNotice ? 0 : setTimeout(() => { const el = $(".athinking", log); if (el) el.textContent = "Still working: the model is slow right now…"; }, 10000);
    const late = (ms, v) => new Promise((ok) => setTimeout(() => ok(v), ms));
    let r;
    let did = { chips: [], fns: new Map() };
    const asMode = mode(); // the screen it was asked from (drive mode can close before the answer comes)
    let offers = [];
    try {
      data ??= await Promise.race([loadStopData(plan).catch(() => ({})), late(STOP_DATA_MS, null)]);
      const d = data ?? {};
      const sel = S.getSelectedDay();
      // round 3: the enrich records the stop page loaded (talk2's loader, ui/stop.js loadStopData: enrichRecords = {id:
      // record}, a door fetched live is added there too) reach the Agent (agent-context.js insightOf renders them)
      const ctxFor = (dayIndex) => ({ ...agentContext({ plan, dayIndex, current, city: d.city, facts: d.facts, routes: d.routes, enrich: d.enrichRecords ?? d.enrich ?? null, deep: d.deepFacts ?? null, now: new Date() }), mode: asMode });
      let context = ctxFor(typeof sel === "number" ? sel : plan.days.findIndex((x) => !x.past && x.stops.length));
      if (pendingWhyNot) { // §4.5: one turn carries the thread panel's ask
        context.whynot = pendingWhyNot;
        pendingWhyNot = null;
      }
      // judge pass 2 (5): "why isn't X first?": the planner tries X first on a scratch copy, so the answer names the trade
      const asked = /\b(first|start with|open with|lead with)\b/i.test(t) && doorNamed(t, context, { here: false });
      if (asked && !context.day?.stops.some((x) => x.id === asked) && dayHolding(plan, asked) >= 0) context = ctxFor(dayHolding(plan, asked)); // judge pass 9 #5
      if (asked && context.day.stops.findIndex((x) => x.id === asked) > 0) context.day.trade = (await S.whatIfFirst(asked)) ?? null;
      const convo = messages.slice(-MAX_KEPT).map((m) => ({ role: m.role, text: m.text }));
      const rules = (message) => ({ ...answerByRules(convo, context, { now: `${context.today}T${context.now}` }), resting: true, message });
      try {
        // a turn never hangs: past TURN_MS (or on any failure) Doors' rules answer on this device
        r = await Promise.race([call("/api/agent", { v: 1, messages: convo, context }), late(TURN_MS, null)]);
        if (!r) r = rules("Doors Agent took too long; this answer is from Doors' rules, on this device.");
      } catch {
        r = rules("Doors Agent can't be reached right now; this answer is from Doors' rules, on this device.");
      }
      // judge pass 4 (#2, #3): a logged follow-up is checked against its door's hours before it is saved
      ({ offers, ...r } = fitReply(r, plan.venues, { windows: plan.windows ?? [], week: plan.profile?.week ?? null, visitMin: plan.profile?.visitMin ?? 25, outcomes: plan.outcomes ?? {} }));
      did = await apply(r.actions, plan, r.reply ?? "");
    } catch (e) {
      // anything else (a plan that changed under the turn): say so, and leave the panel ready for the next ask
      console.warn("agent:", e);
      r = { reply: "Something went wrong answering that. Try asking again.", facts: [], actions: [], by: "rules", resting: true };
    } finally {
      clearTimeout(slow);
      busy = false;
    }
    // intuit audit #9: no "resting" badge (it meant nothing to either persona); the footer already says no model was used
    const badge = r.resting ? (r.retry ? "Doors' rules · model busy" : "") : r.by === "gemini" ? "Gemini" : r.by === "workers-ai" ? "Workers AI" : "";
    messages.push({ role: "agent", text: r.reply ?? "", facts: r.facts ?? [], by: r.by, ...(r.model ? { model: r.model } : {}), ...(r.notice ? { notice: String(r.notice).slice(0, 200) } : {}), badge, chips: did.chips, ...(offers.length ? { offers } : {}), ...(r.offerNote?.id && plan.venues?.[r.offerNote.id] ? { offerNote: { id: r.offerNote.id, name: plan.venues[r.offerNote.id].name, text: String(r.offerNote.text ?? "").slice(0, 300) } } : {}), ...(draftOf(r) ? { draft: draftOf(r) } : {}), ...(Array.isArray(r.late?.picks) ? { late: { picks: r.late.picks.filter((x) => x > 0 && x <= 240) } } : {}), resting: Boolean(r.resting), message: r.message });
    undo = did.fns.size ? { at: messages.length - 1, fns: did.fns } : null;
    writeLog(keyOf(plan, { demo }), messages);
    panel.dataset.state = r.resting ? "resting" : "idle";
    draw();
    // spec §6: drive mode speaks the reply (ui/drive.js, with its Voice switch); elsewhere only the 🔊 tap does
    window.dispatchEvent(new CustomEvent("doors:agent-reply", { detail: { reply: r.reply, facts: r.facts ?? [], actions: r.actions ?? [], by: r.by, mode: asMode, quiet, changes: chipsText(did.chips), ...(r.whynot ? { whynot: r.whynot } : {}) } }));
    return r;
  }
  api = { send, setDoor: (id) => { if (id) current = id; } };

  // ---------- wiring ----------
  const onRoot = (e) => {
    if (e.target.closest('[data-agent="open"]')) open(panel.hidden);
  };
  root.addEventListener("click", onRoot);
  panel.addEventListener("click", async (e) => {
    if (e.target.closest('[data-agent="close"]')) return open(false);
    const st = e.target.closest('[data-agent="start"]');
    if (st) {
      const x = startList()[+st.dataset.i];
      if (!x) return;
      if (x.send) return void send(x.text);
      input.value = x.text;
      grow();
      return input.focus();
    }
    const lb = e.target.closest('[data-agent="late"]');
    if (lb) return runLate(+lb.dataset.by);
    const sy = e.target.closest('[data-agent="say"]');
    if (sy) return void sayAgent(messages[+sy.dataset.i]?.text ?? "");
    const fa = e.target.closest('[data-agent="fu-alt"]');
    const m = fa ? messages[+fa.dataset.i] : null;
    if (fa && m?.offers?.[+fa.dataset.k] && offerLive(m.offers[+fa.dataset.k], S.getPlan()?.outcomes) && S.can("setOutcome")) {
      const o = m.offers[+fa.dataset.k];
      const moved = moveFollowUp(o.outcome, o.alt);
      await S.setOutcome(o.id, moved);
      m.offers = null;
      // its chip's Undo puts the follow-up back where it was logged
      messages.push({ role: "agent", text: `Moved: ${o.name}, follow up ${niceDate(moved.followUp)}${moved.followUpTime ? `, ${clock12(toMinutes(moved.followUpTime)).replace(":00 ", " ")}` : ""}.`, by: "rules", chips: [{ text: `${o.name}: follow-up moved`, g: "fu" }] });
      undo = { at: messages.length - 1, fns: new Map([["fu", () => S.setOutcome(o.id, o.outcome)]]) };
      writeLog(keyOf(S.getPlan(), { demo }), messages);
      return draw();
    }
    // ability 4: copy the draft (mobile2 10-23: with no mail app, "Open in Mail" does nothing)
    const dc = e.target.closest('[data-agent="draft-copy"]');
    const dm = dc ? messages[+dc.dataset.i]?.draft : null;
    if (dm) {
      navigator.clipboard?.writeText(dm.subject ? `${dm.subject}\n\n${dm.body}` : dm.body).then(() => (dc.textContent = "Copied"), () => (dc.textContent = "Select the text to copy"));
      return;
    }
    const no = e.target.closest('[data-agent="note-offer"]');
    const om = no ? messages[+no.dataset.i]?.offerNote : null;
    if (om && S.can("setSlot")) {
      const rec = makeNote({ text: om.text, by: "rep" });
      S.setSlot(om.id, rec);
      messages.push({ role: "agent", text: `Noted on ${om.name}: “${rec.value}”`, by: "rules", chips: [{ text: `In ${om.name}'s Notes`, g: "note" }] });
      undo = { at: messages.length - 1, fns: new Map([["note", () => S.setSlot(om.id, { note: rec.id, drop: true })]]) };
      writeLog(keyOf(S.getPlan(), { demo }), messages);
      return draw();
    }
    // a chip's Undo: its group comes back, and every chip of the group says Undone (the others stay undoable)
    const ub = e.target.closest('[data-agent="undo"]');
    const fn = ub && undo ? undo.fns.get(ub.dataset.g) : null;
    if (fn) {
      const at = undo.at;
      undo.fns.delete(ub.dataset.g);
      await fn();
      for (const c of messages[at]?.chips ?? []) if (c.g === ub.dataset.g) c.undone = true;
      writeLog(keyOf(S.getPlan(), { demo }), messages);
      draw();
    }
  });
  $("#agentForm", panel).addEventListener("submit", (e) => {
    e.preventDefault();
    stopMic();
    micErr(null);
    const t = input.value;
    input.value = "";
    grow();
    if (phoneMQ.matches) input.blur(); // the answer would come in behind the keyboard; sent = done typing (as the phone app)
    send(t);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      $("#agentForm", panel).requestSubmit();
    }
  });
  const onOpenStop = (e) => (current = e.detail?.id ?? null);
  window.addEventListener("doors:open-stop", onOpenStop);
  const onKey = (e) => {
    if (e.key === "Escape" && !panel.hidden && panel.contains(document.activeElement)) open(false);
  };
  document.addEventListener("keydown", onKey);
  return () => {
    root.removeEventListener("click", onRoot);
    window.removeEventListener("doors:open-stop", onOpenStop);
    window.removeEventListener("doors:ask", onAsk);
    document.removeEventListener("keydown", onKey);
    window.removeEventListener("popstate", onPop);
    vv?.removeEventListener("resize", fitViewport);
    vv?.removeEventListener("scroll", fitViewport);
    ro?.disconnect();
    stopMic();
    lockPage(false);
    document.documentElement.style.removeProperty("--sheet-h");
    panel.remove();
    document.documentElement.classList.remove("agent-open");
    if (api?.send === send) api = null;
  };
}

