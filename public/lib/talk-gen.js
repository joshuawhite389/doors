// Each door's talking points, written by a model from Qloo's facts about that door (group 3 item 3, Jard web review
// 10-24: "All of these are exactly the same … we should be able to tailor these for each door"; round 3, Jard 10-25:
// "what they would pay for is something that reveals an insight or deep market research on a specific door that will
// give them an edge in their pitch"). The model writes the angle (the one sharp insight for this door and why it
// matters here), the first line to the buyer, the questions, the points, the likely pushback and the replies; the ask
// stays the rep's own, and the lines Doors computes (who to ask for, when you'll get there, what to bring, the opener)
// stay the template's.
//
// Grounding (g4, round 3): the model sees a numbered list of facts (talkFacts): Qloo's facts about the door (lib/place.js's
// place picture, Qloo's own summary of the door, its hours, its menu and room tags, its rank and match for the rep's
// drinkers), the product (lib/profile.js productLine), the rep's drinkers, and the ask. Every line cites the facts it
// uses, and validateTalkSet keeps the few hard rules: no number, name, event or feature that isn't in the facts; nothing
// said about what the room stocks unless a fact from the door's own site says so; the ask's own words when a reply
// offers the start; never a statement that tells the buyer what their own room is like (toldTheRoom, Jard R2); plain
// trade words. The rules that made every door read the same (the buyer line must end in a taste offer; an alcohol
// alternative must say "for the guest who isn't drinking"; three of everything; never a number or the crowd) are gone
// (ROUND3-SPEC.md: "we are neutering our app"). A line that fails is dropped; a set without its angle, a question and a
// point falls back to the template. Fewer lines when the facts are thin beats filler.
//
// The same code runs in the Worker (src/talk.js, which calls the model), in the browser (which checks a stored set
// again before showing it) and in scripts/talk-bake.mjs (the demo cities' sets). Pure: no DOM, no fetch.
// Covered by test/talk-gen.test.mjs.
import { BANNED_WORDING, BANNED_HYPE, isChain, parseHours, formatDayHours, DAYS, dayShort, priceLabel } from "./core.js";
import { placePicture } from "./place.js";
import { productLine, drinkersLine } from "./profile.js";
import { mentions } from "./talk.js";

// g2 (R2 10-24): toldTheRoom; g3: a prompt that keeps each door's lines its own; g4 (round 3, 10-25): the one-insight
// prompt, Qloo's summary, hours, rank and match as facts, the sameness rules dropped; g5 (Jard 10-25, later): Qloo's
// crowd description and the age band are sent, under the "so what" rule (a demographic is context for the occasion,
// never a guess at taste; the evidence carries any claim about what people drink), Sonnet 5.5 with a brevity voice.
// g6 (Jard 10-25, later still): the OPENER and the DRAFTED MESSAGE to the door (email + text) are the model's too, with
// {rep} and {when} placeholders Doors fills on the device (the rep's name never leaves Doors; the visit time stays
// computed); who to ask for, when you'll get there and what to bring stay Doors' own.
// Every older set in KV is written again (the version is in the key).
export const TALK_GEN_VERSION = "g6";
// placeholders the model writes and Doors fills (withTalkSet): the rep's first name, and when they'll come by
export const REP = "{rep}";
export const WHEN = "{when}";

const str = (x) => String(x ?? "").trim();
const tagsOf = (v, fam) => (Array.isArray(v?.tags?.[fam]) ? v.tags[fam].filter((x) => typeof x === "string" && x.trim()) : []);
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : "");

// Qloo's week of hours as one line: "Mon–Thu 11 am–10 pm; Fri–Sat 11 am–11 pm; Sun 11 am–10 pm" (same days folded)
export function hoursLine(hours) {
  const parsed = parseHours(hours);
  if (!parsed?.ok) return null;
  const runs = [];
  for (const d of DAYS) {
    const t = formatDayHours(parsed, d) ?? "closed";
    const last = runs.at(-1);
    if (last && last.t === t) last.to = d;
    else runs.push({ from: d, to: d, t });
  }
  return runs.map((r) => `${dayShort(r.from)}${r.to !== r.from ? `–${dayShort(r.to)}` : ""} ${r.t}`).join("; ");
}

// the affinity row for a door: the first drinker list holding it (lib/stopmodel.js affinityOf, kept here so this module
// has no cycle with stopmodel.js) → {affinity, who} or null
function affinityIn(routes = [], id) {
  for (const r of routes ?? []) {
    for (const key of ["all", "famous"]) {
      const row = r?.lists?.[key]?.find((x) => x[0] === id);
      if (row) return { affinity: row[1], who: r?.kind === "pour" ? r.drinker?.who ?? r.drinker?.name ?? "the rep's drinker" : r?.kind === "room" || r?.kind === "venue" ? `the regulars at ${r.drinker?.name ?? "the door the rep named"}` : `${r?.drinker?.name ?? "the rep's"} drinkers` };
    }
  }
  return null;
}

