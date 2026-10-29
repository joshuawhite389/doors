// Round 4 item 6 (Jard 10-27: "everything i write when i'm setting up a new brand/profile should be editable"):
// Settings lists every setup field with what it holds and a link to its form at that field (lib/settings.js); a saved
// form's profile is a whatif change (kind "profile") the plan previews, applies with Undo and lists in Changes you made.
import { test } from "node:test";
import assert from "node:assert/strict";
import { settingsRows, profileChanges, changesLine, brandDiffers, daysWords, changesWords } from "../public/lib/settings.js";
import { profileWith, fieldOf, undoOf, sameAs, changeText } from "../public/lib/whatif.js";
import { demoProfile } from "../public/lib/demo-profile.js";
import { emptyProfile, CITY_KEYS } from "../public/lib/profile.js";
import { parseHash } from "../public/lib/router.js";
import { readJson } from "./helpers.mjs";

const index = readJson("public/data/index.json");
const TODAY = new Date(2026, 9, 27);
const maya = () => demoProfile(TODAY);

test("every setup field is a Settings row with its value and a link to its form at that field", () => {
  const rows = settingsRows(maya(), index, { cityKey: "austin" });
  const fields = rows.map((r) => r.field);
  assert.deepEqual(fields, ["brand", "what", "product", "name", "drinks", "pours", "rooms", "drinkers", "ask", "pitch", "city", "start", "windows", "visit", "cap", "sells", "known"]);
  const by = Object.fromEntries(rows.map((r) => [r.field, r]));
  assert.equal(by.brand.value, "Tidewell");
  assert.equal(by.name.value, "Maya Ortiz");
  assert.equal(by.drinks.value, "Athletic Brewing");
  assert.equal(by.rooms.value, "Bars and breweries");
  assert.equal(by.ask.value, "one case of cans in the cooler");
  assert.match(by.product.value, /12 oz cans · non-alcoholic/);
  assert.doesNotMatch(by.product.value, /self-distributed/, "how you sell is the city's row");
  assert.equal(by.sells.value, "Self-distributed");
  assert.equal(by.city.value, "Austin");
  assert.equal(by.visit.value, "25 min");
  assert.equal(by.cap.value, "No limit");
  assert.match(by.windows.value, /^Tue 1 pm–6 pm; Wed, Thu 2 pm–5 pm$/, by.windows.value);
  // the brand's rows open the brand's form, the city's the city's, each at its field
  for (const r of rows) {
    const h = parseHash(r.href);
    assert.equal(h.name, r.part === "brand" ? "brand" : "city", r.field);
    assert.equal(h.params.field, r.field);
    if (r.part === "city") assert.equal(h.params.city, "austin");
  }
  // the demo: Maya's one form, at the field
  const demo = settingsRows(maya(), index, { demoHref: "#/edit?demo=1" });
  assert.equal(demo.find((r) => r.field === "windows").href, "#/edit?demo=1&field=windows");
  // an empty profile says what is missing, plainly
  const empty = Object.fromEntries(settingsRows(emptyProfile(), index).map((r) => [r.field, r.value]));
  assert.equal(empty.brand, "Not set");
  assert.equal(empty.windows, "Not set");
  assert.equal(empty.drinks, "None");
});

test("the usual week, its one-date changes and dated days read plainly", () => {
  const p = maya();
  p.week.changes = { "2026-10-30": { off: true }, "2026-11-03": { from: "10:00", to: "13:00" } };
  assert.equal(changesWords(p), "Oct 30 off; Nov 3 10 am–1 pm");
  assert.match(settingsRows(p, index).find((r) => r.field === "windows").value, /Changed dates: Oct 30 off; Nov 3 10 am–1 pm$/);
  p.week.days.saturday = { from: "12:00", to: "16:00", start: { label: "Rainey St", lat: 30.26, lon: -97.74 } };
  assert.equal(daysWords(p), "Tue 1 pm–6 pm; Wed, Thu 2 pm–5 pm; Sat 12 pm–4 pm from Rainey St");
  const dated = { ...emptyProfile(), windows: [{ date: "2026-10-27", from: "14:00", to: "18:00" }] };
  assert.equal(daysWords(dated), "Tue Oct 27 2 pm–6 pm");
  assert.equal(daysWords(emptyProfile()), "Not set");
});

