// Intuitiveness audit pass 1b, lane S (small screens, web), and pass 2's web items (#1 tour banner, #3 Ask for on drive,
// #4 Your list's rank, #6 the Agent button over the sheets), in headless Chromium over CDP on a SAMPLE=1 server: #1 Start
// my day's header, #4 the day tabs, #5 the door sheet, #8 the form's header and examples, #10 tap targets, and the
// smaller items (All days' day header, the start field's placeholder). Run at 320×568, 375×667, 390×844 and 1400×900:
// a phone size checks the fix, 1400 checks nothing there changed.
// Usage: OUT=<dir> node scripts/intuits-cdp.mjs <base-url> [width] [height]
import { spawn } from "node:child_process";
import fs from "node:fs";
async function browser(w, h, out) {
  fs.mkdirSync(out, { recursive: true });
  const port = 9400 + Math.floor(Math.random() * 400);
  const dir = `/tmp/claude-1000/is-${port}`;
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
const P = `${w}x${h}-`;
const W = +w, H = +h;
const narrow = W <= 700;
const small = W <= 420 || H <= 700; // drive.css's compact header
// an element's box, rounded
const box = (sel) => `(() => { const e = typeof ${JSON.stringify(sel)} === "string" ? document.querySelector(${JSON.stringify(sel)}) : null; if (!e) return null; const r = e.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) }; })()`;
// the tap area of el: the points 2 px inside a 44 px square on its centre that still hit it (all 4 corners and the centre)
const HIT = `((el) => { const r = el.getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2; const hw = Math.max(r.width, 44) / 2 - 2, hh = Math.max(r.height, 44) / 2 - 2; const pts = [[cx, cy], [cx - hw, cy - hh], [cx + hw, cy - hh], [cx - hw, cy + hh], [cx + hw, cy + hh]]; return pts.every(([x, y]) => { const t = document.elementFromPoint(x, y); return t === el || el.contains(t); }); })`;

// ---- #8 the form: the brand line, the examples, the start field ----
await b.go(`${base}/app#/new`); await sleep(1500);
await until(`!!document.querySelector("#examples summary")`);
const bar = await ev(`(() => { const who = document.querySelector(".appbar .who"); const els = [".appbar .logo", ".appbar .who", ".appbar .right"].map((s) => document.querySelector(s)).filter((e) => e && e.getBoundingClientRect().width); const rs = els.map((e) => e.getBoundingClientRect()); let over = 0; for (let i = 1; i < rs.length; i++) if (rs[i].left < rs[i - 1].right - 1) over++; return { who: who && who.getBoundingClientRect().width ? Math.round(who.getBoundingClientRect().width) : 0, over, right: Math.round(Math.max(...rs.map((r) => r.right))) }; })()`);
check(W <= 360 ? bar.who === 0 : bar.who >= 100, W <= 360 ? "form at ≤ 360 px: no crushed brand line" : "form: the brand line shows", JSON.stringify(bar));
check(bar.over === 0 && bar.right <= W, "form header: logo, brand line and buttons don't overlap or run off", JSON.stringify(bar));
await ev(`document.querySelector("#examples summary").click()`); await sleep(500);
const ex = await ev(`(() => { const xs = [...document.querySelectorAll("#examples .ex")].map((e) => e.getBoundingClientRect()); return { n: xs.length, first: xs[0] && [Math.round(xs[0].left), Math.round(xs[0].right)], second: xs[1] && [Math.round(xs[1].left), Math.round(xs[1].top)], top0: xs[0] && Math.round(xs[0].top), rows: new Set(xs.map((r) => Math.round(r.top))).size, cols: new Set(xs.map((r) => Math.round(r.left))).size }; })()`);
await shot(P + "01-form-examples");
if (narrow) check(ex.first[0] >= 0 && ex.first[1] <= W && ex.second[0] < W - 8 && ex.second[0] > ex.first[1], "form examples: the first card is whole and the next one peeks", JSON.stringify(ex));
else check(ex.cols === 3, "form examples at a wide screen: three columns, as before", JSON.stringify(ex));
const ph = await ev(`(() => { const i = document.querySelector("#f-addr"); const cs = getComputedStyle(i); const c = document.createElement("canvas").getContext("2d"); c.font = cs.font; const tw = c.measureText(i.placeholder).width; return { ph: i.placeholder, tw: Math.round(tw), room: Math.round(i.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)) }; })()`);
check(ph.tw <= ph.room, "form: the start field's placeholder fits its box", JSON.stringify(ph));
if (!narrow) check(ph.ph === "Street address, or drop a pin on the map", "form at a wide screen: the placeholder's words unchanged", ph.ph);

// Maya's example plan (Tidewell · Austin)
await ev(`document.querySelector('[data-ex="maya"]').click()`); await sleep(800);
const build = await ev(`(() => { const r = document.querySelector("#build").getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom) }; })()`);
check(build.bottom <= H && build.top > 0, "form: Build my plan on screen without scrolling", JSON.stringify(build));
await ev(`document.querySelector("#build").click()`);
await until(`document.querySelectorAll(".stops .stop[data-day]").length > 3`, 60000); await until(`!document.querySelector("[data-b2]")`, 90000); await sleep(2000);
const planUrl = await ev(`location.href`);

// ---- #4 the day tabs: Your list and All days in view ----
const tabs = await ev(`(() => { const t = [...document.querySelectorAll(".daytabs [data-tab]")]; const at = (k) => { const e = t.find((x) => x.dataset.tab === k); const r = e.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top) }; }; const d = document.querySelector(".daytabs"); const days = document.querySelector(".dtdays"); return { rest: at("rest"), week: at("week"), day0: at("0"), rows: new Set(t.map((x) => Math.round(x.getBoundingClientRect().top))).size, over: d.scrollWidth - d.clientWidth, daysScroll: days && getComputedStyle(days).display !== "contents" ? days.scrollWidth - days.clientWidth : null, fade: days?.classList.contains("more-r") ?? false, order: t.map((x) => x.dataset.tab).join(",") }; })()`);
await shot(P + "02-plan");
if (narrow) {
  check(tabs.rest.l >= 0 && tabs.rest.r <= W && tabs.week.l >= 0 && tabs.week.r <= W, "plan at a phone width: Your list and All days are on screen", JSON.stringify(tabs));
  check(tabs.rest.t > tabs.day0.t && tabs.week.t === tabs.rest.t, "plan: Your list and All days on their own row, under the days", JSON.stringify(tabs));
  check(tabs.daysScroll <= 0 || tabs.fade, "plan: the days' row fades at the edge when more days sit past it", JSON.stringify(tabs));
} else if (W > 900) check(tabs.rows === 1 && tabs.over <= 0, "plan at 1400: the day tabs, Your list and All days fit one row (as before)", JSON.stringify(tabs));
check(/^0,1,2,rest,week$/.test(tabs.order), "plan: the tabs keep their order (arrow keys, reading order)", tabs.order);
// the tabs still switch the list
await ev(`document.querySelector('.daytabs [data-tab="rest"]').click()`); await sleep(1500);
check(await ev(`document.querySelector('.daytabs [data-tab="rest"]').getAttribute("aria-selected") === "true"`), "plan: Your list's tab opens Your list");
await shot(P + "03-your-list");
// ---- pass 2 #4: Your list writes the rank "#1" in a tag (the map's style), not the day views' stop-number circle ----
const rk = await ev(`(() => { const p = document.querySelector(".stops .stop.rest .pin"); const cs = getComputedStyle(p); return { text: p.textContent.trim(), radius: cs.borderTopLeftRadius, bg: cs.backgroundColor }; })()`);
check(/^#\d+$/.test(rk.text) && rk.radius !== "50%" && rk.bg === "rgb(255, 255, 255)", "Your list (pass 2 #4): the rank reads '#1' in a white tag, not a filled stop circle", JSON.stringify(rk));

// ---- pass 2 #6: Menu, Settings, Export and Your plans have the screen at a phone width (no Agent button over them) ----
for (const id of ["menu", "settings", "export"]) {
  await ev(`document.querySelector('[data-drawer="${id}"]')?.click()`); await sleep(700);
  const ag = await ev(`(() => { const d = document.querySelector("#${id}"); const a = document.querySelector(".tools .btn.ask"); return { open: !!d && !d.hidden, agent: !!a && !!a.getClientRects().length }; })()`);
  if (id === "menu") await shot(P + "03b-menu");
  check(ag.open && (narrow ? !ag.agent : ag.agent), narrow ? `${id} open at a phone width (pass 2 #6): the Agent button steps aside` : `${id} open at 1400: the Agent button as before`, JSON.stringify(ag));
  await ev(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`); await sleep(400);
  if (await ev(`!document.querySelector("#${id}").hidden`)) { await ev(`document.querySelector('[data-drawer="${id}"]')?.click()`); await sleep(400); }
}
check(await ev(`!!document.querySelector(".tools .btn.ask")?.getClientRects().length`), "sheets closed: the Agent button is back");

// ---- #10 tap targets: ⋯ and Website ↗ in a row ----
await ev(`document.querySelector('.daytabs [data-tab="0"]').click()`); await sleep(1500);
await ev(`window.scrollTo(0, 0); document.querySelector(".stops .stop[data-day] .wlink")?.closest(".stop").scrollIntoView({ block: "center" })`); await sleep(500);
const taps = await ev(`(() => { const row = document.querySelector(".stops .stop[data-day] .wlink")?.closest(".stop"); if (!row) return null; const more = row.querySelector(".more"), web = row.querySelector(".wlink"), nm = row.querySelector(".nm"); const hit = ${HIT}; const nr = nm.getBoundingClientRect(); const top = document.elementFromPoint(nr.left + Math.min(nr.width / 2, 30), nr.top + nr.height / 2); const sz = (e) => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }; return { more: hit(more), web: hit(web), nameStillHits: top === nm || nm.contains(top), moreSize: sz(more), webSize: sz(web) }; })()`);
if (narrow) {
  check(taps && taps.more && taps.web, "plan row at a phone width: ⋯ and Website ↗ take a tap anywhere in a 44 px square", JSON.stringify(taps));
  check(taps && taps.nameStillHits, "plan row: the door's name still takes its own tap", JSON.stringify(taps));
} else check(taps && taps.moreSize.join() === "28,28", "plan row at 1400: ⋯ unchanged (28 px)", JSON.stringify(taps));

// ---- smaller: All days' day header is one line of text that wraps (no ragged columns) ----
await ev(`document.querySelector('.daytabs [data-tab="week"]').click()`); await sleep(1500);
const dh = await ev(`(() => { const btn = document.querySelector(".dayhead button"); const b = btn.querySelector("b"); const r = document.createRange(); r.selectNodeContents(btn); const lines = [...r.getClientRects()].filter((x) => x.width > 2); const tops = [...new Set(lines.map((x) => Math.round(x.top)))]; const left = Math.round(b.getBoundingClientRect().left); const starts = tops.map((t) => Math.round(Math.min(...lines.filter((x) => Math.round(x.top) === t).map((x) => x.left)))); return { text: btn.textContent.trim(), lines: tops.length, starts, left, h: Math.round(btn.getBoundingClientRect().height) }; })()`);
await shot(P + "04-all-days");
check(dh.starts.slice(1).every((x) => x <= dh.left + 2), "All days: the day header wraps as one line of text (no second column)", JSON.stringify(dh));

// ---- #5 the door sheet ----
await ev(`document.querySelector('.daytabs [data-tab="0"]').click()`); await sleep(1500);
await ev(`document.querySelector('.stops .stop[data-day="0"] .nm').click()`);
await until(`!!document.querySelector('.stopview:not([hidden]) h2')`); await sleep(2500);
const sv = await ev(`(() => { const q = (s) => document.querySelector(".stopview " + s); const r = (e) => e ? e.getBoundingClientRect() : null; const sh = r(q(".sscroll")), ft = r(q(".sfoot")), hd = r(q(".shead")); const back = r(q(".sback")), nav = r(q(".snav")), ask = r(q(".sask")); return { full: q(".shead").closest(".stopview").classList.contains("full"), h: Math.round(r(document.querySelector(".stopview")).height), read: Math.round(Math.min(sh.bottom, ft ? ft.top : sh.bottom) - Math.max(sh.top, hd.bottom)), head: Math.round(hd.height), backTop: back && Math.round(back.top + back.height / 2), navTop: nav && Math.round(nav.top + nav.height / 2), askR: ask && ask.width ? Math.round(innerWidth - ask.right) : null, photo: !!q(".shero img") && q(".shero").getBoundingClientRect().height > 0 }; })()`);
await shot(P + "05-door");
if (narrow) {
  check(Math.abs(sv.backTop - sv.navTop) <= 2, "door sheet: '← All stops' and 'Stop 1 of 9 ‹ ›' on one row", JSON.stringify(sv));
  check(sv.askR >= 12, "door sheet: 'Ask about this door' sits clear of the screen's edge", JSON.stringify(sv));
}
if (narrow && H <= 700) {
  check(sv.full && sv.h >= H * 0.9, "door sheet on a short phone screen: opens full height", JSON.stringify(sv));
  check(sv.read >= H * 0.5 && !sv.photo, "door sheet on a short phone screen: at least half the screen to read the door, no photo above it", JSON.stringify(sv));
}
if (narrow && H > 700) check(!sv.full, "door sheet on a tall phone screen: opens at half height, as before", JSON.stringify(sv));
if (narrow) {
  // scrolled: the name joins Ask about this door's row, no third row
  await ev(`(() => { const s = document.querySelector(".stopview .sscroll"); s.scrollTop = 400; s.dispatchEvent(new Event("scroll")); })()`); await sleep(500);
  const sc = await ev(`(() => { const q = (s) => document.querySelector(".stopview " + s); const n = q(".sname"), a = q(".sask"); const nr = n.getBoundingClientRect(), ar = a.getBoundingClientRect(); return { shown: !n.hidden, same: Math.abs((nr.top + nr.height / 2) - (ar.top + ar.height / 2)) <= 3, head: Math.round(q(".shead").getBoundingClientRect().height), name: n.textContent }; })()`);
  await shot(P + "06-door-scrolled");
  check(sc.shown && sc.same, "door sheet scrolled: the door's name shows beside Ask about this door (no third row)", JSON.stringify(sc));
  check(sc.head <= sv.head + 2, "door sheet scrolled: the header grows no taller", JSON.stringify({ before: sv.head, after: sc.head }));
}
await ev(`document.querySelector('.stopview [data-s="close"]')?.click()`); await sleep(1000);

// ---- #1 Start my day ----
await ev(`document.querySelector("#t-drive, [data-drive-start]").click()`);
await until(`!!document.querySelector("[data-drive-door]")`, 20000); await sleep(1200);
const dv = await ev(`(() => { const q = (s) => document.querySelector(s); const r = (e) => e.getBoundingClientRect(); const top = q(".dv-top"), name = q(".dv-name"), op = q(".dv-opener"), acts = q(".dv-acts"); const vis = [...q(".dv-day").children].filter((e) => e.getClientRects().length); const lr = document.createRange(); lr.selectNodeContents(op); const lines = [...new Set([...lr.getClientRects()].map((x) => Math.round(x.top)))]; const actsTop = r(acts).top; const dots = [...document.querySelectorAll(".dv-dots i")]; const x = q("[data-drive-close]"), ask = q("[data-drive-ask]"); return { top: Math.round(r(top).height), sticky: getComputedStyle(top).position, day: vis.map((e) => e.textContent), cut: vis.some((e) => e.scrollWidth > e.clientWidth + 1), dotRows: new Set(dots.map((d) => Math.round(r(d).top))).size, x: [Math.round(r(x).width), Math.round(r(x).height)], ask: [Math.round(r(ask).width), Math.round(r(ask).height)], askOut: r(ask).right > innerWidth || r(ask).left < 0, nameIn: r(name).top >= 0 && r(name).bottom <= actsTop, openerLines: lines.filter((t) => t >= 0 && t + 18 <= actsTop).length }; })()`);
await shot(P + "07-drive");
// pass 2 #3: who to ask for is the first line over the opener, as on the door card
const af = await ev(`(() => { const a = document.querySelector("[data-drive-askfor]"), o = document.querySelector(".dv-opener"); if (!a) return null; const ar = a.getBoundingClientRect(); return { text: a.textContent.trim(), above: ar.bottom <= o.getBoundingClientRect().top, inView: ar.bottom <= innerHeight }; })()`);
check(af && /^Ask for /.test(af.text) && af.above && af.inView, "Start my day (pass 2 #3): 'Ask for …' over the opener on the first screen", JSON.stringify(af));
if (small) {
  check(dv.top <= 140, "Start my day on a small screen: the header is at most 140 px", JSON.stringify(dv));
  check(dv.day.length === 2 && /^Tue Oct 27 · \d+ of \d+ done$/.test(dv.day[0]) && /^Preview: today is \w{3} \w{3} \d+$/.test(dv.day[1]) && !dv.cut, "Start my day, small: one header line ('Tue Oct 27 · 0 of 9 done') and the short preview line, neither cut", JSON.stringify(dv.day));
  check(dv.dotRows === 1, "Start my day, small: the progress dots on one row", dv.dotRows);
  check(dv.x[0] >= 44 && dv.x[1] >= 44 && dv.ask[1] >= 44 && !dv.askOut, "Start my day, small: ✕ and Agent are 44 px and on screen", JSON.stringify({ x: dv.x, ask: dv.ask }));
  check(dv.sticky !== "sticky", "Start my day, small: the header scrolls away with the page", dv.sticky);
  check(dv.nameIn && dv.openerLines >= 2, "Start my day, small: the door's name and at least 2 lines of the opener on the first screen", JSON.stringify({ nameIn: dv.nameIn, openerLines: dv.openerLines }));
} else {
  check(dv.sticky === "sticky" && dv.x[0] === 56 && dv.day[0] === "Tuesday, Oct 27", "Start my day at a big screen: the header as before (sticky, 56 px ✕, the full day)", JSON.stringify(dv));
}
await ev(`document.querySelector("[data-drive-close]")?.click()`); await sleep(600);

// ---- #10 the tour's banner buttons and a card's Close link ----
await b.go("about:blank"); await b.go(`${base}/app#/demo`); await sleep(2500);
await until(`!!document.querySelector('.demo-banner [data-d="skip"]')`);
const ban = await ev(`(() => { const hit = ${HIT}; const bs = [...document.querySelectorAll(".demo-banner button")].filter((e) => !e.hidden && e.getBoundingClientRect().width); return bs.map((e) => [e.textContent.trim(), Math.round(e.getBoundingClientRect().height), hit(e)]); })()`);
await shot(P + "08-tour-banner");
// pass 2 #1: under 420 px the banner is one row (~44 px), and card 1 says the made-up line the banner drops
const bn = await ev(`(() => { const r = document.querySelector(".demo-banner").getBoundingClientRect(); const tops = [...document.querySelectorAll(".demo-banner button, .demo-banner .dtext")].filter((e) => !e.hidden && e.getClientRects().length).map((e) => Math.round(e.getBoundingClientRect().top + e.getBoundingClientRect().height / 2)); const f = [...document.querySelectorAll(".ccard .cfic, .demo-banner .dfic")].filter((e) => e.getClientRects().length).map((e) => e.closest(".ccard") ? "card" : "banner"); return { h: Math.round(r.height), rows: Math.max(...tops) - Math.min(...tops) <= 8 ? 1 : 2, fic: f }; })()`);
if (W <= 420) check(bn.h <= 52 && bn.rows === 1 && bn.fic.join() === "card", "tour banner under 420 px (pass 2 #1): one row, the made-up line on card 1", JSON.stringify(bn));
else check(bn.fic.join() === "banner", "tour banner over 420 px: the made-up line in the banner, as before", JSON.stringify(bn));
if (narrow) check(ban.length && ban.every((x) => x[2]), "tour banner at a phone width: each button takes a tap in a 44 px square", JSON.stringify(ban));
else check(ban.every((x) => x[1] < 44), "tour banner at 1400: the buttons as before", JSON.stringify(ban));
await ev(`document.querySelector('.demo-banner [data-d="skip"]').click()`);
await until(`[...document.querySelectorAll(".ccard .cbtns .lnk")].some((e) => /^Close$/.test(e.textContent.trim()) && e.getBoundingClientRect().width)`, 60000); await sleep(1500);
const endc = await ev(`(() => { const hit = ${HIT}; const l = [...document.querySelectorAll(".ccard .cbtns .lnk")].find((e) => /^Close$/.test(e.textContent.trim())); const c = l.closest(".ccard").getBoundingClientRect(); return { hit: hit(l), size: [Math.round(l.getBoundingClientRect().width), Math.round(l.getBoundingClientRect().height)], card: [Math.round(c.left), Math.round(c.right)] }; })()`);
await shot(P + "09-tour-end");
if (narrow) check(endc.hit, "the tour's End card: Close takes a tap in a 44 px square", JSON.stringify(endc));
check(endc.card[0] >= 0 && endc.card[1] <= W, "the tour's End card sits inside the screen", JSON.stringify(endc));
// opening a door after the End card: on a phone the card steps aside; at 1400 it stays beside the plan, as before
await ev(`document.querySelector('.stops .stop[data-day] .nm').click()`); await sleep(2000);
const endOpen = await ev(`!!document.querySelector(".ccard:not([hidden])")`);
await shot(P + "10-tour-end-door");
check(narrow ? !endOpen : endOpen, narrow ? "after the tour, opening a door puts the End card away (phone)" : "after the tour at 1400, the End card stays as before", String(endOpen));

console.log("problems", JSON.stringify(b.problems));
const bad = b.checks.filter((c) => !c[0]).length;
console.log(`${b.checks.length - bad}/${b.checks.length} checks passed`);
process.exit(bad || b.problems.length ? 1 : 0);
