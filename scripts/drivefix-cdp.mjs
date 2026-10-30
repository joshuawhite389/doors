// drivefix (Jard 10-29: "i'm confused about when and how to talk when logging the door… i try to go back and i exit
// driving mode… no simple way to go back to the last door"): the cleaned-up drive mode in a real browser over CDP.
// A saved Tidewell plan whose first window is today (the clock pinned to 12:55 pm), #/plan?…&drive=1, then:
//   1. the bar: one compact row, listening at once ("Listening: ask a question or say how the visit went")
//   2. an Agent turn: Working… → the answer in two lines with More → listening again
//   3. Log visit while the Agent speaks: the speech stops at once, the sheet has NO mic of its own, the bar says
//      "Listening: say how it went at <door>", the box is empty ("Type how it went")
//   4. said "done, they liked it, wants samples" → the read-back (not an Agent turn), the bar listens for "save";
//      said "save" → saved, the next door
//   5. Log visit by tap: Interested → Save & next door
//   6. ‹ Previous door / Next door ›; browser Back steps to the door before and never leaves; at the first door a Back
//      says so, a second Back leaves to the plan
//   7. the mic: tap → "Mic off" (Voice off, remembered), tap → listening; Type → the Agent panel, the bar paused,
//      listening again when it closes
//   8. More about this door → Say a note → the bar listens for the note → saved on the door
// The browser's speech is stubbed (window.__says: what each listen hears; "" = nothing). No model, no Qloo, no spend.
// Usage: node scripts/drivefix-cdp.mjs <base-url> <out-dir> [width] [height] [browser]   (prints a JSON report)
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
const dir = `/tmp/claude-1000/drivefix-${port}`;
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
const shot = async (name) => { const { data } = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(`${out}/dv-${tag}-${name}.png`, Buffer.from(data, "base64")); };
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
const status = () => ev(`document.querySelector("[data-hf-status]")?.textContent ?? null`);
const curId = () => ev(`document.querySelector("[data-drive-door]")?.dataset.id ?? null`);
const say = (t) => ev(`window.__says.push(${JSON.stringify(t)})`);
const inDrive = () => ev(`!!document.querySelector("#drive")`);
const saved = () => ev(`JSON.parse(localStorage.getItem(${JSON.stringify(key)}))`);
await shot("01-door");

// 1. the bar
await waitFor(`document.querySelector(".hf")?.dataset.phase === "listen"`, 8000);
const bar = await ev(`(() => { const h = document.querySelector(".hf").getBoundingClientRect(); return { h: Math.round(h.height), share: Math.round(h.height / innerHeight * 100) }; })()`);
check("the bar is one compact row (at most 14% of the screen, under 110 px)", bar.h <= 110 && bar.share <= 14, bar);
check("its status is plain words", (await status()) === "Listening: ask a question or say how the visit went", await status());
check("no Agent or Voice button in the header (the bar is the one place to talk)", await ev(`!document.querySelector("[data-drive-ask], [data-drive-voice]")`), null);
check("the header has Previous / Stop n of N / Next", await ev(`!!document.querySelector("[data-drive-prev]") && /^Stop 1 of [0-9]+$/.test(document.querySelector("[data-drive-stepat]").textContent) && !!document.querySelector("[data-drive-next]")`), await ev(`document.querySelector(".dv-stepper")?.innerText`));
check("Navigate and Log visit are on screen, above the bar", await ev(`(() => { const d = document.querySelector("[data-drive-done]").getBoundingClientRect(), h = document.querySelector(".hf").getBoundingClientRect(); return d.height > 0 && d.bottom <= h.top + 1 && d.top >= 0; })()`), null);
check("the rest is folded under More about this door", await ev(`(() => { const m = document.querySelector("[data-drive-more]"); return !!m && !m.open && /More about this door/.test(m.querySelector("summary").textContent) && !!m.querySelector("[data-drive-skip], [data-drive-remove]") && !!m.querySelector("[data-drive-notes]"); })()`), null);
const doorH = await ev(`document.querySelector("#drive").scrollHeight - document.querySelector("#drive").clientHeight`);
check("the door's essentials fit with little scrolling (≤ 1 screen more)", doorH <= (await ev("innerHeight")), { overflow: doorH });

