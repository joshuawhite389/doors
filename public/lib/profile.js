// The brand profile (SPEC-V2 §3.2): rooms to pitch, the "what you make" keyword map, windows and validation.
// Pure: no DOM, no fetch.
import { genreLabel, km, DAYS, AGE_DIAL } from "./core.js";
import { productKind, NA_WORD, defaultAsk } from "./talk.js";
import { weekDates, DATE_RE as WEEK_DATE } from "./week.js";

// US states by their postal code (the city list, and the Worker's check of how Qloo read a typed "City, ST")
export const STATE_NAMES = { AL: "alabama", AK: "alaska", AZ: "arizona", AR: "arkansas", CA: "california", CO: "colorado", CT: "connecticut", DE: "delaware",
  DC: "district of columbia", FL: "florida", GA: "georgia", HI: "hawaii", ID: "idaho", IL: "illinois", IN: "indiana", IA: "iowa", KS: "kansas",
  KY: "kentucky", LA: "louisiana", ME: "maine", MD: "maryland", MA: "massachusetts", MI: "michigan", MN: "minnesota", MS: "mississippi",
  MO: "missouri", MT: "montana", NE: "nebraska", NV: "nevada", NH: "new hampshire", NJ: "new jersey", NM: "new mexico", NY: "new york",
  NC: "north carolina", ND: "north dakota", OH: "ohio", OK: "oklahoma", OR: "oregon", PA: "pennsylvania", RI: "rhode island", SC: "south carolina",
  SD: "south dakota", TN: "tennessee", TX: "texas", UT: "utah", VT: "vermont", VA: "virginia", WA: "washington", WV: "west virginia",
  WI: "wisconsin", WY: "wyoming", PR: "puerto rico" };

export const ROOMS = [
  { key: "bars", label: "Bars", phrase: "bars" },
  { key: "breweries", label: "Breweries & taprooms", phrase: "breweries" },
  { key: "restaurants", label: "Restaurants with a bar", phrase: "restaurants" },
  { key: "cafes", label: "Coffee & cafés", phrase: "cafés", naOnly: true },
  { key: "wine", label: "Wine bars", phrase: "wine bars" },
];
const ROOM_KEYS = ROOMS.map((r) => r.key);

// Which "Rooms to pitch" chip a venue belongs to, from its Qloo genre (core.genreLabel) and, with no genre, its name.
export function roomOf(v) {
  const g = genreLabel(v).toLowerCase();
  if (/wine bar|winery/.test(g)) return "wine";
  if (/brew|beer hall|taproom|cider/.test(g)) return "breweries";
  if (/\bcafe\b|café|coffee|creperie|pastry|tea house/.test(g)) return "cafes";
  if (/bar and grill|poke bar|tapas|gastropub|sushi/.test(g)) return "restaurants";
  if (/\bbar\b|\bpub\b|lounge|club|tavern|saloon|music venue|event venue/.test(g)) return "bars";
  if (!g) return /\b(bar|pub|tavern|saloon|lounge)\b/i.test(v?.name ?? "") ? "bars" : "restaurants";
  // judge pass 4 (#12): a stand or takeaway counter, or a fast-food room Qloo sees no drinks list at, is no "restaurant
  // with a bar" (Flub A Dub Chub's hot-dog stand, Wingstop): "quick", a room type no one pitches (not in ROOMS)
  if (/\bstand\b|takeaway|delivery/.test(g)) return "quick";
  // phone live run (Ridgeline × Denver): a hotel is a room only when Qloo shows drinks there: a drinks tag, or a bar,
  // lounge or on-site dining in its description or name (Hotel Indigo's "on-site restaurant and bar", Fairmont's
  // "multiple dining options"; a coffee bar is no bar). Else "hotel" (rooms and event space only), pitched by no one
  if (/\bhotel\b/.test(g) && !(v?.tags?.bev ?? []).length && !/\b(?<!coffee |juice |espresso |salad |snack )(bar|lounge)s?\b|\b(dining|restaurants?|bistro|brasserie|pub|tavern)\b/i.test(`${v?.description ?? ""} ${v?.name ?? ""}`)) return "hotel";
  const t = v?.tags;
  if (t && [...(t.interests ?? []), ...(t.ambience ?? []), ...(t.visit ?? [])].some((x) => /^(fast food|quick service)\b/i.test(x)) && !(t.bev ?? []).some((b) => /beer|wine|cocktail|spirit|liquor|margarita/i.test(b))) return "quick";
  return "restaurants";
}
// what roomOf's "quick" is called where a reason names it
export const QUICK_ROOM = { label: "counter-service spots", a: "a counter-service spot" };
export const HOTEL_ROOM = { label: "hotels with no bar Qloo can see", a: "a hotel with no bar Qloo can see" };

