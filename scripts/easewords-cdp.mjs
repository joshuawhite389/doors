// Ease fixes, words (AUDIT-EASE-1 #6 #12 #14), proven in headless Chromium over CDP on a saved Tidewell plan: stop
// rows say why the door (Qloo's crowd), not a rank; Why these doors has three tiles and no 0–1 numbers; the empty Agent
// panel has three starter asks and a one-line notice naming the fallback models, with a Privacy link; the form's two
// optional door fields say what each does. Screenshots every step; prints a JSON report and "problems none".
// L3b (judge pass 8 #2 #4 #5 #6): the door card's and drive mode's Why this door say a reason, not "#5 of 55"; Running
// late names the door that won't fit; the Agent's answer has no affinity decimal (its rank may stay) and its Sources don't repeat it; the
// form's "Doors to skip" says where an account that stays on the route goes, and counts what Why these doors counts.
// Usage: node scripts/easewords-cdp.mjs <base-url> <out-dir> [width] [height] [before]   (before: shots only, no checks)
import { spawn } from "node:child_process";
import fs from "node:fs";
import { demoProfile } from "../public/lib/demo-profile.js";
import { storeKey } from "../public/lib/store.js";
import { isoDate } from "../public/lib/profile.js";
const [base, out, w = "1400", h = "900", mode = ""] = process.argv.slice(2);
const before = mode === "before";
fs.mkdirSync(out, { recursive: true });
const port = 9400 + Math.floor(Math.random() * 400);
const dir = `/tmp/claude-1000/easewords-${port}`;
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
// visible and inside the viewport, not covered at its centre by something else
const onScreen = (sel) => ev(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.getClientRects().length); if (!e) return false; const b = e.getBoundingClientRect(); if (b.width < 8 || b.top < 0 || b.left < 0 || b.bottom > innerHeight || b.right > innerWidth) return false; const t = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return !!t && (e === t || e.contains(t)); })()`);
// one Ask Doors per screen (Jard 2026-10-23): the buttons that read exactly "Ask Doors", laid out and not visibility:hidden
const asks = () => ev(`[...document.querySelectorAll("button")].filter((b) => { if (!["Agent", "Ask Doors"].includes(b.textContent.trim()) || !b.getClientRects().length || getComputedStyle(b).visibility === "hidden") return false; const r = b.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, Math.min(Math.max(r.top + r.height / 2, 1), innerHeight - 1)); return r.bottom < 0 || r.top > innerHeight || (!!t && b.contains(t)); }).length`); // on top where it sits (scrolled-away ones count)
// the page footer's text is not under anything (the floating Ask Doors used to sit on "rankings and listings: Qloo")
const footClear = () => ev(`(() => { const f = document.querySelector(".appfoot"); if (!f) return true; for (const n of f.querySelectorAll("a, span, p")) { for (const r of n.getClientRects()) { if (r.bottom > innerHeight || r.top < 0) continue; for (const x of [r.left + 2, r.left + r.width / 2, r.right - 2]) { const t = document.elementFromPoint(x, r.top + r.height / 2); if (t && !f.contains(t)) return false; } } } return true; })()`);

const today = isoDate(new Date());
const prof = demoProfile(new Date());
prof.windows = [{ date: today, from: "13:00", to: "18:00" }, ...prof.windows.slice(1)];
prof.known = [];
const key = storeKey(prof.brand, prof.city);
const [y, mo, d] = today.split("-").map(Number);
const pinned = new Date(y, mo - 1, d, 12, 55).getTime();
await send("Runtime.enable"); await send("Page.enable");
await send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => {
  const real = Date, off = ${pinned} - real.now();
  class D extends real { constructor(...a) { if (a.length) super(...a); else super(real.now() + off); } static now() { return real.now() + off; } }
  window.Date = D;
  try { if (!localStorage.getItem("__seeded")) { localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify({ v: 1, brand: prof.brand, city: prof.city, profile: prof, plan: null, statuses: {}, outcomes: {}, savedAt: new Date().toISOString() }))}); localStorage.setItem("__seeded", "1"); } } catch {}
  window.SpeechRecognition = undefined; delete window.webkitSpeechRecognition;
})();` });
await send("Emulation.setDeviceMetricsOverride", { width: +w, height: +h, deviceScaleFactor: 1, mobile: +w < 700 });
const q = new URLSearchParams({ brand: prof.brand, city: prof.city });
await send("Page.navigate", { url: `${base}/app#/plan?${q}` });
const report = { width: +w, steps: [] };
const step = async (name, extra = {}) => { await sleep(600); await shot(name); report.steps.push({ name, ...extra }); };
await waitFor(`!!document.querySelector(".stop[data-id]") && !document.querySelector("[data-b2]")`, 60000);
await sleep(2500);
const bad = /Qloo rank|#\d+ of \d+|\b0\.\d\d|affinity|correlation|popularity of/i;

