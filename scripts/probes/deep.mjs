// R9 deep-data probe: which Qloo data beyond place ranking works for cultural grounding.
// Usage: node scripts/probes/deep.mjs <group>   — every call ledgered (source probe-deep); raw bodies → qloo-probes/2026-10-22/deep-*.json
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { QlooClient } from "../../src/qloo.js";
import { makeLedger } from "../../src/ledger.js";
const ROOT = new URL("../../", import.meta.url).pathname;
const OUT = process.env.HOME + "/.agent-work/projects/oldjardworkspace/brains/qloo-hackathon/qloo-probes/2026-10-22/";
const ledger = makeLedger(ROOT + "data/ledger.jsonl", { source: "probe-deep" });
const q = new QlooClient({ apiKey: readFileSync(process.env.HOME + "/.config/gigbot/qloo-key", "utf8").trim(), onLedger: (i) => ledger.record(i) });
const ent = JSON.parse(readFileSync(ROOT + "data/entities.json", "utf8"));
const ID = {
  casamigos: ent.brands.casamigos.chosen.id, liquid: ent.brands["liquid-death"].chosen.id, lacroix: ent.brands.lacroix.chosen.id,
  whiteclaw: ent.brands["white-claw"].chosen.id, parsons: ent.rooms.parsons.chosen.id,
  kite: "00000000-0000-4000-8000-E66E86FC6F8B", nomadic: "00000000-0000-4000-8000-271655E6AA28", tobala: "00000000-0000-4000-8000-B2AFF6264D67",
};
const T = (t) => `urn:entity:${t}`;
// [name, path, params]
const G = {
  // A. cross-domain tastes of a brand's / a room's audience (take 10)
  cross: ["casamigos", "liquid", "parsons", "nomadic"].flatMap((s) =>
    ["movie", "tv_show", "podcast", "book", "videogame", "destination", "person"].map((t) =>
      [`x-${s}-${t}`, "/v2/insights", { "filter.type": T(t), "signal.interests.entities": ID[s], take: 10 }])),
  cross2: ["tv_show", "podcast", "person", "destination", "movie"].map((t) => [`x-tobala-${t}`, "/v2/insights", { "filter.type": T(t), "signal.interests.entities": ID.tobala, take: 10 }])
    .concat([["g-audiences-life", "/v2/audiences", { "filter.parents.types": "urn:audience:life_stage", take: 20 }],
             ["g-tagsearch", "/v2/tags", { "filter.query": "mezcal", take: 10 }]]),
  cross3: ["tv_show", "podcast", "person"].map((t) => [`x-kite-${t}`, "/v2/insights", { "filter.type": T(t), "signal.interests.entities": ID.kite, take: 10 }]),
  menu: [
    ["m-tequila-tags", "/v2/tags", { "filter.query": "tequila", take: 10 }],
    ["m-casamigos-mezcal", "/v2/insights", { "filter.type": T("place"), "signal.interests.entities": ID.casamigos, "filter.location.query": "Austin", "filter.tags": "urn:tag:menu_highlight:qloo:mezcal", "filter.popularity.max": 0.9, take: 30 }],
  ],
  // B. demographics (age/gender affinity) for brands and rooms; one multi-entity call
  demo: [
    ["d-casamigos", "/v2/insights", { "filter.type": "urn:demographics", "signal.interests.entities": ID.casamigos }],
    ["d-liquid", "/v2/insights", { "filter.type": "urn:demographics", "signal.interests.entities": ID.liquid }],
    ["d-parsons", "/v2/insights", { "filter.type": "urn:demographics", "signal.interests.entities": ID.parsons }],
    ["d-nomadic", "/v2/insights", { "filter.type": "urn:demographics", "signal.interests.entities": ID.nomadic }],
    ["d-multi", "/v2/insights", { "filter.type": "urn:demographics", "signal.interests.entities": [ID.lacroix, ID.whiteclaw, ID.tobala] }],
  ],
  // C. neighbourhood affinity: localities ranked for a brand inside a city; heatmap with locality boundary
  hood: [
    ["h-casamigos-austin", "/v2/insights", { "filter.type": T("locality"), "signal.interests.entities": ID.casamigos, "filter.location.query": "Austin", take: 20 }],
    ["h-liquid-austin", "/v2/insights", { "filter.type": T("locality"), "signal.interests.entities": ID.liquid, "filter.location.query": "Austin", take: 20 }],
    ["h-parsons-chicago", "/v2/insights", { "filter.type": T("locality"), "signal.interests.entities": ID.parsons, "filter.location.query": "Chicago", take: 20 }],
    ["h-heat-locality", "/v2/insights", { "filter.type": "urn:heatmap", "signal.interests.entities": ID.casamigos, "filter.location.query": "Austin", "output.heatmap.boundary": "urn:entity:locality" }],
    ["h-heat-geohash", "/v2/insights", { "filter.type": "urn:heatmap", "signal.interests.entities": ID.casamigos, "filter.location.query": "Austin" }],
  ],
  hood2: [
    ["h-heat-locality-liquid", "/v2/insights", { "filter.type": "urn:heatmap", "signal.interests.entities": ID.liquid, "filter.location.query": "Austin", "output.heatmap.boundary": "urn:entity:locality" }],
    ["h-heat-locality-nomadic", "/v2/insights", { "filter.type": "urn:heatmap", "signal.interests.entities": ID.nomadic, "filter.location.query": "Austin", "output.heatmap.boundary": "urn:entity:locality" }],
    ["h-heat-locality-parsons", "/v2/insights", { "filter.type": "urn:heatmap", "signal.interests.entities": ID.parsons, "filter.location.query": "Chicago", "output.heatmap.boundary": "urn:entity:locality" }],
    ["h-heat-locality-casamigos-chi", "/v2/insights", { "filter.type": "urn:heatmap", "signal.interests.entities": ID.casamigos, "filter.location.query": "Chicago", "output.heatmap.boundary": "urn:entity:locality" }],
    ["h-heat-locality-casamigos-young", "/v2/insights", { "filter.type": "urn:heatmap", "signal.interests.entities": ID.casamigos, "filter.location.query": "Austin", "output.heatmap.boundary": "urn:entity:locality", "signal.demographics.age": "24_and_younger" }],
  ],
  trend2: [
    ["t-casamigos-2025", "/v2/trending", { "filter.type": T("brand"), "signal.interests.entities": ID.casamigos, "filter.start_date": "2025-01-01", "filter.end_date": "2025-06-30" }],
    ["t-liquid-wide", "/v2/trending", { "filter.type": T("brand"), "signal.interests.entities": ID.liquid, "filter.start_date": "2024-01-01", "filter.end_date": "2026-10-15" }],
    ["t-artist", "/v2/trending", { "filter.type": T("artist"), "signal.interests.entities": "00000000-0000-4000-8000-3351613201CB", "filter.start_date": "2025-01-01", "filter.end_date": "2026-10-15" }],
  ],
  // D. trending: the real endpoint needs dates; plus bias.trends on doors
  trend: [
    ["t-casamigos", "/v2/trending", { "filter.type": T("brand"), "signal.interests.entities": ID.casamigos, "filter.start_date": "2026-07-01", "filter.end_date": "2026-10-15" }],
    ["t-nomadic", "/v2/trending", { "filter.type": T("place"), "signal.interests.entities": ID.nomadic, "filter.start_date": "2026-07-01", "filter.end_date": "2026-10-15" }],
    ["t-brands", "/v2/trending", { "filter.type": T("brand"), "filter.start_date": "2026-09-01", "filter.end_date": "2026-10-15", take: 20 }],
    ["t-places-austin", "/v2/trending", { "filter.type": T("place"), "filter.location.query": "Austin", "filter.start_date": "2026-09-01", "filter.end_date": "2026-10-15", take: 20 }],
  ],
  trendbias: ["off", "very_high"].map((b) => [`tb-${b}`, "/v2/insights", { "filter.type": T("place"), "signal.interests.entities": ID.casamigos, "filter.location.query": "Austin",
    "filter.tags": "urn:tag:genre:place:restaurant,urn:tag:category:place:bar,urn:tag:genre:place:restaurant:bar", "operator.filter.tags": "union", "filter.popularity.max": 0.9, "bias.trends": b, take: 30 }]),
  // E. compare / overlap of two entities
  compare: [
    ["c-tags", "/v2/analysis/compare", { "a.signal.interests.entities": ID.casamigos, "b.signal.interests.entities": ID.liquid, take: 20 }],
    ["c-artist", "/v2/analysis/compare", { "a.signal.interests.entities": ID.casamigos, "b.signal.interests.entities": ID.liquid, "filter.type": T("artist"), take: 20 }],
    ["c-rooms", "/v2/analysis/compare", { "a.signal.interests.entities": ID.parsons, "b.signal.interests.entities": ID.tobala, "filter.subtype": "urn:tag:genre", take: 20 }],
  ],
  // F. tag categories of an audience (taste analysis) — brand and room
  tags: [
    ["g-casamigos-kw", "/v2/insights", { "filter.type": "urn:tag", "signal.interests.entities": ID.casamigos, "filter.tag.types": "urn:tag:keyword:qloo", take: 20 }],
    ["g-casamigos-place", "/v2/insights", { "filter.type": "urn:tag", "signal.interests.entities": ID.casamigos, "filter.parents.types": T("place"), take: 20 }],
    ["g-parsons-place", "/v2/insights", { "filter.type": "urn:tag", "signal.interests.entities": ID.parsons, "filter.parents.types": T("place"), take: 20 }],
    ["g-parsons-artist", "/v2/insights", { "filter.type": "urn:tag", "signal.interests.entities": ID.parsons, "filter.parents.types": T("artist"), take: 20 }],
    ["g-nomadic-any", "/v2/insights", { "filter.type": "urn:tag", "signal.interests.entities": ID.nomadic, take: 20 }],
    ["g-audiences", "/v2/audiences", { take: 20 }],
    ["g-audience-types", "/v2/audiences/types", { take: 20 }],
    ["g-entities", "/entities", { entity_ids: [ID.nomadic, ID.tobala] }],
  ],
  // G. gender dial on brand → doors
  gender: ["female", "male"].map((g) => [`gd-${g}`, "/v2/insights", { "filter.type": T("place"), "signal.interests.entities": ID.casamigos, "filter.location.query": "Austin",
    "filter.tags": "urn:tag:genre:place:restaurant,urn:tag:category:place:bar,urn:tag:genre:place:restaurant:bar", "operator.filter.tags": "union", "filter.popularity.max": 0.9, "signal.demographics.gender": g, take: 30 }]),
};
const which = process.argv[2];
const only = process.argv[3];
const list = (G[which] ?? []).filter(([n]) => !only || n.includes(only));
if (!list.length) { console.log("groups:", Object.keys(G).join(" ")); process.exit(1); }
ledger.assertBudget(list.length);
const names = (b) => { const r = b?.results; const a = Array.isArray(r) ? r : r?.entities ?? r?.tags ?? r?.demographics ?? r?.trending ?? r?.heatmap ?? [];
  return `${a.length} :: ` + a.slice(0, 10).map((e) => e.name ?? e.date ?? JSON.stringify(e.query ?? e).slice(0, 160)).join(" | "); };
for (const [n, path, params] of list) {
  const f = OUT + `deep-${n}.json`;
  if (existsSync(f)) { console.log(n, "cached"); continue; }
  try { const b = await q.get(path, params); writeFileSync(f, JSON.stringify(b, null, 1)); console.log(n, "→", names(b)); }
  catch (err) { writeFileSync(f, JSON.stringify({ error: err.status, message: err.message })); console.log(n, "ERR", err.status, err.message.slice(0, 300)); }
}
