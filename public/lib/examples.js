// The form's Examples row (owner review 6, L2): one made-up rep and brand per drinker brand Doors has fetched, plus one
// for "rooms that already pour you" (N3: Parson's, a Chicago room, as the signal for Austin), each in a city it holds, so a visitor can fill the form in one click and
// build. Maya is the guided demo's profile. The people and brands are made up; every bar and restaurant is real. Dated from today
// like sampleProfile / demoProfile. Also the city field's words → the profile's city (any city; the fetched ones by
// name). Pure: no DOM, no fetch. Covered by test/examples.test.mjs.
import { emptyProfile, emptyProduct, isoDate, chipStart, START_CHIPS, citySlug } from "./profile.js";
import { demoProfile, PERSONA } from "./demo-profile.js";

const chip = (city, key) => chipStart(START_CHIPS[city].find((c) => c.key === key));
const drink = (key, name) => [{ key, name, ready: true }];
// Doors' preset room (index.json rooms): one room alone in a held city reads its fetched files (lib/live.js)
const PARSONS = { id: "00000000-0000-4000-8000-97464BAD35F5", name: "Parson's Chicken & Fish", where: "Logan Square, Chicago" };

// days: [weekday (0 = Sunday), …] in the coming week, the first one strictly after today; hours per day.
export const EXAMPLES = [
  { key: "maya", name: "Maya Ortiz", brand: "Tidewell", what: "non-alcoholic hazy IPA", city: "austin" },
  {
    key: "dana", name: "Dana Ruiz", brand: "Brasa Verde", what: "Small-batch mezcal", city: "chicago", drinks: drink("casamigos", "Casamigos"),
    rooms: ["bars", "restaurants"], start: "wicker", days: [3, 4], hours: ["16:00", "21:00"], visitMin: 30,
    product: { format: "bottles", size: "750 ml", abv: "45%", sells: "self" },
    pitch: { price: "$420 a case of 12", ask: "a mezcal cocktail on the list", support: ["tasting", "menu"], name: "Dana" },
  },
  {
    key: "luis", name: "Luis Navarro", brand: "Cielo Alto", what: "Añejo tequila", city: "austin", drinks: drink("don-julio", "Don Julio"),
    rooms: ["bars", "restaurants"], start: "downtown", days: [4, 5], hours: ["15:00", "20:00"], visitMin: 30,
    product: { format: "bottles", size: "750 ml", abv: "40%", sells: "distributor" },
    pitch: { price: "$540 a case of 12", ask: "an añejo flight on the back bar", support: ["tasting"], name: "Luis" },
  },
  {
    key: "priya", name: "Priya Shah", brand: "Paloma Lane", what: "Canned tequila paloma", city: "boise", drinks: drink("espolon", "Espolòn"),
    rooms: ["bars", "restaurants"], start: "linen", days: [2, 3], hours: ["14:00", "19:00"], visitMin: 20,
    product: { format: "cans", size: "12 oz", abv: "5%", sells: "self" },
    pitch: { price: "$46 a case of 24", ask: "a case in the cooler for the patio", support: ["samples", "menu"], name: "Priya" },
  },
  {
    key: "marcus", name: "Marcus Bell", brand: "Ridgeline", what: "Reposado tequila", city: "omaha", drinks: drink("teremana", "Teremana"),
    rooms: ["bars", "restaurants"], start: "oldmarket", days: [3, 4], hours: ["15:00", "20:00"], visitMin: 25,
    product: { format: "bottles", size: "750 ml", abv: "40%", sells: "distributor" },
    pitch: { price: "$360 a case of 12", ask: "a reposado on the rail", support: ["tasting", "menu"], name: "Marcus" },
  },
  {
    key: "jess", name: "Jess Okafor", brand: "Hushwater", what: "Canned mountain spring water", city: "boise", drinks: drink("liquid-death", "Liquid Death"),
    rooms: ["bars", "restaurants", "cafes"], start: "downtown", days: [4, 5], hours: ["11:00", "16:00"], visitMin: 20,
    product: { format: "cans", size: "16.9 oz", na: true, sells: "self" },
    pitch: { price: "$28 a case of 24", ask: "a row in the grab-and-go fridge", support: ["samples"], name: "Jess" },
  },
  {
    key: "tom", name: "Tom Lindqvist", brand: "Larkspur Fizz", what: "Botanical sparkling water", city: "chicago", drinks: drink("lacroix", "LaCroix"),
    rooms: ["restaurants", "cafes"], start: "loop", days: [2, 3], hours: ["11:00", "15:00"], visitMin: 20,
    product: { format: "cans", size: "12 oz", na: true, sells: "self" },
    pitch: { price: "$30 a case of 24", ask: "one flavour on the menu as a zero-proof option", support: ["samples", "menu"], name: "Tom" },
  },
  {
    key: "kayla", name: "Kayla Brooks", brand: "Saltmarsh", what: "Hard seltzer", city: "omaha", drinks: drink("white-claw", "White Claw"),
    rooms: ["bars", "breweries", "restaurants"], start: "benson", days: [5, 6], hours: ["14:00", "19:00"], visitMin: 25,
    product: { format: "cans", size: "12 oz", abv: "5%", sells: "distributor" },
    pitch: { price: "$40 a case of 24", ask: "a case of cans for the weekend", support: ["samples", "tasting"], name: "Kayla" },
  },
  {
    key: "ben", name: "Ben Adler", brand: "Hollow Oak", what: "Dry craft cider", city: "austin", pours: [PARSONS],
    rooms: ["bars", "breweries", "restaurants"], start: "soco", days: [3, 4], hours: ["15:00", "20:00"], visitMin: 25,
    product: { format: "keg", size: "sixtel", abv: "6.2%", sells: "self" },
    pitch: { price: "$165 a sixtel, $44 a case of 24", ask: "a cider on draft for a month", support: ["tasting"], name: "Ben" }, // persona MUST #2: a keg price for the draft ask
  },
];

