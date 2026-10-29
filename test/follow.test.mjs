// The pure half of the route animation (public/lib/follow.js): door matching, interpolation, timing, speed.
import test from "node:test";
import assert from "node:assert/strict";
import { readJson } from "./helpers.mjs";
import {
  SPEEDS, RUN_SLOW, PAUSE_MS, INTRO_MS, OUTRO_MS, metres, cumulative, matchStops, pointAt, lineTo, ease, legDurations, timeline, stateAt,
  runMs, clampSpeed, milesAt, zoomFor, follow, BUILD, buildPace, buildingMs, createRunSlot, placeCard, crossings, dayShape,
} from "../public/lib/follow.js";

const road = readJson("test/fixtures/road-austin-day1.json");
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ""} ${a} vs ${b} (±${eps})`);

test("metres: a degree of latitude is ~111 km; a point to itself is 0", () => {
  near(metres([-97.7, 30], [-97.7, 31]), 111195, 50);
  assert.equal(metres([-97.7, 30.2], [-97.7, 30.2]), 0);
});

test("cumulative is monotone and ends at the line's length", () => {
  const cum = cumulative(road.coords);
  assert.equal(cum.length, road.coords.length);
  for (let i = 1; i < cum.length; i++) assert.ok(cum[i] >= cum[i - 1]);
  // ORS says 19.2 road miles for this day
  near(cum.at(-1) / 1609.344, road.mi, 0.4, "line length in miles");
});

test("matchStops on the real road: every door is matched in order and the line passes within 60 m of it", () => {
  const idx = matchStops(road.coords, road.stops);
  assert.equal(idx.length, road.stops.length);
  for (let j = 1; j < idx.length; j++) assert.ok(idx[j] > idx[j - 1], `door ${j + 1} after door ${j}`);
  road.stops.forEach((s, j) => assert.ok(metres(road.coords[idx[j]], [s.lon, s.lat]) < 60, `door ${s.n} ${s.name}`));
  // the leg lengths between matched doors agree with ORS's legs
  const cum = cumulative(road.coords);
  idx.forEach((i, j) => near((cum[i] - (j ? cum[idx[j - 1]] : 0)) / 1609.344, road.legs[j].mi, 0.25, `leg ${j + 1}`));
});

test("matchStops on the straight-line estimate: door j is vertex j + 1", () => {
  const coords = [[road.start.lon, road.start.lat], ...road.stops.map((s) => [s.lon, s.lat])];
  assert.deepEqual(matchStops(coords, road.stops), road.stops.map((_, j) => j + 1));
});

test("matchStops: a road that passes a later door first still matches doors in order", () => {
  // start → passes B → A → back through B
  const A = { lon: 0.01, lat: 0 };
  const B = { lon: 0.005, lat: 0 };
  const coords = [[0, 0], [0.005, 0], [0.01, 0], [0.005, 0.0001], [0.004, 0]];
  assert.deepEqual(matchStops(coords, [A, B]), [2, 3]);
});

test("matchStops: a road that passes a door twice arrives at the first pass", () => {
  const A = { lon: 0.01, lat: 0 };
  const coords = [[0, 0], [0.01, 0.00005], [0.02, 0], [0.01, 0], [0.03, 0]];
  assert.deepEqual(matchStops(coords, [A]), [1]);
});

test("matchStops prefers ORS way_points when they fit, ignores them when they don't", () => {
  const coords = [[0, 0], [1, 0], [2, 0], [3, 0]];
  const stops = [{ lon: 1, lat: 0 }, { lon: 3, lat: 0 }];
  assert.deepEqual(matchStops(coords, stops, { wayPoints: [0, 1, 3] }), [1, 3]);
  assert.deepEqual(matchStops(coords, stops, { wayPoints: [0, 9, 3] }), [1, 3], "out of range → nearest");
  assert.deepEqual(matchStops(coords, stops, { wayPoints: [0, 3] }), [1, 3], "wrong length → nearest");
});

test("pointAt interpolates along segments and clamps at the ends", () => {
  const coords = [[0, 0], [0, 0.001], [0, 0.003]];
  const cum = cumulative(coords);
  assert.deepEqual(pointAt(coords, cum, -5).pt, [0, 0]);
  assert.deepEqual(pointAt(coords, cum, 1e9).pt, [0, 0.003]);
  const mid = pointAt(coords, cum, cum[1] / 2);
  assert.equal(mid.i, 0);
  near(mid.pt[1], 0.0005, 1e-9);
  const q = pointAt(coords, cum, cum[1] + (cum[2] - cum[1]) * 0.25);
  assert.equal(q.i, 1);
  near(q.pt[1], 0.0015, 1e-9);
});

test("lineTo: whole vertices then the head; always a drawable line", () => {
  const coords = [[0, 0], [0, 0.001], [0, 0.003]];
  const cum = cumulative(coords);
  assert.deepEqual(lineTo(coords, cum, 0), [[0, 0], [0, 0]]);
  const l = lineTo(coords, cum, cum[1] + 1);
  assert.equal(l.length, 3);
  assert.deepEqual(l.slice(0, 2), coords.slice(0, 2));
  assert.deepEqual(lineTo(coords, cum, cum[2]), coords);
});

test("ease: 0 → 0, 1 → 1, monotone, never stalls mid-leg", () => {
  assert.equal(ease(0), 0);
  assert.equal(ease(1), 1);
  let prev = 0;
  for (let p = 0.01; p <= 1; p += 0.01) { const e = ease(p); assert.ok(e >= prev); prev = e; }
  assert.ok(ease(0.5) - ease(0.49) > 0.005, "still moving at the middle");
});

test("legDurations: total = base + per-leg, longer legs take longer but less than proportionally", () => {
  const ms = legDurations([400, 1600, 6400]);
  near(ms.reduce((a, b) => a + b, 0), (800 + 320 * 3) * RUN_SLOW, 1e-6);
  assert.ok(ms[0] < ms[1] && ms[1] < ms[2]);
  near(ms[2] / ms[0], 4, 1e-9, "16× the distance → 4× the time");
  assert.deepEqual(legDurations([]), []);
});

test("timing budget: the real 9-door day at 1× runs 15–21 s (10–14 s × RUN_SLOW); 3 doors run shorter", () => {
  assert.equal(RUN_SLOW, 1.5, "r2 (Jard 10-24): Run the route at 1× is 50% slower than the base");
  const tl = timeline(road.coords, matchStops(road.coords, road.stops));
  assert.equal(tl.steps.length, 18);
  assert.ok(tl.total >= 10000 * RUN_SLOW && tl.total <= 14000 * RUN_SLOW, `9 doors: ${tl.total} ms`);
  const three = road.stops.slice(0, 3);
  const tl3 = timeline(road.coords.slice(0, matchStops(road.coords, three).at(-1) + 1), matchStops(road.coords, three));
  assert.ok(tl3.total < tl.total && tl3.total >= 4000 * RUN_SLOW, `3 doors: ${tl3.total} ms`);
});

test("speed scaling: wall time divides by speed, and the slider snaps to 0.5 · 1 · 2 · 4", () => {
  const tl = timeline(road.coords, matchStops(road.coords, road.stops));
  near(runMs(tl, 1), INTRO_MS + tl.total + OUTRO_MS, 1e-6);
  near(runMs(tl, 2), runMs(tl, 1) / 2, 1e-6);
  near(runMs(tl, 4), runMs(tl, 1) / 4, 1e-6);
  near(runMs(tl, 0.5), runMs(tl, 1) * 2, 1e-6);
  assert.deepEqual(SPEEDS, [0.5, 1, 2, 4]);
  assert.equal(clampSpeed(3.1), 4);
  assert.equal(clampSpeed(1.3), 1);
  assert.equal(clampSpeed(0.6), 0.5);
  assert.equal(clampSpeed("2"), 2);
  assert.equal(clampSpeed(0), 1);
  assert.equal(clampSpeed(NaN), 1);
});

test("stateAt: drives, pauses at each door for PAUSE_MS, ends at the last door", () => {
  const coords = [[0, 0], [0, 0.01], [0, 0.02]];
  const tl = timeline(coords, [1, 2]);
  const [d0, p0, d1, p1] = tl.steps;
  assert.equal(stateAt(tl, 0).d, 0);
  assert.equal(stateAt(tl, 0).stop, null);
  const mid = stateAt(tl, (d0.t0 + d0.t1) / 2);
  near(mid.d, tl.cum[1] / 2, 1e-6, "halfway through the leg (ease is symmetric)");
  assert.equal(stateAt(tl, p0.t0 + 1).stop, 0);
  assert.equal(stateAt(tl, p0.t0 + 1).d, tl.cum[1]);
  near(p0.t1 - p0.t0, PAUSE_MS, 1e-9);
  assert.equal(stateAt(tl, d1.t0 + 1).leg, 1);
  assert.equal(stateAt(tl, p1.t0 + 1).reached, 2);
  const end = stateAt(tl, tl.total + 1);
  assert.equal(end.done, true);
  assert.equal(end.d, tl.cum[2]);
  // distance never goes backwards
  let prev = -1;
  for (let t = 0; t <= tl.total; t += 25) { const s = stateAt(tl, t); assert.ok(s.d >= prev); prev = s.d; }
});

test("stateAt on an empty day is done at once", () => {
  const tl = timeline([[0, 0]], []);
  assert.equal(tl.total, 0);
  assert.equal(stateAt(tl, 0).done, true);
});

test("milesAt counts up through the legs to the day's miles", () => {
  const tl = timeline(road.coords, matchStops(road.coords, road.stops));
  const legMi = road.legs.map((l) => l.mi);
  assert.equal(milesAt(tl, legMi, 0), 0);
  near(milesAt(tl, legMi, tl.cum.at(-1)), legMi.reduce((a, b) => a + b, 0), 1e-9);
  near(milesAt(tl, legMi, tl.legs[0].to), legMi[0], 1e-9);
  near(milesAt(tl, legMi, (tl.legs[1].from + tl.legs[1].to) / 2), legMi[0] + legMi[1] / 2, 1e-9);
});

test("zoomFor: longer legs zoom out, within 13.2–15.3", () => {
  assert.ok(zoomFor(5) < zoomFor(0.5));
  assert.equal(zoomFor(0.1), 15.3);
  assert.equal(zoomFor(40), 13.2);
});

test("follow: frame-rate independent (two half-steps close the same gap as one step)", () => {
  const one = follow(16, 200);
  const half = follow(8, 200);
  near(1 - (1 - half) ** 2, one, 1e-12);
  assert.equal(follow(0, 200), 0);
});

test("building phase: the real 9-door day fits in 16 s at 1×; ranking gets ~2 s alone; a short day plays at 1×", () => {
  const tl = timeline(road.coords, matchStops(road.coords, road.stops));
  assert.ok(buildingMs(tl) <= 16000 + 1, `${buildingMs(tl)} ms`);
  assert.ok(buildPace(tl) > 1, "a long day plays faster in the phase");
  assert.ok(BUILD.rankIn + BUILD.cull >= 2000, "the ranking moment");
  const short = timeline(road.coords.slice(0, matchStops(road.coords, road.stops)[1] + 1), matchStops(road.coords, road.stops).slice(0, 2));
  assert.equal(buildPace(short), 1, "r2: the phase plays a short day at Watch the route's 1×");
  assert.ok(buildingMs(short) < 16000);
  near(buildingMs(tl, 2), buildingMs(tl) / 2, 1, "speed divides the phase");
});

test("run slot: cancelling the building phase mid-day gives one end state and no door reported twice", () => {
  const slot = createRunSlot();
  const reported = [];
  const ends = [];
  const report = (tok, day, j) => { if (slot.report(tok, `${day}:${j}`)) reported.push([tok.kind, day, j]); };
  const end = (tok, status) => { if (slot.end(tok, status)) ends.push([tok.kind, status]); };
  const b = slot.claim("building");
  report(b, 0, 0);
  report(b, 0, 1);
  report(b, 0, 1); // the same door again in the same run: once
  // the user presses Week, then Run the route (play all) mid-phase
  assert.equal(slot.cancel("user"), true);
  assert.equal(slot.cancel("user"), false, "a second cancel is a no-op");
  const all = slot.claim("all");
  assert.equal(b.ctl.signal.aborted, true);
  assert.equal(b.reason, "user");
  report(b, 0, 2); // the building run's frame after the cancel: dropped
  report(all, 0, 0);
  report(all, 0, 1);
  report(all, 0, 2);
  end(b, "skipped");
  end(b, "done"); // its follow resolving later: already ended
  report(all, 1, 0);
  end(all, "done");
  end(all, "done");
  assert.deepEqual(ends, [["building", "skipped"], ["all", "done"]]);
  assert.deepEqual(reported, [["building", 0, 0], ["building", 0, 1], ["all", 0, 0], ["all", 0, 1], ["all", 0, 2], ["all", 1, 0]]);
  assert.equal(slot.current, null);
  // a claim while a run is live aborts it; an ended run can't report
  const p = slot.claim("play");
  const q = slot.claim("play");
  assert.equal(p.ctl.signal.aborted, true);
  assert.equal(slot.report(p, "0:0"), false);
  assert.equal(slot.report(q, "0:0"), true);
});

test("placeCard: above the pin by default; never on stop 1; stays on the map", () => {
  const card = { w: 268, h: 76 };
  const view = { w: 800, h: 600 };
  assert.equal(placeCard({ x: 400, y: 400 }, [], card, view).anchor, "bottom");
  // stop 1 sits right above the pin: the card goes elsewhere
  const r = placeCard({ x: 400, y: 400 }, [{ x: 400, y: 330, w: 6 }], card, view);
  assert.notEqual(r.anchor, "bottom");
  // near the top edge the card goes below
  assert.equal(placeCard({ x: 400, y: 40 }, [], card, view).anchor, "top");
  // near the right edge, with pins above and below: to the left
  assert.equal(placeCard({ x: 760, y: 300 }, [{ x: 760, y: 240, w: 6 }, { x: 760, y: 350, w: 1 }], card, view).anchor, "right");
  // polish2: a phone-width map with pins all around stop 1: the card covers a pin rather than run off the edge
  const phone = { w: 358, h: 420 };
  const p = placeCard({ x: 150, y: 260 }, [{ x: 140, y: 190, w: 1 }, { x: 150, y: 330, w: 1 }, { x: 230, y: 255, w: 1 }, { x: 120, y: 300, w: 1 }], card, phone);
  assert.ok(["bottom", "top"].includes(p.anchor), p.anchor);
  // judge 3, the hero at 1400: pins above, below and to the right, the left runs off: a free corner beats covering one
  const hero = placeCard({ x: 200, y: 290 }, [{ x: 200, y: 200, w: 1 }, { x: 195, y: 330, w: 1 }, { x: 280, y: 340, w: 1 }, { x: 330, y: 300, w: 1 }], card, { w: 550, h: 470 });
  assert.ok(hero.anchor.includes("-"), hero.anchor);
  // a side that covers nothing still beats a corner
  assert.equal(placeCard({ x: 400, y: 400 }, [{ x: 400, y: 470, w: 1 }], card, view).anchor, "bottom");
});

test("crossings and dayShape: a zigzag crosses, a loop out and back along a sweep doesn't", () => {
  const zig = [[0, 0], [0, 2], [1, 0], [1, 2], [-1, 1]];
  assert.ok(crossings(zig) >= 1);
  assert.equal(crossings([[0, 0], [0.01, 0], [0.02, 0.005], [0.03, 0.01]]), 0);
  const s = dayShape([[-97.72, 30.25], [-97.72, 30.26], [-97.71, 30.26]]);
  assert.equal(s.n, 2);
  assert.equal(s.crossings, 0);
  near(s.longest, 0.69, 0.02, "a 0.01° lat leg");
  assert.equal(s.close, 0);
  // out and back to the same block: the 3rd point sits on the 1st
  assert.equal(dayShape([[-97.72, 30.25], [-97.72, 30.26], [-97.7205, 30.2505]]).close, 1);
});

test("judge pass 2 (8): a follow-up with a time is planned at or after it, says why, and its chip shows the time", async () => {
  const { route, readJson } = await import("./helpers.mjs");
  const { demoProfile } = await import("../public/lib/demo-profile.js");
  const { demoStates, bakedMatrix, planInput } = await import("../public/lib/demo-plan.js");
  const { planOnRoads } = await import("../public/lib/travel.js");
  const { outcomeTags } = await import("../public/lib/outcome.js");
  const austin = route("athletic-brewing-austin");
  const demo = readJson("public/data/demo/demo.json");
  const profile = demoProfile();
  const fm = bakedMatrix(demo.matrix);
  const { states, st } = await demoStates({ routes: [austin], profile, contact: demo.contact, fetchMatrix: fm });
  const p = states[2].plan;
  const tue = p.days[0];
  const id = tue.stops[1].id;
  const o = { result: "interested", followUp: p.days[2].date, followUpTime: "15:00" };
  const s = { ...st, plan: { days: p.days, unscheduled: p.unscheduled, carried: p.carried, notes: p.notes }, outcomes: { ...st.outcomes, [id]: o }, statuses: { ...st.statuses, [id]: "visited" } };
  const { input } = planInput({ routes: [austin], profile, st: s, now: { date: tue.date, min: 900 } });
  const { plan } = await planOnRoads(input, { fetchMatrix: fm, cache: new Map() });
  const stop = plan.days[2].stops.find((x) => x.id === id);
  assert.ok(stop, "the follow-up is on Thursday");
  assert.ok(stop.eta >= 900 && stop.eta <= 930, `planned at ${stop.eta}`);
  if (stop.eta === 900) assert.match(stop.orderReason ?? "", /^follow-up at 3 pm/);
  assert.match(outcomeTags(o).at(-1).text, /^↻ Follow up .+, 3 pm$/);
});
