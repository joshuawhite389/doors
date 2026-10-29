// "What your plan is based on" (Jard 10-23 items 2 + 7; why2 concept A, Jard's pick 10-24; WHY-VIZ-SPEC 10-25): the
// home is picture 1, Match × your variables (ui/whyviz/explorer.js), whose controls are Try a change; under it the
// four tiles (lib/basis.js whyHome), each a view that ends in a change to the plan: Check a door on my plan (its doors
// by day, each opening its view), Find doors I'm missing (the doors Qloo ranks higher, by the reason they're out, each
// with + and its reason's fix), Who I'm selling to (the two crowds with Start with …, Qloo's facts), See it on the map.
// Fixes are existing plan actions (status, add, famous doors, Edit profile, Doors Agent, Start with), so the plan and
// its toast follow. A door (a row, a search hit, or a pin clicked while this is open) opens its view: its way through
// the six gates (lib/basis.js doorTrail), what to say, its fixes. plan.js mounts it in the #why drawer and calls
// drawWhy(el, ctx) on open and after every re-plan; when the drawer hides, this module takes its layers off the map.
// Desktop: the left column beside the map (why-mode). Phone (≤ 900 px): a full-screen sheet; "Show the map" folds it.
import * as I from "../lib/insights.js";
import { $, esc, instant } from "./dom.js";
import { getJSON, fetchPlace } from "./data.js";
import { mergeLists } from "../lib/pool.js";
import { sieve, mapPlaces } from "../lib/sieve.js";
import { basis, doorTrail, findDoors, sourcesLine, whyHome, whoTitle, BASIS_TITLE, WHY_DOOR, WHY_ASK, HOW_TITLE, VIEWS, MISSING_SHOW, SETTINGS_LINK } from "../lib/basis.js";
import { crowds, mergedRoute } from "../lib/crowds.js";
import { openRoom } from "./room.js";
import { placePicture, PLACE_TITLE, placeMissingText } from "../lib/place.js"; // group 3 item 1
import { howChosen } from "../lib/roominsight.js";
import { DAY_COLOURS as DAYS } from "./map.js";
import { hasWebsite, webSearchHref } from "../lib/note.js";
import * as S from "./state.js";
import { icon } from "../lib/icons.js"; // the Doors icon set (Jard 10-24 #1)
import { cityRouteFiles } from "../lib/live.js";
import { loadStopData, modelFor } from "./stop.js"; // Jard R2: "What to say" is the stop's own opener
import { heatLoad, pvHTML, pvClick, previewAdd, clearPreview, addDoorHTML, paintLinks, clearLinks, setCanAdd } from "./whymap.js"; // the Add preview, the map's preview rings, the sister lines
import { portraitHTML, portraitMount } from "./whyviz/portrait.js"; // WHY-VIZ-SPEC §4.7: the door portrait above What to say
import { explorerHTML, explorerMount, explorerClick, refresh as explorerRefresh, EXPLORER_LABEL } from "./whyviz/explorer.js"; // WHY-VIZ-SPEC §4.1: the home's picture, with Try a change as its controls
import { bumpHTML, bumpMount, bumpRefresh } from "./whyviz/bump.js"; // WHY-VIZ-SPEC §4.6: the list by age (Deep Dive), the same age control
import { clearViz } from "./whyviz/state.js";
import { mountThread } from "./whyviz/thread.js"; // WHY-VIZ-SPEC §4.5 (lane 2): picture 5 in the Deep Dive view
import { threadModel, threadOf, threadAsk } from "../lib/whyviz/thread.js";
import { tryChange } from "./whymap.js";
import { and as andList } from "../lib/whyviz/words.js";
import { paintAreas, clearAreas, areasHTML, areasReserve } from "./whyviz/areas.js"; // WHY-VIZ-SPEC §4.2 (lane 2): picture 2 on the map while Why is open
import { areasModel } from "../lib/whyviz/areas.js";
import { mountLift } from "./whyviz/lift.js"; // WHY-VIZ-SPEC §4.3 (lane 2): picture 3 at the top of the Who view
import { liftModel } from "../lib/whyviz/lift.js";
import { mountRing } from "./whyviz/ring.js"; // WHY-VIZ-SPEC §4.4 (lane 2): picture 4 at the top of the Deep Dive view
import { ringModel } from "../lib/whyviz/ring.js";
import { heatFor } from "../lib/culture.js";

const CSS = "/css/why.css";
if (typeof document !== "undefined" && !document.querySelector(`link[href="${CSS}"]`)) {
  const l = document.createElement("link");
  l.rel = "stylesheet";
  l.href = CSS;
  document.head.append(l);
}

const SEL_RING = "#17191B";
const SRC = "why-rooms";
const SEL_SRC = "why-sel";
const CUR_SRC = "why-cur";
const LAYERS = ["why-rooms", "why-sel-halo", "why-sel", "why-cur"];
const OUT_FILL = "#6F6A60";
const narrow = () => matchMedia("(max-width: 900px)").matches;
const reduced = () => instant(); // prefers-reduced-motion, or ?instant=1 (screenshots)
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const states = new WeakMap(); // el → {view, door, open, pick, peek, q, fixes}

// ctx: {plan, routes, profile, index, famous, captured, travelNote (the tour's miles credit), map, editTo, rules, setFamous(on), removeRule(rule)}
export async function drawWhy(el, ctx) {
  let s = states.get(el);
  if (!s) {
    s = { view: "home", door: null, open: {}, pick: null, peek: false, q: "", ctx: null };
    states.set(el, s);
    wire(el, s);
  }
  s.ctx = ctx;
  s.keepDoor = false;
  el.classList.add("whyp");
  if (!el.firstElementChild) el.innerHTML = `<div class="w-load" role="status">Reading Qloo's data for these doors…</div>`;
  const { plan, index } = ctx;
  const cityKey = plan.city.key;
  if (s.cityKey !== cityKey || !s.data) {
    const brandFiles = cityRouteFiles(index, cityKey); // the baked brands and a live run's files alike (round 5 #2a: Cincinnati had no base)
    const [city, strip, cityRoutes] = await Promise.all([
      getJSON(`/data/cities/${cityKey}.json`).catch(() => null),
      getJSON(`/data/strip/${cityKey}.json`).catch(() => null),
      Promise.all(brandFiles.map((f) => getJSON(`/data/routes/${f}.json`).catch(() => null))),
    ]);
    s.data = { city, strip, base: I.cityRooms(cityRoutes.filter(Boolean)), baseAll: cityBase(cityRoutes.filter(Boolean)) };
    s.cityKey = cityKey;
  }
  if (s.stopFor !== plan) s.stopData = await loadStopData(plan).catch(() => null), s.stopFor = plan;
  await heatLoad(s).catch(() => null);
  await areasLoad(s).catch(() => null); // picture 2's hoods, when heatLoad didn't set them
  if (el.hidden || s.ctx !== ctx) return;
  render(el, s);
  paintMap(el, s, { fit: !s.fitted });
  s.fitted = true;
  if (s.areaNext) { const k = s.areaNext; s.areaNext = null; if (s.am?.areas.some((a) => a.key === k)) openArea(el, s, k); else setView(el, s, "map"); }
}

