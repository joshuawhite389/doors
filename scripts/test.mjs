// npm test. With the precomputed data present (the private tree) it runs every test file. In the public repo, where
// Qloo's terms keep the data out, it runs the files that need no data and names the ones it skipped.
import { existsSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
// Files that read public/data/**, data/**, src/sample-data.js or the Qloo-derived fixtures (checked 2026-10-21 by
// running the suite on the public export).
const NEEDS_DATA = ["cap", "core", "demo", "demo-swap", "export", "follow", "guard", "honesty", "hours", "insights", "pitch",
  "planview", "pool", "profile", "roominsight", "route", "schedule", "sieve", "stop", "sweep2", "sweep-planner",
  "sweep", "talk", "travel", "worker", "live", "examples", "guards", "kinds", "slots", "culture-data", "agent", "proof", "agent-free-models", "agent-live", "redteam-r9", "polish", "v5-eval", "question-not-visit-data", "rules-words", "ask", "fix4-plan", "fix5-agent", "fix6-agent", "fix6-plan", "resilience", "fix7", "fix8-offline", "fix9-agent", "fix10-drive", "fix11", "door-notes", "fix13", "whynot-agent", "webdrive-data", "dayflow-data", "agent-core", "agent-abilities", "basis", "fallback70b", "privacy-worker", "easewords2", "costguard", "crowds", "why-home", "rank-one", "agentfix-1024", "agent2", "whyviz-elsewhere", "g3profile", "place", "talk-gen", "g3agent", "r2ground-agent", "week-data", "enrich", "whyviz-explorer", "whyviz-thread", "whyviz-areas", "whyviz-lift", "whyviz-ring", "whyviz-bump", "whyviz-portrait", "deep-data", "r4edit", "r5crowd", "prewarm-set", "dev-origins"].map((n) => `${n}.test.mjs`);
const hasData = existsSync(join(ROOT, "public/data/index.json")) && existsSync(join(ROOT, "data/entities.json"));
const all = readdirSync(join(ROOT, "test")).filter((f) => f.endsWith(".test.mjs")).sort();
const run = hasData ? all : all.filter((f) => !NEEDS_DATA.includes(f));
if (!hasData) {
  console.log(`No precomputed data (public/data/, data/): skipping ${all.length - run.length} of ${all.length} test files that need it.`);
  console.log(`Regenerate it with your own Qloo key (README "Data"), then npm test runs them all.`);
}
const r = spawnSync(process.execPath, ["--test", ...run.map((f) => join("test", f))], { cwd: ROOT, stdio: "inherit" });
process.exit(r.status ?? 1);
