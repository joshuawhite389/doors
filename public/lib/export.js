// Export v2 (SPEC-V2 §3.4, §8): the plan as CSV, one row per scheduled stop in day order, then the doors not
// scheduled. Status and outcome columns are always present (empty until set). Pure: covered by test/export.test.mjs.
import { clock12, niceDate } from "./profile.js";
import { genreLabel, parseHours } from "./core.js";
import { openTill } from "./pool.js";
import { travelLabel } from "./travel.js";
import { phoneText } from "./talk.js";

export const CSV_COLUMNS = [
  "day", "date", "stop", "arrive", "wait_min", "leave", "name", "genre", "rank", "address", "phone", "website",
  "leg_miles", "leg_minutes", "distance", "hours", "my_contact", "status", "outcome", "outcome_note", "follow_up", "qloo_id",
];

const STATUS_TEXT = { visited: "Visited", talked: "Already know them", notfit: "Not a fit" };
// A cell a spreadsheet would run as a formula (= + - @, or a tab/CR first) gets a leading apostrophe (R1 Diolosa 9).
export const guardCell = (s) => (/^[=+\-@\t\r]/.test(s) ? `'${s}` : s);
const cell = (v) => {
  const s = typeof v === "number" ? String(v) : guardCell(v == null ? "" : String(v));
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : "");

// plan: schedule.planDays output; venues: id → venue; pool: {ids, N, label}; statuses/outcomes: from the store.
// outcome = {result?, note?, followUp?} (C1 writes it). captured = the Qloo capture date; source = how distances were
// measured ("ors" | "estimate" | "mixed"); merged = 2+ drinker brands (stopmodel.isMerged). They feed the footer rows:
// what the rank means, how miles were measured, when hours were captured, and "Not a distribution check".
export function planCSV({ plan, venues = {}, pool = { ids: [], N: 0 }, statuses = {}, outcomes = {}, captured = "", source = "estimate", merged = false }) {
  const rank = new Map((pool.ids ?? []).map((id, i) => [id, i + 1]));
  const line = (o) => CSV_COLUMNS.map((c) => cell(o[c])).join(",");
  const door = (id) => {
    const v = venues[id] ?? {};
    const o = outcomes[id] ?? {};
    return {
      name: v.name ?? id,
      genre: genreLabel(v) || "",
      rank: rank.has(id) ? `#${rank.get(id)} of ${pool.N} on Your list` : "", // Jard 10-24: the plan's own words
      address: v.address ?? "",
      phone: phoneText(v.phone) ?? "", // "(512) 320-8377": an E.164 "+1…" would trip the formula guard (R2 L8)
      website: v.website ?? "",
      my_contact: v.contact ? "yes" : "",
      status: STATUS_TEXT[statuses[id]] ?? "",
      outcome: OUT_TEXT[o.result] ?? o.result ?? "",
      outcome_note: [o.who ? `talked to ${o.who}` : "", o.note ?? ""].filter(Boolean).join("; "),
      follow_up: o.followUp ?? "",
      qloo_id: v.source === "manual" ? "" : id,
    };
  };
  const rows = [CSV_COLUMNS.join(",")];
  for (const d of plan.days) {
    if (!d) continue;
    d.stops.forEach((s, i) => {
      rows.push(line({
        day: cap(d.day), date: d.date, stop: i + 1, arrive: clock12(s.eta - (s.waitMin ?? 0)), wait_min: s.waitMin ?? 0, leave: clock12(s.depart),
        leg_miles: s.legMi.toFixed(1), leg_minutes: s.legMin, distance: s.source === "ors" ? "road" : "estimated",
        hours: openTill(s, { parsed: parseHours(venues[s.id]?.hours), day: d.day }), ...door(s.id),
      }));
    });
  }
  const listed = new Set(plan.days.flatMap((d) => d?.stops.map((s) => s.id) ?? []));
  const rest = [...(plan.unscheduled ?? []), ...Object.keys(statuses).filter((id) => statuses[id] && venues[id])];
  for (const id of new Set(rest)) if (!listed.has(id)) rows.push(line({ day: "Not on a day", ...door(id) }));
  rows.push(line({}));
  for (const t of csvFooter({ pool, captured, source, merged })) rows.push(line({ day: t }));
  return rows.join("\r\n") + "\r\n";
}

