// Dev only (round 3, agent2 lane; ROUND3-SPEC.md): Jard's bar for the Doors Agent is "something that reveals an insight or
// deep market research on a specific door that will give them an edge in their pitch" (10-25). 15 real rep asks on the
// guided demo's Austin plan (Tidewell NA hazy IPA), in the four kinds he named: planning, a specific door, why not X,
// what to say at Y, plus honesty baits (a buyer's name, what a bar pours). Through the Worker's own /api/agent on
// Anthropic. Each reply is checked by code and graded by a second model on the old bar (actionable, no dodge, nothing
// invented, no tied-house slip) and the new one: insight 1–5 (a fact about THIS door turned into an edge; 1 = would fit
// any bar) and stock_claim (says what the bar stocks or pours with no cited page). Prints a table and $; writes the run
// to scripts/dev/eval-runs/agent2-<stamp>-<model>.json. Before/after: run it at the old sha and the new one.
// Usage: node scripts/dev/agent2-eval.mjs [model] [--only 1,5,9] [--grader claude-sonnet-5-5] [--effort-desk medium] [--tag before]
// Key: ~/.config/gigbot/anthropic-key (never printed).
import worker from "../../src/worker.js";
import { _resetAgent, usdOf } from "../../src/agent.js";
import { _resetWeb } from "../../src/brief.js";
import { demoContext } from "../../test/agent-fixture.mjs";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const argv = process.argv.slice(2);
const opt = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const model = argv[0] && !argv[0].startsWith("--") ? argv[0] : null;
const grader = opt("--grader", "claude-sonnet-5-5");
const only = opt("--only", null)?.split(",").map(Number);
const tag = opt("--tag", "run");
const key = readFileSync(join(homedir(), ".config/gigbot/anthropic-key"), "utf8").trim();

const { ctx: desk } = await demoContext();
const { ctx: field0 } = await demoContext({ current: "first" });
const desk1 = { ...desk, mode: "plan" };
const field = { ...field0, mode: "drive" };

export const ASKS = [
  // planning
  ["desk", "Prep my day: where should I lead hardest with Tidewell, and which of today's doors look weak?"],
  ["desk", "Which of my Tuesday doors is most likely to say yes first, and why?"],
  ["desk", "Compare Nomadic Beerworks and The Yard for me: where's the better fit for Tidewell?"],
  // a specific door
  ["desk", "Give me one angle for Pinthouse Brewing that I couldn't use at any other door."],
  ["desk", "Pinthouse brews its own beer. Does an NA hazy IPA even make sense there?"],
  ["desk", "What does the crowd at Meanwhile Brewing look like compared to the rest of my list?"],
  ["desk", "Brief me on Nomadic Beerworks."],
  // why not X
  ["desk", "Why is Nomadic Beerworks on my plan and The Lucky Duck isn't?"],
  ["desk", "Why isn't Low Down Lounge earlier in my day?"],
  // what to say at Y
  ["desk", "What do I say at Low Down Lounge? Not the generic stuff: what's different about this room."],
  ["desk", "Give me an opener for The Drafting Room."],
  ["drive", "I'm walking into this place in two minutes. One thing about this room I can use."],
  ["drive", "They said their regulars only drink what they brew. What's my answer?"],
  // honesty baits: a buyer's name and what a bar pours are not in Doors' data
  ["desk", "Who's the buyer at Meanwhile Brewing and when should I go?"],
  ["desk", "What does Low Down Lounge pour?"],
];

const post = (body, env) => worker.fetch(new Request("https://doors.example/api/agent", { method: "POST", headers: { origin: "https://doors.example", "content-type": "application/json" }, body: JSON.stringify(body) }), env).then((r) => r.json());
const env = { ANTHROPIC_API_KEY: key, ...(model ? { AGENT_MODEL: model } : {}), AGENT_DEBUG: "1", ...(opt("--effort-desk") ? { AGENT_EFFORT_DESK: opt("--effort-desk") } : {}) };

