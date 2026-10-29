// Export v2: CSV columns (status + outcome always present), day order, quoting, doors not scheduled.
import { test } from "node:test";
import assert from "node:assert/strict";
import { planCSV, CSV_COLUMNS, guardCell, csvFooter, callSheetHTML, callSheetText } from "../public/lib/export.js";
import { parseHours } from "../public/lib/core.js";
import { buildPool, windowsFor } from "../public/lib/pool.js";
import { planDays } from "../public/lib/schedule.js";
import { route } from "./helpers.mjs";

const ab = route("athletic-brewing-austin");
const profile = {
  drinks: [{ key: "athletic-brewing", name: "Athletic Brewing", ready: true }],
  rooms: ["bars", "breweries"],
  start: { lat: 30.2556, lon: -97.7208 },
  windows: [{ date: "2026-10-13", from: "14:00", to: "16:00" }, { date: "2026-10-14", from: "13:00", to: "18:00" }],
  visitMin: 25,
};
const contact = { id: "contact:1", name: 'Barb\'s "Back Room", East', lat: 30.262, lon: -97.722, source: "manual", address: "1 Main St, Austin" };
const pool = buildPool({ routes: [ab], profile, contacts: [contact] });
const plan0 = planDays({ pool: pool.rows, statuses: {}, windows: windowsFor(profile), visitMin: 25, pinned: pool.pinned });
const first = plan0.days[0].stops.find((s) => s.id !== "contact:1").id;
const notfit = pool.ids.find((id) => !plan0.days.some((d) => d.stops.some((s) => s.id === id)));
const statuses = { [first]: "visited", [notfit]: "notfit" };
const outcomes = { [first]: { result: "Interested", note: "ask for Sam, Thursday", followUp: "2026-10-15" } };

// a tiny CSV reader (quoted fields, doubled quotes)
const parse = (text) => text.trim().split("\r\n").map((line) => {
  const out = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q && c === '"' && line[i + 1] === '"') (cur += '"'), i++;
    else if (c === '"') q = !q;
    else if (c === "," && !q) out.push(cur), (cur = "");
    else cur += c;
  }
  out.push(cur);
  return out;
});

// the rows between the header and the blank line before the footer
const body = (rows) => {
  const r = rows.slice(1);
  return r.slice(0, r.findIndex((x) => x.every((c) => c === "")));
};

test("header: every column, including status, outcome, outcome note and follow-up", () => {
  const rows = parse(planCSV({ plan: plan0, venues: pool.venues, pool, statuses, outcomes }));
  assert.deepEqual(rows[0], CSV_COLUMNS);
  for (const c of ["day", "date", "stop", "arrive", "name", "rank", "leg_miles", "distance", "hours", "status", "outcome", "outcome_note", "follow_up", "my_contact"]) assert.ok(CSV_COLUMNS.includes(c), c);
  for (const r of rows) assert.equal(r.length, CSV_COLUMNS.length);
});

test("rows: stops in day order with times, rank, road/estimate, status and outcome; then the doors not scheduled", () => {
  const rows = body(parse(planCSV({ plan: plan0, venues: pool.venues, pool, statuses, outcomes })));
  const col = (r, c) => r[CSV_COLUMNS.indexOf(c)];
  const scheduled = plan0.days.flatMap((d) => d.stops);
  assert.equal(rows.filter((r) => col(r, "day") !== "Not on a day").length, scheduled.length);
  assert.deepEqual([col(rows[0], "day"), col(rows[0], "date"), col(rows[0], "stop")], ["Tuesday", "2026-10-13", "1"]);
  const r1 = rows.find((r) => col(r, "qloo_id") === first);
  assert.match(col(r1, "arrive"), /^\d{1,2}:\d{2} (am|pm)$/);
  assert.equal(col(r1, "distance"), "estimated");
  assert.equal(col(r1, "status"), "Visited");
  assert.equal(col(r1, "outcome"), "Interested");
  assert.equal(col(r1, "outcome_note"), "ask for Sam, Thursday");
  assert.equal(col(r1, "follow_up"), "2026-10-15");
  assert.match(col(r1, "rank"), new RegExp(`^#\\d+ of ${pool.N} on Your list$`));
  const c = rows.find((r) => col(r, "my_contact") === "yes");
  assert.equal(col(c, "name"), contact.name, "quotes and commas survive");
  assert.equal(col(c, "hours"), "hours unverified");
  assert.equal(col(c, "qloo_id"), "", "a manual door has no Qloo id");
  const nf = rows.find((r) => col(r, "qloo_id") === notfit);
  assert.equal(col(nf, "day"), "Not on a day");
  assert.equal(col(nf, "status"), "Not a fit");
  assert.equal(rows.filter((r) => col(r, "day") === "Not on a day").length, new Set([...plan0.unscheduled, notfit]).size);
});

