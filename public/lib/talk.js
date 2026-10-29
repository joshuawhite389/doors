// Talking points for one stop (SPEC-V2 §7), from a template: pure, no I/O, the same in the browser, the Worker and
// Node scripts. Sections in order: before you walk in, the opener, questions to ask, points to make, likely pushback,
// the ask. Rules: Qloo doesn't know what a venue stocks, so anything about the venue's drinks is a question, never a
// statement; no artist names; category facts only from facts.json (by id, shown as footnotes); every line passes the
// v1 banned-words guard (core.BANNED_PITCH).
import { BANNED_PITCH, bannedOwn, cleanSentence, genreLabel, parseHours, isChain } from "./core.js";
import { deepOn, todAdvice, leadFor, angleFor, lowerFirst, NO_ANGLE } from "./culture.js";
import { TAP_ASK, marginLine, priceForAsk, askUnit } from "./ask.js";

// ---------- venue type ----------
// "brewery" | "bar" | "coffee" | "restaurant", from the venue's Qloo genre (core.genreLabel), then its name.
export function venueType(v) {
  const g = genreLabel(v ?? {}).toLowerCase();
  const name = String(v?.name ?? "").toLowerCase();
  if (/brew|taproom|tap room|beer hall|beer garden/.test(g) || /\b(brewing|brewery|beerworks|taproom)\b/.test(name)) return "brewery";
  // whole words: "tea" must not match "steak", "pub" not "public" (R1 Diolosa D2)
  if (/\b(coffee|caf[eé]|cafes|tea|teahouse|tea house|tea room)\b/.test(g)) return "coffee";
  if (/\b(bar|bars|pub|tavern|lounge|club|saloon|wine|winery|cocktail|cocktails|beer|distillery|cider)\b/.test(g)) return "bar";
  return "restaurant";
}

const VENUE_TYPES_OK = ["brewery", "bar", "coffee", "restaurant"];

// ---------- the product's category, from "What you make" ----------
// kind: beer | seltzer | cider | wine | spirit | soft | other. Decides the format question, the ask and the facts.
// soft (owner review 8 N2): water, soda, coffee, tea, kombucha, energy, juice: a drink in its own right, not an alcohol
// alternative ("Botanical sparkling water" is soft, not wine; "sparkling wine" is still wine). A beer word that is a
// soft drink (ginger beer, root beer, ginger ale) is soft; "sour"/"wheat" count as beer only when nothing soft is named.
const SOFT = /water|\bsodas?\b|\bpop\b|tonic|mixers?\b|lemonade|coffee|cold brew|espresso|\btea\b|\bteas\b|matcha|yerba|\bmate\b|kombucha|\benergy\b|juice|smoothie|kefir|prebiotic|probiotic|electrolyte|sports drink/;
// "sparkling", "botanical", "functional" alone: a soft drink, unless the rep says it's non-alcoholic ("Non-alcoholic
// sparkling botanical" is an alcohol alternative, kind other).
const SOFT_WEAK = /sparkling|\bfizz|functional|adaptogen|botanical/;
export const NA_WORD = /non[- ]?alc|alcohol[- ]free|\bna\b|zero[- ]proof|\b0\.0|de-?alcohol|\bsober\b|mocktail|(spirit|alcohol|gin|wine|beer|whiske?y|tequila)[- ](free|alternative)/i;
export function productKind(what = "") {
  const w = String(what).toLowerCase();
  if (/\bhard (tea|kombucha|lemonade|soda|seltzer|juice|coffee)\b|\bspiked\b|seltzer(?! water)|canned cocktail|ready.to.drink|\brtd\b/.test(w)) return "seltzer";
  if (/cider/.test(w)) return "cider";
  if (/ginger beer|root beer|birch beer|ginger ale/.test(w)) return "soft";
  if (/beer|\bipa\b|lager|\bales?\b|stout|pils|porter|hazy|kolsch|kölsch/.test(w)) return "beer";
  if (/wine|ros[eé]|prosecco|champagne|\bcava\b|\bsake\b/.test(w)) return "wine";
  if (/tequila|mezcal|vodka|\bgin\b|whisk|bourbon|\brum\b|spirit|liqueur|aperitif|amaro|brandy|cognac|martini|negroni|margarita|daiquiri/.test(w)) return "spirit";
  if (SOFT.test(w) || (SOFT_WEAK.test(w) && !NA_WORD.test(w))) return "soft";
  if (/\bsour\b|wheat/.test(w)) return "beer";
  return "other";
}

// The ask the notes use when the rep leaves "Your ask" blank, by kind; the form shows it on the field (N2: never
// invented out of sight). A kind Doors can't tell gets the neutral ask.
export const NEUTRAL_ASK = "a sample for the team and five minutes with whoever buys";
const ASKS = { beer: "one case of cans in the cooler", seltzer: "one case of cans in the cooler", cider: "one case of cans in the cooler", wine: "a few bottles to try by the glass", spirit: "one bottle for the back bar", soft: "one case in the cooler to try", other: NEUTRAL_ASK };
export const defaultAsk = (what) => ASKS[productKind(what)] ?? NEUTRAL_ASK;

