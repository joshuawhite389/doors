// Prove web drive mode's voice and Skip in a real browser over CDP (in Brave on Linux
// "Tap and say how it went", "Read it to me" and "Skip for now" did nothing). A saved Tidewell plan whose first window
// is today (the page's clock pinned to 12:55 pm), drive mode, a fake microphone playing a WAV file, then per scenario:
//   brave    the browser's recognizer errs "network" at once and it has no voices (Brave on Linux) → the Worker
//   firefox  no SpeechRecognition at all, no voices → the Worker
//   chrome   the browser's recognizer and voice work → no Worker call
//   dead     as brave, and the Worker's voice is off (503) → a plain line, the dead buttons go
//   native   nothing stubbed in the page: the browser's own speech as it is (run it with brave or chromium)
// Each: Read it to me → Done → said → read back (spoken?) → Save → Done again (straight to what worked) → Skip for now
// (every door kept, the skipped one last) → Voice off → a tapped answer is not spoken; chrome also logs to the last
// door (no Skip there, as on the phone). /api/voice/* is answered by a stub (mode stub: a fixed transcript and a short
// MP3) or by the server itself (mode live: run the dev server with WORKERS_AI=1). Screenshots every step; prints a JSON
// report, exit 1 on a failed check.
// Usage: node scripts/webdrive-cdp.mjs <base-url> <out-dir> <scenario> [stub|live] [width] [height] [browser]
//   env FAKE_MIC=<wav> (required: what the microphone "hears"), STUB_MP3=<mp3> (stub mode), SAY=<the stub transcript>
import { spawn } from "node:child_process";
import fs from "node:fs";
import { demoProfile } from "../public/lib/demo-profile.js";
import { storeKey } from "../public/lib/store.js";
import { isoDate } from "../public/lib/profile.js";

