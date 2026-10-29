// The routing sweep (H1, docs/ROUTING-V3.md): how many doors each day holds, their ranks, the idle and driving minutes,
// and the doors a day could have taken as they stood: a ranked door left off that fits into a planned day at some
// position (open on arrival, a wait of at most WAIT_MAX_MIN, the visit inside the window less END_SLACK_MIN) with no
// other door moved. Every brand × city × five window sets, planned on the straight-line estimate from the shipped
// files, plus the demo profile. No network.
// K1 (driving first): each day as a loop back to its start: loop driving a day and a door (the drive home counted),
// crossings between different days' loops, and stops cheaper to insert into another day (where they fit) than what
// they add to their own day's loop.
//   node scripts/sweep-routing.mjs [planner.js] [--json]      (default: public/lib/schedule.js)
// V5 eval: top-10, top-3 and #1 kept, mean and median rank, mean v and value captured on REF; sweepRouting({ input }) adds planner
// input (routing: 'v5', v5: {…}); scripts/sweep-v5.mjs runs the grid.
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
const R = new URL("..", import.meta.url).pathname;
// the planner: SWEEP_PLANNER (set by scripts/sweep-v5.mjs), else the first argument when run directly
const arg = process.env.SWEEP_PLANNER || (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href ? process.argv.slice(2).find((a) => !a.startsWith("--")) : null);
// the pool and the rest come from the planner's own lib folder (another worktree's planner gets its own pool.js); a
// temp copy of the planner (sweep-v5 --v4-rank) sits beside them
const LIB = arg ? dirname(resolve(arg)) + "/" : R + "public/lib/";
const { planDays, estimateTravel, EXCLUDED_STATUSES, WAIT_MAX_MIN, END_SLACK_MIN } = await import(arg ? pathToFileURL(resolve(arg)).href : LIB + "schedule.js");
const { buildPool, windowsFor } = await import(LIB + "pool.js");
const { defaultRooms } = await import(LIB + "profile.js");
const { openMinutes, km, legsCross } = await import(LIB + "core.js");
const { demoProfile } = await import(LIB + "demo-profile.js");
const J = (p) => JSON.parse(readFileSync(R + "public/data/" + p, "utf8"));

export const SHAPES = {
  demo: [{ date: "2026-10-13", from: "13:00", to: "18:00" }, { date: "2026-10-14", from: "14:00", to: "17:00" }, { date: "2026-10-15", from: "14:00", to: "17:00" }],
  week: ["12", "13", "14", "15", "16"].map((d) => ({ date: `2026-10-${d}`, from: "14:00", to: "18:00" })),
  mixed: [{ date: "2026-10-13", from: "11:00", to: "14:00" }, { date: "2026-10-14", from: "17:00", to: "22:00" }, { date: "2026-10-15", from: "10:00", to: "20:00" }],
  late: [{ date: "2026-10-13", from: "16:00", to: "20:00" }, { date: "2026-10-14", from: "16:00", to: "20:00" }],
  short: [{ date: "2026-10-13", from: "15:00", to: "16:30" }, { date: "2026-10-14", from: "15:00", to: "16:30" }],
};
const VISIT = 25;
const legOf = (a, b) => {
  if (!a) return { mi: 0, min: 0 };
  const e = estimateTravel(a, b);
  return { mi: Math.round(e.mi * 10) / 10, min: e.min > 0 ? Math.max(1, Math.round(e.min)) : 0 };
};
// A day's order as a rep could drive it: leave any time from the window's start (the first door may set it), wait
// at most WAIT_MAX_MIN at any later door, every visit open and over by the window's end less END_SLACK_MIN.
function fits(d, seq) {
  let t = d.from;
  let cur = d.start;
  for (const [k, r] of seq.entries()) {
    let eta = t + legOf(cur, r).min;
    const p = r.parsedHours;
    if (p?.ok) {
      const max = k === 0 ? d.to - eta : WAIT_MAX_MIN;
      let w = 0;
      for (; w <= max; w++) { const m = openMinutes(p, d.day, eta + w, eta + w + VISIT); if (m === null || m >= VISIT) break; }
      if (w > max) return false;
      eta += w;
    }
    if (eta + VISIT > d.to - END_SLACK_MIN) return false;
    t = eta + VISIT;
    cur = r;
  }
  return true;
}

// V5 eval (docs/ROUTING-V5-EVAL.md): rank value curves, v(1) = 1. `aff` is the Qloo affinity scaled from the list's
// last (0) to its first (1); the rest are by pool rank r of N.
export const CURVES = {
  linear: (r, { N }) => (N > 1 ? (N - r) / (N - 1) : 1),
  hyper: (r, { k }) => 1 / (1 + (r - 1) / k),
  exp: (r, { k }) => Math.exp(-(r - 1) / k),
  aff: (r, { aff, a1, aN }) => (aff == null || a1 === aN ? 0 : Math.max(0, (aff - aN) / (a1 - aN))),
};
// The fixed yardstick every row is scored on, whatever the planner's own weights: hyperbolic k 15 on the door's place in
// its drinker's RAW Qloo list (lists.all), not the place after the Rooms filter (docs/ROUTING-V5.md §2: #1 = 1,
// #10 = 0.62, #50 = 0.23); a door on no raw list is worth 0.
export const REF = { curve: "hyper", k: 15 };
const rawRankOf = (route) => new Map((route.lists?.all ?? []).map((row, i) => [row[0], i + 1]));

