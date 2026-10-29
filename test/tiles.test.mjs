// /tiles/* Range handler (src/tiles.js) through the Worker, with a fake asset binding.
import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.js";
import { parseRange } from "../src/tiles.js";

const SIZE = 100_000;
const file = Uint8Array.from({ length: SIZE }, (_, i) => i % 251);
// Serves the file in 4 KiB chunks, like a stream; `honours` = the binding answers Range itself.
function assets({ honours = false, sized = true } = {}) {
  const seen = [];
  return {
    seen,
    fetch: async (req) => {
      seen.push(req.headers.get("range"));
      if (!new URL(req.url).pathname.endsWith("/austin.pmtiles")) return new Response("not found", { status: 404 });
      const r = honours && parseRange(req.headers.get("range"), SIZE);
      if (r && !r.bad) return new Response(file.slice(r.a, r.b + 1), { status: 206, headers: { "content-range": `bytes ${r.a}-${r.b}/${SIZE}`, "x-from": "assets" } });
      let i = 0;
      const body = new ReadableStream({
        pull(c) { if (i >= SIZE) return c.close(); c.enqueue(file.slice(i, i + 4096)); i += 4096; },
      });
      return new Response(req.method === "HEAD" ? null : body, { headers: { ...(sized ? { "content-length": String(SIZE) } : {}), "content-type": "application/octet-stream", etag: '"v1"' } });
    },
  };
}
const get = (env, path, range, method = "GET") =>
  worker.fetch(new Request(`https://doors.test${path}`, { method, headers: range ? { range } : {} }), env, {});

test("parseRange: open, closed, suffix, clamped, bad", () => {
  assert.deepEqual(parseRange("bytes=0-16383", SIZE), { a: 0, b: 16383 });
  assert.deepEqual(parseRange("bytes=99990-", SIZE), { a: 99990, b: SIZE - 1 });
  assert.deepEqual(parseRange("bytes=-10", SIZE), { a: SIZE - 10, b: SIZE - 1 });
  assert.deepEqual(parseRange("bytes=99990-200000", SIZE), { a: 99990, b: SIZE - 1 });
  assert.deepEqual(parseRange("bytes=200000-", SIZE), { bad: true });
  assert.equal(parseRange("bytes=0-1,5-9", SIZE), null);
  assert.equal(parseRange(null, SIZE), null);
});

test("a range on a 200 asset answers 206 with exactly those bytes", async () => {
  const env = { ASSETS: assets() };
  for (const [a, b] of [[0, 16383], [4090, 4105], [70_000, 70_000], [SIZE - 7, SIZE - 1]]) {
    const res = await get(env, "/tiles/austin.pmtiles", `bytes=${a}-${b}`);
    assert.equal(res.status, 206);
    assert.equal(res.headers.get("content-range"), `bytes ${a}-${b}/${SIZE}`);
    assert.equal(res.headers.get("content-length"), String(b - a + 1));
    assert.equal(res.headers.get("accept-ranges"), "bytes");
    assert.equal(res.headers.get("etag"), '"v1"');
    assert.deepEqual(new Uint8Array(await res.arrayBuffer()), file.slice(a, b + 1));
  }
});

test("the binding's own 206 is passed through untouched", async () => {
  const env = { ASSETS: assets({ honours: true }) };
  const res = await get(env, "/tiles/austin.pmtiles", "bytes=10-19");
  assert.equal(res.status, 206);
  assert.equal(res.headers.get("x-from"), "assets");
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), file.slice(10, 20));
});

test("no range → the whole file with accept-ranges; past the end → 416; HEAD; missing file 404", async () => {
  const env = { ASSETS: assets() };
  const whole = await get(env, "/tiles/austin.pmtiles");
  assert.equal(whole.status, 200);
  assert.equal(whole.headers.get("accept-ranges"), "bytes");
  assert.equal((await whole.arrayBuffer()).byteLength, SIZE);
  const bad = await get(env, "/tiles/austin.pmtiles", "bytes=200000-");
  assert.equal(bad.status, 416);
  assert.equal(bad.headers.get("content-range"), `bytes */${SIZE}`);
  const head = await get(env, "/tiles/austin.pmtiles", "bytes=0-99", "HEAD");
  assert.equal(head.status, 206);
  assert.equal(head.headers.get("content-length"), "100");
  assert.equal((await get(env, "/tiles/nowhere.pmtiles", "bytes=0-9")).status, 404);
  assert.equal((await get(env, "/tiles/austin.pmtiles", null, "POST")).status, 405);
});

// livesmoke 10-24: local workerd's asset answer had no content-length, and the old handler then sent the whole 15 MB file
test("an asset 200 without content-length: a range read still answers 206 with only its bytes", async () => {
  const env = { ASSETS: assets({ sized: false }) };
  const r0 = await get(env, "/tiles/austin.pmtiles", "bytes=0-15");
  assert.equal(r0.status, 206);
  assert.equal(r0.headers.get("content-range"), "bytes 0-15/*");
  assert.equal(r0.headers.get("content-length"), "16");
  assert.deepEqual(new Uint8Array(await r0.arrayBuffer()), file.slice(0, 16));
  const mid = await get(env, "/tiles/austin.pmtiles", "bytes=4090-4105");
  assert.equal(mid.status, 206);
  assert.deepEqual(new Uint8Array(await mid.arrayBuffer()), file.slice(4090, 4106));
  // a range running past the end: the bytes there are, and now the size is known
  const end = await get(env, "/tiles/austin.pmtiles", `bytes=${SIZE - 5}-${SIZE + 50}`);
  assert.equal(end.status, 206);
  assert.equal(end.headers.get("content-range"), `bytes ${SIZE - 5}-${SIZE - 1}/${SIZE}`);
  assert.equal((await end.arrayBuffer()).byteLength, 5);
  assert.equal((await get(env, "/tiles/austin.pmtiles", `bytes=${SIZE + 10}-${SIZE + 20}`)).status, 416);
  // open-ended and suffix forms read the file once for its size
  const open = await get(env, "/tiles/austin.pmtiles", `bytes=${SIZE - 3}-`);
  assert.equal(open.status, 206);
  assert.equal(open.headers.get("content-range"), `bytes ${SIZE - 3}-${SIZE - 1}/${SIZE}`);
  assert.deepEqual(new Uint8Array(await open.arrayBuffer()), file.slice(SIZE - 3));
  const suf = await get(env, "/tiles/austin.pmtiles", "bytes=-4");
  assert.deepEqual(new Uint8Array(await suf.arrayBuffer()), file.slice(SIZE - 4));
  // no range: the whole file, as before
  const whole = await get(env, "/tiles/austin.pmtiles");
  assert.equal(whole.status, 200);
  assert.equal((await whole.arrayBuffer()).byteLength, SIZE);
});

test("wrangler.toml sends /tiles/* to the Worker first", async () => {
  const { readFileSync } = await import("node:fs");
  const toml = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
  assert.match(toml, /run_worker_first = \[[^\]]*"\/tiles\/\*"/);
});
