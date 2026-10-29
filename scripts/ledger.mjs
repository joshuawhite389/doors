// Print the build's Qloo call count for this month from data/ledger.jsonl.
import { readLedger, ledgerCount, LEDGER_BUDGET } from "../src/ledger.js";
const e = readLedger(new URL("../data/ledger.jsonl", import.meta.url).pathname);
const month = new Date().toISOString().slice(0, 7);
const n = ledgerCount(e, month);
const by = {};
for (const x of e) by[`${x.source} ${x.status}`] = (by[`${x.source} ${x.status}`] ?? 0) + 1;
const last = [...e].reverse().find((x) => x.remaining != null);
console.log(`${n} Qloo requests in ${month} (budget ${LEDGER_BUDGET}, ${LEDGER_BUDGET - n} left) · by source/status ${JSON.stringify(by)} · key's month remaining at last call: ${last?.remaining ?? "?"}`);
