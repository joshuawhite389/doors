// Drive mode's voice in any browser. OUT: the Worker's Aura-2 voice first (src/voice.js /api/voice/say, the one Doors
// voice on the web and the phone; Jard 10-28: never the phone's own robot voice while the Worker can speak), the
// browser's own speechSynthesis only when the Worker can't (off, resting, offline); everything plays through ONE <audio>
// element that a tap in drive mode unlocks (unlockAudio: iPhone Safari lets a media element it once played on a tap play
// again on its own later, which the hands-free loop needs, and an <audio> plays with the ringer switch on silent, which
// speechSynthesis and Web Audio don't) with navigator.audioSession set to playback where the browser has it (iOS 17+).
// ack(text): the Agent's instant acknowledgement (lib/ack.js), a baked Aura-2 clip under /audio/ack/, played the moment
// the rep's words are in. IN: the browser's recognizer first, the Worker's Whisper when it fails; listen({wait}) is the
// hands-free loop's ear: the page's own recording with no "nothing said" cut-off (nothing is sent until the rep speaks),
// the browser's recognizer when the Worker can't hear. What failed is remembered for the page's life.
//   Brave exposes webkitSpeechRecognition but its speech service is off: error "network" at once → the Worker.
//   Firefox has no SpeechRecognition → the Worker. Chromium on Linux often has speechSynthesis with no voices (no
//   speech-dispatcher): speak() then does nothing and says nothing → no voices, or no start within SAY_START_MS → the Worker.
//   iPhone browsers (Safari, Chrome, Brave, Firefox: all WebKit): no SpeechRecognition outside Safari → the page records
//   and the Worker listens. r8hf (Jard 10-28): a failure is REMEMBERED, never a one-way latch: canListen() stays true
//   while the browser has the APIs, whyCantListen() names what is missing, lastMicFail() names what went wrong last, and
//   every failure reaches the screen (ui/handsfree.js) with a Try again. voiceStatus() is the ?voicedebug=1 line.
// listen({onLive, onPhase, onText, onFail, wait}) → stop(); say(text, {onFail, serverFirst}) → Promise<boolean>;
// sayAgent(text, {onFail}) = say; ack(text) → Promise<{id, text, intent, played}>; hush(); speaking(); canListen(); canSay();
// voiceUsed() → "aura" | "melotts" | "browser" | null (the last say); unlockAudio() inside a tap (it also primes the
// microphone's AudioContext: iPhone WebKit starts one only inside a tap).
import { pickAck, ackPath } from "../lib/ack.js";
const SERVER_ERRORS = new Set(["network", "service-not-allowed", "language-not-supported"]); // the browser's service, not the rep
export const MAX_REC_MS = 20000; // a "how it went" is a sentence or two
export const SILENCE_MS = 1600; // after speech, this much quiet ends the recording (hands-free, as the browser's does)
export const NO_SPEECH_MS = 8000; // nothing said by then: stop
export const SPEECH_RMS = 0.02; // a frame louder than this is speech
export const SAY_START_MS = 2500; // the browser's voice must start by then
export const RATE = 16000; // what the Worker gets: 16 kHz mono 16-bit WAV (25 s fits its cap)
export const MSG = {
  blocked: "The microphone is blocked: allow it from the address bar, or tap an answer or type it.",
  blockedBar: "The microphone is blocked for this site. Allow it in the browser's site settings (or the phone's settings for this browser), then tap the mic.",
  nomic: "No microphone found: tap an answer or type it.",
  missed: "Didn't catch that: try again, tap an answer, or type it.",
  inOff: "Voice isn't available in this browser right now: tap an answer or type it.",
  outOff: "Read-aloud isn't available in this browser right now: it's all on screen.",
  offline: "Voice needs a connection: tap an answer or type it.",
  // r8hf: the hands-free bar's reasons (why it isn't listening), plain and specific
  insecure: "Voice needs a secure (https) address: this one isn't.",
  noapi: "This browser can't record from the microphone (no getUserMedia).",
  noaudio: "This browser can't process microphone audio (no AudioContext).",
  serverOff: "The Doors voice is off on this server, and this browser has no speech recognizer of its own.",
  unreachable: "Couldn't reach the Doors voice. Check the connection and try again.",
  micBusy: "The microphone is in use by another app or tab. Close it and try again.",
  micFailed: "The microphone didn't start",
  audioStuck: "The browser paused audio: tap to start the microphone.",
};

