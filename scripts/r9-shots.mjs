// The R9 screenshots for README and SUBMISSION (screenshots/v2/*-r9-*.png), from the guided demo's finished plan
// (/app?instant=1#/demo: the plan built, no tour cards). Zero live calls: the demo refuses every /api/ request, Ask Doors
// goes to Doors' rules in the page and drive mode's log-visit falls back to the rules parser.
//   ask:   Ask Doors, "Why is Nomadic Beerworks first?", its sources open
//   rules: Edit my brand for Maya's Tidewell profile (round 8: Settings → Edit my brand), Your rules open with "Never say near beer" listed
//   week:  the Week tab, three loops, after the tour's drive-mode visit (The Yard)
//   drive: drive mode, Done → typed words → the read-back (phone width)
//   phone: the full-screen map with its layer menu open (round 8), alone: a 5th argument "phone"
// Usage: node scripts/r9-shots.mjs <base-url> <out-dir> [width] [height] [phone]
import { spawn } from "node:child_process";
import fs from "node:fs";
import { demoDates, demoProfile } from "../public/lib/demo-profile.js";
import { storeKey, rulesKey, BRAND_KEY } from "../public/lib/store.js";
import { makeRecord } from "../public/lib/slots.js";
const [base, out, w = "1400", h = "900", only = ""] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const port = 9400 + Math.floor(Math.random() * 400);
const dir = `/tmp/claude-1000/r9shots-${port}`;
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
// every CDP call answers within 30 s, or the run stops (a call lost across a navigation once held the shared headless
// lock for 38 minutes)
const send = (method, params = {}) => new Promise((r, j) => { const i = ++id; const t = setTimeout(() => { pend.delete(i); j(new Error(`CDP ${method} gave no answer in 30 s`)); }, 30000); pend.set(i, (x) => { clearTimeout(t); r(x); }); ws.send(JSON.stringify({ id: i, method, params })); });
// and the whole run ends within 10 minutes
setTimeout(() => { console.error("r9-shots: over 10 minutes, stopping"); process.exit(1); }, 600000).unref();
const ev = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result?.value;
const shot = async (name) => { const { data } = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(`${out}/${name}.png`, Buffer.from(data, "base64")); console.log("shot", name); };
const until = async (expr, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr)) return true; await sleep(200); } problems.push("timed out: " + expr); return false; };
const NOMADIC = "00000000-0000-4000-8000-271655E6AA28";
const phone = +w <= 700;
await send("Runtime.enable"); await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: +w, height: +h, deviceScaleFactor: 1, mobile: phone });
const fresh = async () => {
  await send("Page.navigate", { url: "about:blank" }); await sleep(200);
  await send("Page.navigate", { url: `${base}/app?instant=1#/demo` });
  await until(`!!window.__demo?.done`, 30000); await sleep(2500);
  await ev(`document.querySelector(".ccard [data-cb]:last-child")?.click()`); // the hand-off card's Close
  await sleep(500);
};

// ---------- phone (round 8, Jard 10-28): the full-screen map with its layer menu open, on the finished tour plan ----------
// `node scripts/r9-shots.mjs <base> <out> 390 844 phone` shoots this alone (doc-shots: screenshots/v2/390-6-map.png). Full
// screen goes the pseudo way (the Fullscreen API removed from the page, as on an iPhone), so the shot is the viewport.
// Not here: drive mode's hands-free bar. The guided demo makes no voice call, so its drive Agent goes straight to the
// typed panel (ui/drive.js); a bar picture would need a saved plan and a faked recognizer (scripts/r8agentfull-cdp.mjs).
if (only === "phone") {
  await fresh();
  // Tuesday's tab: the layer menu lists Other days on a day, not on All days (where the finished tour leaves the plan)
  await ev(`document.querySelector('.daytabs [data-tab="0"]')?.click()`);
  await until(`document.querySelector('.daytabs [data-tab="0"]')?.getAttribute("aria-selected") === "true"`);
  await sleep(1500);
  await ev(`(() => { delete Element.prototype.requestFullscreen; delete Element.prototype.webkitRequestFullscreen; return true; })()`);
  await ev(`document.querySelector(".maplibregl-ctrl-fullscreen")?.click()`);
  await until(`document.querySelector("#plan-map")?.classList.contains("maplibregl-pseudo-fullscreen") && !!document.querySelector(".mapfull-exit .btn")`);
  await sleep(900);
  await ev(`document.querySelector("#t-layers")?.click()`);
  await until(`!document.querySelector("#p-layers")?.hidden`);
  await sleep(1200);
  await shot(`${w}-r9-map`);
  const fin = await ev(`({ blocked: window.__demo?.blocked, agent: window.__demo?.agent ?? 0 })`);
  console.log("final", JSON.stringify(fin));
  console.log("problems", problems.length ? problems.join("\n") : "none");
  process.exit(0);
}

// ---------- ask ----------
await fresh();
await ev(`document.querySelector('[data-agent="open"]').click()`);
await until(`!!document.querySelector("#agentInput")`);
await ev(`(() => { const i = document.querySelector("#agentInput"); i.value = "Why is Nomadic Beerworks first?"; i.dispatchEvent(new Event("input", { bubbles: true })); document.querySelector('[data-agent="send"]').click(); })()`);
await until(`!!document.querySelector("#agentLog .agent-msg[data-role=agent] .agent-facts")`);
await ev(`(() => { const d = [...document.querySelectorAll("#agentLog details")].at(-1); if (d) d.open = true; const l = document.querySelector("#agentLog"); if (l) l.scrollTop = 0; })()`);
await sleep(600);
await shot(`${w}-r9-ask`);

