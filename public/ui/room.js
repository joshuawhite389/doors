// G5 · the Qloo room deep-dive (owner review 2, ask 1): everything Qloo says about one room, and why it was chosen.
// Opened from a stop's "Why this room" ("See everything Qloo knows about this room →") and its sister rooms. Desktop:
// a sheet over the map; phone (≤ 700 px): full screen. Content from lib/roominsight.js: how the room was chosen, the
// match for the drinker(s), the age bands, other ready brands' drinkers (their route files load when the panel
// opens), popularity and rating, Qloo's crowd / room text, the crowd's music (only when the sound guard passed), and
// sister rooms with why each is or isn't on the route ("+ Add" through S.addDoor, hidden until a slice registers it).
import * as S from "./state.js";
import { $, esc } from "./dom.js";
import { getJSON, loadIndex, fetchPlace } from "./data.js";
import { placePicture } from "../lib/place.js";
import { isPhone } from "./animate.js";
import { roomInsight, otherBrandFiles, rankBar } from "../lib/roominsight.js";
import { HOW_TITLE } from "../lib/basis.js";
import { rankAffinity } from "../lib/planview.js"; // R9 polish: how close to #1, in words, beside the rank
import { popWords } from "../lib/core.js";

let room = null; // the panel on screen: {el, id, data, others, off, onKey, back}

// openRoom(id, {city, routes, captured}, {section}) → shows the room; section = "sisters" scrolls to them.
export async function openRoom(id, data, { section = null } = {}) {
  const back = room?.back ?? document.activeElement; // a sister's deep-dive returns focus where the first was opened
  closeRoom({ focus: false });
  const plan = S.getPlan();
  if (!plan) return;
  const host = (!isPhone() && document.querySelector(".mapwrap")) || document.body;
  const el = document.createElement("section");
  el.className = "roomview";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "false");
  el.setAttribute("aria-label", "Everything Qloo knows about this door");
  host.append(el);
  room = { el, id, data, others: null, back };
  render();
  if (section) el.querySelector(`[data-sect="${section}"]`)?.scrollIntoView({ block: "start" });
  $(".rv-close", el)?.focus({ preventScroll: true });

  el.addEventListener("click", onClick);
  room.onKey = (e) => {
    if (e.key !== "Escape" || !room) return;
    e.stopPropagation(); // the stop stays open under the panel
    closeRoom();
  };
  window.addEventListener("keydown", room.onKey, true);
  room.off = S.onPlanChange(() => room && render());

  // the other ready brands' lists: static files, cached by getJSON
  const mine = room;
  try {
    const index = await loadIndex();
    const files = otherBrandFiles(index, plan);
    const others = await Promise.all(files.map((f) => getJSON(`/data/routes/${f.file}.json`).catch(() => null)));
    if (room !== mine) return;
    room.others = others.filter(Boolean);
  } catch {
    if (room !== mine) return;
    room.others = [];
  }
  const sc = $(".rv-scroll", room.el);
  const scrolled = sc?.scrollTop ?? 0;
  render();
  // the brands' bars change the height above: keep a requested section in view
  if (section && scrolled > 0) room.el.querySelector(`[data-sect="${section}"]`)?.scrollIntoView({ block: "start" });
}

export function closeRoom({ focus = true } = {}) {
  if (!room) return;
  const { el, off, onKey, back } = room;
  room = null;
  off?.();
  window.removeEventListener("keydown", onKey, true);
  el.remove();
  if (focus && back?.isConnected) back.focus({ preventScroll: true });
}