// ---- #6 the plan's rows ----
const rows = await ev(`[...document.querySelectorAll("li.stop:not(.rest) .sb")].map((x) => x.textContent.trim())`);
await step("01-plan-rows", { rows: rows.slice(0, 4) });
check(rows.length > 0 && rows.every((t) => !bad.test(t)), `rows carry no rank or number: ${rows.filter((t) => bad.test(t)).slice(0, 2)}`);
check(rows.filter((t) => /Crowd: /.test(t)).length >= rows.length - 1, `rows say the crowd: ${rows.slice(0, 3)}`);

// ---- #6 Why these doors ----
await click('[data-drawer="why"]');
await waitFor(`!document.querySelector("#why").hidden && !!document.querySelector("#why .w-steps")`);
const why = await ev(`({ tiles: document.querySelectorAll("#why .w-steps li").length, tileText: [...document.querySelectorAll("#why .w-steps li")].map((x) => x.textContent.trim()), facts: [...document.querySelectorAll("#why .w-ft, #why .w-fm")].map((x) => x.textContent.trim()) })`);
await step("02-why", { tiles: why.tileText, first: why.facts.slice(0, 2) });
check(why.tiles === 3, `three tiles (${why.tiles})`);
check(why.facts.every((t) => !/\b0\.\d|affinity|correlation|popularity of/i.test(t)), `Why has no 0–1 numbers: ${why.facts.filter((t) => /\b0\.\d|affinity|correlation/i.test(t)).slice(0, 2)}`);
const whyRanked = Number((why.tileText[0].match(/\d+/) ?? [])[0]);
await click("#why button.w-ft[data-door]");
await waitFor(`!!document.querySelector("#why .w-door")`);
const door = await ev(`document.querySelector("#why .w-door").innerText`);
await step("03-why-door", { head: door.split("\n").slice(0, 3) });
check(!/\b0\.\d|affinity|popularity \d/i.test(door.split("Everything Qloo knows")[0]), "the door's view has no 0–1 numbers");
check(/Everything Qloo knows/.test(door), "the door's view links to Qloo's numbers");
await click('#why [data-w="close"]');
await sleep(500);

// ---- L3b the door card's Why this door row ----
const id1 = await ev(`document.querySelector(".stop[data-id]").dataset.id`);
await ev(`document.querySelector('.stop[data-id="${id1}"] [data-open]').click()`);
await waitFor(`!!document.querySelector('.stopview:not([hidden]) [data-s="why-door"]')`);
await ev(`document.querySelector('.stopview:not([hidden]) [data-s="why-door"]').scrollIntoView({ block: "center" })`);
const whyRow = await ev(`document.querySelector('.stopview:not([hidden]) [data-s="why-door"] small')?.textContent.trim() ?? ""`);
await step("03b-door-why-row", { whyRow });
check(/Qloo/.test(whyRow) && !bad.test(whyRow), `the door's Why row is a reason, not a rank: ${whyRow}`);
await click('.stopview:not([hidden]) [data-s="close"]');
await sleep(600);

// ---- L3b drive mode: Why this door, and Running late names the door ----
await click("[data-drive-start]");
await waitFor(`!!document.querySelector("[data-drive-door]")`, 30000);
await sleep(1200);
const dvWhy = await ev(`document.querySelector(".dv-why small")?.textContent.trim() ?? ""`);
await ev(`document.querySelector(".dv-why")?.scrollIntoView({ block: "center" })`);
await step("03c-drive-why", { dvWhy });
check(/Qloo/.test(dvWhy) && !bad.test(dvWhy), `drive mode's Why is a reason, not a rank: ${dvWhy}`);
await click("[data-drive-latepick]");
await sleep(300);
await click('[data-drive-lateby="60"]');
await waitFor(`!!document.querySelector("[data-drive-late]")`);
await ev(`document.querySelector("[data-drive-late]").scrollIntoView({ block: "center" })`);
const lateLine = await ev(`document.querySelector("[data-drive-late] b").textContent.trim()`);
await step("03d-drive-late", { lateLine });
check(/^Running 60 min late\./.test(lateLine) && !/\b\d+ doors? (doesn't|don't) fit/.test(lateLine), `the late line names the doors: ${lateLine}`);
await click("[data-drive-latepick]");
await sleep(300);
await click('[data-drive-lateby="0"]');
await sleep(300);
await click("[data-drive-close]");
await sleep(800);

