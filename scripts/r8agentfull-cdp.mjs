// Round 8 lane agentfull (Jard 10-28, his iPhone shots of the web app at :8793: "on the phone in general, when you pull
// up the agent, it should just be the whole screen"): at a phone width the Doors Agent takes the whole screen wherever
// it opens (the plan's Ask, a door's Ask about this door, drive mode's Agent and its hands-free bar's Type instead),
// with its name and a 44 px × at the top, the box above the keyboard, and Back or Escape closing it; wide is as it was
// (a card over the map's right edge, no history entry). Measured in headless Chromium over CDP with a faked iOS keyboard
// (window.visualViewport overridden, a resize fired) and a faked recognizer for the hands-free bar. Seeds Maya's demo
// profile (Austin; SAMPLE=1 NO_MODEL=1 dev server: the rules answer, no Qloo or model call).
// Usage: node scripts/r8agentfull-cdp.mjs <base-url> <out-dir> [width] [height] [strict|measure]
//   measure: numbers and shots only, no checks (base shots)
import { spawn } from "node:child_process";
import fs from "node:fs";
import { demoProfile } from "../public/lib/demo-profile.js";
import { storeKey, STORE_VERSION, BRAND_KEY } from "../public/lib/store.js";
const [base, out, w = "390", h = "844", strictArg = "strict"] = process.argv.slice(2);
const strict = strictArg !== "measure";
fs.mkdirSync(out, { recursive: true });
const port = 9800 + Math.floor(Math.random() * 150);
const dir = `/tmp/claude-1000/r8agentfull-${port}`;
const ch = spawn("chromium", ["--headless=new", `--remote-debugging-port=${port}`, "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--hide-scrollbars", `--window-size=${w},${h}`, `--user-data-dir=${dir}`, "about:blank"], { stdio: "ignore", detached: true });
const cleanup = () => { try { process.kill(-ch.pid, "SIGKILL"); } catch {} try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };
process.on("exit", cleanup);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(1));
process.on("uncaughtException", (e) => { console.error(e); process.exit(1); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 50; i++) { try { const t = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); const p = t.find((x) => x.type === "page"); if (p) { ws = new WebSocket(p.webSocketDebuggerUrl); break; } } catch {} await sleep(200); }
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pend = new Map(); const problems = [];
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
  if (m.method === "Runtime.consoleAPICalled" && /error/.test(m.params.type)) problems.push("console.error " + m.params.args.map((a) => a.value ?? a.description).join(" ").slice(0, 300));
  if (m.method === "Runtime.exceptionThrown") problems.push("exception " + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 300)); });
const send = (method, params = {}) => new Promise((r, j) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => { if (pend.has(i)) { pend.delete(i); j(new Error(`CDP ${method} hung`)); } }, 60000); });
const log = (s) => process.stderr.write(`· ${s}\n`);
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result?.value; };
const shot = async (name) => { log(`shot ${name}`); const { data } = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(`${out}/${name}.png`, Buffer.from(data, "base64")); };
const centre = (sel) => ev(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.getClientRects().length); if (!e) return null; const b = e.getBoundingClientRect(); return {x: b.left + b.width/2, y: b.top + b.height/2}; })()`);
const mouse = async (type, x, y) => send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", clickCount: 1 });
const click = async (sel, { scroll = true } = {}) => {
  if (scroll) await ev(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.getClientRects().length); e?.scrollIntoView({block:"center"}); })()`);
  await sleep(120);
  const r = await centre(sel);
  if (!r) throw new Error(`no visible ${sel}`);
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await mouse(type, r.x, r.y);
};
const key = async (k) => { for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, key: k, code: k, windowsVirtualKeyCode: k === "Escape" ? 27 : 0 }); };
const waitFor = async (expr, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(expr)) return true; await sleep(150); } await shot("zz-timeout"); throw new Error(`timed out: ${expr}\n${problems.join("\n")}`); };
const check = (ok, what) => { if (!ok) problems.push(`check failed: ${what}`); };
const must = (ok, what) => { if (strict) check(ok, what); };
const rect = (sel) => ev(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.getClientRects().length); if (!e) return null; const b = e.getBoundingClientRect(); return { l: +b.left.toFixed(1), t: +b.top.toFixed(1), r: +b.right.toFixed(1), b: +b.bottom.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) }; })()`);
const visible = (sel) => ev(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.getClientRects().length); if (!e) return false; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; })()`);
const hits = (sel, x, y) => ev(`(() => { const e = document.elementFromPoint(${x}, ${y}); return !!e && !!e.closest(${JSON.stringify(sel)}); })()`);
const KB = 336; // an iPhone's keyboard with its accessory bar, about
const keyboard = (on) => ev(`(() => { const vv = window.visualViewport; if (!vv) return null; const kb = ${on ? KB : 0};
  Object.defineProperty(vv, "height", { configurable: true, get: () => innerHeight - kb });
  Object.defineProperty(vv, "offsetTop", { configurable: true, get: () => 0 });
  Object.defineProperty(vv, "pageTop", { configurable: true, get: () => scrollY });
  vv.dispatchEvent(new Event("resize")); return vv.height; })()`);