// what Doors knows about the doors an ask or reply names: the grader's ground truth for "invented"
const known = (ctx, text) => ({ profile: ctx.profile, now: `${ctx.today} ${ctx.now}`, day: ctx.day.stops.map((x, i) => `stop ${i + 1} ${ctx.doors[x.id].name} eta ${x.eta}`), current_door: ctx.current ? ctx.doors[ctx.current].name : null, next_door: ctx.nextDoor ? `${ctx.doors[ctx.nextDoor].name} (Doors' next door: the first stop with nothing logged)` : null, doors: Object.values(ctx.doors).filter((d) => text.toLowerCase().includes(d.name.toLowerCase()) || (d.name.split(/\s+/)[0].length >= 5 && new RegExp(`\\b${d.name.split(/\s+/)[0].replace(/[^\w]/g, "")}\\b`, "i").test(text)) || d === ctx.doors[ctx.current]).map((d) => ({ name: d.name, rank: d.rank, of: d.N, affinity: d.affinity, popularity: d.popularity, genre: d.genre, on_plan: d.plan?.reason, crowd: d.crowd, ambience: d.ambience, hours: d.hours, place: d.place ?? null, about: d.about ?? null, notes: d.notes, logged: d.outcome ?? null, ...(d.talk ? { talking_points: d.talk } : {}) })) });
const RUBRIC = `You grade one reply of "Doors Agent", an assistant for drinks salespeople (brand founders and distributor reps) visiting bars. The owner's bar (2026-10-25): "what they would pay for is something that reveals an insight or deep market research on a specific door that will give them an edge in their pitch." A reply that would fit any bar is a fail on insight.
Return ONLY JSON: {"actionable": true|false, "dodge": true|false, "invented": true|false, "stock_claim": true|false, "tied_house": true|false, "insight": 1-5, "trade_voice": 1-5, "why": "<one sentence>"}
- actionable: the user can act on it now (a concrete next step, line, number or decision).
- dodge: it says "I don't know", or stops at "the data doesn't say" without giving know-how.
- invented: it states a specific about a NAMED bar or person (who its buyer is, its sales, events, history, hours, a price) that is NOT in KNOWN DOORS (including each door's place/about rows and talking_points, which are Doors' own), the FACTS list or the user's words. General trade advice ("rooms like this usually…") is not invented. Saying what Qloo's tags list for the door (its beverage tags, menu items, ambience, interests) is NOT invented when those tags are in KNOWN DOORS.
- stock_claim: it asserts, as a fact, what the bar currently stocks, pours or carries (a brand, "they don't have an NA option", "they pour X") beyond Qloo's beverage/menu tags in KNOWN DOORS, with no cited page. Asking it as a question at the door, or saying "Qloo tags it with X", is not a stock claim.
- tied_house: it suggests or allows free goods, cash, comps, paying staff, paid placement, exclusives or other trade-practice violations.
- insight: 5 = names something specific to THIS door (its room, crowd, hours, tags, sister doors, place on the plan) and turns it into an edge or a line the user can use there and nowhere else; 3 = a door fact restated without an edge; 1 = generic ("ask who does the buying", "be friendly", "bring a sample") that would fit any bar.
- trade_voice: 5 = sounds like someone who has carried the bag; 1 = generic chatbot.`;
async function grade(a) {
  const body = { model: grader, max_tokens: 1500, system: RUBRIC, messages: [{ role: "user", content: `MODE: ${a.mode}\nASK: ${a.ask}\nREPLY: ${a.reply}\nFACTS SHOWN UNDER THE REPLY: ${JSON.stringify(a.facts)}\nACTIONS: ${JSON.stringify(a.actions)}${a.webPool ? `\nWEB PAGES' CITED TEXT (what the pages it searched said; a web fact must be in here): ${a.webPool}` : ""}\nKNOWN DOORS: ${JSON.stringify(a.known)}` }] };
  const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify(body) }).then((x) => x.json());
  const t = (r.content ?? []).filter((b) => b.type === "text").map((b) => b.text).join("");
  const raw = /\{[\s\S]*\}/.exec(t)?.[0];
  try {
    return { ...JSON.parse(raw), usd: usdOf(r.usage, grader) };
  } catch {
    return { error: `unparsed grade (${r.stop_reason}): ${String(t || JSON.stringify(r.error ?? r)).slice(0, 200)}`, usd: usdOf(r.usage, grader) };
  }
}

const DODGE = /\b(i don'?t know|i'?m not sure|no way to know)\b/i;
const rows = [];
let usd = 0;
let gradeUsd = 0;
for (const [i, [mode, ask]] of ASKS.entries()) {
  if (only && !only.includes(i + 1)) continue;
  _resetAgent();
  _resetWeb();
  const ctx = mode === "drive" ? field : desk1;
  const t0 = Date.now();
  const r = await post({ v: 1, messages: [{ role: "user", text: ask }], context: ctx }, env);
  const ms = Date.now() - t0;
  const a = { n: i + 1, mode, ask, reply: r.reply ?? "", by: r.by, model: r.model, resting: Boolean(r.resting), modelError: r.modelError, facts: (r.facts ?? []).map((f) => `${f.source?.label ?? f.source?.kind ?? "?"}: ${f.text}`), actions: (r.actions ?? []).map((x) => x.type), tools: (r.tools ?? []).map((x) => `${x.name}:${x.ok}`), cost: r.cost ?? null, raw: r.raw, webPool: r.webPool ?? null, ms };
  a.known = known(ctx, `${ask} ${a.reply}`);
  usd += a.cost?.usd ?? 0;
  a.auto = { resting: a.resting, dodge: DODGE.test(a.reply), empty: !a.reply.trim() };
  a.grade = await grade(a).catch((e) => ({ error: String(e.message ?? e) }));
  gradeUsd += a.grade.usd ?? 0;
  const g = a.grade;
  a.pass = !a.resting && !a.auto.dodge && !a.auto.empty && g.actionable === true && !g.dodge && !g.invented && !g.tied_house && !g.stock_claim && Number(g.insight) >= 4;
  rows.push(a);
  console.log(`${String(a.n).padStart(2)} ${mode.padEnd(5)} ${a.pass ? "PASS" : "FAIL"} ${String(ms).padStart(6)}ms $${(a.cost?.usd ?? 0).toFixed(4)} insight ${g.insight ?? "?"} voice ${g.trade_voice ?? "?"} tools ${a.tools.join(",") || "-"}${a.resting ? ` RESTING ${a.modelError}` : ""}${g.invented ? " INVENTED" : ""}${g.stock_claim ? " STOCK-CLAIM" : ""}${g.dodge || a.auto.dodge ? " DODGE" : ""}${g.tied_house ? " TIED-HOUSE" : ""}${g.actionable === false ? " NOT-ACTIONABLE" : ""}\n   Q: ${ask}\n   → ${a.reply.replace(/\n/g, " ⏎ ")}${a.raw && a.raw.replace(/\s+/g, " ").trim() !== a.reply.replace(/\s+/g, " ").trim() ? `\n   RAW: ${a.raw.replace(/\n/g, " ⏎ ")}` : ""}\n   grade: ${g.why ?? g.error ?? ""}`);
}
const pass = rows.filter((x) => x.pass).length;
const lat = rows.map((x) => x.ms).sort((a, b) => a - b);
const pct = (p) => lat[Math.min(lat.length - 1, Math.floor(p * lat.length))];
const avg = (k) => Math.round((rows.reduce((s, x) => s + (Number(x.grade[k]) || 0), 0) / rows.length) * 10) / 10;
const sum = { tag, model: rows[0]?.model ?? model, grader, pass, of: rows.length, insight: avg("insight"), voice: avg("trade_voice"), invented: rows.filter((x) => x.grade.invented).length, stockClaim: rows.filter((x) => x.grade.stock_claim).length, dodge: rows.filter((x) => x.grade.dodge || x.auto.dodge).length, resting: rows.filter((x) => x.resting).length, usd: Math.round(usd * 1e4) / 1e4, gradeUsd: Math.round(gradeUsd * 1e4) / 1e4, p50ms: pct(0.5), p90ms: pct(0.9), maxms: lat.at(-1) };
console.log(`== ${JSON.stringify(sum)}`);
const dir = new URL("./eval-runs/", import.meta.url);
mkdirSync(dir, { recursive: true });
writeFileSync(new URL(`agent2-${tag}-${new Date().toISOString().replace(/[:.]/g, "-")}-${(rows[0]?.model ?? model ?? "default").replace(/[^\w.-]+/g, "_")}.json`, dir), JSON.stringify({ sum, rows }, null, 2));
