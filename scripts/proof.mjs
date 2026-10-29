// The proof report (Cultural Slot Framework §7, owner review 9 R9): runs the five probes over the fixed scenario set,
// adds the model screen from its cache, and writes docs/PROOF.md (the readable report) and data/proof/results.json
// (every row, private: it carries Qloo room text and ids). Offline: no Qloo call, no Gemini call.
//   node scripts/proof.mjs           rebuild from the cache (judge items missing from the cache are reported as such)
//   node scripts/proof.mjs --judge   also ask the judge (claude -p, Sonnet) for items not in the cache
//   scripts/proof-freeze.sh          the whole re-run for a freeze: judge, both-orders re-ask, report, doc-numbers check
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, routesFor, SLOTS, talkWanted } from "./proof/harness.mjs";
import { SCENARIOS, SWAPS, byKey } from "./proof/scenarios.mjs";
import { swapProbe, stabilityProbe, ablationProbe, labelProbe, emptyProbe, correctionProbe, talkProbe, baselineRun, summary, SIGNERS, CROWD_LABELS, PROFILE_LABELS } from "./proof/probes.mjs";
import { runScenario } from "./proof/harness.mjs";
import { ask, prune, render, renderStop, context, returnContext, pairPrompt, swapPrompt, flip, JUDGE_MODEL, total } from "./proof/judge.mjs";
import { slotsProbe, returnCase } from "./proof/slots-probes.mjs";

const live = process.argv.includes("--judge");
const venuesOf = (key) => () => Object.assign({}, ...routesFor(byKey(key).profile).map((x) => x.venues));
const t0 = Date.now();

const swap = swapProbe();
const stable = stabilityProbe();
const ablation = ablationProbe();
const labels = labelProbe();
const empty = emptyProbe();
const correction = correctionProbe();
const talk = talkProbe();
const slotsRes = slotsProbe();

// ---------- the model screen ----------
const pairs = SCENARIOS.map((s) => {
  const on = render(runScenario(s), venuesOf(s.key));
  const off = render(baselineRun(s), venuesOf(s.key));
  const f = flip(`pair:${s.key}`); // true: Doors is B
  const res = ask(pairPrompt(context(s), f ? off : on, f ? on : off), { live });
  const pick = (x) => (x === "tie" ? "tie" : (x === "A") !== f ? "doors" : "baseline");
  return { key: s.key, tags: s.tags, error: res.error ?? null, model: res.model ?? null, doorsIs: f ? "B" : "A",
    said: res.verdict && pick(res.verdict.said), applied: res.verdict && pick(res.verdict.applied), done: res.verdict && pick(res.verdict.done), overall: res.verdict && pick(res.verdict.overall), why: res.verdict?.why ?? null };
});
// The harder baseline: only the drinker slot off (the same app, the same words, rooms by popularity alone): does Qloo's
// taste ranking pick better doors than a popular-rooms list? Judged at the "done" level (and the rest, for the record).
const pairsRank = SCENARIOS.map((s) => {
  const on = render(runScenario(s), venuesOf(s.key));
  const off = render(runScenario(s, { off: ["drinker"] }), venuesOf(s.key));
  const f = flip(`rank:${s.key}`);
  const res = ask(pairPrompt(context(s), f ? off : on, f ? on : off), { live });
  const pick = (x) => (x === "tie" ? "tie" : (x === "A") !== f ? "doors" : "baseline");
  return { key: s.key, tags: s.tags, error: res.error ?? null, model: res.model ?? null, doorsIs: f ? "B" : "A",
    said: res.verdict && pick(res.verdict.said), applied: res.verdict && pick(res.verdict.applied), done: res.verdict && pick(res.verdict.done), overall: res.verdict && pick(res.verdict.overall), why: res.verdict?.why ?? null };
});
// Return visits (CULTURAL-SLOTS §7.6, W1): the stop with visit memory (S4 on) vs the same stop with S4 off.
const pairsReturn = SCENARIOS.map((s) => {
  const on = returnCase(s), off = returnCase(s, { slotsOff: ["S4"] });
  if (!on || !off) return { key: s.key, error: "the room isn't planned on Wednesday" };
  const f = flip(`return:${s.key}`);
  const res = ask(pairPrompt(returnContext(s, on.back.name), f ? renderStop(off.back) : renderStop(on.back), f ? renderStop(on.back) : renderStop(off.back)), { live });
  const pick = (x) => (x === "tie" ? "tie" : (x === "A") !== f ? "doors" : "baseline");
  return { key: s.key, error: res.error ?? null, model: res.model ?? null, doorsIs: f ? "B" : "A",
    said: res.verdict && pick(res.verdict.said), applied: res.verdict && pick(res.verdict.applied), done: res.verdict && pick(res.verdict.done), overall: res.verdict && pick(res.verdict.overall), why: res.verdict?.why ?? null };
});
const swapJudge = SWAPS.map(([a, b, kind]) => {
  const A = byKey(a), B = byKey(b);
  const ra = render(runScenario(A), venuesOf(a)), rb = render(runScenario(B), venuesOf(b));
  const f = flip(`swap:${a}:${b}`); // true: X is B's output
  const hide = kind === "city" ? [A.cityName, B.cityName] : [];
  const res = ask(swapPrompt(context(A), context(B), f ? rb : ra, f ? ra : rb, hide), { live });
  const v = res.verdict;
  return { a, b, kind, error: res.error ?? null, model: res.model ?? null,
    matched: v ? (v.situation1 === (f ? "Y" : "X")) : null, confidence: v?.confidence ?? null,
    scoreA: v ? (f ? v.scoreY : v.scoreX) : null, scoreB: v ? (f ? v.scoreX : v.scoreY) : null, why: v?.why ?? null };
});

const pruned = live ? prune() : 0; // only after a --judge run, so an offline rebuild never loses a verdict
// ---------- write ----------
const commit = (() => { try { return execSync("git rev-parse --short HEAD", { cwd: ROOT, encoding: "utf8" }).trim(); } catch { return "?"; } })();
const captured = JSON.parse(readFileSync(join(ROOT, "public/data/index.json"), "utf8")).captured;
const today = new Date().toISOString().slice(0, 10);
mkdirSync(join(ROOT, "data/proof"), { recursive: true });
writeFileSync(join(ROOT, "data/proof/results.json"), JSON.stringify({ today, commit, swap: swap.map(({ ra, rb, ...x }) => x), stable, ablation, labels, empty, correction, talk, slots: slotsRes, pairs, pairsRank, pairsReturn, swapJudge }, null, 1) + "\n");