// Reads as a non-alcoholic alternative to a drink ("Non-alcoholic hazy IPA", "NA gin", "zero-proof spritz"). A soft
// drink (sparkling water, soda, coffee, tea, kombucha…: talk.js kind "soft") is not one, even when its name says
// "non-alcoholic" (owner review 8 N2): it gets no NA framing and no NA facts.
export function isNA(what) {
  const w = String(what ?? "");
  return NA_WORD.test(w) && productKind(w) !== "soft";
}
// A soft drink (see isNA): cafés are among its rooms, like an NA product's.
export const isSoft = (what) => productKind(what) === "soft";
const noAlcohol = (what) => isNA(what) || isSoft(what);

// "What you make" → the default Rooms to pitch. The user can change the chips; this only sets the starting point.
export function defaultRooms(what) {
  const t = String(what ?? "").toLowerCase();
  if (/\bwine|ros[eé]\b|prosecco|champagne|\bsake\b|vermouth/.test(t)) return ["restaurants", "wine"];
  if (/beer|\bipa\b|lager|\bales?\b|stout|pils|porter|\bsour\b|seltzer|cider/.test(t)) return ["bars", "breweries", "restaurants"];
  if (/tequila|mezcal|\bgin\b|vodka|whisk|bourbon|\brum\b|spirit|liqueur|amaro|aperitif|cocktail|\brtd\b|ready[- ]to[- ]drink/.test(t)) return ["bars", "restaurants"];
  if (noAlcohol(t)) return ["bars", "restaurants", "cafes"];
  return ["bars", "restaurants"];
}

// Rooms the user may pick: the café chip is for NA products and soft drinks only.
export function roomChoices(what) {
  return ROOMS.filter((r) => !r.naOnly || noAlcohol(what));
}

// ["bars","breweries","restaurants"] → "bars, breweries and restaurants" (in ROOMS order).
export function roomsPhrase(rooms) {
  const p = ROOMS.filter((r) => rooms.includes(r.key)).map((r) => r.phrase);
  if (p.length <= 1) return p[0] ?? "rooms";
  if (p.length === 2) return `${p[0]} and ${p[1]}`;
  return `${p.slice(0, -1).join(", ")} and ${p.at(-1)}`;
}

// ---------- windows ----------
const pad = (n) => String(n).padStart(2, "0");
export const isoDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
// "2026-10-13" → "tuesday" (local calendar date, no time zone shift)
export function dayOf(date) {
  const [y, m, d] = String(date).split("-").map(Number);
  const js = new Date(y, m - 1, d).getDay(); // 0 = Sunday
  return DAYS[(js + 6) % 7];
}
// The next n weekdays after `from` (tomorrow onwards): [{date, day, label:"Tue 13"}].
export function nextWeekdays(from, n = 5) {
  const out = [];
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  while (out.length < n) {
    d.setDate(d.getDate() + 1);
    const js = d.getDay();
    if (js === 0 || js === 6) continue;
    const day = DAYS[(js + 6) % 7];
    out.push({ date: isoDate(d), day, label: `${day[0].toUpperCase()}${day.slice(1, 3)} ${d.getDate()}` });
  }
  return out;
}
// A date chip on the profile (judge pass 4, 18): "Thu 29" like the day strip's chips while the day number can't be
// mistaken (under four weeks out), else with its month, as dates read elsewhere ("Thu Dec 3"). date: "YYYY-MM-DD".
export function dayChip(date, today = new Date()) {
  const d = new Date(`${date}T12:00`);
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12);
  const day = DAYS[(d.getDay() + 6) % 7];
  const dow = `${day[0].toUpperCase()}${day.slice(1, 3)}`;
  return Math.abs(d - t) < 27 * 864e5 ? `${dow} ${d.getDate()}` : `${dow} ${d.toLocaleString("en-US", { month: "short" })} ${d.getDate()}`;
}
// The day strip on the profile: `from` itself and the n − 1 days after it, weekends included:
// [{date, day, label:"Fri 9"}].
export function nextDays(from, n = 7) {
  return Array.from({ length: n }, (_, k) => {
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + k);
    const day = DAYS[(d.getDay() + 6) % 7];
    return { date: isoDate(d), day, label: `${day[0].toUpperCase()}${day.slice(1, 3)} ${d.getDate()}` };
  });
}
// "2026-10-15" → "Thu Oct 15": every date a person reads (R2 Calacanis 15); ISO stays in the CSV and the data.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function niceDate(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date ?? ""));
  if (!m) return String(date ?? "");
  const day = dayOf(date);
  return `${day[0].toUpperCase()}${day.slice(1, 3)} ${MONTHS[+m[2] - 1]} ${+m[3]}`;
}
// "14:30" → 870; anything else → null
export function toMinutes(hhmm) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm ?? ""));
  if (!m) return null;
  const h = +m[1];
  const mi = +m[2];
  return h < 24 && mi < 60 ? h * 60 + mi : null;
}
// 870 → "2:30 pm"
export function clock12(min) {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  return `${h % 12 || 12}:${pad(m % 60)} ${h < 12 ? "am" : "pm"}`;
}

