// polish2 first-load speed: the preload block at the end of index.html and app.html lists every module the page's entry
// imports statically. If this fails, a module's imports changed: run `node scripts/preload.mjs` and commit the pages.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { graph } from "../scripts/preload.mjs";

test("the pages' preload blocks match their module graphs (else: node scripts/preload.mjs)", () => {
  const r = spawnSync(process.execPath, ["scripts/preload.mjs", "--check"], { cwd: new URL("..", import.meta.url).pathname, encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("the graph walk follows multi-line imports and leaves dynamic import() out", () => {
  const app = graph("/ui/app.js");
  assert.ok(app.includes("/ui/animate.js") && app.includes("/lib/schedule.js") && app.includes("/lib/agent-context.js"), app.join(" "));
  assert.equal(new Set(app).size, app.length);
  assert.ok(!app.includes("/lib/us-cities.js")); // the city list loads on demand (profile.js, plan.js: import())
});
