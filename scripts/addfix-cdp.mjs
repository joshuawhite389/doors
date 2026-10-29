// Added doors (Jard 10-24 web review, group 2), proven in headless Chromium over CDP on a saved Tidewell plan:
// 1 Let Doors choose on a door no day can hold: nothing recorded (no "Added by you" tag, no "you added it", no banner),
//   the toast says "Couldn't add … : why". 2 An added door saved before the fix (stuck, no day): its banner has Remove
//   from my plan, and so does its Why this door; either clears it. 3 A door on the plan: Why this door has a plain Remove
//   from my plan beside Already a customer / Not a fit; it comes off, Your list says Removed with Undo. 4 The stop's More
//   menu has Remove from my plan. Screenshots every step; prints a JSON report and "problems none" when every check passes.
// Usage: node scripts/addfix-cdp.mjs <base-url> <out-dir> [width] [height] [before]   (before: shots only, no checks)
import { spawn } from "node:child_process";
import fs from "node:fs";
import { demoProfile } from "../public/lib/demo-profile.js";
import { storeKey } from "../public/lib/store.js";
import { isoDate } from "../public/lib/profile.js";
const [base, out, w = "1400", h = "900", mode = ""] = process.argv.slice(2);
const before = mode === "before";
fs.mkdirSync(out, { recursive: true });
const port = 9400 + Math.floor(Math.random() * 400);
const dir = `/tmp/claude-1000/addfix-${port}`;
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
const url = `${base}/app#/plan?${q}`;
await send("Page.navigate", { url });
const report = { width: +w, steps: [] };
const step = async (name, extra = {}) => { await sleep(700); await shot(name); report.steps.push({ name, ...extra }); };
const ready = () => waitFor(`!!document.querySelector(".stop[data-id]") && !document.querySelector("[data-b2]")`, 60000);
const saved = () => ev(`JSON.parse(localStorage.getItem(${JSON.stringify(key)}))`);
const toastText = () => ev(`(document.querySelector("#p-toast:not([hidden])")?.innerText ?? "")`);
const S = (expr) => ev(`import("/ui/state.js").then((S) => ${expr})`);
const tryStep = async (name, fn) => { try { await fn(); } catch (e) { problems.push(`${name}: ${String(e.message ?? e).split("\n")[0]}`); await shot(`${name}-error`).catch(() => {}); } };
await ready();
await sleep(2500);
await step("01-plan");

