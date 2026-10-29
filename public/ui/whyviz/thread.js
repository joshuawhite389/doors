// WHY-VIZ-SPEC §4.5: picture 5, "Doors that share a crowd", drawn as SVG from lib/whyviz/thread.js, with the thread
// panel under it (the drawer is 640 px wide: the panel stacks under the graph on every width) and the Doors Agent's
// answer. The drawer (ui/why.js) owns the state and the clicks (data-th-* attributes bubble to it); this module only
// draws: mountThread(host, opts) fills the host and keeps the SVG when the model hasn't changed, so a click selects
// in place and nothing jumps. Shared pieces from ui/viz-dom.js: the one tooltip (hover + focus), the sentence, the
// table twin, the colours. Every mark is a Doors count or a Qloo field; hover never gates (the twin lists every node).
import { esc } from "../dom.js";
import { COLOURS, attachTip, stripHTML, sayHTML, tableTwinHTML, sourceHTML, reduced } from "../viz-dom.js";
import { threadOf, threadAnswer, ASK_LABEL, THREAD_TITLE, SISTERS_PER_DOOR } from "../../lib/whyviz/thread.js";
import { threadWords } from "../../lib/whyviz/words.js";

const CSS_HREF = "/css/whyviz.css"; // not CSS: that is the page's CSS.escape
if (typeof document !== "undefined" && !document.querySelector(`link[href="${CSS_HREF}"]`)) {
  const l = document.createElement("link");
  l.rel = "stylesheet";
  l.href = CSS_HREF;
  document.head.append(l);
}

