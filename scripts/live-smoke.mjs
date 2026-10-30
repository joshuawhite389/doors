// Post-publish smoke: everything a judge hits on the live site, in a few minutes, each check PASS / FAIL / WARN / SKIP
// with its reason, then a table and an exit code (1 = a FAIL). Read-only and free by default: no Qloo call (the one
// /api/route it sends is a saved run, answered from KV with calls 0), no model call (the Agent check is a rule Doors
// answers itself; the tour's Agent and voice calls are stubbed in demo-cdp.mjs), no voice, nothing deployed. Steps for the Sunday run: LIVE-SMOKE.md.
// Usage: node scripts/live-smoke.mjs <base-url> [--out <dir>] [--sizes 390,1400] [--no-tour] [--live-model] [--secrets]
//   --live-model  one Doors Agent model turn (costs about a cent of Claude); off by default
//   --secrets     wrangler secret list on the deployed Worker (names only, never values) to see IP_SALT and
//                 ANTHROPIC_API_KEY are set; needs ~/.config/gigbot/{cloudflare-token,cloudflare-account-id}
// One Chromium at a time: run it under flock /tmp/claude-1000/headless.lock (LIVE-SMOKE.md).
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const argv = process.argv.slice(2);
const flag = (k) => argv.includes(k);
const opt = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const base = (argv.find((a, i) => !a.startsWith("--") && !["--out", "--sizes"].includes(argv[i - 1])) ?? "").replace(/\/+$/, "");
if (!/^https?:\/\//.test(base)) { console.error("usage: node scripts/live-smoke.mjs <base-url> [--out dir] [--sizes 390,1400] [--no-tour] [--live-model] [--secrets]"); process.exit(2); }
const out = opt("--out", `/tmp/claude-1000/live-smoke-${Date.now()}`);
fs.mkdirSync(out, { recursive: true });
const SIZES = { 320: 568, 375: 667, 390: 844, 1400: 900 };
const sizes = opt("--sizes", "390,1400").split(",").map(Number).filter((w) => SIZES[w]);
const origin = new URL(base).origin;
const t0 = Date.now();
const rows = [];
const res = (check, status, detail = "") => { rows.push({ check, status, detail: String(detail).replace(/\s+/g, " ").slice(0, 160) }); console.log(`${status.padEnd(4)} ${check}${detail ? ": " + rows.at(-1).detail : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (path, init = {}) => {
  const ctl = AbortSignal.timeout(20000);
  const r = await fetch(base + path, { redirect: "manual", signal: ctl, ...init });
  const body = init.method === "HEAD" ? "" : init.raw ? Buffer.from(await r.arrayBuffer()) : await r.text();
  return { status: r.status, h: r.headers, body };
};
// one check: a thrown error (network, timeout) is a FAIL with its message, never a crash
const check = async (name, fn) => { try { await fn(); } catch (e) { res(name, "FAIL", `${e.name === "TimeoutError" ? "timed out" : e.message}`); } };
const ourApi = []; // every /api request this script sends itself (the Qloo line names them)
// /data/index.json once; missing or broken is its own FAIL below, and the checks that read it fall back to Austin
let idx = null;
const index = async () => (idx ??= await get("/data/index.json").then((r) => JSON.parse(r.body)).catch(() => ({})));

// ---------- HTTP: pages, data, health ----------
let health = null;
await check("/api/health", async () => {
  const r = await get("/api/health");
  health = JSON.parse(r.body);
  ourApi.push("/api/health");
  if (r.status !== 200 || health.ok !== true) return res("/api/health", "FAIL", `${r.status} ${r.body.slice(0, 120)}`);
  res("/api/health", "PASS", `data ${health.data}, roads ${health.roads}, agent ${health.agent?.model}, live ${health.live?.ok ? "on" : `paused (${health.live?.reason})`}, Qloo used ${health.live?.used}/${health.live?.budget}`);
  // what the deploy should have: the Qloo key (data live), ORS (roads), Claude for the Agent (the owner sets ANTHROPIC_API_KEY after publish)
  const miss = [health.data !== "live" && `data is ${health.data} (no Qloo key?)`, health.roads !== "ors" && `roads ${health.roads} (no ORS key: straight-line estimates)`, health.agent?.model !== "anthropic" && `agent model ${health.agent?.model} (ANTHROPIC_API_KEY not set?)`, health.live?.ok !== true && `new live runs paused: ${health.live?.reason}`].filter(Boolean);
  res("keys and modes", miss.length ? "WARN" : "PASS", miss.length ? miss.join("; ") : "Qloo live, ORS roads, Claude agent, live runs on");
});
let landing = "";
await check("/ landing", async () => {
  const r = await get("/");
  landing = r.body;
  const ok = r.status === 200 && /^text\/html/.test(r.h.get("content-type") ?? "") && /<html/i.test(r.body);
  res("/ landing", ok ? "PASS" : "FAIL", `${r.status} ${r.h.get("content-type")} ${r.body.length} bytes`);
});
await check("link previews", async () => {
  const tag = (p) => new RegExp(`<meta (?:property|name)="${p}" content="([^"]*)"`).exec(landing)?.[1];
  const need = ["og:title", "og:description", "og:image", "og:url", "twitter:card", "twitter:image"];
  const missing = need.filter((p) => !tag(p));
  if (missing.length) return res("link previews", "FAIL", `missing ${missing.join(", ")}`);
  if (landing.includes("__ORIGIN__")) return res("link previews", "FAIL", "__ORIGIN__ left in the page (the Worker's handlePage did not run)");
  const img = tag("og:image");
  const local = (u) => u.replace("//localhost:", "//127.0.0.1:"); // the dev server (scripts/dev.mjs) names itself localhost
  if (!local(img).startsWith(local(origin))) return res("link previews", "FAIL", `og:image ${img} is not on ${origin}`);
  const r = await get(new URL(img).pathname, { raw: true });
  const png = r.status === 200 && r.body.subarray(1, 4).toString() === "PNG";
  res("link previews", png ? "PASS" : "FAIL", png ? `og/twitter tags on ${origin}; og:image ${r.body.length} bytes PNG` : `og:image answered ${r.status} ${r.h.get("content-type")}`);
});
for (const [path, test, why] of [
  ["/app", (r) => r.status === 200 && /<html/i.test(r.body) && !r.body.includes("__ORIGIN__"), "the app page"],
  ["/privacy", (r) => r.status === 200 && /privacy/i.test(r.body), "the privacy page the site links"],
  ["/data/index.json", (r) => { const j = JSON.parse(r.body); return r.status === 200 && j.brands?.length > 0 && j.cities?.length > 0; }, "the held brands and cities"],
  ["/data/demo/demo.json", (r) => r.status === 200 && r.body.length > 1000 && JSON.parse(r.body), "the guided tour's baked plan"],
  ["/manifest.webmanifest", (r) => r.status === 200 && JSON.parse(r.body).start_url, "install manifest"],
  ["/sw.js", (r) => r.status === 200 && /javascript/.test(r.h.get("content-type") ?? ""), "service worker script"],
]) await check(path, async () => { const r = await get(path); let ok = false; try { ok = Boolean(test(r)); } catch {} res(path, ok ? "PASS" : "FAIL", `${r.status} ${r.h.get("content-type") ?? ""} ${r.body.length} bytes · ${why}`); });
// /privacy.html: Cloudflare's static assets answer it 307 → /privacy (html_handling auto-trailing-slash; workerd
// 2026-10-24), and the TestFlight steps give App Store Connect /privacy.html: it still lands, one hop later
await check("/privacy.html", async () => {
  const r = await get("/privacy.html");
  if (r.status === 200) return res("/privacy.html", "PASS", `200 ${r.body.length} bytes · TestFlight's privacy URL`);
  const to = r.h.get("location");
  const f = to && r.status >= 300 && r.status < 400 ? await get(new URL(to, base + "/").pathname) : null;
  res("/privacy.html", f?.status === 200 ? "WARN" : "FAIL", f ? `${r.status} → ${to} (${f.status}): give App Store Connect ${origin}${to} so there is no redirect` : `${r.status}`);
});
// an example plan, as "your own plan from an example" opens it: the held route and city files (no Qloo)
await check("example plan files", async () => {
  const d = (await index()).default ?? { brand: "athletic-brewing", city: "austin" };
  const [route, city] = await Promise.all([get(`/data/routes/${d.brand}-${d.city}.json`), get(`/data/cities/${d.city}.json`)]);
  const ok = route.status === 200 && city.status === 200 && JSON.parse(route.body) && JSON.parse(city.body);
  res("example plan files", ok ? "PASS" : "FAIL", `routes/${d.brand}-${d.city}.json ${route.status} (${route.body.length} b), cities/${d.city}.json ${city.status}`);
});
// the map fallback: Protomaps tiles in byte ranges (src/tiles.js)
await check("map tiles (ranges)", async () => {
  const city = (await index()).cities?.[0]?.key ?? "austin";
  const r = await get(`/tiles/${city}.pmtiles`, { headers: { range: "bytes=0-15" }, raw: true });
  const ok = r.status === 206 && r.body.subarray(0, 7).toString() === "PMTiles" && /^bytes 0-15\//.test(r.h.get("content-range") ?? "");
  // a 200 here is the whole file for every range the map reads (workerd 2026-10-24: src/tiles.js saw no content-length)
  res("map tiles (ranges)", ok ? "PASS" : "FAIL", `/tiles/${city}.pmtiles bytes=0-15 → ${r.status} ${r.h.get("content-range") ?? "no content-range"}, ${r.body.length} bytes back`);
});