const CITY_NAMES = { austin: "Austin", boise: "Boise", chicago: "Chicago", omaha: "Omaha" };

// The next day with this weekday strictly after `today`, then each later weekday in `days` after that one.
function datesFor(days, today) {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  do d.setDate(d.getDate() + 1); while (d.getDay() !== days[0]);
  return days.map((wd) => {
    const x = new Date(d);
    while (x.getDay() !== wd) x.setDate(x.getDate() + 1);
    return isoDate(x);
  });
}

function build(x, today) {
  if (x.key === "maya") { const p = demoProfile(today); delete p.week.ahead; return { ...p, sample: true }; } // the form plans her usual week two weeks ahead; the tour plans one
  return {
    ...emptyProfile(),
    sample: x.key,
    brand: x.brand,
    what: x.what,
    drinks: x.drinks ? x.drinks.map((d) => ({ ...d })) : [],
    pours: (x.pours ?? []).map((r) => ({ ...r })),
    city: x.city,
    rooms: [...x.rooms],
    roomsTouched: true,
    start: chip(x.city, x.start),
    windows: datesFor(x.days, today).map((date) => ({ date, from: x.hours[0], to: x.hours[1] })),
    visitMin: x.visitMin,
    product: (({ sells, ...rest }) => ({ ...emptyProduct(), ...rest }))(x.product), // r2: how you sell is the city's
    sells: x.product.sells ? [x.product.sells] : [],
    pitch: { ...x.pitch, support: [...x.pitch.support] },
    known: [],
  };
}

// → [{key, name, brand, label: "Dana Ruiz · Brasa Verde (small-batch mezcal) · Chicago", profile}]
export function examples(today = new Date()) {
  return EXAMPLES.map((x) => ({ key: x.key, name: x.name, brand: x.brand, label: `${x.name} · ${x.brand} (${x.what[0].toLowerCase()}${x.what.slice(1)}) · ${CITY_NAMES[x.city]}`, profile: build(x, today) }));
}

// The example a profile's `sample` flag names (true: Maya, the guided demo's hand-off), or null.
export function exampleOf(flag, today = new Date()) {
  const key = flag === true ? "maya" : flag;
  return examples(today).find((x) => x.key === key) ?? null;
}

// "Tidewell and Maya are made up; every bar and restaurant is real." (the demo's words), and the same for the others.
export const fictionLine = (x) => `${x.brand} and ${x.key === "maya" ? PERSONA.name.split(" ")[0] : x.name.split(" ")[0]} are made up; every bar and restaurant is real.`;

// ---------- the city field: any city ----------
const tidy = (s) => s.trim().replace(/\s+/g, " ").replace(/\s*,\s*/g, ", ");
// What the rep typed → {city: key} for a fetched city ("Austin", "austin, tx", "Austin TX"), else the city as typed:
// {city: "denver-co", cityName: "Denver, CO", cityLive: true} (owner review 6 contract); "" → {city: ""}.
export function cityFromText(text, cities = []) {
  const name = tidy(String(text ?? ""));
  if (!name) return { city: "" };
  const t = name.toLowerCase();
  const hit = cities.find((c) => { const n = c.name.toLowerCase(); return t === n || (t.startsWith(n) && /^(,.*|\s[a-z]{2})$/.test(t.slice(n.length))); });
  return hit ? { city: hit.key } : { city: citySlug(name), cityName: name, cityLive: true }; // one slug (lib/profile.js)
}
// A profile's city in words, for the field.
export const cityText = (p, cities = []) => (p.cityLive ? p.cityName ?? p.city : cities.find((c) => c.key === p.city)?.name ?? p.city ?? "");
