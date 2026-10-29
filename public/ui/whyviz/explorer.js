// WHY-VIZ-SPEC §4.1 Match × your variables, drawn: the sentence, the control rows (these are Try a change, moved up),
// the picture (SVG from lib/whyviz/explorer.js's model, updated in place so dots glide to their new spot), the
// legend, Apply / Reset, the per-drinker weights, the source line and the table twin. Every control runs the real
// planner on a scratch profile (ui/whyviz/state.js) and the picture takes its fates from that preview. drawMini draws
// the same picture small, for one door (§4.7 the door portrait).
import { $, esc, debounce } from "../dom.js";
import { svgEl, svgText, svgRoot, setAttrs, COLOURS as C, attachTip, stripHTML, stripRows, sayHTML, sayInto, scheduleReserve, legendHTML, sourceHTML, tableTwinHTML, segRowHTML, widthOf, fmt1, fmt2, fmt3 } from "../viz-dom.js";
import { explorerModel, dotRows, logistics, logiLine, LOGI_FATES } from "../../lib/whyviz/explorer.js";
import { pvHTML } from "../whymap.js"; // round 5 #5: a row's + previews under the list
import { roomChoices } from "../../lib/profile.js";
import { WEIGHT_WORDS, changeText } from "../../lib/whatif.js";
import { vizState, previewOf, runPreview, applyViz, resetViz, setControl } from "./state.js";
import * as S from "../state.js";

const CSS_HREF = "/css/whyviz.css"; // the pictures' shared stylesheet (lane 2 wrote it first; both lanes add to it)
if (typeof document !== "undefined" && !document.querySelector(`link[href="${CSS_HREF}"]`)) {
  const l = document.createElement("link");
  l.rel = "stylesheet";
  l.href = CSS_HREF;
  document.head.append(l);
}

export const EXPLORER_LABEL = "Match against how well known, with your variables";
// round 6 #1 (Jard 10-27: "i don't want anything moving while i'm clicking around on these filters"): the sentence keeps
// one height whatever it says (css .wv-sayfix: SAY_LINES lines at this width), so the filter rows and the picture
// under it never move on a click. A sentence longer than that is cut at a line and gets a "more" button that opens it
// (the rep's own click, the one time the block may grow); the next change folds it again.
export const SAY_MORE = "more", SAY_LESS = "less";
const sayFixHTML = (words) => `<div class="wv-sayfix">${sayHTML(words)}<button type="button" class="wv-saymore" data-wv-saymore aria-expanded="false" hidden>${SAY_MORE}</button></div>`;
export function fitSay(el) {
  const box = $(".wv-explorer .wv-sayfix", el);
  if (!box) return;
  const say = $(".wv-say", box), more = $("[data-wv-saymore]", box);
  box.classList.remove("open");
  more.setAttribute("aria-expanded", "false");
  more.textContent = SAY_MORE;
  more.hidden = say.scrollHeight <= say.clientHeight + 1;
}
const SRC_LINE = "Qloo: affinity, popularity, rating and location on every place, and Qloo's re-rank for each age band. Door types and the most-popular cap are Doors' own filters. Rating 4.5 and up only greys dots here; it doesn't change the plan.";

// the day whose start the Distance axis measures from: the day the plan view shows, else the first day ahead with doors
export function startOf(s) {
  const sel = S.getSelectedDay();
  const days = s.ctx.plan?.days ?? [];
  const d = (Number.isInteger(sel) && days[sel]) || days.find((x) => x && !x.past && x.stops?.length) || days.find(Boolean);
  const st = d?.start ?? s.ctx.profile?.start ?? null;
  return st && Number.isFinite(st.lat) && Number.isFinite(st.lon) ? { lat: st.lat, lon: st.lon, label: st.label ?? s.ctx.profile?.start?.label ?? null } : null;
}

// the model for the drawer's current state and preview
export function explorerModelFor(s) {
  const { preview, busy, err, set, stale } = previewOf(s);
  const m = explorerModel({ sv: s.m.sv, plan: s.ctx.plan, profile: s.ctx.profile, routes: s.ctx.routes ?? [], famous: !!s.ctx.famous, state: vizState(s).st, preview: preview ?? stale, start: startOf(s), cityName: s.ctx.plan.city?.name });
  m.busy = busy;
  m.err = err;
  m.hasChange = set.changes.length > 0;
  m.changeText = m.hasChange ? changeText(set, { profile: s.ctx.profile, names: Object.fromEntries((s.ctx.routes ?? []).map((r) => [r.drinker?.key, r.drinker?.name])) }) : "";
  // round 4 #7: the reasons picked, the doors they leave; the picture fades every other dot while a reason is picked
  const lg = (s.viz.logi ??= { fates: [], codes: [] });
  m.logi = logistics(m, { fates: lg.fates, codes: lg.codes, days: (s.ctx.plan?.days ?? []).map((d) => (d?.day ? d.day[0].toUpperCase() + d.day.slice(1) : "")), rooms: s.ctx.profile?.rooms ?? [] });
  m.logiIds = m.logi.active ? new Set(m.logi.doors.map((d) => d.id)) : null;
  return m;
}

