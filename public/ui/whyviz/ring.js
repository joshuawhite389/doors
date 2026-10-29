// WHY-VIZ-SPEC §4.4: picture 4, drawn as SVG from lib/whyviz/ring.js at the top of the Deep Dive view. Midnight at
// the top, noon at the bottom. Outer band: Qloo's day parts over the plan's doors, opacity by count, labelled
// "Evening 22". Inside: one thin arc per door of the selected day (green inside the window, grey outside); a closed
// door is listed, not drawn. Centre: the window wedge and "You're out · Tue 1 pm–6 pm". Day tabs above; beside it
// (desktop) or below (phone) the day's doors in opening order. Hover or focus an arc: name, hours, open while you're
// out or not. The drawer (ui/why.js) owns the day state (data-wv-day) and remounts.
import { esc } from "../dom.js";
import { COLOURS, attachTip, stripHTML, sayHTML, tableTwinHTML, sourceHTML } from "../viz-dom.js";
import { PARTS, clock } from "../../lib/whyviz/ring.js";
import { ringWords } from "../../lib/whyviz/words.js";

export const RING_TITLE = "When these doors fill, and when you're there";
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const TAU = Math.PI * 2;
export const ang = (min) => ((((min % 1440) + 1440) % 1440) / 1440) * TAU - Math.PI / 2;
export const pt = (c, r, a) => [c + r * Math.cos(a), c + r * Math.sin(a)];
// an arc path from minute f to minute t at radius r (clockwise; never more than a full turn)
export function arc(c, r, f, t) { // exported: the door portrait's one-door ring (ui/whyviz/portrait.js)
  const span = Math.min(1440, Math.max(0, t - f));
  if (span <= 0) return "";
  if (span >= 1440) return `M${pt(c, r, ang(f)).join(",")} A${r},${r} 0 1 1 ${pt(c, r, ang(f) + Math.PI).join(",")} A${r},${r} 0 1 1 ${pt(c, r, ang(f)).join(",")}`;
  const a0 = ang(f), a1 = a0 + (span / 1440) * TAU;
  return `M${pt(c, r, a0).map((v) => v.toFixed(1)).join(",")} A${r},${r} 0 ${span > 720 ? 1 : 0} 1 ${pt(c, r, a1).map((v) => v.toFixed(1)).join(",")}`;
}
export function wedge(c, r, f, t) {
  const span = Math.min(1440, Math.max(0, t - f));
  const a0 = ang(f), a1 = a0 + (span / 1440) * TAU;
  return `M${c},${c} L${pt(c, r, a0).map((v) => v.toFixed(1)).join(",")} A${r},${r} 0 ${span > 720 ? 1 : 0} 1 ${pt(c, r, a1).map((v) => v.toFixed(1)).join(",")} Z`;
}

