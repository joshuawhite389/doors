// polish2 link previews: index.html and app.html carry Open Graph + Twitter card tags with a 1200x630 image that exists
// in public/, and the icons they name exist. The URLs say __ORIGIN__; the Worker serves the pages with the request's
// own origin in its place (the workers.dev subdomain is picked at first deploy), so a scraper sees absolute URLs.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import worker, { PAGES } from "../src/worker.js";

const PUB = new URL("../public/", import.meta.url).pathname;
const meta = (html, key) => html.match(new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)"`))?.[1];

for (const page of ["index.html", "app.html"]) {
  test(`${page}: title, description, Open Graph and Twitter card with a real 1200x630 image`, () => {
    const html = fs.readFileSync(PUB + page, "utf8");
    assert.match(html, /<title>Doors · [^<]{20,}<\/title>/);
    assert.ok(meta(html, "description")?.length > 50);
    for (const k of ["og:type", "og:site_name", "og:url", "og:title", "og:description", "og:image", "og:image:alt", "twitter:card", "twitter:title", "twitter:description", "twitter:image", "twitter:image:alt"]) assert.ok(meta(html, k), k);
    assert.equal(meta(html, "twitter:card"), "summary_large_image");
    const img = meta(html, "og:image");
    assert.equal(img, "__ORIGIN__/og.png");
    assert.equal(meta(html, "twitter:image"), img);
    assert.match(meta(html, "og:url"), /^__ORIGIN__\//);
    const png = fs.readFileSync(PUB + "og.png");
    assert.equal(png.toString("ascii", 1, 4), "PNG");
    assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [1200, 630]);
    assert.ok(png.length < 1_000_000);
    for (const [, href] of html.matchAll(/<link rel="(?:icon|apple-touch-icon)" href="([^"]+)"/g)) assert.ok(fs.existsSync(PUB + href.slice(1)), href);
  });
}

// the Worker's half, through worker.fetch with a stand-in ASSETS that reads public/ like Workers assets (/app → app.html)
const ASSETS = { fetch: async (req) => {
  let p = new URL(req.url).pathname;
  if (p === "/") p = "/index.html";
  if (!p.includes(".")) p += ".html";
  return fs.existsSync(PUB + p.slice(1))
    ? new Response(fs.readFileSync(PUB + p.slice(1)), { headers: { "content-type": p.endsWith(".html") ? "text/html; charset=utf-8" : "image/png", "content-length": "1" } })
    : new Response("not found", { status: 404 });
} };
const serve = (u, method = "GET") => worker.fetch(new Request(u, { method }), { ASSETS }, { waitUntil() {} });

test("the Worker serves both pages with the request's own origin in every preview URL", async () => {
  for (const [u, page] of [["https://doors.someone.workers.dev/", "/"], ["https://doors.someone.workers.dev/?home=1", "/"], ["https://doors.someone.workers.dev/app", "/app"], ["http://127.0.0.1:8789/app.html", "/app"], ["https://x.test/index.html", "/"]]) {
    const res = await serve(u);
    assert.equal(res.status, 200, u);
    assert.match(res.headers.get("content-type"), /^text\/html/);
    assert.equal(res.headers.get("content-length"), null, "length dropped: the body changed");
    const html = await res.text();
    const origin = new URL(u).origin;
    assert.ok(!html.includes("__ORIGIN__"), u);
    assert.equal(meta(html, "og:image"), `${origin}/og.png`);
    assert.equal(meta(html, "twitter:image"), `${origin}/og.png`);
    assert.equal(meta(html, "og:url"), `${origin}${page}`);
  }
  assert.deepEqual(PAGES, ["/", "/index.html", "/app", "/app.html"]);
});

test("everything else passes through untouched; wrangler sends the pages to the Worker first", async () => {
  const png = await serve("https://x.test/og.png");
  assert.equal(png.headers.get("content-type"), "image/png");
  assert.equal((await png.arrayBuffer()).byteLength, fs.statSync(PUB + "og.png").size);
  assert.equal((await serve("https://x.test/nope.html")).status, 404);
  const toml = fs.readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
  const first = JSON.parse(toml.match(/^run_worker_first = (\[.*\])$/m)[1]);
  for (const p of PAGES) assert.ok(first.includes(p), p);
});