const pct = (a, b) => (b ? `${a}/${b}` : "—");
const judged = pairs.filter((p) => !p.error);
const sj = swapJudge.filter((x) => !x.error);
const models = [...new Set([...judged, ...sj].map((x) => x.model).filter(Boolean))].join(", ") || `${JUDGE_MODEL} (no verdicts yet)`;
const count = (lvl, who, rows = judged) => rows.filter((p) => p[lvl] === who).length;
const judgedRank = pairsRank.filter((p) => !p.error);
// the popularity list's wins on "done" whose reason names a rank ("ranked #19", "lower-ranked"): PROOF finding 4
const rankWins = judgedRank.filter((p) => p.done === "baseline" && /#\d+|\b(low|lower|high|higher)-ranked\b|\branked\b/i.test(p.why ?? "")).map((p) => p.key);
const judgedReturn = pairsReturn.filter((p) => !p.error);
// the both-orders re-ask (scripts/proof/both-orders.mjs: fresh, uncached, each scenario A-first and B-first), if run
const bothPath = join(ROOT, "data/proof/both-orders.json");
const both = existsSync(bothPath) ? JSON.parse(readFileSync(bothPath, "utf8")) : null;
const bothOk = both ? both.rows.filter((r) => !r.error) : [];
// the return-visit pairs asked the same way (freeze 10-28), if run
const bothRetPath = join(ROOT, "data/proof/both-orders-return.json");
const bothRet = existsSync(bothRetPath) ? JSON.parse(readFileSync(bothRetPath, "utf8")) : null;
const bothRetOk = bothRet ? bothRet.rows.filter((r) => !r.error) : [];
// position: how often the judge's overall pick was whichever output came second (B), whatever it was
const secondWins = (rows) => rows.filter((r) => (r.doorsIs === "A" && r.overall === "baseline") || (r.doorsIs === "B" && r.overall === "doors")).length;
const retWon = (rows) => rows.filter((r) => r.overall === "doors").length;
// judge v2 (scores, pre-registered; scripts/proof/judge.mjs scorePrompt), if run: the same pairs, fresh, both orders
const v2Of = (rel) => { const pth = join(ROOT, rel); const f = existsSync(pth) ? JSON.parse(readFileSync(pth, "utf8")) : null; return { f, ok: f ? f.rows.filter((r) => !r.error) : [] }; };
const v2 = v2Of("data/proof/both-orders-v2.json"), v2Ret = v2Of("data/proof/both-orders-return-v2.json");
const nWon = (rows, who) => rows.filter((r) => r.overall === who).length;
const secondHigher = (rows) => rows.filter((r) => total(r.doorsIs === "A" ? r.baseline : r.doors) > total(r.doorsIs === "A" ? r.doors : r.baseline)).length;
const meanScore = (rows, side) => (rows.length ? (rows.reduce((a, r) => a + total(r[side]), 0) / rows.length).toFixed(1) : "—");
// by scenario: the two orders' totals summed
const byScenario = (rows) => { const m = new Map(); for (const r of rows) { const x = m.get(r.key) ?? { d: 0, b: 0 }; x.d += total(r.doors); x.b += total(r.baseline); m.set(r.key, x); } const v = [...m.values()]; return { doors: v.filter((x) => x.d > x.b).length, base: v.filter((x) => x.d < x.b).length, tie: v.filter((x) => x.d === x.b).length, n: v.length }; };
const v2Line = (x, baseName) => { const s = byScenario(x.ok); return `Doors ${nWon(x.ok, "doors")}, ${baseName} ${nWon(x.ok, "baseline")}, tie ${nWon(x.ok, "tie")}; by scenario ${s.doors}/${s.base}/${s.tie} of ${s.n}; mean score Doors ${meanScore(x.ok, "doors")} vs ${meanScore(x.ok, "baseline")} of 15; the second output scored higher in ${secondHigher(x.ok)}`; };
const slotRows = slotsRes.rows;
const slotGroups = [...new Set(slotRows.map((r) => r.probe))].map((p) => ({ probe: p, ...summary(slotRows.filter((r) => r.probe === p)) }));
const group = (rows) => {
  const m = new Map();
  for (const r of rows) m.set(r.case, [...(m.get(r.case) ?? []), r]);
  return [...m].map(([c, rs]) => ({ case: c, n: rs.length, pass: rs.filter((r) => r.ok).length, fails: rs.filter((r) => !r.ok).map((r) => `${r.key}: ${r.detail}`) }));
};
const labelGroups = [...new Set(labels.map((l) => l.probe))].map((p) => ({ probe: p, rows: labels.filter((l) => l.probe === p) }));
const scen = (k) => byKey(k);
const swapEx = swap.map((x) => ({ ...x, topA: x.ra.top10Names.slice(0, 3), topB: x.rb.top10Names.slice(0, 3), openA: x.ra.stops[0]?.opener, openB: x.rb.stops[0]?.opener }));
const tot = (rows) => summary(rows);
const all = { swap: tot(swap), stable: tot(stable), labels: tot(labels), empty: tot(empty), correction: tot(correction), talk: tot(talk) };

// round 3 (talk2): the written sets in this run, counted from the files the app and the harness read
const TALK_MODEL_NOW = "claude-sonnet-5-5";
const bakedSets = ["austin", "chicago", "boise", "omaha"].map((c) => { try { return Object.values(JSON.parse(readFileSync(join(ROOT, `public/data/talk/${c}.json`), "utf8")).sets ?? {}); } catch { return []; } }).flat();
const proofSets = (() => { try { return Object.values(JSON.parse(readFileSync(join(ROOT, "data/proof/talk-sets.json"), "utf8")).sets ?? {}); } catch { return []; } })();
const judgedStops = SCENARIOS.flatMap((s) => runScenario(s).stops);
const writtenStops = judgedStops.filter((s) => s.talkBy === "model");
const byModel = (sets) => Object.entries(sets.reduce((m, s) => ((m[s.model ?? "?"] = (m[s.model ?? "?"] ?? 0) + 1), m), {})).map(([m, n]) => `${n} by ${m}`).join(", ") || "none";
// how alike the written sets are: the share of question and point lines that appear word for word in more than one set
const lineShare = (sets) => { const seen = new Map(); for (const s of sets) for (const t of [...(s.set?.questions ?? []), ...(s.set?.points ?? [])].map((x) => x.text.toLowerCase())) seen.set(t, (seen.get(t) ?? 0) + 1); const all = [...seen.values()]; const dup = all.filter((n) => n > 1).reduce((a, n) => a + n, 0); return all.length ? `${dup} of ${all.reduce((a, n) => a + n, 0)}` : "0 of 0"; };

const md = `# Doors: proof tests (Cultural Slot Framework §7)

Generated ${today} by \`node scripts/proof.mjs\` at commit \`${commit}\`. Offline: precomputed Qloo data captured
${captured} (public/data), **0 live Qloo calls, 0 Gemini calls**. Every row: \`data/proof/results.json\` (private).

**At the freeze (\`v2-tour\` 27fa6dc9, 2026-10-28/29, this run).** No product change. Every stop's talking points were
written again on the frozen code through headless Claude Code on the owner's plan (\`scripts/proof/talk-fill.mjs\`,
the app's own call: Sonnet 5.5, high effort, the same prompt and checks; no API key, \$0): of the proof's
${proofSets.length} held sets, ${proofSets.filter((s) => s.via === "claude-code").length} were written this way and the rest kept from the round-3 fill where the facts had not changed;
${judgedStops.filter((s) => s.talkBy === "model").length} of the ${judgedStops.length} judged stops show a written set. Every judge item was re-asked on this text, and the return-visit
pairs were asked in both A/B orders for the first time (\`scripts/proof/both-orders.mjs\`). **The numbers moved, down:**
the last published run (\`v2-j12fix\`, 2026-10-24 text) read vs all slots off 12/12, popularity both orders 17/24, return visit 11/12,
swap matching 5/5; this run's are in the table below. The written cards are longer and more alike in quality on both
sides of a pair, and the judge's pick followed the output's position (§7, "Position"): the popularity and return-visit
screens now read as "could not tell them apart", the all-slots-off screen still reads Doors. **One probe fixed, no
app change:** the empty-slot "no number not in the inputs" check did not count a door's own site facts (the enrich
record: Centennial Crafted Beer & Eatery's "56 taps") as inputs and flagged the written line that quoted it; it now
does. Nothing was tuned to the judge.

**Since the last proof (round 3, \`v2-talk2\`, 2026-10-25).** Jard's round-3 review: the written talking points were
"a lot better" but two of three questions at every door were "do people ever ask for non-alcoholic beer" and "would
your staff be interested in a tasting"; "we could just have one page for the entirety of the route that says the same
thing"; what a rep would pay for "reveals an insight or deep market research on a specific door that will give them an
edge in their pitch". The generator was rewritten (g4, \`public/lib/talk-gen.js\`): the model is asked for ONE sharp
insight about this door (the angle) and to build the buyer line, questions, points and pushback on it, with fewer lines
when the facts are thin; it now also sees Qloo's own summary of the door (a brewpub's "award-winning house beers" is
the fact that makes a tap the wrong ask), the week's hours, price level and rating, and, as prep only, the door's rank
and Qloo's match for the rep's drinkers and who it ranks highest with. The model is **${TALK_MODEL_NOW}** at high
effort (was Haiku 5.5 at low effort).
**Rules dropped because they made every door read the same** (ROUND3-SPEC.md, Jard: "we are neutering our app"): the
buyer line must end in a taste offer; an alcohol alternative's set must say "for the guest who isn't drinking"; three
questions, three points and three pushback pairs; never a number; never "the crowd" (the demographic-word and
crowd-is checks); "stock", "pour", "carries" and "distribute" as banned words (a rep's words; the hype words stay
banned); a question must cite a room fact; a set needs two questions, two points and two room facts.
**Rules kept:** every line cites its facts and no number, name, event or feature outside them; nothing said about what
the door has unless a fact from its own site says so (the enrich lane's site facts, cited); the ask word for word when
a reply offers a start; never a statement that tells the buyer what their own room is like (\`toldTheRoom\`, R2); no
"Qloo", artist or sister door said out loud; no claim about other bars; a soft drink or an alcoholic drink is never
sold as the non-alcoholic option. **Qloo's crowd description and the age band are now sent** (Jard, 10-25: "it matters
that the crowd is a lot of Hispanic families but not BECAUSE they are Hispanic families… pretending you can't see facts
about a neighborhood, a market, a demographic is bad business… why is it there if not to be used"), under one rule the
prompt states and the validator holds (\`tasteGuess\`): the test for every line is "so what": a demographic shapes the
OCCASION (when, with what food, who is driving, how long people stay), and what people drink is carried only by the
evidence (the drink brands the crowd over-indexes on, the menu, the hours, the door's own site); a sentence that pairs a
group with a taste claim ("Hispanic families like a lighter beer", "retirees go for wine") is refused. **Two probe
rules changed.** (1) The label-invariance probe's room-label part encoded the rule just dropped (a room's demographic
label must not change the written questions and points). It is rewritten as a "so what" check: with the crowd text
set to each of the ${CROWD_LABELS.length} labels, the doors picked, the plan, the rooms filter and the ask must not move
(they never read the crowd text), the opener may echo the label and only the label, and no shown line (the written sets
and the template, over every scenario) pairs a group with a taste claim; the written lines themselves may now differ
by label, which is the point. The signer-name and no-field-label parts are unchanged. (2) The NA-framing check for a
written set was "NA framing iff the product is an alcohol alternative"; it is now "NA framing only if the product is an
alcohol alternative" (a written NA set is free to use the phrase or not; a non-NA set still never may; template stops
keep the two-way rule). The pushback \`OFFER\` rule and the rest are unchanged. **The model is Sonnet 5.5** by Jard's
call (the five-door sample favoured Opus 5.5 for sharpness; Jard: Sonnet, with the prompt asking for "the point, then
stop", "one strong line beats three", because Opus's brevity is what he wants and Sonnet runs wordier; the sample's word
counts are in \`../round3/ROUND3-TALK2-SAMPLE.md\`). **The opener and the drafted message are the model's too** (g6,
Jard 10-25, later): the same set carries the opener (hello, who the rep is, who buys here in this door's terms) and the
message (subject, body, text: a time and a taste, never the order), with \`{rep}\` and \`{when}\` placeholders the device
fills, so the rep's name is never sent and the visit time stays Doors' sum; a message must name the city and say when
(the checks the note always had); the NA-framing check over a written stop now reads the opener and the note too. The
judge saw the new openers and notes: every pair below was re-asked on this text. **No sign on the door says a model wrote the lines** (Jard:
"our users don't need to know how the sausage is made"); the privacy page names the model; the source rows count a
written line as a Qloo line ("from Qloo · this door's facts"). Every set was written again: the demo cities hold
${bakedSets.length} baked sets (${byModel(bakedSets)}); the proof's stops ${proofSets.length} sets
(${byModel(proofSets)}; ${talkWanted.size} stops have none and keep the template); of the ${judgedStops.length} judged
stops, ${writtenStops.length} show a written set. Sameness, measured: question and point lines that appear word for
word in more than one written set, ${lineShare(bakedSets)} across the baked sets (the same ask, "one case of cans in
the cooler", is the rep's own line and repeats by design).

**Before that (round 2 grounding, \`v2-r2ground\`, 2026-10-24).** Jard's round-2 review: a spoken line never
tells the buyer what their own room is like ("looks like you get music enthusiasts in here"). The written talking points
did, in 168 of the lines the app showed ("Your regulars come in for afternoons", "fits a room where people stay a while",
"Families come in here"). A new check, \`toldTheRoom\` in \`public/lib/talk-gen.js\`, refuses such a statement (a question
or an "if/when …" sentence may still name the room), and the prompt says the same. On the old sets it took the shown
lines from 168 to 0, sent 14 sets to the template and 115 buyer lines to the template's. The first prompt with the rule
(g2) had an example ("the bartender can hand it over fast") that the model copied at every door, so it was reworded
(g3: each door's lines built on its own facts) and every set was written again: the demo cities 281 of 291 doors
written (10 on the template), the proof's stops 482 of 484 sets (2 on the template); of the 36 judged stops, 35 are
written and 1 is on the template (was 36 and 0). Re-asked on the new text: same input 12/12, cultural slots off 12/12,
both orders 17/24 (by scenario 6/1/5, was 7/2/3). The return-visit card dropped from 12/12 to 11/12: in
\`mezcal-chicago-dj\` the judge preferred the first-visit card's room angle and staff tasting over the return card's price-sheet
opener (the return card's own lines are template, unchanged; the first-visit card's written set is new).

**Before that (group 3, \`v2-g3talk\`, 2026-10-24).** Each stop's questions, points, likely pushback, line for
the buyer and angle are now written by Claude Haiku from Qloo's facts about that door, the product and the ask
(\`src/talk.js\`, checked line by line by \`public/lib/talk-gen.js\`); the harness judges those written sets, as the app
shows them (\`data/proof/talk-sets.json\`, written once per set of facts by \`scripts/proof/talk-fill.mjs\`; a stop
whose set fails the checks keeps the template). Who to ask for, the timing, the opener, the ask and the drafted message
are unchanged. Lane A's place picture and fuller city files (more sister doors and music) are in this run too.
**The written sets first failed the code checks:** room demographic labels 24/36 (changing a room's crowd text to
"Hispanic families", "Black professionals", "LGBTQ+ couples" and the like changed the written questions and points),
swaps 3/5, blank "What you make" 62/74 and the talking-point checks 56/61, against 36/36, 5/5, 74/74 and 61/61 on the
template. Three product fixes followed, before any judging: Qloo's crowd description and the age band are no longer
sent to the model (the room's tags, its own description of the room and the menu still are); a line may frame the
product as non-alcoholic only when it is an alcohol alternative, and such a set must say it is for the guest who isn't
drinking (a canned water had been pitched as the non-alcoholic option); a blank "What you make" gets no written set.
**Two probe rules changed, both to read a written set in its own words:** (1) NA framing: was the template's phrases
("isn't drinking", "non-alcoholic drinks", "aren't drinking") in the opener, questions and pushback; for a written set it
is now \`NA_FRAME\` (those phrases plus "not drinking", "non-alcoholic", "alcohol-free", "zero-proof", "designated
driver" and the like) over its line for the buyer, questions, points and pushback, because the model words it its own
way; template stops keep the old rule. (2) The pushback's small start: was "the reply reads exactly '→ Then start with
<ask>.'"; for a written set it is now "every reply that offers a way to start (\`OFFER\`: "start with", "to start", "as a trial",
"first step", "try one …") contains the ask word for word", the same rule (the start is the rep's own ask) without the
template's wording; template stops keep the old rule. The validator applies the same \`OFFER\` rule, and refuses a line
that says what a room's guests already buy (it had written "your guests already buy agave spirits" where the data says
tequila: probe 2 caught it).

**Before that (2026-10-24, \`v2-openers\`, then \`v2-buyerjudge\`).** The openers and drafted messages were
rebuilt (Jard's note 5: the room's crowd is never said; a line for the buyer picked from Qloo's tags; a first message
that asks for a time and a taste, not the order; times as people say them) and every judged item was re-asked. Every
arm (Doors, all slots off, the popularity list, the first-visit card) runs the same new opener and message code; only
the switched-off slot differs. The judge's prompt now shows each stop's opener, line for the buyer, questions, points,
pushback, ask and note (and, for the return-visit pairs, the prep too). **Showing the judge the line for the buyer
lowered Doors' scores:** both orders 19/24 → 16/24 before any fix. The judge named two weak lines, and one round of
product fixes followed (no tuning to the judge after it): a soft drink's "for the kids, and for whoever's driving" came
from the word "families" in Qloo's crowd text (soft-boise), so the family angle now needs Qloo's own family tag; "for
the patio" was offered for late October in Omaha (pour-omaha), so the patio angle now needs a warm month for the room's
latitude. The fixes did not move the numbers (both orders 16/24). A third critique, a "generic soda-water pitch" for an
NA brand, stays as a finding, not fixed. With the family angle off the crowd text, **the crowd slot is inert in these
12 scenarios** (the ablation table below): it still decides the daytime and sports angles, and the prep line built from
them, but none of these scenarios hits those. **The one-order popularity figure swings from run to run** (8, 9, 5 and 6
of 12 across the last four runs), so the both-orders figure is the one to quote.

**Since then (judge pass 12, \`v2-j12fix\`).** One product fix changed what Doors says: the lunch angle ("for the person
who wants a beer at lunch and still has to work after", picked from a daytime tag such as Qloo's "coffee culture") is
now offered only when she arrives before 2:30 pm, or never when the arrival time is unknown; later visits fall through
to the next angle. Both internal personas rejected it at the tour's hero door, a brewery visited around 3:30 pm. Every
judged item whose text changed was re-asked, with no tuning: both orders 16/24 → 17/24, popularity one way 5/12 → 6/12,
the other screens unchanged (12/12, 11/12, 5/5).

**What was tested.** Doors' real pipeline, the same pure modules the page runs (\`lib/pool.js\` ranking and Rooms
filter → \`lib/schedule.js\` the day plans → \`lib/stopmodel.js\` the note, the talking points and the ask), on a fixed set
of ${SCENARIOS.length} scenarios: ${SCENARIOS.map((s) => `\`${s.key}\``).join(", ")}. Hard cases: NA brand (${SCENARIOS.filter((s) => s.tags.includes("na")).length}),
soft drink (${SCENARIOS.filter((s) => s.tags.includes("soft")).length}), pour-rooms only, no drinker brand (${SCENARIOS.filter((s) => s.tags.includes("pour")).length}), small city: Boise, Omaha (${SCENARIOS.filter((s) => s.tags.includes("small")).length}). Reps and brands are made up; every venue is real.

