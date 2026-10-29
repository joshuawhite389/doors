// Doors Agent abilities in headless Chromium, LIVE: the guided tour's
// finished plan (/app?instant=1#/demo), the panel's transport pointed at the dev server's real /api/agent (Anthropic),
// then "Draft a text…": the draft box under the reply with its "Open in Messages" sms: link. Never sends anything.
// Needs a dev server with ANTHROPIC_API_KEY (scripts/dev.mjs). One live ask, ~$0.002.
// Usage: node scripts/agentabil-cdp.mjs <base-url> <out-dir> [width] [height]
import { spawn } from "node:child_process";
import fs from "node:fs";
const [base, out, w = "1400", h = "900"] = process.argv.slice(2);
const tag = "";
fs.mkdirSync(out, { recursive: true });
const port = 9400 + Math.floor(Math.random() * 400);
const dir = `/tmp/claude-1000/agentabil-${port}`;
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
  // every reply's mode, and what drive mode hands to sayAgent (the Worker's voice: refused in the demo, so spied here)
  await ev(`(() => { window.__replies = []; window.addEventListener("doors:agent-reply", (e) => window.__replies.push(e.detail)); window.__said = []; const f = window.fetch; window.fetch = (u, o) => { if (String(u).includes("/api/voice/say")) window.__said.push(JSON.parse(o?.body ?? "{}").text); return f(u, o); }; })()`);
};
const ask = async (text, n) => {
  await ev(`(() => { const i = document.querySelector("#agentInput"); i.value = ${JSON.stringify(text)}; document.querySelector('[data-agent="send"]').click(); })()`);
  await until(`document.querySelectorAll('#agentLog .agent-msg[data-role=agent]:not(.athinking)').length >= ${n} && document.querySelector("#agentPanel").dataset.state !== "thinking"`);
  await sleep(500);
};
const lastReply = () => ev(`window.__replies?.at(-1) ?? null`);

// ---------- a live follow-up draft ----------
await fresh();
// the tour answers from recorded replies: point the panel at the real Worker for this ask
// (the tour also wraps window.fetch to refuse live calls, so this proof posts with XMLHttpRequest)
await ev(`import("/ui/agent.js").then((m) => m.setTransport((path, body) => new Promise((ok, no) => { const x = new XMLHttpRequest(); x.open("POST", path); x.setRequestHeader("content-type", "application/json"); x.onload = () => { try { ok(JSON.parse(x.responseText)); } catch (e) { no(e); } }; x.onerror = no; x.send(JSON.stringify(body)); })))`);
await ev(`document.querySelector('[data-agent="open"]').click()`);
await until(`!!document.querySelector("#agentInput")`);
await ask("Draft a text to Nomadic Beerworks: thanks for today, I'll be back Thursday at 3 with cold cans for the team to taste.", 1);
await ev(`document.querySelector("#agentLog .agent-draft")?.scrollIntoView({ block: "center" })`);
await sleep(400);
await shot("draft");
const d = await ev(`(() => { const x = document.querySelector("#agentLog .agent-draft"); return x ? { body: x.querySelector(".adraft-b")?.textContent, href: x.querySelector(".adraft-open")?.getAttribute("href"), label: x.querySelector(".adraft-open")?.textContent } : null; })()`);
check(d && /^sms:/.test(d.href ?? "") && d.label === "Open in Messages", `draft box with an sms: link: ${JSON.stringify(d)}`);
check(d && /Thursday/.test(d.body) && !/free|comp/i.test(d.body), "the draft says what was asked, offers nothing of value");
// mobile2 10-23: with no mail app, "Open in Mail" does nothing: a Copy beside it
await ev(`document.querySelector('#agentLog .agent-draft [data-agent="draft-copy"]')?.click()`);
await sleep(400);
const copied = await ev(`document.querySelector('#agentLog .agent-draft [data-agent="draft-copy"]')?.textContent ?? null`);
check(copied === "Copied" || copied === "Select the text to copy", `Copy answers: ${copied}`);
check(!problems.length, `no page errors: ${problems.join(" | ")}`);
console.log(JSON.stringify({ draft: d, reply: await ev(`[...document.querySelectorAll("#agentLog .agent-msg[data-role=agent]")].at(-1)?.innerText`) }, null, 1));
process.exit(checks.every(([ok]) => ok) ? 0 : 1);
