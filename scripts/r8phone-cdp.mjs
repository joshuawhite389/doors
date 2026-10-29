// Round 8 lane phone (Jard 10-28, his iPhone on the web app at :8793): at a narrow width the plan's buttons (Start my
// day, Market, My doors, Menu) sit ABOVE the map under the app's header, Menu is its icon alone at a phone width, and
// the Agent is a round button floating over the app (no bar of its own at the screen's bottom; the list's end still
// scrolls clear of it). Item 4 (every width): from one open screen, ONE tap on another button of the row goes straight
// to that screen, and Back returns to the plan. Item 5 (wide): My doors takes the whole page, no map beside it.
// Measured in headless Chromium over CDP. Seeds Maya's demo profile (Austin; the route replays from data/kv-dev, no
// Qloo call, NO_MODEL: the rules answer).
// Usage: node scripts/r8phone-cdp.mjs <base-url> <out-dir> [width] [height] [plan|demo] [strict|measure]
import { spawn } from "node:child_process";
import fs from "node:fs";
import { demoProfile } from "../public/lib/demo-profile.js";
import { storeKey, STORE_VERSION, BRAND_KEY } from "../public/lib/store.js";
const [base, out, w = "390", h = "844", modeArg = "plan", strictArg = "strict"] = process.argv.slice(2);
const strict = strictArg !== "measure";
const demo = modeArg === "demo";
fs.mkdirSync(out, { recursive: true });
const port = 9800 + Math.floor(Math.random() * 150);
const dir = `/tmp/claude-1000/r8phone-${port}`;
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
const send = (method, params = {}) => new Promise((r, j) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); setTimeout(() => { if (pend.has(i)) { pend.delete(i); j(new Error(`CDP ${method} hung`)); } }, 60000); });
const log = (s) => process.stderr.write(`· ${s}\n`);
const ev = async (expr) => { const r = await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result?.value; };
const shot = async (name) => { log(`shot ${name}`); const { data } = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(`${out}/${name}.png`, Buffer.from(data, "base64")); };
const centre = (sel) => ev(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.getClientRects().length); if (!e) return null; const b = e.getBoundingClientRect(); return {x: b.left + b.width/2, y: b.top + b.height/2}; })()`);
const mouse = async (type, x, y) => send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", clickCount: 1 });
const click = async (sel, { scroll = true } = {}) => {
  if (scroll) await ev(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.getClientRects().length); e?.scrollIntoView({block:"center"}); })()`);
  await sleep(120);
  const r = await centre(sel);
  if (!r) throw new Error(`no visible ${sel}`);
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await mouse(type, r.x, r.y);
};
const waitFor = async (expr, ms = 20000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await ev(expr)) return true; await sleep(150); } await shot("zz-timeout"); throw new Error(`timed out: ${expr}\n${problems.join("\n")}`); };
const check = (ok, what) => { if (!ok) problems.push(`check failed: ${what}`); };
const must = (ok, what) => { if (strict) check(ok, what); };
const rect = (sel) => ev(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.getClientRects().length); if (!e) return null; const b = e.getBoundingClientRect(); return { l: +b.left.toFixed(1), t: +b.top.toFixed(1), r: +b.right.toFixed(1), b: +b.bottom.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) }; })()`);
const visible = (sel) => ev(`(() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find((x) => x.getClientRects().length); if (!e) return false; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; })()`);
// what a finger at (x, y) would hit: the selector's element (or something inside it)
const hits = (sel, x, y) => ev(`(() => { const e = document.elementFromPoint(${x}, ${y}); return !!e && !!e.closest(${JSON.stringify(sel)}); })()`);

const prof = demoProfile(new Date());
prof.known = [];
const key = storeKey(prof.brand, prof.city);
await send("Runtime.enable"); await send("Page.enable");
const state = { v: STORE_VERSION, brand: prof.brand, city: prof.city, profile: prof, plan: null, statuses: {}, outcomes: {}, savedAt: new Date().toISOString() };
await send("Page.addScriptToEvaluateOnNewDocument", { source: `(() => { try { if (!localStorage.getItem("__seeded")) { localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(JSON.stringify(state))}); localStorage.setItem(${JSON.stringify(BRAND_KEY)}, ${JSON.stringify(JSON.stringify({ v: STORE_VERSION, profile: prof, savedAt: new Date().toISOString() }))}); localStorage.setItem("doors:drive-voice", "off"); localStorage.setItem("__seeded", "1"); } } catch {} window.SpeechRecognition = undefined; delete window.webkitSpeechRecognition; })();` });
const phone = +w <= 700, narrow = +w <= 900;
await send("Emulation.setDeviceMetricsOverride", { width: +w, height: +h, deviceScaleFactor: 1, mobile: phone });
if (phone) await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
const q = new URLSearchParams({ brand: prof.brand, city: prof.city });
await send("Page.navigate", { url: demo ? `${base}/app?ors=off&instant=1#/demo` : `${base}/app?ors=off&instant=1#/plan?${q}` });
await waitFor(`!!document.querySelector(".stop[data-id]")`, 40000);
await sleep(2500);
if (!demo) { await send("Page.reload"); await waitFor(`!!document.querySelector(".stop[data-id]")`, 40000); await sleep(2500); }
else { if (await ev(`!!document.querySelector(".ccard:not([hidden]) .cbtns .lnk")`)) { await click(".ccard:not([hidden]) .cbtns .lnk", { scroll: false }); await sleep(600); } must(!(await visible(".ccard")), "the tour's end card closed"); }
const report = { width: +w, height: +h, mode: modeArg };
const MAP = ".route .mapwrap .m", TOOLS = ".route .mapwrap .tools", FAB = ".route .mapwrap .btn.ask";
const openPanels = () => ev(`(() => ({ why: !document.querySelector("#why").hidden, log: !document.querySelector("#logbook").hidden, menu: !document.querySelector("#menu").hidden, settings: !document.querySelector("#settings").hidden, export: !document.querySelector("#export").hidden, drive: document.documentElement.classList.contains("driving"), stop: !!document.querySelector(".stopview:not([hidden])"), hash: location.hash }))()`);
const KEY = { logbook: "log" }; // a screen's name in the row → its key in openPanels
const onlyOpen = (p, k) => Object.entries(p).filter(([n]) => !["hash"].includes(n)).every(([n, v]) => (n === (KEY[k] ?? k)) === !!v);

