// Jard 10-29: after Doors spoke, the iPhone's lock screen and Control Center kept a "Your plan · Doors" Now Playing card
// (play / skip 10 s) like music. voice.js plays every line through one tap-unlocked <audio>; iPhone WebKit keeps a media
// element that played as the page's media session until it drops its source. So: when a clip ends or is stopped the
// element is emptied (pause, no src, load()) and navigator.mediaSession is cleared; the same element plays the next line
// (the tap unlock is the element's, so hands-free replay still needs no tap). No browser: <audio>, fetch and
// navigator.mediaSession are stubbed here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { say, ack, hush, unlockAudio, speaking, whenQuiet, audioUnlocked, _player, _resetVoice } from "../public/ui/voice.js";

// a minimal media element: play() "plays" the src (fires playing), end() fires ended as a real clip would
class FakeAudio extends EventTarget {
  constructor() { super(); this.attrs = new Map(); this.paused = true; this.ended = false; this.loads = 0; this.plays = []; }
  setAttribute(k, v) { this.attrs.set(k, String(v)); }
  getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
  hasAttribute(k) { return this.attrs.has(k); }
  removeAttribute(k) { this.attrs.delete(k); }
  get src() { return this.getAttribute("src") ?? ""; }
  set src(v) { this.setAttribute("src", v); this.ended = false; }
  load() { this.loads += 1; this.paused = true; this.ended = false; this.dispatchEvent(new Event("emptied")); }
  play() {
    if (!this.hasAttribute("src")) return Promise.reject(new DOMException("no source", "NotSupportedError"));
    this.plays.push(this.src); this.paused = false; this.ended = false;
    queueMicrotask(() => this.dispatchEvent(new Event("playing")));
    return Promise.resolve();
  }
  pause() { this.paused = true; }
  end() { this.paused = true; this.ended = true; this.dispatchEvent(new Event("ended")); }
}
// what WebKit/Chrome read for the card: the page's media session
let ms;
function fakeBrowser() {
  globalThis.Audio = FakeAudio;
  globalThis.document = {};
  ms = { metadata: { title: "Your plan · Doors" }, playbackState: "playing", handlers: new Map(), setActionHandler(a, h) { if (h) this.handlers.set(a, h); else this.handlers.delete(a); } };
  ms.setActionHandler("seekbackward", () => {});
  ms.setActionHandler("seekforward", () => {});
  Object.defineProperty(globalThis.navigator, "mediaSession", { value: ms, configurable: true });
  Object.defineProperty(globalThis.navigator, "audioSession", { value: { type: "auto", state: "inactive" }, configurable: true });
  Object.defineProperty(globalThis.navigator, "onLine", { value: true, configurable: true });
  globalThis.URL.createObjectURL = () => "blob:line-" + Math.random().toString(36).slice(2);
  globalThis.fetch = async () => new Response(new Blob([new Uint8Array(64)], { type: "audio/mpeg" }), { headers: { "content-type": "audio/mpeg", "x-doors-voice": "phoebe" } });
}
const fresh = () => { _resetVoice(); fakeBrowser(); };
const tick = () => new Promise((r) => setTimeout(r, 0));
const cleared = () => ms.metadata === null && ms.playbackState === "none" && ms.handlers.size === 0;

test("a line that plays to its end leaves no source on the element and an empty media session", async () => {
  fresh();
  assert.equal(await say("Next door is The Ivy, two minutes away."), true);
  const p = _player();
  assert.ok(p.hasAttribute("src"), "playing: the element has the line");
  assert.equal(speaking(), true);
  p.end();
  await tick();
  assert.equal(p.hasAttribute("src"), false, "after the end: no src (WebKit ends the page's media session)");
  assert.ok(p.loads >= 1, "load() ran so the browser drops the old resource");
  assert.ok(cleared(), "navigator.mediaSession: no title, state none, no skip handlers");
  assert.equal(speaking(), false);
  await whenQuiet(500);
});

test("Stop mid-line (hush) empties the element too", async () => {
  fresh();
  await say("Say it again test line.");
  const p = _player();
  hush();
  assert.equal(p.hasAttribute("src"), false);
  assert.equal(p.paused, true);
  assert.ok(cleared());
});

test("the same element plays the next line (hands-free replay keeps the tap unlock)", async () => {
  fresh();
  unlockAudio(); // the drive tap: a short silence on the one element
  const p = _player();
  await tick();
  assert.equal(audioUnlocked(), true);
  p.end(); // the 50 ms silence ends
  await tick();
  assert.equal(p.hasAttribute("src"), false, "the unlock silence leaves no card either");
  // later, with no tap: the ack clip, then the answer, on the SAME element
  const a = await ack("what's my next stop?");
  assert.equal(a.played, true);
  assert.equal(_player(), p);
  p.end();
  await tick();
  assert.equal(p.hasAttribute("src"), false);
  assert.equal(await say("Your next stop is Bar Nine."), true);
  assert.equal(_player(), p, "one element for every line: the one the tap unlocked");
  assert.equal(p.plays.length, 3, "silence, ack, answer");
  p.end();
  await tick();
  assert.equal(p.hasAttribute("src"), false);
  assert.ok(cleared());
});

test("a hush right after the drive tap doesn't cut the unlock silence short", async () => {
  fresh();
  unlockAudio();
  const p = _player();
  const loads = p.loads;
  hush(); // e.g. Read it to me: unlock, then say() hushes before its line
  assert.ok(p.hasAttribute("src"), "the silence keeps playing");
  assert.equal(p.loads, loads);
  p.end();
  await tick();
  assert.equal(p.hasAttribute("src"), false);
});

test("an ended event from an old clip doesn't empty a newer line already on the element", async () => {
  fresh();
  await say("First line.");
  const p = _player();
  await say("Second line."); // replaces the first before its ended event is handled
  p.dispatchEvent(new Event("ended")); // stale: the element is playing the second line (ended false)
  await tick();
  assert.ok(p.hasAttribute("src"), "the second line keeps playing");
  assert.equal(speaking(), true);
  p.end();
  await tick();
  assert.equal(p.hasAttribute("src"), false);
});

// The phone app (expo-audio 58): a player shows on the lock screen / Control Center (iOS MPNowPlayingInfoCenter) and as
// an Android media notification (its AudioControlsService) only after setActiveForLockScreen(true). Spoken lines never
// call it, and the app's config keeps background playback off.
test("app-mobile never puts a spoken line on the lock screen or in a media notification", async () => {
  const fs = await import("node:fs");
  const files = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = `${d}/${e.name}`; if (e.isDirectory()) { if (e.name !== "node_modules") walk(p); } else if (/\.(ts|tsx|js)$/.test(e.name)) files.push(p); } };
  walk(new URL("../app-mobile/src", import.meta.url).pathname);
  assert.ok(files.length > 5);
  for (const f of files) assert.doesNotMatch(fs.readFileSync(f, "utf8"), /setActiveForLockScreen\s*\(/, f);
  const app = JSON.parse(fs.readFileSync(new URL("../app-mobile/app.json", import.meta.url), "utf8"));
  const audio = app.expo.plugins.find((p) => Array.isArray(p) && p[0] === "expo-audio");
  assert.equal(audio?.[1]?.enableBackgroundPlayback, false);
});
