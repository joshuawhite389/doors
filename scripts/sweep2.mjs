// The R2 planner sweep (Diolosa R2, ported for F4): re-derives every timing, wait, leg cap, crossing and reason claim
// from the shipped data with its own simulation, over 8 brands × 4 cities × 6 window shapes, each with a contact (a
// room from another brand's list), a follow-up re-plan, `marks` "not a fit" re-plans and a carry-over. Also: contacts
// open and reachable alone yet unplaced, follow-ups missed on a day their room is open, and default-week thin days.
// No network.   node scripts/sweep2.mjs [--json]      (test/sweep2.test.mjs runs it with fewer marks)
import { readFileSync } from "node:fs";
const R = new URL("..", import.meta.url).pathname;
const { planDays, estimateTravel, EXCLUDED_STATUSES, WAIT_MAX_MIN, END_SLACK_MIN, DOOR_MIN } = await import(R + "public/lib/schedule.js");
const { buildPool, windowsFor } = await import(R + "public/lib/pool.js");
const { defaultRooms } = await import(R + "public/lib/profile.js");
const { parseHours, openMinutes, km, legsCross } = await import(R + "public/lib/core.js");
const { replanSummary } = await import(R + "public/lib/planview.js");
const J = (p) => JSON.parse(readFileSync(R + "public/data/" + p, "utf8"));

