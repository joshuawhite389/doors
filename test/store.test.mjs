// Saved state (SPEC-V2 §6 State): one versioned profile + plan + statuses + outcomes per brand-city, storage optional.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createStore, storeKey, emptyState, exportState, importState, STORE_VERSION } from "../public/lib/store.js";

const memStorage = () => {
  const m = new Map();
  return {
    m,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    key: (i) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
};
const throwing = () => {
  const boom = () => {
    throw new Error("SecurityError: storage blocked");
  };
  return { getItem: boom, setItem: boom, removeItem: boom, key: boom, get length() { return boom(); } };
};

const PROFILE = { brand: "Tidewell", make: "Non-alcoholic hazy IPA", drinksLike: ["athletic-brewing"], city: "austin", visitMin: 25 };

test("storeKey: doors.v2.<brand>-<city>, slugged", () => {
  assert.equal(storeKey("Tidewell", "Austin"), "doors.v2.tidewell-austin");
  assert.equal(storeKey("Athletic Brewing", "austin"), "doors.v2.athletic-brewing-austin");
  assert.equal(storeKey("  Señor Agave & Co. ", "St. Louis"), "doors.v2.senor-agave-co-st-louis");
});

test("load returns an empty versioned state when nothing is saved", () => {
  const s = createStore(memStorage());
  assert.equal(s.persistent, true);
  assert.deepEqual(s.load("Tidewell", "Austin"), emptyState("Tidewell", "Austin"));
  assert.equal(emptyState("x", "y").v, STORE_VERSION);
});

test("save then load round-trips profile, plan, statuses, outcomes under the brand-city key", () => {
  const st = memStorage();
  const s = createStore(st);
  const state = { ...emptyState("Tidewell", "Austin"), profile: PROFILE, plan: { days: [] }, statuses: { a: "visited" }, outcomes: { a: { kind: "interested" } } };
  s.save("Tidewell", "Austin", state);
  const raw = JSON.parse(st.m.get("doors.v2.tidewell-austin"));
  assert.equal(raw.v, STORE_VERSION);
  assert.ok(raw.savedAt);
  const back = s.load("Tidewell", "Austin");
  assert.deepEqual(back.profile, PROFILE);
  assert.deepEqual(back.statuses, { a: "visited" });
  assert.deepEqual(back.outcomes, { a: { kind: "interested" } });
  // a fresh store over the same storage sees it (persisted, not just memory)
  assert.deepEqual(createStore(st).load("Tidewell", "Austin").profile, PROFILE);
  // another brand-city is separate
  assert.equal(s.load("Tidewell", "Chicago").profile, null);
});

test("setStatus / setOutcome update one door; null clears", () => {
  const s = createStore(memStorage());
  s.setStatus("Tidewell", "Austin", "door1", "talked");
  s.setOutcome("Tidewell", "Austin", "door1", { kind: "followup", date: "2026-10-15", note: "ask for Sam" });
  let st = s.load("Tidewell", "Austin");
  assert.equal(st.statuses.door1, "talked");
  assert.equal(st.outcomes.door1.date, "2026-10-15");
  s.setStatus("Tidewell", "Austin", "door1", null);
  s.setOutcome("Tidewell", "Austin", "door1", null);
  st = s.load("Tidewell", "Austin");
  assert.ok(!("door1" in st.statuses));
  assert.ok(!("door1" in st.outcomes));
});

test("update merges a patch or applies a function", () => {
  const s = createStore(memStorage());
  s.update("Tidewell", "Austin", { profile: PROFILE });
  s.update("Tidewell", "Austin", (st) => ({ ...st, plan: { days: [1] } }));
  const st = s.load("Tidewell", "Austin");
  assert.deepEqual(st.profile, PROFILE);
  assert.deepEqual(st.plan, { days: [1] });
});

test("corrupt JSON or an unknown version loads as empty", () => {
  const st = memStorage();
  st.setItem("doors.v2.tidewell-austin", "{nope");
  st.setItem("doors.v2.tidewell-chicago", JSON.stringify({ v: 99, profile: PROFILE }));
  const s = createStore(st);
  assert.deepEqual(s.load("Tidewell", "Austin"), emptyState("Tidewell", "Austin"));
  assert.deepEqual(s.load("Tidewell", "Chicago"), emptyState("Tidewell", "Chicago"));
});

test("blocked storage: every call works in memory and persistent is false", () => {
  const s = createStore(throwing());
  assert.equal(s.persistent, false);
  s.save("Tidewell", "Austin", { ...emptyState("Tidewell", "Austin"), profile: PROFILE });
  s.setStatus("Tidewell", "Austin", "d", "visited");
  const st = s.load("Tidewell", "Austin");
  assert.deepEqual(st.profile, PROFILE);
  assert.equal(st.statuses.d, "visited");
  assert.deepEqual(s.keys(), ["doors.v2.tidewell-austin"]);
  s.remove("Tidewell", "Austin");
  assert.equal(s.load("Tidewell", "Austin").profile, null);
});

test("a full disk (setItem throws) keeps the state in memory", () => {
  const st = memStorage();
  st.setItem = () => {
    throw new Error("QuotaExceededError");
  };
  const s = createStore(st);
  s.update("Tidewell", "Austin", { profile: PROFILE });
  assert.deepEqual(s.load("Tidewell", "Austin").profile, PROFILE);
});

test("createStore() with no argument survives a localStorage getter that throws (or no localStorage)", () => {
  const desc = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { throw new Error("SecurityError"); } });
  try {
    const s = createStore();
    assert.equal(s.persistent, false);
    s.update("a", "b", { profile: PROFILE });
    assert.deepEqual(s.load("a", "b").profile, PROFILE);
  } finally {
    if (desc) Object.defineProperty(globalThis, "localStorage", desc);
    else delete globalThis.localStorage;
  }
});

