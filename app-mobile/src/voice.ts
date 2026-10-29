// What the phone says out loud (drive mode's read-alouds, Read it to me, the Doors Agent's replies in drive): the
// Worker's Aura-2 voice first (POST /api/voice/say, src/voice.js TTS_VOICE), so the phone sounds like the web's agent
// (Jard 10-23: "I want the spoken replies on the phone to come from the Aura 2 voice as well"); the device's own voice
// (expo-speech) when the server's doesn't answer in time, is out of today's neurons, or the MP3 won't play.
// EXPO_PUBLIC_SERVER_VOICE=0 at bundle time is the old device-voice-only phone (the switch for a build that must not
// carry it). The audio session stays the app's (app.config.js withSpokenAudio: playback / spokenAudio, mixes with
// music, plays with the silent switch on): nothing here calls setAudioModeAsync, which would replace it.
import { Platform } from "react-native";
import * as Speech from "expo-speech";
import { createAudioPlayer, type AudioPlayer, type AudioStatus } from "expo-audio";
import { Directory, File, Paths } from "expo-file-system";
import { workerFetch } from "./data";
import { ACK_FILES } from "./ack-files"; // the Agent's acknowledgement clips (Aura-2), bundled
import { pickAck } from "../../public/lib/ack.js"; // the lines, by what was said, never twice in a row (the web's)

export const SERVER_VOICE = process.env.EXPO_PUBLIC_SERVER_VOICE !== "0" && Platform.OS !== "web";
const KEEP = 30; // phrases kept as MP3s ("Say it again", the same read-out twice: one call)
const START_MS = 3000; // a fetched MP3 that hasn't started playing by then: the device voice says it
const AURA_NEURONS_PER_CHAR = 2.72727; // src/voice.js: what a reply costs, for the dev log

let turn = 0; // each speak() is a turn; stop() or a newer speak() ends the one before
let player: AudioPlayer | null = null;
let ackPlayer: AudioPlayer | null = null; // the acknowledgement clips: their own player, so an answer can wait for one
let lastAck: string | null = null;
let ackUntil = 0; // the ack clip is over by then (a cap: a player that never reports playing can't hold an answer)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let offUntil = 0; // the server said it's off / spent / busy: the device voice until then, with no wait
const kept = new Map<string, File>(); // the words → their MP3 in the cache directory
let dir: Directory | null = null;