// ---------- HTML ----------
export function explorerHTML(s) {
  const m = explorerModelFor(s);
  s.viz.m = m;
  const st = vizState(s).st;
  const p = s.ctx.profile, routes = s.ctx.routes ?? [];
  const start = startOf(s);
  const rows = [];
  const xs = [{ v: "pop", text: "How well known", on: m.xmode.key === "pop" }, { v: "rating", text: "Rating", on: m.xmode.key === "rating" }];
  if (start) xs.push({ v: "km", text: "Distance", on: m.xmode.key === "km" });
  // round 5 #3 (Jard 10-27: "i didn't want to just hide some of the filters"): every row shows, in one aligned grid of
  // compact segmented controls; calmer by layout, not by hiding. Across (the picture only) sits first; the settings
  // that try a change follow; the reasons doors are left off (#4) are rows of the same grid, not a section.
  rows.push(segRowHTML("x", "Across", xs));
  const settings = [];
  if (m.bands.length) settings.push(segRowHTML("band", "Your drinkers' age", [{ v: "all", text: "All ages", on: !st.band }, ...m.bands.map((b) => ({ v: b.key, text: b.label, on: st.band === b.key }))]));
  settings.push(segRowHTML("rooms", "Door types you pitch", roomChoices(p.what).map((r) => ({ v: r.key, text: r.label, on: st.rooms.includes(r.key), disabled: st.rooms.includes(r.key) && st.rooms.length === 1 })), { multi: true }));
  if (routes.some((r) => r.lists?.famous?.length)) settings.push(segRowHTML("famous", "Most popular", [{ v: "false", text: "Leave for later", on: !st.famous }, { v: "true", text: "Include them", on: !!st.famous }]));
  settings.push(segRowHTML("r45", "Rating", [{ v: "false", text: "Any", on: !st.r45 }, { v: "true", text: "4.5 and up", on: !!st.r45 }]));
  const brands = routes.filter((r) => r.kind === "brand" && r.drinker?.key);
  for (const r of brands.length >= 2 ? brands : []) settings.push(segRowHTML(`weight:${r.drinker.key}`, `${r.drinker.name} drinkers`, ["less", "normal", "more"].map((w) => ({ v: w, text: WEIGHT_WORDS[w], on: (st.weights[r.drinker.key] ?? "normal") === w }))));
  return `<section class="wv-pic wv-explorer" aria-label="${esc(EXPLORER_LABEL)}">
    ${sayFixHTML(m.words)}
    <div class="wv-ctls">${rows.join("")}</div>
    <div class="wv-ctls">${settings.join("")}</div>
    <div class="wv-ctls" data-wv-reasons>${reasonsHTML(s, m)}</div>
    <div class="wv-fig" data-wv-fig="explorer"></div>
    ${stripHTML("Hover or tap a dot: its rank, how well known it is, and why it's on your plan or not.")}
    ${legendHTML(legend(m))}
    ${actsHTML(m)}
    <div class="wv-logi" data-wv-logi${m.logi.active ? "" : " hidden"}>${logiHTML(s, m)}</div>
    ${sourceHTML(SRC_LINE)}
    ${tableHTML(m, false)}
  </section>`;
}
// round 5 #4 (Jard 10-27: "i wanted this to somehow integrate with the filters above"): "Left off because" is a row of
// the grid, one segment per reason with its count (the sieve's gates, lib/whyviz/explorer.js logistics); a picked
// reason keeps only those doors in the picture and rings them on the map, and when it has more than one planner code
// a smaller row under it narrows further. Nothing picked = every door shows.
export const REASONS_LABEL = "Left off because";
export function reasonsHTML(s, m) {
  const lg = s.viz.logi, L = m.logi;
  if (!L.groups.length) return "";
  // round 6 #1: every reason keeps its chip (0, greyed, when no door is left off for it now), so the row never re-wraps on a change
  const chips = LOGI_FATES.map((f) => L.groups.find((g) => g.key === f.key) ?? { key: f.key, label: f.label, n: 0, on: false });
  const row = `<div class="wv-ctl" role="group" aria-label="${esc(REASONS_LABEL)}" data-wv-row="reasons" data-wv-multi="1"><span class="wv-lbl">${esc(REASONS_LABEL)}</span><span class="wv-segs">${chips.map((g) => `<button type="button" class="wv-seg" data-wv-fate="${esc(g.key)}" aria-pressed="${g.on}"${g.n ? "" : " disabled"}>${esc(g.label)}<i>${g.n}</i></button>`).join("")}</span></div>`;
  return row;
}
// round 6 #1 (Jard 10-27: nothing moves on a click): the codes row no longer sits under the reasons row, where it pushed
// the picture down; it heads the list of doors left off, under the picture
export function codesHTML(s, m) {
  const lg = s.viz.logi, L = m.logi;
  return L.groups.filter((g) => g.on && g.codes.length > 1).map((g) => `<div class="wv-ctl wv-sub" role="group" aria-label="${esc(g.label)}: which"><span class="wv-lbl">${esc(g.label)}</span><span class="wv-segs">${g.codes.map((c) => `<button type="button" class="wv-seg" data-wv-code="${esc(c.code)}" aria-pressed="${lg.codes.includes(c.code)}">${esc(c.label)}<i>${c.n}</i></button>`).join("")}</span></div>`).join("");
}
// round 5 #5 (Jard 10-27: the checkbox list was "a terrible design"): the doors a picked reason leaves, as the drawer's
// own rows (the same rows as What doors were left off and why): the name opens the door, the + beside it adds that
// door through the preview tray, which shows right here under the list. No ticks, no Add selected, no chevrons.
const LOGI_SHOW = 10;
export const LOGI_TITLE = "Doors left off for that reason";
export function logiHTML(s, m) {
  const L = m.logi;
  if (!L.active) return "";
  const all = s.viz.logiAll || L.doors.length <= LOGI_SHOW;
  const shown = all ? L.doors : L.doors.slice(0, LOGI_SHOW);
  const canAdd = typeof S.can === "function" ? S.can("addDoor") : true;
  const which = L.groups.filter((g) => g.on).length === 1 ? "that reason" : "those reasons";
  const head = codesHTML(s, m) + `<p class="wv-logi-head"><b>${L.doors.length === 1 ? "1 door" : `${L.doors.length} doors`}</b> left off for ${which}.${L.doors.length && canAdd ? " Tap + Add to put one on your plan." : ""}</p>`;
  // the add's preview opens right under the row whose + Add was pressed (gigbot, round 5: never make him hunt for it)
  const pv = s.pv && s.pvFrom === "logi" ? pvHTML(s) : "";
  const pvId = pv && shown.some((d) => d.id === s.viz.logiPvId) ? s.viz.logiPvId : null;
  const pvRow = `<li class="wv-logi-pv" tabindex="-1" data-wv-logi-pv>${pv}</li>`;
  const list = L.doors.length
    ? `<ul class="w-rows wv-logi-rows">${shown.map((d) => `<li><button type="button" data-door="${esc(d.id)}"><span><b>${esc(d.name)}</b><small>${esc(logiLine(d))}</small></span></button>${canAdd ? `<button type="button" class="w-addt" data-wv-add="${esc(d.id)}" aria-label="Add ${esc(d.name)} to my plan"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>Add</button>` : ""}</li>${d.id === pvId ? pvRow : ""}`).join("")}</ul>${L.doors.length > LOGI_SHOW ? `<button type="button" class="lnk w-more" data-wv-logi="more" aria-expanded="${all}">${all ? "Show fewer" : `Show ${L.doors.length - LOGI_SHOW} more`}</button>` : ""}`
    : `<p class="w-fm">No door is left off for ${which} with these settings.</p>`;
  return head + list + (pv && !pvId ? pv : "");
}
// round 6 #1: the legend has two shapes (a change adds "comes off" and lengthens "On your plan"); it keeps the taller one's
// height at its width, measured in hidden twins, so Apply and the lines under it never move on a click
export function fitLegend(el) {
  const lg = $(".wv-explorer .wv-legend", el);
  if (!lg?.isConnected || !lg.getClientRects().length) return;
  const w = lg.getBoundingClientRect().width;
  if (!w) return;
  const host = document.createElement("div");
  host.style.cssText = `position:absolute;left:0;top:0;width:${w}px;visibility:hidden;pointer-events:none;`;
  host.setAttribute("aria-hidden", "true");
  for (const shape of [{ hasChange: true, famousOn: false }, { hasChange: false, famousOn: true }]) host.insertAdjacentHTML("beforeend", legendHTML(legend(shape)).replace("<div ", '<div style="min-height:0;margin:0" '));
  lg.parentNode.insertBefore(host, lg);
  const max = Math.max(...[...host.children].map((c) => c.getBoundingClientRect().height));
  host.remove();
  if (max > 0) lg.style.minHeight = `${Math.ceil(max)}px`;
}
const legend = (m) => [
  { swatch: "plan", text: m.hasChange ? "On your plan with these settings" : "On your plan" },
  { swatch: "ring", text: "On Your list, not on a day" },
  ...(m.hasChange ? [{ swatch: "ring-big", text: "On your plan today, comes off" }] : []),
  { swatch: "grey", text: "Doesn't qualify" },
  { swatch: "big", text: m.famousOn ? "Most popular, included" : "Most popular, left for later" },
];
export function actsHTML(m) {
  const state = m.busy ? `<span class="wv-busy" role="status">Planning it…</span>` : m.err ? `<span class="wv-err" role="alert">${esc(m.err)}</span>` : "";
  const acts = m.hasChange
    ? `<button type="button" class="btn sm primary" data-wv-act="apply"${m.busy || m.err || !m.previewing ? " disabled" : ""}>Apply to my plan</button><button type="button" class="btn sm line" data-wv-act="reset">Reset</button>${m.hasChange && !m.busy && !m.err ? `<span class="wv-hint">If you: ${esc(m.changeText)}.</span>` : ""}`
    : `<span class="wv-hint">Change a setting above to see what it does to your plan. Nothing changes until you apply it.</span>`;
  return `<div class="wv-acts" data-wv-acts>${state}${acts}</div>`;
}
function tableHTML(m, open) {
  return tableTwinHTML({ cols: ["Door", "On Your list", "Match", "How well known", "Rating", "Day"], rows: m.table.map((r) => [r.name, r.listRank ? `#${r.listRank}` : r.extra ? "Added by you" : "—", fmt3(r.score), fmt2(r.pop), fmt1(r.rating), r.day || "—"]), summary: `The numbers behind it: your ${m.table.length} plan doors`, open });
}

