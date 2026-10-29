// The guided demo's coach marks: a card that points at one part of the page, and a soft spotlight around it. Neither
// blocks the page: the dim layer lets every click through, so a visitor can leave the script and click around at any
// point. The card follows its target while the page scrolls or resizes; with no target (or one that left the page) it
// sits in the middle. On a phone the card docks to the bottom of the screen, or the top when its target is low.
// The spotlight frames only the part of the target that's on screen (clipped by every scrolling box around it), and a
// target that's off screen scrolls the least that shows it whole, or its top when it's taller than the room.
// createCoach() → {show(opts), hide(), destroy()}
//   show({target: () => Element|Element[]|null (several: the spotlight frames them all), title, body: [paragraphs],
//         counter: "3 of 18", buttons: [{label, kind, on}], cta, dim: true, extra: Element (shown under the body, e.g.
//         the swap card's two columns), wide (true | "xl"), dock: "top" (a phone's card docks at the top), reveal: (el) => void (scrolls the target itself, instead of the default),
//         beside: () => Element|null (a desktop card sits clear of this too, e.g. the whole row of a spotlit name),
//         keep: () => Element|null (a phone card docked at the top stays above this one's top, e.g. the door sheet),
//         explore: [{label, sub, spot: () => Element|null, on}] (r2, the tour's end card: a list of places to go next;
//         hovering or focusing one spotlights its part of the page, without scrolling)})
import { esc } from "./dom.js";

const GAP = 20; // between the card and the spotlight's edge
const SIDE_MIN = 300; // a card beside its target may narrow to this rather than cover it
const PAD = 6; // the spotlight's margin around the target
const PHONE = "(max-width: 700px)";