// 2. an Agent turn
await say(ASK);
await waitFor(`document.querySelector(".hf")?.dataset.phase === "think"`, 8000);
check("Working…", (await status()) === "Working…", await status());
await shot("02-working");
await waitFor(`document.querySelector(".hf")?.dataset.phase === "speak"`, 15000);
await sleep(300);
check("Speaking: tap to stop", (await status()) === "Speaking: tap to stop", await status());
check("the answer shows in two lines at most, with More", await ev(`(() => { const a = document.querySelector("[data-hf-answer]"); const lh = parseFloat(getComputedStyle(a).lineHeight); return a.textContent.length > 50 && a.clientHeight <= lh * 2 + 2 && !document.querySelector("[data-hf-more]").hidden; })()`), await ev(`document.querySelector("[data-hf-answer]").clientHeight`));
await shot("03-speaking");
const agentN = agentBodies.length;

// 3. Log visit while it speaks
const first = await curId();
const logAt = (await L()).length;
await click("[data-drive-done]");
await sleep(300);
check("Log visit stops the Agent's speech at once", (await phase()) === "listen" && (await L()).slice(logAt).some((e) => e.pause === "blob" || e.cancel), { phase: await phase(), log: (await L()).slice(logAt) });
check("the sheet has no microphone of its own", await ev(`!!document.querySelector("[data-drive-sheet]") && !document.querySelector("[data-drive-sheet] [data-drive-mic], [data-drive-sheet] .dv-mic")`), null);
check("the bar says what it listens for", /^Listening: say how it went at /.test(await status()), await status());
check("the sheet says how to talk, in one line", /^Say how it went \(the bar at the bottom is listening\), or tap an answer\.$/.test(await ev(`document.querySelector("[data-drive-how]")?.textContent`)), await ev(`document.querySelector("[data-drive-how]")?.textContent`));
check("the box is empty, its placeholder plain", await ev(`document.querySelector("#drive-text").value === "" && document.querySelector("#drive-text").placeholder === "Type how it went"`), await ev(`document.querySelector("#drive-text").placeholder`));
check("the bar stays in view under the sheet", await ev(`(() => { const s = document.querySelector(".dv-sheet").getBoundingClientRect(), h = document.querySelector(".hf").getBoundingClientRect(); return !document.querySelector(".hf").hidden && s.bottom <= h.top + 1; })()`), null);
await shot("04-log-listening");

// 4. said → read back → "save"
await say("done, they liked it, wants samples");
await waitFor(`!!document.querySelector("[data-drive-readback]")`, 10000);
check("the visit was read by the visit log, not sent to the Agent", agentBodies.length === agentN, agentBodies.length - agentN);
check("You said shows on the read-back", /done, they liked it/.test(await ev(`document.querySelector(".dv-said")?.textContent`)), await ev(`document.querySelector(".dv-said")?.textContent`));
await waitFor(`/^Listening: say “save”/.test(document.querySelector("[data-hf-status]")?.textContent) || document.querySelector(".hf")?.dataset.phase === "paused"`, 8000);
await shot("05-readback");
await waitFor(`/^Listening: say “save”/.test(document.querySelector("[data-hf-status]")?.textContent)`, 12000);
check("after the read-back the bar listens for save", true, await status());
await say("save");
await waitFor(`document.querySelector("[data-drive-door]")?.dataset.id !== ${JSON.stringify(first)} && !document.querySelector("[data-drive-sheet]")`, 10000);
check("“save” saved it and moved to the next door", (await saved()).statuses[first] === "visited", (await saved()).statuses[first]);
await sleep(300);
check("the Agent has the ear again", (await status()) === "Listening: ask a question or say how the visit went" || (await phase()) !== "listen", await status());
await shot("06-saved-next");

// 5. Log visit by tap
const second = await curId();
await click("[data-drive-done]");
await sleep(200);
await click(`[data-drive-quick="interested"]`);
await waitFor(`!!document.querySelector("[data-drive-save]")`, 6000);
await shot("07-tap-readback");
await click("[data-drive-save]");
await waitFor(`document.querySelector("[data-drive-door]")?.dataset.id !== ${JSON.stringify(second)}`, 8000);
check("by tap: Interested saved", (await saved()).outcomes[second]?.result === "interested", (await saved()).outcomes[second]);
const third = await curId();

