// R9 deep data: Qloo's cultural signals, each wired into ONE decision, each switchable off.
// Pure, no I/O: the browser, the Worker, the planner and the tests share it.
//
//   key     signal (Qloo)                                   decision it changes
//   "tod"   room tag time_of_day_fit (on every door, 0 calls) which day a door goes on (planner), the arrival advice
//   "lead"  room tags beverage_offering, menu_highlight,     the opener's question, the ask, one gate question
//           interests (0 calls)
//   "hooks" brand → TV shows / podcasts / destinations      the small-talk hook in the talking points (only items that
//           (1 call per type per brand, cached)             set this brand apart from its category: see hookItems)
//   "heat"  brand × city → locality heatmap (1 call, rank)  which part of town the first day works
//
// Authority (docs/CULTURAL-SLOTS.md §2): every output here is source "qloo". It beats Doors' defaults (the global
// service clock, the kind's default ask) and never the rep: a profile ask (stated) or a correction wins. Every changed
// line carries `src` {kind: "qloo", field, tags, captured?} so the stop, the export and the agent can show where it came
// from. Nothing here is about a person: no customer_identity or age_range tags are kept (core.tagFamilies).
//
// Ablation: deepOn(key, off) is false for a key in `off` (a list) or, when no list is passed, in
// the page-wide list set by setDeepOff() (?deep=off or ?deepOff=tod,lead on the URL). Off = the pre-R9 output.

export const DEEP_KEYS = ["tod", "lead", "hooks", "heat"];
let pageOff = new Set();
export function setDeepOff(list) {
  const l = list === true || list === "all" || list === "off" ? DEEP_KEYS : Array.isArray(list) ? list : String(list ?? "").split(",");
  pageOff = new Set(l.map((x) => String(x).trim()).filter((x) => DEEP_KEYS.includes(x)));
  return [...pageOff];
}
export const deepOn = (key, off = null) => !(off == null ? pageOff : new Set(off === true ? DEEP_KEYS : off)).has(key);
// ?deep=off | ?deepOff=tod,hooks → the list (for the UI's one-time read of location.search)
export function deepOffFromSearch(search = "") {
  const q = new URLSearchParams(search);
  if (q.get("deep") === "off") return [...DEEP_KEYS];
  return (q.get("deepOff") ?? "").split(",").map((x) => x.trim()).filter((x) => DEEP_KEYS.includes(x));
}

// The guided demo's planner keeps "tod" and "heat" off: its script walks a fixed Tuesday (Nomadic Beerworks visited out of order,
// the baked roads in public/data/demo/demo.json). The demo's stops still show every other signal. Remove "tod" here and
// re-run scripts/bake-demo.mjs to show the day choice in the demo too.
export const DEMO_DEEP_OFF = ["tod", "heat"];

const list = (xs) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
const lc = (s) => String(s ?? "").toLowerCase();
const article = (s) => (/^[aeiou]/i.test(s) && !/^(one|uni|use|eu)/i.test(s) ? "an" : "a");
// Live check I: a product phrase mid-sentence: its first letter lowercased ("Small-batch …" → "small-batch …"), unless
// that word is a proper adjective ("Irish-style whiskey", "Kentucky bourbon", "Japanese whisky") or an acronym ("IPA")
const PROPER = /^(american|irish|scotch|scottish|japanese|mexican|kentucky|tennessee|french|italian|belgian|german|english|british|canadian|caribbean|jamaican|cuban|spanish|polish|russian|swedish|danish|dutch|czech|bavarian|oaxacan|texas|texan|california|californian|napa|sonoma|oregon|vermont|new (england|york|mexico|orleans|zealand)|nordic|mediterranean|cajun|creole|hawaiian|korean|chinese|thai|vietnamese|indian|peruvian|brazilian|argentine|chilean|australian)\b/i;
// Jard 10-23 #14: a name the rep typed in Title Case ("Green Bottles Beer") keeps its casing: only a sentence-case
// phrase (no later word starting Capital-lowercase; acronyms like "IPA" and proper adjectives like "Irish" don't
// count) is lowercased.
const named = (s) => s.split(/\s+/).slice(1).some((w) => /^[A-Z][a-z]/.test(w) && !PROPER.test(w));
export const lowerFirst = (s) => (PROPER.test(String(s ?? "")) || named(String(s ?? "")) ? String(s ?? "") : String(s ?? "").replace(/^[A-Z](?![A-Z])/, (c) => c.toLowerCase()));
export const tagsOf = (v) => (v?.tags && typeof v.tags === "object" ? v.tags : {});
const qsrc = (field, tags, captured = null) => ({ kind: "qloo", field: `tag:${field}`, tags, ...(captured ? { captured } : {}) });

