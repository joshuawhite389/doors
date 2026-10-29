// Round 8 lane carry (Jard 10-28): the drive-mode "Get ready" strip is gone; on an iPhone or iPad in a browser tab the
// plan's Menu has "Add to Home Screen" (a sheet: 1. Prepare, 2. Share → Add to Home Screen; Prepare reloads with this
// plan and the sheet says Ready). On a desktop browser the Menu has no such item. Measured in headless Chromium over
// CDP with an iPhone user agent (ua=ios) or Chromium's own (ua=desktop). Seeds Maya's demo profile (SAMPLE=1 dev).
// Usage: node scripts/r8carry-cdp.mjs <base-url> <out-dir> [width] [height] [ios|desktop]
import { spawn } from "node:child_process";
import fs from "node:fs";
import { demoProfile } from "../public/lib/demo-profile.js";
import { storeKey, STORE_VERSION, BRAND_KEY } from "../public/lib/store.js";
const [base, out, w = "390", h = "844", uaArg = "ios"] = process.argv.slice(2);
const strict = true;
const ios = uaArg === "ios";
fs.mkdirSync(out, { recursive: true });
const port = 9800 + Math.floor(Math.random() * 150);
const dir = `/tmp/claude-1000/r8carry-${port}`;
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
const rect = (sel) => ev(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.getClientRects().length); if (!e) return null; const b = e.getBoundingClientRect(); return { l: +b.left.toFixed(1), t: +b.top.toFixed(1), r: +b.right.toFixed(1), b: +b.bottom.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) }; })()`);
const visible = (sel) => ev(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.getClientRects().length); if (!e) return false; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; })()`);
// what a finger at (x, y) would hit: the selector's element (or something inside it)
const hits = (sel, x, y) => ev(`(() => { const e = document.elementFromPoint(${x}, ${y}); return !!e && !!e.closest(${JSON.stringify(sel)}); })()`);

const prof = demoProfile(new Date());
prof.known = [];
const key = storeKey(prof.brand, prof.city);
await send("Runtime.enable"); await send("Page.enable");
const state = { v: STORE_VERSION, brand: prof.brand, city: prof.city, profile: prof, plan: null, statuses: {}, outcomes: {}, savedAt: new Date().toISOString() };
await send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => { try { if (!localStorage.getItem("__seeded")) { localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify(state))}); localStorage.setItem(${JSON.stringify(BRAND_KEY)}, ${JSON.stringify(JSON.stringify({ v: STORE_VERSION, profile: prof, savedAt: new Date().toISOString() }))}); localStorage.setItem("doors:drive-voice", "off"); localStorage.setItem("__seeded", "1"); } } catch {} window.SpeechRecognition = undefined; delete window.webkitSpeechRecognition; })();` });
const phone = +w <= 700;
await send("Emulation.setDeviceMetricsOverride", { width: +w, height: +h, deviceScaleFactor: 1, mobile: phone });
if (phone) await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
if (ios) await send("Emulation.setUserAgentOverride", { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1", platform: "iPhone" });
const q = new URLSearchParams({ brand: prof.brand, city: prof.city });
await send("Page.navigate", { url: `${base}/app?ors=off&instant=1#/plan?${q}` });
await waitFor(`!!document.querySelector(".stop[data-id]")`, 40000);
await sleep(2500);
await send("Page.reload"); await waitFor(`!!document.querySelector(".stop[data-id]")`, 40000); await sleep(2500);
const report = { width: +w, height: +h, ua: uaArg, ios };
const text = (sel) => ev(`(document.querySelector(${JSON.stringify(sel)})?.textContent ?? "").replace(/\\s+/g, " ").trim()`);
const manifest = () => ev(`document.querySelector('link[rel="manifest"]')?.getAttribute("href") ?? null`);

