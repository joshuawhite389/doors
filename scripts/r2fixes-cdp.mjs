// r2 fixes (Jard web review 10-24 round 2), proven in headless Chromium over CDP: the form (product variations, how you
// sell in each city with both allowed, the drinker question, the menu price for one drink, Your city, the Required
// marks and the Still needed button that takes you to the field, 21–24 and 55 and over), the rail running to the right
// edge, the logo opening the plan (never the landing), and the tour's Explore card (hovering a row spotlights its part).
// Usage: node scripts/r2fixes-cdp.mjs <base-url> <out-dir> [width] [height] [before]   (before: shots only, no checks)
import { spawn } from "node:child_process";
import fs from "node:fs";
const [base, out, w = "1400", h = "900", mode = ""] = process.argv.slice(2);
const before = mode === "before";
fs.mkdirSync(out, { recursive: true });
const port = 9400 + Math.floor(Math.random() * 400);
const dir = `/tmp/claude-1000/r2fixes-${port}`;
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

const at = (sel, block = "start") => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; const d = e.closest("details"); if (d) d.open = true; e.scrollIntoView({ block: ${JSON.stringify(block)} }); return true; })()`);
const rectOf = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const r = e.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom) }; })()`);

// ---- 1. the empty form: Required marks, the rail to the right edge ----
await send("Page.navigate", { url: `${base}/privacy` });
await sleep(800);
await ev(`localStorage.clear(); sessionStorage.clear(); true`);
await send("Page.navigate", { url: `${base}/app#/new` });
await waitFor(`!!document.querySelector("#f-brand")`, 30000);
await sleep(1200);
const rail = await rectOf(".pside");
const vw = await ev(`document.documentElement.clientWidth`);
const reqs = await ev(`[...document.querySelectorAll(".req")].filter((x) => x.getClientRects().length).length`);
await step("01-form-top", { rail, vw, reqs });
if (+w > 900) check(rail && vw - rail.r <= 1, `the rail reaches the right edge: ${JSON.stringify(rail)} of ${vw}`);
check(reqs >= 8, `Required marks on the required fields: ${reqs}`);
const logoNew = await ev(`document.querySelector(".appbar .logo")?.getAttribute("href")`);
check(logoNew === "#/demo?instant=1", `nothing saved: the logo opens the demo's plan, not the landing: ${logoNew}`);

// ---- 2. product variations ----
await at("#fd-product");
if (!before) {
  await click(`#formats [data-k="cans"]`);
  await type("#f-size", "12 oz");
  await type("#f-price", "$42 a case of 24");
  await click("#add-variant");
  await click(`[data-v="1"] [data-k="keg"]`);
  await type("#f-size-1", "sixtel");
  await type("#f-price-1", "$165 a sixtel");
  await at("#fd-product");
  const v = await ev(`({ blocks: document.querySelectorAll("#variants .variant").length, p: window.__doorsProfile ?? null, k2: document.querySelector('[data-v="1"] [aria-pressed="true"]')?.dataset.k, size2: document.querySelector("#f-size-1").value })`);
  await step("02-variations", v);
  check(v.blocks === 2 && v.k2 === "keg" && v.size2 === "sixtel", `two variations: ${JSON.stringify(v)}`);
  // a further variation with no format holds Build back and says which
  await click("#add-variant");
  await sleep(300);
  const need3 = await ev(`document.querySelector("#need").textContent`);
  await click(`[data-v="2"] [data-act="remove"]`);
  check((await ev(`document.querySelectorAll("#variants .variant").length`)) === 2, "Remove takes a variation off");
  report.steps.push({ name: "variation-3-blank", need3 });
} else await step("02-product-before");

// ---- 3. drinkers: the ages and the plain question ----
await at("#fd-drinkers");
const ages = await ev(`[...document.querySelectorAll("#f-age option")].map((o) => o.textContent)`);
const basisQ = await ev(`document.querySelector("#l-basis")?.textContent`);
const basisA = await ev(`[...document.querySelectorAll("#basis .tog")].map((b) => b.textContent)`);
const ageHint = await ev(`document.querySelector("#age-hint")?.textContent`);
await step("03-drinkers", { ages, basisQ, basisA, ageHint });
check(ages.join("|") === "Any age|21–24|25–34|35–44|45–54|55 and over", `ages: ${ages}`);
check(basisQ === "Do you know your drinkers, or is this your best guess or research?", `the question: ${basisQ}`);
check(basisA.join("|") === "I know who my drinkers are|It's my best guess, or from research", `the answers: ${basisA}`);

// ---- 4. the pitch: their menu price for one drink ----
await at("#fd-pitch");
const menu = await ev(`document.querySelector('label[for="f-menu"]')?.textContent`);
await step("04-pitch", { menu });
check(menu === "Their menu price for one drink", `menu label: ${menu}`);

// ---- 5. the city: Your city, City, how you sell here (both) ----
await at(".parthead");
const head = await ev(`document.querySelector(".parthead")?.textContent`);
const cityLbl = await ev(`document.querySelector('label[for="f-city"]')?.textContent`);
if (!before) {
  await click(`#sells [data-k="self"]`);
  await click(`#sells [data-k="distributor"]`);
}
const sells = await ev(`[...document.querySelectorAll('#sells [aria-pressed="true"]')].map((b) => b.textContent)`);
const sellsInCity = await ev(`!!document.querySelector('.part[data-part="city"] #sells')`);
await at("#fd-sells", "center");
await step("05-city", { head, cityLbl, sells, sellsInCity });
check(head === "Your city" && /^City/.test(cityLbl), `city heading: ${head} / ${cityLbl}`);
check(sellsInCity && sells.length === 2, `both ways of selling, in the city part: ${sells}`);

