// The drafted note on a stop (SPEC-V2 §3.5; v1's cards.js draftMessage rewritten for the brand profile) and the
// stop's links: Email (mailto:), Text (sms:), Call (tel:), Directions (Apple or Google Maps for one leg).
// Pure: no DOM, no fetch. Covered by test/stop.test.mjs.
import { BANNED_PITCH, bannedOwn } from "./core.js";
import { humanTime, crowdPhrase, mentions, NEUTRAL_ASK, dayText, productKind } from "./talk.js";
import { TAP_ASK } from "./ask.js";
import { lowerFirst } from "./culture.js"; // keeps a Title-Case name ("Green Bottles Beer") as typed

const article = (s) => (/^[aeiou]/i.test(s) && !/^(one|uni|use|eu)/i.test(s) ? "an" : "a");
const capFirst = (s) => String(s).replace(/^./, (c) => c.toUpperCase());
const clean = (s) => String(s ?? "").trim().replace(/\s+/g, " ");
export const firstName = (s) => clean(s).split(" ")[0] ?? "";

// The crowd sentence for the note: the opener's spoken first sentence ("Looks like your regulars are …"), the model's
// lead when one passed the guard, else talk.js's crowd phrase from Qloo's profile of the room. It claims no source
// (R1 ruling). {text, by} or null. avoid = names never to print.
export function crowdForNote(venue, lead = null, avoid = []) {
  const bad = (t) => !t || BANNED_PITCH.test(t) || /!/.test(t) || mentions(t, avoid);
  if (lead?.text && !bad(lead.text)) return { text: clean(lead.text).replace(/[.]?$/, "."), by: "model" };
  const p = crowdPhrase(venue, avoid);
  if (p && !bad(p.text)) return { text: `Looks like ${p.text}.`, by: "template" };
  return null;
}

// N3: the rep's own rooms that already pour them (their data, not Qloo's), for the note: "Parson's Chicken & Fish and
// Kite String in Chicago", grouped by city; a room in the opening city has no "in". "" when there are none.
export function poursText(pours = [], cityName = "") {
  const cityOf = (r) => clean(String(r.where ?? "").split(",").at(-1));
  const here = (c) => !c || clean(cityName).toLowerCase().startsWith(c.toLowerCase());
  const groups = new Map();
  for (const r of pours ?? []) if (clean(r?.name)) groups.set(cityOf(r), [...(groups.get(cityOf(r)) ?? []), clean(r.name)]);
  const and = (n) => (n.length <= 1 ? n[0] ?? "" : `${n.slice(0, -1).join(", ")} and ${n.at(-1)}`);
  return and([...groups].map(([c, n]) => `${and(n)}${here(c) ? "" : ` in ${c}`}`));
}

