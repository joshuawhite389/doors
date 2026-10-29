// The profile form, #/new (SPEC-V2 §3.2, fields 1–9; mockup frames 2 and 8). Field 7 is the usual week (Jard 10-24:
// days that repeat every week, each with its own hours and, optionally, its own start) and changes to one date; fields 8 (your pitch) and 9 (doors you already know) are optional.
import { ROOMS, SUPPORT, roomChoices, defaultRooms, validateProfile, dayChip, niceDate, isoDate, dayOf, MAX_DRINKS, MAX_POURS, poursOf, startChips, chipStart, pinLabel, emptyProfile, formFilled, roomOf, FORMATS, SELLS, BASIS, ageChoices, suggestAsk, emptyProduct, emptyDrinkers, emptyVariant, sellsOf, MAX_VARIANTS } from "../lib/profile.js";
import { examples, exampleOf, fictionLine, cityFromText, cityText } from "../lib/examples.js";
import { mergeLists, knownHint, KEEP_ON_ROUTE } from "../lib/pool.js";
import { genreLabel, DAYS } from "../lib/core.js";
import { emptyWeek, weekFromWindows, pruneChanges, weekDates, hoursOn, setChange, addDays, weekdayOf, DATE_RE as WEEK_DATE } from "../lib/week.js"; // the usual week
import { $, $$, esc, debounce, cap } from "./dom.js";
import { searchBrands, searchRooms, loadDrinks, geocode, loadRoutes, locateCity } from "./data.js";
import { searchDrinks, heldMatch, fold } from "../lib/drinks.js";
import { createMap, addStart } from "./map.js";
import { planRow, ADD_CITY } from "../lib/plans.js";
import { autocomplete } from "./data.js";
import { mountRules } from "./rules.js"; // Your rules: brand-wide, so in Edit profile (ease audit #9)
import { hrefFor } from "../lib/router.js";

if (!document.querySelector('link[href="/css/plans.css"]')) document.head.append(Object.assign(document.createElement("link"), { rel: "stylesheet", href: "/css/plans.css" }));

// r2 (Jard 10-24: "we need to highlight required fields, i missed this"): every required label says so; the mark
// turns from green to orange on a field still missing once the form has been started (refresh)
const REQ = ` <span class="req">Required</span>`;
// the field each required key belongs to (the Required marks and the "Still needed" button)
const FIELD_OF = { format: "#fd-product", name: "#fd-name", drinks: "#fd-drinks", rooms: "#fd-rooms", ask: "#fd-ask", city: "#fd-city", start: "#fd-start", windows: "#fd-windows", visitMin: "#fd-windows" };
const priceLabel = (format) => (format === "keg" ? "Price per keg" : format === "bottles" || format === "cans" ? "Price per case" : "Price"); // r2: a keg isn't sold by the case
const DEFAULT_FROM = "14:00";
const DEFAULT_TO = "18:00";
const GATED = ["format", "name", "drinks", "rooms", "ask", "city", "start", "windows", "visitMin"];
const NEED = { format: "what your drink comes in", name: "a name to sign your messages", drinks: "a brand your drinker drinks (or a door that pours you)", ask: "your ask", city: "a city", rooms: "door types", start: "where your day starts", windows: "when you're free", visitMin: "time at each door" };
// group 3 #5: the form in parts. "all": the first time (the brand and its first city); "brand": Edit my brand; "city":
// add or edit one city under the saved brand. An error belongs to the part its field is in.
const CITY_ERRORS = new Set(["city", "start", "windows", "visitMin", "maxPerDay", "maxByDate"]);
const inPart = (mode, k) => mode === "all" || (mode === "city") === CITY_ERRORS.has(k);
// intuit audit 1b (smaller): at 320 px the long placeholder was cut ("Street address, or drop"); a narrow form says
// "Street address", as the phone does, with Drop a pin the button beside it
const narrowForm = () => typeof matchMedia === "function" && matchMedia("(max-width:520px)").matches;
const SEARCH_OFF = "Address search is off right now: pick a starting point below or drop a pin.";
const PIN_ONLY = "Drop a pin on the map to set your start.";
const US_VIEW = { center: [-98.5, 39.5], zoom: 3.4 }; // a city Doors has no map centre for: the pin map starts here
// the demo's words, and the same for every other example (lib/examples.js)
const fiction = (x) => (x.key === "maya" ? "Tidewell and Maya are made up; every bar and restaurant is real." : fictionLine(x));

// onChange(profile) after every edit; onBuild(profile) on "Build my plan". Returns a cleanup function.
// editing: {brand, city, copy?} when the form holds a saved plan's profile (or a copy of one); plans: mountPlans' opts
// for the "Your plans" list above the form.
// The Examples row (owner review 6: a made-up rep per drinker Doors holds, Maya first) and "Clear the form" replace the
// profile in place (same object) and draw the form again.
export function renderProfile(root, opts) {
  const replace = (p, next) => {
    for (const k of Object.keys(p)) delete p[k];
    Object.assign(p, next);
    opts.onChange(p);
    cleanup();
    cleanup = renderForm(root, { ...opts, profile: p, onSample, onClear });
    $("#f-brand", root)?.focus();
  };
  const onSample = (p, key) => replace(p, structuredClone(exampleOf(key).profile));
  const onClear = (p) => replace(p, emptyProfile());
  let cleanup = renderForm(root, { ...opts, onSample, onClear });
  const done = () => cleanup();
  done.sync = () => cleanup.sync?.(); // the form drawn again from the profile (see renderForm)
  return done;
}

// round 4 #6: Settings opens a form at one field (#/brand?field=drinks, #/city?city=…&field=windows): the form scrolls
// to it, opens it when it is folded, and puts the focus in it (lib/settings.js names the fields)
const FIELD_AT = { brand: "#f-brand", what: "#f-what", product: "#fd-product", name: "#fd-name", drinks: "#fd-drinks", pours: "#fd-pours", rooms: "#fd-rooms", drinkers: "#fd-drinkers", ask: "#fd-ask", pitch: "#fd-pitch", city: "#fd-city", start: "#fd-start", windows: "#fd-windows", visit: "#f-visit", cap: "#f-cap", sells: "#fd-sells", known: "#fd-known" };
function goToField(root, field) {
  const el = FIELD_AT[field] && $(FIELD_AT[field], root);
  if (!el) return false;
  const box = el.closest(".field, details, fieldset, .visit") ?? el;
  const det = el.closest("details");
  if (det) det.open = true;
  box.classList.add("here");
  setTimeout(() => box.classList.remove("here"), 2600);
  const target = el.matches("input, select, button") ? el : $("input:not([type=hidden]), select, button, [tabindex]", el);
  requestAnimationFrame(() => {
    box.scrollIntoView({ block: "center", behavior: "smooth" });
    target?.focus({ preventScroll: true });
  });
  return true;
}

