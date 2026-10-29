// SUBMISSION.md's before/after image: opens the guided demo's end state in headless
// Chromium, runs scripts/grounding-shot.page.js in the page (real modules, no network beyond the dev server, no API
// call) and saves the composed card. Usage: node scripts/grounding-shot.mjs <base-url> <out.png>
import { spawn } from "node:child_process";
import fs from "node:fs";
const [base = "http://127.0.0.1:8789", out = "screenshots/grounding-before-after.png"] = process.argv.slice(2);
const [w, h] = [1400, 740];
const port = 9800 + Math.floor(Math.random() * 150);
const dir = `/tmp/claude-1000/grounding-${port}`;
const ch = spawn("chromium", ["--headless=new", `--remote-debugging-port=${port}`, "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--hide-scrollbars", `--window-size=${w},${h}`, `--user-data-dir=${dir}`, "about:blank"], { stdio: "ignore", detached: true });
const cleanup = () => { try { process.kill(-ch.pid, "SIGKILL"); } catch {} try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };
process.on("exit", cleanup);
setTimeout(() => { console.error("timed out"); process.exit(2); }, 90000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 50 && !ws; i++) { try { const t = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); const p = t.find((x) => x.type === "page"); if (p) ws = new WebSocket(p.webSocketDebuggerUrl); } catch {} await sleep(200); }
if (ws.readyState !== 1) await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pend = new Map();
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); } });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 2, mobile: false });
await send("Page.navigate", { url: `${base}/app?instant=1#/demo` });
await sleep(7000);
const r = await send("Runtime.evaluate", { expression: fs.readFileSync(new URL("./grounding-shot.page.js", import.meta.url), "utf8"), awaitPromise: true, returnByValue: true });
const v = r.result?.value;
if (!v?.rows) { console.error("page script failed:", JSON.stringify(r).slice(0, 400)); process.exit(1); }
// the composed card can be taller than the window: grow the viewport to it, or the capture clips
await send("Emulation.setDeviceMetricsOverride", { width: w, height: Math.max(h, v.h + 20), deviceScaleFactor: 2, mobile: false });
await sleep(1200);
const { data } = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: w, height: v.h + 20, scale: 1 } });
fs.writeFileSync(out, Buffer.from(data, "base64"));
console.log(`${out}: ${v.rows} rows`);
process.exit(0);
