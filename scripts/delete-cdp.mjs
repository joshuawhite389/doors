// Delete (Jard 10-29: "i need a way to delete profiles/ brands/ cities that i've made"), proven in headless Chromium over
// CDP on a SAMPLE server: two brands × two cities; My cities groups them; delete a city (ask, toast, Undo), a brand, the
// plan on screen from Settings (the next plan opens; Undo returns), the brand from Edit my brand (back to the first
// form); a reload keeps each state; the Menu and the landing link to My cities. Screenshots every step; prints a JSON
// report and "problems none".
// Usage: node scripts/delete-cdp.mjs <base-url> <out-dir> [width] [height]
// Usage: node scripts/g3profile-cdp.mjs <base-url> <out-dir> [width] [height] [before]   (before: shots only, no checks)
import { spawn } from "node:child_process";
import fs from "node:fs";
const [base, out, w = "1400", h = "900", mode = ""] = process.argv.slice(2);
const before = mode === "before";
fs.mkdirSync(out, { recursive: true });
const port = 9400 + Math.floor(Math.random() * 400);
const dir = `/tmp/claude-1000/delete-${port}`;
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

const rows = () => ev(`[...document.querySelectorAll("#cities-list .pbrand")].map((g) => g.querySelector("h3")?.textContent + ":" + [...g.querySelectorAll(".prow .popen b")].map((b) => b.textContent).join(","))`);
const plans = () => ev(`Object.keys(localStorage).filter((k) => /^doors\.v2\./.test(k) && !/live|__|draft|chat|places|ticks|talk|enrich/.test(k)).sort()`);
const toast = () => ev(`(() => { const t = document.querySelector(".app-toast"); return t && !t.hidden ? t.textContent.trim() : ""; })()`);
const go = async (hash) => { await ev(`location.hash = ${JSON.stringify(hash)}; true`); await sleep(900); };

await send("Runtime.enable"); await send("Page.enable");
await send("Page.addScriptToEvaluateOnNewDocument", { source: `window.SpeechRecognition = undefined; delete window.webkitSpeechRecognition;` });
await send("Emulation.setDeviceMetricsOverride", { width: +w, height: +h, deviceScaleFactor: 1, mobile: +w < 700 });

// ---- one plan built through the form (Maya's example, Austin), then three more cloned from it ----
await send("Page.navigate", { url: `${base}/privacy` });
await sleep(800);
await ev(`localStorage.clear(); true`);
await send("Page.navigate", { url: `${base}/app#/new` });
await waitFor(`!!document.querySelector("#f-brand")`, 30000);
await ev(`document.querySelector("#examples details").open = true`);
await click(`[data-ex="maya"]`);
await waitFor(`document.querySelector("#f-brand").value === "Tidewell"`);
await click("#build");
await waitFor(`location.hash.startsWith("#/plan") && !!document.querySelector("#t-menu")`, 60000);
await sleep(1500);
const seed = await ev(`(async () => {
  const { START_CHIPS, canOpen } = await import("/lib/profile.js");
  const { cities } = await (await fetch("/data/index.json")).json();
  const k = Object.keys(localStorage).find((x) => /^doors\\.v2\\.tidewell-austin$/.test(x));
  const st = JSON.parse(localStorage.getItem(k));
  const put = (brand, city) => { const ch = START_CHIPS[city][0]; const p = { ...st.profile, brand, city, start: { ...st.profile.start, label: ch.label, lat: ch.lat, lon: ch.lon }, known: [] }; delete p.cityName; if (!canOpen(p, { cities })) throw new Error("seed can't open: " + brand + " " + city); localStorage.setItem("doors.v2." + brand.toLowerCase() + "-" + city, JSON.stringify({ ...st, brand, city, profile: p, plan: null, current: null, savedAt: new Date(Date.now() - 1000 * (brand === "THIS" ? 1 : 60)).toISOString() })); };
  put("Tidewell", "chicago"); put("THIS", "boise"); put("THIS", "omaha");
  return Object.keys(localStorage).filter((x) => /^doors\\.v2\\.(tidewell|this)-/.test(x)).sort();
})()`);
check(seed.length === 4, `four plans: ${seed}`);

