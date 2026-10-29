// WHY-VIZ-SPEC §6 Your list rows, drawn: the strip from lib/whyviz/strip.js as an SVG string (plan.js builds its rows
// as HTML, so this returns markup, not nodes). Its words are in the SVG's title and aria-label; the row's own lines
// carry everything else, so hover gates nothing (spec rule 7).
import { esc } from "../dom.js";
import { COLOURS as C } from "../viz-dom.js";

export function stripSVG(m, { w = 120, h = 16 } = {}) {
  const l = 5, r = w - 5, span = r - l;
  const tx = l + m.tick * span;
  const dot = m.x == null ? "" : (() => {
    const cx = l + m.x * span, cy = h / 2;
    const st = m.cls === "plan" ? `fill="${C.plan}"` : m.cls === "list" ? `fill="${C.paper}" stroke="${C.plan}" stroke-width="1.75"` : m.cls === "big" ? `fill="${C.big}"` : `fill="${C.grey}"`;
    return `<circle cx="${cx.toFixed(1)}" cy="${cy}" r="4.5" ${st}/>`;
  })();
  return `<svg class="lstrip" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(m.text)}"><title>${esc(m.text)}</title><line x1="${l}" x2="${r}" y1="${h / 2}" y2="${h / 2}" stroke="${C.line}" stroke-width="1"/><line x1="${tx.toFixed(1)}" x2="${tx.toFixed(1)}" y1="2" y2="${h - 2}" stroke="${C.big}" stroke-width="1.25"/>${dot}</svg>`;
}
