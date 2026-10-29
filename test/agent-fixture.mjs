// The chat agent's test context: the guided demo's real Austin plan (Athletic Brewing drinkers, baked road times), as
// ui/plan.js publishes it, through public/lib/agent-context.js. No network.
import { route, city, readJson } from "./helpers.mjs";
import { demoProfile } from "../public/lib/demo-profile.js";
import { demoStates, bakedMatrix, nowStamp } from "../public/lib/demo-plan.js";
import { agentContext } from "../public/lib/agent-context.js";

// The demo week the tests were written against (Tue Oct 27 – Thu Oct 29, 2026): demoProfile() takes the next Tuesday
// after its day, so on the wall clock's Oct 27 the plan moved to Nov 3 and 10 log-visit / follow-up tests broke.
// The plan's clock is pinned too (FIXTURE_NOW): demoStates defaults `now` to the real clock, and on the fixture's own
// Tuesday after 6 pm the real clock sat past the first window, so day 1 planned empty and 46 tests threw (10-27 18:10).
export const FIXTURE_TODAY = new Date(2026, 9, 24);
export const FIXTURE_NOW = nowStamp(new Date(2026, 9, 24, 9, 0)); // tourNow moves it to the first window's start

export async function demoContext({ current = null, at = null } = {}) {
  const austin = route("athletic-brewing-austin");
  const demo = readJson("public/data/demo/demo.json");
  const profile = demoProfile(FIXTURE_TODAY);
  const { states } = await demoStates({ routes: [austin], profile, contact: demo.contact, fetchMatrix: bakedMatrix(demo.matrix), now: FIXTURE_NOW });
  const { plan: p, pool } = states[0];
  const plan = { ...p, venues: pool.venues, pool: { ids: pool.ids, N: pool.N, label: pool.label, drinker: pool.drinker }, statuses: pool.statuses ?? {}, outcomes: {}, profile, city: { key: "austin", name: "Austin" } };
  const first = plan.days[0];
  const now = at ?? new Date(`${first.date}T14:20:00`);
  return { plan, ctx: agentContext({ plan, dayIndex: 0, current: current === "first" ? first.stops[0].id : current, city: city("austin"), routes: [austin], now }) };
}
