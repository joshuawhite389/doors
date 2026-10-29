// (Jard 10-23: "I don't like how we have to use the phone keyboard's microphone"): the phone's own
// tap-to-talk mic records a WAV on iOS and sends it to the Worker's /api/voice/listen, the web's server path. iOS's WAV
// carries extra chunks (JUNK / FLLR) the Worker's header read doesn't expect, so the phone rebuilds the plain header
// (public/lib/wav.js) first. No data: runs in the public repo too.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readWav, plainWav, wavSecs } from "../public/lib/wav.js";
import { handleVoice, _resetVoice, wavSeconds } from "../src/voice.js";
import { _resetAgent } from "../src/agent.js";

// a WAV as Core Audio writes one: RIFF, WAVE, then JUNK before fmt and FLLR before data (sizes as on the device)
function iosWav(secs, { rate = 16000, junk = 28, fllr = 4044, odd = false } = {}) {
  const n = Math.round(secs * rate) * 2;
  const chunks = [];
  const chunk = (id, body) => {
    const h = new Uint8Array(8 + body.length + (body.length & 1));
    [...id].forEach((c, i) => (h[i] = c.charCodeAt(0)));
    new DataView(h.buffer).setUint32(4, body.length, true);
    h.set(body, 8);
    chunks.push(h);
  };
  if (junk) chunk("JUNK", new Uint8Array(junk + (odd ? 1 : 0)));
  const fmt = new Uint8Array(16);
  const f = new DataView(fmt.buffer);
  f.setUint16(0, 1, true); f.setUint16(2, 1, true); f.setUint32(4, rate, true); f.setUint32(8, rate * 2, true); f.setUint16(12, 2, true); f.setUint16(14, 16, true);
  chunk("fmt ", fmt);
  if (fllr) chunk("FLLR", new Uint8Array(fllr));
  const data = new Uint8Array(n);
  for (let i = 0; i < n; i++) data[i] = (i * 7) & 0xff;
  chunk("data", data);
  const len = 4 + chunks.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(8 + len);
  [..."RIFF"].forEach((c, i) => (out[i] = c.charCodeAt(0)));
  new DataView(out.buffer).setUint32(4, len, true);
  [..."WAVE"].forEach((c, i) => (out[8 + i] = c.charCodeAt(0)));
  let o = 12;
  for (const c of chunks) out.set(c, o), (o += c.length);
  return { bytes: out, data };
}

test("an iOS WAV (JUNK before fmt, FLLR before data) reads as 16 kHz mono 16-bit with the right samples", () => {
  const { bytes, data } = iosWav(2);
  const w = readWav(bytes);
  assert.deepEqual([w.format, w.channels, w.rate, w.bits], [1, 1, 16000, 16]);
  assert.deepEqual(w.data, data);
  assert.equal(wavSecs(bytes), 2);
  // the Worker's own read of that file is wrong (why the phone fixes it): byte rate at 28 isn't where fmt is
  assert.notEqual(wavSeconds(bytes), 2);
});

test("plainWav: the 44-byte header the web writes, the same samples, and the Worker reads its length right", () => {
  for (const opts of [{}, { junk: 0 }, { fllr: 0 }, { junk: 0, fllr: 0 }, { odd: true }]) {
    const { bytes, data } = iosWav(3, opts);
    const p = plainWav(bytes);
    assert.equal(p.byteLength, 44 + data.length, JSON.stringify(opts));
    assert.equal(String.fromCharCode(...p.subarray(36, 40)), "data");
    assert.deepEqual(p.subarray(44), data);
    assert.ok(Math.abs(wavSeconds(p) - 3) < 1e-9, `${wavSeconds(p)} s`);
  }
});

