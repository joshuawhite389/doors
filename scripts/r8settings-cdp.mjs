// Round 8 lane settings (Jard 10-28: "when i'm in settings and edit my brand, there's no back button, just save and
// cancel. also why do we have every single thing that we can edit in settings when it all takes you to the same
// page?"), proven in headless Chromium over CDP: Settings shows one summary per part with one Edit each (no per-field
// rows); Edit my brand opens the brand's form with ← Back at the top; Back with nothing changed returns to the plan
// with Settings open, nothing saved; Back after a change asks "Discard changes?" in place (Keep editing stays, Discard
// leaves without saving); the ?field= deep link still opens a form at its field; Save still shows the change on the
// plan first. Screenshots every step; prints a JSON report and "problems none". --before: the first two shots only.
// Usage: node scripts/r8settings-cdp.mjs <base-url> <out-dir> [width] [height] [--before]
import { spawn } from "node:child_process";
import fs from "node:fs";
const before = process.argv.includes("--before");
const [base, out, w = "1400", h = "900"] = process.argv.slice(2).filter((a) => a !== "--before");
fs.mkdirSync(out, { recursive: true });
const port = 9400 + Math.floor(Math.random() * 400);
const dir = `/tmp/claude-1000/r8settings-${port}`;
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
  await sleep(250);
  const r2 = await ev(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.getClientRects().length); const b = e.getBoundingClientRect(); return {x: b.left + b.width/2, y: b.top + b.height/2}; })()`);
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: r2.x, y: r2.y, button: "left", clickCount: 1 });
  await sleep(200);
};
const type = async (sel, text) => { await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.scrollIntoView({block:"center"}); e.focus(); e.select?.(); })()`); await send("Input.insertText", { text }); await sleep(200); };
const waitFor = async (expr, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(expr)) return true; await sleep(150); } await shot("zz-timeout"); throw new Error(`timed out: ${expr}\n${problems.join("\n")}`); };
const check = (ok, what) => { if (!ok) problems.push(`check failed: ${what}`); };
const report = { width: +w, steps: [] };
const step = async (name, extra = {}) => { await sleep(500); await shot(name); report.steps.push({ name, ...extra }); };
const store = (k) => ev(`JSON.parse(localStorage.getItem(${JSON.stringify(k)}) ?? "null")`);

await send("Runtime.enable"); await send("Page.enable");
await send("Page.addScriptToEvaluateOnNewDocument", { source: `window.SpeechRecognition = undefined; delete window.webkitSpeechRecognition;` });
await send("Emulation.setDeviceMetricsOverride", { width: +w, height: +h, deviceScaleFactor: 1, mobile: +w < 700 });
const PLAN = "doors.v2.tidewell-austin";
const BRAND = "doors.v2.__brand";
const text = (sel) => ev(`document.querySelector(${JSON.stringify(sel)})?.innerText ?? ""`);
const planReady = `location.hash.startsWith("#/plan") && !!document.querySelector(".stop[data-id]") && !document.querySelector("[data-b2]")`;

// ---- Maya's example, built ----
await send("Page.navigate", { url: `${base}/app#/new?blank=1` });
await waitFor(`!!document.querySelector("#f-brand")`, 30000);
await sleep(800);
await ev(`document.querySelector("#examples details").open = true`);
await click(`[data-ex="maya"]`);
await waitFor(`document.querySelector("#f-brand").value === "Tidewell"`);
await click("#build");
await waitFor(planReady, 90000);
await sleep(2000);
await step("01-plan", { hash: await ev("location.hash") });