async function onClick(e) {
  const b = e.target.closest("[data-r]");
  if (!b || !room) return;
  const act = b.dataset.r;
  if (act === "close") return closeRoom();
  if (act === "stop") {
    const id = b.dataset.id;
    const day = Number(b.dataset.day);
    closeRoom({ focus: false });
    window.dispatchEvent(new CustomEvent("doors:open-stop", { detail: { id, day: Number.isInteger(day) ? day : null } }));
    return;
  }
  if (act === "room") return openRoom(b.dataset.id, room.data);
  if (act === "getq") return getFromQloo();
  if (act === "add") {
    const ri = model();
    const s = ri.sisters.find((x) => x.id === b.dataset.id);
    if (!s?.venue || !S.can("addDoor")) return;
    b.disabled = true;
    b.textContent = "Adding…";
    await S.addDoor(s.venue, { date: null });
    if (!room) return;
    render();
    const now = model().sisters.find((x) => x.id === s.id);
    say(`${s.name}: ${now?.status.text ?? "added"}.`);
  }
}

// group 3 item 2: what Qloo hasn't been asked about this door yet, asked now through the Worker (ui/data.js fetchPlace);
// one ask fills both sections. Loading and failure in plain words.
const GETQ = { music: "Qloo hasn't been asked for this crowd's music yet.", sisters: "Qloo hasn't been asked which doors share this crowd yet." };
function getqHTML(kind) {
  const f = room.fetch;
  if (f?.state === "busy") return `<p class="cap" role="status">Asking Qloo…</p>`;
  return `${f?.state === "error" ? `<p class="rv-say" role="alert">${esc(f.error)}</p>` : ""}<p class="cap">${esc(GETQ[kind])}</p><button type="button" class="btn sm line" data-r="getq">${f?.state === "error" ? "Try again" : "Get it from Qloo"}</button>`;
}
async function getFromQloo() {
  const mine = room;
  const plan = S.getPlan();
  const v = plan?.venues?.[room.id] ?? room.data?.city?.sisterVenues?.[room.id];
  const missing = placePicture({ id: room.id, venue: v ?? { id: room.id }, city: room.data?.city }).missing;
  if (!v || !missing.length) return;
  room.fetch = { state: "busy" };
  render();
  try {
    const city = await fetchPlace({ cityKey: plan.city.key, city: plan.city.query ?? plan.city.name, cityName: plan.city.name, venue: { ...v, id: room.id }, want: missing });
    if (room !== mine) return;
    room.data = { ...room.data, city };
    room.fetch = null;
  } catch (e) {
    if (room !== mine) return;
    room.fetch = { state: "error", error: e.message };
  }
  render();
  say(room.fetch ? room.fetch.error : "Qloo answered: the music and sister doors are filled in.");
}

const model = () => roomInsight({ plan: S.getPlan(), id: room.id, city: room.data?.city, routes: room.data?.routes ?? [], others: room.others ?? [] });

function say(text) {
  const t = $(".rv-live", room?.el);
  if (t) t.textContent = text;
}

// ---------- render ----------
const pct = (x) => `${Math.round(Math.max(0, Math.min(1, x)) * 100)}%`;
const bar = (x, cls = "") => `<span class="rv-bar ${cls}" aria-hidden="true"><i style="width:${pct(x)}"></i></span>`;