// ---- items 1–3 (narrow): the row above the map, Menu as its icon, the Agent floating with no bar ----
await shot("a1-plan");
report.layout = { tools: await rect(TOOLS), map: await rect(MAP), appbar: await rect("#appbar"), pageWidth: await ev(`document.documentElement.scrollWidth`),
  buttons: await ev(`[...document.querySelectorAll(${JSON.stringify(TOOLS)} + " > .btn")].filter((b) => b.getClientRects().length).map((b) => { const r = b.getBoundingClientRect(); return { t: +r.top.toFixed(1), b: +r.bottom.toFixed(1), l: +r.left.toFixed(1), r: +r.right.toFixed(1), text: b.textContent.trim() }; })`),
  menuLabelShown: await ev(`(() => { const l = document.querySelector(${JSON.stringify(TOOLS)} + " .menu-btn .lbl"); return !!l && l.getBoundingClientRect().width > 1; })()`),
  menuAria: await ev(`document.querySelector(${JSON.stringify(TOOLS)} + " .menu-btn").getAttribute("aria-label")`),
  menuRect: await rect(`${TOOLS} .menu-btn`),
  strip: await ev(`getComputedStyle(document.querySelector(".app"), "::after").content`),
  fab: await rect(FAB), fabFixed: await ev(`getComputedStyle(document.querySelector(${JSON.stringify(FAB)})).position`),
  hoodkey: await rect(".mapwrap .hoodkey"), runbar: await rect(".mapwrap .runbar"), weeklegend: await rect(".mapwrap .weeklegend") };