const [base, out, scenario = "brave", mode = "stub", w = "1400", h = "900", browser = "chromium"] = process.argv.slice(2);
const SAY = process.env.SAY ?? "interested, come back Thursday at 3";
const NOTE = "the manager is Priya, back Thursdays"; // the note the mic hears (stub and chrome)
const TYPED = "Ask for the taproom manager";
const ASK = "what should I say at the next door";
let stubSay = SAY; // what the stub Worker's Whisper returns
const exact = mode === "stub" || scenario === "chrome"; // live Whisper on the fake mic: whatever the file says
if (!process.env.FAKE_MIC) throw new Error("FAKE_MIC=<wav> is required");
fs.mkdirSync(out, { recursive: true });
const port = 9400 + Math.floor(Math.random() * 400);
const dir = `/tmp/claude-1000/webdrive-${port}`;
const ch = spawn(browser, ["--headless=new", `--remote-debugging-port=${port}`, "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--hide-scrollbars", "--autoplay-policy=no-user-gesture-required",
  "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${process.env.FAKE_MIC}`, `--window-size=${w},${h}`, `--user-data-dir=${dir}`, "about:blank"], { stdio: "ignore", detached: true });
const cleanup = () => { try { process.kill(-ch.pid, "SIGKILL"); } catch {} try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };
process.on("exit", cleanup);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(1));
process.on("uncaughtException", (e) => { console.error(e); process.exit(1); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 75; i++) { try { const t = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); const p = t.find((x) => x.type === "page"); if (p) { ws = new WebSocket(p.webSocketDebuggerUrl); break; } } catch {} await sleep(200); }
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pend = new Map(); const problems = []; const served = [];
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const mp3 = mode === "stub" ? fs.readFileSync(process.env.STUB_MP3).toString("base64") : null;
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
  if (m.method === "Runtime.consoleAPICalled" && /error/.test(m.params.type)) problems.push("console.error " + m.params.args.map((a) => a.value ?? a.description).join(" ").slice(0, 300));
  if (m.method === "Runtime.exceptionThrown") problems.push("exception " + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 300));
  if (m.method === "Fetch.requestPaused") {
    const { requestId, request } = m.params;
    const path = new URL(request.url).pathname;
    served.push(path);
    const hdr = (o) => Object.entries(o).map(([name, value]) => ({ name, value }));
    if (scenario === "dead") return send("Fetch.fulfillRequest", { requestId, responseCode: 503, responseHeaders: hdr({ "content-type": "application/json" }), body: Buffer.from(JSON.stringify({ error: "off", reason: "spent" })).toString("base64") });
    if (path === "/api/voice/listen") return send("Fetch.fulfillRequest", { requestId, responseCode: 200, responseHeaders: hdr({ "content-type": "application/json" }), body: Buffer.from(JSON.stringify({ text: stubSay })).toString("base64") });
    return send("Fetch.fulfillRequest", { requestId, responseCode: 200, responseHeaders: hdr({ "content-type": "audio/mpeg" }), body: mp3 });
  }
});
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result?.value; };
const shot = async (name) => { const { data } = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(`${out}/${scenario}-${name}.png`, Buffer.from(data, "base64")); };
const click = async (sel) => {
  const r = await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({block:"center"}); const b = e.getBoundingClientRect(); return {x: b.left + b.width/2, y: b.top + b.height/2}; })()`);
  if (!r) throw new Error(`no ${sel}`);
  await sleep(150);
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: r.x, y: r.y, button: "left", clickCount: 1 });
};
const waitFor = async (expr, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(expr)) return true; await sleep(150); } await shot("zz-timeout"); throw new Error(`timed out: ${expr}\n${problems.join("\n")}\n${await ev(`document.querySelector("#drive")?.innerText.slice(0, 600)`)}\nsheet ${await ev(`document.querySelector("[data-drive-sheet]")?.innerText.slice(0, 900) ?? "none"`)}\nlog ${JSON.stringify(await ev("window.__log"))}`); };
const checks = [];
const check = (name, ok, got) => { checks.push({ name, ok: !!ok, got }); if (!ok) console.error(`FAIL ${scenario}: ${name}: ${JSON.stringify(got)}`); };

// today 1–6 pm, the demo's later windows after it; the page's clock pinned to today 12:55 pm
const today = isoDate(new Date());
const prof = demoProfile(new Date());
prof.windows = [{ date: today, from: "13:00", to: "18:00" }, ...prof.windows.slice(1)];
prof.known = [];
const key = storeKey(prof.brand, prof.city);
const state = { v: 1, brand: prof.brand, city: prof.city, profile: prof, plan: null, statuses: {}, outcomes: {}, savedAt: new Date().toISOString() };
const [y, mo, d] = today.split("-").map(Number);
const pinned = new Date(y, mo - 1, d, 12, 55).getTime();
await send("Runtime.enable"); await send("Page.enable");
if (mode === "stub") await send("Fetch.enable", { patterns: [{ urlPattern: "*/api/voice/*", requestStage: "Request" }] });
await send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
  const real = Date, off = ${pinned} - real.now();
  class D extends real { constructor(...a) { if (a.length) super(...a); else super(real.now() + off); } static now() { return real.now() + off; } }
  window.Date = D;
  try { if (!localStorage.getItem("__seeded")) { localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify(state))}); localStorage.setItem("__seeded", "1"); } } catch {}
  const log = window.__log = [];
  const sc = ${JSON.stringify(scenario)};
  // what the page asks of the Worker, and what it plays
  const f = window.fetch;
  window.fetch = async (u, o) => { const p = String(u?.url ?? u); if (p.includes("/api/voice/")) log.push({ fetch: p.replace(/^.*\\/api/, "/api"), bytes: o?.body?.size ?? o?.body?.length ?? 0, wav: o?.body instanceof Blob ? String.fromCharCode(...new Uint8Array(await o.body.slice(0, 12).arrayBuffer())).replace(/[^A-Z]/g, "") : null }); return f(u, o); };
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () { const e = { play: this.src.slice(0, 5) }; log.push(e); return play.call(this).then((r) => { e.ok = true; return r; }, (x) => { e.ok = false; e.err = String(x); throw x; }); };
  if (sc === "native") return;
  // the browser's speech, by scenario
  if (sc === "firefox") { delete window.SpeechRecognition; delete window.webkitSpeechRecognition; window.SpeechRecognition = undefined; window.webkitSpeechRecognition = undefined; }
  else if (sc === "chrome") {
    class Rec { constructor() { log.push({ rec: "new" }); } start() { setTimeout(() => { const t = window.__say || ""; this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: t }], { isFinal: true })] }); this.onend?.(); }, 300); } stop() {} }
    window.SpeechRecognition = Rec; window.webkitSpeechRecognition = Rec;
  } else {
    // Brave on Linux: the recognizer exists, its service is off: "network" at once, then end
    class Rec { constructor() { log.push({ rec: "new" }); } start() { setTimeout(() => { log.push({ rec: "network" }); this.onerror?.({ error: "network" }); this.onend?.(); }, 50); } stop() {} }
    window.SpeechRecognition = undefined; window.webkitSpeechRecognition = Rec;
  }
  if (window.speechSynthesis) {
    if (sc === "chrome") {
      speechSynthesis.getVoices = () => [{ name: "Test", lang: "en-US", localService: true }];
      speechSynthesis.speak = (u) => { log.push({ speak: u.text.slice(0, 60) }); setTimeout(() => u.onstart?.(), 20); };
    } else {
      speechSynthesis.getVoices = () => []; // no speech-dispatcher: no voices, and speak() would say nothing
      speechSynthesis.speak = (u) => log.push({ silentSpeak: u.text.slice(0, 40) });
    }
    speechSynthesis.cancel = () => {};
  }
})();` });
await send("Emulation.setDeviceMetricsOverride", { width: +w, height: +h, deviceScaleFactor: 1, mobile: +w < 700 });
await send("Page.navigate", { url: `${base}/app#/plan?${new URLSearchParams({ brand: prof.brand, city: prof.city, drive: "1" })}` });
await waitFor(`!!document.querySelector("[data-drive-door] .dv-talk")`, 40000);
const L = () => ev("window.__log");
const n = async (k, v) => (await L()).filter((e) => (v === undefined ? k in e : e[k] === v)).length;
const doorIds = () => ev(`(() => { const p = JSON.parse(localStorage.getItem(${JSON.stringify(key)})); const d = (p.plan?.days ?? []).find((x) => x?.date === ${JSON.stringify(today)}); return d ? d.stops.map((s) => s.id) : []; })()`);
const cur = () => ev(`document.querySelector("[data-drive-door]")?.dataset.id ?? null`);
const progress = () => ev(`document.querySelector(".dv-day span")?.textContent ?? ""`);
const report = { scenario, mode, browser, width: +w };
await shot("01-door");
const serverOut = scenario === "brave" || scenario === "firefox"; // the browser can't hear: the Worker's Whisper
const browserWorks = scenario === "chrome";
const auraOut = serverOut || browserWorks; // read-alouds: the Worker's Aura voice first in every browser (PARITY S15), as the phone

