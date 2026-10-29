// WHY-VIZ-SPEC §6 the week view: picture 2's clouds under the week's loops, so a day that leaves the wash looks wrong
// before the miles say so. The same model as the Why drawer's picture 2 (lib/whyviz/areas.js over lib/sieve.js), the
// same wash (ui/whyviz/areas.js paintAreas) with its hover and no pills; painted by plan.js when the Week tab is up
// and the Why drawer is closed (the drawer paints its own, with pills, and clears them when it hides).
import { getJSON, loadCityBase } from "./data.js";
import { sieve } from "../lib/sieve.js";
import { mergedRoute } from "../lib/crowds.js";
import { areasModel } from "../lib/whyviz/areas.js";
import { paintAreas, clearAreas } from "./whyviz/areas.js";

const keyOf = (plan, famous) => JSON.stringify([plan.city?.key, (plan.days ?? []).map((d) => d?.stops?.map((s) => s.id) ?? []), plan.pool?.ids?.length, !!famous]);

// paintWeekClouds(map, {plan, routes, profile, famous, hoods, cityKey, cityName, still}): loads what it needs once per
// city (getJSON caches), builds the model and paints; still() is asked after each await (the tab may have changed).
// pills + onTap (round 5 #2b): the plan map's Neighbourhoods toggle draws the drawer's full picture (named pills, a tap
// opens the drawer on that area) on any tab; the Week tab alone keeps the wash.
export async function paintWeekClouds(map, { plan, routes = [], profile, famous = false, hoods = null, cityKey, cityName, still = () => true, pills = false, onTap = null }) {
  if (!map || !plan?.days?.length) return null;
  const st = (map.__weekClouds ??= { key: null, model: null });
  const key = keyOf(plan, famous);
  let model = st.key === key ? st.model : null;
  if (!model) {
    const [city, base] = await Promise.all([getJSON(`/data/cities/${cityKey}.json`).catch(() => null), loadCityBase(cityKey).catch(() => null)]);
    if (!still()) return null;
    try {
      const route = mergedRoute(routes, { famous });
      const venues = { ...(route?.venues ?? {}), ...(plan.venues ?? {}) };
      const sv = sieve({ route, plan, profile, famous, city });
      model = areasModel({ places: [...sv.dots, ...sv.extras], venues, hoods, base: base ?? { ids: [], venues: {} }, poolIds: plan.pool?.ids ?? [], cityName });
    } catch (e) { console.error(e); return null; }
    st.key = key;
    st.model = model;
  }
  paintAreas(map, model, { pills, onTap, owner: "week" });
  return model;
}
export function clearWeekClouds(map) {
  if (map?.__wvAreas && map.__wvAreas.owner === "week") clearAreas(map); // never the drawer's own clouds
}
