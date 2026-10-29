// Round 8 (Jard 10-28 19:53, Brave iOS on :8793): the Doors logo sat under the iPhone's status bar on the landing page.
// Brave's bottom-bar mode lays the page out under the status bar; without viewport-fit=cover the page gets no inset.
// Now (viewport-fit=cover + --sat in css/doors.css) every top bar pads by env(safe-area-inset-top). This measures
// each top bar at a phone width with the status bar emulated (CDP Emulation.setSafeAreaInsetsOverride, top = 59 px,
// the iPhone 15's): the bar's background starts at 0 (covers the strip) and its first content sits at or under
// the strip's bottom edge. Screens: landing, privacy, the app (plan: header, day tabs while scrolled; Why these
// doors; My doors; the stop's room view; Drive; the tour's banner). Seeds Maya's demo profile (route replays from
// data/kv-dev, no Qloo call, NO_MODEL).
// Usage: node scripts/r8logo-cdp.mjs <base-url> <out-dir> [width] [height] [inset] [strict|measure]
import { spawn } from "node:child_process";
import fs from "node:fs";
import { demoProfile } from "../public/lib/demo-profile.js";
import { storeKey, STORE_VERSION, BRAND_KEY } from "../public/lib/store.js";
const [base, out, w = "390", h = "844", insetArg = "59", strictArg = "strict"] = process.argv.slice(2);
const SAT = +insetArg;
const strict = strictArg !== "measure";
fs.mkdirSync(out, { recursive: true });
const port = 9800 + Math.floor(Math.random() * 150);
const dir = `/tmp/claude-1000/r8logo-${port}`;
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
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
  if (m.method === "Runtime.consoleAPICalled" && /error/.test(m.params.type)) problems.push("console.error " + m.params.args.map((a) => a.value ?? a.description).join(" ").slice(0, 300));
  if (m.method === "Runtime.exceptionThrown") problems.push("exception " + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 300)); });
const sendRaw = (method, params = {}) => new Promise((r, j) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => { if (pend.has(i)) { pend.delete(i); j(new Error(`CDP ${method} hung`)); } }, 60000); });
const send = async (method, params) => { const m = await sendRaw(method, params); if (m.error) throw new Error(`CDP ${method}: ${m.error.message}`); return m.result; };
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
const rect = (sel) => ev(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.getClientRects().length); if (!e) return null; const b = e.getBoundingClientRect(); return { l: +b.left.toFixed(1), t: +b.top.toFixed(1), r: +b.right.toFixed(1), b: +b.bottom.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) }; })()`);
const visible = (sel) => ev(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.getClientRects().length); if (!e) return false; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; })()`);
// what the eye sees at (x, y): the topmost element there, named
const atPoint = (x, y) => ev(`(() => { const e = document.elementFromPoint(${x}, ${y}); if (!e) return null; return (e.className && typeof e.className === "string" ? e.tagName.toLowerCase() + "." + e.className.split(" ")[0] : e.id ? "#" + e.id : e.tagName.toLowerCase()); })()`);

