// The five §7 probes over the fixed scenario set: swap (+ stability), ablation, label-invariance, empty-slot,
// correction. Each returns plain rows with their own pass/fail and n, so docs/PROOF.md and test/proof.test.mjs read the
// same numbers. All code checks: no model judges here (scripts/proof/judge.mjs is the separate, different-model screen).
import { NA_FRAME, OFFER, tasteGuess } from "../../public/lib/talk-gen.js";
import { createHash } from "node:crypto";
import { SCENARIOS, SWAPS, byKey } from "./scenarios.mjs";
import { runScenario, diff, SLOTS, FIELDS, routesFor, enrichOf } from "./harness.mjs";
import { BANNED_PITCH, BRAND_CATEGORY, NA_BRANDS, km, parseHours, openMinutes } from "../../public/lib/core.js";
import { defaultAsk, NEUTRAL_ASK, productKind } from "../../public/lib/talk.js";
import { roomOf, validateProfile, isNA, toMinutes } from "../../public/lib/profile.js";
import { windowsFor } from "../../public/lib/pool.js";
import { marginLine } from "../../public/lib/ask.js";
import { createStore } from "../../public/lib/store.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "./harness.mjs";
import { returnCase } from "./slots-probes.mjs";

const INDEX = JSON.parse(readFileSync(join(ROOT, "public/data/index.json"), "utf8"));
const CENTER = Object.fromEntries(INDEX.cities.map((c) => [c.key, c.center]));
export const hash = (x) => createHash("sha256").update(JSON.stringify(x)).digest("hex").slice(0, 12);
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const allText = (r) => r.stops.flatMap((s) => [s.opener, ...s.questions, ...s.points, ...s.pushback, s.ask, s.note, s.subject, ...s.before]).join("\n");

// ---------- appropriateness: code checks a rep could verify by hand ----------
// Every planned room is in the city (≤ 40 km from its centre) and of a kind the rep picked; the ask is the rep's or
// the kind's default; NA framing appears iff the product is an NA alternative; a soft drink is never framed as NA;
// no banned word in Doors' own words outside the rep's; the note names the city.
export function appropriate(s, r) {
  const venues = Object.assign({}, ...routesFor(s.profile).map((x) => x.venues));
  const planned = r.days.flatMap((d) => d?.stops ?? []);
  const c = CENTER[s.profile.city];
  const fails = [];
  for (const id of planned) {
    const v = venues[id];
    if (!v) continue;
    if (km({ lat: v.lat, lon: v.lon }, { lat: c[0], lon: c[1] }) > 40) fails.push(`${v.name} is outside ${s.cityName}`);
    if (!s.profile.rooms.includes(roomOf(v))) fails.push(`${v.name} is a ${roomOf(v)} room, not picked`);
  }
  const wantAsk = s.profile.pitch.ask || defaultAsk(s.profile.what);
  for (const st of r.stops) {
    if (st.ask !== wantAsk && !(st.lead?.ask && st.ask === st.lead.ask && st.lead.src.length && !s.profile.pitch.ask)) fails.push(`${st.name}: ask "${st.ask}" ≠ "${wantAsk}"`);
    // a written set (group 3 item 3; round 3 g4): the NA framing (lib/talk-gen.js NA_FRAME) may appear only when the
    // product is an alcohol alternative; an NA set is free to use it or not (the g3 rule "must say who it's for" is
    // gone: it made every NA door read the same, Jard 10-25). The template's own phrases are checked as before, both ways.
    const naFramed = st.talkBy === "model"
      ? NA_FRAME.test([st.opener, st.toBuyer, ...st.questions, ...st.points, ...st.pushback, st.note].join(" "))
      : /isn't drinking|non-alcoholic drinks|aren't drinking/.test([st.opener, ...st.questions, ...st.pushback].join(" "));
    if (st.talkBy === "model" ? naFramed && !r.na : naFramed !== r.na) fails.push(`${st.name}: NA framing ${naFramed} but product NA ${r.na}`);
    if (!st.note.includes(s.cityName)) fails.push(`${st.name}: note doesn't name ${s.cityName}`);
  }
  if (!planned.length) fails.push("no doors planned");
  return { ok: fails.length === 0, fails };
}