// Round 5 #2b: the plan map's Neighbourhoods toggle, a cloud or its pill tapped: open this view on that area (the
// "See it on the map" view with the area's doors), the same as tapping it while the drawer is open.
export function setWhyArea(el, key) {
  let s = states.get(el);
  if (!s) {
    s = { view: "home", door: null, open: {}, pick: null, peek: false, q: "", ctx: null };
    states.set(el, s);
    wire(el, s);
  }
  s.door = null;
  s.view = "map";
  s.area = null;
  s.areaNext = key ?? null; // drawWhy opens it once the model is built
  s.keepDoor = true;
}
// The stop's "Why this door" row (doors:why-door {id}, handled in plan.js): open this view on that door.
export function setWhyDoor(el, id) {
  let s = states.get(el);
  if (!s) {
    s = { view: "home", door: null, open: {}, pick: null, peek: false, q: "", ctx: null };
    states.set(el, s);
    wire(el, s);
  }
  s.door = id ?? null;
  s.keepDoor = true; // the drawer's hidden→shown flip must not clear it
}

// WHY-VIZ-SPEC §4.2: every door Doors holds for this city (the ranked lists and the big names of every brand file),
// the base every crowd lift is measured against; and Qloo's neighbourhoods for the drinker (the heat map), loaded
// here too so the clouds don't depend on the story's loader.
function cityBase(routes) {
  const base = I.cityRooms(routes);
  const ids = new Set(base.ids), venues = { ...base.venues };
  for (const r of routes) for (const row of r?.lists?.famous ?? []) if (r.venues?.[row[0]]) (ids.add(row[0]), (venues[row[0]] = r.venues[row[0]]));
  return { ids: [...ids], venues };
}
async function areasLoad(s) {
  const key = s.ctx.plan.city.key;
  if (s.data.hoodsFor === key) return;
  const heat = await getJSON("/data/culture/heat.json").catch(() => null);
  s.data.hoods = heatFor(heat, s.ctx.routes, key) ?? null;
  s.data.hoodsFor = key;
}

// ---------- model (the phone's Why.tsx builds the same ctx) ----------
function model(s) {
  const { plan, routes, profile, index, famous, rules = [] } = s.ctx;
  const route = mergedRoute(routes, { famous }); // why2: one drinker, every drink the rep named (no switcher)
  const venues = { ...route.venues, ...plan.venues };
  const cv = I.curve(route, plan.pool.ids, { famous });
  const myIds = cv.rows.map((r) => r.id);
  const mine = profile.venue || profile.pours?.length ? [] : profile.drinks.filter((x) => x.ready).map((x) => x.key);
  const baseIds = mine.length === 1 && s.data.strip?.brands?.[mine[0]] ? s.data.strip.brands[mine[0]].ids : mergeLists(routes).ids.slice(0, 50);
  const sv = sieve({ route, plan, profile, famous, city: s.data.city });
  const ctx = {
    whyChanges: s.ctx.whyChanges ?? [], sv, cv, venues, plan, profile, famous, rules, cityName: plan.city.name, today: s.ctx.today ?? null, added: (plan.added ?? s.ctx.added ?? []).map((a) => a.id ?? a), removable: S.can("removeDoor"),
    hasFamous: !!route.lists?.famous?.length,
    pop: I.popularity(route, cv.rows, venues),
    shared: I.shared({ strip: s.data.strip, base: baseIds, brands: index.brands, mine }),
    crowd: I.crowd(myIds.slice(0, 50), venues, { base: s.data.base.ids, baseVenues: s.data.base.venues }),
    sound: I.sound(myIds, s.data.city?.sounds ?? {}),
    funnel: I.funnel(route, { pool: plan.pool.ids, plan: I.planIds(plan) }),
  };
  const b = basis(ctx);
  const cr = crowds({ routes, pool: { ids: plan.pool.ids, venues }, famous });
  return { ctx, b, h: whyHome(ctx, b, cr, s.ctx.startWith ?? null), route, venues, sv, dayOf: I.dayOfId(plan) };
}

// ---------- render ----------
function render(el, s) {
  const m = model(s);
  s.m = m;
  try { s.am = areasModel({ places: [...m.sv.dots, ...m.sv.extras], venues: m.venues, hoods: s.data.hoods, base: s.data.baseAll ?? s.data.base, poolIds: s.ctx.plan.pool.ids, cityName: s.ctx.plan.city.name }); } catch (e) { console.error(e); s.am = null; }
  try { s.lm = liftModel({ planIds: I.planIds(s.ctx.plan), venues: m.venues, base: s.data.baseAll ?? s.data.base, cityName: s.ctx.plan.city.name }); } catch (e) { console.error(e); s.lm = null; }
  s.fixes = new Map();
  s.picks = new Map();
  if (s.view === "map") s.picks.set("out", { title: "Doors left off", ids: m.h.missing.flatMap((g) => g.doors.map((d) => d.id)) });
  const sub = s.door || s.view !== "home";
  const head = `<div class="w-head">
    ${sub ? `<button type="button" class="lnk w-back w-backdoor" data-w="list">← Back</button>` : ""}
    <h3>${s.door ? esc(WHY_DOOR) : s.view === "who" ? esc(whoTitle(s.ctx.profile)) : s.view !== "home" ? esc(VIEWS[s.view]) : esc(BASIS_TITLE)}</h3>
    <button type="button" class="w-x" data-w="close" aria-label="Close ${esc(BASIS_TITLE)}">${icon("close", 18)}</button>
  </div>`;
  const keep = el.scrollTop;
  const body = s.door ? doorHTML(s, s.door) : VIEW_HTML[s.view]?.(s) ?? homeHTML(s); // the home builds the explorer's model (s.viz.m) first
  if (!s.door && s.view === "home" && s.viz?.logi?.fates?.length) { // round 4 #7: the picked reasons' doors ring on the map
    const ids = s.viz.m?.logiIds ? [...s.viz.m.logiIds] : [];
    if (ids.length) s.picks.set("logi", { title: "Doors left off for that reason", ids });
    else if (s.pick === "logi") s.pick = null;
  } else if (s.pick === "logi") s.pick = null;
  el.innerHTML = head + body + trayHTML(s);
  if (s.door || s.viewFresh) el.scrollTop = 0; // a door, or a view just opened (setView): start at the top
  else el.scrollTop = keep;
  s.viewFresh = false;
  // the home is picture 1 (WHY-VIZ-SPEC §4.1); its SVG is kept and updated in place across renders
  if (!s.door && s.view === "home") explorerMount(el, s);
  if (s.door) portraitMount(el, s);
  if (!s.door && s.view === "plan") { ringMount(el, s); threadMount(el, s); bumpMount(el, s); }
  if (!s.door && s.view === "who") mountLift($('[data-wv-slot="lift"]', el), s.lm, { narrow: narrow() });
  if (!s.door && s.view === "map") areasReserve(el, s.am); // round 6 #2: the neighbourhood strip keeps one height
  if (s.q) {
    const f = $(".w-findbox", el);
    if (f && s.refocus) (f.focus(), f.setSelectionRange(f.value.length, f.value.length), (s.refocus = false));
  }
}