// ---------- the profile ----------
export const MAX_DRINKS = 3;
export const START_MAX_KM = 80; // a start further than this from the city centre is a mistake, not a plan
// Judge pass 6 (#4): "Clear the form" shows only when there is something to clear (the phone's Form.tsx test, 3fc22c1).
export const formFilled = (p) => Boolean(p?.brand || p?.what || p?.drinks?.length || p?.pours?.length || p?.city || p?.start);
export function emptyProfile() {
  return {
    v: 1,
    brand: "",
    what: "",
    drinks: [], // [{key?, name, ready:true}] precomputed, or [{id, name, ready:false}] a live Qloo brand
    pours: [], // N3: "Rooms that already pour you (any city)": [{id, name, where}] Qloo places, up to MAX_POURS
    city: "",
    rooms: defaultRooms(""),
    roomsTouched: false,
    start: null, // {label, lat, lon}
    windows: [], // [{date:"2026-10-13", from:"14:00", to:"18:00", start?:{label, lat, lon, source}}] (start = that day's own)
    week: null, // the usual week, repeating (lib/week.js; the form sets one up); windows = its dated days this week and next
    visitMin: 25,
    // group 3 #4 (Jard 10-24): the product (format required; price per case is pitch.price) and, optional, the drinkers
    product: emptyProduct(),
    drinkers: emptyDrinkers(),
    pitch: { price: "", ask: "", support: [], name: "" }, // §3.2 field 8: support = keys of SUPPORT; name signs the notes (C1), required (N1); ask required (group 3 #4)
    known: [], // §3.2 field 9 (optional): ids of ranked rooms already talked to (read as status "talked")
    maxPerDay: null, // J2 (owner review 5): the most doors a day, 1–20; null = no cap (set on the plan, and on the form since judge 4)
    maxByDate: {}, // J2: a day's own cap, {"2026-10-13": 5}, beating maxPerDay
  };
}