// ---------- mount, refresh, clicks ----------
export function explorerMount(el, s) {
  const fig = $('[data-wv-fig="explorer"]', el);
  if (!fig) return;
  const m = s.viz.m ?? explorerModelFor(s);
  draw(fig, s, m);
  fitSay(el);
  fitLegend(el);
  scheduleReserve(); // round 6 #2: a redraw gives the strip a fresh element; the reserve goes on it again
  jumpToPv(el, s);
  if (!s.viz.ro && typeof ResizeObserver !== "undefined") {
    s.viz.ro = new ResizeObserver(debounce(() => { const f = $('[data-wv-fig="explorer"]', el); if (f && s.viz.svg && Math.abs(widthOf(f) - s.viz.svg.w) > 40) refresh(el, s); }, 150));
    s.viz.ro.observe(el);
  }
}
// the add's preview, just opened under its row: bring it into view and put focus on it (once planned, once more when
// the planner answers), so the rep sees what the + Add did where they pressed it
function jumpToPv(el, s) {
  if (!s.viz?.logiPvJump) return;
  const li = $(".wv-explorer [data-wv-logi-pv]", el);
  if (!li) return;
  try { li.scrollIntoView({ block: "center" }); li.focus({ preventScroll: true }); } catch {}
  if (!s.pv?.busy) s.viz.logiPvJump = false;
}
// the whole picture in place: pressed controls, sentence, dots, legend, Apply, table (the SVG keeps its nodes)
export function refresh(el, s) {
  if (!$(".wv-explorer", el)) return;
  const m = explorerModelFor(s);
  s.viz.m = m;
  const st = vizState(s).st;
  for (const row of el.querySelectorAll(".wv-explorer [data-wv-row]")) {
    const k = row.dataset.wvRow;
    for (const b of row.querySelectorAll("[data-wv-v]")) {
      const v = b.dataset.wvV, on = pressed(st, k, v, m);
      b.setAttribute("aria-pressed", String(on));
      if (k === "rooms") b.disabled = on && st.rooms.length === 1;
    }
  }
  const say = $(".wv-explorer .wv-say", el);
  if (say) { sayInto(say, m.words); fitSay(el); }
  const rs = $(".wv-explorer [data-wv-reasons]", el);
  if (rs) rs.innerHTML = reasonsHTML(s, m);
  const fig = $('[data-wv-fig="explorer"]', el);
  if (fig) draw(fig, s, m);
  const lg = $(".wv-explorer .wv-legend", el);
  if (lg) { lg.outerHTML = legendHTML(legend(m)); fitLegend(el); }
  const acts = $(".wv-explorer [data-wv-acts]", el);
  if (acts) acts.outerHTML = actsHTML(m);
  const lgi = $(".wv-explorer [data-wv-logi]", el);
  if (lgi) { lgi.innerHTML = logiHTML(s, m); lgi.hidden = !m.logi.active; }
  const tbl = $(".wv-explorer .wv-tbl", el);
  if (tbl) tbl.outerHTML = tableHTML(m, tbl.open);
  scheduleReserve(); // round 6 #2: the dots' rows changed with the preview; the strip reserves the tallest again
}
function pressed(st, k, v, m) {
  if (k === "x") return m.xmode.key === v;
  if (k === "band") return v === "all" ? !st.band : st.band === v;
  if (k === "rooms") return st.rooms.includes(v);
  if (k === "famous") return String(!!st.famous) === v;
  if (k === "r45") return String(!!st.r45) === v;
  if (k.startsWith("weight:")) return (st.weights[k.slice(7)] ?? "normal") === v;
  return false;
}
// why.js passes its clicks here first; true = handled
// redraw: redraws every picture on screen that reads the shared state (why.js passes one; default: this picture)
export function explorerClick(el, s, e, redraw = () => refresh(el, s)) {
  const sm = e.target.closest("[data-wv-saymore]");
  if (sm) { // round 6 #1: the cut sentence opens and folds on its own button
    const box = sm.closest(".wv-sayfix"), open = !box.classList.contains("open");
    box.classList.toggle("open", open);
    sm.setAttribute("aria-expanded", String(open));
    sm.textContent = open ? SAY_LESS : SAY_MORE;
    return true;
  }
  const b = e.target.closest(".wv-pic [data-wv-row] [data-wv-v]");
  if (b) {
    if (b.disabled) return true;
    setControl(s, b.closest("[data-wv-row]").dataset.wvRow, b.dataset.wvV);
    runPreview(s, redraw);
    return true;
  }
  const a = e.target.closest("[data-wv-act]");
  if (a) {
    if (a.dataset.wvAct === "apply") applyViz(s).then((ok) => { if (!ok && el.isConnected) redraw(); });
    else (resetViz(s), redraw());
    return true;
  }
  // round 5 #4/#5: a reason or a code (the picture keeps those doors; why.js rings them on the map), Show more, a row's +
  if (!s.viz) return false; // round 5: the drawer opened straight on a door or an area (setWhyDoor, setWhyArea) has no explorer yet; its × and ← Back are not ours
  const lg = (s.viz.logi ??= { fates: [], codes: [] });
  const toggle = (xs, v) => (xs.includes(v) ? xs.filter((x) => x !== v) : [...xs, v]);
  const ft = e.target.closest("[data-wv-fate]");
  if (ft) { lg.fates = toggle(lg.fates, ft.dataset.wvFate); redraw(); el.dispatchEvent(new CustomEvent("whyviz:logi", { detail: { ids: [...(s.viz.m?.logiIds ?? [])] } })); return true; }
  const cd = e.target.closest("[data-wv-code]");
  if (cd) { lg.codes = toggle(lg.codes, cd.dataset.wvCode); redraw(); el.dispatchEvent(new CustomEvent("whyviz:logi", { detail: { ids: [...(s.viz.m?.logiIds ?? [])] } })); return true; }
  const ad = e.target.closest("[data-wv-add]");
  if (ad) { s.viz.logiPvId = ad.dataset.wvAdd; s.viz.logiPvJump = true; el.dispatchEvent(new CustomEvent("whyviz:add", { detail: { ids: [ad.dataset.wvAdd], from: "logi" } })); return true; }
  const lb = e.target.closest("button[data-wv-logi]");
  if (lb) { if (lb.dataset.wvLogi === "more") { s.viz.logiAll = !s.viz.logiAll; redraw(); } return true; }
  return false;
}

