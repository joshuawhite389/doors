// Talking points for the SAVED RUNS' top doors (data/prewarm/*.json: the popular brand × city runs a judge opens first)
// through headless Claude Code on the owner's Max plan: no API key, no credit (Jard 10-27). The same path as
// scripts/talk-bake.mjs (lib/stopmodel.js → talkReq → src/talk.js talkTurn: g6 prompt, schema, checks, retries), with
// scripts/claude-code-fetch.mjs standing in for the API.
//   node scripts/talk-max.mjs --all [--par=2] [--top=25] [--from=26] [--until=2026-10-30T08:00] [--limit=N] [--redo] [--dry]
//       every saved run, biggest cities first; --from/--top = the doors' rank range on the run's list (gigbot 10-27: pass 1
//       = top 25 of every run, pass 2 = 26–40); --until = a hard stop (local time): the run ends cleanly at the next door
//   node scripts/talk-max.mjs --run=<prewarm hash | "Brand|City"> [--top=40] [--public]  one run (the pilot; data/talk-max/ unless --public)
//   node scripts/talk-max.mjs --compare=maya --doors="Pinthouse Brewing,Sagebrush"      an example's own doors, same facts as the API bake
// The rep is the demo profile (lib/examples.js maya: Tidewell, its ask) with the run's drinker brand (gigbot 10-27,
// option a: judges open a saved run as-is; a changed product falls back to the live path). Sets go to
// public/data/talk/<city>.json under the drinker-aware key (lib/talk-gen.js bakedTalkKey drinkers: true), because a
// door's facts change with the drinker. Resumable: a set whose facts key is today's is skipped.
// SAFETY: the first usage-limit answer from claude -p ends the run (exit 2, "STOP:"); nothing retries through it.
// Ledger: data/talk-max.jsonl, one line a door with its wall ms and the CLI's reported $ (informational on Max).
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { examples } from "../public/lib/examples.js";
import { ROOMS } from "../public/lib/profile.js";
import { buildPool, windowsFor } from "../public/lib/pool.js";
import { planDays } from "../public/lib/schedule.js";
import { stopModel } from "../public/lib/stopmodel.js";
import { talkUser, bakedTalkKey, validateTalkSet, talkKey } from "../public/lib/talk-gen.js";
import { talkTurn } from "../src/talk.js";
import { enrichFacts } from "../public/lib/enrich.js";
import { deepFactsFor } from "../public/lib/deep.js";
import { makeClaudeCodeFetch, ccCalls, ccLimitHit } from "./claude-code-fetch.mjs";
import { savedRuns, RUN_TOP } from "./saved-runs.mjs";

const STOP_ERROR = /limit|quota|credit|billing|insufficient|\b429\b|\b402\b/i;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k, d = null) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=").slice(1).join("=") ?? d;
const has = (k) => process.argv.includes(`--${k}`);
const ALL = has("all");
const RUN = arg("run");
const COMPARE = arg("compare");
const DOORS = arg("doors")?.split(",").map((s) => s.trim().toLowerCase()) ?? null;
const TOP = Number(arg("top", RUN_TOP));
const FROM = Number(arg("from", 1)); // 1-based rank of the first door to bake
const UNTIL = arg("until") ? new Date(arg("until")).getTime() : null;
const LIMIT = Number(arg("limit", 0)) || Infinity;
const PROFILE = arg("profile", "maya");
const PAR = Number(arg("par", ALL ? 2 : 1));
const DRY = has("dry");
const REDO = has("redo");
const PUBLIC = ALL || has("public");
const readJson = (rel) => JSON.parse(readFileSync(join(ROOT, rel), "utf8"));
const OUT_DIR = join(ROOT, "data/talk-max");
const LEDGER = join(ROOT, "data/talk-max.jsonl");
mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(join(ROOT, "public/data/talk"), { recursive: true });
const env = { ANTHROPIC_API_KEY: "max-plan", ANTHROPIC_FETCH: makeClaudeCodeFetch({ log: (s) => console.warn(s) }), TALK_VISITOR_DAILY: 1e6, TALK_WINDOW: 1e6, AGENT_USD_DAILY: 1e5, TALK_MS: 300000, ...(process.env.TALK_MODEL ? { TALK_MODEL: process.env.TALK_MODEL } : {}) };
const facts = readJson("public/data/facts.json").facts ?? [];
const NOTE = "Talking points written per door from Qloo's facts (scripts/talk-bake.mjs for the examples; scripts/talk-max.mjs for the saved runs, through headless Claude Code on the owner's plan); each set passed lib/talk-gen.js validateTalkSet and is checked again in the app.";
const CC_NOTE = "Talking points written per door by scripts/talk-max.mjs through headless Claude Code (the owner's plan, no API key); same prompt, checks and shape as scripts/talk-bake.mjs.";
const example = examples().find((e) => e.key === (COMPARE ?? PROFILE));
if (!example) throw new Error(`no example ${COMPARE ?? PROFILE}`);

