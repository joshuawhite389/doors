// Re-shoot every screenshot README.md and SUBMISSION.md show (screenshots/v2/*.png and the lead image) from the
// current tree, so no picture contradicts the app (judge pass 2: the Oct 21 shots showed an 18-card tour, 14.9 road mi
// and "Stop 1 of 9"). Run it LAST, after every lane that changes the tour or the app has merged, against a dev server
// on the merged tree (SAMPLE=1 is enough: the tour and the finished plan make no live call).
//   node scripts/doc-shots.mjs <base-url> [out-dir]   e.g. http://127.0.0.1:8841 (out-dir: a trial run, the docs' files untouched)
// One Chromium at a time: the tour at 1400×900 and at 390×844 (scripts/demo-cdp.mjs, one shot per card, picked here by
// card key, so a card added or moved doesn't shift the pictures), the finished plan's Your rules and drive mode
// (scripts/r9-shots.mjs), the landing (../mockup-doors/shot.mjs), the grounding image (scripts/grounding-shot.mjs), the
// Devpost lead image (scripts/lead-image.mjs, the landing hero at 3:2) and the link preview public/og.png (scripts/og-image.mjs).
// Fails, writing nothing, if a tour run reports a problem or a card it needs is missing. Then run
// node scripts/doc-numbers.mjs --check, and look at every picture before committing them.
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const base = process.argv[2];
if (!base) { console.error("usage: node scripts/doc-shots.mjs <base-url>"); process.exit(2); }
const ROOT = new URL("..", import.meta.url).pathname;
const trial = process.argv[3];
const OUT = trial ?? join(ROOT, "screenshots/v2");
if (trial) mkdirSync(trial, { recursive: true });
const tmp = mkdtempSync("/tmp/claude-1000/doc-shots-");
process.on("exit", () => rmSync(tmp, { recursive: true, force: true }));
const run = (script, args) => execFileSync("node", [join(ROOT, script), ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"], timeout: 300000 });

// card key → picture, per size. The docs' captions name these (README's table, SUBMISSION's two inline images).
const TOUR = {
  "1400x900": { tuesday: "1400-2-demo-build", talk: "1400-4-stop", replan: "1400-5-followup", why: "1400-6-why", answer: "1400-7-ask", back: "1400-9-back" },
  "390x844": { tuesday: "390-2-plan", talk: "390-3-stop", answer: "390-4-ask", save: "390-5-drive" },
};
const picks = []; // [from, to]
for (const [size, want] of Object.entries(TOUR)) {
  const [w, h] = size.split("x");
  const dir = join(tmp, `tour-${size}`);
  const log = run("scripts/demo-cdp.mjs", [base, dir, w, h]);
  const problems = log.match(/^problems (.*)$/ms)?.[1].trim();
  if (problems !== "none") { console.error(`tour at ${size}: problems\n${problems}`); process.exit(1); }
  const files = readdirSync(dir);
  for (const [key, name] of Object.entries(want)) {
    const f = files.find((x) => x.endsWith(`-${key}.png`));
    if (!f) { console.error(`tour at ${size}: no card "${key}" (cards: ${files.join(" ")})`); process.exit(1); }
    picks.push([join(dir, f), `${name}.png`]);
  }
  console.log(`tour ${size}: ${files.length} shots, problems none`);
}
{
  const dir = join(tmp, "r9");
  const log = run("scripts/r9-shots.mjs", [base, dir, "1400", "900"]);
  if (!/^problems none$/m.test(log)) { console.error(log); process.exit(1); }
  picks.push([join(dir, "1400-r9-rules.png"), "1400-8-rules.png"]);
  // judge pass 4 (#8/N20): the Week tab of the finished plan, not tour card 11 over Tuesday's list
  picks.push([join(dir, "1400-r9-week.png"), "1400-3-week.png"]);
}
{
  // round 8 (Jard 10-28): the full-screen map on a phone with its layer menu open (Neighbourhoods, Other days)
  const dir = join(tmp, "r9-phone");
  const log = run("scripts/r9-shots.mjs", [base, dir, "390", "844", "phone"]);
  if (!/^problems none$/m.test(log)) { console.error(log); process.exit(1); }
  picks.push([join(dir, "390-r9-map.png"), "390-6-map.png"]);
}
for (const [w, h] of [["1400", "900"], ["390", "844"]]) {
  const f = join(tmp, `${w}-landing.png`);
  // ?instant: the hero's still end state (the whole day, stop 1's card). The live hero loops, so a timed shot caught its
  // route and miles counter mid-draw.
  run("../mockup-doors/shot.mjs", [`${base}/?instant=1`, f, "9000", w, h]); // 9 s: at 6 s the card was still fading in
  picks.push([f, `${w}-1-landing.png`]);
}
const lead = join(tmp, "lead.png");
run("scripts/grounding-shot.mjs", [base, lead]);
// the Devpost lead image (the landing hero at 3:2) and the link preview (public/og.png), both from the landing hero too
const landing = join(tmp, "lead-landing.png");
run("scripts/lead-image.mjs", [base, landing]);
picks.push([landing, "lead-landing.png"]);
const og = join(tmp, "og.png");
run("scripts/og-image.mjs", [base, og]);
for (const [from] of picks) if (!existsSync(from)) { console.error(`missing ${from}`); process.exit(1); }
if (!existsSync(og)) { console.error(`missing ${og}`); process.exit(1); }
for (const [from, to] of picks) copyFileSync(from, join(OUT, to));
copyFileSync(lead, trial ? join(trial, "grounding-before-after.png") : join(ROOT, "screenshots/grounding-before-after.png"));
copyFileSync(og, trial ? join(trial, "og.png") : join(ROOT, "public/og.png"));
console.log(`wrote ${picks.length} pictures to screenshots/v2, the grounding image and og.png. Next: node scripts/doc-numbers.mjs --check, then look at each one.`);
