// Jard's batch 2026-10-23 #16 (Flavor House, Dayton): Qloo has no website for some doors, so their cards offer a plain
// web search for "<name> <city>, <ST>" instead. Only a URL: nothing is fetched or stored.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cityStateOf, webSearchHref, hasWebsite } from "../public/lib/note.js";

test("#16 cityStateOf: city and state from Qloo's address, with or without a comma before the city", () => {
  assert.equal(cityStateOf("130 W 2nd St Dayton, OH 45402", "Dayton, Ohio"), "Dayton, OH");
  assert.equal(cityStateOf("130 W 2nd St, Dayton, OH 45402"), "Dayton, OH");
  assert.equal(cityStateOf("3804 Woodbury Dr Suite A Austin, TX 78704", "Austin"), "Austin, TX");
  assert.equal(cityStateOf("1567 Main St STE 800 Buda, TX 78610", "Austin"), "Buda, TX"); // a suburb keeps its own town
  assert.equal(cityStateOf("1555 N Dayton St Chicago, IL 60642", "Chicago"), "Chicago, IL");
  assert.equal(cityStateOf("", "Dayton, OH"), "Dayton, OH"); // no address: the plan's city
  assert.equal(cityStateOf("somewhere", "Boise"), "Boise");
});

test("#16 webSearchHref: a DuckDuckGo search for the door, encoded; null with nothing to search", () => {
  assert.equal(webSearchHref({ name: "Flavor House", address: "130 W 2nd St Dayton, OH 45402" }, "Dayton"), "https://duckduckgo.com/?q=Flavor%20House%20Dayton%2C%20OH");
  assert.equal(webSearchHref({ name: "Bar & Grill #1" }, "Omaha"), "https://duckduckgo.com/?q=Bar%20%26%20Grill%20%231%20Omaha");
  assert.equal(webSearchHref({}, ""), null);
  assert.equal(hasWebsite({ website: "https://x.com" }), true);
  assert.equal(hasWebsite({ website: "x.com" }), false);
  assert.equal(hasWebsite({}), false);
});

test("#16 every door card (web + phone) falls back to Search the web ↗ when there is no website", () => {
  for (const f of ["public/ui/stop.js", "public/ui/plan.js", "public/ui/why.js", "app-mobile/src/screens/Stop.tsx", "app-mobile/src/screens/Plan.tsx", "app-mobile/src/screens/Why.tsx"]) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
    assert.match(src, /webSearchHref\(/, f);
    // the door cards (web + phone, concept A) have it as an action button: the words "Search the web" under the set's
    // search icon (Jard 10-24 #1); the plan rows and Why keep the text link "Search the web ↗"
    assert.match(src, f.endsWith("Stop.tsx") ? /icon="search" label="Search the web"/ : f.endsWith("stop.js") ? /\$\{icon\("search"\)\}<\/i>Search the web</ : /Search the web ↗/, f);
  }
});
