// Round 3 enrich lane: bake the per-door enrichment records (public/lib/enrich.js) into public/data/enrich/<city>.json
// for the doors the demo, the examples and the city files hold.
//   node scripts/enrich-bake.mjs --city=austin|all [--tier=demo|all] [--qloo] [--sites] [--only=id,id] [--max-calls=N]
//                                [--max-sites=N] [--dry] [--redo] [--model=claude-sonnet-5-5] [--concurrency=4] [--via=claude-code]
//   node scripts/enrich-bake.mjs --prewarm [--city=<key>|all] [--top=40] --qloo [--floor=12000]
//       qloofull (Jard 10-27): the SAVED RUNS' cities (data/prewarm/*.json): the top N doors of every run in a city
//       (what the planner fills first) → public/data/enrich/<city.key>.json, read by the page for that run (stop.js);
//       --floor stops when Qloo's month drops under it (the judging reserve), default 30,000 for the held bake.
// tier demo = every door with a baked talking-point set (public/data/talk/<city>.json) plus the guided demo's plan
// (public/data/demo/demo.json); tier all = every door in the city's route files (public/data/routes/*-<city>.json).
// --qloo: the Qloo half (src/enrich.js enrichQloo: 4 calls a door, 1 for a door Qloo won't take as a signal), raw
// bodies cached under data/raw (gitignored, place-fill's key scheme) so a re-run asks nothing twice; every request in
// data/ledger.jsonl (source "enrich"); stops at the first 429 or when Qloo's month drops under 30,000.
// --sites: the website half (fetchSite + extractSite): robots.txt, 2 s a host, pages to the model, quotes checked;
// every model call in data/enrich-sites.jsonl with its $.
// After either half, vsCity is computed over every door in the city file and written back (pure).
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { QlooClient, quota } from "../src/qloo.js";
import { makeLedger } from "../src/ledger.js";
import { anthropicSession } from "../src/llm.js";
import { makeClaudeCodeFetch, ccLimitHit } from "./claude-code-fetch.mjs";
import { usdOf } from "../src/spend.js";
import { enrichQloo, enrichSite, enrichRecord, makeSiteFetcher, SITE_MODEL, SITE_FORMAT } from "../src/enrich.js";
import { vsCity, slimRecord, ENRICH_VERSION, ENRICH_NOTE, emptyEnrich } from "../public/lib/enrich.js";

const ROOT = new URL("..", import.meta.url).pathname;
const RAW = join(ROOT, "data/raw");
const OUT = join(ROOT, "public/data/enrich");
mkdirSync(RAW, { recursive: true });
mkdirSync(OUT, { recursive: true });
const args = process.argv.slice(2);
const flag = (n, d = null) => args.find((a) => a.startsWith(`--${n}=`))?.split("=").slice(1).join("=") ?? (args.includes(`--${n}`) ? true : d);
const CITY = String(flag("city", "austin"));
const TIER = String(flag("tier", "demo"));
const DO_QLOO = Boolean(flag("qloo"));
const DO_SITES = Boolean(flag("sites"));
const ONLY = typeof flag("only") === "string" ? flag("only").split(",").map((s) => s.toUpperCase()) : null;
const MAX_CALLS = Number(flag("max-calls", 20000));
const MAX_SITES = Number(flag("max-sites", 100000));
const DRY = Boolean(flag("dry"));
const REDO = Boolean(flag("redo"));
const MODEL = String(flag("model", SITE_MODEL));
const CONC = Number(flag("concurrency", 4));
const PREWARM = Boolean(flag("prewarm"));
const TOPN = Number(flag("top", 40));
const FLOOR = Number(flag("floor", 30000));
const TODAY = new Date().toISOString().slice(0, 10);
const readJson = (rel) => JSON.parse(readFileSync(join(ROOT, rel), "utf8"));
// the saved runs by city key (route.city.key: the city as the run was typed, slugified), most runs first
function prewarmRuns() {
  const dir = typeof flag("dir") === "string" ? (flag("dir").startsWith("/") ? flag("dir") : join(ROOT, flag("dir"))) : join(ROOT, "data/prewarm"); // --dir=data/prewarm-dev: Jard's dev KV runs
  if (!existsSync(dir)) return {};
  const by = {};
  for (const f of readdirSync(dir).filter((x) => /^[0-9a-f]{24}\.json$/.test(x)).sort()) {
    const row = JSON.parse(readFileSync(join(dir, f), "utf8"));
    const rt = row.value?.route;
    if (!rt?.city?.key) continue;
    (by[rt.city.key] ??= []).push(rt);
  }
  return by;
}
const PREWARM_RUNS = PREWARM ? prewarmRuns() : {};
const CITIES = PREWARM ? (CITY === "all" || CITY === "austin" && !flag("city") ? Object.keys(PREWARM_RUNS).sort((a, b) => PREWARM_RUNS[b].length - PREWARM_RUNS[a].length || a.localeCompare(b)) : [CITY]) : CITY === "all" ? ["austin", "boise", "chicago", "omaha"] : [CITY];