// draftNote({venue, profile, cityName, day ("tuesday"), eta (minutes), ask ("one case of cans in the cooler"), venueType,
//            hook (the angle as one email line, talk.angle.mail), kind (talk.kind), memory})
// Jard 10-24 #5 (OPENERS-RESEARCH.md §3): a first message asks for a time and a taste, nothing else: no crowd line ("how
// would you know?"), no product ask (the case is asked for in person after the taste, or in a return message once the
// rep logged "interested"), times as a person says them ("Tuesday a little after 1"). No rank and no "Qloo" in it.
// `crowd` is still accepted (old callers) and ignored.
// → {subject, body, by: "template" | "model", lines}. Every line passes the banned-words guard (a line that trips it
// is dropped); nothing is a placeholder: a missing field changes the sentence instead.
export function draftNote({ venue = {}, profile = {}, cityName = "", day = null, date = null, eta = null, crowd = null, ask = "", venueType = "bar", memory = null, hook = null, kind = null } = {}) {
  const name = clean(venue.name) || "your";
  const brand = clean(profile.brand);
  const what = clean(profile.what);
  const first = firstName(profile.pitch?.name ?? profile.name);
  const intro = brand ? `${brand}${what ? `, ${article(what)} ${lowerFirst(what)}` : ""}` : what ? `a new ${lowerFirst(what)} brand` : "a new drinks brand";
  const me = first ? `I'm ${first} from ${intro}` : `I'm with ${intro}`;
  const when = day && Number.isFinite(eta) ? `${capFirst(day)} ${humanTime(eta)}` : null;
  const k = kind ?? productKind(what);
  const one = k === "spirit" || k === "wine" ? "a taste" : "a cold one";
  // personas, final round: nobody tastes water to decide on it, and an NA spirit is tasted in a drink
  const water = k === "soft" && /\bwater\b/i.test(what);
  const naSpirit = k === "spirit" && /non[- ]?alc|alcohol[- ]free|zero[- ]proof|\bna\b/i.test(what);
  const buyer = venueType === "restaurant" ? "whoever decides the drinks list" : venueType === "brewery" ? "whoever runs the taproom" : venueType === "coffee" ? "whoever orders for the cooler" : "whoever buys for the bar";
  // the venue's own name is not a claim: "Pour House", "Lock Stock & Barrel" must keep their lines (R2 L4)
  const theAsk = clean(ask).replace(/[.]+$/, "") || NEUTRAL_ASK;
  // the rep's own words (ask, what they make, brand, name) are theirs: only Doors' words are tested (core.bannedOwn)
  const banned = (l) => bannedOwn(name ? l.split(name).join("Venue") : l, [theAsk, what, brand, first, clean(profile.support)]);

  const pours = poursText(profile.pours, cityName);
  // ---- R9 S1+S4 return visit (docs/CULTURAL-SLOTS.md §6): shorter, no introduction, no crowd line ----
  if (memory?.visit === "return") {
    const c = memory.contact?.name ? clean(memory.contact.name) : null;
    const last = memory.lastVisit ? dayText(memory.lastVisit).split(" ")[0] : null;
    const o = memory.objection?.kind;
    const ownR = [theAsk, what, brand, first, clean(profile.support), memory.said, memory.objection?.words];
    const bannedR = (l) => bannedOwn(name ? l.split(name).join("Venue") : l, ownR);
    // judge pass 2 (8) / live check E: the note says the day and time she agreed ("back Monday after 3"), not the slot
    // the plan happens to show this card on; the plan's arrival only when it is that day and she gave no time
    const fu = /^\d{4}-\d{2}-\d{2}$/.test(memory.followUp ?? "") ? memory.followUp : null;
    const fuMin = /^\d{2}:\d{2}$/.test(memory.followUpTime ?? "") ? +memory.followUpTime.slice(0, 2) * 60 + +memory.followUpTime.slice(3) : null;
    const fuDay = fu ? WEEKDAYS[new Date(`${fu}T12:00:00`).getDay()] : null;
    const fuAt = fuMin ?? (fu && fu === date && Number.isFinite(eta) ? eta : null);
    const when = fu ? `${capFirst(fuDay)}${fuAt != null ? ` ${humanTime(fuAt)}` : ""}` : day && Number.isFinite(eta) ? `${capFirst(day)} ${humanTime(eta)}` : null;
    // the product ask only once the rep logged "interested"; until then, the taste for the team (personas R2)
    const bringTeam = one === "a taste" ? "I'll bring a bottle and pour for the team." : "I'll bring a couple of cold ones for you and the team.";
    const hello = `${c ? `Hi ${c}, it's` : "Hi, it's"} ${first || "me"}${brand ? ` from ${brand}` : ""} again${last ? `: thanks for your time on ${dayName(last)}` : ""}.`;
    const lines = [
      hello,
      { price: "I'll bring the price sheet so we can look at the numbers together.", owner: "Happy to meet the owner too, if they're around.", space: TAP_ASK.test(theAsk) ? "It only needs one rotating tap line for a month." : "It only needs one row in the cooler." }[o] ?? null, // persona MUST #2: a keg ask, keg words
      when ? `I'll be by ${when}, if that still works.` : "Could I stop by again, on a day that suits you?",
      memory.result === "interested" ? `Want to start with ${theAsk}?` : bringTeam,
      first || brand ? `Thanks,\n${first || brand}` : "Thanks",
    ].filter((l) => l && !bannedR(l));
    const subject = `${brand || "Following up"} at ${name}: ${when ? `${when}?` : "following up"}`;
    const sms = {
      hello: `${c ? `Hi ${c}, ` : "Hi, it's "}${first || "me"}${brand ? ` from ${brand}` : ""} again${last ? `, thanks for ${dayName(last)}` : ""}.`,
      when: fu ? `Still OK if I stop by ${fuAt != null ? shortWhen(fuDay, fuAt) : capFirst(fuDay)}?` : day && Number.isFinite(eta) ? `Still OK if I stop by ${shortWhen(day, eta)}?` : "When's a good time to stop by again?",
      ask: memory.result === "interested" ? `Want to start with ${theAsk}?` : bringTeam,
      sign: first || brand,
    };
    return { subject: bannedR(subject) ? `${name}: following up` : subject, body: lines.join("\n\n"), lines, by: "template", visit: "return", parts: cleanParts(sms, bannedR) };
  }
  const what1 = what ? `, ${article(what)} ${lowerFirst(what)}` : "";
  const rooms = venueType === "restaurant" ? "restaurants" : venueType === "coffee" ? "cafés" : "bars";
  const visit = water ? `Could I stop in and drop off a few cold ones for ${buyer}, with our price?` : naSpirit ? `Could I stop in and make ${buyer} a quick drink with it?` : `Could I stop in and pour ${buyer} ${one}?`;
  const lines = [
    "Hi,",
    `${first ? `I'm ${first}` : "I'm"} with ${brand ? `${brand}${what1}` : what ? `a new ${lowerFirst(what)} brand` : "a new drinks brand"}${cityName ? `, and I'm out meeting ${rooms} around ${cityName}` : ""}.`,
    hook ?? null, // the angle as one line (talk.angle.mail): the one line that isn't the same at every door (rep persona R2)
    pours ? `You can find us at ${pours} already.` : null, // never "pour" as a claim: BANNED_PITCH
    `${when ? `I'll be over your way ${when}. ` : "I'm around one afternoon soon. "}${visit} Ten minutes, and no hard feelings if it's not a fit.`,
    "If another time works better, tell me and I'll work around service.",
    first || brand ? `Thanks,\n${first || brand}` : "Thanks",
  ].filter((l) => l && !banned(l));
  const subject = brand ? `${brand}${what1}` : what ? `A new ${lowerFirst(what)}` : "A new drinks brand";
  const sms = {
    hello: `Hi, it's ${first || "me"}${brand ? ` from ${brand}` : ""}${what1}.`,
    when: when ? `I'll be over your way ${when}. ${visit}` : `${visit.replace(/\?$/, "")} one afternoon soon?`,
    ask: "10 minutes, tops.",
    sign: first || brand,
  };
  return { subject: banned(subject) ? `${name}: could I bring a tasting?` : subject, body: lines.join("\n\n"), lines, by: "template", visit: "first", parts: cleanParts(sms, banned) };
}

