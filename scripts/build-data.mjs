// Build public/data/** from the raw cache (no Qloo calls). Called by `node scripts/precompute.mjs build`.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { doorParams, proxyBody, sisterParams, soundParams, localitySoundParams, brandArtistParams, venuesFromPage } from "../src/plan.js";
import { assembleRoute, assembleSisters, assembleSounds, soundList } from "../src/assemble.js";
import { overlap, commonArtists, BANNED_PITCH } from "../public/lib/core.js";

export async function buildAll({ readRaw, loadEntities, CONFIG, ROOT, ledgerCount }) {
  const ent = loadEntities();
  const OUT = join(ROOT, "public/data");
  for (const d of ["routes", "cities", "strip", "venues"]) mkdirSync(join(OUT, d), { recursive: true });
  const stamps = [];
  let used = 0;
  const read = (method, path, params) => {
    const r = readRaw(method, path, params);
    if (r?.body) {
      used++;
      stamps.push(r.at);
    }
    return r?.body ?? null;
  };
  const G = (params) => read("GET", "/v2/insights", params);
  const rejected = (params) => Boolean(readRaw("GET", "/v2/insights", params)?.error);
  const pitches = existsSync(join(ROOT, "data/pitches.json")) ? JSON.parse(readFileSync(join(ROOT, "data/pitches.json"), "utf8")) : {};
  const coverage = {};
  const out_common = {};
  const strips = {};
  const index = {
    v: 1,
    captured: null,
    ledger: ledgerCount,
    brands: CONFIG.brands.map((b) => ({ key: b.key, name: b.name, category: b.category, na: Boolean(b.na), id: ent.brands[b.key].chosen.id, qlooName: ent.brands[b.key].chosen.name })),
    cities: CONFIG.cities.map(({ key, name, center, query }) => ({ key, name, center, query })),
    proxySets: CONFIG.proxySets.map((s) => ({ key: s.key, label: s.label, items: s.items.map((p) => ({ key: p.key, name: ent.proxies[p.key].chosen.name, type: p.type, weight: p.weight, id: ent.proxies[p.key].chosen.id })) })),
    rooms: CONFIG.rooms.map((r) => ({ key: r.key, name: r.name, where: r.where, id: ent.rooms[r.key].chosen.id })),
    ages: CONFIG.ages,
    default: { brand: "athletic-brewing", city: "austin", day: "tuesday", daypart: "evening", age: "all" },
    files: [],
    coverage,
  };

  // brand × city routes
  const top20 = {}; // city → brand → ids (for the identical-top-20 check)
  for (const b of CONFIG.brands) {
    for (const c of CONFIG.cities) {
      const before = used;
      const id = ent.brands[b.key].chosen.id;
      const pages = [1, 2, 3].map((p) => G(doorParams({ signalId: id, city: c.query, page: p })));
      const ages = {};
      for (const [ak, a] of Object.entries(CONFIG.ages)) if (!a.naOnly || b.na) ages[ak] = G(doorParams({ signalId: id, city: c.query, page: 1, ageBuckets: a.buckets }));
      const famous = G(doorParams({ signalId: id, city: c.query, page: 1, cap: null }));
      if (!pages[0]) {
        console.log(`  skip ${b.key}-${c.key}: not precomputed`);
        continue;
      }
      const route = assembleRoute({ kind: "brand", drinker: { key: b.key, name: b.name, category: b.category, na: Boolean(b.na), id }, city: { key: c.key, name: c.name, query: c.query, center: c.center }, pages, ages, famous, alcohol: !b.na, captured: null, calls: used - before });
      const name = `${b.key}-${c.key}`;
      writeFileSync(join(OUT, "routes", `${name}.json`), JSON.stringify(route));
      index.files.push(name);
      const n = route.lists.all.length;
      (top20[c.key] ??= {})[b.key] = route.lists.all.slice(0, 20).map((r) => r[0]);
      coverage[name] = { venues: n, flagged: n < 100, reason: n < 100 ? `only ${n} bar and restaurant venues after filtering` : null };
      // strip: the top 50 of the all-ages capped list, with points for the hover re-light
      const top = route.lists.all.slice(0, 50).map((r) => r[0]);
      (strips[c.key] ??= { v: 1, city: c.key, brands: {} }).brands[b.key] = { name: b.name, ids: top, pts: top.map((vid) => [route.venues[vid].lat, route.venues[vid].lon, route.venues[vid].name]) };
    }
  }
  // identical top-20s across brands in one city → flag (the list would not be about the drinker)
  for (const [ck, byBrand] of Object.entries(top20)) {
    const keys = Object.keys(byBrand);
    for (const a of keys)
      for (const b2 of keys) {
        if (a >= b2) continue;
        if (overlap(byBrand[a], byBrand[b2]) >= 18) {
          for (const k of [a, b2]) {
            const cv = coverage[`${k}-${ck}`];
            cv.flagged = true;
            cv.reason = `top 20 nearly identical to another brand's (${overlap(byBrand[a], byBrand[b2])}/20)`;
          }
        }
      }
  }
  // overlap matrix for the territory picker (top 50, all ages, capped)
  for (const [ck, s] of Object.entries(strips)) {
    s.matrix = {};
    for (const a of Object.keys(s.brands)) for (const b2 of Object.keys(s.brands)) if (a < b2) s.matrix[`${a}|${b2}`] = overlap(s.brands[a].ids, s.brands[b2].ids);
    writeFileSync(join(OUT, "strip", `${ck}.json`), JSON.stringify(s));
  }

  // the preset room. The proxy presets (CONFIG.proxySets, v1's "three loves") have no routes since f497d4c: the v2 UI
  // never loads them, so the build doesn't write them either (they stay in index.proxySets as resolved entities).
  for (const set of []) {
    const proxies = set.items.map((p) => ({ id: ent.proxies[p.key].chosen.id, weight: p.weight }));
    for (const c of CONFIG.cities) {
      const before = used;
      const pages = [1, 2, 3].map((p) => read("POST", "/v2/insights", proxyBody({ proxies, city: c.query, page: p })));
      if (!pages[0]) continue;
      const items = set.items.map((p) => ({ key: p.key, name: ent.proxies[p.key].chosen.name, type: p.type, weight: p.weight, id: ent.proxies[p.key].chosen.id }));
      const route = assembleRoute({ kind: "proxy", drinker: { key: set.key, name: set.label, items }, city: { key: c.key, name: c.name, query: c.query, center: c.center }, pages, alcohol: false, calls: used - before });
      writeFileSync(join(OUT, "routes", `${set.key}-${c.key}.json`), JSON.stringify(route));
      index.files.push(`${set.key}-${c.key}`);
    }
  }
  for (const r of CONFIG.rooms) {
    const rid = ent.rooms[r.key].chosen.id;
    for (const c of CONFIG.cities) {
      const before = used;
      const pages = [1, 2, 3].map((p) => G({ ...doorParams({ signalId: rid, city: c.query, page: p }), "filter.exclude.entities": rid }));
      if (!pages[0]) continue;
      const route = assembleRoute({ kind: "room", drinker: { key: r.key, name: r.name, where: r.where, id: rid }, city: { key: c.key, name: c.name, query: c.query, center: c.center }, pages, alcohol: false, calls: used - before });
      writeFileSync(join(OUT, "routes", `${r.key}-${c.key}.json`), JSON.stringify(route));
      index.files.push(`${r.key}-${c.key}`);
    }
  }

  // city files: sister doors, room sounds (guarded), neighbourhood and city sounds, pitches
  const brandArtistLists = CONFIG.brands.map((b) => soundList(G(brandArtistParams({ brandId: ent.brands[b.key].chosen.id })) ?? {}, 30));
  for (const c of CONFIG.cities) {
    const doors = new Map();
    for (const b of CONFIG.brands) {
      const p1 = G(doorParams({ signalId: ent.brands[b.key].chosen.id, city: c.query, page: 1 }));
      if (!p1) continue;
      for (const v of venuesFromPage(p1, { alcohol: !b.na }).venues.slice(0, CONFIG.showcaseTop)) doors.set(v.id, v);
    }
    // doors filled for the click path's routes (data/extra-doors.json, written by `precompute.mjs fill`)
    const extraDoors = existsSync(join(ROOT, "data/extra-doors.json")) ? JSON.parse(readFileSync(join(ROOT, "data/extra-doors.json"), "utf8")) : {};
    for (const v of Object.values(extraDoors[c.key] ?? {})) if (!doors.has(v.id)) doors.set(v.id, v);
    const sisters = {};
    const sisterVenues = {};
    const soundBodies = {};
    for (const [id] of doors) {
      const sb = G(sisterParams({ placeId: id, city: c.query }));
      if (sb) {
        const s = assembleSisters(sb);
        sisters[id] = s.ids;
        Object.assign(sisterVenues, s.records);
      }
      const snd = G(soundParams({ placeId: id }));
      if (snd) soundBodies[id] = snd;
    }
    const citySound = soundList(G(localitySoundParams({ query: c.query, take: 50 })) ?? {}, 50);
    const nbhdSounds = {};
    const counts = {};
    for (const v of doors.values()) if (v.neighborhood) counts[v.neighborhood] = (counts[v.neighborhood] ?? 0) + 1;
    for (const [n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
      const body = G(localitySoundParams({ query: `${n}, ${c.query}` }));
      if (body?.results?.entities?.length) nbhdSounds[n] = soundList(body, 10);
    }
    const noSignal = [...doors.keys()].filter((id) => !soundBodies[id] && rejected(soundParams({ placeId: id })));
    const sounds = assembleSounds({ doors: [...doors.values()], soundBodies, refLists: [citySound, ...Object.values(nbhdSounds), ...brandArtistLists], cityLists: [citySound, ...Object.values(nbhdSounds)], cityName: c.name });
    for (const id of noSignal) sounds[id] = { artists: [], guard: { pass: false, reason: "no-signal", detail: "Qloo returned no artist signal for this venue (the venue is not accepted as an artist signal)" } };
    out_common[c.key] = [...commonArtists(Object.values(sounds).map((x) => x.artists.map((a) => a.id)))];
    const cityPitches = {};
    for (const f of index.files.filter((k) => k.endsWith(`-${c.key}`))) {
      const r = JSON.parse(readFileSync(join(OUT, "routes", `${f}.json`), "utf8"));
      for (const id of Object.keys(r.venues)) {
        if (!pitches[id]) continue;
        // drop any stored line carrying a banned word; the page then uses the clean template line for that label
        const lines = pitches[id].lines.filter((l) => !BANNED_PITCH.test(l.text ?? ""));
        cityPitches[id] = { ...pitches[id], lines };
      }
    }
    const out = { v: 1, city: c.key, name: c.name, commonArtists: out_common[c.key], sisters, sisterVenues, sounds, citySound: citySound.slice(0, 20), nbhdSounds, pitches: cityPitches };
    writeFileSync(join(OUT, "cities", `${c.key}.json`), JSON.stringify(out));
    const pass = Object.values(sounds).filter((s) => s.guard.pass).length;
    const reasons = {};
    for (const s of Object.values(sounds)) if (!s.guard.pass) reasons[s.guard.reason] = (reasons[s.guard.reason] ?? 0) + 1;
    console.log(`  ${c.key}: ${doors.size} doors · sisters ${Object.keys(sisters).length} · sounds ${Object.keys(sounds).length} (pass ${pass}; fail ${JSON.stringify(reasons)}) · neighbourhood sounds ${Object.keys(nbhdSounds).length}`);
  }

  // Calls behind each brand view: its pages + the sister-door and room-sound calls for its showcase doors + the city
  // sound + the brand's artist list (the guard's references).
  for (const b of CONFIG.brands)
    for (const c of CONFIG.cities) {
      const p = join(OUT, "routes", `${b.key}-${c.key}.json`);
      if (!existsSync(p)) continue;
      const r = JSON.parse(readFileSync(p, "utf8"));
      const show = r.lists.all.slice(0, CONFIG.showcaseTop).length;
      r.callsDetail = { pages: r.calls, sistersAndSounds: show * 2, references: 2 };
      r.calls = r.calls + show * 2 + 2;
      writeFileSync(p, JSON.stringify(r));
    }
  const sorted = stamps.filter(Boolean).sort();
  index.captured = sorted.length ? sorted[sorted.length - 1].slice(0, 10) : null;
  index.capturedFrom = sorted[0]?.slice(0, 10) ?? null;
  index.rawResponsesUsed = used;
  writeFileSync(join(OUT, "index.json"), JSON.stringify(index, null, 1));
  writeFileSync(join(OUT, "coverage.json"), JSON.stringify(coverage, null, 1));
  // stamp captured date into routes
  for (const f of index.files) {
    const p = join(OUT, "routes", `${f}.json`);
    const r = JSON.parse(readFileSync(p, "utf8"));
    r.captured = index.captured;
    writeFileSync(p, JSON.stringify(r));
  }
  console.log(`build: ${index.files.length} route files · captured ${index.captured} · ${used} cached responses read · flagged ${Object.entries(coverage).filter(([, v]) => v.flagged).map(([k, v]) => `${k} (${v.reason})`).join("; ") || "none"}`);
}
