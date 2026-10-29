// Jard web review R2 (10-24, imgs 205112, 205233): replays his two Carmichael's questions (and a briefing) through the
// Worker's own /api/agent path on Claude Haiku, with the user's drinkers set to the words that leaked. Claude only (no
// Gemini fallback), cost from the Worker's own usage. Usage: node scripts/r2ground-replay.mjs [worker.js path] > out.json
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { modelEnv } from "./dev/model-env.mjs";
import { demoContext } from "../test/agent-fixture.mjs";

const workerPath = resolve(process.argv[2] ?? new URL("../src/worker.js", import.meta.url).pathname);
const worker = (await import(workerPath)).default;
const keyFile = (n) => { const p = join(homedir(), ".config/gigbot", n); return existsSync(p) ? readFileSync(p, "utf8").trim() : undefined; };
const env = { ANTHROPIC_API_KEY: modelEnv(process.env, keyFile).anthropic, DEV_UNLIMITED_LOCAL: "1" };
if (!env.ANTHROPIC_API_KEY) throw new Error("no Anthropic key");
const { ctx } = await demoContext({ current: "first" });
ctx.profile = { ...ctx.profile, drinkers: "health-conscious parents and professionals (the user knows this)" };
const door = ctx.doors[ctx.current];
const ask = async (messages) => {
  const res = await worker.fetch(new Request("https://doors.example/api/agent", { method: "POST", headers: { origin: "https://doors.example", "content-type": "application/json", "cf-connecting-ip": "127.0.0.1" }, body: JSON.stringify({ v: 1, messages, context: ctx }) }), env);
  return res.json();
};
const out = { worker: workerPath, door: door.name, crowd: door.crowd, place: door.place, turns: [] };
const q1 = "Okay, and why exactly is this a good fit for my drink?";
const r1 = await ask([{ role: "user", text: q1 }]);
out.turns.push({ q: q1, by: r1.by, model: r1.model, reply: r1.reply, tools: r1.tools, cost: r1.cost });
const q2 = "How do you know that this is a laid back spot and that health conscious folks and also parents or professionals like to visit here?";
const r2 = await ask([{ role: "user", text: q1 }, { role: "agent", text: r1.reply }, { role: "user", text: q2 }]);
out.turns.push({ q: q2, by: r2.by, model: r2.model, reply: r2.reply, tools: r2.tools, cost: r2.cost });
const q3 = "Brief me on this door.";
const r3 = await ask([{ role: "user", text: q3 }]);
out.turns.push({ q: q3, by: r3.by, model: r3.model, reply: r3.reply, tools: r3.tools, cost: r3.cost });
console.log(JSON.stringify(out, null, 1));
