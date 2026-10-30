// The /app shell: hash router (#/new, #/demo, #/plan, #/edit; group 3 #5: #/brand, #/cities, #/city), app bar, and the
// profile kept for this tab. One brand, many cities (Jard 10-24): the brand is saved once (store.getBrand); each city
// keeps its whole profile (the brand's fields and its own) with its plan, so a brand edit is written into every city.
import { createRouter, hrefFor, parseHash } from "../lib/router.js";
import { ACK_IDS, ackPath } from "../lib/ack.js"; // the hands-free Agent's acknowledgement clips, kept for offline
import { createStore } from "../lib/store.js";
import { loggingStore } from "../lib/logbook.js"; // round 4 item 10: every plan write logs its changes (the Log book's timelines)
import { getPlan } from "./state.js";
import { emptyProfile, canOpen, poursOf, listWords, brandPart, cityPart, withBrand } from "../lib/profile.js";
import { $, esc, initials } from "./dom.js";
import { loadIndex } from "./data.js";
import { cityOf, liveDrinkers, routeFiles } from "../lib/live.js";
import { profileChanges, changesLine } from "../lib/settings.js"; // round 4 #6: a saved form's change, in words
import { renderProfile, mountCities, cityLabel } from "./profile.js";
import { demoProfile } from "../lib/demo-profile.js";
import { planHref, BRAND_HREF, ADD_CITY, deletedCity, deletedBrand, deleteCityAsk, deleteBrandAsk, applyBrand } from "../lib/plans.js";
import { renderPlan } from "./plan.js";
import { keyOf as chatKey } from "./agent.js"; // Delete: the deleted cities' Agent chats (this tab) go too
import { renderDemo } from "./demo.js"; // C2
import { mountCarry, carryIn, standalone, noPlansNote } from "./carry.js"; // R9 carry
// R9 deep: ?deep=off or ?deepOff=tod,lead,hooks,heat switches Qloo's cultural signals off for this page (ablation)
import { setDeepOff, deepOffFromSearch } from "../lib/culture.js";
if (typeof location !== "undefined") setDeepOff(deepOffFromSearch(location.search));

// Saved state (store.js, localStorage, works with storage blocked): the profile being edited lives under a draft key;
// each brand-city keeps its own profile, plan, statuses, outcomes and contacts (written by the plan view). The draft
// also says which saved plan the form started from (editOf: {brand, city, name, copy?}), so Build says what it updates.
// R9 carry: every save re-makes the open plan's carry code (the manifest the Home Screen app installs from)
const base = loggingStore(createStore(), { nameOf: (id) => getPlan()?.venues?.[id]?.name ?? null });
const carry = mountCarry({ store: base });
const store = { ...base };
for (const f of ["save", "update", "setStatus", "setOutcome", "setSlots", "setRules", "remove", "setBrand", "drop"]) store[f] = (...a) => { const r = base[f](...a); carry.changed(); return r; };
const DRAFT = ["draft", ""];
const fill = (d) => (d?.v === 1 ? { ...withBrand(d, d), known: d.known ?? [] } : null);
const readDraft = () => fill(store.load(...DRAFT).profile);
const saveDraft = (p) => store.save(...DRAFT, { profile: p, editOf });
// a saved plan's profile, from #/plan?brand=…&city=… or #/edit?brand=…&city=…
const rulesOpts = (brand) => (brand ? { brand, get: () => store.getRules(brand), set: (rs) => store.setRules(brand, rs) } : null);
const savedProfile = ({ brand, city } = {}) => (brand && city ? fill(store.load(brand, city).profile) : null);
const keyOf = (p) => ({ brand: p.brand.trim() || "my brand", city: p.city });
// The saved brand; a device that has cities but no brand record (a plan carried in from Safari) takes the newest one's
const savedBrand = () => {
  const b = store.getBrand();
  if (b) return b;
  const last = store.list()[0];
  if (!last?.profile) return null;
  const out = brandPart(last.profile);
  base.setBrand(out);
  return out;
};
// Save the brand and write it into every city of it (lib/plans.js applyBrand: never another brand's, gigbot 10-29)
// except (round 4 #6): the city whose plan applied the change in place (ui/plan.js takeProfile): its profile and plan
// are its own; the brand's fields go to the other cities only
function saveBrand(p, { except = null } = {}) {
  const next = brandPart(p);
  delete next.sample;
  return applyBrand(store, next, savedBrand(), { except });
}
let lastPlan = null; // {brand, city} of the plan last on screen: where Edit my brand and My cities go back to
// round 4 #6: a saved brand's or city's form doesn't write its profile; the plan shows the change first (what it does
// to the plan), applies it with Undo, or drops it. pendingEdit: {to: {brand, city}, profile, text} until that plan draws.
// A brand renamed, a city changed, or brands whose doors need a live run still save the plain way (a new key or a run).
let pendingEdit = null;
const takePending = (k) => { const p = pendingEdit; pendingEdit = null; return p && p.to.brand === k.brand && p.to.city === k.city ? p : null; };
const needsRun = (p) => routeFiles(p, index).length < liveDrinkers(p, index).length;
const brandName = (x) => String(x?.brand ?? "").trim() || "my brand";

