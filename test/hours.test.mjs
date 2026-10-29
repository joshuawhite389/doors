// Hours parser, open-for check and formatter: synthetic edge cases plus 150 real Qloo `hours` records.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHours, isOpenFor, openMinutes, formatDayHours, DAYS } from "../public/lib/core.js";
import { route } from "./helpers.mjs";

// 150 real venue `hours` values (Athletic Brewing Austin first, topped up from other routes if ever short).
function realHours(n = 150) {
  const out = [];
  for (const key of ["athletic-brewing-austin", "casamigos-boise", "lacroix-chicago", "white-claw-omaha"]) {
    for (const v of Object.values(route(key).venues)) {
      if (out.length >= n) return out;
      out.push(v.hours);
    }
  }
  return out;
}
const REAL = realHours();
const parsedReal = REAL.map((h) => parseHours(h));
const okCount = parsedReal.filter((p) => p.ok).length;
console.log(`hours: ${REAL.length} real records → ${okCount} ok, ${REAL.length - okCount} unverified`);

test(`150 real hours records: ${okCount} ok, ${REAL.length - okCount} unverified; parseHours never throws`, () => {
  assert.equal(REAL.length, 150);
  for (const h of REAL) assert.doesNotThrow(() => parseHours(h));
  for (const p of parsedReal) for (const d of DAYS) assert.doesNotThrow(() => formatDayHours(p, d));
});

test("real records: ok/unverified classification is consistent", () => {
  for (const p of parsedReal) {
    if (p.ok) {
      const days = Object.entries(p.days);
      assert.ok(days.length > 0, "an ok record has at least one day");
      for (const [day, d] of days) {
        assert.ok(DAYS.includes(day));
        assert.ok(d.closed === true || d.spans.length > 0, `ok day ${day} has spans or is closed`);
        if (d.closed) assert.equal(d.spans.length, 0);
        for (const s of d.spans) {
          assert.ok(Number.isInteger(s.from) && s.from >= 0 && s.from <= 1440);
          assert.ok(s.to > s.from && s.to <= 2880);
        }
      }
    } else {
      // unverified: never claims an open/closed state
      for (const d of DAYS) {
        assert.equal(isOpenFor(p, d, "evening"), null);
        assert.equal(formatDayHours(p, d), null);
      }
    }
  }
});

test("real records: closes at or before the open run past midnight (to > 1440)", () => {
  let seen = 0;
  for (const h of REAL) {
    if (!h || typeof h !== "object") continue;
    const p = parseHours(h);
    if (!p.ok) continue;
    for (const day of DAYS) {
      const e = (h[day] ?? []).find((s) => s && !s.closed && s.opens && s.closes);
      if (!e || (h[day] ?? []).length !== 1) continue;
      if (e.closes <= e.opens) {
        seen++;
        const to = p.days[day].spans[0].to;
        // a T00:00 close is exactly midnight (1440); anything later spills into the next day
        if (e.closes.startsWith("T00:00")) assert.equal(to, 1440, `${day} ${e.opens}→${e.closes}`);
        else assert.ok(to > 1440, `${day} ${e.opens}→${e.closes}`);
      }
    }
  }
  assert.ok(seen > 0, "at least one real past-midnight close among the 150");
});

test("past-midnight close: T16:00 → T02:00 becomes 960 → 1560", () => {
  const p = parseHours({ friday: [{ opens: "T16:00:00", closes: "T02:00:00", closed: false }] });
  assert.equal(p.ok, true);
  assert.deepEqual(p.days.friday, { closed: false, spans: [{ from: 960, to: 1560 }] });
});

test("isOpenFor respects the previous day's spill past midnight", () => {
  // Monday 4 pm → 2 pm Tuesday (spill covers Tuesday lunch); Tuesday itself listed closed.
  const spill = parseHours({ monday: [{ opens: "T16:00:00", closes: "T14:00:00" }], tuesday: [{ opens: null, closes: null, closed: true }] });
  assert.equal(spill.ok, true);
  assert.equal(openMinutes(spill, "tuesday", 660, 840), 180);
  assert.equal(isOpenFor(spill, "tuesday", "lunch"), true);
  assert.equal(isOpenFor(spill, "tuesday", "evening"), false);
  // Same Tuesday without the spill: closed at lunch.
  const noSpill = parseHours({ monday: [{ opens: "T16:00:00", closes: "T23:00:00" }], tuesday: [{ closed: true }] });
  assert.equal(isOpenFor(noSpill, "tuesday", "lunch"), false);
  // Sunday's spill reaches Monday (week wraps).
  const wrap = parseHours({ sunday: [{ opens: "T20:00:00", closes: "T13:00:00" }] });
  assert.equal(isOpenFor(wrap, "monday", "lunch"), true);
});

test("isOpenFor: ≥90 minutes inside the evening daypart", () => {
  const p = parseHours({ tuesday: [{ opens: "T20:30:00", closes: "T23:00:00" }], wednesday: [{ opens: "T21:00:00", closes: "T23:00:00" }] });
  assert.equal(isOpenFor(p, "tuesday", "evening"), true); // 90 min (8:30–10)
  assert.equal(isOpenFor(p, "wednesday", "evening"), false); // 60 min
  assert.equal(isOpenFor(p, "friday", "evening"), null); // no Friday or Thursday entry: unknown
});

test("formatDayHours: '5–11 pm', 'closed', '4 pm–2 am', null for unknown", () => {
  const p = parseHours({
    tuesday: [{ opens: "T17:00:00", closes: "T23:00:00" }],
    monday: [{ opens: null, closes: null, closed: true }],
    friday: [{ opens: "T16:00:00", closes: "T02:00:00" }],
    saturday: [{ opens: "T11:00:00", closes: "T14:00:00" }, { opens: "T17:00:00", closes: "T22:00:00" }],
  });
  assert.equal(formatDayHours(p, "tuesday"), "5–11 pm");
  assert.equal(formatDayHours(p, "monday"), "closed");
  assert.equal(formatDayHours(p, "friday"), "4 pm–2 am");
  assert.equal(formatDayHours(p, "saturday"), "11 am–2 pm, 5–10 pm");
  assert.equal(formatDayHours(p, "sunday"), null);
});

test(
  "formatDayHours: 11 am → 2 am reads '11 am–2 am'",
  () => {
    const p = parseHours({ saturday: [{ opens: "T11:00:00", closes: "T02:00:00" }] });
    assert.equal(formatDayHours(p, "saturday"), "11 am–2 am");
  },
);

test("unparseable inputs are unverified (ok=false)", () => {
  for (const bad of [null, undefined, "Mon-Fri 11-10", 42, [], {}, { tuesday: [{ opens: null, closed: false }] }, { tuesday: [{ opens: "T11:00:00", closes: "late" }] }]) {
    const p = parseHours(bad);
    assert.equal(p.ok, false, JSON.stringify(bad));
    assert.equal(isOpenFor(p, "tuesday", "evening"), null);
  }
  // One bad day spoils the record even if other days parse.
  assert.equal(parseHours({ monday: [{ opens: "T11:00:00", closes: "T22:00:00" }], tuesday: [{ opens: null, closed: false }] }).ok, false);
});