let inMode = null; // null (not tried) | "browser" | "server" | "none" (no way in at all: this browser has neither API; never set by a failure)
let outMode = null;
let serverIn = null; // the Worker's Whisper: null (not tried) | true | false (off on this server: the hands-free ear uses the browser's)
let offline = false; // a page that makes no calls (setDriveOffline): no Worker voice; the guided demo has it (Jard 10-29)
// r8hf: what went wrong last with the microphone or the Worker's ear: {msg, name, at} (kept, shown, cleared by retryVoiceIn)
let micFail = null;
let micCtx = null; // the one AudioContext the recordings share: made (or resumed) inside a tap by unlockAudio, so iPhone WebKit runs it
export const setVoiceOffline = (v) => { offline = !!v; };
export const _resetVoice = () => { inMode = outMode = serverIn = null; offline = false; micFail = null; micCtx = null; said.clear(); used = null; lastAck = null; player = null; playing = null; unlocked = false; };
export const voiceModes = () => ({ in: inMode, out: outMode }); // for the CDP check

const W = () => (typeof window !== "undefined" ? window : {});
const Rec = () => W().SpeechRecognition ?? W().webkitSpeechRecognition ?? null;
const AC = () => W().AudioContext ?? W().webkitAudioContext ?? null;
const canRecord = () => typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && !!AC();
const net = () => !offline && (typeof navigator === "undefined" || navigator.onLine !== false);
// a way in exists: the browser's recognizer, or the page can record for the Worker (offline: only the
// browser's own). A past failure never takes this away (r8hf): the bar says what failed and offers Try again.
export const canListen = () => inMode !== "server" && !!Rec() ? true : canRecord() && net();
export const canSay = () => outMode !== "none";
// why canListen() is false, in the rep's words (null when it is true): the hands-free bar shows this instead of
// falling back to the chat box without a word (Jard 10-28)
export function whyCantListen() {
  if (canListen()) return null;
  if (!net()) return MSG.offline;
  if (typeof window !== "undefined" && window.isSecureContext === false) return MSG.insecure;
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return MSG.noapi;
  if (!AC()) return MSG.noaudio;
  return MSG.inOff;
}
export const lastMicFail = () => micFail;
export const noteMicFail = (msg, name = null) => { micFail = { msg, name, at: Date.now() }; }; // kept for the debug line and the bar
// Try again (the bar's circle, Listen): the last failure is forgotten and the Worker's ear is tried once more
export function retryVoiceIn() { micFail = null; if (serverIn === false) serverIn = null; if (inMode === "server") inMode = null; try { micCtx?.resume?.(); } catch {} }
// the ?voicedebug=1 line: what this browser has, in one object (ui/handsfree.js draws it)
export function voiceStatus() {
  const n = typeof navigator !== "undefined" ? navigator : {};
  let ctx = micCtx ? micCtx.state : "-";
  return {
    secure: typeof window !== "undefined" ? window.isSecureContext : null,
    rec: !!Rec(),
    gum: !!n.mediaDevices?.getUserMedia,
    ac: !!AC(),
    ctx,
    session: n.audioSession ? `${n.audioSession.type}/${n.audioSession.state}` : "-",
    online: n.onLine !== false,
    demo: offline,
    in: inMode,
    out: outMode,
    server: serverIn,
    unlocked,
    fail: micFail ? `${micFail.name ? micFail.name + ": " : ""}${micFail.msg}` : null,
    ua: (n.userAgent ?? "").replace(/^Mozilla\/5\.0 /, "").slice(0, 120),
  };
}
// a mic button's words, the phone's (app-mobile MicButton micLabel): idle, listening with the seconds, then the Worker
export const micLabel = (phase, secs, idle) => (phase === "listen" ? `Listening… tap when done${secs ? ` (${secs} s)` : ""}` : phase === "reading" ? "Getting your words…" : idle);