// ---- 1. drive mode: no strip at the top ----
await click("#t-drive");
await waitFor(`document.documentElement.classList.contains("driving")`);
await sleep(1200);
report.drive = { strip: await ev(`!!document.querySelector(".dv-carry")`), getReady: await ev(`/Get ready/.test(document.getElementById("drive")?.textContent ?? "")`), search: await ev(`location.search`), top: await rect("#drive > :first-child") };
check(!report.drive.strip && !report.drive.getReady, "drive mode has no carry strip and no Get ready");
check(/[?&]c=/.test(report.drive.search) === ios || !ios, "driving in a tab: the address carries the code"); // Chromium too: carry is not iOS-gated
await shot("a1-drive");
await click("[data-drive-close]");
await waitFor(`!document.documentElement.classList.contains("driving")`);
await sleep(800);
report.afterDrive = { search: await ev(`location.search`), hash: await ev(`location.hash`) };
check(!/[?&]c=/.test(report.afterDrive.search), "back on the plan: the address dropped the code");

// ---- 2. the Menu: Add to Home Screen only on iPhone / iPad ----
await click("#t-menu");
await waitFor(`!document.querySelector("#menu").hidden`);
await sleep(400);
report.menu = { item: await visible("#t-homescreen"), itemText: await text("#t-homescreen"), aria: await ev(`document.querySelector("#t-menu").getAttribute("aria-label")`), items: await ev(`[...document.querySelectorAll("#menu .mi")].filter((x) => x.getClientRects().length).map((x) => x.querySelector("b").textContent)`) };
check(report.menu.item === ios, ios ? "iPhone: the Menu shows Add to Home Screen" : "desktop: no Add to Home Screen in the Menu");
if (ios) check(/Prepare, then Share/.test(report.menu.itemText), "the item's line: Two steps: Prepare, then Share");
check(/Add to Home Screen/.test(report.menu.aria) === ios, "the Menu button's aria-label names the item only when shown");
await shot("b1-menu");
if (!ios) { await click("#t-menu"); await sleep(300); }

// ---- 3. the sheet → Prepare → reload → Ready ----
if (ios) {
  await click("#t-homescreen");
  await waitFor(`!document.querySelector("#homescreen").hidden`);
  await sleep(400);
  report.sheet = { text: await text("#homescreen"), prepare: await visible("#homescreen [data-carry-prepare]"), menuClosed: await ev(`document.querySelector("#menu").hidden`), manifestBefore: await manifest() };
  check(/Tap Prepare \(the page reloads with this plan\)/.test(report.sheet.text) && /Tap Share → Add to Home Screen/.test(report.sheet.text), "the sheet's two steps in plain words");
  check(report.sheet.prepare && report.sheet.menuClosed, "the sheet has Prepare and the Menu closed");
  check(/\/manifest\.webmanifest\?c=/.test(report.sheet.manifestBefore), "the manifest link already points at this plan (Chrome reads it live)");
  await shot("b2-sheet");
  await click("#homescreen [data-carry-prepare]");
  await sleep(1500); // the reload
  await waitFor(`!!document.querySelector(".stop[data-id]") && !document.querySelector("#homescreen")?.hidden && /Ready/.test(document.querySelector("#homescreen")?.textContent ?? "")`, 40000);
  await sleep(800);
  report.ready = { text: await text("#homescreen"), search: await ev(`location.search`), hash: await ev(`location.hash`), driving: await ev(`document.documentElement.classList.contains("driving")`), manifest: await manifest(), item: null };
  check(/Ready: Share → Add to Home Screen/.test(report.ready.text), "after the reload the sheet says Ready: Share → Add to Home Screen");
  check(!report.ready.driving && !/drive=1/.test(report.ready.hash), "the reload lands on the plan, not drive mode");
  check(!/[?&]c=/.test(report.ready.search), "the address dropped ?c= after the load");
  check(/\/manifest\.webmanifest\?c=/.test(report.ready.manifest), "the page's manifest link is this plan's");
  await shot("b3-ready");
  // the Menu item too
  await click("#homescreen [data-mback]");
  await waitFor(`!document.querySelector("#menu").hidden`);
  await sleep(300);
  report.ready.item = await text("#t-homescreen");
  check(/Ready: Share → Add to Home Screen/.test(report.ready.item), "the Menu item says Ready too");
  await shot("b4-menu-ready");
}
fs.writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
if (problems.length) { console.error(problems.join("\n")); process.exit(2); }
console.log(`ok ${w}x${h} ${uaArg}: ${JSON.stringify(report)}`);
process.exit(0);