// ---------- 1. time of day ("tod") ----------
// Qloo's time_of_day_fit says when the room's guests go. A rep wants the buyer when the room is NOT full, so an
// arrival inside the room's crowd times is worse than one outside them (the industry rule of thumb the existing
// arrival advice already uses: "avoid walking in during service"). Clock per tag, minutes after midnight.
export const TOD_CLOCK = {
  "Early morning": [5 * 60, 8 * 60],
  Morning: [8 * 60, 11 * 60],
  Midday: [11 * 60, 14 * 60],
  Afternoon: [14 * 60, 17 * 60],
  Evening: [17 * 60, 21 * 60],
  "Late night": [21 * 60, 26 * 60],
};
const TOD_ORDER = Object.keys(TOD_CLOCK);
// A room tagged for 4+ times of day (or "All day") is busy from morning to night by Qloo's tags: no quiet time to aim
// for, so no signal.
export function crowdTimes(v) {
  const t = (tagsOf(v).tod ?? []).filter((x) => TOD_CLOCK[x]);
  if (!t.length || t.length >= 4 || (tagsOf(v).tod ?? []).includes("All day")) return [];
  return TOD_ORDER.filter((x) => t.includes(x));
}
const inTimes = (min, times) => times.some((x) => min >= TOD_CLOCK[x][0] && min < TOD_CLOCK[x][1]);
// Share of a window's minutes [from, to) that fall in the room's crowd times (0–1).
export function crowdShare(from, to, times) {
  if (!times?.length || !(to > from)) return 0;
  let n = 0;
  for (let m = from; m < to; m += 5) if (inTimes(m, times) || inTimes(m + 1440, times)) n++;
  return n / Math.ceil((to - from) / 5);
}
// Planner weight: a day whose whole window sits in the room's crowd costs TOD_MIN minutes of driving (a door is worth 15
// plus up to 45 for its rank, V4.1): enough to send a door to the day that catches it quiet, not to drop a top room.
export const TOD_MIN = 4;
const timesText = (times) => lc(list(times.map((x) => (x === "Midday" ? "midday" : x))));
// The arrival line from the room's crowd times, or null (no signal). eta: minutes after midnight; clock: (min) → the time
// as a person says it (talk.js humanTime: "a little after 3 pm").
// call: "call first: (512) 939-2308" or null.
// open: the room's own hours say it is open at the arrival (talk.js span). Without that, a room Qloo puts only in the
// evening and late night may still be shut in the afternoon (personas, final round: WYLD Bar at 1 pm): say so.
export function todAdvice(v, eta, clock, call = null, { open = false } = {}) {
  const times = crowdTimes(v);
  if (!times.length || !Number.isFinite(eta)) return null;
  const at = clock(eta);
  const src = qsrc("time_of_day_fit", times);
  if (inTimes(eta, times) || inTimes(eta + 1440, times)) return { kind: "in-crowd", text: `Qloo puts this door's crowd in the ${timesText(times)}: getting there ${at}, you may walk into it. Keep it to five minutes${call ? `, or ${call}` : ", or ask when it's quiet and come back"}.`, src };
  const first = TOD_CLOCK[times[0]][0];
  if (eta < first && first >= TOD_CLOCK.Evening[0] && !open) return { kind: "ahead", text: `Qloo puts this door's crowd in the ${timesText(times)}: getting there ${at}, it may not be open yet. ${call ? `${call[0].toUpperCase()}${call.slice(1)}` : "Check its hours"}, or come right when it opens.`, src, closedRisk: true };
  return eta < first
    ? { kind: "ahead", text: `Qloo puts this door's crowd in the ${timesText(times)}: getting there ${at}, you're ahead of it, a good time to catch a manager.`, src }
    : { kind: "after", text: `Qloo puts this door's crowd in the ${timesText(times)}: by ${at} it has passed, a good time to catch a manager.`, src };
}

