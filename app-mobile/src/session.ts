// The app's shared state: the Worker's index, the web's store on the phone, the form's draft (as ui/app.js keeps it),
// and one PlanEngine per open plan (kept while the app runs, so going back and forth costs no re-plan).
import { createStore } from "../../public/lib/store.js";
import { emptyProfile } from "../../public/lib/profile.js";
import { demoProfile } from "../../public/lib/demo-profile.js";
import { prefixed } from "../../public/lib/demo-session.js";
import { bakedMatrix, demoStates } from "../../public/lib/demo-plan.js";
import { loadStorage, getStore, syncStorage } from "./storage";
import { getJSON, loadIndex, loadRoutes } from "./data";
import { PlanEngine } from "./engine";

export let index: any = null;
export const store = () => getStore();
export async function boot() {
  await loadStorage();
  // judge 6 #6: offline, the first open waited ~25 s (5 tries of up to 8 s, with back-off) before 'Couldn't reach
  // Doors'. Now about 6 s at most: tries of up to 4 s, one more try 1 s after a failure (a first launch's Local Network
  // prompt fails the first request as offline, iPhone 17), then the error screen and its Try again.
  const until = Date.now() + 6000;
  for (let i = 0; ; i++) {
    try {
      index = await loadIndex(Math.max(1000, Math.min(4000, until - Date.now())));
      return index;
    } catch (e) {
      if (i >= 1 || Date.now() + 1000 >= until) throw e;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

// ---------- the form's draft (ui/app.js: store key ["draft", ""], {profile, editOf}) ----------
const fill = (d: any) => (d?.v === 1 ? { ...emptyProfile(), ...d, pitch: { ...emptyProfile().pitch, ...(d.pitch ?? {}) }, known: d.known ?? [] } : null);
export const readDraft = () => {
  const st = store().load("draft", "");
  return { profile: fill(st.profile) ?? emptyProfile(), editOf: st.editOf ?? null };
};
export const saveDraft = (profile: any, editOf: any) => store().save("draft", "", { profile, editOf });
export const savedProfile = (brand: string, city: string) => fill(store().load(brand, city).profile);
// Jard 10-23 #1: a deleted plan leaves no draft behind: the form it was being edited in starts blank (New profile no
// longer opens Edit for it); a copy of it keeps the rep's typing, as a new profile (public/ui/app.js deletePlan).
export const dropDraftOf = (brand: string, city: string) => {
  const d = readDraft();
  if (!d.editOf || d.editOf.brand !== brand || d.editOf.city !== city) return;
  saveDraft(d.editOf.copy ? d.profile : emptyProfile(), null);
};
export const keyOf = (p: any) => ({ brand: p.brand.trim() || "my brand", city: p.city });

// ---------- engines ----------
const engines = new Map<string, PlanEngine>();
const id = (k: { brand: string; city: string }) => `${k.brand}\u0000${k.city}`;
export function engineFor(k: { brand: string; city: string }) {
  let e = engines.get(id(k));
  if (!e) {
    const profile = savedProfile(k.brand, k.city);
    if (!profile) return null;
    e = new PlanEngine({ store: store(), index, profile });
    engines.set(id(k), e);
  }
  return e;
}
// a rebuilt profile (Build my plan): a fresh engine for it
export function dropEngine(k: { brand: string; city: string }) {
  const e = engines.get(id(k));
  if (e) e.dead = true;
  engines.delete(id(k));
}

// Your rules changed in Edit profile (Form.tsx RulesBox): every open plan of that brand shows them now (no re-plan:
// rules change words, never the route)
export function rulesChanged(brand: string) {
  for (const e of engines.values()) if (e.brand === brand && e.plan) { e.plan = { ...e.plan, slots: e.slotsView() }; e.emit(); }
}

// The demo's plan (Maya / Tidewell, Austin) on the baked road matrix, in its own store (never the rep's plans).
export const DEMO_TRAVEL_NOTE = "Miles and drive times: OSRM (baked for the demo), © OpenStreetMap contributors.";
let demoEngine: PlanEngine | null = null;
export const demoStore = () => createStore(prefixed(syncStorage, "doors.app.demo:"));
// endState: the tour's finished plan (her visits and follow-up applied, lib demoStates), as the web's "Skip to the
// finished plan" (?instant=1). Judge, phone #10: the phone skipped to a fresh plan, so its numbers differed from the web's.
export async function openDemo({ fresh = false, endState = false } = {}) {
  if (demoEngine && !fresh) return demoEngine;
  if (demoEngine) demoEngine.dead = true;
  const demo = await getJSON("/data/demo/demo.json");
  const st = demoStore();
  const p = demoProfile();
  if (fresh) st.remove(p.brand, p.city);
  if (endState) {
    const { st: end } = await demoStates({ routes: await loadRoutes(p, index), profile: p, contact: demo.contact, fetchMatrix: bakedMatrix(demo.matrix), drive: true });
    st.save(p.brand, p.city, { ...end, profile: p });
  } else if (!st.load(p.brand, p.city).contacts?.length) st.update(p.brand, p.city, { contacts: [demo.contact] });
  demoEngine = new PlanEngine({ store: st, index, profile: p, demo: { fetchMatrix: bakedMatrix(demo.matrix), cache: new Map(), travelNote: DEMO_TRAVEL_NOTE } });
  await demoEngine.open();
  return demoEngine;
}
export const getDemoEngine = () => demoEngine;
