// H3: the guided demo resumes after a reload (public/lib/demo-session.js).
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEMO_KEY, prefixed, readRecord, writeRecord, clearDemo, resumeFrom } from "../public/lib/demo-session.js";
import { createStore } from "../public/lib/store.js";

// a Storage like sessionStorage
const fake = () => {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; }, m };
};

test("the record round-trips; junk, old versions and unknown steps read as nothing", () => {
  const s = fake();
  assert.equal(readRecord(s), null);
  writeRecord(s, { phase: "form", step: "pitch" });
  assert.deepEqual(readRecord(s), { v: 1, phase: "form", step: "pitch" });
  s.setItem(DEMO_KEY, "{not json");
  assert.equal(readRecord(s), null);
  s.setItem(DEMO_KEY, JSON.stringify({ v: 1, phase: "form", step: "tuesday" }));
  assert.equal(readRecord(s), null, "a plan step is not a form step");
  s.setItem(DEMO_KEY, JSON.stringify({ v: 2, phase: "form", step: "day" }));
  assert.equal(readRecord(s), null);
  s.setItem(DEMO_KEY, JSON.stringify({ v: 1, phase: "plan" }));
  assert.equal(readRecord(s), null, "a plan record needs its profile");
  assert.equal(readRecord(null), null);
  writeRecord({ setItem() { throw new Error("blocked"); } }, { phase: "form", step: "day" }); // never throws
});

test("resume: only a reload resumes (the form card, or the plan); any other way in starts at card 1", () => {
  const profile = { brand: "Tidewell" };
  assert.equal(resumeFrom(null, { reload: true }), null);
  assert.equal(resumeFrom({ phase: "form", step: "intro" }, { reload: true }), null, "card 1 is a fresh start");
  assert.deepEqual(resumeFrom({ phase: "form", step: "day" }, { reload: true }), { at: "form", step: "day" });
  assert.equal(resumeFrom({ phase: "form", step: "day" }), null, "Watch it work mid-form starts over");
  assert.deepEqual(resumeFrom({ phase: "plan", profile, done: false }, { reload: true }), { at: "plan", profile, done: false });
  assert.equal(resumeFrom({ phase: "plan", profile, done: false }, { reload: false }), null, "Watch it work mid-tour starts over");
  assert.deepEqual(resumeFrom({ phase: "plan", profile, done: true }, { reload: true }), { at: "plan", profile, done: true });
  assert.equal(resumeFrom({ phase: "plan", profile, done: true }, { reload: false }), null, "Watch it work after a finished demo starts over");
});

test("the demo's store lives under its own prefix; clearDemo removes it and the record, nothing else", () => {
  const s = fake();
  s.setItem("doors.v2.built", "[]");
  s.setItem("other", "x");
  const store = createStore(prefixed(s));
  assert.equal(store.persistent, true);
  store.save("Tidewell", "austin", { statuses: { a: "visited" }, outcomes: { a: { result: "interested" } } });
  writeRecord(s, { phase: "plan", profile: { brand: "Tidewell" }, done: false });
  assert.ok([...s.m.keys()].some((k) => k.startsWith("doors.v2.demo:doors.v2.tidewell-austin")));
  assert.equal(createStore(prefixed(s)).load("Tidewell", "austin").statuses.a, "visited", "a new page reads it back");
  clearDemo(s);
  assert.deepEqual([...s.m.keys()].sort(), ["doors.v2.built", "other"]);
  assert.equal(createStore(prefixed(s)).load("Tidewell", "austin").statuses.a, undefined);
});
