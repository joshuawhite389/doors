// R9 carry, the page side (lib/carry.js has the code): while a plan is open in a browser tab, <link rel=manifest>
// points at /manifest.webmanifest?c=<this plan>, so Add to Home Screen installs an app that opens it. Round 8 (Jard
// 10-28): the drive-mode hint strip went; on an iPhone or iPad in a browser tab the plan's Menu has "Add to Home Screen"
// (ui/plan.js draws it from status() and prepare() here). The installed app's first start (/app?drive=1&c=…) writes the
// plan into its own storage (carryIn). Standalone with no plan: a note on the form says where plans live.
import { encodeCarry, decodeCarry, mergeCarried, carrySearch, sameCarry } from "../lib/carry.js";

const PREPARED = "doors.carry.prepared"; // sessionStorage, outside doors.v2.: Prepare's reload reopens the sheet once
const PLAIN = "/manifest.json";

export const standalone = () => {
  try {
    return matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  } catch {
    return false;
  }
};
export const ios = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

// /app?…&c=<code>: the carried plan into this storage (a newer copy here is kept: mergeCarried), its rules with it.
// → {brand, city} to open, or null (no code, or one that doesn't read: today's start, silently).
export async function carryIn(store, search = location.search) {
  const code = new URLSearchParams(search).get("c");
  if (!code) return null;
  const got = await decodeCarry(code);
  if (!got) return null;
  const { state, rules } = got;
  const local = store.load(state.brand, state.city);
  const merged = mergeCarried(local, state);
  if (merged !== local) {
    store.save(state.brand, state.city, merged);
    const have = store.getRules(state.brand);
    const seen = new Set(have.map((r) => JSON.stringify(r)));
    const add = rules.filter((r) => !seen.has(JSON.stringify(r)));
    if (add.length) store.setRules(state.brand, [...have, ...add]);
  }
  return { brand: state.brand, city: state.city };
}

// → {track({brand, city} | null), changed(), status(), prepare(), prepared()}: the plan on screen, "something was
// saved" (debounced), and the Menu's Add to Home Screen (ui/plan.js).
// R9 carry2 (real iPhone): iOS reads the manifest link as the page loads, not one swapped in later. So in drive mode
// the tab's address carries the latest code (carrySearch), app.html writes the link from it at parse time, and the
// sheet's "Prepare" reloads with ?c=<this plan>: then the parsed manifest is this plan as it stands ("Ready").
// status() → null (no plan open, standalone, or not an iPhone/iPad: no Menu item), else {state}: "get" (Prepare first),
// "ready" (Share → Add to Home Screen now), "big" (over the cap: no code). window "doors:carry" fires when it changes.
export function mountCarry({ store }) {
  let key = null;
  let code = null; // this plan's code, or null (none open, standalone, or too big to carry)
  let ready = false; // the manifest parsed at load carries this plan as it stands
  let seq = 0;
  let timer = null;
  const link = () => document.querySelector('link[rel="manifest"]');
  const loaded = (() => { try { return new URL(link()?.href ?? "", location.href).searchParams.get("c"); } catch { return null; } })();
  const driving = () => Boolean(document.getElementById("drive")) || /[?&]drive=1\b/.test(location.hash);

  async function refresh() {
    const my = ++seq;
    let next = null;
    if (key && !standalone()) next = await encodeCarry(store.load(key.brand, key.city), { rules: store.getRules(key.brand) }).catch(() => null);
    const same = await sameCarry(loaded, next);
    if (my !== seq) return;
    code = next;
    ready = same;
    const l = link();
    if (l) l.href = code ? `/manifest.webmanifest?c=${code}` : PLAIN; // Chrome reads a changed link; iOS needs the reload
    syncUrl();
    window.dispatchEvent(new CustomEvent("doors:carry"));
  }
  const later = () => { clearTimeout(timer); timer = setTimeout(refresh, 600); };

  // a browser tab: the address carries the code while driving, and drops it (with drive=1) after
  function syncUrl() {
    if (standalone()) return;
    const q = new URLSearchParams(location.search);
    let search = location.search;
    if (driving() && key) search = carrySearch(search, code);
    else if (q.has("c")) (q.delete("drive"), q.delete("c"), (search = carrySearch(`?${q}`, null)));
    if (search !== location.search) history.replaceState(history.state, "", `${location.pathname}${search}${location.hash}`);
  }

  const status = () => (!key || standalone() || !ios() ? null : { state: !code ? "big" : ready ? "ready" : "get" });
  // Prepare: the address carries this plan's latest code (drive=1 only while driving, so the reload lands where the rep
  // is: the plan, or drive mode), and the reloaded page parses its manifest from it (app.html). The sheet reopens once.
  async function prepare() {
    clearTimeout(timer);
    await refresh();
    if (!code || standalone()) return false;
    const q = new URLSearchParams(location.search);
    q.set("c", code);
    if (!driving()) q.delete("drive");
    history.replaceState(history.state, "", `${location.pathname}?${q}${location.hash}`);
    try { sessionStorage.setItem(PREPARED, "1"); } catch {}
    location.reload();
    return true;
  }
  const prepared = () => { try { const p = sessionStorage.getItem(PREPARED) === "1"; sessionStorage.removeItem(PREPARED); return p; } catch { return false; } };
  // drive mode opened (the address carries the code) or closed (it drops it)
  new MutationObserver(syncUrl).observe(document.body, { childList: true });

  return {
    track(k) {
      const same = k && key && k.brand === key.brand && k.city === key.city;
      key = k;
      if (!same) (clearTimeout(timer), refresh());
    },
    changed: () => key && later(),
    status,
    prepare,
    prepared,
  };
}

// Standalone with nothing saved: the form says where plans live (at the top).
export function noPlansNote(view) {
  const p = document.createElement("p");
  p.className = "carry-note";
  p.setAttribute("role", "note");
  p.textContent = "Plans live on the device where you built them. Open Doors in Safari, open your plan, then Add to Home Screen again.";
  view.prepend(p);
}
