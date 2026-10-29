// Jard's batch 2026-10-23 (#1, #12), proven in headless Chromium over CDP on the web app:
// #1: the form editing a saved plan (draft with editOf) offers no Delete for it (audit 2 #6 took Your plans off Edit
//     profile); a Duplicate of it (editOf.copy) → Delete the original from Your plans → no "Copy of …" note, typing kept.
// #12: "Rooms that already pour you": a bar's name, its city from the smart list ("dayt" → Dayton, OH) → the Qloo
//     search says "in Dayton, OH" and (live server) finds the Dayton room.
// Usage: node scripts/batchbugs-cdp.mjs <base-url> <out-dir> [width] [height] [live]   (live: run the Qloo search)
import { spawn } from "node:child_process";
import fs from "node:fs";
import { demoProfile } from "../public/lib/demo-profile.js";
import { storeKey } from "../public/lib/store.js";

const [base, out, w = "1400", h = "900", mode = ""] = process.argv.slice(2);
const live = mode === "live";
const before = mode === "before";
fs.mkdirSync(out, { recursive: true });
const port = 9400 + Math.floor(Math.random() * 400);
const dir = `/tmp/claude-1000/batch-${port}`;
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
const click = async (sel) => {
  const r = await ev(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.getClientRects().length); if (!e) return null; e.scrollIntoView({block:"center"}); const b = e.getBoundingClientRect(); return {x: b.left + b.width/2, y: b.top + b.height/2}; })()`);
  if (!r) throw new Error(`no visible ${sel}`);
  await sleep(150);
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: r.x, y: r.y, button: "left", clickCount: 1 });
};
const waitFor = async (expr, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(expr)) return true; await sleep(150); } await shot("zz-timeout"); throw new Error(`timed out: ${expr}\n${problems.join("\n")}`); };
const check = (ok, what) => { if (!ok && !before) problems.push(`check failed: ${what}`); };
const prof = demoProfile(new Date());
const key = storeKey(prof.brand, prof.city);
await send("Runtime.enable"); await send("Page.enable");
await send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => { try { if (!localStorage.getItem("__seeded")) {
  localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify({ v: 1, brand: prof.brand, city: prof.city, profile: prof, plan: null, statuses: {}, outcomes: {}, savedAt: new Date().toISOString() }))});
  localStorage.setItem(${JSON.stringify(storeKey("draft", ""))}, ${JSON.stringify(JSON.stringify({ v: 1, brand: "draft", city: "", profile: prof, editOf: { brand: prof.brand, city: prof.city, name: prof.brand } }))});
  localStorage.setItem("__seeded", "1"); } } catch {} })();` });
await send("Emulation.setDeviceMetricsOverride", { width: +w, height: +h, deviceScaleFactor: 1, mobile: +w < 700 });
await send("Page.navigate", { url: `${base}/app#/new` });
const report = { width: +w, checks: {} };
await waitFor(`!!document.querySelector("#f-brand")`, 30000);
await sleep(800);
report.checks.editingBefore = await ev(`!!document.querySelector(".editnote") && document.querySelector("#f-brand").value`);
await shot("1-editing-saved-plan");
// #1, after audit 2 #6 (E3b): Edit profile has no Your plans (form or app bar), so the plan being edited can't be
// deleted from it; Cancel is the way out
const noDel = await ev(`({ form: !!document.querySelector("#myplans-list"), bar: !!document.querySelector("#plans-btn"), cancel: !!document.querySelector("#f-cancel") })`);
report.checks.editNoDelete = noDel;
check(!noDel.form && !noDel.bar && noDel.cancel, "Edit profile offers no Delete for the plan being edited (Cancel instead)");
// the case still reachable: a Duplicate of the plan (editOf.copy) shows Your plans; deleting the original drops the
// "Copy of …" note and keeps the rep's typing, as new
await ev(`localStorage.setItem(${JSON.stringify(storeKey("draft", ""))}, ${JSON.stringify(JSON.stringify({ v: 1, brand: "draft", city: "", profile: prof, editOf: { brand: prof.brand, city: prof.city, name: prof.brand, copy: true } }))})`);
await send("Page.reload");
await waitFor(`!!document.querySelector("#f-brand") && !!document.querySelector(".editnote")`, 30000);
await sleep(800);
await ev(`(() => { const d = document.querySelector("#myplans"); if (d && d.tagName === "DETAILS") d.open = true; })()`);
await click('#myplans-list [data-act="del"]');
await sleep(300);
await click('#myplans-list [data-act="yes"]');
await sleep(1200);
const after = await ev(`({ brand: document.querySelector("#f-brand").value, what: document.querySelector("#f-what")?.value ?? "", editing: !!document.querySelector(".editnote"), title: document.title })`);
report.checks.afterDelete = after;
check(after.brand === prof.brand && !after.editing, "after deleting the plan a copy came from, the form keeps the typing and says nothing about the deleted plan");
await shot("2-after-delete-copy");
// a reload (the draft) stays that way: the phone's 'Start with my brand' path reads the same draft
await send("Page.reload");
await waitFor(`!!document.querySelector("#f-brand")`, 30000);
await sleep(800);
const reread = await ev(`({ brand: document.querySelector("#f-brand").value, editing: !!document.querySelector(".editnote") })`);
report.checks.afterReload = reread;
check(reread.brand === prof.brand && !reread.editing, "the saved draft names no deleted plan after the delete");
// #12: the pours city
const typeInto = async (sel, text) => { await click(sel); for (const c of text) { await send("Input.insertText", { text: c }); await sleep(40); } };
await typeInto("#f-pours", "Flavor House");
await sleep(300);
await typeInto("#f-pours-city", "dayt");
await waitFor(`!document.querySelector("#dd-pours-city").hidden`, 5000);
const cityOpts = await ev(`[...document.querySelectorAll("#dd-pours-city [role=option]")].map((o) => o.textContent)`);
report.checks.cityOpts = cityOpts;
check(cityOpts[0] === "Dayton, OH", "'dayt' lists Dayton, OH first");
await shot("3-pours-city-list");
await click("#dd-pours-city [data-i='0']");
await sleep(500);
const city = await ev(`document.querySelector("#f-pours-city").value`);
const searchOpt = await ev(`document.querySelector("#dd-pours .osearch")?.textContent ?? ""`);
report.checks.city = city; report.checks.searchOpt = searchOpt;
check(city === "Dayton, OH", "picking fills the city");
check(/Flavor House.*in Dayton, OH/.test(searchOpt), "the Qloo search says it looks in Dayton, OH");
await shot("4-pours-search-in-city");
if (live) {
  await click("#dd-pours .osearch");
  await waitFor(`[...document.querySelectorAll("#dd-pours [role=option]")].some((o) => /Flavor House/.test(o.textContent) && /Dayton/.test(o.textContent)) || /no bar or restaurant|didn't go through|today/i.test(document.querySelector("#dd-pours").textContent)`, 20000);
  const rows = await ev(`[...document.querySelectorAll("#dd-pours [role=option]")].map((o) => o.textContent)`);
  report.checks.liveRows = rows;
  check(rows.some((r) => /Flavor House/.test(r) && /Dayton/.test(r)), "Qloo finds Flavor House in Dayton");
  await shot("5-pours-live-results");
  await click("#dd-pours [data-i='0']");
  await sleep(500);
  report.checks.tags = await ev(`document.querySelector("#pours-tags").textContent`);
  await shot("6-pours-added");
}
console.log(JSON.stringify(report, null, 1));
console.log(problems.length ? `problems:\n${problems.join("\n")}` : "problems none");
process.exit(problems.length ? 1 : 0);
