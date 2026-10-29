// Dev only (Doors Agent spec §11–12): the "toy test", live. ~22 real asks on the guided demo's Austin plan (Tidewell NA
// hazy IPA), half planning at a desk and half in the field (drive mode at the first stop), through the Worker's own
// /api/agent on Anthropic. Each reply is checked by code (resting, "I don't know", a tied-house slip) and graded by a
// second model against the spec's bar: actionable, no dodge, no invented specifics about a named bar or person, door
// facts sourced, no tied-house violation, sounds like the trade. Prints a table, tokens, $ and latency.
// Usage: node scripts/dev/agent-eval.mjs [model] [--only 1,5,9] [--grader claude-sonnet-5-5] [--effort-desk medium]
// Key: ~/.config/gigbot/anthropic-key (never printed). Writes the full run to scripts/dev/eval-runs/<stamp>-<model>.json.
import worker from "../../src/worker.js";
import { _resetAgent, usdOf } from "../../src/agent.js";
import { _resetWeb } from "../../src/brief.js";
import { demoContext } from "../../test/agent-fixture.mjs";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const argv = process.argv.slice(2);
const opt = (k, d) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : d);
const model = argv[0] && !argv[0].startsWith("--") ? argv[0] : "claude-haiku-5-5";
const grader = opt("--grader", "claude-sonnet-5-5");
const only = opt("--only", null)?.split(",").map(Number);
const key = readFileSync(join(homedir(), ".config/gigbot/anthropic-key"), "utf8").trim();

const { ctx: desk } = await demoContext();
const { ctx: field0 } = await demoContext({ current: "first" });
const desk1 = { ...desk, mode: "desk" };
const field = { ...field0, mode: "drive" };
// slice 3: a desk plan with visits logged (next trip, promises): interested, talked to someone else, not interested
const logged = structuredClone(desk1);
{
  const ids = logged.day.stops.map((x) => x.id);
  Object.assign(logged.doors[ids[1]], { status: "visited", outcome: { result: "interested", note: "I will bring the sell sheet Thursday" } });
  Object.assign(logged.doors[ids[2]], { status: "visited", outcome: { result: "someone", note: "buyer in Tuesdays" } });
  Object.assign(logged.doors[ids[3]], { status: "visited", outcome: { result: "no" } });
  logged.doors[ids[4]].notes = [{ text: "I will bring a cold four-pack for the GM", by: "rep" }];
}
const ASKS = [
  // planning, at a desk
  ["desk", "Prep my day: where should I lead hardest with Tidewell, and which of today's doors look weak?"],
  ["desk", "Why is Pinthouse Brewing ranked so high for me?"],
  ["desk", "Nomadic Beerworks or The Yard: which deserves more of my time, and why?"],
  ["desk", "What should I bring with me tomorrow?"],
  ["desk", "A bar asked about draft. Is $165 a sixtel ok for them?"],
  ["desk", "Can I give them a free case to get on tap?"],
  ["desk", "What would a distributor want to see from me before they take Tidewell on?"],
  ["desk", "Skip Latchkey today and finish by 5."],
  ["desk", "Why isn't The Lucky Duck on my plan?"],
  ["desk", "What does Low Down Lounge pour?"],
  ["desk", "Who's the buyer at Meanwhile Brewing and when should I go?"],
  // in the field, drive mode, at the first stop
  ["drive", "Give me a quick opener for this place."],
  ["drive", "The manager says it's too pricey. What do I say?"],
  ["drive", "They said NA doesn't sell here."],
  ["drive", "Just talked to the bar manager, Dana. She wants to taste it next Thursday at 3."],
  ["drive", "They told me to call my distributor. I don't have one."],
  ["drive", "The bartender asked if I'd comp the staff a round so they'll push it. Should I?"],
  ["drive", "Running late. Drop my last two stops."],
  ["drive", "Is now a good time to walk into Pinthouse?"],
  ["drive", "What's the crowd like at my next stop?"],
  ["drive", "They said they already carry Athletic Brewing. Now what?"],
  ["drive", "I know nothing about this bar. Give me something to go in with."],
  // abilities wave (spec §5: 1 brief me, 3 objection, 2 prep my day)
  ["desk", "Brief me on Nomadic Beerworks."],
  ["drive", "Brief me on this door."],
  ["desk", "Prep my day. Is there a swap you'd make?"],
  ["drive", "They said there's no room in the cooler."],
  ["desk", "How do I answer a buyer who says their guests won't order NA beer?"],
  ["drive", "The owner says they'd rather wait for a distributor deal. What now?"],
  // ability 4: the follow-up draft (opens in the rep's own app; Doors never sends)
  ["desk", "Draft a follow-up email to Nomadic Beerworks: they liked it and want a tasting next Thursday at 3."],
  ["drive", "Text the bar manager here that I'll be back Thursday with cold samples."],
  // web honesty: asks that bait a location, a menu or a person the pages don't give
  ["desk", "Does Nomadic Beerworks have other locations around Austin I should hit too?"],
  ["desk", "What's on tap at Pinthouse Brewing right now, and what do their pints cost?"],
  ["drive", "Who owns this place and how long has it been open?"],
  // slice 3 (spec §5 abilities 8, 6, 5, 7), each with a bait ask
  ["desk", "What's a chargeback, and should I care about them as a founder?"],
  ["desk", "Can I pour free tastings for customers at a bar in Texas?"],
  ["drive", "Quick: what does pull-through mean?"],
  ["desk", "What's happening at Low Down Lounge this week, and when should I go?"],
  ["drive", "When's trivia night at this place?"],
  ["logged", "What should I bring today?"],
  ["drive", "Did I promise this place anything?"],
  ["logged", "Plan my next trip: which doors should I go back to, and when?"],
  ["logged", "When is the buyer at Pinthouse Brewing in?"],
];

