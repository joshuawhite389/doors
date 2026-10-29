// Group 3 item 3: write the talking points the proof judges. Reads data/proof/talk-wanted.json (the stops scripts/proof.mjs
// found with no written set) and asks the Worker's own call (src/talk.js talkTurn: the g6 prompt, schema, checks and
// retries; the model is in each set) once per set of facts; keeps them in data/proof/talk-sets.json so every later proof
// run judges the same text. A set the checks refuse is left out: that stop keeps the template.
// Freeze (Jard 10-28): the call goes through headless Claude Code on the owner's Max plan (scripts/claude-code-fetch.mjs
// standing in for the API, as scripts/talk-max.mjs does): no API key, no credit. Same model and prompt as the app's
// talk (Sonnet 5.5, high effort), so the proof tests what ships. Each call is logged in data/talk-bake.jsonl (ex "proof",
// via "claude-code", the CLI's reported $ as information only).
//   node scripts/proof/talk-fill.mjs [--par=2] [--judged-first] [--seed=<another talk-sets.json>] [--limit=N] [--until=<ISO local>]
//     --judged-first: the stops the model screen reads (Doors, the popularity list, all slots off, the return visits)
//       are written before the ablation and probe variants, so a run cut short still judges written text
//     --seed: sets already written for the same facts key (the same rules version is in the key) are taken as they are
//     --until: a hard stop (local time); the run ends cleanly at the next batch
// SAFETY: the first usage-limit answer from claude -p ends the run (exit 2, "STOP:"); nothing retries through it.
import { readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, TALK_SETS_FILE, talkWanted, runScenario } from "./harness.mjs";
import { talkTurn } from "../../src/talk.js";
import { validateTalkSet } from "../../public/lib/talk-gen.js";
import { makeClaudeCodeFetch, ccCalls, ccLimitHit } from "../claude-code-fetch.mjs";

const arg = (k, d = null) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=").slice(1).join("=") ?? d;
const has = (k) => process.argv.includes(`--${k}`);
const PAR = Number(arg("par", 2));
const LIMIT = Number(arg("limit", 0)) || Infinity;
const UNTIL = arg("until") ? new Date(arg("until")).getTime() : null;
const STOP_ERROR = /limit|quota|credit|billing|insufficient|\b429\b|\b402\b/i; // a plan limit or billing error stops the run (exit 2)

const wanted = JSON.parse(readFileSync(join(ROOT, "data/proof/talk-wanted.json"), "utf8"));
const file = join(ROOT, TALK_SETS_FILE);
const out = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { v: 1, note: "Talking points written for the proof's stops (scripts/proof/talk-fill.mjs; the model is in each set), by the key of the facts they were written from.", sets: {} };
const good = (w) => out.sets[w.key] && validateTalkSet(out.sets[w.key].set, w.tf).ok;

// --seed: sets another run wrote for the same facts key (same facts, same rules version), taken as they are
let seeded = 0;
if (arg("seed")) {
  const seed = JSON.parse(readFileSync(arg("seed"), "utf8")).sets ?? {};
  for (const w of wanted) if (!good(w) && seed[w.key] && validateTalkSet(seed[w.key].set, w.tf).ok) { out.sets[w.key] = seed[w.key]; seeded++; }
  if (seeded) writeFileSync(file, JSON.stringify(out) + "\n");
}

// --judged-first: the facts keys of the stops the model screen reads (scripts/proof.mjs: pairs, pairsRank, pairsReturn, swaps)
let first = new Set();
if (has("judged-first")) {
  const { SCENARIOS } = await import("./scenarios.mjs");
  const { baselineRun } = await import("./probes.mjs");
  const { returnCase } = await import("./slots-probes.mjs");
  for (const s of SCENARIOS) { runScenario(s); runScenario(s, { off: ["drinker"] }); baselineRun(s); returnCase(s); returnCase(s, { slotsOff: ["S4"] }); }
  first = new Set(talkWanted.keys());
}

