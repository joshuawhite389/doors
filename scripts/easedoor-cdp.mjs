// Ease fixes (door card, Log visit, drive mode; ease audit #7 #8 #9 #15 + the preview-day visit time), on the web:
// the door card's end (no Qloo data / Your rules rows, named counts, "See Qloo's listing"), ⋯ without Call, the Log visit
// sheet (four outcomes styled the same, the follow-up line, nothing pre-focused), a visit logged on a previewed day stamped
// at its slot, Start my day's labels (Opener, Questions, Crowd, Why this door, "Preview of … (not today)"), Running late
// +30 min on a preview day, Your rules in Edit profile (Enter adds a rule, not Build). Screenshots each; "problems none".
// Usage: node scripts/easedoor-cdp.mjs <base-url> <out-dir> [width] [height] [before]   (before: shots only, no checks)
import { spawn } from "node:child_process";
import fs from "node:fs";
import { demoProfile } from "../public/lib/demo-profile.js";
import { storeKey, rulesKey } from "../public/lib/store.js";
import { isoDate } from "../public/lib/profile.js";
const [base, out, w = "1400", h = "900", mode = ""] = process.argv.slice(2);
const before = mode === "before";
fs.mkdirSync(out, { recursive: true });
const port = 9400 + Math.floor(Math.random() * 400);
const dir = `/tmp/claude-1000/easedoor-${port}`;
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

