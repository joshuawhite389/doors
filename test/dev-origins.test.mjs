// scripts/dev.mjs passes ALLOWED_ORIGINS to the Worker (src/guard.js originOk). Jard's phone reaches the dev server
// through tailscale serve as https://jard-ser.tail571c53.ts.net:8446 → http://100.90.129.66:8793: the request URL the
// server sees is the http one, so an https Origin is not same-origin and must be listed or /api/* answers 403.
// Spawns the dev server (SAMPLE=1, NO_MODEL=1: no key, no model, no network) and asks /api/place with an empty body:
// a listed origin gets past the origin check (400, the body is empty); an unlisted one is refused (403).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";

const ROOT = new URL("..", import.meta.url).pathname;
const PHONE = "https://jard-ser.tail571c53.ts.net:8446";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withDev(extraEnv, fn) {
  const port = 8900 + Math.floor(Math.random() * 200);
  const ch = spawn(process.execPath, ["scripts/dev.mjs", String(port)], { cwd: ROOT, env: { ...process.env, SAMPLE: "1", NO_MODEL: "1", NO_ORS: "1", ...extraEnv }, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  ch.stdout.on("data", (d) => (out += d)); ch.stderr.on("data", (d) => (out += d));
  try {
    for (let i = 0; i < 100 && !/Doors dev on/.test(out); i++) { if (ch.exitCode !== null) throw new Error(`dev.mjs exited: ${out}`); await sleep(100); }
    assert.match(out, /Doors dev on/, `dev.mjs started: ${out}`);
    await fn(`http://127.0.0.1:${port}`);
  } finally { ch.kill("SIGKILL"); }
}
const ask = (base, origin) => fetch(`${base}/api/place`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: "" }).then((r) => r.status);

test("dev.mjs passes ALLOWED_ORIGINS to the Worker: the phone's https origin gets past the origin check", async () => {
  await withDev({ ALLOWED_ORIGINS: PHONE }, async (base) => {
    assert.equal(await ask(base, PHONE), 400, "listed: past originOk, refused only for the empty body");
    assert.equal(await ask(base, "https://other.example"), 403, "an unlisted origin is still refused");
    assert.equal(await ask(base, base), 400, "the server's own origin still passes");
  });
});

test("dev.mjs without ALLOWED_ORIGINS: the phone's https origin is refused (what Jard saw as 403)", async () => {
  await withDev({ ALLOWED_ORIGINS: "" }, async (base) => {
    assert.equal(await ask(base, PHONE), 403);
  });
});
