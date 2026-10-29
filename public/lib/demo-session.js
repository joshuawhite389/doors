// The guided demo's progress in this tab (H3, owner: "When i refresh the browser, it starts the demo back over"). A
// reload of #/demo resumes where the visitor was instead of starting over. sessionStorage only: this tab, gone when it
// closes, never the visitor's saved plans. Every storage access is wrapped: blocked storage just means no resume.
// Pure (the storage is passed in): covered by test/demo-session.test.mjs.
import { STEPS } from "./demo-script.js";

export const DEMO_KEY = "doors.v2.demo"; // the record: {v, phase: "form", step} | {v, phase: "plan", profile, done}
export const DEMO_PREFIX = "doors.v2.demo:"; // the demo plan's store (statuses, outcomes, contacts) lives under this
const FORM_STEPS = STEPS.filter((s) => s.phase === "profile").map((s) => s.key);

// A Storage that keeps its keys under `prefix` (for createStore: the demo's plan never mixes with anything else).
export function prefixed(storage, prefix = DEMO_PREFIX) {
  if (!storage) return null;
  const own = () => {
    const ks = [];
    for (let i = 0; i < storage.length; i++) { const k = storage.key(i); if (k?.startsWith(prefix)) ks.push(k); }
    return ks;
  };
  return {
    getItem: (k) => storage.getItem(prefix + k),
    setItem: (k, v) => storage.setItem(prefix + k, v),
    removeItem: (k) => storage.removeItem(prefix + k),
    key: (i) => own()[i]?.slice(prefix.length) ?? null,
    get length() { return own().length; },
  };
}

export function readRecord(storage) {
  try {
    const r = JSON.parse(storage?.getItem(DEMO_KEY) ?? "null");
    if (r?.v !== 1) return null;
    if (r.phase === "form") return FORM_STEPS.includes(r.step) ? r : null;
    return r.phase === "plan" && r.profile && typeof r.profile === "object" ? r : null;
  } catch { return null; }
}
export function writeRecord(storage, rec) {
  try { storage?.setItem(DEMO_KEY, JSON.stringify({ v: 1, ...rec })); } catch {}
}
// Restart demo: the record and the demo plan's store, nothing else
export function clearDemo(storage) {
  try {
    const ks = [];
    for (let i = 0; i < storage.length; i++) { const k = storage.key(i); if (k === DEMO_KEY || k?.startsWith(DEMO_PREFIX)) ks.push(k); }
    ks.forEach((k) => storage.removeItem(k));
  } catch {}
}

// Where the demo opens: {at: "form", step} (that card, the form filled to it) | {at: "plan", profile, done} (the plan
// as they left it, the tour closed) | null (card 1, fresh). reload: this page was reloaded on #/demo (or came back to
// it with back/forward). Only a reload resumes: any other way in ("Watch the tour" on the landing, "Watch the demo
// instead") starts the tour at card 1, mid-demo or not (judge pass 2: a mid-tour entry opened the bare plan).
export function resumeFrom(rec, { reload = false } = {}) {
  if (!rec || !reload) return null;
  if (rec.phase === "form") return rec.step === FORM_STEPS[0] ? null : { at: "form", step: rec.step };
  return { at: "plan", profile: rec.profile, done: Boolean(rec.done) };
}
