// Judge pass 9, lane E5, in headless Chromium on the guided demo's finished plan (/app?instant=1#/demo: zero live
// calls, Doors' rules answer in the page): #1 the door card's header names the door once its heading scrolls away;
// #5 "why isn't X first?" with another day on screen answers from X's own day (its order fact, no "no reason"); #4
// "finish by 3" names the doors that came off the day in the chip and the toast.
// Usage: node scripts/ease5-cdp.mjs <base-url> <out-dir> [width] [height]
//   before: the old panel (v2-tour), shots only, no checks
import { spawn } from "node:child_process";
import fs from "node:fs";
const [base, out, w = "1400", h = "900", tag = ""] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const port = 9400 + Math.floor(Math.random() * 400);
const dir = `/tmp/claude-1000/ease5-${port}`;
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
const shot = async (name) => { const { data } = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(`${out}/${w}-${tag || "after"}-${name}.png`, Buffer.from(data, "base64")); console.log("shot", name); };
const until = async (expr, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr)) return true; await sleep(200); } problems.push("timed out: " + expr); return false; };
const checks = [];
const check = (ok, what) => { checks.push([Boolean(ok), what]); console.log(ok ? "ok  " : "FAIL", what); };
const NOMADIC = "00000000-0000-4000-8000-271655E6AA28";
await send("Runtime.enable"); await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: +w, height: +h, deviceScaleFactor: 1, mobile: +w <= 700 });
const fresh = async () => {
  await send("Page.navigate", { url: "about:blank" }); await sleep(200);
  await send("Page.navigate", { url: `${base}/app?instant=1#/demo` });
  await until(`!!window.__demo?.done`, 30000); await sleep(2500);
  await ev(`document.querySelector(".ccard [data-cb]:last-child")?.click()`); // the hand-off card's Close
  await sleep(500);
  try { await ev(`sessionStorage.clear()`); } catch {}
};
const ask = async (text, n) => {
  await ev(`(() => { const i = document.querySelector("#agentInput"); i.value = ${JSON.stringify(text)}; document.querySelector('[data-agent="send"]').click(); })()`);
  await until(`document.querySelectorAll('#agentLog .agent-msg[data-role=agent]:not(.athinking)').length >= ${n} && document.querySelector("#agentPanel").dataset.state !== "thinking"`);
  await sleep(500);
};
const lastText = () => ev(`(() => { const m = [...document.querySelectorAll('#agentLog .agent-msg[data-role=agent]')].at(-1); const c = m?.cloneNode(true); c?.querySelectorAll(".agent-facts, .achip").forEach((x) => x.remove()); return c?.textContent.replace(/\\s+/g, " ").trim() ?? ""; })()`);

// ---------- #1 the door card names its door once its name scrolls away ----------
await fresh();
await ev(`window.dispatchEvent(new CustomEvent("doors:open-stop", { detail: { id: ${JSON.stringify(NOMADIC)}, day: 0 } }))`);
await until(`!!document.querySelector(".stopview:not([hidden]) h2")`);
await sleep(800);
const top = await ev(`(() => { const l = document.querySelector(".stopview .sname"); return { hidden: l.hidden, h2: document.querySelector(".stopview h2").textContent }; })()`);
check(top.hidden, `at the top the card's own heading names it (${top.h2}); no second name in the header`);
await ev(`(() => { const s = document.querySelector(".stopview .sscroll"); s.scrollTop = s.scrollHeight / 2; })()`);
await sleep(500);
await shot("card-scrolled");
const mid = await ev(`(() => { const l = document.querySelector(".stopview .sname"); const r = l.getBoundingClientRect(); return { hidden: l.hidden, text: l.textContent, h: r.height, inHead: !!l.closest(".shead") }; })()`);
check(!mid.hidden && mid.h > 10 && mid.text === top.h2 && mid.inHead, `scrolled: the header says "${mid.text}"`);
await ev(`(() => { const s = document.querySelector(".stopview .sscroll"); s.scrollTop = 0; })()`);
await sleep(400);
check(await ev(`document.querySelector(".stopview .sname").hidden`), "scrolled back up: the header line goes");
await ev(`document.querySelector('.stopview [data-s="close"]').click()`);
await sleep(600);

// ---------- #5 "why isn't X first?" asked while another day is on screen ----------
await ev(`document.querySelector('.daytabs [data-tab="1"]').click()`);
await sleep(800);
await ev(`document.querySelector('[data-agent="open"]').click()`);
await until(`!!document.querySelector("#agentInput")`);
await ask("Why isn't Pinthouse Brewing my first stop?", 1);
const why = await lastText();
await shot("why-other-day");
check(/Stop \d+ of \d+ on Tue/.test(why) && /driving time and opening hours/.test(why) && !/no reason/i.test(why), `answered from Tuesday's order with Wednesday on screen: ${why}`);

// ---------- #4 "finish by 3" names the doors that came off ----------
await ask("I have to finish by 3pm", 2);
await ev(`(() => { const l = document.querySelector("#agentLog"); l.scrollTop = l.scrollHeight; })()`);
await sleep(300);
await shot("finish-by");
const chip = await ev(`[...document.querySelectorAll("#agentLog .agent-msg:last-child .achip")].map((x) => x.textContent).join(" | ")`);
const toast = await ev(`document.querySelector("#p-toast")?.textContent?.replace(/\\s+/g, " ").trim() ?? ""`);
check(/Wednesday ends at 3:00 pm: .+ (back on Your list|moved to \w+)/.test(chip), `chip names the doors: ${chip}`);
check(/(back on Your list|moved to \w+)/.test(toast) && !/\d+ off the day/.test(toast), `toast names them, no bare count: ${toast}`);

const failed = checks.filter(([ok]) => !ok).map(([, w]) => w);
console.log(JSON.stringify({ problems, failed }));
process.exit(problems.length || failed.length ? 1 : 0);
