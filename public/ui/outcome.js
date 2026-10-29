// The outcome sheet (SPEC-V2 §8): Log visit → one tap saves (R1 Calacanis 4: two taps in all): Interested · Follow up ·
// Talked to someone else · Not interested, all styled the same; the Follow up button carries its date, "Follow up Wed Oct
// 28" (ease audit #8, audit 2 #4). "Add details" opens the full form: any
// result, a follow-up date (default the next window), who (any result: a return visit asks for them by name), a note. The stop writes it through state.js.
import { RESULTS, makeOutcome, shortDate, localStamp, quickChoices, visitStamp } from "../lib/outcome.js";
import { parseTime } from "../lib/visit-parse.js";
import { fitFollowUp, moveFollowUp, altLabel, clashStem } from "../lib/fu-check.js";
import { niceDate } from "../lib/profile.js";
import { clockShort } from "../lib/schedule.js";
import { $, $$, esc } from "./dom.js";

const pad = (n) => String(n).padStart(2, "0");
const hhmm = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

export { quickChoices }; // the one-tap choices live in lib/outcome.js (shared with the phone)

// When a visit is logged. The guided demo sets it to the visit's own slot on its (future) Tuesday, so "you talked on
// Tue" and the return visit's note match its story; null = now.
let clock = null;
export const setOutcomeClock = (fn) => void (clock = fn);

