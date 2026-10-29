// Doors Agent ability 9 (ASK-DOORS-SPEC §5, §9): Day done polish. The template debrief (day-debrief.js) always shows;
// on the rep's tap, the day's facts (dayFacts) go to POST /api/agent/debrief, which rewrites them into polished notes
// and next steps in one model call, facts only. The Worker removes every name before the model sees anything and puts
// the contact's back after. Pure: no DOM, no fetch. Web (ui/drive.js) and phone (screens/Drive.tsx) both use it.
import { dayFacts } from "./day-debrief.js";
import { inLocalTime } from "./agent-ui.js"; // "after midnight UTC" in the device's own time
import { planNames } from "./agent-context.js";

export const POLISH_PATH = "/api/agent/debrief";
export const POLISH_LABEL = "Polish my notes with Doors Agent";
export const POLISH_BUSY = "Doors Agent is writing up your day…";
export const POLISH_FOOT = "Rewritten from what you logged today, nothing added.";

// The request body: the day's facts with names (the Worker redacts them), the brand and the names to redact.
export function polishBody(plan, q, record) {
  return {
    v: 1,
    facts: dayFacts(plan, q, record, { redact: false }),
    profile: { brand: plan?.profile?.brand ?? "", what: plan?.profile?.what ?? "" },
    names: planNames(plan), // the same list as the Agent's and drive mode's (contacts[].contactName was missing)
  };
}

// The Worker's answer → what the screen shows: {summary, doors: [{id, name, note}], next: [..], model} or {failed: why}
export function polishView(r) {
  const p = r?.polished;
  if (!p || r.resting) return { failed: inLocalTime(r?.message ?? "Doors Agent couldn't polish the notes just now. The notes above are complete.") };
  const str = (x, n) => String(x ?? "").slice(0, n);
  return {
    summary: str(p.summary, 400),
    doors: (Array.isArray(p.doors) ? p.doors : []).slice(0, 30).filter((d) => d?.name && d?.note).map((d) => ({ id: str(d.id, 64), name: str(d.name, 80), note: str(d.note, 400) })),
    next: (Array.isArray(p.next) ? p.next : []).slice(0, 6).map((x) => str(x, 200)).filter(Boolean),
    model: str(r.model, 80),
  };
}
