// Tap to talk (spec step 6; Jard 10-23: "I don't like how we have to use the phone keyboard's microphone to speak with
// the mobile app. I do not want that."): the app's own mic. Tap → it records (expo-audio, a 16 kHz mono 16-bit WAV, as
// the web's server path sends) → tap again, or a pause after speaking, or MAX_MS → the WAV goes to the Worker's
// POST /api/voice/listen (src/voice.js, Workers AI Whisper) → the words, to whatever the screen does with them (the
// Agent box: in the box to edit before Send; the Done box: logged at once, with Undo). The keyboard stays the typing
// path. The audio and the words go to the Worker and back; the phone deletes the clip as soon as it's sent.
// The audio session: recording needs playAndRecord (expo-audio sets it); when the words are back the app's own
// playback / spokenAudio session is put back (modules/spoken-session), so read-alouds still play with the silent switch on.
// EXPO_PUBLIC_MIC=0 at bundle time hides the mic (a build that must not carry it). iOS only: Android's recorder has no WAV.
import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { AudioQuality, IOSOutputFormat, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, type RecordingOptions } from "expo-audio";
import { File } from "expo-file-system";
import { workerFetch } from "./data";
import { stopSpeaking } from "./voice";
import { restoreSpokenSession } from "../modules/spoken-session";
import { plainWav, wavSecs, wavSlice } from "../../public/lib/wav.js";

export const MIC = process.env.EXPO_PUBLIC_MIC !== "0" && Platform.OS === "ios";
export const MAX_MS = 20000; // a "how it went" or a question is a sentence or two (the web's MAX_REC_MS; the Worker takes 25 s)
const NO_SPEECH_MS = 8000; // nothing said by then: stop (the web's NO_SPEECH_MS)
const QUIET_MS = 1800; // after speech, this much quiet ends it (the web's 1600, a little longer for a phone held away)
const SPEECH_DB = -30; // a meter reading louder than this is speech (iOS average power, dBFS)
const QUIET_DB = -42; // and quieter than this is a pause; road noise between the two just runs to a tap or MAX_MS
const LISTEN_MS = 20000; // the Worker's Whisper answers a 5 s clip in ~1 s; a slow signal gets this long
const WAIT_RESTART_MS = 45000; // the hands-free ear: a quiet wait starts a fresh clip this often (the file stays small)
const RUN_UP_S = 0.8; // and sends only from this long before the rep's first word

export const MIC_MSG = {
  denied: "Doors can't hear you: allow the microphone for Doors in Settings. Typing still works.",
  missed: "Didn't catch that: tap the mic and try again, or type it.",
  offline: "Couldn't reach Doors to hear that: try again, or type it.",
  broken: "The mic didn't start: try again, or type it.",
};

// 16 kHz mono 16-bit PCM in a .wav: what /api/voice/listen takes (iOS adds chunks; plainWav takes them out)
const WAV: RecordingOptions = {
  extension: ".wav",
  sampleRate: 16000,
  numberOfChannels: 1,
  bitRate: 256000,
  isMeteringEnabled: true,
  android: { outputFormat: "default", audioEncoder: "default" },
  ios: { outputFormat: IOSOutputFormat.LINEARPCM, audioQuality: AudioQuality.HIGH, linearPCMBitDepth: 16, linearPCMIsBigEndian: false, linearPCMIsFloat: false },
  web: {},
};

// the last listen, for the dev log and a check: seconds said, bytes sent, ms from stop to words
export const lastListen: { secs: number; bytes: number; ms: number; status: string } = { secs: 0, bytes: 0, ms: 0, status: "" };

export type MicPhase = "idle" | "listen" | "read";

// → {text} | {error} (a line to show). The clip's file is deleted either way. fromSec: send only from there on.
export async function transcribe(uri: string, fromSec = 0): Promise<{ text: string } | { error: string }> {
  const file = new File(uri);
  try {
    const raw = new Uint8Array(await file.arrayBuffer());
    const wav0 = plainWav(raw);
    const wav = wav0 && fromSec > 0 ? wavSlice(wav0, fromSec) : wav0;
    if (!wav) return { error: MIC_MSG.broken };
    const secs = wavSecs(wav);
    if (secs < 0.3) return { error: MIC_MSG.missed };
    const t0 = Date.now();
    const r = await workerFetch("/api/voice/listen", { method: "POST", headers: { "content-type": "audio/wav" }, body: wav as any }, LISTEN_MS);
    const b = await r.json().catch(() => ({}));
    Object.assign(lastListen, { secs: Math.round(secs * 10) / 10, bytes: wav.byteLength, ms: Date.now() - t0, status: `${r.status}${b?.reason ? ` ${b.reason}` : ""}` });
    if (__DEV__) console.log(`[mic] ${lastListen.secs} s · ${wav.byteLength} B → ${lastListen.status} in ${lastListen.ms} ms`);
    if (r.ok && typeof b?.text === "string") return b.text.trim() ? { text: b.text.trim() } : { error: MIC_MSG.missed };
    return { error: typeof b?.error === "string" && b.error ? b.error : MIC_MSG.offline }; // the Worker's own line (off / spent / busy)
  } catch (e) {
    if (__DEV__) console.log(`[mic] failed: ${(e as Error)?.name ?? e}`);
    return { error: MIC_MSG.offline };
  } finally {
    try { file.delete(); } catch {}
  }
}

