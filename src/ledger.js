// Call ledger: one JSON line per Qloo HTTP request (timestamp, method, path, params hash, status, month remaining).
// The build's monthly budget is 34,000 calls (1,500 to Oct 21, then 3,000; 15,000 from the ruling of Oct 21; 30,000 from
// round 3, Jard 10-25, for per-door enrichment, keeping 20,000 of Qloo's 50,000 unspent); the precompute, the pre-warm and the dev server all
// write here.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { createHash } from "node:crypto";

// Qloo's own limits, as its response headers said on real calls (2026-10-21, data/qloo-headers.jsonl): a month of
// 50,000 calls (x-month-ratelimit-limit; 49,923 left after L1's runs), resetting about 2,589,300 s after Oct 21 22:51 UTC,
// so around Nov 20 (x-month-ratelimit-reset: a rolling month, not the calendar's), and 10 calls a second
// (x-second-ratelimit-*). This budget is the build's own ceiling, counted per calendar month (it rolls over Nov 1).
// Round 3 (Jard 10-25, ROUND3-SPEC: "spend what it takes" on per-door enrichment; ~46k of Qloo's month left): 30,000; 34,000 from the Oct 28 audit (gigbot: the Oct 29-31 site-wide daily ceiling was 2 new runs; Qloo keeps ≥16k of its 50k unused),
// keeping 16,000+ of Qloo's 50,000 unspent for live visitors.
export const LEDGER_BUDGET = 34000;
export const LEDGER_WARN = 26000;

export function paramsHash(params) {
  return createHash("sha256").update(JSON.stringify(params ?? {})).digest("hex").slice(0, 12);
}

export function ledgerEntry({ method = "GET", path, params, status, remaining, ms }, { source = "unknown", now = new Date() } = {}) {
  return { ts: now.toISOString(), source, method, path, hash: paramsHash(params), status, remaining: remaining ?? null, ms: ms ?? null };
}

export function readLedger(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

// Count calls in a given month ("2026-10"). Every line is one request that reached Qloo, whatever its status.
export function ledgerCount(entries, month) {
  return entries.filter((e) => !month || String(e.ts).startsWith(month)).length;
}

export function makeLedger(file, { source, budget = LEDGER_BUDGET, warn = LEDGER_WARN, onWarn } = {}) {
  mkdirSync(dirname(file), { recursive: true });
  const month = new Date().toISOString().slice(0, 7);
  let count = ledgerCount(readLedger(file), month);
  let warned = count >= warn;
  return {
    get count() {
      return count;
    },
    remainingBudget() {
      return budget - count;
    },
    // Throws before a request would push the build over its budget.
    assertBudget(n = 1) {
      if (count + n > budget) throw new Error(`Ledger: ${count} calls used this month; budget is ${budget}. Refusing more Qloo calls.`);
    },
    record(info) {
      appendFileSync(file, JSON.stringify(ledgerEntry(info, { source })) + "\n");
      count++;
      if (!warned && count >= warn) {
        warned = true;
        onWarn?.(count);
      }
    },
  };
}
