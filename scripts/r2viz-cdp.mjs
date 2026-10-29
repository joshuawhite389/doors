// r2viz: Why these doors as the map story + Try a change (Jard 10-24 ~23:45, "make it even more actionable"). Seeds
// Maya's demo profile as a saved plan, opens Why these doors, shoots the story's steps, tries "Pitch restaurants too"
// (preview), applies it (Changes you made + Undo), undoes it, opens a door from the map and its Add to my plan preview.
// Usage: node scripts/r2viz-cdp.mjs <base-url> <out-dir> [width] [height] [before]   (before: the old home, shots only)
import { spawn } from "node:child_process";
import fs from "node:fs";
import { demoProfile } from "../public/lib/demo-profile.js";
import { storeKey, STORE_VERSION, BRAND_KEY } from "../public/lib/store.js";
const [base, out, w = "1400", h = "900", mode = ""] = process.argv.slice(2);
const before = mode === "before";
fs.mkdirSync(out, { recursive: true });
const port = 9400 + Math.floor(Math.random() * 400);
const dir = `/tmp/claude-1000/r2viz-${port}`;
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
const report = { width: +w };
const prof = demoProfile(new Date());
prof.known = [];
const two = mode === "two"; // a second drink (White Claw): the weight control shows
if (two) prof.drinks = [...prof.drinks, { key: "white-claw", name: "White Claw", ready: true }];
const key = storeKey(prof.brand, prof.city);
await send("Runtime.enable"); await send("Page.enable");
const state = { v: STORE_VERSION, brand: prof.brand, city: prof.city, profile: prof, plan: null, statuses: {}, outcomes: {}, savedAt: new Date().toISOString() };
await send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => { try { if (!localStorage.getItem("__seeded")) { localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify(state))}); localStorage.setItem(${JSON.stringify(BRAND_KEY)}, ${JSON.stringify(JSON.stringify({ v: STORE_VERSION, profile: prof, savedAt: new Date().toISOString() }))}); localStorage.setItem("doors:drive-voice", "off"); localStorage.setItem("__seeded", "1"); } } catch {} window.SpeechRecognition = undefined; delete window.webkitSpeechRecognition; })();` });
await send("Emulation.setDeviceMetricsOverride", { width: +w, height: +h, deviceScaleFactor: 1, mobile: +w < 700 });
const q = new URLSearchParams({ brand: prof.brand, city: prof.city });
await send("Page.navigate", { url: `${base}/app?ors=off#/plan?${q}` });
await waitFor(`!!document.querySelector(".stop[data-id]")`, 40000);
await sleep(2500);
// the first open builds the plan with its animation; a reload opens the saved plan as a rep sees it
await send("Page.reload");
await waitFor(`!!document.querySelector(".stop[data-id]")`, 40000);
await sleep(2500);
await ev(`[...document.querySelectorAll('[data-drawer="why"]')].find((b) => b.getClientRects().length)?.click()`);
const story = !before;
if (before) { await sleep(2500); await shot("b1-home"); }
if (story) {
  await waitFor(`!!document.querySelector("#why .ws-line")`, 20000);
  // the story plays by itself: one shot per step
  const n = await ev(`+document.querySelector("#why .ws-step").textContent.match(/of (\\d+)/)[1]`);
  for (let i = 0; i < n; i++) { await sleep(i ? 3400 : 1200); await shot(`s${String(i + 1).padStart(2, "0")}`); if (i === 2) report.early = await ev(`(() => { const m = [...document.querySelectorAll(".maplibregl-marker")].filter((x) => x.getClientRects().length); return { route: !!document.querySelector(".route.ws-early"), markers: m.length, visible: m.filter((x) => getComputedStyle(x).opacity !== "0").map((x) => x.className.slice(0, 60)).slice(0, 4) }; })()`); }
  const line = await ev(`document.querySelector("#why .ws-line").textContent`);
  check(/Try a change/.test(line), `story ends on explore (${line})`);
  const head = await ev(`document.querySelector("#why .ws-head").textContent`);
  check(/^Qloo ranked \d+ places in Austin for your drinker\. \d+ made your plan\.$/.test(head), `head (${head})`);
  if (two) {
    check(await ev(`document.querySelectorAll("#why .ws-wrow").length === 2`), "a weight row per drink");
    await click('#why .ws-chip[data-try*="white-claw"][data-try*="less"]');
    await waitFor(`!!document.querySelector("#why .ws-pv .ws-pvh")`, 30000);
    await sleep(1200); await shot("w1-weight-preview");
    const wp = await ev(`document.querySelector("#why .ws-pv").textContent`);
    check(/If you: Count White Claw drinkers less/.test(wp), `weight preview (${wp.slice(0, 140)})`);
    await click('#why [data-pv="cancel"]'); await sleep(600);
  }
  // Try a change: pitch restaurants too
  await click('#why .ws-chip[data-try*="restaurants"]');
  await waitFor(`!!document.querySelector("#why .ws-pv .ws-pvh")`, 30000);
  await sleep(1200); await shot("t1-preview");
  const pv = await ev(`document.querySelector("#why .ws-pv").textContent`);
  check(/If you: Pitch restaurants too/.test(pv) && /Your list grows/.test(pv), `preview words (${pv.slice(0, 160)})`);
  const before1 = await ev(`document.querySelectorAll(".stop[data-id]").length`);
  await click('#why [data-pv="apply"]');
  await sleep(4000); await shot("t2-applied");
  const flashText = await ev(`(document.querySelector(".toast, .flash, [role=status].toast")?.textContent ?? "")`);
  await click('#why [data-view="changes"]');
  await sleep(800); await shot("t3-changes");
  const ch = await ev(`document.querySelector("#why").textContent`);
  check(/Pitch restaurants too\./.test(ch), "Changes you made lists it");
  await click('#why .w-facts [data-fix]');
  await sleep(4000); await shot("t4-undone");
  const rooms = await ev(`JSON.parse(localStorage.getItem(${JSON.stringify(key)})).profile.rooms.join()`);
  check(rooms === "bars,breweries", `Undo puts the door types back (${rooms})`);
  report.flash = flashText;
  // a door from the story's map: Nomadic Beerworks (the demo's showcase), then a door left off and its Add preview
  await ev(`(() => { const b = document.querySelector('#why [data-w="list"]'); if (b) b.click(); })()`);
  await sleep(1200);
  await ev(`document.querySelector("#why").dispatchEvent(new CustomEvent("whymap:door", { detail: { id: "00000000-0000-4000-8000-271655E6AA28" } }))`);
  await sleep(1800); await shot("d1-door");
  const door = await ev(`document.querySelector("#why").textContent`);
  check(/When guests go/.test(door) && /The same crowd goes to/.test(door) && /Who goes, rarest/.test(door), "door view: when, who, same crowd");
  const off = await ev(`(() => { const b = [...document.querySelectorAll('#why .wd-sis [data-addpv]')][0]; return b ? b.dataset.addpv : null; })()`);
  if (off) {
    await ev(`document.querySelector('#why .wd-sis [data-addpv]').click()`);
    await waitFor(`!!document.querySelector("#why .ws-pv .ws-pvh")`, 30000);
    await sleep(1200); await shot("d2-addpreview");
    const ap = await ev(`document.querySelector("#why .ws-pv").textContent`);
    check(/If you: Add .+ to my plan/.test(ap), `add preview (${ap.slice(0, 120)})`);
  }
}
console.log(JSON.stringify({ ...report, problems: [...new Set(problems)] }, null, 1));
process.exit(problems.length ? 1 : 0);