const fixBtn = (s, f, cls = "lnk") => {
  const k = `f${s.fixes.size}`;
  s.fixes.set(k, f);
  if (f.kind === "profile" && s.ctx.editTo) return `<a class="${cls}" href="${esc(s.ctx.editTo)}">${esc(f.label)}</a>`;
  return `<button type="button" class="${cls}" data-fix="${k}">${esc(f.label)}</button>`;
};

function factHTML(s, f) {
  const sw = f.on !== undefined;
  const k = f.ids.length > 1 ? (s.picks.set(f.key, { title: f.text.replace(/[.:].*$/, ""), ids: f.ids }), f.key) : null;
  const text = f.door ? `<button type="button" class="w-ft" data-door="${esc(f.door)}">${esc(f.text)}<span aria-hidden="true">›</span></button>` : `<p class="w-ft">${esc(f.text)}</p>`;
  const famousSwitch = sw && s.m.ctx.hasFamous ? `<label class="w-switch"><input type="checkbox" id="w-famous" ${f.on ? "checked" : ""}><span>${f.on ? "On" : "Off"}</span></label>` : "";
  const fixes = !sw && f.fixes.length ? f.fixes.map((x) => fixBtn(s, x)).join("") : "";
  const map = k ? `<button type="button" class="lnk w-find" data-pick="${esc(k)}" aria-pressed="${s.pick === k}">Show on map</button>` : "";
  return `<li class="w-fact${s.pick === k && k ? " on" : ""}" data-fact="${esc(f.key)}">
    <div class="w-fl">${text}${famousSwitch}</div>
    ${f.more ? `<p class="w-fm">${esc(f.more)}</p>` : ""}
    ${fixes || map ? `<div class="w-fx">${fixes}${map}</div>` : ""}
  </li>`;
}

// ---------- why2 concept A: who it's for, four tiles, a view per tile ----------
// the tiles' icons: the Doors set's door for the doors, and three drawn in the set's style (24 grid, 2 round stroke)
const TILE_ICON = {
  missing: '<path d="M12 5v14M5 12h14"/>',
  map: '<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14M15 6v14"/>',
};
// round 5 #1 (Jard 10-27: "fix this icon"): your drinkers is the set's own glasses-raised icon (lib/icons.js drinkers)
const tileIcon = (k) => (k === "plan" ? icon("door", 20) : k === "who" ? icon("drinkers", 20) : `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${TILE_ICON[k]}</svg>`);

// WHY-VIZ-SPEC §3: the home is picture 1 with the Try a change controls as its own; the four jobs stay one tap away
function homeHTML(s) {
  const { h } = s.m;
  return (s.pv && s.pvFrom === "logi" ? "" : pvHTML(s)) + explorerHTML(s) + // round 5 #5: a row's + previews under the explorer's list instead
    `<section class="ws-jobs" aria-label="More about your plan">${h.tiles.map((x) => `<button type="button" class="ws-job" data-view="${esc(x.key)}"><b>${esc(x.title)}</b><span>${esc(x.line)}</span></button>`).join("")}</section>` +
    (h.changes.length ? `<button type="button" class="w-changes" data-view="changes">${esc(VIEWS.changes)} · ${h.changes.length}<span aria-hidden="true">›</span></button>` : "") +
    `<p class="w-src">${esc(sourcesLine(s.ctx.captured, s.ctx.plan?.source, s.ctx.travelNote))}</p>`;
}

function planViewHTML(s) {
  // WHY-VIZ-SPEC §3: the pictures slot in above the by-day list (4 the day ring, 5 the thread, 6 the age bump); lane 2
  // fills the thread slot (threadMount), the others' lanes fill theirs
  return `<div data-wv-slot="ring"></div><div data-wv-slot="thread"></div><div data-wv-slot="bump">${bumpHTML(s, { narrow: narrow() })}</div>` + s.m.h.days.map((d) => `<section class="w-grp"><h4>${esc(d.label)}</h4><ul class="w-rows">${d.doors.map((x) => `<li><button type="button" data-door="${esc(x.id)}"><i class="w-n">${x.n}</i><span><b>${esc(x.name)}</b><small>${esc(x.line)}</small></span><em aria-hidden="true">›</em></button></li>`).join("")}</ul></section>`).join("") || `<p class="w-sub">No doors on a day yet.</p>`;
}

function missingHTML(s) {
  const { h, sv } = s.m;
  const found = findDoors(sv, s.q);
  const finder = `<div class="w-search"><input class="w-findbox" type="search" value="${esc(s.q)}" placeholder="Find a door by name" aria-label="Find a door: why isn't it on my plan?" autocomplete="off">
    ${found.length ? `<ul class="w-hits">${found.map((d) => `<li><button type="button" data-door="${esc(d.id)}">${esc(d.name)} <span>${d.fate === "plan" ? "on your plan" : d.like ? "not on Qloo's list" : "left out"}</span></button></li>`).join("")}</ul>` : s.q.trim().length >= 2 ? `<p class="w-fm">No door by that name in what Qloo ranked here.</p>` : ""}</div>`;
  const groups = h.missing.map((g) => {
    const all = s.open[g.key];
    const shown = all ? g.doors : g.doors.slice(0, MISSING_SHOW);
    return `<section class="w-grp" data-group="${esc(g.key)}"><div class="w-gh"><h4>${esc(g.title)} · ${g.n}</h4>${g.fix ? fixBtn(s, g.fix, "btn sm line") : ""}</div>
      <ul class="w-rows">${shown.map((d) => `<li><button type="button" data-door="${esc(d.id)}"><span><b>${esc(d.name)}</b><small>${esc(d.reason)}</small></span></button>${addBtn(s, d)}</li>`).join("")}</ul>
      ${g.doors.length > MISSING_SHOW ? `<button type="button" class="lnk w-more" data-more="${esc(g.key)}" aria-expanded="${!!all}">${all ? "Show fewer" : `Show ${g.doors.length - MISSING_SHOW} more`}</button>` : ""}</section>`;
  }).join("");
  return finder + (groups || `<p class="w-sub">No door Qloo ranks higher is left out.</p>`);
}
function addBtn(s, d) {
  const k = `f${s.fixes.size}`;
  s.fixes.set(k, d.fix);
  return `<button type="button" class="w-add" data-fix="${k}" aria-label="Add ${esc(d.name)} to my plan">+</button>`;
}

