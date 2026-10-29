// WHY-VIZ-SPEC §4.5 (Jard 10-25): "Doors that share a crowd", the thread panel and the Doors Agent's "why aren't these
// on my plan". A graph: one node per plan door plus every sister door Qloo lists for it (cities/<city>.json `sisters`,
// Qloo's place-to-place affinity on the link); an edge per sister link. Click a door: its thread (every door that
// shares its crowd), each with its status, the planner's own reason it is off the plan, and the one fix from the
// table below that would change it. Pure: no DOM, no fetch. ui/whyviz/thread.js draws it; the rules-path answer
// (threadAnswer) is what the Doors Agent says when no model is available, built from reason codes only.
import { placeFate, whereOn } from "../sieve.js";
import { roomOf, ROOMS } from "../profile.js";
import { genreLabel, parseHours, DAYS, popWords } from "../core.js";

export const SISTERS_PER_DOOR = 8;
export const MAX_NODES = 120;
export const THREAD_TITLE = "Doors that share a crowd";
export const ASK_LABEL = "Ask the Doors Agent why these aren't on my plan";
export const ASK_QUESTION = "Why aren't these on my plan?";

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : "");
const lower = (t) => (t && !/^[A-Z][A-Z']|^Qloo|^You\b|^[A-Z][a-z]+day\b/.test(t) ? t[0].toLowerCase() + t.slice(1) : t);
const and = (xs) => (xs.length <= 1 ? xs[0] ?? "" : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const ROOM_LABEL = Object.fromEntries(ROOMS.map((r) => [r.key, r.label]));
const ROOM_PHRASE = Object.fromEntries(ROOMS.map((r) => [r.key, r.phrase]));

// ---------- the fix table (spec §4.5): the only fixes the agent may offer, keyed by the planner's reason code ----------
// Each fix: {key, text(ctx), act} where act is the existing change the button performs (ui/why.js runs it):
//   days    → Edit profile (days and times)       famous → Try a change "Include the big names"
//   lock    → lock the door to the day the planner named (S.moveStop, index null)
//   rooms   → Try a change: add that door type     add → the add-door preview (whatif kind add)
export const FIX_ROWS = [
  { key: "closed", codes: ["closed", "hours", "closes-before", "brief", "idle-hours", "hours-clash"], act: "days", text: ({ open }) => `Add a day it's open and Doors will place it${open?.length ? ` (open ${and(open)})` : ""}.` },
  { key: "opens-after", codes: ["opens-after"], act: "days", text: () => "Extend that day into the evening and it fits." },
  { key: "full", codes: ["full", "cap", "lower"], act: "days", text: () => "Raise that day's cap or add a day." },
  { key: "route", codes: ["nearer", "better", "kept", "detour", "far", "idle", "route"], act: "lock", text: ({ day }) => `Lock it to ${day ?? "that day"} and Doors re-routes the rest around it.` },
  { key: "status", codes: ["status", "visited", "talked", "notfit", "removed", "marked"], act: null, text: () => "" },
  { key: "famous", codes: ["famous"], act: "famous", text: () => "Include the most popular doors to put it on, or come back once you have reorders." },
  { key: "type", codes: ROOMS.map((r) => r.key), act: "rooms", text: ({ type }) => `Add ${ROOM_PHRASE[type] ?? type} to the door types you pitch.` },
  { key: "byname", codes: ["nowhere", "soft-only", "no-taps", "unranked", "kind"], act: "add", text: () => "Add it by name with + Add a door." },
];
export const FIX_TEXTS = FIX_ROWS.map((r) => r.key); // the keys a test can check an answer's fixes against
export function fixFor(code, ctx = {}) {
  const row = FIX_ROWS.find((r) => r.codes.includes(code)) ?? FIX_ROWS.find((r) => r.key === "byname");
  return { key: row.key, act: row.act, text: row.text(ctx) };
}
// A door's open weekdays from its Qloo hours ("Monday", …), [] when unknown.
export function openDays(hours) {
  const p = parseHours(hours);
  if (!p.ok) return [];
  return DAYS.filter((d) => p.days[d] && !p.days[d].closed && p.days[d].spans.length).map(cap);
}

// ---------- the model ----------
// sv: lib/sieve.js sieve(); plan: the plan view's plan; city: cities/<city>.json; route: the merged drinker route;
// profile; famous: the big names are switched in; prev: the last layout (Map id → {x, y}) so nodes don't jump.
// → {nodes:[{id, name, kind, rank, day, stop, code, reason, pop, genre, type, lat, lon, mates:[id], onPlanN, venue}],
//    edges:[{a, b, score, planPlan}], layout: Map id → {x, y} (0..1), threads, sel (the default selection), byId}
export function threadModel({ sv, plan, city = null, route = null, profile = {}, famous = false, prev = null }) {
  const venues = { ...(route?.venues ?? {}), ...(plan?.venues ?? {}) };
  const sisterVenues = city?.sisterVenues ?? {};
  const venueOf = (id) => plan?.venues?.[id] ?? route?.venues?.[id] ?? sisterVenues[id] ?? null;
  const where = whereOn(plan);
  const dotOf = new Map((sv?.dots ?? []).map((d) => [d.id, d]));
  const poolRank = (id) => (plan?.pool?.ids ?? []).indexOf(id) + 1 || null;
  const nodes = new Map();
  const planIds = [...(sv?.dots ?? []).filter((d) => d.fate === "plan"), ...(sv?.extras ?? [])].map((d) => d.id).filter((id) => where.has(id));
  const node = (id) => {
    if (nodes.has(id)) return nodes.get(id);
    const v = venueOf(id);
    if (!v?.name) return null;
    const on = where.get(id);
    const d = dotOf.get(id);
    const f = on ? { fate: "plan", code: `day${on.di}`, reason: `${cap(on.day)}, stop ${on.n} of ${on.total}`, day: on.di } : d ? { fate: d.fate, code: d.code, reason: d.reason, day: d.day } : null;
    const type = roomOf(v);
    const genre = cap(genreLabel(v));
    let kind;
    if (on) kind = "plan";
    else if (f?.fate === "famous") kind = "big";
    else if (f?.fate === "room") kind = "room";
    else if (f && poolRank(id)) kind = "list";
    else if (f) kind = "room"; // ranked, off Your list for a reason the pool knows (closed, no location)
    else kind = "other"; // Qloo matches its crowd to a plan door's, but doesn't rank it for this drinker
    const code = f?.code ?? "unranked";
    const reasonDate = plan?.reasons?.[id]?.date ?? null;
    const n = {
      id, name: v.name, kind, rank: poolRank(id), day: on ? on.di : null, stop: on ? on.n : null, dayName: on ? cap(on.day) : null,
      code, fate: f?.fate ?? null, reason: f?.reason ?? null, reasonDay: reasonDate ? cap(plan.days.find((x) => x.date === reasonDate)?.day ?? "") || null : null, reasonDate,
      pop: Number.isFinite(v.popularity) ? v.popularity : null, genre, type, pitched: (profile?.rooms ?? []).includes(type),
      lat: Number.isFinite(+v.lat) ? +v.lat : null, lon: Number.isFinite(+v.lon) ? +v.lon : null, hours: v.hours ?? null, status: plan?.statuses?.[id] ?? null,
      mates: [], onPlanN: 0, venue: { ...v, id },
    };
    nodes.set(id, n);
    return n;
  };
  for (const id of planIds) node(id);
  const edges = [];
  const seen = new Set();
  for (const id of planIds) {
    for (const r of (city?.sisters?.[id] ?? []).slice(0, SISTERS_PER_DOOR)) {
      const [sid, score] = Array.isArray(r) ? r : [r, null];
      if (sid === id) continue;
      const key = [id, sid].sort().join("|");
      if (seen.has(key)) continue;
      const s = node(sid);
      if (!s) continue;
      seen.add(key);
      edges.push({ a: id, b: sid, score: typeof score === "number" ? score : null });
    }
  }
  // ≤ MAX_NODES: drop the weakest unranked sisters first, then the weakest of the rest (never a plan door)
  if (nodes.size > MAX_NODES) {
    const strength = new Map();
    for (const e of edges) for (const x of [e.a, e.b]) strength.set(x, Math.max(strength.get(x) ?? 0, e.score ?? 0));
    const order = [...nodes.values()].filter((n) => n.kind !== "plan").sort((p, q) => (p.kind === "other") - (q.kind === "other") || (strength.get(q.id) ?? 0) - (strength.get(p.id) ?? 0));
    for (const n of order.slice(MAX_NODES - planIds.length)) nodes.delete(n.id);
  }
  const live = edges.filter((e) => nodes.has(e.a) && nodes.has(e.b)).map((e) => ({ ...e, planPlan: nodes.get(e.a).kind === "plan" && nodes.get(e.b).kind === "plan" }));
  for (const e of live) {
    nodes.get(e.a).mates.push(e.b);
    nodes.get(e.b).mates.push(e.a);
  }
  for (const n of nodes.values()) n.onPlanN = n.mates.filter((m) => nodes.get(m).kind === "plan").length;
  const list = [...nodes.values()];
  // threads: connected groups that hold at least one plan door
  const parent = new Map(list.map((n) => [n.id, n.id]));
  const find = (a) => (parent.get(a) === a ? a : (parent.set(a, find(parent.get(a))), parent.get(a)));
  for (const e of live) parent.set(find(e.a), find(e.b));
  const threads = new Set(list.filter((n) => n.kind === "plan").map((n) => find(n.id))).size;
  const sel = planIds.map((id) => nodes.get(id)).filter(Boolean).sort((p, q) => (p.rank ?? 1e9) - (q.rank ?? 1e9))[0]?.id ?? null;
  return { nodes: list, edges: live, layout: layoutOf(list, live, prev), threads, sel, byId: nodes, planN: planIds.length };
}

// A deterministic force layout (no random numbers: the same graph draws the same way every time). prev seeds the
// nodes it knows so a re-plan that adds or drops a door moves only what changed. → Map id → {x, y} in 0..1.
export function layoutOf(nodes, edges, prev = null, { iterations = prev ? 200 : 400, heat = prev ? 2.5 : 12 } = {}) {
  const n = nodes.length;
  const out = new Map();
  if (!n) return out;
  const idx = new Map(nodes.map((d, i) => [d.id, i]));
  const px = new Float64Array(n), py = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const p = prev?.get(nodes[i].id);
    if (p) { px[i] = (p.x - 0.5) * 400; py[i] = (p.y - 0.5) * 300; continue; }
    const a = (i / n) * Math.PI * 2 * 7.3, rr = nodes[i].kind === "plan" ? 60 : 160;
    px[i] = Math.cos(a) * rr; py[i] = Math.sin(a) * rr;
  }
  const E = edges.map((e) => [idx.get(e.a), idx.get(e.b)]);
  const isPlan = nodes.map((d) => d.kind === "plan");
  let T = heat; // a seeded layout starts cool: what was placed stays near where it was
  for (let it = 0; it < iterations; it++) {
    const fx = new Float64Array(n), fy = new Float64Array(n);
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      const dx = px[i] - px[j], dy = py[i] - py[j];
      const d2 = dx * dx + dy * dy + 0.01, d = Math.sqrt(d2);
      const k = (isPlan[i] && isPlan[j] ? 4200 : 1500) / d2;
      fx[i] += (dx / d) * k; fy[i] += (dy / d) * k; fx[j] -= (dx / d) * k; fy[j] -= (dy / d) * k;
    }
    for (const [a, b] of E) {
      const dx = px[b] - px[a], dy = py[b] - py[a];
      const d = Math.sqrt(dx * dx + dy * dy) + 0.01, L = isPlan[a] && isPlan[b] ? 95 : 60, k = (d - L) * 0.06;
      fx[a] += (dx / d) * k; fy[a] += (dy / d) * k; fx[b] -= (dx / d) * k; fy[b] -= (dy / d) * k;
    }
    for (let i = 0; i < n; i++) {
      fx[i] -= px[i] * 0.012; fy[i] -= py[i] * 0.016;
      const f = Math.sqrt(fx[i] * fx[i] + fy[i] * fy[i]) || 1, s = Math.min(f, T) / f;
      px[i] += fx[i] * s; py[i] += fy[i] * s;
    }
    T = Math.max(0.6, T * 0.992);
  }
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) { minX = Math.min(minX, px[i]); maxX = Math.max(maxX, px[i]); minY = Math.min(minY, py[i]); maxY = Math.max(maxY, py[i]); }
  const sx = maxX - minX || 1, sy = maxY - minY || 1;
  for (let i = 0; i < n; i++) out.set(nodes[i].id, { x: n === 1 ? 0.5 : (px[i] - minX) / sx, y: n === 1 ? 0.5 : (py[i] - minY) / sy });
  return out;
}

