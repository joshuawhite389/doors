// Dev only: how Qloo reads a typed city (one /v2/insights call each, take 1, ledgered as source "dev"). Prints the
// status and Qloo's locality reading. Usage: node scripts/dev/city-probe.mjs "New York City" "Washington, DC"
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { QlooClient } from "../../src/qloo.js";
import { makeLedger } from "../../src/ledger.js";
import { doorParams } from "../../src/plan.js";

const ledger = makeLedger(new URL("../../data/ledger.jsonl", import.meta.url).pathname, { source: "dev" });
const q = new QlooClient({ apiKey: readFileSync(join(homedir(), ".config/gigbot/qloo-key"), "utf8").trim(), onLedger: (e) => ledger.record(e) });
const MODELO = "00000000-0000-4000-8000-F5D98F39FBC6";
for (const city of process.argv.slice(2)) {
  ledger.assertBudget(1);
  try {
    const b = await q.get("/v2/insights", doorParams({ signalId: MODELO, city, page: 1, take: 1 }));
    const loc = b?.query?.localities?.filter?.[0];
    console.log(JSON.stringify(city), "→ 200", JSON.stringify({ name: loc?.name, disambiguation: loc?.disambiguation, at: loc?.location }), "rooms", b?.results?.entities?.length ?? 0);
  } catch (e) {
    console.log(JSON.stringify(city), "→", String(e.message).slice(0, 160));
  }
}
console.log("calls", q.calls, "ledger month", ledger.count);