// ---- Edit my brand (gigbot 10-29): writes into Tidewell's cities only; THIS's cities stay byte for byte ----
const thisBefore = await ev(`["doors.v2.this-boise", "doors.v2.this-omaha"].map((k) => localStorage.getItem(k))`);
await send("Page.navigate", { url: `${base}/privacy` });
await sleep(600);
await send("Page.navigate", { url: `${base}/app#/brand` }); // a fresh load: no plan to try the change on first
await waitFor(`!!document.querySelector("#f-what")`, 30000);
await sleep(800);
await type("#f-what", "Hazy lager");
await click("#build");
await waitFor(`location.hash === "#/cities"`, 30000);
await sleep(600);
const after = await ev(`({ other: ["doors.v2.this-boise", "doors.v2.this-omaha"].map((k) => localStorage.getItem(k)), mine: ["doors.v2.tidewell-austin", "doors.v2.tidewell-chicago"].map((k) => JSON.parse(localStorage.getItem(k)).profile.what) })`);
check(JSON.stringify(after.other) === JSON.stringify(thisBefore), "THIS's cities untouched by Tidewell's brand edit");
check(after.mine.every((x) => x === "Hazy lager"), `Tidewell's cities take the edit: ${after.mine}`);
report.steps.push({ name: "00-brand-edit-one-brand", mine: after.mine });

// ---- My cities: both brands, each with two cities ----
await go("#/cities");
let r = await rows();
await step("01-my-brands-and-cities", { rows: r });
check(r.length === 2 && r.every((g) => g.split(":")[1].split(",").length === 2), `two brands × two cities: ${r}`);
check((await ev(`document.querySelector("#cities-h").textContent`)) === "My brands and cities", "the title names brands and cities");

// ---- delete a city: asks on the row, then a toast with Undo; Undo puts it back ----
await click(`.pbrand:nth-of-type(1) .prow:nth-child(2) [data-act="del"]`);
const ask = await ev(`document.querySelector(".prow.ask .ptext").textContent`);
await step("02-city-ask", { ask });
check(/^Delete Tidewell in (Austin|Chicago)\? Its plan, visits and notes on this device go too\.$/.test(ask), `city ask: ${ask}`);
await click(`.prow.ask [data-act="yes"]`);
r = await rows();
const t1 = await toast();
await step("03-city-deleted-toast", { rows: r, toast: t1 });
check(r[0].split(":")[1].split(",").length === 1 && (await plans()).length === 3, `one Tidewell city left: ${r}`);
check(/^Deleted Tidewell in \w+\.\s*Undo$/.test(t1), `toast: ${t1}`);
await click(`.app-toast [data-undo]`);
r = await rows();
await step("04-city-undo", { rows: r });
check((await plans()).length === 4 && r[0].split(":")[1].split(",").length === 2, `Undo brings it back: ${r}`);
// delete Chicago for real
await click(`.pbrand:nth-of-type(1) [aria-label="Delete Tidewell in Chicago"]`);
await click(`.prow.ask [data-act="yes"]`);
check(!(await plans()).includes("doors.v2.tidewell-chicago"), "Chicago deleted");

// ---- the plan on screen, deleted from Settings: the next plan opens; Undo returns to it ----
await go("#/plan?brand=Tidewell&city=austin");
await waitFor(`!!document.querySelector("#t-menu")`, 30000);
await sleep(1200);
await click("#t-menu");
const menu = await ev(`[...document.querySelectorAll("#menu .mi b")].map((b) => b.textContent)`);
await step("05-menu", { menu });
check(menu.includes("My cities"), `Menu has My cities: ${menu}`);
await click("#t-settings");
await sleep(500);
await click(`#set-del [data-del="ask"]`);
const sask = await ev(`document.querySelector("#set-del .ptext").textContent`);
await step("06-settings-ask", { ask: sask });
check(sask === "Delete Tidewell in Austin? Its plan, visits and notes on this device go too.", `settings ask: ${sask}`);
await click(`#set-del [data-del="yes"]`);
await waitFor(`/brand=THIS/.test(location.hash) && !!document.querySelector("#t-menu")`, 30000);
await sleep(1500);
const t2 = await toast();
await step("07-switched-to-next", { hash: await ev("location.hash"), toast: t2 });
check(/^Deleted Tidewell in Austin\.\s*Undo$/.test(t2), `toast: ${t2}`);
await click(`.app-toast [data-undo]`);
await waitFor(`/brand=Tidewell/.test(location.hash) && !!document.querySelector("#t-menu")`, 30000);
await sleep(1200);
await step("08-undo-back-to-plan", { hash: await ev("location.hash") });
check((await plans()).includes("doors.v2.tidewell-austin"), "Undo restores Austin");

