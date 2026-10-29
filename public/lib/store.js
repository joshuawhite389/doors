// Doors saved state: one profile + plan + door statuses + outcomes per brand-city, in localStorage under
// `doors.v2.<brand>-<city>`. Every storage access is wrapped: when storage is blocked, full or missing, the store
// keeps working in memory (and `persistent` is false, so the UI can say so). "Saved on this device only."
// No DOM, no imports: covered by test/store.test.mjs.

// 2 (group 3 #5, Jard 10-24: "no migration"): one brand, many cities. Every plan saved before it is cleared when the
// store opens (createStore drops each doors.v2.* key of another version); the demo keeps its own storage.
// 3 (Jard 10-24: "this is my schedule, some weeks it changes"): a city's days are a usual week (lib/week.js), no
// migration: plans saved with one week of dates are cleared the same way.
export const STORE_VERSION = 3;
export const KEY_PREFIX = "doors.v2.";

const slug = (s) =>
  String(s ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

// R9 S6 (Q4): a brand's rules (rule.avoid, rule.term records) hold in every city: one key per brand, outside the
// doors.v2. prefix so the plan list never reads it.
export const RULES_PREFIX = "doors.rules.v1.";
export const rulesKey = (brand) => `${RULES_PREFIX}${slug(brand)}`;

// The brand, entered once (lib/profile.js brandPart): its own key under the prefix, never a plan (no city).
export const BRAND_KEY = `${KEY_PREFIX}__brand`;

export function storeKey(brand, city) {
  return `${KEY_PREFIX}${slug(brand)}-${slug(city)}`;
}

export function emptyState(brand, city) {
  return { v: STORE_VERSION, brand: brand ?? null, city: city ?? null, profile: null, plan: null, statuses: {}, outcomes: {}, slots: {}, savedAt: null };
}

const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);

// A stored or imported blob → a state, or null when it is not one this version can read.
function normalise(raw) {
  if (!isObj(raw) || raw.v !== STORE_VERSION) return null;
  return {
    ...emptyState(raw.brand, raw.city),
    ...raw,
    statuses: isObj(raw.statuses) ? raw.statuses : {},
    outcomes: isObj(raw.outcomes) ? raw.outcomes : {},
    slots: isObj(raw.slots) ? raw.slots : {}, // R9 cultural slots (docs/CULTURAL-SLOTS.md §3)
  };
}

function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

