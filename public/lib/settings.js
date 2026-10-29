// Round 4 item 6 (Jard 10-27: "i don't see a way to edit my schedule, hours, etc. — everything i write when i'm
// setting up a new brand/profile should be editable"): every setup field as a Settings row, with what it holds now and
// the link that opens its form scrolled to that field (#/brand?field=…, #/city?city=…&field=…). profileChanges says,
// in plain words, what an edited profile changed against the saved one (the preview tray, Changes you made, the Undo).
// Pure: no DOM. The form's field ids (ui/profile.js: #fd-<id>) are the `field` values.
import { SELLS, SUPPORT, ROOMS, productLine, drinkersLine, poursOf, listWords, clock12, toMinutes, niceDate, CITY_KEYS, sellsOf } from "./profile.js";
import { DAYS } from "./core.js";
import { hrefFor } from "./router.js";

const str = (x) => String(x ?? "").trim();
const cap = (s) => s.replace(/^./, (c) => c.toUpperCase());
const dayShort = (d) => `${d[0].toUpperCase()}${d.slice(1, 3)}`;
const clock = (m) => clock12(m).replace(":00", "");
const hours = (w) => `${clock(toMinutes(w.from))}–${clock(toMinutes(w.to))}`;
const startWord = (s) => str(s?.label) || (Number.isFinite(s?.lat) ? `a pin at ${(+s.lat).toFixed(3)}, ${(+s.lon).toFixed(3)}` : "");
const NONE = "Not set";

// The usual week in words: "Tue, Thu 2–6 pm; Sat 12–4 pm from Rainey St" (days with the same hours and start grouped);
// dated days only (no usual week): "Tue Oct 13 2–6 pm, Thu Oct 15 2–6 pm".
export function daysWords(p) {
  const wk = p?.week;
  if (wk) {
    const groups = [];
    for (const d of DAYS) {
      const u = wk.days?.[d];
      if (!u?.from || !u?.to) continue;
      const key = `${hours(u)}|${startWord(u.start)}`;
      const g = groups.find((x) => x.key === key);
      if (g) g.days.push(dayShort(d));
      else groups.push({ key, days: [dayShort(d)], text: `${hours(u)}${u.start ? ` from ${startWord(u.start)}` : ""}` });
    }
    return groups.length ? groups.map((g) => `${g.days.join(", ")} ${g.text}`).join("; ") : NONE;
  }
  const ws = p?.windows ?? [];
  return ws.length ? ws.map((w) => `${niceDate(w.date)} ${hours(w)}${w.start ? ` from ${startWord(w.start)}` : ""}`).join(", ") : NONE;
}
// One-date changes to the usual week: "Oct 30 off; Nov 3 10 am–1 pm" ("" when none)
export function changesWords(p) {
  const ch = Object.entries(p?.week?.changes ?? {}).sort(([a], [b]) => (a < b ? -1 : 1));
  return ch.map(([date, c]) => `${niceDate(date).replace(/^\w+ /, "")} ${c?.off ? "off" : `${hours(c)}${c.start ? ` from ${startWord(c.start)}` : ""}`}`).join("; ");
}
const capWords = (p) => {
  const by = Object.entries(p?.maxByDate ?? {}).sort(([a], [b]) => (a < b ? -1 : 1));
  const base = p?.maxPerDay ? `${p.maxPerDay} a day` : "No limit";
  return by.length ? `${base}; ${by.map(([d, n]) => `${niceDate(d).replace(/^\w+ /, "")}: ${n}`).join(", ")}` : base;
};
const roomsWords = (p) => { const ks = p?.rooms ?? []; const names = ROOMS.filter((r) => ks.includes(r.key)).map((r) => r.phrase); return names.length ? cap(listWords(names)) : NONE; };
const productWords = (p) => productLine({ ...(p ?? {}), sells: [], product: { ...(p?.product ?? {}), sells: "" } }); // how you sell is the city's row
const supportWords = (p) => { const ks = p?.pitch?.support ?? []; const names = SUPPORT.filter((s) => ks.includes(s.key)).map((s) => s.label.toLowerCase()); return names.length ? cap(listWords(names)) : "None"; };
const sellsWords = (p) => { const ks = sellsOf(p); const names = SELLS.filter((s) => ks.includes(s.key)).map((s) => s.label.toLowerCase()); return names.length ? cap(listWords(names)) : NONE; };
const cityWords = (p, index) => index?.cities?.find((c) => c.key === p?.city)?.name ?? str(p?.cityName) ?? NONE;

