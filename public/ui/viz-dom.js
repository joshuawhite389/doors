// WHY-VIZ-SPEC §2.7, §7: what every picture's renderer shares. SVG element helpers, the details strip (round 4 #5:
// hover, tap and keyboard focus fill a fixed strip under the picture, nothing floats over the marks; it never gates:
// every value is also in the table twin or a direct label), the table twin ("The numbers behind it"), the sentence
// and legend HTML, and motion (prefers-reduced-motion and ?instant=1 turn every transition off). Marks' colours: the
// validated set from the spec (§2.4).
import { esc, instant } from "./dom.js";

export const NS = "http://www.w3.org/2000/svg";
export const COLOURS = { plan: "#1F7F58", big: "#CF6612", blue: "#3E6FB0", violet: "#8B5CF6", grey: "#C9C5BC", grey2: "#8E8A82", wash: "#CFE3D8", ink: "#17191B", ink2: "#4A4F55", ink3: "#62676D", line: "#E6E3DC", line2: "#EFEDE7", paper: "#FFFFFF", bg: "#F7F6F2", soft: "#E6EEE9" };
export const reduced = () => instant();

// svgEl("circle", {cx, cy, r}, parent) → the element, appended when a parent is given
export const svgEl = (tag, attrs = {}, parent = null) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
};
export const setAttrs = (e, attrs) => { for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== null) e.setAttribute(k, v); return e; };
export const svgText = (parent, x, y, s, attrs = {}) => { const t = svgEl("text", { x, y, fill: COLOURS.ink2, "font-size": 12, ...attrs }, parent); t.textContent = s; return t; };
export const svgRoot = (w, h, label) => svgEl("svg", { viewBox: `0 0 ${w} ${h}`, width: "100%", role: "img", "aria-label": label, class: "wv-svg" });

// ---------- the details strip (round 4 #5; Jard 10-27: "big black boxes … cover up big areas of the graphs and maps") ----------
// Nothing floats over the marks any more. Each picture carries one strip (stripHTML() in its markup, right under the
// figure); hover, tap and keyboard focus on a mark fill it with the same rows the tooltip used to show ([[value,
// label?], …]) and the mark gets .wv-hot. When the pointer leaves, the last rows stay, dimmed, so what you just read
// doesn't vanish; a tap on a touch screen keeps them until the next tap. The strip is a live region.
export const STRIP_HINT = "Hover or tap a mark for its details.";
export const stripHTML = (hint = STRIP_HINT) => `<div class="wv-strip idle" data-wv-strip="${esc(hint)}" role="status" aria-live="polite"><span class="wv-strip-hint">${esc(hint)}</span></div>`; // the hint names the strip: its reserved height survives a redraw (round 6 #2)
// the strip a mark reports to: the nearest ancestor that holds one
export function stripFor(node) {
  for (let e = node?.parentElement; e; e = e.parentElement) {
    const st = e.querySelector("[data-wv-strip]");
    if (st) return st;
  }
  return null;
}
export function fillStrip(strip, rows) {
  if (!strip) return;
  strip.replaceChildren(...(rows ?? []).filter(Boolean).map(([v, l]) => { const r = document.createElement("span"); r.className = "wv-sr"; const b = document.createElement("b"); b.textContent = v; r.append(b); if (l) { const sm = document.createElement("small"); sm.textContent = l; r.append(sm); } return r; }));
  strip.classList.remove("idle", "off");
}
export function restStrip(strip) { if (strip && !strip.classList.contains("idle")) strip.classList.add("off"); }
// round 6 #2 (Jard 10-27: "i don't want the ui jumping all around"): a strip never changes height. Every mark that
// reports to a strip registers what it can put there (attachTip does; a picture that fills a strip itself calls
// stripRows). A frame later (once the picture is in the page), after each refresh that asks, and on resize, every
// strip on screen is measured with each of those at its own width, all at once in hidden twins, and keeps the
// tallest height. Hovering a row then moves nothing under the strip; a row that wraps to a third line was reserved.
const MARKS = new Set(); // every mark with rows (dropped once it has left the page)
const ROWS = new WeakMap(); // mark → [{get, strip}]
const HIGH = new Map(); // strip name (its hint) + width → the tallest height measured so far: a redrawn strip starts from it
let reserveRaf = 0, reserveTimer = 0;
export function stripRows(node, rows, strip = null) {
  if (!node) return;
  const get = typeof rows === "function" ? rows : () => rows;
  if (!ROWS.has(node)) ROWS.set(node, []);
  ROWS.get(node).push({ get, strip });
  MARKS.add(node);
  scheduleReserve();
}
export function scheduleReserve() {
  if (reserveRaf || typeof requestAnimationFrame === "undefined") return;
  reserveRaf = requestAnimationFrame(() => { reserveRaf = 0; reserveStrips(); });
}
export function reserveStrips() {
  const byStrip = new Map();
  for (const n of MARKS) {
    if (!n.isConnected) { MARKS.delete(n); continue; }
    for (const { get, strip } of ROWS.get(n) ?? []) {
      const st = strip?.isConnected ? strip : stripFor(n);
      if (!st) continue;
      if (!byStrip.has(st)) byStrip.set(st, []);
      byStrip.get(st).push(get);
    }
  }
  for (const [strip, gets] of byStrip) {
    if (!strip.isConnected || !strip.getClientRects().length) continue;
    const w = strip.getBoundingClientRect().width;
    if (!w) continue;
    const host = document.createElement("div");
    host.style.cssText = `position:absolute;left:0;top:0;width:${w}px;visibility:hidden;pointer-events:none;`;
    host.setAttribute("aria-hidden", "true");
    const seen = new Set(), twins = [];
    for (const get of gets) {
      let rows = null;
      try { rows = get(); } catch { rows = null; }
      if (!rows?.length) continue;
      const key = JSON.stringify(rows);
      if (seen.has(key)) continue;
      seen.add(key);
      const t = document.createElement("div");
      t.className = "wv-strip";
      t.style.cssText = "min-height:0;height:auto;margin:0;";
      fillStrip(t, rows);
      host.append(t);
      twins.push(t);
    }
    if (!twins.length) continue;
    strip.parentNode.insertBefore(host, strip);
    let max = 0;
    for (const t of twins) max = Math.max(max, t.getBoundingClientRect().height); // one layout for all of them
    host.remove();
    const hk = `${strip.getAttribute("data-wv-strip") ?? ""}|${Math.round(w)}`;
    const want = Math.max(Math.ceil(max), parseFloat(strip.style.minHeight) || 0, HIGH.get(hk) ?? 0); // a high-water mark: a strip never shrinks, and a redrawn one starts where the last left off
    HIGH.set(hk, want);
    if (want > 0 && strip.style.minHeight !== `${want}px`) strip.style.minHeight = `${want}px`;
  }
}
if (typeof window !== "undefined") window.addEventListener("resize", () => { clearTimeout(reserveTimer); reserveTimer = setTimeout(reserveStrips, 150); });
// attach: hover (pointer), a tap and keyboard focus fill the picture's strip with the same rows; rows may be a
// function (read at show time)
export function attachTip(node, rows, { label = null } = {}) {
  const get = () => (typeof rows === "function" ? rows() : rows);
  stripRows(node, get); // round 6 #2: the strip reserves room for these rows
  const show = () => { fillStrip(stripFor(node), get()); node.classList.add("wv-hot"); };
  const rest = () => { restStrip(stripFor(node)); node.classList.remove("wv-hot"); };
  node.addEventListener("pointerenter", show);
  node.addEventListener("pointerleave", (e) => { if (e.pointerType !== "touch") rest(); }); // a tap keeps its details until the next tap
  node.addEventListener("click", show);
  node.setAttribute("tabindex", "0");
  node.setAttribute("role", "img");
  if (label) node.setAttribute("aria-label", label);
  node.addEventListener("focus", show);
  node.addEventListener("blur", rest);
}

