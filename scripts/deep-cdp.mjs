// Round 3, lane deep: the market-research layer on the real page over CDP. Seeds the demo plan, opens a plan door's stop
// (ui/stop.js loadStopData fetches the enrich records and the city's baked neighbour map and computes each door's deep
// facts), then runs public/lib/deep.js inside the browser on Pinthouse Brewing from the page's own data files and checks
// the gap leads; shots at the given size; console errors and exceptions are problems. Modelled on scripts/g3talk-cdp.mjs.
// Usage: node scripts/deep-cdp.mjs <base-url> <out-dir> [width] [height]
import { spawn } from "node:child_process";
import fs from "node:fs";
import { demoProfile } from "../public/lib/demo-profile.js";
import { storeKey, STORE_VERSION } from "../public/lib/store.js";
import { isoDate } from "../public/lib/profile.js";
const [base, out, w = "1400", h = "900"] = process.argv.slice(2);
const before = false;
fs.mkdirSync(out, { recursive: true });
const port = 9400 + Math.floor(Math.random() * 400);
const dir = `/tmp/claude-1000/deep-${port}`;
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

// ---- lane deep: the layer on the real page ----
// 1. the city's baked neighbour map is fetched by the stop loader (public/data/deep/<city>.json)
await send("Network.enable");
const fetched = [];
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.method === "Network.responseReceived" && /\/data\/(deep|enrich)\//.test(m.params.response.url)) fetched.push({ url: m.params.response.url.replace(base, ""), status: m.params.response.status }); });
const ids = await ev(`[...document.querySelectorAll(".stop[data-id]")].map((x) => x.dataset.id)`);
// open the first plan door's stop page: loadStopData runs (enrich + deep)
await ev(`window.dispatchEvent(new CustomEvent("doors:open-stop", { detail: { id: ${JSON.stringify(ids[0])}, day: 0 } }))`);
await waitFor(`!!document.querySelector(".stopview")`);
await sleep(2500);
await shotAt("01-stop-open");
report.fetched = fetched;
check(fetched.some((f) => /\/data\/deep\/austin\.json/.test(f.url) && f.status === 200), `the stop loader fetched the baked neighbour map: ${JSON.stringify(fetched)}`);
// 2. the module runs in the browser: compute Pinthouse's facts from the page's own data files
const facts = await ev(`(async () => {
  const [{ deepFacts, venueMap }, enrich, city, route, near] = await Promise.all([import("/lib/deep.js"), fetch("/data/enrich/austin.json").then((r) => r.json()), fetch("/data/cities/austin.json").then((r) => r.json()), fetch("/data/routes/athletic-brewing-austin.json").then((r) => r.json()), fetch("/data/deep/austin.json").then((r) => r.json())]);
  const id = Object.keys(enrich.doors).find((k) => enrich.doors[k].name === "Pinthouse Brewing");
  const profile = { brand: "Tidewell", what: "Non-alcoholic hazy IPA", drinks: [{ name: "Athletic Brewing" }] };
  const plan = { venues: route.venues, profile, pool: { ids: route.lists.all.map((r) => r[0]), N: route.lists.all.length } };
  const venues = venueMap({ plan, routes: [route], city });
  const t0 = performance.now();
  const f = deepFacts(enrich.doors[id], { id, venue: venues[id], plan, routes: [route], city, enrich: enrich.doors, near: near.near, profile });
  return { ms: Math.round(performance.now() - t0), n: f.length, first: f[0] ? { kind: f[0].kind, label: f[0].label, text: f[0].text } : null };
})()`);
report.pinthouse = facts;
check(facts.n >= 3 && facts.first.kind === "gap" && /root beer float/.test(facts.first.text), `Pinthouse's facts in the browser lead with the gap: ${JSON.stringify(facts)}`);
check(facts.ms < 500, `one door computes fast in the browser: ${facts.ms} ms`);
// 3. the talking points page still renders (talk2's D slot lands with its merge; here the page must not break)
await ev(`[...document.querySelectorAll("[data-pg='talk']")].find((x) => x.getClientRects().length)?.click()`);
await sleep(800);
await shotAt("02-talk");
check((await text(".stopview")).join(" ").length > 50, "the stop view has content");
console.log(JSON.stringify(report, null, 1));
console.log(`problems ${problems.length ? "\n" + problems.join("\n") : "none"}`);
process.exit(problems.length ? 1 : 0);