// ---------- voice in ----------
// The browser's recognizer first. On the first try a shadow recording runs beside it (not on iPhone/iPad, where Safari's
// recognizer and a second capture fight): Chromium on Linux has no speech service and says "no-speech" even to real
// speech (checked 10-23 with the video's narration as the fake mic), so when the browser hears nothing while the shadow
// heard speech, the shadow's audio goes to the Worker and nothing the rep said is lost. Brave's "network" at once hands
// over to the shadow already running. Once the browser has understood the rep, no shadow.
// wait (the hands-free ear, ui/handsfree.js): the page's own recording, open until the rep speaks (no NO_SPEECH_MS
// cut-off: a rolling 2 s is kept while it waits, nothing is sent until there's speech), then to the Worker's Whisper;
// the browser's recognizer only when the Worker can't hear (serverIn false) or the page can't record. No shadow, and
// inMode is left alone: Log visit and the note mic keep their own order.
export function listen({ onLive = () => {}, onPhase = () => {}, onText = () => {}, onFail = () => {}, wait = false } = {}) {
  let over = false;
  let mic = null; // our own recording: {stop, spoke(), audio: Promise<WAV | null>}
  const done = (fn, ...a) => { if (!over) (over = true), mic?.stop(), fn(...a); };
  let words = false; // the browser has shown words: its live line wins
  let micDead = null; // the recording's failure, kept until it matters
  const startMic = () => {
    mic ??= record({ onLive: (t) => { if (!words) onLive(t); }, onError: (e) => { micDead = e; }, wait });
    return mic;
  };
  // the recording failed: say which way (dead: the hands-free ear waits for a tap instead of trying again at once).
  // r8hf: nothing is latched; the failure is kept (lastMicFail) and shown, and Try again tries again.
  const failMic = (e) => {
    const name = e?.name ?? "";
    const msg = name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError" ? (wait ? MSG.blockedBar : MSG.blocked)
      : name === "NotFoundError" || name === "DevicesNotFoundError" || name === "OverconstrainedError" ? MSG.nomic
      : name === "NotReadableError" || name === "AbortError" || name === "TrackStartError" ? MSG.micBusy
      : name === "AudioSuspended" ? MSG.audioStuck
      : `${MSG.micFailed}${name ? ` (${name})` : ""}: tap to try again, or type it.`;
    noteMicFail(msg, name || null);
    done(onFail, msg, { dead: true });
  };
  // the recording → the Worker → the words
  const viaServer = async () => {
    if (!canRecord()) { const m = whyCantListen() ?? MSG.inOff; noteMicFail(m); return done(onFail, m, { dead: true }); }
    if (!net()) return done(onFail, MSG.offline, { dead: false });
    onPhase("listen");
    const wav = await startMic().audio;
    if (over) return;
    if (micDead) return failMic(micDead);
    if (!wav) return done(onFail, MSG.missed, { dead: false });
    onPhase("reading");
    const r = await transcribe(wav);
    if (over) return;
    if (r.text != null) { serverIn = true; micFail = null; if (r.text.trim() && !wait) inMode = "server"; return r.text.trim() ? done(onText, r.text.trim()) : done(onFail, MSG.missed, { dead: false }); }
    if (r.busy) return done(onFail, r.error, { dead: false });
    if (r.unreachable) { noteMicFail(MSG.unreachable, "fetch"); return done(onFail, MSG.unreachable, { dead: true }); } // the network, not this browser: try again later
    if (Rec()) { serverIn = false; if (!wait) inMode = null; return done(onFail, MSG.missed, { dead: false }); } // the next listen is the browser's recognizer
    noteMicFail(MSG.serverOff, `http ${r.status ?? "?"}`);
    done(onFail, MSG.serverOff, { dead: true });
  };
  const R = Rec();
  if (inMode === "server" || !R || (wait && serverIn !== false && canRecord() && net())) {
    viaServer();
    return () => mic?.stop();
  }
  const shadow = !wait && inMode === null && canRecord() && net() && !/iPhone|iPad|iPod/.test(navigator.userAgent ?? "");
  let rec;
  try {
    rec = new R();
    rec.lang = navigator.language || "en-US";
    rec.interimResults = true;
    rec.continuous = false;
  } catch {
    viaServer();
    return () => mic?.stop();
  }
  let final = "";
  let live = "";
  let switched = false;
  let sound = false; // the browser said it hears sound (a deaf one, Chromium on Linux, never does)
  const handOver = () => { if (!switched) (switched = true), viaServer(); };
  if (shadow) {
    // the shadow caught a whole sentence and the browser heard no sound at all: don't wait for its "no-speech" (8 s)
    startMic().audio.then((wav) => { if (wav && !sound && !words && !over && !switched) { try { rec.abort(); } catch {} handOver(); } });
  }
  rec.onsoundstart = () => { sound = true; };
  rec.onresult = (e) => {
    live = "";
    for (let i = e.resultIndex; i < e.results.length; i++) {
      if (e.results[i].isFinal) final += e.results[i][0].transcript;
      else live += e.results[i][0].transcript;
    }
    words = true;
    onLive(`${final}${live}`);
  };
  rec.onerror = (e) => {
    if (SERVER_ERRORS.has(e.error) && !final) return handOver(); // the browser's service is out
    if (e.error === "not-allowed") return done(onFail, MSG.blocked, { dead: false });
    if (e.error === "audio-capture") { noteMicFail(MSG.nomic, "audio-capture"); return done(onFail, MSG.nomic, { dead: true }); }
  };
  rec.onend = async () => {
    if (switched || over) return;
    const said = (final || live).trim();
    if (said) { inMode = "browser"; return done(onText, said); }
    // heard nothing: was there speech? (the shadow decides; it may still be finishing the rep's sentence)
    if (shadow && mic) {
      if (mic.spoke()) return handOver();
      const wav = await mic.audio;
      if (!over && wav) return handOver();
    }
    done(onFail, MSG.missed, { dead: false });
  };
  onPhase("listen");
  try { rec.start(); } catch { handOver(); }
  return () => { try { rec.stop(); } catch {} mic?.stop(); }; // a tap ends both: what the shadow holds is kept for the Worker
}

