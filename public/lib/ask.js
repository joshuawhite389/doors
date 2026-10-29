// The brand's ask drives the rooms and the script (persona MUST #2, drinks rep + founder): a keg, draft or tap ask goes
// only to rooms with taps; a room whose Qloo drinks tags list only soft drinks is no room for an alcohol (or NA beer)
// pitch; and the price becomes a per-pour / per-can margin line, talking point #1. Pure: no DOM, no fetch (the phone
// app reuses public/lib as-is).
import { roomOf } from "./profile.js";
import { productKind, NA_WORD } from "./talk.js";
import { tagsOf, POURING_ROOM } from "./culture.js";

// ---------- the ask ----------
// "a sixtel", "a cider on draft for a month", "one tap line", "a half barrel", "a 50L keg"
export const TAP_ASK = /\b(kegs?|sixtels?|sixth[- ]barrels?|1\/6 ?(bbl|barrel)|half[- ]barrels?|1\/2 ?(bbl|barrel)|quarter[- ]barrels?|1\/4 ?(bbl|barrel)|pony kegs?|cask|firkin|draft|draught|on tap|taps?|tap lines?|tap handles?|rotating line|guest line)\b/i;
export const tapAsk = (ask) => TAP_ASK.test(String(ask ?? ""));

// Qloo beverage_offering tags that say the room serves alcohol (data/routes: Beer, Wine, Cocktails, Full bar, …)
const ALCOHOL_TAGS = /^(full bar|beer|craft beer|local beer|wine|spirits|cocktails|specialty cocktails|specialty alcoholic|aperitifs and digestifs|sake|soju)$/i;
// A room whose drinks tags are all non-alcoholic ("Soft drinks", "Coffee and tea", "Bottled water", …): a taco
// counter, a food truck. No tags = no claim (empty slot stays neutral). A room whose name or genre says it pours (an
// alehouse, a pub: culture.js) keeps its place, as with Qloo's wrong "Non alcoholic only" (R9 proof finding 5).
export function softOnly(v) {
  const bev = tagsOf(v).bev ?? [];
  if (!bev.length || bev.some((b) => ALCOHOL_TAGS.test(b))) return false;
  return !POURING_ROOM.test(`${v?.name ?? ""} ${String(v?.genre ?? "").replace(/[:_]/g, " ")}`);
}
const fullBar = (v) => (tagsOf(v).bev ?? []).some((b) => /^full bar$/i.test(b));
// Live check 2 (F6): Qloo never says "draft", so "Full bar" alone dropped Big Star, avec and Penumbra (beer, spirits,
// cocktails) and every room with no drinks tags. A restaurant whose tags list beer and spirits runs a bar:
// that is where tap lines are, and the rep checks at the door. Beer or wine alone (a sushi counter, a taqueria) is
// most often bottles: still out. No drinks tags: Qloo says nothing, so nothing is claimed either way (kept).
// "Cocktails" without "Spirits" is most often a beer-and-wine licence (mimosas at a breakfast chain, wine margaritas at a
// taqueria): the proof's judge marked those rooms down for a draft ask (4178e74, pour-omaha / pour-austin)
const SPIRITS = /^spirits$/i;
const BEER = /^(beer|craft beer|local beer)$/i;
const barProgram = (v) => {
  const bev = tagsOf(v).bev ?? [];
  return bev.some((b) => BEER.test(b)) && bev.some((b) => SPIRITS.test(b));
};
const noDrinkTags = (v) => !(tagsOf(v).bev ?? []).length;
// a room with taps: a bar, pub, brewery or taproom (by Qloo's genre or its name), a restaurant tagged "Full bar" or
// with a bar (beer and spirits), or one Qloo has no drinks tags for (empty slot = neutral)
export function hasTaps(v) {
  const room = roomOf(v);
  if (room === "bars" || room === "breweries") return true;
  if (fullBar(v) || barProgram(v) || noDrinkTags(v)) return true;
  return /\b(ale ?house|pub|tavern|tap ?room|tap ?house|brew(ery|ing|pub|house)|beer hall|beer garden|saloon)\b/i.test(`${v?.name ?? ""} ${String(v?.genre ?? "").replace(/[:_]/g, " ")}`);
}

