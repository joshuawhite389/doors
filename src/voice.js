// Drive mode's voice when the browser has none (in Brave on Linux "Tap and say how it
// went" and "Read it to me" did nothing). The page uses the browser's own speech first (ui/voice.js); only when that
// fails does it come here:
//   POST /api/voice/listen  body: a short WAV (audio/wav, 16 kHz mono from the page) → {text}   Workers AI Whisper
//   POST /api/voice/say     body: {text} (JSON, ≤ MAX_SAY characters)       → audio/mpeg       Workers AI Deepgram Aura-2
// The voice is one setting, TTS_VOICE (spec step 6: Jard picks it by ear). Free neurons
// only, from the chat agent's share of the day (src/agent.js): a 6 s visit ≈ 5 neurons; Aura-2 costs ~2.7 neurons a
// character, so a 1–2 sentence reply (~150 characters) ≈ 410 and the day's share speaks ~20 of them. When Aura-2 no
// longer fits what is left, MeloTTS reads it (≈ 0.02 neurons a character) rather than nothing. The audio and the text are never stored or logged: they go to Workers AI and the answer comes back. Guards as the
// agent's: the page's own origin, a byte cap read as it streams, per visitor per 10 minutes and per day, and the edge
// limiter (VOICE_LIMITER) across isolates. A failure is a 503 with `reason` (off | spent | busy | error), never a guess.
import { ipKey, originOk } from "./guard.js";
import { neuronsRoom, spendVoiceNeurons } from "./agent.js";

export const STT_MODEL = "@cf/openai/whisper-large-v3-turbo";
export const TTS_MODEL = "@cf/deepgram/aura-2-en";
export const MELO_MODEL = "@cf/myshell-ai/melotts";
// THE ONE SETTING: an Aura-2 speaker below, or "melotts" for the old voice (env.TTS_VOICE overrides it)
export const TTS_VOICE = "phoebe";
// developers.cloudflare.com/workers-ai/models/aura-2-en (read 2026-10-23): the binding's `speaker` values
export const AURA_VOICES = ["amalthea", "andromeda", "apollo", "arcas", "aries", "asteria", "athena", "atlas", "aurora", "callista", "cora", "cordelia", "delia", "draco", "electra", "harmonia", "helena", "hera", "hermes", "hyperion", "iris", "janus", "juno", "jupiter", "luna", "mars", "minerva", "neptune", "odysseus", "ophelia", "orion", "orpheus", "pandora", "phoebe", "pluto", "saturn", "thalia", "theia", "vesta", "zeus"];
// developers.cloudflare.com/workers-ai/platform/pricing (read 2026-10-23): neurons per audio minute; Aura-2 per character
export const NEURONS_PER_MIN = { stt: 46.63, tts: 18.63 };
export const AURA_NEURONS_PER_CHAR = 2.72727; // $0.030 per 1k characters
export const TTS_CHARS_PER_MIN = 900; // MeloTTS reads ~15 characters a second: the estimate of a reply's minutes
// the voice in use and what this text costs on it: Aura-2 while it fits the day's share, else MeloTTS
export function ttsPlan(env, text) {
  const v = String(env.TTS_VOICE ?? TTS_VOICE).trim().toLowerCase();
  const aura = AURA_VOICES.includes(v) ? text.length * AURA_NEURONS_PER_CHAR : null;
  if (aura != null && neuronsRoom(env, aura)) return { voice: v, model: TTS_MODEL, input: { text, speaker: v, encoding: "mp3" }, neurons: aura };
  return { voice: "melotts", model: MELO_MODEL, input: { prompt: text, lang: "en" }, neurons: (text.length / TTS_CHARS_PER_MIN) * NEURONS_PER_MIN.tts };
}
export const MAX_AUDIO = 800 * 1024; // 25 s of 16 kHz 16-bit mono WAV
export const MAX_SAY = 600;
export const VOICE_WINDOW = 30; // voice calls per visitor per 10 minutes
export const VOICE_DAILY = 200; // and per day (a day of 15 doors, each said and read back, with retries, is ~60)
export const VOICE_MS = 15000;
export const VOICE_OFF = "Voice isn't available here right now: tap an answer or type it.";
export const VOICE_EASY = "Too many voice messages in ten minutes. Tap an answer or type it.";

const json = (body, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const today = (env) => env.TODAY ?? new Date().toISOString().slice(0, 10);
const recent = new Map(); // ip → timestamps in the last 10 min
const daily = new Map(); // "<day>|<ip>" → calls today
let spentDay = null; // the day Cloudflare said the account's free neurons are used (4006)
const said = new Map(); // "<voice>|<text>" → MP3 bytes (this isolate; "Read it to me" twice costs one call)
export function _resetVoice() {
  recent.clear();
  daily.clear();
  said.clear();
  spentDay = null;
}

// One call for this visitor: null when allowed (and counted), else "busy" (10 min) or "daily".
export function voiceLimited(env, ip, now = Date.now()) {
  const r = (recent.get(ip) ?? []).filter((t) => now - t < 10 * 60 * 1000);
  if (r.length >= Number(env.VOICE_WINDOW ?? VOICE_WINDOW)) return "busy";
  const d = `${today(env)}|${ip}`;
  if ((daily.get(d) ?? 0) >= Number(env.VOICE_DAILY ?? VOICE_DAILY)) return "daily";
  r.push(now);
  recent.set(ip, r);
  daily.set(d, (daily.get(d) ?? 0) + 1);
  if (recent.size > 5000) recent.clear();
  if (daily.size > 20000) daily.clear();
  return null;
}

// The body as bytes, or null when it is over `max` (by its content-length, else as it streams in).
export async function readBytes(request, max) {
  const len = Number(request.headers.get("content-length"));
  if (Number.isFinite(len) && len > max) return null;
  if (!request.body) return new Uint8Array(0);
  const reader = request.body.getReader();
  const parts = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > max) {
      reader.cancel().catch(() => {});
      return null;
    }
    parts.push(value);
  }
  const all = new Uint8Array(n);
  let o = 0;
  for (const p of parts) all.set(p, o), (o += p.byteLength);
  return all;
}

