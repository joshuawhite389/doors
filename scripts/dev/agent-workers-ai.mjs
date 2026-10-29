// Dev only: the scripted chat turns + drive mode's log-visit through the Worker's own /api/agent path on free Workers
// AI over REST (scripts/dev/workers-ai-rest.mjs; the account token is read from ~/.config/gigbot, never printed).
// Prints per turn: model, tools run, actions, neurons, ms. Usage: node scripts/dev/agent-workers-ai.mjs [70b|8b …] [--save dir]
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import worker from "../../src/worker.js";
import { _resetAgent } from "../../src/agent.js";
import { demoContext } from "../../test/agent-fixture.mjs";
import { workersAiRest } from "./workers-ai-rest.mjs";

const args = process.argv.slice(2);
const save = args.includes("--save") ? args[args.indexOf("--save") + 1] : null;
const models = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--save");
const only = process.env.TURNS ? process.env.TURNS.split(",") : null;
const { ctx } = await demoContext({ current: "first" });
const [s0, s1, s2] = ctx.day.stops.map((x) => x.id);
const first = ctx.doors[s0].name;
// the turn → what a right answer does (tools it should call; actions it should return)
const TURNS = {
  "why-first": { text: `why is ${first} first?`, want: { tools: ["explain_door"] } },
  "shorter-opener": { text: "make my opener shorter", want: { tools: ["edit_talking_points"], action: "talk" } },
  "log-visit": { text: "done, back Thu 3pm, liked it, hesitant about price", want: { tools: ["log_visit"], action: "outcome" } },
  "finish-by": { text: "I have to be done by 4:30 today, and skip the next one", want: { tools: ["replan"], action: "replan", check: (acts) => acts.some((a) => a.type === "replan" && a.endBy === "16:30" && a.skip.includes(s1)) } },
  "city-crowd": { text: "what kind of crowd does Austin have, according to Qloo?", want: { tools: ["ask_city"] } },
  compare: { text: `why is ${first} before ${ctx.doors[s1].name}?`, want: { tools: ["compare_doors", "explain_door"] } },
  remember: { text: "the manager here is called Dana, she runs the bar program", want: { tools: ["remember"] } },
  smalltalk: { text: "thanks!", want: { tools: [] } },
};
const VISITS = {
  "visit-followup": { text: "done, come back Thursday at 3, liked it, hesitant about price", want: { result: "followup", followUp: true } },
  "visit-no": { text: "not a fit, they only do wine", want: { result: "no" } },
};
const post = (path, body, env) => worker.fetch(new Request(`https://doors.example${path}`, { method: "POST", headers: { origin: "https://doors.example", "content-type": "application/json" }, body: JSON.stringify(body) }), env).then((r) => r.json());
const rows = [];
for (const key of models.length ? models : ["70b", "8b"]) {
  _resetAgent();
  const ai = workersAiRest();
  if (process.env.DEBUG) {
    const run = ai.run;
    ai.run = async (model, input) => {
      for (const m of input.messages.slice(2)) console.log(`   [${m.role}] ${m.tool_calls ? JSON.stringify(m.tool_calls.map((c) => c.function)) : String(m.content).slice(0, 300)}`);
      return run(model, input);
    };
  }
  // "gemini": the free Gemini chain instead (~/.config/gigbot/gemini-key, never printed), for the chain-order evidence
  // "gemini:<model>": that one Gemini model alone (the per-model evidence for the chain's order)
  const env = key.startsWith("gemini") ? { GEMINI_API_KEY: readFileSync(join(homedir(), ".config/gigbot/gemini-key"), "utf8").trim(), ...(key.includes(":") ? { GEMINI_MODELS: key.split(":")[1] } : {}) } : { AI: ai, WORKERS_AI_MODELS: key };
  for (const [name, t] of Object.entries(TURNS)) {
    if (only && !only.includes(name)) continue;
    if (process.env.PACE) await new Promise((ok) => setTimeout(ok, Number(process.env.PACE))); // PACE=ms between asks (a judge's pace; Gemini free has per-minute limits)
    const u0 = ai.usage.length, t0 = Date.now();
    const r = await post("/api/agent", { v: 1, messages: [{ role: "user", text: t.text }], context: ctx }, env);
    const use = ai.usage.slice(u0);
    const ran = (r.tools ?? []).map((x) => x.name);
    const ok = !r.resting && (t.want.tools.length ? t.want.tools.some((n) => ran.includes(n)) && (r.tools ?? []).some((x) => x.ok) : ran.length === 0) && (!t.want.action || (r.actions ?? []).some((a) => a.type === t.want.action)) && (!t.want.check || t.want.check(r.actions ?? []));
    rows.push({ model: key, name, ok, ms: Date.now() - t0, steps: use.length, neurons: +use.reduce((a, u) => a + u.neurons, 0).toFixed(1), tokensIn: use.reduce((a, u) => a + (u.prompt_tokens ?? 0), 0), tokensOut: use.reduce((a, u) => a + (u.completion_tokens ?? 0), 0), tools: r.tools, actions: (r.actions ?? []).map((a) => a.type), resting: !!r.resting, modelError: r.modelError, reply: r.reply });
    const x = rows.at(-1);
    console.log(`${key} ${name}: ${ok ? "OK " : "BAD"} ${x.ms}ms steps ${x.steps} neurons ${x.neurons} (in ${x.tokensIn}/out ${x.tokensOut}) tools ${JSON.stringify(r.tools)} actions ${x.actions} by ${r.by ?? "-"} ${r.resting ? `RESTING ${r.modelError}` : ""}\n   → ${String(r.reply).slice(0, 220)}`);
  }
  for (const [name, t] of Object.entries(VISITS)) {
    if (only && !only.includes(name)) continue;
    if (process.env.PACE) await new Promise((ok) => setTimeout(ok, Number(process.env.PACE)));
    const u0 = ai.usage.length, t0 = Date.now();
    const r = await post("/api/agent/log-visit", { text: t.text, stop: { id: s0, name: first, date: ctx.today }, now: { date: ctx.today, min: 14 * 60 + 20 }, windows: ctx.windows.map((w) => w.date), next: [s1, s2].map((id) => ({ id, name: ctx.doors[id].name })) }, env);
    const use = ai.usage.slice(u0);
    const out = r.visit?.outcome ?? {};
    const ok = r.source === "model" && out?.result === t.want.result && (!t.want.followUp || !!out.followUp);
    rows.push({ model: key, name, ok, ms: Date.now() - t0, steps: use.length, neurons: +use.reduce((a, u) => a + u.neurons, 0).toFixed(1), tokensIn: use.reduce((a, u) => a + (u.prompt_tokens ?? 0), 0), tokensOut: use.reduce((a, u) => a + (u.completion_tokens ?? 0), 0), source: r.source, outcome: out });
    const x = rows.at(-1);
    console.log(`${key} ${name}: ${ok ? "OK " : "BAD"} ${x.ms}ms steps ${x.steps} neurons ${x.neurons} source ${r.source} → ${JSON.stringify(out).slice(0, 220)}`);
  }
}
for (const key of new Set(rows.map((r) => r.model))) {
  const m = rows.filter((r) => r.model === key);
  const chat = m.filter((r) => !r.name.startsWith("visit"));
  const avg = chat.reduce((a, r) => a + r.neurons, 0) / chat.length;
  console.log(`== ${key}: ${m.filter((r) => r.ok).length}/${m.length} right; chat turn avg ${avg.toFixed(1)} neurons, max ${Math.max(...chat.map((r) => r.neurons))}; ${Math.floor(10000 / avg)} turns per 10k neurons`);
}
if (save) {
  mkdirSync(save, { recursive: true });
  writeFileSync(join(save, `run-${models.join("-") || "all"}-${Date.now()}.json`), JSON.stringify(rows, null, 1));
}
