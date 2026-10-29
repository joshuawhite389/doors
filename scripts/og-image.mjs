// The link-preview image (polish2): public/og.png, 1200x630, for Open Graph / Twitter cards on index.html and app.html.
// Left: the logo, the landing's headline and one line; right: the landing hero's still map (the demo's baked day in
// Austin: route and numbered pins, no stop card or caption, so no venue names or Qloo ranks; doors on one block fan out so all ten numbers show). Run against a dev server:
//   node scripts/og-image.mjs http://127.0.0.1:<port> [out.png]   (SAMPLE=1 is enough: the hero is static files)
import { spawn } from "node:child_process";
import fs from "node:fs";

const base = process.argv[2] ?? "http://127.0.0.1:8789";
const OUT = process.argv[3] ?? new URL("../public/og.png", import.meta.url).pathname;
const port = 9600 + Math.floor(Math.random() * 300);
const prof = `/tmp/claude-1000/og-${port}`;
const ch = spawn("chromium", ["--headless=new", `--remote-debugging-port=${port}`, "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--hide-scrollbars", `--user-data-dir=${prof}`, "about:blank"], { stdio: "ignore", detached: true });
const cleanup = () => { try { process.kill(-ch.pid, "SIGKILL"); } catch {} try { fs.rmSync(prof, { recursive: true, force: true }); } catch {} };
process.on("exit", cleanup);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 50; i++) { try { const t = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); const p = t.find((x) => x.type === "page"); if (p) { ws = new WebSocket(p.webSocketDebuggerUrl); break; } } catch {} await sleep(200); }
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pend = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result?.value;
await send("Page.enable");

// 1. the hero's still map, at 2x, without the stop card or the miles chip
await send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: 2, mobile: false });
await send("Page.navigate", { url: `${base}/?instant=1` });
await sleep(10000);
const r = await ev(`(() => { document.querySelectorAll(".dcard-m,.bmiles,.maplibregl-ctrl,.rattr,#hero-cap").forEach((e) => e.remove()); const b = document.querySelector(".hero-card").getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; })()`);
await sleep(500);
const map = (await send("Page.captureScreenshot", { format: "png", clip: { x: r.x, y: r.y, width: r.w, height: r.h, scale: 1 } })).data;

// 2. the card
const html = `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@700;800&family=Inter:wght@500&display=block" rel="stylesheet">
<style>
html,body{margin:0;width:1200px;height:630px;overflow:hidden;background:#F7F6F2;color:#17191B}
.wrap{display:grid;grid-template-columns:560px 1fr;gap:40px;height:100%;padding:56px 56px 56px 64px;box-sizing:border-box}
.l{display:flex;flex-direction:column}
.logo{display:flex;align-items:center;gap:12px;font:800 38px "Inter Tight",sans-serif;letter-spacing:-.03em}
.logo i{width:26px;height:36px;border:5px solid #17191B;border-radius:14px 14px 3px 3px;position:relative;box-sizing:content-box;display:inline-block}
.logo i:after{content:"";position:absolute;right:5px;top:15px;width:5px;height:5px;border-radius:50%;background:#17191B}
h1{font:800 58px/1.02 "Inter Tight",sans-serif;letter-spacing:-.035em;margin:auto 0 22px}
p{font:500 23px/1.4 Inter,sans-serif;color:#4A4F55;margin:0 0 6px;text-wrap:pretty}
.k{margin-top:auto;font:500 18px Inter,sans-serif;color:#2F5D4E;background:#E6EEE9;border-radius:99px;padding:8px 16px;align-self:flex-start}
.m{position:relative;border-radius:22px;overflow:hidden;box-shadow:0 1px 2px rgba(20,20,20,.05),0 12px 32px rgba(20,20,20,.10);background:#fff}
.m img{width:100%;height:100%;object-fit:cover;display:block}
.m span{position:absolute;right:10px;bottom:8px;font:500 12px Inter,sans-serif;color:#4A4F55;background:rgba(255,255,255,.85);border-radius:6px;padding:2px 7px}
</style></head><body><div class="wrap"><div class="l">
<div class="logo"><i></i>Doors</div>
<h1>Plan your sales days in a new city.</h1>
<p>Sales routes for drink brands and distributor reps, ranked by Qloo's taste data, with a pitch for every door.</p>
<div class="k">Built for the Qloo Agentic Hackathon</div>
</div><div class="m"><img src="data:image/png;base64,${map}"><span>Routes: OSRM · © OpenStreetMap contributors · OpenFreeMap</span></div></div></body></html>`;
await send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 630, deviceScaleFactor: 1, mobile: false });
const { frameId } = (await send("Page.getFrameTree")).frameTree.frame;
await send("Page.navigate", { url: "about:blank" });
await sleep(300);
await send("Page.setDocumentContent", { frameId: (await send("Page.getFrameTree")).frameTree.frame.id ?? frameId, html });
await sleep(3000);
await ev("document.fonts.ready.then(() => true)");
const { data } = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 1200, height: 630, scale: 1 } });
fs.writeFileSync(OUT, Buffer.from(data, "base64"));
console.log(`wrote ${OUT}`);
process.exit(0);