// ---- #12 the Agent, empty ----
await ev(`(() => { for (const k of Object.keys(sessionStorage)) if (k.startsWith("doors.v2.chat.")) sessionStorage.removeItem(k); })()`);
await click('.tools [data-agent="open"]');
await waitFor(`!document.querySelector("#agentPanel").hidden`);
await sleep(400);
const ag = await ev(`({ starts: [...document.querySelectorAll("#agentPanel .astart button")].map((b) => b.textContent.trim()), foot: document.querySelector("#agentPanel .afoot").innerText, privacy: !!document.querySelector('#agentPanel .afoot a[href="/privacy"]'), ph: document.querySelector("#agentInput").placeholder, phFits: (() => { const t = document.querySelector("#agentInput"); return t.scrollWidth <= t.clientWidth + 1; })() })`);
await step("04-agent-empty", ag);
check(ag.starts.length === 3 && /^Why is .+ first\?$/.test(ag.starts[0]) && ag.starts[1] === "I'm running late" && /^Log a visit/.test(ag.starts[2]), `three starters: ${ag.starts.join(" | ")}`);
check(/Workers AI/.test(ag.foot) && /Gemini/.test(ag.foot) && ag.privacy, `the notice names the fallback, with Privacy: ${ag.foot}`);
check(!/Answers come from/.test(ag.foot), "one line of fine print");
await click('#agentPanel [data-agent="start"][data-i="2"]');
await sleep(300);
const typed = await ev(`document.querySelector("#agentInput").value`);
await step("05-agent-log-prefill", { typed });
check(/^Log a visit at .+: $/.test(typed), `Log a visit goes into the box: "${typed}"`);
// ---- L3b an answer: no affinity decimal, Sources don't repeat it ----
await ev(`document.querySelector("#agentInput").value = ""`);
const nMsg = await ev(`document.querySelectorAll('#agentPanel .agent-msg[data-role="agent"]').length`);
await click('#agentPanel [data-agent="start"][data-i="0"]');
// the reply bubble shows "…" while the model works (a real Claude turn can take 10-20 s): wait for its words
await waitFor(`(() => { const m = [...document.querySelectorAll('#agentPanel .agent-msg[data-role="agent"]')]; const t = m.at(-1)?.querySelector(".agent-text, p")?.textContent ?? m.at(-1)?.textContent ?? ""; return m.length > ${nMsg} && t.replace(/[\\s…]/g, "").length > 3; })()`, 60000);
await sleep(600);
const ans = await ev(`(() => { const m = [...document.querySelectorAll('#agentPanel .agent-msg[data-role="agent"]')].at(-1); const d = m.querySelector(".agent-facts"); if (d) d.open = true; const src = [...m.querySelectorAll(".agent-facts li")].map((li) => li.textContent.replace(/\\s+/g, " ").trim()); const c = m.cloneNode(true); c.querySelectorAll(".agent-facts, .agent-did, .arest, .asay").forEach((x) => x.remove()); return { reply: c.textContent.replace(/\\s+/g, " ").trim(), src }; })()`);
await step("05b-agent-why-first", ans);
// judge 8: a why-answer keeps Qloo's rank ("#7 of 55 Austin bars"), only the affinity score goes (judge 9 #6)
check(ans.reply.length > 20 && !/affinit|\b0\.\d\d/i.test(ans.reply), `the answer has no affinity decimal: ${ans.reply}`); // gigbot 10-24: live Haiku said "rank 7 of 55 … 0.87"
check(ans.src.every((t) => !/\b0\.\d\d/.test(t)), `Sources have no decimals: ${ans.src.join(" | ")}`);
check(ans.src.every((t) => { const body = t.replace(/\s*(Qloo|route|you|link ↗|Doors)$/, "").trim(); return body.length < 12 || !ans.reply.includes(body); }), `Sources don't repeat the answer: ${ans.src.join(" | ")}`);
await click('#agentPanel [data-agent="close"]');

// ---- #14 the form ----
await send("Page.navigate", { url: `${base}/app#/edit?${q}` });
await waitFor(`!!document.querySelector("#fd-known")`);
await ev(`document.querySelector("#fd-known").open = true`);
await sleep(800);
const form = await ev(`({ pours: document.querySelector('label[for="f-pours"]').textContent.trim(), poursHint: document.querySelector("#fd-pours .hint").textContent.trim(), known: document.querySelector("#fd-known summary").textContent.trim(), knownLabel: document.querySelector('label[for="f-known"]').textContent.trim(), knownHint: document.querySelector("#known-hint").textContent.trim() })`);
await ev(`document.querySelector("#fd-pours").scrollIntoView({ block: "start" })`);
await step("06-form-pours", form);
await ev(`document.querySelector("#fd-known").scrollIntoView({ block: "center" })`);
await step("07-form-known");
check(form.knownLabel === "Doors you already call on" && /^Doors to skip/.test(form.known) && /Doors skips them/.test(form.knownHint) && /\+ Add a door/.test(form.knownHint), `Doors to skip says what it does and where accounts go: ${form.known} / ${form.knownHint}`);
const formRanked = Number((form.knownHint.match(/^Qloo ranked (\d+) places/) ?? [])[1]);
check(formRanked > 0 && formRanked === whyRanked, `one count: the form says ${formRanked}, Why says ${whyRanked}`);
check(/can stay on your route/.test(form.poursHint), "Doors that already pour you says one can stay on the route");

report.problems = problems;
console.log(JSON.stringify(report, null, 1));
console.log(problems.length ? `problems ${problems.length}` : "problems none");
process.exit(0);
