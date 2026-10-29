// r8hf (Jard 10-28): the drive Agent never falls back to typing without a word. voice.js keeps a failure instead of
// latching the microphone off: canListen() stays true while the browser has the APIs, whyCantListen() names what is
// missing, every failure of the page's own ear (the microphone, a quiet AudioContext, the Worker off, the network)
// reaches onFail with a specific line and is kept for the debug line, and retryVoiceIn() forgets it. No browser: the
// microphone, the AudioContext and fetch are stubbed here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { listen, canListen, whyCantListen, lastMicFail, retryVoiceIn, voiceStatus, unlockAudio, _resetVoice, MSG, SILENCE_MS } from "../public/ui/voice.js";

// a browser with getUserMedia and an AudioContext whose ScriptProcessor plays `frames` (each a Float32Array) 50 ms apart
let gumImpl = null;
let ctxState = "running";
let frames = () => [];
function fakeBrowser({ secure = true, gum = true, ac = true, rec = false } = {}) {
  globalThis.window = { isSecureContext: secure };
  if (rec) window.SpeechRecognition = class {};
  if (ac) window.AudioContext = class {
    constructor() { this.sampleRate = 16000; this.state = ctxState; }
    resume() { return Promise.resolve(); }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createGain() { return { gain: {}, connect() {}, disconnect() {} }; }
    get destination() { return {}; }
    createScriptProcessor() {
      const node = { onaudioprocess: null, connect() {}, disconnect() { node.dead = true; } };
      const q = frames();
      const tick = () => { if (node.dead) return; const x = q.shift() ?? new Float32Array(1024); node.onaudioprocess?.({ inputBuffer: { getChannelData: () => x } }); setTimeout(tick, 50); };
      setTimeout(tick, 50);
      return node;
    }
  };
  Object.defineProperty(globalThis.navigator, "mediaDevices", { value: gum ? { getUserMedia: (c) => gumImpl(c) } : undefined, configurable: true });
  Object.defineProperty(globalThis.navigator, "onLine", { value: true, configurable: true });
}
const stream = () => ({ getTracks: () => [{ stop() {} }] });
const loud = (n) => Array.from({ length: n }, () => new Float32Array(1024).fill(0.3));
const hear = (opts = {}) => new Promise((resolve) => listen({ wait: true, onText: (t) => resolve({ text: t }), onFail: (msg, o) => resolve({ msg, ...o }), ...opts }));
const fresh = () => { _resetVoice(); delete globalThis.window; delete globalThis.fetch; ctxState = "running"; frames = () => []; gumImpl = () => Promise.resolve(stream()); };

test("whyCantListen names what this browser lacks; null when it can listen", () => {
  fresh();
  fakeBrowser({ gum: false });
  assert.equal(canListen(), false);
  assert.equal(whyCantListen(), MSG.noapi);
  fakeBrowser({ gum: true, ac: false });
  assert.equal(whyCantListen(), MSG.noaudio);
  fakeBrowser({ secure: false, gum: false });
  assert.equal(whyCantListen(), MSG.insecure);
  fakeBrowser();
  assert.equal(canListen(), true);
  assert.equal(whyCantListen(), null);
  fakeBrowser({ gum: false, rec: true }); // Safari on iPhone: its own recognizer is a way in
  assert.equal(whyCantListen(), null);
});

test("the microphone refused: a specific line, dead (wait for a tap), nothing latched; Try again forgets it", async () => {
  fresh();
  fakeBrowser();
  gumImpl = () => Promise.reject(new DOMException("busy", "NotReadableError"));
  const r = await hear();
  assert.equal(r.msg, MSG.micBusy);
  assert.equal(r.dead, true);
  assert.equal(canListen(), true, "a failure never takes the way in away");
  assert.equal(lastMicFail()?.name, "NotReadableError");
  assert.match(voiceStatus().fail, /NotReadableError/);
  retryVoiceIn();
  assert.equal(lastMicFail(), null);
  gumImpl = () => Promise.reject(new DOMException("no", "NotAllowedError"));
  assert.equal((await hear()).msg, MSG.blockedBar, "the hands-free bar's blocked line (how to allow it)");
  assert.equal((await hear({ wait: false })).msg, MSG.blocked, "Log visit's line");
  gumImpl = () => Promise.reject(new DOMException("none", "NotFoundError"));
  assert.equal((await hear()).msg, MSG.nomic);
  gumImpl = () => Promise.reject(Object.assign(new Error("odd"), { name: "WeirdError" }));
  assert.match((await hear()).msg, /^The microphone didn't start \(WeirdError\)/);
});

test("an AudioContext that never delivers a frame (iPhone WebKit outside a tap): 'paused audio' within 3 s, and the tap resumes it", async () => {
  fresh();
  fakeBrowser();
  frames = () => { throw new Error("no frames"); }; // the processor never runs
  window.AudioContext.prototype.createScriptProcessor = function () { return { connect() {}, disconnect() {} }; };
  const t0 = Date.now();
  const r = await hear();
  assert.equal(r.msg, MSG.audioStuck);
  assert.equal(r.dead, true);
  assert.ok(Date.now() - t0 < 3500, `${Date.now() - t0} ms`);
  assert.equal(lastMicFail()?.name, "AudioSuspended");
  unlockAudio(); // the next tap: the shared context is resumed, nothing throws without an <audio>
});

test("speech → the Worker: its words; off there (503) with no recognizer → 'off on this server'; the network → 'couldn't reach'", async () => {
  fresh();
  fakeBrowser();
  frames = () => loud(3); // 150 ms of speech, then quiet
  globalThis.fetch = async () => new Response(JSON.stringify({ text: " come back Thursday " }), { status: 200, headers: { "content-type": "application/json" } });
  const t0 = Date.now();
  assert.deepEqual(await hear(), { text: "come back Thursday" });
  assert.ok(Date.now() - t0 >= SILENCE_MS, "the quiet gap ends the recording");
  assert.equal(lastMicFail(), null);
  globalThis.fetch = async () => new Response(JSON.stringify({ error: "off" }), { status: 503, headers: { "content-type": "application/json" } });
  const off = await hear();
  assert.equal(off.msg, MSG.serverOff);
  assert.equal(off.dead, true);
  assert.equal(lastMicFail()?.name, "http 503");
  assert.equal(canListen(), true);
  globalThis.fetch = async () => { throw new TypeError("Failed to fetch"); };
  const net = await hear();
  assert.equal(net.msg, MSG.unreachable);
  assert.equal(net.dead, true);
  retryVoiceIn();
  assert.equal(voiceStatus().fail, null);
});

test("voiceStatus: one object for the ?voicedebug=1 line", () => {
  fresh();
  fakeBrowser({ gum: false });
  const v = voiceStatus();
  assert.equal(v.secure, true);
  assert.equal(v.gum, false);
  assert.equal(v.ac, true);
  assert.equal(v.rec, false);
  assert.equal(v.online, true);
  assert.equal(v.fail, null);
  assert.equal(typeof v.ua, "string");
});