// round 6 #2: a dot's rows grow with the controls (an age adds a row, Distance adds a row, a change swaps the fate line),
// so the strip is reserved for every dot's tallest shape: its own rows plus the longest text each optional row can
// carry. The reserve then holds through every filter click (viz-dom.js reserveStrips, a high-water mark).
function tallRows(d, m) {
  if (!d || !m) return null;
  const bandLabel = [...(m.bands ?? []).map((b) => b.label), m.bandLabel ?? ""].sort((a, b) => b.length - a.length)[0] || "55 and over";
  const name = [...(m.dots ?? []).map((x) => x.name ?? ""), d.name ?? ""].sort((a, b) => b.length - a.length)[0];
  return [[name, ""], [`#${m.N} of ${m.N}`, "on Your list"], ["not on this age's list", `for ${bandLabel} drinkers`], ["Everyone knows it", "how well known (Qloo popularity)"], ["4.5", "Qloo rating"], ["99.9 mi, as the crow flies", `from ${m.xmode?.start ?? "Your pin on the map"}`], ["On your plan, Wednesday stop 10", ""], ["Wouldn't qualify with these settings", ""]];
}

// ---------- the picture ----------
const BIG_LINE = 0.9; // Doors' popularity cap (route filter.popularityMax)
function draw(fig, s, m) {
  const w = widthOf(fig, 600);
  const narrow = w < 560;
  const hh = narrow ? 340 : 470;
  const key = `${m.dots.map((d) => d.id).join("|")}@${w}`;
  let g = s.viz.svg;
  if (!g || g.key !== key) { g = build(m, { w, hh, narrow }); g.key = key; s.viz.svg = g; }
  if (g.svg.parentNode !== fig) fig.replaceChildren(g.svg);
  place(g, m, s);
}
// the door portrait's small copy: every other dot small and grey, this door ringed; no axes beyond the two words
export function drawMini(host, m, focus, { hh = 220 } = {}) {
  const w = widthOf(host, 400);
  const g = build(m, { w, hh, narrow: true, mini: true, focus });
  host.replaceChildren(g.svg);
  place(g, m, null);
  return g;
}