export { THREAD_TITLE };
const W = 600, H = 440, PAD = 34;
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const rOf = (n) => (n.kind === "plan" ? 8 : n.kind === "big" ? 6 : n.kind === "list" ? 5.5 : 3.2);
const fillOf = (n, added) => (n.kind === "plan" || added ? COLOURS.plan : n.kind === "big" ? COLOURS.big : n.kind === "list" ? COLOURS.paper : COLOURS.grey);
const strokeOf = (n, added) => (n.kind === "list" && !added ? COLOURS.plan : COLOURS.paper);
const dotOf = (st) => (st.k === "plan" || st.k === "added" ? COLOURS.plan : st.k === "big" ? COLOURS.big : st.k === "room" || st.k === "other" ? COLOURS.grey : COLOURS.paper);
const kindWord = (n, added) => (added ? "added to your plan" : n.kind === "plan" ? "on your plan" : n.kind === "big" ? "most popular, left for later" : n.kind === "list" ? `#${n.rank} on Your list` : n.kind === "room" ? "ranked, not a door type you pitch" : "not on your drinker's list");
const ROOM_PHRASE = { bars: "bars", breweries: "breweries", restaurants: "restaurants", cafes: "cafés", wine: "wine bars" };
// the model path's reply in the rules answer's shape (the fix comes from the reply, else the rules' for that door)
function fromReply(w, rules) {
  const byId = new Map(rules.lines.map((l) => [l.id, l]));
  const lines = (w.doors ?? []).map((d) => ({ id: d.id, name: d.name, head: `${d.name}${d.rank ? ` (#${d.rank} on Your list)` : ""}`, reason: String(d.reason ?? d.status ?? ""), fix: d.fix?.text ? d.fix : byId.get(d.id)?.fix ?? null }));
  const pick = w.pick?.text ? { id: w.pick.id ?? null, name: w.pick.name ?? null, text: w.pick.text } : rules.pick;
  const head = w.head ?? rules.head;
  return { head, lines: lines.length ? lines : rules.lines, pick, text: w.text ?? rules.text, by: "model" };
}

// opts: {model (with .key), sel, added: [ids], days: {id: "Wednesday"} (where the preview lands each added door),
//        cityName, canAdd, editTo, asked (the agent card is open), answer ({text, model} from the model path, else the
//        rules path draws), pv (the preview block's HTML), openAgent (offer "Ask it in Doors Agent"), onSelect(id)}
export function mountThread(host, opts) {
  const { model } = opts;
  if (!host || !model) return;
  const sel = model.byId.has(opts.sel) ? opts.sel : model.sel;
  host.classList.add("wv-th");
  if (host.dataset.for !== String(model.key)) {
    host.innerHTML = `<h4 class="wv-h">${esc(THREAD_TITLE)}</h4><div class="wv-th-say"></div><div class="wv-th-fig"></div>${stripHTML("Hover or tap a door: how many doors share its crowd. Click to open its thread.")}<div class="wv-th-panel"></div><div class="wv-th-twin"></div>${sourceHTML(`Qloo's place-to-place affinity (the doors whose regulars match each plan door's, its first ${SISTERS_PER_DOOR}), the planner's own reasons, and Doors' counts over your plan.`)}`;
    drawGraph(host.querySelector(".wv-th-fig"), model, opts);
    host.dataset.for = String(model.key);
  }
  host.querySelector(".wv-th-say").innerHTML = sayHTML(threadWords(model, sel));
  selectIn(host, sel);
  repaintAdded(host, model, opts.added ?? []);
  host.querySelector(".wv-th-panel").innerHTML = panelHTML(model, sel, opts);
  host.querySelector(".wv-th-twin").innerHTML = twinHTML(model, opts);
}

// ---------- the graph ----------
function drawGraph(fig, model, opts) {
  const { nodes, edges, layout } = model;
  const X = (id) => PAD + (layout.get(id)?.x ?? 0.5) * (W - 2 * PAD), Y = (id) => PAD + (layout.get(id)?.y ?? 0.5) * (H - 2 * PAD);
  const lines = edges.map((e, k) => `<line data-e="${k}" data-a="${esc(e.a)}" data-b="${esc(e.b)}" x1="${X(e.a).toFixed(1)}" y1="${Y(e.a).toFixed(1)}" x2="${X(e.b).toFixed(1)}" y2="${Y(e.b).toFixed(1)}" stroke="${e.planPlan ? COLOURS.plan : COLOURS.grey}" stroke-width="${e.planPlan ? 1.6 : 1}" opacity=".55"/>`).join("");
  const labels = labelPlaces(nodes.filter((n) => n.kind === "plan"), X, Y);
  const circles = nodes.map((n, i) => {
    const x = X(n.id), y = Y(n.id), lab = labels.get(n.id);
    return `<g class="wv-th-node k-${n.kind}" data-id="${esc(n.id)}" style="--d:${(i % 24) * 12}ms;--cx:${x.toFixed(1)}px;--cy:${y.toFixed(1)}px">
      <circle class="wv-th-dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${rOf(n)}" fill="${fillOf(n, false)}" stroke="${strokeOf(n, false)}" stroke-width="${n.kind === "list" ? 1.75 : 1.5}"/>
      ${lab ? `<text x="${lab.x.toFixed(1)}" y="${lab.y.toFixed(1)}" text-anchor="${lab.anchor}" font-size="11.5" font-weight="600" fill="${COLOURS.ink}">${esc(n.name)}</text>` : ""}
      <circle class="wv-th-hit" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="14" fill="transparent"/>
    </g>`;
  }).join("");
  fig.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" class="wv-svg${reduced() ? "" : " wv-th-anim"}" role="group" aria-label="Doors joined when Qloo says the same crowd goes to both"><g class="wv-th-edges">${lines}</g><circle class="wv-th-selring" r="14" fill="none" stroke="${COLOURS.ink}" stroke-width="1.5" opacity="0"/><g class="wv-th-nodes">${circles}</g></svg>`;
  const svg = fig.querySelector("svg");
  for (const g of svg.querySelectorAll(".wv-th-node")) {
    const n = model.byId.get(g.dataset.id);
    attachTip(g, () => [[n.name, kindWord(n, (opts.added ?? []).includes(n.id))], [`${plural(n.mates.length, "door")} ${n.mates.length === 1 ? "shares" : "share"} its crowd`, `${n.onPlanN} on your plan`], ["Click to open its thread", ""]], { label: `${n.name}: ${kindWord(n, false)}, ${plural(n.mates.length, "door")} ${n.mates.length === 1 ? "shares" : "share"} its crowd` });
    g.setAttribute("role", "button");
    g.addEventListener("pointerenter", () => lightUp(svg, n.id));
    g.addEventListener("pointerleave", () => lightUp(svg, svg.dataset.sel || null));
    g.addEventListener("focus", () => lightUp(svg, n.id));
    g.addEventListener("blur", () => lightUp(svg, svg.dataset.sel || null));
    g.addEventListener("click", () => opts.onSelect?.(n.id));
    g.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); opts.onSelect?.(n.id); } });
  }
}
// the plan doors' labels: right of the dot, else left, else above; a label that would sit on another is left out
// (the tooltip and the table twin carry it)
function labelPlaces(planNodes, X, Y) {
  const out = new Map(), boxes = [];
  const fits = (b) => b.x >= 0 && b.x + b.w <= W && !boxes.some((o) => b.x < o.x + o.w && b.x + b.w > o.x && b.y < o.y + o.h && b.y + b.h > o.y);
  for (const n of planNodes) {
    const w = n.name.length * 6.3, h = 13, x = X(n.id), y = Y(n.id);
    const tries = [{ x: x + 11, y: y + 4, anchor: "start", bx: x + 11 }, { x: x - 11, y: y + 4, anchor: "end", bx: x - 11 - w }, { x, y: y - 12, anchor: "middle", bx: x - w / 2 }];
    const t = tries.find((c) => fits({ x: c.bx, y: c.y - 10, w, h }));
    if (t) { out.set(n.id, t); boxes.push({ x: t.bx, y: t.y - 10, w, h }); }
  }
  return out;
}
function lightUp(svg, id) {
  for (const l of svg.querySelectorAll(".wv-th-edges line")) {
    const on = id == null || l.dataset.a === id || l.dataset.b === id;
    l.setAttribute("opacity", id == null ? ".55" : on ? "1" : ".1");
    l.classList.toggle("lit", id != null && on);
  }
}
function selectIn(host, sel) {
  const svg = host.querySelector("svg");
  if (!svg) return;
  svg.dataset.sel = sel ?? "";
  const ring = svg.querySelector(".wv-th-selring");
  const c = sel && svg.querySelector(`.wv-th-node[data-id="${CSS.escape(sel)}"] .wv-th-dot`);
  if (c) { ring.setAttribute("cx", c.getAttribute("cx")); ring.setAttribute("cy", c.getAttribute("cy")); ring.setAttribute("opacity", "1"); } else ring.setAttribute("opacity", "0");
  for (const n of svg.querySelectorAll(".wv-th-node")) n.classList.toggle("sel", n.dataset.id === sel);
  lightUp(svg, sel ?? null);
}
// the added doors' marks (the preview tray holds them): repaint without redrawing
export function repaintAdded(host, model, added = []) {
  const svg = host?.querySelector("svg");
  if (!svg) return;
  const set = new Set(added);
  for (const g of svg.querySelectorAll(".wv-th-node")) {
    const n = model.byId.get(g.dataset.id), c = g.querySelector(".wv-th-dot");
    if (!n || !c) continue;
    const a = set.has(n.id);
    c.setAttribute("fill", fillOf(n, a)); c.setAttribute("stroke", strokeOf(n, a)); c.setAttribute("r", a ? 8 : rOf(n));
  }
}

