// The planner sweep (Diolosa R1 §2, F1): every ready brand × city × three window shapes, plus a carry-over re-plan,
// planned on the straight-line estimate from the shipped files. No network.   node scripts/sweep-planner.mjs [--json]
// Measures legality (§6 rules) and the area bars: long legs, crossing legs, stops nearer another day's centre, and
// the week's miles per door by weekday; plus rank quality (mean rank on the plan, top-10 kept) and how many other
// days change when a door is marked "not a fit".
import { readFileSync } from "node:fs";
import { planDays, estimateTravel, EXCLUDED_STATUSES, WAIT_MAX_MIN, END_SLACK_MIN } from "../public/lib/schedule.js";
import { buildPool, windowsFor } from "../public/lib/pool.js";
import { defaultRooms } from "../public/lib/profile.js";
import { parseHours, openMinutes, km, legsCross } from "../public/lib/core.js";

const ROOT = new URL("..", import.meta.url).pathname;
const J = (p) => JSON.parse(readFileSync(`${ROOT}public/data/${p}`, "utf8"));
export const LONG_LEG_MI = 5;
export const SHAPES = {
  tue: [{ date: "2026-10-13", from: "14:00", to: "18:00" }],
  week: ["12", "13", "14", "15", "16"].map((d) => ({ date: `2026-10-${d}`, from: "14:00", to: "18:00" })),
  mixed: [{ date: "2026-10-13", from: "11:00", to: "14:00" }, { date: "2026-10-14", from: "17:00", to: "22:00" }, { date: "2026-10-15", from: "10:00", to: "20:00" }],
};

