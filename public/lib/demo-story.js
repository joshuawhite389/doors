// The guided demo's sentences about where her #1 door is (judge pass 9 #2: from card 15 on, both personas lost track of
// it). Shared by the web tour (ui/demo.js) and the phone's (app-mobile/src/tour.ts). Pure: no DOM.
import { followUpPlace } from "./outcome.js";
import { clock12, toMinutes } from "./profile.js";
import { clockShort } from "./schedule.js";
import { offDayText } from "./planview.js";

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : "");

// Card "replan": what the follow-up cost, as a sentence, naming the highlighted row (Thursday's, while the card's first
// line is about Tuesday): "The highlighted row is her follow-up at Nomadic Beerworks on Thursday, Oct 29. That
// adds 4.3 road miles to Thursday, and Las Perlas and The Wheel come off Thursday to make room." highlighted: false on
// the phone, which highlights no row: "Her follow-up at Nomadic Beerworks goes on Thursday, Oct 29. …"
export function replanSentence(plan, id, date, { highlighted = true } = {}) {
  const at = followUpPlace(plan, id, date);
  if (!at.day) return "";
  const when = new Date(`${at.day.date}T12:00`).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
  const cost = plan.replanCost ?? {};
  const names = (cost.droppedIds ?? []).map((x) => plan.venues?.[x]?.name).filter(Boolean);
  const list = names.length > 2 ? `${names.slice(0, 2).join(", ")} and ${names.length - 2} more` : names.join(" and ");
  const mi = Number.isFinite(cost.addedMi) && cost.addedMi >= 0.1 ? `${cost.addedMi.toFixed(1)} ${plan.source === "ors" ? "road miles" : "miles, estimated,"}` : "";
  const day = cap(at.day.day ?? "that day");
  const then = mi && list ? `That adds ${mi} to ${day}, and ${list} come${names.length === 1 ? "s" : ""} off ${day} to make room.`
    : mi ? `That adds ${mi} to ${day}.` : list ? `${list} come${names.length === 1 ? "s" : ""} off ${day} to make room.` : "";
  const door = plan.venues?.[id]?.name ?? "the door";
  // judge 11 #2: no stop number here: the End card tells Thursday's move once ("from stop 6 to stop 1"), and a number
  // at this card read as a contradiction of it and of the lead image's "(stop 1)"
  return `${highlighted ? `The highlighted row is her follow-up at ${door} on ${when}.` : `Her follow-up at ${door} goes on ${when}.`} ${then}`.trim();
}

// Card "replan": the doors her visit pushed off its day, as a sentence (gigbot, after intuit pass 1b: Tuesday went from
// 10 doors to 9 with no word why): "The Drafting Room no longer fits Tuesday (9 doors now, not 10), so it's back on
// Your list." prev = the plan before the visit; "" when no door came off.
export function offVisitDay(prev, next, date, id) {
  const was = (prev?.days ?? []).find((d) => d?.date === date);
  const now = (next?.days ?? []).find((d) => d?.date === date);
  if (!was || !now) return "";
  const where = offDayText(prev, next, date, { skip: [id] });
  if (!where) return "";
  const venues = next?.venues ?? prev?.venues ?? {};
  const off = was.stops.map((s) => s.id).filter((x) => x !== id && venues[x]?.name && !now.stops.some((s) => s.id === x));
  const day = cap(now.day ?? "that day");
  const count = `${now.stops.length} doors now, not ${was.stops.length}`;
  const m = /^(.*) back on Your list$/.exec(where);
  return m ? `${m[1]} no longer fit${off.length === 1 ? "s" : ""} ${day} (${count}), so ${off.length === 1 ? "it's" : "they're"} back on Your list.` : `${day} has ${count}: ${where}.`;
}

// Where her #1 door's follow-up sits now, for the hand-off to compare against: {n, count, ids} (its stop number on that
// day, and the day's doors). Taken at card "replan", before drive mode's follow-up re-plans the day again.
export function followUpNow(plan, id, date) {
  const at = followUpPlace(plan, id, date);
  return at.day ? { n: at.n, count: at.day.stops.length, ids: at.day.stops.map((s) => s.id) } : null;
}

// The hand-off: where her #1 door ended up after drive mode's logged follow-up re-planned its day (intuit pass 1b #2:
// it names the door drive mode logged, and agrees with card "replan"): "Thursday changed again: The Yard's 3 pm
// follow-up joined it, so Nomadic Beerworks moved from stop 6 to stop 1, at 2:31 pm. Buck Wild and Idle Hands came off
// Thursday to make room." was = followUpNow at card "replan" (null: no "from stop 6", no doors named). "" when drive's
// follow-up went to another day (her #1 didn't move) or nothing was logged.
export function afterDriveText(plan, top, was = null) {
  const mine = plan?.outcomes?.[top];
  const drove = Object.keys(plan?.outcomes ?? {}).find((x) => x !== top && plan.outcomes[x]?.followUp);
  const fu = drove ? plan.outcomes[drove] : null;
  if (!fu || !mine?.followUp) return "";
  const at = followUpPlace(plan, top, mine.followUp);
  const stop = at.day?.stops?.[at.n - 1];
  if (!stop || at.day.date !== fu.followUp) return "";
  const name = (x) => plan.venues?.[x]?.name ?? "";
  const t = /^\d{2}:\d{2}$/.test(fu.followUpTime ?? "") ? toMinutes(fu.followUpTime) : null; // as its row says it: "3 pm"
  const arrive = Number.isFinite(stop.eta) ? stop.eta - (stop.waitMin ?? 0) : null;
  const day = cap(at.day.day ?? "that day");
  const moved = was?.n && was.n !== at.n ? `moved from stop ${was.n} to stop ${at.n}` : `is now stop ${at.n}`;
  const now = new Set(at.day.stops.map((s) => s.id));
  const off = (was?.ids ?? []).filter((x) => !now.has(x)).map(name).filter(Boolean);
  const list = off.length > 2 ? `${off.slice(0, 2).join(", ")} and ${off.length - 2} more` : off.join(" and ");
  return `${day} changed again: ${name(drove)}'s ${t != null ? `${clockShort(t)} ` : ""}follow-up joined it, so ${name(top)} ${moved}${arrive != null ? `, at ${clock12(arrive)}` : ""}.${list ? ` ${list} came off ${day} to make room.` : ""}`;
}

// Card "swap": where popularity alone would put each city's #1 (lib/demo-swap.js popRank), when neither is #1 by it
export function swapLine(sides) {
  const pops = (sides ?? []).filter((x) => x?.popRank > 1);
  return pops.length && pops.length === sides.length ? `Ordered by popularity alone, ${pops.map((x) => `${x.name} would be #${x.popRank} in ${x.city}`).join(" and ")}.` : "";
}