// ---------- the facts the model may use ----------
// → {facts: [{id, kind: "room"|"site"|"product"|"ask", label, text, prep?: true}], ask, avoid: [names never said in the
// room], venueType, brand, drinks}. ids: R1… (the room, Qloo's facts), S1… (the door's own public site, when the
// enrich lane has it: enrich.site), P1… (the product and the rep's drinkers), A (the ask). prep: used to think, never
// said in the room.
// input: {venue, id, city, routes, plan, profile, ask, venueType, avoid, na, soft, enrich?, deep?}
// deep (round 3, lane deep, gigbot 10-26): the door's ranked insight facts, best first, same line shape as enrich's
// ([{label, text, prep?, from?}]): the gap between its menu or site and what its crowd buys, same-crowd doors that
// carry what it doesn't, the owner's business (hours, events, slow nights). They are the D facts, listed right after
// Qloo's summary; the prompt leads with the top one when it is real.
// enrich (round 3, lane enrich): lib/enrich.js enrichFacts(record) → [{label, text, src: "qloo"|"site", prep?, from?}]
// for this door; its qloo lines join the R facts, its site lines are the S facts (the one kind a spoken line may state
// about the door's stock, cited).
export function talkFacts({ venue: v = {}, id = null, city = null, routes = [], plan = null, profile = {}, ask = "", venueType = null, avoid = [], na = false, soft = false, enrich = null, deep = null } = {}) {
  const facts = [];
  const pic = placePicture({ id: id ?? v.id, venue: v, city, routes, plan });
  const room = (label, text, extra = {}) => str(text) && facts.push({ id: `R${facts.filter((f) => f.kind === "room").length + 1}`, kind: "room", label, text: str(text).replace(/\s+/g, " ").slice(0, 500), ...extra });
  room("Name", v.name);
  room("City", plan?.city?.name ?? city?.name ?? null);
  room("What it is", [pic.kind, venueType ? `(${venueType})` : null, v.neighborhood ? `in ${v.neighborhood}` : null, isChain(v.name) ? "a chain: corporate buys the drinks" : null].filter(Boolean).join(" "));
  // Qloo's own summary of the door: what it is known for (a brewpub that brews its own beer, a pizza room, a cocktail bar)
  room("Qloo's summary of the door", v.description);
  const insight = (label, text, extra = {}) => str(text) && facts.push({ id: `D${facts.filter((f) => f.kind === "deep").length + 1}`, kind: "deep", label, text: str(text).replace(/\s+/g, " ").slice(0, 500), ...extra });
  for (const d of Array.isArray(deep) ? deep : []) insight(d.label, d.text, { ...(d.prep ? { prep: true } : {}), ...(d.from ? { url: d.from } : {}) });
  // Qloo's crowd description (customer_demographics_description) is sent (Jard 10-25: "pretending you can't see facts
  // about a neighborhood, a market, a demographic is bad business… why is it there if not to be used"), under the
  // prompt's "so what" rule and the TASTE_GUESS check below: a demographic shapes the occasion, never a drink claim.
  room("Who goes (Qloo's crowd description)", str(v.crowd).split(/(?<=[.!?])\s+/).slice(0, 2).join(" "));
  room("The room (Qloo's description)", str(v.ambience).split(/(?<=[.!?])\s+/).slice(0, 2).join(" "));
  room("Hours", hoursLine(v.hours));
  room("When people go", pic.when?.text);
  room("How the room feels", pic.room?.text);
  room("Drinks Qloo tags it for", pic.pours?.text);
  room("Known for on the menu", tagsOf(v, "menu").slice(0, 6).join(", "));
  room("Dishes", (v.dishes ?? []).slice(0, 5).join(", "));
  room("The crowd is into", pic.into?.text);
  room("Good for", (v.goodFor ?? []).slice(0, 5).join(", "));
  room("Price level and rating", [priceLabel(v.price) ? `${priceLabel(v.price)} of $$$$` : null, Number.isFinite(v.rating) ? `rated ${Math.round(v.rating * 10) / 10} of 5` : null, Number.isFinite(v.popularity) ? `Qloo popularity ${Math.round(v.popularity * 100)} of 100 (how much the city goes there)` : null].filter(Boolean).join("; "));
  // why this door is on the list: Qloo's match between its crowd and the rep's drinkers (prep: it names the drinker brand)
  const aff = affinityIn(routes, id ?? v.id);
  const rankIdx = plan?.pool?.ids?.indexOf(id ?? v.id) ?? -1;
  const rank = rankIdx >= 0 ? `rank ${rankIdx + 1} of ${plan.pool.N ?? plan.pool.ids.length} on the rep's list${plan.pool.label ? ` of ${plan.pool.label}` : ""}` : null;
  room("Why it's on the rep's list", [aff && typeof aff.affinity === "number" ? `Qloo matches this door's crowd to ${aff.who} at ${aff.affinity.toFixed(2)} of 1` : null, rank].filter(Boolean).join("; "), { prep: true });
  room("Who it ranks highest with (the age band)", pic.ages?.text, { prep: true });
  // names a rep never says in the room: the crowd's artists and the sister doors (OPENERS-RESEARCH.md §2)
  room("The crowd's music", pic.music?.state === "shown" ? pic.music.text : null, { prep: true });
  room("Doors with the same crowd", pic.sisters?.doors?.length ? pic.sisters.doors.map((d) => d.name).join(", ") : null, { prep: true });
  const extra = Array.isArray(enrich) ? enrich : [];
  for (const q of extra.filter((f) => f?.src !== "site")) room(q.label, q.text, q.prep ? { prep: true } : {});
  // the door's own public site (lane enrich): what it pours, brews, serves; events; happy hour. The one kind of fact a
  // spoken line may state about the room's stock (cite it).
  const site = (label, text, url = null) => str(text) && facts.push({ id: `S${facts.filter((f) => f.kind === "site").length + 1}`, kind: "site", label, text: str(text).replace(/\s+/g, " ").slice(0, 500), ...(url ? { url } : {}) });
  for (const f of extra.filter((f) => f?.src === "site")) site(f.label, f.text, f.from ?? null);
  const prod = (label, text) => str(text) && facts.push({ id: `P${facts.filter((f) => f.kind === "product").length + 1}`, kind: "product", label, text: str(text).slice(0, 300) });
  prod("Brand", profile.brand);
  prod("What it is", profile.what);
  prod("The product", productLine(profile));
  prod("What the rep offers the bar", typeof profile.support === "string" ? profile.support : ""); // pitchForTalk's words, not the form's keys
  prod("The rep's drinkers also drink", (profile.drinks ?? []).map((x) => x?.name).filter(Boolean).join(", "));
  prod("Who the rep says drinks it (the rep's own words; known or a guess, as marked)", drinkersLine(profile));
  // what kind of drink it is, so a soft drink is never sold as the alcohol-free option and a beer never as a mocktail
  if (na) prod("What kind of drink", "An alcohol alternative (non-alcoholic)");
  else if (soft) prod("What kind of drink", "A soft drink in its own right: not an alcohol alternative, never pitched as the non-alcoholic or alcohol-free option");
  else prod("What kind of drink", "An alcoholic drink");
  const theAsk = str(ask);
  if (theAsk) facts.push({ id: "A", kind: "ask", label: "The ask (the rep's own words; use them verbatim)", text: theAsk });
  const never = [
    ...(pic.music?.state === "shown" ? pic.music.artists : []),
    ...(pic.sisters?.doors ?? []).map((d) => d.name),
    ...avoid,
  ].filter((x) => str(x).length >= 2);
  return { facts, ask: theAsk, na: Boolean(na), avoid: [...new Set(never)], venueType: venueType ?? null, brand: str(profile.brand), drinks: (profile.drinks ?? []).map((x) => x?.name).filter(Boolean) };
}

