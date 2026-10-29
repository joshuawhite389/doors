// The pure half of the route animation (SPEC-V2 §5.1): where the head of the line is at time t, where each door sits on
// the road geometry, how long a day takes. No DOM, no map: public/ui/animate.js drives MapLibre with these.
// Times are milliseconds at 1×; the player runs its own clock at `speed`, so a speed change mid-run just works.

export const SPEEDS = [0.5, 1, 2, 4];
export const RUN_SLOW = 1.5; // owner review 2: Run the route at 1× plays 20% slower; r2 (Jard 10-24: "1x speed should be a bit slower"): 50%
export const PAUSE_MS = 1000 * RUN_SLOW; // at each door; with the ease into it the line reads as stopped for ~1.4 s
export const DRIVE_BASE_MS = 800 * RUN_SLOW; // the whole day's driving = base + per leg, split across legs by √length
export const DRIVE_LEG_MS = 320 * RUN_SLOW;
export const INTRO_MS = 1100 * RUN_SLOW; // the camera settles on the start before the line moves
export const OUTRO_MS = 1400 * RUN_SLOW; // pull back to the whole day

const R = 6371008.8;
const rad = Math.PI / 180;
// metres between two [lon, lat] points (haversine)
export function metres(a, b) {
  const dLat = (b[1] - a[1]) * rad;
  const dLon = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

// cum[i] = metres along the line to coords[i]
export function cumulative(coords) {
  const cum = new Array(coords.length).fill(0);
  for (let i = 1; i < coords.length; i++) cum[i] = cum[i - 1] + metres(coords[i - 1], coords[i]);
  return cum;
}

// The geometry index of each door, in order (never going backwards). ORS's way_points are exact when we have them
// ([start, ...stops] → wayPoints.length = stops + 1); otherwise each door takes the FIRST point of the remaining line
// that comes within `slack` metres of the closest approach, so a road that passes a door twice arrives at the first pass.
export function matchStops(coords, stops, { wayPoints = null, slack = 25 } = {}) {
  if (Array.isArray(wayPoints) && wayPoints.length === stops.length + 1 && wayPoints.every((w, i) => Number.isInteger(w) && w >= 0 && w < coords.length && (!i || w >= wayPoints[i - 1])))
    return wayPoints.slice(1);
  const out = [];
  let from = 0;
  for (const s of stops) {
    const p = [s.lon, s.lat];
    let best = Infinity;
    const d = [];
    for (let i = from; i < coords.length; i++) {
      d[i] = metres(coords[i], p);
      if (d[i] < best) best = d[i];
    }
    let k = coords.length - 1;
    for (let i = from; i < coords.length; i++) if (d[i] <= best + slack) { k = i; break; }
    out.push(k);
    from = k;
  }
  return out;
}

// The point at distance d along the line (binary search on cum). Returns {pt, i}: i = the last whole vertex before it.
export function pointAt(coords, cum, d) {
  const n = coords.length;
  if (n === 1 || d <= 0) return { pt: coords[0].slice(), i: 0 };
  if (d >= cum[n - 1]) return { pt: coords[n - 1].slice(), i: n - 1 };
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= d) lo = mid; else hi = mid;
  }
  const span = cum[hi] - cum[lo];
  const f = span > 0 ? (d - cum[lo]) / span : 0;
  const a = coords[lo];
  const b = coords[hi];
  return { pt: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], i: lo };
}

// The line up to distance d: whole vertices, then the interpolated head.
export function lineTo(coords, cum, d) {
  const { pt, i } = pointAt(coords, cum, d);
  const out = coords.slice(0, i + 1);
  if (out.length === 1 || pt[0] !== out.at(-1)[0] || pt[1] !== out.at(-1)[1]) out.push(pt);
  return out.length === 1 ? [out[0], out[0]] : out;
}

// Ease into and out of each door, but keep moving: 60% ease-in-out, 40% linear.
export function ease(p) {
  const q = Math.min(1, Math.max(0, p));
  const io = q < 0.5 ? 2 * q * q : 1 - (-2 * q + 2) ** 2 / 2;
  return 0.6 * io + 0.4 * q;
}

// How long each leg drives at 1×: the day's drive budget split by √(leg length), so long legs take longer but a
// 5-mile hop doesn't take ten times a half-mile one.
export function legDurations(legMetres, { base = DRIVE_BASE_MS, perLeg = DRIVE_LEG_MS } = {}) {
  const n = legMetres.length;
  if (!n) return [];
  const total = base + perLeg * n;
  const w = legMetres.map((m) => Math.sqrt(Math.max(m, 1)));
  const sum = w.reduce((a, b) => a + b, 0);
  return w.map((x) => (total * x) / sum);
}

