// SAMPLE mode: answer Qloo requests from real, trimmed Boise responses (src/sample-data.js). No key, no network.
import { SAMPLE } from "./sample-data.js";

export function sampleFetch() {
  let n = 0;
  return async (url, init = {}) => {
    const u = new URL(url);
    const params = init.method === "POST" ? JSON.parse(init.body) : Object.fromEntries(u.searchParams);
    let body;
    if (u.pathname === "/search") {
      const q = String(params.query ?? "").toLowerCase();
      if (String(params.types ?? "") === "urn:entity:place") {
        // place search (Add a door): the sample's Boise places whose name has the first word
        const places = SAMPLE.page.results.entities;
        body = { results: places.filter((e) => e.name.toLowerCase().includes(q.split(" ")[0])).slice(0, Number(params.take ?? 10)) };
      } else {
        const rows = SAMPLE.search.filter((r) => r.name.toLowerCase().includes(q.split(" ")[0]));
        body = { results: rows.length ? rows : SAMPLE.search.slice(0, 3) };
      }
    } else {
      const type = params["filter.type"];
      const page = Number(params.page ?? 1);
      if (type === "urn:entity:place") body = params["filter.exclude.entities"] && !params.page ? SAMPLE.sisters : page === 1 ? SAMPLE.page : { results: { entities: [] } };
      else if (type === "urn:entity:artist") body = params["signal.location.query"] ? SAMPLE.city : SAMPLE.sounds[n++ % SAMPLE.sounds.length];
      else body = { results: { entities: SAMPLE.sounds[0].results.entities.slice(0, 5).map((e) => ({ name: e.name, entity_id: e.entity_id })) } };
    }
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", "x-month-ratelimit-remaining": "9999" } });
  };
}
