// Jard's batch 2026-10-23 #16 (Flavor House): a door with no website from Qloo gets "Search the web ↗" on its stop
// card, a plain DuckDuckGo search for "<name> <city>, <ST>"; a door with a website keeps "Website ↗". Headless
// Chromium over CDP on the demo plan (Austin): opens each stop until it has one of each, and shoots both.
// Usage: node scripts/websearch-cdp.mjs <base-url> <out-dir> [width] [height]
import { spawn } from "node:child_process";
import fs from "node:fs";
import { demoProfile } from "../public/lib/demo-profile.js";
import { storeKey } from "../public/lib/store.js";

const [base, out, w = "1400", h = "900"] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const port = 9400 + Math.floor(Math.random() * 400);
const dir = `/tmp/claude-1000/websearch-${port}`;
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
const waitFor = async (expr, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(expr)) return true; await sleep(150); } await shot("zz-timeout"); throw new Error(`timed out: ${expr}\n${problems.join("\n")}`); };
const check = (ok, what) => { if (!ok) problems.push(`check failed: ${what}`); };

const prof = demoProfile(new Date());
const key = storeKey(prof.brand, prof.city);
await send("Runtime.enable"); await send("Page.enable");
await send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => { try { if (!localStorage.getItem("__seeded")) { localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify({ v: 1, brand: prof.brand, city: prof.city, profile: prof, plan: null, statuses: {}, outcomes: {}, savedAt: new Date().toISOString() }))}); localStorage.setItem("__seeded", "1"); } } catch {} })();` });
await send("Emulation.setDeviceMetricsOverride", { width: +w, height: +h, deviceScaleFactor: 1, mobile: +w < 700 });
await send("Page.navigate", { url: `${base}/app#/plan?${new URLSearchParams({ brand: prof.brand, city: prof.city, instant: "1" })}` });
await waitFor(`!!document.querySelector(".stop[data-id]")`, 40000);
await sleep(2500);
await waitFor(`!document.querySelector(".b2-building")`, 60000);
// skip "Routing from your start…" so the stop column is drawn (desktop)
for (let i = 0; i < 40 && (await ev(`!![...document.querySelectorAll("button")].find((b) => /^Skip/.test(b.textContent.trim()) && b.getClientRects().length)`)); i++) { await ev(`[...document.querySelectorAll("button")].find((b) => /^Skip/.test(b.textContent.trim()) && b.getClientRects().length)?.click()`); await sleep(500); }
await sleep(1000);
const ids = await ev(`[...new Set([...document.querySelectorAll(".stop[data-id]")].map((e) => e.dataset.id))]`);
const report = { width: +w, stops: ids.length, web: null, search: null };
for (const sid of ids) {
  if (report.web && report.search) break;
  await ev(`window.dispatchEvent(new CustomEvent("doors:open-stop", { detail: { id: ${JSON.stringify(sid)}, day: 0 } }))`);
  await waitFor(`!!document.querySelector(".stopview:not([hidden]) h2")`);
  await sleep(900);
  const l = await ev(`(() => { const a = document.querySelector(".stopview:not([hidden]) .slinks a"); return { name: document.querySelector(".stopview:not([hidden]) h2").textContent, text: a?.textContent ?? null, href: a?.href ?? null, target: a?.target ?? null, rel: a?.rel ?? null }; })()`);
  if (l.text) { await ev(`document.querySelector(".stopview:not([hidden]) .slinks a").scrollIntoView({ block: "center" })`); await sleep(300); }
  if (l.text === "Search the web ↗" && !report.search) { report.search = l; await shot("search-the-web"); }
  if (l.text === "Website ↗" && !report.web) { report.web = l; await shot("website"); }
}
check(report.search, "a stop with no website shows Search the web ↗");
check(report.web, "a stop with a website still shows Website ↗");
if (report.search) {
  check(/^https:\/\/duckduckgo\.com\/\?q=/.test(report.search.href), "the search link is a DuckDuckGo search");
  const q = decodeURIComponent(new URL(report.search.href).searchParams.get("q") ?? "");
  report.search.q = q;
  check(q.startsWith(report.search.name) && /, [A-Z]{2}$/.test(q), `the query is "<name> <city>, <ST>" (${q})`);
  check(report.search.target === "_blank" && /noopener/.test(report.search.rel), "opens in a new tab, noopener");
}
report.problems = problems;
console.log(JSON.stringify(report, null, 1));
process.exit(problems.length ? 1 : 0);
