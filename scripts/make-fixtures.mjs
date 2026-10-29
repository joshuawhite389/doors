// Planner test fixtures: a static extract of the committed Athletic Brewing precompute for Austin and Chicago
// (no network). Each row is a pool row for public/lib/schedule.js with raw Qloo hours: rank 1..N follows
// lists.all; the other venues in the file (age lists, the famous list) follow from N+1 in file order, so tests can
// build bigger pools and pick a real "contact" outside the ranked list. Run: node scripts/make-fixtures.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

for (const city of ["austin", "chicago"]) {
  const key = `athletic-brewing-${city}`;
  const r = JSON.parse(readFileSync(join(ROOT, `public/data/routes/${key}.json`), "utf8"));
  const order = r.lists.all.map((x) => x[0]);
  const seen = new Set(order);
  for (const v of Object.values(r.venues)) if (!seen.has(v.id)) (seen.add(v.id), order.push(v.id));
  const pool = order.map((id, i) => {
    const v = r.venues[id];
    return { id, rank: i + 1, name: v.name, lat: v.lat, lon: v.lon, genre: v.genre, hours: v.hours };
  });
  const out = { drinker: r.drinker.name, city: r.city.name, captured: r.captured, ranked: r.lists.all.length, pool };
  writeFileSync(join(ROOT, `test/fixtures/${key}.json`), JSON.stringify(out) + "\n");
  console.log(`test/fixtures/${key}.json: ${pool.length} rows, ${out.ranked} ranked`);
}
