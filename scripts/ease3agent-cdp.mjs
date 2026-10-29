// Ease audit pass 2, lane E3a (the Agent), in headless Chromium over CDP on a SAMPLE=1 server (no model: Doors' rules
// answer): the tour's chat stays under the tour's prefix and your own Tidewell plan's Agent opens empty; the starters
// name stop 1, then the open door card, the next door once stop 1 is logged, another day's first door; "I'm running
// late" asks how late with Start my day's picks and +30 min opens Start my day 30 min late; typed "15 min late" sets
// +15; the panel is dark over drive mode; the resting note names door cards and Log visit; at ≤900 px the Agent sits in
// a bottom bar and no row is ever under it. Usage: OUT=<dir> node scripts/ease3agent-cdp.mjs <base-url> [width] [height]
import { spawn } from "node:child_process";
import fs from "node:fs";
async function browser(w, h, out) {
  fs.mkdirSync(out, { recursive: true });
  const port = 9400 + Math.floor(Math.random() * 400);
  const dir = `/tmp/claude-1000/e3a-${port}`;
  const ch = spawn("chromium", ["--headless=new", `--remote-debugging-port=${port}`, "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--hide-scrollbars", `--window-size=${w},${h}`, `--user-data-dir=${dir}`, "about:blank"], { stdio: "ignore", detached: true });
  const cleanup = () => { try { process.kill(-ch.pid, "SIGKILL"); } catch {} try { fs.rmSync(dir, { recursive: true, force: true }); } catch {} };
  process.on("exit", cleanup);
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(1));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let ws;
  for (let i = 0; i < 50; i++) { try { const t = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); const p = t.find((x) => x.type === "page"); if (p) { ws = new WebSocket(p.webSocketDebuggerUrl); break; } } catch {} await sleep(200); }
  await new Promise((r) => ws.addEventListener("open", r));
  let id = 0; const pend = new Map(); const problems = [];
  ws.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
    if (m.method === "Runtime.exceptionThrown") problems.push("exception " + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 300)); });
  const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) problems.push("eval: " + (r.exceptionDetails.exception?.description ?? r.exceptionDetails.text).slice(0, 200)); return r.result?.value; };
  const shot = async (name) => { const { data } = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(`${out}/${name}.png`, Buffer.from(data, "base64")); console.log("shot", name); };
  const until = async (expr, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr)) return true; await sleep(200); } problems.push("timed out: " + expr); return false; };
  await send("Runtime.enable"); await send("Page.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: +w, height: +h, deviceScaleFactor: 1, mobile: +w <= 700 });
  const go = async (url) => { await send("Page.navigate", { url }); await sleep(300); };
  const checks = [];
  const check = (ok, what, extra = "") => { checks.push([Boolean(ok), what]); console.log(ok ? "ok  " : "FAIL", what, extra); };
  return { send, ev, shot, until, sleep, go, problems, checks, check, cleanup };
}
const [base, w = "1400", h = "900"] = process.argv.slice(2);
const b = await browser(w, h, process.env.OUT);
const { ev, until, sleep, shot, check } = b;
const P = `${w}-`;
const panelOpen = async () => { if (await ev(`document.querySelector("#agentPanel")?.hidden !== false`)) await ev(`(document.querySelector('.tools [data-agent="open"]') ?? document.querySelector('[data-agent="open"]')).click()`); await until(`document.querySelector("#agentPanel")?.hidden === false`); await sleep(400); };
const panelClose = () => ev(`document.querySelector('#agentPanel [data-agent="close"]')?.click()`);
const starts = () => ev(`[...document.querySelectorAll("#agentPanel .astart button")].map((b) => b.textContent.trim())`);
const nAgent = () => ev(`document.querySelectorAll('#agentLog .agent-msg[data-role="agent"]').length`);
const lastAgent = () => ev(`document.querySelector('#agentLog .agent-msg[data-role="agent"]:last-child')?.innerText ?? ""`);
const askText = async (t) => { const n = await nAgent(); await ev(`(() => { const i = document.querySelector("#agentInput"); i.value = ${JSON.stringify(t)}; document.querySelector('[data-agent="send"]').click(); })()`); await until(`document.querySelectorAll('#agentLog .agent-msg[data-role="agent"]').length > ${n} && document.querySelector("#agentPanel").dataset.state !== "thinking"`, 40000); await sleep(500); };
const rowName = (sel) => ev(`document.querySelector(${JSON.stringify(sel)})?.querySelector("b, .nm, h4, .name")?.textContent.trim() ?? ""`);

