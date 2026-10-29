// H3 checks in headless Chromium (real time, over CDP), one browser, its profile removed however it ends:
//   why:    the left column is never blank: Skip to the finished plan, open "Why these rooms?", click a pin on the map →
//           Why's place card (H2), Why stays; a stop opened → the stop shows; reopen Why → Why; "← Your plan" → the stop.
//   reload: the demo resumes after a reload at form card 3, mid-build, on the plan before the visit, after Save outcome
//           and after Skip; Restart demo starts at card 1; a fresh visit after a finished demo starts at card 1.
// Usage: node scripts/demo-state-cdp.mjs <base-url> <out-dir> [width] [height] [all|why|reload]. Prints "problems none" when
// every check passes.
import { spawn } from "node:child_process";
import fs from "node:fs";
const [base, out, w = "1400", h = "900", only = "all"] = process.argv.slice(2);
fs.mkdirSync(out, { recursive: true });
const port = 9400 + Math.floor(Math.random() * 400);
const dir = `/tmp/claude-1000/state-${port}`;
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
const ev = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result?.value;
const shot = async (name) => { const r = await send("Page.captureScreenshot", { format: "png" }); if (r?.data) fs.writeFileSync(`${out}/${name}.png`, Buffer.from(r.data, "base64")); };
const clickXY = async (x, y) => { for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 }); };
const clickAt = async (sel) => {
  const r = await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; e.scrollIntoView({block:"center"}); const b = e.getBoundingClientRect(); return {x: b.left + b.width/2, y: b.top + b.height/2}; })()`);
  if (!r) return false;
  await sleep(250);
  await clickXY(r.x, r.y);
  return true;
};
const until = async (expr, ms = 60000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await ev(expr)) return true; await sleep(250); } return false; };
const expect = (name, ok, got) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` · ${JSON.stringify(got)}`}`); if (!ok) problems.push(`${name}: ${JSON.stringify(got)}`); };
await send("Runtime.enable"); await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: +w, height: +h, deviceScaleFactor: 1, mobile: +w < 700 });
const go = async (url) => { await send("Page.navigate", { url: "about:blank" }); await sleep(300); await send("Page.navigate", { url }); await sleep(2500); };
const reload = async () => { await send("Page.reload", {}); await sleep(3000); };

// what the page shows: the tour, the form, the plan
const look = () => ev(`(() => {
  const d = window.__demo, rc = document.querySelector(".rcol"), S = window.__S;
  const plan = S?.getPlan?.(), nomadic = plan && Object.keys(plan.venues).find((k) => plan.venues[k].name === "Nomadic Beerworks");
  return { first: d?.steps[0]?.key, key: d?.steps.at(-1)?.key, card: document.querySelector(".ccard:not([hidden]) h3")?.textContent ?? null,
    brand: document.querySelector("#f-brand")?.value ?? null, form: !!document.querySelector(".pform"), plan: !!document.querySelector(".route"),
    restored: !!d?.restored, banner: [...document.querySelectorAll(".demo-banner button")].filter((b) => !b.hidden).map((b) => b.textContent),
    visited: nomadic ? plan.statuses?.[nomadic] ?? null : null, followUp: nomadic ? plan.outcomes?.[nomadic]?.followUp ?? null : null,
    rows: rc ? rc.querySelectorAll(".stops .stop").length : 0 }; })()`);
const hookS = () => ev(`import("/ui/state.js").then((m) => { window.__S = m; return true; })`);
const cont = () => ev(`(() => { const c = document.querySelector(".ccard:not([hidden])"); (c?.querySelector(".btn.primary") ?? c?.querySelector(".lnk"))?.click(); return !!c; })()`);
// drive the tour (Continue, or "Do it for me" on the click steps) until the step `key` shows its card
async function driveTo(key, ms = 120000) {
  const t = Date.now();
  while (Date.now() - t < ms) {
    const s = await ev(`({ key: window.__demo?.steps.at(-1)?.key, card: !!document.querySelector(".ccard:not([hidden])") })`);
    if (s?.key === key && s.card) return true;
    if (s?.card && s.key !== "building") await cont();
    await sleep(400);
  }
  return false;
}

