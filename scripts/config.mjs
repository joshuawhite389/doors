// The precomputed territory: 8 brands × 4 cities, two proxy presets, one preset room.
export const CONFIG = {
  captured: null, // set by build from the raw responses' timestamps
  brands: [
    { key: "athletic-brewing", query: "Athletic Brewing", match: /^Athletic Brewing/i, name: "Athletic Brewing", category: "Non-alcoholic craft beer", na: true },
    { key: "casamigos", query: "Casamigos", match: /^Casamigos$/i, name: "Casamigos", category: "Tequila" },
    { key: "don-julio", query: "Don Julio", match: /^Don Julio$/i, name: "Don Julio", category: "Tequila" },
    { key: "espolon", query: "Espolòn", match: /^Espolon/i, name: "Espolòn", category: "Tequila" },
    { key: "teremana", query: "Teremana", match: /^Teremana/i, name: "Teremana", category: "Tequila" },
    { key: "liquid-death", query: "Liquid Death", match: /^Liquid Death$/i, name: "Liquid Death", category: "Canned water", na: true },
    { key: "lacroix", query: "LaCroix", match: /^La ?Croix/i, name: "LaCroix", category: "Sparkling water", na: true },
    { key: "white-claw", query: "White Claw", match: /^White Claw/i, name: "White Claw", category: "Hard seltzer" },
  ],
  cities: [
    { key: "austin", query: "Austin", name: "Austin", center: [30.2672, -97.7431] },
    { key: "chicago", query: "Chicago", name: "Chicago", center: [41.8781, -87.6298] },
    { key: "boise", query: "Boise", name: "Boise", center: [43.615, -116.2023] },
    { key: "omaha", query: "Omaha", name: "Omaha", center: [41.2565, -95.9345] },
  ],
  ages: {
    "25_34": { label: "25–34", buckets: "25_to_29,30_to_34" },
    "35_44": { label: "35–44", buckets: "35_to_44" },
    "45_54": { label: "45–54", buckets: "45_to_54" },
    under_25: { label: "21–24", buckets: "24_and_younger" }, // r2: every brand (Doors plans 21+ rooms only)
    "55_plus": { label: "55 and over", buckets: "55_and_older" }, // r2
  },
  proxySets: [
    {
      key: "phoebe-glossier-sweetgreen",
      label: "Phoebe Bridgers + Glossier + Sweetgreen",
      items: [
        { key: "phoebe-bridgers", query: "Phoebe Bridgers", type: "urn:entity:artist", match: /^Phoebe Bridgers$/i, weight: 3 },
        { key: "glossier", query: "Glossier", type: "urn:entity:brand", match: /^Glossier$/i, weight: 3 },
        { key: "sweetgreen", query: "Sweetgreen", type: "urn:entity:brand", match: /^sweetgreen$/i, weight: 3 },
      ],
    },
    {
      key: "aldean-basspro-budlight",
      label: "Jason Aldean + Bass Pro Shops + Bud Light",
      items: [
        { key: "jason-aldean", query: "Jason Aldean", type: "urn:entity:artist", match: /^Jason Aldean$/i, weight: 3 },
        { key: "bass-pro-shops", query: "Bass Pro Shops", type: "urn:entity:brand", match: /^Bass Pro/i, weight: 3 },
        { key: "bud-light", query: "Bud Light", type: "urn:entity:brand", match: /^Bud Light$/i, weight: 3 },
      ],
    },
  ],
  rooms: [{ key: "parsons", query: "Parson's Chicken & Fish Logan Square", match: /Parson/i, name: "Parson's Chicken & Fish", where: "Logan Square, Chicago" }],
  extraBrands: [{ key: "patron", query: "Patrón", match: /^Patron Tequila/i, name: "Patrón" }], // day-1 tequila test only
  showcaseTop: 20,
  nbhdPerCity: 5,
};