// 1. Read it to me
await click("[data-drive-read]");
if (scenario === "dead") {
  await waitFor(`/Read-aloud isn't available/.test(document.querySelector(".dv-toast")?.textContent ?? "")`);
  check("dead: read-aloud says it isn't available", true, await ev(`document.querySelector(".dv-toast").textContent`));
  check("dead: Read it to me is gone", !(await ev(`!!document.querySelector("[data-drive-read]")`)), null);
} else if (auraOut) {
  await waitFor(`window.__log.some((e) => e.play && e.ok !== undefined)`);
  const p = (await L()).find((e) => e.play);
  check("read it to me: the Worker's voice played first", p.ok === true && p.play === "blob:", p);
  if (browserWorks) check("chrome: the browser's own voice not used while the Worker's works", !(await L()).some((e) => e.speak), (await L()).filter((e) => e.speak));
}
if (scenario === "native") { await sleep(4000); report.nativeRead = await L(); }
await shot("02-read");

// 2. Done → say it
await ev(`window.__say = ${JSON.stringify(SAY)}`);
const first = await cur();
const t0Done = Date.now() + 300;
await click("[data-drive-done]");
await sleep(300);
await shot("03-listening");
if (scenario === "dead") {
  await waitFor(`/Voice isn't available/.test(document.querySelector(".dv-err")?.textContent ?? "")`, 35000); // the recording can run its full 20 s first
  check("dead: the sheet says voice isn't available (not 'didn't catch that')", true, await ev(`document.querySelector(".dv-err").textContent`));
  check("dead: the mic button is gone", !(await ev(`!!document.querySelector("[data-drive-mic]")`)), null);
  check("dead: the label asks to type", /park first/.test(await ev(`document.querySelector("label[for=drive-text]").textContent`)), null);
  await shot("04-dead");
  await click("[data-drive-quick=interested]");
} else if (scenario === "native") {
  await waitFor(`!!document.querySelector("[data-drive-readback]") || !!document.querySelector(".dv-err")`, 20000).catch(() => {});
  report.nativeMs = Date.now() - t0Done;
  report.nativeListen = { log: await L(), sheet: await ev(`document.querySelector("[data-drive-sheet]")?.innerText`) };
  await shot("04-native");
  report.checks = checks; report.problems = problems; report.served = served;
  console.log(JSON.stringify(report, null, 1));
  process.exit(0);
}
await waitFor(`!!document.querySelector("[data-drive-readback]")`, 30000);
const rb = await ev(`document.querySelector("[data-drive-readback]").textContent`);
await shot("04-readback");
if (scenario !== "dead") {
  check("said → read back (follow-up Thursday)", /Thu/i.test(rb) && /interested/i.test(rb), rb);
  check("the recognizer path", serverOut ? (await L()).some((e) => e.fetch === "/api/voice/listen" && e.wav === "RIFFWAVE" && e.bytes > 44) : !(await L()).some((e) => e.fetch === "/api/voice/listen"), (await L()).filter((e) => e.fetch));
}
if (scenario === "brave") check("brave: tried the browser's recognizer once, then the Worker", (await n("rec", "network")) === 1, await L());
await sleep(1500);
const spokenRb = auraOut ? (await L()).filter((e) => e.play).length >= 2 : true;
check("the read-back is spoken (as the phone)", spokenRb, (await L()).filter((e) => e.play || e.speak));
if (serverOut || browserWorks) {
  await click("[data-drive-repeat]");
  await sleep(800);
  check("Say it again speaks the read-back again", (await L()).filter((e) => e.play).length >= 3, null);
}
await click("[data-drive-save]");
await waitFor(`document.querySelector("[data-drive-door]")?.dataset.id !== ${JSON.stringify(first)}`);
await shot("05-next");