const bar = $("#appbar");
const view = $("#view");
let index;
let profile = readDraft() ?? emptyProfile();
let editOf = store.load(...DRAFT).editOf ?? null;
let shown = null; // the profile the plan view shows (a saved plan's, or the draft on a bare #/plan)
let cleanup = () => {};
let at = null; // the route on screen (#/edit and #/new?blank=1 show as #/new)
let mode = "all"; // the form's part (ui/profile.js): "all" the first time, "brand" (Edit my brand) or "city"
const citiesMounted = new Set(); // the "My cities" lists on screen, drawn again after a delete

// ease #5 (AUDIT-EASE-1): the plan's panels in the address (&stop=<id>, &why=1, &drive=1). Opening one pushes a history
// entry, so browser Back closes it; closing one goes back over that entry (or rewrites the address when there is none).
// A hash change that only moves these on the plan on screen doesn't draw the plan again: the plan view matches its panels
// to the address (planSync).
const PANELS = ["stop", "why", "log", "drive", "settings"]; // round 8: Settings open on the plan, so a form's Back returns to it
let planSync = null;
const sameParams = (a, b) => { const ka = Object.keys(a), kb = Object.keys(b); return ka.length === kb.length && ka.every((k) => a[k] === b[k]); };
const withoutPanels = (p) => Object.fromEntries(Object.entries(p).filter(([k]) => !PANELS.includes(k)));
const samePlan = (a, b) => a?.name === "plan" && b.name === "plan" && sameParams(withoutPanels(a.params), withoutPanels(b.params));
// Back from Start my day: ui/carry.js has put ?drive=1&c= in the address's search, so the browser fires popstate but no
// hashchange; the plan's panels follow the address all the same
window.addEventListener("popstate", () => {
  const r = parseHash(location.hash);
  if (planSync && samePlan(at, r) && !sameParams(at.params, r.params)) show(r);
});
const planNav = {
  bind: (fn) => { planSync = fn; },
  set(want) {
    if (at?.name !== "plan") return; // the rep left the plan while it was still drawing
    const cur = at.params;
    const next = { ...withoutPanels(cur), ...Object.fromEntries(PANELS.filter((k) => want[k]).map((k) => [k, want[k]])) };
    if (sameParams(cur, next)) return;
    const href = hrefFor("plan", next);
    at = { ...at, params: next };
    // round 8 item 4 (Jard 10-28): a panel opened OVER what is on screen adds an entry (Back closes it); a panel that
    // REPLACES another (Market → My doors, a door opened from the Log book) takes that entry over, so Back from the new
    // one returns to the plan rather than to the screen it replaced
    const added = PANELS.some((k) => next[k] && !cur[k]), gone = PANELS.some((k) => cur[k] && !next[k]);
    if (added && !gone) history.pushState({ doorsPrev: cur }, "", href);
    else if (history.state?.doorsPrev && sameParams(history.state.doorsPrev, next)) history.back(); // its hashchange finds the panels already matching
    else history.replaceState(history.state, "", href);
  },
};

