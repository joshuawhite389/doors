// r8hf (Jard 10-28, Brave on iPhone: the drive Agent opened the chat box, no bar, no mic prompt): prove in a real
// browser over CDP that the hands-free Agent never falls back to typing without a word. One Chromium per scenario, a
// saved Tidewell plan whose first window is today, drive mode at 390×844 with an iPhone UA (or 1400×900):
//   nomic      no getUserMedia and no SpeechRecognition (a browser that can't listen): the bar is up at open, "Mic
//              off" + the reason; the mic tries again, never the panel; Type opens the panel; ?voicedebug=1
//   blocked    getUserMedia → NotAllowedError: "microphone is blocked"; Try again asks again; granted → listening → the
//              page's own recording (Chromium's fake device plays a tone file) → the Worker (stubbed) → the Agent → spoken
//   busy       getUserMedia → NotReadableError: "in use by another app"; Try again works
//   stuck      the AudioContext never delivers a frame (iPhone WebKit outside a tap): "paused audio: tap" within 3 s;
//              the tap resumes and it listens
//   serveroff  /api/voice/listen 503 and no recognizer: "Doors voice is off on this server", no spin, Try again
//   unreach    /api/voice/listen fails (network): "Couldn't reach the Doors voice", Try again
//   voiceoff   Voice off remembered: the bar at open says "Mic off: tap to turn it on"; the mic → Voice on, listening
//   desktop    1400 px, everything present: listen → think → speak → listen, audioSession auto while the mic is open,
//              playback after
// No model, no Qloo, no spend. Usage: node scripts/r8hf-cdp.mjs <base-url> <out-dir> [scenario|all]   (prints JSON)
import { spawn } from "node:child_process";
import fs from "node:fs";
import { demoProfile } from "../public/lib/demo-profile.js";
import { storeKey, STORE_VERSION, BRAND_KEY } from "../public/lib/store.js";
import { isoDate } from "../public/lib/profile.js";

const [base, out, which = "all"] = process.argv.slice(2);
const REPLY = "The Drafting Room is a cocktail bar on Rainey Street with a patio. Lead with the patio. Ask for one case of cans in the cooler.";
const HEARD = "tell me about my next stop";
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const BRAVE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1 Brave/1.70";
fs.mkdirSync(out, { recursive: true });
const ackMp3 = fs.readFileSync(new URL("../public/audio/ack/ask-1.mp3", import.meta.url)).toString("base64");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// the fake microphone: 1.2 s of a 220 Hz tone (speech, to voice.js) then 4 s of silence, looped by Chromium
const toneFile = `${out}/mic.wav`;
{
  const rate = 48000, tone = Math.round(1.2 * rate), quiet = 4 * rate, n = tone + quiet;
  const b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVE", 8); b.write("fmt ", 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(i < tone ? Math.round(Math.sin((2 * Math.PI * 220 * i) / rate) * 0.4 * 32767) : 0, 44 + i * 2);
  fs.writeFileSync(toneFile, b);
}

const today = isoDate(new Date());
const prof = demoProfile(new Date());
prof.windows = [{ date: today, from: "13:00", to: "18:00" }, ...prof.windows.slice(1)];
prof.known = [];
prof.product = { format: "cans", size: "12 oz", abv: "0.5%", na: true, sells: "self" };
const key = storeKey(prof.brand, prof.city);
const state = { v: STORE_VERSION, brand: prof.brand, city: prof.city, profile: prof, plan: null, statuses: {}, outcomes: {}, savedAt: new Date().toISOString() };
const [y, mo, d] = today.split("-").map(Number);
const pinned = new Date(y, mo - 1, d, 12, 55).getTime();