export function createCoach() {
  const dim = document.createElement("div");
  dim.className = "cdim";
  dim.setAttribute("aria-hidden", "true");
  dim.innerHTML = `<div class="chole"></div>`;
  const card = document.createElement("div");
  card.className = "ccard";
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-live", "polite");
  card.hidden = true;
  dim.hidden = true;
  // round 8 (agentfull): the Doors Agent is the whole screen on a phone; in the tour it steps back from a docked card
  // (css/agent.css reads --coach-t / --coach-b on <html>), so the thread and its box never sit under the card
  let dock = "";
  const setDock = (t, b) => {
    const v = `${t}|${b}`;
    if (v === dock) return;
    dock = v;
    const st = document.documentElement.style;
    if (t === "0px" && b === "0px") { st.removeProperty("--coach-t"); st.removeProperty("--coach-b"); }
    else { st.setProperty("--coach-t", t); st.setProperty("--coach-b", b); }
  };
  document.body.append(dim, card);
  const hole = dim.firstElementChild;
  let cur = null;
  let raf = 0;
  let revealed = null; // the target this card has scrolled into view (once per card, when it first shows)
  let revealAt = 0;
  let tries = 0;
  let last = null; // last frame's target: the spotlight glides to a new target, and sticks to a scrolling one
  // the card's own heights, measured with its cap lifted. Round 8 (Jard 10-28, phone): place() lifted the cap on every
  // frame to measure, and a box with no cap has no overflow, so a card the visitor had scrolled snapped back to its
  // top (on iOS the frames run after the finger lifts, so it snapped on release). Measured only while the card is at
  // its top, where there's nothing to lose; a scrolled card keeps the last measure.
  let size = null; // {natural: with no cap at all, capped: as the css caps it, key: viewport at the time}
  let hover = null; // r2: the explore row under the pointer or focus: its spot() is the target while it lasts

  card.addEventListener("click", (e) => {
    const i = e.target.closest("[data-cb]")?.dataset.cb;
    if (i != null) cur?.buttons?.[+i]?.on?.();
    const x = e.target.closest("[data-ce]")?.dataset.ce;
    if (x != null) { hover = null; cur?.explore?.[+x]?.on?.(); }
  });
  const spotOf = (el) => { const x = el?.closest?.("[data-ce]")?.dataset.ce; return x != null ? cur?.explore?.[+x]?.spot ?? null : null; };
  card.addEventListener("pointerover", (e) => { hover = spotOf(e.target); });
  card.addEventListener("pointerleave", () => { hover = card.contains(document.activeElement) ? spotOf(document.activeElement) : null; });
  card.addEventListener("focusin", (e) => { hover = spotOf(e.target); });
  card.addEventListener("focusout", (e) => { if (!card.contains(e.relatedTarget)) hover = null; });

  function show(opts) {
    cur = opts;
    hover = null;
    const body = (opts.body ?? []).map((p) => `<p>${esc(p)}</p>`).join("");
    card.innerHTML = `
      ${opts.counter ? `<div class="ccount">${esc(opts.counter)}</div>` : ""}
      <h3>${esc(opts.title ?? "")}</h3>
      ${body}
      ${opts.cta ? `<div class="ccta"><span aria-hidden="true">👉</span> ${esc(opts.cta)}</div>` : ""}
      ${opts.explore?.length ? `<div class="cexp">${opts.explore.map((x, i) => `<button type="button" class="cex" data-ce="${i}"><b>${esc(x.label)}</b>${x.sub ? `<span>${esc(x.sub)}</span>` : ""}</button>`).join("")}</div>` : ""}
      <div class="cbtns">${(opts.buttons ?? []).map((b, i) => `<button type="button" class="${b.kind === "primary" ? "btn primary sm" : b.kind === "link" ? "lnk" : "btn line sm"}" data-cb="${i}">${esc(b.label)}</button>`).join("")}</div>`;
    if (opts.extra) card.querySelector(".cbtns").before(opts.extra);
    card.setAttribute("aria-label", opts.title ?? "Demo");
    card.hidden = false;
    card.classList.toggle("wide", !!opts.wide);
    card.classList.toggle("xl", opts.wide === "xl");
    card.classList.remove("in");
    void card.offsetWidth;
    card.classList.add("in");
    dim.hidden = opts.dim === false;
    revealed = null;
    last = null;
    size = null;
    card.style.width = "";
    card.style.maxHeight = ""; // the last card's squeeze (a phone card shrunk beside its target) doesn't carry over
    card.classList.remove("fit");
    cancelAnimationFrame(raf);
    const loop = () => { place(); raf = requestAnimationFrame(loop); };
    loop();
    card.querySelector(".btn.primary")?.focus({ preventScroll: true });
  }

  const live = (t) => t && t.isConnected && t.getClientRects().length;
  const targets = () => {
    try {
      const t = hover ? hover() : cur?.target?.();
      return (Array.isArray(t) ? t : [t]).filter(live);
    } catch { return []; }
  };
  // plain numbers (a DOMRect's fields are getters, so it doesn't spread)
  const union = (rs) => rs.length ? rs.reduce((a, r) => ({ left: Math.min(a.left, r.left), top: Math.min(a.top, r.top), right: Math.max(a.right, r.right), bottom: Math.max(a.bottom, r.bottom) }), { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity }) : null;
  const box = (r) => (r ? { ...r, width: r.right - r.left, height: r.bottom - r.top } : null);
  // the demo banner, when it's on top of the page (drive mode's overlay covers it)
  const bannerBottom = () => {
    const b = document.querySelector(".demo-banner");
    const r = b?.getBoundingClientRect();
    if (!r?.height) return 0;
    const hit = document.elementFromPoint(r.left + 8, r.top + r.height / 2);
    return hit && b.contains(hit) ? r.bottom : 0;
  };
  // the part of el on screen: its rect cut by every box around it that clips (overflow other than visible)
  function visible(el) {
    const r = el.getBoundingClientRect();
    let v = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    for (let a = el.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.overflowX !== "visible" || cs.overflowY !== "visible") {
        const c = a.getBoundingClientRect();
        v = { left: Math.max(v.left, c.left), top: Math.max(v.top, c.top), right: Math.min(v.right, c.right), bottom: Math.min(v.bottom, c.bottom) };
      }
      if (cs.position === "fixed") break;
    }
    v = { left: Math.max(v.left, 0), top: Math.max(v.top, 0), right: Math.min(v.right, document.documentElement.clientWidth), bottom: Math.min(v.bottom, innerHeight) };
    return v.right - v.left > 2 && v.bottom - v.top > 2 ? v : null;
  }
  // the nearest box that scrolls el (or the page)
  function scroller(el) {
    for (let a = el.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (/(auto|scroll)/.test(cs.overflowY) && a.scrollHeight > a.clientHeight + 1) return a;
      if (cs.position === "fixed") return null;
    }
    const d = document.scrollingElement;
    return d && d.scrollHeight > d.clientHeight + 1 ? d : null;
  }
  // the bottom of a fixed or sticky bar laid over the scroller's top (drive mode's day header), else 0
  function header(el, c) {
    const x = Math.max(c.left ?? 0, 0) + Math.min(c.width ?? innerWidth, innerWidth) / 2;
    for (const e of document.elementsFromPoint(x, Math.max(c.top, 0) + 2)) {
      if (e === card || e === dim || dim.contains(e) || e.contains(el)) continue;
      for (let a = e; a && a !== document.body; a = a.parentElement) {
        if (a.contains(el)) break;
        const p = getComputedStyle(a).position;
        if (p === "fixed" || p === "sticky") return a.getBoundingClientRect().bottom;
      }
    }
    return 0;
  }
  // the top of a fixed or sticky bar laid over the scroller's bottom (a page footer), else Infinity
  function footer(el, c) {
    const x = Math.max(c.left ?? 0, 0) + Math.min(c.width ?? innerWidth, innerWidth) / 2;
    for (const e of document.elementsFromPoint(x, Math.min(c.bottom, innerHeight) - 2)) {
      if (e === card || e === dim || dim.contains(e) || e.contains(el)) continue;
      for (let a = e; a && a !== document.body; a = a.parentElement) {
        if (a.contains(el)) break;
        const p = getComputedStyle(a).position;
        if (p === "fixed" || p === "sticky") return a.getBoundingClientRect().top;
      }
    }
    return Infinity;
  }
  // scroll so the targets show whole in the room left for them (under the banner and any bar over the scroller's top,
  // above a footer or a card docked at the bottom), in the middle of it (judge pass 3, 20: not at its edge), or their
  // top when they're taller than that room
  function reveal(ts, below = 0) {
    const el = ts[0];
    const s = el && scroller(el);
    if (!s) return;
    const r = box(union(ts.map((t) => t.getBoundingClientRect())));
    const page = s === document.scrollingElement;
    const c = page ? { top: 0, bottom: innerHeight } : s.getBoundingClientRect();
    const top = Math.max(c.top, bannerBottom(), header(el, c)) + 12;
    const floor = Math.min(c.bottom, innerHeight, footer(el, c));
    const bottom = Math.min(floor, innerHeight - below) - 12;
    // already whole on screen: no scroll (on a phone the card docks to the other edge); on a desktop not within 40 px of
    // the bottom either, where the row a name belongs to runs under the footer
    if (r.top >= top && r.bottom <= floor - (below ? 12 : 40)) return;
    const d = r.height > bottom - top ? r.top - top : (r.top + r.bottom) / 2 - (top + bottom) / 2;
    if (Math.abs(d) > 1) s.scrollBy({ top: d, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }

  // a target clipped by a box that scrolls sideways (the plan's day tabs on a phone: All days sat off-screen right,
  // intuit pass 1b #3) scrolls that box so the target sits in its middle
  function revealX(el) {
    for (let a = el.parentElement; a && a !== document.body && a !== document.documentElement; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (/(auto|scroll)/.test(cs.overflowX) && a.scrollWidth > a.clientWidth + 1) {
        const c = a.getBoundingClientRect();
        const r = el.getBoundingClientRect();
        if (r.left < c.left || r.right > c.right) a.scrollBy({ left: (r.left + r.right) / 2 - (c.left + c.right) / 2, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
        return;
      }
      if (cs.position === "fixed") return;
    }
  }

  // the card's natural height (no cap) and its css-capped height, re-measured only while its scroll is at the top
  function measure(vw, vh) {
    const key = `${vw}x${vh}x${card.offsetWidth}`;
    if (size && (card.scrollTop > 0 || (size.key === key && performance.now() - size.at < 500))) return size;
    const was = card.style.maxHeight;
    card.style.maxHeight = "none";
    const natural = card.offsetHeight;
    card.style.maxHeight = "";
    const capped = card.offsetHeight;
    card.style.maxHeight = was;
    size = { natural, capped, key, at: performance.now() };
    return size;
  }

  function place() {
    if (!cur) return;
    // the room deep-dive (ui/room.js) is open: the visitor is exploring, so the card and spotlight step aside until it closes
    const away = !!document.querySelector(".roomview:not([hidden])");
    card.style.visibility = dim.style.visibility = away ? "hidden" : "";
    if (away) return;
    const ts = targets();
    const t = ts[0] ?? null;
    const vw = document.documentElement.clientWidth;
    const vh = innerHeight;
    const phone = matchMedia(PHONE).matches;
    // the target scrolls into view once, when it first shows (it may come later than its card: a panel that opens)
    // A list that re-renders under a smooth scroll cancels it: a target still wholly off screen once the scroll had
    // time to land is revealed again (twice at most, so a visitor who scrolls away isn't pulled back for long)
    const again = t && revealed === t && tries < 2 && performance.now() - revealAt > 700 && !ts.some(visible);
    if (t && !hover && (revealed !== t || again)) {
      tries = revealed === t ? tries + 1 : 0;
      revealed = t;
      revealAt = performance.now();
      if (phone) card.classList.add("docked"); // measured as it will sit
      if (cur.reveal) { try { cur.reveal(t); } catch {} }
      else {
        revealX(t);
        reveal(ts, phone ? Math.min(card.offsetHeight, vh * 0.46) + 20 : 0);
      }
    }
    let r = box(union(ts.map(visible).filter(Boolean)));
    // the spotlight: on screen only; it glides to a new target and sticks to one that scrolls
    hole.style.transition = t && t === last ? "opacity .2s" : "";
    last = t;
    dim.hidden = cur.dim === false && !hover; // an explore row's spotlight dims the page even on a card that doesn't
    if (r && !dim.hidden) {
      hole.style.opacity = "1";
      Object.assign(hole.style, { left: `${r.left - PAD}px`, top: `${r.top - PAD}px`, width: `${r.width + PAD * 2}px`, height: `${r.height + PAD * 2}px` });
    } else hole.style.opacity = "0";
    dim.classList.toggle("nohole", !r);
    // the card
    if (phone) {
      // docked to the edge away from the target, so the card never covers what it asks the visitor to tap
      card.classList.add("docked");
      card.style.width = "";
      // (judge pass 3, 20) only where the card fits above it: a tall target was revealed from its top, so the card
      // docks at the bottom rather than over that top. dock: "top" keeps it there (a sheet whose button is at its bottom)
      // intuit pass 1b (gigbot): a target low on a screen that can't scroll it higher (card 17's row, the last on the
      // page) sat under a card too tall for either side; the card now takes the bigger side and shrinks to it, its text
      // scrolling inside and its buttons pinned, so the target always shows
      const bb = bannerBottom();
      const m = measure(vw, vh);
      const cap = Math.min(m.natural, m.capped); // as tall as the css lets it be (46vh)
      // keep: () => Element (the open door's sheet, card 13): a card at the top stays above it, so its name shows too
      let keep = null;
      try { keep = cur.keep?.(); } catch {}
      const kt = live(keep) ? keep.getBoundingClientRect().top : Infinity;
      const above = r ? Math.min(r.top, kt) - bb - 16 : 0;
      const below = r ? vh - r.bottom - 20 : 0;
      // a tall target (a whole list) may sit under the card; targets named together (card 21's read-back and Save) never
      // do while the smallest card still fits beside them (tour fit, 320×568: 4 lines of read-back + Save were 265 px)
      const free = !!r && !cur.wide && cur.dock !== "top" && cur.place !== "bottom" && (r.height < vh * 0.45 || (ts.length > 1 && vh - bb - r.height >= 186));
      const top = cur.dock === "top" || (free && below < cap && (above >= cap || above > below));
      const room = top ? above : below;
      const squeeze = free && room < cap;
      const mh = squeeze ? `${Math.max(150, Math.floor(room))}px` : "";
      if (card.style.maxHeight !== mh) card.style.maxHeight = mh; // a same-value write still lays out and clamps
      card.classList.toggle("fit", squeeze);
      card.classList.toggle("top", top);
      card.style.left = card.style.top = "";
      // docked at the top, the card sits under the demo banner, so Skip and Close stay in reach; under drive mode's
      // overlay the banner is hidden, so the card goes to the top (lane S: it sat a banner's height down, on Log visit)
      card.style.setProperty("--ctop", `${Math.max(10, Math.round(bannerBottom() + 8))}px`);
      // judge 10 #2: a card whose text runs on under its buttons shows a fade there (demo.css .ccard.cmore)
      card.classList.toggle("cmore", card.scrollHeight - card.scrollTop - card.clientHeight > 2);
      const cr = card.getBoundingClientRect();
      setDock(top ? `${Math.max(0, Math.round(cr.bottom + 8))}px` : "0px", top ? "0px" : `${Math.max(0, Math.round(vh - cr.top + 8))}px`);
      return;
    }
    setDock("0px", "0px");
    card.classList.remove("docked", "top");
    // judge pass 4 (14): a desktop card keeps clear of the target's row as well as the spotlight
    let near = null;
    try { near = cur.beside?.(); } catch {}
    if (r && live(near) && visible(near)) r = box(union([r, visible(near)]));
    // beside the target when there's room, narrower if it must be (drive mode's sheet leaves two narrow margins)
    const full = Math.min(370, vw - 32);
    const side = r && !cur.place ? Math.max(vw - r.right - GAP - 16, r.left - GAP - 16) : 0;
    const fits = (w) => r && (r.right + GAP + w <= vw - 16 || r.left - GAP - w >= 16);
    const want = !cur.wide && r && !fits(full) && side >= SIDE_MIN ? Math.floor(side) : null;
    card.style.width = want ? `${want}px` : "";
    const w = card.offsetWidth;
    const h = measure(vw, vh).capped; // the card at its full height, not last layout's cap (a desktop card has no css cap)
    let x;
    let y;
    if (cur.place === "corner") {
      x = 16;
      y = vh - h - 16;
    } else if (cur.place === "bottom") {
      x = (vw - w) / 2;
      y = vh - h - 28;
    } else if (!r) {
      x = (vw - w) / 2;
      y = (vh - h) / 2;
    } else if (r.right + GAP + w <= vw - 16) {
      x = r.right + GAP;
      y = r.top + Math.min(r.height, 240) / 2 - h / 2;
    } else if (r.left - GAP - w >= 16) {
      x = r.left - GAP - w;
      y = r.top + Math.min(r.height, 240) / 2 - h / 2;
    } else if (r.bottom + GAP + h <= vh - 16) {
      x = r.left + r.width / 2 - w / 2;
      y = r.bottom + GAP;
    } else if (r.top - GAP - h >= 16) {
      x = r.left + r.width / 2 - w / 2;
      y = r.top - GAP - h;
    } else {
      x = vw - w - 24;
      y = vh - h - 24;
    }
    x = Math.max(16, Math.min(x, vw - w - 16));
    const top = Math.max(16, bannerBottom() + 12); // never over the banner's buttons
    // nor over the page's footer line (reshoot4: cards 17 and 18 ran over it at 1400)
    const ft = document.querySelector(".appfoot")?.getBoundingClientRect();
    const floor = ft?.height && ft.top < vh ? ft.top - 8 : vh - 16;
    // a card taller than the room under the banner (the swap card in a 686 px window) scrolls inside itself, its
    // buttons pinned to its bottom (css .ccard.fit), so Continue is always on screen
    const room = floor - top;
    card.classList.toggle("fit", h > room);
    const mh = h > room ? `${Math.max(160, room)}px` : "";
    if (card.style.maxHeight !== mh) card.style.maxHeight = mh;
    y = Math.max(top, Math.min(y, floor - Math.min(h, room)));
    card.style.left = `${Math.round(x)}px`;
    card.style.top = `${Math.round(y)}px`;
  }

  function hide() {
    cur = null;
    hover = null;
    cancelAnimationFrame(raf);
    card.style.visibility = dim.style.visibility = "";
    card.hidden = true;
    dim.hidden = true;
    setDock("0px", "0px");
  }

  return { show, hide, destroy: () => { hide(); dim.remove(); card.remove(); } };
}
