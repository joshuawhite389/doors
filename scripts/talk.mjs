// Draft the opener's first sentence (SPEC-V2 §7, line 2) with Gemini, offline, for the top 30 doors of every
// precomputed drinker × city. No Qloo calls: only Qloo's profile of each room (its crowd text) from public/data/routes.
//   node scripts/talk.mjs [--top=30] [--batch=15] [--limit=N] [--write-only]
// Resumable: every answer is cached in data/talk.json by venue id (the accepted lead, or the rejected text with the
// guard's reason), so a re-run only drafts what is missing; a quota error (429) stops the run and keeps what it has.
// Then the accepted leads are written under the `talk` key of public/data/cities/<city>.json. Every lead passes
// public/lib/talk-model.js guardTalkLine (spoken "Looks like …", short, banned words, no source claimed, its source
// field on the record); a lead that fails is not stored and the template opener stands.
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { guardTalkLine, normalizeLead } from "../public/lib/talk-model.js";
import { cityArtists } from "../public/lib/stopmodel.js";
import { GEMINI_DEFAULT_MODEL } from "../src/llm.js";

const ROOT = new URL("..", import.meta.url).pathname;
const arg = (n, d) => Number(process.argv.find((a) => a.startsWith(`--${n}=`))?.split("=")[1] ?? d);
const TOP = arg("top", 30), BATCH = arg("batch", 15), LIMIT = arg("limit", Infinity);
const WRITE_ONLY = process.argv.includes("--write-only");
const MODEL = process.env.GEMINI_MODEL ?? GEMINI_DEFAULT_MODEL;
const read = (rel) => JSON.parse(readFileSync(join(ROOT, rel), "utf8"));
const cacheFile = join(ROOT, "data/talk.json");
const cache = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, "utf8")) : {};
const index = read("public/data/index.json");
const brandNames = index.brands.flatMap((b) => [b.name, b.qlooName]).filter(Boolean);

// venue id → {venue, city}; the top TOP of each drinker list in each city
const want = new Map();
const cities = {};
for (const f of readdirSync(join(ROOT, "public/data/routes")).sort()) {
  const r = read(`public/data/routes/${f}`);
  const ck = r.city?.key;
  cities[ck] ??= read(`public/data/cities/${ck}.json`);
  for (const [id] of (r.lists?.all ?? []).slice(0, TOP)) if (r.venues[id] && !want.has(id)) want.set(id, { venue: r.venues[id], city: ck });
}

export const SYSTEM = `You help a drinks brand's sales rep open a conversation at a bar or restaurant.
For each venue you get ONLY the data provider's profile of the room. Write "lead": ONE short sentence the rep says out loud to the manager about who comes in, from customer_demographics_description only.
It must start with "Looks like" and name at most two groups of people, e.g. "Looks like you get a lot of grad students and young couples in here." or "Looks like your regulars are mostly neighbourhood families."
Max 16 words, at most one comma. Plain spoken English, warm, not a description.
Rules: never mention where the information came from (no "listing", "profile", "data", "Qloo"); never invent facts, numbers or drinks; never mention music artists or any brand; never claim the venue stocks, pours, carries or sells anything; never use the words "trending", "rising" or "this week"; never speak for the brand (no "we", "our", "us"); no questions, no exclamation marks.
If customer_demographics_description is missing, return an empty string.
Return JSON: {"venues":[{"id":"...","lead":"..."}]} with the same ids.`;

const source = (v) => ({
  id: v.id,
  name: v.name,
  customer_demographics_description: v.crowd ?? null,
});

class Quota extends Error {}
async function draft(batch, apiKey) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: "POST",
    signal: AbortSignal.timeout(60000),
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: "user", parts: [{ text: JSON.stringify({ venues: batch.map((x) => source(x.venue)) }) }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 8192, responseMimeType: "application/json", thinkingConfig: { thinkingLevel: "minimal" } },
    }),
  });
  if (res.status === 429) throw new Quota(`Gemini 429: ${(await res.text()).slice(0, 200)}`);
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const body = await res.json();
  const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  return JSON.parse(text).venues ?? [];
}