// ---------- one door's status in a thread (the panel's row, the tooltip, the agent's reason + fix) ----------
// → {k, word (the status line), reason (why it is off the plan, a sentence), fix: {key, act, text} | null}
export function sisterStatus(n, { cityName = "the city", added = [] } = {}) {
  if (!n) return null;
  if (added.includes(n.id)) return { k: "added", word: "Added to your plan", reason: "", fix: null };
  if (n.kind === "plan") return { k: "plan", word: `On your plan · ${n.dayName}, stop ${n.stop}`, reason: "", fix: null };
  const rk = n.rank ? `#${n.rank} on Your list` : null;
  if (n.kind === "big") {
    const why = `One of ${cityName}'s most popular doors.`; // round 3: no "Popularity 0.99" (decimals, Jard 10-23)
    return { k: "big", word: "Most popular, left for later", reason: why, fix: fixFor("famous") };
  }
  if (n.kind === "list") {
    const why = n.reason ? `${cap(n.reason).replace(/\.$/, "")}.` : "It didn't fit a day.";
    if (n.fate === "known") return { k: "known", word: `${rk} · you marked it`, reason: why, fix: fixFor("status") };
    if (n.fate === "open") {
      const short = n.code === "opens-after" ? "opens after your window" : n.code === "closes-before" ? "closes before your window" : "closed when you're out";
      return { k: "closed", word: `${rk} · ${short}`, reason: why, fix: fixFor(n.code, { open: openDays(n.hours) }) };
    }
    const short = ["full", "cap", "lower"].includes(n.code) ? "no time left" : "didn't fit a day's route";
    return { k: "route", word: `${rk} · ${short}`, reason: why, fix: fixFor(n.code, { day: n.reasonDay }) };
  }
  if (n.kind === "room") {
    const a = /^[aeiou]/i.test(n.genre) ? "an" : "a";
    if (n.type && !n.pitched && ROOM_LABEL[n.type]) return { k: "room", word: `Ranked · ${a} ${n.genre.toLowerCase()}, a type you don't pitch`, reason: `Qloo lists it as ${a} ${n.genre.toLowerCase()}, and you don't pitch ${ROOM_PHRASE[n.type]}.`, fix: fixFor(n.type, { type: n.type }) };
    return { k: "room", word: `Ranked · ${lower(n.reason ?? "left off")}`, reason: `${cap(n.reason ?? "Left off")}.`, fix: fixFor(n.code) };
  }
  const a = /^[aeiou]/i.test(n.genre) ? "an" : "a";
  return { k: "other", word: `Not on your drinker's list · ${n.genre ? `${a} ${n.genre.toLowerCase()}` : "a place Qloo matched"}`, reason: "Qloo matches its crowd to this door's, but doesn't rank it for your drinker.", fix: fixFor("unranked") };
}

