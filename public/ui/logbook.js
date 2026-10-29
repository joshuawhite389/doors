// The Log book pane (round 4 item 10): every door the rep has touched in this city, one row each with its status, the
// day it's on, its last activity, its next step and its notes; counts at the top; filters, search and sort; a timeline
// per door; Save for later on every row; the plan's own changes; the doors and the activity as CSV. The model is
// lib/logbook.js (pure); this file only draws it and takes the clicks. Opened from the plan's top bar (ui/plan.js; its name is LOGBOOK_LABEL, round 6 #5), it
// takes the left column on a wide screen like Why these doors, and the whole screen on a phone (css/logbook.css).
import { $, $$, esc } from "./dom.js";
import { icon } from "../lib/icons.js"; // round 7: the × is the icon set's
import { download } from "./export.js";
import { logbookRows, filterRows, sortRows, logbookCounts, doorTimeline, planTimeline, logbookCSV, activityCSV, STATUSES, SORTS, LOGBOOK_LABEL } from "../lib/logbook.js";

const CSS = "/css/logbook.css";
const ensureCSS = () => { if (!document.querySelector(`link[href="${CSS}"]`)) document.head.append(Object.assign(document.createElement("link"), { rel: "stylesheet", href: CSS })); };
const slug = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const TAG_CLASS = { due: "fu", followup: "fu", interested: "ok", someone: "", no: "no", visited: "st-visited", scheduled: "sch", saved: "sv", notfit: "no", talked: "no", removed: "no", list: "", off: "" };
const n = (k, w) => `${k} ${w}${k === 1 ? "" : "s"}`;

const ui = new WeakMap(); // el → the pane's own state (filters, open timelines) while the plan is on screen
const stateOf = (el) => {
  if (!ui.has(el)) ui.set(el, { status: [], hood: "", q: "", sort: "recent", open: new Set(), changes: false });
  return ui.get(el);
};
// Open on a filter (the row menus' "Saved for later" toast, a count tile): one status, nothing else
export function presetLogbook(el, { status = [] } = {}) {
  const s = stateOf(el);
  s.status = status;
  s.q = "";
  s.hood = "";
}

