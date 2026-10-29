// Dev only: the live check's Ask Doors failure (A) as a script. A compound ask (why ranked + cut a stop by 4:30), then a
// follow-up question with the first turn in the history, through /api/agent on Workers AI over REST (or Gemini).
// Prints each turn's raw model text (DEBUG=1), the reply, tools, actions. Usage: node scripts/dev/agent-multiturn.mjs [70b|8b|gemini]
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import worker from "../../src/worker.js";
import { _resetAgent } from "../../src/agent.js";
import { demoContext } from "../../test/agent-fixture.mjs";
import { workersAiRest } from "./workers-ai-rest.mjs";

const key = process.argv[2] ?? "70b";
const { ctx } = await demoContext({ current: "first" });
const [s0, s1] = ctx.day.stops.map((x) => x.id);
const A = ctx.doors[s0].name, B = ctx.doors[s1].name;
const post = (body, env) => worker.fetch(new Request("https://doors.example/api/agent", { method: "POST", headers: { origin: "https://doors.example", "content-type": "application/json" }, body: JSON.stringify(body) }), env).then((r) => r.json());
_resetAgent();
const ai = workersAiRest();
if (process.env.DEBUG) {
  const run = ai.run;
  ai.run = async (model, input) => {
    const out = await run(model, input);
    const m = out?.choices?.[0]?.message;
    console.log(`   [model] ${JSON.stringify(m?.content ?? out?.response ?? "").slice(0, 400)} ${m?.tool_calls ? JSON.stringify(m.tool_calls.map((c) => c.function)) : ""}`);
    for (const x of input.messages.filter((x) => x.role === "tool").slice(-2)) console.log(`   [tool] ${String(x.content).slice(0, 200)}`);
    return out;
  };
}
const env = key === "gemini" ? { GEMINI_API_KEY: readFileSync(join(homedir(), ".config/gigbot/gemini-key"), "utf8").trim() } : { AI: ai, WORKERS_AI_MODELS: key };
const asks = (process.env.ASKS ? process.env.ASKS.split("|") : [`Why is ${B} ranked below ${A}, and which stop would you cut if I only have until 4:30?`, `why is ${B} on my list at all?`, "thanks"]);
const messages = [];
for (const text of asks) {
  messages.push({ role: "user", text });
  const t0 = Date.now();
  const r = await post({ v: 1, messages, context: ctx }, env);
  console.log(`> ${text}\n  by ${r.by ?? "-"} ${Date.now() - t0}ms tools ${JSON.stringify(r.tools)} actions ${JSON.stringify((r.actions ?? []).map((a) => a.type + (a.endBy ? ":" + a.endBy : "")))} ${r.resting ? "RESTING " + r.modelError : ""}\n  → ${r.reply}\n  facts ${(r.facts ?? []).length}`);
  messages.push({ role: "agent", text: r.reply });
}
console.log(`neurons ${ai.usage.reduce((a, u) => a + u.neurons, 0).toFixed(0)} steps ${ai.usage.length}`);