// ---- the jobs: a saved run (brand × city), or an example's own plan (--compare) ----
function jobOf(run) {
  if (!run) {
    const profile = example.profile;
    const cityKey = profile.city;
    const city = readJson(`public/data/cities/${cityKey}.json`);
    const routes = [...(profile.drinks ?? []).map((d) => d.key), ...((profile.pours ?? []).length ? ["parsons"] : [])].map((k) => readJson(`public/data/routes/${k}-${cityKey}.json`));
    return { label: `compare-${example.key}`, title: `example ${example.key}`, profile, cityKey, cityName: city.name, city, routes, drinkers: false };
  }
  const { route, city, cityKey, cityName } = run;
  const first = route.venues[route.lists.all[0][0]];
  // rooms: every kind (--rooms=bars,breweries narrows it as the form would), so the top of the list is the run's own top
  const rooms = arg("rooms", "") ? arg("rooms").split(",") : ROOMS.map((r) => r.key);
  const profile = { ...structuredClone(example.profile), city: cityKey, rooms, roomsTouched: rooms.length > 0, drinks: [{ key: route.drinker.key, name: route.drinker.name, ready: false }], pours: [], ...(cityKey !== example.profile.city ? { start: { label: cityName, lat: first.lat, lon: first.lon, source: "chip" } } : {}) };
  return { label: run.hash, title: `${run.brand} × ${cityName}`, run: { file: run.file, key: run.key, brand: run.brand, city: cityName }, profile, cityKey, cityName, city, routes: [route], drinkers: true };
}
function pickRun(q) {
  const runs = savedRuns(ROOT);
  const hit = runs.find((r) => r.hash.startsWith(q)) ?? runs.find((r) => `${r.brand}|${r.cityName}`.toLowerCase() === q.toLowerCase()) ?? runs.find((r) => `${r.brand}|${r.cityName}`.toLowerCase().includes(q.toLowerCase()));
  if (!hit) throw new Error(`no saved run matches "${q}"; runs: ${runs.map((r) => `${r.brand}|${r.cityName}`).join(", ")}`);
  return hit;
}
const outs = {}; // public/data/talk/<city>.json, read once, written after every set
const outOf = (job) => {
  if (!PUBLIC) {
    const p = join(OUT_DIR, `${job.label}.json`);
    return { path: p, data: existsSync(p) ? JSON.parse(readFileSync(p, "utf8")) : { v: 1, note: CC_NOTE, run: job.run ?? { example: COMPARE }, profile: { brand: job.profile.brand, what: job.profile.what, ask: job.profile.pitch?.ask, drinker: job.profile.drinks[0]?.name }, sets: {} } };
  }
  const p = join(ROOT, `public/data/talk/${job.cityKey}.json`);
  outs[job.cityKey] ??= existsSync(p) ? { ...JSON.parse(readFileSync(p, "utf8")), note: NOTE } : { v: 1, note: NOTE, sets: {} };
  return { path: p, data: outs[job.cityKey] };
};