const prof = demoProfile(new Date());
prof.known = [];
const key = storeKey(prof.brand, prof.city);
await send("Runtime.enable"); await send("Page.enable");
const state = { v: STORE_VERSION, brand: prof.brand, city: prof.city, profile: prof, plan: null, statuses: {}, outcomes: {}, savedAt: new Date().toISOString() };
await send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => { try { if (!localStorage.getItem("__seeded")) { localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify(state))}); localStorage.setItem(${JSON.stringify(BRAND_KEY)}, ${JSON.stringify(JSON.stringify({ v: STORE_VERSION, profile: prof, savedAt: new Date().toISOString() }))}); localStorage.setItem("doors:drive-voice", "off"); localStorage.setItem("__seeded", "1"); } } catch {} window.SpeechRecognition = undefined; delete window.webkitSpeechRecognition; })();` });
const phone = +w <= 700;
await send("Emulation.setDeviceMetricsOverride", { width: +w, height: +h, deviceScaleFactor: 1, mobile: phone });
if (phone) await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
// the iPhone's status bar: Chromium reports it to env(safe-area-inset-top) only through this override
const sa = await sendRaw("Emulation.setSafeAreaInsetsOverride", { insets: { top: SAT, topMax: SAT, left: 0, leftMax: 0, bottom: 0, bottomMax: 0, right: 0, rightMax: 0 } });
if (sa.error) { console.error("no Emulation.setSafeAreaInsetsOverride in this Chromium: " + sa.error.message); process.exit(2); }
const report = { width: +w, height: +h, inset: SAT, screens: {} };

// A top bar clears the status bar when: it starts at the screen's top (its background covers the strip), its first
// content starts at or under the strip's bottom, and the strip's pixels belong to the bar (nothing else shows through).
const topbar = async (name, barSel, contentSel, { scrolled = false } = {}) => {
  const bar = await rect(barSel), content = await rect(contentSel);
  const sat = await ev(`parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--sat")) || 0`);
  const env = await ev(`(() => { const p = document.createElement("div"); p.style.cssText = "position:fixed;top:env(safe-area-inset-top,0px);left:0;width:1px;height:1px;visibility:hidden"; document.body.append(p); const t = p.getBoundingClientRect().top; p.remove(); return t; })()`);
  const inStrip = SAT > 2 ? await atPoint(Math.round(+w / 2), Math.round(SAT / 2)) : null;
  const row = { bar, content, env, sat, inStrip };
  report.screens[name] = row;
  must(env === SAT, `${name}: env(safe-area-inset-top) is ${SAT} (got ${env})`);
  must(!!bar && !!content, `${name}: the bar (${barSel}) and its content (${contentSel}) are on screen`);
  if (bar && content) {
    must(bar.t <= 0.5, `${name}: the bar starts at the screen's top (${bar.t})`);
    must(content.t >= SAT - 0.5, `${name}: the bar's content starts under the status bar (${content.t} vs ${SAT})`);
    must(bar.b >= SAT + 20, `${name}: the bar is taller than the strip (${bar.b})`);
  }
  if (inStrip) must(await ev(`(() => { const e = document.elementFromPoint(${Math.round(+w / 2)}, ${Math.round(SAT / 2)}); return !!e && !!e.closest(${JSON.stringify(barSel)}); })()`), `${name}: the strip's pixels are the bar's (${inStrip})`);
  log(`${name}: bar ${JSON.stringify(bar)} content.t ${content?.t} env ${env}`);
};

// ---- landing ----
await send("Page.navigate", { url: `${base}/?home=1` });
await waitFor(`!!document.querySelector(".lp .nav .logo") && document.fonts.status === "loaded"`, 20000); await sleep(800);
await topbar("landing", ".lp .nav", ".lp .nav .logo");
await shot("a1-landing");
// scrolled: the nav is static, the page scrolls under the status bar as any page does (no check beyond the shot)
await ev(`window.scrollTo(0, 300)`); await sleep(300); await shot("a2-landing-scrolled"); await ev(`window.scrollTo(0, 0)`);

// ---- privacy ----
await send("Page.navigate", { url: `${base}/privacy.html` });
await waitFor(`!!document.querySelector(".lp .nav .logo")`, 20000); await sleep(500);
await topbar("privacy", ".lp .nav", ".lp .nav .logo");
await shot("b1-privacy");

