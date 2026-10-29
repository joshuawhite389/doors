// Dev only: door notes on a live free model (Workers AI over REST, scripts/dev/workers-ai-rest.mjs; the token is read
// from ~/.config/gigbot, never printed), through the Worker's own /api/agent: does the model note what matters, in the
// rep's words, say so, and leave small talk and questions alone? ~6 turns, ~1,500 neurons on 70b.
// Usage: node scripts/dev/agent-notes-live.mjs [70b|8b|gemini:<model>]   (TURNS=fact,wants … for some)
import worker from "../../src/worker.js";
import { _resetAgent } from "../../src/agent.js";
import { demoContext } from "../../test/agent-fixture.mjs";
import { workersAiRest } from "./workers-ai-rest.mjs";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const key = process.argv[2] ?? "70b";
const { ctx } = await demoContext({ current: "first" });
const s0 = ctx.day.stops[0].id;
const first = ctx.doors[s0].name;
const withNote = { ...ctx, doors: { ...ctx.doors, [s0]: { ...ctx.doors[s0], notes: [{ text: "Owner is Dana; she does the ordering, in Tue to Thu.", by: "rep" }] } } };
const TURNS = [
  { name: "fact", text: "the manager is Priya, she's back Thursdays", want: "note" },
  { name: "wants", text: "they want samples of the dry one next time", want: "note" },
  { name: "explicit", text: "note that the owner prefers a text over a call", want: "note" },
  { name: "smalltalk", text: "thanks!", want: "none" },
  { name: "question", text: "should I bring samples when I come back?", want: "none" },
  { name: "read", text: `what do I know about ${first}?`, want: "reads", context: withNote },
];
const post = (body, env) => worker.fetch(new Request("https://doors.example/api/agent", { method: "POST", headers: { origin: "https://doors.example", "content-type": "application/json" }, body: JSON.stringify(body) }), env).then((r) => r.json());
_resetAgent();
const ai = workersAiRest();
// "gemini:<model>": that free Gemini model instead (~/.config/gigbot/gemini-key, never printed)
const env = key.startsWith("gemini") ? { GEMINI_API_KEY: readFileSync(join(homedir(), ".config/gigbot/gemini-key"), "utf8").trim(), GEMINI_MODELS: key.split(":")[1] ?? "gemini-3.5-flash" } : { AI: ai, WORKERS_AI_MODELS: key };
let right = 0;
const only = process.env.TURNS ? process.env.TURNS.split(",") : null;
for (const t of TURNS.filter((x) => !only || only.includes(x.name))) {
  const u0 = ai.usage.length, t0 = Date.now();
  const r = await post({ v: 1, messages: [{ role: "user", text: t.text }], context: t.context ?? ctx }, env);
  const use = ai.usage.slice(u0);
  const notes = (r.actions ?? []).filter((a) => a.type === "slot" && a.record?.field === "note").map((a) => a.record.value);
  const ok = !r.resting && (t.want === "note" ? notes.length === 1 && /\bnot(ed|e)\b/i.test(r.reply) : t.want === "none" ? !notes.length && !r.offerNote : /Dana/.test(r.reply));
  right += ok;
  console.log(`${key} ${t.name}: ${ok ? "OK " : "BAD"} ${Date.now() - t0}ms neurons ${use.reduce((a, u) => a + u.neurons, 0).toFixed(0)} tools ${JSON.stringify((r.tools ?? []).map((x) => `${x.name}:${x.ok}`))} notes ${JSON.stringify(notes)}${r.offerNote ? ` offer ${JSON.stringify(r.offerNote.text)}` : ""}${r.resting ? ` RESTING ${r.modelError}` : ""}\n   → ${String(r.reply).slice(0, 240)}`);
}
console.log(`== ${key}: ${right}/${TURNS.filter((x) => !only || only.includes(x.name)).length} right`);