// ---------- headers ----------
await check("CORS on /api", async () => {
  const evil = "https://not-doors.example";
  const h1 = await get("/api/health", { headers: { origin: evil } });
  const pre = await get("/api/agent", { method: "OPTIONS", headers: { origin: evil, "access-control-request-method": "POST", "access-control-request-headers": "content-type" } });
  const post = await get("/api/agent", { method: "POST", headers: { origin: evil, "content-type": "application/json" }, body: JSON.stringify({ messages: [{ role: "user", text: "never say kombucha" }], context: {} }) });
  ourApi.push("/api/health", "/api/agent (OPTIONS)", "/api/agent (foreign origin)");
  const acao = [h1, pre, post].map((r) => r.h.get("access-control-allow-origin")).filter(Boolean);
  const bad = [acao.some((a) => a === "*" || a === evil) && `allow-origin ${acao.join(",")}`, post.status !== 403 && `a foreign-origin POST /api/agent answered ${post.status}, not 403`].filter(Boolean);
  res("CORS on /api", bad.length ? "FAIL" : "PASS", bad.length ? bad.join("; ") : `no allow-origin for a foreign origin; its Agent POST refused 403`);
});
await check("asset headers", async () => {
  const paths = ["/css/doors.css", "/vendor/maplibre-gl-5.24.0/maplibre-gl.js", "/data/index.json", "/og.png"];
  const rs = await Promise.all(paths.map((p) => get(p, { method: "HEAD" })));
  const bad = rs.map((r, i) => (r.status !== 200 ? `${paths[i]} ${r.status}` : !r.h.get("content-type") ? `${paths[i]} no content-type` : null)).filter(Boolean);
  const cc = rs.map((r, i) => `${paths[i].split("/").pop()}: ${r.h.get("cache-control") ?? "none"}`);
  const none = rs.filter((r) => !r.h.get("cache-control") && !r.h.get("etag")).length;
  res("asset headers", bad.length ? "FAIL" : none ? "WARN" : "PASS", bad.length ? bad.join("; ") : `${none ? `${none} with no cache-control or etag; ` : ""}${cc.join(" · ")}`);
});

