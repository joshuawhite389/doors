// "At the door": three short lines a rep can say, drafted by a model ONLY from the venue's own Qloo descriptions.
// The template (core.templatePitch) is the fallback and the source of truth for which field each line came from.
// No artist names, no brand claims, no time words ("this week", "trending", "rising"), no invented facts.
import { templatePitch, firstSentence, BANNED_PITCH } from "../public/lib/core.js";
import { GEMINI_DEFAULT_MODEL } from "./llm.js";

const BANNED = BANNED_PITCH;

export function pitchSource(v) {
  return {
    id: v.id,
    name: v.name,
    crowd: v.crowd ?? null,
    ambience: v.ambience ?? null,
    good_for: v.goodFor?.length ? v.goodFor.slice(0, 5) : null,
    live_music: v.liveMusic ?? null,
    specialty_dishes: v.dishes?.length ? v.dishes.slice(0, 4) : null,
  };
}

const SYSTEM = `You help a beverage brand's sales rep prepare for walking into bars and restaurants.
For each venue you get ONLY its own descriptions from a data provider. Write exactly three short lines a rep can glance at before walking in:
1. "Crowd": who sits here, from customer_demographics_description (max 18 words).
2. "Room": what the room feels like, from ambience_description (max 18 words).
3. "Angle": one concrete opener grounded in good_for, live_music or specialty_dishes when present, else in the crowd/room text (max 18 words).
Rules: use only facts in the given fields; never invent menus, owners, prices, events or drinks; never mention music artists; never claim the venue stocks, pours or sells any brand; never use the words "trending", "rising" or "this week"; plain, warm, specific English; no exclamation marks.
Return JSON: {"venues":[{"id":"...","crowd":"...","room":"...","angle":"..."}]} with the same ids.`;

// venues: trimmed venue records. Returns {id: {lines:[{label,text,source}], by}}.
export async function draftPitches(venues, { apiKey, model = GEMINI_DEFAULT_MODEL, fetchImpl = globalThis.fetch, timeoutMs = 0 } = {}) {
  const out = {};
  for (const v of venues) out[v.id] = templatePitch(v);
  if (!apiKey || !venues.length) return out;
  const res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: "user", parts: [{ text: JSON.stringify({ venues: venues.map(pitchSource) }) }] }],
      generationConfig: { temperature: 0.3, maxOutputTokens: 8192, responseMimeType: "application/json", thinkingConfig: { thinkingLevel: "minimal" } },
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const body = await res.json();
  const text = body.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Gemini returned non-JSON");
  }
  for (const r of parsed?.venues ?? []) {
    const v = venues.find((x) => x.id === r.id);
    if (!v) continue;
    const lines = acceptLines(v, r);
    if (lines) out[v.id] = { lines, by: "model", model };
  }
  return out;
}

// Keep a model line only if it is short, clean and its source field exists; otherwise the template line stands.
export function acceptLines(v, r) {
  const t = templatePitch(v).lines;
  const pick = (label, text, source, has) => {
    const s = String(text ?? "").trim().replace(/\s+/g, " ");
    if (!has || !s || s.length > 160 || BANNED.test(s) || /!/.test(s)) return t.find((x) => x.label === label) ?? null;
    return { label, text: s, source, original: firstSentence(source === "customer_demographics_description" ? v.crowd : source === "ambience_description" ? v.ambience : null) || null };
  };
  const angleSource = [v.goodFor?.length && "good_for", v.liveMusic && "live_music", v.dishes?.length && "specialty_dishes"].filter(Boolean).join(", ") || "customer_demographics_description, ambience_description";
  const lines = [pick("Crowd", r.crowd, "customer_demographics_description", Boolean(v.crowd)), pick("Room", r.room, "ambience_description", Boolean(v.ambience)), pick("Angle", r.angle, angleSource, Boolean(v.crowd || v.ambience || v.goodFor?.length || v.liveMusic || v.dishes?.length))].filter(Boolean);
  return lines.length ? lines : null;
}
