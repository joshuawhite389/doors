// Prove R9 drive mode end to end in headless Chromium (real time, over CDP), as a rep would use it: a saved Tidewell
// plan whose first window is today (the page's clock is pinned to 12:55 pm), #/plan?…&drive=1 → the first door →
// Done → said by voice (a stand-in SpeechRecognition that "hears" a sentence) → Save & next; two more by text, one a
// follow-up for a later day; Undo; Skip for now; then the clock moves 2 h on and "running late" shows. /api/agent/
// log-visit is not on this server, so every visit goes through the rules fallback. Screenshots every step; prints a
// JSON report and any console error. Usage: node scripts/drive-cdp.mjs <base-url> <out-dir> [width] [height]
import { spawn } from "node:child_process";
import fs from "node:fs";
import { demoProfile } from "../public/lib/demo-profile.js";
import { storeKey, STORE_VERSION, BRAND_KEY } from "../public/lib/store.js";
import { isoDate } from "../public/lib/profile.js";

const [base, out, w = "390", h = "844"] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const port = 9400 + Math.floor(Math.random() * 400);
const ch = spawn("chromium", ["--headless=new", `--remote-debugging-port=${port}`, "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--hide-scrollbars", `--window-size=${w},${h}`, `--user-data-dir=/tmp/claude-1000/drive-${port}`, "about:blank"], { stdio: "ignore", detached: true });
const cleanup = () => { try { process.kill(-ch.pid, "SIGKILL"); } catch {} try { fs.rmSync(`/tmp/claude-1000/drive-${port}`, { recursive: true, force: true }); } catch {} };
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
  const r = await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({block:"center"}); const b = e.getBoundingClientRect(); return {x: b.left + b.width/2, y: b.top + b.height/2}; })()`);
  if (!r) throw new Error(`no ${sel}`);
  await sleep(150);
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: r.x, y: r.y, button: "left", clickCount: 1 });
};
const waitFor = async (expr, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(expr)) return true; await sleep(150); } await shot("zz-timeout"); throw new Error(`timed out: ${expr}\n${problems.join("\n")}\n${await ev(`document.querySelector("#drive")?.innerText.slice(0, 400)`)}`); };
const type = async (text) => { await ev(`document.querySelector("#drive-text").focus()`); await send("Input.insertText", { text }); };

// today 1–6 pm, the demo's Tuesday-and-after windows after it; the page's clock pinned to today 12:55 pm (+ __shift min)
const today = isoDate(new Date());
const prof = demoProfile(new Date());
prof.windows = [{ date: today, from: "13:00", to: "18:00" }, ...prof.windows.slice(1)];
// 9 doors a day, and the day after next runs to 10 pm, so it has time left after its 9 while the next day is full by
// its hours: running late then says the next day is full and offers the one after (the moved doors on top of its
// cap, as End my day's), with Choose a day marking the full one
prof.maxPerDay = 9;
if (prof.windows[2]) prof.windows[2] = { ...prof.windows[2], to: "22:00" };
prof.known = [];
const key = storeKey(prof.brand, prof.city);
const state = { v: STORE_VERSION, brand: prof.brand, city: prof.city, profile: prof, plan: null, statuses: {}, outcomes: {}, savedAt: new Date().toISOString() };
const [y, mo, d] = today.split("-").map(Number);
const pinned = new Date(y, mo - 1, d, 12, 55).getTime();
await send("Runtime.enable"); await send("Page.enable");
await send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
  const real = Date, off = ${pinned} - real.now();
  const shift = () => (window.__shift || 0) * 60000;
  class D extends real { constructor(...a) { if (a.length) super(...a); else super(real.now() + off + shift()); } static now() { return real.now() + off + shift(); } }
  window.Date = D;
  try { if (!localStorage.getItem("__seeded")) { localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify(state))}); localStorage.setItem(${JSON.stringify(BRAND_KEY)}, ${JSON.stringify(JSON.stringify({ v: STORE_VERSION, profile: prof, savedAt: new Date().toISOString() }))}); localStorage.setItem("__seeded", "1"); } } catch {}
  // a stand-in microphone: it "hears" window.__say
  class Rec { start() { setTimeout(() => { const t = window.__say || ""; this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: t }], { isFinal: true })] }); this.onend?.(); }, 300); } stop() {} }
  window.SpeechRecognition = Rec; delete window.webkitSpeechRecognition;
  try { Object.defineProperty(navigator, "mediaDevices", { value: undefined }); } catch {} // drivefix: the bar's ear is the recognizer here (no permission prompt headless)
  window.__spoken = []; if (window.speechSynthesis) { speechSynthesis.speak = (u) => window.__spoken.push(u.text); speechSynthesis.cancel = () => {}; }
})();` });
await send("Emulation.setDeviceMetricsOverride", { width: +w, height: +h, deviceScaleFactor: 1, mobile: +w < 700 });
const q = new URLSearchParams({ brand: prof.brand, city: prof.city, drive: "1" });
await send("Page.navigate", { url: `${base}/app?ors=off#/plan?${q}` }); // ors=off: the estimate's travel times, the same on every server
const report = { width: +w, steps: [] };
const cur = () => ev(`document.querySelector("[data-drive-door]")?.dataset.id ?? null`);
const curName = () => ev(`document.querySelector(".dv-name")?.textContent ?? null`);
const saved = () => ev(`JSON.parse(localStorage.getItem(${JSON.stringify(key)}))`);
const step = async (name, extra = {}) => { await sleep(400); await shot(name); report.steps.push({ name, door: await curName(), progress: await ev(`document.querySelector(".dv-day b")?.textContent`), ...extra }); };

