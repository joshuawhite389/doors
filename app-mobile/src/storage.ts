// The web's saved state (public/lib/store.js) on the phone: store.js reads a synchronous localStorage, so the app
// loads every Doors key from AsyncStorage once at launch into memory, serves reads from there, and writes through.
// Same keys as the web (doors.v2.<brand>-<city>, doors.rules.v1.<brand>, the form's draft), so the code that reads
// them is the web's own.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createStore } from "../../public/lib/store.js";

const PREFIXES = ["doors.v2.", "doors.rules.v1.", "doors.app."];
const mem = new Map<string, string>();

export const syncStorage = {
  get length() {
    return mem.size;
  },
  key: (i: number) => [...mem.keys()][i] ?? null,
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => {
    mem.set(k, String(v));
    AsyncStorage.setItem(k, String(v)).catch(() => {});
  },
  removeItem: (k: string) => {
    mem.delete(k);
    AsyncStorage.removeItem(k).catch(() => {});
  },
};

let ready: Promise<void> | null = null;
export function loadStorage() {
  ready ??= (async () => {
    try {
      const keys = (await AsyncStorage.getAllKeys()).filter((k) => PREFIXES.some((p) => k.startsWith(p)));
      const rows = await AsyncStorage.multiGet(keys);
      for (const [k, v] of rows) if (v != null) mem.set(k, v);
    } catch {}
  })();
  return ready;
}

// One store for the app (call after loadStorage()).
let store: any = null;
export const getStore = () => (store ??= createStore(syncStorage));

// Small app-only values (the form's draft, the last route): JSON under doors.app.*
export const appGet = (k: string) => {
  try {
    return JSON.parse(syncStorage.getItem(`doors.app.${k}`) ?? "null");
  } catch {
    return null;
  }
};
export const appSet = (k: string, v: unknown) => (v == null ? syncStorage.removeItem(`doors.app.${k}`) : syncStorage.setItem(`doors.app.${k}`, JSON.stringify(v)));