// ---------- 2. what to lead with ("lead") ----------
// From the room's beverage_offering, menu_highlight and interests tags × the product's kind. Qloo doesn't know what a
// room stocks of YOUR category, so every line stays a question (talk.js rule); a dish Qloo says the room is known for
// may be named. → {question?, ask?, gate?, src[]} or null. kind/isNA/style from talk.js (productKind, styleOf).
const POURS_SPIRITS = ["Full bar", "Spirits", "Cocktails", "Specialty cocktails", "Specialty alcoholic", "Aperitifs and digestifs"];
const POURS_BEER = ["Beer", "Craft beer", "Local beer", "Full bar"];
const POURS_WINE = ["Wine", "Full bar"];
const COCKTAIL = /cocktail|mixolog/i;
// R9 proof finding 5: Qloo's "Non alcoholic only" can be wrong (Armitage Alehouse carries it next to "Full bar",
// "Spirits" and "Beer"). It counts only when no alcohol tag sits beside it and the room's name and genre don't say it
// pours (an alehouse, a pub, a bar); otherwise it is dropped and the gate reads the room's other tags.
const POURS_ANY = new Set([...POURS_SPIRITS, ...POURS_BEER, ...POURS_WINE]);
export const POURING_ROOM = /\b(ale ?house|pub|tavern|tap ?room|tap ?house|brew(ery|ing|pub|house|s)?|bar|saloon|beer|beers|wine|winery|cocktails?|distillery|cidery|lounge|speakeasy)\b/i;
// dishes a drink is ordered with (first match in the room's own menu_highlight order)
const PAIRS = /\b(wings?|tacos?|burgers?|pizza|bbq|barbecue|brisket|ribs|fried chicken|fish and chips|nachos|pretzels?|hot dogs?|sausages?|oysters|ramen|curry|chili|queso|fries|cheese curds|sandwich(es)?|chilaquiles|pho|dumplings|poke|sushi)\b/i;
export function leadFor(v, { kind = "other", isNA = false, style = "", turn = null } = {}) {
  const t = tagsOf(v);
  const bev = t.bev ?? [];
  const menu = t.menu ?? [];
  const interests = t.interests ?? [];
  if (!bev.length && !menu.length && !interests.length) return null;
  const naOnly = bev.includes("Non alcoholic only") && !bev.some((x) => POURS_ANY.has(x)) && !POURING_ROOM.test(`${v?.name ?? ""} ${String(v?.genre ?? "").replace(/[:_]/g, " ")}`);
  const bevT = bev.includes("Non alcoholic only") && !naOnly ? bev.filter((x) => x !== "Non alcoholic only") : bev;
  const has = (xs) => xs.some((x) => bevT.includes(x));
  const out = { src: [] };
  const alcohol = !isNA && kind !== "soft";
  // gate: Qloo's drinks tags miss the product's category → ask before pitching, and the ask turns into a sample. The
  // question names only what the tags say the room pours ("or only beer and wine" when they say beer or wine).
  const miss = bevT.length && ((alcohol && kind === "spirit" && !has(POURS_SPIRITS)) || (alcohol && kind === "wine" && !has(POURS_WINE)) || (alcohol && ["beer", "cider"].includes(kind) && !has(POURS_BEER)) || (alcohol && naOnly));
  if (miss) {
    out.gate = naOnly ? "Do you serve any alcohol at all, or is it all non-alcoholic here?" : `Do you serve ${kind === "spirit" ? (has(POURS_BEER) || has(POURS_WINE) ? "spirits, or only beer and wine" : "spirits here") : kind === "wine" ? "wine here" : "beer here"}?`;
    out.ask = "a sample for the team, if it fits your drinks list";
    out.src.push(qsrc("beverage_offering", bevT));
    return out;
  }
  const cocktails = bev.filter((x) => /cocktail/i.test(x)).concat(interests.filter((x) => COCKTAIL.test(x)));
  const dish = menu.find((m) => PAIRS.test(m));
  // live check I: the rep's own words keep their capitals ("Irish-style"); only a plain first word loses its capital
  const word = lowerFirst(String(style ?? "").trim()) || (isNA ? "non-alcoholic option" : "drink");
  if (kind === "spirit" && !isNA && cocktails.length) {
    out.question = `Which of your cocktails could take a new ${word}?`;
    if (bev.includes("Specialty cocktails") || interests.some((x) => COCKTAIL.test(x))) out.ask = "one bottle for a cocktail on the menu";
    out.src.push(qsrc(bev.some((x) => /cocktail/i.test(x)) ? "beverage_offering" : "interests", [...new Set(cocktails)]));
  } else if (isNA && kind !== "soft" && (bev.includes("Specialty non alcoholic") || cocktails.length)) {
    const na = bev.includes("Specialty non alcoholic");
    out.question = na ? "Your non-alcoholic drinks: which ones do people come back for?" : "When one of your regulars isn't drinking, do they get something off the cocktail list, or a soda?";
    out.src.push(qsrc(na ? "beverage_offering" : bev.some((x) => /cocktail/i.test(x)) ? "beverage_offering" : "interests", na ? ["Specialty non alcoholic"] : [...new Set(cocktails)]));
  } else if (dish && (isNA || ["beer", "cider", "seltzer", "soft"].includes(kind))) {
    // R9 polish: a question, not a claim about the menu: Qloo's menu tag names the dish, the rep asks
    // judge pass 3 (N12): one wording on every room read as a template; the room picks one of three, always the same one
    const d = lc(dish);
    const ways = [`Do people order food with their drinks here, like the ${d}?`, `What do people drink with the ${d} here?`, `When someone orders the ${d}, what do they drink with it?`];
    // judge pass 4 (N12): still two rooms on one day read alike; turn = how many rooms before this one on the day led
    // with a dish (stopModel), so a day's dish questions take each wording in turn. No day: the room's own pick.
    out.question = ways[Number.isInteger(turn) ? turn % ways.length : [...String(v?.id ?? v?.name ?? "")].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % ways.length];
    out.dish = true;
    out.src.push(qsrc("menu_highlight", [dish]));
  } else if (["beer", "cider"].includes(kind) && !isNA && (bev.includes("Local beer") || bev.includes("Craft beer"))) {
    out.question = `How often do you rotate in a new ${bev.includes("Local beer") ? "local " : ""}${word}?`;
    out.src.push(qsrc("beverage_offering", bev.filter((x) => /beer/i.test(x))));
  }
  return out.question || out.ask ? out : null;
}

