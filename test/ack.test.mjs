// The Agent's instant acknowledgement (lib/ack.js): the line fits what was said, never repeats back to back, and every
// line has its baked Aura-2 clip under public/audio/ack/.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { ACKS, ACK_IDS, ackIntent, pickAck, ackPath } from "../public/lib/ack.js";

test("intent: questions ask, edits change, how-it-went logs, the rest is generic", () => {
  assert.equal(ackIntent("tell me about my next stop"), "ask");
  assert.equal(ackIntent("what's the ask at the Drafting Room?"), "ask");
  assert.equal(ackIntent("skip this one"), "change");
  assert.equal(ackIntent("I'm running late by 20 minutes"), "change");
  assert.equal(ackIntent("they took two cases, the manager is Priya"), "log");
  assert.equal(ackIntent("no answer, closed"), "log");
  assert.equal(ackIntent("hello there"), "generic");
  assert.equal(ackIntent(""), "generic");
  assert.equal(ackIntent("should I skip this one?"), "ask"); // a question about a change is a question
});

test("the pick fits the intent and never repeats the last line", () => {
  const a = pickAck("tell me about my next stop", null, () => 0);
  assert.equal(a.intent, "ask");
  assert.equal(a.id, "ask-1");
  const b = pickAck("tell me about my next stop", "ask-1", () => 0);
  assert.notEqual(b.id, "ask-1");
  const c = pickAck("got it", "generic-1", () => 0.99);
  assert.equal(c.intent, "generic");
  assert.notEqual(c.id, "generic-1");
  for (const k of Object.keys(ACKS)) assert.ok(ACKS[k].length >= 2, `${k} has two lines to rotate`);
});

test("plain, short lines; every line has its clip", () => {
  for (const a of Object.values(ACKS).flat()) {
    assert.ok(a.text.length <= 40, a.text);
    assert.match(a.text, /[.]$/);
    assert.ok(fs.existsSync(new URL(`../public${ackPath(a.id)}`, import.meta.url)), `missing ${ackPath(a.id)}`);
  }
  assert.equal(new Set(ACK_IDS).size, ACK_IDS.length);
});

test("wavSlice: the hands-free ear sends only from where the rep spoke (a plain WAV, cut from fromSec)", async () => {
  const { wavSlice, wavSecs, readWav } = await import("../public/lib/wav.js");
  const { toWav } = await import("../public/ui/voice.js");
  // 3 s at 16 kHz: silence, then a tone from 2 s
  const rate = 16000;
  const chunk = new Float32Array(rate * 3);
  for (let i = rate * 2; i < chunk.length; i++) chunk[i] = Math.sin(i / 10) * 0.5;
  const wav = new Uint8Array(await toWav([chunk], rate).arrayBuffer());
  assert.equal(Math.round(wavSecs(wav)), 3);
  const cut = wavSlice(wav, 1.5);
  assert.equal(Math.round(wavSecs(cut) * 10) / 10, 1.5);
  const w = readWav(cut);
  assert.equal(w.rate, rate);
  assert.equal(cut.byteLength, 44 + w.data.byteLength);
  assert.equal(Math.max(...new Int16Array(cut.buffer.slice(44, 44 + 100))), 0, "the first cut samples are the tail of the silence");
  assert.ok(Math.max(...new Int16Array(cut.buffer.slice(44 + rate * 2 - 100))) > 10000, "the tone is kept");
  assert.equal(wavSlice(wav, 0), wav, "nothing to cut: the same bytes");
  assert.equal(wavSlice(wav, 99).byteLength, 44, "past the end: an empty clip");
});
