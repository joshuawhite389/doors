// Doors Agent's panel (spec step 5) in headless Chromium, on the guided demo's finished plan (/app?instant=1#/demo:
// zero live calls, the agent answers from Doors' rules in the page). Shots of every new state, and checks:
//   hello:   the panel opened on the plan: "Hi …, how can I help?", no suggestion chips
//   sources: "Why is Nomadic Beerworks first?": the facts' small tags (route / Qloo / you / link), mode "plan"
//   chip:    "I have to finish by 5pm": a change chip with its own Undo; undone: the chip says Undone
//   stop:    asked with a stop open: mode "stop"
//   drive:   asked from drive mode: mode "drive", and the reply goes to sayAgent (spied: no audio in headless)
// Usage: node scripts/agentui-cdp.mjs <base-url> <out-dir> [width] [height] [before]
//   before: the old panel (v2-tour), shots only, no checks
import { spawn } from "node:child_process";
import fs from "node:fs";
const [base, out, w = "1400", h = "900", tag = ""] = process.argv.slice(2);
const before = tag === "before";
fs.mkdirSync(out, { recursive: true });
const port = 9400 + Math.floor(Math.random() * 400);
const dir = `/tmp/claude-1000/agentui-${port}`;
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

// ---------- hello ----------
await fresh();
await ev(`document.querySelector('[data-agent="open"]').click()`);
await until(`!!document.querySelector("#agentInput")`);
await sleep(400);
await shot("hello");
if (!before) {
  const hello = await ev(`document.querySelector('#agentLog [data-agent="hello"]')?.textContent ?? ""`);
  check(/^Hi( \w+)?, how can I help\?$/.test(hello), `greeting: "${hello}"`);
  check(!(await ev(`!!document.querySelector("#agentPanel [data-sugg], #agentPanel .asugg")`)), "no suggestion chips");
}

// ---------- sources ----------
await ask("Why is Nomadic Beerworks first?", 1);
await ev(`(() => { const d = [...document.querySelectorAll("#agentLog details")].at(-1); if (d) d.open = true; const l = document.querySelector("#agentLog"); if (l) l.scrollTop = 0; })()`);
await sleep(400);
await shot("sources");
if (!before) {
  const tags = await ev(`[...document.querySelectorAll("#agentLog .agent-facts .agent-src")].map((x) => x.textContent)`);
  // lane W (2ad68d6): a source line that names its source in its words ("Doors' route", "Qloo ranks …", "You logged …")
  // keeps no tag; every other line has its small tag. So: each line says its source one way or the other
  const lines = await ev(`[...document.querySelectorAll("#agentLog .agent-facts li")].map((li) => ({ text: li.textContent, tag: li.querySelector(".agent-src")?.textContent ?? null }))`);
  check(lines?.length && lines.every((l) => (l.tag ? ["Qloo", "route", "you", "link ↗", "Doors"].includes(l.tag) : /\b(Qloo|route|you|your|Doors)\b/i.test(l.text))), `every source line has a tag or names its source: ${JSON.stringify(lines)}`);
  check(tags.every((t) => ["Qloo", "route", "you", "link ↗", "Doors"].includes(t)), `source tags: ${JSON.stringify(tags)}`);
  const size = tags.length ? await ev(`parseFloat(getComputedStyle(document.querySelector("#agentLog .agent-src")).fontSize)`) : 0;
  check(size <= 10.5, `tag font ${size}px (was 11px)`);
  check((await lastReply())?.mode === "plan", `mode from the plan: ${(await lastReply())?.mode}`);
  check(await ev(`!!document.querySelector('#agentLog [data-agent="say"]')`), "a speaker on the answer");
  check((await ev(`window.__said.length`)) === 0, "not spoken on the plan without the tap");
}

// ---------- chip, undone ----------
await ask("I have to finish by 5pm", 2);
await ev(`(() => { const l = document.querySelector("#agentLog"); l.scrollTop = l.scrollHeight; })()`);
await shot("chip");
if (!before) {
  const chips = await ev(`[...document.querySelectorAll("#agentLog .agent-msg:last-child .achip")].map((x) => x.textContent)`);
  check(chips?.length >= 1 && /· Undo$/.test(chips[0]), `chips: ${JSON.stringify(chips)}`);
  const ends = await ev(`JSON.stringify((window.__replies.at(-1)?.actions ?? []).map((a) => a.type))`);
  check(/replan/.test(ends), `the rules re-planned: ${ends}`);
  await ev(`document.querySelector('#agentLog .agent-msg:last-child [data-agent="undo"]')?.click()`);
  await sleep(1500);
  await shot("undone");
  const undone = await ev(`[...document.querySelectorAll("#agentLog .agent-msg:last-child .achip")].map((x) => x.textContent)`);
  check(/· Undone$/.test(undone?.[0] ?? ""), `after Undo: ${JSON.stringify(undone)}`);
  check(await ev(`!document.querySelector('#agentLog [data-agent="undo"]')`), "no Undo left on an undone chip");
}

// ---------- stop ----------
if (!before) {
  await ev(`document.querySelector('[data-agent="close"]').click()`);
  await ev(`window.dispatchEvent(new CustomEvent("doors:open-stop", { detail: { id: ${JSON.stringify(NOMADIC)}, day: 0 } }))`);
  await until(`!!document.querySelector(".stopview:not([hidden]) h2")`);
  await ev(`document.querySelector('.stopview:not([hidden]) [data-s="ask"]').click()`);
  await until(`!document.querySelector("#agentPanel").hidden`);
  await ask("What do I know about this door?", 3);
  await shot("stop");
  check((await lastReply())?.mode === "stop", `mode with a stop open: ${(await lastReply())?.mode}`);
}

// ---------- drive ----------
if (!before) {
  await fresh();
  await ev(`document.querySelector("#t-drive").click()`);
  await until(`!!document.querySelector("#drive [data-drive-ask]")`);
  await sleep(800);
  await ev(`document.querySelector("#drive [data-drive-ask]").click()`);
  await until(`!document.querySelector("#agentPanel").hidden`);
  // headless has no voices: one fake voice, and speak() recorded (sayAgent: Aura-2 first, refused in the demo → the browser)
  await ev(`(() => { window.__spoken = []; const s = window.speechSynthesis; s.getVoices = () => [{ lang: "en-US", name: "test", default: true }]; s.speak = (u) => { window.__spoken.push(u.text); setTimeout(() => u.onstart?.(), 10); }; })()`);
  await ask("What's next?", 1);
  await sleep(1500);
  await shot("drive");
  const r = await lastReply();
  check(r?.mode === "drive", `mode from drive mode: ${r?.mode}`);
  const spoken = await ev(`window.__spoken.concat(window.__said)`);
  check(r?.reply && spoken?.includes(r.reply), `drive mode speaks the reply: ${JSON.stringify(spoken)}`);
}

console.log(JSON.stringify({ problems, failed: checks.filter(([ok]) => !ok).map(([, w]) => w) }));
process.exit(checks.some(([ok]) => !ok) || problems.length ? 1 : 0);
