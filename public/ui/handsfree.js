// The hands-free Doors Agent in Start my day. Group 3 #8 (Jard 10-24): one tap, no chat box. Jard 10-28: "I wanted
// the agent to be always hands free in driving mode": from the moment drive mode opens (Voice on, a microphone), the
// Agent listens by itself, in a bar docked at the bottom of the drive screen (the door, Navigate and Log visit stay in
// use above it); it keeps listening after a quiet gap and listens again after each answer. When the rep's words are in,
// a short canned line says the Agent got them at once (lib/ack.js, a baked Aura-2 clip, ui/voice.js ack) while the
// model works; the answer is read aloud in the Aura-2 voice (ui/voice.js say) through the one tap-unlocked <audio>.
// The ear is voice.js listen({wait}): the page's own recording, nothing sent until there's speech. A read-aloud pauses
// it (pause / resume), so it never hears Doors itself. The turn is the chat panel's own (ui/agent.js sendAgent, quiet),
// so it is in the chat history and its changes are applied and undoable there.
// drivefix (Jard 10-29: "i'm confused about when and how to talk when logging the door"): this bar is the ONE
// microphone in drive mode. Log visit and Say a note don't open a mic of their own: they borrow this ear with
// capture({prompt, onText}) — the bar says what it is listening for ("Listening: say how it went") and the words go to
// them instead of the Agent — and release() gives it back. The bar is one compact row: the mic button, one status line
// in plain words, the Agent's answer in at most two lines with More (the full Agent panel), and Type. Mic off is one
// state ("Mic off: tap to turn it on"), whatever turned it off.
// r8hf (Jard 10-28, Brave on iPhone opened the chat box instead): the Agent NEVER falls back to typing without a word.
// start(id, {reason}) shows the bar "Mic off" with the reason (no microphone API, the microphone blocked or busy, the
// Worker's ear off, a quiet AudioContext…) and waits for a tap; the chat box opens only from Type. ?voicedebug=1 (or
// localStorage doors:voicedebug) adds a line with what this browser has (voice.js voiceStatus), so a screenshot from a
// phone says what happened.
import { esc } from "./dom.js";
import { listen as hear, sayAgent, ack, hush, speaking, sayParts, voiceUsed, retryVoiceIn, voiceStatus, MSG } from "./voice.js";
import { sendAgent, setAgentDoor } from "./agent.js";
import { icon } from "../lib/icons.js";

// the status line, one per phase (paused = Doors itself is reading aloud: to the rep that is speaking too)
export const HF = {
  listen: "Listening: ask a question or say how the visit went",
  reading: "Listening: getting your words…",
  think: "Working…",
  speak: "Speaking: tap to stop",
  paused: "Speaking: tap to stop",
  muted: "Mic off: tap to turn it on",
  off: "Mic off: tap to try again", // the note line under it says why (voice.js MSG, or the reason start() was given)
};
// what a tap on the mic does, for its label (the status line says what is happening)
const TAP = { listen: "Turn the mic off", reading: "Done talking", think: "Stop and listen", speak: "Stop and listen", paused: "Stop and listen", muted: "Turn the mic on", off: "Try the mic again" };
export const HF_VOICE_OFF = "Voice is off. Tap the mic to turn it on, or tap Type.";
export const HF_QUIET = "Nothing was said.";
export const HF_NO_ANSWER = "Doors Agent didn't answer. Say it again, or type it.";
export const HF_PHONE_VOICE = "The Doors voice isn't available right now: this is the browser's own voice.";
const POLL_MS = 200;