// ---------- the product and its drinkers (group 3 #4, Jard 10-24) ----------
// The shape other code reads (talking points, the Agent): profile.product {format, formatOther, size, abv, na, sells},
// the price per case in profile.pitch.price (lib/ask.js turns it into the margin line), and profile.drinkers {who,
// age, where, basis}. Use productFacts / productLine / drinkersLine rather than reading the fields raw.
export const FORMATS = [
  { key: "cans", label: "Cans" },
  { key: "bottles", label: "Bottles" },
  { key: "keg", label: "Keg" },
  { key: "other", label: "Other" },
];
export const SELLS = [
  { key: "self", label: "Self-distributed", phrase: "self-distributed" },
  { key: "distributor", label: "Through a distributor", phrase: "through a distributor" },
];
// The drinkers' age range: the bands Qloo can narrow a door list by (core.AGE_DIAL; every fetched list holds them).
// r2 (Jard 10-24): 21–24 (Qloo's "24 and younger"; Doors plans 21+ rooms only) through 55 and over, for every drink.
export const AGE_RANGES = Object.entries(AGE_DIAL).filter(([, a]) => a.buckets).map(([key, a]) => ({ key, label: a.label, naOnly: Boolean(a.naOnly) }));
// r2 (Jard 10-24): asked as a plain question ("Do you know your drinkers, or is this your best guess or research?")
// with full-sentence answers
export const BASIS = [
  { key: "known", label: "I know who my drinkers are" },
  { key: "guess", label: "It's my best guess, or from research" },
];
export const emptyProduct = () => ({ format: "", formatOther: "", size: "", abv: "", na: false }); // sells: per city (r2, sellsOf)
export const emptyDrinkers = () => ({ who: "", age: "", where: "", basis: "" });
const str = (x) => String(x ?? "").trim();
// no alcohol: ticked "Non-alcoholic", or "What you make" says so (isNA), or a soft drink
const productNA = (p) => Boolean(p?.product?.na) || noAlcohol(p?.what);
export const ageChoices = (p) => AGE_RANGES.filter((a) => !a.naOnly || productNA(p));
// The age band Doors narrows by, or null: a band offered for this product.
export function ageOf(p) {
  const k = str(p?.drinkers?.age);
  return ageChoices(p).some((a) => a.key === k) ? k : null;
}
export const ageLabel = (k) => AGE_RANGES.find((a) => a.key === k)?.label ?? null;

// r2 (Jard 10-24): how you sell belongs to each city (CITY_KEYS "sells"), and a brand can do both: self-distributed
// in one part of a market and through a distributor in another. ["self", "distributor"] in SELLS order; a profile
// saved before r2 kept one key on product.sells, read here.
export function sellsOf(p) {
  const raw = Array.isArray(p?.sells) ? p.sells : p?.sells ? [p.sells] : p?.product?.sells ? [p.product.sells] : [];
  return SELLS.map((s) => s.key).filter((k) => raw.includes(k));
}
export const sellsPhrase = (p) => listWords(SELLS.filter((s) => sellsOf(p).includes(s.key)).map((s) => s.phrase));
// r2 (Jard 10-24): a product can come in several variations (a can and a keg, a 12 oz and a 16 oz). The first is
// profile.product with its price per case in pitch.price (what lib/ask.js and the older code read); each further one
// is in profile.variants [{format, formatOther, size, abv, na, price}].
export const MAX_VARIANTS = 4; // the first and up to three more
export const emptyVariant = () => ({ format: "", formatOther: "", size: "", abv: "", na: false, price: "" });
const factsOf = (x, price) => {
  const format = FORMATS.some((f) => f.key === x.format) ? x.format : "";
  const formatLabel = format === "other" ? str(x.formatOther) : format ? FORMATS.find((f) => f.key === format).label.toLowerCase() : "";
  return { format, formatLabel, size: str(x.size), abv: str(x.abv), na: Boolean(x.na), price: str(price) };
};
// {format, formatLabel, size, abv, na, price, sells, sellsLabel}: the first variation as the rep gave it, trimmed ("" when
// not given); sells/sellsLabel: the first way they sell in this city (sellsOf has all).
export function productFacts(p) {
  const x = { ...emptyProduct(), ...(p?.product ?? {}) };
  const sells = sellsOf(p);
  return { ...factsOf(x, p?.pitch?.price), sells: sells[0] ?? "", sellsLabel: sellsPhrase(p) };
}
// every variation's facts, the first first; a further variation with nothing in it is left out
export function variantsOf(p) {
  const more = (Array.isArray(p?.variants) ? p.variants : []).map((v) => factsOf({ ...emptyVariant(), ...v }, v?.price)).filter((f) => f.format || f.size || f.abv || f.price);
  return [factsOf({ ...emptyProduct(), ...(p?.product ?? {}) }, p?.pitch?.price), ...more];
}
const variantLine = (f) => {
  const abv = f.na ? (f.abv && !/^0(\.0+)?\s*%?$/.test(f.abv) ? `non-alcoholic (${f.abv.replace(/%?$/, "%")})` : "non-alcoholic") : f.abv ? `${f.abv.replace(/%?$/, "%")} ABV` : "";
  return [[f.size, f.formatLabel].filter(Boolean).join(" "), abv, f.price].filter(Boolean).join(" · ");
};
// "12 oz cans · non-alcoholic · $38 a case of 24 · self-distributed"; several variations joined by "; " before how
// they sell ("12 oz cans · 5% ABV · $42 a case of 24; sixtel keg · $165 a sixtel · self-distributed"); "" with nothing given.
export function productLine(p) {
  return [variantsOf(p).map(variantLine).filter(Boolean).join("; "), sellsPhrase(p)].filter(Boolean).join(" · ");
}
// "Craft beer fans in their late 20s · 25–34 · taprooms and music bars (what I know)"; "" with nothing given.
export function drinkersLine(p) {
  const d = { ...emptyDrinkers(), ...(p?.drinkers ?? {}) };
  const age = ageOf(p) ? ageLabel(ageOf(p)) : "";
  const parts = [str(d.who), age, str(d.where)].filter(Boolean);
  if (!parts.length) return "";
  return `${parts.join(" · ")}${d.basis === "known" ? " (what I know)" : d.basis === "guess" ? " (my best guess)" : ""}`;
}