// ---- #1 the tour's chat stays the tour's ----
await b.go(`${base}/app?instant=1#/demo`);
await until(`!!window.__demo?.done`, 40000); await sleep(2500);
await ev(`document.querySelector(".ccard [data-cb]:last-child")?.click()`); await sleep(500);
await panelOpen();
await askText("Why is Nomadic Beerworks first?");
const keys = await ev(`Object.keys(sessionStorage).filter((k) => k.includes("chat"))`);
await shot(P + "01-tour-chat");
check(keys.length >= 1 && keys.every((k) => k.startsWith("doors.v2.demo:")), "the tour's chat is kept under the tour's prefix", JSON.stringify(keys));
// leave the tour for your own Maya plan (Tidewell · Austin, the tour's brand and city)
await b.go(`${base}/app#/new`); await sleep(1500);
await until(`!!document.querySelector('[data-ex="maya"]')`);
await ev(`document.querySelector('[data-ex="maya"]').click()`); await sleep(800);
await ev(`document.querySelector("#build").click()`);
await until(`document.querySelectorAll(".stops .stop[data-day]").length > 3`, 60000); await until(`!document.querySelector("[data-b2]")`, 90000); await sleep(1000);
const who = await ev(`document.querySelector(".appbar .who")?.innerText.replace(/\\s+/g, " ") ?? ""`);
await panelOpen();
const mine = await ev(`({ msgs: document.querySelectorAll("#agentLog .agent-msg").length, hello: document.querySelector("#agentLog .aempty")?.textContent ?? "" })`);
await shot(P + "02-own-plan-agent");
check(/Tidewell/.test(who) && mine.msgs === 0 && /how can I help/.test(mine.hello), "your own Tidewell plan's Agent opens empty (no tour chat)", `${who} ${JSON.stringify(mine)}`);

