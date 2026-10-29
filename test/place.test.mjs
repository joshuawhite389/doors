// Group 3 item 1 · the place picture (lib/place.js): assembled from Qloo's facts only, the rows a screen shows, what is
// missing for the "Get it from Qloo" button, and the merge of a fetched door into the city file. Real data, no network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { placePicture, placeMusic, placeSisters, timesText, visitsText, mergePlace, PLACE_LABELS } from "../public/lib/place.js";
import { route, city } from "./helpers.mjs";

const ab = route("athletic-brewing-austin");
const AUSTIN = city("austin");
const NOMADIC = "00000000-0000-4000-8000-271655E6AA28";

test("times and visits read in plain words, in clock order", () => {
  assert.equal(timesText(["Evening", "Afternoon"]), "afternoon and evening");
  assert.equal(timesText(["Late night", "Evening", "Morning", "Midday"]), "morning to late night");
  assert.equal(timesText([]), null);
  assert.equal(visitsText(["Destination", "Routine visit"]), "regulars and a destination");
  assert.equal(visitsText(["Something else"]), null);
});

test("a held-city door with tags, sisters and an age re-rank gets every row Qloo has", () => {
  const p = placePicture({ id: NOMADIC, venue: ab.venues[NOMADIC], city: AUSTIN, routes: [ab] });
  assert.equal(p.name, "Nomadic Beerworks");
  assert.equal(p.kind, "Brewery");
  const keys = p.rows.map((r) => r.key);
  for (const k of ["who", "ages", "when", "room", "pours", "into", "sisters"]) assert.ok(keys.includes(k), k);
  assert.match(p.rows.find((r) => r.key === "who").text, /craft beer enthusiasts/);
  assert.match(p.ages.text, /^Ranks highest with .+ Athletic Brewing drinkers$/);
  assert.equal(p.room.liveMusic, true);
  assert.match(p.room.text, /Live music$/);
  assert.equal(p.sisters.state, "shown");
  assert.equal(p.sisters.doors.length, 3);
  // its sound was fetched but didn't pass Doors' check: no music row, and nothing to fetch
  assert.equal(p.music.state, "held");
  assert.deepEqual(p.missing, []);
  for (const r of p.rows) assert.equal(r.label, PLACE_LABELS[r.key]);
  assert.match(p.text, /^Who goes: .+\. Ages: /);
});

test("every row's words come from the venue's own Qloo fields (assembled, not written)", () => {
  const v = ab.venues[NOMADIC];
  const p = placePicture({ id: NOMADIC, venue: v, city: AUSTIN, routes: [ab] });
  for (const t of p.room.feel) assert.ok(v.tags.ambience.includes(t));
  for (const t of p.pours.items) assert.ok(v.tags.bev.includes(t));
  for (const t of p.into.items) assert.ok(v.tags.interests.includes(t));
  assert.ok(v.crowd.startsWith(p.who.text));
});

test("a door without music or sisters says so in `missing` and shows no row for them", () => {
  const id = ab.lists.all.map((r) => r[0]).find((x) => !AUSTIN.sounds[x] && !AUSTIN.sisters[x]);
  const p = placePicture({ id, venue: ab.venues[id], city: AUSTIN, routes: [ab] });
  assert.deepEqual(p.missing, ["music", "sisters"]);
  assert.ok(!p.rows.some((r) => r.key === "music" || r.key === "sisters"));
});

test("music: shared genres and the first three artists, only when the check passed", () => {
  const passed = Object.values(AUSTIN.sounds).find((s) => s.guard?.pass && s.artists.length >= 3);
  const m = placeMusic(passed);
  assert.equal(m.state, "shown");
  assert.equal(m.artists.length, 3);
  assert.ok(m.text.includes(m.artists[0]));
  for (const g of m.genres) assert.doesNotMatch(g, /_|^all$|seen live/);
  assert.equal(placeMusic({ artists: [{ name: "X" }], guard: { pass: false } }).state, "held");
  assert.equal(placeMusic(undefined).state, "none");
});

test("sisters mark the ones on the plan", () => {
  const [sid] = AUSTIN.sisters[NOMADIC][0];
  const plan = { venues: {}, days: [{ day: "tuesday", stops: [{ id: sid }] }] };
  const s = placeSisters(AUSTIN, NOMADIC, plan);
  assert.equal(s.doors[0].onPlan, true);
  assert.match(s.text, /\(on your plan\)/);
});

test("a door with no Qloo fields gives an empty picture, not an error", () => {
  const p = placePicture({ id: "X", venue: { id: "X", name: "Somewhere" } });
  assert.deepEqual(p.rows, []);
  assert.deepEqual(p.missing, ["music", "sisters"]);
  assert.equal(p.text, "");
});

test("mergePlace adds a fetched door's music and sisters to the city file", () => {
  const c = mergePlace({ sounds: { a: 1 }, sisters: {}, sisterVenues: {} }, { sounds: { b: { artists: [], guard: { pass: false } } }, sisters: { b: [["c", 0.9]] }, sisterVenues: { c: { name: "C" } } });
  assert.deepEqual(Object.keys(c.sounds), ["a", "b"]);
  assert.equal(c.sisterVenues.c.name, "C");
  const p = placePicture({ id: "b", venue: { id: "b", name: "B" }, city: c });
  assert.deepEqual(p.missing, []);
  assert.equal(p.sisters.text, "C");
});

test("Why this door's one line: on the plan, or the reason it's left out, with its place on Your list", async () => {
  const { doorTrail, WHY_ON, WHY_OFF } = await import("../public/lib/basis.js");
  const venues = { a: { id: "a", name: "A", genre: "urn:tag:genre:place:bar" } };
  const cv = { rows: [{ id: "a", rank: 3 }, { id: "b", rank: 4 }] }; // rankfix (d2957fc): "#N of M" is the place on Your list, so "a" (rank 3) is #1 of these 2
  const on = doorTrail({ id: "a", name: "A", fate: "plan", reason: "Tuesday, stop 1 of 9" }, { venues, cv, who: "people who drink X" });
  assert.equal(on.why.title, WHY_ON);
  assert.equal(on.why.text, "On your plan: Tuesday, stop 1 of 9. #1 of 2 on Your list for people who drink X.");
  const off = doorTrail({ id: "a", name: "A", fate: "route", reason: "tuesday had no time left for it" }, { venues, cv, who: "people who drink X" });
  assert.equal(off.why.title, WHY_OFF);
  assert.match(off.why.text, /: Tuesday had no time left for it\. #1 of 2 on Your list/);
});