// mountHandsFree({onType, onMore, onListen, onMute}) → {start(doorId, {reason, muted}), stop(), mute(), pause(), resume(),
// capture({prompt, onText}), release(), active(), phase(), destroy()}.
// onType: the Type button (drive mode: the Log visit box when its sheet is up, else the chat panel). onMore: the
// answer's More (the full Agent panel). onListen(): the rep turned the mic on (the mic button) → false to refuse;
// drive mode turns Voice on there. onMute(): the rep turned it off (drive mode turns Voice off). onPhase(phase): every
// change (drive mode says on the sheet whether the bar is listening).
export function mountHandsFree({ onType = () => {}, onMore = onType, onListen = () => true, onMute = () => {}, onPhase = () => {} } = {}) {
  let el = null;
  let run = 0; // each start / stop / mute / pause / capture: a loop from an older run ends quietly
  let phase = "muted";
  let words = "";
  let answer = "";
  let note = "";
  let stopRec = null;
  let held = 0; // pause() calls outstanding (a read-aloud and another can overlap)
  let wasOn = false; // listening (or working) when pause() came: resume() listens again
  let cap = null; // {prompt, onText}: Log visit or a note has the ear (its words go there, not to the Agent)
  let away = null; // the Agent panel is open over the bar (Type, More): listening again when it closes
  let ro = null;
  let live = false; // words are coming in on this listen (a tap then means done talking, not mic off)

  function draw() {
    if (!el) return;
    el.dataset.phase = phase;
    el.toggleAttribute("data-capture", Boolean(cap));
    const head = cap && (phase === "listen" || phase === "reading") ? cap.prompt : HF[phase] ?? HF.muted;
    el.querySelector("[data-hf-status]").textContent = head;
    const big = el.querySelector("[data-hf-big]");
    big.setAttribute("aria-label", `${head}. ${TAP[phase] ?? ""}`);
    big.setAttribute("aria-pressed", String(phase === "listen" || phase === "reading"));
    big.innerHTML = `${icon(phase === "think" || phase === "speak" || phase === "paused" ? "stop" : "mic", 26)}<span class="hf-dot" aria-hidden="true"></span>`;
    // "You said" while it works on the words; the answer (two lines at most, More for the rest) once there is one
    el.querySelector("[data-hf-words]").innerHTML = words && (phase === "think" || phase === "reading") ? `<span>You said</span> ${esc(words)}` : "";
    const a = el.querySelector("[data-hf-answer]");
    a.textContent = cap || phase === "think" ? "" : answer;
    const n = el.querySelector("[data-hf-note]");
    n.textContent = note;
    n.hidden = !note;
    fitMore();
    drawDebug();
  }
  // More shows only when the answer runs past its two lines
  function fitMore() {
    const a = el?.querySelector("[data-hf-answer]");
    const m = el?.querySelector("[data-hf-more]");
    if (!a || !m) return;
    m.hidden = !a.textContent || a.scrollHeight <= a.clientHeight + 1;
  }
  // ?voicedebug=1: what this browser has, one line, refreshed while the bar is up
  const debugOn = () => { try { return /[?&]voicedebug=1/.test(location.search + location.hash) || localStorage.getItem("doors:voicedebug") === "1"; } catch { return false; } };
  function drawDebug() {
    const d = el?.querySelector("[data-hf-debug]");
    if (!d) return;
    if (!debugOn()) { d.hidden = true; return; }
    const v = voiceStatus();
    d.textContent = `voice: phase ${phase}${cap ? " (capture)" : ""} · secure ${v.secure} · rec ${v.rec} · gum ${v.gum} · ac ${v.ac} ctx ${v.ctx} · session ${v.session} · online ${v.online}${v.demo ? " · demo" : ""} · in ${v.in} out ${v.out} server ${v.server} · unlocked ${v.unlocked}${v.fail ? ` · last fail ${v.fail}` : ""} · ${v.ua}`;
    d.hidden = false;
  }
  function build() {
    el = document.createElement("section");
    el.className = "hf";
    el.setAttribute("role", "region");
    el.setAttribute("aria-label", "Doors Agent, hands-free");
    el.innerHTML = `
      <div class="hf-in">
        <button type="button" class="hf-big" data-hf-big aria-pressed="false"></button>
        <div class="hf-text">
          <p class="hf-status" data-hf-status aria-live="polite"></p>
          <p class="hf-words" data-hf-words></p>
          <p class="hf-answer" data-hf-answer aria-live="polite"></p>
          <button type="button" class="hf-more" data-hf-more hidden>More</button>
          <p class="hf-note" data-hf-note role="status" hidden></p>
          <p class="hf-debug" data-hf-debug hidden></p>
        </div>
        <button type="button" class="hf-btn" data-hf-type>Type</button>
      </div>`;
    el.addEventListener("click", (e) => {
      if (e.target.closest("[data-hf-type]")) return panel(onType);
      if (e.target.closest("[data-hf-more]")) return panel(onMore);
      if (e.target.closest("[data-hf-big]")) return tapBig();
    });
    document.body.append(el);
    // drive mode sits clear of the bar, whatever height its words give it
    if (typeof ResizeObserver === "function") {
      ro = new ResizeObserver(() => { if (el && !el.hidden) document.documentElement.style.setProperty("--hf-h", `${Math.ceil(el.getBoundingClientRect().height)}px`); fitMore(); });
      ro.observe(el);
    }
  }
  // Type / More: the ear pauses while the Agent panel is over the bar, and listens again when it closes. In capture
  // (Log visit's box) Type stays on the drive screen: nothing opens over the bar.
  function panel(fn) {
    if (cap) return fn();
    const was = document.documentElement.classList.contains("agent-open");
    fn();
    if (was || !document.documentElement.classList.contains("agent-open") || away) return;
    pause();
    away = new MutationObserver(() => {
      if (document.documentElement.classList.contains("agent-open")) return;
      away?.disconnect();
      away = null;
      resume();
    });
    away.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  }
  // the mic: listening → off (or, once words are coming in, done talking: they go now); working or speaking → stop
  // and listen; off → on
  function tapBig() {
    if (phase === "listen" || phase === "reading") return live || phase === "reading" ? stopRec?.() : mute({ byRep: true });
    if (phase === "think" || phase === "speak" || phase === "paused") { hush(); held = 0; run += 1; return listenNow(run); }
    return listenAgain();
  }
  function set(p) { phase = p; draw(); onPhase(p); }
  // the rep's tap: the last failure is forgotten (voice.js retryVoiceIn) and it listens again; drive mode may turn
  // Voice on first (onListen) or refuse (an offline page)
  function listenAgain() {
    if (onListen() === false) return;
    retryVoiceIn();
    held = 0; note = ""; run += 1; listenNow(run);
  }

  function listenNow(r, { follow = false } = {}) {
    if (r !== run) return;
    hush();
    words = follow ? words : "";
    live = false;
    set("listen");
    const t0 = Date.now();
    stopRec = hear({
      wait: true,
      onLive: (t) => { if (r === run && !/^Listening…/.test(t)) (words = t), (live = true), draw(); },
      onPhase: (ph) => { if (r === run) set(ph === "reading" ? "reading" : "listen"); },
      onText: (t) => { if (r === run) heard(r, t); },
      // nothing said (a quiet gap): listen on; the microphone blocked, none, or no voice here: say why and wait for a tap
      onFail: (msg, { dead = false } = {}) => {
        if (r !== run) return;
        stopRec = null;
        // (a "nothing" back at once would spin: a listen that ended within a second waits a moment first)
        if (msg === MSG.missed && !dead) return Date.now() - t0 < 1000 ? void setTimeout(() => listenNow(r, { follow: true }), 1500) : listenNow(r, { follow: true });
        note = msg;
        set("off");
      },
    });
  }
  // the words: to whoever has the ear (Log visit, a note), else a turn with the Agent
  function heard(r, t) {
    stopRec = null;
    if (!cap) return ask(r, t);
    words = t;
    note = "";
    set("think");
    // the capture answers (a read-back, which pauses the ear) or doesn't: then it listens on
    Promise.resolve().then(() => cap?.onText(t)).catch(() => {}).finally(() => { if (r === run && phase === "think") listenNow(r); });
  }
  async function ask(r, t) {
    words = t;
    answer = "";
    note = "";
    set("think");
    // the acknowledgement: said at once (its clip), and shown while the model works
    const a = await ack(t);
    if (r !== run) return;
    note = a.text;
    draw();
    let reply = null;
    try {
      reply = (await sendAgent(t, { quiet: true }))?.reply ?? null;
    } catch {}
    if (r !== run) return;
    note = "";
    if (!reply) { note = HF_NO_ANSWER; set("speak"); return listenNow(r, { follow: true }); }
    answer = reply;
    set("speak");
    for (const part of sayParts(reply)) {
      if (r !== run || phase !== "speak") return;
      const ok = await sayAgent(part, { onFail: (m) => { note = m; draw(); } });
      if (!ok) break; // no voice out: the answer stays on screen, and it still listens for a follow-up
      if (voiceUsed() === "browser" && note !== HF_PHONE_VOICE) { note = HF_PHONE_VOICE; draw(); }
      while (r === run && phase === "speak" && speaking()) await new Promise((ok2) => setTimeout(ok2, POLL_MS));
    }
    if (r === run && phase === "speak") listenNow(r, { follow: true });
  }

  // drive mode opened: the bar shows and the Agent listens at once. reason: it can't listen (no microphone here, the
  // microphone failed…): "Mic off" with the reason, waiting for a tap. muted: Voice is off: "Mic off", no reason needed.
  function start(id = null, { reason = null, muted = false } = {}) {
    if (id) setAgentDoor(id);
    if (!el) build();
    run += 1;
    held = 0;
    stopRec?.();
    stopRec = null;
    words = answer = "";
    note = muted ? "" : reason ?? "";
    el.hidden = false;
    document.documentElement.classList.add("hf-open");
    if (muted) return set("muted");
    if (reason) return set("off");
    retryVoiceIn();
    listenNow(run);
  }
  // Log visit or a note takes the ear: whatever the Agent was saying or working on stops at once, and it listens for
  // them (a bar that is off stays off, saying so: the rep turns it on with the mic)
  function capture(c) {
    cap = c;
    if (!el || el.hidden) return;
    answer = "";
    if (phase === "muted" || phase === "off") return draw();
    run += 1;
    held = 0;
    stopRec?.();
    stopRec = null;
    hush();
    listenNow(run);
  }
  // … and gives it back: the Agent has the ear again (a listen under way carries on)
  function release() {
    if (!cap) return;
    cap = null;
    draw();
  }
  // the ear closes without the bar: a read-aloud, or the Agent panel over it
  function pause() {
    held += 1;
    if (held > 1) return;
    wasOn = phase === "listen" || phase === "reading" || phase === "think" || phase === "speak";
    run += 1;
    stopRec?.();
    stopRec = null;
    if (phase !== "muted" && phase !== "off") set("paused");
  }
  function resume() {
    if (held <= 0) return;
    held -= 1;
    if (held > 0 || !el || el.hidden) return;
    if (wasOn && phase === "paused") { run += 1; listenNow(run); }
    else if (phase === "paused") set("muted");
  }
  function mute({ byRep = false } = {}) {
    run += 1;
    held = 0;
    stopRec?.();
    stopRec = null;
    hush();
    words = "";
    set("muted");
    if (byRep) onMute();
  }
  // drive mode closing: the bar goes
  function stop() {
    run += 1;
    held = 0;
    cap = null;
    stopRec?.();
    stopRec = null;
    hush();
    phase = "muted";
    away?.disconnect();
    away = null;
    if (el) el.hidden = true;
    document.documentElement.classList.remove("hf-open");
  }
  const dbg = setInterval(() => { if (el && !el.hidden) drawDebug(); }, 1000);
  return { start, stop, mute, pause, resume, capture, release, active: () => Boolean(el && !el.hidden), phase: () => phase, capturing: () => Boolean(cap), destroy: () => { stop(); clearInterval(dbg); ro?.disconnect(); el?.remove(); el = null; document.documentElement.style.removeProperty("--hf-h"); } };
}
