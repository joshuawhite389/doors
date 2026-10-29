// The automated screen (Cultural Slot Framework §7): a model judge. The talking points' questions, points, pushback,
// line for the buyer and angle are written by Claude Haiku from Qloo's facts (group 3, src/talk.js); the rest of a
// card is Doors' code templates. The judge is Anthropic's Claude (Sonnet), through the local `claude -p` CLI on the owner's plan (no API key, no
// spend). Blind: the judge never sees which output had the cultural inputs on, and A/B order is fixed per item by a
// hash, so half the items put Doors first. Every verdict is cached in data/proof/judge-cache.json (private: the
// prompts carry Qloo's room text), so the report rebuilds offline; `--judge` re-asks only items not in the cache.
// It screens; it is never the only judge (§7): real reps judging blind is the next step, and stays marked untested.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ROOT } from "./harness.mjs";

export const CACHE = join(ROOT, "data/proof/judge-cache.json");
export const JUDGE_MODEL = "sonnet";
const SYSTEM = "You are an experienced beverage sales manager who has opened new cities for drink brands, evaluating planning output for field sales reps. Judge only what is in front of you. Output only one JSON object, no prose around it.";
const sha = (s) => createHash("sha256").update(s).digest("hex").slice(0, 16);

const load = () => (existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, "utf8")) : {});
function save(c) {
  mkdirSync(dirname(CACHE), { recursive: true });
  writeFileSync(CACHE, JSON.stringify(c, null, 1) + "\n");
}

// → {verdict, model, cached} or {error}. live=false: cache only (offline rebuild).
const used = new Set();
// Drop cached verdicts no item asked for this run (their prompts changed): the cache holds only what the report uses.
export function prune() {
  const c = load();
  const keep = Object.fromEntries(Object.entries(c).filter(([k]) => used.has(k)));
  if (Object.keys(keep).length !== Object.keys(c).length) save(keep);
  return Object.keys(c).length - Object.keys(keep).length;
}
export function ask(prompt, { live = false } = {}) {
  const key = sha(SYSTEM + "\n" + prompt);
  used.add(key);
  const cache = load();
  if (cache[key]) return { ...cache[key], cached: true };
  if (!live) return { error: "not in cache (run with --judge)" };
  const res = judgeNow(prompt);
  if (res.error) return res;
  cache[key] = res;
  save(cache);
  return { ...res, cached: false };
}
// One fresh judge call, no cache: → {verdict, model, at} or {error}. The both-orders re-ask uses it directly.
// schema (judge v2): the CLI is given the JSON shape (--json-schema) and its structured_output is the verdict.
export function judgeNow(prompt, { schema = null } = {}) {
  const r = spawnSync("claude", ["-p", prompt, "--setting-sources", "", "--model", JUDGE_MODEL, "--tools", "", "--no-session-persistence", "--system-prompt", SYSTEM, "--output-format", "json", ...(schema ? ["--json-schema", JSON.stringify(schema)] : [])], { encoding: "utf8", timeout: 180000, cwd: "/tmp" });
  if (r.status !== 0) return { error: `claude exited ${r.status}: ${(r.stderr || r.stdout).slice(0, 200)}` };
  let out;
  try {
    out = JSON.parse(r.stdout);
  } catch {
    return { error: "unreadable CLI output" };
  }
  if (schema) {
    if (!out.structured_output) return { error: `judge answered no structured output: ${String(out.result ?? "").slice(0, 120)}` };
    return { verdict: out.structured_output, model: Object.keys(out.modelUsage ?? {})[0] ?? JUDGE_MODEL, at: new Date().toISOString().slice(0, 10) };
  }
  const text = String(out.result ?? "");
  const m = /\{[\s\S]*\}/.exec(text);
  let verdict;
  try {
    verdict = JSON.parse(m?.[0] ?? "");
  } catch {
    // an unescaped quote inside "why": read the short fields one by one, keep "why" as far as it goes
    const f = (k) => new RegExp(`"${k}"\\s*:\\s*"([^"]*)"`).exec(text)?.[1] ?? new RegExp(`"${k}"\\s*:\\s*(\\d+)`).exec(text)?.[1];
    const keys = ["said", "applied", "done", "overall", "situation1", "confidence", "scoreX", "scoreY"];
    const v = Object.fromEntries(keys.map((k) => [k, f(k)]).filter(([, x]) => x != null).map(([k, x]) => [k, /^\d+$/.test(x) ? Number(x) : x]));
    if (!v.overall && !v.situation1) return { error: `judge answered no JSON: ${text.slice(0, 120)}` };
    verdict = { ...v, why: (/"why"\s*:\s*"([\s\S]*)"\s*\}?\s*$/.exec(text)?.[1] ?? "").slice(0, 600) };
  }
  const model = Object.keys(out.modelUsage ?? {})[0] ?? JUDGE_MODEL;
  return { verdict, model, at: new Date().toISOString().slice(0, 10) };
}