const L = report.layout;
must(L.pageWidth <= +w, `the page is no wider than the screen (${L.pageWidth})`);
if (narrow) {
  must(L.tools && L.map && L.tools.b <= L.map.t + 0.5 && L.tools.t >= L.appbar.b - 0.5, `the buttons sit between the header and the map (${JSON.stringify({ tools: L.tools, map: L.map, appbar: L.appbar })})`);
  must(L.buttons.length === 4 && L.buttons.every((b) => Math.abs(b.t - L.buttons[0].t) < 1), `the four buttons are one line (${JSON.stringify(L.buttons)})`);
  must(L.buttons.map((b) => b.text).join("|") === "Start my day|Market|My doors|Menu", `the row is Start my day · Market · My doors · Menu (${L.buttons.map((b) => b.text).join("|")})`);
  must(L.strip === "none", `no bar of its own under the Agent button (.app::after ${L.strip})`);
  must(L.fab && L.fabFixed === "fixed" && L.fab.r >= +w - 16 - 0.5 && L.fab.b <= +h - 0.5 && L.fab.w >= 52, `the Agent is a round button fixed at the screen's bottom right (${JSON.stringify(L.fab)})`);
  for (const [k, r] of [["hoodkey", L.hoodkey], ["runbar", L.runbar], ["weeklegend", L.weeklegend]]) if (r) must(r.t >= L.map.t - 0.5 && r.b <= L.map.b + 0.5 && r.l >= L.map.l - 0.5, `${k} sits inside the map (${JSON.stringify({ r, map: L.map })})`);
  // nothing that flows in the map block (the tour's route credit, the map card) sits above the map; every overlay of the
  // map is placed in the map's row, so a hidden sheet's empty row never pulls one up
  report.layout.kids = await ev(`[...document.querySelector(".route .mapwrap").children].filter((e) => e.getClientRects().length && getComputedStyle(e).display !== "none").map((e) => { const cs = getComputedStyle(e), r = e.getBoundingClientRect(); return { sel: (e.className && typeof e.className === "string" ? "." + e.className.split(" ")[0] : e.id ? "#" + e.id : e.tagName), pos: cs.position, row: cs.gridRowStart, t: +r.top.toFixed(1), b: +r.bottom.toFixed(1) }; })`);
  for (const k of report.layout.kids) {
    if (k.sel === ".tools" || k.sel === ".m" || k.pos === "fixed") continue;
    if (k.pos === "absolute") must(k.row === "5", `${k.sel} (absolute) is placed in the map's row (row ${k.row})`);
    else must(k.t >= L.map.b - 0.5, `${k.sel} (in flow) sits under the map, not above it (${JSON.stringify(k)} map ${JSON.stringify(L.map)})`);
  }
  // the Agent's button never sits on the buttons' row
  must(!(L.fab && L.tools && L.fab.t < L.tools.b && L.fab.b > L.tools.t && L.fab.l < L.tools.r), "the Agent button is clear of the row");
}
if (phone) {
  must(L.menuLabelShown === false && /menu/i.test(L.menuAria ?? ""), `Menu shows its icon alone at a phone width, named Menu for a screen reader (label shown ${L.menuLabelShown}, aria "${L.menuAria}")`);
  const m = L.menuRect, cx = (m.l + m.r) / 2, cy = (m.t + m.b) / 2;
  report.layout.menuHit = { above: await hits(`${TOOLS} .menu-btn`, cx, cy - 21), below: await hits(`${TOOLS} .menu-btn`, cx, cy + 21), left: await hits(`${TOOLS} .menu-btn`, cx - 21, cy), right: await hits(`${TOOLS} .menu-btn`, cx + 21, cy) };
  must(Object.values(report.layout.menuHit).every(Boolean), `Menu has a 44 px hit area (${JSON.stringify(report.layout.menuHit)})`);
} else if (!narrow) {
  must(L.menuLabelShown === true, "a wide screen keeps the word Menu");
}
if (narrow) {
  // the end of the page: the last row and the footer scroll clear of the Agent button, nothing cut off
  await ev(`window.scrollTo(0, document.documentElement.scrollHeight)`);
  await sleep(400);
  report.end = { lastRow: await rect(".stop[data-id]:last-of-type"), foot: await rect(".app .appfoot > span:last-child"), fab: await rect(FAB), scrollY: await ev(`scrollY`), page: await ev(`document.documentElement.scrollHeight`), stripNow: await ev(`getComputedStyle(document.querySelector(".app"), "::after").content`) };
  const E = report.end;
  const low = E.foot ?? E.lastRow;
  if (low) must(low.b <= E.fab.t + 0.5, `scrolled to the end, the page's last line (the footer) sits above the Agent button (${JSON.stringify({ low, fab: E.fab })})`);
  must(E.stripNow === "none", "no bar at the end of the page either");
  await shot("a2-end-of-page");
  await ev(`window.scrollTo(0, 0)`); await sleep(300);
  // the Menu opens right under the row, above the map; Settings and Export the same
  await click(`${TOOLS} .menu-btn`, { scroll: false }); await sleep(400);
  report.menu = { menu: await rect("#menu"), tools: await rect(TOOLS), map: await rect(MAP), fab: await visible(FAB) };
  must(report.menu.menu && report.menu.menu.t >= report.menu.tools.b - 0.5 && report.menu.menu.b <= report.menu.map.t + 0.5, `the Menu opens under the row and above the map (${JSON.stringify(report.menu)})`);
  must(!report.menu.fab, "the Agent button hides while the Menu is open");
  await shot("a3-menu");
  await click('#menu [data-drawer="settings"]', { scroll: false }); await sleep(500);
  report.settings = { settings: await rect("#settings"), tools: await rect(TOOLS), map: await rect(MAP), menuOpen: await visible("#menu") };
  must(report.settings.settings && !report.settings.menuOpen && report.settings.settings.t >= report.settings.tools.b - 0.5 && report.settings.settings.b <= report.settings.map.t + 0.5, `Settings opens in the Menu's place, above the map (${JSON.stringify(report.settings)})`);
  await shot("a4-settings");
  await click('#settings [data-mback]', { scroll: false }); await sleep(300);
  must(await visible("#menu") && !(await visible("#settings")), "Back from Settings shows the Menu");
  await click('#menu [data-drawer="export"]', { scroll: false }); await sleep(500);
  report.export = { exp: await rect("#export"), map: await rect(MAP) };
  must(report.export.exp && report.export.exp.b <= report.export.map.t + 0.5, `Export opens above the map (${JSON.stringify(report.export)})`);
  await ev(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`); await sleep(300);
  must(!(await visible("#export")), "Escape closes Export");
  // the demo's building pill and the day's run bar belong to the map (the tour only)
  if (demo) {
    await click(".daytabs .dtdays button"); await sleep(600);
    report.dayBar = { bar: await rect(".mapwrap .runbar"), map: await rect(MAP) };
    if (report.dayBar.bar) must(report.dayBar.bar.t >= report.dayBar.map.t && report.dayBar.bar.b <= report.dayBar.map.b + 0.5, `a day's Watch the route bar sits inside the map (${JSON.stringify(report.dayBar)})`);
    await shot("a5-day");
    await click(".daytabs .wk"); await sleep(400);
  }
}