// A WAV's seconds of audio from its header, or null when it isn't a PCM WAV.
export function wavSeconds(b) {
  if (!b || b.byteLength < 44) return null;
  const tag = (o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const byteRate = v.getUint32(28, true);
  return byteRate > 0 ? (b.byteLength - 44) / byteRate : null;
}

export function toBase64(b) {
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}
const fromBase64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
// the binding takes no abort signal: a call that runs past ms fails as a timeout
const timed = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(Object.assign(new Error("voice timeout"), { name: "TimeoutError" })), ms))]);
const isSpent = (e) => /4006|daily free allocation|neurons/i.test(e?.message ?? "");

// what the voice returns: MeloTTS {audio: base64 MP3} (JSON, as over REST), or the MP3 itself (Aura-2: a stream; bytes)
async function mp3Of(out) {
  if (typeof out?.audio === "string") return fromBase64(out.audio);
  if (out instanceof Uint8Array) return out;
  if (out instanceof ArrayBuffer) return new Uint8Array(out);
  if (out && typeof out.getReader === "function") return new Uint8Array(await new Response(out).arrayBuffer());
  return null;
}

// the words read aloud: plain, one line, no marks a voice reads out ("✓", "·")
export const sayable = (t) => String(t ?? "").replace(/\bN\/A\b/gi, "N.A.").replace(/[✓↻“”"•]/g, "").replace(/\s·\s/g, ", ").replace(/\s+/g, " ").trim().slice(0, MAX_SAY);

export async function handleVoice(request, env, path) {
  if (request.method !== "POST") return json({ error: "POST only" }, 405);
  if (!originOk(request, env, { required: true })) return json({ error: "Voice answers Doors' own page." }, 403);
  const listen = path === "/api/voice/listen";
  const ct = request.headers.get("content-type") ?? "";
  if (listen ? !/^audio\/(wav|x-wav|wave)\b/i.test(ct) : !/^application\/json\b/i.test(ct)) return json({ error: listen ? "Send a WAV (content-type: audio/wav)" : "Send JSON (content-type: application/json)" }, 415);
  if (!env.AI?.run) return json({ error: VOICE_OFF, reason: "off" }, 503);
  if (spentDay === today(env) || !neuronsRoom(env)) return json({ error: VOICE_OFF, reason: "spent" }, 503);
  // the request is read before it is counted, so a bad one costs the visitor nothing
  let audio = null;
  let text = "";
  let plan = null;
  if (listen) {
    audio = await readBytes(request, MAX_AUDIO);
    if (audio == null) return json({ error: "That's too long to send at once: say it in a sentence or two." }, 413);
    const secs = wavSeconds(audio);
    if (secs == null) return json({ error: "Send a WAV (PCM)" }, 400);
    if (secs < 0.3) return json({ text: "" });
  } else {
    let body;
    try {
      body = JSON.parse(new TextDecoder().decode((await readBytes(request, 8 * 1024)) ?? new Uint8Array(0)));
    } catch {
      return json({ error: "Send JSON: {text}" }, 400);
    }
    text = sayable(body?.text);
    if (!text) return json({ error: "Nothing to say" }, 400);
    plan = ttsPlan(env, text);
    const hit = said.get(`${plan.voice}|${text}`);
    if (hit) return new Response(hit, { headers: { "content-type": "audio/mpeg", "cache-control": "no-store", "x-doors-voice": plan.voice } });
  }
  const ip = ipKey(request.headers.get("cf-connecting-ip") ?? "local");
  let edge = false;
  if (env.VOICE_LIMITER) try { edge = !(await env.VOICE_LIMITER.limit({ key: ip })).success; } catch {}
  const why = edge ? "busy" : voiceLimited(env, ip);
  if (why) return json({ error: why === "busy" ? VOICE_EASY : VOICE_OFF, reason: why }, 429);
  try {
    if (listen) {
      const out = await timed(env.AI.run(STT_MODEL, { audio: toBase64(audio), language: "en", vad_filter: true }), Number(env.VOICE_MS ?? VOICE_MS));
      spendVoiceNeurons(env, ((out?.transcription_info?.duration ?? wavSeconds(audio)) / 60) * NEURONS_PER_MIN.stt);
      return json({ text: String(out?.text ?? "").replace(/\s+/g, " ").trim().slice(0, 400) });
    }
    const mp3 = await mp3Of(await timed(env.AI.run(plan.model, plan.input), Number(env.VOICE_MS ?? VOICE_MS)));
    spendVoiceNeurons(env, plan.neurons);
    if (!mp3?.byteLength) return json({ error: VOICE_OFF, reason: "error" }, 503);
    if (said.size >= 40) said.delete(said.keys().next().value);
    said.set(`${plan.voice}|${text}`, mp3);
    // x-doors-voice: which voice read it (the Aura-2 speaker, or melotts), so the page can say when the Doors voice is resting
    return new Response(mp3, { headers: { "content-type": "audio/mpeg", "cache-control": "no-store", "x-doors-voice": plan.voice } });
  } catch (e) {
    if (isSpent(e)) spentDay = today(env);
    return json({ error: VOICE_OFF, reason: isSpent(e) ? "spent" : e?.name === "TimeoutError" ? "timeout" : "error" }, 503);
  }
}