function render() {
  if (!room) return;
  const el = room.el;
  const scroll = $(".rv-scroll", el)?.scrollTop ?? 0;
  const ri = model();
  const plan = S.getPlan();
  const v = ri.venue;
  const st = ri.status;
  el.innerHTML = `
    <header class="rv-head">
      <div>
        <div class="rv-kick">Everything Qloo knows about this door</div>
        <h2>${esc(ri.name)}</h2>
        <div class="rv-meta">${ri.meta.map(esc).join(" · ")}${ri.rank ? `${ri.meta.length ? " · " : ""}<b>#${ri.rank} of ${ri.N}</b> on Your list${(() => { const t = plan ? rankAffinity(plan, room.data?.routes ?? [], room.id) : ""; return t ? ` · ${esc(t)}` : ""; })()}` : ""}</div>
        <div class="rv-status k-${esc(st.kind)}">${esc(st.text)}</div>
      </div>
      <button type="button" class="rv-close" data-r="close" aria-label="Close">×</button>
    </header>
    <div class="rv-scroll">
      ${stepsHTML(ri)}
      ${matchHTML(ri)}
      ${agesHTML(ri)}
      ${othersHTML(ri, plan)}
      ${popHTML(ri)}
      ${textHTML(ri)}
      ${musicHTML(ri)}
      ${sistersHTML(ri)}
      <p class="rv-foot">Static data captured from Qloo's Insights API${room.data?.captured ? ` on ${esc(room.data.captured)}` : ""}; nothing here calls Qloo.${v.id && v.source !== "manual" ? ` Qloo id <code>${esc(v.id)}</code>.` : ""}</p>
    </div>
    <div class="rv-live sr" role="status"></div>`;
  $(".rv-scroll", el).scrollTop = scroll;
}

function stepsHTML(ri) {
  return `<section class="rv-sect" data-sect="how"><h3>${esc(HOW_TITLE)}</h3>
    <ol class="rv-steps">${ri.steps.map((s) => `<li><b>${esc(s.label)}</b><span>${esc(s.text)}</span></li>`).join("")}</ol></section>`;
}

function matchHTML(ri) {
  const rows = ri.drinkers.map((d) => {
    const who = d.who ?? `${d.name} drinkers`;
    const a = d.all;
    // round 3 (Jard 10-23: decimals are "super confusing"): the rank is the big number, never Qloo's 0.xxx affinity
    const big = a?.rank ? `<div class="rv-big"><b>#${a.rank}</b><span>of ${a.of} in Qloo's order</span></div>` : "";
    const rank = a?.rank ? "Qloo's order" : "Not in Qloo's main list";
    const fam = d.famous?.rank ? `#${d.famous.rank} of ${d.famous.of} with the popularity cap off (the most popular doors in)` : d.famous ? `Not in the top ${d.famous.of} with the popularity cap off` : "";
    return `<div class="rv-match">
      ${big}
      <div class="rv-mrows">
        <div class="rv-who">For ${esc(who)}${d.category ? ` <span class="muted">· ${esc(d.category)}</span>` : ""}</div>
        <div class="rv-row"><span>${esc(rank)}</span>${bar(rankBar(a))}</div>
        ${fam ? `<div class="rv-row"><span>${esc(fam)}</span>${bar(rankBar(d.famous), "soft")}</div>` : ""}
      </div></div>`;
  });
  const merged = ri.merged && ri.rank ? `<p class="cap">On your plan it is #${ri.rank} of ${ri.N} on Doors' merged list: the drinkers' lists taken in turn, so that order is Doors', built from Qloo's ranks.</p>` : "";
  return `<section class="rv-sect" data-sect="match"><h3>Affinity</h3>${rows.join("")}${merged}
    <p class="cap">Affinity is Qloo's ${ri.drinkers.some((d) => d.kind === "pour" || d.kind === "room") ? "taste" : "brand-to-place"} score, 0 to 1, within this drinker's list; it isn't comparable across lists. A longer bar is a higher rank.</p></section>`;
}

