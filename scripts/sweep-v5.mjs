// V4 vs V4.1 vs V5 (docs/ROUTING-V5.md §7, docs/ROUTING-V5-EVAL.md): the 161-plan routing sweep
// (scripts/sweep-routing.mjs) once per planner setting, as one table the owner picks a row from:
//   V4 as shipped (RANK_MIN 10); V4.1 (the rank curve and RANK_V, no corridors) and V5 (corridors) at each RANK_V;
//   V5 at k 5 / 15 / 40 at the default RANK_V (k is ours, not the owner's: it should barely move the results).
// Rank columns next to the driving: top-10, top-3 and #1 kept across the week, mean and median (filtered) rank, mean v
// and value captured on the fixed yardstick (REF: hyperbolic k 15 on raw list rank), loop minutes, doors, crossings,
// idle; the demo week (on the estimate) and where Nomadic Beerworks (#1) sits; planning ms over the sweep and the
// 150 × 5 performance case (best of 3, as test/schedule.test.mjs). The gate column is the Oct 26 bar against V4.
// Also prints the owner's example (around #1: a = 1, 8, 54, 78, 90; b = 1, 2, 103, 88, 6) on every curve. No network.
//   node scripts/sweep-v5.mjs [planner.js] [--rankv 15,20,30,45] [--k 5,15,40] [--v4-rank 20,40] [--md out.md]
//                             [--json out.json] [--example-only] [--base-only]
// --v4-rank adds V4 rows with a higher RANK_MIN (a temp copy of the planner, run in a child process). V4.1 and V5 rows
// appear when the planner exports V5_DEFAULTS (input.routing 'v4.1' | 'v5', input.v5 = { rankV, k, … }).
import { writeFileSync, readFileSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { loadavg, cpus } from "node:os";
const R = new URL("..", import.meta.url).pathname;
const argv = process.argv.slice(2);
const opt = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : null; };
const nums = (k) => opt(k)?.split(",").map(Number) ?? null;
const plannerArg = argv.find((a, i) => !a.startsWith("--") && !argv[i - 1]?.startsWith("--"));
const plannerPath = plannerArg ? resolve(plannerArg) : R + "public/lib/schedule.js";
process.env.SWEEP_PLANNER = plannerPath;
const sched = await import(pathToFileURL(plannerPath).href);
const { sweepRouting, CURVES, REF } = await import(R + "scripts/sweep-routing.mjs");
const { parseHours } = await import(R + "public/lib/core.js");

const n1 = (x) => Math.round(x * 10) / 10;
const n3 = (x) => Math.round(x * 1000) / 1000;

// ---- the owner's example: which five doors around #1 are worth more ----
export function example() {
  const route = JSON.parse(readFileSync(R + "public/data/routes/athletic-brewing-austin.json", "utf8"));
  const aff = route.lists.all.map((r) => r[1]);
  const ctx = { N: aff.length, a1: aff[0], aN: aff.at(-1) };
  const A = [1, 8, 54, 78, 90];
  const B = [1, 2, 103, 88, 6];
  const rows = [[`linear (V4 rankScore, N ${aff.length})`, "linear", 0], ["hyper k 5", "hyper", 5], ["**hyper k 15 (the yardstick)**", "hyper", 15], ["hyper k 40", "hyper", 40], ["exp k 31", "exp", 31], ["raw Qloo affinity (Athletic, Austin)", "aff", 0]];
  return rows.map(([label, c, k]) => {
    const v = (r) => CURVES[c](r, { k, ...ctx, aff: aff[r - 1] });
    const a = A.reduce((s, r) => s + v(r), 0);
    const b = B.reduce((s, r) => s + v(r), 0);
    return { label, a: n3(a), b: n3(b), winner: Math.abs(a - b) < 1e-9 ? "tie" : a > b ? "a" : "b", margin: n3(b - a) };
  });
}

// ---- the performance case: 150 doors × 5 windows 11 am–6 pm, best of 3 (test/schedule.test.mjs) ----
const AUS = JSON.parse(readFileSync(R + "test/fixtures/athletic-brewing-austin.json", "utf8"));
export function perfCase(extra = {}) {
  const pool = AUS.pool.slice(0, 150).map((r) => ({ ...r, parsedHours: parseHours(r.hours) }));
  const START = { lat: 30.2556, lon: -97.7208 };
  const windows = ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"].map((date, i) => ({ date, day: ["monday", "tuesday", "wednesday", "thursday", "friday"][i], from: 660, to: 1080, start: START }));
  const input = { pool, statuses: {}, windows, visitMin: 25, travel: sched.estimateTravel, pinned: [], ...extra };
  sched.planDays(input);
  let ms = Infinity;
  for (let i = 0; i < 3; i++) { const t0 = performance.now(); sched.planDays(input); ms = Math.min(ms, performance.now() - t0); }
  return n1(ms);
}

function demoFacts(s) {
  const { plan, pool } = s.demo;
  const days = plan.days.filter((d) => d && !d.past);
  const nomadic = pool.ids.find((id) => /nomadic/i.test(pool.venues[id]?.name ?? ""));
  const at = days.map((d, i) => [i, d.stops.findIndex((x) => x.id === nomadic)]).find(([, k]) => k >= 0);
  const dn = (d) => d.day[0].toUpperCase() + d.day.slice(1, 3);
  return { doors: days.map((d) => d.stops.length).join("/"), nomadic: at ? `${dn(days[at[0]])} stop ${at[1] + 1}` : "off", anchors: days.map((d) => (d.corridor?.anchorRank ? "#" + d.corridor.anchorRank : "–")).join("/") };
}