await waitFor(`!!document.querySelector("[data-drive-door] .dv-talk")`, 30000);
await step("01-start");
const ids = [];

// door 1: by voice
ids.push(await cur());
// drivefix: Log visit has no mic of its own; the hands-free bar listens for the visit (what it hears goes to the log)
await click("[data-drive-done]");
await ev(`window.__say = "done, loved it, wants samples"`);
await waitFor(`!!document.querySelector("[data-drive-readback]")`);
await ev(`window.__say = ""`);
await step("02-voice-readback", { readback: await ev(`document.querySelector("[data-drive-readback]").textContent`), spoken: await ev(`window.__spoken.slice(-1)[0]`) });
await click("[data-drive-save]");
await waitFor(`document.querySelector("[data-drive-door]")?.dataset.id !== ${JSON.stringify(ids[0])}`);
await step("03-next-door", { toast: await ev(`document.querySelector(".dv-toast span")?.textContent`) });

// door 2: typed, a follow-up on a later day at 3
ids.push(await cur());
await ev(`window.SpeechRecognition = undefined; if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = undefined`); // a browser with no voice at all (ui/voice.js would record for the Worker)
await click("[data-drive-done]");
await waitFor(`!!document.querySelector("#drive-text")`);
await step("04-sheet-text");
await type("done, come back Thu at 3, liked it, hesitant about price");
await click("[data-drive-log]");
await waitFor(`!!document.querySelector("[data-drive-readback]")`);
await step("05-text-readback", { readback: await ev(`document.querySelector("[data-drive-readback]").textContent`) });
await click("[data-drive-save]");
await waitFor(`document.querySelector("[data-drive-door]")?.dataset.id !== ${JSON.stringify(ids[1])}`);

// door 3: typed; then Undo brings it back; then logged again
ids.push(await cur());
await click("[data-drive-done]");
await waitFor(`!!document.querySelector("#drive-text")`);
await type("talked to Sam, he'll pass it on");
await click("[data-drive-log]");
await waitFor(`!!document.querySelector("[data-drive-save]")`);
await click("[data-drive-save]");
await waitFor(`document.querySelector("[data-drive-door]")?.dataset.id !== ${JSON.stringify(ids[2])}`);
await step("06-after-3");
await click("[data-drive-undo]");
await waitFor(`document.querySelector("[data-drive-door]")?.dataset.id === ${JSON.stringify(ids[2])}`);
const undone = await saved();
await step("07-undone", { statusAfterUndo: undone.statuses[ids[2]] ?? null, outcomeAfterUndo: undone.outcomes[ids[2]] ?? null });
await click("[data-drive-done]");
await waitFor(`!!document.querySelector("#drive-text")`);
await type("talked to Sam, he'll pass it on");
await click("[data-drive-log]");
await waitFor(`!!document.querySelector("[data-drive-save]")`);
await click("[data-drive-save]");
await waitFor(`document.querySelector("[data-drive-door]")?.dataset.id !== ${JSON.stringify(ids[2])}`);

// skip for now: the current door goes to the end of the day
const before = await cur();
await ev(`document.querySelector("[data-drive-more]").open = true`); // drivefix: Skip is under More about this door
await click("[data-drive-skip]");
await waitFor(`document.querySelector("[data-drive-door]")?.dataset.id !== ${JSON.stringify(before)}`);
await step("08-skipped", { skipped: before });

// two hours on: running late. Whether a door overflows the 6 pm end depends on the day's slack (road source, the
// plan the server builds), so the clock moves on in 30-min steps until one does: at 2 h a day with slack is late but
// moves nothing, and there are no choices to press.
let shift = 120;
for (;; shift += 30) {
  await ev(`window.__shift = ${shift}`);
  await click("[data-drive-close]");
  await sleep(300);
  await click("[data-drive-start]");
  await waitFor(`!!document.querySelector("[data-drive-door]")`);
  if ((await ev(`!!document.querySelector("[data-drive-late] [data-drive-latedays], [data-drive-late] [data-drive-latelist]")`)) || shift >= 300) break;
}
await step("09-late", { shift, late: await ev(`document.querySelector("[data-drive-late]")?.textContent ?? null`) });