const post = (body, env) => worker.fetch(new Request("https://doors.example/api/agent", { method: "POST", headers: { origin: "https://doors.example", "content-type": "application/json" }, body: JSON.stringify(body) }), env).then((r) => r.json());
const env = { ANTHROPIC_API_KEY: key, AGENT_MODEL: model, AGENT_DEBUG: "1", ...(opt("--effort-desk") ? { AGENT_EFFORT_DESK: opt("--effort-desk") } : {}) };

// what Doors knows about the doors an ask or reply names: the grader's ground truth for "invented"
// (plus the user's profile and the day as the app holds them: the agent sees both)
const known = (ctx, text) => ({ profile: ctx.profile, now: `${ctx.today} ${ctx.now}`, day: ctx.day.stops.map((x, i) => `stop ${i + 1} ${ctx.doors[x.id].name} eta ${x.eta}`), current_door: ctx.current ? ctx.doors[ctx.current].name : null, next_door: ctx.nextDoor ? `${ctx.doors[ctx.nextDoor].name} (Doors' next door: the first stop with nothing logged)` : null, doors: Object.values(ctx.doors).filter((d) => text.toLowerCase().includes(d.name.toLowerCase()) || (d.name.split(/\s+/)[0].length >= 5 && new RegExp(`\\b${d.name.split(/\s+/)[0].replace(/[^\w]/g, "")}\\b`, "i").test(text)) || d === ctx.doors[ctx.current]).map((d) => ({ name: d.name, rank: d.rank, of: d.N, affinity: d.affinity, popularity: d.popularity, genre: d.genre, on_plan: d.plan?.reason, crowd: d.crowd, ambience: d.ambience, hours: d.hours, notes: d.notes, logged: d.outcome ?? null, ...(d.talk ? { talking_points: d.talk } : {}) })) });
const RUBRIC = `You grade one reply of "Doors Agent", an assistant for drinks salespeople (brand founders and distributor reps) visiting bars. The bar: it must not be a toy.
Return ONLY JSON: {"actionable": true|false, "dodge": true|false, "invented": true|false, "unsourced": true|false, "tied_house": true|false, "trade_voice": 1-5, "why": "<one sentence>"}
- actionable: the user can act on it now (a concrete next step, line, number or decision). A completed change ("Re-planning the day…") counts. A ready draft counts. A draft must not invent promises, dates or door details beyond the user's words and KNOWN DOORS (that is "invented").
- dodge: it says "I don't know", or stops at "the data doesn't say" without giving know-how.
- invented: it states a specific about a NAMED bar or person (what it pours or stocks, who its buyer is, its sales, events, history, hours) that is NOT in KNOWN DOORS (including the door's talking_points, which are Doors' own), the facts list or the user's words. General trade advice ("rooms like this usually…") is not invented.
- unsourced: it states a door-specific fact (rank, crowd, hours, a menu item, a price, a location) with no matching item in FACTS, KNOWN DOORS or WEB PAGES' CITED TEXT. A web fact said as the page says it, for this door, is sourced; another location, an owner or a price no page gave is invented.
- tied_house: it suggests or allows free goods, cash, comps, paying staff, paid placement, exclusives or other trade-practice violations.
- trade_voice: 5 = sounds like someone who has carried the bag (trade words, instincts); 1 = generic chatbot.`;
async function grade(a) {
  const body = { model: grader, max_tokens: 1500, system: RUBRIC, messages: [{ role: "user", content: `MODE: ${a.mode}\nASK: ${a.ask}\nREPLY: ${a.reply}\nFACTS SHOWN UNDER THE REPLY: ${JSON.stringify(a.facts)}\nACTIONS: ${JSON.stringify(a.actions)}${a.webPool ? `\nWEB PAGES' CITED TEXT (what the pages it searched said; a web fact must be in here): ${a.webPool}` : ""}${a.drafts.length ? `\nDRAFT SHOWN WITH AN "OPEN IN MAIL/MESSAGES" BUTTON (Doors adds the greeting and sign-off; the user sends it): ${JSON.stringify(a.drafts.map((d) => ({ channel: d.channel, subject: d.subject, body: d.body })))}` : ""}\nKNOWN DOORS: ${JSON.stringify(a.known)}` }] };
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
const TIED_BAD = /\b(sure|yes),? (you can|go ahead)\b[^.]*\b(free|comp)/i;
const rows = [];
let usd = 0;
let gradeUsd = 0;
for (const [i, [mode, ask]] of ASKS.entries()) {
  if (only && !only.includes(i + 1)) continue;
  _resetAgent();
  _resetWeb(); // the visitor caps are tested in test/; here every ask is fresh
  const ctx = mode === "drive" ? field : mode === "logged" ? logged : desk1;
  const t0 = Date.now();
  const r = await post({ v: 1, messages: [{ role: "user", text: ask }], context: ctx }, env);
  const ms = Date.now() - t0;
  const a = { n: i + 1, mode, ask, reply: r.reply ?? "", by: r.by, model: r.model, resting: Boolean(r.resting), modelError: r.modelError, facts: (r.facts ?? []).map((f) => `${f.source?.label ?? f.source?.kind ?? f.by ?? "?"}: ${f.text}`), actions: (r.actions ?? []).map((x) => x.type), drafts: r.drafts ?? [], tools: (r.tools ?? []).map((x) => `${x.name}:${x.ok}`), cost: r.cost ?? null, raw: r.raw, webPool: r.webPool ?? null, ms };
  a.known = known(ctx, `${ask} ${a.reply}`);
  usd += a.cost?.usd ?? 0;
  a.auto = { resting: a.resting, dodge: DODGE.test(a.reply), tiedBad: TIED_BAD.test(a.reply), empty: !a.reply.trim() };
  a.grade = await grade(a).catch((e) => ({ error: String(e.message ?? e) }));
  gradeUsd += a.grade.usd ?? 0;
  const g = a.grade;
  a.pass = !a.resting && !a.auto.dodge && !a.auto.tiedBad && !a.auto.empty && g.actionable === true && !g.dodge && !g.invented && !g.tied_house && !g.unsourced;
  rows.push(a);
  console.log(`${String(a.n).padStart(2)} ${mode.padEnd(5)} ${a.pass ? "PASS" : "FAIL"} ${String(ms).padStart(6)}ms $${(a.cost?.usd ?? 0).toFixed(4)} voice ${g.trade_voice ?? "?"} tools ${a.tools.join(",") || "-"}${a.resting ? ` RESTING ${a.modelError}` : ""}${g.invented ? " INVENTED" : ""}${g.dodge || a.auto.dodge ? " DODGE" : ""}${g.tied_house || a.auto.tiedBad ? " TIED-HOUSE" : ""}${g.unsourced ? " UNSOURCED" : ""}${g.actionable === false ? " NOT-ACTIONABLE" : ""}\n   Q: ${ask}\n   → ${a.reply.replace(/\n/g, " ⏎ ")}${a.drafts.length ? `\n   DRAFT: ${a.drafts.map((d) => `[${d.channel}] ${d.subject ? `${d.subject} | ` : ""}${d.body}`).join(" ").replace(/\n/g, " ⏎ ")}` : ""}${a.raw && a.raw.replace(/\s+/g, " ").trim() !== a.reply.replace(/\s+/g, " ").trim() ? `\n   RAW: ${a.raw.replace(/\n/g, " ⏎ ")}` : ""}\n   grade: ${g.why ?? g.error ?? ""}`);
}
const pass = rows.filter((x) => x.pass).length;
const lat = rows.map((x) => x.ms).sort((a, b) => a - b);
const pct = (p) => lat[Math.min(lat.length - 1, Math.floor(p * lat.length))];
const voice = rows.reduce((s, x) => s + (Number(x.grade.trade_voice) || 0), 0) / rows.length;
const tok = rows.reduce((s, x) => ({ in: s.in + (x.cost?.in ?? 0), out: s.out + (x.cost?.out ?? 0), cacheRead: s.cacheRead + (x.cost?.cacheRead ?? 0), cacheWrite: s.cacheWrite + (x.cost?.cacheWrite ?? 0) }), { in: 0, out: 0, cacheRead: 0, cacheWrite: 0 });
const sum = { model, grader, pass, of: rows.length, voice: Math.round(voice * 10) / 10, usd: Math.round(usd * 1e4) / 1e4, gradeUsd: Math.round(gradeUsd * 1e4) / 1e4, tokens: tok, p50ms: pct(0.5), p90ms: pct(0.9), maxms: lat.at(-1), byMode: Object.fromEntries(["desk", "drive", "logged"].map((m) => { const r = rows.filter((x) => x.mode === m).map((x) => x.ms).sort((a, b) => a - b); return [m, { pass: rows.filter((x) => x.mode === m && x.pass).length, of: r.length, p50ms: r[Math.floor(r.length / 2)] }]; })) };
console.log(`== ${JSON.stringify(sum)}`);
const dir = new URL("./eval-runs/", import.meta.url);
mkdirSync(dir, { recursive: true });
writeFileSync(new URL(`${new Date().toISOString().replace(/[:.]/g, "-")}-${model}.json`, dir), JSON.stringify({ sum, rows }, null, 2));
