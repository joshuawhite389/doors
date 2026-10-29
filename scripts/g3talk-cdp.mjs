// Group 3 item 3 (Jard web review 10-24): each door's talking points written by a model from Qloo's facts. A plan door
// shows the baked set; a door far down Your list has none, so the page says the door's lines are being written, asks
// POST /api/talk once (live: one Sonnet call, about $0.04; skip with nolive), and swaps them in; a reload shows them
// from this device with no new call. Two doors' questions differ. Round 3 (Jard 10-25): nothing on the page names a
// model or says one wrote the lines; a written set is told by its Sources rows ("Qloo · this door's facts") and no
// "Written by" / "Claude" text anywhere on the page. Screenshots each; "problems none".
// Usage: node scripts/g3talk-cdp.mjs <base-url> <out-dir> [width] [height] [before|nolive]   (before: shots only, no checks)
import { spawn } from "node:child_process";
import fs from "node:fs";
import { demoProfile } from "../public/lib/demo-profile.js";
import { storeKey, STORE_VERSION } from "../public/lib/store.js";
import { isoDate } from "../public/lib/profile.js";
const [base, out, w = "1400", h = "900", mode = ""] = process.argv.slice(2);
const before = mode === "before";
const live = !mode;
fs.mkdirSync(out, { recursive: true });
const port = 9400 + Math.floor(Math.random() * 400);
const dir = `/tmp/claude-1000/g3talk-${port}`;
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

const key2 = (k) => send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code: k, windowsVirtualKeyCode: { ArrowDown: 40, ArrowUp: 38, Escape: 27, Home: 36, End: 35, Tab: 9, Enter: 13 }[k] }).then(() => send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code: k }));
const report = { width: +w };

