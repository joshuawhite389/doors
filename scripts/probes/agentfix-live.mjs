// Jard's 10-24 web review, replayed against the real Agent (Haiku via the Worker's /api/agent, spend book capped at
// $0.50 for the run). Usage: node scripts/probes/agentfix-live.mjs
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import worker from "../../src/worker.js";
import { demoContext } from "../../test/agent-fixture.mjs";
import { agentContext } from "../../public/lib/agent-context.js";
import { city } from "../../test/helpers.mjs";

const key = readFileSync(join(homedir(), ".config/gigbot/anthropic-key"), "utf8").trim();
const env = { ANTHROPIC_API_KEY: key, AGENT_USD_DAILY: "0.5", DEV_UNLIMITED_LOCAL: "1" };
const { plan } = await demoContext({});
const SAT = new Date("2026-10-24T15:14:00"); // a Saturday before the plan's first day, as Jard tested
const ctxAt = (current, dayIndex = 0) => ({ ...agentContext({ plan, dayIndex, current, city: city("austin"), now: SAT }), mode: "plan" });
let usd = 0;
async function turn(label, messages, ctx) {
  const res = await worker.fetch(new Request("https://doors.example/api/agent", { method: "POST", headers: { origin: "https://doors.example", "content-type": "application/json" }, body: JSON.stringify({ v: 1, messages, context: ctx }) }), env);
  const r = await res.json();
  usd += r.cost?.usd ?? 0;
  console.log(`\n## ${label}\n> ${messages.at(-1).text}\n${r.by}${r.model ? ` ${r.model}` : ""}: ${r.reply}\n  tools ${JSON.stringify(r.tools)}\n  actions ${JSON.stringify((r.actions ?? []).map((a) => ({ type: a.type, section: a.section, op: a.op, text: a.text })))}`);
  return r;
}
const d1 = plan.days[0].stops, d2 = plan.days[1].stops;
const nm = (id) => plan.venues[id].name;
// 1+2: the stop after a door, on the day on screen and on another day; times on a later day
await turn(`next after day-1 stop 3 (expect ${nm(d1[3].id)})`, [{ role: "user", text: `what's the next stop after ${nm(d1[2].id)}?` }], ctxAt(d1[2].id));
await turn(`next after day-2 stop 2, day 1 on screen (expect ${nm(d2[2].id)})`, [{ role: "user", text: `what's the next stop after ${nm(d2[1].id)}?` }], ctxAt(null));
// 3: an offered edit, then yes
const c3 = ctxAt(d1[1].id);
const m1 = [{ role: "user", text: `What two changes would you make to ${nm(d1[1].id)}'s talking points? Tell me, and ask before you change anything.` }];
const r1 = await turn("offer edits", m1, c3);
const r2 = await turn("yes please", [...m1, { role: "agent", text: r1.reply }, { role: "user", text: "yes please" }], c3);
// 4: why a door
await turn("why a door", [{ role: "user", text: `Why ${nm(d1[4].id)}?` }], ctxAt(d1[4].id));
console.log(`\nspent $${usd.toFixed(4)}`);
