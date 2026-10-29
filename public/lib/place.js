// Group 3 item 1 (Jard web review 10-24): the picture of a place, assembled from Qloo's facts about it, never written
// freely. Who goes and when, what the room is like and what it pours, and what that crowd also likes (Qloo's interest
// tags, the crowd's music, the sister doors). "Why this door" shows it on top (ui/why.js); the Agent's context (lane C)
// and the talking points (lane D) read the same object, so all three say the same thing about a room. Pure: no DOM,
// no fetch. Covered by test/place.test.mjs.
//
// placePicture({id, venue, city, routes, plan}) → {
//   id, name, kind,                      kind: Qloo's genre in words ("Gastropub"), or null
//   who:      {text} | null              Qloo's crowd description (customer_demographics_description), first sentence
//   ages:     {text, band} | null        the age band Qloo ranks it highest with (held cities' age re-ranks only)
//   when:     {times, visits, text} | null   Qloo's time-of-day and visit tags, in words
//   room:     {feel, liveMusic, text} | null Qloo's ambience tags (+ "Live music" when Qloo says so)
//   pours:    {items, text} | null       Qloo's beverage tags
//   into:     {items, text} | null       Qloo's interest tags for the place's crowd
//   music:    {state: "shown"|"held"|"none", genres, artists, text}   the crowd's artists (only when the sound check passed)
//   sisters:  {state: "shown"|"none", doors: [{id, name, onPlan}], text}   doors with the same crowd (Qloo place-to-place)
//   missing:  ["music"?, "sisters"?]     what Qloo hasn't been asked for this door yet (the "Get it from Qloo" button)
//   rows:     [{key, label, text}]       what a screen shows, in order; only the facts Qloo has
//   text:     one plain paragraph of the rows ("Who goes: …. When: …."), for a model's context
// }
import { genreLabel } from "./core.js";
import { onPlan } from "./stopmodel.js";
import { agesOf, skewOf } from "./roominsight.js";

export const PLACE_TITLE = "About the place";
export const PLACE_LABELS = {
  who: "Who goes",
  ages: "Ages",
  when: "When",
  room: "The room",
  pours: "What it pours",
  into: "The crowd is into",
  music: "Their music",
  sisters: "Same crowd as",
};
// what Qloo hasn't been asked about a door yet, in one sentence ("music", "sisters" or both)
export const placeMissingText = (missing) =>
  missing.length > 1 ? "Qloo hasn't been asked for this crowd's music or which doors share it yet."
  : missing[0] === "music" ? "Qloo hasn't been asked for this crowd's music yet."
  : missing[0] === "sisters" ? "Qloo hasn't been asked which doors share this crowd yet." : null;

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : "");
const low = (s) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s); // "Craft beer" → "craft beer", "LGBTQ+" kept
const tagList = (xs) => xs.join(", "); // tags joined plainly ("coffee and tea" is one tag)
const andList = (xs) => (xs.length <= 1 ? xs[0] ?? "" : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
const firstSentence = (t) => {
  const s = String(t ?? "").trim();
  if (!s) return null;
  const one = s.split(/(?<=[.!?])\s+/)[0];
  return one.length >= 40 ? one : s.split(/(?<=[.!?])\s+/).slice(0, 2).join(" ");
};
const tagsOf = (v, fam) => (Array.isArray(v?.tags?.[fam]) ? v.tags[fam].filter((x) => typeof x === "string" && x.trim()) : []);

// Qloo's time-of-day tags in clock order: "afternoon and evening", or "morning to late night" for four or more
const CLOCK = ["Morning", "Midday", "Afternoon", "Evening", "Late night"];
export function timesText(tod) {
  const t = CLOCK.filter((c) => tod.includes(c)).map((c) => c.toLowerCase());
  if (!t.length) return null;
  return t.length >= 4 ? `${t[0]} to ${t.at(-1)}` : andList(t);
}
// Qloo's visit-intent tags, in plain words
const VISITS = { "Routine visit": "regulars", Destination: "a destination", "Special occasion": "special occasions", "Impulse visit": "walk-ins" };
export function visitsText(visit) {
  const v = ["Routine visit", "Impulse visit", "Destination", "Special occasion"].filter((k) => visit.includes(k)).map((k) => VISITS[k]);
  return v.length ? andList(v) : null;
}

// The crowd's music from the city file's room sounds (lib/roominsight.js musicOf's rules): genres most of the top
// artists share, and the first three artists. "held": Qloo answered, but Doors' sound check didn't pass it.
const SKIP_GENRE = /^(all|usa|us|united_states|america|seen_live|favorites|favourite|beautiful|chill|love|mellow|male_vocalists|female_vocalists|bandcamp|\d0s|[a-z]+_\(us\))$/;
const GENRE_WORDS = { rb: "R&B", r_and_b: "R&B", rhythm_and_blues: "R&B", edm: "EDM", idm: "IDM", ebm: "EBM", mpb: "MPB", opm: "OPM", ccm: "CCM", aor: "AOR", hip_hop: "hip hop", texas_country: "Texas country", uk_garage: "UK garage", k_pop: "K-pop", j_pop: "J-pop" };
export function placeMusic(sound) {
  if (!sound) return { state: "none", genres: [], artists: [], text: null };
  if (!sound.guard?.pass) return { state: "held", genres: [], artists: [], text: null };
  const top = (sound.artists ?? []).slice(0, 10);
  const count = new Map();
  for (const a of top) for (const g of new Set(a.genres ?? [])) if (!SKIP_GENRE.test(g)) count.set(g, (count.get(g) ?? 0) + 1);
  const genres = [...count].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3).map(([g]) => GENRE_WORDS[g] ?? g.replace(/_/g, " "));
  const artists = top.slice(0, 3).map((a) => a.name).filter(Boolean);
  if (!artists.length) return { state: "held", genres: [], artists: [], text: null };
  return { state: "shown", genres, artists, text: `${genres.length ? `${cap(andList(genres))}: ` : ""}${andList(artists)}` };
}

