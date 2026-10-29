// The hands-free Doors Agent in Start my day. Group 3 #8 (Jard 10-24): one tap, no chat box. Jard 10-28: "I wanted
// the agent to be always hands free in driving mode": from the moment drive mode opens (Voice on, a microphone), the
// Agent listens by itself, in a bar docked at the bottom of the drive screen (the door, Navigate and Log visit stay in
// use above it); it keeps listening after a quiet gap, listens again after each answer, and only Mute (or Voice off)
// stops it. When the rep's words are in, a short canned line says the Agent got them at once (lib/ack.js, a baked
// Aura-2 clip, ui/voice.js ack) while the model works; the answer is read aloud in the Aura-2 voice (ui/voice.js say,
// never the phone's own voice while the Worker can speak) through the one tap-unlocked <audio>. The ear is
// voice.js listen({wait}): the page's own recording, nothing sent until there's speech. Another mic on the screen (Log
// visit, a note) or a read-aloud pauses it (pause / resume), so it never hears Doors itself. The turn is the chat
// panel's own (ui/agent.js sendAgent, quiet), so it is in the chat history and its changes are applied and undoable there.
// r8hf (Jard 10-28, Brave on iPhone opened the chat box instead): the Agent NEVER falls back to typing without a word.
// start(id, {reason}) shows the bar "Not listening" with the reason (Voice off, no microphone API, the microphone
// blocked or busy, the Worker's ear off, a quiet AudioContext…), a Try again (the circle, or Listen) and Type instead;
// the chat box opens only from Type instead. ?voicedebug=1 (or localStorage doors:voicedebug) adds a line with what
// this browser has (voice.js voiceStatus), so a screenshot from a phone says what happened.
import { esc } from "./dom.js";
import { listen as hear, sayAgent, ack, hush, speaking, sayParts, voiceUsed, retryVoiceIn, voiceStatus, MSG } from "./voice.js";
import { sendAgent, setAgentDoor } from "./agent.js";

export const HF = {
  listen: { head: "Listening", hint: "Ask about your next stop, or say how a visit went." },
  reading: { head: "Listening", hint: "Getting your words…" },
  think: { head: "Working", hint: "" }, // the hint is the acknowledgement line
  speak: { head: "Speaking", hint: "Tap to stop it and ask something else." },
  paused: { head: "Paused", hint: "Listening again when that's done." },
  muted: { head: "Muted", hint: "Tap to listen again." },
  off: { head: "Not listening", hint: "" }, // the hint is why (voice.js MSG, or the reason start() was given)
};
export const HF_TRY = "Tap to try again, or type instead."; // the circle's label in "off" (the buttons say it on screen)
export const HF_VOICE_OFF = "Voice is off. Tap Listen to turn it on, or type instead.";
export const HF_QUIET = "Nothing was said.";
export const HF_NO_ANSWER = "Doors Agent didn't answer. Say it again, or type it.";
export const HF_PHONE_VOICE = "The Doors voice isn't available right now: this is the browser's own voice.";
const POLL_MS = 200;