// ---- 1: Let Doors choose on a door no day can hold ----
let victim = null;
await tryStep("1", async () => {
  await click('.daytabs [data-tab="rest"]');
  await sleep(1200);
  // a ranked door on Your list that is closed every window (its row's why says so), with + Add to a day
  victim = await ev(`(() => { const r = [...document.querySelectorAll(".stop.rest[data-id]")].find((li) => li.querySelector("[data-addopen]") && /closed|opens|isn't open|not open/i.test(li.querySelector(".why")?.textContent ?? "")); return r ? { id: r.dataset.id, name: r.querySelector(".nm")?.textContent.trim(), why: r.querySelector(".why").textContent.trim() } : null; })()`);
  report.victim = victim;
  if (!victim) throw new Error("no closed door on Your list");
  await click(`.stop.rest[data-id="${victim.id}"] [data-addopen]`);
  await step("02-addto-open");
  await click(`.stop.rest[data-id="${victim.id}"] .addto .chip.auto`);
  await waitFor(`/Couldn't add|Added to|Not on/.test(document.querySelector("#p-toast")?.innerText ?? "")`, 30000);
  await sleep(1500);
  const t = await toastText();
  const st = await saved();
  const row = await ev(`document.querySelector('.stop[data-id="${victim.id}"]')?.innerText ?? ""`);
  const notes = await ev(`[...document.querySelectorAll(".pnotes")].map((x) => x.innerText).join(" | ")`);
  await step("03-let-doors-choose-toast", { toast: t, added: st.added ?? [], row, notes });
  check(/^Couldn't add /.test(t), `toast says it couldn't add (${t})`);
  check(!(st.added ?? []).some((a) => a.id === victim.id), "nothing saved as added");
  check(!/Added by you/.test(row), "no Added by you tag");
  check(!/Added by you/.test(notes), "no Added by you banner");
  await ev(`document.querySelector("[data-why], .tools [data-basis], [data-act=why]")?.click()`);
  const changes = await S(`(S.getPlan()?.added ?? []).length`);
  check(!changes, "plan has no added doors");
});

// ---- 2: a stuck add saved before the fix: the banner's Remove and Why this door's Remove clear it ----
const seedStuck = async () => {
  const st = await saved();
  const v = (await S(`S.getPlan().venues[${JSON.stringify(victim.id)}]`)) ?? {};
  st.added = [{ ...v, id: victim.id, lat: +v.lat, lon: +v.lon, date: null }];
  await ev(`localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify("__X__")}.replace("__X__", ${JSON.stringify(JSON.stringify(st))}))`);
  await send("Page.reload", { ignoreCache: false });
  await sleep(1500);
  await ready();
  await sleep(2000);
};
await tryStep("2a", async () => {
  if (!victim) throw new Error("no victim");
  await seedStuck();
  await click('.daytabs [data-tab="week"], .daytabs [data-tab="0"]').catch(() => {});
  await sleep(800);
  const has = await ev(`!!document.querySelector("[data-unadd]")`);
  // the banner may be folded into "N notes from the planner"
  if (!has) await ev(`document.querySelectorAll("details.pnotes").forEach((d) => (d.open = true))`);
  const banner = await ev(`[...document.querySelectorAll(".pnotes li")].map((x) => x.innerText).find((t) => /Added by you/.test(t)) ?? ""`);
  await step("04-stuck-banner", { banner });
  check(/Remove from my plan/.test(banner), "stuck banner has Remove from my plan");
  await click("[data-unadd]");
  await waitFor(`/is off your plan/.test(document.querySelector("#p-toast")?.innerText ?? "")`, 20000);
  const st = await saved();
  const left = await ev(`[...document.querySelectorAll(".pnotes")].map((x) => x.innerText).join(" | ")`);
  await step("05-stuck-banner-removed", { toast: await toastText(), added: st.added ?? [], notes: left });
  check(!(st.added ?? []).length, "banner Remove clears the add");
  check(!/Added by you/.test(left), "banner gone");
  check(!(st.statuses ?? {})[victim.id], "no status set on a door that was never on a day");
});
await tryStep("2b", async () => {
  if (!victim) throw new Error("no victim");
  await seedStuck();
  await ev(`window.dispatchEvent(new CustomEvent("doors:why-door", { detail: { id: ${JSON.stringify(victim.id)} }, cancelable: true }))`);
  await waitFor(`!!document.querySelector("#why:not([hidden]) .w-dfix")`, 15000);
  const fixes = await ev(`[...document.querySelectorAll("#why .w-dfix button")].map((b) => b.textContent.trim())`);
  await step("06-stuck-why-door", { fixes });
  check(fixes.includes("Remove from my plan") && !fixes.includes("Add it to my plan"), `stuck door's Why offers Remove, not Add (${fixes})`);
  await ev(`[...document.querySelectorAll("#why .w-dfix button")].find((b) => b.textContent.trim() === "Remove from my plan")?.click()`);
  await waitFor(`/is off your plan/.test(document.querySelector("#p-toast")?.innerText ?? "")`, 20000);
  const st = await saved();
  await step("07-stuck-why-removed", { added: st.added ?? [] });
  check(!(st.added ?? []).length, "Why's Remove clears the add");
  await ev(`document.querySelector('#why [data-w="close"]')?.click()`);
  await sleep(600);
});