const PANEL = "#agentPanel";
const open = () => ev(`!!document.querySelector(${JSON.stringify(PANEL)}) && !document.querySelector(${JSON.stringify(PANEL)}).hidden`);
const inHist = () => ev(`!!history.state?.doorsAgent`);
// the panel as it stands: its box, its top bar, the × and the box, what covers the app bar's spot and the screen's middle
const panelInfo = () => ev(`(() => { const p = document.querySelector("#agentPanel"); if (!p || p.hidden) return null; const g = (s) => { const e = p.querySelector(s); if (!e || !e.getClientRects().length) return null; const b = e.getBoundingClientRect(); return { l: +b.left.toFixed(1), t: +b.top.toFixed(1), r: +b.right.toFixed(1), b: +b.bottom.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) }; };
  const r = p.getBoundingClientRect(); const title = p.querySelector(".ahead b"); const at = (x, y) => { const e = document.elementFromPoint(x, y); return e ? (e.closest("#agentPanel") ? "panel" : (e.closest(".hf") ? "hf" : (e.id || e.className || e.tagName).toString().slice(0, 40))) : null; };
  return { panel: { l: +r.left.toFixed(1), t: +r.top.toFixed(1), r: +r.right.toFixed(1), b: +r.bottom.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) }, title: title ? { text: title.textContent, size: parseFloat(getComputedStyle(title).fontSize), weight: getComputedStyle(title).fontWeight } : null,
    close: g(".aclose"), input: g("#agentInput"), form: g(".aform"), log: g("#agentLog"), starters: p.querySelectorAll(".astart .btn").length, radius: getComputedStyle(p).borderTopLeftRadius, z: getComputedStyle(p).zIndex, bg: getComputedStyle(p).backgroundColor,
    atTop: at(innerWidth / 2, 20), atMid: at(innerWidth / 2, innerHeight / 2), atBottom: at(innerWidth / 2, innerHeight - 10), bodyPos: getComputedStyle(document.body).position, htmlOverflow: getComputedStyle(document.documentElement).overflow, inner: { w: innerWidth, h: innerHeight } }; })()`);