function whoHTML(s) {
  const { h } = s.m;
  // the drinks the rep named, as one drinker, and where to change them (Jard 10-24: edit who your drinkers are here)
  const edit = s.ctx.editTo ? `<a class="btn sm line" href="${esc(s.ctx.editTo)}">Edit</a>` : "";
  const drinks = `<div class="w-who"><span class="w-ico t-who">${tileIcon("who")}</span><div><b>${esc(h.who.people)}</b><span>${esc(h.who.sub)}</span></div>${edit}</div>`;
  const cr = h.crowds ? `<section class="w-grp w-crowds"><p class="w-ft">${esc(h.shareLine)}</p><div class="w-cr">${h.crowds.groups.map((g, i) => `<div class="w-crowd c${i} r-${esc(g.room ?? "none")}"><b>${esc(g.label)}</b><span>${plural(g.n, "door")} on your plan${g.examples.length ? `: ${esc(g.examples.join(", "))}` : ""}</span>${fixBtn(s, g.fix, g.on ? "btn sm primary" : "btn sm line")}</div>`).join("")}</div></section>` : "";
  const facts = h.facts.length ? `<section class="w-grp"><h4>What Qloo says</h4><ul class="w-facts">${h.facts.map((f) => factHTML(s, f)).join("")}</ul></section>` : "";
  const set = typeof document !== "undefined" && document.getElementById("t-settings") ? `<p class="w-setlink"><button type="button" class="lnk" data-w-settings>${esc(SETTINGS_LINK)}</button></p>` : "";
  return `<div data-wv-slot="lift"></div>` + drinks + cr + facts + set; // picture 3 on top (spec §3)
}

function mapViewHTML(s) {
  const { h } = s.m;
  return `<p class="w-sub">Your plan's doors are in their days' colours. ${h.nOut ? `The ${plural(h.nOut, "door")} left off are grey, ringed. ` : ""}Tap a door on the map to see why it's in or out.</p>
    ${narrow() ? `<button type="button" class="btn primary" data-w="peek">Show the map</button>` : ""}
    <div data-wv-slot="areas">${areasHTML(s.am, { sel: s.area ?? null, canAdd: S.can("addDoor"), narrow: narrow() })}${s.pv ? pvHTML(s) : ""}</div>`;
}
// WHY-VIZ-SPEC §4.2: a cloud or its pill tapped on the map: the map view opens on that area's doors (the phone's sheet
// comes back over the map); the same area tapped again folds it
function openArea(el, s, key) {
  s.area = s.area === key ? null : key;
  if (s.area) { s.door = null; s.view = "map"; s.pick = null; }
  render(el, s);
  paintSelection(el, s, { fit: false });
  if (narrow()) setPeek(el, s, false);
  const a = s.area && s.am?.areas.find((x) => x.key === s.area);
  if (a) {
    if (!narrow()) fitIds(el, s, a.doors.map((d) => d.id));
    $(`[data-wv-sheet]`, el)?.scrollIntoView({ block: "start", behavior: reduced() ? "auto" : "smooth" });
  }
}

function changesHTML(s) {
  return `<ul class="w-facts">${s.m.h.changes.map((f) => factHTML(s, f)).join("")}</ul>`;
}
const VIEW_HTML = { plan: planViewHTML, missing: missingHTML, who: whoHTML, map: mapViewHTML, changes: changesHTML };

function doorHTML(s, id) {
  const d = placeOf(s, id);
  const t = doorTrail(d, { ...s.m.ctx, talkFor: (x) => (s.stopData ? modelFor(s.ctx.plan, x, s.m.dayOf.get(x) ?? null, s.stopData).talk : null) });
  if (!t) return `<p class="w-sub">That door isn't in this plan's data.</p>`;
  const v = venueOf(s, id) ?? {};
  const web = hasWebsite(v) ? `<a href="${esc(v.website)}" target="_blank" rel="noopener">Website ↗</a>` : webSearchHref({ ...v, name: v.name ?? t.name }, s.ctx.plan.city?.name) ? `<a href="${esc(webSearchHref({ ...v, name: v.name ?? t.name }, s.ctx.plan.city?.name))}" target="_blank" rel="noopener" aria-label="Search the web for ${esc(t.name)} (opens in a new tab)">Search the web ↗</a>` : "";
  const onPlan = d?.fate === "plan" && s.ctx.plan.venues[id];
  // WHY-VIZ-SPEC §4.7: one line on why it is or isn't on the plan, then the portrait (the pictures, small, for this
  // door: ui/whyviz/portrait.js, in place of group 3's eight text rows); the gate list and Qloo's steps stay behind
  // "How this door was chosen"
  const pic = placePicture({ id, venue: { ...v, id }, city: s.data.city, routes: s.ctx.routes, plan: s.ctx.plan });
  const meta = [pic.kind, v.neighborhood].filter(Boolean).join(" · ");
  const steps = howChosen(s.ctx.plan, id, s.ctx.routes ?? []);
  return `<div class="wc w-door" data-wc-id="${esc(id)}">
    <h4 class="w-dname">${esc(t.name)}</h4>${meta ? `<p class="w-sub">${esc(meta)}</p>` : ""}
    <p class="w-why wd-fate">${esc(t.why.text)}</p>
    ${addDoorHTML(s, id, v)}
    ${portraitHTML(s, id, { ...v, id })}
    ${pic.missing.length ? `<div class="w-place wd-more">${fetchHTML(s, id, pic)}</div>` : ""}
    ${t.say ? `<h5>What to say</h5><p class="w-say">“${esc(t.say)}”</p>${t.toBuyer ? `<p class="w-say-to">Then, to the buyer:</p><p class="w-say">“${esc(t.toBuyer)}”</p>` : ""}` : ""}
    ${t.fixes.length ? `<h5>What you can do</h5><div class="w-dfix">${t.fixes.map((f) => fixBtn(s, f, "btn sm line")).join("")}</div>` : ""}
    <details class="w-how"${s.howOpen ? " open" : ""}><summary>${esc(HOW_TITLE)}</summary>
      <ul class="w-trail">${t.lines.map((l) => `<li class="${l.ok ? "ok" : "no"}"><i aria-hidden="true">${icon(l.ok ? "check" : "close", 13)}</i><span><span class="sr">${l.ok ? "Passed: " : "Stopped: "}</span>${esc(l.text)}</span></li>`).join("")}</ul>
      <ol class="w-hsteps">${steps.map((x) => `<li><b>${esc(x.label)}</b><span>${esc(x.text)}</span></li>`).join("")}</ol>
    </details>
    <div class="wc-links">${onPlan ? `<button type="button" class="lnk" data-open="${esc(id)}">Open the stop</button>` : ""}<button type="button" class="lnk" data-wc="room">Everything Qloo knows</button>${web}</div>
  </div>`;
}

