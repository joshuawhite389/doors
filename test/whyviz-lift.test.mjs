// WHY-VIZ-SPEC §4.3 (lane 2): the plan's crowd groups against the city on the demo bake. Rows and numbers equal
// lib/insights.js crowd() on the plan's doors over every door Doors holds for Austin (the same base picture 2 uses);
// a row within 0.8–1.25× the city is muted; the sentence names only the model's groups and numbers. No network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { demoContext } from "./agent-fixture.mjs";
import { route, readJson } from "./helpers.mjs";
import { cityRooms, crowd, planIds } from "../public/lib/insights.js";
import { liftModel, liftLabel, timesWords, MUTED, STRONG, WEAK, PHONE_KEEP } from "../public/lib/whyviz/lift.js";
import { liftWords, plain } from "../public/lib/whyviz/words.js";

let cache = null;
async function demo() {
  if (cache) return cache;
  const { plan } = await demoContext();
  const austin = route("athletic-brewing-austin");
  const idx = readJson("public/data/index.json");
  const files = idx.brands.map((b) => `${b.key}-austin`).filter((f) => idx.files.includes(f)).map(route);
  const base = cityRooms(files);
  const ids = new Set(base.ids), venues = { ...base.venues };
  for (const r of files) for (const row of r.lists?.famous ?? []) if (r.venues?.[row[0]]) (ids.add(row[0]), (venues[row[0]] = r.venues[row[0]]));
  const baseAll = { ids: [...ids], venues };
  const allV = { ...austin.venues, ...plan.venues };
  const m = liftModel({ planIds: planIds(plan), venues: allV, base: baseAll, cityName: "Austin" });
  return (cache = { plan, allV, baseAll, m });
}

test("lift: the demo bake (golden): 22 plan doors described, dog owners 5 of 22 and craft beer fans 7 of 22 far above the city, families 4 of 22 far below, locals about the city", async () => {
  const { m } = await demo();
  assert.equal(m.n, 22);
  assert.ok(m.baseN >= 400, `base ${m.baseN}`);
  const by = Object.fromEntries(m.rows.map((r) => [r.key, r]));
  assert.equal(by.dogs.n, 5); assert.ok(by.dogs.lift > 4 && by.dogs.lift < 6, `dogs ×${by.dogs.lift}`);
  assert.equal(by.beer.n, 7); assert.ok(by.beer.lift > 5 && by.beer.lift < 6, `beer ×${by.beer.lift}`);
  assert.equal(by.music.n, 4); assert.ok(by.music.lift > 3);
  assert.equal(by.families.n, 4); assert.ok(by.families.lift < WEAK, `families ×${by.families.lift}`);
  assert.ok(by.foodies.lift < 0.3);
  assert.equal(by.locals.n, 15); assert.ok(by.locals.muted, "locals are about the city");
  assert.ok(by.locals.base >= 0.5, "true of most of Austin");
  assert.equal(liftLabel(by.locals), "about the city");
  assert.match(liftLabel(by.beer), /^×5\.\d$/);
  // every row: ≥ 2 doors, sorted by lift, muted exactly inside the band
  for (const r of m.rows) { assert.ok(r.n >= 2); assert.equal(r.muted, r.lift >= MUTED[0] && r.lift <= MUTED[1]); }
  for (let i = 1; i < m.rows.length; i++) assert.ok(m.rows[i - 1].lift >= m.rows[i].lift);
  assert.ok(m.top.every((r) => r.lift >= STRONG) && m.top.includes(by.beer) && m.top.includes(by.dogs));
  assert.ok(m.low.includes(by.families) && m.low.includes(by.foodies));
  assert.ok(m.common.includes(by.locals));
  // the phone keeps the strong and the weak rows only
  assert.ok(m.rows.filter(PHONE_KEEP).every((r) => r.lift >= STRONG || r.lift <= WEAK));
  assert.ok(m.rows.filter(PHONE_KEEP).length < m.rows.length);
});

test("lift: the rows equal crowd() on the same doors over the same base", async () => {
  const { m, plan, allV, baseAll } = await demo();
  const cr = crowd(planIds(plan), allV, { base: baseAll.ids, baseVenues: baseAll.venues, min: 2 });
  assert.equal(m.rows.length, cr.terms.length);
  for (const r of m.rows) {
    const t = cr.terms.find((x) => x.key === r.key);
    assert.equal(r.n, t.ids.length);
    assert.equal(r.share, t.share);
    assert.equal(r.base, t.base);
    assert.ok(Math.abs(r.lift - t.share / t.base) < 1e-12);
  }
  assert.equal(m.baseN, cr.baseN);
});

test("lift: the sentence holds only the model's groups and numbers", async () => {
  const { m } = await demo();
  const parts = liftWords(m), s = plain(parts);
  assert.match(s, /^Craft beer fans, dog owners and live music fans are named at your doors \d to \d times as often as across the \d+ Austin doors Qloo describes\. /);
  assert.match(s, /Families and food enthusiasts, far less\. /);
  assert.match(s, /'Locals and neighbours' is true of most of Austin, so it is not worth saying\.$/);
  const bold = parts.filter((p) => typeof p === "object").map((p) => p.t);
  assert.deepEqual(bold, ["Craft beer fans, dog owners and live music fans", "Families and food enthusiasts"]);
  for (const n of s.match(/\d+/g)) assert.ok([Math.round(m.top[2].lift), Math.round(m.top[0].lift), m.baseN].includes(+n) || (+n >= 3 && +n <= 6), `number ${n}`);
  // words for other shapes
  assert.equal(timesWords([{ lift: 5.2 }, { lift: 7.1 }]), "5 to 7 times as often");
  assert.equal(timesWords([{ lift: 4.0 }]), "4 times as often");
  assert.equal(timesWords([{ lift: 1.6 }, { lift: 2.3 }]), "up to 2.3 times as often");
  assert.equal(timesWords([{ lift: 1.5 }, { lift: 1.7 }]), "1.5 to 1.7 times as often");
  const none = liftModel({ planIds: [], venues: {}, base: { ids: [], venues: {} }, cityName: "Boise" });
  assert.deepEqual(none.rows, []);
  assert.equal(plain(liftWords(none)), "Qloo names no crowd group at two or more of your plan's 0 doors yet.");
});
