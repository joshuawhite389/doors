// C1 · the stop (SPEC-V2 §3.5, §7, §8): the drafted note, outcomes → follow-up pins through the planner, the notes and
// call-sheet export, and talking-point line selection (stored model lines vs the template, and the guard).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPool, windowsFor } from "../public/lib/pool.js";
import { planDays } from "../public/lib/schedule.js";
import { BANNED_PITCH } from "../public/lib/core.js";
import { draftNote, crowdForNote, directionsUrl, smsHref, mailtoHref, telHref, noteLabel, noteFor } from "../public/lib/note.js";
import { humanTime } from "../public/lib/talk.js";
import { makeOutcome, defaultFollowUp, outcomeTags, outcomeText, followUpPlace, followUpToast, shortDate, followUpLine, visitStamp } from "../public/lib/outcome.js";
import { guardTalkLine, withModelTalk, talkLabel, openerQuestion } from "../public/lib/talk-model.js";
import { stopModel, cityArtists, streetOf } from "../public/lib/stopmodel.js";
import { notesText, callSheetHTML, planCSV } from "../public/lib/export.js";
import { route, city, readJson } from "./helpers.mjs";
import { quickChoices } from "../public/ui/outcome.js";

const ab = route("athletic-brewing-austin");
const AUSTIN = city("austin");
const FACTS = readJson("public/data/facts.json").facts;
const TUE = "2026-10-13", WED = "2026-10-14", THU = "2026-10-15";
const profile = {
  brand: "Tidewell",
  what: "Non-alcoholic hazy IPA",
  drinks: [{ key: "athletic-brewing", name: "Athletic Brewing", ready: true }],
  rooms: ["bars", "breweries"],
  start: { lat: 30.2556, lon: -97.7208, label: "E Cesar Chavez St" },
  windows: [{ date: TUE, from: "14:00", to: "16:00" }, { date: WED, from: "13:00", to: "18:00" }, { date: THU, from: "14:00", to: "18:00" }],
  visitMin: 25,
  pitch: { price: "$38 a case", ask: "", support: ["tasting"], name: "Maya Ortiz" },
  known: [],
};

