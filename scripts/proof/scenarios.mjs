// The proof's fixed scenario set (Cultural Slot Framework §7, owner review 9 R9). Each scenario is a rep's profile
// for a brand Doors holds precomputed Qloo files for (public/data/routes, cities): no network, no live Qloo call.
// Reps and brands are made up (like the Examples); every venue is real. Dates are fixed so a run is reproducible.
// Hard cases are tagged: na (a non-alcoholic alternative), soft (a soft drink, not an alcohol alternative),
// pour (the only signal is a room that already pours the rep: no drinker brand), small (a small city: Boise, Omaha).
import { START_CHIPS, chipStart } from "../../public/lib/profile.js";

const start = (city, key) => chipStart(START_CHIPS[city].find((c) => c.key === key));
// Tue 27 + Wed 28 Oct 2026
const days = (from, to) => [{ date: "2026-10-27", from, to }, { date: "2026-10-28", from, to }];
const drink = (key, name) => [{ key, name, ready: true }];
const PARSONS = { id: "00000000-0000-4000-8000-97464BAD35F5", name: "Parson's Chicken & Fish", where: "Logan Square, Chicago" };

const base = (x) => ({
  v: 1, brand: x.brand, what: x.what, drinks: x.drinks ?? [], pours: x.pours ?? [], city: x.city, rooms: x.rooms, roomsTouched: true,
  start: start(x.city, x.start), windows: days(...(x.hours ?? ["14:00", "19:00"])), visitMin: 25,
  pitch: { price: x.price ?? "", ask: x.ask ?? "", support: x.support ?? [], name: x.name }, known: [], maxPerDay: null, maxByDate: {},
});

// key, tags, cityName, profile
export const SCENARIOS = [
  { key: "na-austin", tags: ["na"], cityName: "Austin", profile: base({ brand: "Tidewell", what: "Non-alcoholic hazy IPA", drinks: drink("athletic-brewing", "Athletic Brewing"), city: "austin", rooms: ["bars", "breweries", "restaurants"], start: "east", price: "$38 a case of 24", support: ["tasting"], name: "Maya Ortiz" }) },
  { key: "na-boise", tags: ["na", "small"], cityName: "Boise", profile: base({ brand: "Tidewell", what: "Non-alcoholic hazy IPA", drinks: drink("athletic-brewing", "Athletic Brewing"), city: "boise", rooms: ["bars", "breweries", "restaurants"], start: "downtown", price: "$38 a case of 24", support: ["tasting"], name: "Maya Ortiz" }) },
  { key: "na-austin-ld", tags: ["na"], cityName: "Austin", profile: base({ brand: "Tidewell", what: "Non-alcoholic hazy IPA", drinks: drink("liquid-death", "Liquid Death"), city: "austin", rooms: ["bars", "breweries", "restaurants"], start: "east", price: "$38 a case of 24", support: ["tasting"], name: "Maya Ortiz" }) },
  { key: "mezcal-chicago", tags: [], cityName: "Chicago", profile: base({ brand: "Brasa Verde", what: "Small-batch mezcal", drinks: drink("casamigos", "Casamigos"), city: "chicago", rooms: ["bars", "restaurants"], start: "wicker", hours: ["16:00", "21:00"], price: "$420 a case of 12", ask: "a mezcal cocktail on the list", support: ["tasting", "menu"], name: "Dana Ruiz" }) },
  { key: "mezcal-omaha", tags: ["small"], cityName: "Omaha", profile: base({ brand: "Brasa Verde", what: "Small-batch mezcal", drinks: drink("casamigos", "Casamigos"), city: "omaha", rooms: ["bars", "restaurants"], start: "oldmarket", hours: ["16:00", "21:00"], price: "$420 a case of 12", ask: "a mezcal cocktail on the list", support: ["tasting", "menu"], name: "Dana Ruiz" }) },
  { key: "mezcal-chicago-dj", tags: [], cityName: "Chicago", profile: base({ brand: "Brasa Verde", what: "Small-batch mezcal", drinks: drink("don-julio", "Don Julio"), city: "chicago", rooms: ["bars", "restaurants"], start: "wicker", hours: ["16:00", "21:00"], price: "$420 a case of 12", ask: "a mezcal cocktail on the list", support: ["tasting", "menu"], name: "Dana Ruiz" }) },
  { key: "soft-chicago", tags: ["soft"], cityName: "Chicago", profile: base({ brand: "Larkspur Fizz", what: "Botanical sparkling water", drinks: drink("lacroix", "LaCroix"), city: "chicago", rooms: ["bars", "restaurants", "cafes"], start: "loop", hours: ["11:00", "16:00"], price: "$30 a case of 24", support: ["samples"], name: "Tom Lindqvist" }) },
  { key: "soft-boise", tags: ["soft", "small"], cityName: "Boise", profile: base({ brand: "Hushwater", what: "Canned mountain spring water", drinks: drink("liquid-death", "Liquid Death"), city: "boise", rooms: ["bars", "restaurants", "cafes"], start: "downtown", hours: ["11:00", "16:00"], price: "$28 a case of 24", support: ["samples"], name: "Jess Okafor" }) },
  { key: "pour-austin", tags: ["pour"], cityName: "Austin", profile: base({ brand: "Hollow Oak", what: "Dry craft cider", pours: [PARSONS], city: "austin", rooms: ["bars", "breweries", "restaurants"], start: "soco", hours: ["15:00", "20:00"], price: "$44 a case of 24", ask: "a cider on draft for a month", support: ["tasting"], name: "Ben Adler" }) },
  { key: "pour-omaha", tags: ["pour", "small"], cityName: "Omaha", profile: base({ brand: "Hollow Oak", what: "Dry craft cider", pours: [PARSONS], city: "omaha", rooms: ["bars", "breweries", "restaurants"], start: "benson", hours: ["15:00", "20:00"], price: "$44 a case of 24", ask: "a cider on draft for a month", support: ["tasting"], name: "Ben Adler" }) },
  { key: "seltzer-omaha", tags: ["small"], cityName: "Omaha", profile: base({ brand: "Saltmarsh", what: "Hard seltzer", drinks: drink("white-claw", "White Claw"), city: "omaha", rooms: ["bars", "breweries", "restaurants"], start: "benson", price: "$40 a case of 24", support: ["samples", "tasting"], name: "Kayla Brooks" }) },
  { key: "tequila-austin", tags: [], cityName: "Austin", profile: base({ brand: "Cielo Alto", what: "Añejo tequila", drinks: drink("don-julio", "Don Julio"), city: "austin", rooms: ["bars", "restaurants"], start: "downtown", hours: ["15:00", "20:00"], price: "$540 a case of 12", support: ["tasting"], name: "Luis Navarro" }) },
];

// Swap pairs: the same brand and product, one thing changed. kind: "city" (same drinker, another city) or "audience"
// (same city, another drinker signal).
export const SWAPS = [
  ["na-austin", "na-boise", "city"],
  ["mezcal-chicago", "mezcal-omaha", "city"],
  ["pour-austin", "pour-omaha", "city"],
  ["na-austin", "na-austin-ld", "audience"],
  ["mezcal-chicago", "mezcal-chicago-dj", "audience"],
];

export const byKey = (k) => SCENARIOS.find((s) => s.key === k);