**Who judged.** (1) Code checks, deterministic, in this repo (\`scripts/proof/probes.mjs\`; the same checks run in
\`npm test\` as \`test/proof.test.mjs\`). (2) A model screen: **${models}** (Anthropic), blind A/B, through the
\`claude\` CLI. The talking points' angle, line for the buyer, questions, points and pushback are written by Claude
Sonnet (\`${TALK_MODEL_NOW}\`, Anthropic; Haiku 5.5 until round 3) from Qloo's facts about each door (\`src/talk.js\`); the
judge is Claude Sonnet (Anthropic). Both are Anthropic models. The rest of each card is Doors' code templates. (3) **Human judges: the owner only.** No
working rep or founder is available to judge (Jard, 2026-10-22, Q1), so a human claim can only read "owner-reviewed,
n = 1", and only once he has reviewed it: **owner review pending** as of this run. The model screen is never the only
judge, and no claim here rests on it alone.

## Results

| Probe | n | Pass | Judged by |
|---|---|---|---|
| Swap: same brand, another city or drinker signal → visibly different rooms and plan, each appropriate | ${all.swap.n} pairs | ${all.swap.pass} | code |
| Stability: same input, ${stable[0]?.runs ?? 3} runs → identical output | ${all.stable.n} scenarios | ${all.stable.pass} | code |
| Ablation: each slot off alone | ${SLOTS.length} slots × ≤ ${SCENARIOS.length} | ${ablation.filter((a) => !a.inert).length} of ${SLOTS.length} slots change a decision | code |
| Label invariance: same signals, other demographic labels → no decision changes | ${all.labels.n} (${SCENARIOS.length} scenarios × 3 probes) | ${all.labels.pass} | code |
| Empty slot: no signal → ask or neutral, never invent | ${all.empty.n} | ${all.empty.pass} | code |
| Correction: the rep's correction persists (reload) and wins | ${all.correction.n} | ${all.correction.pass} | code |
| Talking points the screen caught (below, 1, 2, 3, 5) stay fixed | ${all.talk.n} | ${all.talk.pass} | code |
| R9 slots (S4 return visit, S3 SMS, S6 corrections, S1 type fix): ${slotGroups.map((g) => `${g.probe} ${g.pass}/${g.n}`).join(", ")} | ${slotRows.length} | ${summary(slotRows).pass} | code |
| Doors vs baseline (all slots off), blind pairwise | ${judged.length} scenarios | overall Doors ${count("overall", "doors")}, baseline ${count("overall", "baseline")}, tie ${count("overall", "tie")} | ${models} |
| Doors vs popularity list (drinker slot off only), blind pairwise | ${judgedRank.length} scenarios | done: Doors ${count("done", "doors", judgedRank)}, baseline ${count("done", "baseline", judgedRank)}, tie ${count("done", "tie", judgedRank)} | ${models} |
${both ? `| Doors vs popularity list, asked fresh in both A/B orders, judge v1 (a pick; position-biased: the second output won ${secondWins(bothOk)} of ${bothOk.length}) (\`scripts/proof/both-orders.mjs\`, at \`${both.commit}\`) | ${bothOk.length} asks (${SCENARIOS.length} × 2) | overall Doors ${bothOk.filter((r) => r.overall === "doors").length}, baseline ${bothOk.filter((r) => r.overall === "baseline").length}, tie ${bothOk.filter((r) => r.overall === "tie").length} | ${models} |\n` : ""}${v2.f ? `| Doors vs popularity list, both orders, **judge v2** (scores per output, evidence first; pre-registered, at \`${v2.f.commit}\`) | ${v2.ok.length} asks | ${v2Line(v2, "popularity")} | ${models} |\n` : ""}| Return visit: memory (S4) on vs off, blind pairwise | ${judgedReturn.length} scenarios | overall Doors ${count("overall", "doors", judgedReturn)}, S4 off ${count("overall", "baseline", judgedReturn)}, tie ${count("overall", "tie", judgedReturn)} | ${models} |
${bothRet ? `| Return visit, asked fresh in both A/B orders, judge v1 (a pick; position-biased: the second output won ${secondWins(bothRetOk)} of ${bothRetOk.length}) (at \`${bothRet.commit}\`) | ${bothRetOk.length} asks (${bothRetOk.length / 2} × 2) | overall Doors ${retWon(bothRetOk)}, S4 off ${bothRetOk.filter((r) => r.overall === "baseline").length}, tie ${bothRetOk.filter((r) => r.overall === "tie").length} | ${models} |\n` : ""}${v2Ret.f ? `| Return visit, both orders, **judge v2** (scores per output, evidence first; pre-registered, at \`${v2Ret.f.commit}\`) | ${v2Ret.ok.length} asks | ${v2Line(v2Ret, "S4 off")} | ${models} |\n` : ""}| Swap, blind matching (city names hidden in the outputs) | ${sj.length} pairs | matched ${sj.filter((x) => x.matched).length}/${sj.length} | ${models} |

## 1. Swap and stability

Same brand and product; one thing changed. "Overlap" = Jaccard overlap of the top 10 rooms and of day 1's stops.
"Appropriate" = code checks on each side: every planned room inside the city (≤ 40 km) and of a kind the rep picked;
the ask is the rep's or the kind's default; NA framing iff the product is an NA alternative; the note names the city.

| Pair | Changed | Top-10 overlap | Day-1 overlap | Decisions that moved | Appropriate (A / B) |
|---|---|---|---|---|---|
${swap.map((x) => `| \`${x.a}\` → \`${x.b}\` | ${x.kind} | ${x.top10Overlap.toFixed(2)} | ${x.day1Overlap.toFixed(2)} | ${x.changed.join(", ")} | ${x.appropriateA.ok ? "yes" : "NO"} / ${x.appropriateB.ok ? "yes" : "NO"} |`).join("\n")}

Examples (first three rooms on each list):
${swapEx.map((x) => `- **${scen(x.a).profile.brand}, ${x.kind} swap.** \`${x.a}\`: ${x.topA.join("; ")}. \`${x.b}\`: ${x.topB.join("; ")}.`).join("\n")}

A city swap's overlap is 0 by construction (another city's rooms are other rooms), so for city swaps the
substance is the appropriateness checks here and the model screen's per-output scores (§6). The drinker swaps are the
real test of "visibly different": same city, same rooms available, another taste signal.