// ---------- Doors Agent, rules (free) ----------
await check("Agent (rules)", async () => {
  const r = await get("/api/agent", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ messages: [{ role: "user", text: "never say kombucha" }], context: {} }) });
  ourApi.push("/api/agent (a rule: no model)");
  const j = JSON.parse(r.body);
  const ok = r.status === 200 && j.by === "rules" && /kombucha/.test(j.reply ?? "");
  res("Agent (rules)", ok ? "PASS" : "FAIL", `${r.status} by ${j.by}: ${(j.reply ?? j.error ?? r.body).slice(0, 90)}`);
});
if (flag("--live-model")) await check("Agent (model, --live-model)", async () => {
  const r = await get("/api/agent", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ messages: [{ role: "user", text: "In one sentence: what kind of bar should a new tequila brand pitch first?" }], context: {} }) });
  ourApi.push("/api/agent (model turn)");
  const j = JSON.parse(r.body);
  const ok = r.status === 200 && j.by && j.by !== "rules" && !j.resting;
  res("Agent (model, --live-model)", ok ? (j.by === "anthropic" ? "PASS" : "WARN") : "FAIL", `${r.status} by ${j.by}${j.model ? ` (${j.model})` : ""}${j.cost ? ` $${j.cost.usd ?? JSON.stringify(j.cost)}` : ""}${j.resting ? ` resting: ${j.message}` : ""}: ${(j.reply ?? "").slice(0, 80)}`);
});
else res("Agent (model)", "SKIP", "costs money: --live-model runs one turn");