// 3. Done again: straight to what worked
if (scenario !== "dead") {
  const recs = await n("rec");
  const posts = (await L()).filter((e) => e.fetch === "/api/voice/listen").length;
  await click("[data-drive-done]");
  await waitFor(`!!document.querySelector("[data-drive-readback]")`, 30000);
  if (scenario === "brave") check("brave: the 2nd Done goes straight to the Worker (no 2nd recognizer)", (await n("rec")) === recs && (await L()).filter((e) => e.fetch === "/api/voice/listen").length === posts + 1, await L());
  if (browserWorks) check("chrome: the 2nd Done uses the browser again, no Worker", (await n("rec")) === recs + 1 && posts === 0, await L());
  await click("[data-drive-cancel]");
} else {
  await click("[data-drive-done]");
  await sleep(500);
  check("dead: the 2nd Done opens straight to taps and typing", !(await ev(`!!document.querySelector("[data-drive-mic]")`)) && (await ev(`!!document.querySelector("#drive-text")`)), null);
  await click("[data-drive-cancel]");
}

// 4. Skip for now: every door kept, the skipped one last
const ids0 = await doorIds();
const p0 = await progress();
const skipped = await cur();
await click("[data-drive-skip]");
await waitFor(`document.querySelector("[data-drive-door]")?.dataset.id !== ${JSON.stringify(skipped)}`);
await sleep(500);
const ids1 = await doorIds();
check("skip: the same doors today", ids1.length === ids0.length && ids0.every((x) => ids1.includes(x)), { before: ids0.length, after: ids1.length });
check("skip: the skipped door is last", ids1[ids1.length - 1] === skipped, ids1.map((x) => x.slice(0, 4)));
check("skip: the progress count is unchanged", (await progress()) === p0, [p0, await progress()]);
report.skipToast = await ev(`document.querySelector(".dv-toast")?.textContent`);
await shot("06-skipped");

