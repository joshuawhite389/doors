// Dev only (Jard 10-23): "why is my highest ranked room not on any of my routes?" on a live free model, through the
// Worker's own /api/agent. Right = the model gives the planner's reason (the Why view's words, the plan fact) and never
// blames the popularity cap. The demo plan with its #1 taken off its day by the planner's "nearer" reason, as on Jard's
// Higher Gravity card; plus a room the real demo plan leaves off. ~3 turns.
// Usage: node scripts/dev/agent-whynot-live.mjs [70b|8b|gemini:<model>]   (TURNS=top,named,real for some)
import worker from "../../src/worker.js";
import { _resetAgent } from "../../src/agent.js";
import { agentContext } from "../../public/lib/agent-context.js";
import { demoContext } from "../../test/agent-fixture.mjs";
import { route, city } from "../../test/helpers.mjs";
import { workersAiRest } from "./workers-ai-rest.mjs";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const key = process.argv[2] ?? "70b";
const WHY = "Wednesday has room for it only in place of a stop nearer its route";
const { plan: p, ctx: real } = await demoContext();
const id = p.pool.ids[0];
const days = p.days.map((d) => ({ ...d, stops: d.stops.filter((s) => s.id !== id) }));
const plan = { ...p, days, reasons: { ...p.reasons, [id]: { code: "nearer", text: WHY, date: days[1].date } } };
const ctx = agentContext({ plan, dayIndex: 0, city: city("austin"), routes: [route("athletic-brewing-austin")], now: new Date(`${plan.days[0].date}T14:20:00`) });
const [rid, rv] = Object.entries(real.doors).find(([, v]) => v.plan && !v.plan.on && v.plan.fate === "route") ?? Object.entries(real.doors).find(([, v]) => v.plan && !v.plan.on);
const words = (r) => r.split(/\W+/).filter((w) => w.length > 4).slice(0, 4);
const TURNS = [
  { name: "top", text: "why is my highest ranked room not on any of my routes?", context: ctx, want: words(WHY) },
  { name: "named", text: `why isn't ${ctx.doors[id].name} on my plan?`, context: ctx, want: words(WHY) },
  { name: "real", text: `why is ${rv.name} not on any of my days?`, context: real, want: words(rv.plan.reason) },
];
const post = (body, env) => worker.fetch(new Request("https://doors.example/api/agent", { method: "POST", headers: { origin: "https://doors.example", "content-type": "application/json" }, body: JSON.stringify(body) }), env).then((r) => r.json());
_resetAgent();
const ai = key.startsWith("gemini") ? null : workersAiRest();
// "gemini:<model>": that free Gemini model instead (~/.config/gigbot/gemini-key, never printed)
const env = key.startsWith("gemini") ? { GEMINI_API_KEY: readFileSync(join(homedir(), ".config/gigbot/gemini-key"), "utf8").trim(), GEMINI_MODELS: key.split(":")[1] ?? "gemini-3.1-flash-lite" } : { AI: ai, WORKERS_AI_MODELS: key };
let right = 0;
const only = process.env.TURNS ? process.env.TURNS.split(",") : null;
const run = TURNS.filter((x) => !only || only.includes(x.name));
for (const t of run) {
  const t0 = Date.now();
  const r = await post({ v: 1, messages: [{ role: "user", text: t.text }], context: t.context }, env);
  const reason = t.want.every((w) => r.reply.toLowerCase().includes(w.toLowerCase()));
  // the cap named as the reason; "0.73, so the cap doesn't keep it off" is the fact said right
  const blamesCap = (r.reply.match(/[^.!?]*(?:popularity|famous|\bcap\b|too popular)[^.!?]*/gi) ?? []).some((x) => !/\b(doesn'?t|does not|not why|isn'?t|is not|under)\b/i.test(x));
  const ok = !r.resting && reason && !blamesCap;
  right += ok;
  console.log(`${key} ${t.name}: ${ok ? "OK " : "BAD"} ${Date.now() - t0}ms tools ${JSON.stringify((r.tools ?? []).map((x) => `${x.name}:${x.ok}`))}${blamesCap ? " BLAMES-CAP" : ""}${reason ? "" : " NO-REASON"}${r.resting ? ` RESTING ${r.modelError}` : ""}\n   Q: ${t.text}\n   → ${String(r.reply)}`);
}
console.log(`== ${key}: ${right}/${run.length} right`);
