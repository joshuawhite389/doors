// First-load speed (polish2): the pages' module graphs are ~7 imports deep, so on a slow phone connection each level
// waits a round trip before the next is even asked for (Fast 3G: ~0.6 s each). This writes, between the preload
// markers at the end of public/index.html and public/app.html, a script that asks at once for every module the page's
// entry imports statically (modulepreload) and the page's first data files. Not the stylesheets the modules add at run
// time: they check for an existing <link href> before adding theirs, so a preload link would stop them (tested: the
// tour card and Ask lost their styles). It is an inline script at the end of <body>, not <link>s in <head>, so it runs
// only once the head's stylesheets are in: on a slow line the first paint doesn't share its bandwidth with ~60 files
// (measured: links in <head> made first paint ~1-2 s later on Fast 3G).
// Usage: node scripts/preload.mjs [--check]   (--check: exit 1 if a page's block is stale; test/preload.test.mjs runs it)
import fs from "node:fs";
import path from "node:path";

const PUB = new URL("../public/", import.meta.url).pathname;
const PAGES = [
  // the landing hero reads these three before it draws (ui/landing.js hero(), bakedDay())
  { html: "index.html", entry: "/ui/landing.js", data: ["/data/index.json", "/data/routes/athletic-brewing-austin.json", "/data/demo/demo.json"] },
  { html: "app.html", entry: "/ui/app.js", data: ["/data/index.json"] },
];
const BEGIN = "<!-- preload:begin (scripts/preload.mjs writes this block) -->";
const END = "<!-- preload:end -->";

// every module reachable by static import/export-from, entry first, in discovery order; dynamic import() is left out
export function graph(entry) {
  const seen = [];
  const walk = (url) => {
    if (seen.includes(url)) return;
    seen.push(url);
    const src = fs.readFileSync(path.join(PUB, url), "utf8");
    for (const m of src.matchAll(/^\s*(?:import|export)\s[^;]*?\sfrom\s+["'](\.{1,2}\/[^"']+)["']|^\s*import\s+["'](\.{1,2}\/[^"']+)["']/gm)) {
      walk(path.posix.join(path.posix.dirname(url), m[1] ?? m[2]));
    }
  };
  walk(entry);
  return seen;
}

export function block({ entry, data }) {
  const mods = graph(entry);
  const list = (xs) => JSON.stringify(xs).replaceAll('","', '", "');
  return [
    BEGIN,
    "<script>",
    "(function (add) {",
    `  ${list(mods.slice(1))}.forEach(function (h) { add({ rel: "modulepreload", href: h }); });`,
    `  ${list(data)}.forEach(function (h) { add({ rel: "preload", as: "fetch", href: h, crossOrigin: "anonymous" }); });`,
    "})(function (o) { document.head.appendChild(Object.assign(document.createElement(\"link\"), o)); });",
    "</script>",
    END,
  ].join("\n");
}

export function render(html, page) {
  const a = html.indexOf(BEGIN), b = html.indexOf(END);
  if (a < 0 || b < a) throw new Error(`${page.html}: no preload markers`);
  return html.slice(0, a) + block(page) + html.slice(b + END.length);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const check = process.argv.includes("--check");
  let stale = 0;
  for (const page of PAGES) {
    const file = path.join(PUB, page.html);
    const html = fs.readFileSync(file, "utf8");
    const next = render(html, page);
    if (next === html) continue;
    stale++;
    if (check) console.log(`${page.html}: preload block is stale (a module's imports changed): run node scripts/preload.mjs`);
    else { fs.writeFileSync(file, next); console.log(`${page.html}: preload block written`); }
  }
  process.exit(check && stale ? 1 : 0);
}