// 4b. the phone's Day list: every door; one opens as "not your current door", without Skip; back to the current one
const curNow = await cur();
await click("[data-drive-screen=day]");
await waitFor(`!!document.querySelector("[data-drive-daylist]")`);
check("day list: one row per door", (await ev(`document.querySelectorAll("[data-drive-open]").length`)) === ids1.length, await ev(`document.querySelectorAll("[data-drive-open]").length`));
await shot("06b-day");
const later = ids1.find((x, i) => i > 0 && x !== curNow);
await click(`[data-drive-open="${later}"]`);
await waitFor(`!!document.querySelector("[data-drive-viewed]")`);
check("a viewed door: the banner, no Skip, its own id", (await cur()) === later && (await ev(`!!document.querySelector("[data-drive-back]") && !document.querySelector("[data-drive-skip]")`)), await cur());
await shot("06c-viewed");
await click("[data-drive-back]");
await waitFor(`document.querySelector("[data-drive-door]")?.dataset.id === ${JSON.stringify(curNow)}`);

// 5. Voice off: a tapped answer is not spoken
await click("[data-drive-voice]");
const before = (await L()).filter((e) => e.play || e.speak).length;
await shot("06d-voice-off");
await ev(`window.__say = ""`); // chrome's recognizer hears nothing this time: the taps it is
await click("[data-drive-done]");
await sleep(300);
await shot("06e-done");
await click("[data-drive-cancel]").catch(() => {});
await click("[data-drive-done]").catch(() => {});
await waitFor(`!!document.querySelector("[data-drive-quick=interested]")`);
await click("[data-drive-quick=interested]");
await waitFor(`!!document.querySelector("[data-drive-readback]")`);
await sleep(800);
check("voice off: the read-back is not spoken", (await L()).filter((e) => e.play || e.speak).length === before, null);
await shot("07-voice-off");
await click("[data-drive-save]");
await sleep(600);
await click("[data-drive-voice]"); // back on for the next run (remembered on the device)