// The ask Doors suggests from the product (Jard 10-24: "doors suggests the ask, they can accept that ask or write in a
// different one"): by format first, then by what it is (talk.js defaultAsk). Every one reads as lib/ask.js expects
// (a keg ask goes to rooms with taps; a case ask takes the case price).
const KEG_SIZE = /\b(sixtel|sixth[- ]barrel|quarter[- ]barrel|pony keg|half[- ]barrel|\d{2}\s?l(iter|itre)?)\b/i;
export function suggestAsk(p) {
  const { format, size } = productFacts(p);
  const kind = productKind(p?.what);
  if (format === "keg") {
    const k = KEG_SIZE.exec(size)?.[1]?.toLowerCase();
    return `one ${k ? (/^\d/.test(k) ? `${k.replace(/\s/g, "")} keg` : k) : "sixtel"} on a guest tap line`;
  }
  if (format === "cans") return kind === "soft" ? "one case of cans in the cooler to try" : "one case of cans in the cooler";
  if (format === "bottles") {
    if (kind === "spirit") return "one bottle for the back bar";
    if (kind === "wine") return "a few bottles to try by the glass";
    if (kind === "soft") return "one case of bottles in the cooler to try";
    return "one case of bottles in the cooler";
  }
  return defaultAsk(p?.what);
}

// ---------- one brand, many cities (group 3 #5, Jard 10-24) ----------
// The brand is entered once; each city keeps its own days, start and plan. A city's saved profile is the whole
// profile (the plan reads one), so these split it and put it back together.
export const CITY_KEYS = ["city", "cityName", "cityLive", "cityCenter", "start", "windows", "week", "visitMin", "maxPerDay", "maxByDate", "known", "sells"];
const pick = (p, keys) => Object.fromEntries(keys.filter((k) => p?.[k] !== undefined).map((k) => [k, structuredClone(p[k])]));
export const cityPart = (p) => pick(p, CITY_KEYS);
export function brandPart(p) {
  const out = structuredClone(p ?? {});
  for (const k of CITY_KEYS) delete out[k];
  return out;
}
// a city's profile under the brand: the brand's fields, the city's own; an empty city when none is given
export function withBrand(brand, city = null) {
  const e = emptyProfile();
  return { ...e, ...cityPart(city ?? e), ...brandPart(brand), product: { ...emptyProduct(), ...(brand?.product ?? {}) }, drinkers: { ...emptyDrinkers(), ...(brand?.drinkers ?? {}) }, pitch: { ...e.pitch, ...(brand?.pitch ?? {}) } };
}

// N3: rooms that already pour the rep's drink, from any city (Qloo places): signals for ranking rooms in the opening city,
// alone or with the brands. A profile saved before N3 may still carry `venue` (v1's preset room key, e.g. "parsons"):
// read as that one room. rooms = index.rooms ([{key, name, where, id}]).
export const MAX_POURS = 3;
export function poursOf(p, rooms = []) {
  if (p?.pours?.length) return p.pours;
  if (!p?.venue) return [];
  const r = rooms.find((x) => x.key === p.venue);
  return [{ id: r?.id ?? "", name: r?.name ?? p.venue, where: r?.where ?? null }];
}
// "regulars like those at Parson's Chicken & Fish and Kite String"
export const listWords = (n) => (n.length <= 1 ? n[0] ?? "" : `${n.slice(0, -1).join(", ")} and ${n.at(-1)}`);
export const poursPhrase = (pours) => `regulars like those at ${listWords(pours.map((x) => x.name))}`;