// ---- item 4 (every width): one tap from an open screen to another ----
const BTN = { why: `${TOOLS} [data-drawer="why"]`, logbook: `${TOOLS} [data-drawer="logbook"]`, menu: `${TOOLS} .menu-btn`, settings: '#menu [data-drawer="settings"]', export: '#menu [data-drawer="export"]' };
const reachable = async (sel) => { const c = await centre(sel); return !!c && (await hits(sel, c.x, c.y)); };
const openScreen = async (k) => { // from the plan
  if (k === "settings" || k === "export") { await click(BTN.menu, { scroll: false }); await sleep(250); }
  await click(BTN[k], { scroll: false }); await sleep(500);
};
const closeAll = async () => { for (let i = 0; i < 4 && Object.entries(await openPanels()).some(([n, v]) => n !== "hash" && v); i++) { await ev(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`); await sleep(250); if (await ev(`document.documentElement.classList.contains("driving")`)) { await click('[data-drive-close], .dv-x', { scroll: false }); await sleep(400); } } };
const hashAt = async () => ev(`location.hash`);
report.pairs = [];
const SCREENS = ["why", "logbook", "menu", "settings", "export"];
for (const from of SCREENS) {
  for (const to of [...SCREENS, "drive"]) {
    if (from === to) continue;
    if (to === "settings" || to === "export") continue; // only the Menu reaches them (checked below)
    await closeAll(); await ev(`window.scrollTo(0, 0)`); await sleep(200);
    const plainHash = await hashAt();
    await openScreen(from);
    const before = await openPanels();
    if (!onlyOpen(before, from)) { problems.push(`could not open ${from} first (${JSON.stringify(before)})`); continue; }
    const target = to === "drive" ? "#t-drive" : BTN[to];
    const can = await reachable(target);
    const row = { from, to, reachable: can };
    if (!can) { row.note = "the row is under this screen at this width"; report.pairs.push(row); continue; }
    await click(target, { scroll: false }); await sleep(600);
    const after = await openPanels();
    row.after = after;
    const want = to === "drive" ? (after.drive && !after.stop) : onlyOpen(after, to);
    must(want, `${w}: from ${from}, one tap on ${to} opens it alone (${JSON.stringify(after)})`);
    if (to === "drive") { await click('[data-drive-close], .dv-x', { scroll: false }); await sleep(500); row.closed = await openPanels(); }
    else if (["why", "logbook"].includes(to) && !demo) { // Back returns to the plan, no ping-pong (the tour has no history of its own)
      await ev(`history.back()`); await sleep(600);
      row.back = await openPanels();
      must(!Object.entries(row.back).some(([n, v]) => n !== "hash" && v) && row.back.hash === plainHash, `${w}: Back from ${to} (reached from ${from}) returns to the plan (${JSON.stringify(row.back)} vs ${plainHash})`);
    }
    report.pairs.push(row);
  }
}
// from the Menu, Settings and Export open in one tap; from Settings, Export (via Back to the Menu, two taps by design)
await closeAll();
for (const to of ["settings", "export"]) {
  await closeAll(); await openScreen("menu");
  await click(BTN[to], { scroll: false }); await sleep(500);
  const after = await openPanels();
  must(onlyOpen(after, to), `${w}: from the Menu, one tap on ${to} opens it alone (${JSON.stringify(after)})`);
  report.pairs.push({ from: "menu", to, after });
}
await closeAll();

// ---- item 5 (wide): My doors takes the whole page ----
if (!narrow) {
  const mapBefore = await rect(MAP), routeW = (await rect(".route")).w;
  await openScreen("logbook");
  report.wideLog = { log: await rect("#logbook"), rcol: await rect(".route .rcol"), mapVisible: await visible(MAP), head: await rect("#logbook .lb-head"), rows: await rect("#logbook .lb-rows"), tools: await visible(TOOLS), routeW, hood: await visible(".mapwrap .hoodkey") };
  const W5 = report.wideLog;
  must(W5.rcol.w >= routeW - 1, `My doors spans the page (${W5.rcol.w} of ${routeW})`);
  must(!W5.mapVisible && !W5.hood, "no map (or map overlay) shows beside My doors");
  must(W5.head && W5.head.w <= 960 + 1 && Math.abs((W5.head.l + W5.head.r) / 2 - +w / 2) <= 2, `its content is a column of at most 960 px, centred (${JSON.stringify(W5.head)})`);
  must(W5.tools, "the plan's buttons stay in the header");
  await shot("d1-mydoors-wide");
  await click(BTN.menu, { scroll: false }); await sleep(400);
  report.wideLog.menu = await rect("#menu");
  must(report.wideLog.menu && report.wideLog.menu.r <= +w && report.wideLog.menu.t >= 0, `the Menu opens over My doors (${JSON.stringify(report.wideLog.menu)})`);
  must(await hits("#menu", report.wideLog.menu.l + 20, report.wideLog.menu.t + 20), "the Menu over My doors takes a click");
  await shot("d2-mydoors-menu");
  await ev(`document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`); await sleep(300);
  // a door opened from My doors shows on the map; closing it brings My doors back; Back then returns to the plan
  if (await visible("#logbook .lb-nm")) {
    await click("#logbook .lb-nm", { scroll: false }); await sleep(800);
    report.wideLog.door = { ...(await openPanels()), mapVisible: await visible(MAP), map: await rect(MAP) };
    must(report.wideLog.door.stop && !report.wideLog.door.log && report.wideLog.door.mapVisible, `a door from My doors opens with the map (${JSON.stringify(report.wideLog.door)})`);
    await shot("d3-door-from-mydoors");
    await click(".stopview:not([hidden]) [data-s=\"close\"]", { scroll: false }); await sleep(700);
    report.wideLog.backToLog = await openPanels();
    must(report.wideLog.backToLog.log && !report.wideLog.backToLog.stop, `closing the door brings My doors back (${JSON.stringify(report.wideLog.backToLog)})`);
    if (!demo) { await ev(`history.back()`); await sleep(600); }
    else { await click("#logbook .lb-x", { scroll: false }); await sleep(500); }
    report.wideLog.backToPlan = { ...(await openPanels()), map: await rect(MAP) };
    must(!report.wideLog.backToPlan.log && !report.wideLog.backToPlan.stop, `Back from My doors returns to the plan (${JSON.stringify(report.wideLog.backToPlan)})`);
  }
  await closeAll(); await sleep(400);
  const mapAfter = await rect(MAP);
  must(mapAfter && Math.abs(mapAfter.w - mapBefore.w) < 1 && Math.abs(mapAfter.l - mapBefore.l) < 1, `the map is back as it was (${JSON.stringify({ mapBefore, mapAfter })})`);
  await shot("d4-plan-again");
} else {
  await openScreen("logbook"); await sleep(300);
  report.narrowLog = { log: await rect("#logbook"), full: (await rect("#logbook"))?.w >= +w - 1 };
  must(report.narrowLog.full, `My doors keeps the screen at ${w} (${JSON.stringify(report.narrowLog)})`);
  await shot("d1-mydoors");
  await closeAll();
}

console.log(JSON.stringify(report, null, 1));
if (problems.length) { console.error("PROBLEMS\n" + problems.join("\n")); process.exit(1); }
console.log("OK");
process.exit(0);
