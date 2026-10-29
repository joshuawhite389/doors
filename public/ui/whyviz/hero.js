// WHY-VIZ-SPEC §6 the landing hero, drawn: picture 1 from lib/whyviz/hero.js's model, still, with two labels (the #1 door
// and the big-names line), the axis words and nothing else. Hover any dot for its name and words (a title; the landing
// has no tooltip layer). drawHero(host, m): fills host with one SVG at host's width; call again on resize.
import { svgEl, svgText, svgRoot, COLOURS as C, widthOf } from "../viz-dom.js";
import { popWords } from "../../lib/core.js";
import { ordinal } from "../../lib/whyviz/words.js";

export function drawHero(host, m, { w = widthOf(host, 640), h = Math.max(220, host?.clientHeight || 0) || 360 } = {}) {
  const k = Math.max(0.9, Math.min(2.2, w / 640)); // type scales with the picture (the lead image is drawn at 1500 px)
  const fs = (n) => Math.round(n * k * 10) / 10;
  const mg = { l: 14 * k, r: 14 * k, t: 34 * k, b: 30 * k };
  const svg = svgRoot(w, h, `Every place Qloo ranked for ${m.who} in ${m.city}: match up, how well known across. ${m.labels.top}. ${m.labels.big}.`);
  svg.setAttribute("class", "wv-svg hero-svg");
  const plotW = w - mg.l - mg.r, plotH = h - mg.t - mg.b;
  const ys = m.dots.map((d) => d.score);
  const yMin = Math.min(...ys) - 0.004, yMax = Math.max(...ys) + 0.004;
  const xv = (d) => mg.l + d.pop * plotW;
  const yv = (d) => mg.t + (1 - (d.score - yMin) / (yMax - yMin || 1)) * plotH;
  // axes: words only (spec rule 2: no decimals on a first view)
  const ax = svgEl("g", { class: "wv-ax" }, svg);
  svgEl("line", { x1: mg.l, x2: w - mg.r, y1: h - mg.b + 0.5, y2: h - mg.b + 0.5, stroke: C.line }, ax);
  svgText(ax, mg.l, h - mg.b + 16 * k, "unknown", { fill: C.ink3, "font-size": fs(11) });
  svgText(ax, w - mg.r, h - mg.b + 16 * k, "everyone knows it", { fill: C.ink3, "font-size": fs(11), "text-anchor": "end" });
  svgText(ax, (mg.l + w - mg.r) / 2, h - mg.b + 16 * k, "how well known →", { fill: C.ink3, "font-size": fs(11), "text-anchor": "middle" });
  svgText(ax, mg.l + 4 * k, mg.t - 10 * k, w < 480 ? "best match ↑" : `best match for ${m.who} ↑`, { fill: C.ink3, "font-size": fs(11) });
  // the big-names line and wash
  const bx = mg.l + m.bigLine * plotW;
  svgEl("rect", { x: bx, y: mg.t, width: plotW * (1 - m.bigLine), height: plotH, fill: C.big, opacity: 0.06 }, svg);
  svgEl("line", { x1: bx, x2: bx, y1: mg.t, y2: h - mg.b, stroke: C.big, "stroke-width": 1.25 * k }, svg);
  // dots: the plan's on top
  const gd = svgEl("g", { class: "wv-dots" }, svg);
  const order = [...m.dots].sort((a, b) => ({ out: 0, big: 1, list: 2, plan: 3 }[a.cls] - { out: 0, big: 1, list: 2, plan: 3 }[b.cls]));
  const R = { plan: 5.5 * k, list: 4.5 * k, big: 4.5 * k, out: 3.5 * k };
  for (const d of order) {
    const st = d.cls === "plan" ? { fill: C.plan } : d.cls === "list" ? { fill: C.paper, stroke: C.plan, "stroke-width": 1.75 * k } : d.cls === "big" ? { fill: C.big } : { fill: C.grey };
    const c = svgEl("circle", { class: `wv-dot ${d.cls}`, cx: xv(d).toFixed(1), cy: yv(d).toFixed(1), r: R[d.cls], ...st }, gd);
    const t = svgEl("title", {}, c);
    t.textContent = `${d.name}${d.listRank ? ` · #${d.listRank} of ${m.N} on Your list` : d.cls === "big" ? " · one of the most popular, left for later" : ""} · ${popWords(d.pop)}`;
  }
  // the two labels: the big-names line's, above the plot so it never crosses a dot; the #1 door's, under its ring
  const gl = svgEl("g", { class: "wv-labels" }, svg);
  svgText(gl, bx - 4 * k, mg.t - 10 * k, w < 480 ? "Most popular, left for later" : m.labels.big, { fill: C.big, "font-size": fs(12), "font-weight": 600, "text-anchor": "end" });
  if (m.top) {
    const d = m.dots.find((x) => x.id === m.top.id);
    if (d) {
      const x = xv(d), y = yv(d);
      svgEl("circle", { class: "wv-focus", cx: x.toFixed(1), cy: y.toFixed(1), r: 10 * k, fill: "none", stroke: C.plan, "stroke-width": 1.5 * k }, gl);
      const left = x > mg.l + plotW * 0.55;
      const below = y < mg.t + plotH * 0.5; // the #1 door sits near the top: its lines go under the ring, never off the picture
      const lines = [[m.top.name, 13, 700], [`#1 of ${m.N} for ${m.who}`, 12, 500], ...(m.top.popRank ? [[`${ordinal(m.top.popRank)} most popular on Your list`, 12, 500]] : [])];
      const step = 15 * k;
      lines.forEach(([t, size, weight], i) => svgText(gl, x + (left ? -15 * k : 15 * k), below ? y + 20 * k + i * step : y - 16 * k - (lines.length - 1 - i) * step, t, { fill: C.ink, "font-size": fs(size), "font-weight": weight, "text-anchor": left ? "end" : "start", class: "wv-lbl" }));
    }
  }
  host.replaceChildren(svg);
  return svg;
}