test("profileChanges says what an edit changed, row by row, with what it was", () => {
  const was = maya(), now = maya();
  now.visitMin = 30;
  now.rooms = ["bars"];
  now.week.days.saturday = { from: "12:00", to: "16:00" };
  now.pitch.name = "Maya";
  const ch = profileChanges(was, now, index);
  assert.deepEqual(ch.map((c) => c.field), ["name", "rooms", "windows", "visit"]);
  assert.deepEqual(ch.find((c) => c.field === "visit"), { field: "visit", label: "Time at each door", part: "city", from: "25 min", to: "30 min" });
  assert.equal(changesLine(ch.filter((c) => c.field === "rooms" || c.field === "visit")), "Door types: Bars; Time at each door: 30 min");
  assert.deepEqual(profileChanges(was, maya(), index), []);
  // the brand's fields changed, or only the city's
  assert.equal(brandDiffers(was, now), true);
  assert.equal(brandDiffers(was, { ...was, visitMin: 40, start: null }), false);
  assert.equal(brandDiffers(was, { ...was, sample: true }), false, "the example flag is not a brand field");
  for (const k of CITY_KEYS) assert.ok(!brandDiffers(was, { ...was, [k]: undefined }), k);
});

test("a saved form's profile is a whatif change: previewed as a copy, applied, undone to the profile before it", () => {
  const was = maya(), now = maya();
  now.visitMin = 30;
  delete now.maxByDate; // a key the new profile no longer holds
  const change = { kind: "profile", profile: now, text: "Time at each door: 30 min", key: "p1" };
  const p = profileWith(was, change);
  assert.equal(p.visitMin, 30);
  assert.notEqual(p, now, "a copy");
  assert.equal(was.visitMin, 25, "the profile is untouched");
  const from = fieldOf(was, change);
  assert.deepEqual(from, was);
  const back = undoOf(change, from);
  assert.equal(back.kind, "profile");
  assert.equal(back.key, "p1");
  assert.deepEqual(profileWith(p, back), was);
  assert.equal(changeText(change), "Time at each door: 30 min");
  assert.equal(changeText({ kind: "profile", profile: now }), "Change your settings");
  assert.equal(sameAs(was, false, change), false);
  assert.equal(sameAs(was, false, { kind: "profile", profile: structuredClone(was) }), true);
  assert.equal(undoOf(change, null), null, "nothing to put back without a before");
});

// round 8 (Jard 10-28: "why do we have every single thing that we can edit in settings when it all takes you to the
// same page?"): Settings shows one short summary per part (brand, product, drinks, door types, ask; city, days and
// hours, time at each door, most doors a day) with one Edit each, in lib/settings.js settingsSummary
test("Settings' summary: five brand lines and four city lines, their values from the rows, no per-field links needed", async () => {
  const { settingsSummary, SUMMARY_FIELDS } = await import("../public/lib/settings.js");
  const sum = settingsSummary(maya(), index, { cityKey: "austin" });
  assert.deepEqual(sum.brand.map((r) => r.field), SUMMARY_FIELDS.brand);
  assert.deepEqual(sum.city.map((r) => r.field), SUMMARY_FIELDS.city);
  assert.deepEqual(sum.brand.map((r) => r.label), ["Brand name", "Your product", "Your drinker also drinks", "Door types", "Your ask"]);
  assert.deepEqual(sum.city.map((r) => r.label), ["City", "Days and hours", "Time at each door", "Most doors a day"]);
  assert.equal(sum.brand[0].value, "Tidewell");
  assert.equal(sum.city[0].value, "Austin");
  assert.equal(sum.city[2].value, "25 min");
  assert.ok(sum.brand.every((r) => r && r.part === "brand") && sum.city.every((r) => r && r.part === "city"));
  const empty = settingsSummary(emptyProfile(), index);
  assert.ok(empty.brand.every((r) => typeof r.value === "string" && r.value) && empty.city.every((r) => typeof r.value === "string" && r.value), "an empty profile still has words on every line");
});
