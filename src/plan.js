// The call planner: the exact Qloo request shapes Doors uses (PROBES §9, §11, §13, §14), shared by the Worker's
// live path and scripts/precompute.mjs so both make identical calls.
import { PLACE_TAGS, trimVenue, isFoodAndDrink, trimArtist, km } from "../public/lib/core.js";
import { rankBrands, pickBrand } from "../public/lib/drinks.js";

export const POPULARITY_CAP = 0.9;
export const TAKE = 50;
export const PAGES = 3;

// Brand (or venue) as the drinker → bars and restaurants in a city.
export function doorParams({ signalId, city, page = 1, ageBuckets = null, cap = POPULARITY_CAP, take = TAKE }) {
  return {
    "filter.type": "urn:entity:place",
    "signal.interests.entities": signalId,
    "filter.location.query": city,
    "filter.tags": PLACE_TAGS.join(","),
    "operator.filter.tags": "union",
    take,
    page,
    "feature.explainability": "true",
    ...(cap ? { "filter.popularity.max": cap } : {}),
    ...(ageBuckets ? { "signal.demographics.age": ageBuckets } : {}),
  };
}

// Three weighted things the drinker loves → the same doors (POST; weights need {id, weight}).
export function proxyBody({ proxies, city, page = 1, cap = POPULARITY_CAP, take = TAKE }) {
  return {
    "filter.type": "urn:entity:place",
    "signal.interests.entities": proxies.map((p) => ({ id: p.id, weight: Number(p.weight) || 1 })),
    "filter.location.query": city,
    "filter.tags": PLACE_TAGS.join(","), // POST rejects a JSON array here; the comma string works
    "operator.filter.tags": "union",
    "feature.explainability": true,
    ...(cap ? { "filter.popularity.max": cap } : {}),
    take,
    page,
  };
}

// A door's sister doors: the anchor as the signal, other bars and restaurants in the same city.
// (The bar/restaurant tags are added to the spec's shape so a golf course cannot come back as a sister.)
export function sisterParams({ placeId, city, take = 20 }) {
  return {
    "filter.type": "urn:entity:place",
    "signal.interests.entities": placeId,
    "filter.location.query": city,
    "filter.exclude.entities": placeId,
    "filter.tags": PLACE_TAGS.join(","),
    "operator.filter.tags": "union",
    "feature.explainability": "true",
    take,
  };
}

// The room's sound: artists Qloo associates with the venue's crowd.
export function soundParams({ placeId, take = 20 }) {
  return { "filter.type": "urn:entity:artist", "signal.interests.entities": placeId, take };
}

// A neighbourhood's or city's sound (locality signal; reliable even in small metros, PROBES §13).
export function localitySoundParams({ query, take = 20 }) {
  return { "filter.type": "urn:entity:artist", "signal.location.query": query, take };
}

export function brandArtistParams({ brandId, take = 30 }) {
  return { "filter.type": "urn:entity:artist", "signal.interests.entities": brandId, take };
}

export const entities = (body) => body?.results?.entities ?? [];

// One page of place results → trimmed F&B venues plus the count dropped by the filter.
export function venuesFromPage(body, { alcohol = false } = {}) {
  const all = entities(body).filter((e) => !e.subtype || e.subtype === "urn:entity:place");
  const kept = all.filter((e) => isFoodAndDrink({ genre: e.properties?.primary_genre?.id, name: e.name, address: e.properties?.address }, { alcohol }));
  return { venues: kept.map(trimVenue), dropped: all.length - kept.length, droppedNames: all.filter((e) => !kept.includes(e)).map((e) => e.name) };
}

export const artistsFrom = (body) => entities(body).map(trimArtist);

// Search results with a disambiguation line for the picker.
export function searchRows(body) {
  const rows = Array.isArray(body?.results) ? body.results : (body?.results?.entities ?? []);
  return rows.map((r) => ({
    id: r.entity_id,
    name: r.name,
    type: (r.types ?? [r.subtype]).filter(Boolean)[0] ?? null,
    where: r.properties?.address ?? r.disambiguation ?? r.properties?.short_description?.slice(0, 80) ?? null,
    popularity: r.popularity ?? null,
  }));
}

// L1: the brand search for "Your drinker also drinks…" (one Qloo call). Qloo answers with every kind of brand, so (owner
// review 7) the name that matches what was typed comes first, Qloo's tags saying it's a drink only break ties, clearly
// non-drink ones (fashion, schools, retail…) go when any drink is there, and an empty line gets the drink's kind
// ("urn:tag:product_category:qloo:hard_seltzer" → "Hard seltzer"). public/lib/drinks.js has the rules.
export function brandRows(body, query) {
  const raw = Array.isArray(body?.results) ? body.results : (body?.results?.entities ?? []);
  return rankBrands(raw, query, (r) => searchRows({ results: [r] })[0]);
}
export { pickBrand };

// Place search for "Add a door" (one Qloo call): the search answer already carries each place's own record
// (location, hours, address, phone), so no second call is needed. Kept: places within maxKm of the city centre.
export function placeRows(body, center, maxKm = 40) {
  const rows = Array.isArray(body?.results) ? body.results : (body?.results?.entities ?? []);
  const c = { lat: center[0], lon: center[1] };
  return rows
    .filter((e) => (!e.subtype || e.subtype === "urn:entity:place" || (e.types ?? []).includes("urn:entity:place")) && Number.isFinite(e.location?.lat) && Number.isFinite(e.location?.lon))
    .map((e) => trimVenue(e))
    .filter((v) => km(c, v) <= maxKm)
    .map((v) => ({ id: v.id, name: v.name, where: v.address ?? v.neighborhood ?? null, venue: v }));
}

// N3: "Rooms that already pour you (any city)" (one Qloo call): bars and restaurants anywhere, each with
// "neighbourhood, city" from Qloo's own geocode (an airport or a hotel the search also returns is left out).
export function pourRows(body) {
  const rows = Array.isArray(body?.results) ? body.results : (body?.results?.entities ?? []);
  return rows
    .filter((e) => (!e.subtype || e.subtype === "urn:entity:place" || (e.types ?? []).includes("urn:entity:place")) && e.entity_id && e.name)
    .filter((e) => isFoodAndDrink({ genre: e.properties?.primary_genre?.id, name: e.name, address: e.properties?.address }))
    .map((e) => {
      const g = e.properties?.geocode ?? {};
      const where = [g.name && g.name !== g.city ? g.name : null, g.city].filter(Boolean).join(", ") || e.properties?.address || null;
      return { id: e.entity_id, name: e.name, where };
    });
}

export const slugify = (s) =>
  String(s)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
