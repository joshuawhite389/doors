// The both-orders re-ask: each of the 12 scenarios asked fresh in BOTH A/B orders, bypassing the judge cache, so
// position bias and judge noise both show. Same prompt, system and model as proof.mjs. Two screens:
//   "Doors vs popularity list" (drinker slot off only) → data/proof/both-orders.json
//   "Return visit: memory (S4) on vs off" (freeze 10-28: the one-order figure followed the output's position in 12 of
//   12 scenarios, so the return-visit claim quotes both orders too) → data/proof/both-orders-return.json
// Both files are private: the rows quote Qloo's room text in "why".
//   node scripts/proof/both-orders.mjs   ask the items not yet asked on this exact text (a rerun resumes)
// A row is kept on a rerun only while its prompt's hash is unchanged; any change to the text asks it again.
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, routesFor, runScenario } from "./harness.mjs";
import { SCENARIOS, byKey } from "./scenarios.mjs";
import { render, renderStop, context, returnContext, pairPrompt, judgeNow, scorePrompt, SCORE_SCHEMA, LEVELS, total, cmp } from "./judge.mjs";
import { returnCase } from "./slots-probes.mjs";

const sha = (s) => createHash("sha256").update(s).digest("hex").slice(0, 16);
const venuesOf = (key) => () => Object.assign({}, ...routesFor(byKey(key).profile).map((x) => x.venues));
const commit = execSync("git rev-parse --short HEAD", { cwd: ROOT, encoding: "utf8" }).trim();

// items: [{key, ctx, on, off}] → rows, two asks each, resumed from `file` by prompt hash
function askBoth(name, file, items) {
  const OUT = join(ROOT, file);
  const old = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")).rows : [];
  const rows = [];
  const write = () => writeFileSync(OUT, JSON.stringify({ commit, today: new Date().toISOString().slice(0, 10), rows }, null, 1) + "\n");
  for (const { key, ctx, on, off } of items) {
    for (const doorsIs of ["A", "B"]) {
      const prompt = pairPrompt(ctx, doorsIs === "A" ? on : off, doorsIs === "A" ? off : on);
      const h = sha(prompt);
      const had = old.find((r) => r.key === key && r.doorsIs === doorsIs && r.prompt === h && !r.error);
      if (had) { rows.push(had); continue; }
      const res = judgeNow(prompt);
      const v = res.verdict;
      const pick = (x) => (x === "tie" ? "tie" : x === doorsIs ? "doors" : x ? "baseline" : null);
      rows.push({ key, doorsIs, prompt: h, error: res.error ?? null, model: res.model ?? null, said: pick(v?.said), applied: pick(v?.applied), done: pick(v?.done), overall: pick(v?.overall), why: v?.why ?? null });
      write();
      console.log(name, key, doorsIs, res.error ? `ERR ${res.error}` : `done=${pick(v?.done)} overall=${pick(v?.overall)}`);
    }
  }
  write();
  const ok = rows.filter((r) => !r.error);
  const second = ok.filter((r) => (r.doorsIs === "A" && r.overall === "baseline") || (r.doorsIs === "B" && r.overall === "doors")).length;
  console.log(`${name}, both orders at ${commit}: Doors ${ok.filter((r) => r.overall === "doors").length} of ${ok.length} overall, ${ok.filter((r) => r.done === "doors").length} on done; the second output won ${second} of ${ok.length} (${rows.length - ok.length} errors)`);
}

// judge v2 (pre-registered, see judge.mjs): scores per output, evidence first, no pick; the winner derived from the sums
function scoreBoth(name, file, items) {
  const OUT = join(ROOT, file);
  const old = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")).rows : [];
  const rows = [];
  const write = () => writeFileSync(OUT, JSON.stringify({ commit, judge: "v2", today: new Date().toISOString().slice(0, 10), rows }, null, 1) + "\n");
  for (const { key, ctx, on, off } of items) {
    for (const doorsIs of ["A", "B"]) {
      const prompt = scorePrompt(ctx, doorsIs === "A" ? on : off, doorsIs === "A" ? off : on);
      const h = sha(prompt);
      const had = old.find((r) => r.key === key && r.doorsIs === doorsIs && r.prompt === h && !r.error);
      if (had) { rows.push(had); continue; }
      const res = judgeNow(prompt, { schema: SCORE_SCHEMA });
      const v = res.verdict;
      const doors = v ? v[doorsIs] : null, baseline = v ? v[doorsIs === "A" ? "B" : "A"] : null;
      rows.push({ key, doorsIs, prompt: h, error: res.error ?? null, model: res.model ?? null, doors, baseline, overall: v ? cmp(doors, baseline) : null, levels: v ? Object.fromEntries(LEVELS.map((l) => [l, cmp({ [l]: doors[l] }, { [l]: baseline[l] })])) : null });
      write();
      console.log(name, "v2", key, doorsIs, res.error ? `ERR ${res.error}` : `doors ${total(doors)} vs ${total(baseline)} → ${cmp(doors, baseline)}`);
    }
  }
  write();
  const ok = rows.filter((r) => !r.error);
  const second = ok.filter((r) => total(r.doorsIs === "A" ? r.baseline : r.doors) > total(r.doorsIs === "A" ? r.doors : r.baseline)).length;
  console.log(`${name}, judge v2 both orders at ${commit}: Doors ${ok.filter((r) => r.overall === "doors").length} of ${ok.length}, baseline ${ok.filter((r) => r.overall === "baseline").length}, tie ${ok.filter((r) => r.overall === "tie").length}; the second output scored higher in ${second} of ${ok.length} (${rows.length - ok.length} errors)`);
}

const popItems = SCENARIOS.map((s) => ({ key: s.key, ctx: context(s), on: render(runScenario(s), venuesOf(s.key)), off: render(runScenario(s, { off: ["drinker"] }), venuesOf(s.key)) }));
const retItems = SCENARIOS.flatMap((s) => {
  const on = returnCase(s), off = returnCase(s, { slotsOff: ["S4"] });
  return on && off ? [{ key: s.key, ctx: returnContext(s, on.back.name), on: renderStop(on.back), off: renderStop(off.back) }] : [];
});
askBoth("popularity", "data/proof/both-orders.json", popItems);
askBoth("return visit", "data/proof/both-orders-return.json", retItems);
scoreBoth("popularity", "data/proof/both-orders-v2.json", popItems);
scoreBoth("return visit", "data/proof/both-orders-return-v2.json", retItems);