function build(m, { w, hh, narrow, mini = false, focus = null }) {
  const mg = mini ? { l: 10, r: 10, t: 10, b: 16 } : narrow ? { l: 30, r: 12, t: 24, b: 44 } : { l: 46, r: 20, t: 26, b: 46 };
  const svg = svgRoot(w, hh, mini ? "This door among every place Qloo ranked: match up, how well known across" : "Every place Qloo ranked for your drinker: match up, the measure you picked across");
  const plotW = w - mg.l - mg.r, plotH = hh - mg.t - mg.b;
  const g = { svg, w, hh, mg, plotW, plotH, narrow, mini, focus, ticks: [], dots: new Map(), labels: new Map() };
  const gAx = svgEl("g", { class: "wv-ax" }, svg);
  if (!mini) {
    for (let i = 0; i < 5; i++) g.ticks.push([svgEl("line", { y1: mg.t, y2: hh - mg.b, stroke: C.line2 }, gAx), svgText(gAx, 0, hh - mg.b + 16, "", { "text-anchor": "middle", fill: C.ink3, "font-size": 11 })]);
    g.xLabel = svgText(gAx, (mg.l + w - mg.r) / 2, hh - 8, "", { "text-anchor": "middle", fill: C.ink3, "font-size": 11.5 });
    g.yLabel = svgText(gAx, 13, (mg.t + hh - mg.b) / 2, "", { "text-anchor": "middle", fill: C.ink3, "font-size": 11.5, transform: `rotate(-90 13 ${(mg.t + hh - mg.b) / 2})` });
    g.notRow = svgEl("line", { x1: mg.l, x2: w - mg.r, y1: hh - mg.b - 24, y2: hh - mg.b - 24, stroke: C.line, opacity: 0 }, gAx);
  }
  g.yTop = svgText(gAx, mg.l + 6, mg.t + 12, "best match", { fill: C.ink3, "font-size": mini ? 10 : 11 });
  g.yBot = svgText(gAx, mg.l + 6, hh - mg.b - 6, "weaker match", { fill: C.ink3, "font-size": mini ? 10 : 11 });
  const gBig = svgEl("g", { class: "wv-bigline" }, svg);
  g.bigLine = svgEl("line", { y1: mg.t, y2: hh - mg.b, stroke: C.big, "stroke-width": 1.25 }, gBig);
  g.bigWash = svgEl("rect", { y: mg.t, height: plotH, fill: C.big, opacity: 0.05 }, gBig);
  g.bigLbl = mini ? null : svgText(gBig, 0, narrow ? mg.t + 26 : mg.t + 12, "", { "text-anchor": "end", fill: C.big, "font-size": 11.5, "font-weight": 600 });
  const gd = svgEl("g", { class: "wv-dots" }, svg);
  g.gd = gd;
  const order = [...m.dots].sort((a, b) => (a.cls === "plan") - (b.cls === "plan") || (a.id === focus) - (b.id === focus));
  for (const d of order) {
    const isF = focus && d.id === focus;
    const o = { id: d.id, isF };
    if (!mini) o.ring = svgEl("circle", { class: "mv wv-ring", r: 9, fill: "none", stroke: C.big, "stroke-width": 1.5, opacity: 0 }, gd);
    o.c = svgEl("circle", { class: "mv wv-dot", r: mini ? (isF ? 6 : 2.6) : 5, fill: C.grey }, gd);
    if (isF) o.focus = svgEl("circle", { class: "mv wv-focus", r: 11, fill: "none", stroke: C.plan, "stroke-width": 1.5 }, gd);
    if (!mini) {
      o.hit = svgEl("circle", { class: "mv wv-hit", r: 12, fill: "transparent", "data-id": d.id }, gd);
      attachTip(o.hit, () => dotRows(g.dotOf(d.id), g.m), { label: d.name });
      stripRows(o.hit, () => tallRows(g.dotOf(d.id), g.m)); // round 6 #2: the strip reserves the rows' tallest shape, whatever the controls say
      o.hit.addEventListener("pointerenter", () => o.c.setAttribute("r", 7));
      o.hit.addEventListener("pointerleave", () => o.c.setAttribute("r", o.r ?? 5));
      o.hit.addEventListener("click", () => svg.closest(".whyp")?.dispatchEvent(new CustomEvent("whymap:door", { detail: { id: d.id } })));
      o.hit.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") (e.preventDefault(), o.hit.click()); });
    }
    g.dots.set(d.id, o);
  }
  g.gl = svgEl("g", { class: "wv-labels" }, svg);
  return g;
}

