// Group 3 item 3: the browser's side of the written talking points. The sets Claude wrote for doors this device has
// opened are kept in localStorage by their key (lib/talk-gen.js talkKey); the demo cities' baked sets come with the
// stop data (/data/talk/<city>.json). A door with neither asks POST /api/talk once (src/talk.js), and the stop
// re-renders when the set arrives; until then, or when none can be written, the template shows (round 3: the page
// says only that the door's lines are being written, never which model, or that one is).
import { TALK_GEN_VERSION } from "../lib/talk-gen.js";

const KEY = `doors.v2.talk.${TALK_GEN_VERSION}`;
const MAX = 300;
const state = new Map(); // key → "pending" | {fallback: message}

export function liveSets() {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "{}") ?? {}; } catch { return {}; }
}
function save(key, stored) {
  try {
    const all = liveSets();
    all[key] = stored;
    const ks = Object.keys(all);
    for (const k of ks.slice(0, Math.max(0, ks.length - MAX))) delete all[k]; // oldest first out
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {}
}

// What the screen says about this door's set while there's no written one: "pending", {fallback: message} or null.
export const talkState = (key) => state.get(key) ?? null;

// Ask for one door's set (once per key per page load). onDone() runs when it settles, written or not.
export function requestTalk(tf, key, onDone = () => {}) {
  if (!tf || !key || state.has(key)) return false;
  state.set(key, "pending");
  fetch("/api/talk", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tf }) })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`talk ${r.status}`))))
    .then((j) => {
      if (j?.set) (save(key, { set: j.set, model: j.model, at: j.at }), state.set(key, "done"));
      else state.set(key, { fallback: j?.message ?? "Talking points for this door couldn't be written just now." });
    })
    .catch(() => state.set(key, { fallback: "Talking points for this door couldn't be written just now." }))
    .finally(() => onDone());
  return true;
}
