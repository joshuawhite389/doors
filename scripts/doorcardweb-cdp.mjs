// The door card on the web (concept A polish, 2026-10-23): the map card (the stop header shrunk: photo, name, one line,
// crowd or reason line, Open the door + Website, Add to) at 1400 and 390, and the stop footer's ⋯ menu by keyboard (ArrowDown opens and
// moves, End/Home, Escape closes the menu and not the stop, focus back on ⋯), and Why this door (the Why panel on that
// door, not Qloo's deep-dive as well). Screenshots each; prints "problems none".
// Usage: node scripts/doorcardweb-cdp.mjs <base-url> <out-dir> [width] [height] [before]   (before: shots only, no checks)
import { spawn } from "node:child_process";
import fs from "node:fs";
import { demoProfile } from "../public/lib/demo-profile.js";
import { storeKey } from "../public/lib/store.js";
import { isoDate } from "../public/lib/profile.js";
const [base, out, w = "1400", h = "900", mode = ""] = process.argv.slice(2);
const before = mode === "before";
fs.mkdirSync(out, { recursive: true });
const port = 9400 + Math.floor(Math.random() * 400);
const dir = `/tmp/claude-1000/dcweb-${port}`;
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
// the first door's notes are seeded once its id is known (after the first plan): __notes
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
const step = async (name, extra = {}) => { await sleep(500); await shot(name); report.steps.push({ name, ...extra }); };
await waitFor(`!!document.querySelector(".stop[data-id]")`, 40000);
await sleep(2500);
// seed two notes on the first door (one the rep's, one Ask Doors'), then reload so the plan reads them
const first = await ev(`document.querySelector(".stop[data-id]").dataset.id`);
await ev(`(() => { const k = ${JSON.stringify(key)}; const s = JSON.parse(localStorage.getItem(k)); s.slots = { ...(s.slots ?? {}), [${JSON.stringify(first)}]: [
  { slot: "S4", field: "note", value: "Owner is Dana; she does the ordering, not the bar staff.", source: "stated", by: "rep", words: null, at: "${today}T15:10:00.000Z", expires: null, confirmed: true, id: "nseed1" },
  { slot: "S4", field: "note", value: "They want samples of the dry one before they commit to a case.", source: "stated", by: "agent:workers-ai", words: "they want samples of the dry one before they commit to a case", at: "${today}T16:02:00.000Z", expires: null, confirmed: false, id: "nseed2" } ] };
  localStorage.setItem(k, JSON.stringify(s)); })()`);