// Why the ask leaves this room out, or null. profile: the form's ({what, pitch: {ask}, rooms}) or talk's flat one ({what,
// ask}). Soft-drinks-only rooms leave only when the product is known to be alcohol or an NA alternative: a soft drink
// sells where soft drinks sell, and a "What you make" Doors can't read (kind other) claims nothing (empty slot =
// neutral). Cafés stay for an NA product: the rep picked that chip for them.
// → {code: "soft-only" | "no-taps", reason}
const DRINKS = new Set(["beer", "cider", "seltzer", "wine", "spirit"]);
export function askMiss(v, profile = {}) {
  if (!v) return null;
  const kind = productKind(profile.what);
  const known = DRINKS.has(kind) || (kind !== "soft" && NA_WORD.test(String(profile.what ?? "")));
  if (known && roomOf(v) !== "cafes" && softOnly(v)) return { code: "soft-only", reason: "Qloo's drinks tags list only soft drinks here" };
  const ask = String(profile.pitch?.ask ?? profile.ask ?? "").trim();
  if (tapAsk(ask) && !hasTaps(v)) return { code: "no-taps", reason: `No taps that Qloo can see (its drinks tags show ${(tagsOf(v).bev ?? []).some((b) => BEER.test(b)) ? "beer but no spirits, most often bottles" : "no beer"}), and your ask is ${ask.replace(/[.]+$/, "")}` };
  return null;
}

// ---------- the price → margin ----------
// Keg sizes in US fluid ounces: a sixtel is 5.16 gal (660 oz), so about 41 pints or 55 twelve-ounce pours.
const KEGS = [
  [/\bsixtels?\b|\bsixth[- ]barrels?\b|1\/6 ?(bbl|barrel)/i, "sixtel", 660],
  [/\bquarter[- ]barrels?\b|\bpony kegs?\b|1\/4 ?(bbl|barrel)/i, "quarter barrel", 992],
  [/\bhalf[- ]barrels?\b|1\/2 ?(bbl|barrel)/i, "half barrel", 1984],
  [/\b(\d{2})\s?(l|liters?|litres?)\b.*\bkegs?\b|\bkegs?\b.*\b(\d{2})\s?(l|liters?|litres?)\b/i, "liter keg", null],
];
// "case of 24" → "a case of 24"; "per can", "a sixtel" as written
const an = (w) => (/^(a|an|per|each|the)\b/i.test(w) ? w : `a ${w}`);
const money = (n) => (Math.abs(n - Math.round(n)) < 0.005 ? `$${Math.round(n)}` : `$${n.toFixed(2)}`);
const round = (n) => Math.round(n);

// "$165 a sixtel, $44 a case of 24 ($1.83 a can)" → [{amount:165, unit:"keg", label:"a sixtel", oz:660}, {amount:44,
// unit:"case", count:24, label:"a case of 24"}]. Only what the rep wrote; a "$" with no unit Doors can read is left out.
export function parsePrices(price) {
  const out = [];
  const s = String(price ?? "");
  for (const m of s.matchAll(/\$\s?(\d+(?:\.\d{1,2})?)\s*(?:a|an|per|\/|for( a| an)?)?\s*([^,;()$]*)/gi)) {
    const amount = Number(m[1]);
    const what = m[3].trim().replace(/[.]+$/, "");
    const text = m[0].trim().replace(/[.,;\s]+$/, ""); // as the rep wrote it: "$165 a sixtel"
    if (!Number.isFinite(amount) || amount <= 0 || !what) continue;
    const keg = KEGS.find(([re]) => re.test(what));
    if (keg) {
      const l = keg[2] == null ? Number(/(\d{2})\s?(l|liters?|litres?)\b/i.exec(what)?.[1]) : null;
      const oz = keg[2] ?? (l ? l * 33.814 : null);
      if (oz) out.push({ text, amount, unit: "keg", label: an(what), oz, size: keg[1] === "liter keg" ? `${l}L keg` : keg[1] });
      continue;
    }
    const cs = /\b(case|pack|flat|tray)\s+of\s+(\d{1,3})\b|\b(\d{1,3})[- ]?(pack|pk)\b/i.exec(what);
    if (cs) {
      const count = Number(cs[2] ?? cs[3]);
      if (count > 0) out.push({ text, amount, unit: /bottle/i.test(what) ? "bottles" : "case", count, label: an(what) });
      continue;
    }
    if (/\bcans?\b/i.test(what) && !/case|pack/i.test(what)) out.push({ text, amount, unit: "can", count: 1, label: an(what) });
    else if (/\bbottles?\b/i.test(what)) out.push({ text, amount, unit: "bottle", count: 1, label: an(what) });
  }
  return out;
}

