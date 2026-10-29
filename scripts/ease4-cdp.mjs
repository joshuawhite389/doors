// Ease audit pass 3, lane E4 (web + shared), in headless Chromium over CDP on a SAMPLE=1 server: (#1) at a phone width
// Menu with a door card open shows the menu on top (the card closes first); (#2) Start my day running late with no day
// to move to carries Skip <door> (+ End my day on today) on the banner, and Skip takes the door off; (#5) Running late
// sits by Navigate and Log visit (above the fold at 1400×900); (#4) Edit profile's Cancel and Save and re-plan are on
// screen at the form's top, the heading clear of the note; (#8) Why's map opens on the plan's doors; (#9) Your list's
// "+ Add to a day"; (#10) words: "All N stops", no "stop n of N" twice on the door card, Why "for people who drink".
// Usage: OUT=<dir> node scripts/ease4-cdp.mjs <base-url> [width] [height]
import { spawn } from "node:child_process";
import fs from "node:fs";
async function browser(w, h, out) {
  fs.mkdirSync(out, { recursive: true });
  const port = 9400 + Math.floor(Math.random() * 400);
  const dir = `/tmp/claude-1000/e4-${port}`;
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
const narrow = +w <= 700;

// Maya's example plan (Tidewell · Austin)
await b.go(`${base}/app#/new`); await sleep(1500);
await until(`!!document.querySelector('[data-ex="maya"]')`);
await ev(`document.querySelector('[data-ex="maya"]').click()`); await sleep(800);
await ev(`document.querySelector("#build").click()`);
await until(`document.querySelectorAll(".stops .stop[data-day]").length > 3`, 60000); await until(`!document.querySelector("[data-b2]")`, 90000); await sleep(1500);
const planUrl = await ev(`location.href`);

// ---- #9 Your list: "+ Add to a day"; a row's day in one form ----
await ev(`[...document.querySelectorAll(".daytabs button")].find((x) => /Your list/.test(x.textContent))?.click()`); await sleep(800);
const list = await ev(`({ add: [...document.querySelectorAll("[data-addopen]")].map((x) => x.textContent.trim()), on: [...document.querySelectorAll(".stop.rest .why")].map((x) => x.textContent.trim()).filter((t) => /^on /.test(t)) })`);
await shot(P + "01-your-list");
check(list.add.length && list.add.every((t) => t === "+ Add to a day"), "Your list: '+ Add to a day'", JSON.stringify(list.add.slice(0, 3)));
check(!list.on.length, "Your list: no 'on Tue · stop 2' beside 'Tue · stop 3'", JSON.stringify(list.on.slice(0, 3)));
await ev(`document.querySelector(".daytabs button")?.click()`); await sleep(600);

// ---- #1 Menu with a door card open ----
const first = await ev(`document.querySelector('.stops .stop[data-day="0"]')?.dataset.id`);
await ev(`document.querySelector('.stops .stop[data-id="${first}"][data-day="0"] .nm').click()`);
await until(`!!document.querySelector('.stopview:not([hidden]) h2')`); await sleep(900);
const kick = await ev(`document.querySelector('.stopview:not([hidden]) .skick')?.textContent.trim() ?? ""`);
check(!/stop \d+ of \d+/i.test(kick), "door card: 'stop n of N' once (the header), not again under it", kick);
await ev(`document.querySelector("#t-menu").click()`); await sleep(700);
const menu = await ev(`(() => { const m = document.querySelector("#menu"); if (m.hidden) return { open: false }; const r = m.getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + Math.min(30, r.height / 2); const hit = document.elementFromPoint(x, y); return { open: true, onTop: !!hit?.closest("#menu"), inView: r.top >= 0 && r.top < innerHeight, card: !document.querySelector(".stopview")?.hidden, hit: hit?.className ?? "" }; })()`);
await shot(P + "02-menu-with-card");
check(menu.open && menu.onTop && menu.inView, "Menu with a door card open: the menu shows, on top, on screen", JSON.stringify(menu));
await ev(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))`); await sleep(400);
if (!narrow) await ev(`document.querySelector('.stopview:not([hidden]) [data-s="close"]')?.click()`);
await sleep(600);

// ---- #8 Why's map opens on the plan's doors ----
await ev(`document.querySelector('[data-drawer="why"]').click()`);
await until(`!!document.querySelector("#why:not([hidden]) .w-head, #why:not([hidden]) h3, #why:not([hidden])")`); await sleep(2500);
const fit = await ev(`(async () => { const S = await import(new URL("/ui/state.js", location.origin).href); const m = S.getMap(); if (!m) return { map: false }; const bb = m.getBounds(); const p = S.getPlan(); const pts = p.days.flatMap((d) => d.stops.map((s) => p.venues[s.id])).filter((v) => Number.isFinite(v?.lat)); const all = p.pool.ids.map((id) => p.venues[id]).filter((v) => Number.isFinite(v?.lat)); const inb = (v) => bb.contains([v.lon, v.lat]); return { map: true, zoom: +m.getZoom().toFixed(2), plan: pts.filter(inb).length + "/" + pts.length, ranked: all.filter(inb).length + "/" + all.length }; })()`);
await shot(P + "03-why-map");
const [pin, pn] = String(fit?.plan ?? "0/1").split("/").map(Number), [ain, an] = String(fit?.ranked ?? "0/1").split("/").map(Number);
check(fit?.map && pin >= pn - 1 && (ain < an || fit.zoom >= 11), "Why's map opens on the plan's doors, not the whole metro", JSON.stringify(fit));
const whyText = await ev(`document.querySelector("#why")?.innerText ?? ""`);
check(!/on Your list for [A-Z][\\w' ]+ drinkers/.test(whyText), "Why: 'for people who drink …', not '… drinkers'", (whyText.match(/on Your list for [^.]*/) ?? [""])[0]);
await ev(`document.querySelector('[data-drawer="why"]').click()`); await sleep(500);
await ev(`document.querySelector('#why:not([hidden]) [data-w="close"], #why:not([hidden]) .w-close')?.click()`); await b.go(planUrl); await sleep(2500);
await until(`document.querySelectorAll(".stops .stop[data-day]").length > 3`, 30000); await sleep(800);

// ---- #5 / #2 Start my day, running late ----
await ev(`document.querySelector("#t-drive, [data-drive-start]").click()`);
await until(`!!document.querySelector("[data-drive-door]")`, 20000); await sleep(1000);
const tabs = await ev(`[...document.querySelectorAll(".dv-tabs button")].map((x) => x.textContent.trim())`);
check(tabs.some((t) => /^All \d+ stops$/.test(t)), "drive: 'All N stops', not 'Day (N)'", JSON.stringify(tabs));
const lp = await ev(`(() => { const r = document.querySelector("[data-drive-latepick]")?.getBoundingClientRect(); return r ? { top: Math.round(r.top), bottom: Math.round(r.bottom), H: innerHeight } : null; })()`);
await shot(P + "04-drive");
check(lp && lp.bottom <= lp.H && lp.top >= 0, "Running late is on screen, by Navigate and Log visit", JSON.stringify(lp));
let banner = null;
for (const by of [30, 60]) {
  await ev(`document.querySelector("[data-drive-latepick]")?.click()`); await sleep(400);
  await ev(`document.querySelector('[data-drive-lateby="${by}"]')?.click()`); await sleep(400);
  await until(`!document.querySelector("[data-drive-late-checking]")`, 20000); await sleep(600);
  banner = await ev(`(() => { const l = document.querySelector("[data-drive-late]"); if (!l) return null; return { text: l.innerText.replace(/\\n+/g, " | "), none: !!l.querySelector("[data-drive-late-none]"), skip: l.querySelector("[data-drive-lateskip]")?.textContent.trim() ?? null, end: !!l.querySelector("[data-drive-end]"), move: !!l.querySelector("[data-drive-push]") }; })()`);
  if (banner?.skip || banner?.none) break;
}
await shot(P + "05-late-banner");
console.log("banner", JSON.stringify(banner));
if (banner && (banner.none || !banner.move)) {
  check(!!banner.skip && /^Skip /.test(banner.skip), "running late, no day has room: 'Skip <door>' on the banner", JSON.stringify(banner));
  check(!/skip (it|them) or end the day early/.test(banner.text), "no 'skip it or end the day early' with nothing to tap", banner.text);
  const out = await ev(`document.querySelector("[data-drive-late] b")?.textContent ?? ""`);
  await ev(`document.querySelector("[data-drive-lateskip]").click()`); await sleep(2500);
  const after = await ev(`({ toast: document.querySelector(".dv-toast:not([hidden])")?.innerText ?? "", late: document.querySelector("[data-drive-late]")?.innerText.replace(/\\n+/g, " | ") ?? "", skip: !!document.querySelector("[data-drive-lateskip]") })`);
  await shot(P + "06-after-skip");
  const gone = (out.match(/late\. (.+?) doesn't fit/) ?? [])[1] ?? "?";
  // gigbot 10-24: Skip is off this day and back on Your list, unlocked: never locked onto the next day, and the day takes
  // no new door from Your list in its place (so no second "Skip <door>")
  const rows = await ev(`(async () => { const S = await import(new URL("/ui/state.js", location.origin).href); const p = S.getPlan(); const id = Object.keys(p.venues).find((k) => p.venues[k].name === ${JSON.stringify(gone)}); return { on: p.days.filter((d) => d.stops.some((s) => s.id === id)).map((d) => d.date), locked: p.days.some((d) => d.stops.some((s) => s.id === id && s.locked)) }; })()`);
  check(/ off (today|this day) and back on Your list\./.test(after.toast) && /Undo/.test(after.toast) && !after.skip && !rows.locked && !rows.on.length, "Skip: off this day, back on Your list, no lock, no new door in its place", JSON.stringify({ gone, ...after, ...rows }));
  await ev(`document.querySelector("[data-drive-undo]")?.click()`); await sleep(2500);
  const back = await ev(`document.querySelector("[data-drive-late]")?.innerText ?? ""`);
  check(back.includes(gone) && !!(await ev(`!!document.querySelector("[data-drive-lateskip]")`)), "Undo puts it back on the day (the late banner offers Skip again)", back.replace(/\n+/g, " | "));
} else check(false, "running late banner with no room: could not reach it in this data", JSON.stringify(banner));
await ev(`document.querySelector("[data-drive-close]")?.click()`); await sleep(800);

// ---- #4 Edit profile: Cancel and Save on screen ----
await ev(`document.querySelector("#t-menu").click()`); await sleep(400);
await ev(`document.querySelector("#t-settings").click()`); await sleep(500);
await ev(`document.querySelector('#settings a[href*="edit"], #settings .xlist a')?.click()`);
await until(`!!document.querySelector("#f-cancel")`, 20000); await sleep(1200);
const ed = await ev(`(() => { const r = (s) => { const x = document.querySelector(s)?.getBoundingClientRect(); return x ? { top: Math.round(x.top), bottom: Math.round(x.bottom) } : null; }; return { H: innerHeight, save: r("#build"), cancel: r("#f-cancel"), h2: r(".pform h2"), note: r(".editnote"), docH: document.documentElement.scrollHeight }; })()`);
await shot(P + "07-edit-top");
check(ed.save && ed.cancel && ed.save.bottom <= ed.H && ed.cancel.bottom <= ed.H && ed.save.top > 0, "Edit profile: Save and re-plan and Cancel on screen at the top of a long form", JSON.stringify(ed));
check(ed.h2 && ed.note && ed.note.top >= ed.h2.bottom, "Edit profile: the heading clear of the note", JSON.stringify({ h2: ed.h2, note: ed.note }));
await ev(`scrollTo(0, document.documentElement.scrollHeight)`); await ev(`document.querySelector(".pform")?.parentElement?.scrollTo?.(0, 1e6)`); await sleep(500);
await shot(P + "08-edit-bottom");
await ev(`document.querySelector("#f-cancel").click()`);
await until(`document.querySelectorAll(".stops .stop[data-day]").length > 3`, 30000);
check(true, "Cancel lands back on the plan");

// ---- #10e offline: a line says so ----
await sleep(800);
await b.send("Network.enable");
await b.send("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }); await sleep(800);
const offl = await ev(`({ on: navigator.onLine, line: document.querySelector("#p-offline:not([hidden])")?.textContent.trim() ?? "" })`);
await shot(P + "09-offline");
check(!offl.on && /^You're offline\./.test(offl.line), "offline: the plan says 'You're offline…'", JSON.stringify(offl));
await b.send("Network.emulateNetworkConditions", { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }); await sleep(800);
check(await ev(`document.querySelector("#p-offline")?.hidden === true`), "back online: the line goes");

console.log(JSON.stringify({ problems: b.problems, failed: b.checks.filter((c) => !c[0]).map((c) => c[1]) }, null, 1));
process.exit(0);
