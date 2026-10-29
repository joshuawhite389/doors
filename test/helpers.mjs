// Shared test helpers: read the committed public/data files (no network).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const readJson = (rel) => JSON.parse(readFileSync(join(ROOT, rel), "utf8"));
export const route = (key) => readJson(`public/data/routes/${key}.json`);
export const city = (key) => readJson(`public/data/cities/${key}.json`);
export const strip = (key) => readJson(`public/data/strip/${key}.json`);