// One model answer for a venue → the cache entry: the accepted lead, or the reason it was rejected.
export function judge(v, r, avoid) {
  const out = { model: MODEL, drafted: new Date().toISOString().slice(0, 10), v: 2, rejected: {} };
  const text = normalizeLead(r?.lead, v);
  const source = "customer_demographics_description";
  if (!text) out.rejected.lead = "empty";
  else {
    const g = guardTalkLine(text, { venue: v, source, avoid });
    if (g.ok) out.lead = { text, source };
    else (out.rejected.lead = g.reason), (out.text = text);
  }
  return out;
}

async function main() {
  const todo = [...want.entries()].filter(([id]) => cache[id]?.v !== 2).slice(0, LIMIT).map(([id, x]) => ({ id, ...x }));
  console.log(`${want.size} doors (top ${TOP} × ${Object.keys(cities).length} cities × drinkers) · ${Object.keys(cache).length} cached · drafting ${WRITE_ONLY ? 0 : todo.length}`);
  if (!WRITE_ONLY && todo.length) {
    const apiKey = process.env.GEMINI_API_KEY ?? readFileSync(join(homedir(), ".config/gigbot/gemini-key"), "utf8").trim();
    let stop = false;
    for (let i = 0; i < todo.length && !stop; i += BATCH) {
      const batch = todo.slice(i, i + BATCH);
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const rows = await draft(batch, apiKey);
          for (const x of batch) {
            const r = rows.find((y) => y.id === x.id);
            if (!r) continue; // missing from the answer: drafted again on the next run
            cache[x.id] = judge(x.venue, r, [...cityArtists(cities[x.city]), ...brandNames]);
          }
          break;
        } catch (e) {
          if (e instanceof Quota) { console.log(`  quota: ${e.message.slice(0, 120)} · stopping, the rest stays on the template`); stop = true; break; }
          console.log(`  batch ${i / BATCH}: ${e.message.slice(0, 160)}`);
          if (attempt < 2) await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
        }
      }
      writeFileSync(cacheFile, JSON.stringify(cache));
      console.log(`  ${Math.min(i + BATCH, todo.length)}/${todo.length}`);
      if (!stop) await new Promise((r) => setTimeout(r, 4200)); // free tier: under 15 requests a minute
    }
  }

  // write the accepted lines into each city file, under `talk`
  const counts = { doors: want.size, answered: 0, lead: 0, template: 0, rejected: {} };
  for (const [ck, c] of Object.entries(cities)) {
    const venues = {};
    for (const [id, x] of want) {
      if (x.city !== ck) continue;
      let e = cache[id];
      if (e?.v !== 2) { counts.template++; continue; }
      // re-judge every stored lead against today's guard, after the deterministic fix (R2 M3: no quantifier the
      // profile lacks): a re-run never needs the model for a guard change
      if (e.lead || e.text) e = cache[id] = { ...judge(x.venue, { lead: e.lead?.text ?? e.text }, [...cityArtists(c), ...brandNames]), model: e.model, drafted: e.drafted };
      counts.answered++;
      for (const [k, why] of Object.entries(e.rejected ?? {})) counts.rejected[`${k}: ${why}`] = (counts.rejected[`${k}: ${why}`] ?? 0) + 1;
      if (!e.lead) { counts.template++; continue; }
      venues[id] = { lead: e.lead, model: e.model };
      counts.lead++;
    }
    c.talk = { v: 1, model: MODEL, top: TOP, note: "Opener leads model-drafted from Qloo's profile of each room (crowd text) by scripts/talk.mjs; every lead passed guardTalkLine.", venues };
    writeFileSync(join(ROOT, `public/data/cities/${ck}.json`), JSON.stringify(c));
  }
  writeFileSync(cacheFile, JSON.stringify(cache));
  console.log(JSON.stringify(counts, null, 1));
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
