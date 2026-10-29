// (Jard 10-23): web drive mode works like the phone in any browser. The Worker's voice routes
// (src/voice.js) for browsers whose own speech fails; the page's WAV encoder. No data: runs in the public repo too
// (Skip and the Worker's routing are in webdrive-data.test.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { handleVoice, _resetVoice, wavSeconds, MAX_AUDIO, VOICE_WINDOW, STT_MODEL, TTS_MODEL, MELO_MODEL, TTS_VOICE, AURA_VOICES, AURA_NEURONS_PER_CHAR, sayable } from "../src/voice.js";
import { _resetAgent, neuronsSpent } from "../src/agent.js";
import { toWav, RATE, say, sayAgent, ack, voiceUsed, _resetVoice as _resetPageVoice } from "../public/ui/voice.js";

// ---------- the Worker's voice ----------
const wav = (secs, rate = 16000) => {
  const n = Math.round(secs * rate);
  const b = new Uint8Array(44 + n * 2);
  const v = new DataView(b.buffer);
  const str = (o, s) => [...s].forEach((c, i) => (b[o + i] = c.charCodeAt(0)));
  str(0, "RIFF"); v.setUint32(4, 36 + n * 2, true); str(8, "WAVE"); str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, n * 2, true);
  return b;
};
const ORIGIN = "http://localhost:8792";
const req = (path, body, type, headers = {}) => new Request(`${ORIGIN}${path}`, { method: "POST", headers: { origin: ORIGIN, "content-type": type, ...headers }, body });
const stubAI = (impl) => { const calls = []; return { calls, run: async (model, input) => (calls.push({ model, input }), impl(model, input)) }; };
const fresh = () => { _resetVoice(); _resetAgent(); };

test("voice listen: a WAV goes to Whisper as base64 (English), the transcript comes back, its neurons count in the agent's day", async () => {
  fresh();
  const AI = stubAI(() => ({ text: "  interested, come back Thursday at 3 ", transcription_info: { duration: 6 } }));
  const r = await handleVoice(req("/api/voice/listen", wav(6), "audio/wav"), { AI }, "/api/voice/listen");
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { text: "interested, come back Thursday at 3" });
  assert.equal(AI.calls[0].model, STT_MODEL);
  assert.equal(AI.calls[0].input.language, "en");
  assert.equal(typeof AI.calls[0].input.audio, "string");
  assert.equal(Buffer.from(AI.calls[0].input.audio, "base64").length, 44 + 6 * 16000 * 2);
  assert.ok(Math.abs(neuronsSpent() - (6 / 60) * 46.63) < 0.01, `${neuronsSpent()} neurons`);
});

test("voice say: Aura-2's MP3 stream comes back as audio/mpeg in the set voice; the same words again cost no second call", async () => {
  fresh();
  const mp3 = Buffer.from("ID3fake-mp3-bytes");
  const AI = stubAI(() => new Response(mp3).body); // the binding returns a ReadableStream
  const body = JSON.stringify({ text: "Logged “The Yard”: interested · back Thu 3 pm. ✓" });
  for (let i = 0; i < 2; i++) {
    const r = await handleVoice(req("/api/voice/say", body, "application/json"), { AI }, "/api/voice/say");
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-type"), "audio/mpeg");
    assert.deepEqual(Buffer.from(await r.arrayBuffer()), mp3);
  }
  assert.equal(AI.calls.length, 1);
  assert.equal(AI.calls[0].model, TTS_MODEL);
  assert.equal(TTS_MODEL, "@cf/deepgram/aura-2-en");
  assert.ok(AURA_VOICES.includes(TTS_VOICE), TTS_VOICE);
  assert.deepEqual(AI.calls[0].input, { text: "Logged The Yard: interested, back Thu 3 pm.", speaker: TTS_VOICE, encoding: "mp3" });
  const chars = "Logged The Yard: interested, back Thu 3 pm.".length;
  assert.ok(Math.abs(neuronsSpent() - chars * AURA_NEURONS_PER_CHAR) < 0.01, `${neuronsSpent()} neurons`);
});