// Doors a day (J2): a cap is an integer 1–20; anything else (null, 0, "3") is no cap → null.
export const MAX_PER_DAY = 20;
export const doorsCap = (n) => (Number.isInteger(n) && n >= 1 && n <= MAX_PER_DAY ? n : null);

// Field 8: what the rep can offer a room.
export const SUPPORT = [
  { key: "samples", label: "Samples", phrase: "free samples" },
  { key: "tasting", label: "Staff tasting", phrase: "a staff tasting" },
  { key: "menu", label: "Menu line", phrase: "a line on the menu" },
];

// The pitch as talk.js reads it: {price, ask, support} strings (empty when not given).
export function pitchForTalk(p) {
  const pitch = p?.pitch ?? {};
  const s = SUPPORT.filter((x) => (pitch.support ?? []).includes(x.key)).map((x) => x.phrase);
  const support = s.length <= 1 ? s[0] ?? "" : `${s.slice(0, -1).join(", ")} and ${s.at(-1)}`;
  // menuPrice (optional, "$8"): what the room charges a serve; lib/ask.js's margin line reads it instead of its typical one
  return { price: String(pitch.price ?? "").trim(), ask: String(pitch.ask ?? "").trim(), support, ...(String(pitch.menuPrice ?? "").trim() ? { menuPrice: String(pitch.menuPrice).trim() } : {}) };
}

// "  Denver,  CO " → "denver co": NFKC, lower case, every run of what isn't a letter or a digit (in any script) one
// space (a live city's name as the cache keys it; review6: 東京, Москва and "" stay three different things).
// citySlug: "Denver, CO" → "denver-co", a live city's key (the profile's `city`, its files' names).
export function normCity(s) {
  return String(s ?? "").normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}
export const citySlug = (s) => normCity(s).replace(/ /g, "-");
const QLOO_ID = /^[0-9A-F-]{30,40}$/i;