// A soft drink's words: the opener's "when they want …", the carry question's plural, the pushback's noun.
function softWords(what) {
  const w = String(what ?? "").toLowerCase();
  if (/water/.test(w)) return /sparkling|seltzer|carbonated|fizz|soda water|tonic/.test(w) ? { want: "something sparkling", carry: "sparkling waters", noun: "Sparkling water" } : { want: "water", carry: "bottled waters", noun: "Bottled water" };
  if (/coffee|cold brew|espresso/.test(w)) return { want: "a cold coffee", carry: "cold coffees", noun: "Cold coffee" };
  if (/kombucha/.test(w)) return { want: "something like kombucha", carry: "kombuchas", noun: "Kombucha" };
  if (/\btea\b|\bteas\b|matcha|yerba|\bmate\b/.test(w)) return { want: "an iced tea", carry: "teas", noun: "Iced tea" };
  if (/\benergy\b/.test(w)) return { want: "an energy drink", carry: "energy drinks", noun: "An energy drink" };
  if (/juice|smoothie|lemonade/.test(w)) return { want: "a juice", carry: "juices", noun: "Juice" };
  if (/\bsodas?\b|\bpop\b|tonic|mixer|ginger|root beer|birch beer|prebiotic/.test(w)) return { want: "a soda", carry: "sodas", noun: "Soda" };
  return { want: "a soft drink", carry: "soft drinks", noun: "A soft drink" };
}