test("voice say: the voice is one setting (TTS_VOICE): another Aura-2 speaker, or melotts; each voice has its own cache", async () => {
  fresh();
  const AI = stubAI((model) => (model === MELO_MODEL ? { audio: Buffer.from("melo").toString("base64") } : new Uint8Array([1, 2, 3])));
  const body = JSON.stringify({ text: "Back Thursday at three." });
  await handleVoice(req("/api/voice/say", body, "application/json"), { AI, TTS_VOICE: "Phoebe" }, "/api/voice/say");
  assert.equal(AI.calls.at(-1).input.speaker, "phoebe");
  await handleVoice(req("/api/voice/say", body, "application/json"), { AI, TTS_VOICE: "andromeda" }, "/api/voice/say");
  assert.equal(AI.calls.at(-1).input.speaker, "andromeda");
  const r = await handleVoice(req("/api/voice/say", body, "application/json"), { AI, TTS_VOICE: "melotts" }, "/api/voice/say");
  assert.deepEqual(Buffer.from(await r.arrayBuffer()), Buffer.from("melo"));
  assert.equal(AI.calls.length, 3);
  assert.deepEqual(AI.calls.at(-1), { model: MELO_MODEL, input: { prompt: "Back Thursday at three.", lang: "en" } });
});

test("voice say: when Aura-2 no longer fits the day's share, MeloTTS reads it rather than nothing", async () => {
  fresh();
  const AI = stubAI((model) => (model === MELO_MODEL ? { audio: Buffer.from("melo").toString("base64") } : new Uint8Array([1])));
  const text = "x".repeat(100); // Aura-2 ≈ 273 neurons
  let r = await handleVoice(req("/api/voice/say", JSON.stringify({ text }), "application/json"), { AI, AGENT_NEURONS_DAILY: 300 }, "/api/voice/say");
  assert.equal(r.status, 200);
  assert.equal(AI.calls.at(-1).model, TTS_MODEL);
  r = await handleVoice(req("/api/voice/say", JSON.stringify({ text: "y".repeat(100) }), "application/json"), { AI, AGENT_NEURONS_DAILY: 300 }, "/api/voice/say");
  assert.equal(r.status, 200);
  assert.equal(AI.calls.at(-1).model, MELO_MODEL);
});

test("voice say (MeloTTS): its base64 MP3 comes back as audio/mpeg; the same words again cost no second call", async () => {
  fresh();
  const mp3 = Buffer.from("ID3fake-mp3-bytes");
  const AI = stubAI(() => ({ audio: mp3.toString("base64") }));
  const body = JSON.stringify({ text: "Logged “The Yard”: interested · back Thu 3 pm. ✓" });
  for (let i = 0; i < 2; i++) {
    const r = await handleVoice(req("/api/voice/say", body, "application/json"), { AI, TTS_VOICE: "melotts" }, "/api/voice/say");
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("content-type"), "audio/mpeg");
    assert.deepEqual(Buffer.from(await r.arrayBuffer()), mp3);
  }
  assert.equal(AI.calls.length, 1);
  assert.equal(AI.calls[0].model, MELO_MODEL);
  assert.equal(AI.calls[0].input.prompt, "Logged The Yard: interested, back Thu 3 pm.");
  assert.equal(sayable("a · b ✓"), "a, b");
  assert.equal(sayable("lead with the dry-hopped N/A, not n/a seltzer"), "lead with the dry-hopped N.A., not N.A. seltzer"); // Aura-2 read "N/A" as "done"
});

test("voice: never a guess. No model → 503 off; the day's neurons used (4006) → 503 spent, and no more calls today", async () => {
  fresh();
  let r = await handleVoice(req("/api/voice/listen", wav(2), "audio/wav"), {}, "/api/voice/listen");
  assert.equal(r.status, 503);
  assert.equal((await r.json()).reason, "off");
  const AI = stubAI(() => { throw new Error("Workers AI 429: AiError: you have used up your daily free allocation of 10,000 neurons (4006)"); });
  r = await handleVoice(req("/api/voice/listen", wav(2), "audio/wav"), { AI }, "/api/voice/listen");
  assert.equal(r.status, 503);
  assert.equal((await r.json()).reason, "spent");
  r = await handleVoice(req("/api/voice/say", JSON.stringify({ text: "hi" }), "application/json"), { AI }, "/api/voice/say");
  assert.equal((await r.json()).reason, "spent");
  assert.equal(AI.calls.length, 1, "no call after the day is spent");
});