function renderForm(root, { index, profile, onChange, onBuild, onSample, onClear, editing: editOf = null, plans = null, rules = null, mode = "all", cancel = null, back = null, brandHref = null, field = null }) {
  const p = profile;
  const touched = new Set();
  let dirty = false; // round 8: something changed since the form opened (Back asks before it drops the change)
  let pin = null; // {map, marker}
  let live = null; // live search rows for the current query, or "loading" / {error}
  let hl = 0;
  const edit = mode !== "all" || Boolean(editOf && !editOf.copy); // a saved brand or city: no examples, a Cancel (audit 2 #6)
  const cityName = editOf ? cityLabel(editOf, index, p) : "";
  const title = mode === "brand" ? "Edit my brand" : mode === "city" ? (editOf ? `Edit ${esc(cityName)}` : "Add a city") : "Your brand";
  // round 4 #6: a saved brand's or city's form says Save; the plan shows what the change does and applies it, with Undo
  const buildLabel = mode === "brand" ? "Save" : mode === "city" && !editOf ? "Build the plan &nbsp;→" : edit ? "Save" : "Build my plan &nbsp;→";

  root.innerHTML = `
  <div class="profile">
    <form class="pform" novalidate>
      ${back ? `<div class="fback-row"><a class="lnk fback" id="f-back" href="${esc(back)}">← Back</a><span class="fback-ask" id="f-back-ask" role="alert" hidden></span></div>` : ""}<!-- round 8 (Jard 10-28): a brand or city form's Back, nothing saved -->
      <h2>${title}</h2>
      ${partNote(mode, editOf, p)}
      ${edit || (editOf && !p.sample) ? "" : examplesHTML(p)}
      <div class="part" data-part="brand"${mode === "city" ? " hidden" : ""}>
      <div class="row2">
        <div class="field"><label for="f-brand">Brand name</label><input class="inp" id="f-brand" autocomplete="off" placeholder="e.g. Tidewell"></div>
        <div class="field"><label for="f-what">What you make</label><input class="inp" id="f-what" autocomplete="off" placeholder="e.g. Non-alcoholic hazy IPA"></div>
      </div>
      <fieldset class="field product" id="fd-product"><legend class="lbl">Your product</legend>
        <div id="variants"></div>
        <div class="err" data-err="format" hidden></div>
        <button type="button" class="btn line sm" id="add-variant">+ Add another variation</button>
        <div class="hint" id="variant-hint">If it comes in more than one way (a can and a keg, or two sizes), add each one with its own price.</div>
      </fieldset>
      <div class="field" id="fd-name"><label for="f-name">Sign your messages as${REQ}</label><input class="inp" id="f-name" autocomplete="name" placeholder="${esc(signerHint(p.brand))}">
        <div class="hint">Every drafted message ends with it.</div>
        <div class="err" data-err="name" hidden></div></div>
      <div class="field" id="fd-drinks">
        <label for="f-drinks">Your drinker also drinks…${REQ}</label>
        <div class="inp" id="drinks-box"><span id="drinks-tags" class="chips" style="gap:6px"></span>
          <input id="f-drinks" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="dd-drinks" autocomplete="off" placeholder="Type any brand"></div>
        <div class="dd" id="dd-drinks" role="listbox" hidden></div>
        <div class="hint">Up to three. A brand that just launched isn't in anyone's data yet; your drinker's other favourites are.</div>
        <div class="err" data-err="drinks" hidden></div>
      </div>
      <div class="field" id="fd-pours">
        <label for="f-pours">Doors that already pour you <span class="muted">(any city · optional)</span></label>
        <div class="inp" id="pours-box"><span id="pours-tags" class="chips" style="gap:6px"></span>
          <input id="f-pours" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="dd-pours" autocomplete="off" placeholder="A bar or restaurant"></div>
        <div class="dd" id="dd-pours" role="listbox" hidden></div>
        <div class="pcity"><input class="inp" id="f-pours-city" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="dd-pours-city" autocomplete="off" placeholder="Its city, e.g. Chicago, IL" aria-label="The city of the bar or restaurant that pours you">
          <div class="dd" id="dd-pours-city" role="listbox" hidden></div></div>
        <div class="hint">Up to three, any city. Doors finds doors in your opening city whose regulars are like theirs; with brands above, both count. If one is in your opening city, it can stay on your route.</div>
        <div class="err" data-err="pours" hidden></div>
      </div>
      <div class="field" id="fd-rooms"><span class="lbl" id="l-rooms">Door types${REQ}</span><div class="chips" id="rooms" role="group" aria-labelledby="l-rooms"></div>
        <div class="err" data-err="rooms" hidden></div></div>
      <details class="opt" id="fd-drinkers"${p.drinkers?.who || p.drinkers?.age || p.drinkers?.where ? " open" : ""}>
        <summary><b>Your drinkers</b> <span class="muted">optional</span></summary>
        <div class="field"><label for="f-who">Who they are</label><input class="inp" id="f-who" autocomplete="off" placeholder="e.g. Runners and craft beer fans who are cutting back"></div>
        <div class="row2">
          <div class="field"><label for="f-age">Age range</label><select class="inp" id="f-age" aria-describedby="age-hint"></select>
            <div class="hint" id="age-hint"></div></div>
          <div class="field"><label for="f-where">Where they drink</label><input class="inp" id="f-where" autocomplete="off" placeholder="e.g. Taprooms, music bars, after a run"></div>
        </div>
        <div class="field"><span class="lbl" id="l-basis">Do you know your drinkers, or is this your best guess or research?</span><div class="chips" id="basis" role="group" aria-labelledby="l-basis"></div></div>
      </details>
      <div class="field" id="fd-ask"><label for="f-ask">Your ask${REQ}</label>
        <div class="hint">What you ask each door for. Your messages and talking points use it.</div>
        <div class="asksug" id="ask-sug"></div>
        <input class="inp" id="f-ask" autocomplete="off" placeholder="Or write your own" aria-describedby="ask-sug">
        <div class="err" data-err="ask" hidden></div>
      </div>
      <details class="opt" id="fd-pitch"${p.pitch?.menuPrice || p.pitch?.support?.length ? " open" : ""}>
        <summary><b>Your pitch</b> <span class="muted">optional · feeds the talking points</span></summary>
        <div class="field"><span class="lbl" id="l-support">Support you offer</span><div class="chips" id="support" role="group" aria-labelledby="l-support"></div></div>
        <div class="field"><label for="f-menu">Their menu price for one drink</label><input class="inp" id="f-menu" autocomplete="off" inputmode="decimal" placeholder="e.g. $7" style="max-width:160px"></div>
      </details>
      ${rules ? `<div id="rules-host"></div>` : ""}
      </div>
      <div class="part" data-part="city"${mode === "brand" ? " hidden" : ""}>
      ${mode === "all" ? `<h3 class="parthead">Your city</h3>` : ""}
      <div class="field" id="fd-city"><label for="f-city">City${REQ}</label>
        <input class="inp" id="f-city" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="dd-city" autocomplete="off" placeholder="e.g. Denver, CO">
        <div class="dd" id="dd-city" role="listbox" hidden></div>
        <div class="err" data-err="city" hidden></div></div>
      <div class="field" id="fd-start">
        <label for="f-addr">Where your day starts${REQ}</label>
        <div class="addr"><input class="inp" id="f-addr" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="dd-addr" autocomplete="off" placeholder="${narrowForm() ? "Street address" : "Street address, or drop a pin on the map"}">
          <button type="button" class="btn line sm" id="pin-btn" aria-expanded="false">Drop a pin</button></div>
        <div class="dd" id="dd-addr" role="listbox" hidden></div>
        <div class="hint addroff" id="addr-off" role="status" hidden></div>
        <div class="startchips"><span class="muted small" id="l-chips">Or start from</span><div class="chips" id="start-chips" role="group" aria-labelledby="l-chips"></div></div>
        <div class="hint" id="start-hint"></div>
        <div class="pinmap" id="pinmap" hidden><div class="m"></div><div class="tip">Click the map to set your start</div></div>
        <div class="err" data-err="start" hidden></div>
      </div>
      <div class="field" id="fd-windows">
        <span class="lbl" id="l-days">When you're free${REQ}</span>
        <div class="hint" id="days-hint">The days you are usually free. They repeat every week, and Doors plans two weeks ahead.</div>
        <div class="chips" id="days" role="group" aria-labelledby="l-days"></div>
        <div class="wins" id="wins"></div>
        <div class="dates" id="fd-dates">
          <span class="lbl" id="l-dates">Change one date <span class="muted">(optional · that date only)</span></span>
          <div class="chips" id="dates" role="group" aria-labelledby="l-dates"></div>
          <div class="moreday"><label for="f-date">Another date</label><input type="date" id="f-date" class="dt"><button type="button" class="btn line sm" id="add-date">Add</button></div>
          <div class="wins" id="chg"></div>
        </div>
        <div class="err" data-err="windows" hidden></div>
        <div class="visit"><label for="f-visit">Time at each door${REQ}</label><input class="inp" id="f-visit" type="number" min="5" max="120" step="5" inputmode="numeric" style="min-height:38px;padding:6px 10px"><span class="muted">min</span></div>
        <div class="err" data-err="visitMin" hidden></div>
        <div class="visit"><label for="f-cap" style="white-space:nowrap">Most doors a day</label><select class="inp" id="f-cap" style="width:auto;flex:0 0 auto;min-height:38px;padding:6px 36px 6px 10px"><option value="">No limit</option>${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join("")}</select></div><!-- ease #13: the plan's "Up to [Any] doors a day" moved here -->
      </div>
      <div class="field" id="fd-sells"><span class="lbl" id="l-sells">How you sell in this city <span class="muted">(optional · pick both if you do both)</span></span><div class="chips" id="sells" role="group" aria-labelledby="l-sells"></div></div>
      <details class="opt" id="fd-known"${p.known?.length ? " open" : ""}>
        <summary><b>Doors to skip</b> <span class="muted">optional · you already call on them</span></summary>
        <div class="field"><label for="f-known">Doors you already call on</label>
          <input class="inp" id="f-known" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="dd-known" autocomplete="off" placeholder="Name of a bar or restaurant">
          <div class="dd" id="dd-known" role="listbox" hidden></div>
          <div class="hint" id="known-hint"></div>
          <div class="chips" id="known-tags" style="margin-top:8px"></div></div>
      </details>
      </div>
      <div class="build sticky"><button class="btn primary" id="build" type="submit">${buildLabel}</button>${cancel ? `<a class="btn line" id="f-cancel" href="${esc(cancel)}">Cancel</a>` : ""}<span class="need" id="need" aria-live="polite"></span></div>
    </form>
    <aside class="pside"><div class="pside-in">
      <h3>What happens next</h3>
      <p>Doors asks Qloo which bars and restaurants in your city have regulars who drink what your drinker drinks, keeps the ones open while you're out, and routes them from your start.</p>
      <p>Every stop gets a drafted message built from Qloo's profile of that door.</p>
    </div></aside>
  </div>`;

  const form = $("form", root);
  const changed = () => { dirty = true; onChange(p); refresh(); drawKnown(); }; // drawKnown: the ranked rooms follow city + drinker
  // round 8: ← Back leaves without saving; with a change on the form it asks first, in place (never a browser dialog)
  const backEl = $("#f-back", root);
  if (backEl) {
    const ask = $("#f-back-ask", root);
    backEl.addEventListener("click", (e) => {
      if (!dirty) return;
      e.preventDefault();
      ask.hidden = false;
      ask.innerHTML = `Discard changes? <a class="btn sm danger" href="${esc(back)}">Discard</a> <button type="button" class="btn line sm" data-back="keep">Keep editing</button>`;
      $("[data-back]", ask).focus();
    });
    ask.addEventListener("click", (e) => {
      if (!e.target.closest("[data-back=\"keep\"]")) return;
      ask.hidden = true;
      ask.innerHTML = "";
      backEl.focus();
    });
  }
  const city = () => index.cities.find((c) => c.key === p.city);

  // ---------- 1, 2: brand, what you make ----------
  $("#f-brand", root).value = p.brand;
  $("#f-what", root).value = p.what;
  $("#f-brand", root).addEventListener("input", (e) => { p.brand = e.target.value; delete p.sample; drawSigner(); changed(); });
  $("#examples", root)?.addEventListener("click", (e) => { const b = e.target.closest("[data-ex]"); if (b) onSample(p, b.dataset.ex); });
  $("#f-clear", root)?.addEventListener("click", () => onClear(p));
  $("#f-what", root).addEventListener("input", (e) => {
    p.what = e.target.value;
    const offered = roomChoices(p.what).map((r) => r.key);
    if (!p.roomsTouched) p.rooms = defaultRooms(p.what).filter((k) => offered.includes(k));
    else p.rooms = p.rooms.filter((k) => offered.includes(k));
    drawRooms();
    drawAsk();
    drawAge();
    changed();
  });
  // N1: the signer, required; N2: the ask the notes use when "Your ask" is blank, shown on the field
  const drawSigner = () => { $("#f-name", root).placeholder = signerHint(p.brand); };
  // group 3 #4: Doors suggests the ask from the product; the rep takes it or writes their own, before the plan
  const drawAsk = () => {
    const sug = suggestAsk(p);
    const mine = String(p.pitch?.ask ?? "").trim();
    $("#ask-sug", root).innerHTML = mine && mine === sug
      ? `<span>Using Doors' suggestion: <b>${esc(sug)}</b></span>`
      : `<span>Doors suggests: <b>${esc(sug)}</b></span> <button type="button" class="btn line sm" id="ask-use">${mine ? "Use this instead" : "Use this"}</button>`;
  };
  $("#ask-sug", root).addEventListener("click", (e) => {
    if (!e.target.closest("#ask-use")) return;
    p.pitch.ask = suggestAsk(p);
    $("#f-ask", root).value = p.pitch.ask;
    touched.add("ask");
    drawAsk();
    changed();
  });

  // ---------- group 3 #4: the product (format required) and the drinkers (optional) ----------
  p.product = { ...emptyProduct(), ...(p.product ?? {}) };
  p.drinkers = { ...emptyDrinkers(), ...(p.drinkers ?? {}) };
  // r2 (Jard 10-24: "what if their product comes in multiple variations?"): one block per variation. The first is
  // p.product with its price in p.pitch.price (its fields keep their ids: the demo and the checks fill them); each
  // further one is p.variants[i - 1] with its own price (lib/profile.js variantsOf).
  const vOf = (i) => (i ? p.variants[i - 1] : p.product);
  const vPrice = (i) => (i ? vOf(i).price : p.pitch.price) ?? "";
  const vId = (base, i) => (i ? `${base}-${i}` : base);
  const variantHTML = (i) => {
    const x = vOf(i);
    return `<div class="variant" data-v="${i}">
      ${i ? `<div class="vhead"><b>Variation ${i + 1}</b><button type="button" class="btn ghost sm" data-act="remove" aria-label="Remove variation ${i + 1}">Remove</button></div>` : ""}
      <span class="lbl sub" id="${vId("l-format", i)}">It comes in${REQ}</span><div class="chips" id="${vId("formats", i)}" data-role="formats" role="group" aria-labelledby="${vId("l-format", i)}">${FORMATS.map((f) => `<button type="button" class="tog" data-k="${f.key}" aria-pressed="${x.format === f.key}">${esc(f.label)}</button>`).join("")}</div>
      <input class="inp fother" id="${vId("f-format-other", i)}" data-f="formatOther" autocomplete="off" placeholder="What it comes in, e.g. pouches" aria-label="What it comes in" value="${esc(x.formatOther ?? "")}"${x.format === "other" ? "" : " hidden"}>
      <div class="row3">
        <div><label for="${vId("f-size", i)}" class="small">Size <span class="muted">(optional)</span></label><input class="inp" id="${vId("f-size", i)}" data-f="size" autocomplete="off" placeholder="${i ? "e.g. sixtel" : "e.g. 12 oz"}" value="${esc(x.size ?? "")}"></div>
        <div><label for="${vId("f-abv", i)}" class="small">ABV <span class="muted">(optional)</span></label><input class="inp" id="${vId("f-abv", i)}" data-f="abv" autocomplete="off" inputmode="decimal" placeholder="e.g. 5%" value="${esc(x.abv ?? "")}">
          <label class="check small"><input type="checkbox" id="${vId("f-na", i)}" data-f="na"${x.na ? " checked" : ""}> Non-alcoholic</label></div>
        <div><label for="${vId("f-price", i)}" class="small"><span class="punit">${priceLabel(x.format)}</span> <span class="muted">(optional)</span></label><input class="inp" id="${vId("f-price", i)}" data-f="price" autocomplete="off" placeholder="${i ? "e.g. $165 a sixtel" : "e.g. $42 a case of 24"}" value="${esc(vPrice(i))}"></div>
      </div></div>`;
  };
  const drawProduct = () => {
    p.variants = (Array.isArray(p.variants) ? p.variants : []).slice(0, MAX_VARIANTS - 1).map((v) => ({ ...emptyVariant(), ...v }));
    $("#variants", root).innerHTML = [0, ...p.variants.map((_, i) => i + 1)].map(variantHTML).join("");
    $("#add-variant", root).hidden = p.variants.length >= MAX_VARIANTS - 1;
    drawSells();
  };
  const drawSells = () => {
    const on = sellsOf(p);
    $("#sells", root).innerHTML = SELLS.map((f) => `<button type="button" class="tog" data-k="${f.key}" aria-pressed="${on.includes(f.key)}">${esc(f.label)}</button>`).join("");
  };
  $("#variants", root).addEventListener("click", (e) => {
    const blk = e.target.closest("[data-v]");
    if (!blk) return;
    const i = +blk.dataset.v;
    if (e.target.closest('[data-act="remove"]')) {
      p.variants.splice(i - 1, 1);
      touched.add("format");
      drawProduct();
      changed();
      $("#add-variant", root).focus();
      return;
    }
    const b = e.target.closest('[data-role="formats"] [data-k]');
    if (!b) return;
    const x = vOf(i);
    x.format = x.format === b.dataset.k ? "" : b.dataset.k;
    touched.add("format");
    for (const t of $$(".tog", b.parentElement)) t.setAttribute("aria-pressed", String(t.dataset.k === x.format));
    const other = $(".fother", blk);
    other.hidden = x.format !== "other";
    $(".punit", blk).textContent = priceLabel(x.format);
    if (i === 0) drawAsk();
    changed();
    if (x.format === "other") other.focus();
  });
  const onVariantField = (e) => {
    const el = e.target.closest("[data-f]");
    const blk = e.target.closest("[data-v]");
    if (!el || !blk) return;
    const i = +blk.dataset.v;
    const f = el.dataset.f;
    if (f === "price") { if (i) vOf(i).price = el.value; else p.pitch.price = el.value; }
    else vOf(i)[f] = f === "na" ? el.checked : el.value;
    if (f === "formatOther") touched.add("format");
    if (i === 0 && f === "size") drawAsk();
    changed();
  };
  $("#variants", root).addEventListener("input", onVariantField);
  $("#variants", root).addEventListener("change", (e) => { if (e.target.type === "checkbox") onVariantField(e); });
  $("#add-variant", root).addEventListener("click", () => {
    p.variants.push(emptyVariant());
    drawProduct();
    changed();
    $(`[data-v="${p.variants.length}"] .tog`, root)?.focus();
  });
  // r2 (Jard 10-24): how you sell is this city's, and both can be true (self-distributed here, a distributor there)
  $("#sells", root).addEventListener("click", (e) => {
    const b = e.target.closest("[data-k]");
    if (!b) return;
    const on = new Set(sellsOf(p));
    on.has(b.dataset.k) ? on.delete(b.dataset.k) : on.add(b.dataset.k);
    p.sells = SELLS.map((s) => s.key).filter((k) => on.has(k));
    delete p.product.sells; // a profile saved before r2 kept one here
    drawSells();
    changed();
  });
  // r2 (Jard 10-24): 21–24 and 55 and over too. A brand Doors holds has every band's list; for any other the list is
  // fetched with the plan.
  const drawAge = () => {
    const opts = ageChoices(p);
    if (p.drinkers.age && !opts.some((a) => a.key === p.drinkers.age)) p.drinkers.age = "";
    $("#f-age", root).innerHTML = `<option value="">Any age</option>${opts.map((a) => `<option value="${a.key}">${esc(a.label)}</option>`).join("")}`;
    $("#f-age", root).value = p.drinkers.age;
    drawAgeHint();
  };
  const drawAgeHint = () => {
    const held = p.drinks.length && p.drinks.every((d) => d.ready);
    $("#age-hint", root).textContent = !p.drinkers.age
      ? "Qloo's age groups: 21–24, 25–34, 35–44, 45–54, and 55 and over. Doors puts the doors Qloo ranks for that group first."
      : held || !p.drinks.length
        ? "Doors puts the doors Qloo ranks for this age group first."
        : "Doors puts the doors Qloo ranks for this age group first. Doors asks Qloo for this group's list when it builds your plan.";
  };
  const drawDrinkers = () => {
    $("#f-who", root).value = p.drinkers.who ?? "";
    $("#f-where", root).value = p.drinkers.where ?? "";
    $("#basis", root).innerHTML = BASIS.map((f) => `<button type="button" class="tog" data-k="${f.key}" aria-pressed="${p.drinkers.basis === f.key}">${esc(f.label)}</button>`).join("");
    drawAge();
  };
  $("#f-who", root).addEventListener("input", (e) => { p.drinkers.who = e.target.value; changed(); });
  $("#f-where", root).addEventListener("input", (e) => { p.drinkers.where = e.target.value; changed(); });
  $("#f-age", root).addEventListener("change", (e) => { p.drinkers.age = e.target.value; drawAgeHint(); changed(); });
  $("#basis", root).addEventListener("click", (e) => {
    const b = e.target.closest("[data-k]");
    if (!b) return;
    p.drinkers.basis = p.drinkers.basis === b.dataset.k ? "" : b.dataset.k;
    drawDrinkers();
    changed();
  });

  // ---------- 3: drinks typeahead ----------
  const dInput = $("#f-drinks", root);
  const dd = $("#dd-drinks", root);
  const drawTags = () => {
    $("#drinks-tags", root).innerHTML = p.drinks
      .map((d, i) => `<span class="tag">${esc(d.name)}<button type="button" data-i="${i}" aria-label="Remove ${esc(d.name)}">×</button></span>`)
      .join("");
    dInput.placeholder = p.drinks.length ? "" : "Type any brand";
    dInput.disabled = p.drinks.length >= MAX_DRINKS;
  };
  $("#drinks-tags", root).addEventListener("click", (e) => {
    const b = e.target.closest("button[data-i]");
    if (!b) return;
    p.drinks.splice(+b.dataset.i, 1);
    touched.add("drinks");
    drawTags();
    changed();
    dInput.focus();
  });
  $("#drinks-box", root).addEventListener("click", (e) => { if (e.target.id === "drinks-box") dInput.focus(); });
  // M1: the drink list Doors holds, searched here as you type (no Qloo call); loaded on the first keystroke
  let drinkList = null;
  let drinkLoad = null;
  const wantDrinks = () => (drinkLoad ??= loadDrinks().then((l) => { drinkList = l; if (!dd.hidden) drawDD(); }));
  const options = () => {
    const q = fold(dInput.value);
    const chosen = new Set(p.drinks.map((d) => d.key ?? d.id));
    const held = new Set(index.brands.map((b) => b.id));
    const ready = index.brands
      .filter((b) => !chosen.has(b.key) && heldMatch(b, q))
      .map((b) => ({ kind: "ready", key: b.key, name: b.name, sub: b.category }));
    const out = [...ready];
    if (q) out.push(...searchDrinks(drinkList, q, 12).filter((d) => !held.has(d.id) && !chosen.has(d.id)).slice(0, Math.max(0, 8 - ready.length)).map((d) => ({ kind: "live", id: d.id, name: d.name, sub: d.kind, cat: d.kind })));
    if (Array.isArray(live)) out.push(...live.filter((r) => !chosen.has(r.id) && !held.has(r.id) && !out.some((o) => o.id === r.id)).map((r) => ({ kind: "live", id: r.id, name: r.name, sub: r.where })));
    if (q.length >= 2 && live === null) out.push({ kind: "search", name: dInput.value.trim() });
    return out;
  };
  const drawDD = () => {
    const opts = options();
    const open = document.activeElement === dInput && !dInput.disabled;
    dd.hidden = !open;
    dInput.setAttribute("aria-expanded", String(open));
    if (!open) return;
    hl = Math.min(hl, Math.max(0, opts.length - 1));
    // every brand reads the same, whether Doors has it already or a search found it; only the search row asks Qloo
    const row = (o, i) => {
      const left = o.kind === "search" ? `<span class="osearch">Search Qloo for “${esc(o.name)}”</span>` : `${esc(o.name)}${o.sub ? `<span class="osub">${esc(o.sub)}</span>` : ""}`;
      return `<div role="option" id="opt-${i}" data-i="${i}" class="${i === hl ? "hl" : ""}" aria-selected="${i === hl}"><span>${left}</span></div>`;
    };
    let html = opts.map(row).join("");
    if (live === "loading") html += `<div class="note">Searching…</div>`;
    if (live?.error) html += `<div class="note">${esc(live.error)}</div>`;
    if (Array.isArray(live) && !live.length) html += `<div class="note">Qloo doesn't know that one. Check the spelling, or pick a bigger brand your drinker also drinks.</div>`;
    if (!html) html = `<div class="note">Type a brand your drinker drinks.</div>`;
    dd.innerHTML = html;
    dInput.setAttribute("aria-activedescendant", opts.length ? `opt-${hl}` : "");
    dd._opts = opts;
  };
  const choose = async (o) => {
    if (!o) return;
    if (o.kind === "search") {
      live = "loading";
      drawDD();
      try { live = await searchBrands(o.name); } catch { live = { error: "The search didn't go through. Try again in a moment." }; }
      hl = 0;
      drawDD();
      return;
    }
    p.drinks.push(o.kind === "ready" ? { key: o.key, name: o.name, ready: true } : { id: o.id, name: o.name, ready: false, where: o.sub ?? null, ...(o.cat ? { category: o.cat } : {}) }); // category: the drink list's kind (Qloo tags) backs "your guests already buy …"
    touched.add("drinks");
    dInput.value = "";
    live = null;
    hl = 0;
    drawTags();
    changed();
    // a pick closes the list: it must not sit over City / Rooms / Start and take the next click (R2 Calacanis 14a)
    closeDD();
    if (!dInput.disabled) dInput.focus();
  };
  const closeDD = () => { dd.hidden = true; dInput.setAttribute("aria-expanded", "false"); };
  // a bare focus doesn't open the full list; typing (or ArrowDown) does
  dInput.addEventListener("focus", () => { if (dInput.value.trim()) drawDD(); });
  const onOutside = (e) => { if (!dd.hidden && !e.target.closest("#dd-drinks, #drinks-box")) closeDD(); };
  document.addEventListener("pointerdown", onOutside, true);
  dInput.addEventListener("blur", () => setTimeout(() => { if (document.activeElement !== dInput) { dd.hidden = true; dInput.setAttribute("aria-expanded", "false"); } }, 150));
  dInput.addEventListener("input", () => { live = null; hl = 0; wantDrinks(); drawDD(); });
  dInput.addEventListener("keydown", (e) => {
    const n = dd._opts?.length ?? 0;
    if (e.key === "ArrowDown") { e.preventDefault(); if (dd.hidden) return drawDD(); hl = Math.min(n - 1, hl + 1); drawDD(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); hl = Math.max(0, hl - 1); drawDD(); }
    else if (e.key === "Enter") { e.preventDefault(); choose(dd._opts?.[hl]); }
    else if (e.key === "Escape") { e.stopPropagation(); closeDD(); }
    else if (e.key === "Backspace" && !dInput.value && p.drinks.length) { p.drinks.pop(); drawTags(); changed(); drawDD(); }
  });
  dd.addEventListener("mousedown", (e) => {
    const o = e.target.closest("[data-i]");
    if (!o) return;
    e.preventDefault(); // keep focus in the input
    choose(dd._opts[+o.dataset.i]);
  });
  // ---------- 3b (N3): rooms that already pour you, any city: a Qloo place search on click / Enter only (one call
  // each, like Search Qloo above); Doors' own preset rooms match as you type, free ----------
  // a profile saved before N3 ("venue": the Parson's preset) reads as that room
  if (!p.pours?.length && p.venue) p.pours = poursOf(p, index.rooms);
  p.pours ??= [];
  delete p.venue;
  const rInput = $("#f-pours", root);
  const rdd = $("#dd-pours", root);
  const pcInput = $("#f-pours-city", root);
  const pcdd = $("#dd-pours-city", root);
  let rlive = null; // rows for the current query, or "loading" / {error}
  let rhl = 0;
  const drawPours = () => {
    $("#pours-tags", root).innerHTML = p.pours
      .map((r, i) => `<span class="tag"><span>${esc(r.name)}${r.where ? `<span class="muted"> · ${esc(r.where)}</span>` : ""}</span><button type="button" data-i="${i}" aria-label="Remove ${esc(r.name)}">×</button></span>`)
      .join("");
    rInput.placeholder = p.pours.length ? "" : "A bar or restaurant";
    rInput.disabled = p.pours.length >= MAX_POURS;
    pcInput.disabled = rInput.disabled;
  };
  const pourOpts = () => {
    const q = fold(rInput.value);
    const chosen = new Set(p.pours.map((r) => String(r.id).toLowerCase()));
    const out = q.length >= 2 ? index.rooms.filter((r) => r.id && !chosen.has(r.id.toLowerCase()) && fold(r.name).includes(q)).map((r) => ({ kind: "room", id: r.id, name: r.name, where: r.where })) : [];
    if (Array.isArray(rlive)) out.push(...rlive.filter((r) => !chosen.has(String(r.id).toLowerCase()) && !out.some((o) => o.id === r.id)).map((r) => ({ kind: "room", id: r.id, name: r.name, where: r.where })));
    if (q.length >= 2 && rlive === null) out.push({ kind: "search", name: rInput.value.trim(), city: pcInput.value.trim() });
    return out;
  };
  const closePours = () => { rdd.hidden = true; rInput.setAttribute("aria-expanded", "false"); };
  const drawPoursDD = () => {
    const opts = pourOpts();
    const open = document.activeElement === rInput && !rInput.disabled && (rInput.value.trim().length >= 2 || rlive !== null);
    rdd.hidden = !open;
    rInput.setAttribute("aria-expanded", String(open));
    if (!open) return;
    rhl = Math.min(rhl, Math.max(0, opts.length - 1));
    let html = opts.map((o, i) => `<div role="option" id="ropt-${i}" data-i="${i}" class="${i === rhl ? "hl" : ""}" aria-selected="${i === rhl}"><span>${o.kind === "search" ? `<span class="osearch">Search Qloo for “${esc(o.name)}”${o.city ? ` in ${esc(o.city)}` : ""}</span>` : `${esc(o.name)}${o.where ? `<span class="osub">${esc(o.where)}</span>` : ""}`}</span></div>`).join("");
    if (rlive === "loading") html += `<div class="note">Searching…</div>`;
    if (rlive?.error) html += `<div class="note">${esc(rlive.error)}</div>`;
    if (Array.isArray(rlive) && !rlive.length) html += `<div class="note">Qloo has no bar or restaurant by that name${pcInput.value.trim() ? " there" : ""}. ${pcInput.value.trim() ? "Check the spelling or the city." : "Add its city below, or check the spelling."}</div>`;
    rdd.innerHTML = html || `<div class="note">Type a bar or restaurant that pours you, and pick its city below.</div>`;
    rInput.setAttribute("aria-activedescendant", opts.length ? `ropt-${rhl}` : "");
    rdd._opts = opts;
  };
  const choosePour = async (o) => {
    if (!o) return;
    if (o.kind === "search") {
      rlive = "loading";
      drawPoursDD();
      try { rlive = await searchRooms(o.city ? `${o.name} ${o.city}` : o.name); } catch (e) { rlive = { error: /today|easy there|resting/i.test(e.message) ? e.message : "The search didn't go through. Try again in a moment." }; }
      rhl = 0;
      drawPoursDD();
      return;
    }
    p.pours.push({ id: o.id, name: o.name, where: o.where ?? null });
    touched.add("pours");
    touched.add("drinks");
    rInput.value = "";
    rlive = null;
    rhl = 0;
    drawPours();
    changed();
    closePours();
    if (!rInput.disabled) rInput.focus();
  };
  $("#pours-tags", root).addEventListener("click", (e) => {
    const b = e.target.closest("button[data-i]");
    if (!b) return;
    p.pours.splice(+b.dataset.i, 1);
    touched.add("pours");
    drawPours();
    changed();
    rInput.focus();
  });
  $("#pours-box", root).addEventListener("click", (e) => { if (e.target.id === "pours-box") rInput.focus(); });
  const onOutsidePours = (e) => { if (!rdd.hidden && !e.target.closest("#dd-pours, #pours-box")) closePours(); };
  document.addEventListener("pointerdown", onOutsidePours, true);
  rInput.addEventListener("blur", () => setTimeout(() => { if (document.activeElement !== rInput) closePours(); }, 150));
  rInput.addEventListener("input", () => { rlive = null; rhl = 0; drawPoursDD(); });
  rInput.addEventListener("keydown", (e) => {
    const n = rdd._opts?.length ?? 0;
    if (e.key === "ArrowDown") { e.preventDefault(); if (rdd.hidden) return drawPoursDD(); rhl = Math.min(n - 1, rhl + 1); drawPoursDD(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); rhl = Math.max(0, rhl - 1); drawPoursDD(); }
    else if (e.key === "Enter") { e.preventDefault(); choosePour(rdd._opts?.[rhl]); }
    else if (e.key === "Escape") { e.stopPropagation(); closePours(); }
    else if (e.key === "Backspace" && !rInput.value && p.pours.length) { p.pours.pop(); drawPours(); changed(); }
  });
  rdd.addEventListener("mousedown", (e) => {
    const o = e.target.closest("[data-i]");
    if (!o) return;
    e.preventDefault();
    choosePour(rdd._opts[+o.dataset.i]);
  });
  // Jard 10-23 #12: its city, with the opening city's smart list (lib/citylist.js placeCities); it rides the Qloo
  // search ("Kite String Chicago, IL") and stays for the next one
  let pchl = 0;
  const closePcity = () => { pcdd.hidden = true; pcInput.setAttribute("aria-expanded", "false"); pcInput.removeAttribute("aria-activedescendant"); };
  const drawPcity = () => {
    const opts = cl ? cl.placeCities(pcInput.value, index.cities) : [];
    const open = document.activeElement === pcInput && opts.length > 0 && !(opts.length === 1 && opts[0].label === pcInput.value.trim());
    pcdd.hidden = !open;
    pcInput.setAttribute("aria-expanded", String(open));
    if (!open) return pcInput.removeAttribute("aria-activedescendant");
    pchl = Math.min(pchl, opts.length - 1);
    pcdd.innerHTML = opts.map((o, i) => `<div role="option" id="pcopt-${i}" data-i="${i}" class="${i === pchl ? "hl" : ""}" aria-selected="${i === pchl}"><span>${esc(o.name)}</span></div>`).join("");
    pcInput.setAttribute("aria-activedescendant", `pcopt-${pchl}`);
    pcdd._opts = opts;
  };
  const pickPcity = (o) => {
    if (o) pcInput.value = o.label;
    closePcity();
    rlive = null; // a new city is a new search
    if (rInput.value.trim().length >= 2) { rInput.focus(); drawPoursDD(); }
  };
  pcInput.addEventListener("focus", () => { pchl = 0; drawPcity(); });
  pcInput.addEventListener("input", () => { pchl = 0; rlive = null; drawPcity(); });
  pcInput.addEventListener("blur", () => setTimeout(() => { if (document.activeElement !== pcInput) closePcity(); }, 150));
  pcInput.addEventListener("keydown", (e) => {
    const n = pcdd._opts?.length ?? 0;
    if (e.key === "ArrowDown") { e.preventDefault(); if (pcdd.hidden) return drawPcity(); pchl = Math.min(n - 1, pchl + 1); drawPcity(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); pchl = Math.max(0, pchl - 1); drawPcity(); }
    else if (e.key === "Enter") { e.preventDefault(); pickPcity(pcdd.hidden ? null : pcdd._opts?.[pchl]); }
    else if (e.key === "Escape") { e.stopPropagation(); closePcity(); }
  });
  pcdd.addEventListener("mousedown", (e) => {
    const o = e.target.closest("[data-i]");
    if (!o) return;
    e.preventDefault();
    pickPcity(pcdd._opts[+o.dataset.i]);
  });

  // ---------- 4: city: any US city of 20,000+ narrows as the rep types (lib/citylist.js, no network); the ones Doors
  // holds keep their keys; a city off the list is taken as typed (lib/examples.js cityFromText) ----------
  const cInput = $("#f-city", root);
  const cdd = $("#dd-city", root);
  let chl = 0;
  let cl = null; // lib/citylist.js, loaded with the form (its list is ~80 KB)
  import("../lib/citylist.js").then((m) => { cl = m; if (document.activeElement === cInput && cInput.value.trim()) drawCityDD(); }).catch(() => {});
  cInput.value = cityText(p, index.cities);
  const cityOpts = () => {
    const q = cInput.value.trim();
    const typed = cityFromText(q, index.cities);
    const listed = q && cl ? cl.matchCities(q, index.cities, 8).map((r) => ({ row: r, name: r.label })) : [];
    if (listed.length) return listed;
    const held = index.cities.filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase()) || typed.city === c.key).map((c) => ({ key: c.key, name: c.name }));
    // live check F/H: off the list, the listed city it most likely means comes first ("Milwuakee" → Milwaukee, WI), and
    // the as-typed choice says why it may not build
    const near = q.length >= 4 && cl ? cl.nearestCity(q, index.cities) : null;
    const nearOpt = near && !held.some((c) => c.key === near.ready) ? [{ row: near, name: `${near.label}?` }] : [];
    return [...nearOpt, ...held, ...(typed.cityLive ? [{ text: typed.cityName, name: `Use “${typed.cityName}” (not on Doors' city list; Qloo may not know it)` }] : [])];
  };
  const drawCityDD = () => {
    const opts = cityOpts();
    const open = document.activeElement === cInput && opts.length > 0;
    cdd.hidden = !open;
    cInput.setAttribute("aria-expanded", String(open));
    if (!open) return cInput.removeAttribute("aria-activedescendant");
    chl = Math.min(chl, opts.length - 1);
    cdd.innerHTML = opts.map((o, i) => `<div role="option" id="copt-${i}" data-i="${i}" class="${i === chl ? "hl" : ""}" aria-selected="${i === chl}"><span>${esc(o.name)}</span></div>`).join("");
    cInput.setAttribute("aria-activedescendant", `copt-${chl}`);
    cdd.querySelector(".hl")?.scrollIntoView({ block: "nearest" });
    cdd._opts = opts;
  };
  const closeCityDD = () => { cdd.hidden = true; cInput.setAttribute("aria-expanded", "false"); cInput.removeAttribute("aria-activedescendant"); };
  // what was typed, as a city: a listed one ("cincinnati" → Cincinnati, OH with its centre), else as typed
  const typedCity = (text) => {
    const hit = cl?.listedCity(text, index.cities);
    return hit ? cl.cityPick(hit) : cityFromText(text, index.cities);
  };
  const pickCity = (o) => { closeCityDD(); setCity(o?.row ? cl.cityPick(o.row) : o?.key ? { city: o.key } : typedCity(o?.text ?? cInput.value)); };
  cInput.addEventListener("focus", () => { chl = 0; drawCityDD(); });
  cInput.addEventListener("input", () => { chl = 0; drawCityDD(); });
  cInput.addEventListener("keydown", (e) => {
    const n = cdd._opts?.length ?? 0;
    if (e.key === "ArrowDown") { e.preventDefault(); if (cdd.hidden) return drawCityDD(); chl = Math.min(n - 1, chl + 1); drawCityDD(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); chl = Math.max(0, chl - 1); drawCityDD(); }
    else if (e.key === "Enter") { e.preventDefault(); pickCity(cdd.hidden ? null : cdd._opts?.[chl]); }
    else if (e.key === "Escape") { e.stopPropagation(); closeCityDD(); }
  });
  cdd.addEventListener("mousedown", (e) => {
    const o = e.target.closest("[data-i]");
    if (!o) return;
    e.preventDefault();
    pickCity(cdd._opts[+o.dataset.i]);
  });
  // leaving the field takes what was typed ("Denver" → Denver, CO; "Smallville, KS" as typed), unless it already is
  // the city
  cInput.addEventListener("blur", () => setTimeout(() => {
    if (document.activeElement === cInput) return;
    closeCityDD();
    if (cInput.value.trim() !== cityText(p, index.cities)) setCity(typedCity(cInput.value));
  }, 150));
  // L1 hook: a live city's centre (ORS, not Qloo): the address search and the pin map centre on it, and the start
  // is checked against it (validateProfile)
  const liveGeo = () => (p.cityLive ? { cityName: p.cityName, center: p.cityCenter } : null);
  // a city picked from the list has its centre already; one typed off the list is looked up by its name (ORS)
  async function findCity() {
    const name = p.cityName;
    const at = p.cityLive && name && !p.cityCenter ? await locateCity(name) : null;
    if (!at || p.cityName !== name) return;
    p.cityCenter = [at.lat, at.lon];
    if (pin && !p.start) pin.map.flyTo({ center: [at.lon, at.lat], zoom: 12, duration: 600 });
    changed();
  }
  function setCity(next) {
    const was = p.city;
    delete p.cityName;
    delete p.cityLive;
    delete p.cityCenter;
    Object.assign(p, next);
    cInput.value = cityText(p, index.cities);
    touched.add("city");
    if (p.city === was) return changed();
    // a city Doors has no starting points for: the old city's start (and any day's own start) would be far off
    if (!city()) {
      findCity(); // L1 hook
      if (p.start) (p.start = null), (aInput.value = ""), startHint();
      for (const w of slots()) delete w.start;
      $("#addr-off", root).hidden = true;
      if (pin) pin.map.flyTo({ ...(p.cityCenter ? { center: [p.cityCenter[1], p.cityCenter[0]], zoom: 12 } : US_VIEW), duration: 600 });
      drawDays();
      drawChips();
      return changed();
    }
    // the old city's start (and any day's own start) would be miles away: take the new city's first starting point,
    // so "change one field and build" holds for the city too (R2 Calacanis 14b)
    if (p.start && validateProfile({ ...p, windows: [] }, { cities: index.cities }).errors.start) {
      const first = startChips(p.city)[0];
      aInput.value = first ? first.label : "";
      setStart(first ? chipStart(first) : null);
    }
    for (const w of slots()) if (w.start && validateProfile({ ...p, start: w.start, windows: [] }, { cities: index.cities }).errors.start) delete w.start;
    const c = city();
    if (pin && c) pin.map.flyTo({ center: [c.center[1], c.center[0]], zoom: 12, duration: 600 });
    drawDays();
    drawChips();
    changed();
  }

  if (p.cityLive && !p.cityCenter) findCity(); // L1 hook: a saved live city from before its centre was kept

  // ---------- 5: rooms to pitch ----------
  const drawRooms = () => {
    $("#rooms", root).innerHTML = roomChoices(p.what)
      .map((r) => `<button type="button" class="tog" data-k="${r.key}" aria-pressed="${p.rooms.includes(r.key)}">${esc(r.label)}</button>`)
      .join("");
  };
  $("#rooms", root).addEventListener("click", (e) => {
    const b = e.target.closest("[data-k]");
    if (!b) return;
    const k = b.dataset.k;
    p.rooms = p.rooms.includes(k) ? p.rooms.filter((x) => x !== k) : ROOMS.map((r) => r.key).filter((x) => x === k || p.rooms.includes(x));
    p.roomsTouched = true;
    touched.add("rooms");
    drawRooms();
    changed();
  });

  // ---------- 6: where your day starts ----------
  const aInput = $("#f-addr", root);
  const add = $("#dd-addr", root);
  const hint = $("#start-hint", root);
  aInput.value = p.start?.label ?? "";
  let geoRows = [];
  const startHint = () => {
    hint.textContent = !p.start ? "" : p.start.source === "geocode" ? "Start set." : `Start: ${p.start.label}.`;
    drawChips();
  };
  // starting points for the city (lib/profile.js START_CHIPS): no address search needed
  const drawChips = () => {
    const chips = startChips(p.city);
    $(".startchips", root).hidden = !chips.length;
    $("#start-chips", root).innerHTML = chips
      .map((c) => `<button type="button" class="tog" data-chip="${c.key}" aria-pressed="${p.start?.source === "chip" && p.start.chip === c.key}">${esc(c.label)}</button>`)
      .join("");
  };
  $("#start-chips", root).addEventListener("click", (e) => {
    const c = startChips(p.city).find((x) => x.key === e.target.closest("[data-chip]")?.dataset.chip);
    if (!c) return;
    aInput.value = c.label;
    add.hidden = true;
    setStart(chipStart(c));
    if (pin) pin.map.flyTo({ center: [c.lon, c.lat], zoom: 14, duration: 600 });
  });
  // a pin's label: what the rep typed, else where it is in words ("Your pin near South Congress")
  const pinStart = (ll) => {
    const typed = aInput.value.trim();
    const auto = !typed || (p.start && p.start.source !== "geocode" && typed === p.start.label);
    const label = auto ? pinLabel(ll, p.city, ranked?.venues) : typed;
    if (auto) aInput.value = label;
    return { label, lat: ll.lat, lon: ll.lon, source: "pin" };
  };
  const setStart = (s) => {
    p.start = s;
    if (s) $("#addr-off", root).hidden = true;
    touched.add("start");
    startHint();
    if (pin && s) {
      pin.marker ??= placeMarker(s);
      pin.marker.setLngLat([s.lon, s.lat]);
    }
    changed();
  };
  // the address list: predictions as the rep types (M2), or a search's answers (a city typed off the list, no centre)
  let ahl = -1;
  const drawAddr = (rows, note) => {
    geoRows = rows ?? [];
    const open = document.activeElement === aInput && (geoRows.length > 0 || !!note);
    add.hidden = !open;
    aInput.setAttribute("aria-expanded", String(open));
    ahl = Math.min(ahl, geoRows.length - 1);
    add.innerHTML = geoRows.map((r, i) => `<div role="option" id="aopt-${i}" data-i="${i}" class="${i === ahl ? "hl" : ""}" aria-selected="${i === ahl}">${esc(r.label)}</div>`).join("") + (note ? `<div class="note">${esc(note)}</div>` : "");
    if (open && ahl >= 0) aInput.setAttribute("aria-activedescendant", `aopt-${ahl}`);
    else aInput.removeAttribute("aria-activedescendant");
  };
  const closeAddr = () => { add.hidden = true; aInput.setAttribute("aria-expanded", "false"); aInput.removeAttribute("aria-activedescendant"); };
  const searchOff = (msg) => {
    // search off or resting: say so under the input, right above the starting points (never "no match")
    $("#addr-off", root).hidden = !msg;
    $("#addr-off", root).textContent = msg ?? "";
  };
  // the centre the predictions focus on: a ready city's, or a listed (or looked-up) live city's
  const centre = () => city()?.center ?? (p.cityLive ? p.cityCenter : null) ?? null;
  let inflight = null;
  const predict = debounce(async () => {
    const q = aInput.value.trim();
    inflight?.abort();
    inflight = null;
    if (q.length < 3) return drawAddr([]);
    const at = centre();
    if (!at) return;
    const ctl = (inflight = new AbortController());
    const res = await autocomplete(q, at, ctl.signal);
    if (ctl.signal.aborted || aInput.value.trim() !== q) return;
    inflight = null;
    searchOff(res.rows ? null : res.message);
    if (!res.rows) return drawAddr([]);
    ahl = 0; // Enter takes the first prediction
    drawAddr(res.rows, res.rows.length ? null : "No match in this city yet: keep typing, or drop a pin.");
  }, 250);
  const lookUp = debounce(async () => {
    const q = aInput.value.trim();
    if (q.length < 4) return drawAddr([]);
    if (!p.city) return drawAddr([], "Pick a city first.");
    if (!city() && !p.cityLive) return drawAddr([], PIN_ONLY);
    const rows = await geocode(q, p.city, liveGeo()); // L1 hook: a live city by its name
    if (aInput.value.trim() !== q) return;
    searchOff(rows === null ? SEARCH_OFF : null);
    if (rows === null) drawAddr([]);
    else drawAddr(rows, rows.length ? null : "No match in this city: drop a pin instead.");
  }, 450);
  const findAddr = () => {
    if (!p.city) return drawAddr([], aInput.value.trim() ? "Pick a city first." : null);
    if (centre()) predict();
    else lookUp();
  };
  aInput.addEventListener("input", () => {
    // a typed address with a pin keeps the pin and takes the new label; a looked-up start no longer matches the text
    if (p.start?.source === "pin") { p.start.label = aInput.value.trim() || pinLabel(p.start, p.city, ranked?.venues); startHint(); dirty = true; onChange(p); }
    else if (p.start) setStart(null);
    findAddr();
  });
  aInput.addEventListener("blur", () => setTimeout(() => { if (document.activeElement !== aInput) closeAddr(); }, 150));
  const pickAddr = (r) => {
    if (!r) return;
    inflight?.abort();
    aInput.value = r.label;
    closeAddr();
    setStart({ label: r.label, lat: r.lat, lon: r.lon, source: "geocode" });
    if (pin) pin.map.flyTo({ center: [r.lon, r.lat], zoom: 14, duration: 600 });
  };
  aInput.addEventListener("keydown", (e) => {
    const n = geoRows.length;
    if (e.key === "ArrowDown" && n) { e.preventDefault(); ahl = Math.min(n - 1, ahl + 1); drawAddr(geoRows); }
    else if (e.key === "ArrowUp" && n) { e.preventDefault(); ahl = Math.max(0, ahl - 1); drawAddr(geoRows); }
    else if (e.key === "Enter" && !add.hidden && n) { e.preventDefault(); pickAddr(geoRows[Math.max(0, ahl)]); }
    else if (e.key === "Escape" && !add.hidden) { e.stopPropagation(); closeAddr(); }
  });
  add.addEventListener("mousedown", (e) => {
    const o = e.target.closest("[data-i]");
    if (!o) return;
    e.preventDefault();
    pickAddr(geoRows[+o.dataset.i]);
  });
  const placeMarker = (s) => {
    const m = addStart(pin.map, s, { draggable: true });
    m.on("dragend", () => { const ll = m.getLngLat(); setStart(pinStart({ lat: ll.lat, lon: ll.lng })); });
    return m;
  };
  $("#pin-btn", root).addEventListener("click", async (e) => {
    const box = $("#pinmap", root);
    box.hidden = !box.hidden;
    e.currentTarget.setAttribute("aria-expanded", String(!box.hidden));
    e.currentTarget.textContent = box.hidden ? "Drop a pin" : "Hide map";
    if (box.hidden || pin) return pin?.map.resize();
    const c = city();
    const view = p.start ? { center: [p.start.lon, p.start.lat], zoom: 14 } : c ? { center: [c.center[1], c.center[0]], zoom: 12 } : p.cityCenter ? { center: [p.cityCenter[1], p.cityCenter[0]], zoom: 12 } : US_VIEW; // L1 hook
    pin = { map: null, marker: null };
    try {
      pin.map = (await createMap($(".m", box), { city: p.city, view })).map;
    } catch {
      box.innerHTML = `<div class="note" style="padding:14px">The map didn't load. Type an address instead.</div>`;
      return;
    }
    if (p.start) pin.marker = placeMarker(p.start);
    pin.map.getCanvas().style.cursor = "crosshair";
    pin.map.on("click", (ev) => setStart(pinStart({ lat: ev.lngLat.lat, lon: ev.lngLat.lng })));
  });

  // ---------- 7: when you're free: the usual week, repeating, and changes to one date (lib/week.js) ----------
  // p.week is the truth; p.windows its dated days (this week and next) for the readers that list them. Each row is keyed
  // by its weekday ("tuesday", the usual week) or its date ("2026-10-30", that date only).
  const today = isoDate(new Date());
  $("#f-date", root).min = today;
  const isDate = (k) => WEEK_DATE.test(k);
  const ensureWeek = () => {
    if (!p.week) {
      const first = (p.windows ?? []).map((w) => w.date).filter((d) => d >= today).sort()[0];
      p.week = (p.windows ?? []).length ? weekFromWindows(p.windows, first ?? today) : { ...emptyWeek(), since: today };
    }
    p.week = pruneChanges({ days: {}, changes: {}, ...p.week }, today);
    p.windows = weekDates(p.week);
  };
  ensureWeek();
  const slotOf = (k) => (isDate(k) ? p.week.changes[k] : p.week.days[k]);
  const slots = () => [...Object.values(p.week.days), ...Object.values(p.week.changes)].filter((x) => x && !x.off);
  const wdShort = (d) => `${d[0].toUpperCase()}${d.slice(1, 3)}`;
  const label = (k) => (isDate(k) ? dayChip(k) : wdShort(k)); // judge pass 4 (18): one date format
  const longLabel = (k) => (isDate(k) ? niceDate(k) : `${k[0].toUpperCase()}${k.slice(1)}s`);
  const strip = Array.from({ length: 14 }, (_, i) => addDays(today, i)); // the dates a tap changes
  let editing = null; // the key whose own start is being set
  let wpin = null; // {map, marker} for a day's own start
  const rowHTML = (k, w, note = "") => `<div class="win" data-d="${k}"><b>${label(k)}</b>
        <label class="sr" for="from-${k}">${longLabel(k)} from</label><input type="time" id="from-${k}" data-f="from" value="${w.from}" step="900">
        <span class="muted">to</span>
        <label class="sr" for="to-${k}">${longLabel(k)} to</label><input type="time" id="to-${k}" data-f="to" value="${w.to}" step="900">${note}
        <span class="wstart">${w.start ? `from <b>${esc(w.start.label ?? "a pin")}</b> <button type="button" class="lnk" data-ws="clear">use my usual start</button>` : `<button type="button" class="lnk" data-ws="edit" aria-expanded="${editing === k}">Start elsewhere</button>`}</span>
        <button type="button" class="x" data-ws="remove" aria-label="${isDate(k) ? `Back to your usual week on ${niceDate(k)}` : `Not free ${longLabel(k)}`}">×</button></div>
        ${editing === k ? `<div class="wedit" data-d="${k}">
          <div class="addr"><label class="sr" for="ws-${k}">${label(k)} starts at</label><input class="inp" id="ws-${k}" data-wsa autocomplete="off" placeholder="Where ${label(k)} starts: an address"><button type="button" class="btn line sm" data-ws="pin">Drop a pin</button><button type="button" class="btn ghost sm" data-ws="cancel">Cancel</button></div>
          <div class="dd" data-wsdd role="listbox" hidden></div>
          ${startChips(p.city).length ? `<div class="chips" role="group" aria-label="${label(k)}: starting points">${startChips(p.city).map((c) => `<button type="button" class="tog" data-ws="chip" data-chip="${c.key}">${esc(c.label)}</button>`).join("")}</div>` : ""}
          <div class="pinmap" data-wspin hidden><div class="m"></div><div class="tip">Click the map to set ${label(k)}'s start</div></div></div>` : ""}`;
  const drawDays = () => {
    ensureWeek();
    $("#days-hint", root).textContent = p.week.ahead === 1 ? "The days she is usually free. They repeat every week; the demo plans her first week." : "The days you are usually free. They repeat every week, and Doors plans two weeks ahead.";
    $("#days", root).innerHTML = DAYS.map((d) => `<button type="button" class="tog" data-d="${d}" aria-pressed="${Boolean(p.week.days[d])}" aria-label="${longLabel(d)}">${wdShort(d)}</button>`).join("");
    $("#wins", root).innerHTML = DAYS.filter((d) => p.week.days[d]).map((d) => rowHTML(d, p.week.days[d])).join("");
    $("#dates", root).innerHTML = strip.map((d) => `<button type="button" class="tog" data-d="${d}" aria-pressed="${Boolean(hoursOn(p.week, d))}">${dayChip(d)}</button>`).join("");
    $("#chg", root).innerHTML = Object.keys(p.week.changes).sort().map((d) => {
      const c = p.week.changes[d];
      if (c.off) return `<div class="win off" data-d="${d}"><b>${label(d)}</b><span class="muted">Not free this date</span><button type="button" class="lnk" data-ws="usual">Free as usual</button></div>`;
      return rowHTML(d, c, ` <span class="muted">this date only</span>`);
    }).join("");
  };
  const weekChanged = () => {
    p.windows = weekDates(p.week); // this week and next, for the readers that list them
    touched.add("windows");
    drawDays();
    changed();
  };
  // a date tapped: a free date goes off (that date only); a date that isn't free is added with its usual hours, or 2–6 pm
  const toggleDate = (d) => {
    const c = p.week.changes[d];
    const usual = p.week.days[weekdayOf(d)];
    if (hoursOn(p.week, d)) p.week = setChange(p.week, d, usual && d >= (p.week.since ?? "") ? { off: true } : null);
    else if (c?.off) p.week = setChange(p.week, d, null);
    else p.week = { ...p.week, changes: { ...p.week.changes, [d]: { from: usual?.from ?? DEFAULT_FROM, to: usual?.to ?? DEFAULT_TO } } };
    weekChanged();
  };
  $("#days", root).addEventListener("click", (e) => {
    const d = e.target.closest("[data-d]")?.dataset.d;
    if (!d) return;
    if (p.week.days[d]) delete p.week.days[d];
    else p.week.days[d] = { from: DEFAULT_FROM, to: DEFAULT_TO };
    if (editing === d) editing = null;
    weekChanged();
  });
  $("#dates", root).addEventListener("click", (e) => {
    const d = e.target.closest("[data-d]")?.dataset.d;
    if (d) toggleDate(d);
  });
  // another date (past the strip, or a usual day's own hours): that date only, with its usual hours to change
  $("#add-date", root).addEventListener("click", () => {
    const v = $("#f-date", root).value;
    if (/^\d{4}-\d{2}-\d{2}$/.test(v) && v >= today && !p.week.changes[v]?.from) {
      const h = hoursOn(p.week, v) ?? p.week.days[weekdayOf(v)];
      p.week = { ...p.week, changes: { ...p.week.changes, [v]: { from: h?.from ?? DEFAULT_FROM, to: h?.to ?? DEFAULT_TO } } };
      weekChanged();
    }
    $("#f-date", root).value = "";
  });
  const onRows = (box) => {
    box.addEventListener("input", (e) => {
      const k = e.target.closest("[data-d]")?.dataset.d;
      const w = k && slotOf(k);
      if (!w) return;
      if (e.target.dataset.f) {
        w[e.target.dataset.f] = e.target.value;
        p.windows = weekDates(p.week);
        touched.add("windows");
        changed();
      } else if ("wsa" in e.target.dataset) lookUpDay(w, e.target);
    });
    box.addEventListener("mousedown", (e) => {
      const o = e.target.closest("[data-wsdd] [data-i]");
      if (!o) return;
      e.preventDefault();
      const w = slotOf(o.closest("[data-d]").dataset.d);
      const r = o.closest("[data-wsdd]")._rows[+o.dataset.i];
      setDayStart(w, { label: r.label, lat: r.lat, lon: r.lon, source: "geocode" });
    });
    box.addEventListener("click", async (e) => {
      const b = e.target.closest("[data-ws]");
      if (!b) return;
      const k = b.closest("[data-d]").dataset.d;
      const w = slotOf(k);
      const act = b.dataset.ws;
      if (act === "remove" || act === "usual") {
        if (isDate(k)) p.week = setChange(p.week, k, null);
        else delete p.week.days[k];
        if (editing === k) editing = null;
        return weekChanged();
      }
      if (act === "clear") return setDayStart(w, undefined);
      if (act === "chip") {
        const c = startChips(p.city).find((x) => x.key === b.dataset.chip);
        return c && setDayStart(w, chipStart(c));
      }
      if (act === "edit" || act === "cancel") {
        editing = act === "edit" && editing !== k ? k : null;
        wpin?.map.remove();
        wpin = null;
        drawDays();
        if (editing) $(`#ws-${k}`, root)?.focus();
        return;
      }
      if (act === "pin") {
        const box = b.closest(".wedit").querySelector("[data-wspin]");
        box.hidden = false;
        if (wpin) return;
        const c = city();
        const view = p.start ? { center: [p.start.lon, p.start.lat], zoom: 13 } : c ? { center: [c.center[1], c.center[0]], zoom: 13 } : p.cityCenter ? { center: [p.cityCenter[1], p.cityCenter[0]], zoom: 13 } : US_VIEW; // L1 hook
        wpin = { map: null };
        try { wpin.map = (await createMap($(".m", box), { city: p.city, view })).map; } catch { box.innerHTML = `<div class="note" style="padding:14px">The map didn't load. Type an address instead.</div>`; return; }
        wpin.map.getCanvas().style.cursor = "crosshair";
        wpin.map.on("click", (ev) => setDayStart(w, { label: pinLabel({ lat: ev.lngLat.lat, lon: ev.lngLat.lng }, p.city, ranked?.venues), lat: ev.lngLat.lat, lon: ev.lngLat.lng, source: "pin" }));
      }
    });
  };
  onRows($("#wins", root));
  onRows($("#chg", root));
  const setDayStart = (w, s) => {
    if (s) w.start = s;
    else delete w.start;
    editing = null;
    wpin?.map.remove();
    wpin = null;
    weekChanged();
  };
  const lookUpDay = debounce(async (w, input) => {
    const q = input.value.trim();
    const dd = input.closest(".wedit")?.querySelector("[data-wsdd]");
    if (!dd) return;
    if (q.length < 4) return void (dd.hidden = true);
    if (!city() && !p.cityLive) return void ((dd.innerHTML = `<div class="note">${PIN_ONLY}</div>`), (dd.hidden = false)); // L1 hook
    const rows = await geocode(q, p.city, liveGeo()); // L1 hook
    if (input.value.trim() !== q) return;
    dd._rows = rows ?? [];
    dd.innerHTML = dd._rows.map((r, i) => `<div role="option" data-i="${i}">${esc(r.label)}</div>`).join("") || `<div class="note">${rows === null ? SEARCH_OFF : "No match in this city: drop a pin instead."}</div>`;
    dd.hidden = false;
  }, 450);
  const vInput = $("#f-visit", root);
  vInput.value = p.visitMin;
  vInput.addEventListener("input", () => { p.visitMin = vInput.value === "" ? null : Number(vInput.value); touched.add("visitMin"); changed(); });
  // persona: the doors-a-day cap on the form too (it was on the plan only); the same profile.maxPerDay the plan's select sets
  const capInput = $("#f-cap", root);
  const capSync = () => (capInput.value = Number.isInteger(p.maxPerDay) && p.maxPerDay <= 12 ? String(p.maxPerDay) : "");
  capSync();
  capInput.addEventListener("change", () => { p.maxPerDay = capInput.value === "" ? null : Number(capInput.value); changed(); });

  // ---------- 8: your pitch (optional) ----------
  p.pitch = { price: "", ask: "", support: [], name: "", ...(p.pitch ?? {}) };
  $("#f-ask", root).value = p.pitch.ask;
  $("#f-menu", root).value = p.pitch.menuPrice ?? "";
  $("#f-menu", root).addEventListener("input", (e) => { p.pitch.menuPrice = e.target.value; changed(); }); // the margin line's menu price (lib/ask.js)
  $("#f-ask", root).addEventListener("input", (e) => { p.pitch.ask = e.target.value; drawAsk(); changed(); });
  $("#f-ask", root).addEventListener("blur", () => { touched.add("ask"); refresh(); });
  $("#f-name", root).value = p.pitch.name ?? ""; // C1: "I'm Maya from Tidewell" in the drafted note; N1: required
  $("#f-name", root).addEventListener("input", (e) => { p.pitch.name = e.target.value; changed(); });
  $("#f-name", root).addEventListener("blur", () => { touched.add("name"); refresh(); });
  if (editOf && !String(p.pitch.name ?? "").trim()) touched.add("name"); // a plan saved before N1: ask for it now
  const drawSupport = () => {
    $("#support", root).innerHTML = SUPPORT.map((x) => `<button type="button" class="tog" data-k="${x.key}" aria-pressed="${p.pitch.support.includes(x.key)}">${esc(x.label)}</button>`).join("");
  };
  $("#support", root).addEventListener("click", (e) => {
    const b = e.target.closest("[data-k]");
    if (!b) return;
    const k = b.dataset.k;
    p.pitch.support = p.pitch.support.includes(k) ? p.pitch.support.filter((x) => x !== k) : SUPPORT.map((x) => x.key).filter((x) => x === k || p.pitch.support.includes(x));
    drawSupport();
    changed();
  });

  // ---------- 9: doors you already know (optional): the city's ranked rooms by name ----------
  p.known ??= [];
  const kInput = $("#f-known", root);
  const kdd = $("#dd-known", root);
  let ranked = null; // {key, ids, venues} for the current drinkers + city
  const rankedRooms = async () => {
    const key = `${p.city}|${(p.pours ?? []).map((r) => r.id).join(",")}|${p.drinks.filter((d) => d.ready).map((d) => d.key).join(",")}`;
    if (ranked?.key === key) return ranked;
    if (!city() || (!p.pours?.length && !p.drinks.some((d) => d.ready))) return null;
    const routes = await loadRoutes(p, index).catch(() => []);
    if (!routes.length) return null; // a live run's rooms (N3: rooms that pour you) come with the plan
    ranked = { key, routes, ...mergeLists(routes) };
    return ranked;
  };
  const drawKnown = async () => {
    const r = await rankedRooms();
    const hint = $("#known-hint", root);
    if (!hint) return; // a fast sample Build tore the form down while the ranked rooms loaded: nothing to draw
    const later = !r && p.city && (p.cityLive || p.drinks.some((d) => !d.ready) || p.pours?.length); // rooms Doors ranks when it builds the plan
    // the count the plan uses: the ranked rooms of the kinds she pitches (pool.js buildPool's Rooms filter), of all ranked
    const kinds = r ? r.ids.filter((id) => { const v = r.venues[id]; return v && (p.rooms ?? []).includes(roomOf(v)) && Number.isFinite(v.lat) && Number.isFinite(v.lon) && !v.closed; }).length : 0;
    hint.textContent = r ? knownHint({ routes: r.routes, r, kinds, cityName: city().name }) : `${later ? "Your ranked doors come with your plan: mark the ones you know there." : "Pick your drinker's brand and your city first."} ${KEEP_ON_ROUTE}`;
    kInput.disabled = !r;
    $("#known-tags", root).innerHTML = p.known
      .map((id) => `<span class="tag">${esc(r?.venues[id]?.name ?? "A door you know")}<button type="button" data-id="${esc(id)}" aria-label="Remove ${esc(r?.venues[id]?.name ?? "room")}">×</button></span>`)
      .join("");
  };
  const drawKnownDD = async () => {
    const r = await rankedRooms();
    const q = kInput.value.trim().toLowerCase();
    const open = !!r && q.length >= 2 && document.activeElement === kInput;
    kdd.hidden = !open;
    kInput.setAttribute("aria-expanded", String(open));
    if (!open) return;
    const hits = r.ids.map((id, i) => ({ id, i, v: r.venues[id] })).filter((x) => !p.known.includes(x.id) && x.v?.name?.toLowerCase().includes(q)).slice(0, 8);
    // Jard 10-24: no "#N" here: this is Qloo's order before the door-type filter, not Your list's rank
    kdd.innerHTML = hits.map((x) => `<div role="option" data-id="${esc(x.id)}"><span>${esc(x.v.name)}<span class="osub">${esc(cap(genreLabel(x.v)) || "")}${x.v.neighborhood ? ` · ${esc(x.v.neighborhood)}` : ""}</span></span><small>Already know them</small></div>`).join("") || `<div class="note">No ranked door by that name.</div>`;
  };
  kInput.addEventListener("input", drawKnownDD);
  kInput.addEventListener("focus", drawKnownDD);
  kInput.addEventListener("blur", () => setTimeout(() => (kdd.hidden = true), 150));
  kdd.addEventListener("mousedown", (e) => {
    const o = e.target.closest("[data-id]");
    if (!o) return;
    e.preventDefault();
    p.known = [...p.known, o.dataset.id];
    kInput.value = "";
    kdd.hidden = true;
    drawKnown();
    changed();
  });
  $("#known-tags", root).addEventListener("click", (e) => {
    const b = e.target.closest("button[data-id]");
    if (!b) return;
    p.known = p.known.filter((x) => x !== b.dataset.id);
    drawKnown();
    changed();
  });
  $("#fd-known", root).addEventListener("toggle", drawKnown);

  // ---------- validation + build ----------
  const refresh = () => {
    // L1 hook (review6): live cities and brands are valid now, so every error the validation gives is shown (the old
    // "needs a live run" notes no longer exist)
    const all = validateProfile(p, { cities: index.cities }).errors;
    // group 3 #5: a part checks its own fields; in a city's form, a brand saved before a field was required says so
    const errors = Object.fromEntries(Object.entries(all).filter(([k]) => inPart(mode, k)));
    const brandMissing = mode === "city" ? GATED.filter((k) => all[k] && !inPart(mode, k)).map((k) => NEED[k]) : [];
    const ok = !Object.keys(errors).length && !brandMissing.length;
    $("#build", root).disabled = !ok;
    const clr = $("#f-clear", root);
    if (clr) clr.inert = !formFilled(p); // judge pass 6 (#4); inert, not hidden: its space stays, so nothing moves (Jard 10-23)
    const missing = GATED.filter((k) => errors[k] && !touched.has(k));
    // intuitiveness audit #10: the pinned bar names the first missing field (the rest follow as you fill it).
    // r2 (Jard 10-24: "had to look for it"): it is a button that takes you to that field, and each required field
    // still missing has its Required mark in orange.
    for (const [k, sel] of Object.entries(FIELD_OF)) $(sel, root)?.classList.toggle("missing", Boolean(errors[k]) && inPart(mode, k));
    const firstBad = GATED.find((k) => errors[k]);
    if (brandMissing.length) $("#need", root).innerHTML = `Your brand needs ${esc(brandMissing.join(", "))}: <a href="${esc(brandHref ?? "#/brand")}">Edit my brand</a>.`;
    else if (ok) $("#need", root).textContent = "";
    else if (firstBad) $("#need", root).innerHTML = `<button type="button" class="needgo" data-k="${firstBad}">Still needed: ${esc(missing.length ? NEED[missing[0]] : NEED[firstBad])}${missing.length > 1 ? ` (and ${missing.length - 1} more)` : ""}</button>`;
    else $("#need", root).textContent = Object.values(errors)[0] ?? ""; // L1 hook: the error itself
    for (const el of $$("[data-err]", root)) {
      const k = el.dataset.err;
      const show = touched.has(k) && errors[k];
      el.hidden = !show;
      el.textContent = show ? errors[k] : "";
    }
    return ok;
  };
  $("#need", root).addEventListener("click", (e) => {
    const b = e.target.closest(".needgo");
    if (!b) return;
    const k = GATED.find((x) => $(FIELD_OF[x], root)?.classList.contains("missing")) ?? b.dataset.k;
    const el = $(FIELD_OF[k], root);
    if (!el) return;
    if (el.closest("details") && !el.closest("details").open) el.closest("details").open = true;
    el.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion:reduce)").matches ? "auto" : "smooth" });
    $("input:not([hidden]):not([disabled]), button.tog, select", el)?.focus({ preventScroll: true });
    el.classList.remove("flashreq");
    void el.offsetWidth;
    el.classList.add("flashreq");
  });
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    GATED.filter((k) => inPart(mode, k)).forEach((k) => touched.add(k));
    if (refresh()) onBuild(p);
  });

  drawTags();
  drawPours();
  drawRooms();
  drawProduct();
  drawDrinkers();
  drawAsk();
  drawDays();
  drawSupport();
  drawKnown();
  startHint();
  refresh();
  if (field) goToField(root, field); // round 4 #6: opened from Settings at that field
  const unrules = rules ? mountRules($("#rules-host", root), rules) : () => {};
  const cleanup = () => { unrules(); document.removeEventListener("pointerdown", onOutside, true); document.removeEventListener("pointerdown", onOutsidePours, true); pin?.map?.remove(); wpin?.map?.remove(); };
  // sync(): draw the form from the profile after someone else changed it (the guided demo fills it field by field
  // through the profile, never through the typeaheads, so a lost focus can't drop a pick)
  cleanup.sync = () => {
    $("#f-brand", root).value = p.brand;
    $("#f-what", root).value = p.what;
    cInput.value = cityText(p, index.cities);
    aInput.value = p.start?.label ?? "";
    vInput.value = p.visitMin ?? "";
    capSync();
    $("#f-menu", root).value = p.pitch.menuPrice ?? "";
    $("#f-ask", root).value = p.pitch.ask ?? "";
    $("#f-name", root).value = p.pitch.name ?? "";
    p.product = { ...emptyProduct(), ...(p.product ?? {}) };
    p.drinkers = { ...emptyDrinkers(), ...(p.drinkers ?? {}) };
    drawProduct();
    drawDrinkers();
    drawSigner();
    drawAsk();
    drawTags();
    drawPours();
    drawRooms();
    drawDays();
    drawSupport();
    startHint();
    drawKnown();
    refresh();
  };
  return cleanup;
}