// ---------- small helpers ----------
// "2026-10-21" → "Tue Oct 21" (local calendar date)
export function dayText(date) {
  const [y, m, d] = String(date).split("-").map(Number);
  const t = new Date(y, m - 1, d);
  if (!Number.isFinite(t.getTime())) return String(date);
  return `${"Sun Mon Tue Wed Thu Fri Sat".split(" ")[t.getDay()]} ${"Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ")[t.getMonth()]} ${t.getDate()}`;
}
const toMin = (eta) => {
  if (typeof eta === "number" && Number.isFinite(eta)) return eta;
  const m = /^(\d{1,2}):(\d{2})/.exec(String(eta ?? ""));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
export function clockText(min) {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (m === 720) return "noon";
  return `${h % 12 || 12}${mm ? ":" + String(mm).padStart(2, "0") : ""} ${h < 12 ? "am" : "pm"}`;
}
// An arrival time the way a person says it (Jard 10-24 #5: nobody texts "around 2:03 pm"): "around 2", "a little after
// 1", "around 3:30", "a little before 3", "around noon". ampm adds "am"/"pm" ("a little after 1 pm"), for lines that
// stand alone. Only for times Doors computed (an ETA); a room's posted hours stay exact (clockText).
export function humanTime(min, { ampm = false } = {}) {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  const hr = (x) => (x % 24 === 12 ? "noon" : x % 24 === 0 ? "midnight" : `${x % 12 || 12}${ampm ? ((x % 24) < 12 ? " am" : " pm") : ""}`);
  if (mm <= 7) return `around ${hr(h)}`;
  if (mm <= 22) return `a little after ${hr(h)}`;
  if (mm <= 37) return `around ${h % 12 || 12}:30${ampm ? (h < 12 ? " am" : " pm") : ""}`;
  if (mm <= 52) return `a little before ${hr(h + 1)}`;
  return `around ${hr(h + 1)}`;
}
export function phoneText(p) {
  const d = String(p ?? "").replace(/\D/g, "");
  const n = d.length === 11 && d[0] === "1" ? d.slice(1) : d;
  return n.length === 10 ? `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}` : p ? String(p) : null;
}
const article = (s) => (/^[aeiou]/i.test(s) && !/^(one|uni|use|eu)/i.test(s) ? "an" : "a");
const cap = (s) => s.replace(/^./, (c) => c.toUpperCase());
const list = (xs) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
// "Non-alcoholic hazy IPA" → "hazy IPA"; the NA part is said once, where it matters.
const styleOf = (what) => String(what ?? "").replace(/\b(non[- ]?alcoholic|alcohol[- ]free|\bna\b|zero[- ]proof)\s*/gi, "").trim();
const lower = (s) => lowerFirst(s); // live check I: "Irish-style whiskey" keeps its capital (culture.js)

// Arrival timing (SPEC §7.1): the lull between lunch and dinner is a good time; during service, call first.
// Minutes after midnight: lunch service 11:30–1:30, the lull 2–5 pm, dinner service from 5:30 pm.
// span = the venue's opening span that holds the arrival ({from, to} minutes, from its own hours), when known: arriving
// within 30 min of opening or within an hour of closing says so first (R1 Calacanis 3).
// wait = minutes the rep waits outside before the room opens (the planner's waitMin; eta is then the opening time).
// type (R9 S1 timing, docs/CULTURAL-SLOTS.md §6): the venue type's own day, a rule of thumb below the room's hours: a
// café's rush is the morning, a bar or taproom has no lunch service and fills after work. null = the restaurant clock.
// the arrival kinds that mean "the room is busy" (R9 deep compares them with Qloo's crowd times for the room)
const BUSY = new Set(["service", "happy-hour", "rush-am"]);
export function arrivalAdvice(eta, phone, span = null, wait = 0, type = null) {
  const m = toMin(eta);
  if (m == null) return { kind: "unknown", text: "Aim for the lull between lunch and dinner (2–5 pm); avoid walking in during service." };
  const t = clockText(m);
  const at = `You'll get there ${humanTime(m, { ampm: true })}`; // Jard 10-24 #5: an ETA as a person says it
  const call = phone ? `call first: ${phone}` : "call first if you can find a number";
  if (wait > 0) return { kind: "wait", text: `You'll get there about ${Math.round(wait)} min before they open at ${t}: be first in the door when they open, and keep it short.` };
  if (span && m >= span.from && m - span.from < 30) return { kind: "opening", text: `You're first in the door: they open at ${clockText(span.from)}. Expect them to be setting up, so keep it short.` };
  if (span && span.to - span.from < 1440 && span.to > m && span.to - m <= 60) return { kind: "closing", text: `${at}, within an hour of close (they close at ${clockText(span.to)}): keep it to five minutes${phone ? `, or call first: ${phone}` : ""}.` };
  if (type === "coffee") {
    if (m < 9.5 * 60) return { kind: "rush-am", text: `${at}, in a café's morning rush: order something, keep it short, and ask when the owner is usually in.` };
    if (m < 11.5 * 60) return { kind: "lull-am", text: `${at}, after the morning rush — a good time to catch someone.` };
    if (m >= 13.5 * 60 && m < 17 * 60) return { kind: "lull", text: `${at}, in a café's afternoon lull — a good time to catch a manager.` };
    if (m >= 17 * 60) return { kind: "late", text: `${at}, late in a café's day: keep it short, and ask when the owner is in.` };
  }
  if (type === "bar" || type === "brewery") {
    if (m >= 11 * 60 && m < 16 * 60) return { kind: "quiet", text: `${at}, before the after-work crowd — a good time to catch a manager.` };
    if (m >= 16 * 60 && m < 18 * 60) return { kind: "happy-hour", text: `${at}, at happy hour: staff are busy, so keep it to five minutes${phone ? `, or call first: ${phone}` : ""}.` };
    if (m >= 18 * 60) return { kind: "service", text: `${at}, when the room fills up — ${call}.` };
  }
  if (m >= 14 * 60 && m < 17 * 60) return { kind: "lull", text: `${at}, between lunch and dinner — a good time to catch a manager.` };
  if ((m >= 11.5 * 60 && m < 13.5 * 60) || m >= 17.5 * 60) return { kind: "service", text: `${at}, during service — ${call}.` };
  if (m < 11.5 * 60) return { kind: "early", text: `${at}, before the lunch rush: keep it short, and if no manager is in, ask when to come back.` };
  if (m < 14 * 60) return { kind: "late-lunch", text: `${at}, at the tail of lunch: give them a few minutes before you ask for a manager.` };
  return { kind: "pre-dinner", text: `${at}, just before dinner service: keep it to five minutes, or ${call}.` };
}

// Does the text name any of these (artists, brands)? Whole words, case as written: names are proper nouns, and a
// substring test drops clean lines ("xia" in "Asian", the artist "Model" in "model"). C1.
export function mentions(text, names = []) {
  const t = String(text ?? "");
  return names.some((n) => {
    const s = String(n ?? "").trim();
    if (!s) return false;
    const i = t.indexOf(s);
    if (i < 0) return false;
    return new RegExp(`(^|[^\\p{L}\\p{N}])${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}])`, "u").test(t);
  });
}

// The venue's own crowd line, turned into "your regulars are …" / "you draw …". null when there is none.
// Demographic boilerplate: a crowd line made only of these words could be any room in America ("local residents and
// families", "a broad demographic", "a diverse mix of locals and tourists"). Such a line is not an opener (R2 Calacanis 12).
const FILLER = new Set("looks like you get your regulars are draw a an the of and or in here with mix range variety blend array lot lots mostly mainly largely primarily predominantly some all ages from to".split(" "));
const BOILER = new Set("local locals residents resident families family neighborhood neighbourhood community members people patrons customers customer guests diverse broad wide varied eclectic demographic demographics crowd clientele audience base adults adult kids children visitors tourists area nearby everyone individuals groups various types".split(" "));
export function genericCrowd(text) {
  const words = String(text ?? "").toLowerCase().replace(/\byoung adults\b/g, "adults").replace(/[^a-z\s-]/g, " ").split(/\s+/).filter((w) => w && !FILLER.has(w));
  return words.length === 0 || words.every((w) => BOILER.has(w));
}

// a phrase that ends mid-thought or joins a fragment: never said out loud (R2 L5)
export const DANGLING = /\b(ranging|including|such as|from|and|or|with|of|to|like|the|a|an)$|\band (ranging|including|such as|from|attracting|serving|drawing|featuring|offering|catering)\b|\branging from (?!.*\bto\b)|\band (?:[a-z]+ly )?(?:consisting|comprised|composed|made up)\b|,\s*(?:[a-z]+ly )?[a-z]+ing\b/i;
const ARTIST_HINT = /\b(fans of|music (by|from)|tribute)\b/i;
const ORIGIN_PEOPLE = /\b(jewish|muslim|christian|catholic|hindu|sikh|buddhist|ethnic\w*|immigrants?|expats?|diaspora)\b|\b(asian|hispanic|latin[oax]s?|latinx|african|black|white|arab|bangladeshi|indian|nepali|pakistani|mexican|korean|chinese|japanese|vietnamese|filipino|thai|ethiopian|somali|caribbean|polish|irish|italian|greek|puerto rican|cuban|haitian|middle eastern)\s+(and\s+[\w ]+?\s+)?(community|communities|population|families|residents|people|crowd|clientele|patrons|customers|regulars|locals|americans)\b/i;
// an item of a comma list that is a lone adjective: one word, not a plural or a group ("students", "locals" are
// groups; "local" is an adjective)
const GROUP_WORD = /^(locals|tourists|students|families|couples|professionals|regulars|visitors|residents|workers|artists|creatives|millennials|retirees|seniors|kids|children|adults|singles|friends|groups|foodies|hipsters|enthusiasts|fans|guests|patrons|travelers|travellers|parents|neighbors|neighbours|everyone|people)$/i;
const adjectiveItem = (item) => /^[a-z][a-z-]*$/i.test(item) && !GROUP_WORD.test(item) && !/[^s]s$/i.test(item);
export function crowdPhrase(v, avoid = []) {
  const s = cleanSentence(v?.crowd);
  if (!s || ARTIST_HINT.test(s) || mentions(s, avoid)) return null;
  const m = /^(?:.{0,60}?\b)?(consists?|includes?|is made up of|comprises?|attracts?|draws?|serves?)\s+(?:(?:primarily|mainly|mostly|largely|typically|predominantly)\s+)?(?:of\s+)?(.+)$/i.exec(s);
  if (!m) return null;
  let x = m[2].replace(/[.!?]+$/, "");
  // keep the who, drop the why: cut at "who …", "looking for …", ", as well as …"
  // live check B: when the first cut is inside the subject ("small groups seeking …"), a later list-level one (",
  // particularly …", ", including …") still cuts; a later "who/looking …" inside the list doesn't (it would cut mid-list)
  const cuts = [...x.matchAll(/(,?\s+(who|that|looking|seeking|drawn|characterized|wanting|interested)\b|,\s+(as well as|particularly|including|often|frequently|typically|along with|with|drawing|attracting|catering|fostering|creating|offering|providing)\b)/gi)];
  const cut = cuts[0]?.index > 15 ? cuts[0] : cuts.find((c) => c.index > 15 && /^,\s+(as well as|particularly|including|often|frequently|typically|along with|with|drawing|attracting|catering|fostering|creating|offering|providing)\b/i.test(c[0]));
  if (cut) x = x.slice(0, cut.index);
  // judge pass 3 (N11): "a local neighborhood crowd, primarily consisting of young adults and regulars" → "a local
  // neighborhood crowd of young adults and regulars" (it was "a … crowd and primarily consisting of young adults")
  x = x.replace(/^(.{6,}?\b(?:crowd|clientele|mix|demographic|audience|base|following))\s*,?\s+(?:(?:primarily|mainly|mostly|largely|typically|predominantly)\s+)?(?:consisting|comprised|composed|made up)\s+of\s+/i, "$1 of ");
  // "a local crowd, particularly young adults, students and …" → "a local crowd, particularly young adults"
  const part = /^(.{6,}?),\s+particularly\s+(.+)$/i.exec(x);
  // a rep says two groups, not a list: "a, b, c, and d" → "a and b" (R1 Calacanis 2)
  // "a crowd ranging from students to families" stays whole; a "ranging from / including / such as" tail without its
  // end is cut, never left dangling ("a local crowd and ranging from students", R2 L5)
  const range = /^(.*?),?\s+ranging from\s+(.+?)\s+to\s+([^,]+)/i.exec(x);
  if (part) x = `${part[1]}, particularly ${part[2].split(/,\s*|\s+(?:and|or)\s+/)[0].replace(/\s+(who|that|looking|seeking|drawn|wanting|interested)\b.*$/i, "")}`;
  else if (range && range[1].length > 3) x = `${range[1]} ranging from ${range[2]} to ${range[3]}`;
  else {
    const tail = /,?\s+(ranging from|ranging|including|such as|like|from)\b/i.exec(x);
    if (tail && tail.index > 10) x = x.slice(0, tail.index);
    // judge pass 3 (N11): a clause after the groups ("…, primarily attracting local families", ", maintaining a
    // reputation …") is cut with all after it, never joined on with "and"
    const clause = /,\s*(?:[a-z]+ly\s+)?(?:attracting|serving|appealing|drawing|catering|maintaining|offering|featuring|providing|welcoming|bringing|hosting|creating|fostering|making|giving|known|popular|frequented|favou?red)\b/i.exec(x);
    if (clause && clause.index > 5) x = x.slice(0, clause.index);
    const items = x.split(/,\s*(?:and\s+|or\s+)?|\s+and\s+(?=[^,]*$)/).map((i) => i.trim()).filter(Boolean);
    // live check B: "a vibrant, young, and trendy demographic" is one group with adjectives, not three groups ("a
    // vibrant and young" was said, its noun cut off): when the second item is a lone adjective, the list runs to the
    // first item with its noun, "a vibrant, young and trendy demographic"
    const noun = items.findIndex((it, i) => i >= 1 && !adjectiveItem(it));
    if (items.length >= 3 && adjectiveItem(items[1])) x = noun > 0 ? `${items.slice(0, noun).join(", ")} and ${items[noun]}` : "";
    else if (items.length >= 3) x = `${items[0]} and ${items[1]}`;
  }
  if (x.length > 140) x = x.slice(0, 140).replace(/,[^,]*$/, "").replace(/\s+\S*$/, "");
  x = lower(x.trim().replace(/,$/, ""));
  // "a mix of local residents, couples" (a cut after the second group's first word): the two groups, with "and"
  x = x.replace(/,\s+([a-z]+s)$/i, " and $1");
  x = x.replace(/^a (?=[aeiou])/i, "an "); // "a energetic crowd" → "an energetic crowd"
  if (x.length < 6) return null;
  if (DANGLING.test(x)) return null;
  // live check B: ends on an article and a lone adjective, its noun cut off ("… drawing a younger", "in a relaxed")
  if (/\b(a|an|the|and|in)\s+(younger|older|lively|relaxed|welcoming|intimate|unpretentious|authentic|friendly|casual|vibrant|upscale|trendy|social|local|diverse|unique|iconic|cozy|laid-back|festive|energetic|sophisticated|romantic|family-friendly|hip|chic|warm|inviting|fun|loyal|young|mature|eclectic|artsy|stylish|affluent|professional)$/i.test(x)) return null;
  if (/^as\b/i.test(x)) return null; // "serves as a neighborhood pub": a room, not a crowd
  // live check B sweep: an opener never sorts people by origin or religion ("the local Bangladeshi and South Asian
  // community", "the local Jewish community", "Caribbean expats"); food ("authentic Korean meals") is not people
  if (ORIGIN_PEOPLE.test(x)) return null;
  if (genericCrowd(x)) return null;
  // weak: too long to say, or says nothing ("a diverse mix of locals and tourists") → the template opener instead
  if (x.split(/\s+/).length > 20) return null;
  if (/^(an? )?((diverse|wide|broad|eclectic|varied) )?(mix|range|variety|blend|array) of (people|patrons|customers|guests|locals?|visitors)( and (tourists|visitors|locals))?$/i.test(x)) return null;
  if (/^(locals?|tourists|people|customers|patrons|guests)( and (tourists|locals|visitors))?$/i.test(x)) return null;
  const consist = /^(consist|include|is made|compris)/i.test(m[1]);
  return { text: consist ? `your regulars are ${x}` : `you draw ${x}`, source: "customer_demographics_description" };
}

// The rank sentence. merged = the order is Doors' merge of 2+ drinker lists (never called a Qloo rank).
export function rankSentence({ rank, N, city, filter = "bars and restaurants", drinkerName, merged = false }) {
  const like = /\bregulars like those at\b/i.test(drinkerName); // N3: rooms that pour you (with any brands)
  const who = like || /^the regulars at\b/i.test(drinkerName) ? drinkerName : `${drinkerName} drinkers`;
  return merged
    ? `This door is #${rank} of ${N} on Your list of ${city} ${filter} for ${who}, built from Qloo's rankings.`
    : `Qloo ranks this door #${rank} of ${N} ${city} ${filter} for ${like ? who : / drinkers$/.test(who) ? `people who drink ${who.replace(/ drinkers$/, "")}` : `people who drink like ${who}`}.`;
}

// ---------- the generator ----------
// input: { venue, rank, N, drinkerName (bare), merged?, wait? (min before opening), city, filterLabel?, day? ("tuesday": the hours at arrival), profile:{brand, what, price, ask, support, drinksLike[]},
//          eta (minutes after midnight or "14:10"), isNA, sisters:[{name}] , avoid?:[names never to print] }
// facts: the `facts` array of public/data/facts.json (optional; without it no fact points).
// Returns { before[], opener, questions[], points:[{text, fact}], pushback:[{objection, reply}], ask, by, facts:[ids] }.
export function talkPoints(input, facts = []) {
  const { venue: v = {}, rank, N, drinkerName, city, profile = {}, sisters = [], avoid = [] } = input ?? {};
  const type = VENUE_TYPES_OK.includes(input?.venueType) ? input.venueType : venueType(v); // R9 S1: the rep's correction wins
  const kind = productKind(profile.what);
  // a soft drink is never an alcohol alternative (N2): no NA framing, no NA facts, whatever the caller says
  const soft = kind === "soft";
  const isNA = !soft && Boolean(input?.isNA);
  const sw = soft ? softWords(profile.what) : null;
  const brand = String(profile.brand ?? "").trim() || "your brand";
  const style = styleOf(profile.what) || (isNA ? "non-alcoholic drink" : "drink");
  const categoryWord = isNA ? "non-alcoholic" : lower(style);
  // "What you make" blank (R9 proof finding 3): no category to say, so the lines that name one take neutral words
  // ("what do they order when they want drink?" is not sayable). Empty slot = neutral, never invented.
  const blank = !String(profile.what ?? "").trim() && !isNA;
  const phone = phoneText(v.phone);
  const filter = input?.filterLabel || "bars and restaurants";

  // 1. before you walk in
  const who = {
    brewery: "Ask for the taproom manager or an owner.",
    bar: "Ask for the bar manager or beverage director (in a small bar, the owner).",
    restaurant: "Ask for the general manager, or the bar manager if there is one.",
    coffee: "Ask for the owner or the manager on shift.",
  }[type];
  // (persona capture): a chain's drinks are bought by corporate; the rep asks who decides, not the bartender
  const whoAsk = isChain(v.name) ? "A chain: corporate buys the drinks. Ask the manager who decides for this location, and get the regional buyer's name." : who;
  const etaMin = toMin(input?.eta);
  const spans = input?.day && etaMin != null ? parseHours(v.hours)?.days?.[input.day]?.spans ?? [] : [];
  const span = spans.find((x) => x.from <= etaMin && etaMin < x.to) ?? null;
  let timing = arrivalAdvice(input?.eta, phone, span, input?.wait ?? 0, input?.timingByType ? type : null);
  // ---- R9 deep (lib/culture.js): Qloo's per-room tags beat Doors' clocks (the global one and S1's by venue type); the room's own hours still win ----
  const deepOff = input?.deepOff ?? null;
  const deep = { tod: null, lead: null };
  // Only where they disagree: the clock says service but Qloo's crowd times say quiet, or the clock says a quiet time
  // but the arrival is inside the room's crowd times. Where they agree the clock's line stays (no decoration).
  if (deepOn("tod", deepOff) && !["wait", "opening", "closing", "unknown"].includes(timing.kind)) {
    const tod = todAdvice(v, etaMin, (x) => humanTime(x, { ampm: true }), phone ? `call first: ${phone}` : null, { open: Boolean(span) });
    if (tod && (BUSY.has(timing.kind) !== (tod.kind === "in-crowd") || tod.closedRisk)) (deep.tod = { ...tod, replaced: timing.kind }), (timing = { kind: tod.kind, text: tod.text });
  }
  const lead = deepOn("lead", deepOff) ? leadFor(v, { kind, isNA, style: soft ? sw.noun : styleOf(profile.what), turn: input?.leadTurn ?? null }) : null;
  if (lead) deep.lead = lead;
  // ---- end R9 deep ----
  // a price with its own brackets ("$38 a case of 24 ($1.58 a can)") is not bracketed twice (persona founder round 2)
  const bring = `Bring cold samples, ${profile.price ? `your price (${String(profile.price).trim().replace(/\s*\(([^)]*)\)/g, ", $1")})` : "your price per case"} and a one-page sheet.`;
  const before = [whoAsk, timing.text, bring];
  const kinds = ["who", "timing", "bring"]; // doorcard: what each before line is (lib/doorcard.js picks the door card's lines by it)
  // ---- R9 S1+S4 return visit (docs/CULTURAL-SLOTS.md §6): memory = slots.memoryFor(…), null on a first visit ----
  const mem = input?.memory?.visit === "return" ? input.memory : null;
  const used = [];
  if (mem) {
    const c = mem.contact;
    const last = mem.lastVisit ? dayText(mem.lastVisit) : null;
    if (c?.name) (before[0] = `Ask for ${c.name}${c.role ? ` (${c.role})` : ""}: you talked${last ? ` on ${last}` : " last time"}.`, used.push("contact"));
    else before[0] = `${who.replace(/\.$/, "")}, and say you're back${last ? ` from ${last}` : ""}.`;
    if (mem.said) (before.splice(2, 0, `Your note from last time: “${mem.said}”.`), kinds.splice(2, 0, "last"), used.push("said"));
    if (mem.result === "interested") (before.splice(2, 0, "They were interested last time: go for the first order."), kinds.splice(2, 0, "last"));
  }
  // why the rep is here: Qloo's rank is the rep's private context, never a point made to the bar (R2 Calacanis 11)
  // drinkerName is bare ("Athletic Brewing", "Athletic Brewing and Liquid Death", "the regulars at Parson's"). With 2+
  // drinker brands the order is Doors' merge of Qloo's lists, not a Qloo rank (R1 Diolosa D7).
  if (rank && N && drinkerName && city) (before.push(`Why you're here: ${rankSentence({ rank, N, city, filter, drinkerName, merged: input?.merged })}`), kinds.push("why"));

  // 2. the opener (Jard 10-24 #5, OPENERS-RESEARCH.md §1): what the rep says to whoever is behind the bar, in one
  // breath: who they are, then who buys, their name and when to catch them. Nothing about the room's crowd is said out
  // loud ("how would you know?"): Qloo's data is the rep's prep (the angle line in `before`) and picks `toBuyer`, the
  // line for the buyer: the angle in one sentence and an offer to taste.
  const first = String(profile.name ?? "").trim().split(/\s+/)[0] ?? "";
  const hey = [...String(v.id ?? v.name ?? "")].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % 2 ? "Hey" : "Hi"; // personas R2: not one canned line at every door
  const whatSaid = blank ? "" : soft ? lower(String(profile.what).trim()) : isNA ? `${/^non[- ]?alc/i.test(String(profile.what)) ? "" : "non-alcoholic "}${lower(String(profile.what).trim())}` : lower(String(profile.what).trim());
  const brandSaid = String(profile.brand ?? "").trim();
  const me = brandSaid ? `${hey}, I'm ${first ? `${first} ` : ""}with ${brandSaid}${whatSaid ? `, ${article(whatSaid)} ${whatSaid}` : ""}` : `${hey}, I'm ${first || "here"}${whatSaid ? `, I've got ${article(whatSaid)} ${whatSaid}` : ""}`;
  const beerish = ["beer", "cider"].includes(kind) || (isNA && /beer|ipa|lager|ale|stout|pils|hazy/i.test(String(profile.what)));
  const whoQ = isChain(v.name) ? "Who decides the drinks for this location?" : type === "brewery" ? (beerish ? "Who does the beer buying here?" : "Who does the buying here?") : type === "restaurant" ? "Who does your drinks list?" : type === "coffee" ? "Is the owner around?" : kind === "spirit" || kind === "wine" ? "Is your bar manager around?" : beerish ? "Who does your beer buying?" : "Who does your buying?";
  let opener = `${me}. ${whoQ} ${/around\?$/.test(whoQ) ? "If not, when's a good time to catch them?" : "Mind if I grab their name and the best time to catch them?"}`;
  const plainOpener = opener;
  const ang = mem ? null : angleFor(v, { kind, isNA, type, style: soft ? sw.noun : styleOf(profile.what), tags: deepOn("lead", deepOff), date: input?.date ?? null, eta: Number.isFinite(etaMin) ? etaMin : null });
  let toBuyer = ang?.say ?? null;
  // a return visit doesn't introduce itself again (S1 occasion); what the rep was told (stated) leads
  if (mem) {
    // personas, final round: "Have you had a chance to think it over?" is a closer's line; open from what was logged
    const hi = `Good to see you again${mem.contact?.name ? `, ${mem.contact.name}` : ""}.`;
    const brought = kind === "spirit" || kind === "wine" ? "I brought a bottle to pour for the team" : "I brought a couple of cold ones for you and the team";
    opener = mem.objection?.kind === "owner" ? `${hi} Is the owner in today, or should I come back when they are?`
      : mem.objection?.kind === "price" ? `${hi} I brought the price sheet, so we can look at the numbers together.`
      // founder, final round: the taste first even when they were interested; the order is asked for after it (The ask)
      : mem.result === "interested" ? `${hi} ${brought}. Want to try ${kind === "spirit" || kind === "wine" ? "it" : "one"}${/\bpatio\b/i.test(mem.said ?? "") ? " out on the patio" : ""}?`
      : `${hi} ${brought}.`;
  }
  if (ang) {
    // prep, first visit: buy something first; the angle and why (rank: where the hours go, never said: personas R2)
    before.splice(kinds.indexOf("timing") + 1, 0, ang.order), kinds.splice(kinds.indexOf("timing") + 1, 0, "order");
    const likeTop = (profile.drinksLike ?? []).map((x) => (typeof x === "string" ? { name: x, na: null } : x)).find((x) => x?.name);
    const sameKind = likeTop && likeTop.na != null && likeTop.na === isNA && (isNA || productKind(likeTop.category ?? "") === kind);
    const top = rank && rank <= 3 && drinkerName && !input?.merged && !/^the regulars at\b|regulars like those at/i.test(drinkerName)
      ? (sameKind ? ` If ${drinkerName} is on their list, pitch yours next to it.` : "")
      : "";
    // Jard web review 10-24: "Nothing in Qloo's tags points at one angle: lead with the taste" read as clunky: no tag,
    // no angle line (the brand-on-their-list tip stays when there is one)
    const noTag = ang.why.startsWith(NO_ANGLE);
    ang.why = noTag ? top.trim() : `${ang.why}${top}`;
    if (ang.why) before.push(`Your angle: ${ang.why}`), kinds.push("angle");
  }

  // 3. questions: Qloo doesn't know what they stock, so ask
  const carryQ = isNA ? "What do you have for guests who aren't drinking right now, and how does it move?" : soft ? `What ${sw.carry} do you carry right now, and which ones move?` : blank ? "What's on your drinks list right now, and what moves?" : `What do you carry in ${categoryWord} right now, and how does it move?`;
  const formatQ = {
    beer: type === "brewery" ? "Would a can in the cooler for guests work here, or only your own taps?" : "Cans or draft: what works better for you?",
    seltzer: "Cans in the cooler, or would it go on the menu?",
    cider: type === "brewery" ? "Would a can in the cooler for guests work here, or only your own taps?" : "Cans or draft: what works better for you?",
    wine: "By the glass or by the bottle: where would it fit?",
    spirit: "Would it sit on the back bar, or earn a line on the cocktail menu?",
    soft: type === "coffee" ? "Would it live in the cooler with the cold drinks, or on the menu board?" : type === "restaurant" ? "Would it go on the drinks list, or in the cooler by the register?" : "Would it live in the cooler, or on the menu with the soft drinks?",
    other: type === "coffee" ? "Would it live in the cooler with the cold drinks, or on the menu board?" : "Would it live in the cooler, or on the menu?",
  }[kind];
  const decideQ = type === "restaurant" ? "Who decides the drinks list, and when do you next change the menu?" : "Who decides what goes on the menu, and when do you review it?";
  let questions = [...(lead?.gate ? [lead.gate] : []), carryQ, formatQ, decideQ];
  if (mem) {
    const decides = /owner|manager|director|gm|buyer/i.test(mem.contact?.role ?? "");
    questions = ["What's missing on your list right now?", mem.carry ? null : carryQ, formatQ, decides ? null : decideQ].filter(Boolean).slice(0, 3);
    if (mem.carry) used.push("carry");
  }

  // 4. points to make
  const points = [];
  const sis = sisters.map((s) => (typeof s === "string" ? s : s?.name)).filter(Boolean).slice(0, 2);
  // judge pass 4 (N24): sister rooms are the rep's context (rooms like this one to try nearby), not a point to make to a
  // manager about rooms that don't pour her yet
  if (sis.length) (before.push(`Sister doors: Qloo matches its regulars to ${list(sis)}${city ? `, also in ${city}` : ""}.`), kinds.push("sisters"));
  const usable = facts.filter((f) => f?.id && f.url && (f.appliesTo?.includes("all") || (isNA && f.appliesTo?.includes("na"))) && (!f.category || f.category.includes(kind)));
  // NA: rotate by the room's rank over every usable NA fact, so none is in more than 60% of NA outputs (R2 L7): two
  // facts when 4+ are usable (each ≤ 50%), one when fewer (each ≤ 1/3). The vendor anecdote (na-table-time) stays out
  // while 3+ others are usable (R1 D8). Alcohol: one "all" fact, by venue type.
  let chosen;
  if (isNA) {
    const na = usable.filter((f) => f.appliesTo?.includes("na"));
    const order = na.filter((f) => f.id !== "na-table-time").length >= 3 ? na.filter((f) => f.id !== "na-table-time") : na;
    const want = order.length >= 4 ? 2 : Math.min(1, order.length);
    const start = order.length ? (Number.isFinite(rank) ? rank - 1 : 0) % order.length : 0;
    chosen = Array.from({ length: want }, (_, k) => order[(start + k) % order.length]);
  } else {
    const prefer = { restaurant: ["bartender-rec-46"], bar: ["bartender-rec-46", "bartender-reliability"], brewery: ["bartender-reliability"], coffee: ["bartender-reliability"] }[type];
    chosen = [prefer.map((id) => usable.find((x) => x.id === id)).find(Boolean) ?? usable[0]].filter(Boolean);
  }
  for (const f of chosen) points.push({ text: f.text, fact: f.id });
  const backing = profile.support ? `we back it with ${lower(String(profile.support).trim().replace(/[.]+$/, ""))}` : "";
  const product = blank
    ? `${brand}: ${backing || "taste it before you decide anything"}.`
    : `${brand} is ${article(String(profile.what || style))} ${lower(String(profile.what || style))}${backing ? `; ${backing}` : ""}.`;
  points.push({ text: product, fact: null });

  // guard: drop any line that trips the banned words (a profile field could carry one)
  const own = [profile.ask, profile.what, profile.support, profile.brand, brand, mem?.said, mem?.objection?.words, mem?.carry].map((x) => String(x ?? "").trim().replace(/[.]+$/, ""));
  const ok = (s) => !bannedOwn(s, own);

  // 6. the ask (before the pushback, which offers it as the small start)
  const fallbackAsk = ASKS[kind] ?? NEUTRAL_ASK;
  // the rep's own ask (stated) beats Qloo's tags, which beat the kind's default
  const qlooAsk = lead?.ask && !String(profile.ask ?? "").trim() ? lead.ask : null;
  const askRaw = String(profile.ask ?? "").trim() || qlooAsk || fallbackAsk;
  if (lead && !qlooAsk) delete lead.ask;
  const ask = ok(askRaw) ? askRaw : fallbackAsk;
  // the price in the ask's own unit ("$165 a sixtel" for a sixtel, of "$165 a sixtel, $44 a case of 24"), else none
  const askPrice = askUnit(ask) ? priceForAsk(profile.price, ask) : null;
  const priceFits = Boolean(askPrice) && !(askUnit(ask) === "bottle" && askPrice.unit === "case"); // a case never prices a bottle start
  // ---- persona MUST #2 (lib/ask.js): the price as the bar's money per pour or per can is point #1, in place of the
  // global category stat (every card carried the same "46% of consumers"); NA facts stay, after it ----
  const margin = marginLine(profile, ask);
  if (margin && ok(margin.text)) {
    if (!isNA) for (let i = points.length - 1; i >= 0; i--) if (points[i].fact) points.splice(i, 1);
    points.unshift({ text: margin.text, fact: null, margin: true });
  }

  // 5. likely pushback
  const pushback = [];
  // drinksLike: names, or {name, na, category}. "Your guests already buy …" only when that brand is the same kind (NA or
  // not) as the product (R1 Diolosa D3): a tequila the venue has says nothing about non-alcoholic sales. And it names
  // only what the data backs (R9 proof finding 2): the brand's own category ("tequila"), when it is the product's kind,
  // never the product's ("small-batch mezcal" because they stock Casamigos). No category → no claim.
  const likeX = (profile.drinksLike ?? []).map((x) => (typeof x === "string" ? { name: x, na: null } : x)).find((x) => x?.name);
  if (likeX) {
    const cat = String(likeX.category ?? "").trim();
    const same = likeX.na == null || likeX.na !== isNA ? false : isNA || (cat && productKind(cat) === kind);
    pushback.push({
      objection: `We already have ${likeX.name}.`,
      reply: same && !soft
        ? `Good: your guests already buy ${isNA ? "non-alcoholic drinks" : lower(cat)}. ${brand} sits next to it as a second option, not a replacement.`
        : isNA
          ? `${brand} doesn't replace anything: it's for the guest who isn't drinking tonight, so they still order something.`
          : `${brand} sits next to it as a second option for your guests, not a replacement.`,
    });
  }
  // the start the pushback offers is the ask itself (R9 proof finding 1): a kind default ("one case of cans, no keg")
  // contradicted a rep who asks for "a cider on draft for a month". The rep's words stay verbatim.
  const small = ask;
  const risk = TAP_ASK.test(small) ? "one rotating tap line" : /menu|\blist\b|cocktail/i.test(small) ? "one line on the list" : /bottle|back bar/i.test(small) ? "one bottle" : /case|cooler|cans?\b/i.test(small) ? "one shelf spot" : null;
  const nosell = /\bsamples?\b/i.test(small) ? `Then start with ${small}: no order until your team has tasted it.` : risk ? `Then start with ${small}. If it doesn't move in a few weeks, you've only given up ${risk}.` : `Then start with ${small}. If it doesn't move in a few weeks, we'll look at it together.`;
  pushback.push({
    objection: isNA ? "Non-alcoholic doesn't sell here." : soft ? `${sw.noun} doesn't sell here.` : blank ? "That won't sell here." : `${cap(categoryWord)} doesn't sell here.`,
    reply: nosell,
  });
  if (type === "brewery") pushback.push({ objection: "We only serve our own beer.", reply: isNA ? `${brand} is for the guest in the group who isn't drinking today: it keeps them at your table without competing with your taps.` : soft ? `${brand} doesn't compete with your taps: it's for the driver, and for anyone who wants something cold that isn't beer.` : `${brand} covers the guest your taps don't, so the whole group stays.` });
  // the rep's own ask names the space it takes (a tap, a line on the list, a bottle): say that, not the kind's default
  else if (String(profile.ask ?? "").trim() && ask === askRaw && ["one rotating tap line", "one line on the list", "one bottle"].includes(risk)) pushback.push({ objection: "We don't have room.", reply: `${cap(risk)}${risk === "one rotating tap line" ? " for a month" : ""} is all it needs.` });
  else pushback.push({ objection: "We don't have room.", reply: { restaurant: "It needs one line on the drinks list, nothing more.", coffee: "It needs one row in the cooler.", bar: kind === "spirit" ? "One bottle on the back bar is all it needs." : "One row in the cooler is all it needs." }[type] ?? "It needs one row in the cooler." });

  if (mem?.objection) {
    const o = mem.objection;
    const reply = {
      // the price rides along only when it is in the start's own unit ("$44 a case" never prices a draft or a bottle)
      price: /\bsamples?\b/i.test(small) ? `Start with ${small}: no order until your team has tasted it, then we talk price.` : `Start with ${small}${priceFits ? ` (${askPrice.text})` : ""}; if it doesn't move in a few weeks, we'll look at it together.`,
      space: risk === "one rotating tap line" ? "Could it get one rotating tap line for a month, in place of your slowest keg?" : "Could it get one row in the cooler or one line on the list, in place of whatever moves slowest?",
      local: "Tell me what local means for your list, and I'll tell you honestly whether we fit.",
      own: pushback.find((p) => /own beer/.test(p.objection))?.reply ?? `${brand} is for the guests who don't want beer.`,
      already: `${brand} sits next to it as a second option for your guests, not a replacement.`,
      owner: "Who should I talk to, and when are they in? I'll come back then.",
      nosell,
    }[o.kind];
    pushback.unshift(reply ? { objection: `Last time: “${o.words ?? o.kind}”`, reply, from: "memory" } : { objection: `Last time: “${o.words}”`, reply: "That's what you noted: have your answer ready.", from: "memory" });
    used.push("objection");
    pushback.splice(3);
  }

  return {
    before: before.filter(ok),
    beforeKinds: kinds.filter((_, i) => ok(before[i])),
    opener: ok(opener) ? opener : plainOpener,
    openerSource: null,
    toBuyer: toBuyer && ok(toBuyer) ? toBuyer : null,
    angle: ang ? { key: ang.key, why: ang.why, mail: ang.mail && ok(ang.mail) ? ang.mail : null, src: ang.src } : null,
    questions: questions.filter(ok),
    points: points.filter((p) => ok(p.text)),
    pushback: pushback.filter((p) => ok(p.objection) && ok(p.reply)),
    ask,
    by: "template",
    facts: points.filter((p) => p.fact && ok(p.text)).map((p) => p.fact),
    venueType: type,
    arrival: timing.kind,
    kind,
    isNA,
    visit: mem ? "return" : "first",
    memoryUsed: used,
    deep,
  };
}