// ---------- Qloo plumbing (place-fill's) ----------
const ledger = makeLedger(join(ROOT, "data/ledger.jsonl"), { source: "enrich" });
let limited = 0; // 429s seen this run
let sent = 0;
let stop = null;
let qloo;
const client = () => (qloo ??= new QlooClient({
  apiKey: process.env.QLOO_API_KEY ?? readFileSync(join(homedir(), ".config/gigbot/qloo-key"), "utf8").trim(),
  minGapMs: Number(flag("gap", 300)), // --gap=ms between request starts (several bakes at once share Qloo's 10 a second)
  retryBudget: 2, // a 429 gets two jittered retries (src/qloo.js); several fills share Qloo's 10 a second
  onLedger: (e) => {
    sent++;
    ledger.record(e);
    if (e.status === 429 && ++limited >= 12) stop = "Qloo answered 429 twelve times";
    if (typeof e.remaining === "number" && e.remaining < FLOOR) stop = `Qloo's month is at ${e.remaining} calls left (floor ${FLOOR})`;
  },
}));
const rawKey = (params) => createHash("sha256").update(`GET /v2/insights ${JSON.stringify(params)}`).digest("hex").slice(0, 24);
let would = 0;
async function get(params) {
  const f = join(RAW, `${rawKey(params)}.json`);
  if (existsSync(f)) {
    const j = JSON.parse(readFileSync(f, "utf8"));
    if (j.body) return j.body;
    const err = Object.assign(new Error(j.error ?? "cached error"), { status: /Qloo (\d{3})/.exec(j.error ?? "")?.[1] ? Number(/Qloo (\d{3})/.exec(j.error)[1]) : undefined });
    throw err;
  }
  if (DRY) {
    would++;
    throw Object.assign(new Error("dry run"), { dry: true });
  }
  if (stop) throw Object.assign(new Error(stop), { stopped: true });
  if (sent >= MAX_CALLS) throw Object.assign(new Error((stop = `the ${MAX_CALLS}-call limit`)), { stopped: true });
  ledger.assertBudget(1);
  try {
    const body = await client().insights(params);
    writeFileSync(f, JSON.stringify({ label: "enrich", method: "GET", path: "/v2/insights", params, at: new Date().toISOString(), body }));
    return body;
  } catch (e) {
    if (e.status && e.status < 500 && e.status !== 429) writeFileSync(f, JSON.stringify({ label: "enrich", method: "GET", path: "/v2/insights", params, at: new Date().toISOString(), error: e.message.slice(0, 300), body: null }));
    throw e;
  }
}