// "Your name, or “The Tidewell team”" (the brand as typed, else Tidewell).
const signerHint = (brand) => `Your name, or “The ${String(brand ?? "").trim() || "Tidewell"} team”`;

// The Examples row ("Try an example", folded): "Maya Ortiz · Tidewell (non-alcoholic hazy IPA) · Austin" and one per other drinker; the one filled
// is pressed and says it's made up. Class sampleask: the guided demo hides it.
function examplesHTML(p) {
  const xs = examples();
  const cur = p.sample ? xs.find((x) => x.key === (p.sample === true ? "maya" : p.sample)) : null;
  const chip = (x) => {
    const [who, ...rest] = x.label.split(" · ");
    return `<button type="button" class="ex" data-ex="${esc(x.key)}" aria-pressed="${cur?.key === x.key}" aria-label="${esc(x.label)}" title="${esc(x.label)}"><b>${esc(who)}</b><span>${esc(rest.join(" · "))}</span></button>`;
  };
  // ease (AUDIT-EASE-1): one row, folded; the examples open from it (9 cards pushed the first field below the fold)
  return `<div class="sampleask examples" id="examples">
    <details class="exfold"><summary class="exhead"><span class="lbl" id="l-ex">Try an example</span>${cur ? `<span class="muted"><span class="exfic">${esc(fiction(cur))} </span>Change anything, or press Build.</span>` : ""}</summary>
    <div class="exrow" role="group" aria-labelledby="l-ex">${xs.map(chip).join("")}</div></details><button type="button" class="btn ghost sm" id="f-clear"${formFilled(p) ? "" : " inert"}>Clear the form</button></div>`;
}

