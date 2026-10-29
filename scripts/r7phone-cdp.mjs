// Round 7 lane phone (Jard 10-27, his iPhone shots of the web app at :8793): the Doors Agent at a phone width feels part
// of the app (a sheet over the lower part of the screen, the map still in view above it, a slim row with its name and a
// 44 px ×, a one-line box that grows, the mic and a round Send) and works with the keyboard up (the sheet follows the
// visual viewport, so the box, the thread and the × stay above the keyboard; the page under it never scrolls; the
// demo's banner never floats over the thread); the map's speed slider and Watch all are gone at a phone width (kept
// wide); My doors has no intro paragraph and its × sits centred in a true circle, as does every round × in the app.
// Measured in headless Chromium over CDP with a faked iOS keyboard: window.visualViewport's height/offsetTop are
// overridden and a resize event fired, which is what the app listens to. Seeds Maya's demo profile (Austin; the
// route replays from data/kv-dev, no Qloo call, NO_MODEL: the rules answer).
// Usage: node scripts/r7phone-cdp.mjs <base-url> <out-dir> [width] [height] [plan|demo] [strict|measure]
//   demo: the guided demo's finished plan (?instant=1#/demo), with its banner; measure: numbers only, no checks (base shots)
import { spawn } from "node:child_process";
import fs from "node:fs";
import { demoProfile } from "../public/lib/demo-profile.js";
import { storeKey, STORE_VERSION, BRAND_KEY } from "../public/lib/store.js";
const [base, out, w = "390", h = "844", modeArg = "plan", strictArg = "strict"] = process.argv.slice(2);
const strict = strictArg !== "measure";
const demo = modeArg === "demo";
fs.mkdirSync(out, { recursive: true });
const port = 9800 + Math.floor(Math.random() * 150);
const dir = `/tmp/claude-1000/r7phone-${port}`;
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
const waitFor = async (expr, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(expr)) return true; await sleep(150); } await shot("zz-timeout"); throw new Error(`timed out: ${expr}\n${problems.join("\n")}`); };
const check = (ok, what) => { if (!ok) problems.push(`check failed: ${what}`); };
const must = (ok, what) => { if (strict) check(ok, what); };
const rect = (sel) => ev(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.getClientRects().length); if (!e) return null; const b = e.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; })()`);
const visible = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; })()`);
const hit = (a, b) => a && b && a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
const KB = 336; // an iPhone's keyboard with its accessory bar, about
// the faked keyboard: the visual viewport loses KB px at the bottom (iOS scrolls nothing here: the app keeps its page
// still), and the app hears the resize
const keyboard = (on) => ev(`(() => { const vv = window.visualViewport; if (!vv) return null; const kb = ${on ? KB : 0};
  Object.defineProperty(vv, "height", { configurable: true, get: () => innerHeight - kb });
  Object.defineProperty(vv, "offsetTop", { configurable: true, get: () => 0 });
  Object.defineProperty(vv, "pageTop", { configurable: true, get: () => scrollY });
  vv.dispatchEvent(new Event("resize")); return vv.height; })()`);
