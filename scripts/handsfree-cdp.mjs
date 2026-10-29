// Prove the always-on hands-free Agent in Start my day in a real browser over CDP (group 3 #8; Jard 10-28: always
// hands-free, the Aura-2 voice, an instant acknowledgement, Read it to me shows it was tapped). A saved Tidewell plan
// whose first window is today (the page's clock pinned to 12:55 pm), drive mode, then:
//   1. drive mode opens → the Agent's bar is up and "Listening" at once (no tap, no chat box); the door stays in use
//   2. the stubbed recognizer hears "tell me about my next stop" → "Working on it" with the acknowledgement line (its
//      clip played on the one <audio>) → the Agent's answer (a stubbed /api/agent, drive mode) shown and read aloud
//      (the stubbed Worker voice: an MP3 on the same <audio>; x-doors-voice phoebe)
//   3. → when the reading ends it listens again; a quiet gap keeps it listening (never "stopped")
//   4. Mute → "Muted"; Listen → listening again; Type instead → the chat panel, muted
//   5. Read it to me → pressed, "Reading…" and a Stop; back to normal when the reading ends
//   6. Voice off → the bar goes; Agent shows the bar saying Voice is off (r8hf: never the chat box without a word);
//      Type instead opens the chat panel
// The browser's speech is stubbed (window.__says: what each listen hears; "" = nothing). The page can't record here
// (mediaDevices removed), so the ear is the browser's recognizer. No model, no Qloo, no spend.
// Usage: node scripts/handsfree-cdp.mjs <base-url> <out-dir> [width] [height] [browser]   (prints a JSON report)
import { spawn } from "node:child_process";
import fs from "node:fs";
import { demoProfile } from "../public/lib/demo-profile.js";
import { storeKey, STORE_VERSION, BRAND_KEY } from "../public/lib/store.js";
import { isoDate } from "../public/lib/profile.js";