// The line under the heading (group 3 #5): what this form changes.
// live check G: a live city that never built (no index entry) is named as the rep typed it, never by its slug
const unslug = (k) => String(k ?? "").replace(/-([a-z]{2})$/i, (m, st) => `, ${st.toUpperCase()}`).split("-").map((w) => w.replace(/^\p{Ll}/u, (c) => c.toUpperCase())).join(" ");
export function cityLabel(editing, index, profile = null) {
  return index.cities.find((c) => c.key === editing.city)?.name ?? (profile?.city === editing.city && profile?.cityName ? profile.cityName : unslug(editing.city));
}
function partNote(mode, editing, p) {
  const brand = esc(String(p.brand ?? "").trim() || "your brand");
  if (mode === "brand") return `<div class="editnote" role="status">Your brand, product, drinkers and ask, for every city. Saving re-plans each city; its statuses, outcomes and contacts stay.</div>`;
  if (mode === "city") return `<div class="editnote" role="status">${editing ? `This city's days, start and doors for ${brand}. Its statuses, outcomes and contacts stay when you re-plan.` : `A new city for ${brand}: its own days, start and plan. Your brand, product and ask carry over.`}</div>`;
  return "";
}

// "My cities" (group 3 #5, was "Your plans", G7): every city saved under the brand, newest first. A row opens its plan;
// Edit opens its days and start; Delete asks on the row itself first. list() → store.list() rows; onDelete(row)
// removes one; current: {brand, city} of the plan on screen; onCount(n) after each draw. Returns {draw}.
export function mountCities(el, { list, cities, current = null, onDelete, onCount = () => {} }) {
  let asking = null; // "brand\u0000city" of the row waiting for "Delete?"
  let rows = [];
  const draw = () => {
    rows = list().map((r) => ({ ...planRow(r, cities), raw: r }));
    if (!rows.some((r) => r.id === asking)) asking = null;
    const isCur = (r) => current && r.raw.brand === current.brand && r.raw.city === current.city;
    el.innerHTML = `${rows.length ? `<ul class="plist">${rows.map((r, i) => r.id === asking
      ? `<li class="prow ask" data-i="${i}"><span class="ptext">Delete ${esc(r.city)}? Its plan, statuses, outcomes and contacts go too.</span>
          <span class="pact"><button type="button" class="btn sm danger" data-act="yes">Delete</button><button type="button" class="btn line sm" data-act="no">Keep</button></span></li>`
      : `<li class="prow${isCur(r) ? " cur" : ""}" data-i="${i}"><a class="popen" href="${esc(r.open)}"${isCur(r) ? ' aria-current="page"' : ""}><b>${esc(r.city)}</b>
          <small>${esc(r.days)}${r.opened ? ` · ${esc(r.opened)}` : ""}${isCur(r) ? " · on screen" : ""}</small></a>
          <span class="pact"><a class="btn line sm" href="${esc(r.edit)}" aria-label="Edit ${esc(r.city)}">Edit</a><button type="button" class="btn line sm" data-act="del" aria-label="Delete ${esc(r.city)}">Delete</button></span></li>`).join("")}</ul>`
      : `<p class="pnone">No cities yet. Add one and its plan shows here.</p>`}
      <div class="pfoot"><a class="btn line sm" href="${esc(ADD_CITY)}">Add a city</a></div>`;
    onCount(rows.length);
  };
  el.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-act]");
    if (!b) return;
    const r = rows[+b.closest("[data-i]").dataset.i];
    const act = b.dataset.act;
    if (act === "del") asking = r.id;
    else if (act === "no") asking = null;
    else if (act === "yes") { asking = null; onDelete(r.raw); }
    draw();
    $(act === "del" ? '[data-act="no"]' : act === "no" ? `[data-i="${b.closest("[data-i]").dataset.i}"] .popen` : ".popen, .pfoot a", el)?.focus();
  });
  return { draw };
}