// ---------- a pre-warmed saved run: answered from KV, 0 Qloo calls ----------
await check("saved run (0 Qloo)", async () => {
  const runs = JSON.parse((await get("/api/runs")).body).runs ?? [];
  ourApi.push("/api/runs");
  // only a listed run with its ref: the Worker finds it in KV and never starts a new run (src/worker.js handleRoute)
  const run = runs.find((x) => x.kind === "brand" && /^[0-9a-f]{16}$/.test(x.ref ?? "") && x.cityName && x.id);
  if (!run) return res("saved run (0 Qloo)", "WARN", `${runs.length} saved runs listed: no pre-warmed run to open (publish.sh uploads data/prewarm/)`);
  const r = await get("/api/route", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ kind: "brand", id: run.id, name: run.name, city: run.cityName, ref: run.ref }) });
  ourApi.push(`/api/route (saved ${run.name} × ${run.cityName})`);
  const lines = r.body.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return {}; } });
  const done = lines.find((l) => l.type === "done");
  const stops = lines.find((l) => l.type === "route")?.route;
  const ok = r.h.get("x-doors-cache") === "hit" && done?.ok && done.calls === 0;
  res("saved run (0 Qloo)", ok ? "PASS" : "FAIL", `${run.name} × ${run.cityName}: cache ${r.h.get("x-doors-cache")}, calls ${done?.calls}, ${stops ? "route in" : "no route"}; ${runs.length} saved runs`);
});