// drawLogbook(el, {plan, state, today, brand, city, openStop(id, day), setLater(id, on), close(), flash(text)})
export function drawLogbook(el, ctx) {
  ensureCSS();
  const s = stateOf(el);
  const { plan, state, today, brand, city } = ctx;
  const all = logbookRows({ state, plan, today });
  const counts = logbookCounts(all, { state, today });
  const rows = sortRows(filterRows(all, { status: s.status, hood: s.hood, q: s.q }), s.sort);
  const present = new Set(all.map((r) => r.status));
  if (all.some((r) => r.saved)) present.add("saved");
  const active = (k) => s.status.includes(k);
  const tile = (key, label, k, status) => `<button type="button" class="lb-tile" data-lb="tile" data-status="${esc(status ?? "")}" aria-pressed="${status ? active(status) && s.status.length === 1 : !s.status.length}"><b>${k}</b><span>${esc(label)}</span></button>`;
  const hoods = counts.byHood;
  const changes = planTimeline(state.activity);
  const focused = document.activeElement === $(".lb-search", el) ? { v: $(".lb-search", el).value, at: $(".lb-search", el).selectionStart } : null;
  const keep = el.scrollTop;
  const row = (r) => {
    const open = s.open.has(r.id);
    const meta = [r.genre, r.hood, r.date ? `${r.dayName}${r.stop ? ` · stop ${r.stop}` : ""}${r.past ? " (ended)" : ""}` : "", r.rank ? `#${r.rank} on Your list` : "", r.contact ? "My contact" : r.added ? "Added by you" : ""].filter(Boolean);
    const note = r.notes[0];
    const tl = open ? doorTimeline(state.activity, r.id) : [];
    return `<li class="lb-row" data-id="${esc(r.id)}">
      <div class="lb-top">${plan?.venues?.[r.id] ? `<button type="button" class="lb-nm" data-lb="open">${esc(r.name)}</button>` : `<span class="lb-nm">${esc(r.name)}</span>`}<span class="tg ${TAG_CLASS[r.status] ?? ""}">${esc(r.label)}</span>${r.saved && r.status !== "saved" ? `<span class="tg sv">Saved for later</span>` : ""}</div>
      ${meta.length ? `<div class="lb-meta">${meta.map(esc).join(" · ")}</div>` : ""}
      ${r.lastText ? `<div class="lb-last">${esc(r.lastText)}${r.lastAt ? ` <time datetime="${esc(r.lastAt)}">${esc(whenShort(r.lastAt, today))}</time>` : ""}</div>` : `<div class="lb-last muted">No activity logged yet.</div>`}
      ${r.next ? `<div class="lb-next"><b>Next:</b> ${esc(r.next)}</div>` : ""}
      ${note ? `<div class="lb-note"><b>Note:</b> ${esc(note.text)}${r.notes.length > 1 ? ` <span class="muted">· ${n(r.notes.length, "note")}</span>` : ""}</div>` : ""}
      <div class="lb-acts">
        <button type="button" class="btn line sm" data-lb="later" aria-pressed="${r.saved}">${r.saved ? "Remove from Saved for later" : "Save for later"}</button>
        <button type="button" class="btn line sm" data-lb="tl" aria-expanded="${open}">${open ? "Hide the timeline" : `Timeline${r.events ? ` · ${r.events}` : ""}`}</button>
        ${plan?.venues?.[r.id] ? `<button type="button" class="btn line sm" data-lb="open">Open the door</button>` : ""}
      </div>
      ${open ? `<ol class="lb-tl" aria-label="${esc(r.name)}: what happened">${tl.length ? tl.map((e) => `<li><time datetime="${esc(e.at)}">${esc(e.when)}</time><span>${esc(e.text)}</span></li>`).join("") : `<li><span class="muted">Nothing logged yet. Visits, outcomes, notes, Save for later and changes to this door show here as they happen.</span></li>`}${r.notes.filter((x) => !tl.some((e) => /^note/.test(e.kind) && e.text === x.text)).length ? `<li class="lb-tlnotes"><b>Notes</b><ul>${r.notes.filter((x) => !tl.some((e) => /^note/.test(e.kind) && e.text === x.text)).map((x) => `<li>${esc(x.text)} <span class="muted">· ${esc(x.who)}${x.at ? `, ${esc(whenShort(x.at, today))}` : ""}</span></li>`).join("")}</ul></li>` : ""}</ol>` : ""}
    </li>`;
  };
  el.innerHTML = `
    <div class="lb-head">
      <h3>${esc(LOGBOOK_LABEL)}</h3>
      <button type="button" class="lb-x" data-lb="close" aria-label="Close">${icon("close", 18)}</button>
    </div>
    <div class="lb-tiles" role="group" aria-label="Counts">
      ${tile("all", "doors", counts.doors, null)}
      ${tile("week", counts.week ? `visited since ${whenShort(counts.week.from, "")}` : "visited", counts.visitedWeek, "visited")}
      ${tile("due", "follow-ups due", counts.due, "due")}
      ${tile("sch", "scheduled", counts.scheduled, "scheduled")}
      ${tile("sv", "saved for later", counts.saved, "saved")}
    </div>
    <div class="lb-ctl">
      <input type="search" class="lb-search" placeholder="Search doors, notes, names" aria-label="Search doors, notes, names" value="${esc(s.q)}">
      <label class="lb-sel"><span>Sort</span><select data-lb="sort" aria-label="Sort by">${SORTS.map((o) => `<option value="${o.key}"${o.key === s.sort ? " selected" : ""}>${esc(o.label)}</option>`).join("")}</select></label>
      ${hoods.length ? `<label class="lb-sel"><span>Area</span><select data-lb="hood" aria-label="Neighbourhood"><option value="">Every neighbourhood</option>${hoods.map((h) => `<option value="${esc(h.hood)}"${h.hood === s.hood ? " selected" : ""}>${esc(h.hood)} · ${h.n}</option>`).join("")}</select></label>` : ""}
    </div>
    <div class="lb-chips" role="group" aria-label="Status">
      <button type="button" class="chip" data-lb="chip" data-status="" aria-pressed="${!s.status.length}">All</button>
      ${STATUSES.filter((x) => present.has(x.key)).map((x) => `<button type="button" class="chip" data-lb="chip" data-status="${x.key}" aria-pressed="${active(x.key)}">${esc(x.label)}</button>`).join("")}
    </div>
    <div class="lb-sum" role="status">${rows.length === all.length ? n(all.length, "door") : `${rows.length} of ${n(all.length, "door")}`}${counts.byOutcome.length ? ` · ${counts.byOutcome.map((o) => `${esc(o.label.toLowerCase())} ${o.n}`).join(" · ")}` : ""}${counts.notes ? ` · ${n(counts.notes, "note")}` : ""}</div>
    <ul class="lb-rows">${rows.map(row).join("") || `<li class="lb-empty">${all.length ? "No door matches. Clear the search or the filters." : "No doors yet. Log a visit, save a door for later, or write a note on a door, and it shows here."}</li>`}</ul>
    <details class="lb-changes"${s.changes ? " open" : ""}><summary>Changes to the plan · ${changes.length}</summary>
      ${changes.length ? `<ol class="lb-tl">${changes.slice(0, 40).map((e) => `<li><time datetime="${esc(e.at)}">${esc(e.when)}</time><span>${esc(e.text)}</span></li>`).join("")}</ol>${changes.length > 40 ? `<p class="muted small">The newest 40 of ${changes.length}. The CSV has them all.</p>` : ""}` : `<p class="muted small">Changes you make to the plan (days, door types, the most popular doors, Stop for today) show here.</p>`}
    </details>
    <div class="lb-export">
      <button type="button" class="btn line sm" data-lb="csv">Download doors as CSV</button>
      <button type="button" class="btn line sm" data-lb="csv-activity">Download activity as CSV</button>
      <span class="lb-saved">Saved on this device only.</span>
    </div>`;
  el.scrollTop = keep;
  if (focused) { const f = $(".lb-search", el); f.focus({ preventScroll: true }); try { f.setSelectionRange(focused.at, focused.at); } catch {} }
  if (!el.dataset.lbBound) {
    el.dataset.lbBound = "1";
    el.addEventListener("click", (e) => onClick(e, el));
    el.addEventListener("input", (e) => { if (e.target.matches(".lb-search")) { stateOf(el).q = e.target.value; redraw(el); } });
    el.addEventListener("change", (e) => {
      const k = e.target.closest("[data-lb]")?.dataset.lb;
      if (k === "sort") (stateOf(el).sort = e.target.value), redraw(el);
      else if (k === "hood") (stateOf(el).hood = e.target.value), redraw(el);
    });
    el.addEventListener("toggle", (e) => { if (e.target.matches(".lb-changes")) stateOf(el).changes = e.target.open; }, true);
  }
  el.__lbCtx = ctx;
}
const redraw = (el) => el.__lbCtx && drawLogbook(el, el.__lbCtx);