await send("Page.reload");
await waitFor(`!!document.querySelector(".stop[data-id]")`, 40000);
await sleep(2500);
const key2 = (k) => send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code: k, windowsVirtualKeyCode: { ArrowDown: 40, ArrowUp: 38, Escape: 27, Home: 36, End: 35, Tab: 9 }[k] }).then(() => send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code: k }));
// ---- the map card: turn on the ranked pins, open the first one ----
// the ranked doors no day holds show when Your list is the tab (ease #1: the map's own toggle went)
if (!(await ev(`!!document.querySelector(".mrank")`))) await click('.daytabs [data-tab="rest"]');
await waitFor(`!!document.querySelector(".mrank")`);
await ev(`document.querySelector(".mrank").click()`);
const cardSel = +w <= 900 ? "#p-card:not([hidden])" : ".maplibregl-popup.rpop";
await waitFor(`!!document.querySelector(${JSON.stringify(cardSel)} + " h4")`);
await sleep(600);
const card = await ev(`(() => { const c = document.querySelector(${JSON.stringify(cardSel)}); return { name: c.querySelector("h4")?.textContent, kv: c.querySelector(".kv")?.textContent, crowd: c.querySelector(".crowd")?.textContent, hero: !!c.querySelector(".pchero img"), open: c.querySelector("[data-card-open]")?.textContent, web: c.querySelector(".lnks a")?.textContent ?? null, add: !!c.querySelector(".addto") }; })()`);
if (+w <= 900) await ev(`document.querySelector("#p-card").scrollIntoView({block:"center"})`);
await step("01-mapcard", card);
// ease #6: a ranked door's card says why (its crowd or reason line), not its rank number
check(card.name && card.kv && card.crowd && card.open === "Open the door", "map card: name, one line, crowd or reason line, Open the door");
check(await onScreen(`${cardSel} [data-card-open]`), "map card: Open the door on screen");
// a real mouse press where the button is (no scrollIntoView: it would scroll the map's own box under the popup)
const ob = await ev(`(() => { const b = document.querySelector(${JSON.stringify(cardSel)} + " [data-card-open]"); if (+${w} <= 900) b.scrollIntoView({ block: "center" }); const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
await sleep(300);
for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: ob.x, y: ob.y, button: "left", clickCount: 1 });
await waitFor(`!!document.querySelector('.stopview:not([hidden]) h2')`);
await sleep(800);
const opened = await ev(`document.querySelector('.stopview:not([hidden]) h2').textContent`);
check(opened === card.name, `Open the door opens that door (${opened} vs ${card.name})`);
await step("02-stop-from-card", { opened });
// phone sheet: half height opens on the name, status and At the door (no empty photo box); pulled up, the photo shows
if (+w <= 700) {
  const half = await ev(`(() => { const v = document.querySelector(".stopview:not([hidden])"); const h = v.querySelector(".shero"); const a = v.querySelector(".atdoor"); return { hero: h ? h.getBoundingClientRect().height : 0, atdoorTop: a ? Math.round(a.getBoundingClientRect().top) : null, footTop: Math.round(v.querySelector(".sfoot").getBoundingClientRect().top) }; })()`);
  check(half.hero === 0, `half sheet: no photo box (${half.hero}px)`);
  check(half.atdoorTop != null && half.atdoorTop < half.footTop, `half sheet: At the door starts on screen (${half.atdoorTop} < ${half.footTop})`);
  await click('.stopview:not([hidden]) [data-s="grow"]');
  await sleep(800);
  const full = await ev(`(() => { const h = document.querySelector(".stopview:not([hidden]) .shero"); return { hero: h ? Math.round(h.getBoundingClientRect().height) : 0, img: !!h?.querySelector("img"), noimg: !!h?.classList.contains("noimg") }; })()`);
  check(full.noimg || full.hero > 100, `full sheet: the photo shows (${JSON.stringify(full)})`);
  await step("02b-sheet-full", full);
  await click('.stopview:not([hidden]) [data-s="grow"]');
  await sleep(600);
  report.steps.find((x) => x.name === "02-stop-from-card").half = half;
}
// ---- the ⋯ menu by keyboard ----
await ev(`document.querySelector('.stopview:not([hidden]) [data-s="more"]').focus()`);
await key2("ArrowDown");
await sleep(200);
const m1 = await ev(`(() => { const m = document.querySelector('.stopview:not([hidden]) .smore'); return { open: !m.hidden, focus: document.activeElement?.textContent, items: [...m.children].map((x) => x.getAttribute("role") + ":" + x.textContent) }; })()`);
await step("03-menu-open", m1);
check(m1.open && m1.focus === m1.items[0]?.split(":")[1], "ArrowDown on ⋯ opens the menu on its first item");
check(m1.items.every((x) => x.startsWith("menuitem:")), "menu items have role menuitem");
await key2("ArrowDown");
const f2 = await ev(`document.activeElement?.textContent`);
check(f2 === m1.items[1]?.split(":")[1], `ArrowDown moves to the second item (${f2})`);
await key2("End");
const f3 = await ev(`document.activeElement?.textContent`);
check(f3 === m1.items.at(-1)?.split(":")[1], `End goes to the last item (${f3})`);
await key2("ArrowDown");
const f4 = await ev(`document.activeElement?.textContent`);
check(f4 === m1.items[0]?.split(":")[1], `ArrowDown wraps to the first (${f4})`);
await key2("Escape");
await sleep(200);
const m2 = await ev(`(() => { const v = document.querySelector('.stopview:not([hidden])'); return { stop: !!v, menu: v ? !v.querySelector('.smore').hidden : null, focus: document.activeElement?.dataset?.s, exp: v?.querySelector('[data-s="more"]').getAttribute("aria-expanded") }; })()`);
check(m2.stop && m2.menu === false && m2.focus === "more" && m2.exp === "false", `Escape closes the menu only, focus on ⋯ (${JSON.stringify(m2)})`);
await step("04-menu-closed", m2);
await key2("Escape");
await sleep(400);
check(!(await ev(`!!document.querySelector('.stopview:not([hidden]) h2')`)), "a second Escape closes the stop");
// ---- Why this door: plan.js handles doors:why-door (preventDefault), so the Why panel opens on this door and the stop
// row does not also open Qloo's deep-dive (.roomview) ----
await click(".stop[data-id] [data-open]");
await waitFor(`!!document.querySelector('.stopview:not([hidden]) h2')`);
await sleep(800);
const wname = await ev(`document.querySelector('.stopview:not([hidden]) h2').textContent`);
await click('.stopview:not([hidden]) [data-s="why-door"]');
await waitFor(`!document.querySelector("#why")?.hidden`);
await sleep(1200);
const wd = await ev(`(() => { const w = document.querySelector("#why"); return { why: !w.hidden, onDoor: w.innerText.includes(${JSON.stringify(wname)}), room: !!document.querySelector(".roomview") }; })()`);
check(wd.why && wd.onDoor && !wd.room, `Why this door opens the Why panel on ${wname}, no deep-dive (${JSON.stringify(wd)})`);
await step("05-why-door", { door: wname, ...wd });
console.log(JSON.stringify(report, null, 1));
console.log(problems.length ? "problems:\n" + problems.join("\n") : "problems none");
process.exit(problems.length ? 1 : 0);
