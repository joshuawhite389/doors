// Intuitiveness audit pass 1, lane L (layout), in headless Chromium over CDP on a SAMPLE=1 server: #3 sister doors as one
// row + their page, #6 Your list tags, #7 door card map at 1400, #8 Your plans / Why → Settings / landing N more, #10 the
// new form bar; small: day tabs on one row, the plan opens on the first day, Navigate on one line when running late.
// Usage: OUT=<dir> node scripts/intuitl-cdp.mjs <base-url> [width] [height]
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
const S = `(await import(new URL("/ui/state.js", location.origin).href))`;

// ---- #10 the new form: Build pinned, "Still needed" names one field ----
await b.go(`${base}/app#/new?blank=1`); await sleep(1500);
await until(`!!document.querySelector("#build")`);
const form = await ev(`(() => { const r = document.querySelector(".build").getBoundingClientRect(); const f = document.querySelector(".pform").getBoundingClientRect(); const s = document.querySelector(".pside").getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), H: innerHeight, need: document.querySelector("#need").textContent, left: Math.round(f.left), right: Math.round(innerWidth - s.right) }; })()`);
await shot(P + "01-form-new");
check(form.bottom <= form.H && form.top > form.H / 2, "new form: Build my plan pinned at the bottom of the screen", JSON.stringify(form));
check(/^Still needed: [^,]+( \(and \d+ more\))?\.$/.test(form.need), "new form: 'Still needed' names the first missing field", form.need);
if (!narrow) check(Math.abs(form.left - form.right) < 40, "new form at 1400: form + rail centred together", JSON.stringify(form));

// Maya's example plan (Tidewell · Austin)
await b.go(`${base}/app#/new`); await sleep(1500);
await until(`!!document.querySelector('[data-ex="maya"]')`);
await ev(`document.querySelector('[data-ex="maya"]').click()`); await sleep(800);
await ev(`document.querySelector("#build").click()`);
await until(`document.querySelectorAll(".stops .stop[data-day]").length > 3`, 60000); await until(`!document.querySelector("[data-b2]")`, 90000); await sleep(2000);
const planUrl = await ev(`location.href`);

// ---- small: the day tabs on one row; the plan opens on the first day ----
const tabs = await ev(`(() => { const t = [...document.querySelectorAll(".daytabs [data-tab]")]; return { rows: new Set(t.map((x) => Math.round(x.getBoundingClientRect().top))).size, sel: document.querySelector('.daytabs [aria-selected="true"]')?.dataset.tab, labels: t.map((x) => x.textContent.trim()), over: (() => { const d = document.querySelector(".daytabs"); return d.scrollWidth - d.clientWidth; })() }; })()`);
await shot(P + "02-plan");
check(narrow || (tabs.rows === 1 && tabs.over <= 0), "plan at 1400: the day tabs, Your list and All days fit one row", JSON.stringify(tabs));
check(tabs.sel === "0", "plan: opens on the first day", tabs.sel);