// What Qloo hasn't been asked about this door yet: one button that asks now (POST /api/place through the Worker),
// then "Asking Qloo…", then the picture fills in, or the failure in plain words with Try again.
const FETCH_LABEL = { music: "music", sisters: "sister doors" };
function fetchHTML(s, id, pic) {
  if (!pic.missing.length) return "";
  const f = s.fetching?.[id];
  const what = pic.missing.map((k) => FETCH_LABEL[k]).join(" and ");
  if (f?.state === "busy") return `<p class="w-fetch busy" role="status">Asking Qloo for its ${esc(what)}…</p>`;
  const err = f?.state === "error" ? `<p class="w-fetch err" role="alert">${esc(f.error)}</p>` : "";
  return `${err}<p class="w-fm">${esc(placeMissingText(pic.missing))}</p><button type="button" class="btn sm line w-getq" data-getq="${esc(id)}">${f?.state === "error" ? "Try again" : `Get its ${esc(what)} from Qloo`}</button>`;
}
async function getFromQloo(el, s, id) {
  const v = venueOf(s, id);
  if (!v) return;
  const pic = placePicture({ id, venue: { ...v, id }, city: s.data.city });
  if (!pic.missing.length) return;
  s.fetching = { ...(s.fetching ?? {}), [id]: { state: "busy" } };
  render(el, s);
  const plan = s.ctx.plan;
  try {
    s.data.city = await fetchPlace({ cityKey: plan.city.key, city: plan.city.query ?? plan.city.name, cityName: plan.city.name, venue: { ...v, id }, want: pic.missing });
    s.fetching[id] = { state: "done" };
  } catch (e) {
    s.fetching[id] = { state: "error", error: e.message };
  }
  if (!el.hidden && s.door === id) render(el, s);
}

// the doors a "Show on map" lit: a short list under the facts (each opens its door); on a phone, "Show on map" folds
function trayHTML(s) {
  const p = s.pick && s.picks.get(s.pick);
  if (!p || s.door) return "";
  return `<div class="w-tray" role="region" aria-label="Doors on the map"><div class="w-trayhead"><span><b>${esc(p.title)}</b> · ${plural(p.ids.length, "door")} ringed on the map</span>
    <span>${narrow() ? `<button type="button" class="lnk" data-w="peek">Show on map</button>` : ""}<button type="button" class="lnk" data-w="clear">Clear</button></span></div></div>`;
}

const placeOf = (s, id) => s.m.b.doors.get(id) ?? s.m.sv.lookalikes.find((d) => d.id === id) ?? null;
const venueOf = (s, id) => s.ctx.plan.venues[id] ?? s.m.route.venues[id] ?? placeOf(s, id)?.venue ?? s.data.city?.sisterVenues?.[id] ?? null;

// ---------- fixes: each one an existing plan action ----------
async function runFix(el, s, f) {
  if (f.kind === "status") {
    if (f.status) s.door = null;
    await S.setStatus(f.id, f.status);
  } else if (f.kind === "add") {
    const v = venueOf(s, f.id);
    if (v) await S.addDoor({ ...v, id: f.id }, { date: null });
  } else if (f.kind === "remove") {
    s.door = null;
    await S.removeDoor(f.id);
  } else if (f.kind === "famous") await s.ctx.setFamous?.(f.on);
  else if (f.kind === "whyundo") { await s.ctx.undoWhyChange?.(f.id); if (s.view === "changes" && !(s.ctx.whyChanges ?? []).some((e) => e.id !== f.id) && !s.m?.h.changes.some((x) => x.key !== `w-${f.id}`)) s.view = "home"; }
  else if (f.kind === "startWith") await s.ctx.setStartWith?.(f.key);
  else if (f.kind === "agent") window.dispatchEvent(new CustomEvent("doors:ask", { detail: { id: f.id ?? null, prefill: f.prefill } }));
  else if (f.kind === "rule") await s.ctx.removeRule?.(f.rule);
  else if (f.kind === "dayUndo") await S.undoDayChange(f.date); // Stop for today / running late (lib/day-stop.js)
  if (!el.hidden && s.m) render(el, s); // plan.js redraws after a re-plan; this covers the ones that don't
}

