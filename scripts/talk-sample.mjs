// Round 3 (talk2): a side-by-side of the talking points for a few doors, before (the baked g3 Haiku sets) and after
// (the g4 prompt on each model named), for Jard to judge before the full rebake. Same path as the app and the bake
// (lib/stopmodel.js → talkReq; src/talk.js talkTurn). Prints markdown; every call is logged in data/talk-bake.jsonl.
//   node scripts/talk-sample.mjs [--only=maya] [--doors=Pinthouse Brewing,…] [--models=claude-sonnet-5-5,claude-opus-5-5] [--n=3] > out.md
import { readFileSync, appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { examples } from "../public/lib/examples.js";
import { buildPool, windowsFor } from "../public/lib/pool.js";
import { planDays } from "../public/lib/schedule.js";
import { stopModel } from "../public/lib/stopmodel.js";
import { talkUser, bakedTalkKey, TALK_GEN_VERSION } from "../public/lib/talk-gen.js";
import { talkTurn } from "../src/talk.js";
import { enrichFacts } from "../public/lib/enrich.js";
import { deepFactsFor } from "../public/lib/deep.js";
import { noteFor } from "../public/lib/note.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k, d = null) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split("=")[1] ?? d;
const ONLY = arg("only", "maya");
const DOORS = arg("doors")?.split(",") ?? [];
const MODELS = arg("models", "claude-sonnet-5-5,claude-opus-5-5").split(",");
const N = Number(arg("n", 3));
const readJson = (rel) => JSON.parse(readFileSync(join(ROOT, rel), "utf8"));
const CITY_NAMES = { austin: "Austin", chicago: "Chicago", boise: "Boise", omaha: "Omaha" };
const key = readFileSync(join(homedir(), ".config/gigbot/anthropic-key"), "utf8").trim();
const facts = readJson("public/data/facts.json").facts ?? [];
const LEDGER = join(ROOT, "data/talk-bake.jsonl");

const ex = examples().find((e) => e.key === ONLY);
const profile = ex.profile;
const cityKey = profile.city;
const city = readJson(`public/data/cities/${cityKey}.json`);
const drinkerKeys = [...(profile.drinks ?? []).map((d) => d.key), ...((profile.pours ?? []).length ? ["parsons"] : [])];
const routes = drinkerKeys.map((k) => readJson(`public/data/routes/${k}-${cityKey}.json`));
const pool = buildPool({ routes, profile, cityName: CITY_NAMES[cityKey] });
const planned = planDays({ pool: pool.rows, statuses: pool.statuses, windows: windowsFor(profile), visitMin: profile.visitMin ?? 25, pinned: pool.pinned });
const plan = { city: { key: cityKey, name: CITY_NAMES[cityKey] }, profile, venues: { ...city.sisterVenues, ...pool.venues }, days: planned.days, pool: { ids: pool.ids, N: pool.N, label: pool.label }, statuses: pool.statuses };
const onPlan = planned.days.flatMap((d) => d.stops.map((s) => s.id));
const byName = (n) => Object.keys(plan.venues).find((id) => plan.venues[id]?.name === n);
const ids = [...new Set([...DOORS.map(byName).filter(Boolean), ...onPlan])].slice(0, N);
const baked = (() => { try { return readJson(`public/data/talk/${cityKey}.json`).sets ?? {}; } catch { return {}; } })();
const records = (() => { try { return readJson(`public/data/enrich/${cityKey}.json`).doors ?? {}; } catch { return {}; } })();
const enrich = Object.fromEntries(Object.entries(records).map(([id, r]) => [id, enrichFacts(r)]));
const deepFacts = deepFactsFor(records, { plan, routes, city, near: (() => { try { return readJson(`public/data/deep/${cityKey}.json`).near ?? null; } catch { return null; } })(), profile });

const words = (t) => String(t ?? "").trim().split(/\s+/).filter(Boolean).length;
export const setWords = (set) => !set ? 0 : [set.angle?.text, set.toBuyer?.text, ...(set.questions ?? []).map((q) => q.text), ...(set.points ?? []).map((q) => q.text), ...(set.pushback ?? []).flatMap((p) => [p.objection, p.reply])].reduce((a, t) => a + words(t), 0);
const show = (set) => {
  if (!set) return "_(no set: the template showed)_\n";
  const L = [`_${setWords(set)} words in all: angle ${words(set.angle?.text)}, buyer line ${words(set.toBuyer?.text)}, questions ${(set.questions ?? []).reduce((a, q) => a + words(q.text), 0)} (${(set.questions ?? []).length}), points ${(set.points ?? []).reduce((a, q) => a + words(q.text), 0)} (${(set.points ?? []).length}), pushback ${(set.pushback ?? []).reduce((a, p) => a + words(p.objection) + words(p.reply), 0)} (${(set.pushback ?? []).length})_`];
  if (set.opener) L.push(`**Opener:** ${set.opener.text}`);
  if (set.message) L.push(`**Drafted message:** _${set.message.subject}_\n\n${set.message.body.split(/\n+/).map((l) => `> ${l}`).join("\n>\n")}\n\n**Text:** ${set.message.sms}`);
  if (set.angle) L.push(`**Your angle (prep):** ${set.angle.text}`);
  if (set.toBuyer) L.push(`**To the buyer:** ${set.toBuyer.text}`);
  if (set.questions?.length) L.push(`**Questions:**\n${set.questions.map((q) => `- ${q.text}`).join("\n")}`);
  if (set.points?.length) L.push(`**Points:**\n${set.points.map((q) => `- ${q.text}`).join("\n")}`);
  if (set.pushback?.length) L.push(`**Pushback:**\n${set.pushback.map((p) => `- “${p.objection}” → ${p.reply}`).join("\n")}`);
  return L.join("\n\n") + "\n";
};

console.log(`# Talking points, before and after (${ex.name}, ${ex.brand}: ${profile.what}, ${CITY_NAMES[cityKey]})\n`);
console.log(`Before = the sets in the app today (g3 prompt, claude-haiku-5-5, low effort). After = the g4 prompt (one sharp insight, loose rules, Qloo's summary + hours + rank as facts) on each model, high effort. The ask is ${JSON.stringify(profile.pitch?.ask ?? "")}. Generated ${new Date().toISOString().slice(0, 16)}.\n`);
for (const id of ids) {
  const m = stopModel({ plan, id, city, facts, routes, enrich, deepFacts });
  if (!m.talkReq) continue;
  const bk = bakedTalkKey({ id, profile, ask: m.talk.ask });
  console.log(`\n## ${m.venue.name}\n`);
  console.log(`<details><summary>The facts the model saw (g4)</summary>\n\n\`\`\`\n${talkUser(m.talkReq)}\n\`\`\`\n</details>\n`);
  console.log(`### Before (today's app)\n\n**Opener (Doors' template):** ${m.talk.opener}\n\n**Drafted message (Doors' template):** _${m.note.subject}_\n\n${m.note.body.split(/\n+/).map((l) => `> ${l}`).join("\n>\n")}\n\n**Text:** ${m.note.sms ?? noteFor(m.note, "sms")}\n\n${show(baked[bk]?.set)}`);
  for (const model of MODELS) {
    const env = { ANTHROPIC_API_KEY: key, TALK_MODEL: model, TALK_VISITOR_DAILY: 1e6, TALK_WINDOW: 1e6, AGENT_USD_DAILY: 1000 };
    const t0 = Date.now();
    const r = await talkTurn({ tf: m.talkReq, env, ip: "sample" });
    appendFileSync(LEDGER, JSON.stringify({ at: new Date().toISOString(), ex: `sample:${ONLY}`, id, name: m.venue.name, model, ok: Boolean(r.set), reason: r.reason ?? null, usd: r.usd ?? 0, dropped: (r.droppedLines ?? r.dropped ?? []).map((d) => `${d.where}: ${d.reason}`) }) + "\n");
    console.log(`### After (${model}, ${TALK_GEN_VERSION}) · $${(r.usd ?? 0).toFixed(4)}, ${((Date.now() - t0) / 1000).toFixed(0)} s, ${r.tries} call${r.tries === 1 ? "" : "s"}${r.droppedLines?.length ? `, dropped ${r.droppedLines.length} line${r.droppedLines.length > 1 ? "s" : ""}` : ""}\n`);
    console.log(show(r.set));
    if (r.droppedLines?.length || r.dropped?.length) console.log(`<details><summary>Lines the checks dropped</summary>\n\n${(r.droppedLines ?? r.dropped).map((d) => `- ${d.where}: “${d.text}” → ${d.reason}`).join("\n")}\n</details>\n`);
    if (!r.set) console.log(`_(refused: ${r.reason})_\n`);
  }
}