function place(g, m, s) {
  g.m = m;
  const byId = new Map(m.dots.map((d) => [d.id, d]));
  g.dotOf = (id) => byId.get(id);
  const { mg, plotW, plotH, hh, w, narrow, mini } = g;
  const md = m.xmode;
  const [a, b] = md.dom;
  const xv = (d) => { const v = md.key === "pop" ? d.pop : md.key === "rating" ? d.rating : d.km; const x = Number.isFinite(v) ? v : md.key === "rating" ? a : md.key === "km" ? a : 0; return mg.l + ((x - a) / (b - a)) * plotW; };
  const ys = m.dots.map((d) => d.score).filter(Number.isFinite);
  const yMin = Math.min(...ys) - 0.004, yMax = Math.max(...ys) + 0.004;
  const yv = (d) => (!m.band ? mg.t + (1 - ((d.score ?? yMin) - yMin) / (yMax - yMin || 1)) * plotH : d.bandRank ? mg.t + ((d.bandRank - 1) / Math.max(1, (d.bandOf ?? 1) - 1)) * (plotH - 34) : hh - mg.b - 10);
  const R = mini ? { plan: 3, list: 2.6, off: 2.6, out: 2.4, big: 2.6 } : { plan: 6, list: 5, off: 4, out: 4, big: 5 };
  for (const d of m.dots) {
    const o = g.dots.get(d.id);
    if (!o) continue;
    const x = xv(d), y = yv(d);
    const hidden = md.key === "km" && !Number.isFinite(d.km);
    for (const n of [o.c, o.hit, o.ring, o.focus]) if (n) setAttrs(n, { cx: x, cy: y });
    if (mini) {
      setAttrs(o.c, { fill: o.isF ? C.plan : d.cls === "big" ? C.big : C.grey, stroke: "none", opacity: o.isF ? 1 : hidden ? 0 : 0.55, r: o.isF ? 6 : 2.6 });
      continue;
    }
    const st = d.cls === "plan" ? { fill: C.plan, stroke: "none", "stroke-width": 0 } : d.cls === "list" ? { fill: C.paper, stroke: C.plan, "stroke-width": 2 } : d.cls === "big" ? { fill: C.big, stroke: "none", "stroke-width": 0 } : { fill: C.grey, stroke: "none", "stroke-width": 0 };
    o.r = R[d.cls] ?? 4;
    setAttrs(o.c, { ...st, r: o.r, opacity: hidden ? 0 : m.logiIds && !m.logiIds.has(d.id) ? (d.cls === "plan" ? 0.3 : 0.12) : d.faded ? 0.35 : 1 });
    setAttrs(o.ring, { opacity: d.cls === "off" && !hidden ? 1 : 0 });
    o.hit.style.pointerEvents = hidden ? "none" : "";
    o.hit.setAttribute("aria-label", dotRows(d, m).map((r) => r.filter(Boolean).join(" ")).join(" · "));
  }
  g.gd.setAttribute("opacity", m.busy ? 0.55 : 1);
  // the big-names line and wash: only when x is how well known
  const pop = md.key === "pop";
  const bx = pop ? mg.l + BIG_LINE * plotW : -1000;
  setAttrs(g.bigLine, { x1: bx, x2: bx, opacity: pop ? 1 : 0 });
  setAttrs(g.bigWash, { x: bx, width: plotW * (1 - BIG_LINE), opacity: pop ? 0.05 : 0 });
  if (g.bigLbl) { setAttrs(g.bigLbl, { x: bx - 6, opacity: pop ? 1 : 0 }); g.bigLbl.textContent = m.famousOn ? (narrow ? "Most popular, included" : "Most popular, included") : narrow ? "Most popular, for later" : "Most popular, left for later"; }
  // axes
  if (!mini) {
    const ticks = narrow ? md.short : md.ticks;
    g.ticks.forEach(([ln, t], i) => {
      const tk = ticks[i];
      if (!tk) { ln.setAttribute("opacity", 0); t.textContent = ""; return; }
      const x = mg.l + ((tk[0] - a) / (b - a)) * plotW;
      setAttrs(ln, { x1: x, x2: x, opacity: 1 });
      setAttrs(t, { x, "text-anchor": i === 0 ? "start" : i === ticks.length - 1 ? "end" : "middle" });
      t.textContent = tk[1];
    });
    g.xLabel.textContent = narrow ? md.shortLabel ?? md.label : md.label;
    g.yLabel.textContent = !m.band ? `Match for ${m.who} →` : `Rank for ${m.bandLabel} ${m.who} (#1 at the top) →`;
    g.notRow.setAttribute("opacity", m.band ? 1 : 0);
  }
  g.yTop.textContent = !m.band ? "best match" : "#1";
  g.yBot.textContent = !m.band ? "weaker match" : "not on this age's list";
  g.yBot.setAttribute("y", !m.band ? hh - mg.b - 6 : hh - mg.b - 28);
  // direct labels: the #1 door, the rep's contacts, the best big name, and the doors the sentence names
  if (!mini) labels(g, m, xv, yv);
}