// The footer rows, one sentence each in the first column.
export function csvFooter({ pool = {}, captured = "", source = "estimate", merged = false } = {}) {
  const label = pool.label ?? "";
  return [
    merged
      ? `Rank: "#k of ${pool.N ?? "N"} on Your list" is the door's place on Your list (Qloo's lists for each drinker brand, taken in turn) of ${label.replace(" for people who drink like ", " for ")}.`
      : `Rank: "#k of ${pool.N ?? "N"} on Your list" is the door's place among ${pool.N ?? "N"} ${label}, in Qloo's taste-affinity order.`,
    `Distances: ${travelLabel(source)}`,
    `Hours from each door's own Qloo listing${captured ? `, captured ${captured}` : ""}.`,
    "Not a distribution check: Qloo doesn't know what a door stocks.",
  ];
}

// ---------- C1: drafted notes and the printable call sheet ----------
// stops = stopModel() outputs (public/lib/stopmodel.js) in day order. Pure strings: the UI downloads or prints them.
const OUT_TEXT = { interested: "Interested", followup: "Follow up", someone: "Talked to someone else", no: "Not interested" };
const escH = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const whereText = (m) => (m.day ? `${niceDate(m.day.date)} · stop ${m.n} of ${m.total} · ${lower1(m.arriveText ?? `Arrive ${clock12(m.stop.eta)}`)}` : "Not on a day");
const lower1 = (s) => s.replace(/^A/, "a");
const cap1 = (s) => String(s ?? "").replace(/^\p{Ll}/u, (c) => c.toUpperCase());
const byText = (by) => (by === "model" ? "written for this door from Qloo's facts about it" : "template");

// Every drafted note as plain text, one block per stop.
export function notesText(stops, { brand = "", city = "" } = {}) {
  const head = `Doors · drafted messages${brand ? ` · ${brand}` : ""}${city ? ` · ${city}` : ""}\nEdit before sending: nothing is sent from Doors. Not a distribution check: Qloo doesn't know what a door stocks.\n`;
  const blocks = stops.map((m) => [
    `=== ${m.venue.name} (${whereText(m)}) ===`,
    `Note: ${byText(m.note.by)}`,
    `Subject: ${m.note.subject}`,
    "",
    m.note.body,
  ].join("\n"));
  return `${head}\n${blocks.join("\n\n")}\n`;
}

// A printable call sheet: one block per stop with the facts, the opener, the questions (tick boxes), the points with
// footnoted sources, the pushback and the ask. A whole HTML fragment (the UI prints it with print CSS).
// G2: only characters in Inter's latin subset (no → or ☐): a glyph from another subset loads late, and Chrome's print
// laid those lines out before it arrived and clipped them at the page edge. The tick box is drawn in CSS.
// the call sheet's per-stop facts line and its footnoted sources: shared by the HTML (web print) and the text (phone)
const sheetFacts = (m) => [
  m.stop ? m.arriveText ?? `Arrive ${clock12(m.stop.eta)}` : null,
  m.hoursToday ? `Open today ${m.hoursToday}` : null,
  m.venue.phone ? `Phone ${phoneText(m.venue.phone)}` : null,
  m.leg ? `${m.leg.mi.toFixed(1)} ${m.leg.source === "ors" ? "road mi" : "mi, estimated"} from the last stop` : null,
].filter(Boolean);
const footnotes = () => {
  const sources = [];
  const ref = (f) => {
    let i = sources.findIndex((x) => x.id === f.id || (f.url && x.url === f.url)); // two facts from one article: one footnote
    if (i < 0) i = sources.push(f) - 1;
    return i + 1;
  };
  return { sources, ref };
};