// ---- 3: a door on the plan: a plain Remove on Why this door ----
await tryStep("3", async () => {
  await send("Page.reload", { ignoreCache: false });
  await sleep(1500);
  await ready();
  await sleep(2000);
  const on = await S(`(() => { const d = S.getPlan().days.find((x) => !x.past && x.stops.length); const s = d.stops[d.stops.length - 1]; return { id: s.id, name: S.getPlan().venues[s.id]?.name }; })()`);
  report.onPlan = on;
  await ev(`window.dispatchEvent(new CustomEvent("doors:why-door", { detail: { id: ${JSON.stringify(on.id)} }, cancelable: true }))`);
  await waitFor(`!!document.querySelector("#why:not([hidden]) .w-dfix")`, 15000);
  const fixes = await ev(`[...document.querySelectorAll("#why .w-dfix button")].map((b) => b.textContent.trim())`);
  await step("08-onplan-why-door", { fixes });
  check(fixes.join("|") === "Already a customer|Not a fit|Remove from my plan|Ask", `on-plan Why fixes (${fixes})`);
  await ev(`[...document.querySelectorAll("#why .w-dfix button")].find((b) => b.textContent.trim() === "Remove from my plan")?.click()`);
  await waitFor(`/is off your plan/.test(document.querySelector("#p-toast")?.innerText ?? "")`, 20000);
  await sleep(1200);
  const st = await saved();
  const stillOn = await S(`S.getPlan().days.some((d) => d.stops.some((s) => s.id === ${JSON.stringify(on.id)}))`);
  report.debugRemoved = await S(`(() => { const p = S.getPlan(); return { days: p.days.map((d) => ({ date: d.date, past: !!d.past, frozen: !!d.frozen, has: d.stops.filter((s) => s.id === ${JSON.stringify(on.id)}).map((s) => ({ ...s, eta: s.eta })) })).filter((d) => d.has.length), status: p.statuses[${JSON.stringify(on.id)}], pinned: p.venues[${JSON.stringify(on.id)}]?.added }; })()`);
  await step("09-onplan-removed", { toast: await toastText(), status: st.statuses?.[on.id] ?? null, stillOn });
  check(!stillOn, "removed door is off every day");
  check(st.statuses?.[on.id] === "removed", "saved as removed (no reason)");
  await ev(`document.querySelector('#why [data-w="close"]')?.click()`);
  await sleep(600);
  await click('.daytabs [data-tab="rest"]');
  await sleep(1200);
  const row = await ev(`(() => { const li = document.querySelector('.stop[data-id="${on.id}"]'); if (!li) return null; li.scrollIntoView({ block: "center" }); return li.innerText; })()`);
  await step("10-yourlist-removed-row", { row });
  check(/Removed/.test(row ?? "") && /Undo/.test(row ?? ""), `Your list row says Removed with Undo (${row})`);
  await click(`.stop[data-id="${on.id}"] [data-act="undo"]`);
  await sleep(2500);
  const back = await S(`S.getPlan().days.some((d) => d.stops.some((s) => s.id === ${JSON.stringify(on.id)}))`);
  check(back, "Undo puts it back on a day");
  report.undoBack = back;
});

// ---- 4: the stop's More menu ----
await tryStep("4", async () => {
  await click('.daytabs [data-tab="0"]').catch(() => {});
  await sleep(800);
  await click(".stop[data-id] [data-open]");
  await waitFor(`!!document.querySelector(".stopview:not([hidden]) .smorebtn")`, 15000);
  await click(".stopview .smorebtn");
  await sleep(500);
  const items = await ev(`[...document.querySelectorAll(".stopview .smore button")].map((b) => b.textContent.trim())`);
  await step("11-stop-more-menu", { items });
  check(items.includes("Remove from my plan"), `stop's More has Remove (${items})`);
});

report.problems = problems;
console.log(JSON.stringify(report, null, 1));
console.log(problems.length ? `problems ${problems.length}` : "problems none");
process.exit(0);