// ---------- the doors of a city ----------
function doorsOf(city) {
  if (PREWARM) {
    // the top N of every saved run in this city, each door's record from the run that ranks it
    const venues = {};
    const set = new Set();
    for (const rt of PREWARM_RUNS[city] ?? []) {
      for (const [id] of (rt.lists?.all ?? []).slice(0, TOPN)) if (rt.venues?.[id]) (set.add(id), (venues[id] ??= rt.venues[id]));
    }
    let ids = [...set];
    if (ONLY) ids = ids.filter((id) => ONLY.includes(id.toUpperCase()));
    return { ids, venues };
  }
  const routes = readdirSync(join(ROOT, "public/data/routes")).filter((f) => f.endsWith(`-${city}.json`)).map((f) => readJson(`public/data/routes/${f}`));
  const cityFile = readJson(`public/data/cities/${city}.json`);
  const venues = {};
  for (const r of routes) for (const [id, v] of Object.entries(r.venues ?? {})) venues[id] ??= v;
  for (const [id, v] of Object.entries(cityFile.sisterVenues ?? {})) venues[id] ??= v;
  let ids;
  if (TIER === "all") ids = Object.keys(venues).filter((id) => routes.some((r) => r.venues?.[id]));
  else {
    const set = new Set();
    const talk = existsSync(join(ROOT, `public/data/talk/${city}.json`)) ? readJson(`public/data/talk/${city}.json`) : { sets: {} };
    for (const k of Object.keys(talk.sets ?? {})) set.add(k.split("|")[0].toUpperCase());
    if (city === "austin") for (const st of readJson("public/data/demo/demo.json").states ?? []) for (const d of st.days ?? []) for (const id of d.ids ?? []) set.add(id);
    ids = [...set];
  }
  ids = ids.filter((id) => venues[id]);
  if (ONLY) ids = ids.filter((id) => ONLY.includes(id.toUpperCase()));
  return { ids, venues };
}
// The FULL records (30 brands, 30 drink brands, every tag) are build data: data/enrich/<city>.json (private, tracked).
// The page loads the SLIM copy: public/data/enrich/<city>.json, the same shape with the long lists cut (slimRecord),
// so a city file stays near 1 MB instead of 4–7.
const FULL = join(ROOT, "data/enrich");
mkdirSync(FULL, { recursive: true });
const outFile = (city) => join(FULL, `${city}.json`);
const slimFile = (city) => join(OUT, `${city}.json`);
const readOut = (city) => (existsSync(outFile(city)) ? JSON.parse(readFileSync(outFile(city), "utf8")) : existsSync(slimFile(city)) ? JSON.parse(readFileSync(slimFile(city), "utf8")) : { v: ENRICH_VERSION, city, baked: TODAY, note: ENRICH_NOTE, calls: 0, doors: {} });
// Two bakes may run at once (the Qloo half and the website half): a write re-reads the file and puts in only the halves
// this run touched (touched.qloo / touched.site ids), so neither clobbers the other's work.
const touched = { qloo: new Set(), site: new Set() };
function writeOut(city, out) {
  const disk = readOut(city);
  for (const [id, rec] of Object.entries(out.doors)) {
    const d = disk.doors[id] ?? { ...emptyEnrich(id, rec.name), at: rec.at };
    if (touched.qloo.has(id)) (d.qloo = rec.qloo), (d.at = rec.at);
    if (touched.site.has(id)) d.site = rec.site;
    disk.doors[id] = d;
  }
  disk.calls = Math.max(disk.calls ?? 0, out.calls ?? 0);
  const v = vsCity(disk.doors);
  for (const id of Object.keys(disk.doors)) disk.doors[id].vsCity = v[id] ?? null;
  disk.baked = TODAY;
  disk.note = ENRICH_NOTE;
  if (!DRY) {
    writeFileSync(outFile(city), JSON.stringify(disk));
    writeFileSync(slimFile(city), JSON.stringify({ ...disk, doors: Object.fromEntries(Object.entries(disk.doors).map(([id, r]) => [id, slimRecord(r)])) }));
  }
  out.doors = disk.doors;
}

// ---------- run ----------
async function pool(items, n, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.max(1, n) }, async () => {
    while (i < items.length) {
      const it = items[i++];
      try {
        await fn(it);
      } catch (e) {
        console.log(`  ! ${String(e?.message ?? e).slice(0, 140)}`);
      }
    }
  });
  await Promise.all(workers);
}