// ---- #2 the starters ----
const day0 = await ev(`[...document.querySelectorAll('.stops .stop[data-day="0"]')].map((li) => li.dataset.id)`);
const names = await ev(`Object.fromEntries([...document.querySelectorAll('.stops .stop[data-day]')].map((li) => [li.dataset.id, li.querySelector(".nm")?.childNodes[0]?.textContent.trim()]))`);
let s = await starts();
check(s[0] === `Why is ${names[day0[0]]} first?` && s[2] === `Log a visit at ${names[day0[0]]}:`, "starters name stop 1 while nothing is logged", s.join(" | "));
await panelClose(); await sleep(300);
// log stop 1 through the door card
await ev(`document.querySelector('.stops .stop[data-id="${day0[0]}"][data-day="0"] .nm').click()`);
await until(`!!document.querySelector('.stopview:not([hidden]) [data-s="visit"]')`);
await ev(`document.querySelector('.stopview:not([hidden]) [data-s="visit"]').click()`); await sleep(500);
await ev(`[...document.querySelectorAll('.stopview:not([hidden]) button')].find((x) => /^Interested$/.test(x.textContent.trim()))?.click()`); await sleep(800);
const logged = await ev(`!!document.querySelector('.stopview:not([hidden]) [data-s="next-door"]') || /Interested/.test(document.querySelector('.stopview:not([hidden])')?.innerText ?? "")`);
check(logged, "stop 1 logged Interested");
// with a door card open: that door (open a third stop's card)
await ev(`document.querySelector('.stopview:not([hidden]) [data-s="close"]')?.click()`); await sleep(600);
await ev(`document.querySelector('.stops .stop[data-id="${day0[2]}"][data-day="0"] .nm').click()`);
await until(`!!document.querySelector('.stopview:not([hidden])')`); await sleep(600);
if (+w <= 700) await ev(`document.querySelector('.stopview:not([hidden]) [data-s="ask"]').click()`); else await panelOpen();
await until(`document.querySelector("#agentPanel")?.hidden === false`); await sleep(400);
s = await starts();
await shot(P + "03-starters-open-card");
check(s[0] === `Why ${names[day0[2]]}?` && s[2] === `Log a visit at ${names[day0[2]]}:`, "with a door card open, the starters name that door", s.join(" | "));
await panelClose(); await sleep(300);
await ev(`document.querySelector('.stopview:not([hidden]) [data-s="close"]')?.click()`); await sleep(600);
await panelOpen();
s = await starts();
check(s[0] === `Why ${names[day0[1]]}?` && s[2] === `Log a visit at ${names[day0[1]]}:`, "stop 1 logged: the starters name the next door, not 'first'", s.join(" | "));
await panelClose(); await sleep(300);
// another day's tab
await ev(`[...document.querySelectorAll(".daytabs [data-tab]")].find((t) => /Wed/.test(t.textContent))?.click()`); await sleep(1200);
Object.assign(names, await ev(`Object.fromEntries([...document.querySelectorAll('.stops .stop[data-day]')].map((li) => [li.dataset.id, li.querySelector(".nm")?.childNodes[0]?.textContent.trim()]))`));
const wed = await ev(`[...document.querySelectorAll('.stops .stop[data-day="1"]')].map((li) => li.dataset.id)[0] ?? null`);
await panelOpen();
s = await starts();
await shot(P + "04-starters-wed");
check(wed && s[0] === `Why is ${names[wed]} first?`, "Wednesday's tab: its first door", s.join(" | "));

