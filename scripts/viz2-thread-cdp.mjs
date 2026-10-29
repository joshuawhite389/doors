// WHY-VIZ-SPEC §4.5 (lane 2): the thread picture on the real page. Seeds Maya's demo profile as a saved plan, opens
// Why these doors → Doors Deep Dive, shoots the graph and the default thread (Nomadic Beerworks), clicks a node, Adds a
// door (the preview tray shows its day), Adds all, asks the Doors Agent (the rules card), presses a fix button, and
// Applies an add (Undo toast). Checks the numbers against the model's golden test.
// Usage: node scripts/viz2-thread-cdp.mjs <base-url> <out-dir> [width] [height]
import { spawn } from "node:child_process";
import fs from "node:fs";
import { demoProfile } from "../public/lib/demo-profile.js";
import { storeKey, STORE_VERSION, BRAND_KEY } from "../public/lib/store.js";
const [base, out, w = "1400", h = "900"] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const port = 9400 + Math.floor(Math.random() * 400);
const dir = `/tmp/claude-1000/viz2-${port}`;
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
const check = (ok, what) => { if (!ok) problems.push(`check failed: ${what}`); };
const report = { width: +w };
const prof = demoProfile(new Date());
prof.known = [];
const key = storeKey(prof.brand, prof.city);
await send("Runtime.enable"); await send("Page.enable");
const state = { v: STORE_VERSION, brand: prof.brand, city: prof.city, profile: prof, plan: null, statuses: {}, outcomes: {}, savedAt: new Date().toISOString() };
await send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => { try { if (!localStorage.getItem("__seeded")) { localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify(state))}); localStorage.setItem(${JSON.stringify(BRAND_KEY)}, ${JSON.stringify(JSON.stringify({ v: STORE_VERSION, profile: prof, savedAt: new Date().toISOString() }))}); localStorage.setItem("doors:drive-voice", "off"); localStorage.setItem("__seeded", "1"); } } catch {} window.SpeechRecognition = undefined; delete window.webkitSpeechRecognition; })();` });
await send("Emulation.setDeviceMetricsOverride", { width: +w, height: +h, deviceScaleFactor: 1, mobile: +w < 700 });
const q = new URLSearchParams({ brand: prof.brand, city: prof.city });
await send("Page.navigate", { url: `${base}/app?ors=off&instant=1#/plan?${q}` });
await waitFor(`!!document.querySelector(".stop[data-id]")`, 40000);
await sleep(2500);
await send("Page.reload");
await waitFor(`!!document.querySelector(".stop[data-id]")`, 40000);
await sleep(2500);
await ev(`[...document.querySelectorAll('[data-drawer="why"]')].find((b) => b.getClientRects().length)?.click()`);
await waitFor(`!!document.querySelector("#why .wv-explorer svg .wv-dot")`, 20000);
await sleep(600);
// Doors Deep Dive
await click('#why [data-view="plan"]');
await waitFor(`!!document.querySelector('#why [data-wv-slot="thread"] svg')`, 20000);
await sleep(700);
await ev(`document.querySelector("#why").scrollTop = 0`);
await shot("t1-deepdive");
const say = await ev(`document.querySelector("#why .wv-th-say")?.textContent ?? ""`);
report.say = say;
check(/^Qloo says the same crowd goes to Nomadic Beerworks and 9 other doors: /.test(say), `sentence (${say})`);
check(/\d connected threads/.test(say), "threads count in the sentence");
report.nodes = await ev(`document.querySelectorAll("#why .wv-th-node").length`);
report.edges = await ev(`document.querySelectorAll("#why .wv-th-edges line").length`);
check(report.nodes >= 60 && report.nodes <= 120, `nodes ${report.nodes}`);
const head = await ev(`document.querySelector("#why .wv-th-phead")?.textContent ?? ""`);
check(/Nomadic Beerworks9 doors share its crowd, Qloo says\. 5 are on your plan\./.test(head), `panel head (${head})`);
report.rows = await ev(`[...document.querySelectorAll("#why .wv-th-rows li")].map((li) => li.textContent.replace(/\\s+/g, " ").trim())`);
check(report.rows.length === 9, `9 rows (${report.rows.length})`);
check(/Growler Express#3 on Your list · no time leftAdd/.test(report.rows[0].replace(/ /g, "")) || /Growler Express.*no time left.*Add/.test(report.rows[0]), `first row (${report.rows[0]})`);
await ev(`document.querySelector("#why .wv-th-panel").scrollIntoView({block:"start"})`);
await shot("t2-panel");
// the table twin holds every node
await click("#why .wv-tbl summary");
await sleep(200);
report.twinRows = await ev(`document.querySelectorAll("#why .wv-th .wv-tbl tbody tr, #why [data-wv-slot=thread] .wv-tbl tbody tr").length`);
check(report.twinRows === report.nodes, `twin rows ${report.twinRows} = nodes ${report.nodes}`);
await click("#why .wv-tbl summary");
// hover a node: the tooltip
const nodeSel = `#why .wv-th-node[data-id]`;
const hov = await ev(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(nodeSel)})].find((g) => g.classList.contains("k-list")); e.scrollIntoView({block:"center"}); const b = e.querySelector(".wv-th-dot").getBoundingClientRect(); return {x: b.left + b.width/2, y: b.top + b.height/2}; })()`);
await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: hov.x, y: hov.y });
await sleep(250);
report.tip = await ev(`(() => { const t = document.querySelector(".wv-tip"); return t && !t.hidden ? t.textContent : null; })()`);
check(report.tip && /shares? its crowd/.test(report.tip), `tooltip (${report.tip})`);
await shot("t3-hover");
// click another plan door: the panel follows
await ev(`[...document.querySelectorAll("#why .wv-th-node.k-plan")].find((g) => g.querySelector("text")?.textContent === "Oddwood Brewing")?.dispatchEvent(new MouseEvent("click", {bubbles:true}))`);
await sleep(400);
const head2 = await ev(`document.querySelector("#why .wv-th-phead h5")?.textContent`);
check(head2 === "Oddwood Brewing", `select by click (${head2})`);
report.say2 = await ev(`document.querySelector("#why .wv-th-say")?.textContent`);
check(/^Qloo says the same crowd goes to Oddwood Brewing/.test(report.say2), `sentence follows (${report.say2})`);
await shot("t4-select");
// back to Nomadic by its row in another thread is not guaranteed: use the table twin's link? the twin has no links; select via the node
await ev(`[...document.querySelectorAll("#why .wv-th-node.k-plan")].find((g) => g.querySelector("text")?.textContent === "Nomadic Beerworks")?.dispatchEvent(new MouseEvent("click", {bubbles:true}))`);
await sleep(300);
// Add Growler Express: the preview tray, its day
await click('#why .wv-th-rows li [data-th-add]');
await waitFor(`!!document.querySelector("#why .wv-th-panel .ws-pv") && !document.querySelector("#why .wv-th-panel .ws-pv.busy")`, 30000);
await sleep(300);
report.pv = await ev(`document.querySelector("#why .wv-th-panel .ws-pv")?.textContent.replace(/\\s+/g, " ").trim()`);
check(/If you: Add Growler Express to my plan/.test(report.pv), `preview (${report.pv})`);
report.addedRow = await ev(`document.querySelector("#why .wv-th-rows li.k-added")?.textContent.replace(/\\s+/g, " ").trim()`);
check(/Growler ExpressAdded · \w+day\s*Added/.test(report.addedRow), `added row shows its day (${report.addedRow})`);
report.addedDots = await ev(`[...document.querySelectorAll("#why .wv-th-node")].filter((g) => g.querySelector(".wv-th-dot").getAttribute("r") === "8" && g.classList.contains("k-list")).length`);
check(report.addedDots === 1, `the added dot is filled (${report.addedDots})`);
await ev(`document.querySelector("#why .wv-th-panel").scrollIntoView({block:"start"})`);
await shot("t5-add-preview");
// Add all: the rest of the thread joins the same preview
await click('#why [data-th-addall]');
await waitFor(`!!document.querySelector("#why .wv-th-panel .ws-pv") && !document.querySelector("#why .wv-th-panel .ws-pv.busy") && /Add \\d+ doors/.test(document.querySelector("#why .wv-th-panel .ws-pv").textContent)`, 40000);
await sleep(300);
report.pvAll = await ev(`document.querySelector("#why .wv-th-panel .ws-pv")?.textContent.replace(/\\s+/g, " ").trim()`);
check(/If you: Add 4 doors to my plan: Growler Express/.test(report.pvAll), `add all preview (${report.pvAll})`);
report.addedAll = await ev(`document.querySelectorAll("#why .wv-th-rows li.k-added").length`);
check(report.addedAll === 4, `4 added rows (${report.addedAll})`);
await shot("t6-add-all");
// cancel; ask the agent: the rules card with per-door reason + fix + pick
await click('#why .wv-th-panel [data-pv="cancel"]');
await sleep(300);
check(await ev(`document.querySelectorAll("#why .wv-th-rows li.k-added").length === 0`), "cancel clears the added rows");
await click('#why [data-th-ask]');
await sleep(300);
report.agent = await ev(`document.querySelector("#why .wv-th-agent")?.innerText.replace(/\\s+/g, " ").trim()`);
check(/Doors Agent This answer is from Doors' own rules: no model was used\.(?: Asking Doors Agent for its own answer…)? 4 of the 9 doors that share Nomadic Beerworks's crowd aren't on your plan\./i.test(report.agent), `agent head (${report.agent?.slice(0, 160)})`);
check(/Growler Express \(#3 on Your list\): Tuesday had no time left for it\. Raise that day's cap or add a day\./.test(report.agent), "Growler line");
check(/My pick: Growler Express first\./.test(report.agent), "pick");
report.fixButtons = await ev(`[...document.querySelectorAll("#why .wv-th-agent [data-th-fix], #why .wv-th-agent [data-th-add], #why .wv-th-agent a.lnk")].map((b) => b.textContent)`);
check(report.fixButtons.includes("Include the most popular doors") && report.fixButtons.some((t) => /^Add Growler Express$/.test(t)), `fix buttons (${report.fixButtons})`);
await ev(`document.querySelector("#why .wv-th-agent").scrollIntoView({block:"start"})`);
await shot("t7-agent");
report.asking = await ev(`!!document.querySelector("#why .wv-th-asking")`);
check(report.asking, "the card says it is asking the Doors Agent");
// the model path's reply (agent2's doors:agent-reply r.whynot) replaces the rules card, labelled with the model
await ev(`window.dispatchEvent(new CustomEvent("doors:agent-reply", { detail: { reply: "x", by: "gemini", model: "test-model", whynot: { doors: [{ id: document.querySelector("#why .wv-th-rows li [data-th-add]").dataset.thAdd, name: "Growler Express", rank: 3, status: "#3 on Your list · no time left", reason: "Tuesday had no time left for it (model).", fix: { key: "full", act: "days", text: "Raise that day's cap or add a day." } }], onPlan: [], pick: { id: null, name: "Growler Express", text: "My pick: Growler Express first (model)." } } } }))`);
await sleep(300);
report.agentModel = await ev(`document.querySelector("#why .wv-th-agent")?.innerText.replace(/\\s+/g, " ").trim()`);
check(/This answer: test-model\./.test(report.agentModel) && /Tuesday had no time left for it \(model\)\./.test(report.agentModel) && /My pick: Growler Express first \(model\)\./.test(report.agentModel) && !/Asking Doors Agent/.test(report.agentModel), `model reply replaces the rules card (${report.agentModel?.slice(0, 200)})`);
await shot("t7b-agent-model");
// back to the rules card for the fix-button steps: close and reopen the ask
await click('#why [data-th-ask]'); await sleep(200); await click('#why [data-th-ask]'); await sleep(300);
// a fix button: Include the big names → the famous preview
await click('#why .wv-th-agent [data-th-fix="famous"]');
await waitFor(`!!document.querySelector("#why .wv-th-panel .ws-pv") && !document.querySelector("#why .wv-th-panel .ws-pv.busy")`, 30000);
report.pvFamous = await ev(`document.querySelector("#why .wv-th-panel .ws-pv")?.textContent.replace(/\\s+/g, " ").trim()`);
check(/If you: Include the most popular doors now/.test(report.pvFamous), `famous fix preview (${report.pvFamous})`);
await shot("t8-fix-famous");
await click('#why .wv-th-panel [data-pv="cancel"]');
await sleep(300);
// the pick's Add, then Apply: the door lands on a day, the toast has Undo, the picture redraws with it on the plan
await click('#why .wv-th-agent [data-th-add]');
await waitFor(`!!document.querySelector("#why .wv-th-panel .ws-pv") && !document.querySelector("#why .wv-th-panel .ws-pv.busy")`, 30000);
await click('#why .wv-th-panel [data-pv="apply"]');
await waitFor(`!!document.querySelector(".toast, .flash, [role=status].ftoast")`, 20000).catch(() => null);
await sleep(2500);
report.toast = await ev(`[...document.querySelectorAll("body *")].filter((e) => /Added to \\w+day|Added \\d|Growler Express/.test(e.textContent) && e.children.length <= 3 && /undo/i.test(e.textContent)).map((e) => e.textContent.replace(/\\s+/g, " ").trim()).slice(-1)[0] ?? null`);
report.onPlanAfter = await ev(`(() => { const g = [...document.querySelectorAll("#why .wv-th-node.k-plan")].find((x) => x.querySelector("text")?.textContent === "Growler Express"); return !!g; })()`);
check(report.onPlanAfter, "Growler Express is a plan node after Apply");
const say3 = await ev(`document.querySelector("#why .wv-th-say")?.textContent ?? ""`);
check(/and 9 other doors: Growler Express/.test(say3) || /Growler Express/.test(say3), `sentence after apply (${say3})`);
await ev(`document.querySelector("#why").scrollTop = 0`);
await shot("t9-applied");
report.problems = problems;
fs.writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ok: !problems.length, nodes: report.nodes, edges: report.edges, problems }, null, 1));
process.exit(problems.length ? 1 : 0);
