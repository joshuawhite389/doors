// Round 8 (Jard 10-28 20:18, Brave iOS): a REFRESH of the landing page opened it scrolled ~70 pt down, the Doors logo
// under the status bar (the first visit was at the top). The browser restores the last scroll position on reload;
// the pages now start at the top on a reload (the inline head script in index.html / app.html / privacy.html) and
// leave back/forward to the browser. This measures that at a phone size: each page, scrolled, then reloaded, reads
// scrollY 0; back to a scrolled page restores its position; a reload of /#how still lands on the section.
// Seeds Maya's demo profile for the app's plan (routes replay from data/kv-dev, no Qloo call, NO_MODEL).
// Usage: node scripts/r8scroll-cdp.mjs <base-url> <out-dir> [width] [height] [strict|measure]
import { spawn } from "node:child_process";
import fs from "node:fs";
import { demoProfile } from "../public/lib/demo-profile.js";
import { storeKey, STORE_VERSION, BRAND_KEY } from "../public/lib/store.js";
const [base, out, w = "390", h = "844", strictArg = "strict"] = process.argv.slice(2);
const strict = strictArg !== "measure";
fs.mkdirSync(out, { recursive: true });
const port = 9800 + Math.floor(Math.random() * 150);
const dir = `/tmp/claude-1000/r8scroll-${port}`;
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
const waitFor = async (expr, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(expr)) return true; await sleep(150); } await shot("zz-timeout"); throw new Error(`timed out: ${expr}\n${problems.join("\n")}`); };
const check = (ok, what) => { if (!ok) problems.push(`check failed: ${what}`); };
const must = (ok, what) => { if (strict) check(ok, what); };

const prof = demoProfile(new Date());
prof.known = [];
const key = storeKey(prof.brand, prof.city);
await send("Runtime.enable"); await send("Page.enable");
const state = { v: STORE_VERSION, brand: prof.brand, city: prof.city, profile: prof, plan: null, statuses: {}, outcomes: {}, savedAt: new Date().toISOString() };
await send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => { try { if (!localStorage.getItem("__seeded")) { localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify(state))}); localStorage.setItem(${JSON.stringify(BRAND_KEY)}, ${JSON.stringify(JSON.stringify({ v: STORE_VERSION, profile: prof, savedAt: new Date().toISOString() }))}); localStorage.setItem("doors:drive-voice", "off"); localStorage.setItem("__seeded", "1"); } } catch {} window.SpeechRecognition = undefined; delete window.webkitSpeechRecognition;
  // a trace of who scrolls when (the report keeps it): scrollTo calls and scroll events, with the page's state
  window.__scrollLog = []; const L = (s) => window.__scrollLog.push(performance.now().toFixed(0) + " " + document.readyState + " y=" + scrollY + " " + s); const st = window.scrollTo; window.scrollTo = function () { L("scrollTo(" + [...arguments].map((a) => typeof a === "object" ? JSON.stringify(a) : a).join(",") + ")"); return st.apply(this, arguments); }; addEventListener("scroll", () => L("scroll mode=" + history.scrollRestoration), true); addEventListener("DOMContentLoaded", () => L("DCL")); addEventListener("load", () => L("load")); })();` });
const phone = +w <= 700;
await send("Emulation.setDeviceMetricsOverride", { width: +w, height: +h, deviceScaleFactor: 1, mobile: phone });
if (phone) await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await sendRaw("Emulation.setSafeAreaInsetsOverride", { insets: { top: 59, topMax: 59, left: 0, leftMax: 0, bottom: 0, bottomMax: 0, right: 0, rightMax: 0 } });
const report = { width: +w, height: +h, pages: {} };
const SCROLL = 140;
// a person's scroll: a wheel through the input pipeline (fires the page's wheel listener, as a finger fires touchstart)
const wheel = async (dy) => { await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: Math.round(+w / 2), y: Math.round(+h / 2), deltaX: 0, deltaY: dy }); await sleep(600); return ev(`scrollY`); };

// scrolled, then reloaded: the page starts at the top (the status bar strip holds the bar, not the page's middle)
const reloadCase = async (name, url, ready, settle = 800) => {
  await send("Page.navigate", { url }); await waitFor(ready, 40000); await sleep(settle);
  const first = await ev(`scrollY`);
  await ev(`window.scrollTo(0, ${SCROLL})`); await sleep(400);
  const before = await ev(`scrollY`);
  await shot(`${name}-1-scrolled`);
  await send("Page.reload"); await waitFor(ready, 40000); await sleep(settle);
  const after = await ev(`scrollY`);
  // a late restoration (Chromium retries as the page grows) would show here
  await sleep(1500);
  const later = await ev(`scrollY`);
  const nav = await ev(`performance.getEntriesByType("navigation")[0]?.type`);
  const mode = await ev(`history.scrollRestoration`);
  await shot(`${name}-2-reloaded`);
  const trace = await ev(`window.__scrollLog`);
  report.pages[name] = { first, before, after, later, nav, mode, trace };
  must(first === 0, `${name}: the first load is at the top (${first})`);
  must(before === SCROLL, `${name}: the page scrolled to ${SCROLL} before the reload (${before})`);
  must(after === 0 && later === 0, `${name}: after a reload the page is at the top (${after}, then ${later})`);
  log(`${name}: first ${first} scrolled ${before} reload → ${after} (later ${later}) nav=${nav} mode=${mode}`);
};
const landingReady = `!!document.querySelector(".lp .nav .logo") && document.fonts.status === "loaded"`;
await reloadCase("landing", `${base}/?home=1`, landingReady);
await reloadCase("privacy", `${base}/privacy.html`, `!!document.querySelector(".lp .nav .logo")`, 500);
const q = new URLSearchParams({ brand: prof.brand, city: prof.city });
await reloadCase("plan", `${base}/app?ors=off&instant=1#/plan?${q}`, `!!document.querySelector(".stop[data-id]")`, 2000);