// GROUP3 item 9: the doors that don't fit get Stop for today's two choices; Move them into the coming days rolls them
// onto the end of the days ahead (End my day's roll: a day keeps its own doors), the lowest-fit back on Your list when
// the days are full, said by name. No door already on a day ahead leaves it; every door that didn't fit is off today
const late = await saved();
const onDays = (sv) => (sv.plan?.days ?? []).filter((dd) => dd && !dd.past && dd.date >= today).flatMap((dd) => dd.stops.map((x) => [x.id, dd.date]));
const banner = await ev(`(() => { const b = document.querySelector("[data-drive-late]"); return { text: b.innerText, days: !!b.querySelector("[data-drive-latedays]"), list: !!b.querySelector("[data-drive-latelist]") }; })()`);
const lateDoors = (late.plan.days.find((dd) => dd.date === today)?.stops ?? []).map((x) => x.id);
let pushToast = null, moved = 0, lost = [];
if (banner.days) {
  await ev(`document.querySelector(".dv-toast").hidden = true`); // an older toast's words stay in it while hidden
  await click(`[data-drive-late] [data-drive-latedays]`);
  await waitFor(`(() => { const t = document.querySelector(".dv-toast"); return !t.hidden && /Undo/.test(t.textContent); })()`, 90000);
  pushToast = await ev(`document.querySelector(".dv-toast span")?.textContent`);
  const afterPush = await saved();
  const on = new Set(onDays(afterPush).map(([id, dt]) => `${id}@${dt}`)); // a visited door with a follow-up is on two days
  lost = onDays(late).filter(([id, dt]) => !lateDoors.includes(id) && !on.has(`${id}@${dt}`));
  if (lost.length) problems.push(`Move them into the coming days: doors off their day ${JSON.stringify(lost)}`);
  const outIds = lateDoors.filter((x) => !on.has(`${x}@${today}`));
  moved = outIds.filter((x) => onDays(afterPush).some(([id, dt]) => id === x && dt > today)).length;
  if (!outIds.length) problems.push(`Move them into the coming days: nothing came off today: ${pushToast}`);
  if (outIds.length > moved && !/back on Your list/.test(pushToast ?? "")) problems.push(`Move them into the coming days: a door on no day isn't named back on Your list: ${pushToast}`);
  // only the moved doors are locked (onto their new day); none of the others comes out locked
  const wasLocked = new Set((late.locks ?? []).map((l) => l.id));
  const newLocks = (afterPush.locks ?? []).map((l) => l.id).filter((x) => !wasLocked.has(x) && !outIds.includes(x));
  if (newLocks.length) problems.push(`Move them into the coming days: doors it didn't move came out locked ${JSON.stringify(newLocks)}`);
} else if (!banner.list) problems.push(`running late: no choices offered: ${banner.text}`);
await step("10-pushed", { banner, toast: pushToast, moved, lost });
await click("[data-drive-close]");
await waitFor(`!document.querySelector("#drive") && !/drive=1/.test(location.hash)`);
await sleep(2500);
await step("11-plan-toolbar", { hash: await ev("location.hash") });
const st = await saved();
const movedOut = late.plan.days.find((dd) => dd.date === today).stops.map((s) => s.id).filter((x) => !st.plan.days.find((dd) => dd.date === today).stops.some((s) => s.id === x));
const fuDay = st.plan.days.find((dd) => dd.date >= st.outcomes[ids[1]].followUp && dd.stops.some((s) => s.id === ids[1] && s.pinned === "followup"));
const todayDay = st.plan.days.find((dd) => dd.date === today);
Object.assign(report, {
  today,
  doors: ids,
  statuses: Object.fromEntries(ids.map((x) => [x, st.statuses[x] ?? null])),
  outcomes: Object.fromEntries(ids.map((x) => [x, st.outcomes[x] ?? null])),
  followUpPinnedOn: fuDay?.date ?? null,
  skippedNowLast: todayDay?.stops.at(-1)?.id === before || movedOut.includes(before),
  movedToNextDay: movedOut.map((x) => ({ id: x, day: st.plan.days.find((dd) => dd.stops.some((s) => s.id === x))?.date ?? null, locked: st.locks?.some((l) => l.id === x) ?? false })),
  sw: await ev(`navigator.serviceWorker?.controller ? "controlling" : (navigator.serviceWorker ? "registered, not yet controlling" : "none")`),
  manifest: await ev(`document.querySelector('link[rel=manifest]')?.href ?? null`),
  problems,
});
console.log(JSON.stringify(report, null, 1));
process.exit(problems.length ? 2 : 0);
