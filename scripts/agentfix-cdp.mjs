// Jard's 10-24 web review of the Doors Agent, LIVE in headless Chromium: the guided tour's finished plan
// (/app?instant=1#/demo), the panel's transport pointed at the dev server's real /api/agent (Anthropic). Asks the stop
// after a door of another day, offers two talking-point edits and says "yes please", then "Why <door>?". Shots of each.
// Needs a dev server with ANTHROPIC_API_KEY (scripts/dev.mjs). Four live asks, ~$0.01.
// Usage: node scripts/agentfix-cdp.mjs <base-url> <out-dir> [width] [height] [before]
import { spawn } from "node:child_process";
import fs from "node:fs";
const [base, out, w = "1400", h = "900"] = process.argv.slice(2);
const tag = process.argv[6] ?? "";
fs.mkdirSync(out, { recursive: true });
const port = 9400 + Math.floor(Math.random() * 400);
const dir = `/tmp/claude-1000/agentfix-${port}`;
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

// ---------- live ----------
await fresh();
await ev(`import("/ui/agent.js").then((m) => m.setTransport((path, body) => new Promise((ok, no) => { const x = new XMLHttpRequest(); x.open("POST", path); x.setRequestHeader("content-type", "application/json"); x.onload = () => { try { ok(JSON.parse(x.responseText)); } catch (e) { no(e); } }; x.onerror = no; x.send(JSON.stringify(body)); })))`);
const P = await ev(`import("/ui/state.js").then((m) => { const p = m.getPlan(); return { days: p.days.map((d) => ({ date: d.date, stops: d.stops.map((s) => ({ id: s.id, name: p.venues[s.id].name })) })) }; })`);
const [d1, d2] = P.days;
await ev(`document.querySelector('[data-agent="open"]').click()`);
await until(`!!document.querySelector("#agentInput")`);
const reply = async () => ev(`[...document.querySelectorAll("#agentLog .agent-msg[data-role=agent]")].at(-1)?.innerText ?? ""`);
const bottom = () => ev(`(() => { const l = document.querySelector("#agentLog"); if (l) l.scrollTop = l.scrollHeight; })()`);
let n = 0;
// 1+2: the stop after a door on another day than the one on screen
await ask(`what's the next stop after ${d2.stops[1].name}?`, ++n); await bottom(); await sleep(300);
await shot("next-after");
const r1 = await reply();
console.log("next-after:", r1);
if (!tag) {
  check(r1.includes(d2.stops[2].name), `names ${d2.stops[2].name}, the stop after ${d2.stops[1].name} on its own day`);
  check(!/\bpassed\b|go in now|head (over|there) now/i.test(r1), "no time called passed, no 'go now' on another day");
}
// 3: an offered edit, then yes
const door = d1.stops[1].name;
await ask(`What two changes would you make to ${door}'s talking points? Tell me, and ask before you change anything.`, ++n); await bottom(); await sleep(300);
await shot("offer");
console.log("offer:", await reply());
await ask("yes please", ++n); await bottom(); await sleep(300);
await shot("yes");
const r3 = await reply();
const chips = await ev(`[...document.querySelectorAll("#agentLog .agent-msg[data-role=agent]")].at(-1)?.querySelectorAll(".agent-did, [data-did], .achip").length ?? 0`);
console.log("yes:", r3, "| chips", chips);
if (!tag) {
  const last = await ev(`window.__replies?.at(-1) ?? null`);
  check((last?.actions ?? []).some((a) => a.type === "talk"), `the yes made a talking-point change: ${JSON.stringify((last?.actions ?? []).map((a) => [a.type, a.section, a.op]))}`);
  check(!/system|refus|reject|wouldn't accept/i.test(r3), "no 'the system refused'");
}
// 4: why a door, in plain words
await ask(`Why ${d1.stops[4].name}?`, ++n); await bottom(); await sleep(300);
await shot("why");
const r4 = await reply();
console.log("why:", r4);
if (!tag) check(!/level with|overall place|top match|#1\b|affinity|score/i.test(r4), "no ranking jargon");
check(!problems.length, `no page errors: ${problems.join(" | ")}`);
process.exit(checks.every(([ok]) => ok) ? 0 : 1);