const [base, out, w = "1400", h = "900", browser = "chromium"] = process.argv.slice(2);
const ASK = "tell me about my next stop";
const REPLY = "The Drafting Room is a cocktail bar on Rainey Street with live music and a patio. Lead with the patio: a guest who isn't drinking wants more than soda water. Ask for one case of cans in the cooler at $38 a case.";
const tag = `${w}`;
const ackMp3 = fs.readFileSync(new URL("../public/audio/ack/ask-1.mp3", import.meta.url)).toString("base64"); // the Worker's voice, stubbed: a real Aura-2 clip
fs.mkdirSync(out, { recursive: true });
const port = 9400 + Math.floor(Math.random() * 400);
const dir = `/tmp/claude-1000/handsfree-${port}`;
const ch = spawn(browser, ["--headless=new", `--remote-debugging-port=${port}`, "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--hide-scrollbars", "--autoplay-policy=no-user-gesture-required",
  "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--window-size=${w},${h}`, `--user-data-dir=${dir}`, "about:blank"], { stdio: "ignore", detached: true });
const cleanup = () => { try { process.kill(-ch.pid, "SIGKILL"); } catch {} try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };
process.on("exit", cleanup);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(1));
process.on("uncaughtException", (e) => { console.error(e); process.exit(1); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 75; i++) { try { const t = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); const p = t.find((x) => x.type === "page"); if (p) { ws = new WebSocket(p.webSocketDebuggerUrl); break; } } catch {} await sleep(200); }
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pend = new Map(); const problems = []; const agentBodies = [];
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
    if (path === "/api/voice/say") return send("Fetch.fulfillRequest", { requestId, responseCode: 200, responseHeaders: hdr({ "content-type": "audio/mpeg", "x-doors-voice": "phoebe" }), body: ackMp3 });
    if (path.startsWith("/api/voice/")) return send("Fetch.fulfillRequest", { requestId, responseCode: 503, responseHeaders: hdr({ "content-type": "application/json" }), body: Buffer.from(JSON.stringify({ error: "off" })).toString("base64") });
    try { agentBodies.push(JSON.parse(request.postData ?? "{}")); } catch { agentBodies.push({}); }
    setTimeout(() => send("Fetch.fulfillRequest", { requestId, responseCode: 200, responseHeaders: hdr({ "content-type": "application/json" }), body: Buffer.from(JSON.stringify({ v: 1, reply: REPLY, facts: [], actions: [], tools: [{ name: "brief_door", ok: true }], by: "anthropic", model: "Anthropic Claude (Haiku 5.5)" })).toString("base64") }), 1200);
  }
});
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result?.value; };
const shot = async (name) => { const { data } = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(`${out}/hf-${tag}-${name}.png`, Buffer.from(data, "base64")); };
const click = async (sel) => {
  const r = await ev(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.offsetParent || x.getClientRects().length); if (!e) return null; e.scrollIntoView({block:"center"}); const b = e.getBoundingClientRect(); return {x: b.left + b.width/2, y: b.top + b.height/2}; })()`);
  if (!r) throw new Error(`no ${sel}`);
  await sleep(150);
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: r.x, y: r.y, button: "left", clickCount: 1 });
};
const waitFor = async (expr, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(expr)) return true; await sleep(100); } await shot("zz-timeout"); throw new Error(`timed out: ${expr}\n${problems.join("\n")}\nlog ${JSON.stringify(await ev("window.__log"))}\nhf ${await ev(`document.querySelector(".hf")?.innerText`)}`); };
const checks = [];
const check = (name, ok, got) => { checks.push({ name, ok: !!ok, got }); if (!ok) console.error(`FAIL ${tag}: ${name}: ${JSON.stringify(got)}`); };

const today = isoDate(new Date());
const prof = demoProfile(new Date());
prof.windows = [{ date: today, from: "13:00", to: "18:00" }, ...prof.windows.slice(1)];
prof.known = [];
prof.product = { format: "cans", size: "12 oz", abv: "0.5%", na: true, sells: "self" }; // lane B: format is required
const key = storeKey(prof.brand, prof.city);
const state = { v: STORE_VERSION, brand: prof.brand, city: prof.city, profile: prof, plan: null, statuses: {}, outcomes: {}, savedAt: new Date().toISOString() };
const [y, mo, d] = today.split("-").map(Number);
const pinned = new Date(y, mo - 1, d, 12, 55).getTime();
await send("Runtime.enable"); await send("Page.enable");
await send("Fetch.enable", { patterns: [{ urlPattern: "*/api/voice/*", requestStage: "Request" }, { urlPattern: "*/api/agent", requestStage: "Request" }] });
await send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
  const real = Date, off = ${pinned} - real.now();
  class D extends real { constructor(...a) { if (a.length) super(...a); else super(real.now() + off); } static now() { return real.now() + off; } }
  window.Date = D;
  try { if (!localStorage.getItem("__seeded")) { localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify(state))}); localStorage.setItem(${JSON.stringify(BRAND_KEY)}, ${JSON.stringify(JSON.stringify({ v: STORE_VERSION, profile: prof, savedAt: new Date().toISOString() }))}); localStorage.setItem("__seeded", "1"); } } catch {}
  const log = window.__log = [];
  window.__says = [];
  try { Object.defineProperty(navigator, "mediaDevices", { value: undefined }); } catch {} // the ear is the recognizer here
  // every play on the page's <audio> (the ack clips, the Worker's voice)
  const play0 = HTMLMediaElement.prototype.play;
  const srcOf = (el) => (el.getAttribute("src") || el.src).replace(/^.*\\/audio\\//, "/audio/").replace(/^blob:.*$/, "blob").replace(/^data:.*$/, "silence");
  HTMLMediaElement.prototype.play = function () {
    if (!this.__hooked) { this.__hooked = true; for (const k of ["ended", "pause", "error", "stalled"]) this.addEventListener(k, () => log.push({ [k]: srcOf(this), t: Math.round(this.currentTime * 10) / 10 })); }
    log.push({ play: srcOf(this) });
    window.__audio = this;
    return play0.call(this);
  };
  window.__phases = []; // every hands-free phase, in order
  new MutationObserver((ms) => { for (const m of ms) if (m.target.classList?.contains("hf")) { const p = m.target.dataset.phase; if (window.__phases.at(-1) !== p) window.__phases.push(p); } }).observe(document, { subtree: true, attributes: true, attributeFilter: ["data-phase"] });
  // the browser's recognizer: each start hears the next of __says ("" = nothing said: no-speech, then end)
  class Rec { constructor() { log.push({ rec: "new" }); } start() { const t = window.__says.shift() ?? ""; log.push({ rec: "start", hears: t }); setTimeout(() => { if (t) this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: t }], { isFinal: true })] }); else this.onerror?.({ error: "no-speech" }); this.onend?.(); }, 700); } stop() {} abort() {} }
  window.SpeechRecognition = Rec; window.webkitSpeechRecognition = Rec;
  // the browser's voice: speaks for 1.5 s, with speechSynthesis.speaking true meanwhile
  let busy = false;
  speechSynthesis.getVoices = () => [{ name: "Test", lang: "en-US", localService: true }];
  speechSynthesis.speak = (u) => { log.push({ speak: u.text.slice(0, 80) }); busy = true; setTimeout(() => u.onstart?.(), 20); setTimeout(() => { busy = false; log.push({ spoke: u.text.slice(0, 20) }); u.onend?.(); }, 1500); };
  speechSynthesis.cancel = () => { if (busy) log.push({ cancel: true }); busy = false; };
  Object.defineProperty(speechSynthesis, "speaking", { get: () => busy });
})();` });
await send("Emulation.setDeviceMetricsOverride", { width: +w, height: +h, deviceScaleFactor: 1, mobile: +w < 700 });
if (+w < 700) await send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" });
await send("Page.navigate", { url: `${base}/app#/plan?${new URLSearchParams({ brand: prof.brand, city: prof.city, drive: "1" })}` });
await waitFor(`!!document.querySelector("[data-drive-door] .dv-talk")`, 40000);
const L = () => ev("window.__log");
const phase = () => ev(`document.querySelector(".hf")?.dataset.phase ?? null`);
await shot("01-door");