// The form now holds p, started from the saved plan `of` (or nothing: a new profile).
function startForm(p, of = null) {
  profile = p;
  editOf = of;
  saveDraft(p);
}

// Delete (Jard 10-29: "i need a way to delete profiles/ brands/ cities that i've made"): a city, or a brand with every
// city of it (what: {brand, city|null}), from My cities, the plan's Settings or Edit my brand; one toast with Undo. The
// plan on screen deleted: the newest city of the same brand, else the newest plan, else the first form.
const sameBrand = (a, b) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();
const hit = (what) => (k) => Boolean(k && sameBrand(k.brand, what.brand) && (what.city == null || k.city === what.city));
function deletePlan(what, text) {
  const was = at && { name: at.name, params: at.params };
  const onScreen = at?.name === "plan" && shown && hit(what)(keyOf(shown));
  const gone = store.list().filter((r) => hit(what)(r));
  const fromForm = (at?.name === "brand" && what.city == null) || (at?.name === "city" && editOf && hit(what)(editOf));
  const undo = store.drop(what);
  // their Agent chats in this tab (sessionStorage, ui/agent.js), put back by Undo
  const chats = [];
  try {
    for (const r of gone) {
      const k = chatKey({ profile: r.profile, city: { key: r.city } });
      const v = sessionStorage.getItem(k);
      if (v != null) chats.push([k, v]), sessionStorage.removeItem(k);
    }
  } catch {}
  if (hit(what)(lastPlan)) lastPlan = null;
  if (hit(what)(editOf)) editOf = null;
  if (pendingEdit && hit(what)(pendingEdit.to)) pendingEdit = null;
  const left = store.list();
  const empty = !left.length && !savedBrand();
  if (empty) startForm(emptyProfile());
  if (onScreen || fromForm || (empty && at?.name === "cities")) {
    const next = left.find((r) => sameBrand(r.brand, what.brand)) ?? left[0];
    if (next && onScreen) router.go("plan", { brand: next.brand, city: next.city });
    else router.go(empty ? "new" : "cities");
  } else {
    citiesMounted.forEach((m) => m.draw());
    if (at) drawBar(at);
  }
  undoToast(text, () => {
    undo();
    try { chats.forEach(([k, v]) => sessionStorage.setItem(k, v)); } catch {}
    carry.changed();
    if (at?.name !== was?.name || !sameParams(at.params, was.params)) router.go(was.name, was.params);
    else { citiesMounted.forEach((m) => m.draw()); drawBar(at); }
  });
}
const deleteCity = (row, g) => deletePlan({ brand: row.brand, city: row.city }, deletedCity(g?.name ?? row.profile?.brand ?? row.brand, cityLabel({ city: row.city }, index, row.profile)));
const deleteBrand = (g) => deletePlan({ brand: g.brand, city: null }, deletedBrand(g.name, g.rows.length));

// the Undo toast: on the page, not in a view, so it stays when a delete moves to another screen
const toastEl = Object.assign(document.createElement("div"), { className: "toast app-toast", hidden: true });
toastEl.setAttribute("role", "status");
document.body.append(toastEl);
let toastTimer = 0;
const hideToast = () => { clearTimeout(toastTimer); toastEl.hidden = true; toastEl.innerHTML = ""; };
function undoToast(text, undo) {
  clearTimeout(toastTimer);
  toastEl.innerHTML = `<span>${esc(text)}</span><button type="button" class="lnk" data-undo>Undo</button>`;
  toastEl.hidden = false;
  $("[data-undo]", toastEl).addEventListener("click", () => { hideToast(); undo(); });
  toastTimer = setTimeout(hideToast, 12000);
}