// ---------- 2b. the angle (Jard 10-24 #5, OPENERS-PLAN.md) ----------
// What a rep leads with at this door, picked the way a rep preps (OPENERS-RESEARCH.md §2): Qloo's drinks tags find the
// gap, the crowd text and interests pick the story, the menu says what to order. None of it is said as a fact about the
// room: `why` is the rep's private prep (it names Qloo's tags), `say` is what the rep says to the buyer (the angle in
// one sentence + an offer to taste), `mail` the same angle as one line of the first email (no question). Qloo doesn't
// know what a room stocks, so `why` says what to check in the room, never what is there.
// → {key, why, say, mail, src[]}; `order` (prep: buy something first, the dish Qloo says it's known for) is always set.
const FAMILY = /\b(famil(y|ies)|kids?|children|parents|food trucks?|outdoor)\b/i;
const DAYTIME = /\b(coffee|remote work(ers)?|laptops?|study(ing)?|students?|freelanc\w*|working)\b/i;
const SPORTS = /\b(sports?|game days?|game nights?|watch(ing)? (the )?games?)\b/i; // not "board games" or "arcade games"
const NAMED_COCKTAIL = /\b(margarita|old fashioned|negroni|martini|manhattan|paloma|daiquiri|mojito|spritz|mule|sazerac)\b/i;
export function warmMonth(date, lat) {
  const m = /^\d{4}-(\d{2})-\d{2}$/.exec(String(date ?? ""));
  if (!m) return false;
  const mo = Number(m[1]);
  const a = Math.abs(Number(lat));
  const [from, to] = !Number.isFinite(a) ? [5, 9] : a < 33 ? [3, 11] : a < 37 ? [4, 10] : [5, 9];
  return mo >= from && mo <= to;
}
const qcrowd = (phrase) => ({ kind: "qloo", field: "customer_demographics_description", tags: [phrase] });
// tags: false = the "lead" ablation (Qloo's room tags off): only the crowd text can pick the angle.
// date: the visit's "YYYY-MM-DD" (the patio angle only in the warm months for the room's latitude; no date, no patio)
// eta: the planned arrival, minutes after midnight (the lunch angle only before LUNCH_BY; no time, no lunch angle)
export const LUNCH_BY = 14 * 60 + 30;
export function angleFor(v, { kind = "other", isNA = false, type = "bar", style = "", tags = true, date = null, eta = null } = {}) {
  const t = tags ? tagsOf(v) : {};
  const bev = t.bev ?? [], menu = t.menu ?? [], interests = t.interests ?? [], amb = t.ambience ?? [];
  const crowd = String(v?.crowd ?? "");
  const genre = lc(String(v?.genre ?? "").replace(/[:_]/g, " "));
  const dish = menu.find((m) => PAIRS.test(m));
  const order = dish ? `Order something and pay for it before you ask for anyone (a coffee or a soda is fine). If you're hungry, the ${lc(dish)} ${/s$/.test(lc(dish)) ? "are" : "is"} what they're known for.` : "Order something and pay for it before you ask for anyone (a coffee or a soda is fine).";
  const orderSrc = dish ? [qsrc("menu_highlight", [dish])] : [];
  const taste = kind === "spirit" || kind === "wine" ? "a taste" : "one cold";
  const drink = /beer|\bipa\b|lager|\bales?\b|stout|pils|porter|hazy|k[oö]lsch/i.test(String(style)) || kind === "beer" ? "beer" : "drink"; // an NA gin is "a drink", not "a beer"
  const word = lowerFirst(String(style ?? "").trim());
  const soft = kind === "soft";
  const na = isNA && !soft;
  // a signal from the tags first (named), else a phrase from the crowd text (quoted as Qloo's profile mentions it)
  const tagHit = (re, xs) => [...new Set(xs.filter((x) => re.test(x)))];
  const crowdHit = (re) => (re.exec(crowd)?.[0] ?? null);
  const sig = (re, xs) => {
    const tags = tagHit(re, xs).slice(0, 1); // one tag names the signal ("coffee culture", not "… and coffee and tea")
    if (tags.length) return { said: `Qloo's tags for this room include ${list(tags.map(lc))}`, src: qsrc(xs === bev ? "beverage_offering" : interests.some((x) => tags.includes(x)) ? "interests" : "ambience", tags) };
    const c = crowdHit(re);
    return c ? { said: `Qloo's profile of this room mentions ${lc(c)}`, src: qcrowd(c) } : null;
  };
  const cocktails = tagHit(/cocktail|mixolog/i, [...bev, ...interests]);
  const out = (key, why, say, mail, src = []) => ({ key, why, say, mail, order, src: [...src, ...orderSrc] });
  // proof re-judge 10-24 (soft-boise): a family angle only when Qloo's own tags say family, never from a "families" in
  // the crowd text (a crowd text names families in most rooms; the judge read "for the kids" as a miss for a bar crowd)
  const familyTags = tagHit(FAMILY, [...amb, ...interests]).slice(0, 1);
  const family = familyTags.length ? { said: `Qloo's tags for this room include ${lc(familyTags[0])}`, src: qsrc(interests.includes(familyTags[0]) ? "interests" : "ambience", familyTags) } : null;
  // judge pass 12 #3: "a beer at lunch" read wrong at a 3:30 pm brewery visit (both personas): the daytime angle only
  // when she arrives before ~2:30 pm; later, the next angle (the guest who isn't drinking) leads
  const daytime = Number.isFinite(eta) && eta < LUNCH_BY ? sig(DAYTIME, [...interests, ...bev]) : null;
  // proof re-judge 10-24 (pour-omaha): "for the patio" only in the warm months where the room is (late October in Omaha
  // is not patio weather): by latitude, south of 33° Mar–Nov, of 37° Apr–Oct, else May–Sep; no visit date, no patio
  const patio = warmMonth(date, v?.lat) ? sig(/\b(patio|beer garden|outdoor seating|rooftop)\b/i, [...interests, ...amb]) : null;
  const water = soft && /\bwater\b/i.test(String(style));
  // an NA spirit is tasted in a drink, the way a guest has it, not neat (both personas, final round)
  const naMix = na && kind === "spirit" ? `Could your bartender make one with ${/\bgin\b/i.test(String(style)) ? "tonic" : "soda"}, so you taste it the way a guest would?` : null;
  const sports = /sport/.test(genre) ? { said: "Qloo has this as a sports bar", src: { kind: "qloo", field: "genre", tags: [genre] } } : sig(SPORTS, [...interests, ...amb]);
  if (na && bev.includes("Specialty non alcoholic")) return out("na-lane", "Qloo tags this room for specialty non-alcoholic drinks, so they may already have a non-alcoholic shelf. Check the cooler and the board when you walk in: pitch yours next to what's there, not as the first one.", `If you've got non-alcoholic on already, I'd love to put ours next to it. ${naMix ?? "Want to taste it next to what you've got?"}`, "If you already carry non-alcoholic, I'd love to taste ours next to it.", [qsrc("beverage_offering", ["Specialty non alcoholic"])]);
  if ((na || soft) && family) return out("na-driver", na ? `${family.said}: drivers and parents. Lead with the guest who isn't drinking but still wants something good in hand.` : `${family.said}: kids, and whoever's driving. Lead with them.`, na ? `It's for whoever's driving, or the parents with the kids along. ${naMix ?? `Can I pour you ${taste}?`}` : "It's for the kids, and for whoever's driving. Can I pour you one cold?", na ? "It's for whoever's driving, or the parents with the kids along." : "It's for the kids, and for whoever's driving.", [family.src]);
  if (na && cocktails.length) return out("na-cocktail", `Qloo tags this room for ${list(cocktails.map(lc))}: a guest who isn't drinking there probably gets a soda. Lead with giving the bartender something better to hand them.`, `It gives your bartenders something better than a soda water for the guest who isn't drinking. ${naMix ?? "Can I pour you one?"}`, "It gives your bartenders something better than a soda water for the guest who isn't drinking.", [qsrc(bev.some((x) => /cocktail/i.test(x)) ? "beverage_offering" : "interests", cocktails)]);
  if (na && daytime) return out("na-daytime", `${daytime.said}: people who are here in the daytime and have to get back to work. Lead with the ${word || "drink"} they can have at lunch and still work.`, `This is for the person who wants a ${drink} at lunch and still has to work after. ${naMix ?? `Can I pour you ${taste}?`}`, `It's built for the person who wants a ${drink} at lunch and still has to work after.`, [daytime.src]);
  if (kind === "spirit" && !isNA) {
    const named = menu.find((m) => NAMED_COCKTAIL.test(m));
    if (named) return out("spirit-cocktail", `Qloo lists the ${lc(named)} as a menu highlight${cocktails.length ? ` and tags the room for ${list(cocktails.map(lc))}` : ""}. Check the menu: if the ${lc(named)} is still on it, build the pitch on it, one drink they already sell, made with yours.`, `Could your bartender make me your ${lc(named)} with an ounce of this, so we can taste it next to the house one?`, `I'd love to taste it in your ${lc(named)}, next to the house one.`, [qsrc("menu_highlight", [named]), ...(cocktails.length ? [qsrc("interests", cocktails)] : [])]);
    return out("spirit-neat", cocktails.length ? `Qloo tags this room for ${list(cocktails.map(lc))}: talk to whoever builds the menu, and show it neat first.` : "No cocktail tags from Qloo: lead with the back bar, and show it neat.", "Can I pour you one neat? Then we can talk about where it'd fit.", null, cocktails.length ? [qsrc("interests", cocktails)] : []);
  }
  if (kind === "wine" && !isNA) return out("wine-glass", "Lead with the by-the-glass list: one glass to try is the easiest yes.", "Can I pour you a taste? Then we can talk about where it'd fit by the glass.", null);
  if (sports && ["beer", "seltzer", "cider"].includes(kind) && !isNA) return out("game", `${sports.said}. Come well before game time, keep it short, and leave a cold can.`, "Can I leave you a cold one to try? If it works, it's an easy add for game nights.", "I think it'd be an easy add for game nights.", [sports.src]);
  if (patio && ["beer", "cider", "seltzer"].includes(kind) && !isNA && type !== "brewery") return out("patio", `${patio.said}: lead with something cold for outside.`, `It's ${article(word || "drink")} ${word || "drink"} for the patio. Can I pour you one cold?`, `I think it'd be a good one for your patio.`, [patio.src]);
  if (type === "brewery" && ["beer", "cider"].includes(kind) && !isNA) return out("brewery-guest", "A brewery pours its own beer: your way in is the one guest can for people who want something different.", "Do you ever keep a guest can in the cooler for people who want something you don't make? Can I pour you one cold?", "It could be the guest can for people who want something you don't make.");
  if (na) return out("na", "Nothing in Qloo's tags points at one angle: lead with the guest who isn't drinking today.", `It's for the guest who isn't drinking today, so they still have a ${drink} in their hand. ${naMix ?? `Can I pour you ${taste}?`}`, `It's for the guest who isn't drinking today, so they still have a ${drink} in their hand.`);
  if (water) return out("water", "Nobody decides on water by tasting it: lead with leaving a few cold and the price per can.", "Can I leave you a few cold, and our price per can?", null);
  if (soft) return out("soft", "Nothing in Qloo's tags points at one angle: lead with the taste.", "Can I pour you one cold? Then we can talk about where it'd fit.", null); // N2: a soft drink is never pitched as the alcohol alternative
  return out("taste", "Nothing in Qloo's tags points at one angle: lead with the taste.", `Can I pour you ${taste}?`, null);
}