// ---------- the thread panel ----------
function panelHTML(model, sel, opts) {
  const n = model.byId.get(sel);
  if (!n) return `<p class="w-sub">Click a door on the picture to see the doors that share its crowd.</p>`;
  const added = opts.added ?? [], days = opts.days ?? {};
  const rows = threadOf(model, sel, { cityName: opts.cityName, added });
  const off = rows.filter((r) => r.st.k !== "plan" && r.st.k !== "added");
  const addable = off.filter((r) => Number.isFinite(r.n.lat));
  const onN = rows.filter((r) => r.st.k === "plan").length;
  const head = `<div class="wv-th-phead"><h5>${esc(n.name)}</h5><p>${rows.length ? `${plural(rows.length, "door")} share its crowd, Qloo says. ${onN} ${onN === 1 ? "is" : "are"} on your plan.` : "Qloo lists no other door with this crowd."}</p></div>`;
  const list = rows.length ? `<ul class="wv-th-rows">${rows.map(({ n: m, st }) => `<li class="k-${st.k}">
      <i style="background:${dotOf(st)}${st.k === "closed" || st.k === "route" || st.k === "known" ? `;border:2px solid ${COLOURS.plan}` : ""}" aria-hidden="true"></i>
      <button type="button" class="wv-th-name" data-th-sel="${esc(m.id)}"><b>${esc(m.name)}</b><small>${esc(st.k === "added" && days[m.id] ? `Added · ${days[m.id]}` : st.word)}</small></button>
      ${st.k === "added" ? `<span class="wv-th-ok">Added</span>` : st.k !== "plan" && Number.isFinite(m.lat) && opts.canAdd ? `<button type="button" class="btn sm line" data-th-add="${esc(m.id)}">Add</button>` : ""}
    </li>`).join("")}</ul>` : "";
  const acts = rows.length ? `<div class="wv-th-acts">${addable.length > 1 && opts.canAdd ? `<button type="button" class="btn sm line" data-th-addall="${esc(sel)}">Add all ${addable.length} to my plan</button>` : ""}${off.length ? `<button type="button" class="btn sm primary" data-th-ask="${esc(sel)}" aria-expanded="${!!opts.asked}">${esc(ASK_LABEL)}</button>` : ""}</div>` : "";
  return head + list + (opts.pv ?? "") + acts + (opts.asked ? agentHTML(model, sel, opts) : "");
}
// The agent's answer. The rules path (lib/whyviz/thread.js threadAnswer, composed from reason codes) draws at once,
// labelled as such per the agent's provenance rule; while opts.asking, a line says the Doors Agent is being asked; the
// model path's reply (agent2: doors:agent-reply r.whynot {doors[{id, name, rank, status, reason, fix{key, act, text}}],
// onPlan, pick, fallback?}) comes as opts.answer = {whynot, model, by, resting} and replaces it, in the same shape.
function agentHTML(model, sel, opts) {
  const rules = threadAnswer(model, sel, { cityName: opts.cityName, added: opts.added ?? [] });
  if (!rules) return "";
  const w = opts.answer?.whynot;
  const a = w && !w.fallback ? fromReply(w, rules) : rules;
  const byModel = a !== rules && opts.answer?.model && !opts.answer?.resting;
  const who = `<div class="wv-th-who"><b>Doors Agent</b><span>${esc(byModel ? `This answer: ${opts.answer.model}.` : "This answer is from Doors' own rules: no model was used.")}</span>${opts.asking ? `<span class="wv-th-asking" role="status">Asking Doors Agent for its own answer…</span>` : ""}</div>`;
  const open = opts.openAgent ? `<p class="wv-th-open"><button type="button" class="lnk" data-th-open="${esc(sel)}">Ask it in Doors Agent</button></p>` : "";
  if (!a.lines.length) return `<div class="wv-th-agent">${who}<p>${esc(a.text)}</p></div>`;
  const fixBtn = (l) => {
    const f = l.fix, n = model.byId.get(l.id);
    if (!f?.act || !n) return "";
    if (f.act === "days") return opts.editTo ? `<a class="lnk" href="${esc(opts.editTo)}">Change my days</a>` : "";
    if (f.act === "famous") return `<button type="button" class="lnk" data-th-fix="famous" data-id="${esc(l.id)}">Include the most popular doors</button>`;
    if (f.act === "rooms") return n.type ? `<button type="button" class="lnk" data-th-fix="rooms" data-type="${esc(n.type)}" data-id="${esc(l.id)}">Pitch ${esc(ROOM_PHRASE[n.type] ?? n.type)} too</button>` : "";
    if (f.act === "lock") return n.reasonDate && Number.isFinite(n.lat) && opts.canAdd ? `<button type="button" class="lnk" data-th-fix="lock" data-id="${esc(l.id)}" data-date="${esc(n.reasonDate)}">Add it to ${esc(n.reasonDay)}</button>` : "";
    if (f.act === "add") return Number.isFinite(n.lat) && opts.canAdd ? `<button type="button" class="lnk" data-th-add="${esc(l.id)}">Add ${esc(n.name)}</button>` : "";
    return "";
  };
  const pickBtn = a.pick?.id && Number.isFinite(model.byId.get(a.pick.id)?.lat) && opts.canAdd ? `<button type="button" class="btn sm primary" data-th-add="${esc(a.pick.id)}">Add ${esc(a.pick.name)}</button>` : "";
  return `<div class="wv-th-agent">${who}
    <p>${esc(a.head)}</p>
    <ul>${a.lines.map((l) => `<li><b>${esc(l.head)}:</b> ${esc(l.reason)} <em>${esc(l.fix ? l.fix.text : "No fix: that one is your call.")}</em> ${fixBtn(l)}</li>`).join("")}</ul>
    <p class="wv-th-pick">${esc(a.pick.text)}</p>${pickBtn}${open}
  </div>`;
}

// ---------- the table twin: every node, every number the picture draws ----------
function twinHTML(model, opts) {
  const added = new Set(opts.added ?? []);
  const rows = [...model.nodes].sort((p, q) => (p.kind === "plan" ? 0 : 1) - (q.kind === "plan" ? 0 : 1) || (p.rank ?? 1e9) - (q.rank ?? 1e9) || p.name.localeCompare(q.name));
  return tableTwinHTML({ cols: ["Door", "Status", "Your list", "Share its crowd", "On your plan"], rows: rows.map((n) => [n.name, kindWord(n, added.has(n.id)), n.rank ? `#${n.rank}` : "—", String(n.mates.length), String(n.onPlanN)]) }) +
    `<p class="w-fm">${plural(model.nodes.length, "door")}, ${plural(model.edges.length, "link")}, ${plural(model.threads, "thread")} holding a plan door.</p>`;
}