// 6a. a note on the door (PARITY M1): said → saved at once with Undo; typed → Save note
await ev(`window.__say = ${JSON.stringify(NOTE)}`);
stubSay = NOTE;
const nDoor = await cur();
const notesNow = () => ev(`[...document.querySelectorAll("[data-drive-notes] li")].map((l) => l.textContent)`);
check("notes: 'Your notes' shows with no notes yet", await ev(`/Your notes/.test(document.querySelector("[data-drive-notes] h2")?.textContent ?? "")`), null);
check("safety line names the mic", scenario === "dead" ? /Log visit takes a quick tap/.test(await ev(`document.querySelector(".dv-safe").textContent`)) : /Log visit listens: tap the mic/.test(await ev(`document.querySelector(".dv-safe").textContent`)), await ev(`document.querySelector(".dv-safe").textContent`));
await shot("06f-notes");
if (scenario === "dead") {
  check("dead: no note mic, the link says Add a note", !(await ev(`!!document.querySelector("[data-drive-notemic]")`)) && /^Add a note$/.test(await ev(`document.querySelector("[data-drive-notetype]")?.textContent`)), await ev(`document.querySelector("[data-drive-notes]")?.innerText`));
} else {
  await click("[data-drive-notemic]");
  await sleep(250);
  check("note mic: listening label", /Listening… tap when done|Getting your words/.test(await ev(`document.querySelector("[data-drive-notemic]")?.textContent ?? ""`)) || /Note saved/.test(await ev(`document.querySelector(".dv-toast")?.textContent ?? ""`)), await ev(`document.querySelector("[data-drive-notemic]")?.textContent`));
  await shot("06g-note-listening");
  await waitFor(`/Note saved on/.test(document.querySelector(".dv-toast")?.textContent ?? "")`, 30000);
  const t = await ev(`document.querySelector(".dv-toast").textContent`);
  const heard = exact ? NOTE : (t.match(/“(.+)”/)?.[1] ?? "");
  check("said note: saved at once, toast with the words", heard && t.includes(`“${heard}”`) && (await notesNow()).some((x) => x.includes(heard) && /on the road/.test(x)), { t, notes: await notesNow() });
  report.noteHeard = heard;
  check("said note: the same door", (await cur()) === nDoor, await cur());
  await shot("06h-note-saved");
  await click("[data-drive-undo]");
  await sleep(300);
  check("said note: Undo takes it off", !(await notesNow()).some((x) => x.includes(heard)) && /that note is gone/.test(await ev(`document.querySelector(".dv-toast")?.textContent ?? ""`)), await notesNow());
  check("link reads Or type a note", /^Or type a note$/.test(await ev(`document.querySelector("[data-drive-notetype]")?.textContent`)), null);
}
await click("[data-drive-notetype]");
await waitFor(`document.activeElement?.id === "drive-note"`);
check("note box: the phone's placeholder and cap", await ev(`(() => { const t = document.querySelector("#drive-note"); return t.placeholder === "Add a note: the manager is Priya, back Thursdays" && t.maxLength === 300; })()`), null);
await send("Input.insertText", { text: TYPED });
await shot("06i-note-typing");
await click("[data-drive-noteform] button[type=submit]");
await waitFor(`/Note saved on/.test(document.querySelector(".dv-toast")?.textContent ?? "")`);
check("typed note: saved on Save note, box closed", (await notesNow()).some((x) => x.includes(TYPED)) && !(await ev(`!!document.querySelector("#drive-note")`)), await notesNow());
const stored = await ev(`(() => { const p = JSON.parse(localStorage.getItem(${JSON.stringify(key)})); return (p.slots?.[${JSON.stringify(nDoor)}] ?? []).filter((r) => r.field === "note").map((r) => ({ v: r.value, by: r.by })); })()`);
check("typed note: stored as the stop's notes are (S4 note, by drive)", stored.some((r) => r.v === TYPED && r.by === "drive"), stored);
await shot("06j-note-typed");

// 6b. Agent mic (PARITY M3): the words go INTO the box, not sent
await click("[data-drive-ask]");
await waitFor(`!document.querySelector("#agentPanel").hidden`);
const sent0 = await ev(`document.querySelectorAll('#agentLog [data-role="user"]').length`);
if (scenario === "dead") {
  check("dead: no Agent mic", await ev(`document.querySelector('[data-agent="mic"]').hidden`), null);
} else {
  await ev(`window.__say = ${JSON.stringify(ASK)}`);
  stubSay = ASK;
  await ev(`document.querySelector("#agentInput").value = ""`);
  await click('[data-agent="mic"]');
  await sleep(250);
  await shot("06k-agent-listening");
  await waitFor(`document.querySelector("#agentInput").value.length > 0 && !document.querySelector('[data-agent="mic"]').disabled && !document.querySelector('[data-agent="mic"]').classList.contains("on")`, 30000);
  const box = await ev(`document.querySelector("#agentInput").value`);
  check("agent mic: the words in the box", exact ? box === ASK : box.trim().length > 3, box);
  check("agent mic: nothing sent", (await ev(`document.querySelectorAll('#agentLog [data-role="user"]').length`)) === sent0, null);
  await shot("06l-agent-words");
  await ev(`document.querySelector("#agentInput").value = ""`);
}
await click('[data-agent="close"]');

