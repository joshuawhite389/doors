// V4 vs V5 side by side (docs/ROUTING-V5-EVAL.md): the guided demo's finished plan (/app?instant=1#/demo, baked roads,
// zero live calls) once per routing, shot on the Week tab and on each day's tab, then each pair joined left | right
// with a label (ImageMagick `magick`). Variants are name=query pairs; the query is added to the app's URL.
//   node scripts/v5-shots.mjs <base-url> <out-dir> [--w 1400] [--h 900] [--variant V4=routing=v4] [--variant V5=routing=v5] [--fresh]
// --fresh: the demo's profile planned from scratch (#/edit?demo=1 → Build my plan), so no day is held as the demo's
// story left it (the guided demo keeps its earlier days); run the dev server with SAMPLE=1 so nothing goes live.
// Writes <out>/<w>-<name>-week.png, <w>-<name>-day<i>.png, <w>-sbs-week.png, <w>-sbs-day<i>.png and facts.json (the
// doors and anchors per day as each page shows them). Headless Chromium under flock /tmp/claude-1000/headless.lock.
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
const args = process.argv.slice(2);
const [base, out] = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const w = opt("w", "1400"), h = opt("h", "900");
const variants = args.flatMap((a, i) => (a === "--variant" ? [args[i + 1]] : [])).map((v) => { const k = v.indexOf("="); return { name: v.slice(0, k), q: v.slice(k + 1) }; });
if (!variants.length) variants.push({ name: "V4", q: "routing=v4" }, { name: "V5", q: "routing=v5" });
fs.mkdirSync(out, { recursive: true });
const port = 9400 + Math.floor(Math.random() * 400);
const dir = `/tmp/claude-1000/v5shots-${port}`;
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
  if (m.method === "Runtime.exceptionThrown") problems.push("exception " + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 300)); });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result?.value;
const shot = async (name) => { const { data } = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(`${out}/${name}.png`, Buffer.from(data, "base64")); console.log("shot", name); };
const until = async (expr, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr)) return true; await sleep(200); } problems.push("timed out: " + expr); return false; };
await send("Runtime.enable"); await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: +w, height: +h, deviceScaleFactor: 1, mobile: +w <= 700 });

const facts = {};
let nDays = 0;
for (const v of variants) {
  await send("Page.navigate", { url: "about:blank" }); await sleep(200);
  // each variant starts clean: a plan saved by the one before would be kept by the re-plan (stable re-plans)
  await send("Storage.clearDataForOrigin", { origin: new URL(base).origin, storageTypes: "all" });
  const fresh = args.includes("--fresh");
  const url = `${base}/app?instant=1&${v.q}#/${fresh ? "edit?demo=1" : "demo"}`;
  await send("Page.navigate", { url });
  if (fresh) {
    await until(`!!document.querySelector("#build")`, 30000); await sleep(800);
    await ev(`document.querySelector("#build").click()`);
    await until(`!!document.querySelector('button[data-tab="week"]')`, 30000); await sleep(3000);
  } else {
    await until(`!!window.__demo?.done`, 30000); await sleep(2500);
    await ev(`document.querySelector(".ccard [data-cb]:last-child")?.click()`); // the hand-off card's Close
    await sleep(500);
  }
  // the day tabs (in .daytabs; the list's day heads aren't): "Tue · 9 doors"
  const tabs = await ev(`[...document.querySelectorAll('.daytabs button[data-tab]')].filter((b) => /^\\d+$/.test(b.dataset.tab)).map((b) => b.textContent.trim())`);
  facts[v.name] = { url, tabs };
  nDays = Math.max(nDays, tabs?.length ?? 0);
  await ev(`document.querySelector('button[data-tab="week"]')?.click()`);
  await sleep(2500);
  await shot(`${w}-${v.name}-week`);
  for (let i = 0; i < (tabs?.length ?? 0); i++) {
    await ev(`document.querySelector('button[data-tab="week"]')?.click()`); // every day on, so the shot shows the day over the faint others
    await sleep(400);
    await ev(`document.querySelector('.daytabs button[data-tab="${i}"]')?.click()`);
    await sleep(2000);
    await shot(`${w}-${v.name}-day${i}`);
  }
}
fs.writeFileSync(`${out}/facts.json`, JSON.stringify(facts, null, 1));
ws.close();
cleanup();

// left | right, each with its label above
const pair = (tag) => {
  const ins = variants.map((v) => `${out}/${w}-${v.name}-${tag}.png`).filter((f) => fs.existsSync(f));
  if (ins.length < 2) return;
  const labelled = ins.map((f, i) => ["(", f, "-gravity", "North", "-background", "#1F2A24", "-fill", "white", "-font", "Adwaita-Sans-Bold", "-pointsize", "28", "-splice", "0x48", "-annotate", "+0+8", `${variants[i].name}  (${variants[i].q})`, ")"]).flat();
  execFileSync("magick", [...labelled, "-background", "#1F2A24", "-splice", "0x0", "+append", `${out}/${w}-sbs-${tag}.png`]);
  console.log("side by side", `${w}-sbs-${tag}`);
};
pair("week");
for (let i = 0; i < nDays; i++) pair(`day${i}`);
console.log("problems", problems.length ? problems.join("\n") : "none");
