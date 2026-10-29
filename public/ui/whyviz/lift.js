// WHY-VIZ-SPEC §4.3: picture 3, drawn as SVG from lib/whyviz/lift.js at the top of the Who view. One row per group:
// the label, a track from 0 to the widest share, a grey tick at the city's share, a dot at the plan's share, the bar
// between them (green when more than the city, grey when less, muted rows faded), and the lift on the right. Hover or
// focus a row: the counts and the base (ui/viz-dom.js tooltip); the table twin has every number. The phone keeps the
// rows with lift ≥ 1.5 or ≤ 0.6 (spec §5).
import { esc } from "../dom.js";
import { COLOURS, attachTip, stripHTML, sayHTML, tableTwinHTML, sourceHTML, widthOf } from "../viz-dom.js";
import { liftLabel, PHONE_KEEP } from "../../lib/whyviz/lift.js";
import { liftWords } from "../../lib/whyviz/words.js";

export const LIFT_TITLE = "Who is in the room, against the city";
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const pct = (x) => `${Math.round(x * 100)}%`;

// mountLift(host, m, {narrow}) → fills the host (idempotent: redraws from the model each time)
export function mountLift(host, m, { narrow = false } = {}) {
  if (!host || !m) return;
  host.classList.add("wv-lift");
  const rows = narrow ? m.rows.filter(PHONE_KEEP) : m.rows;
  const W = Math.max(320, Math.min(640, widthOf(host, 600))), L = narrow ? 122 : 170, R = narrow ? 62 : 108, RH = narrow ? 26 : 28, T = 10;
  const H = T + rows.length * RH + 24;
  const max = Math.max(0.05, ...rows.flatMap((r) => [r.share, r.base]));
  const X = (v) => L + (v / max) * (W - L - R);
  const svg = rows.length ? `<svg viewBox="0 0 ${W} ${H}" width="100%" class="wv-svg" role="group" aria-label="${esc(LIFT_TITLE)}">
    <line x1="${X(0)}" x2="${X(0)}" y1="${T}" y2="${H - 22}" stroke="${COLOURS.line}"/>
    ${rows.map((r, i) => {
      const y = T + i * RH + RH / 2, a = X(r.base), b = X(r.share), more = r.share > r.base;
      const col = r.muted ? COLOURS.grey : more ? COLOURS.plan : COLOURS.grey2;
      return `<g class="wv-lift-row${r.muted ? " muted" : ""}" data-key="${esc(r.key)}" tabindex="0" role="img" aria-label="${esc(`${r.label}: ${r.n} of ${m.n} plan doors, ${pct(r.base)} of ${m.cityName}, ${liftLabel(r)}`)}">
        <rect x="0" y="${y - RH / 2}" width="${W}" height="${RH}" fill="transparent"/>
        <text x="${L - 10}" y="${y + 4}" text-anchor="end" font-size="${narrow ? 11.5 : 12.5}" fill="${r.muted ? COLOURS.ink3 : COLOURS.ink}" font-weight="${r.muted ? 400 : 600}">${esc(narrow && r.label.length > 16 ? `${r.label.slice(0, 15).trim()}…` : r.label)}</text>
        <line x1="${Math.min(a, b)}" x2="${Math.max(a, b)}" y1="${y}" y2="${y}" stroke="${col}" stroke-width="${r.muted ? 3 : 5}" stroke-linecap="round" opacity="${r.muted ? 0.5 : 0.9}"/>
        <line x1="${a}" x2="${a}" y1="${y - 7}" y2="${y + 7}" stroke="${COLOURS.grey2}" stroke-width="2"/>
        <circle cx="${b}" cy="${y}" r="${r.muted ? 4 : 6}" fill="${r.muted ? COLOURS.grey : more ? COLOURS.plan : COLOURS.paper}" stroke="${r.muted ? COLOURS.paper : more ? COLOURS.paper : COLOURS.grey2}" stroke-width="2"/>
        <text x="${W - R + 10}" y="${y + 4}" font-size="${narrow ? 12 : 13}" font-weight="700" fill="${r.muted ? COLOURS.ink3 : more ? COLOURS.plan : COLOURS.ink2}">${esc(liftLabel(r))}</text>
      </g>`;
    }).join("")}
    <g font-size="11" fill="${COLOURS.ink3}"><text x="${L}" y="${H - 6}">0% of doors</text><text x="${W - R}" y="${H - 6}" text-anchor="end">${esc(pct(max))}</text></g>
    <g font-size="11" fill="${COLOURS.ink3}"><circle cx="${L + 6}" cy="${T - 4}" r="0"/></g>
  </svg>` : ""; // no rows: liftWords says so once (round 5 #1: it was said twice)
  host.innerHTML = `<h4 class="wv-h">${esc(LIFT_TITLE)}</h4>${sayHTML(liftWords(m))}
    ${rows.length ? `<div class="wv-lift-key"><span><i class="dot"></i>your plan's doors</span><span><i class="tick"></i>${esc(m.cityName)}, every door Doors holds</span>${narrow && rows.length < m.rows.length ? `<span>${m.rows.length - rows.length} rows about the city left out on the phone</span>` : ""}</div>` : ""}
    ${svg}
    ${rows.length ? stripHTML("Hover or tap a row: the counts behind it.") : ""}
    ${m.rows.length ? tableTwinHTML({ cols: ["Group", "Your plan", "Share", m.cityName, "Share", "Lift"], rows: m.rows.map((r) => [r.label, `${r.n} of ${m.n}`, pct(r.share), `${Math.round(r.base * m.baseN)} of ${m.baseN}`, pct(r.base), liftLabel(r)]) }) : ""}
    ${sourceHTML(m.baseN ? `Qloo's crowd description on each door (customer_demographics_description), counted over your plan's ${plural(m.n, "door")} and over the ${plural(m.baseN, "door")} Qloo describes in ${m.cityName}. A group within 0.8–1.25× the city reads "about the city" and is never a talking point.` : `Qloo's crowd description on each door (customer_demographics_description). Doors holds no described ${m.cityName} doors to count against yet.`)}`;
  for (const g of host.querySelectorAll(".wv-lift-row")) {
    const r = m.rows.find((x) => x.key === g.dataset.key);
    if (r) attachTip(g, () => [[r.label, r.muted ? "about the city: not worth saying" : r.dir === "more" ? "more than the city" : "less than the city"], [`${r.n} of ${m.n} plan doors`, `${pct(r.share)} name it`], [`${Math.round(r.base * m.baseN)} of ${m.baseN} ${m.cityName} doors`, `${pct(r.base)} name it`], [liftLabel(r), "the lift"]], { label: g.getAttribute("aria-label") });
  }
}
