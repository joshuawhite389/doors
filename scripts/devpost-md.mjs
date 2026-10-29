// SUBMISSION.md as Devpost's "About the project" wants it: from the first line under the title down, with every
// relative image path made absolute on the public repo (raw.githubusercontent.com), since Devpost has no copy of
// screenshots/ and a relative path renders as a broken image. Run it after scripts/publish.sh has pushed the public repo.
//   node scripts/devpost-md.mjs [--check] > devpost.md
//   --check: also fetch every image URL (HEAD) and exit 1 if one doesn't answer 200, or if LIVE_URL is still unfilled
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO = "joshuawhite389/doors", BRANCH = "main"; // scripts/publish.sh: the public copy's repo and branch
const RAW = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/`;
const ROOT = new URL("..", import.meta.url).pathname;
const text = readFileSync(join(ROOT, "SUBMISSION.md"), "utf8");
const body = text.replace(/^# .*\n+/, "") // Devpost has its own project-name field
  .replace(/<!--[\s\S]*?-->\n?/g, ""); // notes to ourselves (the real-user quote slot) never reach Devpost
const urls = [];
const out = body.replace(/(!\[[^\]]*\]\()(?!https?:)([^)]+)\)/g, (_, head, path) => {
  const url = RAW + path.replace(/^\.?\//, "");
  urls.push(url);
  return `${head}${url})`;
});
process.stdout.write(out);
if (process.argv.includes("--check")) {
  let bad = 0;
  if (/LIVE_URL/.test(out)) { console.error("LIVE_URL is still a placeholder: run scripts/publish.sh first"); bad++; }
  for (const u of urls) {
    const r = await fetch(u, { method: "HEAD" }).catch((e) => ({ status: e.message }));
    console.error(`${r.status} ${u}`);
    if (r.status !== 200) bad++;
  }
  console.error(bad ? `${bad} problem(s)` : `ok: ${urls.length} images answer 200`);
  process.exit(bad ? 1 : 0);
}