Stability: ${all.stable.pass}/${all.stable.n} scenarios gave a byte-identical decision record on every run (sha256 of the record).

## 2. Ablation: each slot off alone

A slot "off" means its input is withheld from the real code (not a flag inside it). Columns count scenarios where that
decision changed. A slot that changes nothing is decoration (§3.1).

| Slot | Framework | Source (authority) | Off means | n | Changed in | Ranking | Plan | Arrival | Opener | Questions | Points | Pushback | Ask | Facts | Note | Hook | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
${ablation.map((a) => `| ${a.slot} | ${a.framework} | ${a.source} | ${a.offMeans} | ${a.n} | ${a.changedIn} | ${a.fieldCounts.ranking} | ${a.fieldCounts.plan} | ${a.fieldCounts.arrival} | ${a.fieldCounts.opener} | ${a.fieldCounts.questions} | ${a.fieldCounts.points} | ${a.fieldCounts.pushback} | ${a.fieldCounts.ask} | ${a.fieldCounts.facts} | ${a.fieldCounts.note} | ${a.fieldCounts.hook} | ${a.inert ? "**inert**" : "earns its place"} |`).join("\n")}

Read with care: the drinker, rooms and venue-type slots change *which rooms* are planned, so the talking-point
columns for them partly reflect a different room, not only different words. The kind, NA, crowd, sisters, pours, timing, lead, hooks and
ask slots never move the plan; tod and heat are meant to move the day a door goes on (heat: the first day works the
top neighbourhoods of Qloo's map for the brand's fans); the others' columns are words at the same rooms.