// the SMS parts with any line that trips the guard dropped
const cleanParts = (p, banned) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, v && k !== "sign" && banned(v) ? null : v]));
// "tuesday", 868 → "Tuesday around 2:30"
const shortWhen = (day, eta) => `${capFirst(dayName(capFirst(String(day).slice(0, 3))))} ${humanTime(eta)}`;
// "Tue" → "Tuesday"
const DAYNAME = { Sun: "Sunday", Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday" };
const dayName = (d) => DAYNAME[d] ?? d;
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

// ---- R9 S3: the note as a text message (docs/CULTURAL-SLOTS.md §6 S3): ≤ SMS_MAX characters, greeting + when + ask +
// name, built by code from the note's parts; a middle line goes first when it's too long, then a hard cut at a word.
export const SMS_MAX = 320;
export function noteFor(note, channel = "email") {
  if (channel !== "sms" || !note?.parts) return note?.body ?? "";
  const p = note.parts;
  const sign = p.sign ? `– ${p.sign}` : "";
  const build = (xs) => xs.filter(Boolean).join(" ");
  let s = build([p.hello, p.when, p.ask, sign]);
  if (s.length > SMS_MAX) s = build([p.hello, p.ask, sign]);
  if (s.length > SMS_MAX) s = s.slice(0, SMS_MAX - 1).replace(/\s+\S*$/, "") + "…";
  return s;
}

// personas R2: a text to a bar's listed number usually lands on a landline; the text is for the buyer's own cell
export const TEXT_HINT = "A bar's main number is often a landline: text once you have the buyer's cell.";
export const noteLabel = (note) =>
  note.by === "rep" ? "Your version: Doors keeps your edit for this door." : note.visit === "return" ? "Return-visit template from your profile and what you told Doors last time." : note.by === "model" ? "Written for this door from Qloo's facts about it, your profile and your ask." : "Template from your profile and Qloo's profile of this door.";

// ---------- links ----------
const digits = (p) => {
  const d = String(p ?? "").replace(/[^\d+]/g, "");
  return d.replace(/(?!^)\+/g, "");
};
export const telHref = (phone) => (digits(phone).replace(/\D/g, "").length >= 7 ? `tel:${digits(phone)}` : null);
export const mailtoHref = (note) => `mailto:?subject=${encodeURIComponent(note.subject)}&body=${encodeURIComponent(note.body)}`;
// "?&body=" opens the composer with the text on both iOS and Android.
// R9 S3: the text uses the SMS version (noteFor), unless the rep edited it (note.sms, their correction)
export const smsHref = (note, phone) => `sms:${telHref(phone) ? digits(phone) : ""}?&body=${encodeURIComponent(note.sms ?? noteFor(note, "sms"))}`;
export const noteText = (note) => `Subject: ${note.subject}\n\n${note.body}`;

// Driving directions for one leg (from the previous stop or the day's start) in the rep's navigation app (PARITY S14,
// the phone's Settings → Navigation app): "apple" | "google" | "waze"; none chosen: Apple Maps on Apple devices, Google
// Maps elsewhere. from may be null (then the maps app starts from where the phone is; Waze always does).
export const isApple = (ua = "") => /iPhone|iPad|iPod|Macintosh/i.test(ua);
export const NAV_APPS = [{ key: "apple", name: "Apple Maps" }, { key: "google", name: "Google Maps" }, { key: "waze", name: "Waze" }];
export const navAppOf = (app, ua = "") => (NAV_APPS.some((a) => a.key === app) ? app : isApple(ua) ? "apple" : "google");
export const navAppName = (app, ua = "") => NAV_APPS.find((a) => a.key === navAppOf(app, ua)).name;
export function directionsUrl(from, to, ua = "", app = null) {
  const ll = (p) => `${(+p.lat).toFixed(6)},${(+p.lon).toFixed(6)}`;
  const k = navAppOf(app, ua);
  if (k === "waze") return `https://waze.com/ul?ll=${ll(to)}&navigate=yes`;
  if (k === "apple") return `https://maps.apple.com/?${from ? `saddr=${ll(from)}&` : ""}daddr=${ll(to)}&dirflg=d`;
  return `https://www.google.com/maps/dir/?api=1${from ? `&origin=${ll(from)}` : ""}&destination=${ll(to)}&travelmode=driving`;
}

// Jard 10-23 (batch 16, Flavor House): when Qloo has no website for a door, a plain web search for "<name> <city>, <ST>"
// opens in the browser instead. Doors fetches nothing and stores nothing; the link is only a URL. City and state come
// from Qloo's address ("130 W 2nd St Dayton, OH 45402"); the plan's city name stands in when the address has none.
export const hasWebsite = (v) => /^https?:\/\//i.test(v?.website ?? "");
export function cityStateOf(address = "", cityName = "") {
  const m = /(?:^|,)\s*([^,]*?),\s*([A-Z]{2})(?:\s+\d{5}(?:-\d{4})?)?\s*(?:,\s*(?:USA|US|United States))?\s*$/.exec(clean(address));
  if (!m) return clean(cityName);
  const seg = m[1].trim();
  const known = clean(cityName).split(",")[0].trim();
  // the address has no comma before its city: "3804 Woodbury Dr Suite A Austin" → the plan's city when it ends the
  // street, else the last word ("1567 Main St STE 800 Buda" → Buda)
  const city = !/\d/.test(seg) ? seg : known && seg.toLowerCase().endsWith(` ${known.toLowerCase()}`) ? known : seg.split(/\s+/).pop();
  return city && !/\d/.test(city) ? `${city}, ${m[2]}` : clean(cityName);
}
export function webSearchHref(v, cityName = "") {
  const q = [clean(v?.name), cityStateOf(v?.address ?? "", cityName)].filter(Boolean).join(" ");
  return q ? `https://duckduckgo.com/?q=${encodeURIComponent(q)}` : null;
}
