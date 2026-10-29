// Profile fields 7–9 survive the store (localStorage per brand-city, A2) and read back the same; storage blocked
// still works for the session.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../public/lib/store.js";
import { emptyProfile, pitchForTalk, validateProfile } from "../public/lib/profile.js";

const mem = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } };
};
const CITIES = [{ key: "austin", name: "Austin", center: [30.2672, -97.7431] }];
const profile = () => ({
  ...emptyProfile(),
  brand: "Tidewell",
  what: "Non-alcoholic hazy IPA",
  drinks: [{ key: "athletic-brewing", name: "Athletic Brewing", ready: true }],
  city: "austin",
  start: { label: "E Cesar Chavez St", lat: 30.2556, lon: -97.7208, source: "geocode" },
  // field 7: several windows, one with its own start; time at each door
  windows: [
    { date: "2026-10-13", from: "14:00", to: "16:00" },
    { date: "2026-10-14", from: "13:00", to: "18:00", start: { label: "Pin on the map", lat: 30.29, lon: -97.74, source: "pin" } },
  ],
  visitMin: 20,
  product: { ...emptyProfile().product, format: "cans", size: "12 oz" }, // group 3 #4
  // field 8: the pitch
  pitch: { price: "$42 a case", ask: "one case of cans in the cooler", support: ["samples", "menu"], name: "Maya" },
  // field 9: doors already known
  known: ["00000000-0000-4000-8000-271655E6AA28"],
});

test("fields 7–9 round-trip through the store", () => {
  const storage = mem();
  const p = profile();
  createStore(storage).save(p.brand, p.city, { profile: p, contacts: [{ id: "contact:1", name: "Barbs", lat: 30.26, lon: -97.72, source: "manual" }] });
  const back = createStore(storage).load("Tidewell", "austin"); // a new session
  assert.deepEqual(back.profile, p);
  assert.deepEqual(back.profile.windows[1].start, p.windows[1].start);
  assert.equal(back.profile.visitMin, 20);
  assert.deepEqual(back.profile.pitch, p.pitch);
  assert.deepEqual(back.profile.known, p.known);
  assert.equal(back.contacts[0].id, "contact:1");
  assert.ok(validateProfile(back.profile, { cities: CITIES }).ok);
});

test("storage blocked: the session still keeps the profile", () => {
  const boom = () => { throw new Error("blocked"); };
  const store = createStore({ getItem: boom, setItem: boom, removeItem: boom, key: boom, length: 0 });
  assert.equal(store.persistent, false);
  store.save("draft", "", { profile: profile() });
  assert.deepEqual(store.load("draft", "").profile, profile());
});

test("pitch → talk.js shape; a day's own start far from the city is invalid", () => {
  assert.deepEqual(pitchForTalk(profile()), { price: "$42 a case", ask: "one case of cans in the cooler", support: "free samples and a line on the menu" });
  assert.deepEqual(pitchForTalk(emptyProfile()), { price: "", ask: "", support: "" });
  const p = profile();
  p.windows[1].start = { label: "Dallas", lat: 32.78, lon: -96.8, source: "pin" };
  assert.match(validateProfile(p, { cities: CITIES }).errors.windows, /far from Austin/);
});
