// The Devpost lead image: the landing hero as the site shows it (round 4: the map route hero is back, so the lead image
// follows it; the viz3 "picture 1" version is gone), drawn at 1500×1000 (Devpost's gallery shows 3:2 best). The hero
// card is sized 750×500 before the landing script runs, so the map fits the whole day for that shape (its own padding,
// pins fanned, the #1 door's card placed off the pins), and the shot is taken at 2x: nothing is cropped or scaled.
// Still, as ?instant=1 shows it: the caption, the route, ten numbered pins, the start, the #1 door's card, the OSRM
// attribution. Run against a dev server:
//   node scripts/lead-image.mjs http://127.0.0.1:<port> [out.png]      (SAMPLE=1 is enough: the hero is static files)
import { spawn } from "node:child_process";
import fs from "node:fs";

const base = process.argv[2] ?? "http://127.0.0.1:8789";
const OUT = process.argv[3] ?? new URL("../screenshots/v2/lead-landing.png", import.meta.url).pathname;
const W = 750, H = 500; // CSS px; the image is 2x
const port = 9600 + Math.floor(Math.random() * 300);
const prof = `/tmp/claude-1000/lead-${port}`;
const ch = spawn("chromium", ["--headless=new", `--remote-debugging-port=${port}`, "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--hide-scrollbars", `--user-data-dir=${prof}`, "about:blank"], { stdio: "ignore", detached: true });
const cleanup = () => { try { process.kill(-ch.pid, "SIGKILL"); } catch {} try { fs.rmSync(prof, { recursive: true, force: true }); } catch {} };
process.on("exit", cleanup);
setTimeout(() => { console.error("timed out"); process.exit(2); }, 90000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 50; i++) { try { const t = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); const p = t.find((x) => x.type === "page"); if (p) { ws = new WebSocket(p.webSocketDebuggerUrl); break; } } catch {} await sleep(200); }
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pend = new Map(); const problems = [];
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
  if (m.method === "Runtime.exceptionThrown") problems.push("exception " + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 300)); });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result?.value;
await send("Page.enable");
await send("Runtime.enable");
// the card at the image's shape, over the page, before the hero draws (so the map is created at this size)
await send("Page.addScriptToEvaluateOnNewDocument", { source: `document.addEventListener("DOMContentLoaded", () => { const s = document.createElement("style"); s.textContent = ".hero-card{position:fixed!important;left:0!important;top:0!important;width:${W}px!important;height:${H}px!important;border-radius:0!important;box-shadow:none!important;z-index:99!important}"; document.head.append(s); });` });
await send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: 2, mobile: false });
await send("Page.navigate", { url: `${base}/?instant=1` });
// the still is done when the #1 door's card is up (showCard runs after the map's first idle and the pins' fan-out)
let ok = false;
for (let i = 0; i < 60 && !ok; i++) { await sleep(500); ok = await ev(`!!document.querySelector(".hero-card .dcard-m") && !document.querySelector("#hero-cap[hidden]")`); }
if (!ok) { console.error("the hero's still never finished", problems); process.exit(1); }
await sleep(2500); // tiles and the card's fade
await ev("document.fonts.ready.then(() => true)");
const r = await ev(`(() => { const b = document.querySelector(".hero-card").getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height, cap: document.querySelector("#hero-cap")?.textContent, pins: document.querySelectorAll(".hero-card .maplibregl-marker").length, card: document.querySelector(".hero-card .dcard-m")?.textContent?.slice(0, 80) }; })()`);
if (Math.round(r.w) !== W || Math.round(r.h) !== H) { console.error("the card is not at the image's shape", r); process.exit(1); }
const { data } = await send("Page.captureScreenshot", { format: "png", clip: { x: r.x, y: r.y, width: W, height: H, scale: 1 } });
fs.mkdirSync(new URL(".", `file://${OUT}`).pathname, { recursive: true });
fs.writeFileSync(OUT, Buffer.from(data, "base64"));
console.log(`wrote ${OUT} (${W * 2}×${H * 2}; ${r.pins} markers; caption "${r.cap}"; card "${r.card}")`);
if (problems.length) console.error("problems", problems);
process.exit(problems.length ? 1 : 0);