const SITE_LOG = join(ROOT, "data/enrich-sites.jsonl");
let siteStop = null; // why the website half stopped early (billing/limits); the run exits 2 and the same command resumes it
const isBillingStop = (m) => /Anthropic (402|403)|credit balance|billing|usage limit|spending|monthly (cap|limit)|exceeded your|insufficient|organization.*limit|API key.*(revoked|invalid)|Anthropic 401/i.test(m);
const isTransient = (m) => /Anthropic (429|5\d\d)|overloaded|timeout|aborted|fetch failed|ECONN|socket/i.test(m);
let siteUsd = 0, siteCalls = 0, siteOk = 0, siteNone = 0;
const key = () => process.env.ANTHROPIC_API_KEY ?? readFileSync(join(homedir(), ".config/gigbot/anthropic-key"), "utf8").trim();
// --via=claude-code (Jard 10-27): the site reads go through headless Claude Code on the owner's Max plan instead of the
// API key (scripts/claude-code-fetch.mjs): same prompt, schema and quote checks; the $ it counts is the CLI's report,
// not a charge. Page fetching is ours either way (fetchSite: robots, one request a host every 2 s).
const VIA_CC = flag("via") === "claude-code";
const makeModel = () => anthropicSession({ apiKey: VIA_CC ? "max-plan" : key(), ...(VIA_CC ? { fetchImpl: makeClaudeCodeFetch({ timeoutMs: 300000 }) } : {}), model: MODEL, effort: "low", maxTokens: 3000, format: SITE_FORMAT, timeoutMs: VIA_CC ? 300000 : 90000, onUsage: (u, m) => { const usd = usdOf(u, m); siteUsd += usd; siteCalls++; } });