test("voice guards: another site 403, wrong type 415, over the byte cap 413, not a WAV 400, a near-silent clip costs nothing", async () => {
  fresh();
  const AI = stubAI(() => ({ text: "x" }));
  const env = { AI };
  let r = await handleVoice(new Request(`${ORIGIN}/api/voice/listen`, { method: "POST", headers: { origin: "https://evil.example", "content-type": "audio/wav" }, body: wav(1) }), env, "/api/voice/listen");
  assert.equal(r.status, 403);
  r = await handleVoice(req("/api/voice/listen", wav(1), "audio/webm"), env, "/api/voice/listen");
  assert.equal(r.status, 415);
  r = await handleVoice(req("/api/voice/listen", new Uint8Array(MAX_AUDIO + 1), "audio/wav"), env, "/api/voice/listen");
  assert.equal(r.status, 413);
  r = await handleVoice(req("/api/voice/listen", new Uint8Array(2000), "audio/wav"), env, "/api/voice/listen");
  assert.equal(r.status, 400);
  r = await handleVoice(req("/api/voice/listen", wav(0.1), "audio/wav"), env, "/api/voice/listen");
  assert.deepEqual(await r.json(), { text: "" });
  r = await handleVoice(new Request(`${ORIGIN}/api/voice/say`, { method: "GET", headers: { origin: ORIGIN } }), env, "/api/voice/say");
  assert.equal(r.status, 405);
  assert.equal(AI.calls.length, 0);
});

test("voice: per visitor per 10 minutes, then 429 busy; the edge limiter says busy too", async () => {
  fresh();
  const AI = stubAI(() => ({ text: "ok" }));
  const env = { AI };
  let last;
  for (let i = 0; i <= VOICE_WINDOW; i++) last = await handleVoice(req("/api/voice/listen", wav(1), "audio/wav", { "cf-connecting-ip": "203.0.113.9" }), env, "/api/voice/listen");
  assert.equal(last.status, 429);
  assert.equal((await last.json()).reason, "busy");
  fresh();
  const r = await handleVoice(req("/api/voice/listen", wav(1), "audio/wav"), { AI, VOICE_LIMITER: { limit: async () => ({ success: false }) } }, "/api/voice/listen");
  assert.equal(r.status, 429);
});

// ---------- the page's WAV ----------
test("toWav: 48 kHz float chunks → a 16 kHz mono 16-bit PCM WAV the Worker reads, the same length in seconds", async () => {
  const rate = 48000;
  const secs = 1.5;
  const chunks = [];
  for (let o = 0; o < rate * secs; o += 4096) chunks.push(Float32Array.from({ length: Math.min(4096, rate * secs - o) }, (_, i) => 0.5 * Math.sin(((o + i) / rate) * 2 * Math.PI * 440)));
  const blob = toWav(chunks, rate);
  assert.equal(blob.type, "audio/wav");
  const b = new Uint8Array(await blob.arrayBuffer());
  assert.equal(new DataView(b.buffer).getUint32(24, true), RATE);
  assert.ok(Math.abs(wavSeconds(b) - secs) < 0.01);
  const peak = Math.max(...new Int16Array(b.buffer.slice(44)).map(Math.abs));
  assert.ok(peak > 12000 && peak < 20000, `peak ${peak}`); // ~0.5 of full scale survives the averaging
});