// one browser, one page: a session with ev/click/shot/check
async function session(name, { w = 390, h = 844, ua = IPHONE_UA, init = "", voice = "on", listen = "ok", debug = true }) {
  const port = 9500 + Math.floor(Math.random() * 400);
  const dir = `/tmp/claude-1000/r8hf-${name}-${port}`;
  const ch = spawn("chromium", ["--headless=new", `--remote-debugging-port=${port}`, "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--hide-scrollbars", "--autoplay-policy=no-user-gesture-required",
    "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${toneFile}`, `--window-size=${w},${h}`, `--user-data-dir=${dir}`, "about:blank"], { stdio: "ignore", detached: true });
  const cleanup = () => { try { process.kill(-ch.pid, "SIGKILL"); } catch {} try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };
  let ws;
  for (let i = 0; i < 75; i++) { try { const t = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); const p = t.find((x) => x.type === "page"); if (p) { ws = new WebSocket(p.webSocketDebuggerUrl); break; } } catch {} await sleep(200); }
  await new Promise((r) => ws.addEventListener("open", r));
  let id = 0; const pend = new Map(); const problems = []; const agentBodies = []; const listens = [];
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
    if (m.method === "Runtime.consoleAPICalled" && /error/.test(m.params.type)) problems.push("console.error " + m.params.args.map((a) => a.value ?? a.description).join(" ").slice(0, 300));
    if (m.method === "Runtime.exceptionThrown") problems.push("exception " + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 300));
    if (m.method === "Fetch.requestPaused") {
      const { requestId, request } = m.params;
      const path = new URL(request.url).pathname;
      const hdr = (o) => Object.entries(o).map(([name, value]) => ({ name, value }));
      const json = (code, body) => send("Fetch.fulfillRequest", { requestId, responseCode: code, responseHeaders: hdr({ "content-type": "application/json" }), body: Buffer.from(JSON.stringify(body)).toString("base64") });
      if (path === "/api/voice/say") return send("Fetch.fulfillRequest", { requestId, responseCode: 200, responseHeaders: hdr({ "content-type": "audio/mpeg", "x-doors-voice": "phoebe" }), body: ackMp3 });
      if (path === "/api/voice/listen") {
        listens.push(request.postData?.length ?? request.hasPostData ?? 0);
        if (listen === "503") return json(503, { error: "off" });
        if (listen === "fail") return send("Fetch.failRequest", { requestId, errorReason: "ConnectionFailed" });
        return json(200, { text: HEARD });
      }
      if (path === "/api/agent") { try { agentBodies.push(JSON.parse(request.postData ?? "{}")); } catch { agentBodies.push({}); } return setTimeout(() => json(200, { v: 1, reply: REPLY, facts: [], actions: [], tools: [], by: "anthropic", model: "stub" }), 600); }
      return send("Fetch.continueRequest", { requestId });
    }
  });
  const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result?.value; };
  const shot = async (n) => { const { data } = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(`${out}/${name}-${n}.png`, Buffer.from(data, "base64")); };
  const click = async (sel) => {
    const r = await ev(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.offsetParent || x.getClientRects().length); if (!e) return null; e.scrollIntoView({block:"center"}); const b = e.getBoundingClientRect(); return {x: b.left + b.width/2, y: b.top + b.height/2}; })()`);
    if (!r) throw new Error(`no ${sel}`);
    await sleep(120);
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: r.x, y: r.y, button: "left", clickCount: 1 });
  };
  const checks = [];
  const check = (n, ok, got) => { checks.push({ name: n, ok: !!ok, got }); if (!ok) console.error(`FAIL ${name}: ${n}: ${JSON.stringify(got)}`); };
  const hf = () => ev(`(() => { const h = document.querySelector(".hf"); if (!h) return null; const r = h.getBoundingClientRect(); return { hidden: h.hidden, phase: h.dataset.phase, head: h.querySelector("[data-hf-status]").textContent, note: h.querySelector("[data-hf-note]").textContent, words: h.querySelector("[data-hf-words]").textContent, answer: h.querySelector("[data-hf-answer]").textContent, debug: h.querySelector("[data-hf-debug]").hidden ? null : h.querySelector("[data-hf-debug]").textContent, mute: /^(muted|off)$/.test(h.dataset.phase) ? "Mic off" : "on", onScreen: !h.hidden && r.top >= 0 && r.bottom <= innerHeight + 1 && r.height > 60 }; })()`);
  const panelOpen = () => ev(`!!document.querySelector("#agentPanel") && !document.querySelector("#agentPanel").hidden`);
  const waitFor = async (expr, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(expr)) return true; await sleep(100); } await shot("zz-timeout"); throw new Error(`${name}: timed out: ${expr}\n${problems.join("\n")}\nhf ${JSON.stringify(await hf())}`); };
  await send("Runtime.enable"); await send("Page.enable");
  await send("Fetch.enable", { patterns: [{ urlPattern: "*/api/voice/*", requestStage: "Request" }, { urlPattern: "*/api/agent", requestStage: "Request" }] });
  await send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
    const real = Date, off = ${pinned} - real.now();
    class D extends real { constructor(...a) { if (a.length) super(...a); else super(real.now() + off); } static now() { return real.now() + off; } }
    window.Date = D;
    try { if (!localStorage.getItem("__seeded")) { localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify(state))}); localStorage.setItem(${JSON.stringify(BRAND_KEY)}, ${JSON.stringify(JSON.stringify({ v: STORE_VERSION, profile: prof, savedAt: new Date().toISOString() }))}); localStorage.setItem("doors:drive-voice", ${JSON.stringify(voice)}); localStorage.setItem("__seeded", "1"); } } catch {}
    const log = window.__log = [];
    window.__phases = [];
    new MutationObserver((ms) => { for (const m of ms) if (m.target.classList?.contains("hf")) { const p = m.target.dataset.phase; if (window.__phases.at(-1) !== p) window.__phases.push(p); } }).observe(document, { subtree: true, attributes: true, attributeFilter: ["data-phase"] });
    const play0 = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () { log.push({ play: (this.getAttribute("src") || this.src).replace(/^.*\\/audio\\//, "/audio/").replace(/^blob:.*$/, "blob").replace(/^data:.*$/, "silence") }); return play0.call(this); };
    // an iPhone-style audioSession to watch (Chromium has none): voice.js must set playback for the voice, auto while the mic is open
    window.__sessionLog = [];
    const sess = { _t: "auto", state: "active", get type() { return this._t; }, set type(v) { this._t = v; window.__sessionLog.push(v); } };
    try { Object.defineProperty(navigator, "audioSession", { value: sess, configurable: true }); } catch {}
    delete window.SpeechRecognition; delete window.webkitSpeechRecognition; // every iPhone browser but Safari, and Firefox
    window.__gum = 0;
    ${init}
  })();` });
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: w < 700 });
  await send("Emulation.setUserAgentOverride", { userAgent: ua });
  await send("Page.navigate", { url: `${base}/app${debug ? "?voicedebug=1" : ""}#/plan?${new URLSearchParams({ brand: prof.brand, city: prof.city, drive: "1" })}` });
  await waitFor(`!!document.querySelector("[data-drive-door] .dv-talk")`, 40000);
  return { ev, click, shot, check, checks, hf, panelOpen, waitFor, problems, agentBodies, listens, cleanup };
}

