// The cultural-slot evidence table (docs/CULTURAL-SLOTS.md §7): for each scenario, what a slot changes with it on vs
// off, on the real Austin data and the demo brand. Markdown on stdout, safe for the public repo: no Qloo ranks, ids or
// text (a line drawn from Qloo's profile of a room is shown as "[from Qloo's profile of the room]").
// Usage: node scripts/slots-report.mjs > /tmp/slots-report.md
import { readFileSync } from "node:fs";
import { buildPool, windowsFor } from "../public/lib/pool.js";
import { planDays } from "../public/lib/schedule.js";
import { stopModel } from "../public/lib/stopmodel.js";
import { noteFor } from "../public/lib/note.js";
import { makeOutcome } from "../public/lib/outcome.js";
import { makeRecord } from "../public/lib/slots.js";
import { demoProfile, DEMO_SHOWCASE } from "../public/lib/demo-profile.js";
import { talkPoints } from "../public/lib/talk.js";
import { crowdTimes, crowdShare, tagsOf, hookFor, heatFor } from "../public/lib/culture.js";

const read = (p) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), "utf8"));
const ab = read("public/data/routes/athletic-brewing-austin.json");
const AUSTIN = read("public/data/cities/austin.json");
const FACTS = read("public/data/facts.json").facts;
const ID = DEMO_SHOWCASE.id;
const NOW = Date.parse("2026-10-15T12:00:00Z");
const profile = demoProfile(new Date(2026, 9, 12));

