// Group 3 lane B (GROUP3-SPEC #4–5), proven in headless Chromium over CDP: a plan saved before store v2 is cleared on
// open (the live-run cache stays); the form takes the product (format required), the optional drinkers, and the ask
// Doors suggests from the product (taken or written, before Build); one brand, many cities: the menu has no Your
// plans, Settings has Edit my brand and My cities, a second city is added with the brand carried over, a brand edit
// reaches every city, a city is deleted from My cities; the demo still loads. Screenshots every step; prints a JSON
// report and "problems none".
// Usage: node scripts/g3profile-cdp.mjs <base-url> <out-dir> [width] [height] [before]   (before: shots only, no checks)
import { spawn } from "node:child_process";
import fs from "node:fs";
const [base, out, w = "1400", h = "900", mode = ""] = process.argv.slice(2);
const before = mode === "before";
fs.mkdirSync(out, { recursive: true });
const port = 9400 + Math.floor(Math.random() * 400);
const dir = `/tmp/claude-1000/g3profile-${port}`;
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
  await sleep(250);
  const r2 = await ev(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.getClientRects().length); const b = e.getBoundingClientRect(); return {x: b.left + b.width/2, y: b.top + b.height/2}; })()`);
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: r2.x, y: r2.y, button: "left", clickCount: 1 });
  await sleep(200);
};
const type = async (sel, text) => { await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.scrollIntoView({block:"center"}); e.focus(); e.select?.(); })()`); await send("Input.insertText", { text }); await sleep(200); };
const waitFor = async (expr, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(expr)) return true; await sleep(150); } await shot("zz-timeout"); throw new Error(`timed out: ${expr}\n${problems.join("\n")}`); };
const check = (ok, what) => { if (!ok && !before) problems.push(`check failed: ${what}`); };
const report = { width: +w, steps: [] };
const step = async (name, extra = {}) => { await sleep(500); await shot(name); report.steps.push({ name, ...extra }); };
const store = (k) => ev(`JSON.parse(localStorage.getItem(${JSON.stringify(k)}) ?? "null")`);

await send("Runtime.enable"); await send("Page.enable");
await send("Page.addScriptToEvaluateOnNewDocument", { source: `window.SpeechRecognition = undefined; delete window.webkitSpeechRecognition;` });
await send("Emulation.setDeviceMetricsOverride", { width: +w, height: +h, deviceScaleFactor: 1, mobile: +w < 700 });

// ---- an old plan (store v1) and a live-run cache entry, saved before this version ----
await send("Page.navigate", { url: `${base}/privacy` });
await sleep(1200);
const OLD = "doors.v2.oldbrand-austin";
const LIVE = "doors.v2.live.test";
await ev(`localStorage.setItem(${JSON.stringify(OLD)}, JSON.stringify({ v: 1, brand: "Oldbrand", city: "austin", profile: { brand: "Oldbrand", city: "austin" }, plan: null, statuses: {}, outcomes: {}, savedAt: "2026-10-20T10:00:00.000Z" })); localStorage.setItem(${JSON.stringify(LIVE)}, JSON.stringify({ v: 1, rows: [] })); true`);
await send("Page.navigate", { url: `${base}/app` });
await waitFor(`!!document.querySelector("#f-brand")`, 30000);
await sleep(1200);
check(!(await store(OLD)), "the v1 plan is cleared on open");
check(!!(await store(LIVE)), "the live-run cache stays");
check((await ev(`location.hash`)) === "#/new", `a cleared device opens the first form: ${await ev("location.hash")}`);
await step("01-form-top", { hash: await ev("location.hash") });

