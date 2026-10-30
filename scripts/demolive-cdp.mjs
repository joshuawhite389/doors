// Prove the guided demo works like the app (Jard 10-29: "I don't want any parts of the app we are submitting not
// working anywhere for anyone at any time"), in a real browser over CDP: the tour, Skip to the finished plan, then
//   1. Start my day → the hands-free bar is up and "Listening" at once, as outside the tour
//   2. the ear hears "tell me about my next stop" → the turn goes to /api/agent (drive mode, the demo plan as context)
//      → the answer is shown and read in the Worker's voice (/api/voice/say, an Aura-2 clip on the one <audio>)
//   3. the Ask Doors panel: a free-form question goes to /api/agent too, and the panel says Claude answered (no
//      "no model is called" line)
//   4. nothing but Agent and voice left the page: no Qloo, routing or plan-building call (window.__demo.blocked holds
//      none of them, the network log has only Agent/voice paths)
// ear=rec (default): the browser's recognizer, stubbed (Chrome, Edge, Safari on a Mac). ear=server: no recognizer and a
// fake microphone (Chromium's fake device: a tone), so the page records and /api/voice/listen hears it (iPhone
// browsers, Brave, Firefox: what Jard recorded on Brave iOS). Agent and voice are stubbed here: no model, no spend.
// LIVE=1: /api/agent and /api/voice/say reach the server (one real Agent turn and its read-aloud; the panel step is
// skipped so it stays one turn): the end-to-end proof on a dev server with the keys (WORKERS_AI=1 for the voice).
// Usage: node scripts/demolive-cdp.mjs <base-url> <out-dir> [width] [height] [rec|server]   (prints a JSON report)
import { spawn } from "node:child_process";
import fs from "node:fs";

