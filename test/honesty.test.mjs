// SPEC §9 honesty rules, three ways:
// 1. source: banned claims in no shipped html/js/css line (comments and the guard regexes themselves excepted), and the
//    required labels in the places the spec names;
// 2. data: every text field of every public/data/**/*.json file, Qloo's own venue text included;
// 3. rendered: the strings a stop shows (meta, rank line, hours, note, Why lines, talking points, the Qloo record's rank
//    and source line), built by lib/stopmodel.js for real plans in all 4 cities, single and merged drinker lists.
// Not covered: DOM-only strings in public/ui (beyond the source scan).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";
import { travelLabel } from "../public/lib/travel.js";
import { sourcesLine } from "../public/lib/basis.js";
import { miText } from "../public/lib/planview.js";
import { talkLabel } from "../public/lib/talk-model.js";
import { openTill } from "../public/lib/pool.js";
import { PERSONA as DEMO_PERSONA } from "../public/lib/demo-profile.js";
import { buildPool, windowsFor } from "../public/lib/pool.js";
import { planDays } from "../public/lib/schedule.js";
import { stopModel } from "../public/lib/stopmodel.js";
import { START_CHIPS, chipStart, roomsPhrase } from "../public/lib/profile.js";
import { BANNED_PITCH } from "../public/lib/core.js";