const env = { ANTHROPIC_API_KEY: "max-plan", ANTHROPIC_FETCH: makeClaudeCodeFetch({ log: (s) => console.warn(s) }), TALK_VISITOR_DAILY: 1e6, TALK_WINDOW: 1e6, AGENT_USD_DAILY: 1e5, TALK_MS: 300000, ...(process.env.TALK_MODEL ? { TALK_MODEL: process.env.TALK_MODEL } : {}) };
let ok = 0, refused = 0, stop = null, calls = 0, firstTry = 0;
const ms = [];
const todo = wanted.filter((w) => !good(w)); // a set the checks now refuse is written again
todo.sort((a, b) => Number(first.has(b.key)) - Number(first.has(a.key)));
const run = todo.slice(0, LIMIT);
console.log(`wanted ${wanted.length} · held ${wanted.length - todo.length} (seeded ${seeded}) · to write ${run.length}${first.size ? ` (judged stops first: ${run.filter((w) => first.has(w.key)).length})` : ""} · par ${PAR} · claude -p (Max plan)`);
for (let i = 0; i < run.length && !stop; i += PAR) {
  if (UNTIL && Date.now() >= UNTIL) { stop = `DEADLINE: ${arg("until")} reached; the rest is left for the next run`; break; }
  await Promise.all(run.slice(i, i + PAR).map(async ({ key, tf }) => {
    if (stop) return;
    const n0 = ccCalls.length;
    const t0 = Date.now();
    const r = await talkTurn({ tf, env, ip: "proof" });
    const wall = Date.now() - t0;
    const mine = ccCalls.slice(n0);
    calls++;
    ms.push(wall);
    if (ccLimitHit() || (r.error && STOP_ERROR.test(r.error))) { stop = `STOP: claude -p hit the plan's limit (${String(ccLimitHit() ?? r.error).slice(0, 200)}); the rest is left for the next run`; console.error(stop); }
    appendFileSync(join(ROOT, "data/talk-bake.jsonl"), JSON.stringify({ at: new Date().toISOString(), ex: "proof", via: "claude-code", key, name: tf.facts[0]?.text, ok: Boolean(r.set), reason: r.reason ?? null, error: r.error ?? null, tries: r.tries, ms: wall, callMs: mine.map((c) => c.ms), usd: 0, reported_usd: mine.reduce((a, c) => a + (c.cost ?? 0), 0), dropped: (r.droppedLines ?? r.dropped ?? []).map((d) => `${d.where}: ${d.reason}`) }) + "\n");
    if (r.set) { ok++; if (r.tries === 1) firstTry++; out.sets[key] = { set: r.set, model: r.model, at: r.at, via: "claude-code" }; console.log(`  ok ${tf.facts[0]?.text ?? key} (${(wall / 1000).toFixed(0)} s, ${r.tries} tr${r.tries === 1 ? "y" : "ies"}${r.droppedLines?.length ? `, dropped ${r.droppedLines.length}` : ""})`); }
    else if (!stop) { refused++; console.log(`  refused ${tf.facts[0]?.text ?? key}: ${r.reason}${r.error ? ` ${r.error.slice(0, 120)}` : ""} ${(r.dropped ?? []).map((d) => `${d.where}: ${d.reason}`).join("; ").slice(0, 200)}`); }
  }));
  writeFileSync(file, JSON.stringify(out) + "\n"); // after every batch: a stopped run keeps what it wrote
}
writeFileSync(file, JSON.stringify(out) + "\n");
const mean = ms.length ? ms.reduce((a, b) => a + b, 0) / ms.length / 1000 : 0;
const reported = ccCalls.reduce((a, c) => a + (c.cost ?? 0), 0);
console.log(`wanted ${wanted.length} · to write ${run.length} · written ${ok} · refused ${refused} · first try ${firstTry}/${calls} · ${mean.toFixed(1)} s a set · calls to the model ${ccCalls.length} · CLI-reported $${reported.toFixed(2)} (not charged) · still without a set ${wanted.filter((w) => !good(w)).length}${stop ? `\n${stop}` : ""}`);
if (stop) process.exit(2);
