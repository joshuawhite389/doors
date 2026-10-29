// The numbers README.md and SUBMISSION.md quote, derived from the code and data rather than typed by hand (judge pass
// 2: the docs said 14.9 road mi and "stop 7" while the app said 16.7 and stop 5). Offline, no network, no API call.
//   node scripts/doc-numbers.mjs           print the facts
//   node scripts/doc-numbers.mjs --check   also check every quoted number in both docs; exit 1 on drift
//   ... --check --also <file>              and in another doc (e.g. ../DEVPOST-FIELDS.md)
// Sources: the demo bake (public/data/demo/demo.json, re-baked by scripts/bake-demo.mjs), the demo pool
// (lib/pool.js on the demo profile), the tour (lib/demo-script.js), the Qloo ledger (data/ledger.jsonl), the pre-warm
// set (scripts/prewarm.mjs --dry-run) and the proof results (data/proof/results.json). Run it again after any merge
// that re-bakes the demo, and before publishing.
import { existsSync, readFileSync, rmdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { demoProfile, demoContact, DEMO_CONTACT_ID } from "../public/lib/demo-profile.js";
import { buildPool } from "../public/lib/pool.js";
import { COUNTED } from "../public/lib/demo-script.js";
import { TOOLS } from "../public/lib/agent-tools.js";
import { AGENT_WINDOW, AGENT_DAILY, AGENT_USD_DAILY } from "../src/agent.js";
import { WEB_TURN_SEARCHES, WEB_VISITOR_DAILY } from "../src/brief.js";
import { swapSide, SWAP_CITIES, SWAP_DRINKER } from "../public/lib/demo-swap.js";

const ROOT = new URL("..", import.meta.url).pathname;
const json = (rel) => JSON.parse(readFileSync(join(ROOT, rel), "utf8"));
const demo = json("public/data/demo/demo.json");
const route = json("public/data/routes/athletic-brewing-austin.json");

// ---- the demo plan as the tour builds it (state 0) ----
const sameIds = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
const roadOf = (ids) => demo.roads.find((r) => sameIds(r.stops.map((s) => s.id), ids)) ?? null;
const days = Object.fromEntries(demo.states[0].days.map((d) => [d.day.slice(0, 3), { doors: d.ids.length, roadMi: roadOf(d.ids)?.mi ?? null }]));
const tue = demo.states[0].days[0];
const pool = buildPool({ routes: [route], profile: demoProfile(new Date()), contacts: [demoContact(route.venues[DEMO_CONTACT_ID])], cityName: "Austin" });
const rankOf = (id) => pool.rows.find((r) => r.id === id)?.rank ?? null;
const name = (id) => route.venues[id]?.name ?? id;
const top = demo.stop1; // the tour's showcased stop: the drinker's #1 room
const N = pool.rows.filter((r) => r.rank).length;
// the #1 room's place if the same ranked rooms were ordered by Qloo's popularity alone (the lead image's "Which door")
const byPop = pool.rows.filter((r) => r.rank).map((r) => r.id).sort((a, b) => (route.venues[b]?.popularity ?? 0) - (route.venues[a]?.popularity ?? 0));

// ---- the Qloo ledger ----
const ledger = readFileSync(join(ROOT, "data/ledger.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const by = (f) => ledger.filter(f).length;
const src = (s) => (x) => x.source === s;
const calls = {
  total: ledger.length,
  months: [...new Set(ledger.map((x) => x.ts.slice(0, 7)))],
  precompute: by(src("precompute")), retries: by((x) => x.source === "precompute" && x.status === 429), answered400: by((x) => x.source === "precompute" && x.status === 400),
  dev: by(src("dev")), posttest: by(src("posttest")),
  prewarm: by(src("prewarm")),
  probes: by((x) => x.source.startsWith("probe")),
  deep: by((x) => x.source.startsWith("deep") && !(x.source === "deep-prewarm" && x.ts >= "2026-10-27T19:00")),
  placefill: by(src("place-fill")), // group 3: music + sister doors for the held cities' top 50s (scripts/place-fill.mjs)
  ages: by(src("age-bands")), // r2: 21–24 and 55 and over for every held list (scripts/age-bands.mjs)
  // qloofull (2026-10-27): the saved runs' fill — age bands, tags, culture, sister doors, sounds and the enrichment of the
  // top 40 of every saved run and of Jard's demo runs (scripts/qloofull-*.mjs, deep-prewarm --tags, enrich-bake --prewarm)
  qloofull: by((x) => x.source === "qloofull" || x.source === "qloofull-place" || ((x.source === "enrich" || x.source === "deep-prewarm") && x.ts >= "2026-10-27T19:00")),
};
calls.enrich3 = by((x) => (x.source === "enrich" || x.source === "enrich-probe") && x.ts < "2026-10-27T19:00"); // round 3's per-door enrichment of the held cities
calls.other = calls.total - calls.precompute - calls.dev - calls.posttest - calls.prewarm - calls.probes - calls.deep - calls.placefill - calls.ages - calls.qloofull - calls.enrich3;
const hadDir = existsSync(join(ROOT, "data/prewarm"));
const dry = execFileSync("node", [join(ROOT, "scripts/prewarm.mjs"), "--dry-run"], { encoding: "utf8" });
if (!hadDir) try { rmdirSync(join(ROOT, "data/prewarm")); } catch {} // the dry run makes it; leave no empty dir behind
const prewarmRuns = Number(dry.match(/(\d+) combos/)?.[1]);

// ---- Doors Agent (judge pass 7: the docs said seven tools, 40 a day and free models after the build moved on) ----
const agent = { tools: TOOLS.length, window: AGENT_WINDOW, daily: AGENT_DAILY, usd: AGENT_USD_DAILY, webTurn: WEB_TURN_SEARCHES, webDaily: WEB_VISITOR_DAILY };
const MODEL_NOTICE = readFileSync(join(ROOT, "public/ui/agent.js"), "utf8").match(/export const MODEL_NOTICE = "([^"]+)"/)?.[1];

// ---- the tour's last card (card 22): each city's #1 door, its rank and where popularity alone puts it ----
const swap = Object.fromEntries(SWAP_CITIES.map((key) => [key, swapSide({ route: json(`public/data/routes/${SWAP_DRINKER}-${key}.json`), city: json(`public/data/cities/${key}.json`), cityKey: key, cityName: key[0].toUpperCase() + key.slice(1), profile: demoProfile(new Date()) })]));

// ---- the proof ----
const proof = json("data/proof/results.json");
const won = (k) => ({ won: proof[k].filter((x) => x.overall === "doors").length, of: proof[k].length });
const ok = (k) => ({ won: proof[k].filter((x) => x.ok !== false).length, of: proof[k].length });
// judge rows the cache had no verdict for (a wording change re-keys every prompt): the docs' judge numbers would be
// counted over rows nobody judged, so --check fails until `node scripts/proof.mjs --judge` has run on this text
const unjudged = ["pairs", "pairsRank", "pairsReturn", "swapJudge"].reduce((t, k) => t + proof[k].filter((x) => x.error).length, 0);
// the both-orders re-ask (scripts/proof/both-orders.mjs), when it has been run in this repo
const bothPath = join(ROOT, "data/proof/both-orders.json");
const both = existsSync(bothPath) ? json("data/proof/both-orders.json") : null;
const bothOk = both ? both.rows.filter((r) => !r.error) : [];
const bothWon = both ? { won: bothOk.filter((r) => r.overall === "doors").length, of: both.rows.length, commit: both.commit } : null;
// per scenario, both orders: Doors won both, the popularity list won both, or split (judge pass 12: a doc said "five
// scenarios" after the re-ask made it six, and no check read that sentence)
const bothBy = both ? Object.values(Object.groupBy(both.rows, (r) => r.key)).map((rs) => (rs.every((r) => r.overall === "doors") ? "doors" : rs.every((r) => r.overall === "baseline") ? "base" : "split")) : [];
const bothScen = { doors: bothBy.filter((x) => x === "doors").length, base: bothBy.filter((x) => x === "base").length, split: bothBy.filter((x) => x === "split").length };
// the return-visit pairs asked in both orders (freeze 10-28), and how often the judge's pick was whichever output came second
const bothRetPath = join(ROOT, "data/proof/both-orders-return.json");
const bothRet = existsSync(bothRetPath) ? json("data/proof/both-orders-return.json") : null;
const bothRetOk = bothRet ? bothRet.rows.filter((r) => !r.error) : [];
const bothRetWon = bothRet ? { won: bothRetOk.filter((r) => r.overall === "doors").length, of: bothRet.rows.length, commit: bothRet.commit } : null;
const second = (rows) => rows.filter((r) => (r.doorsIs === "A" && r.overall === "baseline") || (r.doorsIs === "B" && r.overall === "doors")).length;
// judge v2 (scores; scripts/proof/judge.mjs), if run
const tot = (s) => ["said", "applied", "done"].reduce((a, l) => a + Number(s?.[l] ?? 0), 0);
const v2Of = (rel) => { const pth = join(ROOT, rel); const f = existsSync(pth) ? json(rel) : null; const ok = f ? f.rows.filter((r) => !r.error) : []; return f ? { won: ok.filter((r) => r.overall === "doors").length, of: ok.length, rows: f.rows.length, secondHigher: ok.filter((r) => tot(r.doorsIs === "A" ? r.baseline : r.doors) > tot(r.doorsIs === "A" ? r.doors : r.baseline)).length, commit: f.commit } : null; };
const v2 = v2Of("data/proof/both-orders-v2.json"), v2Ret = v2Of("data/proof/both-orders-return-v2.json");
const WORDN = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };

const F = {
  tourCards: COUNTED,
  pool: N,
  days, // { tue: {doors, roadMi}, wed, thu }
  topRoom: name(top), topRank: rankOf(top), topPopRank: byPop.indexOf(top) + 1, topStopTue: tue.ids.indexOf(top) + 1, tueFirst: name(tue.ids[0]), tueFirstRank: rankOf(tue.ids[0]),
  calls, prewarmRuns,
  proof: { stable: ok("stable"), culturalOff: won("pairs"), popularity: won("pairsRank"), returnVisit: won("pairsReturn") },
};

const n = (x) => WORDN[String(x).toLowerCase()] ?? Number(String(x).replace(/,/g, ""));
const fmt = (x) => x.toLocaleString("en-US");
console.log(`Tour: ${F.tourCards} counted cards · pool: ${F.pool} rooms`);
console.log(`Demo week: ${Object.entries(days).map(([d, v]) => `${d} ${v.doors} doors ${v.roadMi ?? "?"} road mi`).join(" · ")}`);
console.log(`${F.topRoom} #${F.topRank} of ${F.pool} (#${F.topPopRank} by popularity alone): Tuesday stop ${F.topStopTue} of ${days.tue.doors}; Tuesday opens at ${F.tueFirst} (#${F.tueFirstRank})`);
console.log(`Qloo calls ${calls.months.join(", ")}: ${fmt(calls.total)} = precompute ${fmt(calls.precompute)} (${calls.retries} retries, ${calls.answered400} answered 400) + dev ${calls.dev} + post-test ${calls.posttest} + pre-warm ${fmt(calls.prewarm)} (${prewarmRuns} runs) + data probes ${calls.probes} + deep-data passes ${calls.deep} + place fill ${calls.placefill} + age bands ${calls.ages} + round-3 enrichment ${fmt(calls.enrich3)} + the saved runs' fill ${fmt(calls.qloofull)}${calls.other ? ` + other ${calls.other}` : ""}`);
console.log(`Card 22: ${SWAP_CITIES.map((k) => `${swap[k].city} ${swap[k].name} #${swap[k].rank} of ${swap[k].of} (#${swap[k].popRank} by popularity, ${swap[k].alike} sister doors)`).join(" · ")}`);
console.log(`Doors Agent: ${agent.tools} tools · ${agent.window} turns per 10 min, ${agent.daily} a day · $${agent.usd} a day on Claude · web searches ${agent.webTurn} a turn, ${agent.webDaily} a visitor a day`);
console.log(`Proof: same input ${F.proof.stable.won}/${F.proof.stable.of} · vs cultural off ${F.proof.culturalOff.won}/${F.proof.culturalOff.of} · vs popularity ${F.proof.popularity.won}/${F.proof.popularity.of} · return visit ${F.proof.returnVisit.won}/${F.proof.returnVisit.of} · both orders ${bothWon ? `${bothWon.won}/${bothWon.of} (asked at ${bothWon.commit}; the second output won ${second(bothOk)}/${bothOk.length})` : "not run here (scripts/proof/both-orders.mjs)"} · return visit both orders ${bothRetWon ? `${bothRetWon.won}/${bothRetWon.of} (the second output won ${second(bothRetOk)}/${bothRetOk.length})` : "not run here"} · judge v2 popularity ${v2 ? `${v2.won}/${v2.of} (second higher ${v2.secondHigher})` : "not run"} · judge v2 return ${v2Ret ? `${v2Ret.won}/${v2Ret.of} (second higher ${v2Ret.secondHigher})` : "not run"} · results at ${proof.commit}${unjudged ? ` · ${unjudged} judge items NOT judged` : ""}`);

if (process.argv.includes("--check")) {
  // [what, regex, expected values for its capture groups]; every match in each doc must hold
  const T = days.tue, W = days.wed, H = days.thu;
  const checks = [
    ["tour cards", /in (\d+) short cards/g, [F.tourCards]],
    ["Tuesday loop", /(\d+) doors in a ([\d.]+) road-mile loop/g, [T.doors, T.roadMi]],
    ["Tuesday loop", /\((\d+) doors, ([\d.]+) road mi\)/g, [T.doors, T.roadMi]],
    ["week", /Tue (\d+), Wed (\d+), Thu (\d+) doors/g, [T.doors, W.doors, H.doors]],
    ["week", /Tuesday (\d+) doors, Wednesday (\d+), Thursday (\d+)/g, [T.doors, W.doors, H.doors]],
    ["#1 room's stop", /#1(?: match|-ranked door)(?:, [^,]+,)? is (?:Tuesday's )?stop (\d+)/g, [F.topStopTue]],
    ["#1 room by popularity", /popularity alone puts it #(\d+)/g, [F.topPopRank]],
    ["#1 room's stop", /stop (\d+) of (\d+) on Tuesday/g, [F.topStopTue, T.doors]],
    ["pool", /(\d+) Austin bars and breweries/g, [F.pool]],
    ["pool", /#1 of (\d+)\)/g, [F.pool]],
    ["road mi", /([\d.]+) road mi\b/g, null], // any other road-mile figure must be one of the demo's days
    ["calls this month", /\*\*([\d,]+) used in October 2026\*\*/g, [calls.total]],
    ["calls this month", /([\d,]+) calls in October against/g, [calls.total]],
    ["precompute", /precompute ([\d,]+) including (\d+) retries and (\d+) answered 400/g, [calls.precompute, calls.retries, calls.answered400]],
    ["pre-warm", /pre-warm ([\d,]+) for (\d+) popular/g, [calls.prewarm, prewarmRuns]],
    ["pre-warm", /(\d+) pairs, ([\d,]+) calls/g, [prewarmRuns, calls.prewarm]],
    ["pre-warm", /pre-warm of (\d+) popular runs/g, [prewarmRuns]],
    ["calls by source", /the pre-publish audit (\d+);/g, [calls.dev]],
    ["calls by source", /catalog, search and tags (\d+);/g, [calls.probes]],
    ["calls by source", /taste hooks\) (\d+);/g, [calls.deep]],
    ["calls by source", /post-test (\d+)\)/g, [calls.posttest]],
    ["calls by source", /top 50 of every held list ([\d,]+);/g, [calls.placefill]],
    ["calls by source", /round 3, ([\d,]+);/g, [calls.enrich3]],
    ["calls by source", /Jard's demo runs ([\d,]+);/g, [calls.qloofull]],
    ["agent tools", /among (?:the )?(\d+) tools/g, [agent.tools]],
    ["agent tools", /(\d+) code-checked tools/g, [agent.tools]],
    ["agent caps", /(\d+) turns (?:per visitor )?in 10 minutes, (\d+) a day/g, [agent.window, agent.daily]],
    ["agent caps", /\$(\d+)-a-day spend cap/g, [agent.usd]],
    ["agent caps", /capped at \$(\d+) a day/g, [agent.usd]],
    ["agent caps", /\(\$(\d+) a UTC day, priced from usage/g, [agent.usd]],
    ["web searches", /(\d+) searches a (?:turn|request) and (\d+) a visitor a day/g, [agent.webTurn, agent.webDaily]],
    ["card 22", /#1 of (\d+) vs #(\d+) in Austin, #1 of (\d+) vs #(\d+) in Boise/g, [swap.austin.of, swap.austin.popRank, swap.boise.of, swap.boise.popRank]],
    ["card 22", /\((\d+) sister doors in Austin, (\d+) in Boise\)/g, [swap.austin.alike, swap.boise.alike]],
    ["proof", /cultural inputs off in (\d+) of (\d+)/g, [F.proof.culturalOff.won, F.proof.culturalOff.of]],
    ["proof", /popularity-ordered list in (\d+) of (\d+)/g, [F.proof.popularity.won, F.proof.popularity.of]],
    ["proof", /one without in (\d+) of (\d+)/g, [F.proof.returnVisit.won, F.proof.returnVisit.of]],
    ...(bothWon ? [["proof both orders", /swapped both ways, (\d+) of (\d+)/g, [bothWon.won, bothWon.of]],
      ["proof both orders", /swapped both ways, it preferred Doors in (\d+) of (\d+)/g, [bothWon.won, bothWon.of]],
      ["proof both orders", /(\d+) of (\d+) is the one to quote/g, [bothWon.won, bothWon.of]],
      ["proof both orders, by scenario", /Doors won both orders in (\w+) scenarios/g, [bothScen.doors]],
      ["proof both orders, by scenario", /popularity list won both in (\w+)\b/g, [bothScen.base]],
      ["proof both orders, by scenario", /\b(\w+) split\b/g, [bothScen.split]],
      ["proof position", /came second in (\d+) of (\d+) asks/g, [second(bothOk), bothOk.length]]] : []),
    ...(bothRetWon ? [["proof return visit both orders", /one without, asked both ways, in (\d+) of (\d+)/g, [bothRetWon.won, bothRetWon.of]],
      ["proof position, return", /came second in (\d+) of (\d+) return asks/g, [second(bothRetOk), bothRetOk.length]]] : []),
    ...(v2 ? [["proof v2 popularity", /scored Doors higher in (\d+) of (\d+) asks/g, [v2.won, v2.of]],
      ["proof v2 position", /the second output higher in (\d+) of (\d+) asks/g, [v2.secondHigher, v2.of]]] : []),
    ...(v2Ret ? [["proof v2 return", /scored the card with memory higher in (\d+) of (\d+)/g, [v2Ret.won, v2Ret.of]],
      ["proof v2 position, return", /the second card higher in (\d+) of (\d+)/g, [v2Ret.secondHigher, v2Ret.of]]] : []),
  ];
  const roadMis = new Set(Object.values(days).map((d) => d.roadMi));
  let bad = 0, seen = 0;
  // --also <file>: check another doc too (the Devpost fields draft, outside the repo), by path from the cwd
  const also = process.argv.flatMap((a, i, all) => (all[i - 1] === "--also" ? [a] : []));
  // the Devpost fields draft beside the repo (hackathons/qloo/DEVPOST-FIELDS.md) is checked whenever it is there
  const devpost = join(ROOT, "../DEVPOST-FIELDS.md");
  if (existsSync(devpost) && !also.includes(devpost)) also.push(devpost);
  for (const doc of ["README.md", "SUBMISSION.md", ...also]) {
    const text = readFileSync(also.includes(doc) ? doc : join(ROOT, doc), "utf8");
    for (const [what, re0, want] of checks) {
      const re = new RegExp(re0.source.replace(/ /g, "\\s+"), "g"); // a quoted phrase may wrap across lines
      for (const m of text.matchAll(re)) {
        seen++;
        const got = m.slice(1).map(n);
        const fine = want ? want.every((w, i) => n(w) === got[i]) : roadMis.has(got[0]);
        if (!fine) {
          bad++;
          const line = text.slice(0, m.index).split("\n").length;
          console.log(`DRIFT ${doc}:${line} ${what}: "${m[0]}" — expected ${want ? want.join(", ") : `one of ${[...roadMis].join(", ")}`}`);
        }
      }
    }
    // the panel notice the docs quote must be the app's own words, and no doc may still say the chat runs on free models
    for (const m of text.matchAll(/[Tt]he\s+panel\s+says(?:\s+so)?:?\s+"([^"]+)"/g)) {
      seen++;
      if (m[1].replace(/\s+/g, " ") !== MODEL_NOTICE) { bad++; console.log(`DRIFT ${doc}:${text.slice(0, m.index).split("\n").length} panel notice: "${m[1].slice(0, 60)}…" — expected "${MODEL_NOTICE}"`); }
    }
    for (const m of text.matchAll(/(?:runs on|on|call a) free models?\b/g)) {
      bad++;
      console.log(`DRIFT ${doc}:${text.slice(0, m.index).split("\n").length} agent models: "${m[0]}" — Doors Agent runs on Claude first (src/agent.js)`);
    }
    for (const [what, re] of [["placeholder", /LIVE_URL/g], ["proof numbers pending", /PROOF-NUMBERS-PENDING/g], ...(doc === "SUBMISSION.md" ? [["relative image", /!\[[^\]]*\]\((?!https?:)[^)]+\)/g]] : [])]) {
      for (const m of text.matchAll(re)) {
        const line = text.slice(0, m.index).split("\n").length;
        console.log(`NOTE ${doc}:${line} ${what}: ${m[0].slice(0, 70)}${what === "relative image" ? " (Devpost won't render it: see JARD-STEPS-DOORS.md)" : ""}`);
      }
    }
  }
  if (unjudged) console.log(`UNJUDGED data/proof/results.json (${proof.commit}): ${unjudged} judge items have no verdict — run node scripts/proof.mjs --judge`);
  if (both && bothOk.length < both.rows.length) console.log(`UNJUDGED data/proof/both-orders.json: ${both.rows.length - bothOk.length} rows errored — run node scripts/proof/both-orders.mjs`);
  if (bothRet && bothRetOk.length < bothRet.rows.length) console.log(`UNJUDGED data/proof/both-orders-return.json: ${bothRet.rows.length - bothRetOk.length} rows errored — run node scripts/proof/both-orders.mjs`);
  for (const [n, x] of [["both-orders-v2", v2], ["both-orders-return-v2", v2Ret]]) if (x && x.of < x.rows) console.log(`UNJUDGED data/proof/${n}.json: ${x.rows - x.of} rows errored — run node scripts/proof/both-orders.mjs`);
  const fail = bad + (unjudged ? 1 : 0) + (both && bothOk.length < both.rows.length ? 1 : 0) + (bothRet && bothRetOk.length < bothRet.rows.length ? 1 : 0) + [v2, v2Ret].filter((x) => x && x.of < x.rows).length;
  console.log(bad ? `${bad} of ${seen} quoted numbers drift` : `no drift (${seen} quoted numbers checked)`);
  process.exit(fail ? 1 : 0);
}