const prof = demoProfile(new Date()); // its days are ahead of today: every day is a preview
prof.known = [];
const key = storeKey(prof.brand, prof.city);
const today = isoDate(new Date());
const [y, mo, d] = today.split("-").map(Number);
const pinned = new Date(y, mo - 1, d, 21, 59).getTime(); // the audit's "Visited 9:59 pm"
await send("Runtime.enable"); await send("Page.enable");
await send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
  const real = Date, off = ${pinned} - real.now();
  class D extends real { constructor(...a) { if (a.length) super(...a); else super(real.now() + off); } static now() { return real.now() + off; } }
  window.Date = D;
  try { if (!localStorage.getItem("__seeded")) { localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify({ v: STORE_VERSION, brand: prof.brand, city: prof.city, profile: prof, plan: null, statuses: {}, outcomes: {}, savedAt: new Date().toISOString() }))}); localStorage.setItem("__seeded", "1"); } } catch {}
  window.SpeechRecognition = undefined; delete window.webkitSpeechRecognition;
})();` });
await send("Emulation.setDeviceMetricsOverride", { width: +w, height: +h, deviceScaleFactor: 1, mobile: +w < 700 });
const q = new URLSearchParams({ brand: prof.brand, city: prof.city });
await send("Page.navigate", { url: `${base}/app#/plan?${q}` });
const shotAt = async (name) => { await sleep(500); await shot(name); };
const text = (sel) => ev(`[...document.querySelectorAll(${JSON.stringify(sel)})].filter((x) => x.getClientRects().length).map((x) => x.textContent.replace(/\\s+/g, " ").trim())`);
await waitFor(`!!document.querySelector(".stop[data-id]")`, 40000);
await sleep(2500);
// the first open builds the plan with its animation; a reload opens the saved plan as a rep sees it
await send("Page.reload");
await waitFor(`!!document.querySelector(".stop[data-id]")`, 40000);
await sleep(2500);
// ---- the talking points page for a door ----
const talkPage = async (id, day) => {
  await ev(`window.dispatchEvent(new CustomEvent("doors:open-stop", { detail: { id: ${JSON.stringify(id)}, day: ${day == null ? "null" : day} } }))`);
  await waitFor(`[...document.querySelectorAll("[data-pg='talk']")].some((x) => x.getClientRects().length)`);
  await sleep(400);
  await ev(`[...document.querySelectorAll("[data-pg='talk']")].find((x) => x.getClientRects().length).click()`);
  await waitFor(`!!document.querySelector(".stopview .talk")`);
  await sleep(500);
};
// written: the Sources fold lists lines built from this door's facts (the template has none)
const by = async () => ((await text(".talk .srcrows li")).some((x) => /this door's facts/.test(x)) ? "written" : "template");
const noSigns = async () => { const t = (await text(".talk")).join(" "); return !/Written by|Claude|Haiku|Sonnet|model/i.test(t); };
const ids = await ev(`[...document.querySelectorAll(".stop[data-id]")].map((x) => x.dataset.id)`);
await talkPage(ids[0], 0);
await shotAt("01-talk-plan-door");
const qa = await text(".talk .ticks li span");
report.door1 = { by: await by(), lines: qa };
check((await by()) === "written", `a plan door shows the baked set: ${await by()}`);
check(await noSigns(), "no model sign on the page (Written by / Claude / model)");
check(!/Nothing in Qloo's tags/.test((await text(".talk")).join(" ")), "no 'Nothing in Qloo's tags' line");
await ev(`document.querySelector(".talk .srcfold")?.scrollIntoView({ block: "end" })`);
await shotAt("02-talk-plan-door-end");
if (ids[1]) {
  await talkPage(ids[1], 0);
  const qb = await text(".talk .ticks li span");
  report.door2 = { by: await by(), lines: qb };
  check(qb.join("|") !== qa.join("|"), "two doors' lines differ");
  await shotAt("03-talk-plan-door-2");
}
if (!before) {
  // a door far down Your list: no baked set, so Claude writes one now
  const plan = await ev(`(async () => { const k = Object.keys(localStorage).find((x) => x.startsWith("doors.v2.") && localStorage.getItem(x).includes('"pool"')); return k ? JSON.parse(localStorage.getItem(k)).plan?.pool?.ids?.slice(60, 61) : null; })()`).catch(() => null);
  const routeAB = await ev(`fetch("/data/routes/athletic-brewing-austin.json").then((r) => r.json())`);
  const baked = await ev(`fetch("/data/talk/austin.json").then((r) => r.json()).catch(() => ({ sets: {} }))`);
  const bakedIds = new Set(Object.keys(baked.sets).map((k) => k.split("|")[0]));
  const far = (plan ?? []).concat(routeAB.lists.all.map((r) => r[0]).slice(40)).find((x) => !bakedIds.has(String(x).toLowerCase()) && !ids.includes(x));
  report.far = routeAB.venues[far]?.name ?? far;
  if (live && far) {
    await talkPage(far, null);
    await shot("04-talk-writing");
    const first = (await text(".talk .talkby span"))[0] ?? "";
    report.writing = first;
    check(/Writing this door's talking points/.test(first) || (await by()) === "written", `says the door's lines are being written: ${first}`);
    await waitFor(`!document.querySelector(".talk .talkby")`, 100000);
    await sleep(500);
    report.farBy = await by();
    report.farLines = await text(".talk .ticks li span");
    check(["written", "template"].includes(report.farBy), `a set either way: ${report.farBy}`);
    check(await noSigns(), "no model sign after the live write");
    await shotAt("05-talk-written-live");
    await send("Page.reload");
    await waitFor(`!!document.querySelector(".stop[data-id]")`, 40000);
    await sleep(2000);
    await talkPage(far, null);
    check((await by()) === report.farBy, `kept on this device after a reload: ${await by()}`);
    await shotAt("06-talk-after-reload");
  }
}
console.log(JSON.stringify(report, null, 1));
console.log(`problems ${problems.length ? "\n" + problems.join("\n") : "none"}`);
process.exit(0);