// Field-by-field problems; Build my plan is enabled when ok. ctx = {cities:[{key, name, center:[lat, lon]}]}.
// L1: a drink is a fetched brand ({key, name, ready:true}) or a Qloo brand found live ({id, name, ready:false}); the
// city is a ready key or a live city ({city: citySlug(cityName), cityName, cityLive:true, cityCenter?:[lat, lon]}).
export function validateProfile(p, ctx = {}) {
  const errors = {};
  const cities = ctx.cities ?? [];
  const city = cities.find((c) => c.key === p.city);

  const drinks = p.drinks ?? [];
  const pours = p.pours ?? [];
  if (!drinks.length && !pours.length && !p.venue) errors.drinks = "Add a brand your drinker also drinks, or a door that already pours you.";
  else if (drinks.length > MAX_DRINKS) errors.drinks = `Up to ${MAX_DRINKS} brands.`;
  else if (drinks.some((d) => (d.ready ? !d.key : !QLOO_ID.test(String(d.id ?? "")) || !String(d.name ?? "").trim()))) errors.drinks = "Pick each brand from the search.";
  if (pours.length > MAX_POURS) errors.pours = `Up to ${MAX_POURS} doors.`;
  else if (pours.some((r) => !QLOO_ID.test(String(r.id ?? "")) || !String(r.name ?? "").trim())) errors.pours = "Pick each door from the search.";

  const live = Boolean(p.cityLive);
  const name = String(p.cityName ?? "").trim();
  if (!p.city) errors.city = "Pick the city you're opening.";
  else if (live && (name.length < 2 || !normCity(name))) errors.city = "Type the city's name, like “Denver, CO”.";
  else if (live && (p.city !== citySlug(name) || cities.some((c) => c.key === p.city && !c.live))) errors.city = "Pick the city again.";
  else if (!live && !city) errors.city = "Pick the city you're opening.";

  // N1: every drafted note is signed with it ("Thanks, Maya, Tidewell")
  if (!String(p.pitch?.name ?? "").trim()) errors.name = "Add the name your notes are signed with.";
  // group 3 #4: what it comes in, and the ask agreed before the plan is built
  const fmt = productFacts(p);
  if (!fmt.format) errors.format = "Pick what it comes in.";
  else if (!fmt.formatLabel) errors.format = "Say what it comes in.";
  else {
    const bad = (p.variants ?? []).findIndex((v) => { const f = factsOf({ ...emptyVariant(), ...v }, v?.price); return !f.format || !f.formatLabel; });
    if (bad >= 0) errors.format = `Pick what variation ${bad + 2} comes in, or remove it.`;
  }
  if (!str(p.pitch?.ask)) errors.ask = "Use Doors' suggested ask, or write your own.";

  if (!(p.rooms ?? []).some((r) => ROOM_KEYS.includes(r))) errors.rooms = "Pick at least one door type.";

  const s = p.start;
  // the centre: a ready city's, a live city's once known (Qloo's resolved locality, or the form's lookup of its name)
  const center = city?.center ?? (live ? p.cityCenter : null);
  const cityLabel = city?.name ?? name;
  const far = (x) => Array.isArray(center) && km({ lat: x.lat, lon: x.lon }, { lat: center[0], lon: center[1] }) > START_MAX_KM;
  if (!s || !Number.isFinite(s.lat) || !Number.isFinite(s.lon)) errors.start = "Set where your day starts: a starting point, an address or a pin on the map.";
  else if (far(s)) errors.start = `That start is far from ${cityLabel}. Drop the pin in town.`;

  const visit = Number(p.visitMin);
  if (!Number.isInteger(visit) || visit < 5 || visit > 120) errors.visitMin = "Time at each door: 5 to 120 minutes.";

  // a usual week (lib/week.js): its days and its one-date changes are checked; the dated days come from it
  const wk = p.week;
  const usual = wk ? Object.values(wk.days ?? {}) : [];
  const dated = wk ? Object.entries(wk.changes ?? {}).filter(([, c]) => !c?.off).map(([date, c]) => ({ date, ...c })) : [];
  const wins = wk ? [...usual.map((u) => ({ ...u, date: "usual" })), ...dated] : p.windows ?? [];
  if (!wins.length) errors.windows = "Pick at least one day you're free.";
  else {
    const seen = new Set();
    for (const w of wins) {
      const from = toMinutes(w.from);
      const to = toMinutes(w.to);
      if (w.date !== "usual" && (!WEEK_DATE.test(w.date ?? "") || seen.has(w.date))) { errors.windows = "Each day once."; break; }
      seen.add(w.date);
      if (from === null || to === null) { errors.windows = "Give each day a from and a to time."; break; }
      if (to <= from) { errors.windows = "Each day's end must be after its start."; break; }
      if (Number.isInteger(visit) && to - from < visit) { errors.windows = `Each day needs at least ${visit} minutes: the time at one door.`; break; }
      if (w.start && (!Number.isFinite(w.start.lat) || !Number.isFinite(w.start.lon))) { errors.windows = "A day's own start needs an address or a pin."; break; }
      if (w.start && far(w.start)) { errors.windows = `A day's own start is far from ${cityLabel}. Drop the pin in town.`; break; }
    }
  }
  if (p.maxPerDay != null && !doorsCap(p.maxPerDay)) errors.maxPerDay = `Doors a day: 1 to ${MAX_PER_DAY}, or Any.`;
  const by = p.maxByDate ?? {};
  if (typeof by !== "object" || Array.isArray(by) || Object.entries(by).some(([d, n]) => !/^\d{4}-\d{2}-\d{2}$/.test(d) || !doorsCap(n))) errors.maxByDate = `A day's doors: 1 to ${MAX_PER_DAY}.`;
  return { ok: Object.keys(errors).length === 0, errors };
}

// A saved plan opens when its profile is valid but for the signer (N1) and the product's format and the ask (group 3
// #4): a profile saved before they were required (a carried plan) still opens; the form asks for them on edit.
const LATER = new Set(["name", "format", "ask"]);
export function canOpen(p, ctx = {}) {
  return !!p && Object.keys(validateProfile(p, ctx).errors).every((k) => LATER.has(k));
}