// The microphone as PCM until the rep taps, goes quiet after speaking, or MAX_REC_MS. → {stop(), spoke(), audio:
// Promise<WAV blob | null when nothing was said>}. onLive gets "Listening…" (no words: those come back from the Worker).
function record({ onLive, onError, wait = false }) {
  let want = false; // the rep (or the caller) asked it to stop
  let close = null; // set once the microphone is open
  let spoke = false;
  let settle;
  const audio = new Promise((r) => (settle = r));
  // iOS 17+: an audio session typed "playback" (unlockAudio sets it for the voice) is for playing only; while the
  // microphone is open the browser picks the category itself (auto), and the voice's "playback" comes back after
  const session = typeof navigator !== "undefined" ? navigator.audioSession : null;
  const sessionWas = session?.type ?? null;
  try { if (session && sessionWas === "playback") session.type = "auto"; } catch {}
  const restoreSession = () => { try { if (session && sessionWas === "playback") session.type = "playback"; } catch {} };
  navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } }).then((stream) => {
    // the shared AudioContext (made in a tap by unlockAudio when there was one; else now: an open microphone lets
    // WebKit start one without a tap). Not closed after: iPhone WebKit starts a new one only inside a tap.
    let ctx = micCtx;
    try { if (!ctx || ctx.state === "closed") ctx = micCtx = new (AC())(); } catch (e) { stream.getTracks().forEach((tr) => tr.stop()); restoreSession(); onError(Object.assign(new Error("AudioContext"), { name: e?.name || "AudioContextError" })); return settle(null); }
    try { ctx.resume?.()?.catch?.(() => {}); } catch {}
    const src = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    const mute = ctx.createGain();
    mute.gain.value = 0;
    const chunks = [];
    const t0 = Date.now();
    let heard = 0; // the last time speech was heard
    let t0s = 0; // when speech began (MAX_REC_MS counts from there while the ear waits)
    let closed = false;
    close = () => {
      if (closed) return;
      closed = true;
      try { proc.disconnect(); src.disconnect(); mute.disconnect(); } catch {}
      stream.getTracks().forEach((tr) => tr.stop());
      clearTimeout(stuck);
      restoreSession();
      settle(spoke ? toWav(chunks, ctx.sampleRate) : null);
    };
    // no audio frames within 2.5 s (the context never ran: iPhone WebKit outside a tap): a failure the bar can show,
    // and the next tap resumes the context (unlockAudio)
    let frames = 0;
    const stuck = setTimeout(() => { if (!closed && !frames) { onError(Object.assign(new Error("no audio frames"), { name: "AudioSuspended" })); close(); } }, 2500);
    proc.onaudioprocess = (e) => {
      if (closed) return;
      frames += 1;
      const x = e.inputBuffer.getChannelData(0);
      chunks.push(new Float32Array(x));
      let s = 0;
      for (let i = 0; i < x.length; i++) s += x[i] * x[i];
      const rms = Math.sqrt(s / x.length);
      const t = Date.now() - t0;
      // speech: over a fixed level (echo cancelling and noise suppression are on). Not "3× the first 0.3 s": a rep who
      // starts talking at once set that floor to their own voice and was never heard. A loud cab never goes quiet:
      // the tap or MAX_REC_MS ends it then.
      if (rms > SPEECH_RMS) { if (!spoke) t0s = t; (heard = t), (spoke = true), onLive("Listening… tap when done"); }
      // waiting (the hands-free ear): nothing said yet → keep the last 2 s only, and wait on
      if (wait && !spoke) { while (chunks.length > Math.ceil((2 * ctx.sampleRate) / 4096)) chunks.shift(); return; }
      if (t - t0s > MAX_REC_MS || (spoke && t - heard > SILENCE_MS) || (!spoke && t > NO_SPEECH_MS)) close();
    };
    src.connect(proc);
    proc.connect(mute);
    mute.connect(ctx.destination);
    if (want) close();
  }, (e) => { restoreSession(); onError(e); settle(null); });
  return { stop: () => { want = true; close?.(); }, spoke: () => spoke, audio };
}

