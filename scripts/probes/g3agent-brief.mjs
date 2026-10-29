// Group 3 #7 eval: Jard's 10-24 screenshot questions ("tell me a little bit more about this next stop", "crucial details
// that will help me land the sale") against the real Agent (Haiku via the Worker's /api/agent, spend book capped at
// $0.50 for the run), on the guided demo's Austin plan. Scores each reply: facts about this door it uses (words from the
// door's place picture, notes, hours) and generic lines that would fit any bar.
// Usage: node scripts/probes/g3agent-brief.mjs [repo root, default this one] (an older root = the "before" run)
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = resolve(process.argv[2] ?? new URL("../..", import.meta.url).pathname);
const imp = (p) => import(pathToFileURL(join(ROOT, p)).href);
const { default: worker } = await imp("src/worker.js");
const { demoContext } = await imp("test/agent-fixture.mjs");
const { agentContext } = await imp("public/lib/agent-context.js");
const { placePicture } = await import("../../public/lib/place.js"); // the scorer's facts: always this branch's picture
const { city, route } = await imp("test/helpers.mjs");

const key = readFileSync(join(homedir(), ".config/gigbot/anthropic-key"), "utf8").trim();
const env = { ANTHROPIC_API_KEY: key, AGENT_USD_DAILY: "0.5", DEV_UNLIMITED_LOCAL: "1" };
const { plan: p0 } = await demoContext({});
// lane B's product fields (v2-g3profile shape), as a rep who filled them in would have them
const plan = { ...p0, profile: { ...p0.profile, product: { format: "cans", size: "12 oz", abv: "0.5%", na: true, sells: "self" }, drinkers: { who: "runners and people cutting back", where: "taprooms and patios", basis: "known" } } };
const AUSTIN = city("austin");
const routes = [route("athletic-brewing-austin")];
const first = plan.days[0];
const at = new Date(`${first.date}T12:30:00`); // the plan's first day, before the first stop
const ctxAt = (mode, current = null) => ({ ...agentContext({ plan, dayIndex: 0, current, city: AUSTIN, routes, now: at }), mode });

const GENERIC = [/who does (your|the) (beer |drinks? )?buying/i, /who buys/i, /ask (for )?who does the buying/i, /ask for the (bar )?manager/i, /be friendly/i, /bring (a )?samples?\b/i, /introduce yourself/i, /be confident/i, /build (a )?rapport/i];
const STOP = new Set("the a an and or of to in on at for with its it is are be by from as this that their them they who what when your you more most most".split(" "));
function score(reply, id) {
  const pic = placePicture({ id, venue: plan.venues[id], city: AUSTIN, routes, plan });
  const facts = pic.rows.filter((r) => r.key !== "ages" && r.key !== "who").flatMap((r) => r.text.split(/[,;:.]\s*|\s+and\s+/)).map((x) => x.trim().toLowerCase()).filter((x) => x.length > 3 && !STOP.has(x));
  const low = reply.toLowerCase();
  const used = [...new Set(facts.filter((f) => low.includes(f)))];
  const generic = GENERIC.filter((re) => re.test(reply)).map(String);
  const drinkers = /runner|cutting back/i.test(reply);
  return { used, generic, drinkers, sentences: (reply.match(/[^.!?]+[.!?]/g) ?? []).length };
}
let usd = 0;
const rows = [];
async function turn(label, messages, ctx, id) {
  const res = await worker.fetch(new Request("https://doors.example/api/agent", { method: "POST", headers: { origin: "https://doors.example", "content-type": "application/json" }, body: JSON.stringify({ v: 1, messages, context: ctx }) }), env);
  const raw = await res.text(); let r; try { r = JSON.parse(raw); } catch { r = {}; } if (!r.reply) console.log("RAW", res.status, raw.slice(0, 400));
  usd += r.cost?.usd ?? 0;
  const sc = score(r.reply ?? "", id);
  rows.push({ label, ...sc });
  console.log(`\n## ${label} (${plan.venues[id].name})\n> ${messages.at(-1).text}\n${r.by}${r.model ? ` ${r.model}` : ""}: ${r.reply}\n  tools ${JSON.stringify((r.tools ?? []).map((t) => t.name))}  facts used ${sc.used.length} ${JSON.stringify(sc.used)}  generic ${JSON.stringify(sc.generic)}  drinkers ${sc.drinkers}  sentences ${sc.sentences}`);
  return r;
}
const Q1 = "Tell me a little bit more about this next stop I'm about to make.";
const Q2 = "Yeah, but can you tell me about this next stop that I'm about to make? Give me some crucial details that will help me land the sale.";
const next = first.stops[0].id;
for (const mode of ["drive", "plan"]) {
  const c = ctxAt(mode);
  const r1 = await turn(`${mode} · Q1`, [{ role: "user", text: Q1 }], c, c.nextDoor ?? next);
  await turn(`${mode} · Q2 (follow-up)`, [{ role: "user", text: Q1 }, { role: "agent", text: r1.reply }, { role: "user", text: Q2 }], c, c.nextDoor ?? next);
}
// a named door later in the day, at a stop
const third = first.stops[2].id;
await turn("stop · named door", [{ role: "user", text: `What do I need to know about ${plan.venues[third].name} to land the sale?` }], ctxAt("stop", third), third);
console.log(`\nROOT ${ROOT}\nsummary ${JSON.stringify(rows.map((r) => [r.label, r.used.length, r.generic.length, r.drinkers, r.sentences]))}\nspent $${usd.toFixed(4)}`);