function agesHTML(ri) {
  // Jard web review 10-24: a drinker whose every age band says "not in the N" says nothing about this door; with no
  // drinker in any band, the section goes
  const groups = ri.drinkers.filter((d) => d.ages.some((a) => a.rank));
  if (!groups.length) return "";
  return `<section class="rv-sect" data-sect="ages"><h3>Who skews here: age bands</h3>
    ${groups.map((d) => `${ri.drinkers.length > 1 ? `<div class="rv-who">${esc(d.name)} drinkers</div>` : ""}
      <div class="rv-bars">${d.ages.map((a) => `<div class="rv-row${a.rank && a === d.skew?.best ? " best" : ""}"><span class="rv-lbl">${esc(a.label)}</span>${bar(rankBar(a))}<span class="rv-val">${a.rank ? `#${a.rank} of ${a.of}` : `not in the ${a.of}`}</span></div>`).join("")}</div>
      ${d.skew ? `<p class="rv-say">${esc(d.skew.text)}</p>` : ""}`).join("")}
    <p class="cap">Qloo re-ranks the drinkers' doors when the signal is narrowed to one age band (one page of 50 per band, bars and restaurants kept). 21–24 is Qloo's “24 and younger” band.</p></section>`;
}

function othersHTML(ri, plan) {
  if (room.others == null) return `<section class="rv-sect" data-sect="others"><h3>How other brands' drinkers rank this door</h3><p class="cap">Loading the other ready brands' ${esc(plan.city?.name ?? "")} lists…</p></section>`;
  if (!ri.others.length) return "";
  return `<section class="rv-sect" data-sect="others"><h3>How other brands' drinkers rank this door</h3>
    <p class="rv-say">In the ranked list for ${ri.othersIn} of the ${ri.others.length} other ready brands in ${esc(plan.city?.name ?? "this city")}.</p>
    <div class="rv-bars">${ri.others.map((o) => `<div class="rv-row${o.rank ? "" : " out"}"><span class="rv-lbl">${esc(o.name)} <small>${esc(o.category ?? "")}</small></span>${bar(rankBar(o))}<span class="rv-val">${o.rank ? `#${o.rank} of ${o.of}` : `not in the ${o.of}`}</span></div>`).join("")}</div>
    <p class="cap">Each brand's own Qloo list for ${esc(plan.city?.name ?? "the city")} (same request as yours, that brand as the signal). A door high on several lists has a broad crowd; one only on yours is specific to your drinkers.</p></section>`;
}

function popHTML(ri) {
  if (ri.popularity == null && ri.rating == null) return "";
  const p = ri.popularity;
  return `<section class="rv-sect" data-sect="pop"><h3>Popularity and rating</h3>
    <div class="rv-bars">
      ${p != null ? `<div class="rv-row"><span class="rv-lbl">Qloo popularity</span><span class="rv-bar cap09" aria-hidden="true"><i style="width:${pct(p)}"></i><em style="left:90%"></em></span><span class="rv-val">${esc(popWords(p)[0].toUpperCase() + popWords(p).slice(1))}</span></div>` : ""}
      ${ri.rating != null ? `<div class="rv-row"><span class="rv-lbl">Rating</span>${bar(ri.rating / 5, "amber")}<span class="rv-val">★ ${ri.rating.toFixed(1)} of 5</span></div>` : ""}
    </div>
    <p class="cap">Popularity is Qloo's. The tick is Doors' cap: doors past it are the city's most popular, left out unless you include them${ri.famousRoom ? " (this is one of them)" : ""}. The rating is the business rating on Qloo's record of the door.</p></section>`;
}

const SOURCE = { customer_demographics_description: "crowd description", ambience_description: "ambience description", description: "description" };
function textHTML(ri) {
  const f = ri.facts;
  const chips = [
    f.liveMusic === true ? "Live music" : null,
    ...f.goodFor.map((g) => (typeof g === "string" ? g : g?.name)).filter(Boolean),
  ].filter(Boolean);
  if (!ri.lines.length && !chips.length) return `<section class="rv-sect" data-sect="text"><h3>The crowd and the door</h3><p class="cap">Qloo has no description of this door's crowd or feel.</p></section>`;
  const model = ri.pitch.by === "model";
  return `<section class="rv-sect" data-sect="text"><h3>The crowd and the door</h3>
    ${ri.lines.map((l) => `<div class="rv-quote"><b>${esc(l.label)}</b><p>${esc(l.text)}</p><small>Qloo's ${esc(SOURCE[l.source] ?? l.source)}</small></div>`).join("")}
    ${chips.length ? `<div class="rv-chips">${chips.map((c) => `<span class="rv-chip">${esc(c)}</span>`).join("")}</div>` : ""}
    ${ri.pitch.lines.length ? `<p class="cap">The stop's "Why this door" lines come from these.</p>` : ""}
    ${f.website || f.menu ? `<p class="rv-links">${f.website ? `<a href="${esc(f.website)}" target="_blank" rel="noopener">Website ↗</a>` : ""}${f.menu ? `<a href="${esc(f.menu)}" target="_blank" rel="noopener">Menu ↗</a>` : ""}</p>` : ""}</section>`;
}

function musicHTML(ri) {
  const m = ri.music;
  const head = `<section class="rv-sect" data-sect="music"><h3>The crowd's music</h3>`;
  if (m.state === "none") return `${head}${getqHTML("music")}</section>`;
  if (m.state === "held") return `${head}<p class="rv-say">Doors holds this door's list back: ${esc(m.detail)}.</p><p class="cap">Qloo's artist affinity with this door as the signal can fall back to the area's sound; Doors only shows a list that passes its checks.</p></section>`;
  return `${head}
    ${m.genres.length ? `<div class="rv-chips">${m.genres.map((g) => `<span class="rv-chip g">${esc(g.name)} <small>${g.n}/10</small></span>`).join("")}</div>` : ""}
    <ul class="rv-artists">${m.artists.map((a) => `<li><b>${esc(a.name)}</b>${a.genres.length ? `<span>${esc(a.genres.join(", "))}</span>` : ""}</li>`).join("")}</ul>
    <p class="cap">Artists Qloo matches to this door's crowd (artist affinity, this door as the signal); passed Doors' checks: ${esc(m.detail)}. Background for you, never quoted in a drafted message or talking point.</p></section>`;
}

function sistersHTML(ri) {
  const head = `<section class="rv-sect" data-sect="sisters"><h3>Sister doors</h3>`;
  if (!ri.sisters.length) return `${head}${room.data?.city?.sisters?.[ri.id] ? `<p class="cap">Qloo's match for this door's crowd has no other bar or restaurant in it.</p>` : getqHTML("sisters")}</section>`;
  const can = S.can("addDoor");
  const on = ri.sisters.filter((s) => s.status.kind === "on").length;
  return `${head}
    <p class="rv-say">Qloo matches these doors' regulars to this door's crowd (place-to-place affinity, this door as the signal), not to ${esc(ri.drinker)}. Your route is ranked on ${esc(ri.drinker)}, so a sister is on it only when it also ranks for them and fits a day: ${on} of ${ri.sisters.length} are.</p>
    <div class="rv-tally" aria-hidden="true">${ri.sisterTally.map((t) => `<i class="k-${t.kind}" style="flex:${t.n}"></i>`).join("")}</div>
    <ul class="rv-legend">${ri.sisterTally.map((t) => `<li class="k-${t.kind}"><b>${t.n}</b> ${esc(t.label)}</li>`).join("")}</ul>
    <ul class="rv-sis">${ri.sisters.map((s) => `<li class="k-${esc(s.status.kind)}">
      <div class="rv-sn"><button type="button" class="lnk" data-r="room" data-id="${esc(s.id)}">${esc(s.name)}</button>${s.genre ? ` <small>${esc(s.genre)}</small>` : ""}
        <div class="rv-st">${esc(s.status.text)}</div></div>
      <div class="rv-sa">
        ${s.status.kind === "on" ? `<button type="button" class="btn sm line" data-r="stop" data-id="${esc(s.id)}" data-day="${s.status.dayIndex}">Open stop</button>` : s.addable && can ? `<button type="button" class="btn sm line" data-r="add" data-id="${esc(s.id)}">+ Add</button>` : ""}</div></li>`).join("")}</ul>
    ${can ? `<p class="cap">+ Add puts a door on the plan; Doors picks the day it fits.</p>` : ""}</section>`; // round 3: no 0.xxx score per sister
}
