// The Log book (round 4 item 10) walked in headless Chromium over CDP: Maya's finished demo plan, a few doors touched
// through the plan's own actions (a visit with an outcome, a follow-up, Not a fit, a note, Save for later), then the
// Log book from the Menu: the pane, a timeline, a search, a filter, the CSV download; the Save for later entry on a row's
// ⋯ menu and the stop's ⋯ menu. Screenshots every step; prints any console error.
// Usage: node scripts/logbook-cdp.mjs <base-url> <out-dir> [width] [height]
import { spawn } from "node:child_process";
import fs from "node:fs";
const [base, out, w = "1400", h = "900"] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const port = 9400 + Math.floor(Math.random() * 400);
const prof = `/tmp/claude-1000/logbook-${port}`;
const ch = spawn("chromium", ["--headless=new", `--remote-debugging-port=${port}`, "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--hide-scrollbars", `--window-size=${w},${h}`, `--user-data-dir=${prof}`, "about:blank"], { stdio: "ignore", detached: true });
const cleanup = () => { try { process.kill(-ch.pid, "SIGKILL"); } catch {} try { fs.rmSync(prof, { recursive: true, force: true }); } catch {} };
process.on("exit", cleanup);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(1));
process.on("uncaughtException", (e) => { console.error(e); process.exit(1); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 50; i++) { try { const t = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); const p = t.find((x) => x.type === "page"); if (p) { ws = new WebSocket(p.webSocketDebuggerUrl); break; } } catch {} await sleep(200); }
await new Promise((r) => ws.addEventListener("open", r));
let id = 0; const pend = new Map(); const problems = [];
ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
  if (m.method === "Runtime.consoleAPICalled" && /error|warn/.test(m.params.type)) { const t = m.params.args.map((a) => a.value ?? a.description).join(" ").slice(0, 300); if (!/refused \/api/.test(t)) problems.push("console." + m.params.type + " " + t); }
  if (m.method === "Runtime.exceptionThrown") problems.push("exception " + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 300)); });
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r?.exceptionDetails) problems.push("eval " + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text).slice(0, 300)); return r?.result?.value; };
let n = 0;
const shot = async (name) => { const { data } = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(`${out}/${String(++n).padStart(2, "0")}-${name}.png`, Buffer.from(data, "base64")); console.log(n, name); };
const clickAt = async (sel) => {
  const r = await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({block:"center"}); const b = e.getBoundingClientRect(); return {x: b.left + b.width/2, y: b.top + b.height/2}; })()`);
  if (!r) { problems.push(`no target ${sel}`); return false; }
  await sleep(200);
  const r2 = await ev(`(() => { const b = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return {x: b.left + b.width/2, y: b.top + b.height/2}; })()`);
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: r2.x, y: r2.y, button: "left", clickCount: 1 });
  return true;
};
const waitFor = async (expr, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(expr)) return true; await sleep(250); } problems.push(`timeout waiting for ${expr.slice(0, 80)}`); return false; };
await send("Runtime.enable"); await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: +w, height: +h, deviceScaleFactor: 1, mobile: +w < 700 });
await send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: out, eventsEnabled: true });
await send("Page.navigate", { url: `${base}/app?instant=1#/demo?instant=1` });
await waitFor(`!!document.querySelector(".stops .stop[data-id]")`, 30000);
await sleep(1500);
await shot("plan");