// mountHandsFree({onType, onListen}) → {start(doorId, {reason}), stop(), mute(), pause(), resume(), active(), phase(), destroy()}.
// onType: open the chat panel (the "Type instead" button). onListen(): the rep asked it to listen from "off" or
// "muted" (the circle, Listen) → false to refuse; drive mode turns Voice on there.
export function mountHandsFree({ onType = () => {}, onListen = () => true } = {}) {
  let el = null;
  let run = 0; // each start / stop / mute / pause: a loop from an older run ends quietly
  let phase = "muted";
  let words = "";
  let answer = "";
  let note = "";
  let stopRec = null;
  let held = 0; // pause() calls outstanding (a mic and a read-aloud can overlap)
  let wasOn = false; // listening (or working) when pause() came: resume() listens again

  function draw() {
    if (!el) return;
    const p = HF[phase] ?? HF.muted;
    el.dataset.phase = phase;
    el.querySelector("[data-hf-head]").textContent = p.head;
    // speaking: the hint makes room for the answer (the big button says Speaking; its label carries the hint)
    // off: the reason is the (amber) status line and gets the room; the buttons (Listen, Type instead) say what to do
    el.querySelector("[data-hf-hint]").textContent = phase === "think" ? note || p.hint : phase === "off" || phase === "speak" ? "" : p.hint;
    el.querySelector("[data-hf-big]").setAttribute("aria-label", `Doors Agent: ${p.head}. ${phase === "off" ? HF_TRY : p.hint}`);
    el.querySelector("[data-hf-big]").setAttribute("aria-pressed", String(phase === "listen" || phase === "reading"));
    el.querySelector("[data-hf-words]").innerHTML = words ? `<span>You said</span> ${esc(words)}` : "";
    el.querySelector("[data-hf-answer]").textContent = answer;
    const n = el.querySelector("[data-hf-note]");
    n.textContent = phase === "think" ? "" : note;
    n.hidden = !n.textContent;
    const m = el.querySelector("[data-hf-mute]");
    m.textContent = phase === "muted" || phase === "off" ? "Listen" : "Mute";
    m.setAttribute("aria-pressed", String(phase === "muted" || phase === "off"));
    drawDebug();
  }
  // ?voicedebug=1: what this browser has, one line, refreshed while the bar is up
  const debugOn = () => { try { return /[?&]voicedebug=1/.test(location.search + location.hash) || localStorage.getItem("doors:voicedebug") === "1"; } catch { return false; } };
  function drawDebug() {
    const d = el?.querySelector("[data-hf-debug]");
    if (!d) return;
    if (!debugOn()) { d.hidden = true; return; }
    document.documentElement.style.setProperty("--hf-h", "260px"); // room for the line
    const v = voiceStatus();
    d.textContent = `voice: phase ${phase} · secure ${v.secure} · rec ${v.rec} · gum ${v.gum} · ac ${v.ac} ctx ${v.ctx} · session ${v.session} · online ${v.online}${v.demo ? " · demo" : ""} · in ${v.in} out ${v.out} server ${v.server} · unlocked ${v.unlocked}${v.fail ? ` · last fail ${v.fail}` : ""} · ${v.ua}`;
    d.hidden = false;
  }
  function build() {
    el = document.createElement("section");
    el.className = "hf";
    el.setAttribute("role", "region");
    el.setAttribute("aria-label", "Doors Agent, hands-free");
    el.innerHTML = `
      <div class="hf-in">
        <button type="button" class="hf-big" data-hf-big aria-pressed="false"><span class="hf-dot" aria-hidden="true"></span><b data-hf-head></b></button>
        <div class="hf-text">
          <p class="hf-hint" data-hf-hint aria-live="polite"></p>
          <p class="hf-words" data-hf-words></p>
          <p class="hf-answer" data-hf-answer aria-live="polite"></p>
          <p class="hf-note" data-hf-note role="status" hidden></p>
          <p class="hf-debug" data-hf-debug hidden></p>
        </div>
        <div class="hf-row"><button type="button" class="hf-btn" data-hf-mute aria-pressed="false">Mute</button><button type="button" class="hf-btn" data-hf-type>Type instead</button></div>
      </div>`;
    el.addEventListener("click", (e) => {
      if (e.target.closest("[data-hf-mute]")) return phase === "muted" || phase === "off" ? listenAgain() : mute();
      if (e.target.closest("[data-hf-type]")) { mute(); return onType(); }
      if (e.target.closest("[data-hf-big]")) return tapBig();
    });
    document.body.append(el);
  }
  // the big button: listening → done talking (what was said goes now); speaking → stop it and listen; muted, paused or
  // off → listen again
  function tapBig() {
    if (phase === "listen") return stopRec?.();
    if (phase === "speak") { hush(); return listenNow(run); }
    if (phase === "muted" || phase === "off" || phase === "paused") return listenAgain();
  }
  function set(p) { phase = p; draw(); }
  // the rep's tap: the last failure is forgotten (voice.js retryVoiceIn) and it listens again; drive mode may turn
  // Voice on first (onListen) or refuse (the guided demo)
  function listenAgain() {
    if (onListen() === false) return;
    retryVoiceIn();
    held = 0; note = ""; run += 1; listenNow(run);
  }

  function listenNow(r, { follow = false } = {}) {
    if (r !== run) return;
    hush();
    words = follow ? words : "";
    set("listen");
    const t0 = Date.now();
    stopRec = hear({
      wait: true,
      onLive: (t) => { if (r === run && !/^Listening…/.test(t)) (words = t), draw(); },
      onPhase: (ph) => { if (r === run) set(ph === "reading" ? "reading" : "listen"); },
      onText: (t) => { if (r === run) ask(r, t); },
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
  async function ask(r, t) {
    stopRec = null;
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

  // drive mode opened (Voice on, a microphone): the bar shows and the Agent listens at once. reason: it can't listen
  // (Voice off, no microphone here, the demo…): the bar shows "Not listening" with the reason and waits for a tap
  function start(id = null, { reason = null } = {}) {
    if (id) setAgentDoor(id);
    if (!el) build();
    run += 1;
    held = 0;
    stopRec?.();
    stopRec = null;
    words = answer = "";
    note = reason ?? "";
    el.hidden = false;
    document.documentElement.classList.add("hf-open");
    if (reason) return set("off");
    retryVoiceIn();
    listenNow(run);
  }
  // the ear closes without the bar: another mic on the screen, or a read-aloud, is on
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
  }
  function mute() {
    run += 1;
    held = 0;
    stopRec?.();
    stopRec = null;
    hush();
    set("muted");
  }
  // Voice off, or drive mode closing: the bar goes
  function stop() {
    run += 1;
    held = 0;
    stopRec?.();
    stopRec = null;
    hush();
    phase = "muted";
    if (el) el.hidden = true;
    document.documentElement.classList.remove("hf-open");
  }
  const dbg = setInterval(() => { if (el && !el.hidden) drawDebug(); }, 1000);
  return { start, stop, mute, pause, resume, active: () => Boolean(el && !el.hidden), phase: () => phase, destroy: () => { stop(); clearInterval(dbg); el?.remove(); el = null; } };
}