const citiesOpts = (current) => ({ list: () => store.list(), cities: index.cities, current, brand: () => store.getBrand() ?? (store.list().length ? savedBrand() : null), onDelete: deleteCity, onDeleteBrand: deleteBrand });
const formProfile = () => profile;
// where a brand or city form's Cancel (and its save) goes: the plan last on screen, else My cities
const backTo = () => (lastPlan && store.load(lastPlan.brand, lastPlan.city).profile ? planHref(lastPlan.brand, lastPlan.city) : store.list().length ? hrefFor("cities") : "#/new");
// round 8 (Jard 10-28: "there's no back button, just save and cancel"): a brand or city form's Back goes to Settings
// (the plan last on screen, with Settings open), else where Cancel goes
const settingsBack = () => (lastPlan && store.load(lastPlan.brand, lastPlan.city).profile ? hrefFor("plan", { brand: lastPlan.brand, city: lastPlan.city, settings: "1" }) : backTo());

// The app's home (r2, Jard 10-24): the newest saved plan, else the demo's finished plan (Maya's Austin week)
const homeHref = () => {
  const last = store.list()[0];
  return last ? planHref(last.brand, last.city) : hrefFor("demo", { instant: "1" });
};
function drawBar(route) {
  // #/demo: the logo only; the demo's own banner says whose demo it is. r2 (Jard 10-24: "i want it to take you to this
  // page, what i will call the home page"): the logo never opens the landing; it opens the plan (homeHref)
  if (route.name === "demo") return void (bar.innerHTML = `<a class="logo" href="${homeHref()}" aria-label="Your plan"><i></i>Doors</a>`);
  const profile = route.name === "plan" && shown ? shown : route.name === "cities" ? withBrand(savedBrand()) : formProfile();
  const c = cityOf(profile, index); // L1: a live city by its name
  const named = profile.brand.trim();
  const pours = poursOf(profile, index.rooms);
  // intuit audit #5: "drinks like Athletic Brewing" under the brand read as if the brand drank it
  const forWho = profile.drinks.length ? `for ${listWords(profile.drinks.map((d) => d.name))} drinkers` : "";
  const drinker = pours.length ? `${forWho ? `${forWho}; ` : ""}poured at ${pours.map((r) => r.name).join(", ")}` : forWho || "new profile";
  const who = { av: named ? initials(named) : "?", t: `${named || "New brand"}${(route.name === "plan" || route.name === "city") && c ? ` · ${c.name}` : ""}`, s: drinker };
  // the first form: Watch the tour; the plan: its own tools sit at the header's right (ui/plan.js); a brand or city
  // form: its Cancel is the way out (audit 2 #6). group 3 #5: "Your plans" went (My cities is in Settings)
  const right = route.name === "new" ? `<a class="btn line sm" href="#/demo"><span>Watch the tour</span></a>` : "";
  bar.dataset.route = route.name; // doors.css: the narrowest form hides the brand line (intuit audit 1b #8)
  // Jard web review 10-24 #8: the logo opens the plan (this one, closed to its list; else the newest saved), not the
  // landing; Home stays in the plan's Menu. r2: nothing saved yet, Maya's finished demo plan (never the landing).
  const logo = route.name === "plan" ? hrefFor("plan", withoutPanels(route.params)) : homeHref();
  bar.innerHTML = `<a class="logo" href="${logo}" aria-label="Your plan"><i></i>Doors</a>
    <div class="who"><div class="avatar${named ? "" : " blank"}" aria-hidden="true">${esc(who.av)}</div><div style="min-width:0"><b>${esc(who.t)}</b><div class="sub">${esc(who.s)}</div></div></div>
    <div class="right">${right}</div>`;
}