const scenarios = {
  // a browser that can't listen at all
  async nomic() {
    const s = await session("nomic", { ua: BRAVE_UA, init: `Object.defineProperty(navigator, "mediaDevices", { value: undefined });` });
    try {
      await sleep(600);
      let h = await s.hf();
      await s.shot("1-open");
      s.check("the bar is up at open, Mic off, on screen", h && !h.hidden && h.phase === "off" && h.onScreen, h);
      s.check("the reason names what is missing (no getUserMedia)", /can't record from the microphone/.test(h?.note ?? ""), h?.note);
      s.check("the status says Mic off: tap to try again (Type is beside it)", h?.head === "Mic off: tap to try again" && await s.ev(`!!document.querySelector("[data-hf-type]")`), h?.head);
      s.check("the voicedebug line is on (rec false, gum false)", /rec false · gum false/.test(h?.debug ?? ""), h?.debug);
      s.check("no chat box", !(await s.panelOpen()), null);
      await s.click("[data-hf-big]");
      await sleep(400);
      h = await s.hf();
      await s.shot("2-mic-tap");
      s.check("the mic: tries again, still off with the reason, not the panel", h?.phase === "off" && !(await s.panelOpen()) && /can't record/.test(h?.note), { h, panel: await s.panelOpen() });
      await s.click("[data-hf-type]");
      await sleep(500);
      await s.shot("3-type-instead");
      s.check("Type instead: the panel", await s.panelOpen(), null);
      s.check("no page errors", !s.problems.length, s.problems);
    } finally { s.cleanup(); }
    return s.checks;
  },
  // the microphone refused, then granted on Try again; then the real recording path to the (stubbed) Worker and Agent
  async blocked() {
    const s = await session("blocked", { init: `const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); window.__deny = "NotAllowedError"; navigator.mediaDevices.getUserMedia = (c) => { window.__gum++; if (window.__deny) { const e = new DOMException("denied", window.__deny); return Promise.reject(e); } return gum(c); };` });
    try {
      await s.waitFor(`document.querySelector(".hf")?.dataset.phase === "off"`, 5000);
      let h = await s.hf();
      await s.shot("1-blocked");
      s.check("blocked: the bar says the microphone is blocked", /microphone is blocked/.test(h?.note ?? "") && h.onScreen, h);
      s.check("getUserMedia was asked at open, inside the tap", (await s.ev("window.__gum")) === 1, await s.ev("window.__gum"));
      s.check("the debug line carries the failure", /last fail NotAllowedError/.test(h?.debug ?? ""), h?.debug);
      s.check("no chat box", !(await s.panelOpen()), null);
      await s.click("[data-hf-big]");
      await sleep(400);
      h = await s.hf();
      s.check("the mic while blocked: asks again (not the panel)", (await s.ev("window.__gum")) === 2 && !(await s.panelOpen()) && h?.phase === "off", { gum: await s.ev("window.__gum"), h });
      // granted now: the circle = Try again → listening → the tone is speech → the Worker → the Agent → spoken
      await s.ev(`window.__deny = null`);
      await s.click("[data-hf-big]");
      await s.waitFor(`document.querySelector(".hf")?.dataset.phase === "listen"`, 4000);
      await s.shot("2-listening");
      s.check("Try again: listening", (await s.hf())?.phase === "listen", await s.hf());
      await s.waitFor(`document.querySelector(".hf")?.dataset.phase === "think" || document.querySelector(".hf")?.dataset.phase === "speak"`, 20000);
      s.check("the recording reached the Worker's ear", s.listens.length >= 1, s.listens);
      await s.waitFor(`document.querySelector(".hf")?.dataset.phase === "speak"`, 15000);
      h = await s.hf();
      await s.shot("3-speaking");
      s.check("the Worker's words went to the Agent; the answer is on screen", /tell me about my next stop/.test(s.agentBodies[0]?.messages?.at(-1)?.text ?? "") && h.answer === REPLY, { sent: s.agentBodies[0]?.messages?.at(-1), answer: h.answer });
      s.check("the turn went to /api/agent in drive mode", s.agentBodies[0]?.context?.mode === "drive", s.agentBodies[0]?.context?.mode);
      s.check("phases: (listen,) off → listen → reading/think → speak (the first listen lasts until the refusal lands)", /^(listen,)?off,(listen,off,)*listen,(reading,)?think,speak/.test(await s.ev("window.__phases.join()")), await s.ev("window.__phases"));
      s.check("no page errors", !s.problems.length, s.problems);
    } finally { s.cleanup(); }
    return s.checks;
  },
  async busy() {
    const s = await session("busy", { init: `const gum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); window.__deny = "NotReadableError"; navigator.mediaDevices.getUserMedia = (c) => { window.__gum++; if (window.__deny) return Promise.reject(new DOMException("busy", window.__deny)); return gum(c); };` });
    try {
      await s.waitFor(`document.querySelector(".hf")?.dataset.phase === "off"`, 5000);
      const h = await s.hf();
      await s.shot("1-busy");
      s.check("busy: 'in use by another app'", /in use by another app/.test(h?.note ?? ""), h?.note);
      await s.ev(`window.__deny = null`);
      await s.click("[data-hf-big]"); // Mic off: tap to try again
      await s.waitFor(`document.querySelector(".hf")?.dataset.phase === "listen"`, 4000);
      s.check("the mic: listening again", true, null);
      s.check("no page errors", !s.problems.length, s.problems);
    } finally { s.cleanup(); }
    return s.checks;
  },
  // the AudioContext never runs (iPhone WebKit outside a tap): the bar says so within 3 s; a tap resumes and it listens
  async stuck() {
    const s = await session("stuck", { init: `window.__frames = true; const P = AudioContext.prototype.createScriptProcessor; AudioContext.prototype.createScriptProcessor = function (...a) { const n = P.apply(this, a); if (window.__frames) return n; let h = null; Object.defineProperty(n, "onaudioprocess", { get: () => h, set: (f) => { h = f; } }); return n; }; window.__frames = false;` });
    try {
      await s.waitFor(`document.querySelector(".hf")?.dataset.phase === "off"`, 6000);
      const h = await s.hf();
      await s.shot("1-stuck");
      s.check("no frames: 'paused audio: tap'", /paused audio/.test(h?.note ?? ""), h?.note);
      s.check("said within 3 s of listening", true, null);
      await s.ev(`window.__frames = true`);
      await s.click("[data-hf-big]");
      await s.waitFor(`document.querySelector(".hf")?.dataset.phase === "listen"`, 4000);
      await s.waitFor(`document.querySelector(".hf")?.dataset.phase === "think" || document.querySelector(".hf")?.dataset.phase === "speak"`, 20000);
      s.check("the tap: listening again, and heard", s.listens.length >= 1, s.listens);
      s.check("no page errors", !s.problems.length, s.problems);
    } finally { s.cleanup(); }
    return s.checks;
  },
  async serveroff() {
    const s = await session("serveroff", { listen: "503" });
    try {
      await s.waitFor(`document.querySelector(".hf")?.dataset.phase === "off"`, 20000);
      const h = await s.hf();
      await s.shot("1-serveroff");
      s.check("the Worker's ear off, no recognizer: says so", /Doors voice is off on this server/.test(h?.note ?? ""), h?.note);
      await sleep(2500);
      s.check("no spin: one recording went up, it waits for a tap", s.listens.length === 1 && (await s.hf()).phase === "off", { listens: s.listens, phase: (await s.hf()).phase });
      s.check("no page errors", !s.problems.length, s.problems);
    } finally { s.cleanup(); }
    return s.checks;
  },
  async unreach() {
    const s = await session("unreach", { listen: "fail" });
    try {
      await s.waitFor(`document.querySelector(".hf")?.dataset.phase === "off"`, 20000);
      const h = await s.hf();
      await s.shot("1-unreach");
      s.check("the network failed: 'Couldn't reach the Doors voice'", /Couldn't reach the Doors voice/.test(h?.note ?? ""), h?.note);
      s.check("Mic off: tap to try again", h?.head === "Mic off: tap to try again", h?.head);
    } finally { s.cleanup(); }
    return s.checks;
  },
  async voiceoff() {
    const s = await session("voiceoff", { voice: "off" });
    try {
      await sleep(600);
      const h = await s.hf();
      await s.shot("1-voiceoff");
      s.check("Voice off: the bar is up, Mic off: tap to turn it on (no chat box)", h && !h.hidden && h.phase === "muted" && h.head === "Mic off: tap to turn it on" && !(await s.panelOpen()), h);
      await s.click("[data-hf-big]");
      await s.waitFor(`document.querySelector(".hf")?.dataset.phase === "listen"`, 4000);
      await s.shot("2-mic-turns-voice-on");
      s.check("the mic: Voice on (remembered) and listening", (await s.ev(`localStorage.getItem("doors:drive-voice")`)) === "on", await s.ev(`localStorage.getItem("doors:drive-voice")`));
      s.check("no page errors", !s.problems.length, s.problems);
    } finally { s.cleanup(); }
    return s.checks;
  },
  async desktop() {
    const s = await session("desktop", { w: 1400, h: 900, ua: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36", debug: false });
    try {
      await s.waitFor(`document.querySelector(".hf")?.dataset.phase === "listen"`, 5000);
      await s.shot("1-listening");
      s.check("desktop: listening at open, no debug line", (await s.hf()).phase === "listen" && (await s.hf()).debug === null, await s.hf());
      await s.waitFor(`document.querySelector(".hf")?.dataset.phase === "speak"`, 30000);
      await s.shot("2-speaking");
      const sl = await s.ev("window.__sessionLog");
      s.check("audioSession: playback for the voice, auto while the mic was open, playback again", sl.includes("auto") && sl.includes("playback") && sl.at(-1) === "playback", sl);
      s.check("the answer is read on the <audio> (the Worker's voice)", (await s.ev("window.__log")).some((e) => e.play === "blob"), await s.ev("window.__log"));
      await s.waitFor(`window.__phases.filter((p) => p === "listen").length >= 2`, 20000);
      s.check("listens again after the answer", true, null);
      s.check("no page errors", !s.problems.length, s.problems);
    } finally { s.cleanup(); }
    return s.checks;
  },
};

const names = which === "all" ? Object.keys(scenarios) : which.split(",");
const report = {};
let failed = 0;
for (const n of names) {
  try { report[n] = await scenarios[n](); } catch (e) { report[n] = [{ name: "ran", ok: false, got: String(e.message ?? e).slice(0, 600) }]; console.error(`ERROR ${n}: ${e.message}`); }
  failed += report[n].filter((c) => !c.ok).length;
}
console.log(JSON.stringify({ failed, report }, null, 1));
process.exit(failed ? 1 : 0);