// the price the ask is in: a keg ask takes the keg price, a case or can ask the case; an ask in no unit takes the first
export const askUnit = (ask) => (tapAsk(ask) ? "keg" : /\bcases?\b|\bcans?\b|cooler|\bpacks?\b/i.test(ask) ? "case" : /\bbottles?\b|back bar|by the glass/i.test(ask) ? "bottle" : null);
const fits = (p, unit) => unit === "keg" ? p.unit === "keg" : unit === "case" ? ["case", "can"].includes(p.unit) : unit === "bottle" ? ["bottle", "bottles", "case"].includes(p.unit) : true;
export function priceForAsk(price, ask) {
  const ps = parsePrices(price);
  const unit = askUnit(String(ask ?? ""));
  return ps.find((p) => fits(p, unit)) ?? null;
}

// "their likely menu price": the rep's number when given (profile.menuPrice, "$8" or 8), else a typical one, said as
// an "if" (Doors doesn't know the room's menu: talk.js rule)
const MENU = { can: 7, softCan: 4, pint: 7, glass: 12 };
const menuOf = (profile, key) => {
  const n = Number(String(profile?.menuPrice ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 && String(profile?.menuPrice ?? "").trim() ? n : MENU[key];
};

// Never the word "pour" (core.BANNED_PITCH: Doors never claims what a room pours).
// The margin line, talking point #1: the bar's money per pour or per can, from the rep's own price. null when the
// price says nothing Doors can turn into a pour (no price, no unit, or a unit that isn't the ask's).
// → {text, price: the part of the price used}
export function marginLine(profile = {}, ask = profile.ask) {
  const p = priceForAsk(profile.price, ask);
  if (!p) return null;
  const kind = productKind(profile.what);
  if (p.unit === "keg") {
    const pints = p.oz / 16;
    const pours = p.oz / 12;
    const perPint = p.amount / pints;
    // a keg's pour cost is priced against the room's own pints: no menu guess (a bar prices draft per pour size)
    const menu = String(profile.menuPrice ?? "").trim() ? menuOf(profile, "pint") : null;
    const size = p.size === "sixtel" ? "A sixtel" : `A ${p.size}`;
    return {
      text: `${size} holds about ${round(pints)} pints (${round(pours)} twelve-ounce glasses): at ${money(p.amount)} that's about ${money(perPint)} a pint, ${money(p.amount / pours)} a 12 oz glass${menu && menu > perPint ? `, so at ${money(menu)} a pint you keep about ${money(menu - perPint)}` : ", to price against your menu"}.`,
      price: p.text,
    };
  }
  // a case of wine or spirits is bottles: a bottle's glasses or shots, not cans
  // "can" only when the rep's words say cans ("Canned tequila paloma", "one case of cans"): never assumed
  const cans = /\bcan(s|ned)?\b/i.test(`${profile.what ?? ""} ${p.label} ${ask ?? ""}`);
  const bottles = p.unit === "bottle" || p.unit === "bottles" || (p.unit === "case" && !cans && (kind === "wine" || kind === "spirit"));
  const perBottle = bottles ? p.amount / (p.count ?? 1) : null;
  const caseIs = (per, unit) => (p.count > 1 ? `${money(p.amount)} ${p.label} is ${money(per)} ${unit}` : `At ${money(per)} ${unit}`);
  if (bottles && kind === "wine") {
    const per = perBottle / 5; // a 750 ml bottle fills five 5 oz glasses
    const menu = menuOf(profile, "glass");
    const keep = menu - per;
    return keep > 0 ? { text: `${caseIs(perBottle, "a bottle")}, five glasses to a bottle: about ${money(per)} a glass, so at ${money(menu)} a glass you keep about ${money(keep)}.`, price: p.text } : null;
  }
  if (bottles && kind === "spirit") {
    const per = perBottle / 17; // a 750 ml bottle is about seventeen 1.5 oz shots
    return { text: `${caseIs(perBottle, "a bottle")}, about 17 shots of 1.5 oz: about ${money(per)} a shot, to price against your cocktails.`, price: p.text };
  }
  if (bottles) return null;
  if (p.unit === "case" || p.unit === "can") {
    const per = p.amount / p.count;
    // "a can" when the rep's words say cans, else "each" (never invented)
    const each = cans || p.unit === "can" ? "a can" : "each";
    const menu = menuOf(profile, kind === "soft" ? "softCan" : "can");
    const keep = menu - per;
    if (keep <= 0) return null;
    return { text: `${caseIs(per, each)}: if it sells at ${money(menu)} on your menu, you keep about ${money(keep)} ${each}.`, price: p.text };
  }
  return null;
}