// 6c. the navigation app (PARITY S14): chosen under Navigate, remembered, and in Settings
await click("[data-drive-navpick]");
await click('[data-nav-app="waze"]');
await sleep(200);
check("nav app: Navigate opens Waze", /^https:\/\/waze\.com\/ul\?ll=/.test(await ev(`document.querySelector("[data-drive-nav]").href`)) && /Opens Waze/.test(await ev(`document.querySelector("[data-drive-navpick]").textContent`)), await ev(`document.querySelector("[data-drive-nav]").href`));
await shot("06m-navapp");
await click("[data-drive-close]");
await waitFor(`!document.querySelector("#drive")`);
await click("#t-menu"); // Settings sits in the plan's Menu (Jard 10-23 #8)
await click("#t-settings");
await waitFor(`!document.querySelector("#settings").hidden`);
check("settings: Navigation app shows Waze, remembered", /open Waze/.test(await ev(`document.querySelector("#settings .set-nav").textContent`)) && (await ev(`document.querySelector('#settings [data-nav-app="waze"]').getAttribute("aria-pressed")`)) === "true", await ev(`document.querySelector("#settings .set-nav").textContent`));
await click('#settings [data-nav-app="google"]');
await sleep(200);
check("settings: picking Google Maps", /open Google Maps/.test(await ev(`document.querySelector("#settings .set-nav").textContent`)), null);
await shot("06n-settings");
await ev(`localStorage.removeItem("doors:nav-app")`);
await click("#t-menu"); await click("#t-menu"); // the menu over Settings, then closed: both away
await click("[data-drive-start]");
await waitFor(`!!document.querySelector("[data-drive-door] .dv-talk")`);
await waitFor(`document.querySelector(".dv-toast")?.hidden !== false`, 12000); // "Welcome back" sits over Done for 4 s at 1400
await ev(`window.__say = ""`); // as after step 5: chrome's recognizer hears nothing, the taps it is
stubSay = SAY;

// 6. chrome: log to the last door: no Skip there (the phone shows none)
if (browserWorks) {
  for (let i = 0; i < 30 && !(await ev(`/Last door/.test(document.querySelector(".dv-next")?.textContent ?? "")`)); i++) {
    const c = await cur();
    await ev(`document.querySelector(".dv-toast").hidden = true`); // the last Save's toast: scrolled to the middle, Done can sit under it
    await click("[data-drive-done]");
    await waitFor(`!!document.querySelector("[data-drive-quick=visited]")`);
    await sleep(400); // the browser's recognizer ends (hears nothing) and the sheet settles
    await click("[data-drive-quick=visited]");
    await waitFor(`!!document.querySelector("[data-drive-save]")`);
    await click("[data-drive-save]");
    await waitFor(`document.querySelector("[data-drive-door]")?.dataset.id !== ${JSON.stringify(c)} || !!document.querySelector("[data-drive-finished]")`);
  }
  check("last door: no Skip for now", !(await ev(`!!document.querySelector("[data-drive-skip]")`)) && (await ev(`/Last door/.test(document.querySelector(".dv-next")?.textContent ?? "")`)), await ev(`document.querySelector(".dv-next")?.textContent`));
  await shot("08-last-door");
}

report.checks = checks;
report.problems = problems;
report.served = served;
console.log(JSON.stringify(report, null, 1));
process.exit(checks.every((c) => c.ok) && !problems.length ? 0 : 1);