// Doors whose regulars Qloo matches to this door's (the city file's sisters, best first), with the plan's doors marked.
export function placeSisters(city, id, plan = null, { take = 3 } = {}) {
  const list = city?.sisters?.[id];
  if (!Array.isArray(list)) return { state: "none", doors: [], text: null };
  const doors = list
    .map((r) => (Array.isArray(r) ? r[0] : r))
    .map((sid) => {
      const v = plan?.venues?.[sid] ?? city?.sisterVenues?.[sid] ?? null;
      return v?.name ? { id: sid, name: v.name, onPlan: !!onPlan(plan, sid) } : null;
    })
    .filter(Boolean)
    .slice(0, take);
  if (!doors.length) return { state: "shown", doors, text: "No other bar or restaurant in Qloo's match" };
  return { state: "shown", doors, text: andList(doors.map((d) => (d.onPlan ? `${d.name} (on your plan)` : d.name))) };
}

export function placePicture({ id, venue = null, city = null, routes = [], plan = null } = {}) {
  const v = venue ?? plan?.venues?.[id] ?? city?.sisterVenues?.[id] ?? {};
  const key = id ?? v.id ?? null;
  const g = genreLabel(v);
  const who = firstSentence(v.crowd);
  const r0 = (routes ?? [])[0] ?? null;
  const skew = r0 ? skewOf(agesOf(r0, key)) : null;
  const tod = tagsOf(v, "tod");
  const visit = tagsOf(v, "visit");
  const times = timesText(tod);
  const visits = visitsText(visit);
  const feel = tagsOf(v, "ambience").slice(0, 4);
  const liveMusic = v.liveMusic === true ? true : v.liveMusic === false ? false : null;
  const pours = tagsOf(v, "bev").slice(0, 5);
  const into = tagsOf(v, "interests").slice(0, 5);
  const music = placeMusic(city?.sounds?.[key]);
  const sisters = placeSisters(city, key, plan);
  const pic = {
    id: key,
    name: v.name ?? null,
    kind: g ? cap(g) : null,
    who: who ? { text: who } : null,
    ages: skew?.best ? { band: skew.best.label, text: `Ranks highest with ${skew.best.label} ${r0.drinker?.name ? `${r0.drinker.name} ` : ""}drinkers` } : null,
    when: times || visits ? { times: tod, visits: visit, text: [times && cap(times), visits && (times ? visits : cap(visits))].filter(Boolean).join("; ") } : null,
    room: feel.length || liveMusic ? { feel, liveMusic, text: [feel.length ? cap(tagList(feel.map(low))) : null, liveMusic ? "Live music" : null].filter(Boolean).join(". ") } : null,
    pours: pours.length ? { items: pours, text: cap(tagList(pours.map(low))) } : null,
    into: into.length ? { items: into, text: cap(tagList(into.map(low))) } : null,
    music,
    sisters,
    missing: [music.state === "none" ? "music" : null, sisters.state === "none" ? "sisters" : null].filter(Boolean),
  };
  pic.rows = ["who", "ages", "when", "room", "pours", "into", "music", "sisters"]
    .map((k) => {
      const text = pic[k]?.text;
      return text ? { key: k, label: PLACE_LABELS[k], text } : null;
    })
    .filter(Boolean);
  pic.text = pic.rows.map((r) => `${r.label}: ${r.text.replace(/\.$/, "")}.`).join(" ");
  return pic;
}

// A door's music and sister doors fetched in the app (POST /api/place, src/worker.js) put into the city file the
// screens read, so the picture fills in: {sounds: {id: {artists, guard}}, sisters: {id: [[id, score]]}, sisterVenues}.
export function mergePlace(city, got) {
  if (!got) return city;
  const out = { ...(city ?? {}) };
  for (const k of ["sounds", "sisters", "sisterVenues"]) if (got[k]) out[k] = { ...(out[k] ?? {}), ...got[k] };
  return out;
}