// Does this storage actually take a write? (Safari private mode and blocked cookies throw on setItem.)
function probe(storage) {
  if (!storage) return false;
  try {
    const k = `${KEY_PREFIX}__probe`;
    storage.setItem(k, "1");
    storage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

// Version 2 starts fresh: every saved plan (a brand-city state, the form's draft) of another version goes. Only those:
// other things share the prefix (the live-run cache doors.v2.live.*, the Agent's chats, the demo's record, ticks).
const isPlanState = (x) => isObj(x) && "profile" in x && "statuses" in x && "city" in x;
function clearOld(storage) {
  try {
    const old = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (!k?.startsWith(KEY_PREFIX) || k === BRAND_KEY) continue;
      let x = null;
      try { x = JSON.parse(storage.getItem(k)); } catch {}
      if (isPlanState(x) && x.v !== STORE_VERSION) old.push(k);
    }
    old.forEach((k) => storage.removeItem(k));
  } catch {
    // storage refused: the old plans stay unreadable (normalise drops them)
  }
}

export function createStore(storage = defaultStorage()) {
  const memory = new Map(); // key → JSON string (null = removed); every write lands here first
  const persistent = probe(storage);
  if (persistent) clearOld(storage);

  // This session's own writes win (a write that hit a full disk must not read back the stale stored copy).
  const readRaw = (key) => {
    if (memory.has(key)) return memory.get(key);
    if (persistent) {
      try {
        const v = storage.getItem(key);
        if (v != null) return v;
      } catch {
        // unreadable: nothing saved
      }
    }
    return null;
  };
  const writeRaw = (key, value) => {
    memory.set(key, value);
    if (!persistent) return;
    try {
      storage.setItem(key, value);
    } catch {
      // full or blocked: the memory copy serves this session
    }
  };
  const removeRaw = (key) => {
    memory.set(key, null); // a removal the storage refused still reads as removed
    if (!persistent) return;
    try {
      storage.removeItem(key);
    } catch {
      // ignore
    }
  };

  const load = (brand, city) => {
    const raw = readRaw(storeKey(brand, city));
    if (raw == null) return emptyState(brand, city);
    try {
      return normalise(JSON.parse(raw)) ?? emptyState(brand, city);
    } catch {
      return emptyState(brand, city);
    }
  };
  const save = (brand, city, state) => {
    const out = { ...emptyState(brand, city), ...state, v: STORE_VERSION, brand, city, savedAt: new Date().toISOString() };
    writeRaw(storeKey(brand, city), JSON.stringify(out));
    return out;
  };
  const update = (brand, city, patch) => {
    const cur = load(brand, city);
    return save(brand, city, typeof patch === "function" ? patch(cur) : { ...cur, ...patch });
  };
  const setIn = (field) => (brand, city, id, value) =>
    update(brand, city, (st) => {
      const map = { ...st[field] };
      if (value == null) delete map[id];
      else map[id] = value;
      return { ...st, [field]: map };
    });

  const keys = () => {
    const out = new Set();
    if (persistent) {
      try {
        for (let i = 0; i < storage.length; i++) {
          const k = storage.key(i);
          if (k?.startsWith(KEY_PREFIX)) out.add(k);
        }
      } catch {
        // memory keys only
      }
    }
    for (const [k, v] of memory) v == null ? out.delete(k) : out.add(k);
    return [...out];
  };

  return {
    persistent,
    load,
    save,
    update,
    setStatus: setIn("statuses"),
    setOutcome: setIn("outcomes"),
    // R9: a door's (or "*") slot records, replaced whole; null clears them
    setSlots: setIn("slots"),
    getRules: (brand) => {
      try {
        const x = JSON.parse(readRaw(rulesKey(brand)) ?? "[]");
        return Array.isArray(x) ? x : [];
      } catch {
        return [];
      }
    },
    setRules: (brand, records) => (records?.length ? writeRaw(rulesKey(brand), JSON.stringify(records)) : removeRaw(rulesKey(brand))),
    remove: (brand, city) => removeRaw(storeKey(brand, city)),
    // the brand (group 3 #5): {v, profile, savedAt} → its profile (brand fields only), or null
    getBrand: () => {
      try {
        const x = JSON.parse(readRaw(BRAND_KEY) ?? "null");
        return isObj(x) && x.v === STORE_VERSION && isObj(x.profile) ? x.profile : null;
      } catch {
        return null;
      }
    },
    setBrand: (profile) => (profile ? writeRaw(BRAND_KEY, JSON.stringify({ v: STORE_VERSION, profile, savedAt: new Date().toISOString() })) : removeRaw(BRAND_KEY)),
    keys,
    list: () => listPlans(keys().map((k) => { try { return normalise(JSON.parse(readRaw(k))); } catch { return null; } })),
  };
}

// The saved plans ("Your plans"): every brand-city state with a profile and a city, newest first. The form's draft
// (city "") and anything unreadable are left out. Each row: {brand, city, profile, days, from, to, savedAt}.
export function listPlans(states) {
  return states
    .filter((st) => st?.profile && st.city && st.brand != null)
    .map((st) => {
      const dates = (st.profile.windows ?? []).map((w) => w.date).filter(Boolean).sort();
      return { brand: st.brand, city: st.city, profile: st.profile, days: dates.length, from: dates[0] ?? null, to: dates.at(-1) ?? null, savedAt: st.savedAt };
    })
    .sort((a, b) => String(b.savedAt ?? "").localeCompare(String(a.savedAt ?? "")) || a.brand.localeCompare(b.brand));
}

// Export / import a brand-city state as JSON (a file the rep can move between devices).
export function exportState(state) {
  return JSON.stringify(state, null, 2);
}

export function importState(json) {
  let raw;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error("Doors import: not a JSON file");
  }
  if (!isObj(raw)) throw new Error("Doors import: not a Doors plan");
  if (raw.v !== STORE_VERSION) throw new Error(`Doors import: version ${raw.v ?? "missing"} is not ${STORE_VERSION}`);
  return normalise(raw);
}