// ---- 6. Still needed takes you to the field ----
await ev(`window.scrollTo(0, 0); document.querySelector(".pform")?.scrollTo?.(0, 0); true`);
const needText = await ev(`document.querySelector("#need").textContent`);
const missingN = await ev(`document.querySelectorAll(".missing").length`);
await step("06-need-bar", { needText, missingN });
if (!before) {
  const k = await ev(`document.querySelector(".needgo")?.dataset.k`);
  await click(".needgo");
  await sleep(900);
  const went = await ev(`(() => { const sel = { format: "#fd-product", name: "#fd-name", drinks: "#fd-drinks", rooms: "#fd-rooms", ask: "#fd-ask", city: "#fd-city", start: "#fd-start", windows: "#fd-windows", visitMin: "#fd-windows" }[${JSON.stringify(k)}]; const e = document.querySelector(sel); const r = e.getBoundingClientRect(); return { sel, inView: r.top >= 0 && r.top < innerHeight, focusIn: e.contains(document.activeElement), flash: e.classList.contains("flashreq") }; })()`);
  await step("07-need-jump", { k, ...went });
  check(went.inView && went.focusIn && went.flash, `Still needed went to ${k}: ${JSON.stringify(went)}`);
  check(missingN >= 1, `missing fields are marked: ${missingN}`);
}

// ---- 7. the logo: the demo's finished plan, then the Explore card ----
if (before) await send("Page.navigate", { url: `${base}/app#/demo?instant=1` });
else await click(".appbar .logo");
await waitFor(`location.hash.startsWith("#/demo")`, 10000);
await waitFor(`!!document.querySelector(".ccard:not([hidden]) h3")`, 60000);
await sleep(2500);
const card = await ev(`({ title: document.querySelector(".ccard h3")?.textContent, body: [...document.querySelectorAll(".ccard p")].map((p) => p.textContent), rows: [...document.querySelectorAll(".ccard .cex b")].map((b) => b.textContent), btns: [...document.querySelectorAll(".ccard .cbtns button")].map((b) => b.textContent) })`);
await step("08-explore-card", card);
check(card.title === "Explore on your own", `the end card: ${card.title}`);
check(card.rows.length === 4 && card.rows[0] === "Talk to the Doors Agent" && card.rows[1] === "Market" && /^Open .+ \(Tuesday\)$/.test(card.rows[2]) && card.rows[3] === "Explore Maya's Austin plan", `explore rows: ${card.rows}`);
check(card.btns.join("|") === "Start my profile|Close", `buttons: ${card.btns}`);
const logoDemo = await ev(`document.querySelector(".appbar .logo")?.getAttribute("href")`);
check(logoDemo === "#/demo?instant=1", `the demo's logo stays on the plan: ${logoDemo}`);
if (!before) {
  const SPOT = ['[data-agent="open"]', '[data-drawer="why"]', null, ".rcol"];
  for (let i = 0; i < 4; i++) {
    const r = await rectOf(`.ccard [data-ce="${i}"]`);
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: (r.l + r.r) / 2, y: (r.t + r.b) / 2 });
    await sleep(700);
    const hole = await ev(`(() => { const h = document.querySelector(".chole"); const d = document.querySelector(".cdim"); const r = h.getBoundingClientRect(); return { on: !d.hidden && getComputedStyle(h).opacity === "1", l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom) }; })()`);
    const tgt = SPOT[i] ? await rectOf(SPOT[i]) : await ev(`(() => { const id = document.querySelector('.stop[data-id]') && [...document.querySelectorAll('.stop[data-id]')].find((s) => s.textContent.includes(${JSON.stringify(card.rows[2]?.replace(/^Open | \(Tuesday\)$/g, "") ?? "")}))?.getBoundingClientRect(); return id ? { l: Math.round(id.left), t: Math.round(id.top), r: Math.round(id.right), b: Math.round(id.bottom) } : null; })()`);
    await step(`09-hover-${i}`, { row: card.rows[i], hole, tgt });
    const vis = tgt && tgt.b > 0 && tgt.t < +h && tgt.r > 0 && tgt.l < +w;
    if (vis && +w >= 700) check(hole.on && Math.abs(hole.l - (Math.max(0, tgt.l) - 6)) < 12 && Math.abs(hole.r - (Math.min(+w, tgt.r) + 6)) < 12, `hovering "${card.rows[i]}" spotlights it: hole ${JSON.stringify(hole)} target ${JSON.stringify(tgt)}`);
    else report.steps.push({ name: `09-hover-${i}-offscreen`, note: "target off screen: no spotlight, nothing scrolls" });
  }
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: +h - 5 });
  await sleep(600);
  check(await ev(`document.querySelector(".cdim").hidden`), "leaving the card takes the spotlight off");
  // a row does its thing: Talk to the Doors Agent opens the Agent
  await click(`.ccard [data-ce="0"]`);
  await sleep(1200);
  const agent = await ev(`document.querySelector('[data-agent="open"]')?.getAttribute("aria-expanded")`);
  await step("10-agent-open", { agent });
  check(agent === "true", `Talk to the Doors Agent opens it: ${agent}`);
}

report.problems = problems;
console.log(JSON.stringify(report, null, 1));
console.log(problems.length ? `problems ${problems.length}` : "problems none");
process.exit(0);