test("plainWav: a recorder stopped mid-write (data size 0 or 0xFFFFFFFF) keeps the bytes that are there; not a WAV → null", () => {
  const { bytes, data } = iosWav(1);
  const at = bytes.byteLength - data.length - 4; // the data chunk's size field
  for (const bad of [0, 0xffffffff]) {
    const b = bytes.slice();
    new DataView(b.buffer).setUint32(at, bad, true);
    assert.equal(plainWav(b).byteLength, 44 + data.length);
  }
  assert.equal(plainWav(new TextEncoder().encode("ID3 not a wav at all, an mp3")), null);
  assert.equal(plainWav(new Uint8Array(0)), null);
  const { bytes: f } = iosWav(1);
  new DataView(f.buffer).setUint16(12 + 8 + 28 + 8 + 14, 32, true); // 32-bit: not what the Worker takes
  assert.equal(plainWav(f), null);
});

test("the Worker takes the phone's fixed WAV: Whisper gets its samples, the words come back", async () => {
  _resetVoice(); _resetAgent();
  const calls = [];
  const AI = { run: async (model, input) => (calls.push(input), { text: " Liked it, come back Thursday at 3. ", transcription_info: { duration: 4 } }) };
  const ORIGIN = "http://localhost:8792";
  const p = plainWav(iosWav(4).bytes);
  const r = await handleVoice(new Request(`${ORIGIN}/api/voice/listen`, { method: "POST", headers: { origin: ORIGIN, "content-type": "audio/wav" }, body: p }), { AI }, "/api/voice/listen");
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { text: "Liked it, come back Thursday at 3." });
  assert.equal(Buffer.from(calls[0].audio, "base64").length, p.byteLength);
});

test("the phone: a mic beside Send in the Agent box (words in to edit) and in the Done box (logged at once); none in the guided demo", () => {
  const chat = readFileSync(new URL("../app-mobile/src/components/ChatView.tsx", import.meta.url), "utf8");
  const drive = readFileSync(new URL("../app-mobile/src/screens/Drive.tsx", import.meta.url), "utf8");
  const mic = readFileSync(new URL("../app-mobile/src/mic.ts", import.meta.url), "utf8");
  assert.match(chat, /MIC && !chat\.offline \? <MicButton mic=\{mic\}/);
  assert.match(drive, /MIC && !e\.demo \? <MicButton mic=\{doneMic\} wide/);
  assert.match(drive, /const doneMic = useMic\(\(said\) => \{[^]*?submit\(\);/);
  assert.doesNotMatch(drive, /Tap the mic on the keyboard/);
  assert.match(mic, /workerFetch\("\/api\/voice\/listen", \{ method: "POST", headers: \{ "content-type": "audio\/wav" \}/);
  assert.match(mic, /outputFormat: IOSOutputFormat\.LINEARPCM/);
  assert.match(mic, /sampleRate: 16000,\s+numberOfChannels: 1/);
  // PARITY M1: a note on the Start my day door card, said (saved at once) or typed, with Undo; the web matches the words
  assert.match(drive, /idle="Tap and say a note" testID="note-mic"/);
  assert.match(drive, /const noteMic = useMic\(\(said\) => \{ addNote\(noteFor\.current, said\); \}\)/);
  assert.match(drive, /makeNote\(\{ text, by: "drive" \}\)/);
  assert.match(drive, /Note saved on \$\{/);
  assert.match(drive, /setUndo\(\{ before: null, note: \{ id: id!, nid: rec\.id \}, text: `Note saved on/); // Undo drops the note (no slots in a snapshot)
  assert.match(drive, /"Undone: that note is gone\."/);
  assert.match(drive, /"Or type a note"/);
  assert.doesNotMatch(drive, /autoFocus maxLength=\{400\}/); // the Done box no longer pops the keyboard over the mic
  const app = JSON.parse(readFileSync(new URL("../app-mobile/app.json", import.meta.url), "utf8"));
  const perm = app.expo.plugins.find((x) => x[0] === "expo-audio")[1].microphonePermission;
  assert.doesNotMatch(perm, /never records/);
  assert.match(perm, /tap its mic/);
});
