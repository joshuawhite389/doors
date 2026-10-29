// Group 3 lane A (Jard web review 10-24 items 1-2): Why this door shows the place from Qloo's facts on top, one line on why it
// is or isn't on the plan, and the gate list + Qloo's steps behind "How this door was chosen"; a door Qloo hasn't been asked
// about offers "Get its music and sister doors from Qloo" (live: one POST /api/place, ≤3 Qloo calls; skip with nolive).
// Screenshots each; "problems none".
// Usage: node scripts/g3place-cdp.mjs <base-url> <out-dir> [width] [height] [before|nolive]   (before: shots only, no checks)
import { spawn } from "node:child_process";
import fs from "node:fs";
import { demoProfile } from "../public/lib/demo-profile.js";
import { storeKey } from "../public/lib/store.js";
import { isoDate } from "../public/lib/profile.js";
const [base, out, w = "1400", h = "900", mode = ""] = process.argv.slice(2);
const before = mode === "before";
const live = !mode;
fs.mkdirSync(out, { recursive: true });
const port = 9400 + Math.floor(Math.random() * 400);
const dir = `/tmp/claude-1000/g3place-${port}`;
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
  try { if (!localStorage.getItem("__seeded")) { localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify({ v: 1, brand: prof.brand, city: prof.city, profile: prof, plan: null, statuses: {}, outcomes: {}, savedAt: new Date().toISOString() }))}); localStorage.setItem("__seeded", "1"); } } catch {}
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
// ---- the door card ----
const id1 = await ev(`document.querySelector(".stop[data-id]").dataset.id`);
// ---- Why this door, for the plan's first door ----
const why = async (id) => {
  await ev(`window.dispatchEvent(new CustomEvent("doors:why-door", { detail: { id: ${JSON.stringify(id)} }, cancelable: true }))`);
  await waitFor(`!!document.querySelector("#why:not([hidden]) .w-door[data-wc-id='${id}']")`);
  await sleep(800);
};
await why(id1);
await shotAt("01-why-top");
if (!before) {
  const labels = await text(".w-pic dt");
  report.labels = labels;
  check(labels[0] === "Who goes", `the place first, starting with who goes: ${labels.join(" | ")}`);
  check(labels.length >= 4, `at least four facts about the place: ${labels.length}`);
  const heads = await text(".w-door h5");
  report.heads = heads;
  check(heads[0] === "About the place" && heads[1] === "Why it's on your plan", `About the place, then why: ${heads.join(" | ")}`);
  const line = (await text(".w-why"))[0] ?? "";
  report.why = line;
  check(/On your plan:/.test(line) && /on Your list for/.test(line), `one line: ${line}`);
  check(await ev(`!document.querySelector(".w-how").open`), "How this door was chosen starts folded");
  check(!(await text(".w-door > .w-trail li")).length, "no check list outside the fold");
  check(!/\(bar\)|You pitch/.test((await text(".w-door")).join(" ")), "no 'A bar (bar)' / 'You pitch' filler");
}
await ev(`document.querySelector(".w-how")?.scrollIntoView({ block: "start" })`);
await shotAt("02-why-fold-closed");
if (!before) {
  await click(".w-how summary");
  await sleep(400);
  const steps = await text(".w-hsteps li b");
  report.steps = steps;
  check(steps.includes("Qloo's affinity") && steps.at(-1) === "The route", `Qloo's steps in the fold: ${steps.join(" | ")}`);
  await shotAt("03-why-fold-open");
}
// ---- a ranked door Qloo hasn't been asked about: the fetch button ----
if (!before) {
  const city = await ev(`fetch("/data/cities/austin.json").then((r) => r.json())`);
  const routeAB = await ev(`fetch("/data/routes/athletic-brewing-austin.json").then((r) => r.json())`);
  const cand = routeAB.lists.all.map((r) => r[0]).filter((x) => !city.sisters[x] && !city.sounds[x] && (routeAB.venues[x].popularity ?? 1) >= 0.2);
  report.unasked = cand.length;
  const id2 = cand[0];
  if (!id2) problems.push("no unasked ranked door left in Austin's Athletic Brewing list to try the button on");
  else {
    await why(id2);
    const btn = (await text(".w-getq"))[0] ?? "";
    report.button = btn;
    check(btn === "Get its music and sister doors from Qloo", `the button: ${btn}`);
    await ev(`document.querySelector(".w-getq")?.scrollIntoView({ block: "center" })`);
    await shotAt("04-why-unasked");
    if (live) {
      await click(".w-getq");
      await sleep(150);
      await shot("05-why-asking");
      await waitFor(`!document.querySelector(".w-fetch.busy")`, 30000);
      await sleep(500);
      const err = (await text(".w-fetch.err"))[0];
      const after = await text(".w-pic dt");
      report.after = after;
      check(!err, `Qloo answered: ${err ?? ""}`);
      check(after.includes("Same crowd as") && !(await text(".w-getq")).length, `sister doors filled in, button gone: ${after.join(" | ")}`);
      await ev(`document.querySelector(".w-place")?.scrollIntoView({ block: "start" })`);
      await shotAt("06-why-filled");
      // kept on this device: a reload still shows it, with no new ask
      await send("Page.reload");
      await waitFor(`!!document.querySelector(".stop[data-id]")`, 40000);
      await sleep(2000);
      await why(id2);
      check((await text(".w-pic dt")).includes("Same crowd as"), "kept after a reload");
    }
  }
}
console.log(JSON.stringify(report, null, 1));
console.log(`problems ${problems.length ? "\n" + problems.join("\n") : "none"}`);
process.exit(0);