// ---- a reload keeps the state ----
await send("Page.reload");
await waitFor(`!!document.querySelector("#t-menu")`, 30000);
check((await plans()).length === 3, `after reload: ${await plans()}`);

// ---- delete a brand from My cities ----
await go("#/cities");
await click(`.pbrand:nth-of-type(2) [data-act="bdel"]`);
const bask = await ev(`document.querySelector(".pbhead.ask .ptext").textContent`);
await step("09-brand-ask", { ask: bask });
check(bask === "Delete THIS and its 2 cities? Their plans, visits and notes on this device go too.", `brand ask: ${bask}`);
await click(`.pbhead.ask [data-act="byes"]`);
r = await rows();
const t3 = await toast();
await step("10-brand-deleted", { rows: r, toast: t3 });
check(r.length === 1 && /^Tidewell:/.test(r[0]) && (await plans()).length === 1, `only Tidewell: ${r}`);
check((await ev(`document.querySelector("#cities-h").textContent`)) === "My cities", "one brand: My cities");
check(/^Deleted THIS and its 2 cities\.\s*Undo$/.test(t3), `toast: ${t3}`);

// ---- Edit my brand: Delete this brand → the first form; Undo brings it all back ----
await go("#/brand");
await waitFor(`!!document.querySelector("#f-delete")`);
await click(`#f-delete [data-del="ask"]`);
const eask = await ev(`document.querySelector("#f-delete .ptext").textContent`);
await step("11-edit-brand-ask", { ask: eask });
check(eask === "Delete Tidewell and its 1 city? Their plans, visits and notes on this device go too.", `edit brand ask: ${eask}`);
await click(`#f-delete [data-del="yes"]`);
await waitFor(`location.hash === "#/new" && !!document.querySelector("#f-brand")`);
await sleep(600);
const t4 = await toast();
await step("12-empty-first-form", { hash: await ev("location.hash"), brand: await ev(`document.querySelector("#f-brand").value`), toast: t4 });
check((await plans()).length === 0 && !(await ev(`localStorage.getItem("doors.v2.__brand")`)), "nothing left");
check((await ev(`document.querySelector("#f-brand").value`)) === "", "the first form is blank");
await click(`.app-toast [data-undo]`);
await waitFor(`location.hash.startsWith("#/brand") && !!document.querySelector("#f-delete")`);
check((await plans()).length === 1, "Undo restores Tidewell");
// ---- the landing: an Edit or delete link beside the plan ----
await send("Page.navigate", { url: `${base}/` });
await waitFor(`!!document.querySelector(".saved-plans a[href='/app#/cities']")`, 30000);
const land = await ev(`document.querySelector(".saved-plans").textContent.trim()`);
await ev(`document.querySelector(".saved-plans").scrollIntoView({ block: "center" })`);
await step("13-landing-link", { land });
check(land === "Edit or delete your plan", `landing: ${land}`);
await click(`.saved-plans a[href='/app#/cities']`);
await waitFor(`location.hash === "#/cities" && !!document.querySelector("#cities-list .pbrand")`, 30000);
// for real, then reload
await go("#/brand");
await waitFor(`!!document.querySelector("#f-delete")`);
await click(`#f-delete [data-del="ask"]`);
await click(`#f-delete [data-del="yes"]`);
await waitFor(`location.hash === "#/new"`);
await send("Page.reload");
await waitFor(`!!document.querySelector("#f-brand")`, 30000);
await sleep(600);
check((await ev("location.hash")) === "#/new" && (await plans()).length === 0, "after reload: the first form, nothing saved");
await step("14-after-reload-empty");

console.log(JSON.stringify(report, null, 1));
console.log(problems.length ? `problems:\n${problems.join("\n")}` : "problems none");
process.exit(problems.length ? 1 : 0);