function planFor({ statuses = {}, outcomes = {}, slots = {} } = {}) {
  const pool = buildPool({ routes: [ab], profile, statuses, outcomes, cityName: "Austin" });
  const p = planDays({ pool: pool.rows, statuses: pool.statuses, windows: windowsFor(profile), visitMin: profile.visitMin, pinned: pool.pinned });
  return { ...p, venues: pool.venues, pool: { ids: pool.ids, N: pool.N, label: pool.label, drinker: pool.drinker }, statuses: pool.statuses, outcomes, slots, profile, city: { key: "austin", name: "Austin" }, windows: windowsFor(profile) };
}
const dayOf = (plan, from = 0) => plan.days.findIndex((d, i) => i >= from && d.stops.some((s) => s.id === ID));
const sm = (plan, k, slotsOff = []) => stopModel({ plan, id: ID, dayIndex: k, city: AUSTIN, facts: FACTS, routes: [ab], now: NOW, slotsOff });
const QLOO = "[from Qloo's profile of the room]";
const pub = (s) => String(s ?? "").replace(/^Looks like [^.]*\./, QLOO).replace(/\n\nLooks like [^.]*\./, `\n\n${QLOO}`).replace(/#\d+ of \d+/g, "#k of N");
const cell = (s) => pub(s).replace(/\|/g, "\\|").replace(/\n+/g, " / ");

const first = planFor();
const visit = makeOutcome({ result: "followup", followUp: profile.windows[2].date, who: "Sam (taproom manager)", note: "liked it, hesitant about price", at: "2026-10-13T20:10:00Z" });
const back = planFor({ statuses: { [ID]: "visited" }, outcomes: { [ID]: visit } });
const kb = dayOf(back, 1);
const rules = { "*": [makeRecord({ slot: "S6", field: "rule.term", value: { from: "non-alcoholic", to: "alcohol-free" }, source: "corrected", at: "2026-10-14T00:00:00Z" })] };
const ruled = planFor({ slots: rules });
const k0 = dayOf(first);

const rows = [];
const row = (scenario, slot, what, on, off) => rows.push(`| ${scenario} | ${slot} | ${what} | ${cell(on)} | ${cell(off)} |`);
{
  const on = sm(back, kb), off = sm(back, kb, ["S4"]);
  row("W1 return visit (Thu, after Tue: “liked it, hesitant about price”, talked to Sam)", "S1+S4 memory", "Opener", on.talk.opener, off.talk.opener);
  row("", "", "Who to ask for", on.talk.before[0], off.talk.before[0]);
  row("", "", "First pushback", `${on.talk.pushback[0].objection} → ${on.talk.pushback[0].reply}`, `${off.talk.pushback[0].objection} → ${off.talk.pushback[0].reply}`);
  row("", "", "Note opening", on.note.lines[0], off.note.lines[0]);
}
{
  const m = sm(first, k0);
  row("W3 the note as a text", "S3 channel", "Length (characters)", `${noteFor(m.note, "sms").length}: ${noteFor(m.note, "sms")}`, `${m.note.body.length} (the email, sent as a text)`);
}
{
  const on = sm(first, k0), off = sm(first, k0, ["S1t"]);
  row("W4 a taproom mid-afternoon", "S1 timing", "Arrival advice", on.talk.before[1], off.talk.before[1]);
}
{
  const on = sm(ruled, k0), off = sm(ruled, k0, ["S6"]);
  row("C3 the rep's rule: say “alcohol-free”, not “non-alcoholic”", "S6 correction", "Note introduction", on.note.lines[0], off.note.lines[0]);
}

// ---- R9 deep (lib/culture.js): Qloo's room tags (0 calls), each row = one signal on vs off ----
// Public-safe: Qloo's tag names are masked as [Qloo tag]; only Doors' own wording and counts are shown.
{
  // mask exactly the Qloo tag values a line was built from (its deep src), plus any time-of-day words
  const maskTags = (x, tags = []) => [...tags].sort((m, n) => n.length - m.length).reduce((t, n) => t.split(n).join("[Qloo tag]").split(n.toLowerCase()).join("[Qloo tag]"), String(x)).replace(/(\[Qloo tag\](,| and) )+\[Qloo tag\]/g, "[Qloo tags]");
  const cas = read("public/data/routes/casamigos-austin.json");
  // the distinctive values (a room's times, a dish); drinks-category words ("Beer", "Cocktails") are Doors' own too
  const srcTags = (t) => [t.deep?.tod?.src, ...(t.deep?.lead?.src ?? [])].filter((x) => x && /time_of_day|menu/.test(x.field)).flatMap((x) => x.tags ?? []);
  const phone = (x) => String(x).replace(/\(\d{3}\) \d{3}-\d{4}/g, "[phone]");
  const drow = (scenario, what, on, off, tags = []) => row(scenario, "deep", what, phone(maskTags(on, tags)), phone(maskTags(off, tags)));
  // tod: the day choice, over a 3-day profile at three times of day (11–3, 2–6, 5–9)
  const H = (h) => h * 60;
  const c = ab.city;
  const start = { id: "start", lat: c.center[0], lon: c.center[1] };
  const wins = [["2026-10-27", "tuesday", 11, 15], ["2026-10-28", "wednesday", 14, 18], ["2026-10-29", "thursday", 17, 21]].map(([date, day, a, b]) => ({ date, day, from: H(a), to: H(b), start }));
  const count = (deepOff) => {
    const pool = buildPool({ routes: [ab], profile, cityName: "Austin", deepOff });
    const p = planDays({ pool: pool.rows, statuses: pool.statuses, windows: wins, visitMin: 25, pinned: [] });
    let inC = 0, sig = 0, n = 0;
    for (const d of p.days) for (const x of d.stops) { n++; const t = crowdTimes(pool.venues[x.id]); if (t.length) (sig++, inC += crowdShare(x.eta, x.eta + 25, t) > 0.5 ? 1 : 0); }
    return `${inC} of ${sig} arrivals inside the room's crowd times (${n} doors, ${p.days.reduce((a, d) => a + d.min, 0)} min driving)`;
  };
  drow("D1 three days at three times of day (Austin)", "Which day each door goes on (tod)", count(null), count(["tod"]));
  // tod: the arrival line where Qloo's crowd times and the clock disagree
  const NA = { brand: profile.brand, what: profile.what };
  const ids = ab.lists.all.map((r) => r[0]);
  const at = (eta) => ids.map((id) => ab.venues[id]).find((v) => talkPoints({ venue: v, profile: NA, isNA: true, eta, timingByType: true }).deep.tod);
  for (const [eta, label] of [[H(12.5), "12:30 pm"], [H(15), "3 pm"]]) {
    const v = at(eta);
    if (!v) continue;
    const on = talkPoints({ venue: v, profile: NA, isNA: true, eta, timingByType: true });
    const off = talkPoints({ venue: v, profile: NA, isNA: true, eta, timingByType: true, deepOff: ["tod"] });
    drow(`D2 a door at ${label} (${on.venueType})`, "Arrival advice (tod)", on.before[1], off.before[1], srcTags(on));
  }
  // lead: what to lead with, a tequila at Austin rooms
  const TEQ = { brand: "Agave Co", what: "Reposado tequila" };
  const casIds = cas.lists.all.map((r) => r[0]);
  const lead = (pred) => casIds.map((id) => cas.venues[id]).find((v) => pred(talkPoints({ venue: v, profile: TEQ }).deep.lead));
  for (const [label, pred] of [["a cocktail room", (l) => l?.question && l?.ask], ["a beer-and-wine room", (l) => l?.gate]]) {
    const v = lead(pred);
    if (!v) continue;
    const on = talkPoints({ venue: v, profile: TEQ }), off = talkPoints({ venue: v, profile: TEQ, deepOff: ["lead"] });
    drow(`D3 a tequila at ${label}`, "Opener question (lead)", on.opener.replace(/^Looks like [^.]*\. /, ""), off.opener.replace(/^Looks like [^.]*\. /, ""), srcTags(on));
    drow("", "First question", on.questions[0], off.questions[0], srcTags(on));
    drow("", "The ask", on.ask, off.ask, srcTags(on));
  }
  const dish = ids.map((id) => ab.venues[id]).find((v) => talkPoints({ venue: v, profile: NA, isNA: true }).deep.lead?.src?.[0]?.field === "tag:menu_highlight");
  if (dish) {
    const on = talkPoints({ venue: dish, profile: NA, isNA: true }), off = talkPoints({ venue: dish, profile: NA, isNA: true, deepOff: ["lead"] });
    drow("D4 the demo's NA IPA at a room known for a dish", "Opener question (lead)", on.opener.replace(/^Looks like [^.]*\. /, ""), off.opener.replace(/^Looks like [^.]*\. /, ""), srcTags(on));
  }
  // hooks: small talk where the room's tags meet a distinctive taste of the drinker brand's fans (names masked)
  const hooks = read("public/data/culture/hooks.json");
  const top = ids.slice(0, 60).map((id) => ab.venues[id]);
  const n = top.filter((v) => hookFor(v, [{ key: "athletic-brewing", name: "Athletic Brewing" }], hooks)).length;
  const h = top.map((v) => hookFor(v, [{ key: "athletic-brewing", name: "Athletic Brewing" }], hooks)).find(Boolean);
  if (h) drow("D5 small talk at Austin's top 60 rooms", "Hook (hooks)", `${n} of 60 rooms get one, e.g. ${h.text.replace(h.item, "[Qloo title]")}`, "none");
  // heat: which part of town the first day works, 10 held brand × city plans, 3 days 1–6 pm
  const heat = read("public/data/culture/heat.json");
  const t = { on: [0, 0, 0], off: [0, 0, 0] };
  for (const k of ["athletic-brewing-austin", "casamigos-chicago", "white-claw-omaha", "espolon-chicago", "lacroix-austin", "don-julio-austin", "liquid-death-chicago", "teremana-boise", "white-claw-chicago", "casamigos-omaha"]) {
    const r = read(`public/data/routes/${k}.json`);
    const cc = r.city;
    const st = { id: "start", lat: cc.center[0], lon: cc.center[1] };
    const w3 = ["2026-10-27", "2026-10-28", "2026-10-29"].map((date, i) => ({ date, day: ["tuesday", "wednesday", "thursday"][i], from: H(13), to: H(18), start: st }));
    const hoods = heatFor(heat, [r]);
    for (const [key, off] of [["on", null], ["off", ["heat"]]]) {
      const pool = buildPool({ routes: [r], profile: { ...profile, city: cc.key }, cityName: cc.name, deepOff: off, heat: hoods });
      const hot = new Set(buildPool({ routes: [r], profile: { ...profile, city: cc.key }, cityName: cc.name, heat: hoods }).rows.filter((x) => x.heat).map((x) => x.id));
      const p = planDays({ pool: pool.rows, statuses: pool.statuses, windows: w3, visitMin: 25, pinned: [] });
      t[key][0] += p.days[0].stops.filter((x) => hot.has(x.id)).length;
      t[key][1] += p.days.reduce((a, d) => a + d.stops.length, 0);
      t[key][2] += p.days.reduce((a, d) => a + d.min, 0);
    }
  }
  const say = ([a, b, c2]) => `${a} doors in the top 3 neighbourhoods on day 1 (${b} doors, ${c2} min driving in all)`;
  drow("D6 10 held brand × city plans, 3 days", "Which part of town first (heat)", say(t.on), say(t.off));
}

console.log(`# Cultural slots: what each one changes (on vs. off)

Generated by \`scripts/slots-report.mjs\` from the real Austin data and the demo brand (Tidewell, made up). Each row
switches one slot off and keeps everything else. Automated and deterministic: **not a judged result**. Judging so far:
owner-reviewed, n = 1.

Rows D1–D4 are Qloo's room tags (R9 deep, 0 calls); D5 is what a drinker brand's fans also like (brand → TV,
podcasts, trips; only the brand's own items, only where the room's tags meet the item's genre); D6 is Qloo's map of
where the brand's fans are (rank only). D6 varies a lot plan by plan; the totals are what it does on average.

The day-choice effect (D1) is small: Qloo's time-of-day tags are
broad (most bars are tagged afternoon, evening and late night), so it moves a few doors, not the plan; the guided demo
keeps it off so its scripted days hold. The arrival line (D2) and what to lead with (D3, D4) change on many rooms.

| Scenario | Slot | What | Slot on | Slot off |
|---|---|---|---|---|
${rows.join("\n")}
`);