// a round × button: square, a circle, and its glyph (svg or text) centred in it
const roundX = (sel) => ev(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.getClientRects().length); if (!b) return null; const r = b.getBoundingClientRect(); const cs = getComputedStyle(b);
  let g = b.querySelector("svg")?.getBoundingClientRect(); if (!g) { const rg = document.createRange(); rg.selectNodeContents(b); g = rg.getBoundingClientRect(); }
  const rad = parseFloat(cs.borderRadius); return { w: +r.width.toFixed(1), h: +r.height.toFixed(1), radius: rad, square: Math.abs(r.width - r.height) < .6, circle: rad >= Math.min(r.width, r.height) / 2 - .5,
    dx: +((g.left + g.width / 2) - (r.left + r.width / 2)).toFixed(1), dy: +((g.top + g.height / 2) - (r.top + r.height / 2)).toFixed(1), glyph: b.querySelector("svg") ? "svg" : "text", pad: cs.padding }; })()`);
const xOk = (x) => x && x.square && x.circle && x.glyph === "svg" && Math.abs(x.dx) <= 1 && Math.abs(x.dy) <= 1; // the icon set's ×: its box is its ink, so centred means centred

const prof = demoProfile(new Date());
prof.known = [];
const key = storeKey(prof.brand, prof.city);
await send("Runtime.enable"); await send("Page.enable");
const state = { v: STORE_VERSION, brand: prof.brand, city: prof.city, profile: prof, plan: null, statuses: {}, outcomes: {}, savedAt: new Date().toISOString() };
await send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => { try { if (!localStorage.getItem("__seeded")) { localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify(state))}); localStorage.setItem(${JSON.stringify(BRAND_KEY)}, ${JSON.stringify(JSON.stringify({ v: STORE_VERSION, profile: prof, savedAt: new Date().toISOString() }))}); localStorage.setItem("doors:drive-voice", "off"); localStorage.setItem("__seeded", "1"); } } catch {} window.SpeechRecognition = undefined; delete window.webkitSpeechRecognition; })();` });
const phone = +w <= 700;
await send("Emulation.setDeviceMetricsOverride", { width: +w, height: +h, deviceScaleFactor: 1, mobile: phone });
if (phone) await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 }); // (mouse events stay mouse events: with setEmitTouchEventsForMouse a dispatched press never resolved)
const q = new URLSearchParams({ brand: prof.brand, city: prof.city });
await send("Page.navigate", { url: demo ? `${base}/app?ors=off&instant=1#/demo` : `${base}/app?ors=off&instant=1#/plan?${q}` });
await waitFor(`!!document.querySelector(".stop[data-id]")`, 40000);
await sleep(2500);
if (!demo) { await send("Page.reload"); await waitFor(`!!document.querySelector(".stop[data-id]")`, 40000); await sleep(2500); }
else { // the tour's end card ("Explore on your own") is up: Close it, as a visitor would
  if (await ev(`!!document.querySelector(".ccard:not([hidden]) .cbtns .lnk")`)) { await click(".ccard:not([hidden]) .cbtns .lnk", { scroll: false }); await sleep(600); }
  must(!(await visible(".ccard")), "the tour's end card closed");
}
const report = { width: +w, height: +h, mode: modeArg };

// ---- #2 the map's bar: Watch the route stays; the speed slider and Watch all go at a phone width ----
await shot("a1-plan");
report.runbar = { bar: await visible(".mapwrap .runbar"), play: await visible(".runbar .rb-play"), speed: await visible(".runbar .rb-speed"), all: await visible(".runbar .rb-all"), barRect: await rect(".mapwrap .runbar") };
report.runbar.stop = await visible(".runbar .rb-stop");
report.runbar.listPlay = await ev(`!!document.querySelector("[data-run-route]")`);
// a phone: no slider, no Watch all; the bar shows only while Watch the route or Stop is in it (All days with 2+ days has
// neither: the day's own Watch button in the list plays it)
if (phone) must(!report.runbar.speed && !report.runbar.all && report.runbar.bar === (report.runbar.play || report.runbar.stop), `at ${w} the map's bar has no speed slider and no Watch all, and hides when empty (${JSON.stringify(report.runbar)})`);
else must(report.runbar.bar && report.runbar.speed && report.runbar.all, `at ${w} the map's bar keeps the speed slider and Watch all (${JSON.stringify(report.runbar)})`);
if (phone) {
  const bar = report.runbar.barRect, map = await rect(".mapwrap .m");
  if (bar) must(map && bar.r <= map.r + 1 && bar.b <= map.b + 1, `the bar sits inside the map (${JSON.stringify({ bar, map })})`);
  report.pageWidth = await ev(`document.documentElement.scrollWidth`);
  must(report.pageWidth <= +w, `the page is no wider than the screen (${report.pageWidth})`);
}