const W = +w, H = +h, phone = W <= 700;
const fullScreen = (i, bottom = H) => i && i.panel.l <= 0.5 && i.panel.t <= 0.5 && Math.abs(i.panel.r - W) <= 0.5 && Math.abs(i.panel.b - bottom) <= 1;
const prof = demoProfile(new Date());
prof.known = [];
const skey = storeKey(prof.brand, prof.city);
await send("Runtime.enable"); await send("Page.enable");
const state = { v: STORE_VERSION, brand: prof.brand, city: prof.city, profile: prof, plan: null, statuses: {}, outcomes: {}, savedAt: new Date().toISOString() };
await send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => { try { if (!localStorage.getItem("__seeded")) { localStorage.setItem(${JSON.stringify(skey)}, ${JSON.stringify(JSON.stringify(state))}); localStorage.setItem(${JSON.stringify(BRAND_KEY)}, ${JSON.stringify(JSON.stringify({ v: STORE_VERSION, profile: prof, savedAt: new Date().toISOString() }))}); localStorage.setItem("doors:drive-voice", "off"); localStorage.setItem("__seeded", "1"); } } catch {}
  if (!localStorage.getItem("__voice")) { window.SpeechRecognition = undefined; delete window.webkitSpeechRecognition; return; }
  // the hands-free run: a recognizer that hears nothing (no-speech, then end), a voice that speaks for a moment, no media devices
  try { Object.defineProperty(navigator, "mediaDevices", { value: undefined }); } catch {}
  class Rec { start() { setTimeout(() => { this.onerror?.({ error: "no-speech" }); this.onend?.(); }, 700); } stop() {} abort() {} }
  window.SpeechRecognition = Rec; window.webkitSpeechRecognition = Rec;
  let busy = false;
  speechSynthesis.getVoices = () => [{ name: "Test", lang: "en-US", localService: true }];
  speechSynthesis.speak = (u) => { busy = true; setTimeout(() => u.onstart?.(), 20); setTimeout(() => { busy = false; u.onend?.(); }, 800); };
  speechSynthesis.cancel = () => { busy = false; };
  Object.defineProperty(speechSynthesis, "speaking", { get: () => busy }); })();` });
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: phone });
if (phone) { await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 }); await send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" }); }
const q = new URLSearchParams({ brand: prof.brand, city: prof.city });
const planUrl = `${base}/app?ors=off&instant=1#/plan?${q}`;
await send("Page.navigate", { url: planUrl });
await waitFor(`!!document.querySelector(".stop[data-id]")`, 40000);
await sleep(2000);
await send("Page.reload"); await waitFor(`!!document.querySelector(".stop[data-id]")`, 40000); await sleep(2000);
const report = { width: W, height: H };
const ASK = '[data-agent="open"]'; // the plan's Ask Doors: the floating button at a phone width, the toolbar's when wide

