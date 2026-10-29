// Doors Agent's specialist brief (src/brief.js): when a plan is built from a saved profile, ask the Worker for the brief
// of its category + city once per page (web: ui/plan.js, phone: engine.ts). The Worker builds it at most once per
// combination and shares it; the request stays open while it builds (~30–40 s), and nothing waits on the answer: the
// agent reads the brief from the Worker's cache on its next turn. Sends only the product line and the city.
const asked = new Set();
export function askBrief(plan, send) {
  const what = String(plan?.profile?.what ?? "").trim();
  const city = String(plan?.city?.name ?? "").trim();
  if (!city || typeof send !== "function") return false;
  const k = `${what.toLowerCase()}|${city.toLowerCase()}`;
  if (asked.has(k)) return false;
  asked.add(k);
  Promise.resolve()
    .then(() => send("/api/brief", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ what, city }) }))
    .catch(() => asked.delete(k));
  return true;
}
export const _resetAsked = () => asked.clear();
