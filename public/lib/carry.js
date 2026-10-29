// "The plan comes with you": one saved plan as a short code in the installed app's start_url. iOS gives a home-screen
// web app its own storage, apart from Safari's, so the plan the rep built in Safari isn't there; the page points its
// manifest at /manifest.webmanifest?c=<code> (src/worker.js), and the app's first start writes the plan back.
// The code holds what rebuilds the plan exactly: the profile (dates included), door statuses, outcomes, slots and the
// brand's rules, contacts and added rooms, locks, talk edits, and the saved plan's days (door ids; whole stops only on
// the days that ended, which show as they were). Never the venues or routes: they load again (fetched cities from /data, a live city
// from the Worker's saved run, a cache hit: no Qloo call). JSON → deflate-raw → base64url, "z" + it ("j" + plain
// base64url JSON where CompressionStream is missing). No DOM: covered by test/carry.test.mjs.

import { STORE_VERSION } from "./store.js";

export const CARRY_VERSION = 1;
export const CARRY_MAX = 6000; // characters: over it there is no carry (the page shows the "build it in the app" hint)
export const CARRY_RE = /^[zj][A-Za-z0-9_-]+$/; // the Worker's check too

const isObj = (x) => x !== null && typeof x === "object" && !Array.isArray(x);
const some = (x) => (Array.isArray(x) ? x.length > 0 : isObj(x) ? Object.keys(x).length > 0 : x != null && x !== false);

// A saved plan's days as the planner's `previous` needs them: a day ahead, or the day under way (frozen), re-plans
// around its door ids; a day that ended (past) shows its stops as they were, so they come whole.
function slimPlan(plan) {
  if (!Array.isArray(plan?.days)) return null;
  return {
    days: plan.days.map((d) => {
      if (!d) return null;
      const { stops = [], ...rest } = d;
      return { ...rest, stops: d.past ? stops : stops.map((s) => ({ id: s.id })) };
    }),
  };
}

// state (store.js) + the brand's rules → the object a code holds. Short keys: it rides in a URL.
const FIELDS = { s: "statuses", o: "outcomes", sl: "slots", cu: "current", lk: "locks", ct: "contacts", ad: "added", te: "talkEdits", fa: "famous", di: "dismissed", cn: "carriedNotes", la: "later" }; // la: Save for later (the Log book); its activity log is not carried (size)
export function packState(st, rules = []) {
  if (!st?.profile || !st.city) return null;
  const out = { v: CARRY_VERSION, b: st.brand, c: st.city, p: st.profile, at: st.savedAt ?? null };
  for (const [k, f] of Object.entries(FIELDS)) if (some(st[f])) out[k] = st[f];
  const pl = slimPlan(st.plan);
  if (pl) out.pl = pl;
  const up = slimPlan(st.uncappedPlan);
  if (up) out.up = JSON.stringify(up) === JSON.stringify(pl) ? 1 : up; // 1: the same as the plan (as it mostly is)
  if (rules?.length) out.r = rules;
  return out;
}

// The object back as {state, rules}, or null when it is not one this version reads.
export function unpackState(x) {
  if (!isObj(x) || x.v !== CARRY_VERSION || !isObj(x.p) || typeof x.c !== "string" || !x.c || typeof x.b !== "string") return null;
  const state = { v: STORE_VERSION, brand: x.b, city: x.c, profile: x.p, plan: x.pl ?? null, statuses: {}, outcomes: {}, slots: {}, savedAt: typeof x.at === "string" ? x.at : null };
  for (const [k, f] of Object.entries(FIELDS)) if (x[k] != null) state[f] = x[k];
  for (const f of ["statuses", "outcomes", "slots"]) if (!isObj(state[f])) state[f] = {};
  if (x.up) state.uncappedPlan = x.up === 1 ? state.plan : x.up;
  return { state, rules: Array.isArray(x.r) ? x.r : [] };
}

// ---------- bytes ----------
const b64url = (bytes) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const unb64url = (s) => {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};
const pipe = async (bytes, stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
const canDeflate = () => typeof CompressionStream === "function" && typeof DecompressionStream === "function";

// state → code, or null when it has no plan or the code would be over `max` characters.
export async function encodeCarry(st, { rules = [], max = CARRY_MAX, deflate = canDeflate() } = {}) {
  const x = packState(st, rules);
  if (!x) return null;
  const json = new TextEncoder().encode(JSON.stringify(x));
  let code = null;
  if (deflate) {
    try {
      code = "z" + b64url(await pipe(json, new CompressionStream("deflate-raw")));
    } catch {
      code = null;
    }
  }
  code ??= "j" + b64url(json);
  return code.length <= max ? code : null;
}

// code → {state, rules}, or null for anything that is not a code this version wrote (never throws).
export async function decodeCarry(code, { max = CARRY_MAX } = {}) {
  if (typeof code !== "string" || code.length > max || !CARRY_RE.test(code)) return null;
  try {
    let bytes = unb64url(code.slice(1));
    if (code[0] === "z") {
      if (!canDeflate()) return null;
      bytes = await pipe(bytes, new DecompressionStream("deflate-raw"));
    }
    return unpackState(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
  } catch {
    return null;
  }
}

// The carried plan meets this device's copy of the same brand-city: the copy saved more recently wins whole (a tie
// keeps this device's: the installed app opens the same code every time, after the rep has worked on in it); an
// outcome the other copy recorded later (by its `at`) is kept too. No copy here: the carried one.
export function mergeCarried(local, incoming) {
  if (!local?.profile) return incoming;
  const newer = String(incoming.savedAt ?? "") > String(local.savedAt ?? "");
  const [win, lose] = newer ? [incoming, local] : [local, incoming];
  const outcomes = { ...(win.outcomes ?? {}) };
  let took = false;
  for (const [id, o] of Object.entries(lose.outcomes ?? {})) {
    const w = outcomes[id];
    if (o?.at && (w ? w.at && o.at > w.at : o.at > String(win.savedAt ?? ""))) (outcomes[id] = o), (took = true);
  }
  return took ? { ...win, outcomes } : win; // this device's own object when nothing changes: nothing to save
}

// R9 carry2: a browser tab in drive mode keeps its address on the latest code (/app?…&drive=1&c=<code>#…), so a reload
// parses the coded manifest (iOS reads <link rel=manifest> as the page loads: public/app.html writes it from ?c=).
// search ("?a=1&c=…") + code (or null: over the cap) → the new search, other params kept.
export function carrySearch(search, code) {
  const q = new URLSearchParams(search);
  if (code) (q.set("drive", "1"), q.set("c", code));
  else q.delete("c");
  const s = q.toString();
  return s ? `?${s}` : "";
}

// Two codes for the same plan as it stands, whatever its savedAt (opening a plan saves it again): → true/false.
export async function sameCarry(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const [x, y] = await Promise.all([decodeCarry(a), decodeCarry(b)]);
  if (!x || !y) return false;
  const bare = ({ rules, state }) => JSON.stringify({ rules, state: { ...state, savedAt: null } });
  return bare(x) === bare(y);
}