// 6. Previous / Next, and Back
await click("[data-drive-prev]");
await sleep(300);
check("‹ Previous door shows the door before (stop 2)", (await curId()) === second && /^Stop 2 of/.test(await ev(`document.querySelector("[data-drive-stepat]").textContent`)), await ev(`document.querySelector("[data-drive-stepat]").textContent`));
await shot("08-previous");
await click("[data-drive-next]");
await sleep(300);
check("Next door › comes back to the current door", (await curId()) === third && await ev(`!document.querySelector("[data-drive-viewed]")`), await curId());
await ev("history.back()");
await sleep(600);
check("Back: the door before, still in drive mode", (await inDrive()) && (await curId()) === second, { drive: await inDrive(), id: await curId() });
await ev("history.back()");
await sleep(600);
check("Back again: the first door, still in drive mode", (await inDrive()) && (await curId()) === first, { drive: await inDrive(), id: await curId() });
await click("[data-drive-done]");
await sleep(200);
await ev("history.back()");
await sleep(600);
check("Back with the Log visit sheet up closes the sheet, not drive mode", (await inDrive()) && await ev(`!document.querySelector("[data-drive-sheet]")`), null);
await ev("history.back()");
await sleep(600);
check("Back at the first door: it says so and stays", (await inDrive()) && /first door/.test(await ev(`document.querySelector(".dv-toast span")?.textContent`)), await ev(`document.querySelector(".dv-toast span")?.textContent`));
await shot("09-back-first");
await ev("history.back()");
await sleep(900);
check("a second Back at the first door leaves to the plan", !(await inDrive()) && !/drive=1/.test(await ev("location.href")), await ev("location.href"));
await shot("10-plan");
// back in: Start my day again
await click("#t-drive");
await waitFor(`!!document.querySelector("[data-drive-door] .dv-talk")`, 10000);
await waitFor(`document.querySelector(".hf")?.dataset.phase === "listen"`, 8000);

// 7. the mic and Type
await click("[data-hf-big]");
await sleep(200);
check("tap the mic: Mic off, Voice off remembered", (await phase()) === "muted" && (await status()) === "Mic off: tap to turn it on" && (await ev(`localStorage.getItem("doors:drive-voice")`)) === "off", { s: await status(), v: await ev(`localStorage.getItem("doors:drive-voice")`) });
await shot("11-mic-off");
await click("[data-drive-done]");
await sleep(200);
check("Mic off: the sheet says tap or type", (await ev(`document.querySelector("[data-drive-how]")?.textContent`)) === "Tap an answer, or type how it went.", await ev(`document.querySelector("[data-drive-how]")?.textContent`));
await shot("12-log-mic-off");
await click("[data-hf-big]");
await sleep(300);
check("tap the mic again: listening for the visit", (await phase()) === "listen" && /^Listening: say how it went/.test(await status()) && (await ev(`localStorage.getItem("doors:drive-voice")`)) === "on", await status());
await click("[data-drive-cancel]");
await sleep(200);
await click("[data-hf-type]");
await sleep(400);
check("Type: the Agent panel, the bar paused", (await ev(`!!document.querySelector("#agentPanel") && !document.querySelector("#agentPanel").hidden`)) && (await phase()) === "paused", await phase());
await ev(`document.querySelector("#agentPanel [data-agent=close], #agentPanel .aclose, #agentPanel button[aria-label='Close']")?.click()`);
await sleep(500);
check("panel closed: listening again", (await phase()) === "listen", await phase());

// 8. Say a note
await ev(`document.querySelector("[data-drive-more]").open = true`);
await sleep(200);
await click("[data-drive-notemic]");
await sleep(300);
check("Say a note: the bar listens for the note", (await status()) === "Listening: say your note", await status());
await shot("13-note-listening");
await say("the manager is Priya, back Thursdays");
await waitFor(`/the manager is Priya/.test(document.querySelector("[data-drive-notes]")?.textContent)`, 8000);
check("the note is saved on the door", true, null);
await shot("14-note-saved");
check("no page errors", !problems.length, problems);
const report = { width: +w, checks, failed: checks.filter((c) => !c.ok).length, agentCalls: agentBodies.length };
console.log(JSON.stringify(report, null, 1));
process.exit(report.failed ? 1 : 0);
