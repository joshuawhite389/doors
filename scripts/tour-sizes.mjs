// The guided tour walked at every size a judge might use, one Chromium at a time: 320×568 (iPhone SE 1), 375×667
// (SE 2/3), 390×844 and 1400×900. Each run is scripts/demo-cdp.mjs (a visitor's clicks, every card, its placement
// checks); any problem at any size fails (tour fit 10-24: at 320 22 of 23 steps were skipped, at 375 two, unseen
// while only 390 and 1400 were walked).
// Usage: node scripts/tour-sizes.mjs <base-url> <out-dir>
import { execFileSync } from "node:child_process";
import { join } from "node:path";
const [base, out] = process.argv.slice(2);
if (!base || !out) { console.error("usage: node scripts/tour-sizes.mjs <base-url> <out-dir>"); process.exit(2); }
const SIZES = [["320", "568"], ["375", "667"], ["390", "844"], ["1400", "900"]];
let bad = 0;
for (const [w, h] of SIZES) {
  let log = "";
  try { log = execFileSync("node", [new URL("demo-cdp.mjs", import.meta.url).pathname, base, join(out, `${w}x${h}`), w, h], { encoding: "utf8", timeout: 600000 }); }
  catch (e) { log = `${e.stdout ?? ""}\nproblems run failed: ${e.message.split("\n")[0]}`; }
  const problems = log.match(/^problems (.*)$/ms)?.[1].trim() ?? "no report";
  console.log(`${w}×${h}: ${problems === "none" ? "ok" : `FAIL ${problems}`}`);
  if (problems !== "none") bad++;
}
process.exit(bad ? 1 : 0);