// ---- #6 Your list map: tags that would collide are dots ----
await ev(`document.querySelector('.daytabs [data-tab="rest"]').click()`); await sleep(2500);
const tags = await ev(`(() => { const box = (e) => e.getBoundingClientRect(); const hit = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1; const all = [...document.querySelectorAll(".mrank")]; const shown = all.filter((e) => !e.classList.contains("dot")).map(box); const pins = [...document.querySelectorAll(".mpin, .mstart")].map(box).filter((r) => r.width); let n = 0; for (let i = 0; i < shown.length; i++) { for (let j = i + 1; j < shown.length; j++) if (hit(shown[i], shown[j])) n++; for (const p of pins) if (hit(shown[i], p)) n++; } return { all: all.length, dots: all.length - shown.length, overlaps: n }; })()`);
await shot(P + "03-your-list");
check(tags.all > 0 && tags.overlaps === 0, "Your list map: no number tag overlaps another or a day pin", JSON.stringify(tags));
await ev(`[...document.querySelectorAll(".mrank")].find((x) => x.classList.contains("dot"))?.click()`); await sleep(1200);
const card = await ev(`document.querySelector(".rpop .rk, #p-card:not([hidden]) .rk")?.textContent.trim() ?? ""`);
await shot(P + "03b-dot-card");
check(/^#\d+ of \d+ on Your list/.test(card), "Your list: tapping a dot shows its full rank", card);
await ev(`document.querySelector(".rpop .maplibregl-popup-close-button, #p-card [data-card-close]")?.click()`); await sleep(300);
await ev(`document.querySelector('.daytabs [data-tab="0"]').click()`); await sleep(1500);

// ---- #3 + #7 the door card: one sister row, its page; the map frames the neighbours ----
const mid = await ev(`(() => { const r = [...document.querySelectorAll('.stops .stop[data-day="0"]')]; return r[1]?.dataset.id; })()`);
await ev(`document.querySelector('.stops .stop[data-id="${mid}"][data-day="0"] .nm').click()`);
await until(`!!document.querySelector('.stopview:not([hidden]) h2')`); await sleep(2500);
const door = await ev(`(async () => { const s = ${S}; const m = s.getMap(); const p = s.getPlan(); const d = p.days[0]; const k = d.stops.findIndex((x) => x.id === ${JSON.stringify(mid)}); const nb = [d.stops[k - 1], d.stops[k + 1]].filter(Boolean).map((x) => p.venues[x.id]); const bb = m.getBounds(); const row = [...document.querySelectorAll(".stopview .drow")].find((x) => /Sister doors/.test(x.textContent)); return { zoom: +m.getZoom().toFixed(2), pitch: m.getPitch(), inView: nb.filter((v) => bb.contains([v.lon, v.lat])).length + "/" + nb.length, row: row?.querySelector("small")?.textContent ?? null, carousel: !!document.querySelector(".stopview .sbody > .dsis") }; })()`);
await shot(P + "04-door");
check(door.row && /^(\d+ on your route|None on your route) · All \d+$/.test(door.row) && !door.carousel, "door card: sister doors are one row", JSON.stringify(door));
if (!narrow) check(door.zoom <= 14.6 && door.inView.split("/")[0] === door.inView.split("/")[1], "door card map at 1400: the stop before and after are in view, not street level", JSON.stringify(door));
await ev(`[...document.querySelectorAll(".stopview .drow")].find((x) => /Sister doors/.test(x.textContent)).click()`); await sleep(800);
const sis = await ev(`({ title: document.querySelector(".stopview .pgh h3")?.textContent, n: document.querySelectorAll(".stopview .dsis li").length, text: document.querySelector(".stopview .dsis")?.innerText ?? "", order: [...document.querySelectorAll(".stopview .dsis li")].map((li) => li.querySelector('[data-s="open-sister"]') ? 0 : li.querySelector('[data-s="add-sister"]') ? 1 : 2) })`);
await shot(P + "05-sisters");
check(sis.title === "Sister doors" && sis.n > 0, "sister page opens from the row", JSON.stringify({ title: sis.title, n: sis.n }));
check(!/popularity cap|with the popularity|outside your door types/.test(sis.text), "sister reasons in plain words", sis.text.split("\n").slice(0, 8).join(" | "));
check(sis.order.every((x, i) => !i || sis.order[i - 1] <= x), "sister page: on your route first, then the ones you can add", JSON.stringify(sis.order));
await ev(`document.querySelector('.stopview [data-s="pg-back"]').click()`); await sleep(400);
await ev(`document.querySelector('.stopview [data-s="close"]')?.click()`); await sleep(1000);

// ---- #8 Menu: Your plans; Why: one link to Settings ----
await ev(`document.querySelector("#t-menu").click()`); await sleep(500);
const mn = await ev(`[...document.querySelectorAll("#menu .mi b")].map((x) => x.textContent)`);
await shot(P + "06-menu");
check(mn.includes("Your plans") && mn[0] === "Home", "menu: Home, then Your plans", JSON.stringify(mn));
await ev(`document.querySelector('#menu [data-drawer="plans"]').click()`); await sleep(600);
const pl = await ev(`({ open: !document.querySelector("#plans").hidden, rows: document.querySelectorAll("#plans .prow").length, cur: !!document.querySelector("#plans .prow.cur") })`);
await shot(P + "07-your-plans");
check(pl.open && pl.rows >= 1 && pl.cur, "Your plans lists the saved plans, this one marked", JSON.stringify(pl));
await ev(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))`); await ev(`document.querySelector('[data-drawer="plans"][aria-expanded="true"]')?.click()`); await sleep(400);
await ev(`document.querySelector('[data-drawer="why"]').click()`); await sleep(2500);
// concept A (why2 75c3c7f): Why opens on its tiles; the Settings link lives in the "Who likes <brand>?" view
await ev(`document.querySelector('#why [data-view="who"]')?.click()`); await sleep(1200);
const why = await ev(`({ heads: [...document.querySelectorAll("#why .w-grp h4")].map((x) => x.textContent), link: document.querySelector("#why [data-w-settings]")?.textContent ?? null })`);
await ev(`document.querySelector("#why [data-w-settings]")?.scrollIntoView()`); await sleep(300);
await shot(P + "08-why-end");
check(!why.heads.includes("Your settings") && why.link === "Change door types or days in Settings ›", "Why: no second Settings; one link to Settings", JSON.stringify(why));
await ev(`document.querySelector("#why [data-w-settings]")?.click()`); await sleep(600);
check(await ev(`!document.querySelector("#settings").hidden`), "the link opens Settings");
await b.go(planUrl); await sleep(2500);
await until(`document.querySelectorAll(".stops .stop[data-day]").length > 3`, 30000); await sleep(800);

// ---- small: drive, running late: Navigate on one line ----
await ev(`document.querySelector("#t-drive, [data-drive-start]").click()`);
await until(`!!document.querySelector("[data-drive-door]")`, 20000); await sleep(1000);
await ev(`document.querySelector("[data-drive-latepick]")?.click()`); await sleep(400);
await ev(`document.querySelector('[data-drive-lateby="30"]')?.click()`); await sleep(400);
await until(`!document.querySelector("[data-drive-late-checking]")`, 20000); await sleep(800);
const nav = await ev(`(() => { const a = document.querySelector("[data-drive-nav]"); if (!a) return null; const lines = (el) => { const r = document.createRange(); r.selectNodeContents(el); return new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size; }; return { text: a.textContent.trim(), lines: Math.max(...[...a.children].map(lines)), late: document.querySelector("[data-drive-latepick]")?.textContent.trim() }; })()`);
await ev(`document.querySelector("[data-drive-nav]")?.scrollIntoView({ block: "center" })`); await sleep(300);
await shot(P + "09-drive-late");
check(nav && nav.lines === 1, "drive, running late: 'Navigate' and its distance each on one line (no break mid-phrase)", JSON.stringify(nav));
await ev(`document.querySelector("[data-drive-close]")?.click()`); await sleep(500);

// ---- #8 landing: 'N more' lists the rest in place ----
await ev(`(() => { const k = Object.keys(localStorage).find((x) => /^doors\\.v2\\./.test(x) && /Tidewell/i.test(x)); if (!k) return; const v = localStorage.getItem(k); for (const c of ["A", "B", "C", "D"]) localStorage.setItem(k.replace(/Tidewell/i, "Tidewell" + c), v.replace(/"brand":"Tidewell"/, '"brand":"Tidewell' + c + '"')); })()`);
await b.go(`${base}/`); await sleep(3000);
const land = await ev(`({ more: document.querySelector(".saved-plans [data-more]")?.textContent ?? null, links: document.querySelectorAll(".saved-plans a").length, href: [...document.querySelectorAll(".saved-plans a")].map((a) => a.getAttribute("href")) })`);
await ev(`document.querySelector(".saved-plans [data-more]")?.click()`); await sleep(400);
const land2 = await ev(`({ more: !!document.querySelector(".saved-plans [data-more]"), links: document.querySelectorAll(".saved-plans a").length, blank: [...document.querySelectorAll(".saved-plans a")].some((a) => /#\\/new/.test(a.getAttribute("href"))) })`);
await shot(P + "10-landing-plans");
check(land.more && land2.links > land.links && !land2.more && !land2.blank, "landing: 'N more' lists the rest, no blank form", JSON.stringify({ land, land2 }));

console.log("problems", JSON.stringify(b.problems));
const bad = b.checks.filter((c) => !c[0]).length;
console.log(`${b.checks.length - bad}/${b.checks.length} checks passed`);
process.exit(bad || b.problems.length ? 1 : 0);