// openOutcome(host, {name, current, defaultDate, onSave(outcome, {said}), onCancel, venue, windows, visitMin, others, day, eta})
// day + eta: the stop's day ("YYYY-MM-DD") and planned arrival (minutes): a visit logged on a previewed day is stamped
// on that day at that time (lib visitStamp), not today's clock → close()
// others: the plan's other timed follow-ups (fu-check otherFollowUps): one at the same time that day is said, with the next free slot
// venue (its hours) + windows: a follow-up is checked against the door's hours (lib/fu-check.js) before it is saved:
// a time before opening becomes the opening (said: the sentence to show), a closed day asks first and offers the next
// open day.
export function openOutcome(host, { name, current = null, defaultDate, onSave, onCancel, venue = null, windows = [], week = null, visitMin = 25, others = [], day = null, eta = null }) {
  let result = current?.result ?? null;
  let follow = Boolean(current?.followUp);
  const date = current?.followUp ?? defaultDate;
  const quick = quickChoices(defaultDate);
  host.innerHTML = `
  <div class="osheet" role="dialog" aria-modal="true" aria-labelledby="o-title">
    <h3 id="o-title" tabindex="-1">How did it go at ${esc(name)}?</h3>
    <div class="oquick" role="group" aria-label="Save an outcome">
      ${quick.map((q) => `<button type="button" class="btn line oq" data-q="${q.key}">${esc(q.text ?? q.label)}</button>`).join("")}
    </div>
    <button type="button" class="lnk" data-o="more" aria-expanded="false" aria-controls="o-more">Add details: another date, who, a note</button>
    <div id="o-more" hidden>
      <div class="ores" role="radiogroup" aria-label="What happened">
        ${RESULTS.map((r) => `<button type="button" role="radio" class="tog" data-r="${r.key}" aria-checked="${result === r.key}">${esc(r.label)}</button>`).join("")}
      </div>
      <div class="orow" id="o-who"><label for="o-whoin">Who did you talk to? <span class="muted" id="o-whoopt">(optional: next time Doors says to ask for them)</span></label><input class="inp" id="o-whoin" autocomplete="off" placeholder="e.g. Jo, the bar manager" value="${esc(current?.who ?? "")}"></div>
      <div class="orow" id="o-fu">
        <label class="check" id="o-fucheck"><input type="checkbox" id="o-fuon" ${follow ? "checked" : ""}> Follow up</label>
        <span class="olbl" id="o-fulbl" hidden>Follow up on</span>
        <input type="date" class="dt" id="o-date" value="${esc(date)}" aria-label="Follow-up date">
        <span class="muted small" id="o-dayname"></span>
        <label class="muted small" id="o-timelbl" for="o-time">at</label><input type="time" class="dt" id="o-time" step="300" value="${esc(current?.followUpTime ?? "")}" aria-label="Follow-up time (optional: the time you promised)">
      </div>
      <div class="orow"><label for="o-note">Note <span class="muted">(optional)</span></label><textarea class="inp" id="o-note" rows="2" placeholder="What they said, who to ask for next time">${esc(current?.note ?? "")}</textarea></div>
      <div class="oerr" role="alert" hidden></div>
      <div class="oact"><button type="button" class="btn primary" data-o="save">Save outcome</button></div>
    </div>
    <div class="oact"><button type="button" class="btn ghost sm" data-o="cancel">Cancel</button></div>
  </div>`;
  const sheet = $(".osheet", host);
  const sync = () => {
    $$("[data-r]", sheet).forEach((b) => b.setAttribute("aria-checked", String(b.dataset.r === result)));
    $("#o-whoopt", sheet).hidden = result === "someone";
    const must = result === "followup";
    $("#o-fucheck", sheet).hidden = must;
    $("#o-fulbl", sheet).hidden = !must;
    const on = must || follow;
    $("#o-date", sheet).hidden = !on;
    $("#o-time", sheet).hidden = !on;
    $("#o-timelbl", sheet).hidden = !on;
    const d = $("#o-date", sheet).value;
    $("#o-dayname", sheet).textContent = on && d ? shortDate(d) : "";
  };
  sync();
  const at = () => { const t = clock?.(); return t instanceof Date && Number.isFinite(t.getTime()) ? localStamp(t) : visitStamp(day, eta); }; // an invalid tour clock: the stop's own slot
  let warned = null; // the closed-day warning shown for this date + time: a second Save keeps it
  sheet.addEventListener("click", (e) => {
    const q = e.target.closest("[data-q]");
    if (q) return onSave?.(makeOutcome({ ...quick.find((x) => x.key === q.dataset.q).o, at: at() }));
    const r = e.target.closest("[data-r]");
    if (r) {
      result = r.dataset.r;
      sync();
      return;
    }
    const act = e.target.closest("[data-o]")?.dataset.o;
    if (act === "cancel") onCancel?.();
    if (act === "alt" && sheet._alt) {
      const m = moveFollowUp({}, sheet._alt);
      $("#o-date", sheet).value = m.followUp;
      $("#o-time", sheet).value = m.followUpTime ?? "";
      $(".oerr", sheet).hidden = true;
      warned = null;
      sync();
    }
    if (act === "more") {
      const more = $("#o-more", sheet);
      more.hidden = !more.hidden;
      $(".oquick", sheet).hidden = !more.hidden; // the choices show once (R2 Calacanis 15)
      $('[data-o="more"]', sheet).setAttribute("aria-expanded", String(!more.hidden));
      if (!more.hidden) (sheet.querySelector('[aria-checked="true"]') ?? sheet.querySelector("[data-r]")).focus();
    }
    if (act === "save") {
      const o = makeOutcome({ result, followUp: result === "followup" || follow ? $("#o-date", sheet).value : "", who: $("#o-whoin", sheet).value, note: $("#o-note", sheet).value, at: at() });
      const err = $(".oerr", sheet);
      if (o.error) {
        err.textContent = o.error;
        err.hidden = false;
        return;
      }
      // persona (rep): "come back Thursday at 3" in the note set no time; the time box, else a time the note says
      if (o.followUp) {
        const said = $("#o-time", sheet).value || (parseTime(o.note ?? "") != null ? hhmm(parseTime(o.note)) : "");
        if (/^\d{2}:\d{2}$/.test(said)) o.followUpTime = said;
      }
      const fit = fitFollowUp(o, venue, { windows, visitMin, others, week });
      if ((fit.code === "closed" || fit.code === "clash" || fit.code === "offplan") && warned !== `${o.followUp} ${o.followUpTime ?? ""}`) {
        warned = `${o.followUp} ${o.followUpTime ?? ""}`;
        err.innerHTML = `${esc(fit.code === "offplan" ? fit.text : fit.code === "clash" ? clashStem(fit.text) : fit.text.replace(/ [^.]*instead\?( It isn't one of your plan days.*)?$| Pick another day\?$/, ""))} ${fit.alt ? `<button type="button" class="lnk" data-o="alt">Use ${esc(altLabel(fit.alt))}</button> or ` : ""}Save again to keep it.`;
        err.hidden = false;
        sheet._alt = fit.alt;
        return;
      }
      onSave?.(fit.outcome, { said: fit.code === "early" ? fit.text : fit.code === "clash" && fit.outcome !== o ? fit.text.replace(/ [^.]*$/, "") : "" });
    }
  });
  sheet.addEventListener("change", (e) => {
    if (e.target.id === "o-fuon") follow = e.target.checked;
    sync();
  });
  sheet.addEventListener("keydown", (e) => {
    if (e.key === "Escape") (e.stopPropagation(), onCancel?.());
  });
  $("#o-title", sheet).focus(); // not the first choice: a focused "Interested" looked already picked (ease audit #8)
  return () => (host.innerHTML = "");
}