// ---- Settings: one summary per part, one Edit each ----
await click("#t-menu");
await click("#t-settings");
await waitFor(`!document.querySelector("#settings").hidden`);
await sleep(400);
const settings = await text("#settings");
const edits = await ev(`[...document.querySelectorAll("#settings a.btn")].map((a) => [a.textContent.trim(), a.getAttribute("href")])`);
const sum = await ev(`({ brand: [...document.querySelectorAll("#settings .set-sum")][0]?.children.length, city: [...document.querySelectorAll("#settings .set-sum")][1]?.children.length, rowLinks: document.querySelectorAll("#settings .set-sum a, #settings .set-sum button").length, hash: location.hash })`);
await step("02-settings", { settings: settings.slice(0, 700), edits, sum });
if (!before) {
  check(sum.brand === 5 && sum.city === 4 && sum.rowLinks === 0, `one summary per part (5 brand lines, 4 city lines), no per-field Edit: ${JSON.stringify(sum)}`);
  check(edits.filter(([t]) => /^Edit/.test(t)).length === 2 && edits.some(([t, h]) => t === "Edit my brand" && h === "#/brand") && edits.some(([t, h]) => t === "Edit this city" && h === "#/city?city=austin"), `one Edit for the brand, one for the city: ${JSON.stringify(edits)}`);
  for (const need of ["Your brand", "Brand name", "Tidewell", "Your product", "Your drinker also drinks", "Door types", "Your ask", "Austin", "Days and hours", "Tue 1 pm–6 pm; Wed, Thu 2 pm–5 pm", "Time at each door", "25 min", "Most doors a day", "My cities", "Navigation app"]) check(settings.includes(need), `Settings says "${need}"`);
  check(/settings=1/.test(sum.hash), `Settings open is in the address: ${sum.hash}`);
}

// ---- Edit my brand: the form, with ← Back at the top ----
await click(`#settings a[href="#/brand"], #settings a[href*="edit"]`);
await waitFor(`!!document.querySelector("#build") && !!document.querySelector("#f-brand")`);
await sleep(800);
const form = await ev(`(() => { const b = document.querySelector("#f-back"); const r = b?.getBoundingClientRect(); const h = document.querySelector(".pform h2")?.getBoundingClientRect(); return { hash: location.hash, back: b?.textContent.trim() ?? null, href: b?.getAttribute("href") ?? null, aboveTitle: !!(r && h && r.bottom <= h.top + 1), left: r ? Math.round(r.left) : null, atLeft: !!(r && h && r.left <= h.left + 1), h2: document.querySelector(".pform h2")?.textContent, save: document.querySelector("#build")?.textContent.trim(), cancel: !!document.querySelector("#f-cancel"), ask: document.querySelector("#f-back-ask")?.hidden }; })()`);
await step("03-brand-form", form);
if (before) { report.problems = problems; console.log(JSON.stringify(report, null, 1)); console.log("before: shots only"); process.exit(0); }
check(form.back === "← Back" && form.aboveTitle && form.atLeft, `the brand's form has ← Back at the top left: ${JSON.stringify(form)}`);
check(/settings=1/.test(form.href ?? ""), `Back goes to the plan with Settings open: ${form.href}`);
check(form.h2 === "Edit my brand" && form.save === "Save" && form.cancel, `Save and Cancel stay at the bottom: ${JSON.stringify(form)}`);

// ---- Back with nothing changed: the plan, Settings open, nothing saved ----
const brandBefore = JSON.stringify((await store(BRAND))?.profile ?? null);
await click("#f-back");
await waitFor(planReady, 90000);
await waitFor(`!document.querySelector("#settings").hidden`, 20000);
await sleep(600);
const back1 = { hash: await ev("location.hash"), settingsOpen: await ev(`!document.querySelector("#settings").hidden`), brandSame: JSON.stringify((await store(BRAND))?.profile ?? null) === brandBefore };
await step("04-back-to-settings", back1);
check(back1.settingsOpen && back1.brandSame, `Back returns to Settings with nothing saved: ${JSON.stringify(back1)}`);