const total = { doors: 0, calls: 0, ok: 0, refused: 0, firstTry: 0, skipped: 0, ms: [] };
let stop = null;
async function bakeRun(job) {
  const { profile, cityKey, cityName, city, routes } = job;
  const pool = buildPool({ routes, profile, cityName });
  const planned = planDays({ pool: pool.rows, statuses: pool.statuses, windows: windowsFor(profile), visitMin: profile.visitMin ?? 25, pinned: pool.pinned });
  const plan = { city: { key: cityKey, name: cityName }, profile, venues: { ...(city.sisterVenues ?? {}), ...pool.venues }, days: planned.days, pool: { ids: pool.ids, N: pool.N, label: pool.label }, statuses: pool.statuses };
  let ids = COMPARE ? pool.ids.filter((id) => DOORS?.includes(String(plan.venues[id]?.name ?? "").toLowerCase())) : pool.ids.slice(FROM - 1, TOP);
  ids = ids.slice(0, LIMIT);
  const records = (() => { try { return readJson(`public/data/enrich/${cityKey}.json`).doors ?? {}; } catch { return {}; } })();
  const enrich = Object.fromEntries(Object.entries(records).map(([id, r]) => [id, enrichFacts(r)]));
  const deepFacts = deepFactsFor(records, { plan, routes, city, near: (() => { try { return readJson(`public/data/deep/${cityKey}.json`).near ?? null; } catch { return null; } })(), profile });
  const out = outOf(job);
  const t = { calls: 0, ok: 0, refused: 0, firstTry: 0, skipped: 0, ms: [] };
  console.log(`${job.label}: ${job.title} · rep ${profile.brand} (${profile.what}) · ${ids.length} doors (ranks ${FROM}–${TOP}) · enrich ${Object.keys(records).length} records${PUBLIC ? ` → public/data/talk/${cityKey}.json` : ""}`);
  const jobs = ids.map((id, i) => async () => {
    if (stop) return;
    if (UNTIL && Date.now() >= UNTIL) { stop = `DEADLINE: ${arg("until")} reached; the rest is left for the live path`; return; }
    if (existsSync(STOP_FILE)) { stop = `STOPFILE: ${STOP_FILE}; the rest is left for the live path`; return; }
    const m = stopModel({ plan, id, city, facts, routes, enrich, deepFacts });
    if (!m.talkReq) return;
    const bk = bakedTalkKey({ id, profile, ask: m.talk.ask, drinkers: job.drinkers });
    const fk = talkKey(m.talkReq);
    if (!REDO && out.data.sets[bk]?.factsKey === fk && validateTalkSet(out.data.sets[bk].set, m.talkReq).ok) { t.skipped++; return; }
    if (DRY) { if (!t.calls++ && !total.calls++) console.log(talkUser(m.talkReq)); console.log(`  ${i + 1}. ${m.venue.name} (${m.talkReq.facts.length} facts)`); return; }
    const n0 = ccCalls.length;
    const t0 = Date.now();
    const r = await talkTurn({ tf: m.talkReq, env, ip: "max" });
    const ms = Date.now() - t0;
    const mine = ccCalls.slice(n0);
    t.calls++;
    t.ms.push(ms);
    if (ccLimitHit() || (r.error && STOP_ERROR.test(r.error))) stop = `STOP: claude -p hit the plan's limit (${(ccLimitHit() ?? r.error).slice(0, 200)}); the rest is left for the next run`;
    if (r.set && r.tries === 1) t.firstTry++;
    appendFileSync(LEDGER, JSON.stringify({ at: new Date().toISOString(), run: job.label, city: cityKey, id, name: m.venue.name, ok: Boolean(r.set), reason: r.reason ?? null, error: r.error ?? null, tries: r.tries, ms, callMs: mine.map((c) => c.ms), reported_usd: mine.reduce((a, c) => a + (c.cost ?? 0), 0), dropped: (r.droppedLines ?? r.dropped ?? []).map((d) => `${d.where}: ${d.reason}`) }) + "\n");
    if (r.set) { t.ok++; out.data.sets[bk] = { set: r.set, model: r.model, at: r.at, factsKey: fk, via: "claude-code", drinker: profile.drinks[0]?.name }; console.log(`  ok ${m.venue.name} (${(ms / 1000).toFixed(0)} s, ${r.tries} tr${r.tries === 1 ? "y" : "ies"}${r.droppedLines?.length ? `, dropped ${r.droppedLines.length}` : ""})`); }
    else if (!stop) { t.refused++; delete out.data.sets[bk]; console.log(`  refused ${m.venue.name}: ${r.reason}${r.error ? ` ${r.error.slice(0, 120)}` : ""} ${(r.dropped ?? []).map((d) => `${d.where}: ${d.reason}`).join("; ").slice(0, 200)}`); }
    writeFileSync(out.path, JSON.stringify(out.data));
  });
  for (let i = 0; i < jobs.length && !stop; i += PAR) await Promise.all(jobs.slice(i, i + PAR).map((j) => j()));
  if (!DRY) writeFileSync(out.path, JSON.stringify(out.data));
  for (const k of ["calls", "ok", "refused", "firstTry", "skipped"]) total[k] += t[k];
  total.doors += ids.length;
  total.ms.push(...t.ms);
  const mean = t.ms.length ? t.ms.reduce((a, b) => a + b, 0) / t.ms.length : 0;
  console.log(`  ${job.title}: doors ${ids.length} · written ${t.ok} · refused ${t.refused} · skipped ${t.skipped} · first try ${t.firstTry}/${t.calls} · ${(mean / 1000).toFixed(1)} s a door${stop ? `\n${stop}` : ""}`);
}

// a stop file ends a run before it starts (or at the next door): data/talk-max.STOP (gigbot 10-28: pass 2 skipped once
// Jard was pleased; the doors past 25 are written live)
const STOP_FILE = join(ROOT, "data/talk-max.STOP");
if (existsSync(STOP_FILE)) { console.log(`stop file ${STOP_FILE}: nothing started`); process.exit(0); }
const list = ALL ? savedRuns(ROOT) : RUN ? [pickRun(RUN)] : [null];
for (const run of list) { if (stop) break; await bakeRun(jobOf(run)); }
const sorted = [...total.ms].sort((a, b) => a - b);
const med = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
const mean = total.ms.length ? total.ms.reduce((a, b) => a + b, 0) / total.ms.length : 0;
const reported = ccCalls.reduce((a, c) => a + (c.cost ?? 0), 0);
const callMean = ccCalls.length ? ccCalls.reduce((a, c) => a + c.ms, 0) / ccCalls.length / 1000 : 0;
console.log(`TOTAL runs ${list.length} · doors ${total.doors} · calls to the model ${ccCalls.length} (${callMean.toFixed(1)} s a call) · sets written ${total.ok} · refused ${total.refused} · skipped (current) ${total.skipped} · first try ${total.firstTry} of ${total.calls} · wall per door mean ${(mean / 1000).toFixed(1)} s, median ${(med / 1000).toFixed(1)} s · CLI-reported $${reported.toFixed(2)} (not charged) · errors ${ccCalls.filter((c) => c.error).length}${stop ? `\n${stop}` : ""}`);
if (stop) process.exit(2);