// The cache key for a set: the facts the model saw and the version of the rules. Same in the Worker and the browser
// (FNV-1a, 2 × 32 bits).
export function talkKey(tf) {
  const s = `${TALK_GEN_VERSION}|${JSON.stringify(tf.facts.map((f) => [f.id, f.text]))}|${tf.venueType ?? ""}`;
  let a = 0x811c9dc5, b = 0x01000193 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
  }
  return `${a.toString(36)}${b.toString(36)}`;
}

// ---------- the prompt ----------
export const TALK_SYSTEM = [
  "You write the talking points a drinks salesperson (a brand founder or a distributor rep) takes into ONE specific bar, brewery, restaurant or café (a door). They have one product and one ask. They are paying for an edge: something about THIS door that makes the pitch land here and would be wrong at the bar next door.",
  "Voice: say it the way a sharp rep would say it to a colleague: the point, then stop. One strong line beats three. No restating, no explaining what you just said, no warming up. If a line can lose a clause and still land, lose the clause. The rep reads this on a phone on the way in.",
  "You get numbered FACTS: what Qloo (a taste-data company) knows about this door (R…), Doors' ranked insights about it when there are any (D…, best first: the gap between what it serves and what its crowd buys, same-crowd doors that carry what it doesn't, the owner's business such as slow nights and events), facts from the door's own public site (S…), the product and who the rep says drinks it (P…), and the ask (A). Facts marked 'prep only' are for your thinking, never for a spoken line. A D fact is the sharpest thing in the list when it is there: lead with it.",
  "Your job, in order:",
  "1. Find the one sharp insight for this door: the fact, or the collision of two facts, that changes how the rep should pitch here. A brewpub that brews its own beer will not put a guest beer on tap, so the pitch is the slot it cannot fill itself. A pizza-and-families room that opens at 11 am is a lunch pitch, not a late-night pitch. A door that ranks near the top of the city for the rep's own drinkers' tastes is a door to ask for more than the minimum. A room tagged for cocktails and a full bar is a bartender's room: pitch what the bartender can do with it. Say the insight plainly in `angle`, with why it matters here, so the rep walks in knowing what they are walking into. If the facts are thin, say what is known and keep the rest short: no padding.",
  "2. Build everything else on that insight: the first thing the rep says to the buyer after hello (`to_buyer`), the questions that only make sense at this door, the points to make here, and the pushback this door in particular will give, with what the rep says back. Nothing generic: a question or point that would read the same at every bar in town is wrong. Do not fall back on 'would your staff like a tasting' or 'do guests ask for a non-alcoholic option' unless this door's facts make that the sharpest thing to say.",
  "The test for every line is SO WHAT. Not 'I see a lot of families here' (that is the data with 'I see' in front of it) but what the fact means for THIS pitch: how it helps the bar's business, how it helps the rep connect with the manager or owner. Qloo's crowd description and the age band are there to be used: a crowd of families or retirees or students or late-night dancers changes the OCCASION (when, with what food, who is driving, how long people stay, what the bartender has time for), and that is what you pitch to. A demographic is never a guess at taste: what people here drink is carried only by the evidence (the drink brands the crowd over-indexes on, the menu, the hours, the door's own site). Never write that a group drinks, orders, likes or prefers a drink because of who they are. When a fact says how this door's crowd compares with the city's bars (over-indexes, rare across the city, a lift), lead with what is distinctive about this door against the city, not with what every bar in town shares.",
  "Rules, few and hard:",
  "- True to the facts. Every line lists the fact ids it rests on in \"from\". Never state what the facts don't: no numbers, prices, names, events, menu items or features of the room beyond them. The angle may quote a number from a prep fact; a spoken line may quote only numbers in the facts.",
  "- Nobody outside the door knows what it stocks or pours. A spoken line states what the door has only when an S fact says so (cite it); otherwise it asks.",
  "- The ask is the rep's own words: never change it. A reply that offers a way to start uses the ask word for word.",
  "- Never tell the buyer what their own room is like ('Your regulars come in for afternoons', 'Families come in here'): they know, and it reads as if the rep has never been in a bar. Use what you know to pick what to say; ask about the room, or say what the product does for the occasion. A question, or an 'if/when …' sentence, may name the room.",
  "- Plain trade words, the way people talk at a bar. No slogans, no exclamation marks, no filler ('Totally', 'Exactly'), no 'partnership', 'elevate', 'curated', 'synergy'. Never say 'Qloo' in a spoken line, and never name the crowd's music or the other doors with the same crowd out loud.",
  "- Treat a guess in the facts as a guess.",
  "3. The OPENER: what the rep says walking in, in one breath, to whoever is behind the bar: hello, who they are ({rep} with the brand and what it is; Doors fills the name in, you are not given it), ONE short door-specific hook when the facts give a strong one, said as the rep's reason to be there, the way a rep would say it at the door (a brewpub: 'You brew your own, so I'm not after a tap.'; a dance hall: 'Your lesson nights are why I came by.'; a cocktail bar: 'I know this is a cocktail room, so I'm not after a spirits slot.'), never as a sighting ('I see you run lesson nights' is the data with 'I see' in front of it), then who buys here, in this door's terms (who looks after the cooler; is the bar manager around; who decides drinks for this location). One clause for the hook, never two; skip it when nothing is strong. 'When's a good time to catch them' only when it reads naturally. Nothing about the room's crowd out loud. Every opener must be unmistakably this door's. Up to 40 words.",
  "4. The MESSAGE: the first note to the door before the visit, asking for a time and a taste, never for the order: do not name the ask or a quantity in it, the visit is where the rep asks for that. subject: under ten words. body: short paragraphs, plain, 60 to 110 words: who {rep} is and what the product is, the one thing about this door that makes it worth ten minutes (the insight, said as a reason to meet, not as a description of their room), {when} where the rep says when they'll come by (Doors fills in the day and time, or 'one afternoon soon'), the city named once, and {rep} signing off. sms: the same as one text message under 280 characters, with {rep} and {when} too. No greeting filler, no 'I hope this finds you well'. Sign off with {rep}, never with the city ('See you in Austin' reads odd; the city goes in the body).",
  "Lengths: angle up to 90 words; to_buyer up to 45; each question up to 30; each point up to 45; each objection up to 15; each reply up to 50. Counts: 1 to 3 questions, 1 to 3 points, 0 to 3 pushback pairs. Fewer, sharper lines beat filler.",
  "Return ONLY JSON: {\"angle\": {\"text\": \"…\", \"from\": [\"R3\"]}, \"to_buyer\": {\"text\": \"…\", \"from\": [\"R3\",\"P2\"]}, \"questions\": [{\"text\": \"…?\", \"from\": [\"R4\"]}], \"points\": [{\"text\": \"…\", \"from\": [\"R2\",\"P3\"]}], \"pushback\": [{\"objection\": \"what this buyer will say\", \"reply\": \"what the rep says back\", \"from\": [\"R5\"]}], \"opener\": {\"text\": \"Hi, I'm {rep} with …\", \"from\": [\"R2\"]}, \"message\": {\"subject\": \"…\", \"body\": \"…\", \"sms\": \"…\", \"from\": [\"R3\",\"P2\"]}}.",
].join("\n");