const SHAPES = {
  tue: [{ date: "2026-10-13", from: "14:00", to: "18:00" }],
  week: ["12", "13", "14", "15", "16"].map((d) => ({ date: `2026-10-${d}`, from: "14:00", to: "18:00" })),
  mixed: [{ date: "2026-10-13", from: "11:00", to: "14:00" }, { date: "2026-10-14", from: "17:00", to: "22:00" }, { date: "2026-10-15", from: "10:00", to: "20:00" }],
  // new shapes the repo sweep does not run
  short: [{ date: "2026-10-13", from: "15:00", to: "16:30" }, { date: "2026-10-14", from: "15:00", to: "16:30" }],
  weekend: [{ date: "2026-10-17", from: "12:00", to: "23:00" }, { date: "2026-10-18", from: "12:00", to: "18:00" }],
  late: [{ date: "2026-10-13", from: "16:00", to: "18:00" }, { date: "2026-10-14", from: "16:00", to: "18:00" }, { date: "2026-10-15", from: "16:00", to: "18:00" }],
};
const VISIT = 25;
const legOf = (a, b) => {
  const e = estimateTravel(a, b);
  return { mi: Math.round(e.mi * 10) / 10, min: e.min > 0 ? Math.max(1, Math.round(e.min)) : 0 };
};
// K1: a day's loop (start → stops → start) in minutes
const loopOf = (d, seq) => {
  let s = 0;
  let cur = d.start;
  for (const r of seq) (s += legOf(cur, r).min), (cur = r);
  return seq.length && d.start ? s + legOf(cur, d.start).min : s;
};
let out;
let index;
const P = (k, m) => out.problems.push(`${k}: ${m}`);
function check(tag, plan, pool, statuses, windows) {
  for (const n of plan.notes) if (n.kind === "repaired") out.repaired.push(`${tag} ${n.text}`);
  const byId = new Map(pool.rows.map((r) => [r.id, r]));
  const pins = new Set(pool.pinned.map((p) => p.id));
  const seen = new Map();
  plan.days.forEach((d) => {
    if (!d || d.past) return;
    out.days++;
    if (/\+mark/.test(tag)) out.markDays = (out.markDays ?? 0) + 1;
    let t = d.leave ?? d.from, cur = d.start;
    const pts = d.start ? [d.start] : [];
    d.stops.forEach((s, k) => {
      out.stops++;
      const r = byId.get(s.id);
      const key = s.id;
      if (seen.has(key) && !(s.pinned === "followup" || d.frozen)) P("dup", `${tag} ${s.id}`);
      seen.set(key, d.date);
      if (EXCLUDED_STATUSES.has(statuses[s.id]) && !s.pinned && !d.frozen) P("excluded", `${tag} ${s.id}`);
      const l = legOf(cur, r);
      if (l.mi !== s.legMi || l.min !== s.legMin) P("leg", `${tag} ${d.day} #${k + 1} ${s.legMi}/${s.legMin} vs ${l.mi}/${l.min}`);
      const arrive = t + l.min;
      const wait = s.eta - arrive;
      if (wait !== (s.waitMin ?? 0)) P("waitfield", `${tag} ${d.day} #${k + 1}`);
      if (s.depart !== s.eta + VISIT) P("visit", `${tag}`);
      const ph = r.parsedHours;
      if (!d.frozen) {
        if (wait < 0 || wait > WAIT_MAX_MIN) P("wait-range", `${tag} ${d.day} #${k + 1} ${wait}`);
        if (ph?.ok) {
          const mE = openMinutes(ph, d.day, s.eta, s.eta + VISIT);
          if (mE !== null && mE < VISIT) P("closed", `${tag} ${d.day} ${s.id} eta ${s.eta}`);
          if (wait > 0) {
            out.waits++; out.waitMin += wait;
            const mA = openMinutes(ph, d.day, arrive, arrive + VISIT);
            if (mA !== null && mA >= VISIT) out.waitNotNeeded.push(`${tag} ${d.day} #${k + 1}`);
            if (!s.orderReason || !s.orderReason.includes(`wait ~${wait} min`)) out.waitNoLabel.push(`${tag} ${d.day} #${k + 1} ${s.orderReason}`);
          }
        } else if (wait > 0) P("wait-unverified", `${tag}`);
        if (!pins.has(s.id) && !(k > 0 && pins.has(d.stops[k - 1].id))) {
          if (k === 0 && s.legMi > 5 && !plan.notes.some((n) => n.kind === "far-start" && n.date === d.date)) out.firstLegs.push(`${tag} ${d.day} ${s.legMi}`);
          if (k > 0 && s.legMi > 2.5) out.softLegs.push(`${tag} ${d.day} #${k + 1} ${s.legMi}`);
        }
        if (pins.has(s.id) && s.legMi > 2.5) out.contactLongLeg++;
      }
      // a bottom-quarter door on a planned day says why it's there (R2 Calacanis 2)
      if (!d.frozen && !s.pinned && Number.isFinite(r.rank)) {
        const N = Math.max(...pool.rows.map((x) => x.rank ?? 0));
        if (r.rank > Math.ceil(0.75 * N)) (out.lowStops++, !/^(fills the (wait until .+ opens|time before .+, where you arrive) at |on the way: adds (no driving|\d+ min of driving)$)/.test(s.orderReason ?? "") && out.lowNoReason.push(`${tag} ${d.day} #${r.rank} of ${N} ${s.orderReason}`));
      }
      t = s.depart; cur = r; pts.push(r);
    });
    if (!d.frozen && d.stops.length) {
      const slack = d.to - d.end;
      if (slack < END_SLACK_MIN) P("slack", `${tag} ${d.day} ${slack}`);
      out.endSlack.min = Math.min(out.endSlack.min, slack);
      if (slack <= 10) out.endSlack.at0to5++;
    }
    let x = 0;
    for (let i = 0; i < pts.length - 1; i++) for (let j = i + 2; j < pts.length - 1; j++) if (legsCross(pts[i], pts[i + 1], pts[j], pts[j + 1])) x++;
    if (x && !d.frozen) out.crossDays.push(`${tag} ${d.day} x${x}`);
  });
  // reasons: every ranked door off the plan has one; "route" ("doubling back") checked by brute force
  const on = new Set(plan.days.flatMap((d) => (d && !d.past ? d.stops.map((s) => s.id) : [])));
  for (const r of pool.rows) {
    if (on.has(r.id) || !r.rank) continue;
    const why = plan.reasons[r.id];
    if (!why) { out.noReason.push(`${tag} ${r.id}`); continue; }
    out.reasonCodes[why.code] = (out.reasonCodes[why.code] ?? 0) + 1;
    // K1: "<day> had no time left for it" never names a day that takes it somewhere (this sweep's stricter timing), and
    // "adds N min of driving to <day>" claims more than DOOR_MIN and no more than its cheapest place there costs
    if (why.code === "full" || why.code === "detour") {
      const d = plan.days.find((x) => x && x.date === why.date);
      const seq = d.stops.map((s) => byId.get(s.id));
      let add = Infinity;
      for (let pos = 0; pos <= seq.length; pos++) {
        const next = [...seq.slice(0, pos), r, ...seq.slice(pos)];
        if (simulate(d, next)) add = Math.min(add, loopOf(d, next) - loopOf(d, seq));
      }
      if (why.code === "full" && add < Infinity && !tag.includes("+")) out.reasonFalse.push(`${tag} ${d.day} #${r.rank} "${why.text}" but it fits (+${add} min)`);
      if (why.code === "detour" && (!(why.min > DOOR_MIN) || add < why.min)) out.reasonFalse.push(`${tag} ${d.day} #${r.rank} "${why.text}" but its cheapest place adds ${add}`);
    }
    if (why.code === "route") {
      const di = plan.days.findIndex((d) => d && d.date === why.date);
      const d = plan.days[di];
      const seq = d.stops.map((s) => byId.get(s.id));
      let feasibleNoCross = false, feasibleAny = false;
      for (let pos = 0; pos <= seq.length; pos++) {
        const next = [...seq.slice(0, pos), r, ...seq.slice(pos)];
        if (!simulate(d, next)) continue;
        feasibleAny = true;
        const path = [d.start, ...next].filter(Boolean);
        let cross = 0;
        for (let i = 0; i < path.length - 1; i++) for (let j = i + 2; j < path.length - 1; j++) if (legsCross(path[i], path[i + 1], path[j], path[j + 1])) cross++;
        const legsOk = next.every((y, q) => q === 0 ? legOf(d.start, y).mi <= 5 : legOf(next[q - 1], y).mi <= 2.5);
        if (!cross && legsOk) feasibleNoCross = true;
      }
      if (!feasibleAny || feasibleNoCross) out.routeFalse.push(`${tag} ${d.day} ${r.id} ${feasibleAny ? "fits without crossing" : "no feasible slot at all"}`);
    }
  }
}
// the planner's rules (F4): a day with stops leaves at its fixed time (d.leave) and every stop may wait up to
// WAIT_MAX_MIN; an empty day's first door may make the rep leave later (no wait cap for it)
function simulate(d, seq) {
  const fixed = d.stops.length > 0;
  let t = fixed ? d.leave : d.from, cur = d.start, first = true;
  for (const r of seq) {
    const l = legOf(cur, r);
    let eta = t + l.min;
    const p = r.parsedHours;
    if (p?.ok) {
      let m = openMinutes(p, d.day, eta, eta + VISIT);
      if (m !== null && m < VISIT) {
        let ok = false;
        const max = first && !fixed ? 24 * 60 : WAIT_MAX_MIN;
        for (let w = 1; w <= max; w++) { const mm = openMinutes(p, d.day, eta + w, eta + w + VISIT); if (mm !== null && mm >= VISIT) { eta += w; ok = true; break; } }
        if (!ok) return false;
      }
    }
    first = false;
    t = eta + VISIT;
    if (t > d.to - END_SLACK_MIN) return false;
    cur = r;
  }
  return true;
}
// a contact for each combo: the best-ranked room of another brand's list in this city that is not in our pool
function pickContact(c, pool, bkey) {
  for (const b of index.brands) {
    if (b.key === bkey) continue;
    const r = J(`routes/${b.key}-${c.key}.json`);
    for (const [id] of r.lists.all.slice(10, 60)) {
      const v = r.venues[id];
      if (!pool.venues[id] && v && Number.isFinite(v.lat) && v.hours) return { ...v, id, source: "qloo" };
    }
  }
  return null;
}