// A day's timeline at 1×: drive leg 0 → pause at door 0 → drive leg 1 → … → pause at the last door.
// coords = the road line from the start; idx = matchStops(...). Returns {cum, legs:[{from, to, ms}], steps, total}.
export function timeline(coords, idx, { pause = PAUSE_MS, base, perLeg } = {}) {
  const cum = cumulative(coords);
  const ends = idx.map((i) => cum[i]);
  const legs = ends.map((to, j) => ({ from: j ? ends[j - 1] : 0, to }));
  const ms = legDurations(legs.map((l) => l.to - l.from), { base, perLeg });
  const steps = [];
  let t = 0;
  legs.forEach((l, j) => {
    l.ms = ms[j];
    steps.push({ kind: "drive", leg: j, t0: t, t1: (t += ms[j]), from: l.from, to: l.to });
    steps.push({ kind: "pause", stop: j, t0: t, t1: (t += pause), at: l.to });
  });
  return { cum, legs, steps, total: t };
}

// Where the animation is at time t (ms at 1×): distance along the line, the leg and how far into it, and the door
// it is paused at (or null). Past the end: the end, paused at the last door, done.
export function stateAt(tl, t) {
  const { steps } = tl;
  if (!steps.length) return { d: 0, leg: -1, legP: 0, stop: null, reached: 0, done: true };
  if (t >= tl.total) {
    const last = steps.at(-1);
    return { d: last.at, leg: steps.length / 2 - 1, legP: 1, stop: last.stop, reached: steps.length / 2, done: true };
  }
  let lo = 0;
  let hi = steps.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (steps[mid].t1 <= t) lo = mid + 1; else hi = mid;
  }
  const s = steps[lo];
  if (s.kind === "pause") return { d: s.at, leg: s.stop, legP: 1, stop: s.stop, reached: s.stop + 1, done: false };
  const p = ease((Math.max(t, s.t0) - s.t0) / (s.t1 - s.t0));
  return { d: s.from + (s.to - s.from) * p, leg: s.leg, legP: p, stop: null, reached: s.leg, done: false };
}

// The wall-clock length of a whole run at a speed: intro + timeline + outro, each divided by speed.
export const runMs = (tl, speed = 1) => (INTRO_MS + tl.total + OUTRO_MS) / clampSpeed(speed);

// Snap any number to the nearest offered speed (the slider's stops).
export function clampSpeed(x) {
  const v = Number(x);
  if (!Number.isFinite(v) || v <= 0) return 1;
  return SPEEDS.reduce((best, s) => (Math.abs(Math.log(s / v)) < Math.abs(Math.log(best / v)) ? s : best), SPEEDS[0]);
}

// Miles shown by the counter at distance d: the day's legs (road or estimated miles), interpolated within a leg.
export function milesAt(tl, legMiles, d) {
  let mi = 0;
  for (let j = 0; j < tl.legs.length; j++) {
    const l = tl.legs[j];
    const m = legMiles[j] ?? 0;
    if (d >= l.to) { mi += m; continue; }
    const span = l.to - l.from;
    if (d > l.from && span > 0) mi += (m * (d - l.from)) / span;
    break;
  }
  return mi;
}

// The camera's zoom for a leg: zoom out for long hops, in for a short walk (miles → zoom).
export const zoomFor = (mi) => Math.min(15.3, Math.max(13.2, 15.1 - 0.75 * Math.log2(Math.max(mi, 0.25))));

// Frame-rate independent lerp factor: the share of the gap to close in dt ms with time constant tau.
export const follow = (dt, tau) => 1 - Math.exp(-Math.max(0, dt) / tau);

// ---------- the building phase (§3.3) ----------
// Its beats at 1×: the ranked rooms appear as dots, then the ones that didn't make the plan fade (the Qloo moment, on
// its own), the day tabs, then the follow-cam on day 1 with a short intro and outro. The whole phase is capped: a day
// whose follow would run past the cap plays faster (`pace`), never longer.
// r2 (Jard 10-24, watching the demo's build: "slow this animation down"): cap 11.5 → 15.5 s, and the follow plays at
// Watch the route's 1× (it used to undo RUN_SLOW)
export const BUILD = { rankIn: 1100, cull: 1300, plan: 600, intro: 700, outro: 1000, cap: 15500 }; // cap: headroom under 16 s
const BUILD_FIXED = BUILD.rankIn + BUILD.cull + BUILD.plan + BUILD.intro + BUILD.outro;

// The follow's speed-up for the building phase (≥ 1: never slower than Watch the route at 1×): the day's timeline
// squeezed into what the cap leaves.
export const buildPace = (tl, cap = BUILD.cap) => Math.max(1, tl.total / Math.max(1, cap - BUILD_FIXED));
// The phase's wall-clock length at a player speed.
export const buildingMs = (tl, speed = 1) => (BUILD_FIXED + tl.total / buildPace(tl)) / clampSpeed(speed);

