// Jard 10-25: "big names" and "famous" are "pretentious and not even technically accurate … for doors, the most accurate
// word i think is popular". Every word a rep, a judge or a reader sees says "popular" ("one of the city's most popular
// doors", Qloo's popularity), never "big name(s)", "famous" or "best-known". Code identifiers (famous, famousOn) may
// stay. Data is not scanned: a real product ("The Famous Grouse") keeps its name.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { textPieces } from "./strscan.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const WORDS = /\bbig names?\b|\bfamous\b|\bbest-known\b/i;
const walk = (d) => readdirSync(join(ROOT, d), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));

test("no 'big name(s)', 'famous' or 'best-known' in any text the UI, the libraries or the Worker show (prompts included)", () => {
  // src/enrich-baseline.js is generated data (brand names Qloo holds, "The Famous Grouse" among them), never shown as text
  const files = [...walk("public/ui"), ...walk("public/lib"), ...walk("src")].filter((f) => f.endsWith(".js") && !f.endsWith("enrich-baseline.js"));
  assert.ok(files.length > 50, `scanned ${files.length} files`);
  const hits = [];
  for (const f of files) for (const t of textPieces(readFileSync(join(ROOT, f), "utf8"))) {
    // a reader sees words with spaces; an id, a key or an HTML attribute value ('id="w-famous"', data-th-fix="famous") is code
    const text = t.text.replace(/\b[\w-]+="[^"]*"/g, "");
    if (/\s/.test(text.trim()) && WORDS.test(text)) hits.push(`${f}:${t.line}: ${text.replace(/\s+/g, " ").trim().slice(0, 120)}`);
  }
  assert.deepEqual(hits, []);
});

test("no 'big name(s)', 'famous' or 'best-known' in the README, the submission or the privacy page", () => {
  for (const f of ["README.md", "SUBMISSION.md", "public/privacy.html"].filter((x) => existsSync(join(ROOT, x)))) {
    const lines = readFileSync(join(ROOT, f), "utf8").split("\n").map((l, i) => [i + 1, l]).filter(([, l]) => WORDS.test(l.replace(/`[^`]*`/g, "")));
    assert.deepEqual(lines.map(([n, l]) => `${f}:${n}: ${l.trim().slice(0, 120)}`), []);
  }
});

test("the scanner reads a template's words and skips code, comments and ids", () => {
  const p = textPieces('const a = famous ? `One of the ${x} most popular` : "x"; // famous comment\nconst b = `<i id="w-famous">${famousOn ? "Big name" : ""}</i>`;').map((t) => t.text);
  assert.ok(p.includes("Big name") && p.includes("One of the ") && !p.some((t) => /comment/.test(t)));
});