function row(label, input) {
  const s = sweepRouting({ input });
  return { label, input, ...s.summary, demo: demoFacts(s), perfMs: perfCase(input) };
}

const gate = (v, b) => {
  const fails = [];
  if (!(v.top10Kept > b.top10Kept)) fails.push("top-10");
  if (!(v.meanRank < b.meanRank)) fails.push("mean rank");
  if (v.loopPerDay > b.loopPerDay * 1.25) fails.push("loop +" + Math.round((100 * v.loopPerDay) / b.loopPerDay - 100) + "%");
  if (v.doorsPerDayExact < b.doorsPerDayExact - 0.05) fails.push("doors"); // a twentieth of a door a day is noise
  if (v.perfMs >= 200) fails.push("perf");
  return fails.length ? "✗ " + fails.join(", ") : "✓";
};

const COLS = [["Setting", (r) => r.label], ["Top-10 kept", (r) => r.top10Kept + "%"], ["Top-3 kept", (r) => r.top3Kept + "%"], ["#1 kept", (r) => r.top1Kept + "%"], ["Mean rank", (r) => r.meanRank], ["Median rank", (r) => r.medianRank], ["Mean v", (r) => r.meanV], ["Value captured", (r) => r.valueCaptured + "%"], ["Loop min a day", (r) => r.loopPerDay], ["Doors a day", (r) => r.doorsPerDayExact.toFixed(2)], ["Crossings a plan", (r) => r.crossingsPerPlan], ["Idle min a day", (r) => r.idlePerDay], ["Demo Tue/Wed/Thu", (r) => r.demo.doors], ["Demo anchors", (r) => r.demo.anchors], ["Nomadic #1", (r) => r.demo.nomadic], ["Sweep ms med/max", (r) => `${r.msMedian}/${r.msMax}`], ["150×5 ms", (r) => r.perfMs], ["Bar vs V4", (r) => r.gate ?? ""]];
export const table = (rows) => ["| " + COLS.map((c) => c[0]).join(" | ") + " |", "|" + COLS.map(() => "---").join("|") + "|", ...rows.map((r) => "| " + COLS.map((c) => (r.isDefault && c[0] === "Setting" ? `**${c[1](r)}**` : c[1](r))).join(" | ") + " |")].join("\n");

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const lines = [];
  const say = (s = "") => (console.log(s), lines.push(s));
  const ex = example();
  say("## The owner's example: a = 1, 8, 54, 78, 90 vs b = 1, 2, 103, 88, 6\n");
  say("| Curve | a | b | Winner | b − a |\n|---|---|---|---|---|\n" + ex.map((e) => `| ${e.label} | ${e.a} | ${e.b} | ${e.winner} | ${e.margin} |`).join("\n") + "\n");
  if (argv.includes("--example-only")) process.exit(0);

  const rows = [];
  const base = row(`V4 (RANK_MIN ${sched.RANK_MIN}${plannerArg ? "" : ", shipped"})`, { routing: "v4" });
  rows.push(base);
  if (argv.includes("--base-only")) {
    writeFileSync(opt("json"), JSON.stringify(base));
    process.exit(0);
  }
  for (const rm of nums("v4-rank") ?? []) {
    const tmp = join(dirname(plannerPath), `.sweep-rank${rm}-${process.pid}.js`);
    const out = tmp + ".json";
    writeFileSync(tmp, readFileSync(plannerPath, "utf8").replace(/export const RANK_MIN = \d+;/, `export const RANK_MIN = ${rm};`));
    try {
      execFileSync(process.execPath, [new URL(import.meta.url).pathname, tmp, "--base-only", "--json", out], { stdio: ["ignore", "ignore", "inherit"] });
      rows.push({ ...JSON.parse(readFileSync(out, "utf8")), label: `V4 RANK_MIN ${rm}` });
    } finally {
      for (const f of [tmp, out]) try { unlinkSync(f); } catch {}
    }
    process.stderr.write(".");
  }
  const D = sched.V5_DEFAULTS;
  if (!D) say(`(the planner has no V5_DEFAULTS: no V4.1 or V5 rows; ${plannerPath})\n`);
  else {
    const rankVs = nums("rankv") ?? [15, 20, 30, 45];
    for (const routing of ["v4.1", "v5"]) for (const rankV of rankVs) {
      rows.push({ ...row(`${routing.toUpperCase()} RANK_V ${rankV}`, { routing, v5: { rankV } }), isDefault: routing === "v5" && rankV === D.rankV });
      process.stderr.write(".");
    }
    for (const k of nums("k") ?? [5, 15, 40]) {
      if (k === D.k) continue;
      rows.push(row(`V5 RANK_V ${D.rankV}, k ${k}`, { routing: "v5", v5: { rankV: D.rankV, k } }));
      process.stderr.write(".");
    }
  }
  process.stderr.write("\n");
  for (const r of rows.slice(1)) r.gate = gate(r, base);
  say(`## The sweep (161 plans on the straight-line estimate; v = ${REF.curve} k ${REF.k} on raw list rank${D ? `; V5 defaults ${JSON.stringify(D)}` : ""}; box load ${loadavg()[0].toFixed(1)} on ${cpus().length} cores: ms are noisy under load, the bar's perf check is re-run on a quiet box)\n`);
  say(table(rows));
  say("\nRooms that fit a day as it stood but were left off, by reason:");
  for (const r of rows) say(`- ${r.label}: ${r.missed} (${Object.entries(r.missedCodes).map(([k, v]) => `${k} ${v}`).join(" · ") || "none"})`);
  if (opt("md")) writeFileSync(opt("md"), lines.join("\n") + "\n");
  if (opt("json")) writeFileSync(opt("json"), JSON.stringify({ planner: plannerPath, example: ex, rows }, null, 1));
}
