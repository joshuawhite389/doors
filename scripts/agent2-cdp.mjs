// Round 3, lane agent2: the Doors Agent on the real page, through the real Worker and model (the dev server's
// Anthropic key). Seeds Maya's demo profile as a saved plan, opens the plan, asks the Agent one real ask ("Give me one
// angle for Pinthouse Brewing that I couldn't use at any other door"), then the WHY-VIZ-SPEC §4.5 ask: dispatches
// doors:ask with lib/whyviz/thread.js threadAsk's payload for the plan's #1 door (as the thread panel will send it) and
// waits for the per-door answer. Shoots each reply; collects console errors and exceptions. The Worker's reply for the
// §4.5 ask is checked for the shape (a line per door, "My pick"). Modelled on scripts/viz2-thread-cdp.mjs.
// Usage: node scripts/agent2-cdp.mjs <base-url> <out-dir> [width] [height]
import { spawn } from "node:child_process";
import fs from "node:fs";
import { demoProfile } from "../public/lib/demo-profile.js";
import { storeKey, STORE_VERSION } from "../public/lib/store.js";
import { demoContext } from "../test/agent-fixture.mjs";
import { route, city } from "../test/helpers.mjs";
import { sieve } from "../public/lib/sieve.js";
import { threadModel, threadAsk } from "../public/lib/whyviz/thread.js";
const [base, out, w = "1400", h = "900"] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const port = 9400 + Math.floor(Math.random() * 400);
const dir = `/tmp/claude-1000/agent2-${port}`;
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
const waitFor = async (expr, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(expr)) return true; await sleep(200); } await shot("zz-timeout"); throw new Error(`timeout: ${expr.slice(0, 80)}`); };
const check = (ok, what) => { if (!ok) problems.push(`check failed: ${what}`); };
const report = { width: +w, replies: [] };
const prof = demoProfile(new Date());
prof.known = [];
const key = storeKey(prof.brand, prof.city);
await send("Runtime.enable"); await send("Page.enable");
const state = { v: STORE_VERSION, brand: prof.brand, city: prof.city, profile: prof, plan: null, statuses: {}, outcomes: {}, savedAt: new Date().toISOString() };
await send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => { try { if (!localStorage.getItem("__seeded")) { localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify(state))}); localStorage.setItem("__seeded", "1"); } } catch {} })()` });
await send("Emulation.setDeviceMetricsOverride", { width: +w, height: +h, deviceScaleFactor: 1, mobile: +w < 700 });
const q = new URLSearchParams({ brand: prof.brand, city: prof.city });
await send("Page.navigate", { url: `${base}/app?ors=off&instant=1#/plan?${q}` });
await waitFor(`!!document.querySelector(".stop[data-id]")`, 40000);
await sleep(2500);
await send("Page.reload");
await waitFor(`!!document.querySelector(".stop[data-id]")`, 40000);
await sleep(2500);

// the ask: through the page's own agent module (doors:ask with send: true), then the reply in the panel
const replies = () => ev(`[...document.querySelectorAll('.agentpanel .agent-msg[data-role="agent"]')].map((x) => x.textContent.trim())`);
const askAgent = async (detail, name, test) => {
  const n0 = (await replies()).length;
  await ev(`window.dispatchEvent(new CustomEvent("doors:ask", { detail: ${JSON.stringify(detail)} }))`);
  await waitFor(`(() => { const r = [...document.querySelectorAll('.agentpanel .agent-msg[data-role="agent"]')]; return r.length > ${n0} && !r.at(-1).classList.contains("athinking"); })()`, 60000);
  await sleep(600);
  const all = await replies();
  const reply = all.at(-1);
  const who = await ev(`document.querySelector("#agentWho")?.textContent ?? ""`);
  report.replies.push({ name, reply, who });
  console.log(`\n== ${name} (${who})\n${reply}`);
  check(test(reply), `${name}: ${reply.slice(0, 120)}`);
  await ev(`document.querySelector(".agentpanel .alog")?.scrollTo(0, 1e6)`);
  await sleep(300);
  await shot(name);
  return reply;
};
await askAgent({ prefill: "Give me one angle for Pinthouse Brewing that I couldn't use at any other door.", send: true }, "01-angle", (r) => /Pinthouse/.test(r) && r.length > 120);
// §4.5: the thread panel's ask (the payload lib/whyviz/thread.js threadAsk builds), for the plan's #1 door
const { plan } = await demoContext();
const austin = route("athletic-brewing-austin"), c = city("austin");
const m = threadModel({ sv: sieve({ route: austin, plan, profile: plan.profile, city: c }), plan, city: c, route: austin, profile: plan.profile });
const ask = threadAsk(m, m.sel, { cityName: "Austin" });
report.ask = { selected: ask.selected.name, off: ask.doors.map((d) => d.name), onPlan: ask.onPlan.length };
const wn = await askAgent({ id: ask.selected.id, whynot: ask, send: true }, "02-whynot", (r) => ask.doors.every((d) => r.includes(d.name)) && /My pick:/.test(r) && ask.doors.every((d) => !d.fix || r.includes(d.fix.text.replace(/\s*\(open [^)]*\)/, "").replace(/^Lock it to \S+/, "Lock it to").slice(0, 20))));
check(ask.doors.every((d) => wn.split("\n").some((l) => l.includes(d.name))), "one line per door");
await ev(`document.querySelector(".agentpanel .alog")?.scrollTo(0, 0)`);
await sleep(200);
await shot("03-whynot-top");
report.problems = problems;
fs.writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
console.log(`\n${problems.length ? `PROBLEMS:\n${problems.join("\n")}` : "no console problems"}`);
process.exit(problems.length ? 1 : 0);