// ---- the product, the drinkers, the ask (Maya's example fills the form) ----
await ev(`document.querySelector("#examples details").open = true`);
await click(`[data-ex="maya"]`);
await waitFor(`document.querySelector("#f-brand").value === "Tidewell"`);
if (!before) {
  const prod = await ev(`({ pressed: document.querySelector('#formats [aria-pressed="true"]')?.textContent, size: document.querySelector("#f-size").value, abv: document.querySelector("#f-abv").value, na: document.querySelector("#f-na").checked, price: document.querySelector("#f-price").value, sells: document.querySelector('#sells [aria-pressed="true"]')?.textContent, sug: document.querySelector("#ask-sug").textContent.trim(), ask: document.querySelector("#f-ask").value })`);
  await ev(`document.querySelector("#fd-product").scrollIntoView({ block: "start" })`);
  await step("02-product", prod);
  check(prod.pressed === "Cans" && prod.size === "12 oz" && prod.na && prod.price === "$38 a case of 24" && prod.sells === "Self-distributed", `Maya's product fills in: ${JSON.stringify(prod)}`);
  check(/^Using Doors' suggestion: one case of cans in the cooler$/.test(prod.sug), `her ask is Doors' suggestion: ${prod.sug}`);
  await click(`#formats [data-k="keg"]`);
  const keg = await ev(`document.querySelector("#ask-sug").textContent.trim()`);
  await ev(`document.querySelector("#fd-ask").scrollIntoView({ block: "center" })`);
  await step("03-ask-suggest-keg", { keg });
  check(/Doors suggests: one sixtel on a guest tap line\s+Use this instead/.test(keg), `a keg suggests a sixtel: ${keg}`);
  await click("#ask-use");
  check((await ev(`document.querySelector("#f-ask").value`)) === "one sixtel on a guest tap line", "Use this instead takes the suggestion");
  await click(`#formats [data-k="cans"]`);
  await click("#ask-use");
  // the ask is required: cleared, Build is off and the bar says so
  await ev(`(() => { const e = document.querySelector("#f-ask"); e.value = ""; e.dispatchEvent(new Event("input", { bubbles: true })); e.dispatchEvent(new Event("blur")); })()`);
  await sleep(300);
  const off = await ev(`({ disabled: document.querySelector("#build").disabled, err: document.querySelector('[data-err="ask"]').textContent, sug: document.querySelector("#ask-sug").textContent.trim() })`);
  await step("04-ask-required", off);
  check(off.disabled && /suggested ask, or write your own/.test(off.err) && /Use this$/.test(off.sug), `no ask, no Build: ${JSON.stringify(off)}`);
  await type("#f-ask", "two cases of cans for the patio");
  check(!(await ev(`document.querySelector("#build").disabled`)), "a written ask enables Build");
  await click("#ask-use");
  await ev(`document.querySelector("#fd-drinkers").open = true; document.querySelector("#fd-drinkers").scrollIntoView({ block: "start" })`);
  const ages = await ev(`[...document.querySelectorAll("#f-age option")].map((o) => o.textContent)`);
  await step("05-drinkers", { ages });
  check(ages.join("|") === "Any age|21–24|25–34|35–44|45–54|55 and over", `age ranges (r2: 21–24 to 55 and over): ${ages}`);
} else {
  await ev(`document.querySelector("#fd-pitch") && (document.querySelector("#fd-pitch").open = true, document.querySelector("#fd-pitch").scrollIntoView({ block: "center" }))`);
  await step("02-pitch-before");
}
await click("#build");
await waitFor(`location.hash.startsWith("#/plan") && !!document.querySelector(".stop[data-id]") && !document.querySelector("[data-b2]")`, 90000);
await sleep(2500);
await step("06-plan", { hash: await ev("location.hash") });

// ---- the menu and Settings ----
await click("#t-menu");
const menu = await ev(`document.querySelector("#menu").innerText`);
await step("07-menu", { menu });
await click("#t-settings");
const settings = await ev(`document.querySelector("#settings").innerText`);
await step("08-settings", { settings });
if (before) { report.problems = problems; console.log(JSON.stringify(report, null, 1)); console.log("before: shots only"); process.exit(0); }
check(!/Your plans|new profile/i.test(menu), `no Your plans or New profile in the menu: ${menu}`);
check(/Edit my brand/.test(settings) && /My cities/.test(settings), `Settings has Edit my brand and My cities: ${settings}`);

// ---- My cities → Add a city: the brand carries over ----
await click(`#settings a[href="#/cities"]`);
await waitFor(`location.hash === "#/cities" && !!document.querySelector("#cities-list .prow")`);
const list1 = await ev(`[...document.querySelectorAll("#cities-list .prow b")].map((b) => b.textContent)`);
await step("09-cities", { list1 });
check(list1.join() === "Austin", `My cities: Austin: ${list1}`);
await click(`#cities-list .pfoot a`);
await waitFor(`location.hash === "#/city" && !!document.querySelector("#f-city")`);
const add = await ev(`({ h2: document.querySelector(".pform h2").textContent, brandHidden: document.querySelector('[data-part="brand"]').hidden, note: document.querySelector(".editnote")?.textContent, bar: document.querySelector("#appbar .who b").textContent })`);
await step("10-add-city", add);
check(add.h2 === "Add a city" && add.brandHidden && /A new city for Tidewell/.test(add.note), `Add a city shows only the city: ${JSON.stringify(add)}`);
await type("#f-city", "Chicago");
await ev(`document.querySelector("#f-city").blur()`);
await waitFor(`!!document.querySelector("#start-chips button")`);
await click("#start-chips button");
await click(`#days button[aria-pressed="false"]`);
await waitFor(`!document.querySelector("#build").disabled`);
await step("11-add-city-filled");
await click("#build");
await waitFor(`location.hash.includes("city=chicago") && !!document.querySelector(".stop[data-id]") && !document.querySelector("[data-b2]")`, 90000);
await sleep(2000);
const chi = await store("doors.v2.tidewell-chicago");
await step("12-chicago-plan", { ask: chi?.profile?.pitch?.ask, format: chi?.profile?.product?.format });
check(chi?.profile?.product?.format === "cans" && chi.profile.pitch.ask === "one case of cans in the cooler" && chi.profile.brand === "Tidewell", "Chicago's plan carries the brand, product and ask");

// ---- Edit my brand reaches every city ----
await send("Page.navigate", { url: `${base}/app#/brand` });
await waitFor(`!!document.querySelector("#f-abv") && document.querySelector(".pform h2")?.textContent === "Edit my brand"`);
const ed = await ev(`({ cityHidden: document.querySelector('[data-part="city"]').hidden, label: document.querySelector("#build").textContent, cancel: document.querySelector("#f-cancel")?.getAttribute("href") })`);
await step("13-edit-brand", ed);
check(ed.cityHidden && ed.label === "Save my brand" && /#\/plan\?brand=Tidewell&city=chicago/.test(ed.cancel ?? ""), `Edit my brand: brand only, Cancel back to the plan: ${JSON.stringify(ed)}`);
await type("#f-abv", "0.4%");
await click("#build");
await waitFor(`location.hash.startsWith("#/plan")`);
await sleep(1500);
const abvs = [(await store("doors.v2.tidewell-austin"))?.profile?.product?.abv, (await store("doors.v2.tidewell-chicago"))?.profile?.product?.abv, (await store("doors.v2.__brand"))?.profile?.product?.abv];
report.steps.push({ name: "brand-edit-reaches-cities", abvs });
check(abvs.every((x) => x === "0.4%"), `the brand edit reached every city: ${abvs}`);

// ---- delete a city ----
await send("Page.navigate", { url: `${base}/app#/cities` });
await waitFor(`document.querySelectorAll("#cities-list .prow").length === 2`);
await click(`#cities-list .prow:last-child [data-act="del"]`);
await step("14-delete-ask");
await click(`#cities-list [data-act="yes"]`);
const list2 = await ev(`[...document.querySelectorAll("#cities-list .prow b")].map((b) => b.textContent)`);
await step("15-cities-after-delete", { list2 });
check(list2.length === 1, `one city left: ${list2}`);

// ---- the demo still loads ----
await send("Page.navigate", { url: `${base}/app#/demo` });
await waitFor(`!!document.querySelector("#f-brand") || !!document.querySelector(".demo-banner")`, 30000);
await sleep(1500);
await step("16-demo");

report.problems = problems;
console.log(JSON.stringify(report, null, 1));
console.log(problems.length ? `problems ${problems.length}` : "problems none");
process.exit(0);