test("formula injection: a cell starting with = + - @ or a tab gets an apostrophe (R1 Diolosa 9)", () => {
  for (const s of ["=1+1", "+cmd", "-2+3", "@SUM(A1)", "\tx", "\rx"]) assert.equal(guardCell(s), `'${s}`);
  for (const s of ["Hi Hat", "#3 of 55", "2:15 pm", ""]) assert.equal(guardCell(s), s);
  const evil = { id: "contact:evil", name: '=HYPERLINK("http://x.example","click")', lat: 30.26, lon: -97.72, source: "manual", address: "@home" };
  const p = buildPool({ routes: [ab], profile, contacts: [evil] });
  const plan = planDays({ pool: p.rows, statuses: {}, windows: windowsFor(profile), visitMin: 25, pinned: p.pinned });
  const text = planCSV({ plan, venues: p.venues, pool: p });
  const rows = body(parse(text));
  const r = rows.find((x) => x[CSV_COLUMNS.indexOf("name")].includes("HYPERLINK"));
  assert.equal(r[CSV_COLUMNS.indexOf("name")], `'${evil.name}`);
  assert.equal(r[CSV_COLUMNS.indexOf("address")], "'@home");
  assert.ok(!/(^|,)[=+\-@]/m.test(text), "no raw formula cell anywhere");
});