// the planner's run, wrapped in the state.js plan shape the stop reads
function planFor({ statuses = {}, outcomes = {}, frozen = null, previous = null, prof = profile } = {}) {
  const pool = buildPool({ routes: [ab], profile: prof, statuses, outcomes, cityName: "Austin" });
  const windows = windowsFor(prof);
  const p = planDays({ pool: pool.rows, statuses: pool.statuses, windows, visitMin: prof.visitMin, pinned: pool.pinned, frozen, previous });
  return { ...p, venues: pool.venues, pool: { ids: pool.ids, N: pool.N, label: pool.label, drinker: pool.drinker }, statuses: pool.statuses, outcomes, profile: prof, city: { key: "austin", name: "Austin" }, windows };
}
const plan0 = planFor();
const first = plan0.days[0].stops[0];
const model = (plan, id, day) => stopModel({ plan, id, dayIndex: day, city: AUSTIN, facts: FACTS, routes: [ab] });
const PLACEHOLDER = /undefined|null|NaN|\[object|\{|\}|<|>|\bTODO\b|\bXXX\b|your name|brand name/i;

// ---------- drafted note ----------
test("drafted note: a first message asks for a time and a taste: brand, first name, what you make, the arrival said humanly; no crowd line, no product ask", () => {
  const m = model(plan0, first.id, 0);
  const n = m.note;
  assert.match(n.body, /^Hi,\n\nI'm Maya with Tidewell, a non-alcoholic hazy IPA, and I'm out meeting bars around Austin\./);
  assert.match(n.body, /I'll be over your way Tuesday (around|a little after|a little before) \d+(:30)?\. Could I stop in and pour whoever runs the taproom a cold one\?/, "the arrival on this route, as a person says it");
  assert.doesNotMatch(n.subject + n.body, /\d:(?!30)\d\d|~|\bpm\b/, "no minutes, no '~', no 'pm' in a message (Jard 10-24 #5)");
  assert.equal(n.subject, "Tidewell, a non-alcoholic hazy IPA");
  assert.doesNotMatch(n.body, /one case of cans|What I'd ask for|small ask/i, "no product ask in a first message (OPENERS-RESEARCH §3)");
  assert.doesNotMatch(n.body, /Looks like|your regulars|crowd/i, "no crowd line: nobody tells a bar who its regulars are");
  assert.doesNotMatch(n.subject + n.body, /Qloo|#\d/, "no rank and no Qloo in a note to a bar manager (R2 Calacanis 11)");
  assert.match(n.body, /no hard feelings if it's not a fit\./);
  assert.match(n.body, /Thanks,\nMaya$/);
  // the angle's email line (talk.angle.mail) is its own paragraph, the same words the talking points use
  if (m.talk.angle?.mail) assert.ok(n.lines.includes(m.talk.angle.mail), "the angle line");
  for (const s of [n.subject, n.body]) {
    assert.doesNotMatch(s, PLACEHOLDER, s);
    assert.doesNotMatch(s, BANNED_PITCH, s);
  }
  assert.equal(n.by, "template");
  assert.ok(noteLabel(n).length > 20);
  // the text: the same, short
  const sms = noteFor(n, "sms");
  assert.match(sms, /^Hi, it's Maya from Tidewell, a non-alcoholic hazy IPA\. I'll be over your way Tuesday .+ 10 minutes, tops\. – Maya$/);
  assert.doesNotMatch(sms, /one case|Small ask/);
});

test("drafted note: no name, no brand, no time → the sentence changes, nothing is a placeholder", () => {
  const v = plan0.venues[first.id];
  const a = draftNote({ venue: v, profile: { brand: "Tidewell", what: "", pitch: {} }, cityName: "Austin", ask: "one keg" });
  assert.match(a.body, /I'm with Tidewell, and I'm out meeting bars around Austin\./);
  assert.match(a.body, /I'm around one afternoon soon\. Could I stop in and pour whoever buys for the bar a cold one\?/);
  assert.equal(a.subject, "Tidewell");
  const b = draftNote({ venue: v, profile: { brand: "", what: "Reposado tequila" }, cityName: "Austin", day: "wednesday", eta: 13 * 60 + 5, ask: "one bottle for the back bar" });
  assert.match(b.body, /I'm with a new reposado tequila brand/);
  assert.match(b.body, /Wednesday around 1\./);
  assert.match(b.body, /pour whoever buys for the bar a taste\?/, "a spirit is a taste, not a cold one (kind from What you make)");
  assert.equal(b.subject, "A new reposado tequila");
  for (const n of [a, b]) assert.doesNotMatch(n.subject + n.body, PLACEHOLDER);
  // the rep's ask is for the conversation after the taste: never in a first message, whatever it says
  const c = draftNote({ venue: v, profile: { brand: "Tidewell", what: "hazy IPA" }, ask: "whatever pours best" });
  assert.doesNotMatch(c.body, /whatever pours best/);
  assert.doesNotMatch(c.body, BANNED_PITCH);
});

test("humanTime: an ETA the way a person says it; never minutes", () => {
  const cases = [[13 * 60, "around 1"], [13 * 60 + 5, "around 1"], [13 * 60 + 14, "a little after 1"], [13 * 60 + 22, "a little after 1"], [13 * 60 + 30, "around 1:30"], [13 * 60 + 41, "a little before 2"], [13 * 60 + 55, "around 2"], [11 * 60 + 50, "a little before noon"], [12 * 60 + 3, "around noon"], [12 * 60 + 33, "around 12:30"]];
  for (const [m, want] of cases) assert.equal(humanTime(m), want, String(m));
  assert.equal(humanTime(13 * 60 + 14, { ampm: true }), "a little after 1 pm");
  assert.equal(humanTime(10 * 60 + 30, { ampm: true }), "around 10:30 am");
  assert.equal(humanTime(11 * 60 + 50, { ampm: true }), "a little before noon");
  for (let m = 9 * 60; m < 22 * 60; m++) assert.match(humanTime(m), /^(around|a little after|a little before) (\d{1,2}(:30)?|noon)$/, String(m));
});

test("drafted note: return visit asks for the case only after the rep logged interested; otherwise a taste for the team", () => {
  const v = plan0.venues[first.id];
  const base = { venue: v, profile: { brand: "Tidewell", what: "Non-alcoholic hazy IPA", pitch: { name: "Maya" } }, cityName: "Austin", ask: "one case of cans in the cooler" };
  const mem = (result) => ({ visit: "return", contact: { name: "Jess", role: "bar manager" }, lastVisit: "2026-10-13", followUp: "2026-10-15", followUpTime: "14:00", result });
  const yes = draftNote({ ...base, memory: mem("interested") });
  assert.match(yes.body, /^Hi Jess, it's Maya from Tidewell again: thanks for your time on Tuesday\./);
  assert.match(yes.body, /I'll be by Thursday around 2, if that still works\./);
  assert.match(yes.body, /Want to start with one case of cans in the cooler\?/);
  assert.match(noteFor(yes, "sms"), /Still OK if I stop by Thursday around 2\? Want to start with one case of cans in the cooler\? – Maya$/);
  const maybe = draftNote({ ...base, memory: mem("followup") });
  assert.doesNotMatch(maybe.body + noteFor(maybe, "sms"), /one case|start with/);
  assert.match(maybe.body, /I'll bring a couple of cold ones for you and the team\./);
});

test("links: tel, mailto, sms and directions (Apple on Apple devices, Google elsewhere)", () => {
  assert.equal(telHref("+15125879669"), "tel:+15125879669");
  assert.equal(telHref(""), null);
  const n = { subject: "Hi & bye", body: "Line one\n\nLine two" };
  assert.equal(mailtoHref(n), "mailto:?subject=Hi%20%26%20bye&body=Line%20one%0A%0ALine%20two");
  assert.equal(smsHref(n, "(512) 587-9669"), "sms:5125879669?&body=Line%20one%0A%0ALine%20two");
  const a = { lat: 30.25, lon: -97.72 }, b = { lat: 30.26, lon: -97.73 };
  assert.match(directionsUrl(a, b, "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)"), /^https:\/\/maps\.apple\.com\/\?saddr=30\.250000,-97\.720000&daddr=30\.260000,-97\.730000&dirflg=d$/);
  assert.match(directionsUrl(a, b, "Mozilla/5.0 (Linux; Android 15)"), /^https:\/\/www\.google\.com\/maps\/dir\/\?api=1&origin=30\.250000,-97\.720000&destination=30\.260000,-97\.730000&travelmode=driving$/);
  assert.doesNotMatch(directionsUrl(null, b, ""), /origin/);
});

// ---------- outcomes → follow-up through the planner ----------
test("outcome form: results, follow-up date required for Follow up, tags for the list and the pin", () => {
  assert.ok(makeOutcome({}).error);
  assert.ok(makeOutcome({ result: "followup" }).error);
  assert.deepEqual(makeOutcome({ result: "interested", followUp: THU, note: "  ask for Sam " }), { result: "interested", followUp: THU, note: "ask for Sam" });
  assert.deepEqual(makeOutcome({ result: "someone", who: "the GM, Jo" }), { result: "someone", who: "the GM, Jo" });
  assert.equal(shortDate(THU), "Thu Oct 15");
  assert.equal(outcomeText({ result: "interested", followUp: THU }), "✓ Interested · ↻ Follow up Thu Oct 15");
  assert.deepEqual(outcomeTags({ result: "followup", followUp: THU }).map((t) => t.text), ["↻ Follow up Thu Oct 15"]);
  assert.deepEqual(outcomeTags({ result: "no" }).map((t) => t.text), ["Not interested"]);
  assert.equal(defaultFollowUp(windowsFor(profile), TUE), WED, "the next window");
  assert.equal(defaultFollowUp(windowsFor(profile), THU), "2026-10-16", "no window left: the next weekday");
  assert.equal(defaultFollowUp([], "2026-10-16"), "2026-10-19", "skips the weekend");
});

test("visited + follow up Thursday: Tuesday keeps the visit, Thursday gains the return visit as a pinned stop", () => {
  const statuses = { [first.id]: "visited" };
  const outcomes = { [first.id]: { result: "interested", followUp: THU } };
  const frozen = { date: TUE, from: plan0.days[0].from, ids: plan0.days[0].stops.map((s) => s.id) };
  const p = planFor({ statuses, outcomes, frozen, previous: plan0 });
  assert.ok(p.days[0].stops.some((s) => s.id === first.id), "Tuesday keeps the visited stop in order");
  const thu = p.days[2];
  const s = thu.stops.find((x) => x.id === first.id);
  assert.ok(s, "the follow-up is on Thursday");
  assert.equal(s.pinned, "followup");
  assert.ok(!p.days[1].stops.some((x) => x.id === first.id), "not on Wednesday");
  const at = followUpPlace(p, first.id, THU);
  assert.equal(at.dayIndex, 2);
  // the planner says so, for the Week view (R1 Calacanis 4)
  assert.ok(p.notes.some((n) => n.kind === "followup" && n.id === first.id && n.to === THU && /^Follow-up visit on Thu Oct 15\.$/.test(n.text)), JSON.stringify(p.notes));
  assert.match(at.text, /^Follow-up on Thu Oct 15, stop \d+\.$/);
  // the stop on Thursday reads as a return visit, not a done one
  assert.equal(model(p, first.id, 2).returnVisit, true);
  assert.equal(model(p, first.id, 0).returnVisit, false);
});

test("a follow-up on a day with no window lands on the next window, with the planner's note", () => {
  const prof = { ...profile, windows: [profile.windows[0], { date: "2026-10-16", from: "14:00", to: "18:00" }] };
  const p0 = planFor({ prof });
  const id = p0.days[0].stops[0].id;
  const p = planFor({ prof, statuses: { [id]: "visited" }, outcomes: { [id]: { result: "followup", followUp: THU } }, frozen: { date: TUE, from: p0.days[0].from, ids: p0.days[0].stops.map((s) => s.id) }, previous: p0 });
  const at = followUpPlace(p, id, THU);
  assert.equal(p.days[at.dayIndex].date, "2026-10-16");
  assert.match(at.text, /^Follow-up on Fri Oct 16, stop \d+\. Follow-up moved from Thu Oct 15 to Fri Oct 16: /);
  assert.doesNotMatch(at.text, /\d{4}-\d{2}/, "no ISO date a person reads");
  // and with no window at all after it: saved, not on a day, said plainly
  const none = followUpPlace({ days: [], notes: [] }, id, "2026-10-20");
  assert.equal(none.dayIndex, -1);
  assert.match(none.text, /isn't on a day yet/);
});

// ---------- export ----------
test("export: drafted notes as text and a printable call sheet, one block per stop with sourced facts", () => {
  const stops = plan0.days.flatMap((d, i) => d.stops.map((s) => model({ ...plan0, outcomes: { [first.id]: { result: "interested", followUp: THU, note: "ask for <Sam>" } } }, s.id, i)));
  const txt = notesText(stops, { brand: "Tidewell", city: "Austin" });
  for (const m of stops) {
    assert.ok(txt.includes(m.note.subject), m.venue.name);
    assert.ok(txt.includes(`=== ${m.venue.name} (`));
  }
  assert.match(txt, /Tue Oct 13 · stop 1 of \d+ · arrive 2:\d\d pm/i);
  assert.match(txt, /nothing is sent from Doors/);
  const html = callSheetHTML(stops, { brand: "Tidewell", city: "Austin", label: plan0.pool.label, captured: "2026-10-08" });
  assert.equal((html.match(/<section class="cs-stop">/g) ?? []).length, stops.length);
  assert.equal((html.match(/<span class="cs-box"><\/span>/g) ?? []).length, stops.length * 3, "three tick-box questions per stop");
  // G2: every character is in Inter's latin subset (Google Fonts' unicode-range), so no line waits on a late font file
  const latin = (c) => c <= 0xff || [0x131, 0x152, 0x153, 0x2bb, 0x2bc, 0x2c6, 0x2da, 0x2dc, 0x304, 0x308, 0x329, 0x20ac, 0x2122, 0x2191, 0x2193, 0x2212, 0x2215, 0xfeff, 0xfffd].includes(c) || (c >= 0x2000 && c <= 0x206f);
  const outside = [...new Set([...html].filter((ch) => !latin(ch.codePointAt(0))))];
  assert.deepEqual(outside, [], `outside the latin subset: ${outside.join(" ")}`);
  assert.match(html, /Qloo doesn't know what they stock: ask/);
  assert.match(html, /Outcome: Interested · follow up Thu Oct 15 · ask for &lt;Sam&gt;/, "escaped; the follow-up date reads like the rest of the sheet (G2)");
  assert.match(html, /<sup>\[1\]<\/sup>/);
  assert.match(html, /<footer><h3>Sources<\/h3><ol><li>[^<]+: https:\/\//);
  assert.doesNotMatch(html, /undefined|NaN/);
  // CSV: outcome in words, who in the note
  const csv = planCSV({ plan: plan0, venues: plan0.venues, pool: plan0.pool, statuses: { [first.id]: "visited" }, outcomes: { [first.id]: { result: "someone", who: "Jo", note: "back Thu" } } });
  assert.match(csv, /Visited,Talked to someone else,talked to Jo; back Thu,/);
});

// ---------- talking points: model lines vs the template ----------
const venueWith = Object.values(ab.venues).find((v) => v.crowd && v.ambience && v.goodFor?.length && !/\d/.test(v.crowd));
const NO_TALK = { ...AUSTIN, talk: undefined };
const tplFor = (v) => stopModel({ plan: { ...plan0, venues: { ...plan0.venues, [v.id]: v } }, id: v.id, dayIndex: null, city: NO_TALK, facts: FACTS, routes: [ab] }).talk;

test("talk lines: no stored lines → the template, labelled template", () => {
  const t = tplFor(venueWith);
  assert.equal(t.by, "template");
  assert.equal(t.lines.opener, "template");
  assert.match(talkLabel(t), /^Template/);
});

test("talk lines: a stored model lead is never shown (Jard 10-24 #5: nobody describes a room's crowd to its staff)", () => {
  const base = tplFor(venueWith);
  const stored = { model: "gemini-3.1-flash-lite", lead: { text: "Looks like you get neighbourhood people and young professionals in here", source: "customer_demographics_description" } };
  const t = withModelTalk({ ...base, by: "template" }, stored, { venue: venueWith });
  assert.equal(t.by, "template");
  assert.deepEqual(t.lines, { opener: "template" });
  assert.equal(t.opener, base.opener);
  assert.doesNotMatch(t.opener, /Looks like|regulars/);
  assert.equal(t.points.length, base.points.length);
  assert.match(talkLabel(t), /^Template/);
  assert.equal(openerQuestion("Looks like x. When one of your regulars isn't drinking, what do they order?"), "When one of them isn't drinking, what do they order?");
});

test("talk lines: the guard rejects a bad model lead and the template stands", () => {
  const v = venueWith;
  const ok = (text, source = "customer_demographics_description", avoid = []) => guardTalkLine(text, { venue: v, source, avoid });
  assert.equal(ok("Looks like your regulars are locals and young professionals.").ok, true);
  assert.equal(ok("Looks like this is the trending spot for locals.").reason, "banned word");
  assert.equal(ok("Looks like the bar pours craft beer for locals.").reason, "banned word");
  assert.equal(ok("Looks like your regulars are locals and young professionals!").reason, "not a plain statement");
  assert.equal(ok(`Looks like ${"very ".repeat(20)}busy.`).reason, "too long");
  assert.equal(ok("Your listing says the regulars are locals and young professionals.").reason, "not spoken (starts 'Looks like')");
  assert.equal(ok("Looks like your Qloo listing says locals come here.").reason, "claims a source");
  assert.equal(ok("Looks like students, families, tourists and locals come in.").reason, "a list, not a sentence");
  assert.equal(ok("Looks like 87 regulars come in every night.").reason, "a number not in the profile");
  assert.equal(ok("Looks like Kacey Musgraves fans come in here.", undefined, ["Kacey Musgraves"]).reason, "names an artist or brand");
  assert.equal(ok("Looks like our drinkers already come here.").reason, "speaks for the brand");
  assert.equal(guardTalkLine("Looks like the locals love this room.", { venue: { ...v, crowd: null }, source: "customer_demographics_description" }).reason, "source field not on the record");
  assert.equal(ok("Looks like the room is calm and warm.", "ambience_description").reason, "the opener comes from the crowd field");
  assert.equal(ok("Looks like locals come here.", "menu_items").reason, "unknown source field");
  const base = tplFor(v);
  const t = withModelTalk(base, { model: "m", lead: { text: "Looks like this is the trending spot!", source: "customer_demographics_description" } }, { venue: v });
  assert.equal(t.by, "template");
  assert.equal(t.opener, base.opener);
});

test("stop model: rank line from the pool label, talking points without artist names, facts with source urls", () => {
  const m = model(plan0, first.id, 0);
  assert.match(m.rankLine, /^#\d+ of \d+ on Your list of Austin bars and breweries for people who drink Athletic Brewing$/);
  assert.equal(m.talk.before.find((x) => /^Why you're here/.test(x)), `Why you're here: Qloo ranks this door ${m.rankLine.replace(" on Your list of", "")}.`);
  assert.equal(m.n, 1);
  assert.equal(m.leg.from, plan0.days[0].start);
  const artists = cityArtists(AUSTIN);
  assert.ok(artists.length > 50);
  const all = [m.talk.opener, ...m.talk.before, ...m.talk.questions, ...m.talk.points.map((p) => p.text), m.note.body];
  for (const a of artists) for (const s of all) assert.ok(!s.includes(a), `${a} in "${s}"`);
  assert.ok(m.talk.factRefs.every((f) => /^https:\/\//.test(f.url)));
  assert.equal(streetOf("1900 Simond Ave #200 Austin, TX 78702", "Austin"), "1900 Simond Ave #200");
  // the Qloo record: affinity to three decimals comes from the drinker's own list
  assert.equal(typeof m.record.affinity.affinity, "number");
  assert.equal(m.record.affinity.drinker, "Athletic Brewing");
});

test("talk lines: every line stored in the shipped city files passes the guard again, and a stored venue shows it", () => {
  let n = 0;
  for (const key of ["austin", "boise", "chicago", "omaha"]) {
    const c = city(key);
    const venues = Object.assign({}, ...["athletic-brewing", "casamigos", "white-claw", "parsons"].map((d) => route(`${d}-${key}`).venues));
    for (const [id, e] of Object.entries(c.talk?.venues ?? {})) {
      const v = venues[id];
      if (!v) continue;
      assert.ok(!e.point, "no model points are shipped");
      const g = guardTalkLine(e.lead.text, { venue: v, source: e.lead.source, avoid: cityArtists(c) });
      assert.ok(g.ok, `${key} ${v.name}: ${g.reason}: ${e.lead.text}`);
      n++;
    }
  }
  assert.ok(n > 300, `${n} leads checked`);
  const withLines = first.id in (AUSTIN.talk?.venues ?? {}) ? model(plan0, first.id, 0).talk : null;
  if (withLines) assert.equal(withLines.by, "model");
});

// ---------- R1: the talk.js call site (Diolosa D11, D7) ----------
test("D11: the stop passes talk.js the bare drinker, the Rooms filter and the city's artists", () => {
  const m = model(plan0, first.id, 0);
  assert.equal(m.drinkerName, "Athletic Brewing");
  assert.equal(m.filterLabel, "bars and breweries");
  assert.equal(m.talk.before.find((x) => /^Why you're here/.test(x)), `Why you're here: Qloo ranks this door #${m.rank} of ${m.N} Austin bars and breweries for people who drink Athletic Brewing.`);
  assert.doesNotMatch(m.talk.before.find((x) => /^Why you're here/.test(x)), /drinkers drinkers/);
  // an artist named in the crowd text never reaches the opener (avoid = the city's artists)
  const a = cityArtists(AUSTIN)[0];
  const v = { ...plan0.venues[first.id], crowd: `The crowd consists of fans of ${a} and students.` };
  const m2 = stopModel({ plan: { ...plan0, venues: { ...plan0.venues, [first.id]: v } }, id: first.id, dayIndex: 0, city: NO_TALK, facts: FACTS, routes: [ab] });
  assert.ok(!m2.talk.opener.includes(a));
  // drinks-like NA flag reaches the pushback (Athletic Brewing is NA, like Tidewell)
  assert.match(m.talk.pushback[0].reply, /already buy non-alcoholic drinks/);
});

test("D7: two drinker brands → 'on Your list' (Jard 10-24, was 'Doors' merged list') in the rank line, talking points and note; never 'Qloo ranks'", () => {
  const ld = route("liquid-death-austin");
  const prof = { ...profile, drinks: [...profile.drinks, { key: "liquid-death", name: "Liquid Death", ready: true }] };
  const pool = buildPool({ routes: [ab, ld], profile: prof, cityName: "Austin" });
  const p = planDays({ pool: pool.rows, statuses: pool.statuses, windows: windowsFor(prof), visitMin: 25, pinned: pool.pinned });
  const plan = { ...p, venues: pool.venues, pool: { ids: pool.ids, N: pool.N, label: pool.label, drinker: pool.drinker }, statuses: {}, outcomes: {}, profile: prof, city: { key: "austin", name: "Austin" } };
  const m = stopModel({ plan, id: p.days[0].stops[0].id, dayIndex: 0, city: AUSTIN, facts: FACTS, routes: [ab, ld] });
  assert.match(m.rankLine, /^#\d+ of \d+ on Your list of Austin bars and breweries for Athletic Brewing and Liquid Death drinkers$/);
  assert.match(m.talk.before.find((x) => /^Why you're here/.test(x)), /^Why you're here: This door is #\d+ of \d+ on Your list of /);
  for (const s of [...m.talk.before, ...m.talk.points.map((x) => x.text), m.note.body]) assert.doesNotMatch(s, /Qloo ranks|On Qloo's taste data/);
});

test("Calacanis 4 + ease #8: two taps: the glossary's four outcomes, one name each, every one a complete outcome", () => {
  const q = quickChoices(THU);
  assert.deepEqual(q.map((x) => x.label), ["Interested", "Follow up", "Talked to someone else", "Not interested"]);
  for (const x of q) assert.ok(!makeOutcome(x.o).error, x.key);
  assert.equal(outcomeText(makeOutcome(q[1].o)), "↻ Follow up Thu Oct 15", "the follow-up carries the default date");
  assert.equal(followUpLine(THU), "Follow up Thu Oct 15");
  assert.deepEqual(q.map((x) => x.text ?? x.label), ["Interested", "Follow up Thu Oct 15", "Talked to someone else", "Not interested"], "audit 2 #4: the date is on Follow up's own button, nowhere else");
});

test("ease: a visit logged on a previewed day is stamped on that day at the stop's time, not today's clock", () => {
  const now = new Date(2026, 9, 23, 21, 59, 5);
  assert.equal(visitStamp("2026-10-23", 14 * 60, now), "2026-10-23T21:59:05", "today: now");
  assert.equal(visitStamp("2026-10-27", 13 * 60 + 59, now), "2026-10-27T13:59:00", "a preview: its own day and slot");
  assert.equal(visitStamp("2026-10-27", null, now), "2026-10-27T21:59:00", "no slot: that day, now's clock");
  assert.equal(visitStamp(null, 600, now), "2026-10-23T21:59:05", "no day: now");
});

// ---------- R2 Diolosa (slice F5) ----------
import { QUANTIFIER, sourceQuantifies, normalizeLead } from "../public/lib/talk-model.js";
import { DANGLING, crowdPhrase as crowdOf, talkPoints as talkOf, arrivalAdvice as adviceOf } from "../public/lib/talk.js";
import { weekCount, carryText } from "../public/lib/planview.js";
import { readdirSync, readFileSync } from "node:fs";
import { ROOT } from "./helpers.mjs";
const ALL_VENUES = Object.assign({}, ...readdirSync(`${ROOT}/public/data/routes`).map((f) => readJson(`public/data/routes/${f}`).venues));

test("M3: no stored lead adds a quantifier Qloo's crowd text lacks; the fix is deterministic; the demo's Pinthouse has no 'mostly'", () => {
  let n = 0;
  for (const key of ["austin", "boise", "chicago", "omaha"]) {
    for (const [id, e] of Object.entries(city(key).talk.venues)) {
      n++;
      if (QUANTIFIER.test(e.lead.text)) assert.ok(sourceQuantifies(ALL_VENUES[id]), `${ALL_VENUES[id]?.name}: ${e.lead.text}`);
    }
  }
  assert.ok(n > 400);
  const broad = { crowd: "The restaurant serves a broad demographic, attracting local residents and families." };
  assert.equal(normalizeLead("Looks like your regulars are mostly local residents and families.", broad), "Looks like your regulars are local residents and families.");
  assert.equal(normalizeLead("Looks like you get a lot of locals in here.", broad), "Looks like you get locals in here.");
  assert.equal(guardTalkLine("Looks like your regulars are mostly students and young professionals.", { venue: broad, source: "customer_demographics_description" }).reason, "a quantifier the profile doesn't use");
  const prim = { crowd: "The clientele consists primarily of local residents." };
  assert.equal(normalizeLead("Looks like your regulars are mostly local residents.", prim), "Looks like your regulars are mostly local residents.");
  const pint = Object.entries(city("austin").talk.venues).filter(([id]) => /pinthouse/i.test(ALL_VENUES[id]?.name ?? ""));
  for (const [, e] of pint) assert.doesNotMatch(e.lead.text, /mostly|a lot of/);
});

test("M4: The Qloo record has no Room sound row", () => {
  assert.doesNotMatch(readFileSync(`${ROOT}/public/ui/stop.js`, "utf8"), /Room sound/);
  assert.equal(model(plan0, first.id, 0).record.sound, undefined);
});

test("L1, L2: the Week head counts return visits apart; carried doors are 'back in the pool'", () => {
  const d = (ids) => ({ stops: ids.map((id) => ({ id })) });
  assert.equal(weekCount([d(["a", "b"]), d(["c"]), d(["a", "e"])]), "4 doors over 3 days, plus 1 return visit");
  assert.equal(weekCount([d(["a"]), d(["b"])]), "2 doors over 2 days");
  assert.equal(carryText("2 doors carried over from Tuesday", "A, B"), "2 doors carried over from Tuesday: A, B. They're back on Your list for your next days.");
  assert.equal(carryText("1 door carried over from Tuesday", "A"), "1 door carried over from Tuesday: A. It's back on Your list for your next days.");
  assert.doesNotMatch(readFileSync(`${ROOT}/public/ui/plan.js`, "utf8"), /no door twice|first in line/);
});

test("L4: a venue name with 'pour' or 'stock' keeps the greeting, intro and arrival; the subject keeps the brand", () => {
  for (const name of ["Pour Choices", "Lock Stock & Barrel", "Dunning Pour House", "Stocks & Blondes"]) {
    const n = draftNote({ venue: { name }, profile, cityName: "Chicago", day: "tuesday", eta: 900, ask: "one case" });
    assert.ok(n.body.startsWith("Hi,\n\nI'm Maya with Tidewell"), n.body);
    assert.match(n.body, /Tuesday around 3\./);
    assert.match(n.subject, /^Tidewell/);
  }
  // the rep's ask (whatever it says) is never in a first message
  assert.doesNotMatch(draftNote({ venue: { name: "Pour House" }, profile, ask: "whatever pours best" }).body, /whatever pours best/);
});

test("L5: no crowd phrase in any city ends mid-thought or joins a dangling 'ranging/including/such as' fragment", () => {
  let n = 0;
  for (const v of Object.values(ALL_VENUES)) {
    const c = crowdOf(v);
    if (!c) continue;
    n++;
    assert.doesNotMatch(c.text, DANGLING, `${v.name}: ${c.text}`);
    assert.doesNotMatch(c.text, /and ranging from|and including|ranging from (?!.*\bto\b)/, `${v.name}: ${c.text}`);
  }
  assert.ok(n > 1000, `${n}`);
});

test("L6: waits: the stop and the call sheet say 'Arrive 2:46 pm · opens 3 pm, wait ~14 min'; CSV arrive + wait; timing knows", () => {
  const stop = { id: first.id, eta: 15 * 60, depart: 15 * 60 + 25, waitMin: 14, legMi: 1, legMin: 5, source: "estimate", hoursVerified: true, openAtArrival: true };
  const p = { ...plan0, days: [{ ...plan0.days[0], stops: [stop] }, ...plan0.days.slice(1)] };
  const m = model(p, first.id, 0);
  assert.equal(m.arriveText, "Arrive 2:46 pm · opens 3 pm, wait ~14 min");
  assert.equal(m.wait, 14);
  assert.match(m.talk.before[1], /^You'll get there about 14 min before they open at 3 pm/);
  assert.match(callSheetHTML([m]), /arrive 2:46 pm · opens 3 pm, wait ~14 min/);
  assert.match(callSheetHTML([m]), /Arrive 2:46 pm · opens 3 pm, wait ~14 min/);
  const csv = planCSV({ plan: p, venues: p.venues, pool: p.pool });
  const [head, row] = csv.split("\r\n");
  const cols = head.split(",");
  const cell = (k) => row.split(",")[cols.indexOf(k)];
  assert.equal(cell("arrive"), "2:46 pm");
  assert.equal(cell("wait_min"), "14");
  assert.equal(cell("leave"), "3:25 pm");
  assert.equal(adviceOf(15 * 60, null, null, 0).kind, "lull");
  // the planner's own days: arrive = previous leave + leg, and arrive + wait = the visit start
  for (const d of plan0.days) d.stops.forEach((s, k) => {
    const prevLeave = k ? d.stops[k - 1].depart : d.leave ?? d.from; // judge pass 4 #11: a day may leave later
    assert.equal(s.eta - (s.waitMin ?? 0), prevLeave + s.legMin, `${d.day} stop ${k + 1}`);
  });
});

test("L7: NA facts rotate over every usable one: none in more than 60% of NA outputs (beer and non-beer)", () => {
  const ids = ab.lists.all.map(([id]) => id).slice(0, 100);
  for (const what of ["Non-alcoholic hazy IPA", "Non-alcoholic sparkling botanical"]) {
    const count = {};
    ids.forEach((id, k) => {
      const t = talkOf({ venue: ab.venues[id], rank: k + 1, N: 100, drinkerName: "Athletic Brewing", city: "Austin", profile: { brand: "T", what }, isNA: true }, FACTS);
      for (const f of t.facts) count[f] = (count[f] ?? 0) + 1;
    });
    for (const [f, c] of Object.entries(count)) assert.ok(c / ids.length <= 0.6, `${what}: ${f} ${c}%`);
    assert.ok(Object.keys(count).length >= 3, JSON.stringify(count));
  }
});

test("L8: CSV phones are written as (512) 555-0100, never a formula-guarded '+…", () => {
  const csv = planCSV({ plan: plan0, venues: plan0.venues, pool: plan0.pool });
  assert.doesNotMatch(csv, /'\+/);
  assert.match(csv, /\(\d{3}\) \d{3}-\d{4}/);
});

test("Calacanis 12: generic crowd text ('local residents and families', 'a broad demographic') never makes an opener; Pinthouse gets the template question", async () => {
  const { genericCrowd } = await import("../public/lib/talk.js");
  for (const t of ["Looks like your regulars are local residents and families.", "you draw a broad demographic", "you draw a diverse mix of locals and tourists", "your regulars are local residents, families, and young adults"]) assert.ok(genericCrowd(t), t);
  for (const t of ["Looks like you get craft beer enthusiasts and young professionals in here.", "your regulars are students and young professionals", "Looks like you get hotel guests and business travelers in here."]) assert.ok(!genericCrowd(t), t);
  assert.equal(guardTalkLine("Looks like your regulars are local residents and families.", { venue: venueWith, source: "customer_demographics_description" }).reason, "generic: could be any room");
  for (const key of ["austin", "boise", "chicago", "omaha"]) for (const e of Object.values(city(key).talk.venues)) assert.ok(!genericCrowd(e.lead.text), e.lead.text);
  const [pid, pv] = Object.entries(ALL_VENUES).find(([, v]) => /^Pinthouse/i.test(v.name));
  const t = stopModel({ plan: { ...plan0, venues: { ...plan0.venues, [pid]: pv } }, id: pid, dayIndex: null, city: AUSTIN, facts: FACTS, routes: [ab] }).talk;
  assert.doesNotMatch(t.opener, /^Looks like/, t.opener);
});

test("Calacanis 13: the follow-up toast names the re-plan's cost when the planner reports it (feature-detected)", () => {
  const statuses = { [first.id]: "visited" };
  const outcomes = { [first.id]: { result: "interested", followUp: THU } };
  const p = planFor({ statuses, outcomes, frozen: { date: TUE, from: plan0.days[0].from, ids: plan0.days[0].stops.map((s) => s.id) }, previous: plan0 });
  assert.match(followUpToast({ ...p, replanCost: null }, first.id, THU), /^Follow-up on Thu Oct 15, stop \d+\.$/, "no replanCost: the place only");
  // the planner reports the re-plan's cost (F4): the toast starts with the place and says the rest
  assert.ok(p.replanCost && Number.isFinite(p.replanCost.addedMi));
  assert.match(followUpToast(p, first.id, THU), /^Follow-up on Thu Oct 15, stop \d+/);
  const other = plan0.days[1].stops[0].id;
  const t = followUpToast({ ...p, source: "estimate", replanCost: { addedMi: 4.12, droppedIds: [other], movedIds: [] } }, first.id, THU);
  // ease audit 3 #10c: where it went, never just "off the day"
  const on = p.days.find((d) => d.stops.some((s) => s.id === other));
  assert.equal(t, `Follow-up on Thu Oct 15, stop ${followUpPlace(p, first.id, THU).n} · +4.1 mi, estimated · ${p.venues[other].name} ${on ? `moved to ${on.day[0].toUpperCase()}${on.day.slice(1)}` : "back on Your list"}`);
  const gone = p.pool.ids.find((x) => p.venues[x]?.name && !p.days.some((d) => d.stops.some((s) => s.id === x)));
  if (gone) assert.match(followUpToast({ ...p, source: "estimate", replanCost: { addedMi: 0, droppedIds: [gone], movedIds: [] } }, first.id, THU), new RegExp(` · ${p.venues[gone].name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} back on Your list$`));
  assert.match(followUpToast({ ...p, source: "ors", replanCost: { addedMi: 1, droppedIds: [], movedIds: [] } }, first.id, THU), / · \+1\.0 road mi$/);
});

test("F4: stop 1 of a day that leaves later carries when to leave (the stop panel shows 'leave 3:40 pm')", () => {
  const p = { ...plan0, days: plan0.days.map((d, i) => (i === 0 ? { ...d, leave: d.from + 40 } : d)) };
  const m1 = stopModel({ plan: p, id: p.days[0].stops[0].id, dayIndex: 0, city: AUSTIN, facts: FACTS, routes: [ab] });
  assert.equal(m1.leave, plan0.days[0].from + 40);
  const m2 = stopModel({ plan: p, id: p.days[0].stops[1].id, dayIndex: 0, city: AUSTIN, facts: FACTS, routes: [ab] });
  assert.equal(m2.leave, null);
  const m0 = stopModel({ plan: plan0, id: plan0.days[0].stops[0].id, dayIndex: 0, city: AUSTIN, facts: FACTS, routes: [ab] });
  assert.equal(m0.leave, null, "a day leaving on time says nothing");
});

// N3: the note may name the rep's own rooms that already pour them (their data, not Qloo's), grouped by city
test("the note names the rooms that already pour you: 'You can find us at … already.'", async () => {
  const { draftNote, poursText } = await import("../public/lib/note.js");
  const pours = [{ name: "Parson's Chicken & Fish", where: "Logan Square, Chicago" }, { name: "Kite String", where: "North Center, Chicago" }, { name: "Yellow Jacket Social Club", where: "East Austin, Austin" }];
  assert.equal(poursText(pours, "Austin"), "Parson's Chicken & Fish and Kite String in Chicago and Yellow Jacket Social Club");
  assert.equal(poursText([], "Austin"), "");
  const n = draftNote({ venue: { name: "Sazon" }, profile: { brand: "Hollow Oak", what: "Sparkling water", pitch: { name: "Ben" }, pours: pours.slice(0, 1) }, cityName: "Austin" });
  assert.ok(n.lines.includes("You can find us at Parson's Chicken & Fish in Chicago already."), n.body);
  assert.doesNotMatch(n.body, /your regulars/);
  for (const l of n.lines) assert.ok(!BANNED_PITCH.test(l), l);
  assert.ok(!draftNote({ venue: { name: "Sazon" }, profile: { brand: "Hollow Oak" }, cityName: "Austin" }).body.includes("You can find us at"));
});