// the words as the server reads them (src/voice.js sayable), so the cache key is what was spoken
const plain = (t: string) => String(t ?? "").replace(/\bN\/A\b/gi, "N.A.").replace(/[✓↻“”"•]/g, "").replace(/\s·\s/g, ", ").replace(/\s+/g, " ").trim().slice(0, 600);

export function stopSpeaking({ keepAck = false }: { keepAck?: boolean } = {}) {
  turn++;
  try { player?.pause(); } catch {}
  if (!keepAck) { try { ackPlayer?.pause(); } catch {} ackUntil = 0; }
  Speech.stop();
}

// The Agent's instant acknowledgement (Jard 10-28; the web's ui/voice.js ack): the line for these words, its bundled
// Aura-2 clip played at once while the model works. → the line to show (played: false when the clip couldn't play).
export function ack(text: string): { id: string; text: string; intent: string; played: boolean } {
  const a = pickAck(text, lastAck) as { id: string; text: string; intent: string };
  lastAck = a.id;
  stopSpeaking();
  if (Platform.OS === "web" || !ACK_FILES[a.id]) return { ...a, played: false };
  try {
    ackPlayer ??= createAudioPlayer(null, { updateInterval: 200 });
    ackPlayer.replace(ACK_FILES[a.id]);
    ackPlayer.seekTo(0);
    ackPlayer.play();
    ackUntil = Date.now() + 2500;
    return { ...a, played: true };
  } catch {
    return { ...a, played: false };
  }
}
// an ack clip still being said finishes first (≤ 2.5 s), so an answer never cuts it off mid-word
async function ackDone() {
  while (Date.now() < ackUntil && ackPlayer?.playing) await sleep(100);
}

// whether a voice is still speaking (the Worker's MP3, an ack clip, or the device's)
export async function isSpeaking(): Promise<boolean> {
  if (player?.playing || ackPlayer?.playing) return true;
  try { return await Speech.isSpeakingAsync(); } catch { return false; }
}
// speak, then resolve when the voice has stopped (the hands-free loop listens again only then; Read it to me shows
// Reading… until then). A cap, so a player that never ends can't hold the loop.
export async function speakAndWait(text: string, opts: { offline?: boolean } = {}): Promise<"server" | "device" | "none"> {
  const how = await speak(text, opts);
  if (how === "none") return how;
  const me = turn;
  const t0 = Date.now();
  await sleep(250); // the device voice takes a moment to report speaking
  while (me === turn && Date.now() - t0 < 120000 && (await isSpeaking())) await sleep(150);
  return how;
}

// Say it: "server" (Aura-2), "device" (expo-speech), or "none" (nothing to say, or a newer turn took over).
// offline (the guided tour): the device voice only, no Worker call, as on the web (ui/voice.js setVoiceOffline)
export async function speak(text: string, { offline = false }: { offline?: boolean } = {}): Promise<"server" | "device" | "none"> {
  stopSpeaking({ keepAck: true }); // an ack under way finishes; the answer follows it
  const me = turn;
  const t = plain(text);
  if (!t) return "none";
  if (SERVER_VOICE && !offline && Date.now() >= offUntil) {
    const t0 = Date.now();
    const file = kept.get(t) ?? (await fetchVoice(t, me));
    if (me !== turn) return "none";
    await ackDone();
    if (me !== turn) return "none";
    if (file && (await play(file, me))) {
      if (__DEV__) console.log(`[voice] aura ${Date.now() - t0} ms to start · ${t.length} chars ≈ ${Math.round(t.length * AURA_NEURONS_PER_CHAR)} neurons${kept.get(t) === file ? "" : " (failed to keep)"}`);
      return "server";
    }
    if (me !== turn) return "none";
  }
  await ackDone();
  if (me !== turn) return "none";
  Speech.speak(t, { language: "en-US" });
  return "device";
}

async function fetchVoice(t: string, me: number): Promise<File | null> {
  try {
    // the time a 1–2 sentence reply takes on Aura-2 (~1–4 s) plus the phone's network; longer read-outs get longer
    const r = await workerFetch("/api/voice/say", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: t }) }, Math.min(12000, 5000 + t.length * 10));
    if (!r.ok || !/^audio\//.test(r.headers.get("content-type") ?? "")) {
      const why = (await r.json().catch(() => ({})))?.reason;
      // spent / off: not again today on this phone's run; busy / daily: the visitor's limit, 10 minutes
      offUntil = Date.now() + (why === "spent" || why === "off" ? 60 : why === "busy" || why === "daily" || r.status === 429 ? 10 : 0) * 60000;
      if (__DEV__) console.log(`[voice] server ${r.status} ${why ?? ""}: device voice`);
      return null;
    }
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (me !== turn || !bytes.byteLength) return null;
    if (!dir) {
      dir = new Directory(Paths.cache, "doors-voice");
      try { if (dir.exists) dir.delete(); } catch {} // last run's phrases: the server's voice may have changed
      dir.create({ idempotent: true });
    }
    const file = new File(dir, `${Date.now()}-${kept.size}.mp3`);
    file.write(bytes);
    if (kept.size >= KEEP) {
      const [k, old] = kept.entries().next().value!;
      kept.delete(k);
      try { old.delete(); } catch {}
    }
    kept.set(t, file);
    return file;
  } catch (e) {
    if (__DEV__) console.log(`[voice] server failed (${(e as Error)?.name ?? e}): device voice`);
    return null; // no signal, timed out, or the cache directory refused: the device voice says this one
  }
}

// true once the MP3 is playing (or a newer turn took over); false when it errs or hasn't started in START_MS
function play(file: File, me: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    let sub: { remove(): void } | null = null;
    const end = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      sub?.remove();
      if (!ok) try { player?.pause(); } catch {}
      resolve(ok);
    };
    const timer = setTimeout(() => end(me !== turn), START_MS);
    try {
      player ??= createAudioPlayer(null, { updateInterval: 200 });
      sub = player.addListener("playbackStatusUpdate", (s: AudioStatus) => {
        if (me !== turn) return end(true);
        if (s.error) return end(false);
        if (s.playing || s.didJustFinish || s.currentTime > 0) end(true);
      });
      player.replace({ uri: file.uri });
      player.play();
    } catch {
      end(false);
    }
  });
}