// ---------- 1. swap + stability ----------
export function swapProbe() {
  return SWAPS.map(([a, b, kind]) => {
    const A = byKey(a), B = byKey(b);
    const ra = runScenario(A), rb = runScenario(B);
    const d = diff(ra, rb);
    const appA = appropriate(A, ra), appB = appropriate(B, rb);
    return { a, b, kind, changed: d.changed, top10Overlap: d.top10Overlap, day1Overlap: d.day1Overlap, appropriateA: appA, appropriateB: appB, ra, rb,
      visible: d.top10Overlap < 0.5 && d.changed.includes("plan"), ok: d.top10Overlap < 0.5 && d.changed.includes("plan") && appA.ok && appB.ok };
  });
}
export function stabilityProbe(runs = 3) {
  return SCENARIOS.map((s) => {
    const hs = Array.from({ length: runs }, () => hash(runScenario(s)));
    return { key: s.key, hash: hs[0], runs, ok: hs.every((h) => h === hs[0]) };
  });
}

// ---------- 2. ablation ----------
export function ablationProbe() {
  const base = Object.fromEntries(SCENARIOS.map((s) => [s.key, runScenario(s)]));
  return SLOTS.map((sl) => {
    const rows = SCENARIOS.filter((s) => sl.applies(s)).map((s) => ({ key: s.key, ...diff(base[s.key], runScenario(s, { off: [sl.key] })) }));
    const fieldCounts = Object.fromEntries(Object.keys(FIELDS).map((f) => [f, rows.filter((r) => r.changed.includes(f)).length]));
    return { slot: sl.key, framework: sl.framework, source: sl.source, decision: sl.decision, offMeans: sl.offMeans, n: rows.length,
      changedIn: rows.filter((r) => r.changed.length).length, fieldCounts, rows, inert: rows.every((r) => !r.changed.length) };
  });
}
// The baseline of §7: every slot off at once (the same app with its cultural inputs withheld).
export const BASELINE_OFF = SLOTS.map((s) => s.key);
export function baselineRun(s) {
  return runScenario(s, { off: SLOTS.filter((x) => x.applies(s)).map((x) => x.key) });
}

// ---------- 3. label invariance ----------
export const SIGNERS = ["Maya Ortiz", "Emily Walsh", "DeShawn Jackson", "Nguyen Thi Lan", "Mohammed Al-Sayed", "Svetlana Ivanova"];
// Demographic labels put into every room's crowd text (Qloo's "customer demographics" field), the rank, hours, place
// and every behavioural signal held fixed.
export const CROWD_LABELS = ["young professionals and college students", "retirees and older couples", "Hispanic families", "Black professionals", "Asian American students", "LGBTQ+ couples", "working-class locals"];
// Labels a profile could carry that Doors has no field for: the probe shows they change nothing.
export const PROFILE_LABELS = [{ audience: "Latino" }, { audience: "Gen Z women" }, { audience: "Black men over 50" }, { repGender: "female" }, { repEthnicity: "Asian" }];
// Round 3 (Jard 10-25): Qloo's crowd description now reaches the model on purpose ("pretending you can't see facts about
// a neighborhood, a market, a demographic is bad business"), so a room's demographic label MAY change the written
// questions and points; what it must never move is which doors are picked and planned, the rooms filter and the ask,
// and it must never turn into a taste claim ("Hispanic families like a lighter beer"): the "so what" check below reads
// every shown line for a group paired with a taste verb and a drink (lib/talk-gen.js tasteGuess). The written lines in
// this offline run are the sets written from the real crowd text (a mutated label has no written set and shows the
// template), so the so-what check is over the real sets and the template.
const DECISIONS = ["ranking", "roomKinds", "plan", "ask"];

