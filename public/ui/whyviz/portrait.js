// WHY-VIZ-SPEC §4.7 The door portrait, drawn (Why this door, above What to say): header, the small picture 1 with
// this door ringed, its day and your window (lane 2's day-ring mini fills [data-wv-slot="portrait-ring"] when
// picture 4 lands; until then Qloo's time-of-day bins), the crowd chips rarest first, the age boxes, the doors that
// share its crowd (tap: picture 5 with this door selected), what it pours and the room's tags. Two columns at the
// panel's width, one on the phone.
import { $, esc } from "../dom.js";
import { COLOURS as C, widthOf } from "../viz-dom.js";
import { portraitModel, TOD_BINS } from "../../lib/whyviz/portrait.js";
import { explorerModelFor, drawMini } from "./explorer.js";
import { arc, wedge, pt, ang } from "./ring.js";
import { PARTS, clock } from "../../lib/whyviz/ring.js";
import { attachTip, stripHTML } from "../viz-dom.js";

export const PORTRAIT_LABEL = "This door, in Qloo's data";

export function portraitModelFor(s, id, v) {
  return portraitModel({ id, venue: v, plan: s.ctx.plan, sv: s.m.sv, routes: s.ctx.routes ?? [], profile: s.ctx.profile, base: s.data.baseAll ?? s.data.base, city: s.data.city, famous: !!s.ctx.famous, cityName: s.ctx.plan.city?.name, lift: s.lm ?? null });
}

const chip = (t, cls = "") => `<span class="wv-chip ${cls}">${esc(t)}</span>`;
const DOT = { plan: C.plan, list: null, big: C.big, out: C.grey, none: C.grey };