// ---------- one run at a time ----------
// The building phase, Run the route and Play all share a map, so only one may run. claim(kind) aborts the run in
// progress and returns the new run's token ({kind, ctl, …}). report(tok, key) is true once per key, and only for
// the current, live token: a cancelled run can never report a door, so no door is reported twice. end(tok, status) is
// true the first time only, so a run that is both cancelled and finishing ends once.
export function createRunSlot() {
  let cur = null;
  return {
    get current() { return cur; },
    claim(kind) {
      cur?.ctl.abort();
      cur = { kind, ctl: new AbortController(), seen: new Set(), ended: null, reason: null };
      return cur;
    },
    // abort the current run (reason: "skip" | "user" | "stop" …); false when nothing is running
    cancel(reason = "stop") {
      if (!cur || cur.ctl.signal.aborted) return false;
      cur.reason = reason;
      cur.ctl.abort();
      return true;
    },
    report(tok, key) {
      if (tok !== cur || tok.ctl.signal.aborted || tok.seen.has(key)) return false;
      tok.seen.add(key);
      return true;
    },
    end(tok, status) {
      if (!tok || tok.ended) return false;
      tok.ended = status;
      if (cur === tok) cur = null;
      return true;
    },
  };
}

// ---------- where the door card goes ----------
// The card sits above its pin unless that covers another pin (stop 1 counts most), then below, right or left.
// pin: {x, y} on screen; others: [{x, y, w}] (w = weight); card: {w, h}; view: {w, h}. Returns {anchor, offset}:
// MapLibre marker anchor ("bottom" = the card above the pin) and the pixel offset from the pin.
export function placeCard(pin, others, card, view, { gap = 20, pad = 16 } = {}) {
  const opts = [
    { anchor: "bottom", offset: [0, -gap], x: pin.x - card.w / 2, y: pin.y - gap - card.h },
    { anchor: "top", offset: [0, gap], x: pin.x - card.w / 2, y: pin.y + gap },
    { anchor: "left", offset: [gap, 0], x: pin.x + gap, y: pin.y - card.h / 2 },
    { anchor: "right", offset: [-gap, 0], x: pin.x - gap - card.w, y: pin.y - card.h / 2 },
    // the corners (no arrow): only when every side covers a pin (judge 3: the hero's Nomadic card hid stop 6)
    { anchor: "bottom-left", offset: [gap, -gap], x: pin.x + gap, y: pin.y - gap - card.h },
    { anchor: "bottom-right", offset: [-gap, -gap], x: pin.x - gap - card.w, y: pin.y - gap - card.h },
    { anchor: "top-left", offset: [gap, gap], x: pin.x + gap, y: pin.y + gap },
    { anchor: "top-right", offset: [-gap, gap], x: pin.x - gap - card.w, y: pin.y + gap },
  ];
  let best = null;
  opts.forEach((o, k) => {
    let s = k * 0.01 + (k >= 4 ? 0.5 : 0); // ties keep the order above; a corner loses to a side that covers nothing
    for (const p of others) if (p.x > o.x - pad && p.x < o.x + card.w + pad && p.y > o.y - pad && p.y < o.y + card.h + pad) s += p.w ?? 1;
    const out = Math.max(0, -o.x) + Math.max(0, o.x + card.w - view.w) + Math.max(0, -o.y) + Math.max(0, o.y + card.h - view.h);
    // off the map is worse than covering pins: a clipped card can't be read (polish2: on a 390 px phone the hero's
    // still card went left of stop 1 and lost its first words); among cards that all run off, the least clipped wins
    if (out > 0) s += 20 + (out / Math.max(1, card.w)) * 3;
    if (!best || s < best.s) best = { s, anchor: o.anchor, offset: o.offset };
  });
  return { anchor: best.anchor, offset: best.offset };
}

// ---------- the shape of a day ----------
// How many legs of a polyline ([[lon, lat], …], start first) cross another, non-adjacent leg.
export function crossings(coords) {
  const side = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const cross = (p1, p2, p3, p4) => side(p3, p4, p1) * side(p3, p4, p2) < 0 && side(p1, p2, p3) * side(p1, p2, p4) < 0;
  let n = 0;
  for (let i = 0; i < coords.length - 1; i++) for (let j = i + 2; j < coords.length - 1; j++) if (cross(coords[i], coords[i + 1], coords[j], coords[j + 1])) n++;
  return n;
}

// {n, crossings, longest, total, close} (miles straight-line): is this day one a person would drive? close = pairs of
// points that aren't next to each other in the day but sit within `near` metres (the route doubles back on a pin).
export function dayShape(coords, { near = 150 } = {}) {
  const legs = coords.slice(1).map((c, i) => metres(coords[i], c) / 1609.344);
  let close = 0;
  for (let i = 0; i < coords.length; i++) for (let j = i + 2; j < coords.length; j++) if (metres(coords[i], coords[j]) < near) close++;
  return { n: legs.length, crossings: crossings(coords), longest: legs.length ? Math.max(...legs) : 0, total: legs.reduce((a, b) => a + b, 0), close };
}
