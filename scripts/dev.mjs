// Local dev server: runs the Worker's fetch handler under Node and serves public/.
// Usage: node scripts/dev.mjs [port]   (default 8789; SAMPLE=1 for offline fixtures)   (reads QLOO_API_KEY / GEMINI_API_KEY / ANTHROPIC_API_KEY / ORS_API_KEY from env or ~/.config/gigbot/*; WORKERS_AI=1 adds Workers AI over REST)
import { modelEnv } from "./dev/model-env.mjs";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import worker from "../src/worker.js";
import { makeLedger } from "../src/ledger.js";

const root = new URL("../public/", import.meta.url).pathname;
const keyFile = (n) => {
  const p = join(homedir(), ".config/gigbot", n);
  return existsSync(p) ? readFileSync(p, "utf8").trim() : undefined;
};
const env = {
  QLOO_API_KEY: process.env.QLOO_API_KEY ?? (process.env.SAMPLE ? undefined : keyFile("qloo-key")),
  GEMINI_API_KEY: modelEnv(process.env, keyFile).gemini, // SAMPLE=1 / NO_MODEL=1: no model, from any path
  GEMINI_MODEL: process.env.GEMINI_MODEL,
  // Doors Agent: Anthropic first (~/.config/gigbot/anthropic-key, never printed); AGENT_MODEL=claude-opus-5-5 or claude-haiku-5-5 to switch (Sonnet since round 3)
  ANTHROPIC_API_KEY: modelEnv(process.env, keyFile).anthropic,
  AGENT_MODEL: process.env.AGENT_MODEL,
  // WORKERS_AI=1: the chat agent's Cloudflare Workers AI binding over REST (scripts/dev/workers-ai-rest.mjs; the account
  // token from ~/.config/gigbot, never printed). NO_MODEL=1 WORKERS_AI=1 = Workers AI alone, as on a day Gemini 429s.
  AI: modelEnv(process.env, keyFile).workersAi ? (await import("./dev/workers-ai-rest.mjs")).workersAiRest() : undefined,
  WORKERS_AI_MODELS: process.env.WORKERS_AI_MODELS,
  // Other origins whose pages may call this server (src/guard.js originOk; comma-separated). Jard's phone reaches the
  // dev server as https://jard-ser.tail571c53.ts.net:8446 (tailscale serve → http://100.90.129.66:8793): the request's
  // own origin is the http one, so the https Origin needs listing or every /api/voice/* answer is 403.
  ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
  DEV_UNLIMITED_LOCAL: process.env.DEV_LIMIT_LOCAL ? undefined : "1", // local jobs share 127.0.0.1: no per-visitor run cap here (DEV_LIMIT_LOCAL=1 to see it)
  BUILD_BUDGET: process.env.BUILD_BUDGET, // the build's Qloo ceiling (default 34,000); set lower to see live runs rest
  // OpenRouteService (road routing + geocoding); without it every distance is the labelled straight-line estimate.
  ORS_API_KEY: process.env.ORS_API_KEY ?? (process.env.SAMPLE || process.env.NO_ORS ? undefined : keyFile("ors-key")),
  // Every real Qloo request from the dev server goes in the build's ledger (budget 34,000 a month).
  QLOO_LEDGER: (() => {
    const l = makeLedger(new URL("../data/ledger.jsonl", import.meta.url).pathname, { source: "dev", onWarn: (n) => console.log(`!! ledger at ${n}`) });
    return (e) => l.record(e);
  })(),
  // The Worker's budget check reads the ledger file in dev (it already includes the precompute).
  LEDGER_COUNT: async (month) => (await import("../src/ledger.js")).ledgerCount((await import("../src/ledger.js")).readLedger(new URL("../data/ledger.jsonl", import.meta.url).pathname), month),
  // Dev only: identical live requests are answered from data/raw-live/ instead of spending a second call.
  QLOO_FETCH: async (u, init = {}) => {
    const dir = new URL("../data/raw-live/", import.meta.url).pathname;
    mkdirSync(dir, { recursive: true });
    const f = join(dir, createHash("sha256").update(`${init.method ?? "GET"} ${u} ${init.body ?? ""}`).digest("hex").slice(0, 24) + ".json");
    if (existsSync(f)) return new Response(readFileSync(f, "utf8"), { status: 200, headers: { "content-type": "application/json", "x-doors-dev-cache": "1" } });
    const res = await fetch(u, init);
    const text = await res.text();
    // what Qloo says about its limits and their reset, from real requests only (data/qloo-headers.jsonl, private)
    const lim = [...res.headers].filter(([k]) => /limit|reset|quota|remaining|retry/i.test(k));
    if (lim.length) appendFileSync(new URL("../data/qloo-headers.jsonl", import.meta.url).pathname, JSON.stringify({ ts: new Date().toISOString(), status: res.status, path: new URL(u).pathname, headers: Object.fromEntries(lim) }) + "\n");
    if (res.ok) writeFileSync(f, text);
    return new Response(text, { status: res.status, headers: res.headers });
  },
  // KV stand-in (files in data/kv-dev/, never committed): the Worker keeps live runs, the counter and ORS answers
  // in KV. A value's key and metadata sit beside it (<hash>.meta), so list() works as on Cloudflare (the saved runs).
  DOORS_KV: (() => {
    const dir = new URL("../data/kv-dev/", import.meta.url).pathname;
    mkdirSync(dir, { recursive: true });
    const f = (k) => join(dir, createHash("sha256").update(k).digest("hex").slice(0, 24) + ".json");
    return {
      async get(k, type) {
        if (!existsSync(f(k))) return null;
        const t = readFileSync(f(k), "utf8");
        return type === "json" ? JSON.parse(t) : t;
      },
      async put(k, v, o = {}) {
        writeFileSync(f(k), typeof v === "string" ? v : JSON.stringify(v));
        writeFileSync(f(k).replace(/\.json$/, ".meta"), JSON.stringify({ name: k, metadata: o.metadata ?? null }));
      },
      async list({ prefix = "" } = {}) {
        const keys = readdirSync(dir).filter((x) => x.endsWith(".meta")).map((x) => JSON.parse(readFileSync(join(dir, x), "utf8"))).filter((m) => m.name.startsWith(prefix));
        return { keys: keys.map((m) => ({ name: m.name, ...(m.metadata ? { metadata: m.metadata } : {}) })), list_complete: true };
      },
    };
  })(),
  ASSETS: {
    async fetch(req) {
      let path = new URL(req.url).pathname;
      if (path.endsWith("/")) path += "index.html";
      let file = normalize(join(root, path));
      // like Workers assets' html_handling: /app serves app.html
      if (!extname(file) && existsSync(file + ".html")) file += ".html";
      if (!file.startsWith(root) || !existsSync(file)) return new Response("not found", { status: 404 });
      const types = { ".html": "text/html; charset=utf-8", ".jpg": "image/jpeg", ".webp": "image/webp", ".csv": "text/csv", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".pmtiles": "application/octet-stream" };
      const body = await readFile(file);
      const headers = { "content-type": types[extname(file)] ?? "application/octet-stream", "accept-ranges": "bytes" };
      // Range requests: the Protomaps fallback reads public/tiles/<city>.pmtiles in byte ranges
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get("range") ?? "");
      if (range && (range[1] || range[2])) {
        const size = body.length;
        let a = range[1] ? +range[1] : size - +range[2];
        let b = range[1] && range[2] ? Math.min(+range[2], size - 1) : size - 1;
        a = Math.max(0, a);
        if (a > b || a >= size) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
        return new Response(body.subarray(a, b + 1), { status: 206, headers: { ...headers, "content-range": `bytes ${a}-${b}/${size}`, "content-length": String(b - a + 1) } });
      }
      return new Response(body, { headers });
    },
  },
};
const port = Number(process.argv[2] ?? 8789);
createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  // R9 RN: with HOST set, the request keeps the Host the phone used, so its Origin (the Worker's own, CONTRACTS-R9 §0) matches
  const request = new Request(`http://${process.env.HOST && req.headers.host ? req.headers.host : `localhost:${port}`}${req.url}`, { method: req.method, headers: req.headers, body: chunks.length ? Buffer.concat(chunks) : undefined });
  const pending = [];
  const response = await worker.fetch(request, env, { waitUntil: (p) => pending.push(p) });
  res.writeHead(response.status, Object.fromEntries(response.headers));
  if (response.body) for await (const chunk of response.body) res.write(chunk);
  res.end();
// R9 RN: HOST=0.0.0.0 lets a phone on the LAN reach this dev server (use with SAMPLE=1: no keys on the LAN)
}).listen(port, process.env.HOST ?? "127.0.0.1", () => console.log(`Doors dev on http://127.0.0.1:${port}  data=${env.QLOO_API_KEY ? "live" : "sample"} model=${[env.ANTHROPIC_API_KEY && (env.AGENT_MODEL || "claude-sonnet-5-5"), env.GEMINI_API_KEY && "gemini", env.AI && "workers-ai"].filter(Boolean).join("+") || "fixed plan"} roads=${env.ORS_API_KEY ? "ors" : "estimate"}`));