const ROOT = new URL("../", import.meta.url).pathname;
const read = (p) => readFileSync(join(ROOT, p), "utf8");
function walk(dir, out = []) {
  for (const f of readdirSync(join(ROOT, dir))) {
    const p = join(dir, f);
    if (statSync(join(ROOT, p)).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
// Code with its comments removed: what a comment says never reaches the page.
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
// The only allowed mentions: the lines that define the banned-word guards themselves, i.e. a regex constant in
// core.js (BANNED_PITCH) or talk-model.js. Any other line, prose or code, is checked.
const GUARD_FILES = new Set(["public/lib/core.js", "public/lib/talk-model.js"]);
const isGuardLine = (path, l) => GUARD_FILES.has(path) && /^\s*(export\s+)?const\s+[A-Z_]+\s*=\s*\/.+\/[a-z]*;?\s*$/.test(l);

const CODE = walk("public").filter((p) => [".js", ".html", ".css"].includes(extname(p)) && !p.startsWith("public/vendor/")); // vendored third-party code (public/vendor/README.md) says nothing to a user
const BANNED = [
  [/\btrending\b/i, "trending"],
  [/\brising\b|(?:^|[.!?:;]\s+)Rising\b(?!\s+[A-Z])|\bRISING\b/, "rising"], // a name ("Rising Sun", a cocktail on a door's own menu, enrich 10-25) is not a trend claim
  [/\bon the rise\b/i, "on the rise"],
  [/\bhot right now\b/i, "hot right now"],
  [/\bthis week\b/i, "this week (as a data claim)"],
  [/\bcomposite\b/i, "composite score"],
  [/\b(door|venue|room) score\b/i, "a door score"],
  [/people who like\b/i, "people who like (the wording is 'drink like')"],
  // R1 ruling: why-this-room and note text come from "Qloo's profile of this room", never the venue's own listing
  [/(from|built from) (its|that room's|the room's|this room's) own listing/i, "crowd text credited to the venue's listing"],
];

test("§9.8: no trending / rising / this-week claims and no composite score in any shipped page or script", () => {
  const hits = [];
  for (const p of CODE) {
    stripComments(read(p)).split("\n").forEach((l, i) => {
      if (isGuardLine(p, l)) return;
      for (const [re, what] of BANNED) if (re.test(l)) hits.push(`${p}:${i + 1} ${what}: ${l.trim().slice(0, 120)}`);
    });
  }
  assert.deepEqual(hits, []);
});

// the 'rising' guard catches a trend claim, not a name (enrich 10-25: a door's own menu lists a "Rising Sun" cocktail,
// and that fact stays shown)
test("§9.8: 'rising' as a claim is banned; a capitalized name like 'Rising Sun' is not", () => {
  const re = BANNED.find(([, what]) => what === "rising")[0];
  for (const t of ["A rising star in Austin.", "Rising fast in Austin.", "Sales: Rising.", "RISING demand"]) assert.ok(re.test(t), t);
  for (const t of ["Sake cocktails include Sake Experiences, Rising Sun, Ginger Crush and Raspberry Saketini.", "Try the Rising Sun."]) assert.ok(!re.test(t), t);
  const enrich = JSON.parse(read("public/data/enrich/austin.json"));
  assert.ok(JSON.stringify(enrich).includes("Rising Sun"), "the fact is still in the shipped data");
});

test("§9.8: every text field of every shipped data file (public/data/**) carries no banned claim", () => {
  // Qloo's own venue descriptions included: the stop can show them, so they are held to the same rules.
  const hits = [];
  const files = walk("public/data").filter((p) => extname(p) === ".json");
  assert.ok(files.length >= 40, `walked ${files.length} data files`);
  let strings = 0;
  const collect = (x, where) => {
    // round 3 (lane enrich): a door's own website, quoted verbatim (enrich/<city>.json site.facts[].text and .quote),
    // is the door's words, not Doors' claim ("Rising Sun" is a sake cocktail at one Austin door)
    if (/public\/data\/enrich\/.*\.site\.facts\.\d+\.(text|quote)$/.test(where)) return;
    if (typeof x === "string") {
      strings++;
      for (const [re, what] of BANNED) if (re.test(x)) hits.push(`${where} ${what}: ${x.slice(0, 120)}`);
    } else if (x && typeof x === "object") for (const [k, v] of Object.entries(x)) collect(v, `${where}.${k}`);
  };
  for (const p of files) collect(JSON.parse(read(p)), p);
  assert.ok(strings > 10000, `${strings} strings checked`);
  assert.deepEqual(hits, []);
});

// judge pass 2 (27): said once per screen, not three times: the landing, the app's footer (under every app screen) and,
// on every stop (a phone's stop sheet covers the footer), its questions' note
test("§9.2: 'Not a distribution check' on the landing and the app footer; every stop says Qloo doesn't know what they stock", () => {
  const NADC = "Not a distribution check";
  assert.ok(read("public/index.html").includes(NADC), "landing");
  assert.ok(read("public/app.html").includes(NADC), "app footer");
  assert.match(read("public/ui/stop.js"), /<p class="ask-note">Qloo doesn't know what they stock — ask\.<\/p>/, "every stop");
  for (const p of ["public/ui/plan.js", "public/ui/stop.js", "public/ui/room.js", "public/ui/export.js", "public/ui/why.js"]) assert.ok(!read(p).includes(NADC), `${p} repeats the app footer`);
});

test("§9.3: hours carry their capture date; unparseable hours say 'hours unverified'", () => {
  // ease #10: under Why these doors' sources (not the plan's foot); each door's Qloo listing says when its hours were
  // saved ("Saved from Qloo on Oct 8", intuit audit #1)
  assert.match(read("public/ui/why.js"), /sourcesLine\(s\.ctx\.captured/);
  assert.equal(sourcesLine("2026-10-08", "ors"), "Rankings, crowds and each door's hours from Qloo (Oct 8). Road miles from OpenRouteService.", "audit 2 #9: in words");
  assert.match(sourcesLine("2026-10-08", "mixed"), /“est\.” means estimated\.$/);
  assert.doesNotMatch(sourcesLine("2026-10-08", "estimate"), /\d\.\d|mph/);
  assert.match(read("public/ui/stop.js"), /Saved from Qloo\$\{r\.when/);
  assert.match(read("public/lib/export.js"), /captured/);
  assert.equal(openTill({ hoursVerified: false }), "hours unverified");
});

test("§9.4: every distance says road or estimated", () => {
  assert.match(travelLabel("estimate"), /estimated: straight-line distance × 1\.35 at 18 mph/);
  assert.match(travelLabel("ors"), /^Road miles/);
  assert.match(travelLabel("mixed"), /est\./);
  assert.equal(miText({ mi: 4.25, source: "ors" }), "4.3 road mi");
  assert.equal(miText({ mi: 4.25, source: "estimate" }), "4.3 mi, estimated");
  assert.equal(miText({ mi: 4.25, source: "mixed" }), "4.3 mi (some estimated)");
  // leg rows and the stop's facts row
  assert.match(read("public/ui/stop.js"), /"road mi" : "mi · est\."/);
  // the landing hero (round 4 item 2: the map route is back) and the follow-cam door cards
  assert.match(read("public/ui/landing.js"), /estimated|road mi/);
  assert.match(read("public/ui/animate.js"), /estimated drive/);
});

test("§9.5: model-drafted vs template is labelled", () => {
  assert.match(talkLabel({ by: "template" }), /^Template/);
  // round 3 (Jard 10-25, feedback audit M1): no door says a model wrote or drafted anything; the privacy page does. The
  // labels still say where a line came from (Qloo's profile, the door's facts, the template), without a model in them.
  assert.match(talkLabel({ by: "model", model: "gemini", talkKey: "k" }), /built for this door from Qloo's facts/);
  assert.doesNotMatch(talkLabel({ by: "model", model: "gemini", talkKey: "k" }), /model|Claude|gemini/i);
  assert.match(read("public/ui/stop.js"), /Crowd and room lines from Qloo's profile of this door\./); // intuit audit #1
  assert.doesNotMatch(read("public/ui/stop.js"), /written by a model|model-drafted/);
});

test("§9.6: category facts come only from facts.json, each with a source link", () => {
  const { facts } = JSON.parse(read("public/data/facts.json"));
  assert.ok(facts.length >= 5);
  for (const f of facts) {
    assert.ok(f.id && f.text, `fact ${f.id} has text`);
    assert.match(f.url, /^https:\/\//, `fact ${f.id} has a source URL`);
    assert.ok(f.source, `fact ${f.id} names its source`);
  }
  // the stop renders each fact as a footnote linking its URL
  assert.match(read("public/ui/stop.js"), /href="\$\{esc\(f\.url\)\}"/);
});

test("§9.7: the demo persona is labelled made up, every venue real, on the banner and at the end", () => {
  assert.match(DEMO_PERSONA.fiction, /made up/);
  assert.match(DEMO_PERSONA.fiction, /Every bar and restaurant is real/);
  const demo = read("public/ui/demo.js");
  // the banner, on every card from the first to the hand-off (judge pass 2, 27: once per screen, not three times)
  assert.match(demo, /class="dfic">\$\{esc\(PERSONA\.fiction\)\}/, "banner");
  assert.match(read("public/ui/profile.js"), /Tidewell and Maya are made up; every bar and restaurant is real/);
});

test("§9.9: 'Saved on this device only.' in the app footer and the export drawer", () => {
  assert.ok(read("public/app.html").includes("Saved on this device only."));
  assert.ok(read("public/ui/export.js").includes("Saved on this device only."));
});

// ease #4 (GLOSSARY Voice: no taglines): the app's footer is one slim line of facts; the line stays on the landing
test("the positioning line is on the landing, word for word, and not in the app footer", () => {
  const line = "The doors whose regulars drink like yours, whether or not they pour you yet.";
  assert.ok(read("public/index.html").includes(line));
  assert.ok(!read("public/app.html").includes(line));
});

// ---------- rendered text: the strings a stop shows, built by the stop model (lib/stopmodel.js) ----------
// For each city: a single-drinker plan (Athletic Brewing) and a merged two-drinker plan; every scheduled stop plus the
// first 15 ranked rooms left off. Checks what the panel, the note and the talking points would show.
const json = (p) => JSON.parse(read(p));
const FACTS = json("public/data/facts.json").facts;
const CITY_NAMES = { austin: "Austin", boise: "Boise", chicago: "Chicago", omaha: "Omaha" };
const DRINKERS = { ab: { key: "athletic-brewing", name: "Athletic Brewing", ready: true }, ld: { key: "liquid-death", name: "Liquid Death", ready: true } };
const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function artistsOf(c) {
  const names = new Set();
  const add = (a) => a?.name && names.add(a.name);
  for (const x of Object.values(c.sounds ?? {})) (x.artists ?? []).forEach(add);
  (c.citySound ?? []).forEach(add);
  for (const l of Object.values(c.nbhdSounds ?? {})) (l ?? []).forEach(add);
  // names long enough not to be ordinary words ("Low", "Yes")
  return [...names].filter((n) => n.length >= 5).map((n) => new RegExp(`(^|[^\\w])${esc(n)}($|[^\\w])`));
}
function stopsFor(cityKey, drinks) {
  const routes = drinks.map((d) => json(`public/data/routes/${d.key}-${cityKey}.json`));
  const c = json(`public/data/cities/${cityKey}.json`);
  const prof = {
    brand: "Tidewell", what: "Non-alcoholic hazy IPA", drinks, rooms: ["bars", "breweries"],
    start: chipStart(START_CHIPS[cityKey][0]), visitMin: 25, known: [],
    windows: [{ date: "2026-10-13", from: "14:00", to: "18:00" }, { date: "2026-10-14", from: "13:00", to: "18:00" }],
    pitch: { price: "$38 a case", ask: "", support: ["tasting"], name: "Maya Ortiz" },
  };
  const pool = buildPool({ routes, profile: prof, cityName: CITY_NAMES[cityKey] });
  const p = planDays({ pool: pool.rows, statuses: pool.statuses, windows: windowsFor(prof), visitMin: 25, pinned: pool.pinned });
  const plan = { ...p, venues: pool.venues, pool: { ids: pool.ids, N: pool.N, label: pool.label, drinker: pool.drinker }, statuses: pool.statuses, outcomes: {}, profile: prof, city: { key: cityKey, name: CITY_NAMES[cityKey] }, windows: windowsFor(prof) };
  const onDay = plan.days.flatMap((d, i) => d.stops.map((st) => [st.id, i]));
  const off = pool.ids.filter((id) => !onDay.some(([x]) => x === id)).slice(0, 15).map((id) => [id, null]);
  return { c, prof, models: [...onDay, ...off].map(([id, i]) => stopModel({ plan, id, dayIndex: i, city: c, facts: FACTS, routes })) };
}
const shown = (m) => [
  ...m.meta, m.rankLine, m.hoursToday, m.note.subject, m.note.body, ...m.why.map((l) => l.text),
  ...m.talk.before, m.talk.opener, ...m.talk.questions, ...m.talk.points.map((x) => x.text),
  ...m.talk.pushback.flatMap((x) => [x.objection, x.reply]), m.talk.ask, m.record.rank, m.record.pitchBy,
].filter((x) => typeof x === "string" && x);
const RUNS = Object.keys(CITY_NAMES).flatMap((k) => [[k, [DRINKERS.ab]], [k, [DRINKERS.ab, DRINKERS.ld]]]);

test("rendered stops: no banned claim, no artist name, no placeholder, in any string a stop shows", () => {
  let n = 0, model = 0;
  const bad = [];
  for (const [k, drinks] of RUNS) {
    const { c, models } = stopsFor(k, drinks);
    const artists = artistsOf(c);
    assert.ok(artists.length >= 20, `${k}: the artist list to screen against`);
    for (const m of models) {
      n++;
      if (m.pitch.by === "model") model++;
      for (const t of shown(m)) {
        for (const [re, what] of BANNED) if (re.test(t)) bad.push(`${k} ${m.venue.name}: ${what}: ${t.slice(0, 100)}`);
        if (/undefined|\bnull\b|NaN|\[object/.test(t)) bad.push(`${k} ${m.venue.name}: placeholder: ${t.slice(0, 100)}`);
        for (const re of artists) if (re.test(t)) bad.push(`${k} ${m.venue.name}: artist ${re.source}: ${t.slice(0, 100)}`);
      }
      // statements (not the venue's quoted objections, not questions) never claim stock: the guard's own words
      for (const t of [m.note.subject, m.note.body, ...m.why.map((l) => l.text), m.rankLine])
        if (BANNED_PITCH.test(t.replaceAll(m.venue.name, ""))) bad.push(`${k} ${m.venue.name}: BANNED_PITCH: ${t.slice(0, 100)}`);
    }
  }
  assert.ok(n >= 150, `${n} stops checked`);
  assert.ok(model >= 50, `${model} stops with model-drafted Why lines (the label check below is not vacuous)`);
  assert.deepEqual(bad, []);
});

test("rendered stops: §9.1 rank line names drinker, city and filter; merged lists say so; §9.5 model text labelled", () => {
  for (const [k, drinks] of RUNS) {
    const { prof, models } = stopsFor(k, drinks);
    const filter = roomsPhrase(prof.rooms);
    for (const m of models) {
      assert.ok(m.rankLine.includes(CITY_NAMES[k]) && m.rankLine.includes(filter), `${k}: ${m.rankLine}`);
      for (const d of drinks) assert.ok(m.rankLine.includes(d.name), `${k}: names ${d.name}: ${m.rankLine}`);
      if (drinks.length > 1) {
        assert.match(m.rankLine, /on Your list of .* for .* and .* drinkers$/, m.rankLine); // Jard 10-24: Your list, never 'Qloo ranks'
        assert.doesNotMatch(shown(m).join("\n"), /Qloo ranks/, "a merged rank is never 'Qloo ranks'");
      }
      assert.match(m.record.pitchBy, /^Qloo's profile of this door \(/, `${m.venue.name}: ${m.record.pitchBy}`); // round 3: no model named on the door
      assert.doesNotMatch(m.record.pitchBy, /model/i);
      assert.match(talkLabel(m.talk), m.talk.by === "model" ? /built for this door/ : /^Template/);
      for (const f of m.talk.factRefs) assert.match(f.url, /^https:\/\//);
    }
  }
});

test("rendered stops: §9.3 / §9.4 every scheduled stop says its hours and whether its leg is road or estimated", () => {
  for (const [k, drinks] of RUNS) {
    for (const m of stopsFor(k, drinks).models.filter((x) => x.stop)) {
      assert.ok(m.hoursToday, `${m.venue.name}: hours shown`);
      assert.ok(["ors", "estimate"].includes(m.leg.source), `${m.venue.name}: leg source ${m.leg.source}`);
    }
  }
});

test("§9.4: every place that formats a distance labels it road or estimated (new sites must be added here)", () => {
  // file → why its toFixed(1) distance is labelled. A new distance site fails until it is labelled and listed.
  const LABELLED = {
    "public/ui/stop.js": /"road mi" : "mi · est\."/,
    "public/ui/plan.js": /"road mi" : "mi · est\."/,
    "public/lib/planview.js": /"road mi"[^\n]*"mi, estimated"/,
    "public/lib/export.js": /"road mi" : "mi, estimated"/,
    // the map's miles chip (owner, 2026-10-09: "miles", not "road miles"): an estimate still says so
    "public/ui/landing.js": /"miles, estimated" : "miles"/,
    "public/ui/animate.js": /"miles" : "miles, estimated"/,
    "public/lib/outcome.js": /"road mi" : "mi, estimated"/, // the follow-up toast's added miles (R2 Calacanis 13)
    "public/lib/schedule.js": /"road mi" : "mi, estimated"/, // "farther than Tuesday's area (6.2 mi, estimated)"
    "public/lib/roominsight.js": /"road mi" : "mi \(estimated\)"/, // the deep-dive's route step (G5)
    "public/ui/drive.js": /"road mi" : "mi · est\."/, // R9 drive mode: Navigate and "Then:" legs
    "public/lib/drive-day.js": /"road mi" : "mi · est\."/, // legMiText: drive mode's legs, shared by web and phone (parityfix slice 3)
    "public/lib/demo-story.js": /"road miles" : "miles, estimated,"/, // the tour's re-plan card (web + phone): what the follow-up added
    "public/lib/agent-tools.js": /"road mi" : "mi, estimated"/, // judge pass 2 (5): Ask Doors' "putting it first adds …"
    "public/lib/whyviz/explorer.js": /mi, as the crow flies/, // WHY-VIZ-SPEC 4.1: the Distance axis is straight-line from the day's start, and its tooltip says so
  };
  // not travel distances (the sieve's tooltip shows a star rating): a pin's place ("Your pin, 0.4 mi from Downtown"), a venue's star rating, and the planner's
  // internal rounding.
  const NOT_TRAVEL = new Set(["public/lib/profile.js", "public/lib/stopmodel.js", "public/ui/room.js" /* G5: a star rating */, "public/ui/sieve.js", "public/lib/agent-context.js" /* round 3: a lift vs the city ("2.3×") */, "public/ui/viz-dom.js" /* why viz: fmt1, a chart number */, "public/ui/whyviz/thread.js" /* why viz E: SVG coordinates */, "public/lib/whyviz/areas.js", "public/ui/whyviz/areas.js" /* lane 2: a crowd lift, "×4.2 the city", not a distance */, "public/lib/whyviz/lift.js" /* lane 2: a crowd lift, "×4.2 the city", not a distance */, "public/ui/whyviz/ring.js" /* lane 2: SVG coordinates on the day ring */, "public/ui/whyviz/portrait.js" /* WHY-VIZ-SPEC 4.7: the one-door ring's SVG coordinates */, "public/ui/whyviz/hero.js", "public/ui/whyviz/strip.js" /* WHY-VIZ-SPEC 6: SVG coordinates on the landing hero and Your list's strips */]);
  for (const p of CODE) {
    const src = stripComments(read(p));
    if (!/\.toFixed\(1\)/.test(src) || NOT_TRAVEL.has(p)) continue;
    assert.ok(LABELLED[p], `${p} formats a distance: label it road/estimated and list it in this test`);
    assert.match(src, LABELLED[p], p);
  }
});
