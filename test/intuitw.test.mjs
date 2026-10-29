// Intuitiveness audit pass 1, lane W (words and moving blocks, web and phone): #1 Qloo's listing in words, #2 the
// field mode leads with the day, #4 talking points' sources in one line + a fold, #5 "people who drink <brand>", #9 the
// Agent's badge and entry words, and the smaller word items. Pure: reads no public/data.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { labelDrinker } from "../public/lib/pool.js";
import { rankSentence } from "../public/lib/talk.js";
import { shortDate } from "../public/lib/stopmodel.js";
import { DRIVE_WORDS as W } from "../public/lib/drive-day.js";
import { sourceRows, talkSummary, QLOO_RANK, MODEL, PROFILE, TEMPLATE } from "../public/lib/provenance.js";
import { sourceItems, shortDates } from "../public/lib/agent-ui.js";
import { talkLabel } from "../public/lib/talk-model.js";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("#5: the rank says 'people who drink <brand>' once; old and new labels both give the drinker back", () => {
  assert.equal(rankSentence({ rank: 2, N: 55, city: "Austin", filter: "bars", drinkerName: "Athletic Brewing" }), "Qloo ranks this door #2 of 55 Austin bars for people who drink Athletic Brewing.");
  assert.equal(labelDrinker("Austin bars for people who drink Athletic Brewing"), "Athletic Brewing drinkers");
  assert.equal(labelDrinker("Austin bars for people who drink like Athletic Brewing drinkers"), "Athletic Brewing drinkers", "a plan saved before the change");
  assert.equal(labelDrinker("Austin bars for regulars like those at Parson's"), null);
  for (const p of ["public/ui/app.js", "app-mobile/src/screens/Plan.tsx"]) assert.doesNotMatch(read(p), /`drinks like \$\{/, `${p}: the header says "for <brand> drinkers"`);
  // the Agent's reply check keeps the new phrasing (the drinker brand is otherwise an avoided name)
  assert.match(read("src/agent.js"), /\\\\bpeople who drink \$\{b\}\\\\b/);
});

test("#1: Qloo's listing shows the week's hours and no ids, affinity decimals, field names or model ids", () => {
  assert.equal(shortDate("2026-10-08"), "Oct 8");
  assert.equal(shortDate("soon"), "");
  for (const p of ["public/ui/stop.js", "app-mobile/src/screens/DoorPage.tsx"]) {
    const s = read(p);
    assert.doesNotMatch(s, /Qloo id|"Affinity"|Hours as listed|r\.pitchBy|record\.pitchBy/, p);
    assert.match(s, /r\.week/, `${p}: hours as a week`);
    assert.match(s, /Crowd and room lines from Qloo's profile of this door\./, p);
    if (p.startsWith("public/")) assert.doesNotMatch(s, /written by a model|model-drafted/, `${p}: no model sign on the door (round 3; mobile is paused, web only)`);
  }
  assert.doesNotMatch(talkLabel({ by: "model", model: "gemini-3.1-flash-lite" }), /gemini/, "the model's id is on the privacy page");
  assert.match(read("public/privacy.html"), /gemini-3\.1-flash-lite/);
});

test("#2: a previewed day leads with the day; web and phone use the same words", () => {
  assert.equal(W.dayTitle("2026-10-27"), "Tuesday, Oct 27");
  assert.equal(W.notToday("2026-10-27", "2026-10-24"), "Today is Sat Oct 24. This is Tuesday's route, ahead of time.");
  assert.equal(W.notToday("2026-10-20", "2026-10-24"), "Today is Sat Oct 24. This was Tuesday's route.");
  for (const p of ["public/ui/drive.js", "app-mobile/src/screens/Drive.tsx"]) {
    assert.doesNotMatch(read(p), /`Preview of \$\{/, p);
    assert.match(read(p), /W\.notToday\(/, p);
  }
});

test("#4: one sources line at the top, every non-template line's source in the fold, no chips in drive mode", () => {
  const s = { before: [TEMPLATE, QLOO_RANK], opener: MODEL, hook: null, questions: [TEMPLATE], points: [null, PROFILE], pushback: [TEMPLATE], ask: TEMPLATE };
  // round 3 (Jard 10-25): the line never says a model wrote anything
  assert.equal(talkSummary(s, { by: "model" }), "2 lines from Qloo, 1 from you, 4 from the template · Sources below");
  assert.equal(talkSummary(s, { by: "template" }), "2 lines from Qloo, 1 from you, 4 from the template · Sources below");
  assert.deepEqual(sourceRows(s).map((r) => `${r.where}: ${r.label}`), ["Before you walk in, line 2: Qloo · rank", "Opener: Qloo · door profile", "Point 2: Your profile"]);
  assert.doesNotMatch(read("public/ui/drive.js"), /lineSources|srcchip/);
  assert.doesNotMatch(read("app-mobile/src/screens/Drive.tsx"), /<SrcChip/);
  for (const p of ["public/ui/stop.js", "app-mobile/src/screens/DoorPage.tsx"]) assert.match(read(p), /Sources \(/, `${p}: the fold`);
});

test("#9 + smaller: no 'resting' badge, 'Ask about this door', Agent sources without a repeated tag, one tour counter", () => {
  assert.doesNotMatch(read("public/ui/agent.js"), /: "resting"\) :/);
  assert.match(read("public/ui/stop.js"), />Ask about this door</);
  const items = sourceItems({ text: "x", facts: [{ text: "a", source: { kind: "qloo", field: "affinity", label: "Qloo, rank for your drinker (captured 2026-10-08)" } }, { text: "b", source: { kind: "plan", field: "popularity", label: "Doors' route" } }, { text: "A plain fact.", source: { kind: "plan" } }] });
  assert.deepEqual(items.map((x) => [x.text, x.named]), [["Qloo, rank for your drinker (Oct 8)", true], ["Doors' route", true], ["A plain fact.", false]]);
  assert.equal(shortDates("on 2026-10-08"), "on Oct 8");
  assert.match(read("app-mobile/src/screens/Drive.tsx"), /`All \$\{q\.total\} stops`/);
  assert.match(read("public/ui/export.js"), /Plan as CSV: for your CRM or your manager/);
  assert.match(read("app-mobile/src/screens/Export.tsx"), /Plan as CSV: for your CRM or your manager/);
  assert.doesNotMatch(read("public/ui/demo.js"), /say\(s\.act === "end" \? "" : `Step/);
});
