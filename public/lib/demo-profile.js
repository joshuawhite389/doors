// The demo's persona and profile (SPEC-V2 §3.6): Maya Ortiz runs Tidewell, a non-alcoholic hazy IPA from San Diego,
// opening Austin. Tidewell and Maya are made up; every venue is real (Qloo's Austin records). Pure: no DOM, no fetch.
// Used by the demo script (ui/demo.js), the bake (scripts/bake-demo.mjs) and the tests.
import { isoDate, sampleProfile, chipStart, START_CHIPS } from "./profile.js";

export const PERSONA = {
  name: "Maya Ortiz",
  brand: "Tidewell",
  line: "Maya Ortiz runs Tidewell, a non-alcoholic hazy IPA from San Diego. She's opening Austin next week.",
  fiction: "Tidewell and Maya are made up for the demo. Every bar and restaurant is real.",
};

export const DEMO_CITY = "austin";
export const DEMO_DRINKER = { key: "athletic-brewing", name: "Athletic Brewing", ready: true };
// The Austin "east" start chip (F3): East Austin · E Cesar Chavez. With Central District Brewing already talked to and
// Tuesday 1–6 pm, Tuesday holds ten doors from 1 pm (H1: the most doors first), Nomadic Beerworks (#1 for Athletic
// drinkers) sixth and Latchkey (#32, 1.2 road mi from the start, opens 4 pm) ninth (F4 showcase search, main's ruling;
// fill by rank since 2026-10-23).
export const DEMO_START = chipStart(START_CHIPS.austin.find((c) => c.key === "east"));
// The stop the demo opens and marks Interested · follow up Thursday: Nomadic Beerworks, #1, with a specific crowd line.
// Its return visit costs Thursday +4.3 road mi and two rooms, which the toast names (H1 re-bake).
export const DEMO_SHOWCASE = { id: "00000000-0000-4000-8000-271655E6AA28", name: "Nomadic Beerworks" };
// "Already talked to" before planning: Central District Brewing (#28 on Athletic Brewing's Austin list).
export const DEMO_KNOWN = { id: "00000000-0000-4000-8000-D88E4224A5AD", name: "Central District Brewing" };
// Her contact: BBG'S, a real Qloo Austin sports bar (214 E 6th St) that is not on Athletic Brewing's ranked 100. It
// opens Thursdays only of her three days, so it lands on Thursday. Its record is baked into public/data/demo/demo.json.
export const DEMO_CONTACT_ID = "00000000-0000-4000-8000-2780BAA954E5";
// Times per window, Tue / Wed / Thu: Thursday is there so the follow-up lands on its own date.
export const DEMO_HOURS = [["13:00", "18:00"], ["14:00", "17:00"], ["14:00", "17:00"]]; // Tue 1–6, Wed 2–5, Thu 2–5
// Her pitch, on top of the sample brand's (price, ask): staff tasting only, her full name.
export const DEMO_PITCH = { support: ["tasting"], name: "Maya Ortiz" };

// The next Tuesday strictly after `today`, then the Wednesday and Thursday after it, so the demo never shows a past
// date and Thursday always follows Tuesday. → ["2026-10-13", "2026-10-14", "2026-10-15"]
export function demoDates(today = new Date()) {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  do d.setDate(d.getDate() + 1); while (d.getDay() !== 2);
  return [0, 1, 2].map((k) => isoDate(new Date(d.getFullYear(), d.getMonth(), d.getDate() + k)));
}

// Her usual week (lib/week.js): Tue 1–6, Wed 2–5, Thu 2–5 every week from the demo's Tuesday; the demo plans its first
// week (ahead 1), the three days the tour's cards walk through.
export function demoWeek(today = new Date()) {
  const dates = demoDates(today);
  return { days: Object.fromEntries(["tuesday", "wednesday", "thursday"].map((d, i) => [d, { from: DEMO_HOURS[i][0], to: DEMO_HOURS[i][1] }])), changes: {}, since: dates[0], ahead: 1 };
}

// The profile the demo types in: F3's sample brand (lib/profile.js sampleProfile, the one Tidewell definition) with the
// demo's three windows, her pitch and Central District Brewing already talked to.
export function demoProfile(today = new Date()) {
  const { sample, ...base } = sampleProfile(today);
  const dates = demoDates(today);
  return {
    ...base,
    start: { ...DEMO_START },
    windows: dates.map((date, i) => ({ date, from: DEMO_HOURS[i][0], to: DEMO_HOURS[i][1] })),
    week: demoWeek(today),
    pitch: { ...base.pitch, ...DEMO_PITCH, support: [...DEMO_PITCH.support] },
    known: [DEMO_KNOWN.id],
  };
}

// The contact as the plan stores it (B1 contacts: a Qloo record, always pinned, labelled "My contact").
export const demoContact = (venue) => ({ ...venue, id: DEMO_CONTACT_ID, source: "qloo" });
