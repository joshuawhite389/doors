// The CURATED pre-warm set, and nothing else (Jard 10-27: none of his own test runs may be a saved run). Pure: no key,
// no call, no file; scripts/prewarm.mjs runs it and test/prewarm-set.test.mjs checks that every file in data/prewarm
// (the publish set) is one of these combos.
// The demo set. Brands as a rep would search them; `held`: a brand Doors already holds (its id and NA flag come from
// public/data/index.json, as the page sends them). Cities as the form sends them: a held city by its query ("Chicago"),
// any other as typed ("Denver, CO"); each run is also kept under Qloo's own name for the city. "New York City", not
// "New York, NY": Qloo reads the latter as the state (the agent refuses a state).
export const BRANDS = [
  { q: "Modelo Especial" }, { q: "Michelob Ultra" }, { q: "Guinness" }, { q: "Stella Artois" }, { q: "Coors Light" },
  { q: "Heineken" }, { q: "High Noon" }, { q: "Truly Hard Seltzer" }, { q: "Tito's Handmade Vodka" }, { q: "Jameson" },
  { q: "Aperol" }, { q: "Topo Chico" }, { held: "athletic-brewing" }, { held: "liquid-death" }, { held: "white-claw" },
];
export const CITIES = ["New York City", "Los Angeles, CA", "Chicago", "Houston, TX", "Dallas, TX", "Austin", "Denver, CO", "Nashville, TN", "Miami, FL", "Seattle, WA", "San Diego, CA", "Boston, MA", "Atlanta, GA", "Phoenix, AZ"];
export const HELD_CITIES = new Set(["Chicago", "Austin"]); // with a held brand there, the page reads the fetched files: no run
export const PER_BRAND = 8; // each brand in 8 of the 14 cities, rotated so every city gets 8–9 brands

export function combos() {
  const out = [];
  BRANDS.forEach((b, i) => {
    for (let j = 0; j < CITIES.length; j++) {
      if ((i + j) % CITIES.length >= PER_BRAND) continue;
      if (b.held && HELD_CITIES.has(CITIES[j])) continue;
      out.push({ brand: b, city: CITIES[j] });
    }
  });
  return out.slice(0, 150);
}