const [base, out, w = "1400", h = "900", ear = "rec"] = process.argv.slice(2);
const ASK = "tell me about my next stop";
const PANEL_ASK = "Which door should I go to first on Wednesday?";
const REPLY = "Lead with the patio: a guest who isn't drinking wants more than soda water. Ask for one case of cans in the cooler.";
const LIVE = new Set(["/api/agent", "/api/agent/log-visit", "/api/agent/debrief", "/api/voice/say", "/api/voice/listen"]);
const tag = `${w}-${ear}`;
const ackMp3 = fs.readFileSync(new URL("../public/audio/ack/ask-1.mp3", import.meta.url)).toString("base64");
fs.mkdirSync(out, { recursive: true });
// the fake microphone (as r8hf-cdp.mjs): 1.2 s of a 220 Hz tone (speech, to voice.js) then 4 s of silence, looped
const toneFile = `${out}/mic.wav`;
{
  const rate = 48000, tone = Math.round(1.2 * rate), quiet = 4 * rate, n = tone + quiet;
  const b = Buffer.alloc(44 + n * 2);
  b.write("RIFF", 0); b.writeUInt32LE(36 + n * 2, 4); b.write("WAVE", 8); b.write("fmt ", 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write("data", 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(i < tone ? Math.round(Math.sin((2 * Math.PI * 220 * i) / rate) * 0.4 * 32767) : 0, 44 + i * 2);
  fs.writeFileSync(toneFile, b);
}
const port = 9400 + Math.floor(Math.random() * 400);
const dir = `/tmp/claude-1000/demolive-${port}`;
const ch = spawn("chromium", ["--headless=new", `--remote-debugging-port=${port}`, "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--hide-scrollbars", "--autoplay-policy=no-user-gesture-required",
  "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-audio-capture=${toneFile}`, `--window-size=${w},${h}`, `--user-data-dir=${dir}`, "about:blank"], { stdio: "ignore", detached: true });
const cleanup = () => { try { process.kill(-ch.pid, "SIGKILL"); } catch {} try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };
process.on("exit", cleanup);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(1));
process.on("uncaughtException", (e) => { console.error(e); process.exit(1); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 75; i++) { try { const t = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); const p = t.find((x) => x.type === "page"); if (p) { ws = new WebSocket(p.webSocketDebuggerUrl); break; } } catch {} await sleep(200); }
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pend = new Map(); const problems = []; const agentBodies = []; const net = []; let listens = 0;
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const hdr = (o) => Object.entries(o).map(([name, value]) => ({ name, value }));
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64");
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
  if (m.method === "Runtime.consoleAPICalled" && /error/.test(m.params.type)) problems.push("console.error " + m.params.args.map((a) => a.value ?? a.description).join(" ").slice(0, 300));
  if (m.method === "Runtime.exceptionThrown") problems.push("exception " + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 300));
  if (m.method === "Network.requestWillBeSent") { try { const u = new URL(m.params.request.url); if (u.origin === new URL(base).origin && u.pathname.startsWith("/api/")) net.push(u.pathname); } catch {} }
  if (m.method === "Fetch.requestPaused") {
    const { requestId, request } = m.params;
    const path = new URL(request.url).pathname;
    if (path === "/api/voice/say") return send("Fetch.fulfillRequest", { requestId, responseCode: 200, responseHeaders: hdr({ "content-type": "audio/mpeg", "x-doors-voice": "phoebe" }), body: ackMp3 });
    // the server ear: the first recording is the ask, the rest nothing
    if (path === "/api/voice/listen") return send("Fetch.fulfillRequest", { requestId, responseCode: 200, responseHeaders: hdr({ "content-type": "application/json" }), body: b64({ text: listens++ ? "" : ASK }) });
    if (path !== "/api/agent") return send("Fetch.fulfillRequest", { requestId, responseCode: 503, responseHeaders: hdr({ "content-type": "application/json" }), body: b64({ error: "stubbed" }) });
    try { agentBodies.push(JSON.parse(request.postData ?? "{}")); } catch { agentBodies.push({}); }
    setTimeout(() => send("Fetch.fulfillRequest", { requestId, responseCode: 200, responseHeaders: hdr({ "content-type": "application/json" }), body: b64({ v: 1, reply: REPLY, facts: [], actions: [], tools: [], by: "anthropic", model: "Anthropic Claude (Sonnet 5.5)" }) }), 1000);
  }
});
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result?.value; };
const shot = async (name) => { const { data } = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(`${out}/demolive-${tag}-${name}.png`, Buffer.from(data, "base64")); };
const click = async (sel) => {
  const r = await ev(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.offsetParent || x.getClientRects().length); if (!e) return null; e.scrollIntoView({block:"center"}); const b = e.getBoundingClientRect(); return {x: b.left + b.width/2, y: b.top + b.height/2}; })()`);
  if (!r) throw new Error(`no ${sel}`);
  await sleep(150);
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: r.x, y: r.y, button: "left", clickCount: 1 });
};
const waitFor = async (expr, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(expr)) return true; await sleep(100); } await shot("zz-timeout"); throw new Error(`timed out: ${expr}\n${problems.join("\n")}\nhf ${await ev(`document.querySelector(".hf")?.innerText`)}\nphases ${JSON.stringify(await ev("window.__phases"))}`); };
const checks = [];
const check = (name, ok, got) => { checks.push({ name, ok: !!ok, got }); if (!ok) console.error(`FAIL ${tag}: ${name}: ${JSON.stringify(got)}`); };

await send("Runtime.enable"); await send("Page.enable"); await send("Network.enable");
const REAL = process.env.LIVE ? new Set(["/api/agent", "/api/voice/say"]) : new Set();
await send("Fetch.enable", { patterns: [...LIVE].filter((p) => !REAL.has(p)).map((p) => ({ urlPattern: `*${p}`, requestStage: "Request" })) });
await send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
  const log = window.__log = [];
  window.__says = [];
  const play0 = HTMLMediaElement.prototype.play;
  const srcOf = (el) => (el.getAttribute("src") || el.src).replace(/^.*\\/audio\\//, "/audio/").replace(/^blob:.*$/, "blob").replace(/^data:.*$/, "silence");
  HTMLMediaElement.prototype.play = function () { log.push({ play: srcOf(this) }); return play0.call(this); };
  window.__phases = [];
  window.addEventListener("doors:agent-reply", (e) => { window.__lastReply = { by: e.detail?.by ?? null }; });
  new MutationObserver((ms) => { for (const m of ms) if (m.target.classList?.contains("hf")) { const p = m.target.dataset.phase; if (window.__phases.at(-1) !== p) window.__phases.push(p); } }).observe(document, { subtree: true, attributes: true, attributeFilter: ["data-phase"] });
  ${ear === "rec" ? `
  try { Object.defineProperty(navigator, "mediaDevices", { value: undefined }); } catch {}
  class Rec { start() { const t = window.__says.shift() ?? ""; log.push({ rec: "start", hears: t }); setTimeout(() => { if (t) this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: t }], { isFinal: true })] }); else this.onerror?.({ error: "no-speech" }); this.onend?.(); }, 700); } stop() {} abort() {} }
  window.SpeechRecognition = Rec; window.webkitSpeechRecognition = Rec;` : `
  window.SpeechRecognition = undefined; window.webkitSpeechRecognition = undefined;`}
  let busy = false;
  speechSynthesis.getVoices = () => [{ name: "Test", lang: "en-US", localService: true }];
  speechSynthesis.speak = (u) => { log.push({ speak: u.text.slice(0, 80) }); busy = true; setTimeout(() => u.onstart?.(), 20); setTimeout(() => { busy = false; u.onend?.(); }, 1500); };
  speechSynthesis.cancel = () => { busy = false; };
  Object.defineProperty(speechSynthesis, "speaking", { get: () => busy });
})();` });
await send("Emulation.setDeviceMetricsOverride", { width: +w, height: +h, deviceScaleFactor: 1, mobile: +w < 700 });
if (+w < 700) await send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" });
await send("Page.navigate", { url: `${base}/app#/demo` });
await waitFor(`!!document.querySelector('.demo-banner [data-d="skip"]')`, 30000);
await sleep(800);
await click('.demo-banner [data-d="skip"]');
await waitFor(`!!window.__demo?.done && !!document.querySelector("#t-drive")`, 40000);
await sleep(1500);
await ev(`document.querySelector(".ccard:not([hidden]) [data-c='close'], .ccard:not([hidden]) .x")?.click?.()`).catch(() => {});
await shot("01-plan");

