// Call ledger: written to a temp file under the repo's .out/ (never /tmp, never data/ledger.jsonl).
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { makeLedger, ledgerEntry, readLedger, ledgerCount, paramsHash, LEDGER_BUDGET, LEDGER_WARN } from "../src/ledger.js";
import { ROOT } from "./helpers.mjs";

const DIR = join(ROOT, ".out", `test-ledger-${process.pid}`);
mkdirSync(DIR, { recursive: true });
after(() => rmSync(DIR, { recursive: true, force: true }));
let n = 0;
const tmp = () => join(DIR, `ledger-${++n}.jsonl`);
const MONTH = new Date().toISOString().slice(0, 7);
const KEY = "qloo-secret-KEY-1234567890";

// owner review 6 (Oct 21): 1,500 → 3,000; the ruling (Oct 21): 15,000, 35,000 of Qloo's 50,000 kept unspent (warn at 80%)
test("budget constants: 15,000, warn at 12,000", () => {
  assert.equal(LEDGER_BUDGET, 34000); // round 3 (Jard 10-25): per-door enrichment
  assert.equal(LEDGER_WARN, 26000);
});

test("paramsHash is stable, order-sensitive by value, 12 hex chars", () => {
  const h = paramsHash({ a: 1, b: "x" });
  assert.match(h, /^[0-9a-f]{12}$/);
  assert.equal(paramsHash({ a: 1, b: "x" }), h);
  assert.notEqual(paramsHash({ a: 2, b: "x" }), h);
  assert.equal(paramsHash(undefined), paramsHash({}));
});

test("ledgerEntry: fields, hash of params only, never the api key", () => {
  const now = new Date("2026-10-08T12:00:00Z");
  const params = { "filter.type": "urn:entity:place", "signal.interests.entities": "ID" };
  const e = ledgerEntry({ method: "GET", path: "/v2/insights", params, status: 200, remaining: 9000, ms: 120, apiKey: KEY, headers: { "X-Api-Key": KEY } }, { source: "test", now });
  assert.deepEqual(Object.keys(e).sort(), ["hash", "method", "ms", "path", "remaining", "source", "status", "ts"]);
  assert.equal(e.ts, "2026-10-08T12:00:00.000Z");
  assert.equal(e.hash, paramsHash(params));
  assert.ok(!JSON.stringify(e).includes(KEY));
  assert.equal(ledgerEntry({ path: "/x" }).remaining, null);
});

test("readLedger/ledgerCount: missing file is empty; month filtering", () => {
  assert.deepEqual(readLedger(join(DIR, "nope.jsonl")), []);
  const f = tmp();
  const lines = [
    { ts: "2026-09-30T23:59:59.000Z" },
    { ts: "2026-10-01T00:00:00.000Z" },
    { ts: "2026-10-15T10:00:00.000Z" },
    { ts: "2025-10-15T10:00:00.000Z" },
  ];
  writeFileSync(f, lines.map((l) => JSON.stringify(l)).join("\n") + "\n\n");
  const entries = readLedger(f);
  assert.equal(entries.length, 4);
  assert.equal(ledgerCount(entries, "2026-10"), 2);
  assert.equal(ledgerCount(entries, "2026-09"), 1);
  assert.equal(ledgerCount(entries), 4);
});

test("makeLedger counts only this month's prior lines, records, and never writes the key", () => {
  const f = tmp();
  writeFileSync(f, [JSON.stringify({ ts: "2020-01-01T00:00:00.000Z" }), JSON.stringify({ ts: `${MONTH}-01T00:00:00.000Z` })].join("\n") + "\n");
  const led = makeLedger(f, { source: "test" });
  assert.equal(led.count, 1, "old month ignored");
  for (let i = 0; i < 3; i++) led.record({ method: "GET", path: "/v2/insights", params: { take: i }, status: 200, remaining: 100 - i, ms: 5, apiKey: KEY });
  assert.equal(led.count, 4);
  assert.equal(led.remainingBudget(), LEDGER_BUDGET - 4);
  const entries = readLedger(f);
  assert.equal(entries.length, 5);
  assert.equal(ledgerCount(entries, MONTH), 4);
  assert.equal(entries[4].source, "test");
  assert.equal(entries[4].hash, paramsHash({ take: 2 }));
  assert.ok(!readFileSync(f, "utf8").includes(KEY));
  // a fresh ledger on the same file picks up the count
  assert.equal(makeLedger(f).count, 4);
});

test("makeLedger creates the directory", () => {
  const f = join(DIR, "nested", "deeper", "l.jsonl");
  const led = makeLedger(f);
  led.record({ path: "/search", params: {}, status: 200 });
  assert.ok(existsSync(f));
});

test("assertBudget refuses the request that would exceed the budget", () => {
  const led = makeLedger(tmp(), { budget: 3, warn: 99 });
  led.assertBudget(3);
  assert.throws(() => led.assertBudget(4), /budget is 3/);
  for (let i = 0; i < 3; i++) {
    led.assertBudget();
    led.record({ path: "/v2/insights", params: { i }, status: 200 });
  }
  assert.equal(led.remainingBudget(), 0);
  assert.throws(() => led.assertBudget(), /3 calls used this month; budget is 3\. Refusing more Qloo calls\./);
});

test("onWarn fires exactly once, at the threshold", () => {
  const seen = [];
  const led = makeLedger(tmp(), { budget: 10, warn: 3, onWarn: (c) => seen.push(c) });
  for (let i = 0; i < 6; i++) led.record({ path: "/v2/insights", params: { i }, status: i % 2 ? 429 : 200 });
  assert.deepEqual(seen, [3]);
});

test("onWarn does not fire when the ledger already started past the threshold", () => {
  const f = tmp();
  writeFileSync(f, Array.from({ length: 4 }, () => JSON.stringify({ ts: `${MONTH}-02T00:00:00.000Z` })).join("\n") + "\n");
  const seen = [];
  const led = makeLedger(f, { warn: 3, onWarn: (c) => seen.push(c) });
  led.record({ path: "/x", params: {}, status: 200 });
  assert.deepEqual(seen, []);
});
