// The publish set (data/prewarm/, uploaded to KV by publish.sh as the saved runs) holds ONLY the curated pre-warm combos
// (scripts/prewarm-set.mjs): Jard 10-27, none of his own test runs may be a saved run. Any other file fails here, named.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { combos } from "../scripts/prewarm-set.mjs";
import { kvRunKey, validateRoute } from "../src/worker.js";

const ROOT = new URL("..", import.meta.url).pathname;
const DIR = join(ROOT, "data/prewarm");

test("every saved run in data/prewarm is one of the curated pre-warm combos, filed under its own key", { skip: !existsSync(DIR) && "no data/prewarm here" }, () => {
  const index = JSON.parse(readFileSync(join(ROOT, "public/data/index.json"), "utf8"));
  const brands = existsSync(join(DIR, "brands.json")) ? JSON.parse(readFileSync(join(DIR, "brands.json"), "utf8")) : {};
  const allowed = new Set();
  for (const c of combos()) {
    const held = c.brand.held ? index.brands.find((x) => x.key === c.brand.held) : null;
    const b = c.brand.q ? brands[c.brand.q] : null;
    if (!held && !b) continue; // a brand never resolved has no run
    const { input } = validateRoute({ kind: "brand", id: held?.id ?? b.id, name: held?.name ?? b.name, city: c.city, na: Boolean(held?.na) });
    allowed.add(kvRunKey("live", input));
  }
  assert.ok(allowed.size >= 100, `${allowed.size} curated keys`);
  const strangers = [];
  for (const f of readdirSync(DIR).filter((x) => x.endsWith(".json") && x !== "brands.json")) {
    const row = JSON.parse(readFileSync(join(DIR, f), "utf8"));
    const key = String(row.key ?? "");
    const file = createHash("sha256").update(key).digest("hex").slice(0, 24) + ".json";
    if (!allowed.has(key) || file !== f) strangers.push(`${f}: ${key.slice(0, 90)}${file !== f ? " (filed under the wrong name)" : ""}`);
  }
  assert.deepEqual(strangers, [], "runs in the publish set that are not curated pre-warm combos");
});