// 1. Start my day → the bar listens at once
await ev(`window.__says = [${JSON.stringify(ASK)}, "", "", "", ""]`);
await click("#t-drive");
await waitFor(`!!document.querySelector(".hf") && window.__phases.length > 0`, 8000);
await shot("02-listening");
check("Start my day in the tour: the hands-free bar is up and listening at once", (await ev("window.__phases[0]")) === "listen", await ev("window.__phases"));
// 2. → the live Agent's answer, read in the Worker's voice
await waitFor(`window.__phases.includes("think")`, 15000);
await waitFor(`window.__phases.includes("speak")`, 15000);
await shot("03-speaking");
const body = agentBodies[0] ?? {};
check("the turn went to /api/agent in drive mode, the demo plan as context", body.context?.mode === "drive" && body.messages?.at(-1)?.text === ASK && /Tidewell/.test(JSON.stringify(body.context ?? {})), { mode: body.context?.mode, last: body.messages?.at(-1), n: agentBodies.length });
const shown = await ev(`document.querySelector("[data-hf-answer]")?.textContent ?? ""`);
if (REAL.size) console.log("answer:", shown, "\nby:", await ev(`JSON.stringify((window.__lastReply ?? null))`));
check("the answer shows on the bar", REAL.size ? shown.length > 20 : shown === REPLY, await ev(`document.querySelector("[data-hf-answer]")?.textContent`));
check("it is read in the Worker's voice (/api/voice/say → the one <audio>)", net.includes("/api/voice/say") && (await ev("window.__log")).some((e) => e.play === "blob"), { net, plays: (await ev("window.__log")).filter((e) => e.play) });
if (ear === "server") check("the server ear: the page recorded and /api/voice/listen heard it", net.includes("/api/voice/listen"), net);
await waitFor(`document.querySelector(".hf")?.dataset.phase === "listen" || document.querySelector(".hf")?.dataset.phase === "reading"`, 15000);
check("it listens again after the answer", true, await ev("window.__phases"));

if (!REAL.size) {
// 3. the Ask Doors panel, free-form, after drive mode: a live turn, and no "no model is called" line
await click("[data-drive-close]");
await sleep(800);
await click('[data-agent="open"]');
await waitFor(`!!document.querySelector("#agentInput")`, 5000);
await ev(`(() => { const i = document.querySelector("#agentInput"); i.value = ${JSON.stringify(PANEL_ASK)}; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
await ev(`(() => { const i = document.querySelector("#agentInput"); const f = i.closest("form"); if (f) f.requestSubmit(); else document.querySelector('[data-agent="send"]').click(); })()`);
await waitFor(`[...document.querySelectorAll('#agentPanel .agent-msg[data-role="agent"]')].some((m) => m.textContent.includes(${JSON.stringify(REPLY.slice(0, 30))}) && m.closest("#agentPanel"))`, 30000);
await sleep(400);
await shot("04-panel");
const last = agentBodies.at(-1) ?? {};
check("a free-form question in the panel went to /api/agent", last.messages?.at(-1)?.text === PANEL_ASK, { last: last.messages?.at(-1), n: agentBodies.length });
const foot = await ev(`document.querySelector("#agentPanel .afoot-t")?.textContent ?? ""`);
check("the panel no longer says the demo calls no model", !/no model is called/i.test(foot) && /Claude/.test(foot), foot);
}

// 4. only Agent and voice left the page
const demo = await ev(`({ blocked: window.__demo?.blocked ?? [], live: window.__demo?.live ?? [] })`);
const stray = net.filter((p) => !LIVE.has(p));
check("no Qloo, routing or plan-building call reached the network", !stray.length, stray);
check("the demo refused no Agent or voice call", !demo.blocked.some((p) => LIVE.has(p)), demo.blocked);
check("no console errors", !problems.length, problems);

const failed = checks.filter((c) => !c.ok);
console.log(JSON.stringify({ tag, pass: !failed.length, checks: checks.map((c) => `${c.ok ? "ok" : "FAIL"} ${c.name}`), net: [...new Set(net)], blocked: [...new Set(demo.blocked)], phases: await ev("window.__phases") }, null, 1));
process.exit(failed.length ? 1 : 0);