// Anthropic structured output (output_config.format): the set's shape, so the reply always parses
const ITEM = { type: "object", properties: { text: { type: "string" }, from: { type: "array", items: { type: "string" } } }, required: ["text", "from"], additionalProperties: false };
export const TALK_FORMAT = {
  type: "json_schema",
  schema: {
    type: "object",
    properties: {
      angle: ITEM,
      to_buyer: ITEM,
      questions: { type: "array", items: ITEM },
      points: { type: "array", items: ITEM },
      pushback: { type: "array", items: { type: "object", properties: { objection: { type: "string" }, reply: { type: "string" }, from: { type: "array", items: { type: "string" } } }, required: ["objection", "reply", "from"], additionalProperties: false } },
      opener: ITEM,
      message: { type: "object", properties: { subject: { type: "string" }, body: { type: "string" }, sms: { type: "string" }, from: { type: "array", items: { type: "string" } } }, required: ["subject", "body", "sms", "from"], additionalProperties: false },
    },
    required: ["angle", "to_buyer", "questions", "points", "pushback", "opener", "message"],
    additionalProperties: false,
  },
};

// dropped: the lines of a first draft that failed validateTalkSet, so a second try can fix them
export function talkUser(tf, dropped = [], why = null) {
  const lines = tf.facts.map((f) => `${f.id} [${f.label}${f.prep ? "; prep only, never said in the room" : ""}]: ${f.text}`);
  const fix = why && !/passed$/.test(why) ? `\n\nA first draft was refused: ${why}. Write the whole set again and fix it.` : dropped.length ? `\n\nA first draft had lines that failed Doors' checks:\n${dropped.slice(0, 8).map((d) => `- ${d.where} "${d.text}": ${d.reason}`).join("\n")}\nWrite the whole set again and fix these.` : "";
  return `FACTS\n${lines.join("\n")}${fix}\n\nWrite this door's talking points as JSON.`;
}