// Float32 chunks at `rate` → a 16 kHz mono 16-bit PCM WAV blob (averaged down; speech needs no more)
export function toWav(chunks, rate) {
  const n = chunks.reduce((m, c) => m + c.length, 0);
  const step = rate / RATE;
  const out = Math.floor(n / step);
  const buf = new ArrayBuffer(44 + out * 2);
  const v = new DataView(buf);
  const str = (o, s) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
  str(0, "RIFF"); v.setUint32(4, 36 + out * 2, true); str(8, "WAVE"); str(12, "fmt ");
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, RATE, true);
  v.setUint32(28, RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, "data"); v.setUint32(40, out * 2, true);
  const flat = new Float32Array(n);
  let o = 0;
  for (const c of chunks) flat.set(c, o), (o += c.length);
  for (let i = 0; i < out; i++) {
    const a = Math.floor(i * step);
    const b = Math.min(n, Math.floor((i + 1) * step)) || a + 1;
    let s = 0;
    for (let j = a; j < b; j++) s += flat[j];
    const x = Math.max(-1, Math.min(1, s / Math.max(1, b - a)));
    v.setInt16(44 + i * 2, x < 0 ? x * 0x8000 : x * 0x7fff, true);
  }
  return new Blob([buf], { type: "audio/wav" });
}

// → {text} | {busy, error} (try again later) | {status} (no voice from the Worker: off, or an error there) |
// {unreachable} (the network: nothing came back)
async function transcribe(wav) {
  try {
    const r = await fetch("/api/voice/listen", { method: "POST", headers: { "content-type": "audio/wav" }, body: wav, signal: AbortSignal.timeout?.(25000) });
    const b = await r.json().catch(() => ({}));
    if (r.ok && typeof b.text === "string") return { text: b.text };
    if (r.status === 429 || r.status === 413) return { busy: true, error: b.error ?? MSG.missed };
    return { status: r.status };
  } catch {
    return { unreachable: true };
  }
}

