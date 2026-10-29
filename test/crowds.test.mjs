// Crowds (why2, Jard 10-24 #3): each door's crowd, the crowds told apart for the screen, and "Start with <crowd>":
// the first open day planned with that crowd's doors, held there while the planner routes the rest.
import { test } from "node:test";
import assert from "node:assert/strict";
import { crowds, crowdOf, crowdKey, leadHold } from "../public/lib/crowds.js";
import { buildPool, windowsFor } from "../public/lib/pool.js";
import { planDays } from "../public/lib/schedule.js";
import { route } from "./helpers.mjs";

const ab = route("athletic-brewing-boise");
const cm = route("casamigos-boise");
const dj = route("don-julio-boise");
const profile = {
  drinks: [{ key: "athletic-brewing", name: "Athletic Brewing", ready: true }, { key: "casamigos", name: "Casamigos", ready: true }],
  rooms: ["bars", "breweries", "restaurants"],
  start: { label: "Downtown Boise", lat: 43.615, lon: -116.2023 },
  windows: [{ date: "2026-10-29", from: "13:00", to: "18:00" }, { date: "2026-10-30", from: "13:00", to: "18:00" }, { date: "2026-10-31", from: "13:00", to: "18:00" }],
  visitMin: 25,
  known: [],
};
const pool = buildPool({ routes: [ab, cm], profile, cityName: "Boise" });
const windows = windowsFor(profile);

test("crowdOf: each door goes to the drink that ranks it best; the earlier drink on a tie", () => {
  const of = crowdOf([ab, cm]);
  for (const [id, k] of of) {
    const ia = ab.lists.all.findIndex((r) => r[0] === id), ic = cm.lists.all.findIndex((r) => r[0] === id);
    if (ia >= 0 && ic >= 0) assert.equal(k, ia <= ic ? 0 : 1);
    else assert.equal(k, ia >= 0 ? 0 : 1);
  }
  assert.equal(crowdKey(cm), "casamigos");
});

test("crowds: Athletic Brewing and Casamigos in Boise are two crowds; one drink or two alike are not told apart", () => {
  const c = crowds({ routes: [ab, cm], pool });
  assert.ok(c.distinct && c.shared <= 15);
  assert.deepEqual(c.crowds.map((x) => x.key), ["athletic-brewing", "casamigos"]);
  assert.equal(c.crowds[0].ids.length + c.crowds[1].ids.length, pool.ids.length);
  // Athletic Brewing's doors have no one room type most of them are: both crowds go by the drink's name
  assert.deepEqual(c.crowds.map((x) => x.room), [null, null]);
  // bars vs restaurants: each crowd its own room word (Bud Light and Heineken in Boise)
  const venues = { b1: { genre: "urn:tag:genre:place:bar" }, b2: { genre: "urn:tag:genre:place:bar" }, r1: { genre: "urn:tag:genre:place:restaurant" }, r2: { genre: "urn:tag:genre:place:restaurant" } };
  const mk = (key, ids) => ({ drinker: { key, name: key }, lists: { all: ids.map((id) => [id, 1]) } });
  const two = crowds({ routes: [mk("bud", ["b1", "b2"]), mk("hein", ["r1", "r2"])], pool: { ids: ["b1", "b2", "r1", "r2"], venues } });
  assert.deepEqual(two.crowds.map((x) => x.roomWord), ["bars", "restaurants"]);
  assert.ok(two.distinct && two.shared === 0);
  assert.equal(crowds({ routes: [ab], pool }), null);
  // two tequilas share most of their top 50: one crowd in all but name
  const t = crowds({ routes: [cm, dj], pool: buildPool({ routes: [cm, dj], profile, cityName: "Boise" }) });
  assert.ok(!t.distinct && t.shared > 15);
});

test("leadHold: the first open day gets the lead crowd's doors, and the planner keeps them there", () => {
  const of = crowdOf([ab, cm]);
  for (const lead of ["casamigos", "athletic-brewing"]) {
    const k = lead === "casamigos" ? 1 : 0;
    const hold = leadHold({ routes: [ab, cm], pool, lead, windows, visitMin: 25, statuses: pool.statuses });
    assert.ok(hold.length >= 3, `${lead}: a day's worth`);
    assert.ok(hold.every((h) => h.date === "2026-10-29" && h.index === null && of.get(h.id) === k));
    const p = planDays({ pool: pool.rows, statuses: pool.statuses, windows, visitMin: 25, locks: hold });
    const day0 = p.days[0].stops.map((s) => s.id);
    for (const h of hold) assert.ok(day0.includes(h.id), `${lead}: ${h.id} stays on day 1`);
    const plain = planDays({ pool: pool.rows, statuses: pool.statuses, windows, visitMin: 25 }).days[0].stops;
    const share = (ids) => ids.filter((id) => of.get(id) === k).length / ids.length;
    assert.ok(share(day0) >= share(plain.map((s) => s.id)), `${lead}: day 1 leans to the lead crowd`);
    assert.ok(share(day0) >= 0.5);
  }
});

test("leadHold: nothing without a lead, an unknown lead, or no open day; past and under-way days are skipped; locks and marks kept", () => {
  assert.deepEqual(leadHold({ routes: [ab, cm], pool, lead: null, windows }), []);
  assert.deepEqual(leadHold({ routes: [ab, cm], pool, lead: "nope", windows }), []);
  assert.deepEqual(leadHold({ routes: [ab, cm], pool, lead: "casamigos", windows, now: { date: "2026-11-01", min: 600 } }), []);
  const late = leadHold({ routes: [ab, cm], pool, lead: "casamigos", windows, now: { date: "2026-10-29", min: 900 } });
  assert.ok(late.length && late.every((h) => h.date === "2026-10-30"));
  const fz = leadHold({ routes: [ab, cm], pool, lead: "casamigos", windows, frozen: { date: "2026-10-29", ids: [] } });
  assert.ok(fz.every((h) => h.date === "2026-10-30"));
  const first = leadHold({ routes: [ab, cm], pool, lead: "casamigos", windows })[0].id;
  assert.ok(!leadHold({ routes: [ab, cm], pool, lead: "casamigos", windows, locks: [{ id: first, date: "2026-10-31", index: 0 }] }).some((h) => h.id === first));
  assert.ok(!leadHold({ routes: [ab, cm], pool, lead: "casamigos", windows, statuses: { [first]: "notfit" } }).some((h) => h.id === first));
});