// ---------- the page's voice out: the Worker's Aura-2 voice first, for every say (spec step 6; Jard 10-28) ----------
// one <audio> element for everything (iPhone: a tap-unlocked element plays again on its own; through the ringer switch)
class FakeAudio {
  constructor() { this.src = ""; this.paused = true; this.ended = false; this.h = {}; FakeAudio.made++; }
  addEventListener(k, f) { this.h[k] = f; }
  removeEventListener(k) { delete this.h[k]; }
  setAttribute() {}
  async play() { FakeAudio.log.push(`play ${this.src}`); this.paused = false; this.ended = false; setTimeout(() => { this.ended = true; }, 30); }
  pause() { this.paused = true; }
}
FakeAudio.log = [];
FakeAudio.made = 0;
test("say: the Worker's Aura-2 voice first, on the one shared element; the browser's own only when the Worker can't", async () => {
  const saved = { fetch: globalThis.fetch, Audio: globalThis.Audio, speechSynthesis: globalThis.speechSynthesis, SSU: globalThis.SpeechSynthesisUtterance, url: URL.createObjectURL };
  const log = FakeAudio.log;
  let serverOk = true;
  let voice = "phoebe";
  globalThis.fetch = async (u) => (log.push(`fetch ${u}`), serverOk ? new Response(new Uint8Array([1]), { headers: { "content-type": "audio/mpeg", "x-doors-voice": voice } }) : new Response("{}", { status: 503 }));
  globalThis.Audio = FakeAudio;
  URL.createObjectURL = () => `blob:${log.length}`;
  globalThis.speechSynthesis = { getVoices: () => [{ lang: "en-US", localService: true }], speak: (u) => (log.push(`browser ${u.text}`), setTimeout(() => u.onstart?.(), 5)), cancel() {}, addEventListener() {} };
  globalThis.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
  try {
    _resetPageVoice();
    log.length = 0;
    FakeAudio.made = 0;
    assert.equal(await sayAgent("Two doors left today."), true);
    assert.deepEqual(log, ["fetch /api/voice/say", "play blob:1"]);
    assert.equal(voiceUsed(), "aura");
    log.length = 0;
    assert.equal(await say("Read it to me."), true);
    assert.deepEqual(log, ["fetch /api/voice/say", "play blob:1"], "drive's read-aloud: the Worker's voice too, never the phone's while it can speak");
    log.length = 0;
    voice = "melotts";
    assert.equal(await say("Resting voice."), true);
    assert.equal(voiceUsed(), "melotts", "the page knows when MeloTTS read it");
    log.length = 0;
    serverOk = false;
    let failed = null;
    assert.equal(await sayAgent("Back at three.", { onFail: (m) => (failed = m) }), true);
    assert.deepEqual(log, ["fetch /api/voice/say", "browser Back at three."]);
    assert.equal(voiceUsed(), "browser");
    assert.equal(failed, null);
    assert.equal(FakeAudio.made, 1, "one element for every clip");
  } finally {
    globalThis.fetch = saved.fetch; globalThis.Audio = saved.Audio; URL.createObjectURL = saved.url;
    if (saved.speechSynthesis === undefined) delete globalThis.speechSynthesis; else globalThis.speechSynthesis = saved.speechSynthesis;
    if (saved.SSU === undefined) delete globalThis.SpeechSynthesisUtterance; else globalThis.SpeechSynthesisUtterance = saved.SSU;
    _resetPageVoice();
  }
});

test("ack: the instant acknowledgement plays its baked clip at once, and the Worker's answer waits for it to end", async () => {
  const saved = { fetch: globalThis.fetch, Audio: globalThis.Audio, url: URL.createObjectURL, document: globalThis.document };
  const log = FakeAudio.log;
  globalThis.fetch = async (u) => (log.push(`fetch ${u}`), new Response(new Uint8Array([1]), { headers: { "content-type": "audio/mpeg", "x-doors-voice": "phoebe" } }));
  globalThis.Audio = FakeAudio;
  globalThis.document = {};
  URL.createObjectURL = () => "blob:answer";
  try {
    _resetPageVoice();
    log.length = 0;
    const a = await ack("tell me about my next stop");
    assert.equal(a.intent, "ask");
    assert.equal(a.played, true);
    assert.match(log[0], /^play \/audio\/ack\/ask-\d\.mp3$/);
    const b = await ack("tell me more");
    assert.notEqual(b.id, a.id, "never the same line twice in a row");
    log.length = 0;
    const t0 = Date.now();
    assert.equal(await sayAgent("The Drafting Room is next."), true);
    assert.deepEqual(log, ["fetch /api/voice/say", "play blob:answer"]);
    assert.ok(Date.now() - t0 >= 25, "the answer waited for the ack clip to end");
  } finally {
    globalThis.fetch = saved.fetch; globalThis.Audio = saved.Audio; URL.createObjectURL = saved.url;
    if (saved.document === undefined) delete globalThis.document; else globalThis.document = saved.document;
    _resetPageVoice();
  }
});
