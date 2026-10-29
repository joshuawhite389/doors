// Make data/prewarm/ files current, no Qloo call (the KV free plan's 1,000 writes a day). Before, a
// pre-warmed run was {key, value} plus a {ref} alias under Qloo's name for the city and a runs-index.json; now it is
// one KV value with its saved-runs entry as metadata (src/worker.js runMeta), as the Worker writes a run.
//   node scripts/prewarm-convert.mjs [dir]      (default data/prewarm; safe to run again)
import { readdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { runMeta, validateRoute } from "../src/worker.js";

const dir = process.argv[2] ?? new URL("../data/prewarm", import.meta.url).pathname;
let runs = 0;
let aliases = 0;
let listed = 0;
for (const f of readdirSync(dir).filter((x) => /^[0-9a-f]{24}\.json$/.test(x))) {
  const file = join(dir, f);
  const row = JSON.parse(readFileSync(file, "utf8"));
  if (!row.value?.route) {
    rmSync(file); // an alias ({ref}): the saved-runs list now asks for a run by its own key
    aliases++;
    continue;
  }
  const r = row.value.route;
  const { input } = validateRoute({ kind: r.kind ?? "brand", id: r.drinker?.id, name: r.drinker?.name, city: r.city?.query ?? "x" });
  const metadata = runMeta(row.value, input, row.value.at);
  writeFileSync(file, JSON.stringify({ key: row.key, value: row.value, ...(metadata ? { metadata } : {}) }));
  runs++;
  if (metadata) listed++;
}
if (existsSync(join(dir, "runs-index.json"))) rmSync(join(dir, "runs-index.json")); // the list is the runs' metadata now
console.log(`${dir}: ${runs} runs (${listed} with a saved-runs entry), ${aliases} aliases removed`);
