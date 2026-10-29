// Export guard (pre-audit 3, A3): a file in the public export that names many of Qloo's venues fails, ids or not.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { venueNames, venueLists, LIST_MIN } from "../scripts/venue-lists.mjs";

const fake = (i) => `Synthetic Taproom ${String(i).padStart(2, "0")}`;

test("venue names come from Qloo place objects in data/ and public/data/, not from brands or short names", () => {
  const repo = mkdtempSync(join(tmpdir(), "vl-repo-"));
  try {
    mkdirSync(join(repo, "public/data/cities"), { recursive: true });
    mkdirSync(join(repo, "data"));
    writeFileSync(join(repo, "public/data/cities/x.json"), JSON.stringify({ sisterVenues: { a: { name: fake(1), address: "1 Main St" }, b: { name: "Shorty", genre: "bar" } }, brand: { name: "Some Brand Co", type: "urn:entity:brand" } }));
    writeFileSync(join(repo, "data/entities.json"), JSON.stringify({ rooms: [{ name: fake(2), type: "urn:entity:place" }] }));
    assert.deepEqual(venueNames(repo).sort(), [fake(1), fake(2)]);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test("a file naming LIST_MIN or more venues fails; a test naming a few rooms passes", () => {
  const out = mkdtempSync(join(tmpdir(), "vl-out-"));
  try {
    const names = Array.from({ length: 30 }, (_, i) => fake(i));
    mkdirSync(join(out, "tests"));
    mkdirSync(join(out, "test"));
    writeFileSync(join(out, "tests/day1.md"), "## sister doors\n" + names.slice(0, LIST_MIN).map((n) => `- ${n}`).join("\n"));
    writeFileSync(join(out, "test/stop.test.mjs"), names.slice(0, LIST_MIN - 1).map((n) => `"${n}"`).join(", "));
    const bad = venueLists(names, out);
    assert.deepEqual(bad.map((b) => [b.file, b.count]), [["tests/day1.md", LIST_MIN]]);
  } finally { rmSync(out, { recursive: true, force: true }); }
});
