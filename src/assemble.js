// Turn Qloo responses into the route and city files the page reads. Shared by the precompute build and the
// Worker's live path, so a live route and a precomputed one have the same shape.
import { venuesFromPage, artistsFrom, entities } from "./plan.js";
import { trimVenue, isFoodAndDrink, guardSound, km, referenceGenres, localeCounts, commonArtists } from "../public/lib/core.js";

const STATIC_KEYS = ["affinity", "growth", "explain"];
const stripQuery = (v) => Object.fromEntries(Object.entries(v).filter(([k]) => !STATIC_KEYS.includes(k)));
const row = (v) => [v.id, v.affinity == null ? null : Math.round(v.affinity * 10000) / 10000, v.growth == null ? null : Math.round(v.growth * 1000) / 1000, v.explain?.length > 1 ? v.explain.map((x) => [x.id, Math.round(x.score * 1000) / 1000]) : null];

// pages: 1–3 bodies of the main ranked list; ages: {dialKey: body}; famous: the uncapped page 1 body.
export function assembleRoute({ kind, drinker, city, pages = [], ages = {}, famous = null, alcohol = false, captured, calls }) {
  const venues = {};
  const lists = {};
  const dropped = {};
  const take = (key, bodies) => {
    const seen = new Set();
    const out = [];
    let d = 0;
    const names = [];
    for (const b of bodies) {
      if (!b) continue;
      const r = venuesFromPage(b, { alcohol });
      d += r.dropped;
      names.push(...r.droppedNames);
      for (const v of r.venues) {
        if (seen.has(v.id)) continue;
        seen.add(v.id);
        venues[v.id] ??= stripQuery(v);
        out.push(row(v));
      }
    }
    lists[key] = out;
    dropped[key] = { n: d, names: names.slice(0, 20) };
  };
  take("all", pages);
  for (const [k, b] of Object.entries(ages)) take(k, [b]);
  if (famous) take("famous", [famous]);
  return {
    v: 1,
    kind,
    drinker,
    city,
    captured,
    calls,
    filter: { tags: "bar and restaurant tags", popularityMax: 0.9, alcohol },
    lists,
    dropped,
    venues,
  };
}

// Sister doors for one anchor: [[id, affinity]] for F&B rooms, plus small records for rooms not in any list.
export function assembleSisters(body, { alcohol = false } = {}) {
  const ids = [];
  const records = {};
  for (const e of entities(body)) {
    if (!isFoodAndDrink({ genre: e.properties?.primary_genre?.id, name: e.name, address: e.properties?.address }, { alcohol })) continue;
    const v = trimVenue(e);
    ids.push([v.id, v.affinity == null ? null : Math.round(v.affinity * 1000) / 1000]);
    records[v.id] = { id: v.id, name: v.name, lat: v.lat, lon: v.lon, neighborhood: v.neighborhood, genre: v.genre, image: v.image, price: v.price, rating: v.rating, address: v.address };
  }
  return { ids, records };
}

// Room sounds for a set of doors, each gated by the guard. doors: [{id, lat, lon, name}], soundBodies: {id: body}.
// refLists: city + neighbourhood + drinker artist lists (shared-genre check); cityLists: the city's own lists only
// (locale check); common: artists returned for many rooms across the city (area check; computed here if absent).
// fix5-res: a list Qloo didn't answer for this run is empty. Without the city's own lists the locale check has nothing
// to compare with (skipped, never "a scene the city's lists do not have"); with no list at all, nothing is checked and
// every room's list is held back, saying why.
export function assembleSounds({ doors, soundBodies, refLists, cityLists = refLists, cityName, common = null }) {
  const ref = referenceGenres(refLists);
  const locale = localeCounts(cityLists);
  const noCity = !cityLists.some((l) => l?.length);
  const noRef = !refLists.some((l) => l?.length);
  const lists = {};
  for (const d of doors) if (soundBodies[d.id]) lists[d.id] = artistsFrom(soundBodies[d.id]).slice(0, 20);
  const area = common ?? commonArtists(Object.values(lists).map((l) => l.map((a) => a.id)));
  const out = {};
  for (const d of doors) {
    const artists = lists[d.id];
    if (!artists) continue;
    const nearby = doors
      .filter((o) => o.id !== d.id && lists[o.id])
      .map((o) => ({ id: o.id, name: o.name, km: km(d, o), artistIds: lists[o.id].map((a) => a.id) }))
      .filter((o) => o.km <= 1);
    const guard = noRef
      ? { pass: false, reason: "unchecked", detail: `Qloo didn't answer for ${cityName}'s sound or the drinkers' artists this run, so there was nothing to check this door's list against` }
      : guardSound(artists, ref, nearby, { locale, common: area, cityName, venue: d, ...(noCity ? { maxForeign: Infinity } : {}) });
    out[d.id] = { artists: artists.map(({ id, name, genres, spotify }) => ({ id, name, genres: genres.slice(0, 12), spotify })), guard };
  }
  return out;
}

export const soundList = (body, n = 20) => artistsFrom(body).slice(0, n).map(({ id, name, genres, spotify }) => ({ id, name, genres: genres.slice(0, 12), spotify }));