// ---------- the sentence, the legend, the source line, the table twin ----------
// parts: strings and {t, cls} (lib/whyviz/words.js)
export const sayHTML = (parts, cls = "") => `<p class="wv-say ${cls}">${parts.map((p) => (typeof p === "string" ? esc(p) : `<b${p.cls ? ` class="${esc(p.cls)}"` : ""}>${esc(p.t)}</b>`)).join("")}</p>`;
export function sayInto(el, parts) {
  el.replaceChildren();
  for (const p of parts) {
    if (typeof p === "string") el.append(p);
    else { const b = document.createElement("b"); if (p.cls) b.className = p.cls; b.textContent = p.t; el.append(b); }
  }
}
// items: [{swatch: "plan" | "ring" | "ring-big" | "big" | "grey" | "<#hex>", text}]
export const legendHTML = (items) => `<div class="wv-legend">${items.map((x) => `<span><i class="${/^#/.test(x.swatch) ? "" : esc(x.swatch)}"${/^#/.test(x.swatch) ? ` style="background:${esc(x.swatch)}"` : ""}></i>${esc(x.text)}</span>`).join("")}</div>`;
export const sourceHTML = (text) => `<p class="wv-src">${esc(text)}</p>`;
// cols: [label]; rows: [[cell, …]]; summary: the fold's label
export function tableTwinHTML({ cols, rows, summary = "The numbers behind it", open = false }) {
  return `<details class="wv-tbl"${open ? " open" : ""}><summary>${esc(summary)}</summary><div class="wv-tblwrap"><table><thead><tr>${cols.map((c) => `<th scope="col">${esc(c)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c, i) => (i === 0 ? `<th scope="row">${esc(c)}</th>` : `<td>${esc(c)}</td>`)).join("")}</tr>`).join("")}</tbody></table></div></details>`;
}
export const fmt3 = (x) => (Number.isFinite(x) ? x.toFixed(3) : "—");
export const fmt2 = (x) => (Number.isFinite(x) ? x.toFixed(2) : "—");
export const fmt1 = (x) => (Number.isFinite(x) ? x.toFixed(1) : "—");

// ---------- the controls: one row of segmented buttons ----------
// items: [{v, text, on, disabled?}]; data-wv-row / data-wv-v carry the choice to the owner's click handler
export const segRowHTML = (row, label, items, { multi = false } = {}) => `<div class="wv-ctl" role="group" aria-label="${esc(label)}" data-wv-row="${esc(row)}"${multi ? ' data-wv-multi="1"' : ""}><span class="wv-lbl">${esc(label)}</span><span class="wv-segs">${items.map((x) => `<button type="button" class="wv-seg" data-wv-v="${esc(String(x.v))}" aria-pressed="${!!x.on}"${x.disabled ? " disabled" : ""}>${esc(x.text)}</button>`).join("")}</span></div>`;

// the host's drawable width (0 before layout): the renderers pick their layout from it
export const widthOf = (host, fallback = 600) => Math.round(host?.getBoundingClientRect?.().width || host?.clientWidth || fallback);