export function labelProbe() {
  const out = [];
  for (const s of SCENARIOS) {
    // a. the signer's name
    const runs = SIGNERS.map((n) => {
      const r = runScenario(s, { mutate: ({ profile }) => { profile.pitch.name = n; } });
      const first = n.split(" ")[0];
      return JSON.stringify(r).split(first).join("<NAME>");
    });
    out.push({ key: s.key, probe: "signer name", n: SIGNERS.length, ok: runs.every((x) => x === runs[0]), changed: runs.every((x) => x === runs[0]) ? [] : ["note"] });
    // b. the room's demographic text: the doors, the plan, the rooms filter and the ask must not move; the opener may
    // echo the label, and only the label; the talking points may change (round 3) but never guess a taste from it
    const crowd = CROWD_LABELS.map((label) => {
      const r = runScenario(s, { mutate: ({ routes, city }) => { city.talk = { venues: {} }; for (const rt of routes) for (const v of Object.values(rt.venues)) v.crowd = `The customer base primarily consists of ${label}.`; } });
      return { label, r };
    });
    const r0 = crowd[0].r;
    const moved = DECISIONS.filter((f) => crowd.some((c) => !eq(FIELDS[f](c.r), FIELDS[f](r0))));
    const echoOk = crowd.every((c) => c.r.stops.every((st) => !/^Looks like/.test(st.opener) || st.opener.toLowerCase().includes(lowerFirst(c.label).toLowerCase().split(" and ")[0])));
    const guessed = [...crowd.map((c) => c.r), runScenario(s)].flatMap((r) => r.stops.flatMap((st) => [st.toBuyer, ...st.questions, ...st.points, ...st.pushback, ...st.before].filter(Boolean).map((t) => ({ name: st.name, t, g: tasteGuess(t) })))).filter((x) => x.g);
    out.push({ key: s.key, probe: "room demographic labels: doors, plan, rooms and ask hold; no taste guessed from a group", n: CROWD_LABELS.length, ok: moved.length === 0 && echoOk && !guessed.length, changed: moved, echoOk,
      guessed: guessed.slice(0, 3).map((x) => `${x.name}: "${x.g}"`), openerSample: crowd.map((c) => c.r.stops[0]?.opener) });
    // c. labels with no field
    const p = PROFILE_LABELS.map((l) => hash(runScenario(s, { mutate: ({ profile }) => Object.assign(profile, l) })));
    out.push({ key: s.key, probe: "profile labels Doors has no field for", n: PROFILE_LABELS.length, ok: p.every((h) => h === hash(runScenario(s))), changed: [] });
  }
  return out;
}
const lowerFirst = (s) => s.replace(/^[A-Z](?![A-Z])/, (c) => c.toLowerCase());