## 3. Label invariance

| Probe | What changed | n per scenario | Scenarios passing | Decisions that moved |
|---|---|---|---|---|
${labelGroups.map((g) => `| ${g.probe} | ${g.probe === "signer name" ? SIGNERS.join(", ") : g.probe.startsWith("room") ? CROWD_LABELS.map((l) => `"${l}"`).join(", ") + " as every room's crowd text" : PROFILE_LABELS.map((l) => JSON.stringify(l)).join(", ")} | ${g.rows[0].n} | ${g.rows.filter((r) => r.ok).length}/${g.rows.length} | ${[...new Set(g.rows.flatMap((r) => r.changed))].join(", ") || "none"} |`).join("\n")}

Signer name: the whole record is identical once the first name is masked. Room labels: ranking, Rooms, plan,
questions, points, pushback, ask and facts never moved (checked); since 2026-10-24 nothing said out loud or sent quotes
the crowd text: it only picks the angle (the rep's private prep and the line for the buyer), and never adds a
demographic that wasn't there. Doors has no field for the rep's or the audience's
demographics, and adding one to a profile changes nothing.

## 4. Empty slot

| Case | n | Pass | Failures |
|---|---|---|---|
${group(empty).map((g) => `| ${g.case} | ${g.n} | ${g.pass} | ${g.fails.join("; ") || "—"} |`).join("\n")}

"No number not in the inputs": every number in the talking points and the note appears in the rep's profile, the
facts file (sourced), the room's own record or the rank line; times come from the plan.

## 5. Correction

The store is the app's own (\`lib/store.js\`) over an in-memory storage; "reload" = a new store over the same storage.

| Case | n | Pass | Failures |
|---|---|---|---|
${group(correction).map((g) => `| ${g.case} | ${g.n} | ${g.pass} | ${g.fails.join("; ") || "—"} |`).join("\n")}

Untested here: corrections through the chat agent (\`edit_talking_points\`, \`remember\`) and the slot records of
\`docs/CULTURAL-SLOTS.md\`: neither is merged into v2-tour yet.

## 6. R9 slots (docs/CULTURAL-SLOTS.md, merged at 27451e2)

On every scenario: day 1's first room is visited Tuesday and logged as a follow-up for Wednesday (talked to "Sam (bar
manager)", "liked it, hesitant about price"); Wednesday's showing is the return visit. Switches are \`stopModel\`'s own
\`slotsOff\`. Corrections go through the app's store (\`setSlots\`, \`setRules\`) and a reload.${slotsRes.skipped.length ? ` Skipped (room not planned Wednesday): ${slotsRes.skipped.join(", ")}.` : ""}

| Probe | Case | n | Pass | Failures |
|---|---|---|---|---|
${[...new Set(slotRows.map((r) => `${r.probe}\u0000${r.case}`))].map((k) => { const [p, c] = k.split("\u0000"); const rs = slotRows.filter((r) => r.probe === p && r.case === c); return `| ${p} | ${c} | ${rs.length} | ${rs.filter((r) => r.ok).length} | ${rs.filter((r) => !r.ok).map((r) => r.key).join(", ") || "—"} |`; }).join("\n")}

S1 timing by venue type (B5) is in the ablation table (§2, slot \`timing\`). Untested here: the envelope and \`checkReply\` in the chat
agent (the agent job's tests), the "What you logged" editor UI.

## 7. Model screen (${models}, blind)

One verdict per item (temperature as the CLI sets it), cached; asking again can flip a close item. Treat these as a
screen: the direction across ${judged.length + judgedRank.length + judgedReturn.length + sj.length} items, not any single verdict.

**Position (freeze, 2026-10-28).** With the written talking points, the opener and the line for the buyer in the
prompt, the judge's overall pick was whichever output came SECOND in ${secondWins(judged)} of ${judged.length} (vs all slots off),
${secondWins(judgedRank)} of ${judgedRank.length} (vs the popularity list) and ${secondWins(judgedReturn)} of ${judgedReturn.length} (return visit) one-order asks${both ? `, and in ${secondWins(bothOk)} of ${bothOk.length} popularity asks` : ""}${bothRet ? ` and ${secondWins(bothRetOk)} of ${bothRetOk.length} return-visit asks when each item was asked in both orders` : ""}.
Where the two outputs are close (the same words at other rooms; the same room with and without visit memory) the
one-order figures measure position, not Doors: quote the both-orders figures, and read a both-orders figure near half
as "the judge could not tell them apart", not as a win or a loss. The all-slots-off screen is the one the position
did not decide.

**Judge v2, pre-registered (written and committed 2026-10-29 ~00:00, before any v2 verdict was seen; gigbot's call:
"a judge that picks whichever came second has stopped measuring; one pre-registered fix, then publish whatever it says,
no third try").** The fix: no pick. For each output on its own the judge first writes what is right and what is wrong
for this rep (one sentence each), then scores that output 1–5 at said, applied and done against the rep's situation,
"the two may get the same scores" (\`scripts/proof/judge.mjs\` \`scorePrompt\`, answer shape enforced by a JSON
schema). An ask's winner is derived from the two sums (tie when equal); a scenario's result sums both orders. Same
cards, same rendering, same system prompt, same model, fresh, both orders. Why this and not stripping the text the two
outputs share: a rep reads whole cards, and the popularity pair shares almost no text; the known mitigations for
position bias in pairwise model judging are swapping the order (done; not enough here) and scoring each side with its
evidence written first instead of forcing a pick, which this does. Position in v2 is measured as "the second output's
total was higher" (ties excluded). The v1 rows stay in the table, marked position-biased, whichever way v2 comes out.
${v2.f || v2Ret.f ? `**Judge v2 result.**${v2.f ? ` Popularity list: ${v2Line(v2, "popularity")} of ${v2.ok.length} asks (ties on the total ${v2.ok.filter((r) => total(r.doors) === total(r.baseline)).length}).` : ""}${v2Ret.f ? ` Return visit: ${v2Line(v2Ret, "the first-visit card")} of ${v2Ret.ok.length} asks (ties ${v2Ret.ok.filter((r) => total(r.doors) === total(r.baseline)).length}).` : ""} ${(() => { const rows = [...v2.ok, ...v2Ret.ok]; const sec = secondHigher(rows), ties = rows.filter((r) => total(r.doors) === total(r.baseline)).length; const n = rows.length - ties; return n && sec / n >= 0.8 ? `**v2 is position-biased too** (the second output scored higher in ${sec} of the ${n} asks that were not ties): it stops here, no third judge; these screens stay "not separated by a model judge".` : `Position in v2: the second output scored higher in ${sec} of the ${n} asks that were not ties (${ties} ties), so v2's figures are the ones to quote for these two screens.`; })()}` : "Judge v2 has not been run yet."}

**Doors vs baseline.** Baseline = the same app with every applicable slot off at once (rooms by popularity alone, every
kind of room, kind "other", no crowd text, no genre, no sister rooms, no rep ask or rooms). A/B order by hash: Doors was
A in ${judged.filter((p) => p.doorsIs === "A").length} and B in ${judged.filter((p) => p.doorsIs === "B").length}.

| Level | Doors | Baseline | Tie |
|---|---|---|---|
${["said", "applied", "done", "overall"].map((l) => `| ${l} | ${count(l, "doors")} | ${count(l, "baseline")} | ${count(l, "tie")} |`).join("\n")}

| Scenario | Said | Applied | Done | Overall | Judge's reason |
|---|---|---|---|---|---|
${pairs.map((p) => (p.error ? `| \`${p.key}\` | — | — | — | — | not judged: ${p.error} |` : `| \`${p.key}\` | ${p.said} | ${p.applied} | ${p.done} | ${p.overall} | ${String(p.why ?? "").replace(/\|/g, "/")} |`)).join("\n")}