// ---------- voice out ----------
// ONE <audio> element for the Worker's voice and the ack clips. iPhone Safari: a media element that a tap once played
// may play again later on its own (a new Audio() with no tap in reach is refused → the browser's voice spoke instead,
// Jard 10-28: "the default phone robot voice"); unlockAudio() inside a tap plays a short silence on it. An <audio>
// also plays with the ringer switch on silent, where speechSynthesis stays quiet.
const SILENT = "data:audio/mpeg;base64,SUQzBAAAAAAAIlRTU0UAAAAOAAADTGF2ZjYzLjEuMTAxAAAAAAAAAAAAAAD/4zjAAAAAAAAAAAAASW5mbwAAAA8AAAADAAABsACqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqrV1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dXV1dX///////////////////////////////////////////8AAAAATGF2YzYzLjEuAAAAAAAAAAAAAAAAJALwAAAAAAAAAbCaZ7gQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD/4xjEAAAAA0gAAAAATEFNRTQuMFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/4xjEOwAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/4xjEdgAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVU="; // 50 ms of silence, an MP3 (a data-URI WAV is refused by Chromium)
let player = null;
let playing = null; // what the element is on: "say" | "ack" | null
let unlocked = false;
let used = null; // the last say's voice: "aura" | "melotts" | "browser" | null
let lastAck = null; // the ack line said last (never twice in a row)
const said = new Map(); // text → object URL of the Worker's MP3 ("Say it again" costs nothing)
export const sayable = (t) => String(t ?? "").replace(/\bN\/A\b/gi, "N.A.").replace(/[✓↻“”"•]/g, "").replace(/\s·\s/g, ", ").replace(/\s+/g, " ").trim().slice(0, 600);
export const voiceUsed = () => used;
export const audioUnlocked = () => unlocked;

function getPlayer() {
  if (!player && typeof Audio === "function") {
    player = new Audio();
    player.preload = "auto";
    try { player.setAttribute("playsinline", ""); } catch {}
    // a clip that played to its end lets go of the element at once (release), so no Now Playing card stays behind;
    // a newer clip already on the element (ended is false again) is left alone
    try { player.addEventListener("ended", () => { if (player.ended) { release(); playing = null; } }); } catch {}
  }
  return player;
}
// Jard 10-29: after Doors spoke, the iPhone's lock screen and Control Center showed a "Your plan · Doors" Now Playing
// card (the page title and icon, play / skip 10 s) like music, and it stayed. iPhone WebKit registers any media element
// that played as the page's media session and keeps it after the clip ends; Android Chrome posts a media notification
// for a long one. A spoken line is not music: when a clip ends or is stopped, the element drops its source (pause,
// no src, load()), which ends the page's media session (iOS hands Now Playing back to whatever played before), and
// navigator.mediaSession is cleared (no title, state none, no handlers). The element itself stays, and stays unlocked:
// WebKit lifts the tap rule for the element, not for one source, and every clip already swapped the src.
const MEDIA_ACTIONS = ["play", "pause", "stop", "seekbackward", "seekforward", "seekto", "previoustrack", "nexttrack"];
function clearMediaSession() {
  const ms = typeof navigator !== "undefined" ? navigator.mediaSession : null;
  if (!ms) return;
  try { ms.metadata = null; } catch {}
  try { ms.playbackState = "none"; } catch {}
  for (const a of MEDIA_ACTIONS) try { ms.setActionHandler(a, null); } catch {}
}
function release() {
  const p = player;
  if (!p) return;
  try { p.pause(); } catch {}
  try { if (p.hasAttribute("src")) { p.removeAttribute("src"); p.load(); } } catch {}
  clearMediaSession();
}
export const _player = () => player; // for the tests and the CDP check
// inside a tap (drive mode's first tap, the Agent, Read it to me): the element plays a short silence, the audio session
// is set to playback (iOS 17+: through the ringer switch), and later plays need no tap
export function unlockAudio() {
  // the microphone's AudioContext: made or resumed here, inside the tap (iPhone WebKit: an AudioContext made outside a
  // tap stays suspended, and ScriptProcessor then never hears a frame)
  try { const A = AC(); if (A && (!micCtx || micCtx.state === "closed")) micCtx = new A(); micCtx?.resume?.()?.catch?.(() => {}); } catch {}
  const p = getPlayer();
  if (!p || unlocked) return;
  try { if (navigator.audioSession && navigator.audioSession.type !== "playback") navigator.audioSession.type = "playback"; } catch {}
  try {
    if (playing) return; // a clip is on: that play was the unlock
    p.src = SILENT;
    const r = p.play();
    if (r?.then) r.then(() => { unlocked = true; }, () => {});
    else unlocked = true;
  } catch {}
}
// the element plays url → true once it is playing (or play() resolved), false when the browser refused or it errs
function playUrl(url, what) {
  const p = getPlayer();
  if (!p) return Promise.resolve(false);
  try { if (navigator.audioSession && navigator.audioSession.type !== "playback") navigator.audioSession.type = "playback"; } catch {}
  return new Promise((resolve) => {
    let settled = false;
    const end = (ok) => { if (!settled) { settled = true; p.removeEventListener("playing", onPlay); p.removeEventListener("error", onErr); if (!ok && playing === what) playing = null; resolve(ok); } };
    const onPlay = () => end(true);
    const onErr = () => end(false);
    try {
      playing = what;
      p.addEventListener("playing", onPlay);
      p.addEventListener("error", onErr);
      p.src = url;
      const r = p.play();
      if (r?.then) r.then(() => { unlocked = true; end(true); }, () => end(false));
    } catch {
      end(false);
    }
  });
}
const playerBusy = () => Boolean(player && playing && !player.paused && !player.ended);

export function hush() {
  try { if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel(); } catch {}
  // stopped mid-line (Stop, a newer line, the mic): the element lets go of it too. The tap's silence (unlockAudio) is
  // left to end on its own (50 ms; it releases itself) so a hush right after a tap can't cut the unlock short
  if (playing || (player && player.hasAttribute("src") && player.getAttribute("src") !== SILENT)) release();
  else clearMediaSession();
  playing = null;
}

// The Agent's instant acknowledgement: the line for these words (lib/ack.js), its baked clip played at once. Resolves
// when the clip has started (or couldn't), with the line to show either way. The ack is not hushed by a later say(): the
// Worker's answer waits for it to end (sayFromServer), so nothing is cut off mid-word.
export async function ack(text) {
  const a = pickAck(text, lastAck);
  lastAck = a.id;
  hush();
  const played = typeof document !== "undefined" ? await playUrl(ackPath(a.id), "ack") : false;
  return { ...a, played };
}
// while an ack clip is still playing (a 1–2 s line): wait for its end before the answer replaces it
async function ackDone() {
  for (let i = 0; i < 25 && playing === "ack" && playerBusy(); i++) await new Promise((r) => setTimeout(r, 100));
}

// The Worker's Aura-2 voice first (the one Doors voice, web and phone); the browser's own voice only when the Worker
// can't (off, resting, no connection). serverFirst=false (nothing uses it now) keeps the old order for a caller that
// wants the browser's voice. A failed server try doesn't silence later reads: the next say tries the Worker again.
export async function say(text, { onFail = () => {}, serverFirst = true } = {}) {
  const t = sayable(text);
  if (!t || (outMode === "none" && !serverFirst)) return false;
  if (serverFirst) {
    if (net() && (await sayFromServer(t))) return true;
    hush();
    if (outMode !== "server" && outMode !== "none" && (await sayInBrowser(t))) return (outMode = "browser"), (used = "browser"), true;
    // online and neither voice spoke: the read-aloud buttons go (canSay), as without serverFirst; the next read still
    // tries the Worker first
    if (net()) outMode = "none";
    used = null;
    return onFail(net() ? MSG.outOff : MSG.offline), false;
  }
  hush();
  if (outMode !== "server" && (await sayInBrowser(t))) return (outMode = "browser"), (used = "browser"), true;
  if (!net()) return onFail(MSG.offline), false;
  if (await sayFromServer(t)) return (outMode = "server"), true;
  outMode = "none";
  used = null;
  onFail(MSG.outOff);
  return false;
}

// the browser's own voice: true once it has started speaking (onstart), false when it has no voices, errs, or stays silent
function sayInBrowser(t) {
  if (typeof speechSynthesis === "undefined" || typeof SpeechSynthesisUtterance !== "function") return Promise.resolve(false);
  return new Promise((resolve) => {
    let settled = false;
    const end = (ok) => { if (!settled) (settled = true), resolve(ok); };
    let went = false;
    const go = () => {
      if (went) return;
      went = true;
      try {
        const voices = speechSynthesis.getVoices();
        if (!voices.length) return end(false);
        const u = new SpeechSynthesisUtterance(t);
        const v = voices.find((x) => x.lang?.startsWith("en") && x.localService) ?? voices.find((x) => x.lang?.startsWith("en"));
        try { if (v) u.voice = v; } catch {}
        u.lang = v?.lang ?? "en-US";
        u.onstart = () => end(true);
        u.onerror = () => end(false);
        setTimeout(() => { if (!settled) { try { speechSynthesis.cancel(); } catch {} end(false); } }, SAY_START_MS);
        speechSynthesis.speak(u);
      } catch {
        end(false); // anything odd in the browser's speech: the Worker's voice instead
      }
    };
    if (speechSynthesis.getVoices().length) return go();
    // voices load late: voiceschanged, or give up quickly (none come on a Linux box without speech-dispatcher)
    const t0 = setTimeout(go, 400);
    try { speechSynthesis.addEventListener("voiceschanged", () => { clearTimeout(t0); go(); }, { once: true }); } catch {}
  });
}

export const sayAgent = (text, opts = {}) => say(text, { ...opts, serverFirst: true });
// whether a voice is still reading out loud (the Worker's audio, an ack clip, or the browser's), so the hands-free loop
// listens again only once the answer is over, and Read it to me shows Reading… until it ends
export const speaking = () => Boolean(playerBusy() || (typeof speechSynthesis !== "undefined" && speechSynthesis.speaking));
// resolves when the voice has stopped (polled); a cap so a stuck element never holds a button forever
export async function whenQuiet(maxMs = 120000) {
  const t0 = Date.now();
  while (speaking() && Date.now() - t0 < maxMs) await new Promise((r) => setTimeout(r, 150));
}
// a long answer read in parts of whole sentences, each within the Worker's MAX_SAY (600 characters)
export function sayParts(text, n = 600) {
  const out = [];
  let cur = "";
  for (const x of String(text ?? "").replace(/\s+/g, " ").trim().match(/[^.!?]+[.!?]*["”’)]*\s*/g) ?? []) {
    if (cur && (cur + x).length > n) (out.push(cur.trim()), (cur = ""));
    cur += x.length > n ? x.slice(0, n) : x;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

async function sayFromServer(t) {
  try {
    let hit = said.get(t);
    if (!hit) {
      const r = await fetch("/api/voice/say", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: t }), signal: AbortSignal.timeout?.(20000) });
      if (!r.ok || !/^audio\//.test(r.headers.get("content-type") ?? "")) return false;
      const voice = r.headers.get("x-doors-voice");
      hit = { url: URL.createObjectURL(await r.blob()), voice: voice === "melotts" ? "melotts" : "aura" };
      if (said.size >= 20) { const [k, u] = said.entries().next().value; URL.revokeObjectURL(u.url); said.delete(k); }
      said.set(t, hit);
    }
    await ackDone(); // an ack still being said finishes first
    if (playing !== "ack") hush();
    if (!(await playUrl(hit.url, "say"))) return false;
    used = hit.voice;
    return true;
  } catch {
    return false;
  }
}