// ---------- starting points (R1 Calacanis 5): no address search needed ----------
// Three public places per ready city: a downtown landmark, a central neighbourhood, a bar/brewery/arts district.
// Coordinates from public maps, each inside the city's precomputed venue area with ranked rooms around it.
export const START_CHIPS = {
  austin: [
    { key: "downtown", label: "Downtown · Congress Ave", lat: 30.2682, lon: -97.7429 },
    { key: "soco", label: "South Congress", lat: 30.249, lon: -97.75 },
    { key: "east", label: "East Austin · E Cesar Chavez", lat: 30.2556, lon: -97.7208 },
  ],
  boise: [
    { key: "downtown", label: "Downtown · The Grove Plaza", lat: 43.615, lon: -116.203 },
    { key: "northend", label: "North End · Hyde Park", lat: 43.6326, lon: -116.205 },
    { key: "linen", label: "Linen District", lat: 43.6175, lon: -116.2125 },
  ],
  chicago: [
    { key: "loop", label: "The Loop · Daley Plaza", lat: 41.884, lon: -87.63 },
    { key: "wicker", label: "Wicker Park", lat: 41.91, lon: -87.6775 },
    { key: "fulton", label: "West Loop · Fulton Market", lat: 41.8866, lon: -87.652 },
  ],
  omaha: [
    { key: "oldmarket", label: "The Old Market", lat: 41.2555, lon: -95.931 },
    { key: "benson", label: "Benson", lat: 41.2846, lon: -96.0058 },
    { key: "blackstone", label: "Blackstone District", lat: 41.2589, lon: -95.9705 },
  ],
};
export const startChips = (city) => START_CHIPS[city] ?? [];
// A chip as a profile start (the label is the place, so the plan footer reads "Leave 2 pm from South Congress").
export const chipStart = (chip) => ({ label: chip.label, lat: chip.lat, lon: chip.lon, source: "chip", chip: chip.key });

const MI_PER_KM = 0.621371;
// A dropped pin in words: "Your pin near South Congress" (≤ 0.25 mi from a chip), "Your pin in Travis Heights" (the
// neighbourhood of a ranked room ≤ 0.3 mi away, when venues are given), else "Your pin, 0.4 mi from South Congress".
export function pinLabel(ll, city, venues = null) {
  const chips = startChips(city);
  const mi = (a) => km({ lat: ll.lat, lon: ll.lon }, { lat: a.lat, lon: a.lon }) * MI_PER_KM;
  const near = chips.map((c) => ({ c, d: mi(c) })).sort((a, b) => a.d - b.d)[0];
  if (near && near.d <= 0.25) return `Your pin near ${near.c.label}`;
  let best = null;
  for (const v of Object.values(venues ?? {})) {
    if (!v?.neighborhood || !Number.isFinite(v.lat)) continue;
    const d = mi(v);
    if (d <= 0.3 && (!best || d < best.d)) best = { n: v.neighborhood, d };
  }
  if (best) return `Your pin in ${best.n}`;
  if (near && near.d <= 15) return `Your pin, ${near.d.toFixed(1)} mi from ${near.c.label}`;
  return "Your pin on the map";
}

// ---------- a sample brand (R1 Calacanis 5): judges don't have one ----------
// Tidewell (made up): an NA hazy IPA whose drinker drinks Athletic Brewing, opening Austin from East Cesar Chavez,
// next Tuesday and Wednesday 2–6 pm, 25 min a door. The same story as the demo (C2).
export const SAMPLE_BRAND = "Tidewell";
export function sampleProfile(now = new Date()) {
  const next = (js) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    do d.setDate(d.getDate() + 1); while (d.getDay() !== js);
    return d;
  };
  const tue = next(2);
  const wed = new Date(tue.getFullYear(), tue.getMonth(), tue.getDate() + 1);
  const week = { days: { tuesday: { from: "14:00", to: "18:00" }, wednesday: { from: "14:00", to: "18:00" } }, changes: {}, since: isoDate(tue) };
  return {
    ...emptyProfile(),
    sample: true,
    brand: SAMPLE_BRAND,
    what: "Non-alcoholic hazy IPA",
    drinks: [{ key: "athletic-brewing", name: "Athletic Brewing", ready: true }],
    city: "austin",
    rooms: ["bars", "breweries"],
    roomsTouched: true,
    start: chipStart(START_CHIPS.austin[2]),
    // every Tuesday and Wednesday 2–6 pm, from next Tuesday (lib/week.js): windows = its days this week and next
    week,
    windows: weekDates(week, { today: now }),
    visitMin: 25,
    product: { ...emptyProduct(), format: "cans", size: "12 oz", abv: "0.5%", na: true },
    sells: ["self"],
    pitch: { price: "$38 a case of 24", ask: "one case of cans in the cooler", support: ["samples", "tasting"], name: "Maya" },
    known: [],
  };
}
