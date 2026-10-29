// (Jard 10-23): Skip for now keeps the day's doors (the Austin fixture: Qloo-derived, so private
// only: scripts/test.mjs NEEDS_DATA), and the Worker routes drive mode's voice.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHours } from "../public/lib/core.js";
import { planDays, estimateTravel } from "../public/lib/schedule.js";
import { skipToEnd, moveIntoDay } from "../public/lib/drive-day.js";
import { _resetVoice } from "../src/voice.js";
import worker from "../src/worker.js";
import { readJson } from "./helpers.mjs";

// ---------- Skip for now ----------
const AUS = readJson("test/fixtures/athletic-brewing-austin.json");
const H = (h, m = 0) => h * 60 + m;
const START = { lat: 30.2556, lon: -97.7208 };
const WED = { date: "2026-10-14", day: "wednesday", from: H(11), to: H(18), start: START };
const THU = { date: "2026-10-15", day: "thursday", from: H(11), to: H(15), start: START };
const pool = AUS.pool.slice(0, AUS.ranked).map((r) => ({ ...r, parsedHours: parseHours(r.hours) }));
const now = { date: WED.date, min: H(11, 52) }; // the day under way, nothing logged yet (Jard's screen: 0 of 8 done)
const base = (o) => ({ pool, statuses: {}, windows: [WED, THU], visitMin: 25, travel: estimateTravel, pinned: [], now, ...o });
const day0 = () => {
  const first = planDays(base({}));
  const p1 = planDays(base({ previous: first }));
  return { p1, d: p1.days[0], frozen: { date: WED.date, from: p1.days[0].from, ids: p1.days[0].stops.map((s) => s.id) } };
};

test("Skip for now: the door goes last on the day being worked and no other door comes off (the old place lock dropped half)", () => {
  const { p1, d, frozen } = day0();
  const ids = d.stops.map((s) => s.id);
  const id = ids[0];
  assert.ok(ids.length >= 8, "a full day");
  // the old Skip: a place lock at the end re-planned the frozen day around it and took free doors off
  const old = planDays(base({ previous: p1, frozen, locks: [{ id, date: WED.date, index: ids.length }] }));
  assert.ok(old.days[0].stops.length < ids.length, "the regression this replaces: the lock dropped doors");
  // the new one: the saved day's order with the door last; the planner keeps a frozen day as the rep has it
  const saved = skipToEnd(p1, d, id);
  const order = saved.days[0].stops.map((s) => s.id);
  assert.deepEqual(order, [...ids.slice(1), id]);
  const next = planDays(base({ previous: saved, frozen: { ...frozen, ids: order } }));
  assert.deepEqual(next.days[0].stops.map((s) => s.id), order, "every door kept, in the new order");
  assert.equal(next.days[0].stops[0].id, ids[1], "the next door is now first");
  // re-timed from the new first door: the skipped one arrives last
  const etas = next.days[0].stops.map((s) => s.eta);
  assert.ok(etas.every((t, i) => i === 0 || t > etas[i - 1]));
});

test("skipToEnd: null when the day or the door isn't in the saved plan; the input is not changed", () => {
  const { p1, d } = day0();
  const before = JSON.stringify(p1.days[0].stops.map((s) => s.id));
  assert.equal(skipToEnd(p1, { date: "2030-01-01" }, d.stops[0].id), null);
  assert.equal(skipToEnd(p1, d, "nope"), null);
  assert.equal(skipToEnd(null, d, d.stops[0].id), null);
  skipToEnd(p1, d, d.stops[0].id);
  assert.equal(JSON.stringify(p1.days[0].stops.map((s) => s.id)), before);
});

test("Move to the day under way (mobile2 10-23): the door joins today, no door of today comes off or moves (a lock dropped 6 of 7)", () => {
  const { p1, d, frozen } = day0();
  const ids = d.stops.map((s) => s.id);
  const thu = p1.days[1];
  const id = thu.stops[0].id;
  // the old move: a day lock on the frozen day re-planned it from the clock
  const old = planDays(base({ previous: p1, frozen, locks: [{ id, date: WED.date, index: null }] }));
  const lost = ids.filter((x) => !old.days[0].stops.some((s) => s.id === x));
  // the new one: the saved day with the door added at the end, no lock
  const saved = moveIntoDay(p1, thu, d, id, null);
  const order = saved.days[0].stops.map((s) => s.id);
  assert.deepEqual(order, [...ids, id]);
  assert.ok(!saved.days[1].stops.some((s) => s.id === id), "off Thursday");
  const next = planDays(base({ previous: saved, frozen: { ...frozen, ids: order } }));
  const kept = next.days[0].stops.map((s) => s.id);
  assert.deepEqual(kept.filter((x) => ids.includes(x)), ids, `every door of today kept, in order (the lock lost ${lost.length})`);
  assert.ok(kept.includes(id) || next.unscheduled.includes(id) || next.days.some((x) => x.stops.some((s) => s.id === id)), "the moved door never vanishes");
  // within the day: Move up keeps every door
  const up = moveIntoDay(p1, d, d, ids[3], 2);
  assert.deepEqual(up.days[0].stops.map((s) => s.id), [ids[0], ids[1], ids[3], ids[2], ...ids.slice(4)]);
  assert.equal(moveIntoDay(p1, d, { date: "2030-01-01" }, id), null);
});

// ---------- the Worker's routing ----------
test("the Worker routes /api/voice/listen and /api/voice/say to src/voice.js", async () => {
  _resetVoice();
  const AI = { run: async (model) => (/whisper/.test(model) ? { text: "ok" } : { audio: btoa("mp3") }) };
  const head = { origin: "http://localhost:8792" };
  const wav = new Uint8Array(44 + 32000);
  wav.set([..."RIFF"].map((c) => c.charCodeAt(0)), 0);
  wav.set([..."WAVE"].map((c) => c.charCodeAt(0)), 8);
  new DataView(wav.buffer).setUint32(28, 32000, true);
  let r = await worker.fetch(new Request("http://localhost:8792/api/voice/listen", { method: "POST", headers: { ...head, "content-type": "audio/wav" }, body: wav }), { AI }, {});
  assert.deepEqual(await r.json(), { text: "ok" });
  r = await worker.fetch(new Request("http://localhost:8792/api/voice/say", { method: "POST", headers: { ...head, "content-type": "application/json" }, body: JSON.stringify({ text: "hello" }) }), { AI }, {});
  assert.equal(r.headers.get("content-type"), "audio/mpeg");
});