function wire(el, s) {
  s.observer = new MutationObserver(() => {
    if (el.hidden) {
      clearViz(s);
      clearPreview(s);
      clearLinks(s);
      clearMap(s);
      setPeek(el, s, false);
      s.fitted = false;
      if (!s.keepDoor) (s.door = null), (s.view = "home");
    }
  });
  s.observer.observe(el, { attributes: true, attributeFilter: ["hidden"] });
  el.addEventListener("whymap:door", (e) => showDoor(el, s, e.detail.id));
  // round 4 #7: a reason picked in the explorer rings its doors on the map; Add selected goes through the preview tray
  el.addEventListener("whyviz:logi", (e) => {
    const ids = e.detail?.ids ?? [];
    if (ids.length) { s.picks.set("logi", { title: "Doors left off for that reason", ids }); s.pick = "logi"; } else if (s.pick === "logi") { s.picks.delete("logi"); s.pick = null; }
    const tray = $(".w-tray", el);
    if (tray) tray.remove();
    if (s.pick === "logi") el.insertAdjacentHTML("beforeend", trayHTML(s));
    paintSelection(el, s, { fit: false }); // round 6 #1: a reason chip rings its doors where the map is; the camera stays
  });
  el.addEventListener("whyviz:add", (e) => {
    const ids = e.detail?.ids ?? [];
    if (!ids.length) return;
    tryChange(el, s, { kind: "add", ids, venues: Object.fromEntries(ids.map((id) => [id, venueOf(s, id)])) }, () => render(el, s), { from: e.detail.from ?? null });
  });
  setCanAdd(() => S.can("addDoor"));
  el.addEventListener("click", (e) => {
    if (pvClick(el, s, e, { render: () => render(el, s) })) return;
    if (explorerClick(el, s, e, () => vizRefresh(el, s))) return;
    const th = e.target.closest("[data-th-sel],[data-th-add],[data-th-addall],[data-th-ask],[data-th-fix],[data-th-open]");
    if (th) return threadClick(el, s, th);
    const ar = e.target.closest("[data-wv-area]");
    if (ar) return openArea(el, s, ar.dataset.wvArea);
    const wt = e.target.closest("[data-wv-thread]");
    if (wt) { (s.thread ??= { sel: null, asked: false, model: null, for: null }).sel = wt.dataset.wvThread; s.thread.asked = false; s.door = null; return setView(el, s, "plan"); }
    const dy = e.target.closest("[data-wv-day]");
    if (dy) return (s.ringDay = +dy.dataset.wvDay), ringMount(el, s);
    const pa = e.target.closest("[data-addpv]");
    if (pa) return (s.door = null), (s.view = "home"), render(el, s), previewAdd(el, s, pa.dataset.addpv, () => render(el, s));
    const w = e.target.closest("[data-w]")?.dataset.w;
    if (w === "close") return closeDrawer(el);
    if (e.target.closest("[data-w-settings]")) return document.getElementById("t-settings")?.click(); // intuitiveness audit #8
    if (w === "list") return s.door ? showDoor(el, s, null) : setView(el, s, "home");
    if (w === "clear") return setPick(el, s, null);
    if (w === "peek") return setPeek(el, s, true);
    if (w === "back") return setPeek(el, s, false);
    const fx = e.target.closest("[data-fix]");
    if (fx) return runFix(el, s, s.fixes.get(fx.dataset.fix));
    if (e.target.closest('[data-wc="room"]')) return openDeepDive(el, s, s.door);
    const gq = e.target.closest("[data-getq]");
    if (gq) return getFromQloo(el, s, gq.dataset.getq);
    const o = e.target.closest("[data-open]");
    if (o) return openStop(el, s, o.dataset.open);
    const dr = e.target.closest("[data-door]");
    if (dr) return (s.q = ""), showDoor(el, s, dr.dataset.door);
    const mo = e.target.closest("[data-more]");
    if (mo) return (s.open[mo.dataset.more] = !s.open[mo.dataset.more]), render(el, s);
    const v = e.target.closest("[data-view]");
    if (v) return setView(el, s, v.dataset.view);
    const p = e.target.closest("[data-pick]");
    if (p) setPick(el, s, p.dataset.pick);
  });
  el.addEventListener("toggle", (e) => { if (e.target.classList?.contains("w-how")) s.howOpen = e.target.open; }, true);
  el.addEventListener("input", (e) => {
    if (!e.target.classList.contains("w-findbox")) return;
    s.q = e.target.value;
    s.refocus = true;
    render(el, s);
  });
  el.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      if (s.door) showDoor(el, s, null);
      else if (s.view !== "home") setView(el, s, "home");
      else closeDrawer(el);
    }
  });
}

// the pictures that read the shared control state (ui/whyviz/state.js), redrawn in place after a control or a preview
function vizRefresh(el, s) {
  explorerRefresh(el, s);
  bumpRefresh(el, s);
}

// a tile's view; "See it on the map" lights the doors left out beside the plan's
function setView(el, s, view) {
  s.view = view ?? "home";
  s.open = {};
  s.q = "";
  s.pick = view === "map" ? "out" : null;
  s.viewFresh = true;
  render(el, s);
  el.scrollTop = 0; // round 4 #4 (Jard 10-27: "when i click doors deep dive, it doesn't start at the top"): every view opens at its top
  paintSelection(el, s, { fit: view === "map" });
  $("h3", el)?.setAttribute("tabindex", "-1");
  $("h3", el)?.focus({ preventScroll: true });
}

function showDoor(el, s, id) {
  if (id !== s.door) s.howOpen = false; // each door's fold starts closed
  s.door = id;
  setPeek(el, s, false);
  render(el, s);
  paintCur(s, id ? pointOf(s, id) : null);
  if (id) paintLinks(s, id); else clearLinks(s);
  const p = id && pointOf(s, id);
  const map = s.ctx.map;
  if (p && map && !narrow()) map.easeTo({ center: p, zoom: Math.max(map.getZoom(), 13), duration: reduced() ? 0 : 500 });
  $(id ? ".w-dname" : "h3", el)?.setAttribute("tabindex", "-1");
  $(id ? ".w-dname" : "h3", el)?.focus({ preventScroll: true });
}

function setPick(el, s, key) {
  s.pick = key && key !== s.pick ? key : null;
  render(el, s);
  paintSelection(el, s, { fit: true });
}

function closeDrawer(el) {
  const b = el.closest(".route")?.querySelector('[data-drawer="why"]');
  if (b) b.click();
  else el.hidden = true;
}

function setPeek(el, s, on) {
  s.peek = on && narrow();
  el.classList.toggle("w-peek", s.peek);
  let bar = $(".w-peekbar", el);
  if (s.peek && !bar) {
    bar = document.createElement("div");
    bar.className = "w-peekbar";
    el.prepend(bar);
  }
  if (bar) {
    const p = s.pick && s.picks?.get(s.pick);
    bar.innerHTML = s.peek ? `<span>${p ? `<b>${esc(p.title)}</b> · ${plural(p.ids.length, "door")} ringed` : "Your plan's doors, in their days' colours"}</span><button type="button" class="btn sm primary" data-w="back">Back to the list</button>` : "";
    bar.hidden = !s.peek;
  }
  if (s.peek) document.getElementById("plan-map")?.scrollIntoView({ block: "start", behavior: reduced() ? "auto" : "smooth" });
}

function openStop(el, s, id) {
  if (!s.ctx.plan.venues[id]) return;
  if (narrow()) setPeek(el, s, true);
  else closeDrawer(el); // the stop opens in the left column, where this panel is
  window.dispatchEvent(new CustomEvent("doors:open-stop", { detail: { id, day: s.m.dayOf.get(id) ?? null } }));
}

