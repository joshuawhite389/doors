// qloofull (Jard 10-27): Jard's own demo runs from the dev server's KV folder (data/kv-dev: <hash>.json = the value,
// <hash>.meta = {name, metadata}; Cincinnati, Columbus, Dayton, Milwaukee…) as saved-run files in prewarm's format
// ({key, value, metadata}, data/prewarm-dev/<sha256(key)[0:24]>.json), so the same fills run over them
// (qloofull-fill --dir, deep-prewarm --dir, qloofull-place --dir, enrich-bake --prewarm --dir) and prewarm.mjs --bulk
// can upload them with the saved runs. No call.
//   node scripts/qloofull-dev.mjs --from=<kv-dev dir> [--to=data/prewarm-dev]
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")).map(([k, v]) => [k, v ?? true]));
const FROM = String(args.from ?? join(ROOT, "data/kv-dev"));
const TO = String(args.to ?? "data/prewarm-dev").startsWith("/") ? String(args.to) : join(ROOT, String(args.to ?? "data/prewarm-dev"));
mkdirSync(TO, { recursive: true });
let n = 0, skipped = 0;
for (const m of readdirSync(FROM).filter((f) => f.endsWith(".meta")).sort()) {
  let meta;
  try { meta = JSON.parse(readFileSync(join(FROM, m), "utf8")); } catch { continue; }
  const key = meta?.name ?? "";
  if (!key.startsWith("route:v2:")) continue;
  const vf = join(FROM, m.replace(/\.meta$/, ".json"));
  if (!existsSync(vf)) continue;
  let value;
  try { value = JSON.parse(readFileSync(vf, "utf8")); } catch { continue; }
  if (!value?.route?.venues) { skipped++; continue; }
  const out = join(TO, createHash("sha256").update(key).digest("hex").slice(0, 24) + ".json");
  if (existsSync(out)) { skipped++; continue; } // a filled copy is never overwritten by the raw one
  writeFileSync(out, JSON.stringify({ key, value, ...(meta.metadata ? { metadata: meta.metadata } : {}) }));
  n++;
}
console.log(`qloofull-dev: ${n} runs written to ${TO} (${skipped} skipped: no route, or already there)`);