// ---------- 4. empty slot ----------
// Numbers Doors may print: from the rep's profile, the facts file, the room's record (name, address, phone, hours),
// the rank line and the clock. Any other number is invented.
function numbersOk(s, r) {
  const venues = Object.assign({}, ...routesFor(s.profile).map((x) => x.venues));
  const facts = JSON.parse(readFileSync(join(ROOT, "public/data/facts.json"), "utf8")).facts.map((f) => f.text).join(" ");
  const bad = [];
  for (const st of r.stops) {
    const v = venues[st.id] ?? {};
    // persona MUST #2: the margin line's numbers are arithmetic on the rep's own price (lib/ask.js), with "What you
    // make" as given or blanked (the empty-slot runs)
    const margin = [s.profile.what, ""].map((what) => marginLine({ what, price: s.profile.pitch?.price, ask: st.ask })?.text ?? "").join(" ");
    // round 3: the door's own site facts (the enrich lane's record, "56 taps") and the facts the stop shows are the model's
    // inputs too (freeze 10-28: Centennial's "56 taps" was flagged as invented; it is the door's own line)
    const own = [JSON.stringify(s.profile), facts, v.name, v.address, v.phone, JSON.stringify(v.hours), String(r.N), st.rankLine, v.crowd ?? "", margin, JSON.stringify(enrichOf(s.profile.city)[st.id] ?? []), JSON.stringify(st.facts ?? [])].join(" ");
    const text = [st.opener, ...st.questions, ...st.points, ...st.pushback, st.ask, st.note].join(" ")
      .replace(/\b\d{1,2}(:\d\d)? ?(am|pm)\b/gi, "") // the clock (from the plan)
      .replace(/\(\d{3}\) \d{3}-\d{4}/g, "") // the room's phone, formatted
      .replace(/#\d+ of \d+/g, "");
    for (const n of text.match(/\d+/g) ?? []) if (!own.includes(n) && !["one", "two"].includes(n)) bad.push(`${st.name}: ${n}`);
  }
  return bad;
}
export function emptyProbe() {
  const rows = [];
  const add = (case_, key, ok, detail) => rows.push({ case: case_, key, ok, detail });
  for (const s of SCENARIOS) {
    // What you make blank: neutral kind, neutral ask, no category, no NA facts
    const r = runScenario(s, { mutate: ({ profile }) => { profile.what = ""; profile.pitch.ask = ""; } });
    // Doors' own words only: room names (the stops' and their sister rooms') are Qloo's, not a claim about the product
    // the crowd sentence ("Looks like you get a lot of craft beer enthusiasts …") is Qloo's word for the room's regulars,
    // not a claim about the product: a word in it that the room's own crowd text has is the room's data
    const crowdless = (x, s) => String(s ?? "").replace(/Looks like [^.?!]*[.?!]/g, (m) => (m.match(/\b[a-z-]+\b/gi) ?? []).every((w) => /^(looks|like|you|your|get|draw|a|an|lot|of|the|and|in|here|regulars|are)$/i.test(w) || new RegExp(`\\b${w}\\b`, "i").test(x.crowdSource ?? "")) ? "" : m);
    const t = r.stops.flatMap((x) => [crowdless(x, x.opener.replace(x.lead?.question ?? "\u0000", "")), ...x.questions.filter((q) => !x.lead?.src.length || (q !== x.lead.gate && q !== x.lead.question)), ...x.points.filter((q) => !/(rooms|doors) whose regulars Qloo matches/.test(q)), ...x.pushback.filter((q) => !/^We only serve our own beer\./.test(q)), x.ask, crowdless(x, x.note)]).join("\n"); // a brewery's own objection names its beer, not the product
    const invented = /\b(beer|IPA|lager|cider|wine|tequila|mezcal|spirit|seltzer|sparkling|water|non-alcoholic|soda|coffee)\b/i.exec(t.replace(new RegExp(r.stops.map((x) => x.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") || "$^", "g"), ""));
    const naFacts = r.stops.flatMap((x) => x.facts).filter((f) => /^na-/.test(f));
    // a question or ask from Qloo's tags on the room (R9 deep "lead", sourced) is the room's data, not an invention
    const leadAsk = (x) => x.lead?.ask && x.lead.src.length && x.ask === x.lead.ask;
    add("What you make blank", s.key, r.kind === "other" && r.stops.every((x) => x.ask === NEUTRAL_ASK || leadAsk(x)) && !naFacts.length && !invented,
      `kind ${r.kind}; ask "${r.stops[0]?.ask}"${invented ? `; says "${invented[0]}"` : ""}${naFacts.length ? `; NA facts ${naFacts}` : ""}`);
    // Your ask blank: the kind's default, the same one the form shows on the field (never invented out of sight)
    const ra = runScenario(s, { mutate: ({ profile }) => { profile.pitch.ask = ""; } });
    add("Your ask blank", s.key, ra.stops.every((x) => x.ask === defaultAsk(s.profile.what) || (x.lead?.ask && x.lead.src.length && x.ask === x.lead.ask)),
      `${[...new Set(ra.stops.map((x) => `"${x.ask}" (${x.ask === defaultAsk(s.profile.what) ? "kind default" : `Qloo tags: ${x.lead?.src.join(", ")}`})`))].join("; ")}`);
    // no crowd text and no lead: a plain question, no "Looks like", no crowd line in the note
    const rc = runScenario(s, { off: ["crowd"] });
    add("No crowd text for the room", s.key, rc.stops.every((x) => !/Looks like/.test(x.opener + x.note)), rc.stops[0]?.opener);
    // no sister rooms: no sister line (judge pass 4, N24: it moved from Points to make to Before you walk in)
    const rs = runScenario(s, { off: ["sisters"] });
    add("No sister rooms", s.key, rs.stops.every((x) => !x.points.some((p) => /(rooms|doors) whose regulars Qloo matches/.test(p)) && !x.before.some((b) => /^(Rooms like it|Sister doors): /.test(b))), "");
    // no price: Doors tells the rep to bring theirs, prints no number
    const rp = runScenario(s, { mutate: ({ profile }) => { profile.pitch.price = ""; } });
    add("No price", s.key, rp.stops.every((x) => x.before.some((b) => /your price per case/.test(b)) && !/\$\d/.test(x.before.join(" "))), "");
    // no invented numbers anywhere, in the normal run and the empty ones
    const bad = [r, ra, rc, rs, rp, runScenario(s)].flatMap((x) => numbersOk(s, x));
    add("No number not in the inputs", s.key, bad.length === 0, bad.slice(0, 3).join("; "));
  }
  // no drinker signal at all, no signer: the form asks, nothing is planned
  const p = structuredClone(SCENARIOS[0].profile);
  p.drinks = []; p.pours = []; p.pitch.name = "";
  const v = validateProfile(p, { cities: INDEX.cities });
  add("No drinker brand and no room (no taste signal)", "form", !v.ok && Boolean(v.errors.drinks), v.errors.drinks ?? "");
  add("No signer", "form", !v.ok && Boolean(v.errors.name), v.errors.name ?? "");
  return rows;
}

// ---------- 5. correction ----------
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; } };
}
export function correctionProbe() {
  const rows = [];
  const add = (case_, key, ok, detail) => rows.push({ case: case_, key, ok, detail });
  for (const s of SCENARIOS) {
    const storage = memoryStorage();
    const save = (st) => createStore(storage).save(s.profile.brand, s.profile.city, st);
    const reload = () => createStore(storage).load(s.profile.brand, s.profile.city); // a new store over the same storage = a page reload
    const r0 = runScenario(s);
    const top = r0.days[0].stops[0];
    // a. the rep's ask beats the kind's default, survives a reload, and still wins after What you make changes
    const ask = "two cans for the staff fridge, on us";
    save({ profile: { ...structuredClone(s.profile), pitch: { ...s.profile.pitch, ask } } });
    const p1 = reload().profile;
    const r1 = runScenario(s, { profile: p1 });
    const p2 = { ...structuredClone(p1), what: isNA(p1.what) ? "Non-alcoholic lager" : "Pilsner" };
    const r2 = runScenario(s, { profile: p2 });
    // Jard 10-24 #5: the ask is for the conversation after the taste: it is never in a first message
    add("Rep's ask beats the default, after reload and a kind change (and stays out of the first message)", s.key, [r1, r2].every((r) => r.stops.every((x) => x.ask === ask && !x.note.includes(ask))), `default "${defaultAsk(s.profile.what)}" → "${r1.stops[0]?.ask}"`);
    // b. the rep's own words are kept verbatim, even with a word Doors never says itself
    const own = "a pour of it at your staff meal";
    const r3 = runScenario(s, { mutate: ({ profile }) => { profile.pitch.ask = own; } });
    add("Rep's words verbatim (a word Doors bans for itself)", s.key, r3.stops.every((x) => x.ask === own && !x.note.includes(own)), "");
    // c. Not a fit beats Qloo's rank: the top planned room leaves every day, stays on Qloo's list, and the status persists
    const st = createStore(storage);
    st.setStatus(s.profile.brand, s.profile.city, top, "notfit");
    const statuses = reload().statuses;
    const r4 = runScenario(s, { statuses });
    const gone = !r4.days.some((d) => d?.stops.includes(top)) && r4.top10.includes(top) === r0.top10.includes(top);
    st.setStatus(s.profile.brand, s.profile.city, top, null);
    const r5 = runScenario(s, { statuses: reload().statuses });
    add("Not a fit beats Qloo's rank, persists; Undo restores", s.key, gone && eq(r5.days, r0.days), `${r0.stops[0]?.name}: off the plan after reload; back after Undo`);
    // d. a room the rep already knows is not re-planned
    const r6 = runScenario(s, { mutate: ({ profile }) => { profile.known = [top]; } });
    add("Doors you already know: not re-planned", s.key, !r6.days.some((d) => d?.stops.includes(top)), "");
    // e. a follow-up date the rep sets pins a room to that day, even one Qloo ranks low
    // a room not on Wednesday, open for a visit inside Wednesday's window (a closed room gets a true "not on the plan" note instead)
    const venuesAll = Object.assign({}, ...routesFor(s.profile).map((x) => x.venues));
    const w = s.profile.windows[1];
    const low = [...r0.unscheduled, ...r0.top10].find((id) => !r0.days[1]?.stops.includes(id) && openMinutes(parseHours(venuesAll[id]?.hours), "wednesday", toMinutes(w.from), toMinutes(w.to)) >= 60);
    if (low) {
      const r7 = runScenario(s, { outcomes: { [low]: { result: "followup", followUp: "2026-10-28" } } });
      add("Follow-up date pins the room to that day", s.key, r7.days[1]?.stops.includes(low), "");
    }
    // f. the rep's Rooms to pitch beat the default: drop restaurants → none planned; persists
    if (s.profile.rooms.includes("restaurants")) {
      save({ profile: { ...structuredClone(s.profile), rooms: s.profile.rooms.filter((x) => x !== "restaurants"), roomsTouched: true } });
      const r8 = runScenario(s, { profile: reload().profile });
      const venues = Object.assign({}, ...routesFor(s.profile).map((x) => x.venues));
      add("Rooms to pitch: rep drops restaurants, none planned (after reload)", s.key, r8.days.flatMap((d) => d?.stops ?? []).every((id) => roomOf(venues[id]) !== "restaurants"), "");
    }
  }
  return rows;
}

// ---------- 6. talking points the screen caught (docs/PROOF.md "Found by the screen" 1, 2, 3, 5) ----------
// Code checks over every scenario's first six stops and its return visit, so a fix can't regress unseen:
// 1 the pushback's small start (and the return-visit price reply) is the stop's own ask, and a price rides along only in
//   the ask's unit; 2 "your guests already buy …" names only the drinks-like brand's own category (or "non-alcoholic
//   drinks" for an NA brand and an NA product); 3 a blank "What you make" never talks broken English; 5 "any alcohol at
//   all?" is asked only where no Qloo drinks tag, name or genre says the room pours.
const POURS_TAGS = /^(Full bar|Spirits|Cocktails|Specialty cocktails|Specialty alcoholic|Aperitifs and digestifs|Beer|Craft beer|Local beer|Wine)$/;
const POURING_NAME = /\b(ale ?house|pub|tavern|tap ?room|tap ?house|brew(ery|ing|pub|house|s)?|bar|saloon|beer|beers|wine|winery|cocktails?|distillery|cidery|lounge|speakeasy)\b/i;
const unitOf = (x) => (/\bcases?\b/i.test(x) ? "case" : /\bbottles?\b/i.test(x) ? "bottle" : /\bkegs?\b/i.test(x) ? "keg" : /\bcans?\b/i.test(x) ? "can" : null);
export function talkProbe() {
  const rows = [];
  const add = (case_, key, ok, detail) => rows.push({ case: case_, key, ok, detail });
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const s of SCENARIOS) {
    const r = runScenario(s, { stops: 6 });
    const venues = Object.assign({}, ...routesFor(s.profile).map((x) => x.venues));
    // 1. the small start is the ask
    // a set Claude wrote (group 3 item 3): every reply that offers a way to start offers the ask, word for word
    const bad1 = r.stops.filter((x) => (x.talkBy === "model"
      ? !x.pushback.filter((p) => OFFER.test(p.split(" → ")[1] ?? "")).every((p) => p.split(" → ")[1].toLowerCase().includes(x.ask.toLowerCase()))
      : !x.pushback.filter((p) => /sell here\. → /.test(p)).every((p) => new RegExp(`→ Then start with ${esc(x.ask)}[.:]`).test(p))));
    add("1. Pushback's small start = the stop's ask", s.key, r.stops.length > 0 && !bad1.length, bad1.length ? `${bad1[0].name}: ${bad1[0].pushback.find((p) => /sell here/.test(p) || (bad1[0].talkBy === "model" && OFFER.test(p.split(" → ")[1] ?? "") && !p.split(" → ")[1].toLowerCase().includes(bad1[0].ask.toLowerCase())))} (ask "${bad1[0].ask}")` : `"${r.stops[0]?.ask}"`);
    const c = returnCase(s);
    if (c) {
      const reply = c.back.pushback.find((p) => /^Last time: /.test(p)) ?? "";
      const price = String(s.profile.pitch.price ?? "");
      const fits = price && unitOf(c.back.ask) && unitOf(c.back.ask) === unitOf(price);
      add("1. Return visit's price reply starts with the stop's ask; the price only in the ask's unit", s.key,
        new RegExp(`→ Start with ${esc(c.back.ask)}[ :;(]`).test(reply) && (fits || !price || !reply.includes(price)), reply.replace(/^.*?→ /, ""));
    }
    // 2. "already buy" only what the data backs
    const like = s.profile.drinks[0];
    const backed = like ? (NA_BRANDS.has(like.key) && isNA(s.profile.what) ? "non-alcoholic drinks" : String(BRAND_CATEGORY[like.key] ?? "").toLowerCase()) : null;
    const claims = [...new Set(r.stops.flatMap((x) => x.pushback).map((p) => /already buy (.+?)\. /.exec(p)?.[1]).filter(Boolean))];
    add("2. 'Your guests already buy …' names only the drinks-like brand's category", s.key, claims.every((x) => x === backed), claims.length ? `says "${claims.join('", "')}"; data: ${like?.name} = "${backed}"` : "no claim");
    // 3. blank What you make: sayable
    const rb = runScenario(s, { mutate: ({ profile }) => { profile.what = ""; } });
    const t = rb.stops.flatMap((x) => [x.opener, ...x.questions, ...x.points, ...x.pushback]).join("\n");
    const broken = /when they want drink\b|carry in drink\b|is an? drink\b|^Drink doesn't|→ Drink doesn't/m.exec(t);
    add("3. 'What you make' blank: no broken English", s.key, !broken, broken ? `says "${broken[0]}"` : rb.stops[0]?.opener);
    // 5. the any-alcohol gate only where the room plausibly pours none
    const odd = r.stops.filter((x) => /any alcohol at all/.test(x.lead?.gate ?? "")).filter((x) => {
      const v = venues[x.id] ?? {};
      return (v.tags?.bev ?? []).some((b) => POURS_TAGS.test(b)) || POURING_NAME.test(`${v.name ?? ""} ${String(v.genre ?? "").replace(/[:_]/g, " ")}`);
    });
    add("5. 'Any alcohol at all?' only where nothing says the room pours", s.key, !odd.length, odd.length ? odd.map((x) => x.name).join(", ") : "");
  }
  // the room the screen caught, by name: Armitage Alehouse in mezcal-chicago-dj
  const dj = byKey("mezcal-chicago-dj");
  const id = Object.entries(Object.assign({}, ...routesFor(dj.profile).map((x) => x.venues))).find(([, v]) => v.name === "Armitage Alehouse")?.[0];
  // added to the first day, so the probe reads this room's words whatever the routing picks (V4.1 plans other rooms)
  const day1 = windowsFor(dj.profile)[0]?.date;
  const a = id ? runScenario(dj, { focus: id, added: [{ ...Object.assign({}, ...routesFor(dj.profile).map((x) => x.venues))[id], id, date: day1 }] }).stops[0] : null;
  add("5. Armitage Alehouse (tagged 'Non alcoholic only' next to Full bar): no any-alcohol gate", "mezcal-chicago-dj", Boolean(a) && !/any alcohol/.test([a.lead?.gate, ...a.questions].join(" ")), a ? `opener "${a.opener}"` : "not planned");
  return rows;
}

export const summary = (rows) => ({ n: rows.length, pass: rows.filter((r) => r.ok).length });
export { SCENARIOS, SWAPS };
export const BANNED = BANNED_PITCH;