export function sweepPlanner({ timing = false, routing = process.env.ROUTING || undefined } = {}) {
  const index = J("index.json");
  const out = {
    plans: 0, days: 0, stops: 0, problems: [],
    longLegs: [], firstLegsOver: [], crossingDays: 0, daysWithStops: 0,
    intrusion: 0, multiStops: 0,
    weekday: {}, carriedLost: [], ms: [], rankSum: 0, top10: 0, top10Of: 0, top10Reach: 0, top10ReachOf: 0, top10Off: [], slow: [], otherDays: 0, otherDaysChanged: 0, marks: 0, droppedOther: 0,
  };
  const prob = (k, m) => out.problems.push(`${k}: ${m}`);
  const check = (tag, plan, pool, statuses) => {
    const seen = new Set();
    const byId = new Map(pool.rows.map((r) => [r.id, r]));
    plan.days.forEach((d) => {
      if (!d || d.past) return;
      out.days++;
      let t = d.leave ?? d.from;
      let cur = d.start;
      const pts = [d.start];
      d.stops.forEach((s, k) => {
        out.stops++;
        const r = byId.get(s.id);
        if (seen.has(s.id)) prob("dup", `${tag} ${s.id}`);
        seen.add(s.id);
        if (EXCLUDED_STATUSES.has(statuses[s.id]) && !s.pinned) prob("excluded", `${tag} ${s.id}`);
        const e = estimateTravel(cur, r);
        const lm = e.min > 0 ? Math.max(1, Math.round(e.min)) : 0;
        if (s.eta !== t + lm + (s.waitMin ?? 0) || (s.waitMin ?? 0) > WAIT_MAX_MIN || s.waitMin < 0) prob("eta", `${tag} ${d.day} stop ${k + 1}`);
        const ph = parseHours(pool.venues[s.id].hours);
        const m = openMinutes(ph, d.day, s.eta, s.eta + 25);
        if (ph.ok && m !== null && m < 25) prob("closed", `${tag} ${d.day} ${s.id} eta ${s.eta}`);
        if (s.legMi > LONG_LEG_MI && !s.pinned) (k === 0 ? out.firstLegsOver : out.longLegs).push(`${tag} ${d.day} #${k + 1} ${s.legMi} mi`);
        t = s.depart;
        cur = r;
        pts.push(r);
      });
      if (d.end > d.to - (d.frozen ? 0 : END_SLACK_MIN)) prob("overrun", `${tag} ${d.day}`);
      if (d.stops.length) out.daysWithStops++;
      let cross = 0;
      for (let i = 0; i < pts.length - 1; i++) for (let j = i + 2; j < pts.length - 1; j++) if (legsCross(pts[i], pts[i + 1], pts[j], pts[j + 1])) cross++;
      if (cross) out.crossingDays++;
    });
    const live = plan.days.filter((d) => d && !d.past && d.stops.length);
    if (live.length > 1) {
      const cent = (d) => ({ lat: d.stops.reduce((a, s) => a + byId.get(s.id).lat, 0) / d.stops.length, lon: d.stops.reduce((a, s) => a + byId.get(s.id).lon, 0) / d.stops.length });
      const cs = live.map(cent);
      live.forEach((d, i) => d.stops.forEach((s) => {
        const r = byId.get(s.id);
        out.multiStops++;
        if (cs.some((c, j) => j !== i && km(r, c) < km(r, cs[i]) - 0.5)) out.intrusion++;
      }));
    }
  };
  for (const b of index.brands) for (const c of index.cities) {
    const route = J(`routes/${b.key}-${c.key}.json`);
    const what = route.drinker.category;
    const start = { label: "centre", lat: c.center[0], lon: c.center[1] };
    for (const [ck, wins] of Object.entries(SHAPES)) {
      const profile = { brand: "Test", what, rooms: defaultRooms(what), drinks: [{ key: b.key, name: route.drinker.name, ready: true }], start, windows: wins, visitMin: 25, known: [] };
      const statuses = {};
      route.lists.all.slice(1, 30).forEach((r, i) => { if (i % 7 === 3) statuses[r[0]] = ["visited", "talked", "notfit"][i % 3]; });
      const pool = buildPool({ routes: [route], profile, statuses, cityName: c.name });
      const input = { pool: pool.rows, statuses: pool.statuses, windows: windowsFor(profile), visitMin: 25, pinned: pool.pinned, ...(routing ? { routing } : {}), ...(process.env.V5 ? { v5: JSON.parse(process.env.V5) } : {}) };
      const t0 = performance.now();
      const plan = planDays(input);
      const ms = performance.now() - t0;
      out.ms.push(ms);
      if (ms > 100) out.slow.push(`${b.key}-${c.key}/${ck} ${Math.round(ms)} ms`);
      // rank quality: mean pool rank of the scheduled doors, and how many of the 10 best eligible doors open in some
      // window are on the plan
      const rankOf = new Map(pool.ids.map((id, i) => [id, i + 1]));
      for (const d of plan.days) for (const s of d.stops) out.rankSum += rankOf.get(s.id) ?? 0;
      const on = new Set(plan.days.flatMap((d) => d.stops.map((s) => s.id)));
      const top = pool.rows.filter((r) => r.rank && !EXCLUDED_STATUSES.has(pool.statuses[r.id]) && input.windows.some((w) => { const m = openMinutes(r.parsedHours, w.day, w.from, w.to); return m === null || m >= 25; })).slice(0, 10);
      out.top10Of += top.length;
      out.top10 += top.filter((r) => on.has(r.id)).length;
      // the same, leaving out doors the plan names as out of reach (farther than any day's area from every start)
      const reach = top.filter((r) => !plan.reasons?.[r.id]?.outOfReach);
      out.top10ReachOf += reach.length;
      out.top10Reach += reach.filter((r) => on.has(r.id)).length;
      // K1 (driving first): why each top-10 door off the plan is off: its reason code (and minutes, for "detour")
      for (const r of top) if (!on.has(r.id)) out.top10Off.push({ tag: `${b.key}-${c.key}/${ck}`, rank: r.rank, code: plan.reasons?.[r.id]?.code ?? "none", min: plan.reasons?.[r.id]?.min ?? null });
      out.plans++;
      const tag = `${b.key}-${c.key}/${ck}`;
      check(tag, plan, pool, pool.statuses);
      if (JSON.stringify(planDays(input)) !== JSON.stringify(plan)) prob("nondeterministic", tag);
      if (ck === "week") {
        for (const d of plan.days) {
          const w = (out.weekday[d.day] ??= { mi: 0, doors: 0 });
          w.mi += d.mi;
          w.doors += d.stops.length;
        }
        // stability: mark ten doors "not a fit" one after another (R1 Diolosa 10); count the other days that change
        let cur = plan;
        let st = { ...input.statuses };
        for (let i = 0; i < 10; i++) {
          const id = cur.days[i % cur.days.length].stops[0]?.id ?? cur.days.find((d) => d.stops.length)?.stops[0].id;
          if (!id) break;
          const marked = cur.days.findIndex((d) => d.stops.some((x) => x.id === id));
          st = { ...st, [id]: "notfit" };
          const next = planDays({ ...input, statuses: st, previous: cur });
          out.marks++;
          next.days.forEach((d, k) => {
            if (k === marked) return;
            out.otherDays++;
            if (d.stops.map((x) => x.id).join() !== cur.days[k].stops.map((x) => x.id).join()) out.otherDaysChanged++;
            // doors an untouched day lost (F1b: ≤ 1 per status change on average)
            const now = new Set(d.stops.map((x) => x.id));
            out.droppedOther += cur.days[k].stops.filter((x) => !now.has(x.id)).length;
          });
          cur = next;
        }
        const p2 = planDays({ ...input, now: { date: "2026-10-13", min: 19 * 60 }, previous: plan });
        out.plans++;
        check(tag + "+carry", p2, pool, pool.statuses);
        // a carried door is scheduled again or named in the notes
        const later = new Set(p2.days.filter((d) => !d.past).flatMap((d) => d.stops.map((s) => s.id)));
        const noted = new Set(p2.notes.flatMap((n) => (n.kind === "carried-unscheduled" ? n.ids ?? [n.id] : [])));
        for (const id of p2.carried) if (!later.has(id) && !noted.has(id)) out.carriedLost.push(`${tag} ${id}`);
      }
    }
  }
  const order = ["monday", "tuesday", "wednesday", "thursday", "friday"];
  out.miPerDoor = Object.fromEntries(order.map((d) => [d, Math.round((out.weekday[d].mi / out.weekday[d].doors) * 100) / 100]));
  out.lastVsFirst = Math.round((out.miPerDoor.friday / out.miPerDoor.monday) * 100) / 100;
  out.intrusionShare = Math.round((out.intrusion / out.multiStops) * 1000) / 1000;
  out.maxMs = Math.round(Math.max(...out.ms));
  out.meanRank = Math.round((out.rankSum / out.stops) * 10) / 10;
  out.top10Share = Math.round((out.top10 / out.top10Of) * 1000) / 1000;
  out.top10ReachShare = Math.round((out.top10Reach / out.top10ReachOf) * 1000) / 1000;
  out.reshuffleShare = Math.round((out.otherDaysChanged / out.otherDays) * 1000) / 1000;
  out.droppedPerMark = Math.round((out.droppedOther / out.marks) * 100) / 100;
  delete out.rankSum;
  delete out.ms;
  delete out.weekday;
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const s = sweepPlanner();
  const short = { ...s, problems: s.problems.slice(0, 10), problemCount: s.problems.length, longLegs: s.longLegs.slice(0, 8), longLegCount: s.longLegs.length, firstLegsOver: s.firstLegsOver.slice(0, 8), firstLegOverCount: s.firstLegsOver.length };
  console.log(JSON.stringify(short, null, process.argv.includes("--json") ? 1 : 0));
}