export function sweepRouting({ marks = true, input: extra = {}, ref = REF } = {}) {
  const index = J("index.json");
  const out = { top10: 0, top10Of: 0, top3: 0, top3Of: 0, top1: 0, top1Of: 0, value: 0, ideal: 0, ranks: [], plans: 0, days: 0, doors: 0, rankSum: 0, idle: 0, drive: 0, wait: 0, loop: 0, crossings: 0, elsewhere: 0, missed: 0, missedNear: 0, missedTop: 0, missedCodes: {}, plansMissing: 0, ms: [], cases: [] };
  const run = (tag, profile, route, cityName) => {
    const pool = buildPool({ routes: [route], profile, statuses: {}, cityName });
    const input = { pool: pool.rows, statuses: pool.statuses, windows: windowsFor(profile), visitMin: VISIT, pinned: pool.pinned, ...extra };
    const t0 = performance.now();
    const plan = planDays(input);
    out.ms.push(performance.now() - t0);
    out.plans++;
    const byId = new Map(pool.rows.map((r) => [r.id, r]));
    const rankOf = new Map(pool.ids.map((id, i) => [id, i + 1]));
    const days = plan.days.filter((d) => d && !d.past);
    for (const d of days) {
      out.days++;
      out.doors += d.stops.length;
      for (const s of d.stops) out.rankSum += rankOf.get(s.id) ?? pool.N;
      const drive = d.stops.reduce((a, s) => a + s.legMin, 0);
      const wait = d.stops.reduce((a, s) => a + (s.waitMin ?? 0), 0);
      out.drive += drive;
      out.wait += wait;
      out.idle += d.to - d.from - drive - wait - VISIT * d.stops.length;
    }
    // K1: loops (start → stops → start), crossings between days' loops, stops cheaper on another day
    const loopOf = (d, seq) => {
      let s = 0;
      let cur = d.start;
      for (const r of seq) (s += legOf(cur, r).min), (cur = r);
      return seq.length && d.start ? s + legOf(cur, d.start).min : s;
    };
    const seqOf = (d) => d.stops.map((s) => byId.get(s.id));
    for (const d of days) out.loop += loopOf(d, seqOf(d));
    const segs = days.map((d) => {
      const pts = d.start && d.stops.length ? [d.start, ...seqOf(d), d.start] : [];
      return pts.slice(1).map((p, i) => [pts[i], p]);
    });
    for (let a = 0; a < segs.length; a++) for (let b = a + 1; b < segs.length; b++) for (const [p, q] of segs[a]) for (const [r, t] of segs[b]) if (legsCross(p, q, r, t)) out.crossings++;
    for (const [ai, d] of days.entries()) {
      const seq = seqOf(d);
      const base = loopOf(d, seq);
      seq.forEach((x, i) => {
        if (d.stops[i].pinned || d.stops[i].locked) return;
        const own = base - loopOf(d, seq.filter((y) => y !== x));
        const cheaper = days.some((e, bi) => {
          if (bi === ai) return false;
          const sq = seqOf(e);
          const b0 = loopOf(e, sq);
          for (let p = 0; p <= sq.length; p++) {
            const t = [...sq.slice(0, p), x, ...sq.slice(p)];
            if (loopOf(e, t) - b0 < own && fits(e, t)) return true;
          }
          return false;
        });
        if (cheaper) out.elsewhere++;
      });
    }
    // missed: a ranked door left off that fits into a day as it stands
    const on = new Set(days.flatMap((d) => d.stops.map((s) => s.id)));
    let missing = 0;
    const missedHere = [];
    for (const r of pool.rows) {
      if (on.has(r.id) || !Number.isFinite(r.rank) || EXCLUDED_STATUSES.has(pool.statuses[r.id])) continue;
      const d = days.find((x) => {
        const seq = x.stops.map((s) => byId.get(s.id));
        for (let p = 0; p <= seq.length; p++) if (fits(x, [...seq.slice(0, p), r, ...seq.slice(p)])) return true;
        return false;
      });
      if (!d) continue;
      missing++;
      out.missed++;
      const near = [d.start, ...d.stops.map((s) => byId.get(s.id))].some((p) => p && legOf(p, r).mi <= 2);
      if (near) out.missedNear++;
      if ((rankOf.get(r.id) ?? Infinity) <= pool.N / 2) out.missedTop++;
      const code = plan.reasons?.[r.id]?.code ?? "none";
      out.missedCodes[code] = (out.missedCodes[code] ?? 0) + 1;
      missedHere.push({ id: r.id, name: pool.venues[r.id]?.name, rank: rankOf.get(r.id), day: d.day, code });
    }
    if (missing) out.plansMissing++;
    // rank: the top 10 free doors open ≥ a visit in some window (as sweep-planner counts them), kept anywhere in the
    // week; the value of the doors on the plan on the fixed curve, and the same over the best-ranked free doors of
    // the same count (the most that many doors could be worth)
    const free = pool.rows.filter((r) => Number.isFinite(r.rank) && !EXCLUDED_STATUSES.has(pool.statuses[r.id]) && input.windows.some((w) => { const m = openMinutes(r.parsedHours, w.day, w.from, w.to); return m === null || m >= VISIT; })).sort((a, b) => a.rank - b.rank);
    const top = free.slice(0, 10);
    out.top10Of += top.length;
    out.top10 += top.filter((r) => on.has(r.id)).length;
    if (free.length) (out.top1Of++, (out.top1 += on.has(free[0].id) ? 1 : 0));
    out.top3Of += free.slice(0, 3).length;
    out.top3 += free.slice(0, 3).filter((r) => on.has(r.id)).length;
    const raw = rawRankOf(route);
    const v = (id) => (raw.has(id) ? CURVES[ref.curve](raw.get(id), { k: ref.k, N: raw.size }) : 0);
    const keptIds = days.flatMap((d) => d.stops.map((s) => s.id));
    out.ranks.push(...keptIds.map((id) => rankOf.get(id)).filter(Number.isFinite));
    out.vSum = (out.vSum ?? 0) + keptIds.reduce((a, id) => a + v(id), 0);
    out.vN = (out.vN ?? 0) + keptIds.length;
    out.value += keptIds.reduce((a, id) => a + v(id), 0);
    out.ideal += free.map((r) => v(r.id)).sort((a, b) => b - a).slice(0, keptIds.length).reduce((a, x) => a + x, 0);
    out.cases.push({ tag, doors: days.map((d) => d.stops.length), missed: missedHere, top10: top.filter((r) => on.has(r.id)).map((r) => r.rank) });
    return { plan, pool, route };
  };
  for (const b of index.brands) for (const c of index.cities) {
    const route = J(`routes/${b.key}-${c.key}.json`);
    const what = route.drinker.category;
    const start = { label: "centre", lat: c.center[0], lon: c.center[1] };
    for (const [ck, wins] of Object.entries(SHAPES)) {
      const profile = { brand: "Test", what, rooms: defaultRooms(what), drinks: [{ key: b.key, name: route.drinker.name, ready: true }], start, windows: wins, visitMin: VISIT, known: [] };
      run(`${b.key}-${c.key}/${ck}`, profile, route, c.name);
    }
  }
  const demo = demoProfile(new Date(2026, 9, 9));
  out.demo = run("demo", { ...demo, known: demo.known }, J("routes/athletic-brewing-austin.json"), "Austin");
  const n = (x) => Math.round(x * 10) / 10;
  out.summary = {
    plans: out.plans, days: out.days,
    doorsPerDay: n(out.doors / out.days), doorsPerDayExact: out.doors / out.days, meanRank: n(out.rankSum / out.doors), idlePerDay: n(out.idle / out.days), drivePerDay: n(out.drive / out.days), drivePerDoor: n(out.drive / out.doors),
    loopPerDay: n(out.loop / out.days), loopPerDoor: n(out.loop / out.doors), crossingsBetweenDays: out.crossings, crossingsPerPlan: n(out.crossings / out.plans), stopsCheaperElsewhere: out.elsewhere, waitPerDay: n(out.wait / out.days),
    missed: out.missed, missedNear: out.missedNear, missedTopHalf: out.missedTop, plansWithMissed: out.plansMissing, missedCodes: out.missedCodes,
    top10Kept: n((100 * out.top10) / out.top10Of), top3Kept: n((100 * out.top3) / out.top3Of), meanV: Math.round((1000 * out.vSum) / out.vN) / 1000, top1Kept: n((100 * out.top1) / out.top1Of), medianRank: out.ranks.slice().sort((a, b) => a - b)[out.ranks.length >> 1],
    valuePerPlan: n(out.value / out.plans), valueCaptured: n((100 * out.value) / out.ideal),
    msMedian: n(out.ms.slice().sort((a, b) => a - b)[out.ms.length >> 1]), msMax: n(Math.max(...out.ms)),
    doorsPerDayBy: Object.fromEntries(Object.keys(SHAPES).map((sh) => {
      const d = out.cases.filter((c) => c.tag.endsWith(`/${sh}`)).flatMap((c) => c.doors);
      return [sh, n(d.reduce((a, b) => a + b, 0) / d.length)];
    })),
  };
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const s = sweepRouting();
  const demo = s.cases.find((c) => c.tag === "demo");
  if (process.argv.includes("--json")) console.log(JSON.stringify({ summary: s.summary, demo }, null, 1));
  else {
    console.log(s.summary);
    console.log("demo", JSON.stringify(demo));
    const lk = s.demo.pool.ids.findIndex((id) => /latchkey/i.test(s.demo.pool.venues[id].name));
    const id = s.demo.pool.ids[lk];
    console.log("Latchkey", `#${lk + 1}`, s.demo.plan.days.find((d) => d.stops.some((x) => x.id === id))?.day ?? "off", JSON.stringify(s.demo.plan.reasons[id] ?? null));
  }
}