// ---------- the validator ----------
const LIMIT = { angle: 700, to_buyer: 340, question: 240, point: 340, objection: 140, reply: 380, opener: 320, subject: 90, message: 900, sms: 300 };
// the placeholders are taken out before the name check (they aren't names) and put back by withTalkSet
const PLACEHOLDERS = /\{rep\}|\{when\}/g;
// what a room has: a statement (not a question, not "if you …") that says what's on its list, taps or cooler
const STOCK = /\b([Yy]ou('ve| have)? got (?:a|an|the|some|plenty|lots|[A-Z])|[Yy]ou already (have|carry|sell|serve|offer|brew|make|pour|list)|[Yy]ou (?:carry|sell|serve|offer|pour|list) (?:a|an|the|some|plenty|lots|[A-Z])|[Yy]our (taps?|cooler|list|menu|shelf|shelves|back bar|lineup|draft list|beer list|wine list|cocktail list) (has|have|is|are|includes?|carr(?:y|ies)))\b/;
// a brewery brews its own beer: that is what it is (Qloo's genre), not a claim about its stock
const BREWS_OWN = /\b(you brew|brew(?:s|ing)? (?:your|its|their) own|your own beer|house beers?|you make (?:your|the) beer)\b/i;
// events and features of a room: said only when a fact names them
const EVENTS = ["trivia", "karaoke", "open mic", "happy hour", "brunch", "game night", "game day", "game nights", "live music", "dj", "festival", "patio", "rooftop", "beer garden", "food truck", "pool table", "darts", "comedy", "drag", "bingo", "oysters", "wings", "tacos", "pizza", "burgers", "sports", "football", "basketball", "soccer", "baseball", "dog-friendly", "dogs", "outdoor"];
const OK_CAPS = new Set(["Qloo", "I", "I'm", "I'll", "I'd", "I've", "OK", "NA", "IPA", "IPAs", "ABV", "TV", "TVs", "Rep", "Hi", "Hey", "Hello", "Thanks", "Best", "Cheers", "Subject", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays", "Sundays", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]);
// words a sentence may start with that aren't names (a first word outside this list and the facts is taken as a name)
const STARTS = new Set(("a an the and but or so if when whether while since because then that this these those it it's its they they're their them there here what which who whom whose where why how would could can will should do does did is are was were be been have has had " +
  "we we're we'll we've our ours you you're you'll your yours i i'm i'll i'd i've my me he she his her one two some any every each no not none nothing all most many more less few lots plenty good great fair fine sure ok okay yes yeah right true " +
  "start starting try let let's ask tell give leave bring keep put pour open taste think see look come go get make take talk check pull swap say mind happy glad thanks thank sounds absolutely totally maybe perhaps also even just only still yet already " +
  "after before during for from in on at by with without about over under into onto out up down off than as like unlike instead plus once next last first second third other another same such both either neither guests people anyone someone everyone nobody " +
  "staff bartenders bartender managers owner owners buyers families parents drivers non-alcoholic nonalcoholic cold fresh light easy quick small big low high new local daytime weekend weekends lunch dinner morning evening night afternoon lead pitch offer show note mention cases cans bottles understood totally exactly honestly " +
  "lunch dinner nobody nothing somebody something anything everything worth fair enough mine yours ours theirs now then until unless whichever whatever whoever wherever between beyond behind along across " +
  "since because though although however otherwise meanwhile again never always often sometimes usually rarely cheers deal done fine right sure understood agreed noted fair point true enough honestly frankly " +
  "spend save stay hand serve carry drop grab set run sell buy call text send walk ship price park treat test watch hold stick skip push build cut split share count order pick drink eat sip pull get give go let move play read stop turn use wait work write catch find hear help know learn live love meet need pay plan reach stand win worth imagine picture consider compare expect assume guess bet figure past early late mid midweek weekday weeknight weeknights around close closing opening").split(" "));
// Jard web review R2 (10-24): "you walk up to the manager and say 'looks like you get music enthusiasts in here' … the
// shortest, most humiliating conversation of your life." A spoken statement never tells the buyer what their own room,
// crowd or hours are like ("Your regulars come in for afternoons", "Families come in here", "Your bar is loud at happy
// hour", "looks like it fits a room with a serious cocktail list"). Qloo's facts pick the angle; the line says what the
// product does, or asks. A question, or an "if/when …" sentence, may still name the room. → the matched words, or null.
const ROOM_SUBJ = /\b(?:(?:your|the|this) (?:crowd|regulars|guests|customers|clientele|patrons|room|locals)|(?:your|this) (?:bar|place|spot|restaurant|brewery|taproom|kitchen|patio|lounge|pub|tavern|venue))(?: here)?\s+(?:is|are|'s|’s|'re|’re|was|were|comes?|came|gets?|draws?|orders?|wants?|likes?|loves?|skews?|tends?|leans?|has|have|fills?|runs?|seems?|looks?|feels?|(?:is |was )?built|goes|go|stays?|shows? up|turns? up|hangs? out|picks?|reaches?|enjoys?|cares?|knows?)\b/i;
const ROOM_WHO = /\b(?:families|parents|kids|couples|groups|locals|tourists|students|professionals|people|folks|regulars|crowds?|fans|enthusiasts|lovers)\b(?: [a-z-]+){0,3}? (?:come|comes|go|stop|show up|turn up|hang out|pile|fill|gather|head)\b(?:[^.?!]*\b(?:here|in|this room|your)\b)/i;
const YOU_GET = /\byou (?:get|draw|attract|see|pull in|bring in)\s+(?:(?:a lot of|lots of|mostly|many|plenty of|a|an|the)\s+)?(?:[a-z-]+ )?(?:crowds?|families|groups|couples|locals|tourists|regulars|people|folks|guests|customers|students|professionals|fans|lovers|enthusiasts|drinkers|parents)\b/i;
const ROOM_FIT = /\b(?:(?:close to|just like|matches|match|same as|similar to) (?:your|the) (?:crowd|regulars|guests|customers)|in here|looks like (?:it|you|your|this)\b|a room (?:like yours|with|built)|fits (?:a room|your room|this room|the room)|rooms? like this one)\b/i;
const ASKING = /^\W*(?:which|what|who|whom|whose|how|why|where|when|do|does|did|is|are|was|were|would|could|can|will|should|have|has|any|anything)\b/i;
export function toldTheRoom(text) {
  for (const sent of String(text ?? "").split(/(?<=[.?!])\s+/)) {
    if (/^\W*(?:if|when|whether)\b/i.test(sent)) continue;
    // a question may name the room; a statement before it in the same sentence ("Your guests come in at midday, so can I
    // get you a can?") may not
    const said = !/\?["”’)]*\s*$/.test(sent) ? sent : ASKING.test(sent) ? "" : sent.split(/,\s*(?:so|and|but)\s+/i).slice(0, -1).join(", ");
    if (!said) continue;
    const m = ROOM_SUBJ.exec(said) ?? ROOM_WHO.exec(said) ?? YOU_GET.exec(said) ?? ROOM_FIT.exec(said);
    if (m) return m[0];
  }
  return null;
}
// a reply that offers a way to start (the start is always the rep's own ask, word for word)
export const OFFER = /\b(start (with|small|by)|to start|as a (trial|start)|first step|try (a|an|one|two|three|\d+))\b/i;
// the alcohol-alternative framing: a soft drink or an alcoholic drink is never sold as the non-alcoholic option (a truth
// check: it isn't one). An alcohol alternative is free to use it or not (g4: the "must say who it's for" rule is gone).
export const NA_FRAME = /\b(isn't drinking|aren't drinking|not drinking|non-?alcoholic|alcohol-free|zero-proof|without (the )?alcohol|sober|designated driver)\b/i;
const SENT = (s) => String(s).split(/(?<=[.?!])\s+/).filter(Boolean);
// Jard 10-25 ("so what"): a demographic is context for the occasion, never a guess at taste. A sentence that pairs a
// group with a taste claim ("Hispanic families like a lighter beer", "retirees go for wine", "students want cheap
// shots") is refused; the occasion is fine ("families at lunch", "retirees in at 4 pm"). A question is fine too.
const GROUP = "(?:hispanic|latino|latina|latinx|mexican|black|african[- ]american|asian(?:[- ]american)?|white|anglo|lgbtq?\\+?|gay|queer|lesbian|trans|jewish|muslim|catholic|christian|retirees?|seniors?|older (?:people|folks|guests|couples|crowd|regulars)|elderly|boomers?|millennials?|gen ?z|gen ?x|students?|college kids|young (?:people|crowd|professionals|guests)|twenty-?somethings|(?:in their )?(?:20s|30s|40s|50s|60s|twenties|thirties|forties|fifties)|men|women|guys|girls|ladies|families|parents|moms|dads|kids|working-class|blue-collar|professionals|tourists|immigrants?)";
const TASTE = "(?:drinks?|drinking|orders?|ordering|likes?|loves?|prefers?|wants?|go(?:es)? for|reach(?:es)? for|asks? for|buys?|stick(?:s)? to|lean(?:s)? toward|are into|is into|choose|pick)";
export const TASTE_GUESS = new RegExp(`\\b${GROUP}\\b(?:[^.?!]{0,40}?)\\b${TASTE}\\b(?:[^.?!]{0,60}?)\\b(?:beer|beers|ipa|ipas|lager|pils|pilsner|stout|wine|wines|cocktails?|spirits?|whiske?y|tequila|mezcal|vodka|gin|rum|seltzer|cider|shots?|drinks?|non-?alcoholic|alcohol-free|na\\b|soda|mocktails?|margaritas?|[a-z]+ brand)\\b`, "i");
export const tasteGuess = (text) => { for (const sent of SENT(String(text ?? ""))) { if (/\?\s*$/.test(sent)) continue; const m = TASTE_GUESS.exec(sent); if (m) return m[0]; } return null; };
const lc = (s) => String(s).toLowerCase();

// → {ok, reason?} for one line. where: "angle" | "to_buyer" | "question" | "point" | "objection" | "reply"
export const cityNames = (t) => { const s = str(t); const short = s.replace(/[- ]Dade County$| County$/i, "").trim(); return [...new Set([s, short, ...(/^new york$/i.test(short) ? ["New York City", "NYC"] : /^new york city$/i.test(short) ? ["New York"] : [])])].filter(Boolean); };
export function checkTalkLine(text, where, tf, from = []) {
  const raw = str(text);
  const s = (where === "message" ? raw.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n") : raw.replace(/\s+/g, " ")).replace(PLACEHOLDERS, (m) => (m === "{rep}" ? "Rep" : "Thursday")); // the placeholders read as a name and a day for the checks
  if (s.length < (where === "objection" ? 6 : 12)) return { ok: false, reason: "too short" };
  if (s.length > (LIMIT[where] ?? 300)) return { ok: false, reason: "too long" };
  if (/[!*`]/.test(s) || (where !== "message" && /\n/.test(s))) return { ok: false, reason: "not plain" };
  if (where === "message" && !raw.includes(WHEN)) return { ok: false, reason: "the message doesn't say when ({when} is missing)" };
  // Jard 10-24 note 5 (enforced 10-26): the first message asks for a time and a taste, never for the order: the ask's
  // own words, or an order line ("the ask is …", "aim: …", "start with …", "first step …"), send it back
  if ((where === "message" || where === "sms") && ((tf.ask && lc(s).includes(lc(tf.ask))) || /\b(the|my|our|only) ask\b|\baim:|\bfirst step\b|\bstart(ing)? with\b|\b(one|two|a) (case|cases|keg|kegs|sixtel|bottle|bottles)\b/i.test(s))) return { ok: false, reason: "the message names the order: it asks for a time and a taste, the visit asks for the order" };
  // the city as people write it: Qloo's locality may be "Los Angeles County" or "Miami-Dade County" (the saved runs);
  // "Los Angeles" or "Miami" in the note names the city (talkmax 10-28: every LA first draft was losing its message)
  if (where === "message") { const cityF = tf.facts.find((f) => f.label === "City"); if (cityF && !cityNames(cityF.text).some((n) => raw.includes(n))) return { ok: false, reason: `the message doesn't name the city (${cityF.text})` }; }
  const ids = new Set(tf.facts.map((f) => f.id));
  const cites = (Array.isArray(from) ? from : []).map(str).filter(Boolean);
  if (!["objection", "reply", "to_buyer", "opener", "subject", "sms"].includes(where) && !cites.length) return { ok: false, reason: "cites no fact" };
  if (cites.some((c) => !ids.has(c))) return { ok: false, reason: "cites a fact that isn't there" };
  if (where === "angle" && !cites.some((c) => /^[RSD]/.test(c))) return { ok: false, reason: "cites nothing about the door" };
  const all = tf.facts.map((f) => f.text).join(" \n ");
  const low = lc(all);
  const own = [tf.ask, tf.brand, ...tf.facts.filter((f) => !["room", "site", "deep"].includes(f.kind)).flatMap((f) => [f.text, ...f.text.split(/\s+·\s+/)])];
  // g4: core.js BANNED_PITCH (stocks, pours, carries, distribute) is Doors' own-words guard; a rep says pour and stock all
  // day, so a written line is held only off the hype words and the slogan words
  const hype = BANNED_HYPE.exec(s);
  if (hype) return { ok: false, reason: `banned word (${hype[0]})` };
  if (BANNED_WORDING.test(s)) return { ok: false, reason: `Doors' wording (${BANNED_WORDING.exec(s)[0]}): say "drink like", and no scores` };
  // numbers and money only as the facts have them (the angle may use a prep fact's numbers; the facts list holds them too)
  for (const n of s.match(/\d+(?:\.\d+)?/g) ?? []) if (!all.includes(n)) return { ok: false, reason: `a number not in the facts (${n})` };
  // names: a capitalised word not at the start of a sentence must be in the facts (no invented people or brands)
  for (const sent of SENT(s)) {
    const words = sent.replace(/^["“'(]+/, "").split(/\s+/);
    const first = words[0]?.replace(/[.,;:?!"”')]+$/g, "").replace(/['’]s$/, "") ?? "";
    // a sentence's first word is a name only when it reads like one: "Dave the owner …", "Maria said …", "Dave Smith …"
    const next = words[1]?.replace(/[.,;:?!"”')]+$/g, "") ?? "";
    const nameLike = /^[A-Z]/.test(next) || /^(the|said|says|told|from|at|who|is|was|and|owns|runs|manages|mentioned)$/.test(next);
    if (/^[A-Z][a-z]/.test(first) && !/ing$/.test(first) && nameLike && !OK_CAPS.has(first) && !STARTS.has(first.toLowerCase()) && !all.includes(first) && !all.toLowerCase().split(/[^a-z'-]+/).includes(first.toLowerCase())) return { ok: false, reason: `a name not in the facts (${first})` };
    for (const w0 of words.slice(1).flatMap((x) => x.split(/[–—\/-]/))) { // "Thu–Sun", "Fri/Sat" are two words
      const w = w0.replace(/^["“'(]+|[.,;:?!"”')]+$/g, "").replace(/['’]s$/, "");
      if (!/^[A-Z]/.test(w) || OK_CAPS.has(w)) continue;
      if (!all.includes(w) && !low.includes(w.toLowerCase())) return { ok: false, reason: `a name not in the facts (${w})` }; // "Secret Beach IPA" for the menu's "Secret beach IPA" is the same name
    }
  }
  for (const e of EVENTS) if (new RegExp(`\\b${e}\\b`, "i").test(s) && !low.includes(e.replace(/s$/, ""))) return { ok: false, reason: `an event or feature not in the facts (${e})` };
  if (where !== "objection") { const g = tasteGuess(s); if (g) return { ok: false, reason: `guesses a group's taste from who they are ("${g}"): a demographic shapes the occasion, the evidence carries what people drink` }; }
  const spoken = where !== "angle";
  // what the room has: only a statement a fact from the door's own site backs: the line cites an S fact, or a D fact
  // (lane deep) that carries the site's url (gigbot 10-26: enrich verified the quote, so it counts the same)
  const sited = cites.some((c) => c.startsWith("S") || (c.startsWith("D") && Boolean(tf.facts.find((f) => f.id === c)?.url)));
  if (spoken) {
    if (/\bqloo\b/i.test(s)) return { ok: false, reason: "names Qloo out loud" };
    const told = where === "objection" ? null : toldTheRoom(s); // the objection is the buyer's own words
    if (told) return { ok: false, reason: `tells the buyer what their own room is like ("${told}"): ask it, or say what the product does` };
    if (where !== "objection" && /\b(every|all|most|other|lots of|many|a lot of) (the )?(bars?|breweries|brewery|restaurants?|rooms?|places?|taprooms?|venues?|accounts?|spots?)\b/i.test(s)) return { ok: false, reason: "a claim about other bars" };
    const named = tf.avoid.filter((n) => !(tf.drinks ?? []).includes(n)).find((n) => mentions(s, [n]));
    if (named) return { ok: false, reason: `names ${named} out loud (an artist or another door)` };
    const brewery = tf.venueType === "brewery" || /\bbrew/i.test(tf.facts.find((f) => f.label === "What it is")?.text ?? "");
    if (!sited) for (const sent of SENT(s)) if (!sent.endsWith("?") && !/^(if|when|whether|since|because|as)\b/i.test(sent) && STOCK.test(sent) && !(brewery && BREWS_OWN.test(sent))) return { ok: false, reason: "says what the room has (ask it, or cite the door's own site)" };
  } else if (mentions(s, tf.avoid.filter((n) => !(tf.drinks ?? []).includes(n)).filter((n) => !all.includes(n)))) return { ok: false, reason: "names something not in the facts" };
  // the rep's own words (their ask "… as a zero-proof option", their product line) are theirs: taken out before the test
  const notOwn = own.filter((x) => str(x).length >= 4).sort((a, b) => b.length - a.length).reduce((t, x) => t.split(lc(x)).join(" "), lc(s));
  if (spoken && !tf.na && NA_FRAME.test(notOwn)) return { ok: false, reason: "pitches it as the non-alcoholic option (it isn't one)" };
  if (where === "question" && !s.endsWith("?")) return { ok: false, reason: "not a question" };
  if (where === "point" && /\?$/.test(s)) return { ok: false, reason: "a point, not a question" };
  if (where === "reply" && OFFER.test(s) && tf.ask && !lc(s).includes(lc(tf.ask))) return { ok: false, reason: "changes the ask" };
  // what a room's guests already buy: nobody outside the door knows (a question may ask it; a site fact may say it)
  if (spoken && !sited && /\b(your|the|their) (guests|customers|regulars|crowd) (already )?(buy|buys|order|orders|drink|drinks|like|likes|love|loves|ask for)\b|\balready (buy|order|drink)\b/i.test(s) && !/\?$/.test(s)) return { ok: false, reason: "says what the room's guests buy" };
  if (tf.ask && lc(s).split(lc(tf.ask)).length > 2) return { ok: false, reason: "says the ask twice" };
  return { ok: true };
}

// raw: the model's JSON (parsed). → {ok, set?, dropped: [{where, text, reason}], reason?}
// set: {angle: {text, from}, toBuyer: {text, from} | null, questions: [{text, from}], points: [{text, from}],
//       pushback: [{objection, reply, from}]}
// g4: the angle (the insight) must pass, plus at least one question and one point; pushback may be empty; the set must
// lean on at least one fact about the door.
export function validateTalkSet(raw, tf) {
  const dropped = [];
  const keep = (where, text, from) => {
    const r = checkTalkLine(text, where, tf, from);
    if (!r.ok) dropped.push({ where, text: str(text).slice(0, 200), reason: r.reason });
    return r.ok;
  };
  const one = (x, where) => (x && typeof x === "object" && keep(where, x.text, x.from) ? { text: str(x.text).replace(/\s+/g, " "), from: (Array.isArray(x.from) ? x.from : []).map(str) } : null);
  const many = (xs, where, max) => (Array.isArray(xs) ? xs : []).filter((x) => x && typeof x === "object" && keep(where, x.text, x.from)).slice(0, max).map((x) => ({ text: str(x.text).replace(/\s+/g, " "), from: (x.from ?? []).map(str) }));
  if (!raw || typeof raw !== "object") return { ok: false, reason: "no JSON", dropped };
  // g6: the opener and the message are optional on the way out (a failing one leaves the template's in place)
  const msg = raw.message && typeof raw.message === "object" ? raw.message : null;
  const message = msg && keep("subject", msg.subject, msg.from) && keep("message", msg.body, msg.from) && keep("sms", msg.sms, msg.from)
    ? { subject: str(msg.subject).replace(/\s+/g, " "), body: str(msg.body).replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n"), sms: str(msg.sms).replace(/\s+/g, " "), from: (Array.isArray(msg.from) ? msg.from : []).map(str) }
    : null;
  const set = {
    opener: one(raw.opener, "opener"),
    message,
    angle: one(raw.angle, "angle"),
    toBuyer: one(raw.to_buyer ?? raw.toBuyer, "to_buyer"),
    questions: many(raw.questions, "question", 3),
    points: many(raw.points, "point", 3),
    pushback: (Array.isArray(raw.pushback) ? raw.pushback : [])
      .filter((p) => p && typeof p === "object" && keep("objection", p.objection, p.from) && keep("reply", p.reply, p.from))
      .slice(0, 3)
      .map((p) => ({ objection: str(p.objection).replace(/^["“]|["”]$/g, ""), reply: str(p.reply), from: (Array.isArray(p.from) ? p.from : []).map(str) })),
  };
  if (!set.angle) return { ok: false, reason: "no angle (the insight) passed", dropped };
  if (set.questions.length < 1) return { ok: false, reason: "no question passed", dropped };
  if (set.points.length < 1) return { ok: false, reason: "no point passed", dropped };
  const doorCites = new Set([set.angle, set.toBuyer, ...set.questions, ...set.points, ...set.pushback].filter(Boolean).flatMap((x) => x.from).filter((c) => /^[RSD]/.test(c)));
  if (doorCites.size < 1) return { ok: false, reason: "not this door's: no fact about the door used", dropped };
  return { ok: true, set, dropped };
}

// ---------- onto the screen ----------
// The template's talking points (talk.js talkPoints) + a checked model set → the lines to show. The template keeps
// "Before you walk in" (its angle line swapped for the model's), the opener and the ask; the model's questions, points
// and pushback replace the template's; the price-per-pour point (lib/ask.js, Doors' own sums) stays first.
// stored: {set, model, key}. Returns t unchanged (by: "template") when there's no set. Nothing on the screen says which
// model wrote the lines (Jard 10-25: "our users don't need to know how the sausage is made"); the privacy page does.
// fill: {rep: the rep's first name, when: "Tuesday around 2:10 pm" | null} for the {rep} and {when} placeholders
export const fillPlaceholders = (text, { rep = "", when = null } = {}) => String(text ?? "")
  .replace(/\{rep\}/g, str(rep))
  .replace(/\{when\}/g, when ? str(when) : "one afternoon soon")
  .replace(/\bI'm\s+with\b/g, "I'm with").replace(/[ \t]{2,}/g, " ").replace(/ ,/g, ",").replace(/\n[ \t]+/g, "\n").trim();
export function withTalkSet(t, stored, fill = {}) {
  const out = { ...t, before: [...t.before], beforeKinds: [...(t.beforeKinds ?? [])], points: [...t.points] };
  const set = stored?.set;
  if (!set || t.visit === "return") return out;
  const ai = out.beforeKinds.indexOf("angle");
  if (set.angle) {
    if (ai >= 0) out.before[ai] = `Your angle: ${set.angle.text}`;
    else (out.before.push(`Your angle: ${set.angle.text}`), out.beforeKinds.push("angle"));
  }
  const margin = t.points.filter((p) => p.margin);
  return {
    ...out,
    opener: set.opener ? fillPlaceholders(set.opener.text, fill) : t.opener,
    lines: { ...(t.lines ?? {}), opener: set.opener ? "model" : t.lines?.opener ?? "template" },
    // the written message, placeholders filled; lib/stopmodel.js puts it on the note
    message: set.message ? { subject: fillPlaceholders(set.message.subject, fill), body: fillPlaceholders(set.message.body, fill), sms: fillPlaceholders(set.message.sms, fill) } : null,
    toBuyer: set.toBuyer?.text ?? t.toBuyer,
    written: { angle: Boolean(set.angle), toBuyer: Boolean(set.toBuyer), opener: Boolean(set.opener), message: Boolean(set.message) }, // lib/provenance.js: which lines came from the door's facts
    questions: set.questions.map((q) => q.text),
    points: [...margin, ...set.points.map((p) => ({ text: p.text, fact: null, model: true, from: p.from }))],
    pushback: set.pushback.map((p) => ({ objection: p.objection, reply: p.reply, model: true })),
    facts: [],
    factRefs: [],
    by: "model",
    model: stored.model ?? null,
    talkKey: stored.key ?? null,
  };
}

// A baked set's key (scripts/talk-bake.mjs, the demo and the examples): the door, the brand, what it is and the ask. A
// baked set is always checked again against today's facts before it shows, so a stale one can't slip a line through.
// drinkers (round 3, the saved runs' bake, gigbot 10-27): the key also names the rep's drinker brands, because a door's
// facts change with the drinker (its rank and match, "the rep's drinkers also drink"); a saved run's sets are keyed
// that way, the examples' sets keep the short key, and pickTalkSet tries the long key first.
export const bakedTalkKey = ({ id, profile = {}, ask = "", drinkers = false }) => [id, profile.brand, profile.what, ask, ...(drinkers ? [(profile.drinks ?? []).map((d) => str(d?.name)).filter(Boolean).sort().join("+")] : [])].map((x) => str(x).toLowerCase()).join("|");

// talkSets: {live: {key: stored}, baked: {bakedKey: stored}} (the browser's cache and the city's baked file).
// → {set, model, key, baked?} that passes validateTalkSet against tf now, or null.
export function pickTalkSet(talkSets, { key, id, profile, ask }, tf) {
  if (!talkSets) return null;
  const baked = (drinkers) => { const b = talkSets.baked?.[bakedTalkKey({ id, profile, ask, drinkers })]; return b ? { ...b, baked: true } : null; };
  const tries = [talkSets.live?.[key] ? { ...talkSets.live[key], key } : null, baked(true), baked(false)];
  for (const t of tries) {
    if (!t?.set) continue;
    const r = validateTalkSet(t.set, tf);
    if (r.ok) return { set: r.set, model: t.model, key: t.key ?? key, baked: Boolean(t.baked) };
  }
  return null;
}
