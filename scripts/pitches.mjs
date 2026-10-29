// Draft "At the door" lines with Gemini for venues in the precomputed routes (no Qloo calls).
//   node scripts/pitches.mjs [--limit=N] [--batch=20] [--top=60]
// Cached in data/pitches.json by venue id; re-runs only draft what is missing. Then run `precompute.mjs build`.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { draftPitches } from "../src/pitch.js";

const ROOT = new URL("..", import.meta.url).pathname;
const arg = (n, d) => Number(process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1] ?? d);
const LIMIT = arg("limit", Infinity), BATCH = arg("batch", 20), TOP = arg("top", 60);
const key = process.env.GEMINI_API_KEY ?? readFileSync(join(homedir(), ".config/gigbot/gemini-key"), "utf8").trim();
const file = join(ROOT, "data/pitches.json");
const cache = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
const want = new Map();
for (const f of readdirSync(join(ROOT, "public/data/routes"))) {
  const r = JSON.parse(readFileSync(join(ROOT, "public/data/routes", f), "utf8"));
  for (const list of Object.values(r.lists)) for (const [id] of list.slice(0, TOP)) if (!cache[id] && r.venues[id]) want.set(id, r.venues[id]);
}
const todo = [...want.values()].slice(0, LIMIT);
console.log(`${Object.keys(cache).length} cached · ${want.size} missing · drafting ${todo.length}`);
let ok = 0, fail = 0;
for (let i = 0; i < todo.length; i += BATCH) {
  const batch = todo.slice(i, i + BATCH);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const out = await draftPitches(batch, { apiKey: key });
      for (const [id, p] of Object.entries(out)) if (p.by === "model") { cache[id] = p; ok++; }
      break;
    } catch (e) {
      console.log(`  batch ${i / BATCH}: ${e.message}`);
      await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
      if (attempt === 2) fail += batch.length;
    }
  }
  writeFileSync(file, JSON.stringify(cache));
  if ((i / BATCH) % 10 === 0) console.log(`  ${i + batch.length}/${todo.length} · drafted ${ok}`);
  await new Promise((r) => setTimeout(r, 4200)); // free tier: stay under 15 requests/minute
}
console.log(`done: drafted ${ok}, failed ${fail}, cache ${Object.keys(cache).length}`);