// My cities (group 3 #5): the brand's cities, each opening its plan; Edit my brand beside it. Delete (Jard 10-29): each
// brand on the device with its cities, a Delete on every city and brand (mountCities); "My brands and cities" when more
// than one brand is saved.
function renderCities(root) {
  const b = savedBrand();
  const title = () => (new Set(store.list().map((r) => r.brand.trim().toLowerCase())).size > 1 ? "My brands and cities" : "My cities");
  root.innerHTML = `<div class="profile"><div class="pform cities">
    <h2 id="cities-h">${title()}</h2>
    <div class="editnote" role="status">${esc(String(b?.brand ?? "").trim() || "Your brand")} in every city: each city has its own days, start and plan. Open, edit or delete a city or a brand here.</div>
    <div id="cities-list"></div>
    <div class="build"><a class="btn line" id="cities-back" href="${esc(backTo())}">${lastPlan ? "Back to your plan" : "Back"}</a></div>
  </div></div>`;
  const list = mountCities($("#cities-list", root), {
    ...citiesOpts(lastPlan),
    onCount: () => {
      const h = $("#cities-h", root), back = $("#cities-back", root);
      if (h) h.textContent = title();
      if (back) Object.assign(back, { href: backTo(), textContent: lastPlan ? "Back to your plan" : "Back" });
      document.title = `${title()} · Doors`;
    },
  });
  list.draw();
  citiesMounted.add(list);
  return () => citiesMounted.delete(list);
}

const valid = (p) => canOpen(p, { cities: index.cities }); // N1: a plan saved before the signer was required still opens
// #/plan?brand=…&city=… shows that saved plan; a bare #/plan shows the form's profile
const planProfile = (route) => (route.params.brand ? savedProfile(route.params) : profile);
// group 3 #5: Edit my brand, My cities and a city's form need the brand; the first form is for a device without one
const guard = (r) => {
  if (r.name === "plan" && !valid(planProfile(r))) return "new";
  if (r.name === "edit" && !r.params.demo && !savedProfile(r.params)) return "new";
  if (["brand", "cities", "city"].includes(r.name) && !savedBrand()) return "new";
  if (r.name === "new" && savedBrand()) return "city"; // one brand: a new profile is a new city for it
  return null;
};