export function sweep2({ marks = 10, routing = process.env.ROUTING || undefined } = {}) {
  index = J("index.json");
  out = {
  plans: 0, days: 0, stops: 0, problems: [], waits: 0, waitMin: 0, waitNoLabel: [], waitNotNeeded: [], waitLabelWrong: [],
  softLegs: [], firstLegs: [], crossDays: [], endSlack: { min: Infinity, at0to5: 0 }, reasonCodes: {}, routeFalse: [], noReason: [],
  contacts: 0, contactPlaced: 0, contactLate: [], contactUnplaced: 0, contactLongLeg: 0,
  fu: 0, fuPlacedOnDate: 0, fuMoved: 0, fuMissing: [], fuNote: 0,
  frozenChanged: [], marks: 0, other: 0, otherChanged: 0, dropped: 0, toastNull: 0, carried: 0, carriedLost: [], weekTwice: 0,
};
  Object.assign(out, { contactReachableUnplaced: [], fuMissedOpen: [], weekDays: 0, thinDays: [], repaired: [], lowStops: 0, lowNoReason: [], reasonFalse: [], thinMissed: [] });
  for (const b of index.brands) for (const c of index.cities) {
    const route = J(`routes/${b.key}-${c.key}.json`);
    const what = route.drinker.category;
    const start = { label: "centre", lat: c.center[0], lon: c.center[1] };
    for (const [ck, wins] of Object.entries(SHAPES)) {
      const profile = { brand: "Test", what, rooms: defaultRooms(what), drinks: [{ key: b.key, name: route.drinker.name, ready: true }], start, windows: wins, visitMin: VISIT, known: [] };
      const statuses = {};
      route.lists.all.slice(1, 30).forEach((r, i) => { if (i % 7 === 3) statuses[r[0]] = ["visited", "talked", "notfit"][i % 3]; });
      const pool0 = buildPool({ routes: [route], profile, statuses, cityName: c.name });
      const contact = pickContact(c, pool0, b.key);
      const contacts = contact ? [contact] : [];
      const pool = buildPool({ routes: [route], profile, statuses, contacts, cityName: c.name });
      const windows = windowsFor(profile);
      const input = { pool: pool.rows, statuses: pool.statuses, windows, visitMin: VISIT, pinned: pool.pinned, ...(routing ? { routing } : {}), ...(process.env.V5 ? { v5: JSON.parse(process.env.V5) } : {}) };
      const plan = planDays(input);
      const tag = `${b.key}-${c.key}/${ck}`;
      out.plans++;
      check(tag, plan, pool, pool.statuses, windows);
      if (ck === "week")
        for (const d of plan.days) {
          if (d.to - d.from < 120) continue;
          out.weekDays++;
          if (d.stops.length > 2) continue;
          out.thinDays.push(`${tag} ${d.day} ${d.stops.length}`);
          // K1: a thin day is thin because no free room near its loop fits it, not because the planner missed one
          const byId = new Map(pool.rows.map((r) => [r.id, r]));
          const seq = d.stops.map((s) => byId.get(s.id));
          const on = new Set(plan.days.flatMap((x) => x.stops.map((s) => s.id)));
          for (const r of pool.rows) {
            if (on.has(r.id) || !r.rank || EXCLUDED_STATUSES.has(pool.statuses[r.id])) continue;
            for (let pos = 0; pos <= seq.length; pos++) {
              const next = [...seq.slice(0, pos), r, ...seq.slice(pos)];
              if (loopOf(d, next) - loopOf(d, seq) <= DOOR_MIN && simulate(d, next)) {
                out.thinMissed.push(`${tag} ${d.day} #${r.rank} (${plan.reasons[r.id]?.text})`);
                break;
              }
            }
          }
        }
      if (JSON.stringify(planDays(input)) !== JSON.stringify(plan)) P("nondet", tag);
      // contact placement: on the first window where it is open (if placed later, report)
      if (contact) {
        out.contacts++;
        const at = plan.days.findIndex((d) => d.stops.some((s) => s.id === contact.id));
        if (at < 0) {
          out.contactUnplaced++;
          // open and reachable alone: drive from the start (leaving any time in the window), visit, end before the slack
          const ph = parseHours(contact.hours);
          const lm = legOf(start, contact).min;
          const alone = windows.filter((w) => { for (let t = w.from + lm; t + VISIT <= w.to - END_SLACK_MIN; t++) { const m = openMinutes(ph, w.day, t, t + VISIT); if (m === null || m >= VISIT) return true; } return false; });
          if (alone.length) out.contactReachableUnplaced.push(`${tag} ${contact.name} on ${alone.map((w) => w.day).join(",")}`);
        }
        else {
          out.contactPlaced++;
          const ph = parseHours(contact.hours);
          const earlier = windows.slice(0, at).filter((w) => { const m = openMinutes(ph, w.day, w.from, w.to); return m === null || m >= VISIT; });
          if (earlier.length) out.contactLate.push(`${tag} on ${windows[at].day}, open ${earlier.map((w) => w.day).join(",")}`);
        }
      }
      if (windows.length < 2) continue;
      // follow-up: visit day 1's first stop with a follow-up on the last window's date; day 1 frozen
      const d0 = plan.days.find((d) => d.stops.length);
      if (d0) {
        const id = d0.stops[0].id;
        const last = windows.at(-1).date;
        const st2 = { ...pool.statuses, [id]: "visited" };
        const pool2 = buildPool({ routes: [route], profile, statuses: st2, contacts, outcomes: { [id]: { result: "interested", followUp: last } }, cityName: c.name });
        const frozen = { date: d0.date, from: d0.from, ids: d0.stops.map((s) => s.id) };
        const p2 = planDays({ ...input, pool: pool2.rows, statuses: pool2.statuses, pinned: pool2.pinned, frozen, previous: plan });
        out.plans++;
        out.fu++;
        check(tag + "+fu", p2, pool2, pool2.statuses, windows);
        const f0 = p2.days.find((d) => d.date === d0.date);
        if (f0.stops.map((s) => s.id).join() !== frozen.ids.join()) out.frozenChanged.push(tag);
        const later = p2.days.filter((d) => d.date > d0.date && d.stops.some((s) => s.id === id));
        if (later.some((d) => d.date === last)) out.fuPlacedOnDate++;
        else if (later.length) out.fuMoved++;
        else {
          out.fuMissing.push(`${tag} ${(p2.notes.find((n) => n.id === id) ?? {}).text ?? "no note"}`);
          const lw = windows.at(-1);
          const m = openMinutes(pool.rows.find((r) => r.id === id).parsedHours, lw.day, lw.from, lw.to - END_SLACK_MIN);
          if (m === null || m >= VISIT) out.fuMissedOpen.push(`${tag} ${id}`);
        }
        if (p2.notes.some((n) => n.id === id && /follow-up/i.test(n.text))) out.fuNote++;
        if (later.length) out.weekTwice++;
      }
      // stability: ten "not a fit" marks in a row
      let cur = plan, st = { ...input.statuses };
      for (let i = 0; i < marks; i++) {
        const di = i % cur.days.length;
        const id = cur.days[di].stops.find((s) => !s.pinned)?.id;
        if (!id) continue;
        st = { ...st, [id]: "notfit" };
        const next = planDays({ ...input, statuses: st, previous: cur });
        out.marks++;
        if (!replanSummary(cur, next, { id, name: "X" })) out.toastNull++;
        next.days.forEach((d, k) => {
          if (k === di) return;
          out.other++;
          const a = cur.days[k].stops.map((s) => s.id), bb = d.stops.map((s) => s.id);
          if (a.join() !== bb.join()) out.otherChanged++;
          out.dropped += a.filter((x) => !bb.includes(x)).length;
        });
        check(tag + `+mark${i}`, next, pool, st, windows);
        cur = next;
      }
      // carry-over: the first window is over at 23:00 on its date
      const p3 = planDays({ ...input, now: { date: windows[0].date, min: 23 * 60 }, previous: plan });
      out.plans++;
      check(tag + "+carry", p3, pool, pool.statuses, windows);
      out.carried += p3.carried.length;
      const later = new Set(p3.days.filter((d) => !d.past).flatMap((d) => d.stops.map((s) => s.id)));
      const noted = new Set(p3.notes.flatMap((n) => (n.kind === "carried-unscheduled" ? n.ids : [])));
      for (const id of p3.carried) if (!later.has(id) && !noted.has(id)) out.carriedLost.push(`${tag} ${id}`);
    }
  }
  const s = { ...out, avgWait: +(out.waitMin / Math.max(1, out.waits)).toFixed(1), reshuffle: +(out.otherChanged / out.other).toFixed(3), droppedPerMark: +(out.dropped / out.marks).toFixed(2) };
  const all = out.crossDays;
  s.crossFirst = all.filter((x) => !/\+(mark|fu|carry)/.test(x)).length;
  s.crossMark = all.filter((x) => /\+mark/.test(x)).length;
  s.crossFu = all.filter((x) => /\+fu/.test(x)).length;
  s.crossCarry = all.filter((x) => /\+carry/.test(x)).length;
  s.markDays = out.markDays;
  return s;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const s = sweep2();
  for (const k of ["problems", "waitNoLabel", "waitNotNeeded", "softLegs", "firstLegs", "crossDays", "routeFalse", "noReason", "contactLate", "fuMissing", "frozenChanged", "carriedLost", "contactReachableUnplaced", "fuMissedOpen", "thinDays", "repaired", "lowNoReason", "fullLower"]) (s[k + "N"] = s[k].length), (s[k] = s[k].slice(0, 12));
  console.log(JSON.stringify(s, null, process.argv.includes("--json") ? 1 : 0));
}
