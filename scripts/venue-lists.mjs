// The export guard's list check (pre-audit 3, A3): a file that names many of Qloo's venues is a Qloo-derived list
// (tests/day1.md shipped sister-door lists for 10 rooms that way, and the UUID check could not see it: names, no ids).
// The venue names come from the private tree's Qloo data (data/, public/data/: every object with an address, a genre
// or the place type). A file in the export that names LIST_MIN or more of them fails. Hand-written tests and code name
// a few rooms each (9 at most on v2-tour 5222893); a pasted list names dozens.
// Usage: node scripts/venue-lists.mjs <private-repo> <export-dir>   (prints "<n>\t<file>\t<first names>" per bad file)
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const LIST_MIN = 12;
const MIN_LEN = 8; // short names ("The Yard", "Penumbra" pass at 8) are common words; under 8 they match by chance
const BINARY = /\.(png|jpe?g|gif|webp|ico|pmtiles|pbf|woff2?|ttf|otf|gz|zip|mp4|pdf)$/i;

const files = (dir) => readdirSync(dir, { recursive: true }).map((f) => join(dir, f)).filter((f) => statSync(f).isFile());

// every venue name in Qloo-derived JSON under <repo>/data and <repo>/public/data
export function venueNames(repo) {
  const names = new Set();
  const walk = (v) => {
    if (Array.isArray(v)) return v.forEach(walk);
    if (!v || typeof v !== "object") return;
    if (typeof v.name === "string" && (v.address || v.genre || v.type === "urn:entity:place")) names.add(v.name);
    Object.values(v).forEach(walk);
  };
  for (const d of ["data", "public/data"].map((d) => join(repo, d)).filter(existsSync))
    for (const f of files(d).filter((f) => f.endsWith(".json"))) {
      try { walk(JSON.parse(readFileSync(f, "utf8"))); } catch { /* not JSON: skip */ }
    }
  return [...names].filter((n) => n.length >= MIN_LEN);
}

// the export's text files that name LIST_MIN or more of those venues: [{ file, count, names }]
export function venueLists(names, out, min = LIST_MIN) {
  const bad = [];
  // public/lib/us-cities.js is the Census place list (scripts/make-cities.mjs): city names that happen to be venue names too
  for (const f of files(out).filter((f) => !BINARY.test(f) && !f.includes("/node_modules/") && !f.includes("/vendor/") && !f.endsWith("public/lib/us-cities.js"))) {
    const t = readFileSync(f, "utf8");
    if (t.includes("\0")) continue;
    const hit = names.filter((n) => t.includes(n));
    if (hit.length >= min) bad.push({ file: relative(out, f), count: hit.length, names: hit });
  }
  return bad.sort((a, b) => b.count - a.count);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [repo, out] = process.argv.slice(2);
  if (!repo || !out) { console.error("usage: node scripts/venue-lists.mjs <private-repo> <export-dir>"); process.exit(2); }
  const names = venueNames(repo);
  if (!names.length) { console.log(`no Qloo venue names under ${repo}/data or ${repo}/public/data: can't check`); process.exit(1); }
  for (const b of venueLists(names, out)) console.log(`${b.count}\t${b.file}\t${b.names.slice(0, 4).join(" | ")}`);
}