async function show(route) {
  if (planSync && samePlan(at, route)) return void ((at = route), planSync(route.params)); // ease #5: Back / Forward over a panel
  planSync = null;
  const field = route.params.field ?? null; // round 4 #6: Settings opens a form at this field (ui/profile.js)
  if (route.name === "edit") {
    // a saved plan's profile (#/edit?brand=…&city=…, before group 3) is that city's form; from the demo, Maya's
    // profile as the sample brand in the first form
    if (route.params.demo && !savedBrand()) {
      startForm({ ...demoProfile(), sample: true });
      history.replaceState(null, "", "#/new");
      route = { name: "new", params: {}, known: true };
    } else {
      route = { name: "city", params: route.params.demo ? {} : { city: route.params.city }, known: true };
      history.replaceState(null, "", hrefFor("city", route.params));
    }
  }
  mode = "all";
  if (route.name === "new") {
    if (route.params.blank || (!at && profile.sample)) startForm(emptyProfile());
    // owner 10-23: Start with my brand (a fresh page on #/new) showed Maya's demo profile, left as an untouched sample
    // draft. An example nobody changed isn't theirs: start blank; "Examples" is still one click away on the form
    if (route.params.blank) history.replaceState(null, "", "#/new");
    route = { name: "new", params: {}, known: true };
    editOf = null;
  } else if (route.name === "brand") {
    mode = "brand";
    profile = withBrand(savedBrand(), null);
    editOf = { brand: keyOf(profile).brand, city: "", name: profile.brand };
  } else if (route.name === "city") {
    mode = "city";
    const b = savedBrand();
    const saved = route.params.city ? savedProfile({ brand: keyOf(b).brand, city: route.params.city }) : null;
    if (route.params.city && !saved) {
      history.replaceState(null, "", ADD_CITY);
      route = { name: "city", params: {}, known: true };
    }
    profile = withBrand(b, saved);
    editOf = saved ? { brand: keyOf(b).brand, city: route.params.city, name: b.brand } : null;
  }
  if (route.name === "plan") (shown = planProfile(route)), (lastPlan = shown && keyOf(shown));
  carry.track(route.name === "plan" && shown ? keyOf(shown) : null); // R9 carry
  at = route;
  cleanup();
  cleanup = () => {};
  drawBar(route);
  view.scrollTop = 0;
  window.scrollTo(0, 0);
  document.title = { new: "Your brand · Doors", brand: "Edit my brand · Doors", cities: "My cities · Doors", city: editOf ? `${cityLabel(editOf, index, profile)} · Doors` : "Add a city · Doors", demo: "Demo · Doors", plan: "Your plan · Doors" }[route.name];
  if (route.name === "cities") cleanup = renderCities(view);
  else if (route.name === "new" || route.name === "brand" || route.name === "city") {
    cleanup = renderProfile(view, {
      index, profile, mode,
      editing: mode === "city" ? editOf : null,
      cancel: mode === "all" ? null : backTo(),
      back: mode === "all" ? null : settingsBack(), // round 8: ← Back at the top, nothing saved
      brandHref: BRAND_HREF,
      // Your rules (brand-wide, every city) in Edit my brand: the store's own rules for that brand
      rules: mode === "brand" ? rulesOpts(keyOf(profile).brand) : null,
      // Delete (Jard 10-29): Edit my brand deletes the brand and its cities; a saved city's form deletes that city
      onDelete: mode === "brand" ? { ask: deleteBrandAsk(brandName(profile), store.list().filter((r) => sameBrand(r.brand, keyOf(profile).brand)).length), label: "Delete this brand", go: () => deleteBrand({ brand: keyOf(profile).brand, name: brandName(profile), rows: store.list().filter((r) => sameBrand(r.brand, keyOf(profile).brand)) }) }
        : mode === "city" && editOf ? { ask: deleteCityAsk(brandName(profile), cityLabel(editOf, index, profile)), label: "Delete this city", go: () => deleteCity({ brand: editOf.brand, city: editOf.city, profile }, { name: brandName(profile) }) } : null,
      field,
      onChange: (p) => { if (mode === "all") saveDraft(p); drawBar(route); },
      onBuild: (p) => {
        if (mode === "brand") {
          // round 4 #6: with a plan to go back to, the brand's change is tried on that plan first (pendingEdit)
          const was = savedBrand(), next = brandPart(p);
          const to = lastPlan && store.load(lastPlan.brand, lastPlan.city).profile ? lastPlan : null;
          const saved = to && savedProfile(to);
          if (saved && brandName(next) === brandName(was)) {
            const full = withBrand(next, cityPart(saved));
            delete full.sample;
            if (!needsRun(full)) {
              pendingEdit = { to, profile: full, text: changesLine(profileChanges(saved, full, index)) };
              return void router.go("plan", to);
            }
          }
          saveBrand(p);
          return void (location.hash = backTo());
        }
        // the first form saves the brand; a city's form keeps the saved one. A rebuilt profile starts fresh days: no
        // day stays frozen from the last plan (statuses and contacts stay). A city renamed in its form moves.
        if (mode === "all") store.setBrand(brandPart(p));
        const full = withBrand(savedBrand(), cityPart(p));
        const k = keyOf(full);
        // round 4 #6: the same city edited: its plan shows the change first, applies it with Undo (pendingEdit)
        if (mode === "city" && editOf?.city && editOf.city === k.city) {
          const saved = savedProfile(k);
          if (saved && !needsRun(full)) {
            pendingEdit = { to: k, profile: full, text: changesLine(profileChanges(saved, full, index)) };
            return void router.go("plan", k);
          }
        }
        if (editOf?.city && editOf.city !== k.city) store.remove(editOf.brand, editOf.city);
        store.update(k.brand, k.city, (st) => ({ ...st, profile: full, current: null }));
        if (mode === "all") startForm(emptyProfile()); // the first form is done; the next one is a city's
        router.go("plan", k);
      },
    });
    if (standalone() && !store.list().length) noPlansNote(view); // R9 carry: the Home Screen app has its own storage
  } else if (route.name === "demo") {
    // C2: the scripted demo; "Start with my brand" opens #/new pre-filled with the demo profile as the sample brand
    cleanup = renderDemo(view, { index, params: route.params, onHandOff: (p) => { startForm(p); router.go("new"); } });
  } else {
    const token = (show.token = {});
    // L1: a saved live run picked on a resting page goes to the form (its brand and city; a start if the city is new)
    // review6: a live run that ends after the rep has moved on must not paint over the page (its files stay cached)
    // R9 drive mode: &drive=1 opens it (and stays in the address while it's open, so a reload keeps the rep driving)
    const drive = route.params.drive === "1";
    const k = shown && keyOf(shown);
    // round 4 #6: pending: the change a Settings form just saved for this plan; onBrand: its brand fields applied (or
    // undone) in place go to the other cities; onProfile: the header follows the profile
    const c = await renderPlan(view, { index, profile: shown, store, drive, nav: planNav, carry, params: route.params, alive: () => show.token === token, onUse: (p) => { startForm(p); router.go("new"); }, pending: k ? takePending(k) : null, onBrand: k ? (b) => saveBrand(b, { except: k.city }) : null, onProfile: () => drawBar(route), onDelete: k ? () => deleteCity({ ...k, profile: shown }, { name: brandName(shown) }) : null });
    if (show.token === token) cleanup = c; else c();
  }
  view.focus({ preventScroll: true });
}