// ---- the app: plan ----
const q = new URLSearchParams({ brand: prof.brand, city: prof.city });
await send("Page.navigate", { url: `${base}/app?ors=off&instant=1#/plan?${q}` });
await waitFor(`!!document.querySelector(".stop[data-id]")`, 40000); await sleep(2500);
await send("Page.reload"); await waitFor(`!!document.querySelector(".stop[data-id]")`, 40000); await sleep(2500);
await topbar("plan", "#appbar", "#appbar .logo");
await shot("c1-plan");
const TOOLS = ".route .mapwrap .tools";
// scrolled: the day tabs stick under the status bar, not behind it
await ev(`(() => { const t = document.querySelector(".daytabs"); window.scrollTo(0, t.getBoundingClientRect().top + scrollY + 200); })()`); await sleep(400);
{
  const tabs = await rect(".daytabs"), sticky = await ev(`getComputedStyle(document.querySelector(".daytabs")).position`);
  report.screens.planScrolled = { tabs, sticky, scrollY: await ev(`scrollY`) };
  if (sticky === "sticky") must(tabs && tabs.t >= SAT - 0.5 && tabs.t <= SAT + 0.5, `plan scrolled: the day tabs stick at the status bar's bottom edge (${JSON.stringify(tabs)} vs ${SAT})`);
  await shot("c2-plan-scrolled");
}
await ev(`window.scrollTo(0, 0)`); await sleep(300);
const esc = async () => { await ev(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`); await sleep(300); };
// Why these doors (full screen at this width)
await click(`${TOOLS} [data-drawer="why"]`, { scroll: false }); await sleep(700);
await waitFor(`!document.querySelector("#why").hidden`, 10000);
await topbar("why", "#why .w-head", "#why .w-head h3");
await shot("d1-why");
await ev(`document.querySelector("#why").scrollTo(0, 400)`); await sleep(300);
await topbar("why scrolled", "#why .w-head", "#why .w-head h3");
await shot("d2-why-scrolled");
await esc(); must(await ev(`document.querySelector("#why").hidden`), "Escape closes Why");
// My doors
await click(`${TOOLS} [data-drawer="logbook"]`, { scroll: false }); await sleep(700);
await waitFor(`!document.querySelector("#logbook").hidden`, 10000);
await topbar("mydoors", "#logbook .lb-head", "#logbook .lb-head h3");
await shot("e1-mydoors");
await esc(); must(await ev(`document.querySelector("#logbook").hidden`), "Escape closes My doors");
// the stop's room view (See everything Qloo knows about this door)
await ev(`document.querySelector('.stop[data-id] [data-open]').click()`); // the list's drag handler takes a synthetic press
await waitFor(`!!document.querySelector(".stopview:not([hidden]) .atdoor, .stopview:not([hidden]) .dafter")`, 15000); await sleep(600);
if (await visible(".stopview:not([hidden])")) {
  // "Why this door" opens the room view where no Why panel claims the door (ui/stop.js why-door; the plan's Why panel
  // claims it, then the room is the panel's deep link). Measure whichever opened.
  await ev(`(() => { const b = document.querySelector('.stopview:not([hidden]) [data-s="why-door"], .stopview:not([hidden]) [data-s="room"]'); b?.scrollIntoView({block:"center"}); })()`); await sleep(200);
  const roomBtn = (await visible('.stopview:not([hidden]) [data-s="room"]')) ? '.stopview:not([hidden]) [data-s="room"]' : (await visible('.stopview:not([hidden]) [data-s="why-door"]')) ? '.stopview:not([hidden]) [data-s="why-door"]' : null;
  if (roomBtn) {
    await click(roomBtn, { scroll: false }); await sleep(900);
    if (await visible(".roomview")) { await topbar("room", ".roomview .rv-head", ".roomview .rv-head h2"); await shot("f1-room"); await esc(); }
    else if (await visible("#why:not([hidden])")) { await topbar("why from the door", "#why .w-head", "#why .w-head h3"); await shot("f1-why-door"); await esc(); }
    else problems.push("neither the room view nor the Why panel opened from the door");
  } else report.screens.room = "no Why this door / room link on this stop";
  await esc(); await esc();
} else report.screens.room = "no stop view opened";
await ev(`window.scrollTo(0, 0)`); await sleep(200);
// Drive (full screen, dark)
await click("#t-drive", { scroll: false }); await sleep(900);
await waitFor(`document.documentElement.classList.contains("driving")`, 10000); await sleep(600);
await topbar("drive", ".drive .dv-top", ".drive .dv-x");
await shot("g1-drive");
await ev(`document.querySelector(".drive").scrollTo(0, 500)`); await sleep(300);
// a small screen (≤ 420 wide or ≤ 700 tall) lets the header scroll away (intuit 1b #1): then the page scrolls under
// the status bar as any page does; a sticky header must keep clearing it
if (await ev(`getComputedStyle(document.querySelector(".drive .dv-top")).position`) === "sticky") await topbar("drive scrolled", ".drive .dv-top", ".drive .dv-x");
else report.screens.driveScrolled = { header: "static (scrolls away)", top: await rect(".drive .dv-top") };
await shot("g2-drive-scrolled");
await click('[data-drive-close], .dv-x', { scroll: false }); await sleep(500);

// ---- the tour: its banner under the header, both clear ----
await send("Page.navigate", { url: `${base}/app?ors=off&instant=1#/demo` });
await waitFor(`!!document.querySelector(".demo-banner")`, 40000); await sleep(1500);
await topbar("tour", "#appbar", "#appbar .logo");
{
  const banner = await rect(".demo-banner"), bar = await rect("#appbar");
  report.screens.tourBanner = { banner, bar };
  must(banner && bar && banner.t >= bar.b - 0.5, `tour: the banner sits under the header (${JSON.stringify({ banner, bar })})`);
}
await shot("h1-tour");

console.log(JSON.stringify(report, null, 1));
if (problems.length) { console.error("PROBLEMS\n" + problems.join("\n")); process.exit(1); }
console.log("OK");
process.exit(0);