const prof = demoProfile(new Date()); // its days are ahead of today: every day is a preview
prof.known = [];
const key = storeKey(prof.brand, prof.city);
const today = isoDate(new Date());
const [y, mo, d] = today.split("-").map(Number);
const pinned = new Date(y, mo - 1, d, 21, 59).getTime(); // the audit's "Visited 9:59 pm"
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
const shotAt = async (name) => { await sleep(500); await shot(name); };
const text = (sel) => ev(`[...document.querySelectorAll(${JSON.stringify(sel)})].filter((x) => x.getClientRects().length).map((x) => x.textContent.replace(/\\s+/g, " ").trim())`);
await waitFor(`!!document.querySelector(".stop[data-id]")`, 40000);
await sleep(2500);
// the first open builds the plan with its animation; a reload opens the saved plan as a rep sees it
await send("Page.reload");
await waitFor(`!!document.querySelector(".stop[data-id]")`, 40000);
await sleep(2500);
// ---- the door card ----
const id1 = await ev(`document.querySelector(".stop[data-id]").dataset.id`);
const day0 = prof.windows[0].date;
await ev(`document.querySelector('.stop[data-id="${id1}"] [data-open]').click()`); // the list's drag handler takes a synthetic press
await waitFor(`!!document.querySelector(".stopview:not([hidden]) .atdoor")`);
await shotAt("01-door-top");
await ev(`document.querySelector(".stopview:not([hidden]) .sscroll").scrollTo(0, 1e6)`);
await shotAt("02-door-end");
const rows = await text(".drow b");
check(!rows.some((t) => /Qloo data|Your rules/.test(t)), `no Qloo data / Your rules rows: ${rows.join(" | ")}`);
check((await text(".dqloo")).join("") === "See Qloo's listing ›", "See Qloo's listing under About");
const counts = (await text(".dmore span"))[0] ?? "";
check(/^\d+ questions? · \d+ points? · \d+ pushbacks?$/.test(counts), `named counts: ${counts}`);
await click(".dqloo");
await waitFor(`document.querySelector(".pgh h3")?.textContent === "Qloo's listing"`);
await shotAt("03-qloo-listing");
await click('[data-s="pg-back"]');
await waitFor(`!!document.querySelector(".stopview:not([hidden]) .atdoor")`);
// ⋯: no second Call
await click('[data-s="more"]');
await sleep(300);
const menu = await text('.smore [role="menuitem"]');
check(!menu.includes("Call"), `⋯ has no Call: ${menu.join(" | ")}`);
await shotAt("04-more");
await key2("Escape");
// ---- Log visit ----
const arrive = (await text(".dstatus"))[0] ?? "";
await click('[data-s="visit"]');
await waitFor(`!!document.querySelector(".osheet")`);
await shotAt("05-log");
const quick = await text(".oquick [data-q]");
check(quick.length === 4 && quick[0] === "Interested" && /^Follow up \w{3} \w{3} \d{1,2}$/.test(quick[1]) && quick[2] === "Talked to someone else" && quick[3] === "Not interested", `four outcomes, the date on Follow up: ${quick.join(" | ")}`);
const bgs = await ev(`[...new Set([...document.querySelectorAll(".oquick [data-q]")].map((b) => getComputedStyle(b).backgroundColor + "/" + getComputedStyle(b).color))]`);
check(bgs.length === 1, `all styled the same: ${bgs.join(" ; ")}`);
check(await ev(`document.activeElement?.id === "o-title"`), "nothing pre-picked: focus on the title");
check(!(await text(".ofu")).length && !(await ev(`!!document.querySelector('[data-o="change"]')`)), "no follow-up line under all four");
await click('[data-o="more"]');
await sleep(300);
await shotAt("06-log-details");
await click('[data-o="cancel"]');
await sleep(300);
await click('[data-s="visit"]');
await waitFor(`!!document.querySelector(".osheet")`);
await click('[data-q="interested"]');
await waitFor(`!document.querySelector(".osheet")`);
await sleep(800);
await shotAt("07-logged");
const at = await ev(`JSON.parse(localStorage.getItem(${JSON.stringify(key)})).outcomes[${JSON.stringify(id1)}]?.at ?? ""`);
check(at.slice(0, 10) === day0, `the visit is on its own (preview) day ${day0}: ${at}`);
check(!/T21:59/.test(at), `not today's clock: ${at}`);
const st = (await text(".dstatus"))[0] ?? "";
check(!/9:59 pm/.test(st) && /Visited/.test(st), `status after: ${st} (before: ${arrive})`);
report.logged = { at, before: arrive, after: st };
await click('[data-s="close"]');
await sleep(600);
// ---- Start my day (a preview day) ----
await click("[data-drive-start]");
await waitFor(`!!document.querySelector("[data-drive-door]")`, 30000);
await sleep(1500);
await shotAt("08-drive");
const heads = await text("[data-drive-door] h2");
check(heads.includes("Opener") && heads.includes("Questions") && !heads.includes("Say") && !heads.includes("Ask"), `drive headings: ${heads.join(" | ")}`);
check(heads.includes("Why this door") && (heads.includes("Crowd") || heads.includes("The room")), `Crowd + Why this door: ${heads.join(" | ")}`);
const dayl = (await text(".dv-day b"))[0] ?? "";
// intuit audit #2 (lane W): a previewed day leads with the day ("Tuesday, Oct 27"), the "not today" note under it
const ahead = (await text(".dv-day .dv-ahead"))[0] ?? "";
// lane S (intuit 1b #1): ≤ 420 px wide or ≤ 700 px tall, one line "Tue Oct 27 · 0 of 9 done" over "Preview: today is …"
check((/^\w+day, \w{3} \d{1,2}$/.test(dayl) || /^\w{3} \w{3} \d{1,2} · \d+ of \d+ done$/.test(dayl)) && ahead.length > 0, `preview label: ${dayl} / ${ahead}`);
check(!(await ev(`!!document.querySelector("[data-drive-late]")`)), "no late line before it's said");
await click("[data-drive-latepick]");
await sleep(300);
await shotAt("09-late-pick");
check(JSON.stringify(await text("[data-drive-lateby]")) === JSON.stringify(["+15 min", "+30 min", "+1 hour"]), "the three picks");
await click('[data-drive-lateby="30"]');
await waitFor(`!!document.querySelector("[data-drive-late]")`);
await sleep(1500);
check(await onScreen("[data-drive-late] b"), "the late line is on screen after the pick");
await shotAt("10-late-30");
const late = (await text("[data-drive-late] b"))[0] ?? "";
check(/^Running 30 min late\./.test(late), `late line: ${late}`);
report.late = (await text("[data-drive-late]"))[0];
check((await text("[data-drive-latepick]"))[0] === "Running late · +30 min", "the control says what was said");
await click("[data-drive-latepick]");
await click('[data-drive-lateby="0"]');
await sleep(500);
check(!(await ev(`!!document.querySelector("[data-drive-late]")`)), "On time again clears it");
await click("[data-drive-close]");
await sleep(800);
// ---- Your rules in Edit profile ----
await send("Page.navigate", { url: `${base}/app#/edit?${q}` });
await waitFor(`!!document.querySelector("#fd-rules")`, 30000);
await ev(`document.querySelector("#fd-rules").open = true; document.querySelector("#fd-rules").scrollIntoView({block: "center"})`);
await click("#r-avoid");
await send("Input.insertText", { text: "mocktail" });
await key2("Enter");
await sleep(600);
const rl = await text("#fd-rules .rlist li span");
check(rl[0] === "Never say “mocktail”", `rule added by Enter: ${rl.join(" | ")}`);
check(await ev(`/^#\\/(edit|new)/.test(location.hash) && !!document.querySelector("#fd-rules")`), `Enter didn't build the plan: ${await ev("location.hash")}`);
const saved = await ev(`JSON.parse(localStorage.getItem(${JSON.stringify(rulesKey(prof.brand))}) ?? "[]").map((r) => r.field + ":" + JSON.stringify(r.value))`);
check(saved.length === 1 && saved[0] === 'rule.avoid:"mocktail"', `stored as the brand's rule: ${saved}`);
await ev(`document.querySelector("#fd-rules").scrollIntoView({block: "center"})`);
await shotAt("11-rules");
// the plan reads it: the stop's talking points say a line is hidden, or at least no "mocktail" is left on the card
await send("Page.navigate", { url: `${base}/app#/plan?${q}` });
await waitFor(`!!document.querySelector(".stop[data-id]")`, 40000);
await sleep(1500);
await ev(`document.querySelector('.stop[data-id="${id1}"] [data-open]').click()`); // the list's drag handler takes a synthetic press
await waitFor(`!!document.querySelector(".stopview:not([hidden]) .atdoor, .stopview:not([hidden]) .dafter")`);
check(!/mocktail/i.test(await ev(`document.querySelector(".stopview:not([hidden])")?.textContent ?? ""`)), "the rule holds on the door card");
fs.writeFileSync(`${out}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
console.log(problems.length ? `problems:\n${problems.join("\n")}` : "problems none");
process.exit(problems.length && !before ? 1 : 0);
