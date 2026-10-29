// Ease fixes (AUDIT-EASE-1 #1 #2 #4 #5 #13 + Why's one exit, the folded examples), proven in headless Chromium over
// CDP on a saved Tidewell plan: one day picker (no map day chips), no Watch the route on the working plan, one slim
// footer without the tagline, no doors-a-day control on the plan, and browser Back closing a door card, Why these doors
// and Start my day (Forward and a reload open them again). Then the form: "Most doors a day", examples folded.
// Screenshots every step; prints a JSON report and "problems none" when every check passes.
// Usage: node scripts/easeplan-cdp.mjs <base-url> <out-dir> [width] [height] [before]   (before: shots only, no checks)
import { spawn } from "node:child_process";
import fs from "node:fs";
import { demoProfile } from "../public/lib/demo-profile.js";
import { storeKey } from "../public/lib/store.js";
import { isoDate } from "../public/lib/profile.js";
const [base, out, w = "1400", h = "900", mode = ""] = process.argv.slice(2);
const before = mode === "before";
fs.mkdirSync(out, { recursive: true });
const port = 9400 + Math.floor(Math.random() * 400);
const dir = `/tmp/claude-1000/easeplan-${port}`;
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
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result?.value; };
const shot = async (name) => { const { data } = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(`${out}/${name}.png`, Buffer.from(data, "base64")); };
const click = async (sel) => {
  const r = await ev(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.getClientRects().length); if (!e) return null; e.scrollIntoView({block:"center"}); const b = e.getBoundingClientRect(); return {x: b.left + b.width/2, y: b.top + b.height/2}; })()`);
  if (!r) throw new Error(`no visible ${sel}`);
  await sleep(150);
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: r.x, y: r.y, button: "left", clickCount: 1 });
};
const waitFor = async (expr, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(expr)) return true; await sleep(150); } await shot("zz-timeout"); throw new Error(`timed out: ${expr}\n${problems.join("\n")}`); };
const check = (ok, what) => { if (!ok && !before) problems.push(`check failed: ${what}`); };
// visible and inside the viewport, not covered at its centre by something else
const onScreen = (sel) => ev(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.getClientRects().length); if (!e) return false; const b = e.getBoundingClientRect(); if (b.width < 8 || b.top < 0 || b.left < 0 || b.bottom > innerHeight || b.right > innerWidth) return false; const t = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return !!t && (e === t || e.contains(t)); })()`);
// one Ask Doors per screen (Jard 2026-10-23): the buttons that read exactly "Ask Doors", laid out and not visibility:hidden
const asks = () => ev(`[...document.querySelectorAll("button")].filter((b) => { if (!["Agent", "Ask Doors"].includes(b.textContent.trim()) || !b.getClientRects().length || getComputedStyle(b).visibility === "hidden") return false; const r = b.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, Math.min(Math.max(r.top + r.height / 2, 1), innerHeight - 1)); return r.bottom < 0 || r.top > innerHeight || (!!t && b.contains(t)); }).length`); // on top where it sits (scrolled-away ones count)
// the page footer's text is not under anything (the floating Ask Doors used to sit on "rankings and listings: Qloo")
const footClear = () => ev(`(() => { const f = document.querySelector(".appfoot"); if (!f) return true; for (const n of f.querySelectorAll("a, span, p")) { for (const r of n.getClientRects()) { if (r.bottom > innerHeight || r.top < 0) continue; for (const x of [r.left + 2, r.left + r.width / 2, r.right - 2]) { const t = document.elementFromPoint(x, r.top + r.height / 2); if (t && !f.contains(t)) return false; } } } return true; })()`);