// The angle line when no tag points at one (the "na", "soft" and "taste" fallbacks above): the door card shows no Why for
// it (Jard web review 10-24: "Why: Nothing in Qloo's tags points at one angle: lead with the taste." read as clunky).
export const NO_ANGLE = "Nothing in Qloo's tags points at one angle";

// ---------- the room's tags, as sourced facts (the stop's Why, the agent's explain_door) ----------
// CONTRACTS-R9 §2.3 fact shape. Names as Qloo gives them, never reworded.
const LABEL = { bev: ["Drinks", "beverage_offering"], menu: ["Known for", "menu_highlight"], interests: ["Its crowd is into", "interests"], tod: ["Crowd times", "time_of_day_fit"], visit: ["How people use it", "visit_intent"], ambience: ["Feels", "ambience"] };
// judge pass 2 (26): Qloo's visit_intent tags in words ("Routine visit" → "regular visits"); an unknown tag as given
// judge pass 3 (26): every phrase the same kind of noun, so the list reads as one ("a regular spot and a destination",
// not "regular visits and a destination")
const VISIT_WORDS = { "routine visit": "a regular spot", "special occasion": "a special-occasion spot", destination: "a destination", "convenience stop": "a quick stop", "impulse visit": "an impulse stop", "day trip": "a day trip" };
// a list whose items hold "and" ("Coffee and tea") takes a serial comma, so the last "and" reads as the list's
const tagList = (xs) => (xs.length > 2 && / and /.test(xs.at(-1)) ? `${xs.slice(0, -1).join(", ")}, and ${xs.at(-1)}` : list(xs));
export function roomTagFacts(v, { door = v?.id ?? null, captured = null } = {}) {
  const t = tagsOf(v);
  const out = [];
  for (const [fam, [label, field]] of Object.entries(LABEL)) {
    // judge pass 3 (26): drinks read as one list: "Beer" beside "Craft beer" says nothing more, and "Coffee and tea" is two
    // drinks ("Full bar, craft beer, coffee and tea", not "Full bar, beer, craft beer, and coffee and tea")
    const raw = (t[fam] ?? []).slice(0, fam === "bev" ? 6 : 4);
    const xs = fam !== "bev" ? raw : raw.filter((x) => !(x === "Beer" && raw.some((y) => /^(craft|local) beer$/i.test(y)))).flatMap((x) => (/^\w+ and \w+$/.test(x) ? x.split(" and ") : [x]));
    if (!xs.length) continue;
    // after the first, a tag reads lower case mid-sentence ("Full bar, beer, craft beer, and coffee and tea")
    // intuit pass 2 (M9): the visit words start the sentence after the label, so the first is capitalized ("A special-occasion spot")
    const words = fam === "visit" ? xs.map((x, i) => ((w) => (i ? w : w[0].toUpperCase() + w.slice(1)))(VISIT_WORDS[lc(x)] ?? lc(x))) : xs.map((x, i) => (i && /^[A-Z][a-z]/.test(x) ? lc(x[0]) + x.slice(1) : x));
    out.push({ label, text: `${label}: ${tagList(words)}.`, source: { kind: "qloo", field: `tag:${field}`, door, captured, label: `Qloo, door tags (${field.replace(/_/g, " ")})` } });
  }
  return out;
}