**Doors vs a popularity list (the harder baseline).** Only the drinker slot off: the same app and the same words, the
city's rooms ordered by Qloo popularity instead of by the drinker's taste. The question it answers: does the taste
ranking pick better doors than a "popular bars" list?

| Level | Doors | Popularity list | Tie |
|---|---|---|---|
${["said", "applied", "done", "overall"].map((l) => `| ${l} | ${count(l, "doors", judgedRank)} | ${count(l, "baseline", judgedRank)} | ${count(l, "tie", judgedRank)} |`).join("\n")}

| Scenario | Done | Overall | Judge's reason |
|---|---|---|---|
${pairsRank.map((p) => (p.error ? `| \`${p.key}\` | — | — | not judged: ${p.error} |` : `| \`${p.key}\` | ${p.done} | ${p.overall} | ${String(p.why ?? "").replace(/\|/g, "/")} |`)).join("\n")}

**Return visit: visit memory (S4) on vs off.** The same room on Wednesday after Tuesday's logged visit; the context tells
the judge what happened on Tuesday. Off = what Doors said before R9 (a first-visit card).

| Level | S4 on | S4 off | Tie |
|---|---|---|---|
${["said", "applied", "done", "overall"].map((l) => `| ${l} | ${count(l, "doors", judgedReturn)} | ${count(l, "baseline", judgedReturn)} | ${count(l, "tie", judgedReturn)} |`).join("\n")}