if (only !== "reload") {
  // ---------- why: the left column never goes blank ----------
  await go(`${base}/app#/demo`);
  await clickAt('.demo-banner [data-d="skip"]');
  await until(`!!window.__demo?.done`);
  await sleep(1500);
  await ev(`document.querySelector(".ccard .lnk")?.click()`);
  const col = () => ev(`(() => { const rc = document.querySelector(".rcol"); const vis = [...rc.children].filter((x) => x.getClientRects().length && getComputedStyle(x).display !== "none"); return { shown: vis.map((x) => x.id || x.className.split(" ")[0]), text: vis.reduce((n, x) => n + x.innerText.trim().length, 0), mode: document.querySelector(".route").classList.contains("why-mode") }; })()`);
  await clickAt('[data-drawer="why"]'); await sleep(1200);
  let c = await col();
  expect("why: Why opens in the left column", c.shown.includes("why") && c.text > 50, c);
  // On a phone (≤ 900 px) Why is a full-screen sheet over the map, so a pin can't be reached from it directly: the rep
  // lights a finding and taps "Show on map", which folds Why to a peek bar with the map above it (ui/why.js setPeek).
  // That is the phone's path to a pin, so the check takes it there. Desktop shows Why beside the map.
  const phone = +w <= 900;
  if (phone) {
    await sleep(2500); // mid-drop is fine: a finding tapped ends the drop (sieve finish)
    await clickAt("#why .w-find[data-pick]"); await sleep(800);
    await clickAt('#why [data-w="peek"]'); await sleep(1800);
  }
  // a numbered pin whose centre is on the map itself (not under Why, the demo banner or the toolbar): the markers let
  // clicks through, so the map finds the room under the tap
  const pin = await ev(`(() => { const r0 = document.querySelector(".mapwrap").getBoundingClientRect(); const m = [...document.querySelectorAll(".mapwrap .maplibregl-marker")].map((x) => [x, x.getBoundingClientRect()]).find(([x, r]) => { if (!/^\\d$/.test(x.textContent.trim()) || !(r.left > r0.left + 10 && r.right < r0.right - 10 && r.top > r0.top + 60 && r.bottom < r0.bottom - 10)) return false; const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!t && !!t.closest(".mapwrap"); }); return m ? { x: m[1].left + m[1].width / 2, y: m[1].top + m[1].height / 2 } : null; })()`);
  if (pin) await clickXY(pin.x, pin.y);
  await sleep(1500);
  c = await col();
  await shot(`why-${w}-1-pin`);
  // H2: in Why, a click on the map opens Why's own place card; the column keeps Why (never blank)
  const card = await ev(`!!document.querySelector(".wc[data-wc-id]")`);
  const whyOpen = () => ev(`!document.querySelector("#why")?.hidden`);
  expect("why: a pin clicked in Why opens the place card, Why stays", !!pin && card && (phone ? await whyOpen() : c.shown.includes("why") && c.text > 50 && c.mode), { pin, card, ...c });
  // the card's "Open the room" path: a stop opened from anywhere closes Why and shows the stop (H3)
  await ev(`(() => { const id = document.querySelector(".wc[data-wc-id]")?.dataset.wcId; if (id) window.dispatchEvent(new CustomEvent("doors:open-stop", { detail: { id, day: null } })); })()`);
  await sleep(1200);
  c = await col();
  expect("why: a stop opened while in Why shows the stop", c.shown.includes("stopview") && c.text > 50 && !c.mode, c);
  if (!phone) {
    await clickAt('[data-drawer="why"]'); await sleep(1000);
    c = await col();
    expect("why: reopened over the open stop, Why shows", c.shown.includes("why") && c.text > 50, c);
    await clickAt('#why [data-w="close"]'); await sleep(800);
    c = await col();
    await shot(`why-${w}-2-back`);
    expect("why: ← Your plan brings the stop back", c.shown.includes("stopview") && c.text > 50 && !c.mode, c);
    await ev(`document.querySelector('.stopview [data-s="close"]')?.click()`); await sleep(800);
    c = await col();
    expect("why: closing the stop shows the list", c.text > 50 && !c.shown.includes("stopview"), c);
  } else {
    // A phone has no left column: the open stop is a full-screen sheet over the toolbar (a tap on "Why these rooms?"
    // lands on the stop), and Why is a full-screen sheet with ✕, not "← Your plan" (hidden ≤ 900 px). So the phone's
    // path back is: close the stop → the plan → Why from the toolbar → ✕ → the plan, never a blank screen.
    const covered = await ev(`(() => { const b = document.querySelector('[data-drawer="why"]'); const r = b.getBoundingClientRect(); const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!t?.closest(".stopview"); })()`);
    expect("why (phone): the open stop is a sheet over the toolbar", covered, { covered });
    await clickAt('.stopview:not([hidden]) [data-s="close"]'); await sleep(800);
    c = await col();
    expect("why (phone): closing the stop shows the plan", c.text > 50 && !c.shown.includes("stopview"), c);
    await clickAt('[data-drawer="why"]'); await sleep(1200);
    const open = await ev(`(() => { const e = document.querySelector("#why"); return !e.hidden && !e.classList.contains("w-peek") && e.innerText.trim().length > 50; })()`);
    expect("why (phone): Why opens again from the toolbar, full screen", open, { open });
    // Why has two ✕ (the desktop column's and the phone sheet's); tap the one on screen
    const x = await ev(`(() => { const b = [...document.querySelectorAll('#why [data-w="close"]')].find((e) => e.getBoundingClientRect().width > 0); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    if (x) await clickXY(x.x, x.y);
    await sleep(800);
    c = await col();
    await shot(`why-${w}-2-back`);
    expect("why (phone): ✕ closes Why onto the plan", (await ev(`document.querySelector("#why").hidden`)) && c.text > 50, c);
  }
}

if (only !== "why") {
  // ---------- reload: the demo resumes ----------
  await go(`${base}/app#/demo`);
  await ev(`document.querySelector('.demo-banner [data-d="restart"]')?.click()`); // a clean start in this tab
  await sleep(1500);
  await until(`document.querySelector(".ccard:not([hidden]) h3")?.textContent === "Meet Maya"`, 20000); // the reload, under load
  expect("fresh: card 1", (await look()).card === "Meet Maya", await look());
  // form card 3
  await driveTo("day");
  await reload(); await hookS();
  let s = await look();
  await shot(`reload-${w}-1-form-card3`);
  expect("form card 3: same card, the form filled to it", s.first === "day" && s.card === "Where and when" && s.brand === "Tidewell", s);
  // mid-build
  await driveTo("build");
  await ev(`document.querySelector("#build")?.click()`);
  await until(`window.__demo?.steps.at(-1)?.key === "building"`, 30000);
  await sleep(1200);
  await reload(); await hookS();
  await until(`!!window.__demo?.restored`, 30000); await sleep(1500);
  s = await look();
  await shot(`reload-${w}-2-mid-build`);
  // tour lane judge pass 2 (b5e3cc8, ui/demo.js): a reload mid-tour shows the plan with one card saying where they are
  expect("mid-build: the plan, the tour closed, the re-entry card", s.plan && s.restored && s.card === "Your demo plan, as you left it" && s.rows > 0 && s.banner.join() === "Restart demo" && s.visited === null, s);
  // the plan before the visit: restart, build, stop on Tuesday's card
  await ev(`document.querySelector('.demo-banner [data-d="restart"]').click()`); await sleep(3000);
  await driveTo("tuesday", 150000);
  await reload(); await hookS();
  await until(`!!window.__demo?.restored`, 30000); await sleep(1500);
  s = await look();
  expect("plan before the visit: the plan, nothing visited", s.plan && s.restored && s.visited === null, s);
  // after Save outcome
  await ev(`document.querySelector('.demo-banner [data-d="restart"]').click()`); await sleep(3000);
  await driveTo("replan", 200000);
  await reload(); await hookS();
  await until(`!!window.__demo?.restored`, 30000); await sleep(1500);
  s = await look();
  await shot(`reload-${w}-3-after-outcome`);
  expect("after Save outcome: Nomadic visited, follow-up kept", s.plan && s.restored && s.visited === "visited" && !!s.followUp, s);
  // after Skip
  await ev(`document.querySelector('.demo-banner [data-d="restart"]').click()`); await sleep(3000);
  await clickAt('.demo-banner [data-d="skip"]');
  await until(`!!window.__demo?.done`); await sleep(1000);
  await reload(); await hookS();
  await until(`!!window.__demo?.restored`, 30000); await sleep(1500);
  s = await look();
  await shot(`reload-${w}-4-after-skip`);
  expect("after Skip: the finished plan, the tour closed", s.plan && s.restored && s.visited === "visited" && s.banner.join() === "Restart demo", s);
  // a finished demo, then a fresh visit (Watch the tour): card 1
  await go(`${base}/app#/demo`);
  s = await look();
  expect("fresh visit after a finished demo: card 1", s.card === "Meet Maya" && s.form, s);
  // Restart demo from the restored plan: card 1, an empty form
  await clickAt('.demo-banner [data-d="skip"]'); await until(`!!window.__demo?.done`); await sleep(800);
  await reload(); await until(`!!window.__demo?.restored`, 30000);
  await ev(`document.querySelector('.demo-banner [data-d="restart"]').click()`); await sleep(3000);
  s = await look();
  await shot(`reload-${w}-5-restart`);
  expect("Restart demo: card 1, an empty form, nothing saved", s.card === "Meet Maya" && s.brand === "" && (await ev(`Object.keys(sessionStorage).filter((k) => k.startsWith("doors.v2.demo")).length`)) <= 1, s);
}
console.log("problems", problems.length ? problems.join("\n") : "none");
process.exit(0);
