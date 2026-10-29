// Round 3 enrich lane: how a screen gets a door's enrichment record (public/lib/enrich.js) in the browser.
//   loadEnrich(cityKey)                          the city's baked file (public/data/enrich/<city>.json), once per page
//   enrichFor({venue, cityKey, city, cityName})  the record for one door: the baked one when the city holds it, else
//                                                this device's copy (localStorage), else POST /api/enrich (src/worker.js)
//                                                and keep the answer on the device. Never throws: null when nothing
//                                                came back (the screen says so; no filler).
// Pure of the DOM; fetch and localStorage only (both injectable for tests).
const mem = new Map();
const KEY = "doors.v2.enrich";
const readDevice = (storage) => {
  try {
    return JSON.parse(storage?.getItem(KEY) ?? "{}") ?? {};
  } catch {
    return {};
  }
};
const writeDevice = (storage, all) => {
  try {
    storage?.setItem(KEY, JSON.stringify(all));
  } catch {}
};
export function _resetEnrichClient() {
  mem.clear();
}

export function loadEnrich(cityKey, { fetchImpl = globalThis.fetch } = {}) {
  if (!cityKey) return Promise.resolve(null);
  const url = `/data/enrich/${cityKey}.json`;
  if (!mem.has(url)) mem.set(url, fetchImpl(url).then((r) => (r.ok ? r.json() : null)).catch(() => null));
  return mem.get(url);
}

// → {record, from: "baked"|"device"|"live"|"none", calls?, error?}
export async function enrichFor({ venue, cityKey = null, city = null, cityName = null, want = ["qloo", "site"], fetchImpl = globalThis.fetch, storage = globalThis.localStorage ?? null, live = true } = {}) {
  const id = String(venue?.id ?? "");
  if (!id) return { record: null, from: "none" };
  const baked = cityKey ? await loadEnrich(cityKey, { fetchImpl }) : null;
  if (baked?.doors?.[id]) return { record: baked.doors[id], from: "baked" };
  const dev = readDevice(storage);
  if (dev[id]?.door) return { record: dev[id].door, from: "device" };
  if (!live || !city) return { record: null, from: "none" };
  let res;
  try {
    res = await fetchImpl("/api/enrich", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, city, cityName, name: venue.name ?? "", lat: venue.lat ?? null, lon: venue.lon ?? null, website: venue.website ?? null, menu: venue.menu ?? null, want }) });
  } catch {
    return { record: null, from: "none", error: "Doors didn't answer. Check you're online, then try again." };
  }
  const b = await res.json().catch(() => ({}));
  if (!res.ok || !b.door) return { record: null, from: "none", error: b.error ?? `Qloo didn't answer (${res.status}). Try again in a minute.` };
  dev[id] = { door: b.door, at: b.door.at };
  // the device keeps the newest 60 records
  const ids = Object.keys(dev);
  if (ids.length > 60) for (const k of ids.sort((a, c) => String(dev[a].at).localeCompare(String(dev[c].at))).slice(0, ids.length - 60)) delete dev[k];
  writeDevice(storage, dev);
  return { record: b.door, from: "live", calls: b.calls ?? 0 };
}