// ---- Edit this city, change a field, Back → Discard changes? in place ----
await click(`#settings a[href="#/city?city=austin"]`);
await waitFor(`!!document.querySelector("#f-visit")`);
await sleep(800);
await type("#f-visit", "40");
await ev(`document.querySelector("#f-visit").dispatchEvent(new Event("input", { bubbles: true })); document.querySelector("#f-visit").dispatchEvent(new Event("change", { bubbles: true }))`);
await sleep(300);
await click("#f-back");
await sleep(400);
const ask = await ev(`({ hash: location.hash, askShown: document.querySelector("#f-back-ask")?.hidden === false, askText: document.querySelector("#f-back-ask")?.innerText ?? "", stillForm: !!document.querySelector("#f-visit"), visit: document.querySelector("#f-visit")?.value, dialog: false })`);
await step("05-discard-ask", ask);
check(ask.askShown && /Discard changes\?/.test(ask.askText) && ask.stillForm && ask.hash.startsWith("#/city"), `Back after a change asks in place and stays on the form: ${JSON.stringify(ask)}`);
await click(`#f-back-ask [data-back="keep"]`);
await sleep(300);
const keep = await ev(`({ hash: location.hash, askHidden: document.querySelector("#f-back-ask")?.hidden !== false, visit: document.querySelector("#f-visit")?.value })`);
await step("06-keep-editing", keep);
check(keep.askHidden && keep.visit === "40" && keep.hash.startsWith("#/city"), `Keep editing stays with the change: ${JSON.stringify(keep)}`);
await click("#f-back");
await sleep(300);
await click(`#f-back-ask a.btn`);
await waitFor(planReady, 90000);
await waitFor(`!document.querySelector("#settings").hidden`, 20000);
await sleep(600);
const disc = { hash: await ev("location.hash"), visitSaved: (await store(PLAN)).profile.visitMin, settingsText: (await text("#settings")).includes("25 min"), pending: await ev(`document.querySelector("#p-pending")?.hidden !== false`) };
await step("07-discarded", disc);
check(disc.visitSaved === 25 && disc.settingsText && disc.pending, `Discard leaves without saving (25 min stays, no change to try): ${JSON.stringify(disc)}`);

// ---- Escape closes Settings and takes it out of the address ----
await ev(`document.activeElement?.blur?.()`);
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
await sleep(600);
const esc1 = { hash: await ev("location.hash"), settingsOpen: await ev(`!document.querySelector("#settings").hidden`) };
await step("08-escape", esc1);
check(!esc1.settingsOpen && !/settings=1/.test(esc1.hash), `Escape closes Settings and clears the address: ${JSON.stringify(esc1)}`);

// ---- the ?field= deep link still opens a form at its field ----
await ev(`location.hash = "#/brand?field=rooms"`);
await waitFor(`!!document.querySelector("#rooms") && !!document.querySelector("#fd-rooms.here")`);
await sleep(600);
const deep = await ev(`({ hash: location.hash, inView: (() => { const b = document.querySelector("#fd-rooms").getBoundingClientRect(); return b.top < innerHeight && b.bottom > 0; })(), back: !!document.querySelector("#f-back") })`);
await step("09-deep-link", deep);
check(deep.inView && deep.back, `#/brand?field=rooms opens the form at Door types, with Back: ${JSON.stringify(deep)}`);

// ---- Save still shows the change on the plan first ----
await click("#f-back");
await waitFor(planReady, 90000);
await sleep(400);
await ev(`location.hash = "#/city?city=austin&field=visit"`);
await waitFor(`!!document.querySelector("#f-visit")`);
await sleep(600);
await type("#f-visit", "40");
await click("#build");
await waitFor(planReady, 90000);
await waitFor(`!document.querySelector("#p-pending").hidden`, 60000);
const tray = await text("#p-pending");
await step("10-save-tray", { tray });
check(/Time at each door/.test(tray), `Save shows the change to try: ${tray}`);
await click(`[data-pend="keep"]`);
await sleep(800);
check((await store(PLAN)).profile.visitMin === 25, "Keep the old settings changes nothing");

report.problems = problems;
console.log(JSON.stringify(report, null, 1));
console.log(problems.length ? `problems ${problems.length}` : "problems none");
process.exit(problems.length ? 1 : 0);