// ---- touch a few doors through the plan's own actions (ui/state.js, the same module the UI uses) ----
const seeded = await ev(`(async () => {
  const S = await import("/ui/state.js");
  const { makeNote } = await import("/lib/door-notes.js");
  const p = S.getPlan();
  // doors nobody has touched yet (Maya's finished plan has a visit or two of its own)
  const fresh = (d) => d.stops.map((s) => s.id).filter((x) => !p.statuses[x] && !p.outcomes?.[x]);
  const day0 = p.days.findIndex((d) => fresh(d).length >= 3), day1 = p.days.findIndex((d, i) => i !== day0 && fresh(d).length);
  const [A, B, E] = fresh(p.days[day0]);
  const D = fresh(p.days[day1])[0];
  const onDays = new Set(p.days.flatMap((d) => d.stops.map((s) => s.id)));
  const C = p.pool.ids.find((x) => !onDays.has(x));
  const at = p.days[day0].date + "T14:10:00"; // as ui/outcome.js stamps a visit logged on a previewed day (lib visitStamp)
  await S.setStatus(A, "visited"); await S.setOutcome(A, { result: "interested", who: "Sam", note: "Wants a sample case Thursday", at });
  await S.setStatus(B, "visited"); await S.setOutcome(B, { result: "followup", followUp: p.days[day1].date, at: p.days[day0].date + "T14:40:00" });
  await S.setStatus(E, "notfit");
  S.setSlot(D, makeNote({ text: "Ask for Maria, she's in Thursdays after 4", by: "rep" }));
  S.setLater(C, true);
  S.setLater(D, true);
  return { A: p.venues[A].name, B: p.venues[B].name, C: p.venues[C].name, D: p.venues[D].name, E: p.venues[E].name, dates: p.days.map((d) => d.date) };
})()`);
console.log("seeded", JSON.stringify(seeded));
await sleep(2500);
await shot("plan-after");

// ---- the pane from the top bar (round 6 #5: out of the Menu) ----
await clickAt('[data-drawer="logbook"]'); await sleep(600);
await shot("logbook");
const counts = await ev(`[...document.querySelectorAll("#logbook .lb-tile")].map((t) => t.querySelector("b").textContent + " " + t.querySelector("span").textContent).join(" | ")`);
console.log("tiles:", counts);
console.log("activity:", await ev(`JSON.stringify((document.querySelector("#logbook").__lbCtx?.state.activity ?? []).map((e) => [e.seq, e.kind, e.to ?? e.result ?? "", (e.name ?? "").slice(0, 12), e.at]))`));
const rows = await ev(`[...document.querySelectorAll("#logbook .lb-row")].map((r) => r.querySelector(".lb-nm").textContent + " — " + r.querySelector(".tg").textContent + " — " + (r.querySelector(".lb-last")?.textContent ?? "") + " — " + (r.querySelector(".lb-next")?.textContent ?? "")).join("\\n")`);
console.log("rows:\n" + rows);
if (await ev(`document.querySelector("#logbook").scrollTop`) !== 0) problems.push("the Log book did not open at the top");
await clickAt('#logbook .lb-row [data-lb="tl"]'); await sleep(300); await shot("timeline");
console.log("timeline:", await ev(`[...document.querySelectorAll("#logbook .lb-tl li")].map((l) => l.textContent.trim()).join(" || ")`));
await clickAt("#logbook .lb-search"); await send("Input.insertText", { text: "maria" }); await sleep(400); await shot("search");
console.log("search rows:", await ev(`[...document.querySelectorAll("#logbook .lb-row .lb-nm")].map((e) => e.textContent).join(", ")`));
if (await ev(`document.activeElement?.className`) !== "lb-search") problems.push("search lost focus on redraw");
await ev(`(() => { const f = document.querySelector("#logbook .lb-search"); f.value = ""; f.dispatchEvent(new Event("input", { bubbles: true })); })()`); await sleep(200);
await clickAt('#logbook .lb-tile[data-status="saved"]'); await sleep(300); await shot("filter-saved");
console.log("saved rows:", await ev(`[...document.querySelectorAll("#logbook .lb-row .lb-nm")].map((e) => e.textContent).join(", ")`));
await clickAt('#logbook .lb-row [data-lb="later"]'); await sleep(500); await shot("unsaved-toast");
console.log("after unsave:", await ev(`[...document.querySelectorAll("#logbook .lb-row .lb-nm")].map((e) => e.textContent).join(", ")`), "| toast:", await ev(`document.querySelector("#p-toast")?.textContent`));
await clickAt('#logbook .lb-tile[data-status=""]'); await sleep(200);
await clickAt('#logbook [data-lb="csv"]'); await sleep(1200);
const csv = fs.readdirSync(out).find((f) => /^doors-logbook-.*\.csv$/.test(f));
if (csv) console.log("csv:", csv, "\n" + fs.readFileSync(`${out}/${csv}`, "utf8").split("\r\n").slice(0, 4).join("\n")); else problems.push("no CSV downloaded");
await clickAt('#logbook [data-lb="csv-activity"]'); await sleep(1200);
const acsv = fs.readdirSync(out).find((f) => /^doors-activity-.*\.csv$/.test(f));
if (acsv) console.log("activity csv:", acsv, "\n" + fs.readFileSync(`${out}/${acsv}`, "utf8").split("\r\n").slice(0, 4).join("\n")); else problems.push("no activity CSV downloaded");
await shot("after-download");
// Open the door from the Log book, then back: the Log book returns
await clickAt('#logbook .lb-row [data-lb="open"]'); await sleep(900); await shot("door-from-logbook");
await clickAt('.stopview:not([hidden]) [data-s="close"]'); await sleep(700); await shot("back-to-logbook");
if (await ev(`document.querySelector("#logbook").hidden`)) problems.push("closing the door did not bring the Log book back");
await clickAt('#logbook [data-lb="close"]'); await sleep(400);
if (!(await ev(`document.querySelector("#logbook").hidden`))) problems.push("the Log book did not close");