if (demo && phone) {
  await click(".daytabs .dtdays button");
  await sleep(600);
  report.runbarDay = { bar: await visible(".mapwrap .runbar"), play: await visible(".runbar .rb-play"), speed: await visible(".runbar .rb-speed"), all: await visible(".runbar .rb-all") };
  must(report.runbarDay.bar && report.runbarDay.play && !report.runbarDay.speed && !report.runbarDay.all, `a day's map shows Watch the route alone (${JSON.stringify(report.runbarDay)})`);
  await shot("a2-day-bar");
  await click(".daytabs .wk");
  await sleep(600);
  report.runbarWeek = { bar: await visible(".mapwrap .runbar") };
  must(!report.runbarWeek.bar, `All days shows no bar at a phone width (${JSON.stringify(report.runbarWeek)})`);
  await ev(`window.scrollTo(0, 0)`);
  await sleep(200);
}

// ---- #1 the Agent at a phone width ----
const scrollBefore = await ev(`scrollY`);
await click(".mapwrap .btn.ask");
await waitFor(`!document.querySelector("#agentPanel").hidden`, 5000);
await sleep(600);
await shot("b1-agent");
const panelInfo = async () => ev(`(() => { const p = document.querySelector("#agentPanel"); const r = p.getBoundingClientRect(); const vv = visualViewport; const g = (s) => { const e = p.querySelector(s); if (!e || !e.getClientRects().length) return null; const b = e.getBoundingClientRect(); return { l: +b.left.toFixed(1), t: +b.top.toFixed(1), r: +b.right.toFixed(1), b: +b.bottom.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) }; };
  const map = document.querySelector(".mapwrap .m")?.getBoundingClientRect(); const banner = document.querySelector(".demo-banner")?.getBoundingClientRect();
  return { panel: { t: +r.top.toFixed(1), b: +r.bottom.toFixed(1), l: +r.left.toFixed(1), r: +r.right.toFixed(1), h: +r.height.toFixed(1) }, vv: { h: vv.height, top: vv.offsetTop }, inner: innerHeight, scrollY, head: g(".ahead"), headText: p.querySelector(".ahead")?.textContent.trim() ?? "", close: g('[data-agent="close"]'), log: g(".alog"), form: g(".aform"), input: g("#agentInput"), rows: +document.querySelector("#agentInput").rows, inputH: document.querySelector("#agentInput").getBoundingClientRect().height, sendText: [...p.querySelectorAll('[data-agent="send"] .lbl')].some((l) => l.getBoundingClientRect().width > 2) ? p.querySelector('[data-agent="send"]').textContent.trim() : "", send: g('[data-agent="send"]'), mic: g('[data-agent="mic"]'), foot: g(".afoot"), privacy: !!p.querySelector(".afoot a") && p.querySelector(".afoot a").getClientRects().length > 0,
    mapBottom: map ? +map.bottom.toFixed(1) : null, mapTop: map ? +map.top.toFixed(1) : null, banner: banner ? { t: +banner.top.toFixed(1), b: +banner.bottom.toFixed(1) } : null, bannerZ: document.querySelector(".demo-banner") ? getComputedStyle(document.querySelector(".demo-banner")).zIndex : null, panelZ: getComputedStyle(p).zIndex, bodyOverflow: getComputedStyle(document.body).overflow, htmlOverflow: getComputedStyle(document.documentElement).overflow, scrim: !!document.querySelector(".ascrim") && getComputedStyle(document.querySelector(".ascrim")).display !== "none", bg: getComputedStyle(p).backgroundColor, radius: getComputedStyle(p).borderTopLeftRadius, enterkeyhint: document.querySelector("#agentInput").getAttribute("enterkeyhint"), fab: !!document.querySelector(".mapwrap .btn.ask") && document.querySelector(".mapwrap .btn.ask").getClientRects().length > 0 && getComputedStyle(document.querySelector(".mapwrap .btn.ask")).display !== "none" }; })()`);