export function portraitHTML(s, id, v) {
  const p = portraitModelFor(s, id, v);
  s.viz.portrait = p;
  const ages = p.ages.length ? `<div class="wv-pt-block"><p class="wv-lbl">By age</p><div class="wv-ages">${p.ages.map((a) => `<div class="wv-age ${a.rank ? "on" : "off"}"><small>${esc(a.label)}</small><b>${a.rank ? `#${a.rank}` : "—"}</b><small>${a.rank ? `of ${a.of}` : "not on the list"}</small></div>`).join("")}</div></div>` : "";
  const sisters = p.sisters.length ? `<div class="wv-pt-block"><p class="wv-lbl">Doors that share its crowd</p><div class="wv-thread">${p.sisters.map((x) => `<button type="button" class="wv-sis" data-wv-thread="${esc(p.id)}" data-door-peek="${esc(x.id)}" title="${esc(x.text)}"><i class="${x.k === "list" ? "ring" : ""}"${DOT[x.k] ? ` style="background:${DOT[x.k]}"` : ""}></i>${esc(x.name)}${x.k === "list" && x.rank ? ` #${x.rank}` : ""}</button>`).join("")}</div><p class="wv-pt-note">Qloo's place-to-place match. Tap a door to work its thread.</p></div>` : "";
  const chips = p.who.chips.length ? p.who.chips.map((c) => `<span class="wv-chip ${c.rare ? "" : "city"}">${esc(c.label)}<b>${esc(c.text)}</b></span>`).join("") : `<span class="wv-chip city">No crowd description from Qloo</span>`;
  return `<section class="wv-port" aria-label="${esc(PORTRAIT_LABEL)}" data-wv-port="${esc(p.id)}">
    ${p.head.status ? `<p class="wv-pt-status">${esc(p.head.status)}</p>` : ""}
    <div class="wv-pt-row">
      <div class="wv-pt-block"><p class="wv-lbl">Match against how well known</p><div class="wv-fig wv-pt-fig" data-wv-fig="portrait-mini"></div><p class="wv-pt-line">${esc(p.match.line)}</p></div>
      <div class="wv-pt-block"><p class="wv-lbl">${p.when.dayName ? `Its ${esc(cap(p.when.dayName))}, and your window` : "When guests go"}</p>
        ${p.when.ring ? `<div class="wv-fig wv-pt-ring" data-wv-fig="portrait-ring">${ringMiniSVG(p.when.ring, p.when.tod)}</div>${stripHTML("Hover or tap the ring for its hours.")}` : `<div class="wd-when">${TOD_BINS.map((b) => `<span class="${p.when.tod.includes(b) ? "on" : ""}">${b}</span>`).join("")}</div>`}
        ${p.when.window ? `<p class="wv-pt-note">You're out ${esc(cap(p.when.dayName))} ${esc(p.when.window)}. That's the guests' clock, not the buyer's: Doors doesn't know when the buyer is in.</p>` : ""}
        <p class="wv-pt-line">${esc(p.when.line)}</p></div>
    </div>
    <div class="wv-pt-row">
      <div class="wv-pt-block"><p class="wv-lbl">Who is in the room, against ${esc(s.ctx.plan.city?.name ?? "the city")}</p><div class="wv-chips">${chips}</div><p class="wv-pt-line">${esc(p.who.line)}${p.who.quote ? ` Qloo's words: “${esc(p.who.quote)}”` : ""}</p></div>
      <div class="wv-pt-block">${ages}${sisters}</div>
    </div>
    ${p.pours.length || p.room.length ? `<div class="wv-pt-row">
      ${p.pours.length ? `<div class="wv-pt-block"><p class="wv-lbl">What it pours</p><div class="wv-chips">${p.pours.map((t) => chip(t)).join("")}</div></div>` : "<div></div>"}
      ${p.room.length ? `<div class="wv-pt-block"><p class="wv-lbl">The room, in Qloo's tags</p><div class="wv-chips">${p.room.map((t) => chip(t)).join("")}</div></div>` : ""}
    </div>` : ""}
    <p class="wv-src">${esc(p.footer)}</p>
  </section>`;
}
const cap = (t) => (t ? t[0].toUpperCase() + t.slice(1) : t);

// picture 4, small, for one door: Qloo's day parts this door is tagged with (outer band), its hours that day (one arc,
// green inside your window), the window wedge; midnight at the top
function ringMiniSVG(rm, tod) {
  const S = 220, c = S / 2, R = c - 26, band = 10;
  const a = rm.arcs[0] ?? null, w = rm.day;
  const parts = PARTS.map((p) => { const on = tod.includes(p.label); const mid = ang((p.from + p.to) / 2), [lx, ly] = pt(c, R + 11, mid); return `<g data-part="${esc(p.key)}" data-n="${p.n}"><path d="${arc(c, R - band / 2, p.from, p.to)}" stroke="${on ? C.plan : C.line}" stroke-width="${band}" fill="none" opacity="${on ? 0.85 : 0.9}"/><text x="${lx.toFixed(1)}" y="${(ly + 3.5).toFixed(1)}" text-anchor="${Math.cos(mid) > 0.3 ? "start" : Math.cos(mid) < -0.3 ? "end" : "middle"}" font-size="10" font-weight="600" fill="${on ? C.ink : C.ink3}">${esc(p.label)}</text></g>`; }).join("");
  const r = R - band - 12;
  const segs = a ? a.spans.flatMap((sp) => { const f = Math.max(0, sp.from), t = Math.min(sp.to, f + 1440); const o0 = Math.max(f, w.from), o1 = Math.min(t, w.to); const out = []; if (o1 > o0) { if (o0 > f) out.push([f, o0, false]); out.push([o0, o1, true]); if (t > o1) out.push([o1, t, false]); } else out.push([f, t, false]); return out; }) : [];
  const door = a ? `<g class="wv-pt-arc" data-id="${esc(a.id)}">${segs.map(([f, t, on]) => `<path d="${arc(c, r, f, t)}" stroke="${on ? C.plan : C.grey}" stroke-width="${on ? 4 : 3}" fill="none" stroke-linecap="round"/>`).join("")}</g>` : "";
  const centre = `<path d="${wedge(c, r - 10, w.from, w.to)}" fill="${C.soft}" stroke="${C.plan}" stroke-width="1.25" opacity=".9"/><text x="${c}" y="${c - 3}" text-anchor="middle" font-size="10" fill="${C.ink2}">You're out</text><text x="${c}" y="${c + 11}" text-anchor="middle" font-size="11" font-weight="700" fill="${C.ink}">${esc(`${clock(w.from)}–${clock(w.to)}`)}</text>`;
  const hours = [[0, "midnight"], [720, "noon"]].map(([mn, t]) => { const [x, y] = pt(c, R - band - 7, ang(mn)); return `<text x="${x.toFixed(1)}" y="${(y + (mn ? 8 : 1)).toFixed(1)}" text-anchor="middle" font-size="8.5" fill="${C.ink3}">${t}</text>`; }).join("");
  const state = a ? (a.state === "closed" ? `closed ${w.day}` : a.state === "unknown" ? "hours unverified" : a.open > 0 ? `open ${Math.round(a.open)} of your ${w.to - w.from} minutes out` : "not open while you're out") : "no hours";
  return `<svg viewBox="0 0 ${S} ${S}" class="wv-svg" role="img" aria-label="${esc(`This door's ${w.day}: ${a?.hours ?? "hours unverified"}; ${state}. Qloo tags it ${tod.join(", ") || "nothing"}.`)}" data-state="${esc(state)}">${parts}${hours}${door}${centre}</svg>`;
}

// after the drawer renders the door: the small picture 1, this door ringed; the ring mini's tooltip
export function portraitMount(el, s) {
  const host = $('[data-wv-fig="portrait-mini"]', el);
  const sec = host?.closest("[data-wv-port]");
  if (!host || !sec) return;
  const m = explorerModelFor(s);
  const w = widthOf(host, 300);
  drawMini(host, m, sec.dataset.wvPort, { hh: Math.round(Math.max(150, Math.min(230, w * 0.55))) });
  const ring = $('[data-wv-fig="portrait-ring"] svg', sec);
  const p = s.viz.portrait;
  if (ring && p?.when.ring) {
    const a = p.when.ring.arcs[0];
    attachTip(ring, () => [[p.head.name, a?.hours ? `${a.hours} ${p.when.ring.day.day}` : "hours unverified"], [ring.dataset.state, ""], p.when.tod.length ? [p.when.tod.join(", "), "Qloo's day parts"] : null], { label: ring.getAttribute("aria-label") });
  }
}