for (const city of CITIES) {
  const { ids, venues } = doorsOf(city);
  const out = readOut(city);
  console.log(`\n${city}: ${ids.length} doors (tier ${TIER}); ${Object.keys(out.doors).length} already in the file`);
  if (DO_QLOO) {
    let done = 0, basis = { door: 0, area: 0, none: 0 }, skipped = 0;
    for (const id of ids) {
      if (stop) break;
      const v = venues[id];
      const have = out.doors[id];
      if (have?.qloo && have.qloo.basis !== "none" && !REDO) {
        skipped++;
        continue;
      }
      let r;
      try {
        r = await enrichQloo({ get, door: { id, name: v.name, lat: v.lat, lon: v.lon } });
      } catch (e) {
        if (e.dry) {
          continue;
        }
        if (e.stopped) break;
        console.log(`  x ${v.name}: ${String(e.message).slice(0, 120)}`);
        continue;
      }
      const prev = out.doors[id] ?? emptyEnrich(id, v.name);
      out.doors[id] = { ...enrichRecord({ door: { id, name: v.name }, qloo: r.qloo, site: prev.site ?? null, today: TODAY }), vsCity: null };
      touched.qloo.add(id);
      out.calls = (out.calls ?? 0) + r.qloo.calls;
      basis[r.qloo.basis]++;
      done++;
      if (r.errors.length) console.log(`  ~ ${v.name}: ${r.errors.join("; ").slice(0, 160)}`);
      if (done % 25 === 0) {
        console.log(`  ${done} doors · ${sent} calls sent · month left ${quota.monthRemaining ?? "?"} · basis ${JSON.stringify(basis)}`);
        writeOut(city, out);
      }
    }
    writeOut(city, out);
    console.log(`  qloo: ${done} doors enriched (${skipped} kept), basis ${JSON.stringify(basis)}, ${sent} calls sent${DRY ? `, would send ~${would}+` : ""}${stop ? `, stopped: ${stop}` : ""}`);
  }
  if (DO_SITES) {
    const fetcher = makeSiteFetcher();
    const make = DRY ? null : makeModel();
    // a door is read again on a re-run only when its last try was a transient failure (the model, the network); a
    // read site or a final reason (robots, thin, http 404, skipped host) stays
    const todo = ids.filter((id) => venues[id]?.website && (REDO || !out.doors[id]?.site || (out.doors[id].site.ok === false && /timeout|fetch:|model:/.test(out.doors[id].site.reason ?? "")))).slice(0, MAX_SITES);
    console.log(`  sites: ${todo.length} doors with a website to read (${ids.filter((id) => !venues[id]?.website).length} have none)`);
    let n = 0;
    await pool(todo, CONC, async (id) => {
      if (siteStop) return;
      const v = venues[id];
      if (DRY) return void console.log(`  would read ${v.name}: ${v.website}${v.menu ? ` + ${v.menu}` : ""}`);
      let site = null;
      for (let attempt = 0; attempt < 3 && !siteStop; attempt++) {
        try {
          site = await enrichSite({ door: { id, name: v.name, website: v.website, menu: v.menu }, fetcher, make, model: MODEL, today: TODAY });
          break;
        } catch (e) {
          const msg = String(e?.message ?? e);
          if (ccLimitHit()) {
            // the Max plan's limit (scripts/claude-code-fetch.mjs): stop the whole run now, never retry through it
            siteStop = `claude -p hit the plan's limit: ${ccLimitHit().slice(0, 160)}`;
            return;
          }
          if (isBillingStop(msg)) {
            // the Console's monthly cap, or the credit: stop here, cleanly; the file holds every door read so far
            siteStop = `the model refused for billing/limits: ${msg.slice(0, 160)}`;
            return;
          }
          if (attempt < 2 && isTransient(msg)) {
            console.log(`  ~ ${v.name}: ${msg.slice(0, 100)} (retry ${attempt + 1} in ${20 * (attempt + 1)} s)`);
            await new Promise((r) => setTimeout(r, 20000 * (attempt + 1)));
            continue;
          }
          site = { url: v.website, menuUrl: v.menu ?? null, fetched: TODAY, ok: false, reason: `model: ${msg.slice(0, 120)}`, model: MODEL, facts: [] };
          console.log(`  x ${v.name}: ${msg.slice(0, 120)}`);
          break;
        }
      }
      if (siteStop && !site) return;
      const rec = out.doors[id] ?? { ...emptyEnrich(id, v.name), at: TODAY };
      rec.site = site;
      out.doors[id] = rec;
      touched.site.add(id);
      if (site?.ok) siteOk++;
      else siteNone++;
      appendFileSync(SITE_LOG, JSON.stringify({ at: new Date().toISOString(), city, id, name: v.name, url: site?.url, ok: site?.ok ?? false, reason: site?.reason ?? null, pages: site?.pages?.length ?? 0, facts: site?.facts?.length ?? 0, dropped: site?.dropped ?? 0, model: site?.ok ? MODEL : null, usd: siteUsd }) + "\n");
      n++;
      writeOut(city, out); // every door: a stop or a crash loses nothing
      if (n % 10 === 0) console.log(`  ${n}/${todo.length} sites · ${siteOk} read · ${siteNone} nothing · $${siteUsd.toFixed(2)}`);
    });
    writeOut(city, out);
    console.log(`  sites: ${siteOk} read, ${siteNone} nothing, ${siteCalls} model calls, $${siteUsd.toFixed(2)}${siteStop ? ` · STOPPED: ${siteStop}` : ""}`);
    if (siteStop) break;
  }
  if (!DO_QLOO && !DO_SITES) writeOut(city, out), console.log("  vsCity recomputed only");
  const recs = Object.values(out.doors);
  console.log(`  file: ${recs.length} doors · basis door ${recs.filter((r) => r.qloo?.basis === "door").length}, area ${recs.filter((r) => r.qloo?.basis === "area").length}, none ${recs.filter((r) => r.qloo?.basis === "none").length} · sites read ${recs.filter((r) => r.site?.ok).length}`);
}
console.log(`\nledger ${ledger.count} this month · Qloo month left ${quota.monthRemaining ?? "?"} · site $${siteUsd.toFixed(2)}`);
if (siteStop) {
  console.log(`STOPPED (website half): ${siteStop}\nEvery door read so far is in public/data/enrich/<city>.json. Resume with the same command once the cap is raised: node scripts/enrich-bake.mjs --city=${CITY} --tier=${TIER} --sites`);
  process.exit(2);
}