report.open = await panelInfo();
if (phone) {
  const o = report.open;
  must(o.panel.t >= o.mapBottom - 1, `the sheet starts under the map, so the map stays in view (sheet top ${o.panel.t}, map bottom ${o.mapBottom})`);
  must(o.panel.b >= o.inner - 1, `the sheet sits on the screen's bottom (sheet bottom ${o.panel.b}, screen ${o.inner})`);
  must(o.panel.l <= 0.5 && o.panel.r >= +w - 0.5, `the sheet spans the screen's width (${o.panel.l}–${o.panel.r})`);
  must(!o.head || o.head.h <= 40, `no section header: the name row is slim (${JSON.stringify(o.head)})`);
  must(o.close && o.close.w >= 44 && o.close.h >= 44, `the × is a 44 px target (${JSON.stringify(o.close)})`);
  must(o.rows === 1 && o.inputH <= 48, `the box is one line tall at rest (rows ${o.rows}, ${o.inputH} px)`);
  must(o.send && Math.abs(o.send.w - o.send.h) < 1 && o.send.w >= 40 && o.sendText === "", `Send is a round icon button (${JSON.stringify(o.send)} "${o.sendText}")`);
  must(!o.privacy, `no Privacy line in the sheet (the Menu has it)`);
  must(o.enterkeyhint === "send", `the keyboard's return key says send (${o.enterkeyhint})`);
  must(!o.fab, `the round Agent button hides while the sheet is open`);
  must(o.htmlOverflow === "hidden" || o.bodyOverflow === "hidden", `the page under the sheet is locked (html ${o.htmlOverflow}, body ${o.bodyOverflow})`);
  if (demo) must(o.banner && (!hit({ l: 0, t: o.banner.t, r: +w, b: o.banner.b }, { l: 0, t: o.panel.t, r: +w, b: o.panel.b }) || +o.panelZ > +o.bannerZ), `the demo banner never draws over the sheet (banner ${JSON.stringify(o.banner)} z ${o.bannerZ}, sheet top ${o.panel.t} z ${o.panelZ})`);
}
// the keyboard comes up: the box, the thread and the × stay above it; the page does not move
await click("#agentInput", { scroll: false });
await send("Input.insertText", { text: "Make the opener for Nomadic Beerworks shorter" });
if (phone) {
  report.kbH = await keyboard(true);
  await sleep(500);
  await shot("b2-keyboard");
  const k = (report.keyboard = await panelInfo());
  const vvB = k.inner - KB;
  must(k.form && k.form.b <= vvB + 1, `with the keyboard up the box sits above it (box bottom ${k.form?.b}, keyboard top ${vvB})`);
  must(k.close && k.close.b <= vvB + 1 && k.close.t >= 0, `the × stays on screen above the keyboard (${JSON.stringify(k.close)})`);
  must(k.log && k.log.h >= 72 && k.log.t >= 0, `the thread keeps room above the box (${JSON.stringify(k.log)})`);
  must(k.panel.t >= 56, `the app bar still peeks above the sheet with the keyboard up (sheet top ${k.panel.t})`);
  must(k.panel.t >= k.mapBottom - 1 || k.panel.t >= 0, `the sheet starts on screen (${k.panel.t})`);
  must(k.scrollY === scrollBefore, `the page did not scroll under the sheet (${k.scrollY} vs ${scrollBefore})`);
  must(k.inputH <= 70, `the box is one or two lines with a 46-letter message (${k.inputH})`);
  if (demo) must(k.banner && (!hit({ l: 0, t: k.banner.t, r: +w, b: k.banner.b }, k.log) || +k.panelZ > +k.bannerZ), `the banner is not over the thread (${JSON.stringify({ banner: k.banner, log: k.log, z: [k.bannerZ, k.panelZ] })})`);
  // a longer message grows the box, to a cap
  await send("Input.insertText", { text: "\nand tell me who does the buying there, and when they are in, and whether Tuesday works." });
  await sleep(200);
  report.grown = await ev(`(() => { const i = document.querySelector("#agentInput"); return { h: i.getBoundingClientRect().height, rows: i.rows, scrollH: i.scrollHeight, formB: i.closest("form").getBoundingClientRect().bottom, logH: document.querySelector("#agentLog").getBoundingClientRect().height }; })()`);
  must(report.grown.h > report.keyboard.inputH + 10 && report.grown.h <= 130, `the box grows with the text, to a cap (${JSON.stringify(report.grown)})`);
  must(report.grown.formB <= vvB + 1, `the grown box still sits above the keyboard (${report.grown.formB} vs ${vvB})`);
  await shot("b2b-grown");
  await ev(`(() => { const i = document.querySelector("#agentInput"); i.value = "Make the opener for Nomadic Beerworks shorter"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`);
  await sleep(150);
}
// send: the rules answer (NO_MODEL); at a phone width the keyboard goes (the box blurs) as the phone app does
await click('[data-agent="send"]', { scroll: false });
await waitFor(`document.querySelectorAll('#agentLog .agent-msg[data-role="agent"]').length >= 1 && document.querySelector("#agentPanel").dataset.state !== "thinking"`, 20000);
await sleep(400);
if (phone) {
  report.blurred = await ev(`document.activeElement !== document.querySelector("#agentInput")`);
  must(report.blurred, `after Send the box is no longer focused (the keyboard goes, as on the phone app)`);
  await keyboard(false);
  await sleep(400);
}
await shot("b3-reply");
report.reply = await ev(`(() => { const m = [...document.querySelectorAll('#agentLog .agent-msg[data-role="agent"]')].at(-1); const r = m.getBoundingClientRect(); const l = document.querySelector("#agentLog").getBoundingClientRect(); return { text: m.textContent.slice(0, 80), t: r.top, b: r.bottom, logT: l.top, logB: l.bottom, inView: r.top >= l.top - 1 && r.top < l.bottom }; })()`);
must(report.reply.inView, `the answer is in view in the thread (${JSON.stringify(report.reply)})`);
// the thread scrolls inside itself, the page not at all
if (phone) {
  await ev(`(() => { for (let i = 0; i < 6; i++) document.dispatchEvent(new Event("noop")); })()`);
  const l = await rect("#agentLog");
  await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: (l.l + l.r) / 2, y: (l.t + l.b) / 2, deltaX: 0, deltaY: -200 });
  await sleep(300);
  report.wheel = { scrollY: await ev(`scrollY`), logTop: await ev(`document.querySelector("#agentLog").scrollTop`) };
  must(report.wheel.scrollY === scrollBefore, `a scroll over the thread never moves the page (${report.wheel.scrollY})`);
}
report.xAgent = await roundX('#agentPanel [data-agent="close"]');
must(xOk(report.xAgent), `the Agent's × is a circle with the glyph centred (${JSON.stringify(report.xAgent)})`);
// close with the keyboard up: the × is reachable
if (phone) {
  await click("#agentInput", { scroll: false });
  await keyboard(true);
  await sleep(300);
  const c = await rect('#agentPanel [data-agent="close"]');
  must(c && c.b <= +h - KB + 1, `with the keyboard up the × is above it (${JSON.stringify(c)})`);
  await shot("b4-close-with-keyboard");
}
if (phone) {
  await click('#agentPanel [data-agent="close"]', { scroll: false });
  await sleep(300);
  await keyboard(false);
  must(await ev(`document.querySelector("#agentPanel").hidden`), "the × closes the sheet with the keyboard up");
  // and a tap beside the sheet (the map) closes it too
  await click(".mapwrap .btn.ask");
  await waitFor(`!document.querySelector("#agentPanel").hidden`, 5000);
  await sleep(300);
  const m = await rect(".mapwrap .m");
  await mouse("mouseMoved", 60, m.t + 40); await mouse("mousePressed", 60, m.t + 40); await mouse("mouseReleased", 60, m.t + 40);
  await sleep(300);
  report.scrimTap = await ev(`document.querySelector("#agentPanel").hidden`);
  must(report.scrimTap, "a tap on the map beside the sheet closes it");
  if (!report.scrimTap) await click('#agentPanel [data-agent="close"]', { scroll: false });
} else {
  await click('#agentPanel [data-agent="close"]', { scroll: false });
  await sleep(300);
}
await sleep(200);
report.closed = await ev(`({ hidden: document.querySelector("#agentPanel").hidden, fab: document.querySelector(".mapwrap .btn.ask").getClientRects().length > 0 && getComputedStyle(document.querySelector(".mapwrap .btn.ask")).display !== "none", scrollY, htmlOverflow: getComputedStyle(document.documentElement).overflow, bodyPos: getComputedStyle(document.body).position })`);
must(report.closed.hidden && report.closed.fab && report.closed.scrollY === scrollBefore && report.closed.htmlOverflow !== "hidden" && report.closed.bodyPos !== "fixed", `closed: the sheet goes, the button is back, the page is where it was and scrolls again (${JSON.stringify(report.closed)})`);
await shot("b5-closed");
// the page scrolls again after a close (the lock is lifted)
if (phone) {
  await ev(`window.scrollTo(0, 400)`);
  await sleep(200);
  report.scrollAfter = await ev(`scrollY`);
  must(report.scrollAfter > 0, `the page scrolls after the sheet closes (${report.scrollAfter})`);
  await ev(`window.scrollTo(0, 0)`);
  await sleep(200);
}