// ---------- 3. conversation hooks ("hooks") ----------
// What a drinker brand's fans also like (Qloo: brand → TV shows, podcasts, destinations; public/data/culture/hooks.json,
// scripts/deep-hooks.mjs). Two filters make it say something:
//  1. distinct: an item that a same-category brand's fans also like, or that 3+ brands' fans like, is the category's
//     or everyone's, not this brand's (four tequilas share Narcos / El Chapo / Queen of the
//     South; "Girls Gotta Eat" is in three brands' podcasts). Only the brand's own items are kept.
//  2. per room: an item is used only when its genre meets the room's own tags (a sports podcast where the crowd is into
//     sports viewing). No match → no hook (decide, don't decorate). The rep's private small talk, labelled
//     "People who drink <brand> also like …"; never a claim about the bar or its guests.
export const HOOK_THEMES = {
  sports: { item: /\b(sports?|football|golf|basketball|baseball|soccer|hockey|nfl|nba|mlb|fantasy sports|betting|wrestling|mma|boxing)\b/i, room: /\b(sports?|game day|sports viewing|sports bar|watch(ing)? games)\b/i, words: "sports" },
  comedy: { item: /\b(comedy|sitcom|stand-?up|humou?r|satire|sketch)\b/i, room: /\b(comedy|stand-?up|improv|trivia)\b/i, words: "comedy" },
  music: { item: /\b(music|musical|concerts?|hip hop|rock|country)\b/i, room: /\b(live music|music|concerts?|dj|karaoke)\b/i, words: "music" },
  wellness: { item: /\b(health|fitness|wellness|nutrition|running|endurance|longevity|mindful\w*|yoga)\b/i, room: /\b(health\w*|fitness|wellness|yoga|running|active lifestyle|outdoor)\b/i, words: "health and fitness" },
  outdoors: { item: /\b(mountains?|ski\w*|hiking|outdoors?|national park|beach\w*|surf\w*)\b/i, room: /\b(outdoor|patio|beer garden|hiking|dog friendly|nature)\b/i, words: "the outdoors" },
  reality: { item: /\b(reality|dating show|dating and romance)\b/i, room: /\b(nightlife|party|bachelorette|dance)\b/i, words: "nights out" },
};
const HOOK_TYPE = { tv_show: "TV", podcast: "podcast", destination: "trips" };
const themesOf = (text, side) => Object.entries(HOOK_THEMES).filter(([, t]) => t[side].test(text)).map(([k]) => k);