// ---------- what the judge sees ----------
// A run as a rep would read it: the first rooms of the list, day 1's first stops with their talking points and note.
// Doors' own provenance words (rank lines, "Qloo") are removed so the judge can't tell on from off by labels.
const scrub = (s) => String(s ?? "").replace(/Why you're here: .*$/m, "").replace(/\bQloo('s)?\b/g, "the data");
export function render(r, venuesOf) {
  const v = venuesOf(r);
  const rooms = r.top10.slice(0, 8).map((id, i) => `${i + 1}. ${v[id]?.name ?? id}${v[id]?.genre ? ` (${String(v[id].genre).split(":").pop().replace(/_/g, " ")})` : ""}${v[id]?.neighborhood ? `, ${v[id].neighborhood}` : ""}`);
  const stops = r.stops.slice(0, 2).map((s, i) => [
    `Stop ${i + 1}: ${s.name}${/#(\d+) of (\d+)/.test(s.rankLine) ? ` (#${/#(\d+) of (\d+)/.exec(s.rankLine)[1]} of ${/#(\d+) of (\d+)/.exec(s.rankLine)[2]} on this list; the day is planned driving-first, so a nearby lower-ranked room can come before a far higher one)` : ""}`,
    `  Opener: ${scrub(s.opener)}`,
    ...(s.toBuyer ? [`  To the buyer: ${scrub(s.toBuyer)}`] : []), // 2026-10-24: the line for the buyer is judged too
    `  Questions: ${s.questions.join(" / ")}`,
    `  Points: ${s.points.map(scrub).join(" / ")}`,
    `  Pushback: ${s.pushback.join(" / ")}`,
    `  The ask: ${s.ask}`,
    `  Note to the room:\n${s.note.split("\n").filter(Boolean).map((l) => `    ${l}`).join("\n")}`,
  ].join("\n"));
  return `Rooms on the list, best first:\n${rooms.join("\n")}\n\nDay 1, first stops:\n${stops.join("\n\n")}`;
}
export function context(s) {
  const p = s.profile;
  const signal = p.drinks?.length ? `the people they want are the ones who drink ${p.drinks.map((d) => d.name).join(" and ")}` : `rooms that already serve them: ${p.pours.map((x) => `${x.name} (${x.where})`).join(", ")}`;
  return `A rep for ${p.brand}, a ${p.what.toLowerCase()}, is opening ${s.cityName} and will walk into bars and restaurants. Signal: ${signal}. Rooms they pitch: ${p.rooms.join(", ")}.${p.pitch.ask ? ` Their own ask: "${p.pitch.ask}".` : ""}`;
}
export const flip = (key) => parseInt(sha(key).slice(0, 2), 16) % 2 === 1;

// Pairwise vs baseline at the framework's three levels: said (opener, questions, points, pushback), applied (the note),
// done (which rooms and in what order).
export function pairPrompt(ctx, a, b) {
  return `${ctx}

Two planning outputs for this rep follow, A and B. Compare them as the rep would use them, at three levels:
- "said": the opener, questions, points and pushback: are they right for this product and these rooms, natural, short, and free of claims the rep can't back?
- "applied": the note to the room: right for this product, this room and this city?
- "done": the rooms chosen and their order: are these the right doors for this product and this signal in this city?
Then an overall preference. "tie" is allowed when they are equal at that level.

=== A ===
${a}

=== B ===
${b}

Answer with JSON only: {"said":"A"|"B"|"tie","applied":"A"|"B"|"tie","done":"A"|"B"|"tie","overall":"A"|"B"|"tie","why":"one sentence"}`;
}

// Swap: both contexts, both outputs (shuffled), city names hidden in the OUTPUTS only (the situations name them): the
// judge must match by the rooms and words themselves. Then rate each output for its context.
export function swapPrompt(ctx1, ctx2, x, y, hide = []) {
  const h = (t) => hide.reduce((s, w) => s.split(w).join("[CITY]"), t);
  return `Two reps, two situations:
Situation 1: ${ctx1}
Situation 2: ${ctx2}

Two planning outputs follow, X and Y (city names hidden in them). One was made for each situation.

=== X ===
${h(x)}

=== Y ===
${h(y)}

1. Which output was made for Situation 1? 2. Taking each output with the situation it was made for (your matching), is it appropriate for that situation (right rooms for this product and signal, right words for this product)? Score 1–5 (5 = a sales manager would hand it to the rep as is).

Answer with JSON only: {"situation1":"X"|"Y","confidence":"low"|"medium"|"high","scoreX":1-5,"scoreY":1-5,"why":"one sentence"}`;
}

// One stop as the rep reads it (the return-visit pairs).
export function renderStop(st) {
  return [
    `Before you walk in: ${st.before.map(scrub).filter(Boolean).join(" / ")}`,
    `Opener: ${scrub(st.opener)}`,
    ...(st.toBuyer ? [`To the buyer: ${scrub(st.toBuyer)}`] : []),
    `Questions: ${st.questions.join(" / ")}`,
    `Pushback: ${st.pushback.join(" / ")}`,
    `The ask: ${st.ask}`,
    `Note to the room:\n${st.note.split("\n").filter(Boolean).map((l) => `    ${l}`).join("\n")}`,
  ].join("\n");
}
export function returnContext(s, venueName) {
  return `${context(s)} This is the rep's SECOND visit to ${venueName}: on Tuesday they talked to Sam, the bar manager, and logged "liked it, hesitant about price"; they agreed to come back Wednesday. Below is what the rep reads before walking back in on Wednesday.`;
}

// ---------- judge v2 (freeze, 2026-10-28, pre-registered before any v2 verdict was seen) ----------
// v1 asked for a pick (A, B or tie) at each level; with the written cards in the prompt the pick followed the output's
// position (the second output won 20 of 24 popularity asks and 24 of 24 return-visit asks, both orders). v2 asks for
// no pick: the judge first writes, for each output on its own, what is right and what is wrong for this rep, then
// scores that output 1–5 at each level against the rep's situation ("the two may get the same scores"). The winner of
// an ask is derived from the sums (tie when equal); a scenario's result sums both orders. Still fresh, still both orders,
// same system prompt, same model, same rendering of the cards. Why this fix and not stripping the shared text: a rep
// reads whole cards, and the popularity pair shares almost no text to strip; the known mitigations for position bias in
// pairwise model judging are to swap the order (done, not enough here) and to score each side with its evidence
// written first instead of forcing a pick, which is what v2 does.
export const SCORE_SCHEMA = { type: "object", additionalProperties: false, required: ["A", "B"], properties: Object.fromEntries(["A", "B"].map((k) => [k, { type: "object", additionalProperties: false, required: ["right", "wrong", "said", "applied", "done"], properties: { right: { type: "string" }, wrong: { type: "string" }, said: { type: "integer", minimum: 1, maximum: 5 }, applied: { type: "integer", minimum: 1, maximum: 5 }, done: { type: "integer", minimum: 1, maximum: 5 } } }])) };
export function scorePrompt(ctx, a, b) {
  return `${ctx}

Two planning outputs for this rep follow, A and B. Judge each one on its own, as the rep would use it, at three levels:
- "said": the opener, questions, points and pushback: are they right for this product and these rooms, natural, short, and free of claims the rep can't back?
- "applied": the note to the room: right for this product, this room and this city?
- "done": the rooms chosen and their order: are these the right doors for this product and this signal in this city?
For each output, first write what is right for this rep and what is wrong (one sentence each, plain words, no quotation marks), then score each level 1–5 (5 = a sales manager would hand it to the rep as is; 1 = would not use it). Score each output against the rep's situation, not against the other output; the two may get the same scores.

=== A ===
${a}

=== B ===
${b}

Answer with JSON only: {"A":{"right":"one sentence","wrong":"one sentence","said":1-5,"applied":1-5,"done":1-5},"B":{"right":"one sentence","wrong":"one sentence","said":1-5,"applied":1-5,"done":1-5}}`;
}
export const LEVELS = ["said", "applied", "done"];
export const total = (s) => LEVELS.reduce((a, l) => a + Number(s?.[l] ?? 0), 0);
export const cmp = (doors, base) => (total(doors) > total(base) ? "doors" : total(doors) < total(base) ? "baseline" : "tie");
