// Records real model turns for the guided demo and the tests (docs/CONTRACTS-R9.md §5): each is {request, response}
// through the Worker's own /api/agent path with the free Gemini key (~/.config/gigbot/gemini-key, never printed).
// No Qloo calls (the agent makes none). Usage: node scripts/agent-record.mjs [name …]
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import worker from "../src/worker.js";
import { demoContext } from "../test/agent-fixture.mjs";

const key = readFileSync(join(homedir(), ".config/gigbot/gemini-key"), "utf8").trim();
const { ctx } = await demoContext({ current: "first" });
const first = ctx.doors[ctx.day.stops[0].id].name;
const TURNS = {
  "why-first": `why is ${first} first?`,
  "shorter-opener": "make my opener shorter",
  "log-visit": "done, back Thu 3pm, liked it, hesitant about price",
  "finish-by": "I have to be done by 4:30 today, and skip the next one",
  "city-crowd": "what kind of crowd does Austin have, according to Qloo?",
  "compare": `why is ${first} before ${ctx.doors[ctx.day.stops[1].id].name}?`,
};
const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(TURNS);
const dir = new URL("../test/fixtures/agent/", import.meta.url).pathname;
mkdirSync(dir, { recursive: true });
for (const name of names) {
  const request = { v: 1, messages: [{ role: "user", text: TURNS[name] }], context: ctx };
  const t0 = Date.now();
  const res = await worker.fetch(new Request("https://doors.example/api/agent", { method: "POST", headers: { origin: "https://doors.example", "content-type": "application/json" }, body: JSON.stringify(request) }), { GEMINI_API_KEY: key });
  const response = await res.json();
  const ms = Date.now() - t0;
  writeFileSync(join(dir, `${name}.json`), JSON.stringify({ recorded: new Date().toISOString().slice(0, 10), ms, request, response }, null, 1) + "\n");
  console.log(`${name} (${ms} ms, by ${response.by}${response.resting ? ", RESTING" : ""}): ${response.reply}\n  tools ${JSON.stringify(response.tools)} actions ${JSON.stringify(response.actions).slice(0, 220)}\n  facts ${response.facts.length}`);
}