| Scenario | Overall | Judge's reason |
|---|---|---|
${pairsReturn.map((p) => (p.error ? `| \`${p.key}\` | — | not judged: ${p.error} |` : `| \`${p.key}\` | ${p.overall} | ${String(p.why ?? "").replace(/\|/g, "/")} |`)).join("\n")}

**Swap matching.** The judge got both situations and both outputs, shuffled, with city names hidden, and had to say
which output was made for which situation, then score each 1–5 for its situation. The situations name their cities;
the outputs don't, so a city match has to come from the rooms themselves.

| Pair | Kind | Matched | Confidence | Score A | Score B | Judge's reason |
|---|---|---|---|---|---|---|
${swapJudge.map((x) => (x.error ? `| \`${x.a}\` / \`${x.b}\` | ${x.kind} | — | — | — | — | not judged: ${x.error} |` : `| \`${x.a}\` / \`${x.b}\` | ${x.kind} | ${x.matched ? "yes" : "no"} | ${x.confidence} | ${x.scoreA} | ${x.scoreB} | ${String(x.why ?? "").replace(/\|/g, "/")} |`)).join("\n")}

## Found by the screen, checked by hand

The judge's reasons pointed at these; each was reproduced in the harness output. 1, 2, 3 and 5 are fixed (branch
v2-talkfix) and held by code checks over every scenario (\`talkProbe\`, ${all.talk.pass}/${all.talk.n}; on the code before
the fix it fails 42 of them); 4 is open, the owner's call. The model screen above is re-run on the fixed text only with
\`--judge\`: until then a changed output shows as "not judged".

| Check | n | Pass | Failures |
|---|---|---|---|
${group(talk).map((g) => `| ${g.case} | ${g.n} | ${g.pass} | ${g.fails.join("; ") || "—"} |`).join("\n")}

1. **Fixed: the pushback's small start is the stop's own ask.** Was: "start small" ignored the rep's own ask. \`pour-austin\`: the ask is "a cider on draft for a
   month", the pushback says "start small: one case of cans, no keg" (\`talk.js\` \`small\` is by kind only). The R9
   return-visit price reply has the same gap ("Start with one case at $44" against a draft ask; "$420 a case" against
   a one-bottle start): before the fix it lost \`pour-omaha\` in the return-visit screen. Now: "Then start with a cider on draft for a
   month", and a price rides along only in the ask's own unit.
2. **Fixed: "We already have X → your guests already buy …" names X's own category.** Was, \`mezcal-chicago\`:
   "We already have Casamigos → Good: your guests already buy small-batch mezcal". Casamigos is a tequila; the
   \`same\` test in \`talk.js\` compared only the NA flag. Now: "your guests already buy tequila" (the held brand's
   category, \`core.BRAND_CATEGORY\`), and no claim when the category is unknown or another kind.
3. **Fixed: a blank "What you make" talked broken English.** Was: "What do your regulars order when they want drink?", "What do
   you carry in drink right now", "Tidewell is a drink". Neutral (no invented category, checked in §4), but not
   sayable. Now neutral and sayable: "What do your regulars order these days?", "What's on your drinks list right now,
   and what moves?", "That won't sell here."
4. **Open: day 1 can open at a low-ranked room.** The planner is driving-first (a room goes on a day if it adds
   ≤ 15 min to the loop; rank only breaks near-ties), so a lower-ranked room can come first. That is the owner's call
   (README, "driving first"), so it is a trade-off to show, not a bug. The popularity list won ${count("done", "baseline", judgedRank)} of
   ${judgedRank.length} on "done"; the judge's reason names a stop's rank in ${rankWins.length ? rankWins.map((k) => `\`${k}\``).join(", ") : "none of them"}.
   The popularity baseline is planned with the same week fill (fill by rank, then route), so its day 1 also opens on
   its own top rooms; that, not a change in Doors' own lists, is why the both-orders re-ask fell from 16 to 12 of 24
   when fill by rank came in (b252f71).${both ? ` Asked again at \`${both.commit}\`: ${bothOk.filter((r) => r.overall === "doors").length} of ${bothOk.length}.` : ""}
   Judge noise is large here: with the same rooms in the same order, fresh re-asks of one item can flip (2026-10-23:
   5adc790 vs c21ae83 changed words only, rooms identical in every list, and \`mezcal-omaha\`, \`soft-chicago\` and
   \`soft-boise\` flipped on "done"; re-asked fresh, \`soft-boise\` flipped back on both texts). Read one-off moves of a
   single scenario as noise, not as a change in Doors.

5. **Fixed: a wrong Qloo drinks tag made the gate question read oddly.** Was: Armitage Alehouse (\`mezcal-chicago-dj\`)
   is tagged "Non alcoholic only", so the R9 deep lead asks "Do you serve any alcohol at all, or is it all
   non-alcoholic here?" and turns the ask into a sample. Sourced and phrased as a question (safe), but an alehouse. Now
   "Non alcoholic only" counts only when no alcohol tag sits beside it and the name and genre don't say the room pours;
   Armitage gets the cocktail question instead.
   Related: with "Your ask" blank, a spirit's ask is now per room from Qloo's tags ("one bottle for a cocktail on the
   menu"), not the default the form shows on the field; sourced, but the form no longer shows every ask the notes use.

Harness artefact, not Doors: hiding city names in the swap outputs also blanks a city inside a venue's name ("[CITY]").

## What may be claimed (§8)

Quote these as written, with their n and judge:
${[
  `- "Same brand, two cities: across ${all.swap.n} swaps (${SWAPS.filter((x) => x[2] === "city").length} city, ${SWAPS.filter((x) => x[2] === "audience").length} drinker), Doors' top-10 rooms overlapped at most ${Math.max(...swap.map((x) => x.top10Overlap)).toFixed(2)} (Jaccard), every plan passed ${all.swap.pass === all.swap.n ? "all" : "not all"} appropriateness code checks, and the same input gave identical output on ${all.stable.pass}/${all.stable.n} scenarios. Judged by code checks, offline, on Qloo data captured ${captured}."`,
  `- "Switching a rep's name or the demographic words in a room's profile changed no ranking, plan, question, ask or fact in ${labels.filter((l) => l.probe !== "signer name" || true).filter((l) => l.ok).length}/${all.labels.n} probes across ${SCENARIOS.length} scenarios (code checks)."`,
  `- "With no signal, Doors asks or stays neutral: ${all.empty.pass}/${all.empty.n} empty-slot checks; a rep's correction persisted and won in ${all.correction.pass}/${all.correction.n} checks (code checks)."`,
  `- "Return visits: on ${SCENARIOS.length - slotsRes.skipped.length} scenarios, the card for a second visit dropped the first-visit introduction, asked for the contact by name, put the logged objection first and wrote a shorter note; a contact's name swapped across 6 names changed nothing else; the rep's edited note and brand rules survived a reload and won (${summary(slotRows).pass}/${slotRows.length} code checks)."`,
  v2Ret.ok.length ? `- "Return visits: a different model (${models}, blind), scoring each card on its own in both A/B orders (judge v2), scored the card with memory higher in ${nWon(v2Ret.ok, "doors")} of ${v2Ret.ok.length} asks (the first-visit card ${nWon(v2Ret.ok, "baseline")}, tie ${nWon(v2Ret.ok, "tie")}; by scenario ${byScenario(v2Ret.ok).doors}/${byScenario(v2Ret.ok).base}/${byScenario(v2Ret.ok).tie}; mean ${meanScore(v2Ret.ok, "doors")} vs ${meanScore(v2Ret.ok, "baseline")} of 15); it scored the second card higher in ${secondHigher(v2Ret.ok)} of ${v2Ret.ok.length}. Judge v1 (a pick) was position-biased: ${retWon(bothRetOk)} of ${bothRetOk.length}, the second card picked ${secondWins(bothRetOk)} of ${bothRetOk.length}. Owner review (n = 1) pending."` : null,
  bothRetOk.length ? `- "Return visits: a different model (${models}, blind), asked in both A/B orders, preferred the card with visit memory over the first-visit card in ${retWon(bothRetOk)} of ${bothRetOk.length} asks (first-visit card ${bothRetOk.filter((r) => r.overall === "baseline").length}, tie ${bothRetOk.filter((r) => r.overall === "tie").length}); it picked whichever card came second in ${secondWins(bothRetOk)} of ${bothRetOk.length}, so this screen does not separate them. Asked one way only: ${count("overall", "doors", judgedReturn)} of ${judgedReturn.length}. Owner review (n = 1) pending."` : judgedReturn.length ? `- "A different model (${models}, blind) preferred the return-visit card with visit memory over the first-visit card in ${count("overall", "doors", judgedReturn)} of ${judgedReturn.length} scenarios (tie ${count("overall", "tie", judgedReturn)}). Owner review (n = 1) pending."` : null,
  // gigbot 10-24: the one-order figure swings run to run; the claim quotes both orders
  v2.ok.length ? `- "Picking doors: a different model (${models}, blind), scoring each output on its own in both A/B orders (judge v2), scored Doors higher in ${nWon(v2.ok, "doors")} of ${v2.ok.length} asks (the popularity list ${nWon(v2.ok, "baseline")}, tie ${nWon(v2.ok, "tie")}; by scenario ${byScenario(v2.ok).doors}/${byScenario(v2.ok).base}/${byScenario(v2.ok).tie}; mean ${meanScore(v2.ok, "doors")} vs ${meanScore(v2.ok, "baseline")} of 15); it scored the second output higher in ${secondHigher(v2.ok)} of ${v2.ok.length} asks. Judge v1 (a pick) was position-biased: ${bothOk.filter((r) => r.overall === "doors").length} of ${bothOk.length}, the second output picked ${secondWins(bothOk)} of ${bothOk.length}. Owner review (n = 1) pending."` : null,
  bothOk.length ? `- "Picking doors: a different model (${models}, blind), asked in both A/B orders, preferred Doors' taste-ranked rooms over the same app ordering the city's rooms by popularity in ${bothOk.filter((r) => r.overall === "doors").length} of ${bothOk.length} asks (popularity ${bothOk.filter((r) => r.overall === "baseline").length}, tie ${bothOk.filter((r) => r.overall === "tie").length}); it picked whichever output came second in ${secondWins(bothOk)} of ${bothOk.length} asks, so this screen does not separate them; asked one way only, the figure swings run to run. Owner review (n = 1) pending."` : judgedRank.length ? `- "Picking doors: a different model (${models}, blind) preferred Doors' taste-ranked rooms over the same app ordering the city's rooms by popularity in ${count("done", "doors", judgedRank)} of ${judgedRank.length} scenarios (popularity ${count("done", "baseline", judgedRank)}, tie ${count("done", "tie", judgedRank)}). Owner review (n = 1) pending."` : null,
  judged.length ? `- "A different model (${models}, blind) preferred Doors over the same app with its cultural inputs off in ${count("overall", "doors")} of ${judged.length} scenarios (baseline ${count("overall", "baseline")}, tie ${count("overall", "tie")}). Owner review (n = 1) pending."` : null,
].filter(Boolean).join("\n")}

Do not claim: "culturally grounded" in general; anything about real reps' or bar managers' preferences (untested);
the live agentic path (any brand × any city), the chat agent, drive mode or the RN app (not in this harness).

## Rerun

\`node scripts/proof.mjs\` (offline, from the judge cache) · \`node scripts/proof.mjs --judge\` (asks the judge for
items not cached) · \`node --test test/proof.test.mjs\` (the code checks). Scenarios: \`scripts/proof/scenarios.mjs\`;
slots and how each is switched off: \`scripts/proof/harness.mjs\`. Ran in ${((Date.now() - t0) / 1000).toFixed(0)} s.
`;
writeFileSync(join(ROOT, "docs/PROOF.md"), md);
// group 3 item 3: stops judged on the template because no written set is held for their facts yet
writeFileSync(join(ROOT, "data/proof/talk-wanted.json"), JSON.stringify([...talkWanted].map(([key, tf]) => ({ key, tf }))) + "\n");
if (talkWanted.size) console.log(`talking points: ${talkWanted.size} stops have no written set yet (node scripts/proof/talk-fill.mjs, then run this again)`);
console.log(`docs/PROOF.md: swap ${all.swap.pass}/${all.swap.n}, stable ${all.stable.pass}/${all.stable.n}, labels ${all.labels.pass}/${all.labels.n}, empty ${all.empty.pass}/${all.empty.n}, correction ${all.correction.pass}/${all.correction.n}, talk ${all.talk.pass}/${all.talk.n}, slots ${summary(slotRows).pass}/${slotRows.length}, judged ${judged.length}/${pairs.length} pairs + ${judgedRank.length} rank + ${judgedReturn.length} return + ${sj.length}/${swapJudge.length} swaps`);