// back to the app's session: playback / spokenAudio (the native module), else expo-audio's plain playback
async function playbackAgain() {
  if (restoreSpokenSession()) return;
  try { await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true, interruptionMode: "mixWithOthers" }); } catch {}
}

// One mic for a screen: toggle() starts and stops it; onText gets the words. note is the line to show (or null).
// wait (the hands-free ear, screens/Drive.tsx HandsFreeBar): no "nothing said" cut-off: it records until the rep speaks
// (a fresh clip every WAIT_RESTART_MS while quiet), sends only from just before the first word, and a clip Whisper
// heard nothing in is onMiss (not a line), so the ear just listens again.
export function useMic(onText: (text: string) => void, { wait = false, onMiss }: { wait?: boolean; onMiss?: () => void } = {}) {
  const rec = useAudioRecorder(WAV);
  const [phase, setPhase] = useState<MicPhase>("idle");
  const [note, setNote] = useState<string | null>(null);
  const [level, setLevel] = useState(0); // 0–1, the pulse while listening
  const [secs, setSecs] = useState(0);
  const live = useRef(true);
  const on = useRef(onText);
  on.current = onText;
  type Run = { t0: number; heard: boolean; heardAt: number; quietAt: number; timer: ReturnType<typeof setInterval> | null; stopping: boolean };
  const run = useRef<Run>({ t0: 0, heard: false, heardAt: 0, quietAt: 0, timer: null, stopping: false });
  const miss = useRef(onMiss);
  miss.current = onMiss;

  const finish = async (send: boolean, { again = false }: { again?: boolean } = {}) => {
    const r = run.current;
    if (r.stopping) return;
    r.stopping = true;
    if (r.timer) clearInterval(r.timer);
    r.timer = null;
    setLevel(0);
    try { await rec.stop(); } catch {}
    if (!again) await playbackAgain();
    const uri = rec.uri;
    if (!send || !uri) {
      if (uri) try { new File(uri).delete(); } catch {}
      if (!live.current) return;
      if (again) return void start(); // the ear's fresh clip: still listening
      setPhase("idle");
      return;
    }
    if (live.current) setPhase("read");
    const out = await transcribe(uri, wait && r.heard ? Math.max(0, (r.heardAt - r.t0) / 1000 - RUN_UP_S) : 0);
    if (!live.current) return;
    setPhase("idle");
    if ("text" in out) on.current(out.text);
    else if (wait && out.error === MIC_MSG.missed) miss.current?.();
    else setNote(out.error);
  };

  const start = async () => {
    setNote(null);
    if (!wait) stopSpeaking(); // the mic would hear the read-aloud (the ear starts only once the voice is done)
    const p = await requestRecordingPermissionsAsync().catch(() => null);
    if (!p?.granted) return setNote(MIC_MSG.denied);
    try {
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true, interruptionMode: "mixWithOthers" });
      await rec.prepareToRecordAsync();
      rec.record();
    } catch (e) {
      if (__DEV__) console.log(`[mic] start failed: ${(e as Error)?.message ?? e}`);
      await playbackAgain();
      return setNote(MIC_MSG.broken);
    }
    const r: Run = (run.current = { t0: Date.now(), heard: false, heardAt: 0, quietAt: 0, timer: null, stopping: false });
    if (!live.current) return finish(false); // the screen closed while the mic was starting
    setPhase("listen");
    setSecs(0);
    r.timer = setInterval(() => {
      const now = Date.now();
      const st = rec.getStatus();
      const db = typeof st.metering === "number" ? st.metering : -160;
      setLevel(Math.max(0, Math.min(1, (db + 55) / 40)));
      setSecs(Math.floor((now - r.t0) / 1000));
      if (db > SPEECH_DB) { if (!r.heard) r.heardAt = now; (r.heard = true), (r.quietAt = 0); }
      else if (r.heard && db < QUIET_DB) r.quietAt ||= now;
      else if (db >= QUIET_DB) r.quietAt = 0;
      const since = now - (wait && r.heard ? r.heardAt : r.t0); // the ear: the cap counts from the first word
      if (since >= MAX_MS || (r.heard && r.quietAt && now - r.quietAt >= QUIET_MS)) finish(true);
      else if (wait && !r.heard && now - r.t0 >= WAIT_RESTART_MS) finish(false, { again: true }); // quiet: a fresh clip, still listening
      else if (!wait && !r.heard && now - r.t0 >= NO_SPEECH_MS) finish(true); // Whisper may still hear a quiet voice; "Didn't catch that" if not
    }, 100);
  };

  const toggle = () => {
    if (phase === "listen") return finish(true);
    if (phase === "idle") return start();
  };
  const cancel = () => (phase === "listen" ? finish(false) : undefined);

  useEffect(() => () => {
    live.current = false;
    if (run.current.timer) finish(false);
  }, []);

  return { phase, note, level, secs, toggle, cancel, clearNote: () => setNote(null) };
}