async function openDeepDive(el, s, id) {
  if (!id) return;
  const city = s.data.city ?? {};
  const v = venueOf(s, id);
  const data = { city: s.ctx.plan.venues[id] || city.sisterVenues?.[id] || !v ? city : { ...city, sisterVenues: { ...(city.sisterVenues ?? {}), [id]: v } }, routes: s.ctx.routes, captured: s.ctx.captured };
  if (narrow()) setPeek(el, s, false);
  await openRoom(id, data);
}

// ---------- WHY-VIZ-SPEC §4.5 (lane 2): picture 5 in the Deep Dive view, its thread panel and the agent's answer ----------
// State on s.thread: {sel (the selected door), asked (the agent card is open), model, for (the Why model it was built
// from)}. The model is rebuilt on every re-plan with the last layout as its seed, so nodes don't jump. The preview block
// (Try a change's) shows in the panel: Add / Add all / the fixes run tryChange, Apply and Cancel are the same buttons.
// WHY-VIZ-SPEC §4.4: picture 4 (the day ring) at the top of the Deep Dive view; the day tabs set s.ringDay (the plan's
// selected day until the rep picks one here)
function ringMount(el, s) {
  const host = $('[data-wv-slot="ring"]', el);
  if (!host || !s.m) return;
  try {
    const sel = S.getSelectedDay();
    const di = Number.isInteger(s.ringDay) && s.ctx.plan.days[s.ringDay] ? s.ringDay : Number.isInteger(sel) ? sel : null;
    mountRing(host, ringModel({ plan: s.ctx.plan, dayIndex: di, venues: s.m.venues }), { narrow: narrow() });
  } catch (e) { console.error(e); }
}
let threadSeq = 0;
function threadMount(el, s) {
  const host = $('[data-wv-slot="thread"]', el);
  if (!host || !s.m) return;
  const t = (s.thread ??= { sel: null, asked: false, model: null, for: null });
  if (t.for !== s.m) {
    try {
      t.model = threadModel({ sv: s.m.sv, plan: s.ctx.plan, city: s.data.city, route: s.m.route, profile: s.ctx.profile, famous: s.ctx.famous, prev: t.model?.layout ?? null });
      t.model.key = ++threadSeq;
      t.for = s.m;
    } catch (e) { console.error(e); return; }
  }
  const pv = s.pv?.change?.kind === "add" ? s.pv : null;
  const added = pv ? pv.change.ids ?? [pv.change.id] : [];
  const days = pv?.res ? Object.fromEntries(pv.res.diff.inn.map((x) => [x.id, x.day ? x.day[0].toUpperCase() + x.day.slice(1) : ""])) : {};
  mountThread(host, {
    model: t.model, sel: t.sel, added, days, cityName: s.ctx.plan.city.name, canAdd: S.can("addDoor"), editTo: s.ctx.editTo ?? "", asked: t.asked, asking: t.asking, answer: t.answer, pv: s.pv ? pvHTML(s) : "", openAgent: !t.answer,
    onSelect: (id) => { t.sel = id; t.asked = false; threadAskDone(t); t.answer = null; threadMount(el, s); $(".wv-th-phead h5", host)?.scrollIntoView({ block: "nearest", behavior: reduced() ? "auto" : "smooth" }); },
  });
}
const ASK_MS = 25000;
function threadAskDone(t) {
  if (t.onReply) window.removeEventListener("doors:agent-reply", t.onReply);
  clearTimeout(t.askTimer);
  t.onReply = null;
  t.asking = false;
}
function threadAskAgent(el, s, t, sel) {
  threadAskDone(t);
  t.answer = null;
  const ask = threadAsk(t.model, sel, { cityName: s.ctx.plan.city.name });
  if (!ask || !ask.doors.length) return;
  t.asking = true;
  t.onReply = (e) => {
    const r = e.detail ?? {};
    if (!r.whynot) return; // another turn's reply
    threadAskDone(t);
    t.answer = { whynot: r.whynot, by: r.by ?? null, model: r.model ?? null, resting: Boolean(r.resting) };
    if (t.asked && !el.hidden) threadMount(el, s);
  };
  window.addEventListener("doors:agent-reply", t.onReply);
  t.askTimer = setTimeout(() => { threadAskDone(t); if (t.asked && !el.hidden) threadMount(el, s); }, ASK_MS);
  window.dispatchEvent(new CustomEvent("doors:ask", { detail: { id: sel, whynot: ask, send: true } }));
}
function threadClick(el, s, b) {
  const t = s.thread, d = b.dataset, again = () => render(el, s);
  const venueFor = (id) => t?.model?.byId.get(id)?.venue ?? venueOf(s, id);
  if (d.thAdd || d.thAddall) { // through the preview (whatif kind add): the tray shows each door's day, Apply makes it real
    // (the thread panel's Add / Add all, the agent card's, and picture 2's area sheet)
    const cur = s.pv?.change?.kind === "add" ? s.pv.change.ids ?? [s.pv.change.id] : [];
    const more = d.thAdd ? [d.thAdd] : t?.model ? threadOf(t.model, d.thAddall).filter((r) => r.st.k !== "plan" && Number.isFinite(r.n.lat)).map((r) => r.n.id) : [];
    const ids = [...new Set([...cur, ...more])];
    if (!ids.length) return;
    return tryChange(el, s, { kind: "add", ids, venues: Object.fromEntries(ids.map((id) => [id, venueFor(id)])) }, again);
  }
  if (!t?.model) return;
  if (d.thSel) { t.sel = d.thSel; t.asked = false; threadAskDone(t); t.answer = null; return threadMount(el, s); }
  if (d.thAsk) { // the rules card at once; the Doors Agent's own answer when it comes (agent2's whynot ask, 25 s at most)
    t.asked = !t.asked;
    if (t.asked) threadAskAgent(el, s, t, d.thAsk);
    else threadAskDone(t);
    threadMount(el, s);
    if (t.asked) $(".wv-th-agent", el)?.scrollIntoView({ block: "nearest", behavior: reduced() ? "auto" : "smooth" });
    return;
  }
  if (d.thFix === "famous") return tryChange(el, s, { kind: "famous", on: true }, again);
  if (d.thFix === "rooms") return tryChange(el, s, { kind: "rooms", rooms: [...new Set([...(s.ctx.profile.rooms ?? []), d.type])] }, again);
  if (d.thFix === "lock") return tryChange(el, s, { kind: "add", ids: [d.id], venues: { [d.id]: venueFor(d.id) }, date: d.date }, again);
  if (d.thOpen) { // the same question in Doors Agent (the model path; agent2's structured ask plugs in here)
    const ask = threadAsk(t.model, d.thOpen, { cityName: s.ctx.plan.city.name });
    if (!ask) return;
    const names = ask.doors.map((x) => x.name);
    window.dispatchEvent(new CustomEvent("doors:ask", { detail: { id: d.thOpen, prefill: `Why ${names.length === 1 ? "isn't" : "aren't"} ${andList(names.slice(0, 6))}${names.length > 6 ? ` and ${names.length - 6} more` : ""} on my plan? Qloo says they share ${ask.selected.name}'s crowd.` } }));
  }
}

