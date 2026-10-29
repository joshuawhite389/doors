// WHY-VIZ-SPEC §4.6 The list by age, drawn (Deep Dive, under pictures 4 and 5): the sentence, the age row (picture 1's
// control, one state), the bump chart from lib/whyviz/bump.js, Apply / Reset, the source line and the table twin.
// Picking a band highlights its column, rewrites the sentence and runs the same preview picture 1 draws from.
import { $, esc } from "../dom.js";
import { svgEl, svgText, svgRoot, setAttrs, COLOURS as C, attachTip, stripHTML, sayHTML, sayInto, sourceHTML, tableTwinHTML, segRowHTML, widthOf } from "../viz-dom.js";
import { bumpModel, bumpRows, BUMP_DOORS, BUMP_DOORS_PHONE } from "../../lib/whyviz/bump.js";
import { vizState } from "./state.js";
import { explorerModelFor, actsHTML } from "./explorer.js";

export const BUMP_LABEL = "The list by age";
const SRC_LINE = "Qloo: the drinker's list re-ranked for each age band (every ranked door's place on that band's page). Pick a band here or on the first picture: it is one setting.";
const narrowOf = (el) => widthOf(el, 600) < 560;

export function bumpModelFor(s, el = null) {
  const n = (el?.nodeType ? narrowOf(el) : el?.narrow) ? BUMP_DOORS_PHONE : BUMP_DOORS;
  return bumpModel({ plan: s.ctx.plan, routes: s.ctx.routes ?? [], profile: s.ctx.profile, sv: s.m.sv, n, cityName: s.ctx.plan.city?.name });
}

export function bumpHTML(s, el = null) {
  const m = bumpModelFor(s, el);
  const st = vizState(s).st;
  if (!m.bands.length || !m.series.length) return "";
  const em = explorerModelFor(s);
  return `<section class="wv-pic wv-bump" aria-label="${esc(BUMP_LABEL)}">
    <h5 class="wv-h">${esc(BUMP_LABEL)}</h5>
    ${sayHTML(m.words(st.band))}
    ${segRowHTML("band", "Your drinkers' age", [{ v: "all", text: "All ages", on: !st.band }, ...m.bands.map((b) => ({ v: b.key, text: b.label, on: st.band === b.key }))])}
    <div class="wv-fig" data-wv-fig="bump"></div>
    ${stripHTML("Hover or tap a dot: the door's rank for that age.")}
    ${actsHTML(em)}
    ${sourceHTML(SRC_LINE)}
    ${tableHTML(m)}
  </section>`;
}
function tableHTML(m, open = false) {
  return tableTwinHTML({ cols: ["Door", "All ages", ...m.bands.map((b) => b.label)], rows: m.series.map((s) => [s.name, `#${s.listRank} of ${m.listN}`, ...m.bands.map((b) => (s.ranks[b.key] ? `#${s.ranks[b.key].rank} of ${s.ranks[b.key].of}` : "not on the list"))]), summary: `The numbers behind it: your ${m.series.length} best doors by age`, open });
}

export function bumpMount(el, s) {
  const fig = $('[data-wv-fig="bump"]', el);
  if (!fig) return;
  const m = bumpModelFor(s, el);
  draw(fig, s, m);
}
// in place after a band change or a preview: the pressed button, the sentence, the column, Apply, the table
export function bumpRefresh(el, s) {
  const sec = $(".wv-bump", el);
  if (!sec) return;
  const st = vizState(s).st;
  const m = bumpModelFor(s, el);
  for (const b of sec.querySelectorAll('[data-wv-row="band"] [data-wv-v]')) b.setAttribute("aria-pressed", String(b.dataset.wvV === "all" ? !st.band : st.band === b.dataset.wvV));
  const say = $(".wv-say", sec);
  if (say) sayInto(say, m.words(st.band));
  const g = s.viz.bump;
  if (g?.svg?.isConnected) g.setBand(st.band);
  else { const fig = $('[data-wv-fig="bump"]', sec); if (fig) draw(fig, s, m); }
  const acts = $("[data-wv-acts]", sec);
  if (acts) acts.outerHTML = actsHTML(explorerModelFor(s));
}

function draw(fig, s, m) {
  const w = widthOf(fig, 600);
  const narrow = w < 560;
  const key = `${m.series.map((x) => x.id).join("|")}@${w}`;
  let g = s.viz.bump;
  if (!g || g.key !== key) { g = build(m, { w, narrow }); g.key = key; s.viz.bump = g; }
  if (g.svg.parentNode !== fig) fig.replaceChildren(g.svg);
  g.setBand(vizState(s).st.band);
}

