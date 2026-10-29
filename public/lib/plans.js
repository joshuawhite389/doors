// "My cities" (group 3 #5, was "Your plans"): the brand's saved cities as rows for the list, and the app's links.
// Pure (no DOM, no storage): covered by test/plans.test.mjs. The rows come from store.list().
import { hrefFor } from "./router.js";
import { niceDate, isoDate } from "./profile.js";
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