export function callSheetHTML(stops, { brand = "", city = "", label = "", captured = "" } = {}) {
  const { sources, ref } = footnotes();
  const block = (m) => {
    const t = m.talk;
    const facts = sheetFacts(m);
    const o = m.outcome;
    return `<section class="cs-stop">
  <h2>${m.n ? `${m.n}. ` : ""}${escH(m.venue.name)}</h2>
  <p class="cs-where">${escH(whereText(m))}${m.venue.address ? ` · ${escH(m.venue.address)}` : ""}</p>
  ${m.rankLine ? `<p class="cs-rank">${escH(m.rankLine)}</p>` : ""}
  <p class="cs-facts">${facts.map(escH).join(" · ")}</p>
  ${o?.result ? `<p class="cs-out">Outcome: ${escH(OUT_TEXT[o.result] ?? o.result)}${o.followUp ? ` · follow up ${escH(niceDate(o.followUp))}` : ""}${o.note ? ` · ${escH(o.note)}` : ""}</p>` : ""}
  <h3>Before you walk in</h3><ul>${t.before.map((x) => `<li>${escH(x)}</li>`).join("")}</ul>
  <h3>Opener</h3><p>${escH(t.opener)}</p>${t.toBuyer ? `<h3>To the buyer</h3><p>${escH(t.toBuyer)}</p>` : ""}
  <h3>Questions to ask <small>(Qloo doesn't know what they stock: ask)</small></h3><ul class="cs-q">${t.questions.map((x) => `<li><span class="cs-box"></span>${escH(x)}</li>`).join("")}</ul>
  <h3>Points to make</h3><ul>${t.points.map((p) => { const f = p.fact && m.talk.factRefs?.find((x) => x.id === p.fact); return `<li>${escH(p.text)}${f ? `&nbsp;<sup>[${ref(f)}]</sup>` : ""}</li>`; }).join("")}</ul>
  <h3>Likely pushback</h3><ul>${t.pushback.map((p) => `<li>“${escH(p.objection)}” — ${escH(p.reply)}</li>`).join("")}</ul>
  <h3>The ask</h3><p class="cs-ask"><b>${escH(cap1(t.ask))}</b></p>
  <p class="cs-by">Talking points: ${escH(byText(t.by))}.</p>
</section>`;
  };
  const body = stops.map(block).join("\n");
  return `<div class="callsheet">
<header><h1>Call sheet${brand ? ` · ${escH(brand)}` : ""}${city ? ` · ${escH(city)}` : ""}</h1>
<p class="cs-sub">${escH(label)}${captured ? ` · Qloo data captured ${escH(captured)}` : ""}. Not a distribution check: Qloo doesn't know what a door stocks.</p></header>
${body}
${sources.length ? `<footer><h3>Sources</h3><ol>${sources.map((f) => `<li>${escH(f.source)}: ${escH(f.url)}</li>`).join("")}</ol></footer>` : ""}
</div>`;
}

// The call sheet as plain text (the phone shares it: it has no print view without a native module): callSheetHTML's
// content line for line, one block per stop, the sources at the end.
export function callSheetText(stops, { brand = "", city = "", label = "", captured = "" } = {}) {
  const { sources, ref } = footnotes();
  const block = (m) => {
    const t = m.talk;
    return [
      `${m.n ? `${m.n}. ` : ""}${m.venue.name}`.toUpperCase(),
      `${whereText(m)}${m.venue.address ? ` · ${m.venue.address}` : ""}`,
      m.rankLine ?? null,
      sheetFacts(m).join(" · "),
      m.outcome?.result ? `Outcome: ${OUT_TEXT[m.outcome.result] ?? m.outcome.result}${m.outcome.followUp ? ` · follow up ${niceDate(m.outcome.followUp)}` : ""}${m.outcome.note ? ` · ${m.outcome.note}` : ""}` : null,
      "",
      "Before you walk in", ...t.before.map((x) => `  • ${x}`),
      "Opener", `  ${t.opener}`,
      ...(t.toBuyer ? ["To the buyer", `  ${t.toBuyer}`] : []),
      "Questions to ask (Qloo doesn't know what they stock: ask)", ...t.questions.map((x) => `  [ ] ${x}`),
      "Points to make", ...t.points.map((p) => { const f = p.fact && t.factRefs?.find((x) => x.id === p.fact); return `  • ${p.text}${f ? ` [${ref(f)}]` : ""}`; }),
      "Likely pushback", ...t.pushback.map((p) => `  • “${p.objection}” — ${p.reply}`),
      "The ask", `  ${cap1(t.ask)}`,
      `Talking points: ${byText(t.by)}.`,
    ].filter((x) => x != null).join("\n");
  };
  const head = `CALL SHEET${brand ? ` · ${brand}` : ""}${city ? ` · ${city}` : ""}\n${label}${captured ? ` · Qloo data captured ${captured}` : ""}. Not a distribution check: Qloo doesn't know what a door stocks.`;
  const body = stops.map(block).join("\n\n────────\n\n");
  const foot = sources.length ? `\n\nSources\n${sources.map((f, i) => `${i + 1}. ${f.source}: ${f.url}`).join("\n")}` : "";
  return `${head}\n\n${body}${foot}\n`;
}