// ---------- browser: /app loads clean, the service worker registers ----------
async function browser(url, w, h, name) {
  const port = 9800 + Math.floor(Math.random() * 150);
  const prof = `/tmp/claude-1000/smoke-${port}`;
  const ch = spawn("chromium", ["--headless=new", `--remote-debugging-port=${port}`, "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--hide-scrollbars", `--window-size=${w},${h}`, `--user-data-dir=${prof}`, "about:blank"], { stdio: "ignore", detached: true });
  const kill = () => { try { process.kill(-ch.pid, "SIGKILL"); } catch {} try { fs.rmSync(prof, { recursive: true, force: true }); } catch {} };
  process.on("exit", kill);
  try {
    let ws;
    for (let i = 0; i < 50 && !ws; i++) { try { const p = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((x) => x.type === "page"); if (p) ws = new WebSocket(p.webSocketDebuggerUrl); } catch {} if (!ws) await sleep(200); }
    if (!ws) throw new Error("chromium did not start");
    await new Promise((r) => ws.addEventListener("open", r));
    let id = 0; const pend = new Map(); const errs = []; const api = []; const failed = [];
    ws.addEventListener("message", (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pend.has(m.id)) { pend.get(m.id)(m.result); pend.delete(m.id); }
      if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errs.push("console.error " + m.params.args.map((a) => a.value ?? a.description).join(" ").slice(0, 200));
      if (m.method === "Runtime.exceptionThrown") errs.push("exception " + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 200));
      if (m.method === "Log.entryAdded" && m.params.entry.level === "error") errs.push(`log ${m.params.entry.text} ${m.params.entry.url ?? ""}`.slice(0, 200));
      if (m.method === "Network.requestWillBeSent") { try { const u = new URL(m.params.request.url); if (u.origin === origin && u.pathname.startsWith("/api/")) api.push(u.pathname); } catch {} }
      if (m.method === "Network.responseReceived" && m.params.response.status >= 400 && m.params.response.url.startsWith(origin)) failed.push(`${m.params.response.status} ${new URL(m.params.response.url).pathname}`);
    });
    const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    const ev = async (expr) => (await send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true })).result?.value;
    for (const d of ["Runtime", "Page", "Network", "Log"]) await send(`${d}.enable`);
    await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: w < 700 });
    await send("Page.navigate", { url });
    await sleep(6000); // MapLibre and the first paint need real time
    const page = await ev(`(async () => {
      const sw = "serviceWorker" in navigator ? await Promise.race([navigator.serviceWorker.ready.then((r) => r.active?.state ?? "registered"), new Promise((r) => setTimeout(() => r("not ready after 8 s"), 8000))]) : "no serviceWorker API";
      const vis = (s) => { const e = document.querySelector(s); if (!e) return false; const b = e.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
      return { sw, title: document.title, h1: document.querySelector("h1")?.textContent?.trim().slice(0, 80) ?? null, text: document.body.innerText.length, wide: document.documentElement.scrollWidth > innerWidth + 1, build: vis("#build"), canvas: vis("canvas") };
    })()`);
    const { data } = await send("Page.captureScreenshot", { format: "png" });
    fs.writeFileSync(join(out, `${name}.png`), Buffer.from(data, "base64"));
    ws.close();
    return { ...page, errs, api, failed };
  } finally { kill(); }
}
const NO_API = /^\/api\/(route|search|voice|brief|agent|directions|matrix|geocode|sisters|door)/; // nothing a page load should send on its own
for (const [path, name] of [["/", "landing"], ["/app", "app"]]) for (const w of [390, 1400]) {
  const label = `browser ${path} @${w}`;
  await check(label, async () => {
    const p = await browser(base + path, w, SIZES[w], `${name}-${w}`);
    const bad = [!p.text && "blank page", p.wide && "scrolls sideways", ...p.errs, ...p.failed.map((f) => `HTTP ${f}`), ...p.api.filter((a) => NO_API.test(a)).map((a) => `sent ${a} on load`)].filter(Boolean);
    res(label, bad.length ? "FAIL" : "PASS", bad.length ? bad.slice(0, 4).join("; ") : `"${p.h1 ?? p.title}", ${p.text} chars, no console errors${p.api.length ? `, api: ${[...new Set(p.api)].join(" ")}` : ""}`);
    if (path === "/app" && w === 1400) res("service worker", p.sw === "activated" || p.sw === "activating" ? "PASS" : "FAIL", `sw ${p.sw}`);
  });
}

