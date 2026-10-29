// "At the door" pitch: model lines are accepted only when clean; the template is the fallback. No network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { acceptLines, draftPitches, pitchSource } from "../src/pitch.js";
import { templatePitch } from "../public/lib/core.js";
import { route } from "./helpers.mjs";

const V = {
  id: "V1",
  name: "Yellow Jacket Social Club",
  crowd: "The crowd is mostly young professionals and East Austin locals. Some tourists.",
  ambience: "A laid-back patio bar with string lights and picnic tables.",
  goodFor: ["Groups", "Happy hour", "Dogs"],
  liveMusic: true,
  dishes: ["Grilled cheese", "Tots"],
};
const T = templatePitch(V).lines;
const tLine = (label) => T.find((l) => l.label === label);
const CLEAN = { crowd: "Young professionals and East Austin locals", room: "Laid-back patio with string lights", angle: "Ask about the happy hour crowd on the patio" };

test("template pitch: three lines, each with a source field", () => {
  assert.equal(templatePitch(V).by, "template");
  assert.deepEqual(T.map((l) => l.label), ["Crowd", "Room", "Angle"]);
  for (const l of T) assert.ok(typeof l.source === "string" && l.source.length > 0, l.label);
  assert.equal(tLine("Crowd").source, "customer_demographics_description");
  assert.equal(tLine("Room").source, "ambience_description");
  assert.equal(tLine("Angle").source, "live_music, good_for, specialty_dishes");
});

test("clean model lines are kept, with a source field", () => {
  const lines = acceptLines(V, CLEAN);
  assert.equal(lines.length, 3);
  assert.deepEqual(lines.map((l) => l.text), [CLEAN.crowd, CLEAN.room, CLEAN.angle]);
  for (const l of lines) assert.ok(l.source, `${l.label} has a source`);
  assert.equal(lines[0].source, "customer_demographics_description");
  assert.equal(lines[0].original, "The crowd is mostly young professionals and East Austin locals.");
  assert.equal(lines[2].source, "good_for, live_music, specialty_dishes");
});

for (const [why, text] of [
  ["trending", "Trending spot for young professionals"],
  ["this week", "Packed with locals this week"],
  ["pours", "Pours craft beer for East Austin locals"],
  ["an exclamation mark", "Young professionals love it!"],
  ["more than 160 characters", "Young professionals ".repeat(9).trim()],
]) {
  test(`a model line with ${why} is replaced by the template line`, () => {
    assert.ok(why !== "more than 160 characters" || text.length > 160);
    const lines = acceptLines(V, { ...CLEAN, crowd: text, room: text, angle: text });
    assert.deepEqual(lines, T, "every line falls back to the template");
    for (const l of lines) assert.ok(l.source);
  });
}

test("a line whose source field is missing falls back (or is dropped)", () => {
  const noAmb = { ...V, ambience: null };
  const lines = acceptLines(noAmb, CLEAN);
  assert.deepEqual(lines.map((l) => l.label), ["Crowd", "Angle"]);
  assert.equal(acceptLines({ id: "E", name: "Empty" }, CLEAN), null);
});

test("pitchSource sends only the venue's own descriptive fields", () => {
  assert.deepEqual(Object.keys(pitchSource(V)).sort(), ["ambience", "crowd", "good_for", "id", "live_music", "name", "specialty_dishes"]);
});

test("draftPitches without apiKey: template pitches for every venue, no fetch", async () => {
  const venues = Object.values(route("athletic-brewing-austin").venues).slice(0, 25);
  let fetched = 0;
  const out = await draftPitches(venues, { fetchImpl: async () => (fetched++, new Response("{}")) });
  assert.equal(fetched, 0);
  assert.equal(Object.keys(out).length, venues.length);
  for (const v of venues) {
    assert.equal(out[v.id].by, "template");
    assert.deepEqual(out[v.id], templatePitch(v));
    for (const l of out[v.id].lines) assert.ok(l.source);
  }
  assert.deepEqual(await draftPitches([], {}), {});
});

test("draftPitches with a stubbed model (no network): banned lines fall back, clean ones kept", async () => {
  const fetchImpl = async () =>
    Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ venues: [{ id: "V1", crowd: "Trending with locals!", room: CLEAN.room, angle: CLEAN.angle }] }) }] } }] });
  const out = await draftPitches([V], { apiKey: "stub-not-a-key", fetchImpl });
  assert.equal(out.V1.by, "model");
  assert.deepEqual(out.V1.lines[0], tLine("Crowd"));
  assert.equal(out.V1.lines[1].text, CLEAN.room);
});

test("Crowd/Room never print a banned word: template picks the next clean sentence; shipped city pitches are clean", async () => {
  const { templatePitch, BANNED_PITCH } = await import("../public/lib/core.js");
  const t = templatePitch({ crowd: "A rising crowd of young professionals. Locals and students fill the patio.", ambience: "Trending spot. Calm room with vinyl." });
  assert.deepEqual(t.lines.map((l) => l.text), ["Locals and students fill the patio.", "Calm room with vinyl."]);
  const { readdirSync, readFileSync } = await import("node:fs");
  const dir = new URL("../public/data/cities/", import.meta.url).pathname;
  for (const f of readdirSync(dir)) {
    const c = JSON.parse(readFileSync(dir + f, "utf8"));
    for (const p of Object.values(c.pitches ?? {})) for (const l of p.lines) assert.ok(!BANNED_PITCH.test(l.text), `${f}: ${l.text}`);
  }
});
