// R2 grounding (Jard web review 10-24): Why this door in the guided demo, every door on the plan: "What to say" is the
// stop's own opener (and the line to the buyer), never a stored "Looks like … in here" lead. Screenshots the first door.
// Usage: node scripts/r2ground-cdp.mjs <base-url> <out-dir> [width] [height] [before]   (before: shots only, no checks)
import { spawn } from "node:child_process";
import fs from "node:fs";
import { demoProfile } from "../public/lib/demo-profile.js";
import { storeKey } from "../public/lib/store.js";
import { isoDate } from "../public/lib/profile.js";
const [base, out, w = "1400", h = "900", mode = ""] = process.argv.slice(2);
const before = mode === "before";
const live = !mode;
fs.mkdirSync(out, { recursive: true });
const port = 9400 + Math.floor(Math.random() * 400);
const dir = `/tmp/claude-1000/r2ground-${port}`;
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

const key2 = (k) => send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code: k, windowsVirtualKeyCode: { ArrowDown: 40, ArrowUp: 38, Escape: 27, Home: 36, End: 35, Tab: 9, Enter: 13 }[k] }).then(() => send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code: k }));
const report = { width: +w };

await send("Runtime.enable"); await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: +w, height: +h, deviceScaleFactor: 1, mobile: +w < 700 });
await send("Page.navigate", { url: `${base}/app#/demo` });
const text = (sel) => ev(`[...document.querySelectorAll(${JSON.stringify(sel)})].filter((x) => x.getClientRects().length).map((x) => x.textContent.replace(/\\s+/g, " ").trim())`);
await waitFor(`[...document.querySelectorAll("button")].some((b) => /Skip to the finished plan/.test(b.textContent))`, 30000);
await ev(`[...document.querySelectorAll("button")].find((b) => /Skip to the finished plan/.test(b.textContent)).click()`);
await waitFor(`!!document.querySelector(".stop[data-id]")`, 60000);
await sleep(3000);
const ids = await ev(`[...new Set([...document.querySelectorAll(".stop[data-id]")].map((x) => x.dataset.id))]`);
report.doors = [];
for (const [i, id] of ids.entries()) {
  await ev(`window.dispatchEvent(new CustomEvent("doors:why-door", { detail: { id: ${JSON.stringify(id)} }, cancelable: true }))`);
  await waitFor(`!!document.querySelector("#why:not([hidden]) .w-door[data-wc-id='${id}']")`);
  await sleep(900);
  const name = (await text(".w-door .w-dname"))[0];
  const say = await text(".w-door .w-say");
  report.doors.push({ name, say });
  check(say.length >= 1, `${name}: What to say shows the stop's opener`);
  for (const s of say) check(!/looks like (you get|your regulars)|\bin here\b/i.test(s), `${name}: no stored lead: ${s}`);
  check(/^“(Hi|Hey), I'm /.test(say[0] ?? ""), `${name}: the opener is the stop's intro: ${say[0]}`);
  if (i === 0) {
    await ev(`document.querySelector(".w-say")?.scrollIntoView({ block: "center" })`);
    await sleep(500);
    await shot("01-why-what-to-say");
  }
}
console.log(JSON.stringify(report, null, 1));
console.log(`problems ${problems.length ? "\n" + problems.join("\n") : "none"}`);
process.exit(0);