test("footer: rank definition, how miles were measured, hours capture date, not a distribution check", () => {
  const rows = parse(planCSV({ plan: plan0, venues: pool.venues, pool, statuses, outcomes, captured: "2026-10-08", source: "estimate" }));
  const foot = rows.slice(rows.findIndex((x) => x.every((c) => c === "")) + 1).map((x) => x[0]);
  assert.equal(foot.length, 4);
  assert.match(foot[0], new RegExp(`^Rank: "#k of ${pool.N} on Your list" is the door's place among ${pool.N} bars and breweries for people who drink Athletic Brewing`));
  assert.match(foot[1], /straight-line distance × 1\.35 at 18 mph/);
  assert.match(foot[2], /captured 2026-10-08/);
  assert.equal(foot[3], "Not a distribution check: Qloo doesn't know what a door stocks.");
  for (const r of rows) assert.equal(r.length, CSV_COLUMNS.length);
  assert.match(csvFooter({ pool, source: "ors" })[1], /OpenRouteService/);
  const m = csvFooter({ pool: { N: 90, label: "Austin bars for people who drink like Athletic Brewing and LaCroix drinkers" }, merged: true })[0];
  assert.match(m, /on Your list.*taken in turn/); // Jard 10-24: one wording, merged or not
  assert.match(m, /Athletic Brewing and LaCroix/);
  const merged = body(parse(planCSV({ plan: plan0, venues: pool.venues, pool, merged: true })));
  assert.match(merged.find((r) => r[CSV_COLUMNS.indexOf("rank")])[CSV_COLUMNS.indexOf("rank")], /^#\d+ of \d+ on Your list$/);
});

test("hours: openTill gets the parsed hours, so a frozen early stop says when it opens", () => {
  const d = plan0.days[0];
  const id = pool.ids.find((x) => parseHours(pool.venues[x].hours)?.days?.[d.day]?.spans?.some((s) => s.from >= 15 * 60));
  const from = parseHours(pool.venues[id].hours).days[d.day].spans.find((s) => s.from >= 15 * 60).from;
  const stop = { id, eta: from - 30, depart: from - 5, legMi: 0.4, legMin: 2, source: "estimate", hoursVerified: true, openAtArrival: false };
  const plan = { days: [{ ...d, stops: [stop] }], unscheduled: [] };
  const rows = body(parse(planCSV({ plan, venues: pool.venues, pool })));
  assert.match(rows[0][CSV_COLUMNS.indexOf("hours")], /^opens .+, you'd be early$/);
});

test("call sheet (G2): the ask reads as a sentence, dates are readable, a footnote mark never wraps alone", () => {
  const m = {
    n: 1, venue: { name: "Nomadic Beerworks", address: "3804 Woodbury Dr" }, rankLine: "#1 of 55",
    outcome: { result: "interested", followUp: "2026-10-15" },
    talk: { before: ["Ask for the taproom manager."], opener: "Hi.", questions: ["Cans or draft?"], points: [{ text: "NA sales grew 30% in 2024.", fact: "f1" }],
      pushback: [{ objection: "We only serve our own beer.", reply: "It covers the guest who isn't drinking." }], ask: "one case of cans in the cooler", by: "model",
      factRefs: [{ id: "f1", source: "Entegra", url: "https://example.com/a-very-long-path" }] },
  };
  const html = callSheetHTML([m], { brand: "Tidewell", city: "Austin" });
  assert.match(html, /<p class="cs-ask"><b>One case of cans in the cooler<\/b><\/p>/);
  assert.match(html, /follow up Thu Oct 15/);
  assert.match(html, /in 2024\.&nbsp;<sup>\[1\]<\/sup>/);
  assert.match(html, /<footer><h3>Sources<\/h3><ol><li>Entegra: https:\/\/example\.com\/a-very-long-path<\/li><\/ol><\/footer>/);
});

test("call sheet as text (the phone's, PARITY S16): the HTML's content, one footnote per article, tick boxes", () => {
  const m = {
    n: 2, venue: { name: "Nomadic Beerworks", address: "3804 Woodbury Dr", phone: "+15125551212" }, rankLine: "#1 of 55", hoursToday: "3–10 pm",
    outcome: { result: "followup", followUp: "2026-10-15", note: "ask for Sam" },
    talk: { before: ["Ask for the taproom manager."], opener: "Hi.", questions: ["Cans or draft?"], points: [{ text: "NA sales grew.", fact: "f1" }, { text: "Same article.", fact: "f2" }],
      pushback: [{ objection: "Own beer only.", reply: "It covers the guest." }], ask: "one case of cans", by: "template",
      factRefs: [{ id: "f1", source: "Entegra", url: "https://example.com/a" }, { id: "f2", source: "Entegra", url: "https://example.com/a" }] },
  };
  const t = callSheetText([m], { brand: "Tidewell", city: "Austin", label: "Ranked for Athletic drinkers", captured: "Oct 2" });
  assert.match(t, /^CALL SHEET · Tidewell · Austin\nRanked for Athletic drinkers · Qloo data captured Oct 2\. Not a distribution check/);
  assert.match(t, /\n2\. NOMADIC BEERWORKS\nNot on a day · 3804 Woodbury Dr\n#1 of 55\nOpen today 3–10 pm · Phone /);
  assert.match(t, /Outcome: Follow up · follow up Thu Oct 15 · ask for Sam/);
  assert.match(t, /  \[ \] Cans or draft\?/);
  assert.match(t, /NA sales grew\. \[1\]\n  • Same article\. \[1\]/);
  assert.match(t, /The ask\n  One case of cans\nTalking points: template\./);
  assert.match(t, /\n\nSources\n1\. Entegra: https:\/\/example\.com\/a\n$/);
});