// ---------- rules ----------
// Your rules live in Edit my brand (ease audit #9; round 8: Settings → Edit my brand, #/brand) and are the brand's, every
// city. The guided demo keeps its plan in memory, so this shot builds the same profile (Maya's Tidewell in Austin) from
// the form's example, stores "never say near beer" as the brand's rule the way Edit my brand stores it, and opens Edit my
// brand with the rule listed. The plan, the brand and the rule are removed after, so the shots below are the demo's own.
const prof = demoProfile(new Date());
const pkey = storeKey(prof.brand, prof.city), rkey = rulesKey(prof.brand);
const rule = makeRecord({ slot: "S6", field: "rule.avoid", value: "near beer", source: "corrected", by: "rep" });
await send("Page.navigate", { url: "about:blank" }); await sleep(200);
await send("Page.navigate", { url: `${base}/app#/new?blank=1` });
await until(`!!document.querySelector("#f-brand")`, 30000); await sleep(800);
await ev(`document.querySelector("#examples details").open = true`);
await ev(`document.querySelector('[data-ex="maya"]')?.click()`);
await until(`document.querySelector("#f-brand")?.value === "Tidewell"`);
await sleep(1500); // the form's ranked-rooms fetch (drawKnown) settles before Build tears the form down; the instant sample build otherwise beats it
await ev(`document.querySelector("#build").click()`);
await until(`location.hash.startsWith("#/plan") && !!document.querySelector(".stop[data-id]") && !document.querySelector("[data-b2]")`, 90000);
await ev(`localStorage.setItem(${JSON.stringify(rkey)}, ${JSON.stringify(JSON.stringify([rule]))}); true`);
await send("Page.navigate", { url: `${base}/app#/brand` });
if (await until(`!!document.querySelector("#fd-rules .rlist")`, 30000)) {
  await ev(`(() => { const d = document.querySelector("#fd-rules"); d.open = true; d.scrollIntoView({ block: "start" }); scrollBy(0, -96); })()`);
  const got = await ev(`document.querySelector("#fd-rules .rlist li span")?.textContent ?? ""`);
  if (!/Never say “near beer”/.test(got)) problems.push(`the rule isn't listed in Edit my brand: ${got}`);
}
await sleep(1000);
await shot(`${w}-r9-rules`);
await ev(`localStorage.removeItem(${JSON.stringify(pkey)}); localStorage.removeItem(${JSON.stringify(BRAND_KEY)}); localStorage.removeItem(${JSON.stringify(rkey)}); true`);

// ---------- week: every day's loop on the map, the Week list beside it, no tour card (judge pass 4, #8/N20) ----------
// After the tour's drive-mode visit (card "save": The Yard, back on Thursday), as the finished tour plan shows it: without
// it the Week read "21 doors over 3 days, plus 1 return visit", the finished plan "19 … plus 2" (judge pass 5, #6).
await fresh();
await ev(`document.querySelector("#t-drive").click()`);
await until(`!!document.querySelector("#drive [data-drive-door]")`);
const weekFirst = await ev(`document.querySelector("#drive [data-drive-door]").dataset.id`);
await ev(`document.querySelector("#drive [data-drive-done]").click()`);
await until(`!!document.querySelector("#drive-text")`);
{
  const when = new Date(`${demoDates().at(-1)}T12:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  await ev(`(() => { const t = document.querySelector("#drive-text"); t.value = ${JSON.stringify("done, liked it, come back ")} + ${JSON.stringify(when)} + " at 3, hesitant about price"; document.querySelector("#drive [data-drive-log]").click(); })()`);
}
await until(`!!document.querySelector("#drive [data-drive-save]")`);
await ev(`document.querySelector("#drive [data-drive-save]").click()`);
await until(`!document.querySelector("#drive [data-drive-sheet]") && document.querySelector("#drive [data-drive-door]")?.dataset.id !== ${JSON.stringify(weekFirst)}`);
await sleep(800);
await ev(`document.querySelector("#drive [data-drive-close]")?.click()`);
await sleep(600);
await ev(`document.querySelector('.daytabs [data-tab="week"]').click()`);
await until(`document.querySelector('.daytabs [data-tab="week"]')?.getAttribute("aria-selected") === "true"`);
await sleep(2500);
await shot(`${w}-r9-week`);

// ---------- drive (the phone's mode; on a laptop it is the same overlay) ----------
await fresh();
await ev(`document.querySelector("#t-drive").click()`);
await until(`!!document.querySelector("#drive [data-drive-door]")`);
await sleep(600);
await shot(`${w}-r9-drive-door`);
await ev(`document.querySelector("#drive [data-drive-done]").click()`);
await until(`!!document.querySelector("#drive-text")`);
// the demo's Thursday as a date, as the tour says it (a weekday alone can mean this week's)
const when = new Date(`${demoDates().at(-1)}T12:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
await ev(`(() => { const t = document.querySelector("#drive-text"); t.value = ${JSON.stringify("done, liked it, come back ")} + ${JSON.stringify(when)} + " at 3, hesitant about price"; document.querySelector("#drive [data-drive-log]").click(); })()`);
await until(`!!document.querySelector("#drive [data-drive-readback]")`);
await sleep(500);
await shot(`${w}-r9-drive-readback`);
const fin = await ev(`({ blocked: window.__demo?.blocked, agent: window.__demo?.agent ?? 0 })`);
console.log("final", JSON.stringify(fin), "when", when);
console.log("problems", problems.length ? problems.join("\n") : "none");
process.exit(0);