function build(m, { w, narrow }) {
  const cols = [{ key: "all", label: "All ages" }, ...m.bands];
  const hh = narrow ? 380 : 480;
  const mg = { l: narrow ? 120 : 236, r: narrow ? 16 : 40, t: 34, b: 44 };
  const cw = (w - mg.l - mg.r) / Math.max(1, cols.length - 1);
  const X = (j) => mg.l + j * cw;
  const bottom = hh - mg.b;
  const Y = (rank) => (rank == null ? bottom : mg.t + ((rank - 1) / Math.max(1, m.maxRank - 1)) * (bottom - mg.t - 36));
  const svg = svgRoot(w, hh, "Where your best doors rank for each age of drinker");
  const colEls = cols.map((c, j) => {
    const gc = svgEl("g", {}, svg);
    svgEl("rect", { x: X(j) - cw / 2 + 6, y: mg.t - 24, width: Math.max(10, cw - 12), height: hh - mg.t + 24 - 12, rx: 10, fill: C.bg, opacity: 0 }, gc);
    svgText(gc, X(j), mg.t - 12, narrow && c.key !== "all" ? c.label.replace(" and over", "+") : c.label, { "text-anchor": "middle", fill: C.ink, "font-size": narrow ? 11 : 12.5, "font-weight": 700 });
    svgEl("line", { x1: X(j), x2: X(j), y1: mg.t, y2: bottom - 36, stroke: C.line2 }, gc);
    return gc;
  });
  svgText(svg, mg.l, bottom + 3, "not on that list", { "text-anchor": narrow ? "start" : "middle", fill: C.ink3, "font-size": 11 });
  svgEl("line", { x1: X(0) - 20, x2: X(cols.length - 1) + 20, y1: bottom - 16, y2: bottom - 16, stroke: C.line }, svg);
  svgText(svg, 12, mg.t, "#1", { fill: C.ink3, "font-size": 11 });
  svgText(svg, 12, bottom - 40, `#${m.maxRank}`, { fill: C.ink3, "font-size": 11 });
  const gl = svgEl("g", {}, svg), gd = svgEl("g", {}, svg);
  const series = [];
  const lys = m.series.map((d) => Y(d.listRank));
  for (let k = 1; k < lys.length; k++) lys[k] = Math.max(lys[k], lys[k - 1] + 14);
  m.series.forEach((d, i) => {
    const ranks = cols.map((c) => d.ranks[c.key]?.rank ?? null);
    const pts = ranks.map((r, j) => [X(j), Y(r)]);
    const line = svgEl("polyline", { points: pts.map((p) => p.join(",")).join(" "), fill: "none", stroke: C.plan, "stroke-width": 2, "stroke-linejoin": "round", opacity: 0.5 }, gl);
    const dots = pts.map(([x, y], j) => svgEl("circle", { cx: x, cy: y, r: ranks[j] == null ? 3 : 5, fill: ranks[j] == null ? C.grey : C.plan, stroke: C.paper, "stroke-width": 2 }, gd));
    svgEl("line", { x1: X(0) - 26, y1: lys[i], x2: X(0) - 4, y2: Y(d.listRank), stroke: C.line, "stroke-width": 1 }, gl);
    const name = narrow && d.name.length > 18 ? `${d.name.slice(0, 17)}…` : d.name;
    const lbl = svgText(gd, X(0) - 30, lys[i] + 4, name, { "text-anchor": "end", fill: C.ink, "font-size": narrow ? 10.5 : 11.5, "font-weight": 600 });
    pts.forEach(([x, y], j) => {
      const hit = svgEl("circle", { cx: x, cy: y, r: 13, fill: "transparent", class: "wv-hit" }, gd);
      attachTip(hit, () => bumpRows(d, cols[j].key, m), { label: bumpRows(d, cols[j].key, m).map((r) => r.filter(Boolean).join(" ")).join(" · ") });
      hit.addEventListener("pointerenter", () => focusOn(i));
      hit.addEventListener("pointerleave", () => focusOn(null));
      hit.addEventListener("focus", () => focusOn(i));
      hit.addEventListener("blur", () => focusOn(null));
      hit.addEventListener("click", () => svg.closest(".whyp")?.dispatchEvent(new CustomEvent("whymap:door", { detail: { id: d.id } })));
    });
    series.push({ d, ranks, line, dots, lbl });
  });
  function focusOn(i) {
    series.forEach((s, k) => {
      const on = i == null || i === k;
      setAttrs(s.line, { opacity: i == null ? 0.5 : on ? 1 : 0.1, "stroke-width": on && i != null ? 3 : 2 });
      s.dots.forEach((c) => c.setAttribute("opacity", on ? 1 : 0.15));
      s.lbl.setAttribute("opacity", on ? 1 : 0.25);
    });
  }
  const g = { svg, w, series };
  g.setBand = (key) => { const j = cols.findIndex((c) => c.key === (key ?? "all")); colEls.forEach((gc, k) => gc.firstChild.setAttribute("opacity", k === j && key ? 1 : 0)); };
  return g;
}