// 1. drive mode opens → the bar is up and listening at once (the recognizer hears the ask, then nothing, then nothing)
await ev(`window.__says = [${JSON.stringify(ASK)}, "", ""]`);
await waitFor(`document.querySelector(".hf")?.dataset.phase === "listen" || document.querySelector(".hf")?.dataset.phase === "think"`, 8000);
check("drive mode opens listening, no tap", (await ev("window.__phases[0]")) === "listen", await ev("window.__phases"));
check("no chat box", await ev(`!document.querySelector("#agentPanel") || document.querySelector("#agentPanel").hidden`), null);
check("the door stays in use above the bar", await ev(`(() => { const d = document.querySelector("[data-drive-done]"), h = document.querySelector(".hf"); if (!d || !h) return false; const a = d.getBoundingClientRect(), b = h.getBoundingClientRect(); return a.bottom <= b.top + 1 && a.height > 0; })()`), null);
check("the tap that opened drive mode unlocked the <audio> (a silence played)", (await L()).some((e) => e.play === "silence"), (await L()).filter((e) => e.play));
// 2. → working on it (the acknowledgement) → speaking, the answer shown
await waitFor(`document.querySelector(".hf")?.dataset.phase === "think"`, 8000);
check("you said shows the words", /tell me about my next stop/.test(await ev(`document.querySelector("[data-hf-words]").textContent`)), await ev(`document.querySelector("[data-hf-words]").textContent`));
await waitFor(`/^(Let me check on that, one second\.|One sec, looking\.|I'll grab that for you\.)$/.test(document.querySelector("[data-hf-hint]").textContent)`, 3000);
const ackLine = await ev(`document.querySelector("[data-hf-hint]").textContent`);
check("the acknowledgement line shows at once (a question → an ask line)", /^(Let me check on that, one second\.|One sec, looking\.|I'll grab that for you\.)$/.test(ackLine), ackLine);
check("its clip played on the page's <audio>", (await L()).some((e) => /^\/audio\/ack\/ask-\d\.mp3$/.test(e.play)), (await L()).filter((e) => e.play));
await shot("02-working");
await waitFor(`document.querySelector(".hf")?.dataset.phase === "speak"`, 15000);
await sleep(200);
await shot("03-speaking");
const body = agentBodies[0] ?? {};
check("the turn went to /api/agent in drive mode", body.context?.mode === "drive" && body.messages?.at(-1)?.text === ASK, { mode: body.context?.mode, last: body.messages?.at(-1) });
check("the answer is on screen", (await ev(`document.querySelector("[data-hf-answer]").textContent`)) === REPLY, null);
check("the answer is read by the Worker's voice on the same <audio>, not the browser's", (await L()).filter((e) => e.play === "blob").length >= 1 && !(await L()).some((e) => e.speak), (await L()).filter((e) => e.play || e.speak));
check("no phone-voice note", !/browser's own voice/.test(await ev(`document.querySelector(".hf").innerText`)), null);
// 3. reading over → listens again → a quiet gap → still listening
const nStart = (await L()).filter((e) => e.rec === "start").length;
await waitFor(`window.__log.filter((e) => e.rec === "start").length >= ${nStart + 1}`, 12000);
check("listens again after the answer, for a follow-up", (await L()).findLastIndex((e) => e.rec === "start" && e.hears === "") > (await L()).findIndex((e) => e.play === "blob") && (await L()).some((e) => e.ended === "blob"), await L());
await waitFor(`window.__log.filter((e) => e.rec === "start").length >= ${nStart + 2}`, 8000);
check("a quiet gap keeps it listening (never stopped)", (await phase()) === "listen" && !(await ev("window.__phases")).includes("stopped"), { phases: await ev("window.__phases"), audio: await ev(`(() => { const a = window.__audio; return a ? { src: a.src.slice(0, 30), t: a.currentTime, paused: a.paused, ended: a.ended, rs: a.readyState, ns: a.networkState, err: a.error && a.error.code, dur: a.duration } : null; })()`) });
await shot("04-listening-again");
check("the turn is kept in the chat", /tell me about my next stop/.test(await ev(`Object.keys(sessionStorage).filter((k) => k.includes("chat")).map((k) => sessionStorage.getItem(k)).join(" ")`) ?? ""), null);
// 4. Mute → muted; Listen → listening; Type instead → the chat panel, muted
await click("[data-hf-mute]");
await sleep(150);
await shot("05-muted");
check("Mute: muted, the button says Listen", (await phase()) === "muted" && (await ev(`document.querySelector("[data-hf-mute]").textContent`)) === "Listen", await phase());
await ev(`window.__says = ["", "", "", "", ""]`);
await click("[data-hf-mute]");
await sleep(150);
check("Listen: listening again", (await phase()) === "listen", await phase());
await click("[data-hf-type]");
await sleep(400);
check("Type instead: the chat panel, and muted", (await phase()) === "muted" && (await ev(`!!document.querySelector("#agentPanel") && !document.querySelector("#agentPanel").hidden`)), await phase());
await ev(`document.querySelector("#agentPanel [data-agent=close], #agentPanel .aclose, #agentPanel button[aria-label='Close']")?.click()`);
await sleep(200);
// 5. Read it to me → pressed and Reading… with a Stop; back when the reading ends
const logBefore = (await L()).length;
await click("[data-drive-read]");
await sleep(400);
await shot("06-reading");
check("Read it to me: pressed, Reading…, a Stop", await ev(`(() => { const b = document.querySelector("[data-drive-read]"); return !!b && b.getAttribute("aria-pressed") === "true" && /Reading…/.test(b.textContent) && !!document.querySelector("[data-drive-stopread]"); })()`), await ev(`document.querySelector("[data-drive-read]")?.outerHTML.slice(0, 200)`));
check("the reading is the Worker's voice on the <audio>", (await L()).slice(logBefore).some((e) => e.play === "blob"), (await L()).slice(logBefore));
await waitFor(`document.querySelector("[data-drive-read]")?.getAttribute("aria-pressed") === "false"`, 8000);
check("back to Read it to me when the reading ends", await ev(`/Read it to me/.test(document.querySelector("[data-drive-read]").textContent) && !document.querySelector("[data-drive-stopread]")`), null);
await shot("07-read-done");
// 6. Voice off → the bar goes; Agent opens the chat panel
await click("[data-drive-voice]");
await sleep(200);
check("Voice off: the bar goes", await ev(`document.querySelector(".hf").hidden && !document.documentElement.classList.contains("hf-open")`), null);
await click("[data-drive-ask]");
await sleep(400);
await shot("08-voiceoff-bar");
check("Voice off: Agent shows the bar saying Voice is off, not the chat panel (r8hf)", (await phase()) === "off" && /Voice is off/.test(await ev(`document.querySelector("[data-hf-note]").textContent`)) && !(await ev(`!!document.querySelector("#agentPanel") && !document.querySelector("#agentPanel").hidden`)), { phase: await phase(), note: await ev(`document.querySelector("[data-hf-note]").textContent`) });
await click("[data-hf-type]");
await sleep(400);
await shot("09-voiceoff-panel");
check("Type instead opens the chat panel", await ev(`!!document.querySelector("#agentPanel") && !document.querySelector("#agentPanel").hidden`), null);
check("no page errors", !problems.length, problems);
check("phases in order: listen, think, speak, listen", (await ev("window.__phases.join()")).startsWith("listen,think,speak,listen"), await ev("window.__phases"));
const report = { width: +w, checks, failed: checks.filter((c) => !c.ok).length, agentCalls: agentBodies.length };
console.log(JSON.stringify(report, null, 1));
process.exit(report.failed ? 1 : 0);