const today = isoDate(new Date());
const prof = demoProfile(new Date());
prof.windows = [{ date: today, from: "13:00", to: "18:00" }, ...prof.windows.slice(1)];
prof.known = [];
const key = storeKey(prof.brand, prof.city);
const [y, mo, d] = today.split("-").map(Number);
const pinned = new Date(y, mo - 1, d, 12, 55).getTime();
await send("Runtime.enable"); await send("Page.enable");
await send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
  const real = Date, off = ${pinned} - real.now();
  class D extends real { constructor(...a) { if (a.length) super(...a); else super(real.now() + off); } static now() { return real.now() + off; } }
  window.Date = D;
  try { if (!localStorage.getItem("__seeded")) { localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify({ v: 1, brand: prof.brand, city: prof.city, profile: prof, plan: null, statuses: {}, outcomes: {}, savedAt: new Date().toISOString() }))}); localStorage.setItem("__seeded", "1"); } } catch {}
  window.SpeechRecognition = undefined; delete window.webkitSpeechRecognition;
})();` });
await send("Emulation.setDeviceMetricsOverride", { width: +w, height: +h, deviceScaleFactor: 1, mobile: +w < 700 });
const q = new URLSearchParams({ brand: prof.brand, city: prof.city });
await send("Page.navigate", { url: `${base}/app#/plan?${q}` });
const report = { width: +w, steps: [] };
const step = async (name, extra = {}) => { await sleep(600); await shot(name); report.steps.push({ name, hash: await ev("location.hash"), ...extra }); };
const ready = () => waitFor(`!!document.querySelector(".stop[data-id]") && !document.querySelector("[data-b2]") && getComputedStyle(document.querySelector('.tools [data-agent="open"]')).visibility === "visible"`, 60000);
await ready();
await sleep(2500);
const hash = () => ev("location.hash");
const panels = () => ev(`({ stop: document.querySelector(".stopview") ? !document.querySelector(".stopview").hidden : false, why: !document.querySelector("#why").hidden, drive: document.documentElement.classList.contains("driving") })`);
const back = async () => { await ev("history.back()"); await sleep(900); };

// ---- the plan: one picker, no replay, slim footer, no cap ----
await step("01-plan");
const plan0 = await ev(`({
  chips: document.querySelectorAll(".weeklegend button, [data-layer]").length,
  runbar: [...document.querySelectorAll(".runbar")].filter((x) => x.getClientRects().length && getComputedStyle(x).visibility !== "hidden").length,
  watch: [...document.querySelectorAll("button")].filter((b) => /Watch (the route|all)/.test(b.textContent) && b.getClientRects().length).length,
  cap: document.querySelectorAll("[data-cap], .capctl").length,
  footH: Math.round(document.querySelector(".appfoot").getBoundingClientRect().height),
  foot: document.querySelector(".appfoot").innerText,
  rfoot: document.querySelector("#p-foot").innerText,
  tabs: [...document.querySelectorAll(".daytabs [data-tab]")].map((b) => b.textContent.trim()),
})`);
report.plan = plan0;
check(plan0.chips === 0, "no map day chips");
check(plan0.runbar === 0 && plan0.watch === 0, "no Watch the route on the plan");
check(plan0.cap === 0, "no doors-a-day control on the plan");
check(!/pour you yet/.test(plan0.foot), "footer without the tagline");
check(+w < 700 || plan0.footH <= 30, `footer one line at ${w} (${plan0.footH} px)`);
check(!/OpenRouteService|Qloo listing|straight-line/.test(plan0.rfoot), "no engineering notes under the plan");
check(await footClear(), "footer not covered");
// the tabs drive the map: Your list shows the ranked doors no day holds
const pins0 = await ev(`document.querySelectorAll(".maplibregl-marker").length`);
await click('.daytabs [data-tab="rest"]');
await sleep(1200);
const pins1 = await ev(`document.querySelectorAll(".maplibregl-marker").length`);
await step("02-yourlist", { pins0, pins1 });
check(pins1 > pins0, `Your list adds the ranked doors to the map (${pins0} → ${pins1})`);
await click('.daytabs [data-tab="0"]');
await sleep(1200);
const pins2 = await ev(`document.querySelectorAll(".maplibregl-marker").length`);
check(pins2 === pins0, `a day tab takes them off again (${pins2})`);