// The thread of one door: its mates, doors not on the plan first, best rank first. → [{n, st}]
export function threadOf(model, id, opts = {}) {
  const sel = model.byId.get(id);
  if (!sel) return [];
  const rows = sel.mates.map((m) => model.byId.get(m)).filter(Boolean).map((n) => ({ n, st: sisterStatus(n, opts) }));
  const order = (r) => (r.st.k === "plan" ? 2 : r.st.k === "added" ? 1 : 0);
  return rows.sort((p, q) => order(p) - order(q) || (p.n.rank ?? 1e9) - (q.n.rank ?? 1e9) || (p.n.kind === "big") - (q.n.kind === "big") || p.n.name.localeCompare(q.n.name));
}

// The sentence above the graph is lib/whyviz/words.js threadWords(model, id) (one file for every picture's words).

// ---------- the Doors Agent's ask (spec §4.5): the context it reads and the rules-path answer ----------
// The context: the selected door and, for each connected door not on the plan, what the agent needs to say why and
// what would change it. Nothing here is written by a model. (lib/agent-context.js carries it to the Worker.)
export function threadAsk(model, id = model.sel, { cityName = "the city", added = [] } = {}) {
  const sel = model.byId.get(id);
  if (!sel) return null;
  const rows = threadOf(model, id, { cityName, added });
  const off = rows.filter((r) => r.st.k !== "plan" && r.st.k !== "added");
  return {
    question: ASK_QUESTION,
    selected: { id: sel.id, name: sel.name },
    doors: off.map(({ n, st }) => ({ id: n.id, name: n.name, rank: n.rank, fate: n.fate, code: n.code, why: n.reason, big: n.kind === "big", popularity: n.pop, genre: n.genre, type: n.type, pitched: n.pitched, open: openDays(n.hours), status: st.word, reason: st.reason, fix: st.fix })),
    onPlan: rows.filter((r) => r.st.k === "plan" || r.st.k === "added").map((r) => ({ id: r.n.id, name: r.n.name })),
  };
}
// The answer when no model is available, in the shape the spec fixes: per door the reason and the fix that would
// change it, then a pick. → {text (plain), lines:[{id, name, head, reason, fix}], pick: {id, name, text} | null, by: "rules"}
export function threadAnswer(model, id = model.sel, { cityName = "the city", added = [] } = {}) {
  const ask = threadAsk(model, id, { cityName, added });
  if (!ask) return null;
  const sel = ask.selected, N = ask.doors.length + ask.onPlan.length;
  if (!ask.doors.length) return { text: `Every door that shares ${sel.name}'s crowd is already on your plan. Nothing to fix here.`, lines: [], pick: null, by: "rules" };
  const lines = ask.doors.map((d) => ({ id: d.id, name: d.name, head: `${d.name}${d.rank ? ` (#${d.rank} on Your list)` : ""}`, reason: d.reason, fix: d.fix?.text ? d.fix : null }));
  const cand = ask.doors.filter((d) => d.rank && d.fix?.act).sort((p, q) => p.rank - q.rank)[0];
  const pick = cand
    ? { id: cand.id, name: cand.name, text: `My pick: ${cand.name} first. #${cand.rank} for your drinker${popWords(cand.popularity) ? `, ${popWords(cand.popularity)}` : ""}, the same crowd as ${sel.name}. ${cand.fix.text}` }
    : { id: null, name: null, text: `None of these is on Your list today, so none fits a day without a change to your settings. The quickest: ${ask.doors.some((d) => d.big) ? "include the most popular doors" : ask.doors.some((d) => d.type && !d.pitched) ? "add their door type to the types you pitch" : "add the one you want by name"}.` };
  const head = `${ask.doors.length} of the ${plural(N, "door")} that share ${sel.name}'s crowd ${ask.doors.length === 1 ? "isn't" : "aren't"} on your plan. ${ask.doors.length === 1 ? "Its reason" : "Each one's reason"}, and what would change it:`;
  const text = [head, ...lines.map((l) => `- ${l.head}: ${l.reason}${l.fix ? ` ${l.fix.text}` : " No fix: that one is your call."}`), pick.text].join("\n");
  return { text, head, lines, pick, by: "rules" };
}