// back/forward stays the browser's: landing scrolled, away to privacy, back → the landing is where it was
{
  await send("Page.navigate", { url: `${base}/?home=1` }); await waitFor(landingReady, 40000); await sleep(800);
  const left = await wheel(300);
  const modeBefore = await ev(`history.scrollRestoration`);
  await ev(`location.href = "/privacy.html"`); await waitFor(`location.pathname === "/privacy.html" && !!document.querySelector(".lp .nav .logo")`, 40000); await sleep(500);
  const hist = await send("Page.getNavigationHistory");
  await send("Page.navigateToHistoryEntry", { entryId: hist.entries[hist.currentIndex - 1].id });
  await waitFor(`location.pathname === "/" && !!document.querySelector(".lp .nav .logo")`, 40000); await sleep(1500);
  const back = await ev(`scrollY`), nav = await ev(`performance.getEntriesByType("navigation")[0]?.type`), mode = await ev(`history.scrollRestoration`);
  await shot("back-landing");
  report.pages.back = { modeBefore, back, nav, mode };
  must(modeBefore === "auto", `landing after a plain load leaves scrollRestoration auto (${modeBefore})`);
  must(mode === "auto", `landing reached by back leaves scrollRestoration auto (${mode})`);
  must(left > 0 && back === left, `back to the landing restores its scroll (left at ${left}, back at ${back}, nav=${nav})`);
  log(`back: left ${left} → back ${back} nav=${nav} mode=${mode}`);
  // ...and after a reload the entry is auto again for a later back: reload (manual for this life), leave, come back
  await send("Page.reload"); await waitFor(landingReady, 40000); await sleep(800);
  const reloadMode = await ev(`history.scrollRestoration`);
  const left2 = await wheel(300); // within the reload's 3 s guard: a person's scroll stays
  await ev(`location.href = "/privacy.html"`); await waitFor(`location.pathname === "/privacy.html" && !!document.querySelector(".lp .nav .logo")`, 40000); await sleep(500);
  const h2 = await send("Page.getNavigationHistory");
  await send("Page.navigateToHistoryEntry", { entryId: h2.entries[h2.currentIndex - 1].id });
  await waitFor(`location.pathname === "/" && !!document.querySelector(".lp .nav .logo")`, 40000); await sleep(1500);
  const back2 = await ev(`scrollY`), mode2 = await ev(`history.scrollRestoration`);
  report.pages.backAfterReload = { reloadMode, left2, back2, mode2 };
  must(left2 > 0, `a person's wheel scroll right after a reload stays (${left2})`);
  must(mode2 === "auto", `after a reload then back, scrollRestoration is auto again (${mode2})`);
  must(back2 === left2, `back to a landing that had been reloaded still restores its scroll (left at ${left2}, back at ${back2})`);
  log(`back after reload: reloadMode=${reloadMode} left ${left2} → back ${back2} mode=${mode2}`);
}

// a reload of /#how still lands on the section
{
  await send("Page.navigate", { url: `${base}/#how` }); await waitFor(landingReady, 40000); await sleep(800);
  const first = await ev(`scrollY`);
  await send("Page.reload"); await waitFor(landingReady, 40000); await sleep(1500);
  const after = await ev(`scrollY`);
  const top = await ev(`Math.round(document.getElementById("how").getBoundingClientRect().top)`);
  await shot("hash-reloaded");
  report.pages.hash = { first, after, howTop: top };
  must(after > 0 && Math.abs(top) <= 2, `a reload of /#how lands on the section (scrollY ${after}, #how at ${top})`);
  log(`hash: first ${first} reload → ${after}, #how top ${top}`);
}

fs.writeFileSync(`${out}/report.json`, JSON.stringify({ ...report, problems }, null, 2));
if (problems.length) { console.error("PROBLEMS:\n" + problems.join("\n")); process.exit(1); }
console.log(`ok: ${Object.keys(report.pages).length} cases → ${out}/report.json`);
process.exit(0);