// all: hooks.json `brands` ({key: {category, lists: {type: [{name, tags}]}}}); kindOf: (brand) → a category key.
// → the brand's own items per type, in Qloo's order.
// A brand's category for the sibling test, from its category and name (Qloo's "where" for prewarm brands is noisy).
export function brandKind(b) {
  const w = lc(`${b?.category ?? ""} ${b?.name ?? ""} ${b?.qlooName ?? ""}`);
  if (/seltzer|hard tea|truly|white claw|high noon|ready.to.drink/.test(w)) return "seltzer";
  if (/tequila|mezcal|vodka|whisk|bourbon|\bgin\b|\brum\b|aperol|spirit|liqueur|amaro/.test(w)) return "spirit";
  if (/non.?alcoholic|athletic/.test(w) && /beer|brew/.test(w)) return "na-beer";
  if (/beer|lager|brew|stout|\bale\b|modelo|guinness|stella|coors|heineken|michelob/.test(w)) return "beer";
  if (/water|soda|sparkling|topo chico|lacroix|liquid death/.test(w)) return "soft";
  return w.trim() || null;
}
export function distinctItems(key, all, kindOf = brandKind) {
  const b = all?.[key];
  if (!b) return {};
  const out = {};
  for (const [type, items] of Object.entries(b.lists ?? {})) {
    const count = new Map();
    for (const o of Object.values(all)) for (const n of new Set((o.lists?.[type] ?? []).map((x) => x.name))) count.set(n, (count.get(n) ?? 0) + 1);
    const sib = new Set(Object.entries(all).filter(([k, o]) => k !== key && kindOf(o) && kindOf(o) === kindOf(b)).flatMap(([, o]) => (o.lists?.[type] ?? []).map((x) => x.name)));
    out[type] = items.filter((x) => !sib.has(x.name) && (count.get(x.name) ?? 0) < 3);
  }
  return out;
}

// The room's side: its interests and ambience tags, its genre ("sports bar"). → {item, type, theme, roomTag} or null.
// brands: [{key, name}] the drinker brands (the plan's), hooks: hooks.json.
export function hookFor(v, brands = [], hooks = null, { kindOf } = {}) {
  if (!hooks?.brands) return null;
  const t = tagsOf(v);
  const roomBits = [...(t.interests ?? []), ...(t.ambience ?? []), String(v?.genre ?? "").split(":").pop().replace(/_/g, " ")].filter(Boolean);
  for (const br of brands) {
    const items = distinctItems(br.key, hooks.brands, kindOf);
    const rec = hooks.brands[br.key];
    for (const type of ["podcast", "tv_show", "destination"]) {
      for (const it of items[type] ?? []) {
        const themes = themesOf([it.name, ...(it.tags ?? [])].join(" · "), "item");
        for (const th of themes) {
          const roomTag = roomBits.find((x) => HOOK_THEMES[th].room.test(x));
          if (!roomTag) continue;
          const who = br.name ?? rec.name;
          return {
            // intuit audit (smaller): no "(podcast)" tag after the name; a title that doesn't say what it is gets "the
            // podcast" / "the TV show" in front; then a plain instruction
            text: `People who drink ${who} also like ${type === "destination" ? `trips to ${it.name}` : new RegExp(`\\b${HOOK_TYPE[type]}\\b`, "i").test(it.name) ? it.name : `the ${HOOK_TYPE[type] === "TV" ? "TV show" : HOOK_TYPE[type]} ${it.name}`}. Bring it up if ${HOOK_THEMES[th].words.replace(/ and /g, " or ")} comes up.`,
            item: it.name, type, theme: th, brand: br.key,
            src: { kind: "qloo", field: `hook:${type}`, tags: [it.name], brand: who, room: roomTag, captured: rec.captured ?? null },
          };
        }
      }
    }
  }
  return null;
}