function onClick(e, el) {
  const b = e.target.closest("[data-lb]");
  if (!b || !el.contains(b)) return;
  const s = stateOf(el);
  const ctx = el.__lbCtx ?? {};
  const k = b.dataset.lb;
  const id = b.closest(".lb-row")?.dataset.id;
  if (k === "close") return ctx.close?.();
  if (k === "tile" || k === "chip") {
    const st = b.dataset.status;
    if (!st) s.status = [];
    else if (k === "tile") s.status = [st];
    else s.status = s.status.includes(st) ? s.status.filter((x) => x !== st) : [...s.status, st];
    return redraw(el);
  }
  if (k === "tl") { s.open.has(id) ? s.open.delete(id) : s.open.add(id); return redraw(el); }
  if (k === "later") return ctx.setLater?.(id, b.getAttribute("aria-pressed") !== "true");
  if (k === "open") return ctx.openStop?.(id);
  if (k === "csv" || k === "csv-activity") {
    const { plan, state, today, brand, city } = ctx;
    const name = `doors-${k === "csv" ? "logbook" : "activity"}-${slug(brand)}-${slug(city)}.csv`;
    const text = k === "csv" ? logbookCSV(sortRows(logbookRows({ state, plan, today }), s.sort), { brand, city, today }) : activityCSV(state.activity, { nameOf: (x) => plan?.venues?.[x]?.name ?? null });
    download(text, name, "text/csv");
    return ctx.flash?.(k === "csv" ? `${n(logbookRows({ state, plan, today }).length, "door")} downloaded as CSV.` : `${n((state.activity ?? []).length, "event")} downloaded as CSV.`);
  }
}

// "2:10 pm" today, "Mon Oct 26, 2:10 pm" otherwise
function whenShort(at, today) {
  if (/(Z|[+-]\d{2}:\d{2})$/.test(String(at ?? "")) && !Number.isNaN(Date.parse(at))) { const d = new Date(at); at = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; }
  const m = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2}))?/.exec(String(at ?? ""));
  if (!m) return "";
  const t = m[2] ? clock(+m[2] * 60 + +m[3]) : "";
  if (m[1] === today && t) return `today, ${t}`;
  const [y, mo, d] = m[1].split("-").map(Number);
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(y, mo - 1, d).getDay()];
  const mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][mo - 1];
  return `${day} ${mon} ${d}${t ? `, ${t}` : ""}`;
}
const clock = (min) => { const h = Math.floor(min / 60) % 24, mm = min % 60; return `${h % 12 || 12}:${String(mm).padStart(2, "0")} ${h < 12 ? "am" : "pm"}`; };
export { stateOf as logbookState };