// "Saved on this device only." (§9.9), or say plainly that nothing is kept
$("#saved-note").textContent = store.persistent ? "Saved on this device only." : "Not saved: this browser blocks storage, so the plan lasts until you close the tab.";

// R9 drive mode: the installed app opens /app?drive=1 (manifest start_url): the latest saved plan, in drive mode.
// R9 carry: &c=<code> (installed from a plan) writes that plan into this storage and opens it; a bad code is ignored.
const carried = await carryIn(store).catch(() => null);
const search = new URLSearchParams(location.search);
if (carried || search.get("drive") === "1") {
  const last = carried ?? store.list()[0];
  // R9 carry2: a browser tab keeps ?drive=1&c= (its manifest, written from it at load, is this plan: ui/carry.js keeps
  // it current); the Home Screen app drops it. Round 8: the Menu's Prepare reloads the plan with ?c= alone (no drive=1):
  // the plan opens as it was, not drive mode; the Home Screen app (standalone) always opens in drive mode.
  const keep = carried && !standalone() ? location.search : "";
  const drive = search.get("drive") === "1" || standalone() ? { drive: "1" } : {};
  history.replaceState(null, "", `/app${keep}${last ? `#/plan?${new URLSearchParams({ brand: last.brand, city: last.city, ...drive })}` : location.hash || "#/new"}`);
} else if (search.has("c")) history.replaceState(null, "", `/app${location.hash}`);
// R9 polish (judge walkthrough 4): a bare /app opens the newest saved plan (the form is #/new, the logo goes home)
else if (!location.hash && store.list()[0]) history.replaceState(null, "", `/app${planHref(store.list()[0].brand, store.list()[0].city)}`);
// R9: the offline shell. Once it's ready, hand it the files this page loaded so the same shell works offline.
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  navigator.serviceWorker.register("/sw.js").then(() => navigator.serviceWorker.ready).then((r) => {
    // the Agent's acknowledgement clips too (lib/ack.js): drive mode plays them between doors, in a dead zone as well
    const urls = [location.origin + "/app", ...performance.getEntriesByType("resource").map((e) => e.name), ...ACK_IDS.map((id) => location.origin + ackPath(id))];
    r.active?.postMessage({ type: "warm", urls });
  }).catch(() => {});
}

let router;
try {
  index = await loadIndex();
  router = createRouter(window, { onRoute: show, guard });
} catch (e) {
  view.innerHTML = `<div class="stub"><div><h2>Doors didn't load</h2><p>${esc(e.message)}</p><a class="btn primary" href="/app#/new">Try again</a></div></div>`;
}