// ---------- 4. which part of town first ("heat") ----------
// Qloo's heatmap with locality boundaries ranks a city's neighbourhoods for a brand's fans; mixed in are admin rows
// (country, state, county, the city itself), dropped here. A rank only (no strengths). body: the insights answer;
// city: {name, center: [lat, lon]}. → [{name, lat, lon}] in Qloo's order, within 30 km of the centre.
const centroid = (wkt) => {
  const nums = String(wkt ?? "").match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
  if (nums.length < 2) return null;
  let x = 0, y = 0, n = 0;
  for (let i = 0; i + 1 < nums.length && n < 400; i += 2) (x += nums[i]), (y += nums[i + 1]), n++;
  return { lon: x / n, lat: y / n };
};
const kmBetween = (a, b) => {
  const R = 6371, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
export function heatHoods(body, city = {}) {
  const centre = Array.isArray(city.center) ? { lat: city.center[0], lon: city.center[1] } : null;
  const out = [];
  for (const e of body?.results?.entities ?? []) {
    const parts = String(e?.disambiguation ?? "").split(",").map((x) => x.trim());
    // the city itself, however the run names it ("Los Angeles County", "Los Angeles, CA", "New York City")
    const own = [city.name, city.query].filter(Boolean).map((x) => lc(x).replace(/,.*$/, "").replace(/\s+(county|city)$/, ""));
    if (parts.length < 4 || own.includes(lc(e.name)) || /county|township|united states/i.test(e.name ?? "")) continue;
    const c = centroid(e.boundary);
    if (!c || (centre && kmBetween(c, centre) > 30)) continue;
    if (!out.some((h) => h.name === e.name)) out.push({ name: e.name, lat: Math.round(c.lat * 1e5) / 1e5, lon: Math.round(c.lon * 1e5) / 1e5 });
  }
  return out;
}

// A door's neighbourhood on Qloo's map: its own `neighborhood` field when Qloo ranked it, else the nearest ranked
// hood within 1.5 km. hoods: heatHoods(…). → {name, rank (1-based), of} or null.
export function hoodOf(v, hoods = []) {
  if (!hoods.length || !v) return null;
  let i = v.neighborhood ? hoods.findIndex((h) => lc(h.name) === lc(v.neighborhood)) : -1;
  if (i < 0 && Number.isFinite(v.lat) && Number.isFinite(v.lon)) {
    let best = 1.5;
    hoods.forEach((h, j) => {
      const d = kmBetween(v, h);
      if (d < best) (best = d), (i = j);
    });
  }
  return i >= 0 ? { name: hoods[i].name, rank: i + 1, of: hoods.length } : null;
}
// The planner's input: 1 for a door in one of the top HEAT_TOP hoods. schedule.js partition (heatFirst) gives the
// first day the area holding most of them ("work this part of town first"), and such a door costs HEAT_MIN on a
// later day so the search keeps it there.
export const HEAT_TOP = 3;
export const HEAT_MIN = 3;
export const heatWeight = (hood) => (hood && hood.rank <= HEAT_TOP ? 1 : 0);
// The hoods for a plan: the first brand route's (a merged plan works its first drinker's map). heat: heat.json.
export function heatFor(heat, routes = [], cityKey = null) {
  for (const r of routes) {
    if (r?.culture?.heat?.length) return r.culture.heat; // a live run carries its own (src/worker.js runRoute 6b)
    const run = r?.drinker?.key && heat?.runs?.[`${r.drinker.key}|${cityKey ?? r.city?.key}`];
    if (run?.hoods?.length) return run.hoods;
  }
  return null;
}

// hooks.json plus what live runs carry (route.culture.hooks), keyed by drinker key: the pool hookFor reads.
export function hooksWith(hooks, routes = []) {
  const live = routes.filter((r) => r?.culture?.hooks && r.drinker?.key && !hooks?.brands?.[r.drinker.key]);
  if (!live.length) return hooks;
  return { ...(hooks ?? {}), brands: { ...(hooks?.brands ?? {}), ...Object.fromEntries(live.map((r) => [r.drinker.key, { ...r.culture.hooks, captured: r.culture.captured }])) } };
}