// ---- #3 My doors: no intro paragraph; the × a true circle, centred ----
await click('.tools [data-drawer="logbook"]');
await waitFor(`!document.querySelector("#logbook").hidden && !!document.querySelector("#logbook h3")`, 10000);
await sleep(500);
await shot("c1-mydoors");
report.logbook = await ev(`(() => { const lb = document.querySelector("#logbook"); return { sub: !!lb.querySelector(".lb-sub"), intro: /Every door you/.test(lb.textContent), saved: /Saved on this device only/.test(lb.textContent), savedWhere: lb.querySelector(".lb-saved")?.closest(".lb-export, .lb-foot, .lb-sum")?.className ?? null, h3: lb.querySelector("h3")?.textContent, firstAfterHead: lb.querySelector(".lb-head")?.nextElementSibling?.className }; })()`);
must(!report.logbook.sub && !report.logbook.intro, `My doors has no intro paragraph (${JSON.stringify(report.logbook)})`);
must(report.logbook.saved, `"Saved on this device only." still shows somewhere small (${JSON.stringify(report.logbook)})`);
report.xLogbook = await roundX("#logbook .lb-x");
must(xOk(report.xLogbook), `My doors' × is a circle with the glyph centred (${JSON.stringify(report.xLogbook)})`);
if (phone) must(report.xLogbook && report.xLogbook.w >= 36, `My doors' × is at least 36 px (${report.xLogbook?.w})`);
await click("#logbook .lb-x");
await sleep(400);
// every other round × that shows on the plan: the Market's
if (await ev(`!!document.querySelector('.tools [data-drawer="why"], .tools [data-why]')`)) {
  await click('.tools [data-drawer="why"], .tools [data-why]');
  await waitFor(`!!document.querySelector("#why .w-x") && document.querySelector("#why .w-x").getClientRects().length`, 10000);
  await sleep(500);
  report.xWhy = await roundX("#why .w-x");
  must(xOk(report.xWhy), `the Market's × is a circle with the glyph centred (${JSON.stringify(report.xWhy)})`);
  await shot("c2-market-x");
  await click("#why .w-x");
  await sleep(300);
}

console.log(JSON.stringify(report, null, 1));
if (problems.length) { console.error(problems.join("\n")); process.exit(2); }
console.log("OK");
process.exit(0);