// The brand's rows and the city's rows: [{part: "brand"|"city", field, label, value, href}]. cityKey: the saved city's
// key (its form's address); demoHref: the demo's one form instead (every row opens it at its field).
export function settingsRows(p, index, { cityKey = p?.city ?? "", demoHref = null } = {}) {
  const link = (part, field) => (demoHref ? `${demoHref}${demoHref.includes("?") ? "&" : "?"}field=${field}` : part === "brand" ? hrefFor("brand", { field }) : hrefFor("city", { city: cityKey, field }));
  const pours = poursOf(p, index?.rooms ?? []);
  const brand = [
    ["brand", "Brand name", str(p?.brand) || NONE],
    ["what", "What you make", str(p?.what) || NONE],
    ["product", "Your product", productWords(p) || NONE],
    ["name", "Sign your messages as", str(p?.pitch?.name) || NONE],
    ["drinks", "Your drinker also drinks", (p?.drinks ?? []).length ? listWords(p.drinks.map((d) => d.name)) : "None"],
    ["pours", "Doors that already pour you", pours.length ? listWords(pours.map((r) => r.name)) : "None"],
    ["rooms", "Door types", roomsWords(p)],
    ["drinkers", "Your drinkers", drinkersLine(p) || "Not described"],
    ["ask", "Your ask", str(p?.pitch?.ask) || NONE],
    ["pitch", "Your pitch", [supportWords(p) === "None" ? "" : `Support: ${supportWords(p).toLowerCase()}`, str(p?.pitch?.menuPrice) ? `menu price ${str(p.pitch.menuPrice)}` : ""].filter(Boolean).join(" · ") || "No support or menu price given"],
  ].map(([field, label, value]) => ({ part: "brand", field, label, value, href: link("brand", field) }));
  const cityName = cityWords(p, index);
  const chg = changesWords(p);
  const city = [
    ["city", "City", cityName || NONE],
    ["start", "Where your day starts", startWord(p?.start) || NONE],
    ["windows", "Days and hours", `${daysWords(p)}${chg ? `. Changed dates: ${chg}` : ""}`],
    ["visit", "Time at each door", Number.isFinite(+p?.visitMin) && p?.visitMin ? `${p.visitMin} min` : NONE],
    ["cap", "Most doors a day", capWords(p)],
    ["sells", "How you sell here", sellsWords(p)],
    ["known", "Doors to skip", (p?.known ?? []).length ? `${p.known.length} ${p.known.length === 1 ? "door" : "doors"} you already call on` : "None"],
  ].map(([field, label, value]) => ({ part: "city", field, label, value, href: link("city", field) }));
  return [...brand, ...city];
}

// Round 8 (Jard 10-28: "why do we have every single thing that we can edit in settings when it all takes you to the
// same page?"): Settings shows one short summary per part, each with one Edit; the rows above stay for profileChanges.
export const SUMMARY_FIELDS = { brand: ["brand", "product", "drinks", "rooms", "ask"], city: ["city", "windows", "visit", "cap"] };
export function settingsSummary(p, index, opts = {}) {
  const rows = settingsRows(p, index, opts);
  const pick = (part) => SUMMARY_FIELDS[part].map((f) => rows.find((r) => r.part === part && r.field === f));
  return { brand: pick("brand"), city: pick("city") };
}

// What `after` changed against `before`, row by row: [{field, label, from, to}] (the rows whose words differ).
export function profileChanges(before, after, index) {
  const a = settingsRows(before ?? {}, index), b = settingsRows(after ?? {}, index);
  return b.map((r, i) => ({ field: r.field, label: r.label, part: r.part, from: a[i].value, to: r.value })).filter((c) => c.from !== c.to);
}
// The changes in one line, as Changes you made and the toast say them: "Days and hours: Tue, Thu 2–6 pm; Where your
// day starts: Rainey St" (the tray shows what each was)
export function changesLine(changes) {
  return changes.map((c) => `${c.label}: ${c.to}`).join("; ");
}
// True when the brand's fields differ (a brand edit is written into every city; ui/app.js saveBrand)
export function brandDiffers(a, b) {
  const strip = (p) => { const o = structuredClone(p ?? {}); for (const k of [...CITY_KEYS, "sample", "roomsTouched"]) delete o[k]; return o; };
  return JSON.stringify(sortKeys(strip(a))) !== JSON.stringify(sortKeys(strip(b)));
}
const sortKeys = (x) => (Array.isArray(x) ? x.map(sortKeys) : x && typeof x === "object" ? Object.fromEntries(Object.keys(x).sort().map((k) => [k, sortKeys(x[k])])) : x);
