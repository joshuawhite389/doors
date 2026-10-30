// "My cities" (group 3 #5, was "Your plans"): the brand's saved cities as rows for the list, and the app's links.
// Pure (no DOM, no storage): covered by test/plans.test.mjs. The rows come from store.list().
import { hrefFor } from "./router.js";
import { niceDate, isoDate, withBrand } from "./profile.js";
import { DAYS } from "./core.js";
import { withoutStarts } from "./week.js";

// A saved city's links: open its plan, edit its days and start. The brand's own form, the list, a new city.
export const planHref = (brand, city) => hrefFor("plan", { brand, city });
export const editHref = (brand, city) => hrefFor("city", { city });
export const BRAND_HREF = hrefFor("brand");
export const CITIES_HREF = hrefFor("cities");
export const ADD_CITY = hrefFor("city");
export const DEMO_EDIT = hrefFor("edit", { demo: 1 }); // the demo's plan: Maya's profile as the sample brand

// The app's logo: the landing (judge pass 4, N17: the landing no longer redirects, so ?home only marks where it came from).
export const HOME_HREF = "/?home=1";

// store.list() row → what the list shows: "Tidewell" / "Austin" / "3 days · Tue Oct 13 – Thu Oct 15" / "Opened Oct 9".
// A usual week (lib/week.js) reads "Every Tue, Wed, Thu".
export function planRow(row, cities = []) {
  const name = row.profile?.brand?.trim() || row.brand;
  const city = cities.find((c) => c.key === row.city)?.name ?? row.profile?.cityName ?? row.city; // L1: a live city by its name
  const usual = DAYS.filter((d) => row.profile?.week?.days?.[d]).map((d) => `${d[0].toUpperCase()}${d.slice(1, 3)}`);
  const days = usual.length ? `Every ${usual.join(", ")}` : !row.days ? "No days set" : `${row.days} ${row.days === 1 ? "day" : "days"} · ${niceDate(row.from)}${row.to !== row.from ? ` – ${niceDate(row.to)}` : ""}`;
  const opened = row.savedAt ? `Opened ${niceDate(isoDate(new Date(row.savedAt))).replace(/^\w+ /, "")}` : "";
  return { id: `${row.brand}\u0000${row.city}`, name, city, days, opened, open: planHref(row.brand, row.city), edit: editHref(row.brand, row.city) };
}

// The phone's Duplicate (app-mobile Form.tsx; the web has "Add a city" instead, group 3 #5): the same brand for a new
// city. Everything tied to the old city goes (the city, the start, each day's own start, doors already known there).
export function copyProfile(p) {
  const out = structuredClone(p);
  delete out.sample;
  out.city = "";
  delete out.cityName; // L1: a live city's name and centre go with it
  delete out.cityLive;
  delete out.cityCenter;
  out.start = null;
  out.known = [];
  out.windows = (out.windows ?? []).map(({ start, ...w }) => w);
  if (out.week) out.week = withoutStarts(out.week); // the usual week keeps its hours, not its days' own starts
  return out;
}

// Delete (Jard 10-29: "i need a way to delete profiles/ brands/ cities that i've made"). store.list() rows → one group
// per brand, the saved brand first (it shows even with no city left), then the others newest first. Each group:
// {brand (the store's key name), name (as typed), saved, rows}.
const brandSlug = (s) => String(s ?? "").trim().toLowerCase();
export function groupPlans(rows, savedBrand = null) {
  const savedKey = savedBrand ? String(savedBrand.brand ?? "").trim() || "my brand" : null;
  const groups = [];
  const at = new Map();
  if (savedKey) at.set(brandSlug(savedKey), groups[groups.push({ brand: savedKey, name: savedBrand.brand?.trim() || "My brand", saved: true, rows: [] }) - 1]);
  for (const r of rows) {
    const k = brandSlug(r.brand);
    if (!at.has(k)) at.set(k, groups[groups.push({ brand: r.brand, name: r.profile?.brand?.trim() || r.brand, saved: false, rows: [] }) - 1]);
    at.get(k).rows.push(r);
  }
  return groups;
}

// What a delete asks, and what it says after (plain words; "on this device" as the footer says).
const citiesWord = (n) => `${n} ${n === 1 ? "city" : "cities"}`;
export const deleteCityAsk = (name, city) => `Delete ${name} in ${city}? Its plan, visits and notes on this device go too.`;
export const deleteBrandAsk = (name, n) => n ? `Delete ${name} and its ${citiesWord(n)}? Their plans, visits and notes on this device go too.` : `Delete ${name}? Its rules on this device go too.`;
export const deletedCity = (name, city) => `Deleted ${name} in ${city}.`;
export const deletedBrand = (name, n) => (n ? `Deleted ${name} and its ${citiesWord(n)}.` : `Deleted ${name}.`);

// Edit my brand saved: the brand's fields (next) written into every city OF THAT BRAND (was: the saved brand before the
// save), a new name moving each of them, and the brand's rules, to its key. Every one of those cities re-plans from
// fresh days (statuses, outcomes and contacts stay). Another brand's cities on the same device are never touched (gigbot
// 10-29: Jard's phone holds two brands; an edit of one wrote its name into the other's cities). except: a city of the
// brand whose plan already applied the change in place (round 4 #6). store: lib/store.js (or a wrapper of it).
export function applyBrand(store, next, was, { except = null } = {}) {
  const name = (x) => String(x?.brand ?? "").trim() || "my brand";
  const same = (a, b) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();
  store.setBrand(next);
  if (!was) return next;
  for (const row of store.list()) {
    if (!same(row.brand, name(was)) || (except && row.city === except)) continue;
    const k = { brand: name(next), city: row.city };
    const st = store.load(row.brand, row.city);
    const merged = withBrand(next, row.profile);
    if (k.brand === row.brand) store.update(row.brand, row.city, (s) => ({ ...s, profile: merged, current: null }));
    else { store.save(k.brand, k.city, { ...st, profile: merged, current: null }); store.remove(row.brand, row.city); }
  }
  if (name(was) !== name(next)) {
    const rules = store.getRules(name(was));
    if (rules.length) { store.setRules(name(next), [...store.getRules(name(next)), ...rules]); store.setRules(name(was), []); }
  }
  return next;
}