// ---------- the guided tour, end to end (scripts/demo-cdp.mjs: a visitor's clicks, every card) ----------
if (flag("--no-tour")) res("guided tour", "SKIP", "--no-tour");
else for (const w of sizes) {
  const label = `guided tour @${w}`;
  await check(label, async () => {
    let log = "";
    try { log = execFileSync("node", [new URL("demo-cdp.mjs", import.meta.url).pathname, base, join(out, `tour-${w}`), String(w), String(SIZES[w])], { encoding: "utf8", timeout: 240000 }); }
    catch (e) { log = `${e.stdout ?? ""}\nproblems the tour run failed: ${e.message.split("\n")[0]}`; }
    const problems = log.match(/^problems (.*)$/ms)?.[1].trim() ?? "no report (the run did not finish)";
    const fin = (() => { try { return JSON.parse(log.match(/^final (.*)$/m)?.[1] ?? "{}"); } catch { return {}; } })();
    const steps = (fin.steps ?? "").split(",").filter(Boolean).length;
    res(label, problems === "none" ? "PASS" : "FAIL", problems === "none" ? `${steps} steps, done ${fin.done}, ${fin.agent} Agent turns (answered free by demo-cdp's stub)` : problems.split("\n").slice(0, 3).join("; "));
    // Jard 10-29: the tour calls only Doors Agent and the Aura voice (as the app does; demo-cdp stubs them, so no
    // spend); the plan is baked, so no Qloo, ORS or plan-building call leaves the page
    const LIVE = /^\/api\/(agent(\/log-visit|\/debrief)?|voice\/(say|listen))$/;
    const net = fin.net ?? null;
    const stray = net ? net.filter((x) => !LIVE.test(x)) : null;
    if (net) res(`tour sent only Agent/voice /api @${w}`, stray.length ? "FAIL" : "PASS", stray.length ? `reached the network: ${[...new Set(stray)].join(" ")}` : `${net.length} Agent/voice requests (stubbed), no other /api; ${fin.blocked?.length ?? 0} refused in the page`);
    else res(`tour sent only Agent/voice /api @${w}`, "FAIL", "no network log from demo-cdp.mjs");
  });
}

// ---------- after: Qloo calls, IP hashing ----------
await check("Qloo calls by the smoke", async () => {
  const after = JSON.parse((await get("/api/health")).body);
  const d = (after.live?.used ?? 0) - (health?.live?.used ?? 0);
  if (after.live?.used == null) return res("Qloo calls by the smoke", "SKIP", "health shows no count (no Qloo key here)");
  // the live counter is the site's, not ours: another visitor's run moves it too
  res("Qloo calls by the smoke", d === 0 ? "PASS" : "WARN", d === 0 ? `month count unchanged at ${after.live.used}` : `month count rose by ${d}; this script sent only: ${[...new Set(ourApi)].join(", ")} (a visitor's run counts here too)`);
});
if (flag("--secrets")) await check("secrets set", async () => {
  const C = join(homedir(), ".config/gigbot");
  const env = { ...process.env, CLOUDFLARE_API_TOKEN: fs.readFileSync(join(C, "cloudflare-token"), "utf8").trim(), CLOUDFLARE_ACCOUNT_ID: fs.readFileSync(join(C, "cloudflare-account-id"), "utf8").trim() };
  const list = execFileSync("npx", ["-y", "wrangler@4", "secret", "list", "--name", "doors"], { env, encoding: "utf8", timeout: 90000, stdio: ["ignore", "pipe", "pipe"] });
  const want = ["QLOO_API_KEY", "IP_SALT", "ANTHROPIC_API_KEY"];
  const miss = want.filter((n) => !new RegExp(`\\b${n}\\b`).test(list));
  res("secrets set", miss.length ? (miss.includes("QLOO_API_KEY") ? "FAIL" : "WARN") : "PASS", miss.length ? `not set: ${miss.join(", ")}${miss.includes("IP_SALT") ? " (visitor IPs hash with the Qloo-key salt)" : ""}` : `${want.join(", ")} set (names only)`);
});
else res("IP hashing (IP_SALT)", "SKIP", "not checkable from outside (no response shows it); --secrets lists the Worker's secret names");

// ---------- table ----------
const secs = Math.round((Date.now() - t0) / 1000);
res("run time", secs <= 300 ? "PASS" : "WARN", `${secs} s (target under 300)`);
const w1 = Math.max(...rows.map((r) => r.check.length));
console.log(`\nDoors live smoke · ${base} · ${new Date().toISOString().slice(0, 16)}Z · screenshots ${out}\n`);
for (const r of rows) console.log(`${r.status.padEnd(4)}  ${r.check.padEnd(w1)}  ${r.detail}`);
const n = (s) => rows.filter((r) => r.status === s).length;
console.log(`\n${n("PASS")} pass, ${n("FAIL")} fail, ${n("WARN")} warn, ${n("SKIP")} skip`);
fs.writeFileSync(join(out, "result.json"), JSON.stringify({ base, at: new Date().toISOString(), secs, rows }, null, 1));
process.exit(n("FAIL") ? 1 : 0);