// ---- #3 I'm running late (Doors' rules answer: SAMPLE, no model) ----
await ev(`document.querySelector('#agentPanel [data-agent="start"][data-i="1"]').click()`);
await until(`document.querySelectorAll('#agentLog .agent-msg[data-role="agent"]').length >= 1 && document.querySelector("#agentPanel").dataset.state !== "thinking"`, 40000); await sleep(600);
const late = await ev(`({ text: document.querySelector('#agentLog .agent-msg[data-role="agent"]:last-child').innerText, picks: [...document.querySelectorAll('#agentLog [data-agent="late"]')].map((b) => b.textContent.trim()) })`);
await shot(P + "05-running-late-rules");
check(/How late will you be\?/.test(late.text) && late.picks.join("|") === "+15 min|+30 min|+1 hour", "'I'm running late' (rules): how late, with Start my day's picks", JSON.stringify(late));
check(!/I can help with|Here's what I can do|I can:/i.test(late.text), "not the capability list", late.text.replace(/\n/g, " / "));
await ev(`[...document.querySelectorAll('#agentLog [data-agent="late"]')].find((b) => b.textContent.trim() === "+30 min").click()`);
await until(`!!document.querySelector("[data-drive-door]")`, 20000); await sleep(1200);
const dv = await ev(`({ panel: document.querySelector("#agentPanel").hidden, ctl: document.querySelector("[data-drive-latectl]")?.innerText.trim() ?? "", line: document.querySelector("[data-drive-late] b")?.textContent.trim() ?? "" })`);
await shot(P + "06-drive-30-late");
check(dv.panel && /Running late · \+30 min/.test(dv.ctl), "+30 min opens Start my day 30 min late", JSON.stringify(dv));

// ---- pass-1 #12: the Agent in drive mode is dark, and names the drive's door ----
const cur = await ev(`document.querySelector("[data-drive-door]")?.dataset.id ?? null`);
await ev(`document.querySelector(".dv-askfab, [data-drive-ask]")?.click()`);
await until(`document.querySelector("#agentPanel")?.hidden === false`); await sleep(500);
const dark = await ev(`(() => { const c = getComputedStyle(document.querySelector("#agentPanel")).backgroundColor.match(/\\d+/g).map(Number); return { bg: c, lum: (c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11), ink: getComputedStyle(document.querySelector("#agentPanel")).color }; })()`);
await shot(P + "07-drive-agent-dark");
check(dark.lum < 60, "the Agent panel is dark over drive mode", JSON.stringify(dark));
await panelClose(); await sleep(300);
// a time typed: "running 15 min late" from drive's Agent sets +15
await ev(`document.querySelector(".dv-askfab, [data-drive-ask]")?.click()`); await until(`document.querySelector("#agentPanel")?.hidden === false`);
await askText("I'm running 15 min late");
await sleep(800);
const dv2 = await ev(`({ panel: document.querySelector("#agentPanel").hidden, ctl: document.querySelector("[data-drive-latectl]")?.innerText.trim() ?? "" })`);
await shot(P + "08-drive-typed-15");
check(dv2.panel && /\+15 min/.test(dv2.ctl), "typed 'running 15 min late' sets Start my day +15 min", JSON.stringify(dv2));
await ev(`document.querySelector("[data-drive-close]")?.click()`); await sleep(800);

// the resting note under a rules answer names today's screens
await panelOpen();
await askText("tell me a joke");
const rest = await ev(`[...document.querySelectorAll("#agentLog .arest")].map((x) => x.textContent).join(" | ")`);
await shot(P + "08b-resting-note");
check(/door cards and Log visit/.test(rest) && !/stop panel/.test(rest), "the resting note: 'Your plan, door cards and Log visit still work.'", rest);
await panelClose(); await sleep(300);

// ---- web 390: no row under the Agent button ----
if (+w <= 900) {
  const over = await ev(`(async () => { const btn = document.querySelector('.tools [data-agent="open"]'); const hits = []; let r0; const H = innerHeight; for (let y = 0; y < document.documentElement.scrollHeight; y += 60) { scrollTo(0, y); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); const r = (r0 = btn.getBoundingClientRect()); const bar = { top: H - parseFloat(getComputedStyle(document.querySelector(".app")).paddingBottom) }; for (const li of document.querySelectorAll(".stops .stop")) { const q = li.getBoundingClientRect(); const vis = Math.min(q.bottom, bar.top) - Math.max(q.top, 0); if (q.bottom > r.top && q.top < r.bottom && q.right > r.left && q.left < r.right) { const el = document.elementFromPoint(Math.min(q.right - 4, r.right - 2), Math.max(r.top + 2, q.top + 2)); if (el && li.contains(el)) hits.push(y); } } } const top = document.elementFromPoint(r0.left + r0.width / 2, r0.top + r0.height / 2); scrollTo(0, 0); return { onTop: btn.contains(top), hits, btn: btn.getBoundingClientRect().toJSON(), bar: getComputedStyle(document.querySelector(".app"), "::after").height }; })()`);
  check(over.onTop, "the Agent button is on top and tappable at the screen's bottom", JSON.stringify(over.btn));
  check(over.hits.length === 0, "no row is ever visible under the Agent button (scrolled top to bottom)", JSON.stringify(over).slice(0, 300));
  await ev(`(() => { const li = [...document.querySelectorAll(".stops .stop")][3]; scrollTo(0, li.getBoundingClientRect().top + scrollY - innerHeight + 140); })()`); await sleep(500);
  await shot(P + "09-bar-over-list");
}
console.log(JSON.stringify({ problems: b.problems, failed: b.checks.filter((c) => !c[0]).map((c) => c[1]) }, null, 1));
process.exit(0);