test("keys lists only Doors v2 entries", () => {
  const st = memStorage();
  st.setItem("other.app", "1");
  const s = createStore(st);
  s.update("Tidewell", "Austin", { profile: PROFILE });
  s.update("Tidewell", "Boise", { profile: PROFILE });
  assert.deepEqual(s.keys().sort(), ["doors.v2.tidewell-austin", "doors.v2.tidewell-boise"]);
});

test("export / import round-trip; import rejects garbage and other versions", () => {
  const state = { ...emptyState("Tidewell", "Austin"), profile: PROFILE, statuses: { a: "notfit" } };
  const json = exportState(state);
  assert.equal(typeof json, "string");
  assert.deepEqual(importState(json), state);
  assert.throws(() => importState("not json"), /import/i);
  assert.throws(() => importState(JSON.stringify({ v: 99 })), /version/i);
  assert.throws(() => importState(JSON.stringify([1, 2])), /import/i);
  // missing maps are filled in
  const thin = importState(JSON.stringify({ v: STORE_VERSION, brand: "Tidewell", city: "Austin", profile: PROFILE }));
  assert.deepEqual(thin.statuses, {});
  assert.deepEqual(thin.outcomes, {});
});

test("this session's writes win over a stale stored copy when the disk is full", () => {
  const st = memStorage();
  const s0 = createStore(st);
  s0.update("Tidewell", "Austin", { profile: { brand: "old" } });
  // the probe write still works (storage looks fine), the real writes fail
  const { setItem, removeItem } = st;
  st.setItem = (k, v) => {
    if (k.endsWith("__probe")) return setItem(k, v);
    throw new Error("QuotaExceededError");
  };
  st.removeItem = (k) => {
    if (k.endsWith("__probe")) return removeItem(k);
    throw new Error("blocked");
  };
  const s = createStore(st);
  assert.equal(s.persistent, true);
  s.update("Tidewell", "Austin", { profile: PROFILE });
  assert.deepEqual(s.load("Tidewell", "Austin").profile, PROFILE);
  s.remove("Tidewell", "Austin");
  assert.equal(s.load("Tidewell", "Austin").profile, null);
  assert.deepEqual(s.keys(), []);
});