// ---- A. the plan's Ask ----
await shot("a0-plan");
const scrollBefore = await ev("scrollY");
await click(ASK, { scroll: false });
await waitFor(`!document.querySelector("#agentPanel").hidden`, 5000);
await sleep(600);
await shot("a1-agent");
report.plan = await panelInfo();
report.plan.inHistory = await inHist();
if (phone) {
  must(fullScreen(report.plan), `the plan's Agent is the whole screen (${JSON.stringify(report.plan.panel)}, screen ${W}×${H})`);
  must(report.plan.atTop === "panel" && report.plan.atMid === "panel" && report.plan.atBottom === "panel", `the panel is what a finger hits at the top, the middle and the bottom (${report.plan.atTop}, ${report.plan.atMid}, ${report.plan.atBottom})`);
  must(report.plan.title && /Doors Agent/.test(report.plan.title.text) && report.plan.title.size >= 16, `its name is a clear title at the top (${JSON.stringify(report.plan.title)})`);
  must(report.plan.close && report.plan.close.w >= 44 && report.plan.close.h >= 44 && report.plan.close.b <= 80 && report.plan.close.r >= W - 16, `a 44 px × at the top right (${JSON.stringify(report.plan.close)})`);
  must(report.plan.input && report.plan.input.b <= H && report.plan.input.b > H - 120, `the box sits at the bottom (${JSON.stringify(report.plan.input)})`);
  must(report.plan.starters >= 1, "the starter asks show");
  must(report.plan.inHistory, "the open panel is a history entry (Back closes it)");
  must(report.plan.bodyPos === "fixed", `the page under it is locked (${report.plan.bodyPos})`);
  must(report.plan.radius === "0px", `no sheet corners (${report.plan.radius})`);
} else {
  must(report.plan.panel.w === 380 && Math.abs(report.plan.panel.r - (W - 16)) <= 0.5 && Math.abs(report.plan.panel.b - (H - 16)) <= 0.5, `wide: the card over the map's right edge as before (${JSON.stringify(report.plan.panel)})`);
  must(!report.plan.inHistory, "wide: no history entry");
  must(report.plan.bodyPos !== "fixed", "wide: the page is not locked");
}
// ---- B. the keyboard up: the box just above it, the × still in view ----
if (phone) {
  await ev(`document.querySelector("#agentInput").focus()`);
  await keyboard(true);
  await sleep(400);
  await shot("a2-keyboard");
  report.keyboard = await panelInfo();
  must(fullScreen(report.keyboard, H - KB), `with the keyboard up the panel spans the visible screen, its bottom at the keyboard (${JSON.stringify(report.keyboard.panel)}, keyboard top ${H - KB})`);
  must(report.keyboard.input && report.keyboard.input.b <= H - KB + 1 && report.keyboard.input.b > H - KB - 100, `the box sits just above the keyboard (${JSON.stringify(report.keyboard.input)})`);
  must(report.keyboard.close && report.keyboard.close.t >= 0 && report.keyboard.close.b <= 80, `the × is still at the top (${JSON.stringify(report.keyboard.close)})`);
  // a few lines typed: the box grows up to its cap, the thread above it
  await ev(`(() => { const i = document.querySelector("#agentInput"); i.value = "Which of these doors should I do first, and what do I say to the buyer at the second one?\\nAlso move the last one to Friday."; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await sleep(300);
  report.grown = await panelInfo();
  must(report.grown.input.h > report.keyboard.input.h && report.grown.input.b <= H - KB + 1, `the box grows with its text, still above the keyboard (${report.keyboard.input.h} → ${report.grown.input.h})`);
  await shot("a3-grown");
  // send: the rules answer (NO_MODEL)
  await click('[data-agent="send"]', { scroll: false });
  await waitFor(`document.querySelectorAll('#agentLog .agent-msg[data-role="agent"]').length >= 1 && document.querySelector("#agentPanel").dataset.state !== "thinking"`, 20000);
  await sleep(400);
  await keyboard(false);
  await sleep(400);
  await shot("a4-reply");
  report.reply = await ev(`(() => { const m = [...document.querySelectorAll('#agentLog .agent-msg[data-role="agent"]')].at(-1); const r = m.getBoundingClientRect(); const l = document.querySelector("#agentLog").getBoundingClientRect(); return { text: m.textContent.slice(0, 80), t: r.top, b: r.bottom, logT: l.top, logB: l.bottom, inView: r.top >= l.top - 1 && r.top < l.bottom }; })()`);
  must(report.reply.inView, `the answer is in view in the thread (${JSON.stringify(report.reply)})`);
  must(fullScreen(await panelInfo()), "after the reply the panel is still the whole screen");
}
// ---- C. Escape closes; Back closes ----
await ev(`document.querySelector("#agentInput").focus()`);
await key("Escape");
await waitFor(`document.querySelector("#agentPanel").hidden`, 3000);
await sleep(500);
report.afterEscape = { open: await open(), inHistory: await inHist(), bodyPos: await ev(`getComputedStyle(document.body).position`), scrollY: await ev("scrollY"), agentOpenClass: await ev(`document.documentElement.classList.contains("agent-open")`), hash: await ev("location.hash") };
must(!report.afterEscape.open && !report.afterEscape.inHistory && report.afterEscape.bodyPos !== "fixed" && !report.afterEscape.agentOpenClass, `Escape closes it and its history entry goes (${JSON.stringify(report.afterEscape)})`);
must(report.afterEscape.scrollY === scrollBefore, `the page is where it was (${scrollBefore} → ${report.afterEscape.scrollY})`);
await shot("a5-closed");
if (phone) {
  await click(ASK, { scroll: false });
  await waitFor(`!document.querySelector("#agentPanel").hidden`, 5000);
  await sleep(300);
  if (await inHist()) { await ev("history.back()"); await waitFor(`document.querySelector("#agentPanel").hidden`, 3000); } // (the base build has no entry: Back would leave the page)
  else { await ev(`document.querySelector("#agentPanel .aclose").click()`); await waitFor(`document.querySelector("#agentPanel").hidden`, 3000); }
  await sleep(300);
  report.afterBack = { open: await open(), inHistory: await inHist(), hash: await ev("location.hash"), plan: await visible(".stop[data-id]") };
  must(!report.afterBack.open && !report.afterBack.inHistory && report.afterBack.plan, `Back (the phone's swipe) closes it, the plan is still there (${JSON.stringify(report.afterBack)})`);
  await shot("a6-after-back");
}

// ---- D. a door's Ask about this door ----
await ev(`document.querySelector('.stop[data-id] [data-open]').click()`); // the list's drag handler takes a synthetic press
await waitFor(`!!document.querySelector(".stopview:not([hidden]) .atdoor, .stopview:not([hidden]) .dafter")`, 15000);
await sleep(600);
await shot("b0-door");
await ev(`document.querySelector('.stopview:not([hidden]) [data-s="ask"]').click()`); // the card's Ask about this door (wide: the notes form's link, below the fold)
await waitFor(`!document.querySelector("#agentPanel").hidden`, 5000);
await sleep(600);
await shot("b1-door-agent");
report.door = await panelInfo();
if (phone) {
  must(fullScreen(report.door), `Ask about this door: the whole screen (${JSON.stringify(report.door.panel)})`);
  must(report.door.atTop === "panel" && report.door.atMid === "panel", `the door is under it (${report.door.atTop}, ${report.door.atMid})`);
  if (await inHist()) { await ev("history.back()"); await waitFor(`document.querySelector("#agentPanel").hidden`, 3000); }
  else { await ev(`document.querySelector("#agentPanel .aclose").click()`); await waitFor(`document.querySelector("#agentPanel").hidden`, 3000); }
  await sleep(400);
  report.doorAfterBack = { open: await open(), door: await visible(".stopview:not([hidden])") };
  must(!report.doorAfterBack.open && report.doorAfterBack.door, `Back closes it and the door is still open (${JSON.stringify(report.doorAfterBack)})`);
  await shot("b2-door-back");
} else {
  must(report.door.panel.w === 380, `wide: the card as before (${JSON.stringify(report.door.panel)})`);
  await ev(`document.querySelector("#agentPanel .aclose").click()`); await waitFor(`document.querySelector("#agentPanel").hidden`, 3000); // (a door open too: its own Escape takes the key first)
}

// ---- E. drive mode, Voice off: the Agent button, then Type instead ----
// r8hf (merged after this lane): the drive Agent never falls back to typing without a word, so the Agent button brings
// up the hands-free bar (Not listening, with Listen / Type instead), never the panel; Type instead opens the panel,
// and on a phone that panel is the whole screen (this lane). Both hold here.
await send("Page.navigate", { url: `${base}/app?ors=off&instant=1#/plan?${new URLSearchParams({ brand: prof.brand, city: prof.city, drive: "1" })}` });
await waitFor(`!!document.querySelector("[data-drive-door]") && document.documentElement.classList.contains("driving")`, 40000);
await sleep(1200);
await shot("c0-drive");
await click("[data-drive-ask]", { scroll: false });
await waitFor(`!!document.querySelector(".hf") && !document.querySelector(".hf").hidden`, 5000);
await sleep(600);
report.driveAsk = { hfPhase: await ev(`document.querySelector(".hf")?.dataset.phase`), panelOpen: await open() };
must(!report.driveAsk.panelOpen, `the Agent button brings up the hands-free bar, not the panel (phase ${report.driveAsk.hfPhase})`);
await shot("c0b-drive-bar");
await click("[data-hf-type]", { scroll: false });
await waitFor(`!document.querySelector("#agentPanel").hidden`, 5000);
await sleep(600);
await shot("c1-drive-agent");
report.drive = await panelInfo();
report.drive.driving = await ev(`document.documentElement.classList.contains("driving")`);
if (phone) {
  must(fullScreen(report.drive), `drive mode's Agent: the whole screen (${JSON.stringify(report.drive.panel)})`);
  must(report.drive.atTop === "panel" && report.drive.atMid === "panel" && report.drive.atBottom === "panel", `drive mode is under it (${report.drive.atTop}, ${report.drive.atMid}, ${report.drive.atBottom})`);
  must(/rgb\(24, 33, 30\)/.test(report.drive.bg), `dark, as drive mode (${report.drive.bg})`);
  await ev(`document.querySelector("#agentInput").focus()`);
  await keyboard(true); await sleep(300);
  const k = await panelInfo();
  must(fullScreen(k, H - KB) && k.input.b <= H - KB + 1, `drive mode, keyboard up: the box above it (${JSON.stringify(k.input)})`);
  await shot("c2-drive-keyboard");
  await keyboard(false); await sleep(200);
}
await click("#agentPanel .aclose", { scroll: false }); // the × (Escape here is drive mode's too: it closes the day as well, wide, as before this lane)
await waitFor(`document.querySelector("#agentPanel").hidden`, 3000);
await sleep(400);
report.driveAfter = { open: await open(), driving: await ev(`document.documentElement.classList.contains("driving")`), door: await visible("[data-drive-door]"), inHistory: await inHist() };
must(!report.driveAfter.open && report.driveAfter.driving && report.driveAfter.door && !report.driveAfter.inHistory, `closing returns to the drive screen (${JSON.stringify(report.driveAfter)})`);
await shot("c3-drive-back");

// ---- F. drive mode, Voice on: the hands-free bar's Type instead ----
if (phone) {
  await ev(`localStorage.setItem("doors:drive-voice", "on"); localStorage.setItem("__voice", "1")`);
  await send("Page.reload");
  await waitFor(`!!document.querySelector("[data-drive-door]") && document.documentElement.classList.contains("driving")`, 40000);
  await waitFor(`document.documentElement.classList.contains("hf-open") && !!document.querySelector(".hf") && !document.querySelector(".hf").hidden`, 10000);
  await sleep(1500);
  await shot("d0-handsfree");
  report.hf = { bar: await rect(".hf"), phase: await ev(`document.querySelector(".hf")?.dataset.phase`) };
  await click("[data-hf-type]", { scroll: false });
  await waitFor(`!document.querySelector("#agentPanel").hidden`, 5000);
  await sleep(600);
  await shot("d1-type-instead");
  report.typeInstead = await panelInfo();
  report.typeInstead.hfShown = await visible(".hf");
  report.typeInstead.hfPhase = await ev(`document.querySelector(".hf")?.dataset.phase`);
  must(fullScreen(report.typeInstead), `Type instead: the whole screen (${JSON.stringify(report.typeInstead.panel)})`);
  must(!report.typeInstead.hfShown && report.typeInstead.atBottom === "panel", `the hands-free bar is under it, not over the box (bar shown ${report.typeInstead.hfShown}, at the bottom: ${report.typeInstead.atBottom})`);
  must(report.typeInstead.hfPhase === "muted", `the bar is muted while typing (${report.typeInstead.hfPhase})`);
  await click("#agentPanel .aclose", { scroll: false });
  await waitFor(`document.querySelector("#agentPanel").hidden`, 3000);
  await sleep(500);
  report.typeAfter = { open: await open(), hfShown: await visible(".hf"), hfOpen: await ev(`document.documentElement.classList.contains("hf-open")`), phase: await ev(`document.querySelector(".hf")?.dataset.phase`), driving: await ev(`document.documentElement.classList.contains("driving")`), bar: await rect(".hf") };
  must(!report.typeAfter.open && report.typeAfter.hfShown && report.typeAfter.hfOpen && report.typeAfter.driving && report.typeAfter.bar && Math.abs(report.typeAfter.bar.b - H) <= 1, `× brings the drive screen and its bar back (${JSON.stringify(report.typeAfter)})`);
  await shot("d2-bar-back");
  // Listen again works: the bar's button
  await click("[data-hf-mute]", { scroll: false });
  await sleep(300);
  report.typeAfter.listenAgain = await ev(`document.querySelector(".hf")?.dataset.phase`);
  must(report.typeAfter.listenAgain === "listen" || report.typeAfter.listenAgain === "think", `Listen works again (${report.typeAfter.listenAgain})`);
}

report.problems = problems;
fs.writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
if (problems.length) { console.error(`r8agentfull ${W}×${H}: ${problems.length} problem(s)\n` + problems.map((p) => `  - ${p}`).join("\n")); process.exit(1); }
console.log(`r8agentfull ${W}×${H}: ok (${out})`);
process.exit(0);