function labels(g, m, xv, yv) {
  const { narrow, mg, plotW } = g;
  const want = new Map();
  const add = (d) => d && want.set(d.id, d);
  if (!narrow || !m.hasChange) add(m.top);
  if (!narrow) { for (const d of m.dots) if (d.contact) add(d); if (!m.famousOn) add([...m.dots].filter((d) => d.famous).sort((a, b) => b.score - a.score)[0]); }
  for (const d of m.planOut.slice(0, 3)) add(d);
  for (const d of m.planIn.slice(0, 3)) add(d);
  for (const d of m.listIn.slice(0, 3)) add(d);
  for (const [id, t] of g.labels) if (!want.has(id)) (t.remove(), g.labels.delete(id));
  const placed = [];
  for (const d of [...want.values()].sort((p, q) => yv(p) - yv(q))) {
    let t = g.labels.get(d.id);
    if (!t) { t = svgText(g.gl, 0, 0, "", { fill: C.ink, "font-size": narrow ? 11 : 12, "font-weight": 600, class: "wv-lbl-t" }); g.labels.set(d.id, t); }
    const text = d.listRank ? `${d.name} · #${d.listRank}` : d.name;
    const est = text.length * (narrow ? 6.2 : 6.8); // the label's width, near enough: it flips left when it wouldn't fit
    const x = xv(d), left = x > mg.l + plotW * 0.78 || x + 11 + est > g.w - mg.r;
    let y = yv(d) + 4;
    for (const p of placed) if (p.left === left && Math.abs(p.y - y) < 13) y = p.y + 13;
    placed.push({ left, y });
    t.textContent = text;
    setAttrs(t, { x: x + (left ? -11 : 11), y, "text-anchor": left ? "end" : "start", opacity: (m.xmode.key === "km" && !Number.isFinite(d.km)) || d.faded || (m.logiIds && !m.logiIds.has(d.id)) ? 0 : 1 });
  }
}