// mountRing(host, m, {narrow}) → fills the host; day tabs carry data-wv-day for the owner's click handler
export function mountRing(host, m, { narrow = false } = {}) {
  if (!host || !m) return;
  host.classList.add("wv-ring");
  // the ring is S wide; the part labels sit outside it, so the drawing is M wider on each side
  const S = narrow ? 300 : 340, M = narrow ? 60 : 76, c = S / 2, R = c - 22, band = 16, gap = 5, inner = R - band - 10;
  const cx = c + M; // the ring's centre in the drawing (x); y stays c
  const parts = m.parts.map((p) => {
    const op = m.n ? 0.12 + 0.78 * (p.n / m.n) : 0.12;
    const mid = ang((p.from + p.to) / 2), [lx, ly] = pt(c, R + 14, mid);
    return `<g class="wv-ring-part" data-part="${esc(p.key)}" tabindex="0" role="img" aria-label="${esc(`${p.label}: Qloo tags ${p.n} of your ${m.n} doors`)}">
      <path d="${arc(c, R - band / 2, p.from, p.to)}" stroke="${COLOURS.plan}" stroke-width="${band}" fill="none" opacity="${op.toFixed(2)}" stroke-linecap="butt"/>
      <path d="${arc(c, R - band / 2, p.from, p.to)}" stroke="transparent" stroke-width="${band + 8}" fill="none"/>
      <text x="${lx.toFixed(1)}" y="${(ly + 4).toFixed(1)}" text-anchor="${Math.cos(mid) > 0.3 ? "start" : Math.cos(mid) < -0.3 ? "end" : "middle"}" font-size="${narrow ? 11 : 12}" font-weight="600" fill="${COLOURS.ink}">${esc(p.label)} ${p.n}</text>
    </g>`;
  }).join("");
  const drawn = m.arcs.filter((a) => a.state !== "closed" && a.state !== "unknown");
  const step = drawn.length ? Math.min(gap + 2, (inner - 70) / Math.max(1, drawn.length)) : gap;
  const doorArcs = drawn.map((a, i) => {
    const r = inner - i * step;
    const w = m.day;
    const segs = a.spans.flatMap((sp) => {
      const f = Math.max(0, sp.from), t = Math.min(sp.to, f + 1440);
      const o0 = Math.max(f, w.from), o1 = Math.min(t, w.to);
      const out = [];
      if (o1 > o0) { if (o0 > f) out.push([f, o0, false]); out.push([o0, o1, true]); if (t > o1) out.push([o1, t, false]); } else out.push([f, t, false]);
      return out;
    });
    return `<g class="wv-ring-door s-${a.state}" data-id="${esc(a.id)}" tabindex="0" role="img" aria-label="${esc(`${a.name}: ${a.hours ?? "hours unverified"} ${m.day.day}; ${a.open > 0 ? "open while you're out" : "not open while you're out"}`)}">
      ${segs.map(([f, t, on]) => `<path d="${arc(c, r, f, t)}" stroke="${on ? COLOURS.plan : COLOURS.grey}" stroke-width="${on ? 3 : 2}" fill="none" stroke-linecap="round" opacity="${on ? 0.95 : 0.8}"/>`).join("")}
      <path d="${arc(c, r, Math.max(0, Math.min(...a.spans.map((s) => s.from))), Math.min(1440 + Math.max(0, Math.min(...a.spans.map((s) => s.from))), Math.max(...a.spans.map((s) => s.to))))}" stroke="transparent" stroke-width="7" fill="none"/>
    </g>`;
  }).join("");
  const w = m.day;
  const centre = w ? `<path d="${wedge(c, inner - drawn.length * step - 6, w.from, w.to)}" fill="${COLOURS.soft}" stroke="${COLOURS.plan}" stroke-width="1.5" opacity=".9"/>
    <text x="${c}" y="${c - 4}" text-anchor="middle" font-size="12" fill="${COLOURS.ink2}">You're out</text><text x="${c}" y="${c + 14}" text-anchor="middle" font-size="13" font-weight="700" fill="${COLOURS.ink}">${esc(`${w.label.split(" ")[0].slice(0, 3)} ${w.label.split(" ").slice(1).join(" ")}`)}</text>` : "";
  const ticks = [0, 360, 720, 1080].map((mn) => { const [x, y] = pt(c, R + 2, ang(mn)); const [x2, y2] = pt(c, R - band - 2, ang(mn)); return `<line x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${COLOURS.paper}" stroke-width="2"/>`; }).join("");
  const hourLabels = [[0, "midnight"], [720, "noon"]].map(([mn, t]) => { const [x, y] = pt(c, R - band - 22, ang(mn)); return `<text x="${x.toFixed(1)}" y="${(y + (mn ? 10 : 2)).toFixed(1)}" text-anchor="middle" font-size="10.5" fill="${COLOURS.ink3}">${t}</text>`; }).join("");
  const tabs = m.days.length ? `<div class="wv-ring-tabs" role="tablist" aria-label="Day">${m.days.map((d) => `<button type="button" role="tab" class="wv-seg" data-wv-day="${d.i}" aria-pressed="${d.i === m.day?.i}" aria-selected="${d.i === m.day?.i}"${d.past ? " disabled" : ""}>${esc(d.label)} · ${d.n}</button>`).join("")}</div>` : "";
  const list = m.list.length ? `<ul class="wv-ring-list">${m.list.map((x) => `<li class="s-${x.state}"><button type="button" data-door="${esc(x.id)}"><b>${esc(x.name)}</b><small>${esc(x.word)}</small></button></li>`).join("")}</ul>` : `<p class="w-fm">No doors on this day.</p>`;
  host.innerHTML = `<h4 class="wv-h">${esc(RING_TITLE)}</h4>${sayHTML(ringWords(m))}${tabs}
    <div class="wv-ring-grid">
      <svg viewBox="0 0 ${S + 2 * M} ${S}" width="${S + 2 * M}" class="wv-svg wv-ring-svg" role="group" aria-label="${esc(RING_TITLE)}"><g transform="translate(${M} 0)">${parts}${ticks}${hourLabels}${doorArcs}${centre}</g></svg>
      ${stripHTML("Hover or tap an arc: the door's hours, and whether it's open while you're out.")}
      <div class="wv-ring-side"><p class="wv-ring-sub">${m.day ? `${esc(m.day.label.split(" ")[0])}'s doors, in opening order` : "No day selected"}</p>${list}</div>
    </div>
    ${tableTwinHTML({ cols: ["Door", `Hours ${m.day?.day ?? ""}`, "Open while you're out", "Qloo's day parts"], rows: m.arcs.map((a) => [a.name, a.hours ?? "unverified", a.open > 0 ? `${Math.round(a.open)} min` : "no", a.tod.join(", ") || "—"]) })}
    ${sourceHTML(`Qloo's time_of_day_fit tags on each of your plan's ${plural(m.n, "door")} (the outer band; Doors' clock: morning 6–11, midday 11–2, afternoon 2–6, evening 6–10, late night 10–2), each door's hours on Qloo's record, and the day's window from your profile.`)}`;
  for (const g of host.querySelectorAll(".wv-ring-part")) {
    const p = m.parts.find((x) => x.key === g.dataset.part);
    attachTip(g, () => [[`${p.label} ${p.n}`, `of your ${m.n} doors, by Qloo's tags`], [`${clock(p.from)}–${clock(p.to)}`, "Doors' clock for the word"]], { label: g.getAttribute("aria-label") });
  }
  for (const g of host.querySelectorAll(".wv-ring-door")) {
    const a = m.arcs.find((x) => x.id === g.dataset.id);
    attachTip(g, () => [[a.name, a.hours ? `${a.hours} ${m.day.day}` : "hours unverified"], [a.open > 0 ? "open while you're out" : "not open while you're out", a.open > 0 ? `${Math.round(a.open)} of your ${m.day.to - m.day.from} minutes` : ""], a.tod.length ? [a.tod.join(", "), "Qloo's day parts"] : null], { label: g.getAttribute("aria-label") });
  }
}