// ---- Save for later on Your list's row menu, the stop's ⋯ menu, the map card ----
await clickAt('.daytabs [data-tab="rest"]'); await sleep(800);
await clickAt('.stops .stop.rest:not([data-day]) .more'); await sleep(300); await shot("rowmenu-rest");
console.log("row menu:", await ev(`[...document.querySelectorAll('.stops .stop .menu:not([hidden]) [role=menuitem]')].map((b) => b.textContent).join(" / ")`));
await clickAt('.stops .stop .menu:not([hidden]) [data-act="later"]'); await sleep(700); await shot("row-saved");
console.log("saved tag on the row:", await ev(`!!document.querySelector('.stops .stop .tg.sv')`), "| toast:", await ev(`document.querySelector("#p-toast")?.textContent`));
if (+w > 900) {
  // the map card of a door not on a day (a rank pin, drawn while Your list is up): Save for later on it
  const ok = await clickAt(".maplibregl-marker .mrank");
  await sleep(900);
  if (ok && (await ev(`!!document.querySelector("[data-card-later]")`))) { await shot("map-card"); await clickAt("[data-card-later]"); await sleep(600); await shot("map-card-saved"); console.log("map card toast:", await ev(`document.querySelector("#p-toast")?.textContent`), "| button:", await ev(`document.querySelector("[data-card-later]")?.textContent`)); await ev(`document.querySelector(".maplibregl-popup-close-button")?.click()`); }
  else problems.push("map card: no rank pin to open");
}
await clickAt('.daytabs [data-tab="0"]'); await sleep(800);
await clickAt('.stops .stop[data-day] [data-open]'); await sleep(900);
await waitFor(`document.querySelector("#p-toast")?.hidden !== false`, 12000); // a phone's toast sits over the sheet's ⋯ menu until it clears (9 s with Undo)
await clickAt('.stopview:not([hidden]) [data-s="more"]'); await sleep(300); await shot("stop-more");
console.log("stop more:", await ev(`[...document.querySelectorAll('.stopview:not([hidden]) .smore [role=menuitem]')].map((b) => b.textContent).join(" / ")`));
await clickAt('.stopview:not([hidden]) .smore [data-s="later"]'); await sleep(700); await shot("stop-saved");
console.log("stop toast:", await ev(`document.querySelector("#p-toast")?.textContent`));
await clickAt('.stopview:not([hidden]) [data-s="close"]'); await sleep(500);
// the Log book again: every touch above is in it
await clickAt("#t-menu"); await sleep(200); await clickAt('[data-drawer="logbook"]'); await sleep(600); await shot("logbook-final");
console.log("final tiles:", await ev(`[...document.querySelectorAll("#logbook .lb-tile")].map((t) => t.querySelector("b").textContent + " " + t.querySelector("span").textContent).join(" | ")`));
console.log("final sum:", await ev(`document.querySelector("#logbook .lb-sum")?.textContent`));
await ev(`document.querySelector("#logbook").scrollTo(0, 99999)`); await sleep(200); await shot("logbook-bottom");
console.log("problems", problems.length ? problems.join("\n") : "none");
process.exit(0);