// ---------- map: the plan's doors in their days' colours; a "Show on map" adds its doors, ringed ----------
const pad = () => (narrow() ? { top: 40, bottom: 40, left: 30, right: 30 } : { top: 80, bottom: 60, left: 60, right: 60 });
const pointOf = (s, id) => {
  const v = s.ctx.plan.venues[id] ?? s.m?.route.venues[id] ?? placeOf(s, id);
  return v && Number.isFinite(v.lat) && Number.isFinite(v.lon) ? [v.lon, v.lat] : null;
};
function put(map, id, data) {
  const src = map.getSource(id);
  if (src) src.setData(data);
  else map.addSource(id, { type: "geojson", data });
}
const fc = (features) => ({ type: "FeatureCollection", features });
const placeColour = (d) => (d.fate === "plan" && !d.like ? DAYS[(d.day ?? 0) % DAYS.length] : OUT_FILL);

function paintMap(el, s, { fit = false } = {}) {
  const map = s.ctx.map;
  if (!map || !s.m) return;
  const go = () => {
    try {
      const feats = [...mapPlaces(s.m.sv)].reverse().sort((a, b) => (a.fate === "plan") - (b.fate === "plan"))
        .map((d) => ({ type: "Feature", properties: { id: d.id, c: placeColour(d), plan: d.fate === "plan" && !d.like ? 1 : 0 }, geometry: { type: "Point", coordinates: [d.lon, d.lat] } }));
      put(map, SRC, fc(feats));
      if (!map.getLayer("why-rooms")) {
        map.addLayer({
          id: "why-rooms", type: "circle", source: SRC,
          paint: {
            "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, ["case", ["==", ["get", "plan"], 1], 6, 3.6], 14, ["case", ["==", ["get", "plan"], 1], 11, 7]],
            "circle-color": ["get", "c"], "circle-stroke-color": "#FFFFFF", "circle-stroke-width": 1, "circle-opacity": 0.95,
          },
        });
        // a pin clicked while this is open opens that door's view here
        s.onMapClick = (e) => { const f = e.features?.[0]; if (f) showDoor(el, s, f.properties.id); };
        s.onEnter = () => { map.getCanvas().style.cursor = "pointer"; };
        s.onLeave = () => { map.getCanvas().style.cursor = ""; };
        map.on("click", "why-rooms", s.onMapClick);
        map.on("mouseenter", "why-rooms", s.onEnter);
        map.on("mouseleave", "why-rooms", s.onLeave);
      }
      paintAreas(map, s.am, { onTap: (key) => openArea(el, s, key) }); // picture 2: the clouds under the plan's layers
      paintSelection(el, s, { fit: false });
      if (s.door) paintCur(s, pointOf(s, s.door));
      // ease audit 3 #8: it opens on your route (the plan's doors), not on every ranked door across the metro; a Show on
      // map zooms out to the doors it names
      const mine = feats.filter((f) => f.properties.plan).map((f) => f.properties.id);
      if (fit && feats.length) fitIds(el, s, mine.length ? mine : s.ctx.plan.pool.ids);
    } catch (e) { console.error(e); }
  };
  if (map.isStyleLoaded()) go();
  else map.once("idle", go);
}

function paintCur(s, p) {
  const map = s.ctx?.map;
  if (!map?.getSource?.(SRC)) return;
  try {
    put(map, CUR_SRC, fc(p ? [{ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: p } }] : []));
    if (!map.getLayer("why-cur")) map.addLayer({ id: "why-cur", type: "circle", source: CUR_SRC, paint: { "circle-radius": 14, "circle-color": "rgba(224,123,42,0.18)", "circle-stroke-color": "#E07B2A", "circle-stroke-width": 3 } });
  } catch (e) { console.error(e); }
}

function paintSelection(el, s, { fit = false } = {}) {
  const map = s.ctx.map;
  if (!map || !map.getSource?.(SRC)) return;
  try {
    const p = s.pick && s.picks?.get(s.pick);
    const ids = p?.ids ?? [];
    put(map, SEL_SRC, fc(ids.map((id) => pointOf(s, id)).filter(Boolean).map((c) => ({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: c } }))));
    if (!map.getLayer("why-sel-halo")) {
      map.addLayer({ id: "why-sel-halo", type: "circle", source: SEL_SRC, paint: { "circle-radius": 11, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": "#fff", "circle-stroke-width": 5 } });
      map.addLayer({ id: "why-sel", type: "circle", source: SEL_SRC, paint: { "circle-radius": 11, "circle-color": "rgba(0,0,0,0)", "circle-stroke-color": SEL_RING, "circle-stroke-width": 2.5 } });
    }
    // the plan's doors, plus the doors a "Show on map" holds; nothing else
    map.setFilter("why-rooms", ["any", ["==", ["get", "plan"], 1], ["in", ["get", "id"], ["literal", ids]]]);
    if (map.getLayer("why-cur")) map.moveLayer("why-cur");
    if (fit && ids.length) fitIds(el, s, ids);
  } catch (e) { console.error(e); }
}

function fitIds(el, s, ids) {
  const map = s.ctx.map;
  const pts = ids.map((id) => pointOf(s, id)).filter(Boolean);
  if (!pts.length) return;
  const lons = pts.map((p) => p[0]), lats = pts.map((p) => p[1]);
  try {
    map.fitBounds([[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]], { padding: pad(el), maxZoom: 14.5, duration: reduced() ? 0 : 700 });
  } catch { /* a padding larger than the map: leave the view */ }
}

function clearMap(s) {
  const map = s.ctx?.map;
  if (!map) return;
  try {
    if (s.onMapClick) (map.off("click", "why-rooms", s.onMapClick), map.off("mouseenter", "why-rooms", s.onEnter), map.off("mouseleave", "why-rooms", s.onLeave), (map.getCanvas().style.cursor = ""));
    s.onMapClick = null;
    clearAreas(map);
    s.area = null;
    for (const l of [...LAYERS].reverse()) if (map.getLayer(l)) map.removeLayer(l);
    for (const src of [CUR_SRC, SEL_SRC, SRC]) if (map.getSource(src)) map.removeSource(src);
  } catch { /* the map is gone with the view */ }
}