// ---- Back: a door card ----
const h0 = await hash();
await click(".stop[data-id] .nm");
await waitFor(`document.querySelector(".stopview") && !document.querySelector(".stopview").hidden`);
await step("03-door");
const h1 = await hash();
check(/[?&]stop=/.test(h1), `a door card puts &stop= in the address (${h1})`);
await back();
await step("04-door-back");
let p = await panels();
check(!p.stop && (await hash()) === h0, `Back closes the door card and stays on the plan (${await hash()})`);
await ev("history.forward()"); await sleep(1500);
p = await panels();
check(p.stop, "Forward opens the door card again");
// a reload keeps it open
await send("Page.reload"); await ready(); await sleep(2000);
await waitFor(`document.querySelector(".stopview") && !document.querySelector(".stopview").hidden`, 15000).catch(() => {});
p = await panels();
await step("05-door-reload");
check(p.stop, "a reload keeps the door card open");
// the card's own close goes back over its entry
await ev(`window.dispatchEvent(new CustomEvent("doors:close-stop"))`); await sleep(900);
check((await hash()) === h0 && !(await panels()).stop, `closing the card drops &stop= (${await hash()})`);
const len0 = await ev("history.length");

// ---- Back: Why these doors ----
await click('.tools [data-drawer="why"]');
await waitFor(`!document.querySelector("#why").hidden && !!document.querySelector("#why .w-head")`);
await step("06-why");
check(/[?&]why=1/.test(await hash()), "Why puts &why=1 in the address");
const exits = await ev(`({ back: [...document.querySelectorAll("#why .w-back")].filter((x) => x.getClientRects().length).map((x) => x.textContent), x: document.querySelectorAll("#why .w-x").length, src: document.querySelector("#why .w-src")?.textContent ?? "" })`);
report.whyExits = exits;
check(!exits.back.some((t) => /Your plan/.test(t)) && exits.x === 1, "Why has one exit (×)");
check(/hours from Qloo \(\w{3} \d{1,2}\)/.test(exits.src) && /miles|Miles/.test(exits.src), "Why's sources say where hours and miles come from");
await back();
check(!(await panels()).why && (await hash()) === h0, "Back closes Why");

// ---- Back: Start my day ----
await click("#t-drive");
await waitFor(`document.documentElement.classList.contains("driving")`);
await step("07-drive");
check(/[?&]drive=1/.test(await hash()), "Start my day puts &drive=1 in the address");
await back();
await step("08-drive-back");
p = await panels();
check(!p.drive && (await hash()) === h0, `Back closes Start my day, on the plan (${await hash()})`);
check(await ev(`!!document.querySelector(".stop[data-id]")`), "the plan list is there after Back");
// one more Back leaves the plan as before (history wasn't stacked by closes)
report.historyLen = { afterCard: len0, now: await ev("history.length") };

// ---- the form ----
await send("Page.navigate", { url: `${base}/app#/edit?${q}` });
await waitFor(`!!document.querySelector("#f-cap")`);
await sleep(800);
const form = await ev(`({ cap: document.querySelector('label[for="f-cap"]').textContent, none: document.querySelector("#f-cap option").textContent, ex: document.querySelector(".exfold") ? document.querySelector(".exfold").open : null, title: document.querySelector(".pform h2").textContent })`);
report.form = form;
await ev(`document.querySelector("#f-cap").scrollIntoView({block:"center"})`);
await step("09-form-cap");
check(form.cap === "Most doors a day" && form.none === "No limit", "Edit profile: Most doors a day · No limit");
// a new profile: the examples fold into one row
await send("Page.navigate", { url: `${base}/app#/new?blank=1` });
await waitFor(`!!document.querySelector(".exfold")`);
await sleep(600);
const ex = await ev(`({ open: document.querySelector(".exfold").open, h: Math.round(document.querySelector("#examples").getBoundingClientRect().height), firstField: Math.round(document.querySelector("#f-brand").getBoundingClientRect().top), demo: [...document.querySelectorAll("#appbar a")].map((a) => a.textContent.trim()) })`);
await step("10-form-new", ex);
check(!ex.open && ex.h < 60, `examples folded to one row (${ex.h} px)`);
check(ex.firstField < +h, `the first field above the fold (${ex.firstField})`);
check(ex.demo.includes("Watch the tour"), `the form header says Watch the tour (${ex.demo.join(" | ")})`);
await click(".exfold summary");
await sleep(400);
await step("11-form-examples");
check(await ev(`document.querySelector(".exfold").open && document.querySelectorAll(".exfold .ex").length > 3`), "Try an example opens the examples");

console.log(JSON.stringify(report, null, 1));
console.log("problems", problems.length ? "\n" + problems.join("\n") : "none");
process.exit(problems.length ? 1 : 0);
